package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

// Undo, built on an explicit inverse journal.
//
// Two design points worth stating, because both are easy to get wrong:
//
//  1. Undo is per-actor. Dialog mapping is often live and collaborative — a
//     facilitator on the canvas, participants on phones. A global "undo the
//     last thing" would let the facilitator silently delete a contribution
//     somebody just made, with no indication anything was lost. Each journal
//     entry records who made it, and undo only ever walks back your own.
//
//  2. Restoring a deleted node means restoring its edges and its placements on
//     every map, not just the row in `nodes`. Deleting a shared node cascades
//     widely; an undo that brought back a bare node would quietly destroy the
//     structure around it, which is worse than not offering undo at all.

// UndoAction names the kind of change recorded, and doubles as the tag for
// the inverse payload.
type UndoAction string

const (
	ActionCreateNode  UndoAction = "node.create"
	ActionUpdateNode  UndoAction = "node.update"
	ActionDeleteNode  UndoAction = "node.delete"
	ActionRemoveNode  UndoAction = "node.removeFromMap"
	ActionTransclude  UndoAction = "node.transclude"
	ActionMoveNode    UndoAction = "node.move"
	ActionCreateEdge  UndoAction = "edge.create"
	ActionDeleteEdge  UndoAction = "edge.delete"
	ActionSaveGroup   UndoAction = "group.save"
	ActionDeleteGroup UndoAction = "group.delete"
	ActionMoveGroup   UndoAction = "group.move"
)

// CLIActor is the actor recorded for changes made by command-line runs, so a
// `dialogmapper seed` can be undone from the CLI without the canvas losing
// its own history.
const CLIActor = "cli"

// snapshot is the serialized form of everything needed to recreate a node
// exactly, including where it sat on every map and what it was linked to.
type snapshot struct {
	Node       *Node       `json:"node,omitempty"`
	Placements []placement `json:"placements,omitempty"`
	Edges      []Edge      `json:"edges,omitempty"`
	Groups     []Group     `json:"groups,omitempty"`
}

type placement struct {
	MapID     string   `json:"mapId"`
	NodeID    string   `json:"nodeId"`
	X         *float64 `json:"x"`
	Y         *float64 `json:"y"`
	Collapsed bool     `json:"collapsed"`
	GroupID   *string  `json:"groupId,omitempty"`
	AddedAt   string   `json:"addedAt"`
}

// UndoEntry is one reversible action as reported to callers.
type UndoEntry struct {
	ID     int64      `json:"id"`
	MapID  string     `json:"mapId"`
	Actor  string     `json:"actor"`
	Action UndoAction `json:"action"`
	Label  string     `json:"label"`
}

// ErrNothingToUndo is returned when an actor's journal is exhausted.
var ErrNothingToUndo = errors.New("nothing to undo")

// ErrNothingToRedo is returned when there is no undone entry to reapply.
var ErrNothingToRedo = errors.New("nothing to redo")

// record appends a journal entry inside an existing transaction. Journalling
// shares the caller's transaction so a change and its inverse are committed
// together — a mutation that succeeded without a recoverable inverse would be
// a silent data-loss risk.
func recordTx(tx *sql.Tx, mapID, actor string, action UndoAction, label string,
	inverse, forward any) error {

	inv, err := json.Marshal(inverse)
	if err != nil {
		return fmt.Errorf("encode undo inverse: %w", err)
	}
	fwd := []byte("{}")
	if forward != nil {
		if fwd, err = json.Marshal(forward); err != nil {
			return fmt.Errorf("encode undo forward: %w", err)
		}
	}
	_, err = tx.Exec(
		`INSERT INTO undo_log (map_id, actor, action, label, inverse, forward, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		nullable(mapID), actor, action, label, string(inv), string(fwd), nowISO())
	return err
}

// clearRedoTx discards the redo tail for this actor.
//
// Making a fresh change after undoing something invalidates everything that
// was undone: redoing then would reapply an action against a world that has
// moved on, which is how undo systems produce corrupt state. Dropping the tail
// is the standard, safe answer.
func clearRedoTx(tx *sql.Tx, actor string) error {
	_, err := tx.Exec(`DELETE FROM undo_log WHERE actor = ? AND undone = 1`, actor)
	return err
}

// UndoDepth reports how many actions this actor can undo and redo, which is
// what enables or greys out the toolbar buttons.
func (s *Store) UndoDepth(actor, mapID string) (undo, redo int, err error) {
	q := func(undone int) (int, error) {
		var n int
		var e error
		if mapID == "" {
			e = s.db.QueryRow(
				`SELECT count(*) FROM undo_log WHERE actor = ? AND undone = ?`,
				actor, undone).Scan(&n)
		} else {
			e = s.db.QueryRow(
				`SELECT count(*) FROM undo_log
				 WHERE actor = ? AND undone = ? AND (map_id = ? OR map_id IS NULL)`,
				actor, undone, mapID).Scan(&n)
		}
		return n, e
	}
	if undo, err = q(0); err != nil {
		return 0, 0, err
	}
	redo, err = q(1)
	return undo, redo, err
}

// PeekUndo describes the action that Undo would reverse, without doing it.
func (s *Store) PeekUndo(actor, mapID string) (*UndoEntry, error) {
	return s.peek(actor, mapID, 0)
}

// PeekRedo describes the action that Redo would reapply.
func (s *Store) PeekRedo(actor, mapID string) (*UndoEntry, error) {
	return s.peek(actor, mapID, 1)
}

func (s *Store) peek(actor, mapID string, undone int) (*UndoEntry, error) {
	order := "DESC"
	if undone == 1 {
		// Redo replays in the order things were undone: oldest undone first.
		order = "ASC"
	}
	var e UndoEntry
	var mapCol sql.NullString
	err := s.db.QueryRow(
		`SELECT id, map_id, actor, action, label FROM undo_log
		 WHERE actor = ? AND undone = ? AND (? = '' OR map_id = ? OR map_id IS NULL)
		 ORDER BY id `+order+` LIMIT 1`,
		actor, undone, mapID, mapID).
		Scan(&e.ID, &mapCol, &e.Actor, &e.Action, &e.Label)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if mapCol.Valid {
		e.MapID = mapCol.String
	}
	return &e, nil
}

// Undo reverses this actor's most recent action and returns what it undid.
func (s *Store) Undo(actor, mapID string) (*UndoEntry, error) {
	return s.step(actor, mapID, false)
}

// Redo reapplies the most recently undone action.
func (s *Store) Redo(actor, mapID string) (*UndoEntry, error) {
	return s.step(actor, mapID, true)
}

func (s *Store) step(actor, mapID string, redo bool) (*UndoEntry, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	wantUndone, order := 0, "DESC"
	if redo {
		wantUndone, order = 1, "ASC"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var (
		e       UndoEntry
		mapCol  sql.NullString
		inverse string
		forward string
	)
	err = tx.QueryRow(
		`SELECT id, map_id, actor, action, label, inverse, forward FROM undo_log
		 WHERE actor = ? AND undone = ? AND (? = '' OR map_id = ? OR map_id IS NULL)
		 ORDER BY id `+order+` LIMIT 1`,
		actor, wantUndone, mapID, mapID).
		Scan(&e.ID, &mapCol, &e.Actor, &e.Action, &e.Label, &inverse, &forward)
	if errors.Is(err, sql.ErrNoRows) {
		if redo {
			return nil, ErrNothingToRedo
		}
		return nil, ErrNothingToUndo
	}
	if err != nil {
		return nil, err
	}
	if mapCol.Valid {
		e.MapID = mapCol.String
	}

	payload := inverse
	if redo {
		payload = forward
	}
	if err := applyInverseTx(tx, e.Action, payload, redo); err != nil {
		return nil, fmt.Errorf("undo %s: %w", e.Label, err)
	}

	if _, err := tx.Exec(`UPDATE undo_log SET undone = ? WHERE id = ?`,
		boolToInt(!redo), e.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &e, nil
}

// applyInverseTx performs the reversal. `redo` inverts the direction, so a
// single switch covers both and the two can never drift apart.
func applyInverseTx(tx *sql.Tx, action UndoAction, payload string, redo bool) error {
	var snap snapshot
	if err := json.Unmarshal([]byte(payload), &snap); err != nil {
		return fmt.Errorf("decode undo payload: %w", err)
	}

	switch action {
	// Creating something is undone by deleting it, and redone by recreating it.
	case ActionCreateNode:
		if redo {
			return restoreSnapshotTx(tx, snap)
		}
		if snap.Node == nil {
			return errors.New("journal entry has no node to remove")
		}
		_, err := tx.Exec(`DELETE FROM nodes WHERE id = ?`, snap.Node.ID)
		return err

	// Deleting is undone by restoring the whole snapshot: the node, every
	// placement, and every edge that pointed at it on any map.
	case ActionDeleteNode, ActionRemoveNode:
		if redo {
			if snap.Node == nil {
				return errors.New("journal entry has no node to delete")
			}
			if action == ActionRemoveNode {
				return removePlacementsTx(tx, snap)
			}
			_, err := tx.Exec(`DELETE FROM nodes WHERE id = ?`, snap.Node.ID)
			return err
		}
		return restoreSnapshotTx(tx, snap)

	case ActionTransclude:
		if redo {
			return restorePlacementsTx(tx, snap)
		}
		return removePlacementsTx(tx, snap)

	// Field edits and moves store the previous values on one side and the new
	// values on the other, so both directions are a plain write.
	case ActionUpdateNode:
		if snap.Node == nil {
			return errors.New("journal entry has no node state")
		}
		content, err := snap.Node.Content.marshal()
		if err != nil {
			return err
		}
		_, err = tx.Exec(
			`UPDATE nodes SET type = ?, title = ?, content = ?, updated_at = ?
			 WHERE id = ?`,
			snap.Node.Type, snap.Node.Title, content, nowISO(), snap.Node.ID)
		return err

	case ActionMoveNode, ActionMoveGroup:
		// Moving a group is moving its members, so both directions are the
		// same write: restore the recorded placements.
		return restorePlacementStateTx(tx, snap.Placements)

	case ActionCreateEdge:
		if redo {
			return restoreEdgesTx(tx, snap.Edges)
		}
		return deleteEdgesTx(tx, snap.Edges)

	case ActionDeleteEdge:
		if redo {
			return deleteEdgesTx(tx, snap.Edges)
		}
		return restoreEdgesTx(tx, snap.Edges)

	case ActionSaveGroup:
		// Groups carry no geometry, so reversing one is entirely about
		// membership: put every affected node back in whatever group it was in
		// before, and remove the group itself if it did not exist then.
		//
		// An empty CreatedAt is the marker for "this group did not exist".
		if len(snap.Groups) == 0 {
			return errors.New("journal entry has no group state")
		}
		g := snap.Groups[0]
		if g.CreatedAt == "" {
			if err := restorePlacementStateTx(tx, snap.Placements); err != nil {
				return err
			}
			_, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, g.ID)
			return err
		}
		if err := upsertGroupTx(tx, g); err != nil {
			return err
		}
		return restorePlacementStateTx(tx, snap.Placements)

	case ActionDeleteGroup:
		if redo {
			if len(snap.Groups) == 0 {
				return errors.New("journal entry has no group state")
			}
			_, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, snap.Groups[0].ID)
			return err
		}
		for _, g := range snap.Groups {
			if err := upsertGroupTx(tx, g); err != nil {
				return err
			}
		}
		// Membership is the group, so it comes back with it.
		return restorePlacementStateTx(tx, snap.Placements)
	}
	return fmt.Errorf("cannot reverse %q", action)
}

// restorePlacementStateTx writes recorded placements back verbatim, including
// which group each node belonged to. Used by every reversal that concerns
// where nodes sit rather than whether they exist.
func restorePlacementStateTx(tx *sql.Tx, placements []placement) error {
	for _, p := range placements {
		if _, err := tx.Exec(
			`UPDATE map_nodes SET x = ?, y = ?, collapsed = ?, group_id = ?
			 WHERE map_id = ? AND node_id = ?`,
			p.X, p.Y, boolToInt(p.Collapsed), p.GroupID, p.MapID, p.NodeID); err != nil {
			return err
		}
	}
	return nil
}

func restoreSnapshotTx(tx *sql.Tx, snap snapshot) error {
	if snap.Node == nil {
		return errors.New("journal entry has no node to restore")
	}
	n := snap.Node
	content, err := n.Content.marshal()
	if err != nil {
		return err
	}
	// The original id is reused so that any surviving reference — an edge on
	// another map, an export already written — still points at the same node.
	if _, err := tx.Exec(
		`INSERT INTO nodes (id, type, title, content, map_ref_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET
		     type = excluded.type, title = excluded.title,
		     content = excluded.content, updated_at = excluded.updated_at`,
		n.ID, n.Type, n.Title, content, n.MapRefID, n.CreatedAt, nowISO()); err != nil {
		return fmt.Errorf("restore node: %w", err)
	}
	if err := restorePlacementsTx(tx, snap); err != nil {
		return err
	}
	return restoreEdgesTx(tx, snap.Edges)
}

func restorePlacementsTx(tx *sql.Tx, snap snapshot) error {
	for _, p := range snap.Placements {
		if _, err := tx.Exec(
			`INSERT INTO map_nodes (map_id, node_id, x, y, collapsed, group_id, added_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (map_id, node_id) DO UPDATE SET
			     x = excluded.x, y = excluded.y, collapsed = excluded.collapsed`,
			p.MapID, p.NodeID, p.X, p.Y, boolToInt(p.Collapsed), p.GroupID,
			orDefault(p.AddedAt, nowISO())); err != nil {
			return fmt.Errorf("restore placement: %w", err)
		}
	}
	return nil
}

func removePlacementsTx(tx *sql.Tx, snap snapshot) error {
	for _, p := range snap.Placements {
		if _, err := tx.Exec(
			`DELETE FROM edges WHERE map_id = ? AND (source_node_id = ? OR target_node_id = ?)`,
			p.MapID, p.NodeID, p.NodeID); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`DELETE FROM map_nodes WHERE map_id = ? AND node_id = ?`,
			p.MapID, p.NodeID); err != nil {
			return err
		}
	}
	return nil
}

func restoreEdgesTx(tx *sql.Tx, edges []Edge) error {
	for _, e := range edges {
		// Restoring an edge whose other endpoint has since been deleted is not
		// an error worth failing the whole undo over; skip it and carry on.
		var ok int
		if err := tx.QueryRow(
			`SELECT count(*) FROM map_nodes
			 WHERE map_id = ? AND node_id IN (?, ?)`,
			e.MapID, e.SourceNodeID, e.TargetNodeID).Scan(&ok); err != nil {
			return err
		}
		if ok < 2 {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO edges (id, map_id, source_node_id, target_node_id,
			                    relationship_type, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (map_id, source_node_id, target_node_id, relationship_type)
			 DO NOTHING`,
			e.ID, e.MapID, e.SourceNodeID, e.TargetNodeID, e.Relationship,
			orDefault(e.CreatedAt, nowISO())); err != nil {
			return fmt.Errorf("restore edge: %w", err)
		}
	}
	return nil
}

func deleteEdgesTx(tx *sql.Tx, edges []Edge) error {
	for _, e := range edges {
		if _, err := tx.Exec(`DELETE FROM edges WHERE id = ?`, e.ID); err != nil {
			return err
		}
	}
	return nil
}

func upsertGroupTx(tx *sql.Tx, g Group) error {
	_, err := tx.Exec(
		`INSERT INTO groups (id, map_id, title, color, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET
		     title = excluded.title, color = excluded.color`,
		g.ID, g.MapID, g.Title, g.Color, orDefault(g.CreatedAt, nowISO()))
	return err
}

// --- snapshot helpers ------------------------------------------------------

// nodeSnapshotTx captures a node and everything that would be lost with it.
func nodeSnapshotTx(tx *sql.Tx, nodeID string, scopeMapID string) (snapshot, error) {
	var snap snapshot

	n := Node{}
	var payload string
	var mapRef sql.NullString
	err := tx.QueryRow(
		`SELECT id, type, title, content, map_ref_id, created_at, updated_at
		 FROM nodes WHERE id = ?`, nodeID).
		Scan(&n.ID, &n.Type, &n.Title, &payload, &mapRef, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return snap, fmt.Errorf("node %s: %w", nodeID, ErrNotFound)
	}
	if err != nil {
		return snap, err
	}
	if mapRef.Valid {
		n.MapRefID = &mapRef.String
	}
	if err := json.Unmarshal([]byte(payload), &n.Content); err != nil {
		return snap, err
	}
	snap.Node = &n

	// scopeMapID narrows the snapshot to one map, for "remove from this map".
	// Empty means the node is being destroyed everywhere, so capture it all.
	placeQ := `SELECT map_id, node_id, x, y, collapsed, group_id, added_at
	           FROM map_nodes WHERE node_id = ?`
	args := []any{nodeID}
	if scopeMapID != "" {
		placeQ += ` AND map_id = ?`
		args = append(args, scopeMapID)
	}
	rows, err := tx.Query(placeQ, args...)
	if err != nil {
		return snap, err
	}
	for rows.Next() {
		var p placement
		var group sql.NullString
		if err := rows.Scan(&p.MapID, &p.NodeID, &p.X, &p.Y, &p.Collapsed,
			&group, &p.AddedAt); err != nil {
			rows.Close()
			return snap, err
		}
		if group.Valid {
			p.GroupID = &group.String
		}
		snap.Placements = append(snap.Placements, p)
	}
	rows.Close()

	edgeQ := `SELECT id, map_id, source_node_id, target_node_id, relationship_type, created_at
	          FROM edges WHERE (source_node_id = ? OR target_node_id = ?)`
	eArgs := []any{nodeID, nodeID}
	if scopeMapID != "" {
		edgeQ += ` AND map_id = ?`
		eArgs = append(eArgs, scopeMapID)
	}
	erows, err := tx.Query(edgeQ, eArgs...)
	if err != nil {
		return snap, err
	}
	defer erows.Close()
	for erows.Next() {
		var e Edge
		if err := erows.Scan(&e.ID, &e.MapID, &e.SourceNodeID, &e.TargetNodeID,
			&e.Relationship, &e.CreatedAt); err != nil {
			return snap, err
		}
		snap.Edges = append(snap.Edges, e)
	}
	return snap, erows.Err()
}

func groupSnapshotTx(tx *sql.Tx, groupID string) (snapshot, error) {
	var snap snapshot
	var g Group
	err := tx.QueryRow(
		`SELECT id, map_id, title, color, created_at FROM groups WHERE id = ?`, groupID).
		Scan(&g.ID, &g.MapID, &g.Title, &g.Color, &g.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return snap, nil
	}
	if err != nil {
		return snap, err
	}
	members, err := groupMembersTx(tx, groupID)
	if err != nil {
		return snap, err
	}
	g.NodeIDs = members
	snap.Groups = []Group{g}
	return snap, nil
}

// describe produces the phrase shown in the "Undone: …" toast. Naming what
// was reversed is most of the value of undo: it tells the user whether the
// thing they meant to undo is the thing that went away.
func describeNode(n *Node) string {
	title := strings.TrimSpace(n.Title)
	if title == "" {
		title = "untitled"
	}
	if len(title) > 40 {
		title = title[:40] + "…"
	}
	return fmt.Sprintf("%s %q", labelForType(n.Type), title)
}

func labelForType(t ibis.NodeType) string {
	switch t {
	case ibis.Question:
		return "Question"
	case ibis.Idea:
		return "Idea"
	case ibis.Pro:
		return "Pro"
	case ibis.Con:
		return "Con"
	case ibis.Map:
		return "Map"
	default:
		return "Note"
	}
}
