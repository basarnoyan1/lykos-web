// The "Change" family of Syntheses (plan §4.15g): within-arm standardized mean changes (SMCR, baseline SD, Hedges-corrected, improvement
// positive) of a review's arms, pooled with outcomes nested in trials (lib/meta-multilevel.mjs) and inferred with CR2 cluster-robust
// standard errors on Satterthwaite df (lib/meta-cr2.mjs); prediction intervals from the CR2 SE, the summed variance components and the same
// df. A port of the sham-response review's 04-analysis.R (1 Nov 2026) so its syntheses are Lykos's own: the primary pool and its protocol
// structure (outcomes in trials in classes, clustered by class), subgroups, sensitivity sets (data selections and correlation choices),
// randomized-withdrawal phases, the active arms and the sham/active ratio (joint model, Fieller), the between-arm SMD, responders (GLMM,
// lib/meta-glmm.mjs), the multilevel Egger tests, the benchmark by class and GRADE for a single-group estimate. The rows come from
// lib/change-rows.mjs; the plan (what is pooled, the sensitivity sets, the subgroups) is `s.synthesis.change` (CHANGE_PLAN_KEYS).
// Resampling (permutation tests, the trial bootstrap) is not run here. Pure; app/test/change-synthesis.test.mjs checks it with fixed numbers.
import { escalcRow } from './meta-escalc.mjs';
import { fitMultilevel, predictMean, lrt, invSPD } from './meta-multilevel.mjs';
import { cr2Parts, cr2Table, cr2Coef } from './meta-cr2.mjs';
import { model as rmaModel, qt975 } from './meta-general.mjs';
import { poolGlmm } from './meta-glmm.mjs';
import { changeRows } from './change-rows.mjs';

/** The plan's keys: { rows, assumedR, minTrials, roles: { sham, active }, by, withdrawal, sensitivity: [{ code, title, where?, effect?, add? }], subgroups: [{ by, title }], codes } */
export const CHANGE_PLAN_KEYS = ['rows', 'assumedR', 'minTrials', 'by', 'sensitivity', 'subgroups', 'titles'];

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

/** The sets a plan pools: { all, sham, prim, sec, rw }, every arm with its effects. */
export function changeSets(rows, { assumedR = 0.5 } = {}) {
  const all = withEffects(rows.arms, { assumedR }), shamAll = all.filter(a => a.arm_role === 'sham');
  const sham = shamAll.filter(a => !a.overlap_secondary);
  return { all, shamAll, sham, secondaryTrials: uniq(all.filter(a => a.overlap_secondary).map(a => a.trial)),
    sec: shamAll.filter(a => a.overlap_secondary && a.yi != null && a.design !== WITHDRAWAL), prim: sham.filter(a => a.yi != null && a.design !== WITHDRAWAL),
    rw: sham.filter(a => a.yi != null && a.design === WITHDRAWAL) };
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

/** The review's whole synthesis from its rows and plan (s.synthesis.change): every pooled estimate, ready for records, tables and the report. */
export function changeSynthesis(s, plan = s?.synthesis?.change || {}, { rows = changeRows(s, plan.rows || {}), loo = false } = {}) {
  const minTrials = plan.minTrials ?? 3, by = plan.by || 'indication_class', sets = changeSets(rows, { assumedR: plan.assumedR ?? 0.5 });
  const { prim, rw, sham, all } = sets, memo = new Map();
  // one fit per set of rows and options: the benchmark, GRADE and the subgroups ask for the same pools
  const pool = (x, o = {}) => {
    const k = x.every(r => r.ix != null) ? `${o.y || 'yi'}|${o.v || 'vi'}|${o.struct || 'trial'}|${o.keepFit ? 1 : 0}|${x.map(r => r.ix).join(',')}` : null;
    if (k && memo.has(k)) return memo.get(k);
    const r = robustPool(x, { minTrials, ...o }); if (k) memo.set(k, r); return r;
  };
  const respPool = x => { const k = `resp|${x.map(r => r.ix).join(',')}`; if (!memo.has(k)) memo.set(k, respondersPool(x)); return memo.get(k); };
  // the primary pool, its protocol structure (a class level) and the test between them
  // a plan whose patterns pool nothing has no model to fit (its pools then say so: fewer than minTrials)
  const fT = prim.length && fitMultilevel({ yi: prim.map(r => r.yi), vi: prim.map(r => r.vi), levels: [prim.map(r => r.trial), prim.map((_, i) => i)] });
  const fC = prim.length && fitMultilevel({ yi: prim.map(r => r.yi), vi: prim.map(r => r.vi), levels: [prim.map(r => r[by]), prim.map(r => r.trial), prim.map((_, i) => i)] });
  const perClass = new Map(); for (const r of prim) { const m = perClass.get(r[by]) || new Set(); m.add(r.trial); perClass.set(r[by], m); }
  const structure = fT && fC ? { classes: perClass.size, classes_with_2plus_trials: [...perClass.values()].filter(x => x.size >= 2).length, sigma2_class: fC.sigma2[0], ...lrt(fC, fT) } : null;
  const primary = lazy({ trial: pool(prim, { keepFit: true }), aggregated: prim.length ? aggregatedPool(prim) : null, structure }, 'class', () => pool(prim, { struct: 'class' }));
  const levels = sortC(uniq(prim.map(r => r[by])));
  const byLevel = levels.map(level => ({ level, pool: pool(prim.filter(r => r[by] === level)) }));
  const sensitivity = (plan.sensitivity || []).map(def => {
    const { rows: x, y, v } = sensitivityRows(def, sets, rows);
    return lazy({ code: def.code, title: def.title, trial: pool(x, { y, v }), rows: x.length }, 'class', () => pool(x, { y, v, struct: 'class' }));
  });
  const subgroupsOf = () => (plan.subgroups || []).map(g => ({ by: g.by, title: g.title, levels: sortC(uniq(prim.map(r => r[g.by]))).map(level => ({ level, pool: pool(prim.filter(r => r[g.by] === level)) })) }));
  const egger = prim.length ? [
    { test: 'Multilevel Egger, SE without the effect-size term: sqrt(2(1 - r)/n)', ...slopeTest(prim, r => r.sei_mod) },
    { test: 'Multilevel Egger, SE = sqrt(vi)', ...slopeTest(prim, r => Math.sqrt(r.vi)) }] : [];
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
  const ratio = { ...jointRatio(sm, am, { minTrials }), participants_sham: participants(sm), participants_active: participants(am), raw_trials: rr.length,
    raw_median: rr.length ? quantile7(rr.map(r => r.ratio), 0.5) : null, raw_q1: rr.length ? quantile7(rr.map(r => r.ratio), 0.25) : null, raw_q3: rr.length ? quantile7(rr.map(r => r.ratio), 0.75) : null };
  const active = lazy({ trial: pool(act, { keepFit: true }), shamBoth: pool(sm), activeBoth: pool(am), ratio, rows: act, pairs: pa }, 'class', () => pool(act, { struct: 'class' }));
  // between-arm SMD at the end of the blinded phase, parallel and delayed-activation designs (positive favours active)
  const ps = rows.pairs.filter(p => !secT.has(p.trial) && p.design === 'parallel' && [p.sham_end_mean, p.sham_end_sd, p.active_end_mean, p.active_end_sd, p.dir].every(x => x != null) && p.sham_n > 1 && p.active_end_n > 1);
  const smdRows = ps.map(p => { const e = escalcRow('SMD', [p.active_end_mean, p.active_end_sd, p.active_end_n, p.sham_end_mean, p.sham_end_sd, p.sham_n]);
    return { trial: p.trial, outcome_slot: p.outcome_slot, arm: p.sham_arm, n: p.sham_n + p.active_end_n, indication_class: p.indication_class, yi: e.yi * p.dir, vi: e.vi }; });
  const smd = lazy({ trial: pool(smdRows, { keepFit: true }), rows: smdRows }, 'class', () => pool(smdRows, { struct: 'class' }));
  // responders: one outcome per sham arm (the first slot with k/n), randomized withdrawal apart
  const rs = firstPer(sham.filter(a => a.responders_k != null && a.responders_n > 0).sort(byTrialArmSlot), r => `${r.trial}|${r.arm}`);
  const rsp = rs.filter(a => a.design !== WITHDRAWAL), rsw = rs.filter(a => a.design === WITHDRAWAL);
  const respClasses = sortC(uniq(rsp.map(r => r[by])));
  const respondersOf = () => ({ pool: respPool(rsp), rows: rsp, withdrawalArms: rsw,
    byLevel: respClasses.map(level => { const x = rsp.filter(r => r[by] === level); return { level, pool: trialsOf(x).length >= minTrials ? respPool(x) : { ...respondersPool([]), k_trials: trialsOf(x).length, k_arms: x.length, participants: x.reduce((s, a) => s + a.responders_n, 0), events: x.reduce((s, a) => s + a.responders_k, 0), est: null } }; }),
    sensitivity: (plan.responderSensitivity || []).map(d => ({ code: d.code, title: d.title, pool: respPool(rsp.filter(r => matchRow(r, d.where))) })) });
  // the benchmark by class and GRADE for the single-group estimate
  const classesAll = sortC(uniq(all.map(r => r[by])));
  const benchmarkOf = () => ['All', ...classesAll].map(g => {
    const x = g === 'All' ? prim : prim.filter(r => r[by] === g), p = pool(x, g === 'All' ? { keepFit: true } : {});
    const r = g === 'All' ? rsp : rsp.filter(a => a[by] === g), rp = trialsOf(r).length >= minTrials ? respPool(r) : null;
    const ra = g === 'All' ? ratio : jointRatio(sm.filter(a => a[by] === g), am.filter(a => a[by] === g), { minTrials });
    return { level: g, trials_extracted: trialsOf(g === 'All' ? all : all.filter(a => a[by] === g)).length, smcr: p,
      resp_trials: trialsOf(r).length, resp_participants: r.reduce((s, a) => s + a.responders_n, 0), resp_events: r.reduce((s, a) => s + a.responders_k, 0), resp: rp,
      ratio_trials: ra.k_trials, ratio: ra.ratio ?? null, ratio_lo: ra.fieller_lo ?? null, ratio_hi: ra.fieller_hi ?? null };
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
  const out = { rows, sets, primary, byLevel, sensitivity, withdrawal: pool(rw, { keepFit: true }), egger, active, smd, by, plan, poolOf: (x, o) => pool(x, o) };
  lazy(out, 'subgroups', subgroupsOf); lazy(out, 'responders', respondersOf); lazy(out, 'benchmark', benchmarkOf); lazy(out, 'grade', gradeOf);
  if (loo) out.leaveOneOut = sortC(trialsOf(prim)).map(t => ({ trial: t, trialPool: pool(prim.filter(r => r.trial !== t)) }));
  return out;
}
