package server

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/davidfullmer/dialogmapper/internal/store"
)

// maxAssetBytes caps a single upload. Dialog maps hold screenshots and
// diagrams, not video; a limit keeps a stray drag-and-drop from filling a
// laptop's disk.
const maxAssetBytes = 32 << 20 // 32 MiB

// handleAssetUpload accepts an image or file dropped onto a node, writes it
// into the project's .assets directory, and returns the relative path to store
// in the node's content payload.
//
// Content is addressed by hash, so dropping the same screenshot onto five
// nodes stores one file. Relative paths keep the project directory portable:
// zip it, send it, and the images still resolve.
func (s *Server) handleAssetUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errMethod)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAssetBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, fmt.Errorf("could not read upload: %w", err))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, fmt.Errorf("no file in upload: %w", err))
		return
	}
	defer file.Close()

	if header.Size > maxAssetBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
			"error": fmt.Sprintf("file is %.1f MB; the limit is %d MB",
				float64(header.Size)/(1<<20), maxAssetBytes>>20),
		})
		return
	}

	dir := s.st.AssetsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, err)
		return
	}

	// Stream to a temp file while hashing, so the final name can be the
	// content hash without buffering the whole upload in memory.
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		writeErr(w, err)
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once renamed

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, hasher), file)
	closeErr := tmp.Close()
	if err != nil {
		writeErr(w, fmt.Errorf("could not save upload: %w", err))
		return
	}
	if closeErr != nil {
		writeErr(w, closeErr)
		return
	}

	ext := sanitizeExt(header.Filename)
	sum := hex.EncodeToString(hasher.Sum(nil))[:16]
	name := sum + ext
	final := filepath.Join(dir, name)

	if _, err := os.Stat(final); os.IsNotExist(err) {
		if err := os.Rename(tmpName, final); err != nil {
			writeErr(w, err)
			return
		}
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = mime.TypeByExtension(ext)
	}

	relPath := store.AssetsDirName + "/" + name
	nodeID := r.FormValue("nodeId")
	if err := s.st.RecordAsset(nodeID, relPath, mimeType, written); err != nil {
		// The file is on disk and usable; failing the request over a
		// bookkeeping row would lose the user's image for no reason.
		_ = err
	}

	asset := store.Asset{
		Path:    "/assets/" + name, // how the browser fetches it
		Kind:    kindFor(mimeType),
		Caption: strings.TrimSuffix(filepath.Base(header.Filename), ext),
		Mime:    mimeType,
		Bytes:   written,
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"asset":       asset,
		"storagePath": relPath, // as written in exports, relative to the project
		"uploadedAt":  time.Now().UTC().Format(time.RFC3339),
	})
}

// sanitizeExt keeps only a short, alphanumeric extension. Filenames arrive
// from a browser and must never influence the path we write to.
func sanitizeExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filepath.Base(filename)))
	if len(ext) < 2 || len(ext) > 6 {
		return ".bin"
	}
	for _, c := range ext[1:] {
		if !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') {
			return ".bin"
		}
	}
	return ext
}

func kindFor(mimeType string) string {
	if strings.HasPrefix(mimeType, "image/") {
		return "image"
	}
	return "file"
}
