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

Instructions and best practices for AI agents and Large Language Models (LLMs) contributing to this IBIS dialog map.

---

## 1. What This Project Is

An **Issue-Based Information System (IBIS)** dialog map stored in ` + "`maps.db`" + `. It models complex, wicked problems by disentangling:
* **Questions ` + "`[?]`" + `**: The issues to deliberate.
* **Ideas ` + "`[!]`" + `**: Candidate answers or proposals responding to a Question.
* **Pros ` + "`[+]`" + `**: Evidentiary arguments supporting an Idea or another argument.
* **Cons ` + "`[-]`" + `**: Evidentiary arguments objecting to an Idea or another argument.
* **Notes ` + "`[·]`" + `**: Contextual background, definitions, literature citations, or screenshots.
* **Maps ` + "`[M]`" + `**: Sub-maps embedded as a single node.

The goal is not consensus generation, but making rationale, trade-offs, and competing assumptions transparent and auditable.

---

## 2. The IBIS Grammar (The Only Legal Moves)

Every edge is directed, typed, and read **source-first**. The backend strictly enforces these relationships:

| Source Node | Edge (` + "`relationship_type`" + `) | Target Node | Meaning |
| :--- | :--- | :--- | :--- |
| **Idea** ` + "`[!]`" + ` / **Map** ` + "`[M]`" + ` | ` + "`responds_to`" + ` | **Question** ` + "`[?]`" + ` | Proposes a solution or answer to an issue |
| **Question** ` + "`[?]`" + ` | ` + "`questions`" + ` | *Anything* | Raises an issue or doubt about any element |
| **Question** ` + "`[?]`" + ` | ` + "`specializes`" + ` | **Question** ` + "`[?]`" + ` | Narrows the scope of a broader question |
| **Pro** ` + "`[+]`" + ` | ` + "`supports`" + ` | **Idea** ` + "`[!]`" + `, **Pro** ` + "`[+]`" + `, **Con** ` + "`[-]`" + `, **Map** ` + "`[M]`" + ` | Evidence or rationale in favor |
| **Con** ` + "`[-]`" + ` | ` + "`objects_to`" + ` | **Idea** ` + "`[!]`" + `, **Pro** ` + "`[+]`" + `, **Con** ` + "`[-]`" + `, **Map** ` + "`[M]`" + ` | Evidence or objection against |
| **Note** ` + "`[·]`" + ` | ` + "`relates_to`" + ` | *Anything* | Contextual note attached to a node |
| *Anything* | ` + "`relates_to`" + ` | **Note** ` + "`[·]`" + ` | Node references a contextual note |

> Note what is **not** legal: an Idea never attaches directly to another Idea as a competing alternative. Two Ideas under one Question are competing answers; that competition is carried by the Pros and Cons on each, not by an arrow between them.

Run ` + "`dialogmapper grammar --json`" + ` to get the machine-readable JSON ruleset.

---

## 3. Best Practices for LLMs Interacting with the Graph

### A. Cognitive & Deliberative Principles
1. **Ask Before Answering (Question-First):**
   * Never create an unanchored Idea. An Idea without a parent Question is a stranded opinion.
   * If a user proposes a solution, formulate the underlying Question first and attach the Idea via ` + "`responds_to`" + `.
2. **Counteract Sycophancy & Confirmation Bias (Argue Both Sides):**
   * LLMs naturally exhibit positive bias (generating only Pros). An Idea with only Pros is an unfinished analysis.
   * For every Idea, formulate at least one sharp, intellectually honest Con (` + "`objects_to`" + `).
   * Challenge underlying assumptions, failure modes, cost trade-offs, and operational bottlenecks.
3. **One Atomic Claim per Node:**
   * Node ` + "`title`" + ` must be short, declarative, and assertive (ideally 5–12 words).
   * Do not put paragraphs, caveats, or lists into the title.
   * Place nuance, proofs, explanations, and quotes in the node's ` + "`content.markdown`" + `.
4. **Cite Sources & Ground Arguments:**
   * Attach literature, empirical data, and DOIs using ` + "`[·]`" + ` Note nodes with ` + "`relates_to`" + ` edges.
   * Populate ` + "`content.links`" + ` with ` + "`[{\"url\": \"...\", \"title\": \"...\"}]`" + ` objects.
   * Drop supporting images and files into ` + "`.assets/`" + `.
5. **Transclude Before Duplicating:**
   * Search existing nodes before creating new ones.
   * If a concept already exists across maps, transclude it onto the current map (` + "`map_nodes`" + `) rather than creating a duplicate row.
6. **Preserve Status Integrity:**
   * Keep ` + "`status`" + ` as ` + "`\"open\"`" + ` during exploration.
   * Set a Question to ` + "`\"resolved\"`" + ` only when a specific Idea has been explicitly chosen by the user/team.

---

## 4. Interaction Methods & Tools

### Method 1: Bulk Ingestion via Markdown Seeding (Recommended for New Content)
Use ` + "`dialogmapper seed`" + ` to scaffold structured trees from text or files:

` + "```bash" + `
# Preview what will be created
dialogmapper seed --dry-run --context seed.md

# Seed into a specific map (creates map if it does not exist)
dialogmapper seed --map "Map Name" --context seed.md

# Seed into an existing map ID
dialogmapper seed --map-id "map_01..." --context seed.md
` + "```" + `

#### Markdown Seed Syntax:
` + "```markdown" + `
# Question Title #tag1                       <- [?] Question
> Context or background note                 <- [·] Note (relates_to Question)

- Candidate Idea Title #tag2                 <- [!] Idea (responds_to Question)
  + Supporting evidence or benefit           <- [+] Pro (supports Idea)
  ! Objection, risk, or failure mode         <- [-] Con (objects_to Idea)

Sub-question ending with a question mark?    <- [?] Question (specializes Question)
  - Sub-idea responding to sub-question      <- [!] Idea (responds_to Sub-question)
` + "```" + `

---

### Method 2: Targeted Edits via ` + "`dialogmapper apply`" + ` (Recommended for Incremental Changes)

**Do not write SQL against ` + "`maps.db`" + `.** It is the fastest way to corrupt a map, because it silently skips three things the tool depends on:

* the **IBIS grammar**, which lives in Go — SQL will happily insert a Pro supporting a Question;
* the **JSON shape of ` + "`nodes.content`" + `** — a bare string where a ` + "`{url, title}`" + ` link belongs breaks the UI rather than erroring;
* the **undo journal** — nothing you do can be reversed, by you or by the user.

` + "`dialogmapper apply`" + ` takes a JSON array of operations on stdin and runs each one through exactly the same validated path the canvas uses. It needs no running server and no Python, sqlite3 or other tooling.

` + "```bash" + `
# The whole contract, generated from the code:
dialogmapper apply --schema

# Attach a cited Note to an existing Idea
echo '[{"op":"create_node","map":"Problem Solving","type":"note",
        "title":"Ref: Howard (1966)",
        "body":"Information Value Theory: the expected value of perfect information.",
        "links":[{"url":"https://doi.org/10.1109/TSSC.1966.300074","title":"Howard 1966"}],
        "parent":"idea_01...","rel":"relates_to"}]' | dialogmapper apply

# Check a batch without writing anything
dialogmapper apply --dry-run -f changes.json

# Machine-readable result, including how to reverse it
dialogmapper apply --json -f changes.json
` + "```" + `

Operations: ` + "`create_map`" + `, ` + "`delete_map`" + `, ` + "`create_node`" + `, ` + "`update_node`" + `, ` + "`delete_node`" + `, ` + "`remove_node`" + `, ` + "`create_edge`" + `, ` + "`delete_edge`" + `.

**Rules that matter:**
1. **Never invent an id.** dialogmapper generates them and returns them in the report.
2. ` + "`map`" + ` accepts a name or an id, and may be omitted when the project has exactly one map.
3. ` + "`parent`" + ` + ` + "`rel`" + ` attach a new node in the same transaction. Omit ` + "`rel`" + ` to let the grammar infer the obvious relationship.
4. A batch is **not** one transaction. Operations apply in order and stop at the first failure; the report gives ` + "`applied`" + `, ` + "`failedAt`" + ` and an ` + "`undoHint`" + `.
5. Everything except ` + "`create_map`" + ` is journaled, so ` + "`dialogmapper undo`" + ` reverses it — including deleting a map.

For single edits by hand, the same operations exist as commands:

` + "```bash" + `
dialogmapper map list
dialogmapper node add --map "Problem Solving" --type note --title "Ref: Howard (1966)" \
    --link "https://doi.org/10.1109/TSSC.1966.300074|Howard 1966" --parent idea_01...
dialogmapper node edit idea_01... --status resolved
dialogmapper edge add pro_01... idea_01...
dialogmapper map rm "Old Map" --yes
` + "```" + `

Changes reach any running ` + "`dialogmapper start`" + ` immediately: the server watches ` + "`PRAGMA data_version`" + ` and fans updates out to open browsers.

---

### Method 3: Inspecting & Exporting the Graph
` + "```bash" + `
# Export the current active map as Markdown (for reading argument trees)
dialogmapper export --format md

# Export the graph as JSON-LD (for programmatic graph analysis)
dialogmapper export --format json
` + "```" + `

#### Reading Markdown Exports:
* ` + "`[?]`" + ` = Question
* ` + "`[!]`" + ` = Idea
* ` + "`[+]`" + ` = Pro
* ` + "`[-]`" + ` = Con
* ` + "`[·]`" + ` = Note
* Indentation represents hierarchical argument nesting; non-hierarchical cross-links appear under ` + "`## Cross-links`" + `.
`
