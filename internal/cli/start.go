package cli

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/davidfullmer/dialogmapper/internal/server"
)

func newStartCmd() *cobra.Command {
	var port int
	var host string
	var open bool

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
			httpSrv := &http.Server{
				Handler:           srv,
				ReadHeaderTimeout: 10 * time.Second,
				// No WriteTimeout: it would sever long-lived WebSockets.
			}

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "dialogmapper serving %s\n", st.Root())
			fmt.Fprintf(out, "  → %s\n", url)
			fmt.Fprintf(out, "  Press Ctrl-C to stop.\n")

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
	cmd.Flags().StringVar(&host, "host", "127.0.0.1",
		"interface to bind; use 0.0.0.0 to reach it from your phone on the same network")
	cmd.Flags().BoolVar(&open, "open", false, "open the map in your default browser")
	return cmd
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
