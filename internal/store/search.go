package store

import (
	"strings"
	"unicode"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

// Turning what somebody typed into a search.
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
// A leading ?, !, +, - or . narrows to one node type. Those are the characters
// already on the cards and on the capture keys, so the shortcut is the thing
// the user has been looking at all session rather than a new syntax.
//
// The same rule lives in web/src/search.ts for the canvas filter, which runs
// against nodes already in the browser and so cannot ask the server. Both are
// covered by the same test table.

// MaxSearchTerms caps how many words are honoured. Each term becomes its own
// SQL condition, and a pasted paragraph would otherwise build a query with
// hundreds of LIKEs.
const MaxSearchTerms = 12

// typePrefix maps the shortcut characters onto node types.
//
// The Unicode minus and middot are here alongside the ASCII ones because those
// are the glyphs the cards actually draw, and somebody who copies one out of
// the interface should not find that it does nothing.
//
// There is deliberately no marker for Map: "#" already means a tag everywhere
// else in the tool, and embedded maps are rare enough not to be worth the
// collision.
var typePrefix = map[rune]ibis.NodeType{
	'?': ibis.Question,
	'!': ibis.Idea,
	'+': ibis.Pro,
	'-': ibis.Con,
	'−': ibis.Con,
	'.': ibis.Note,
	'·': ibis.Note,
}

// ParsedQuery is a search query split into what it asks for.
type ParsedQuery struct {
	// Type is the node type asked for, or "" for any.
	Type ibis.NodeType
	// Terms are lowercased words, all of which must match.
	Terms []string
}

// ParseQuery reads a query into a type and a list of terms.
//
// The marker only counts as the first character of the whole query. Anywhere
// else it is ordinary text — "why not" and "cost - benefit" have to keep
// working, and a marker that could appear mid-string would make them
// unpredictable. Quoting escapes it, so `"?"` searches for a literal question
// mark.
func ParseQuery(query string) ParsedQuery {
	rest := query
	var nodeType ibis.NodeType

	lead := strings.TrimLeftFunc(query, unicode.IsSpace)
	for _, ch := range lead {
		if t, ok := typePrefix[ch]; ok {
			nodeType = t
			rest = lead[len(string(ch)):]
		}
		break // only the first character can be a marker
	}

	return ParsedQuery{Type: nodeType, Terms: ParseSearchTerms(rest)}
}

// ParseSearchTerms splits a query into deduplicated lowercase terms.
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
