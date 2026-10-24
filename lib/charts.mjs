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
import { readableLabel } from './label-text.mjs';

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
export const tableFields = s => (s.templates || []).flatMap(t => (t.columns || []).map(c => ({ id: c.id, label: `${readableLabel(c.name || c.label || c.id)} (${t.name})`, type: ['category','number','integer'].includes(c.type) ? c.type : 'text' })));
export const chartableFields = (s, papers = studies(s)) => ((s.templates || []).some(t => t?.source?.file) ? [...tableFields(s), ...fields(s)] : [...fields(s), ...tableFields(s)]).filter(f => {
  if (f.analysis || !['text','category','number','integer'].includes(f.type) || /^(?:id|study|study id|reference|doi|pmid)(?: ·| \(|$)/i.test(f.label)) return false;
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
// a bar that knows its records (`ids`) opens them on a press (lib/chart-interact.mjs); every bar shows its value on hover through its <title>
// the records behind a mark go with it on screen only: a figure saved to a file carries no record ids
const onScreen = (b, style) => (b.ids?.length && style?.medium === 'screen' ? { ids: b.ids } : {});
const opensIds = b => (b.ids?.length ? ` data-chart-ids="${esc(b.ids.join(' '))}" data-chart-label="${esc(`${b.title || b.label}: ${b.count}`)}" tabindex="0"` : '');
export function columnChart(bars, opts = {}) {
  // With a style the house drawing (one column renderer for every column chart); without, today's figure byte for byte.
  if (opts.style) return houseColumn(bars.map(b => ({ label: b.label, value: b.count, title: b.title, ...onScreen(b, opts.style) })), { yLabel: 'Studies', ...opts });
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
    parts.push(`<rect data-chart-mark="${esc(b.label)}"${opensIds(b)} x="${f1(x)}" y="${f1(y)}" width="${f1(Math.max(1, bw - gap))}" height="${f1(y0 - y)}" class="c-bar" fill="${BAR}"${edges ? ' stroke="#fff"' : ''}><title>${esc(b.title || b.label)}: ${b.count}</title></rect>`);
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
    if (b.count) parts.push(`<rect data-chart-mark="${esc(b.label)}"${opensIds(b)} x="${x0}" y="${y + 4}" width="${f1(Math.max(1, X(b.count) - x0))}" height="${ROW - 8}" class="c-bar" fill="${BAR}"><title>${esc(b.label)}: ${b.count}</title></rect>`);
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
  const rows = shown.map(b => ({ label: b.label, value: b.count, muted: b.label === NOT_REPORTED, ...onScreen(b, rest.style) }));
  return houseBar(rows, { ...rest, xLabel, domain: paged ? [0, ...all.map(b => b.count)] : null,
    source: [note, ...[source].flat(), hidden ? `${hidden} more categor${hidden === 1 ? 'y' : 'ies'} not shown` : ''] });
}

// ---- measures and shares (the data summary, views/extraction-summary.mjs) ----------------------------------------
// owner, 2026-10-22: "you may use pie charts or other types of charts as well there when applicable". Each mark takes the caller's
// `attrs` (the summary's drill id, so a press opens its studies) and says its value in its <title>.
const attrsOf = a => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
const fmtN = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

/** Before and after, one line per study: `rows` [{ label, from, to, attrs }], the median as the heavier line. */
export function slopeChart(rows, { width = 480, unit = '', title = 'Before and after', before = 'Before', after = 'After' } = {}) {
  const u = v => `${fmtN(v)}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`;
  const w = Math.max(320, width), h = 210, TOP = 14, BOT = 34, xL = 64, xR = w - 110;
  const all = rows.flatMap(r => [r.from, r.to]), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const Y = v => TOP + (h - TOP - BOT) * (1 - (v - lo) / span);
  const med = xs => { const t = [...xs].sort((a, b) => a - b), m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
  const parts = [`<line x1="${xL}" y1="${TOP}" x2="${xL}" y2="${h - BOT}" stroke="${AXIS}" class="c-axis"/>`, `<line x1="${xR}" y1="${TOP}" x2="${xR}" y2="${h - BOT}" stroke="${AXIS}" class="c-axis"/>`,
    `<text class="c-mute" x="${xL}" y="${h - 8}" text-anchor="middle" fill="${AXIS}">${esc(before)}</text>`, `<text class="c-mute" x="${xR}" y="${h - 8}" text-anchor="middle" fill="${AXIS}">${esc(after)}</text>`,
    `<text class="c-mute" x="${xL - 8}" y="${f1(Y(hi) + 4)}" text-anchor="end" fill="${AXIS}">${esc(u(hi))}</text>`, `<text class="c-mute" x="${xL - 8}" y="${f1(Y(lo))}" text-anchor="end" fill="${AXIS}">${esc(u(lo))}</text>`];
  rows.forEach((r, i) => parts.push(`<g data-chart-mark="s${i}"${attrsOf(r.attrs)} class="c-slope"><title>${esc(`${r.label}: ${u(r.from)} → ${u(r.to)}`)}</title><line x1="${xL}" y1="${f1(Y(r.from))}" x2="${xR}" y2="${f1(Y(r.to))}" stroke="${BAR}" stroke-width="1.5"/><circle cx="${xL}" cy="${f1(Y(r.from))}" r="3" fill="${BAR}"/><circle cx="${xR}" cy="${f1(Y(r.to))}" r="3" fill="${BAR}"/></g>`));
  if (rows.length > 1) { const a = med(rows.map(r => r.from)), b = med(rows.map(r => r.to));
    parts.push(`<g class="c-slope-median"><title>${esc(`Median: ${u(a)} → ${u(b)}`)}</title><line x1="${xL}" y1="${f1(Y(a))}" x2="${xR}" y2="${f1(Y(b))}" stroke="${INK}" stroke-width="2.5"/><text x="${xR + 8}" y="${f1(Y(b) + 4)}" fill="${INK}" class="c-ink">${esc(`median ${u(b)}`)}</text></g>`); }
  return svg(w, h, parts.join(''), title);
}

/** Events per study as a share: `rows` [{ label, n, N, attrs }], a bar each with "n/N (p%)" after it, highest first. */
export function rateChart(rows, { width = 480, title = 'Events' } = {}) {
  const shown = [...rows].sort((a, b) => b.n / b.N - a.n / a.N), ROW = 22, TOP = 6, w = Math.max(280, width);
  const labelW = Math.min(Math.round(w * 0.36), Math.max(60, ...shown.map(r => textWidth(r.label, FS) + 12))), textW = 96, plotW = w - labelW - textW, x0 = labelW;
  const top = Math.max(0.01, ...shown.map(r => r.n / r.N)), h = TOP + shown.length * ROW + 6, parts = [];
  shown.forEach((r, i) => { const y = TOP + i * ROW, p = r.n / r.N, t = `${r.n}/${r.N} (${fmtN(100 * p)}%)`;
    parts.push(`<text x="${x0 - 8}" y="${y + ROW / 2 + 4}" text-anchor="end" class="c-ink" fill="${INK}">${esc(clip(r.label, labelW - 12))}</text>`,
      `<rect data-chart-mark="r${i}"${attrsOf(r.attrs)} x="${x0}" y="${y + 5}" width="${f1(Math.max(1, plotW * p / top))}" height="${ROW - 10}" class="c-bar" fill="${BAR}"><title>${esc(`${r.label}: ${t}`)}</title></rect>`,
      `<text x="${f1(x0 + plotW * p / top + 6)}" y="${y + ROW / 2 + 4}" class="c-mute" fill="${AXIS}">${esc(t)}</text>`); });
  return svg(w, h, parts.join(''), title);
}

/** An analysis's subgroups as a small forest: `levels` [{ label, est, lo, hi, k, on }], a proportion each, the level asked about (`on`) in ink. */
export function subgroupChart(levels, { width = 480, title = 'Subgroups' } = {}) {
  const ROW = 22, TOP = 6, w = Math.max(300, width), shown = levels.filter(l => Number.isFinite(l.est));
  const labelW = Math.min(Math.round(w * 0.3), Math.max(60, ...shown.map(l => textWidth(l.label, FS) + 12))), textW = 150, plotW = w - labelW - textW - 8, x0 = labelW;
  const top = Math.min(1, Math.max(0.05, ...shown.map(l => l.hi ?? l.est)) * 1.05), X = v => x0 + plotW * Math.max(0, Math.min(v, top)) / top, h = TOP + shown.length * ROW + 18;
  const parts = [`<line x1="${x0}" y1="${TOP}" x2="${x0}" y2="${h - 18}" stroke="${AXIS}" class="c-axis"/>`, `<text class="c-mute" x="${x0}" y="${h - 4}" text-anchor="middle" fill="${AXIS}">0%</text>`,
    `<text class="c-mute" x="${f1(x0 + plotW)}" y="${h - 4}" text-anchor="middle" fill="${AXIS}">${fmtN(100 * top)}%</text>`];
  shown.forEach((l, i) => { const y = TOP + i * ROW + ROW / 2, cls = l.on ? 'c-ink' : 'c-mute', t = `${fmtN(100 * l.est)}% (${fmtN(100 * l.lo)} to ${fmtN(100 * l.hi)})`;
    parts.push(`<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" class="${cls}" fill="${l.on ? INK : AXIS}"${l.on ? ' font-weight="600"' : ''}>${esc(clip(l.label, labelW - 12))}</text>`,
      `<g data-chart-mark="g${i}" class="${l.on ? 'c-sub-on' : 'c-sub'}"><title>${esc(`${l.label}: ${t}, ${l.k} ${l.k === 1 ? 'estimate' : 'estimates'}`)}</title><line x1="${f1(X(l.lo))}" y1="${y}" x2="${f1(X(l.hi))}" y2="${y}" stroke="${l.on ? INK : BAR}" stroke-width="1.5"/><rect x="${f1(X(l.est) - 4)}" y="${y - 4}" width="8" height="8" fill="${l.on ? INK : BAR}"/></g>`,
      `<text x="${f1(x0 + plotW + 10)}" y="${y + 4}" class="${cls}" fill="${l.on ? INK : AXIS}">${esc(t)}</text>`); });
  return svg(w, h, parts.join(''), title);
}

/** A swimmer: one lane per study, as long as its value (follow-up, duration), longest first, the value at its end. `rows` [{ label, value }]. */
export function swimmerChart(rows, { width = 520, unit = '', title = 'Swimmer', groups = [], bands = false } = {}) {
  // groups: the lanes' levels in order, each a hue (c-cat0…4) and a legend line; bands: the rows stand under their group's head (the rows come sorted by group)
  const ROW = 18, TOP = 6, w = Math.max(300, width), labelW = Math.min(Math.round(w * 0.3), Math.max(60, ...rows.map(r => textWidth(r.label, FS) + 12), ...(bands ? groups.map(g => textWidth(g, FS) + 12) : [])));
  const plotW = w - labelW - 70, x0 = labelW, top = Math.max(1, ...rows.map(r => r.value), ...rows.flatMap(r => (r.marks || []).map(m => m.at)));
  const units = bands ? groups.flatMap(g => { const mine = rows.filter(r => r.group === g); return mine.length ? [{ band: g }, ...mine] : []; }) : rows;
  const legendH = groups.length && !bands ? 20 : 0, h = TOP + legendH + units.length * ROW + 22;
  const ticks = countTicks(top).ticks, X = v => x0 + plotW * v / countTicks(top).top, hue = g => (groups.length ? ` c-cat${Math.min(4, Math.max(0, groups.indexOf(g)))}` : '');
  const parts = ticks.map(t => `<line x1="${f1(X(t))}" y1="${TOP + legendH}" x2="${f1(X(t))}" y2="${h - 22}" stroke="${t ? GRID : AXIS}" class="${t ? 'c-grid' : 'c-axis'}"/><text class="c-mute" x="${f1(X(t))}" y="${h - 6}" text-anchor="middle" fill="${AXIS}">${t}</text>`);
  if (legendH) { let x = x0; groups.forEach((g, i) => { const t = clip(g, 140); parts.push(`<rect x="${x}" y="${TOP + 2}" width="10" height="10" rx="2" fill="${BAR}" class="c-cat${Math.min(4, i)}"/><text x="${x + 14}" y="${TOP + 11}" class="c-mute" fill="${AXIS}">${esc(t)}</text>`); x += textWidth(t, FS) + 26; }); }
  units.forEach((r, i) => { const y = TOP + legendH + i * ROW;
    if (r.band != null) { parts.push(`<text x="0" y="${y + ROW / 2 + 4}" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(r.band, labelW - 4))}</text>`); return; }
    const t = r.text || `${fmtN(r.value)}${unit ? ` ${unit}` : ''}`;
    parts.push(`<text x="${x0 - 8}" y="${y + ROW / 2 + 4}" text-anchor="end" class="c-ink" fill="${INK}">${esc(clip(r.label, labelW - 12))}</text>`,
      `<rect data-chart-mark="w${i}"${attrsOf(r.attrs)} x="${x0}" y="${y + 4}" width="${f1(Math.max(1, X(r.value) - x0))}" height="${ROW - 8}" rx="3" class="c-bar${hue(r.group)}" fill="${BAR}"><title>${esc(`${r.label}: ${t}${r.group ? `, ${r.group}` : ''}`)}</title></rect>`,
      `<circle cx="${f1(X(r.value))}" cy="${y + ROW / 2}" r="3.5" class="c-swim-end" fill="${INK}"/>`,
      ...(r.marks || []).map(m => `<path d="M ${f1(X(m.at))} ${y + 2} l 5 ${ROW / 2 - 2} l -5 ${ROW / 2 - 2} l -5 ${-(ROW / 2 - 2)} Z" class="c-swim-mark" fill="${INK}"><title>${esc(`${r.label}: ${m.text}`)}</title></path>`),
      `<text x="${f1(X(r.value) + 8)}" y="${y + ROW / 2 + 4}" class="c-mute" fill="${AXIS}">${esc(t)}</text>`); });
  return svg(w, h, parts.join(''), title);
}

/** Shares of a whole, two to five parts: `slices` [{ label, n, attrs }] as a ring in neutral shades, the legend beside it. */
export function donutChart(slices, { width = 360, size = 56, title = 'Shares' } = {}) {
  const SHADES = ['#3a3a3a', '#6e6e6e', '#9c9c9c', '#c3c3c3', '#e0e0e0'], total = slices.reduce((a, x) => a + x.n, 0) || 1, shown = slices.slice(0, 5);
  const R = size, r = Math.round(size * 0.6), cx = R + 4, cy = R + 4, parts = []; let a0 = -Math.PI / 2;
  // the legend beside the ring: a swatch, the label, then its count and share right after the longest label
  const lx = 2 * R + 24, labelW = Math.min(Math.max(...shown.map(x => textWidth(x.label, FS))), Math.max(80, width - lx - 110)), vx = lx + 16 + labelW + 16;
  const w = vx + 72, top = cy - shown.length * 11;
  const pt = (rad, a) => `${f1(cx + rad * Math.cos(a))} ${f1(cy + rad * Math.sin(a))}`;
  shown.forEach((x, i) => {
    const a1 = a0 + 2 * Math.PI * x.n / total, big = a1 - a0 > Math.PI ? 1 : 0, pct = Math.round(100 * x.n / total);
    const d = x.n === total ? `M ${pt(R, -Math.PI / 2)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI * 1.5 - 0.0001)} L ${pt(r, Math.PI * 1.5 - 0.0001)} A ${r} ${r} 0 1 0 ${pt(r, -Math.PI / 2)} Z`
      : `M ${pt(R, a0)} A ${R} ${R} 0 ${big} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${big} 0 ${pt(r, a0)} Z`;
    parts.push(`<path data-chart-mark="d${i}"${attrsOf(x.attrs)} d="${d}" fill="${SHADES[i]}" stroke="#fff" stroke-width="1" class="c-slice c-cat${i}"><title>${esc(`${x.label}: ${x.n} (${pct}%)`)}</title></path>`,
      `<rect x="${lx}" y="${top + i * 22}" width="10" height="10" rx="2" fill="${SHADES[i]}" class="c-cat${i}"/><text x="${lx + 16}" y="${top + 9 + i * 22}" class="c-ink" fill="${INK}">${esc(clip(x.label, labelW))}</text>`,
      `<text x="${vx}" y="${top + 9 + i * 22}" class="c-mute" fill="${AXIS}">${x.n} (${pct}%)</text>`);
    a0 = a1;
  });
  return svg(Math.min(width, w), 2 * R + 8, parts.join(''), title);
}

/**
 * An effect direction plot (synthesis without meta-analysis): one row per study under its group's band, the direction as a mark in a narrow
 * column (▲ benefit, ▼ harm, ◄► no clear) sized by the study's sample size when sizes are known, then the value it was read from and n,
 * both right-aligned in tabular figures. `rows` [{ label, group, direction, value, n, attrs }] in drawing order; `groups` the bands in order
 * (none: no bands); `columns` the value head and the n head; without any n the n column is left out and every mark is one size.
 */
export function directionChart(rows, { width = 520, title = 'Effect direction', groups = [], columns = ['Value', 'n'] } = {}) {
  const ROW = 22, HEAD = 22, TOP = 4, w = Math.max(320, width), sized = rows.some(r => r.n > 0), nMax = Math.max(1, ...rows.map(r => r.n || 0));
  const labelW = Math.min(Math.round(w * 0.4), Math.max(72, ...rows.map(r => textWidth(r.label, FS) + 12), ...groups.map(g => textWidth(g, FS) + 12)));
  const markW = 64, nW = sized ? Math.max(28, textWidth(columns[1], FS) + 8, ...rows.map(r => textWidth(String(r.n ?? ''), FS) + 8)) : 0;
  const valueW = Math.max(textWidth(columns[0], FS) + 8, ...rows.map(r => textWidth(String(r.value ?? ''), FS) + 8));
  const markX = labelW + markW / 2, valueX = labelW + markW + 16 + valueW, nX = sized ? valueX + 16 + nW : valueX;
  const units = groups.length ? groups.flatMap(g => [{ band: g }, ...rows.filter(r => r.group === g)]) : rows;
  const h = TOP + HEAD + units.length * ROW + 6, parts = [];
  parts.push(`<line x1="0" y1="${TOP + HEAD - 4}" x2="${w}" y2="${TOP + HEAD - 4}" stroke="${AXIS}" class="c-axis"/>`,
    `<text x="0" y="${TOP + 12}" class="c-ink c-colhead" fill="${INK}" font-weight="600">Study</text>`, `<text x="${markX}" y="${TOP + 12}" text-anchor="middle" class="c-ink c-colhead" fill="${INK}" font-weight="600">Direction</text>`,
    `<text x="${valueX}" y="${TOP + 12}" text-anchor="end" class="c-ink c-colhead" fill="${INK}" font-weight="600">${esc(columns[0])}</text>`,
    sized ? `<text x="${nX}" y="${TOP + 12}" text-anchor="end" class="c-ink c-colhead" fill="${INK}" font-weight="600">${esc(columns[1])}</text>` : '');
  const mark = (d, cx, cy, r) => d === 'benefit' ? `<path d="M ${f1(cx)} ${f1(cy - r)} L ${f1(cx + r)} ${f1(cy + r * 0.8)} L ${f1(cx - r)} ${f1(cy + r * 0.8)} Z"/>`
    : d === 'harm' ? `<path d="M ${f1(cx)} ${f1(cy + r)} L ${f1(cx + r)} ${f1(cy - r * 0.8)} L ${f1(cx - r)} ${f1(cy - r * 0.8)} Z"/>`
    : `<path d="M ${f1(cx - r - 2)} ${f1(cy)} L ${f1(cx - 2)} ${f1(cy - r * 0.7)} L ${f1(cx - 2)} ${f1(cy + r * 0.7)} Z M ${f1(cx + r + 2)} ${f1(cy)} L ${f1(cx + 2)} ${f1(cy - r * 0.7)} L ${f1(cx + 2)} ${f1(cy + r * 0.7)} Z"/>`;
  units.forEach((u, i) => {
    const y = TOP + HEAD + i * ROW;
    if (u.band != null) { parts.push(`<rect x="0" y="${y}" width="${w}" height="${ROW}" class="c-band" fill="${GRID}"/>`, `<text x="4" y="${y + ROW / 2 + 4}" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(u.band, w - 8))}</text>`); return; }
    const r = sized && u.n > 0 ? 4 + 5 * Math.sqrt(u.n / nMax) : 6, d = u.direction === 'benefit' || u.direction === 'harm' ? u.direction : 'no clear';
    const tip = `${u.label}: ${u.value ?? ''}${u.n ? `, n ${u.n}` : ''}`;
    parts.push(`<g data-chart-mark="e${i}"${attrsOf(u.attrs)} class="c-dir c-dir-${d.replace(' ', '-')}"><title>${esc(tip)}</title>`,
      `<rect x="0" y="${y}" width="${w}" height="${ROW}" class="c-lane" fill="transparent"/>`,
      `<text x="0" y="${y + ROW / 2 + 4}" class="c-ink" fill="${INK}">${esc(clip(u.label, labelW - 8))}</text>`, mark(d, markX, y + ROW / 2, r),
      `<text x="${valueX}" y="${y + ROW / 2 + 4}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(String(u.value ?? ''))}</text>`,
      sized ? `<text x="${nX}" y="${y + ROW / 2 + 4}" text-anchor="end" class="c-mute" fill="${AXIS}">${u.n ?? ''}</text>` : '', '</g>');
  });
  return svg(w, h, parts.join(''), title);
}

/**
 * Points on two numbers, each a study: `points` [{ x, y, label, weight (0 to 1, sizes the mark), attrs, text }]; a fitted `line` ({ at(x), band(x)
 * → [lo, hi], from, to }) drawn through them with its band (a meta-regression's bubble plot: the band is the line's 95% interval); `yTicks`
 * labels the y axis through `fmtY`. Hover names the study and its values; a press opens it through `attrs`.
 */
export function scatterChart(points, { width = 520, height = 260, title = 'Scatter', xLabel = '', yLabel = '', line = null, fmtY = fmtN, fmtX = fmtN, yDomain = null } = {}) {
  const w = Math.max(280, width), h = Math.max(180, height), R = 16, T = 12, B = xLabel ? 48 : 28;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  if (!xs.length) return svg(w, h, '', title);
  const xr = extent(xs), yr = yDomain ? { lo: yDomain[0], hi: yDomain[1] } : extent([...ys, ...(line ? [line.band(line.from)[0], line.band(line.to)[1], line.band(line.from)[1], line.band(line.to)[0]] : [])]);
  const L = (yLabel ? 22 : 8) + Math.max(...ticksOf(yr.lo, yr.hi, 5).map(t => textWidth(fmtY(t), FS))) + 10;   // room for the widest tick and the axis name
  const X = v => L + (w - L - R) * (v - xr.lo) / (xr.hi - xr.lo || 1), Y = v => T + (h - T - B) * (1 - (v - yr.lo) / (yr.hi - yr.lo || 1));
  const parts = [];
  for (const t of ticksOf(yr.lo, yr.hi, 5)) parts.push(`<line x1="${L}" y1="${f1(Y(t))}" x2="${w - R}" y2="${f1(Y(t))}" stroke="${GRID}" class="c-grid"/><text x="${L - 8}" y="${f1(Y(t) + 4)}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(fmtY(t))}</text>`);
  for (const t of thinTicks(ticksOf(xr.lo, xr.hi, 6), X, fmtX)) parts.push(`<text x="${f1(X(t))}" y="${h - B + 16}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(fmtX(t))}</text>`);
  parts.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${h - B}" stroke="${AXIS}" class="c-axis"/><line x1="${L}" y1="${h - B}" x2="${w - R}" y2="${h - B}" stroke="${AXIS}" class="c-axis"/>`);
  if (xLabel) parts.push(`<text x="${f1((L + w - R) / 2)}" y="${h - 6}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (yLabel) parts.push(`<text transform="translate(10 ${f1((T + h - B) / 2)}) rotate(-90)" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(clip(yLabel, h - B - T))}</text>`);
  if (line) {
    const n = 40, xsLine = Array.from({ length: n + 1 }, (_, i) => line.from + (line.to - line.from) * i / n);
    const band = `M ${xsLine.map(x => `${f1(X(x))} ${f1(Y(line.band(x)[0]))}`).join(' L ')} L ${[...xsLine].reverse().map(x => `${f1(X(x))} ${f1(Y(line.band(x)[1]))}`).join(' L ')} Z`;
    parts.push(`<path d="${band}" class="c-band" fill="${GRID}" fill-opacity="0.6"/>`, `<path d="M ${xsLine.map(x => `${f1(X(x))} ${f1(Y(line.at(x)))}`).join(' L ')}" fill="none" stroke="${INK}" stroke-width="1.5" class="c-fit"/>`);
  }
  points.forEach((p, i) => { const r = 3 + 7 * Math.sqrt(Math.max(0, Math.min(1, p.weight ?? 0.3)));
    parts.push(`<circle data-chart-mark="p${i}"${attrsOf(p.attrs)} cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="${f1(r)}" class="c-bubble" fill="${BAR}" fill-opacity="0.7" stroke="${INK}" stroke-width="0.8"><title>${esc(p.text || `${p.label}: ${fmtX(p.x)}, ${fmtY(p.y)}`)}</title></circle>`); });
  return svg(w, h, parts.join(''), title);
}

/**
 * A funnel plot: each study's effect against its standard error (the precise at the top), the pooled line and the 95% pseudo-interval
 * around it. `data` from lib/make-stats.mjs funnelData; `labels` name the points; `show(y)` turns the model scale into the shown one.
 */
export function funnelChart({ points, mu, seMax, left, right }, { width = 480, height = 260, title = 'Funnel plot', xLabel = '', labels = [], show = v => v, fmtX = fmtN, attrsOf: at = () => ({}) } = {}) {
  const w = Math.max(280, width), h = Math.max(180, height), L = 52, R = 16, T = 12, B = xLabel ? 48 : 28;
  const xlo = Math.min(left[0], ...points.map(p => p.y)), xhi = Math.max(right[0], ...points.map(p => p.y));
  const X = v => L + (w - L - R) * (v - xlo) / (xhi - xlo || 1), Y = se => T + (h - T - B) * se / (seMax || 1);
  const parts = [`<path d="M ${f1(X(mu))} ${f1(Y(0))} L ${f1(X(left[0]))} ${f1(Y(left[1]))} L ${f1(X(right[0]))} ${f1(Y(right[1]))} Z" class="c-band" fill="${GRID}" fill-opacity="0.5"/>`,
    `<line x1="${f1(X(mu))}" y1="${T}" x2="${f1(X(mu))}" y2="${h - B}" stroke="${AXIS}" stroke-dasharray="3 3" class="c-axis"/>`];
  for (const t of ticksOf(0, seMax, 4)) parts.push(`<text x="${L - 8}" y="${f1(Y(t) + 4)}" text-anchor="end" class="c-mute" fill="${AXIS}">${fmtN(Math.round(t * 100) / 100)}</text>`);
  for (const t of thinTicks(ticksOf(xlo, xhi, 5), X, v => fmtX(show(v)))) parts.push(`<text x="${f1(X(t))}" y="${h - B + 16}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(fmtX(show(t)))}</text>`);
  parts.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${h - B}" stroke="${AXIS}" class="c-axis"/><line x1="${L}" y1="${h - B}" x2="${w - R}" y2="${h - B}" stroke="${AXIS}" class="c-axis"/>`,
    `<text transform="translate(12 ${f1((T + h - B) / 2)}) rotate(-90)" text-anchor="middle" class="c-mute" fill="${AXIS}">Standard error</text>`);
  if (xLabel) parts.push(`<text x="${f1((L + w - R) / 2)}" y="${h - 6}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  points.forEach((p, i) => parts.push(`<circle data-chart-mark="f${i}"${attrsOf(at(i))} cx="${f1(X(p.y))}" cy="${f1(Y(p.se))}" r="4" class="c-dot" fill="${INK}"><title>${esc(`${labels[i] || `Study ${i + 1}`}: ${fmtX(show(p.y))}, SE ${fmtN(Math.round(p.se * 100) / 100)}`)}</title></circle>`));
  return svg(w, h, parts.join(''), title);
}

/** Ticks thinned until neighbouring labels keep a gap. */
const thinTicks = (ticks, X, fmt) => { let t = ticks; const fits = l => l.every((v, i) => i === 0 || X(v) - X(l[i - 1]) >= (textWidth(fmt(v), FS) + textWidth(fmt(l[i - 1]), FS)) / 2 + 6); while (t.length > 2 && !fits(t)) t = t.filter((_, i) => i % 2 === 0); return t; };
const extent = xs => { const lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo || Math.abs(hi) || 1) * 0.08; return { lo: lo - pad, hi: hi + pad }; };
function ticksOf(lo, hi, n) { const span = hi - lo || 1, raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p, step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; const out = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1e9) / 1e9); return out; }

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
    // a term's ids are positions in the list, not records: the page (views/study-charts.mjs) lists a bar's studies itself
    const bars = termGroups(papers.map(p => valueFor(s, p.id, field) || '')).map(({ ids, ...b }) => b);
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
