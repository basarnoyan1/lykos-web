// The ratio of odds ratios of a meta-epidemiological study (research type meta-research, plan W7), in two steps (Sterne et al., Stat Med
// 2002;21:1513-24). Step 1: within each meta-analysis, a random-effects meta-regression of its trials' log odds ratios on a binary trial
// characteristic; the coefficient is that meta-analysis's log ratio of odds ratios (trials with the characteristic over trials without)
// with its standard error. Step 2: a random-effects meta-analysis of those log ratios gives the overall ratio and the heterogeneity
// between meta-analyses. A meta-analysis contributes only with trials on both sides of the characteristic and at least three trials (the
// meta-regression estimates two coefficients and τ²; metafor stops with fewer); the others are listed with their reason.
// Both steps are metafor's rma.uni (lib/meta-general.mjs `model`), REML by default or DerSimonian–Laird; app/test/ror.test.mjs checks
// them against metafor in WebR (bench/measures/ror-oracle.json). Pure.
import { model } from './meta-general.mjs';
import { pnorm } from './dist.mjs';

/** The estimators both steps may use, with the names a method line gives them. */
export const ROR_METHODS = Object.freeze({ REML: 'restricted maximum likelihood', DL: 'DerSimonian–Laird' });

const filled = v => v != null && String(v).trim() !== '';

/**
 * `trials`: [{ meta, yi, sei, present }], `meta` naming the meta-analysis, `yi` the trial's log odds ratio, `sei` its standard error and
 * `present` true when the trial has the characteristic. A row with a missing or non-finite value, or a standard error not above zero, is
 * dropped and counted. Returns { method, metas: [{ meta, k, with, without, lror?, se?, lo?, hi?, tau2?, reason? }] in first-seen order,
 * used (the metas with a ratio), pooled: { lror, se, lo, hi, p, tau2, i2, q, qp, k } or null, trials: { used, dropped } }.
 */
export function ratioOfOddsRatios(trials, { method = 'REML' } = {}) {
  if (!ROR_METHODS[method]) throw new Error(`ratioOfOddsRatios: method ${method}`);
  const ok = trials.filter(t => t && filled(t.meta) && Number.isFinite(t.yi) && Number.isFinite(t.sei) && t.sei > 0 && typeof t.present === 'boolean');
  const byMeta = new Map();
  for (const t of ok) { const m = String(t.meta).trim(); if (!byMeta.has(m)) byMeta.set(m, []); byMeta.get(m).push(t); }
  const metas = [...byMeta].map(([meta, rows]) => {
    const k = rows.length, w = rows.filter(r => r.present).length, base = { meta, k, with: w, without: k - w };
    if (!w || w === k) return { ...base, reason: w ? 'every trial has the characteristic' : 'no trial has the characteristic' };
    if (k < 3) return { ...base, reason: 'fewer than three trials' };
    const fit = model(rows.map(r => r.yi), rows.map(r => r.sei ** 2), { method, X: rows.map(r => [1, r.present ? 1 : 0]) });
    if (!fit) return { ...base, reason: 'the meta-regression did not converge' };
    return { ...base, lror: fit.beta[1], se: fit.se[1], lo: fit.ci_lb[1], hi: fit.ci_ub[1], tau2: fit.tau2 };
  });
  const used = metas.filter(m => m.lror != null);
  let pooled = null;
  if (used.length) {
    const f = model(used.map(m => m.lror), used.map(m => m.se ** 2), { method });
    if (f) {
      const z = f.beta[0] / f.se[0];
      pooled = { lror: f.beta[0], se: f.se[0], lo: f.ci_lb[0], hi: f.ci_ub[0], p: Number.isFinite(f.pval[0]) ? f.pval[0] : 2 * pnorm(-Math.abs(z)),
        tau2: f.tau2, i2: f.I2, q: f.QE, qp: f.QEp, k: used.length };
    }
  }
  return { method, metas, used, pooled, trials: { used: ok.length, dropped: trials.length - ok.length } };
}
