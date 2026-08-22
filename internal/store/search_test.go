package store

import (
	"strings"
	"testing"
)

// The same table exists in web/src/search.test.ts.
//
// The rule has to be implemented twice — the canvas filter runs against nodes
// already in the browser and cannot ask the server — so the cases are kept
// identical on purpose. If you change one, change the other.

func TestParseSearchTerms(t *testing.T) {
	cases := []struct {
		query string
		want  []string
		why   string
	}{
		{"", nil, "nothing typed"},
		{"   ", nil, "only whitespace"},
		{"cache", []string{"cache"}, "one word"},
		{"cache invalidation", []string{"cache", "invalidation"}, "spaces separate terms"},
		{"  spaced   out  ", []string{"spaced", "out"}, "runs of whitespace"},
		{"CaChe", []string{"cache"}, "matching is case-insensitive"},
		{"cache cache", []string{"cache"}, "a repeat adds no constraint"},
		{"cache\tinvalidation\nrollback", []string{"cache", "invalidation", "rollback"}, "tabs and newlines separate too"},
		{`"hot tables"`, []string{"hot tables"}, "quotes keep a phrase together"},
		{`perf "hot tables"`, []string{"perf", "hot tables"}, "a phrase alongside a word"},
		{`"unclosed`, []string{"unclosed"}, "an unclosed quote is not an error"},
		{`""`, nil, "an empty phrase is nothing"},
		{`a "b c"d`, []string{"a", "b c", "d"}, "a closing quote ends the term"},
	}
	for _, c := range cases {
		got := ParseSearchTerms(c.query)
		if strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("ParseSearchTerms(%q) = %q, want %q (%s)", c.query, got, c.want, c.why)
		}
	}
}

func TestParseSearchTermsCapsTheCount(t *testing.T) {
	// Each term becomes its own SQL condition; a pasted paragraph would build a
	// query with hundreds of LIKEs.
	var b strings.Builder
	for i := 0; i < 40; i++ {
		b.WriteString("w")
		b.WriteByte(byte('a' + i%26))
		b.WriteString(" ")
	}
	if got := ParseSearchTerms(b.String()); len(got) > MaxSearchTerms {
		t.Errorf("got %d terms, want at most %d", len(got), MaxSearchTerms)
	}
}

// TestSearchNarrowsWithEachTerm is the behaviour people expect from a search
// box and the thing the old substring match got backwards: typing a second
// word usually emptied the result, because the two words were only ever
// adjacent by accident.
func TestSearchNarrowsWithEachTerm(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")

	mk := func(title, body string, tags ...string) {
		t.Helper()
		content := NodeContent{Markdown: body, Tags: tags, Status: StatusOpen}
		if _, _, err := s.CreateNode(NewNodeInput{
			Type: "idea", Title: title, MapID: m.ID, Content: &content,
		}); err != nil {
			t.Fatal(err)
		}
	}
	mk("Add a read-through cache", "Cuts p99 latency", "perf")
	mk("Cache invalidation is hard", "The two hard problems")
	mk("Denormalise the hot tables", "No new infrastructure", "perf")

	titles := func(q string) []string {
		t.Helper()
		found, err := s.SearchNodes(q, "", 50)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]string, 0, len(found))
		for _, n := range found {
			out = append(out, n.Title)
		}
		return out
	}

	if got := titles("cache"); len(got) != 2 {
		t.Errorf("one word found %d, want 2: %q", len(got), got)
	}
	// Both words, in either order, in title or body.
	if got := titles("cache invalidation"); len(got) != 1 || got[0] != "Cache invalidation is hard" {
		t.Errorf("two words = %q, want just the invalidation node", got)
	}
	if got := titles("invalidation cache"); len(got) != 1 {
		t.Errorf("order should not matter, got %q", got)
	}
	// A term may land in the body rather than the title.
	if got := titles("cache latency"); len(got) != 1 || got[0] != "Add a read-through cache" {
		t.Errorf("title plus body = %q", got)
	}
	// Or in a tag, which lives in the content JSON.
	if got := titles("perf tables"); len(got) != 1 || got[0] != "Denormalise the hot tables" {
		t.Errorf("tag plus title = %q", got)
	}
	// A word that appears nowhere excludes everything, rather than being
	// ignored.
	if got := titles("cache unicorn"); len(got) != 0 {
		t.Errorf("an unmatched term should exclude, got %q", got)
	}
}

func TestSearchPhrasesStayTogether(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")
	mk := func(title string) {
		t.Helper()
		if _, _, err := s.CreateNode(NewNodeInput{Type: "idea", Title: title, MapID: m.ID}); err != nil {
			t.Fatal(err)
		}
	}
	mk("Denormalise the hot tables")
	mk("Tables are hot in summer")

	found, err := s.SearchNodes(`"hot tables"`, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	// Splitting on spaces would otherwise remove any way to search a phrase.
	if len(found) != 1 || found[0].Title != "Denormalise the hot tables" {
		t.Errorf("quoted phrase matched %d nodes: %+v", len(found), found)
	}
}

func TestEmptySearchStillMatchesEverything(t *testing.T) {
	// The palette opens with an empty box and lists what is there.
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")
	if _, _, err := s.CreateNode(NewNodeInput{Type: "idea", Title: "Anything", MapID: m.ID}); err != nil {
		t.Fatal(err)
	}
	found, err := s.SearchNodes("   ", "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 {
		t.Errorf("empty query found %d, want everything", len(found))
	}
}
