// Screening validation from THIS project's own sample (plan §6, §1.3).
//
// What is measured here is only what the person has screened against the
// model's proposals in this project. No figure from the literature is shown as
// if it applied, and nothing about a real model's accuracy is claimed before a
// person has run a sample: with no labelled pairs every figure is null.
//
// Why more than kappa: inclusion is 1-12% at some stages, and Cohen's kappa
// collapses when one category is rare even at high agreement. So the report
// carries the confusion table and the figures each read from it. The headline
// is LOST EVIDENCE, the share of relevant records the model proposed to
// exclude (a person would not have seen them), with a Wilson 95% interval.
// The stopping check is a random sample of the model-excluded records screened
// by a person: x relevant found among n sampled estimates the share relevant
// among all model-excluded records, with a Wilson 95% interval, and that share
// times the pool is the implied number of relevant records the exclusion hides.
//
// The pairs: a record with a model proposal (state.proposals[stage][id].verdict)
// and a person's final decision (state.screening for 'ta', state.fulltext for
// 'ft'; under dual screening that is the consensus or the resolved conflict).
// Decisions marked needsCriteriaReview are ignored: they predate the criteria
// now in force. A person's "uncertain" is not a final call: it stays in the
// list but is left out of the two-by-two table and counted apart.
//
// CHOICE, documented: the model's "uncertain" is read as "include" (a
// conservative screen: a record it is unsure of goes to a person), and the
// alternative reading, "uncertain" as "exclude", is reported beside it.
//
// Table cells: tp = model include, person include; fp = model include, person
// exclude; fn = model exclude, person include; tn = model exclude, person
// exclude; n = tp+fp+fn+tn. Every ratio with a zero denominator is null, never NaN.
//   recall (sensitivity) = tp / (tp+fn)
//   specificity          = tn / (tn+fp)
//   precision            = tp / (tp+fp)
//   accuracy             = (tp+tn) / n
//   F1                   = 2tp / (2tp+fp+fn)
//   prevalence           = (tp+fn) / n              (the person's include rate)
//   MCC                  = (tp*tn - fp*fn) / sqrt((tp+fp)(tp+fn)(tn+fp)(tn+fn))
//   Cohen's kappa        = (po - pe) / (1 - pe), po = accuracy,
//                          pe = ((tp+fp)(tp+fn) + (fn+tn)(fp+tn)) / n^2
//   Gwet's AC1 (2 cat.)  = (po - pe) / (1 - pe), pe = 2*q*(1-q),
//                          q = ((tp+fp) + (tp+fn)) / (2n)  (mean include rate of the two raters)
//   lostEvidence         = fn / (tp+fn) = 1 - recall, Wilson 95% interval
// The Wilson interval is the one in screen-rank.mjs (not written twice).
import { update } from '../store.mjs';
import { wilson } from './screen-rank.mjs';
import { drawSample } from './screen-assign.mjs';
import { stageOf } from './screen.mjs';

export const VERDICTS = ['include', 'exclude', 'uncertain'];
const div = (a, b) => b ? a / b : null;
const num = x => Number.isFinite(x) ? x : null;
const ci = (x, n) => n ? wilson(x, n) : null;
const decisionOf = (state, stage, id) => state[stageOf(stage).key]?.[id] || null;
const settled = d => d && VERDICTS.includes(d.decision) && !d.needsCriteriaReview;

/** The labelled sample: [{ id, model, person }] for records with a model verdict and a person's decision. */
export function screeningPairs(state, stage = 'ta') {
  const out = [];
  for (const [id, p] of Object.entries(state.proposals?.[stage] || {})) {
    if (!p || !VERDICTS.includes(p.verdict)) continue;
    const d = decisionOf(state, stage, id);
    if (settled(d)) out.push({ id, model: p.verdict, person: d.decision });
  }
  return out;
}

/** The two-by-two table; `uncertain` says how the model's "uncertain" is read ('include' by default). */
export function confusion(pairs, { uncertain = 'include' } = {}) {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0, n: 0, modelUncertain: 0, personUncertain: 0, uncertainAs: uncertain === 'exclude' ? 'exclude' : 'include' };
  for (const p of pairs) {
    if (p.person === 'uncertain') { c.personUncertain++; continue; }
    const m = p.model === 'uncertain' ? c.uncertainAs : p.model;
    if (p.model === 'uncertain') c.modelUncertain++;
    const rel = p.person === 'include';
    if (m === 'include') rel ? c.tp++ : c.fp++; else rel ? c.fn++ : c.tn++;
  }
  c.n = c.tp + c.fp + c.fn + c.tn;
  return c;
}

/** Every figure from a table, with the formulas at the top of this file. */
export function metrics(c) {
  const { tp, fp, fn, tn, n } = c;
  const po = div(tp + tn, n);
  const pe = n ? ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n) : null;
  const q = n ? ((tp + fp) + (tp + fn)) / (2 * n) : null;
  const pg = q == null ? null : 2 * q * (1 - q);
  const mccDen = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  const rel = tp + fn;
  return {
    n, relevant: rel,
    recall: div(tp, rel), recallCi: ci(tp, rel),
    specificity: div(tn, tn + fp), precision: div(tp, tp + fp),
    accuracy: po, f1: div(2 * tp, 2 * tp + fp + fn), prevalence: div(rel, n),
    mcc: mccDen ? num((tp * tn - fp * fn) / mccDen) : null,
    kappa: po == null || pe === 1 ? null : num((po - pe) / (1 - pe)),
    ac1: po == null || pg === 1 ? null : num((po - pg) / (1 - pg)),
  };
}

/** Lost evidence: relevant records the model proposed to exclude, of all relevant, with a Wilson 95% interval. */
export function lostEvidence(c) {
  const rel = c.tp + c.fn;
  return { lost: c.fn, relevant: rel, share: div(c.fn, rel), ci: ci(c.fn, rel) };
}

// ---- the random recall check ------------------------------------------------
// Sampled from records the model proposed to exclude and no person has
// decided (or whose decision is superseded by a criteria change). Kept in
// state.aiValidation.screening[stage].recallCheck, not as an assignment batch,
// so it never narrows anyone's queue and never disturbs the Stopping estimate.
/** The ids a check could draw from: proposed exclude, no settled person decision. */
export function excludedPool(state, stage = 'ta') {
  return Object.entries(state.proposals?.[stage] || {})
    .filter(([id, p]) => p?.verdict === 'exclude' && !settled(decisionOf(state, stage, id)) && (state.papers || []).some(r => r.id === id))
    .map(([id]) => id);
}

/** A seeded draw of n from the pool; the same seed gives the same sample. */
export function recallCheck(state, stage = 'ta', { n = 50, seed = 1 } = {}) {
  const pool = excludedPool(state, stage);
  return { stage, n: Math.min(n, pool.length), seed, pool: pool.length, ids: drawSample(pool, n, { seed }), at: new Date().toISOString() };
}

/**
 * Once the person has screened the sample: x relevant of n sampled estimates
 * the share relevant among the model-excluded records (Wilson 95%), and that
 * share times the pool is the implied number of relevant records among them.
 * An estimate that holds only if the sample was screened like any record.
 */
export function recallEstimate(state, stage = 'ta') {
  const chk = state.aiValidation?.screening?.[stage]?.recallCheck;
  if (!chk?.ids?.length) return null;
  const ds = chk.ids.map(id => decisionOf(state, stage, id)).filter(d => settled(d) && d.decision !== 'uncertain');
  const left = chk.ids.length - ds.length;
  const n = ds.length, x = ds.filter(d => d.decision === 'include').length;
  if (left || !n) return { n, x, left, pool: chk.pool, share: null, ci: null, implied: null, impliedCi: null };
  const [lo, hi] = wilson(x, n);
  return { n, x, left: 0, pool: chk.pool, share: x / n, ci: [lo, hi], implied: chk.pool * x / n, impliedCi: [chk.pool * lo, chk.pool * hi] };
}

/** Everything the report shows, from the project as it is. */
export function validationReport(state, stage = 'ta') {
  const pairs = screeningPairs(state, stage);
  const cons = confusion(pairs), alt = confusion(pairs, { uncertain: 'exclude' });
  const props = state.proposals?.[stage] || {};
  const tally = {}; for (const p of pairs) { const m = props[p.id]?.model; if (m) tally[m] = (tally[m] || 0) + 1; }
  const model = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  return { stage, n: pairs.length, confusion: cons, metrics: metrics(cons), lostEvidence: lostEvidence(cons),
    alternative: { confusion: alt, metrics: metrics(alt), lostEvidence: lostEvidence(alt) },
    recallCheck: state.aiValidation?.screening?.[stage]?.recallCheck ? { ...state.aiValidation.screening[stage].recallCheck, estimate: recallEstimate(state, stage) } : null,
    model };
}

/** Writes the report into state.aiValidation.screening[stage] (read by the AI-use record). */
export function storeValidation(stage = 'ta') {
  update(s => {
    const r = validationReport(s, stage);
    const v = s.aiValidation && typeof s.aiValidation === 'object' ? s.aiValidation : (s.aiValidation = {});
    v.screening ||= {};
    const prior = v.screening[stage] || {};
    v.screening[stage] = { at: new Date().toISOString(), n: r.n, confusion: r.confusion, metrics: r.metrics, lostEvidence: r.lostEvidence,
      alternative: r.alternative, recallCheck: prior.recallCheck ? { ...prior.recallCheck, estimate: recallEstimate(s, stage) } : null, model: r.model };
    return s;
  });
}

/** Draws and keeps a recall check sample (replacing the previous one). */
export function storeRecallCheck(stage = 'ta', { n = 50, seed = Math.floor(Math.random() * 2 ** 31) } = {}) {
  update(s => {
    const chk = recallCheck(s, stage, { n, seed });
    const v = s.aiValidation && typeof s.aiValidation === 'object' ? s.aiValidation : (s.aiValidation = {});
    v.screening ||= {}; v.screening[stage] = { ...(v.screening[stage] || {}), recallCheck: chk };
    return s;
  });
}
