// Package cli wires the dialogmapper command tree.
package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/store"
)

// projectDir is the resolved project root for the current invocation.
var projectDir string

// buildVersion is the version this binary was built as, which the update check
// compares against the newest release.
var buildVersion string

// Execute runs the command tree.
func Execute(version string) error {
	buildVersion = version
	root := &cobra.Command{
		Use:   "dialogmapper",
		Short: "A local-first, AI-friendly IBIS dialog mapping environment",
		Long: `dialogmapper models wicked problems as Issue-Based Information System
maps: Questions, Ideas that answer them, and Pros and Cons that argue about
those Ideas.

Everything lives in one SQLite file and one binary. Nodes are shared, not
copied, so the same idea can appear in several maps at once and stay in sync.`,
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.PersistentFlags().StringVarP(&projectDir, "dir", "C", ".",
		"project directory containing maps.db")

	root.AddCommand(
		newInitCmd(),
		newStartCmd(),
		newSeedCmd(),
		newExportCmd(),
		newGrammarCmd(),
		newUndoCmd(),
		newApplyCmd(),
		newMapCmd(),
		newNodeCmd(),
		newEdgeCmd(),
		newRedoCmd(),
	)
	return root.Execute()
}

// resolveDir returns the absolute project directory.
func resolveDir() (string, error) {
	abs, err := filepath.Abs(projectDir)
	if err != nil {
		return "", err
	}
	return abs, nil
}

// openProject opens the store, failing with an actionable message when the
// directory has not been initialized.
func openProject() (*store.Store, error) {
	dir, err := resolveDir()
	if err != nil {
		return nil, err
	}
	if !store.Exists(dir) {
		return nil, fmt.Errorf(
			"no %s in %s — run `dialogmapper init` first", store.DBFileName, dir)
	}
	return store.Open(dir)
}

// mustWrite writes a file only if absent, so re-running init never clobbers a
// user's edited README or AGENTS file.
func writeIfAbsent(path, content string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, err
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return false, err
	}
	return true, nil
}
