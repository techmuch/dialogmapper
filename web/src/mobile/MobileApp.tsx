import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { describe } from "../store/useGraph";
import { connectWS } from "../ws";
import {
  NODE_GLYPHS,
  NODE_LABELS,
  REL_LABELS,
  hierarchicalRels,
  type DMEdge,
  type DMMap,
  type DMNode,
  type Grammar,
  type NodeType,
  type Relationship,
} from "../types";
import { buildThreads, type Thread, type ThreadRow } from "./threads";
import "./mobile.css";

/**
 * The mobile surface.
 *
 * Not a shrunken canvas. Someone on a phone is a participant, not a
 * facilitator: they want to see what has just been said and add one thing to
 * it.
 *
 * This was a flat reverse-chronological feed, which read well as "what just
 * happened" but left every row rootless — a Pro with no visible parent could be
 * supporting any Idea on the map, and in IBIS that makes it unreadable. It is
 * now grouped into threads under their root Question, with threads ordered by
 * most recent activity so the live-session view survives the change. Search
 * results stay flat, because a match is its own answer.
 *
 * Everything written here reaches the desktop canvas immediately over the same
 * WebSocket, where auto-layout places it.
 */
export function MobileApp() {
  const [maps, setMaps] = useState<DMMap[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DMNode[]>([]);
  const [edges, setEdges] = useState<DMEdge[]>([]);
  const [grammar, setGrammar] = useState<Grammar | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DMNode[] | null>(null);
  const [replyTo, setReplyTo] = useState<DMNode | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Node ids present when this map was first opened.
   *
   * Threading costs the one thing the flat feed was best at: a new reply lands
   * wherever it belongs in the tree rather than at the top. Marking what
   * arrived since you started looking gives that back without giving up the
   * structure. Null until the first load, so the opening screen is not a wall
   * of "new".
   */
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [ms, g] = await Promise.all([api.listMaps(), api.grammar()]);
        setMaps(ms);
        setGrammar(g);
        const initial = localStorage.getItem("dm:lastMap") ?? ms[0]?.id ?? null;
        setMapId(initial);
      } catch (err) {
        setError(describe(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * The whole graph, not the recent-nodes feed.
   *
   * Threading needs a node's ancestors, and an ancestor can easily be older
   * than the newest hundred nodes — a reply to a question asked last week would
   * otherwise have nothing to hang off.
   */
  const refresh = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      const g = await api.graph(id);
      setNodes(g.nodes);
      setEdges(g.edges);
      if (seen.current === null) seen.current = new Set(g.nodes.map((n) => n.id));
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  useEffect(() => {
    if (!mapId) return;
    localStorage.setItem("dm:lastMap", mapId);
    // Switching maps restarts the "what is new" baseline; carrying it over
    // would mark an entire unseen map as new.
    seen.current = null;
    setCollapsed(new Set());
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

  const threads = useMemo(
    () => buildThreads(nodes, edges, hierarchicalRels(grammar)),
    [nodes, edges, grammar],
  );

  const isNew = (n: DMNode) => seen.current !== null && !seen.current.has(n.id);
  const newCount = nodes.filter(isNew).length;

  const toggleThread = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
        {!loading && !results && threads.length === 0 && (
          <p className="m-empty">Nothing here yet. Add the first question below.</p>
        )}
        {results && results.length === 0 && <p className="m-empty">Nothing matched.</p>}

        {/* Search is a flat list on purpose: a match answers for itself, and
            rebuilding threads around scattered hits would mostly show context
            nobody asked for. */}
        {results ? (
          <>
            <p className="m-scope">
              {results.length} result{results.length === 1 ? "" : "s"} across all maps
            </p>
            {results.map((n) => (
              <Row
                key={n.id}
                row={{ node: n, depth: 0, indent: 0, parent: null, rel: null, latest: n.updatedAt }}
                isNew={false}
                onReply={() => setReplyTo(n)}
              />
            ))}
          </>
        ) : (
          <>
            {newCount > 0 && (
              <p className="m-scope">
                {newCount} new since you opened this
              </p>
            )}
            {threads.map((t) => (
              <ThreadBlock
                key={t.root.id}
                thread={t}
                collapsed={collapsed.has(t.root.id)}
                onToggle={() => toggleThread(t.root.id)}
                isNew={isNew}
                onReply={setReplyTo}
              />
            ))}
          </>
        )}
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

/**
 * One thread: a root node and everything beneath it.
 *
 * Collapsing is per-thread rather than per-node. On a phone, opening and
 * closing individual branches is a lot of small taps for a list this size, and
 * the useful gesture is "put this whole discussion away".
 */
function ThreadBlock({
  thread,
  collapsed,
  onToggle,
  isNew,
  onReply,
}: {
  thread: Thread;
  collapsed: boolean;
  onToggle: () => void;
  isNew: (n: DMNode) => boolean;
  onReply: (n: DMNode) => void;
}) {
  const hidden = thread.rows.length - 1;
  const newInside = thread.rows.filter((r) => isNew(r.node)).length;

  const [root, ...rest] = thread.rows;

  return (
    <section className={`m-thread ${collapsed ? "is-collapsed" : ""}`}>
      {/* The root, then the control, then the replies. Above the root it reads
          as a heading for the whole list; below the replies it reads as
          belonging to the next thread. Between the two it is unambiguous. */}
      <Row row={root} isNew={isNew(root.node)} onReply={() => onReply(root.node)} />
      {hidden > 0 && (
        <button className="m-thread__toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="m-thread__caret">{collapsed ? "▸" : "▾"}</span>
          {hidden} {hidden === 1 ? "reply" : "replies"}
          {newInside > 0 && <span className="m-thread__new">{newInside} new</span>}
        </button>
      )}
      {!collapsed &&
        rest.map((r) => (
          <Row key={r.node.id} row={r} isNew={isNew(r.node)} onReply={() => onReply(r.node)} />
        ))}
    </section>
  );
}

function Row({
  row,
  isNew,
  onReply,
}: {
  row: ThreadRow;
  isNew: boolean;
  onReply: () => void;
}) {
  const { node, indent, parent, rel } = row;
  return (
    <article
      className={`m-row m-row--${node.type} ${isNew ? "is-new" : ""}`}
      data-depth={row.depth}
      style={{ marginLeft: `${indent * 14}px` }}
      onClick={onReply}
    >
      {/* Past the indent cap the row would otherwise be rootless, which is the
          exact failure threading is here to fix — so it names its parent. */}
      {parent && (
        <p className="m-row__under">
          ↳ {rel ? REL_LABELS[rel] : "under"} <strong>{parent.title || "untitled"}</strong>
        </p>
      )}
      <div className="m-row__head">
        <span className={`m-glyph m-glyph--${node.type}`}>{NODE_GLYPHS[node.type]}</span>
        <span className="m-row__type">{NODE_LABELS[node.type]}</span>
        {isNew && <span className="m-new">new</span>}
        {node.mapCount > 1 && (
          <span className="m-badge" title={`Shared with ${node.mapCount - 1} other maps`}>
            ✳{node.mapCount}
          </span>
        )}
        {node.content.status !== "open" && (
          <span className="m-status">{node.content.status}</span>
        )}
        <time className="m-row__time">{relativeTime(node.updatedAt)}</time>
        {/* Threading roughly doubles the rows on screen, so the reply
            affordance moved from its own line into the header. The whole card
            is the tap target either way; this is the hint, not the control. */}
        <span className="m-reply">＋</span>
      </div>
      <p className="m-row__title">{node.title || "untitled"}</p>
      {node.content.markdown && <p className="m-row__body">{node.content.markdown}</p>}
      {node.content.tags.length > 0 && (
        <p className="m-row__tags">{node.content.tags.map((t) => `#${t}`).join(" ")}</p>
      )}
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
