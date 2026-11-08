// What makes the command palette's matching understand how a person writes, Turkish above all: loaded the first time the palette opens, because
// lib/search-ranking.mjs (the startup core) only needs to be handed what this module works out.
//
//   word endings   "makalelerde" finds "Makale": the Turkish case and plural endings are taken off the query (a light stemmer; the stem is tried as well
//                  as the word, a little lower), and English plurals ("studies") likewise
//   our words      a Turkish word for something the app names finds it: "tarama" finds Screening, "dosya" Files ("search-lexicon.mjs")
//   typing slips   "screning" finds Screening: one edit in a word of 4 or more letters, two in a word of 8 or more, tried only when nothing matched exactly
//   where it hit   the matched letters of a label are drawn heavier, so a person sees why a row is there, with accents and dotted/dotless i mapped back
//                  onto the label as written
//   a way out      a query that matches nothing is offered the nearest words the palette knows
//
// Folding itself (ı, İ, ş, ğ, ç, ö, ü and the accents) is `foldSearch` in search-ranking.mjs. Pure; it names no view or project.
import { foldSearch } from './search-ranking.mjs';
import { LEXICON } from './search-lexicon.mjs';

const TR_ENDINGS = ['lerinin', 'larinin', 'lerine', 'larina', 'lerini', 'larini', 'lerden', 'lardan', 'lerde', 'larda', 'leri', 'lari', 'ler', 'lar', 'nin', 'nun',
  'dan', 'den', 'tan', 'ten', 'nda', 'nde', 'ndan', 'nden', 'yu', 'yi', 'ya', 'ye', 'da', 'de', 'ta', 'te', 'in', 'un', 'si', 'su', 'lik', 'lig', 'li', 'lu', 'ci', 'cu', 'im', 'um', 'iz', 'i', 'u', 'a', 'e'];
const MIN_STEM = 4;         // a stem shorter than this is not a word worth looking for
const MAX_ALTS = 16;        // alternative queries tried for one typed query
const FUZZY_FROM = 4;       // a word of at least this many letters may carry a typing slip

/** The forms of one folded word the palette may look for, the word itself first: `[{ t, w }]`, `w` how much a match through the form is worth. */
export function forms(word) {
  const out = [{ t: word, w: 1 }], seen = new Set([word]);
  const add = (t, w) => { if (t.length >= MIN_STEM && !seen.has(t)) { seen.add(t); out.push({ t, w }); } };
  let stem = word;
  for (let pass = 0; pass < 3; pass++) {
    const hit = TR_ENDINGS.find(e => stem.endsWith(e) && stem.length - e.length >= (e.length <= 2 ? MIN_STEM : 3));
    if (!hit) break;
    stem = stem.slice(0, -hit.length);
    add(stem, 0.85);
  }
  if (word.endsWith('ies') && word.length > 4) add(`${word.slice(0, -3)}y`, 0.85);
  else if (word.endsWith('s') && word.length > 4) add(word.slice(0, -1), 0.85);
  for (const f of [...out]) for (const en of LEXICON[f.t] || []) add(en, 0.8);
  return out;
}

/** Alternative queries for `query` (folded words joined by spaces) with the weight of each: `[{ q, w }]`, never the typed query itself. */
export function alternatives(query) {
  const words = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return [];
  let combos = [{ parts: [], w: 1, changed: 0 }];
  for (const word of words) combos = combos.flatMap(c => forms(word).slice(0, 6).map((f, i) => ({ parts: [...c.parts, f.t], w: Math.min(c.w, f.w), changed: c.changed + (i ? 1 : 0) })))
    .sort((a, b) => b.w - a.w || b.changed - a.changed).slice(0, 96);
  return combos.filter(c => c.changed).sort((a, b) => b.w - a.w || b.changed - a.changed).slice(0, MAX_ALTS).map(c => ({ q: c.parts.join(' '), w: c.w }));
}

/** True when `a` and `b` are within `k` single-letter edits (insert, delete, change, or swap two neighbours). */
export function near(a, b, k) {
  if (Math.abs(a.length - b.length) > k) return false;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d; if (d < low) low = d;
    }
    if (low > k) return false;
    prev2 = prev; prev = cur;
  }
  return prev[b.length] <= k;
}
/** The single-letter edits a typed word may carry and still match: none for a short word or one with a digit (a year, a DOI), one for 4 to 7 letters, two for 8 or more. */
export const slip = t => (t.length < FUZZY_FROM || /\d/.test(t) ? 0 : t.length >= 8 ? 2 : 1);
const wordsOf = text => text.split(/[^a-z0-9]+/).filter(Boolean);

/** The papers whose text matches every word through a stem, else through one typing slip; `hays` is each paper's folded text. */
export function loosen(papers, hays, terms) {
  const run = ok => papers.filter(p => terms.every(t => ok(hays.get(p), t)));
  const stems = run((hay, t) => forms(t).some(f => hay.includes(f.t)));
  return stems.length ? stems : run((hay, t) => slip(t) > 0 && wordsOf(hay).some(w => near(t, w, slip(t))));
}

/** What a ranked list needs from this module for one typed query: `{ alts, extra }` (see rankItems in search-ranking.mjs). */
export function hooks(query) {
  const terms = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  const alts = alternatives(query);
  if (!terms.length || terms.length > 4 || !terms.some(slip)) return { alts, extra: null };
  return { alts, extra: c => {
    const words = c.words || (c.words = wordsOf(`${c.foldLabel} ${c.foldKeys || ''}`));
    let worth = 0;
    for (const t of terms) {
      const k = slip(t);
      if (!words.some(w => w.startsWith(t) || (k && (near(t, w, k) || (w.length > t.length && near(t, w.slice(0, t.length), k)))))) return 0;
      worth += 1;
    }
    return 18 + worth;   // below any exact, prefix or all-words match (30 and up)
  } };
}

// ---- where a row matched ----------------------------------------------------------------------------------------------------------------
/** `label` folded, with the offsets of each folded letter in the label as written: `{ t, from[], to[] }`. */
export function foldMap(label) {
  const from = [], to = []; let t = '', i = 0;
  for (const ch of String(label ?? '')) {
    const f = foldSearch(ch);
    for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + ch.length); }
    t += f; i += ch.length;
  }
  return { t, from, to };
}
const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** `label` as HTML with the letters that matched `query` in a `palette-hit` span; the whole label escaped, whether or not anything matched. */
export function mark(label, query) {
  const text = String(label ?? ''), words = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return escape(text);
  const { t, from, to } = foldMap(text), spans = [];
  for (const word of words) {
    for (const f of forms(word).filter(x => x.w >= 0.8)) {
      let at = t.indexOf(f.t);
      while (at > 0 && /[a-z0-9]/.test(t[at - 1])) { const next = t.indexOf(f.t, at + 1); if (next < 0) break; at = next; }   // a match at the start of a word, when there is one
      if (at >= 0) { spans.push([from[at], to[at + f.t.length - 1]]); break; }
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) { const last = merged.at(-1); if (last && (s[0] <= last[1] || !text.slice(last[1], s[0]).trim())) last[1] = Math.max(last[1], s[1]); else merged.push([...s]); }
  let out = '', pos = 0;
  for (const [a, b] of merged) { out += `${escape(text.slice(pos, a))}<span class="palette-hit">${escape(text.slice(a, b))}</span>`; pos = b; }
  return out + escape(text.slice(pos));
}

// ---- a way out of no match -------------------------------------------------------------------------------------------------------------
/** The query with each word that matches nothing the palette knows replaced by the nearest word it does (as written in a label); '' when nothing is near. */
export function suggest(items, query, { cap = 6000 } = {}) {
  const terms = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return '';
  const known = new Map();
  for (const it of items.slice(0, cap)) for (const raw of String(it.label ?? '').split(/[^\p{L}\p{N}]+/u)) {
    const w = foldSearch(raw);
    if (w.length >= FUZZY_FROM && !known.has(w)) known.set(w, raw);
  }
  let changed = false;
  const out = terms.map(t => {
    if (!slip(t) || [...known.keys()].some(w => w.startsWith(t))) return t;
    let best = null;
    for (const [w, raw] of known) if (near(t, w, slip(t)) && (!best || Math.abs(w.length - t.length) < Math.abs(best.w.length - t.length))) best = { w, raw };
    if (best) changed = true;
    return best ? best.raw.toLowerCase() : t;
  });
  return changed ? out.join(' ') : '';
}

/** The palette's empty list: "No match", and the nearest words it knows as a button that puts them in the field (`data-try`). */
export function none(items, query) {
  const s = suggest(items, query);
  return `<div class="palette-none">No match${s ? `. Try <button type="button" class="link" data-try="${escape(s)}">${escape(s)}</button>` : ''}</div>`;
}
