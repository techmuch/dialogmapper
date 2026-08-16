package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/techmuch/dialogmapper/internal/store"
)

// End-to-end tests against a real HTTP server backed by a real SQLite file.
// Nothing here is mocked: these are the paths a browser actually takes, which
// is where the interesting failures live — SPA fallback, content types,
// origin checks, multipart uploads, and the WebSocket fan-out.

type harness struct {
	t      *testing.T
	srv    *Server
	http   *httptest.Server
	st     *store.Store
	dir    string
	mapID  string
	client *http.Client
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	srv, err := New(st)
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)

	m, err := st.CreateMap("Test map", "")
	if err != nil {
		t.Fatal(err)
	}

	return &harness{
		t: t, srv: srv, http: ts, st: st, dir: dir, mapID: m.ID,
		// Redirects are an assertion target (mobile routing), never a
		// convenience to follow silently.
		client: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (h *harness) do(method, path string, body any, headers map[string]string) *http.Response {
	h.t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			h.t.Fatal(err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, h.http.URL+path, r)
	if err != nil {
		h.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := h.client.Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func (h *harness) json(method, path string, body any, out any) *http.Response {
	h.t.Helper()
	res := h.do(method, path, body, nil)
	defer res.Body.Close()
	if out != nil {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			h.t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return res
}

// createNode is the single call the capture loop leans on: node plus edge.
func (h *harness) createNode(typ, title, parentID string) (string, map[string]any) {
	h.t.Helper()
	body := map[string]any{"type": typ, "title": title, "mapId": h.mapID}
	if parentID != "" {
		body["parentId"] = parentID
	}
	var out struct {
		Node map[string]any `json:"node"`
		Edge map[string]any `json:"edge"`
	}
	res := h.json(http.MethodPost, "/api/nodes", body, &out)
	if res.StatusCode != http.StatusCreated {
		h.t.Fatalf("create %s: status %d", typ, res.StatusCode)
	}
	return out.Node["id"].(string), out.Edge
}

// --- static frontend ------------------------------------------------------

func TestServesEmbeddedSPA(t *testing.T) {
	h := newHarness(t)

	res := h.do(http.MethodGet, "/", nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("GET / = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("GET / content-type = %q, want text/html", ct)
	}
	// index.html must never be cached, or a rebuilt binary would keep serving
	// the old asset hashes from the browser cache.
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-cache") {
		t.Errorf("index.html cache-control = %q, want no-cache", cc)
	}
}

// TestIndexReferencesAreActuallyServable is the test whose absence let a blank
// page ship. Fetching "/" only proves the HTML exists; the app is dead unless
// the script and stylesheet that HTML points at also load. They did not: user
// media was mounted at /assets/, the same prefix Vite emits the bundle into,
// so every request for the app's own JS was answered by the media file server
// and 404'd. Nothing rendered, and there was no JavaScript error to find.
func TestIndexReferencesAreActuallyServable(t *testing.T) {
	h := newHarness(t)

	res := h.do(http.MethodGet, "/", nil, nil)
	body, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}

	refs := indexAssetRefs(string(body))
	if len(refs) == 0 {
		t.Fatal("index.html references no scripts or stylesheets; is the frontend built?")
	}

	for _, ref := range refs {
		res := h.do(http.MethodGet, ref, nil, nil)
		ct := res.Header.Get("Content-Type")
		n, _ := io.Copy(io.Discard, res.Body)
		res.Body.Close()

		if res.StatusCode != http.StatusOK {
			t.Errorf("index.html references %s but it returns %d", ref, res.StatusCode)
			continue
		}
		if n == 0 {
			t.Errorf("%s served an empty body", ref)
		}
		// A browser refuses a stylesheet or module served as text/plain, so a
		// 200 alone is not enough to prove the page will work.
		switch {
		case strings.HasSuffix(ref, ".js"):
			if !strings.Contains(ct, "javascript") {
				t.Errorf("%s content-type = %q, want a javascript type", ref, ct)
			}
		case strings.HasSuffix(ref, ".css"):
			if !strings.Contains(ct, "text/css") {
				t.Errorf("%s content-type = %q, want text/css", ref, ct)
			}
		}
	}
}

// indexAssetRefs pulls same-origin src= and href= paths out of the built HTML.
func indexAssetRefs(html string) []string {
	var out []string
	for _, attr := range []string{`src="`, `href="`} {
		rest := html
		for {
			i := strings.Index(rest, attr)
			if i < 0 {
				break
			}
			rest = rest[i+len(attr):]
			j := strings.Index(rest, `"`)
			if j < 0 {
				break
			}
			ref := rest[:j]
			rest = rest[j:]
			if strings.HasPrefix(ref, "/") {
				out = append(out, ref)
			}
		}
	}
	return out
}

// TestMediaDoesNotShadowTheFrontend pins the invariant directly, so that
// moving either mount point fails loudly rather than blanking the page.
func TestMediaDoesNotShadowTheFrontend(t *testing.T) {
	if strings.HasPrefix("/assets/", MediaURLPrefix) || strings.HasPrefix(MediaURLPrefix, "/assets/") {
		t.Fatalf("media prefix %q collides with the frontend's /assets/ directory",
			MediaURLPrefix)
	}
}

func TestClientSideRouteFallsBackToIndex(t *testing.T) {
	h := newHarness(t)
	res := h.do(http.MethodGet, "/some/deep/client/route", nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("extensionless route = %d, want 200 (SPA fallback)", res.StatusCode)
	}
}

func TestMissingAssetIsARealNotFound(t *testing.T) {
	h := newHarness(t)
	// Returning index.html for a missing .js produces a "Unexpected token <"
	// MIME error in the console, which is a genuinely baffling way to learn
	// that a file is missing.
	for _, path := range []string{"/assets/nope.js", "/assets/gone.css", "/favicon.png"} {
		res := h.do(http.MethodGet, path, nil, nil)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, res.StatusCode)
		}
	}
}

func TestMobileUserAgentIsRedirected(t *testing.T) {
	h := newHarness(t)

	cases := []struct {
		name, ua string
		wantLoc  string
	}{
		{"iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Mobile Safari/604.1", "/m"},
		{"Android", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36", "/m"},
		{"desktop Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := h.do(http.MethodGet, "/", nil, map[string]string{"User-Agent": c.ua})
			defer res.Body.Close()
			if c.wantLoc == "" {
				if res.StatusCode != http.StatusOK {
					t.Errorf("desktop should get the canvas, got %d", res.StatusCode)
				}
				return
			}
			if res.StatusCode != http.StatusFound {
				t.Fatalf("status = %d, want 302", res.StatusCode)
			}
			if loc := res.Header.Get("Location"); loc != c.wantLoc {
				t.Errorf("Location = %q, want %q", loc, c.wantLoc)
			}
		})
	}
}

// --- origin policy --------------------------------------------------------

func TestCrossOriginRequestsAreRejected(t *testing.T) {
	h := newHarness(t)
	// The server binds localhost, but any website the user visits can also
	// reach 127.0.0.1. Without this check, a random page could rewrite maps.
	res := h.do(http.MethodPost, "/api/maps",
		map[string]string{"Name": "hijacked"},
		map[string]string{"Origin": "https://evil.example"})
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin POST = %d, want 403", res.StatusCode)
	}

	maps, err := h.st.ListMaps()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range maps {
		if m.Name == "hijacked" {
			t.Fatal("a rejected request still wrote to the database")
		}
	}
}

func TestSameOriginRequestsAreAllowed(t *testing.T) {
	h := newHarness(t)
	origin := h.http.URL // httptest gives http://127.0.0.1:port
	res := h.do(http.MethodGet, "/api/health", nil, map[string]string{"Origin": origin})
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("same-origin request = %d, want 200", res.StatusCode)
	}
}

// --- graph API ------------------------------------------------------------

func TestCreateNodeCreatesEdgeInOneCall(t *testing.T) {
	h := newHarness(t)

	qID, edge := h.createNode("question", "Ship on Fridays?", "")
	if edge != nil {
		t.Error("a root node should not produce an edge")
	}

	ideaID, edge := h.createNode("idea", "Freeze Friday deploys", qID)
	if edge == nil {
		t.Fatal("child node should come back with its connecting edge")
	}
	// The relationship was not specified: the grammar must infer it, which is
	// what lets the capture loop stay one round trip per keystroke.
	if rel := edge["relationshipType"]; rel != "responds_to" {
		t.Errorf("inferred relationship = %v, want responds_to", rel)
	}

	_, edge = h.createNode("pro", "Fewer weekend pages", ideaID)
	if rel := edge["relationshipType"]; rel != "supports" {
		t.Errorf("inferred relationship = %v, want supports", rel)
	}

	var g struct {
		Nodes []map[string]any `json:"nodes"`
		Edges []map[string]any `json:"edges"`
	}
	h.json(http.MethodGet, "/api/maps/"+h.mapID+"/graph", nil, &g)
	if len(g.Nodes) != 3 || len(g.Edges) != 2 {
		t.Errorf("graph = %d nodes / %d edges, want 3/2", len(g.Nodes), len(g.Edges))
	}
}

func TestIllegalEdgeReturnsActionableError(t *testing.T) {
	h := newHarness(t)
	qID, _ := h.createNode("question", "Ship on Fridays?", "")

	res := h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "pro", "title": "nope", "mapId": h.mapID,
		"parentId": qID, "relationshipType": "supports",
	}, nil)
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", res.StatusCode)
	}

	var body struct {
		Error       string   `json:"error"`
		Kind        string   `json:"kind"`
		Reason      string   `json:"reason"`
		Suggestions []string `json:"suggestions"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Kind != "ibis_violation" {
		t.Errorf("kind = %q, want ibis_violation", body.Kind)
	}
	// The whole point of the structured error is that a caller — human or
	// agent — learns what would have worked. A bare "400" teaches nothing.
	if body.Reason == "" {
		t.Error("rejection carries no reason")
	}
	if len(body.Suggestions) == 0 {
		t.Fatal("rejection offers no legal alternative")
	}
	var mentionsSupports bool
	for _, s := range body.Suggestions {
		if strings.Contains(s, "supports") {
			mentionsSupports = true
		}
	}
	if !mentionsSupports {
		t.Errorf("suggestions should show where a Pro can attach, got %v", body.Suggestions)
	}

	// And nothing may have been written.
	var g struct {
		Nodes []map[string]any `json:"nodes"`
	}
	h.json(http.MethodGet, "/api/maps/"+h.mapID+"/graph", nil, &g)
	if len(g.Nodes) != 1 {
		t.Errorf("rejected create left %d nodes behind, want 1", len(g.Nodes))
	}
}

func TestTransclusionOverHTTP(t *testing.T) {
	h := newHarness(t)
	qID, _ := h.createNode("question", "Shared question?", "")

	var m2 struct {
		ID string `json:"id"`
	}
	h.json(http.MethodPost, "/api/maps", map[string]string{"Name": "Second"}, &m2)

	var node struct {
		ID       string   `json:"id"`
		MapCount int      `json:"mapCount"`
		MapIDs   []string `json:"mapIds"`
	}
	res := h.json(http.MethodPost, "/api/nodes/"+qID+"/transclude",
		map[string]any{"mapId": m2.ID}, &node)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("transclude = %d", res.StatusCode)
	}
	if node.MapCount != 2 {
		t.Errorf("mapCount = %d, want 2 (drives the shared badge)", node.MapCount)
	}

	// Removing from one map must leave the other intact.
	res = h.do(http.MethodDelete, "/api/nodes/"+qID+"?mapId="+h.mapID, nil, nil)
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("remove from map = %d, want 204", res.StatusCode)
	}
	var still struct {
		MapCount int `json:"mapCount"`
	}
	res = h.json(http.MethodGet, "/api/nodes/"+qID, nil, &still)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("node should survive removal from one map, got %d", res.StatusCode)
	}
	if still.MapCount != 1 {
		t.Errorf("mapCount after removal = %d, want 1", still.MapCount)
	}
}

func TestSearchExcludesTheCurrentMap(t *testing.T) {
	h := newHarness(t)
	h.createNode("question", "Distinctive phrase here", "")

	var scoped struct {
		Nodes []map[string]any `json:"nodes"`
	}
	h.json(http.MethodGet,
		"/api/search?q=Distinctive&excludeMapId="+h.mapID, nil, &scoped)
	if len(scoped.Nodes) != 0 {
		t.Errorf("nodes already on the map should be hidden from insert-existing, got %d",
			len(scoped.Nodes))
	}

	var all struct {
		Nodes []map[string]any `json:"nodes"`
	}
	h.json(http.MethodGet, "/api/search?q=Distinctive", nil, &all)
	if len(all.Nodes) != 1 {
		t.Errorf("unscoped search found %d, want 1", len(all.Nodes))
	}
}

func TestGrammarEndpointMatchesEnforcement(t *testing.T) {
	h := newHarness(t)
	var g struct {
		NodeTypes []string         `json:"nodeTypes"`
		Rules     []map[string]any `json:"rules"`
	}
	h.json(http.MethodGet, "/api/grammar", nil, &g)
	if len(g.NodeTypes) == 0 || len(g.Rules) == 0 {
		t.Fatal("grammar endpoint returned nothing for agents to read")
	}
	for _, r := range g.Rules {
		if r["description"] == "" || r["description"] == nil {
			t.Errorf("rule %v published without a description", r["relationship"])
		}
	}
}

// --- assets ---------------------------------------------------------------

func TestAssetUploadRoundTrip(t *testing.T) {
	h := newHarness(t)
	png := []byte{
		0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	}

	upload := func(filename string) (path, storage string) {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		part, err := w.CreateFormFile("file", filename)
		if err != nil {
			t.Fatal(err)
		}
		part.Write(png)
		w.Close()

		req, _ := http.NewRequest(http.MethodPost, h.http.URL+"/api/assets", &buf)
		req.Header.Set("Content-Type", w.FormDataContentType())
		res, err := h.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusCreated {
			b, _ := io.ReadAll(res.Body)
			t.Fatalf("upload = %d: %s", res.StatusCode, b)
		}
		var out struct {
			Asset       map[string]any `json:"asset"`
			StoragePath string         `json:"storagePath"`
		}
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out.Asset["path"].(string), out.StoragePath
	}

	path, storage := upload("screenshot.png")

	// Stored relative to the project, so zipping the directory keeps images
	// resolvable on another machine.
	if !strings.HasPrefix(storage, store.AssetsDirName+"/") {
		t.Errorf("storagePath = %q, want a path under %s/", storage, store.AssetsDirName)
	}
	// The URL the browser is handed must not sit under the frontend's own
	// asset prefix, or it would be shadowed by the embedded bundle.
	if !strings.HasPrefix(path, MediaURLPrefix) {
		t.Errorf("asset URL = %q, want it under %s", path, MediaURLPrefix)
	}
	if _, err := os.Stat(filepath.Join(h.dir, storage)); err != nil {
		t.Errorf("file not written to disk: %v", err)
	}

	// And the browser can fetch it back at the URL it was handed.
	res := h.do(http.MethodGet, path, nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("GET %s = %d, want 200", path, res.StatusCode)
	}

	// Content addressing: the same bytes under a different name must not
	// produce a second copy on disk.
	path2, _ := upload("same-image-renamed.png")
	if path != path2 {
		t.Errorf("identical content stored twice: %s vs %s", path, path2)
	}
	entries, err := os.ReadDir(filepath.Join(h.dir, store.AssetsDirName))
	if err != nil {
		t.Fatal(err)
	}
	var pngs int
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".png") {
			pngs++
		}
	}
	if pngs != 1 {
		t.Errorf("found %d png files, want 1 (deduplicated by content hash)", pngs)
	}
}

func TestUploadFilenameCannotEscapeAssetsDir(t *testing.T) {
	h := newHarness(t)
	// The filename comes from a browser and must never steer the write path.
	for _, name := range []string{"../../escape.png", "evil.php", "no-extension"} {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		part, _ := w.CreateFormFile("file", name)
		part.Write([]byte("data"))
		w.Close()

		req, _ := http.NewRequest(http.MethodPost, h.http.URL+"/api/assets", &buf)
		req.Header.Set("Content-Type", w.FormDataContentType())
		res, err := h.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var out struct {
			StoragePath string `json:"storagePath"`
		}
		json.NewDecoder(res.Body).Decode(&out)
		res.Body.Close()

		if strings.Contains(out.StoragePath, "..") {
			t.Errorf("%q produced a traversing path %q", name, out.StoragePath)
		}
		written := filepath.Join(h.dir, out.StoragePath)
		if rel, err := filepath.Rel(h.dir, written); err != nil || strings.HasPrefix(rel, "..") {
			t.Errorf("%q wrote outside the project: %s", name, written)
		}
	}
}

// --- undo ------------------------------------------------------------------

// undoState reads the depth/labels endpoint for a given client.
func (h *harness) undoState(client string) struct {
	UndoDepth int              `json:"undoDepth"`
	RedoDepth int              `json:"redoDepth"`
	NextUndo  *store.UndoEntry `json:"nextUndo"`
	NextRedo  *store.UndoEntry `json:"nextRedo"`
} {
	h.t.Helper()
	var out struct {
		UndoDepth int              `json:"undoDepth"`
		RedoDepth int              `json:"redoDepth"`
		NextUndo  *store.UndoEntry `json:"nextUndo"`
		NextRedo  *store.UndoEntry `json:"nextRedo"`
	}
	res := h.do(http.MethodGet, "/api/undo?mapId="+h.mapID, nil,
		map[string]string{"X-Client-Id": client})
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		h.t.Fatal(err)
	}
	return out
}

func (h *harness) undoAs(client string, path string) struct {
	Applied bool             `json:"applied"`
	Entry   *store.UndoEntry `json:"entry"`
	Reason  string           `json:"reason"`
} {
	h.t.Helper()
	var out struct {
		Applied bool             `json:"applied"`
		Entry   *store.UndoEntry `json:"entry"`
		Reason  string           `json:"reason"`
	}
	res := h.do(http.MethodPost, path+"?mapId="+h.mapID, nil,
		map[string]string{"X-Client-Id": client})
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		h.t.Fatalf("%s = %d: %s", path, res.StatusCode, b)
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		h.t.Fatal(err)
	}
	return out
}

func (h *harness) graphSize() (nodes, edges int) {
	h.t.Helper()
	var g struct {
		Nodes []map[string]any `json:"nodes"`
		Edges []map[string]any `json:"edges"`
	}
	h.json(http.MethodGet, "/api/maps/"+h.mapID+"/graph", nil, &g)
	return len(g.Nodes), len(g.Edges)
}

func TestUndoOverHTTP(t *testing.T) {
	h := newHarness(t)

	if st := h.undoState("tab-a"); st.UndoDepth != 0 || st.NextUndo != nil {
		t.Errorf("fresh client should have nothing to undo, got %+v", st)
	}

	h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "question", "title": "Ship on Fridays?", "mapId": h.mapID,
	}, map[string]string{"X-Client-Id": "tab-a"}).Body.Close()

	st := h.undoState("tab-a")
	if st.UndoDepth != 1 {
		t.Fatalf("undo depth = %d, want 1", st.UndoDepth)
	}
	// The label drives the toolbar tooltip and the toast, so it has to name
	// the thing that would disappear.
	if st.NextUndo == nil || !strings.Contains(st.NextUndo.Label, "Ship on Fridays?") {
		t.Errorf("nextUndo = %+v, should name the node", st.NextUndo)
	}

	res := h.undoAs("tab-a", "/api/undo")
	if !res.Applied {
		t.Fatalf("undo not applied: %s", res.Reason)
	}
	if n, _ := h.graphSize(); n != 0 {
		t.Errorf("node still present after undo (%d)", n)
	}

	if res := h.undoAs("tab-a", "/api/redo"); !res.Applied {
		t.Fatalf("redo not applied: %s", res.Reason)
	}
	if n, _ := h.graphSize(); n != 1 {
		t.Error("redo did not restore the node")
	}
}

// TestUndoIsPerClientOverHTTP is the collaboration guarantee at the transport
// level: the client id on the request, not global recency, decides what gets
// reversed.
func TestUndoIsPerClientOverHTTP(t *testing.T) {
	h := newHarness(t)

	h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "question", "title": "From the canvas", "mapId": h.mapID,
	}, map[string]string{"X-Client-Id": "desktop"}).Body.Close()

	h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "note", "title": "From a phone", "mapId": h.mapID,
	}, map[string]string{"X-Client-Id": "phone"}).Body.Close()

	res := h.undoAs("desktop", "/api/undo")
	if !res.Applied || res.Entry == nil {
		t.Fatal("desktop undo did not apply")
	}
	if !strings.Contains(res.Entry.Label, "From the canvas") {
		t.Fatalf("desktop undo reversed %q — the phone's contribution was at risk",
			res.Entry.Label)
	}

	// The phone's node survives, and the phone still has its own history.
	var g struct {
		Nodes []struct {
			Title string `json:"title"`
		} `json:"nodes"`
	}
	h.json(http.MethodGet, "/api/maps/"+h.mapID+"/graph", nil, &g)
	if len(g.Nodes) != 1 || g.Nodes[0].Title != "From a phone" {
		t.Errorf("graph after desktop undo = %+v", g.Nodes)
	}
	if st := h.undoState("phone"); st.UndoDepth != 1 {
		t.Errorf("phone undo depth = %d, want 1", st.UndoDepth)
	}
}

func TestUndoExhaustionIsNotAnError(t *testing.T) {
	h := newHarness(t)
	// Pressing Ctrl+Z once too often is normal use, not a failure, and must
	// not produce a red error toast.
	res := h.undoAs("tab-a", "/api/undo")
	if res.Applied {
		t.Error("undo applied with an empty history")
	}
	if res.Reason == "" {
		t.Error("response should explain that there is nothing to undo")
	}
}

func TestUndoBroadcastsToOtherClients(t *testing.T) {
	h := newHarness(t)
	conn := dialWS(t, h, "observer")

	h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "question", "title": "Doomed", "mapId": h.mapID,
	}, map[string]string{"X-Client-Id": "tab-a"}).Body.Close()
	conn.await(t, "node.created", 2*time.Second)

	h.undoAs("tab-a", "/api/undo")

	// Other clients refetch rather than patching: an undo can restore a node,
	// its placements on several maps and every edge that pointed at it.
	ev := conn.await(t, "graph.invalidated", 2*time.Second)
	payload, ok := ev.Payload.(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v", ev.Payload)
	}
	if reason, _ := payload["reason"].(string); !strings.Contains(reason, "Doomed") {
		t.Errorf("broadcast reason = %q, should name what was undone", reason)
	}
}

// TestUndoDeleteThroughAPIRestoresTheWholeSubgraph exercises the case most
// likely to lose work: deleting a node that other nodes argue with.
func TestUndoDeleteThroughAPIRestoresTheWholeSubgraph(t *testing.T) {
	h := newHarness(t)
	client := map[string]string{"X-Client-Id": "tab-a"}

	mk := func(typ, title, parent string) string {
		body := map[string]any{"type": typ, "title": title, "mapId": h.mapID}
		if parent != "" {
			body["parentId"] = parent
		}
		var out struct {
			Node map[string]any `json:"node"`
		}
		res := h.do(http.MethodPost, "/api/nodes", body, client)
		json.NewDecoder(res.Body).Decode(&out)
		res.Body.Close()
		return out.Node["id"].(string)
	}

	q := mk("question", "Q", "")
	idea := mk("idea", "I", q)
	mk("pro", "P", idea)
	mk("con", "C", idea)

	if n, e := h.graphSize(); n != 4 || e != 3 {
		t.Fatalf("setup: %d nodes, %d edges", n, e)
	}

	// Delete the Idea everywhere: this takes three edges with it.
	res := h.do(http.MethodDelete, "/api/nodes/"+idea+"?everywhere=true", nil, client)
	res.Body.Close()
	if n, e := h.graphSize(); n != 3 || e != 0 {
		t.Fatalf("after delete: %d nodes, %d edges", n, e)
	}

	if r := h.undoAs("tab-a", "/api/undo"); !r.Applied {
		t.Fatal("undo not applied")
	}
	n, e := h.graphSize()
	if n != 4 {
		t.Errorf("nodes after undo = %d, want 4", n)
	}
	if e != 3 {
		t.Errorf("edges after undo = %d, want 3 — the argument structure was lost", e)
	}
}

// --- websocket ------------------------------------------------------------

// wsClient wraps a connection with a background reader.
//
// Reading inline with a deadline does not work here: once a gorilla read times
// out the connection's framing state is considered corrupt and every later
// read fails, so a second inline read would silently return nothing and turn
// "assert no event arrived" into a test that can never fail.
type wsClient struct {
	conn   *websocket.Conn
	events chan Event
}

func dialConn(t *testing.T, h *harness, clientID string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(h.http.URL)
	u.Scheme = "ws"
	u.Path = "/ws"
	u.RawQuery = "clientId=" + clientID

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func dialWS(t *testing.T, h *harness, clientID string) *wsClient {
	t.Helper()
	c := &wsClient{conn: dialConn(t, h, clientID), events: make(chan Event, 1024)}
	go func() {
		for {
			var e Event
			if err := c.conn.ReadJSON(&e); err != nil {
				close(c.events)
				return
			}
			select {
			case c.events <- e:
			default: // test is not keeping up; dropping is fine here
			}
		}
	}()
	return c
}

// collect gathers every event that arrives within d.
func (c *wsClient) collect(d time.Duration) []Event {
	deadline := time.After(d)
	var out []Event
	for {
		select {
		case e, ok := <-c.events:
			if !ok {
				return out
			}
			out = append(out, e)
		case <-deadline:
			return out
		}
	}
}

// await waits for one event of the given type, failing the test on timeout.
func (c *wsClient) await(t *testing.T, want string, d time.Duration) Event {
	t.Helper()
	deadline := time.After(d)
	var seen []string
	for {
		select {
		case e, ok := <-c.events:
			if !ok {
				t.Fatalf("connection closed while waiting for %s; saw %v", want, seen)
			}
			if e.Type == want {
				return e
			}
			seen = append(seen, e.Type)
		case <-deadline:
			t.Fatalf("timed out waiting for %s; saw %v", want, seen)
		}
	}
}

func TestWebSocketBroadcastsWritesToOtherClients(t *testing.T) {
	h := newHarness(t)
	conn := dialWS(t, h, "observer")

	// A write from a different tab must reach this one.
	h.do(http.MethodPost, "/api/nodes", map[string]any{
		"type": "question", "title": "From another tab", "mapId": h.mapID,
	}, map[string]string{"X-Client-Id": "other-tab"}).Body.Close()

	created := conn.await(t, "node.created", 2*time.Second)

	// Origin lets the originating tab skip re-applying its own optimistic
	// update, so it has to survive the round trip.
	if created.Origin != "other-tab" {
		t.Errorf("event origin = %q, want other-tab", created.Origin)
	}
	if created.MapID != h.mapID {
		t.Errorf("event mapId = %q, want %q", created.MapID, h.mapID)
	}
}

func TestWebSocketSendsHelloWithADefaultMap(t *testing.T) {
	h := newHarness(t)
	conn := dialWS(t, h, "observer")

	// A fresh client should know what to render without a second round trip.
	hello := conn.await(t, "hello", 2*time.Second)
	if hello.MapID == "" {
		t.Error("hello carried no map id")
	}
}

// TestExternalWriteIsDetectedAfterOwnWrites is the regression test for a real
// bug: the watcher used to count this process's own writes and skip one poll
// per write, so an edit made by a separate `dialogmapper` process that landed
// in the same polling window was silently swallowed and open browsers went
// stale. The interleaving below is exactly the case that failed.
func TestExternalWriteIsDetectedAfterOwnWrites(t *testing.T) {
	h := newHarness(t)
	h.srv.pollInterval = 40 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.srv.WatchExternalChanges(ctx)

	conn := dialWS(t, h, "observer")

	// Two writes through the server. These are broadcast as precise events
	// and must NOT also trigger a blanket invalidation.
	h.createNode("question", "via API one", "")
	h.createNode("note", "via API two", "")

	own := typesOf(conn.collect(400 * time.Millisecond))
	if contains(own, "graph.invalidated") {
		t.Fatalf("own writes triggered a redundant full refresh: %v", own)
	}
	// Guard against the assertion above passing vacuously: the writes really
	// did happen and really were broadcast.
	if n := count(own, "node.created"); n != 2 {
		t.Fatalf("expected 2 node.created events before the external write, got %v", own)
	}

	// Now a genuinely external write, from a second connection to the same
	// file — the same thing `dialogmapper seed` does while the server runs.
	external, err := store.Open(h.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer external.Close()
	if _, err := external.CreateMap("written by another process", ""); err != nil {
		t.Fatal(err)
	}

	conn.await(t, "graph.invalidated", 3*time.Second)
}

func TestSlowClientDoesNotBlockHealthyOnes(t *testing.T) {
	h := newHarness(t)

	// A raw connection with no reader: its send buffer fills up, and the hub
	// must drop it rather than let it stall delivery to everyone else.
	_ = dialConn(t, h, "slow")
	fast := dialWS(t, h, "fast")

	for i := 0; i < 150; i++ {
		h.do(http.MethodPost, "/api/nodes", map[string]any{
			"type": "note", "title": fmt.Sprintf("n%d", i), "mapId": h.mapID,
		}, map[string]string{"X-Client-Id": "writer"}).Body.Close()
	}

	events := fast.collect(2 * time.Second)
	if len(events) < 50 {
		t.Errorf("a healthy client received only %d of 150 events; a stalled peer appears to be blocking the hub",
			len(events))
	}
}

func typesOf(events []Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Type
	}
	return out
}

func contains(xs []string, want string) bool { return count(xs, want) > 0 }

func count(xs []string, want string) int {
	var n int
	for _, x := range xs {
		if x == want {
			n++
		}
	}
	return n
}
