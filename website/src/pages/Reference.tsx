import { Page, Pager } from "../components/Layout";
import cli from "../generated/cli.json";
import { Chip } from "../components/bits";

/**
 * Keyboard and command reference.
 *
 * The command tables are generated from the binary's own help output by
 * scripts/reference.mjs, so they cannot describe a flag the tool does not have.
 * A hand-written CLI reference is wrong within about two releases and nobody
 * notices, because nobody re-reads their own docs.
 */

const KEYS: { key: React.ReactNode; action: string }[] = [
  { key: <kbd>n</kbd>, action: "New Note on the selection — a Note attaches to any type" },
  { key: <kbd>q</kbd>, action: "New Question about the selection" },
  { key: <kbd>i</kbd>, action: "New Idea answering the selected Question" },
  {
    key: (
      <>
        <kbd>+</kbd> <kbd>−</kbd>
      </>
    ),
    action: "New Pro / Con on the selected Idea",
  },
  {
    key: <kbd>Enter</kbd>,
    action: "Edit the title; Enter again commits and keeps the node selected",
  },
  { key: <kbd>← ↑ → ↓</kbd>, action: "Move the selection to the nearest node that way" },
  { key: <kbd>Space</kbd>, action: "Centre on the selection, or fit the whole map" },
  { key: <kbd>l</kbd>, action: "Tidy up, saving the result as if you had dragged each node" },
  {
    key: <kbd>/</kbd>,
    action: "Search every map — Enter goes to the node, ⌥/Alt Enter inserts it here",
  },
  {
    key: (
      <>
        <kbd>?</kbd> <kbd>!</kbd> <kbd>+</kbd> <kbd>−</kbd> <kbd>.</kbd>
      </>
    ),
    action: "Start a filter or a search with one to show only that type",
  },
  { key: <kbd>g</kbd>, action: "Group the selected nodes so they move together" },
  { key: <kbd>a</kbd>, action: "Select everything currently visible" },
  { key: <kbd>Ctrl/⌘ Z</kbd>, action: "Undo — your own actions only" },
  { key: <kbd>Ctrl/⌘ ⇧ Z</kbd>, action: "Redo" },
  { key: <kbd>Tab</kbd>, action: "Toggle the details panel" },
];

/** Commands worth reading about; `help` and `completion` are noise here. */
const SKIP = new Set(["help", "completion"]);

export function Reference() {
  const commands = cli.commands.filter((c) => !SKIP.has(c.name));

  return (
    <>
      <Page
        eyebrow="Reference"
        title="Keyboard and commands"
        lede={
          <>
            The command tables below are generated from the binary's own help output, so
            they describe the tool rather than what someone remembered about it. Generated
            from <code>{cli.version}</code>.
          </>
        }
        wide
      >
        <div className="narrow">
          <h2 id="keyboard">On the canvas</h2>
          <p className="muted">
            The four capture keys are the ones worth learning. Everything else has a
            button.
          </p>
        </div>

        <div className="table-scroll narrow">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {KEYS.map((k, i) => (
                <tr key={i}>
                  <td>{k.key}</td>
                  <td>{k.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="narrow" style={{ marginTop: "var(--sp-5)" }}>
          <h2 id="search">Searching and filtering</h2>
          <p>
            The filter box on the canvas, the search field on the phone and the{" "}
            <kbd>/</kbd> palette all read a query the same way.
          </p>
          <p>
            <strong>Spaces separate terms and every term has to match.</strong>{" "}
            <code>cache invalidation</code> finds nodes mentioning both words, in any
            order, each free to land in the title, the body or a tag. Double quotes keep a
            phrase together: <code>"hot tables"</code>.
          </p>
          <p>
            <strong>A leading glyph narrows to one type.</strong> The space after it is
            optional, and the marker on its own lists that whole type.
          </p>
        </div>

        <div className="table-scroll narrow">
          <table>
            <thead>
              <tr>
                <th>Start with</th>
                <th>Shows only</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["?", "question", "? cache"],
                  ["!", "idea", "! cache"],
                  ["+", "pro", "+ cache"],
                  ["−", "con", "- cache"],
                  [".", "note", ". cache"],
                ] as const
              ).map(([glyph, type, example]) => (
                <tr key={type}>
                  <td>
                    <kbd>{glyph}</kbd>
                  </td>
                  <td>
                    <Chip type={type} />
                  </td>
                  <td>
                    <code>{example}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="narrow">
          <div className="note">
            <p>
              The glyph only counts as the <strong>first</strong> character of the query.{" "}
              <code>why not?</code> and <code>cost - benefit</code> are ordinary searches,
              and quoting escapes it, so <code>"?"</code> finds a literal question mark.
              There is no marker for Map — <code>#</code> already means a tag everywhere
              else.
            </p>
          </div>
        </div>

        <div className="narrow" style={{ marginTop: "var(--sp-5)" }}>
          <h2 id="cli">On the command line</h2>
          <p className="muted">
            Everything the canvas can do, the command line can do too — without a running
            server. Add <code>-C &lt;dir&gt;</code> to work on a project somewhere else.
          </p>
        </div>

        <div className="narrow">
          {commands.map((c) => (
            <section key={c.name} id={`cmd-${c.name}`} style={{ marginBottom: "var(--sp-5)" }}>
              <h3>
                <code>dialogmapper {c.name}</code>
              </h3>
              <p className="muted">{c.summary}</p>

              {c.subcommands.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Subcommand</th>
                        <th>What it does</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.subcommands.map((s) => (
                        <tr key={s.name}>
                          <td>
                            <code>
                              {c.name} {s.name}
                            </code>
                          </td>
                          <td>{s.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {c.flags.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Flag</th>
                        <th>What it does</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.flags.map((f) => (
                        <tr key={f.flag}>
                          <td>
                            <code>
                              {f.flag}
                              {f.arg ? ` ${f.arg}` : ""}
                            </code>
                          </td>
                          <td>{f.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="narrow">
          <div className="note">
            <p>
              Every command has <code>--help</code>, and it is more current than this page
              can ever be. <code>dialogmapper apply --schema</code> prints the full
              mutation contract as JSON, which is the thing to hand an AI assistant.
            </p>
          </div>
        </div>
      </Page>

      <Pager
        links={[
          { to: "/how-to", label: "How-to guides" },
          { to: "/ibis", label: "The IBIS rules" },
        ]}
      />
    </>
  );
}
