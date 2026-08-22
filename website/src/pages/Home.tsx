import { Link } from "../router";
import { Chip, Figure, Term, Tree, RELEASES, type TreeRow } from "../components/bits";
import canvas from "../assets/shots/canvas.png";
import branch from "../assets/shots/branch.png";
import phone from "../assets/shots/phone.png";

/**
 * The home page.
 *
 * It leads with the problem, not the architecture. Whether the store is
 * cgo-free matters to about one reader in fifty, and to none of them before
 * they know what the tool is for.
 */

const MAP: TreeRow[] = [
  { depth: 0, type: "question", text: "Should we move the team to a four-day week?" },
  { depth: 1, type: "idea", text: "Compress to four 9-hour days, same total hours" },
  { depth: 2, type: "pro", text: "No drop in output to justify to the board" },
  { depth: 2, type: "con", text: "Nine-hour days are brutal for the people with school runs" },
  { depth: 1, type: "idea", text: "Cut to 32 hours with no pay change", decided: true },
  { depth: 2, type: "pro", text: "Every trial we have read reports better retention" },
  { depth: 2, type: "con", text: "We would have to say no to some client work" },
  { depth: 1, type: "question", text: "Which teams would struggle most with a shorter week?" },
];

export function Home() {
  return (
    <>
      {/* --- what it is ---------------------------------------------------- */}
      <section className="wrap section">
        <div className="narrow">
          <h1>Keep the argument, not just the decision.</h1>
          <p className="lede" style={{ marginTop: "var(--sp-3)" }}>
            dialogmapper turns a live discussion into a map of the question, the options
            and the trade-offs — while people are still talking. Three months later it can
            still tell you why you chose what you chose, and what you already ruled out.
          </p>
          <div className="btn-row" style={{ marginTop: "var(--sp-4)" }}>
            <Link to="/start" className="btn btn--primary">
              Get started
            </Link>
            <Link to="/walkthrough" className="btn">
              Watch a real session
            </Link>
          </div>
          <p className="muted" style={{ marginTop: "var(--sp-3)", fontSize: "var(--step--1)" }}>
            Runs on your laptop. No account, no server, no upload. One file you can delete.
          </p>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: "var(--sp-6)" }}>
        <Figure
          bleed
          src={branch}
          alt="A close-up of the canvas: the idea 'Cut to 32 hours with no pay change', marked resolved, with two pros and two cons linked beneath it and the relationships labelled."
          caption={
            <>
              The option this team committed to, with the case for and against it still
              attached. The ticked node is the decision; the two objections under it are
              the ones nobody managed to answer — which is exactly what you want to find
              when somebody reopens this in March.
            </>
          }
        />
      </section>

      {/* --- the problem --------------------------------------------------- */}
      <section className="wrap section--tight">
        <div className="narrow stack">
          <p className="eyebrow">The problem</p>
          <h2>Meeting notes record what was said. They lose what it meant.</h2>
          <p>
            A wall of bullet points cannot tell you which line was an option and which was
            an objection to it, or which objection killed which option. So the same
            argument comes back a month later, someone re-raises a concern that was already
            answered, and nobody can find the answer.
          </p>
          <p>
            Dialogue mapping — the practice this tool implements — fixes that by giving
            every contribution a <em>type</em> and a <em>parent</em>. There are only four
            that matter, and everyone gets them in about a minute:
          </p>
          <div className="btn-row" style={{ marginBottom: "var(--sp-3)" }}>
            <Chip type="question" />
            <Chip type="idea" />
            <Chip type="pro" />
            <Chip type="con" />
          </div>
          <p>
            An <strong>Idea</strong> answers a <strong>Question</strong>. A{" "}
            <strong>Pro</strong> or <strong>Con</strong> argues about an Idea. That is
            almost the whole grammar, and it is enough to turn a rambling hour into
            something with a shape.
          </p>
          <Tree rows={MAP} label="The four-day week map, drawn as an indented tree" />
          <p className="muted" style={{ fontSize: "var(--step--1)" }}>
            Everything under an option is the case for and against that option — which is
            what makes it re-readable later.
          </p>
        </div>
      </section>

      <section className="wrap section--tight">
        <Figure
          bleed
          src={canvas}
          alt="The whole four-day week map on the canvas: one question at the top, three ideas beneath it and a sub-question, with pros and cons on the row below."
          caption={
            <>
              The whole map, forty minutes in. Fifteen points, one question, three options
              — and you can see at a glance which option has arguments on both sides and
              which has only objections. Layout is automatic; nobody arranged this.
            </>
          }
        />
      </section>

      {/* --- why this one -------------------------------------------------- */}
      <section className="wrap section">
        <div className="narrow" style={{ marginBottom: "var(--sp-4)" }}>
          <p className="eyebrow">Why this tool</p>
          <h2>Built for someone typing while a room talks.</h2>
        </div>
        <div className="grid grid--3">
          <div className="card">
            <h3>Fast enough to keep up</h3>
            <p>
              <kbd>q</kbd> starts a question, <kbd>i</kbd> an idea, <kbd>+</kbd> and{" "}
              <kbd>−</kbd> a pro and a con — each attached to what you had selected. You
              can map a meeting without touching the mouse, and the layout tidies itself.
            </p>
          </div>
          <div className="card">
            <h3>It refuses to record nonsense</h3>
            <p>
              An Idea cannot answer an Idea. When you try, the tool says so and names what
              would have been legal instead. The grammar is what makes a map worth
              re-reading, so it is enforced rather than suggested.
            </p>
          </div>
          <div className="card">
            <h3>The room can join in</h3>
            <p>
              A QR code puts a phone-shaped view in everyone's hand. They add points to the
              same map from where they are sitting, and you see it appear as you facilitate.
            </p>
          </div>
          <div className="card">
            <h3>Your data stays yours</h3>
            <p>
              One SQLite file in a folder you chose. No account, no sync, no telemetry. Put
              it in git if you like; delete it and it is gone.
            </p>
          </div>
          <div className="card">
            <h3>Nothing to install first</h3>
            <p>
              A single executable with the interface built in. No runtime, no database to
              set up, no <code>npm install</code>. Download it and run it.
            </p>
          </div>
          <div className="card">
            <h3>Agents can use it properly</h3>
            <p>
              Every change the canvas can make, the command line can make too — with{" "}
              <code>--json</code> for machines. An AI assistant can build and edit maps
              through the same rules a person gets.
            </p>
          </div>
        </div>
      </section>

      {/* --- the room ------------------------------------------------------ */}
      <section className="wrap section--tight">
        <div
          className="grid"
          style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", alignItems: "center" }}
        >
          <div className="stack">
            <p className="eyebrow">Everyone else</p>
            <h2>The facilitator drives. The room contributes.</h2>
            <p>
              Only one person should be arranging the map, or you get a mess. But everyone
              has something to add, and the person with the strongest objection is rarely
              the person holding the laptop.
            </p>
            <p>
              Start the server, show the QR code, and anyone on the same network gets this
              view. They reply to a specific point rather than shouting into the room, and
              you can see who is looking at what.
            </p>
            <Link to="/how-to/workshop" className="btn">
              How to run a session with the room →
            </Link>
          </div>
          <figure style={{ margin: 0 }}>
            <img
              src={phone}
              alt="The dialogmapper phone view, showing the four-day week question with indented replies beneath it and a box to add a new point."
              loading="lazy"
              style={{ maxWidth: "300px", margin: "0 auto", display: "block" }}
            />
          </figure>
        </div>
      </section>

      {/* --- start --------------------------------------------------------- */}
      <section className="wrap section">
        <div className="narrow stack">
          <p className="eyebrow">Try it</p>
          <h2>Two commands and a browser.</h2>
          <p>
            Download the binary for your machine, then point it at a folder. It creates one
            file there and opens the canvas.
          </p>
          <Term
            title="bash"
            lines={[
              { cmd: "dialogmapper init" },
              { cmd: "dialogmapper start --open" },
            ]}
          />
          <div className="btn-row">
            <a className="btn btn--primary" href={RELEASES}>
              Download
            </a>
            <Link to="/start" className="btn">
              Full install guide
            </Link>
          </div>
        </div>
      </section>

      {/* --- honesty ------------------------------------------------------- */}
      <section className="wrap section--tight">
        <div className="narrow stack">
          <p className="eyebrow">Before you invest an afternoon</p>
          <h2>When this is the wrong tool.</h2>
          <p>
            It is for arguments with real disagreement in them: a decision with several
            defensible options and people who see it differently. Roughly six to twenty
            people, one facilitator, sixty to ninety minutes.
          </p>
          <p>
            It is <strong>not</strong> a good fit for taking minutes, tracking tasks,
            brainstorming without a question to answer, or writing up a decision that has
            already been made. Those all have better tools, and forcing them through an
            IBIS grammar will annoy everyone in the room.
          </p>
          <p>
            It also has a real cost: mapping well takes practice, and a first session will
            be slower than just talking. The{" "}
            <Link to="/walkthrough">worked session</Link> shows what a competent one
            actually looks like, so you can judge before committing.
          </p>
        </div>
      </section>
    </>
  );
}
