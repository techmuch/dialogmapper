package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/ibis"
	"github.com/techmuch/dialogmapper/internal/store"
)

func newExportCmd() *cobra.Command {
	var format, mapID, outPath string
	var all bool

	cmd := &cobra.Command{
		Use:   "export",
		Short: "Dump a map as Markdown or JSON-LD",
		Long: `Traverses the map along IBIS relationships and writes it out for
downstream processing — the post-computation half of the AI loop.

Markdown gives an indented argument outline that reads well in a prompt.
JSON-LD gives the full graph with a vocabulary, including the edge grammar, so
a consumer can reason about the structure without guessing field names.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format = strings.ToLower(strings.TrimSpace(format))
			switch format {
			case "md", "markdown", "json", "jsonld", "json-ld":
			default:
				return fmt.Errorf("unknown format %q: expected md or json", format)
			}

			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			var targets []store.Map
			switch {
			case all:
				if targets, err = st.ListMaps(); err != nil {
					return err
				}
			case mapID != "":
				m, err := st.GetMap(mapID)
				if err != nil {
					return err
				}
				targets = []store.Map{*m}
			default:
				m, err := st.DefaultMap()
				if err != nil {
					return err
				}
				targets = []store.Map{*m}
			}
			if len(targets) == 0 {
				return fmt.Errorf("no maps to export")
			}

			out := cmd.OutOrStdout()
			if outPath != "" {
				f, err := os.Create(outPath)
				if err != nil {
					return err
				}
				defer f.Close()
				out = f
			}

			isJSON := format != "md" && format != "markdown"
			if isJSON && len(targets) > 1 {
				// Concatenated JSON documents are not valid JSON, so multiple
				// maps go into a single graph container.
				docs := make([]json.RawMessage, 0, len(targets))
				for _, m := range targets {
					g, err := st.Graph(m.ID)
					if err != nil {
						return err
					}
					b, err := g.ExportJSONLD()
					if err != nil {
						return err
					}
					docs = append(docs, b)
				}
				body, err := json.MarshalIndent(map[string]any{
					"@context": "https://dialogmapper.dev/ns#",
					"@graph":   docs,
				}, "", "  ")
				if err != nil {
					return err
				}
				_, err = fmt.Fprintln(out, string(body))
				return err
			}

			for i, m := range targets {
				g, err := st.Graph(m.ID)
				if err != nil {
					return err
				}
				if isJSON {
					b, err := g.ExportJSONLD()
					if err != nil {
						return err
					}
					if _, err := fmt.Fprintln(out, string(b)); err != nil {
						return err
					}
					continue
				}
				if i > 0 {
					fmt.Fprint(out, "\n---\n\n")
				}
				if _, err := fmt.Fprint(out, g.ExportMarkdown()); err != nil {
					return err
				}
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&format, "format", "f", "md", "output format: md or json")
	cmd.Flags().StringVar(&mapID, "map-id", "", "map to export (defaults to the most recent)")
	cmd.Flags().BoolVar(&all, "all", false, "export every map")
	cmd.Flags().StringVarP(&outPath, "out", "o", "", "write to a file instead of stdout")
	return cmd
}

func newGrammarCmd() *cobra.Command {
	var asJSON bool

	cmd := &cobra.Command{
		Use:   "grammar",
		Short: "Print the IBIS edge rules this binary enforces",
		Long: `Prints the legal node types and relationships. Point an AI agent at
` + "`dialogmapper grammar --json`" + ` so it can construct valid edges instead
of guessing and retrying.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()
			if asJSON {
				b, err := json.MarshalIndent(ibis.Grammar(), "", "  ")
				if err != nil {
					return err
				}
				_, err = fmt.Fprintln(out, string(b))
				return err
			}
			g := ibis.Grammar()
			fmt.Fprintln(out, "Node types:")
			for _, t := range ibis.NodeTypes {
				fmt.Fprintf(out, "  %-9s %s\n", t, markerFor(t))
			}
			fmt.Fprintln(out, "\nLegal edges (read source-first):")
			for _, r := range g["rules"].([]map[string]any) {
				fmt.Fprintf(out, "  %-12s %v → %v\n",
					r["relationship"], r["sources"], r["targets"])
				fmt.Fprintf(out, "  %-12s %s\n", "", r["description"])
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit machine-readable JSON")
	return cmd
}
