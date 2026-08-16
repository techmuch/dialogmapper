import { useMemo, useState } from "react";
import { useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import {
  NODE_GLYPHS,
  NODE_LABELS,
  type DMNode,
  type NodeType,
  type Status,
} from "../types";

const STATUSES: Status[] = ["open", "resolved", "parked", "rejected"];

/**
 * How a value is distributed across the selection.
 *
 * The distinction between "all" and "some" is the whole point of this panel.
 * Flattening them would make the controls lie: a tag on one node of five would
 * look identical to a tag on all five, so removing it would appear to do
 * nothing, and adding it would look redundant.
 */
type Coverage = "all" | "some" | "none";

function coverageOf(nodes: DMNode[], has: (n: DMNode) => boolean): Coverage {
  const count = nodes.filter(has).length;
  if (count === 0) return "none";
  return count === nodes.length ? "all" : "some";
}

/**
 * The details panel when more than one node is selected.
 *
 * Editing a title or a body makes no sense across a selection, so this shows
 * only the things that genuinely apply to a set: what is in it, its tags, and
 * its status.
 */
export function MultiSelectPanel({ nodes }: { nodes: DMNode[] }) {
  const bulkUpdate = useGraph((s) => s.bulkUpdate);
  const groupSelection = useGraph((s) => s.groupSelection);
  const select = useGraph((s) => s.select);
  const setTagFilter = useUI((s) => s.setTagFilter);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (ops: Parameters<typeof bulkUpdate>[0]) => {
    setBusy(true);
    try {
      await bulkUpdate(ops);
    } finally {
      setBusy(false);
    }
  };

  // What is actually in the selection, so the user can see whether it is what
  // they meant before changing forty nodes at once.
  const byType = useMemo(() => {
    const counts = new Map<NodeType, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  const sharedCount = nodes.filter((n) => n.mapCount > 1).length;

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const n of nodes) for (const t of n.content.tags) all.add(t);
    return [...all]
      .sort()
      .map((tag) => ({
        tag,
        coverage: coverageOf(nodes, (n) => n.content.tags.includes(tag)),
        count: nodes.filter((n) => n.content.tags.includes(tag)).length,
      }));
  }, [nodes]);

  const statusCoverage = (s: Status) => coverageOf(nodes, (n) => n.content.status === s);

  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <h2>{nodes.length} nodes selected</h2>
        <button className="icon-btn" onClick={() => select(null)} title="Clear selection">
          ×
        </button>
      </header>

      <div className="sidebar__body">
        <div className="field">
          <span className="field__label">Selection</span>
          <div className="chips">
            {byType.map(([type, count]) => (
              <span key={type} className="chip chip--static">
                <span className={`glyph glyph--${type}`}>{NODE_GLYPHS[type]}</span>
                {count} {NODE_LABELS[type]}
                {count > 1 ? "s" : ""}
              </span>
            ))}
          </div>
          {sharedCount > 0 && (
            <p className="multi__note">
              ✳ {sharedCount} of these {sharedCount === 1 ? "is" : "are"} shared with other
              maps. Edits here apply everywhere.
            </p>
          )}
        </div>

        <div className="field">
          <span className="field__label">Status</span>
          <div className="chips">
            {STATUSES.map((s) => {
              const cov = statusCoverage(s);
              return (
                <button
                  key={s}
                  className={`chip chip--tri is-${cov}`}
                  disabled={busy}
                  onClick={() => void run({ status: s })}
                  // A faded chip means "some of these", and clicking it still
                  // applies to all — the fade is information, not a dead end.
                  title={
                    cov === "all"
                      ? `All ${nodes.length} are ${s}`
                      : cov === "some"
                        ? `Some are ${s} — click to set all ${nodes.length}`
                        : `Set all ${nodes.length} to ${s}`
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Tags</span>
          {tags.length > 0 && (
            <div className="chips">
              {tags.map(({ tag, coverage, count }) => (
                <span key={tag} className={`chip chip--tag chip--tri is-${coverage}`}>
                  <button
                    className="chip__text"
                    disabled={busy}
                    onClick={() =>
                      // Faded means only some have it: the useful next move is
                      // to bring the rest up. Solid means all have it, so the
                      // next move is to take it off.
                      void run(
                        coverage === "all"
                          ? { removeTags: [tag] }
                          : { addTags: [tag] },
                      )
                    }
                    title={
                      coverage === "all"
                        ? `On all ${nodes.length} — click to remove from all`
                        : `On ${count} of ${nodes.length} — click to add to all`
                    }
                  >
                    #{tag}
                    {coverage === "some" && (
                      <span className="chip__count">
                        {count}/{nodes.length}
                      </span>
                    )}
                  </button>
                  <button
                    className="chip__x"
                    disabled={busy}
                    title="Remove from all selected"
                    onClick={() => void run({ removeTags: [tag] })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className="field__input"
            placeholder={`Add a tag to all ${nodes.length}…`}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== "Enter") return;
              const t = draft.trim().toLowerCase().replace(/^#/, "");
              if (!t) return;
              void run({ addTags: [t] });
              setDraft("");
            }}
          />
          {tags.some((t) => t.coverage === "some") && (
            <p className="multi__note">
              Faded tags are only on some of the selection. Clicking one adds it to all.
            </p>
          )}
        </div>

        <div className="field">
          <span className="field__label">Arrange</span>
          <button className="btn" onClick={() => void groupSelection()}>
            ⬚ Group these {nodes.length} nodes
          </button>
          <p className="multi__note">
            Grouped nodes move together. The outline follows wherever they are.
          </p>
        </div>

        <div className="field">
          <span className="field__label">Filter</span>
          <div className="chips">
            {tags.map(({ tag }) => (
              <button key={tag} className="chip" onClick={() => setTagFilter(tag)}>
                #{tag}
              </button>
            ))}
            {tags.length === 0 && (
              <span className="multi__note">No tags on these nodes yet.</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export default MultiSelectPanel;
