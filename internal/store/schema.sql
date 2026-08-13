-- dialogmapper schema (v1)
--
-- Design notes:
--   * Nodes are map-agnostic. A node's existence is independent of any map,
--     which is what makes transclusion possible: the same node id may appear
--     in many maps via the map_nodes join table.
--   * Layout is a property of the (map, node) pair, not of the node. The same
--     node sits at different coordinates in different maps.
--   * Edges are scoped to a map. Two nodes may be linked in one map and
--     unrelated in another; the argument context belongs to the conversation,
--     not to the ideas themselves.
--   * IBIS relationship legality is enforced in Go (internal/ibis) so the
--     errors are readable and the ruleset can evolve without a migration.
--     The CHECK constraints here cover only invariants that can never change.

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    map_id     TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    color      TEXT NOT NULL DEFAULT 'slate',
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    w          REAL NOT NULL DEFAULT 320,
    h          REAL NOT NULL DEFAULT 240,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL
        CHECK (type IN ('note', 'question', 'idea', 'pro', 'con', 'map')),
    title TEXT NOT NULL,
    -- content is a JSON payload: markdown body, tags, status, assets, links.
    -- See store.NodeContent for the canonical shape.
    content TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid (content)),
    -- For type='map' nodes: the map this node stands in for, enabling a map
    -- to be embedded as a single node inside another map.
    map_ref_id TEXT REFERENCES maps (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (type <> 'map' OR map_ref_id IS NOT NULL)
);

-- The transclusion table. A row here means "this node is visible on this map".
-- Deleting the row removes the node from the map but never destroys the node.
CREATE TABLE IF NOT EXISTS map_nodes (
    map_id  TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    -- NULL coordinates mean "unplaced": the client auto-layout engine owns
    -- placement. Blind additions from mobile or the CLI land here.
    x         REAL,
    y         REAL,
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    group_id  TEXT REFERENCES groups (id) ON DELETE SET NULL,
    added_at  TEXT NOT NULL,
    PRIMARY KEY (map_id, node_id)
);

CREATE TABLE IF NOT EXISTS edges (
    id                TEXT PRIMARY KEY,
    map_id            TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
    source_node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    target_node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL
        CHECK (
            relationship_type IN (
                'responds_to', 'questions', 'supports',
                'objects_to', 'relates_to', 'specializes'
            )
        ),
    created_at TEXT NOT NULL,
    -- A node can never argue with itself.
    CHECK (source_node_id <> target_node_id)
);

CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    node_id    TEXT REFERENCES nodes (id) ON DELETE CASCADE,
    rel_path   TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT '',
    bytes      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- One logical edge per (map, source, target, relationship).
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
    ON edges (map_id, source_node_id, target_node_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_edges_map     ON edges (map_id);
CREATE INDEX IF NOT EXISTS idx_edges_source  ON edges (source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target  ON edges (target_node_id);
CREATE INDEX IF NOT EXISTS idx_map_nodes_node ON map_nodes (node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type    ON nodes (type);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_groups_map    ON groups (map_id);
CREATE INDEX IF NOT EXISTS idx_assets_node   ON assets (node_id);

-- Keep nodes.updated_at honest without requiring every writer to remember.
CREATE TRIGGER IF NOT EXISTS trg_nodes_touch
AFTER UPDATE ON nodes
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE nodes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

-- Touch the parent map whenever its graph changes, so "recently active map"
-- ordering is meaningful in the UI.
CREATE TRIGGER IF NOT EXISTS trg_edges_touch_map
AFTER INSERT ON edges
FOR EACH ROW
BEGIN
    UPDATE maps SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.map_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_map_nodes_touch_map
AFTER INSERT ON map_nodes
FOR EACH ROW
BEGIN
    UPDATE maps SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.map_id;
END;

-- Convenience view: every node with the number of maps it appears in, which
-- is what drives the transclusion badge in the UI.
CREATE VIEW IF NOT EXISTS node_transclusions AS
SELECT
    n.id AS node_id,
    count(mn.map_id) AS map_count
FROM nodes n
LEFT JOIN map_nodes mn ON mn.node_id = n.id
GROUP BY n.id;
