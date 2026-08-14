// Package server exposes the dialog map over HTTP and WebSocket, and serves
// the embedded frontend.
package server

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/davidfullmer/dialogmapper/internal/store"
	"github.com/davidfullmer/dialogmapper/internal/web"
)

// Server is the HTTP handler for one project.
type Server struct {
	st  *store.Store
	hub *Hub
	mux *http.ServeMux
	ui  fs.FS

	// knownVersion is the SQLite data_version this process last accounted
	// for. See WatchExternalChanges for why it is tracked rather than a
	// simple "did we just write?" flag.
	knownVersion atomic.Int64

	// pollInterval is how often external writes are checked for. Tests turn
	// it down so they assert on behaviour rather than on the clock.
	pollInterval time.Duration
}

// MediaURLPrefix is where files from the project's .assets directory are
// served. It must never overlap with the compiled frontend's asset directory,
// which Vite fixes at /assets/.
const MediaURLPrefix = "/media/"

// defaultPollInterval balances responsiveness against waking the disk. Changes
// made in this process are broadcast immediately regardless; this only governs
// how fast an edit from another process shows up.
const defaultPollInterval = 750 * time.Millisecond

// New builds a server bound to a store.
func New(st *store.Store) (*Server, error) {
	ui, err := web.FS()
	if err != nil {
		return nil, err
	}
	s := &Server{
		st: st, hub: newHub(), ui: ui, mux: http.NewServeMux(),
		pollInterval: defaultPollInterval,
	}
	s.routes()
	go s.hub.run()
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Local-first means the browser and server are the same machine, but a
	// page on another origin could still reach 127.0.0.1. Rejecting foreign
	// origins stops a random website from editing the user's maps.
	if origin := r.Header.Get("Origin"); origin != "" && !isLocalOrigin(origin, r.Host) {
		http.Error(w, "cross-origin requests are not accepted", http.StatusForbidden)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	api := func(p string, h http.HandlerFunc) {
		s.mux.Handle("/api/"+p, http.HandlerFunc(h))
	}

	api("health", s.handleHealth)
	api("grammar", s.handleGrammar)
	api("maps", s.handleMaps)
	api("maps/", s.handleMapByID) // /api/maps/{id} and /api/maps/{id}/graph
	api("nodes", s.handleNodes)
	api("nodes/", s.handleNodeByID)
	api("edges", s.handleEdges)
	api("edges/", s.handleEdgeByID)
	api("groups", s.handleGroups)
	api("groups/", s.handleGroupByID)
	api("search", s.handleSearch)
	api("feed", s.handleFeed)
	api("assets", s.handleAssetUpload)
	api("undo", s.handleUndo)
	api("redo", s.handleRedo)

	s.mux.Handle("/ws", http.HandlerFunc(s.handleWS))

	// Local media is served straight off disk so that images survive a
	// rebuild of the binary and stay editable outside the app.
	//
	// The prefix is /media/ and not /assets/ for a specific reason: Vite emits
	// the compiled frontend into /assets/, so mounting user media there
	// shadowed the bundle. Every request for the app's own JS and CSS was
	// answered by this file server, found nothing on disk, and 404'd — which
	// presents as a blank page, since the HTML and the body background load
	// fine and only the script is missing.
	s.mux.Handle(MediaURLPrefix, http.StripPrefix(MediaURLPrefix,
		http.FileServer(http.Dir(s.st.AssetsDir()))))

	s.mux.Handle("/", http.HandlerFunc(s.handleUI))
}

// CloseClients disconnects every WebSocket, used during shutdown.
func (s *Server) CloseClients() { s.hub.closeAll() }

// --- static frontend -------------------------------------------------------

var mobileUA = regexp.MustCompile(`(?i)android|iphone|ipod|iemobile|blackberry|opera mini|mobile safari`)

// handleUI serves the SPA, falling back to index.html for client-side routes.
// Mobile user agents are steered to /m, which renders the linear capture view
// instead of the canvas — a pinch-zoom graph on a phone is unusable, and the
// mobile job to be done (drop a thought into a running conversation) is
// different enough to deserve its own surface.
func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" && mobileUA.MatchString(r.UserAgent()) {
		http.Redirect(w, r, "/m", http.StatusFound)
		return
	}

	clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if clean == "" || clean == "." {
		clean = "index.html"
	}

	f, err := s.ui.Open(clean)
	if err != nil {
		// Unknown path with no file extension: a client-side route. Anything
		// with an extension that is missing is a genuine 404, and returning
		// index.html for a missing .js would produce a baffling MIME error.
		if path.Ext(clean) != "" {
			http.NotFound(w, r)
			return
		}
		s.serveIndex(w, r)
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil || st.IsDir() {
		s.serveIndex(w, r)
		return
	}

	if ct := mime.TypeByExtension(path.Ext(clean)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	// Vite fingerprints asset filenames, so those are immutable; index.html
	// must never be cached or a rebuild would not be picked up.
	if strings.HasPrefix(clean, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}

	if rs, ok := f.(io.ReadSeeker); ok {
		http.ServeContent(w, r, clean, st.ModTime(), rs)
		return
	}
	_, _ = io.Copy(w, f)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	f, err := s.ui.Open("index.html")
	if err != nil {
		http.Error(w,
			"frontend not built: run `npm run build` in web/ and rebuild the binary",
			http.StatusNotImplemented)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, f)
}

// --- external change watching ---------------------------------------------

// WatchExternalChanges polls SQLite's data_version, which increments whenever
// a different connection commits. That covers a second `dialogmapper` process,
// a script, or someone editing with the sqlite3 CLI — all of which would
// otherwise leave open browsers showing stale graphs.
//
// Writes made through this server are already broadcast as precise events, so
// they must not also trigger a blanket invalidation. The way that is
// suppressed matters: an earlier version counted our own writes and skipped
// one poll per write, which silently swallowed a genuine external change that
// happened to land in the same polling interval. Instead, every write through
// this server records the resulting data_version as the new baseline, so only
// a version this process has never seen counts as external.
func (s *Server) WatchExternalChanges(ctx context.Context) {
	v, err := s.st.DataVersion()
	if err != nil {
		log.Printf("dialogmapper: cannot read data_version, external change watch disabled: %v", err)
		return
	}
	s.knownVersion.Store(v)

	interval := s.pollInterval
	if interval <= 0 {
		interval = defaultPollInterval
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			v, err := s.st.DataVersion()
			if err != nil || v == s.knownVersion.Load() {
				continue
			}
			s.knownVersion.Store(v)
			s.hub.broadcast(Event{Type: "graph.invalidated", Payload: map[string]any{
				"reason": "another process changed the database",
			}})
		}
	}
}

// noteOwnWrite advances the baseline past a change this process just made.
func (s *Server) noteOwnWrite() {
	if v, err := s.st.DataVersion(); err == nil {
		s.knownVersion.Store(v)
	}
}

func isLocalOrigin(origin, host string) bool {
	origin = strings.TrimSuffix(origin, "/")
	for _, scheme := range []string{"http://", "https://"} {
		if strings.TrimPrefix(origin, scheme) == host {
			return true
		}
	}
	return false
}

var errMethod = errors.New("method not allowed")
