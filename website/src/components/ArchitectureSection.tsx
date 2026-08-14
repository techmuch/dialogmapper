import React from 'react';
import { ShieldAlert, Cpu, RefreshCw } from 'lucide-react';

export const ArchitectureSection: React.FC = () => {
  return (
    <section id="architecture" style={{ padding: '5rem 0', background: 'var(--bg-dark)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Design
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Architectural Trade-Offs & Guarantees
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '700px', margin: '0 auto' }}>
            Every choice in dialogmapper prioritizes local-first reliability, instant compilation, and zero runtime overhead.
          </p>
        </div>

        <div className="grid-3" style={{ marginBottom: '3rem' }}>
          <div className="card" style={{ background: '#0a0e19' }}>
            <Cpu style={{ width: '2rem', height: '2rem', color: 'var(--accent-cyan)', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Pure Go SQLite Engine</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Uses <code>modernc.org/sqlite</code> instead of <code>mattn/go-sqlite3</code>. Because there is zero cgo, cross-compiling for macOS, Linux, and Windows runs instantly from a single machine without toolchain dependencies.
            </p>
          </div>

          <div className="card" style={{ background: '#0a0e19' }}>
            <ShieldAlert style={{ width: '2rem', height: '2rem', color: 'var(--ibis-idea)', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Rules in Go Code</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Grammar edge validation lives in Go (<code>internal/ibis/rules.go</code>) rather than SQL <code>CHECK</code> constraints. This allows expressive error messages with legal repair suggestions and zero migration debt when rules evolve.
            </p>
          </div>

          <div className="card" style={{ background: '#0a0e19' }}>
            <RefreshCw style={{ width: '2rem', height: '2rem', color: 'var(--ibis-pro)', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>SQLite Data Version Polling</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              External edits made by scripts, AI agents, or the <code>sqlite3</code> CLI are detected automatically via SQLite's <code>PRAGMA data_version</code> counter and pushed to open browser tabs via WebSockets.
            </p>
          </div>
        </div>

        {/* Directory Layout Tree */}
        <div className="card" style={{ background: '#060911', borderColor: 'var(--border-bright)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--accent-cyan)' }}>
            Codebase Directory Layout
          </h3>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.75 }}>
{`main.go                    entry point
internal/cli/              cobra commands: init, start, seed, export, grammar
internal/ibis/             the IBIS grammar engine and edge validation rules
internal/store/            SQLite schema, queries, node transclusion, exporters
internal/server/           HTTP REST API, WebSocket fanout, embedded SPA handler
internal/web/dist/         compiled React frontend (embedded via go:embed)
web/                       React + TypeScript + Zustand + React Flow source
website/                   this documentation & public product landing site`}
          </pre>
        </div>

      </div>
    </section>
  );
};
