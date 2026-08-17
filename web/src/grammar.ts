import type { DMEdge, DMNode, Grammar, NodeType } from "./types";
import { NODE_LABELS } from "./types";

/**
 * Client-side reading of the IBIS grammar the server publishes at
 * /api/grammar.
 *
 * This is advisory only — the server remains the authority and refuses
 * anything illegal regardless. The point is to answer "could this work?"
 * before the user commits to it, so an impossible type change is visibly
 * unavailable rather than something you discover by clicking it and reading
 * an error.
 *
 * Deriving it from the served ruleset rather than restating the rules here
 * keeps one source of truth: adding a relationship in Go changes this too.
 */

/** Whether any relationship in the grammar connects these two types. */
export function canConnect(
  grammar: Grammar | null,
  source: NodeType,
  target: NodeType,
): boolean {
  if (!grammar) return true; // not loaded yet: do not pre-emptively forbid
  return grammar.rules.some(
    (r) => r.sources.includes(source) && r.targets.includes(target),
  );
}

export interface RetypeCheck {
  ok: boolean;
  /** Why not, phrased for a tooltip. */
  reason?: string;
}

/**
 * Whether a node could become `next`, given everything it is attached to.
 *
 * Every incident edge is considered, not just the one to the parent. A node's
 * children constrain it as much as its parent does: an Idea with a Pro beneath
 * it cannot become a Question, because nothing in IBIS lets an argument attach
 * to an issue. Checking only upwards would let the graph reach a state the
 * server would then have to refuse anyway.
 */
export function canRetype(
  grammar: Grammar | null,
  node: DMNode,
  next: NodeType,
  edges: DMEdge[],
  nodes: Record<string, DMNode>,
): RetypeCheck {
  if (!grammar || next === node.type) return { ok: true };

  for (const e of edges) {
    const isSource = e.sourceNodeId === node.id;
    const isTarget = e.targetNodeId === node.id;
    if (!isSource && !isTarget) continue;

    const otherId = isSource ? e.targetNodeId : e.sourceNodeId;
    const other = nodes[otherId];
    if (!other) continue;

    const connected = isSource
      ? canConnect(grammar, next, other.type)
      : canConnect(grammar, other.type, next);

    if (!connected) {
      const title = other.title.trim() || "untitled";
      return {
        ok: false,
        reason:
          `A ${NODE_LABELS[next]} cannot attach to the ` +
          `${NODE_LABELS[other.type]} “${title.length > 32 ? title.slice(0, 32) + "…" : title}”. ` +
          `Detach it first.`,
      };
    }
  }
  return { ok: true };
}
