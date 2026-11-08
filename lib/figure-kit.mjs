// Parts shared by the evidence-synthesis figures (dta, nma, evidence-map, umbrella, qes) on the house style
// (FIGURE-STYLE §2): the foot of a figure (source block and label key), the note a degenerate input gets instead of a
// drawing, an id that is unique per figure, a bottom axis, a legend row, and the frame of a matrix (a row-label column
// that wraps to two lines or becomes a key, column heads that never rotate). Every colour and size is a token of the
// set `t` (figureTokens of lib/figure-style.mjs); this file holds none.
import { svgRoot, text, lines, labelColumn, rowHeight, sourceBlock, axisLine, hairLine, tick, arrowMarker, measure, wrapText, esc, r1, LINE, GAP, keyLines } from './figure-draw.mjs';

export const sourceOf = s => (Array.isArray(s) ? s : [s]).filter(Boolean);
/** The full text of a label as a tooltip, when what is drawn is a wrapped or keyed form of it. */
export const fullTitle = (label, shown) => (shown.join(' ') === String(label) ? '' : `<title>${esc(label)}</title>`);
/** A finite number, else null: a statistic that did not come out is never drawn. */
export const fin = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** An id for a marker or clip path that differs from figure to figure (two figures share a page) and is stable for one. */
export function figId(prefix, ...seed) {
  let h = 5381;
  for (const ch of seed.join('\u0000')) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

/** The foot of a figure: the source block (source and N, notes, the label keys) under `y`. Returns the figure's height. */
export function footBlock(t, parts, y, w, { source = [], keys = [] } = {}) {
  const items = [...sourceOf(source), ...keyLines(keys)];
  if (!items.length) return y + t.pad + t.size.label * 0.4;
  const b = sourceBlock(t, t.pad, y + t.size.small * 0.9, w - 2 * t.pad, items);
  parts.push(b.svg);
  return y + t.size.small * 0.9 + b.h + t.pad;
}

/** What a figure says when there is nothing to draw (no rows, no estimate): the note, wrapped, with the title and description of a figure. */
export function emptyFigure(t, { title, message, width = null, source = [] }) {
  const w = width || t.width.single, P = t.pad, step = t.size.label * LINE;
  const ls = wrapText(t, message, w - 2 * P), parts = [];
  ls.forEach((l, i) => parts.push(text(t, P, P + t.size.label + i * step, l, { cls: 'c-mute', color: t.color.ink2 })));
  const h = footBlock(t, parts, P + t.size.label + (ls.length - 1) * step, w, { source });
  return svgRoot(t, w, h, parts.join(''), { title, desc: message });
}

/** A bottom axis: the baseline across the plot, a short tick at every value and a small label at as many as fit (a label that would run past an edge is anchored to its tick). */
export function bottomAxis(t, parts, X, ticks, x0, x1, y, fmt = String) {
  const sm = t.size.small;
  parts.push(axisLine(t, x0, y, x1, y));
  let reach = -Infinity;
  for (const v of ticks) {
    const s = fmt(v), x = X(v), width = measure(t, s, 'small'), half = width / 2;
    const anchor = x - half < 0 ? 'start' : x + half > x1 + t.pad + t.size.label ? 'end' : 'middle';
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - half;
    parts.push(tick(t, x, y));
    if (left < reach + sm * 0.6) continue;     // thinned: the tick stays, the label would touch its neighbour
    reach = left + width;
    parts.push(text(t, x, y + sm * 1.45, s, { anchor, role: 'small', cls: 'c-ink', color: t.color.ink }));
  }
  return y + sm * 1.45;
}

/**
 * One row of marks with their names under a figure, wrapping at its width. `items`: [{ cls, fill, label }] for a square
 * swatch, or [{ label, markW, mark: (x, yMid) => svg }] for a mark of its own (a line, a circle). Returns the new y.
 */
export function legendRow(t, parts, y, w, items) {
  const sm = t.size.small, sw = sm * 0.9, P = t.pad;
  let lx = P, ly = y + sm * 1.6;
  for (const it of items) {
    const mw = it.mark ? it.markW : sw, iw = mw + sm * 0.4 + measure(t, it.label, 'small') + sm * 1.2;
    if (lx + iw > w - P && lx > P) { lx = P; ly += sm * 1.5; }
    parts.push(it.mark ? it.mark(lx, ly - sm * 0.35) : `<rect class="${it.cls}" x="${r1(lx)}" y="${r1(ly - sw * 0.9)}" width="${r1(sw)}" height="${r1(sw)}" fill="${it.fill}"/>`,
      text(t, lx + mw + sm * 0.4, ly, it.label, { role: 'small', cls: 'c-ink', color: t.color.ink }));
    lx += iw;
  }
  return ly;
}

/**
 * The frame of a matrix of rows by columns. Row labels wrap to two lines at 35 % of the width or become a key; a
 * column is `cell` wide at least and as wide as its head needs, the head wrapped to two lines (a head still wider than
 * a fifth of the figure becomes a key, C1, C2 …). Heads never rotate. Returns the geometry; `drawHeads` writes them.
 */
export function matrixFrame(t, { rows, cols, width = null, cell, labelFrac = 0.35, side = 0, headRole = 'head' }) {
  const P = t.pad, ls = t.size.label, w0 = width || t.width.double;
  const rc = labelColumn(t, rows.map(String), w0 * labelFrac);
  const x0 = P + rc.w, natural = Math.max(cell, ls * 2.4), head = 1.08;
  // the narrowest width that holds a head in two lines
  const twoLines = x => {
    let a = Math.max(...String(x).split(/\s+/).map(s => measure(t, s))), b = Math.max(a, measure(t, x));
    while (b - a > 0.5) { const m = (a + b) / 2; if (wrapText(t, x, m).length <= 2) b = m; else a = m; }
    return wrapText(t, x, b);
  };
  const colKeys = [];
  const heads = cols.map(c => {
    const at = wrapText(t, c, (natural - ls) / head);
    if (at.length <= 2 && at.join(' ') === String(c).replace(/\s+/g, ' ').trim()) return at;   // a word is never broken here
    const narrow = twoLines(c);
    if (Math.max(...narrow.map(l => measure(t, l))) * head + ls <= Math.max(natural, w0 * 0.2)) return narrow;
    colKeys.push({ key: `C${colKeys.length + 1}`, label: String(c) });
    return [`C${colKeys.length}`];
  });
  const cw = heads.map(h => Math.max(natural, ...h.map(l => measure(t, l) * head + ls)));
  const cx = cw.map((_, i) => x0 + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const end = x0 + cw.reduce((a, b) => a + b, 0);
  const w = Math.max(Math.min(w0, t.width.single * 0.75), end + side + P);
  const step = ls * LINE, headLines = Math.max(1, ...heads.map(h => h.length));
  return { P, ls, w, rc, x0, end, right: end + side, cw, cx, heads, colKeys, top: P, headH: headLines * step + ls * 0.5, step,
    rowH: k => Math.max(t.row, rowHeight(t, rc.lines[k].length)), keys: [...rc.keys, ...colKeys] };
}

/** The column heads of a frame, bottom-aligned over their columns, and the hairline under them. Returns the y where the rows start. */
export function drawHeads(t, parts, f, cols) {
  f.heads.forEach((h, i) => {
    const cy = f.top + f.headH - f.ls * 0.5 - h.length * f.step / 2;
    parts.push(lines(t, f.cx[i] + f.cw[i] / 2, cy, h, { anchor: 'middle', role: 'head', cls: 'c-ink c-head', inner: fullTitle(cols[i], h) }));
  });
  const y = f.top + f.headH;
  parts.push(hairLine(t, f.P, y, f.right, y));
  return y;
}
/** The baseline of the last line of the column heads, for a head drawn beside them (a count column). */
export const headBaseline = f => f.top + f.headH - f.ls * 0.5 - f.step / 2 + f.ls * 0.35;

/** A row label at the left of the data, right-aligned against them, as the row chart labels are. */
export function rowLabel(t, f, k, cy, label, { role = 'label', cls = 'c-ink', attrs = '' } = {}) {
  return lines(t, f.x0 - t.size.label * 0.6, cy, f.rc.lines[k], { anchor: 'end', role, cls, attrs, inner: fullTitle(label, f.rc.lines[k]) });
}

export { svgRoot, text, lines, labelColumn, rowHeight, axisLine, hairLine, tick, arrowMarker, measure, wrapText, esc, r1, LINE, GAP };
