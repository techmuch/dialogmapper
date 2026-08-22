import { devices, type Browser, type Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * Jumping to somebody, and following them.
 *
 * A facilitator driving the canvas needs to see where a participant is looking
 * without hunting for it, and sometimes needs to be carried along as they move.
 * Both are read from the same presence roster, so following works whether the
 * other person is on a canvas or tapping rows on a phone.
 */

async function secondCanvas(browser: Browser, dm: DialogMapper): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openCanvas(page, dm);
  return page;
}

async function phone(browser: Browser, dm: DialogMapper): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });
  // `networkidle` says the document loaded, not that the app rendered or that
  // its socket joined. Waiting for a row is the cheap proxy for both, and
  // without it these tests are a race under parallel workers.
  await page.locator(".m-row").first().waitFor();
  return page;
}

/** The dot for the participant that is not this tab. */
const otherDot = (page: Page) => page.locator(".who__dot:not(.who__me)").first();

/** Where the viewport is centred, in flow coordinates. */
async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement;
    const box = (document.querySelector(".canvas") as HTMLElement).getBoundingClientRect();
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
      vp.style.transform,
    )!;
    const [tx, ty, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { x: (box.width / 2 - tx) / k, y: (box.height / 2 - ty) / k };
  });
}

/** Distance from the viewport centre to a node's centre, in flow units. */
async function distanceToNode(page: Page, title: string): Promise<number> {
  const centre = await viewportCentre(page);
  const node = await page.evaluate((t) => {
    const el = [...document.querySelectorAll(".react-flow__node")].find((n) =>
      n.textContent?.includes(t),
    ) as HTMLElement | undefined;
    if (!el) return null;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)!;
    return {
      x: Number(m[1]) + el.offsetWidth / 2,
      y: Number(m[2]) + el.offsetHeight / 2,
    };
  }, title);
  if (!node) throw new Error(`no node matching ${title}`);
  return Math.hypot(node.x - centre.x, node.y - centre.y);
}

test("clicking a participant jumps to what they have selected", async ({
  page,
  browser,
  dm,
}) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  const before = await distanceToNode(page, "Invalidation is forever");
  await otherDot(page).click();
  await page.waitForTimeout(600);
  const after = await distanceToNode(page, "Invalidation is forever");

  expect(after).toBeLessThan(before);
  expect(after).toBeLessThan(5); // centred, not merely nearer
  await other.close();
});

test("jumping does not change the zoom", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  const zoom = async () => {
    const style = (await page.locator(".react-flow__viewport").getAttribute("style")) ?? "";
    return Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? 1);
  };
  const before = await zoom();
  await otherDot(page).click();
  await page.waitForTimeout(600);
  expect(await zoom()).toBeCloseTo(before, 3);
  await other.close();
});

test("clicking somebody with nothing selected says so", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await otherDot(page).click();
  await expect(page.locator(".toast")).toContainText("nothing selected");
  await other.close();
});

/**
 * The point of following: you are carried along as they move, without clicking
 * again.
 */
test("double-clicking follows them as they move", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });
  await otherDot(page).dblclick();
  await expect(page.locator(".following")).toContainText("Following");

  // They move; this tab follows without any further interaction.
  await selectNode(other, "Cuts p99 to 200ms");
  await expect
    .poll(async () => distanceToNode(page, "Cuts p99 to 200ms"), { timeout: 10_000 })
    .toBeLessThan(5);
  await other.close();
});

test("following a phone works too", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const handset = await phone(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await handset.locator(".m-row", { hasText: "Invalidation is forever" }).first().click();
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });
  await otherDot(page).dblclick();

  // A tap on the phone is its selection, so the canvas is carried to it.
  await handset.locator(".m-row", { hasText: "Cuts p99 to 200ms" }).first().click();
  await expect
    .poll(async () => distanceToNode(page, "Cuts p99 to 200ms"), { timeout: 10_000 })
    .toBeLessThan(5);
  await handset.close();
});

test("clicking the dot again stops following", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  await otherDot(page).dblclick();
  await expect(page.locator(".following")).toBeVisible();
  await otherDot(page).click();
  await expect(page.locator(".following")).toHaveCount(0);
  await other.close();
});

test("Escape stops following", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  await otherDot(page).dblclick();
  await expect(page.locator(".following")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".following")).toHaveCount(0);
  await other.close();
});

/**
 * Touching the map means "I have taken over". Panning to look around does not,
 * which is why this is a click rather than any viewport change.
 */
test("clicking the canvas stops following", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  await otherDot(page).dblclick();
  await expect(page.locator(".following")).toBeVisible();

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 300 } });
  await expect(page.locator(".following")).toHaveCount(0);
  await other.close();
});

test("following ends when they leave", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });
  await selectNode(other, "Invalidation is forever");
  await expect(page.locator(".node.is-watched")).toHaveCount(1, { timeout: 10_000 });

  await otherDot(page).dblclick();
  await expect(page.locator(".following")).toBeVisible();

  // A banner naming somebody who is not here would be a mode with no way out.
  await other.close();
  await expect(page.locator(".following")).toHaveCount(0, { timeout: 10_000 });
});

test("your own dot does nothing", async ({ page, browser, dm }) => {
  await openCanvas(page, dm);
  const other = await secondCanvas(browser, dm);
  await expect(page.locator(".who__dot")).toHaveCount(2, { timeout: 10_000 });

  await page.locator(".who__me").dblclick();
  await expect(page.locator(".following")).toHaveCount(0);
  await other.close();
});
