import type { Page } from "@playwright/test";
import { expect, openCanvas, test, type DialogMapper } from "../fixtures";

/**
 * Canvas filters.
 *
 * The previous version could not exclude anything: every match was expanded by
 * one hop in each direction, which pulled back in whatever had just been
 * filtered out. "Open questions" also meant nothing more than "a Question or
 * Idea whose status is open", so a question the group had already decided
 * stayed on screen alongside everything else.
 *
 * Filtering fades rather than hides, so these assertions are about which nodes
 * carry `is-dimmed`, not about which exist.
 */

const node = (page: Page, text: string) =>
  page.locator(".react-flow__node .node", { hasText: text }).first();

/** Titles of the nodes still lit under the current filter. */
async function lit(page: Page): Promise<string[]> {
  return (
    await page.$$eval(".react-flow__node .node", (els) =>
      els
        .filter((e) => !e.className.includes("is-dimmed"))
        .map((e) => e.textContent?.trim() ?? ""),
    )
  ).sort();
}

/** Marks a node resolved through the API, the way the sidebar would. */
async function setStatus(page: Page, dm: DialogMapper, title: string, status: string) {
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const map = maps.maps[0];
  const graph = await (await page.request.get(`${dm.url}/api/maps/${map.id}/graph`)).json();
  const target = graph.nodes.find((n: { title: string }) => n.title.includes(title));
  await page.request.patch(`${dm.url}/api/nodes/${target.id}`, { data: { status } });
}

test("everything is shown until a filter is chosen", async ({ page, dm }) => {
  await openCanvas(page, dm);
  expect(await lit(page)).toHaveLength(4);
  await expect(page.locator(".canvas__filter-note")).toHaveCount(0);
});

/**
 * The rule that gives the preset its meaning: an Idea marked resolved is a
 * decision, so the question above it is settled and drops out along with the
 * argument that produced it.
 */
test("resolving an answer settles its question and hides the branch", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  await page.click('button:has-text("Open questions")');

  // Nothing is decided yet, so the whole map is still live.
  expect(await lit(page)).toHaveLength(4);

  await setStatus(page, dm, "Add a read-through cache", "resolved");
  // Wait for the change to arrive over the WebSocket.
  await expect(node(page, "Add a read-through cache")).toHaveClass(/is-dimmed/, {
    timeout: 10_000,
  });

  // The question, its answers and their arguments all go: this discussion is
  // finished, which is the entire point of the filter.
  expect(await lit(page)).toEqual([]);
});

test("a rejected answer does not settle the question", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.click('button:has-text("Open questions")');

  // Declining an idea leaves the issue open — the group still has to decide.
  await setStatus(page, dm, "Add a read-through cache", "rejected");
  await page.waitForTimeout(600);
  expect(await lit(page)).toHaveLength(4);
});

/**
 * A text match returns the nodes containing the text and nothing else. The old
 * behaviour added one hop of neighbours, so searching for a parent lit its
 * whole neighbourhood.
 */
test("a text filter matches nodes, not their children", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.fill(".toolbar__search", "read-through");

  await expect(page.locator(".canvas__filter-note")).toContainText("1 of 4");
  expect(await lit(page)).toEqual(["!IdeaAdd a read-through cache"]);
});

test("the filter clears back to everything", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await page.fill(".toolbar__search", "read-through");
  await expect(page.locator(".canvas__filter-note")).toBeVisible();

  await page.click(".canvas__filter-note");
  expect(await lit(page)).toHaveLength(4);
  await expect(page.locator(".toolbar__search")).toHaveValue("");
});

test("status chips narrow the map on their own", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await setStatus(page, dm, "Cuts p99", "parked");
  await page.waitForTimeout(600);

  // Turning a status off removes exactly the nodes carrying it.
  await page.click(".status-toggle--parked");
  await expect(node(page, "Cuts p99")).toHaveClass(/is-dimmed/);
  expect(await lit(page)).toHaveLength(3);
});

test("the presets and type toggles that did nothing are gone", async ({ page, dm }) => {
  await openCanvas(page, dm);

  // "Unresolved" was a status filter wearing a preset's clothes and "Shared"
  // asked about bookkeeping rather than about the discussion.
  await expect(page.locator('.toolbar button:has-text("Unresolved")')).toHaveCount(0);
  await expect(page.locator('.toolbar button:has-text("Shared")')).toHaveCount(0);
  await expect(page.locator(".type-toggle")).toHaveCount(0);

  // What replaced them is real UI, not state nothing renders.
  await expect(page.locator(".status-toggle")).toHaveCount(4);
});
