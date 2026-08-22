/**
 * Loads every page of the built site and complains about what is broken.
 *
 * A documentation site fails quietly: a route that renders "page not found", an
 * image that 404s, a link to a guide that was renamed. None of it throws, so
 * none of it shows up in a build. This visits each route in a real browser and
 * checks what a reader would actually hit.
 *
 *   npm run build && node website/scripts/check.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

const ROUTES = [
  "/",
  "/walkthrough",
  "/start",
  "/how-to",
  "/how-to/workshop",
  "/how-to/from-notes",
  "/how-to/agents",
  "/how-to/reuse",
  "/how-to/fix-it",
  "/how-to/keep-it",
  "/ibis",
  "/reference",
];

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const problems = [];
const fail = (msg) => problems.push(msg);

const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on("pageerror", (e) => fail(`js error: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400) fail(`${r.status()} for ${r.url().replace(base, "")}`);
});

const internal = new Set();

for (const [i, route] of ROUTES.entries()) {
  // The cache-busting query forces a real page load. Going from `#/start` to
  // `#/walkthrough` only changes the fragment, so `goto` returns immediately
  // without a navigation — and everything below would then run against the
  // previous page, or against a half-mounted new one. That made images look
  // broken that were fine.
  await page.goto(`${base}/index.html?n=${i}#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  // Images are lazy, so anything below the fold has not been asked for yet.
  // Scroll the whole page and *stay* at the bottom: rushing back to the top
  // pulls the images out of view before the browser has begun fetching them,
  // and they then report as broken when they are perfectly fine.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  // networkidle fires before the lazy images have finished decoding, so wait on
  // the thing actually being asserted rather than on a proxy for it.
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout: 5000,
    })
    .catch(() => {});

  const h1 = await page.locator("h1").first().textContent();
  if (!h1?.trim()) fail(`${route}: no heading`);
  if (/does not exist|not found/i.test(h1 ?? "")) fail(`${route}: renders the 404 page`);

  // Images must actually have pixels; a broken <img> still lays out.
  const broken = await page.$$eval("img", (imgs) =>
    imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")),
  );
  broken.forEach((src) => fail(`${route}: image did not load — ${src}`));

  // Every link should have somewhere to go.
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  for (const href of hrefs) {
    if (href.startsWith("#/")) internal.add(href.slice(1));
    else if (href.startsWith("#") && href !== "#main") {
      const id = href.slice(1);
      const exists = await page.locator(`#${CSS.escape ? id : id}`).count().catch(() => 0);
      if (!exists) fail(`${route}: anchor ${href} has no target`);
    }
  }

  // Nothing should spill sideways on a phone...
  await page.setViewportSize({ width: 380, height: 800 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 2) fail(`${route}: ${overflow}px of horizontal overflow at 380px wide`);

  // ...and the navigation must stay inside the header.
  //
  // Measuring the header's own height does not work: it has a fixed height, so
  // when the links wrap they spill *out* of the box and over the page while the
  // element still reports 60px. Comparing the nav's bottom edge against the
  // header's is what actually detects it.
  const spill = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    const nav = document.querySelector(".site-nav");
    if (!header || !nav) return 0;
    return Math.round(nav.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom);
  });
  if (spill > 2) fail(`${route}: navigation overflows the header by ${spill}px at 380px wide`);

  await page.setViewportSize({ width: 1280, height: 900 });
}

// Every internal link target must be a route we know renders.
for (const to of internal) {
  if (!ROUTES.includes(to)) fail(`link to ${to}, which is not a known route`);
}

await browser.close();
server.close();

if (problems.length === 0) {
  console.log(`checked ${ROUTES.length} pages and ${internal.size} internal links — all good`);
} else {
  console.error(`${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
