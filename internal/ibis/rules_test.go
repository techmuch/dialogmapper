package ibis

import "testing"

// The grammar is the load-bearing constraint in this project: if it is wrong,
// every export and every AI round trip is subtly wrong too. These tests pin
// the moves that must be legal and, more importantly, the ones that must not.

func TestValidateEdge_LegalMoves(t *testing.T) {
	legal := []struct {
		src, tgt NodeType
		rel      Relationship
	}{
		{Idea, Question, RespondsTo},
		{Map, Question, RespondsTo},
		{Question, Idea, Questions},
		{Question, Question, Questions},
		{Pro, Idea, Supports},
		{Con, Idea, ObjectsTo},
		{Pro, Con, Supports},  // reinforcing a rebuttal
		{Con, Pro, ObjectsTo}, // rebutting an argument
		{Note, Question, RelatesTo},
		{Note, Pro, RelatesTo},
		{Idea, Note, RelatesTo},
		{Question, Question, Specializes},
	}
	for _, c := range legal {
		if err := ValidateEdge(c.src, c.tgt, c.rel); err != nil {
			t.Errorf("%s --%s--> %s should be legal: %v", c.src, c.rel, c.tgt, err)
		}
	}
}

func TestValidateEdge_RejectsNonsense(t *testing.T) {
	illegal := []struct {
		src, tgt NodeType
		rel      Relationship
		why      string
	}{
		{Question, Idea, RespondsTo, "a Question does not answer an Idea"},
		{Pro, Question, Supports, "a Pro supports an Idea, not a bare Question"},
		{Con, Question, ObjectsTo, "a Con objects to an Idea, not a bare Question"},
		{Idea, Idea, RespondsTo, "an Idea does not respond to another Idea"},
		{Idea, Idea, Specializes, "an Idea does not stand under another Idea"},
		{Question, Idea, Specializes, "specialization is between issues, not answers"},
		{Note, Question, Supports, "a Note carries no argumentative force"},
		{Idea, Question, Supports, "an Idea responds; it does not support"},
		{Pro, Note, Supports, "supporting a Note is meaningless"},
	}
	for _, c := range illegal {
		err := ValidateEdge(c.src, c.tgt, c.rel)
		if err == nil {
			t.Errorf("%s --%s--> %s should be rejected (%s)", c.src, c.rel, c.tgt, c.why)
			continue
		}
		ve, ok := err.(*ValidationError)
		if !ok {
			t.Errorf("expected *ValidationError, got %T", err)
			continue
		}
		// A rejection that does not say what to do instead is a dead end for
		// both a person and an agent.
		if ve.Reason == "" {
			t.Errorf("%s --%s--> %s: rejection carries no reason", c.src, c.rel, c.tgt)
		}
		if len(ve.Suggestions) == 0 {
			t.Errorf("%s --%s--> %s: rejection offers no alternative", c.src, c.rel, c.tgt)
		}
	}
}

func TestValidateEdge_UnknownInputs(t *testing.T) {
	if err := ValidateEdge("banana", Question, RespondsTo); err == nil {
		t.Error("unknown source type should be rejected")
	}
	if err := ValidateEdge(Idea, Question, "vibes_with"); err == nil {
		t.Error("unknown relationship should be rejected")
	}
}

func TestDefaultRelationship(t *testing.T) {
	cases := []struct {
		src, tgt NodeType
		want     Relationship
	}{
		{Pro, Idea, Supports},
		{Con, Idea, ObjectsTo},
		{Idea, Question, RespondsTo},
		{Question, Idea, Questions},
		{Note, Idea, RelatesTo},
	}
	for _, c := range cases {
		got, ok := DefaultRelationship(c.src, c.tgt)
		if !ok || got != c.want {
			t.Errorf("DefaultRelationship(%s,%s) = %q,%v; want %q",
				c.src, c.tgt, got, ok, c.want)
		}
	}

	// Dragging a Pro onto a Question has no honest interpretation, and
	// guessing one would silently corrupt the argument structure.
	if _, ok := DefaultRelationship(Pro, Question); ok {
		t.Error("Pro -> Question should have no default relationship")
	}
}

// TestIdeasDoNotAttachToIdeas pins the rule directly, across every
// relationship rather than one at a time.
//
// An Idea answers a Question, so two Ideas are alternatives to each other —
// neither stands under the other. A single over-broad rule (specializes used
// to accept Question *or* Idea at both ends) made this legal, which showed up
// as being able to retype a Con hanging off an Idea into a second Idea.
func TestIdeasDoNotAttachToIdeas(t *testing.T) {
	for _, rel := range Relationships {
		if err := ValidateEdge(Idea, Idea, rel); err == nil {
			t.Errorf("idea --%s--> idea should be illegal", rel)
		}
	}
	if _, ok := DefaultRelationship(Idea, Idea); ok {
		t.Error("there should be no default relationship between two Ideas")
	}
}

// TestUnconnectablePairs states the shape of the grammar as a whole, so a
// future rule that is too broad fails here rather than being discovered by a
// user retyping a node into something the model does not have.
func TestUnconnectablePairs(t *testing.T) {
	// Pairs that no relationship may connect, in this direction.
	forbidden := []struct {
		src, tgt NodeType
		why      string
	}{
		{Idea, Idea, "Ideas are alternatives, not a hierarchy"},
		{Pro, Question, "an argument supports an answer, not the issue"},
		{Con, Question, "an argument rebuts an answer, not the issue"},
		{Idea, Pro, "an Idea does not hang off an argument"},
		{Idea, Con, "an Idea does not hang off an argument"},
		{Question, Question, ""}, // connectable — asserted separately below
	}
	for _, c := range forbidden {
		if c.why == "" {
			continue
		}
		if _, ok := DefaultRelationship(c.src, c.tgt); ok {
			t.Errorf("%s -> %s should not be connectable: %s", c.src, c.tgt, c.why)
		}
	}

	// And the pairs that must stay connectable, so this test cannot pass by
	// making the grammar uselessly strict.
	for _, c := range []struct{ src, tgt NodeType }{
		{Idea, Question}, {Pro, Idea}, {Con, Idea},
		{Question, Idea}, {Question, Question}, {Note, Idea}, {Idea, Note},
	} {
		if _, ok := DefaultRelationship(c.src, c.tgt); !ok {
			t.Errorf("%s -> %s must remain connectable", c.src, c.tgt)
		}
	}
}

func TestIsHierarchical(t *testing.T) {
	// relates_to must stay outside the tree: cross-links are its entire
	// purpose, and treating them as hierarchy would trip cycle detection on
	// perfectly valid maps.
	if IsHierarchical(RelatesTo) {
		t.Error("relates_to must not be hierarchical")
	}
	for _, rel := range []Relationship{RespondsTo, Supports, ObjectsTo, Questions, Specializes} {
		if !IsHierarchical(rel) {
			t.Errorf("%s should be hierarchical", rel)
		}
	}
}

func TestChildTypeFor(t *testing.T) {
	// The capture-loop keys must produce a legal edge for whatever is
	// selected, since the user cannot see the grammar while typing.
	for _, parent := range NodeTypes {
		for _, key := range []string{"q", "+", "-", "n", "i"} {
			child, rel, ok := ChildTypeFor(key, parent)
			if !ok {
				continue
			}
			if err := ValidateEdge(child, parent, rel); err != nil {
				t.Errorf("key %q with %s selected produced an illegal edge: %v",
					key, parent, err)
			}
		}
	}
}

func TestGrammarIsSerializable(t *testing.T) {
	g := Grammar()
	rules, ok := g["rules"].([]map[string]any)
	if !ok || len(rules) == 0 {
		t.Fatal("grammar exposes no rules")
	}
	for _, r := range rules {
		if r["description"] == "" {
			t.Errorf("rule %v has no description", r["relationship"])
		}
	}
}
