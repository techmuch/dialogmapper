import { HIERARCHICAL_FALLBACK, type DMEdge, type DMNode, type Relationship } from "./types";

/**
 * Shared structural reading of a map: who hangs off whom.
 *
 * The phone's threading and the canvas filter both need this, and they have to
 * agree — a node that threads under one parent but filters under another would
 * make the two surfaces disagree about the same map.
 */

export interface ParentLink {
  parentId: string;
  rel: Relationship;
}

/**
 * Picks each node's parent.
 *
 * IBIS edges point child -> parent, so a node's parent is the target of an edge
 * it is the source of. Hierarchical edges win: a Note that both relates to an
 * Idea and answers a Question belongs under the Question. `relates_to` is still
 * used as a fallback, because a Note floating unattached is noise, but it is
 * the reason this has to be cycle-safe — only hierarchical edges are
 * cycle-checked in the database, so `A relates_to B` and `B relates_to A` can
 * both exist.
 */
export function parentLinks(
  nodes: Map<string, DMNode>,
  edges: DMEdge[],
  hierarchical: Relationship[] = HIERARCHICAL_FALLBACK,
): Map<string, ParentLink> {
  const preferred = new Map<string, ParentLink>();
  const fallback = new Map<string, ParentLink>();

  for (const e of edges) {
    const source = nodes.get(e.sourceNodeId);
    const target = nodes.get(e.targetNodeId);
    if (!source || !target) continue;
    if (e.sourceNodeId === e.targetNodeId) continue;

    if (hierarchical.includes(e.relationshipType)) {
      // First edge wins, so the result is stable rather than order-of-arrival.
      if (!preferred.has(e.sourceNodeId)) {
        preferred.set(e.sourceNodeId, {
          parentId: e.targetNodeId,
          rel: e.relationshipType,
        });
      }
      continue;
    }

    // An associative link has no inherent direction of hierarchy, and the
    // grammar allows both "Note relates to X" and "X relates to a Note". Only
    // one of those readings is useful: a Note annotates something, so it hangs
    // off it. Without this, drawing the link the other way round would make an
    // Idea a child of a Note.
    const noteIsTarget = target.type === "note" && source.type !== "note";
    const childId = noteIsTarget ? e.targetNodeId : e.sourceNodeId;
    const parentId = noteIsTarget ? e.sourceNodeId : e.targetNodeId;
    if (!fallback.has(childId)) {
      fallback.set(childId, { parentId, rel: e.relationshipType });
    }
  }

  const chosen = new Map<string, ParentLink>();
  for (const id of nodes.keys()) {
    const link = preferred.get(id) ?? fallback.get(id);
    if (link) chosen.set(id, link);
  }

  // Break any cycle a relates_to pair introduced by orphaning the node that
  // closes it. Walking a cycle would hang the page, which is a worse failure
  // than one Note appearing unattached.
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

/** Inverts parentLinks: parent id -> the nodes hanging off it. */
export function childLinks(
  nodes: DMNode[],
  parents: Map<string, ParentLink>,
): Map<string, DMNode[]> {
  const children = new Map<string, DMNode[]>();
  for (const n of nodes) {
    const link = parents.get(n.id);
    if (!link) continue;
    const sibs = children.get(link.parentId);
    if (sibs) sibs.push(n);
    else children.set(link.parentId, [n]);
  }
  return children;
}

/** Every node beneath `rootId`, plus `rootId` itself. */
export function subtree(rootId: string, children: Map<string, DMNode[]>): Set<string> {
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const c of children.get(queue.pop()!) ?? []) {
      // parentLinks is already cycle-free, but this walk is cheap to make
      // independently safe and the alternative failure is a frozen tab.
      if (out.has(c.id)) continue;
      out.add(c.id);
      queue.push(c.id);
    }
  }
  return out;
}
