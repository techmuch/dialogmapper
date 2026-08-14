package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/davidfullmer/dialogmapper/internal/ibis"
)

// Undo is the feature most capable of destroying work while appearing to help,
// so these tests check what actually survives a round trip rather than just
// that the call returned nil.

const alice, bob = "alice", "bob"

func nodeCount(t *testing.T, s *Store, mapID string) int {
	t.Helper()
	g, err := s.Graph(mapID)
	if err != nil {
		t.Fatal(err)
	}
	return len(g.Nodes)
}

func edgeCount(t *testing.T, s *Store, mapID string) int {
	t.Helper()
	g, err := s.Graph(mapID)
	if err != nil {
		t.Fatal(err)
	}
	return len(g.Edges)
}

func TestUndoCreateNode(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")
	as := s.As(alice)

	q, _, err := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Ship Fridays?", MapID: m.ID})
	if err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, m.ID) != 1 {
		t.Fatal("node was not created")
	}

	entry, err := as.Undo(alice, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The label is most of undo's value: it tells the user what vanished.
	if !strings.Contains(entry.Label, "Ship Fridays?") {
		t.Errorf("label = %q, should name the node", entry.Label)
	}
	if nodeCount(t, s, m.ID) != 0 {
		t.Error("undo did not remove the node")
	}

	if _, err := as.Redo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, m.ID) != 1 {
		t.Fatal("redo did not restore the node")
	}
	// The id has to survive, or exports and other maps would point at nothing.
	back, err := s.GetNode(q.ID, m.ID)
	if err != nil {
		t.Fatalf("redo created a different node: %v", err)
	}
	if back.Title != "Ship Fridays?" {
		t.Errorf("title = %q after redo", back.Title)
	}
}

// TestUndoDeleteRestoresEdgesAndPlacements is the case that makes a naive
// implementation dangerous: deleting a node cascades to its edges and to its
// placement on every map, and an undo that restores only the node row would
// silently destroy the argument structure around it.
func TestUndoDeleteRestoresEdgesAndPlacements(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")

	q, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Q", MapID: m.ID})
	idea, _, _ := as.CreateNode(NewNodeInput{
		Type: ibis.Idea, Title: "An idea", MapID: m.ID,
		X: f(300), Y: f(400),
		ParentID: q.ID, Relationship: ibis.RespondsTo,
	})
	if _, _, err := as.CreateNode(NewNodeInput{
		Type: ibis.Pro, Title: "A pro", MapID: m.ID,
		ParentID: idea.ID, Relationship: ibis.Supports,
	}); err != nil {
		t.Fatal(err)
	}

	// Share the idea onto a second map, then position it differently there.
	m2, _ := as.CreateMap("M2", "")
	if err := as.Transclude(m2.ID, idea.ID, f(11), f(22)); err != nil {
		t.Fatal(err)
	}

	before, err := s.GetNode(idea.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if before.MapCount != 2 {
		t.Fatalf("setup wrong: mapCount = %d", before.MapCount)
	}

	if err := as.DeleteNode(idea.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetNode(idea.ID, m.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("node should be gone")
	}

	entry, err := as.Undo(alice, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(entry.Label, "2 maps") {
		t.Errorf("label should say how far the delete reached, got %q", entry.Label)
	}

	restored, err := s.GetNode(idea.ID, m.ID)
	if err != nil {
		t.Fatalf("node not restored: %v", err)
	}
	if restored.MapCount != 2 {
		t.Errorf("mapCount = %d after undo, want 2 — transclusion was lost", restored.MapCount)
	}
	if restored.Placement == nil || restored.Placement.X == nil || *restored.Placement.X != 300 {
		t.Errorf("placement on the original map was not restored: %+v", restored.Placement)
	}
	onM2, err := s.GetNode(idea.ID, m2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if onM2.Placement == nil || *onM2.Placement.X != 11 {
		t.Errorf("second map placement lost: %+v", onM2.Placement)
	}
	// Both edges — the one to the Question and the one from the Pro — must
	// come back, or the argument is silently disconnected.
	if got := edgeCount(t, s, m.ID); got != 2 {
		t.Errorf("edges after undo = %d, want 2", got)
	}
}

func TestUndoRemoveFromMapKeepsOtherMaps(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	m2, _ := as.CreateMap("M2", "")

	q, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Q", MapID: m.ID})
	if err := as.Transclude(m2.ID, q.ID, nil, nil); err != nil {
		t.Fatal(err)
	}

	if err := as.RemoveFromMap(m.ID, q.ID); err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, m.ID) != 0 || nodeCount(t, s, m2.ID) != 1 {
		t.Fatal("removal from one map should not affect the other")
	}

	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, m.ID) != 1 {
		t.Error("undo did not put the node back on the map")
	}
	if nodeCount(t, s, m2.ID) != 1 {
		t.Error("undo disturbed the other map")
	}
}

func TestUndoEditRestoresPreviousValues(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	n, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Idea, Title: "Original", MapID: m.ID})

	if _, err := as.UpdateNode(n.ID, NodePatch{
		Title:  ptr("Changed"),
		Status: statusPtr(StatusResolved),
		Tags:   &[]string{"perf"},
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	back, err := s.GetNode(n.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if back.Title != "Original" {
		t.Errorf("title = %q, want Original", back.Title)
	}
	if back.Content.Status != StatusOpen {
		t.Errorf("status = %q, want open", back.Content.Status)
	}
	if len(back.Content.Tags) != 0 {
		t.Errorf("tags = %v, want none", back.Content.Tags)
	}
}

// TestConsecutiveEditsCollapse keeps undo usable while typing: without this,
// a 30-character title would take 30 presses of Ctrl-Z to undo.
func TestConsecutiveEditsCollapse(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	// An empty title is filled in with a placeholder at creation, so that
	// placeholder is what a full undo of the typing run should restore.
	n, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "", MapID: m.ID})
	placeholder := n.Title

	for _, title := range []string{"C", "Ca", "Cac", "Cach", "Cache"} {
		if _, err := as.UpdateNode(n.ID, NodePatch{Title: ptr(title)}); err != nil {
			t.Fatal(err)
		}
	}

	undo, _, err := s.UndoDepth(alice, "")
	if err != nil {
		t.Fatal(err)
	}
	// One entry for the create, one for the whole run of edits.
	if undo != 2 {
		t.Errorf("undo depth = %d, want 2 (create + one merged edit)", undo)
	}

	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	back, _ := s.GetNode(n.ID, "")
	if back.Title != placeholder {
		t.Errorf("one undo should revert the whole typing run to %q, got %q",
			placeholder, back.Title)
	}
}

func TestEditsOnDifferentNodesDoNotCollapse(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	a, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "A", MapID: m.ID})
	b, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "B", MapID: m.ID})

	as.UpdateNode(a.ID, NodePatch{Title: ptr("A1")})
	as.UpdateNode(b.ID, NodePatch{Title: ptr("B1")})

	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	gotB, _ := s.GetNode(b.ID, "")
	gotA, _ := s.GetNode(a.ID, "")
	if gotB.Title != "B" {
		t.Errorf("undo should have reverted B, got %q", gotB.Title)
	}
	if gotA.Title != "A1" {
		t.Errorf("undo also reverted A: %q — edits to different nodes merged", gotA.Title)
	}
}

func TestUndoMoveAndCollapseOfMoves(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	n, _, _ := as.CreateNode(NewNodeInput{
		Type: ibis.Note, Title: "N", MapID: m.ID, X: f(0), Y: f(0),
	})

	for i := 1.0; i <= 4; i++ {
		if err := as.SetPlacement(m.ID, n.ID, f(i*10), f(i*10), nil, nil); err != nil {
			t.Fatal(err)
		}
	}

	undo, _, _ := s.UndoDepth(alice, "")
	if undo != 2 {
		t.Errorf("undo depth = %d, want 2 (create + one merged drag)", undo)
	}

	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	back, _ := s.GetNode(n.ID, m.ID)
	if back.Placement == nil || *back.Placement.X != 0 {
		t.Errorf("undo should return the node to its original spot, got %+v", back.Placement)
	}
}

// TestFirstPlacementIsNotUndoable guards a bug found by driving the real UI:
// a map seeded from the CLI has nodes with no coordinates, and the canvas
// assigns them on open. Recording those as user moves meant Ctrl-Z immediately
// after opening reversed an automatic layout rather than anything the user
// did — and the undo button was lit before they had touched anything.
func TestFirstPlacementIsNotUndoable(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")

	// Seeded by the CLI: no coordinates.
	n, _, err := s.As(CLIActor).CreateNode(NewNodeInput{
		Type: ibis.Question, Title: "From a seed", MapID: m.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	// A fresh browser tab opens the map and auto-layout assigns a position.
	tab := s.As("browser-tab-1")
	if err := tab.SetPlacement(m.ID, n.ID, f(120), f(240), nil, nil); err != nil {
		t.Fatal(err)
	}

	undo, _, err := s.UndoDepth("browser-tab-1", m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if undo != 0 {
		t.Errorf("undo depth = %d after auto-layout; the tab has done nothing the user asked for", undo)
	}

	// A genuine drag afterwards is undoable, and returns to the laid-out spot.
	if err := tab.SetPlacement(m.ID, n.ID, f(900), f(900), nil, nil); err != nil {
		t.Fatal(err)
	}
	if undo, _, _ := s.UndoDepth("browser-tab-1", m.ID); undo != 1 {
		t.Fatalf("a real drag should be undoable, depth = %d", undo)
	}
	if _, err := tab.Undo("browser-tab-1", m.ID); err != nil {
		t.Fatal(err)
	}
	back, _ := s.GetNode(n.ID, m.ID)
	if back.Placement == nil || *back.Placement.X != 120 {
		t.Errorf("undo should return to the laid-out position, got %+v", back.Placement)
	}
}

func TestUndoEdgeCreateAndDelete(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	q, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Q", MapID: m.ID})
	i, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Idea, Title: "I", MapID: m.ID})

	e, err := as.CreateEdge(m.ID, i.ID, q.ID, ibis.RespondsTo)
	if err != nil {
		t.Fatal(err)
	}
	if edgeCount(t, s, m.ID) != 1 {
		t.Fatal("edge not created")
	}
	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if edgeCount(t, s, m.ID) != 0 {
		t.Error("undo did not remove the edge")
	}
	if _, err := as.Redo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if edgeCount(t, s, m.ID) != 1 {
		t.Error("redo did not restore the edge")
	}

	if err := as.DeleteEdge(e.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if edgeCount(t, s, m.ID) != 1 {
		t.Error("undo of a delete did not restore the edge")
	}
}

func TestUndoGroupCreateAndMove(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")

	g, err := as.UpsertGroup(Group{MapID: m.ID, Title: "Cluster", X: 0, Y: 0, W: 200, H: 200})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	groups, _ := s.GroupsFor(m.ID)
	if len(groups) != 0 {
		t.Error("undo did not remove the new group")
	}

	if _, err := as.Redo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	moved := *g
	moved.X = 500
	if _, err := as.UpsertGroup(moved); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	groups, _ = s.GroupsFor(m.ID)
	if len(groups) != 1 || groups[0].X != 0 {
		t.Errorf("undo did not restore the previous geometry: %+v", groups)
	}
}

// TestUndoIsScopedPerActor is the collaboration guarantee: the facilitator
// pressing Ctrl-Z must never reverse what somebody just sent from a phone.
func TestUndoIsScopedPerActor(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")

	aliceNode, _, err := s.As(alice).CreateNode(NewNodeInput{
		Type: ibis.Question, Title: "Alice's question", MapID: m.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	bobNode, _, err := s.As(bob).CreateNode(NewNodeInput{
		Type: ibis.Note, Title: "Bob's note from a phone", MapID: m.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Alice undoes. Bob added the most recent node, but Alice must get her own
	// back — not Bob's.
	entry, err := s.As(alice).Undo(alice, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(entry.Label, "Alice's question") {
		t.Fatalf("Alice's undo reversed %q — undo is not actor-scoped", entry.Label)
	}
	if _, err := s.GetNode(bobNode.ID, m.ID); err != nil {
		t.Error("Alice's undo destroyed Bob's node")
	}
	if _, err := s.GetNode(aliceNode.ID, m.ID); !errors.Is(err, ErrNotFound) {
		t.Error("Alice's own node was not undone")
	}

	// Bob's own history is untouched by Alice's undo.
	if undo, _, _ := s.UndoDepth(bob, m.ID); undo != 1 {
		t.Errorf("Bob's undo depth = %d, want 1", undo)
	}
}

func TestNothingToUndoIsADistinctError(t *testing.T) {
	s := newTestStore(t)
	m, _ := s.CreateMap("M", "")
	if _, err := s.As(alice).Undo(alice, m.ID); !errors.Is(err, ErrNothingToUndo) {
		t.Errorf("err = %v, want ErrNothingToUndo", err)
	}
	if _, err := s.As(alice).Redo(alice, m.ID); !errors.Is(err, ErrNothingToRedo) {
		t.Errorf("err = %v, want ErrNothingToRedo", err)
	}
}

// TestNewChangeDiscardsRedo pins the standard rule. Without it, redo would
// reapply an action against a world that has since moved on.
func TestNewChangeDiscardsRedo(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")
	as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "First", MapID: m.ID})

	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, redo, _ := s.UndoDepth(alice, m.ID); redo != 1 {
		t.Fatal("expected something to redo")
	}

	as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "Second", MapID: m.ID})

	if _, redo, _ := s.UndoDepth(alice, m.ID); redo != 0 {
		t.Error("a new change should have discarded the redo tail")
	}
	if _, err := as.Redo(alice, m.ID); !errors.Is(err, ErrNothingToRedo) {
		t.Errorf("redo after a new change = %v, want ErrNothingToRedo", err)
	}
}

// TestUndoManyStepsUnwindsInOrder walks a realistic capture session backwards.
func TestUndoManyStepsUnwindsInOrder(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")

	q, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Q", MapID: m.ID})
	idea, _, _ := as.CreateNode(NewNodeInput{
		Type: ibis.Idea, Title: "I", MapID: m.ID, ParentID: q.ID, Relationship: ibis.RespondsTo})
	as.CreateNode(NewNodeInput{
		Type: ibis.Pro, Title: "P", MapID: m.ID, ParentID: idea.ID, Relationship: ibis.Supports})
	as.CreateNode(NewNodeInput{
		Type: ibis.Con, Title: "C", MapID: m.ID, ParentID: idea.ID, Relationship: ibis.ObjectsTo})

	if nodeCount(t, s, m.ID) != 4 {
		t.Fatalf("setup: %d nodes", nodeCount(t, s, m.ID))
	}

	for want := 3; want >= 0; want-- {
		if _, err := as.Undo(alice, m.ID); err != nil {
			t.Fatalf("undo at %d: %v", want, err)
		}
		if got := nodeCount(t, s, m.ID); got != want {
			t.Fatalf("after undo: %d nodes, want %d", got, want)
		}
	}
	if _, err := as.Undo(alice, m.ID); !errors.Is(err, ErrNothingToUndo) {
		t.Errorf("journal should be exhausted, got %v", err)
	}

	// And forwards again, back to where we started.
	for want := 1; want <= 4; want++ {
		if _, err := as.Redo(alice, m.ID); err != nil {
			t.Fatalf("redo at %d: %v", want, err)
		}
		if got := nodeCount(t, s, m.ID); got != want {
			t.Fatalf("after redo: %d nodes, want %d", got, want)
		}
	}
	if got := edgeCount(t, s, m.ID); got != 3 {
		t.Errorf("edges after full redo = %d, want 3", got)
	}
}

func statusPtr(s Status) *Status { return &s }
