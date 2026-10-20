// Reviewing what a batch extraction proposed (lib/extract-batch.mjs).
//
// A batch leaves two kinds of waiting work: patient rows in `ipdProposals` and table cells in `proposals`, each stamped
// `qa: clean` or `qa: exception` by the rule check. Nothing in either is data until a person accepts it. This module is what
// the screens call: the rows as a list with their findings, one accept / edit / reject per row or cell, and the one bulk action,
// "accept the clean ones", which a person asks for with a count in front of them. A stamp is not trusted on its own: the rules
// are run again over the row as it is now, so a row edited since its stamp, or a rule changed since, is not accepted as clean.
import { get, update } from '../store.mjs';
import { participantProposals, patchParticipantProposal, acceptParticipantProposal, rejectParticipantProposal, columns as ipdColumns, setColumns, DEFAULT_COLUMNS } from './ipd.mjs';
import { qaPatients, qaCells } from './extract-batch.mjs';
import { PATIENT_RULES, PATIENT_CONVENTIONS, patientRulesOf, PATIENT_EXTRA_COLUMNS, conventionRows } from './patient-rules.mjs';
import { accept as acceptCell } from './proposals.mjs';
import { isLocked } from './fields.mjs';
import { parseCellKey } from './cell-rules.mjs';
import { templateById } from './templates.mjs';
import { ipdColumnSet } from './ipd-import.mjs';

const STATUSES = ['exception', 'unchecked', 'clean'];
const statusOf = p => p?.qa?.status === 'clean' ? 'clean' : p?.qa?.status === 'exception' ? 'exception' : 'unchecked';

// ---- patient rows ---------------------------------------------------------------------------------

/** The proposed patient rows, in the order of the library and then of the case number: { id, study, studyId, caseNo, cells, evidence, status, reasons, escalated, model }. */
export function patientRows(state = get(), { filter = 'all', studyId = null } = {}) {
  const order = new Map((state.papers || []).map((p, i) => [p.id, i])), label = new Map((state.papers || []).map(p => [p.id, p.label || p.title || p.id]));
  const caseNo = r => { const n = Number.parseFloat(r.cells?.case_no); return Number.isFinite(n) ? n : 1e9; };
  return (state.ipdProposals || [])
    .map(p => ({ id: p.id, studyId: p.study_id, study: label.get(p.study_id) || p.study_id || 'Unknown study', caseNo: String(p.cells?.case_no ?? ''), cells: p.cells || {}, evidence: p.evidence || {},
      status: statusOf(p), reasons: p.qa?.reasons || [], escalated: !!p.qa?.escalated, tier: p.qa?.tier || '', model: p.model || '', prior: p.qa?.prior || null }))
    .filter(r => (filter === 'all' || r.status === filter || (filter === 'exceptions' && r.status === 'exception')) && (!studyId || r.studyId === studyId))
    .sort((a, b) => (order.get(a.studyId) ?? 1e9) - (order.get(b.studyId) ?? 1e9) || caseNo({ cells: a.cells }) - caseNo({ cells: b.cells }) || a.id.localeCompare(b.id));
}

/** { total, clean, exception, unchecked } of the proposed patient rows. */
export function patientCounts(state = get()) {
  const out = { total: 0, clean: 0, exception: 0, unchecked: 0 };
  for (const p of state.ipdProposals || []) { out.total++; out[statusOf(p)]++; }
  return out;
}

const taskOf = rows => { const by = new Map(); for (const r of rows) { if (!by.has(r.studyId)) by.set(r.studyId, []); by.get(r.studyId).push(r.id); } return by; };

/** The rows a bulk accept would take: stamped clean, and clean again under the rules as they stand now. */
export function acceptableClean(state = get()) {
  const stamped = patientRows(state, { filter: 'clean' }), ok = [];
  for (const [studyId, ids] of taskOf(stamped)) {
    const live = qaPatients(state, { paperId: studyId, itemIds: ids });
    for (const id of ids) if (live.get(id)?.status === 'clean') ok.push(id);
  }
  return ok;
}

/** The project's patient columns plus any the proposed cells need (extent of resection, imaging, ...), added with the names the master list uses and no analysis role. */
function ensureColumns(keys) {
  const have = new Set(ipdColumns().map(c => c.id));
  const known = new Map([...ipdColumnSet(), ...DEFAULT_COLUMNS, ...PATIENT_EXTRA_COLUMNS].map(c => [c.id, c]));
  const add = [...new Set(keys)].filter(k => !have.has(k) && known.has(k)).map(k => { const { role, ...c } = known.get(k); return c; });
  if (add.length) setColumns([...ipdColumns(), ...add]);
}

/** A patient's label, as the master list words it: the report, and the case when the report has several. */
function labelFor(studyId, cells, state) {
  const paper = (state.papers || []).find(p => p.id === studyId), name = paper?.label || paper?.title || studyId || 'Patient';
  const n = (state.ipdProposals || []).filter(p => p.study_id === studyId).length + (state.participants || []).filter(p => p.study_id === studyId).length;
  return cells.case_no && (cells.case_no !== '1' || n > 1) ? `${name} · case ${cells.case_no}` : name;
}

/** Takes one proposed row into the patients, with its quotes. `edited` are a person's corrections to its cells. Returns the patient's id. */
export function acceptPatientRow(id, { edited = null } = {}) {
  const p = participantProposals().find(x => x.id === id); if (!p) return null;
  ensureColumns(Object.keys({ ...p.cells, ...(edited || {}) }));
  if (!p.cells.label && !edited?.label) patchParticipantProposal(id, x => { x.cells = { label: labelFor(x.study_id, x.cells, get()), ...x.cells }; });
  return acceptParticipantProposal(id, { editedCells: edited && Object.keys(edited).length ? edited : null });
}

export const rejectPatientRow = id => rejectParticipantProposal(id);

/**
 * A person's correction of a proposed row's cells; the rule check is run again and stamped as the person's. Returns the new status.
 * A cell emptied is removed. The quote stays with the cell it was found for.
 */
export function editPatientRow(id, cells) {
  const p = participantProposals().find(x => x.id === id); if (!p) return null;
  const next = { ...p.cells };
  for (const [k, v] of Object.entries(cells || {})) { const t = String(v ?? '').trim(); if (t) next[k] = t; else delete next[k]; }
  patchParticipantProposal(id, x => { x.cells = next; });
  const r = qaPatients(get(), { paperId: p.study_id, itemIds: [id] }).get(id);
  patchParticipantProposal(id, x => { x.qa = { status: r.status, reasons: r.reasons, tier: 'person', escalated: !!x.qa?.escalated, at: new Date().toISOString(), ...(x.qa?.prior ? { prior: x.qa.prior } : {}) }; });
  return r.status;
}

/** Accepts every clean row; returns { accepted, left } (rows that were stamped clean but are not any more stay where they are). */
export function acceptCleanRows() {
  const ids = acceptableClean(), before = patientCounts().clean;
  for (const id of ids) acceptPatientRow(id);
  return { accepted: ids.length, left: before - ids.length };
}

// ---- table cells ----------------------------------------------------------------------------------

const templateOf = columnId => columnId.includes('.') ? columnId.split('.')[0] : 'default';

/** Pending cell proposals a batch stamped, optionally of one table: [{ paperId, columnId, key, status }]. */
export function stampedCells(state = get(), templateId = null) {
  const out = [];
  for (const [key, p] of Object.entries(state.proposals || {})) {
    if (!p?.qa || (p.origin && p.origin !== 'model')) continue;
    const k = parseCellKey(key); if (!k || k.arm) continue;
    if (templateId && templateOf(k.columnId) !== templateId) continue;
    out.push({ paperId: k.paperId, columnId: k.columnId, key, status: statusOf(p) });
  }
  return out;
}

/** { proposed, clean, exception, unchecked } of the stamped cell proposals of a table (all tables when none is named). */
export function cellCounts(state = get(), templateId = null) {
  const out = { proposed: 0, clean: 0, exception: 0, unchecked: 0 };
  for (const c of stampedCells(state, templateId)) { out.proposed++; out[c.status]++; }
  return out;
}

/** The cell proposals a bulk accept would take: stamped clean, unlocked, and clean again under the table's rules as they stand now. */
export function acceptableCells(state = get(), templateId = null) {
  const byStudy = new Map();
  for (const c of stampedCells(state, templateId)) {
    if (c.status !== 'clean' || isLocked(state, c.key)) continue;
    const id = templateOf(c.columnId), k = `${id}\u0000${c.paperId}`;
    if (!byStudy.has(k)) byStudy.set(k, { templateId: id, paperId: c.paperId, items: [] });
    byStudy.get(k).items.push(c);
  }
  const ok = [];
  for (const { templateId: id, paperId, items } of byStudy.values()) {
    if (!templateById(id, state)) continue;
    const live = qaCells(state, id, { paperId, itemIds: items.map(c => c.columnId) });
    for (const c of items) if (live.get(c.columnId)?.status === 'clean') ok.push(c);
  }
  return ok;
}

/** Accepts every clean cell proposal of a table; returns { accepted, skipped } (a value that is not one unambiguous number is skipped, and stays proposed). */
export function acceptCleanCells(templateId = null) {
  const list = acceptableCells(get(), templateId);
  let accepted = 0, skipped = 0;
  for (const c of list) {
    try { acceptCell(c.paperId, c.columnId); if (!get().proposals?.[c.key]) accepted++; else skipped++; } catch { skipped++; }
  }
  return { accepted, skipped };
}

// ---- the patient rules ------------------------------------------------------------------------------

/**
 * The rules with the project's setting: [{ id, kind, label, statement, columns, on, message, text, custom }]. A check ('check') has a
 * `message`, the sentence a person put before what it found ('' for its own); a convention ('convention') has `text`, the sentence the
 * extraction prompt uses (`custom` when the project worded it).
 */
export function patientRuleRows(state = get()) {
  const set = patientRulesOf(state);
  return [...PATIENT_RULES.map(r => ({ id: r.id, kind: 'check', label: r.label, statement: r.explain, columns: r.columns, on: !set.off.includes(r.id), message: set.messages[r.id] || '', text: '', custom: false })),
    ...conventionRows(state).map(c => ({ id: c.id, kind: 'convention', label: c.label, statement: c.statement, columns: c.columns, on: c.on, message: '', text: c.text, custom: c.custom }))];
}

/**
 * Switches a rule or convention on or off, sets the sentence that stands before what a check found (`message`), or the text a convention
 * puts in the extraction request (`text`); '' goes back to the default. Stored with the project.
 */
export function setPatientRule(id, { on = undefined, message = undefined, text = undefined } = {}) {
  const convention = PATIENT_CONVENTIONS.some(r => r.id === id);
  if (!convention && !PATIENT_RULES.some(r => r.id === id)) return false;
  update(s => {
    const c = s.patientRules = { off: [...(s.patientRules?.off || [])], messages: { ...(s.patientRules?.messages || {}) }, conventions: { ...(s.patientRules?.conventions || {}) } };
    if (on !== undefined) c.off = on ? c.off.filter(x => x !== id) : [...new Set([...c.off, id])];
    if (message !== undefined && !convention) { const t = String(message ?? '').trim().slice(0, 240); if (t) c.messages[id] = t; else delete c.messages[id]; }
    if (text !== undefined && convention) { const t = String(text ?? '').trim().slice(0, 400); const own = PATIENT_CONVENTIONS.find(r => r.id === id).text; if (t && t !== own) c.conventions[id] = t; else delete c.conventions[id]; }
    return s;
  });
  return true;
}

/** Runs the rules again over every proposed row a batch has stamped (after the rules changed) and stamps each again; a row a person edited keeps its tier. Returns { clean, exception }. */
export function restampPatientRows() {
  const out = { clean: 0, exception: 0 };
  for (const [studyId, ids] of taskOf(patientRows(get()).filter(r => r.status !== 'unchecked'))) {
    const live = qaPatients(get(), { paperId: studyId, itemIds: ids });
    for (const [id, r] of live) {
      out[r.status === 'clean' ? 'clean' : 'exception']++;
      patchParticipantProposal(id, x => { x.qa = { ...(x.qa || {}), status: r.status, reasons: r.reasons, tier: x.qa?.tier || 'cheap', escalated: !!x.qa?.escalated, at: new Date().toISOString() }; });
    }
  }
  return out;
}

export { STATUSES };
