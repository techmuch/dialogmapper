import { useEffect } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import type { DMNode, NodeType, Relationship } from "../types";

/**
 * The capture loop.
 *
 * Dialog mapping happens live, while people are talking. The facilitator
 * cannot look away to find a menu, so every common move is one key and the
 * selection never has to be re-established by hand: creating a child selects
 * it, committing a title keeps it selected, and the next key acts on it.
 *
 * The design rule throughout: a keystroke should never require a mouse
 * correction afterwards.
 */

interface Options {
  flow: ReactFlowInstance | null;
  visibleNodes: DMNode[];
}

export function useKeyboard({ flow, visibleNodes }: Options) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const g = useGraph.getState();
      const ui = useUI.getState();

      // Undo is checked before the typing guard deliberately. Ctrl+Z inside a
      // node's title field would otherwise hit the browser's own text undo,
      // which knows nothing about the graph and leaves the user thinking undo
      // is broken. Committing the field first keeps the two models in step.
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && (ev.key === "z" || ev.key === "Z")) {
        ev.preventDefault();
        if (isTyping(ev.target)) (ev.target as HTMLElement).blur();
        if (ev.shiftKey) void g.redo();
        else void g.undo();
        return;
      }
      if (mod && (ev.key === "y" || ev.key === "Y")) {
        // Ctrl+Y is the Windows convention for redo.
        ev.preventDefault();
        if (isTyping(ev.target)) (ev.target as HTMLElement).blur();
        void g.redo();
        return;
      }

      // While typing, the only global keys are Escape and Enter, and the
      // node's own input handles those. Everything else belongs to the text.
      if (isTyping(ev.target)) return;

      // An editor being open is enough to disable the shortcuts, even if focus
      // has not reached it yet. React Flow hides a freshly added node until it
      // has measured it, so there is a window of a few frames after `q` where
      // the editor exists but cannot take focus. A fast typist types into that
      // gap, and every letter is a shortcut: "n" makes a note, space zooms to
      // fit. The result was stray nodes appearing mid-sentence.
      if (g.editingId) return;

      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      const selected = g.selectedId ? g.nodes[g.selectedId] : null;

      switch (ev.key) {
        // --- creation -----------------------------------------------------
        case "n":
        case "N": {
          ev.preventDefault();
          // With a Question selected the obvious next move is an answer, so
          // `n` yields an Idea. Anywhere else it is a Note.
          if (selected) {
            const type: NodeType = selected.type === "question" ? "idea" : "note";
            const rel: Relationship =
              selected.type === "question" ? "responds_to" : "relates_to";
            void g.createChild(selected.id, type, rel);
          } else {
            const c = centerOfViewport(flow);
            void g.createRoot("note", c.x, c.y);
          }
          return;
        }

        case "q":
        case "Q": {
          ev.preventDefault();
          if (selected) void g.createChild(selected.id, "question", "questions");
          else {
            const c = centerOfViewport(flow);
            void g.createRoot("question", c.x, c.y);
          }
          return;
        }

        case "i":
        case "I": {
          ev.preventDefault();
          if (selected?.type === "question") {
            void g.createChild(selected.id, "idea", "responds_to");
          } else {
            const c = centerOfViewport(flow);
            void g.createRoot("idea", c.x, c.y);
          }
          return;
        }

        case "+":
        case "=": {
          ev.preventDefault();
          if (!selected) return;
          // A Pro cannot attach to a bare Question under IBIS. Rather than
          // showing an error mid-flow, hop to the Idea the user means: the
          // one they were last working under.
          const anchor = argumentAnchor(g, selected);
          if (!anchor) {
            g.toast("Select an Idea first — a Pro supports an Idea, not a Question.");
            return;
          }
          void g.createChild(anchor.id, "pro", "supports");
          return;
        }

        case "-":
        case "_": {
          ev.preventDefault();
          if (!selected) return;
          const anchor = argumentAnchor(g, selected);
          if (!anchor) {
            g.toast("Select an Idea first — a Con objects to an Idea, not a Question.");
            return;
          }
          void g.createChild(anchor.id, "con", "objects_to");
          return;
        }

        // --- editing ------------------------------------------------------
        case "Enter":
        case "F2": {
          if (!selected) return;
          ev.preventDefault();
          g.beginEdit(selected.id);
          return;
        }

        case "Backspace":
        case "Delete": {
          if (!selected) return;
          ev.preventDefault();
          // Deleting a shared node from one map must not destroy it in the
          // others, so the default is always "remove from this map".
          if (selected.mapCount > 1) {
            g.toast(
              `Removed from this map. "${selected.title}" still appears in ${
                selected.mapCount - 1
              } other map${selected.mapCount > 2 ? "s" : ""}.`,
              "info",
            );
          }
          void g.removeFromMap(selected.id);
          return;
        }

        // --- navigation ---------------------------------------------------
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          ev.preventDefault();
          const dir = ev.key.replace("Arrow", "").toLowerCase() as Dir;
          const next = selected
            ? nearestInDirection(selected, visibleNodes, dir)
            : visibleNodes[0];
          if (!next) return;
          g.select(next.id);
          panTo(flow, next);
          return;
        }

        case " ": {
          ev.preventDefault();
          // Space means "show me where I am": centre on the selection, or fit
          // the whole map when nothing is selected.
          if (selected) panTo(flow, selected, 1.1);
          else void flow?.fitView({ padding: 0.2, duration: 300 });
          return;
        }

        case "g":
        case "G": {
          ev.preventDefault();
          // Grouping acts on the selection, so it needs at least two nodes.
          // groupSelection says so itself when there are fewer.
          void g.groupSelection();
          return;
        }

        case "a":
        case "A": {
          ev.preventDefault();
          // Select everything currently visible, which respects the filter —
          // "select all" meaning "all of what I can see" is what a filtered
          // view implies.
          g.setSelection(visibleNodes.map((n) => n.id));
          return;
        }

        case "Tab": {
          ev.preventDefault();
          ui.toggleSidebar();
          return;
        }

        // --- panels -------------------------------------------------------
        case "/": {
          ev.preventDefault();
          ui.setPalette(true);
          return;
        }

        case "?": {
          ev.preventDefault();
          ui.setHelp(!ui.helpOpen);
          return;
        }

        case "f":
        case "F": {
          ev.preventDefault();
          void flow?.fitView({ padding: 0.2, duration: 300 });
          return;
        }

        case "l":
        case "L": {
          ev.preventDefault();
          void g.runAutoLayout(true).then(() => {
            setTimeout(() => flow?.fitView({ padding: 0.2, duration: 300 }), 60);
          });
          return;
        }

        case "Escape": {
          if (ui.paletteOpen) ui.setPalette(false);
          else if (ui.helpOpen) ui.setHelp(false);
          else if (ui.sidebarOpen) ui.toggleSidebar(false);
          else g.select(null);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, visibleNodes]);
}

type Dir = "up" | "down" | "left" | "right";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * Arrow keys move by what the user sees, not by tree structure. A cone test
 * keeps "right" from jumping to something almost directly below, and distance
 * within the cone picks the obvious neighbour.
 */
function nearestInDirection(from: DMNode, all: DMNode[], dir: Dir): DMNode | null {
  const fx = from.placement?.x ?? 0;
  const fy = from.placement?.y ?? 0;

  let best: DMNode | null = null;
  let bestScore = Infinity;

  for (const n of all) {
    if (n.id === from.id) continue;
    const dx = (n.placement?.x ?? 0) - fx;
    const dy = (n.placement?.y ?? 0) - fy;

    const [along, across] =
      dir === "left" || dir === "right" ? [dx, dy] : [dy, dx];
    const forward = dir === "right" || dir === "down" ? along : -along;
    if (forward <= 1) continue;
    // Reject anything outside a ~60° cone: past that it reads as sideways.
    if (Math.abs(across) > forward * 1.8 + 60) continue;

    // Weight the cross-axis so a well-aligned distant node beats a skewed
    // close one, which is what "the next node over" means to a reader.
    const score = forward + Math.abs(across) * 1.6;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/**
 * A Pro or Con needs an Idea. If a Question is selected, walk to its most
 * recent Idea rather than refusing — the user is mid-sentence and an error
 * dialog would cost more than a sensible guess.
 */
function argumentAnchor(
  g: ReturnType<typeof useGraph.getState>,
  selected: DMNode,
): DMNode | null {
  if (selected.type !== "question") return selected;

  const answers = Object.values(g.edges)
    .filter((e) => e.targetNodeId === selected.id && e.relationshipType === "responds_to")
    .map((e) => g.nodes[e.sourceNodeId])
    .filter((n): n is DMNode => Boolean(n))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return answers[0] ?? null;
}

function centerOfViewport(flow: ReactFlowInstance | null) {
  if (!flow) return { x: 0, y: 0 };
  const { x, y, zoom } = flow.getViewport();
  return {
    x: (window.innerWidth / 2 - x) / zoom - 118,
    y: (window.innerHeight / 2 - y) / zoom - 44,
  };
}

function panTo(flow: ReactFlowInstance | null, node: DMNode, zoom?: number) {
  if (!flow || node.placement?.x == null) return;
  void flow.setCenter(node.placement.x + 118, (node.placement.y ?? 0) + 44, {
    duration: 220,
    zoom: zoom ?? flow.getZoom(),
  });
}
