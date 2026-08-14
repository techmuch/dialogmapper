package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// Getting a phone onto a map is the one setup step that has to be effortless:
// it happens in front of a room of people who are waiting. Typing an IP and
// port off a projector is exactly the friction a QR code removes.
//
// Two things make this less trivial than "render a QR of the URL":
//
//   - The URL has to be one the phone can actually reach. `localhost` is
//     correct for the browser on this machine and useless to anything else, so
//     the QR must carry the LAN address of the interface the server is bound
//     to. A QR that resolves to the phone itself is worse than no QR, because
//     the failure looks like a bug in the tool.
//
//   - Serving on every interface means anyone on the same network can read and
//     edit the maps. The token below closes that without adding a step for the
//     person scanning: it rides along in the URL the QR already encodes.

// AccessToken gates non-loopback requests.
//
// Connections from this machine are always allowed — the desktop canvas must
// keep working with no ceremony. Anything arriving over the network needs the
// token, which the QR supplies automatically and which is then remembered in a
// cookie so the phone can navigate normally.
type AccessToken struct {
	value   string
	enabled bool
}

// NewAccessToken mints a token for this run. It is deliberately per-process:
// there is nothing to revoke and nothing to leak between sessions.
func NewAccessToken(enabled bool) *AccessToken {
	if !enabled {
		return &AccessToken{enabled: false}
	}
	var buf [10]byte
	if _, err := rand.Read(buf[:]); err != nil {
		panic("dialogmapper: entropy source unavailable: " + err.Error())
	}
	return &AccessToken{
		value: strings.ToLower(base32.StdEncoding.
			WithPadding(base32.NoPadding).EncodeToString(buf[:])),
		enabled: true,
	}
}

// Value returns the token, or "" when access control is off.
func (a *AccessToken) Value() string {
	if a == nil || !a.enabled {
		return ""
	}
	return a.value
}

// tokenCookie is the name of the cookie set once a phone presents a valid
// token, so that later navigations do not need the query parameter.
const tokenCookie = "dm_access"

// authorize reports whether a request may proceed.
func (a *AccessToken) authorize(r *http.Request) bool {
	if a == nil || !a.enabled {
		return true
	}
	if isLoopbackRequest(r) {
		return true
	}
	if c, err := r.Cookie(tokenCookie); err == nil && a.matches(c.Value) {
		return true
	}
	return a.matches(r.URL.Query().Get("k")) ||
		a.matches(r.Header.Get("X-Access-Token"))
}

// matches compares in constant time. The comparison is cheap and the habit is
// worth keeping even where timing attacks over a LAN are far-fetched.
func (a *AccessToken) matches(candidate string) bool {
	if candidate == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(a.value)) == 1
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// guard wraps the mux with the token check. It runs before routing so that
// every surface — API, WebSocket, uploaded media and the SPA itself — is
// covered by one rule rather than each remembering to ask.
func (s *Server) guard(w http.ResponseWriter, r *http.Request) bool {
	if s.token.authorize(r) {
		// Remember a valid token so the phone can follow links normally.
		if k := r.URL.Query().Get("k"); k != "" && s.token.matches(k) {
			http.SetCookie(w, &http.Cookie{
				Name: tokenCookie, Value: k, Path: "/",
				HttpOnly: true, SameSite: http.SameSiteLaxMode,
			})
		}
		return true
	}

	// A bare 403 from a phone is baffling. Say what happened and what to do.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	fmt.Fprint(w, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dialogmapper</title>
<style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;background:#0e1116;color:#e6edf3;
margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center}
code{background:#1c222b;padding:2px 6px;border-radius:4px}</style>
<div><h2>This map is not open to the network</h2>
<p>Scan the QR code shown in the dialogmapper help panel (press <code>?</code> on the
desktop) to join. The link it contains carries an access key for this session.</p></div>`)
	return false
}

// --- reachability ----------------------------------------------------------

// MobileAccess describes how, and whether, a phone can reach this server.
type MobileAccess struct {
	// URL is what the QR encodes: a LAN address with the access key attached.
	URL string `json:"url"`
	// Reachable is false when the server is bound to loopback only, in which
	// case there is genuinely nothing a phone could connect to.
	Reachable bool   `json:"reachable"`
	Host      string `json:"host"`
	Hint      string `json:"hint"`
}

// mobileAccess works out the URL to publish. r is used only as a fallback for
// the port, so this behaves the same whether it is called from an HTTP handler
// or from the CLI banner.
func (s *Server) mobileAccess(r *http.Request) MobileAccess {
	port := s.boundPort
	if port == "" && r != nil {
		if _, p, err := net.SplitHostPort(r.Host); err == nil {
			port = p
		}
	}
	if port == "" {
		port = "7373"
	}

	ip := LANAddress()
	if !s.boundToAll && s.boundHost != "" {
		// Bound to one specific interface: that address is the only truth,
		// whatever else the machine happens to have.
		if parsed := net.ParseIP(s.boundHost); parsed != nil && !parsed.IsLoopback() {
			ip = s.boundHost
		} else if parsed != nil && parsed.IsLoopback() {
			ip = ""
		}
	}

	if ip == "" {
		return MobileAccess{
			Reachable: false,
			Hint: "The server is only listening on this machine. Restart with " +
				"`dialogmapper start --host 0.0.0.0` to let phones on the same " +
				"network join.",
		}
	}

	u := url.URL{Scheme: "http", Host: net.JoinHostPort(ip, port), Path: "/m"}
	if k := s.token.Value(); k != "" {
		u.RawQuery = "k=" + k
	}
	return MobileAccess{
		URL: u.String(), Reachable: true, Host: net.JoinHostPort(ip, port),
		Hint: "Scan with a phone on the same network. The link carries an " +
			"access key that is valid until this server stops.",
	}
}

// LANAddress returns the address other machines on the network would use to
// reach this one, or "" when there is no such address.
//
// The UDP dial sends nothing; it only asks the routing table which interface
// would be chosen for outbound traffic, which is a far more reliable answer
// than enumerating interfaces and guessing.
func LANAddress() string {
	conn, err := net.Dial("udp", "192.0.2.1:80") // TEST-NET-1, never routed
	if err == nil {
		defer conn.Close()
		if a, ok := conn.LocalAddr().(*net.UDPAddr); ok &&
			a.IP != nil && !a.IP.IsLoopback() {
			return a.IP.String()
		}
	}

	// No route to the internet — an offline workshop, which is exactly when
	// this matters most. Fall back to the first private address we can find.
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		n, ok := addr.(*net.IPNet)
		if !ok || n.IP.IsLoopback() || n.IP.To4() == nil {
			continue
		}
		if n.IP.IsPrivate() {
			return n.IP.String()
		}
	}
	return ""
}

// --- handlers --------------------------------------------------------------

// handleMobileInfo tells the UI what to show in the help panel.
func (s *Server) handleMobileInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errMethod)
		return
	}
	writeJSON(w, http.StatusOK, s.mobileAccess(r))
}

// handleQR renders the mobile URL as a PNG.
//
// Server-side because the server is the only party that knows which interface
// it is bound to and what the access key is; asking the browser to work that
// out would mean shipping both facts to the client and hoping it agrees.
func (s *Server) handleQR(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errMethod)
		return
	}
	access := s.mobileAccess(r)
	if !access.Reachable {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "no network address to publish",
			"hint":  access.Hint,
		})
		return
	}

	size := 260
	if v, err := strconv.Atoi(r.URL.Query().Get("size")); err == nil && v >= 80 && v <= 1024 {
		size = v
	}

	// Medium recovery: enough redundancy for a phone camera pointed at a
	// screen, without inflating the module count so far that it stops
	// scanning at small sizes.
	png, err := qrcode.Encode(access.URL, qrcode.Medium, size)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store") // the key is per-run
	w.Write(png)
}

// ASCIIQR renders the URL for a terminal.
//
// Two details decide whether this actually scans:
//
//   - Colours are set explicitly rather than relying on the terminal's own
//     foreground and background. Printing filled blocks for dark modules looks
//     right on a light terminal and produces an inverted code on a dark one,
//     and while many scanners cope with inversion, plenty do not.
//
//   - Half-block characters put two QR rows in one text row. At full-block
//     resolution a QR of a URL this long is over forty lines and scrolls off
//     the top of the window before anyone can point a phone at it.
//
// The quiet zone the library adds is left intact; trimming it is a common way
// to make a QR that looks fine and refuses to scan.
func ASCIIQR(content string, color bool) (string, error) {
	q, err := qrcode.New(content, qrcode.Medium)
	if err != nil {
		return "", err
	}
	bmp := q.Bitmap()

	const (
		fgLight = "\x1b[97m" // bright white: a light module
		fgDark  = "\x1b[30m" // black: a dark module
		bgLight = "\x1b[107m"
		bgDark  = "\x1b[40m"
		reset   = "\x1b[0m"
	)

	var b strings.Builder
	for y := 0; y < len(bmp); y += 2 {
		for x := 0; x < len(bmp[y]); x++ {
			topDark := bmp[y][x]
			bottomDark := false
			if y+1 < len(bmp) {
				bottomDark = bmp[y+1][x]
			}

			if !color {
				// No ANSI available: fall back to a full-block rendering that
				// assumes a light background, which is the safer guess for a
				// redirected or logged stream.
				b.WriteString(blockFor(topDark, bottomDark))
				continue
			}

			// "▀" paints its upper half in the foreground colour and leaves
			// the lower half showing the background, so one character carries
			// both modules.
			if topDark {
				b.WriteString(fgDark)
			} else {
				b.WriteString(fgLight)
			}
			if bottomDark {
				b.WriteString(bgDark)
			} else {
				b.WriteString(bgLight)
			}
			b.WriteString("▀")
		}
		if color {
			b.WriteString(reset)
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

func blockFor(topDark, bottomDark bool) string {
	switch {
	case topDark && bottomDark:
		return "█"
	case topDark:
		return "▀"
	case bottomDark:
		return "▄"
	default:
		return " "
	}
}
