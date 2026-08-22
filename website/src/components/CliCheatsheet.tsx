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
    description: 'Scaffolds maps.db, .assets/, AGENTS.md, and README.md in the current directory. Safe to re-run: nothing is ever deleted, and an existing database is left exactly as it is. --force rewrites the generated AGENTS.md and README.md from the current binary \u2014 how you refresh the agent guidance after upgrading \u2014 keeping the previous copy as .bak and still never touching your maps.',
    args: '[--map <name>] [--force]',
    example: 'dialogmapper init'
  },
  {
    name: 'start',
    args: '--open [--port 7373] [--host 127.0.0.1] [--no-token] [--no-update-check]',
    description: 'Serves the HTTP API, WebSocket fanout, and embedded SPA. Binds every interface by default and prints a scannable QR for phones, gated by a per-run access key that the QR link carries. Loopback is exempt, so the desktop canvas needs no key. Once a day it also checks GitHub for a newer release — the only outbound request dialogmapper makes, disclosed on first run and disabled with --no-update-check or DIALOGMAPPER_NO_UPDATE_CHECK=1.',
    example: 'dialogmapper start --open'
  },
  {
    name: 'seed',
    args: '--context <file.md>',
    description: 'Parses research markdown notes and bullet points into IBIS Questions, Ideas, Pros, Cons, and Notes scaffolding.',
    example: 'dialogmapper seed --context research_notes.md'
  },
  {
    name: 'export',
    args: '--format <md|json> [--map-id <id>] [--all]',
    description: 'Dumps the entire IBIS decision graph or a specific map into Markdown or structured JSON for LLM prompts and downstream tools.',
    example: 'dialogmapper export --format md > map_summary.md'
  },
  {
    name: 'undo',
    args: '[--steps <n>] [--dry-run]',
    description: 'Reverses changes made from the command line — most usefully an entire seed run. Scoped to the CLI\'s own history, so it never touches what someone is doing in the browser.',
    example: 'dialogmapper undo --steps 12'
  },
  {
    name: 'redo',
    args: '[--steps <n>]',
    description: 'Reapplies the last change undone from the command line.',
    example: 'dialogmapper redo'
  },
  {
    name: 'grammar',
    args: '--json',
    description: 'Prints the entire machine-readable IBIS edge ruleset so AI agents can construct valid edges without guessing.',
    example: 'dialogmapper grammar --json'
  },
  {
    name: 'upgrade',
    args: '[--check] [--yes]',
    description: 'Replaces this binary with the latest published release. No Go toolchain required \u2014 the release build for your platform is downloaded, not compiled. The download is verified against the SHA256SUMS published with the release and refused on a mismatch, and the swap is a rename within the same directory so an interrupted upgrade can never leave a half-written binary. Under Homebrew, Nix or snap it refuses and names the right command instead.',
    example: 'dialogmapper upgrade --check'
  },
  {
    name: 'apply',
    args: '[--schema] [--dry-run] [--json] [-f file]',
    description: 'Applies a JSON array of mutations from stdin — create_node, update_node, delete_node, create_edge, delete_map and the rest. Every operation goes through the same validation the canvas uses, so the IBIS grammar is enforced, ids are generated for you, and each change is journaled and reversible. No running server and no external tooling required, which is what makes it the supported path for scripts and AI agents instead of writing SQL into maps.db.',
    example: 'echo \'[{"op":"create_node","map":"Caching","type":"con","title":"Invalidation is forever","parent":"idea_01...","rel":"objects_to"}]\' | dialogmapper apply'
  },
  {
    name: 'map',
    args: 'list | new <name> | rm <name> | clear <name>',
    description: 'Manages maps. Deleting one is journaled, so undo brings back its edges, placements and groups — the nodes themselves are never destroyed, since a map is a view and the same node may appear on others.',
    example: 'dialogmapper map list'
  },
  {
    name: 'node',
    args: 'add | edit <id> | rm <id>',
    description: 'Targeted node operations: attach a cited Note to an Idea, mark an Idea resolved, take a node off one map without destroying it elsewhere. Links are given as --link "url|title" so they reach the database as proper objects.',
    example: 'dialogmapper node edit idea_01... --status resolved'
  },
  {
    name: 'edge',
    args: 'add <from-id> <to-id> [--rel] | rm <edge-id>',
    description: 'Links and unlinks nodes. Edges point child to parent, the way they read aloud: a Pro supports an Idea, so from is the Pro. Omit --rel and the IBIS grammar infers the obvious relationship.',
    example: 'dialogmapper edge add pro_01... idea_01...'
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
