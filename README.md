# dialogmapper

A single-binary, local-first dialog mapping environment for modelling wicked
problems as [IBIS](https://en.wikipedia.org/wiki/Issue-based_information_system)
graphs — Questions, the Ideas that answer them, and the Pros and Cons that
argue about those Ideas.

Everything lives in one SQLite file and one executable. No server, no account,
no network.

```
go install github.com/davidfullmer/dialogmapper@latest

dialogmapper init
dialogmapper start --open
```

## Why the constraints are the point

An untyped arrow between two boxes means nothing. "This Pro supports that Idea"
is a claim you can audit; "these two things are related" is not. dialogmapper
enforces IBIS edge semantics in the backend, so a map cannot quietly decay into
a mind map — and when a link is rejected, the error names the legal
alternatives rather than just refusing:

```
illegal IBIS edge: pro --supports--> question:
  "supports" cannot point at a question
  (try: pro --relates_to--> {note}; pro --supports--> {idea|pro|con|map})
```

That message is written for an LLM as much as for a person. `dialogmapper
grammar --json` prints the whole ruleset so an agent can construct valid edges
without guessing.

## Commands

| Command | What it does |
|---------|--------------|
| `dialogmapper init` | Scaffolds `maps.db`, `.assets/`, `AGENTS.md`, `README.md` |
| `dialogmapper start --open` | Serves the UI on `localhost:7373` and opens a browser |
| `dialogmapper seed --context notes.md` | Turns a research document into IBIS scaffolding |
| `dialogmapper export --format md\|json` | Dumps the graph for downstream LLM processing |
| `dialogmapper grammar --json` | Prints the edge ruleset |

`start --host 0.0.0.0` makes the map reachable from a phone on the same
network; the URL printed is the LAN address, not `0.0.0.0`.

## The capture loop

The canvas is built for a facilitator typing while people talk. Creating a node
selects it, and committing a title keeps it selected, so a keystroke never
needs a mouse correction afterwards.

| Key | Action |
|-----|--------|
| `n` | New Note — or an Idea, when a Question is selected |
| `q` | New Question about the selection |
| `i` | New Idea answering the selected Question |
| `+` / `-` | New Pro / Con on the selected Idea |
| `Enter` | Edit the title; `Enter` again commits and keeps the node selected |
| `←↑→↓` | Move the selection to the nearest node in that direction |
| `Space` | Centre on the selection, or fit the whole map |
| `l` | Tidy up with auto-layout |
| `/` | Search every map and insert an existing node |
| `g` | Group the selected nodes so they move together |
| `a` | Select everything currently visible |
| `Ctrl/⌘ Z` | Undo — your own actions only |
| `Ctrl/⌘ ⇧ Z` | Redo |
| `Tab` | Toggle the details panel |

`+` and `-` are forgiving: with a Question selected they attach to that
Question's most recent Idea rather than failing, because a grammar error
mid-sentence costs more than a sensible guess.

## Groups

Shift-drag a box or shift-click to select several nodes, then press `g`. The
selected nodes become a group that moves as one: drag the outline and every
member goes with it.

The outline has no geometry of its own. It is derived from where the members
are, so moving one member restretches it and the two can never drift apart.
That also means there is nothing to resize — the way to change the bounds is to
change who is in the group.

A node belongs to one group per map, so regrouping moves it rather than leaving
it in two. Ungrouping dissolves the arrangement and leaves every node exactly
where it sits; the nodes are the content, the group is only a way of handling
them together.

## Undo

Undo history lives in SQLite, not the browser. It survives a reload, it sees
changes made from a phone, and it works from the terminal:

```
dialogmapper undo --dry-run     # what would go first
dialogmapper undo --steps 12    # reverse a whole seed run
```

Two properties worth knowing:

**It is scoped per client.** Each journal entry records who made the change, so
`Ctrl+Z` on the canvas walks back your own actions and never silently deletes a
note somebody just sent from their phone. `dialogmapper undo` has its own
history again, separate from any browser.

**It restores the whole subgraph.** Deleting a shared node takes its edges and
its placement on every map with it. The journal stores all of that, so undo
brings back the argument rather than a bare box with nothing attached.

Consecutive edits to the same node collapse into one entry, so undoing a typed
title takes one keystroke rather than one per character. Making a new change
after undoing discards the redo tail, which is the standard rule — replaying a
redo against a world that has moved on is how undo systems corrupt state.

## Transclusion

Nodes are shared, not copied. The same Idea can sit on several maps at once;
edit it anywhere and every map sees the change. Shared nodes carry a `✳n`
badge, and `Backspace` removes a node from the current map without touching
the others.

Layout is per-map: the same node can sit in a different place on each canvas.

## Mobile

Press `?` on the canvas for a QR code, or scan the one `dialogmapper start`
prints in your terminal. The link opens the phone view directly.

`start` binds `0.0.0.0` by default so this works with no extra step. Because
that also puts the maps on whatever network the machine is attached to, each
run mints an access key that the QR link carries. Connections from the machine
itself are exempt, so the desktop canvas is unaffected:

```
dialogmapper start                     # LAN + access key (default)
dialogmapper start --host 127.0.0.1    # this machine only, no key needed
dialogmapper start --no-token          # LAN, no key — anyone who can reach the port can edit
```

The key lives only in memory and dies with the server.

Phones get a different product, not a shrunken canvas. Someone on a phone is a
participant rather than a facilitator: they see a reverse-chronological feed,
search across every map, and tap a node to add a reply. The composer only
offers moves that are legal against whatever was tapped, so a phone user cannot
construct an invalid map by accident.

Anything added from a phone appears on the desktop canvas immediately, placed
by auto-layout.

## Synchronisation

All writes go through the REST API so validation lives in exactly one place;
the WebSocket only announces that the world changed. Changes made by a separate
process — another `dialogmapper` command, a script, the `sqlite3` CLI — are
picked up by polling SQLite's `data_version` and pushed to open browsers too.

## Architecture

```
main.go                    entry point
internal/cli/              cobra commands: init, start, seed, export, grammar
internal/ibis/             the IBIS grammar and its validation rules
internal/store/            SQLite schema, queries, exporters
internal/server/           HTTP + WebSocket, embedded SPA, asset uploads
internal/web/dist/         compiled frontend (committed, embedded via go:embed)
web/                       React + TypeScript + Zustand + React Flow source
```

### Data model

`nodes` are map-agnostic; `map_nodes` is the join table that makes transclusion
possible and carries per-map layout; `edges` are scoped to a map, because two
nodes may be linked in one conversation and unrelated in another.

Hierarchical relationships (`responds_to`, `supports`, `objects_to`,
`questions`, `specializes`) are cycle-checked on insert. `relates_to` is not —
cross-links are its entire purpose.

### Choices worth knowing about

- **`modernc.org/sqlite`, not `mattn/go-sqlite3`.** Pure Go, no cgo, so
  `make release` cross-compiles every platform from one machine. At local-first
  scale the performance difference is irrelevant.
- **Rules in Go, not SQL CHECK constraints.** The grammar produces readable
  errors with suggestions and can be extended without a migration.
- **Auto-layout is a tidy tree, not a force simulation.** An IBIS map *is* a
  tree of arguments; a force layout destroys the one thing that makes it
  readable and moves every node whenever one is added.
- **Filters fade rather than hide,** and pull in one hop of context. Hiding
  nodes makes the remaining structure look complete when it is not.

## Development

```
make dev      # Go server on :7373, Vite with hot reload on :5173
make test     # go test ./... and a TypeScript typecheck
make build    # frontend + embedded single binary
make release  # cross-compiled binaries in dist/
```

### Tests

Nothing is mocked. Store tests run against real SQLite in a temp directory,
server tests run a real `httptest` server and speak real HTTP and WebSocket,
and CLI tests execute the actual cobra commands.

| Package | Covers |
|---------|--------|
| `internal/ibis` | The grammar: which edges are legal, which are refused, and that every refusal names an alternative |
| `internal/store` | Transactions, cycle rejection, transclusion identity, per-map layout, exporters, id monotonicity |
| `internal/server` | SPA fallback, mobile redirect, origin policy, upload round-trip and path safety, WebSocket fan-out |
| `internal/cli` | Seed parsing, and init → seed → export round trips |

Three tests exist because the bug they describe actually happened:

- `TestIndexReferencesAreActuallyServable` — user media was mounted at
  `/assets/`, the same prefix Vite emits the bundle into, so the app's own
  JavaScript 404'd and the page rendered black with no console error to chase.
  Fetching `/` was never enough; the test now fetches what `/` points at.

- `TestExternalWriteIsDetectedAfterOwnWrites` — the watcher used to count its
  own writes and skip a poll per write, silently swallowing an edit from a
  separate process that landed in the same window.
- `TestBulletsBecomeIdeasAndArguments` — a bare `!` line was not matched, so
  the objection became a Note titled `!` with its text stranded in the body.

`TestEverySeededEdgeIsLegal` is the one worth keeping honest: whatever the seed
parser produces must form a valid IBIS graph, since anything illegal is
rejected at write time and skipped.

Run `go test -race ./...` before touching the hub — the broadcast path is
concurrent and the race detector is the only thing that will tell you.

### Browser tests

```
make e2e-browser   # once: download Chromium
make test-e2e      # build the binary, then drive it in a real browser
```

Playwright specs in `e2e/` run the real binary with the real embedded
frontend. They exist because three bugs shipped with the whole Go suite green —
a blank page, an empty minimap, and a rubber band drawn in the wrong
coordinate space. Every one was a case of the server being right and the
browser being wrong, which nothing server-side can see. See `e2e/README.md`.

Not covered: the React layer has no unit tests. The browser suite covers
behaviour end to end, but pure logic like `autoLayout` would be cheaper to pin
with Vitest.

`internal/web/dist` is committed on purpose: `go install` should work for
someone who has never installed Node.
