import { defineConfig, devices } from "@playwright/test";

/**
 * These tests exist because three real bugs shipped that every Go test passed
 * through: a blank page (the frontend's own JS was shadowed by a route), an
 * empty minimap (React Flow measurements were being discarded), and a group
 * rubber band drawn in the wrong coordinate space. None are visible without a
 * browser actually rendering the app.
 *
 * There is no `webServer` here on purpose. Each test starts its own
 * dialogmapper process against a fresh temp project (see fixtures.ts), because
 * the interesting behaviour includes CLI-seeded state, per-client undo history
 * and network binding — none of which survive a single shared server.
 */
export default defineConfig({
  testDir: "./tests",
  // Servers are per-test and pick their own port, so parallelism is safe.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    viewport: { width: 1280, height: 760 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The canvas is a desktop surface; the mobile spec overrides this.
    ...devices["Desktop Chrome"],
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
