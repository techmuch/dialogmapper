import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, typeTitle, type DialogMapper } from "../fixtures";

/**
 * Where the canvas points, and how big everything looks.
 *
 * Two rules: a node you are about to type into must be on screen, and the zoom
 * belongs to the user once they have asked for a particular level.
 */

async function zoom(page: Page): Promise<number> {
  const style = (await page.locator(".react-flow__viewport").getAttribute("style")) ?? "";
  return Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? 1);
}

/** Whether the node currently being edited sits fully inside the canvas. */
async function editorFullyVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const input = document.querySelector(".node__input");
    const card = input?.closest(".react-flow__node");
    const canvas = document.querySelector(".canvas");
    if (!card || !canvas) return false;
    const c = card.getBoundingClientRect();
    const v = canvas.getBoundingClientRect();
    return c.left >= v.left && c.top >= v.top && c.right <= v.right && c.bottom <= v.bottom;
  });
}

/** Puts the selected node in the bottom-right corner of the canvas. */
async function shoveSelectionToCorner(page: Page) {
  await page.keyboard.press(" "); // centre on the selection
  await page.waitForTimeout(400);
  const box = (await page.locator(".canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 40, box.y + box.height - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test("a new node is panned fully into view", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // A child is created below and right of its parent, so a parent pinned in
  // the bottom-right corner puts it off screen — which is where the cursor
  // used to end up, in a title field nobody could see.
  await selectNode(page, "Invalidation is forever");
  await shoveSelectionToCorner(page);

  await page.keyboard.press("q");
  await page.waitForTimeout(800);

  await expect(page.locator(".node__input")).toBeVisible();
  expect(await editorFullyVisible(page)).toBe(true);
});

test("the new node really was off screen to begin with", async ({ page, dm }) => {
  // Guards the test above: if the setup stopped producing an off-screen node,
  // it would pass whether or not anything panned.
  await openCanvas(page, dm);
  await selectNode(page, "Invalidation is forever");
  await shoveSelectionToCorner(page);

  const box = (await page.locator(".canvas").boundingBox())!;
  const parent = (await page.locator(".node", { hasText: "Invalidation is forever" }).boundingBox())!;
  // Its child lands below and to the right of this, past the canvas edge.
  expect(parent.y + parent.height + 150).toBeGreaterThan(box.y + box.height);
});

test("panning a node into view does not change the zoom", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const before = await zoom(page);

  await selectNode(page, "Invalidation is forever");
  await page.keyboard.press("q");
  await page.waitForTimeout(700);

  expect(await zoom(page)).toBeCloseTo(before, 3);
});

test("a node already on screen is left where it is", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const viewport = () => page.locator(".react-flow__viewport").getAttribute("style");

  // Selecting a comfortably visible node and editing it must not move the map:
  // panning when nothing was wrong is its own kind of disorienting.
  await selectNode(page, "Add a read-through cache");
  const before = await viewport();
  await page.keyboard.press("F2");
  await page.waitForTimeout(500);

  expect(await viewport()).toBe(before);
});

test("zoom defaults to auto", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await expect(page.locator(".zoompick select")).toHaveValue("auto");
});

/**
 * The point of the control: tidying must stop changing how big things look.
 */
test("a fixed zoom survives the l command", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.locator(".zoompick select").selectOption("1");
  await page.waitForTimeout(400);
  expect(await zoom(page)).toBeCloseTo(1, 2);

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 300 } });
  await page.keyboard.press("l");
  await page.waitForTimeout(800);

  expect(await zoom(page)).toBeCloseTo(1, 2);
});

test("a fixed zoom survives fit and space", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.locator(".zoompick select").selectOption("0.5");
  await page.waitForTimeout(400);

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 300 } });
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  expect(await zoom(page)).toBeCloseTo(0.5, 2);

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press(" ");
  await page.waitForTimeout(600);
  expect(await zoom(page)).toBeCloseTo(0.5, 2);
});

test("auto zoom still lets fit choose the level", async ({ page, dm }) => {
  await openCanvas(page, dm);
  // Zoom in by hand while on auto, then fit: the level should change, which is
  // the behaviour auto is there to preserve.
  await page.locator(".react-flow__controls-zoomin").click();
  await page.locator(".react-flow__controls-zoomin").click();
  await page.waitForTimeout(400);
  const zoomed = await zoom(page);

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 300 } });
  await page.keyboard.press("f");
  await page.waitForTimeout(600);

  expect(await zoom(page)).not.toBeCloseTo(zoomed, 2);
  await expect(page.locator(".zoompick select")).toHaveValue("auto");
});

test("the setting follows a manual zoom", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.locator(".zoompick select").selectOption("1");
  await page.waitForTimeout(400);

  // Zooming in by hand updates the control rather than being overruled by it.
  await page.locator(".react-flow__controls-zoomin").click();
  await page.waitForTimeout(500);

  await expect(page.locator(".zoompick select")).not.toHaveValue("1");
  await expect(page.locator(".zoompick select")).not.toHaveValue("auto");
});

test("a fixed zoom survives a reload", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.locator(".zoompick select").selectOption("1.5");
  await page.waitForTimeout(400);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // The fitView on first paint must not quietly reset the pinned level.
  await expect(page.locator(".zoompick select")).toHaveValue("1.5");
  expect(await zoom(page)).toBeCloseTo(1.5, 2);
});
