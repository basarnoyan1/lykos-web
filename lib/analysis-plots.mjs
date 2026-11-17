// The house drawings of the analyses added for research coverage (plan W7; lib/dataset-analysis.mjs): a run or control chart with its
// centre line and limits drawn, a cost-effectiveness plane and a cost-effectiveness acceptability curve. FIGURE-STYLE §2: L-shaped axes,
// no frame, no gridlines; the data in ink, reference lines in axis grey; a line is named at its end or in the note, never by hue.
// A point beyond a control limit is told by weight and fill (ink, larger), not by colour.
import { niceTicks, fmtNumber } from './output-charts.mjs';
import { text, measure } from './figure-draw.mjs';
import { xyPlot, noteFigure, seriesStyle, strokeOf, dashOf, seg, pathOf, dot, tip, finite, widthOf, sourceOf } from './plot-draw.mjs';

// 4% on each side; a range that starts at zero or above does not go below zero
const pad = (lo, hi) => { const s = (hi - lo) || Math.abs(hi) || 1; return [lo >= 0 ? Math.max(0, lo - s * 0.04) : lo - s * 0.04, hi + s * 0.04]; };
const refAttrs = (t, key) => `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}" data-line="${key}"`;
const inkAttrs = (t, key) => `class="c-line" stroke="${t.color.ink}" stroke-width="${Math.round(t.line.ci * 110) / 100}" data-line="${key}"`;

/** Labels at the right ends of horizontal lines, pushed apart so that two close lines do not print over each other. */
function endLabels(t, P, x, lines) {
  const sm = t.size.small, at = lines.map(l => ({ l, y: P.Y(l.y) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < at.length; i++) at[i].y = Math.max(at[i].y, at[i - 1].y + sm * 1.35);
  return at.map(a => text(t, x + t.size.label * 0.4, a.y + t.size.label * 0.35, a.l.label)).join('');
}

/**
 * A run chart or a control chart: `points` [[x, y, lcl?, ucl?, beyond?]] in time order, joined by a line; the centre line (`centre`,
 * named `centreLabel`); with `limits`, each point's lower and upper limit as a step (straight when they are equal throughout).
 */
export function houseSpc({ points, centre, centreLabel = 'Centre', limits = false, title = '', xLabel = '', yLabel = '' }, o = {}) {
  const t = o.style, pts = (points || []).filter(p => finite(p[0], p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2 || !Number.isFinite(centre)) return noteFigure(t, { title: title || 'Run chart', message: 'Not drawn: fewer than two points in order.', width: o.width, source: o.source });
  const lim = !!limits && pts.every(p => finite(p[2], p[3])), last = pts.at(-1);
  const ys = [...pts.map(p => p[1]), centre, ...(lim ? pts.flatMap(p => [p[2], p[3]]) : [])], xs = pts.map(p => p[0]);
  const xa = niceTicks(...pad(Math.min(...xs), Math.max(...xs)), 6), ya = niceTicks(...pad(Math.min(...ys), Math.max(...ys)), 5);
  const lines = [{ y: centre, label: `${centreLabel} ${fmtNumber(centre)}`, key: 'centre' },
    ...(lim ? [{ y: last[3], label: `Upper limit ${fmtNumber(last[3])}`, key: 'ucl' }, { y: last[2], label: `Lower limit ${fmtNumber(last[2])}`, key: 'lcl' }] : [])];
  const w = widthOf(t, o.width, 'double'), labW = Math.max(...lines.map(l => measure(t, l.label))) + t.size.label * 0.6;
  const P = xyPlot(t, { width: w, plotH: w * 0.36, xdom: [xa.lo, xa.hi], ydom: [ya.lo, ya.hi], xticks: xa.ticks, yticks: ya.ticks, xLabel, yLabel, rightPad: labW,
    title: title || 'Run chart', source: o.source, desc: `${lim ? 'Control' : 'Run'} chart, ${pts.length} points${lim ? `, ${pts.filter(p => p[4]).length} beyond the limits` : ''}`, seed: String(pts.length) });
  const x0 = P.X(pts[0][0]), x1 = P.X(last[0]);
  const parts = [seg(x0, P.Y(centre), x1, P.Y(centre), `${strokeOf(seriesStyle(t, 3))} data-line="centre"`)];
  if (lim) for (const [k, key] of [[3, 'ucl'], [2, 'lcl']]) {
    // a step: each point's limit from halfway to its neighbour on one side to halfway on the other
    const steps = pts.flatMap((p, i) => {
      const a = i ? (P.X(pts[i - 1][0]) + P.X(p[0])) / 2 : P.X(p[0]), b = i < pts.length - 1 ? (P.X(p[0]) + P.X(pts[i + 1][0])) / 2 : P.X(p[0]);
      return [[a, P.Y(p[k])], [b, P.Y(p[k])]];
    });
    parts.push(pathOf(steps, refAttrs(t, key)));
  }
  parts.push(pathOf(pts.map(p => [P.X(p[0]), P.Y(p[1])]), inkAttrs(t, 'data')));
  const dots = pts.map(p => (p[4]
    ? dot(t, P.X(p[0]), P.Y(p[1]), t.dot * 1.15, { inner: tip(`${fmtNumber(p[0])}: ${fmtNumber(p[1])}, beyond the limits`), attrs: 'data-beyond="1"' })
    : dot(t, P.X(p[0]), P.Y(p[1]), t.dot * 0.75, { grey: true, inner: tip(`${fmtNumber(p[0])}: ${fmtNumber(p[1])}`) })));
  return P.finish({ clipped: parts.join(''), over: dots.join('') + endLabels(t, P, P.X(xa.hi), lines) });
}

/**
 * A cost-effectiveness plane: replicates `points` [[ΔE, ΔC]] around the origin's two axes, the point estimate `mean` [ΔE, ΔC] in ink,
 * and with `wtp` the willingness-to-pay line ΔC = λΔE through the origin, dashed (named in the note under the plot).
 */
export function houseCePlane({ points, mean = null, wtp = null, title = '', xLabel = '', yLabel = '' }, o = {}) {
  const t = o.style, pts = (points || []).filter(p => finite(p[0], p[1]));
  if (!pts.length) return noteFigure(t, { title: title || 'Cost-effectiveness plane', message: 'Not drawn: there are no replicates to plot.', width: o.width, source: o.source });
  const m = mean && finite(mean[0], mean[1]) ? mean : null;
  const xs = [0, ...pts.map(p => p[0]), ...(m ? [m[0]] : [])], ys = [0, ...pts.map(p => p[1]), ...(m ? [m[1]] : [])];
  const xa = niceTicks(...pad(Math.min(...xs), Math.max(...xs)), 5), ya = niceTicks(...pad(Math.min(...ys), Math.max(...ys)), 5), w = widthOf(t, o.width, 'single');
  const lam = Number.isFinite(wtp) && wtp >= 0 ? wtp : null;
  const note = [`${pts.length} replicates; filled point: the estimate${lam != null ? `; dashed line: willingness to pay ${fmtNumber(lam)} per unit of effect` : ''}`, ...sourceOf(o.source)];
  const P = xyPlot(t, { width: w, plotH: w * 0.8, xdom: [xa.lo, xa.hi], ydom: [ya.lo, ya.hi], xticks: xa.ticks, yticks: ya.ticks, xLabel, yLabel,
    title: title || 'Cost-effectiveness plane', source: note, desc: `Cost-effectiveness plane, ${pts.length} replicates`, seed: String(pts.length) });
  const axis = `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}"`;
  const parts = [seg(P.X(xa.lo), P.Y(0), P.X(xa.hi), P.Y(0), `${axis} data-line="zero-cost"`), seg(P.X(0), P.Y(ya.lo), P.X(0), P.Y(ya.hi), `${axis} data-line="zero-effect"`)];
  if (lam != null) parts.push(seg(P.X(xa.lo), P.Y(lam * xa.lo), P.X(xa.hi), P.Y(lam * xa.hi), refAttrs(t, 'wtp')));
  parts.push(...pts.map(([x, y]) => dot(t, P.X(x), P.Y(y), t.dot * 0.55, { grey: true })));
  const est = m ? dot(t, P.X(m[0]), P.Y(m[1]), t.dot * 1.2, { inner: tip(`estimate: ${fmtNumber(m[0])}, ${fmtNumber(m[1])}`), attrs: 'data-estimate="1"' }) : '';
  return P.finish({ clipped: parts.join(''), over: est });
}

/** A cost-effectiveness acceptability curve: `curve` [[λ, probability]], with `wtp` a dashed vertical line at the threshold. */
export function houseCeac({ curve, wtp = null, title = '', xLabel = '', yLabel = '' }, o = {}) {
  const t = o.style, pts = (curve || []).filter(p => finite(p[0], p[1]));
  if (pts.length < 2) return noteFigure(t, { title: title || 'Acceptability curve', message: 'Not drawn: the curve has fewer than two points.', width: o.width, source: o.source });
  const xa = niceTicks(Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0])), 5), w = widthOf(t, o.width, 'single');
  const lam = Number.isFinite(wtp) && wtp >= xa.lo && wtp <= xa.hi ? wtp : null;
  const note = [...(lam != null ? [`Dashed line: willingness to pay ${fmtNumber(lam)} per unit of effect`] : []), ...sourceOf(o.source)];
  const P = xyPlot(t, { width: w, plotH: w * 0.62, xdom: [xa.lo, xa.hi], ydom: [0, 1], xticks: xa.ticks, yticks: [0, 0.2, 0.4, 0.6, 0.8, 1], xLabel, yLabel,
    title: title || 'Acceptability curve', source: note, desc: `Acceptability curve over ${pts.length} values of willingness to pay`, seed: String(pts.length) });
  const parts = [...(lam != null ? [seg(P.X(lam), P.Y(0), P.X(lam), P.Y(1), refAttrs(t, 'wtp'))] : []),
    pathOf(pts.map(([x, y]) => [P.X(x), P.Y(y)]), `${strokeOf(seriesStyle(t, 0))} data-line="ceac"`)];
  return P.finish({ clipped: parts.join('') });
}
