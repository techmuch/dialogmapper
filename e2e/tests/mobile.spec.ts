import { devices } from "@playwright/test";
import { expect, test } from "../fixtures";

/**
 * The mobile surface is a different product, not a shrunken canvas: a
 * participant sees a reverse-chronological feed and adds one thing to it.
 *
 * The device emulation is applied at the top level because `devices` sets
 * `defaultBrowserType`, which Playwright will not accept inside a describe
 * block — it would force a new worker mid-file.
 */
test.use({ ...devices["Pixel 7"] });

test("phones get the linear feed, not the canvas", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await expect(page.locator(".m-feed")).toBeVisible();
  // A pinch-zoom graph on a phone is unusable, so the canvas must not appear.
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await expect(page.locator(".m-row").first()).toBeVisible();
});

test("a mobile user agent at the root is redirected to the feed", async ({
  page,
  dm,
}) => {
  await page.goto(dm.url, { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/m");
});

test("the composer only offers moves that are legal for the tapped node", async ({
  page,
  dm,
}) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  // Tapping a Question: an Idea answers it, but a Pro cannot support it, so
  // the phone user cannot build an invalid map by accident.
  await page.locator(".m-row--question").first().click();
  const onQuestion = (await page.locator(".m-kind").allInnerTexts())
    .join(" ")
    .toLowerCase();
  expect(onQuestion).toContain("idea");
  expect(onQuestion).not.toContain("pro");

  // Tapping an Idea: now arguments are the sensible moves.
  await page.locator(".m-context button").click();
  await page.locator(".m-row--idea").first().click();
  const onIdea = (await page.locator(".m-kind").allInnerTexts()).join(" ").toLowerCase();
  expect(onIdea).toContain("pro");
  expect(onIdea).toContain("con");
});

test("a reply from the phone really reaches the graph", async ({ page, dm }) => {
  await page.goto(`${dm.url}/m`, { waitUntil: "networkidle" });

  await page.locator(".m-row--idea").first().click();
  await page.locator(".m-input").fill("Sent from a phone");
  await page.locator(".m-send").click();

  await expect(page.locator(".m-row", { hasText: "Sent from a phone" })).toBeVisible();

  // Confirmed against the server, not just the optimistic UI.
  const feed = await (await page.request.get(`${dm.url}/api/feed`)).json();
  expect(
    feed.nodes.some((n: { title: string }) => n.title === "Sent from a phone"),
  ).toBe(true);
});
