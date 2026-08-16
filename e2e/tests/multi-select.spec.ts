import type { Page } from "@playwright/test";
import { expect, openCanvas, selectNode, test, type DialogMapper } from "../fixtures";

/**
 * The details panel when more than one node is selected.
 *
 * The behaviour that matters is the distinction between "all of these have it"
 * and "only some do". Collapsing the two would make the controls lie: a tag on
 * one node of three would look the same as a tag on all three, so removing it
 * would appear to do nothing.
 *
 * Setup and per-node verification go through the API rather than by clicking
 * each card. That is not avoidance — it is the honest check (the server is
 * where the tags actually live) and it keeps the tests independent of where
 * auto-layout happens to put a node, which otherwise lands some of them under
 * the minimap.
 */

const MEMBERS = ["Add a read-through cache", "Cuts p99 to 200ms", "Invalidation is forever"];

interface ApiNode {
  id: string;
  title: string;
  content: { tags: string[]; status: string };
}

async function graphNodes(page: Page, dm: DialogMapper): Promise<ApiNode[]> {
  const maps = await (await page.request.get(`${dm.url}/api/maps`)).json();
  const map = maps.maps.find((m: { name: string }) => m.name === "Caching") ?? maps.maps[0];
  const graph = await (await page.request.get(`${dm.url}/api/maps/${map.id}/graph`)).json();
  return graph.nodes;
}

async function nodeByTitle(page: Page, dm: DialogMapper, title: string): Promise<ApiNode> {
  const nodes = await graphNodes(page, dm);
  const found = nodes.find((n) => n.title === title);
  expect(found, `no node titled ${title}`).toBeTruthy();
  return found!;
}

/** Puts one node in a different state, so the selection is genuinely mixed. */
async function patchNode(
  page: Page,
  dm: DialogMapper,
  title: string,
  patch: Record<string, unknown>,
) {
  const node = await nodeByTitle(page, dm, title);
  const res = await page.request.patch(`${dm.url}/api/nodes/${node.id}`, { data: patch });
  expect(res.ok()).toBe(true);
}

async function selectNodes(page: Page, titles: string[]) {
  await selectNode(page, titles[0]);
  for (const title of titles.slice(1)) {
    await page.locator(".node", { hasText: title }).first().click({ modifiers: ["Shift"] });
  }
  await expect(page.locator(".node.is-selected")).toHaveCount(titles.length);
}

async function openPanel(page: Page, titles: string[]) {
  await selectNodes(page, titles);
  if ((await page.locator(".sidebar").count()) === 0) await page.keyboard.press("Tab");
  await expect(page.locator(".sidebar")).toBeVisible();
}

test("the panel switches to a selection summary", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPanel(page, MEMBERS);

  await expect(page.locator(".sidebar__head h2")).toHaveText("3 nodes selected");
  // Title and body have no meaning across a set, so they must not appear.
  await expect(page.locator(".sidebar textarea")).toHaveCount(0);
  await expect(page.locator(".chip--static")).toContainText(["Idea", "Pro", "Con"]);
});

test("one node still shows the full single-node editor", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await selectNode(page, MEMBERS[0]);
  if ((await page.locator(".sidebar").count()) === 0) await page.keyboard.press("Tab");

  await expect(page.locator(".sidebar__head h2")).not.toHaveText(/nodes selected/);
  await expect(page.locator(".sidebar textarea").first()).toBeVisible();
});

test("adding a tag applies it to every selected node", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPanel(page, MEMBERS);

  const input = page.locator(".sidebar input.field__input");
  await input.fill("cache");
  await input.press("Enter");

  // Solid rather than faded: it is now on all three.
  await expect(page.locator(".chip--tag", { hasText: "cache" })).toHaveClass(/is-all/);

  const nodes = await graphNodes(page, dm);
  for (const title of MEMBERS) {
    const n = nodes.find((x) => x.title === title)!;
    expect(n.content.tags, `${title} did not get the tag`).toContain("cache");
  }
});

test("a tag on only some of the selection is faded and counted", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await patchNode(page, dm, MEMBERS[0], { tags: ["partial"] });
  await page.reload({ waitUntil: "networkidle" });
  await openPanel(page, MEMBERS);

  const chip = page.locator(".chip--tag", { hasText: "partial" });
  await expect(chip).toHaveClass(/is-some/);
  // "on 1 of 3" is exactly what a flat list hides.
  await expect(chip.locator(".chip__count")).toHaveText("1/3");
});

test("clicking a faded tag brings the rest of the selection up to it", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  await patchNode(page, dm, MEMBERS[0], { tags: ["partial"] });
  await page.reload({ waitUntil: "networkidle" });
  await openPanel(page, MEMBERS);

  const chip = page.locator(".chip--tag", { hasText: "partial" });
  await expect(chip).toHaveClass(/is-some/);
  // The fade is an affordance, not a dead end: clicking still acts on all.
  await chip.locator(".chip__text").click();
  await expect(chip).toHaveClass(/is-all/);

  const nodes = await graphNodes(page, dm);
  for (const title of MEMBERS) {
    expect(nodes.find((x) => x.title === title)!.content.tags).toContain("partial");
  }
});

test("clicking a solid tag removes it from the whole selection", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPanel(page, MEMBERS);

  const input = page.locator(".sidebar input.field__input");
  await input.fill("temporary");
  await input.press("Enter");
  const chip = page.locator(".chip--tag", { hasText: "temporary" });
  await expect(chip).toHaveClass(/is-all/);

  await chip.locator(".chip__text").click();
  await expect(page.locator(".chip--tag", { hasText: "temporary" })).toHaveCount(0);

  const nodes = await graphNodes(page, dm);
  for (const title of MEMBERS) {
    expect(nodes.find((x) => x.title === title)!.content.tags).not.toContain("temporary");
  }
});

test("status shows which values are present, and sets all on click", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm);
  await patchNode(page, dm, MEMBERS[0], { status: "resolved" });
  await page.reload({ waitUntil: "networkidle" });
  await openPanel(page, MEMBERS);

  // Two of three open, one resolved: both partial, neither solid. Showing a
  // single value here would misrepresent the selection.
  await expect(page.locator(".chip--tri", { hasText: "open" })).toHaveClass(/is-some/);
  await expect(page.locator(".chip--tri", { hasText: "resolved" })).toHaveClass(/is-some/);

  await page.locator(".chip--tri", { hasText: "parked" }).click();
  await expect(page.locator(".chip--tri", { hasText: "parked" })).toHaveClass(/is-all/);
  await expect(page.locator(".chip--tri", { hasText: "open" })).toHaveClass(/is-none/);

  const nodes = await graphNodes(page, dm);
  for (const title of MEMBERS) {
    expect(nodes.find((x) => x.title === title)!.content.status).toBe("parked");
  }
});

/** A bulk edit is one thing the user did, so it is one thing to reverse. */
test("a bulk edit undoes in a single keystroke", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPanel(page, MEMBERS);

  const input = page.locator(".sidebar input.field__input");
  await input.fill("bulk");
  await input.press("Enter");
  await expect(page.locator(".chip--tag", { hasText: "bulk" })).toHaveClass(/is-all/);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".chip--tag", { hasText: "bulk" })).toHaveCount(0);

  // One press, and it is gone from all three — not one node per press.
  const nodes = await graphNodes(page, dm);
  for (const title of MEMBERS) {
    expect(nodes.find((x) => x.title === title)!.content.tags).not.toContain("bulk");
  }
});

test("a mixed tag undoes back to exactly who had it", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await patchNode(page, dm, MEMBERS[0], { tags: ["partial"] });
  await page.reload({ waitUntil: "networkidle" });
  await openPanel(page, MEMBERS);

  await page.locator(".chip--tag", { hasText: "partial" }).locator(".chip__text").click();
  await expect(page.locator(".chip--tag", { hasText: "partial" })).toHaveClass(/is-all/);

  await page.keyboard.press("Control+z");

  // Back to one of three, not none of three: undo restores each node's own
  // prior state rather than a single shared one.
  const nodes = await graphNodes(page, dm);
  const withTag = nodes.filter((n) => n.content.tags.includes("partial"));
  expect(withTag.map((n) => n.title)).toEqual([MEMBERS[0]]);
});

test("the panel offers grouping for the selection", async ({ page, dm }) => {
  await openCanvas(page, dm);
  await openPanel(page, MEMBERS);

  await page.locator(".sidebar .btn", { hasText: "Group these 3 nodes" }).click();
  await expect(page.locator(".group")).toHaveCount(1);
  await expect(page.locator(".group__count")).toHaveText("3");
});
