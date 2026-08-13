import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { describe, useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import { NODE_GLYPHS, NODE_LABELS, type DMNode } from "../types";

/**
 * Search and insert an existing node.
 *
 * This is the transclusion entry point, and the reason it is a first-class
 * keystroke (`/`) rather than a buried menu item: reuse only happens if it is
 * faster than retyping. Results are scoped to nodes *not* already on this map,
 * because the useful question here is "what have we already said elsewhere?".
 */
export function SearchPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);

  const mapId = useGraph((s) => s.mapId);
  const maps = useGraph((s) => s.maps);
  const insertExisting = useGraph((s) => s.insertExisting);
  const toast = useGraph((s) => s.toast);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<DMNode[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced so a fast typist issues one query, not one per character.
  useEffect(() => {
    if (!open || !mapId) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .search(q, mapId, 25)
        .then((nodes) => {
          if (!cancelled) {
            setResults(nodes);
            setCursor(0);
          }
        })
        .catch((err) => !cancelled && toast(describe(err)))
        .finally(() => !cancelled && setBusy(false));
    }, 130);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, mapId, toast]);

  if (!open) return null;

  const choose = (node: DMNode) => {
    void insertExisting(node.id);
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search every map for a node to insert…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") return setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === "Enter" && results[cursor]) {
              e.preventDefault();
              choose(results[cursor]);
            }
          }}
        />

        <div className="palette__hint">
          Inserting shares the node — it is not copied. Edits apply to every map it appears in.
        </div>

        <ul className="palette__results">
          {results.map((n, i) => (
            <li
              key={n.id}
              className={i === cursor ? "is-active" : ""}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(n)}
            >
              <span className={`glyph glyph--${n.type}`}>{NODE_GLYPHS[n.type]}</span>
              <span className="palette__title">{n.title || "untitled"}</span>
              <span className="palette__meta">
                {NODE_LABELS[n.type]}
                {n.mapCount > 0 && (
                  <>
                    {" · "}
                    {mapNames(n, maps)}
                  </>
                )}
              </span>
            </li>
          ))}
          {!busy && results.length === 0 && (
            <li className="palette__empty">
              {q
                ? "Nothing matched outside this map."
                : "Every node in the project appears here. Start typing to narrow it down."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function mapNames(node: DMNode, maps: { id: string; name: string }[]): string {
  const names = (node.mapIds ?? [])
    .map((id) => maps.find((m) => m.id === id)?.name)
    .filter(Boolean) as string[];
  if (names.length === 0) return "unplaced";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} +${names.length - 1} more`;
}

export default SearchPalette;
