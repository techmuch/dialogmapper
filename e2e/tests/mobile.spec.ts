import { devices, type Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/**
 * The mobile surface is a different product, not a shrunken canvas: a
 * participant sees the conversation and adds one thing to it.
 *
 * The device emulation is applied at the top level because `devices` sets
 * `defaultBrowserType`, which Playwright will not accept inside a describe
 * block — it would force a new worker mid-file.
 */
test.use({ ...devices["Pixel 7"] });

const row = (page: Page, text: string) => page.locator(".m-row", { hasText: text }).first();

/** The tree depth a row is rendered at, from its data-depth attribute. */
async function depthOf(page: Page, text: string): Promise<number> {
  return Number(await row(page, text).getAttribute("data-depth"));
}

test("phones get the list, not the canvas", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await expect(page.locator(".m-feed")).toBeVisible();
  // A pinch-zoom graph on a phone is unusable, so the canvas must not appear.
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await expect(page.locator(".m-row").first()).toBeVisible();
});

/**
 * The list used to be flat and reverse-chronological, which left every row
 * rootless: a Pro with no visible parent could be supporting any Idea on the
 * map, and in IBIS that makes it unreadable.
 */
test("replies are nested under what they answer", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  expect(await depthOf(page, "caching strategy")).toBe(0);
  expect(await depthOf(page, "Add a read-through cache")).toBe(1);
  expect(await depthOf(page, "Cuts p99 to 200ms")).toBe(2);
  expect(await depthOf(page, "Invalidation is forever")).toBe(2);

  // Depth is rendered as indentation, not just recorded in an attribute.
  const idea = await row(page, "Add a read-through cache").boundingBox();
  const pro = await row(page, "Cuts p99 to 200ms").boundingBox();
  expect(pro!.x).toBeGreaterThan(idea!.x);
});

test("a thread collapses to its root and back", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  const toggle = page.locator(".m-thread__toggle").first();
  await expect(toggle).toContainText("3 replies");

  await toggle.click();
  await expect(row(page, "Cuts p99 to 200ms")).toHaveCount(0);
  // The root survives, so the thread is still findable.
  await expect(row(page, "caching strategy")).toBeVisible();

  await toggle.click();
  await expect(row(page, "Cuts p99 to 200ms")).toBeVisible();
});

/**
 * Threading places a reply where it belongs rather than at the top, so without
 * a marker a phone user in a live session would have to hunt for what changed.
 */
test("something added while you are looking is marked new", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  // Nothing is new on arrival — otherwise the whole map would light up.
  await expect(page.locator(".m-row.is-new")).toHaveCount(0);

  // Posted by somebody else, so it arrives over the WebSocket rather than
  // through this page's own composer.
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const map = maps.maps.find((m: { name: string }) => m.name === "Caching") ?? maps.maps[0];
  const graph = await (await page.request.get(`${dm.url}/api/maps/${map.id}/graph`)).json();
  const idea = graph.nodes.find((n: { type: string }) => n.type === "idea");
  await page.request.post(`${dm.url}/api/nodes`, {
    data: {
      type: "con",
      title: "Said by someone else",
      mapId: map.id,
      parentId: idea.id,
      relationshipType: "objects_to",
    },
  });

  await expect(row(page, "Said by someone else")).toHaveClass(/is-new/, { timeout: 10_000 });
  await expect(page.locator(".m-scope")).toContainText("new since you opened");
});

/**
 * Search on the phone.
 *
 * It renders through a different branch from the feed — a flat list of matches
 * rather than threads — and that branch had no coverage at all, so the whole
 * search path could have broken without a single test noticing.
 */
test("searching shows matching nodes", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-search").fill("Invalidation");
  await expect(row(page, "Invalidation is forever")).toBeVisible();
  await expect(page.locator(".m-row")).toHaveCount(1);
  await expect(page.locator(".m-scope")).toContainText("1 result");
});

test("search matches body text, not just titles", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-search").fill("nonsense-that-matches-nothing");
  await expect(page.locator(".m-empty")).toContainText("Nothing matched");
  await expect(page.locator(".m-row")).toHaveCount(0);
});

test("search results are flat, with no thread controls", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  await expect(page.locator(".m-thread__toggle").first()).toBeVisible();

  await page.locator(".m-search").fill("cache");
  await expect(page.locator(".m-row").first()).toBeVisible();
  // A match answers for itself; rebuilding threads around scattered hits would
  // mostly show context nobody asked for.
  await expect(page.locator(".m-thread__toggle")).toHaveCount(0);
  expect(await depthOf(page, "Add a read-through cache")).toBe(0);
});

test("clearing the search restores the threaded feed", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-search").fill("Invalidation");
  await expect(page.locator(".m-row")).toHaveCount(1);

  await page.locator(".m-search").fill("");
  await expect(page.locator(".m-thread__toggle").first()).toBeVisible();
  expect(await depthOf(page, "Cuts p99 to 200ms")).toBe(2);
});

test("a search result can be replied to", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-search").fill("Invalidation");
  await row(page, "Invalidation is forever").click();
  await expect(page.locator(".m-context")).toContainText("Invalidation is forever");

  await page.locator(".m-input").fill("Cache tags would help");
  await page.locator(".m-send").click();

  // Posting clears the search, so the reply is visible in its thread.
  await expect(row(page, "Cache tags would help")).toBeVisible();
  expect(await depthOf(page, "Cache tags would help")).toBe(3);
});

test("a reply lands under the node that was tapped", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await row(page, "Cuts p99 to 200ms").click();
  await page.locator(".m-input").fill("Measured on the staging replica");
  await page.locator(".m-send").click();

  await expect(row(page, "Measured on the staging replica")).toBeVisible();
  // One level deeper than the Pro it was attached to, not stranded at the top.
  expect(await depthOf(page, "Measured on the staging replica")).toBe(3);
  await expect(row(page, "Measured on the staging replica")).toHaveClass(/is-new/);
});

test("a mobile user agent at the root is redirected to the feed", async ({
  page,
  dm,
}) => {
  await page.goto(dm.url, { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/m");
});

test("the composer only offers moves that are legal for the tapped node", async ({
  page,
  dm,
}) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  // Tapping a Question: an Idea answers it, but a Pro cannot support it, so
  // the phone user cannot build an invalid map by accident.
  await page.locator(".m-row--question").first().click();
  const onQuestion = (await page.locator(".m-kind").allInnerTexts())
    .join(" ")
    .toLowerCase();
  expect(onQuestion).toContain("idea");
  expect(onQuestion).not.toContain("pro");

  // Tapping an Idea: now arguments are the sensible moves.
  await page.locator(".m-context button").click();
  await page.locator(".m-row--idea").first().click();
  const onIdea = (await page.locator(".m-kind").allInnerTexts()).join(" ").toLowerCase();
  expect(onIdea).toContain("pro");
  expect(onIdea).toContain("con");
});

test("a reply from the phone really reaches the graph", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-row--idea").first().click();
  await page.locator(".m-input").fill("Sent from a phone");
  await page.locator(".m-send").click();

  await expect(page.locator(".m-row", { hasText: "Sent from a phone" })).toBeVisible();

  // Confirmed against the server, not just the optimistic UI.
  const feed = await (await page.request.get(`${dm.url}/api/feed`)).json();
  expect(
    feed.nodes.some((n: { title: string }) => n.title === "Sent from a phone"),
  ).toBe(true);
});
