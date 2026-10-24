// The synthesis explorer's engine (plan §4.15g): every sensible comparison and grouping of a review's arms, crossed with every outcome, judged
// for whether it can be synthesised and why not. Pure: the arms and the definitions come in, one record per combination goes out; nothing here
// reads the project (lib/synth-project.mjs builds the arms) or draws (lib/synth-figures.mjs).
//
// An arm: { sid, study, role: 'I'|'C', label, facets: { facet: level }, n, fu, counts: { component: count|null }, overlap?: group }
//   counts hold a number where the study reports one, null where it does not; a count reported only as a bound ("at most 9") is null here,
//   kept as text on the study and never used as a number.
// An outcome: { id, name, rule: 'max'|'sum'|'reported', parts: [component id | outcome], partial?: false }
//   max: the larger component (overlap not reported); sum: the sum, never above the arm's n; reported: the one component. An outcome is
//   `partial` in an arm when a part is missing there (unless `partial: false`); an outcome with no part reported is not reported.
// A comparison: { code, title, studies: [sid], mix?: text, a?: spec, b?: spec }   (a and b pick each study's arms by facets; else role I against C)
// A grouping: { code, title, subgroups: [{ name, where: spec }], overlap?: bool }
// A spec: { facets?: { facet: [levels] }, role?, all?: [spec], any?: [spec], not?: spec }
//
// Verdicts and their thresholds are SETTINGS (below); the defaults are those of the review of 20 October 2026 that this engine reproduces
// (app/test/synth.test.mjs against its 148 recorded combinations).
import { poolRr, poolProportion, subgroupQ, signP, fmtP, fixed } from './synth-stats.mjs';
import { poolProportion as poolMeta } from './meta-pool.mjs';

export const SETTINGS = Object.freeze({
  usableStudies: 3,          // comparative: estimable studies for "Usable"
  exploratoryStudies: 2,     // comparative: estimable studies for "Exploratory only"
  usableDirections: 3,       // SWiM: studies with a direction for "Usable"
  usableArms: 5,             // one subgroup: arms for "Usable"
  caveatArms: 3,             // one subgroup: arms for "Usable with caveat"
  subgroupArms: 3,           // several subgroups: arms each needs
  i2Flag: 75,                // heterogeneity worth flagging, percent
  followupRatio: 3,          // longest over shortest follow-up worth flagging
  signAttainable: 6,         // studies below which a sign test cannot reach P < 0.05
  signExcludeCritical: false, // SWiM sheets: leave studies at critical overall risk of bias out of the sign test
  proportionModel: 'ft',     // pooled proportions: 'ft' Freeman–Tukey, REML; 'logit' logit, REML, multilevel where a study gives two arms (as Analysis fits it)
});
export const PROPORTION_MODELS = [['ft', 'Freeman–Tukey, REML'], ['logit', 'Logit, REML, multilevel']];

/** A pool of arms on the logit scale (lib/meta-pool.mjs, checked against metafor), in the shape of synth-stats' Freeman–Tukey pool. */
function poolLogit(rows) {
  if (rows.length < 2) return null;
  const r = poolMeta(rows.map(x => ({ events: x.e, n: x.n, study: x.sid })), { method: 'REML', transform: 'PLO' });
  return r && { p: 100 * r.estimate, lo: 100 * r.lo, hi: 100 * r.hi, I2: r.i2, k: r.k, mu: r.logit, se: r.logit_se, tau2: r.tau2, Q: r.q, df: r.k - 1, weights: r.weights, dependence: r.dependence };
}
export const VERDICTS = ['Usable', 'Usable with caveat', 'Usable, descriptive', 'Exploratory only', 'Text only', 'Not usable'];

// ---- specs ----------------------------------------------------------------------------------------------------------------------
/** Whether an arm satisfies a spec. An empty spec is every arm. */
export function matches(arm, spec) {
  if (!spec) return true;
  if (spec.role && arm.role !== spec.role) return false;
  for (const [f, levels] of Object.entries(spec.facets || {})) if (!levels.includes(arm.facets?.[f])) return false;
  if (spec.all && !spec.all.every(s => matches(arm, s))) return false;
  if (spec.any && !spec.any.some(s => matches(arm, s))) return false;
  if (spec.not && matches(arm, spec.not)) return false;
  return true;
}

// ---- outcomes -------------------------------------------------------------------------------------------------------------------
/** An outcome in an arm: { value, partial } or null when none of its parts is reported. */
export function outcomeIn(arm, node) {
  const kids = node.parts.map(p => (typeof p === 'string' ? (Number.isInteger(arm.counts?.[p]) ? { value: arm.counts[p], n: arm.ns?.[p] } : null) : outcomeIn(arm, p)));
  const got = kids.filter(Boolean);
  if (!got.length) return null;
  const vals = got.map(k => k.value);
  const value = node.rule === 'sum' ? Math.min(vals.reduce((s, x) => s + x, 0), arm.n) : node.rule === 'reported' ? vals[0] : Math.max(...vals);
  const n = node.rule === 'reported' && got[0].n > 0 ? got[0].n : arm.n;   // a one-part outcome has the denominator its own count came with
  return { value, n, partial: node.partial !== false && (got.length < kids.length) };
}

// ---- comparisons ----------------------------------------------------------------------------------------------------------------
const armsOf = (arms, sid) => arms.filter(a => a.sid === sid);
/** The arm pair of a study for a comparison: [intervention, comparator], or null when it does not have both. */
export function pairOf(arms, sid, def) {
  const mine = armsOf(arms, sid);
  const i = def.a ? mine.find(a => matches(a, def.a)) : mine.find(a => a.role === 'I');
  const c = def.b ? mine.find(a => matches(a, def.b) && a !== i) : mine.find(a => a.role === 'C');
  return i && c ? [i, c] : null;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const names = (rows, pick) => rows.filter(pick).map(r => r.study).join(', ');

/** One comparison on one outcome, by meta-analysis and by SWiM: [meta-analysis record, SWiM record]. */
export function evaluateComparison(def, arms, outcome, settings = SETTINGS) {
  const rows = [], notReported = [];
  for (const sid of def.studies) {
    const pair = pairOf(arms, sid, def);
    if (!pair) { notReported.push(armsOf(arms, sid)[0]?.study || String(sid)); continue; }
    const [i, c] = pair, oi = outcomeIn(i, outcome), oc = outcomeIn(c, outcome);
    if (!oi || !oc) { notReported.push(i.study); continue; }
    rows.push({ study: i.study, sid, e1: oi.value, n1: oi.n, e2: oc.value, n2: oc.n, partial: oi.partial || oc.partial, fu1: i.fu, fu2: c.fu, arm1: i.label, arm2: c.label });
  }
  const est = rows.filter(r => r.e1 + r.e2 > 0);
  const fav = est.filter(r => r.e1 / r.n1 < r.e2 / r.n2).length, unf = est.filter(r => r.e1 / r.n1 > r.e2 / r.n2).length, kDir = fav + unf;
  const base = { family: 'Comparative', code: def.code, grouping: def.title, outcome: outcome.name, outcomeId: outcome.id, studies: def.studies,
    names: def.studies.map(s => armsOf(arms, s)[0]?.study || String(s)), rows, notReported, kTotal: def.studies.length, kBoth: rows.length, kEst: est.length,
    patients: rows.reduce((s, r) => s + r.n1 + r.n2, 0), mix: def.mix || '',
    events: rows.length ? `${sum(rows, 'e1')}/${sum(rows, 'n1')} vs ${sum(rows, 'e2')}/${sum(rows, 'n2')}` : '' };
  const issues = [];
  if (def.mix) issues.push(def.mix);
  if (rows.some(r => r.partial)) issues.push(`Composite built from partly reported components in ${names(rows, r => r.partial)}`);
  if (notReported.length) issues.push(`Not reported in both arms: ${notReported.join(', ')}`);
  const fus = rows.flatMap(r => [r.fu1, r.fu2]).filter(x => x > 0);
  if (fus.length && Math.max(...fus) / Math.min(...fus) >= settings.followupRatio) issues.push(`Follow-up ranges ${Math.min(...fus)}–${Math.max(...fus)} months; risk ratios are not time-adjusted`);

  const pool = poolRr(est);
  let v, why;
  if (est.length >= settings.usableStudies && !def.mix) [v, why] = ['Usable', 'Three or more estimable studies, one contrast'];
  else if (est.length >= settings.usableStudies) [v, why] = ['Usable with caveat', 'Three or more estimable studies, but different interventions pooled'];
  else if (est.length >= settings.exploratoryStudies) [v, why] = ['Exploratory only', 'Two estimable studies: tau² and the random-effects CI are unreliable'];
  else [v, why] = ['Not usable', `${est.length} estimable ${plural(est.length, 'study', 'studies')}; nothing to pool`];
  const meta = { ...base, method: 'Meta-analysis (RR, IV random effects, REML)', verdict: v, reason: why, issues: [...issues], pool,
    result: pool ? `RR ${pool.rr.toFixed(2)} (${pool.lo.toFixed(2)}–${pool.hi.toFixed(2)}); I² ${pool.I2.toFixed(0)}%; ${fmtP(pool.p)}` : '' };
  if (pool && pool.I2 > settings.i2Flag) meta.issues.push(`Heterogeneity: I² ${pool.I2.toFixed(0)}%`);

  const sp = kDir ? signP(fav, kDir) : null;
  if (kDir >= settings.usableDirections) [v, why] = ['Usable', `${kDir} studies give a direction; smallest attainable sign-test P = ${fixed(2 / 2 ** kDir, 2)}`];
  else if (kDir === 2) [v, why] = ['Usable, descriptive', 'Two studies give a direction; sign test cannot be below P = 0.50'];
  else if (kDir === 1) [v, why] = ['Text only', 'One study gives a direction'];
  else [v, why] = ['Not usable', 'No study reports the outcome in both arms'];
  if (def.mix && v === 'Usable') v = 'Usable with caveat';
  const swim = { ...base, method: 'SWiM (effect direction, sign test)', verdict: v, reason: why, issues: [...issues], fav, unf, signP: sp,
    result: kDir ? `${fav}/${kDir} favor the intervention; sign test ${fmtP(sp)}` : '' };
  if (kDir && kDir < settings.signAttainable) swim.issues.push(`A sign test cannot reach P < 0.05 with fewer than ${settings.signAttainable} studies`);
  return [meta, swim];
}
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

// ---- groupings ------------------------------------------------------------------------------------------------------------------
/**
 * The arms a grouping pools: those that are not left out for overlap. `overlapKeep` maps an overlap group to the study kept (the study with the most patients
 * when none is named); every other study of the group is left out of arm-level pooling.
 */
export function pooledArms(arms, overlapKeep = {}) {
  const total = new Map();
  for (const a of arms) if (a.overlap) { const k = `${a.overlap}|${a.sid}`; total.set(k, (total.get(k) || 0) + a.n); }
  const keep = { ...overlapKeep };
  for (const a of arms) if (a.overlap && keep[a.overlap] == null) {
    const best = [...total].filter(([k]) => k.startsWith(`${a.overlap}|`)).sort((x, y) => y[1] - x[1])[0][0];
    keep[a.overlap] = best.slice(a.overlap.length + 1);
  }
  const dropped = arms.filter(a => a.overlap && String(keep[a.overlap]) !== String(a.sid));
  return { kept: arms.filter(a => !dropped.includes(a)), dropped };
}

/** One grouping on one outcome: the pooled proportion of every subgroup and a test for the subgroup difference. */
export function evaluateGrouping(def, arms, outcome, settings = SETTINGS, overlapKeep = {}) {
  const { kept, dropped } = pooledArms(arms, overlapKeep);
  const subs = def.subgroups.map(s => {
    const mine = kept.filter(a => matches(a, s.where)), rep = mine.map(a => [a, outcomeIn(a, outcome)]), got = rep.filter(([, o]) => o);
    return { name: s.name, arms: mine.map(a => a.study + (a.role === 'I' ? '' : ' (comparator)')), notReported: rep.filter(([, o]) => !o).map(([a]) => a.study),
      rows: got.map(([a, o]) => ({ study: a.study, sid: a.sid, label: a.label, role: a.role, e: o.value, n: o.n, fu: a.fu, partial: o.partial })),
      kTotal: mine.length, kRep: got.length, pool: (settings.proportionModel === 'logit' ? poolLogit : poolProportion)(got.map(([a, o]) => ({ e: o.value, n: o.n, sid: a.sid }))) };
  });
  const ks = subs.map(s => s.kRep), issues = [];
  const hiI2 = subs.filter(s => s.pool && s.pool.I2 > settings.i2Flag).map(s => s.name);
  if (hiI2.length) issues.push(`I² above ${settings.i2Flag}% in: ${hiI2.join(', ')}`);
  const part = [...new Set(subs.flatMap(s => s.rows.filter(r => r.partial).map(r => r.study)))].sort();
  if (part.length) issues.push(`Composite from partly reported components: ${part.join(', ')}`);
  const left = [...new Set(dropped.filter(a => def.subgroups.some(s => matches(a, s.where))).map(a => a.study))];
  if (left.length) issues.push(`${left.join(', ')} left out (patients overlap with ${[...new Set(kept.filter(a => a.overlap).map(a => a.study))].join(', ')})`);
  const fus = subs.flatMap(s => s.rows.map(r => r.fu)).filter(x => x > 0);
  if (fus.length && Math.max(...fus) / Math.min(...fus) >= settings.followupRatio) issues.push(`Follow-up ranges ${Math.round(Math.min(...fus))}–${Math.round(Math.max(...fus))} months; proportions are not time-adjusted`);
  let result = subs.map(s => (s.pool ? `${s.name} ${s.pool.p.toFixed(1)}% (${s.pool.lo.toFixed(1)}–${s.pool.hi.toFixed(1)}; k = ${s.pool.k})` : `${s.name} k = ${s.kRep}`)).join('; ');
  const sq = subs.length > 1 ? subgroupQ(subs.map(s => s.pool)) : null;
  let v, why, method;
  if (subs.length === 1) {
    const k = ks[0];
    [v, why] = k >= settings.usableArms ? ['Usable', `${k} arms report the outcome`] : k >= settings.caveatArms ? ['Usable with caveat', `Only ${k} arms`] : ['Not usable', `${k} arm(s)`];
    method = settings.proportionModel === 'logit' ? 'Pooled proportion (logit, REML, multilevel)' : 'Pooled proportion (Freeman–Tukey, REML)';
  } else {
    const small = subs.filter(s => s.kRep < settings.subgroupArms).map(s => s.name), enough = subs.filter(s => s.kRep >= settings.subgroupArms).length;
    if (!small.length) [v, why] = ['Usable', 'Every subgroup has three or more arms'];
    else if (small.length < subs.length && enough >= 2) [v, why] = ['Usable with caveat', `Fewer than three arms in: ${small.join(', ')}`];
    else if (subs.filter(s => s.kRep >= 2).length >= 2) [v, why] = ['Exploratory only', `Fewer than three arms in: ${small.join(', ')}`];
    else [v, why] = ['Not usable', 'Fewer than two subgroups with two or more arms'];
    method = 'Pooled proportion by subgroup + test for subgroup differences';
    if (sq) result += `; subgroup difference ${fmtP(sq.p)}`;
  }
  if (!def.comparatorsOnly) issues.push('Single-arm proportions compare across studies, not within them (no randomization or matching)');
  return { family: 'Proportions', code: def.code, grouping: def.title, outcome: outcome.name, outcomeId: outcome.id, method, subgroups: subs, verdict: v, reason: why, issues, result,
    subgroupTest: sq, kTotal: sum(subs, 'kTotal'), kBoth: ks.reduce((s, x) => s + x, 0), patients: subs.reduce((s, x) => s + sum(x.rows, 'n'), 0),
    events: subs.map(s => `${sum(s.rows, 'e')}/${sum(s.rows, 'n')}`).join(', ') };
}

/** Every combination: each comparison and each grouping on each outcome. */
export function evaluateAll({ arms, outcomes, comparisons = [], groupings = [], settings = SETTINGS, overlapKeep = {} }) {
  const out = [];
  for (const def of comparisons) for (const o of outcomes) out.push(...evaluateComparison(def, arms, o, settings));
  for (const def of groupings) for (const o of outcomes) out.push(evaluateGrouping(def, arms, o, settings, overlapKeep));
  return out;
}
export const verdictCounts = records => Object.fromEntries(VERDICTS.map(v => [v, records.filter(r => r.verdict === v).length]));
