// Package update checks whether a newer dialogmapper has been released.
//
// This is the only part of dialogmapper that reaches the internet on its own,
// which is why it is deliberately small and deliberately loud about itself:
//
//   - It runs on `start` and nowhere else, so `seed`, `export` and `grammar`
//     stay silent in scripts, CI and agent pipelines.
//   - It sends nothing about the user or their maps. A GET to a public GitHub
//     endpoint carries the current version in the User-Agent so the request is
//     honest about what is asking, and nothing else.
//   - It can never delay or break startup: the cached answer is read
//     synchronously and the refresh happens in the background, so an offline or
//     slow network costs exactly nothing.
//   - It is disclosed on first run and can be turned off permanently.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Endpoint is the public releases API for the project.
const Endpoint = "https://api.github.com/repos/techmuch/dialogmapper/releases/latest"

// MinInterval is how long a cached answer is trusted.
//
// GitHub allows 60 unauthenticated requests an hour *per IP*, which a team
// behind one office NAT could exhaust between them. Once a day is plenty for
// something released occasionally.
const MinInterval = 24 * time.Hour

// Timeout bounds the background fetch. Nothing waits on it, but a request left
// hanging would keep a goroutine and a socket alive for the life of the server.
const Timeout = 5 * time.Second

// Release is the fragment of GitHub's response that matters.
type Release struct {
	TagName string  `json:"tag_name"`
	HTMLURL string  `json:"html_url"`
	Assets  []Asset `json:"assets"`
}

// Latest fetches the most recent published release.
func Latest(ctx context.Context, endpoint, current string) (Release, error) {
	var out Release
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return out, err
	}
	// GitHub rejects requests without a User-Agent, and naming ourselves is
	// more honest than borrowing a browser's.
	req.Header.Set("User-Agent", "dialogmapper/"+strings.TrimPrefix(current, "v"))
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("releases API returned %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	if out.TagName == "" {
		return out, fmt.Errorf("release carried no tag")
	}
	return out, nil
}

// Newer reports whether `latest` is a later release than `current`.
//
// Returns false whenever either version cannot be read as a release tag. That
// covers `go build` without ldflags, `go install` of a pseudo-version, and
// anything hand-built — telling someone their development binary is "out of
// date" against a release they may be ahead of would be worse than silence.
func Newer(current, latest string) bool {
	c, okC := parse(current)
	l, okL := parse(latest)
	if !okC || !okL {
		return false
	}
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

// parse reads vMAJOR.MINOR.PATCH, tolerating a missing "v" and ignoring any
// pre-release or build suffix.
func parse(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	if v == "" {
		return out, false
	}
	// Drop "-rc.1" or "+build" so a tagged pre-release still compares by number.
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		// Except a Go pseudo-version, which `go install` produces for a commit
		// with no matching tag: v0.0.0-20260101120000-abcdef123456. Stripping
		// the suffix leaves 0.0.0, which would read as "hopelessly out of
		// date" for a binary that is in fact ahead of every release.
		if isPseudoVersion(v[i+1:]) {
			return out, false
		}
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// isPseudoVersion spots the 14-digit UTC timestamp Go embeds in the versions
// it synthesises for untagged commits.
func isPseudoVersion(suffix string) bool {
	for _, part := range strings.Split(suffix, "-") {
		if len(part) != 14 {
			continue
		}
		if _, err := strconv.Atoi(part); err == nil {
			return true
		}
	}
	return false
}

// Notice is the one line printed under the start banner, or "" when the
// running version is current or unknown.
func Notice(current, latest, url string) string {
	if !Newer(current, latest) {
		return ""
	}
	if url == "" {
		url = "https://github.com/techmuch/dialogmapper/releases/latest"
	}
	return fmt.Sprintf("  Update available: %s → %s  %s", current, latest, url)
}
