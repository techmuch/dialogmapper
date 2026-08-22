package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The lock has to be refused by the server, not merely drawn in the UI.
//
// An advisory lock is no lock at all: a second tab, a page left open since
// before the lock was taken, or any client that never learned about presence
// would still overwrite whatever somebody is in the middle of typing. These
// drive the real HTTP handler.

func TestPatchIsRefusedWhileAnotherClientHoldsTheNode(t *testing.T) {
	h := newHarness(t)
	nodeID, _ := h.createNode("question", "Ship on Fridays?", "")

	// Somebody else joins and starts editing.
	h.srv.presence.Join("other-client", "desktop")
	if _, ok := h.srv.presence.Lock("other-client", nodeID); !ok {
		t.Fatal("setup: could not take the lock")
	}

	res := h.do(http.MethodPatch, "/api/nodes/"+nodeID,
		map[string]any{"title": "Overwritten"},
		map[string]string{"X-Client-Id": "me"})
	defer res.Body.Close()

	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["kind"] != "locked" {
		t.Errorf("kind = %v, want locked so the UI can tell this from a validation error", body["kind"])
	}
	if body["by"] == "" || body["by"] == nil {
		t.Error("the refusal should name the holder")
	}

	// And nothing was written.
	after, err := h.st.GetNode(nodeID, "")
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != "Ship on Fridays?" {
		t.Errorf("title = %q; the refused edit was applied anyway", after.Title)
	}
}

func TestTheHolderCanStillEdit(t *testing.T) {
	h := newHarness(t)
	nodeID, _ := h.createNode("question", "Ship on Fridays?", "")

	h.srv.presence.Join("me", "desktop")
	h.srv.presence.Lock("me", nodeID)

	res := h.do(http.MethodPatch, "/api/nodes/"+nodeID,
		map[string]any{"title": "Ship on Fridays, before noon?"},
		map[string]string{"X-Client-Id": "me"})
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("the holder was blocked from its own lock: %d", res.StatusCode)
	}
}

func TestUnlockedNodesAreEditableByAnyone(t *testing.T) {
	h := newHarness(t)
	nodeID, _ := h.createNode("question", "Ship on Fridays?", "")

	h.srv.presence.Join("other-client", "desktop")
	h.srv.presence.Lock("other-client", nodeID)
	h.srv.presence.Unlock("other-client")

	res := h.do(http.MethodPatch, "/api/nodes/"+nodeID,
		map[string]any{"title": "Now editable"},
		map[string]string{"X-Client-Id": "me"})
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d after the lock was released", res.StatusCode)
	}
}

// Disconnecting is the release path that matters most: it is what stops a
// closed laptop locking a node for the rest of the meeting.
func TestLeavingFreesTheNodeOverHTTP(t *testing.T) {
	h := newHarness(t)
	nodeID, _ := h.createNode("question", "Ship on Fridays?", "")

	h.srv.presence.Join("gone", "desktop")
	h.srv.presence.Lock("gone", nodeID)
	h.srv.presence.Leave("gone")

	res := h.do(http.MethodPatch, "/api/nodes/"+nodeID,
		map[string]any{"title": "Free again"},
		map[string]string{"X-Client-Id": "me"})
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; a departed client is still holding the node", res.StatusCode)
	}
}

// The CLI has no socket and takes no locks, but it must still respect one:
// `dialogmapper node edit` while somebody is typing is the same collision.
func TestTheCLIIsAlsoBlockedByALock(t *testing.T) {
	h := newHarness(t)
	nodeID, _ := h.createNode("question", "Ship on Fridays?", "")

	h.srv.presence.Join("browser", "desktop")
	h.srv.presence.Lock("browser", nodeID)

	// No X-Client-Id at all, which is what a non-browser caller looks like.
	res := h.do(http.MethodPatch, "/api/nodes/"+nodeID,
		map[string]any{"title": "From a script"}, nil)
	defer res.Body.Close()

	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — a lock must hold against every door", res.StatusCode)
	}
}
