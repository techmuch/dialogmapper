import { describe, expect, it } from "vitest";
import { computeVisible, openQuestionScope, type FilterState } from "./filter";
import type { DMEdge, DMNode, NodeType, Relationship, Status } from "./types";

/**
 * The filter decides what a facilitator sees mid-conversation, and the previous
 * version silently showed almost everything because it expanded each match by
 * one hop. These tests pin what is *excluded*, which is the part that was
 * broken and the part that is easy to regress.
 */

const ALL_STATUSES: Status[] = ["open", "resolved", "rejected", "parked"];

function node(id: string, type: NodeType, status: Status = "open", extra = {}): DMNode {
  return {
    id,
    type,
    title: id,
    content: { markdown: "", tags: [], status, assets: [], links: [], ...extra },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    mapCount: 1,
  };
}

/** Child -> parent, the direction IBIS edges actually point. */
function edge(child: string, parent: string, rel: Relationship = "responds_to"): DMEdge {
  return {
    id: `${child}->${parent}`,
    mapId: "m",
    sourceNodeId: child,
    targetNodeId: parent,
    relationshipType: rel,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const base: FilterState = {
  preset: "all",
  statuses: new Set(ALL_STATUSES),
  tag: null,
  query: "",
};

const shown = (s: Set<string>) => [...s].sort();

describe("openQuestionScope", () => {
  it("keeps a question with no resolved answer, and everything under it", () => {
    const nodes = [
      node("q", "question"),
      node("i", "idea"),
      node("p", "pro"),
      node("c", "con"),
    ];
    const edges = [
      edge("i", "q"),
      edge("p", "i", "supports"),
      edge("c", "i", "objects_to"),
    ];
    expect(shown(openQuestionScope(nodes, edges))).toEqual(["c", "i", "p", "q"]);
  });

  it("drops a question once one of its answers is resolved", () => {
    // Marking an Idea resolved is how a decision is recorded, so the issue
    // above it is settled and no longer an open question.
    const nodes = [node("q", "question"), node("chosen", "idea", "resolved"), node("p", "pro")];
    const edges = [edge("chosen", "q"), edge("p", "chosen", "supports")];
    expect(shown(openQuestionScope(nodes, edges))).toEqual([]);
  });

  it("only counts an immediate answer, not a deeper one", () => {
    // A resolved Idea two levels down settles the sub-question it answers,
    // not the question at the top.
    const nodes = [
      node("q", "question"),
      node("i", "idea"),
      node("subq", "question"),
      node("deep", "idea", "resolved"),
    ];
    const edges = [
      edge("i", "q"),
      edge("subq", "i", "questions"),
      edge("deep", "subq"),
    ];
    expect(shown(openQuestionScope(nodes, edges))).toEqual(["deep", "i", "q", "subq"]);
  });

  it("keeps a settled sub-question inside a live debate", () => {
    // Only root questions are tested. The reasoning that got the group here is
    // part of the open discussion, even where a sub-issue is closed.
    const nodes = [
      node("q", "question"),
      node("i", "idea"),
      node("subq", "question"),
      node("settled", "idea", "resolved"),
    ];
    const edges = [edge("i", "q"), edge("subq", "i", "questions"), edge("settled", "subq")];
    expect(shown(openQuestionScope(nodes, edges))).toContain("settled");
  });

  it("drops nodes with no question above them at all", () => {
    // A stranded Idea or a Note attached to nothing is not part of any open
    // question, so "open questions" must not show it.
    const nodes = [
      node("q", "question"),
      node("i", "idea"),
      node("orphan-note", "note"),
      node("orphan-idea", "idea"),
    ];
    expect(shown(openQuestionScope(nodes, [edge("i", "q")]))).toEqual(["i", "q"]);
  });

  it("keeps a note that relates to something under an open question", () => {
    const nodes = [node("q", "question"), node("i", "idea"), node("n", "note")];
    const edges = [edge("i", "q"), edge("n", "i", "relates_to")];
    expect(shown(openQuestionScope(nodes, edges))).toEqual(["i", "n", "q"]);
  });

  it("keeps one open question when another is settled", () => {
    const nodes = [
      node("open-q", "question"),
      node("live", "idea"),
      node("done-q", "question"),
      node("decided", "idea", "resolved"),
    ];
    const edges = [edge("live", "open-q"), edge("decided", "done-q")];
    expect(shown(openQuestionScope(nodes, edges))).toEqual(["live", "open-q"]);
  });

  it("a rejected answer does not settle the question", () => {
    // Rejecting an idea is the group declining it; the issue is still open.
    const nodes = [node("q", "question"), node("no", "idea", "rejected")];
    expect(shown(openQuestionScope(nodes, [edge("no", "q")]))).toEqual(["no", "q"]);
  });
});

describe("computeVisible", () => {
  const nodes = [
    node("q", "question"),
    node("cache-idea", "idea"),
    node("p", "pro"),
  ];
  const edges = [edge("cache-idea", "q"), edge("p", "cache-idea", "supports")];

  it("shows everything with no filter", () => {
    expect(shown(computeVisible(nodes, edges, base))).toEqual(["cache-idea", "p", "q"]);
  });

  it("a text match brings back only what matched, not its children", () => {
    // The old filter expanded every match by one hop, so searching for a
    // parent showed its whole neighbourhood and filtering achieved nothing.
    const got = computeVisible(nodes, edges, { ...base, query: "cache" });
    expect(shown(got)).toEqual(["cache-idea"]);
  });

  it("matches body text and tags, not just titles", () => {
    const tagged = [
      node("a", "note", "open", { markdown: "mentions latency" }),
      node("b", "note", "open", { tags: ["latency"] }),
      node("c", "note"),
    ];
    expect(shown(computeVisible(tagged, [], { ...base, query: "latency" }))).toEqual(["a", "b"]);
  });

  it("every word has to match, and a word may land anywhere", () => {
    // "cache latency" should not look for that exact string. Each word can
    // match the title, the body or a tag independently.
    // The helper uses the id as the title, so these ids read as titles.
    const mixed = [
      node("read-through-cache", "idea", "open", { markdown: "cuts latency" }),
      node("cache-warming", "idea"),
      node("latency-budget", "idea"),
    ];
    expect(shown(computeVisible(mixed, [], { ...base, query: "cache latency" }))).toEqual([
      "read-through-cache",
    ]);
    // Word order is not word adjacency.
    expect(shown(computeVisible(mixed, [], { ...base, query: "latency cache" }))).toEqual([
      "read-through-cache",
    ]);
    // A word that appears nowhere excludes everything rather than being ignored.
    expect(shown(computeVisible(mixed, [], { ...base, query: "cache unicorn" }))).toEqual([]);
  });

  it("a quoted phrase stays together", () => {
    // Splitting on spaces would otherwise make phrase search impossible.
    const mixed = [
      node("a", "idea", "open", { markdown: "denormalise the hot tables" }),
      node("b", "idea", "open", { markdown: "tables are hot in summer" }),
    ];
    expect(shown(computeVisible(mixed, [], { ...base, query: '"hot tables"' }))).toEqual(["a"]);
  });

  it("narrows rather than widens when criteria combine", () => {
    const got = computeVisible(nodes, edges, {
      ...base,
      preset: "openQuestions",
      query: "q",
    });
    expect(shown(got)).toEqual(["q"]);
  });

  it("applies the status filter", () => {
    const mixed = [node("a", "idea", "open"), node("b", "idea", "parked")];
    const got = computeVisible(mixed, [], { ...base, statuses: new Set<Status>(["open"]) });
    expect(shown(got)).toEqual(["a"]);
  });

  it("applies the tag filter exactly, not as a substring", () => {
    const tagged = [
      node("a", "note", "open", { tags: ["perf"] }),
      node("b", "note", "open", { tags: ["performance"] }),
    ];
    expect(shown(computeVisible(tagged, [], { ...base, tag: "perf" }))).toEqual(["a"]);
  });

  it("keeps a resolved idea inside an open question", () => {
    // The preset is structural: it decides which questions are live, and does
    // not additionally hide resolved nodes underneath them.
    const ns = [
      node("q", "question"),
      node("a", "idea"),
      node("b", "idea"),
      node("done", "pro", "resolved"),
    ];
    const es = [edge("a", "q"), edge("b", "q"), edge("done", "a", "supports")];
    expect(shown(computeVisible(ns, es, { ...base, preset: "openQuestions" }))).toContain("done");
  });
});
