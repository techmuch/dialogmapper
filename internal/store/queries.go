package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/davidfullmer/dialogmapper/internal/ibis"
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
	_, err := s.db.Exec(
		`INSERT INTO maps (id, name, description, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		m.ID, m.Name, m.Description, m.CreatedAt, m.UpdatedAt)
	if err != nil {
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
func (s *Store) DeleteMap(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.db.Exec(`DELETE FROM maps WHERE id = ?`, id)
	return err
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
		// Retyping a node can invalidate edges that were legal before. Check
		// every incident edge rather than silently leaving a broken graph.
		if err := s.validateRetype(id, *patch.Type); err != nil {
			return nil, err
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
	if merged, err := mergeEditTx(tx, s.actor, id, current); err != nil {
		return nil, err
	} else if !merged {
		if err := clearRedoTx(tx, s.actor); err != nil {
			return nil, err
		}
		if err := recordTx(tx, "", s.actor, ActionUpdateNode,
			"edited "+describeNode(current),
			snapshot{Node: &before}, snapshot{Node: current}); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	current.Content.normalize()
	return current, nil
}

// mergeEditTx folds this edit into the previous journal entry when it is the
// same actor editing the same node consecutively, and reports whether it did.
func mergeEditTx(tx *sql.Tx, actor, nodeID string, after *Node) (bool, error) {
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
	if err != nil {
		return false, err
	}
	if action != ActionUpdateNode {
		return false, nil
	}
	var prev snapshot
	if err := json.Unmarshal([]byte(inverse), &prev); err != nil {
		return false, err
	}
	if prev.Node == nil || prev.Node.ID != nodeID {
		return false, nil
	}
	// Same node, same actor, most recent entry: update the forward state and
	// the label, leaving the original "before" snapshot untouched.
	forward, err := json.Marshal(snapshot{Node: after})
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(
		`UPDATE undo_log SET forward = ?, label = ?, created_at = ? WHERE id = ?`,
		string(forward), "edited "+describeNode(after), nowISO(), id)
	return err == nil, err
}

// validateRetype rejects a type change that would orphan existing edges,
// naming the specific edge at fault.
func (s *Store) validateRetype(nodeID string, newType ibis.NodeType) error {
	rows, err := s.db.Query(
		`SELECT e.relationship_type, e.source_node_id, e.target_node_id,
		        sn.type, tn.type
		 FROM edges e
		 JOIN nodes sn ON sn.id = e.source_node_id
		 JOIN nodes tn ON tn.id = e.target_node_id
		 WHERE e.source_node_id = ? OR e.target_node_id = ?`, nodeID, nodeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var rel ibis.Relationship
		var srcID, tgtID string
		var srcType, tgtType ibis.NodeType
		if err := rows.Scan(&rel, &srcID, &tgtID, &srcType, &tgtType); err != nil {
			return err
		}
		if srcID == nodeID {
			srcType = newType
		}
		if tgtID == nodeID {
			tgtType = newType
		}
		if err := ibis.ValidateEdge(srcType, tgtType, rel); err != nil {
			return fmt.Errorf(
				"cannot change type to %s: an existing edge would become invalid: %w",
				newType, err)
		}
	}
	return rows.Err()
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

// Transclude adds an existing node to another map. This is the operation that
// makes a node shared rather than copied: the same id, two placements.
func (s *Store) Transclude(mapID, nodeID string, x, y *float64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := nowISO()
	res, err := tx.Exec(
		`INSERT INTO map_nodes (map_id, node_id, x, y, added_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (map_id, node_id) DO NOTHING`,
		mapID, nodeID, x, y, now)
	if err != nil {
		return err
	}
	// Already on this map: nothing changed, so nothing to journal. Recording
	// a no-op would make one Ctrl-Z appear to do nothing at all.
	if n, _ := res.RowsAffected(); n == 0 {
		return tx.Commit()
	}

	snap := snapshot{Placements: []placement{
		{MapID: mapID, NodeID: nodeID, X: x, Y: y, AddedAt: now},
	}}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	if err := recordTx(tx, mapID, s.actor, ActionTransclude,
		"inserted a shared node", snap, snap); err != nil {
		return err
	}
	return tx.Commit()
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
// by the mobile search bar and by "insert existing node" on the canvas, which
// is why excludeMapID exists: hide what is already on screen.
func (s *Store) SearchNodes(q string, excludeMapID string, limit int) ([]Node, error) {
	if limit <= 0 {
		limit = 50
	}
	pattern := "%" + strings.ToLower(strings.TrimSpace(q)) + "%"
	sqlStr := `
		SELECT n.id, n.type, n.title, n.content, n.map_ref_id,
		       n.created_at, n.updated_at,
		       (SELECT count(*) FROM map_nodes mn2 WHERE mn2.node_id = n.id)
		FROM nodes n
		WHERE (? = '%%' OR lower(n.title) LIKE ? OR lower(n.content) LIKE ?)`
	args := []any{pattern, pattern, pattern}
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
	return scanNodes(rows)
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

// UpsertGroup creates or moves a bounding box on a map.
func (s *Store) UpsertGroup(g Group) (*Group, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// The inverse of creating a group is deleting it; the inverse of moving
	// one is its previous geometry. A zero CreatedAt in the inverse payload is
	// the marker for "this did not exist before".
	var inverse snapshot

	if g.ID == "" {
		g.ID = NewID("grp")
		g.CreatedAt = nowISO()
		if g.Color == "" {
			g.Color = "slate"
		}
		if _, err := tx.Exec(
			`INSERT INTO groups (id, map_id, title, color, x, y, w, h, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			g.ID, g.MapID, g.Title, g.Color, g.X, g.Y, g.W, g.H, g.CreatedAt); err != nil {
			return nil, err
		}
		inverse = snapshot{Groups: []Group{{ID: g.ID, MapID: g.MapID}}}
	} else {
		prev, err := groupSnapshotTx(tx, g.ID)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(
			`UPDATE groups SET title = ?, color = ?, x = ?, y = ?, w = ?, h = ?
			 WHERE id = ?`, g.Title, g.Color, g.X, g.Y, g.W, g.H, g.ID); err != nil {
			return nil, err
		}
		inverse = prev
	}

	if err := clearRedoTx(tx, s.actor); err != nil {
		return nil, err
	}
	if err := recordTx(tx, g.MapID, s.actor, ActionSaveGroup, "changed a group",
		inverse, snapshot{Groups: []Group{g}}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &g, nil
}

// GroupsFor returns every bounding box on a map.
func (s *Store) GroupsFor(mapID string) ([]Group, error) {
	rows, err := s.db.Query(
		`SELECT id, map_id, title, color, x, y, w, h, created_at
		 FROM groups WHERE map_id = ? ORDER BY created_at`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.MapID, &g.Title, &g.Color,
			&g.X, &g.Y, &g.W, &g.H, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// DeleteGroup removes a bounding box, leaving its member nodes in place.
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
	if _, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, id); err != nil {
		return err
	}
	if err := clearRedoTx(tx, s.actor); err != nil {
		return err
	}
	if err := recordTx(tx, snap.Groups[0].MapID, s.actor, ActionDeleteGroup,
		"deleted a group", snap, snap); err != nil {
		return err
	}
	return tx.Commit()
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
