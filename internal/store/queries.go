package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

// --- maps ------------------------------------------------------------------

// CreateMap inserts a new, empty map.
func (s *Store) CreateMap(name, description string) (*Map, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("map name is required")
	}
	m := &Map{
		ID: NewID("map"), Name: name, Description: description,
		CreatedAt: nowISO(), UpdatedAt: nowISO(),
	}
	// Deliberately not journaled, unlike every other mutation.
	//
	// Undoing a map creation would delete the map, and `undo_log.map_id` is
	// `REFERENCES maps ON DELETE CASCADE` — so that delete would cascade and
	// wipe the journal entries for everything the map contains, silently
	// destroying the redo chain for work that had nothing to do with the map
	// row. Creating a map is cheap to repeat; losing the history inside it is
	// not. `dialogmapper apply` reports how many of its operations are
	// reversible so the undo hint it prints stays true.
	if _, err := s.db.Exec(
		`INSERT INTO maps (id, name, description, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		m.ID, m.Name, m.Description, m.CreatedAt, m.UpdatedAt); err != nil {
		return nil, fmt.Errorf("create map: %w", err)
	}
	return m, nil
}

// ListMaps returns every map, most recently active first.
func (s *Store) ListMaps() ([]Map, error) {
	rows, err := s.db.Query(
		`SELECT m.id, m.name, m.description, m.created_at, m.updated_at,
		        (SELECT count(*) FROM map_nodes mn WHERE mn.map_id = m.id)
		 FROM maps m
		 ORDER BY m.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Map{}
	for rows.Next() {
		var m Map
		if err := rows.Scan(&m.ID, &m.Name, &m.Description,
			&m.CreatedAt, &m.UpdatedAt, &m.NodeCount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetMap loads one map by id.
func (s *Store) GetMap(id string) (*Map, error) {
	var m Map
	err := s.db.QueryRow(
		`SELECT id, name, description, created_at, updated_at
		 FROM maps WHERE id = ?`, id).
		Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("map %s: %w", id, ErrNotFound)
	}
	return &m, err
}

// DefaultMap returns the most recently updated map, creating one if the
// project is empty. Every entry point needs somewhere to write to.
func (s *Store) DefaultMap() (*Map, error) {
	maps, err := s.listMapsLimit1()
	if err != nil {
		return nil, err
	}
	if maps != nil {
		return maps, nil
	}
	return s.CreateMap("Untitled Map", "")
}

func (s *Store) listMapsLimit1() (*Map, error) {
	var m Map
	err := s.db.QueryRow(
		`SELECT id, name, description, created_at, updated_at
		 FROM maps ORDER BY updated_at DESC LIMIT 1`).
		Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// RenameMap updates a map's name and description.
func (s *Store) RenameMap(id, name, description string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	res, err := s.db.Exec(
		`UPDATE maps SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		name, description, nowISO(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("map %s: %w", id, ErrNotFound)
	}
	return nil
}

// DeleteMap removes a map and its edges/placements. Nodes survive: they may be
// transcluded elsewhere, and destroying shared thinking as a side effect of
// deleting one view would be a data-loss bug.
// It is journaled, so `dialogmapper undo` — and Ctrl+Z in the browser — brings
// the map back with its edges, placements and groups. Deleting a whole view of
// a conversation is exactly the kind of thing someone does by accident and
// needs back, and it is the one destructive operation that used to be final.
func (s *Store) DeleteMap(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	snap, name, err := snapshotMapTx(tx, id)
	if err != nil {
		return err
	}
	// Recorded against no map at all, deliberately. `undo_log.map_id` is
	// `REFERENCES maps ON DELETE CASCADE`, so scoping this entry to the map it
	// describes would have SQLite delete the journal entry along with the map
	// — the one record needed to bring it back. A null map scopes the entry
	// globally, which is also right for the user: after deleting a map there
	// is no map to be "in".
	if err := recordTx(tx, "", s.actor, ActionDeleteMap,
		fmt.Sprintf("delete map %q", name), snap, snap); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM maps WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// snapshotMapTx captures everything a map delete destroys. Nodes are excluded
// on purpose: DeleteMap leaves them alone.
func snapshotMapTx(tx *sql.Tx, mapID string) (snapshot, string, error) {
	var snap snapshot

	var m Map
	if err := tx.QueryRow(
		`SELECT id, name, description, created_at, updated_at FROM maps WHERE id = ?`,
		mapID).Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return snap, "", fmt.Errorf("no map with id %q", mapID)
		}
		return snap, "", err
	}
	snap.Maps = []Map{m}

	groups, err := tx.Query(
		`SELECT id, map_id, title, color, created_at FROM groups WHERE map_id = ?`, mapID)
	if err != nil {
		return snap, m.Name, err
	}
	for groups.Next() {
		var g Group
		if err := groups.Scan(&g.ID, &g.MapID, &g.Title, &g.Color, &g.CreatedAt); err != nil {
			groups.Close()
			return snap, m.Name, err
		}
		snap.Groups = append(snap.Groups, g)
	}
	groups.Close()
	if err := groups.Err(); err != nil {
		return snap, m.Name, err
	}

	places, err := tx.Query(
		`SELECT map_id, node_id, x, y, collapsed, group_id, added_at
		 FROM map_nodes WHERE map_id = ?`, mapID)
	if err != nil {
		return snap, m.Name, err
	}
	for places.Next() {
		var p placement
		var group sql.NullString
		if err := places.Scan(&p.MapID, &p.NodeID, &p.X, &p.Y, &p.Collapsed,
			&group, &p.AddedAt); err != nil {
			places.Close()
			return snap, m.Name, err
		}
		if group.Valid {
			p.GroupID = &group.String
		}
		snap.Placements = append(snap.Placements, p)
	}
	places.Close()
	if err := places.Err(); err != nil {
		return snap, m.Name, err
	}

	edges, err := tx.Query(
		`SELECT id, map_id, source_node_id, target_node_id, relationship_type, created_at
		 FROM edges WHERE map_id = ?`, mapID)
	if err != nil {
		return snap, m.Name, err
	}
	for edges.Next() {
		var e Edge
		if err := edges.Scan(&e.ID, &e.MapID, &e.SourceNodeID, &e.TargetNodeID,
			&e.Relationship, &e.CreatedAt); err != nil {
			edges.Close()
			return snap, m.Name, err
		}
		snap.Edges = append(snap.Edges, e)
	}
	edges.Close()
	return snap, m.Name, edges.Err()
}

// --- nodes -----------------------------------------------------------------

// CreateNode writes a node and, in the same transaction, places it on a map
// and links it to a parent. Doing all three atomically is what lets the
// keyboard capture loop stay at one round trip per keystroke.
func (s *Store) CreateNode(in NewNodeInput) (*Node, *Edge, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if !ibis.IsValidNodeType(in.Type) {
		return nil, nil, fmt.Errorf("unknown node type %q", in.Type)
	}
	if strings.TrimSpace(in.Title) == "" {
		in.Title = untitledFor(in.Type)
	}
	content := DefaultContent(orDefault(in.Source, "ui"))
	if in.Content != nil {
		content = *in.Content
		if content.Source == "" {
			content.Source = orDefault(in.Source, "ui")
		}
	}
	payload, err := content.marshal()
	if err != nil {
		return nil, nil, fmt.Errorf("encode content: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	if in.MapID == "" {
		return nil, nil, errors.New("mapId is required")
	}

	now := nowISO()
	n := &Node{
		ID: NewID(string(in.Type)), Type: in.Type, Title: strings.TrimSpace(in.Title),
		Content: content, CreatedAt: now, UpdatedAt: now, MapCount: 1,
	}
	if _, err := tx.Exec(
		`INSERT INTO nodes (id, type, title, content, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		n.ID, n.Type, n.Title, payload, n.CreatedAt, n.UpdatedAt); err != nil {
		return nil, nil, fmt.Errorf("insert node: %w", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO map_nodes (map_id, node_id, x, y, added_at)
		 VALUES (?, ?, ?, ?, ?)`,
		in.MapID, n.ID, in.X, in.Y, now); err != nil {
		return nil, nil, fmt.Errorf("place node on map: %w", err)
	}
	n.Placement = &Placement{X: in.X, Y: in.Y, AddedAt: now}

	var edge *Edge
	if in.ParentID != "" {
		src, tgt := n.ID, in.ParentID
		srcType, tgtType := in.Type, ibis.NodeType("")
		parentType, err := nodeTypeTx(tx, in.ParentID)
		if err != nil {
			return nil, nil, err
		}
		tgtType = parentType
		if in.EdgeDirection == "to" {
			src, tgt = in.ParentID, n.ID
			srcType, tgtType = parentType, in.Type
		}

		rel := in.Relationship
		if rel == "" {
			inferred, ok := ibis.DefaultRelationship(srcType, tgtType)
			if !ok {
				return nil, nil, &ibis.ValidationError{
					Source: srcType, Target: tgtType, Relationship: "",
					Reason:      "no relationship in the IBIS grammar connects these types",
					Suggestions: ibis.LegalRelationships(srcType, tgtType),
				}
			}
			rel = inferred
		}
		edge, err = insertEdgeTx(tx, in.MapID, src, tgt, rel, srcType, tgtType)
		if err != nil {
			return nil, nil, err
		}
	}

	// Journalled inside the same transaction as the write: a change without a
	// recoverable inverse is a silent data-loss risk, so they commit together
	// or not at all.
	snap := snapshot{
		Node:       n,
		Placements: []placement{{MapID: in.MapID, NodeID: n.ID, X: in.X, Y: in.Y, AddedAt: now}},
	}
	if edge != nil {
		snap.Edges = []Edge{*edge}
	}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, nil, err
	}
	if err := recordTx(tx, in.MapID, s.actor, ActionCreateNode,
		"added "+describeNode(n), snap, snap); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return n, edge, nil
}

// GetNode loads a node. When mapID is non-empty the node's placement on that
// map is populated.
func (s *Store) GetNode(id, mapID string) (*Node, error) {
	n := Node{}
	var payload string
	var mapRef sql.NullString
	err := s.db.QueryRow(
		`SELECT id, type, title, content, map_ref_id, created_at, updated_at
		 FROM nodes WHERE id = ?`, id).
		Scan(&n.ID, &n.Type, &n.Title, &payload, &mapRef, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("node %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	if mapRef.Valid {
		n.MapRefID = &mapRef.String
	}
	if err := json.Unmarshal([]byte(payload), &n.Content); err != nil {
		return nil, fmt.Errorf("decode content of %s: %w", id, err)
	}
	n.Content.normalize()

	ids, err := s.mapIDsFor(id)
	if err != nil {
		return nil, err
	}
	n.MapIDs, n.MapCount = ids, len(ids)

	if mapID != "" {
		p, err := s.placement(mapID, id)
		if err != nil {
			return nil, err
		}
		n.Placement = p
	}
	return &n, nil
}

func (s *Store) mapIDsFor(nodeID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT map_id FROM map_nodes WHERE node_id = ? ORDER BY added_at`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) placement(mapID, nodeID string) (*Placement, error) {
	var p Placement
	var group sql.NullString
	err := s.db.QueryRow(
		`SELECT x, y, collapsed, group_id, added_at
		 FROM map_nodes WHERE map_id = ? AND node_id = ?`, mapID, nodeID).
		Scan(&p.X, &p.Y, &p.Collapsed, &group, &p.AddedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if group.Valid {
		p.GroupID = &group.String
	}
	return &p, nil
}

// UpdateNode applies a sparse patch to a node's fields and JSON payload.
func (s *Store) UpdateNode(id string, patch NodePatch) (*Node, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	current, err := s.GetNode(id, "")
	if err != nil {
		return nil, err
	}
	// Snapshot before mutating: undo of an edit restores the previous field
	// values verbatim rather than trying to invert a diff.
	before := *current
	beforeContent := current.Content
	before.Content = beforeContent

	if patch.Type != nil {
		if !ibis.IsValidNodeType(*patch.Type) {
			return nil, fmt.Errorf("unknown node type %q", *patch.Type)
		}
		current.Type = *patch.Type
	}
	if patch.Title != nil {
		current.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Markdown != nil {
		current.Content.Markdown = *patch.Markdown
	}
	if patch.Tags != nil {
		current.Content.Tags = *patch.Tags
	}
	if patch.Status != nil {
		current.Content.Status = *patch.Status
	}
	if patch.Assets != nil {
		current.Content.Assets = *patch.Assets
	}
	if patch.Links != nil {
		current.Content.Links = *patch.Links
	}

	payload, err := current.Content.marshal()
	if err != nil {
		return nil, err
	}
	current.UpdatedAt = nowISO()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Retyping is a structural change: the node's relationships have to be
	// re-derived, because the grammar decides what an edge *means* from the
	// types at each end. Planned before the write so a retype with no legal
	// arrangement is refused without touching anything.
	var edgesBefore, edgesAfter []Edge
	if patch.Type != nil && *patch.Type != before.Type {
		edgesBefore, edgesAfter, err = retypeEdgesTx(tx, id, *patch.Type)
		if err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(
		`UPDATE nodes SET type = ?, title = ?, content = ?, updated_at = ?
		 WHERE id = ?`,
		current.Type, current.Title, payload, current.UpdatedAt, id); err != nil {
		return nil, err
	}

	// A title typed character by character would otherwise fill the journal
	// with one entry per keystroke, so undo of an edit collapses onto the
	// previous entry when it is the same actor editing the same node. The
	// original "before" state is preserved, so one Ctrl-Z reverts the whole
	// edit rather than one letter of it.
	//
	// A retype never merges: it rewrites edges as well as the node, and folding
	// that into a previous title edit would leave the journal unable to put the
	// relationships back.
	merged := false
	if len(edgesBefore) == 0 {
		merged, err = mergeEditTx(tx, s.actor, id, current)
		if err != nil {
			return nil, err
		}
	}
	if !merged {
		if err := clearRedoTx(tx, s.actor); err != nil {
			return nil, err
		}
		label := "edited " + describeNode(current)
		if len(edgesBefore) > 0 {
			label = fmt.Sprintf("changed %s to %s", describeNode(&before), current.Type)
		}
		if err := recordTx(tx, "", s.actor, ActionUpdateNode, label,
			snapshot{Node: &before, Edges: edgesBefore},
			snapshot{Node: current, Edges: edgesAfter}); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	current.Content.normalize()
	return current, nil
}

// mergeEditTx folds this edit into the previous journal entry when it continues
// the same action, and reports whether it did.
//
// Two cases merge, and both come from the same principle: undo should reverse
// what the user thinks they did, not what the code happened to write.
//
//   - Consecutive edits to one node. Otherwise a typed title would need one
//     Ctrl-Z per character.
//   - An edit immediately after creating that node. Pressing `q` and typing a
//     title is one act of authorship; splitting it meant the first Ctrl-Z left
//     an untitled node sitting on the canvas, which reads as undo being broken
//     rather than as the title being reverted.
//
// Anything else in between breaks the run, so editing a node from last week
// never merges into its creation.
func mergeEditTx(tx *sql.Tx, actor, nodeID string, after *Node) (bool, error) {
	var id int64
	var action UndoAction
	var inverse, forward string
	err := tx.QueryRow(
		`SELECT id, action, inverse, forward FROM undo_log
		 WHERE actor = ? AND undone = 0 ORDER BY id DESC LIMIT 1`, actor).
		Scan(&id, &action, &inverse, &forward)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if action != ActionUpdateNode && action != ActionCreateNode {
		return false, nil
	}

	var prev snapshot
	if err := json.Unmarshal([]byte(inverse), &prev); err != nil {
		return false, err
	}
	if prev.Node == nil || prev.Node.ID != nodeID {
		return false, nil
	}

	// The forward payload is what redo replays, so it has to carry the new
	// title. For a create it also carries the placements and edges, which must
	// survive — only the node record is being refreshed.
	var fwd snapshot
	if err := json.Unmarshal([]byte(forward), &fwd); err != nil {
		return false, err
	}
	fwd.Node = after
	encoded, err := json.Marshal(fwd)
	if err != nil {
		return false, err
	}

	// A merged create is still a create: undoing it must remove the node, and
	// the label should say so.
	label := "edited " + describeNode(after)
	if action == ActionCreateNode {
		label = "added " + describeNode(after)
	}

	_, err = tx.Exec(
		`UPDATE undo_log SET forward = ?, label = ?, created_at = ? WHERE id = ?`,
		string(encoded), label, nowISO(), id)
	return err == nil, err
}

// BulkOps describes a change applied to a whole selection at once.
//
// Tags are expressed as add and remove sets rather than a replacement list,
// because a selection rarely shares one set of tags. "Add #perf to all of
// these" is a coherent instruction whatever each node already carries;
// "set the tags to X" would silently wipe tags the user could not see.
type BulkOps struct {
	AddTags    []string `json:"addTags,omitempty"`
	RemoveTags []string `json:"removeTags,omitempty"`
	Status     *Status  `json:"status,omitempty"`
}

func (o BulkOps) isEmpty() bool {
	return len(o.AddTags) == 0 && len(o.RemoveTags) == 0 && o.Status == nil
}

// BulkUpdateNodes applies one change to many nodes in a single transaction and
// records it as a single undo entry.
//
// The entry matters as much as the transaction. Looping individual updates
// would leave one journal entry per node, so Ctrl-Z would walk back a bulk
// edit one node at a time — which is not what the user did, and is tedious to
// reverse when they tagged forty nodes at once.
func (s *Store) BulkUpdateNodes(nodeIDs []string, ops BulkOps) ([]Node, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if len(nodeIDs) == 0 {
		return nil, errors.New("no nodes selected")
	}
	if ops.isEmpty() {
		return nil, errors.New("nothing to change")
	}
	if ops.Status != nil && !isValidStatus(*ops.Status) {
		return nil, fmt.Errorf("unknown status %q", *ops.Status)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	before := make([]Node, 0, len(nodeIDs))
	after := make([]Node, 0, len(nodeIDs))

	for _, id := range nodeIDs {
		n, err := nodeByIDTx(tx, id)
		if err != nil {
			return nil, err
		}
		snapshotBefore := *n
		snapshotBefore.Content = n.Content.clone()
		before = append(before, snapshotBefore)

		for _, t := range ops.AddTags {
			n.Content.Tags = append(n.Content.Tags, t)
		}
		if len(ops.RemoveTags) > 0 {
			drop := map[string]bool{}
			for _, t := range ops.RemoveTags {
				drop[strings.TrimSpace(strings.ToLower(t))] = true
			}
			kept := n.Content.Tags[:0]
			for _, t := range n.Content.Tags {
				if !drop[strings.TrimSpace(strings.ToLower(t))] {
					kept = append(kept, t)
				}
			}
			n.Content.Tags = kept
		}
		if ops.Status != nil {
			n.Content.Status = *ops.Status
		}
		// normalize dedupes and lowercases, so adding a tag a node already has
		// is a no-op rather than a duplicate.
		n.Content.normalize()

		payload, err := n.Content.marshal()
		if err != nil {
			return nil, err
		}
		n.UpdatedAt = nowISO()
		if _, err := tx.Exec(
			`UPDATE nodes SET content = ?, updated_at = ? WHERE id = ?`,
			payload, n.UpdatedAt, n.ID); err != nil {
			return nil, err
		}
		after = append(after, *n)
	}

	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, "", s.actor, ActionBulkUpdate,
		bulkLabel(len(nodeIDs), ops),
		snapshot{Nodes: before}, snapshot{Nodes: after}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return after, nil
}

// bulkLabel names the action for the undo toast and tooltip.
func bulkLabel(n int, ops BulkOps) string {
	plural := "nodes"
	if n == 1 {
		plural = "node"
	}
	switch {
	case len(ops.AddTags) > 0 && len(ops.RemoveTags) == 0 && ops.Status == nil:
		return fmt.Sprintf("tagged %d %s #%s", n, plural, strings.Join(ops.AddTags, " #"))
	case len(ops.RemoveTags) > 0 && len(ops.AddTags) == 0 && ops.Status == nil:
		return fmt.Sprintf("untagged %d %s #%s", n, plural, strings.Join(ops.RemoveTags, " #"))
	case ops.Status != nil && len(ops.AddTags) == 0 && len(ops.RemoveTags) == 0:
		return fmt.Sprintf("set %d %s to %s", n, plural, *ops.Status)
	default:
		return fmt.Sprintf("edited %d %s", n, plural)
	}
}

func isValidStatus(s Status) bool {
	switch s {
	case StatusOpen, StatusResolved, StatusRejected, StatusParked:
		return true
	}
	return false
}

// nodeByIDTx loads a node inside a transaction, without map context.
func nodeByIDTx(tx *sql.Tx, id string) (*Node, error) {
	var n Node
	var payload string
	var mapRef sql.NullString
	err := tx.QueryRow(
		`SELECT id, type, title, content, map_ref_id, created_at, updated_at
		 FROM nodes WHERE id = ?`, id).
		Scan(&n.ID, &n.Type, &n.Title, &payload, &mapRef, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("node %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	if mapRef.Valid {
		n.MapRefID = &mapRef.String
	}
	if err := json.Unmarshal([]byte(payload), &n.Content); err != nil {
		return nil, fmt.Errorf("decode content of %s: %w", id, err)
	}
	n.Content.normalize()
	return &n, nil
}

// retypeEdgesTx re-derives a node's relationships for a new type, returning the
// edges as they were and as they now are.
//
// The relationship on an edge is not an independent fact — it is a reading of
// the two types at its ends. "Idea responds_to Question" and "Pro supports
// Idea" are the same arrow described correctly for what sits at each end, so
// changing a node's type has to relabel its arrows.
//
// The earlier version asked the wrong question: whether the *existing*
// relationship stayed legal under the new type. It almost never does, which
// made retyping fail nearly every time. The right question is whether the
// grammar permits *any* relationship between the new type and each neighbour;
// if it does, that becomes the edge's new label, and only a pair the grammar
// cannot connect at all is refused.
func retypeEdgesTx(tx *sql.Tx, nodeID string, newType ibis.NodeType) (before, after []Edge, err error) {
	rows, err := tx.Query(
		`SELECT e.id, e.map_id, e.source_node_id, e.target_node_id,
		        e.relationship_type, e.created_at,
		        sn.type, tn.type, sn.title, tn.title
		 FROM edges e
		 JOIN nodes sn ON sn.id = e.source_node_id
		 JOIN nodes tn ON tn.id = e.target_node_id
		 WHERE e.source_node_id = ? OR e.target_node_id = ?`, nodeID, nodeID)
	if err != nil {
		return nil, nil, err
	}

	type incident struct {
		edge             Edge
		srcType, tgtType ibis.NodeType
		neighbourTitle   string
		neighbourType    ibis.NodeType
	}
	var edges []incident
	for rows.Next() {
		var in incident
		var srcTitle, tgtTitle string
		if err := rows.Scan(&in.edge.ID, &in.edge.MapID,
			&in.edge.SourceNodeID, &in.edge.TargetNodeID,
			&in.edge.Relationship, &in.edge.CreatedAt,
			&in.srcType, &in.tgtType, &srcTitle, &tgtTitle); err != nil {
			rows.Close()
			return nil, nil, err
		}
		// Substitute the new type at whichever end is being retyped, and note
		// the other end so a refusal can name it.
		if in.edge.SourceNodeID == nodeID {
			in.srcType, in.neighbourType, in.neighbourTitle = newType, in.tgtType, tgtTitle
		} else {
			in.tgtType, in.neighbourType, in.neighbourTitle = newType, in.srcType, srcTitle
		}
		edges = append(edges, in)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	for _, in := range edges {
		// Already legal under the new type: leave it alone rather than
		// churning a relationship the user chose deliberately.
		if ibis.ValidateEdge(in.srcType, in.tgtType, in.edge.Relationship) == nil {
			continue
		}

		newRel, ok := ibis.DefaultRelationship(in.srcType, in.tgtType)
		if !ok {
			return nil, nil, fmt.Errorf(
				"cannot change this to a %s: the IBIS grammar has no relationship "+
					"between a %s and the %s %q, so the link between them would be "+
					"meaningless — detach it first",
				newType, newType, in.neighbourType, truncateTitle(in.neighbourTitle))
		}

		// Relabelling can turn an associative link into a hierarchical one,
		// which could close a loop in the argument tree.
		if ibis.IsHierarchical(newRel) && !ibis.IsHierarchical(in.edge.Relationship) {
			cyclic, err := reachableTx(tx, in.edge.MapID, in.edge.TargetNodeID, in.edge.SourceNodeID)
			if err != nil {
				return nil, nil, err
			}
			if cyclic {
				return nil, nil, fmt.Errorf(
					"cannot change this to a %s: the link to %q would become a %q "+
						"and close a loop in the argument tree",
					newType, truncateTitle(in.neighbourTitle), newRel)
			}
		}

		updated := in.edge
		updated.Relationship = newRel

		// The new label may duplicate an edge that already exists between the
		// same pair, which the unique index forbids. Drop this one instead:
		// the relationship it would express is already recorded.
		var duplicate int
		if err := tx.QueryRow(
			`SELECT count(*) FROM edges
			 WHERE map_id = ? AND source_node_id = ? AND target_node_id = ?
			   AND relationship_type = ? AND id <> ?`,
			updated.MapID, updated.SourceNodeID, updated.TargetNodeID,
			updated.Relationship, updated.ID).Scan(&duplicate); err != nil {
			return nil, nil, err
		}
		if duplicate > 0 {
			if _, err := tx.Exec(`DELETE FROM edges WHERE id = ?`, in.edge.ID); err != nil {
				return nil, nil, err
			}
			before = append(before, in.edge)
			continue // no "after" row: this edge is gone
		}

		if _, err := tx.Exec(
			`UPDATE edges SET relationship_type = ? WHERE id = ?`,
			updated.Relationship, updated.ID); err != nil {
			return nil, nil, err
		}
		before = append(before, in.edge)
		after = append(after, updated)
	}
	return before, after, nil
}

func truncateTitle(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "untitled"
	}
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}

// SetPlacement records a node's position on a map. Called on drag end.
func (s *Store) SetPlacement(mapID, nodeID string, x, y *float64, collapsed *bool, groupID *string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	sets := []string{}
	args := []any{}
	if x != nil && y != nil {
		sets = append(sets, "x = ?", "y = ?")
		args = append(args, *x, *y)
	}
	if collapsed != nil {
		sets = append(sets, "collapsed = ?")
		args = append(args, boolToInt(*collapsed))
	}
	if groupID != nil {
		sets = append(sets, "group_id = ?")
		if *groupID == "" {
			args = append(args, nil)
		} else {
			args = append(args, *groupID)
		}
	}
	if len(sets) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	before, err := placementTx(tx, mapID, nodeID)
	if err != nil {
		return err
	}

	args = append(args, mapID, nodeID)
	if _, err := tx.Exec(
		`UPDATE map_nodes SET `+strings.Join(sets, ", ")+
			` WHERE map_id = ? AND node_id = ?`, args...); err != nil {
		return err
	}

	// Giving a node its first coordinates is not a user action worth undoing.
	// Nodes arriving from the CLI, an agent or a phone have no position, and
	// the client assigns one via auto-layout the moment the map is opened.
	// Journalling that filled the undo history with moves nobody made — so
	// Ctrl-Z straight after opening a seeded map reversed a layout decision
	// instead of the user's last real edit.
	firstPlacement := before != nil && before.X == nil && before.Y == nil

	if before != nil && !firstPlacement {
		after, err := placementTx(tx, mapID, nodeID)
		if err != nil {
			return err
		}
		// Dragging a node back and forth should not bury the real work under
		// dozens of move entries, so consecutive moves of the same node by the
		// same actor collapse into one.
		if merged, err := mergeMoveTx(tx, s.actor, mapID, nodeID, *after); err != nil {
			return err
		} else if !merged {
			if err := clearRedoTx(tx, s.actor); err != nil {
				return err
			}
			if err := recordTx(tx, mapID, s.actor, ActionMoveNode, "moved a node",
				snapshot{Placements: []placement{*before}},
				snapshot{Placements: []placement{*after}}); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func placementTx(tx *sql.Tx, mapID, nodeID string) (*placement, error) {
	var p placement
	var group sql.NullString
	err := tx.QueryRow(
		`SELECT map_id, node_id, x, y, collapsed, group_id, added_at
		 FROM map_nodes WHERE map_id = ? AND node_id = ?`, mapID, nodeID).
		Scan(&p.MapID, &p.NodeID, &p.X, &p.Y, &p.Collapsed, &group, &p.AddedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if group.Valid {
		p.GroupID = &group.String
	}
	return &p, nil
}

func mergeMoveTx(tx *sql.Tx, actor, mapID, nodeID string, after placement) (bool, error) {
	var id int64
	var action UndoAction
	var inverse string
	err := tx.QueryRow(
		`SELECT id, action, inverse FROM undo_log
		 WHERE actor = ? AND undone = 0 ORDER BY id DESC LIMIT 1`, actor).
		Scan(&id, &action, &inverse)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil || action != ActionMoveNode {
		return false, err
	}
	var prev snapshot
	if err := json.Unmarshal([]byte(inverse), &prev); err != nil {
		return false, err
	}
	if len(prev.Placements) != 1 ||
		prev.Placements[0].NodeID != nodeID || prev.Placements[0].MapID != mapID {
		return false, nil
	}
	forward, err := json.Marshal(snapshot{Placements: []placement{after}})
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(`UPDATE undo_log SET forward = ?, created_at = ? WHERE id = ?`,
		string(forward), nowISO(), id)
	return err == nil, err
}

// TranscludeInput describes one insertion of an existing node onto a map.
//
// ParentID is what the `/` palette adds: inserting a node and then linking it
// under the selected one used to be two API calls, which meant two journal
// entries and two presses of Ctrl-Z to reverse one apparent action. Doing both
// in one transaction keeps "insert under this" a single thing that either
// happens or does not.
type TranscludeInput struct {
	MapID  string
	NodeID string
	X, Y   *float64
	// ParentID, when set, links the inserted node beneath that node. The edge
	// runs child -> parent, the direction IBIS edges point.
	ParentID string
	// Relationship is inferred from the two node types when empty.
	Relationship ibis.Relationship
}

// Transclude adds an existing node to another map, optionally under a parent.
// This is the operation that makes a node shared rather than copied: the same
// id, two placements.
//
// Returns the edge it created, if any.
func (s *Store) Transclude(in TranscludeInput) (*Edge, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := nowISO()
	res, err := tx.Exec(
		`INSERT INTO map_nodes (map_id, node_id, x, y, added_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (map_id, node_id) DO NOTHING`,
		in.MapID, in.NodeID, in.X, in.Y, now)
	if err != nil {
		return nil, err
	}
	placed, _ := res.RowsAffected()

	var edge *Edge
	if in.ParentID != "" {
		edge, err = linkUnderTx(tx, in.MapID, in.NodeID, in.ParentID, in.Relationship)
		if err != nil {
			return nil, err
		}
	}

	// Already on this map and no edge asked for: nothing changed, so nothing to
	// journal. Recording a no-op would make one Ctrl-Z appear to do nothing.
	if placed == 0 && edge == nil {
		return nil, tx.Commit()
	}

	// When the node was already here, the only new thing is the edge, so the
	// entry has to say so — undoing it must not tear out a placement this
	// action never made.
	action, label := ActionTransclude, "inserted a shared node"
	snap := snapshot{Placements: []placement{
		{MapID: in.MapID, NodeID: in.NodeID, X: in.X, Y: in.Y, AddedAt: now},
	}}
	if placed == 0 {
		action, label, snap = ActionCreateEdge, "linked a shared node", snapshot{}
	}
	if edge != nil {
		snap.Edges = []Edge{*edge}
		if placed > 0 {
			label = "inserted a shared node under another"
		}
	}

	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, in.MapID, s.actor, action, label, snap, snap); err != nil {
		return nil, err
	}
	return edge, tx.Commit()
}

// linkUnderTx builds the child -> parent edge for an insertion, choosing the
// relationship from the grammar when the caller did not name one.
//
// A rejection here is information rather than a failure: the palette shows what
// would have been legal, the same way dragging an illegal link does.
func linkUnderTx(
	tx *sql.Tx, mapID, childID, parentID string, rel ibis.Relationship,
) (*Edge, error) {
	if childID == parentID {
		return nil, errors.New("a node cannot be inserted under itself")
	}
	childType, err := nodeTypeTx(tx, childID)
	if err != nil {
		return nil, err
	}
	parentType, err := nodeTypeTx(tx, parentID)
	if err != nil {
		return nil, err
	}
	if rel == "" {
		inferred, ok := ibis.DefaultRelationship(childType, parentType)
		if !ok {
			return nil, &ibis.ValidationError{
				Source: childType, Target: parentType, Relationship: "",
				Reason:      "no relationship in the IBIS grammar connects these types",
				Suggestions: ibis.LegalRelationships(childType, parentType),
			}
		}
		rel = inferred
	}
	return insertEdgeTx(tx, mapID, childID, parentID, rel, childType, parentType)
}

// RemoveFromMap detaches a node from one map, deleting the edges that only
// made sense in that context. The node itself is untouched.
func (s *Store) RemoveFromMap(mapID, nodeID string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Capture the placement and this map's edges before they are destroyed —
	// restoring a node without the arguments attached to it would be a worse
	// outcome than not offering undo.
	snap, err := nodeSnapshotTx(tx, nodeID, mapID)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(
		`DELETE FROM edges WHERE map_id = ? AND (source_node_id = ? OR target_node_id = ?)`,
		mapID, nodeID, nodeID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`DELETE FROM map_nodes WHERE map_id = ? AND node_id = ?`,
		mapID, nodeID); err != nil {
		return err
	}

	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	if err := recordTx(tx, mapID, s.actor, ActionRemoveNode,
		"removed "+describeNode(snap.Node)+" from this map", snap, snap); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteNode destroys a node everywhere it appears. Callers should confirm
// when MapCount > 1: the user is deleting from more maps than they can see.
func (s *Store) DeleteNode(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// An unscoped snapshot: every placement on every map, and every edge on
	// every map. Deleting a transcluded node reaches further than the canvas
	// shows, and undo has to reach exactly as far back.
	snap, err := nodeSnapshotTx(tx, id, "")
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM nodes WHERE id = ?`, id); err != nil {
		return err
	}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	label := "deleted " + describeNode(snap.Node)
	if len(snap.Placements) > 1 {
		label = fmt.Sprintf("deleted %s from %d maps",
			describeNode(snap.Node), len(snap.Placements))
	}
	if err := recordTx(tx, "", s.actor, ActionDeleteNode, label, snap, snap); err != nil {
		return err
	}
	return tx.Commit()
}

// SearchNodes finds nodes by title, body or tag across the whole project. Used
// by the mobile search bar and by the canvas palette.
//
// excludeMapID hides everything already on one map. The palette no longer asks
// for that — it searches the whole project so it can jump to a node as well as
// insert one, and you cannot jump to what the search refused to return. The
// mobile search still passes nothing, and the parameter stays because hiding
// the current map is a reasonable thing for a caller to want.
func (s *Store) SearchNodes(q string, excludeMapID string, limit int) ([]Node, error) {
	if limit <= 0 {
		limit = 50
	}
	// Whitespace separates terms and every one has to match, so a second word
	// narrows the result instead of emptying it. Each term may land in the
	// title or anywhere in the content JSON, which covers body, tags and links.
	// A leading ?, !, +, - or . narrows to one node type.
	parsed := ParseQuery(q)
	sqlStr := `
		SELECT n.id, n.type, n.title, n.content, n.map_ref_id,
		       n.created_at, n.updated_at,
		       (SELECT count(*) FROM map_nodes mn2 WHERE mn2.node_id = n.id)
		FROM nodes n
		WHERE 1 = 1`
	var args []any
	if parsed.Type != "" {
		sqlStr += ` AND n.type = ?`
		args = append(args, string(parsed.Type))
	}
	for _, t := range parsed.Terms {
		pattern := "%" + t + "%"
		sqlStr += ` AND (lower(n.title) LIKE ? OR lower(n.content) LIKE ?)`
		args = append(args, pattern, pattern)
	}
	if excludeMapID != "" {
		sqlStr += ` AND n.id NOT IN (SELECT node_id FROM map_nodes WHERE map_id = ?)`
		args = append(args, excludeMapID)
	}
	sqlStr += ` ORDER BY n.updated_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found, err := scanNodes(rows)
	if err != nil {
		return nil, err
	}
	if err := s.fillMapIDs(found); err != nil {
		return nil, err
	}
	return found, nil
}

// RecentNodes powers the mobile linear feed: newest activity first, optionally
// scoped to one map.
func (s *Store) RecentNodes(mapID string, limit int) ([]Node, error) {
	if limit <= 0 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if mapID == "" {
		rows, err = s.db.Query(`
			SELECT n.id, n.type, n.title, n.content, n.map_ref_id,
			       n.created_at, n.updated_at,
			       (SELECT count(*) FROM map_nodes mn2 WHERE mn2.node_id = n.id)
			FROM nodes n ORDER BY n.updated_at DESC LIMIT ?`, limit)
	} else {
		rows, err = s.db.Query(`
			SELECT n.id, n.type, n.title, n.content, n.map_ref_id,
			       n.created_at, n.updated_at,
			       (SELECT count(*) FROM map_nodes mn2 WHERE mn2.node_id = n.id)
			FROM nodes n
			JOIN map_nodes mn ON mn.node_id = n.id AND mn.map_id = ?
			ORDER BY n.updated_at DESC LIMIT ?`, mapID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNodes(rows)
}

func scanNodes(rows *sql.Rows) ([]Node, error) {
	out := []Node{}
	for rows.Next() {
		var n Node
		var payload string
		var mapRef sql.NullString
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &payload, &mapRef,
			&n.CreatedAt, &n.UpdatedAt, &n.MapCount); err != nil {
			return nil, err
		}
		if mapRef.Valid {
			n.MapRefID = &mapRef.String
		}
		if err := json.Unmarshal([]byte(payload), &n.Content); err != nil {
			return nil, fmt.Errorf("decode content of %s: %w", n.ID, err)
		}
		n.Content.normalize()
		out = append(out, n)
	}
	return out, rows.Err()
}

// fillMapIDs attaches the maps each node appears on.
//
// GetNode does this per node, but a search returns a list, and the palette
// needs it for every row: to say where a node lives, to tell "already here"
// from "elsewhere", and to know which map to open when jumping. Doing it in one
// query rather than one per row keeps a 25-row search at two round trips.
func (s *Store) fillMapIDs(nodes []Node) error {
	if len(nodes) == 0 {
		return nil
	}
	ids := make([]any, len(nodes))
	for i, n := range nodes {
		ids[i] = n.ID
	}
	q := `SELECT node_id, map_id FROM map_nodes
	      WHERE node_id IN (?` + strings.Repeat(",?", len(ids)-1) + `)
	      ORDER BY added_at`
	rows, err := s.db.Query(q, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()

	byNode := make(map[string][]string, len(nodes))
	for rows.Next() {
		var nodeID, mapID string
		if err := rows.Scan(&nodeID, &mapID); err != nil {
			return err
		}
		byNode[nodeID] = append(byNode[nodeID], mapID)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range nodes {
		// MapCount comes from its own subquery; keeping the two in step means a
		// row can never claim to be on three maps while naming one.
		nodes[i].MapIDs = byNode[nodes[i].ID]
		nodes[i].MapCount = len(nodes[i].MapIDs)
	}
	return nil
}

// --- graph -----------------------------------------------------------------

// Graph loads everything needed to render one map in a single call.
func (s *Store) Graph(mapID string) (*Graph, error) {
	m, err := s.GetMap(mapID)
	if err != nil {
		return nil, err
	}
	g := &Graph{Map: *m, Nodes: []Node{}, Edges: []Edge{}, Groups: []Group{}}

	rows, err := s.db.Query(`
		SELECT n.id, n.type, n.title, n.content, n.map_ref_id,
		       n.created_at, n.updated_at,
		       mn.x, mn.y, mn.collapsed, mn.group_id, mn.added_at,
		       (SELECT count(*) FROM map_nodes mn2 WHERE mn2.node_id = n.id)
		FROM map_nodes mn
		JOIN nodes n ON n.id = mn.node_id
		WHERE mn.map_id = ?
		ORDER BY mn.added_at`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var n Node
		var p Placement
		var payload string
		var mapRef, group sql.NullString
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &payload, &mapRef,
			&n.CreatedAt, &n.UpdatedAt,
			&p.X, &p.Y, &p.Collapsed, &group, &p.AddedAt, &n.MapCount); err != nil {
			return nil, err
		}
		if mapRef.Valid {
			n.MapRefID = &mapRef.String
		}
		if group.Valid {
			p.GroupID = &group.String
		}
		if err := json.Unmarshal([]byte(payload), &n.Content); err != nil {
			return nil, fmt.Errorf("decode content of %s: %w", n.ID, err)
		}
		n.Content.normalize()
		placement := p
		n.Placement = &placement
		g.Nodes = append(g.Nodes, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if g.Edges, err = s.edgesFor(mapID); err != nil {
		return nil, err
	}
	if g.Groups, err = s.GroupsFor(mapID); err != nil {
		return nil, err
	}
	return g, nil
}

func (s *Store) edgesFor(mapID string) ([]Edge, error) {
	rows, err := s.db.Query(
		`SELECT id, map_id, source_node_id, target_node_id, relationship_type, created_at
		 FROM edges WHERE map_id = ? ORDER BY created_at`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Edge{}
	for rows.Next() {
		var e Edge
		if err := rows.Scan(&e.ID, &e.MapID, &e.SourceNodeID, &e.TargetNodeID,
			&e.Relationship, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- edges -----------------------------------------------------------------

// CreateEdge links two nodes on a map after checking the IBIS grammar, that
// both endpoints are actually present on that map, and that hierarchical
// relationships stay acyclic.
func (s *Store) CreateEdge(mapID, sourceID, targetID string, rel ibis.Relationship) (*Edge, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	srcType, err := nodeTypeTx(tx, sourceID)
	if err != nil {
		return nil, err
	}
	tgtType, err := nodeTypeTx(tx, targetID)
	if err != nil {
		return nil, err
	}
	if rel == "" {
		inferred, ok := ibis.DefaultRelationship(srcType, tgtType)
		if !ok {
			return nil, &ibis.ValidationError{
				Source: srcType, Target: tgtType,
				Reason:      "no relationship in the IBIS grammar connects these types",
				Suggestions: ibis.LegalRelationships(srcType, tgtType),
			}
		}
		rel = inferred
	}
	e, err := insertEdgeTx(tx, mapID, sourceID, targetID, rel, srcType, tgtType)
	if err != nil {
		return nil, err
	}

	snap := snapshot{Edges: []Edge{*e}}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, mapID, s.actor, ActionCreateEdge,
		fmt.Sprintf("linked %s", rel), snap, snap); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return e, nil
}

func insertEdgeTx(tx *sql.Tx, mapID, sourceID, targetID string,
	rel ibis.Relationship, srcType, tgtType ibis.NodeType) (*Edge, error) {

	if sourceID == targetID {
		return nil, errors.New("a node cannot link to itself")
	}
	if err := ibis.ValidateEdge(srcType, tgtType, rel); err != nil {
		return nil, err
	}
	for _, id := range []string{sourceID, targetID} {
		var present int
		if err := tx.QueryRow(
			`SELECT count(*) FROM map_nodes WHERE map_id = ? AND node_id = ?`,
			mapID, id).Scan(&present); err != nil {
			return nil, err
		}
		if present == 0 {
			return nil, fmt.Errorf(
				"node %s is not on map %s; transclude it before linking", id, mapID)
		}
	}
	if ibis.IsHierarchical(rel) {
		cyclic, err := reachableTx(tx, mapID, targetID, sourceID)
		if err != nil {
			return nil, err
		}
		if cyclic {
			return nil, fmt.Errorf(
				"that %s edge would create a cycle: %s already sits beneath %s in the argument tree",
				rel, sourceID, targetID)
		}
	}

	e := &Edge{
		ID: NewID("edge"), MapID: mapID, SourceNodeID: sourceID,
		TargetNodeID: targetID, Relationship: rel, CreatedAt: nowISO(),
	}
	_, err := tx.Exec(
		`INSERT INTO edges (id, map_id, source_node_id, target_node_id,
		                    relationship_type, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		e.ID, e.MapID, e.SourceNodeID, e.TargetNodeID, e.Relationship, e.CreatedAt)
	if isUniqueViolation(err) {
		return nil, &ConflictError{Detail: fmt.Sprintf(
			"those nodes are already linked by %q on this map", rel)}
	}
	if err != nil {
		return nil, fmt.Errorf("insert edge: %w", err)
	}
	return e, nil
}

// reachableTx walks hierarchical edges from `from`, reporting whether `goal`
// is downstream. Iterative with a visited set, so a malformed graph cannot
// stack-overflow the server.
func reachableTx(tx *sql.Tx, mapID, from, goal string) (bool, error) {
	visited := map[string]bool{from: true}
	queue := []string{from}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		rows, err := tx.Query(
			`SELECT target_node_id, relationship_type
			 FROM edges WHERE map_id = ? AND source_node_id = ?`, mapID, cur)
		if err != nil {
			return false, err
		}
		var next []string
		for rows.Next() {
			var to string
			var rel ibis.Relationship
			if err := rows.Scan(&to, &rel); err != nil {
				rows.Close()
				return false, err
			}
			if !ibis.IsHierarchical(rel) || visited[to] {
				continue
			}
			if to == goal {
				rows.Close()
				return true, nil
			}
			visited[to] = true
			next = append(next, to)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return false, err
		}
		rows.Close()
		queue = append(queue, next...)
	}
	return false, nil
}

// DeleteEdge removes one relationship.
func (s *Store) DeleteEdge(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var e Edge
	err = tx.QueryRow(
		`SELECT id, map_id, source_node_id, target_node_id, relationship_type, created_at
		 FROM edges WHERE id = ?`, id).
		Scan(&e.ID, &e.MapID, &e.SourceNodeID, &e.TargetNodeID, &e.Relationship, &e.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // already gone; nothing to journal
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM edges WHERE id = ?`, id); err != nil {
		return err
	}
	snap := snapshot{Edges: []Edge{e}}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	if err := recordTx(tx, e.MapID, s.actor, ActionDeleteEdge,
		fmt.Sprintf("unlinked %s", e.Relationship), snap, snap); err != nil {
		return err
	}
	return tx.Commit()
}

// --- groups ----------------------------------------------------------------

// CreateGroup gathers a set of nodes on a map into a group.
//
// A node belongs to at most one group per map, so any node already grouped is
// moved into the new one. That is the behaviour people expect from a selection
// tool: grouping is an assertion about the current selection, not an attempt
// to reconcile it with whatever was there before.
func (s *Store) CreateGroup(mapID, title, color string, nodeIDs []string) (*Group, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if mapID == "" {
		return nil, errors.New("mapId is required")
	}
	if len(nodeIDs) < 2 {
		// A group of one is just a node with extra decoration, and a group of
		// none has no outline to draw.
		return nil, errors.New("select at least two nodes to group them")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Capture where every affected node sat, including its previous group, so
	// undo restores the earlier arrangement rather than merely deleting the
	// new group and orphaning nodes that used to belong somewhere.
	before, err := placementsForNodesTx(tx, mapID, nodeIDs)
	if err != nil {
		return nil, err
	}
	if len(before) != len(nodeIDs) {
		return nil, fmt.Errorf("some of those nodes are not on map %s", mapID)
	}

	g := Group{
		ID: NewID("grp"), MapID: mapID, Title: title,
		Color: orDefault(color, "slate"), CreatedAt: nowISO(),
	}
	if _, err := tx.Exec(
		`INSERT INTO groups (id, map_id, title, color, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		g.ID, g.MapID, g.Title, g.Color, g.CreatedAt); err != nil {
		return nil, err
	}
	for _, id := range nodeIDs {
		if _, err := tx.Exec(
			`UPDATE map_nodes SET group_id = ? WHERE map_id = ? AND node_id = ?`,
			g.ID, mapID, id); err != nil {
			return nil, err
		}
	}
	g.NodeIDs = append([]string{}, nodeIDs...)

	after, err := placementsForNodesTx(tx, mapID, nodeIDs)
	if err != nil {
		return nil, err
	}

	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, mapID, s.actor, ActionSaveGroup,
		fmt.Sprintf("grouped %d nodes", len(nodeIDs)),
		snapshot{Groups: []Group{{ID: g.ID, MapID: mapID}}, Placements: before},
		snapshot{Groups: []Group{g}, Placements: after}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &g, nil
}

// UpdateGroup renames or recolours a group.
func (s *Store) UpdateGroup(id, title, color string) (*Group, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	before, err := groupSnapshotTx(tx, id)
	if err != nil {
		return nil, err
	}
	if len(before.Groups) == 0 {
		return nil, fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	if _, err := tx.Exec(
		`UPDATE groups SET title = ?, color = ? WHERE id = ?`,
		title, orDefault(color, before.Groups[0].Color), id); err != nil {
		return nil, err
	}
	after, err := groupSnapshotTx(tx, id)
	if err != nil {
		return nil, err
	}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, before.Groups[0].MapID, s.actor, ActionSaveGroup,
		"renamed a group", before, after); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &after.Groups[0], nil
}

// MoveGroup shifts every member of a group by the same offset.
//
// This is what makes a group a group: the members are the thing that moves,
// and the outline follows because it is derived from them.
func (s *Store) MoveGroup(mapID, groupID string, dx, dy float64) ([]Placement, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	members, err := groupMembersTx(tx, groupID)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, fmt.Errorf("group %s: %w", groupID, ErrNotFound)
	}

	before, err := placementsForNodesTx(tx, mapID, members)
	if err != nil {
		return nil, err
	}
	for _, p := range before {
		// A member that was never placed has nothing to offset; the client
		// will lay it out and it will join the group's bounds then.
		if p.X == nil || p.Y == nil {
			continue
		}
		if _, err := tx.Exec(
			`UPDATE map_nodes SET x = ?, y = ? WHERE map_id = ? AND node_id = ?`,
			*p.X+dx, *p.Y+dy, mapID, p.NodeID); err != nil {
			return nil, err
		}
	}
	after, err := placementsForNodesTx(tx, mapID, members)
	if err != nil {
		return nil, err
	}

	// Dragging a group around is one gesture however many frames it took, so
	// consecutive moves of the same group collapse into one undo entry.
	if merged, err := mergeGroupMoveTx(tx, s.actor, groupID, after); err != nil {
		return nil, err
	} else if !merged {
		if err := clearRedoTx(tx, s.actor); err != nil {
			return nil, err
		}
		if err := recordTx(tx, mapID, s.actor, ActionMoveGroup,
			fmt.Sprintf("moved a group of %d", len(members)),
			snapshot{Placements: before, Groups: []Group{{ID: groupID, MapID: mapID}}},
			snapshot{Placements: after, Groups: []Group{{ID: groupID, MapID: mapID}}}); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	out := make([]Placement, 0, len(after))
	for _, p := range after {
		out = append(out, Placement{X: p.X, Y: p.Y, AddedAt: p.AddedAt})
	}
	return out, nil
}

// SetGroupMembers replaces a group's membership, deleting the group when the
// result is empty. Used by "add to group" and "remove from group".
func (s *Store) SetGroupMembers(mapID, groupID string, nodeIDs []string) (*Group, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	existing, err := groupMembersTx(tx, groupID)
	if err != nil {
		return nil, err
	}
	affected := union(existing, nodeIDs)
	before, err := placementsForNodesTx(tx, mapID, affected)
	if err != nil {
		return nil, err
	}
	snapBefore, err := groupSnapshotTx(tx, groupID)
	if err != nil {
		return nil, err
	}
	snapBefore.Placements = before

	if _, err := tx.Exec(
		`UPDATE map_nodes SET group_id = NULL WHERE group_id = ?`, groupID); err != nil {
		return nil, err
	}
	for _, id := range nodeIDs {
		if _, err := tx.Exec(
			`UPDATE map_nodes SET group_id = ? WHERE map_id = ? AND node_id = ?`,
			groupID, mapID, id); err != nil {
			return nil, err
		}
	}

	// An empty group has no outline and no purpose, so it goes away rather
	// than lingering as an invisible row.
	if len(nodeIDs) == 0 {
		if _, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, groupID); err != nil {
			return nil, err
		}
	}

	after, err := placementsForNodesTx(tx, mapID, affected)
	if err != nil {
		return nil, err
	}
	snapAfter, err := groupSnapshotTx(tx, groupID)
	if err != nil {
		return nil, err
	}
	snapAfter.Placements = after

	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	label := "changed a group's members"
	if len(nodeIDs) == 0 {
		label = "ungrouped " + fmt.Sprint(len(existing)) + " nodes"
	}
	if err := recordTx(tx, mapID, s.actor, ActionSaveGroup, label,
		snapBefore, snapAfter); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if len(nodeIDs) == 0 {
		return nil, nil
	}
	g, err := s.groupByID(groupID)
	return g, err
}

// GroupsFor returns every group on a map, with its membership.
func (s *Store) GroupsFor(mapID string) ([]Group, error) {
	rows, err := s.db.Query(
		`SELECT id, map_id, title, color, created_at
		 FROM groups WHERE map_id = ? ORDER BY created_at`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.MapID, &g.Title, &g.Color, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		members, err := s.groupMembers(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].NodeIDs = members
	}
	return out, nil
}

func (s *Store) groupByID(id string) (*Group, error) {
	var g Group
	err := s.db.QueryRow(
		`SELECT id, map_id, title, color, created_at FROM groups WHERE id = ?`, id).
		Scan(&g.ID, &g.MapID, &g.Title, &g.Color, &g.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	g.NodeIDs, err = s.groupMembers(id)
	return &g, err
}

func (s *Store) groupMembers(groupID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT node_id FROM map_nodes WHERE group_id = ? ORDER BY added_at`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DeleteGroup dissolves a group, leaving its member nodes exactly where they
// are. The nodes are the content; the group is only an arrangement of them.
func (s *Store) DeleteGroup(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	snap, err := groupSnapshotTx(tx, id)
	if err != nil {
		return err
	}
	if len(snap.Groups) == 0 {
		return nil
	}
	members, err := groupMembersTx(tx, id)
	if err != nil {
		return err
	}
	// The membership has to be part of the snapshot or undo would bring back
	// an empty group and quietly lose the arrangement.
	snap.Placements, err = placementsForNodesTx(tx, snap.Groups[0].MapID, members)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, id); err != nil {
		return err
	}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	if err := recordTx(tx, snap.Groups[0].MapID, s.actor, ActionDeleteGroup,
		fmt.Sprintf("ungrouped %d nodes", len(members)), snap, snap); err != nil {
		return err
	}
	return tx.Commit()
}

// --- group helpers ---------------------------------------------------------

func groupMembersTx(tx *sql.Tx, groupID string) ([]string, error) {
	rows, err := tx.Query(
		`SELECT node_id FROM map_nodes WHERE group_id = ? ORDER BY added_at`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func placementsForNodesTx(tx *sql.Tx, mapID string, nodeIDs []string) ([]placement, error) {
	out := make([]placement, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		p, err := placementTx(tx, mapID, id)
		if err != nil {
			return nil, err
		}
		if p != nil {
			out = append(out, *p)
		}
	}
	return out, nil
}

// mergeGroupMoveTx collapses a run of drags of the same group into one entry.
func mergeGroupMoveTx(tx *sql.Tx, actor, groupID string, after []placement) (bool, error) {
	var id int64
	var action UndoAction
	var inverse, forward string
	err := tx.QueryRow(
		`SELECT id, action, inverse, forward FROM undo_log
		 WHERE actor = ? AND undone = 0 ORDER BY id DESC LIMIT 1`, actor).
		Scan(&id, &action, &inverse, &forward)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil || action != ActionMoveGroup {
		return false, err
	}
	var prev snapshot
	if err := json.Unmarshal([]byte(inverse), &prev); err != nil {
		return false, err
	}
	if len(prev.Groups) != 1 || prev.Groups[0].ID != groupID {
		return false, nil
	}
	var fwd snapshot
	if err := json.Unmarshal([]byte(forward), &fwd); err != nil {
		return false, err
	}
	fwd.Placements = after
	encoded, err := json.Marshal(fwd)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(`UPDATE undo_log SET forward = ?, created_at = ? WHERE id = ?`,
		string(encoded), nowISO(), id)
	return err == nil, err
}

func union(a, b []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, list := range [][]string{a, b} {
		for _, id := range list {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

// --- assets ----------------------------------------------------------------

// RecordAsset registers a file saved into .assets against a node.
func (s *Store) RecordAsset(nodeID, relPath, mime string, size int64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO assets (id, node_id, rel_path, mime, bytes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		NewID("ast"), nullable(nodeID), relPath, mime, size, nowISO())
	return err
}

// --- helpers ---------------------------------------------------------------

func nodeTypeTx(tx *sql.Tx, id string) (ibis.NodeType, error) {
	var t ibis.NodeType
	err := tx.QueryRow(`SELECT type FROM nodes WHERE id = ?`, id).Scan(&t)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("node %s: %w", id, ErrNotFound)
	}
	return t, err
}

func untitledFor(t ibis.NodeType) string {
	switch t {
	case ibis.Question:
		return "New question?"
	case ibis.Idea:
		return "New idea"
	case ibis.Pro:
		return "Supporting argument"
	case ibis.Con:
		return "Objection"
	case ibis.Map:
		return "Embedded map"
	default:
		return "New note"
	}
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
