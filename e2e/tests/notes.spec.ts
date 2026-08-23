import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, typeTitle } from "../fixtures";

/**
 * A Note can be attached to anything.
 *
 * The grammar has always allowed it, but the canvas keyboard did not: `n` with
 * a Question selected produced an Idea, on the theory that an answer is the
 * obvious next move. `i` already did exactly that, so the special case bought
 * nothing and cost the only keyboard route to a Note on a Question — the one
 * parent type you most often want to hang a constraint or a piece of evidence
 * off.
 *
 * The seeded map has a Question, an Idea, a Pro and a Con, so these tests can
 * put a Note on all four.
 */

const nodeCount = (page: Page) => page.locator(".react-flow__node").count();

/** Presses `n` on the selected node and names the Note it creates. */
async function addNote(page: Page, title: string) {
  await page.keyboard.press("n");
  await typeTitle(page, title);
  await expect(page.locator(".node", { hasText: title })).toBeVisible();
}

/** The type badge on the card carrying this text. */
const typeOf = (page: Page, title: string) =>
  page.locator(".react-flow__node .node", { hasText: title }).first().locator(".node__type");

test("n adds a Note to a Question", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const before = await nodeCount(page);

  // This is the case that was broken: it used to make an Idea.
  await selectNode(page, "caching strategy");
  await addNote(page, "Board decides in March");

  await expect(typeOf(page, "Board decides in March")).toContainText(/note/i);
  expect(await nodeCount(page)).toBe(before + 1);
  // Linked, not stranded.
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
});

test("n adds a Note to an Idea, a Pro and a Con", async ({ page, dm }) => {
  await openCanvas(page, dm);

  for (const [parent, note] of [
    ["Add a read-through cache", "Costed at two weeks"],
    ["Cuts p99", "Measured on staging"],
    ["Invalidation is forever", "See the Redis postmortem"],
  ] as const) {
    await selectNode(page, parent);
    await addNote(page, note);
    await expect(typeOf(page, note)).toContainText(/note/i);
  }

  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".toast--error")).toHaveCount(0);
});

test("a Note can carry another Note", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, "caching strategy");
  await addNote(page, "First note");

  // The new Note is selected after creation, so `n` again nests under it.
  await addNote(page, "A note about the note");
  await expect(typeOf(page, "A note about the note")).toContainText(/note/i);
});

test("i still answers a Question, so nothing was lost", async ({ page, dm }) => {
  // `n` giving an Idea was redundant with `i`. That only holds if `i` still
  // does the job, so it is worth pinning.
  await openCanvas(page, dm);
  await selectNode(page, "caching strategy");

  await page.keyboard.press("i");
  await typeTitle(page, "Buy more memory");
  await expect(typeOf(page, "Buy more memory")).toContainText(/idea/i);
});

test("the phone can reply to any node with a Note", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  await expect(page.locator(".m-row").first()).toBeVisible();

  for (const parent of [
    "caching strategy",
    "Add a read-through cache",
    "Cuts p99",
    "Invalidation is forever",
  ]) {
    await page.locator(".m-row", { hasText: parent }).first().click();
    await expect(page.locator(".m-context")).toContainText(parent);
    // The composer only offers moves that are legal against the selection, so
    // a missing Note button is a missing capability. Matched by class: the
    // label carries the glyph too, so an exact-text match would never hit.
    await expect(page.locator(".m-kind--note")).toBeVisible();
  }
});
