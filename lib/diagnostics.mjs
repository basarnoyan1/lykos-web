// Diagnostics of a saved pooled result, computed in JavaScript from the effects it kept (`yi`, `vi`, `mu`,
// its interval, `tau2`, its own counts): the confidence-interval outlier rule, and the pieces the drawn
// figures need. Studentised residuals, Cook's distance, DFBETAS and leave-one-out come from metafor's
// influence() and leave1out() in the run itself (lib/sensitivity.mjs).
//
// The outlier rule (Harrer et al. 2021, Doing Meta-Analysis with R, 5.1): a study is an outlier when
// its 95% confidence interval lies wholly outside the 95% confidence interval of the pooled effect. It is a
// screen for a study worth looking at, not a reason to remove one.

const Z = 1.959963984540054;

/** The studies' own 95% intervals and whether each lies wholly outside the pooled interval [lo, hi] (analysis scale). */
export function outlierRule({ yi, vi, lo, hi }) {
  return yi.map((y, i) => { const se = Math.sqrt(vi[i]), a = y - Z * se, b = y + Z * se; return { lo: a, hi: b, outlier: b < lo || a > hi }; });
}

const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
/** The saved arrays as plain numbers; null for a result run before they were kept, which needs a new Run. */
export function diagnosticInputs(a) {
  const yi = vec(a?.yi).map(Number), vi = vec(a?.vi).map(Number);
  if (!yi.length || yi.length !== vi.length || yi.some(x => !Number.isFinite(x)) || vi.some(x => !(x > 0))) return null;
  // The plots draw the pooled line on the analysis scale: a result without it (yi and vi saved, mu not) has nothing to draw against.
  const mu = Number(a.mu), lo = Number(a.mu_lb), hi = Number(a.mu_ub);
  if (![mu, lo, hi].every(Number.isFinite)) return null;
  return { yi, vi, mu, lo, hi, tau2: Number(a.tau2) || 0, labels: vec(a.labels).map(String) };
}

/** Binary counts per study, [events treated, n treated, events control, n control], from a result's saved rows. */
export function countRows(a) {
  const v = vec(a?.values).map(r => vec(r).map(Number));
  return v.length && v.every(r => r.length === 4 && r.every(Number.isFinite)) ? v : null;
}
