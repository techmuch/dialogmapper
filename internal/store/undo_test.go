package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/techmuch/dialogmapper/internal/ibis"
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
	// Break the run, so this is an edit in its own right rather than a
	// continuation of the create (which would merge — see
	// TestTitlingANewNodeIsOneAction).
	as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "Unrelated", MapID: m.ID})

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

	target, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "Original", MapID: m.ID})
	// Something else in between, so the run of edits below is its own action
	// rather than a continuation of the create.
	as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "Unrelated", MapID: m.ID})

	for _, title := range []string{"C", "Ca", "Cac", "Cach", "Cache"} {
		if _, err := as.UpdateNode(target.ID, NodePatch{Title: ptr(title)}); err != nil {
			t.Fatal(err)
		}
	}

	undo, _, err := s.UndoDepth(alice, "")
	if err != nil {
		t.Fatal(err)
	}
	// Two creates, plus one entry for the whole run of five edits.
	if undo != 3 {
		t.Errorf("undo depth = %d, want 3 (two creates + one merged edit run)", undo)
	}

	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	back, _ := s.GetNode(target.ID, "")
	if back.Title != "Original" {
		t.Errorf("one undo should revert the whole typing run, got %q", back.Title)
	}
}

// TestTitlingANewNodeIsOneAction covers the capture loop's actual shape: press
// `q`, type a title, commit. That is one act of authorship, so one Ctrl-Z must
// remove the node — not leave an untitled one behind, which reads as undo
// being broken rather than as the title being reverted.
func TestTitlingANewNodeIsOneAction(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")

	q, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "", MapID: m.ID})
	if _, err := as.UpdateNode(q.ID, NodePatch{Title: ptr("Ship on Fridays?")}); err != nil {
		t.Fatal(err)
	}

	if undo, _, _ := s.UndoDepth(alice, m.ID); undo != 1 {
		t.Errorf("undo depth = %d, want 1 (create and its title are one action)", undo)
	}

	entry, err := as.Undo(alice, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The label should name the node as titled, not as the placeholder.
	if !strings.Contains(entry.Label, "Ship on Fridays?") {
		t.Errorf("label = %q, should name the titled node", entry.Label)
	}
	if nodeCount(t, s, m.ID) != 0 {
		t.Error("one undo should have removed the node entirely")
	}

	// Redo must bring it back with the typed title, not the placeholder.
	if _, err := as.Redo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	back, err := s.GetNode(q.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.Title != "Ship on Fridays?" {
		t.Errorf("redo restored the title as %q, want the typed one", back.Title)
	}
}

// An edit long after the fact must not fold into the creation.
func TestUnrelatedEditDoesNotMergeIntoACreate(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, _ := as.CreateMap("M", "")

	n, _, _ := as.CreateNode(NewNodeInput{Type: ibis.Idea, Title: "An idea", MapID: m.ID})
	as.CreateNode(NewNodeInput{Type: ibis.Note, Title: "Something else", MapID: m.ID})

	if _, err := as.UpdateNode(n.ID, NodePatch{Title: ptr("A better idea")}); err != nil {
		t.Fatal(err)
	}

	// Undoing the edit reverts the title and leaves both nodes in place.
	if _, err := as.Undo(alice, m.ID); err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, m.ID) != 2 {
		t.Errorf("the edit should not have merged into the create: %d nodes left",
			nodeCount(t, s, m.ID))
	}
	back, _ := s.GetNode(n.ID, m.ID)
	if back.Title != "An idea" {
		t.Errorf("title = %q, want the previous value", back.Title)
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

// groupOfThree builds a small map with three placed nodes, for the group tests.
func groupOfThree(t *testing.T, as *Store) (mapID string, ids []string) {
	t.Helper()
	m, err := as.CreateMap("M", "")
	if err != nil {
		t.Fatal(err)
	}
	for i, title := range []string{"A", "B", "C"} {
		n, _, err := as.CreateNode(NewNodeInput{
			Type: ibis.Note, Title: title, MapID: m.ID,
			X: f(float64(i) * 100), Y: f(float64(i) * 50),
		})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, n.ID)
	}
	return m.ID, ids
}

func TestUndoGroupCreation(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)

	g, err := as.CreateGroup(mapID, "Cluster", "", ids)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.NodeIDs) != 3 {
		t.Fatalf("group has %d members, want 3", len(g.NodeIDs))
	}

	if _, err := as.Undo(alice, mapID); err != nil {
		t.Fatal(err)
	}
	groups, _ := s.GroupsFor(mapID)
	if len(groups) != 0 {
		t.Error("undo did not remove the group")
	}
	// The nodes themselves must survive — a group is an arrangement of nodes,
	// not a container that owns their existence.
	if nodeCount(t, s, mapID) != 3 {
		t.Errorf("undo took the nodes with it: %d left", nodeCount(t, s, mapID))
	}

	if _, err := as.Redo(alice, mapID); err != nil {
		t.Fatal(err)
	}
	groups, _ = s.GroupsFor(mapID)
	if len(groups) != 1 || len(groups[0].NodeIDs) != 3 {
		t.Errorf("redo did not restore the membership: %+v", groups)
	}
}

func TestGroupNeedsAtLeastTwoNodes(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)

	// A group of one is a node with decoration; a group of none has no outline.
	if _, err := as.CreateGroup(mapID, "", "", ids[:1]); err == nil {
		t.Error("grouping a single node should be refused")
	}
	if _, err := as.CreateGroup(mapID, "", "", nil); err == nil {
		t.Error("grouping nothing should be refused")
	}
}

// TestMoveGroupMovesItsMembers is the behaviour that makes a group a group.
func TestMoveGroupMovesItsMembers(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)

	g, err := as.CreateGroup(mapID, "Cluster", "", ids)
	if err != nil {
		t.Fatal(err)
	}

	before := map[string][2]float64{}
	for _, id := range ids {
		n, _ := s.GetNode(id, mapID)
		before[id] = [2]float64{*n.Placement.X, *n.Placement.Y}
	}

	if _, err := as.MoveGroup(mapID, g.ID, 40, -25); err != nil {
		t.Fatal(err)
	}

	for _, id := range ids {
		n, _ := s.GetNode(id, mapID)
		want := [2]float64{before[id][0] + 40, before[id][1] - 25}
		if *n.Placement.X != want[0] || *n.Placement.Y != want[1] {
			t.Errorf("node %s at (%v,%v), want (%v,%v) — members did not move with the group",
				id, *n.Placement.X, *n.Placement.Y, want[0], want[1])
		}
	}

	// And one undo puts the whole arrangement back.
	if _, err := as.Undo(alice, mapID); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		n, _ := s.GetNode(id, mapID)
		if *n.Placement.X != before[id][0] || *n.Placement.Y != before[id][1] {
			t.Errorf("node %s not restored: (%v,%v)", id, *n.Placement.X, *n.Placement.Y)
		}
	}
}

func TestConsecutiveGroupMovesCollapse(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)
	g, _ := as.CreateGroup(mapID, "Cluster", "", ids)

	depthBefore, _, _ := s.UndoDepth(alice, mapID)
	for i := 0; i < 5; i++ {
		if _, err := as.MoveGroup(mapID, g.ID, 10, 10); err != nil {
			t.Fatal(err)
		}
	}
	depthAfter, _, _ := s.UndoDepth(alice, mapID)

	// Dragging is one gesture however many frames it took.
	if depthAfter != depthBefore+1 {
		t.Errorf("five drag steps added %d undo entries, want 1", depthAfter-depthBefore)
	}

	if _, err := as.Undo(alice, mapID); err != nil {
		t.Fatal(err)
	}
	n, _ := s.GetNode(ids[0], mapID)
	if *n.Placement.X != 0 {
		t.Errorf("one undo should reverse the whole drag, got x=%v", *n.Placement.X)
	}
}

func TestUngroupingLeavesTheNodes(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)
	g, _ := as.CreateGroup(mapID, "Cluster", "", ids)

	if err := as.DeleteGroup(g.ID); err != nil {
		t.Fatal(err)
	}
	if nodeCount(t, s, mapID) != 3 {
		t.Errorf("ungrouping deleted nodes: %d left", nodeCount(t, s, mapID))
	}
	groups, _ := s.GroupsFor(mapID)
	if len(groups) != 0 {
		t.Error("group still present after delete")
	}

	// Undo restores both the group and who was in it.
	if _, err := as.Undo(alice, mapID); err != nil {
		t.Fatal(err)
	}
	groups, _ = s.GroupsFor(mapID)
	if len(groups) != 1 || len(groups[0].NodeIDs) != 3 {
		t.Errorf("undo did not restore the membership: %+v", groups)
	}
}

func TestEmptyingAGroupDissolvesIt(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)
	g, _ := as.CreateGroup(mapID, "Cluster", "", ids)

	// Removing members down to none leaves nothing to draw, so the group goes
	// rather than lingering as an invisible row.
	left, err := as.SetGroupMembers(mapID, g.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if left != nil {
		t.Errorf("expected the group to dissolve, got %+v", left)
	}
	groups, _ := s.GroupsFor(mapID)
	if len(groups) != 0 {
		t.Errorf("empty group survived: %+v", groups)
	}
	if nodeCount(t, s, mapID) != 3 {
		t.Error("dissolving a group must not touch its nodes")
	}
}

// A node belongs to one group per map: regrouping moves it rather than
// silently leaving it in two places.
func TestRegroupingMovesANodeOut(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := groupOfThree(t, as)

	first, err := as.CreateGroup(mapID, "First", "", ids)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := as.CreateGroup(mapID, "Second", "", ids[1:]); err != nil {
		t.Fatal(err)
	}

	groups, _ := s.GroupsFor(mapID)
	byID := map[string]Group{}
	for _, g := range groups {
		byID[g.ID] = g
	}
	if got := len(byID[first.ID].NodeIDs); got != 1 {
		t.Errorf("first group kept %d members, want 1", got)
	}
}

// TestUndoIsScopedPerActor is the collaboration guarantee: the facilitator
// pressing Ctrl-Z must never reverse what somebody just sent from a phone.
// Deleting a map used to be the one destructive operation with no way back.
// It takes the map's edges, placements and groups with it — but never the
// nodes, which may be transcluded onto other maps.
func TestUndoDeleteMapRestoresTheWholeView(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, err := as.CreateMap("Doomed", "a map about to go")
	if err != nil {
		t.Fatal(err)
	}
	q, _, err := as.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Ship on Fridays?", MapID: m.ID})
	if err != nil {
		t.Fatal(err)
	}
	idea, _, err := as.CreateNode(NewNodeInput{
		Type: ibis.Idea, Title: "Only before noon", MapID: m.ID,
		ParentID: q.ID, Relationship: ibis.RespondsTo,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := as.DeleteMap(m.ID); err != nil {
		t.Fatal(err)
	}
	if maps, _ := s.ListMaps(); len(maps) != 0 {
		t.Fatalf("map survived the delete: %+v", maps)
	}
	// The nodes themselves are still there, which is why deleting a map is
	// safe to offer at all.
	if _, err := s.GetNode(idea.ID, ""); err != nil {
		t.Errorf("deleting a map destroyed a node: %v", err)
	}

	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatalf("undo: %v", err)
	}

	maps, err := s.ListMaps()
	if err != nil || len(maps) != 1 || maps[0].ID != m.ID {
		t.Fatalf("map was not restored: %+v (%v)", maps, err)
	}
	g, err := s.Graph(m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 2 {
		t.Errorf("placements not restored: %d nodes on the map", len(g.Nodes))
	}
	if len(g.Edges) != 1 || g.Edges[0].Relationship != ibis.RespondsTo {
		t.Errorf("edges not restored: %+v", g.Edges)
	}
}

func TestRedoDeleteMap(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	m, err := as.CreateMap("Doomed", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := as.CreateNode(NewNodeInput{
		Type: ibis.Question, Title: "A question", MapID: m.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := as.DeleteMap(m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Redo(alice, ""); err != nil {
		t.Fatalf("redo: %v", err)
	}
	if maps, _ := s.ListMaps(); len(maps) != 0 {
		t.Errorf("redo did not delete the map again: %+v", maps)
	}
}

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

// --- bulk editing ----------------------------------------------------------

// mixedSelection builds three nodes with deliberately uneven tags and statuses,
// which is the normal case for a selection and the one a naive implementation
// gets wrong.
func mixedSelection(t *testing.T, as *Store) (mapID string, ids []string) {
	t.Helper()
	m, err := as.CreateMap("M", "")
	if err != nil {
		t.Fatal(err)
	}
	seed := []struct {
		title  string
		tags   []string
		status Status
	}{
		{"A", []string{"perf"}, StatusOpen},
		{"B", []string{"perf", "ops"}, StatusResolved},
		{"C", nil, StatusOpen},
	}
	for _, s := range seed {
		content := DefaultContent("test")
		content.Tags = s.tags
		content.Status = s.status
		n, _, err := as.CreateNode(NewNodeInput{
			Type: ibis.Idea, Title: s.title, MapID: m.ID, Content: &content,
		})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, n.ID)
	}
	return m.ID, ids
}

func tagsOf(t *testing.T, s *Store, id string) []string {
	t.Helper()
	n, err := s.GetNode(id, "")
	if err != nil {
		t.Fatal(err)
	}
	return n.Content.Tags
}

func hasTag(tags []string, want string) bool {
	for _, t := range tags {
		if t == want {
			return true
		}
	}
	return false
}

func TestBulkAddTagAppliesToEveryNode(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	if _, err := as.BulkUpdateNodes(ids, BulkOps{AddTags: []string{"cache"}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if !hasTag(tagsOf(t, s, id), "cache") {
			t.Errorf("node %s did not get the tag", id)
		}
	}
	// A node that already had #perf must not end up with it twice.
	if got := tagsOf(t, s, ids[0]); len(got) != 2 {
		t.Errorf("tags = %v, want exactly perf and cache", got)
	}
}

func TestBulkAddIsIdempotentForNodesThatAlreadyHaveIt(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	// #perf is on two of the three: adding it to the selection must promote
	// the third without disturbing the others.
	if _, err := as.BulkUpdateNodes(ids, BulkOps{AddTags: []string{"perf"}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		tags := tagsOf(t, s, id)
		if !hasTag(tags, "perf") {
			t.Errorf("node %s missing perf", id)
		}
		var count int
		for _, tag := range tags {
			if tag == "perf" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("node %s has perf %d times", id, count)
		}
	}
	if !hasTag(tagsOf(t, s, ids[1]), "ops") {
		t.Error("adding one tag removed another")
	}
}

func TestBulkRemoveTagOnlyTouchesThatTag(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	if _, err := as.BulkUpdateNodes(ids, BulkOps{RemoveTags: []string{"perf"}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if hasTag(tagsOf(t, s, id), "perf") {
			t.Errorf("node %s still has perf", id)
		}
	}
	// Removing a tag a node did not have is a no-op, and other tags survive.
	if !hasTag(tagsOf(t, s, ids[1]), "ops") {
		t.Error("removing perf also removed ops")
	}
}

func TestBulkStatusOverwritesMixedValues(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	// The selection starts mixed (two open, one resolved). Setting a status
	// has to land on all of them, not just the ones that differ.
	if _, err := as.BulkUpdateNodes(ids, BulkOps{Status: statusPtr(StatusParked)}); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		n, _ := s.GetNode(id, "")
		if n.Content.Status != StatusParked {
			t.Errorf("node %s status = %q, want parked", id, n.Content.Status)
		}
	}
}

// TestBulkEditIsASingleUndo is the property that makes bulk editing usable:
// the user did one thing, so one Ctrl-Z reverses it.
func TestBulkEditIsASingleUndo(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	mapID, ids := mixedSelection(t, as)

	depthBefore, _, _ := s.UndoDepth(alice, mapID)
	if _, err := as.BulkUpdateNodes(ids, BulkOps{
		AddTags: []string{"cache"}, Status: statusPtr(StatusResolved),
	}); err != nil {
		t.Fatal(err)
	}
	depthAfter, _, _ := s.UndoDepth(alice, "")
	if depthAfter != depthBefore+1 {
		t.Fatalf("a bulk edit of %d nodes added %d undo entries, want 1",
			len(ids), depthAfter-depthBefore)
	}

	entry, err := as.Undo(alice, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(entry.Label, "3") {
		t.Errorf("label = %q, should say how many nodes were affected", entry.Label)
	}

	// Every node is back to its own original state, not to a shared one.
	wantTags := [][]string{{"perf"}, {"ops", "perf"}, {}}
	wantStatus := []Status{StatusOpen, StatusResolved, StatusOpen}
	for i, id := range ids {
		n, _ := s.GetNode(id, "")
		if n.Content.Status != wantStatus[i] {
			t.Errorf("node %d status = %q, want %q", i, n.Content.Status, wantStatus[i])
		}
		if len(n.Content.Tags) != len(wantTags[i]) {
			t.Errorf("node %d tags = %v, want %v", i, n.Content.Tags, wantTags[i])
			continue
		}
		for _, want := range wantTags[i] {
			if !hasTag(n.Content.Tags, want) {
				t.Errorf("node %d lost tag %q (has %v)", i, want, n.Content.Tags)
			}
		}
	}
}

func TestBulkEditRedoReapplies(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	as.BulkUpdateNodes(ids, BulkOps{AddTags: []string{"cache"}})
	if _, err := as.Undo(alice, ""); err != nil {
		t.Fatal(err)
	}
	if hasTag(tagsOf(t, s, ids[2]), "cache") {
		t.Fatal("undo did not remove the tag")
	}
	if _, err := as.Redo(alice, ""); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if !hasTag(tagsOf(t, s, id), "cache") {
			t.Errorf("redo did not restore the tag on %s", id)
		}
	}
}

func TestBulkUpdateRejectsNonsense(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	if _, err := as.BulkUpdateNodes(nil, BulkOps{AddTags: []string{"x"}}); err == nil {
		t.Error("an empty selection should be refused")
	}
	if _, err := as.BulkUpdateNodes(ids, BulkOps{}); err == nil {
		t.Error("a no-op edit should be refused rather than writing an undo entry")
	}
	bad := Status("nonsense")
	if _, err := as.BulkUpdateNodes(ids, BulkOps{Status: &bad}); err == nil {
		t.Error("an unknown status should be refused")
	}
	// A refused edit must leave no journal entry behind.
	if depth, _, _ := s.UndoDepth(alice, ""); depth != len(ids) {
		t.Errorf("undo depth = %d, want %d (only the creates)", depth, len(ids))
	}
}

func TestBulkUpdateFailsAtomicallyOnAMissingNode(t *testing.T) {
	s := newTestStore(t)
	as := s.As(alice)
	_, ids := mixedSelection(t, as)

	_, err := as.BulkUpdateNodes(append(ids, "does_not_exist"), BulkOps{
		AddTags: []string{"cache"},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	// Nothing may have been written: a half-applied bulk edit is worse than
	// none, because the user cannot see which half took.
	for _, id := range ids {
		if hasTag(tagsOf(t, s, id), "cache") {
			t.Errorf("node %s was modified despite the failure", id)
		}
	}
}

func statusPtr(s Status) *Status { return &s }
