import jsQR from "jsqr";
import { PNG } from "pngjs";
import { expect, openCanvas, test } from "../fixtures";

/**
 * Joining a phone by scanning.
 *
 * The QR is the one artefact here that is only correct if a camera can read
 * it, so this decodes the actual PNG rather than checking that an <img>
 * appeared. Two ways it breaks silently: encoding `localhost`, which sends the
 * phone to itself, and producing a code that looks fine but does not scan.
 */

test.describe("network-reachable server", () => {
  // Being reachable is the feature under test, so this overrides the loopback
  // default the rest of the suite uses.
  test.use({ dmHost: "0.0.0.0" });

  test("the help panel QR decodes to the phone URL", async ({ page, dm }) => {
    await openCanvas(page, dm);

    const advertised = await (await page.request.get(`${dm.url}/api/mobile`)).json();
    test.skip(!advertised.reachable, "no LAN address in this environment");

    // localhost is right for this browser and useless to a phone — exactly the
    // failure this endpoint exists to prevent.
    expect(advertised.url).not.toContain("localhost");
    expect(advertised.url).not.toContain("127.0.0.1");
    expect(advertised.url).toContain("/m");

    await page.keyboard.press("?");
    const img = page.locator(".qr__code");
    await expect(img).toBeVisible();

    // A broken <img> still has a bounding box; naturalWidth is the honest test.
    const natural = await img.evaluate((e) => (e as HTMLImageElement).naturalWidth);
    expect(natural, "the QR image failed to load").toBeGreaterThan(0);

    const res = await page.request.get(`${dm.url}/api/qr.png?size=400`);
    expect(res.headers()["content-type"]).toBe("image/png");

    const png = PNG.sync.read(Buffer.from(await res.body()));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded, "a scanner could not decode the QR").not.toBeNull();
    expect(decoded!.data).toBe(advertised.url);
  });

  test("the access key is required from other machines", async ({ page, dm }) => {
    const advertised = await (await page.request.get(`${dm.url}/api/mobile`)).json();
    test.skip(!advertised.reachable, "no LAN address in this environment");

    const key = new URL(advertised.url).searchParams.get("k");
    expect(key, "serving to the network with no key at all").toBeTruthy();

    // A request to the LAN address carries that address as its source, so it
    // is treated as remote even though it originates here.
    const lan = `http://${advertised.host}`;
    expect((await page.request.get(`${lan}/api/health`)).status()).toBe(403);
    expect((await page.request.get(`${lan}/api/health?k=nope`)).status()).toBe(403);
    expect((await page.request.get(`${lan}/api/health?k=${key}`)).status()).toBe(200);
  });

  /**
   * The URL `--open` uses must be the loopback one.
   *
   * Reaching the machine's own LAN address from a browser on that machine is
   * treated as remote by the access key, so `--open` used to land on the "not
   * open to the network" page.
   */
  test("the banner URL loads without a key", async ({ page, dm }) => {
    expect(dm.url).toMatch(/^http:\/\/127\.0\.0\.1:/);

    const res = await page.request.get(`${dm.url}/api/health`);
    expect(res.status(), "the URL --open uses is refused by the access key").toBe(200);

    await openCanvas(page, dm);
    await expect(page.locator(".node").first()).toBeVisible();
  });
});

test("a loopback-only server explains itself instead of showing a dead QR", async ({
  page,
  dm,
}) => {
  await openCanvas(page, dm); // the default fixture binds 127.0.0.1

  await page.keyboard.press("?");
  await expect(page.locator(".qr__unavailable")).toBeVisible();
  await expect(page.locator(".qr__unavailable")).toContainText("0.0.0.0");
  // No QR beats one that scans and then fails to load, which reads as a broken
  // tool rather than a configuration choice.
  await expect(page.locator(".qr__code")).toHaveCount(0);
});
