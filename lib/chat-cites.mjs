// A model's citation markers, [doc p.N "quote"], become small page marks in
// the reply: the quote is held by the mark (shown on hover, opened on press),
// not repeated in the sentence it supports. Only a quote located on the stated
// page is a citation; any other marker reads as an unverified source claim.
// A mark that repeats the one before it — same document, same page — is
// dropped, so a run of claims from one page carries one mark.
import { esc } from './html.mjs';
import { renderChatMarkdown } from './chat-math.mjs';

export const citationPattern = () => /\[([^\]\s"]{1,300}) p\.(\d+) "([^"]{3,300})"\]/g;

/** Text with ⟦n⟧ tokens where marks go, and the marks. */
export function citeMarks(text, cites = []) {
  const marks = []; let prev = null;
  const out = String(text || '').replace(citationPattern(), (_, id, page, quote) => {
    const at = cites.findIndex(c => c.doc_id === id && c.page === Number(page) && c.quote === quote);
    const same = prev && prev.doc_id === id && prev.page === Number(page) && prev.valid === (at >= 0);
    prev = { doc_id: id, page: Number(page), valid: at >= 0 };
    if (same) { marks[marks.length - 1].quotes.push(quote); return '\u0000'; }
    marks.push({ doc_id: id, page: Number(page), valid: at >= 0, cite: at, quotes: [quote] });
    return `⟦${marks.length - 1}⟧`;
  // Only the space a dropped mark leaves before punctuation goes; code and "3 : 1" elsewhere are untouched.
  }).replace(/[ \t]*\u0000[ \t]*(?=[.,;:])/g, '').replace(/\u0000/g, '');
  return { text: out, marks };
}

/** Rendered reply HTML with its tokens replaced by the marks. */
export function citeHtml(html, marks, turn) {
  return html.replace(/⟦(\d+)⟧/g, (_, n) => {
    const m = marks[+n]; if (!m) return '';
    const title = m.quotes.map(q => `“${q}”`).join('\n');
    return m.valid
      ? `<button class="cite" data-cite="${turn}:${m.cite}" title="${esc(title)}">p. ${m.page}</button>`
      : `<span class="cite unverified" title="${esc(title)}">unverified</span>`;
  });
}

/** A reply as the conversation shows it: cite marks, Markdown and math. */
export function replyHtml(text, cites, turn) {
  const m = citeMarks(text, cites);
  return citeHtml(renderChatMarkdown(m.text), m.marks, turn);
}
