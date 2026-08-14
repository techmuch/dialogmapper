import { expect, leaveEditor, openCanvas, selectNode, test, typeTitle } from "../fixtures";

/**
 * The capture loop is the product's core claim: a facilitator types while
 * people talk, and a keystroke never needs a mouse correction afterwards.
 *
 * That claim is entirely about focus handoff between keystrokes, which is
 * invisible to any test that does not drive a real keyboard against a real
 * DOM.
 */

test("q creates a Question attached to the selection, in edit mode", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");

  await expect(page.locator(".node")).toHaveCount(before + 1);
  // Creating a node must drop straight into typing; otherwise the next thing
  // said in the room is lost while the user reaches for the mouse.
  await expect(page.locator(".node__input")).toBeFocused();
});

test("Enter commits the title and keeps the node selected", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, "Add a read-through cache");

  await page.keyboard.press("q");
  await typeTitle(page, "Does the cache ever go stale?");

  // The editor closes...
  await expect(page.locator(".node__input")).toHaveCount(0);
  const created = page.locator(".node", { hasText: "Does the cache ever go stale?" });
  await expect(created).toBeVisible();
  // ...but the node stays selected, which is what lets the next keystroke
  // continue the same thought.
  await expect(created).toHaveClass(/is-selected/);
});

test("the selection handoff lets q then + chain without the mouse", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  // A whole exchange typed without touching the pointer.
  await selectNode(page, "What should we do about caching strategy?");
  await page.keyboard.press("i");
  await typeTitle(page, "Cache at the edge");
  await page.keyboard.press("+");
  await typeTitle(page, "Cuts origin traffic");
  await page.keyboard.press("-");
  await typeTitle(page, "Another vendor to manage");

  await expect(page.locator(".node")).toHaveCount(before + 3);
  await expect(page.locator(".node--pro", { hasText: "Cuts origin traffic" })).toBeVisible();
  await expect(
    page.locator(".node--con", { hasText: "Another vendor to manage" }),
  ).toBeVisible();
});

test("+ on a Question attaches to its latest Idea rather than failing", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);

  // IBIS forbids a Pro supporting a Question. Erroring mid-sentence would cost
  // more than a sensible guess, so the key walks to the Question's newest Idea.
  await selectNode(page, "What should we do about caching strategy?");
  await page.keyboard.press("+");
  await typeTitle(page, "Reuses work we already did");

  await expect(
    page.locator(".node--pro", { hasText: "Reuses work we already did" }),
  ).toBeVisible();
  // And no error was raised at the user.
  await expect(page.locator(".toast--error")).toHaveCount(0);
});

test("Escape leaves the editor without saving", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  await expect(page.locator(".node__input")).toBeFocused();
  await page.keyboard.type("throwaway text");
  await leaveEditor(page);

  await expect(page.locator(".node", { hasText: "throwaway text" })).toHaveCount(0);
});

test("arrow keys move the selection to the nearest node in that direction", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);

  // Layout is question above idea above its arguments, so Down from the root
  // question must land on the idea.
  await selectNode(page, "What should we do about caching strategy?");
  await page.keyboard.press("ArrowDown");

  await expect(
    page.locator(".node.is-selected", { hasText: "Add a read-through cache" }),
  ).toBeVisible();
});

test("typing in a node does not trigger canvas shortcuts", async ({ page, dm }) => {
  await openCanvas(page, dm);
  const before = await page.locator(".node").count();

  await selectNode(page, "Add a read-through cache");
  await page.keyboard.press("q");
  // Every one of these characters is also a canvas shortcut. Inside the
  // editor they must be text.
  await typeTitle(page, "q i n + - f l");

  await expect(page.locator(".node")).toHaveCount(before + 1);
  await expect(page.locator(".node", { hasText: "q i n + - f l" })).toBeVisible();
});
