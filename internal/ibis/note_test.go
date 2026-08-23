package ibis

import "testing"

/*
A Note attaches to anything.

This is the one universal rule in the grammar, and the thing that makes Notes
useful: a constraint, a link, a piece of evidence or a caveat can hang off any
part of an argument without claiming to be part of it. Every other type is
restricted — an Idea only answers a Question, a Pro only supports an Idea — so
it is easy to add a restriction here by accident while tightening one of those.

These tests iterate over the type list rather than naming pairs, so a new node
type is covered the day it is added instead of the day somebody remembers.
*/

func TestNoteAttachesToEveryType(t *testing.T) {
	for _, other := range NodeTypes {
		// Note -> other.
		if err := ValidateEdge(Note, other, RelatesTo); err != nil {
			t.Errorf("a Note cannot relate to a %s: %v", other, err)
		}
		// other -> Note. The rule is symmetric on purpose: which end you drag
		// from is an accident of the gesture, not a statement about meaning.
		if err := ValidateEdge(other, Note, RelatesTo); err != nil {
			t.Errorf("a %s cannot relate to a Note: %v", other, err)
		}
	}
}

// TestNoteIsInferredForEveryParent covers the path the UI actually uses: the
// canvas, the phone and `node add --parent` all leave the relationship blank
// and let the grammar choose. If inference failed for some parent type, the
// keystroke would produce an error toast rather than a node.
func TestNoteIsInferredForEveryParent(t *testing.T) {
	for _, parent := range NodeTypes {
		rel, ok := DefaultRelationship(Note, parent)
		if !ok {
			t.Errorf("no relationship inferred for a Note under a %s", parent)
			continue
		}
		if rel != RelatesTo {
			t.Errorf("a Note under a %s inferred %q, want %q", parent, rel, RelatesTo)
		}
	}
}

// TestNoteCarriesNoArgumentativeForce is the other half of the guarantee: a
// Note relates to things, and that is *all* it does. Widening RelatesTo far
// enough to cover every type must not also let a Note support or object to
// something, which would make it an argument wearing a Note's clothes.
func TestNoteCarriesNoArgumentativeForce(t *testing.T) {
	for _, other := range NodeTypes {
		for _, rel := range []Relationship{Supports, ObjectsTo, RespondsTo, Specializes} {
			if err := ValidateEdge(Note, other, rel); err == nil {
				t.Errorf("a Note was allowed to %s a %s", rel, other)
			}
		}
	}
}
