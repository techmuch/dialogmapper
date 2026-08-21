package update

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"
)

// Keys used in the project's key/value metadata table.
const (
	KeyLatest    = "update_latest"     // newest tag seen
	KeyURL       = "update_url"        // its release page
	KeyChecked   = "update_checked_at" // unix seconds of the last successful fetch
	KeyDisclosed = "update_disclosed"  // "1" once the first-run notice has been shown
	KeyDisabled  = "update_disabled"   // "1" to stop checking for this project
)

// EnvDisable turns the check off without touching any project.
const EnvDisable = "DIALOGMAPPER_NO_UPDATE_CHECK"

// EnvEndpoint points the check somewhere other than GitHub — an internal
// mirror, or a fake server in a test. Without it there would be no way to
// exercise the wiring without reaching the real internet.
const EnvEndpoint = "DIALOGMAPPER_UPDATE_ENDPOINT"

// EndpointFromEnv returns the override if set, otherwise the public API.
func EndpointFromEnv() string {
	if v := strings.TrimSpace(os.Getenv(EnvEndpoint)); v != "" {
		return v
	}
	return Endpoint
}

// Meta is the slice of the store this package needs, which keeps the store
// free of any knowledge about update checking.
type Meta interface {
	Meta(key string) string
	SetMeta(key, value string) error
}

// Disabled reports whether checking is switched off, by flag, environment or
// project setting.
func Disabled(m Meta, flag bool) bool {
	if flag {
		return true
	}
	if v := strings.TrimSpace(os.Getenv(EnvDisable)); v != "" && v != "0" && v != "false" {
		return true
	}
	return m.Meta(KeyDisabled) == "1"
}

// Cached returns the last release seen, without any network access.
//
// Reading the cache rather than fetching is what makes this free: the notice
// costs one SQLite read, so a slow or absent network can never be felt. The
// consequence is that a brand new release is reported from the *next* run
// onward, which for something released occasionally is a fair trade.
func Cached(m Meta) (tag, url string) {
	return m.Meta(KeyLatest), m.Meta(KeyURL)
}

// Due reports whether the cached answer is old enough to refresh.
func Due(m Meta, now time.Time) bool {
	raw := m.Meta(KeyChecked)
	if raw == "" {
		return true
	}
	secs, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return true
	}
	return now.Sub(time.Unix(secs, 0)) >= MinInterval
}

// Refresh fetches the latest release and stores it.
//
// Every failure is swallowed on purpose. Being offline, behind a proxy, or
// rate limited is not something to interrupt someone's meeting about, and this
// runs in the background where there is nobody to tell anyway.
func Refresh(ctx context.Context, m Meta, endpoint, current string) {
	rel, err := Latest(ctx, endpoint, current)
	if err != nil {
		return
	}
	_ = m.SetMeta(KeyLatest, rel.TagName)
	_ = m.SetMeta(KeyURL, rel.HTMLURL)
	_ = m.SetMeta(KeyChecked, strconv.FormatInt(time.Now().Unix(), 10))
}

// Disclosure is the one-time line explaining that this binary will contact
// GitHub, or "" once it has been shown.
//
// Shown before any request is made, so the first thing a user learns about the
// network access is not that it already happened.
func Disclosure(m Meta) string {
	if m.Meta(KeyDisclosed) == "1" {
		return ""
	}
	_ = m.SetMeta(KeyDisclosed, "1")
	return "  dialogmapper will check github.com once a day for a newer release.\n" +
		"  Nothing about you or your maps is sent. Turn it off with --no-update-check\n" +
		"  or " + EnvDisable + "=1."
}
