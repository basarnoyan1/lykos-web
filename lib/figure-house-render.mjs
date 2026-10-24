// The house style's row, column and forest charts (FIGURE-STYLE §2): what
// lib/output-charts.mjs and lib/charts.mjs draw when they are given a `style`
// (figureTokens of lib/figure-style.mjs). One style in two media: the export is
// in pt on a journal column with the source block under the plot, the screen
// copy the same geometry in px at the card's width, coloured by the theme
// through its c-* classes. Minimal axes: one baseline where the data start,
// short ticks on a continuous axis, no gridlines where every mark carries its
// value, no frame. A label never ends in an ellipsis: it wraps to two lines, or
// becomes a key listed under the figure. Every colour and size is a token.
//
// Inputs are those of the neutral renderers: `rows` of `{ label, value, group?,
// series?, lo?, hi?, weight?, pooled?, row, study? }`; every mark carries
// data-chart-mark (its label) and data-row (its row) for the hover card.
import { fmtNumber, niceTicks } from './output-charts.mjs';
import { ROB_LEVELS, glyphSvg, robFill, robLevel as robvisLevel } from './rob-palette.mjs';
import { esc, r1, svgRoot, text, lines, labelColumn, rowHeight, sourceBlock, axisLine, hairLine, tick, arrowMarker, measure, wrapText, GAP, LINE, keyLines } from './figure-draw.mjs';

/** The rows a row chart draws on this page, with a heading where the group changes and at the top of every page. */
function pageUnits(rows, { offset = 0, page = Infinity, byLabel = false } = {}) {
  const units = [];
  for (const r of rows) {
    const last = units.at(-1);
    if (byLabel && last && last.label === r.label && last.group === (r.group ?? null)) last.rows.push(r);
    else units.push({ label: r.label, group: r.group ?? null, rows: [r] });
  }
  const out = [];
  let prev;
  units.slice(offset, offset + page).forEach((u, i) => {
    if (u.group != null && (i === 0 || u.group !== prev)) out.push({ heading: u.group });
    out.push(u); prev = u.group;
  });
  return out;
}
const mark = (r, label = r.label) => `data-chart-mark="${esc(label)}"${r.row != null ? ` data-row="${r.row}"` : ''}${r.study ? ` data-study="${esc(r.study)}"` : ''}${r.ids?.length ? ` data-chart-ids="${esc(r.ids.join(' '))}" data-chart-label="${esc(`${label}: ${r.ids.length}`)}"` : ''}`;
const tip = (label, value) => `<title>${esc(label)}: ${esc(value)}</title>`;
const fullTitle = (label, shown) => (shown.join(' ') === String(label) ? '' : `<title>${esc(label)}</title>`);
const sourceOf = s => (Array.isArray(s) ? s : [s]).filter(Boolean);
const widthOf = (t, width, kind) => width || t.width[kind];

/** A heading row of a row chart: the group's name at the text edge, heading weight, wrapped to the width. */
function heading(t, parts, y, label, w) {
  const ls = wrapText(t, label, w - 2 * t.pad), h = rowHeight(t, ls.length);
  parts.push(lines(t, t.pad, y + h / 2, ls, { role: 'head', cls: 'c-ink c-head' }));
  return h;
}

/** The foot of a figure: the axis title, then the source block (source and N, notes, the label key). Returns the new height. */
function foot(t, parts, y, w, { xLabel = '', xAt = t.pad, note = '', source = [], keys = [] } = {}) {
  const sm = t.size.small;
  if (xLabel) { parts.push(text(t, xAt, y + sm * 1.5, xLabel, { role: 'small', cls: 'c-mute' })); y += sm * 1.9; }
  const items = [...sourceOf(source), ...keyLines(keys)];
  if (items.length) {
    const b = sourceBlock(t, t.pad, y + sm * 0.9, w - 2 * t.pad, items);
    parts.push(b.svg); y += sm * 0.9 + b.h;
  }
  return y + t.pad + (xLabel || items.length ? 0 : t.size.label * 0.4);
}

// ---- bars ------------------------------------------------------------------------------------
/**
 * Horizontal bars, one per row, the value after each bar and no value axis;
 * sections by group. `domain` keeps one scale across pages; a `muted` row
 * (Not reported) is drawn in the light fill with a muted label.
 */
export function houseBar(rows, { style: t, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity, domain = null } = {}) {
  const w = widthOf(t, width, 'single'), P = t.pad, ls = t.size.label, gap = ls * GAP;
  const units = pageUnits(rows, { offset, page }), items = units.filter(u => u.heading == null);
  const vals = rows.map(r => r.value ?? 0).concat(domain || []);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (!(hi > lo)) hi = lo + 1;
  const show = r => (r.value == null ? '–' : fmtNumber(r.value));
  const valueW = Math.max(measure(t, '0'), ...rows.map(r => measure(t, show(r)))) + gap;
  const col = labelColumn(t, items.map(u => u.label), w * 0.45);
  const neg = lo < 0, x0 = P + col.w + (neg ? valueW : 0), plotW = Math.max(ls * 4, w - x0 - P - valueW);
  const X = v => x0 + plotW * (v - lo) / (hi - lo), zx = X(0), bh = t.row * t.bar, thin = t.unit === 'pt' ? 0.5 : 1;
  const parts = [];
  let y = P, k = 0;
  for (const u of units) {
    if (u.heading != null) { y += heading(t, parts, y, u.heading, w); continue; }
    const shown = col.lines[k++], h = rowHeight(t, shown.length), cy = y + h / 2, r = u.rows[0], v = r.value || 0, end = X(v), attrs = mark(r, u.label);
    parts.push(lines(t, P + col.w - gap, cy, shown, { anchor: 'end', cls: r.muted ? 'c-mute' : 'c-ink', attrs, inner: fullTitle(u.label, shown) }));
    if (v) parts.push(`<rect ${attrs} class="${r.muted ? 'c-fill' : 'c-bar'}" x="${r1(Math.min(zx, end))}" y="${r1(cy - bh / 2)}" width="${r1(Math.max(thin, Math.abs(end - zx)))}" height="${r1(bh)}" fill="${r.muted ? t.color.fill : t.color.mark}">${tip(u.label, show(r))}</rect>`);
    parts.push(text(t, v < 0 ? end - ls * 0.4 : end + ls * 0.4, cy + ls * 0.35, show(r), { anchor: v < 0 ? 'end' : 'start', attrs }));
    y += h;
  }
  if (items.length) parts.push(axisLine(t, zx, P, zx, y));
  const h = foot(t, parts, y, w, { xLabel, xAt: x0, source: [note, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

/**
 * Vertical bars over an ordered axis (years, histogram bins). The value is
 * written on each bar when it fits, and then there is no value axis; else a
 * left axis with ticks. Labels thin to every nth, with a tick at each shown
 * label. `edges` labels bin boundaries (bars touch).
 */
export function houseColumn(rows, { style: t, width, title = '', xLabel = '', yLabel = '', note = '', source = [], edges = null, plotHeight = null } = {}) {
  const w = widthOf(t, width, 'single'), P = t.pad, sm = t.size.small, n = Math.max(1, rows.length);
  const vals = rows.map(r => r.value ?? 0);
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals) || (Math.min(0, ...vals) ? 0 : 1), 4, { zero: true });
  const plotH = plotHeight || (t.medium === 'screen' ? 150 : Math.round(w * 0.29));
  const widestValue = Math.max(0, ...rows.map(r => measure(t, fmtNumber(r.value ?? 0), 'small')));
  const gapOf = bw => (edges ? (t.unit === 'pt' ? 0.5 : 1) : Math.min(bw * 0.25, t.unit === 'pt' ? 2 : 4));
  let axisW = 0, bw = (w - 2 * P) / n;
  const labelled = !edges && bw - gapOf(bw) >= widestValue + 2 && rows.length <= 40;
  if (!labelled) { axisW = Math.max(...ticks.map(v => measure(t, fmtNumber(v), 'small'))) + sm * 0.8; bw = (w - 2 * P - axisW) / n; }
  const gap = gapOf(bw), x0 = P + axisW, top = P + (yLabel ? sm * 1.8 : 0) + (labelled ? sm * 1.4 : sm * 0.5), y0 = top + plotH;
  const Y = v => y0 - plotH * (v - lo) / (hi - lo), zy = Y(0);
  const parts = [];
  if (yLabel) parts.push(text(t, P, P + sm, yLabel, { role: 'small', cls: 'c-mute' }));
  rows.forEach((r, i) => {
    const v = r.value ?? 0;
    if (!v) return;
    const x = x0 + i * bw + gap / 2, y = Y(v), attrs = mark(r);
    parts.push(`<rect ${attrs} class="c-bar" x="${r1(x)}" y="${r1(Math.min(y, zy))}" width="${r1(Math.max(t.unit === 'pt' ? 0.5 : 1, bw - gap))}" height="${r1(Math.abs(zy - y))}" fill="${t.color.mark}">${tip(r.title || r.label, fmtNumber(v))}</rect>`);
    if (labelled) parts.push(text(t, x + (bw - gap) / 2, v < 0 ? y + sm * 1.1 : y - sm * 0.35, fmtNumber(v), { anchor: 'middle', role: 'small', cls: 'c-mute', attrs }));
  });
  parts.push(axisLine(t, x0, zy, x0 + n * bw, zy));
  if (!labelled) {
    parts.push(axisLine(t, x0, top, x0, y0));
    for (const v of ticks) parts.push(tick(t, x0, Y(v), 'left'), text(t, x0 - sm * 0.5, Y(v) + sm * 0.35, fmtNumber(v), { anchor: 'end', role: 'small', cls: 'c-ink', color: t.color.ink }));
  }
  const labels = edges ? edges.map(e => fmtNumber(e)) : rows.map(r => String(r.label));
  const widest = Math.max(0, ...labels.map(l => measure(t, l, 'small'))) + sm, every = Math.max(1, Math.ceil(widest / bw));
  labels.forEach((l, i) => {
    if (i % every) return;
    const cx = edges ? x0 + i * bw : x0 + i * bw + bw / 2, half = measure(t, l, 'small') / 2;
    const [x, anchor] = cx - half < 0 ? [0, 'start'] : cx + half > w ? [w, 'end'] : [cx, 'middle'];
    parts.push(tick(t, cx, y0), text(t, x, y0 + sm * 1.45, l, { anchor, role: 'small', cls: 'c-ink', color: t.color.ink, attrs: edges ? '' : mark(rows[i]) }));
  });
  const h = foot(t, parts, y0 + sm * 1.45, w, { xLabel, xAt: x0, source: [note, ...sourceOf(source)] });
  return svgRoot(t, w, h, parts.join(''), { title: title || yLabel || xLabel });
}

/** Horizontal bars split by series in greys told apart by lightness; a one-row legend below names them. */
export function houseStacked(rows, { style: t, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity } = {}) {
  const w = widthOf(t, width, 'single'), P = t.pad, ls = t.size.label, sm = t.size.small, gap = ls * GAP;
  const series = [...new Set(rows.map(r => r.series ?? ''))];
  const byLabel = new Map();
  for (const r of rows) { if (!byLabel.has(r.label)) byLabel.set(r.label, []); byLabel.get(r.label).push(r); }
  const labels = [...byLabel.keys()], shown = labels.slice(offset, offset + page);
  const totals = labels.map(l => byLabel.get(l).reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0));
  const col = labelColumn(t, shown, w * 0.45), valueW = Math.max(measure(t, '0'), ...totals.map(v => measure(t, fmtNumber(v)))) + gap;
  const x0 = P + col.w, plotW = Math.max(ls * 4, w - x0 - P - valueW), top = Math.max(1, ...totals), X = v => x0 + plotW * v / top, bh = t.row * t.bar;
  const parts = [];
  let y = P;
  shown.forEach((l, k) => {
    const ln = col.lines[k], h = rowHeight(t, ln.length), cy = y + h / 2;
    parts.push(lines(t, x0 - gap, cy, ln, { anchor: 'end', inner: fullTitle(l, ln) }));
    let acc = 0;
    for (const r of byLabel.get(l)) {
      if (!(r.value > 0)) continue;   // stacked parts add up to a whole; a negative part has no place in it
      const i = series.indexOf(r.series ?? '') % t.cat.length;
      parts.push(`<rect ${mark(r)} class="c-cat${i}" x="${r1(X(acc))}" y="${r1(cy - bh / 2)}" width="${r1(Math.max(t.unit === 'pt' ? 0.5 : 1, X(acc + r.value) - X(acc)))}" height="${r1(bh)}" fill="${t.cat[i]}"${i === t.cat.length - 1 ? ` stroke="${t.color.ink}" stroke-width="${t.line.hair}"` : ''}>${tip(`${l}, ${r.series ?? ''}`, fmtNumber(r.value))}</rect>`);
      acc += r.value;
    }
    parts.push(text(t, X(acc) + ls * 0.4, cy + ls * 0.35, fmtNumber(acc)));
    y += h;
  });
  if (shown.length) parts.push(axisLine(t, x0, P, x0, y));
  if (xLabel) { parts.push(text(t, x0, y + sm * 1.5, xLabel, { role: 'small', cls: 'c-mute' })); y += sm * 1.9; }
  // legend: a swatch and the name, one row, wrapping
  const sw = sm * 0.85;
  let lx = P, ly = y + sm * 1.6;
  series.map(s => s || 'Not reported').forEach((name, i) => {
    const iw = sw + sm * 0.4 + measure(t, name, 'small') + sm * 1.2, c = i % t.cat.length;
    if (lx + iw > w - P && lx > P) { lx = P; ly += sm * 1.5; }
    parts.push(`<rect class="c-cat${c}" x="${r1(lx)}" y="${r1(ly - sw * 0.9)}" width="${r1(sw)}" height="${r1(sw)}" fill="${t.cat[c]}"${c === t.cat.length - 1 ? ` stroke="${t.color.ink}" stroke-width="${t.line.hair}"` : ''}/>`,
      text(t, lx + sw + sm * 0.4, ly, name, { role: 'small', cls: 'c-ink', color: t.color.ink }));
    lx += iw;
  });
  const h = foot(t, parts, series.length ? ly : y, w, { source: [note, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

// ---- continuous axes ----------------------------------------------------------------------
/** A bottom axis: the baseline across the plot, a tick and a small label at every value. */
function bottomAxis(t, parts, X, ticks, x0, x1, y, fmt = fmtNumber) {
  const sm = t.size.small;
  parts.push(axisLine(t, x0, y, x1, y));
  let right = -Infinity;
  for (const v of ticks) {
    // a label that would run past the figure's edge is anchored to its tick instead of centred on it
    const s = fmt(v), x = X(v), wd = measure(t, s, 'small'), half = wd / 2, anchor = x - half < 0 ? 'start' : x + half > x1 + t.pad + t.size.label ? 'end' : 'middle';
    const left = anchor === 'start' ? x : anchor === 'end' ? x - wd : x - half;
    parts.push(tick(t, x, y));
    // a label that would touch the one before it is left out; its tick stays
    if (left < right + sm * 0.6) continue;
    parts.push(text(t, x, y + sm * 1.45, s, { anchor, role: 'small', cls: 'c-ink', color: t.color.ink }));
    right = left + wd;
  }
  return y + sm * 1.45;
}

/** One line per label, a dot per row at its value (a study's arms share the line), on a ticked axis; sections by group. */
export function houseDot(rows, { style: t, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity, ref = null } = {}) {
  const w = widthOf(t, width, 'single'), P = t.pad, ls = t.size.label, gap = ls * GAP;
  const units = pageUnits(rows, { offset, page, byLabel: true }), items = units.filter(u => u.heading == null);
  const col = labelColumn(t, items.map(u => u.label), w * 0.45);
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const { ticks, lo, hi } = niceTicks(Math.min(ref ?? Infinity, ...vals, 0), Math.max(ref ?? -Infinity, ...vals, 1), 5);
  const x0 = P + col.w, x1 = w - P - ls, X = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
  const parts = [], body = [];
  let y = P, k = 0;
  for (const u of units) {
    if (u.heading != null) { y += heading(t, body, y, u.heading, w); continue; }
    const ln = col.lines[k++], h = rowHeight(t, ln.length), cy = y + h / 2;
    body.push(lines(t, x0 - gap, cy, ln, { anchor: 'end', inner: fullTitle(u.label, ln) }), hairLine(t, x0, cy, x1, cy));
    for (const r of u.rows) if (Number.isFinite(r.value))
      body.push(`<circle ${mark(r)} class="c-dot" cx="${r1(X(r.value))}" cy="${r1(cy)}" r="${t.dot}" fill="${t.color.ink}">${tip(r.series ? `${u.label}, ${r.series}` : u.label, fmtNumber(r.value))}</circle>`);
    y += h;
  }
  if (ref != null && Number.isFinite(ref)) parts.push(axisLine(t, X(ref), P, X(ref), y, { width: t.line.null }));
  parts.push(...body);
  const ay = bottomAxis(t, parts, X, ticks, x0, x1, y);
  const h = foot(t, parts, ay, w, { xLabel, xAt: x0, source: [note, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

/** Points on a numeric axis (years), one band per category; points at the same place stack upward. */
export function houseTimeline(rows, { style: t, width, title = '', xLabel = '', note = '', source = [] } = {}) {
  const w = widthOf(t, width, 'double'), P = t.pad, ls = t.size.label, gap = ls * GAP, d = t.dot;
  const cats = [...new Set(rows.map(r => r.series ?? ''))];
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const { ticks, lo, hi } = niceTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1, 6);
  const stackOf = new Map(); let deepest = 1;
  for (const r of rows) if (Number.isFinite(r.value)) { const key = `${r.series ?? ''}|${r.value}`; stackOf.set(key, (stackOf.get(key) || 0) + 1); deepest = Math.max(deepest, stackOf.get(key)); }
  const step = d * 2.6, band = Math.max(t.row, Math.min(8, deepest) * step + d * 2);
  const named = cats.length > 1 || cats[0];
  const col = named ? labelColumn(t, cats, w * 0.3) : { w: 0, lines: cats.map(() => []), keys: [] };
  const x0 = P + col.w, x1 = w - P - ls, X = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
  const parts = [], seen = new Map();
  let y = P;
  cats.forEach((c, k) => {
    const h = Math.max(band, rowHeight(t, col.lines[k].length));
    if (c) parts.push(lines(t, x0 - gap, y + h / 2, col.lines[k], { anchor: 'end', inner: fullTitle(c, col.lines[k]) }));
    parts.push(hairLine(t, x0, y + h - d, x1, y + h - d));
    for (const r of rows.filter(x => (x.series ?? '') === c && Number.isFinite(x.value))) {
      const key = `${c}|${r.value}`, i = seen.get(key) || 0; seen.set(key, i + 1);
      if (i >= 8) continue;
      parts.push(`<circle ${mark(r)} class="c-dot" cx="${r1(X(r.value))}" cy="${r1(y + h - d * 2.2 - i * step)}" r="${d}" fill="${t.color.ink}">${tip(r.label, fmtNumber(r.value))}</circle>`);
    }
    y += h;
  });
  const ay = bottomAxis(t, parts, X, ticks, x0, x1, y, v => String(Math.round(v * 100) / 100));
  const over = [...stackOf.values()].some(v => v > 8);
  const h = foot(t, parts, ay, w, { xLabel, xAt: x0, source: [note, ...sourceOf(source), over ? 'Stacks above 8 are cut; the table lists every row' : ''], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

/**
 * A matrix of rows by columns: each cell's step of one grey ramp (five steps) and its number. Column heads never
 * rotate: a head wraps to two lines, and a column is as wide as its widest head line, so many columns widen the figure.
 */
export function houseHeat(cells, { style: t, width, title = '', xLabel = '', yLabel = '', note = '', source = [] } = {}) {
  const w0 = widthOf(t, width, 'double'), P = t.pad, ls = t.size.label, sm = t.size.small, gap = ls * GAP;
  const xs = [...new Set(cells.map(c => c.x))], ys = [...new Set(cells.map(c => c.y))];
  const col = labelColumn(t, ys.map(String), w0 * 0.35), x0 = P + col.w;
  const fair = Math.max(ls * 2.4, (w0 - x0 - P) / Math.max(1, xs.length));
  // a head of more than two lines at the fair width takes the narrowest width that holds it in two
  const twoLines = x => { let a = Math.max(...String(x).split(/\s+/).map(s => measure(t, s))), b = Math.max(a, measure(t, x));
    while (b - a > 0.5) { const m = (a + b) / 2; if (wrapText(t, x, m).length <= 2) b = m; else a = m; } return wrapText(t, x, b); };
  const heads = xs.map(x => { const ls2 = wrapText(t, x, (fair - ls) / 1.08); return ls2.length <= 2 ? ls2 : twoLines(x); });
  // heads are drawn at the heading weight, about 8 % wider than the label table; a column keeps a gap either side
  const cw = xs.map((x, i) => Math.max(fair, ...heads[i].map(l => measure(t, l) * 1.08 + ls)));
  const cx = cw.map((_, i) => x0 + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const headLines = Math.max(1, ...heads.map(h => h.length)), top = P + (yLabel ? sm * 1.8 : 0), headH = headLines * ls * LINE + ls * 0.5;
  const max = Math.max(1e-9, ...cells.map(c => c.value || 0)), stepOf = v => Math.min(t.seq.length - 1, Math.floor((v / max) * t.seq.length - 1e-9));
  const parts = [];
  if (yLabel) parts.push(text(t, P, P + sm, yLabel, { role: 'small', cls: 'c-mute' }));
  xs.forEach((x, i) => parts.push(lines(t, cx[i] + cw[i] / 2, top + headH / 2, heads[i], { anchor: 'middle', role: 'head', cls: 'c-ink c-head', inner: fullTitle(x, heads[i]) })));
  const at = new Map(cells.map(c => [`${c.y}\u0000${c.x}`, c]));
  let y = top + headH;
  ys.forEach((yv, k) => {
    const h = rowHeight(t, col.lines[k].length);
    parts.push(lines(t, x0 - gap, y + h / 2, col.lines[k], { anchor: 'end', inner: fullTitle(yv, col.lines[k]) }));
    xs.forEach((x, i) => {
      const c = at.get(`${yv}\u0000${x}`), v = c?.value || 0, s = v ? stepOf(v) : -1, inset = t.unit === 'pt' ? 0.5 : 1;
      parts.push(`<rect ${c ? mark({ label: `${yv}, ${x}`, row: c.row }) : ''} class="${s < 0 ? 'c-empty' : `c-seq${s}`}" x="${r1(cx[i] + inset)}" y="${r1(y + inset)}" width="${r1(cw[i] - 2 * inset)}" height="${r1(h - 2 * inset)}" fill="${s < 0 ? t.color.page : t.seq[s]}"${s < 0 ? ` stroke="${t.color.hair}" stroke-width="${t.line.hair}"` : ''}>${tip(`${yv}, ${x}`, fmtNumber(v))}</rect>`);
      if (v) { const dark = s >= t.seq.length - 2; parts.push(text(t, cx[i] + cw[i] / 2, y + h / 2 + ls * 0.35, fmtNumber(v), { anchor: 'middle', cls: dark ? 'c-on-heat' : 'c-ink', color: dark ? t.color.page : t.color.ink })); }
    });
    y += h;
  });
  const w = Math.max(w0, cx.at(-1) + cw.at(-1) + P || 0);
  const h = foot(t, parts, y, w, { xLabel, xAt: x0, source: [note, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

// ---- forest ---------------------------------------------------------------------------------
const ARROW = 'fa';
/** "Heterogeneity: I² = 28%, τ² = 0.04, Q = 12.4 (p = 0.19)" from a pooled result's numbers; empty without them. */
export function heterogeneityLine(a) {
  const n = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d)));
  const p = n(a?.qp, 3), parts = [n(a?.i2, 0) != null ? `I² = ${n(a.i2, 0)}%` : '', n(a?.tau2, 3) != null ? `τ² = ${n(a.tau2, 3)}` : '',
    n(a?.q, 2) != null ? `Q = ${n(a.q, 2)}${p != null ? ` (p ${p < 0.001 ? '< 0.001' : `= ${p}`})` : ''}` : ''].filter(Boolean);
  return parts.length ? `Heterogeneity: ${parts.join(', ')}` : '';
}

/**
 * Estimates with intervals, a row each: column heads over a hairline (study, estimate with CI, weight), squares
 * sized by weight, subgroup and overall diamonds under a hairline, the heterogeneity line, the null line behind
 * the rows, a bottom axis with ticks at powers of two (log) or nice steps, and an arrowhead where an interval
 * runs past the axis. `foot` is the overall row, on every page; `favours` ([left, right]) labels the two sides.
 */
export function houseForest(rows, { style: t, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity, log = false, ref = null, foot: overall = null, het = '', favours = null, decimals = 2, measure: measureName = '', cols = [], axis = null } = {}) {
  const w = widthOf(t, width, 'double'), P = t.pad, ls = t.size.label, sm = t.size.small, gap = ls * GAP;
  const units = pageUnits(rows, { offset, page }), all = overall ? [...rows, overall] : rows;
  const tr = v => (log ? Math.log2(v) : v), back = v => (log ? 2 ** v : v);
  const ok = r => [r.value, r.lo, r.hi].every(v => Number.isFinite(v) && (!log || v > 0));
  const f = v => Number(v).toFixed(decimals);
  const est = r => (ok(r) ? `${f(r.value)} (${f(r.lo)} to ${f(r.hi)})` : 'Not estimable');
  const weighted = rows.some(r => Number.isFinite(r.weightPct));
  const head = `${measureName || xLabel || 'Estimate'} (95% CI)`;
  const shownLabels = [...units.filter(u => u.heading == null).map(u => u.label), ...(overall ? [overall.label] : [])];
  const col = labelColumn(t, shownLabels, w * 0.3, { min: measure(t, 'Study') });
  const estW = Math.max(measure(t, head), ...all.map(r => measure(t, est(r)))) + ls;
  const wW = weighted ? measure(t, 'Weight') + ls : 0;
  // text columns between the names and the plot (lib/forest-options.mjs: each arm's events over its total), right-aligned on their ends
  const shown = cols.filter(c => rows.some(r => r.cells?.[c.key] != null)), cW = c => Math.max(measure(t, c.head, 'head'), ...rows.map(r => measure(t, String(r.cells?.[c.key] ?? '')))) + ls;
  const colEnd = []; let cx = P + col.w; for (const c of shown) { cx += cW(c); colEnd.push(cx - ls * 0.5); }
  const xW = w - P, xEst = xW - wW, x0 = cx, x1 = xEst - estW;
  // the axis covers the estimates and the null; an interval past 1/32 or 32 (log) ends in an arrowhead
  const good = all.filter(ok), refV = ref ?? (log ? 1 : 0), cap = log ? 5 : Infinity;
  let lo0 = Math.min(tr(refV), ...good.map(r => Math.max(-cap, tr(r.lo)))), hi0 = Math.max(tr(refV), ...good.map(r => Math.min(cap, tr(r.hi))));
  let ticks;
  if (log && axis?.ticks) { lo0 = tr(axis.lo); hi0 = tr(axis.hi); ticks = axis.ticks.map(tr); }
  else if (log) { lo0 = Math.floor(lo0); hi0 = Math.ceil(hi0); if (hi0 === lo0) { lo0 -= 1; hi0 += 1; } ticks = Array.from({ length: hi0 - lo0 + 1 }, (_, i) => lo0 + i); }
  else ({ ticks, lo: lo0, hi: hi0 } = niceTicks(lo0, hi0, 5));
  const X = v => x0 + (x1 - x0) * (Math.min(hi0, Math.max(lo0, tr(v))) - lo0) / (hi0 - lo0);
  const parts = [], body = [];
  // column heads
  const hy = P + ls;
  body.push(text(t, P, hy, 'Study', { role: 'head', cls: 'c-ink c-head' }), text(t, xEst, hy, head, { role: 'head', anchor: 'end', cls: 'c-ink c-head' }));
  if (weighted) body.push(text(t, xW, hy, 'Weight', { role: 'head', anchor: 'end', cls: 'c-ink c-head' }));
  shown.forEach((c, j) => body.push(text(t, colEnd[j], hy, c.head, { role: 'head', anchor: 'end', cls: 'c-ink c-head' })));
  let y = hy + ls * 0.6;
  body.push(hairLine(t, P, y, w - P, y));
  const top = y;
  let k = 0, arrows = false;
  const drawRow = (r, y, ln) => {
    const h = rowHeight(t, ln.length), cy = y + h / 2, attrs = mark(r), role = r.pooled ? 'head' : 'label';
    body.push(lines(t, P, cy, ln, { role, cls: r.pooled ? 'c-ink c-head' : 'c-ink', attrs: r.study ? `data-study="${esc(r.study)}"` : '', inner: fullTitle(r.label, ln) }));
    if (ok(r)) {
      if (r.pooled) {
        const dh = t.row * t.diamond / 2;
        body.push(`<polygon ${attrs} class="c-dot" points="${r1(X(r.lo))},${r1(cy)} ${r1(X(r.value))},${r1(cy - dh)} ${r1(X(r.hi))},${r1(cy)} ${r1(X(r.value))},${r1(cy + dh)}" fill="${t.color.ink}">${tip(r.label, est(r))}</polygon>`);
      } else {
        const wt = Number.isFinite(r.weightPct) ? r.weightPct : Number.isFinite(r.weight) ? r.weight * 100 : null;
        const side = wt == null ? t.square[0] + t.square[1] * 0.5 : t.square[0] + t.square[1] * Math.sqrt(Math.max(0, Math.min(100, wt)) / 100);
        const cutL = tr(r.lo) < lo0, cutR = tr(r.hi) > hi0;
        arrows ||= cutL || cutR;
        body.push(`<g ${attrs}>${tip(r.label, est(r))}<line class="c-line" x1="${r1(X(r.lo))}" y1="${r1(cy)}" x2="${r1(X(r.hi))}" y2="${r1(cy)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"${cutL ? ` marker-start="url(#${ARROW})"` : ''}${cutR ? ` marker-end="url(#${ARROW})"` : ''}/>` +
          `<rect class="c-dot" x="${r1(X(r.value) - side / 2)}" y="${r1(cy - side / 2)}" width="${r1(side)}" height="${r1(side)}" fill="${t.color.ink}"/></g>`);
      }
    }
    body.push(text(t, xEst, cy + ls * 0.35, est(r), { anchor: 'end', role, cls: r.pooled ? 'c-ink c-head' : 'c-ink' }));
    shown.forEach((c, j) => { if (r.cells?.[c.key] != null) body.push(text(t, colEnd[j], cy + ls * 0.35, String(r.cells[c.key]), { anchor: 'end', cls: 'c-ink' })); });
    if (weighted) {
      const wp = r === overall ? '100%' : Number.isFinite(r.weightPct) ? `${r.weightPct.toFixed(1)}%` : '';
      if (wp) body.push(text(t, xW, cy + ls * 0.35, wp, { anchor: 'end', cls: 'c-mute' }));
    }
    return h;
  };
  for (const u of units) {
    if (u.heading != null) { y += heading(t, body, y, u.heading, w); continue; }
    y += drawRow(u.rows[0], y, col.lines[k++]);
  }
  if (overall) { body.push(hairLine(t, P, y, w - P, y)); y += drawRow(overall, y, col.lines[k++]); }
  // the null line behind the rows, then the axis
  parts.push(axisLine(t, X(refV), top, X(refV), y, { width: t.line.null }), ...body);
  const ay = bottomAxis(t, parts, v => x0 + (x1 - x0) * (v - lo0) / (hi0 - lo0), ticks, x0, x1, y, v => fmtNumber(back(v)));
  let fy = ay;
  if (favours?.length === 2) {
    const zx = X(refV), fyy = ay + sm * 1.5;
    parts.push(text(t, zx - sm * 0.6, fyy, favours[0], { anchor: 'end', role: 'small', cls: 'c-mute' }), text(t, zx + sm * 0.6, fyy, favours[1], { role: 'small', cls: 'c-mute' }));
    fy = fyy;
  }
  // the heterogeneity line under the axis, clear of the null line and the tick labels
  if (het) { fy += sm * 1.7; parts.push(text(t, P, fy, het, { role: 'small', cls: 'c-mute' })); }
  const h = foot(t, parts, fy, w, { xLabel: favours ? '' : xLabel, xAt: x0, source: [note, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel, defs: arrows ? arrowMarker(t, ARROW, 0.5) : '' });
}

// ---- risk of bias -------------------------------------------------------------------------------
// The one conventional hue: robvis's palette (lib/rob-palette.mjs, read through the tokens' rob levels), the same on screen and in print, with
// the level's glyph in every mark and an ink edge round it, so the level reads in greyscale, under every dichromacy and on a dark page. Each
// judgement word takes its level (lib/appraisal-robvis.mjs robvisLevel): Critical is its own level, never Serious's; Low (except for concerns
// about uncontrolled confounding) is its own; Not applicable and Not assessed draw no mark. The key lists the levels the figure draws, in the
// instrument's own words. `tones` maps a word the level rule does not know to good, unclear or bad.
const robColumns = tool => [...tool.domains, ...(tool.overall ? [{ id: 'overall', short: 'Overall', label: 'Overall' }] : [])];
const levelOf = (word, tones) => (word ? robvisLevel(word, tones?.[word]) : 'na');
const DEFAULT_WORD = { low: 'Low', lowx: 'Low (except for concerns about uncontrolled confounding)', concerns: 'Moderate', high: 'Serious', critical: 'Critical', ninfo: 'No information' };
/** The levels the rows draw, in the palette's order, each with the instrument's word for it: `[{ level, word }]`. */
export function robKeyLevels(tool, rows, tones = {}) {
  const used = new Set(rows.flatMap(r => robColumns(tool).map(c => levelOf(r.values?.[c.id], tones))));
  return ROB_LEVELS.filter(l => l !== 'na' && used.has(l)).map(level => ({ level, word: (tool.judgements || []).find(j => levelOf(j, tones) === level) || DEFAULT_WORD[level] }));
}
function robMark(t, cx, cy, r, level, inner = '') {
  if (level === 'na') return `<g>${inner}</g>`;
  return `<g><circle class="c-rob-edge" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${robFill(t, level)}" stroke="${t.color.ink}" stroke-width="${t.line.box}"/>${glyphSvg(level, cx, cy, r, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } })}${inner}</g>`;
}
/** The judgement key (the levels drawn, in the instrument's words) as a wrapped line of marks: direct labelling. */
function robKey(t, parts, key, y, w, r) {
  const sm = t.size.small, P = t.pad;
  let x = P, ky = y + sm * 1.6;
  for (const { level, word } of key) {
    const iw = r * 2 + sm * 0.5 + measure(t, word, 'small') + sm * 1.4;
    if (x + iw > w - P && x > P) { x = P; ky += sm * 1.7; }
    parts.push(robMark(t, x + r, ky - sm * 0.35, r, level), text(t, x + r * 2 + sm * 0.5, ky, word, { role: 'small', cls: 'c-mute' }));
    x += iw;
  }
  return ky;
}

/** One row per study, one column per domain, a circle with its glyph per judgement; heads never rotate. */
export function houseTrafficLight(tool, rows, tones, { style: t, source = [] } = {}) {
  const P = t.pad, ls = t.size.label, cell = t.row * 1.2, R = cell * 0.32, cols = robColumns(tool), key = robKeyLevels(tool, rows, tones);
  const col = labelColumn(t, rows.map(r => r.label), (t.medium === 'screen' ? 260 : t.width.single * 0.6));
  const colW = cols.map(c => Math.max(cell, measure(t, c.short) * 1.08 + ls * 0.8));
  const colX = colW.map((_, i) => P + col.w + colW.slice(0, i).reduce((a, b) => a + b, 0) + colW[i] / 2);
  const grid = P + col.w + colW.reduce((a, b) => a + b, 0) + P;
  const legendW = P * 2 + key.reduce((n, k) => n + R * 2 + t.size.small * 1.9 + measure(t, k.word, 'small'), 0);
  const w = Math.max(grid, Math.min(legendW, t.width.double));
  const parts = [];
  let y = P + ls;
  cols.forEach((c, i) => parts.push(text(t, colX[i], y, c.short, { anchor: 'middle', role: 'head', cls: 'c-ink c-head', inner: c.label !== c.short ? `<title>${esc(c.label)}</title>` : '' })));
  y += ls * 0.6;
  rows.forEach((r, k) => {
    const ln = col.lines[k], h = Math.max(cell, rowHeight(t, ln.length)), cy = y + h / 2;
    const interactive = t.medium === 'screen' && r.study;
    parts.push(lines(t, P, cy, ln, { inner: fullTitle(r.label, ln) }));
    cols.forEach((c, i) => {
      const word = r.values[c.id], level = levelOf(word, tones), tipText = `${r.label}, ${c.label}: ${word || 'Not assessed'}`;
      // each mark is its own press on screen: the study's judgement opens in Appraisal
      const mk = robMark(t, colX[i], cy, R, level, `<title>${esc(tipText)}</title>`);
      parts.push(interactive && word ? `<g data-study="${esc(r.study)}" data-rob-domain="${esc(c.id)}" role="button" tabindex="0" aria-label="${esc(tipText)}">${mk}</g>` : mk);
    });
    y += h;
  });
  const ky = robKey(t, parts, key, y, w, R * 0.75);
  const domains = tool.domains.filter(d => d.short !== d.label).map(d => `${d.short} ${d.label}`).join('; ');
  const h = foot(t, parts, ky, w, { source: [domains, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: `${tool.name} traffic light` });
}

/**
 * One bar per domain: the share of studies at each level on a 0–100 % axis, each segment in its level's hue with its glyph where it fits,
 * an ink edge between segments; with `weights` each study counts by its weight (studies without one are left out).
 */
export function houseSummary(tool, rows, tones, { style: t, weights = null, source = [] } = {}) {
  const P = t.pad, ls = t.size.label, gap = ls * GAP, cols = robColumns(tool), key = robKeyLevels(tool, rows, tones);
  const col = labelColumn(t, cols.map(c => c.label), t.medium === 'screen' ? 300 : t.width.double * 0.4);
  const barW = t.medium === 'screen' ? 320 : t.width.double * 0.5, w = P + col.w + barW + P + measure(t, '100%', 'small') / 2 + ls, x0 = P + col.w, bh = t.row * t.bar;
  const used = weights ? rows.filter(r => weights.get(r.label) > 0) : rows, wt = r => (weights ? weights.get(r.label) : 1);
  const total = used.reduce((n, r) => n + wt(r), 0) || 1;
  const parts = [];
  let y = P;
  cols.forEach((c, k) => {
    const ln = col.lines[k], h = rowHeight(t, ln.length), cy = y + h / 2, sums = new Map(), ns = new Map();
    parts.push(lines(t, x0 - gap, cy, ln, { anchor: 'end', inner: fullTitle(c.label, ln) }));
    for (const r of used) { const lv = levelOf(r.values[c.id], tones); sums.set(lv, (sums.get(lv) || 0) + wt(r)); ns.set(lv, (ns.get(lv) || 0) + 1); }
    let x = x0;
    for (const lv of ROB_LEVELS) {
      const v = sums.get(lv) || 0;
      if (!v) continue;
      const sw = barW * v / total, pct = Math.round(100 * v / total), word = key.find(q => q.level === lv)?.word || 'Not assessed';
      const interactive = t.medium === 'screen' && rows.some(r => r.study);
      if (interactive) parts.push(`<g id="rob-summary-${esc(c.id)}-${lv}" data-rob-domain="${esc(c.id)}" data-rob-level="${lv}" role="button" tabindex="0" aria-label="${esc(`${c.label}, ${word}: ${ns.get(lv)} of ${used.length}`)}">`);
      const fill = lv === 'na' ? t.rob.none : robFill(t, lv);
      parts.push(`<rect class="c-rob-edge" x="${r1(x)}" y="${r1(cy - bh / 2)}" width="${r1(sw)}" height="${r1(bh)}" fill="${fill}" stroke="${t.color.ink}" stroke-width="${t.line.box}"><title>${esc(c.label)}, ${esc(word)}: ${ns.get(lv)} of ${used.length}${weights ? `, ${pct}% of weight` : ''}</title></rect>`);
      if (lv !== 'na' && sw >= bh * 1.4) parts.push(glyphSvg(lv, x + sw / 2, cy, bh * 0.42, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } }));
      if (interactive) parts.push('</g>');
      x += sw;
    }
    y += h;
  });
  const ay = bottomAxis(t, parts, v => x0 + barW * v / 100, [0, 25, 50, 75, 100], x0, x0 + barW, y, v => `${v}%`);
  const ky = robKey(t, parts, key, ay, w, t.row * 0.29);
  const h = foot(t, parts, ky, w, { source: [weights ? 'Weighted by the pooled analysis' : '', ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title: `${tool.name} summary${weights ? ', weighted' : ''}` });
}
