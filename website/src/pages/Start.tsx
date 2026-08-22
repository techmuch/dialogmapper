import { Page, Pager } from "../components/Layout";
import { Chip, Term, RELEASES, REPO } from "../components/bits";
import { Link } from "../router";

/**
 * Getting started.
 *
 * The download is the primary route and Go is a footnote, which is the reverse
 * of the old site. `go install` as the headline instruction asked a facilitator
 * to install a compiler toolchain before they could find out whether the tool
 * was any use — and the whole pitch is that it is one file with nothing to set
 * up.
 */

const PLATFORMS = [
  { label: "macOS — Apple silicon", file: "dialogmapper-darwin-arm64" },
  { label: "macOS — Intel", file: "dialogmapper-darwin-amd64" },
  { label: "Linux — x86_64", file: "dialogmapper-linux-amd64" },
  { label: "Linux — ARM64", file: "dialogmapper-linux-arm64" },
  { label: "Windows — x86_64", file: "dialogmapper-windows-amd64.exe" },
];

export function Start() {
  return (
    <>
      <Page
        eyebrow="Get started"
        title="Ten minutes to your first map."
        lede="One file to download, two commands to run, and no account to create. If you have a browser and a folder you can write to, you have everything you need."
      >
        <div className="narrow">
          <ol className="steps">
            <li>
              <h3>Download it</h3>
              <p>
                One executable with the interface built in. Nothing else to install — no
                runtime, no database, no <code>npm install</code>.
              </p>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {PLATFORMS.map((p) => (
                      <tr key={p.file}>
                        <td>{p.label}</td>
                        <td>
                          <a href={`${RELEASES}/download/${p.file}`}>{p.file}</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Checksums for every build are published as <code>SHA256SUMS</code> on the{" "}
                <a href={RELEASES}>release page</a>.
              </p>
            </li>

            <li>
              <h3>Make it runnable</h3>
              <p>
                On macOS and Linux, mark it executable and put it somewhere on your{" "}
                <code>PATH</code>:
              </p>
              <Term
                lines={[
                  { cmd: "chmod +x dialogmapper-darwin-arm64" },
                  { cmd: "mv dialogmapper-darwin-arm64 /usr/local/bin/dialogmapper" },
                ]}
              />
              <div className="note note--warn">
                <p>
                  <strong>macOS will refuse to open it the first time.</strong> The
                  releases are not signed with an Apple developer certificate, so
                  Gatekeeper blocks them. Right-click the file in Finder and choose Open,
                  or run <code>xattr -d com.apple.quarantine dialogmapper</code>. If that
                  is not acceptable in your environment, build from source instead — the{" "}
                  <a href={REPO}>repository</a> has the whole thing.
                </p>
              </div>
            </li>

            <li>
              <h3>Create a project</h3>
              <p>
                A project is just a folder. <code>init</code> puts a database and a couple
                of notes in it, and never overwrites an existing one.
              </p>
              <Term
                lines={[
                  { cmd: "mkdir team-decisions && cd team-decisions" },
                  {
                    cmd: "dialogmapper init",
                    out: [
                      "Initialized dialogmapper project in ~/team-decisions",
                      "  + maps.db",
                      "  + .assets/",
                      "  + AGENTS.md",
                      "  + README.md",
                      "",
                      'Created map "Untitled Map" (map_06g2nbp2rdmafzny10e9420z6m)',
                      "",
                      "Next: dialogmapper start --open",
                    ],
                  },
                ]}
              />
            </li>

            <li>
              <h3>Start it</h3>
              <Term lines={[{ cmd: "dialogmapper start --open" }]} />
              <p>
                Your browser opens on an empty canvas, and the terminal prints a QR code so
                phones on the same network can join. Leave it running for the meeting; stop
                it with <kbd>Ctrl</kbd> <kbd>C</kbd>.
              </p>
              <p className="muted">
                To keep a map strictly to your own machine, start it with{" "}
                <code>--host 127.0.0.1</code>.
              </p>
            </li>

            <li>
              <h3>Map something</h3>
              <p>
                Press <kbd>q</kbd> and type the question you are deciding. Then, with a
                node selected:
              </p>
              <div className="table-scroll">
                <table>
                  <tbody>
                    <tr>
                      <td>
                        <kbd>i</kbd>
                      </td>
                      <td>
                        an <Chip type="idea" /> answering the selected question
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <kbd>+</kbd>
                      </td>
                      <td>
                        a <Chip type="pro" /> for the selected idea
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <kbd>−</kbd>
                      </td>
                      <td>
                        a <Chip type="con" /> against it
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <kbd>q</kbd>
                      </td>
                      <td>a further question about whatever is selected</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                That is enough to map a real conversation. The layout arranges itself, so
                you can watch the room instead of the canvas.
              </p>
            </li>

            <li>
              <h3>Practise on something real</h3>
              <p>
                Do not learn this live in a meeting that matters. Map a decision your team
                has already made, from the notes — you know how it ends, so you can
                concentrate on where things belong. Twenty minutes of that is worth more
                than reading about it.
              </p>
              <p>
                Then read the <Link to="/walkthrough">worked session</Link> to see the
                judgement calls a facilitator makes in the moment.
              </p>
            </li>
          </ol>

          <h2 style={{ marginTop: "var(--sp-5)" }}>Other ways to install</h2>
          <p>
            If you have Go, you can install from source. This is not the recommended route
            for most people — it exists so that you are never dependent on the release
            binaries.
          </p>
          <Term lines={[{ cmd: "go install github.com/techmuch/dialogmapper@latest" }]} />
          <p>
            To update a binary you already have, in place and with the checksum verified:
          </p>
          <Term lines={[{ cmd: "dialogmapper upgrade" }]} />
        </div>
      </Page>

      <Pager
        links={[
          { to: "/walkthrough", label: "See a real session" },
          { to: "/how-to/workshop", label: "Run one with the room" },
          { to: "/ibis", label: "What is IBIS?" },
        ]}
      />
    </>
  );
}
