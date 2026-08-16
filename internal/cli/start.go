package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/server"
)

func newStartCmd() *cobra.Command {
	var port int
	var host string
	var open bool
	var noToken bool
	var noQR bool

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Serve the dialog mapping UI on localhost",
		Long: `Starts the local HTTP and WebSocket server and serves the embedded
frontend. Desktop browsers get the canvas; phones get a linear capture view.

Every change — from the canvas, from a phone, or from another dialogmapper
process writing to the same database — is broadcast to all connected clients.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			// Binding first means we can report the real port when the user
			// asked for 0, and fail before printing a URL that will not work.
			addr := fmt.Sprintf("%s:%d", host, port)
			ln, err := net.Listen("tcp", addr)
			if err != nil {
				return fmt.Errorf("cannot listen on %s: %w", addr, err)
			}
			// The URL for the browser on this machine. Deliberately not the LAN
			// address: that is for phones, and pointing the local browser at it
			// is wrong twice over. It is a needless trip through the network
			// stack, and the access key treats a connection by its source
			// address — so a browser here reaching the LAN IP looks remote and
			// is refused. `--open` used to land on the "not open to the
			// network" page for that reason.
			localURL := fmt.Sprintf("http://%s", localBrowserHost(ln.Addr()))

			srv, err := server.New(st)
			if err != nil {
				return err
			}

			// Serving on every interface is what makes joining from a phone a
			// single scan. It also puts the maps on whatever network the
			// laptop is attached to, so a per-run key is required from
			// anything that is not this machine. The desktop canvas is
			// unaffected: loopback is always allowed.
			tcpAddr, _ := ln.Addr().(*net.TCPAddr)
			boundToAll := tcpAddr != nil && tcpAddr.IP.IsUnspecified()
			port := ""
			if tcpAddr != nil {
				port = fmt.Sprint(tcpAddr.Port)
			}
			srv.Bind(host, port, boundToAll)

			exposed := boundToAll || (tcpAddr != nil && !tcpAddr.IP.IsLoopback())
			token := server.NewAccessToken(exposed && !noToken)
			srv.SetToken(token)
			httpSrv := &http.Server{
				Handler:           srv,
				ReadHeaderTimeout: 10 * time.Second,
				// No WriteTimeout: it would sever long-lived WebSockets.
			}

			// Where `--open` sends the browser. Normally the loopback URL needs
			// no key; only an explicit bind to one non-loopback interface makes
			// even the local browser look remote, and then the key has to ride
			// along or the page is refused.
			openURL := localURL
			if k := token.Value(); k != "" && !hostIsLoopback(localURL) {
				openURL += "/?k=" + k
			}

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "dialogmapper serving %s\n", st.Root())
			fmt.Fprintf(out, "  → %s\n", localURL)

			// A phone joining is the one setup step that happens in front of
			// a waiting room, so the QR goes where the user is already
			// looking: the terminal they just typed into.
			access := srv.MobileURL()
			if access.Reachable && !noQR {
				fmt.Fprintf(out, "\n  Phones on this network: %s\n", access.URL)
				if code, err := server.ASCIIQR(access.URL, isTerminal(out)); err == nil {
					fmt.Fprintln(out)
					for _, line := range strings.Split(strings.TrimRight(code, "\n"), "\n") {
						fmt.Fprintf(out, "  %s\n", line)
					}
				}
				if token.Value() != "" {
					fmt.Fprintf(out, "\n  Reachable from this network; the link above carries a key\n")
					fmt.Fprintf(out, "  valid until this server stops. Use --host 127.0.0.1 to keep\n")
					fmt.Fprintf(out, "  it to this machine, or --no-token to drop the key.\n")
				} else {
					fmt.Fprintf(out, "\n  ⚠ Reachable from this network with no access key.\n")
				}
			} else if !access.Reachable {
				fmt.Fprintf(out, "  (local only — %s)\n", access.Hint)
			}

			fmt.Fprintf(out, "\n  Press Ctrl-C to stop.\n")

			ctx, stop := signal.NotifyContext(context.Background(),
				os.Interrupt, syscall.SIGTERM)
			defer stop()

			// Watch for writes made by other processes and fan them out.
			go srv.WatchExternalChanges(ctx)

			errc := make(chan error, 1)
			go func() {
				if err := httpSrv.Serve(ln); err != nil &&
					!errors.Is(err, http.ErrServerClosed) {
					errc <- err
				}
			}()

			if open {
				// Give the listener a moment so the first request is not a
				// connection refused on slower machines.
				time.AfterFunc(150*time.Millisecond, func() {
					if err := openBrowser(openURL); err != nil {
						fmt.Fprintf(out, "  (could not open a browser: %v)\n", err)
					}
				})
			}

			select {
			case err := <-errc:
				return err
			case <-ctx.Done():
				fmt.Fprintln(out, "\nshutting down…")
				shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				srv.CloseClients()
				return httpSrv.Shutdown(shutCtx)
			}
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 7373, "port to listen on (0 picks a free one)")
	cmd.Flags().StringVar(&host, "host", "0.0.0.0",
		"interface to bind; use 127.0.0.1 to keep the map to this machine only")
	cmd.Flags().BoolVar(&open, "open", false, "open the map in your default browser")
	cmd.Flags().BoolVar(&noToken, "no-token", false,
		"serve to the network without an access key (anyone who can reach the port can edit)")
	cmd.Flags().BoolVar(&noQR, "no-qr", false, "do not print the QR code on startup")
	return cmd
}

// isTerminal reports whether output is going to a terminal, so the QR only
// emits ANSI colour when something can render it. Redirected output gets the
// uncoloured fallback rather than a file full of escape sequences.
func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

// localBrowserHost renders a listener address for the browser on this machine.
//
// Binding 0.0.0.0 means "every interface", which includes loopback, so the
// right answer is 127.0.0.1 — not the LAN address. Reaching the machine's own
// LAN address from a browser on that machine works, but the connection carries
// the LAN address as its source, so the access key treats it as coming from
// somewhere else and refuses it.
//
// 127.0.0.1 rather than the name "localhost": on a dual-stack machine that
// name may resolve to ::1 first, and a listener on 0.0.0.0 is IPv4 only.
func localBrowserHost(addr net.Addr) string {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok {
		return addr.String()
	}
	port := fmt.Sprint(tcp.Port)
	if tcp.IP.IsUnspecified() {
		return net.JoinHostPort("127.0.0.1", port)
	}
	// An explicit bind to one interface: loopback is not being served, so that
	// address is the only one that can work.
	return net.JoinHostPort(tcp.IP.String(), port)
}

// hostIsLoopback reports whether a URL points back at this machine.
func hostIsLoopback(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// openBrowser launches the platform's default handler for a URL.
func openBrowser(url string) error {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd, args = "rundll32", []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	return exec.Command(cmd, append(args, url)...).Start()
}
