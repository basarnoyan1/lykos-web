// Effect-size conversions. Every value returned is flagged converted, carries the method that produced it and the
// inputs it came from, so that a derived number is never mistaken for a reported one (plan G6, I4); the same
// `derivation` text goes with a value written to Extraction.
//   SE or 95% CI of a mean to SD        Cochrane Handbook 6.5.2.2 (lib/extraction-check.mjs, the formula the extraction
//                                       assistant already uses): SD = SE·√n, or √n(upper − lower)/(2q), q = 1.96 from n = 60, else t(0.975, n − 1).
//   Median with range or quartiles to   Wan, Wang, Liu and Tong 2014, BMC Med Res Methodol 14:135: from (min, median, max),
//   mean and SD                         (Q1, median, Q3) or all five, and n, assuming approximately normal data. Or the mean of Luo,
//                                       Wan, Liu and Tong 2018 (Stat Methods Med Res 27:1785, weights of the three cases as the metaBLUE
//                                       package and metafor's conv.fivenum give them) with the standard deviation of Shi, Luo, Weng,
//                                       Zeng, Lin, Chu and Tong 2020 (Res Synth Methods 11:641, five-number case, weight 1/(1 + 0.07n^0.6),
//                                       formula (10) of the paper). Shi's paper changes the five-number SD only, so the range and the
//                                       quartile cases keep Wan's SD, and say so.
//   2×2 counts to OR or RR              the usual estimates, 0.5 added to every cell when a cell is zero.
// The estimators are checked by simulation for bias (bench/extras, bench/conversions) and against metafor's conv.fivenum and metaBLUE.
import { qnorm } from './dist.mjs';
import { sdFrom } from './extraction-check.mjs';

const xi = n => 2 * qnorm((n - 0.375) / (n + 0.25));
const eta = n => 2 * qnorm((0.75 * n - 0.125) / (n + 0.25));
const g = x => String(Number(Number(x).toPrecision(6)));

/** Mean and SD from a median with its range and/or quartiles. `n` the sample size; supply min and max, q1 and q3, or all. */
export function wanMeanSd({ n, min, q1, median, q3, max }) {
  const has = v => Number.isFinite(v);
  if (!(Number.isInteger(n) && n >= 2)) return { error: 'The arm needs its n (2 or more)' };
  if (!has(median)) return { error: 'Enter the median' };
  const range = has(min) && has(max), iqr = has(q1) && has(q3);
  if (!range && !iqr) return { error: 'Enter the range, the quartiles, or both' };
  if (range && !(min <= (iqr ? q1 : median) && (iqr ? q3 : median) <= max && min <= median && median <= max)) return { error: 'The values must run from minimum to maximum' };
  if (iqr && !(q1 <= median && median <= q3)) return { error: 'The values must run from Q1 to Q3' };
  let mean, sd, scenario, text;
  if (range && iqr) {
    mean = (min + 2 * q1 + 2 * median + 2 * q3 + max) / 8; sd = (max - min) / (2 * xi(n)) + (q3 - q1) / (2 * eta(n));
    scenario = 'S3'; text = `mean = (min + 2·Q1 + 2·median + 2·Q3 + max)/8 = ${g(mean)}; SD = (max − min)/(2ξ(n)) + (Q3 − Q1)/(2η(n)) = ${g(sd)}`;
  } else if (range) {
    mean = (min + 2 * median + max) / 4; sd = (max - min) / xi(n);
    scenario = 'S1'; text = `mean = (min + 2·median + max)/4 = ${g(mean)}; SD = (max − min)/ξ(n) = ${g(sd)}`;
  } else {
    mean = (q1 + median + q3) / 3; sd = (q3 - q1) / eta(n);
    scenario = 'S2'; text = `mean = (Q1 + median + Q3)/3 = ${g(mean)}; SD = (Q3 − Q1)/η(n) = ${g(sd)}`;
  }
  const method = `Wan et al. 2014, ${scenario}`, inputs = { n, min, q1, median, q3, max };
  return { mean, sd, converted: true, method, inputs, derivation: `Converted, ${method}, n = ${n}: ${text}; ξ(n) = 2Φ⁻¹((n − 0.375)/(n + 0.25)), η(n) = 2Φ⁻¹((0.75n − 0.125)/(n + 0.25))` };
}

export const CONVERSION_METHODS = [['wan', 'Wan et al. 2014'], ['luo-shi', 'Luo et al. 2018 mean, Shi et al. 2020 SD']];

/** Luo et al. 2018 mean from the range (S1), the quartiles (S2) or all five numbers (S3). */
export function luoMean({ n, min, q1, median, q3, max }, scenario) {
  if (scenario === 'S1') { const w = 4 / (4 + n ** 0.75); return w * (min + max) / 2 + (1 - w) * median; }
  if (scenario === 'S2') { const w = 0.7 + 0.39 / n; return w * (q1 + q3) / 2 + (1 - w) * median; }
  const w1 = 2.2 / (2.2 + n ** 0.75), w2 = 0.7 - 0.72 / n ** 0.55;
  return w1 * (min + max) / 2 + w2 * (q1 + q3) / 2 + (1 - w1 - w2) * median;
}

/** Shi et al. 2020 SD from the five-number summary: a weighted mean of the range and quartile estimators, weight 1/(1 + 0.07n^0.6) on the range. */
export function shiSd({ n, min, q1, q3, max }) {
  const w = 1 / (1 + 0.07 * n ** 0.6);
  return w * (max - min) / xi(n) + (1 - w) * (q3 - q1) / eta(n);
}

/** Mean and SD from a median with range and/or quartiles by `method` ('wan' or 'luo-shi'); the result is flagged converted with its method and inputs. */
export function medianToMeanSd(inp, method = 'wan') {
  const base = wanMeanSd(inp);
  if (base.error || method === 'wan') return base;
  if (method !== 'luo-shi') return { error: 'Unknown method' };
  const scenario = base.method.slice(-2), { n } = inp;
  const mean = luoMean(inp, scenario);
  const sd = scenario === 'S3' ? shiSd(inp) : base.sd;
  const meanText = scenario === 'S1' ? 'w·(min + max)/2 + (1 − w)·median, w = 4/(4 + n^0.75)' : scenario === 'S2' ? 'w·(Q1 + Q3)/2 + (1 − w)·median, w = 0.7 + 0.39/n'
    : 'w₁·(min + max)/2 + w₂·(Q1 + Q3)/2 + (1 − w₁ − w₂)·median, w₁ = 2.2/(2.2 + n^0.75), w₂ = 0.7 − 0.72/n^0.55';
  const sdText = scenario === 'S3' ? 'SD = w·(max − min)/ξ(n) + (1 − w)·(Q3 − Q1)/η(n), w = 1/(1 + 0.07n^0.6) (Shi et al. 2020)' : `SD as Wan et al. 2014, ${scenario} (Shi et al. 2020 changes only the five-number case)`;
  const label = `Luo et al. 2018 mean, ${scenario === 'S3' ? 'Shi et al. 2020' : 'Wan et al. 2014'} SD, ${scenario}`;
  return { mean, sd, converted: true, method: label, inputs: base.inputs, derivation: `Converted, ${label}, n = ${n}: mean = ${meanText} = ${g(mean)}; ${sdText} = ${g(sd)}; ξ(n) = 2Φ⁻¹((n − 0.375)/(n + 0.25)), η(n) = 2Φ⁻¹((0.75n − 0.125)/(n + 0.25))` };
}

/** SD from a standard error or a 95% CI text ("1.2 to 3.4"), through the extraction assistant's own formula. */
export function sdFromSummary(text, n) {
  const r = sdFrom(text, n);
  return r.error ? r : { sd: r.value, converted: true, method: 'Cochrane Handbook 6.5.2.2', inputs: { text: String(text).trim(), n }, derivation: `Converted, ${r.derivation}` };
}

/** OR or RR (with a 95% CI) from a 2×2 table of events and non-events per arm; 0.5 added to every cell if any is zero. */
export function countsToEffect({ a, b, c, d, measure = 'OR' }) {
  if (![a, b, c, d].every(x => Number.isFinite(x) && x >= 0)) return { error: 'Enter four counts' };
  const cc = [a, b, c, d].some(x => x === 0) ? 0.5 : 0, [A, B, C, D] = [a + cc, b + cc, c + cc, d + cc];
  const or = measure === 'OR', est = or ? (A * D) / (B * C) : (A / (A + B)) / (C / (C + D));
  const se = or ? Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D) : Math.sqrt(1 / A - 1 / (A + B) + 1 / C - 1 / (C + D)), z = qnorm(0.975), l = Math.log(est);
  const method = `2×2 counts to ${measure}${cc ? ', 0.5 added to every cell' : ''}`;
  return { estimate: est, lo: Math.exp(l - z * se), hi: Math.exp(l + z * se), logEstimate: l, se, converted: true, method, inputs: { a, b, c, d }, derivation: `Converted, ${method}: ${measure} = ${g(est)}, 95% CI ${g(Math.exp(l - z * se))} to ${g(Math.exp(l + z * se))} (events treated ${a}, not ${b}; control ${c}, not ${d})` };
}
