// Package ibis encodes the grammar of Issue-Based Information System dialog
// maps: which node types exist, which relationships connect them, and which
// combinations are meaningful.
//
// The point of enforcing this is not pedantry. IBIS is useful precisely
// because the edges mean something specific — "this Pro supports that Idea"
// is a claim you can audit, whereas an untyped arrow is not. A map that
// permits arbitrary edges degrades into a mind map within about twenty nodes.
package ibis

import (
	"fmt"
	"sort"
	"strings"
)

// NodeType is the kind of move a node makes in the conversation.
type NodeType string

const (
	// Note is unstructured context: a fact, a quote, a screenshot. It has no
	// argumentative force and can attach to anything.
	Note NodeType = "note"
	// Question is an issue to be deliberated. The root of any IBIS subtree.
	Question NodeType = "question"
	// Idea is a candidate answer to a Question (classically "Position").
	Idea NodeType = "idea"
	// Pro is an argument in favour of an Idea.
	Pro NodeType = "pro"
	// Con is an argument against an Idea.
	Con NodeType = "con"
	// Map is a whole sub-map embedded as a single node, for decomposing a
	// wicked problem without one unreadable canvas.
	Map NodeType = "map"
)

// NodeTypes lists every valid node type in display order.
var NodeTypes = []NodeType{Question, Idea, Pro, Con, Note, Map}

// Relationship is the semantic label on an edge. Edges are directed and read
// source-first: "<source> <relationship> <target>".
type Relationship string

const (
	// RespondsTo answers an open issue. Idea -> Question.
	RespondsTo Relationship = "responds_to"
	// Questions challenges or opens an issue about something. Question -> *.
	Questions Relationship = "questions"
	// Supports argues in favour. Pro -> Idea (or a nested argument).
	Supports Relationship = "supports"
	// ObjectsTo argues against. Con -> Idea (or a nested argument).
	ObjectsTo Relationship = "objects_to"
	// RelatesTo is the deliberately weak link for context. Involves a Note.
	RelatesTo Relationship = "relates_to"
	// Specializes narrows a broad question into a more specific one.
	Specializes Relationship = "specializes"
)

// Relationships lists every valid relationship.
var Relationships = []Relationship{
	RespondsTo, Questions, Supports, ObjectsTo, RelatesTo, Specializes,
}

// rule declares one legal edge shape.
type rule struct {
	rel     Relationship
	sources []NodeType
	targets []NodeType
	// hierarchical edges form the argument tree and must stay acyclic.
	// relates_to is explicitly not hierarchical: cross-links are the whole
	// point of a "relates to" edge.
	hierarchical bool
	label        string
}

// anyType is the wildcard target set.
var anyType = []NodeType{Question, Idea, Pro, Con, Note, Map}

// rules is the complete grammar. Adding a row here is the only supported way
// to extend the schema; nothing else needs to change.
var rules = []rule{
	{
		rel:          RespondsTo,
		sources:      []NodeType{Idea, Map},
		targets:      []NodeType{Question},
		hierarchical: true,
		label:        "an Idea (or embedded Map) responds to a Question",
	},
	{
		rel:          Questions,
		sources:      []NodeType{Question},
		targets:      []NodeType{Question, Idea, Pro, Con, Note, Map},
		hierarchical: true,
		label:        "a Question can be raised about anything",
	},
	{
		rel:          Supports,
		sources:      []NodeType{Pro},
		targets:      []NodeType{Idea, Pro, Con, Map},
		hierarchical: true,
		label:        "a Pro supports an Idea, or reinforces another argument",
	},
	{
		rel:          ObjectsTo,
		sources:      []NodeType{Con},
		targets:      []NodeType{Idea, Pro, Con, Map},
		hierarchical: true,
		label:        "a Con objects to an Idea, or rebuts another argument",
	},
	{
		rel:          RelatesTo,
		sources:      []NodeType{Note},
		targets:      anyType,
		hierarchical: false,
		label:        "a Note relates to anything",
	},
	{
		rel:          RelatesTo,
		sources:      anyType,
		targets:      []NodeType{Note},
		hierarchical: false,
		label:        "anything relates to a Note",
	},
	{
		// Issue specialization, from Rittel's original IBIS: a narrower issue
		// standing under a broader one.
		//
		// Questions only. Allowing this between Ideas made "Idea specializes
		// Idea" legal, which IBIS does not have — an Idea answers a Question,
		// so two Ideas are alternatives to each other rather than one standing
		// under the other. Anything worth saying about the relationship
		// between two Ideas is really a Question about them, or a Pro or Con
		// on one of them.
		rel:          Specializes,
		sources:      []NodeType{Question},
		targets:      []NodeType{Question},
		hierarchical: true,
		label:        "a Question specializes a broader Question",
	},
}

// ValidationError describes exactly why an edge was rejected, including what
// the caller could have done instead. Surfaced verbatim to the UI and CLI.
type ValidationError struct {
	Source       NodeType
	Target       NodeType
	Relationship Relationship
	Reason       string
	Suggestions  []string
}

func (e *ValidationError) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "illegal IBIS edge: %s --%s--> %s: %s",
		e.Source, e.Relationship, e.Target, e.Reason)
	if len(e.Suggestions) > 0 {
		fmt.Fprintf(&b, " (try: %s)", strings.Join(e.Suggestions, "; "))
	}
	return b.String()
}

// IsValidNodeType reports whether t is a known node type.
func IsValidNodeType(t NodeType) bool {
	for _, k := range NodeTypes {
		if k == t {
			return true
		}
	}
	return false
}

// IsValidRelationship reports whether r is a known relationship.
func IsValidRelationship(r Relationship) bool {
	for _, k := range Relationships {
		if k == r {
			return true
		}
	}
	return false
}

// ValidateEdge checks a proposed edge against the IBIS grammar. It returns nil
// when the edge is legal, and a *ValidationError carrying an explanation and
// concrete alternatives when it is not.
func ValidateEdge(source, target NodeType, rel Relationship) error {
	if !IsValidNodeType(source) {
		return &ValidationError{source, target, rel,
			fmt.Sprintf("%q is not a node type", source), typeNames()}
	}
	if !IsValidNodeType(target) {
		return &ValidationError{source, target, rel,
			fmt.Sprintf("%q is not a node type", target), typeNames()}
	}
	if !IsValidRelationship(rel) {
		return &ValidationError{source, target, rel,
			fmt.Sprintf("%q is not a relationship", rel), relNames()}
	}

	for _, r := range rules {
		if r.rel == rel && contains(r.sources, source) && contains(r.targets, target) {
			return nil
		}
	}

	return &ValidationError{
		Source: source, Target: target, Relationship: rel,
		Reason:      reasonFor(source, target, rel),
		Suggestions: LegalRelationships(source, target),
	}
}

// reasonFor produces a human explanation rather than a restatement of the
// failure. The distinction matters when an LLM is reading the error and
// deciding how to retry.
func reasonFor(source, target NodeType, rel Relationship) string {
	var relExists, sourceOK bool
	for _, r := range rules {
		if r.rel != rel {
			continue
		}
		relExists = true
		if contains(r.sources, source) {
			sourceOK = true
		}
	}
	switch {
	case !relExists:
		return fmt.Sprintf("no rule defines %q", rel)
	case !sourceOK:
		return fmt.Sprintf("a %s cannot be the source of %q", source, rel)
	default:
		return fmt.Sprintf("%q cannot point at a %s", rel, target)
	}
}

// LegalRelationships returns every relationship that would make this pair of
// node types a valid edge, formatted for display.
func LegalRelationships(source, target NodeType) []string {
	seen := map[Relationship]bool{}
	var out []string
	for _, r := range rules {
		if seen[r.rel] || !contains(r.sources, source) || !contains(r.targets, target) {
			continue
		}
		seen[r.rel] = true
		out = append(out, fmt.Sprintf("%s --%s--> %s", source, r.rel, target))
	}
	if len(out) == 0 {
		// Nothing connects these two directly; say what the source can do at all.
		for _, r := range rules {
			if !contains(r.sources, source) || seen[r.rel] {
				continue
			}
			seen[r.rel] = true
			out = append(out, fmt.Sprintf("%s --%s--> %s",
				source, r.rel, joinTypes(r.targets)))
		}
	}
	sort.Strings(out)
	return out
}

// IsHierarchical reports whether a relationship participates in the argument
// tree. Hierarchical edges are cycle-checked on insert; associative ones are
// not, because cross-links are their purpose.
func IsHierarchical(rel Relationship) bool {
	for _, r := range rules {
		if r.rel == rel {
			return r.hierarchical
		}
	}
	return false
}

// DefaultRelationship returns the relationship a user almost certainly meant
// when dragging an edge between two node types, or "" when it is ambiguous.
// This drives the keyboard capture loop, where asking would break flow.
func DefaultRelationship(source, target NodeType) (Relationship, bool) {
	// Ordered by strength of intent: a Pro next to an Idea means support.
	preference := []Relationship{
		Supports, ObjectsTo, RespondsTo, Questions, Specializes, RelatesTo,
	}
	for _, rel := range preference {
		if ValidateEdge(source, target, rel) == nil {
			return rel, true
		}
	}
	return "", false
}

// ChildTypeFor returns the node type produced by a capture-loop keystroke when
// a node of the given parent type is selected, plus the relationship that will
// link them. This is what makes `q`, `+` and `-` behave sensibly regardless of
// what happens to be selected.
func ChildTypeFor(key string, parent NodeType) (child NodeType, rel Relationship, ok bool) {
	switch key {
	case "q":
		return Question, Questions, true
	case "+":
		if r, found := firstLegal(Pro, parent, Supports, RelatesTo); found {
			return Pro, r, true
		}
	case "-":
		if r, found := firstLegal(Con, parent, ObjectsTo, RelatesTo); found {
			return Con, r, true
		}
	case "n":
		// A note attaches to anything; an idea only answers a question.
		if parent == Question {
			return Idea, RespondsTo, true
		}
		return Note, RelatesTo, true
	case "i":
		if r, found := firstLegal(Idea, parent, RespondsTo, Specializes); found {
			return Idea, r, true
		}
	}
	return "", "", false
}

func firstLegal(source, target NodeType, candidates ...Relationship) (Relationship, bool) {
	for _, rel := range candidates {
		if ValidateEdge(source, target, rel) == nil {
			return rel, true
		}
	}
	return "", false
}

// Grammar returns a serializable description of the ruleset, used by the API
// so the frontend and any AI agent share one source of truth.
func Grammar() map[string]any {
	relOut := make([]map[string]any, 0, len(rules))
	for _, r := range rules {
		relOut = append(relOut, map[string]any{
			"relationship": r.rel,
			"sources":      r.sources,
			"targets":      r.targets,
			"hierarchical": r.hierarchical,
			"description":  r.label,
		})
	}
	return map[string]any{
		"nodeTypes": NodeTypes,
		"rules":     relOut,
	}
}

func contains(set []NodeType, t NodeType) bool {
	for _, x := range set {
		if x == t {
			return true
		}
	}
	return false
}

func joinTypes(ts []NodeType) string {
	if len(ts) == len(anyType) {
		return "any"
	}
	parts := make([]string, len(ts))
	for i, t := range ts {
		parts[i] = string(t)
	}
	return "{" + strings.Join(parts, "|") + "}"
}

func typeNames() []string {
	out := make([]string, len(NodeTypes))
	for i, t := range NodeTypes {
		out[i] = string(t)
	}
	return out
}

func relNames() []string {
	out := make([]string, len(Relationships))
	for i, r := range Relationships {
		out[i] = string(r)
	}
	return out
}
