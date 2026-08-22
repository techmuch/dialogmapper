import { describe, expect, it } from "vitest";
import { MaxTerms, parseTerms } from "./search";

/**
 * The same table exists in internal/store/search_test.go.
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
