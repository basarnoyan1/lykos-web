// Sample size and power for designing a primary study (review amendment of
// 2026-09-29; plan §1.1 "Primary studies"). Extends lib/trial-tools.mjs,
// whose two-group normal-approximation formulas are reused, not repeated.
//
// Every calculator returns the size it computes (per group and total, the
// unrounded value as `nExact`, and the enrolment after dropout), its inputs,
// the method with a reference, the assumptions it rests on, and `sentence`:
// one protocol-ready sentence stating the calculation. Nothing is saved here.
//
// Checked in app/test/sample-size.test.mjs: the t-test sizes against R's
// power.t.test, the noncentral t against direct integration, Riley against
// pmsampsize's documented example; the rest agree with the closed forms they
// publish, not with an external package.
import { qnorm, pnorm, pt, qt, pbeta } from './dist.mjs';
import { sampleSizeProportions, sampleSizeMeans, powerProportions } from './trial-tools.mjs';

// ---------------------------------------------------------------- helpers ---

const LN_SQRT_PI = 0.5 * Math.log(Math.PI);
/** log Γ(x), Lanczos (g = 7, n = 9), x > 0. */
function lgam(x) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgam(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Lower-tail CDF of the noncentral t, P(T ≤ t; df, ncp): the series of Lenth
 * (1989), Algorithm AS 243, as R's pnt implements it.
 */
export function pnct(t, df, ncp) {
  if (!(df > 0)) return NaN;
  if (ncp === 0) return pt(t, df);
  let tt = t, del = ncp, negdel = false;
  if (t < 0) { negdel = true; tt = -t; del = -ncp; }
  if (df > 4e5 || del * del > 2 * Math.LN2 * 1021) {          // R's normal approximation for extreme arguments
    const s = 1 / (4 * df);
    const v = pnorm((tt * (1 - s) - del) / Math.sqrt(1 + tt * tt * 2 * s));
    return negdel ? 1 - v : v;
  }
  const x = t * t / (t * t + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda), q = Math.sqrt(2 / Math.PI) * p * del, s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda);
    let a = 0.5; const b = 0.5 * df, rxb = Math.pow(1 - x, b);
    const albeta = LN_SQRT_PI + lgam(b) - lgam(0.5 + b);
    let xodd = pbeta(x, a, b), godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
    tnc = b * x;
    let xeven = tnc < Number.EPSILON ? tnc : 1 - rxb, geven = tnc * rxb;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 1000; it++) {
      a += 1;
      xodd -= godd; xeven -= geven;
      godd *= x * (a + b - 1) / a;
      geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * it); q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      if (s < -1e-10 || (s <= 0 && it > 1)) break;
      if (Math.abs(2 * s * (xodd - godd)) < 1e-12) break;
    }
  }
  tnc += pnorm(-del);
  tnc = Math.min(tnc, 1);
  return negdel ? 1 - tnc : tnc;
}

/** Root of an increasing f on [lo, hi] by bisection; null when the bracket holds no root. */
function solveUp(f, lo, hi) {
  if (f(lo) > 0) return lo;
  while (f(hi) < 0) { hi *= 2; if (hi > 1e9) return null; }
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; if (hi - lo < 1e-10 * hi) break; }
  return (lo + hi) / 2;
}

const inUnit = x => x > 0 && x < 1;
const okAP = (alpha, power) => inUnit(alpha) && inUnit(power);
/** A number as a reader writes it: up to four significant digits, no trailing zeros. */
const num = x => String(Number(Number(x).toPrecision(4)));
const pct = x => `${num(x * 100)}%`;
const sided = (alpha, sides) => `a ${sides === 1 ? 'one' : 'two'}-sided alpha of ${num(alpha)}`;

/**
 * The shared result: `groups` holds the analysed size of each group (one
 * entry for a single sample), `dropout` inflates each for loss to follow-up.
 */
function result({ groups, nExact, inputs, method, reference, assumptions, sentence, extra = {}, inflate = true }) {
  const dropout = inflate && inputs.dropout > 0 && inputs.dropout < 1 ? inputs.dropout : 0;
  const f = dropout ? 1 / (1 - dropout) : 1;
  const enrolGroups = groups.map(n => Math.ceil(n * f - 1e-9));
  const r = {
    n: groups[0],
    ...(groups.length === 2 ? { n1: groups[0], n2: groups[1] } : {}),
    total: groups.reduce((a, b) => a + b, 0),
    nExact,
    enrol: { groups: enrolGroups, total: enrolGroups.reduce((a, b) => a + b, 0) },
    ...extra,
    inputs,
    method: { name: method, reference },
    assumptions: [...assumptions, ...(dropout ? [`${pct(dropout)} loss to follow-up, inflated as n / (1 − dropout)`] : [])],
  };
  const tail = dropout ? `; allowing for ${pct(dropout)} loss to follow-up, ${r.enrol.total} will be enrolled` : '';
  r.sentence = sentence(r).replace(/\.$/, '') + tail + '.';
  return r;
}
const sizeText = r => r.n2 === undefined ? `A sample of ${r.n}` : r.n1 === r.n2 ? `A sample of ${r.n1} per group` : `Samples of ${r.n1} and ${r.n2}`;
const verb = r => r.n2 !== undefined && r.n1 !== r.n2 ? 'give' : 'gives';

// ------------------------------------------------------------------ means ---

/** Power of the two-sided t-test at sizes n1, n2 (or one sample of n1 when paired / one-sample). */
function tPower({ delta, sd, n1, n2, alpha, sides, strict, oneSample }) {
  const df = oneSample ? n1 - 1 : n1 + n2 - 2;
  if (!(df > 0)) return 0;
  const ncp = Math.abs(delta) / sd / (oneSample ? 1 / Math.sqrt(n1) : Math.sqrt(1 / n1 + 1 / n2));
  const tc = qt(1 - alpha / sides, df);
  let p = 1 - pnct(tc, df, ncp);
  if (strict && sides === 2) p += pnct(-tc, df, ncp);
  return p;
}

/**
 * Participants per group for a two-sample t-test with common SD, solved on
 * the exact noncentral t as R's power.t.test does (non-strict: the far tail is
 * ignored unless `strict`). `ratio` is n2 / n1.
 */
export function meansTwoExact({ delta, sd, alpha = 0.05, power = 0.8, ratio = 1, sides = 2, strict = false, dropout = 0 }) {
  if (!(Math.abs(delta) > 0) || !(sd > 0) || !okAP(alpha, power) || !(ratio > 0)) return null;
  const approx = sampleSizeMeans({ delta, sd, alpha: sides === 1 ? 2 * alpha : alpha, power, ratio });
  const n1 = solveUp(n => tPower({ delta, sd, n1: n, n2: n * ratio, alpha, sides, strict }) - power, 2, Math.max(4, 2 * approx.n1));
  if (n1 == null) return null;
  return result({
    groups: [Math.ceil(n1 - 1e-9), Math.ceil(n1 * ratio - 1e-9)], nExact: n1,
    inputs: { delta, sd, alpha, power, ratio, sides, strict, dropout },
    method: 'Two-sample t-test, exact noncentral t', reference: 'Lenth 1989 (AS 243); as R power.t.test',
    assumptions: ['Outcome approximately normal in each group', 'Common standard deviation in both groups', 'Independent observations'],
    sentence: r => `${sizeText(r)} ${verb(r)} ${pct(power)} power to detect a difference of ${num(delta)} (SD ${num(sd)}) with ${sided(alpha, sides)} (two-sample t-test, exact noncentral t).`,
  });
}

/** Pairs for a paired t-test; `sdDiff` is the SD of the within-pair differences. */
export function meansPaired({ delta, sdDiff, alpha = 0.05, power = 0.8, sides = 2, strict = false, dropout = 0 }) {
  const r = oneT({ delta, sd: sdDiff, alpha, power, sides, strict, dropout });
  if (!r) return null;
  return result({
    ...r, inputs: { delta, sdDiff, alpha, power, sides, strict, dropout },
    method: 'Paired t-test, exact noncentral t', reference: 'Lenth 1989 (AS 243); as R power.t.test(type = "paired")',
    assumptions: ['Within-pair differences approximately normal', 'Pairs independent of each other'],
    sentence: rr => `A sample of ${rr.n} pairs gives ${pct(power)} power to detect a mean difference of ${num(delta)} (SD of differences ${num(sdDiff)}) with ${sided(alpha, sides)} (paired t-test, exact noncentral t).`,
  });
}

/** Participants for a one-sample t-test of a mean against a fixed value, `delta` away. */
export function meansOne({ delta, sd, alpha = 0.05, power = 0.8, sides = 2, strict = false, dropout = 0 }) {
  const r = oneT({ delta, sd, alpha, power, sides, strict, dropout });
  if (!r) return null;
  return result({
    ...r, inputs: { delta, sd, alpha, power, sides, strict, dropout },
    method: 'One-sample t-test, exact noncentral t', reference: 'Lenth 1989 (AS 243); as R power.t.test(type = "one.sample")',
    assumptions: ['Outcome approximately normal', 'Independent observations'],
    sentence: rr => `A sample of ${rr.n} gives ${pct(power)} power to detect a difference of ${num(delta)} from the reference value (SD ${num(sd)}) with ${sided(alpha, sides)} (one-sample t-test, exact noncentral t).`,
  });
}

function oneT({ delta, sd, alpha, power, sides, strict }) {
  if (!(Math.abs(delta) > 0) || !(sd > 0) || !okAP(alpha, power)) return null;
  const n = solveUp(m => tPower({ delta, sd, n1: m, alpha, sides, strict, oneSample: true }) - power, 2, 16);
  return n == null ? null : { groups: [Math.ceil(n - 1e-9)], nExact: n };
}

/** Power of the two-sample t-test at sizes n1 and n2 (exact noncentral t). */
export function powerMeansTwo({ delta, sd, n1, n2 = n1, alpha = 0.05, sides = 2, strict = false }) {
  if (!(Math.abs(delta) > 0) || !(sd > 0) || !(n1 >= 2 && n2 >= 2) || !inUnit(alpha)) return null;
  const power = tPower({ delta, sd, n1, n2, alpha, sides, strict });
  return {
    power, inputs: { delta, sd, n1, n2, alpha, sides, strict },
    method: { name: 'Two-sample t-test, exact noncentral t', reference: 'Lenth 1989 (AS 243); as R power.t.test' },
    assumptions: ['Outcome approximately normal in each group', 'Common standard deviation in both groups', 'Independent observations'],
    sentence: `${n1 === n2 ? `A sample of ${n1} per group gives` : `Samples of ${n1} and ${n2} give`} ${pct(power)} power to detect a difference of ${num(delta)} (SD ${num(sd)}) with ${sided(alpha, sides)} (two-sample t-test, exact noncentral t).`,
  };
}

/** Participants for estimating a mean to within ±`precision` (half-width of the confidence interval). */
export function meanPrecision({ sd, precision, conf = 0.95, dropout = 0 }) {
  if (!(sd > 0) || !(precision > 0) || !inUnit(conf)) return null;
  const z = qnorm(1 - (1 - conf) / 2), n = (z * sd / precision) ** 2;
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, inputs: { sd, precision, conf, dropout },
    method: 'Precision of a mean, normal approximation', reference: 'Lwanga & Lemeshow 1991',
    assumptions: ['Standard deviation known in advance', 'Simple random sample'],
    sentence: r => `A sample of ${r.n} estimates the mean to within ±${num(precision)} (SD ${num(sd)}) with ${pct(conf)} confidence.`,
  });
}

// ------------------------------------------------------------ proportions ---

/**
 * Two proportions with Fleiss's continuity correction:
 * n' = n/4 · (1 + √(1 + 2(r + 1)/(n r |p1 − p2|)))², n from the pooled-variance
 * normal approximation (the value trial-tools rounds). `ratio` is n2 / n1.
 */
export function proportionsTwoCC({ p1, p2, alpha = 0.05, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!sampleSizeProportions({ p1, p2, alpha, power, ratio })) return null;
  const za = qnorm(1 - alpha / 2), zb = qnorm(power), pbar = (p1 + ratio * p2) / (1 + ratio), d = Math.abs(p1 - p2);
  const n = ((za * Math.sqrt((1 + 1 / ratio) * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / ratio)) ** 2) / d ** 2;
  const nc = n / 4 * (1 + Math.sqrt(1 + 2 * (ratio + 1) / (n * ratio * d))) ** 2;
  return result({
    groups: [Math.ceil(nc - 1e-9), Math.ceil(nc * ratio - 1e-9)], nExact: nc,
    extra: { nUncorrected: n },
    inputs: { p1, p2, alpha, power, ratio, dropout },
    method: 'Two proportions, normal approximation with continuity correction', reference: 'Fleiss, Tytun & Ury 1980; Fleiss 1981',
    assumptions: ['Independent binary outcomes', 'Pooled variance under the null hypothesis', 'Tested with the continuity-corrected chi-squared test'],
    sentence: r => `${sizeText(r)} ${verb(r)} ${pct(power)} power to detect a difference between ${pct(p1)} and ${pct(p2)} with ${sided(alpha, 2)} (chi-squared test with continuity correction, Fleiss).`,
  });
}

/**
 * Pairs for McNemar's test (Connor 1987): `p10` and `p01` are the expected
 * proportions of the two kinds of discordant pair.
 * n = [zα √ψ + zβ √(ψ − δ²)]² / δ², ψ = p10 + p01, δ = p10 − p01.
 */
export function proportionsPaired({ p10, p01, alpha = 0.05, power = 0.8, dropout = 0 }) {
  if (!inUnit(p10) || !inUnit(p01) || p10 + p01 >= 1 || p10 === p01 || !okAP(alpha, power)) return null;
  const psi = p10 + p01, d = p10 - p01, za = qnorm(1 - alpha / 2), zb = qnorm(power);
  const n = (za * Math.sqrt(psi) + zb * Math.sqrt(psi - d * d)) ** 2 / (d * d);
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, inputs: { p10, p01, alpha, power, dropout },
    method: "McNemar's test, normal approximation", reference: 'Connor 1987',
    assumptions: ['Discordant proportions anticipated for the pairs', 'Pairs independent of each other'],
    sentence: r => `A sample of ${r.n} pairs gives ${pct(power)} power to detect discordant proportions of ${pct(p10)} and ${pct(p01)} with ${sided(alpha, 2)} (McNemar's test, Connor 1987).`,
  });
}

/** One proportion p1 against a fixed p0: n = [zα √(p0 q0) + zβ √(p1 q1)]² / (p1 − p0)². */
export function proportionOne({ p0, p1, alpha = 0.05, power = 0.8, sides = 2, dropout = 0 }) {
  if (!inUnit(p0) || !inUnit(p1) || p0 === p1 || !okAP(alpha, power)) return null;
  const za = qnorm(1 - alpha / sides), zb = qnorm(power);
  const n = (za * Math.sqrt(p0 * (1 - p0)) + zb * Math.sqrt(p1 * (1 - p1))) ** 2 / (p1 - p0) ** 2;
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, inputs: { p0, p1, alpha, power, sides, dropout },
    method: 'One proportion against a fixed value, normal approximation', reference: 'Chow, Shao & Wang 2008, §4.1',
    assumptions: ['Independent binary outcomes', 'Normal approximation to the binomial'],
    sentence: r => `A sample of ${r.n} gives ${pct(power)} power to detect a proportion of ${pct(p1)} against ${pct(p0)} with ${sided(alpha, sides)} (one-sample test of a proportion).`,
  });
}

// log k! for k = 0..n
function logFact(n) { const f = new Float64Array(n + 1); for (let k = 2; k <= n; k++) f[k] = f[k - 1] + Math.log(k); return f; }

/**
 * Two-sided p of Fisher's exact test for [[a, b], [c, d]] (rows the groups):
 * the tables with the same margins no more probable than this one, with R's
 * relative tolerance of 1e-7.
 */
export function fisherExactP(a, b, c, d) {
  const n1 = a + b, n2 = c + d, t = a + c, lf = logFact(n1 + n2);
  const lo = Math.max(0, t - n2), hi = Math.min(n1, t);
  const lp = x => lf[n1] - lf[x] - lf[n1 - x] + lf[n2] - lf[t - x] - lf[n2 - t + x] - (lf[n1 + n2] - lf[t] - lf[n1 + n2 - t]);
  const obs = lp(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) { const v = lp(x); if (v <= obs + 1e-7) p += Math.exp(v); }
  return Math.min(1, p);
}

/**
 * Power of Fisher's exact test (two-sided) at sizes n1, n2. Up to 1,000
 * participants in all, exact enumeration of every pair of binomial outcomes;
 * above that, the arcsine approximation. `method` says which was used.
 */
export function powerFisherExact({ p1, p2, n1, n2 = n1, alpha = 0.05 }) {
  if (!inUnit(p1) || !inUnit(p2) || !(Number.isInteger(n1) && Number.isInteger(n2) && n1 > 0 && n2 > 0) || !inUnit(alpha)) return null;
  const N = n1 + n2, exact = N <= 1000;
  let power;
  if (exact) {
    const lf = logFact(N);
    const lb = (n, k, p) => lf[n] - lf[k] - lf[n - k] + k * Math.log(p) + (n - k) * Math.log(1 - p);
    const b1 = Array.from({ length: n1 + 1 }, (_, k) => Math.exp(lb(n1, k, p1)));
    const b2 = Array.from({ length: n2 + 1 }, (_, k) => Math.exp(lb(n2, k, p2)));
    power = 0;
    for (let t = 0; t <= N; t++) {
      const lo = Math.max(0, t - n2), hi = Math.min(n1, t), len = hi - lo + 1;
      const base = lf[t] + lf[N - t] - lf[N];
      const h = new Float64Array(len);
      for (let i = 0; i < len; i++) { const x = lo + i; h[i] = Math.exp(lf[n1] - lf[x] - lf[n1 - x] + lf[n2] - lf[t - x] - lf[n2 - t + x] + base); }
      const order = Array.from({ length: len }, (_, i) => i).sort((i, j) => h[i] - h[j]);
      const sorted = order.map(i => h[i]), cum = new Float64Array(len);
      sorted.reduce((s, v, i) => (cum[i] = s + v), 0);
      for (let i = 0; i < len; i++) {
        const lim = h[i] * (1 + 1e-7);
        let l = 0, r = len;                                    // count of sorted values ≤ lim
        while (l < r) { const m = (l + r) >> 1; if (sorted[m] <= lim) l = m + 1; else r = m; }
        if (cum[l - 1] <= alpha) { const x = lo + i; power += b1[x] * b2[t - x]; }
      }
    }
  } else {
    const h = Math.abs(2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2)));
    power = pnorm(h / Math.sqrt(1 / n1 + 1 / n2) - qnorm(1 - alpha / 2));
  }
  power = Math.min(1, Math.max(0, power));
  const name = exact ? "Fisher's exact test, exact enumeration" : "Fisher's exact test, arcsine approximation";
  return {
    power, exact, inputs: { p1, p2, n1, n2, alpha },
    normalApproximation: powerProportions({ p1, p2, n1, n2, alpha }),
    method: { name, reference: exact ? 'Fisher 1935; power by enumeration of both binomial outcomes' : 'Cohen 1988 (arcsine transformation)' },
    assumptions: ['Independent binary outcomes', 'Group sizes fixed by design', ...(exact ? [] : ['Normal approximation to the arcsine-transformed proportions'])],
    sentence: `${n1 === n2 ? `A sample of ${n1} per group gives` : `Samples of ${n1} and ${n2} give`} ${pct(power)} power to detect a difference between ${pct(p1)} and ${pct(p2)} with ${sided(alpha, 2)} (${name}).`,
  };
}

/**
 * Participants for estimating a prevalence to within ±`precision`:
 * n0 = z² p(1 − p)/d² × design effect, then the finite population correction
 * n = n0 / (1 + (n0 − 1)/N) when `population` is given.
 */
export function prevalence({ p, precision, conf = 0.95, population = null, designEffect = 1, dropout = 0 }) {
  if (!inUnit(p) || !(precision > 0) || !inUnit(conf) || !(designEffect >= 1)) return null;
  const z = qnorm(1 - (1 - conf) / 2);
  let n = z * z * p * (1 - p) / precision ** 2 * designEffect;
  const fpc = population > 0;
  if (fpc) n = n / (1 + (n - 1) / population);
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, inputs: { p, precision, conf, population, designEffect, dropout },
    method: 'Precision of a proportion, normal approximation', reference: 'Lwanga & Lemeshow 1991; Cochran 1977 (finite population correction)',
    assumptions: ['Anticipated prevalence as stated', designEffect > 1 ? `Design effect ${num(designEffect)} for the sampling design` : 'Simple random sample',
      ...(fpc ? [`Finite population of ${population}`] : [])],
    sentence: r => `A sample of ${r.n} estimates a prevalence of ${pct(p)} to within ±${pct(precision)} with ${pct(conf)} confidence${designEffect > 1 ? ` (design effect ${num(designEffect)})` : ''}${fpc ? ` in a population of ${population}` : ''}.`,
  });
}

// --------------------------------------------------------------- survival ---

function eventsResult({ D, name, reference, hr, alpha, power, ratio, pEvent, dropout, formula }) {
  const events = Math.ceil(D - 1e-9);
  const total = pEvent > 0 && pEvent <= 1 ? Math.ceil(events / pEvent - 1e-9) : null;
  const g1 = total == null ? null : Math.ceil(total / (1 + ratio) - 1e-9);
  const groups = total == null ? [events] : [g1, Math.max(0, total - g1)];
  const r = result({
    groups, nExact: D, extra: { events, eventsExact: D, pEvent: pEvent ?? null, formula }, inflate: total != null,
    inputs: { hr, alpha, power, ratio, pEvent, dropout },
    method: name, reference,
    assumptions: ['Proportional hazards', 'Compared with the log-rank test', ...(total == null ? [] : [`Probability of an event by the end of follow-up ${num(pEvent)}`])],
    sentence: () => `A total of ${events} events gives ${pct(power)} power to detect a hazard ratio of ${num(hr)} with ${sided(alpha, 2)} (log-rank test, ${reference})${total != null ? `; with an event probability of ${num(pEvent)}, ${total} participants are required` : ''}.`,
  });
  if (total == null) { r.n = r.total = null; r.enrol = null; }
  return r;
}

/**
 * Events for the log-rank test (Schoenfeld 1983):
 * D = (zα/2 + zβ)² (1 + r)² / (r ln²HR), r = n2 / n1. With `pEvent` (the
 * probability a participant has an event), total n = D / pEvent.
 */
export function schoenfeldEvents({ hr, alpha = 0.05, power = 0.8, ratio = 1, pEvent = null, dropout = 0 }) {
  if (!(hr > 0) || hr === 1 || !okAP(alpha, power) || !(ratio > 0)) return null;
  const z = qnorm(1 - alpha / 2) + qnorm(power);
  const D = z * z * (1 + ratio) ** 2 / (ratio * Math.log(hr) ** 2);
  return eventsResult({ D, name: 'Log-rank test, events by Schoenfeld', reference: 'Schoenfeld 1983', hr, alpha, power, ratio, pEvent, dropout, formula: '(zα/2 + zβ)²(1 + r)² / (r ln²HR)' });
}

/** Events for the log-rank test (Freedman 1982): D = (zα/2 + zβ)² (1 + r·HR)² / (r (1 − HR)²). */
export function freedmanEvents({ hr, alpha = 0.05, power = 0.8, ratio = 1, pEvent = null, dropout = 0 }) {
  if (!(hr > 0) || hr === 1 || !okAP(alpha, power) || !(ratio > 0)) return null;
  const z = qnorm(1 - alpha / 2) + qnorm(power);
  const D = z * z * (1 + ratio * hr) ** 2 / (ratio * (1 - hr) ** 2);
  return eventsResult({ D, name: 'Log-rank test, events by Freedman', reference: 'Freedman 1982', hr, alpha, power, ratio, pEvent, dropout, formula: '(zα/2 + zβ)²(1 + r·HR)² / (r(1 − HR)²)' });
}

/**
 * Total participants for the log-rank test with uniform accrual over
 * `accrualTime` and a further `followUp`, exponential survival (control
 * hazard ln 2 / `medianControl`, experimental hazard × `hr`). Simplified
 * Lachin–Foulkes: Schoenfeld's events divided by the average probability of
 * an event, P = 1 − (e^(−λF) − e^(−λ(A+F))) / (λA); no loss to follow-up in
 * the model (use `dropout` to inflate) and no variance correction under the
 * alternative.
 */
export function withAccrual({ accrualTime, followUp, medianControl, hr, alpha = 0.05, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!(accrualTime > 0) || !(followUp >= 0) || !(medianControl > 0)) return null;
  const s = schoenfeldEvents({ hr, alpha, power, ratio });
  if (!s) return null;
  const pev = lam => 1 - (Math.exp(-lam * followUp) - Math.exp(-lam * (accrualTime + followUp))) / (lam * accrualTime);
  const lc = Math.LN2 / medianControl, le = lc * hr, pc = pev(lc), pe = pev(le), pbar = (pc + ratio * pe) / (1 + ratio);
  const n = s.eventsExact / pbar, g1 = Math.ceil(n / (1 + ratio) - 1e-9), g2 = Math.ceil(n * ratio / (1 + ratio) - 1e-9);
  return result({
    groups: [g1, g2], nExact: n, extra: { events: s.events, eventsExact: s.eventsExact, pEvent: pbar, pEventControl: pc, pEventExperimental: pe },
    inputs: { accrualTime, followUp, medianControl, hr, alpha, power, ratio, dropout },
    method: 'Log-rank test, exponential survival with uniform accrual (simplified Lachin–Foulkes: Schoenfeld events over the average event probability)',
    reference: 'Schoenfeld 1983; Lachin & Foulkes 1986',
    assumptions: ['Proportional hazards', 'Exponential survival in both groups', 'Uniform accrual', 'No loss to follow-up within the model', 'Variance of the log-rank statistic taken under the null (Schoenfeld)'],
    sentence: r => `${sizeText(r)} (${s.events} events) ${verb(r)} ${pct(power)} power to detect a hazard ratio of ${num(hr)} with ${sided(alpha, 2)} (log-rank test, Schoenfeld events; exponential survival, control median ${num(medianControl)}, ${num(accrualTime)} accrual and ${num(followUp)} further follow-up).`,
  });
}

// ------------------------------------------------------------- diagnostic ---

/**
 * Participants to estimate sensitivity and specificity to within ±`precision`
 * (Buderer 1996): cases z² Se(1 − Se)/d², divided by prevalence; non-cases
 * z² Sp(1 − Sp)/d², divided by 1 − prevalence; the larger total is required.
 */
export function buderer({ se, sp, prevalence: prev, precision, conf = 0.95, dropout = 0 }) {
  if (!inUnit(prev) || !(precision > 0) || !inUnit(conf) || (se == null && sp == null) || (se != null && !inUnit(se)) || (sp != null && !inUnit(sp))) return null;
  const z = qnorm(1 - (1 - conf) / 2);
  const nSe = se == null ? 0 : z * z * se * (1 - se) / precision ** 2 / prev;
  const nSp = sp == null ? 0 : z * z * sp * (1 - sp) / precision ** 2 / (1 - prev);
  const n = Math.max(nSe, nSp);
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n,
    extra: { forSensitivity: se == null ? null : Math.ceil(nSe - 1e-9), forSpecificity: sp == null ? null : Math.ceil(nSp - 1e-9) },
    inputs: { se, sp, prevalence: prev, precision, conf, dropout },
    method: 'Precision of sensitivity and specificity', reference: 'Buderer 1996',
    assumptions: ['Consecutive or random sample with the stated prevalence', 'Normal approximation to the binomial'],
    sentence: r => `A sample of ${r.n} estimates ${[se != null && `a sensitivity of ${pct(se)}`, sp != null && `a specificity of ${pct(sp)}`].filter(Boolean).join(' and ')} to within ±${pct(precision)} with ${pct(conf)} confidence at a prevalence of ${pct(prev)} (Buderer 1996).`,
  });
}

/** Hanley & McNeil (1982) standard error of an AUC with nA cases and nN non-cases. */
function hmSE(A, nA, nN) {
  const q1 = A / (2 - A), q2 = 2 * A * A / (1 + A);
  return Math.sqrt((A * (1 - A) + (nA - 1) * (q1 - A * A) + (nN - 1) * (q2 - A * A)) / (nA * nN));
}

/**
 * Cases (and `ratio` non-cases per case) for an AUC, by the Hanley & McNeil
 * (1982) standard error: either to within ±`precision`, or against a null
 * `auc0` (zα·SE0 + zβ·SE1 ≤ |auc − auc0|).
 */
export function aucHanleyMcNeil({ auc, precision = null, auc0 = null, conf = 0.95, alpha = 0.05, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!(auc > 0.5 && auc < 1) || !(ratio > 0)) return null;
  let f, what;
  if (auc0 != null) {
    if (!(auc0 >= 0.5 && auc0 < 1) || auc0 === auc || !okAP(alpha, power)) return null;
    const za = qnorm(1 - alpha / 2), zb = qnorm(power);
    f = n => Math.abs(auc - auc0) - za * hmSE(auc0, n, n * ratio) - zb * hmSE(auc, n, n * ratio);
    what = 'test';
  } else {
    if (!(precision > 0) || !inUnit(conf)) return null;
    const z = qnorm(1 - (1 - conf) / 2);
    f = n => precision - z * hmSE(auc, n, n * ratio);
    what = 'precision';
  }
  const nA = solveUp(f, 1, 16);
  if (nA == null) return null;
  return result({
    groups: [Math.ceil(nA - 1e-9), Math.ceil(nA * ratio - 1e-9)], nExact: nA,
    inputs: { auc, precision, auc0, conf, alpha, power, ratio, dropout },
    method: what === 'test' ? 'AUC against a null value, Hanley–McNeil standard error' : 'Precision of an AUC, Hanley–McNeil standard error',
    reference: 'Hanley & McNeil 1982',
    assumptions: ['Hanley–McNeil exponential approximation to the AUC variance', 'Independent cases and non-cases'],
    sentence: r => what === 'test'
      ? `A sample of ${r.n1} cases and ${r.n2} non-cases gives ${pct(power)} power to show an AUC of ${num(auc)} against ${num(auc0)} with ${sided(alpha, 2)} (Hanley & McNeil 1982).`
      : `A sample of ${r.n1} cases and ${r.n2} non-cases estimates an AUC of ${num(auc)} to within ±${num(precision)} with ${pct(conf)} confidence (Hanley & McNeil 1982).`,
  });
}

// ---------------------------------------------------------- non-inferiority ---

/**
 * Non-inferiority of means: per group
 * n1 = (1 + 1/r) σ² (z1−α + z1−β)² / (δ + margin)², where `margin` > 0 is
 * the largest acceptable deficit, `delta` the true difference (new − control,
 * higher better; 0 by default), alpha one-sided.
 */
export function nonInferiorityMeans({ margin, sd, delta = 0, alpha = 0.025, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!(margin > 0) || !(sd > 0) || !(delta + margin > 0) || !okAP(alpha, power) || !(ratio > 0)) return null;
  const z = qnorm(1 - alpha) + qnorm(power), n = (1 + 1 / ratio) * (z * sd / (delta + margin)) ** 2;
  return result({
    groups: [Math.ceil(n - 1e-9), Math.ceil(n * ratio - 1e-9)], nExact: n,
    inputs: { margin, sd, delta, alpha, power, ratio, dropout },
    method: 'Non-inferiority of two means, normal approximation', reference: 'Chow, Shao & Wang 2008, §3.2; Julious 2004',
    assumptions: ['Common standard deviation', 'Higher values are better', `True difference ${num(delta)}`, 'Normal approximation (z, not t)'],
    sentence: r => `${sizeText(r)} ${verb(r)} ${pct(power)} power to show non-inferiority with a margin of ${num(margin)} (SD ${num(sd)}, true difference ${num(delta)}) with ${sided(alpha, 1)}.`,
  });
}

/**
 * Non-inferiority of proportions (p1 new, p2 control, higher better):
 * n1 = (z1−α + z1−β)² (p1q1 + p2q2/r) / (p1 − p2 + margin)² (unpooled variance).
 */
export function nonInferiorityProportions({ p1, p2, margin, alpha = 0.025, power = 0.8, ratio = 1, dropout = 0 }) {
  if (!inUnit(p1) || !inUnit(p2) || !(margin > 0) || !(p1 - p2 + margin > 0) || !okAP(alpha, power) || !(ratio > 0)) return null;
  const z = qnorm(1 - alpha) + qnorm(power);
  const n = z * z * (p1 * (1 - p1) + p2 * (1 - p2) / ratio) / (p1 - p2 + margin) ** 2;
  return result({
    groups: [Math.ceil(n - 1e-9), Math.ceil(n * ratio - 1e-9)], nExact: n,
    inputs: { p1, p2, margin, alpha, power, ratio, dropout },
    method: 'Non-inferiority of two proportions, normal approximation (unpooled variance)', reference: 'Blackwelder 1982; Chow, Shao & Wang 2008, §4.2',
    assumptions: ['Independent binary outcomes', 'Higher proportions are better', 'Margin on the risk-difference scale'],
    sentence: r => `${sizeText(r)} ${verb(r)} ${pct(power)} power to show non-inferiority with a margin of ${pct(margin)} (expected ${pct(p1)} against ${pct(p2)}) with ${sided(alpha, 1)}.`,
  });
}

// ------------------------------------------------------ design and models ---

/**
 * Inflate an individually randomised size for clustering: design effect
 * 1 + (m − 1)·ICC, with `m` participants per cluster. `n` is per group (or a
 * total); clusters per group are n × DE / m, rounded up.
 */
export function clusterInflate(n, { m, icc }) {
  if (!(n > 0) || !(m >= 1) || !(icc >= 0 && icc < 1)) return null;
  const de = 1 + (m - 1) * icc, clusters = Math.ceil(n * de / m - 1e-9), nInfl = clusters * m;
  return {
    n: nInfl, nExact: n * de, clusters, designEffect: de, inputs: { n, m, icc },
    method: { name: 'Design effect for cluster sampling', reference: 'Donner, Birkett & Buck 1981; Kish 1965' },
    assumptions: ['Equal cluster sizes', 'Common intracluster correlation'],
    sentence: `With clusters of ${num(m)} and an intracluster correlation of ${num(icc)} (design effect ${num(de)}), ${n} participants become ${nInfl} in ${clusters} clusters.`,
  };
}

/** Participants for a regression model by events per variable (Peduzzi et al. 1996): parameters × epv / prevalence. */
export function regressionEPV({ parameters, prevalence: prev, epv = 10, dropout = 0 }) {
  if (!(parameters >= 1) || !inUnit(prev) || !(epv > 0)) return null;
  const events = Math.ceil(parameters * epv - 1e-9), n = events / Math.min(prev, 1 - prev);
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, extra: { events },
    inputs: { parameters, prevalence: prev, epv, dropout },
    method: 'Events per variable', reference: 'Peduzzi et al. 1996',
    assumptions: [`${num(epv)} events (of the less frequent outcome) per candidate parameter`, 'A rule of thumb, not a calculation of precision or shrinkage'],
    sentence: r => `A sample of ${r.n} gives ${events} events of the less frequent outcome (prevalence ${pct(Math.min(prev, 1 - prev))}) for ${parameters} candidate parameters, ${num(epv)} events per parameter (Peduzzi et al. 1996).`,
  });
}

/**
 * Minimum sample size for a prediction model with a binary outcome (Riley
 * et al. 2020, criteria i–iii; as pmsampsize):
 *  (i)   expected uniform shrinkage ≥ S: n = p / ((S − 1) ln(1 − R²cs/S));
 *  (ii)  optimism in Nagelkerke R² ≤ δ: criterion (i) with
 *        S = R²cs / (R²cs + δ·maxR²cs), maxR²cs = 1 − (φ^φ (1 − φ)^(1 − φ))²;
 *  (iii) overall risk within ±margin: n = (1.96 / margin)² φ(1 − φ).
 * Give the anticipated Cox–Snell R² (`rsquaredCS`) or Nagelkerke R².
 */
export function rileyBinary({ parameters, prevalence: phi, rsquaredCS = null, rsquaredNagelkerke = null, shrinkage = 0.9, optimism = 0.05, margin = 0.05, dropout = 0 }) {
  if (!(parameters >= 1) || !inUnit(phi) || !inUnit(shrinkage) || !(optimism > 0) || !(margin > 0)) return null;
  const maxR2 = 1 - (phi ** phi * (1 - phi) ** (1 - phi)) ** 2;
  const r2 = rsquaredCS != null ? rsquaredCS : rsquaredNagelkerke != null ? rsquaredNagelkerke * maxR2 : null;
  if (!(r2 > 0 && r2 < maxR2)) return null;
  const byS = S => parameters / ((S - 1) * Math.log(1 - r2 / S));
  const n1 = byS(shrinkage);
  const S2 = r2 / (r2 + optimism * maxR2), n2 = byS(S2);
  const n3 = (1.96 / margin) ** 2 * phi * (1 - phi);
  const c = [n1, n2, n3].map(x => Math.ceil(x - 1e-9)), n = Math.max(...c);
  const which = ['i', 'ii', 'iii'][c.indexOf(n)];
  const sFinal = Math.max(shrinkage, S2);
  return result({
    groups: [n], nExact: Math.max(n1, n2, n3),
    extra: { criteria: { i: c[0], ii: c[1], iii: c[2] }, shrinkageFinal: n === c[0] ? shrinkage : sFinal, events: n * phi, eventsPerParameter: n * phi / parameters, maxR2CS: maxR2, rsquaredCS: r2, binding: which },
    inputs: { parameters, prevalence: phi, rsquaredCS, rsquaredNagelkerke, shrinkage, optimism, margin, dropout },
    method: 'Minimum sample size for a binary-outcome prediction model, criteria (i)–(iii)', reference: 'Riley et al. 2020',
    assumptions: [`Anticipated Cox–Snell R² ${num(r2)}`, `Outcome prevalence ${pct(phi)}`, `Shrinkage ≥ ${num(shrinkage)}, optimism in Nagelkerke R² ≤ ${num(optimism)}, overall risk within ±${num(margin)} (z = 1.96)`],
    sentence: r => `A sample of ${r.n} (about ${Math.round(r.events)} events, ${r.eventsPerParameter.toFixed(1)} per parameter) meets Riley et al. (2020) criteria (i)–(iii) for ${parameters} candidate parameters with an anticipated Cox–Snell R² of ${num(r2)} and an outcome prevalence of ${pct(phi)}.`,
  });
}

/** Participants to detect a correlation r against 0 (Fisher z): n = ((zα/2 + zβ) / atanh r)² + 3. */
export function correlation({ r, alpha = 0.05, power = 0.8, sides = 2, dropout = 0 }) {
  if (!(Math.abs(r) > 0 && Math.abs(r) < 1) || !okAP(alpha, power)) return null;
  const c = 0.5 * Math.log((1 + r) / (1 - r)), n = ((qnorm(1 - alpha / sides) + qnorm(power)) / c) ** 2 + 3;
  return result({
    groups: [Math.ceil(n - 1e-9)], nExact: n, inputs: { r, alpha, power, sides, dropout },
    method: "Correlation against zero, Fisher's z", reference: 'Fisher 1921; Hulley et al. 2013',
    assumptions: ['Bivariate normal variables', 'Independent observations'],
    sentence: rr => `A sample of ${rr.n} gives ${pct(power)} power to detect a correlation of ${num(r)} with ${sided(alpha, sides)} (Fisher's z).`,
  });
}
