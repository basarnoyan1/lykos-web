// Where a review stands, counted once for every reader (31 Oct 2026, owner: "the Overview misrepresents a nearly finished review"): the
// Overview's stages and Submission readiness (lib/overview-facts.mjs), Needs attention (lib/progress.mjs), Getting started's steps and the
// next step (lib/guide-steps.mjs, lib/research-workflow.mjs) and the MCP overview (tools/mcp/overview.mjs) read these, so the app and an
// agent cannot give two answers.
//
//   reviewStudies(s)        the included trials, not records: a study is a trial with a full-text include (a title/abstract include only
//                           when the review has no full-text stage), its linked reports (op report_of) counted apart; the records still
//                           waiting for a full-text decision, uncertain at full text, or awaiting classification are said as such
//   studyAppraisal(...)     a study's risk-of-bias answers as the Appraisal page reads them (lib/rob-review.mjs effectiveAnswers), its
//                           overall the recorded one, else the one the project's rule gives (lib/rob-overall.mjs derivedOverall)
//   personChecks(s, ...)    what a person (never a model) has recorded as checked: reviewLedger entries marked `person: true` and each
//                           person's own checks (lib/person-checks.mjs), counted by the verification lists when the project has them
//   externalOutputs(s)      analyses and a manuscript built outside Lykos by the project's own scripts, registered with the change op
//                           register_output (tools/lykos-register.mjs), and whether the data changed after they were built
// Pure: state in, facts out.
import { lib_rob_review$effectiveAnswers as effectiveAnswers, lib_rob_review$STUDY as STUDY } from "../boot.mjs";
import { instrumentFor } from './study-instrument.mjs';
import { derivedOverall, robOverallRule } from './rob-overall.mjs';
import { lib_dates$day as day } from "../boot.mjs";

export { lib_review_studies$AWAITING as AWAITING, lib_review_studies$reviewStudies as reviewStudies, lib_review_studies$byPerson as byPerson } from "../boot.mjs";
// a person's checks: the review ledger's person entries and each person's own checks, by verification list when the project has lists
export { personChecks } from './person-checks.mjs';
import { personChecks as listAware } from './person-checks.mjs';
import { lib_progress$usePersonChecks as usePersonChecks } from "../boot.mjs";
usePersonChecks(listAware);
import { lib_review_studies$reviewStudies as reviewStudies, lib_review_studies$perVersion as perVersion } from "../boot.mjs";

/**
 * A study's risk of bias: { tool, answers, overall, derived, complete, started }. `checks` is the project's .lykos/build.json "checks" (its
 * "robOverall" rule); `rule` a rule already chosen wins. An overall nobody recorded is the one the rule gives from the domains, marked `derived`.
 */
export function studyAppraisal(s, paperId, { checks = null, rule = null } = {}) {
  const tool = instrumentFor(s, paperId), answers = effectiveAnswers(s, paperId, tool.id, STUDY).answers;
  const domains = tool.domains || [], judged = domains.filter(d => answers[d.id]).length;
  let overall = tool.overall ? answers.overall || '' : '', derived = false;
  if (tool.overall && !overall && judged === domains.length && domains.length) {
    const d = derivedOverall(tool, answers, rule || robOverallRule(checks, tool.id));
    if (d.value) { overall = d.value; derived = true; }
  }
  const complete = domains.length > 0 && judged === domains.length && (!tool.overall || Boolean(overall));
  return { tool, answers: overall && tool.overall ? { ...answers, overall } : answers, overall, derived, complete, started: judged > 0 || Boolean(answers.overall) };
}

/** Risk of bias over the studies: { of, complete, started, derived } (derived: complete with the overall from the project's rule). */
export function appraisalCount(s, studies, opts = {}) {
  let complete = 0, started = 0, derived = 0;
  for (const p of studies) { const a = studyAppraisal(s, p.id, opts); if (a.complete) complete++; if (a.started) started++; if (a.complete && a.derived) derived++; }
  return { of: studies.length, complete, started, derived };
}

// ---- outputs built outside Lykos ---------------------------------------------------------------------------------------------------

export const EXTERNAL_KINDS = Object.freeze(['analysis', 'manuscript']);

/**
 * The registered analysis run and manuscript (s.externalOutputs, op register_output), each with what changed in the data after it was
 * built (`builtAt`): `after.studies` the studies whose inclusion decision was written later (a new include, or a note added to one), `after.values` the values of included studies written
 * later; `days` their dates as the app writes them (lib/dates.mjs day, on the day `now`). { analysis, manuscript } (null when none is registered).
 */
export const externalOutputs = (s, studies, now = Date.now()) => (studies ? outputsOf(s, studies, now) : outputsNow(s, now));
// the review's own studies: once per version of the open project and day (a pass over every value, 40 ms of each Analysis paint)
const outputsNow = perVersion((s, now) => outputsOf(s, reviewStudies(s).studies, now), now => new Date(now).toDateString());
function outputsOf(s, studies, now) {
  const reg = s.externalOutputs || {}, out = {};
  for (const kind of EXTERNAL_KINDS) {
    const e = reg[kind];
    if (!e || typeof e !== 'object' || !e.file) { out[kind] = null; continue; }
    const at = String(e.builtAt || e.at || ''), after = afterOf(s, studies, at);
    const days = { built: day(e.builtAt || e.at, now), ran: day(e.ran || e.builtAt || e.at, now), checked: day(e.numberCheck?.date || e.builtAt || e.at, now) };
    out[kind] = { ...e, days, after: { ...after, text: afterText(after) }, stale: Boolean(at) && (after.studies > 0 || after.values > 0) };
  }
  return out;
}

// the review's inclusion decisions and values written after `at` (an ISO time): the times are gathered once per version of the open project
// and set of studies (one pass over every value; the Manuscript page asks for each of its 26 outputs' build times, 3 Nov 2026), then each
// question is a search in them
const timesOf = perVersion((s, studies) => {
  const ids = new Set(studies.map(p => p.id)), values = [];
  for (const [k, v] of Object.entries(s.values || {})) if (v && ids.has(k.slice(0, k.indexOf(':')))) values.push(String(v.at || ''));
  values.sort();
  const decisions = studies.map(p => ({ at: String((s.fulltext?.[p.id] || s.screening?.[p.id])?.at || ''), label: p.label || p.id }));
  return { values, decisions };
}, studies => studies);
const countAfter = (sorted, at) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] > at) hi = mid; else lo = mid + 1; } return sorted.length - lo; };
function afterOf(s, studies, at) {
  const t = timesOf(s, studies), later = t.decisions.filter(d => d.at > at);
  return { studies: later.length, labels: later.map(d => d.label), values: countAfter(t.values, at) };
}
/**
 * What was written in the review's data after `at` (an ISO time: an output drawn outside the app, a table of a registered manuscript):
 * { studies, labels, values, text, changed }. The review's studies once per version of the open project (the Manuscript page asks for each
 * table and figure it names).
 */
export function writtenAfter(s, at, studies = reviewStudies(s).studies) {
  const after = afterOf(s, studies, String(at || ''));
  return { ...after, text: afterText(after), changed: Boolean(at) && (after.studies > 0 || after.values > 0) };
}

/** "3 inclusion decisions and 490 values written" (after an output was built), or ''. */
export function afterText(after) {
  if (!after) return '';
  const n = (k, one, many) => `${k.toLocaleString('en')} ${k === 1 ? one : many}`;
  // a decision written again (a note added) counts too: it says what was written after, not that the study is new to the review
  return [after.studies ? `${n(after.studies, 'inclusion decision', 'inclusion decisions')}` : '', after.values ? `${n(after.values, 'value', 'values')}` : ''].filter(Boolean).join(' and ').replace(/(.)$/, '$1 written');
}
