import type { DMEdge, DMNode, Relationship } from "../types";

/**
 * Tidy-tree layout for IBIS maps.
 *
 * Why a tree rather than a force simulation: an IBIS map *is* a tree of
 * arguments, and force layouts destroy the one thing that makes the map
 * readable — that a Pro sits visibly beneath the Idea it supports. A force
 * layout also moves every node whenever one is added, which is disorienting
 * when a phone drops a node into a conversation already in progress.
 *
 * Edges point from child to parent (a Pro *supports* an Idea), so the tree is
 * built by inverting them.
 */

export const NODE_W = 236;
export const NODE_H = 88;
const H_GAP = 28;
const V_GAP = 116;
const ROOT_GAP = 96;

const HIERARCHICAL: ReadonlySet<Relationship> = new Set<Relationship>([
  "responds_to",
  "questions",
  "supports",
  "objects_to",
  "specializes",
]);

export interface Pos {
  x: number;
  y: number;
}

/**
 * Returns positions for every node. Order within a level follows the argument
 * reading order (questions, then ideas, then pros, then cons, then notes), so
 * a map laid out twice looks the same both times.
 */
export function autoLayout(nodes: DMNode[], edges: DMEdge[]): Map<string, Pos> {
  const out = new Map<string, Pos>();
  if (nodes.length === 0) return out;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const e of edges) {
    if (!HIERARCHICAL.has(e.relationshipType)) continue;
    if (!nodeById.has(e.sourceNodeId) || !nodeById.has(e.targetNodeId)) continue;
    // The child is the source: "Pro --supports--> Idea".
    const list = children.get(e.targetNodeId);
    if (list) list.push(e.sourceNodeId);
    else children.set(e.targetNodeId, [e.sourceNodeId]);
    hasParent.add(e.sourceNodeId);
  }

  const rank: Record<string, number> = {
    question: 0,
    idea: 1,
    map: 2,
    pro: 3,
    con: 4,
    note: 5,
  };
  const sortIds = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const na = nodeById.get(a)!;
      const nb = nodeById.get(b)!;
      const d = (rank[na.type] ?? 9) - (rank[nb.type] ?? 9);
      return d !== 0 ? d : na.createdAt.localeCompare(nb.createdAt);
    });

  const roots = sortIds(nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id));

  // First pass: how wide is each subtree? Guarded against cycles, which the
  // backend prevents but a corrupt database could still contain.
  const widthOf = new Map<string, number>();
  const measuring = new Set<string>();

  const measure = (id: string): number => {
    const cached = widthOf.get(id);
    if (cached !== undefined) return cached;
    if (measuring.has(id)) return NODE_W; // cycle: treat as a leaf
    measuring.add(id);

    const kids = children.get(id) ?? [];
    let width = NODE_W;
    if (kids.length) {
      width = Math.max(
        NODE_W,
        kids.reduce((sum, k) => sum + measure(k), 0) + H_GAP * (kids.length - 1),
      );
    }
    measuring.delete(id);
    widthOf.set(id, width);
    return width;
  };

  // Second pass: assign coordinates, centring each parent over its children.
  const placed = new Set<string>();
  const place = (id: string, left: number, depth: number) => {
    if (placed.has(id)) return;
    placed.add(id);

    const width = measure(id);
    out.set(id, {
      x: Math.round(left + width / 2 - NODE_W / 2),
      y: Math.round(depth * (NODE_H + V_GAP)),
    });

    let cursor = left;
    for (const kid of sortIds(children.get(id) ?? [])) {
      place(kid, cursor, depth + 1);
      cursor += measure(kid) + H_GAP;
    }
  };

  let cursor = 0;
  for (const root of roots) {
    place(root, cursor, 0);
    cursor += measure(root) + ROOT_GAP;
  }

  // Anything unreachable (only associative edges, or inside a cycle) goes in a
  // row underneath rather than being dropped.
  const stragglers = nodes.filter((n) => !placed.has(n.id));
  if (stragglers.length) {
    const depth = maxDepth(out) + 1;
    stragglers.forEach((n, i) => {
      out.set(n.id, {
        x: i * (NODE_W + H_GAP),
        y: Math.round(depth * (NODE_H + V_GAP)),
      });
    });
  }

  return out;
}

function maxDepth(positions: Map<string, Pos>): number {
  let max = 0;
  for (const p of positions.values()) max = Math.max(max, p.y);
  return Math.round(max / (NODE_H + V_GAP));
}

/** Whether two node-sized boxes at these corners overlap. */
function overlaps(a: Pos, b: Pos): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_W + H_GAP / 2 && Math.abs(a.y - b.y) < NODE_H + V_GAP / 4
  );
}

/**
 * A spot near (x, y) that does not sit on top of an existing node.
 *
 * New nodes are positioned by guessing an offset from their parent, which says
 * nothing about where anybody else's children already are — so two branches
 * growing at once put cards directly on top of each other. Auto layout hides
 * that by recomputing everything, but the guessed position is still what gets
 * saved, and it is what you see the moment you switch to freeform.
 *
 * Steps down first, because an argument tree grows downwards and a free row
 * below the parent is nearly always the right place.
 */
export function freeSpot(x: number, y: number, taken: Pos[]): Pos {
  const step = NODE_H + V_GAP / 2;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = {
      x: x + (attempt % 2 === 1 ? NODE_W + H_GAP : 0),
      y: y + Math.floor(attempt / 2) * step,
    };
    if (!taken.some((t) => overlaps(candidate, t))) return candidate;
  }
  // Give up rather than loop: a crowded map is better than a hung tab, and
  // `l` will sort it out.
  return { x, y };
}

/**
 * Positions for nodes the backend never placed. Used on first paint so blind
 * additions do not stack at the origin, without disturbing nodes a human has
 * already arranged by hand.
 */
export function placeUnplaced(nodes: DMNode[], edges: DMEdge[]): Map<string, Pos> {
  const unplaced = nodes.filter((n) => n.placement?.x == null);
  if (unplaced.length === 0) return new Map();

  const full = autoLayout(nodes, edges);
  const result = new Map<string, Pos>();
  for (const n of unplaced) {
    const p = full.get(n.id);
    if (p) result.set(n.id, p);
  }
  return result;
}
