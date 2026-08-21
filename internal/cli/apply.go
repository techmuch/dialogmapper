package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/ops"
	"github.com/techmuch/dialogmapper/internal/store"
)

// `dialogmapper apply` is the door for anything that is not a browser.
//
// It exists because the only validated way to change a map used to be the HTTP
// API, which needs a running server. Without this, an agent or a script working
// offline had to write SQL straight into maps.db — skipping the IBIS grammar,
// the content JSON shape, and the undo journal all at once.
func newApplyCmd() *cobra.Command {
	var dryRun bool
	var schema bool
	var asJSON bool
	var file string

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Apply JSON mutations to a project",
		Long: `Reads a JSON array of operations from stdin and applies them in order.

Every operation goes through the same validation the canvas and the HTTP API
use, so the IBIS grammar is enforced, ids are generated for you, and each change
is journaled and reversible with ` + "`dialogmapper undo`" + `.

Run with --schema for the full contract, or --dry-run to validate without
writing anything.`,
		Example: `  echo '[{"op":"create_node","map":"Caching","type":"question",
          "title":"Should we cache reads?"}]' | dialogmapper apply

  dialogmapper apply --schema
  dialogmapper apply --dry-run < changes.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()

			if schema {
				enc := json.NewEncoder(out)
				enc.SetIndent("", "  ")
				return enc.Encode(ops.Schema())
			}

			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			var data []byte
			if file != "" && file != "-" {
				data, err = os.ReadFile(file)
			} else {
				data, err = io.ReadAll(cmd.InOrStdin())
			}
			if err != nil {
				return err
			}

			list, err := ops.Parse(data)
			if err != nil {
				return fmt.Errorf("could not read the operations: %w", err)
			}

			rep := ops.New(st.As(store.CLIActor)).Apply(list, dryRun)

			if asJSON {
				enc := json.NewEncoder(out)
				enc.SetIndent("", "  ")
				if err := enc.Encode(rep); err != nil {
					return err
				}
			} else {
				printReport(out, rep)
			}
			if rep.Error != "" {
				// A non-zero exit is what a script or an agent checks, so a
				// partially applied batch must not look like success.
				return errSilent{rep.Error}
			}
			return nil
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate the operations without writing anything")
	cmd.Flags().BoolVar(&schema, "schema", false, "print the operation contract as JSON and exit")
	cmd.Flags().BoolVar(&asJSON, "json", false, "report the outcome as JSON")
	cmd.Flags().StringVarP(&file, "file", "f", "", "read operations from a file instead of stdin")
	return cmd
}

func printReport(out io.Writer, rep ops.Report) {
	if rep.DryRun {
		fmt.Fprintf(out, "%d operation(s) validated; nothing was written.\n", rep.Total)
		return
	}
	for _, r := range rep.Results {
		if r.Label != "" {
			fmt.Fprintf(out, "  %-12s %s  %s\n", r.Op, r.ID, r.Label)
		} else {
			fmt.Fprintf(out, "  %-12s %s\n", r.Op, r.ID)
		}
	}
	if rep.Error != "" {
		fmt.Fprintf(out, "\n%d of %d applied, then: %s\n", rep.Applied, rep.Total, rep.Error)
		if rep.UndoHint != "" {
			fmt.Fprintf(out, "Reverse what did apply with: %s\n", rep.UndoHint)
		}
		return
	}
	if rep.UndoHint == "" {
		fmt.Fprintf(out, "\n%d operation(s) applied.\n", rep.Applied)
		return
	}
	fmt.Fprintf(out, "\n%d operation(s) applied. Undo with: %s\n", rep.Applied, rep.UndoHint)
	if rep.Reversible < rep.Applied {
		fmt.Fprintf(out, "(%d of them cannot be undone: creating a map is not journaled.)\n",
			rep.Applied-rep.Reversible)
	}
}

// errSilent reports failure without cobra reprinting usage for what is a data
// problem rather than a misuse of the command.
type errSilent struct{ msg string }

func (e errSilent) Error() string { return e.msg }
