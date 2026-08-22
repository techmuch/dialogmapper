package cli

import "fmt"

// banner returns the startup terminal art and version badge for dialogmapper.
func banner(version string, color bool) string {
	if version == "" {
		version = "dev"
	}
	if color {
		cyan := "\033[38;5;39m"
		bold := "\033[1m"
		dim := "\033[2m"
		reset := "\033[0m"
		qCol := "\033[38;5;221m" // Question yellow
		iCol := "\033[38;5;111m" // Idea blue/purple
		pCol := "\033[38;5;78m"  // Pro green
		cCol := "\033[38;5;203m" // Con red/rose

		art := cyan + `    ___      __                                           
 ___/ (_)__ _/ /___  ___ ___ _  ___ ____  ___  ___ ____
/ _  / / _ ` + "`" + `/ / _ \/ _ ` + "`" + `/  ' \/ _ ` + "`" + `/ _ \/ _ \/ -_) __/
\_,_/_/\_,_/_/\___/\_, /_/_/_/\_,_/ .__/ .__/\__/_/   ` + bold + version + reset + cyan + `
                  /___/          /_/  /_/             ` + reset

		legend := fmt.Sprintf("  %s[?]%s Question  %s[!]%s Idea  %s[+]%s Pro  %s[-]%s Con  %s•  Local-First IBIS Dialog Mapping%s",
			qCol, reset, iCol, reset, pCol, reset, cCol, reset, dim, reset)

		return fmt.Sprintf("\n%s\n\n%s\n\n", art, legend)
	}

	art := `    ___      __                                           
 ___/ (_)__ _/ /___  ___ ___ _  ___ ____  ___  ___ ____
/ _  / / _ ` + "`" + `/ / _ \/ _ ` + "`" + `/  ' \/ _ ` + "`" + `/ _ \/ _ \/ -_) __/
\_,_/_/\_,_/_/\___/\_, /_/_/_/\_,_/ .__/ .__/\__/_/   ` + version + `
                  /___/          /_/  /_/             `

	legend := "  [?] Question  [!] Idea  [+] Pro  [-] Con  •  Local-First IBIS Dialog Mapping"
	return fmt.Sprintf("\n%s\n\n%s\n\n", art, legend)
}
