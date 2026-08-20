import { describe, expect, it } from "vitest";
import { ZOOM_PRESETS, boundsCenter, panDelta, snapZoom } from "./viewport";

const view = { x: 0, y: 0, width: 1000, height: 600 };

describe("panDelta", () => {
  it("does nothing for a node already comfortably on screen", () => {
    // Panning a node that is visible anyway would move the map out from under
    // whoever is reading it.
    expect(panDelta({ x: 400, y: 250, width: 236, height: 88 }, view)).toBeNull();
  });

  it("pulls in a node hanging off the right edge", () => {
    const d = panDelta({ x: 900, y: 250, width: 236, height: 88 }, view)!;
    expect(d.dy).toBe(0);
    // Just far enough that its right edge clears the margin, and no further.
    expect(900 + d.dx + 236).toBe(view.width - 24);
  });

  it("pulls in a node off the left edge", () => {
    const d = panDelta({ x: -100, y: 250, width: 236, height: 88 }, view)!;
    expect(-100 + d.dx).toBe(24);
  });

  it("pulls in a node below the fold", () => {
    const d = panDelta({ x: 400, y: 700, width: 236, height: 88 }, view)!;
    expect(d.dx).toBe(0);
    expect(700 + d.dy + 88).toBe(view.height - 24);
  });

  it("moves on both axes when a node is diagonally off screen", () => {
    const d = panDelta({ x: -300, y: 900, width: 236, height: 88 }, view)!;
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBeLessThan(0);
  });

  it("centres a node too big to fit rather than jamming it against an edge", () => {
    // Aligning the top-left would push the title off the bottom, and the title
    // is exactly what has just been given a cursor.
    const node = { x: 0, y: 0, width: 200, height: 900 };
    const d = panDelta(node, view)!;
    expect(node.y + d.dy + node.height / 2).toBeCloseTo(view.height / 2, 5);
  });

  it("respects a custom margin", () => {
    const d = panDelta({ x: 990, y: 250, width: 100, height: 88 }, view, 60)!;
    expect(990 + d.dx + 100).toBe(view.height * 0 + view.width - 60);
  });

  it("accounts for a view that does not start at the origin", () => {
    const offset = { x: 100, y: 50, width: 800, height: 500 };
    const d = panDelta({ x: 0, y: 250, width: 236, height: 88 }, offset)!;
    expect(0 + d.dx).toBe(100 + 24);
  });
});

describe("snapZoom", () => {
  it("returns the nearest preset", () => {
    expect(snapZoom(1.02)).toBe(1);
    expect(snapZoom(1.28)).toBe(1.25);
    expect(snapZoom(0.6)).toBe(0.5);
    expect(snapZoom(1.9)).toBe(2);
  });

  it("clamps to the ends rather than inventing a level", () => {
    expect(snapZoom(0.05)).toBe(ZOOM_PRESETS[0]);
    expect(snapZoom(9)).toBe(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]);
  });

  it("leaves an exact preset alone", () => {
    for (const p of ZOOM_PRESETS) expect(snapZoom(p)).toBe(p);
  });
});

describe("boundsCenter", () => {
  it("finds the centre of everything given", () => {
    expect(
      boundsCenter([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 200, width: 100, height: 100 },
      ]),
    ).toEqual({ x: 150, y: 150 });
  });

  it("returns null for an empty map", () => {
    expect(boundsCenter([])).toBeNull();
  });
});
