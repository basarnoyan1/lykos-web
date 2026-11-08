// Two checks on a screening (PAPER-COVERAGE F4): the records a language rule would exclude, and a false-negative sweep over the
// records already excluded.
//
// Non-English: the language is the registry's own metadata (lib/languages.mjs), never guessed from a title or an abstract. A record
// is flagged only when a language is recorded and English is not among them. "Non-English" is a stock exclusion reason, so an
// exclusion made for it is counted with the other reasons (the reason filter, the PRISMA reasons).
//
// Re-screen excluded: the records excluded at a stage are assessed again with ONE chosen rule left out. A record that would no
// longer be excluded is a possible false negative. The answers are kept apart from the review's proposals and decisions
// (`screeningSweeps`), because they answer a different question than the review's rules ask: nothing here writes a decision, and a
// result becomes one only when the reviewer decides that record.
import { storedLanguage, languageCodes, nonEnglishLanguage } from './languages.mjs';
import { store$update as update } from "../boot.mjs";

export const LANGUAGE_REASON = 'Non-English';

/** A language is recorded and English is not one of them. */
export function isNonEnglish(paper) {
  const codes = languageCodes(storedLanguage(paper));
  return codes.length > 0 && !codes.includes('en');
}
/** The flagged records' ids. */
export const nonEnglishIds = (papers = []) => new Set(papers.filter(isNonEnglish).map(p => p.id));
/** The language of a flagged record in words ("French"), for its row. */
export const languageName = paper => nonEnglishLanguage(storedLanguage(paper));

/**
 * What the check finds among a stage's records. `decisionOf(id)` is the reviewer's decision on a record. `flagged`: non-English
 * records; `open`: of those not decided; `excluded`: decided exclude; `forReason`: excluded with the stock reason; `included`: decided
 * include or uncertain, which the reviewer may want to look at again.
 */
export function languageCounts(papers, decisionOf) {
  const out = { flagged: 0, open: 0, excluded: 0, forReason: 0, included: 0 };
  for (const p of papers) {
    if (!isNonEnglish(p)) continue;
    out.flagged++;
    const d = decisionOf(p.id);
    if (!d) out.open++;
    else if (d.decision === 'exclude') { out.excluded++; if (d.reason === LANGUAGE_REASON) out.forReason++; }
    else out.included++;
  }
  return out;
}

/** How many decided exclusions each reason accounts for, the stock language reason among them. */
export function exclusionReasons(papers, decisionOf) {
  const out = new Map();
  for (const p of papers) {
    const d = decisionOf(p.id);
    if (d?.decision !== 'exclude') continue;
    const r = String(d.reason || '').trim() || 'No reason';
    out.set(r, (out.get(r) || 0) + 1);
  }
  return out;
}

// ---- the sweep ----------------------------------------------------------------------------------------------------------------
/** The code a reason starts with ("C2: wrong design" is C2), or is ("E3", as a change file may write it), or ''. */
export function reasonCode(reason) {
  const m = String(reason || '').trim().match(/^([A-Z]{1,3}\d{1,2}[a-z]?)(?:\s*[:.–-]\s|\s*$)/);
  return m ? m[1] : '';
}
export const rulesWithout = (rules, ruleId) => rules.filter(r => r.id !== ruleId);

/**
 * The excluded records a sweep without `ruleId` re-reads: those excluded for that rule, and those whose reason names no rule (so
 * nothing says another rule would still exclude them). A record excluded for a different rule is not re-read: leaving this one out
 * cannot change its exclusion.
 */
export function sweepScope(papers, decisionOf, ruleId) {
  return papers.filter(p => {
    const d = decisionOf(p.id);
    if (d?.decision !== 'exclude') return false;
    const code = reasonCode(d.reason);
    return !code || code === ruleId;
  });
}

/** The rule excluded records name most often: the default for the sweep's choice. */
export function mostCitedRule(papers, decisionOf, rules) {
  const n = new Map();
  for (const p of papers) { const d = decisionOf(p.id); if (d?.decision === 'exclude') { const c = reasonCode(d.reason); if (c) n.set(c, (n.get(c) || 0) + 1); } }
  const known = rules.filter(r => r.kind !== 'group').map(r => r.id);
  return [...n.entries()].filter(([c]) => known.includes(c)).sort((a, b) => b[1] - a[1])[0]?.[0] || known[0] || '';
}

/** What is kept of an answer: the verdict and what it rests on, not the three saved passes. */
export function sweepResult(a) {
  return { verdict: a.verdict, p: a.p ?? null, criteria: (a.criteria || []).map(c => ({ id: c.id, met: c.met, p: c.p ?? null })),
    ...(a.triageNote ? { note: a.triageNote } : {}), ...(a.screeningOutcome ? { outcome: a.screeningOutcome } : {}) };
}

/**
 * The sweep as it was run. `engine(records, rules, onEach)` assesses records under `rules` and calls `onEach(record, answer)`; an
 * answer without a verdict (an error) is skipped. Nothing is stored: the caller decides when `commitSweep` runs, so a run that is
 * stopped (the engine stops answering) keeps what it had.
 */
export async function rescreenExcluded({ papers, decisionOf, rules, ruleId, engine, onProgress = () => {} }) {
  const scope = sweepScope(papers, decisionOf, ruleId);
  const results = {};
  await engine(scope, rulesWithout(rules, ruleId), (record, answer) => {
    if (!answer || !answer.verdict) return;
    results[record.id] = sweepResult(answer);
    onProgress(Object.keys(results).length, scope.length);
  });
  return { scope: scope.map(p => p.id), results };
}

// A protocol scenario's sweep (views/screening-rescreen.mjs sweepScenario) is kept in its own overlay, s.scenarioScreening[id].sweeps[stage],
// so main's (screeningSweeps) is never touched while a scenario is shown. `scenario` is a scenario id, or none (or 'main') for main's; a
// read defaults to the scenario a scenario's view names (lib/scenarios.mjs scenarioView, protocol.scenario).
const scenarioArg = (s, scenario) => (scenario === undefined ? s?.protocol?.scenario : scenario);
const isScenario = id => id != null && id !== '' && id !== 'main';
const sweepsOf = (s, scenario) => (isScenario(scenario) ? s?.scenarioScreening?.[scenario]?.sweeps : s?.screeningSweeps);

/** Keeps a sweep for the stage, replacing the stage's earlier one: main's, or with `scenario` that scenario's. */
export function commitSweep(stage, { ruleId, ruleText = '', model = '', scope, results, fingerprint }, { scenario } = {}) {
  const at = new Date().toISOString(), sweep = { rule: ruleId, ruleText, model, at, scope: scope.length, results, ...(fingerprint ? { fingerprint } : {}) };
  update(s => {
    if (isScenario(scenario)) {
      const lane = ((s.scenarioScreening ||= {})[scenario] ||= {});
      lane.sweeps = { ...(lane.sweeps || {}), [stage]: { ...sweep, scenario } };
    } else s.screeningSweeps = { ...(s.screeningSweeps || {}), [stage]: sweep };
    return s;
  });
}
export const sweepOf = (s, stage, scenario) => sweepsOf(s, scenarioArg(s, scenario))?.[stage] || null;
/** The ids a sweep leaves open: a record it would no longer exclude. */
export const sweepFlagged = (s, stage, scenario) => Object.entries(sweepOf(s, stage, scenario)?.results || {}).filter(([, r]) => r.verdict !== 'exclude').map(([id]) => id);
/** A record the reviewer decided again is no longer open in the sweep (main's, or with `scenario` that scenario's). */
export function dropSweepResult(stage, id, scenario) {
  update(s => { const sw = sweepsOf(s, scenario)?.[stage]; if (sw?.results?.[id]) delete sw.results[id]; return s; });
}
export function clearSweep(stage, scenario) {
  update(s => {
    if (isScenario(scenario)) { const lane = s.scenarioScreening?.[scenario]; if (lane?.sweeps?.[stage]) { lane.sweeps = { ...lane.sweeps }; delete lane.sweeps[stage]; } return s; }
    if (s.screeningSweeps?.[stage]) { s.screeningSweeps = { ...s.screeningSweeps }; delete s.screeningSweeps[stage]; }
    return s;
  });
}
