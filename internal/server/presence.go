package server

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Who is here, what they are looking at, and what they are holding open.
//
// All of it lives in memory. Presence describes a moment, not the map: a lock
// that outlived the server would be a lock nobody could release, and a
// selection saved to disk would be a lie the next time anyone opened the
// project.

// LockIdle releases a lock whose holder stopped touching it.
//
// A browser that crashes or a phone that sleeps closes its socket and the lock
// goes with it, but a laptop suspended mid-edit can hold a connection open for
// a while, and nobody else should be blocked on that.
const LockIdle = 2 * time.Minute

// Participant is one connected client, as everyone else sees them.
type Participant struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	// Selected is what this participant currently has selected; Editing is the
	// one node they hold open, which nobody else may change.
	Selected []string `json:"selected,omitempty"`
	Editing  string   `json:"editing,omitempty"`
	// Surface is "desktop" or "mobile", so the canvas can say where somebody
	// is rather than just that they exist.
	Surface string `json:"surface,omitempty"`
}

// Colours are picked to stay distinguishable against the dark canvas and from
// the node type colours, which already own blue, amber, green and red.
var participantColors = []string{
	"#f7768e", "#9ece6a", "#7aa2f7", "#e0af68",
	"#bb9af7", "#2ac3de", "#ff9e64", "#41a6b5",
}

type presenceState struct {
	Participant
	lockedAt time.Time
}

// Presence tracks everyone connected.
type Presence struct {
	mu      sync.RWMutex
	byID    map[string]*presenceState
	nextNum int
}

func newPresence() *Presence {
	return &Presence{byID: map[string]*presenceState{}}
}

// Join registers a client. Reconnecting with the same id keeps the same name
// and colour, so a phone that drops off the wifi for a moment does not come
// back as somebody new.
func (p *Presence) Join(id, surface string) Participant {
	p.mu.Lock()
	defer p.mu.Unlock()

	if existing, ok := p.byID[id]; ok {
		existing.Surface = surface
		return existing.Participant
	}
	p.nextNum++
	st := &presenceState{Participant: Participant{
		ID:      id,
		Name:    fmt.Sprintf("Participant %d", p.nextNum),
		Color:   participantColors[(p.nextNum-1)%len(participantColors)],
		Surface: surface,
	}}
	p.byID[id] = st
	return st.Participant
}

// Leave drops a client and everything it held. This is what makes a lock safe
// to enforce: closing the tab always releases it.
func (p *Presence) Leave(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.byID, id)
}

// Select records what a client has selected.
func (p *Presence) Select(id string, nodeIDs []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if st, ok := p.byID[id]; ok {
		st.Selected = nodeIDs
	}
}

// Rename changes a participant's display name.
func (p *Presence) Rename(id, name string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if st, ok := p.byID[id]; ok && name != "" {
		st.Name = name
	}
}

// Lock claims a node for editing.
//
// Returns the current holder's name and false when somebody else has it. One
// node per participant: opening a second editor releases the first, since a
// person can only be typing in one place.
func (p *Presence) Lock(id, nodeID string) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if holder, name := p.holderLocked(nodeID); holder != "" && holder != id {
		return name, false
	}
	st, ok := p.byID[id]
	if !ok {
		// A client that never joined — a CLI run, or a request arriving before
		// the socket opened — cannot hold locks, and is not blocked by this.
		return "", true
	}
	st.Editing = nodeID
	st.lockedAt = time.Now()
	return "", true
}

// Unlock releases whatever this client was editing.
func (p *Presence) Unlock(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if st, ok := p.byID[id]; ok {
		st.Editing = ""
	}
}

// Holder returns the id and name of whoever is editing a node.
func (p *Presence) Holder(nodeID string) (string, string) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.holderLocked(nodeID)
}

// CanEdit reports whether a client may change a node, and who is in the way.
func (p *Presence) CanEdit(clientID, nodeID string) (string, bool) {
	holder, name := p.Holder(nodeID)
	if holder == "" || holder == clientID {
		return "", true
	}
	return name, false
}

// holderLocked expects the caller to hold the mutex. Locks older than LockIdle
// are treated as released, so a suspended laptop cannot block a meeting.
func (p *Presence) holderLocked(nodeID string) (string, string) {
	if nodeID == "" {
		return "", ""
	}
	for _, st := range p.byID {
		if st.Editing == nodeID && time.Since(st.lockedAt) < LockIdle {
			return st.ID, st.Name
		}
	}
	return "", ""
}

// Everyone returns the current roster, ordered by name so the list does not
// reshuffle itself on every update.
func (p *Presence) Everyone() []Participant {
	p.mu.RLock()
	defer p.mu.RUnlock()

	out := make([]Participant, 0, len(p.byID))
	for _, st := range p.byID {
		who := st.Participant
		// An expired lock is not reported, so the indicator matches what the
		// server will actually enforce.
		if who.Editing != "" && time.Since(st.lockedAt) >= LockIdle {
			who.Editing = ""
		}
		out = append(out, who)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// broadcastPresence pushes the roster to everyone.
//
// The whole roster rather than a delta, for the same reason state events carry
// whole objects: reconstructing who is where from partial updates is a
// reliable way to end up showing a lock that was released a minute ago.
func (s *Server) broadcastPresence() {
	s.hub.broadcast(Event{Type: "presence", Payload: s.presence.Everyone()})
}
