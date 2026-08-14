import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraph } from "../store/useGraph";
import { NODE_GLYPHS, NODE_LABELS, type DMNode } from "../types";

export interface NodeCardData extends Record<string, unknown> {
  node: DMNode;
  dimmed: boolean;
}

/**
 * A node on the canvas.
 *
 * Kept deliberately sparse: a glyph, a title, and small status markers. Bodies,
 * images, links and tags live in the sidebar. A canvas where every node shows
 * its full content stops being readable at about thirty nodes, which is well
 * below the size where a dialog map starts being useful.
 */
function NodeCardImpl({ data, selected }: NodeProps) {
  const { node, dimmed } = data as unknown as NodeCardData;
  const editing = useGraph((s) => s.editingId === node.id);
  const commitTitle = useGraph((s) => s.commitTitle);
  const cancelEdit = useGraph((s) => s.cancelEdit);

  const [draft, setDraft] = useState(node.title);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(node.title);

    // Focusing on a single animation frame is not enough, and the way it fails
    // is silent. React Flow renders a newly added node with visibility:hidden
    // until it has measured it, and focus() on a hidden element is a no-op
    // that reports no error. The editor opened, the caret never arrived, and
    // everything the facilitator typed next went nowhere — which breaks the
    // capture loop entirely.
    //
    // So retry across frames until the focus actually takes, with a deadline
    // so a node that never becomes visible cannot spin forever.
    let raf = 0;
    const deadline = performance.now() + 1000;
    const tryFocus = () => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if (document.activeElement === el) {
          el.select();
          return;
        }
      }
      if (performance.now() < deadline) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [editing, node.title]);

  const status = node.content.status;
  const shared = node.mapCount > 1;

  return (
    <div
      className={[
        "node",
        `node--${node.type}`,
        selected ? "is-selected" : "",
        dimmed ? "is-dimmed" : "",
        status === "resolved" ? "is-resolved" : "",
        status === "rejected" ? "is-rejected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`node-${node.id}`}
    >
      {/* Both handles sit on every node; the IBIS grammar, not the UI, decides
          whether a dragged connection is legal.

          Source on top, target on bottom — which looks backwards until you
          remember IBIS edges point child to parent ("this Pro supports that
          Idea") while the layout puts children underneath. With the handles
          the other way round, every edge left the child's bottom edge and
          looped back up to the parent, crossing its own node. */}
      <Handle type="source" position={Position.Top} className="node__handle" />
      <Handle type="target" position={Position.Bottom} className="node__handle" />

      <header className="node__head">
        <span className="node__glyph" title={NODE_LABELS[node.type]} aria-hidden>
          {NODE_GLYPHS[node.type]}
        </span>
        <span className="node__type">{NODE_LABELS[node.type]}</span>

        <span className="node__badges">
          {shared && (
            <span
              className="badge badge--shared"
              title={`Shared with ${node.mapCount - 1} other map${
                node.mapCount > 2 ? "s" : ""
              }. Editing here changes it everywhere.`}
            >
              ✳{node.mapCount}
            </span>
          )}
          {status === "resolved" && (
            <span className="badge badge--resolved" title="Resolved">✓</span>
          )}
          {status === "parked" && (
            <span className="badge badge--parked" title="Parked">◷</span>
          )}
          {node.content.assets.length > 0 && (
            <span className="badge" title={`${node.content.assets.length} attachment(s)`}>
              ▤
            </span>
          )}
        </span>
      </header>

      {editing ? (
        <textarea
          ref={inputRef}
          className="node__input nodrag nowheel"
          value={draft}
          rows={2}
          placeholder={placeholderFor(node.type)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitTitle(node.id, draft.trim())}
          onKeyDown={(e) => {
            // Enter commits and returns focus to the canvas with the node
            // still selected, so `+` or `q` continues the thought.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              void commitTitle(node.id, draft.trim());
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(node.title);
              cancelEdit();
              return;
            }
            // Modified keystrokes are application shortcuts, not text, so they
            // must reach the window handler. Swallowing everything here meant
            // Ctrl+Z inside a title did nothing at all: the global undo
            // intercept existed but the event never got to it.
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            // Everything else is plain typing and belongs to the field. It is
            // stopped here so a letter that is also a canvas shortcut — "n",
            // "q", "+" — does not create a node while the user is naming one.
            e.stopPropagation();
          }}
        />
      ) : (
        <p className="node__title">
          {node.title || <span className="node__placeholder">{placeholderFor(node.type)}</span>}
        </p>
      )}

      {node.content.tags.length > 0 && (
        <footer className="node__tags">
          {node.content.tags.slice(0, 3).map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
          {node.content.tags.length > 3 && (
            <span className="tag tag--more">+{node.content.tags.length - 3}</span>
          )}
        </footer>
      )}
    </div>
  );
}

function placeholderFor(type: DMNode["type"]): string {
  switch (type) {
    case "question":
      return "What is the question?";
    case "idea":
      return "What could we do?";
    case "pro":
      return "Why that works…";
    case "con":
      return "Why that fails…";
    case "map":
      return "Sub-map";
    default:
      return "Note…";
  }
}

// Re-render only when the node object, selection or dimming actually changes.
// Without this, panning a large map re-renders every card.
export const NodeCard = memo(NodeCardImpl, (a, b) => {
  const da = a.data as unknown as NodeCardData;
  const db = b.data as unknown as NodeCardData;
  return (
    da.node === db.node && da.dimmed === db.dimmed && a.selected === b.selected
  );
});

export default NodeCard;
