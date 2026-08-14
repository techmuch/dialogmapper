import React, { useState } from 'react';
import { HelpCircle, Lightbulb, ThumbsUp, ThumbsDown, FileText, AlertTriangle, RefreshCw, Undo2 } from 'lucide-react';

interface Node {
  id: string;
  type: 'question' | 'idea' | 'pro' | 'con' | 'note';
  title: string;
  parentId?: string;
  transcluded?: boolean;
}

const initialNodes: Node[] = [
  { id: 'n1', type: 'question', title: 'How should dialogmapper handle SQLite persistence across processes?' },
  { id: 'n2', type: 'idea', title: 'Poll SQLite data_version and broadcast updates via WebSockets', parentId: 'n1' },
  { id: 'n3', type: 'pro', title: 'Zero cgo required; works with pure Go modernc.org/sqlite', parentId: 'n2' },
  { id: 'n4', type: 'pro', title: 'External tools (sqlite3 CLI, AI scripts) trigger live browser refreshes', parentId: 'n2' },
  { id: 'n5', type: 'con', title: 'Polling adds up to 750ms latency for external process writes', parentId: 'n2' },
  { id: 'n6', type: 'idea', title: 'Use WAL mode shared memory hooks exclusively', parentId: 'n1' },
  { id: 'n7', type: 'note', title: 'Shared memory hooks require platform-dependent OS primitives', parentId: 'n6', transcluded: true },
];

/** One reversible step, mirroring the server's undo journal entries. */
interface HistoryEntry {
  nodes: Node[];
  selectedId: string;
  label: string;
}

export const InteractiveSandbox: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [selectedId, setSelectedId] = useState<string>('n2');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const selectedNode = nodes.find(n => n.id === selectedId);

  // The real app journals inverse operations in SQLite; this demo keeps
  // snapshots, which is enough to show the behaviour that matters here — that
  // undo names what it reversed rather than silently removing something.
  const undo = () => {
    setErrorMessage(null);
    setHistory(h => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setNodes(last.nodes);
      setSelectedId(last.selectedId);
      setActiveAction(`Undone: ${last.label}`);
      setTimeout(() => setActiveAction(null), 2000);
      return h.slice(0, -1);
    });
  };

  const addNode = (type: 'question' | 'idea' | 'pro' | 'con' | 'note', titleText?: string) => {
    setErrorMessage(null);
    const newId = `node_${Date.now()}`;
    const titles = {
      question: 'New Question: What is the optimal strategy?',
      idea: 'New Idea: Implement lightweight edge caching',
      pro: 'New Pro: Reduces round-trip latency by 40%',
      con: 'New Con: Increases memory footprint slightly',
      note: 'New Note: Reference benchmark log #104'
    };

    let parentId: string | undefined = selectedId;
    if (type === 'question') {
      parentId = selectedNode ? selectedNode.id : undefined;
    } else if (type === 'idea') {
      if (selectedNode && selectedNode.type !== 'question') {
        const q = nodes.find(n => n.type === 'question');
        parentId = q ? q.id : undefined;
      }
    } else if (type === 'pro' || type === 'con') {
      if (selectedNode && selectedNode.type === 'question') {
        const latestIdea = nodes.slice().reverse().find(n => n.type === 'idea' && n.parentId === selectedNode.id);
        if (latestIdea) {
          parentId = latestIdea.id;
        } else {
          setErrorMessage(`illegal IBIS edge: ${type} --supports--> question:\n  "${type}" cannot point at a question\n  (try: ${type} --supports--> {idea})`);
          return;
        }
      }
    }

    const newNode: Node = {
      id: newId,
      type,
      title: titleText || titles[type],
      parentId
    };

    setHistory(h => [...h, {
      nodes,
      selectedId,
      label: `added ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    }]);
    setNodes([...nodes, newNode]);
    setSelectedId(newId);
    setActiveAction(`Added ${type.toUpperCase()}`);
    setTimeout(() => setActiveAction(null), 1500);
  };

  const triggerInvalidEdge = () => {
    setErrorMessage(`illegal IBIS edge: pro --supports--> question:
  "supports" cannot point at a question
  (try: pro --relates_to--> {note}; pro --supports--> {idea|pro|con})`);
  };

  const resetGraph = () => {
    setNodes(initialNodes);
    setSelectedId('n2');
    setErrorMessage(null);
    setHistory([]);
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'question': return <HelpCircle style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-question)' }} />;
      case 'idea': return <Lightbulb style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-idea)' }} />;
      case 'pro': return <ThumbsUp style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-pro)' }} />;
      case 'con': return <ThumbsDown style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-con)' }} />;
      case 'note': return <FileText style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-note)' }} />;
      default: return null;
    }
  };

  return (
    <section id="sandbox" style={{ padding: '4rem 0', background: 'var(--bg-dark)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Interactive Demo Sandbox
          </span>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Try the Capture Loop & IBIS Grammar Engine
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '650px', margin: '0 auto' }}>
            Click nodes below or use the capture toolbar to add Ideas, Pros, Cons, and Questions. Notice how edge rules prevent illegal mind-map connections.
          </p>
        </div>

        {/* Sandbox Container */}
        <div className="card" style={{ padding: '0', overflow: 'hidden', background: '#0a0e19', borderColor: 'var(--border-bright)' }}>
          
          {/* Simulator Toolbar */}
          <div style={{
            background: 'var(--bg-card)',
            padding: '1rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginRight: '0.5rem' }}>
                Capture Hotkeys:
              </span>
              {activeAction && <span className="logo-badge" style={{ background: '#38bdf8', color: '#000', fontSize: '0.7rem' }}>{activeAction}</span>}

              <button onClick={() => addNode('question')} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <kbd className="kbd">q</kbd> Question
              </button>
              <button onClick={() => addNode('idea')} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <kbd className="kbd">i</kbd> Idea
              </button>
              <button onClick={() => addNode('pro')} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <kbd className="kbd">+</kbd> Pro
              </button>
              <button onClick={() => addNode('con')} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <kbd className="kbd">-</kbd> Con
              </button>
              <button onClick={() => addNode('note')} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <kbd className="kbd">n</kbd> Note
              </button>
              <button
                onClick={undo}
                disabled={history.length === 0}
                className="btn-secondary"
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8125rem',
                  opacity: history.length === 0 ? 0.4 : 1,
                  cursor: history.length === 0 ? 'default' : 'pointer',
                }}
                title={
                  history.length
                    ? `Undo: ${history[history.length - 1].label}`
                    : 'Nothing to undo'
                }
              >
                <Undo2 style={{ width: '0.9rem', height: '0.9rem' }} />
                <kbd className="kbd">⌘Z</kbd> Undo
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button onClick={triggerInvalidEdge} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem', color: '#f43f5e', borderColor: 'rgba(244, 63, 94, 0.3)' }}>
                <AlertTriangle style={{ width: '0.9rem', height: '0.9rem' }} />
                <span>Test Invalid Edge</span>
              </button>
              <button onClick={resetGraph} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                <RefreshCw style={{ width: '0.9rem', height: '0.9rem' }} />
                <span>Reset Map</span>
              </button>
            </div>
          </div>

          {/* Validation Banner if Error */}
          {errorMessage && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.15)',
              borderBottom: '1px solid rgba(244, 63, 94, 0.3)',
              padding: '0.875rem 1.5rem',
              color: '#fecdd3',
              fontSize: '0.875rem',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem'
            }}>
              <AlertTriangle style={{ width: '1.25rem', height: '1.25rem', color: '#f43f5e', flexShrink: 0, marginTop: '0.1rem' }} />
              <div>
                <strong>Grammar Validation Refusal:</strong>
                <div>{errorMessage}</div>
              </div>
            </div>
          )}

          {/* Canvas Area */}
          <div style={{ padding: '2rem', minHeight: '380px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {nodes.map(node => {
              const isSelected = node.id === selectedId;
              const indent = node.parentId ? (node.type === 'pro' || node.type === 'con' ? '3rem' : '1.5rem') : '0';

              return (
                <div
                  key={node.id}
                  onClick={() => { setSelectedId(node.id); setErrorMessage(null); }}
                  style={{
                    marginLeft: indent,
                    background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-card)',
                    border: `1.5px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                    borderRadius: '0.625rem',
                    padding: '0.875rem 1.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 0 15px rgba(56, 189, 248, 0.2)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {getNodeIcon(node.type)}
                    <span className={`ibis-badge ${node.type}`}>
                      {node.type}
                    </span>
                    <span style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? '#fff' : 'var(--text-main)' }}>
                      {node.title}
                    </span>
                    {node.transcluded && (
                      <span style={{
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: 'var(--ibis-note)',
                        border: '1px solid rgba(251, 191, 36, 0.3)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: '0.25rem'
                      }}>
                        ✳ transcluded
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                      Selected
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer note inside sandbox */}
          <div style={{
            background: '#060911',
            padding: '0.75rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8125rem',
            color: 'var(--text-dim)'
          }}>
            <span>Active Selection: <strong style={{ color: 'var(--text-main)' }}>{selectedNode ? selectedNode.title : 'None'}</strong></span>
            <span>All writes validated server-side in <code>internal/ibis/rules.go</code></span>
          </div>

        </div>

      </div>
    </section>
  );
};
