package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/davidfullmer/dialogmapper/internal/ibis"
	"github.com/davidfullmer/dialogmapper/internal/store"
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
		m, err := s.st.CreateMap(in.Name, in.Description)
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
		if err := s.st.RenameMap(id, in.Name, in.Description); err != nil {
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
		if err := s.st.DeleteMap(id); err != nil {
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
	node, edge, err := s.st.CreateNode(in)
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
		if err := s.st.SetPlacement(in.MapID, id, in.X, in.Y, in.Collapsed, in.GroupID); err != nil {
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
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, err)
			return
		}
		if err := s.st.Transclude(in.MapID, id, in.X, in.Y); err != nil {
			writeErr(w, err)
			return
		}
		node, err := s.st.GetNode(id, in.MapID)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "node.transcluded", MapID: in.MapID, Payload: node})
		writeJSON(w, http.StatusOK, node)
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
		node, err := s.st.UpdateNode(id, patch)
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
			if err := s.st.RemoveFromMap(mapID, id); err != nil {
				writeErr(w, err)
				return
			}
			s.publish(r, Event{Type: "node.removedFromMap", MapID: mapID,
				Payload: map[string]any{"nodeId": id}})
			writeJSON(w, http.StatusNoContent, nil)
			return
		}
		if err := s.st.DeleteNode(id); err != nil {
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
	e, err := s.st.CreateEdge(in.MapID, in.SourceNodeID, in.TargetNodeID, in.Relationship)
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
	if err := s.st.DeleteEdge(parts[0]); err != nil {
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

	case http.MethodPost, http.MethodPut:
		var g store.Group
		if err := decode(r, &g); err != nil {
			writeErr(w, err)
			return
		}
		saved, err := s.st.UpsertGroup(g)
		if err != nil {
			writeErr(w, err)
			return
		}
		s.publish(r, Event{Type: "group.saved", MapID: saved.MapID, Payload: saved})
		writeJSON(w, http.StatusOK, saved)

	default:
		writeErr(w, errMethod)
	}
}

func (s *Server) handleGroupByID(w http.ResponseWriter, r *http.Request) {
	parts := pathTail(r, "groups")
	if len(parts) == 0 || r.Method != http.MethodDelete {
		writeErr(w, errMethod)
		return
	}
	if err := s.st.DeleteGroup(parts[0]); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, Event{Type: "group.deleted",
		MapID:   r.URL.Query().Get("mapId"),
		Payload: map[string]any{"groupId": parts[0]}})
	writeJSON(w, http.StatusNoContent, nil)
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
