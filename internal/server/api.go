package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/techmuch/dialogmapper/internal/ibis"
	"github.com/techmuch/dialogmapper/internal/store"
)

// --- helpers ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Headers are already sent; log-free here because the connection is
		// gone in practice and there is nothing useful to say to the client.
		_ = err
	}
}

// writeErr maps domain errors onto status codes and, crucially, passes the
// IBIS explanation through to the client. A rejected edge should teach the
// user (or the agent) what would have been legal.
func writeErr(w http.ResponseWriter, err error) {
	body := map[string]any{"error": err.Error()}
	code := http.StatusInternalServerError

	var ve *ibis.ValidationError
	var ce *store.ConflictError
	switch {
	case errors.Is(err, store.ErrNotFound):
		code = http.StatusNotFound
	case errors.As(err, &ve):
		code = http.StatusUnprocessableEntity
		body["kind"] = "ibis_violation"
		body["source"] = ve.Source
		body["target"] = ve.Target
		body["relationship"] = ve.Relationship
		body["reason"] = ve.Reason
		body["suggestions"] = ve.Suggestions
	case errors.As(err, &ce):
		code = http.StatusConflict
		body["kind"] = "conflict"
	case errors.Is(err, errMethod):
		code = http.StatusMethodNotAllowed
	case isClientError(err):
		code = http.StatusBadRequest
	}
	writeJSON(w, code, body)
}

// isClientError recognises validation failures raised as plain errors by the
// store, which are the user's fault rather than the server's.
func isClientError(err error) bool {
	msg := strings.ToLower(err.Error())
	for _, s := range []string{
		"is required", "unknown node type", "cannot link to itself",
		"is not on map", "would create a cycle", "cannot change type",
	} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}

// pathTail returns the segments after /api/<resource>/.
func pathTail(r *http.Request, resource string) []string {
	p := strings.TrimPrefix(r.URL.Path, "/api/"+resource+"/")
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}

func clientID(r *http.Request) string { return r.Header.Get("X-Client-Id") }

// actorStore returns a store view that attributes undo entries to the calling
// client. Undo is per-actor, so this is what stops one person's Ctrl-Z from
// reversing what somebody else just contributed from a phone.
//
// Reads deliberately go through s.st directly: there is nothing to attribute,
// and routing them here would only invite the mistake of attributing a read.
func (s *Server) actorStore(r *http.Request) *store.Store {
	return s.st.As(actorFor(r))
}

func actorFor(r *http.Request) string {
	if id := clientID(r); id != "" {
		return id
	}
	// A client that sends no id still gets a coherent history of its own,
	// rather than sharing one journal with every other anonymous caller.
	return "anonymous"
}

// publish fans a change out to every client and advances the external-change
// baseline so the data_version poller does not also fire a blanket refresh.
func (s *Server) publish(r *http.Request, e Event) {
	e.Origin = clientID(r)
	s.noteOwnWrite()
	s.hub.broadcast(e)
}

// --- endpoints -------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"root":          s.st.Root(),
		"schemaVersion": store.SchemaVersion,
	})
}

func (s *Server) handleGrammar(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, ibis.Grammar())
}

func (s *Server) handleMaps(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		maps, err := s.st.ListMaps()
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"maps": maps})

	case http.MethodPost:
		var in struct{ Name, Description string }
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		m, err := s.actorStore(r).CreateMap(in.Name, in.Description)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "map.created", MapID: m.ID, Payload: m})
		writeJSON(w, http.StatusCreated, m)

	default:
		writeErr(w, errMethod)
	}
}

func (s *Server) handleMapByID(w http.ResponseWriter, r *http.Request) {
	parts := pathTail(r, "maps")
	if len(parts) == 0 {
		writeErr(w, fmt.Errorf("map id is required"))
		return
	}
	id := parts[0]

	// /api/maps/{id}/graph — everything needed to render, in one round trip.
	if len(parts) > 1 && parts[1] == "graph" {
		if r.Method != http.MethodGet {
			writeErr(w, errMethod)
			return
		}
		g, err := s.st.Graph(id)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, g)
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.st.GetMap(id)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, m)

	case http.MethodPatch:
		var in struct{ Name, Description string }
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		if err := s.actorStore(r).RenameMap(id, in.Name, in.Description); err != nil {
			writeErr(w, err)
			return
		}
		m, err := s.st.GetMap(id)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "map.updated", MapID: id, Payload: m})
		writeJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if err := s.actorStore(r).DeleteMap(id); err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "map.deleted", MapID: id})
		writeJSON(w, http.StatusNoContent, nil)

	default:
		writeErr(w, errMethod)
	}
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errMethod)
		return
	}
	var in store.NewNodeInput
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	node, edge, err := s.actorStore(r).CreateNode(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	// One event carrying both objects: the client must not render a node for
	// a frame before its connecting edge exists, or the layout will jump.
	s.publish(r, Event{Type: "node.created", MapID: in.MapID,
		Payload: map[string]any{"node": node, "edge": edge}})
	writeJSON(w, http.StatusCreated, map[string]any{"node": node, "edge": edge})
}

func (s *Server) handleNodeByID(w http.ResponseWriter, r *http.Request) {
	parts := pathTail(r, "nodes")
	if len(parts) == 0 {
		writeErr(w, fmt.Errorf("node id is required"))
		return
	}
	id := parts[0]

	// /api/nodes/bulk — one change across a whole selection, recorded as one
	// undo entry rather than one per node.
	if id == "bulk" {
		if r.Method != http.MethodPatch {
			writeErr(w, errMethod)
			return
		}
		var in struct {
			NodeIDs []string `json:"nodeIds"`
			store.BulkOps
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		updated, err := s.actorStore(r).BulkUpdateNodes(in.NodeIDs, in.BulkOps)
		if err != nil {
			writeErr(w, err)
			return
		}
		// A bulk edit touches nodes that may appear on several maps, so
		// clients refetch rather than patching each one from a diff.
		s.publish(r, Event{Type: "graph.invalidated",
			Payload: map[string]any{"reason": "several nodes were edited"}})
		writeJSON(w, http.StatusOK, map[string]any{"nodes": updated})
		return
	}
	mapID := r.URL.Query().Get("mapId")

	// /api/nodes/{id}/placement — drag end, collapse, group assignment.
	if len(parts) > 1 && parts[1] == "placement" {
		if r.Method != http.MethodPut {
			writeErr(w, errMethod)
			return
		}
		var in struct {
			MapID     string   `json:"mapId"`
			X         *float64 `json:"x"`
			Y         *float64 `json:"y"`
			Collapsed *bool    `json:"collapsed"`
			GroupID   *string  `json:"groupId"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		if err := s.actorStore(r).SetPlacement(in.MapID, id, in.X, in.Y, in.Collapsed, in.GroupID); err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "node.moved", MapID: in.MapID,
			Payload: map[string]any{
				"nodeId": id, "x": in.X, "y": in.Y,
				"collapsed": in.Collapsed, "groupId": in.GroupID,
			}})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	// /api/nodes/{id}/transclude — add an existing node to another map.
	if len(parts) > 1 && parts[1] == "transclude" {
		if r.Method != http.MethodPost {
			writeErr(w, errMethod)
			return
		}
		var in struct {
			MapID string   `json:"mapId"`
			X     *float64 `json:"x"`
			Y     *float64 `json:"y"`
			// Optional: link the inserted node beneath this one, in the same
			// transaction, so one Ctrl-Z reverses the whole thing.
			ParentID     string            `json:"parentId"`
			Relationship ibis.Relationship `json:"relationshipType"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		edge, err := s.actorStore(r).Transclude(store.TranscludeInput{
			MapID:        in.MapID,
			NodeID:       id,
			X:            in.X,
			Y:            in.Y,
			ParentID:     in.ParentID,
			Relationship: in.Relationship,
		})
		if err != nil {
			writeErr(w, err)
			return
		}
		node, err := s.st.GetNode(id, in.MapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "node.transcluded", MapID: in.MapID, Payload: node})
		if edge != nil {
			s.publish(r, Event{Type: "edge.created", MapID: in.MapID, Payload: edge})
		}
		writeJSON(w, http.StatusOK, map[string]any{"node": node, "edge": edge})
		return
	}

	switch r.Method {
	case http.MethodGet:
		node, err := s.st.GetNode(id, mapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, node)

	case http.MethodPatch:
		var patch store.NodePatch
		if err := decode(r, &patch); err != nil {
			writeErr(w, err)
			return
		}
		// Refused here rather than only in the UI. An advisory lock is no lock
		// at all: a second tab, a stale page, or a client that never learned
		// about presence would still overwrite whatever somebody is typing.
		if holder, ok := s.presence.CanEdit(clientID(r), id); !ok {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": fmt.Sprintf("%s is editing this node", holder),
				"kind":  "locked",
				"by":    holder,
			})
			return
		}
		node, err := s.actorStore(r).UpdateNode(id, patch)
		if err != nil {
			writeErr(w, err)
			return
		}
		// A node edit is visible on every map it appears in, so the event is
		// not scoped to one map id.
		s.publish(r, Event{Type: "node.updated", Payload: node})
		writeJSON(w, http.StatusOK, node)

	case http.MethodDelete:
		// Removing from one map is not the same as deleting a shared node,
		// and the client must say which it means.
		if mapID != "" && r.URL.Query().Get("everywhere") != "true" {
			if err := s.actorStore(r).RemoveFromMap(mapID, id); err != nil {
				writeErr(w, err)
				return
			}
			s.publish(r, Event{Type: "node.removedFromMap", MapID: mapID,
				Payload: map[string]any{"nodeId": id}})
			writeJSON(w, http.StatusNoContent, nil)
			return
		}
		if err := s.actorStore(r).DeleteNode(id); err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "node.deleted", Payload: map[string]any{"nodeId": id}})
		writeJSON(w, http.StatusNoContent, nil)

	default:
		writeErr(w, errMethod)
	}
}

func (s *Server) handleEdges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errMethod)
		return
	}
	var in struct {
		MapID        string            `json:"mapId"`
		SourceNodeID string            `json:"sourceNodeId"`
		TargetNodeID string            `json:"targetNodeId"`
		Relationship ibis.Relationship `json:"relationshipType"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	e, err := s.actorStore(r).CreateEdge(in.MapID, in.SourceNodeID, in.TargetNodeID, in.Relationship)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, Event{Type: "edge.created", MapID: in.MapID, Payload: e})
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) handleEdgeByID(w http.ResponseWriter, r *http.Request) {
	parts := pathTail(r, "edges")
	if len(parts) == 0 {
		writeErr(w, fmt.Errorf("edge id is required"))
		return
	}
	if r.Method != http.MethodDelete {
		writeErr(w, errMethod)
		return
	}
	if err := s.actorStore(r).DeleteEdge(parts[0]); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, Event{Type: "edge.deleted",
		MapID:   r.URL.Query().Get("mapId"),
		Payload: map[string]any{"edgeId": parts[0]}})
	writeJSON(w, http.StatusNoContent, nil)
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gs, err := s.st.GroupsFor(r.URL.Query().Get("mapId"))
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": gs})

	case http.MethodPost:
		// Grouping is an assertion about the current selection, so the request
		// is the node list rather than a rectangle.
		var in struct {
			MapID   string   `json:"mapId"`
			Title   string   `json:"title"`
			Color   string   `json:"color"`
			NodeIDs []string `json:"nodeIds"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		saved, err := s.actorStore(r).CreateGroup(in.MapID, in.Title, in.Color, in.NodeIDs)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "group.saved", MapID: saved.MapID, Payload: saved})
		writeJSON(w, http.StatusCreated, saved)

	default:
		writeErr(w, errMethod)
	}
}

func (s *Server) handleGroupByID(w http.ResponseWriter, r *http.Request) {
	parts := pathTail(r, "groups")
	if len(parts) == 0 {
		writeErr(w, fmt.Errorf("group id is required"))
		return
	}
	id := parts[0]

	// /api/groups/{id}/move — drag end for a whole group.
	if len(parts) > 1 && parts[1] == "move" {
		if r.Method != http.MethodPost {
			writeErr(w, errMethod)
			return
		}
		var in struct {
			MapID string  `json:"mapId"`
			DX    float64 `json:"dx"`
			DY    float64 `json:"dy"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		if _, err := s.actorStore(r).MoveGroup(in.MapID, id, in.DX, in.DY); err != nil {
			writeErr(w, err)
			return
		}
		// A group move changes many node positions at once, so clients refetch
		// rather than trying to patch each one from a delta.
		s.publish(r, Event{Type: "graph.invalidated", MapID: in.MapID,
			Payload: map[string]any{"reason": "a group was moved"}})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	// /api/groups/{id}/members — add to or remove from a group.
	if len(parts) > 1 && parts[1] == "members" {
		if r.Method != http.MethodPut {
			writeErr(w, errMethod)
			return
		}
		var in struct {
			MapID   string   `json:"mapId"`
			NodeIDs []string `json:"nodeIds"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		saved, err := s.actorStore(r).SetGroupMembers(in.MapID, id, in.NodeIDs)
		if err != nil {
			writeErr(w, err)
			return
		}
		if saved == nil {
			// Emptying a group dissolves it rather than leaving an invisible
			// row behind.
			s.publish(r, Event{Type: "group.deleted", MapID: in.MapID,
				Payload: map[string]any{"groupId": id}})
			writeJSON(w, http.StatusNoContent, nil)
			return
		}
		s.publish(r, Event{Type: "group.saved", MapID: saved.MapID, Payload: saved})
		writeJSON(w, http.StatusOK, saved)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var in struct{ Title, Color string }
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		saved, err := s.actorStore(r).UpdateGroup(id, in.Title, in.Color)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "group.saved", MapID: saved.MapID, Payload: saved})
		writeJSON(w, http.StatusOK, saved)

	case http.MethodDelete:
		if err := s.actorStore(r).DeleteGroup(id); err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "group.deleted",
			MapID:   r.URL.Query().Get("mapId"),
			Payload: map[string]any{"groupId": id}})
		writeJSON(w, http.StatusNoContent, nil)

	default:
		writeErr(w, errMethod)
	}
}

// handleSearch backs both the mobile search bar and the canvas "insert
// existing node" flow.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errMethod)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	nodes, err := s.st.SearchNodes(
		r.URL.Query().Get("q"),
		r.URL.Query().Get("excludeMapId"),
		limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

// handleUndo reverses the calling client's most recent action.
//
// The response says what was undone so the UI can name it. "Undone" on its own
// is close to useless — the user needs to know whether the thing that
// disappeared is the thing they meant to reverse.
func (s *Server) handleUndo(w http.ResponseWriter, r *http.Request) {
	s.undoStep(w, r, false)
}

// handleRedo reapplies the most recently undone action.
func (s *Server) handleRedo(w http.ResponseWriter, r *http.Request) {
	s.undoStep(w, r, true)
}

func (s *Server) undoStep(w http.ResponseWriter, r *http.Request, redo bool) {
	// GET reports what is available without changing anything, so the toolbar
	// can label and disable its buttons.
	actor := actorFor(r)
	mapID := r.URL.Query().Get("mapId")

	if r.Method == http.MethodGet {
		undo, redoDepth, err := s.st.UndoDepth(actor, mapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		next, err := s.st.PeekUndo(actor, mapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		nextRedo, err := s.st.PeekRedo(actor, mapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"undoDepth": undo, "redoDepth": redoDepth,
			"nextUndo": next, "nextRedo": nextRedo,
		})
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, errMethod)
		return
	}

	var entry *store.UndoEntry
	var err error
	if redo {
		entry, err = s.st.As(actor).Redo(actor, mapID)
	} else {
		entry, err = s.st.As(actor).Undo(actor, mapID)
	}
	if errors.Is(err, store.ErrNothingToUndo) || errors.Is(err, store.ErrNothingToRedo) {
		// Not an error worth a red toast: the user pressed Ctrl-Z once too
		// often, which is normal.
		writeJSON(w, http.StatusOK, map[string]any{"applied": false, "reason": err.Error()})
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}

	// An undo can touch nodes, edges and placements across more than one map,
	// so clients refetch rather than trying to patch their local graph from a
	// diff. Correctness beats the round trip here.
	s.publish(r, Event{
		Type: "graph.invalidated", MapID: entry.MapID,
		Payload: map[string]any{
			"reason": entry.Label,
			"undo":   !redo,
			"entry":  entry,
		},
	})

	undoDepth, redoDepth, _ := s.st.UndoDepth(actor, mapID)
	writeJSON(w, http.StatusOK, map[string]any{
		"applied": true, "entry": entry,
		"undoDepth": undoDepth, "redoDepth": redoDepth,
	})
}

// handleFeed is the mobile linear view: recent activity, newest first.
func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errMethod)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	nodes, err := s.st.RecentNodes(r.URL.Query().Get("mapId"), limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}
