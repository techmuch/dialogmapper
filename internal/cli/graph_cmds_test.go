package cli

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// These drive the real binary, because the point of the whole surface is that
// somebody on a clean machine — a person, a script, or an agent — can change a
// map with nothing but dialogmapper on the PATH.

type project struct {
	t   *testing.T
	bin string
	dir string
}

func newCLI(t *testing.T) project {
	t.Helper()
	p := project{t: t, bin: buildBinary(t), dir: t.TempDir()}
	p.run("init", "--map", "Caching")
	return p
}

// run executes a subcommand and fails the test if it errors.
func (p project) run(args ...string) string {
	p.t.Helper()
	out, err := p.try(args...)
	if err != nil {
		p.t.Fatalf("dialogmapper %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return out
}

// try executes a subcommand and returns its output and error.
func (p project) try(args ...string) (string, error) {
	p.t.Helper()
	cmd := exec.Command(p.bin, append([]string{"-C", p.dir}, args...)...)
	cmd.Env = append(os.Environ(), "DIALOGMAPPER_NO_UPDATE_CHECK=1")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// pipe feeds stdin to a subcommand.
func (p project) pipe(stdin string, args ...string) (string, error) {
	p.t.Helper()
	cmd := exec.Command(p.bin, append([]string{"-C", p.dir}, args...)...)
	cmd.Env = append(os.Environ(), "DIALOGMAPPER_NO_UPDATE_CHECK=1")
	cmd.Stdin = strings.NewReader(stdin)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// nodeID finds a node by a fragment of its title, via the JSON export.
func (p project) nodeID(fragment string) string {
	p.t.Helper()
	var doc any
	if err := json.Unmarshal([]byte(p.run("export", "--format", "json")), &doc); err != nil {
		p.t.Fatal(err)
	}
	var found string
	var walk func(any)
	walk = func(v any) {
		if found != "" {
			return
		}
		switch t := v.(type) {
		case map[string]any:
			if title, ok := t["title"].(string); ok && strings.Contains(title, fragment) {
				if id, ok := t["id"].(string); ok {
					found = id
					return
				}
			}
			for _, x := range t {
				walk(x)
			}
		case []any:
			for _, x := range t {
				walk(x)
			}
		}
	}
	walk(doc)
	if found == "" {
		p.t.Fatalf("no node matching %q", fragment)
	}
	return found
}

// TestNoExternalToolsNeeded is the point of the exercise: everything that
// previously required python3 and the sqlite3 CLI is now a subcommand.
func TestNoExternalToolsNeeded(t *testing.T) {
	p := newCLI(t)

	p.run("node", "add", "--map", "Caching", "--type", "question",
		"--title", "Should we cache reads?")
	q := p.nodeID("Should we cache reads")

	p.run("node", "add", "--map", "Caching", "--type", "idea",
		"--title", "Add a read-through cache", "--parent", q, "--rel", "responds_to")
	idea := p.nodeID("read-through cache")

	// The exact operation that forced raw SQL: a cited Note on an Idea.
	p.run("node", "add", "--map", "Caching", "--type", "note",
		"--title", "Ref: Howard (1966)",
		"--body", "Information Value Theory.",
		"--link", "https://doi.org/10.1109/TSSC.1966.300074|Howard 1966",
		"--parent", idea)

	out := p.run("export", "--format", "json")
	if !strings.Contains(out, `"url": "https://doi.org/10.1109/TSSC.1966.300074"`) {
		t.Errorf("the link was not stored as a {url,title} object:\n%s", out)
	}

	// Editing and deleting, without touching the database directly.
	p.run("node", "edit", idea, "--status", "resolved")
	if !strings.Contains(p.run("export", "--format", "json"), `"status": "resolved"`) {
		t.Error("status edit did not land")
	}
	p.run("node", "rm", p.nodeID("Ref: Howard"), "--yes")
	if strings.Contains(p.run("export", "--format", "json"), "Ref: Howard") {
		t.Error("node rm did not remove the note")
	}
}

func TestApplyRefusesIllegalMovesAndWritesNothing(t *testing.T) {
	p := newCLI(t)
	p.run("node", "add", "--map", "Caching", "--type", "question", "--title", "A question")
	q := p.nodeID("A question")

	out, err := p.pipe(`[{"op":"create_node","map":"Caching","type":"pro",
	                      "title":"Illegal","parent":"`+q+`","rel":"supports"}]`, "apply")
	if err == nil {
		t.Fatalf("a Pro supporting a Question should be refused:\n%s", out)
	}
	if !strings.Contains(out, "illegal IBIS edge") {
		t.Errorf("the refusal should name the rule:\n%s", out)
	}
	if strings.Contains(p.run("export", "--format", "json"), "Illegal") {
		t.Error("the refused node was written anyway")
	}
}

func TestApplyIsUndoable(t *testing.T) {
	p := newCLI(t)
	res, err := p.pipe(`[{"op":"create_node","map":"Caching","type":"question","title":"Reversible?"}]`, "apply")
	if err != nil {
		t.Fatalf("apply: %v\n%s", err, res)
	}
	if !strings.Contains(res, "dialogmapper undo") {
		t.Errorf("the report should say how to reverse itself:\n%s", res)
	}
	p.run("undo")
	if strings.Contains(p.run("export", "--format", "json"), "Reversible?") {
		t.Error("undo did not reverse what apply did")
	}
}

func TestApplyDryRunWritesNothing(t *testing.T) {
	p := newCLI(t)
	out, err := p.pipe(`[{"op":"create_node","map":"Caching","type":"note","title":"Not written"}]`,
		"apply", "--dry-run")
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if !strings.Contains(out, "validated") {
		t.Errorf("dry run should say it validated:\n%s", out)
	}
	if strings.Contains(p.run("export", "--format", "json"), "Not written") {
		t.Error("a dry run wrote to the database")
	}
}

func TestDeletingAMapIsUndoable(t *testing.T) {
	p := newCLI(t)
	p.run("node", "add", "--map", "Caching", "--type", "question", "--title", "Kept safe")

	p.run("map", "rm", "Caching", "--yes")
	if strings.Contains(p.run("map", "list"), "Caching") {
		t.Fatal("map was not deleted")
	}
	p.run("undo")
	if !strings.Contains(p.run("map", "list"), "Caching") {
		t.Error("undo did not restore the map")
	}
	if !strings.Contains(p.run("export", "--format", "json"), "Kept safe") {
		t.Error("the map came back empty; its placements were not restored")
	}
}

// Destructive commands must not proceed unattended without --yes: an agent
// running in a pipeline has nobody to answer the prompt.
func TestDestructiveCommandsRefuseWithoutConfirmation(t *testing.T) {
	p := newCLI(t)
	out, err := p.try("map", "rm", "Caching")
	if err == nil {
		t.Fatalf("expected a refusal without --yes:\n%s", out)
	}
	if !strings.Contains(out, "--yes") {
		t.Errorf("the refusal should say how to proceed:\n%s", out)
	}
	if !strings.Contains(p.run("map", "list"), "Caching") {
		t.Error("the map was deleted despite the refusal")
	}
}

func TestSchemaIsSelfDescribing(t *testing.T) {
	p := newCLI(t)
	var schema map[string]any
	if err := json.Unmarshal([]byte(p.run("apply", "--schema")), &schema); err != nil {
		t.Fatalf("--schema is not valid JSON: %v", err)
	}
	for _, key := range []string{"ops", "values", "guarantees", "caveats"} {
		if schema[key] == nil {
			t.Errorf("schema is missing %q", key)
		}
	}
}

// AGENTS.md is where an agent looks, and it used to tell them to write SQL.
func TestAgentsFileDirectsAgentsAwayFromSQL(t *testing.T) {
	p := newCLI(t)
	body, err := os.ReadFile(filepath.Join(p.dir, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !strings.Contains(text, "Do not write SQL") {
		t.Error("AGENTS.md should tell agents not to write SQL directly")
	}
	if !strings.Contains(text, "dialogmapper apply") {
		t.Error("AGENTS.md should point at the supported mutation path")
	}
	// The grammar table must not advertise a rule the binary rejects.
	if strings.Contains(text, "`specializes` | **Idea**") {
		t.Error("AGENTS.md still documents Idea specializes Idea, which is illegal")
	}
}
