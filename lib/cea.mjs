// Cost-effectiveness of an intervention against a comparator (research type economic-evaluation, CHEERS 2022; plan W7). The input is a
// set of replicates, each a pair of an incremental cost ΔC and an incremental effect ΔE: the iterations of a probabilistic sensitivity
// analysis, or bootstrap replicates of patient data, resampled here within each arm (as R's boot with strata). The incremental
// cost-effectiveness ratio is mean ΔC / mean ΔE, the ratio of the means (BCEA's ICER); with patient data the point estimates are the
// sample's own increments. The net monetary benefit at a willingness to pay λ is λΔE − ΔC; the acceptability curve is, at each λ, the
// share of replicates with a positive net monetary benefit (BCEA's ceac); a 95% interval is the 2.5th and 97.5th percentiles of the
// replicates (R's quantile, type 7). Pure; app/test/cea.test.mjs checks it against R 4.1.2 (bench/measures/cea-oracle.R).

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/** R's quantile(x, p, type = 7) of an ascending array, in R's own arithmetic ((1 − h)·x[lo] + h·x[hi]). */
export function quantile7(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const index = 1 + (n - 1) * p, lo = Math.floor(index), hi = Math.ceil(index), h = index - lo;   // 1-based, as R computes it
  return h > 0 && sorted[hi - 1] !== sorted[lo - 1] ? (1 - h) * sorted[lo - 1] + h * sorted[hi - 1] : sorted[lo - 1];
}
const interval = xs => { const a = Float64Array.from(xs).sort(); return { mean: mean(xs), lo: quantile7(a, 0.025), hi: quantile7(a, 0.975) }; };

/** Where a pair (ΔE, ΔC) lies on the plane: 'ne' (more effective, more costly), 'se' (dominant), 'sw', 'nw' (dominated), or 'axis'. */
export const quadrantOf = (de, dc) => (de === 0 || dc === 0 ? 'axis' : de > 0 ? (dc > 0 ? 'ne' : 'se') : (dc > 0 ? 'nw' : 'sw'));

/** λ from 0 to `max` in `steps` equal steps, as R's seq(0, max, length.out = steps + 1). */
export const lambdaGrid = (max, steps = 100) => Array.from({ length: steps + 1 }, (_, i) => (i === steps ? max : i * (max / steps)));

/** The least of 1, 2, 2.5 and 5 times a power of ten at or above `x`. */
export function niceCeil(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const k = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map(m => m * k).find(v => v >= x * (1 - 1e-12));
}

/**
 * The highest willingness to pay on the acceptability curve when none is given: twice the larger of the threshold and a positive ICER,
 * else twice the median of |ΔC| / |ΔE| over the replicates, rounded up by niceCeil.
 */
export function defaultLambdaMax({ wtp = null, icer = null, reps = [] }) {
  const base = Math.max(wtp > 0 ? wtp : 0, icer > 0 && Number.isFinite(icer) ? icer : 0);
  if (base > 0) return niceCeil(2 * base);
  const ratios = Float64Array.from(reps.filter(r => r.de !== 0).map(r => Math.abs(r.dc / r.de))).sort();
  return niceCeil(2 * quantile7(ratios, 0.5));
}

/**
 * The summary of `reps` ([{ dc, de }]): { k, dc, de ({ mean, lo, hi } each), icer, position (the quadrant of the point estimate),
 * quadrants ({ ne, se, sw, nw, axis } counts), nmb ({ mean, lo, hi } at `wtp`) and pce (the share cost-effective at `wtp`) when a
 * threshold is given, lambdaMax and ceac ([{ lambda, p }]) }. `base` ({ dc, de }, the sample's own increments with patient data)
 * replaces the replicates' means as the point estimate of the increments, the ICER and the position; the intervals stay the replicates'.
 */
export function ceSummary(reps, { wtp = null, lambdaMax = null, steps = 100, base = null } = {}) {
  const ok = reps.filter(r => r && Number.isFinite(r.dc) && Number.isFinite(r.de));
  if (ok.length < 2) return null;
  const dc = interval(ok.map(r => r.dc)), de = interval(ok.map(r => r.de));
  if (base) { dc.mean = base.dc; de.mean = base.de; }
  const icer = de.mean === 0 ? null : dc.mean / de.mean, position = quadrantOf(de.mean, dc.mean);
  const quadrants = { ne: 0, se: 0, sw: 0, nw: 0, axis: 0 };
  for (const r of ok) quadrants[quadrantOf(r.de, r.dc)]++;
  const share = l => ok.reduce((n, r) => n + (l * r.de - r.dc > 0 ? 1 : 0), 0) / ok.length;
  const given = Number.isFinite(wtp) && wtp >= 0 ? wtp : null;
  const max = Number.isFinite(lambdaMax) && lambdaMax > 0 ? lambdaMax : defaultLambdaMax({ wtp: given, icer, reps: ok });
  const out = { k: ok.length, dropped: reps.length - ok.length, dc, de, icer, position, quadrants, wtp: given, lambdaMax: max,
    ceac: lambdaGrid(max, steps).map(lambda => ({ lambda, p: share(lambda) })) };
  if (given != null) {
    const nmb = interval(ok.map(r => given * r.de - r.dc));
    if (base) nmb.mean = given * base.de - base.dc;
    Object.assign(out, { nmb, pce: share(given) });
  }
  return out;
}

/** mulberry32: a small seeded generator, so a bootstrap is repeated from its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const usable = patients => patients.filter(p => p && typeof p.treated === 'boolean' && Number.isFinite(p.cost) && Number.isFinite(p.effect));

/** Resampling indices for `replicates` bootstrap samples of two arms of `nt` and `nc` patients: [{ t: [...], c: [...] }], 0-based. */
export function bootstrapIndices(nt, nc, { replicates = 2000, seed = 1 } = {}) {
  const rand = rng(seed), draw = n => Array.from({ length: n }, () => Math.floor(rand() * n));
  return Array.from({ length: replicates }, () => ({ t: draw(nt), c: draw(nc) }));
}

/**
 * The arms, the sample's increments and the replicates of `patients` ([{ treated, cost, effect }]) for given resampling `indices`
 * (bootstrapIndices, within each arm's usable patients in their order): { arms: { treated, control } ({ n, cost, effect } means each),
 * base: { dc, de }, reps: [{ dc, de }], dropped }, or null when an arm has fewer than two usable patients.
 */
export function ceFromIndices(patients, indices) {
  const ok = usable(patients), t = ok.filter(p => p.treated), c = ok.filter(p => !p.treated);
  if (t.length < 2 || c.length < 2) return null;
  const arm = ps => ({ n: ps.length, cost: mean(ps.map(p => p.cost)), effect: mean(ps.map(p => p.effect)) });
  const arms = { treated: arm(t), control: arm(c) };
  const at = (ps, idx, k) => idx.reduce((s, i) => s + ps[i][k], 0) / idx.length;
  const reps = indices.map(({ t: it, c: ic }) => ({ dc: at(t, it, 'cost') - at(c, ic, 'cost'), de: at(t, it, 'effect') - at(c, ic, 'effect') }));
  return { arms, base: { dc: arms.treated.cost - arms.control.cost, de: arms.treated.effect - arms.control.effect }, reps, dropped: patients.length - ok.length };
}

/** ceFromIndices with seeded bootstrap indices: `replicates` resamples of each arm, with replacement, from `seed`. */
export function bootstrapCe(patients, { replicates = 2000, seed = 1 } = {}) {
  const ok = usable(patients), nt = ok.filter(p => p.treated).length;
  return ceFromIndices(patients, bootstrapIndices(nt, ok.length - nt, { replicates, seed }));
}
