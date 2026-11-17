// The moderator analyses and resampling of the change syntheses (plan §4.15g), ported from the sham-response review's 04-analysis.R (sections
// 5, 9, 11, 14) and 05-resampling.R so that nothing in its paper comes from R: meta-regression (outcomes in trials, REML, containment df) with
// the model-based omnibus F and the CR2 HTZ Wald test (lib/meta-cr2.mjs), each test's permutation p (the model-based F as the statistic,
// trial-level moderators permuted across trials and outcome-level ones across outcomes, R's seeds and draws through lib/r-rng.mjs), the
// trial-cluster bootstrap of the sham/active ratio, the trial-level associations (between-arm SMD on sham SMCR, Knapp-Hartung; failed primary
// endpoint on sham SMCR, logistic), the serious adverse event rate of the sham arms (Poisson-normal GLMM, lib/meta-glmm.mjs) and the sham
// arms' percent improvement. Pure; app/test/change-moderators.test.mjs checks it against the R run of 1 Nov 2026.
import { fitMultilevel, invSPD } from './meta-multilevel.mjs';
import { cr2Parts, cr2Table, cr2Wald, cr2Coef } from './meta-cr2.mjs';
import { pfUpper, model as rmaModel } from './meta-general.mjs';
import { poolGlmmRate } from './meta-glmm.mjs';
import { pnorm } from './dist.mjs';
import { rRng, utf8Sum } from './r-rng.mjs';
import { withReads } from './run-reads.mjs';

const uniq = a => [...new Set(a)];
const sortC = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const Z = 1.959963984540054;
/** R's quantile type 7. */
export const q7 = (xs, p) => { const a = [...xs].sort((x, y) => x - y), h = (a.length - 1) * p, lo = Math.floor(h); return a[lo] + (h - lo) * ((a[Math.ceil(h)] ?? a[lo]) - a[lo]); };

// ---- design matrices -------------------------------------------------------------------------------------------------------------
/**
 * A moderator term: { code, var, title, level: 'trial' | 'outcome', ref?, levels? }. A term with `ref` or `levels` is a factor (levels in C
 * order with the reference first, as relevel(factor(x), ref) gives them; `levels` fixes them, a value outside them missing, as factor(x,
 * levels) makes it); otherwise numeric.
 */
const isFactor = t => t.ref != null || Array.isArray(t.levels);
const valueOf = (row, t) => {
  const v = row[t.var];
  if (v == null || v === '' || v === 'NA' || (typeof v === 'number' && !Number.isFinite(v))) return null;
  if (!isFactor(t)) { const x = typeof v === 'boolean' ? Number(v) : Number(v); return Number.isFinite(x) ? x : null; }
  return Array.isArray(t.levels) && !t.levels.includes(String(v)) ? null : String(v);
};
/** The rows every term has a value for (complete.cases). */
export const completeRows = (rows, terms) => rows.filter(r => terms.every(t => valueOf(r, t) != null));
/** Each factor's levels over these rows (droplevels), the reference first. */
export function termLevels(rows, terms) {
  return Object.fromEntries(terms.filter(isFactor).map(t => {
    const present = uniq(rows.map(r => valueOf(r, t)));
    let lv = Array.isArray(t.levels) ? t.levels.filter(l => present.includes(l)) : sortC(present);
    if (t.ref != null && lv.includes(t.ref)) lv = [t.ref, ...lv.filter(l => l !== t.ref)];
    return [t.code, lv];
  }));
}
/** model.matrix(~ terms): { X, names, blocks: { code: [column] } } (intercept first unless `intercept` is false). */
export function designMatrix(rows, terms, levels = termLevels(rows, terms), { intercept = true } = {}) {
  const names = intercept ? ['intrcpt'] : [], blocks = {}, cols = [];
  for (const t of terms) {
    const start = names.length;
    if (isFactor(t)) { const lv = levels[t.code]; for (const l of (intercept ? lv.slice(1) : lv)) { names.push(`${t.code}${l}`); cols.push(r => (valueOf(r, t) === l ? 1 : 0)); } }
    else { names.push(t.code); cols.push(r => valueOf(r, t)); }
    blocks[t.code] = names.map((_, i) => i).slice(start);
  }
  return { X: rows.map(r => [...(intercept ? [1] : []), ...cols.map(f => f(r))]), names, blocks };
}
/**
 * The columns lm() keeps of X (its QR with limited pivoting, tolerance 1e-7): a column whose remainder after the columns kept before it is
 * below 1e-7 of its own norm is redundant, and rma.mv drops it ("Redundant predictors dropped from the model"). Indices of the kept columns.
 */
export function independentColumns(X, tol = 1e-7) {
  const n = X.length, kept = [], basis = [];
  for (let j = 0; j < (X[0]?.length || 0); j++) {
    const v = X.map(r => r[j]), norm0 = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (!(norm0 > 0)) continue;
    for (const q of basis) { const d = q.reduce((s, x, i) => s + x * v[i], 0); for (let i = 0; i < n; i++) v[i] -= d * q[i]; }
    const nr = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (nr > tol * norm0) { kept.push(j); basis.push(v.map(x => x / nr)); }
  }
  return kept;
}
const fitRows = (rows, X) => fitMultilevel({ yi: rows.map(r => r.yi), vi: rows.map(r => r.vi), levels: [rows.map(r => r.trial), rows.map((_, i) => i)], X });
/** metafor's model-based omnibus test of coefficients `cols` (test = "t", dfs = "contain"): F = b'V⁻¹b / m on (m, min ddf). */
export function modelF(fit, cols) {
  const b = cols.map(j => fit.beta[j]), V = invSPD(cols.map(a => cols.map(c => fit.vb[a][c])));
  if (!V) return { F: null, df1: cols.length, df2: null, p: null };
  const F = b.reduce((s, x, a) => s + x * b.reduce((t, y, c) => t + V.inv[a][c] * y, 0), 0) / cols.length, df2 = Math.min(...cols.map(j => fit.df[j]));
  return { F, df1: cols.length, df2, p: pfUpper(F, cols.length, df2) };
}

// ---- meta-regression ----------------------------------------------------------------------------------------------------------------
/**
 * One meta-regression of `rows` (yi, vi, trial and the terms' columns) on `terms`: the coefficients (model-based and CR2 by trial) and the
 * omnibus tests, all terms together and each term of a multivariable model: [{ term, F_model, df1_model, df2_model, p_model, F_cr2, df1_cr2,
 * df2_cr2, p_cr2, constraints_used, constraints }]. Null when the fit fails.
 */
export function metaRegression(rows0, terms) {
  const rows = completeRows(rows0, terms);
  const { X, names, blocks } = designMatrix(rows, terms);
  const fit = fitRows(rows, X);
  if (!fit) return null;
  const tr = rows.map(r => r.trial), P = cr2Parts(fit, tr), ct = cr2Table(fit, tr, P);
  const coefficients = names.map((n, j) => ({ term: n, est: fit.beta[j], se_model: fit.se[j], p_model: fit.pval[j], ...ct[j] }));
  const test = (term, cols) => {
    const m = modelF(fit, cols), C = cols.map(j => names.map((_, i) => (i === j ? 1 : 0))), h = cr2Wald(fit, tr, C, P);
    return { term, F_model: m.F, df1_model: m.df1, df2_model: m.df2, p_model: m.p, F_cr2: h.F, df1_cr2: h.df1, df2_cr2: h.df2, p_cr2: h.p, constraints_used: h.q, constraints: h.qRequested };
  };
  const tests = [test('all', names.map((_, j) => j).slice(1))];
  if (terms.length > 1) for (const t of terms) tests.push(test(t.code, blocks[t.code]));
  return { k_trials: uniq(tr).length, k_outcomes: rows.length, names, coefficients, tests, fit, rows, cr2: P };
}

/**
 * A univariable meta-regression on one numeric moderator as a bubble plot draws it: each outcome at its moderator value (`points`: x, yi, vi,
 * trial, the row) and the fitted mean b0 + b1·x with its CR2 95% CI (Satterthwaite df) at `n` + 1 values across the moderator's range
 * (`line`: x, est, lo, hi). Null for a factor, a model of several terms, or a failed fit.
 */
export function regressionLine(reg, term, n = 40) {
  if (!reg?.cr2 || isFactor(term) || reg.names.length !== 2 || reg.names[1] !== term.code) return null;
  const points = reg.rows.map(r => ({ x: valueOf(r, term), yi: r.yi, vi: r.vi, trial: r.trial, row: r }));
  const xs = points.map(p => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
  const line = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n).map(x => { const c = cr2Coef(reg.cr2, [1, x]); return { x, est: c.est, lo: c.lo, hi: c.hi }; });
  return { points, line };
}

// ---- permutation tests ------------------------------------------------------------------------------------------------------------
/** permute() of 05-resampling.R: each term in turn, a trial-level one across trials (one value each, in order of first appearance), an outcome-level one across rows. */
function permuteRows(rows, terms, rng) {
  let out = rows.map(r => ({ ...r }));
  for (const t of terms) {
    if (t.level === 'trial') {
      const first = new Map(); for (const r of out) if (!first.has(r.trial)) first.set(r.trial, r[t.var]);
      const ids = [...first.keys()], vals = rng.permute(ids.map(id => first.get(id))), to = new Map(ids.map((id, i) => [id, vals[i]]));
      out = out.map(r => ({ ...r, [t.var]: to.get(r.trial) }));
    } else { const vals = rng.permute(out.map(r => r[t.var])); out = out.map((r, i) => ({ ...r, [t.var]: vals[i] })); }
  }
  return out;
}
/**
 * The permutation test of one model: the observed model-based F of `test` (a term's code, or 'all'), then for each chunk c (R's
 * set.seed(sum(utf8ToInt(name)) * 10 + c)) B[c] permutations of the `permute` terms, counting draws with F at or above the observed (less
 * 1e-10). p = (1 + count) / (1 + draws). `chunks` is the list of draws per chunk, or an object { done } of chunks already run to resume.
 */
export function permutationTest(rows0, terms, { name, test = 'all', permute = terms.map(t => t.code), chunks = [333, 333, 333], done = [], onChunk = null } = {}) {
  const rows = completeRows(rows0, terms), levels = termLevels(rows, terms), perm = terms.filter(t => permute.includes(t.code));
  // a permutation can make a column redundant (a sham type found in one indication class only): it is dropped, as rma.mv drops it, and
  // the test reads the term's columns that remain (none left: no statistic, as anova() then fails)
  const stat = rs => {
    const d = designMatrix(rs, terms, levels), keep = independentColumns(d.X), at = new Map(keep.map((j, i) => [j, i]));
    const fit = fitRows(rs, d.X.map(r => keep.map(j => r[j])));
    if (!fit) return null;
    const cols = (test === 'all' ? d.names.map((_, j) => j).slice(1) : d.blocks[test]).filter(j => at.has(j)).map(j => at.get(j));
    return cols.length ? modelF(fit, cols).F : null;
  };
  const obs = stat(rows), out = [...done];
  for (let c = 1; c <= chunks.length; c++) {
    if (out.some(x => x.chunk === c)) continue;
    const rng = rRng(utf8Sum(name) * 10 + c);
    let ok = 0, ge = 0;
    for (let b = 0; b < chunks[c - 1]; b++) { const F = stat(permuteRows(rows, perm, rng)); if (F != null && Number.isFinite(F)) { ok++; if (F >= obs - 1e-10) ge++; } }
    const ch = { chunk: c, draws: chunks[c - 1], permutations: ok, n_ge: ge };
    out.push(ch); if (onChunk) onChunk(ch);
  }
  const perms = out.reduce((s, x) => s + x.permutations, 0), ge = out.reduce((s, x) => s + x.n_ge, 0);
  return { test: name, k_trials: uniq(rows.map(r => r.trial)).length, k_outcomes: rows.length, F_observed: obs, chunks: out.sort((a, b) => a.chunk - b.chunk), permutations: perms, n_ge: ge, p: (1 + ge) / (1 + perms) };
}

// ---- the trial bootstrap of the sham/active ratio ------------------------------------------------------------------------------------
/**
 * Resamples trials with replacement (R's set.seed(seed + c) and sample(trials, replace = TRUE)) and refits the joint model of sham and active
 * SMCR (mods = ~ 0 + type, outcomes in trials; each drawn copy its own trial): `stacked` rows { trial, yi, vi, type: 'sham' | 'active' } in
 * the order R stacks them. Returns { draws: [[sham, active]], ratio_median, ratio_lo, ratio_hi, share_active_le_0, resamples }.
 */
export function ratioBootstrap(stacked, { seed = 20261031, chunks = [333, 333, 333], done = [], onChunk = null } = {}) {
  const trials = uniq(stacked.map(r => r.trial)), by = new Map(trials.map(t => [t, stacked.filter(r => r.trial === t)]));
  const out = [...done];
  for (let c = 1; c <= chunks.length; c++) {
    if (out.some(x => x.chunk === c)) continue;
    const rng = rRng(seed + c), draws = [];
    for (let b = 0; b < chunks[c - 1]; b++) {
      const s = rng.sample(trials.length, trials.length, true).map(i => trials[i - 1]);
      const bd = s.flatMap((t, i) => by.get(t).map(r => ({ ...r, trial: `${t} ${i + 1}` })));
      const fit = fitRows(bd, bd.map(r => (r.type === 'active' ? [0, 1] : [1, 0])));
      draws.push(fit ? [fit.beta[0], fit.beta[1]] : null);
    }
    const ch = { chunk: c, draws }; out.push(ch); if (onChunk) onChunk(ch);
  }
  const all = out.sort((a, b) => a.chunk - b.chunk).flatMap(x => x.draws).filter(d => d && d.every(Number.isFinite)), ratio = all.map(([s, a]) => s / a);
  return { chunks: out.map(x => ({ chunk: x.chunk, draws: x.draws.length })), resamples: all.length, ratio_median: q7(ratio, 0.5), ratio_lo: q7(ratio, 0.025), ratio_hi: q7(ratio, 0.975),
    share_active_le_0: all.filter(([, a]) => a <= 0).length / all.length, draws: all };
}

// ---- trial-level associations --------------------------------------------------------------------------------------------------------
/** metafor's aggregate(escalc, cluster = trial, rho): one effect per trial, compound symmetry, inverse-variance; [{ trial, yi, vi, k }] in order of first appearance. */
export function aggregateByTrial(rows, rho = 0.5) {
  return uniq(rows.map(r => r.trial)).map(t => {
    const g = rows.filter(r => r.trial === t), S = g.map((a, i) => g.map((b, j) => (i === j ? a.vi : rho * Math.sqrt(a.vi * b.vi)))), Si = invSPD(S).inv;
    const w = Si.map(r => r.reduce((s, x) => s + x, 0)), sw = w.reduce((s, x) => s + x, 0);
    return { trial: t, yi: w.reduce((s, x, i) => s + x * g[i].yi, 0) / sw, vi: 1 / sw, k: g.length };
  });
}
/** Logistic regression of 0/1 `y` on one covariate by IRLS: { b0, b1, se1, z, p } (glm, binomial). */
export function logistic1(x, y) {
  let b = [0, 0];
  for (let it = 0; it < 100; it++) {
    const eta = x.map(v => b[0] + b[1] * v), p = eta.map(e => 1 / (1 + Math.exp(-e))), w = p.map(q => q * (1 - q));
    const g0 = y.reduce((s, v, i) => s + v - p[i], 0), g1 = y.reduce((s, v, i) => s + (v - p[i]) * x[i], 0);
    const h00 = w.reduce((s, v) => s + v, 0), h01 = w.reduce((s, v, i) => s + v * x[i], 0), h11 = w.reduce((s, v, i) => s + v * x[i] * x[i], 0), det = h00 * h11 - h01 * h01;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    b = [b[0] + d0, b[1] + d1];
    if (Math.max(Math.abs(d0), Math.abs(d1)) < 1e-12) break;
  }
  const p = x.map(v => 1 / (1 + Math.exp(-(b[0] + b[1] * v)))), w = p.map(q => q * (1 - q));
  const h00 = w.reduce((s, v) => s + v, 0), h01 = w.reduce((s, v, i) => s + v * x[i], 0), h11 = w.reduce((s, v, i) => s + v * x[i] * x[i], 0);
  const se1 = Math.sqrt(h00 / (h00 * h11 - h01 * h01)), z = b[1] / se1;
  return { b0: b[0], b1: b[1], se1, z, p: 2 * (1 - pnorm(Math.abs(z))) };
}
/**
 * 04-analysis.R section 9: the between-arm SMD per trial regressed on the sham SMCR per trial (both aggregated, rho 0.5; REML, Knapp-Hartung),
 * and failure of the primary endpoint on the sham SMCR per trial (logistic; odds ratio per 1 SMCR with its Wald CI).
 */
export function trialAssociations(prim, smdRows, endpointOf) {
  const sh = aggregateByTrial(prim), sd = aggregateByTrial(smdRows), shOf = new Map(sh.map(a => [a.trial, a.yi]));
  const tl = sd.filter(a => shOf.has(a.trial)).map(a => ({ trial: a.trial, y: a.yi, v: a.vi, x: shOf.get(a.trial) }));
  const r = tl.length >= 3 ? rmaModel(tl.map(a => a.y), tl.map(a => a.v), { method: 'REML', test: 'knha', X: tl.map(a => [1, a.x]) }) : null;
  const pe = sh.flatMap(a => (endpointOf(a.trial) || []).filter(v => v != null).map(v => ({ trial: a.trial, x: a.yi, failed: v === 'no' ? 1 : 0 })));
  const lg = pe.length >= 3 ? logistic1(pe.map(a => a.x), pe.map(a => a.failed)) : null;
  return [
    { code: 'TRL-SMD', analysis: 'Between-arm SMD on sham SMCR (meta-regression, Knapp-Hartung)', k_trials: tl.length, scale: 'slope (SMD per 1 SMCR)',
      estimate: r?.beta[1] ?? null, ci_lo: r?.ci_lb[1] ?? null, ci_hi: r?.ci_ub[1] ?? null, p: r?.pval[1] ?? null, events: null },
    { code: 'TRL-FAIL', analysis: 'Failed primary endpoint on sham SMCR (logistic)', k_trials: pe.length, scale: 'odds ratio per 1 SMCR',
      estimate: lg ? Math.exp(lg.b1) : null, ci_lo: lg ? Math.exp(lg.b1 - Z * lg.se1) : null, ci_hi: lg ? Math.exp(lg.b1 + Z * lg.se1) : null, p: lg?.p ?? null, events: pe.filter(a => a.failed).length },
  ];
}

// ---- serious adverse events and percent improvement ------------------------------------------------------------------------------------
/**
 * The sham arms' serious adverse event rate per participant over the blinded phase (04-analysis.R section 11): the plan's coding rows
 * { trial, arm, events, n, basis, cell } of the arms that are not overlap-group secondaries, pooled by the Poisson-normal GLMM. A coded cell
 * whose text has changed in the record, and a coded arm the record no longer has, are listed (`changed`, `missing`), as are sham arms whose
 * cell is not coded (`uncoded`). `shamArms` are the record's sham arms: { trial, arm, sae_cell, overlap_secondary }.
 */
export function saeRate(coding = [], shamArms = []) {
  const arm = new Map(); for (const a of shamArms) { const k = `${a.trial}|${a.arm}`; if (!arm.has(k)) arm.set(k, a); }
  const secondary = new Set(shamArms.filter(a => a.overlap_secondary).map(a => a.trial));
  const rows = coding.filter(c => !secondary.has(c.trial)), missing = [], changed = [];
  for (const c of rows) { const a = arm.get(`${c.trial}|${c.arm}`); if (!a) missing.push(c); else if (c.cell != null && String(a.sae_cell ?? '') !== String(c.cell)) changed.push({ ...c, now: a.sae_cell }); }
  const coded = new Set(coding.map(c => `${c.trial}|${c.arm}`));
  const uncoded = [...arm.values()].filter(a => !coded.has(`${a.trial}|${a.arm}`) && a.sae_cell && !/^\s*$/.test(a.sae_cell));
  const g = rows.length >= 2 ? poolGlmmRate(rows.map(c => [c.events, c.n])) : null, ev = rows.reduce((s, c) => s + c.events, 0), n = rows.reduce((s, c) => s + c.n, 0);
  return { k_trials: rows.length, participants: n, events: ev, arms_with_zero: rows.filter(c => c.events === 0).length, rate: g?.rate ?? null, ci_lo: g?.lo ?? null, ci_hi: g?.hi ?? null,
    pi_lo: g?.pi_lo ?? null, pi_hi: g?.pi_hi ?? null, tau2: g?.tau2 ?? null, crude_rate: n ? ev / n : null, trials_not_usable: uniq(shamArms.map(a => a.trial)).length - rows.length,
    rows, missing, changed, uncoded };
}
/** The sham arms' percent improvement (descriptive; one outcome per arm, the first slot with a percent change): by group, median, quartiles (type 7), range. */
export function percentImprovement(sham, by = 'indication_class') {
  const seen = new Set();
  const pc = sham.filter(a => a.percent_change != null && Number.isFinite(Number(a.percent_change)) && a.dir != null && a.design !== 'randomized-withdrawal')
    .sort((a, b) => (a.trial < b.trial ? -1 : a.trial > b.trial ? 1 : a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : a.outcome_slot < b.outcome_slot ? -1 : a.outcome_slot > b.outcome_slot ? 1 : 0))
    .filter(a => { const k = `${a.trial}|${a.arm}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(a => ({ ...a, improvement_pct: a.dir * Number(a.percent_change) }));
  const sum = (group, x) => withReads({ group, k_trials: uniq(x.map(a => a.trial)).length, k_arms: x.length, median: q7(x.map(a => a.improvement_pct), 0.5), q1: q7(x.map(a => a.improvement_pct), 0.25),
    q3: q7(x.map(a => a.improvement_pct), 0.75), min: Math.min(...x.map(a => a.improvement_pct)), max: Math.max(...x.map(a => a.improvement_pct)) }, x);
  return { rows: pc, groups: pc.length ? [sum('All', pc), ...sortC(uniq(pc.map(a => a[by]))).map(g => sum(g, pc.filter(a => a[by] === g)))] : [] };
}

// ---- the data a stored resampling result belongs to ----------------------------------------------------------------------------------
/** A short fingerprint (FNV-1a, hex) of the values a resampling run reads, so a stored result is used only while its data are unchanged. */
export function fingerprint(rows, cols) {
  let h = 0x811c9dc5;
  const s = JSON.stringify(rows.map(r => cols.map(c => (typeof r[c] === 'number' ? Number(r[c].toPrecision(12)) : r[c] ?? null))));
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
