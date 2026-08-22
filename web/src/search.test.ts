import { describe, expect, it } from "vitest";
import { MaxTerms, parseQuery, parseTerms } from "./search";
import type { NodeType } from "./types";

/**
 * The same tables exist in internal/store/search_test.go.
 *
 * The rule has to be implemented twice — the canvas filter runs against nodes
 * already in the browser and cannot ask the server — so the cases are kept
 * identical on purpose. If you change one, change the other.
 */
export const CASES: { query: string; want: string[]; why: string }[] = [
  { query: "", want: [], why: "nothing typed" },
  { query: "   ", want: [], why: "only whitespace" },
  { query: "cache", want: ["cache"], why: "one word" },
  {
    query: "cache invalidation",
    want: ["cache", "invalidation"],
    why: "spaces separate terms",
  },
  { query: "  spaced   out  ", want: ["spaced", "out"], why: "runs of whitespace" },
  { query: "CaChe", want: ["cache"], why: "matching is case-insensitive" },
  { query: "cache cache", want: ["cache"], why: "a repeat adds no constraint" },
  { query: "cache\tinvalidation\nrollback", want: ["cache", "invalidation", "rollback"], why: "tabs and newlines separate too" },
  { query: '"hot tables"', want: ["hot tables"], why: "quotes keep a phrase together" },
  {
    query: 'perf "hot tables"',
    want: ["perf", "hot tables"],
    why: "a phrase alongside a word",
  },
  { query: '"unclosed', want: ["unclosed"], why: "an unclosed quote is not an error" },
  { query: '""', want: [], why: "an empty phrase is nothing" },
  { query: 'a "b c"d', want: ["a", "b c", "d"], why: "a closing quote ends the term" },
];

describe("parseTerms", () => {
  for (const c of CASES) {
    it(`${JSON.stringify(c.query)} → ${JSON.stringify(c.want)} (${c.why})`, () => {
      expect(parseTerms(c.query)).toEqual(c.want);
    });
  }

  it("caps the number of terms", () => {
    // Each term becomes a condition on the Go side; a pasted paragraph would
    // otherwise build a query with hundreds of them.
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(parseTerms(many)).toHaveLength(MaxTerms);
  });
});

/**
 * The leading type marker.
 *
 * The characters are the ones on the cards and on the capture keys, so the
 * shortcut is something the user has been looking at all session. The risk is
 * the opposite one — swallowing a character somebody meant literally — so most
 * of these cases pin where the marker does *not* apply.
 */
export const TYPE_CASES: {
  query: string;
  type: NodeType | null;
  terms: string[];
  why: string;
}[] = [
  { query: "?", type: "question", terms: [], why: "a marker alone lists that type" },
  { query: "!", type: "idea", terms: [], why: "idea" },
  { query: "+", type: "pro", terms: [], why: "pro" },
  { query: "-", type: "con", terms: [], why: "con" },
  { query: ".", type: "note", terms: [], why: "note" },
  { query: "−", type: "con", terms: [], why: "the minus sign the cards actually draw" },
  { query: "·", type: "note", terms: [], why: "the middot the cards actually draw" },

  { query: "?cache", type: "question", terms: ["cache"], why: "no space needed" },
  { query: "? cache", type: "question", terms: ["cache"], why: "a space is allowed" },
  { query: "  ? cache", type: "question", terms: ["cache"], why: "leading whitespace first" },
  {
    query: "! cache invalidation",
    type: "idea",
    terms: ["cache", "invalidation"],
    why: "a marker plus several terms",
  },

  // Where it must NOT apply.
  { query: "cache?", type: null, terms: ["cache?"], why: "a trailing ? is part of the word" },
  {
    query: "why not?",
    type: null,
    terms: ["why", "not?"],
    why: "a question mark inside a phrase is text",
  },
  {
    query: "cost - benefit",
    type: null,
    terms: ["cost", "-", "benefit"],
    why: "a hyphen mid-query is text",
  },
  { query: '"?"', type: null, terms: ["?"], why: "quoting escapes the marker" },
  { query: '"? really"', type: null, terms: ["? really"], why: "a quoted phrase is literal" },
  { query: "??", type: "question", terms: ["?"], why: "only the first character is a marker" },
  { query: "#tag", type: null, terms: ["#tag"], why: "# is a tag, not a type" },
];

describe("parseQuery", () => {
  for (const c of TYPE_CASES) {
    it(`${JSON.stringify(c.query)} → ${c.type ?? "any"} ${JSON.stringify(c.terms)} (${c.why})`, () => {
      expect(parseQuery(c.query)).toEqual({ type: c.type, terms: c.terms });
    });
  }

  it("leaves ordinary queries alone", () => {
    // Every case from the terms table must parse identically through
    // parseQuery, or the marker has started eating text it should not.
    for (const c of CASES) {
      const parsed = parseQuery(c.query);
      expect(parsed.type).toBeNull();
      expect(parsed.terms).toEqual(c.want);
    }
  });
});
