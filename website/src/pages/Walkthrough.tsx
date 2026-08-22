import { Page, Pager } from "../components/Layout";
import { Chip, Figure, Tree, type TreeRow } from "../components/bits";
import { Link } from "../router";
import filter from "../assets/shots/filter.png";
import details from "../assets/shots/details.png";

/**
 * One session, start to finish.
 *
 * The single most useful thing a tool like this can show is somebody competent
 * using it on a real problem — what was said, what they typed, and what the map
 * looked like afterwards. Feature lists cannot answer "would this survive my
 * Tuesday?", and that is the only question a reader has.
 *
 * The transcript is invented but the map is not: it is the same map the
 * screenshot script builds and photographs, so the two cannot disagree.
 */

interface Turn {
  speaker: string;
  said: string[];
  typed?: { keys: string; text?: string }[];
  note: React.ReactNode;
  map?: TreeRow[];
}

const q = "Should we move the team to a four-day week?";

const TURNS: Turn[] = [
  {
    speaker: "Priya (facilitator)",
    said: [
      "“Before anyone argues, let me get the question up. What are we actually deciding today?”",
    ],
    typed: [{ keys: "q", text: q }],
    note: (
      <>
        Start with the question, always. A map rooted in a statement rather than a question
        has nowhere to put disagreement — and getting the room to agree on what is being
        decided is often the most valuable ten minutes of the meeting.
      </>
    ),
    map: [{ depth: 0, type: "question", text: q }],
  },
  {
    speaker: "Dan",
    said: [
      "“The version I have seen work is four nine-hour days. Same hours, one fewer commute.”",
    ],
    typed: [{ keys: "i", text: "Compress to four 9-hour days, same total hours" }],
    note: (
      <>
        <kbd>i</kbd> creates an <Chip type="idea" /> answering the selected Question. Dan
        proposed one option; it is not the answer, it is <em>an</em> answer, and it goes
        alongside the others rather than above them.
      </>
    ),
    map: [
      { depth: 0, type: "question", text: q },
      { depth: 1, type: "idea", text: "Compress to four 9-hour days, same total hours" },
    ],
  },
  {
    speaker: "Ash",
    said: [
      "“That is fine if you do not have kids. Nine hours plus a commute means I never do a school run again.”",
      "“And honestly, it does not give anyone the thing they asked for, which was rest.”",
    ],
    typed: [
      { keys: "−", text: "Nine-hour days are brutal for the people with school runs" },
    ],
    note: (
      <>
        <kbd>−</kbd> attaches a <Chip type="con" /> to the Idea, not to the Question. That
        distinction is the whole point: the objection is to compressing the week, not to
        the idea of a four-day week, and in six weeks nobody will remember which unless the
        map says so.
      </>
    ),
    map: [
      { depth: 0, type: "question", text: q },
      { depth: 1, type: "idea", text: "Compress to four 9-hour days, same total hours" },
      { depth: 2, type: "con", text: "Nine-hour days are brutal for the people with school runs" },
    ],
  },
  {
    speaker: "Priya",
    said: [
      "“Hold that — Ash, is the second thing a different option, or an objection to Dan's?”",
      "“Different option. Let me put it up separately.”",
    ],
    typed: [
      { keys: "click the question, then i", text: "Cut to 32 hours with no pay change" },
    ],
    note: (
      <>
        This is the move that makes mapping worth doing. Two things arrived in one
        sentence, and the map forces you to ask which is which. Asking out loud also stops
        you from quietly mis-filing somebody's point, which is how facilitators lose a
        room's trust.
      </>
    ),
    map: [
      { depth: 0, type: "question", text: q },
      { depth: 1, type: "idea", text: "Compress to four 9-hour days, same total hours" },
      { depth: 2, type: "con", text: "Nine-hour days are brutal for the people with school runs" },
      { depth: 1, type: "idea", text: "Cut to 32 hours with no pay change" },
    ],
  },
  {
    speaker: "Sam, on a phone",
    said: [
      "“Every trial write-up I have read says retention improves. I am adding the link.”",
    ],
    typed: [{ keys: "tap the idea → Pro", text: "Every trial we have read reports better retention" }],
    note: (
      <>
        Sam has not said a word out loud. People who will not interrupt a meeting will
        happily type, and the map gets a point it would otherwise have lost — attached to
        the right option, because they tapped that option to reply to it.
      </>
    ),
  },
  {
    speaker: "Dan",
    said: [
      "“Counterpoint: at 32 hours we are turning down client work. That is real money.”",
      "“And it is hard to walk back. Try telling people you are taking Friday off them again.”",
    ],
    typed: [
      { keys: "−", text: "We would have to say no to some client work" },
      { keys: "−", text: "Hard to reverse if it does not work" },
    ],
    note: (
      <>
        The person who proposed one option is arguing against another. That reads as normal
        on a map and as a fight in a document, because the map attributes points to
        positions rather than to people.
      </>
    ),
  },
  {
    speaker: "Priya",
    said: [
      "“Someone said support could not do this. Is that a con, or a new question?”",
      "“It is a question. It applies whatever we pick.”",
    ],
    typed: [{ keys: "select the root, then q", text: "Which teams would struggle most with a shorter week?" }],
    note: (
      <>
        A <Chip type="question" /> under a Question is a sub-issue: something that has to
        be settled but is not an answer to the main one. Parking it as a question rather
        than arguing it now is how a session stays inside its hour.
      </>
    ),
  },
  {
    speaker: "Priya",
    said: [
      "“We are at time. Looking at this — 32 hours has two solid pros and two real risks, both of which are about client work.”",
      "“Can we live with those two? Yes? Then that is the decision, and the client question goes to next week.”",
    ],
    typed: [{ keys: "select the idea → mark resolved" }],
    note: (
      <>
        Marking an Idea <strong>resolved</strong> is what turns a debate into a decision:
        it says the group committed to this one. Everything under it stays — including the
        two objections nobody answered, which is exactly what you want to find when this
        comes back.
      </>
    ),
  },
];

export function Walkthrough() {
  return (
    <>
      <Page
        eyebrow="A real session"
        title="Ninety minutes, one decision, fifteen nodes."
        lede={
          <>
            A team is deciding whether to move to a four-day week. Below is what people
            said, what the facilitator typed, and what the map looked like after each move.
            The conversation is a composite; the map is real, and every screenshot on this
            site is taken from it.
          </>
        }
      >
        <div className="narrow">
          <div className="note">
            <p>
              <strong>Left is the room talking; right is what the facilitator typed.</strong>{" "}
              The interesting part is underneath both — the decision about{" "}
              <em>where</em> a point belongs, which is the actual skill.
            </p>
          </div>
        </div>

        <ol className="steps medium" style={{ marginTop: "var(--sp-5)" }}>
          {TURNS.map((t, i) => (
            <li key={i}>
              <div className="turn">
                <div className="turn__said">
                  <p className="speaker">{t.speaker}</p>
                  {t.said.map((s, j) => (
                    <p key={j}>{s}</p>
                  ))}
                </div>
                <div>
                  {t.typed?.map((k, j) => (
                    <div key={j} style={{ marginBottom: "var(--sp-2)" }}>
                      <div className="keys">
                        <kbd>{k.keys}</kbd>
                      </div>
                      {k.text && (
                        <div
                          className="code"
                          style={{ marginTop: "var(--sp-1)", marginBottom: 0, padding: "var(--sp-2)" }}
                        >
                          {k.text}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <p className="muted" style={{ maxWidth: "var(--measure)" }}>
                {t.note}
              </p>
              {t.map && <Tree rows={t.map} label="The map so far" />}
            </li>
          ))}
        </ol>
      </Page>

      <section className="wrap section--tight">
        <div className="narrow stack">
          <h2>A week later</h2>
          <p>
            This is where the effort pays back. Switching to <strong>Open questions</strong>{" "}
            fades everything the group has settled and leaves what it has not — so the next
            meeting starts from the unfinished part instead of re-litigating the finished
            one.
          </p>
        </div>
      </section>

      <section className="wrap">
        <Figure
          bleed
          src={filter}
          alt="The same map with the Open questions filter applied: the resolved option and its arguments are dimmed, leaving the unsettled sub-question lit."
          caption={
            <>
              The chosen option and everything under it fades once it is resolved. What
              stays lit is the sub-question about team coverage — the actual agenda for
              next time.
            </>
          }
        />
      </section>

      <section className="wrap section--tight">
        <div className="narrow stack">
          <h2>Why the objections stay</h2>
          <p>
            A decision log records what you chose. A map records what you chose{" "}
            <em>despite</em>. When someone reopens the four-day week in March, the two
            unanswered cons are still hanging under the decision, with the tags they were
            given and the note about which teams are affected.
          </p>
        </div>
      </section>

      <section className="wrap">
        <Figure
          bleed
          src={details}
          alt="The details panel open beside the canvas, showing the chosen idea's status, its tags, and the maps it appears on."
          caption={
            <>
              The details panel carries status, tags, links and — when a point is shared —
              the other maps it appears on. The same node can sit on several maps at once,
              so a constraint that affects three decisions is one node, not three copies
              that drift apart.
            </>
          }
        />
      </section>

      <section className="wrap section--tight">
        <div className="narrow stack">
          <h2>What this took</h2>
          <p>
            Fifteen nodes, about ninety minutes, one facilitator who had done it a few
            times. The first session you run will be slower and messier, and the map will
            need tidying afterwards. That is normal, and it is still worth it the first
            time somebody says "did we not already talk about this?" and you can answer.
          </p>
          <p>
            The <Link to="/how-to">how-to guides</Link> cover the practical parts —
            getting the room onto their phones, starting from notes you already have, and
            fixing a map after the fact.
          </p>
        </div>
      </section>

      <Pager
        links={[
          { to: "/start", label: "Get started" },
          { to: "/ibis", label: "What is IBIS?" },
          { to: "/how-to", label: "How-to guides" },
        ]}
      />
    </>
  );
}
