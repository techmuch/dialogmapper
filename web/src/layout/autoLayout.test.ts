import { describe, expect, it } from "vitest";
import type { DMEdge, DMNode, NodeType, Relationship } from "../types";
import { NODE_H, NODE_W, autoLayout, freeSpot } from "./autoLayout";

/**
 * Layout correctness, with "nothing lands on top of anything else" as the
 * property that matters most.
 *
 * Nodes stacking was the reported symptom, and nothing here asserted against
 * it — the layout was only ever checked by looking at it.
 */

function node(id: string, type: NodeType = "idea", createdAt = "2026-01-01T00:00:00Z"): DMNode {
  return {
    id,
    type,
    title: id,
    content: { markdown: "", tags: [], status: "open", assets: [], links: [] },
    createdAt,
    updatedAt: createdAt,
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

/** Every pair of positions that visually collide. */
function collisions(positions: Map<string, { x: number; y: number }>): string[] {
  const entries = [...positions];
  const hits: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [aId, a] = entries[i];
      const [bId, b] = entries[j];
      if (Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H) {
        hits.push(`${aId} overlaps ${bId}`);
      }
    }
  }
  return hits;
}

describe("autoLayout", () => {
  it("never puts two nodes on top of each other", () => {
    // Two separate branches, which is the shape that produced the stacking:
    // each parent offsets its own children and neither knows about the other.
    const nodes = [
      node("q", "question"),
      node("i1"),
      node("i2"),
      node("p1", "pro"),
      node("c1", "con"),
      node("p2", "pro"),
      node("c2", "con"),
    ];
    const edges = [
      edge("i1", "q"),
      edge("i2", "q"),
      edge("p1", "i1", "supports"),
      edge("c1", "i1", "objects_to"),
      edge("p2", "i2", "supports"),
      edge("c2", "i2", "objects_to"),
    ];
    expect(collisions(autoLayout(nodes, edges))).toEqual([]);
  });

  it("keeps several root questions apart", () => {
    const nodes = [node("q1", "question"), node("q2", "question"), node("q3", "question")];
    expect(collisions(autoLayout(nodes, []))).toEqual([]);
  });

  it("puts children below their parent", () => {
    const pos = autoLayout(
      [node("q", "question"), node("i")],
      [edge("i", "q")],
    );
    expect(pos.get("i")!.y).toBeGreaterThan(pos.get("q")!.y);
  });

  it("centres a parent over its children", () => {
    const pos = autoLayout(
      [node("q", "question"), node("a"), node("b")],
      [edge("a", "q"), edge("b", "q")],
    );
    const mid = (pos.get("a")!.x + pos.get("b")!.x) / 2;
    expect(Math.abs(pos.get("q")!.x - mid)).toBeLessThan(2);
  });

  it("is stable: the same graph lays out the same way twice", () => {
    // Auto layout now runs on every change, so an unstable result would make
    // the canvas twitch continuously.
    const nodes = [node("q", "question"), node("a"), node("b", "pro")];
    const edges = [edge("a", "q"), edge("b", "a", "supports")];
    expect([...autoLayout(nodes, edges)]).toEqual([...autoLayout(nodes, edges)]);
  });

  it("does not drop nodes joined only by relates_to", () => {
    const nodes = [node("q", "question"), node("n", "note")];
    const pos = autoLayout(nodes, [edge("n", "q", "relates_to")]);
    expect(pos.size).toBe(2);
    expect(collisions(pos)).toEqual([]);
  });

  /**
   * Notes used to be excluded from the tree because `relates_to` is not a
   * hierarchical relationship — a distinction that matters for cycle checking
   * and says nothing about where a card should sit. Having no parent made them
   * roots, so they lined up along the top beside the root questions instead of
   * under whatever they annotate.
   */
  it("hangs a note under what it relates to", () => {
    const pos = autoLayout(
      [node("q", "question"), node("i"), node("n", "note")],
      [edge("i", "q"), edge("n", "i", "relates_to")],
    );
    expect(pos.get("n")!.y).toBeGreaterThan(pos.get("i")!.y);
  });

  it("nests a note as deeply as the thing it annotates", () => {
    // A note on a Pro belongs beneath that Pro, not level with the question.
    const pos = autoLayout(
      [node("q", "question"), node("i"), node("p", "pro"), node("n", "note")],
      [edge("i", "q"), edge("p", "i", "supports"), edge("n", "p", "relates_to")],
    );
    expect(pos.get("n")!.y).toBeGreaterThan(pos.get("p")!.y);
    expect(pos.get("n")!.y).toBeGreaterThan(pos.get("i")!.y);
  });

  it("treats the note as the child whichever way the link was drawn", () => {
    // The grammar allows "Note relates to X" and "X relates to a Note". Only
    // one of those readings puts the note in a sensible place.
    const pos = autoLayout(
      [node("q", "question"), node("i"), node("n", "note")],
      [edge("i", "q"), edge("i", "n", "relates_to")],
    );
    expect(pos.get("n")!.y).toBeGreaterThan(pos.get("i")!.y);
  });

  it("still leaves a note attached to nothing as its own root", () => {
    const pos = autoLayout([node("q", "question"), node("loose", "note")], []);
    expect(pos.get("loose")!.y).toBe(pos.get("q")!.y);
    expect(collisions(pos)).toEqual([]);
  });

  it("places every node exactly once", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node(id));
    const pos = autoLayout(nodes, [edge("b", "a"), edge("c", "a"), edge("d", "b")]);
    expect([...pos.keys()].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("terminates on a cycle rather than hanging", () => {
    const nodes = [node("a"), node("b")];
    const pos = autoLayout(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(pos.size).toBe(2);
  });
});

describe("freeSpot", () => {
  it("returns the requested spot when it is empty", () => {
    expect(freeSpot(100, 200, [])).toEqual({ x: 100, y: 200 });
  });

  it("moves clear of an occupied spot", () => {
    // This is what stops two branches dropping a card in the same place: the
    // guessed offset knows nothing about anyone else's children.
    const taken = [{ x: 100, y: 200 }];
    const got = freeSpot(100, 200, taken);
    expect(collisions(new Map([["new", got], ["old", taken[0]]]))).toEqual([]);
  });

  it("finds a gap in a crowded column", () => {
    const taken = Array.from({ length: 6 }, (_, i) => ({ x: 100, y: 200 + i * (NODE_H + 58) }));
    const got = freeSpot(100, 200, taken);
    const all = new Map(taken.map((t, i) => [`t${i}`, t]));
    all.set("new", got);
    expect(collisions(all)).toEqual([]);
  });

  it("gives up instead of looping forever", () => {
    // A pathological map should produce a crowded canvas, not a hung tab.
    const taken = Array.from({ length: 400 }, (_, i) => ({
      x: 100 + (i % 2) * 264,
      y: 200 + Math.floor(i / 2) * 102,
    }));
    expect(() => freeSpot(100, 200, taken)).not.toThrow();
  });
});
