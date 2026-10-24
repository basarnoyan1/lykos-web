// The papers an answer is about, as cards under it (as scite, Elicit and Perplexity show their sources). A paper is in an answer when the
// answer cites a page of it, names it in a table's study column, or names its label in the text; only the project's own records are cards,
// in the order the answer reaches them. A card opens the study in Details. Loaded with the first answer the chat draws (app.mjs `chatPapers`).
import { esc } from './html.mjs';
import { foldSearch } from './search-ranking.mjs';
import { authorLine, authorList } from './bib.mjs';
import { studyColumn } from './chat-study.mjs';
import { watchWidth } from './ui-actions.mjs';
import { get } from '../store.mjs';

/** Cards shown before "Show all": a row or two at any width. A card is at least CARD_MIN px; one or two to a row, measured (never a breakpoint). */
export const CARDS_SHOWN = 6, CARD_MIN = 200, CARD_GAP = 8;
export const cardCols = width => Math.max(1, Math.min(2, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP))));
const fold = s => foldSearch(String(s ?? '')).replace(/[\s_\u2010-\u2015-]+/g, ' ').trim();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** [{ paper, quotes: [{ page, quote }] }] for one assistant turn, each paper once. */
export function answerPapers(turn, state) {
  const papers = state?.papers || [], byId = new Map(papers.map(p => [String(p.id), p])), out = new Map();
  const add = (p, quote, from) => { if (!p) return; const e = out.get(p.id) || out.set(p.id, { paper: p, quotes: [], from }).get(p.id); if (quote?.quote) e.quotes.push(quote); };
  for (const c of turn?.cites || []) add(byId.get(String(c.doc_id)), { page: c.page, quote: c.quote }, 'cite');
  for (const b of turn?.blocks || []) if (b?.type === 'table') studyColumn(state, b.columns, b.rows || [])?.ids.forEach(id => add(byId.get(String(id)), null, 'table'));
  // a label in the text ("Akgun 2024"), whole words only; a label two records share names neither
  const text = ` ${fold(turn?.text)} `, seen = new Map();
  for (const p of papers) { const l = fold(p.label); if (l.length >= 5) seen.set(l, seen.has(l) ? null : p); }
  const hits = [];
  for (const [l, p] of seen) { if (!p) continue; const at = text.search(new RegExp(`[^\\p{L}\\p{N}]${escRe(l)}[^\\p{L}\\p{N}]`, 'u')); if (at >= 0) hits.push([at, p]); }
  hits.sort((a, b) => a[0] - b[0]).forEach(([, p]) => add(p, null, 'text'));
  // a paper the answer already shows in a records block (Library records, with its Source and Add to Library) is not a card as well
  const shown = new Set((turn?.blocks || []).filter(b => b?.type === 'papers').flatMap(b => (b.records || []).flatMap(r => [r.id, r.key, r.doi && `doi:${String(r.doi).toLowerCase()}`])).filter(Boolean).map(String));
  return [...out.values()].filter(({ paper: p }) => !shown.has(String(p.id)) && !(p.doi && shown.has(`doi:${String(p.doi).toLowerCase()}`)));
}

/** "Akgun H et al., Spine, 2024": the journal only in the tooltip line of a narrow tile */
const citeLine = p => {
  const all = authorList(p.authors), first = all.length ? `${authorLine(all.slice(0, 1))}${all.length > 1 ? ' et al.' : ''}` : '';
  const journal = String(p.journalAbbr || p.journal || '').replace(/\s+/g, ' ').split(/\s+:\s+|,/)[0].trim();
  return [first, journal, p.year].filter(Boolean).join(', ');
};

/** The cards under turn `i`, or nothing when the answer names no paper of the project. */
/** Fewer studies than this named in passing (no citation, no table) are not an answer about papers. */
export const NAMED_MIN = 3;
export function paperCards(turn, i, state) {
  const found = answerPapers(turn, state);
  // only when the answer is about papers (owner, 2026-10-22: "shown even in small questions, show only when relevant"): it cites a page,
  // tabulates studies, or names several; a study or two named in passing ("Review Akgun 2024's cells") is a link in the text, not a card
  if (!found.length || (!found.some(f => f.from !== 'text') && found.length < NAMED_MIN)) return '';
  const card = ({ paper: p, quotes }, k) => {
    const title = String(p.title || p.label || 'Untitled record'), q = quotes[0];
    // a uniform tile (Perplexity's sources): who and when over the title, two lines; the passage the answer cites is its tooltip
    return `<button type="button" class="chat-paper" data-paper-card="${esc(String(p.id))}"${k >= CARDS_SHOWN ? ' hidden' : ''} title="${esc(q ? `${title}\n“${q.quote}” p. ${q.page}` : title)}">`
      + `<span class="chat-paper-cite">${esc(citeLine(p) || p.label || '')}</span><span class="chat-paper-title">${esc(title)}</span></button>`;
  };
  const more = found.length > CARDS_SHOWN ? `<button type="button" class="link chat-papers-all" data-papers-all>Show all ${found.length}</button>` : '';
  const n = `${found.length} ${found.length === 1 ? 'study' : 'studies'}`;
  return `<section class="chat-papers" aria-label="${n} in this answer" data-turn-papers="${i}"><h3 class="chat-papers-label">${n}</h3><div class="chat-papers-grid">${found.map(card).join('')}</div>${more}</section>`;
}

const fit = host => host.querySelectorAll('.chat-papers-grid').forEach(g => { const n = String(cardCols(g.clientWidth)); if (g.dataset.cols !== n) g.dataset.cols = n; });
const watched = new WeakSet();

/**
 * A record id the model wrote into its text ("doi-10.3390/diagnostics14050549") becomes the study's label, a link that opens it, as a reader names
 * a study. Only ids of six characters or more are matched (a short id could be any word), and never inside code, a link, a button or the steps.
 */
export function linkStudyIds(host, papers = get().papers || []) {
  const byId = new Map(papers.filter(p => String(p.id).length >= 6).map(p => [String(p.id), p]));
  if (!byId.size) return;
  const re = new RegExp([...byId.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|'), 'g'), doc = host.ownerDocument;
  for (const msg of host.querySelectorAll('.assist-msg.assistant')) {
    const walk = doc.createTreeWalker(msg, 4, { acceptNode: n => n.parentElement?.closest('a,button,code,pre,.assist-steps,.chat-papers,.chat-block') ? 2 : 1 }), hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { re.lastIndex = 0; if (re.test(n.data)) hits.push(n); }
    for (const n of hits) {
      const frag = doc.createDocumentFragment(); let at = 0;
      n.data.replace(re, (id, i) => {
        frag.append(n.data.slice(at, i));
        const p = byId.get(id), t = doc.createElement('template');   // the same markup a citation mark is (lib/chat-cites.mjs)
        t.innerHTML = `<button type="button" class="link chat-study-ref" data-paper-card="${esc(id)}" title="${esc(p.title || id)}">${esc(p.label || p.title || id)}</button>`;
        frag.append(t.content); at = i + id.length; return id;
      });
      frag.append(n.data.slice(at)); n.replaceWith(frag);
    }
  }
}

/** A card or a study link opens its study (`open(id)`); Show all shows the rest in place. The columns follow the log's width. */
export function wirePaperCards(host, open) {
  linkStudyIds(host);
  fit(host);
  if (!watched.has(host)) { watched.add(host); watchWidth(host, () => fit(host)); }
  host.querySelectorAll('[data-paper-card]').forEach(b => b.onclick = () => open(b.dataset.paperCard));
  host.querySelectorAll('[data-papers-all]').forEach(b => b.onclick = () => { b.closest('.chat-papers').querySelectorAll('[data-paper-card][hidden]').forEach(c => { c.hidden = false; }); b.remove(); });
}
