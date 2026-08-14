package cli

import (
	"net"
	"testing"
)

// The URL handed to the local browser is not the same as the one printed for
// phones, and conflating them is not a cosmetic mistake: the LAN access key
// decides whether a request is local by its source address, so a browser on
// this machine reaching the machine's own LAN address is treated as remote and
// refused. `--open` landed on the "not open to the network" page because of
// exactly that.
func TestLocalBrowserHost(t *testing.T) {
	cases := []struct {
		name string
		addr net.Addr
		want string
	}{
		{
			// The default. Every interface is served, including loopback, so
			// the browser here should stay on loopback.
			name: "bound to every interface",
			addr: &net.TCPAddr{IP: net.IPv4zero, Port: 7373},
			want: "127.0.0.1:7373",
		},
		{
			name: "explicit loopback",
			addr: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 7373},
			want: "127.0.0.1:7373",
		},
		{
			// Only this interface is served, so loopback would refuse the
			// connection outright; the bound address is the only one that works.
			name: "explicit single interface",
			addr: &net.TCPAddr{IP: net.ParseIP("192.168.1.50"), Port: 8080},
			want: "192.168.1.50:8080",
		},
		{
			name: "kernel-assigned port",
			addr: &net.TCPAddr{IP: net.IPv4zero, Port: 54321},
			want: "127.0.0.1:54321",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := localBrowserHost(c.addr); got != c.want {
				t.Errorf("localBrowserHost(%v) = %q, want %q", c.addr, got, c.want)
			}
		})
	}
}

// TestLocalBrowserHostNeverReturnsALANAddress is the property that matters,
// stated directly: whatever the machine's networking looks like, binding
// everything must send the local browser to loopback.
func TestLocalBrowserHostNeverReturnsALANAddress(t *testing.T) {
	got := localBrowserHost(&net.TCPAddr{IP: net.IPv4zero, Port: 7373})
	host, _, err := net.SplitHostPort(got)
	if err != nil {
		t.Fatalf("unparseable host %q: %v", got, err)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		t.Fatalf("expected a literal IP so name resolution cannot pick ::1, got %q", host)
	}
	if !ip.IsLoopback() {
		t.Errorf("local browser URL is %q, which the access key will treat as remote", got)
	}
}

func TestHostIsLoopback(t *testing.T) {
	cases := map[string]bool{
		"http://127.0.0.1:7373":    true,
		"http://localhost:7373":    true,
		"http://[::1]:7373":        true,
		"http://192.168.1.50:7373": false,
		"http://10.0.0.4:7373":     false,
		"not a url":                false,
	}
	for in, want := range cases {
		if got := hostIsLoopback(in); got != want {
			t.Errorf("hostIsLoopback(%q) = %v, want %v", in, got, want)
		}
	}
}
