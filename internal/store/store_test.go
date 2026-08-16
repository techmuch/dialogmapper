package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// seedArgument builds Question ← Idea, the smallest useful IBIS fragment.
func seedArgument(t *testing.T, s *Store) (mapID, qID, ideaID string) {
	t.Helper()
	m, err := s.CreateMap("Test", "")
	if err != nil {
		t.Fatalf("create map: %v", err)
	}
	q, _, err := s.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Ship on Fridays?", MapID: m.ID})
	if err != nil {
		t.Fatalf("create question: %v", err)
	}
	idea, edge, err := s.CreateNode(NewNodeInput{
		Type: ibis.Idea, Title: "Stop shipping on Fridays", MapID: m.ID,
		ParentID: q.ID, Relationship: ibis.RespondsTo,
	})
	if err != nil {
		t.Fatalf("create idea: %v", err)
	}
	if edge == nil {
		t.Fatal("expected the connecting edge to be created in the same call")
	}
	return m.ID, q.ID, idea.ID
}

func TestCreateNodeAndEdgeAreAtomic(t *testing.T) {
	s := newTestStore(t)
	m, err := s.CreateMap("Test", "")
	if err != nil {
		t.Fatal(err)
	}
	q, _, err := s.CreateNode(NewNodeInput{Type: ibis.Question, Title: "Q", MapID: m.ID})
	if err != nil {
		t.Fatal(err)
	}

	// An illegal parent relationship must leave nothing behind: a stranded
	// node with no edge is worse than a clean failure.
	_, _, err = s.CreateNode(NewNodeInput{
		Type: ibis.Pro, Title: "Bad", MapID: m.ID,
		ParentID: q.ID, Relationship: ibis.Supports,
	})
	if err == nil {
		t.Fatal("Pro --supports--> Question should have been rejected")
	}

	g, err := s.Graph(m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 1 {
		t.Errorf("rollback failed: expected 1 node, got %d", len(g.Nodes))
	}
}

func TestEdgeRequiresBothNodesOnMap(t *testing.T) {
	s := newTestStore(t)
	mapID, qID, _ := seedArgument(t, s)

	other, err := s.CreateMap("Elsewhere", "")
	if err != nil {
		t.Fatal(err)
	}
	stranger, _, err := s.CreateNode(NewNodeInput{
		Type: ibis.Idea, Title: "Unrelated", MapID: other.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Edges are map-scoped. Linking to a node that is not on this map would
	// produce an edge the canvas can never render.
	_, err = s.CreateEdge(mapID, stranger.ID, qID, ibis.RespondsTo)
	if err == nil || !strings.Contains(err.Error(), "not on map") {
		t.Fatalf("expected a 'not on map' rejection, got %v", err)
	}
}

func TestCycleRejection(t *testing.T) {
	s := newTestStore(t)
	mapID, qID, ideaID := seedArgument(t, s)

	// idea --responds_to--> question already exists. The reverse would make
	// the argument tree circular and break every traversal in the exporter.
	_, err := s.CreateEdge(mapID, qID, ideaID, ibis.Questions)
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected a cycle rejection, got %v", err)
	}
}

func TestDuplicateEdgeIsConflict(t *testing.T) {
	s := newTestStore(t)
	mapID, qID, ideaID := seedArgument(t, s)

	_, err := s.CreateEdge(mapID, ideaID, qID, ibis.RespondsTo)
	var ce *ConflictError
	if !errors.As(err, &ce) {
		t.Fatalf("expected a ConflictError for a duplicate edge, got %v", err)
	}
}

// Transclusion is the feature most likely to lose data if implemented as a
// copy, so these tests check identity rather than equality.
func TestTransclusionSharesOneNode(t *testing.T) {
	s := newTestStore(t)
	mapA, _, ideaID := seedArgument(t, s)

	mapB, err := s.CreateMap("Second map", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Transclude(mapB.ID, ideaID, nil, nil); err != nil {
		t.Fatal(err)
	}

	node, err := s.GetNode(ideaID, mapB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if node.MapCount != 2 {
		t.Errorf("MapCount = %d; want 2 (this drives the shared badge)", node.MapCount)
	}

	// Editing through one map must be visible from the other: same node, not
	// a copy.
	if _, err := s.UpdateNode(ideaID, NodePatch{Title: ptr("Edited once")}); err != nil {
		t.Fatal(err)
	}
	fromA, err := s.GetNode(ideaID, mapA)
	if err != nil {
		t.Fatal(err)
	}
	if fromA.Title != "Edited once" {
		t.Errorf("edit did not propagate: got %q", fromA.Title)
	}

	// Removing from one map must not destroy the shared node.
	if err := s.RemoveFromMap(mapA, ideaID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetNode(ideaID, mapB.ID); err != nil {
		t.Fatalf("node should survive removal from one map: %v", err)
	}
}

func TestRetypeRejectedWhenItWouldBreakAnEdge(t *testing.T) {
	s := newTestStore(t)
	_, _, ideaID := seedArgument(t, s)

	// The Idea answers a Question. Turning it into a Pro would leave a
	// "Pro responds_to Question" edge, which the grammar forbids.
	_, err := s.UpdateNode(ideaID, NodePatch{Type: typePtr(ibis.Pro)})
	if err == nil {
		t.Fatal("retyping an Idea with a responds_to edge into a Pro should fail")
	}
	if !strings.Contains(err.Error(), "existing edge") {
		t.Errorf("error should name the real problem, got: %v", err)
	}
}

func TestPlacementIsPerMap(t *testing.T) {
	s := newTestStore(t)
	mapA, _, ideaID := seedArgument(t, s)
	mapB, err := s.CreateMap("B", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Transclude(mapB.ID, ideaID, f(10), f(20)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPlacement(mapA, ideaID, f(500), f(600), nil, nil); err != nil {
		t.Fatal(err)
	}

	a, _ := s.GetNode(ideaID, mapA)
	b, _ := s.GetNode(ideaID, mapB.ID)
	if a.Placement == nil || *a.Placement.X != 500 {
		t.Errorf("map A placement wrong: %+v", a.Placement)
	}
	if b.Placement == nil || *b.Placement.X != 10 {
		t.Errorf("moving a node on one map must not move it on another: %+v", b.Placement)
	}
}

func TestSearchExcludesCurrentMap(t *testing.T) {
	s := newTestStore(t)
	mapA, _, _ := seedArgument(t, s)

	// "Insert existing node" only ever wants nodes not already on screen.
	found, err := s.SearchNodes("Fridays", mapA, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 0 {
		t.Errorf("nodes already on this map should be excluded, got %d", len(found))
	}
	found, err = s.SearchNodes("Fridays", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) == 0 {
		t.Error("expected an unscoped search to find the node")
	}
}

func TestExportMarkdownFollowsArgumentStructure(t *testing.T) {
	s := newTestStore(t)
	mapID, _, ideaID := seedArgument(t, s)
	if _, _, err := s.CreateNode(NewNodeInput{
		Type: ibis.Pro, Title: "Fewer weekend pages", MapID: mapID,
		ParentID: ideaID, Relationship: ibis.Supports,
	}); err != nil {
		t.Fatal(err)
	}

	g, err := s.Graph(mapID)
	if err != nil {
		t.Fatal(err)
	}
	md := g.ExportMarkdown()

	qLine := strings.Index(md, "[?] **Ship on Fridays?**")
	iLine := strings.Index(md, "[!] **Stop shipping on Fridays**")
	pLine := strings.Index(md, "[+] **Fewer weekend pages**")
	if qLine < 0 || iLine < 0 || pLine < 0 {
		t.Fatalf("export is missing nodes:\n%s", md)
	}
	if !(qLine < iLine && iLine < pLine) {
		t.Errorf("export should nest question > idea > pro:\n%s", md)
	}
	if strings.Count(md, "[+] **Fewer weekend pages**") != 1 {
		t.Errorf("node emitted more than once:\n%s", md)
	}
}

func TestExportJSONLDIncludesGrammar(t *testing.T) {
	s := newTestStore(t)
	mapID, _, _ := seedArgument(t, s)
	g, err := s.Graph(mapID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := g.ExportJSONLD()
	if err != nil {
		t.Fatal(err)
	}
	// A consumer should not have to guess what the relationship names mean.
	for _, want := range []string{"@context", "grammar", "responds_to", "hierarchical"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("JSON-LD export missing %q", want)
		}
	}
}

func TestNewIDIsSortableAndUnique(t *testing.T) {
	seen := map[string]bool{}
	var prev string
	for i := 0; i < 2000; i++ {
		id := NewID("n")
		if seen[id] {
			t.Fatalf("duplicate id after %d draws: %s", i, id)
		}
		seen[id] = true
		// Timestamp-prefixed ids must not go backwards, or chronological
		// ordering by id silently breaks.
		if prev != "" && id < prev {
			t.Fatalf("ids are not monotonic: %s then %s", prev, id)
		}
		prev = id
	}
}

func ptr(s string) *string                   { return &s }
func typePtr(t ibis.NodeType) *ibis.NodeType { return &t }
func f(v float64) *float64                   { return &v }
