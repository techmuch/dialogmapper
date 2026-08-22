/**
 * Captures the screenshots used on the website by driving the real binary.
 *
 * Mockups drift. A hand-drawn "this is what the canvas looks like" is wrong the
 * first time a node style changes and nobody notices, so every screen on the
 * site is a photograph of the actual tool, taken from a map seeded here. Re-run
 * this after any UI change:
 *
 *   node website/scripts/screenshots.mjs
 *
 * Set DIALOGMAPPER_BIN to test an unreleased build; it defaults to the binary
 * in the repo root.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "assets", "shots");
const BIN = process.env.DIALOGMAPPER_BIN ?? join(HERE, "..", "..", "dialogmapper");

/**
 * The map every screenshot is taken from.
 *
 * A real decision with real disagreement in it. A demo map full of "Idea 1 /
 * Pro 1" teaches nothing about what the tool is for, and the whole argument for
 * IBIS is that structure helps when the content is genuinely contested.
 */
const SESSION = `# Should we move the team to a four-day week?

- Compress to four 9-hour days, same total hours
+ No drop in output to justify to the board #low-risk
! Nine-hour days are brutal for the people with school runs
! Client cover on Fridays disappears

- Cut to 32 hours with no pay change
+ Every trial we have read reports better retention #retention
+ Forces us to kill the meetings nobody values
! We would have to say no to some client work
! Hard to reverse if it does not work #risk

- Keep five days, cut meeting load instead
+ Costs nothing and we can start on Monday
! Does not address the thing people actually asked for

Which teams would struggle most with a shorter week?

> Support and client services carry fixed cover requirements; everyone else is deadline-driven.
`;

/** The idea the group commits to, so the map shows a decision and not just a debate. */
const DECISION = "Cut to 32 hours";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "dm-shots-"));
  const cli = (...args) => execFileSync(BIN, ["-C", dir, ...args], { encoding: "utf8" });

  cli("init", "--map", "Scratch");
  writeFileSync(join(dir, "session.md"), SESSION);
  cli("seed", "--context", join(dir, "session.md"), "--map", "Four-day week");

  const server = spawn(
    BIN,
    ["-C", dir, "start", "--host", "127.0.0.1", "--port", "0", "--no-qr"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DIALOGMAPPER_NO_UPDATE_CHECK: "1" } },
  );
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const done = setTimeout(() => reject(new Error(`server never printed a url:\n${out}`)), 15000);
    const read = (d) => {
      out += d.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
      if (m) {
        clearTimeout(done);
        resolve(m[0]);
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });

  // Mark the chosen idea resolved: an unresolved map cannot show what "settled"
  // looks like, and that distinction is most of the point of the tool.
  const maps = await (await fetch(`${url}/api/maps`)).json();
  const map = maps.maps.find((m) => m.name === "Four-day week");
  const graph = await (await fetch(`${url}/api/maps/${map.id}/graph`)).json();
  const chosen = graph.nodes.find((n) => n.title.startsWith(DECISION));
  await fetch(`${url}/api/nodes/${chosen.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  });

  const browser = await chromium.launch();
  const shot = async (name, page, opts = {}) => {
    await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
    console.log(`  ${name}.png`);
  };

  /**
   * Screenshots just the map, big enough to read.
   *
   * This map is about 4000px wide laid out, so fitView in a 1440px window
   * scales it to roughly a third and the node text becomes unreadable — while
   * the tree is only three levels deep, so most of the window is empty canvas
   * above and below it. Both problems have one cause: the window is the wrong
   * shape for the content.
   *
   * So: fit in a window wide enough that the type stays legible, then crop to
   * the nodes. The result is a real screenshot of a real canvas with the empty
   * space taken off the edges, which is what a reader wants to look at.
   */
  const shotGraph = async (name, page, pad = 32) => {
    const before = page.viewportSize();
    await page.setViewportSize({ width: 2600, height: 900 });
    await page.keyboard.press("Space"); // refit to the new shape
    await page.waitForTimeout(800);

    const box = await page.evaluate((padding) => {
      const rects = [...document.querySelectorAll(".react-flow__node")].map((n) =>
        n.getBoundingClientRect(),
      );
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((r) => r.left)) - padding;
      const top = Math.min(...rects.map((r) => r.top)) - padding;
      const right = Math.max(...rects.map((r) => r.right)) + padding;
      const bottom = Math.max(...rects.map((r) => r.bottom)) + padding;
      return {
        x: Math.max(0, Math.round(left)),
        y: Math.max(0, Math.round(top)),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
    }, pad);

    await shot(name, page, box ? { clip: box } : {});
    await page.setViewportSize(before);
    await page.waitForTimeout(300);
  };

  // --- the canvas, at a size that stays readable when scaled down on a page ---
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await desktop.newPage();
  await page.goto(`${url}/?map=${map.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".node");
  // The minimap would be sliced in half by the crop, and it is not what any of
  // these images is about.
  await page.click('button:has-text("Minimap on")');
  await page.waitForTimeout(900); // let auto-layout and the fit settle
  await shotGraph("canvas", page);

  /*
   * A readable close-up of one branch.
   *
   * The whole-map shot is about 4400px wide. Dropped into a page column it
   * renders at roughly a quarter size, which conveys the shape but makes every
   * word in it illegible — a poor thing to put at the top of a page, where the
   * reader is deciding whether any of this is real.
   *
   * So this one is taken at full zoom around the decided idea and its
   * arguments: the same canvas, close enough to read.
   */
  await page.locator(".node", { hasText: "Cut to 32 hours" }).first().click();
  await page.keyboard.press("Space"); // centre on the selection
  await page.waitForTimeout(700);
  {
    const wanted = [
      "Cut to 32 hours",
      "Every trial we have read",
      "Forces us to kill",
      "We would have to say no",
      "Hard to reverse",
    ];
    const box = await page.evaluate((titles) => {
      const rects = [...document.querySelectorAll(".react-flow__node")]
        .filter((n) => titles.some((t) => n.textContent?.includes(t)))
        .map((n) => n.getBoundingClientRect());
      if (rects.length === 0) return null;
      const pad = 36;
      const left = Math.max(0, Math.min(...rects.map((r) => r.left)) - pad);
      const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - pad);
      const right = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + pad);
      const bottom = Math.min(window.innerHeight, Math.max(...rects.map((r) => r.bottom)) + pad);
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
    }, wanted);
    await shot("branch", page, box ? { clip: box } : {});
  }

  // The details pane, showing tags, status and where else a node appears.
  await page.locator(".node", { hasText: "Cut to 32 hours" }).first().click();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(500);
  await shot("details", page);
  await page.keyboard.press("Tab");

  // The open-questions filter: the reason the map is useful a week later.
  await page.click('button:has-text("Open questions")');
  await page.waitForTimeout(600);
  await shotGraph("filter", page);
  await page.click('button:has-text("Everything")');

  // The palette, mid-search. Cropped to the dialog rather than the whole
  // screen, which is mostly canvas behind a dimming layer.
  await page.keyboard.press("/");
  await page.locator(".palette__input").fill("retention");
  await page.waitForTimeout(500);
  const dialog = await page.locator(".palette").boundingBox();
  await shot("palette", page, {
    clip: {
      x: Math.round(dialog.x - 24),
      y: Math.round(dialog.y - 24),
      width: Math.round(dialog.width + 48),
      height: Math.round(dialog.height + 48),
    },
  });
  await page.keyboard.press("Escape");

  // --- the phone view, which is how everyone but the facilitator joins ---
  const phone = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const mobile = await phone.newPage();
  await mobile.goto(`${url}/m`, { waitUntil: "networkidle" });
  await mobile.waitForSelector(".m-row");
  await mobile.waitForTimeout(600);
  await shot("phone", mobile);

  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  console.log(`\nwrote to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
