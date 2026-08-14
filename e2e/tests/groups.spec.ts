import { expect, openCanvas, test } from "../fixtures";
import type { Page } from "@playwright/test";

/**
 * The group rubber band must track the cursor.
 *
 * It did not: the preview was a plain child of <ReactFlow>, so it was
 * positioned in screen pixels, while its coordinates came from
 * screenToFlowPosition and were therefore flow coordinates. The box drifted
 * from the cursor by the current pan and scaled wrongly with zoom, then
 * snapped into place on release because the committed group is a real node in
 * flow space.
 *
 * The measurement below is the point of this file: it compares where the
 * preview appears on screen against where the group lands, so any future
 * coordinate-space mistake fails loudly instead of being "a bit off".
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function drawGroup(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ preview: Box; committed: Box; cursor: Box }> {
  await page.locator(".canvas__group-btn").click();

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });

  const preview = await page.locator(".group-preview").boundingBox();
  expect(preview, "no rubber band appeared while dragging").not.toBeNull();

  await page.mouse.up();

  const group = page.locator(".group").last();
  await expect(group).toBeVisible();
  const committed = await group.boundingBox();
  expect(committed).not.toBeNull();

  return {
    preview: preview!,
    committed: committed!,
    cursor: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    },
  };
}

/** Boxes must agree to within a pixel or so of rounding. */
function expectSameBox(a: Box, b: Box, what: string) {
  const tolerance = 2;
  expect(Math.abs(a.x - b.x), `${what}: x is off by ${(a.x - b.x).toFixed(1)}px`)
    .toBeLessThan(tolerance);
  expect(Math.abs(a.y - b.y), `${what}: y is off by ${(a.y - b.y).toFixed(1)}px`)
    .toBeLessThan(tolerance);
  expect(
    Math.abs(a.width - b.width),
    `${what}: width is off by ${(a.width - b.width).toFixed(1)}px`,
  ).toBeLessThan(tolerance);
  expect(
    Math.abs(a.height - b.height),
    `${what}: height is off by ${(a.height - b.height).toFixed(1)}px`,
  ).toBeLessThan(tolerance);
}

async function pan(page: Page, dx: number, dy: number) {
  // Drag on empty canvas, well clear of any node.
  await page.mouse.move(1050, 180);
  await page.mouse.down();
  await page.mouse.move(1050 + dx, 180 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function zoomOut(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(640, 380);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
}

test("the group preview tracks the cursor with an untouched viewport", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);

  // Note this case was broken too: fitView on load leaves a non-identity
  // transform, so the bug showed up before the user panned anything.
  const { preview, committed, cursor } = await drawGroup(
    page,
    { x: 340, y: 190 },
    { x: 690, y: 470 },
  );
  expectSameBox(preview, cursor, "preview vs cursor");
  expectSameBox(preview, committed, "preview vs committed group");
});

test("the group preview tracks the cursor after panning", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await pan(page, -260, 130);

  const { preview, committed, cursor } = await drawGroup(
    page,
    { x: 340, y: 190 },
    { x: 690, y: 470 },
  );
  expectSameBox(preview, cursor, "preview vs cursor after pan");
  expectSameBox(preview, committed, "preview vs committed group after pan");
});

test("the group preview tracks the cursor when zoomed out", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await pan(page, 180, -90);
  await zoomOut(page, 3);

  const { preview, committed, cursor } = await drawGroup(
    page,
    { x: 340, y: 190 },
    { x: 690, y: 470 },
  );
  expectSameBox(preview, cursor, "preview vs cursor when zoomed");
  expectSameBox(preview, committed, "preview vs committed group when zoomed");
});

test("the preview outline stays visible when zoomed far out", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await zoomOut(page, 6);
  await page.locator(".canvas__group-btn").click();

  await page.mouse.move(400, 250);
  await page.mouse.down();
  await page.mouse.move(650, 430, { steps: 6 });

  // Inside the viewport transform everything scales, so a fixed border becomes
  // a hairline when zoomed out — invisible exactly when the feedback matters.
  const borderPx = await page
    .locator(".group-preview")
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth) *
      (el.closest(".react-flow__viewport") as HTMLElement | null
        ? new DOMMatrix(getComputedStyle(el.closest(".react-flow__viewport") as HTMLElement).transform).a
        : 1));

  await page.mouse.up();
  expect(borderPx, "the rubber band outline is too faint to see").toBeGreaterThan(0.7);
});

test("a group survives a reload and can be removed", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await drawGroup(page, { x: 340, y: 190 }, { x: 690, y: 470 });

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".group")).toHaveCount(1);

  // Deleting a grouping must not take its member nodes with it: groups are
  // purely spatial and carry no IBIS meaning.
  const before = await page.locator(".node").count();
  await page.locator(".group__delete").click();
  await expect(page.locator(".group")).toHaveCount(0);
  await expect(page.locator(".node")).toHaveCount(before);
});
