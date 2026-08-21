import { test as base, expect, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/** The binary under test. `make test-e2e` builds it first. */
export const BINARY =
  process.env.DIALOGMAPPER_BIN ?? resolve(here, "..", "dialogmapper");

/**
 * The document every test's map is seeded from.
 *
 * Seeding through the CLI rather than clicking the graph together is
 * deliberate: it is faster, it is deterministic, and it exercises the state a
 * real user arrives at — a map built by something other than this browser tab,
 * which is precisely the situation that broke undo attribution and auto-layout
 * placement.
 *
 * Produces exactly 4 nodes and 3 edges.
 */
export const SEED_DOC = `# Caching strategy

- Add a read-through cache
+ Cuts p99 to 200ms
! Invalidation is forever
`;

export const SEEDED_NODES = 4;
export const SEEDED_EDGES = 3;

export interface DialogMapper {
  /** Base URL of the running server, e.g. http://127.0.0.1:53412 */
  url: string;
  /** The temp project directory holding maps.db and .assets/ */
  dir: string;
  /** Run a dialogmapper subcommand against this project and return stdout. */
  cli(...args: string[]): string;
  /** Everything the server has written to stdout so far. */
  output(): string;
}

interface Options {
  /**
   * Interface to bind. Loopback by default so tests are deterministic and
   * exempt from the LAN access key; the QR spec overrides it because a
   * network-reachable server is the whole point of that feature.
   */
  dmHost: string;
  /** Seed the map before starting the server. */
  dmSeed: boolean;
}

export const test = base.extend<Options & { dm: DialogMapper }>({
  dmHost: ["127.0.0.1", { option: true }],
  dmSeed: [true, { option: true }],

  dm: async ({ dmHost, dmSeed }, use, testInfo) => {
    if (!existsSync(BINARY)) {
      throw new Error(
        `dialogmapper binary not found at ${BINARY}.\n` +
          `Run \`make build\` first, or set DIALOGMAPPER_BIN.`,
      );
    }

    const dir = mkdtempSync(join(tmpdir(), "dm-e2e-"));
    const cli = (...args: string[]) =>
      execFileSync(BINARY, ["-C", dir, ...args], { encoding: "utf8" });

    cli("init", "--map", "Scratch");
    if (dmSeed) {
      const doc = join(dir, "seed.md");
      writeFileSync(doc, SEED_DOC);
      cli("seed", "--context", doc, "--map", "Caching");
    }

    // Port 0 lets the kernel pick, so parallel workers can never collide.
    // The real port is read back from the banner rather than guessed.
    // The update check is switched off for the whole suite. Every test spawns
    // its own server against a fresh database, so leaving it on would mean
    // ninety-odd requests to GitHub per run — enough to hit the 60-per-hour
    // unauthenticated limit and make the suite depend on the network. The off
    // switch itself is covered in update.spec.ts.
    const proc: ChildProcess = spawn(
      BINARY,
      ["-C", dir, "start", "--host", dmHost, "--port", "0", "--no-qr"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DIALOGMAPPER_NO_UPDATE_CHECK: "1" },
      },
    );

    let stdout = "";
    proc.stdout!.on("data", (d) => (stdout += d.toString()));
    proc.stderr!.on("data", (d) => (stdout += d.toString()));

    const url = await new Promise<string>((resolveUrl, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`server did not start in 10s:\n${stdout}`)),
        10_000,
      );
      const check = setInterval(() => {
        const m = stdout.match(/→ (http:\/\/\S+)/);
        if (m) {
          clearInterval(check);
          clearTimeout(timer);
          resolveUrl(m[1].trim());
        }
      }, 50);
      proc.on("exit", (code) => {
        clearInterval(check);
        clearTimeout(timer);
        reject(new Error(`server exited with ${code}:\n${stdout}`));
      });
    });

    await use({ url, dir, cli, output: () => stdout });

    // Attach the server log to failures; a browser symptom is often explained
    // by something the Go side printed.
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server output", { body: stdout, contentType: "text/plain" });
    }

    proc.kill("SIGTERM");
    await new Promise((r) => proc.on("exit", r));
    rmSync(dir, { recursive: true, force: true });
  },
});

export { expect };

/**
 * Opens the canvas and waits for it to be genuinely interactive.
 *
 * Also asserts that nothing failed to load. This is the check whose absence
 * let a completely blank app ship: the HTML was fine and only the script was
 * missing, so every server-side assertion passed.
 */
export async function openCanvas(page: Page, dm: DialogMapper) {
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    failures.push(`${r.url()} — ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(dm.url, { waitUntil: "networkidle" });
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".node").first()).toBeVisible();

  return {
    /** Fails the test if the page logged an error or a request 404'd. */
    assertClean() {
      expect(errors, "JavaScript errors on the page").toEqual([]);
      expect(failures, "failed or 4xx requests").toEqual([]);
    },
    errors,
    failures,
  };
}

/** Clicks a node by its visible title. */
export async function selectNode(page: Page, title: string) {
  const node = page.locator(".node", { hasText: title }).first();
  await node.click();
  await expect(node).toHaveClass(/is-selected/);
  return node;
}

/** Leaves the inline title editor without committing a change. */
export async function leaveEditor(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".node__input")).toHaveCount(0);
}

/**
 * Types a title into the open editor, then commits it with Enter.
 *
 * The wait for focus is not padding. React Flow hides a newly added node until
 * it has measured it, so the editor exists for a frame or two before it can
 * accept a caret. A human's reaction time after pressing `q` covers that;
 * Playwright types with no delay at all and would otherwise race it.
 *
 * That the focus arrives at all, and quickly, is asserted separately in
 * capture-loop.spec.ts — this helper depends on it rather than hiding it.
 */
export async function typeTitle(page: Page, text: string) {
  await expect(page.locator(".node__input")).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(page.locator(".node__input")).toHaveCount(0);
}
