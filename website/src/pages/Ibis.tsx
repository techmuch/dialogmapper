import { Page, Pager } from "../components/Layout";
import { Chip, Tree, type TreeRow } from "../components/bits";

/**
 * What IBIS is, for someone who has never heard of it.
 *
 * Written as an argument for the practice rather than a description of the
 * feature. Somebody reading this is deciding whether a constraint is worth
 * accepting, and "the grammar is enforced" only sounds good once you know why
 * an unenforced one is useless.
 */

const BAD: TreeRow[] = [
  { depth: 0, type: "note", text: "Discussed the four-day week" },
  { depth: 0, type: "note", text: "Dan: nine-hour days, same total" },
  { depth: 0, type: "note", text: "Ash: brutal for school runs" },
  { depth: 0, type: "note", text: "retention is better in the trials" },
  { depth: 0, type: "note", text: "client cover is a problem" },
  { depth: 0, type: "note", text: "ACTION: Priya to look into it" },
];

const GOOD: TreeRow[] = [
  { depth: 0, type: "question", text: "Should we move the team to a four-day week?" },
  { depth: 1, type: "idea", text: "Compress to four 9-hour days" },
  { depth: 2, type: "con", text: "Brutal for the people with school runs" },
  { depth: 1, type: "idea", text: "Cut to 32 hours with no pay change" },
  { depth: 2, type: "pro", text: "Trials report better retention" },
  { depth: 2, type: "con", text: "We would have to say no to some client work" },
];

export function Ibis() {
  return (
    <>
      <Page
        eyebrow="Concepts"
        title="What is IBIS, and why does the tool refuse things?"
        lede={
          <>
            IBIS — Issue-Based Information System — is a way of writing down an argument so
            that its shape survives the meeting. It is about sixty years old, it has four
            parts worth learning, and the constraint is the point.
          </>
        }
      >
        <div className="narrow stack">
          <h2>The problem it solves</h2>
          <p>
            Here is a real set of meeting notes. Everything that was said is in it, and it
            is almost worthless a month later:
          </p>
          <Tree rows={BAD} label="Flat meeting notes" />
          <p>
            You cannot tell which line was a proposal and which was an objection, or what
            the objection was <em>to</em>. "Client cover is a problem" — for which option?
            Both? Neither? The person who wrote it knew. Nobody else ever will.
          </p>
          <p>Same conversation, with a type and a parent on every line:</p>
          <Tree rows={GOOD} label="The same content as an IBIS map" />
          <p>
            Nothing was added. The content is identical. But now the objection about school
            runs is visibly attached to one option and not the other, and you can see that
            the second option has an argument on both sides while the first has only
            objections.
          </p>

          <h2>The four parts</h2>
          <p>
            <Chip type="question" /> — the issue being decided. Everything hangs off a
            question, and phrasing it well is most of the work. "Four-day week" is not a
            question; "Should we move the team to a four-day week?" is.
          </p>
          <p>
            <Chip type="idea" /> — a possible answer to a question. Not the answer.
            Several ideas under one question is the normal, healthy state.
          </p>
          <p>
            <Chip type="pro" /> and <Chip type="con" /> — arguments about a specific idea.
            They attach to the idea, never to the question, because "this is expensive" is
            meaningless until you know which option is expensive.
          </p>
          <p>
            <Chip type="note" /> — context, evidence, a link, a constraint. Anything true
            that is not itself a position.
          </p>

          <h2>Why it is enforced</h2>
          <p>
            You cannot make an Idea answer another Idea in dialogmapper. It will refuse,
            and tell you what would have been legal. That is deliberate, and it is the
            difference between this and a diagram tool with coloured boxes.
          </p>
          <p>
            A map you can draw anything on carries no information in its shape. If an arrow
            between two nodes can mean anything, then reading the map still requires the
            person who drew it. Once the shape is constrained, the shape itself tells you
            something — and that is what makes a map useful to somebody who was not in the
            room.
          </p>
          <p>
            The refusal is also a facilitation prompt. When two people are arguing and the
            tool will not let you file the point, it is usually because the conversation has
            drifted to a different question — and noticing that is exactly what a
            facilitator is for.
          </p>

          <h2>The rules, in full</h2>
          <p>
            This is the entire grammar. Your binary can print it with{" "}
            <code>dialogmapper grammar</code>, which is the version that is actually
            enforced.
          </p>
        </div>

        <div className="table-scroll narrow">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Link</th>
                <th>To</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Idea, Map</td>
                <td>
                  <code>responds_to</code>
                </td>
                <td>Question</td>
                <td>An Idea answers a Question</td>
              </tr>
              <tr>
                <td>Question</td>
                <td>
                  <code>questions</code>
                </td>
                <td>anything</td>
                <td>A Question can be raised about anything</td>
              </tr>
              <tr>
                <td>Pro</td>
                <td>
                  <code>supports</code>
                </td>
                <td>Idea, Pro, Con, Map</td>
                <td>A Pro supports an Idea, or reinforces another argument</td>
              </tr>
              <tr>
                <td>Con</td>
                <td>
                  <code>objects_to</code>
                </td>
                <td>Idea, Pro, Con, Map</td>
                <td>A Con objects to an Idea, or rebuts another argument</td>
              </tr>
              <tr>
                <td>Note ↔ anything</td>
                <td>
                  <code>relates_to</code>
                </td>
                <td>anything</td>
                <td>A Note relates to anything, in either direction</td>
              </tr>
              <tr>
                <td>Question</td>
                <td>
                  <code>specializes</code>
                </td>
                <td>Question</td>
                <td>A Question narrows a broader Question</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="narrow stack">
          <h2>Resolving, and what it means</h2>
          <p>
            An Idea can be marked <strong>resolved</strong>, which is how a debate becomes a
            decision: the group committed to this answer. The question above it then counts
            as settled, and the <strong>Open questions</strong> filter fades it away so what
            is left is the unfinished work.
          </p>
          <p>
            Objections under a resolved idea are not deleted. A decision that overrode two
            real concerns is a different thing from one nobody argued with, and six months
            later that difference is the most useful thing on the map.
          </p>

          <h2>Where this came from</h2>
          <p>
            IBIS was devised by Horst Rittel and Werner Kunz in 1970, for what Rittel called{" "}
            <em>wicked problems</em> — problems where the disagreement is about what the
            problem even is. Jeff Conklin later built the practice of{" "}
            <em>dialogue mapping</em> around it: one facilitator, a shared display, and a
            map built live in front of the group. This tool is an implementation of that
            practice, and Conklin's{" "}
            <em>Dialogue Mapping: Building Shared Understanding of Wicked Problems</em> is
            still the book to read if you want to get good at it.
          </p>
        </div>
      </Page>

      <Pager
        links={[
          { to: "/walkthrough", label: "See it used on a real decision" },
          { to: "/start", label: "Get started" },
        ]}
      />
    </>
  );
}
