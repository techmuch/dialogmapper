package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Replacing the running binary with a newer one.
//
// A program that downloads code from the internet and then executes it is
// exactly the shape of thing that deserves suspicion, so this is deliberately
// narrow:
//
//   - one host, over HTTPS, with the URL taken from GitHub's release API
//     rather than constructed from anything a user typed;
//   - the download is checked against the SHA256SUMS published with the
//     release, and a mismatch aborts without touching the existing binary;
//   - the replacement is a rename within the same directory, so an interrupted
//     upgrade leaves either the old binary or the new one, never half of
//     either;
//   - nothing is ever executed by this process.

// MaxDownload bounds what will be read from the network. The binary is around
// 12 MB; this is generous enough for growth and small enough that a redirect
// to something enormous cannot fill a disk.
const MaxDownload = 200 << 20

// Asset is one file attached to a release.
type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

// AssetName is what `make release` calls the binary for a platform.
func AssetName(goos, goarch string) string {
	name := fmt.Sprintf("dialogmapper-%s-%s", goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

// ErrNoAsset means the release has no build for this platform.
var ErrNoAsset = errors.New("no build for this platform in that release")

// FindAsset picks the binary and the checksum file for this platform.
func FindAsset(rel Release, goos, goarch string) (binary Asset, sums Asset, err error) {
	want := AssetName(goos, goarch)
	for _, a := range rel.Assets {
		switch a.Name {
		case want:
			binary = a
		case "SHA256SUMS":
			sums = a
		}
	}
	if binary.URL == "" {
		return Asset{}, Asset{}, fmt.Errorf("%w: looked for %s", ErrNoAsset, want)
	}
	return binary, sums, nil
}

// InstallPlan is what an upgrade would do, worked out before anything is
// downloaded so the command can explain itself and stop.
type InstallPlan struct {
	Current string
	Latest  string
	Path    string
	Asset   Asset
	Sums    Asset
	// Blocked explains why this install cannot proceed — a package-managed or
	// read-only location — and is empty when it can.
	Blocked string
}

// managedBy names the package manager owning a path, if any.
//
// Replacing a package-managed binary is worse than doing nothing: it works
// until the manager reinstalls its own copy, and then the upgrade silently
// disappears. Naming the right command is more useful than winning the fight.
func managedBy(path string) string {
	switch {
	case strings.Contains(path, "/Cellar/"), strings.Contains(path, "/homebrew/"),
		strings.Contains(path, "/linuxbrew/"):
		return "Homebrew — run: brew upgrade dialogmapper"
	case strings.HasPrefix(path, "/nix/store/"):
		return "Nix — update your flake or profile instead"
	case strings.HasPrefix(path, "/snap/"):
		return "snap — run: sudo snap refresh dialogmapper"
	case strings.Contains(path, "/pkg/mod/"):
		return "the Go module cache — run: go install github.com/techmuch/dialogmapper@latest"
	}
	return ""
}

// writable reports whether a new file can be placed beside the target, which
// is what the replacement actually needs — not permission on the file itself.
func writable(path string) error {
	dir := filepath.Dir(path)
	probe, err := os.CreateTemp(dir, ".dialogmapper-upgrade-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	probe.Close()
	return os.Remove(name)
}

// Plan works out whether and how this binary can be replaced.
func Plan(rel Release, current, exePath string) InstallPlan {
	p := InstallPlan{Current: current, Latest: rel.TagName, Path: exePath}

	if who := managedBy(exePath); who != "" {
		p.Blocked = fmt.Sprintf("%s is managed by %s", exePath, who)
		return p
	}

	binary, sums, err := FindAsset(rel, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		p.Blocked = err.Error()
		return p
	}
	p.Asset, p.Sums = binary, sums

	if err := writable(exePath); err != nil {
		p.Blocked = fmt.Sprintf(
			"cannot write to %s (%v) — re-run with permission to write there, "+
				"or install to a directory you own", filepath.Dir(exePath), err)
	}
	return p
}

// Download fetches an asset into a temporary file *next to* the target, so the
// final move is a rename within one filesystem and therefore atomic. Returns
// the temp path and the SHA-256 of what was written.
func Download(ctx context.Context, a Asset, nextTo string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "dialogmapper-upgrade")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("downloading %s: %s", a.Name, resp.Status)
	}

	tmp, err := os.CreateTemp(filepath.Dir(nextTo), ".dialogmapper-new-*")
	if err != nil {
		return "", "", err
	}
	sum := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, sum), io.LimitReader(resp.Body, MaxDownload))
	closeErr := tmp.Close()
	if err != nil {
		os.Remove(tmp.Name())
		return "", "", err
	}
	if closeErr != nil {
		os.Remove(tmp.Name())
		return "", "", closeErr
	}
	if a.Size > 0 && n != a.Size {
		os.Remove(tmp.Name())
		return "", "", fmt.Errorf("downloaded %d bytes, expected %d", n, a.Size)
	}
	return tmp.Name(), hex.EncodeToString(sum.Sum(nil)), nil
}

// FetchSums reads the SHA256SUMS file published with a release.
func FetchSums(ctx context.Context, a Asset) (map[string]string, error) {
	if a.URL == "" {
		return nil, errors.New("this release publishes no SHA256SUMS")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "dialogmapper-upgrade")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching checksums: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return ParseSums(string(body)), nil
}

// ParseSums reads the `sha256sum` output format: hash, spaces, filename.
func ParseSums(body string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(body, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) != 2 {
			continue
		}
		// The first field has to actually be a SHA-256. Without this check any
		// two-word line — a comment, a note, a truncated file — became an
		// "expected hash" that nothing could ever match, turning a malformed
		// checksum file into a confusing mismatch instead of a clear refusal.
		if !isSHA256(fields[0]) {
			continue
		}
		// sha256sum writes "*name" for binary mode; the star is not the name.
		out[strings.TrimPrefix(fields[1], "*")] = strings.ToLower(fields[0])
	}
	return out
}

// isSHA256 reports whether a field is 64 hexadecimal digits.
func isSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

// Replace swaps the new binary in.
//
// The old one is kept as `<name>.old` rather than deleted: on Windows a running
// executable cannot be replaced but *can* be renamed out of the way, and
// keeping it everywhere means one code path and a way back if the new binary
// will not start.
func Replace(newPath, exePath string) error {
	if err := os.Chmod(newPath, 0o755); err != nil {
		return err
	}
	old := exePath + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exePath, old); err != nil {
		return fmt.Errorf("moving the current binary aside: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		// Put it back rather than leaving the user with no binary at all.
		_ = os.Rename(old, exePath)
		return fmt.Errorf("installing the new binary: %w", err)
	}
	// On Unix the old file can go immediately; on Windows it is still mapped
	// by this process, so it is left for the next run to clean up.
	if runtime.GOOS != "windows" {
		_ = os.Remove(old)
	}
	return nil
}
