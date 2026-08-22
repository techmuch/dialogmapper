package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Replacing the running binary is the most dangerous thing dialogmapper does,
// so these are mostly about refusing: a download that cannot be verified, a
// path that belongs to a package manager, a directory that cannot be written.

func TestAssetNames(t *testing.T) {
	if got := AssetName("linux", "amd64"); got != "dialogmapper-linux-amd64" {
		t.Errorf("linux/amd64 = %q", got)
	}
	// Must match what `make release` writes, or upgrade looks for a file that
	// was never published.
	if got := AssetName("windows", "amd64"); got != "dialogmapper-windows-amd64.exe" {
		t.Errorf("windows = %q, want the .exe suffix", got)
	}
}

func TestFindAsset(t *testing.T) {
	rel := Release{Assets: []Asset{
		{Name: "dialogmapper-linux-amd64", URL: "https://example.test/l"},
		{Name: "dialogmapper-darwin-arm64", URL: "https://example.test/d"},
		{Name: "SHA256SUMS", URL: "https://example.test/s"},
	}}
	bin, sums, err := FindAsset(rel, "darwin", "arm64")
	if err != nil || bin.URL != "https://example.test/d" || sums.URL != "https://example.test/s" {
		t.Fatalf("bin=%+v sums=%+v err=%v", bin, sums, err)
	}
	// A release with no build for this platform must say so rather than
	// installing something for another architecture.
	if _, _, err := FindAsset(rel, "freebsd", "riscv64"); err == nil {
		t.Error("expected a refusal for an unbuilt platform")
	}
}

func TestParseSums(t *testing.T) {
	const (
		lin = "2f04001584aec053b198d5122bf95998f8e7711ca35298cbb43082631a2102f4"
		win = "C73125D43DF34E0342795FB25F527CC30D60BC75C2C7D7D829815A5F7767C234"
	)
	got := ParseSums(`
` + lin + `  dialogmapper-linux-amd64
` + win + ` *dialogmapper-windows-amd64.exe

garbage line
not-a-hash  dialogmapper-darwin-arm64
`)
	if got["dialogmapper-linux-amd64"] != lin {
		t.Errorf("linux = %q", got["dialogmapper-linux-amd64"])
	}
	// sha256sum writes "*name" in binary mode; the star is not part of the
	// name, and hashes compare lowercase.
	if got["dialogmapper-windows-amd64.exe"] != strings.ToLower(win) {
		t.Errorf("windows = %q", got["dialogmapper-windows-amd64.exe"])
	}
	// A two-word line whose first field is not a hash is not a checksum. Left
	// unchecked it becomes an "expected hash" nothing can match, turning a
	// malformed file into a mismatch rather than a clear refusal.
	if _, ok := got["dialogmapper-darwin-arm64"]; ok {
		t.Error("a line with a non-hash first field was accepted as a checksum")
	}
	if len(got) != 2 {
		t.Errorf("parsed %d entries from a file with two valid lines: %+v", len(got), got)
	}
}

func TestPlanRefusesPackageManagedPaths(t *testing.T) {
	// Replacing a package-managed binary works right up until the manager puts
	// its own copy back, and then the upgrade silently disappears.
	rel := Release{TagName: "v2.0.0", Assets: []Asset{
		{Name: AssetName(runtime.GOOS, runtime.GOARCH), URL: "https://example.test/b"},
		{Name: "SHA256SUMS", URL: "https://example.test/s"},
	}}
	for path, expect := range map[string]string{
		"/opt/homebrew/bin/dialogmapper":                      "brew upgrade",
		"/usr/local/Cellar/dialogmapper/1.0/bin/dialogmapper": "brew upgrade",
		"/nix/store/abc-dialogmapper/bin/dialogmapper":        "Nix",
		"/snap/dialogmapper/current/dialogmapper":             "snap refresh",
	} {
		p := Plan(rel, "v1.0.0", path)
		if p.Blocked == "" {
			t.Errorf("%s should be refused", path)
			continue
		}
		if !strings.Contains(p.Blocked, expect) {
			t.Errorf("%s: refusal should name the right command, got %q", path, p.Blocked)
		}
	}
}

func TestPlanRefusesAnUnwritableDirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root; every directory is writable")
	}
	rel := Release{TagName: "v2.0.0", Assets: []Asset{
		{Name: AssetName(runtime.GOOS, runtime.GOARCH), URL: "https://example.test/b"},
	}}
	dir := t.TempDir()
	target := filepath.Join(dir, "dialogmapper")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	p := Plan(rel, "v1.0.0", target)
	if p.Blocked == "" {
		t.Fatal("an unwritable directory should be refused before anything is downloaded")
	}
	if !strings.Contains(p.Blocked, "cannot write") {
		t.Errorf("refusal = %q", p.Blocked)
	}
}

func TestPlanAllowsAnOrdinaryPath(t *testing.T) {
	rel := Release{TagName: "v2.0.0", Assets: []Asset{
		{Name: AssetName(runtime.GOOS, runtime.GOARCH), URL: "https://example.test/b"},
		{Name: "SHA256SUMS", URL: "https://example.test/s"},
	}}
	target := filepath.Join(t.TempDir(), "dialogmapper")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if p := Plan(rel, "v1.0.0", target); p.Blocked != "" && strings.Contains(p.Blocked, "cannot write") {
		t.Errorf("a writable directory should be allowed: %q", p.Blocked)
	}
}

func TestDownloadReportsWhatItGot(t *testing.T) {
	payload := []byte("a pretend binary")
	sum := sha256.Sum256(payload)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()

	target := filepath.Join(t.TempDir(), "dialogmapper")
	tmp, got, err := Download(context.Background(),
		Asset{Name: "x", URL: srv.URL, Size: int64(len(payload))}, target)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmp)

	if got != hex.EncodeToString(sum[:]) {
		t.Errorf("hash = %s", got)
	}
	// Downloaded beside the target so the install is a rename within one
	// filesystem, and therefore atomic.
	if filepath.Dir(tmp) != filepath.Dir(target) {
		t.Errorf("temp file %s is not beside %s", tmp, target)
	}
	body, _ := os.ReadFile(tmp)
	if string(body) != string(payload) {
		t.Errorf("contents = %q", body)
	}
}

func TestDownloadRejectsATruncatedTransfer(t *testing.T) {
	// The size is checked because a proxy that cuts a response short otherwise
	// produces a file that is simply wrong, with a hash that says so only if
	// checksums happen to be published.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("short"))
	}))
	defer srv.Close()

	target := filepath.Join(t.TempDir(), "dialogmapper")
	if _, _, err := Download(context.Background(),
		Asset{Name: "x", URL: srv.URL, Size: 999}, target); err == nil {
		t.Error("a short download should be refused")
	}
	// And nothing is left lying around.
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 0 {
		t.Errorf("temp files left behind: %d", len(entries))
	}
}

func TestFetchSumsRefusesAReleaseWithout(t *testing.T) {
	if _, err := FetchSums(context.Background(), Asset{}); err == nil {
		t.Error("a release with no SHA256SUMS should be refused, not trusted")
	}
}

func TestReplaceSwapsTheBinary(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "dialogmapper")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	incoming := filepath.Join(dir, ".dialogmapper-new")
	if err := os.WriteFile(incoming, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Replace(incoming, target); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(target)
	if err != nil || string(body) != "new" {
		t.Fatalf("target = %q (%v)", body, err)
	}
	// Executable, or the upgrade leaves a binary nobody can run.
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("mode = %v, want executable", info.Mode().Perm())
	}
}
