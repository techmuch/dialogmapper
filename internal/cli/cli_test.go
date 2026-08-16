package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/store"
)

// Round-trip tests that drive the real cobra commands: init writes a project,
// seed fills it, export reads it back. These are the exact code paths a user
// hits, including flag parsing and the file scaffolding.

// run executes a command against dir and returns its stdout.
func run(t *testing.T, dir string, cmd *cobra.Command, args ...string) string {
	t.Helper()
	// projectDir is the package-level target of the persistent --dir flag.
	prev := projectDir
	projectDir = dir
	t.Cleanup(func() { projectDir = prev })

	var out, errOut bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&errOut)
	cmd.SetArgs(args)
	if err := cmd.Execute(); err != nil {
		t.Fatalf("%s %v: %v\nstderr: %s", cmd.Name(), args, err, errOut.String())
	}
	return out.String()
}

func runExpectingError(t *testing.T, dir string, cmd *cobra.Command, args ...string) error {
	t.Helper()
	prev := projectDir
	projectDir = dir
	t.Cleanup(func() { projectDir = prev })

	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(args)
	return cmd.Execute()
}

func TestInitScaffoldsAProject(t *testing.T) {
	dir := t.TempDir()
	out := run(t, dir, newInitCmd(), "--map", "Wicked problem")

	for _, want := range []string{store.DBFileName, "AGENTS.md", "README.md"} {
		if _, err := os.Stat(filepath.Join(dir, want)); err != nil {
			t.Errorf("init did not create %s: %v", want, err)
		}
		if !strings.Contains(out, want) {
			t.Errorf("init output did not mention %s:\n%s", want, out)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, store.AssetsDirName)); err != nil {
		t.Errorf("init did not create %s: %v", store.AssetsDirName, err)
	}

	// AGENTS.md is the contract an AI contributor reads, so the rules have to
	// actually be in it rather than just a title.
	agents, err := os.ReadFile(filepath.Join(dir, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"responds_to", "supports", "objects_to", "relates_to", "grammar --json"} {
		if !strings.Contains(string(agents), want) {
			t.Errorf("AGENTS.md never mentions %q", want)
		}
	}
}

func TestInitRefusesToClobberAndNeverOverwritesEdits(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())

	// Re-running must not silently destroy a project full of thinking.
	err := runExpectingError(t, dir, newInitCmd())
	if err == nil {
		t.Fatal("second init should have refused")
	}
	if !strings.Contains(err.Error(), "--force") {
		t.Errorf("error should point at --force, got: %v", err)
	}

	// A README the user has edited is theirs, even under --force.
	readme := filepath.Join(dir, "README.md")
	if err := os.WriteFile(readme, []byte("# My own notes\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(t, dir, newInitCmd(), "--force")
	got, err := os.ReadFile(readme)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "# My own notes\n" {
		t.Errorf("--force overwrote an edited README:\n%s", got)
	}
}

func TestCommandsFailClearlyWithoutInit(t *testing.T) {
	dir := t.TempDir()
	err := runExpectingError(t, dir, newExportCmd())
	if err == nil {
		t.Fatal("export in an uninitialized directory should fail")
	}
	// The message has to say what to do, not just what went wrong.
	if !strings.Contains(err.Error(), "dialogmapper init") {
		t.Errorf("error should suggest running init, got: %v", err)
	}
}

func TestSeedThenExportRoundTrip(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())

	doc := filepath.Join(dir, "research.md")
	if err := os.WriteFile(doc, []byte(`# Caching strategy

Our p99 is 1.4s and users notice. #perf

- Add a read-through cache
+ Cuts p99 to roughly 200ms in the prototype.
! Invalidation becomes our problem forever.
- Denormalise the hot tables
! Doubles write cost.

## Rollback

How fast can we undo this?
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// --dry-run must not write anything.
	preview := run(t, dir, newSeedCmd(), "--context", doc, "--map", "Caching", "--dry-run")
	if !strings.Contains(preview, "Would create") {
		t.Errorf("dry run output looks wrong:\n%s", preview)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	maps, err := st.ListMaps()
	if err != nil {
		t.Fatal(err)
	}
	if len(maps) != 1 {
		t.Errorf("--dry-run created %d maps, want 1 (the one from init)", len(maps))
	}
	st.Close()

	seedOut := run(t, dir, newSeedCmd(), "--context", doc, "--map", "Caching")
	if !strings.Contains(seedOut, "nodes created") {
		t.Errorf("seed output:\n%s", seedOut)
	}
	if strings.Contains(seedOut, "skipped") {
		t.Errorf("seed skipped nodes, meaning it built an illegal edge:\n%s", seedOut)
	}

	// Markdown export: structure must be nested, not flat.
	md := run(t, dir, newExportCmd(), "--all", "--format", "md")
	for _, want := range []string{
		"[?] **What should we do about caching strategy?**",
		"  - [!] **Add a read-through cache**",
		"    - [+] **Cuts p99",
		"    - [-] **Invalidation becomes",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown export missing %q:\n%s", want, md)
		}
	}
	if !strings.Contains(md, "#perf") {
		t.Errorf("export dropped tags:\n%s", md)
	}

	// JSON export must be a single valid document even with several maps.
	jsonOut := run(t, dir, newExportCmd(), "--all", "--format", "json")
	var doc2 map[string]any
	if err := json.Unmarshal([]byte(jsonOut), &doc2); err != nil {
		t.Fatalf("multi-map JSON export is not valid JSON: %v\n%s", err, truncate(jsonOut))
	}
	if _, ok := doc2["@graph"]; !ok {
		t.Errorf("multi-map export should wrap documents in @graph, got keys %v", keys(doc2))
	}

	// Single-map JSON carries the grammar so a consumer need not guess.
	single := run(t, dir, newExportCmd(), "--format", "json")
	var one map[string]any
	if err := json.Unmarshal([]byte(single), &one); err != nil {
		t.Fatalf("single-map JSON export invalid: %v", err)
	}
	if _, ok := one["grammar"]; !ok {
		t.Error("JSON-LD export omits the grammar")
	}
	if _, ok := one["@context"]; !ok {
		t.Error("JSON-LD export omits @context")
	}
}

func TestExportWritesToFile(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())
	out := filepath.Join(dir, "map.md")
	run(t, dir, newExportCmd(), "--format", "md", "--out", out)

	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("--out did not write a file: %v", err)
	}
	if !strings.HasPrefix(string(b), "# ") {
		t.Errorf("exported file does not start with a heading:\n%s", truncate(string(b)))
	}
}

func TestSeedRejectsAMissingContextFile(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())
	err := runExpectingError(t, dir, newSeedCmd(), "--context", filepath.Join(dir, "nope.md"))
	if err == nil {
		t.Fatal("seed should fail on a missing file")
	}
}

func TestSeedFromStdin(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())

	cmd := newSeedCmd()
	prev := projectDir
	projectDir = dir
	t.Cleanup(func() { projectDir = prev })

	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetIn(strings.NewReader("# Piped topic\n\n- An idea\n"))
	cmd.SetArgs([]string{"--context", "-", "--map", "Piped"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("seed from stdin: %v\n%s", err, out.String())
	}
	if !strings.Contains(out.String(), "2 nodes created") {
		t.Errorf("stdin seed output:\n%s", out.String())
	}
}

// TestUndoReversesASeedRun is the reason `dialogmapper undo` exists: a seed
// that produced the wrong structure would otherwise have to be unpicked node
// by node, or the project started over.
func TestUndoReversesASeedRun(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())

	doc := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(doc, []byte("# Topic\n\n- An idea\n+ a pro\n! a con\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	seedOut := run(t, dir, newSeedCmd(), "--context", doc, "--map", "Seeded")
	// The command must say how to reverse itself; otherwise the user has to
	// guess the step count.
	if !strings.Contains(seedOut, "dialogmapper undo --steps 4") {
		t.Errorf("seed should print the exact undo command:\n%s", seedOut)
	}

	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	maps, _ := st.ListMaps()
	var seeded string
	for _, m := range maps {
		if m.Name == "Seeded" {
			seeded = m.ID
		}
	}
	if seeded == "" {
		t.Fatal("seeded map not found")
	}
	before, _ := st.Graph(seeded)
	st.Close()
	if len(before.Nodes) != 4 {
		t.Fatalf("expected 4 seeded nodes, got %d", len(before.Nodes))
	}

	preview := run(t, dir, newUndoCmd(), "--dry-run")
	if !strings.Contains(preview, "Would undo:") {
		t.Errorf("dry run output:\n%s", preview)
	}

	out := run(t, dir, newUndoCmd(), "--steps", "4")
	if strings.Count(out, "Undone:") != 4 {
		t.Errorf("expected four undo lines:\n%s", out)
	}

	st2, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	after, _ := st2.Graph(seeded)
	if len(after.Nodes) != 0 {
		t.Errorf("seed not fully reversed: %d nodes left", len(after.Nodes))
	}

	// And forwards again.
	redone := run(t, dir, newRedoCmd(), "--steps", "4")
	if strings.Count(redone, "Redone:") != 4 {
		t.Errorf("expected four redo lines:\n%s", redone)
	}
	st3, _ := store.Open(dir)
	defer st3.Close()
	back, _ := st3.Graph(seeded)
	if len(back.Nodes) != 4 || len(back.Edges) != 3 {
		t.Errorf("redo restored %d nodes / %d edges, want 4/3",
			len(back.Nodes), len(back.Edges))
	}
}

func TestUndoWithEmptyHistorySaysSo(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, newInitCmd())
	out := run(t, dir, newUndoCmd())
	if !strings.Contains(out, "Nothing to undo") {
		t.Errorf("output = %q", out)
	}
}

func TestGrammarCommandEmitsValidJSON(t *testing.T) {
	dir := t.TempDir()
	out := run(t, dir, newGrammarCmd(), "--json")

	var g struct {
		NodeTypes []string         `json:"nodeTypes"`
		Rules     []map[string]any `json:"rules"`
	}
	if err := json.Unmarshal([]byte(out), &g); err != nil {
		t.Fatalf("grammar --json is not valid JSON: %v\n%s", err, out)
	}
	if len(g.NodeTypes) == 0 || len(g.Rules) == 0 {
		t.Error("grammar --json is empty; agents have nothing to read")
	}

	// The human form should be readable without being JSON.
	human := run(t, dir, newGrammarCmd())
	if strings.HasPrefix(strings.TrimSpace(human), "{") {
		t.Error("plain `grammar` should not print JSON")
	}
	if !strings.Contains(human, "responds_to") {
		t.Errorf("human grammar output missing relationships:\n%s", human)
	}
}

func truncate(s string) string {
	if len(s) > 600 {
		return s[:600] + "…"
	}
	return s
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
