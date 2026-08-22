import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * The `/` palette does two jobs.
 *
 * It used to do one — insert a node from another map — and it searched only
 * nodes *not* on the current map, so it could never answer the more common
 * question, "where did we say that?". Now Enter goes to the node and
 * Option-Enter brings it in under whatever is selected.
 *
 * The fixture seeds a "Caching" map with 4 nodes and an empty "Scratch" map, so
 * these tests can look at a result from both sides: already here, and elsewhere.
 */

/**
 * Opens the palette without disturbing the selection.
 *
 * Clicking `.react-flow__pane` to "clear focus" first looks harmless and is
 * not: Playwright clicks the element's centre, a node usually sits there, and
 * the click lands on the node — silently changing which node an insert would
 * be parented to.
 */
const openPalette = async (page: Page) => {
  await page.keyboard.press("/");
  await expect(page.locator(".palette__input")).toBeFocused();
};

/** Clicks empty canvas, away from the middle where the nodes are. */
const clickEmptyCanvas = (page: Page) =>
  page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });

const rows = (page: Page) => page.locator(".palette__results li");
const rowFor = (page: Page, text: string) =>
  page.locator(".palette__results li", { hasText: text }).first();

/** Switches maps through the toolbar, the way a user would. */
async function openMap(page: Page, label: string) {
  await page.locator(".toolbar__map").selectOption({ label });
}

/**
 * How far a node sits from the middle of the canvas, in pixels.
 *
 * Asserting that the viewport transform merely *changed* is a weak test and a
 * misleading one: on a four-node map the first result can already be dead
 * centre, so a working jump moves nothing and the test fails. Centring is the
 * actual claim, so measure that.
 */
async function offCentre(page: Page, title: string): Promise<number> {
  const node = await page.locator(".node", { hasText: title }).first().boundingBox();
  const pane = await page.locator(".react-flow").boundingBox();
  if (!node || !pane) throw new Error(`no box for ${title}`);
  return Math.hypot(
    node.x + node.width / 2 - (pane.x + pane.width / 2),
    node.y + node.height / 2 - (pane.y + pane.height / 2),
  );
}

/** Opens the palette, types a query, and takes the only result. */
async function jumpTo(page: Page, query: string) {
  await openPalette(page);
  await page.locator(".palette__input").fill(query);
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".palette")).toHaveCount(0);
}

test("the palette searches this map too, and says which results are here", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  await openPalette(page);
  await page.locator(".palette__input").fill("invalidation");

  // The old palette excluded the current map, so this row could not appear.
  const row = rowFor(page, "Invalidation is forever");
  await expect(row).toBeVisible();
  await expect(row.locator(".palette__meta")).toContainText("on this map");
  // And insert is unavailable for it, with a reason rather than a dead control.
  await expect(row.locator(".palette__insert")).toHaveText("On this map");
  await expect(row.locator(".palette__insert")).toHaveAttribute("data-unavailable", "true");
});

test("arrow keys move the cursor through the results", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPalette(page);
  // "cach" matches the question ("caching") and the idea ("cache"); "cache"
  // alone would match only one, and a one-row list proves nothing about a
  // cursor.
  await page.locator(".palette__input").fill("cach");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveClass(/is-active/);

  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toHaveClass(/is-active/);
  await expect(rows(page).first()).not.toHaveClass(/is-active/);

  await page.keyboard.press("ArrowUp");
  await expect(rows(page).first()).toHaveClass(/is-active/);

  // The ends are clamped rather than wrapping, so holding a key cannot walk
  // the cursor off the list.
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).first()).toHaveClass(/is-active/);
});

test("Enter centres the highlighted node on the canvas", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Jumping twice, to two nodes that cannot both be centred, is what makes this
  // meaningful. Asserting the transform merely changed would pass on a canvas
  // that moved somewhere arbitrary, and asserting one node ends up centred can
  // be true before the jump ever happens.
  await jumpTo(page, "read-through");
  await expect(page.locator(".node.is-selected")).toContainText("read-through");
  await expect.poll(() => offCentre(page, "Add a read-through cache")).toBeLessThan(40);
  expect(await offCentre(page, "Invalidation is forever")).toBeGreaterThan(80);

  await jumpTo(page, "invalidation");
  await expect(page.locator(".node.is-selected")).toContainText("Invalidation is forever");
  await expect.poll(() => offCentre(page, "Invalidation is forever")).toBeLessThan(40);
  expect(await offCentre(page, "Add a read-through cache")).toBeGreaterThan(80);
});

test("Enter on a node from another map switches maps first", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openMap(page, "Scratch (0)");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  await openPalette(page);
  await page.locator(".palette__input").fill("invalidation");
  const row = rowFor(page, "Invalidation is forever");
  // From here it lives elsewhere, and the row says where.
  await expect(row.locator(".palette__meta")).toContainText("Caching");

  await page.keyboard.press("Enter");

  // The jump has to survive the map switch: the node does not exist on this
  // canvas until the new graph has loaded.
  await expect(page.locator(".toolbar__map")).toHaveValue(/.+/);
  await expect(page.locator(".node.is-selected")).toContainText("Invalidation is forever", {
    timeout: 10_000,
  });
  // Switching maps, not copying the node in.
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("Option-Enter inserts under the selected node", async ({ page, dm }) => {
  // A second map holding something to pull in.
  dm.cli("node", "add", "--map", "Scratch", "--type", "idea", "--title", "Write-behind caching");

  await openCanvas(page, dm);
  // The CLI write makes Scratch the most recently touched map, and the canvas
  // opens the newest one, so name the map this test is about.
  await openMap(page, "Caching (4)");
  await selectNode(page, "caching strategy");

  await openPalette(page);
  await page.locator(".palette__input").fill("write-behind");
  await expect(rowFor(page, "Write-behind caching")).toBeVisible();
  // The hint names the parent, so the chord's effect is stated before it fires.
  await expect(page.locator(".palette__hint")).toContainText("caching strategy");

  await page.keyboard.press("Alt+Enter");

  await expect(page.locator(".node", { hasText: "Write-behind caching" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  // Linked, not just dropped on the canvas: an Idea answering a Question.
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator(".toast")).toContainText("under");
});

test("one undo reverses the insert and its link together", async ({ page, dm }) => {
  dm.cli("node", "add", "--map", "Scratch", "--type", "idea", "--title", "Write-behind caching");
  await openCanvas(page, dm);
  await openMap(page, "Caching (4)");
  await selectNode(page, "caching strategy");

  await openPalette(page);
  await page.locator(".palette__input").fill("write-behind");
  await expect(rowFor(page, "Write-behind caching")).toBeVisible();
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  // Two API calls would leave two journal entries, so this would undo the link
  // and strand the node.
  await clickEmptyCanvas(page);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
});

test("the Insert button does the same thing as the chord", async ({ page, dm }) => {
  dm.cli("node", "add", "--map", "Scratch", "--type", "idea", "--title", "Write-behind caching");
  await openCanvas(page, dm);
  await openMap(page, "Caching (4)");
  await selectNode(page, "caching strategy");

  await openPalette(page);
  await page.locator(".palette__input").fill("write-behind");
  // A modifier chord nobody can see is not a feature on its own.
  await rowFor(page, "Write-behind caching").locator(".palette__insert").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
});

test("inserting under an illegal parent explains instead of failing", async ({
  page,
  dm,
}) => {
  // An Idea cannot answer an Idea, so this pairing is rejected by the grammar.
  dm.cli("node", "add", "--map", "Scratch", "--type", "idea", "--title", "Write-behind caching");
  await openCanvas(page, dm);
  await openMap(page, "Caching (4)");
  await selectNode(page, "Add a read-through cache");

  await openPalette(page);
  await page.locator(".palette__input").fill("write-behind");
  await rowFor(page, "Write-behind caching").locator(".palette__insert").click();

  await expect(page.locator(".toast")).toBeVisible();
  // Nothing half-done: the node must not land on the map without its link.
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("clicking a row goes to it rather than inserting it", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPalette(page);
  await page.locator(".palette__input").fill("invalidation");
  await rowFor(page, "Invalidation is forever").click();

  await expect(page.locator(".palette")).toHaveCount(0);
  await expect(page.locator(".node.is-selected")).toContainText("Invalidation is forever");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});
