// Charts for output specs (lib/output-spec.mjs): bar, column, stacked, dot,
// forest, timeline and heat, drawn as self-contained SVG in the same manner as
// lib/charts.mjs — black text on white, grey marks, Helvetica metrics — so the
// downloaded file is a publication figure, and on screen the c-* classes take
// the app's theme (index.html, "outputs"). Every mark carries data-chart-mark (its
// label) and data-row (its row in the query result) for the hover card.
//
// Input is plain: `rows` of `{ label, value, group?, series?, lo?, hi?, row }`
// prepared by lib/output-render.mjs from the query result.
import { textWidth } from './textwidth.mjs';
import { houseBar, houseColumn, houseStacked, houseDot, houseForest, houseTimeline, houseHeat } from './figure-house-render.mjs';

const FONT = 'Helvetica, Arial, sans-serif';
const FS = 12, ROW = 22, PAD = 12;
const INK = '#000', AXIS = '#555', GRID = '#e3e3e3', BAR = '#8f8f8f';
// Series shades: neutral greys a reader tells apart, dark to light; a legend names them.
export const SHADES = ['#3d3d3d', '#8f8f8f', '#c4c4c4', '#666666', '#b0b0b0', '#e1e1e1'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = x => (Math.round(x * 10) / 10).toString();

export const fmtNumber = v => {
  if (v == null || !Number.isFinite(v)) return '';
  const a = Math.abs(v), d = a === 0 || a >= 100 || Number.isInteger(v) ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(v.toFixed(d)).toString();
};
function clip(text, maxW, fs = FS) {
  const t = String(text ?? '');
  if (textWidth(t, fs) <= maxW) return t;
  let s = t;
  while (s.length > 1 && textWidth(s + '…', fs) > maxW) s = s.slice(0, -1);
  return s + '…';
}
/** Ticks at a 1-2-5 step covering [lo, hi]; `zero` keeps 0 on the axis. */
export function niceTicks(lo, hi, n = 5, { zero = false } = {}) {
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (!(hi > lo)) { hi = lo + 1; if (!zero) lo -= 1; }
  const raw = (hi - lo) / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { lo: a, hi: b, ticks };
}
const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" role="img" aria-label="${esc(title)}" font-family="${FONT}" font-size="${FS}"><title>${esc(title)}</title><rect class="c-bg" width="100%" height="100%" fill="#fff"/>${body}</svg>`;
const tip = (label, value) => `<title>${esc(label)}: ${esc(value)}</title>`;
const mark = r => `data-chart-mark="${esc(r.label)}" data-row="${r.row}"${r.study ? ` data-study="${esc(r.study)}"` : ''}${Object.entries(r.attrs || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('')}`;   // attrs: a view's own hooks on a mark (the Data summary's press that opens the studies)

/** Row labels: the width the longest needs, up to 42% of the figure. */
const labelWidth = (w, labels) => Math.min(Math.round(w * 0.42), Math.max(60, ...labels.map(l => textWidth(String(l), FS) + 12)));

/**
 * The rows a row chart draws on this page, with section headings where the
 * group changes (and at the top of every page).
 */
function lines(rows, { offset = 0, page = Infinity, byLabel = false }) {
  // Several rows sharing a label (a study's arms) share one line.
  const units = [];
  for (const r of rows) {
    const last = units.at(-1);
    if (byLabel && last && last.label === r.label && last.group === r.group) last.rows.push(r);
    else units.push({ label: r.label, group: r.group ?? null, rows: [r] });
  }
  const shown = units.slice(offset, offset + page);
  const out = [];
  let prev;
  for (const [i, u] of shown.entries()) {
    if (u.group != null && (i === 0 || u.group !== prev)) out.push({ heading: u.group });
    out.push(u); prev = u.group;
  }
  return { out, units: units.length };
}

function axisBottom(parts, X, ticks, y, top, fmt = fmtNumber) {
  for (const t of ticks) parts.push(`<line x1="${f1(X(t))}" y1="${top}" x2="${f1(X(t))}" y2="${y}" stroke="${GRID}" class="c-grid"/>`,
    `<text class="c-mute" x="${f1(X(t))}" y="${y + 15}" text-anchor="middle" fill="${AXIS}">${esc(fmt(t))}</text>`);
}
function rowLabel(parts, x, y, label) {
  parts.push(`<text x="${x}" y="${y + ROW / 2 + 4}" text-anchor="end" class="c-ink" fill="${INK}">${esc(clip(label, x - PAD - 4))}<title>${esc(label)}</title></text>`);
}
function heading(parts, y, text, w) {
  parts.push(`<text x="${PAD}" y="${y + ROW / 2 + 5}" font-weight="bold" class="c-ink c-head" fill="${INK}">${esc(clip(text, w - PAD * 2))}</text>`,
    `<line x1="${PAD}" y1="${y + ROW - 1}" x2="${w - PAD}" y2="${y + ROW - 1}" stroke="${GRID}" class="c-grid"/>`);
}
function footer(parts, h, note, xLabel, cx, y) {
  if (xLabel) parts.push(`<text x="${f1(cx)}" y="${y}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (note) parts.push(`<text x="${PAD}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
}

/** Horizontal bars, one per row, the value after each bar; sections by group. */
export function barSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseBar(rows, opts);
  const { width = 640, title = '', xLabel = '', note = '', offset = 0, page = Infinity } = opts;
  const w = Math.max(280, width), { out } = lines(rows, { offset, page });
  const labelW = labelWidth(w, out.filter(u => !u.heading).map(u => u.label));
  const valueW = Math.max(32, ...rows.map(r => textWidth(fmtNumber(r.value), FS) + 10));
  const x0 = PAD + labelW, plotW = w - x0 - PAD - valueW;
  // Bars grow from zero, to the left for a negative value.
  const vals = rows.map(r => r.value ?? 0), { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals) || (Math.min(0, ...vals) ? 0 : 1), 4, { zero: true });
  const X = v => x0 + plotW * (v - lo) / (hi - lo), zeroX = X(0);
  const parts = [], top = 8; let y = top;
  const body = [];
  for (const u of out) {
    if (u.heading != null) { heading(body, y, u.heading, w); y += ROW; continue; }
    const r = u.rows[0];
    rowLabel(body, x0 - 8, y, u.label);
    const end = X(r.value || 0), neg = (r.value || 0) < 0;
    if (r.value) body.push(`<rect ${mark(r)} x="${f1(Math.min(zeroX, end))}" y="${y + 4}" width="${f1(Math.max(1, Math.abs(end - zeroX)))}" height="${ROW - 8}" class="c-bar" fill="${BAR}">${tip(u.label, fmtNumber(r.value))}</rect>`);
    body.push(`<text class="c-ink" x="${f1(neg ? end - 5 : end + 5)}" y="${y + ROW / 2 + 4}"${neg ? ' text-anchor="end"' : ''} fill="${INK}">${esc(r.value == null ? '–' : fmtNumber(r.value))}</text>`);
    y += ROW;
  }
  axisBottom(parts, X, ticks, y, top);
  parts.push(`<line x1="${f1(zeroX)}" y1="${top}" x2="${f1(zeroX)}" y2="${y}" stroke="${AXIS}" class="c-axis"/>`, ...body);
  const h = y + 34 + (xLabel ? 4 : 0) + (note ? 16 : 0);
  footer(parts, h, note, xLabel, x0 + plotW / 2, y + 30);
  return svg(w, h, parts.join(''), title || xLabel);
}

/** Vertical bars over an ordered axis; every label shown, thinned when they would collide. */
export function columnSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseColumn(rows, opts);
  const { width = 640, height = 260, title = '', xLabel = '', yLabel = '', note = '' } = opts;
  const w = Math.max(280, width), h = Math.max(160, height), AXW = 40, TOP = 18, BOTTOM = (xLabel ? 38 : 24) + (note ? 16 : 0);
  const x0 = PAD + AXW, plotW = w - x0 - PAD, plotH = h - TOP - BOTTOM, y0 = TOP + plotH;
  const vals = rows.map(r => r.value ?? 0), { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals) || (Math.min(0, ...vals) ? 0 : 1), 4, { zero: true });
  const Y = v => y0 - plotH * (v - lo) / (hi - lo), bw = rows.length ? plotW / rows.length : plotW, gap = bw <= 6 ? 0 : Math.max(Math.min(4, bw * 0.2), bw - 36);
  const parts = [];
  for (const t of ticks) parts.push(`<line x1="${x0}" y1="${f1(Y(t))}" x2="${x0 + plotW}" y2="${f1(Y(t))}" stroke="${t ? GRID : AXIS}" class="${t ? 'c-grid' : 'c-axis'}"/>`,
    `<text class="c-mute" x="${x0 - 6}" y="${f1(Y(t) + 4)}" text-anchor="end" fill="${AXIS}">${esc(fmtNumber(t))}</text>`);
  rows.forEach((r, i) => {
    if (!r.value) return;
    // A column runs from the zero line, down for a negative value.
    const x = x0 + i * bw + gap / 2, y = Y(r.value), z = Y(0);
    parts.push(`<rect ${mark(r)} x="${f1(x)}" y="${f1(Math.min(y, z))}" width="${f1(Math.max(1, bw - gap))}" height="${f1(Math.abs(z - y))}" class="c-bar" fill="${BAR}">${tip(r.label, fmtNumber(r.value))}</rect>`);
  });
  const widest = Math.max(0, ...rows.map(r => textWidth(String(r.label), FS))) + 8, every = Math.max(1, Math.ceil(widest / bw));
  rows.forEach((r, i) => { if (i % every) return; const cx = x0 + i * bw + bw / 2; parts.push(`<text x="${f1(cx)}" y="${y0 + 16}" text-anchor="middle" class="c-ink" fill="${INK}">${esc(r.label)}</text>`); });
  if (xLabel) parts.push(`<text x="${f1(x0 + plotW / 2)}" y="${y0 + 32}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (yLabel) parts.push(`<text transform="translate(${PAD + 2},${f1(TOP + plotH / 2)}) rotate(-90)" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(yLabel)}</text>`);
  if (note) parts.push(`<text x="${PAD}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
  return svg(w, h, parts.join(''), title || yLabel);
}

function legend(parts, names, y, w) {
  let x = PAD;
  names.forEach((n, i) => {
    const lw = 14 + textWidth(n, FS) + 16;
    if (x + lw > w - PAD && x > PAD) { x = PAD; y += 18; }
    parts.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" class="c-s${i % SHADES.length}" fill="${SHADES[i % SHADES.length]}"/><text x="${x + 14}" y="${y}" class="c-ink" fill="${INK}">${esc(n)}</text>`);
    x += lw;
  });
  return y;
}

/** Horizontal bars split by series, each segment one shade; a legend names the shades. */
export function stackedSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseStacked(rows, opts);
  const { width = 640, title = '', xLabel = '', note = '', offset = 0, page = Infinity } = opts;
  const w = Math.max(320, width);
  const series = [...new Set(rows.map(r => r.series ?? ''))];
  const byLabel = new Map();
  for (const r of rows) { if (!byLabel.has(r.label)) byLabel.set(r.label, []); byLabel.get(r.label).push(r); }
  const labels = [...byLabel.keys()], shown = labels.slice(offset, offset + page);
  const totals = labels.map(l => byLabel.get(l).reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0));
  const labelW = labelWidth(w, shown), valueW = Math.max(32, ...totals.map(t => textWidth(fmtNumber(t), FS) + 10));
  const x0 = PAD + labelW, plotW = w - x0 - PAD - valueW;
  const { ticks, hi } = niceTicks(0, Math.max(1, ...totals), 4, { zero: true }), X = v => x0 + plotW * v / hi;
  const parts = [], top = 8, body = []; let y = top;
  for (const l of shown) {
    rowLabel(body, x0 - 8, y, l);
    let acc = 0;
    for (const r of byLabel.get(l)) {
      // Stacked parts add up to a whole; a negative part has no place in it.
      if (!(r.value > 0)) continue;
      const i = series.indexOf(r.series ?? '');
      body.push(`<rect ${mark(r)} x="${f1(X(acc))}" y="${y + 4}" width="${f1(Math.max(1, X(acc + r.value) - X(acc)))}" height="${ROW - 8}" class="c-s${i % SHADES.length}" fill="${SHADES[i % SHADES.length]}" stroke="#fff">${tip(`${l}, ${r.series ?? ''}`, fmtNumber(r.value))}</rect>`);
      acc += r.value;
    }
    body.push(`<text class="c-ink" x="${f1(X(acc) + 5)}" y="${y + ROW / 2 + 4}" fill="${INK}">${esc(fmtNumber(acc))}</text>`);
    y += ROW;
  }
  axisBottom(parts, X, ticks, y, top);
  parts.push(`<line x1="${x0}" y1="${top}" x2="${x0}" y2="${y}" stroke="${AXIS}" class="c-axis"/>`, ...body);
  let yy = y + 30;
  if (xLabel) { parts.push(`<text x="${f1(x0 + plotW / 2)}" y="${yy}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`); yy += 8; }
  yy = legend(parts, series.map(x => x || 'Not reported'), yy + 16, w);
  const h = yy + 12 + (note ? 16 : 0);
  if (note) parts.push(`<text x="${PAD}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
  return svg(w, h, parts.join(''), title || xLabel);
}

/** One line per label, a dot per row at its value (several rows of a label — a study's arms — share the line); sections by group. */
export function dotSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseDot(rows, opts);
  const { width = 640, title = '', xLabel = '', note = '', offset = 0, page = Infinity, ref = null } = opts;
  const w = Math.max(280, width), { out } = lines(rows, { offset, page, byLabel: true });
  const labelW = labelWidth(w, out.filter(u => !u.heading).map(u => u.label));
  const x0 = PAD + labelW, plotW = w - x0 - PAD - 12;
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const { ticks, lo, hi } = niceTicks(Math.min(ref ?? Infinity, ...vals, 0), Math.max(ref ?? -Infinity, ...vals, 1), 5);
  const X = v => x0 + plotW * (v - lo) / (hi - lo);
  const parts = [], body = [], top = 8; let y = top;
  for (const u of out) {
    if (u.heading != null) { heading(body, y, u.heading, w); y += ROW; continue; }
    rowLabel(body, x0 - 8, y, u.label);
    body.push(`<line x1="${x0}" y1="${y + ROW / 2}" x2="${x0 + plotW}" y2="${y + ROW / 2}" stroke="${GRID}" stroke-dasharray="1 3" class="c-grid"/>`);
    for (const r of u.rows) if (Number.isFinite(r.value))
      body.push(`<circle ${mark(r)} cx="${f1(X(r.value))}" cy="${y + ROW / 2}" r="4.5" class="c-dot" fill="${INK}" fill-opacity="0.75">${tip(r.series ? `${u.label}, ${r.series}` : u.label, fmtNumber(r.value))}</circle>`);
    y += ROW;
  }
  axisBottom(parts, X, ticks, y, top);
  if (ref != null && Number.isFinite(ref)) parts.push(`<line x1="${f1(X(ref))}" y1="${top}" x2="${f1(X(ref))}" y2="${y}" stroke="${AXIS}" class="c-axis"/>`);
  parts.push(...body);
  const h = y + 34 + (note ? 16 : 0);
  footer(parts, h, note, xLabel, x0 + plotW / 2, y + 30);
  return svg(w, h, parts.join(''), title || xLabel);
}

/**
 * Estimates with intervals, one per row, and a reference line (0, or 1 on a
 * log scale). A row with `pooled` is drawn as a diamond with a bold label (a
 * subgroup's estimate); `weight` (0 to 1) sizes a study's square; `study` on a
 * row makes it open that record. `foot` is a row drawn under a rule after the
 * page, on every page: the overall estimate a reader wants beside any page.
 */
export function forestSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseForest(rows, opts);
  const { width = 640, title = '', xLabel = '', note = '', offset = 0, page = Infinity, log = false, ref = null, foot = null } = opts;
  const w = Math.max(320, width), { out } = lines(rows, { offset, page });
  const tr = v => log ? Math.log10(v) : v, back = v => log ? 10 ** v : v;
  const ok = r => [r.value, r.lo, r.hi].every(v => Number.isFinite(v) && (!log || v > 0));
  const text = r => ok(r) ? `${fmtNumber(r.value)} (${fmtNumber(r.lo)} to ${fmtNumber(r.hi)})` : 'not estimable';
  const all = foot ? [...rows, foot] : rows;
  const labelW = labelWidth(w, [...out.filter(u => !u.heading).map(u => u.label), ...(foot ? [foot.label] : [])]);
  const estW = Math.max(90, ...all.map(r => textWidth(text(r), FS) + 12));
  const x0 = PAD + labelW, plotW = w - x0 - PAD - estW;
  const good = all.filter(ok), refV = ref ?? (log ? 1 : 0);
  const lo0 = Math.min(tr(refV), ...good.map(r => tr(r.lo))), hi0 = Math.max(tr(refV), ...good.map(r => tr(r.hi)));
  const { ticks, lo, hi } = log ? { lo: lo0 - 0.05, hi: hi0 + 0.05, ticks: [...new Set([-2, -1, Math.log10(0.5), 0, Math.log10(2), 1, 2].filter(t => t >= lo0 - 0.05 && t <= hi0 + 0.05))] } : niceTicks(lo0, hi0, 5);
  const X = v => x0 + plotW * (tr(v) - lo) / (hi - lo);
  const parts = [], body = [], top = 8; let y = top;
  const drawRow = (r, y) => {
    const cy = y + ROW / 2;
    if (r.pooled) body.push(`<text x="${x0 - 8}" y="${y + ROW / 2 + 4}" text-anchor="end" font-weight="bold" class="c-ink" fill="${INK}">${esc(clip(r.label, x0 - PAD - 4))}<title>${esc(r.label)}</title></text>`);
    else rowLabel(body, x0 - 8, y, r.label);
    if (ok(r)) {
      const open = `<g ${mark(r)}>${tip(r.label, text(r))}`;
      if (r.pooled) body.push(`${open}<polygon points="${f1(X(r.lo))},${cy} ${f1(X(r.value))},${cy - 6} ${f1(X(r.hi))},${cy} ${f1(X(r.value))},${cy + 6}" class="c-dot" fill="${INK}"/></g>`);
      else {
        const half = r.weight != null && Number.isFinite(r.weight) ? 2.5 + 5.5 * Math.sqrt(Math.max(0, Math.min(1, r.weight))) : 4;
        body.push(`${open}<line x1="${f1(X(r.lo))}" y1="${cy}" x2="${f1(X(r.hi))}" y2="${cy}" stroke="${INK}" class="c-line"/><rect x="${f1(X(r.value) - half)}" y="${f1(cy - half)}" width="${f1(2 * half)}" height="${f1(2 * half)}" class="c-dot" fill="${INK}"/></g>`);
      }
    }
    body.push(`<text class="c-ink" x="${w - PAD}" y="${cy + 4}" text-anchor="end"${r.pooled ? ' font-weight="bold"' : ''} fill="${INK}">${esc(text(r))}</text>`);
  };
  for (const u of out) {
    if (u.heading != null) { heading(body, y, u.heading, w); y += ROW; continue; }
    drawRow(u.rows[0], y);
    y += ROW;
  }
  if (foot) {
    body.push(`<line x1="${PAD}" y1="${y + 3}" x2="${w - PAD}" y2="${y + 3}" stroke="${AXIS}" class="c-axis"/>`);
    y += 8; drawRow(foot, y); y += ROW;
  }
  axisBottom(parts, v => x0 + plotW * (v - lo) / (hi - lo), ticks, y, top, v => fmtNumber(back(v)));
  parts.push(`<line x1="${f1(X(refV))}" y1="${top}" x2="${f1(X(refV))}" y2="${y}" stroke="${AXIS}" class="c-axis"/>`, ...body);
  const h = y + 34 + (note ? 16 : 0);
  footer(parts, h, note, xLabel, x0 + plotW / 2, y + 30);
  return svg(w, h, parts.join(''), title || xLabel);
}

/** Points on a numeric axis (years), one line per category; points at the same place stack upward. */
export function timelineSvg(rows, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseTimeline(rows, opts);
  const { width = 640, title = '', xLabel = '', note = '' } = opts;
  const w = Math.max(320, width);
  const cats = [...new Set(rows.map(r => r.series ?? ''))];
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const { ticks, lo, hi } = niceTicks(Math.min(...vals, Infinity) === Infinity ? 0 : Math.min(...vals), Math.max(...vals, -Infinity) === -Infinity ? 1 : Math.max(...vals), 6);
  const stackOf = new Map(); let deepest = 1;
  for (const r of rows) if (Number.isFinite(r.value)) { const k = `${r.series ?? ''}|${r.value}`; stackOf.set(k, (stackOf.get(k) || 0) + 1); deepest = Math.max(deepest, stackOf.get(k)); }
  const band = Math.max(ROW, Math.min(8, deepest) * 9 + 8);
  const labelW = cats.length > 1 || cats[0] ? labelWidth(w, cats) : PAD;
  const x0 = PAD + labelW, plotW = w - x0 - PAD - 8, X = v => x0 + plotW * (v - lo) / (hi - lo);
  const parts = [], body = [], top = 8; let y = top;
  const seen = new Map();
  for (const c of cats) {
    if (c) rowLabel(body, x0 - 8, y + band / 2 - ROW / 2, c);
    body.push(`<line x1="${x0}" y1="${y + band - 4}" x2="${x0 + plotW}" y2="${y + band - 4}" stroke="${GRID}" class="c-grid"/>`);
    for (const r of rows.filter(r => (r.series ?? '') === c && Number.isFinite(r.value))) {
      const k = `${c}|${r.value}`, i = seen.get(k) || 0; seen.set(k, i + 1);
      if (i >= 8) continue;
      body.push(`<circle ${mark(r)} cx="${f1(X(r.value))}" cy="${f1(y + band - 9 - i * 9)}" r="4" class="c-dot" fill="${INK}" fill-opacity="0.75">${tip(r.label, fmtNumber(r.value))}</circle>`);
    }
    y += band;
  }
  axisBottom(parts, X, ticks, y, top, v => String(Math.round(v * 100) / 100));
  parts.push(...body);
  const over = [...stackOf.values()].some(n => n > 8);
  const h = y + 34 + (note || over ? 16 : 0);
  footer(parts, h, [note, over ? 'Stacks above 8 are cut; the table lists every row' : ''].filter(Boolean).join('; '), xLabel, x0 + plotW / 2, y + 30);
  return svg(w, h, parts.join(''), title || xLabel);
}

/** A matrix of rows by columns; each cell's shade and number give its value. */
export function heatSvg(cells, opts = {}) {
  // With a style the house drawing (FIGURE-STYLE §2); without, today's figure byte for byte.
  if (opts.style) return houseHeat(cells, opts);
  const { width = 640, title = '', xLabel = '', yLabel = '', note = '' } = opts;
  const w = Math.max(320, width);
  const xs = [...new Set(cells.map(c => c.x))], ys = [...new Set(cells.map(c => c.y))];
  const labelW = labelWidth(w, ys), x0 = PAD + labelW, cw = Math.max(28, (w - x0 - PAD) / Math.max(1, xs.length));
  const rotate = xs.some(x => textWidth(String(x), FS) > cw - 6);
  const headH = rotate ? Math.min(120, Math.max(...xs.map(x => Math.min(150, textWidth(String(x), FS)))) * 0.72 + 16) : 24;
  const max = Math.max(1e-9, ...cells.map(c => c.value || 0));
  const parts = [], top = 8 + (yLabel ? 16 : 0);
  if (yLabel) parts.push(`<text x="${PAD}" y="${top - 6}" class="c-mute" fill="${AXIS}">${esc(yLabel)}</text>`);
  xs.forEach((x, i) => {
    const cx = x0 + i * cw + cw / 2;
    parts.push(rotate ? `<text transform="translate(${f1(cx + 4)},${top + headH - 6}) rotate(-45)" class="c-ink" fill="${INK}">${esc(clip(x, 150))}<title>${esc(x)}</title></text>`
      : `<text x="${f1(cx)}" y="${top + headH - 8}" text-anchor="middle" class="c-ink" fill="${INK}">${esc(x)}</text>`);
  });
  const at = new Map(cells.map(c => [`${c.y}\u0000${c.x}`, c]));
  let y = top + headH;
  for (const yv of ys) {
    rowLabel(parts, x0 - 8, y, yv);
    xs.forEach((x, i) => {
      const c = at.get(`${yv}\u0000${x}`), v = c?.value || 0, o = v ? 0.08 + 0.72 * v / max : 0;
      parts.push(`<rect ${c ? mark({ label: `${yv}, ${x}`, row: c.row }) : ''} x="${f1(x0 + i * cw + 1)}" y="${y + 1}" width="${f1(cw - 2)}" height="${ROW - 2}" class="${v ? 'c-heat' : 'c-empty'}" fill="${v ? INK : '#fff'}" fill-opacity="${v ? o.toFixed(2) : 1}" stroke="${GRID}">${tip(`${yv}, ${x}`, fmtNumber(v))}</rect>`);
      if (v) parts.push(`<text x="${f1(x0 + i * cw + cw / 2)}" y="${y + ROW / 2 + 4}" text-anchor="middle" class="${o > 0.45 ? 'c-on-heat' : 'c-ink'}" fill="${o > 0.45 ? '#fff' : INK}">${esc(fmtNumber(v))}</text>`);
    });
    y += ROW;
  }
  const h = y + 12 + (xLabel ? 20 : 0) + (note ? 16 : 0);
  if (xLabel) parts.push(`<text x="${f1(x0 + (xs.length * cw) / 2)}" y="${y + 20}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (note) parts.push(`<text x="${PAD}" y="${h - 6}" class="c-mute" fill="${AXIS}">${esc(note)}</text>`);
  // Many columns keep their minimum width; the figure widens to hold them.
  return svg(Math.max(w, x0 + xs.length * cw + PAD), h, parts.join(''), title || xLabel);
}

/** The house drawings app/lint-figures.mjs checks (FIGURE-STYLE §5 F8): every chart kind, long labels, negatives, groups, paging. */
export const __fixture = style => {
  const r = (label, value, x = {}) => ({ label, value, row: 0, ...x });
  const long = 'Non-randomized intervention study with historical controls and a much longer description than any column holds';
  return [
    { name: 'bar', svg: barSvg([r('Retrospective cohort study', 16), r(long, 8), r('Change', -3, { group: 'Signed' }), r('No value', null)], { style, xLabel: 'Studies', note: '65 included studies; Reported category counts' }) },
    { name: 'column', svg: columnSvg(Array.from({ length: 17 }, (_, i) => r(String(2008 + i), (i * 3) % 5)), { style, note: 'Year of publication' }) },
    { name: 'stacked', svg: stackedSvg([r('Cohort A', 10, { series: 'Female' }), r('Cohort A', 6, { series: 'Male' }), r(long, 4, { series: '' })], { style, xLabel: 'Patients' }) },
    { name: 'dot', svg: dotSvg([r('Study 1', 1.2, { series: 'Arm A' }), r('Study 1', 2.4, { series: 'Arm B' }), r('Study 2', -1, { group: 'Subgroup' })], { style, ref: 1, xLabel: 'Mean difference' }) },
    { name: 'forest', svg: forestSvg([r('Alpha 2018', 0.8, { lo: 0.5, hi: 1.2, weightPct: 40 }), r('Beta 2019', 1.4, { lo: 0.9, hi: 90, weightPct: 60 }), r('Not estimable', null)], { style, log: true, measure: 'RR', foot: r('Random-effects model', 1.1, { lo: 0.8, hi: 1.5, pooled: true }), het: 'Heterogeneity: I² = 28%', favours: ['Favors intervention', 'Favors control'] }) },
    { name: 'timeline', svg: timelineSvg([r('P1', 2008, { series: 'Cohort' }), r('P2', 2008, { series: 'Cohort' }), r('P3', 2019, { series: 'Trial' })], { style, xLabel: 'Year' }) },
    { name: 'heat', svg: heatSvg(Array.from({ length: 10 }, (_, i) => ({ x: `Column heading number ${i + 1}`, y: i % 2 ? 'Odd' : long, value: i + 1, row: i })), { style, note: 'Fixed rows' }) },
  ];
};
