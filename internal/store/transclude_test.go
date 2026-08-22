package store

import (
	"errors"
	"testing"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

/*
Inserting an existing node under a parent.

The `/` palette does this in one gesture, so it has to be one action: insert
plus link, committed together and reversed together. Doing it as two API calls
was the obvious implementation and the wrong one — it left two journal entries,
so a single Ctrl-Z removed the link and left the node behind, stranded on a map
the user had not meant to change.
*/

// twoMaps returns a store, a question on map A, and an empty map B.
func twoMaps(t *testing.T) (*Store, *Map, *Map, *Node) {
	t.Helper()
	s := newTestStore(t)
	a, err := s.CreateMap("A", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateMap("B", "")
	if err != nil {
		t.Fatal(err)
	}
	q, _, err := s.CreateNode(NewNodeInput{Type: "question", Title: "Which cache?", MapID: b.ID})
	if err != nil {
		t.Fatal(err)
	}
	return s, a, b, q
}

func edgesOn(t *testing.T, s *Store, mapID string) []Edge {
	t.Helper()
	g, err := s.Graph(mapID)
	if err != nil {
		t.Fatal(err)
	}
	return g.Edges
}

func TestTranscludeUnderAParentLinksInOneAction(t *testing.T) {
	s, a, _, _ := twoMaps(t)

	// A question on the map we are inserting into...
	parent, _, err := s.CreateNode(NewNodeInput{Type: "question", Title: "How do we cache?", MapID: a.ID})
	if err != nil {
		t.Fatal(err)
	}
	// ...and an idea living on a different one, to be pulled in beneath it.
	other, err := s.CreateMap("C", "")
	if err != nil {
		t.Fatal(err)
	}
	shared, _, err := s.CreateNode(NewNodeInput{Type: "idea", Title: "Write-behind", MapID: other.ID})
	if err != nil {
		t.Fatal(err)
	}

	edge, err := s.Transclude(TranscludeInput{
		MapID: a.ID, NodeID: shared.ID, ParentID: parent.ID, X: f(10), Y: f(20),
	})
	if err != nil {
		t.Fatalf("insert under a question: %v", err)
	}
	if edge == nil {
		t.Fatal("no edge came back, so nothing linked the inserted node")
	}
	// Child -> parent, the direction IBIS edges point.
	if edge.SourceNodeID != shared.ID || edge.TargetNodeID != parent.ID {
		t.Errorf("edge runs %s -> %s, want %s -> %s",
			edge.SourceNodeID, edge.TargetNodeID, shared.ID, parent.ID)
	}
	// An Idea answering a Question responds to it.
	if edge.Relationship != ibis.RespondsTo {
		t.Errorf("relationship = %q, want %q", edge.Relationship, ibis.RespondsTo)
	}
	if got := len(edgesOn(t, s, a.ID)); got != 1 {
		t.Errorf("map A has %d edges, want 1", got)
	}
}

func TestOneUndoReversesBothHalves(t *testing.T) {
	// The whole reason for doing this in one transaction.
	s, a, _, _ := twoMaps(t)
	as := s.As("someone")
	parent, _, err := as.CreateNode(NewNodeInput{Type: "question", Title: "How do we cache?", MapID: a.ID})
	if err != nil {
		t.Fatal(err)
	}
	other, _ := as.CreateMap("C", "")
	shared, _, err := as.CreateNode(NewNodeInput{Type: "idea", Title: "Write-behind", MapID: other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := as.Transclude(TranscludeInput{
		MapID: a.ID, NodeID: shared.ID, ParentID: parent.ID,
	}); err != nil {
		t.Fatal(err)
	}

	entry, err := as.Undo("someone", a.ID)
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	if entry == nil {
		t.Fatal("nothing was undone, so the insert was never journaled")
	}
	g, err := s.Graph(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Edges) != 0 {
		t.Errorf("undo left %d edges behind", len(g.Edges))
	}
	for _, n := range g.Nodes {
		if n.ID == shared.ID {
			t.Error("undo removed the link but left the node on the map")
		}
	}
	// And the node itself still exists on the map it came from — undoing an
	// insert must not destroy shared thinking.
	if _, err := s.GetNode(shared.ID, other.ID); err != nil {
		t.Errorf("the shared node was destroyed by an undo: %v", err)
	}
}

func TestRedoRestoresTheLinkToo(t *testing.T) {
	// Redo restored the placement but not the edge, so redoing an insert
	// produced a different graph from the one that was undone.
	s, a, _, _ := twoMaps(t)
	as := s.As("someone")
	parent, _, _ := as.CreateNode(NewNodeInput{Type: "question", Title: "How do we cache?", MapID: a.ID})
	other, _ := as.CreateMap("C", "")
	shared, _, _ := as.CreateNode(NewNodeInput{Type: "idea", Title: "Write-behind", MapID: other.ID})
	if _, err := as.Transclude(TranscludeInput{
		MapID: a.ID, NodeID: shared.ID, ParentID: parent.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Undo("someone", a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Redo("someone", a.ID); err != nil {
		t.Fatalf("redo: %v", err)
	}

	edges := edgesOn(t, s, a.ID)
	if len(edges) != 1 {
		t.Fatalf("redo restored %d edges, want 1", len(edges))
	}
	if edges[0].SourceNodeID != shared.ID || edges[0].TargetNodeID != parent.ID {
		t.Errorf("redone edge is %s -> %s, want %s -> %s",
			edges[0].SourceNodeID, edges[0].TargetNodeID, shared.ID, parent.ID)
	}
}

func TestInsertingUnderAnIllegalParentChangesNothing(t *testing.T) {
	// An Idea cannot answer an Idea. The whole thing has to roll back: a
	// rejected link that still moved the node onto the map would be worse than
	// either outcome on its own.
	s, a, _, _ := twoMaps(t)
	parent, _, err := s.CreateNode(NewNodeInput{Type: "idea", Title: "Read-through", MapID: a.ID})
	if err != nil {
		t.Fatal(err)
	}
	other, _ := s.CreateMap("C", "")
	shared, _, err := s.CreateNode(NewNodeInput{Type: "idea", Title: "Write-behind", MapID: other.ID})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.Transclude(TranscludeInput{
		MapID: a.ID, NodeID: shared.ID, ParentID: parent.ID,
	})
	if err == nil {
		t.Fatal("an Idea was allowed to answer an Idea")
	}
	// The message has to teach, not just refuse.
	var ve *ibis.ValidationError
	if !errors.As(err, &ve) {
		t.Errorf("error is %T, want an *ibis.ValidationError carrying suggestions", err)
	}

	g, err := s.Graph(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range g.Nodes {
		if n.ID == shared.ID {
			t.Error("the node was placed even though the link was rejected")
		}
	}
	if len(g.Edges) != 0 {
		t.Errorf("rejected insert left %d edges", len(g.Edges))
	}
}

func TestLinkingANodeAlreadyOnTheMap(t *testing.T) {
	// Not the palette's path — it offers "On this map" instead — but the store
	// must not silently drop an edge a caller asked for.
	s, a, _, _ := twoMaps(t)
	as := s.As("someone")
	parent, _, _ := as.CreateNode(NewNodeInput{Type: "question", Title: "How do we cache?", MapID: a.ID})
	child, _, _ := as.CreateNode(NewNodeInput{Type: "idea", Title: "Write-behind", MapID: a.ID})

	edge, err := as.Transclude(TranscludeInput{
		MapID: a.ID, NodeID: child.ID, ParentID: parent.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if edge == nil {
		t.Fatal("the requested edge was dropped because the node was already placed")
	}
	// Undoing this must remove only the edge: the node was here first and is
	// not this action's to take away.
	if _, err := as.Undo("someone", a.ID); err != nil {
		t.Fatal(err)
	}
	g, err := s.Graph(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Edges) != 0 {
		t.Errorf("undo left %d edges", len(g.Edges))
	}
	if len(g.Nodes) != 2 {
		t.Errorf("undo removed a node it did not add: %d nodes left, want 2", len(g.Nodes))
	}
}

func TestSearchReportsEveryMapANodeIsOn(t *testing.T) {
	// The palette needs this to tell "already here" from "elsewhere", and to
	// know which map to open when jumping. scanNodes never filled it, so the
	// map column had always read "unplaced".
	s, a, b, q := twoMaps(t)
	if _, err := s.Transclude(TranscludeInput{MapID: a.ID, NodeID: q.ID}); err != nil {
		t.Fatal(err)
	}

	found, err := s.SearchNodes("cache", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 {
		t.Fatalf("found %d nodes, want 1", len(found))
	}
	if len(found[0].MapIDs) != 2 {
		t.Fatalf("mapIds = %v, want both maps", found[0].MapIDs)
	}
	seen := map[string]bool{found[0].MapIDs[0]: true, found[0].MapIDs[1]: true}
	if !seen[a.ID] || !seen[b.ID] {
		t.Errorf("mapIds = %v, want %s and %s", found[0].MapIDs, a.ID, b.ID)
	}
	if found[0].MapCount != 2 {
		t.Errorf("mapCount = %d, want 2", found[0].MapCount)
	}
}
