import type { NodeType } from "./types";

/**
 * Turning what somebody typed into a search.
 *
 * Whitespace separates terms and every term has to match, so "cache
 * invalidation" finds the nodes that mention both rather than only the nodes
 * containing that exact string. Typing more words narrows the result, which is
 * what people expect from a search box and what the previous substring match
 * got backwards: adding a word usually made the result *empty*.
 *
 * Double quotes keep a phrase together, because splitting on spaces otherwise
 * removes the ability to search for one at all.
 *
 * A leading ?, !, +, - or . narrows to one node type. The characters are the
 * ones already on the cards and on the capture keys, so the shortcut is the
 * thing you have been looking at all session rather than a new syntax.
 *
 * This rule is implemented twice — here for the canvas filter, which runs
 * against nodes already in the browser, and in Go for the search endpoint that
 * the phone and the `/` palette use. The two are covered by the same test
 * table so they cannot quietly disagree.
 */

/**
 * MaxTerms caps how many words are honoured.
 *
 * The Go side builds one SQL condition per term, and a pasted paragraph would
 * otherwise produce a query with hundreds of LIKEs. Nobody narrows a search
 * with more than a handful of words.
 */
export const MaxTerms = 12;

/**
 * The type shortcuts.
 *
 * `−` and `·` are here alongside `-` and `.` because those are the glyphs the
 * cards actually draw, and somebody who copies one out of the interface should
 * not find that it does nothing.
 *
 * There is deliberately no marker for Map: `#` already means a tag everywhere
 * else in the tool, and embedded maps are rare enough not to be worth the
 * collision.
 */
export const TYPE_PREFIX: Record<string, NodeType> = {
  "?": "question",
  "!": "idea",
  "+": "pro",
  "-": "con",
  "−": "con",
  ".": "note",
  "·": "note",
};

export interface ParsedQuery {
  /** The node type asked for, or null for "any". */
  type: NodeType | null;
  /** Lowercased words, all of which must match. */
  terms: string[];
}

/**
 * Reads a query into a type and a list of terms.
 *
 * The marker only counts as the first character of the whole query. Anywhere
 * else it is ordinary text — "why not" and "cost - benefit" have to keep
 * working, and a marker that could appear mid-string would make them
 * unpredictable. Quoting escapes it, so `"?"` searches for a literal question
 * mark.
 */
export function parseQuery(query: string): ParsedQuery {
  let type: NodeType | null = null;
  let rest = query;

  const lead = query.trimStart();
  const marker = TYPE_PREFIX[lead[0]];
  if (marker) {
    type = marker;
    rest = lead.slice(1);
  }

  return { type, terms: parseTerms(rest) };
}

/** Splits a query into deduplicated lowercase terms, honouring quotes. */
export function parseTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;

  const push = () => {
    const t = current.trim().toLowerCase();
    current = "";
    // Duplicates would each add a condition that the first already
    // guarantees.
    if (t && !terms.includes(t)) terms.push(t);
  };

  for (const ch of query) {
    if (ch === '"') {
      // Closing a quote ends the term, so `"a b"c` cannot glue on a suffix.
      if (quoted) push();
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      push();
      continue;
    }
    current += ch;
  }
  push();

  return terms.slice(0, MaxTerms);
}
