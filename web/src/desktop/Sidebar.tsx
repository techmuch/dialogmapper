import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { canRetype } from "../grammar";
import { describe, useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import MultiSelectPanel from "./MultiSelectPanel";
import {
  NODE_GLYPHS,
  NODE_LABELS,
  REL_LABELS,
  type Asset,
  type DMNode,
  type NodeType,
  type Status,
} from "../types";

const TYPES: NodeType[] = ["question", "idea", "pro", "con", "note"];
const STATUSES: Status[] = ["open", "resolved", "parked", "rejected"];

/**
 * The details panel.
 *
 * Everything that would clutter the canvas lives here: the markdown body,
 * tags, status, images, links, and the list of other maps a shared node
 * appears in. The panel is deliberately not modal — the canvas stays live and
 * keyboard-driven while it is open.
 */
export function Sidebar() {
  const open = useUI((s) => s.sidebarOpen);
  const toggle = useUI((s) => s.toggleSidebar);
  const setTagFilter = useUI((s) => s.setTagFilter);

  const selectedId = useGraph((s) => s.selectedId);
  const multiSelected = useGraph((s) => s.multiSelected);
  const node = useGraph((s) => (s.selectedId ? s.nodes[s.selectedId] : null));
  const allNodes = useGraph((s) => s.nodes);

  // Resolved here rather than in the child so the panel choice and its data
  // come from one place.
  const selectedNodes = useMemo(() => {
    const ids = selectedId ? [selectedId, ...multiSelected] : [...multiSelected];
    return ids.map((id) => allNodes[id]).filter(Boolean) as DMNode[];
  }, [selectedId, multiSelected, allNodes]);
  const edges = useGraph((s) => s.edges);
  const nodes = useGraph((s) => s.nodes);
  // The server's own published ruleset, used to show which type changes are
  // possible before the user tries one.
  const grammar = useGraph((s) => s.grammar);
  const maps = useGraph((s) => s.maps);
  const mapId = useGraph((s) => s.mapId);
  const patchNode = useGraph((s) => s.patchNode);
  const removeFromMap = useGraph((s) => s.removeFromMap);
  const deleteEverywhere = useGraph((s) => s.deleteEverywhere);
  const toast = useGraph((s) => s.toast);

  const [body, setBody] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBody(node?.content.markdown ?? "");
    setTagDraft("");
  }, [selectedId, node?.content.markdown]);

  // The relationships this node participates in, resolved to titles so the
  // panel reads as sentences rather than ids.
  const relations = useMemo(() => {
    if (!node) return { out: [], in: [] };
    const out = Object.values(edges)
      .filter((e) => e.sourceNodeId === node.id)
      .map((e) => ({ edge: e, other: nodes[e.targetNodeId] }))
      .filter((r) => r.other);
    const incoming = Object.values(edges)
      .filter((e) => e.targetNodeId === node.id)
      .map((e) => ({ edge: e, other: nodes[e.sourceNodeId] }))
      .filter((r) => r.other);
    return { out, in: incoming };
  }, [node, edges, nodes]);

  if (!open) return null;

  // More than one node selected: title and body have no meaning across a set,
  // so the panel switches to the things that do.
  if (selectedNodes.length > 1) {
    return <MultiSelectPanel nodes={selectedNodes} />;
  }

  if (!node) {
    return (
      <aside className="sidebar">
        <header className="sidebar__head">
          <h2>Details</h2>
          <button className="icon-btn" onClick={() => toggle(false)} title="Close (Tab)">×</button>
        </header>
        <p className="sidebar__empty">
          Select a node to edit its body, tags, status and attachments.
        </p>
      </aside>
    );
  }

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      const uploaded: Asset[] = [];
      for (const file of Array.from(files)) {
        const { asset } = await api.uploadAsset(file, node.id);
        uploaded.push(asset);
      }
      await patchNode(node.id, { assets: [...node.content.assets, ...uploaded] });
    } catch (err) {
      toast(describe(err));
    } finally {
      setUploading(false);
    }
  };

  const otherMaps = (node.mapIds ?? []).filter((id) => id !== mapId);

  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <h2>
          <span className={`glyph glyph--${node.type}`}>{NODE_GLYPHS[node.type]}</span>
          {NODE_LABELS[node.type]}
        </h2>
        <button className="icon-btn" onClick={() => toggle(false)} title="Close (Tab)">×</button>
      </header>

      <div className="sidebar__body">
        <label className="field">
          <span className="field__label">Title</span>
          <textarea
            className="field__input"
            rows={2}
            value={node.title}
            onChange={(e) => void patchNode(node.id, { title: e.target.value })}
          />
        </label>

        <div className="field">
          <span className="field__label">Type</span>
          <div className="chips">
            {TYPES.map((t) => {
              // Changing type relabels the node's edges, because a
              // relationship is a reading of the types at each end. Some
              // changes have no legal reading at all — nothing connects a Pro
              // to a Question — so those are shown as unavailable rather than
              // being offered and then refused.
              const check = canRetype(grammar, node, t, Object.values(edges), nodes);
              return (
                <button
                  key={t}
                  className={`chip chip--${t} ${node.type === t ? "is-on" : ""}`}
                  disabled={!check.ok}
                  onClick={() => void patchNode(node.id, { type: t })}
                  title={
                    check.ok
                      ? `Change to ${NODE_LABELS[t]} — links are relabelled to match`
                      : check.reason
                  }
                >
                  {NODE_GLYPHS[t]} {NODE_LABELS[t]}
                </button>
              );
            })}
          </div>
          {TYPES.some(
            (t) => !canRetype(grammar, node, t, Object.values(edges), nodes).ok,
          ) && (
            <p className="multi__note">
              Greyed-out types have no legal relationship to something this node is
              attached to.
            </p>
          )}
        </div>

        <div className="field">
          <span className="field__label">Status</span>
          <div className="chips">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip ${node.content.status === s ? "is-on" : ""}`}
                onClick={() => void patchNode(node.id, { status: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Body (Markdown)</span>
          <textarea
            className="field__input field__input--tall"
            rows={8}
            value={body}
            placeholder="Detail, evidence, caveats — anything too long for the canvas."
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => {
              if (body !== node.content.markdown) void patchNode(node.id, { markdown: body });
            }}
          />
        </label>

        <div className="field">
          <span className="field__label">Tags</span>
          <div className="chips">
            {node.content.tags.map((t) => (
              <span key={t} className="chip chip--tag">
                <button className="chip__text" onClick={() => setTagFilter(t)} title={`Filter by #${t}`}>
                  #{t}
                </button>
                <button
                  className="chip__x"
                  onClick={() =>
                    void patchNode(node.id, {
                      tags: node.content.tags.filter((x) => x !== t),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            className="field__input"
            placeholder="Add a tag and press Enter"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== "Enter") return;
              const t = tagDraft.trim().toLowerCase().replace(/^#/, "");
              if (!t) return;
              void patchNode(node.id, { tags: [...node.content.tags, t] });
              setTagDraft("");
            }}
          />
        </div>

        <div
          ref={dropRef}
          className={`dropzone ${uploading ? "is-busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            dropRef.current?.classList.add("is-over");
          }}
          onDragLeave={() => dropRef.current?.classList.remove("is-over")}
          onDrop={(e) => {
            e.preventDefault();
            dropRef.current?.classList.remove("is-over");
            if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
          }}
        >
          {uploading ? "Saving…" : "Drop images here — they are saved into .assets/"}
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md"
            onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
          />
        </div>

        {node.content.assets.length > 0 && (
          <div className="field">
            <span className="field__label">Attachments</span>
            <div className="assets">
              {node.content.assets.map((a) => (
                <figure key={a.path} className="asset">
                  {a.kind === "image" ? (
                    <img src={a.path} alt={a.caption ?? ""} loading="lazy" />
                  ) : (
                    <a href={a.path} target="_blank" rel="noreferrer">{a.caption || a.path}</a>
                  )}
                  <button
                    className="asset__x"
                    title="Detach (the file stays in .assets/)"
                    onClick={() =>
                      void patchNode(node.id, {
                        assets: node.content.assets.filter((x) => x.path !== a.path),
                      })
                    }
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          </div>
        )}

        {(relations.in.length > 0 || relations.out.length > 0) && (
          <div className="field">
            <span className="field__label">Relationships</span>
            <ul className="relations">
              {relations.out.map(({ edge, other }) => (
                <li key={edge.id}>
                  <em>this</em> {REL_LABELS[edge.relationshipType]}{" "}
                  <button className="linky" onClick={() => useGraph.getState().select(other!.id)}>
                    {other!.title || "untitled"}
                  </button>
                </li>
              ))}
              {relations.in.map(({ edge, other }) => (
                <li key={edge.id}>
                  <button className="linky" onClick={() => useGraph.getState().select(other!.id)}>
                    {other!.title || "untitled"}
                  </button>{" "}
                  {REL_LABELS[edge.relationshipType]} <em>this</em>
                </li>
              ))}
            </ul>
          </div>
        )}

        {node.mapCount > 1 && (
          <div className="field callout">
            <span className="field__label">Shared node ✳{node.mapCount}</span>
            <p>
              This node also appears in{" "}
              {otherMaps
                .map((id) => maps.find((m) => m.id === id)?.name ?? "another map")
                .join(", ")}
              . Edits here apply everywhere.
            </p>
          </div>
        )}

        <div className="sidebar__danger">
          <button className="btn btn--ghost" onClick={() => void removeFromMap(node.id)}>
            Remove from this map
          </button>
          <button
            className="btn btn--danger"
            onClick={() => {
              const warning =
                node.mapCount > 1
                  ? `Delete from all ${node.mapCount} maps? This cannot be undone.`
                  : "Delete this node? This cannot be undone.";
              if (confirm(warning)) void deleteEverywhere(node.id);
            }}
          >
            Delete everywhere
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
