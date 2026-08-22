package cli

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/update"
)

// `dialogmapper upgrade` replaces this binary with the newest release.
//
// It exists because dialogmapper ships as a single executable people download
// directly, so there is otherwise no upgrade path that does not involve going
// back to the website. Go is deliberately not required: the published build for
// this platform is fetched, not compiled.
func newUpgradeCmd() *cobra.Command {
	var check bool
	var yes bool

	cmd := &cobra.Command{
		Use:   "upgrade",
		Short: "Replace this binary with the latest release",
		Long: `Downloads the published build for this platform and replaces the running
binary with it. No Go toolchain required.

The download is verified against the SHA256SUMS published with the release and
is refused outright if it does not match. The replacement is a rename within
the same directory, so an interrupted upgrade leaves either the old binary or
the new one — never a broken half of either. Nothing is executed.

When the binary is managed by Homebrew, Nix or snap, this refuses and names the
right command instead: replacing a package-managed file works only until the
package manager puts its own copy back.`,
		Example: `  dialogmapper upgrade --check
  dialogmapper upgrade`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()

			exe, err := os.Executable()
			if err != nil {
				return fmt.Errorf("cannot locate this binary: %w", err)
			}
			// Follow symlinks so a link in /usr/local/bin does not get replaced
			// by a file, breaking whatever else pointed at the real one.
			if resolved, err := os.Readlink(exe); err == nil && resolved != "" {
				exe = resolved
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), 2*time.Minute)
			defer cancel()

			fmt.Fprintf(out, "Current version: %s\n", buildVersion)
			rel, err := update.Latest(ctx, update.EndpointFromEnv(), buildVersion)
			if err != nil {
				return fmt.Errorf("checking for a newer release: %w", err)
			}

			if !update.Newer(buildVersion, rel.TagName) {
				fmt.Fprintf(out, "Latest release:  %s\n", rel.TagName)
				if buildVersion == rel.TagName {
					fmt.Fprintln(out, "\nAlready up to date.")
				} else {
					// A development build, or one ahead of the newest release.
					fmt.Fprintf(out,
						"\nNothing to do: %q is not behind %q.\n", buildVersion, rel.TagName)
				}
				return nil
			}
			fmt.Fprintf(out, "Latest release:  %s\n", rel.TagName)

			plan := update.Plan(rel, buildVersion, exe)
			if plan.Blocked != "" {
				return fmt.Errorf("%s", plan.Blocked)
			}

			fmt.Fprintf(out, "\n  %s → %s\n", plan.Current, plan.Latest)
			fmt.Fprintf(out, "  %s (%s/%s)\n", plan.Asset.Name, runtime.GOOS, runtime.GOARCH)
			fmt.Fprintf(out, "  installs to %s\n", plan.Path)

			if check {
				fmt.Fprintln(out, "\n--check given; nothing was downloaded.")
				return nil
			}

			ok, err := confirm(cmd, yes, fmt.Sprintf("\nReplace %s?", plan.Path))
			if err != nil {
				return err
			}
			if !ok {
				fmt.Fprintln(out, "Left alone.")
				return nil
			}

			// Checksums first: fetching them after the binary would still work,
			// but there is no reason to spend a 12 MB download discovering the
			// release cannot be verified.
			sums, err := update.FetchSums(ctx, plan.Sums)
			if err != nil {
				return fmt.Errorf("%w — refusing to install an unverifiable binary", err)
			}
			want, listed := sums[plan.Asset.Name]
			if !listed {
				return fmt.Errorf(
					"%s is not listed in SHA256SUMS — refusing to install an unverifiable binary",
					plan.Asset.Name)
			}

			fmt.Fprintf(out, "\n  downloading…\n")
			tmp, got, err := update.Download(ctx, plan.Asset, plan.Path)
			if err != nil {
				return err
			}
			defer os.Remove(tmp) // no-op once the rename has moved it

			if got != want {
				return fmt.Errorf(
					"checksum mismatch for %s\n  expected %s\n  got      %s\n"+
						"Nothing was installed", plan.Asset.Name, want, got)
			}
			fmt.Fprintf(out, "  checksum ok\n")

			if err := update.Replace(tmp, plan.Path); err != nil {
				return err
			}
			fmt.Fprintf(out, "  installed %s\n", plan.Latest)
			if runtime.GOOS == "windows" {
				fmt.Fprintf(out, "\n  The previous binary is at %s.old and can be deleted.\n", plan.Path)
			}
			fmt.Fprintf(out, "\nRun `dialogmapper --version` to confirm.\n")
			return nil
		},
	}

	cmd.Flags().BoolVar(&check, "check", false, "report what would be installed and stop")
	cmd.Flags().BoolVar(&yes, "yes", false, "do not ask before replacing the binary")
	return cmd
}
