# dialogmapper

A single-binary, local-first dialog mapping environment for modelling wicked
problems as [IBIS](https://en.wikipedia.org/wiki/Issue-based_information_system)
graphs — Questions, the Ideas that answer them, and the Pros and Cons that
argue about those Ideas.

Everything lives in one SQLite file and one executable. No server, no account,
no network.

```
go install github.com/techmuch/dialogmapper@latest

dialogmapper init
dialogmapper start --open
```

### Download Pre-built Binaries

No Go or Node install required on target machines. Download the standalone executable for your platform:

| Platform | Architecture | Download Link |
|----------|--------------|---------------|
| **macOS** | Apple Silicon (`arm64`) | [dialogmapper-darwin-arm64](https://github.com/techmuch/dialogmapper/releases/latest/download/dialogmapper-darwin-arm64) |
| **macOS** | Intel (`amd64`) | [dialogmapper-darwin-amd64](https://github.com/techmuch/dialogmapper/releases/latest/download/dialogmapper-darwin-amd64) |
| **Linux** | x86_64 (`amd64`) | [dialogmapper-linux-amd64](https://github.com/techmuch/dialogmapper/releases/latest/download/dialogmapper-linux-amd64) |
| **Linux** | ARM64 (`arm64`) | [dialogmapper-linux-arm64](https://github.com/techmuch/dialogmapper/releases/latest/download/dialogmapper-linux-arm64) |
| **Windows** | x64 (`amd64`) | [dialogmapper-windows-amd64.exe](https://github.com/techmuch/dialogmapper/releases/latest/download/dialogmapper-windows-amd64.exe) |

View all versioned releases on [GitHub Releases](https://github.com/techmuch/dialogmapper/releases).

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
| `dialogmapper apply` | Applies JSON mutations from stdin — the door for scripts and agents |
| `dialogmapper map list\|new\|rm\|clear` | Manages maps |
| `dialogmapper node add\|edit\|rm` | Creates, changes and removes nodes |
| `dialogmapper edge add\|rm` | Links and unlinks nodes |
| `dialogmapper undo\|redo` | Reverses your own command-line changes |

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
| `l` | Tidy up, and save the result as if you had dragged each node there |
| `/` | Search every map and insert an existing node |
| `g` | Group the selected nodes so they move together |
| `a` | Select everything currently visible |
| `Ctrl/⌘ Z` | Undo — your own actions only |
| `Ctrl/⌘ ⇧ Z` | Redo |
| `Tab` | Toggle the details panel |

`+` and `-` are forgiving: with a Question selected they attach to that
Question's most recent Idea rather than failing, because a grammar error
mid-sentence costs more than a sensible guess.

## Changing a node's type

A relationship is a reading of the two types at the ends of an arrow: "Idea
responds to Question" and "Pro supports Idea" describe the same shape of link
correctly for what sits at each end. So changing a node's type relabels its
edges — retype an Idea to a Question and its `responds to` becomes `questions`.

Some changes have no legal reading at all. Nothing in IBIS connects a Pro to a
Question, so an Idea with arguments hanging off it cannot become one. Nor does
an Idea attach to another Idea, so a Con objecting to an Idea cannot become a
second Idea — two Ideas under one Question are competing answers, and that
competition is carried by the Pros and Cons on each, not by a link between
them. Those types are greyed out, and clicking one says which neighbour is in
the way rather than doing nothing. The panel is advisory — the server still
refuses anything illegal — but it reads the same published grammar, so the two
agree.

The node stays selected through a retype, so the details panel keeps showing
what you just changed.

## Editing several nodes at once

Select more than one node and the details panel switches to the things that
apply to a set: what is in the selection, its tags, and its status. Title and
body are per-node, so they disappear rather than pretending.

Tag and status chips are three-state. A solid chip means every selected node
has that value; a faded one with a count (`1/3`) means only some do. Faded is
an affordance, not a dead end — clicking still applies to all of them, which is
usually what you wanted when you noticed the inconsistency.

The whole edit is one action. Tagging forty nodes takes one `Ctrl+Z` to
reverse, and undo restores each node's own prior tags rather than a shared
state, so a tag that was on one of three goes back to being on one of three.

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

## Layout

Every node sits under whatever it hangs off, Notes included. `relates_to` is
not a *hierarchical* relationship — cross-links are its purpose, and treating
it as hierarchy would trip cycle detection — but that is a statement about
cycle checking, not about where a card belongs. An earlier version built the
tree from hierarchical edges alone, which left Notes parentless and lined them
up along the top beside the root questions. A Note now sits beneath the thing
it annotates, at whatever depth that is.

Auto layout is on by default and is a *view*, not a stored arrangement. It
recomputes the tidy tree from the graph on every change, so the map is always
what you would get by holding down `l`.

Because it never writes, a hand-arranged map survives a trip through it: turn
auto off and every node is exactly where its owner left it. Earlier this ran
once when you switched it on and then never again, so nodes added afterwards
kept the crude offset guessed from their parent and branches piled up on top of
each other.

**Dragging any node hands control back.** The visible auto positions are saved
first — the same write `l` performs — so nothing except the node under your
cursor moves. Without that the rest of the map would snap back to whatever was
saved before auto was switched on, mid-drag.

`l` is the explicit "commit this arrangement": it lays out and saves, leaving
the map indistinguishable from one where each node was dragged into place.

**A node you are about to type into is always on screen.** New nodes are placed
relative to whatever was selected, so during a fast capture run they regularly
landed past the edge — you got a cursor in a title field you could not see. The
canvas now shifts the minimum needed to show the whole card, and only when it
is actually clipped. Zoom is never touched.

## Zoom

The picker in the bottom-left corner defaults to **Auto**, where tidying
chooses the zoom that frames the map — the long-standing behaviour.

Pin a level and it survives `l`, `f`, Space and auto layout: those reposition
the viewport without changing how big anything looks. With a level pinned they
centre on the selection, or on the middle of the map when nothing is selected,
since framing everything is no longer possible at a fixed zoom.

Zooming by hand updates the picker to the nearest preset rather than being
overruled by it, so the control always names the zoom you are looking at.

## Filtering

Two presets, not four.

**Everything** is the unfiltered map. **Open questions** shows the discussions
the group has not settled yet. A Question counts as settled when an Idea
answering it is marked `resolved` — that is what resolving an Idea means, so
the issue above it is decided. The question, its answers and all the argument
underneath them fade out together.

Only top-level questions are tested. A settled sub-question inside a live
debate stays visible, because the reasoning that got the group to this point is
part of the discussion. Anything with no open question above it — a stranded
Idea, an unattached Note — fades, since it belongs to no live discussion.

Alongside the presets are status chips and a text box. Every criterion narrows.
A text match lights the nodes containing the text and nothing else: not their
children, not their parents. Searching for a word should find the nodes with
that word in them, not a subtree that happens to hang off one.

## Changing a map from the command line

Everything the canvas can do, the CLI can do — without a running server, and
with nothing on the machine but this binary.

```
dialogmapper map list
dialogmapper map new "Rollback policy"
dialogmapper map rm "Old map" --yes

dialogmapper node add --map Caching --type idea --title "Add a read-through cache" \
    --parent question_01h... --rel responds_to
dialogmapper node add --type note --title "Ref: Howard (1966)" \
    --link "https://doi.org/10.1109/TSSC.1966.300074|Howard 1966" --parent idea_01h...
dialogmapper node edit idea_01h... --status resolved
dialogmapper node rm note_01h... --map Caching     # off this map only

dialogmapper edge add pro_01h... idea_01h...       # relationship inferred
dialogmapper edge rm edge_01h...
```

For anything scripted or generated, `apply` takes a JSON array on stdin:

```
echo '[{"op":"create_node","map":"Caching","type":"con",
        "title":"Invalidation is forever","parent":"idea_01h...","rel":"objects_to"}]' \
  | dialogmapper apply
```

`dialogmapper apply --schema` prints the whole contract, generated from the
code the way `grammar --json` is. `--dry-run` validates without writing, and
`--json` reports the outcome machine-readably.

**Why this exists.** There used to be exactly one validated way to change a map
— the HTTP API — and it needed a running server. Anyone working offline or in a
script had to write SQL straight into `maps.db`, which silently skips the IBIS
grammar, the JSON shape of `nodes.content`, and the undo journal. Every command
above goes through the same store methods the HTTP handlers call, so all three
hold and cannot drift between the two doors.

Every operation except `create_map` is journaled, so `dialogmapper undo`
reverses it — including deleting a map, which restores its edges, placements
and groups. Map creation is deliberately excluded: undoing it would delete the
map, and `undo_log.map_id` cascades, so that delete would wipe the journal for
everything the map contained. `apply` reports how many of a batch are
reversible so its undo hint stays true.

A batch is not a single transaction. Operations apply in order and stop at the
first failure; validation runs over the whole batch first, so the common
mistakes are caught before anything is written.

## Update checks

`dialogmapper start` looks for a newer release. This is the only thing in
dialogmapper that reaches the internet on its own, so it is worth stating
exactly what it does:

- **`start` only.** `init`, `seed`, `export`, `grammar` and `undo` never touch
  the network, so scripts, CI jobs and AI agents stay silent.
- **Once a day**, cached in the project's own database. GitHub allows 60
  unauthenticated requests an hour *per IP*, which a team behind one office
  connection could otherwise exhaust between them.
- **Nothing about you or your maps is sent.** It is a `GET` to a public
  endpoint with no query string, no body and no cookies. The `User-Agent` names
  dialogmapper and its version, so the request is honest about what is asking.
- **It cannot slow you down.** The cached answer is read from SQLite and the
  refresh happens in the background, so a new release is reported from the
  *next* run onward and being offline costs nothing. Every failure — offline,
  proxied, rate limited — is swallowed silently.
- **The first run says so** before any request is made, rather than after.

Turn it off with `--no-update-check`, or `DIALOGMAPPER_NO_UPDATE_CHECK=1` to
disable it everywhere. `DIALOGMAPPER_UPDATE_ENDPOINT` points it at an internal
mirror instead.

A binary built without release tags — `go build` with no ldflags, or a
`go install` pseudo-version — never reports being out of date, since it may
well be ahead of the newest release.

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
participant rather than a facilitator: they see the conversation threaded under
its root questions, search across every map, and tap a node to add a reply. The
composer only offers moves that are legal against whatever was tapped, so a
phone user cannot construct an invalid map by accident.

Threads are ordered by their most recent activity rather than by when the
question was asked, so a live debate under an old question stays at the top.
Indentation is capped at three levels — deeper than that a phone runs out of
horizontal room, so those rows name their parent instead. Anything that arrives
while you are looking is marked new, because threading puts a reply where it
belongs rather than at the top where you would notice it.

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
- **Filters fade rather than hide.** Hiding nodes makes the remaining structure
  look complete when it is not, and it costs you the spatial memory of where
  things sit. Every criterion narrows and nothing widens: an earlier version
  expanded each match by one hop of neighbours, which pulled back in exactly
  what had just been excluded.

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
