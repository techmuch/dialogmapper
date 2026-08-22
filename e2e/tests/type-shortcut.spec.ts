import type { Page } from "@playwright/test";
import { expect, openCanvas, test } from "../fixtures";

/**
 * A leading ?, !, +, - or . narrows a search to one node type.
 *
 * The seeded map has exactly one of each: a Question, an Idea, a Pro and a Con.
 * That is what makes these assertions sharp — each marker must leave exactly
 * one node, so a marker that is silently ignored fails rather than merely
 * looking similar.
 *
 * The risk with a shortcut like this is the opposite of it not working: eating
 * a character somebody typed on purpose. "why not?" and "cost - benefit" are
 * ordinary searches, so those are covered too.
 */

const litTitles = (page: Page) =>
  page.$$eval(".react-flow__node .node", (els) =>
    els.filter((e) => !e.className.includes("is-dimmed")).map((e) => e.textContent?.trim() ?? ""),
  );

// Matched by class, not by placeholder: the placeholder is copy, and copy
// changes.
const filterBox = (page: Page) => page.locator(".toolbar__search");

test("the canvas filter narrows to a type", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // A bare marker shows that type and nothing else.
  await filterBox(page).fill("?");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("caching strategy")]);

  await filterBox(page).fill("!");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Add a read-through cache")]);

  await filterBox(page).fill("+");
  await expect.poll(() => litTitles(page)).toEqual([expect.stringContaining("Cuts p99")]);

  await filterBox(page).fill("-");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Invalidation is forever")]);
});

test("a marker combines with the words after it", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // "cache" alone matches the idea; asking for a Question as well matches
  // nothing, which is the proof that both criteria narrow.
  await filterBox(page).fill("cache");
  await expect.poll(() => litTitles(page)).toHaveLength(1);

  await filterBox(page).fill("? cache");
  await expect.poll(() => litTitles(page)).toHaveLength(0);

  // No space needed.
  await filterBox(page).fill("!cache");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Add a read-through cache")]);
});

test("the filter says which type it is showing", async ({ page, dm }) => {
  await openCanvas(page, dm);
  // A filter that quietly drops four fifths of the map is indistinguishable
  // from a broken one, so the badge is part of the feature.
  await expect(page.locator(".type-badge")).toHaveCount(0);

  await filterBox(page).fill("- cache");
  await expect(page.locator(".type-badge")).toContainText("Cons only");

  await filterBox(page).fill("cache");
  await expect(page.locator(".type-badge")).toHaveCount(0);
});

test("a marker in the middle of a query is ordinary text", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // The con is "Invalidation is forever" — no marker involved, and the query
  // contains a character that would be a marker at the start.
  await filterBox(page).fill("forever");
  await expect.poll(() => litTitles(page)).toHaveLength(1);

  // A hyphen between words must not be read as "show me Cons".
  await filterBox(page).fill("read-through");
  await expect
    .poll(() => litTitles(page))
    .toEqual([expect.stringContaining("Add a read-through cache")]);
});

test("the / palette narrows to a type", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.keyboard.press("/");
  const box = page.locator(".palette__input");
  await expect(box).toBeFocused();

  // "cach" matches the question ("caching") and the idea ("cache"); "cache"
  // alone matches only one, and a one-row list proves nothing about narrowing.
  await box.fill("cach");
  await expect(page.locator(".palette__results li")).toHaveCount(2);

  await box.fill("! cach");
  await expect(page.locator(".palette__results li")).toHaveCount(1);
  await expect(page.locator(".palette__title")).toContainText("Add a read-through cache");
  await expect(page.locator(".palette .type-badge")).toContainText("Ideas only");

  // An empty result names the type rather than saying "nothing matched".
  await box.fill("+ unicorn");
  await expect(page.locator(".palette__empty")).toContainText("No Pro matched");
});

test("the phone search narrows to a type", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  await expect(page.locator(".m-row").first()).toBeVisible();

  await page.locator(".m-search").fill("cach");
  await expect(page.locator(".m-row")).toHaveCount(2);

  await page.locator(".m-search").fill("- cach");
  await expect(page.locator(".m-row")).toHaveCount(0);

  await page.locator(".m-search").fill("-");
  await expect(page.locator(".m-row")).toHaveCount(1);
  await expect(page.locator(".m-row").first()).toContainText("Invalidation is forever");
});
