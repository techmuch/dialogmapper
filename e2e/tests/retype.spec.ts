import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * Changing a node's type from the details panel.
 *
 * This used to fail almost every time. The check asked whether the *existing*
 * relationship stayed legal under the new type, which it rarely does — a
 * relationship is a reading of the two types at the ends of the arrow, so
 * changing one end has to relabel it. Now the grammar is asked whether *any*
 * relationship connects the new type to each neighbour, and that becomes the
 * edge's new label.
 *
 * The seeded map is: Question ← Idea ← {Pro, Con}. The Pro is a leaf, so it
 * has room to change; the Idea in the middle is pinned by its arguments, which
 * is a real IBIS constraint rather than a bug.
 */

async function edgeLabels(page: Page, dm: DialogMapper): Promise<string[]> {
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const map = maps.maps.find((m: { name: string }) => m.name === "Caching") ?? maps.maps[0];
  const graph = await (await page.request.get(`${dm.url}/api/maps/${map.id}/graph`)).json();
  return graph.edges.map((e: { relationshipType: string }) => e.relationshipType).sort();
}

async function openSidebarFor(page: Page, title: string) {
  await selectNode(page, title);
  if ((await page.locator(".sidebar").count()) === 0) await page.keyboard.press("Tab");
  await expect(page.locator(".sidebar")).toBeVisible();
}

const typeChip = (page: Page, label: string) =>
  page.locator(".sidebar .chips .chip", { hasText: new RegExp(`\\b${label}$`) }).first();

test("retyping relabels the edge instead of erroring", async ({ page, dm }) => {
  await openCanvas(page, dm);
  // The Pro is a leaf: it supports the Idea and nothing hangs off it.
  await openSidebarFor(page, "Cuts p99 to 200ms");

  // As a Con the same arrow reads "objects to" — the relationship follows the
  // types, rather than the change being refused for not matching the old one.
  await typeChip(page, "Con").click();

  await expect(page.locator(".toast--error")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Now a Con");

  const labels = await edgeLabels(page, dm);
  expect(labels).toContain("objects_to");
  expect(labels.filter((l) => l === "supports")).toHaveLength(0);
});

test("the relabelling is visible on the canvas", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Cuts p99 to 200ms");
  await typeChip(page, "Con").click();

  // The edge label is the user-visible consequence, so it has to update.
  await expect(
    page.locator(".react-flow__edge-text", { hasText: "objects to" }),
  ).toHaveCount(2);
});

test("a Note can be retyped and its link relabelled", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Cuts p99 to 200ms");

  // Pro -> Note: a Note relates to anything, so this is always available.
  await typeChip(page, "Note").click();
  await expect(page.locator(".toast--error")).toHaveCount(0);

  const labels = await edgeLabels(page, dm);
  expect(labels).toContain("relates_to");
});

/**
 * Not every change is possible, and the ones that are not should be visibly
 * unavailable rather than offered and then refused.
 */
test("impossible types are marked unavailable with a reason", async ({ page, dm }) => {
  await openCanvas(page, dm);
  // The Idea is pinned: a Pro and a Con hang off it, and neither can attach to
  // a Question, so it cannot become one.
  await openSidebarFor(page, "Add a read-through cache");

  const question = typeChip(page, "Question");
  await expect(question).toHaveAttribute("data-unavailable", "true");
  await expect(question).toHaveClass(/is-unavailable/);
  await expect(question).toHaveAttribute("title", /cannot attach|Detach/i);

  // The panel says why, rather than leaving a mysteriously dead control.
  await expect(page.locator(".sidebar")).toContainText("no legal relationship");
});

/**
 * A greyed-out control that does nothing on click looks broken. The chips stay
 * clickable so the click gets an answer instead of being swallowed.
 */
test("clicking an unavailable type says what is in the way", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Add a read-through cache");

  await typeChip(page, "Question").click();

  const toast = page.locator(".toast--error");
  await expect(toast).toBeVisible();
  // Naming the neighbour is the point: it tells you what to detach.
  await expect(toast).toContainText(/Cuts p99|Invalidation/);

  // And it really was refused — nothing changed.
  await expect(
    page.locator(".node--idea", { hasText: "Add a read-through cache" }),
  ).toBeVisible();
  expect(await edgeLabels(page, dm)).toContain("responds_to");
});

/**
 * After a retype the whole graph is refetched, which used to run through the
 * same path as switching maps and therefore cleared the selection — so the
 * panel emptied itself at the moment you wanted to see the result.
 */
test("the node stays selected after its type changes", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Cuts p99 to 200ms");

  await typeChip(page, "Con").click();
  await expect(page.locator(".toast")).toContainText("Now a Con");

  // The panel is still showing this node, now as a Con.
  await expect(page.locator(".sidebar")).toContainText("Cuts p99 to 200ms");
  await expect(typeChip(page, "Con")).toHaveClass(/is-on/);
  // And it is still selected on the canvas, so the next keystroke acts on it.
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
});

/**
 * An argument on an Idea cannot become a second Idea.
 *
 * This slipped through the first time because the grammar had a `specializes`
 * rule accepting a Question *or* an Idea at both ends, which quietly made
 * "Idea specializes Idea" legal. IBIS has no such link: two Ideas under one
 * Question are competing answers, and the competition lives in the Pros and
 * Cons on each rather than in an arrow between them.
 */
test("an argument on an Idea cannot become another Idea", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Invalidation is forever");

  const idea = typeChip(page, "Idea");
  await expect(idea).toHaveAttribute("data-unavailable", "true");
  await expect(idea).toHaveAttribute("title", /cannot attach|no legal|Detach/i);

  // Clicking it refuses out loud rather than doing nothing.
  await idea.click();
  await expect(page.locator(".toast--error")).toBeVisible();

  // And the graph is untouched: the Con still objects to the Idea.
  const labels = await edgeLabels(page, dm);
  expect(labels).toContain("objects_to");
  expect(labels.filter((l) => l === "specializes")).toHaveLength(0);
});

test("a leaf node offers every type the grammar allows", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Cuts p99 to 200ms");

  // A Pro supporting an Idea can become a Con or a Note; it cannot become a
  // Question, because nothing connects a Question to an Idea in that
  // direction. Whatever is offered must actually work.
  for (const label of ["Con", "Note"]) {
    await expect(typeChip(page, label)).toHaveAttribute("data-unavailable", "false");
  }
});

test("undoing a retype restores both the type and the relationship", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  await openSidebarFor(page, "Cuts p99 to 200ms");
  await typeChip(page, "Con").click();
  await expect(page.locator(".toast")).toContainText("Now a Con");

  await page.keyboard.press("Control+z");
  await expect(page.locator(".node--pro", { hasText: "Cuts p99 to 200ms" })).toBeVisible();

  // A Pro whose link still read "objects to" would be a broken graph.
  const labels = await edgeLabels(page, dm);
  expect(labels).toContain("supports");
});

test("no offered type change produces an error", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // The complaint that started this: clicking a type essentially always
  // errored. Anything still offered must now succeed. The unavailable ones are
  // allowed to complain — that is their job — so they are skipped here and
  // covered above.
  for (const label of ["Con", "Note", "Idea"]) {
    await openSidebarFor(page, "Cuts p99 to 200ms");
    const chip = typeChip(page, label);
    if ((await chip.getAttribute("data-unavailable")) === "true") continue;
    await chip.click();
    await page.waitForTimeout(500);
    await expect(page.locator(".toast--error")).toHaveCount(0);
  }
});
