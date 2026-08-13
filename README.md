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
| `Tab` | Toggle the details panel |

`+` and `-` are forgiving: with a Question selected they attach to that
Question's most recent Idea rather than failing, because a grammar error
mid-sentence costs more than a sensible guess.

## Transclusion

Nodes are shared, not copied. The same Idea can sit on several maps at once;
edit it anywhere and every map sees the change. Shared nodes carry a `✳n`
badge, and `Backspace` removes a node from the current map without touching
the others.

Layout is per-map: the same node can sit in a different place on each canvas.

## Mobile

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

`internal/web/dist` is committed on purpose: `go install` should work for
someone who has never installed Node.
