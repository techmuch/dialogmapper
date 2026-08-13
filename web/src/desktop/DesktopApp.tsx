import { useEffect } from "react";
import Canvas from "./Canvas";
import SearchPalette from "./SearchPalette";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import { useGraph } from "../store/useGraph";
import { useUI } from "../store/useUI";
import { connectWS } from "../ws";

export function DesktopApp() {
  const bootstrap = useGraph((s) => s.bootstrap);
  const applyEvent = useGraph((s) => s.applyEvent);
  const setConnected = useGraph((s) => s.setConnected);
  const loading = useGraph((s) => s.loading);
  const map = useGraph((s) => s.map);
  const toasts = useGraph((s) => s.toasts);
  const dismissToast = useGraph((s) => s.dismissToast);
  const helpOpen = useUI((s) => s.helpOpen);
  const setHelp = useUI((s) => s.setHelp);

  useEffect(() => {
    void bootstrap();
    const ws = connectWS(applyEvent, setConnected);
    return () => ws.close();
  }, [bootstrap, applyEvent, setConnected]);

  return (
    <div className="app">
      <Toolbar />

      <main className="app__main">
        {loading ? (
          <div className="loading">Loading map…</div>
        ) : map ? (
          <Canvas />
        ) : (
          <EmptyState />
        )}
        <Sidebar />
      </main>

      <SearchPalette />
      {helpOpen && <Help onClose={() => setHelp(false)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const toast = useGraph((s) => s.toast);
  return (
    <div className="empty">
      <h1>No maps yet</h1>
      <p>
        Run <code>dialogmapper seed --context notes.md</code> to scaffold one from a
        document, or create a map from the menu above.
      </p>
      <p className="empty__hint">
        Then press <kbd>q</kbd> to ask the first question.
      </p>
      <button className="btn" onClick={() => toast("Use the map menu, top left.", "info")}>
        Where?
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["n", "New note — or an Idea, when a Question is selected"],
  ["q", "New Question about the selection"],
  ["i", "New Idea answering the selected Question"],
  ["+", "New Pro supporting the selected Idea"],
  ["−", "New Con objecting to the selected Idea"],
  ["Enter", "Edit the title; Enter again commits and keeps the node selected"],
  ["Esc", "Cancel editing, then close panels, then clear the selection"],
  ["← ↑ → ↓", "Move the selection to the nearest node in that direction"],
  ["Space", "Centre on the selection, or fit the whole map"],
  ["f", "Fit the whole map"],
  ["l", "Tidy up with auto-layout"],
  ["Tab", "Toggle the details panel"],
  ["/", "Search every map and insert an existing node"],
  ["Backspace", "Remove from this map (shared nodes survive elsewhere)"],
  ["?", "This list"],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard</h2>
        <p className="help__lede">
          Built for capturing a live conversation. Creating a node selects it, and
          committing a title keeps it selected — so you can keep going without
          reaching for the mouse.
        </p>
        <dl>
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="help__row">
              <dt><kbd>{key}</kbd></dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
        <h3>The grammar</h3>
        <p className="help__lede">
          Edges are typed: an Idea <em>responds to</em> a Question, a Pro
          <em> supports</em> an Idea, a Con <em>objects to</em> one. Illegal links are
          refused with an explanation of what would have worked instead.
        </p>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default DesktopApp;
