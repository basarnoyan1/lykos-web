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

// Pages read by text recognition (tools/fulltext.mjs ocrPages, 28 Oct 2026): a quote from one rests on what OCR made of the page, so it is
// marked less certain wherever quotes are checked or shown. Its page is where the text has it (pages split by form feeds), else the page the
// reader gave.
/** The 1-based page of `text` (form feeds between pages) that holds `quote`, or null; `match(quote, page)` decides (default quoteFound). */
export function quotePage(quote, text, match = quoteFound) {
  const pages = String(text || '').split('\f');
  if (pages.length < 2) return null;
  for (let i = 0; i < pages.length; i++) if (match(quote, pages[i])) return i + 1;
  return null;
}

/** The page of a quote read by text recognition, or null: its page in the text (else `given`) when `ocrPages` lists it. */
export function ocrPageOf(quote, text, ocrPages, given = null, match = quoteFound) {
  if (!ocrPages?.length) return null;
  const p = quotePage(quote, text, match) ?? (Number(given) || null);
  return p != null && ocrPages.includes(p) ? p : null;
}

/** How a quote's page reads: "p. 4", "p. 4, read by text recognition", or '' (no page). */
export const quotePageText = q => (q?.page != null ? `p. ${q.page}${q.ocr ? ', read by text recognition' : ''}` : q?.ocr ? 'read by text recognition' : '');
