package store

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/techmuch/dialogmapper/internal/ibis"
)

// ExportMarkdown renders a map as an indented IBIS outline. The traversal is
// deliberately not a generic graph dump: it follows the argument structure so
// an LLM reading the output sees the deliberation, not an adjacency list.
//
// Ordering within a level is Questions, then Ideas, then Pros, then Cons, then
// Notes — the order a human would argue in.
func (g *Graph) ExportMarkdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", g.Map.Name)
	if g.Map.Description != "" {
		fmt.Fprintf(&b, "%s\n\n", g.Map.Description)
	}
	fmt.Fprintf(&b, "> Dialog map exported from dialogmapper. %d nodes, %d links.\n\n",
		len(g.Nodes), len(g.Edges))

	byID := map[string]*Node{}
	for i := range g.Nodes {
		byID[g.Nodes[i].ID] = &g.Nodes[i]
	}

	// children[target] = nodes pointing at target via a hierarchical edge.
	children := map[string][]childRef{}
	hasParent := map[string]bool{}
	for _, e := range g.Edges {
		if !ibis.IsHierarchical(e.Relationship) {
			continue
		}
		children[e.TargetNodeID] = append(children[e.TargetNodeID],
			childRef{id: e.SourceNodeID, rel: e.Relationship})
		hasParent[e.SourceNodeID] = true
	}

	roots := []*Node{}
	for i := range g.Nodes {
		if !hasParent[g.Nodes[i].ID] {
			roots = append(roots, &g.Nodes[i])
		}
	}
	sortNodes(roots)

	visited := map[string]bool{}
	for _, r := range roots {
		writeOutline(&b, r, byID, children, visited, 0, "")
	}

	// Anything left is inside a cycle of associative edges or otherwise
	// unreachable from a root. Emit it rather than silently dropping it.
	var orphans []*Node
	for i := range g.Nodes {
		if !visited[g.Nodes[i].ID] {
			orphans = append(orphans, &g.Nodes[i])
		}
	}
	if len(orphans) > 0 {
		b.WriteString("\n## Unlinked\n\n")
		sortNodes(orphans)
		for _, n := range orphans {
			writeOutline(&b, n, byID, children, visited, 0, "")
		}
	}

	// Associative links are cross-cutting by nature and would distort the
	// outline, so they get their own section.
	var assoc []Edge
	for _, e := range g.Edges {
		if !ibis.IsHierarchical(e.Relationship) {
			assoc = append(assoc, e)
		}
	}
	if len(assoc) > 0 {
		b.WriteString("\n## Cross-links\n\n")
		for _, e := range assoc {
			src, sok := byID[e.SourceNodeID]
			tgt, tok := byID[e.TargetNodeID]
			if !sok || !tok {
				continue
			}
			fmt.Fprintf(&b, "- %s **%s** → %s **%s** _(%s)_\n",
				marker(src.Type), src.Title, marker(tgt.Type), tgt.Title, e.Relationship)
		}
	}
	return b.String()
}

type childRef struct {
	id  string
	rel ibis.Relationship
}

func writeOutline(b *strings.Builder, n *Node, byID map[string]*Node,
	children map[string][]childRef, visited map[string]bool, depth int, rel ibis.Relationship) {

	if visited[n.ID] {
		// Transcluded or re-entered: reference it instead of duplicating the
		// whole subtree, which would misrepresent the map's size.
		fmt.Fprintf(b, "%s- %s **%s** _(see above)_\n",
			strings.Repeat("  ", depth), marker(n.Type), n.Title)
		return
	}
	visited[n.ID] = true

	indent := strings.Repeat("  ", depth)
	fmt.Fprintf(b, "%s- %s **%s**", indent, marker(n.Type), n.Title)

	var meta []string
	if rel != "" {
		meta = append(meta, string(rel))
	}
	if n.Content.Status != "" && n.Content.Status != StatusOpen {
		meta = append(meta, string(n.Content.Status))
	}
	if n.MapCount > 1 {
		meta = append(meta, fmt.Sprintf("shared across %d maps", n.MapCount))
	}
	for _, t := range n.Content.Tags {
		meta = append(meta, "#"+t)
	}
	if len(meta) > 0 {
		fmt.Fprintf(b, " _(%s)_", strings.Join(meta, ", "))
	}
	b.WriteString("\n")

	if body := strings.TrimSpace(n.Content.Markdown); body != "" {
		for _, line := range strings.Split(body, "\n") {
			fmt.Fprintf(b, "%s  %s\n", indent, line)
		}
	}
	for _, a := range n.Content.Assets {
		fmt.Fprintf(b, "%s  ![%s](%s)\n", indent, a.Caption, a.Path)
	}
	for _, l := range n.Content.Links {
		fmt.Fprintf(b, "%s  [%s](%s)\n", indent, orDefault(l.Title, l.URL), l.URL)
	}

	kids := children[n.ID]
	resolved := make([]*Node, 0, len(kids))
	relOf := map[string]ibis.Relationship{}
	for _, c := range kids {
		if child, ok := byID[c.id]; ok {
			resolved = append(resolved, child)
			relOf[c.id] = c.rel
		}
	}
	sortNodes(resolved)
	for _, child := range resolved {
		writeOutline(b, child, byID, children, visited, depth+1, relOf[child.ID])
	}
}

// typeRank orders siblings the way an argument reads.
var typeRank = map[ibis.NodeType]int{
	ibis.Question: 0, ibis.Idea: 1, ibis.Map: 2,
	ibis.Pro: 3, ibis.Con: 4, ibis.Note: 5,
}

func sortNodes(ns []*Node) {
	sort.SliceStable(ns, func(i, j int) bool {
		ri, rj := typeRank[ns[i].Type], typeRank[ns[j].Type]
		if ri != rj {
			return ri < rj
		}
		return ns[i].CreatedAt < ns[j].CreatedAt
	})
}

// capitalize upper-cases the first byte. Node types are ASCII by construction,
// so this is correct without pulling in the unicode tables.
func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func marker(t ibis.NodeType) string {
	switch t {
	case ibis.Question:
		return "[?]"
	case ibis.Idea:
		return "[!]"
	case ibis.Pro:
		return "[+]"
	case ibis.Con:
		return "[-]"
	case ibis.Map:
		return "[#]"
	default:
		return "[·]"
	}
}

// ExportJSONLD renders the map as JSON-LD. The @context maps dialogmapper's
// vocabulary onto stable IRIs so downstream tooling can consume exports
// without hard-coding this project's field names.
func (g *Graph) ExportJSONLD() ([]byte, error) {
	const vocab = "https://dialogmapper.dev/ns#"

	nodes := make([]map[string]any, 0, len(g.Nodes))
	for _, n := range g.Nodes {
		item := map[string]any{
			"@id":       vocab + "node/" + n.ID,
			"@type":     vocab + capitalize(string(n.Type)),
			"id":        n.ID,
			"nodeType":  n.Type,
			"title":     n.Title,
			"status":    n.Content.Status,
			"tags":      n.Content.Tags,
			"createdAt": n.CreatedAt,
			"updatedAt": n.UpdatedAt,
			"mapCount":  n.MapCount,
		}
		if n.Content.Markdown != "" {
			item["body"] = n.Content.Markdown
		}
		if len(n.Content.Assets) > 0 {
			item["assets"] = n.Content.Assets
		}
		if len(n.Content.Links) > 0 {
			item["links"] = n.Content.Links
		}
		if n.MapCount > 1 {
			item["transcluded"] = true
		}
		nodes = append(nodes, item)
	}

	edges := make([]map[string]any, 0, len(g.Edges))
	for _, e := range g.Edges {
		edges = append(edges, map[string]any{
			"@id":          vocab + "edge/" + e.ID,
			"@type":        vocab + "Relationship",
			"source":       map[string]string{"@id": vocab + "node/" + e.SourceNodeID},
			"target":       map[string]string{"@id": vocab + "node/" + e.TargetNodeID},
			"relationship": e.Relationship,
			"hierarchical": ibis.IsHierarchical(e.Relationship),
			"createdAt":    e.CreatedAt,
		})
	}

	doc := map[string]any{
		"@context": map[string]any{
			"@vocab":       vocab,
			"id":           "@id",
			"title":        "http://purl.org/dc/terms/title",
			"body":         "http://purl.org/dc/terms/description",
			"createdAt":    "http://purl.org/dc/terms/created",
			"updatedAt":    "http://purl.org/dc/terms/modified",
			"source":       map[string]string{"@type": "@id"},
			"target":       map[string]string{"@type": "@id"},
			"relationship": map[string]string{"@type": "@vocab"},
		},
		"@id":       vocab + "map/" + g.Map.ID,
		"@type":     vocab + "DialogMap",
		"title":     g.Map.Name,
		"body":      g.Map.Description,
		"createdAt": g.Map.CreatedAt,
		"updatedAt": g.Map.UpdatedAt,
		"grammar":   ibis.Grammar(),
		"nodes":     nodes,
		"edges":     edges,
		"groups":    g.Groups,
	}
	return json.MarshalIndent(doc, "", "  ")
}
