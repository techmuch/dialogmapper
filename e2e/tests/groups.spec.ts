import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test } from "../fixtures";

/**
 * Groups own their members.
 *
 * The first version of this feature was a rectangle drawn behind the canvas
 * with nothing inside it: it had its own stored geometry, and moving it moved
 * only the box. These tests pin the behaviour that makes a group a group —
 * the bounds come from the selection, and dragging carries the nodes along.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} has no bounding box`).not.toBeNull();
  return b!;
}

async function nodeBox(page: Page, title: string): Promise<Box> {
  const b = await page.locator(".node", { hasText: title }).first().boundingBox();
  expect(b, `node "${title}" has no bounding box`).not.toBeNull();
  return b!;
}

/** Selects several nodes by shift-clicking each after the first. */
async function selectNodes(page: Page, titles: string[]) {
  await selectNode(page, titles[0]);
  for (const title of titles.slice(1)) {
    await page.locator(".node", { hasText: title }).first().click({ modifiers: ["Shift"] });
  }
  await expect(page.locator(".node.is-selected")).toHaveCount(titles.length);
}

const MEMBERS = ["Add a read-through cache", "Cuts p99 to 200ms", "Invalidation is forever"];

test("shift-click builds a multi-node selection", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);

  // The affordance only appears once grouping is actually possible.
  await expect(page.locator(".canvas__group-btn")).toContainText("3 nodes");
});

test("a single node cannot be grouped", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, MEMBERS[0]);

  // A group of one is a node with decoration, so the affordance stays hidden.
  await expect(page.locator(".canvas__group-btn")).toHaveCount(0);
});

test("grouping wraps exactly the selected nodes", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");

  const group = page.locator(".group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".group__count")).toHaveText("3");

  // The outline is derived from the members, so it must contain all of them
  // and nothing that was left out.
  const outline = await boxOf(page, ".group");
  for (const title of MEMBERS) {
    const n = await nodeBox(page, title);
    expect(n.x, `${title} sits left of the group`).toBeGreaterThanOrEqual(outline.x - 1);
    expect(n.y, `${title} sits above the group`).toBeGreaterThanOrEqual(outline.y - 1);
    expect(n.x + n.width).toBeLessThanOrEqual(outline.x + outline.width + 1);
    expect(n.y + n.height).toBeLessThanOrEqual(outline.y + outline.height + 1);
  }

  const excluded = await nodeBox(page, "What should we do about caching strategy?");
  const insideHorizontally =
    excluded.x >= outline.x && excluded.x + excluded.width <= outline.x + outline.width;
  const insideVertically =
    excluded.y >= outline.y && excluded.y + excluded.height <= outline.y + outline.height;
  expect(
    insideHorizontally && insideVertically,
    "a node that was not selected ended up inside the group",
  ).toBe(false);
});

/** The behaviour the whole rework exists for. */
test("dragging the group moves every member with it", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");
  await expect(page.locator(".group")).toHaveCount(1);

  const before: Record<string, Box> = {};
  for (const title of MEMBERS) before[title] = await nodeBox(page, title);
  const outlineBefore = await boxOf(page, ".group");

  // Grab the outline somewhere that is not on top of a node.
  const grabX = outlineBefore.x + 14;
  const grabY = outlineBefore.y + outlineBefore.height - 14;
  const delta = { x: 150, y: -90 };

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + delta.x / 2, grabY + delta.y / 2, { steps: 6 });
  await page.mouse.move(grabX + delta.x, grabY + delta.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  for (const title of MEMBERS) {
    const now = await nodeBox(page, title);
    expect(
      Math.abs(now.x - (before[title].x + delta.x)),
      `${title} did not move with the group horizontally`,
    ).toBeLessThan(4);
    expect(
      Math.abs(now.y - (before[title].y + delta.y)),
      `${title} did not move with the group vertically`,
    ).toBeLessThan(4);
  }

  // And the outline stayed wrapped around them rather than sliding off.
  const outlineAfter = await boxOf(page, ".group");
  expect(Math.abs(outlineAfter.x - (outlineBefore.x + delta.x))).toBeLessThan(4);
  expect(Math.abs(outlineAfter.y - (outlineBefore.y + delta.y))).toBeLessThan(4);
  expect(Math.abs(outlineAfter.width - outlineBefore.width)).toBeLessThan(2);
});

test("a group move is persisted", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");

  // Compared in flow coordinates via the API, not in screen pixels: a reload
  // runs fitView, which changes the viewport transform and would make screen
  // positions incomparable for reasons that have nothing to do with saving.
  const storedX = async () => {
    const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
    const graph = await (
      await page.request.get(`${dm.url}/api/maps/${maps.maps[0].id}/graph`)
    ).json();
    const node = graph.nodes.find((n: { title: string }) => n.title === MEMBERS[0]);
    return node.placement.x as number;
  };

  const before = await storedX();

  const outline = await boxOf(page, ".group");
  await page.mouse.move(outline.x + 14, outline.y + outline.height - 14);
  await page.mouse.down();
  await page.mouse.move(outline.x + 74, outline.y + outline.height - 14, { steps: 6 });
  await page.mouse.move(outline.x + 134, outline.y + outline.height - 14, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await storedX();
  expect(after - before, "the drag was not written to the server").toBeGreaterThan(80);

  // And it is still there after a reload.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".group")).toHaveCount(1);
  expect(await storedX()).toBeCloseTo(after, 0);
});

test("moving one member restretches the outline", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");

  const outlineBefore = await boxOf(page, ".group");
  const member = page.locator(".node", { hasText: MEMBERS[2] }).first();
  const start = await member.boundingBox();

  // Drag one member well clear of the others. Bounds are derived, so the
  // outline has to grow to keep containing it.
  await page.mouse.move(start!.x + start!.width / 2, start!.y + 20);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2 + 220, start!.y + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const outlineAfter = await boxOf(page, ".group");
  expect(
    outlineAfter.width,
    "the outline did not follow the member that moved",
  ).toBeGreaterThan(outlineBefore.width + 100);
});

test("ungrouping leaves the nodes exactly where they are", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");
  await expect(page.locator(".group")).toHaveCount(1);

  const before = await nodeBox(page, MEMBERS[0]);
  const nodeCount = await page.locator(".node").count();

  await page.locator(".group__delete").click();
  await expect(page.locator(".group")).toHaveCount(0);

  // The nodes are the content; the group was only an arrangement of them.
  await expect(page.locator(".node")).toHaveCount(nodeCount);
  const after = await nodeBox(page, MEMBERS[0]);
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});

test("the group badge selects its members", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");

  await page.locator(".node").first().click(); // clear the selection
  await page.locator(".group__select").click();

  await expect(page.locator(".node.is-selected")).toHaveCount(MEMBERS.length);
});

test("grouping is undoable and leaves the nodes behind", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const nodeCount = await page.locator(".node").count();

  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");
  await expect(page.locator(".group")).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".group")).toHaveCount(0);
  // Undoing a grouping must not take the grouped nodes with it.
  await expect(page.locator(".node")).toHaveCount(nodeCount);
});

test("a group survives a reload with its membership", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNodes(page, MEMBERS);
  await page.keyboard.press("g");
  await expect(page.locator(".group")).toHaveCount(1);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".group")).toHaveCount(1);
  await expect(page.locator(".group__count")).toHaveText("3");
});
