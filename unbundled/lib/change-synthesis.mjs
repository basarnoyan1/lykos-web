// The "Change" family of Syntheses (plan §4.15g): within-arm standardized mean changes (SMCR, baseline SD, Hedges-corrected, improvement
// positive) of a review's arms, pooled with outcomes nested in trials (lib/meta-multilevel.mjs) and inferred with CR2 cluster-robust
// standard errors on Satterthwaite df (lib/meta-cr2.mjs); prediction intervals from the CR2 SE, the summed variance components and the same
// df. A port of the sham-response review's 04-analysis.R (1 Nov 2026) so its syntheses are Lykos's own: the primary pool and its protocol
// structure (outcomes in trials in classes, clustered by class), subgroups, sensitivity sets (data selections and correlation choices),
// randomized-withdrawal phases, the active arms and the sham/active ratio (joint model, Fieller), the between-arm SMD, responders (GLMM,
// lib/meta-glmm.mjs), the multilevel Egger tests, the benchmark by class and GRADE for a single-group estimate. The rows come from
// lib/change-rows.mjs; the plan (what is pooled, the sensitivity sets, the subgroups) is `s.synthesis.change` (CHANGE_PLAN_KEYS).
// Resampling (permutation tests, the trial bootstrap) is not run here: tools/lykos-change-resampling.mjs runs it and the plan keeps its results. Pure; app/test/change-synthesis.test.mjs checks it with fixed numbers.
import { escalcRow } from './meta-escalc.mjs';
import { fitMultilevel, predictMean, lrt, invSPD } from './meta-multilevel.mjs';
import { cr2Parts, cr2Table, cr2Coef } from './meta-cr2.mjs';
import { model as rmaModel, qt975 } from './meta-general.mjs';
import { poolGlmm } from './meta-glmm.mjs';
import { changeRows } from './change-rows.mjs';
import { metaRegression, trialAssociations, saeRate, percentImprovement, fingerprint } from './change-moderators.mjs';
import { withReads, pairReads } from './run-reads.mjs';
import { conversionPlan, convertedPools } from './instrument-crosswalks.mjs';
import { vocabFor, termOf, pathOf, isLeaf } from './vocabularies.mjs';

/** The plan's keys: { rows, assumedR, minTrials, roles: { sham, active }, by, withdrawal, sensitivity: [{ code, title, where?, effect?, add? }], subgroups: [{ by, title }], codes } */
// moderators: { terms: [{ code, var, title, level, ref?, levels? }], univariable: [code], multivariable: [{ code, title, terms: [code] }] } (lib/change-moderators.mjs);
// resampling: { permutations: { chunks: [B per chunk], <test>: [B per chunk] }, bootstrap: { seed, chunks }, results: { <test>: {...}, bootstrap: {...} } }, the stored
// results of tools/lykos-change-resampling.mjs, each used while the fingerprint of its data is the current one; sae: { rule, coding: [{ trial, arm, events, n, basis, cell }] }
export const CHANGE_PLAN_KEYS = ['rows', 'assumedR', 'minTrials', 'by', 'sensitivity', 'subgroups', 'titles', 'responderSensitivity', 'moderators', 'resampling', 'sae', 'labels'];
/**
 * How a level is printed in every table and figure (2 Nov 2026, the owner: "dont use lower case words"): the plan's own label map
 * (`labels`: { "clinician-rated": "Clinician-rated", … }), else the value with its first letter capitalized (sentence case; an acronym such as
 * DBS stays as it is). The value itself stays the key the rows are selected by.
 */
export const levelLabel = (plan, v) => { const s = String(v ?? ''); const own = plan?.labels?.[s]; return own != null && own !== '' ? String(own) : s.charAt(0).toLocaleUpperCase('en-US') + s.slice(1); };

// ---- rows and effects ------------------------------------------------------------------------------------------------------------
const smcr = (change, sd, n, r, dir) => { const e = escalcRow('SMCR', [n, 0, change, sd, r]); return e && Number.isFinite(e.yi) ? { yi: e.yi * dir, vi: e.vi } : null; };
/** Every arm row with its SMCR and the variants the sensitivity sets use (r_prim, yi, vi, yi_r03 …, yi_rms, yi_fb, sei_mod). */
export function withEffects(arms, { assumedR = 0.5 } = {}) {
  return arms.map((a, ix) => {
    const out = { ...a, ix, r_prim: a.r_trial ?? assumedR, r_source: a.r_trial == null ? `imputed ${assumedR}` : 'trial' };
    if (a.smcr_ok) {
      const at = r => smcr(a.change_used, a.baseline_sd, a.n, r, a.dir);
      const set = (k, e) => { out[`yi${k}`] = e?.yi ?? null; out[`vi${k}`] = e?.vi ?? null; };
      set('', at(out.r_prim)); set('_r03', at(a.r_trial ?? 0.3)); set('_r07', at(a.r_trial ?? 0.7)); set('_r05', at(0.5));
      set('_rms', smcr(a.change_used, a.end_sd == null ? a.baseline_sd : Math.sqrt((a.baseline_sd ** 2 + a.end_sd ** 2) / 2), a.n, out.r_prim, a.dir));
      set('_fb', { yi: out.yi, vi: out.vi });
      out.sei_mod = Math.sqrt(2 * (1 - out.r_prim) / a.n);
    } else if (a.dir != null && a.change_used != null && a.baseline_sd == null && a.end_sd > 0 && a.n > 2) {
      const e = smcr(a.change_used, a.end_sd, a.n, 0.5, a.dir); out.yi_fb = e?.yi ?? null; out.vi_fb = e?.vi ?? null;
    }
    return out;
  });
}
/** A row filter: { field: [values] } (all must hold), { not }, { all: [] }, { any: [] }; a boolean value tests truth, others the text. */
export function matchRow(row, spec) {
  if (!spec) return true;
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'not') { if (matchRow(row, v)) return false; continue; }
    if (k === 'all') { if (!v.every(x => matchRow(row, x))) return false; continue; }
    if (k === 'any') { if (!v.some(x => matchRow(row, x))) return false; continue; }
    const vals = Array.isArray(v) ? v : [v], x = row[k];
    if (!vals.some(w => (typeof w === 'boolean' ? Boolean(x) === w : w === null ? x == null : String(x) === String(w)))) return false;
  }
  return true;
}
/** Participants of a set: over the arms, the largest n each arm reports. */
export function participants(rows) {
  const m = new Map(); for (const r of rows) { const k = `${r.trial}\u0001${r.arm}`; m.set(k, Math.max(m.get(k) ?? -Infinity, r.n)); }
  return [...m.values()].reduce((s, x) => s + x, 0);
}
const uniq = a => [...new Set(a)];
/** `obj[key]` computed by `fn` the first time it is read (a class-level fit costs a hundred times a trial-level one). */
const lazy = (obj, key, fn) => { let v, done = false; Object.defineProperty(obj, key, { enumerable: true, configurable: true, get: () => (done ? v : (done = true, v = fn())) }); return obj; };
const trialsOf = rows => uniq(rows.map(r => r.trial));

// ---- one pooled estimate ----------------------------------------------------------------------------------------------------------
/**
 * The pool of `rows` (each with trial, arm, n, indication_class and the effect columns `y`, `v`): struct 'trial' (outcomes in trials,
 * CR2 by trial) or 'class' (outcomes in trials in classes, CR2 by class). { k_trials, k_outcomes, participants, structure, est, se, df,
 * ci_lo, ci_hi, p, pi_lo, pi_hi, ci/pi model, sigma2_class, sigma2_trial, sigma2_outcome, Q, Q_p, note, fit }; not pooled below minTrials.
 */
export function robustPool(rows0, { y = 'yi', v = 'vi', struct = 'trial', minTrials = 3, keepFit = false } = {}) {
  const rows = rows0.filter(r => r[y] != null && Number.isFinite(r[y]) && r[v] > 0), J = trialsOf(rows).length;
  const base = { k_trials: J, k_outcomes: rows.length, participants: rows.length ? participants(rows) : 0, structure: struct, est: null, note: '' };
  if (J < minTrials) return { ...base, note: `fewer than ${minTrials} trials: not pooled` };
  let st = struct;
  if (st === 'class' && uniq(rows.map(r => r.indication_class)).length < 3) st = 'trial (class level not fitted: fewer than 3 classes)';
  const yi = rows.map(r => r[y]), vi = rows.map(r => r[v]), tr = rows.map(r => r.trial), es = rows.map((_, i) => i), cls = rows.map(r => r.indication_class);
  const isClass = st === 'class';
  let fit = fitMultilevel({ yi, vi, levels: isClass ? [cls, tr, es] : [tr, es] });
  if (!fit && !isClass) { fit = fitMultilevel({ yi, vi, levels: [tr] }); st = 'trial (outcome level dropped)'; }
  if (!fit) return { ...base, structure: st, note: 'fit failed' };
  const cl = isClass ? cls : tr, pr = predictMean(fit);
  let c;
  try { c = cr2Table(fit, cl)[0]; } catch { c = null; }
  if (!c || c.se == null || !Number.isFinite(c.se)) return { ...base, structure: st, est: fit.beta[0], ci_lo_model: pr.ci_lb, ci_hi_model: pr.ci_ub, note: 'CR2 not computable (singular)' };
  const s2 = fit.sigma2, tot = s2.reduce((a, b) => a + b, 0), q = qt975(c.df), piSe = Math.sqrt(c.se ** 2 + tot);
  return { ...base, structure: st, est: c.est, se: c.se, df: c.df, ci_lo: c.lo, ci_hi: c.hi, p: c.p, pi_lo: c.est - q * piSe, pi_hi: c.est + q * piSe,
    ci_lo_model: pr.ci_lb, ci_hi_model: pr.ci_ub, pi_lo_model: pr.pi_lb, pi_hi_model: pr.pi_ub,
    sigma2_class: isClass ? s2[0] : null, sigma2_trial: isClass ? s2[1] : s2[0], sigma2_outcome: isClass ? s2[2] : s2.length > 1 ? s2[1] : null,
    Q: fit.QE, Q_p: fit.QEp, note: isClass ? 'CR2 clustered by indication class' : 'CR2 clustered by trial',
    ...(keepFit ? { fit, weights: rowWeights(fit) } : {}) };
}
/** Each row's weight in percent as metafor's weights() gives it for rma.mv: the diagonal of M⁻¹ over its sum. */
function rowWeights(fit) {
  const W = invSPD(fit.M)?.inv; if (!W) return fit.yi.map(() => null);
  const w = W.map((r, i) => r[i]), t = w.reduce((s, x) => s + x, 0);
  return w.map(x => (100 * x) / t);
}

/** One effect per trial (metafor aggregate, compound symmetry with `rho`, inverse-variance), then REML with Knapp–Hartung: { est, ci, pi, i2, tau2, k }. */
export function aggregatedPool(rows, { rho = 0.5 } = {}) {
  const ag = trialsOf(rows).map(t => {
    const g = rows.filter(r => r.trial === t), S = g.map((a, i) => g.map((b, j) => (i === j ? a.vi : rho * Math.sqrt(a.vi * b.vi)))), Si = invSPD(S).inv;
    const w = Si.map(r => r.reduce((s, x) => s + x, 0)), sw = w.reduce((s, x) => s + x, 0);
    return { trial: t, yi: w.reduce((s, x, i) => s + x * g[i].yi, 0) / sw, vi: 1 / sw };
  });
  const r = rmaModel(ag.map(a => a.yi), ag.map(a => a.vi), { method: 'REML', test: 'knha' });
  if (!r) return null;
  const est = r.beta[0], se = r.se[0], piSe = Math.sqrt(se * se + r.tau2);
  return { k_trials: ag.length, est, se, df: r.df, ci_lo: r.ci_lb[0], ci_hi: r.ci_ub[0], p: r.pval[0], pi_lo: est - r.crit * piSe, pi_hi: est + r.crit * piSe, tau2: r.tau2, i2: r.I2, Q: r.QE, Q_p: r.QEp, trials: ag };
}
/** A meta-regression on one numeric moderator (outcomes in trials, CR2 by trial): the slope's CR2 test and its model-based p. */
export function slopeTest(rows, x) {
  const yi = rows.map(r => r.yi), vi = rows.map(r => r.vi), tr = rows.map(r => r.trial);
  const fit = fitMultilevel({ yi, vi, levels: [tr, rows.map((_, i) => i)], X: rows.map(r => [1, x(r)]) });
  if (!fit) return null;
  const c = cr2Table(fit, tr)[1];
  return { ...c, p_model: fit.pval[1], k_trials: trialsOf(rows).length, k_outcomes: rows.length };
}
/** Sham and active SMCR in the same trials from one model (mods = ~ 0 + type, outcomes in trials, CR2 by trial): pooled each, the ratio with its Fieller CI, active minus sham. */
export function jointRatio(sham, active, { minTrials = 3 } = {}) {
  const st = [...sham.map(r => ({ ...r, type: 0 })), ...active.map(r => ({ ...r, type: 1 }))], k = trialsOf(st).length;
  if (k < minTrials) return { k_trials: k, ratio: null };
  const fit = fitMultilevel({ yi: st.map(r => r.yi), vi: st.map(r => r.vi), levels: [st.map(r => r.trial), st.map((_, i) => i)], X: st.map(r => (r.type ? [0, 1] : [1, 0])) });
  if (!fit) return { k_trials: k, ratio: null };
  const P = cr2Parts(fit, st.map(r => r.trial)), [bS, bA] = P.b, V = P.V;
  const df = Math.min(cr2Coef(P, [1, 0]).df, cr2Coef(P, [0, 1]).df), tq = qt975(df);
  const qa = bA ** 2 - tq ** 2 * V[1][1], qb = -2 * (bS * bA - tq ** 2 * V[0][1]), qc = bS ** 2 - tq ** 2 * V[0][0], disc = qb ** 2 - 4 * qa * qc;
  const fl = qa > 0 && disc > 0 ? [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)].sort((a, b) => a - b) : [null, null];
  const dif = cr2Coef(P, [-1, 1]);
  return { k_trials: k, k_pairs: sham.length, pooled_sham: bS, pooled_active: bA, ratio: bS / bA, fieller_lo: fl[0], fieller_hi: fl[1], df,
    active_minus_sham: dif.est, active_minus_sham_lo: dif.lo, active_minus_sham_hi: dif.hi, active_minus_sham_p: dif.p };
}
/** R's quantile type 7. */
export function quantile7(xs, p) { const a = [...xs].sort((x, y) => x - y), h = (a.length - 1) * p, lo = Math.floor(h); return a[lo] + (h - lo) * ((a[Math.ceil(h)] ?? a[lo]) - a[lo]); }
/** The responders' GLMM (logit) of arms { responders_k, responders_n }: { k_trials, k_arms, participants, est, ci_lo, ci_hi, pi_lo, pi_hi, tau2 } (percent). */
export function respondersPool(arms) {
  const base = { k_trials: trialsOf(arms).length, k_arms: arms.length, participants: arms.reduce((s, a) => s + a.responders_n, 0), events: arms.reduce((s, a) => s + a.responders_k, 0) };
  const g = arms.length >= 2 ? poolGlmm(arms.map(a => [a.responders_k, a.responders_n])) : null;
  return g ? { ...base, est: 100 * g.estimate, ci_lo: 100 * g.lo, ci_hi: 100 * g.hi, pi_lo: 100 * g.pi_lo, pi_hi: 100 * g.pi_hi, tau2: g.tau2 } : { ...base, est: null };
}

// ---- the plan --------------------------------------------------------------------------------------------------------------------
const WITHDRAWAL = 'randomized-withdrawal';
const sortC = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));   // R's sort in the C locale (WebR)
const firstPer = (rows, key) => { const seen = new Set(); return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true; }); };
const byTrialArmSlot = (a, b) => (a.trial < b.trial ? -1 : a.trial > b.trial ? 1 : a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : a.outcome_slot < b.outcome_slot ? -1 : a.outcome_slot > b.outcome_slot ? 1 : 0);

/** The code of the sensitivity set the scale decisions add (the primary set with the arms of scales kept for sensitivity analyses). */
export const SCALES_SET = 'scales-sensitivity';
// ---- the review's decisions about its scales (plan G3a; lib/scales.mjs) -------------------------------------------------------------
/**
 * The plan with the project's scale decisions beside it (s.synthesis.scales: { [code]: { use, to? } }): what changeSynthesis reads, here,
 * in the worker and in the verification lists. A project without decisions gets its plan as stored, so nothing it made goes stale.
 */
export const changePlan = s => {
  const plan0 = s?.synthesis?.change; if (!plan0) return null;
  // a subgroup by a coded field carries each study's level (W3: a class-only code counts under its class); without one the plan is as stored
  const codes = codedSubgroups(s, plan0), plan = codes ? { ...plan0, codes } : plan0;
  const scales = s.synthesis.scales;
  if (!scales || !Object.keys(scales).length) return plan;
  // a scale to convert brings its crosswalk and each arm's covariate mix (W3), so the worker, which has the rows and the plan only, converts too
  const conversions = conversionPlan(s, scales);
  return { ...plan, scales, ...(conversions ? { conversions } : {}) };
};
/**
 * The levels of the subgroups that name a coded field, a category column with a vocabulary, by its id or short id ({ by: 'indication_code',
 * level?: 'class' | 'term' }): each study's class, the top of its term's path, so a value coded at the class alone counts under the class (W3,
 * as the instrument map and the Data summary count it); with level 'term' each study's own term, a value coded at a class with terms under it
 * named "<class>, class only". A subgroup by a row's own attribute (indication_class) is left as it is. { [by]: { of: { paper_id: code },
 * labels: { code: label } } }, or null when no subgroup names a coded field.
 */
export function codedSubgroups(s, plan) {
  const t = (s?.templates || []).find(x => x.id === plan?.rows?.table) || (s?.templates || [])[0];
  if (!t || !(plan?.subgroups || []).length) return null;
  const out = {};
  for (const g of plan.subgroups) {
    const col = (t.columns || []).find(c => c.vocabulary && (c.id === g.by || c.id === `${t.id}.${g.by}`)), vocab = col && vocabFor(s, col);
    if (!vocab) continue;
    const of = {}, labels = {}, pre = `:${col.id}`;
    for (const [k, v] of Object.entries(s.values || {})) {
      const at = k.indexOf(pre), tail = at > 0 ? k.slice(at + pre.length) : null;
      if (tail == null || (tail && !tail.startsWith('@')) || v?.availability === 'not_found') continue;
      const pid = k.slice(0, at), term = typeof v?.normalized_value === 'string' ? termOf(vocab, v.normalized_value) : null;
      if (!term || of[pid]) continue;   // a study's first coded cell (its own, else its first arm's)
      const top = termOf(vocab, pathOf(vocab, term.code)[0]) || term, level = g.level === 'term' ? term : top;
      of[pid] = level.code;
      labels[level.code] = g.level === 'term' && !isLeaf(vocab, term.code) ? `${term.label}, class only` : level.label;
    }
    out[subgroupKey(g)] = { of, labels };
  }
  return Object.keys(out).length ? out : null;
}
/** A subgroup's key in plan.codes and in the run's rows: its field, and ':term' for a coded field read by term. */
export const subgroupKey = g => (g?.level === 'term' ? `${g.by}:term` : g?.by);
/** A row's level in a subgroup: a coded field's from the plan (codedSubgroups), else the row's own attribute. */
const subgroupLevel = (plan, g) => { const c = plan?.codes?.[subgroupKey(g)]; return c ? r => c.of[r.paper_id] ?? 'NA' : r => r[g.by]; };
/** What the review decided for a scale code: 'own' (pooled on its own, the default), 'convert', 'sensitivity' or 'exclude'. */
export const scaleUse = (scales, code) => (code && scales?.[code]?.use) || 'own';
/**
 * The rows as the scale decisions leave them. An excluded scale's arms leave every analysis, with the pairs and medians of their outcome;
 * a scale kept for sensitivity analyses keeps its arms, marked `scale_use: 'sensitivity'`, and loses its pairs and medians, so it enters
 * only the same-scale pools and the set that adds it back. Without such a decision the rows are returned as they are.
 */
export function withScaleDecisions(rows, scales) {
  if (!rows?.arms || !Object.values(scales || {}).some(d => d?.use === 'exclude' || d?.use === 'sensitivity')) return rows;
  const out = [], gone = new Set();
  for (const a of rows.arms) {
    const use = scaleUse(scales, a.instrument);
    if (use === 'exclude' || use === 'sensitivity') gone.add(`${a.trial}|${a.outcome_slot}`);
    if (use === 'exclude') continue;
    out.push(use === 'sensitivity' ? { ...a, scale_use: 'sensitivity' } : a);
  }
  const kept = x => !gone.has(`${x.trial}|${x.outcome_slot}`);
  return { ...rows, arms: out, pairs: (rows.pairs || []).filter(kept), medians: (rows.medians || []).filter(kept) };
}

/** The sets a plan pools: { all, sham, prim, sec, rw, sens }, every arm with its effects; `sens` holds the arms of scales kept for sensitivity analyses. */
export function changeSets(rows, { assumedR = 0.5 } = {}) {
  const all = withEffects(rows.arms, { assumedR }), shamAll = all.filter(a => a.arm_role === 'sham');
  const sham = shamAll.filter(a => !a.overlap_secondary && a.scale_use !== 'sensitivity');
  return { all, shamAll, sham, secondaryTrials: uniq(all.filter(a => a.overlap_secondary).map(a => a.trial)),
    sec: shamAll.filter(a => a.overlap_secondary && a.scale_use !== 'sensitivity' && a.yi != null && a.design !== WITHDRAWAL), prim: sham.filter(a => a.yi != null && a.design !== WITHDRAWAL),
    rw: sham.filter(a => a.yi != null && a.design === WITHDRAWAL),
    sens: shamAll.filter(a => !a.overlap_secondary && a.scale_use === 'sensitivity' && a.yi != null && a.design !== WITHDRAWAL) };
}
/** The rows of one sensitivity set: { rows, y, v }. */
export function sensitivityRows(def, sets, rows) {
  const eff = def.effect || '', y = `yi${eff}`, v = `vi${eff}`;
  let base = sets.prim;
  if (def.add === 'secondary') base = [...sets.prim, ...sets.sec];
  if (def.add === 'end-sd') base = sets.sham.filter(a => a.yi_fb != null && a.design !== WITHDRAWAL);
  if (def.add === 'medians') {
    const inPrim = new Set(sets.prim.map(a => a.trial));
    const med = (rows.medians || []).filter(m => !inPrim.has(m.trial)).map(m => ({ ...m, ...(smcr(m.c_mean, m.b_sd, m.n, 0.5, m.dir) || {}) })).filter(m => m.yi != null);
    base = [...sets.prim, ...med];
  }
  let out = base.filter(r => matchRow(r, def.where));
  if (def.excludeTrialsWhere) { const drop = new Set(sets.sham.filter(r => matchRow(r, def.excludeTrialsWhere)).map(r => r.trial)); out = out.filter(r => !drop.has(r.trial)); }
  return { rows: out, y: eff === '_fb' ? 'yi_fb' : y, v: eff === '_fb' ? 'vi_fb' : v };
}

/**
 * The same-instrument sensitivity analysis (plan G3a): the primary rows grouped by their instrument code (lib/change-rows.mjs carries
 * `instrument` on a row whose outcome column is coded), one pool per instrument that at least `minTrials` trials share. Rows with no
 * code are left out; with none coded the list is empty and nothing is fitted. `pool(rows)` is the caller's fit.
 */
export function sameInstrumentPools(prim, pool, { minTrials = 3 } = {}) {
  const by = new Map();
  // the rows a pool fits (robustPool's filter): a trial counts only with a finite effect
  for (const r of prim) if (r.instrument && r.yi != null && Number.isFinite(r.yi) && r.vi > 0) { if (!by.has(r.instrument)) by.set(r.instrument, []); by.get(r.instrument).push(r); }
  return [...by.entries()].map(([instrument, rows]) => ({ instrument, rows, trials: new Set(rows.map(r => r.trial)).size }))
    .filter(x => x.trials >= minTrials).sort((a, b) => b.trials - a.trials || (a.instrument < b.instrument ? -1 : 1))
    .map(x => ({ instrument: x.instrument, trials: x.trials, rows: x.rows.length, pool: pool(x.rows) }));
}

/**
 * The rows each pool of the plan reads, without fitting anything: { pa (sham/active pairs with both effects), act, matched, sm, am, stacked
 * (the joint model's sham and active rows), rr (raw ratios), smdRows (between-arm SMD), rs (responders, one outcome per sham arm), rsp, rsw
 * (randomized withdrawal) }. changeSynthesis pools these; the verification lists (lib/verification-lists.mjs) read them for the values
 * that enter a synthesis.
 */
export function changeDatasets(rows, plan = {}, sets = changeSets(rows, { assumedR: plan.assumedR ?? 0.5 })) {
  const { all, sham } = sets;
  // active arms and the ratio (the pairs of trials that are not overlap-group secondaries and not randomized withdrawal)
  const key = (t, sl, a) => `${t}|${sl}|${a}`, effOf = new Map(all.map(a => [key(a.trial, a.outcome_slot, a.arm), a]));
  const secT = new Set(sets.secondaryTrials);
  const pa = rows.pairs.filter(p => !secT.has(p.trial) && p.design !== WITHDRAWAL && p.active_change != null && p.active_bsd != null && p.dir != null && p.active_n > 2).map(p => {
    const sh = effOf.get(key(p.trial, p.outcome_slot, p.sham_arm)), e = smcr(p.active_change, p.active_bsd, p.active_n, p.active_r_trial ?? (plan.assumedR ?? 0.5), p.dir);
    return { ...p, sham_yi: sh?.yi ?? null, sham_vi: sh?.vi ?? null, act_yi: e?.yi ?? null, act_vi: e?.vi ?? null };
  });
  const act = pa.map(p => ({ trial: p.trial, arm: p.active_arms, n: p.active_n, indication_class: p.indication_class, yi: p.act_yi, vi: p.act_vi, outcome_slot: p.outcome_slot }));
  const matched = pa.filter(p => p.sham_yi != null);
  const sm = matched.map(p => ({ trial: p.trial, arm: p.sham_arm, n: p.sham_n, indication_class: p.indication_class, yi: p.sham_yi, vi: p.sham_vi }));
  const am = matched.map(p => ({ trial: p.trial, arm: p.active_arms, n: p.active_n, indication_class: p.indication_class, yi: p.act_yi, vi: p.act_vi }));
  const rr = firstPer(matched.filter(p => p.sham_change != null && p.active_change != null).map(p => ({ trial: p.trial, outcome_slot: p.outcome_slot, imp_s: p.dir * p.sham_change, imp_a: p.dir * p.active_change }))
    .filter(r => r.imp_a > 0).sort((a, b) => (a.trial < b.trial ? -1 : a.trial > b.trial ? 1 : a.outcome_slot < b.outcome_slot ? -1 : 1)), r => r.trial).map(r => ({ ...r, ratio: r.imp_s / r.imp_a }));
  const stacked = [...sm.map(r => ({ ...r, type: 'sham' })), ...am.map(r => ({ ...r, type: 'active' }))];
  // between-arm SMD at the end of the blinded phase, parallel and delayed-activation designs (positive favours active)
  const ps = rows.pairs.filter(p => !secT.has(p.trial) && p.design === 'parallel' && [p.sham_end_mean, p.sham_end_sd, p.active_end_mean, p.active_end_sd, p.dir].every(x => x != null) && p.sham_n > 1 && p.active_end_n > 1);
  const smdRows = ps.map(p => { const e = escalcRow('SMD', [p.active_end_mean, p.active_end_sd, p.active_end_n, p.sham_end_mean, p.sham_end_sd, p.sham_n]);
    return { trial: p.trial, outcome_slot: p.outcome_slot, arm: p.sham_arm, n: p.sham_n + p.active_end_n, indication_class: p.indication_class, yi: e.yi * p.dir, vi: e.vi }; });
  // responders: one outcome per sham arm (the first slot with k/n), randomized withdrawal apart
  const rs = firstPer(sham.filter(a => a.responders_k != null && a.responders_n > 0).sort(byTrialArmSlot), r => `${r.trial}|${r.arm}`);
  const rsp = rs.filter(a => a.design !== WITHDRAWAL), rsw = rs.filter(a => a.design === WITHDRAWAL);
  return { pa, act, matched, sm, am, rr, stacked, smdRows, rs, rsp, rsw };
}

/** The review's whole synthesis from its rows and plan (s.synthesis.change): every pooled estimate, ready for records, tables and the report. */
export function changeSynthesis(s, plan = changePlan(s) || {}, { rows: given = changeRows(s, plan.rows || {}), loo = false } = {}) {
  const rows = withScaleDecisions(given, plan.scales);
  const minTrials = plan.minTrials ?? 3, by = plan.by || 'indication_class', sets = changeSets(rows, { assumedR: plan.assumedR ?? 0.5 });
  const { prim, rw, sham, all } = sets, memo = new Map(), ds = changeDatasets(rows, plan, sets);
  // one fit per set of rows and options: the benchmark, GRADE and the subgroups ask for the same pools
  const pool = (x, o = {}) => {
    const k = x.every(r => r.ix != null) ? `${o.y || 'yi'}|${o.v || 'vi'}|${o.struct || 'trial'}|${o.keepFit ? 1 : 0}|${x.map(r => r.ix).join(',')}` : null;
    if (k && memo.has(k)) return memo.get(k);
    // each pool keeps the rows it read (lib/run-reads.mjs): the run's record names them per output
    const r = withReads(robustPool(x, { minTrials, ...o }), x); if (k) memo.set(k, r); return r;
  };
  const respPool = x => { const k = `resp|${x.map(r => r.ix).join(',')}`; if (!memo.has(k)) memo.set(k, withReads(respondersPool(x), x)); return memo.get(k); };
  // the primary pool, its protocol structure (a class level) and the test between them
  // a plan whose patterns pool nothing has no model to fit (its pools then say so: fewer than minTrials)
  const fT = prim.length && fitMultilevel({ yi: prim.map(r => r.yi), vi: prim.map(r => r.vi), levels: [prim.map(r => r.trial), prim.map((_, i) => i)] });
  const fC = prim.length && fitMultilevel({ yi: prim.map(r => r.yi), vi: prim.map(r => r.vi), levels: [prim.map(r => r[by]), prim.map(r => r.trial), prim.map((_, i) => i)] });
  const perClass = new Map(); for (const r of prim) { const m = perClass.get(r[by]) || new Set(); m.add(r.trial); perClass.set(r[by], m); }
  const structure = fT && fC ? { classes: perClass.size, classes_with_2plus_trials: [...perClass.values()].filter(x => x.size >= 2).length, sigma2_class: fC.sigma2[0], ...lrt(fC, fT) } : null;
  const primary = lazy({ trial: pool(prim, { keepFit: true }), aggregated: prim.length ? withReads(aggregatedPool(prim), prim) : null, structure }, 'class', () => pool(prim, { struct: 'class' }));
  const levels = sortC(uniq(prim.map(r => r[by])));
  const byLevel = levels.map(level => ({ level, pool: pool(prim.filter(r => r[by] === level)) }));
  const sensitivity = (plan.sensitivity || []).map(def => {
    const { rows: x, y, v } = sensitivityRows(def, sets, rows);
    return lazy({ code: def.code, title: def.title, trial: pool(x, { y, v }), rows: x.length }, 'class', () => pool(x, { y, v, struct: 'class' }));
  });
  // the scales the review keeps for sensitivity analyses (lib/scales.mjs): the primary set with their arms added back
  if (sets.sens.length) { const x = [...prim, ...sets.sens]; sensitivity.push(lazy({ code: SCALES_SET, title: 'With the scales kept for sensitivity analyses', trial: pool(x), rows: x.length }, 'class', () => pool(x, { struct: 'class' }))); }
  // each level with its printed label (levelLabel), in the order of the labels
  const subgroupsOf = () => (plan.subgroups || []).map(g => { const at = subgroupLevel(plan, g), own = plan.codes?.[subgroupKey(g)]?.labels;
    return { by: g.by, key: subgroupKey(g), title: g.title, levels: uniq(prim.map(at)).map(level => ({ level, label: own?.[level] ?? levelLabel(plan, level) }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).map(({ level, label }) => ({ level, label, pool: pool(prim.filter(r => at(r) === level)) })) }; });
  const egger = prim.length ? [
    { test: 'Multilevel Egger, SE without the effect-size term: sqrt(2(1 - r)/n)', ...slopeTest(prim, r => r.sei_mod) },
    { test: 'Multilevel Egger, SE = sqrt(vi)', ...slopeTest(prim, r => Math.sqrt(r.vi)) }].map(e => withReads(e, prim)) : [];
  const { pa, act, matched, sm, am, rr } = ds;
  const ratio = withReads({ ...jointRatio(sm, am, { minTrials }), participants_sham: participants(sm), participants_active: participants(am), raw_trials: rr.length,
    raw_median: rr.length ? quantile7(rr.map(r => r.ratio), 0.5) : null, raw_q1: rr.length ? quantile7(rr.map(r => r.ratio), 0.25) : null, raw_q3: rr.length ? quantile7(rr.map(r => r.ratio), 0.75) : null }, pairReads(matched));
  const { stacked } = ds;
  const active = lazy({ trial: pool(act, { keepFit: true }), shamBoth: pool(sm), activeBoth: pool(am), ratio, rows: act, pairs: pa, stacked }, 'class', () => pool(act, { struct: 'class' }));
  const { smdRows } = ds;
  const smd = lazy({ trial: pool(smdRows, { keepFit: true }), rows: smdRows }, 'class', () => pool(smdRows, { struct: 'class' }));
  // the between-arm SMD reads every arm of its outcome at the end of the blinded phase, not only the sham arm its row names
  withReads(smd.trial, smdRows.map(r => ({ trial: r.trial, outcome_slot: r.outcome_slot })));
  const { rsp, rsw } = ds;
  const respClasses = sortC(uniq(rsp.map(r => r[by])));
  // the responder sensitivity sets (a GLMM each, most of the responders' cost) are fitted when read: the Syntheses list does not show them
  const respondersOf = () => lazy({ pool: respPool(rsp), rows: rsp, withdrawalArms: rsw,
    byLevel: respClasses.map(level => { const x = rsp.filter(r => r[by] === level); return { level, pool: trialsOf(x).length >= minTrials ? respPool(x) : withReads({ ...respondersPool([]), k_trials: trialsOf(x).length, k_arms: x.length, participants: x.reduce((s, a) => s + a.responders_n, 0), events: x.reduce((s, a) => s + a.responders_k, 0), est: null }, x) }; }) },
    'sensitivity', () => (plan.responderSensitivity || []).map(d => ({ code: d.code, title: d.title, pool: respPool(rsp.filter(r => matchRow(r, d.where))) })));
  // the benchmark by class and GRADE for the single-group estimate
  const classesAll = sortC(uniq(all.map(r => r[by])));
  const benchmarkOf = () => ['All', ...classesAll].map(g => {
    const x = g === 'All' ? prim : prim.filter(r => r[by] === g), p = pool(x, g === 'All' ? { keepFit: true } : {});
    const r = g === 'All' ? rsp : rsp.filter(a => a[by] === g), rp = trialsOf(r).length >= minTrials ? respPool(r) : null;
    const ra = g === 'All' ? ratio : jointRatio(sm.filter(a => a[by] === g), am.filter(a => a[by] === g), { minTrials });
    return withReads({ level: g, trials_extracted: trialsOf(g === 'All' ? all : all.filter(a => a[by] === g)).length, smcr: p,
      resp_trials: trialsOf(r).length, resp_participants: r.reduce((s, a) => s + a.responders_n, 0), resp_events: r.reduce((s, a) => s + a.responders_k, 0), resp: rp,
      ratio_trials: ra.k_trials, ratio: ra.ratio ?? null, ratio_lo: ra.fieller_lo ?? null, ratio_hi: ra.fieller_hi ?? null },
    [...x, ...r, ...pairReads(g === 'All' ? matched : matched.filter(p => p[by] === g))]);
  });
  const robOf = new Map(all.map(a => [a.trial, a.rob_overall]));
  const gradeOf = () => ['All', ...classesAll].map(g => {
    const x = g === 'All' ? prim : prim.filter(r => r[by] === g);
    if (trialsOf(x).length < minTrials) return null;
    const p = pool(x, g === 'All' ? { keepFit: true } : {}), m = new Map();
    for (const r of x) { const k = `${r.trial}\u0001${r.arm}`; m.set(k, { n: Math.max(m.get(k)?.n ?? -Infinity, r.n), trial: r.trial }); }
    const tot = [...m.values()].reduce((s, a) => s + a.n, 0), high = [...m.values()].filter(a => robOf.get(a.trial) === 'High').reduce((s, a) => s + a.n, 0);
    const pe = trialsOf(x).length >= 10 ? slopeTest(x, r => r.sei_mod)?.p ?? null : null;
    const dRob = high / tot > 0.5, dInc = p.pi_lo < -0.2 && p.pi_hi > 0.2, dImp = (p.ci_lo <= 0 && p.ci_hi >= 0.2) || (p.ci_lo <= -0.2 && p.ci_hi >= 0), dPub = pe != null && pe < 0.10;
    const down = [dRob, dInc, dImp, dPub].filter(Boolean).length, w = b => (b ? 'serious' : 'not serious');
    return { level: g, pool: p, share_high: high / tot, egger_p: pe, risk_of_bias: w(dRob), inconsistency: w(dInc), imprecision: w(dImp), indirectness: 'not serious',
      small_study: pe == null ? 'not assessed (fewer than 10 trials)' : w(dPub), downgrades: down, certainty: ['High', 'Moderate', 'Low', 'Very low'][Math.min(down, 3)] };
  }).filter(Boolean);
  // a scale to be converted has no pool of its own and joins its target's once a crosswalk converts it (W3); one kept for sensitivity has its own
  const sameInstrument = sameInstrumentPools([...prim, ...sets.sens].filter(r => scaleUse(plan.scales, r.instrument) !== 'convert'), x => pool(x), { minTrials });
  // beside them, each converted scale's target pool with the arms its crosswalk converts (lib/instrument-crosswalks.mjs): a sensitivity analysis only
  const converted = convertedPools(plan.conversions, [...prim, ...sets.sens], { effects: x => withEffects(x, { assumedR: plan.assumedR ?? 0.5 }), pool: x => pool(x), minTrials });
  const out = { rows, sets, primary, byLevel, sensitivity, sameInstrument, converted, withdrawal: pool(rw, { keepFit: true }), egger, active, smd, by, plan, poolOf: (x, o) => pool(x, o) };
  lazy(out, 'subgroups', subgroupsOf); lazy(out, 'responders', respondersOf); lazy(out, 'benchmark', benchmarkOf); lazy(out, 'grade', gradeOf);
  // meta-regression with each test's stored permutation p, the bootstrap of the ratio, trial-level associations, serious adverse events, percent improvement
  lazy(out, 'moderators', () => { const md = moderatorsOf(plan, prim, stacked); if (md?.bootstrap) withReads(md.bootstrap, pairReads(matched)); return md; });
  const pem = new Map(); for (const a of all) { const v = pem.get(a.trial) || new Set(); v.add(a.primary_endpoint_met ?? null); pem.set(a.trial, v); }
  lazy(out, 'trialLevel', () => trialAssociations(prim, smdRows, t => [...(pem.get(t) || [])]).map(t => withReads(t, [...prim, ...smdRows.map(r => ({ trial: r.trial, outcome_slot: r.outcome_slot }))])));
  // serious adverse events are counted per arm (an arm's own field, no outcome)
  lazy(out, 'sae', () => { if (!plan.sae?.coding?.length) return null; const r = { rule: plan.sae.rule || '', ...saeRate(plan.sae.coding, sets.shamAll) }; return withReads(r, r.rows.map(c => ({ trial: c.trial, arm: c.arm, armLevel: true }))); });
  lazy(out, 'percent', () => percentImprovement(sham, by));
  lazy(out, 'leaveOneOut', () => sortC(trialsOf(prim)).map(t => ({ trial: t, trialPool: pool(prim.filter(r => r.trial !== t)) })));   // `loo` kept for callers that ask
  return out;
}

// ---- moderators and resampling --------------------------------------------------------------------------------------------------------
/** The data each resampling task reads: its rows, terms and fingerprint (the stored result is used only while it is the same). */
export function resamplingTasks(plan, prim, stacked) {
  const mod = plan.moderators, T = new Map((mod?.terms || []).map(t => [t.code, t])), R = plan.resampling || {}, chunks = name => R.permutations?.[name] || R.permutations?.chunks || [333, 333, 333];
  const cols = terms => ['trial', 'yi', 'vi', ...terms.map(t => t.var)];
  const tasks = [];
  for (const code of mod?.univariable || []) { const t = T.get(code); if (t) tasks.push({ name: code, kind: 'permutation', title: t.title, terms: [t], test: 'all', permute: [code], chunks: chunks(code), fingerprint: fingerprint(prim, cols([t])) }); }
  for (const m of mod?.multivariable || []) {
    const terms = m.terms.map(c => T.get(c)).filter(Boolean), fp = fingerprint(prim, cols(terms));
    tasks.push({ name: `${m.code}_all`, kind: 'permutation', title: m.title, terms, test: 'all', permute: m.terms, chunks: chunks(`${m.code}_all`), fingerprint: fp });
    for (const c of m.terms) tasks.push({ name: `${m.code}_${c}`, kind: 'permutation', title: `${m.title}: ${T.get(c)?.title || c}`, terms, test: c, permute: [c], chunks: chunks(`${m.code}_${c}`), fingerprint: fp });
  }
  if (R.bootstrap && stacked.length) tasks.push({ name: 'ratio_boot', kind: 'bootstrap', title: 'Trial bootstrap of the sham/active ratio', seed: R.bootstrap.seed ?? 20261031, chunks: R.bootstrap.chunks || [333, 333, 333],
    fingerprint: fingerprint(stacked, ['trial', 'yi', 'vi', 'type']) });
  return tasks;
}
function moderatorsOf(plan, prim, stacked) {
  const mod = plan.moderators;
  if (!mod?.terms?.length) return null;
  const T = new Map(mod.terms.map(t => [t.code, t])), stored = plan.resampling?.results || {}, tasks = new Map(resamplingTasks(plan, prim, stacked).map(t => [t.name, t]));
  // a stored result counts while its data are those of the record now
  const perm = name => { const r = stored[name], t = tasks.get(name); return r && t && r.fingerprint === t.fingerprint ? r : r ? { ...r, stale: true } : null; };
  const univariable = (mod.univariable || []).map(code => { const t = T.get(code), m = t ? metaRegression(prim, [t]) : null;
    return withReads({ code, title: t?.title || code, level: t?.level, term: t || null, reg: m, test: m?.tests[0] || null, permutation: perm(code) }, prim); });
  const multivariable = (mod.multivariable || []).map(x => { const terms = x.terms.map(c => T.get(c)).filter(Boolean), m = metaRegression(prim, terms);
    return { code: x.code, title: x.title, reg: m, tests: (m?.tests || []).map(t => withReads({ ...t, title: t.term === 'all' ? 'All terms' : T.get(t.term)?.title || t.term, permutation: perm(`${x.code}_${t.term}`) }, prim)) }; });
  const boot = perm('ratio_boot');
  return { univariable, multivariable, bootstrap: boot, tasks: [...tasks.values()] };
}
