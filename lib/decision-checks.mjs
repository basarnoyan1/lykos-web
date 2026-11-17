// Inclusion and exclusion decisions reconciled against the rest of the store (assurance plan, step 4, row 3: "decisions reconcile").
// It catches counts that disagree with the decisions (Sham, 14 Nov 2026: a manuscript saying 47 included studies where the flow has 106).
// It cannot catch a wrong judgment both reviewers share, nor a real quote that was misread: it reads what was recorded, not the papers.
//
// Six checks, each one named for what it holds for every record:
//   terminal  every record ends in exactly one terminal state (included, excluded at title and abstract, excluded at full text,
//             awaiting classification, not retrieved); two states at once, an orphan decision, a repeated id and an undecided record fail
//   reason    every full-text exclusion has exactly one reason, and it is a criterion of the protocol (an exclusion criterion, not withdrawn)
//   rules     the eligibility rules applied again to the facts the reviewers recorded give the verdict stored with them, and the decision
//             recorded is a verdict some rule gives when every reviewer agrees (lib/eligibility-review.mjs: tools/lykos-eligibility.mjs table)
//   analyses  every included study is in each registered analysis, or the project records why it is not (a value marked not reported)
//   flow      the PRISMA counts the decisions fix are those the decisions give, recounted here apart from lib/prisma-counts.mjs derive, and a
//             count typed over a derived one is named
//   text      the numbers a manuscript states agree with the flow (given by the caller, which reads the text: tools/lykos-completeness.mjs)
// One pass over `papers`; lookups by id through lib/record-index.mjs; never a copy of the records. Pure: reads `s`, changes nothing.
import { lib_screen$atFullText as atFullText, lib_screen$awaitingClass as awaitingClass } from "../boot.mjs";
import { reasonCode } from './screening-checks.mjs';
import { recordsById } from './record-index.mjs';
import { derive, prismaData } from './prisma-counts.mjs';
import { readRules, applyRules, factsWithThresholds, recordEligibility } from './eligibility-review.mjs';
import { lib_review_studies$reviewStudies as reviewStudies } from "../boot.mjs";
import { lib_outcomes$pooledResults as pooledResults } from "../boot.mjs";
import { pooledInputs, acceptedCount, acceptedNumber } from './analysis-inputs.mjs';
import { lib_effect_measures$inputFields as inputFields } from "../boot.mjs";
import { lib_outcomes$fieldFor as fieldFor } from "../boot.mjs";

export const CHECKS = [
  { id: 'terminal', name: 'Every record has exactly one terminal state' },
  { id: 'reason', name: 'Every full-text exclusion has one reason, taken from the criteria' },
  { id: 'rules', name: 'The rules applied to the recorded facts give the stored verdict' },
  { id: 'analyses', name: 'Every included study is in each analysis, or a reason is recorded' },
  { id: 'flow', name: 'The flow counts are the decisions\' counts' },
  { id: 'text', name: 'The numbers in the manuscript agree with the flow' },
];

const STORE_CAP = 400;   // findings kept per check (the count is always whole): 30,000 undecided records are one finding each, not a list
const blank = v => v == null || String(v).trim() === '';
const num = v => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const listSum = v => (blank(v) ? null : String(v).split(';').reduce((a, x) => a + (Number(x.slice(x.lastIndexOf(',') + 1)) || 0), 0));
const WITHDRAWN = /^\s*withdrawn\b/i;
const NOT_RETRIEVED = /not retriev/i;

// the keys of the PRISMA data the decisions fix: what was typed over them must be what they give (identification and duplicates come from the
// searches, not from decisions, and are left to flowChecks and the searches)
const DECISION_KEYS = ['records_excluded', 'records_screened', 'dbr_sought_reports', 'dbr_notretrieved_reports', 'dbr_assessed', 'dbr_excluded',
  'other_sought_reports', 'other_notretrieved_reports', 'other_assessed', 'other_excluded', 'new_studies', 'new_reports'];

const BOXES = ['screened', 'sought', 'assessed', 'studies', 'reports'];   // lib/flow-numbers.mjs: the boxes the decisions fix

class Check {
  constructor(spec) { Object.assign(this, spec, { findings: [], count: 0, groups: new Map() }); }
  /** One violation: `id` the record's id ('' for a count), `kind` what fails (findings of one kind are told together). */
  add(id, kind, message, label = '') {
    this.count++;
    const g = this.groups.get(kind) || { kind, count: 0, ids: [] };
    g.count++; if (id && g.ids.length < STORE_CAP) g.ids.push(id);
    this.groups.set(kind, g);
    if (this.findings.length < STORE_CAP) this.findings.push({ check: this.id, id, label, kind, message });
  }
  result() { return { id: this.id, name: this.name, ok: this.count === 0, count: this.count, kinds: [...this.groups.values()], findings: this.findings, checked: this.checked ?? null }; }
}

/** The criteria of the protocol by id: { exclude: Set of ids, withdrawn: Set, all: Map id → text }. */
function criteriaOf(s) {
  const all = new Map(), exclude = new Set(), withdrawn = new Set();
  for (const c of Array.isArray(s.protocol?.criteria) ? s.protocol.criteria : []) {
    if (c?.id == null) continue;
    const id = String(c.id); all.set(id, String(c.text || ''));
    if (c.kind === 'exclude') exclude.add(id);
    if (WITHDRAWN.test(c.text || '')) withdrawn.add(id);
  }
  return { all, exclude, withdrawn };
}

/** The criterion ids a reason names (the leading code, or any criterion id standing alone in it), and whether it is a criterion's own words. */
function namedBy(reason, crit, pattern) {
  const r = String(reason || '').trim(), lead = reasonCode(r), codes = new Set(lead ? [lead] : []);
  if (pattern) for (const m of r.matchAll(pattern)) codes.add(m[1]);
  if (!codes.size) {
    const bare = r.replace(/\.$/, '').toLowerCase();
    for (const [id, text] of crit.all) if (crit.exclude.has(id) && text && text.replace(/\.$/, '').toLowerCase() === bare) codes.add(id);
  }
  return [...codes];
}

/**
 * Every check over the store: { records, checks: [{ id, name, ok, count, kinds, findings, checked }], findings, ok }.
 * `flowRows`: the rows lib/manuscript-checks.mjs flowNumberRows gives for the manuscript's text (the check of the text is skipped without them).
 */
export function decisionChecks(s, { flowRows = null } = {}) {
  const papers = Array.isArray(s.papers) ? s.papers : [], sc = s.screening || {}, ft = s.fulltext || {};
  const byId = recordsById(s), crit = criteriaOf(s), checks = Object.fromEntries(CHECKS.map(c => [c.id, new Check(c)]));
  const label = p => p.label || p.id;
  const ids = [...crit.exclude].sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const codeIn = ids.length ? new RegExp(`(?<![A-Za-z0-9])(${ids.join('|')})(?![A-Za-z0-9])`, 'g') : null;
  const rulesCfg = s.eligibilityRules ? readRules(s.eligibilityRules) : null;
  const reviews = s.eligibilityReview?.studies || {};
  const ftBegun = papers.some(p => ft[p.id]?.decision);

  // ---- one pass: terminal states, reasons, rules, and the recount of the flow's decision counts ---------------------------------------
  const seen = new Set(), count = { included: 0, reports: 0, ftExcluded: 0, notRetrieved: 0, assessed: 0 }, trials = new Set();
  const T = checks.terminal, R = checks.reason, U = checks.rules;
  let exclusions = 0;
  for (const p of papers) {
    if (seen.has(p.id)) T.add(p.id, 'an id used by more than one record', `${label(p)}: the id is used by more than one record`, label(p));
    seen.add(p.id);
    const ta = sc[p.id], f = ft[p.id], taEx = ta?.decision === 'exclude' && !ta.needsCriteriaReview;
    const lost = p.pdfRetrieval?.status === 'not-retrieved';
    const inc = ftBegun ? f?.decision === 'include' : (f || ta)?.decision === 'include';
    const final = f?.decision ? f : ta;
    const ftEx = f?.decision === 'exclude' && !lost, notFound = ftEx && NOT_RETRIEVED.test(f.reason || '');
    const awaiting = !inc && !taEx && awaitingClass(final), ended = [];
    if (taEx && !f?.decision) ended.push('excluded at title and abstract');
    if (ftEx && !notFound) ended.push('excluded at full text');
    if (inc) ended.push('included');
    if (awaiting) ended.push('awaiting classification');
    if (lost || notFound) ended.push('not retrieved');
    // a record whose title/abstract exclusion stands beside a full-text decision, or that is recorded not retrieved beside a decision
    // made on its report, is in two places of the flow
    if (taEx && f?.decision) T.add(p.id, 'excluded at title and abstract and also decided at full text', `${label(p)}: excluded at title and abstract, and also ${f.decision === 'uncertain' ? 'uncertain' : f.decision === 'include' ? 'included' : 'excluded'} at full text`, label(p));
    else if (lost && (f?.decision === 'include' || (f?.decision === 'exclude' && !NOT_RETRIEVED.test(f.reason || ''))))
      T.add(p.id, 'recorded not retrieved and also decided at full text', `${label(p)}: recorded as not retrieved, and ${f.decision === 'include' ? 'included' : 'excluded'} at full text`, label(p));
    else if (ended.length > 1) T.add(p.id, `in ${ended.length} terminal states`, `${label(p)}: ${ended.join(' and ')}`, label(p));
    else if (!ended.length) {
      const why = !final?.decision ? 'no decision' : final.decision === 'uncertain' ? (f?.decision ? 'uncertain at full text' : 'uncertain at title and abstract')
        : ftBegun && ta?.decision === 'include' ? 'included at title and abstract, waiting for its full-text decision' : 'no terminal state';
      T.add(p.id, `not yet decided: ${why}`, `${label(p)}: ${why}`, label(p));
    }
    // an included report of a trial the project does not hold, or one that is itself not included
    if (inc && p.reportOf) {
      const main = byId.get(p.reportOf);
      if (!main) T.add(p.id, 'a report of a record that is not in the project', `${label(p)}: report of ${p.reportOf}, which is not in the project`, label(p));
      else if (!(ftBegun ? ft[main.id]?.decision === 'include' : (ft[main.id] || sc[main.id])?.decision === 'include'))
        T.add(p.id, 'a report included while its main report is not', `${label(p)}: included as a report of ${label(main)}, which is not included`, label(p));
    }
    if (inc) { count.included++; trials.add(p.reportOf || p.id); }
    if (ftEx && !notFound && atFullText(s, p)) count.ftExcluded++;
    if (lost || notFound) count.notRetrieved++;

    // ---- the reason of a full-text exclusion ----
    if (ftEx && !notFound) {
      exclusions++;
      const reason = String(f.reason || '').trim();
      if (!reason) R.add(p.id, 'no reason', `${label(p)}: excluded at full text with no reason`, label(p));
      else if (!crit.all.size) R.add(p.id, 'the project records no criteria', `${label(p)}: reason "${reason.slice(0, 60)}" cannot be taken from criteria, which the project does not record`, label(p));
      else {
        const named = namedBy(reason, crit, codeIn);
        if (named.length > 1) R.add(p.id, 'more than one reason', `${label(p)}: reason names ${named.join(' and ')}: "${reason.slice(0, 60)}"`, label(p));
        else if (/;/.test(reason) && !named.length) R.add(p.id, 'more than one reason', `${label(p)}: reason lists several: "${reason.slice(0, 60)}"`, label(p));
        else if (!named.length) R.add(p.id, `a reason that names no criterion: ${reason.slice(0, 60)}`, `${label(p)}: reason "${reason.slice(0, 60)}" names no criterion`, label(p));
        else if (!crit.exclude.has(named[0])) R.add(p.id, `a reason that is not an exclusion criterion: ${named[0]}`, `${label(p)}: ${named[0]} is not an exclusion criterion`, label(p));
        else if (crit.withdrawn.has(named[0])) R.add(p.id, `a reason from a withdrawn criterion: ${named[0]}`, `${label(p)}: excluded under ${named[0]}, a withdrawn criterion`, label(p));
      }
    }

    // ---- the rules, applied again to the facts the reviewers recorded ----
    const st = rulesCfg && reviews[p.id];
    if (st && !rulesCfg.problems.length) {
      U.checked = (U.checked || 0) + 1;
      // a verdict stored with a review (the results file keeps them; the project keeps the facts) is the rules' answer when it was made
      for (const [who, rv] of Object.entries(st.reviews || {})) {
        if (!rv?.verdicts) continue;
        const now = applyRules(factsWithThresholds(rv, rulesCfg), rulesCfg);
        for (const [rid, v] of Object.entries(rv.verdicts)) if (now[rid] && v?.verdict !== now[rid].verdict)
          U.add(p.id, 'a stored verdict the rules do not give again', `${label(p)}: ${who} under ${rid}: stored ${v.verdict}, the recorded facts give ${now[rid].verdict}`, label(p));
      }
      const e = recordEligibility(s, p.id), d = f?.decision;
      if (e && (d === 'include' || d === 'exclude')) {
        const agreed = e.rules.map(r => r.agreed), settled = agreed.length > 0 && agreed.every(a => a === 'include' || a === 'exclude');
        if (settled && !agreed.includes(d))
          U.add(p.id, `${d === 'include' ? 'included' : 'excluded'} at full text, every rule says otherwise`, `${label(p)}: ${d === 'include' ? 'included' : 'excluded'} at full text; ${e.rules.map(r => `${r.id} gives ${r.agreed}`).join(', ')} on the recorded facts`, label(p));
      }
    }
  }
  // decisions on a record the project does not hold
  for (const [stage, decisions] of [['title and abstract', sc], ['full text', ft]])
    for (const id of Object.keys(decisions)) if (!byId.has(id)) T.add(id, `a decision for a record that is not in the project (${stage})`, `${id}: a ${stage} decision, and no such record`);
  T.checked = papers.length; R.checked = exclusions;

  // ---- the analyses ---------------------------------------------------------------------------------------------------------------------
  analysesCheck(s, checks.analyses, count, label);

  // ---- the flow: typed over derived, and the decisions' counts recounted ----------------------------------------------------------------
  const F = checks.flow, d = derive(s), P = prismaData(s), typed = s.prisma || {};
  for (const k of DECISION_KEYS) {
    if (blank(typed[k])) continue;
    const t = typed[k], dv = d[k];
    if (dv == null) F.add('', `typed in, not derived from the decisions: ${k}`, `${k} is typed (${t}); the decisions give none`);
    else if (String(t).trim() !== String(dv).trim() && !(num(t) != null && num(t) === num(dv)) && !(k.endsWith('_excluded') && listSum(t) === listSum(dv) && String(t).split(';').length === String(dv).split(';').length))
      F.add('', `typed over the decisions' count: ${k}`, `${k} is typed ${t}; the decisions give ${dv}`);
  }
  // the recount, from this pass, of what the figure draws: full-text exclusions and included reports and studies
  if (ftBegun) {
    const drawnExcl = (listSum(P.dbr_excluded) ?? 0) + (listSum(P.other_excluded) ?? 0), studies = trials.size;
    if (drawnExcl !== count.ftExcluded) F.add('', 'full-text exclusions drawn and decided differ', `the flow draws ${drawnExcl} reports excluded at full text; ${count.ftExcluded} are decided so`);
    const reports = num(P.new_reports) ?? num(P.new_studies);
    if (num(P.new_studies) != null && num(P.new_studies) !== studies) F.add('', 'included studies drawn and decided differ', `the flow draws ${P.new_studies} included studies; the decisions give ${studies}`);
    if (reports != null && reports !== count.included) F.add('', 'included reports drawn and decided differ', `the flow draws ${reports} included reports; the decisions give ${count.included}`);
  }
  F.checked = Object.keys(typed).filter(k => !blank(typed[k])).length;

  // ---- the manuscript's numbers --------------------------------------------------------------------------------------------------------
  const X = checks.text;
  // only the boxes the decisions fix: what was identified and removed as duplicates comes from the searches, not from a decision
  if (flowRows) {
    const rows = flowRows.filter(r => BOXES.includes(r.id));
    for (const r of rows) if (!r.ok) X.add('', `a flow number the text states differently: ${r.id}`, r.message);
    X.checked = rows.length;
  }
  else X.skipped = true;

  const out = Object.values(checks).filter(c => !c.skipped).map(c => c.result());
  return { records: papers.length, checks: out, count: out.reduce((a, c) => a + c.count, 0), ok: out.every(c => c.ok),
    summary: { included: count.included, studies: trials.size, excludedAtFullText: count.ftExcluded, notRetrieved: count.notRetrieved } };
}

/**
 * Included studies against each registered analysis (a pooled result of a shown outcome): every one is among the rows the analysis was run
 * on, or the project says why it is not. The reason is recorded when the extraction itself says the value is not reported (a cell read
 * "NR", a value marked not found); a count the paper gives only as a bound, or a study with no row at all, is not a reason.
 */
function analysesCheck(s, A, count, label) {
  let pooled = [];
  try { pooled = pooledResults(s); } catch { return; }
  if (!pooled.length) return;
  A.checked = pooled.length;
  const studies = reviewStudies(s).studies;   // one record per trial: its main report, or its first included report
  const reportsOf = new Map();
  for (const q of s.papers || []) if (q.reportOf) (reportsOf.get(q.reportOf) || reportsOf.set(q.reportOf, []).get(q.reportOf)).push(q.id);
  for (const r of pooled) {
    let I;
    try { I = pooledInputs(s, r.analysis.moderator || '', r.analysis.measure, r.id); } catch (e) { A.add('', `analysis not checked: ${r.name}`, `${r.name}: its inputs could not be read (${e.message})`); continue; }
    const idOf = e => e.paperId ?? e.paper?.id ?? e.id;
    const inRows = new Set(I.ready.map(idOf)), left = new Map();
    for (const e of [...I.incomplete, ...I.invalid]) { const id = idOf(e); (left.get(id) || left.set(id, []).get(id)).push(e); }
    for (const p of studies) {
      // a study counts as in the analysis when it, or a report of the same trial that was included, has a row
      const mates = [p.id, ...(reportsOf.get(p.id) || [])];
      if (mates.some(id => inRows.has(id))) continue;
      const own = mates.flatMap(id => left.get(id) || []);
      if (!own.length) { A.add(p.id, `included, with no row in an analysis: ${r.name}`, `${label(p)}: no row in "${r.name}"`, label(p)); continue; }
      // derived units say why themselves (status and reason); an analysis of the values themselves is read from the values
      const derivedWhy = own.every(u => typeof u.status === 'string');
      const recorded = derivedWhy ? own.every(u => u.status === 'missing' && !blank(u.reason)) : valuesNotReported(s, p, r);
      if (!recorded) A.add(p.id, `left out with no recorded reason: ${r.name}`, `${label(p)}: left out of "${r.name}" (${derivedWhy ? [...new Set(own.map(u => u.reason || u.status))].join('; ') : 'inputs incomplete or invalid'}), and no reason recorded`, label(p));
    }
  }
}

/** Whether every input a study lacks for a pooled result is marked not reported (availability not_found: recorded, not merely empty). */
function valuesNotReported(s, p, r) {
  const slot = r.id, fields = inputFields(r.analysis.measure);
  let missing = 0;
  for (const f of fields) {
    const v = s.values?.[`${p.id}:${fieldFor(f, slot)}`], read = (/^(n|events)(_|$)/.test(f) ? acceptedCount : acceptedNumber)(v);
    if (read == null) { missing++; if (v?.availability !== 'not_found') return false; }
    else if (Number.isNaN(read)) return false;
  }
  return missing > 0;
}

const LEAD = { text: 'manuscript number does not agree: ', flow: 'flow count: ', analyses: 'analysis: ' };
/** The findings as the lines completeness prints: kinds told together, with the records' names: ["N <kind>: a, b, c and M more", …]. */
export function decisionItems(report, { shown = 8 } = {}) {
  const items = [];
  for (const c of report.checks) for (const g of c.kinds) {
    const names = new Map(c.findings.filter(f => f.kind === g.kind && f.id).map(f => [f.id, f.label || f.id]));
    const ids = g.ids.map(id => names.get(id) || id);
    const flow = c.findings.filter(f => f.kind === g.kind && !f.id).map(f => f.message);
    if (!ids.length) { items.push(`${LEAD[c.id] || ''}${flow.join('; ') || g.kind}`); continue; }
    items.push(`${g.count} ${g.count === 1 ? 'record' : 'records'}, ${g.kind}: ${ids.slice(0, shown).join(', ')}${g.count > shown ? ` and ${(g.count - shown).toLocaleString('en')} more` : ''}`);
  }
  return items;
}
