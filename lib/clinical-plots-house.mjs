// The house drawings of lib/clinical-plots.mjs (FIGURE-STYLE §2, F7): ROC, Fagan nomogram, calibration, decision curve
// and Bland-Altman plots, and the scatter / Q-Q plot of lib/dataset-analysis.mjs, as the figures draw them when given a
// `style` (figureTokens). L-shaped axes with ticks, no frame, no gridlines; curves told apart by dash and weight; a
// legend row under the plot instead of a key over the data; the note under the figure is the source block. Every colour
// and size is a token of the style; degenerate input (no points, NaN) answers a short note.
import { niceTicks, fmtNumber } from './output-charts.mjs';
import { faganPoints } from './clinical-epi.mjs';
import { svgRoot, text, measure, axisLine, r1, sourceBlock } from './figure-draw.mjs';
import { xyPlot, noteFigure, legendRows, lineSample, seriesStyle, strokeOf, dashOf, seg, pathOf, dot, tip, finite, fixed, widthOf, sourceOf, within } from './plot-draw.mjs';

const pct = p => `${Number((p * 100).toFixed(p < 0.01 || p > 0.99 ? 1 : 0))}%`;
const roundness = v => { const m = Math.round(v / 10 ** Math.floor(Math.log10(v) + 1e-9)); return m === 1 ? 0 : m === 5 ? 1 : 2; };
const probRoundness = p => (p === 0.5 ? -1 : roundness(Math.min(p, 1 - p)));
const unit = { lo: 0, hi: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
const note = (t, o, message) => noteFigure(t, { title: o.title, message, width: o.width, kind: 'single', source: o.source });
const refAttrs = t => `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`;

/** Split a polyline where it leaves [lo, ∞) on y, cutting at the crossing. */
function clipBelow(pts, lo) {
  const runs = []; let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i], prev = pts[i - 1];
    if (y >= lo) {
      if (prev && prev[1] < lo) cur.push([prev[0] + (x - prev[0]) * (lo - prev[1]) / (y - prev[1]), lo]);
      cur.push([x, y]);
    } else if (prev && prev[1] >= lo) {
      cur.push([prev[0] + (x - prev[0]) * (lo - prev[1]) / (y - prev[1]), lo]); runs.push(cur); cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** ROC curve(s): one small marker per threshold (data-threshold), the chance diagonal dashed, the AUC in the legend row. */
export function houseRoc(curves, o = {}) {
  const { style: t, title = 'ROC curve', cutoff = null } = o;
  const list = Array.isArray(curves) ? curves : [{ label: '', result: curves }];
  if (!list.length || list.some(c => !c.result?.points?.length || !c.result.points.every(p => finite(p.fpr, p.se)))) return note(t, { ...o, title }, 'Not drawn: there are no thresholds to plot.');
  const w = widthOf(t, o.width, 'single');
  const P = xyPlot(t, { width: w, plotH: w * 0.8, xdom: [0, 1], ydom: [0, 1], xticks: unit.ticks, yticks: unit.ticks, xLabel: '1 − specificity', yLabel: 'Sensitivity', title, source: [o.note, ...sourceOf(o.source)], desc: `ROC curve${list.length > 1 ? 's' : ''}, ${list.length} series`, seed: list.map(c => c.result.points.length).join() });
  const parts = [seg(P.X(0), P.Y(0), P.X(1), P.Y(1), refAttrs(t))];
  list.forEach(({ result }, k) => {
    parts.push(pathOf(result.points.map(p => [P.X(p.fpr), P.Y(p.se)]), strokeOf(seriesStyle(t, k))));
    for (const p of result.points) {
      const th = Number.isFinite(p.threshold) ? fmtNumber(p.threshold) : '∞';
      parts.push(dot(t, P.X(p.fpr), P.Y(p.se), t.dot * 0.55, { attrs: `data-threshold="${Number.isFinite(p.threshold) ? p.threshold : String(p.threshold)}"`, inner: tip(`threshold ${th}: Se ${fmtNumber(p.se)}, Sp ${fmtNumber(p.sp)}`) }));
    }
  });
  let over = '';
  if (cutoff?.cutoff && finite(cutoff.sp, cutoff.se)) {
    const cx = P.X(1 - cutoff.sp), cy = P.Y(cutoff.se), r = t.dot * 1.8, s = `cutoff ${fmtNumber(cutoff.threshold)}`, wd = measure(t, s);
    over = `<circle class="c-line" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>`
      + (cx + r + 2 + wd > P.x1 ? text(t, cx - r - 2, cy + t.size.label * 1.3, s, { anchor: 'end' }) : text(t, cx + r + 2, cy + t.size.label * 1.3, s));
  }
  const named = list.filter(c => c.label);
  const items = named.length || list.length === 1 ? list.map(({ label, result }, k) => ({ label: `${label ? `${label}, ` : ''}AUC ${fixed(result.auc?.est, 3)}`, sample: lineSample(t, k) })) : [];
  return P.finish({ under: '', clipped: parts.join(''), over, after: y => legendRows(t, t.pad, y, P.w - 2 * t.pad, items) });
}

/** Fagan nomogram: pre-test probability (left), likelihood ratio (middle), post-test probability (right); the positive-test line solid, the negative dashed. */
export function houseFagan(pretest, lrPos, lrNeg, o = {}) {
  const { style: t, title = 'Fagan nomogram' } = o;
  let g;
  try { g = faganPoints(pretest, lrPos, lrNeg); } catch { g = null; }
  if (!g || !finite(pretest, lrPos, lrNeg) || !(lrPos > 0) || !(lrNeg > 0)) return note(t, { ...o, title }, 'Not drawn: the nomogram needs a pre-test probability between 0 and 1 and positive likelihood ratios.');
  const [ulo, uhi] = g.range, w = widthOf(t, o.width, 'single'), P = t.pad, u = t.size.label, sm = t.size.small, tk = sm * 0.4;
  const fmts = { pretest: pct, lr: v => fmtNumber(v), posttest: pct };
  const leftW = Math.max(...g.axes.pretest.ticks.map(k => measure(t, pct(k.value), 'small'))) + tk + sm * 0.4;
  const rightW = Math.max(...g.axes.posttest.ticks.map(k => measure(t, pct(k.value), 'small'))) + tk + sm * 0.4;
  const edge = Math.max(P, sm * 0.8), xl = edge + leftW, xr = w - edge - rightW, xm = (xl + xr) / 2, top = P + u * 1.9, plotH = w * 1.25, y1 = top + plotH;
  const Y = v => top + plotH * (uhi - v) / (uhi - ulo), parts = [];
  const axis = (a, side, rank, fmt) => {
    const x = xl + (xr - xl) * a.x, d = side === 'left' ? -1 : 1;
    parts.push(axisLine(t, x, top, x, y1));
    const shown = [];
    for (const k of [...a.ticks].sort((p, q) => rank(p.value) - rank(q.value))) if (shown.every(s => Math.abs(Y(s.u) - Y(k.u)) >= sm * 1.35)) shown.push(k);
    for (const k of a.ticks) {
      parts.push(axisLine(t, x, Y(k.u), x + d * tk, Y(k.u)));
      if (shown.includes(k)) parts.push(text(t, x + d * (tk + sm * 0.3), Y(k.u) + sm * 0.35, fmt(k.value), { anchor: side === 'left' ? 'end' : 'start', role: 'small', cls: 'c-ink', color: t.color.ink }));
    }
  };
  axis(g.axes.pretest, 'left', probRoundness, fmts.pretest); axis(g.axes.lr, 'right', roundness, fmts.lr); axis(g.axes.posttest, 'right', probRoundness, fmts.posttest);
  const head = (s, x) => { const h = measure(t, s) / 2; return text(t, Math.min(w - P - h, Math.max(P + h, x)), P + u, s, { anchor: 'middle' }); };
  parts.push(head('Pre-test', xl), head('Likelihood ratio', xm), head('Post-test', xr));
  [[g.positive, 0, 'positive'], [g.negative, 1, 'negative']].forEach(([line, k, lab]) => {
    if (!line) return;
    const x1 = line.u1 === line.u1Clamped ? xr : xl + (xr - xl) * (line.u1Clamped - line.u0) / (line.u1 - line.u0), y2 = Y(line.u1Clamped);
    parts.push(`<line ${strokeOf(seriesStyle(t, k))} x1="${r1(xl)}" y1="${r1(Y(line.u0))}" x2="${r1(x1)}" y2="${r1(y2)}" data-test="${lab}">${tip(`${lab} test: LR ${fmtNumber(line.lr)}, post-test ${pct(line.posttest)}`)}</line>`, dot(t, x1, y2, t.dot * 0.85));
  });
  parts.push(dot(t, xl, Y(-Math.log(pretest / (1 - pretest))), t.dot * 0.85));
  const leg = legendRows(t, P, y1 + sm * 1.2, w - 2 * P, [{ label: `Positive test, LR ${fmtNumber(lrPos)}`, sample: lineSample(t, 0) }, { label: `Negative test, LR ${fmtNumber(lrNeg)}`, sample: lineSample(t, 1) }]);
  parts.push(leg.svg);
  let y = y1 + sm * 1.2 + leg.h;
  const b = sourceBlock(t, P, y + sm * 0.5, w - 2 * P, sourceOf(o.source));
  parts.push(b.svg); y += b.h ? sm * 0.5 + b.h : 0;
  return svgRoot(t, w, y + Math.max(P, sm * 0.6), parts.join(''), { title, desc: `Fagan nomogram, pre-test ${pct(pretest)}` });
}

/** Calibration plot: grouped observed proportions with Wilson whiskers against mean predicted risk, the ideal line dashed. */
export function houseCalibration(cal, o = {}) {
  const { style: t, title = 'Calibration plot' } = o;
  if (!cal?.groups?.length || !cal.groups.every(g => finite(g.predicted, g.observed, g.lo, g.hi))) return note(t, { ...o, title }, 'Not drawn: there are no risk groups to plot.');
  const top = Math.max(0.1, ...cal.groups.map(g => Math.max(g.predicted, g.hi))), ax = niceTicks(0, Math.min(1, top), 5, { zero: true }), hi = Math.min(1, ax.hi), ticks = within(ax.ticks, [0, hi]);
  const foot = o.note ?? (finite(cal.slope?.est, cal.intercept?.est, cal.oe?.est, cal.brier) ? `Slope ${fixed(cal.slope.est)}, intercept ${fixed(cal.intercept.est)}, O:E ${fixed(cal.oe.est)}, Brier ${fixed(cal.brier, 3)}` : '');
  const w = widthOf(t, o.width, 'single');
  const P = xyPlot(t, { width: w, plotH: w * 0.8, xdom: [0, hi], ydom: [0, hi], xticks: ticks, yticks: ticks, xLabel: 'Predicted risk', yLabel: 'Observed proportion', title, source: [foot, ...sourceOf(o.source)], desc: `Calibration plot, ${cal.groups.length} risk groups`, seed: String(cal.groups.length) });
  const parts = [seg(P.X(0), P.Y(0), P.X(hi), P.Y(hi), refAttrs(t))];
  for (const g of cal.groups) {
    const x = P.X(g.predicted);
    parts.push(seg(x, P.Y(Math.min(hi, g.lo)), x, P.Y(Math.min(hi, g.hi)), `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`),
      dot(t, x, P.Y(g.observed), t.dot, { attrs: `data-group="${g.group}"`, inner: tip(`group ${g.group} (n ${g.n}): predicted ${fmtNumber(g.predicted)}, observed ${fmtNumber(g.observed)}`) }));
  }
  return P.finish({ clipped: parts.join('') });
}

/** Decision curve: net benefit of the model (solid), treat all (dashed) and treat none (the zero line) against the threshold probability. */
export function houseDecisionCurve(dc, o = {}) {
  const { style: t, title = 'Decision curve' } = o;
  const rows = dc?.rows;
  if (!rows?.length || !rows.every(r => finite(r.threshold, r.model, r.all)) || !Number.isFinite(dc.prevalence)) return note(t, { ...o, title }, 'Not drawn: there are no thresholds to plot.');
  const hiY = Math.max(0.01, dc.prevalence, ...rows.map(r => r.model)), yl = niceTicks(-hiY * 0.2, hiY, 5), xl = niceTicks(Math.min(...rows.map(r => r.threshold)), Math.max(...rows.map(r => r.threshold)), 5);
  const xr = { lo: Math.max(0, xl.lo), hi: Math.min(1, xl.hi) };
  const w = widthOf(t, o.width, 'double');
  const P = xyPlot(t, { width: w, plotH: w * 0.42, xdom: [xr.lo, xr.hi], ydom: [yl.lo, yl.hi], xticks: xl.ticks, yticks: yl.ticks, xLabel: 'Threshold probability', yLabel: 'Net benefit', title, source: [o.note, ...sourceOf(o.source)], desc: 'Net benefit of the model, treat all and treat none', seed: String(rows.length) });
  const parts = [seg(P.X(xr.lo), P.Y(0), P.X(xr.hi), P.Y(0), `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.axis}" data-series="none"`)];
  for (const [k, si] of [['all', 1], ['model', 0]])
    for (const run of clipBelow(rows.map(r => [r.threshold, r[k]]), yl.lo)) parts.push(pathOf(run.map(([x, y]) => [P.X(x), P.Y(y)]), `${strokeOf(seriesStyle(t, si))} data-series="${k}"`));
  const items = [{ label: 'Model', sample: lineSample(t, 0) }, { label: 'Treat all', sample: lineSample(t, 1) }, { label: 'Treat none', sample: (x, y, len) => seg(x, y, x + len, y, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.axis}"`) }];
  return P.finish({ clipped: parts.join(''), after: y => legendRows(t, t.pad, y, P.w - 2 * t.pad, items) });
}

/** Bland–Altman plot: difference against mean, the bias solid and the limits of agreement dashed, each labelled at the right. */
export function houseBlandAltman(points, bias, loa, o = {}) {
  const { style: t, title = 'Bland–Altman plot', xLabel = 'Mean of the two measurements', yLabel = 'Difference' } = o;
  const P0 = (points || []).map(p => (Array.isArray(p) ? { mean: p[0], diff: p[1] } : p));
  const [lo, hi] = Array.isArray(loa) ? loa : [loa?.lo, loa?.hi];
  if (!P0.length || !finite(P0.map(p => [p.mean, p.diff]), bias, lo, hi)) return note(t, { ...o, title }, 'Not drawn: there are no pairs of measurements to plot.');
  const xs = P0.map(p => p.mean), ds = P0.map(p => p.diff), span = (Math.max(...xs) - Math.min(...xs)) || 1;
  const xa = niceTicks(Math.min(...xs) - span * 0.05, Math.max(...xs) + span * 0.05, 5), ya = niceTicks(Math.min(lo, bias, ...ds), Math.max(hi, bias, ...ds), 5);
  const lines = [[bias, 0, `Bias ${fmtNumber(bias)}`, 'bias'], [hi, 1, `Upper ${fmtNumber(hi)}`, 'upper'], [lo, 1, `Lower ${fmtNumber(lo)}`, 'lower']];
  const sm = t.size.small, w = widthOf(t, o.width, 'double'), labW = Math.max(...lines.map(l => measure(t, l[2]))) + t.size.label * 0.6;
  const P = xyPlot(t, { width: w, plotH: w * 0.42, xdom: [xa.lo, xa.hi], ydom: [ya.lo, ya.hi], xticks: xa.ticks, yticks: ya.ticks, xLabel, yLabel, rightPad: labW, title, source: [o.note, ...sourceOf(o.source)], desc: `Bland–Altman plot, ${P0.length} pairs`, seed: String(P0.length) });
  const parts = lines.map(([v, si, , k]) => seg(P.X(xa.lo), P.Y(v), P.X(xa.hi), P.Y(v), `${strokeOf(seriesStyle(t, si))} data-line="${k}"`));
  parts.push(...P0.map(p => dot(t, P.X(p.mean), P.Y(p.diff), t.dot * 0.8, { grey: true, inner: tip(`mean ${fmtNumber(p.mean)}, difference ${fmtNumber(p.diff)}`) })));
  // the labels sit at the line ends, pushed apart so that two close lines do not print over each other
  const at = lines.map(l => ({ l, y: P.Y(l[0]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < at.length; i++) at[i].y = Math.max(at[i].y, at[i - 1].y + sm * 1.35);
  const labels = at.map(a => text(t, P.X(xa.hi) + t.size.label * 0.4, a.y + t.size.label * 0.35, a.l[2])).join('');
  return P.finish({ clipped: parts.join(''), over: labels });
}

/** Points on two numeric axes with an optional straight line: a scatter plot or a normal Q–Q plot. */
export function houseXy({ points, line = null, xLabel = '', yLabel = '', title = '' }, o = {}) {
  const t = o.style, pts = (points || []).filter(p => finite(p[0], p[1]));
  if (!pts.length) return noteFigure(t, { title: title || 'Scatter plot', message: 'Not drawn: there are no numeric pairs to plot.', width: o.width, source: o.source });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const pad = (lo, hi) => { const s = (hi - lo) || Math.abs(hi) || 1; return [lo - s * 0.04, hi + s * 0.04]; };
  const xa = niceTicks(...pad(Math.min(...xs), Math.max(...xs)), 5), ya = niceTicks(...pad(Math.min(...ys), Math.max(...ys)), 5), w = widthOf(t, o.width, 'single');
  const P = xyPlot(t, { width: w, plotH: w * 0.8, xdom: [xa.lo, xa.hi], ydom: [ya.lo, ya.hi], xticks: xa.ticks, yticks: ya.ticks, xLabel, yLabel, title: title || 'Scatter plot', source: o.source, desc: `${pts.length} points`, seed: String(pts.length) });
  const ref = line && Number.isFinite(line.slope) && Number.isFinite(line.intercept) ? seg(P.X(xa.lo), P.Y(line.intercept + line.slope * xa.lo), P.X(xa.hi), P.Y(line.intercept + line.slope * xa.hi), refAttrs(t)) : '';
  return P.finish({ clipped: ref, over: pts.map(([x, y]) => dot(t, P.X(x), P.Y(y), t.dot * 0.8, { grey: true, inner: tip(`${fmtNumber(x)}, ${fmtNumber(y)}`) })).join('') });
}
