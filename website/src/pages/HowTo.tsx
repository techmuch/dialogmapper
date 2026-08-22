import { Page, Pager } from "../components/Layout";
import { Chip, Term } from "../components/bits";
import { Link, useRoute } from "../router";

/**
 * Task-shaped guides.
 *
 * Each one answers a sentence somebody would actually say out loud, and every
 * command on this page was run against the current binary before it was written
 * down — including the output, which is quoted rather than imagined.
 */

interface Recipe {
  slug: string;
  title: string;
  when: string;
  body: React.ReactNode;
}

const RECIPES: Recipe[] = [
  {
    slug: "workshop",
    title: "Run a session with the room on their phones",
    when: "You are facilitating and you want everyone contributing, not just the person typing.",
    body: (
      <>
        <p>
          Start the server so it listens on the network rather than only on your machine.
          It prints a QR code and an access key on startup.
        </p>
        <Term
          lines={[
            {
              cmd: "dialogmapper start --open",
              out: [
                "dialogmapper serving /Users/you/decisions",
                "  → http://192.168.1.24:7373",
                "  scan the code above to join from a phone",
              ],
            },
          ]}
        />
        <p>
          Everyone scans the code and lands on the phone view — the same map, laid out as
          an indented conversation instead of a canvas. They tap a point to reply to it,
          and the composer only offers the moves that are legal there: replying to an{" "}
          <Chip type="idea" /> offers <Chip type="pro" />, <Chip type="con" /> and{" "}
          <Chip type="note" />, because those are the things that can argue about an idea.
        </p>
        <h4>While it is running</h4>
        <ul>
          <li>
            Coloured dots in the toolbar show who is here and what they have selected.
            Click one to jump to what they are looking at; double-click to follow them as
            they move.
          </li>
          <li>
            A node someone is editing is locked, so two people cannot silently overwrite
            each other.
          </li>
          <li>
            Undo is per-person. Your <kbd>Ctrl/⌘ Z</kbd> reverses your last change, never
            somebody else's.
          </li>
        </ul>
        <div className="note note--warn">
          <p>
            <strong>On an untrusted network,</strong> anyone who can reach the port and has
            the key can edit. Use <code>--host 127.0.0.1</code> to keep a map to your own
            machine, and do not use <code>--no-token</code> outside a network you control.
          </p>
        </div>
      </>
    ),
  },
  {
    slug: "from-notes",
    title: "Start from notes you already have",
    when: "There is a document, a brief or a set of minutes, and you do not want to retype it.",
    body: (
      <>
        <p>
          <code>seed</code> reads a markdown file and turns its shape into a map. The
          conversion is deliberately literal, so you can predict it:
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>In the file</th>
                <th>Becomes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code># Heading</code>
                </td>
                <td>
                  A <Chip type="question" /> (rephrased as one if it is not already)
                </td>
              </tr>
              <tr>
                <td>
                  <code>- bullet</code>
                </td>
                <td>
                  An <Chip type="idea" /> answering the enclosing question
                </td>
              </tr>
              <tr>
                <td>
                  <code>+ bullet</code>
                </td>
                <td>
                  A <Chip type="pro" /> supporting the idea above it
                </td>
              </tr>
              <tr>
                <td>
                  <code>! bullet</code>
                </td>
                <td>
                  A <Chip type="con" /> objecting to the idea above it
                </td>
              </tr>
              <tr>
                <td>a bullet ending in ?</td>
                <td>
                  A sub-<Chip type="question" />
                </td>
              </tr>
              <tr>
                <td>
                  <code>&gt; quote</code> or a plain paragraph
                </td>
                <td>
                  A <Chip type="note" /> attached to the enclosing question
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Trailing <code>#hashtags</code> become tags. Check the shape before writing
          anything:
        </p>
        <Term
          lines={[
            {
              cmd: 'dialogmapper seed --context notes.md --map "Office move" --dry-run',
              out: [
                "Would create 4 nodes from notes.md:",
                "",
                "[?] Where should the team sit after the lease ends?",
                "  [!] Renew the current floor",
                "    [+] Nobody has to change their commute",
                "    [-] The lease price goes up 40%",
              ],
            },
          ]}
        />
        <p>Then drop the flag to commit it.</p>
        <Term lines={[{ cmd: 'dialogmapper seed --context notes.md --map "Office move"' }]} />
        <p>
          Expect to tidy up afterwards. Prose does not carry the structure reliably, so
          seeding gets you a scaffold to correct rather than a finished map — which is
          still much faster than an empty canvas.
        </p>
      </>
    ),
  },
  {
    slug: "agents",
    title: "Let an AI assistant build and edit a map",
    when: "You want an assistant to draft a map from research, or to keep one up to date.",
    body: (
      <>
        <p>
          Point it at <code>apply</code>, which takes a JSON array of operations on stdin.
          Everything goes through the same validation the canvas uses, so the grammar is
          enforced, ids are generated, and every change is reversible.
        </p>
        <Term
          lines={[
            {
              cmd:
                `echo '[{"op":"create_node","map":"Office move","type":"question",\n` +
                `        "title":"Should we go hybrid instead?"}]' | dialogmapper apply`,
              out: [
                "  create_node  question_06g2nbr6z0n9a1kybgfsev33yc  Should we go hybrid instead?",
                "",
                "1 operation(s) applied. Undo with: dialogmapper undo",
              ],
            },
          ]}
        />
        <p>
          Add <code>--json</code> and it reports machine-readably instead, which is what an
          agent should use:
        </p>
        <Term
          title="dialogmapper apply --json"
          copy={false}
          lines={[
            {
              cmd: "",
              out: [
                "{",
                '  "applied": 1,',
                '  "total": 1,',
                '  "reversible": 1,',
                '  "results": [',
                "    {",
                '      "op": "create_node",',
                '      "id": "note_06g2nbr70cdw5aerj1sc0reex4",',
                '      "label": "Lease ends 31 March"',
                "    }",
                "  ],",
                '  "undoHint": "dialogmapper undo",',
                '  "validated": true',
                "}",
              ],
            },
          ]}
        />
        <p>
          <code>--dry-run</code> validates without writing, and <code>--schema</code> prints
          the full contract — give that to the assistant rather than describing it.
        </p>
        <Term
          lines={[
            { cmd: "dialogmapper apply --schema" },
            { cmd: "dialogmapper apply --dry-run < changes.json" },
          ]}
        />
        <div className="note">
          <p>
            <strong>Do not let an assistant edit the SQLite file directly.</strong> It
            bypasses the IBIS rules, skips the undo journal, and gets the JSON content
            column subtly wrong. <code>dialogmapper init</code> writes an{" "}
            <code>AGENTS.md</code> into your project saying exactly this, so an assistant
            working in the folder finds the right instructions on its own.
          </p>
        </div>
      </>
    ),
  },
  {
    slug: "reuse",
    title: "Use the same point on more than one map",
    when: "A constraint or a fact matters to several decisions and you do not want three copies drifting apart.",
    body: (
      <>
        <p>
          Press <kbd>/</kbd>, search every map in the project, and press{" "}
          <kbd>⌥ Enter</kbd> to insert the node you found under whatever is selected. The
          node is <em>shared</em>, not copied: it is the same node, on two maps, and
          editing it anywhere changes it everywhere.
        </p>
        <p>
          Plain <kbd>Enter</kbd> instead takes you to the node — switching maps if it lives
          on a different one. So the same keystroke answers both "where did we say that?"
          and "bring that here".
        </p>
        <p>
          This is worth doing for things that are genuinely one thing: a budget ceiling, a
          regulatory constraint, a commitment made to a customer. It is not worth doing for
          points that merely sound similar — two copies that can diverge are usually more
          honest than one node pretending two conversations are the same.
        </p>
      </>
    ),
  },
  {
    slug: "fix-it",
    title: "Fix a map after the fact",
    when: "You mis-filed something during a session, or the shape came out wrong.",
    body: (
      <>
        <p>
          Mapping live means getting things wrong live. Everything below is reversible, so
          fix it afterwards rather than stalling the room.
        </p>
        <h4>Change what a point is</h4>
        <p>
          Select it and change its type in the details panel. If the new type breaks the
          grammar — an <Chip type="idea" /> cannot answer another Idea — the tool refuses
          and tells you what would be legal. Links that survive the change are relabelled
          for you.
        </p>
        <h4>Move a point to the right parent</h4>
        <p>
          Drag from the node's edge to its new parent to link it, and remove the old link
          by selecting it and deleting. The relationship is inferred from the two types.
        </p>
        <h4>Undo</h4>
        <p>
          <kbd>Ctrl/⌘ Z</kbd> on the canvas, or <code>dialogmapper undo</code> on the
          command line. Undo is per-actor: yours reverses your own changes, and the CLI has
          its own history, so undoing a bad <code>seed</code> cannot swallow what somebody
          contributed from a phone at the same time.
        </p>
        <Term
          lines={[
            { cmd: "dialogmapper undo" },
            { cmd: "dialogmapper undo --steps 15" },
            { cmd: "dialogmapper redo" },
          ]}
        />
        <h4>Get it out again</h4>
        <p>
          Export to markdown for a write-up, or JSON for anything else.
        </p>
        <Term
          lines={[
            { cmd: "dialogmapper export -f md -o decision.md" },
            { cmd: "dialogmapper export -f json --all" },
          ]}
        />
      </>
    ),
  },
  {
    slug: "keep-it",
    title: "Keep, share and back up your maps",
    when: "You want the map to outlive the meeting.",
    body: (
      <>
        <p>
          A project is a folder. <code>dialogmapper init</code> puts four things in it:
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>maps.db</code>
                </td>
                <td>Every map, node, link and the undo history. This is the whole thing.</td>
              </tr>
              <tr>
                <td>
                  <code>.assets/</code>
                </td>
                <td>Images and files attached to nodes.</td>
              </tr>
              <tr>
                <td>
                  <code>AGENTS.md</code>
                </td>
                <td>Instructions for AI assistants working in this folder.</td>
              </tr>
              <tr>
                <td>
                  <code>README.md</code>
                </td>
                <td>A note to your future self about what this project is.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Back it up by copying the folder. Put it in git if you want history — the
          database is binary, so you will not get useful diffs, but you will get versions.
          To share a map as a document rather than a database, export it.
        </p>
        <p>
          Running <code>init</code> again is safe: it never overwrites{" "}
          <code>maps.db</code>, and creates it only if it is missing. <code>--force</code>{" "}
          refreshes the generated docs, keeping a <code>.bak</code> of what it replaces.
        </p>
        <h4>Updating</h4>
        <Term lines={[{ cmd: "dialogmapper upgrade" }]} />
        <p>
          This replaces the binary in place with the latest release, verifying the
          published checksum first. It does not need Go installed, and it does not touch
          your maps.
        </p>
      </>
    ),
  },
];

export function HowToIndex() {
  return (
    <>
      <Page
        eyebrow="How to"
        title="Guides for the things people actually do."
        lede="Short, task-shaped, and checked against the current release. Every command here was run before it was written down."
        wide
      >
        <div className="grid grid--2">
          {RECIPES.map((r) => (
            <Link key={r.slug} to={`/how-to/${r.slug}`} className="card">
              <h3>{r.title}</h3>
              <p className="muted">{r.when}</p>
            </Link>
          ))}
        </div>
      </Page>
      <Pager
        links={[
          { to: "/walkthrough", label: "See a real session" },
          { to: "/reference", label: "Reference" },
        ]}
      />
    </>
  );
}

export function HowToPage() {
  const { path } = useRoute();
  const slug = path.replace("/how-to/", "");
  const recipe = RECIPES.find((r) => r.slug === slug);

  if (!recipe) {
    return (
      <Page title="No such guide" lede="That page does not exist — here is the list.">
        <HowToIndex />
      </Page>
    );
  }

  const i = RECIPES.indexOf(recipe);
  const next = RECIPES[i + 1];

  return (
    <>
      <Page eyebrow="How to" title={recipe.title} lede={recipe.when}>
        <div className="narrow">{recipe.body}</div>
      </Page>
      <Pager
        links={[
          ...(next ? [{ to: `/how-to/${next.slug}`, label: next.title }] : []),
          { to: "/how-to", label: "All guides" },
        ]}
      />
    </>
  );
}

export { RECIPES };
