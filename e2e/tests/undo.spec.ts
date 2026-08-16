import { expect, openCanvas, selectNode, test, typeTitle } from "../fixtures";

/**
 * Undo, from the keyboard, against a map that something else built.
 *
 * The Go tests cover the journal thoroughly. What they cannot see is whether
 * the browser reaches it: whether Ctrl+Z is intercepted before the browser's
 * own text undo, whether the toolbar reflects a history the server owns, and
 * whether a map seeded by the CLI leaves this tab with a clean slate.
 */

const undoBtn = ".toolbar__undo button:first-child";
const redoBtn = ".toolbar__undo button:last-child";

test("a CLI-seeded map leaves this tab with nothing to undo", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // Regression: opening a seeded map auto-places nodes that have no
  // coordinates, and those writes were being journalled as user actions. The
  // undo button lit up before the user had touched anything, and the first
  // Ctrl+Z reversed a layout decision instead of an edit.
  await expect(page.locator(undoBtn)).toBeDisabled();
  await expect(page.locator(redoBtn)).toBeDisabled();
});

test("Ctrl+Z removes what was just added and says what it removed", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await typeTitle(page, "Is invalidation solvable?");
  await expect(page.locator(".node")).toHaveCount(before + 1);

  // The button names the action it would reverse, which is how the user knows
  // whether it is the one they meant.
  await expect(page.locator(undoBtn)).toBeEnabled();
  await expect(page.locator(undoBtn)).toHaveAttribute(
    "title",
    /Is invalidation solvable\?/,
  );

  await page.keyboard.press("Control+z");

  await expect(page.locator(".node")).toHaveCount(before);
  await expect(page.locator(".toast")).toContainText("Is invalidation solvable?");
});

test("Ctrl+Shift+Z puts it back", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await typeTitle(page, "Reversible?");

  await page.keyboard.press("Control+z");
  await expect(page.locator(".node")).toHaveCount(before);

  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".node")).toHaveCount(before + 1);
  await expect(page.locator(".node", { hasText: "Reversible?" })).toBeVisible();
});

test("Ctrl+Z inside the title editor undoes the graph, not the text field", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await expect(page.locator(".node__input")).toBeFocused();
  await page.keyboard.type("Half-typed thought");

  // Without an explicit intercept the browser's own text undo swallows this,
  // and undo appears broken to the user.
  await page.keyboard.press("Control+z");

  await expect(page.locator(".node")).toHaveCount(before);
});

test("creating and titling a node is one undo, not one per character", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  // The capture loop's actual shape: press `q`, type, commit. That is one act
  // of authorship even though it writes a node and then an edit, so one
  // Ctrl+Z must take the whole thing — not leave an untitled node behind, and
  // not need one press per character.
  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await typeTitle(page, "A fairly long question title");
  await expect(
    page.locator(".node", { hasText: "A fairly long question title" }),
  ).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.locator(".node")).toHaveCount(before);
});

test("undo survives a page reload because the history is server-side", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await typeTitle(page, "Persisted across reload");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".node")).toHaveCount(before + 1);

  // A browser-side stack would have been wiped by the reload.
  await expect(page.locator(undoBtn)).toBeEnabled();
  await page.locator(undoBtn).click();
  await expect(page.locator(".node")).toHaveCount(before);
});

test("undo restores a deleted node together with its arguments", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const nodesBefore = await page.locator(".node").count();
  const edgesBefore = await page.locator(".react-flow__edge").count();

  // Removing the Idea takes the Pro and Con edges with it. An undo that
  // restored a bare node would silently destroy the argument around it.
  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".node")).toHaveCount(nodesBefore - 1);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".node")).toHaveCount(nodesBefore);
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgesBefore);
});
