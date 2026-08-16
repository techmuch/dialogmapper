package cli

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"

	"github.com/techmuch/dialogmapper/internal/ibis"
	"github.com/techmuch/dialogmapper/internal/store"
)

// Seeding is the pre-computation half of the AI loop: an agent (or a human)
// dumps research into a markdown file, and this turns it into a first-draft
// IBIS skeleton that a team can then argue with on the canvas. It is
// deliberately mechanical and predictable rather than clever — a seed you can
// predict is a seed you can write for.

var (
	headingRe = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	bulletRe  = regexp.MustCompile(`^\s*(?:[-*]|\d+[.)])\s+(.*)$`)
	proRe     = regexp.MustCompile(`^\s*\+\s+(.*)$`)
	conRe     = regexp.MustCompile(`^\s*!\s+(.*)$`)
	quoteRe   = regexp.MustCompile(`^\s*>\s?(.*)$`)
	tagRe     = regexp.MustCompile(`(?:^|\s)#([a-zA-Z][\w-]*)`)
)

func newSeedCmd() *cobra.Command {
	var contextFile, mapName, mapID string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "seed",
		Short: "Scaffold a map from a research document",
		Long: `Reads a markdown or text file and populates the database with IBIS
scaffolding, so a deliberation can start from existing material instead of a
blank canvas.

The conversion is intentionally literal:

  # Heading            a Question (phrased as one if it is not already)
  - bullet             an Idea responding to the enclosing Question
  + bullet             a Pro supporting the preceding Idea
  ! bullet             a Con objecting to the preceding Idea
  bullet ending in ?   a Question raised about the enclosing Question
  > quoted text        a Note attached to the enclosing Question
  plain paragraph      a Note attached to the enclosing Question

Trailing #hashtags become node tags. Use --dry-run to see the plan first.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if contextFile == "" {
				return fmt.Errorf("--context is required: point it at a markdown or text file")
			}

			var src io.Reader
			if contextFile == "-" {
				src = cmd.InOrStdin()
			} else {
				f, err := os.Open(contextFile)
				if err != nil {
					return fmt.Errorf("read context: %w", err)
				}
				defer f.Close()
				src = f
			}

			plan, err := parseContext(src)
			if err != nil {
				return err
			}
			if len(plan) == 0 {
				return fmt.Errorf("%s produced no nodes — is it empty?", contextFile)
			}

			out := cmd.OutOrStdout()
			if dryRun {
				fmt.Fprintf(out, "Would create %d nodes from %s:\n\n", len(plan), contextFile)
				for _, p := range plan {
					fmt.Fprintf(out, "%s%s %s\n",
						strings.Repeat("  ", p.depth), markerFor(p.typ), p.title)
				}
				return nil
			}

			st, err := openProject()
			if err != nil {
				return err
			}
			defer st.Close()

			target, err := resolveSeedMap(st, mapID, mapName, contextFile)
			if err != nil {
				return err
			}

			// Attribute the whole run to the CLI actor so `dialogmapper undo`
			// can walk it back without touching anyone's canvas history.
			writer := st.As(store.CLIActor)

			ids := make([]string, len(plan))
			var created, skipped int
			for i, p := range plan {
				in := store.NewNodeInput{
					Type:   p.typ,
					Title:  p.title,
					MapID:  target.ID,
					Source: "seed",
				}
				content := store.DefaultContent("seed")
				content.Markdown = p.body
				content.Tags = p.tags
				in.Content = &content

				if p.parent >= 0 && ids[p.parent] != "" {
					in.ParentID = ids[p.parent]
					in.Relationship = p.rel
				}
				node, _, err := writer.CreateNode(in)
				if err != nil {
					// One malformed line should not abandon the whole import.
					fmt.Fprintf(cmd.ErrOrStderr(), "  skipped %q: %v\n", p.title, err)
					skipped++
					continue
				}
				ids[i] = node.ID
				created++
			}

			fmt.Fprintf(out, "Seeded %q from %s: %d nodes created", target.Name, contextFile, created)
			if skipped > 0 {
				fmt.Fprintf(out, ", %d skipped", skipped)
			}
			fmt.Fprintf(out, ".\n\nOpen it with: dialogmapper start --open\n")
			if created > 0 {
				// A seed that produced the wrong shape is the main reason
				// anyone wants undo on the CLI, so say exactly how to get out.
				fmt.Fprintf(out, "Undo this run with: dialogmapper undo --steps %d\n", created)
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&contextFile, "context", "",
		"markdown or text file to scaffold from, or - for stdin")
	cmd.Flags().StringVar(&mapName, "map", "", "name for the map to create (defaults to the file name)")
	cmd.Flags().StringVar(&mapID, "map-id", "", "seed into an existing map instead of creating one")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "print the planned structure without writing")
	_ = cmd.MarkFlagRequired("context")
	return cmd
}

func resolveSeedMap(st *store.Store, mapID, mapName, contextFile string) (*store.Map, error) {
	if mapID != "" {
		return st.GetMap(mapID)
	}
	if mapName == "" {
		mapName = titleFromFilename(contextFile)
	}
	return st.CreateMap(mapName, "Seeded from "+contextFile)
}

// plannedNode is one node in the import, with parent expressed as an index so
// the plan can be printed before anything is written.
type plannedNode struct {
	typ    ibis.NodeType
	title  string
	body   string
	tags   []string
	parent int // index into the plan, or -1
	rel    ibis.Relationship
	depth  int
}

func parseContext(r io.Reader) ([]plannedNode, error) {
	var plan []plannedNode

	// headingStack[level] = plan index of the Question created for that
	// heading level, so a deeper heading nests under a shallower one.
	headingStack := map[int]int{}
	currentQuestion := -1
	currentIdea := -1
	depthOf := func(i int) int {
		if i < 0 {
			return 0
		}
		return plan[i].depth
	}

	add := func(n plannedNode) int {
		plan = append(plan, n)
		return len(plan) - 1
	}

	// addArgument attaches a Pro or Con to the most recent Idea. A bare
	// Question cannot host an argument under the IBIS grammar, and inventing
	// an Idea to hang it on would put words in the author's mouth — so in
	// that case the line is demoted to a Note, which is what it actually is.
	addArgument := func(text string, typ ibis.NodeType, rel ibis.Relationship) {
		title, body, tags := splitTitleBody(text)
		parent := firstValid(currentIdea, currentQuestion)
		if parent < 0 || title == "" {
			return
		}
		if plan[parent].typ == ibis.Question {
			typ, rel = ibis.Note, ibis.RelatesTo
		}
		add(plannedNode{
			typ: typ, title: title, body: body, tags: tags,
			parent: parent, rel: rel, depth: depthOf(parent) + 1,
		})
	}

	var paragraph []string
	flushParagraph := func() {
		text := strings.TrimSpace(strings.Join(paragraph, " "))
		paragraph = nil
		if text == "" {
			return
		}
		title, body, tags := splitTitleBody(text)
		typ, rel := ibis.Note, ibis.RelatesTo
		if strings.HasSuffix(title, "?") {
			typ, rel = ibis.Question, ibis.Questions
		}
		parent := currentQuestion
		if parent < 0 {
			// Nothing to attach to yet; a leading paragraph becomes the
			// framing Question for the document.
			idx := add(plannedNode{
				typ: ibis.Question, title: asQuestion(title),
				body: body, tags: tags, parent: -1,
				rel: "", depth: 0,
			})
			currentQuestion = idx
			return
		}
		add(plannedNode{
			typ: typ, title: title, body: body, tags: tags,
			parent: parent, rel: rel, depth: depthOf(parent) + 1,
		})
	}

	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), " \t")

		if strings.TrimSpace(line) == "" {
			flushParagraph()
			continue
		}

		if m := headingRe.FindStringSubmatch(line); m != nil {
			flushParagraph()
			level := len(m[1])
			title, body, tags := splitTitleBody(strings.TrimSpace(m[2]))

			parent := -1
			for l := level - 1; l >= 1; l-- {
				if idx, ok := headingStack[l]; ok {
					parent = idx
					break
				}
			}
			rel := ibis.Relationship("")
			if parent >= 0 {
				rel = ibis.Questions
			}
			idx := add(plannedNode{
				typ: ibis.Question, title: asQuestion(title), body: body,
				tags: tags, parent: parent, rel: rel, depth: level - 1,
			})
			headingStack[level] = idx
			// A new heading invalidates deeper levels.
			for l := level + 1; l <= 6; l++ {
				delete(headingStack, l)
			}
			currentQuestion = idx
			currentIdea = -1
			continue
		}

		if m := quoteRe.FindStringSubmatch(line); m != nil {
			flushParagraph()
			title, body, tags := splitTitleBody(strings.TrimSpace(m[1]))
			if title == "" {
				continue
			}
			parent := firstValid(currentIdea, currentQuestion)
			if parent < 0 {
				continue
			}
			add(plannedNode{
				typ: ibis.Note, title: title, body: body, tags: tags,
				parent: parent, rel: ibis.RelatesTo, depth: depthOf(parent) + 1,
			})
			continue
		}

		if m := proRe.FindStringSubmatch(line); m != nil {
			flushParagraph()
			addArgument(strings.TrimSpace(m[1]), ibis.Pro, ibis.Supports)
			continue
		}

		if m := conRe.FindStringSubmatch(line); m != nil {
			flushParagraph()
			addArgument(strings.TrimSpace(m[1]), ibis.Con, ibis.ObjectsTo)
			continue
		}

		if m := bulletRe.FindStringSubmatch(line); m != nil {
			flushParagraph()
			text := strings.TrimSpace(m[1])
			if text == "" {
				continue
			}

			// Argument markers inside a list item, checked before the generic
			// bullet path so "- ! too expensive" is a Con, not an Idea.
			if rest, ok := stripPrefix(text, "!", "con:", "CON:", "Con:"); ok {
				addArgument(rest, ibis.Con, ibis.ObjectsTo)
				continue
			}
			if rest, ok := stripPrefix(text, "+", "pro:", "PRO:", "Pro:"); ok {
				addArgument(rest, ibis.Pro, ibis.Supports)
				continue
			}

			title, body, tags := splitTitleBody(text)
			if currentQuestion < 0 {
				idx := add(plannedNode{
					typ: ibis.Question, title: asQuestion(title), body: body,
					tags: tags, parent: -1, rel: "", depth: 0,
				})
				currentQuestion = idx
				continue
			}
			if strings.HasSuffix(title, "?") {
				add(plannedNode{
					typ: ibis.Question, title: title, body: body, tags: tags,
					parent: currentQuestion, rel: ibis.Questions,
					depth: depthOf(currentQuestion) + 1,
				})
				continue
			}
			idx := add(plannedNode{
				typ: ibis.Idea, title: title, body: body, tags: tags,
				parent: currentQuestion, rel: ibis.RespondsTo,
				depth: depthOf(currentQuestion) + 1,
			})
			currentIdea = idx
			continue
		}

		paragraph = append(paragraph, strings.TrimSpace(line))
	}
	flushParagraph()
	return plan, sc.Err()
}

// splitTitleBody keeps node titles short. Everything past the first sentence
// (or the truncation point) moves into the body, where the sidebar shows it.
func splitTitleBody(text string) (title, body string, tags []string) {
	text = strings.TrimSpace(stripMarkdownEmphasis(text))

	for _, m := range tagRe.FindAllStringSubmatch(text, -1) {
		tags = append(tags, strings.ToLower(m[1]))
	}
	if len(tags) > 0 {
		text = strings.TrimSpace(tagRe.ReplaceAllString(text, ""))
	}
	if tags == nil {
		tags = []string{}
	}

	const maxTitle = 90
	if cut := firstSentenceEnd(text); cut > 0 && cut < len(text) {
		title = strings.TrimSpace(text[:cut])
		body = strings.TrimSpace(text[cut:])
	} else {
		title = text
	}
	if len(title) > maxTitle {
		if sp := strings.LastIndex(title[:maxTitle], " "); sp > 40 {
			body = strings.TrimSpace(title[sp:] + " " + body)
			title = strings.TrimSpace(title[:sp]) + "…"
		} else {
			body = strings.TrimSpace(title[maxTitle:] + " " + body)
			title = title[:maxTitle] + "…"
		}
	}
	return title, body, tags
}

// firstSentenceEnd finds the end of the first sentence, ignoring the dots in
// common abbreviations and decimals so "3.5x faster" stays in one piece.
func firstSentenceEnd(s string) int {
	for i := 0; i < len(s)-1; i++ {
		c := s[i]
		if c != '.' && c != '?' && c != '!' {
			continue
		}
		if s[i+1] != ' ' {
			continue
		}
		if c == '.' && i > 0 && isDigit(s[i-1]) {
			continue
		}
		if c == '.' && i >= 2 && s[i-2] == ' ' {
			continue // single-letter initial, e.g. "J. Smith"
		}
		return i + 1
	}
	return -1
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// asQuestion turns a section heading into an issue. Headings are usually
// noun phrases ("Caching strategy"), and an IBIS map wants the open question.
func asQuestion(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "What is the question here?"
	}
	if strings.HasSuffix(s, "?") {
		return s
	}
	lower := strings.ToLower(s)
	for _, w := range []string{"how ", "what ", "why ", "should ", "which ", "when ", "who ", "where ", "can ", "do ", "does ", "is ", "are "} {
		if strings.HasPrefix(lower, w) {
			return s + "?"
		}
	}
	return "What should we do about " + lowerFirst(s) + "?"
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func stripMarkdownEmphasis(s string) string {
	for _, tok := range []string{"**", "__", "`"} {
		s = strings.ReplaceAll(s, tok, "")
	}
	return strings.TrimSpace(s)
}

func stripPrefix(s string, prefixes ...string) (string, bool) {
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return strings.TrimSpace(strings.TrimPrefix(s, p)), true
		}
	}
	return s, false
}

func firstValid(candidates ...int) int {
	for _, c := range candidates {
		if c >= 0 {
			return c
		}
	}
	return -1
}

func titleFromFilename(path string) string {
	base := path
	if i := strings.LastIndexAny(base, "/\\"); i >= 0 {
		base = base[i+1:]
	}
	if i := strings.LastIndex(base, "."); i > 0 {
		base = base[:i]
	}
	base = strings.NewReplacer("-", " ", "_", " ").Replace(base)
	if base == "" {
		return "Seeded Map"
	}
	return strings.ToUpper(base[:1]) + base[1:]
}

func markerFor(t ibis.NodeType) string {
	switch t {
	case ibis.Question:
		return "[?]"
	case ibis.Idea:
		return "[!]"
	case ibis.Pro:
		return "[+]"
	case ibis.Con:
		return "[-]"
	default:
		return "[·]"
	}
}
