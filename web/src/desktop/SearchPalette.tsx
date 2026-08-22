import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { describe, useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import { NODE_GLYPHS, NODE_LABELS, type DMNode } from "../types";
import { parseQuery } from "../search";

/**
 * Find a node, then either go to it or bring it here.
 *
 * The palette used to do only the second thing, and searched only nodes *not*
 * on the current map so that inserting could never duplicate. That made it
 * useless for the more common need — "where did we say that?" — because the
 * nodes you are most likely to be looking for are the ones in front of you.
 *
 * So it searches the whole project now, and the two actions are separated by
 * key rather than by scope: Enter goes to the node, Option-Enter brings it in
 * under whatever is selected. Insert stays available on every row as a button,
 * because a modifier chord is not discoverable on its own.
 */
export function SearchPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);

  const mapId = useGraph((s) => s.mapId);
  const maps = useGraph((s) => s.maps);
  const nodes = useGraph((s) => s.nodes);
  const selectedId = useGraph((s) => s.selectedId);
  const insertExisting = useGraph((s) => s.insertExisting);
  const openMap = useGraph((s) => s.openMap);
  const select = useGraph((s) => s.select);
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
      // Results too, not just the query. Keeping the last search's rows on
      // screen under an empty box means the first Enter after reopening can
      // land on whatever was highlighted last time — which, now that Enter
      // moves the canvas, sends you somewhere you never asked to go.
      setResults([]);
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
        // No excludeMapId: you cannot jump to a node the search refused to
        // return, and "already here" is a label, not a reason to hide a row.
        .search(q, undefined, 25)
        .then((found) => {
          if (!cancelled) {
            setResults(found);
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

  const queryType = parseQuery(q).type;
  const here = (n: DMNode) => n.id in nodes;
  const parent = selectedId ? nodes[selectedId] : null;

  /** Go to the node, opening its map first when it lives on another one. */
  const jump = (n: DMNode) => {
    setOpen(false);
    if (here(n)) {
      select(n.id);
      useUI.getState().jumpTo?.(n.id);
      return;
    }
    const home = (n.mapIds ?? []).find((id) => id !== mapId);
    if (!home) {
      // Every node the search can return is on some map, so this is the
      // belt-and-braces case rather than an expected one.
      toast(`"${n.title}" is not on any map yet.`, "info");
      return;
    }
    // The node does not exist on this canvas yet; the switch has to finish
    // first, so the centring is handed to the canvas to perform on arrival.
    useUI.getState().setPendingJump(n.id);
    void openMap(home);
  };

  /** Bring the node onto this map, under the selection if there is one. */
  const insert = (n: DMNode) => {
    if (here(n)) {
      toast(`"${n.title}" is already on this map.`, "info");
      return;
    }
    void insertExisting(n.id, parent?.id);
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search every map — start with ? ! + − . for one type"
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
              // altKey is Option on a Mac and Alt elsewhere, which is the
              // same physical key in both cases.
              if (e.altKey) insert(results[cursor]);
              else jump(results[cursor]);
            }
          }}
        />

        <div className="palette__hint">
          {queryType && (
            <span className={`type-badge type-badge--${queryType}`}>
              {NODE_GLYPHS[queryType]} {NODE_LABELS[queryType]}s only
            </span>
          )}{" "}
          <kbd>↵</kbd> go to it · <kbd>⌥↵</kbd>{" "}
          {parent ? (
            <>
              insert under <strong>{parent.title || "the selected node"}</strong>
            </>
          ) : (
            "insert here, unattached"
          )}
          . Inserting shares the node — it is not copied.
        </div>

        <ul className="palette__results">
          {results.map((n, i) => (
            <li
              key={n.id}
              className={`${i === cursor ? "is-active" : ""} ${here(n) ? "is-here" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => jump(n)}
            >
              <span className={`glyph glyph--${n.type}`}>{NODE_GLYPHS[n.type]}</span>
              <span className="palette__title">{n.title || "untitled"}</span>
              <span className="palette__meta">
                {NODE_LABELS[n.type]}
                {" · "}
                {whereItLives(n, mapId, maps)}
              </span>
              <button
                type="button"
                className="palette__insert"
                // Not `disabled`: the row still responds, and a control that
                // ignores the pointer cannot explain why it did nothing.
                data-unavailable={here(n) ? "true" : undefined}
                aria-label={
                  here(n)
                    ? `${n.title} is already on this map`
                    : parent
                      ? `Insert ${n.title} under ${parent.title || "the selected node"}`
                      : `Insert ${n.title}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  insert(n);
                }}
              >
                {here(n) ? "On this map" : "Insert"}
              </button>
            </li>
          ))}
          {!busy && results.length === 0 && (
            <li className="palette__empty">
              {q
                ? queryType
                  ? `No ${NODE_LABELS[queryType]} matched.`
                  : "Nothing matched."
                : "Every node in the project appears here. Start typing to narrow it down."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Where a node lives, from the reader's point of view.
 *
 * "On this map" is the thing worth saying first, because it decides which of
 * the two actions is available.
 */
function whereItLives(
  node: DMNode,
  mapId: string | null,
  maps: { id: string; name: string }[],
): string {
  const ids = node.mapIds ?? [];
  const elsewhere = ids
    .filter((id) => id !== mapId)
    .map((id) => maps.find((m) => m.id === id)?.name)
    .filter(Boolean) as string[];

  if (ids.includes(mapId ?? "")) {
    return elsewhere.length === 0
      ? "on this map"
      : `on this map +${elsewhere.length} more`;
  }
  if (elsewhere.length === 0) return "unplaced";
  if (elsewhere.length <= 2) return elsewhere.join(", ");
  return `${elsewhere[0]} +${elsewhere.length - 1} more`;
}

export default SearchPalette;
