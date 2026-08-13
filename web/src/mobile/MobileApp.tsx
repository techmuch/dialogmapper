import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { describe } from "../store/useGraph";
import { connectWS } from "../ws";
import {
  NODE_GLYPHS,
  NODE_LABELS,
  type DMMap,
  type DMNode,
  type NodeType,
  type Relationship,
} from "../types";
import "./mobile.css";

/**
 * The mobile surface.
 *
 * Not a shrunken canvas. Someone on a phone is a participant, not a
 * facilitator: they want to see what has just been said and add one thing to
 * it. So this is a reverse-chronological feed with a search box and a reply
 * form, and no spatial layout at all.
 *
 * Everything written here reaches the desktop canvas immediately over the same
 * WebSocket, where auto-layout places it.
 */
export function MobileApp() {
  const [maps, setMaps] = useState<DMMap[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [feed, setFeed] = useState<DMNode[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DMNode[] | null>(null);
  const [replyTo, setReplyTo] = useState<DMNode | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const ms = await api.listMaps();
        setMaps(ms);
        const initial = localStorage.getItem("dm:lastMap") ?? ms[0]?.id ?? null;
        setMapId(initial);
      } catch (err) {
        setError(describe(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refresh = useMemo(
    () => async (id: string | null) => {
      if (!id) return;
      try {
        setFeed(await api.feed(id, 120));
      } catch (err) {
        setError(describe(err));
      }
    },
    [],
  );

  useEffect(() => {
    if (!mapId) return;
    localStorage.setItem("dm:lastMap", mapId);
    void refresh(mapId);
  }, [mapId, refresh]);

  // Any change from anyone re-pulls the feed. The payload is small and the
  // alternative — replaying events into a local model — is a lot of
  // reconciliation code for a view that shows twenty rows.
  useEffect(() => {
    const ws = connectWS(
      () => void refresh(mapId),
      setLive,
    );
    return () => ws.close();
  }, [mapId, refresh]);

  // Debounced global search across every map, not just this one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .search(q, undefined, 40)
        .then((ns) => !cancelled && setResults(ns))
        .catch((err) => !cancelled && setError(describe(err)));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const shown = results ?? feed;

  return (
    <div className="m-app">
      <header className="m-head">
        <div className="m-head__row">
          <span className="m-brand">◇ dialogmapper</span>
          <span className={`m-dot ${live ? "is-up" : "is-down"}`} title={live ? "Live" : "Offline"} />
        </div>
        <select
          className="m-mapsel"
          value={mapId ?? ""}
          onChange={(e) => {
            setMapId(e.target.value);
            setResults(null);
            setQuery("");
          }}
        >
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          className="m-search"
          type="search"
          placeholder="Search every map…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      {error && (
        <div className="m-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <main className="m-feed">
        {loading && <p className="m-empty">Loading…</p>}
        {!loading && shown.length === 0 && (
          <p className="m-empty">
            {results ? "Nothing matched." : "Nothing here yet. Add the first question below."}
          </p>
        )}

        {results && (
          <p className="m-scope">
            {results.length} result{results.length === 1 ? "" : "s"} across all maps
          </p>
        )}

        {shown.map((n) => (
          <FeedRow key={n.id} node={n} onReply={() => setReplyTo(n)} />
        ))}
      </main>

      {mapId && (
        <Composer
          mapId={mapId}
          replyTo={replyTo}
          onClear={() => setReplyTo(null)}
          onPosted={() => {
            setReplyTo(null);
            void refresh(mapId);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function FeedRow({ node, onReply }: { node: DMNode; onReply: () => void }) {
  return (
    <article className={`m-row m-row--${node.type}`} onClick={onReply}>
      <div className="m-row__head">
        <span className={`m-glyph m-glyph--${node.type}`}>{NODE_GLYPHS[node.type]}</span>
        <span className="m-row__type">{NODE_LABELS[node.type]}</span>
        {node.mapCount > 1 && (
          <span className="m-badge" title={`Shared with ${node.mapCount - 1} other maps`}>
            ✳{node.mapCount}
          </span>
        )}
        {node.content.status !== "open" && (
          <span className="m-status">{node.content.status}</span>
        )}
        <time className="m-row__time">{relativeTime(node.updatedAt)}</time>
      </div>
      <p className="m-row__title">{node.title || "untitled"}</p>
      {node.content.markdown && <p className="m-row__body">{node.content.markdown}</p>}
      {node.content.tags.length > 0 && (
        <p className="m-row__tags">{node.content.tags.map((t) => `#${t}`).join(" ")}</p>
      )}
      <button className="m-reply">Add to this →</button>
    </article>
  );
}

/**
 * The composer offers only the moves that are legal against whatever was
 * tapped, so a phone user cannot construct an invalid map by accident. With a
 * Question selected that means an Idea, a sub-Question or a Note; with an Idea
 * it means a Pro, a Con or a Note.
 */
function Composer({
  mapId,
  replyTo,
  onClear,
  onPosted,
  onError,
}: {
  mapId: string;
  replyTo: DMNode | null;
  onClear: () => void;
  onPosted: () => void;
  onError: (m: string) => void;
}) {
  const options = movesFor(replyTo);
  const [kind, setKind] = useState(options[0].type);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setKind(movesFor(replyTo)[0].type), [replyTo]);

  const submit = async () => {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    const choice = options.find((o) => o.type === kind) ?? options[0];
    try {
      await api.createNode({
        type: choice.type,
        title,
        mapId,
        parentId: replyTo?.id,
        relationshipType: replyTo ? choice.rel : undefined,
        source: "mobile",
      });
      setText("");
      onPosted();
    } catch (err) {
      onError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="m-composer">
      {replyTo && (
        <div className="m-context">
          <span>
            Replying to <strong>{replyTo.title || "untitled"}</strong>
          </span>
          <button onClick={onClear}>×</button>
        </div>
      )}

      <div className="m-kinds">
        {options.map((o) => (
          <button
            key={o.type + o.rel}
            className={`m-kind m-kind--${o.type} ${kind === o.type ? "is-on" : ""}`}
            onClick={() => setKind(o.type)}
          >
            {NODE_GLYPHS[o.type]} {o.label}
          </button>
        ))}
      </div>

      <div className="m-input-row">
        <textarea
          className="m-input"
          rows={2}
          placeholder={options.find((o) => o.type === kind)?.placeholder ?? "Add…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <button className="m-send" disabled={!text.trim() || busy} onClick={() => void submit()}>
          {busy ? "…" : "Add"}
        </button>
      </div>
    </footer>
  );
}

interface Move {
  type: NodeType;
  rel: Relationship;
  label: string;
  placeholder: string;
}

function movesFor(parent: DMNode | null): Move[] {
  if (!parent) {
    return [
      { type: "question", rel: "questions", label: "Question", placeholder: "What is the question?" },
      { type: "note", rel: "relates_to", label: "Note", placeholder: "Something worth recording…" },
    ];
  }
  switch (parent.type) {
    case "question":
      return [
        { type: "idea", rel: "responds_to", label: "Idea", placeholder: "What could we do?" },
        { type: "question", rel: "questions", label: "Sub-question", placeholder: "What else must we settle?" },
        { type: "note", rel: "relates_to", label: "Note", placeholder: "Context or evidence…" },
      ];
    case "idea":
    case "map":
      return [
        { type: "pro", rel: "supports", label: "Pro", placeholder: "Why this works…" },
        { type: "con", rel: "objects_to", label: "Con", placeholder: "Why this fails…" },
        { type: "question", rel: "questions", label: "Question", placeholder: "What does this raise?" },
        { type: "note", rel: "relates_to", label: "Note", placeholder: "Context or evidence…" },
      ];
    case "pro":
    case "con":
      return [
        { type: "con", rel: "objects_to", label: "Rebut", placeholder: "Why that argument fails…" },
        { type: "pro", rel: "supports", label: "Reinforce", placeholder: "Why that argument holds…" },
        { type: "question", rel: "questions", label: "Question", placeholder: "What does this raise?" },
        { type: "note", rel: "relates_to", label: "Note", placeholder: "Context or evidence…" },
      ];
    default:
      return [
        { type: "question", rel: "questions", label: "Question", placeholder: "What does this raise?" },
        { type: "note", rel: "relates_to", label: "Note", placeholder: "Context or evidence…" },
      ];
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

export default MobileApp;
