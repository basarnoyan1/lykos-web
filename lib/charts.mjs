// Study and patient characteristics as figures: publications per year, counts
// by a charted characteristic, and the distribution of a patient-level column.
//
// Drawn here as self-contained SVG, like the PRISMA diagram and the evidence
// map: no engine start, no library, and the same file on screen and in the
// bundle. Black text on white, grey bars; hue is left to the figures whose
// reader already knows what it means (risk of bias).
//
// A charted value may name several categories ("RCT; cohort"): the study is
// counted under each, as the evidence map counts it. An empty value is its own
// bar, "Not reported", last — a gap in reporting is something a reader sees.
import { studies } from './screen.mjs';
import { fields, valueFor } from './fields.mjs';
import { baselineColumns, descriptiveKind, descriptiveConverter } from './describe.mjs';
import { textWidth } from './textwidth.mjs';
import { houseBar, houseColumn } from './figure-house-render.mjs';

export const NOT_REPORTED = 'Not reported';

const FONT = 'Helvetica, Arial, sans-serif';
const FS = 12;
const INK = '#000', AXIS = '#555', GRID = '#e3e3e3', BAR = '#8f8f8f';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = x => (Math.round(x * 10) / 10).toString();

// ---- counting ---------------------------------------------------------------

/** A cell's categories: split on ';', trimmed, de-duplicated ignoring case. */
export function splitCategories(raw) {
  const parts = raw == null ? [] : String(raw).split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
  const seen = new Map();
  for (const p of parts) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  return [...seen.values()];
}

/**
 * Counts per category over lists of categories (one list per unit), folding
 * case to the first spelling seen. Most frequent first, ties alphabetical,
 * "Not reported" last whatever its count.
 */
export function countBy(lists) {
  const counts = new Map(), label = new Map();
  for (const list of lists) for (const c of list) {
    const k = c.toLowerCase();
    if (!label.has(k)) label.set(k, c);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const nr = NOT_REPORTED.toLowerCase();
  return [...counts].sort((a, b) => (a[0] === nr) - (b[0] === nr) || b[1] - a[1]
    || label.get(a[0]).localeCompare(label.get(b[0]))).map(([k, n]) => ({ label: label.get(k), count: n }));
}

/** A study's publication year as a number, or null. */
export const yearOf = p => {
  const m = String(p?.year ?? '').match(/\b(1[89]\d\d|20\d\d|21\d\d)\b/);
  return m ? Number(m[1]) : null;
};

/**
 * Studies per publication year over a continuous axis: a year with no study is
 * a bar of zero, not a missing column, so gaps in the literature show.
 */
export function yearCounts(papers) {
  const years = papers.map(yearOf);
  const known = years.filter(y => y != null);
  if (!known.length) return { bars: [], missing: papers.length, total: papers.length };
  const lo = Math.min(...known), hi = Math.max(...known);
  const bars = [];
  for (let y = lo; y <= hi; y++) bars.push({ label: String(y), count: known.filter(x => x === y).length });
  return { bars, missing: years.length - known.length, total: papers.length };
}

/** Charted characteristics a count chart can be drawn by: text and category fields, not analysis inputs. */
/**
 * Charted characteristics a count chart can be drawn by: category fields, and
 * text fields whose values repeat. A free-text field where nearly every study
 * says something of its own ("Dynesys at one (80%) or two levels") would draw
 * one bar of 1 per study, which counts nothing.
 */
// The project's own extraction tables (an imported evidence table) count as
// fields too, named with their table so two "Study design" columns differ.
export const tableFields = s => (s.templates || []).flatMap(t => (t.columns || []).map(c => ({ id: c.id, label: `${c.name || c.label || c.id} · ${t.name}`, type: ['category','number','integer'].includes(c.type) ? c.type : 'text' })));
export const chartableFields = (s, papers = studies(s)) => [...fields(s), ...tableFields(s)].filter(f => {
  if (f.analysis || !['text','category','number','integer'].includes(f.type) || /^(?:id|study|study id|reference|doi|pmid)(?: ·|$)/i.test(f.label)) return false;
  const cats = papers.flatMap(p => splitCategories(valueFor(s, p.id, f)).map(c => c.toLowerCase()));
  if (!cats.length) return false;
  if (f.type === 'category') return true;
  return true;
});

// ---- free text grouped by recurring terms ------------------------------------

const STOP = new Set('de novo also disease diseases treated flexible prior low a an and are as at by for from in into is of on or the to with without who whose was were be been has have had not no nor than that this these those their there after before under over between among within per via vs versus y yr yrs years year mo months month patients patient cases case study studies group groups mean median range n total including included only other all both each one two three four five'.split(' '));
// Runs of adjacent content words: a phrase never bridges a comma or a
// dropped word ("scoliosis in elderly" is not the phrase "scoliosis elderly").
const runsOf = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .split(/[^a-z0-9\s-]+/).flatMap(part => { const out = [[]]; for (const w of part.split(/\s+/)) {
    if (w.length > 2 && !STOP.has(w) && !/^\d/.test(w)) out.at(-1).push(w); else if (out.at(-1).length) out.push([]); } return out.filter(r => r.length); });

/**
 * Free text read as the recurring terms it shares across studies: every one-
 * to three-word phrase held by at least two studies is a candidate; longer
 * phrases win over the shorter ones they contain when they cover nearly the
 * same studies. A study counts under each term it mentions; one that shares
 * no term with another counts as "Other". Deterministic, no model call.
 */
export function termGroups(texts, { max = 12 } = {}) {
  const docs = texts.map(t => { const grams = new Set();
    for (const w of runsOf(t)) for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '));
    return grams; });
  const df = new Map();
  docs.forEach((g, i) => g.forEach(k => { if (!df.has(k)) df.set(k, new Set()); df.get(k).add(i); }));
  // Two passes. Phrases first, longest and most shared ahead, each taken while
  // it reaches two studies no related chosen phrase covers; then single words,
  // only for studies no chosen term reaches yet.
  const score = ([k, set]) => set.size * (1 + 0.75 * (k.split(' ').length - 1));
  const shared = [...df].filter(([, set]) => set.size >= 2).sort((x, y) => score(y) - score(x) || x[0].localeCompare(y[0]));
  const chosen = [];
  for (const [k, set] of shared.filter(([k]) => k.includes(' '))) {
    if (chosen.length >= max) break;
    const related = chosen.filter(c => c.term.includes(k) || k.includes(c.term));
    if ([...set].filter(i => !related.some(c => c.set.has(i))).length < 2) continue;
    chosen.push({ term: k, set });
  }
  // A single word held by more than half the studies is too broad to split them.
  for (const [k, set] of shared.filter(([k, set]) => !k.includes(' ') && set.size <= Math.max(2, docs.length / 2))) {
    if (chosen.length >= max) break;
    const reached = new Set(chosen.flatMap(c => [...c.set]));
    if ([...set].filter(i => !reached.has(i)).length < 2) continue;
    chosen.push({ term: k, set });
  }
  const covered = new Set(chosen.flatMap(c => [...c.set]));
  const other = texts.map((t, i) => i).filter(i => String(texts[i] || '').trim() && !covered.has(i)).length;
  return [...chosen.map(c => ({ label: c.term.charAt(0).toUpperCase() + c.term.slice(1), count: c.set.size, ids: [...c.set] })).sort((a, b) => b.count - a.count),
    ...(other ? [{ label: 'Other', count: other }] : [])];
}

/** Whether a text field is free text (nearly every study says something of its own). */
const freeText = (s, f, papers) => {
  const vals = papers.map(p => valueFor(s, p.id, f)).filter(Boolean);
  return vals.length >= 4 && new Set(vals.map(v => v.toLowerCase())).size > Math.max(8, vals.length * 0.6);
};

/** Studies per category of one charted field, over the included studies. */
export function categoryCounts(s, field, papers = studies(s)) {
  if (field.type !== 'category' && freeText(s, field, papers))
    return { field, bars: termGroups(papers.map(p => valueFor(s, p.id, field) || '')), total: papers.length, grouped: true };
  const lists = papers.map(p => {
    const c = splitCategories(valueFor(s, p.id, field));
    return c.length ? c : [NOT_REPORTED];
  });
  return { field, bars: countBy(lists), total: papers.length };
}

// ---- scales -----------------------------------------------------------------

/** A step of 1, 2 or 5 × 10ⁿ that gives about `n` intervals over `span`. */
function niceStep(span, n) {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Integer count ticks from 0 to at least `max`. */
function countTicks(max) {
  const step = Math.max(1, Math.round(niceStep(Math.max(1, max), 4)));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, ticks };
}

const fmt = v => {
  const a = Math.abs(v);
  const d = a === 0 || a >= 100 || Number.isInteger(v) ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3;
  return Number(v.toFixed(d)).toString();
};

/**
 * Histogram bins for a numeric column: Sturges' number of bins, widened to a
 * 1-2-5 step so the edges are round numbers a reader can quote. Bins are
 * closed on the left; the last is closed on both sides, so the maximum counts.
 */
export function histogramBins(values, { bins } = {}) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return [];
  const min = xs[0], max = xs[xs.length - 1];
  if (min === max) return [{ lo: min, hi: max, count: xs.length }];
  const k = bins || Math.ceil(Math.log2(xs.length) + 1);
  const w = niceStep(max - min, k);
  const start = Math.floor(min / w) * w;
  const n = Math.max(1, Math.ceil((max - start) / w - 1e-9));
  // Edges rounded to the step's precision, so 0.1 + 0.2 prints as 0.3.
  const r = v => Number(v.toPrecision(12));
  const out = [];
  for (let i = 0; i < n; i++) out.push({ lo: r(start + i * w), hi: r(start + (i + 1) * w), count: 0 });
  for (const x of xs) out[Math.min(n - 1, Math.floor((x - start) / w + 1e-9))].count++;
  return out;
}

// ---- drawing ----------------------------------------------------------------

function clip(text, maxW, fs = FS) {
  const t = String(text);
  if (textWidth(t, fs) <= maxW) return t;
  let s = t;
  while (s.length > 1 && textWidth(s + '…', fs) > maxW) s = s.slice(0, -1);
  return s + '…';
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" role="img" aria-label="${esc(title)}" font-family="${FONT}" font-size="${FS}"><title>${esc(title)}</title><rect class="c-bg" width="100%" height="100%" fill="#fff"/>${body}</svg>`;

/**
 * Vertical bars over an ordered axis (years, histogram bins). `bars` are
 * `{ label, count }`; labels are thinned to fit, never overlapped.
 * `edges` draws numeric bin edges under the bar boundaries instead of labels.
 */
export function columnChart(bars, opts = {}) {
  // With a style the house drawing (one column renderer for every column chart); without, today's figure byte for byte.
  if (opts.style) return houseColumn(bars.map(b => ({ label: b.label, value: b.count, title: b.title })), { yLabel: 'Studies', ...opts });
  const { width = 480, height = 220, title = '', xLabel = '', yLabel = 'Studies', edges = null, note = '', flush = false } = opts;
  // flush: on screen the plot runs edge to edge, level with the text above it.
  const PAD = flush ? 0 : 12, AXW = yLabel ? 34 : flush ? 0 : 8, TOP = edges ? 10 : 18, BOTTOM = (xLabel ? 38 : 24) + (note ? 16 : 0);
  const w = Math.max(240, width), h = Math.max(140, height);
  const plotW = w - PAD * 2 - AXW, plotH = h - TOP - BOTTOM;
  const x0 = PAD + AXW, y0 = TOP + plotH;
  const max = Math.max(0, ...bars.map(b => b.count));
  const { top, ticks } = countTicks(max);
  const bw = bars.length ? plotW / bars.length : plotW;
  const gap = edges || bw <= 6 ? 0 : Math.max(Math.min(4, bw * 0.2), bw - 28);
  const Y = v => y0 - plotH * v / top;
  const parts = [];
  const labelled = !edges && bw - gap >= 14 && bars.length <= 40;
  for (const t of (labelled ? [0] : ticks)) parts.push(`<line x1="${x0}" y1="${f1(Y(t))}" x2="${x0 + plotW}" y2="${f1(Y(t))}" stroke="${t ? GRID : AXIS}" class="${t ? 'c-grid' : 'c-axis'}"/>`,
    labelled ? '' : `<text class="c-mute" x="${x0 - 6}" y="${f1(Y(t) + 4)}" text-anchor="end" fill="${AXIS}">${t}</text>`);
  bars.forEach((b, i) => {
    if (!b.count) return;
    const x = x0 + i * bw + gap / 2, y = Y(b.count);
    // Histogram bars touch, so a white edge keeps neighbours of equal height apart.
    // Counts over years: the count is written on the bar when there is room, so the reader needs no axis.
    if (labelled) parts.push(`<text data-chart-mark="${esc(b.label)}" class="c-mute" x="${f1(x + (bw - gap) / 2)}" y="${f1(y - 4)}" text-anchor="middle" fill="${AXIS}">${b.count}</text>`);
    parts.push(`<rect data-chart-mark="${esc(b.label)}" x="${f1(x)}" y="${f1(y)}" width="${f1(Math.max(1, bw - gap))}" height="${f1(y0 - y)}" class="c-bar" fill="${BAR}"${edges ? ' stroke="#fff"' : ''}><title>${esc(b.title || b.label)}: ${b.count}</title></rect>`);
  });
  if (edges) {
    const labels = edges.map(fmt), widest = Math.max(...labels.map(l => textWidth(l, FS))) + 8;
    const every = Math.max(1, Math.ceil(widest / bw));
    labels.forEach((l, i) => { if (i % every === 0) parts.push(`<text x="${f1(x0 + i * bw)}" y="${y0 + 16}" text-anchor="middle" class="c-ink" fill="${INK}">${esc(l)}</text>`); });
  } else {
    const widest = Math.max(0, ...bars.map(b => textWidth(b.label, FS))) + 8;
    const every = Math.max(1, Math.ceil(widest / bw));
    // A label at the plot's edge is anchored to that edge rather than cut.
    bars.forEach((b, i) => {
      if (i % every) return;
      const cx = x0 + i * bw + bw / 2, half = textWidth(b.label, FS) / 2;
      const [x, anchor] = cx - half < 0 ? [0, 'start'] : cx + half > w ? [w, 'end'] : [cx, 'middle'];
      parts.push(`<text data-chart-mark="${esc(b.label)}" x="${f1(x)}" y="${y0 + 16}" text-anchor="${anchor}" class="c-ink" fill="${INK}">${esc(b.label)}</text>`);
    });
  }
  if (xLabel) parts.push(`<text x="${f1(x0 + plotW / 2)}" y="${y0 + 32}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (yLabel) parts.push(`<text transform="translate(${PAD + 2},${f1(TOP + plotH / 2)}) rotate(-90)" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(yLabel)}</text>`);
  if (note) parts.push(`<text x="${x0}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
  return svg(w, h, parts.join(''), title || yLabel);
}

/**
 * Horizontal bars, one per category, with the count written after each bar.
 * The label column takes what the longest label needs, up to a share of the
 * width, and clips beyond it (the full label stays in the tooltip).
 */
export function barChart(bars, opts = {}) {
  if (opts.style) return houseBarChart(bars, opts);
  const { width = 480, title = '', xLabel = 'Studies', note = '', max: maxRows = 25, offset = 0, paged = false, flush = false } = opts;
  const PAD = flush ? 0 : 12, ROW = 22, TOP = 8, AXIS_H = 34 + (note ? 16 : 0);
  // A category starts with a capital, as every label in the app does.
  bars = bars.map(b => ({ ...b, label: b.label.charAt(0).toUpperCase() + b.label.slice(1) }));
  // Paged, the caller shows the pager and every page keeps one scale.
  const shown = bars.slice(offset, offset + maxRows), hidden = paged ? 0 : bars.length - shown.length;
  const w = Math.max(260, width);
  const labelW = Math.min(Math.round(w * 0.42), Math.max(60, ...shown.map(b => textWidth(b.label, FS) + 12)));
  const countW = 32;
  const plotW = w - PAD * 2 - labelW - countW;
  const x0 = PAD + labelW;
  const h = TOP + shown.length * ROW + AXIS_H + (hidden ? 16 : 0);
  const max = Math.max(0, ...(paged ? bars : shown).map(b => b.count));
  const { top, ticks } = countTicks(max);
  const X = v => x0 + plotW * v / top;
  const y1 = TOP + shown.length * ROW;
  const parts = [];
  for (const t of ticks) parts.push(`<line x1="${f1(X(t))}" y1="${TOP}" x2="${f1(X(t))}" y2="${y1}" stroke="${t ? GRID : AXIS}" class="${t ? 'c-grid' : 'c-axis'}"/>`,
    `<text class="c-mute" x="${f1(X(t))}" y="${y1 + 15}" text-anchor="middle" fill="${AXIS}">${t}</text>`);
  shown.forEach((b, i) => {
    const y = TOP + i * ROW;
    parts.push(`<text data-chart-mark="${esc(b.label)}" x="${x0 - 8}" y="${y + ROW / 2 + 4}" text-anchor="end" class="${b.label === NOT_REPORTED ? 'c-mute' : 'c-ink'}" fill="${b.label === NOT_REPORTED ? AXIS : INK}">${esc(clip(b.label, labelW - 12))}<title>${esc(b.label)}</title></text>`);
    if (b.count) parts.push(`<rect data-chart-mark="${esc(b.label)}" x="${x0}" y="${y + 4}" width="${f1(Math.max(1, X(b.count) - x0))}" height="${ROW - 8}" class="c-bar" fill="${BAR}"><title>${esc(b.label)}: ${b.count}</title></rect>`);
    parts.push(`<text data-chart-mark="${esc(b.label)}" class="c-ink" x="${f1(X(b.count) + 5)}" y="${y + ROW / 2 + 4}" fill="${INK}">${b.count}</text>`);
  });
  let ny = y1 + 30;
  if (xLabel) parts.push(`<text x="${f1(x0 + plotW / 2)}" y="${ny}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (hidden) { ny += 16; parts.push(`<text x="${PAD}" y="${ny}" class="c-mute" fill="${AXIS}">${hidden} more categor${hidden === 1 ? 'y' : 'ies'} not shown</text>`); }
  if (note) parts.push(`<text x="${PAD}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
  return svg(w, h, parts.join(''), title || xLabel);
}

// The house bar chart of counts (FIGURE-STYLE §2): the same rows as barChart, "Not reported" muted and in the
// light fill, the categories a page leaves out said in the source block; paged, every page keeps one scale.
function houseBarChart(bars, { max: maxRows = 25, offset = 0, paged = false, xLabel = 'Studies', note = '', source = [], ...rest }) {
  const all = bars.map(b => ({ ...b, label: b.label.charAt(0).toUpperCase() + b.label.slice(1) }));
  const shown = all.slice(offset, offset + maxRows), hidden = paged ? 0 : all.length - shown.length;
  const rows = shown.map(b => ({ label: b.label, value: b.count, muted: b.label === NOT_REPORTED }));
  return houseBar(rows, { ...rest, xLabel, domain: paged ? [0, ...all.map(b => b.count)] : null,
    source: [note, ...[source].flat(), hidden ? `${hidden} more categor${hidden === 1 ? 'y' : 'ies'} not shown` : ''] });
}

// ---- the charts the views show -------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Included studies per publication year. */
export function publicationsByYear(papers, opts = {}) {
  const { bars, missing } = yearCounts(papers);
  // Kept low, so it sits beside the category chart without dominating the page.
  return columnChart(bars, { title: 'Publications per year', xLabel: '', yLabel: '', height: 160,
    note: missing ? `${plural(missing, 'study', 'studies')} with no year` : '', ...opts });
}

/** Included studies per category of one charted field. */
export function studiesByField(s, field, papers = studies(s), opts = {}) {
  if (field.type !== 'category' && freeText(s, field, papers)) {
    const bars = termGroups(papers.map(p => valueFor(s, p.id, field) || ''));
    return barChart(bars, { title: `Studies by ${field.label.toLowerCase()}`, xLabel: 'Studies',
      note: 'Grouped by recurring terms; a study counts under each term it mentions', ...opts });
  }
  const { bars } = categoryCounts(s, field, papers);
  const multi = papers.some(p => splitCategories(valueFor(s, p.id, field)).length > 1);
  return barChart(bars, { title: `Studies by ${field.label.toLowerCase()}`, xLabel: 'Studies',
    note: multi ? 'A study naming several categories is counted under each' : '', ...opts });
}

// ---- patient-level data ---------------------------------------------------------

const present = (rows, id) => rows.map(r => r[id]).filter(v => v != null && String(v).trim() !== '');

/** Whether a patient-level column is summarised as numeric: the same test the descriptives table applies. */
export const isNumericColumn = (col, rows) => descriptiveKind(col, rows) === 'numeric';

/** Patient-level columns worth a chart: those the descriptives table summarises. */
export const chartableColumns = (rows, columns) =>
  baselineColumns(rows, columns).filter(c => present(rows, c.id).length);

/**
 * The distribution of one patient-level column: a histogram when numeric, a
 * bar per level otherwise (in the column's own level order when it has one).
 * Missing values are counted in a note, not drawn.
 */
export function patientColumnChart(rows, col, opts = {}) {
  const read = descriptiveConverter(col, rows), vals = rows.map(row => read(row[col.id])).filter(value => value != null);
  const missing = rows.length - vals.length;
  const miss = missing ? `${plural(missing, 'patient', 'patients')} missing` : '';
  if (isNumericColumn(col, rows)) {
    const xs = vals.map(Number).filter(Number.isFinite);
    if (!xs.length) return columnChart([], { title: col.name || col.label || col.id, note: 'No valid numeric observations', ...opts });
    const bins = histogramBins(xs);
    const bars = bins.map(b => ({ label: `${fmt(b.lo)}–${fmt(b.hi)}`, count: b.count }));
    const edges = bins.length === 1 && bins[0].lo === bins[0].hi ? null : [...bins.map(b => b.lo), bins.at(-1).hi];
    return columnChart(edges ? bars : [{ label: fmt(bins[0].lo), count: bins[0].count }],
      { title: col.name, xLabel: col.name, yLabel: 'Patients', edges, note: miss, ...opts });
  }
  const lists = vals.map(v => [String(v).trim()]).filter(l => l[0]);
  let bars = countBy(lists);
  if (col.levels?.length) {
    const order = new Map(col.levels.map((l, i) => [l.toLowerCase(), i]));
    bars = bars.slice().sort((a, b) => (order.get(a.label.toLowerCase()) ?? 1e6) - (order.get(b.label.toLowerCase()) ?? 1e6));
  }
  return barChart(bars, { title: col.name, xLabel: 'Patients', note: miss, ...opts });
}

/** The house drawings app/lint-figures.mjs checks: the counts by a characteristic (Not reported, a long label) and a histogram. */
export const __fixture = style => [
  { name: 'barChart', svg: barChart([{ label: 'Retrospective cohort study', count: 16 }, { label: 'Non-randomized intervention study with historical controls', count: 8 }, { label: NOT_REPORTED, count: 8 }], { style, source: ['65 included studies'] }) },
  { name: 'columnChart', svg: columnChart([{ label: '10', count: 3 }, { label: '15', count: 6 }, { label: '20', count: 2 }], { style, edges: [10, 15, 20, 25], xLabel: 'Age', yLabel: 'Patients' }) },
];
