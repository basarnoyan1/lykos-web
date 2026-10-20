// The measured column fitter of a data grid (plan: extraction data summary, stage 6, section 9). Pure: no DOM, no store. The caller measures text
// (canvas measureText on the real font in the browser, a fake in the tests) and hands in widths; this module decides how wide each column is and
// which columns do not fit at all. It is driven by the pane's width and by nothing else: there is no breakpoint. `bar-fit.mjs` fits bars of
// controls, `textwidth.mjs` approximates Helvetica for SVG; neither fits a table.
//
//   fitColumns({ available, study, columns: [{ id, min, natural, weight, priority, lines? }] })
//     -> { shown: [id], folded: [id], widths: { [id]: px }, study: px, rest: px, lines: { [id]: n } }   (`rest`: with no column shown, the room beside the row header, for a row detail's cells)
//
// `min` is the narrowest a column may be: its title wrapped to at most two lines, never a word cut (`titleMin`), room for the details button
// beside the title included. `natural` is the width its text would like (`naturalWidth`: the 90th percentile of its cells, capped). A column
// that cannot have its comfortable width (`COMFORT` times its weight, or its natural width when that is less, never under its `min`) is folded, lowest priority
// first (the right-most, unless the caller orders them otherwise): a grid of many squeezed columns reads worse than fewer with the rest in the
// row detail. The caller shows
// the folded columns in a row detail and a column picker, so nothing is pushed off the edge. What is left after every shown column has its
// `min` is shared in proportion to `weight x (natural - min)` (long text gets more), then, once every column has its natural width, by weight.
// Widths are whole pixels and, whenever at least one column or the study column can take them, add up to `available` exactly.

export const FLOOR = 56;            // the narrowest any column is drawn (a number with its padding)
export const MAX_NATURAL = 520;     // the widest a column asks for by itself (40 em of 13 px text)
export const LONG = 240;            // a column whose natural width passes this takes double weight
export const CLAMP_LINES = 4;       // a cell shows this many lines before "Show all"
export const STUDY_SHARE = 0.36;    // the study column's share of the pane at most
export const COMFORT = 144;         // a column is kept (not folded) only while it can have this much (a long text column twice that), or its natural width when that is less
export const WORD_CAP = 120;        // a column's minimum holds its longest word up to this, so a word is not cut in two; a longer string (a link, a code) may break

const num = (x, d = 0) => Number.isFinite(x) ? x : d;
/** Whether a table whose columns need `wide` px keeps only its title column (with the rest on a line beneath) in a pane `available` px wide. */
export const titleOnly = (available, wide) => num(available, wide) < wide;
/** The pieces a text may break between: at spaces, and after a hyphen that has a letter behind it ("Follow-up" breaks as the browser breaks it). */
const pieces = text => String(text ?? '').split(/\s+/).filter(Boolean).flatMap(word => word.split(/(?<=-)(?=[^-])/).map((part, i) => ({ part, gap: i === 0 })));

/** A text as breakable pieces with their widths: { w: [px], sp: [the space before each piece, 0 inside a hyphenated word], total: px }. `measure(str)` gives the width of a string. */
export function measureWords(text, measure) {
  const list = pieces(text), space = list.length > 1 ? measure(' ') : 0;
  const w = list.map(x => measure(x.part)), sp = list.map((x, i) => i && x.gap ? space : 0);
  return { w, sp, total: w.reduce((a, b) => a + b, 0) + sp.reduce((a, b) => a + b, 0) };
}

/**
 * The lines a text takes in `width` px, wrapped greedily at its breaks; a piece wider than the room breaks anywhere (`overflow-wrap:anywhere`)
 * and counts the lines it needs. An empty text is one line.
 */
export function wrapLines({ w, sp }, width) {
  const room = Math.max(1, width);
  let lines = 1, used = 0;
  w.forEach((x, i) => {
    if (x > room) { if (used > 0) lines++; const n = Math.ceil(x / room); lines += n - 1; used = x - (n - 1) * room; return; }
    if (used === 0) used = x;
    else if (used + sp[i] + x <= room) used += sp[i] + x;
    else { lines++; used = x; }
  });
  return lines;
}

/** A text that may hold line breaks (an arm's label, then its treatment): each line measured on its own, `total` the widest line, `w` every piece. */
export function measureText(text, measure) {
  const lines = String(text ?? '').split('\n').map(l => measureWords(l, measure));
  return { lines, w: lines.flatMap(l => l.w), total: Math.max(0, ...lines.map(l => l.total)) };
}
/** The lines a measured text takes in `width` px: each of its own lines wrapped (`wrapLines`), added up. */
export const wrapText = (m, width) => (m.lines ? m.lines.reduce((n, l) => n + wrapLines(l, width), 0) : wrapLines(m, width));

/** The narrowest width at which the text wraps to `maxLines` lines or fewer without cutting a word: never under its widest word. */
export function wrapMin(measured, maxLines = 2) {
  if (!measured.w.length) return 0;
  const widest = Math.ceil(Math.max(...measured.w));
  if (wrapLines(measured, widest) <= maxLines) return widest;
  let lo = widest, hi = Math.ceil(measured.total);   // lines(hi) is 1: monotone, so a bisection finds the narrowest width
  while (lo < hi) { const mid = (lo + hi) >> 1; if (wrapLines(measured, mid) <= maxLines) hi = mid; else lo = mid + 1; }
  return lo;
}

/** The 90th percentile of a list of widths (nearest rank); 0 for an empty list. */
export function percentile(list, p = 0.9) {
  const a = list.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))] : 0;
}

/**
 * The minimum, natural width and weight of one column from what it holds. `title` is its header text, `texts` its cell texts, `measureHead` and
 * `measureCell` measure on the header's and the cell's font, `pad` is the cell's horizontal padding, `extra` the room the header keeps beside
 * its words (the details button and the gap before it), `cellExtra` the room a cell keeps beside its text (the row opener of the study
 * column). The result is whole pixels.
 */
export function columnSpec({ id, title, texts = [], measureHead, measureCell, pad = 24, extra = 0, cellExtra = 0, titleLines = 2, wordCap = WORD_CAP, pct = 0.9, cap = MAX_NATURAL, priority = 0, numeric = false }) {
  const head = measureWords(title, measureHead);
  let widest = 0;
  const measured = texts.map(t => measureText(t, measureCell)), widths = measured.map(m => m.total);
  for (const m of measured) for (const x of m.w) if (x > widest) widest = x;
  const titleMin = pad + extra + wrapMin(head, titleLines);
  const min = Math.ceil(Math.max(FLOOR, titleMin, pad + cellExtra + Math.min(widest, wordCap)));
  const natural = Math.ceil(Math.max(min, pad + cellExtra + Math.min(percentile(widths, pct), cap)));
  return { id, min, natural, weight: natural > LONG ? 2 : 1, priority, numeric,
    // the lines the column's longest text takes at a width: what the row's height is read from
    measured,
    lines: width => measured.length ? Math.max(1, ...measured.map(m => wrapText(m, width - pad - cellExtra))) : 1 };
}

/** The width of a whole number split by weights with the remainder given out by largest fraction (ties: the earlier index). */
function share(total, parts) {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return parts.map(() => 0);
  const raw = parts.map(p => total * p / sum), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

/**
 * Fits the columns into `available` px. `study` is the row header's own column: { min, natural } (its title and its longest word; it is the
 * first column of a table of studies as rows and the field column of a table of fields as rows). `hidden` lists ids a person put away; they are
 * folded without being asked for room. See the head of this file for the rules. Deterministic: the same input gives the same output.
 */
export function fitColumns({ available, study = { min: FLOOR, natural: FLOOR }, columns = [], hidden = [], maxLines = CLAMP_LINES, comfort = COMFORT }) {
  const room = Math.max(0, Math.floor(num(available)));
  const away = new Set(hidden);
  const byPriority = columns.map((c, i) => ({ ...c, order: i })).sort((a, b) => num(a.priority, a.order) - num(b.priority, b.order) || a.order - b.order);
  const sMin = Math.max(0, Math.ceil(num(study.min, FLOOR))), sNat = Math.max(sMin, Math.ceil(num(study.natural, sMin)));
  const candidates = byPriority.filter(c => !away.has(c.id)).map(c => {
    const min = Math.max(1, Math.ceil(num(c.min, FLOOR))), natural = Math.max(min, Math.ceil(num(c.natural, min)));
    return { ...c, min, natural, base: Math.max(min, Math.min(natural, comfort * Math.max(1, num(c.weight, 1)))) };
  });
  // fold from the lowest priority until every column's comfortable width fits beside the study column's own minimum
  let need = sMin + candidates.reduce((a, c) => a + c.base, 0);
  const shown = candidates.slice();
  while (shown.length && need > room) need -= shown.pop().base;
  // the first column is kept at less than its comfortable width when that is all the pane has: a grid of only studies would hide every value in a row detail
  if (!shown.length && candidates.length && sMin + candidates[0].min <= room) { const c = candidates[0]; c.base = Math.max(c.min, Math.min(c.base, room - sMin)); shown.push(c); }
  const shownIds = new Set(shown.map(c => c.id));
  const folded = columns.filter(c => !shownIds.has(c.id)).map(c => c.id);
  // the study column takes its natural width within its share of the pane and what the minimums leave
  const minSum = shown.reduce((a, c) => a + c.base, 0);
  let studyW;
  if (!shown.length) studyW = Math.max(Math.min(sMin, room), Math.min(sNat, Math.floor(room * STUDY_SHARE)));   // no column: the row header keeps its share and the rest is the room of a row detail's cells (`rest`)
  else studyW = Math.max(Math.min(sMin, room), Math.min(sNat, Math.floor(room * STUDY_SHARE), room - minSum));
  if (shown.length) studyW = Math.min(studyW, room - minSum);   // never so wide that a shown column goes under its minimum
  let left = room - studyW - minSum;
  const widths = Object.fromEntries(shown.map(c => [c.id, c.base]));
  // first the wants (natural - base) by weight x want, with the caps redistributed; then the surplus by weight
  let open = shown.filter(c => c.natural > c.base);
  while (left > 0 && open.length) {
    const want = open.map(c => c.natural - widths[c.id]), parts = open.map((c, i) => num(c.weight, 1) * want[i]);
    const give = share(Math.min(left, want.reduce((a, b) => a + b, 0)), parts.some(p => p > 0) ? parts : want);
    let used = 0;
    open.forEach((c, i) => { const g = Math.min(give[i], want[i]); widths[c.id] += g; used += g; });
    left -= used;
    open = open.filter(c => widths[c.id] < c.natural);
    if (!used) break;
  }
  if (left > 0 && shown.length) {
    const give = share(left, shown.map(c => Math.max(0, num(c.weight, 1))).some(x => x > 0) ? shown.map(c => Math.max(0, num(c.weight, 1))) : shown.map(() => 1));
    shown.forEach((c, i) => { widths[c.id] += give[i]; }); left = 0;
  }
  const lines = {};
  for (const c of shown) lines[c.id] = typeof c.lines === 'function' ? Math.min(maxLines, Math.max(1, c.lines(widths[c.id]))) : 1;
  return { shown: shown.map(c => c.id), folded, widths, study: studyW + (shown.length ? left : 0), rest: shown.length ? 0 : room - studyW, lines };
}
