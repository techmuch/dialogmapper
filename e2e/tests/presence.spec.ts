import { devices, type Browser, type Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * Two people in one map.
 *
 * Every other spec drives a single tab, so nothing until now exercised the case
 * the tool is actually for: a facilitator on the canvas and a participant on a
 * phone, each needing to know what the other has hold of.
 *
 * These open a second browser context per test — a genuinely separate client
 * with its own storage, so the server sees two participants rather than one
 * reconnecting.
 */

/** A second, independent client on the same server. */
async function secondCanvas(browser: Browser, dm: DialogMapper): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openCanvas(page, dm);
  return page;
}

/** A phone joining the same map. */
async function phone(browser: Browser, dm: DialogMapper): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  // `networkidle` says the document loaded, not that the app rendered or that
  // its socket joined. Waiting for a row is the cheap proxy for both, and
  // without it these tests are a race under parallel workers.
  await page.locator(".m-row").first().waitFor();
  return page;
}

const card = (page: Page, text: string) =>
  page.locator(".react-flow__node .node", { hasText: text }).first();

test("each connection is a separate participant", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  // The roster only appears once there is somebody else to show.
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await expect(other.locator(".who__dot")).toHaveCount(2);

  // Each sees exactly one of the dots as itself.
  await expect(page.locator(".who__me")).toHaveCount(1);
  await other.close();
});

test("a phone shows up alongside the canvas", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);

  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('.who__dot[title*="phone"]')).toHaveCount(1);
  await handset.close();
});

test("selecting a node shows it to everyone else", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(page, "Add a read-through cache");

  // The other client sees a marker on that node, and not on the others.
  await expect(
    other.locator(".node.is-watched", { hasText: "Add a read-through cache" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(other.locator(".node.is-watched")).toHaveCount(1);

  // And not on the client that made the selection: your own marker would be
  // noise on the node you are already working on.
  await expect(page.locator(".node.is-watched")).toHaveCount(0);
  await other.close();
});

test("editing a node locks it for everyone else", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");
  await expect(page.locator(".node__input")).toBeVisible();

  const locked = other.locator(".node.is-locked", { hasText: "Add a read-through cache" });
  await expect(locked).toBeVisible({ timeout: 10_000 });
  await expect(locked).toHaveAttribute("data-locked-by", /Participant/);

  // The holder does not see its own node as locked.
  await expect(page.locator(".node.is-locked")).toHaveCount(0);
  await other.close();
});

test("the other client cannot edit a locked node", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");
  await expect(
    other.locator(".node.is-locked", { hasText: "Add a read-through cache" }),
  ).toBeVisible({ timeout: 10_000 });

  // The second client tries anyway: no editor opens, and it is told why.
  await selectNode(other, "Add a read-through cache");
  await other.keyboard.press("F2");
  await expect(other.locator(".node__input")).toHaveCount(0);
  await expect(other.locator(".toast--error")).toContainText("is editing this node");
  await other.close();
});

/**
 * The guarantee that makes the lock worth having: the server refuses the write,
 * so a client that ignored the indicator still cannot overwrite the edit.
 */
test("the server refuses a write to a locked node", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");
  await expect(
    other.locator(".node.is-locked", { hasText: "Add a read-through cache" }),
  ).toBeVisible({ timeout: 10_000 });

  const maps = await (await other.request.get(`${dm.url}/api/maps`)).json();
  const graph = await (
    await other.request.get(`${dm.url}/api/maps/${maps.maps[0].id}/graph`)
  ).json();
  const target = graph.nodes.find((n: { title: string }) =>
    n.title.includes("read-through"),
  );

  const res = await other.request.patch(`${dm.url}/api/nodes/${target.id}`, {
    data: { title: "Overwritten behind their back" },
    headers: { "X-Client-Id": "a-client-that-ignored-the-lock" },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).kind).toBe("locked");
  await other.close();
});

test("committing the edit releases the lock", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");
  // Wait for the caret, not just the lock. Enter opens the editor when one is
  // not focused and commits when it is, so pressing it too early is a no-op
  // and the lock would never be released.
  await expect(page.locator(".node__input")).toBeFocused();
  await expect(other.locator(".node.is-locked")).toHaveCount(1, { timeout: 10_000 });

  await page.keyboard.press("Enter");
  await expect(other.locator(".node.is-locked")).toHaveCount(0, { timeout: 10_000 });
  await other.close();
});

/**
 * The release path that matters most: a closed laptop must not hold a node for
 * the rest of the meeting.
 */
test("closing a tab releases everything it held", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);

  await selectNode(other, "Add a read-through cache");
  await other.keyboard.press("F2");
  await expect(page.locator(".node.is-locked")).toHaveCount(1, { timeout: 10_000 });

  await other.close();
  await expect(page.locator(".node.is-locked")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".who__dot")).toHaveCount(0);
});

test("a phone tapping a node shows on the canvas", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  // Wait for the phone to actually be in the room before tapping. `networkidle`
  // says the page loaded, not that its WebSocket joined, and a tap sent before
  // then is presence nobody hears.
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await handset.locator(".m-row", { hasText: "Add a read-through cache" }).first().click();

  // The phone has no canvas, so a tap is its equivalent of selecting: the
  // facilitator should be able to see what a participant is looking at.
  await expect(card(page, "Add a read-through cache")).toBeVisible();
  await expect(
    page.locator(".node.is-watched", { hasText: "Add a read-through cache" }),
  ).toBeVisible({ timeout: 10_000 });
  await handset.close();
});

test("a node being edited on the canvas shows as locked on the phone", async ({
  page,
  browser,
  dm,
}) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");

  await expect(
    handset.locator(".m-row.is-locked", { hasText: "Add a read-through cache" }),
  ).toBeVisible({ timeout: 10_000 });
  await handset.close();
});
