// Run and control charts of a quality improvement project (research type qi-project, SQUIRE items 12 and 13; plan W7). A run chart
// draws a measure over time around its median and reads the runs (Anhøj's rules, as R's qicharts2 applies them): points on the median
// are not useful; a shift is a run of useful points on one side longer than round(log2(n)) + 3; too few crossings of the median are
// fewer than qbinom(0.05, n - 1, 0.5). A control chart adds the limits of common-cause variation: an individuals (XmR) chart,
// mean ± 2.66 times the mean moving range, or with a denominator a p chart, p̄ ± 3 √(p̄(1 − p̄)/nᵢ) per point, cut at 0 and 1; a point
// beyond them is special-cause variation. Pure; app/test/spc.test.mjs checks it against R 4.1.2.
import { lgamma } from './beta-exact.mjs';

const median = xs => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** R's qbinom(p, size, 1/2): the least x with P(X <= x) >= p. */
export function qbinomHalf(p, size) {
  if (size <= 0) return 0;
  let cum = 0;
  for (let x = 0; x <= size; x++) {
    cum += Math.exp(lgamma(size + 1) - lgamma(x + 1) - lgamma(size - x + 1) - size * Math.LN2);
    if (cum >= p * (1 - 64 * Number.EPSILON)) return x;   // R's fuzz, so an exact 0.05 is not missed by rounding
  }
  return size;
}

/** Anhøj's runs analysis of `ys` around `centre`: { useful, longest, longestMax, crossings, crossingsMin, shift, fewCrossings, signal }. */
export function runsAnalysis(ys, centre) {
  const side = ys.filter(y => y !== centre).map(y => Math.sign(y - centre)), useful = side.length;
  const runs = [];
  for (const s of side) { if (runs.length && runs[runs.length - 1].s === s) runs[runs.length - 1].n++; else runs.push({ s, n: 1 }); }
  const longest = runs.reduce((m, r) => Math.max(m, r.n), 0), longestMax = useful ? Math.round(Math.log2(useful)) + 3 : null;
  const crossings = Math.max(runs.length - 1, 0), crossingsMin = qbinomHalf(0.05, Math.max(useful - 1, 0));
  const shift = useful > 0 && longest > longestMax, fewCrossings = crossings < crossingsMin;
  return { useful, longest, longestMax, crossings, crossingsMin, shift, fewCrossings, signal: shift || fewCrossings };
}

const ordered = points => points.map((p, i) => ({ ...p, i })).filter(p => Number.isFinite(p.order) && Number.isFinite(p.y)
  && (p.n == null || (Number.isFinite(p.n) && p.n > 0))).sort((a, b) => a.order - b.order || a.i - b.i);

/** A run chart of `points` ([{ order, y }]): { n, centre (the median), points, runs, dropped }, or null with fewer than two points. */
export function runChart(points) {
  const ps = ordered(points);
  if (ps.length < 2) return null;
  const centre = median(ps.map(p => p.y));
  return { n: ps.length, centre, points: ps.map(p => ({ order: p.order, y: p.y })), runs: runsAnalysis(ps.map(p => p.y), centre), dropped: points.length - ps.length };
}

/**
 * A control chart of `points` ([{ order, y, n? }]): with every n given, a p chart of y events in n; otherwise an individuals chart of y.
 * Returns { chart: 'i' | 'p', n, centre, points: [{ order, y, value, lcl, ucl, beyond }], mr (the mean moving range of an individuals
 * chart), beyond (the count), runs, dropped }, or null with fewer than two points.
 */
export function controlChart(points) {
  const withN = points.some(p => p?.n != null && p.n !== '');
  const ps = ordered(withN ? points.filter(p => p?.n != null) : points.map(p => ({ ...p, n: null })));
  if (ps.length < 2) return null;
  let centre, mr = null, rows;
  if (withN) {
    centre = ps.reduce((s, p) => s + p.y, 0) / ps.reduce((s, p) => s + p.n, 0);
    rows = ps.map(p => { const h = 3 * Math.sqrt(centre * (1 - centre) / p.n); return { order: p.order, y: p.y, n: p.n, value: p.y / p.n, lcl: Math.max(0, centre - h), ucl: Math.min(1, centre + h) }; });
  } else {
    centre = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    mr = ps.slice(1).reduce((s, p, k) => s + Math.abs(p.y - ps[k].y), 0) / (ps.length - 1);
    rows = ps.map(p => ({ order: p.order, y: p.y, value: p.y, lcl: centre - 2.66 * mr, ucl: centre + 2.66 * mr }));
  }
  rows = rows.map(r => ({ ...r, beyond: r.value > r.ucl || r.value < r.lcl }));
  return { chart: withN ? 'p' : 'i', n: rows.length, centre, mr, points: rows, beyond: rows.filter(r => r.beyond).length,
    runs: runsAnalysis(rows.map(r => r.value), centre), dropped: points.length - rows.length };
}
