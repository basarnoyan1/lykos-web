// Charts as a journal draws them, from the journal style's own declaration (lib/journal-figure.mjs chartLook and journalChartTokens; the
// journals addon declares `figure.chart` for The Lancet journals from their printed figures): a forest plot with its heads, group names and
// totals in bold over a rule, a tinted square whose area follows the weight with a mark of the ink at its centre, an interval with no
// caps, a total as an open diamond, the line of no effect solid from the rule to the axis and estimates flush left under their head; a
// bubble plot and a funnel plot on two axes at the left and the foot with ticks outwards and no grid; the risk-of-bias judgements as
// circles with no outline in a ruled grid and as tinted bars with a key of swatches, each with its level's glyph; bars and columns in the first series colour with an outline of
// the ink. The same rows, numbers and words as the house drawing (lib/figure-house-render.mjs, lib/charts.mjs): only the drawing differs.
// Every colour, size and measure is a token or a value of the declaration: this file holds none. Loaded only where a journal's look is
// asked for (lib/output-render.mjs chartSvg and outputFiles take `journal`: journalCharts(style)); a style that declares no chart has none.
import { journalChartTokens, chartLook } from './journal-figure.mjs';
import { svgRoot, text, lines, measure, wrapText, labelColumn, rowHeight, sourceBlock, keyLines, r1, esc } from './figure-draw.mjs';
import { fmtNumber, niceTicks } from './output-charts.mjs';
import { robKeyLevels } from './figure-house-render.mjs';
import { ROB_LEVELS, robLevel, robFill, glyphSvg } from './rob-palette.mjs';
import { decimalMarks } from './journal-text.mjs';

/** A printed number with a true minus sign (U+2212); the hover titles keep the plain hyphen the checks read. */
const minus = v => String(v).replace(/(^|[\s(])-(?=\.?\d)/g, '$1−');
const signed = v => minus(fmtNumber(v));
const plain = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
const sourceOf = s => (Array.isArray(s) ? s : [s]).filter(Boolean);
const mark = (r, label = r.label) => `data-chart-mark="${esc(label)}"${r.row != null ? ` data-row="${r.row}"` : ''}${r.study ? ` data-study="${esc(r.study)}"` : ''}`;
const tip = (label, value) => `<title>${esc(label)}: ${esc(value)}</title>`;
const fullTitle = (label, shown) => (shown.join(' ') === String(label) ? '' : `<title>${esc(label)}</title>`);
const attrsOf = a => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
/** A line in the ink at the declared weight; `dash` [on, off] in the figure's unit. */
const rule = (t, x1, y1, x2, y2, { color = t.color.ink, width = t.line.axis, dash = null, cls = 'c-axis' } = {}) =>
  `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash.map(r1).join(' ')}"` : ''}/>`;
const poly = pts => pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
/** The scale of this drawing against the declaration's own type size: a chart fitted to a page box draws its marks smaller with its type. */
const scaleOf = (t, look) => t.size.label / look.size;
/** The baseline of a line of type centred on `cy`. */
const base = (t, cy) => cy + t.size.label * 0.35;

/**
 * The rows a row chart draws on this page, with a heading where the group changes and at the top of every page (as the house drawing).
 * A row with no group after the rows of one (the figure's own total under its classes) is `apart`: no name stands over it, and a
 * forest plot draws it under an empty row, as the journal prints an overall estimate.
 */
function pageUnits(rows, { offset = 0, page = Infinity } = {}) {
  const units = rows.map(r => ({ label: r.label, group: r.group ?? null, rows: [r] })), out = [];
  let prev;
  units.slice(offset, offset + page).forEach((u, i) => {
    if (u.group != null && (i === 0 || u.group !== prev)) out.push({ heading: u.group });
    out.push(u.group == null && i > 0 && prev != null ? { ...u, apart: true } : u); prev = u.group;
  });
  return out;
}

/**
 * The text block under a figure (its source line and notes, the key of labels too long for their column), under the lowest baseline
 * `low`. Returns the figure's height: the figure ends its inset under its last baseline.
 */
function foot(t, parts, low, w, items) {
  const list = items.filter(Boolean);
  if (!list.length) return low + t.pad;
  const b = sourceBlock(t, t.pad, low + t.size.small * 1.3, w - 2 * t.pad, list);
  parts.push(b.svg);
  return low + t.size.small * 1.3 + b.h + t.pad;
}

// ---- two axes ----------------------------------------------------------------------------------------------------------------------
/**
 * The axes of a plot on two numbers: a line at the left and one at the foot, each running a tick's length past the other, ticks
 * outwards, the labels beside them and each axis's title centred on it (the left one turned). `box` { x, y, w, h } is the plot.
 * Returns the y of the lowest text baseline.
 */
function axes(t, look, parts, box, { X, Y, xTicks, yTicks, fmtX = signed, fmtY = signed, xLabel = '', yLabel = '', yTitleX = t.pad + t.size.label * 0.8 }) {
  const s = scaleOf(t, look), tk = look.axis.tick * s, gap = look.axis.label * s, ls = t.size.label, y0 = box.y + box.h;
  parts.push(rule(t, box.x, box.y, box.x, y0 + tk), rule(t, box.x - tk, y0, box.x + box.w, y0));
  for (const v of yTicks) parts.push(rule(t, box.x - tk, Y(v), box.x, Y(v)), text(t, box.x - tk - gap, base(t, Y(v)), fmtY(v), { anchor: 'end' }));
  let right = -Infinity;
  const yText = y0 + tk + gap + ls * 0.76;
  for (const v of xTicks) {
    const label = fmtX(v), wd = measure(t, label), left = X(v) - wd / 2;
    parts.push(rule(t, X(v), y0, X(v), y0 + tk));
    if (left < right + ls * 0.5) continue;   // a label that would touch the one before it is left out; its tick stays
    parts.push(text(t, X(v), yText, label, { anchor: 'middle' })); right = left + wd;
  }
  let low = yText;
  if (xLabel) { low = yText + ls * 0.24 + look.axis.title * s + ls * 0.76; parts.push(text(t, box.x + box.w / 2, low, xLabel, { anchor: 'middle' })); }
  if (yLabel) parts.push(text(t, 0, 0, yLabel, { anchor: 'middle', attrs: `transform="translate(${r1(yTitleX)} ${r1(box.y + box.h / 2)}) rotate(-90)"` }));
  return low;
}
/** Ticks at a 1-2-5 step: within fixed limits `dom` [lo, hi], or over the values with the axis ending on a tick. */
function scale(values, dom, n = 5) {
  if (dom) { const { ticks } = niceTicks(dom[0], dom[1], n); return { lo: dom[0], hi: dom[1], ticks: ticks.filter(v => v >= dom[0] - 1e-9 && v <= dom[1] + 1e-9) }; }
  return niceTicks(Math.min(...values), Math.max(...values), n);
}
/** A path through `pts` [x, y] that leaves out what lies outside `ok` and starts again where the line comes back. */
function pathOf(pts, ok) {
  let d = '', pen = false;
  for (const [x, y, v] of pts) { if (!ok(v)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${r1(x)} ${r1(y)}`; pen = true; }
  return d;
}

// ---- forest ------------------------------------------------------------------------------------------------------------------------
/**
 * Estimates with intervals, a row each, as houseForest takes them (rows, `foot` the overall row, `cols`, `limits`, `axis`, `piInline`,
 * `labelHead`, `het`, `favours`). Columns: the names, any text columns, the plot, the estimate with its interval flush left under its
 * head (the figures in a column whatever the sign), the weight on its last figure.
 */
export function journalForest(rows0, { style: t, look, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity, log = false, ref = null, foot: overall = null, het = '', favours = null, decimals = 2, measure: measureName = '', cols = [], axis = null, limits = null, piInline = false, labelHead = 'Study', part = null } = {}) {
  const F = look.forest, s = scaleOf(t, look), w = width || t.width.double, P = t.pad, ls = t.size.label, gap = ls * 1.2, lead = ls * look.lead;
  const rows = forestRows(rows0, piInline);
  // `part`: one part of a figure carried over pages (journalForestParts): { final, previous, next }. It keeps the columns and the axis of the whole
  // figure; the overall row and the notes stand under the last part only
  const closing = !part || part.final;
  const units = pageUnits(rows, { offset, page }), all = overall ? [...rows, overall] : rows;
  const tr = v => (log ? Math.log2(v) : v), back = v => (log ? 2 ** v : v);
  const ok = r => [r.value, r.lo, r.hi].every(v => Number.isFinite(v) && (!log || v > 0));
  const f = v => Number(v).toFixed(decimals), est = r => (ok(r) ? `${f(r.value)} (${f(r.lo)} to ${f(r.hi)})` : 'Not estimable');
  const weightOf = r => (Number.isFinite(r.weightPct) ? r.weightPct : Number.isFinite(r.weight) ? r.weight * 100 : null);
  const weighted = rows.some(r => Number.isFinite(r.weightPct)), heaviest = Math.max(0, ...rows.map(r => weightOf(r) ?? 0));
  const wp = r => (r === overall ? '100%' : Number.isFinite(r.weightPct) ? `${r.weightPct.toFixed(1)}%` : '');
  // the estimate column: a negative estimate begins a minus sign's width before the others, so the figures stand in a column
  const hang = all.some(r => ok(r) && r.value < 0) ? measure(t, '−') : 0, shownEst = r => minus(est(r));
  const estText = Math.max(...all.map(r => measure(t, shownEst(r), 'head') + (ok(r) && r.value < 0 ? 0 : hang)), 0);
  // its head: on one line where it fits over the estimates, else the measure's name with "(95% CI)" on a line of its own under it
  const name = measureName || xLabel || 'Estimate', head = `${name} (95% CI)`;
  const headLines = measure(t, head, 'head') <= estText ? [head] : [...wrapText(t, name, Math.max(estText, w * 0.2), 'head').slice(0, 2), '(95% CI)'];
  const estW = Math.max(estText, ...headLines.map(l => measure(t, l, 'head')));
  const wText = weighted ? Math.max(...all.map(r => measure(t, wp(r)))) : 0, wW = weighted ? Math.max(wText, measure(t, 'Weight', 'head')) : 0;
  // text columns between the names and the plot (each arm's events over its total), right-aligned on their ends
  const shown = cols.filter(c => rows.some(r => r.cells?.[c.key] != null)), cW = c => Math.max(measure(t, c.head, 'head'), ...rows.map(r => measure(t, String(r.cells?.[c.key] ?? '')))) + gap;
  const roleOf = r => (r.pooled || r === overall ? 'head' : 'label');
  const shownRows = [...units.filter(u => u.heading == null).map(u => u.rows[0]), ...(overall && closing ? [overall] : [])];
  const labels = shownRows.map(r => r.label), roles = shownRows.map(roleOf);
  // (a part measures the names and the group names of the whole figure, so its columns stand where the other parts' do)
  const headings = (part ? [...new Set(rows.map(r => r.group).filter(g => g != null))] : units.filter(u => u.heading != null).map(u => u.heading)).map(h => measure(t, h, 'head'));
  const natural = Math.max(...(part ? all.map(r => measure(t, r.label, roleOf(r))) : labels.map((l, i) => measure(t, l, roles[i]))), ...headings, measure(t, labelHead, 'head'), 0) + ls * 0.6;
  const right = estW + (weighted ? gap + wW : 0), room = w - 2 * P - right - gap - shown.reduce((a, c) => a + cW(c), 0) - w * 0.25;
  // a group's name stands on one line wherever the names' column may be that wide
  const namesMax = Math.max(w * 0.2, Math.min(natural, room)), namesMin = Math.max(measure(t, labelHead, 'head'), Math.min(namesMax, Math.max(0, ...headings)));
  const wholeW = part ? labelColumn(t, all.map(r => r.label), namesMax, { min: namesMin, roles: all.map(roleOf) }).w - labelColumn(t, [], namesMax).w : namesMin;
  const col = labelColumn(t, labels, namesMax, { min: wholeW, roles });
  const colEnd = []; let cx = P + col.w + ls * 0.6; for (const c of shown) { cx += cW(c); colEnd.push(cx - gap); }
  const xWt = w - P - wW, xEst = xWt - (weighted ? gap : 0) - estW, x0 = cx + F.square.max * s / 2, x1 = xEst - gap - F.square.max * s / 2;
  // the axis covers the estimates and the null; an interval past 1/32 or 32 (log), or past fixed limits, ends in an arrowhead
  const good = all.filter(ok), refV = ref ?? (log ? 1 : 0), cap = log ? 5 : Infinity;
  const loOf = r => Math.min(r.lo, ...(r.pi && Number.isFinite(r.pi.lo) ? [r.pi.lo] : [])), hiOf = r => Math.max(r.hi, ...(r.pi && Number.isFinite(r.pi.hi) ? [r.pi.hi] : []));
  let lo0 = Math.min(tr(refV), ...good.map(r => Math.max(-cap, tr(loOf(r))))), hi0 = Math.max(tr(refV), ...good.map(r => Math.min(cap, tr(hiOf(r))))), ticks;
  if (log && axis?.ticks) { lo0 = tr(axis.lo); hi0 = tr(axis.hi); ticks = axis.ticks.map(tr); }
  else if (log) { lo0 = Math.floor(lo0); hi0 = Math.ceil(hi0); if (hi0 === lo0) { lo0 -= 1; hi0 += 1; } ticks = Array.from({ length: hi0 - lo0 + 1 }, (_, i) => lo0 + i); }
  else if (Number.isFinite(limits?.lo) || Number.isFinite(limits?.hi)) {
    const L = Number.isFinite(limits.lo) ? limits.lo : lo0, H = Number.isFinite(limits.hi) ? limits.hi : hi0;
    ({ ticks } = niceTicks(L, H, 6)); lo0 = L; hi0 = H; ticks = ticks.filter(v => v >= L - 1e-9 && v <= H + 1e-9);
  } else ({ ticks, lo: lo0, hi: hi0 } = niceTicks(lo0, hi0, 5));
  const at = v => x0 + (x1 - x0) * (v - lo0) / (hi0 - lo0), X = v => at(Math.min(hi0, Math.max(lo0, tr(v)))), beyond = v => (tr(v) < lo0 ? -1 : tr(v) > hi0 ? 1 : 0);
  const body = [], ink = t.color.ink, lw = t.line.ci, [aw, ah] = F.arrow.map(v => v * s);
  // a filled arrowhead where an interval is cut, its point on the axis's end
  const arrow = (x, cy, dir) => `<polygon class="c-arrowhead" points="${poly([[x, cy], [x - dir * aw, cy - ah / 2], [x - dir * aw, cy + ah / 2]])}" fill="${ink}"/>`;
  const span = (xa, xb, cy, cutL, cutR) => `<line class="c-line" x1="${r1(xa + (cutL ? aw * 0.8 : 0))}" y1="${r1(cy)}" x2="${r1(xb - (cutR ? aw * 0.8 : 0))}" y2="${r1(cy)}" stroke="${ink}" stroke-width="${lw}"/>${cutL ? arrow(xa, cy, -1) : ''}${cutR ? arrow(xb, cy, 1) : ''}`;
  // the heads, in bold, each from the top line, over a rule across the figure
  const hy = P + ls * 0.48, nHead = Math.max(headLines.length, 1), ruleY = hy + (nHead - 1) * lead + ls * 0.9;
  body.push(text(t, P, hy, labelHead, { role: 'head', cls: 'c-ink c-head' }));
  headLines.forEach((l, i) => body.push(text(t, xEst, hy + i * lead, l, { role: 'head', cls: 'c-ink c-head' })));
  if (weighted) body.push(text(t, xWt, hy, 'Weight', { role: 'head', cls: 'c-ink c-head' }));
  shown.forEach((c, j) => body.push(text(t, colEnd[j], hy, c.head, { role: 'head', anchor: 'end', cls: 'c-ink c-head' })));
  body.push(rule(t, P, ruleY, w - P, ruleY, { cls: 'c-grid' }));
  let y = ruleY + ls * 0.4, k = 0;
  // a part after the first says so under the rule, as the journal's continued table does
  if (part?.previous) { body.push(text(t, P, base(t, y + t.row / 2), part.previous, { cls: 'c-ink c-continued' })); y += t.row; }
  const drawRow = (r, y, ln) => {
    const h = rowHeight(t, ln.length), cy = y + h / 2, attrs = mark(r), role = r.pooled ? 'head' : 'label', cls = r.pooled ? 'c-ink c-head' : 'c-ink';
    body.push(lines(t, P, cy, ln, { role, cls, attrs: r.study ? `data-study="${esc(r.study)}"` : '', inner: fullTitle(r.label, ln) }));
    if (ok(r)) {
      if (r.pooled) {
        const dh = F.diamond * s / 2;
        if (r.pi && [r.pi.lo, r.pi.hi].every(v => Number.isFinite(v) && (!log || v > 0)))
          body.push(`<g ${attrs} data-interval="prediction">${tip('Prediction interval', `${f(r.pi.lo)} to ${f(r.pi.hi)}`)}${span(X(r.pi.lo), X(r.pi.hi), cy, beyond(r.pi.lo) < 0, beyond(r.pi.hi) > 0)}</g>`);
        // a total: an open diamond in a line of the ink, over the line of no effect and its own prediction interval
        body.push(`<polygon ${attrs} class="c-diamond" points="${poly([[X(r.lo), cy], [X(r.value), cy - dh], [X(r.hi), cy], [X(r.value), cy + dh]])}" fill="${t.color.page}" stroke="${ink}" stroke-width="${lw}">${tip(r.label, est(r))}</polygon>`);
      } else {
        const wt = weightOf(r), side = wt != null && heaviest > 0 ? F.square.max * s * Math.sqrt(Math.max(0, wt) / heaviest) : 0, m = F.square.mark * s / 2, out = beyond(r.value), xv = X(r.value);
        // an estimate beyond the axis: no mark, the part of its interval on the axis (at least a short stub) ending in an arrowhead at the edge
        let xa = X(r.lo), xb = X(r.hi);
        if (out < 0 && xb - xa < 2 * ls) xb = xa + 2 * ls;
        if (out > 0 && xb - xa < 2 * ls) xa = xb - 2 * ls;
        body.push(`<g ${attrs}${out ? ' data-beyond-axis="true"' : ''}>${tip(r.label, est(r))}` +
          (r.interval || out || !side ? '' : `<rect class="c-square" x="${r1(xv - side / 2)}" y="${r1(cy - side / 2)}" width="${r1(side)}" height="${r1(side)}" fill="${t.color.fill}"/>`) +
          span(xa, xb, cy, tr(r.lo) < lo0, tr(r.hi) > hi0) +
          (r.interval || out ? '' : `<polygon class="c-dot" points="${poly([[xv - m, cy], [xv, cy - m], [xv + m, cy], [xv, cy + m]])}" fill="${ink}"/>`) + '</g>');
      }
    }
    body.push(text(t, xEst + (ok(r) && r.value < 0 ? 0 : hang), base(t, cy), shownEst(r), { role, cls }));
    shown.forEach((c, j) => { if (r.cells?.[c.key] != null) body.push(text(t, colEnd[j], base(t, cy), String(r.cells[c.key]), { anchor: 'end' })); });
    if (wp(r)) body.push(text(t, xWt + wText, base(t, cy), wp(r), { anchor: 'end', role, cls }));
    return h;
  };
  units.forEach((u, i) => {
    // a group's name in bold in the names' column, an empty row before it unless it opens the page
    if (u.heading != null) { const hl = wrapText(t, u.heading, x0 - P - ls, 'head'), h = rowHeight(t, hl.length); if (i) y += t.row; body.push(lines(t, P, y + h / 2, hl, { role: 'head', cls: 'c-ink c-head' })); y += h; return; }
    if (u.apart) y += t.row;   // the figure's own total under its classes: an empty row before it, no name over it
    y += drawRow(u.rows[0], y, col.lines[k++]);
  });
  if (overall && closing) y += drawRow(overall, y, col.lines[k++]);
  if (het && closing) { body.push(text(t, P, base(t, y + t.row / 2), het)); y += t.row; }
  // the line of no effect from the rule to the axis, behind the rows; the axis under the plot, its ticks downwards
  const ay = y + ls * 0.4, tk = look.axis.tick * s, yText = ay + tk + look.axis.label * s + ls * 0.76;
  const parts = [rule(t, X(refV), ruleY, X(refV), ay, { width: t.line.null }), ...body, rule(t, x0, ay, x1, ay)];
  let rightEdge = -Infinity, low = yText;
  for (const v of ticks) {
    const label = minus(fmtNumber(back(v))), wd = measure(t, label), left = at(v) - wd / 2;
    parts.push(rule(t, at(v), ay, at(v), ay + tk));
    if (left < rightEdge + ls * 0.5) continue;
    parts.push(text(t, at(v), yText, label, { anchor: 'middle' })); rightEdge = left + wd;
  }
  const under = low + ls * 0.24 + look.axis.title * s + ls * 0.76;
  if (favours?.length === 2) { parts.push(text(t, X(refV) - ls * 0.6, under, favours[0], { anchor: 'end' }), text(t, X(refV) + ls * 0.6, under, favours[1])); low = under; }
  else if (xLabel) { parts.push(text(t, (x0 + x1) / 2, under, xLabel, { anchor: 'middle' })); low = under; }
  // a part with more to come says so at its foot, flush right; the notes and the source stand under the last part
  if (part?.next) { low += t.row; parts.push(text(t, w - P, low, part.next, { anchor: 'end', cls: 'c-ink c-continued' })); }
  const h = foot(t, parts, low, w, [...(closing ? [note, ...sourceOf(source)] : []), ...keyLines(col.keys)]);
  return svgRoot(t, w, h, parts.join(''), { title: title || xLabel });
}

/** The rows a forest plot draws: with `piInline` a prediction interval row right after a pooled row of its group is drawn through that row's diamond, not as a row of its own. */
const forestRows = (rows0, piInline) => (piInline ? rows0.reduce((out, r) => { const last = out.at(-1);
  if (r.interval && last?.pooled && !last.pi && (last.group ?? null) === (r.group ?? null)) out[out.length - 1] = { ...last, pi: { lo: r.lo, hi: r.hi } }; else out.push(r); return out; }, []) : rows0);
/** The height of a drawing in its own unit (the root's viewBox). */
const depthOf = svg => Number(/<svg[^>]*\sviewBox="[\d.]+ [\d.]+ [\d.]+ ([\d.]+)"/.exec(svg)?.[1] ?? NaN);
/**
 * A forest plot on the pages it takes: one drawing (journalForest's) when it is no deeper than `last`, else its rows carried on in parts, as a
 * style whose figure declares `continues` has it (the journal sets a long plot no smaller and no closer than its others: the type and the row
 * pitch are the declaration's on every part). Each part is no deeper than `height`, and the last no deeper than `last` (the room its page
 * leaves beside the legend; default `height`), both in the drawing's unit. No part holds a single row: a total standing alone at the
 * head of a page reads as a figure of its own. Whole classes first: the fewest parts that each end between two groups (a total with no
 * group of its own stays with the class before it), and of those the most even, so that the pages are about as full as each other (the
 * last counted with the room its legend takes). Where a class is deeper than a page, or whole classes would leave a part of one row,
 * the rows go on as the pages hold them: a part ends between two groups where that leaves it at least six tenths of what the page
 * holds, else between two rows, never right under a group's name, nor before a total, nor with one row left for the last part. Every
 * part has the heads and the axis of the whole figure, the words for what goes on at its foot ("(Figure 2 continues on next page)",
 * `place` the figure's name) and, after the first, under its rule ("(Continued from previous page)"). Returns the SVG of each part in order.
 */
export function journalForestParts(rows0, opts = {}, { height = Infinity, last = height, place = '' } = {}) {
  const words = opts.look?.continues, whole = journalForest(rows0, opts);
  if (!words || !(height > 0) || !(depthOf(whole) > Math.min(height, last) + 0.05)) return [whole];
  const rows = forestRows(rows0, !!opts.piInline), n = rows.length, next = words.next.replace('{figure}', String(place || '').trim() || 'Figure');
  const draw = (offset, count, final) => journalForest(rows0, { ...opts, offset, page: count, part: { final, previous: offset > 0 ? words.previous : '', next: final ? '' : next } });
  const group = i => rows[i]?.group ?? null, out = [];
  // whole classes: the ends a part may have (before a row that opens a named group), and each stretch between two of them drawn once
  const ends = [0]; for (let i = 1; i < n; i++) if (group(i) != null && group(i) !== group(i - 1)) ends.push(i); ends.push(n);
  const m = ends.length - 1, drawn = new Map(), part = (i, j) => { const k = i * (m + 1) + j; if (!drawn.has(k)) { const svg = draw(ends[i], ends[j] - ends[i], j === m); drawn.set(k, { svg, depth: depthOf(svg) }); } return drawn.get(k); };
  const fits = (i, j) => ends[j] - ends[i] >= 2 && part(i, j).depth <= (j === m ? last : height) + 0.05;
  // how full a part makes its page: its depth, and for the last the room the legend takes beside it
  const full = (i, j) => part(i, j).depth + (j === m && Number.isFinite(height) ? Math.max(0, height - last) : 0);
  // best[j]: over the first j classes in k parts, the shallowest deepest part and where its last part begins; the fewest parts that reach the end
  let best = Array.from({ length: m + 1 }, (_, j) => (j ? null : { deep: 0, from: -1, before: null }));
  for (let k = 1; k <= m && m > 1; k++) {
    const now = Array(m + 1).fill(null);
    for (let i = 0; i < m; i++) if (best[i]) for (let j = i + 1; j <= m; j++) {
      if (part(i, j).depth > height + 0.05) break;   // deeper than a page, and so is every longer stretch from here
      if (!fits(i, j)) continue;
      const deep = Math.max(best[i].deep, full(i, j)); if (!now[j] || deep < now[j].deep - 0.05) now[j] = { deep, from: i, before: best[i] };
    }
    best = now;
    if (best[m]) { const cuts = []; for (let at = best[m], j = m; at && at.from >= 0; j = at.from, at = at.before) cuts.unshift([at.from, j]); return cuts.map(([i, j]) => part(i, j).svg); }
  }
  // the rows as the pages hold them
  for (let at = 0; at < n;) {
    const rest = draw(at, n - at, true);
    if (depthOf(rest) <= last + 0.05 || n - at < 2) { out.push(rest); break; }
    // as many rows as the page holds, two at least left for the last part (one where there are no more)
    let lo = 1, hi = Math.max(1, n - at - 2), fit = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (depthOf(draw(at, mid, false)) <= height + 0.05) { fit = mid; lo = mid + 1; } else hi = mid - 1; }
    if (!fit) { out.push(rest); break; }   // a page that holds no row: the rest stands as it is
    let cut = 0;
    for (let c = fit; c >= Math.max(1, Math.ceil(fit * 0.6)) && !cut; c--) if (group(at + c) != null && group(at + c) !== group(at + c - 1)) cut = c;
    if (!cut) { cut = fit; while (cut > 1 && (rows[at + cut]?.pooled || group(at + cut - 1) !== group(at + cut - 2))) cut--; }
    out.push(draw(at, cut, false)); at += cut;
  }
  return out;
}

// ---- bubble plot -------------------------------------------------------------------------------------------------------------------
/**
 * Points on two numbers as scatterChart takes them: open circles in a line of the declared colour, the radius by the root of the weight;
 * the fitted line solid in the fit's colour over its interval (a band of the declared tint, or two dashed lines); a reference value as a
 * dashed line of the ink.
 */
export function journalScatter(points, { style: t, look, width, title = 'Scatter', xLabel = '', yLabel = '', line = null, fmtY = plain, fmtX = plain, yDomain = null, ref = null, source = [] } = {}) {
  const S = look.scatter, s = scaleOf(t, look), w = width || t.width.double, P = t.pad, ls = t.size.label;
  if (!points.length) return svgRoot(t, w, P * 2 + ls, '', { title });
  const band = line ? [line.from, line.to].flatMap(x => line.band(x)) : [];
  const xs = scale(points.map(p => p.x), null, 6), ys = scale([...points.map(p => p.y), ...(Number.isFinite(ref) ? [ref] : []), ...band], yDomain, 5);
  const fy = v => minus(fmtY(v)), fx = v => minus(fmtX(v)), tk = look.axis.tick * s, rMax = S.point.max * s;
  const left = P + (yLabel ? ls * 1.9 : 0) + Math.max(...ys.ticks.map(v => measure(t, fy(v)))) + look.axis.label * s + tk;
  const box = { x: left, y: P + ls * 0.5, w: w - left - P - rMax * 0.5, h: 0 }; box.h = Math.round(box.w * 0.5);
  const X = v => box.x + box.w * (v - xs.lo) / (xs.hi - xs.lo || 1), Y = v => box.y + box.h * (1 - (v - ys.lo) / (ys.hi - ys.lo || 1));
  const inside = v => v >= ys.lo - 1e-9 && v <= ys.hi + 1e-9, clampY = v => Math.min(ys.hi, Math.max(ys.lo, v));
  const parts = [], refLine = Number.isFinite(ref) && inside(ref) ? rule(t, box.x, Y(ref), box.x + box.w, Y(ref), { dash: S.ref.map(v => v * s), cls: 'c-ref' }) : '';
  if (line) {
    const n = 120, at = Array.from({ length: n + 1 }, (_, i) => line.from + (line.to - line.from) * i / n);
    const curve = (of, dash) => { const d = pathOf(at.map(x => [X(x), Y(of(x)), of(x)]), inside); return d ? `<path class="${dash ? 'c-band' : 'c-fit'}" d="${d}" fill="none" stroke="${S.fit.color}" stroke-width="${t.line.ci}"${dash ? ` stroke-dasharray="${dash.map(v => r1(v * s)).join(' ')}"` : ''}/>` : ''; };
    // the interval: a band of the declared tint, cut at the axis's limits; two dashed lines for a style that declares no band
    if (at.some(x => line.band(x)[0] !== line.band(x)[1])) parts.push(...(S.fit.band
      ? [`<path class="c-band" d="M${at.map(x => `${r1(X(x))} ${r1(Y(clampY(line.band(x)[0])))}`).join('L')}L${[...at].reverse().map(x => `${r1(X(x))} ${r1(Y(clampY(line.band(x)[1])))}`).join('L')}Z" fill="${S.fit.band}"/>`]
      : [curve(x => line.band(x)[0], S.fit.dash), curve(x => line.band(x)[1], S.fit.dash)]));
    parts.push(refLine, curve(x => line.at(x), null));   // the reference line over the band, under the fitted line
  } else parts.push(refLine);
  // with fixed y limits a point beyond them sits on the edge (its hover title keeps its value)
  points.forEach((p, i) => { const r = (S.point.min + (S.point.max - S.point.min) * Math.sqrt(Math.max(0, Math.min(1, p.weight ?? 0.3)))) * s;
    parts.push(`<circle data-chart-mark="p${i}"${attrsOf(p.attrs)} cx="${r1(X(p.x))}" cy="${r1(Y(clampY(p.y)))}" r="${r1(r)}" class="c-bubble" fill="none" pointer-events="all" stroke="${S.point.color}" stroke-width="${r1(S.point.line * s * 100) / 100}"><title>${esc(p.text || `${p.label}: ${fmtX(p.x)}, ${fmtY(p.y)}`)}</title></circle>`); });
  const low = axes(t, look, parts, box, { X, Y, xTicks: xs.ticks, yTicks: ys.ticks, fmtX: fx, fmtY: fy, xLabel, yLabel });
  return svgRoot(t, w, foot(t, parts, low, w, sourceOf(source)), parts.join(''), { title });
}

// ---- funnel plot -------------------------------------------------------------------------------------------------------------------
/**
 * A funnel plot as funnelChart takes it (lib/make-stats.mjs funnelData): each study a small circle in a tint with a line of the declared
 * colour, the standard error downwards, a solid line at the pooled value and the 95% pseudo-interval as the fit's interval is drawn (a
 * region in the band's tint, or two dashed lines of the ink).
 */
export function journalFunnel({ points, mu, seMax, left, right }, { style: t, look, width, title = 'Funnel plot', xLabel = '', labels = [], show = v => v, fmtX = plain, attrsOf: of = () => ({}), xDomain = null, source = [] } = {}) {
  const U = look.funnel, s = scaleOf(t, look), w = width || t.width.single, P = t.pad, ls = t.size.label, tk = look.axis.tick * s;
  const xs = scale([left[0], right[0], ...points.map(p => p.y)], xDomain, 5), ys = niceTicks(0, seMax || 1, 4), fy = v => plain(Math.round(v * 100) / 100), fx = v => minus(fmtX(show(v)));
  const x = P + ls * 1.9 + Math.max(...ys.ticks.map(v => measure(t, fy(v)))) + look.axis.label * s + tk;
  const box = { x, y: P + ls * 0.5, w: w - x - P - ls, h: 0 }; box.h = Math.round(box.w * 0.64);
  const X = v => box.x + box.w * (v - xs.lo) / (xs.hi - xs.lo || 1), Y = se => box.y + box.h * se / (ys.hi || 1), cx = v => Math.min(xs.hi, Math.max(xs.lo, v));
  // a side of the pseudo-interval from the pooled value at no error to its foot, cut where it leaves the axis
  const side = ([fx0, fse]) => { const far = cx(fx0), k = fx0 === mu ? 1 : (far - mu) / (fx0 - mu); return rule(t, X(cx(mu)), Y(0), X(far), Y(fse * k), { dash: look.scatter.fit.dash.map(v => v * s), cls: 'c-band' }); };
  // with a band declared the region between the two sides is filled in its tint, down to the largest error and cut at the axis's limits
  const cutAt = ([fx0, fse]) => { const far = cx(fx0), k = fx0 === mu ? 1 : (far - mu) / (fx0 - mu); return [[X(far), Y(fse * k)], [X(far), Y(fse)]]; };
  const region = look.scatter.fit.band ? `<polygon class="c-band" points="${poly([[X(cx(mu)), Y(0)], ...cutAt(left), ...cutAt(right).reverse()])}" fill="${look.scatter.fit.band}"/>` : '';
  const parts = mu >= xs.lo && mu <= xs.hi ? [...(region ? [region] : [side(left), side(right)]), rule(t, X(mu), box.y, X(mu), box.y + box.h, { cls: 'c-fit' })] : [];
  points.forEach((p, i) => parts.push(`<circle data-chart-mark="f${i}"${attrsOf(of(i))} cx="${r1(X(cx(p.y)))}" cy="${r1(Y(p.se))}" r="${r1(U.point.size * s / 2)}" class="c-dot" fill="${U.point.fill || t.color.page}" stroke="${U.point.color}" stroke-width="${t.line.ci}"><title>${esc(`${labels[i] || `Study ${i + 1}`}: ${fmtX(show(p.y))}, SE ${fy(p.se)}`)}</title></circle>`));
  const low = axes(t, look, parts, box, { X, Y, xTicks: xs.ticks, yTicks: ys.ticks, fmtX: fx, fmtY: fy, xLabel, yLabel: 'Standard error' });
  return svgRoot(t, w, foot(t, parts, low, w, sourceOf(source)), parts.join(''), { title });
}

// ---- risk of bias ------------------------------------------------------------------------------------------------------------------
const robColumns = tool => [...tool.domains, ...(tool.overall ? [{ id: 'overall', short: 'Overall', label: 'Overall' }] : []), ...(tool.after || [])];
const levelOf = (word, tones) => (word ? robLevel(word, tones?.[word]) : 'na');
/** The key of the judgements a figure draws, each a mark and the instrument's word for it, on lines of the figure's pitch from (x, y). Returns the lowest baseline. */
function robKey(t, look, parts, key, x, y, w, swatch) {
  const ls = t.size.label, lead = ls * look.lead;
  let cx = x, cy = y;
  for (const k of key) {
    const m = swatch(k.level, 0, 0, true), iw = m.w + ls * 0.4 + measure(t, k.word) + ls * 1.6;
    if (cx + iw - ls * 1.6 > w - t.pad && cx > x) { cx = x; cy += lead; }
    parts.push(swatch(k.level, cx, cy).svg, text(t, cx + m.w + ls * 0.4, cy, k.word));
    cx += iw;
  }
  return cy;
}

/**
 * One row per study and one column per domain in a ruled grid, a circle of the judgement's ink with no outline in each cell, the level's
 * glyph in it; the heads across when each fits its column, else turned to read upwards; the key under the grid.
 */
export function journalTrafficLight(tool, rows, tones, { style: t, look, source = [] } = {}) {
  const R = look.rob, s = scaleOf(t, look), P = t.pad, ls = t.size.label, lead = ls * look.lead, cols = robColumns(tool), key = robKeyLevels(tool, rows, tones);
  const col = labelColumn(t, rows.map(r => r.label), t.width.double * 0.45), pitch0 = R.column * s, widest = Math.max(0, ...cols.map(c => measure(t, c.short)));
  const across = widest + ls * 0.8 <= pitch0 * 1.5, pitch = across ? Math.max(pitch0, widest + ls * 0.8) : pitch0, heads = cols.map(c => (across ? [c.short] : wrapText(t, c.label, 96 * s).slice(0, 2)));
  const headH = across ? lead + ls * 0.3 : Math.max(...heads.flatMap(h => h.map(l => measure(t, l)))) + ls * 0.8;
  const gx = P + col.w + ls * 0.4, right = gx + cols.length * pitch, w = right + P, top = P, r = R.mark * s / 2, parts = [];
  // the level's glyph in each mark (plus, minus, cross …: the house's, lib/rob-palette.mjs), so a judgement reads without its colour and a legend that names the signs holds
  const glyph = (level, x, y, rad) => glyphSvg(level, x, y, rad, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } });
  cols.forEach((c, i) => {
    const cx = gx + i * pitch + pitch / 2, full = c.label !== c.short && across ? `<title>${esc(c.label)}</title>` : '';
    if (across) parts.push(text(t, cx, top + headH - ls * 0.5, c.short, { anchor: 'middle', inner: full }));
    else heads[i].forEach((l, j) => { const x = cx + (j - (heads[i].length - 1) / 2) * lead + ls * 0.35; parts.push(text(t, 0, 0, l, { attrs: `transform="translate(${r1(x)} ${r1(top + headH - ls * 0.4)}) rotate(-90)"` })); });
  });
  let y = top + headH;
  const y0 = y;
  rows.forEach((row, k) => {
    const ln = col.lines[k], h = Math.max(R.row * s, rowHeight(t, ln.length)), cy = y + h / 2;
    parts.push(rule(t, P, y, right, y, { cls: 'c-grid' }), lines(t, P + ls * 0.3, cy, ln, { inner: fullTitle(row.label, ln) }));
    cols.forEach((c, i) => {
      const word = row.values[c.id], level = levelOf(word, tones), tipText = `${row.label}, ${c.label}: ${word || 'Not assessed'}`;
      const mx = gx + i * pitch + pitch / 2;
      parts.push(level === 'na' ? `<g><title>${esc(tipText)}</title></g>` : `<g><circle class="c-rob" cx="${r1(mx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${robFill(t, level)}"/>${glyph(level, mx, cy, r)}<title>${esc(tipText)}</title></g>`);
    });
    y += h;
  });
  parts.push(rule(t, P, y, right, y, { cls: 'c-grid' }));
  for (let i = 0; i <= cols.length; i++) parts.push(rule(t, gx + i * pitch, top, gx + i * pitch, y, { cls: 'c-grid' }));
  const dot = (level, x, cy, sizeOnly = false) => ({ w: r * 2, svg: sizeOnly ? '' : `<circle class="c-rob" cx="${r1(x + r)}" cy="${r1(cy - ls * 0.35)}" r="${r1(r)}" fill="${robFill(t, level)}"/>${glyph(level, x + r, cy - ls * 0.35, r)}` });
  const ky = rows.length || y0 ? robKey(t, look, parts, key, P, y + lead + r, Math.max(w, t.width.single), dot) : y;
  const domains = tool.domains.filter(d => d.short !== d.label && across).map(d => `${d.short} ${d.label}`).join('; ');
  const h = foot(t, parts, ky, w, [domains, ...sourceOf(source), ...keyLines(col.keys)]);
  return svgRoot(t, Math.max(w, Math.min(t.width.single, P * 2 + key.reduce((n, k) => n + r * 2 + ls * 2 + measure(t, k.word), 0))), h, parts.join(''), { title: `${tool.name} traffic light` });
}

/**
 * One bar per domain on a 0 to 100% axis: the share of studies at each level in the level's tint with an outline of the ink and the
 * level's glyph where it fits, the key of swatches over the bars; with `weights` each study counts by its weight (studies without one
 * are left out).
 */
export function journalSummary(tool, rows, tones, { style: t, look, weights = null, source = [] } = {}) {
  const R = look.rob, B = R.bar, s = scaleOf(t, look), P = t.pad, ls = t.size.label, lead = ls * look.lead, tk = look.axis.tick * s, cols = robColumns(tool), key = robKeyLevels(tool, rows, tones);
  const w = t.width.single, col = labelColumn(t, cols.map(c => c.label), w * 0.5), x0 = P + col.w + tk, barW = w - x0 - P - measure(t, '100%') / 2, bh = B.height * s;
  const tint = lv => ({ low: B.good, concerns: B.unclear, high: B.bad }[lv] || (lv === 'na' ? t.rob.none : robFill(t, lv)));
  const used = weights ? rows.filter(r => weights.get(r.label) > 0) : rows, wt = r => (weights ? weights.get(r.label) : 1), total = used.reduce((n, r) => n + wt(r), 0) || 1;
  const parts = [], [kw, kh] = R.key.map(v => v * s);
  const sw = (level, x, y, sizeOnly = false) => ({ w: kw, svg: sizeOnly ? '' : `<rect class="c-rob-edge" x="${r1(x)}" y="${r1(y - ls * 0.35 - kh / 2)}" width="${r1(kw)}" height="${r1(kh)}" fill="${tint(level)}" stroke="${t.color.ink}" stroke-width="${t.line.box}"/>` });
  // the key stands over the bars, a level to a line
  let y = P + ls * 0.8;
  for (const k of key) { parts.push(sw(k.level, x0, y).svg, text(t, x0 + kw + ls * 0.35, y, k.word)); y += lead; }
  y += key.length ? ls * 0.4 : 0;
  const top = y, edges = [y];
  cols.forEach((c, k) => {
    const ln = col.lines[k], h = Math.max(B.pitch * s, rowHeight(t, ln.length)), cy = y + h / 2, sums = new Map(), ns = new Map();
    parts.push(lines(t, x0 - tk - look.axis.label * s, cy, ln, { anchor: 'end', inner: fullTitle(c.label, ln) }));
    for (const r of used) { const lv = levelOf(r.values[c.id], tones); sums.set(lv, (sums.get(lv) || 0) + wt(r)); ns.set(lv, (ns.get(lv) || 0) + 1); }
    let x = x0;
    for (const lv of ROB_LEVELS) {
      const v = sums.get(lv) || 0;
      if (!v) continue;
      const sWidth = barW * v / total, pct = Math.round(100 * v / total), word = key.find(q => q.level === lv)?.word || 'Not assessed';
      parts.push(`<rect class="c-rob-edge" x="${r1(x)}" y="${r1(cy - bh / 2)}" width="${r1(sWidth)}" height="${r1(bh)}" fill="${tint(lv)}" stroke="${t.color.ink}" stroke-width="${t.line.box}"><title>${esc(c.label)}, ${esc(word)}: ${ns.get(lv)} of ${used.length}${weights ? `, ${pct}% of weight` : ''}</title></rect>`);
      if (lv !== 'na' && sWidth >= bh * 1.4) parts.push(glyphSvg(lv, x + sWidth / 2, cy, bh * 0.36, { inks: { dark: t.rob.glyph, light: t.rob.glyph } }));
      x += sWidth;
    }
    y += h; edges.push(y);
  });
  // the axes: a line at the left with a tick between the bars, a line at the foot with a tick at every quarter
  parts.push(rule(t, x0, top, x0, y + tk), rule(t, x0 - tk, y, x0 + barW, y), ...edges.slice(0, -1).map(e => rule(t, x0 - tk, e, x0, e)));
  const yText = y + tk + look.axis.label * s + ls * 0.76;
  for (const v of [0, 25, 50, 75, 100]) parts.push(rule(t, x0 + barW * v / 100, y, x0 + barW * v / 100, y + tk), text(t, x0 + barW * v / 100, yText, `${v}%`, { anchor: 'middle' }));
  const h = foot(t, parts, yText, w, [weights ? 'Weighted by the pooled analysis' : '', ...sourceOf(source), ...keyLines(col.keys)]);
  return svgRoot(t, w, h, parts.join(''), { title: `${tool.name} summary${weights ? ', weighted' : ''}` });
}

// ---- bars and columns --------------------------------------------------------------------------------------------------------------
/** Horizontal bars, one per row, in the first series colour with an outline of the ink, the value after each bar; a group's name in bold. */
export function journalBar(rows, { style: t, look, width, title = '', xLabel = '', note = '', source = [], offset = 0, page = Infinity, domain = null } = {}) {
  const s = scaleOf(t, look), w = width || t.width.single, P = t.pad, ls = t.size.label, tk = look.axis.tick * s, bh = look.rob.bar.height * s * 0.7;
  const units = pageUnits(rows, { offset, page }), items = units.filter(u => u.heading == null), vals = rows.map(r => r.value ?? 0).concat(domain || []);
  const ax = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals) || 1, 4, { zero: true }), show = r => (r.value == null ? '–' : signed(r.value));
  const valueW = Math.max(measure(t, '0'), ...rows.map(r => measure(t, show(r)))) + ls * 0.6, col = labelColumn(t, items.map(u => u.label), w * 0.45);
  const x0 = P + col.w + tk + (ax.lo < 0 ? valueW : 0), plotW = Math.max(ls * 4, w - x0 - P - valueW), X = v => x0 + plotW * (v - ax.lo) / (ax.hi - ax.lo || 1), zx = X(0);
  const parts = [];
  let y = P, k = 0;
  units.forEach((u, i) => {
    if (u.heading != null) { if (i) y += t.row * 0.5; parts.push(text(t, P, base(t, y + t.row / 2), u.heading, { role: 'head', cls: 'c-ink c-head' })); y += t.row; return; }
    const r = u.rows[0], ln = col.lines[k++], h = Math.max(t.row * 1.3, rowHeight(t, ln.length)), cy = y + h / 2, v = r.value ?? 0, end = X(v);
    parts.push(lines(t, zx - tk - look.axis.label * s - (ax.lo < 0 ? valueW : 0), cy, ln, { anchor: 'end', inner: fullTitle(u.label, ln) }));
    if (v) parts.push(`<rect ${mark(r)} class="c-bar" x="${r1(Math.min(zx, end))}" y="${r1(cy - bh / 2)}" width="${r1(Math.abs(end - zx))}" height="${r1(bh)}" fill="${t.color.mark}" stroke="${t.color.ink}" stroke-width="${t.line.box}">${tip(u.label, fmtNumber(v))}</rect>`);
    parts.push(text(t, v < 0 ? end - ls * 0.4 : end + ls * 0.4, base(t, cy), show(r), { anchor: v < 0 ? 'end' : 'start' }));
    y += h;
  });
  parts.push(rule(t, zx, P, zx, y + tk), rule(t, x0 - tk, y, x0 + plotW, y));
  const yText = y + tk + look.axis.label * s + ls * 0.76;
  for (const v of ax.ticks) parts.push(rule(t, X(v), y, X(v), y + tk), text(t, X(v), yText, signed(v), { anchor: 'middle' }));
  let low = yText;
  if (xLabel) { low = yText + ls * 0.24 + look.axis.title * s + ls * 0.76; parts.push(text(t, x0 + plotW / 2, low, xLabel, { anchor: 'middle' })); }
  return svgRoot(t, w, foot(t, parts, low, w, [note, ...sourceOf(source), ...keyLines(col.keys)]), parts.join(''), { title: title || xLabel });
}

/** Vertical bars over an ordered axis in the first series colour with an outline of the ink, on two axes; labels thinned when they would collide. */
export function journalColumn(rows, { style: t, look, width, title = '', xLabel = '', yLabel = '', note = '', source = [] } = {}) {
  const s = scaleOf(t, look), w = width || t.width.single, P = t.pad, ls = t.size.label, tk = look.axis.tick * s, n = Math.max(1, rows.length);
  const vals = rows.map(r => r.value ?? 0), ax = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals) || 1, 4, { zero: true });
  const left = P + (yLabel ? ls * 1.9 : 0) + Math.max(...ax.ticks.map(v => measure(t, signed(v)))) + look.axis.label * s + tk;
  const box = { x: left, y: P + ls * 0.5, w: w - left - P, h: Math.round((w - left - P) * 0.5) }, bw = box.w / n, gap = Math.min(bw * 0.3, 6 * s);
  const Y = v => box.y + box.h * (1 - (v - ax.lo) / (ax.hi - ax.lo || 1)), zy = Y(0), y0 = box.y + box.h, parts = [];
  rows.forEach((r, i) => {
    const v = r.value ?? 0;
    if (v) parts.push(`<rect ${mark(r)} class="c-bar" x="${r1(box.x + i * bw + gap / 2)}" y="${r1(Math.min(Y(v), zy))}" width="${r1(Math.max(0.5, bw - gap))}" height="${r1(Math.abs(zy - Y(v)))}" fill="${t.color.mark}" stroke="${t.color.ink}" stroke-width="${t.line.box}">${tip(r.title || r.label, fmtNumber(v))}</rect>`);
  });
  parts.push(rule(t, box.x, box.y, box.x, y0 + tk), rule(t, box.x - tk, y0, box.x + box.w, y0));
  if (zy < y0 - 0.05) parts.push(rule(t, box.x, zy, box.x + box.w, zy));
  for (const v of ax.ticks) parts.push(rule(t, box.x - tk, Y(v), box.x, Y(v)), text(t, box.x - tk - look.axis.label * s, base(t, Y(v)), signed(v), { anchor: 'end' }));
  const yText = y0 + tk + look.axis.label * s + ls * 0.76, widest = Math.max(0, ...rows.map(r => measure(t, String(r.label)))) + ls, every = Math.max(1, Math.ceil(widest / bw));
  rows.forEach((r, i) => { if (i % every) return; const cx = box.x + i * bw + bw / 2; parts.push(rule(t, cx, y0, cx, y0 + tk), text(t, cx, yText, String(r.label), { anchor: 'middle', attrs: mark(r) })); });
  let low = yText;
  if (xLabel) { low = yText + ls * 0.24 + look.axis.title * s + ls * 0.76; parts.push(text(t, box.x + box.w / 2, low, xLabel, { anchor: 'middle' })); }
  if (yLabel) parts.push(text(t, 0, 0, yLabel, { anchor: 'middle', attrs: `transform="translate(${r1(P + ls * 0.8)} ${r1(box.y + box.h / 2)}) rotate(-90)"` }));
  return svgRoot(t, w, foot(t, parts, low, w, [note, ...sourceOf(source)]), parts.join(''), { title: title || yLabel || xLabel });
}

/** The chart types a journal's look draws; any other type keeps the house drawing in the journal's type, ink and line weight. */
export const JOURNAL_CHART_TYPES = Object.freeze(['forest', 'scatter', 'funnel', 'traffic-light', 'rob-summary', 'bar', 'column']);

/**
 * What lib/output-render.mjs draws a chart with for the style, or null when the style declares no chart:
 *   { id, style (the tokens), look, fit(widthIn, k) (the tokens of a chart fitted to a page box), draw: { <type>: the drawing },
 *     parts: { <type>: the drawing on the pages it takes } | null (a style whose figure declares `continues`) }
 * Each drawing takes what the house drawing of its type takes and answers the SVG, its decimal points set as the style sets them (its
 * `decimalMark`: display only, as in the journal's text).
 */
export function journalCharts(style) {
  const look = chartLook(style);
  if (!look) return null;
  const marked = svg => (look.decimalMark ? decimalMarks(svg, look.decimalMark) : svg);
  const rowChart = f => (rows, o = {}) => marked(f(rows, { ...o, look })), robChart = f => (tool, rows, tones, o = {}) => marked(f(tool, rows, tones, { ...o, look }));
  return { id: look.id, style: journalChartTokens(style), look, fit: (widthIn = null, k = 1) => journalChartTokens(style, { widthIn, k }),
    // the types a style that declares `continues` carries over pages in place of setting them smaller (lib/output-render.mjs chartParts)
    parts: look.continues ? { forest: (rows, o = {}, box = {}) => journalForestParts(rows, { ...o, look }, box).map(marked) } : null,
    draw: { forest: rowChart(journalForest), scatter: rowChart(journalScatter), funnel: rowChart(journalFunnel), bar: rowChart(journalBar), column: rowChart(journalColumn),
      'traffic-light': robChart(journalTrafficLight), 'rob-summary': robChart(journalSummary) } };
}
