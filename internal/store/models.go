package store

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

// Status marks where a node sits in the deliberation lifecycle.
type Status string

const (
	StatusOpen     Status = "open"
	StatusResolved Status = "resolved"
	StatusRejected Status = "rejected"
	StatusParked   Status = "parked"
)

// Asset is a local file referenced by a node. Paths are always relative to the
// project root so a map directory stays portable across machines.
type Asset struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"` // image | file
	Caption string `json:"caption,omitempty"`
	Mime    string `json:"mime,omitempty"`
	Bytes   int64  `json:"bytes,omitempty"`
}

// Link is an external reference attached to a node.
type Link struct {
	URL   string `json:"url"`
	Title string `json:"title,omitempty"`
}

// NodeContent is the JSON payload stored in nodes.content. Keeping the rich
// material here rather than in columns means the canvas can stay visually
// sparse while the sidebar carries arbitrary depth.
type NodeContent struct {
	Markdown string   `json:"markdown"`
	Tags     []string `json:"tags"`
	Status   Status   `json:"status"`
	Assets   []Asset  `json:"assets"`
	Links    []Link   `json:"links"`
	// Source records where a node came from: "ui", "mobile", "cli", "seed".
	// Useful when auditing what an AI pre-computation pass contributed.
	Source string `json:"source,omitempty"`
}

// DefaultContent returns an empty but well-formed payload.
func DefaultContent(source string) NodeContent {
	return NodeContent{
		Markdown: "",
		Tags:     []string{},
		Status:   StatusOpen,
		Assets:   []Asset{},
		Links:    []Link{},
		Source:   source,
	}
}

// normalize fills in zero values so the JSON written to SQLite is always the
// same shape. Clients can then rely on arrays existing.
func (c *NodeContent) normalize() {
	if c.Tags == nil {
		c.Tags = []string{}
	}
	if c.Assets == nil {
		c.Assets = []Asset{}
	}
	if c.Links == nil {
		c.Links = []Link{}
	}
	if c.Status == "" {
		c.Status = StatusOpen
	}
	seen := map[string]bool{}
	out := c.Tags[:0]
	for _, t := range c.Tags {
		t = strings.TrimSpace(strings.ToLower(t))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	c.Tags = out
}

func (c NodeContent) marshal() (string, error) {
	c.normalize()
	b, err := json.Marshal(c)
	return string(b), err
}

// Map is a single dialog map.
type Map struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	NodeCount   int    `json:"nodeCount,omitempty"`
}

// Node is a move in the conversation. It belongs to zero or more maps.
type Node struct {
	ID        string        `json:"id"`
	Type      ibis.NodeType `json:"type"`
	Title     string        `json:"title"`
	Content   NodeContent   `json:"content"`
	MapRefID  *string       `json:"mapRefId,omitempty"`
	CreatedAt string        `json:"createdAt"`
	UpdatedAt string        `json:"updatedAt"`

	// Placement is the node's position on the map currently being read. It is
	// nil when the node was fetched outside of a map context.
	Placement *Placement `json:"placement,omitempty"`
	// MapCount drives the transclusion badge: >1 means this node is shared.
	MapCount int `json:"mapCount"`
	// MapIDs lists every map the node appears in, for the "also appears in"
	// affordance in the sidebar.
	MapIDs []string `json:"mapIds,omitempty"`
}

// Placement is the per-map layout state for a transcluded node.
type Placement struct {
	X         *float64 `json:"x"`
	Y         *float64 `json:"y"`
	Collapsed bool     `json:"collapsed"`
	GroupID   *string  `json:"groupId,omitempty"`
	AddedAt   string   `json:"addedAt"`
}

// Edge is a typed, directed, map-scoped relationship between two nodes.
type Edge struct {
	ID           string            `json:"id"`
	MapID        string            `json:"mapId"`
	SourceNodeID string            `json:"sourceNodeId"`
	TargetNodeID string            `json:"targetNodeId"`
	Relationship ibis.Relationship `json:"relationshipType"`
	CreatedAt    string            `json:"createdAt"`
}

// Group is a set of nodes on one map that move together.
//
// There is no geometry here on purpose. The outline a user sees is derived
// from where the members are, so it cannot drift out of step with them, and a
// group with no members has nothing to draw and is removed.
type Group struct {
	ID        string `json:"id"`
	MapID     string `json:"mapId"`
	Title     string `json:"title"`
	Color     string `json:"color"`
	CreatedAt string `json:"createdAt"`
	// NodeIDs is the membership, in the order the nodes were added.
	NodeIDs []string `json:"nodeIds"`
}

// Graph is the full renderable state of one map.
type Graph struct {
	Map    Map     `json:"map"`
	Nodes  []Node  `json:"nodes"`
	Edges  []Edge  `json:"edges"`
	Groups []Group `json:"groups"`
}

// NewNodeInput is the write-side shape for creating a node, optionally
// attaching it to a map and linking it to a parent in one atomic call. The
// keyboard capture loop depends on this being a single round trip.
type NewNodeInput struct {
	Type    ibis.NodeType `json:"type"`
	Title   string        `json:"title"`
	Content *NodeContent  `json:"content,omitempty"`
	MapID   string        `json:"mapId"`
	X       *float64      `json:"x,omitempty"`
	Y       *float64      `json:"y,omitempty"`

	// ParentID and Relationship, when set, create the connecting edge in the
	// same transaction. Relationship may be empty to let the IBIS grammar
	// infer the obvious one.
	ParentID     string            `json:"parentId,omitempty"`
	Relationship ibis.Relationship `json:"relationshipType,omitempty"`
	// EdgeDirection reports whether the new node is the edge source ("from",
	// the default: a new Pro supports the selected Idea) or the target ("to").
	EdgeDirection string `json:"edgeDirection,omitempty"`
	Source        string `json:"source,omitempty"`
}

// NodePatch is a sparse update. Nil fields are left untouched.
type NodePatch struct {
	Title    *string        `json:"title,omitempty"`
	Type     *ibis.NodeType `json:"type,omitempty"`
	Markdown *string        `json:"markdown,omitempty"`
	Tags     *[]string      `json:"tags,omitempty"`
	Status   *Status        `json:"status,omitempty"`
	Assets   *[]Asset       `json:"assets,omitempty"`
	Links    *[]Link        `json:"links,omitempty"`
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}
