// A quotation taken from a PDF, with where it came from: `"…" (Okafor 2019, p. 4)`. The page is the one printed on it (the document's page labels,
// roman numerals in a front matter) when the file has labels, else its place in the file. A file with no record cites its own name (plan
// PDF-OPTIONS §2 Copy quote, T2). Pure: the viewers give it the selection's text and the labels PDF.js read.

/** The selected text as one quotation: one space between words, a word broken at a line end joined ("compli- cations"; a suspended hyphen, "pre- and
 *  post-", stays), compatibility forms opened (ﬁ). Quotes inside the text are kept as they are. */
export function quoteText(text) {
  return String(text ?? '').normalize('NFKC').replace(/­/g, '').replace(/\s+/g, ' ')
    .replace(/(\p{L})[-‐‑] (?!(?:and|or|to|nor)\b)(?=\p{Ll})/gu, '$1').trim();
}

/** What the selection strip shows of a quotation: its length in words, then its start (cut at a word, ended with an ellipsis), so a narrow strip keeps the count; `title` is the whole quotation. */
export function quotePreview(raw, max = 72) {
  const t = quoteText(raw), words = t ? t.split(' ').length : 0;
  const cut = t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:.-]+$/, '')}\u2026` : t;
  return { text: `${words} word${words === 1 ? '' : 's'}: \u201c${cut}\u201d`, title: t };
}

/** Writes the preview of a quotation into the strip's message slot `el`, the whole quotation as its tooltip: the one place both viewers' strips take it from. */
export function showQuote(el, raw) {
  if (!el) return;
  const v = quotePreview(raw);
  el.textContent = v.text; el.title = v.title;
}

/** The printed page of page `page` (from 1): its label when the file has one that says something, else the number. */
export function pageLabel(labels, page) {
  const l = Array.isArray(labels) ? String(labels[page - 1] ?? '').trim() : '';
  return l || String(page);
}

/** The page (from 1) a typed page means: a printed label when the file has labels ("iv", "S12"; the exact text first, then ignoring case), else a
 *  number as the position in the file. Null for text that is neither. Without labels only a number means anything, as before. */
export function pageFromText(labels, pages, text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (Array.isArray(labels)) {
    const at = labels.findIndex(l => String(l ?? '').trim() === t);
    const any = at >= 0 ? at : labels.findIndex(l => String(l ?? '').trim().toLowerCase() === t.toLowerCase());
    if (any >= 0 && any < pages) return any + 1;
  }
  return /^\d{1,6}$/.test(t) ? Math.max(1, Math.min(pages, Number(t))) : null;
}

/** The tooltip of the page field: "Page 12 of 48" when the printed label differs from the position, else nothing to add. */
export function pageDetail(labels, page, pages) {
  const l = pageLabel(labels, page);
  return l === String(page) ? '' : `Page ${page} of ${pages}`;
}

/** What a file is called in a citation: its name without the extension and without a leading review number ("07 - "). */
export function fileLabel(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '').trim();
  return base.replace(/^\d{1,4}\s*[-_.)]\s+(?=\S)/, '').trim() || base || 'Document';
}

/** The source of a quotation: `Okafor 2019, p. 4`. `label` is the record's label (it may hold the year already), else the file's name is used. */
export function cite({ label = '', year = '', fileName = '', page = 1, pageLabel: printed = '' } = {}) {
  const who = String(label || '').trim() || fileLabel(fileName);
  const y = String(year || '').trim();
  const name = y && !who.includes(y) ? `${who} ${y}` : who;
  return `${name}, p. ${String(printed || '').trim() || page}`;
}

/** The text Copy quote puts on the clipboard. */
export const quoteWithCite = (text, source) => `"${quoteText(text)}" (${cite(source)})`;
