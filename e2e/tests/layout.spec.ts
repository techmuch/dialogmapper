import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, typeTitle, type DialogMapper } from "../fixtures";

/**
 * Auto layout.
 *
 * It used to be a one-shot: switching it on ran the tidy tree once and nothing
 * ever ran it again, so every node added afterwards kept the crude offset
 * `createChild` guesses from its parent, and two branches growing at once put
 * cards on top of each other. It also locked dragging, so the only way out was
 * the toolbar toggle.
 *
 * It is now a view derived from the graph — equivalent to holding down `l` —
 * which never writes, so hand-placed positions survive a trip through it.
 */

/** On-canvas position of every node, read from React Flow's transform. */
async function positions(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.$$eval(".react-flow__node:has(.node)", (els) =>
    Object.fromEntries(
      els.map((e) => {
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
          (e as HTMLElement).style.transform,
        );
        return [
          e.querySelector(".node__title")?.textContent?.trim() ?? "",
          { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) },
        ];
      }),
    ),
  );
}

/** Saved positions, which are what survives a reload. */
async function saved(page: Page, dm: DialogMapper): Promise<Record<string, number>> {
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const graph = await (
    await page.request.get(`${dm.url}/api/maps/${maps.maps[0].id}/graph`)
  ).json();
  return Object.fromEntries(
    graph.nodes.map((n: { title: string; placement: { x: number } }) => [
      n.title,
      n.placement?.x,
    ]),
  );
}

const NODE_W = 236;
const NODE_H = 88;

function overlapping(pos: Record<string, { x: number; y: number }>): string[] {
  const e = Object.entries(pos);
  const hits: string[] = [];
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      if (
        Math.abs(e[i][1].x - e[j][1].x) < NODE_W &&
        Math.abs(e[i][1].y - e[j][1].y) < NODE_H
      ) {
        hits.push(`"${e[i][0]}" overlaps "${e[j][0]}"`);
      }
    }
  }
  return hits;
}

test("auto layout is on by default", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await expect(page.locator(".toolbar .pill.is-on", { hasText: "Auto layout" })).toBeVisible();
});

/**
 * The reported bug. Adding nodes under auto layout used to leave them piled up,
 * because nothing re-ran the layout after the initial pass.
 */
test("nodes added under auto layout never stack", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Build a second branch: two parents each growing children is the shape that
  // stacked, since neither offset knows about the other.
  await selectNode(page, "What should we do about caching strategy?");
  await page.keyboard.press("i");
  await typeTitle(page, "Denormalise the hot tables");
  await page.keyboard.press("Enter");
  await page.keyboard.press("+");
  await typeTitle(page, "No new infrastructure");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  expect(overlapping(await positions(page))).toEqual([]);
});

/**
 * The property that makes auto layout "auto": it re-runs on every change, so
 * the map is always what holding down `l` would give you.
 *
 * The signature of a live layout is that *existing* nodes move — a parent
 * re-centres over its children as soon as a second branch appears. Under the
 * old one-shot behaviour nothing moved after the initial pass, which is what
 * left later additions sitting wherever their crude offset put them.
 */
test("auto layout re-runs when the graph changes", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const before = await positions(page);

  await selectNode(page, "What should we do about caching strategy?");
  await page.keyboard.press("i");
  await typeTitle(page, "Denormalise the hot tables");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  // The question now spans two subtrees, so it has to re-centre.
  const after = await positions(page);
  expect(after["What should we do about caching strategy?"].x).not.toBeCloseTo(
    before["What should we do about caching strategy?"].x,
    0,
  );
});

test("dragging a node hands control back to freeform", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const card = page.locator(".node", { hasText: "Cuts p99 to 200ms" });

  await card.hover();
  await page.mouse.down();
  await page.mouse.move(500, 500, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".toolbar .pill", { hasText: "Freeform" })).toBeVisible();
});

/**
 * Dragging bakes the visible auto positions before switching, so only the
 * dragged node moves. Without that the rest of the map would snap back to
 * whatever was saved before auto was switched on — mid-drag.
 */
test("dragging out of auto layout does not move the other nodes", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // The seeded map's saved positions are already its auto positions, so they
  // have to be pulled apart first — otherwise "snapped back to saved" and
  // "stayed where auto put it" are the same coordinates and the test cannot
  // tell a working handoff from a broken one.
  await page.click('.toolbar .pill:has-text("Auto layout")');
  const moved = page.locator(".node", { hasText: "Invalidation is forever" });
  await moved.hover();
  await page.mouse.down();
  await page.mouse.move(900, 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Back into auto: the hand-placed node returns to its computed spot.
  await page.click('.toolbar .pill:has-text("Freeform")');
  await page.waitForTimeout(400);
  const before = await positions(page);

  // Now drag something else, which hands control back to freeform.
  const card = page.locator(".node", { hasText: "Cuts p99 to 200ms" });
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(600, 520, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Everything except the dragged node stays exactly where it appeared. If the
  // auto positions were not saved on drag-start, "Invalidation is forever"
  // would jump back to where it was dropped by hand.
  const after = await positions(page);
  for (const title of Object.keys(before)) {
    if (title === "Cuts p99 to 200ms") continue;
    expect(after[title].x).toBeCloseTo(before[title].x, 0);
    expect(after[title].y).toBeCloseTo(before[title].y, 0);
  }
});

/**
 * Auto layout is a view and never writes, so a hand-arranged map comes back
 * unchanged after being viewed through it.
 */
test("hand-placed positions survive a trip through auto layout", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Leave auto and arrange one node by hand.
  await page.click('.toolbar .pill:has-text("Auto layout")');
  const card = page.locator(".node", { hasText: "Cuts p99 to 200ms" });
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const placed = (await saved(page, dm))["Cuts p99 to 200ms"];

  // Through auto and back again.
  await page.click('.toolbar .pill:has-text("Freeform")');
  await expect(page.locator(".toolbar .pill.is-on", { hasText: "Auto layout" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.click('.toolbar .pill:has-text("Auto layout")');
  await page.waitForTimeout(400);

  expect((await saved(page, dm))["Cuts p99 to 200ms"]).toBe(placed);
});

/**
 * `l` is the explicit "commit this arrangement" action: it should leave the map
 * exactly as if each node had been dragged there.
 */
test("pressing l in freeform saves the positions", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.click('.toolbar .pill:has-text("Auto layout")');
  await expect(page.locator(".toolbar .pill", { hasText: "Freeform" })).toBeVisible();

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 300 } });
  await page.keyboard.press("l");
  await page.waitForTimeout(700);

  const onScreen = await positions(page);
  const onServer = await saved(page, dm);
  for (const [title, p] of Object.entries(onScreen)) {
    expect(onServer[title]).toBe(Math.round(p.x));
  }

  // And it survives a reload, which is the real test of "saved".
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  expect(overlapping(await positions(page))).toEqual([]);
});
