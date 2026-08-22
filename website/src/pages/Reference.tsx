import { Page, Pager } from "../components/Layout";
import cli from "../generated/cli.json";

/**
 * Keyboard and command reference.
 *
 * The command tables are generated from the binary's own help output by
 * scripts/reference.mjs, so they cannot describe a flag the tool does not have.
 * A hand-written CLI reference is wrong within about two releases and nobody
 * notices, because nobody re-reads their own docs.
 */

const KEYS: { key: React.ReactNode; action: string }[] = [
  { key: <kbd>n</kbd>, action: "New Note — or an Idea, when a Question is selected" },
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
