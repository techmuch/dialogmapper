import React, { useState } from 'react';
import { ShieldCheck, Zap, GitFork, LayoutGrid, Smartphone, Bot, Database, CheckCircle, CornerDownRight, Undo2, BoxSelect, QrCode } from 'lucide-react';

export const FeatureWalkthroughs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'grammar' | 'capture' | 'groups' | 'transclusion' | 'layout' | 'mobile' | 'ai' | 'sync'>('grammar');

  return (
    <section id="features" style={{ padding: '5rem 0', background: 'var(--bg-card)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Feature Walkthroughs
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Built for Facilitators, Engineered for Rigour
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '700px', margin: '0 auto' }}>
            Explore how dialogmapper combines human-speed capture with strict structural guarantees.
          </p>
        </div>

        {/* Feature Navigation Tabs */}
        <div className="tabs-nav" style={{ justifyContent: 'center' }}>
          <button
            onClick={() => setActiveTab('grammar')}
            className={`tab-btn ${activeTab === 'grammar' ? 'active' : ''}`}
          >
            <ShieldCheck style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>IBIS Grammar Engine</span>
          </button>

          <button
            onClick={() => setActiveTab('capture')}
            className={`tab-btn ${activeTab === 'capture' ? 'active' : ''}`}
          >
            <Zap style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>Capture Loop & Undo</span>
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`}
          >
            <BoxSelect style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>Spatial Group Boxes</span>
          </button>

          <button
            onClick={() => setActiveTab('transclusion')}
            className={`tab-btn ${activeTab === 'transclusion' ? 'active' : ''}`}
          >
            <GitFork style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>Transclusion (✳n)</span>
          </button>

          <button
            onClick={() => setActiveTab('layout')}
            className={`tab-btn ${activeTab === 'layout' ? 'active' : ''}`}
          >
            <LayoutGrid style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>Tree Auto-Layout</span>
          </button>

          <button
            onClick={() => setActiveTab('mobile')}
            className={`tab-btn ${activeTab === 'mobile' ? 'active' : ''}`}
          >
            <Smartphone style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>Mobile Feed</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
          >
            <Bot style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>AI Agent Tooling</span>
          </button>

          <button
            onClick={() => setActiveTab('sync')}
            className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
          >
            <Database style={{ width: '1.1rem', height: '1.1rem' }} />
            <span>SQLite & Sync</span>
          </button>
        </div>

        {/* Tab Content 1: IBIS Grammar */}
        {activeTab === 'grammar' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Strict Edge Semantics Prevent Mind-Map Decay
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                An untyped arrow between two boxes means nothing. "This Pro supports that Idea" is a claim you can audit; "these two things are related" is not. dialogmapper enforces IBIS edge rules on every write in the backend.
              </p>
              
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
                <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: 'var(--ibis-pro)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ color: '#fff' }}>Enforced Legal Target Types:</strong> Ideas answer Questions; Pros and Cons argue about Ideas or Pros/Cons; Questions specialize or inquire into nodes.
                  </div>
                </li>
                <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: 'var(--ibis-pro)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ color: '#fff' }}>Constructive Error Suggestions:</strong> When a link is rejected, the error names the legal alternatives rather than just refusing.
                  </div>
                </li>
              </ul>
            </div>

            <div className="code-block">
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                // Server Grammar Validation Response
              </div>
              <pre style={{ color: '#f43f5e', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
{`illegal IBIS edge: pro --supports--> question:
  "supports" cannot point at a question
  (try: pro --relates_to--> {note}; 
        pro --supports--> {idea|pro|con|map})`}
              </pre>
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', color: '#34d399', fontSize: '0.8125rem' }}>
                ✓ Prevents invalid argument structures from entering the SQLite store.
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 2: Capture Loop */}
        {activeTab === 'capture' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Zero-Mouse Facilitation at the Speed of Speech
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                The canvas is built for a facilitator typing while people talk. Creating a node selects it, and committing a title keeps it selected, so a keystroke never needs a mouse correction afterwards.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                <div style={{ background: 'var(--bg-dark)', padding: '0.875rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <kbd className="kbd">q</kbd> <span style={{ fontWeight: 600 }}>New Question</span>
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Questions selected topic</span>
                </div>

                <div style={{ background: 'var(--bg-dark)', padding: '0.875rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <kbd className="kbd">i</kbd> <span style={{ fontWeight: 600 }}>New Idea</span>
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Answers selected Question</span>
                </div>

                <div style={{ background: 'var(--bg-dark)', padding: '0.875rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <kbd className="kbd">+</kbd> / <kbd className="kbd">-</kbd> <span style={{ fontWeight: 600 }}>Pro / Con</span>
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Argues selected Idea</span>
                </div>

                <div style={{ background: 'var(--bg-dark)', padding: '0.875rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <kbd className="kbd">l</kbd> <span style={{ fontWeight: 600 }}>Auto-Layout</span>
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Tidy tree alignment</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="card" style={{ background: '#070b14', borderColor: 'var(--border-bright)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--accent-cyan)', fontWeight: 600, fontSize: '0.875rem' }}>
                  <Zap style={{ width: '1rem', height: '1rem' }} />
                  <span>Forgiving Shortcut Recovery</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
                  <code>+</code> and <code>-</code> are forgiving: with a Question selected, they attach to that Question's most recent Idea rather than failing, because a grammar error mid-sentence costs more than a sensible guess.
                </p>
              </div>

              <div className="card" style={{ background: '#070b14', borderColor: 'var(--border-bright)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--accent-cyan)', fontWeight: 600, fontSize: '0.875rem' }}>
                  <Undo2 style={{ width: '1rem', height: '1rem' }} />
                  <span>Undo That Cannot Clobber a Teammate</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
                  Undo history lives in SQLite, so it works across restarts and CLI operations too. Each entry tracks who made the change, so pressing <kbd className="kbd">⌘Z</kbd> only ever reverses your own actions.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 3: Spatial Group Boxes */}
        {activeTab === 'groups' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Groups That Actually Hold Their Nodes
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                Shift-drag a box or shift-click to select several nodes, then press <kbd className="kbd">g</kbd>. The selection becomes a group that moves as one — drag the outline and every member goes with it.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
                <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: 'var(--ibis-pro)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ color: '#fff' }}>Bounds Derived From Membership:</strong> The outline has no geometry of its own — it is computed from where the members are. Move one member and it restretches; the box and the nodes can never drift apart. There is nothing to resize, because membership <em>is</em> the bounds.
                  </div>
                </li>
                <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: 'var(--ibis-pro)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ color: '#fff' }}>Purely Spatial (No IBIS Pollution):</strong> Grouping creates no edges and carries no grammar weight. Teams cluster by theme, owner, or "parking lot"; encoding that as relationships would corrupt the argument tree that exports and AI agents rely on.
                  </div>
                </li>
                <li style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: 'var(--ibis-pro)', flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ color: '#fff' }}>Non-Destructive Ungrouping:</strong> Clicking <code>×</code> dissolves the arrangement and leaves every node exactly where it sits. The nodes are the content; the group is only a way of handling them together.
                  </div>
                </li>
              </ul>
            </div>

            <div className="card" style={{ background: '#090e1b', border: '1.5px dashed var(--accent-cyan)', borderRadius: '0.75rem', padding: '1.5rem', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontSize: '0.9375rem' }}>
                  Group: Database Architecture Options
                </span>
                <span style={{ fontSize: '0.75rem', background: 'rgba(56, 189, 248, 0.12)', color: 'var(--accent-cyan)', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600 }}>
                  Spatial Container
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ background: 'var(--bg-card)', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="ibis-badge idea">Idea</span>
                  <span style={{ fontSize: '0.875rem' }}>Poll SQLite data_version & broadcast WS</span>
                </div>
                <div style={{ background: 'var(--bg-card)', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.25rem' }}>
                  <span className="ibis-badge pro">Pro</span>
                  <span style={{ fontSize: '0.875rem' }}>Pure Go modernc.org/sqlite (no cgo)</span>
                </div>
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: 'var(--text-dim)', textAlign: 'right' }}>
                Resize handles on corners & edges
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 4: Transclusion */}
        {activeTab === 'transclusion' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Transclusion: Shared Nodes Across Multiple Maps
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                Nodes are shared, not copied. The same Idea can sit on several maps at once; edit it anywhere and every map sees the change. Shared nodes carry a <strong style={{ color: 'var(--ibis-note)' }}>✳n</strong> badge.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <li style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-main)' }}>
                  <CornerDownRight style={{ width: '1rem', height: '1rem', color: 'var(--accent-cyan)' }} />
                  <span><strong>Global Node Identity:</strong> Edits to title or body reflect across all maps instantly.</span>
                </li>
                <li style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-main)' }}>
                  <CornerDownRight style={{ width: '1rem', height: '1rem', color: 'var(--accent-cyan)' }} />
                  <span><strong>Per-Map Layout:</strong> The same node can sit in a different position on each canvas.</span>
                </li>
                <li style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-main)' }}>
                  <CornerDownRight style={{ width: '1rem', height: '1rem', color: 'var(--accent-cyan)' }} />
                  <span><strong>Safe Deletion:</strong> <code>Backspace</code> removes a node from the current map without deleting it from others.</span>
                </li>
              </ul>
            </div>

            <div className="card" style={{ background: '#0a0e1a' }}>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <span className="ibis-badge idea">Idea</span>
                <span style={{ fontWeight: 600 }}>"Use WAL Mode for SQLite"</span>
                <span style={{ background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontWeight: 700 }}>✳ 3 maps</span>
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>• Embedded in: <em>Architecture Review Map</em></div>
                <div>• Embedded in: <em>Database Migration Map</em></div>
                <div>• Embedded in: <em>Performance Optimisation Map</em></div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 5: Layout */}
        {activeTab === 'layout' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Deterministic Tidy Trees, Not Chaotic Force Graphs
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                An IBIS map <em>is</em> a tree of arguments. Force layouts destroy the one thing that makes IBIS readable by moving every node whenever a new one is added. dialogmapper uses a deterministic tree layout algorithm triggered with <kbd className="kbd">l</kbd>.
              </p>
            </div>

            <div className="card" style={{ background: '#080c18' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                <span style={{ color: '#f43f5e', fontWeight: 600 }}>❌ Force Layouts</span>
                <span style={{ color: '#34d399', fontWeight: 600 }}>✓ dialogmapper Tidy Tree</span>
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Node positions are deterministic, hierarchical, and readable at a glance. Parents sit above or to the left of their children, making arguments easy to follow during fast-paced facilitation.
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 6: Mobile */}
        {activeTab === 'mobile' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Dedicated Participant Mobile Experience
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                Phones get a tailored product, not a shrunken canvas. Mobile users see a reverse-chronological participant feed, search across every map, and tap a node to add a reply.
              </p>
              <div style={{ fontSize: '0.9375rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>✓ Only legal replies are offered when a node is tapped</div>
                <div>✓ Mobile replies appear instantly on desktop canvas via WebSockets</div>
                <div>✓ Placed automatically by tree auto-layout</div>
                <div>✓ Join by scanning a QR — no app, no typing an IP address</div>
              </div>
            </div>

            <div className="card" style={{ background: '#090d18', padding: '2rem' }}>
              <div style={{ textAlign: 'center' }}>
                <QrCode style={{ width: '3rem', height: '3rem', color: 'var(--accent-cyan)', margin: '0 auto 1rem auto' }} />
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>One Scan to Join</h4>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Press <kbd className="kbd">?</kbd> on the canvas for a QR code, or scan the one printed in your terminal when the server starts. The code carries the machine's LAN address — never <code>localhost</code>, which would send the phone to itself.
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '0.75rem' }}>
                Serving on the network also means anyone on it could reach the maps, so each run mints an access key that the QR link carries. Connections from the machine itself are exempt, so the desktop canvas is unaffected.
              </p>
            </div>
          </div>
        )}

        {/* Tab Content 7: AI */}
        {activeTab === 'ai' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                Machine-Readable Rules & AI Agent Integration
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                Designed for LLM collaboration. AI agents can read grammar rules, seed maps from markdown research notes, and dump structured graph exports.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <code className="code-block" style={{ fontSize: '0.8125rem' }}>
                  dialogmapper seed --context notes.md
                </code>
                <code className="code-block" style={{ fontSize: '0.8125rem' }}>
                  dialogmapper export --format md|json
                </code>
                <code className="code-block" style={{ fontSize: '0.8125rem' }}>
                  dialogmapper grammar --json
                </code>
              </div>
            </div>

            <div className="code-block">
              <div style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                // dialogmapper grammar --json Output
              </div>
              <pre style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>
{`{
  "rules": [
    { "from": "idea", "type": "responds_to", "to": "question" },
    { "from": "pro", "type": "supports", "to": "idea" },
    { "from": "con", "type": "objects_to", "to": "idea" }
  ]
}`}
              </pre>
            </div>
          </div>
        )}

        {/* Tab Content 8: SQLite & Sync */}
        {activeTab === 'sync' && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
                SQLite Data Version Polling & Real-Time Sync
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
                All writes go through the REST API so validation lives in one place. External changes — made by another process, script, or <code>sqlite3</code> CLI — are detected by polling SQLite's <code>PRAGMA data_version</code> and pushed to open browsers via WebSockets.
              </p>
            </div>

            <div className="card" style={{ background: '#0a0e19' }}>
              <Database style={{ width: '2.5rem', height: '2.5rem', color: 'var(--ibis-idea)', marginBottom: '1rem' }} />
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Pure Go SQLite Engine</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Uses <code>modernc.org/sqlite</code>. No cgo required, enabling instantaneous cross-compilation across macOS, Linux, and Windows from one machine.
              </p>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
