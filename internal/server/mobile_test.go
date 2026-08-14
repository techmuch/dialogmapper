package server

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The QR is only useful if the URL inside it is one a phone can reach and the
// key inside it actually opens the door. Both are easy to get subtly wrong in
// ways that look fine on screen.

func TestAccessTokenAllowsLoopbackWithoutAKey(t *testing.T) {
	h := newHarness(t)
	h.srv.SetToken(NewAccessToken(true))

	// httptest connects over loopback, which is the desktop canvas's position:
	// it must keep working with no ceremony at all.
	res := h.do(http.MethodGet, "/api/health", nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("loopback request = %d, want 200", res.StatusCode)
	}
}

func TestAccessTokenBlocksRemoteWithoutAKey(t *testing.T) {
	tok := NewAccessToken(true)
	h := newHarness(t)
	h.srv.SetToken(tok)

	// Simulate a request arriving from another machine on the LAN.
	remote := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "192.168.1.42:51000"
		w := httptest.NewRecorder()
		h.srv.ServeHTTP(w, req)
		return w
	}

	// Every surface must be covered, not just the API: the SPA itself and
	// uploaded media are just as sensitive as the graph endpoints.
	for _, path := range []string{"/api/health", "/", "/m", "/media/x.png"} {
		if got := remote(path).Code; got != http.StatusForbidden {
			t.Errorf("remote GET %s = %d, want 403", path, got)
		}
	}

	// With the key, the same request is allowed and is handed a cookie so the
	// phone can navigate normally afterwards.
	req := httptest.NewRequest(http.MethodGet, "/api/health?k="+tok.Value(), nil)
	req.RemoteAddr = "192.168.1.42:51000"
	w := httptest.NewRecorder()
	h.srv.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("remote request with key = %d, want 200", w.Code)
	}
	var gotCookie bool
	for _, c := range w.Result().Cookies() {
		if c.Name == tokenCookie && c.Value == tok.Value() {
			gotCookie = true
		}
	}
	if !gotCookie {
		t.Error("a valid key should set a cookie so later navigation works")
	}

	// A wrong key is still refused.
	req = httptest.NewRequest(http.MethodGet, "/api/health?k=wrong", nil)
	req.RemoteAddr = "192.168.1.42:51000"
	w = httptest.NewRecorder()
	h.srv.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("wrong key = %d, want 403", w.Code)
	}
}

func TestRefusalExplainsItself(t *testing.T) {
	h := newHarness(t)
	h.srv.SetToken(NewAccessToken(true))

	req := httptest.NewRequest(http.MethodGet, "/m", nil)
	req.RemoteAddr = "10.0.0.9:40000"
	w := httptest.NewRecorder()
	h.srv.ServeHTTP(w, req)

	body := w.Body.String()
	// A bare 403 on a phone is baffling; the page has to say what to do.
	if !strings.Contains(body, "QR") {
		t.Errorf("refusal page should tell the user to scan the QR:\n%s", body)
	}
}

func TestDisabledTokenAllowsEveryone(t *testing.T) {
	h := newHarness(t)
	h.srv.SetToken(NewAccessToken(false)) // what --no-token produces

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.RemoteAddr = "192.168.1.42:51000"
	w := httptest.NewRecorder()
	h.srv.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("with the key disabled, remote access = %d, want 200", w.Code)
	}
}

func TestMobileAccessIsUnreachableOnLoopback(t *testing.T) {
	h := newHarness(t)
	h.srv.Bind("127.0.0.1", "7373", false)

	var access MobileAccess
	h.json(http.MethodGet, "/api/mobile", nil, &access)

	if access.Reachable {
		t.Error("a loopback-bound server must not claim to be reachable")
	}
	if !strings.Contains(access.Hint, "0.0.0.0") {
		t.Errorf("hint should name the fix, got %q", access.Hint)
	}

	// And the QR endpoint must refuse rather than encode a useless URL. A code
	// that scans and then fails to load looks like a broken tool.
	res := h.do(http.MethodGet, "/api/qr.png", nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Errorf("QR on a loopback-only server = %d, want 409", res.StatusCode)
	}
}

func TestMobileURLCarriesLANAddressAndKey(t *testing.T) {
	h := newHarness(t)
	tok := NewAccessToken(true)
	h.srv.SetToken(tok)
	h.srv.Bind("0.0.0.0", "7373", true)

	var access MobileAccess
	h.json(http.MethodGet, "/api/mobile", nil, &access)

	if !access.Reachable {
		t.Skip("no LAN address available in this environment")
	}
	// localhost is right for the browser on this machine and useless to a
	// phone, which is the entire failure mode this endpoint exists to avoid.
	if strings.Contains(access.URL, "localhost") || strings.Contains(access.URL, "127.0.0.1") {
		t.Errorf("QR URL points at the local machine: %s", access.URL)
	}
	if !strings.Contains(access.URL, "/m") {
		t.Errorf("QR should link to the mobile view, got %s", access.URL)
	}
	if !strings.Contains(access.URL, "k="+tok.Value()) {
		t.Errorf("QR URL is missing the access key: %s", access.URL)
	}
}

func TestQREndpointRendersAPNG(t *testing.T) {
	h := newHarness(t)
	h.srv.Bind("0.0.0.0", "7373", true)
	if !h.srv.MobileURL().Reachable {
		t.Skip("no LAN address available in this environment")
	}

	res := h.do(http.MethodGet, "/api/qr.png?size=300", nil, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("qr.png = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content-type = %q", ct)
	}
	// The key is per-run, so a cached QR would send a phone to a dead session.
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("QR must not be cached, got %q", cc)
	}

	var buf bytes.Buffer
	buf.ReadFrom(res.Body)
	img, err := png.Decode(&buf)
	if err != nil {
		t.Fatalf("response is not a valid PNG: %v", err)
	}
	if b := img.Bounds(); b.Dx() < 100 || b.Dy() < 100 {
		t.Errorf("QR image is %dx%d, too small to scan", b.Dx(), b.Dy())
	}
}

func TestASCIIQRIsBoundedAndColourable(t *testing.T) {
	url := "http://192.168.1.50:7373/m?k=abcdefghijklmnop"

	plain, err := ASCIIQR(url, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(plain, "\x1b[") {
		t.Error("uncoloured output should contain no escape sequences")
	}

	lines := strings.Split(strings.TrimRight(plain, "\n"), "\n")
	// Half-block rendering exists so the code fits a terminal window; if this
	// grows past a normal window it scrolls away before anyone can scan it.
	if len(lines) > 30 {
		t.Errorf("QR is %d rows tall; too tall for a terminal", len(lines))
	}
	if w := len([]rune(lines[0])); w > 60 {
		t.Errorf("QR is %d columns wide; too wide for an 80-column terminal", w)
	}

	coloured, err := ASCIIQR(url, true)
	if err != nil {
		t.Fatal(err)
	}
	// Explicit colours are what stop the code rendering inverted on a dark
	// terminal, which many scanners will not read.
	if !strings.Contains(coloured, "\x1b[") {
		t.Error("coloured output should set explicit foreground and background")
	}
}

func TestMobileInfoRejectsNonGET(t *testing.T) {
	h := newHarness(t)
	res := h.do(http.MethodPost, "/api/mobile", map[string]string{}, nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/mobile = %d, want 405", res.StatusCode)
	}
}

// TestQRJSONShapeMatchesTheClient guards the contract the help panel relies on.
func TestQRJSONShapeMatchesTheClient(t *testing.T) {
	h := newHarness(t)
	res := h.do(http.MethodGet, "/api/mobile", nil, nil)
	defer res.Body.Close()

	var raw map[string]any
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"url", "reachable", "host", "hint"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("response is missing %q; the help panel reads it", key)
		}
	}
}
