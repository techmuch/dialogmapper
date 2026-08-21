package ops

import (
	"strings"
	"testing"

	"github.com/techmuch/dialogmapper/internal/ibis"
	"github.com/techmuch/dialogmapper/internal/store"
)

// These are the guarantees that make `apply` worth having over raw SQL: the
// grammar is enforced, the content JSON keeps its shape, and everything lands
// in the undo journal.

func newStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s.As(store.CLIActor)
}

func str(s string) *string { return &s }

// seeded returns an executor over a project with one map holding a Question.
func seeded(t *testing.T) (*Executor, *store.Store, string) {
	t.Helper()
	s := newStore(t)
	m, err := s.CreateMap("Caching", "")
	if err != nil {
		t.Fatal(err)
	}
	q, _, err := s.CreateNode(store.NewNodeInput{
		Type: ibis.Question, Title: "Should we cache reads?", MapID: m.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return New(s), s, q.ID
}

func TestCreateNodeAttachesToItsParent(t *testing.T) {
	ex, s, q := seeded(t)
	rep := ex.Apply([]Op{{
		Op: CreateNode, Map: "Caching", Type: str("idea"),
		Title: str("Add a read-through cache"), Parent: q, Rel: "responds_to",
	}}, false)
	if rep.Error != "" {
		t.Fatalf("apply: %s", rep.Error)
	}
	maps, _ := s.ListMaps()
	g, err := s.Graph(maps[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Edges) != 1 || g.Edges[0].Relationship != ibis.RespondsTo {
		t.Errorf("edge not created: %+v", g.Edges)
	}
}

// The IBIS grammar is the thing raw SQL skipped entirely.
func TestIllegalEdgeIsRefused(t *testing.T) {
	ex, s, q := seeded(t)
	rep := ex.Apply([]Op{{
		Op: CreateNode, Map: "Caching", Type: str("pro"),
		Title: str("Illegal"), Parent: q, Rel: "supports",
	}}, false)
	if rep.Error == "" {
		t.Fatal("a Pro cannot support a Question; this should have been refused")
	}
	// And the refusal explains what would have been legal.
	if !strings.Contains(rep.Error, "try:") {
		t.Errorf("refusal offers no alternative: %s", rep.Error)
	}
	maps, _ := s.ListMaps()
	if g, _ := s.Graph(maps[0].ID); len(g.Nodes) != 1 {
		t.Errorf("a refused operation left something behind: %d nodes", len(g.Nodes))
	}
}

// Links are objects, not strings. A bare string here is what broke the UI when
// nodes were written by hand.
func TestLinksKeepTheirShape(t *testing.T) {
	ex, s, _ := seeded(t)
	rep := ex.Apply([]Op{{
		Op: CreateNode, Map: "Caching", Type: str("note"), Title: str("Ref: Howard (1966)"),
		Links: &[]store.Link{{URL: "https://doi.org/10.1109/TSSC.1966.300074", Title: "Howard"}},
	}}, false)
	if rep.Error != "" {
		t.Fatal(rep.Error)
	}
	n, err := s.GetNode(rep.Results[0].ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(n.Content.Links) != 1 || n.Content.Links[0].Title != "Howard" {
		t.Errorf("links = %+v", n.Content.Links)
	}
}

func TestEverythingIsJournaled(t *testing.T) {
	ex, s, q := seeded(t)
	rep := ex.Apply([]Op{
		{Op: CreateNode, Map: "Caching", Type: str("idea"), Title: str("An idea"), Parent: q, Rel: "responds_to"},
		{Op: UpdateNode, ID: q, Status: str("resolved")},
	}, false)
	if rep.Error != "" {
		t.Fatal(rep.Error)
	}
	if rep.Reversible != 2 {
		t.Errorf("reversible = %d, want 2", rep.Reversible)
	}
	// Undo really reverses it, rather than the count being decorative.
	if _, err := s.Undo(store.CLIActor, ""); err != nil {
		t.Fatalf("undo: %v", err)
	}
	back, _ := s.GetNode(q, "")
	if back.Content.Status != store.StatusOpen {
		t.Errorf("status = %q after undo, want open", back.Content.Status)
	}
}

// Creating a map is the one operation the journal cannot take back, so the
// hint must not count it — otherwise `undo --steps n` would reverse something
// the batch never did.
func TestUndoHintCountsOnlyReversibleOperations(t *testing.T) {
	ex, _, _ := seeded(t)
	rep := ex.Apply([]Op{
		{Op: CreateMap, Name: "Scratchpad"},
		{Op: CreateNode, Map: "Caching", Type: str("note"), Title: str("A note")},
	}, false)
	if rep.Error != "" {
		t.Fatal(rep.Error)
	}
	if rep.Applied != 2 {
		t.Fatalf("applied = %d", rep.Applied)
	}
	if rep.Reversible != 1 {
		t.Errorf("reversible = %d, want 1 — creating a map is not journaled", rep.Reversible)
	}
	if rep.UndoHint != "dialogmapper undo" {
		t.Errorf("hint = %q, should reverse one operation, not two", rep.UndoHint)
	}
}

func TestValidationRunsBeforeAnythingIsWritten(t *testing.T) {
	ex, s, _ := seeded(t)
	// The second operation is nonsense; the first must not be applied either.
	rep := ex.Apply([]Op{
		{Op: CreateNode, Map: "Caching", Type: str("note"), Title: str("Would have been fine")},
		{Op: CreateNode, Map: "Caching", Type: str("banana"), Title: str("Nope")},
	}, false)
	if rep.Error == "" {
		t.Fatal("expected a refusal")
	}
	if rep.Applied != 0 {
		t.Errorf("applied = %d; validation should have stopped the batch first", rep.Applied)
	}
	maps, _ := s.ListMaps()
	if g, _ := s.Graph(maps[0].ID); len(g.Nodes) != 1 {
		t.Errorf("the batch wrote something despite failing validation: %d nodes", len(g.Nodes))
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	ex, s, _ := seeded(t)
	rep := ex.Apply([]Op{
		{Op: CreateNode, Map: "Caching", Type: str("note"), Title: str("A note")},
	}, true)
	if rep.Error != "" || !rep.DryRun || !rep.Validated {
		t.Fatalf("dry run report = %+v", rep)
	}
	maps, _ := s.ListMaps()
	if g, _ := s.Graph(maps[0].ID); len(g.Nodes) != 1 {
		t.Errorf("a dry run wrote something: %d nodes", len(g.Nodes))
	}
}

// A batch is not one transaction, so a mid-batch failure has to say plainly
// what was applied and how to reverse it.
func TestPartialBatchReportsHowToBackOut(t *testing.T) {
	ex, _, q := seeded(t)
	rep := ex.Apply([]Op{
		{Op: CreateNode, Map: "Caching", Type: str("idea"), Title: str("Fine"), Parent: q, Rel: "responds_to"},
		{Op: UpdateNode, ID: "node_does_not_exist", Title: str("nope")},
	}, false)
	if rep.Error == "" {
		t.Fatal("expected the second operation to fail")
	}
	if rep.Applied != 1 || rep.FailedAt == nil || *rep.FailedAt != 1 {
		t.Errorf("report = %+v", rep)
	}
	if rep.UndoHint != "dialogmapper undo" {
		t.Errorf("hint = %q, should reverse the one operation that landed", rep.UndoHint)
	}
}

func TestMapsResolveByNameOrID(t *testing.T) {
	ex, s, _ := seeded(t)
	maps, _ := s.ListMaps()

	for _, ref := range []string{"Caching", "caching", maps[0].ID} {
		if got, err := ex.MapID(ref); err != nil || got != maps[0].ID {
			t.Errorf("MapID(%q) = %q, %v", ref, got, err)
		}
	}
	// A single map means --map can be left off entirely.
	if got, err := ex.MapID(""); err != nil || got != maps[0].ID {
		t.Errorf("an omitted map should resolve to the only one: %q, %v", got, err)
	}
	// An unknown name lists what does exist, rather than just failing.
	_, err := ex.MapID("Nope")
	if err == nil || !strings.Contains(err.Error(), "Caching") {
		t.Errorf("error should list the available maps, got %v", err)
	}
}

func TestAmbiguousMapIsRefused(t *testing.T) {
	ex, s, _ := seeded(t)
	if _, err := s.CreateMap("Other", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.MapID(""); err == nil {
		t.Error("with two maps, an omitted reference should be refused rather than guessed")
	}
}

func TestParseAcceptsASingleObject(t *testing.T) {
	// The obvious thing to try when writing one operation by hand.
	list, err := Parse([]byte(`{"op":"create_map","name":"Solo"}`))
	if err != nil || len(list) != 1 || list[0].Name != "Solo" {
		t.Fatalf("list = %+v, err = %v", list, err)
	}
	if _, err := Parse([]byte("   ")); err == nil {
		t.Error("empty input should explain what was expected")
	}
}

func TestSchemaNamesEveryOperation(t *testing.T) {
	// The schema is how an agent discovers the contract, so it has to stay in
	// step with the code rather than being prose that drifts.
	schema := Schema()
	listed, ok := schema["ops"].([]map[string]any)
	if !ok || len(listed) != len(Kinds) {
		t.Fatalf("schema lists %d ops, code has %d", len(listed), len(Kinds))
	}
	for i, k := range Kinds {
		if listed[i]["op"] != k {
			t.Errorf("schema[%d] = %v, want %s", i, listed[i]["op"], k)
		}
	}
}
