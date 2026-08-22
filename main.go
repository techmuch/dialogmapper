// Command dialogmapper is a single-binary, local-first IBIS dialog mapping
// environment. It ships a Go HTTP/WebSocket server, a SQLite graph store, and
// an embedded React frontend in one executable.
package main

import (
	"fmt"
	"os"

	"github.com/techmuch/dialogmapper/internal/cli"
)

// version is overridden at build time:
//
//	go build -ldflags "-X main.version=v0.1.9"
var version = "v0.1.9"

func main() {
	if err := cli.Execute(version); err != nil {
		fmt.Fprintln(os.Stderr, "dialogmapper:", err)
		os.Exit(1)
	}
}
