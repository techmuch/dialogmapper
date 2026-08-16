package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/store"
)

func newInitCmd() *cobra.Command {
	var mapName string
	var force bool

	cmd := &cobra.Command{
		Use:   "init",
		Short: "Initialize a dialogmapper project in the current directory",
		Long: `Creates maps.db, an .assets directory for local images, and starter
AGENTS.md and README.md files.

Re-running init is safe: an existing database is left alone unless --force is
given, and existing markdown files are never overwritten.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := resolveDir()
			if err != nil {
				return err
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}

			dbPath := filepath.Join(dir, store.DBFileName)
			if store.Exists(dir) && !force {
				return fmt.Errorf(
					"%s already exists — pass --force to reinitialize (this deletes every map)",
					dbPath)
			}
			if force && store.Exists(dir) {
				for _, suffix := range []string{"", "-wal", "-shm"} {
					_ = os.Remove(dbPath + suffix)
				}
			}

			assets := filepath.Join(dir, store.AssetsDirName)
			if err := os.MkdirAll(assets, 0o755); err != nil {
				return err
			}
			// Keep the directory in version control even when empty, and stop
			// tooling from treating dropped images as source.
			if _, err := writeIfAbsent(filepath.Join(assets, ".gitignore"),
				"# Local media dropped into dialogmapper.\n# Committed by default; add rules here to exclude large files.\n"); err != nil {
				return err
			}

			st, err := store.Open(dir)
			if err != nil {
				return err
			}
			defer st.Close()

			m, err := st.CreateMap(mapName, "")
			if err != nil {
				return err
			}

			created := []string{store.DBFileName, store.AssetsDirName + "/"}
			for name, body := range map[string]string{
				"AGENTS.md": agentsTemplate,
				"README.md": readmeTemplate(filepath.Base(dir), mapName),
			} {
				wrote, err := writeIfAbsent(filepath.Join(dir, name), body)
				if err != nil {
					return err
				}
				if wrote {
					created = append(created, name)
				}
			}

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "Initialized dialogmapper project in %s\n", dir)
			for _, c := range created {
				fmt.Fprintf(out, "  + %s\n", c)
			}
			fmt.Fprintf(out, "\nCreated map %q (%s)\n", m.Name, m.ID)
			fmt.Fprintf(out, "\nNext: dialogmapper start --open\n")
			return nil
		},
	}

	cmd.Flags().StringVar(&mapName, "map", "Untitled Map", "name of the first map")
	cmd.Flags().BoolVar(&force, "force", false, "delete and recreate an existing database")
	return cmd
}

func readmeTemplate(dirName, mapName string) string {
	return fmt.Sprintf(`# %s

A [dialogmapper](https://github.com/techmuch/dialogmapper) project: an
IBIS dialog map of a problem worth arguing about carefully.

## Working with this project

    dialogmapper start --open        # open the canvas in your browser
    dialogmapper seed --context notes.md
    dialogmapper export --format md > map.md

## What is in here

| Path       | Purpose |
|------------|---------|
| `+"`maps.db`"+`  | SQLite database holding every map, node and edge |
| `+"`.assets/`"+` | Images and files dropped onto nodes |
| `+"`AGENTS.md`"+`| Instructions for AI agents working on this map |

The first map is called **%s**.

## The grammar

Nodes are one of six types and edges must be legal IBIS moves:

- **Question** — an issue to deliberate
- **Idea** — a candidate answer to a Question
- **Pro** — an argument supporting an Idea
- **Con** — an argument against an Idea
- **Note** — context, evidence, a screenshot; attaches to anything
- **Map** — a whole sub-map embedded as one node

Run `+"`dialogmapper grammar`"+` to print the full ruleset.

## Keyboard capture loop

The canvas is built for talking and typing at the same time, not for the mouse:

| Key | Action |
|-----|--------|
| `+"`n`"+` | New note (or an Idea, if a Question is selected) |
| `+"`q`"+` | New Question about the selection |
| `+"`+`"+` | New Pro supporting the selection |
| `+"`-`"+` | New Con objecting to the selection |
| `+"`Enter`"+` | Commit the title, keep the node selected |
| `+"`Arrows`"+` | Move the selection through the graph |
| `+"`Space`"+` | Zoom to fit, or centre on the selection |
| `+"`/`"+` | Search and insert an existing node |
`, dirName, mapName)
}

const agentsTemplate = `# AGENTS.md

Instructions for AI agents contributing to this dialog map.

## What this project is

An IBIS (Issue-Based Information System) dialog map stored in ` + "`maps.db`" + `.
It exists to make a wicked problem arguable: to separate the questions from the
proposed answers, and the answers from the evidence for and against them.

## The rules you must follow

Every edge is typed and directed, and read source-first. These are the only
legal moves:

| Edge | Meaning |
|------|---------|
| Idea → **responds_to** → Question | an answer to an open issue |
| Question → **questions** → anything | raising an issue about something |
| Pro → **supports** → Idea (or another argument) | evidence in favour |
| Con → **objects_to** → Idea (or another argument) | evidence against |
| Note → **relates_to** → anything | context with no argumentative force |
| Question/Idea → **specializes** → same type | narrowing scope |

The backend rejects anything else with an explanation of what would have been
legal, so it is safe to try. Run ` + "`dialogmapper grammar --json`" + ` to get
the machine-readable ruleset.

## How to contribute well

1. **Ask before answering.** If the map has no Question covering a topic, add
   the Question first. An Idea with no parent Question is a stranded opinion.
2. **One claim per node.** Titles should be short and assertive. Put nuance,
   citations and caveats in the node body, not the title.
3. **Argue both sides.** An Idea with only Pros attached is a red flag; look
   for the strongest Con you can honestly state.
4. **Reuse, do not duplicate.** Search before creating. If a node already
   exists, transclude it into this map rather than restating it — that is what
   the shared-node badge tracks.
5. **Cite.** Put sources in the node's links, and drop supporting screenshots
   into ` + "`.assets/`" + `.
6. **Mark status honestly.** Set a Question to ` + "`resolved`" + ` only when an
   Idea beneath it has actually been chosen.

## Useful commands

    dialogmapper seed --context research.md   # scaffold questions from a doc
    dialogmapper export --format md           # readable outline
    dialogmapper export --format json         # JSON-LD for further processing
    dialogmapper grammar --json               # the edge ruleset

## Reading an export

Markdown exports use ` + "`[?]`" + ` for Questions, ` + "`[!]`" + ` for Ideas,
` + "`[+]`" + ` for Pros, ` + "`[-]`" + ` for Cons and ` + "`[·]`" + ` for Notes.
Indentation is the argument tree; cross-links appear in their own section at
the end because they would otherwise distort the hierarchy.
`
