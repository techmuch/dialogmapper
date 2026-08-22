import { devices, type Browser, type Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * Following from the phone, and following somebody who changes map.
 *
 * The phone has no viewport to move, so "go to their node" means scrolling that
 * row into view and marking it. It also has no hover, which is why the roster
 * is a sheet with names rather than a row of dots.
 */

async function phone(browser: Browser, dm: DialogMapper): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  await page.locator(".m-row").first().waitFor();
  return page;
}

const row = (page: Page, text: string) => page.locator(".m-row", { hasText: text }).first();

/** The id of a map by name, since a <select> matches on value not label. */
async function mapIdNamed(page: Page, dm: DialogMapper, name: string): Promise<string> {
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const found = maps.maps.find((m: { name: string }) => m.name.includes(name));
  if (!found) throw new Error(`no map named ${name}`);
  return found.id;
}

test("the phone shows a people button once somebody else is here", async ({
  page,
  browser,
  dm,
}) => {
  const handset = await phone(browser, dm);
  // Alone, there is nobody to show.
  await expect(handset.locator(".m-people")).toHaveCount(0);

  await openCanvas(page, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });
  await handset.close();
});

test("the sheet names who is here and where they are", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  const person = handset.locator(".m-person").first();
  await expect(person).toContainText("Participant");
  // A phone cannot hover, so what a dot would have hidden in a tooltip has to
  // be on screen.
  await expect(person).toContainText("on the canvas");
  await expect(person).toContainText("Follow");
  await handset.close();
});

test("following from the phone tracks what they select", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toContainText("Following");

  // They move on the canvas; the phone marks the row they landed on.
  await selectNode(page, "Invalidation is forever");
  await expect(row(handset, "Invalidation is forever")).toHaveClass(/is-followed/, {
    timeout: 10_000,
  });

  await selectNode(page, "Cuts p99 to 200ms");
  await expect(row(handset, "Cuts p99 to 200ms")).toHaveClass(/is-followed/, {
    timeout: 10_000,
  });
  await expect(row(handset, "Invalidation is forever")).not.toHaveClass(/is-followed/);
  await handset.close();
});

/**
 * The marker says which row; scrolling is what makes it reachable.
 *
 * With a handful of rows the whole feed fits on screen and "scrolled into
 * view" is vacuously true, so this fills the map first.
 */
test("the feed scrolls to what they are looking at", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);

  // Enough rows that the target is well below the fold on a phone.
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const map = maps.maps.find((m: { name: string }) => m.name === "Caching");
  const graph = await (await page.request.get(`${dm.url}/api/maps/${map.id}/graph`)).json();
  const idea = graph.nodes.find((n: { type: string }) => n.type === "idea");
  for (let i = 0; i < 14; i++) {
    await page.request.post(`${dm.url}/api/nodes`, {
      data: {
        type: "con",
        title: `Filler objection number ${i}`,
        mapId: map.id,
        parentId: idea.id,
        relationshipType: "objects_to",
      },
    });
  }

  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });
  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();

  // Siblings sort newest first, so the *first* filler created is the one at
  // the bottom of the list and safely out of view.
  const target = "Filler objection number 0";
  await expect(row(handset, target)).toHaveCount(1, { timeout: 10_000 });

  // Out of sight before, on screen after.
  const inView = async () =>
    handset.evaluate((t) => {
      const el = [...document.querySelectorAll<HTMLElement>(".m-row")].find((r) =>
        r.textContent?.includes(t),
      );
      const feed = document.querySelector<HTMLElement>(".m-feed");
      if (!el || !feed) return false;
      const a = el.getBoundingClientRect();
      const b = feed.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    }, target);

  expect(await inView()).toBe(false);
  await selectNode(page, target);
  await expect.poll(inView, { timeout: 10_000 }).toBe(true);
  await handset.close();
});

test("the sheet offers to stop, and stopping works", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toBeVisible();

  await handset.locator(".m-people").click();
  await expect(handset.locator(".m-person").first()).toContainText("Stop");
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toHaveCount(0);
  await handset.close();
});

test("the banner stops following when tapped", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await handset.locator(".m-following").click();
  await expect(handset.locator(".m-following")).toHaveCount(0);
  await handset.close();
});

/** Replying is taking over, exactly as clicking the canvas is on the desktop. */
test("tapping a row stops following", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toBeVisible();

  await row(handset, "Add a read-through cache").click();
  await expect(handset.locator(".m-following")).toHaveCount(0);
  await handset.close();
});

test("following ends when they disconnect", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toBeVisible();

  await page.close();
  await expect(handset.locator(".m-following")).toHaveCount(0, { timeout: 10_000 });
  await handset.close();
});

/**
 * Following somebody onto another map.
 *
 * Without the map travelling with the selection this failed silently: the node
 * id was real, but not on the map you were looking at, so the jump did nothing
 * and following appeared to break.
 */
test("the canvas follows somebody onto another map", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await browser.newContext().then((c) => c.newPage());
  await openCanvas(other, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });
  await page.locator(".who__dot:not(.who__me)").first().dblclick();
  await expect(page.locator(".following")).toBeVisible();

  // The fixture creates a second, empty map — "Scratch" — alongside the seeded
  // one, so switching to it is a real change of map.
  const scratch = await mapIdNamed(other, dm, "Scratch");
  await other.locator(".toolbar__map").selectOption(scratch);
  await expect(other.locator(".react-flow__node .node")).toHaveCount(0, {
    timeout: 10_000,
  });

  // The follower is carried across rather than left staring at the old map.
  await expect(page.locator(".toolbar__map")).toHaveValue(
    await other.locator(".toolbar__map").inputValue(),
    { timeout: 10_000 },
  );
  await other.close();
});

test("the phone follows somebody onto another map", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(handset.locator(".m-people")).toBeVisible({ timeout: 10_000 });

  await handset.locator(".m-people").click();
  await handset.locator(".m-person").first().click();
  await expect(handset.locator(".m-following")).toBeVisible();

  const scratch = await mapIdNamed(page, dm, "Scratch");
  await page.locator(".toolbar__map").selectOption(scratch);

  await expect(handset.locator(".m-mapsel")).toHaveValue(
    await page.locator(".toolbar__map").inputValue(),
    { timeout: 10_000 },
  );
  await handset.close();
});
