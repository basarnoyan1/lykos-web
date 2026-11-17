// Trial logs: dataset templates for the records a trial keeps beside its
// outcome data (amendment of 2026-09-29) — adverse events, protocol
// deviations, concomitant medications and the screening and enrolment log.
// Each template makes an ordinary dataset (lib/datasets.mjs) whose columns
// carry constraints and whose `rules` are edit checks (lib/data-rules.mjs), so
// the same checks, change log and locks apply. A summary function per log
// gives the counts a report or a CONSORT flow diagram needs.
//
// The severity grade is CTCAE-style (grade 1 mild to 5 death related to the
// event); the grade labels are paraphrased, and a protocol may use its own
// scale. The SAE reporting clock (initial report within 24 hours of
// awareness) is a common sponsor rule, not a universal one: check the protocol.
import { checkAll, parseDate, formatDate } from './data-rules.mjs';

const YES_NO = ['Yes', 'No'];
const col = (id, label, type, rules = {}, extra = {}) => ({ id, label, type, rules, ...extra });
const yn = (id, label, rules = {}) => col(id, label, 'category', { allowed: YES_NO, ...rules });

export const SERIOUSNESS = [
  ['sc_death', 'Death'],
  ['sc_life_threatening', 'Life-threatening'],
  ['sc_hospitalisation', 'Hospitalisation or prolonged hospitalisation'],
  ['sc_disability', 'Persistent or significant disability'],
  ['sc_congenital_anomaly', 'Congenital anomaly or birth defect'],
  ['sc_other_important', 'Other important medical event'],
];
export const SEVERITY_GRADES = [
  [1, 'Grade 1 — mild'],
  [2, 'Grade 2 — moderate'],
  [3, 'Grade 3 — severe'],
  [4, 'Grade 4 — life-threatening'],
  [5, 'Grade 5 — death related to the event'],
];
export const SEVERITY_SCALE_NOTE = 'CTCAE-style grading (1–5); check the version your protocol names';
export const CAUSALITY = ['Not related', 'Unlikely', 'Possible', 'Probable', 'Definite'];
export const RELATED = new Set(['Possible', 'Probable', 'Definite']);
export const EXPECTEDNESS = ['Expected', 'Unexpected'];
export const ACTION_TAKEN = ['None', 'Dose reduced', 'Dose interrupted', 'Drug withdrawn', 'Not applicable', 'Unknown'];
export const AE_OUTCOMES = ['Recovered', 'Recovering', 'Not recovered', 'Recovered with sequelae', 'Fatal', 'Unknown'];
export const DEVIATION_CATEGORIES = ['Eligibility', 'Informed consent', 'Randomisation or allocation', 'Study intervention',
  'Visit schedule', 'Procedures or assessments', 'Safety reporting', 'Data or confidentiality', 'Other'];
export const ROUTES = ['Oral', 'Intravenous', 'Intramuscular', 'Subcutaneous', 'Inhaled', 'Topical', 'Rectal', 'Other'];

export const SAE_CLOCK = { hours: 24, note: 'Initial SAE report within 24 hours of awareness: a common sponsor rule; check your protocol' };

const TEMPLATES = {
  'adverse-events': {
    name: 'Adverse events',
    rowKey: null,
    columns: [
      col('participant_id', 'Participant', 'text', { required: true }),
      col('event_term', 'Event term', 'text', { required: true }),
      col('start_date', 'Start date', 'date', { required: true }),
      col('stop_date', 'Stop date', 'date'),
      yn('ongoing', 'Ongoing'),
      yn('serious', 'Serious', { required: true }),
      ...SERIOUSNESS.map(([id, label]) => yn(id, `Seriousness: ${label}`)),
      col('severity_grade', 'Severity grade (CTCAE-style, 1–5)', 'integer', { required: true, min: 1, max: 5 }, { note: SEVERITY_SCALE_NOTE }),
      col('causality', 'Causality', 'category', { required: true, allowed: CAUSALITY }),
      col('expectedness', 'Expectedness', 'category', { allowed: EXPECTEDNESS }),
      col('action_taken', 'Action taken', 'category', { allowed: ACTION_TAKEN }),
      col('outcome', 'Outcome', 'category', { allowed: AE_OUTCOMES }),
      col('aware_at', 'Site aware (date and time)', 'date'),
      col('reported_at', 'Initial report sent (date and time)', 'date'),
    ],
    rules: [
      { id: 'ae-dates', text: 'stop_date is empty or stop_date >= start_date', message: 'The stop date is before the start date' },
      { id: 'ae-ongoing', text: "if ongoing == 'Yes' then stop_date is empty", message: 'An ongoing event has a stop date' },
      { id: 'ae-serious', text: `if serious == 'Yes' then (${SERIOUSNESS.map(([id]) => `coalesce(${id}, 'No') == 'Yes'`).join(' or ')})`, message: 'A serious event names no seriousness criterion' },
      { id: 'ae-not-serious', text: `if serious == 'No' then not (${SERIOUSNESS.map(([id]) => `coalesce(${id}, 'No') == 'Yes'`).join(' or ')})`, message: 'A seriousness criterion is ticked on a non-serious event' },
      { id: 'ae-fatal', text: "if severity_grade == 5 or sc_death == 'Yes' then outcome == 'Fatal'", message: 'Grade 5 or death, but the outcome is not fatal' },
      { id: 'ae-death', text: "if outcome == 'Fatal' then coalesce(sc_death, 'No') == 'Yes'", message: 'A fatal outcome without the death criterion' },
      { id: 'ae-aware', text: 'aware_at is empty or aware_at >= start_date', message: 'Awareness is before the event started' },
    ],
  },
  deviations: {
    name: 'Protocol deviations',
    columns: [
      col('deviation_date', 'Date', 'date', { required: true }),
      col('participant_id', 'Participant', 'text'),
      col('category', 'Category', 'category', { required: true, allowed: DEVIATION_CATEGORIES }),
      col('description', 'Description', 'text', { required: true }),
      col('classification', 'Major or minor', 'category', { required: true, allowed: ['Major', 'Minor'] }),
      col('corrective_action', 'Corrective action', 'text'),
      col('identified_date', 'Date identified', 'date'),
    ],
    rules: [
      { id: 'dev-identified', text: 'identified_date is empty or identified_date >= deviation_date', message: 'Identified before it happened' },
      { id: 'dev-major-action', text: "if classification == 'Major' then corrective_action is not empty", message: 'A major deviation has no corrective action' },
    ],
  },
  conmeds: {
    name: 'Concomitant medications',
    columns: [
      col('participant_id', 'Participant', 'text', { required: true }),
      col('medication', 'Medication', 'text', { required: true }),
      col('indication', 'Indication', 'text'),
      col('dose', 'Dose', 'number', { min: 0 }),
      col('dose_unit', 'Dose unit', 'text'),
      col('route', 'Route', 'category', { allowed: ROUTES }),
      col('frequency', 'Frequency', 'text'),
      col('start_date', 'Start date', 'date'),
      col('stop_date', 'Stop date', 'date'),
      yn('ongoing', 'Ongoing'),
    ],
    rules: [
      { id: 'cm-dates', text: 'stop_date is empty or start_date is empty or stop_date >= start_date', message: 'The stop date is before the start date' },
      { id: 'cm-ongoing', text: "if ongoing == 'Yes' then stop_date is empty", message: 'An ongoing medication has a stop date' },
      { id: 'cm-unit', text: 'if dose is not empty then dose_unit is not empty', message: 'A dose without its unit' },
    ],
  },
  screening: {
    name: 'Screening and enrolment',
    rowKey: 'screening_id',
    columns: [
      col('screening_id', 'Screening number', 'text', { required: true }),
      col('screened_date', 'Date screened', 'date', { required: true }),
      yn('eligible', 'Eligible', { required: true }),
      col('reason_not_eligible', 'Reason not eligible', 'text'),
      yn('consented', 'Consented'),
      col('reason_not_consented', 'Reason not consented', 'text'),
      yn('randomised', 'Randomised'),
      col('randomised_date', 'Date randomised', 'date'),
      col('participant_id', 'Participant', 'text'),
      col('arm', 'Arm', 'text'),
      yn('withdrawn', 'Withdrawn'),
      col('withdrawal_reason', 'Withdrawal reason', 'text'),
      yn('lost_to_follow_up', 'Lost to follow-up'),
      yn('analysed', 'Analysed'),
    ],
    rules: [
      { id: 'scr-reason', text: "if eligible == 'No' then reason_not_eligible is not empty", message: 'Not eligible, but no reason is given' },
      { id: 'scr-consent', text: "if eligible == 'No' then consented != 'Yes'", message: 'Consented although not eligible' },
      { id: 'scr-randomised', text: "if randomised == 'Yes' then coalesce(consented, 'No') == 'Yes'", message: 'Randomised without consent recorded' },
      { id: 'scr-arm', text: "if randomised == 'Yes' then arm is not empty and randomised_date is not empty", message: 'Randomised without an arm or a date' },
      { id: 'scr-order', text: 'randomised_date is empty or randomised_date >= screened_date', message: 'Randomised before screening' },
      { id: 'scr-withdrawn', text: "if withdrawn == 'Yes' then withdrawal_reason is not empty and coalesce(randomised, 'No') == 'Yes'", message: 'A withdrawal needs a reason and a randomised participant' },
      { id: 'scr-lost', text: "if lost_to_follow_up == 'Yes' then coalesce(randomised, 'No') == 'Yes'", message: 'Lost to follow-up but never randomised' },
    ],
  },
};
export const LOG_KINDS = Object.entries(TEMPLATES).map(([id, t]) => [id, t.name]);

/**
 * A new, empty log as a dataset: { id, name, template, columns (with rules),
 * rows: [], rules, rowKey?, source, at }. `rows` may be given.
 */
export function createLog(kind, { id = null, name = null, rows = [], at = null } = {}) {
  const t = TEMPLATES[kind];
  if (!t) throw new Error(`No log template '${kind}'; use one of ${Object.keys(TEMPLATES).join(', ')}`);
  const when = at || new Date().toISOString();
  const columns = t.columns.map(c => ({ ...c, rules: { ...c.rules, ...(c.rules.allowed ? { allowed: [...c.rules.allowed] } : {}) } }));
  return {
    id: id || `ds${kind.replace(/\W/g, '')}${Date.now().toString(36)}`,
    name: name || t.name,
    template: kind,
    columns,
    rows: rows.map(r => Object.fromEntries(columns.map(c => [c.id, r[c.id] == null ? '' : String(r[c.id])]))),
    rules: t.rules.map(r => ({ ...r })),
    ...(t.rowKey ? { rowKey: t.rowKey } : {}),
    source: { template: kind, importedAt: when },
    at: when,
  };
}

/** Constraint and edit-check issues of a log (its own rules). */
export const checkLog = dataset => checkAll(dataset, dataset.rules);

const yes = v => String(v ?? '').trim().toLowerCase() === 'yes';
const tally = (rows, f) => { const out = {}; for (const r of rows) { const k = f(r); if (k != null && k !== '') out[k] = (out[k] || 0) + 1; } return out; };
const s = v => String(v ?? '').trim();

/** Whether an adverse-event row is serious: marked so, or any seriousness criterion ticked. */
export const isSerious = r => yes(r.serious) || SERIOUSNESS.some(([id]) => yes(r[id]));

/**
 * Adverse-event counts: events and participants overall, by grade (events and
 * participants at their worst grade), by seriousness criterion, by causality,
 * related events (possible, probable, definite), expectedness and outcome.
 * SUSARs are serious, related and unexpected.
 */
export function aeSummary(dataset) {
  const rows = (dataset.rows || []).filter(r => s(r.event_term) || s(r.participant_id));
  const grade = r => { const g = Number(s(r.severity_grade)); return Number.isInteger(g) && g >= 1 && g <= 5 ? g : null; };
  const byGrade = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, missing: 0 };
  for (const r of rows) byGrade[grade(r) ?? 'missing']++;
  const worst = {};
  for (const r of rows) { const p = s(r.participant_id), g = grade(r); if (p && g != null) worst[p] = Math.max(worst[p] || 0, g); else if (p && !(p in worst)) worst[p] = 0; }
  const participantsByWorstGrade = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const g of Object.values(worst)) if (g) participantsByWorstGrade[g]++;
  const serious = rows.filter(isSerious);
  const causality = Object.fromEntries(CAUSALITY.map(c => [c, 0]));
  let causalityMissing = 0;
  for (const r of rows) { const c = CAUSALITY.find(x => x.toLowerCase() === s(r.causality).toLowerCase()); if (c) causality[c]++; else causalityMissing++; }
  const related = rows.filter(r => RELATED.has(CAUSALITY.find(x => x.toLowerCase() === s(r.causality).toLowerCase())));
  return {
    events: rows.length,
    participants: new Set(rows.map(r => s(r.participant_id)).filter(Boolean)).size,
    byGrade,
    participantsByWorstGrade,
    gradeThreePlus: byGrade[3] + byGrade[4] + byGrade[5],
    serious: serious.length,
    seriousParticipants: new Set(serious.map(r => s(r.participant_id)).filter(Boolean)).size,
    bySeriousness: Object.fromEntries(SERIOUSNESS.map(([id]) => [id.replace(/^sc_/, ''), rows.filter(r => yes(r[id])).length])),
    byCausality: { ...causality, missing: causalityMissing },
    related: related.length,
    susar: serious.filter(r => related.includes(r) && s(r.expectedness).toLowerCase() === 'unexpected').length,
    byOutcome: tally(rows, r => s(r.outcome) || 'missing'),
    byTerm: tally(rows, r => s(r.event_term).toLowerCase() || null),
    scaleNote: SEVERITY_SCALE_NOTE,
  };
}

/**
 * The SAE reporting clock for one awareness time: { dueBy, hours, note }.
 * `dueBy` is awareness + `hours` (24 by default), in the same form as the
 * input (a date with a time of day, UTC-naive).
 */
export function saeDue(awareAt, { hours = SAE_CLOCK.hours } = {}) {
  const t = parseDate(awareAt);
  if (t == null) return null;
  return { dueBy: formatDate(t + hours * 3_600_000, { time: true }), hours, note: SAE_CLOCK.note };
}

/**
 * Every serious event with its clock: [{ row, participant, term, awareAt,
 * dueBy, reportedAt, status }], status 'reported' (on time), 'late',
 * 'overdue' (not reported and `now` is past due), 'due', or 'no-awareness'
 * when the awareness time is missing. `now` is a date-time text or ms.
 */
export function saeReports(dataset, { now = null, hours = SAE_CLOCK.hours } = {}) {
  const nowMs = now == null ? null : typeof now === 'number' ? now : parseDate(now);
  return (dataset.rows || []).map((r, row) => ({ r, row })).filter(({ r }) => isSerious(r)).map(({ r, row }) => {
    const due = saeDue(r.aware_at, { hours }), reported = parseDate(r.reported_at);
    let status;
    if (!due) status = 'no-awareness';
    else if (reported != null) status = reported <= parseDate(due.dueBy) ? 'reported' : 'late';
    else status = nowMs != null && nowMs > parseDate(due.dueBy) ? 'overdue' : 'due';
    return { row, participant: s(r.participant_id), term: s(r.event_term), awareAt: s(r.aware_at), dueBy: due?.dueBy || null, reportedAt: s(r.reported_at), status };
  });
}

/** Deviations by category (total, major, minor), by participant and by month. */
export function deviationSummary(dataset) {
  const rows = (dataset.rows || []).filter(r => s(r.category) || s(r.description));
  const byCategory = {};
  for (const r of rows) {
    const c = s(r.category) || 'Uncategorised', k = s(r.classification).toLowerCase();
    const e = (byCategory[c] ||= { total: 0, major: 0, minor: 0 });
    e.total++; if (k === 'major') e.major++; else if (k === 'minor') e.minor++;
  }
  return {
    total: rows.length,
    major: rows.filter(r => s(r.classification).toLowerCase() === 'major').length,
    minor: rows.filter(r => s(r.classification).toLowerCase() === 'minor').length,
    byCategory,
    byParticipant: tally(rows, r => s(r.participant_id) || null),
    byMonth: tally(rows, r => { const t = parseDate(r.deviation_date); return t == null ? null : formatDate(t).slice(0, 7); }),
    withoutCorrectiveAction: rows.filter(r => !s(r.corrective_action)).length,
  };
}

/** Concomitant medications: records, participants taking any, and by medication (participants). */
export function conmedSummary(dataset) {
  const rows = (dataset.rows || []).filter(r => s(r.medication));
  const byMedication = {};
  for (const r of rows) (byMedication[s(r.medication).toLowerCase()] ||= new Set()).add(s(r.participant_id));
  return {
    records: rows.length,
    participants: new Set(rows.map(r => s(r.participant_id)).filter(Boolean)).size,
    ongoing: rows.filter(r => yes(r.ongoing)).length,
    byMedication: Object.fromEntries(Object.entries(byMedication).map(([k, v]) => [k, v.size])),
  };
}

/**
 * The screening log as a CONSORT 2010 flow:
 *   { assessed, excluded: { total, reasons: { 'Not meeting inclusion
 *     criteria', 'Declined to participate', 'Other reasons' }, detail },
 *     randomised, allocated: { arm: n }, withdrawn: { arm: n }, lost: { arm: n },
 *     analysed: { arm: n } | null, totals: { lost, withdrawn, analysed } }
 * `detail` counts the stated reasons. Analysed is null when the log never
 * records it (the analysis population is then the report's to state).
 */
export function consortFlow(dataset) {
  const rows = (dataset.rows || []).filter(r => s(r.screening_id) || s(r.screened_date) || s(r.eligible));
  const randomised = rows.filter(r => yes(r.randomised));
  const excludedRows = rows.filter(r => !yes(r.randomised));
  const reasons = { 'Not meeting inclusion criteria': 0, 'Declined to participate': 0, 'Other reasons': 0 };
  const detail = {};
  for (const r of excludedRows) {
    let group, why;
    if (s(r.eligible).toLowerCase() === 'no') { group = 'Not meeting inclusion criteria'; why = s(r.reason_not_eligible); }
    else if (s(r.consented).toLowerCase() === 'no') { group = 'Declined to participate'; why = s(r.reason_not_consented); }
    else { group = 'Other reasons'; why = s(r.reason_not_consented) || s(r.reason_not_eligible); }
    reasons[group]++;
    if (why) detail[why] = (detail[why] || 0) + 1;
  }
  const byArm = f => { const out = {}; for (const r of randomised) { const a = s(r.arm) || 'Unassigned'; out[a] ||= 0; if (f(r)) out[a]++; } return out; };
  const allocated = byArm(() => true);
  const lost = byArm(r => yes(r.lost_to_follow_up));
  const withdrawn = byArm(r => yes(r.withdrawn));
  const recorded = randomised.some(r => s(r.analysed));
  const analysed = recorded ? byArm(r => yes(r.analysed)) : null;
  const sum = o => o ? Object.values(o).reduce((a, b) => a + b, 0) : null;
  return {
    assessed: rows.length,
    excluded: { total: excludedRows.length, reasons, detail },
    randomised: randomised.length,
    allocated,
    withdrawn,
    withdrawalReasons: tally(randomised.filter(r => yes(r.withdrawn)), r => s(r.withdrawal_reason) || 'Not stated'),
    lost,
    analysed,
    totals: { lost: sum(lost), withdrawn: sum(withdrawn), analysed: sum(analysed) },
  };
}

/** The summary that fits a log's template. */
export function summarizeLog(dataset) {
  switch (dataset?.template) {
    case 'adverse-events': return aeSummary(dataset);
    case 'deviations': return deviationSummary(dataset);
    case 'conmeds': return conmedSummary(dataset);
    case 'screening': return consortFlow(dataset);
  }
  return null;
}
