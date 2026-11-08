// GRADE ratings proposed from the analyses by stated rules (28 Oct 2026: the Spine review's rows were set by hand with the authors' own rules,
// "inconsistency serious if I² ≥ 50%, imprecision if fewer than 50 events"). A proposal is not a rating: it goes into a change file of `set`
// ops a person reads and applies, and each footnote it writes is marked as drafted by rule ({ text, extractor: 'rule:grade' }), so it counts
// as unverified until a person edits or checks it (lib/grade.mjs explanationText). Four domains are proposed from what the project holds:
//   risk of bias   the share of the pooled studies whose overall judgement is high, serious or critical (a checklist with no overall: none)
//   inconsistency  I² against two cut-offs (one study: none)
//   imprecision    the confidence interval including no effect, and the events (binary, proportion) or participants (continuous) under a minimum
//   publication    Egger's test with at least ten studies (fewer: none)
// Indirectness is a judgement about the question, so it is never proposed. A domain a person has rated is left as it is unless `replace`.
import { lib_outcomes$analysisOf as analysisOf } from "../boot.mjs";
import { studyInputs } from './analysis-inputs.mjs';
import { lib_effect_measures$measureOf as measureOf, lib_effect_measures$noEffect as noEffect } from "../boot.mjs";
import { blankOutcome } from './grade.mjs';
import { linkedOutcome, toRate, pooledSummary } from './grade-link.mjs';
import { robRecord } from './rob-record.mjs';

/** The rules when none are given: the Cochrane Handbook's I² bands and GRADE's rules of thumb for the optimal information size. */
export const DEFAULT_RULES = Object.freeze({ i2Serious: 50, i2VerySerious: 75, minEvents: 300, minParticipants: 400, highRiskShare: 0.5, eggerP: 0.1, minStudiesForBias: 10 });
const HIGH = /high|serious|critical/i;
const pct = x => `${Math.round(x * 100)}%`;

/** The events of a pooled result (both arms of a binary measure, the events of a proportion), or null when the measure has none. */
function eventsOf(s, a, outcomeId) {
  // a saved result keeps each row's events (xi; a binary one each arm's, ai and ci): the counts it pooled, whatever the outcome is derived from
  const sum = xs => xs.map(Number).reduce((x, y) => x + y, 0);
  if (Array.isArray(a.xi) && a.xi.length && a.xi.every(x => Number.isFinite(Number(x)))) return sum(a.xi);
  if (Array.isArray(a.ai) && Array.isArray(a.ci)) return sum([...a.ai, ...a.ci]);
  const family = measureOf(a.measure).family, at = family === 'binary' ? [0, 2] : family === 'proportion' ? [0] : null;
  if (!at) return null;
  const labels = new Set(a.labels || []), papers = (s.papers || []).filter(p => labels.has(p.label));
  const counts = papers.map(p => studyInputs(s, p.id, a.measure, outcomeId)).map(v => at.reduce((n, i) => n + Number(v?.[i]), 0));
  return counts.length && counts.every(Number.isFinite) ? counts.reduce((x, y) => x + y, 0) : null;
}

/** The ratings proposed for one outcome's result: { [domain]: { rating: none | serious | veryserious, reason } } (a domain left out is not proposed). */
export function proposeFor(s, outcome, rules = {}) {
  const R = { ...DEFAULT_RULES, ...rules }, a = outcome && analysisOf(s, outcome.id);
  if (!a) return {};
  const out = {}, k = Number(a.k ?? a.studies), lo = Number(a.lo), hi = Number(a.hi);

  // risk of bias: the pooled studies' overall judgements
  // a row per arm is labelled "Study, Arm 1": the study is judged once
  const labels = new Set((a.labels || []).map(l => String(l).replace(/,\s*arm\s*\d+$/i, ''))), pooled = robRecord(s).filter(r => labels.has(r.label));
  const judged = pooled.filter(r => r.overall), unjudged = labels.size - judged.length;
  if (judged.length) {
    const high = judged.filter(r => HIGH.test(r.overall)), share = high.length / judged.length;
    out.rob = { rating: share > R.highRiskShare ? 'serious' : 'none',
      reason: `${high.length} of ${judged.length} studies with an overall judgement at high, serious or critical risk of bias (${pct(share)}; serious above ${pct(R.highRiskShare)})${high.length ? `: ${high.map(r => r.label).join(', ')}` : ''}${unjudged ? `; ${unjudged} pooled ${unjudged === 1 ? 'study has' : 'studies have'} no overall judgement (a checklist, or not appraised)` : ''}.` };
  }

  // inconsistency: I²
  const i2 = Number(a.i2);
  if (k > 1 && a.i2 != null && Number.isFinite(i2)) {
    out.inconsistency = { rating: i2 >= R.i2VerySerious ? 'veryserious' : i2 >= R.i2Serious ? 'serious' : 'none',
      reason: `I² ${i2.toFixed(0)}% (serious from ${R.i2Serious}%, very serious from ${R.i2VerySerious}%).` };
  }

  // imprecision: the interval and the information size
  const signals = [], facts = [], nul = a.measure ? noEffect(a.measure) : null;
  if (Number.isFinite(lo) && Number.isFinite(hi) && nul != null) {
    if (lo <= nul && hi >= nul) signals.push(`the 95% CI (${lo.toPrecision(3)} to ${hi.toPrecision(3)}) includes no effect`);
    else facts.push(`the 95% CI (${lo.toPrecision(3)} to ${hi.toPrecision(3)}) excludes no effect`);
  }
  const events = eventsOf(s, a, outcome.id), n = Number(pooledSummary(s, outcome)?.participants);
  if (events != null) (events < R.minEvents ? signals : facts).push(`${events} events (${events < R.minEvents ? 'fewer than' : 'at least'} ${R.minEvents})`);
  else if (Number.isFinite(n) && n > 0) (n < R.minParticipants ? signals : facts).push(`${n} participants (${n < R.minParticipants ? 'fewer than' : 'at least'} ${R.minParticipants})`);
  if (signals.length || facts.length) {
    out.imprecision = { rating: signals.length >= 2 ? 'veryserious' : signals.length ? 'serious' : 'none', reason: `${[...signals, ...facts].join('; ').replace(/^./, c => c.toUpperCase())}.` };
  }

  // publication bias: Egger's test with enough studies
  const egger = (a.extras?.bias?.tests || []).find(t => /^egger/i.test(String(t.name)) && Number.isFinite(Number(t.p)));
  if (k >= R.minStudiesForBias && egger) {
    const p = Number(egger.p);
    out.publication = { rating: p < R.eggerP ? 'serious' : 'none', reason: `Egger's test p = ${p < 0.001 ? '<0.001' : p.toFixed(3)} with ${k} studies (serious below ${R.eggerP}).` };
  }
  return out;
}

/**
 * The proposals for every GRADE row with a result, and a row for each analysed outcome no row reports yet (with `add`), as change-file ops:
 * { ops: [{ op: 'set', path, value }], rows: [{ outcome, row, proposed: { domain: { rating, reason, kept? } } }] }. A domain a person
 * rated is kept (kept: their rating) unless `replace`.
 */
export function gradeProposals(s, { rules = {}, add = true, replace = false } = {}) {
  const ops = [], rows = [], grade = s.grade || [];
  const one = (row, i, isNew) => {
    const outcome = linkedOutcome(s, row), proposed = proposeFor(s, outcome, rules);
    for (const [d, p] of Object.entries(proposed)) {
      const had = row.ratings?.[d];
      if (had && !replace && !isNew) { p.kept = had; continue; }
      if (!isNew) {
        ops.push({ op: 'set', path: ['grade', i, 'ratings', d], value: p.rating });
        ops.push({ op: 'set', path: ['grade', i, 'explanations', d], value: { text: p.reason, extractor: 'rule:grade' } });
      }
    }
    if (isNew) {
      const ratings = {}, explanations = {};
      for (const [d, p] of Object.entries(proposed)) { ratings[d] = p.rating; explanations[d] = { text: p.reason, extractor: 'rule:grade' }; }
      ops.push({ op: 'set', path: ['grade', i], value: { ...row, ratings, explanations } });
    }
    rows.push({ outcome: outcome?.name || row.name, row: i, added: isNew, proposed });
  };
  grade.forEach((row, i) => { if (linkedOutcome(s, row) && analysisOf(s, linkedOutcome(s, row).id)) one(row, i, false); });
  if (add) toRate(s).forEach((o, k) => {
    const p = pooledSummary(s, o);
    one({ ...blankOutcome(o.name), analysisOutcome: o.id, studies: p.studies, participants: p.participants || '', effect: p.effect, filledFrom: p.identity }, grade.length + k, true);
  });
  return { ops, rows };
}

/** The proposals' ops applied to a state in place (Certainty › Propose ratings; the CLI writes them as a change file instead). */
export function applyProposals(st, ops) {
  for (const o of ops) {
    let at = st;
    for (const k of o.path.slice(0, -1)) at = at[k] ??= {};
    at[o.path.at(-1)] = structuredClone(o.value);
  }
  return st;
}
