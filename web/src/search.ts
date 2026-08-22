/**
 * Turning what somebody typed into search terms.
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
