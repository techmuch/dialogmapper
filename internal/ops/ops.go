// Package ops is the mutation contract shared by every non-browser door into a
// map: `dialogmapper apply`, and the granular `map`/`node`/`edge` commands.
//
// It exists because there used to be exactly one validated way to change a map
// — the HTTP API — and it required a running server. Anyone working offline, in
// a script, or as an AI agent had no option but raw SQL against maps.db, which
// silently skips three things the tool depends on:
//
//   - the IBIS grammar, which lives in Go and rejects illegal moves;
//   - the JSON shape of nodes.content, where a plain string in place of a
//     {url,title} link is enough to break the UI;
//   - the undo journal, so nothing an agent did could be reversed.
//
// Every operation here goes through the same store methods the HTTP handlers
// call, so all three come for free and cannot drift between the two doors.
package ops

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/techmuch/dialogmapper/internal/ibis"
	"github.com/techmuch/dialogmapper/internal/store"
)

// Kind names an operation. Kept as strings rather than an enum so a JSON
// payload is readable and a bad value produces a helpful error.
const (
	CreateMap  = "create_map"
	DeleteMap  = "delete_map"
	CreateNode = "create_node"
	UpdateNode = "update_node"
	DeleteNode = "delete_node"
	RemoveNode = "remove_node"
	CreateEdge = "create_edge"
	DeleteEdge = "delete_edge"
)

// Kinds is every operation, in the order the schema lists them.
var Kinds = []string{
	CreateMap, DeleteMap, CreateNode, UpdateNode,
	DeleteNode, RemoveNode, CreateEdge, DeleteEdge,
}

// Op is one mutation.
//
// Optional scalars are pointers so that "not mentioned" and "set to empty" stay
// distinguishable: clearing a node's body is a different request from leaving
// it alone, and an update that could not tell them apart would wipe fields the
// caller never named.
type Op struct {
	Op string `json:"op"`

	// ID identifies the node, edge or map an operation acts on.
	ID string `json:"id,omitempty"`
	// Map is a map name or id. Names are what a person or an agent knows.
	Map string `json:"map,omitempty"`

	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`

	Type   *string       `json:"type,omitempty"`
	Title  *string       `json:"title,omitempty"`
	Body   *string       `json:"body,omitempty"`
	Tags   *[]string     `json:"tags,omitempty"`
	Links  *[]store.Link `json:"links,omitempty"`
	Status *string       `json:"status,omitempty"`

	// Parent and Rel attach a new node to an existing one in the same
	// transaction, exactly as the canvas capture loop does.
	Parent string `json:"parent,omitempty"`
	Rel    string `json:"rel,omitempty"`

	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

// Result records what one operation did.
type Result struct {
	Op    string `json:"op"`
	ID    string `json:"id,omitempty"`
	Label string `json:"label,omitempty"`
}

// Report is the machine-readable outcome of a batch.
type Report struct {
	Applied int `json:"applied"`
	Total   int `json:"total"`
	// Reversible counts the operations the undo journal can take back. Creating
	// a map is the one that cannot be — see store.CreateMap — so an undo hint
	// derived from Applied would walk past it and reverse something the batch
	// never did.
	Reversible int      `json:"reversible"`
	Results    []Result `json:"results"`
	// Error and FailedAt describe the operation that stopped the run. Earlier
	// operations have already been committed; UndoHint says how to reverse
	// them, because a half-applied batch the caller cannot back out of is
	// worse than either outcome.
	Error     string `json:"error,omitempty"`
	FailedAt  *int   `json:"failedAt,omitempty"`
	UndoHint  string `json:"undoHint,omitempty"`
	DryRun    bool   `json:"dryRun,omitempty"`
	Validated bool   `json:"validated,omitempty"`
}

// Parse reads an op list. A bare object is accepted as a batch of one, since
// that is the obvious thing to try.
func Parse(data []byte) ([]Op, error) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return nil, fmt.Errorf("no input: pipe a JSON array of operations to stdin")
	}
	if strings.HasPrefix(trimmed, "{") {
		var single Op
		if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
			return nil, err
		}
		return []Op{single}, nil
	}
	var list []Op
	if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
		return nil, err
	}
	return list, nil
}

// Executor applies operations against a store.
type Executor struct {
	Store *store.Store
	// maps caches name -> id lookups so a batch referring to one map by name
	// does not re-query for every operation.
	maps map[string]string
}

func New(s *store.Store) *Executor {
	return &Executor{Store: s, maps: map[string]string{}}
}

// Apply runs the batch.
//
// Operations are applied in order and the run stops at the first failure.
// This is not one transaction: each store method opens its own, which is what
// makes each individually journaled and undoable. Validate runs first so that
// the common mistakes — an unknown map, a bad node type, an illegal
// relationship — are caught before anything is written at all.
func (e *Executor) Apply(list []Op, dryRun bool) Report {
	rep := Report{Total: len(list)}

	if err := e.Validate(list); err != nil {
		rep.Error = err.Error()
		return rep
	}
	rep.Validated = true
	if dryRun {
		rep.DryRun = true
		return rep
	}

	for i, op := range list {
		res, err := e.one(op)
		if err != nil {
			idx := i
			rep.Error = fmt.Sprintf("operation %d (%s): %v", i, op.Op, err)
			rep.FailedAt = &idx
			rep.UndoHint = undoHint(rep.Reversible)
			return rep
		}
		rep.Results = append(rep.Results, res)
		rep.Applied++
		if reversible(op.Op) {
			rep.Reversible++
		}
	}
	rep.UndoHint = undoHint(rep.Reversible)
	return rep
}

// reversible reports whether the undo journal records this operation.
func reversible(kind string) bool { return kind != CreateMap }

func undoHint(n int) string {
	if n == 0 {
		return ""
	}
	if n == 1 {
		return "dialogmapper undo"
	}
	return fmt.Sprintf("dialogmapper undo --steps %d", n)
}

// Validate checks what can be checked without writing: known operations,
// required fields, known enum values, and that referenced maps exist.
//
// It cannot catch everything — whether a specific edge is legal depends on the
// types of both endpoints, which the store checks when it writes — but it turns
// the most common mistakes into a clean refusal instead of a partial batch.
func (e *Executor) Validate(list []Op) error {
	if len(list) == 0 {
		return fmt.Errorf("no operations")
	}
	for i, op := range list {
		if err := e.validateOne(op); err != nil {
			return fmt.Errorf("operation %d (%s): %w", i, op.Op, err)
		}
	}
	return nil
}

func (e *Executor) validateOne(op Op) error {
	switch op.Op {
	case "":
		return fmt.Errorf("missing %q; expected one of %s", "op", strings.Join(Kinds, ", "))

	case CreateMap:
		if op.Name == "" {
			return fmt.Errorf("needs a name")
		}

	case DeleteMap:
		_, err := e.mapID(op.Map)
		return err

	case CreateNode:
		if op.Title == nil || strings.TrimSpace(*op.Title) == "" {
			return fmt.Errorf("needs a title")
		}
		if op.Type == nil {
			return fmt.Errorf("needs a type: %s", nodeTypeList())
		}
		if err := checkNodeType(*op.Type); err != nil {
			return err
		}
		if op.Status != nil {
			if err := checkStatus(*op.Status); err != nil {
				return err
			}
		}
		if op.Rel != "" {
			if err := checkRel(op.Rel); err != nil {
				return err
			}
			if op.Parent == "" {
				return fmt.Errorf("%q given with no parent to attach to", op.Rel)
			}
		}
		if _, err := e.mapID(op.Map); err != nil {
			return err
		}

	case UpdateNode:
		if op.ID == "" {
			return fmt.Errorf("needs an id")
		}
		if op.Type != nil {
			if err := checkNodeType(*op.Type); err != nil {
				return err
			}
		}
		if op.Status != nil {
			if err := checkStatus(*op.Status); err != nil {
				return err
			}
		}

	case DeleteNode, DeleteEdge:
		if op.ID == "" {
			return fmt.Errorf("needs an id")
		}

	case RemoveNode:
		if op.ID == "" {
			return fmt.Errorf("needs an id")
		}
		if _, err := e.mapID(op.Map); err != nil {
			return err
		}

	case CreateEdge:
		if op.From == "" || op.To == "" {
			return fmt.Errorf("needs from and to")
		}
		if op.Rel != "" {
			if err := checkRel(op.Rel); err != nil {
				return err
			}
		}
		if _, err := e.mapID(op.Map); err != nil {
			return err
		}

	default:
		return fmt.Errorf("unknown operation; expected one of %s", strings.Join(Kinds, ", "))
	}
	return nil
}

func (e *Executor) one(op Op) (Result, error) {
	switch op.Op {
	case CreateMap:
		m, err := e.Store.CreateMap(op.Name, op.Description)
		if err != nil {
			return Result{}, err
		}
		e.maps[strings.ToLower(m.Name)] = m.ID
		return Result{Op: op.Op, ID: m.ID, Label: m.Name}, nil

	case DeleteMap:
		id, err := e.mapID(op.Map)
		if err != nil {
			return Result{}, err
		}
		if err := e.Store.DeleteMap(id); err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: id, Label: op.Map}, nil

	case CreateNode:
		id, err := e.mapID(op.Map)
		if err != nil {
			return Result{}, err
		}
		content := store.NodeContent{
			Status: store.StatusOpen,
			Tags:   []string{},
			Assets: []store.Asset{},
			Links:  []store.Link{},
			Source: "cli",
		}
		if op.Body != nil {
			content.Markdown = *op.Body
		}
		if op.Tags != nil {
			content.Tags = *op.Tags
		}
		if op.Links != nil {
			content.Links = *op.Links
		}
		if op.Status != nil {
			content.Status = store.Status(*op.Status)
		}
		node, _, err := e.Store.CreateNode(store.NewNodeInput{
			Type:         ibis.NodeType(*op.Type),
			Title:        *op.Title,
			Content:      &content,
			MapID:        id,
			ParentID:     op.Parent,
			Relationship: ibis.Relationship(op.Rel),
			Source:       "cli",
		})
		if err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: node.ID, Label: node.Title}, nil

	case UpdateNode:
		patch := store.NodePatch{Title: op.Title, Markdown: op.Body, Tags: op.Tags, Links: op.Links}
		if op.Type != nil {
			t := ibis.NodeType(*op.Type)
			patch.Type = &t
		}
		if op.Status != nil {
			st := store.Status(*op.Status)
			patch.Status = &st
		}
		node, err := e.Store.UpdateNode(op.ID, patch)
		if err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: node.ID, Label: node.Title}, nil

	case DeleteNode:
		if err := e.Store.DeleteNode(op.ID); err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: op.ID}, nil

	case RemoveNode:
		id, err := e.mapID(op.Map)
		if err != nil {
			return Result{}, err
		}
		if err := e.Store.RemoveFromMap(id, op.ID); err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: op.ID, Label: op.Map}, nil

	case CreateEdge:
		id, err := e.mapID(op.Map)
		if err != nil {
			return Result{}, err
		}
		edge, err := e.Store.CreateEdge(id, op.From, op.To, ibis.Relationship(op.Rel))
		if err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: edge.ID, Label: string(edge.Relationship)}, nil

	case DeleteEdge:
		if err := e.Store.DeleteEdge(op.ID); err != nil {
			return Result{}, err
		}
		return Result{Op: op.Op, ID: op.ID}, nil
	}
	return Result{}, fmt.Errorf("unknown operation %q", op.Op)
}

// MapID resolves a map name or id, exported so a command can resolve a
// reference before building a batch that repeats it.
func (e *Executor) MapID(ref string) (string, error) { return e.mapID(ref) }

// mapID resolves a map name or id. An empty reference means the only map when
// there is exactly one, which is the common case and saves every command
// needing --map.
func (e *Executor) mapID(ref string) (string, error) {
	if id, ok := e.maps[strings.ToLower(ref)]; ok {
		return id, nil
	}
	maps, err := e.Store.ListMaps()
	if err != nil {
		return "", err
	}
	if ref == "" {
		switch len(maps) {
		case 0:
			return "", fmt.Errorf("this project has no maps yet")
		case 1:
			return maps[0].ID, nil
		default:
			return "", fmt.Errorf("several maps exist; name one with \"map\"")
		}
	}
	var matches []store.Map
	for _, m := range maps {
		if m.ID == ref {
			return m.ID, nil
		}
		if strings.EqualFold(m.Name, ref) {
			matches = append(matches, m)
		}
	}
	switch len(matches) {
	case 1:
		e.maps[strings.ToLower(ref)] = matches[0].ID
		return matches[0].ID, nil
	case 0:
		names := make([]string, 0, len(maps))
		for _, m := range maps {
			names = append(names, m.Name)
		}
		return "", fmt.Errorf("no map named %q; this project has: %s",
			ref, strings.Join(names, ", "))
	default:
		return "", fmt.Errorf("%d maps are named %q; use the id instead", len(matches), ref)
	}
}

func checkNodeType(t string) error {
	for _, known := range ibis.NodeTypes {
		if string(known) == t {
			return nil
		}
	}
	return fmt.Errorf("unknown node type %q; expected one of %s", t, nodeTypeList())
}

func checkStatus(s string) error {
	for _, known := range []store.Status{
		store.StatusOpen, store.StatusResolved, store.StatusRejected, store.StatusParked,
	} {
		if string(known) == s {
			return nil
		}
	}
	return fmt.Errorf("unknown status %q; expected open, resolved, rejected or parked", s)
}

func checkRel(r string) error {
	for _, known := range ibis.Relationships {
		if string(known) == r {
			return nil
		}
	}
	rels := make([]string, 0, len(ibis.Relationships))
	for _, k := range ibis.Relationships {
		rels = append(rels, string(k))
	}
	return fmt.Errorf("unknown relationship %q; expected one of %s", r, strings.Join(rels, ", "))
}

func nodeTypeList() string {
	out := make([]string, 0, len(ibis.NodeTypes))
	for _, t := range ibis.NodeTypes {
		out = append(out, string(t))
	}
	return strings.Join(out, ", ")
}
