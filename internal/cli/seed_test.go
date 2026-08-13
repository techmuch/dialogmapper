package cli

import (
	"strings"
	"testing"

	"github.com/davidfullmer/dialogmapper/internal/ibis"
)

// The seed parser is heuristic, which means it is the component most likely to
// drift silently. These tests pin the mapping from markdown to IBIS structure,
// including the cases where the honest answer is to *demote* a node rather
// than invent structure the author did not write.

// outline renders a plan the way `--dry-run` does, so failures are readable.
func outline(plan []plannedNode) string {
	var b strings.Builder
	for _, p := range plan {
		b.WriteString(strings.Repeat("  ", p.depth))
		b.WriteString(markerFor(p.typ) + " " + p.title + "\n")
	}
	return b.String()
}

func parse(t *testing.T, doc string) []plannedNode {
	t.Helper()
	plan, err := parseContext(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return plan
}

// find returns the first node whose title contains substr.
func find(t *testing.T, plan []plannedNode, substr string) plannedNode {
	t.Helper()
	for _, p := range plan {
		if strings.Contains(p.title, substr) {
			return p
		}
	}
	t.Fatalf("no node matching %q in:\n%s", substr, outline(plan))
	return plannedNode{}
}

func TestHeadingsBecomeQuestions(t *testing.T) {
	plan := parse(t, `# Caching strategy

## How fast can we roll back?
`)
	// A noun-phrase heading is not a question yet, so it is phrased as one.
	// An already-interrogative heading is left alone rather than mangled.
	caching := find(t, plan, "caching strategy")
	if caching.typ != ibis.Question {
		t.Errorf("heading produced %s, want question", caching.typ)
	}
	if caching.title != "What should we do about caching strategy?" {
		t.Errorf("title = %q", caching.title)
	}

	rollback := find(t, plan, "roll back")
	if rollback.title != "How fast can we roll back?" {
		t.Errorf("interrogative heading was rewritten: %q", rollback.title)
	}
	// A deeper heading nests under the shallower one.
	if rollback.rel != ibis.Questions {
		t.Errorf("sub-heading rel = %q, want questions", rollback.rel)
	}
}

func TestBulletsBecomeIdeasAndArguments(t *testing.T) {
	plan := parse(t, `# Caching

- Add a read-through cache
+ Cuts p99 to 200ms
! Invalidation becomes our problem forever
- Denormalise the hot tables
`)
	idea := find(t, plan, "read-through cache")
	if idea.typ != ibis.Idea || idea.rel != ibis.RespondsTo {
		t.Errorf("bullet = %s/%s, want idea/responds_to", idea.typ, idea.rel)
	}

	pro := find(t, plan, "Cuts p99")
	if pro.typ != ibis.Pro || pro.rel != ibis.Supports {
		t.Errorf("+ line = %s/%s, want pro/supports\n%s", pro.typ, pro.rel, outline(plan))
	}

	// Regression: a bare `!` at the start of a line was previously not matched
	// at all, so the text fell through to the paragraph path and produced a
	// Note titled "!" with the real content stranded in the body.
	con := find(t, plan, "Invalidation becomes")
	if con.typ != ibis.Con || con.rel != ibis.ObjectsTo {
		t.Errorf("! line = %s/%s, want con/objects_to\n%s", con.typ, con.rel, outline(plan))
	}
	for _, p := range plan {
		if p.title == "!" || p.title == "+" {
			t.Errorf("marker leaked into a title:\n%s", outline(plan))
		}
	}

	// Arguments attach to the preceding Idea, not to the section Question.
	ideaIdx := indexOf(plan, "read-through cache")
	if pro.parent != ideaIdx || con.parent != ideaIdx {
		t.Errorf("arguments did not attach to the preceding idea:\n%s", outline(plan))
	}
}

func TestArgumentMarkersInsideListItems(t *testing.T) {
	plan := parse(t, `# Topic

- An idea
  - ! too expensive
  - + cheap to try
  - CON: hard to staff
  - Pro: the team wants it
`)
	for _, want := range []struct {
		text string
		typ  ibis.NodeType
	}{
		{"too expensive", ibis.Con},
		{"cheap to try", ibis.Pro},
		{"hard to staff", ibis.Con},
		{"the team wants it", ibis.Pro},
	} {
		got := find(t, plan, want.text)
		if got.typ != want.typ {
			t.Errorf("%q = %s, want %s\n%s", want.text, got.typ, want.typ, outline(plan))
		}
	}
}

func TestArgumentUnderBareQuestionIsDemotedToNote(t *testing.T) {
	// A Pro cannot support a Question under IBIS. Inventing an Idea to hang it
	// on would put words in the author's mouth, so the honest move is a Note.
	plan := parse(t, `# Topic

+ this supports nothing in particular
`)
	n := find(t, plan, "supports nothing")
	if n.typ != ibis.Note || n.rel != ibis.RelatesTo {
		t.Errorf("orphan argument = %s/%s, want note/relates_to\n%s", n.typ, n.rel, outline(plan))
	}
}

func TestInterrogativeBulletBecomesASubQuestion(t *testing.T) {
	plan := parse(t, `# Topic

- What happens if the cache is cold?
`)
	q := find(t, plan, "cache is cold")
	if q.typ != ibis.Question || q.rel != ibis.Questions {
		t.Errorf("question bullet = %s/%s, want question/questions", q.typ, q.rel)
	}
}

func TestParagraphsAndQuotesBecomeNotes(t *testing.T) {
	plan := parse(t, `# Topic

Our p99 is 1.4s and users notice.

- An idea

> Incident review cites this in 4 of 7 outages.
`)
	para := find(t, plan, "p99 is 1.4s")
	if para.typ != ibis.Note {
		t.Errorf("paragraph = %s, want note", para.typ)
	}
	quote := find(t, plan, "Incident review")
	if quote.typ != ibis.Note || quote.rel != ibis.RelatesTo {
		t.Errorf("blockquote = %s/%s, want note/relates_to", quote.typ, quote.rel)
	}
}

func TestTagsAreExtractedFromText(t *testing.T) {
	plan := parse(t, `# Topic

- Ship it faster #perf #ops
`)
	n := find(t, plan, "Ship it faster")
	if strings.Contains(n.title, "#") {
		t.Errorf("tags left in the title: %q", n.title)
	}
	if len(n.tags) != 2 || n.tags[0] != "perf" || n.tags[1] != "ops" {
		t.Errorf("tags = %v, want [perf ops]", n.tags)
	}
}

func TestLongTextSplitsIntoTitleAndBody(t *testing.T) {
	plan := parse(t, `# Topic

- Move to continuous deployment. It reduces batch size and makes each change easier to reason about.
`)
	n := find(t, plan, "continuous deployment")
	if strings.Contains(n.title, "reduces batch size") {
		t.Errorf("title swallowed the whole paragraph: %q", n.title)
	}
	if !strings.Contains(n.body, "reduces batch size") {
		t.Errorf("body lost the detail: %q", n.body)
	}
}

func TestDecimalsDoNotSplitTitles(t *testing.T) {
	// "3.5x" must not read as the end of a sentence.
	plan := parse(t, `# Topic

- The cache is 3.5x faster in benchmarks
`)
	n := find(t, plan, "cache is")
	if !strings.Contains(n.title, "3.5x faster") {
		t.Errorf("decimal split the title: %q / %q", n.title, n.body)
	}
}

func TestEmptyDocumentProducesNothing(t *testing.T) {
	if plan := parse(t, "\n\n   \n"); len(plan) != 0 {
		t.Errorf("blank document produced %d nodes", len(plan))
	}
}

func TestLeadingProseBecomesTheFramingQuestion(t *testing.T) {
	// Content before any heading has nothing to attach to; rather than drop
	// it, the first paragraph becomes the question the document is about.
	plan := parse(t, `Should we rewrite the billing service?

- Yes, incrementally
`)
	if len(plan) == 0 {
		t.Fatal("no nodes")
	}
	if plan[0].typ != ibis.Question {
		t.Errorf("first node = %s, want question\n%s", plan[0].typ, outline(plan))
	}
	idea := find(t, plan, "incrementally")
	if idea.parent != 0 {
		t.Errorf("idea did not attach to the framing question:\n%s", outline(plan))
	}
}

// TestEverySeededEdgeIsLegal is the property that matters most: whatever the
// parser produces must form a valid IBIS graph, because seed output goes
// straight into the database and a bad edge would be rejected at write time
// and silently skipped.
func TestEverySeededEdgeIsLegal(t *testing.T) {
	docs := []string{
		`# Release cadence

We ship on Fridays and it hurts. #ops

- Move to continuous deployment
+ Smaller batches mean smaller blast radius.
! Requires trunk-based development.
- Ship Tuesday through Thursday only

> Incident review cites Friday deploys in 4 of 7 outages.

## Rollback

How fast can we roll back today?

- Blue-green deploys
! Doubles infrastructure cost.
`,
		`Just a paragraph with no structure at all.`,
		`# A
## B
### C
#### D
- idea
+ pro
! con
`,
		`- bullet with no heading
+ pro on it
! con on it
? not really a question marker
`,
		"# Only a heading\n",
		"> quote before anything else\n",
	}

	for i, doc := range docs {
		plan := parse(t, doc)
		for _, p := range plan {
			if p.parent < 0 {
				continue
			}
			if p.parent >= len(plan) {
				t.Fatalf("doc %d: parent index %d out of range", i, p.parent)
			}
			parent := plan[p.parent]
			if err := ibis.ValidateEdge(p.typ, parent.typ, p.rel); err != nil {
				t.Errorf("doc %d: seed produced an illegal edge: %v\n%s", i, err, outline(plan))
			}
		}
	}
}

func TestPlanParentsAlwaysPointBackwards(t *testing.T) {
	// Nodes are inserted in plan order, so a parent must already exist by the
	// time its child is written. A forward reference would silently drop the
	// edge at seed time.
	plan := parse(t, `# A

- idea
+ pro

## B

- another idea
! con
`)
	for i, p := range plan {
		if p.parent >= i {
			t.Errorf("node %d (%q) references parent %d, which is not yet created:\n%s",
				i, p.title, p.parent, outline(plan))
		}
	}
}

func TestAsQuestion(t *testing.T) {
	cases := map[string]string{
		"Caching strategy":     "What should we do about caching strategy?",
		"How do we scale?":     "How do we scale?",
		"Should we rewrite it": "Should we rewrite it?",
		"What to do":           "What to do?",
		"":                     "What is the question here?",
	}
	for in, want := range cases {
		if got := asQuestion(in); got != want {
			t.Errorf("asQuestion(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTitleFromFilename(t *testing.T) {
	cases := map[string]string{
		"notes/research-doc.md": "Research doc",
		"my_notes.txt":          "My notes",
		"plain":                 "Plain",
	}
	for in, want := range cases {
		if got := titleFromFilename(in); got != want {
			t.Errorf("titleFromFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func indexOf(plan []plannedNode, substr string) int {
	for i, p := range plan {
		if strings.Contains(p.title, substr) {
			return i
		}
	}
	return -1
}
