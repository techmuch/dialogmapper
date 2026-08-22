package store

import (
	"strings"
	"unicode"
)

// Turning what somebody typed into search terms.
//
// Whitespace separates terms and every term has to match, so "cache
// invalidation" finds nodes mentioning both rather than only nodes containing
// that exact string. Typing more words narrows the result, which is what a
// search box is expected to do and what a plain substring match got backwards:
// adding a word usually emptied the result.
//
// Double quotes keep a phrase together, because splitting on spaces otherwise
// removes the ability to search for one at all.
//
// The same rule lives in web/src/search.ts for the canvas filter, which runs
// against nodes already in the browser and so cannot ask the server. Both are
// covered by the same test table.

// MaxSearchTerms caps how many words are honoured. Each term becomes its own
// SQL condition, and a pasted paragraph would otherwise build a query with
// hundreds of LIKEs.
const MaxSearchTerms = 12

// ParseSearchTerms splits a query into lowercase terms.
func ParseSearchTerms(query string) []string {
	var terms []string
	var current strings.Builder
	quoted := false

	push := func() {
		t := strings.ToLower(strings.TrimSpace(current.String()))
		current.Reset()
		if t == "" {
			return
		}
		// Duplicates would each add a condition the first already guarantees.
		for _, seen := range terms {
			if seen == t {
				return
			}
		}
		terms = append(terms, t)
	}

	for _, ch := range query {
		switch {
		case ch == '"':
			// Closing a quote ends the term, so `"a b"c` cannot glue on a
			// suffix.
			if quoted {
				push()
			}
			quoted = !quoted
		case !quoted && unicode.IsSpace(ch):
			push()
		default:
			current.WriteRune(ch)
		}
	}
	push()

	if len(terms) > MaxSearchTerms {
		terms = terms[:MaxSearchTerms]
	}
	return terms
}
