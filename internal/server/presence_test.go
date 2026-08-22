package server

import (
	"testing"
	"time"
)

// Presence is what makes two people in one map aware of each other, and the
// lock is the only thing standing between them and silently overwriting each
// other's typing. Both are in memory, so these are cheap to test directly.

func TestJoinAssignsDistinctNamesAndColours(t *testing.T) {
	p := newPresence()
	a := p.Join("client-a", "desktop")
	b := p.Join("client-b", "mobile")

	if a.Name == b.Name {
		t.Errorf("both participants are called %q", a.Name)
	}
	if a.Color == b.Color {
		t.Errorf("both participants are %q; the colour is what makes the canvas readable", a.Color)
	}
	if b.Surface != "mobile" {
		t.Errorf("surface = %q, want mobile", b.Surface)
	}
}

func TestRejoiningKeepsIdentity(t *testing.T) {
	// A phone that drops off the wifi for a moment must not come back as a
	// different person, or the roster grows a ghost every time the screen
	// sleeps.
	p := newPresence()
	first := p.Join("client-a", "mobile")
	again := p.Join("client-a", "mobile")

	if first.Name != again.Name || first.Color != again.Color {
		t.Errorf("identity changed on reconnect: %+v then %+v", first, again)
	}
	if len(p.Everyone()) != 1 {
		t.Errorf("rejoining created a second participant: %+v", p.Everyone())
	}
}

func TestLockBlocksEveryoneElse(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")

	if _, ok := p.Lock("a", "node-1"); !ok {
		t.Fatal("first claim should succeed")
	}
	name, ok := p.Lock("b", "node-1")
	if ok {
		t.Error("a second client took a lock somebody else holds")
	}
	if name == "" {
		t.Error("the refusal should name the holder, so the UI can say who")
	}
	// The holder can carry on with its own lock.
	if _, ok := p.Lock("a", "node-1"); !ok {
		t.Error("the holder should be able to re-claim its own lock")
	}
}

func TestCanEditMatchesTheLock(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")
	p.Lock("a", "node-1")

	if _, ok := p.CanEdit("a", "node-1"); !ok {
		t.Error("the holder must be able to edit what it holds")
	}
	if who, ok := p.CanEdit("b", "node-1"); ok || who == "" {
		t.Errorf("another client should be refused and told who: %q, %v", who, ok)
	}
	if _, ok := p.CanEdit("b", "node-2"); !ok {
		t.Error("an unlocked node should be editable by anyone")
	}
}

// The lock is only safe to enforce because it always gets released.
func TestLeavingReleasesTheLock(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")
	p.Lock("a", "node-1")

	p.Leave("a")
	if _, ok := p.CanEdit("b", "node-1"); !ok {
		t.Error("closing the tab must release the lock, or the node is stuck forever")
	}
}

func TestUnlockReleasesWithoutLeaving(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")
	p.Lock("a", "node-1")
	p.Unlock("a")

	if _, ok := p.CanEdit("b", "node-1"); !ok {
		t.Error("closing the editor should release the lock")
	}
}

func TestOneLockPerParticipant(t *testing.T) {
	// A person types in one place at a time, so opening a second editor has to
	// free the first — otherwise a facilitator moving quickly would leave a
	// trail of locked nodes behind them.
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")

	p.Lock("a", "node-1")
	p.Lock("a", "node-2")

	if _, ok := p.CanEdit("b", "node-1"); !ok {
		t.Error("the first node should have been released when the second was claimed")
	}
	if _, ok := p.CanEdit("b", "node-2"); ok {
		t.Error("the second node should be held")
	}
}

func TestStaleLockExpires(t *testing.T) {
	// A suspended laptop keeps its socket open, so disconnection alone is not
	// enough to guarantee release.
	p := newPresence()
	p.Join("a", "desktop")
	p.Join("b", "desktop")
	p.Lock("a", "node-1")

	p.mu.Lock()
	p.byID["a"].lockedAt = time.Now().Add(-LockIdle - time.Second)
	p.mu.Unlock()

	if who, ok := p.CanEdit("b", "node-1"); !ok {
		t.Errorf("a stale lock should expire, still held by %q", who)
	}
	// And the roster must agree with what the server will enforce.
	for _, who := range p.Everyone() {
		if who.ID == "a" && who.Editing != "" {
			t.Error("an expired lock is still being advertised to everyone")
		}
	}
}

func TestSelectionIsReported(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Select("a", []string{"node-1", "node-2"}, "map-1")

	everyone := p.Everyone()
	if len(everyone) != 1 || len(everyone[0].Selected) != 2 {
		t.Fatalf("selection not recorded: %+v", everyone)
	}
	// The map travels with the selection: a node id says nothing about where to
	// look for it, so following somebody who moved maps would fail silently.
	if everyone[0].MapID != "map-1" {
		t.Errorf("map not recorded: %+v", everyone[0])
	}
}

func TestViewingRecordsTheMapWithNoSelection(t *testing.T) {
	p := newPresence()
	p.Join("a", "desktop")
	p.Viewing("a", "map-2")
	if got := p.Everyone()[0].MapID; got != "map-2" {
		t.Errorf("map = %q, want map-2", got)
	}
}

func TestSelectKeepsTheKnownMapWhenNoneIsGiven(t *testing.T) {
	// An older client sends no map. Forgetting the one we already knew would
	// be worse than keeping it.
	p := newPresence()
	p.Join("a", "desktop")
	p.Viewing("a", "map-1")
	p.Select("a", []string{"node-1"}, "")
	if got := p.Everyone()[0].MapID; got != "map-1" {
		t.Errorf("map = %q; a selection with no map should not erase it", got)
	}
}

func TestEveryoneIsOrderedStably(t *testing.T) {
	// An unordered roster would reshuffle the dots on every update.
	p := newPresence()
	for _, id := range []string{"c", "a", "b"} {
		p.Join(id, "desktop")
	}
	first := p.Everyone()
	for i := 0; i < 5; i++ {
		next := p.Everyone()
		for j := range first {
			if first[j].ID != next[j].ID {
				t.Fatalf("roster order changed between calls: %+v then %+v", first, next)
			}
		}
	}
}

// A client that never joined — the CLI, or a request racing the socket — is
// neither blocked by locks nor able to take them.
func TestUnknownClientIsNotBlocked(t *testing.T) {
	p := newPresence()
	if _, ok := p.CanEdit("never-joined", "node-1"); !ok {
		t.Error("an unlocked node should be editable by anyone")
	}
	p.Join("a", "desktop")
	p.Lock("a", "node-1")
	if _, ok := p.CanEdit("never-joined", "node-1"); ok {
		t.Error("a held node should be refused even to a client with no socket")
	}
}
