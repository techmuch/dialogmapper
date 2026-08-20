/**
 * Viewport arithmetic, kept pure so it can be tested without a browser.
 *
 * Everything here works in *container-local screen pixels*: the canvas element's
 * own top-left is (0, 0). React Flow's transform maps flow coordinates into
 * exactly that space — `screen = flow * zoom + viewport` — so a node's on-screen
 * box and the visible area can be compared directly.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zoom levels offered by the control, and the grid manual zooming snaps to. */
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** "auto" means React Flow decides, which is what fitView has always done. */
export type ZoomSetting = "auto" | number;

/** The preset nearest to an arbitrary zoom, so the control never lies. */
export function snapZoom(zoom: number): number {
  return ZOOM_PRESETS.reduce((best, p) =>
    Math.abs(p - zoom) < Math.abs(best - zoom) ? p : best,
  );
}

/**
 * The smallest viewport shift that brings `node` fully inside `view`.
 *
 * Returns null when it is already comfortably visible — panning a node that is
 * on screen anyway would yank the map out from under whoever is reading it.
 *
 * A node too large to fit is centred rather than jammed against one edge:
 * aligning its top-left would push its title off the bottom, and the title is
 * the thing you have just been given a cursor in.
 */
export function panDelta(
  node: Rect,
  view: Rect,
  margin = 24,
): { dx: number; dy: number } | null {
  const axis = (
    nStart: number,
    nSize: number,
    vStart: number,
    vSize: number,
  ): number => {
    const lo = vStart + margin;
    const hi = vStart + vSize - margin;
    if (nSize > hi - lo) return (lo + hi) / 2 - (nStart + nSize / 2);
    if (nStart < lo) return lo - nStart;
    if (nStart + nSize > hi) return hi - (nStart + nSize);
    return 0;
  };

  const dx = axis(node.x, node.width, view.x, view.width);
  const dy = axis(node.y, node.height, view.y, view.height);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** Centre of the box enclosing every position given, in flow coordinates. */
export function boundsCenter(
  boxes: { x: number; y: number; width: number; height: number }[],
): { x: number; y: number } | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
