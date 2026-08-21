package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/ops"
	"github.com/techmuch/dialogmapper/internal/store"
)

// The `map`, `node` and `edge` commands are typing conveniences over the same
// operations `apply` takes. Every one builds an ops.Op and hands it to the same
// executor, so there is exactly one code path to validate, journal and test —
// a second implementation would be a second place for the grammar to be
// forgotten.

// runOps applies a batch and prints the outcome in the usual form.
func runOps(cmd *cobra.Command, list []ops.Op) error {
	st, err := openProject()
	if err != nil {
		return err
	}
	defer st.Close()

	rep := ops.New(st.As(store.CLIActor)).Apply(list, false)
	printReport(cmd.OutOrStdout(), rep)
	if rep.Error != "" {
		return errSilent{rep.Error}
	}
	return nil
}

// confirm asks before something irreversible-looking. Destructive operations
// are journaled and undoable, but "undoable" is a poor substitute for not
// having done it, especially for an agent running unattended.
func confirm(cmd *cobra.Command, yes bool, prompt string) (bool, error) {
	if yes {
		return true, nil
	}
	in, isFile := cmd.InOrStdin().(*os.File)
	if !isFile || !isTerminal(cmd.OutOrStdout()) {
		// Nothing is there to answer. Refusing is the safe reading: a script
		// that means it can pass --yes.
		return false, fmt.Errorf("%s\nre-run with --yes to confirm", prompt)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "%s [y/N] ", prompt)
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && err != io.EOF {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes", nil
}

func newMapCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "map",
		Short: "List, create and delete maps",
	}

	var asJSON bool
	list := &cobra.Command{
		Use:   "list",
		Short: "List the maps in this project",
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()
			maps, err := st.ListMaps()
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			if asJSON {
				enc := json.NewEncoder(out)
				enc.SetIndent("", "  ")
				return enc.Encode(maps)
			}
			if len(maps) == 0 {
				fmt.Fprintln(out, "No maps yet. Create one with `dialogmapper map new <name>`.")
				return nil
			}
			for _, m := range maps {
				fmt.Fprintf(out, "%-28s  %4d nodes  %s\n", m.Name, m.NodeCount, m.ID)
			}
			return nil
		},
	}
	list.Flags().BoolVar(&asJSON, "json", false, "print as JSON")

	var description string
	create := &cobra.Command{
		Use:   "new <name>",
		Short: "Create a map",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runOps(cmd, []ops.Op{{
				Op: ops.CreateMap, Name: args[0], Description: description,
			}})
		},
	}
	create.Flags().StringVar(&description, "description", "", "what this map is about")

	var yes bool
	rm := &cobra.Command{
		Use:   "rm <name|id>",
		Short: "Delete a map",
		Long: `Deletes a map, its edges, its placements and its groups.

Nodes survive: a map is a view, and the same node may appear on others. The
delete is journaled, so ` + "`dialogmapper undo`" + ` brings the whole map back.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ok, err := confirm(cmd, yes,
				fmt.Sprintf("Delete map %q? Nodes are kept, and undo will restore it.", args[0]))
			if err != nil {
				return err
			}
			if !ok {
				fmt.Fprintln(cmd.OutOrStdout(), "Left alone.")
				return nil
			}
			return runOps(cmd, []ops.Op{{Op: ops.DeleteMap, Map: args[0]}})
		},
	}
	rm.Flags().BoolVar(&yes, "yes", false, "do not ask")

	var clearYes bool
	clear := &cobra.Command{
		Use:   "clear <name|id>",
		Short: "Remove every node from a map, keeping the map",
		Long: `Takes every node off the map without deleting the map itself.

Nodes shared with other maps stay on those, since removing a node from one view
must never destroy it in another.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			ex := ops.New(st.As(store.CLIActor))
			id, err := ex.MapID(args[0])
			if err != nil {
				return err
			}
			g, err := st.Graph(id)
			if err != nil {
				return err
			}
			if len(g.Nodes) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "That map is already empty.")
				return nil
			}
			ok, err := confirm(cmd, clearYes,
				fmt.Sprintf("Remove %d node(s) from %q? They survive on any other map.", len(g.Nodes), args[0]))
			if err != nil {
				return err
			}
			if !ok {
				fmt.Fprintln(cmd.OutOrStdout(), "Left alone.")
				return nil
			}
			batch := make([]ops.Op, 0, len(g.Nodes))
			for _, n := range g.Nodes {
				batch = append(batch, ops.Op{Op: ops.RemoveNode, ID: n.ID, Map: id})
			}
			rep := ex.Apply(batch, false)
			printReport(cmd.OutOrStdout(), rep)
			if rep.Error != "" {
				return errSilent{rep.Error}
			}
			return nil
		},
	}
	clear.Flags().BoolVar(&clearYes, "yes", false, "do not ask")

	cmd.AddCommand(list, create, rm, clear)
	return cmd
}

func newNodeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "node",
		Short: "Add, edit and remove nodes",
	}

	var (
		mapRef, nodeType, title, body, status, parent, rel string
		tags, links                                        []string
	)
	add := &cobra.Command{
		Use:   "add",
		Short: "Add a node, optionally attached to an existing one",
		Example: `  dialogmapper node add --map Caching --type question --title "Should we cache reads?"
  dialogmapper node add --type note --title "Ref: Howard (1966)" \
      --link "https://doi.org/10.1109/TSSC.1966.300074" --parent idea_01h... `,
		RunE: func(cmd *cobra.Command, args []string) error {
			op := ops.Op{
				Op: ops.CreateNode, Map: mapRef, Parent: parent, Rel: rel,
				Type: &nodeType, Title: &title,
			}
			if cmd.Flags().Changed("body") {
				op.Body = &body
			}
			if cmd.Flags().Changed("status") {
				op.Status = &status
			}
			if cmd.Flags().Changed("tag") {
				op.Tags = &tags
			}
			if cmd.Flags().Changed("link") {
				parsed, err := parseLinks(links)
				if err != nil {
					return err
				}
				op.Links = &parsed
			}
			return runOps(cmd, []ops.Op{op})
		},
	}
	add.Flags().StringVar(&mapRef, "map", "", "map name or id (optional when the project has one map)")
	add.Flags().StringVar(&nodeType, "type", "", "question, idea, pro, con, note or map")
	add.Flags().StringVar(&title, "title", "", "the node's title")
	add.Flags().StringVar(&body, "body", "", "markdown body")
	add.Flags().StringVar(&status, "status", "", "open, resolved, rejected or parked")
	add.Flags().StringVar(&parent, "parent", "", "id of the node to attach to")
	add.Flags().StringVar(&rel, "rel", "", "relationship to the parent; inferred when omitted")
	add.Flags().StringArrayVar(&tags, "tag", nil, "tag, repeatable")
	add.Flags().StringArrayVar(&links, "link", nil, "url or \"url|title\", repeatable")
	_ = add.MarkFlagRequired("type")
	_ = add.MarkFlagRequired("title")

	var (
		eTitle, eBody, eStatus, eType string
		eTags, eLinks                 []string
	)
	edit := &cobra.Command{
		Use:     "edit <id>",
		Short:   "Change a node's fields",
		Args:    cobra.ExactArgs(1),
		Example: `  dialogmapper node edit idea_01h... --status resolved`,
		RunE: func(cmd *cobra.Command, args []string) error {
			op := ops.Op{Op: ops.UpdateNode, ID: args[0]}
			if cmd.Flags().Changed("title") {
				op.Title = &eTitle
			}
			if cmd.Flags().Changed("body") {
				op.Body = &eBody
			}
			if cmd.Flags().Changed("status") {
				op.Status = &eStatus
			}
			if cmd.Flags().Changed("type") {
				op.Type = &eType
			}
			if cmd.Flags().Changed("tag") {
				op.Tags = &eTags
			}
			if cmd.Flags().Changed("link") {
				parsed, err := parseLinks(eLinks)
				if err != nil {
					return err
				}
				op.Links = &parsed
			}
			if op.Title == nil && op.Body == nil && op.Status == nil &&
				op.Type == nil && op.Tags == nil && op.Links == nil {
				return fmt.Errorf("nothing to change; pass at least one of --title, --body, --status, --type, --tag or --link")
			}
			return runOps(cmd, []ops.Op{op})
		},
	}
	edit.Flags().StringVar(&eTitle, "title", "", "new title")
	edit.Flags().StringVar(&eBody, "body", "", "new markdown body")
	edit.Flags().StringVar(&eStatus, "status", "", "open, resolved, rejected or parked")
	edit.Flags().StringVar(&eType, "type", "", "change the node's type; its links are relabelled to match")
	edit.Flags().StringArrayVar(&eTags, "tag", nil, "replace the tags, repeatable")
	edit.Flags().StringArrayVar(&eLinks, "link", nil, "replace the links, repeatable")

	var fromMap string
	var rmYes bool
	rm := &cobra.Command{
		Use:   "rm <id>",
		Short: "Delete a node everywhere, or remove it from one map",
		Long: `Without --map this destroys the node on every map it appears on.

With --map it is only taken off that map, which is what you want for a node
shared with other maps. Either way the change is journaled and undoable.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			prompt := fmt.Sprintf("Delete node %s from every map?", args[0])
			op := ops.Op{Op: ops.DeleteNode, ID: args[0]}
			if fromMap != "" {
				prompt = fmt.Sprintf("Remove node %s from %q?", args[0], fromMap)
				op = ops.Op{Op: ops.RemoveNode, ID: args[0], Map: fromMap}
			}
			ok, err := confirm(cmd, rmYes, prompt+" Undo will restore it.")
			if err != nil {
				return err
			}
			if !ok {
				fmt.Fprintln(cmd.OutOrStdout(), "Left alone.")
				return nil
			}
			return runOps(cmd, []ops.Op{op})
		},
	}
	rm.Flags().StringVar(&fromMap, "map", "", "remove from this map only, keeping the node elsewhere")
	rm.Flags().BoolVar(&rmYes, "yes", false, "do not ask")

	cmd.AddCommand(add, edit, rm)
	return cmd
}

func newEdgeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "edge",
		Short: "Link and unlink nodes",
	}

	var mapRef, rel string
	add := &cobra.Command{
		Use:   "add <from-id> <to-id>",
		Short: "Link two nodes",
		Long: `Edges point child to parent, the way they read aloud: a Pro supports an
Idea, so <from> is the Pro and <to> is the Idea.

Omit --rel to let the IBIS grammar infer the obvious relationship between the
two types.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runOps(cmd, []ops.Op{{
				Op: ops.CreateEdge, Map: mapRef, From: args[0], To: args[1], Rel: rel,
			}})
		},
	}
	add.Flags().StringVar(&mapRef, "map", "", "map name or id (optional when the project has one map)")
	add.Flags().StringVar(&rel, "rel", "", "responds_to, questions, supports, objects_to, relates_to or specializes")

	rm := &cobra.Command{
		Use:   "rm <edge-id>",
		Short: "Remove a link",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runOps(cmd, []ops.Op{{Op: ops.DeleteEdge, ID: args[0]}})
		},
	}

	cmd.AddCommand(add, rm)
	return cmd
}

// parseLinks accepts "url" or "url|title", which keeps the flag typeable while
// still producing the {url,title} objects the content JSON expects. Passing a
// bare string where an object belongs is one of the mistakes hand-written SQL
// made, and it breaks the UI rather than erroring.
func parseLinks(raw []string) ([]store.Link, error) {
	out := make([]store.Link, 0, len(raw))
	for _, r := range raw {
		url, title, _ := strings.Cut(r, "|")
		url = strings.TrimSpace(url)
		if url == "" {
			return nil, fmt.Errorf("--link %q has no url", r)
		}
		out = append(out, store.Link{URL: url, Title: strings.TrimSpace(title)})
	}
	return out, nil
}
