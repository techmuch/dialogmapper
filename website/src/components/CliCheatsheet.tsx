import React from 'react';

interface CliCmd {
  name: string;
  args: string;
  description: string;
  example: string;
}

const commands: CliCmd[] = [
  {
    name: 'init',
    args: '',
    description: 'Scaffolds maps.db, .assets/, AGENTS.md, and README.md in current directory',
    example: 'dialogmapper init'
  },
  {
    name: 'start',
    args: '--open [--port 7373] [--host 0.0.0.0]',
    description: 'Serves the HTTP API, WebSocket fanout, and embedded SPA. Prints LAN IP for mobile participants when hosted on 0.0.0.0.',
    example: 'dialogmapper start --open --port 7373'
  },
  {
    name: 'seed',
    args: '--context <file.md>',
    description: 'Parses research markdown notes and bullet points into IBIS Questions, Ideas, Pros, Cons, and Notes scaffolding.',
    example: 'dialogmapper seed --context research_notes.md'
  },
  {
    name: 'export',
    args: '--format <md|json> [--map <id>]',
    description: 'Dumps the entire IBIS decision graph or a specific map into Markdown or structured JSON for LLM prompts and downstream tools.',
    example: 'dialogmapper export --format md > map_summary.md'
  },
  {
    name: 'grammar',
    args: '--json',
    description: 'Prints the entire machine-readable IBIS edge ruleset so AI agents can construct valid edges without guessing.',
    example: 'dialogmapper grammar --json'
  }
];

export const CliCheatsheet: React.FC = () => {
  return (
    <section id="cli" style={{ padding: '5rem 0', background: 'var(--bg-card)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            CLI Reference
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Command Line Interface
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '650px', margin: '0 auto' }}>
            All operations are available via the single <code>dialogmapper</code> binary executable.
          </p>
        </div>

        <div className="card" style={{ padding: '0', overflow: 'hidden', background: '#0a0e19' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9375rem' }}>
              <thead>
                <tr style={{ background: '#060911', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '1rem 1.25rem', fontWeight: 600 }}>Command</th>
                  <th style={{ padding: '1rem 1.25rem', fontWeight: 600 }}>Flags / Arguments</th>
                  <th style={{ padding: '1rem 1.25rem', fontWeight: 600 }}>Description</th>
                  <th style={{ padding: '1rem 1.25rem', fontWeight: 600 }}>Example</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((cmd, idx) => (
                  <tr key={cmd.name} style={{ borderBottom: idx < commands.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                    <td style={{ padding: '1rem 1.25rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                      {cmd.name}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      {cmd.args || '—'}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', color: 'var(--text-main)', maxWidth: '400px', lineHeight: 1.5 }}>
                      {cmd.description}
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <code style={{ background: '#050810', padding: '0.35rem 0.6rem', borderRadius: '0.375rem', fontSize: '0.8125rem', color: '#38bdf8', border: '1px solid var(--border-color)' }}>
                        {cmd.example}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </section>
  );
};
