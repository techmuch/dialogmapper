// Package store owns the SQLite graph: schema management, queries, and the
// transactional write paths that keep the IBIS grammar intact.
package store

import (
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver: no cgo, so the binary cross-compiles
)

//go:embed schema.sql
var schemaSQL string

// SchemaVersion is bumped whenever schema.sql changes in a way that requires
// migration. Stored in schema_meta so an old binary refuses a newer database
// rather than corrupting it.
// v2 added the undo_log journal.
// v3 made groups own their members instead of being free-floating rectangles.
const SchemaVersion = 3

// DBFileName is the conventional database filename inside a project.
const DBFileName = "maps.db"

// AssetsDirName holds images and files dropped into the UI.
const AssetsDirName = ".assets"

// Store is a handle on one project's database.
type Store struct {
	db   *sql.DB
	root string // project root directory (parent of maps.db)

	// writeMu serializes writes. SQLite in WAL mode allows one writer; taking
	// the lock in Go turns "database is locked" retries into ordinary waiting.
	//
	// A pointer so that As() can hand out actor-scoped views that still share
	// one lock; copying a sync.Mutex by value would give each view its own and
	// quietly remove the serialization.
	writeMu *sync.Mutex

	// actor attributes journal entries, so undo can be scoped per client
	// rather than letting one person reverse another's work.
	actor string
}

// As returns a view of the store that records undo entries under the given
// actor. The underlying database and write lock are shared.
//
// This exists as a view rather than an extra argument on every mutation so
// that call sites read as `st.As(clientID).CreateNode(in)` — the attribution
// is stated once, at the boundary where the client is actually known.
func (s *Store) As(actor string) *Store {
	view := *s
	view.actor = actor
	return &view
}

// Actor reports who this view attributes changes to.
func (s *Store) Actor() string { return s.actor }

// Open connects to the database at root/maps.db, creating and migrating it if
// necessary.
func Open(root string) (*Store, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(abs, DBFileName)

	// _txlock=immediate avoids upgrade deadlocks between concurrent
	// transactions that start as readers and later write.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"+
		"&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_txlock=immediate",
		filepath.ToSlash(path))

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	// A single connection sidesteps SQLite's cross-connection lock contention
	// entirely. At local-first scale the throughput cost is irrelevant.
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect %s: %w", path, err)
	}

	s := &Store{db: db, root: abs, writeMu: &sync.Mutex{}}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Root returns the project directory containing the database.
func (s *Store) Root() string { return s.root }

// AssetsDir returns the absolute path of the local asset directory.
func (s *Store) AssetsDir() string { return filepath.Join(s.root, AssetsDirName) }

// DB exposes the underlying handle for the few callers that need raw access.
func (s *Store) DB() *sql.DB { return s.db }

// Close releases the database handle.
func (s *Store) Close() error { return s.db.Close() }

// Exists reports whether a database is already present at root.
func Exists(root string) bool {
	_, err := os.Stat(filepath.Join(root, DBFileName))
	return err == nil
}

// migrate applies schema.sql and records the schema version. schema.sql is
// written to be idempotent, so this is safe to run on every open.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}

	var got string
	err := s.db.QueryRow(`SELECT value FROM schema_meta WHERE key = 'version'`).Scan(&got)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = s.db.Exec(
			`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`,
			fmt.Sprint(SchemaVersion))
		return err
	case err != nil:
		return err
	}

	var have int
	if _, err := fmt.Sscanf(got, "%d", &have); err != nil {
		return fmt.Errorf("unreadable schema version %q", got)
	}
	if have > SchemaVersion {
		return fmt.Errorf(
			"database was written by a newer dialogmapper (schema v%d, this binary speaks v%d); upgrade the CLI",
			have, SchemaVersion)
	}
	if have < SchemaVersion {
		if err := s.upgrade(have); err != nil {
			return err
		}
		_, err = s.db.Exec(
			`UPDATE schema_meta SET value = ? WHERE key = 'version'`,
			fmt.Sprint(SchemaVersion))
		return err
	}
	return nil
}

// upgrade runs the migrations needed to bring a database from `have` to the
// current version. schema.sql only ever creates missing tables, so anything
// that changes the shape of an existing one has to happen here.
func (s *Store) upgrade(have int) error {
	if have < 3 {
		// v3 removed the geometry columns from `groups`: a group's outline is
		// now derived from where its member nodes are, so stored coordinates
		// could only ever go stale. Membership itself already lived in
		// map_nodes.group_id and is carried across untouched.
		if err := s.rebuildGroupsTable(); err != nil {
			return fmt.Errorf("migrate groups to v3: %w", err)
		}
	}
	return nil
}

func (s *Store) rebuildGroupsTable() error {
	var hasGeometry bool
	rows, err := s.db.Query(`PRAGMA table_info(groups)`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "x" {
			hasGeometry = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if !hasGeometry {
		return nil // already migrated, or created fresh
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, stmt := range []string{
		`CREATE TABLE groups_v3 (
			id         TEXT PRIMARY KEY,
			map_id     TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
			title      TEXT NOT NULL DEFAULT '',
			color      TEXT NOT NULL DEFAULT 'slate',
			created_at TEXT NOT NULL
		)`,
		`INSERT INTO groups_v3 (id, map_id, title, color, created_at)
		 SELECT id, map_id, title, color, created_at FROM groups`,
		`DROP TABLE groups`,
		`ALTER TABLE groups_v3 RENAME TO groups`,
		`CREATE INDEX IF NOT EXISTS idx_groups_map ON groups (map_id)`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DataVersion returns SQLite's data_version counter, which changes whenever
// another connection commits a write. The server polls this so that graph
// edits made by a separate `dialogmapper` CLI process still reach open
// browsers in real time.
func (s *Store) DataVersion() (int64, error) {
	var v int64
	err := s.db.QueryRow(`PRAGMA data_version`).Scan(&v)
	return v, err
}

// --- metadata --------------------------------------------------------------

// Meta reads a value from the key/value table that already carries the schema
// version. Returns "" when the key is absent, since every caller treats a
// missing value and an unreadable one the same way.
func (s *Store) Meta(key string) string {
	var v string
	if err := s.db.QueryRow(
		`SELECT value FROM schema_meta WHERE key = ?`, key,
	).Scan(&v); err != nil {
		return ""
	}
	return v
}

// SetMeta stores a value. Reserved for bookkeeping that belongs to the project
// rather than to a map — the update-check cache, for instance — so such things
// need no new files beside maps.db.
func (s *Store) SetMeta(key, value string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO schema_meta (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// --- identifiers -----------------------------------------------------------

var idEncoding = base32.NewEncoding("0123456789abcdefghjkmnpqrstvwxyz").
	WithPadding(base32.NoPadding)

var idState struct {
	mu      sync.Mutex
	lastMS  uint64
	entropy [10]byte
}

// NewID returns a lexicographically sortable, URL-safe identifier: 48 bits of
// millisecond timestamp followed by 80 bits of entropy, in Crockford base32
// (the ULID layout). The prefix makes ids readable in exports and logs.
//
// Sortability is not cosmetic here. Sibling ordering in exports and in the
// canvas auto-layout falls back to creation order, and a rapid capture loop
// creates several nodes inside one millisecond — so ids must be monotonic
// within a millisecond too, not merely across them. Within the same
// millisecond the previous entropy is incremented rather than redrawn, which
// is ULID's monotonic mode.
func NewID(prefix string) string {
	ms := uint64(time.Now().UTC().UnixMilli())

	idState.mu.Lock()
	if ms == idState.lastMS {
		// Increment the 80-bit entropy as a big-endian integer.
		for i := len(idState.entropy) - 1; i >= 0; i-- {
			idState.entropy[i]++
			if idState.entropy[i] != 0 {
				break
			}
			// Carried past the top byte: 2^80 ids in one millisecond is not
			// reachable, but wrapping would break ordering, so step the clock.
			if i == 0 {
				ms++
			}
		}
	} else {
		if _, err := rand.Read(idState.entropy[:]); err != nil {
			// crypto/rand failing is not a recoverable condition for an ID.
			panic("dialogmapper: entropy source unavailable: " + err.Error())
		}
		// Clear the top bit so a monotonic run can never overflow into the
		// timestamp field.
		idState.entropy[0] &= 0x7f
	}
	idState.lastMS = ms
	entropy := idState.entropy
	idState.mu.Unlock()

	var buf [16]byte
	binary.BigEndian.PutUint64(buf[0:8], ms<<16)
	copy(buf[6:], entropy[:])

	id := idEncoding.EncodeToString(buf[:])
	if prefix == "" {
		return id
	}
	return prefix + "_" + id
}

// --- errors ----------------------------------------------------------------

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("not found")

// ConflictError signals a uniqueness violation the caller can act on, such as
// re-adding an edge that already exists.
type ConflictError struct{ Detail string }

func (e *ConflictError) Error() string { return e.Detail }

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
