package cli

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The update check is the only thing in dialogmapper that reaches the internet
// on its own, so these run the real binary and assert on what it prints and —
// more importantly — on when it makes no request at all.

// buildBinary compiles dialogmapper once for this test binary's lifetime.
func buildBinary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "dialogmapper")
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "build", "-ldflags", "-X main.version=v1.0.0", "-o", bin, ".")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	return bin
}

// safeBuf collects a child process's output.
//
// os/exec writes into it from a copier goroutine while the test polls it for
// the banner, so it needs a lock — the race detector is right to object, and a
// torn read here would make the wait flaky rather than wrong.
type safeBuf struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *safeBuf) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *safeBuf) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// runStart starts the server, waits for the banner, then stops it.
func runStart(t *testing.T, bin, project string, env []string, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	full := append([]string{"-C", project, "start", "--port", "0",
		"--host", "127.0.0.1", "--no-qr"}, args...)
	cmd := exec.CommandContext(ctx, bin, full...)
	cmd.Env = append(os.Environ(), env...)
	var buf safeBuf
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	// The banner is printed before the server blocks, so a short wait is
	// enough; the background refresh is given time to land too.
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) && !strings.Contains(buf.String(), "Ctrl-C") {
		time.Sleep(50 * time.Millisecond)
	}
	time.Sleep(400 * time.Millisecond)
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	return buf.String()
}

func newProject(t *testing.T, bin string) string {
	t.Helper()
	dir := t.TempDir()
	out, err := exec.Command(bin, "-C", dir, "init").CombinedOutput()
	if err != nil {
		t.Fatalf("init: %v\n%s", err, out)
	}
	return dir
}

func TestStartDisclosesThenReportsAnUpdate(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Write([]byte(`{"tag_name":"v9.9.9","html_url":"https://example.test/v9"}`))
	}))
	defer srv.Close()

	bin := buildBinary(t)
	project := newProject(t, bin)
	env := []string{"DIALOGMAPPER_UPDATE_ENDPOINT=" + srv.URL}

	// First run: says what it is about to do, and has nothing to report yet.
	first := runStart(t, bin, project, env)
	if !strings.Contains(first, "will check github.com") {
		t.Errorf("first run did not disclose the network access:\n%s", first)
	}
	if strings.Contains(first, "Update available") {
		t.Errorf("nothing should be reported before the first fetch lands:\n%s", first)
	}

	// Second run: the cached answer is read with no waiting.
	second := runStart(t, bin, project, env)
	if !strings.Contains(second, "Update available: v1.0.0 → v9.9.9") {
		t.Errorf("second run did not report the update:\n%s", second)
	}
	if !strings.Contains(second, "https://example.test/v9") {
		t.Errorf("the notice should link to the release:\n%s", second)
	}
	if strings.Contains(second, "will check github.com") {
		t.Errorf("the disclosure should not repeat:\n%s", second)
	}
	if hits.Load() == 0 {
		t.Error("no request was ever made")
	}
}

func TestStartMakesNoRequestWhenDisabled(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	bin := buildBinary(t)
	endpoint := "DIALOGMAPPER_UPDATE_ENDPOINT=" + srv.URL

	t.Run("flag", func(t *testing.T) {
		hits.Store(0)
		out := runStart(t, bin, newProject(t, bin), []string{endpoint}, "--no-update-check")
		if hits.Load() != 0 {
			t.Errorf("--no-update-check still made %d request(s)", hits.Load())
		}
		if strings.Contains(out, "github.com") {
			t.Errorf("nothing about the check should be printed:\n%s", out)
		}
	})

	t.Run("environment", func(t *testing.T) {
		hits.Store(0)
		out := runStart(t, bin, newProject(t, bin),
			[]string{endpoint, "DIALOGMAPPER_NO_UPDATE_CHECK=1"})
		if hits.Load() != 0 {
			t.Errorf("the environment variable still made %d request(s)", hits.Load())
		}
		if strings.Contains(out, "github.com") {
			t.Errorf("nothing about the check should be printed:\n%s", out)
		}
	})
}

// TestOtherCommandsNeverReachTheNetwork is the guarantee that matters for
// scripts, CI and agent pipelines: only `start` checks.
func TestOtherCommandsNeverReachTheNetwork(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	bin := buildBinary(t)
	project := newProject(t, bin)
	doc := filepath.Join(project, "notes.md")
	if err := os.WriteFile(doc, []byte("# A question\n\n- An idea\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, args := range [][]string{
		{"seed", "--context", doc, "--map", "M"},
		{"export", "--format", "markdown"},
		{"grammar", "--json"},
		{"--version"},
	} {
		cmd := exec.Command(bin, append([]string{"-C", project}, args...)...)
		cmd.Env = append(os.Environ(), "DIALOGMAPPER_UPDATE_ENDPOINT="+srv.URL)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %v\n%s", args, err, out)
		}
	}
	time.Sleep(300 * time.Millisecond)
	if hits.Load() != 0 {
		t.Errorf("commands other than `start` made %d request(s) — scripts and CI must stay silent", hits.Load())
	}
}
