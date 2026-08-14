import { useState } from "react";
import { api } from "../api";
import { useGraph } from "../store/useGraph";
import { isFilterActive, useUI, type FilterPreset } from "../store/useUI";
import { NODE_GLYPHS, type NodeType } from "../types";

const PRESETS: { key: FilterPreset; label: string; hint: string }[] = [
  { key: "all", label: "Everything", hint: "No filter" },
  {
    key: "openQuestions",
    label: "Open questions",
    hint: "Unresolved Questions and the Ideas answering them",
  },
  { key: "unresolved", label: "Unresolved", hint: "Anything not yet resolved or rejected" },
  { key: "shared", label: "Shared", hint: "Nodes transcluded into other maps" },
];

const TYPES: NodeType[] = ["question", "idea", "pro", "con", "note"];

export function Toolbar() {
  const maps = useGraph((s) => s.maps);
  const map = useGraph((s) => s.map);
  const openMap = useGraph((s) => s.openMap);
  const connected = useGraph((s) => s.connected);
  const nodeCount = useGraph((s) => Object.keys(s.nodes).length);
  const runAutoLayout = useGraph((s) => s.runAutoLayout);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const undoDepth = useGraph((s) => s.undoDepth);
  const redoDepth = useGraph((s) => s.redoDepth);
  const nextUndoLabel = useGraph((s) => s.nextUndoLabel);
  const nextRedoLabel = useGraph((s) => s.nextRedoLabel);

  const ui = useUI();
  const [creating, setCreating] = useState(false);

  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <span className="brand" title="dialogmapper">◇</span>

        <select
          className="toolbar__map"
          value={map?.id ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new") return setCreating(true);
            void openMap(e.target.value);
          }}
        >
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.nodeCount ?? 0})
            </option>
          ))}
          <option value="__new">+ New map…</option>
        </select>

        {creating && (
          <NewMapField
            onCancel={() => setCreating(false)}
            onDone={() => setCreating(false)}
          />
        )}

        <span className="toolbar__count">{nodeCount} nodes</span>
      </div>

      <div className="toolbar__center">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`pill ${ui.filterPreset === p.key ? "is-on" : ""}`}
            title={p.hint}
            onClick={() => ui.setFilterPreset(p.key)}
          >
            {p.label}
          </button>
        ))}

        <span className="toolbar__types">
          {TYPES.map((t) => (
            <button
              key={t}
              className={`type-toggle type-toggle--${t} ${ui.typeFilter.has(t) ? "is-on" : ""}`}
              title={`Toggle ${t}`}
              onClick={() => ui.toggleType(t)}
            >
              {NODE_GLYPHS[t]}
            </button>
          ))}
        </span>

        <input
          className="toolbar__search"
          placeholder="Filter on this map…"
          value={ui.filterQuery}
          onChange={(e) => ui.setFilterQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />

        {isFilterActive(ui) && (
          <button className="pill pill--clear" onClick={ui.resetFilters}>
            Clear
          </button>
        )}
      </div>

      <div className="toolbar__right">
        <span className="toolbar__undo">
          <button
            className="pill pill--icon"
            disabled={undoDepth === 0}
            onClick={() => void undo()}
            title={
              nextUndoLabel
                ? `Undo: ${nextUndoLabel}  (${modKey()}Z)`
                : "Nothing to undo"
            }
          >
            ↶
          </button>
          <button
            className="pill pill--icon"
            disabled={redoDepth === 0}
            onClick={() => void redo()}
            title={
              nextRedoLabel
                ? `Redo: ${nextRedoLabel}  (${modKey()}⇧Z)`
                : "Nothing to redo"
            }
          >
            ↷
          </button>
        </span>

        <button
          className={`pill ${ui.layoutMode === "auto" ? "is-on" : ""}`}
          title={
            ui.layoutMode === "auto"
              ? "Auto layout: positions are managed for you, dragging is off"
              : "Freeform: drag nodes wherever you like"
          }
          onClick={() => {
            const next = ui.layoutMode === "auto" ? "freeform" : "auto";
            ui.setLayoutMode(next);
            if (next === "auto") void runAutoLayout(true);
          }}
        >
          {ui.layoutMode === "auto" ? "Auto layout" : "Freeform"}
        </button>

        <button className="pill" onClick={() => void runAutoLayout(true)} title="Tidy up (L)">
          Tidy
        </button>

        <button className="pill" onClick={() => ui.setPalette(true)} title="Insert existing node (/)">
          Insert…
        </button>

        <button className="pill" onClick={ui.toggleMinimap} title="Toggle minimap">
          {ui.showMinimap ? "Minimap on" : "Minimap off"}
        </button>

        <button className="pill" onClick={() => ui.toggleSidebar()} title="Details (Tab)">
          Details
        </button>

        <button className="pill" onClick={() => ui.setHelp(true)} title="Keyboard help (?)">
          ?
        </button>

        <span
          className={`status-dot ${connected ? "is-up" : "is-down"}`}
          title={connected ? "Live — changes sync instantly" : "Reconnecting…"}
        />
      </div>
    </header>
  );
}

/** Shows ⌘ on Apple platforms and Ctrl elsewhere, so the tooltip is truthful. */
function modKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform ?? "") ? "⌘" : "Ctrl+";
}

function NewMapField({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const openMap = useGraph((s) => s.openMap);
  const toast = useGraph((s) => s.toast);

  return (
    <input
      autoFocus
      className="toolbar__newmap"
      placeholder="Name the map, Enter to create"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={onCancel}
      onKeyDown={async (e) => {
        e.stopPropagation();
        if (e.key === "Escape") return onCancel();
        if (e.key !== "Enter" || !name.trim()) return;
        try {
          const m = await api.createMap(name.trim());
          const maps = await api.listMaps();
          useGraph.setState({ maps });
          await openMap(m.id);
          onDone();
        } catch (err) {
          toast(String(err));
          onCancel();
        }
      }}
    />
  );
}

export default Toolbar;
