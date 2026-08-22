import type { Page } from "@playwright/test";
import { expect, openCanvas, test, type DialogMapper } from "../fixtures";

/**
 * Spaces separate search terms, on all three surfaces.
 *
 * Every one of these searched for the typed string as a single substring, which
 * meant a second word almost always emptied the result — the two words are
 * rarely adjacent in that exact order. Typing more should narrow, not blank.
 *
 * The seed map gives us "Invalidation is forever": the query "invalidation
 * forever" is the discriminating case, because it matches under the new rule
 * and matches nothing under the old one. "invalidation cache" is the other
 * half — both words exist on the map but never on the same node, so requiring
 * every term must exclude everything.
 */

const litTitles = (page: Page) =>
  page.$$eval(".react-flow__node .node", (els) =>
    els.filter((e) => !e.className.includes("is-dimmed")).map((e) => e.textContent?.trim() ?? ""),
  );

// Matched by class, not by placeholder: the placeholder is copy, and copy
// changes.
const filterBox = (page: Page) => page.locator(".toolbar__search");

test("the canvas filter treats spaces as separators", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Not adjacent in the title, so the old single-substring match found nothing.
  await filterBox(page).fill("invalidation forever");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Invalidation is forever")]);

  // Order is not adjacency.
  await filterBox(page).fill("forever invalidation");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Invalidation is forever")]);
});

test("the canvas filter requires every term", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // One word alone finds a node...
  await filterBox(page).fill("invalidation");
  await expect.poll(() => litTitles(page)).toHaveLength(1);

  // ...but "cache" lives on a different node, so together they match nothing.
  // Under an any-term rule this would light up two nodes instead.
  await filterBox(page).fill("invalidation cache");
  await expect.poll(() => litTitles(page)).toHaveLength(0);

  // Two words that do share a node still match, out of order and apart —
  // otherwise "nothing matched" could just mean the substring rule survived.
  await filterBox(page).fill("cache read");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Add a read-through cache")]);
});

test("the canvas filter keeps quoted phrases together", async ({ page, dm }) => {
  await openCanvas(page, dm);

  await filterBox(page).fill('"is forever"');
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Invalidation is forever")]);

  // The words are on the node but not in this order, so the phrase fails.
  await filterBox(page).fill('"forever is"');
  await expect.poll(() => litTitles(page)).toHaveLength(0);
});

test("the phone search treats spaces as separators", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  await expect(page.locator(".m-row").first()).toBeVisible();

  await page.locator(".m-search").fill("invalidation forever");
  await expect(page.locator(".m-row")).toHaveCount(1);
  await expect(page.locator(".m-row").first()).toContainText("Invalidation is forever");

  // Both words are on the map, neither on the same node.
  await page.locator(".m-search").fill("invalidation cache");
  await expect(page.locator(".m-empty")).toContainText("Nothing matched");
});

/**
 * Run from the empty Scratch map so the results are unambiguous — the palette
 * searches the whole project, including the map you are on.
 */
test("the / palette treats spaces as separators", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Every fixture ships an empty "Scratch" map alongside the seeded one.
  // Searching from there makes the seeded nodes the ones the palette can find.
  await page.locator(".toolbar__map").selectOption({ label: "Scratch (0)" });
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  await page.keyboard.press("/");
  const box = page.locator(".palette__input");
  await expect(box).toBeFocused();

  await box.fill("invalidation forever");
  await expect(page.locator(".palette__title")).toHaveCount(1);
  await expect(page.locator(".palette__title")).toContainText("Invalidation is forever");

  await box.fill("invalidation cache");
  await expect(page.locator(".palette__empty")).toBeVisible();
});
