// Distribution functions in plain JavaScript (Numerical Recipes style series and
// continued fractions), used by the benches as an oracle independent of R.
const lgamma = x => {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
};
/** Regularised lower incomplete gamma P(a, x). */
export function pgammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export const pchisq = (x, df) => pgammaP(df / 2, x / 2);
function bisect(f, lo, hi) { for (let i = 0; i < 300; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; }
export const qchisq = (p, df) => { let hi = Math.max(10, df * 4); while (pchisq(hi, df) < p) hi *= 2; return bisect(x => pchisq(x, df) - p, 0, hi); };
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
  for (let m = 1; m <= 1000; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
  return h;
}
/** Regularised incomplete beta I_x(a, b). */
export function pbeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export const pt = (t, df) => { const x = df / (df + t * t), p = 0.5 * pbeta(x, df / 2, 0.5); return t > 0 ? 1 - p : p; };
export const qt = (p, df) => { if (p === 0.5) return 0; const s = p > 0.5 ? 1 : -1, q = p > 0.5 ? p : 1 - p; let hi = 10; while (pt(hi, df) < q) hi *= 2; return s * bisect(t => pt(t, df) - q, 0, hi); };
export const pnorm = z => 0.5 * (1 + (z >= 0 ? 1 : -1) * pgammaP(0.5, z * z / 2));
export const qnorm = p => { if (p === 0.5) return 0; const s = p > 0.5 ? 1 : -1, q = p > 0.5 ? p : 1 - p; return s * bisect(z => pnorm(z) - q, 0, 40); };
