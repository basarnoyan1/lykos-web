// Comments in the margin of the Manuscript reader (views/manuscript-comments.mjs). 3 Nov 2026, the owner, with the reader's App view and its
// empty right half: "we could also use the right space for AI comments like Grammarly suggestions UI you know highlight the text and show
// your comments. Also should be able to highlight myself the text parts to get comments, suggestions, checks etc or explanations".
//
// Two kinds of card. A check card costs nothing: it is derived here from what Lykos already reads of the file (the number check's rows and
// what changed since the build, the authors' blanks of lib/placeholders.mjs, the clarity checks of lib/file-quality.mjs that point at text).
// A model card is an answer the person asked for on a passage (Explain, Suggest a rewrite, Check), kept in the project by file and version.
//
// A card is anchored to its text, never to a position alone: the unit's index (a block of the reading model, lib/docx-reading.mjs), a hash
// of the unit's text, the quoted span with the words around it. A rebuilt file re-anchors each card (the same paragraph elsewhere, the same
// words in a changed paragraph) or marks it outdated. Pure: no store, no DOM.
import { lib_manuscript$hashText as hashText } from "../boot.mjs";
import { placeholdersIn } from './placeholders.mjs';
import { undefinedAbbreviations } from './file-quality.mjs';
import { locateAnchor } from './file-notes.mjs';

const AROUND = 40;   // characters kept on each side of a quote, as lib/file-notes.mjs keeps them
const SENTENCE_MAX = 40;   // words; lib/file-quality.mjs manuscriptClarity's limit
const words = t => (String(t || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;

// ---- anchors ----------------------------------------------------------------------------------------------------------------
/** The anchor of `text[start, end)` in unit `k` of `units` (the reading model's): { unit, block, hash, start, end, quote, prefix, suffix }. */
export function anchorAt(units, k, start, end) {
  const u = units[k], text = u?.text || '';
  const a = Math.max(0, Math.min(start, text.length)), z = Math.max(a, Math.min(end, text.length));
  return { unit: k, block: u?.block ?? null, hash: hashText(text), start: a, end: z, quote: text.slice(a, z), prefix: text.slice(Math.max(0, a - AROUND), a), suffix: text.slice(z, z + AROUND) };
}

/**
 * Where an anchor is in `units` now: { unit, start, end, moved, outdated }. The same text at the same place is found at once; the same
 * paragraph elsewhere (a section moved) and the same words in a paragraph whose other words changed are found and marked `moved`; an
 * anchor whose words are gone is `outdated`, kept near where it was.
 */
export function locateComment(units, a) {
  if (!a || !units?.length) return { unit: 0, start: 0, end: 0, moved: false, outdated: true };
  const k = Math.max(0, Math.min(a.unit ?? 0, units.length - 1));
  const same = i => units[i] && hashText(units[i].text || '') === a.hash;
  if (same(k)) return { unit: k, start: a.start, end: a.end, moved: false, outdated: false };
  // the paragraph itself, moved: the nearest unit with the same text
  const near = order(k, units.length).find(same);
  if (near != null) return { unit: near, start: a.start, end: a.end, moved: true, outdated: false };
  // the words, in a paragraph that changed around them: the nearest unit that holds the quote with its context, else the quote alone
  if (a.quote) {
    for (const strict of [true, false]) {
      for (const i of order(k, units.length)) {
        const hit = locateAnchor(units[i].text || '', strict ? a : { ...a, prefix: '', suffix: '' });
        if (hit) return { unit: i, start: hit.start, end: hit.end, moved: true, outdated: false };
      }
    }
  }
  return { unit: k, start: 0, end: 0, moved: false, outdated: true };
}
// unit indexes from k outward: k, k+1, k-1, k+2, k-2 …
function order(k, n) { const out = []; for (let d = 0; out.length < n; d++) { if (k + d < n) out.push(k + d); if (d && k - d >= 0) out.push(k - d); } return out; }

// ---- the free comments ---------------------------------------------------------------------------------------------------------
/** What each check card kind is called on the card, and the hue it carries: a check that means attention is warn; the rest neutral. */
export const KINDS = Object.freeze({
  blank: { label: 'Blank to fill', tone: 'warn' },
  stale: { label: 'Data changed', tone: 'warn' },
  unmatched: { label: 'Number not matched', tone: 'warn' },
  cross: { label: 'Numbers disagree', tone: 'warn' },
  sentence: { label: 'Long sentence', tone: '' },
  abbreviation: { label: 'Abbreviation', tone: '' },
  dash: { label: 'Range', tone: '' },
  model: { label: 'Answer', tone: '' },
});
// a unit a check reads: a paragraph or a caption, never a heading, a table, a figure or the reference list
const readable = u => u.kind === 'p' || u.kind === 'caption';
// the reader's mark on a checked number (lib/docx-reading.mjs textHtml): stale when its data changed since the build
const NUM = /<span class="msd-num( is-stale)?(?: is-unmatched)?" data-n="(\d+)">([^<]*)<\/span>/g;
const NOT_FOUND = /^(not found|no source|unmatched|unknown|none)\b/i;
// a range of two numbers joined by a hyphen (not a date, not a DOI's or a code's part, not a minus): "12-20", "0.4-1.2"
const HYPHEN_RANGE = /(?<![\d.\-–/\w])(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?![\d.\-–/\w%]*[/\w])/g;
const EN_DASH_RANGE = /\d–\d/;
/** The id of a check card: its kind and the text it is on (the paragraph and the quoted words), so a dismissal holds for that text in every version. */
export const checkId = (kind, unitText, quote) => `c:${kind}:${hashText(`${unitText}\u0000${quote}`)}`;

/**
 * The check cards of a reading model (lib/docx-reading.mjs readingModel): [{ id, kind, anchor, text, fix, more }], one card a kind a
 * paragraph (its other findings of that kind folded in `more`), in the order of the text. `skip`: abbreviations the project defines itself.
 *   model.numbers[n].row.source names a number's source; a source the check could not find is a card; a number marked stale is one.
 *   stale: the reader's { analysis: { after: { text } }, record: '…' } for the sentence that says what changed.
 */
export function checkComments(model, { stale = null, skip = null, cross = null } = {}) {
  const units = model?.units || [], out = [];
  // the cross-checks (lib/cross-checks.mjs): a card at the number one is about, or at the caption of the table it reads
  const crossAt = new Map(), crossOf = new Map(), CROSS_FIX = 'Correct one of them, then register the build again.';
  for (const x of cross || []) {
    if (x.place?.cell || !x.rows?.length) { const k = x.place?.part || ''; if (k) crossOf.set(k, [...(crossOf.get(k) || []), x]); }
    else if (!crossAt.has(x.rows[0])) crossAt.set(x.rows[0], x);
  }
  const per = new Map();   // `${unit}:${kind}` -> card
  const add = (k, kind, start, end, text, fix = '') => {
    const u = units[k], key = `${k}:${kind}`, quote = u.text.slice(start, end);
    const hit = per.get(key);
    if (hit) { hit.more.push(quote); return hit; }
    const card = { id: checkId(kind, u.text, quote), kind, anchor: anchorAt(units, k, start, end), text, fix, more: [] };
    per.set(key, card); out.push(card);
    return card;
  };
  const changed = stale?.analysis?.after?.text || stale?.record || 'values written';
  const abbrSeen = new Set(skip || []);
  const dashes = units.some(u => readable(u) && EN_DASH_RANGE.test(u.text));
  units.forEach((u, k) => {
    if (!readable(u) || !u.text) return;
    const t = u.text;
    // numbers: a source the check could not find, and one whose data changed after the file was built
    for (const m of u.html.matchAll(NUM)) {
      const info = model.numbers[+m[2]], at = plainLength(u.html.slice(0, m.index)), n = m[3];
      if (!info || t.slice(at, at + n.length) !== n) continue;
      // the number check as data (lib/number-check.mjs): a number is stale for the values it rests on, unmatched when its source does not hold it
      const ck = info.row.check, why = ck && stale?.flags?.rows?.get?.(ck.n);
      if (ck && crossAt.has(ck.n)) add(k, 'cross', at, at + n.length, crossAt.get(ck.n).text, CROSS_FIX);
      if (m[1]) add(k, 'stale', at, at + n.length, why ? `${n} came from ${sourceName(info.row.source)} and rests on ${why}.` : `${n} came from ${sourceName(info.row.source)}; the data changed after the manuscript was built (${changed}).`, 'Rebuild the manuscript, or check the number against the current data.');
      else if (ck ? ck.status === 'unmatched' : NOT_FOUND.test(info.row.source || '')) add(k, 'unmatched', at, at + n.length, ck && ck.source?.kind !== 'none' ? `${n} is given as from ${sourceName(info.row.source)}, which does not hold it.` : `The number check found no source for ${n}.`, 'Give it a source in the data, or take it out.');
    }
    // a table's cross-checks, at its caption
    if (u.kind === 'caption' && crossOf.has(u.place)) { const a = Math.max(0, t.indexOf(u.place)); for (const x of crossOf.get(u.place)) add(k, 'cross', a, a + u.place.length, x.text, CROSS_FIX); }
    // the authors' blanks
    for (const p of placeholdersIn([t])) { const at = t.indexOf(p.text); if (at >= 0) add(k, 'blank', at, at + p.text.length, `${p.text} is a blank the authors still have to fill.`, ''); }
    // long sentences
    let at = 0;
    for (const s of t.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const n = words(s), from = t.indexOf(s, at); at = from + s.length;
      if (n > SENTENCE_MAX && from >= 0) add(k, 'sentence', from, from + s.length, `A sentence of ${n} words.`, `Split it: a reader holds about ${SENTENCE_MAX} words at a time.`);
    }
    // abbreviations used before they are defined: the first use in the text
    const undef = undefinedAbbreviations([t], { skip: [...abbrSeen] });
    for (const a of undef) {
      const m = new RegExp(`\\b${a}s?\\b`).exec(t);
      if (m) add(k, 'abbreviation', m.index, m.index + a.length, `${a} is used before it is defined.`, `Write it out at first use, then "(${a})".`);
    }
    for (const m of t.matchAll(/\(([A-Z][A-Za-z0-9]{1,6})s?\)/g)) abbrSeen.add(m[1]);
    for (const a of undef) abbrSeen.add(a);
    // a range written with a hyphen in a manuscript whose other ranges use an en dash
    if (dashes) for (const m of t.matchAll(HYPHEN_RANGE)) add(k, 'dash', m.index, m.index + m[0].length, `${m[0]} is written with a hyphen; the manuscript's other ranges use an en dash.`, `Write ${m[1]}–${m[2]}.`);
  });
  return out;
}
// the characters of text before a place in a unit's HTML (lib/docx-reading.mjs plainOf: tags out, the five entities read)
const plainLength = html => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, 'x').length;
// a source as the card names it: its first words ("results.md", "Lykos output t-main", "Evidence table values in the Lykos record")
const sourceName = s => { const t = String(s || ''); const cut = t.indexOf(' ('); return (cut > 0 ? t.slice(0, cut) : t).slice(0, 80); };

// ---- the project's record of a file's cards -----------------------------------------------------------------------------------
// s.manuscriptComments[file] = { cards: [model card], dismissed: { id: at }, resolved: { id: at } }
//   model card: { id, kind: 'model', ask: 'explain' | 'rewrite' | 'check', model, at, version, anchor, text, proposal?, checks? }
const MAX_CARDS = 200;
const byFile = (s, file) => (s.manuscriptComments?.[file]) || { cards: [], dismissed: {}, resolved: {} };
/** The file's record (cards, dismissed, resolved), never mutated. */
export function commentsOf(s, file) { const r = byFile(s, file); return { cards: r.cards || [], dismissed: r.dismissed || {}, resolved: r.resolved || {} }; }
const put = (s, file, r) => { s.manuscriptComments = { ...(s.manuscriptComments || {}), [file]: r }; return s; };
/** Keeps a model card; the oldest leave past MAX_CARDS. Mutates `s`. */
export function addModelComment(s, file, card) {
  const r = commentsOf(s, file);
  return put(s, file, { ...r, cards: [...r.cards.filter(c => c.id !== card.id), card].slice(-MAX_CARDS) });
}
export function removeComment(s, file, id) { const r = commentsOf(s, file); return put(s, file, { ...r, cards: r.cards.filter(c => c.id !== id) }); }
/** A dismissed card stays dismissed: a check card for that text in every version, a model card for good. */
export function dismissComment(s, file, id, at = new Date().toISOString()) { const r = commentsOf(s, file); return put(s, file, { ...r, dismissed: { ...r.dismissed, [id]: at } }); }
export function resolveComment(s, file, id, done = true, at = new Date().toISOString()) {
  const r = commentsOf(s, file), resolved = { ...r.resolved };
  if (done) resolved[id] = at; else delete resolved[id];
  return put(s, file, { ...r, resolved });
}

/**
 * Every card to show for a file as read now: the check cards not dismissed and the model cards, each located in `units`
 * ([{ card, at: { unit, start, end, moved, outdated }, resolved }]), in the order of the text, a running model card first in its unit.
 */
export function cardsToShow(units, checks, record) {
  const { cards, dismissed, resolved } = record;
  const list = [];
  for (const card of checks) if (!dismissed[card.id]) list.push({ card, at: locateComment(units, card.anchor), resolved: !!resolved[card.id] });
  for (const card of cards) if (!dismissed[card.id]) list.push({ card, at: locateComment(units, card.anchor), resolved: !!resolved[card.id] });
  return list.sort((a, b) => a.at.unit - b.at.unit || a.at.start - b.at.start);
}
