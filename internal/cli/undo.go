package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/davidfullmer/dialogmapper/internal/store"
)

// `dialogmapper undo` exists mainly for one situation: a `seed` run that
// produced the wrong structure. Without it the only remedy is deleting nodes
// by hand or starting the project over.
//
// It shares the journal with the UI but under its own actor, so undoing a
// seed from a terminal never eats what somebody was doing on the canvas.
func newUndoCmd() *cobra.Command {
	var mapID string
	var steps int
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "undo",
		Short: "Reverse the last change made from the command line",
		Long: `Reverses changes recorded under the CLI's own undo history — most
usefully, an entire ` + "`dialogmapper seed`" + ` run.

Undo is scoped per actor: this reverses command-line changes only, and never
touches what someone is doing in the browser. Use --steps to walk back several
actions, or --dry-run to see what would go first.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			out := cmd.OutOrStdout()

			if dryRun {
				next, err := st.PeekUndo(store.CLIActor, mapID)
				if err != nil {
					return err
				}
				if next == nil {
					fmt.Fprintln(out, "Nothing to undo.")
					return nil
				}
				depth, _, err := st.UndoDepth(store.CLIActor, mapID)
				if err != nil {
					return err
				}
				fmt.Fprintf(out, "Would undo: %s\n(%d action%s available)\n",
					next.Label, depth, plural(depth))
				return nil
			}

			if steps < 1 {
				steps = 1
			}
			actor := st.As(store.CLIActor)
			var done int
			for i := 0; i < steps; i++ {
				entry, err := actor.Undo(store.CLIActor, mapID)
				if errors.Is(err, store.ErrNothingToUndo) {
					break
				}
				if err != nil {
					return err
				}
				fmt.Fprintf(out, "Undone: %s\n", entry.Label)
				done++
			}
			if done == 0 {
				fmt.Fprintln(out, "Nothing to undo.")
				return nil
			}
			if done < steps {
				fmt.Fprintf(out, "(history exhausted after %d)\n", done)
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&mapID, "map-id", "", "restrict to one map")
	cmd.Flags().IntVar(&steps, "steps", 1, "how many actions to reverse")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "show what would be undone")
	return cmd
}

func newRedoCmd() *cobra.Command {
	var mapID string
	var steps int

	cmd := &cobra.Command{
		Use:   "redo",
		Short: "Reapply the last change undone from the command line",
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			if steps < 1 {
				steps = 1
			}
			out := cmd.OutOrStdout()
			actor := st.As(store.CLIActor)
			var done int
			for i := 0; i < steps; i++ {
				entry, err := actor.Redo(store.CLIActor, mapID)
				if errors.Is(err, store.ErrNothingToRedo) {
					break
				}
				if err != nil {
					return err
				}
				fmt.Fprintf(out, "Redone: %s\n", entry.Label)
				done++
			}
			if done == 0 {
				fmt.Fprintln(out, "Nothing to redo.")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&mapID, "map-id", "", "restrict to one map")
	cmd.Flags().IntVar(&steps, "steps", 1, "how many actions to reapply")
	return cmd
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
