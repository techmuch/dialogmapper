// Package web carries the compiled frontend inside the binary.
//
// The dist directory is produced by `npm run build` in ../../web and is
// committed so that `go build` works without a Node toolchain. The `all:`
// prefix is required: without it, go:embed skips files beginning with _ or .,
// which silently drops Vite's hashed asset directory on some configurations.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the frontend rooted at dist, so paths look like "/index.html"
// rather than "/dist/index.html".
func FS() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
