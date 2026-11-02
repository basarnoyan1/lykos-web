// The house drawings of lib/stat-plots.mjs (FIGURE-STYLE §2, F7): what the diagnostic and sensitivity figures draw when
// they are given a `style` (figureTokens of lib/figure-style.mjs). Minimal L-shaped axes with ticks and no frame or
// gridlines, ink and one grey, series told apart by dash and weight, a wrapped label column or a key instead of a
// cut label, direct labels and a legend row under the plot, and a short note where the input cannot be drawn (empty,
// non-numeric, a result drawn from yi/vi without its inputs). Every colour and size is a token of the style.
import { niceTicks } from './output-charts.mjs';
import { measure, r1, text } from './figure-draw.mjs';
import { scaleTicks, xyPlot, rowPlot, noteFigure, legendRows, lineSample, seriesStyle, strokeOf, dashOf, seg, pathOf, dot, square, tip, finite, fixed, widthOf } from './plot-draw.mjs';

const Z = 1.959963984540054;
const label = (labels, i, p = 'Study') => String(labels[i] ?? `${p} ${i + 1}`);
const note = (t, o, message) => noteFigure(t, { title: o.title, message, width: o.width, kind: 'single', source: o.source });
const MISSING = 'Not drawn: the figure needs the study estimates and variances of the analysis, and they are missing or not numbers.';
const dom = (lo, hi, pad) => { const p = (hi - lo) * pad || 0.5; return [lo - p, hi + p]; };

/** The selection functions of the fitted selection models, w(p) against the one-sided p-value. */
export function houseSelection(models, o = {}) {
  const { style: t, title = 'Selection functions' } = o;
  const ok = (models || []).filter(m => m.ok && m.p?.length && m.w?.length && finite(m.p, m.w));
  if (!ok.length) return note(t, { ...o, title }, 'No selection model could be drawn.');
  const ymax = Math.max(1, ...ok.flatMap(m => m.w)) * 1.05, yt = niceTicks(0, ymax, 5).ticks;
  const w = widthOf(t, o.width, 'single');
  const P = xyPlot(t, { width: w, plotH: w * 0.62, xdom: [0, 1], ydom: [0, ymax], xticks: [0, 0.25, 0.5, 0.75, 1], yticks: yt, xLabel: 'One-sided p-value', yLabel: 'Relative probability of selection', title, source: o.source, desc: `${ok.length} selection function${ok.length === 1 ? '' : 's'}`, seed: ok.map(m => m.label || m.type).join() });
  const cut = P.X(0.025), name = '.025';
  const under = seg(cut, P.top, cut, P.y1, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`);
  const curves = ok.map((m, i) => `<path ${strokeOf(seriesStyle(t, i))} fill="none" d="${m.p.map((p, j) => `${j ? 'L' : 'M'}${r1(P.X(p))} ${r1(P.Y(m.w[j]))}`).join('')}">${tip(m.label || m.type)}</path>`).join('');
  const over = text(t, cut + t.size.small * 0.4, P.top + t.size.small, name, { role: 'small', cls: 'c-mute' });
  return P.finish({ under, clipped: curves, over, after: y => legendRows(t, t.pad, y, P.w - 2 * t.pad, ok.map((m, i) => ({ label: String(m.label || m.type), sample: lineSample(t, i) }))) });
}

/** Galbraith (radial) plot: standardised effect against precision, the pooled line through the origin with its ±2 band. */
export function houseRadial(o) {
  const { style: t, yi, vi, tau2 = 0, mu, labels = [], back = null, title = 'Radial plot', xlabel = 'Precision, 1/√(v + τ²)' } = o;
  if (!Number.isFinite(mu) || !Number.isFinite(tau2) || !yi?.length || !vi || vi.length !== yi.length || !finite(yi, vi) || vi.some(v => !(v + tau2 > 0))) return note(t, o, MISSING);
  const b = v => (back ? back(v) : v), x = vi.map(v => 1 / Math.sqrt(v + tau2)), y = yi.map((e, i) => e * x[i]);
  const xmax = Math.max(...x) * 1.08, ymin = Math.min(0, ...y, mu * xmax - 2, -2.5), ymax = Math.max(0, ...y, mu * xmax + 2, 2.5);
  const effTicks = scaleTicks([ymin / xmax, ymax / xmax], back, 5), w = widthOf(t, o.width, 'double'), sm = t.size.small;
  const rightW = Math.max(...effTicks.map(v => measure(t, fixed(b(v), 2), 'small'))) + sm * 1.1;
  const P = xyPlot(t, { width: w, plotH: w * 0.5, xdom: [0, xmax], ydom: [ymin, ymax], xticks: niceTicks(0, xmax, 5).ticks, yticks: niceTicks(ymin, ymax, 6).ticks, xLabel: xlabel, yLabel: o.ylabel ?? 'Standardised effect', rightPad: rightW, title, source: o.source, desc: `Radial plot of ${yi.length} studies`, seed: yi.join() });
  const ref = `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`;
  const lines = seg(P.X(0), P.Y(0), P.X(xmax), P.Y(mu * xmax), strokeOf(seriesStyle(t, 0))) + seg(P.X(0), P.Y(2), P.X(xmax), P.Y(mu * xmax + 2), ref) + seg(P.X(0), P.Y(-2), P.X(xmax), P.Y(mu * xmax - 2), ref);
  const dots = x.map((xi, i) => dot(t, P.X(xi), P.Y(y[i]), t.dot, { filled: Math.abs(y[i] - mu * xi) > 2, inner: tip(`${label(labels, i)}: effect ${fixed(b(yi[i]), 3)}, precision ${fixed(xi, 2)}`) })).join('');
  const rx = P.X(xmax);
  const right = seg(rx, P.top, rx, P.y1, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.axis}"`)
    + effTicks.map(v => seg(rx, P.Y(v * xmax), rx + sm * 0.3, P.Y(v * xmax), `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.axis}"`) + text(t, rx + sm * 0.7, P.Y(v * xmax) + sm * 0.35, fixed(b(v), 2), { role: 'small', cls: 'c-ink', color: t.color.ink })).join('')
    + text(t, P.w - t.pad, t.pad + sm, 'Effect', { anchor: 'end', role: 'small', cls: 'c-mute' });
  return P.finish({ clipped: lines, over: dots + right });
}

/** L'Abbé plot: control risk against treated risk, with the line of no effect and the pooled effect's line. */
export function houseLabbe(o) {
  const { style: t, rows, labels = [], effect = null, measure: m = 'OR', title = "L'Abbé plot" } = o;
  if (!rows?.length || rows.some(r => !finite(r) || !(r[1] > 0) || !(r[3] > 0))) return note(t, o, 'Not drawn: the figure needs the event counts and group sizes of every study.');
  const p0 = rows.map(r => r[2] / r[3]), p1 = rows.map(r => r[0] / r[1]), n = rows.map(r => r[1] + r[3]), nmax = Math.max(...n);
  const top = Math.min(1, Math.max(...p0, ...p1) * 1.1 + 0.02), ticks = niceTicks(0, top, 5).ticks;
  const model = p => { if (effect == null) return null; const e = Number(effect); return m === 'OR' ? e * p / (1 - p + e * p) : m === 'RR' ? Math.min(1, e * p) : m === 'RD' ? Math.min(1, Math.max(0, p + e)) : null; };
  const w = widthOf(t, o.width, 'single');
  const P = xyPlot(t, { width: w, plotH: w * 0.82, xdom: [0, top], ydom: [0, top], xticks: ticks, yticks: ticks, xLabel: 'Risk in the control group', yLabel: 'Risk in the treated group', title, source: o.source, desc: `L'Abbé plot of ${rows.length} studies`, seed: p0.join() });
  const curve = effect == null || !Number.isFinite(model(0.5)) ? '' : pathOf(Array.from({ length: 61 }, (_, i) => i / 60 * top).map(p => [P.X(p), P.Y(model(p))]), strokeOf(seriesStyle(t, 0)));
  const diag = seg(P.X(0), P.Y(0), P.X(top), P.Y(top), `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`);
  const u = t.size.label;
  const dots = p0.map((x, i) => dot(t, P.X(x), P.Y(p1[i]), u * (0.25 + 0.6 * Math.sqrt(n[i] / nmax)), { filled: false, inner: tip(`${label(labels, i)}: control ${fixed(x, 3)}, treated ${fixed(p1[i], 3)}`) })).join('');
  return P.finish({ clipped: diag + curve, over: dots });
}

/** A two-dimensional histogram of the leave-some-out fits (GOSH): pooled estimate against I². */
export function houseGosh(o) {
  const { style: t, counts, xrange, yrange = [0, 100], full = null, back = null, title = 'GOSH plot', xlabel = 'Pooled estimate' } = o;
  if (!counts?.length || !counts[0]?.length || !finite(counts) || !xrange || !finite(xrange, yrange) || !(xrange[1] > xrange[0])) return note(t, o, 'Not drawn: there are no leave-some-out fits to show.');
  const ny = counts.length, nx = counts[0].length, max = Math.max(1, ...counts.flat()), b = v => (back ? back(v) : v);
  const w = widthOf(t, o.width, 'double');
  const P = xyPlot(t, { width: w, plotH: w * 0.5, xdom: xrange, ydom: yrange, xticks: scaleTicks(xrange, back, 6), yticks: [0, 25, 50, 75, 100], xfmt: v => fixed(b(v), 2), yfmt: v => `${v}%`, xLabel: xlabel, yLabel: 'I²', title, source: o.source, desc: `GOSH plot, ${nx} by ${ny} cells`, seed: String(max) });
  // four steps of the sequential ramp (the palest is the page), by the square root of the count so a sparse cell still shows
  const level = c => Math.min(4, Math.ceil(4 * Math.sqrt(c / max)));
  const cells = [];
  counts.forEach((row, iy) => row.forEach((c, ix) => {
    if (!c) return;
    const x0 = xrange[0] + (xrange[1] - xrange[0]) * ix / nx, x1 = xrange[0] + (xrange[1] - xrange[0]) * (ix + 1) / nx;
    const y0 = yrange[0] + (yrange[1] - yrange[0]) * iy / ny, y1 = yrange[0] + (yrange[1] - yrange[0]) * (iy + 1) / ny, l = level(c);
    cells.push(`<rect class="c-seq${l}" x="${r1(P.X(x0))}" y="${r1(P.Y(y1))}" width="${r1(P.X(x1) - P.X(x0) + 0.3)}" height="${r1(P.Y(y0) - P.Y(y1) + 0.3)}" fill="${t.seq[l]}">${tip(`${c} ${c === 1 ? 'subset' : 'subsets'}`)}</rect>`);
  }));
  const ref = `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`;
  const over = full ? seg(P.X(full.est), P.Y(yrange[0]), P.X(full.est), P.Y(yrange[1]), ref) + seg(P.X(xrange[0]), P.Y(full.i2), P.X(xrange[1]), P.Y(full.i2), ref) : '';
  const sw = t.size.label * 0.9, bounds = l => [Math.floor(max * ((l - 1) / 4) ** 2), Math.floor(max * (l / 4) ** 2)];
  const items = [1, 2, 3, 4].filter(l => bounds(l)[1] > bounds(l)[0]).map(l => { const [a, z] = bounds(l); return { label: z - a === 1 ? `${z}` : `${a + 1} to ${z}`, sample: (x, y) => `<rect class="c-seq${l}" x="${r1(x)}" y="${r1(y - sw / 2)}" width="${r1(sw)}" height="${r1(sw)}" fill="${t.seq[l]}"/>` }; });
  return P.finish({ clipped: cells.join(''), over, after: y => {
    const g = legendRows(t, t.pad, y + t.size.label * 1.6, P.w - 2 * t.pad, items);
    return { svg: text(t, t.pad, y + t.size.label, 'Subsets per cell', { role: 'small', cls: 'c-mute' }) + g.svg, h: g.h + t.size.label * 1.6 };
  } });
}

/** Study intervals against the pooled interval: a study whose interval lies wholly outside it is drawn heavier. */
export function houseOutlier(o) {
  const { style: t, yi, vi, labels = [], est, lo, hi, flagged = [], back = null, title = 'Confidence-interval outlier rule', xlabel = 'Effect' } = o;
  if (!yi?.length || !vi || vi.length !== yi.length || !finite(yi, vi, est, lo, hi) || vi.some(v => !(v > 0))) return note(t, o, MISSING);
  const b = v => (back ? back(v) : v), sLo = yi.map((y, i) => y - Z * Math.sqrt(vi[i])), sHi = yi.map((y, i) => y + Z * Math.sqrt(vi[i]));
  const d = dom(Math.min(...sLo, lo), Math.max(...sHi, hi), 0.05), w = widthOf(t, o.width, 'double');
  const wt = t.line.ci, side = t.size.label * 0.7;
  return rowPlot(t, { width: w, dom: d, ticks: scaleTicks(d, back, 6), fmt: v => fixed(b(v), 2), xLabel: xlabel, title, source: o.source, desc: `${yi.length} study intervals against the pooled interval`,
    heads: [{ at: est, text: 'Pooled effect and its interval' }],
    under: (X, top, bottom) => `<rect class="c-fill" x="${r1(X(lo))}" y="${r1(top)}" width="${r1(X(hi) - X(lo))}" height="${r1(bottom - top)}" fill="${t.color.fill}"/>` + seg(X(est), top, X(est), bottom, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`),
    rows: yi.map((y, i) => ({ label: label(labels, i), bold: !!flagged[i], title: `${label(labels, i)}: ${fixed(b(y), 2)} [${fixed(b(sLo[i]), 2)}, ${fixed(b(sHi[i]), 2)}]${flagged[i] ? ', outside the pooled interval' : ''}`,
      draw: (X, cy) => seg(X(sLo[i]), cy, X(sHi[i]), cy, `class="c-line" stroke="${t.color.ink}" stroke-width="${flagged[i] ? wt * 2.4 : wt}"`) + square(t, X(y), cy, side) })) });
}

/** Dot plot of one diagnostic per study with reference lines (studentised residuals, Cook's distance). */
export function houseDiagnostic(o) {
  const { style: t, values, labels = [], refs = [], flagged = [], title = 'Diagnostic', xlabel = '', fmt = v => fixed(v, 2) } = o;
  if (!values?.length || !finite(values, refs.map(r => r.at))) return note(t, o, MISSING);
  const all = [...values, ...refs.map(r => r.at)], d = dom(Math.min(0, ...all), Math.max(...all), 0.06), w = widthOf(t, o.width, 'double');
  return rowPlot(t, { width: w, dom: d, ticks: scaleTicks(d, null, 6), fmt, xLabel: xlabel, title: title || 'Diagnostic', source: o.source, desc: `${values.length} studies against ${refs.length} reference line${refs.length === 1 ? '' : 's'}`,
    heads: refs.map(r => ({ at: r.at, text: r.label })),
    under: (X, top, bottom) => refs.map(r => seg(X(r.at), top, X(r.at), bottom, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`)).join('') + seg(X(0), top, X(0), bottom, `class="c-grid" stroke="${t.color.hair}" stroke-width="${t.line.hair}"`),
    rows: values.map((v, i) => ({ label: label(labels, i), bold: !!flagged[i], title: `${label(labels, i)}: ${fmt(v)}${flagged[i] ? ', beyond the reference' : ''}`,
      draw: (X, cy) => seg(X(0), cy, X(v), cy, `class="c-grid" stroke="${t.color.hair}" stroke-width="${t.line.ci}"`) + dot(t, X(v), cy, t.dot, { filled: !!flagged[i] }) })) });
}

/** Leave-one-out estimates with the full-data estimate and interval as a band. */
export function houseLeaveOneOut(o) {
  const { style: t, est, lo, hi, full, labels = [], back = null, title = 'Leave-one-out plot', xlabel = 'Pooled effect without the study' } = o;
  if (!est?.length || !lo || !hi || lo.length !== est.length || hi.length !== est.length || !full || !finite(est, lo, hi, full.est, full.lo, full.hi)) return note(t, o, MISSING);
  const b = v => (back ? back(v) : v), d = dom(Math.min(...lo, full.lo), Math.max(...hi, full.hi), 0.05), w = widthOf(t, o.width, 'double'), side = t.size.label * 0.7;
  return rowPlot(t, { width: w, dom: d, ticks: scaleTicks(d, back, 6), fmt: v => fixed(b(v), 2), xLabel: xlabel, title, source: o.source, desc: `${est.length} leave-one-out estimates against the full-data interval`,
    heads: [{ at: full.est, text: 'All studies' }],
    under: (X, top, bottom) => `<rect class="c-fill" x="${r1(X(full.lo))}" y="${r1(top)}" width="${r1(X(full.hi) - X(full.lo))}" height="${r1(bottom - top)}" fill="${t.color.fill}"/>` + seg(X(full.est), top, X(full.est), bottom, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.null}" stroke-dasharray="${dashOf(t)}"`),
    rows: est.map((e, i) => ({ label: label(labels, i), title: `Without ${label(labels, i, 'study')}: ${fixed(b(e), 2)} [${fixed(b(lo[i]), 2)}, ${fixed(b(hi[i]), 2)}]`,
      draw: (X, cy) => seg(X(lo[i]), cy, X(hi[i]), cy, `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`) + square(t, X(e), cy, side) })) });
}

/** The Doi plot: the absolute Z-score of each effect against the effect, the LFK index in the head row. */
export function houseDoi(o) {
  const { style: t, te, absZ, lfk, labels = [], back = null, title = 'Doi plot', xlabel = 'Effect' } = o;
  if (!te?.length || !absZ || absZ.length !== te.length || !finite(te, absZ)) return note(t, o, MISSING);
  const b = v => (back ? back(v) : v), zmax = Math.max(...absZ) * 1.08 || 1, d = dom(Math.min(...te), Math.max(...te), 0.06), w = widthOf(t, o.width, 'double');
  const P = xyPlot(t, { width: w, plotH: w * 0.45, xdom: d, ydom: [zmax, 0], xticks: scaleTicks(d, back, 6), yticks: niceTicks(0, zmax, 5).ticks, xfmt: v => fixed(b(v), 2), yfmt: v => fixed(v, 1), xLabel: xlabel, yLabel: '|Z-score|', headRight: Number.isFinite(lfk) ? `LFK index ${fixed(lfk, 2)}` : '', title, source: o.source, desc: `Doi plot of ${te.length} effects`, seed: te.join() });
  const line = pathOf(te.map((v, i) => [P.X(v), P.Y(absZ[i])]), strokeOf(seriesStyle(t, 0)));
  const dots = te.map((v, i) => dot(t, P.X(v), P.Y(absZ[i]), t.dot, { inner: tip(`${label(labels, i)}: ${fixed(b(v), 2)}, |Z| ${fixed(absZ[i], 2)}`) })).join('');
  return P.finish({ clipped: line, over: dots });
}

/** The distribution of true effects N(μ, τ²) with the confidence interval of the pooled effect and the prediction interval beneath it. */
export function housePrediction(o) {
  const { style: t, est, lo, hi, piLo, piHi, tau2 = 0, yi = [], labels = [], back = null, title = 'Prediction interval', xlabel = 'Effect' } = o;
  if (!finite(est, lo, hi, piLo, piHi, tau2, yi) || tau2 < 0) return note(t, o, MISSING);
  const b = v => (back ? back(v) : v), tau = Math.sqrt(tau2), all = [lo, hi, piLo, piHi, ...yi], d = dom(Math.min(...all), Math.max(...all), 0.08), w = widthOf(t, o.width, 'double');
  const u = t.size.label, dens = tau > 0 ? (x => Math.exp(-0.5 * ((x - est) / tau) ** 2) / (tau * Math.sqrt(2 * Math.PI))) : null, peak = dens ? dens(est) : 1;
  const dh = u * 7, ciY = dh + u * 3, piY = dh + u * 6.2, plotH = piY + u * 1.2;
  const P = xyPlot(t, { width: w, plotH, xdom: d, ydom: [0, 1], xticks: scaleTicks(d, back, 6), xfmt: v => fixed(b(v), 2), xLabel: xlabel, yLabel: dens ? 'Distribution of true effects, N(μ, τ²)' : '', yAxis: false, title, source: o.source, desc: 'Confidence interval and prediction interval of the pooled effect', seed: [est, piLo, piHi].join() });
  const base = P.top + dh, X = P.X;
  const curve = dens ? Array.from({ length: 161 }, (_, i) => d[0] + (d[1] - d[0]) * i / 160).map(x => [X(x), base - (dh - u * 0.6) * dens(x) / peak]) : [];
  const shape = dens ? `<path class="c-fill" d="M${r1(X(d[0]))} ${r1(base)}${curve.map(([x, y]) => `L${r1(x)} ${r1(y)}`).join('')}L${r1(X(d[1]))} ${r1(base)}Z" fill="${t.color.fill}" stroke="${t.color.axis}" stroke-width="${t.line.hair}"/>` : '';
  const at = (s, c) => { const half = measure(t, s) / 2; return Math.min(P.x1 - half, Math.max(P.x0 + half, c)); };
  const ci = `Confidence interval ${fixed(b(lo), 2)} to ${fixed(b(hi), 2)}`, pi = `Prediction interval ${fixed(b(piLo), 2)} to ${fixed(b(piHi), 2)}`;
  const marks = yi.map((y, i) => dot(t, X(y), base - u * 0.6, t.dot * 0.85, { filled: false, inner: tip(`${label(labels, i)}: ${fixed(b(y), 2)}`) })).join('');
  const cy = P.top + ciY, py = P.top + piY, cap = u * 0.4;
  const over = seg(P.x0, base, P.x1, base, `class="c-axis" stroke="${t.color.axis}" stroke-width="${t.line.axis}"`) + marks
    + text(t, at(ci, X(est)), cy - u * 0.9, ci, { anchor: 'middle' }) + seg(X(lo), cy, X(hi), cy, `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci * 2.4}"`) + square(t, X(est), cy, u * 0.7)
    + text(t, at(pi, X((piLo + piHi) / 2)), py - u * 0.9, pi, { anchor: 'middle', cls: 'c-mute' }) + seg(X(piLo), py, X(piHi), py, `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`)
    + seg(X(piLo), py - cap, X(piLo), py + cap, `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`) + seg(X(piHi), py - cap, X(piHi), py + cap, `class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`);
  return P.finish({ under: shape, over });
}
