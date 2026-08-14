package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/davidfullmer/dialogmapper/internal/server"
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
			url := fmt.Sprintf("http://%s", localURLHost(ln.Addr()))

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

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "dialogmapper serving %s\n", st.Root())
			fmt.Fprintf(out, "  → %s\n", url)

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
					if err := openBrowser(url); err != nil {
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

// localURLHost renders a listener address as something a browser will accept.
// Binding 0.0.0.0 is common (so a phone can connect) but is not a valid host
// to navigate to, so it is rewritten to the machine's LAN address.
func localURLHost(addr net.Addr) string {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok {
		return addr.String()
	}
	if tcp.IP.IsUnspecified() {
		if ip := outboundIP(); ip != "" {
			return net.JoinHostPort(ip, fmt.Sprint(tcp.Port))
		}
		return net.JoinHostPort("localhost", fmt.Sprint(tcp.Port))
	}
	return net.JoinHostPort(tcp.IP.String(), fmt.Sprint(tcp.Port))
}

// outboundIP finds the LAN address the OS would use to reach the internet.
// The UDP dial is not a connection — no packets are sent — it just asks the
// routing table which interface would be chosen.
func outboundIP() string {
	conn, err := net.Dial("udp", "192.0.2.1:80") // TEST-NET-1, never routed
	if err != nil {
		return ""
	}
	defer conn.Close()
	if a, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
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
