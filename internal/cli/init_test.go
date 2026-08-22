package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// `init` has no destructive path at all. It used to: --force deleted maps.db,
// which took every map and the whole undo journal with it, with no prompt and
// no way back. These pin that it cannot happen again.

func TestInitIsSafeToRerun(t *testing.T) {
	p := newCLI(t) // runs init once
	p.run("node", "add", "--map", "Caching", "--type", "question", "--title", "Precious work")

	out := p.run("init")
	if !strings.Contains(out, "nothing was removed") {
		t.Errorf("re-running init should say it left things alone:\n%s", out)
	}
	if !strings.Contains(p.run("export", "--format", "json"), "Precious work") {
		t.Fatal("re-running init destroyed a node")
	}
}

// The behaviour that was asked for, and the one that used to cost you the
// project.
func TestForceRefreshesDocsAndKeepsMaps(t *testing.T) {
	p := newCLI(t)
	p.run("node", "add", "--map", "Caching", "--type", "question", "--title", "Precious work")

	agents := filepath.Join(p.dir, "AGENTS.md")
	if err := os.WriteFile(agents, []byte("# stale guidance\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	out := p.run("init", "--force")
	if !strings.Contains(out, "AGENTS.md") {
		t.Errorf("--force should refresh AGENTS.md:\n%s", out)
	}

	body, err := os.ReadFile(agents)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "stale guidance") {
		t.Error("AGENTS.md was not rewritten")
	}
	if !strings.Contains(string(body), "dialogmapper apply") {
		t.Error("the refreshed AGENTS.md does not carry the current guidance")
	}

	// The maps are the point: --force must never touch them.
	if !strings.Contains(p.run("export", "--format", "json"), "Precious work") {
		t.Fatal("--force destroyed a node")
	}
	if !strings.Contains(p.run("map", "list"), "Caching") {
		t.Fatal("--force destroyed a map")
	}
}

func TestForceKeepsTheOldDocAsBackup(t *testing.T) {
	// Somebody may have added project notes to the generated file. Losing them
	// silently is exactly what this command no longer does.
	p := newCLI(t)
	agents := filepath.Join(p.dir, "AGENTS.md")
	if err := os.WriteFile(agents, []byte("# my own notes\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	p.run("init", "--force")

	backup, err := os.ReadFile(agents + ".bak")
	if err != nil {
		t.Fatalf("no backup was kept: %v", err)
	}
	if !strings.Contains(string(backup), "my own notes") {
		t.Errorf("backup = %q", backup)
	}
}

func TestForceIsIdempotent(t *testing.T) {
	p := newCLI(t)
	p.run("init", "--force")
	out := p.run("init", "--force")

	if !strings.Contains(out, "already up to date") {
		t.Errorf("a second --force should report nothing to do:\n%s", out)
	}
	// And no pointless backup of an identical file.
	if _, err := os.Stat(filepath.Join(p.dir, "AGENTS.md.bak")); err == nil {
		t.Error("a backup was written for an unchanged file")
	}
}

func TestInitDoesNotAddASecondMap(t *testing.T) {
	// The first map belongs to creating the database. Re-running init on an
	// existing project should not quietly accumulate empty maps.
	p := newCLI(t)
	before := strings.Count(p.run("map", "list"), "\n")

	p.run("init")
	p.run("init", "--map", "Another")

	if after := strings.Count(p.run("map", "list"), "\n"); after != before {
		t.Errorf("map count went from %d to %d", before, after)
	}
}

func TestInitCreatesWhatIsMissing(t *testing.T) {
	// Deleting a generated file and re-running should put it back, without
	// --force and without touching anything else.
	p := newCLI(t)
	if err := os.Remove(filepath.Join(p.dir, "README.md")); err != nil {
		t.Fatal(err)
	}
	out := p.run("init")
	if !strings.Contains(out, "+ README.md") {
		t.Errorf("init should recreate a missing file:\n%s", out)
	}
	if _, err := os.Stat(filepath.Join(p.dir, "README.md")); err != nil {
		t.Errorf("README.md was not recreated: %v", err)
	}
}
