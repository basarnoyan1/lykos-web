// metafor's escalc for the measures the app pools (lib/effect-measures.mjs), in JavaScript: each row's yi and vi as escalc gives them, so the
// JavaScript pool (lib/meta-pool.mjs fitRma) starts from metafor's numbers. app/test/meta-escalc.test.mjs checks every measure against native
// metafor 5.2.1's escalc (bench/measures/escalc-oracle.json) to 1e-12. Pure.
import { measureOf } from './effect-measures.mjs';

const Z975 = 1.959963984540054;
// metafor's .cmicalc: the exact small-sample correction of Hedges' g
const lgamma = x => {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
const cmi = mi => Math.exp(lgamma(mi / 2) - Math.log(Math.sqrt(mi / 2)) - lgamma((mi - 1) / 2));

/** The escalc measure a measure id pools on: 'RR', 'PLO', 'ZCOR', 'GEN' ... */
export const escalcOf = id => measureOf(id).escalc || measureOf(id).id;

/**
 * `{ yi, vi }` for one row of `measure`'s inputs (lib/effect-measures.mjs INPUTS order), or null when the row cannot give one. Binary and rate
 * rows with a zero cell get escalc's 0.5 in every cell (add = 1/2, to = "only0"); a proportion with no or all events likewise.
 */
export function escalcRow(measure, v) {
  const m = measureOf(measure), fam = m.family, n = x => Number(x);
  if (fam === 'binary') {
    let [a, n1, c, n2] = v.map(n), b = n1 - a, d = n2 - c;
    if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
    if (m.id === 'OR') return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
    if (m.id === 'RD') { const p1 = a / (a + b), p2 = c / (c + d); return { yi: p1 - p2, vi: p1 * (1 - p1) / (a + b) + p2 * (1 - p2) / (c + d) }; }
    return { yi: Math.log(a / (a + b)) - Math.log(c / (c + d)), vi: 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d) };
  }
  if (fam === 'continuous') {
    const [m1, sd1, n1, m2, sd2, n2] = v.map(n);
    if (m.id === 'MD') return { yi: m1 - m2, vi: sd1 * sd1 / n1 + sd2 * sd2 / n2 };
    const mi = n1 + n2 - 2, sdp = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / mi), yi = cmi(mi) * (m1 - m2) / sdp;
    return { yi, vi: 1 / n1 + 1 / n2 + yi * yi / (2 * (n1 + n2)) };
  }
  if (fam === 'generic') { const [est, lo, hi] = v.map(n), se = (Math.log(hi) - Math.log(lo)) / (2 * Z975); return { yi: Math.log(est), vi: se * se }; }
  if (fam === 'reported') { const [y, se] = v.map(n); return { yi: m.ratio ? Math.log(y) : y, vi: se * se }; }
  if (fam === 'rate') {
    let [x1, t1, x2, t2] = v.map(n);
    if (x1 === 0 || x2 === 0) { x1 += 0.5; x2 += 0.5; }
    return { yi: Math.log(x1 / t1) - Math.log(x2 / t2), vi: 1 / x1 + 1 / x2 };
  }
  if (fam === 'proportion') {
    const [x0, ni] = v.map(n);
    if (m.id === 'PFT') return { yi: 0.5 * (Math.asin(Math.sqrt(x0 / (ni + 1))) + Math.asin(Math.sqrt((x0 + 1) / (ni + 1)))), vi: 1 / (4 * ni + 2) };
    let x = x0, y = ni - x0;
    if (x === 0 || y === 0) { x += 0.5; y += 0.5; }
    return { yi: Math.log(x / y), vi: 1 / x + 1 / y };
  }
  if (fam === 'single-mean') { const [mi, sd, ni] = v.map(n); return { yi: mi, vi: sd * sd / ni }; }
  if (fam === 'correlation') { const [r, ni] = v.map(n); return { yi: Math.atanh(r), vi: 1 / (ni - 3) }; }
  return null;
}

/** The back-transformation of a pooled yi to the measure's own scale (exp, ilogit, tanh, identity); null for PFT (it needs the sizes). */
export function backOf(measure) {
  const m = measureOf(measure);
  if (m.ratio) return Math.exp;
  if (m.id === 'PR') return y => 1 / (1 + Math.exp(-y));
  if (m.id === 'COR') return Math.tanh;
  if (m.id === 'PFT') return null;
  return y => y;
}
