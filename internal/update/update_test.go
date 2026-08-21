package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The update check is the only thing in dialogmapper that reaches the internet
// by itself, so what it does *not* do matters as much as what it does.

func TestNewer(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
		why             string
	}{
		{"v0.1.0", "v0.1.1", true, "patch bump"},
		{"v0.1.0", "v0.2.0", true, "minor bump"},
		{"v0.9.9", "v1.0.0", true, "major bump"},
		{"v0.1.0", "v0.1.0", false, "same version"},
		{"v0.2.0", "v0.1.9", false, "running ahead of the release"},
		{"0.1.0", "v0.1.1", true, "a missing v is tolerated"},
		// 10 > 9 numerically but "10" < "9" as a string, which is the classic
		// way a naive comparison goes wrong.
		{"v0.9.0", "v0.10.0", true, "double-digit minor"},
		{"v0.1.9", "v0.1.10", true, "double-digit patch"},
		{"v1.0.0-rc.1", "v1.0.0", false, "a suffix does not make it newer"},
		{"v1.0.0", "v1.0.1-rc.1", true, "a pre-release of a later patch still counts"},
	}
	for _, c := range cases {
		if got := Newer(c.current, c.latest); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v (%s)", c.current, c.latest, got, c.want, c.why)
		}
	}
}

func TestNewerStaysSilentOnUnreadableVersions(t *testing.T) {
	// A binary built without ldflags, installed as a pseudo-version, or built
	// from a branch must never be told it is out of date: it may well be ahead
	// of the newest release.
	for _, current := range []string{"", "dev", "(devel)", "v0.0.0-20260101120000-abcdef123456", "unknown"} {
		if Newer(current, "v9.9.9") {
			t.Errorf("a %q build should not be told it is out of date", current)
		}
	}
	for _, latest := range []string{"", "latest", "nightly"} {
		if Newer("v0.1.0", latest) {
			t.Errorf("an unreadable release tag %q should be ignored", latest)
		}
	}
}

func TestLatestReadsTheTag(t *testing.T) {
	var gotUA, gotAccept string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotAccept = r.Header.Get("Accept")
		w.Write([]byte(`{"tag_name":"v1.2.3","html_url":"https://example.test/r/v1.2.3","assets":[]}`))
	}))
	defer srv.Close()

	rel, err := Latest(context.Background(), srv.URL, "v0.1.0")
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if rel.TagName != "v1.2.3" {
		t.Errorf("tag = %q", rel.TagName)
	}
	if rel.HTMLURL != "https://example.test/r/v1.2.3" {
		t.Errorf("url = %q", rel.HTMLURL)
	}
	// GitHub rejects requests with no User-Agent, and the header should name
	// this tool rather than impersonating something else.
	if !strings.HasPrefix(gotUA, "dialogmapper/") {
		t.Errorf("User-Agent = %q, want it to identify dialogmapper", gotUA)
	}
	if gotAccept == "" {
		t.Error("no Accept header sent")
	}
}

// TestLatestSendsNothingAboutTheUser is the privacy guarantee stated in the
// package comment, pinned so it cannot quietly stop being true.
func TestLatestSendsNothingAboutTheUser(t *testing.T) {
	var method, query, body string
	var cookies int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		query = r.URL.RawQuery
		cookies = len(r.Cookies())
		buf := make([]byte, 1024)
		n, _ := r.Body.Read(buf)
		body = string(buf[:n])
		w.Write([]byte(`{"tag_name":"v1.0.0"}`))
	}))
	defer srv.Close()

	if _, err := Latest(context.Background(), srv.URL, "v0.1.0"); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet {
		t.Errorf("method = %s, want GET", method)
	}
	if query != "" {
		t.Errorf("query string carried data: %q", query)
	}
	if body != "" {
		t.Errorf("request had a body: %q", body)
	}
	if cookies != 0 {
		t.Errorf("request carried %d cookies", cookies)
	}
}

func TestLatestFailsQuietlyOnABadResponse(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"rate limited", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "rate limit exceeded", http.StatusForbidden)
		}},
		{"not json", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("<html>nope</html>"))
		}},
		{"no tag", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{}`))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			if _, err := Latest(context.Background(), srv.URL, "v0.1.0"); err == nil {
				t.Error("expected an error, which the caller then swallows")
			}
		})
	}
}

func TestLatestRespectsTheContext(t *testing.T) {
	// Nothing waits on this request, but a hung one would hold a goroutine and
	// a socket for the life of the server.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	start := time.Now()
	if _, err := Latest(ctx, srv.URL, "v0.1.0"); err == nil {
		t.Fatal("expected the timeout to fire")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("took %v; the context should have cut it short", elapsed)
	}
}

func TestNotice(t *testing.T) {
	n := Notice("v0.1.0", "v0.2.0", "https://example.test/rel")
	for _, want := range []string{"v0.1.0", "v0.2.0", "https://example.test/rel"} {
		if !strings.Contains(n, want) {
			t.Errorf("notice %q should mention %q", n, want)
		}
	}
	if Notice("v0.2.0", "v0.2.0", "") != "" {
		t.Error("an up-to-date binary should print nothing at all")
	}
	if Notice("dev", "v9.9.9", "") != "" {
		t.Error("a development build should print nothing at all")
	}
}
