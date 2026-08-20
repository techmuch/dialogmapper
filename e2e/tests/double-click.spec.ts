import { expect, openCanvas, selectNode, test, SEEDED_NODES } from "../fixtures";

/**
 * What double-click does, and — the part that was broken — what it does not.
 *
 * `onDoubleClick` was bound to the whole ReactFlow element rather than to the
 * pane, so it fired for double-clicks that landed on a card, an edge or a group
 * box as well as on empty canvas. Double-clicking a node started an inline
 * rename *and* dropped a new root Question behind it; double-clicking an edge
 * unlinked it *and* left a stray node in its place.
 *
 * Nothing caught it because every existing test asserted what a gesture
 * produces, never that it produces nothing else.
 */

const nodeCount = (page: import("@playwright/test").Page) =>
  page.locator(".react-flow__node .node").count();

test("double-clicking a node opens the details panel", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await expect(page.locator(".sidebar")).toHaveCount(0);

  await page.locator(".node", { hasText: "Add a read-through cache" }).dblclick();

  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".sidebar")).toContainText("Add a read-through cache");
});

test("double-clicking a node again closes the panel", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const card = page.locator(".node", { hasText: "Add a read-through cache" });

  await card.dblclick();
  await expect(page.locator(".sidebar")).toBeVisible();
  await card.dblclick();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("double-clicking a node creates nothing", async ({ page, dm }) => {
  await openCanvas(page, dm);
  expect(await nodeCount(page)).toBe(SEEDED_NODES);

  await page.locator(".node", { hasText: "Add a read-through cache" }).dblclick();
  await page.waitForTimeout(500);

  // The count is the whole point: a new Question used to appear underneath.
  expect(await nodeCount(page)).toBe(SEEDED_NODES);
  // Confirmed against the server, not just what happens to be rendered.
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const graph = await (
    await page.request.get(`${dm.url}/api/maps/${maps.maps[0].id}/graph`)
  ).json();
  expect(graph.nodes).toHaveLength(SEEDED_NODES);
});

test("double-clicking a node does not start an inline rename", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.locator(".node", { hasText: "Add a read-through cache" }).dblclick();

  // Renaming moved to F2 and Enter. Typing after a double-click must reach the
  // canvas shortcuts rather than overwrite the title.
  await expect(page.locator(".node__input")).toHaveCount(0);
});

test("F2 still starts an inline rename", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("F2");
  await expect(page.locator(".node__input")).toBeVisible();
});

/**
 * Double-clicking empty canvas zooms — React Flow's default.
 *
 * There used to be a handler here meant to create a root Question at the
 * pointer. It never ran: React Flow binds d3-zoom's `dblclick.zoom` to the
 * pane and that stops propagation, so the handler was unreachable from empty
 * canvas and only ever fired when the double-click landed on a card or an edge.
 * Its only observable effect was the stray node this file exists to prevent.
 */
test("double-clicking bare canvas zooms and creates nothing", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const scaleOf = async () => {
    const style = (await page.locator(".react-flow__viewport").getAttribute("style")) ?? "";
    return Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? 1);
  };
  const before = await scaleOf();

  await page.locator(".react-flow__pane").dblclick({ position: { x: 60, y: 420 } });
  await page.waitForTimeout(500);

  expect(await scaleOf()).toBeGreaterThan(before);
  await expect(page.locator(".react-flow__node .node")).toHaveCount(SEEDED_NODES);
});

test("double-clicking an edge unlinks it without creating anything", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);

  await page.locator(".react-flow__edge").first().dblclick({ force: true });
  await page.waitForTimeout(500);

  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const graph = await (
    await page.request.get(`${dm.url}/api/maps/${maps.maps[0].id}/graph`)
  ).json();
  expect(graph.edges).toHaveLength(2);
  expect(graph.nodes).toHaveLength(SEEDED_NODES);
});
