package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeMeta stands in for the store's key/value table.
type fakeMeta map[string]string

func (f fakeMeta) Meta(k string) string      { return f[k] }
func (f fakeMeta) SetMeta(k, v string) error { f[k] = v; return nil }

func TestDisabledByFlag(t *testing.T) {
	if !Disabled(fakeMeta{}, true) {
		t.Error("--no-update-check should switch it off")
	}
	if Disabled(fakeMeta{}, false) {
		t.Error("it should be on by default")
	}
}

func TestDisabledByEnvironment(t *testing.T) {
	for _, v := range []string{"1", "true", "yes"} {
		t.Setenv(EnvDisable, v)
		if !Disabled(fakeMeta{}, false) {
			t.Errorf("%s=%s should switch it off", EnvDisable, v)
		}
	}
	// An explicitly falsy value is not an opt-out, so `FOO=0` in a shell
	// profile does not silently mean the opposite of what it says.
	for _, v := range []string{"", "0", "false"} {
		t.Setenv(EnvDisable, v)
		if Disabled(fakeMeta{}, false) {
			t.Errorf("%s=%q should leave it on", EnvDisable, v)
		}
	}
}

func TestDisabledPerProject(t *testing.T) {
	if !Disabled(fakeMeta{KeyDisabled: "1"}, false) {
		t.Error("a project that opted out should stay opted out")
	}
}

func TestDueRespectsTheInterval(t *testing.T) {
	now := time.Now()
	if !Due(fakeMeta{}, now) {
		t.Error("a project that has never checked is due")
	}
	recent := fakeMeta{KeyChecked: strconv.FormatInt(now.Add(-time.Hour).Unix(), 10)}
	if Due(recent, now) {
		t.Error("checked an hour ago should not be due; GitHub allows 60 requests an hour per IP")
	}
	old := fakeMeta{KeyChecked: strconv.FormatInt(now.Add(-48*time.Hour).Unix(), 10)}
	if !Due(old, now) {
		t.Error("checked two days ago should be due")
	}
	if !Due(fakeMeta{KeyChecked: "not a number"}, now) {
		t.Error("an unreadable timestamp should just mean check again")
	}
}

func TestRefreshStoresTheResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"tag_name":"v2.0.0","html_url":"https://example.test/v2"}`))
	}))
	defer srv.Close()

	m := fakeMeta{}
	Refresh(context.Background(), m, srv.URL, "v1.0.0")

	tag, url := Cached(m)
	if tag != "v2.0.0" || url != "https://example.test/v2" {
		t.Errorf("cached %q / %q", tag, url)
	}
	if m[KeyChecked] == "" {
		t.Error("the check time was not recorded, so it would refetch every run")
	}
}

func TestRefreshLeavesTheCacheAloneOnFailure(t *testing.T) {
	// Being offline or rate limited must not erase a good answer, or the
	// notice would flicker away the moment the network hiccupped.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusForbidden)
	}))
	defer srv.Close()

	m := fakeMeta{KeyLatest: "v2.0.0", KeyURL: "https://example.test/v2"}
	Refresh(context.Background(), m, srv.URL, "v1.0.0")

	if tag, _ := Cached(m); tag != "v2.0.0" {
		t.Errorf("a failed refresh clobbered the cache: %q", tag)
	}
}

func TestCachedNeedsNoNetwork(t *testing.T) {
	// The whole point: reading the cache is a map lookup, so a slow or absent
	// network can never be felt at startup.
	m := fakeMeta{KeyLatest: "v3.0.0"}
	if tag, _ := Cached(m); tag != "v3.0.0" {
		t.Errorf("tag = %q", tag)
	}
}

func TestDisclosureShownOnceAndBeforeAnyRequest(t *testing.T) {
	m := fakeMeta{}
	first := Disclosure(m)
	if first == "" {
		t.Fatal("the first run should say that it will contact github")
	}
	for _, want := range []string{"github.com", "--no-update-check", EnvDisable} {
		if !strings.Contains(first, want) {
			t.Errorf("the disclosure should mention %q:\n%s", want, first)
		}
	}
	if Disclosure(m) != "" {
		t.Error("the disclosure should not repeat on every run")
	}
}
