import { describe, expect, it } from "vitest";
import type { DMEdge, DMNode, NodeType, Relationship } from "../types";
import { MAX_INDENT_DEPTH, buildThreads } from "./threads";

/**
 * The thread model decides what a phone user sees first, so its ordering rules
 * are worth pinning rather than eyeballing. The cycle case in particular is
 * unreachable through the UI and would hang the page if it ever occurred, which
 * makes it exactly the thing a test should cover.
 */

let clock = 0;
/** Timestamps ascend in call order, so "newer" is whatever was made last. */
function node(id: string, type: NodeType, at?: number): DMNode {
  const t = at ?? ++clock;
  return {
    id,
    type,
    title: id,
    content: { markdown: "", tags: [], status: "open", assets: [], links: [] },
    createdAt: new Date(t * 1000).toISOString(),
    updatedAt: new Date(t * 1000).toISOString(),
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
    createdAt: new Date().toISOString(),
  };
}

const titles = (rows: { node: DMNode }[]) => rows.map((r) => r.node.title);

describe("buildThreads", () => {
  it("puts each node under its parent, deepest last", () => {
    const q = node("q", "question");
    const i = node("i", "idea");
    const p = node("p", "pro");
    const threads = buildThreads([q, i, p], [edge("i", "q"), edge("p", "i", "supports")]);

    expect(threads).toHaveLength(1);
    expect(titles(threads[0].rows)).toEqual(["q", "i", "p"]);
    expect(threads[0].rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  it("orders threads by their newest content, not by their root", () => {
    // An old question with a live debate under it must outrank a newer
    // question nobody has touched, or the phone shows a stale top of list.
    const oldQ = node("old-question", "question", 1);
    const reply = node("fresh-reply", "idea", 500);
    const newQ = node("new-question", "question", 100);

    const threads = buildThreads([oldQ, newQ, reply], [edge("fresh-reply", "old-question")]);
    expect(threads.map((t) => t.root.title)).toEqual(["old-question", "new-question"]);
  });

  it("orders siblings newest first", () => {
    const q = node("q", "question", 1);
    const first = node("first", "idea", 2);
    const second = node("second", "idea", 3);
    const threads = buildThreads(
      [q, first, second],
      [edge("first", "q"), edge("second", "q")],
    );
    expect(titles(threads[0].rows)).toEqual(["q", "second", "first"]);
  });

  it("prefers a hierarchical parent over a relates_to one", () => {
    // A Note that both relates to something and answers something belongs
    // under the answer: that is where it sits on the canvas.
    const q = node("q", "question");
    const other = node("other", "note");
    const n = node("n", "note");
    const threads = buildThreads(
      [q, other, n],
      [edge("n", "other", "relates_to"), edge("n", "q", "responds_to")],
    );
    const withN = threads.find((t) => titles(t.rows).includes("n"))!;
    expect(withN.root.title).toBe("q");
  });

  it("still nests a note that only relates to something", () => {
    // Otherwise every loose Note becomes its own thread and the list is noise.
    const i = node("i", "idea");
    const n = node("n", "note");
    const threads = buildThreads([i, n], [edge("n", "i", "relates_to")]);
    expect(threads).toHaveLength(1);
    expect(titles(threads[0].rows)).toEqual(["i", "n"]);
  });

  it("caps indentation but keeps the true depth", () => {
    const chain = ["a", "b", "c", "d", "e", "f"].map((id) => node(id, "note"));
    const edges = [
      edge("b", "a", "relates_to"),
      edge("c", "b", "relates_to"),
      edge("d", "c", "relates_to"),
      edge("e", "d", "relates_to"),
      edge("f", "e", "relates_to"),
    ];
    const rows = buildThreads(chain, edges)[0].rows;

    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.indent)).toEqual([0, 1, 2, 3, 3, 3]);
    // A row that has run out of indentation says what it hangs off instead,
    // so it never becomes rootless the way the flat feed was.
    for (const r of rows) {
      if (r.depth > MAX_INDENT_DEPTH) expect(r.parent).not.toBeNull();
      else expect(r.parent).toBeNull();
    }
  });

  it("survives a relates_to cycle instead of hanging", () => {
    // relates_to is not cycle-checked in the database, so A <-> B is
    // reachable. Rendering it must terminate.
    const a = node("a", "note");
    const b = node("b", "note");
    const threads = buildThreads(
      [a, b],
      [edge("a", "b", "relates_to"), edge("b", "a", "relates_to")],
    );
    const shown = threads.flatMap((t) => titles(t.rows));
    expect(shown.sort()).toEqual(["a", "b"]);
  });

  it("shows every node exactly once", () => {
    // The property that matters most: threading must not silently drop
    // anything, or the phone quietly hides part of the conversation.
    const nodes = [
      node("q", "question"),
      node("i", "idea"),
      node("p", "pro"),
      node("c", "con"),
      node("loose", "note"),
    ];
    const threads = buildThreads(nodes, [
      edge("i", "q"),
      edge("p", "i", "supports"),
      edge("c", "i", "objects_to"),
    ]);
    const shown = threads.flatMap((t) => titles(t.rows));
    expect(shown.sort()).toEqual(["c", "i", "loose", "p", "q"]);
  });

  it("ignores edges pointing at nodes that are not here", () => {
    // A map's edge list can reference a node removed from this map.
    const i = node("i", "idea");
    const threads = buildThreads([i], [edge("i", "missing")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.title).toBe("i");
  });
});
