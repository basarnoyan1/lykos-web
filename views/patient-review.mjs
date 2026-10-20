// Patients: the pages that sit beside the patient table when a batch has run (lib/extract-batch.mjs):
//   Intake    the case papers dropped in and what each waits for (views/patient-intake.mjs); always there, with no batch needed
//   Proposed  the patient rows a model read from the reports, each with the quote behind every cell and what the rules found;
//             accept, edit or reject one at a time, or accept all the clean ones in one counted, confirmed step
//   Report    what the last batches read (patient rows, and the table cells Extraction filled), which rules fired most, the exceptions that
//             still wait, and the exports; Extraction's earlier runs open it, and it goes back there
//   Rules     the patient rules and conventions of this project: on or off, the sentence a check puts before what it found, the text the prompt uses
// Nothing here accepts a row on its own: a row joins the patients only when a person presses Accept on it, or confirms Accept clean.
import { get } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiSettingsRow } from '../lib/ui-actions.mjs';
import { editorRows, wireEditorRows, formField, uiLink } from '../lib/ui-components.mjs';
import { num, ago } from '../lib/dates.mjs';
import { columns as ipdColumns } from '../lib/ipd.mjs';
import { withPatientColumns } from '../lib/patient-rules.mjs';
import { patientRows, patientCounts, acceptableClean, acceptPatientRow, rejectPatientRow, editPatientRow, patientRuleRows, setPatientRule, restampPatientRows } from '../lib/batch-review.mjs';
import { batchRuns, recordLine } from '../lib/batch-report.mjs';
import { mountReportBody, exportMaster, exportExceptionList } from './batch-report.mjs';
import { confirmAcceptCleanRows } from './batch-proposals.mjs';
import { intakeHtml, wireIntake, resetIntake, clearIntakeNote } from './patient-intake.mjs';
import { askText } from '../lib/dialog.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { researchType } from '../lib/workflow.mjs';
import { exportRulesFile } from '../lib/extract-batch.mjs';
import { ipdColumnSet } from '../lib/ipd-import.mjs';

const ui = { tab: 'patients', filter: 'all', search: '', open: null, page: undefined, rulePage: undefined, ruleOpen: null, record: null, from: null, note: '' };
export const reviewTab = () => ui.tab;
export function setReviewTab(tab) { if (ui.tab !== tab) clearIntakeNote(); ui.tab = ['patients', 'intake', 'review', 'report', 'rules'].includes(tab) ? tab : 'patients'; ui.note = ''; ui.from = null; }
export function resetReview() { resetIntake(); Object.assign(ui, { tab: 'patients', filter: 'all', search: '', open: null, page: undefined, rulePage: undefined, ruleOpen: null, record: null, from: null, note: '' }); }

/** Is there anything of a batch to show: rows waiting, or a batch that ran. */
export const hasBatchWork = (state = get()) => !!(state.ipdProposals || []).length || batchRuns(state, { mode: 'patients' }).length > 0;

/** The patient table and the pages of a batch: the title bar's picker (views/patients.mjs page()). */
export const PAGES = [['patients', 'Patients'], ['intake', 'Intake'], ['review', 'Proposed'], ['report', 'Report'], ['rules', 'Rules']];

/** Opens the page of a proposed row (the report's exceptions and the Proposals tab come here). */
export function focusRow(id) { const r = (get().ipdProposals || []).find(p => p.id === id); if (!r) return false; Object.assign(ui, { tab: 'review', filter: 'all', search: '', open: id, page: undefined, note: '' }); return true; }
/** Opens the Report page on a batch; `from` names the page that sent the reader ('extraction'), which the title bar's Back returns to. */
export function focusReport(id = null, { from = null } = {}) { ui.tab = 'report'; ui.record = id; ui.note = ''; ui.from = from; }
/** The page the Report was opened from, or null. */
export const reportFrom = () => ui.tab === 'report' ? ui.from : null;
export const leaveReport = () => { ui.from = null; };

// ---- proposed rows ---------------------------------------------------------------------------------------------------

const FIRST = ['eor', 'imaging', 'time', 'event', 'outcome', 'adjuvant', 'death'];
const STATUS_TEXT = { clean: 'Clean', exception: 'To review', unchecked: 'Unchecked' };
const KNOWN = new Map([...ipdColumnSet(), ...withPatientColumns([])].map(c => [c.id, c.name]));
const nameOf = id => { const c = withPatientColumns(ipdColumns()).find(x => x.id === id); return c?.name || c?.label || KNOWN.get(id) || id; };
const matches = (r, q) => !q || [r.study, r.caseNo, ...Object.values(r.cells)].join(' ').toLowerCase().includes(q.toLowerCase());

const quoteLine = (e, key) => {
  const q = (e || []).find(x => x?.quote);
  if (!q) return '<span class="meta ipd-rv-none">No quote</span>';
  return `${uiLink({ label: q.page ? `p. ${q.page}` : 'Open', icon: 'file-pdf', title: 'Open the report at this quote', attrs: { 'data-rv-quote': key } })}<span class="ipd-rv-quote">${esc(q.quote)}</span>`;
};

function rowEditor(r) {
  const keys = [...FIRST, ...Object.keys(r.cells).filter(k => !FIRST.includes(k) && !['label', 'study_id'].includes(k))].filter((k, i, all) => all.indexOf(k) === i && (FIRST.includes(k) || r.cells[k] != null));
  const findings = r.reasons.length ? uiList({ id: 'ipd-rv-findings', label: 'Findings', rows: r.reasons.map(x => uiRow({ main: { html: esc(x.label || (x.source === 'evidence' ? 'No quote located' : 'Check')), detail: [esc(x.message)], wrap: true } })) })
    : `<p class="meta">${r.status === 'clean' ? 'No rule found a problem' : 'Not checked yet'}</p>`;
  const cells = keys.map(k => `<div class="ipd-rv-cell">${formField(nameOf(k), `<input data-rv-cell="${esc(k)}" value="${esc(r.cells[k] ?? '')}" autocomplete="off">`)}<div class="ipd-rv-evidence">${quoteLine(r.evidence[k], k)}</div></div>`).join('');
  const prior = r.prior ? `<p class="meta">A stronger model changed ${esc(Object.keys(r.prior.cells || {}).filter(k => String(r.prior.cells[k]) !== String(r.cells[k] ?? '')).map(nameOf).join(', ') || 'nothing')}. It read: ${esc(Object.keys(r.prior.cells || {}).filter(k => String(r.prior.cells[k]) !== String(r.cells[k] ?? '')).map(k => `${r.prior.cells[k]}`).join(', '))}</p>` : '';
  return `<div class="ipd-rv-editor" data-rv-id="${esc(r.id)}">${findings}${prior}<div class="ipd-rv-cells">${cells}</div>
    ${uiBar({ kind: 'foot', label: `Patient row ${r.caseNo || ''}`.trim(), id: 'ipd-rv-foot', actions: [
      { id: 'ipd-rv-check', label: 'Check again', icon: 'refresh', attrs: { 'data-rv-check': r.id } },
      { id: 'ipd-rv-reject', label: 'Reject', icon: 'close', attrs: { 'data-rv-reject': r.id } },
      { id: 'ipd-rv-accept', label: 'Accept', icon: 'check', role: 'primary', attrs: { 'data-rv-accept': r.id } }] })}</div>`;
}

function reviewHtml(state) {
  const counts = patientCounts(state), rows = patientRows(state, { filter: ui.filter }).filter(r => matches(r, ui.search));
  const ready = counts.clean ? acceptableClean(state).length : 0;
  const list = editorRows({ id: 'ipd-rv-rows', label: 'Proposed patients', items: rows, key: r => r.id, title: r => `${r.study}${r.caseNo ? `, case ${r.caseNo}` : ''}`, noun: 'patients',
    columns: [{ head: 'Patient', cell: r => `<span class="ipd-rv-name">${esc(r.study)}${r.caseNo ? ` · case ${esc(r.caseNo)}` : ''}</span>` },
      { head: 'Resection', cell: r => esc(r.cells.eor || '') }, { head: 'Follow-up', num: true, cell: r => esc(r.cells.time || '') }, { head: 'Event', cell: r => esc(r.cells.event === '1' ? 'Yes' : r.cells.event === '0' ? 'No' : r.cells.event || '') },
      { head: 'Checked', cell: r => esc(`${r.status === 'exception' ? `${r.reasons[0]?.label || 'To review'}${r.reasons.length > 1 ? ` +${r.reasons.length - 1}` : ''}` : STATUS_TEXT[r.status]}${r.escalated ? ' · rechecked' : ''}`) }],
    selected: ui.open && rows.some(r => r.id === ui.open) ? ui.open : null, page: ui.page, editor: rowEditor,
    empty: emptyState({ icon: 'patients', title: counts.total ? 'No rows match' : 'No proposed patients', size: 'inline' }) });
  return `<div class="panel ipd-panel" id="ipd-body">
    ${uiBar({ kind: 'head', label: 'Proposed patients', id: 'ipd-rv-head', lead: { title: 'Proposed patients' }, message: { id: 'ipd-rv-count', text: counts.total ? `${num(counts.clean)} clean · ${num(counts.exception)} to review${counts.unchecked ? ` · ${num(counts.unchecked)} unchecked` : ''}` : '' },
      filters: [{ type: 'select', id: 'ipd-rv-filter', label: 'Show', value: ui.filter, options: [['all', 'All rows'], ['exception', 'To review'], ['clean', 'Clean'], ['unchecked', 'Unchecked']] },
        { type: 'search', id: 'ipd-rv-search', label: 'Filter proposed patients', placeholder: 'Filter', value: ui.search }],
      actions: [{ id: 'ipd-rv-clean', label: ready ? `Accept clean (${num(ready)})` : 'Accept clean', icon: 'check-square', role: 'primary', disabled: !ready }] })}
    <div class="ipd-cq">${list.html}</div></div>`;
}

function wireReview(el, ctx) {
  const rerender = note => { ctx.rerender(note); ctx.refreshCounts?.(); };
  const state = () => get();
  const redraw = () => ctx.rerender();
  wireEditorRows(el, 'ipd-rv-rows', { onSelect: k => { ui.open = k; redraw(); }, onPage: n => { ui.page = n; ui.open = null; redraw(); } });
  el.querySelector('#ipd-rv-filter').onchange = e => { ui.filter = e.target.value; ui.page = 1; ui.open = null; redraw(); };
  const search = el.querySelector('#ipd-rv-search'); let timer = 0;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { if (!search.isConnected) return; ui.search = search.value; ui.page = 1; ui.open = null; redraw(); const again = document.querySelector('#ipd-rv-search'); again?.focus(); again?.setSelectionRange(again.value.length, again.value.length); }, 150); };
  el.querySelector('#ipd-rv-clean').onclick = async () => {
    const note = await confirmAcceptCleanRows(); if (!note) return;
    ui.open = null; ui.page = 1; rerender(note);
  };
  const open = el.querySelector('.ipd-rv-editor'); if (!open) return;
  const id = open.dataset.rvId;
  const values = () => Object.fromEntries([...open.querySelectorAll('[data-rv-cell]')].map(i => [i.dataset.rvCell, i.value]));
  const changed = () => { const row = (state().ipdProposals || []).find(p => p.id === id); return Object.fromEntries(Object.entries(values()).filter(([k, v]) => String(v).trim() !== String(row?.cells?.[k] ?? ''))); };
  // after a row leaves the list, the next one opens, so a reviewer moves down the list without hunting for it
  const next = () => { const rows = patientRows(state(), { filter: ui.filter }).filter(r => matches(r, ui.search)); const at = rows.findIndex(r => r.id === id); return (rows[at + 1] || rows[at - 1] || {}).id || null; };
  open.querySelectorAll('[data-rv-quote]').forEach(b => b.onclick = () => {
    const row = (state().ipdProposals || []).find(p => p.id === id), q = (row?.evidence?.[b.dataset.rvQuote] || []).find(x => x?.quote);
    if (q) ctx.openDocument?.(row.study_id, { page: Number(q.page) || 1, rects: q.rects || [], quote: q.quote, kind: 'text' });
  });
  open.querySelector('#ipd-rv-check').onclick = () => { const edits = changed(); const status = Object.keys(edits).length ? editPatientRow(id, edits) : editPatientRow(id, {}); rerender(status === 'clean' ? 'No rule found a problem' : 'A rule still finds a problem'); };
  open.querySelector('#ipd-rv-reject').onclick = () => { const to = next(); rejectPatientRow(id); ui.open = to; rerender('Row rejected'); };
  open.querySelector('#ipd-rv-accept').onclick = () => {
    const edits = changed(), to = next();
    try { acceptPatientRow(id, { edited: Object.keys(edits).length ? edits : null }); } catch (err) { rerender(String(err?.message || err).slice(0, 120)); return; }
    ui.open = to; rerender('Patient added');
  };
}

// ---- the rules -------------------------------------------------------------------------------------------------------
// One settings row per rule of this project. A check has On/Off and the sentence it puts before what it found; a convention has On/Off and
// the text the extraction prompt uses. Everything is stored with the project and written by Write rules file.

function ruleRow(r, i) {
  const own = r.kind === 'convention' ? r.custom : !!r.message;
  const desc = r.kind === 'convention' ? r.text : r.message ? `${r.message}. ${r.statement}` : r.statement;
  return uiSettingsRow({ id: `ipd-rl-${i}`, label: r.label, description: desc, attrs: { 'data-rule-row': r.id },
    controls: { id: `ipd-rl-${i}-bar`, label: r.label, filters: [{ type: 'check', id: `ipd-rl-${i}-on`, label: 'On', value: r.on, attrs: { 'data-rule-on': r.id } }],
      actions: [{ id: `ipd-rl-${i}-edit`, label: r.kind === 'convention' ? 'Edit text' : 'Edit message', attrs: { 'data-rule-edit': r.id } }],
      overflow: own ? [{ id: `ipd-rl-${i}-reset`, label: r.kind === 'convention' ? 'Use the default text' : 'Use the default message', attrs: { 'data-rule-reset': r.id } }] : [] } });
}

function rulesHtml(state) {
  const rules = patientRuleRows(state), on = rules.filter(r => r.on).length;
  const part = kind => rules.map((r, i) => [r, i]).filter(([r]) => r.kind === kind).map(([r, i]) => ruleRow(r, i)).join('');
  return `<div class="panel ipd-panel" id="ipd-body">
    ${uiBar({ kind: 'head', label: 'Patient rules', id: 'ipd-rule-head', lead: { title: 'Patient rules' }, status: { id: 'ipd-rule-count', text: `${on} of ${rules.length} on`, ch: 12 }, message: { id: 'ipd-rule-note', text: ui.note },
      actions: [{ id: 'ipd-rule-file', label: 'Write rules file', icon: 'download' }] })}
    <div class="ipd-rl">
      <h3 class="ipd-rl-h">Checks over a row</h3>${part('check')}
      <h3 class="ipd-rl-h">Conventions for the model</h3>${part('convention')}</div></div>`;
}

function wireRules(el, ctx) {
  const rules = patientRuleRows(get()), byId = id => rules.find(r => r.id === id);
  const done = note => { const r = restampPatientRows(); ui.note = note || (r.clean + r.exception ? `Rows checked again: ${num(r.clean)} clean, ${num(r.exception)} to review` : 'Saved'); ctx.rerender(); ctx.refreshCounts?.(); };
  el.querySelectorAll('[data-rule-on]').forEach(box => box.onchange = () => { setPatientRule(box.dataset.ruleOn, { on: box.checked }); done(); });
  el.querySelectorAll('[data-rule-edit]').forEach(b => b.onclick = async () => {
    const r = byId(b.dataset.ruleEdit); if (!r) return;
    const convention = r.kind === 'convention';
    const value = await askText(`${r.label}: ${convention ? 'text for the prompt' : 'message'}`, { value: convention ? r.text : r.message, placeholder: convention ? '' : r.statement, confirm: 'Save' });
    if (value == null) return;
    setPatientRule(r.id, convention ? { text: value } : { message: value }); done();
  });
  el.querySelectorAll('[data-rule-reset]').forEach(b => b.onclick = () => { const r = byId(b.dataset.ruleReset); setPatientRule(r.id, r.kind === 'convention' ? { text: '' } : { message: '' }); done(); });
  el.querySelector('#ipd-rule-file').onclick = async () => {
    const folder = activeFolder(), state = get();
    if (!folder) { ui.note = 'Open a project folder to write the rules file'; ctx.rerender(); return; }
    try {
      const r = await exportRulesFile(folder, state, { typeId: researchType(state).id });
      ui.note = r.failed.length ? `Not written: ${r.failed[0].error}` : r.written.length ? `Wrote ${r.written[0]}` : 'Unchanged since the last version in the folder';
    } catch (err) { ui.note = `Not written: ${String(err?.message || err).slice(0, 120)}`; }
    ctx.rerender();
  };
}

// ---- the report ------------------------------------------------------------------------------------------------------

const KIND = rec => rec.mode === 'patients' ? 'patient rows' : 'table cells';
function reportHtml(state) {
  const records = batchRuns(state);
  if (!records.length) return `<div class="panel ipd-panel" id="ipd-body">${emptyState({ icon: 'patients', title: 'No batch report', detail: 'Fill patient rows or a table from Extraction; each batch is kept here.' })}</div>`;
  const rec = records.find(r => r.id === ui.record) || records[0];
  return `<div class="panel ipd-panel" id="ipd-body">
    ${uiBar({ kind: 'head', label: 'Batch report', id: 'ipd-rp-head', lead: { title: 'Report' }, message: { id: 'ipd-rp-note', text: ui.note || recordLine(rec) },
      filters: records.length > 1 ? [{ type: 'select', id: 'ipd-rp-pick', label: 'Batch', value: rec.id, options: records.map(r => [r.id, `${new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ')} · ${KIND(r)} · ${ago(r.startedAt)}`]) }] : [],
      actions: [{ id: 'ipd-rp-exceptions', label: 'Exceptions list', icon: 'download' }, { id: 'ipd-rp-master', label: 'Master list' }] })}
    <div class="ipd-rp-body" id="ipd-rp-host"></div></div>`;
}

function wireReport(el, ctx) {
  const records = batchRuns(get()); if (!records.length) return;
  const rec = records.find(r => r.id === ui.record) || records[0];
  el.querySelector('#ipd-rp-pick')?.addEventListener('change', e => { ui.record = e.target.value; ui.note = ''; ctx.rerender(); });
  const say = text => { ui.note = text; const n = el.querySelector('#ipd-rp-note'); if (n) n.textContent = text; };
  el.querySelector('#ipd-rp-master').onclick = async () => say(await exportMaster(rec));
  el.querySelector('#ipd-rp-exceptions').onclick = async () => say(await exportExceptionList(rec));
  mountReportBody(el.querySelector('#ipd-rp-host'), rec, { onOpen: async e => {
    if (!e) return;
    if (rec.mode === 'patients') { if (focusRow(e.itemId)) ctx.rerender(); return; }
    // a table's exception is a cell of Extraction (views/runs.mjs); loaded when asked for, as runs.mjs imports this module
    await (await import('./runs.mjs')).openException(e, rec, ctx);
  } });
}

/** Draws the page for the current tab into `el` (a tab other than the patient table). */
export function renderPage(el, ctx) {
  const state = get();
  const body = ui.tab === 'intake' ? intakeHtml(state) : ui.tab === 'review' ? reviewHtml(state) : ui.tab === 'rules' ? rulesHtml(state) : reportHtml(state);
  el.innerHTML = body;
  if (ui.tab === 'intake') wireIntake(el, ctx, { rules: () => { setReviewTab('rules'); ctx.rerender(); }, proposed: id => { const p = (get().ipdProposals || []).find(x => x.study_id === id); if (p) focusRow(p.id); else setReviewTab('review'); ctx.rerender(); }, pdf: id => ctx.openDocument?.(id, { page: 1, rects: [], quote: '', kind: 'text' }) });
  else if (ui.tab === 'review') wireReview(el, ctx);
  else if (ui.tab === 'rules') wireRules(el, ctx);
  else wireReport(el, ctx);
}
