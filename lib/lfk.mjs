// LFK index and Doi plot (Furuya-Kanamori, Barendregt and Doi 2018, Int J Evid Based Healthc 16:195): a rank-based
// measure of asymmetry of the effects ordered from smallest to largest, drawn as the absolute Z-score of each
// effect against the effect. EXPLORATORY. Schwarzer, Rücker and Semaca (2024, Res Synth Methods 15:603) found its false
// positive rate depends on the number and size of studies and on heterogeneity, and advise against using it to test for
// or to measure asymmetry. It is offered as a picture, beside the tests of small-study effects, never as a test, and it
// changes nothing in the pooled result. Written from the R package metasens 1.5-3 (GPL; lfkindex(), read from its
// source), nothing copied; bench/lfk compares every quantity with it.
import { qnorm } from './dist.mjs';

/** The LFK index of effects `yi` with variances `vi`, its interpretation and the points of the Doi plot (in the order of the effects). */
export function lfkIndex(yi, vi) {
  const k = yi.length;
  if (k < 3 || vi.some(v => !(v > 0)) || yi.some(v => !Number.isFinite(v))) return null;
  const order = yi.map((y, i) => i).sort((a, b) => yi[a] - yi[b] || a - b);   // R's order() is stable
  const te = order.map(i => yi[i]), v = order.map(i => vi[i]), vmax = Math.max(...v), N = v.map(x => 100 * vmax / x);
  const mid = [N[0] / 2];
  for (let i = 1; i < k; i++) mid.push(mid[i - 1] + (N[i - 1] + N[i]) / 2);
  const total = N.reduce((a, b) => a + b, 0), z = mid.map(m => qnorm((m - 0.5) / total)), az = z.map(Math.abs);
  const j = az.indexOf(Math.min(...az)), d = te.map(t => t - te[j]);
  const zr = Math.max(...z) - Math.min(...z), dr = Math.max(...d) - Math.min(...d);
  const lfk = 5 / (2 * k) * z.reduce((s, zi, i) => s + zi + zr / dr * d[i], 0);
  const a = Math.abs(lfk);
  return { lfk, interpretation: a <= 1 ? 'no asymmetry' : a <= 2 ? 'minor asymmetry' : 'major asymmetry', order, te, z, absZ: az, percentile: mid.map(m => (m - 0.5) / total), N, k };
}
