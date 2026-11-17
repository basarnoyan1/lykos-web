// Find in a PDF: a matcher over the text PDF.js gives for each page, with no DOM. The page's runs (items) are folded the way lib/quotes.mjs folds a
// quote (ligatures, dashes, curly quotes, a word broken at a line end), one character at a time, and each folded character remembers the run and the
// offset it came from, so a match maps back to the runs and from them to rectangles on the page (hitRects). Plan PDF-OPTIONS §3, T0.
//
// Shapes: a page is a list of runs, each `{ str, hasEOL?, x?, y?, w?, h? }` (or a plain string, read as one line); `x, y` is the run's baseline
// origin in PDF units and `w, h` its advance and its font height, as lib/doctext.mjs keeps them.

const FOLD = new Map([['­', ''], ['…', '...'], ['′', "'"], ['″', '"'], ['∘', '°'], ['º', '°'], ['˚', '°']]);
for (const c of '‐‑‒–—―−') FOLD.set(c, '-');
for (const c of '‘’‚‛') FOLD.set(c, "'");
for (const c of '“”„‟') FOLD.set(c, '"');
const SPACE = /\s/u, LETTER = /\p{L}/u;
const LETTERS = { 'ı': 'i', 'ß': 'ss', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'æ': 'ae', 'œ': 'oe' };

/** One character as the matcher sees it: compatibility forms opened (ﬁ is fi), dashes and quotes made plain, lower case unless the case matters. */
function foldChar(ch, matchCase) {
  if (FOLD.has(ch)) return FOLD.get(ch);
  let f = ch.normalize('NFKC');
  // without Match case, accents and Turkish dotted and dotless i do not matter either: "basak" finds "Başak", "ISI" finds "ısı"
  if (!matchCase) f = f.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[ıßøđłæœ]/g, c => LETTERS[c]);
  if (f.length === 1 && FOLD.has(f)) return FOLD.get(f);
  return f;
}
const runsOf = page => (Array.isArray(page) ? page : page?.items || []).map(r => (typeof r === 'string' ? { str: r, hasEOL: true } : r || { str: '' }));

/**
 * A page made searchable: `text` is the folded page, `at[i]` and `off[i]` the run and the offset in that run each folded character came from. Runs on
 * one line join as they are; a line end is one space, and a hyphen at a line end between two letters is dropped with it ("compli-" + "cations").
 */
export function preparePage(page, { matchCase = false } = {}) {
  const runs = runsOf(page);
  const chars = [], at = [], off = [], eol = [];
  const push = (c, i, k, end = false) => { chars.push(c); at.push(i); off.push(k); eol.push(end); };
  const lastSpace = () => !chars.length || chars[chars.length - 1] === ' ';
  runs.forEach((run, i) => {
    const s = String(run.str ?? '');
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (SPACE.test(ch)) { if (!lastSpace()) push(' ', i, k); continue; }
      const f = foldChar(ch, matchCase);
      for (const c of f) { if (SPACE.test(c)) { if (!lastSpace()) push(' ', i, k); } else push(c, i, k); }
    }
    // PDF.js says where a line ends; a run that does not say (an index's one run per line) is a line of its own
    if (run.hasEOL ?? true) {
      if (!lastSpace()) push(' ', i, Math.max(0, s.length - 1), true);
      else if (chars.length) eol[eol.length - 1] = true;
    }
  });
  // a word broken at a line end: letter, hyphen, the line's space, letter -> the two letters meet
  const drop = new Set();
  for (let j = 1; j + 2 < chars.length; j++) if (chars[j] === '-' && chars[j + 1] === ' ' && eol[j + 1] && LETTER.test(chars[j - 1]) && LETTER.test(chars[j + 2])) { drop.add(j); drop.add(j + 1); }
  while (chars.length && chars[chars.length - 1] === ' ') { chars.pop(); at.pop(); off.pop(); eol.pop(); }
  const n = chars.length - [...drop].filter(j => j < chars.length).length;
  const text = [], A = new Int32Array(n), O = new Int32Array(n);
  for (let j = 0, w = 0; j < chars.length; j++) { if (drop.has(j)) continue; text.push(chars[j]); A[w] = at[j]; O[w] = off[j]; w++; }
  return { text: text.join(''), at: A, off: O };
}

/** Every page made searchable; a page not read yet (null) is an empty page. */
export const prepare = (pages, opts = {}) => (pages || []).map(p => (p ? preparePage(p, opts) : { text: '', at: new Int32Array(0), off: new Int32Array(0) }));

/** The query folded as the pages are: spaces run together, the ends trimmed. */
export function foldQuery(query, { matchCase = false } = {}) {
  let out = '';
  for (const ch of String(query ?? '')) {
    const f = SPACE.test(ch) ? ' ' : foldChar(ch, matchCase);
    for (const c of f) { const sp = SPACE.test(c); if (sp && (!out || out.endsWith(' '))) continue; out += sp ? ' ' : c; }
  }
  return out.trim();
}

/**
 * The matches of `query` in prepared pages, in document order: `{ page, item, start, endItem, end }`, page from 1, `item`/`start` the first run and
 * offset, `endItem`/`end` the last run and the offset after the match. An empty query matches nothing; `limit` caps a pathological query ("e").
 */
export function findHits(prep, query, { matchCase = false, limit = 5000 } = {}) {
  const q = foldQuery(query, { matchCase });
  const hits = [];
  if (!q) return hits;
  for (let p = 0; p < (prep || []).length && hits.length < limit; p++) {
    const { text, at, off } = prep[p];
    for (let i = text.indexOf(q); i >= 0 && hits.length < limit; i = text.indexOf(q, i + 1)) {
      const e = i + q.length - 1;
      hits.push({ page: p + 1, item: at[i], start: off[i], endItem: at[e], end: off[e] + 1 });
    }
  }
  return hits;
}

/** The hit after (`dir` 1) or before (-1) the hit at index `at`, wrapping round; with no current hit, the first or the last. -1 when there are none. */
export function cursor(hits, at, dir = 1) {
  const n = hits?.length || 0;
  if (!n) return -1;
  if (!(at >= 0 && at < n)) return dir < 0 ? n - 1 : 0;
  return (at + (dir < 0 ? -1 : 1) + n) % n;
}

/** The first hit on or after page `page` (where reading is), else the first. */
export function nearest(hits, page) {
  if (!hits?.length) return -1;
  const i = hits.findIndex(h => h.page >= page);
  return i < 0 ? 0 : i;
}

/**
 * The find bar's count: "3 of 12"; while the pages are still being read and nothing is found, "Searching"; nothing found, "No matches", or, when some
 * pages have no text to search, "0 · 3 scanned". Never wider than 16 characters (the status slot).
 */
export function countText({ n = 0, i = -1, noText = 0, done = true, query = '' } = {}) {
  if (!String(query).trim()) return '';
  if (n > 0) return `${Math.max(0, i) + 1} of ${n}`;
  if (!done) return 'Searching';
  return noText > 0 ? `0, ${Math.min(noText, 999)}${noText > 999 ? '+' : ''} scanned` : 'No matches';
}

/**
 * The rectangles of a hit, in PDF units ({x1, y1, x2, y2}, origin bottom left), one per run it covers: the share of each run's advance its characters
 * take (exact for monospaced runs and close for the rest, as lib/annotations.mjs textInRects reads them), from a little under the baseline to the
 * top of the type.
 */
export function hitRects(hit, page) {
  const runs = runsOf(page), out = [];
  for (let i = hit.item; i <= hit.endItem; i++) {
    const r = runs[i], s = String(r?.str ?? '');
    if (!s.length || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    const from = i === hit.item ? hit.start : 0, to = i === hit.endItem ? hit.end : s.length;
    if (to <= from) continue;
    const w = Number(r.w) || 0, h = Number(r.h) || 10;
    out.push({ x1: r.x + w * from / s.length, y1: r.y - h * 0.22, x2: r.x + w * to / s.length, y2: r.y + h * 0.9 });
  }
  return out;
}

/** PDF.js text content to the runs this module reads: the string, the line end, the baseline origin, the advance and the font height. */
export const runsFromContent = content => (content?.items || []).filter(it => typeof it?.str === 'string').map(it => ({
  str: it.str, hasEOL: !!it.hasEOL, x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, w: it.width || 0, h: it.height || Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0) || 10 }));

/** The words around a hit as the page writes them: `{ before, match, after }`, at most `room` characters each side, for a list of matches. */
export function hitContext(hit, page, room = 48) {
  const runs = runsOf(page), s = i => String(runs[i]?.str ?? '');
  const join = (from, to) => { let out = ''; for (let i = from; i <= to; i++) { const t = s(i); out += out && !/\s$/.test(out) && t && !/^\s/.test(t) && runs[i - 1]?.hasEOL !== false ? ` ${t}` : t; } return out; };
  let before = `${join(Math.max(0, hit.item - 3), hit.item - 1)}${hit.item > 0 ? ' ' : ''}${s(hit.item).slice(0, hit.start)}`;
  const match = hit.item === hit.endItem ? s(hit.item).slice(hit.start, hit.end) : `${s(hit.item).slice(hit.start)} ${join(hit.item + 1, hit.endItem - 1)} ${s(hit.endItem).slice(0, hit.end)}`.replace(/\s+/g, ' ');
  let after = `${s(hit.endItem).slice(hit.end)} ${join(hit.endItem + 1, Math.min(runs.length - 1, hit.endItem + 3))}`;
  before = before.replace(/\s+/g, ' ').trimStart(); after = after.replace(/\s+/g, ' ').trimEnd();
  if (before.length > room) before = `…${before.slice(-room).replace(/^\S*\s/, '')}`;
  if (after.length > room) after = `${after.slice(0, room).replace(/\s\S*$/, '')}…`;
  return { before, match, after };
}
