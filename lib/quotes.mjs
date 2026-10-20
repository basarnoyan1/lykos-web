// Whether a quote a model gave is in a source text. PDF text differs from the
// printed words in ways a reader never sees — ligatures (ﬁ), a word split at a
// line end (compli- cations), curly quotes, a ring operator where the page
// prints a degree sign — and a strict match dropped real quotes as "not on
// page" (five of five from one paper). Both sides are folded first; failing
// that, a long quote may match on its letters and digits alone, which still
// requires every word, in order.
const FOLD = [[/[­]/g, ''], [/[‐-―−]/g, '-'], [/[‘’‚‛′]/g, "'"], [/[“”„‟″]/g, '"'], [/[∘º˚]/g, '°'], [/…/g, '...']];

export function fold(text) {
  let t = String(text || '').normalize('NFKC').toLowerCase();
  for (const [re, to] of FOLD) t = t.replace(re, to);
  return t.replace(/([a-z])-\s+([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim();
}
const bare = t => t.replace(/[^\p{L}\p{N}]+/gu, '');

/** True when `quote` is in `source`, after folding; a long quote may match on letters and digits alone. */
export function quoteFound(quote, source) {
  const q = fold(quote);
  if (q.length < 8) return false;
  const s = fold(source);
  if (s.includes(q)) return true;
  const bq = bare(q);
  return bq.length >= 24 && bare(s).includes(bq);
}
