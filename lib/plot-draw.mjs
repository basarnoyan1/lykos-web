// The continuous-plot primitives of the house style (FIGURE-STYLE §2), for the figures that draw numbers on two
// axes: stat plots, clinical plots, scatter and Q-Q, Kaplan-Meier, swimmer and harvest plots. They build on the
// text primitives of lib/figure-draw.mjs and take every colour, size and weight from the token set `t`
// (figureTokens of lib/figure-style.mjs); this file holds no literal of either.
//
// Minimal axes: an L of two axis lines with short ticks, no frame, no gridlines; the axis title of the vertical
// axis sits horizontally over it (a figure never rotates a head), the title of the horizontal axis under it. A
// label that would touch its neighbour is left off, the tick stays. A mark that may run past the plot is clipped
// by a clipPath whose id is derived from the figure itself, so two figures inlined in one page never share one.
import { esc, r1, svgRoot, text, lines, wrapText, measure, axisLine, sourceBlock, labelColumn, rowHeight, GAP, LINE, keyLines } from './figure-draw.mjs';
import { fmtNumber, niceTicks } from './output-charts.mjs';

export { fmtNumber };
export const sourceOf = s => (Array.isArray(s) ? s : [s]).filter(Boolean);
export const widthOf = (t, width, kind = 'single') => (Number.isFinite(width) && width > 0 ? width : t.width[kind]);
export const finite = (...xs) => xs.flat(Infinity).every(v => Number.isFinite(v));
/** The ticks that lie inside a domain (niceTicks rounds outward to a whole step). */
export const within = (ticks, [a, b]) => { const lo = Math.min(a, b), hi = Math.max(a, b), e = (hi - lo) * 1e-9; return ticks.filter(v => v >= lo - e && v <= hi + e); };
/**
 * Ticks for an axis drawn on the analysis scale and labelled on the reported one (`back`: log to ratio, atanh to r). They are round on the
 * reported scale, as a reader expects (0.5, 1, 2), placed where the transform puts them; a missing or linear `back` gives round ticks on the scale itself.
 */
export function scaleTicks(d, back, n = 6) {
  const lo = Math.min(...d), hi = Math.max(...d);
  const plain = () => within(niceTicks(lo, hi, n).ticks, d);
  if (typeof back !== 'function') return plain();
  const a = back(lo), b = back(hi), m = back((lo + hi) / 2);
  if (![a, b, m].every(Number.isFinite) || !(b > a) || Math.abs(m - (a + b) / 2) < (b - a) * 0.03) return plain();
  const ratio = a > 0;
  let cand = [];
  if (ratio) {
    for (const mult of [[1, 2, 5], [1, 1.5, 2, 3, 5, 7]]) {
      cand = [];
      for (let k = Math.floor(Math.log10(a)) - 1; k <= Math.ceil(Math.log10(b)); k++) for (const q of mult) { const v = q * 10 ** k; if (v >= a * (1 - 1e-9) && v <= b * (1 + 1e-9)) cand.push(Number(v.toPrecision(12))); }
      if (cand.length >= 3) break;
    }
  } else cand = within(niceTicks(a, b, n).ticks, [a, b]);
  if (cand.length < 2) return plain();
  return cand.map(v => { let x = lo, y = hi; for (let i = 0; i < 60; i++) { const c = (x + y) / 2; if (back(c) < v) x = c; else y = c; } return (x + y) / 2; });
}
export const fixed = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

/** A short id derived from the figure's own text (a seed), so the same figure has the same bytes and two figures differ. */
export function idOf(prefix, ...seed) {
  let h = 2166136261;
  for (const ch of seed.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

/** A line style per series, told apart by dash and weight on the ink and the axis grey (no hue): `{ cls, stroke, width, dash }`. */
export function seriesStyle(t, i) {
  const u = t.size.label, ink = { cls: 'c-line', stroke: t.color.ink }, grey = { cls: 'c-axis', stroke: t.color.axis };
  const heavy = t.line.ci * 1.8, light = t.line.ci * 1.1, d = n => String(Math.round(u * n * 10) / 10);
  return [
    { ...ink, width: heavy, dash: '' },
    { ...ink, width: heavy, dash: `${d(0.9)} ${d(0.35)}` },
    { ...ink, width: light, dash: `${d(0.15)} ${d(0.3)}` },
    { ...grey, width: heavy, dash: '' },
    { ...ink, width: light, dash: `${d(0.9)} ${d(0.3)} ${d(0.15)} ${d(0.3)}` },
    { ...grey, width: heavy, dash: `${d(0.9)} ${d(0.35)}` },
  ][i % 6];
}
/** The stroke attributes of a series style. */
export const strokeOf = s => `class="${s.cls}" stroke="${s.stroke}" stroke-width="${r1(s.width * 100) / 100}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}`;
/** A dashed reference line's dash pattern. */
export const dashOf = t => `${r1(t.size.label * 0.5)} ${r1(t.size.label * 0.3)}`;

/** One line segment, in a series style or an axis-grey reference. */
export const seg = (x1, y1, x2, y2, attrs) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${attrs}/>`;
/** A polyline path from points; fewer than two points draw nothing. */
export const pathOf = (pts, attrs) => (pts.length > 1 ? `<path d="${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('')}" fill="none" ${attrs}/>` : '');
/** A dot: filled ink, or hollow (ink outline only), radius `r`. */
export function dot(t, cx, cy, r, { filled = true, grey = false, inner = '', attrs = '' } = {}) {
  const a = `cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 100) / 100}"${attrs ? ` ${attrs}` : ''}`;
  if (filled) return `<circle class="${grey ? 'c-bar' : 'c-dot'}" ${a} fill="${grey ? t.color.mark : t.color.ink}">${inner}</circle>`;
  return `<circle class="c-line" ${a} fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}">${inner}</circle>`;
}
/** A filled ink square of side `s`, centred. */
export const square = (t, cx, cy, s, inner = '', attrs = '') => `<rect class="c-dot" x="${r1(cx - s / 2)}" y="${r1(cy - s / 2)}" width="${r1(s)}" height="${r1(s)}" fill="${t.color.ink}"${attrs ? ` ${attrs}` : ''}>${inner}</rect>`;
export const tip = s => `<title>${esc(s)}</title>`;

/** A figure that only says why it is not drawn (empty or non-numeric input): the house root and one wrapped note. */
export function noteFigure(t, { title, message, width, kind = 'single', source = [] }) {
  const w = widthOf(t, width, kind), P = t.pad, u = t.size.label;
  const ls = wrapText(t, message, w - 2 * P), parts = [lines(t, P, P + u, ls, { cls: 'c-mute' })];
  let h = P + u * LINE * ls.length + u * 0.8;
  const b = sourceBlock(t, P, h, w - 2 * P, sourceOf(source));
  if (b.h) { parts.push(b.svg); h += b.h + u * 0.5; }
  return svgRoot(t, w, Math.max(h, u * 3), parts.join(''), { title: title || message, desc: message });
}

/** A one-row (wrapping) legend of line samples or swatches below a plot. `items`: `[{ label, sample(x, y, len) }]`. Returns `{ svg, h }`. */
export function legendRows(t, x, y, w, items) {
  if (!items.length) return { svg: '', h: 0 };
  const u = t.size.label, len = u * 2.2, step = u * 1.5, out = [];
  let lx = x, ly = y + u;
  for (const it of items) {
    const iw = len + u * 0.5 + measure(t, it.label) + u * 1.2;
    if (lx + iw > x + w && lx > x) { lx = x; ly += step; }
    out.push(it.sample(lx, ly - u * 0.35, len), text(t, lx + len + u * 0.5, ly, it.label));
    lx += iw;
  }
  return { svg: out.join(''), h: ly - y + u * 0.4 };
}
/** A legend sample: a line in series style `i`. */
export const lineSample = (t, i) => (x, y, len) => seg(x, y, x + len, y, strokeOf(seriesStyle(t, i)));

/**
 * The frame of an x-y plot: scales, the L of axes with ticks and labels, axis titles, the clip for marks that may
 * leave it, the source block. `finish({ under, clipped, over, after })` joins what the caller drew (under the axes,
 * clipped to the plot, over everything) with `after(y) -> { svg, h }` for blocks under the axis (legend, risk table).
 *
 * o: width, plotH, xdom, ydom (either may run backwards), xticks, yticks, xfmt, yfmt, xLabel, yLabel (over the
 * vertical axis), yAxis (false: no vertical axis), leftMin (room at the left for something the caller draws),
 * rightPad (room at the right), headRight (text at the right end of the head row), source, keys, title, desc, seed.
 */
export function xyPlot(t, o) {
  const { width: w, plotH, xdom, ydom, xfmt = fmtNumber, yfmt = fmtNumber, xLabel = '', yLabel = '', yAxis = true,
    leftMin = 0, rightPad = 0, headRight = '', source = [], keys = [], title = '', desc = '', seed = '' } = o;
  const xticks = within(o.xticks || [], xdom), yticks = within(o.yticks || [], ydom);
  const P = t.pad, sm = t.size.small, tk = sm * 0.3;
  const yw = yAxis ? Math.max(0, ...yticks.map(v => measure(t, yfmt(v), 'small'))) + tk + sm * 0.5 : 0;
  const firstHalf = xticks.length ? measure(t, xfmt(xticks[0]), 'small') / 2 : 0, lastHalf = xticks.length ? measure(t, xfmt(xticks.at(-1)), 'small') / 2 : 0;
  const x0 = Math.max(P + yw, P + leftMin, firstHalf + 1), x1 = w - Math.max(P, lastHalf + 1) - rightPad;
  const top = P + (yLabel || headRight ? sm * 1.9 : sm * 0.6), y1 = top + plotH;
  const sx = (xdom[1] - xdom[0]) || 1, sy = (ydom[1] - ydom[0]) || 1;
  // ydom[0] is at the bottom and ydom[1] at the top; a reversed domain (the Doi plot) runs the other way
  const X = v => x0 + (x1 - x0) * (v - xdom[0]) / sx, Yv = v => y1 - plotH * (v - ydom[0]) / sy;
  const clipId = idOf('plot', title, seed, r1(w), r1(plotH));
  const finish = ({ under = '', clipped = '', over = '', after = null } = {}) => {
    const parts = [];
    if (yLabel) parts.push(text(t, P, P + sm, yLabel, { role: 'small', cls: 'c-mute' }));
    if (headRight) parts.push(text(t, w - P, P + sm, headRight, { anchor: 'end', role: 'head', cls: 'c-ink c-head' }));
    parts.push(under);
    if (yAxis) {
      parts.push(axisLine(t, x0, top, x0, y1));
      for (const v of yticks) parts.push(axisLine(t, x0 - tk, Yv(v), x0, Yv(v)), text(t, x0 - tk - sm * 0.4, Yv(v) + sm * 0.35, yfmt(v), { anchor: 'end', role: 'small', cls: 'c-ink', color: t.color.ink }));
    }
    parts.push(axisLine(t, x0, y1, x1, y1));
    let right = -Infinity;
    for (const v of xticks) {
      const s = xfmt(v), cx = X(v), half = measure(t, s, 'small') / 2;
      parts.push(axisLine(t, cx, y1, cx, y1 + tk));
      if (cx - half >= right + sm * 0.6) { right = cx + half; parts.push(text(t, cx, y1 + sm * 1.45, s, { anchor: 'middle', role: 'small', cls: 'c-ink', color: t.color.ink })); }
    }
    parts.push(clipped ? `<g clip-path="url(#${clipId})">${clipped}</g>` : '', over);
    let y = y1 + sm * 1.45 + sm * 0.7;
    if (xLabel) { parts.push(text(t, x0, y1 + sm * 3, xLabel, { role: 'small', cls: 'c-mute' })); y = y1 + sm * 3 + sm * 0.7; }
    if (after) { const a = after(y); parts.push(a.svg); y += a.h; }
    const items = [...sourceOf(source), ...keyLines(keys)];
    if (items.length) { const b = sourceBlock(t, P, y + sm * 0.5, w - 2 * P, items); parts.push(b.svg); y += sm * 0.5 + b.h; }
    const e = t.size.label * 0.3, pad = tk;
    const defs = clipped ? `<clipPath id="${clipId}"><rect x="${r1(x0 - e)}" y="${r1(top - e)}" width="${r1(x1 - x0 + 2 * e)}" height="${r1(plotH + 2 * e)}"/></clipPath>` : '';
    return svgRoot(t, w, y + Math.max(P, pad * 2), parts.join(''), { title: title || 'Figure', desc, defs });
  };
  return { X, Y: Yv, x0, x1, top, y1, w, finish };
}

/**
 * A plot of rows: a label column (two lines, or a key), a mark per row on a shared horizontal scale, a ticked axis
 * under the rows. `rows`: `[{ label, title?, bold?, draw(X, cy, h) -> svg }]`. `under(X, top, bottom)` draws bands and
 * reference lines behind the rows; `heads`: `[{ at, text }]` small notes over the plot at a value.
 */
export function rowPlot(t, o) {
  const { width: w, rows, dom, fmt = fmtNumber, xLabel = '', heads = [], under = null, source = [], title = '', desc = '' } = o;
  const P = t.pad, u = t.size.label, sm = t.size.small, gap = u * GAP, tk = sm * 0.3, ticks = within(o.ticks, dom);
  const col = labelColumn(t, rows.map(r => String(r.label)), w * 0.45);
  const lastHalf = ticks.length ? measure(t, fmt(ticks.at(-1)), 'small') / 2 : 0;
  // a heading-weight label is about 8 % wider than the table measures
  const x0 = P + col.w + (rows.some(r => r.bold) ? (col.w - u * GAP) * 0.08 : 0), x1 = w - Math.max(P, lastHalf + 1);
  const X = v => x0 + (x1 - x0) * (v - dom[0]) / ((dom[1] - dom[0]) || 1);
  const top = P + (heads.length ? sm * 1.9 : sm * 0.4);
  const body = [];
  let y = top;
  rows.forEach((r, i) => {
    const ln = col.lines[i], h = rowHeight(t, ln.length), cy = y + h / 2;
    body.push(`<g>${r.title ? tip(r.title) : ''}${lines(t, x0 - gap, cy, ln, { anchor: 'end', role: r.bold ? 'head' : 'label', cls: r.bold ? 'c-ink c-head' : 'c-ink' })}${r.draw(X, cy, h)}</g>`);
    y += h;
  });
  const parts = [];
  for (const h of heads) {
    const half = measure(t, h.text, 'small') / 2, cx = Math.min(w - P - half, Math.max(P + half, X(h.at)));
    parts.push(text(t, cx, P + sm, h.text, { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  }
  if (under) parts.push(under(X, top, y));
  parts.push(...body, axisLine(t, x0, y, x1, y));
  let right = -Infinity;
  for (const v of ticks) {
    const s = fmt(v), cx = X(v), half = measure(t, s, 'small') / 2;
    parts.push(axisLine(t, cx, y, cx, y + tk));
    if (cx - half >= right + sm * 0.6) { right = cx + half; parts.push(text(t, cx, y + sm * 1.45, s, { anchor: 'middle', role: 'small', cls: 'c-ink', color: t.color.ink })); }
  }
  let yy = y + sm * 1.45 + sm * 0.7;
  if (xLabel) { parts.push(text(t, x0, y + sm * 3, xLabel, { role: 'small', cls: 'c-mute' })); yy = y + sm * 3 + sm * 0.7; }
  const items = [...sourceOf(source), ...keyLines(col.keys)];
  if (items.length) { const b = sourceBlock(t, P, yy + sm * 0.5, w - 2 * P, items); parts.push(b.svg); yy += sm * 0.5 + b.h; }
  return svgRoot(t, w, yy + Math.max(P, tk * 2), parts.join(''), { title: title || xLabel || 'Figure', desc });
}
