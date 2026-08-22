import { childLinks, parentLinks, subtree } from "./graph";
import { parseTerms } from "./search";
import type { DMEdge, DMNode, Relationship, Status } from "./types";

/**
 * What the canvas filter keeps.
 *
 * The previous version could not actually exclude anything. "Open questions"
 * meant "a Question or Idea whose status is open or parked", and then every
 * result was expanded by one hop in each direction — which pulled back in the
 * Pros, Cons and Notes it had just excluded. Filtering by anything showed
 * almost everything.
 *
 * This version asks a structural question instead of a per-node one: which
 * questions has the group actually settled, and what hangs off the ones it has
 * not?
 */

export type FilterPreset = "all" | "openQuestions";

export interface FilterState {
  preset: FilterPreset;
  statuses: Set<Status>;
  tag: string | null;
  query: string;
}

/**
 * A Question is settled when an Idea answering it has been marked resolved.
 *
 * That is what "resolved" means on an Idea in dialogue mapping: the group
 * committed to it, so the issue above it is decided. Only *immediate* answers
 * count — an Idea three levels down resolves whatever question it answers, not
 * this one.
 */
export function isQuestionOpen(
  questionId: string,
  children: Map<string, DMNode[]>,
): boolean {
  for (const c of children.get(questionId) ?? []) {
    if (c.type === "idea" && c.content.status === "resolved") return false;
  }
  return true;
}

/**
 * The topmost Question in each branch — the ones the openness test applies to.
 *
 * Nested questions are deliberately not tested. A settled sub-question inside a
 * live debate is still part of that debate, and hiding its branch would remove
 * the reasoning that explains how the group got where it is.
 */
export function rootQuestions(
  nodes: DMNode[],
  parents: Map<string, { parentId: string }>,
  byId: Map<string, DMNode>,
): DMNode[] {
  return nodes.filter((n) => {
    if (n.type !== "question") return false;
    // Walk up; if another Question is above this one, that one is the root.
    const seen = new Set<string>([n.id]);
    let cur = parents.get(n.id)?.parentId;
    while (cur && !seen.has(cur)) {
      if (byId.get(cur)?.type === "question") return false;
      seen.add(cur);
      cur = parents.get(cur)?.parentId;
    }
    return true;
  });
}

/** Open root questions and everything hanging off them. */
export function openQuestionScope(
  nodes: DMNode[],
  edges: DMEdge[],
  hierarchical?: Relationship[],
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = parentLinks(byId, edges, hierarchical);
  const children = childLinks(nodes, parents);

  const keep = new Set<string>();
  for (const q of rootQuestions(nodes, parents, byId)) {
    if (!isQuestionOpen(q.id, children)) continue;
    for (const id of subtree(q.id, children)) keep.add(id);
  }
  return keep;
}

/**
 * Whether a node matches every term.
 *
 * Every term, not any: typing another word narrows the result. Each term may
 * match in any of the title, the body or a tag, so "perf cache" finds a node
 * tagged #perf whose title mentions caching.
 */
function matchesTerms(n: DMNode, terms: string[]): boolean {
  const haystack = [n.title, n.content.markdown, ...n.content.tags]
    .join("\n")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export function isFilterActive(f: FilterState, allStatuses: number): boolean {
  return (
    f.preset !== "all" ||
    f.statuses.size !== allStatuses ||
    f.tag !== null ||
    f.query.trim() !== ""
  );
}

/**
 * The set of nodes the filter keeps.
 *
 * Every criterion narrows; nothing widens. In particular a text match brings
 * back only the nodes that match — not their children. Pulling in neighbours
 * was what made the old filter useless, and when you search for a word you want
 * the nodes containing it, not a subtree that happens to hang off one.
 */
export function computeVisible(
  nodes: DMNode[],
  edges: DMEdge[],
  f: FilterState,
  hierarchical?: Relationship[],
): Set<string> {
  let keep = new Set(nodes.map((n) => n.id));

  if (f.preset === "openQuestions") {
    const scope = openQuestionScope(nodes, edges, hierarchical);
    keep = new Set([...keep].filter((id) => scope.has(id)));
  }

  const terms = parseTerms(f.query);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of [...keep]) {
    const n = byId.get(id)!;
    if (!f.statuses.has(n.content.status)) keep.delete(id);
    else if (f.tag && !n.content.tags.includes(f.tag)) keep.delete(id);
    else if (terms.length > 0 && !matchesTerms(n, terms)) keep.delete(id);
  }
  return keep;
}
