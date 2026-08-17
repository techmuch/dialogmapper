import { HIERARCHICAL_FALLBACK, type DMEdge, type DMNode, type Relationship } from "../types";

/**
 * Turning a map into the threaded list the phone shows.
 *
 * The feed used to be a flat reverse-chronological list of nodes, which left
 * every row rootless: "Cuts p99 to 200ms" with a Pro glyph could be supporting
 * any Idea on the map, and the only way to find out was to tap it. In IBIS an
 * argument means nothing apart from what it argues about, so that is a real
 * loss of meaning rather than just a loss of tidiness.
 *
 * Threading restores it without paying what a full outline costs on a 375px
 * screen. Threads are ordered by their most recent activity, so a phone user in
 * a live session still sees what just happened at the top — that is the job the
 * flat feed was doing well, and it should survive the change.
 */

/** How far a row is indented before indentation stops buying anything. */
export const MAX_INDENT_DEPTH = 3;

export interface ThreadRow {
  node: DMNode;
  /** True tree depth, which may exceed MAX_INDENT_DEPTH. */
  depth: number;
  /** Indentation step actually applied. */
  indent: number;
  /** The node this one hangs off, for rows too deep to indent any further. */
  parent: DMNode | null;
  /** How this node attaches to its parent, e.g. "objects_to". */
  rel: DMEdge["relationshipType"] | null;
  /** Newest updatedAt anywhere in this row's subtree, including itself. */
  latest: string;
}

export interface Thread {
  root: DMNode;
  rows: ThreadRow[];
  /** Newest updatedAt in the whole thread; drives thread ordering. */
  latest: string;
}

interface Link {
  parentId: string;
  rel: DMEdge["relationshipType"];
}

/**
 * Picks each node's parent.
 *
 * IBIS edges point child -> parent, so a node's parent is the target of an edge
 * it is the source of. Hierarchical edges win: a Note that both relates to an
 * Idea and is questioned by something belongs under the Idea. `relates_to` is
 * still used as a fallback, because a Note floating as its own root thread is
 * noise, but it is the reason `linkParents` has to be cycle-safe — only
 * hierarchical edges are cycle-checked in the database, so `A relates_to B`
 * and `B relates_to A` can both exist.
 */
function linkParents(
  nodes: Map<string, DMNode>,
  edges: DMEdge[],
  hierarchical: Relationship[],
): Map<string, Link> {
  const preferred = new Map<string, Link>();
  const fallback = new Map<string, Link>();

  for (const e of edges) {
    if (!nodes.has(e.sourceNodeId) || !nodes.has(e.targetNodeId)) continue;
    if (e.sourceNodeId === e.targetNodeId) continue;
    const into = hierarchical.includes(e.relationshipType) ? preferred : fallback;
    // First edge wins, so the list is stable rather than order-of-arrival.
    if (!into.has(e.sourceNodeId)) {
      into.set(e.sourceNodeId, { parentId: e.targetNodeId, rel: e.relationshipType });
    }
  }

  const chosen = new Map<string, Link>();
  for (const id of nodes.keys()) {
    const link = preferred.get(id) ?? fallback.get(id);
    if (link) chosen.set(id, link);
  }

  // Break any cycle a relates_to pair may have introduced by orphaning the
  // node that closes it. Rendering a cycle would hang the phone, which is a
  // worse failure than one Note showing up as its own thread.
  for (const id of [...chosen.keys()]) {
    const seen = new Set<string>([id]);
    let cur = chosen.get(id)?.parentId;
    while (cur) {
      if (seen.has(cur)) {
        chosen.delete(id);
        break;
      }
      seen.add(cur);
      cur = chosen.get(cur)?.parentId;
    }
  }
  return chosen;
}

/**
 * Groups nodes into threads under their root, newest activity first.
 *
 * A thread's position is set by the newest thing anywhere inside it, not by
 * when its root question was asked — otherwise a lively debate under an old
 * question would sink out of sight.
 */
export function buildThreads(
  nodes: DMNode[],
  edges: DMEdge[],
  hierarchical: Relationship[] = HIERARCHICAL_FALLBACK,
): Thread[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = linkParents(byId, edges, hierarchical);

  const children = new Map<string, DMNode[]>();
  const roots: DMNode[] = [];
  for (const n of nodes) {
    const link = parents.get(n.id);
    if (!link) {
      roots.push(n);
      continue;
    }
    const sibs = children.get(link.parentId);
    if (sibs) sibs.push(n);
    else children.set(link.parentId, [n]);
  }

  // Newest timestamp in each subtree, computed bottom-up from a post-order
  // walk so a deep reply lifts every ancestor with it.
  const latest = new Map<string, string>();
  const subtreeLatest = (n: DMNode): string => {
    const cached = latest.get(n.id);
    if (cached) return cached;
    let newest = n.updatedAt;
    for (const c of children.get(n.id) ?? []) {
      const t = subtreeLatest(c);
      if (t > newest) newest = t;
    }
    latest.set(n.id, newest);
    return newest;
  };
  for (const n of nodes) subtreeLatest(n);

  const newestFirst = (a: DMNode, b: DMNode) =>
    (latest.get(b.id) ?? b.updatedAt).localeCompare(latest.get(a.id) ?? a.updatedAt);

  const flatten = (node: DMNode, depth: number, rows: ThreadRow[]) => {
    const link = parents.get(node.id);
    rows.push({
      node,
      depth,
      indent: Math.min(depth, MAX_INDENT_DEPTH),
      // Only rows that have run out of indentation need to name their parent;
      // for the rest the indentation already says it.
      parent: depth > MAX_INDENT_DEPTH ? (byId.get(link?.parentId ?? "") ?? null) : null,
      rel: link?.rel ?? null,
      latest: latest.get(node.id) ?? node.updatedAt,
    });
    for (const c of [...(children.get(node.id) ?? [])].sort(newestFirst)) {
      flatten(c, depth + 1, rows);
    }
  };

  return roots
    .sort(newestFirst)
    .map((root) => {
      const rows: ThreadRow[] = [];
      flatten(root, 0, rows);
      return { root, rows, latest: latest.get(root.id) ?? root.updatedAt };
    });
}
