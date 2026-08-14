import { expect, openCanvas, SEEDED_NODES, test } from "../fixtures";

/**
 * The app actually renders.
 *
 * This is the test whose absence let a completely blank page ship. The Go
 * suite asserted that `GET /` returned 200 HTML — which it did. The script tag
 * inside that HTML pointed at `/assets/index-*.js`, and user media was mounted
 * at the same prefix, so the bundle 404'd. React never mounted, the body
 * background painted, and the result looked like a black screen with no
 * JavaScript error to chase.
 */
test("the canvas mounts and every asset loads", async ({ page, dm }) => {
  const watch = await openCanvas(page, dm);

  // An empty #root is exactly what the blank-page bug looked like.
  const rootSize = await page.locator("#root").evaluate((el) => el.innerHTML.length);
  expect(rootSize, "#root is empty — React did not mount").toBeGreaterThan(1000);

  await expect(page.locator(".node")).toHaveCount(SEEDED_NODES);
  watch.assertClean();
});

test("a missing asset is a real 404, not index.html", async ({ page, dm }) => {
  // Serving index.html for a missing script produces "Unexpected token '<'",
  // which is a baffling way to be told a file is absent.
  const res = await page.request.get(`${dm.url}/assets/does-not-exist.js`);
  expect(res.status()).toBe(404);
});

/**
 * The minimap draws the graph.
 *
 * It rendered as an empty box for a while: onNodesChange discarded every
 * change React Flow reported, including the `dimensions` measurements that the
 * minimap and fitView both read. The panel was present and correctly sized,
 * which is why nothing looked wrong until you looked inside it.
 */
test("the minimap renders one rect per node", async ({ page, dm }) => {
  await openCanvas(page, dm);

  const minimap = page.locator(".react-flow__minimap");
  await expect(minimap).toBeVisible();

  const rects = minimap.locator("svg rect");
  await expect(rects).toHaveCount(SEEDED_NODES);

  // Zero-sized rects mean the nodes were never measured — the same failure
  // wearing a different disguise.
  const sizes = await rects.evaluateAll((els) =>
    els.map((e) => ({
      w: Number(e.getAttribute("width")),
      h: Number(e.getAttribute("height")),
    })),
  );
  for (const { w, h } of sizes) {
    expect(w, "minimap rect has no width").toBeGreaterThan(0);
    expect(h, "minimap rect has no height").toBeGreaterThan(0);
  }
});

test("edges are labelled with their IBIS relationship", async ({ page, dm }) => {
  await openCanvas(page, dm);
  // An unlabelled arrow is the ambiguity this tool exists to remove, so the
  // labels are load-bearing rather than decoration.
  //
  // textContent, not innerText: these are SVG <text> nodes, and innerText is
  // an HTMLElement property that comes back undefined for them.
  const labels = await page.locator(".react-flow__edge-text").allTextContents();
  expect(labels.sort()).toEqual(["objects to", "responds to", "supports"]);
});
