// The protocol's registration, governance and SPIRIT parts, and the reporting
// checklist choice, as stored in the project: the glue between the pure modules
// (lib/registration.mjs, lib/governance.mjs, lib/spirit-schedule.mjs,
// lib/checklist-choice.mjs) and the views that edit them (views/protocol-parts.mjs,
// views/reporting.mjs). Plan §A5 and the "Protocol, registration and governance"
// amendment.
//
//   state.registration   { form, values: { [formId]: { [fieldId]: text } },
//                          dates: { registeredAt, firstEnrolmentAt, primaryCompletionAt } }
//   state.ethics         lib/governance.mjs normalizeEthics
//   state.sap            { analyses: [{ outcome, method }] }
//   state.spiritSchedule lib/spirit-schedule.mjs
//   state.checklistChoice { checklist, extensions, addons, abstract, protocol }
//
// The registry ID stays at state.paper.registration. A value typed into a
// registration field is kept beside what the project derives, never over it:
// clearing the typed value brings the derived one back.
//
// Pure: nothing here imports the store or a view.
import { derive, formFor, formById } from './registration.mjs';
import { plannedAnalyses } from './governance.mjs';
import { DATE_KEYS, normalizeRegistration, sapRows, normalizeChecklistChoice, ethicsAttention, normalizeGovernance } from './governance-state.mjs';
export { normalizeRegistration, sapRows, normalizeChecklistChoice, ethicsAttention, normalizeGovernance };
import { blankSchedule, addRow, addTimepoint, removeRow, removeTimepoint, moveRow, moveTimepoint, updateRow, updateTimepoint, setMark } from './spirit-schedule.mjs';
import { choicesFor } from './checklist-choice.mjs';
import { EXTRA_CHECKLISTS } from './checklists-extra.mjs';
import { researchType } from './workflow.mjs';

const has = v => !!String(v ?? '').trim();
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;

// ---- registration ---------------------------------------------------------------

/** The form in use: the stored one when the type offers it, else the type's first. */
export function registrationForm(state) {
  const offered = formFor(state?.project?.researchType);
  const saved = normalizeRegistration(state?.registration).form;
  return offered.find(f => f.id === saved)?.id || offered[0]?.id || '';
}

/**
 * The state as lib/registration.mjs reads it: the dates kept under
 * `registration.dates` are also where `derive` looks for them.
 */
export function derivingState(state) {
  const reg = normalizeRegistration(state?.registration);
  return { ...(state || {}), registration: { ...reg, ...Object.fromEntries(DATE_KEYS.filter(k => has(reg.dates[k])).map(k => [k, reg.dates[k]])) } };
}

/**
 * Each field's value for a form: `{ fieldId: { value, from, derived } }`, the
 * typed value when there is one (`from: 'edited'`), else the derived one.
 */
export function registrationValues(state, formId) {
  const d = derive(derivingState(state), formId).values;
  const typed = normalizeRegistration(state?.registration).values[formId] || {};
  const out = {};
  for (const [id, x] of Object.entries(d)) out[id] = { value: x.value, from: x.from, derived: x.value };
  for (const [id, t] of Object.entries(typed)) if (has(t)) out[id] = { value: t, from: 'edited', derived: d[id]?.value ?? '' };
  return out;
}

/** A new registration record with one field's typed value set; an empty value removes it. */
export function setRegistrationValue(registration, formId, fieldId, text) {
  const reg = normalizeRegistration(registration);
  const form = { ...(reg.values[formId] || {}) };
  if (has(text)) form[fieldId] = String(text); else delete form[fieldId];
  return { ...reg, values: { ...reg.values, [formId]: form } };
}

/** A new registration record with one date set (ISO day, or '' to clear). */
export function setRegistrationDate(registration, key, iso) {
  if (!DATE_KEYS.includes(key)) throw new Error(`Unknown registration date: ${key}`);
  const reg = normalizeRegistration(registration);
  return { ...reg, dates: { ...reg.dates, [key]: String(iso || '') } };
}

/** The form's fields grouped for display, in form order: `[{ group, fields }]`. */
export function fieldGroups(formId) {
  const form = formById(formId);
  if (!form) return [];
  const groups = [];
  for (const f of form.fields) {
    let g = groups.find(x => x.group === f.group);
    if (!g) groups.push(g = { group: f.group, fields: [] });
    g.fields.push(f);
  }
  return groups;
}

const SOURCE_LABELS = [
  [/^edited$/, 'Edited'], [/^protocol\.criteria/, 'Eligibility criteria'], [/^protocol\.sampleSize/, 'Sample size'],
  [/^protocol\.title/, 'Research question'], [/^protocol\./, 'Research question'], [/^paper\.authors/, 'Research team'],
  [/^paper\.registeredReport/, 'Registered Report'], [/^paper\.registration/, 'Registry ID'], [/^paper\./, 'Publication'],
  [/^registration\.(registeredAt|firstEnrolmentAt|primaryCompletionAt)/, 'Registration dates'], [/^registration\./, 'Registration'],
  [/^declarations\./, 'Declarations'], [/^ethics/, 'Ethics and governance'], [/^outcomes/, 'Outcomes'], [/^searches/, 'Search log'],
  [/^settings/, 'Analysis settings'], [/^sap\./, 'Statistical analysis plan'], [/^(appraisalTool|project\.researchType)/, 'Research type'],
  [/^protocolVersions/, 'Protocol versions'],
];
/** Where a derived value came from, as the part of the project a reader knows it by. */
export const sourceLabel = from => SOURCE_LABELS.find(([re]) => re.test(String(from || '')))?.[1] || String(from || '');

// ---- ethics ---------------------------------------------------------------------

/** Deadline items as to-do entries `{ text, due }`. */
export const deadlineTodos = items => items.map(d => ({ text: d.text, due: d.due || '' }));

// ---- statistical analysis plan ----------------------------------------------------

/**
 * The plan's rows once a statistical analysis plan is generated: what is stored,
 * or, when nothing is, one row per outcome from the protocol (lib/governance.mjs
 * plannedAnalyses). Stored rows are never replaced.
 */
export function sapOnGenerate(state) {
  const rows = sapRows(state);
  return { ...(obj(state?.sap) || {}), analyses: rows.length ? rows : plannedAnalyses(state).map(a => ({ outcome: a.outcome, method: a.method })) };
}

export function addSapRow(sap, row = {}) {
  const rows = sapRows({ sap });
  return { ...(obj(sap) || {}), analyses: [...rows, { outcome: String(row.outcome ?? ''), method: String(row.method ?? '') }] };
}
export function updateSapRow(sap, index, patch) {
  const rows = sapRows({ sap });
  return { ...(obj(sap) || {}), analyses: rows.map((r, i) => i === index ? { ...r, ...patch } : r) };
}
export function removeSapRow(sap, index) {
  const rows = sapRows({ sap });
  return { ...(obj(sap) || {}), analyses: rows.filter((_, i) => i !== index) };
}

/** What `sapDeviations` compares against: the stored rows, else the plan the protocol implies. */
export const plannedFor = state => sapRows(state).length ? sapRows(state) : plannedAnalyses(state);

// ---- SPIRIT schedule --------------------------------------------------------------

/** Whether the project is a trial whose protocol reports against SPIRIT. */
export function spiritOffered(state) {
  const id = researchType(state || {}).id;
  return id === 'rct' || choicesFor(id).protocol === 'spirit-2013';
}

/** The stored schedule, or the usual starting shape. */
export function scheduleOf(state) {
  const s = obj(state?.spiritSchedule);
  return s && Array.isArray(s.timepoints) && Array.isArray(s.rows) ? s : blankSchedule();
}

/**
 * One edit to the grid, as the view sends it:
 * `{ op: 'toggle', row, timepoint }`, `{ op: 'add-row', section }`,
 * `{ op: 'rename-row', row, label }`, `{ op: 'move-row', row, delta }`,
 * `{ op: 'remove-row', row }`, `{ op: 'add-timepoint' }`,
 * `{ op: 'timepoint', timepoint, label?, window? }`,
 * `{ op: 'move-timepoint', timepoint, delta }`, `{ op: 'remove-timepoint', timepoint }`.
 */
export function applyScheduleOp(schedule, e) {
  switch (e?.op) {
    case 'toggle': return setMark(schedule, e.row, e.timepoint);
    case 'add-row': return addRow(schedule, { section: e.section, label: e.label || '' });
    case 'rename-row': return updateRow(schedule, e.row, { label: String(e.label ?? '') });
    case 'move-row': return moveRow(schedule, e.row, Number(e.delta) || 0);
    case 'remove-row': return removeRow(schedule, e.row);
    case 'add-timepoint': return addTimepoint(schedule, { label: e.label || `t${(schedule.timepoints || []).length}`, window: e.window || '' });
    case 'timepoint': {
      const patch = {};
      if (e.label != null) patch.label = String(e.label);
      if (e.window != null) patch.window = String(e.window);
      return updateTimepoint(schedule, e.timepoint, patch);
    }
    case 'move-timepoint': return moveTimepoint(schedule, e.timepoint, Number(e.delta) || 0);
    case 'remove-timepoint': return removeTimepoint(schedule, e.timepoint);
    default: throw new Error(`Unknown schedule edit: ${e?.op}`);
  }
}

/** Appends blocks at the manuscript's end, returning a new manuscript. */
export function appendToManuscript(manuscript, blocks) {
  const m = obj(manuscript) || {};
  return { ...m, blocks: [...(Array.isArray(m.blocks) ? m.blocks : []), ...blocks], snapshot: m.snapshot || {} };
}

// ---- checklist choice ----------------------------------------------------------------

/** A new choice with one extension or add-on switched on or off. */
export function toggleChoice(choice, kind, id, on) {
  const c = normalizeChecklistChoice(choice);
  if (kind === 'abstract' || kind === 'protocol') return { ...c, [kind]: !!on };
  if (kind !== 'extensions' && kind !== 'addons') throw new Error(`Unknown checklist choice: ${kind}`);
  const list = c[kind].filter(x => x !== id);
  return { ...c, [kind]: on ? [...list, id] : list };
}

/**
 * The extra checklists a project reports against beside its main one, as
 * Reporting's rail sections: `[{ id: 'abstract'|'protocol', title, checklist }]`.
 */
export function extraChecklists(state) {
  const choices = choicesFor(researchType(state || {}).id);
  const c = normalizeChecklistChoice(state?.checklistChoice);
  return ['abstract', 'protocol'].filter(k => c[k] && EXTRA_CHECKLISTS[choices[k]])
    .map(k => ({ id: `${k}-checklist`, kind: k, title: k === 'abstract' ? 'Abstract checklist' : 'Protocol checklist', checklist: EXTRA_CHECKLISTS[choices[k]] }));
}

// ---- the store ---------------------------------------------------------------------
