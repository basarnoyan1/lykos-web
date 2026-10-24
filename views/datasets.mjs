import { REGISTRY } from './registry.mjs';
import { replaceRegions } from '../lib/local-region.mjs';
// Datasets: the researcher's own tables (lib/datasets.mjs), one per rail item,
// the chosen one as a paged grid. Cells are edited in place; a column's type
// and rules are set from its header. Import reads .xlsx, .csv and .tsv, and a
// REDCap data dictionary; export writes CSV, Excel, Word and REDCap.
//
// Data management (amendment of 2026-09-29; views/dataset-manage.mjs): every
// edit goes through the change log, rows can be locked and verified, cells
// that fail a column rule or an edit check are marked, and a trial log shows
// its summary above the grid.
import { get, subscribe, projectGeneration } from '../store.mjs';
import { parseDatasetFile, MAX_IMPORT_BYTES } from '../lib/dataset-import.mjs';
import * as jobs from '../lib/jobs.mjs';
import { datasets, datasetById, addDataset, removeDataset, renameDataset, setColumnType, setCell, addRow, removeRows, toRows, validate, cellValue, COLUMN_TYPES,
  appendRows, lockDatasetRows, unlockDatasetRows, verifyDatasetRows, setDataSetting, addDatasets, fromRows } from '../lib/datasets.mjs';
import { rowIdOf, isLocked, isVerified, managementSummary } from '../lib/data-rules.mjs';
import { createLog, LOG_KINDS } from '../lib/trial-logs.mjs';
import { parseRecords, toDictionary, toRecords } from '../lib/redcap.mjs';
import { issueIndex, hasChecks, recordsToAppend, rulesLine } from '../lib/data-management.mjs';
import { showColumnRules, showChecks, showIssues, showChangeLog, manageSections, startDeidentify, deidentifyOpen, closeDeidentify, deidentifyPageSpec, renderDeidentify, logSummaryHtml, who } from './dataset-manage.mjs';
import { writeXlsx } from '../lib/xlsx-write.mjs';
import { writeTablesDocx } from '../lib/docx-write.mjs';
import { decodeImport } from '../lib/import-safety.mjs';
import { pick } from './library.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { saveFile } from '../lib/save.mjs';
import { ask, askText } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiStatusLine } from '../lib/ui-actions.mjs';
import { tableRegion, cueRegions } from '../lib/ui-components.mjs';
import { day, plural } from '../lib/dates.mjs';
import { PATIENT_SOURCE, patientDataset } from '../lib/dataset-analysis.mjs';
import { renderAnalyse, analysisArgs } from './dataset-analysis.mjs';
import { readinessAct, readinessSection, readinessStatus, checkReadiness } from './analysis-readiness.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const meta = { title: 'Datasets', icon: 'dataset' };
export const count = (...a) => REGISTRY.datasets.count(...a);

const PAGE = 50;
let current = null, rowPage = 1, picked = new Set(), ref = null, mode = 'data', focusCell = null;
// The patient table is offered as a source to analyse; it is edited in Patient data.
const sourceOf = (id, s = get()) => id === PATIENT_SOURCE ? patientDataset(s) : datasetById(id, s);
const sync = () => { const s = get(); if (ref !== s) { ref = s; if (current && !sourceOf(current, s)) { current = null; rowPage = 1; picked = new Set(); } } };

export const list = {
  title: 'Datasets',
  hideEmpty: true,   // no datasets: the page's empty state alone
  get empty() { return 'No datasets'; },
  items(s) {
    const p = patientDataset(s);
    return [...datasets(s).map(d => ({ id: d.id, title: d.name, sub: `${plural(d.rows.length, 'row')}, ${plural(d.columns.length, 'column')}`,
      meta: day(d.source?.importedAt || d.at), mark: d.source?.file ? String(d.source.file).slice(0, 40) : '' })),
      ...(p ? [{ id: p.id, title: p.name, sub: `${plural(p.rows.length, 'participant')}, ${plural(p.columns.length, 'column')}`, meta: '', mark: 'Analyse' }] : [])];
  },
};
export function select(id) { sync(); if (sourceOf(id)) { if (id !== current) mode = id === PATIENT_SOURCE ? 'analyse' : mode; current = id; rowPage = 1; picked = new Set(); } }
export function selected() { sync(); return current; }

/** Reads a file into a new dataset and opens it; several sheets become several datasets; a REDCap data dictionary becomes an empty typed dataset. */
export function importDataset(refresh) {
  pick({ accept: '.xlsx,.csv,.tsv,.txt' }, async files => {
    const f = files[0]; if (!f) return;
    const generation = projectGeneration(), controller = new AbortController(), h = jobs.start('import', `Import ${f.name}`);
    const unsubscribe = subscribe(() => { if (projectGeneration() !== generation || h.stopped()) controller.abort(); });
    try {
      const prepared = await parseDatasetFile(f, { signal: controller.signal, onProgress: text => h.progress(text) });
      if (controller.signal.aborted || projectGeneration() !== generation) throw new DOMException('Import stopped', 'AbortError');
      current = addDatasets(prepared); rowPage = 1; picked = new Set(); mode = 'data';
      h.done(`${prepared.length} datasets`); refresh?.();
    } catch (err) { if (err.name === 'AbortError') h.cancel(); else h.fail(err); if (projectGeneration() === generation) refresh?.(String(err.message || err)); }
    finally { unsubscribe(); }
  });
}

/** A REDCap records export read into the open dataset: new records are added, records already there are left as they are. */
function importRecords(d, refresh) {
  const generation = projectGeneration(), original = JSON.stringify(d);
  pick({ accept: '.csv,.txt' }, async files => {
    const f = files[0]; if (!f) return;
    try {
      if (f.size > MAX_IMPORT_BYTES) throw new Error('The import file exceeds 64 MiB');
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (projectGeneration() !== generation) return;
      if (JSON.stringify(datasetById(d.id)) !== original) throw new Error('The dataset changed. Import the records again.');
      const parsed = parseRecords(decodeImport(bytes).text, d);
      const r = recordsToAppend(d, parsed);
      appendRows(d.id, r.rows, { columns: r.columns, by: who(), source: f.name });
      refresh?.(`${plural(r.rows.length, 'record')} imported${r.skipped ? `, ${r.skipped} already present` : ''}${parsed.unmatched.length ? `; not in the dictionary: ${parsed.unmatched.slice(0, 3).join(', ')}` : ''}`);
    } catch (err) { if (projectGeneration() === generation) refresh?.(String(err.message || err)); }
  });
}

/** A new, empty trial log (lib/trial-logs.mjs), opened. */
function newLog(kind, refresh) {
  const d = createLog(kind);
  addDataset(d); current = d.id; rowPage = 1; picked = new Set(); mode = 'data';
  refresh?.();
}

/** Import and New log: the top bar's Import and the list's plus. */
function importMenu(anchor, refresh) {
  const d = current && current !== PATIENT_SOURCE ? datasetById(current) : null;
  showMenu(anchor, [
    { label: 'From file…', icon: 'import', run: () => importDataset(refresh) },
    { label: 'REDCap records…', icon: 'import', disabled: !d, run: () => importRecords(d, refresh) },
    { heading: 'New log' },
    ...LOG_KINDS.map(([k, l]) => ({ label: l, run: () => newLog(k, refresh) })),
  ]);
}

const fileBase = d => d.name.replace(/[^\w.-]+/g, '_');
const csvFile = (text, name) => saveFile(new Blob([text], { type: 'text/csv' }), name, 'text/csv');

/**
 * The page's head is the title bar (lib/topbar.mjs): the open dataset's name, Data or Analyse, Import and Export (menus), and what else a
 * dataset offers in More. Patients (views/patients.mjs) declares the same two first, so the two pages read alike. The patient table,
 * offered here to analyse, is named and has Edit patient data instead.
 */
export function page(refresh) {
  sync();
  // the De-identify page: Back, its name; the list pane is not drawn beside it
  if (deidentifyOpen()) return deidentifyPageSpec({ back: () => { closeDeidentify(); refresh(); } });
  const acts = [{ id: 'ds-menu-import', label: 'Import', icon: 'import', menu: true, run: a => importMenu(a, refresh) }];
  // an analysis is open (the patient table, or a dataset's Analyse): Check readiness, its verdict as the status (views/analysis-readiness.mjs)
  const readiness = src => readinessAct(readinessKey(src), () => analysisArgs(src), { after: () => { refresh(); shownCtx?.showDetails?.(); }, say: refresh });
  const verdict = src => { const status = readinessStatus(readinessKey(src), () => analysisArgs(src)); return status ? { status } : {}; };
  if (current === PATIENT_SOURCE) { const p = patientDataset();
    return { title: p.name, ...verdict(p), actions: [...acts, { id: 'ds-edit-ipd', label: 'Edit patient data', icon: 'patients', run: () => shownCtx?.go?.('patients') }, readiness(p)], overflow: [] }; }
  const d = current ? datasetById(current) : null;
  if (!d) return { title: 'Datasets', actions: acts, overflow: [] };
  const requireReason = !!get().dataSettings?.requireReason;
  acts.push({ id: 'ds-menu-export', label: 'Export', icon: 'export', menu: true, run: a => showMenu(a, [
    { label: 'CSV', run: () => csvFile(csvOf(toRows(d)), `${fileBase(d)}.csv`) },
    // typed: numbers as numbers and dates as dates, so Excel sorts and filters them
    { label: 'Excel', run: async () => saveFile(await writeXlsx([{ name: d.name, rows: [d.columns.map(c => c.label), ...d.rows.map(r => d.columns.map(c => typedCell(r[c.id], c.type)))] }]), `${fileBase(d)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') },
    { label: 'Word table', run: async () => { const widths = d.columns.map(() => Math.floor(15704 / d.columns.length));
      const blob = await writeTablesDocx({ blocks: [{ type: 'para', text: d.name, bold: true, size: 9, after: 4 }, { type: 'table', widths, header: d.columns.map(c => c.label), headerFill: 'E7E6E6', rows: d.rows.map(r => ({ cells: d.columns.map(c => ({ text: r[c.id] ?? '' })) })) }] });
      saveFile(blob, `${fileBase(d)}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); } },
    '-',
    { label: 'REDCap dictionary', run: () => csvFile(toDictionary(d), `${fileBase(d)}_DataDictionary.csv`) },
    { label: 'REDCap records', run: () => csvFile(toRecords(d), `${fileBase(d)}_records.csv`) },
  ]) });
  if (mode === 'analyse') acts.push(readiness(d));
  return { title: d.name, ...(mode === 'analyse' ? verdict(d) : {}), view: { id: 'ds-mode', label: 'Dataset mode', attr: 'data-ds-mode', value: mode, items: [['data', 'Data'], ['analyse', 'Analyse']], run: key => { mode = key; refresh(); } },
    actions: acts, overflow: [
    { id: 'ds-rename', label: 'Rename…', run: async () => { const name = await askText('Dataset name', { value: d.name, confirm: 'Rename' }); if (name != null && name.trim()) { renameDataset(d.id, name); refresh(); } } },
    { id: 'ds-add-row', label: 'Add row', run: () => { addRow(d.id); rowPage = Math.ceil((d.rows.length + 1) / PAGE); refresh(); } },
    '-',
    // the checks, the issues and the change log are sections of Details (views/dataset-manage.mjs): these bring them into view
    { id: 'ds-edit-checks', label: 'Edit checks', run: () => inDetails(refresh, showChecks) },
    { id: 'ds-check-data', label: 'Check data', run: () => inDetails(refresh, showIssues) },
    { id: 'ds-change-log', label: 'Change log', run: () => inDetails(refresh, () => showChangeLog()) },
    { id: 'ds-require-reason', label: 'Ask for a reason when a value changes', kind: 'toggle', checked: requireReason, run: () => { setDataSetting('requireReason', !requireReason); refresh(); } },
    { id: 'ds-deidentify', label: 'De-identify', run: () => { startDeidentify(d.id); refresh(); } },
    { id: 'ds-remove-rows', label: 'Remove selected rows', danger: true, run: async () => {
      if (!picked.size) { refresh('Select rows to remove them'); return; }
      const point = undoPoint(), n = picked.size;
      const kept = removeRows(d.id, [...picked], { by: who() }); picked = new Set(); refresh(kept ? `${plural(kept, 'locked row')} kept` : '');
      offerUndo(point, `Removed ${plural(n - kept, 'row')}`, () => refresh());
    } },
    { id: 'ds-remove-dataset', label: 'Remove dataset', danger: true, run: async () => {
      const point = undoPoint();
      removeDataset(d.id); current = null; refresh();
      offerUndo(point, `Removed ${d.name}`, () => { current = d.id; refresh(); });
    } },
  ] };
}

/** Brings a section of Details into view: `show` says which, and the inspector is opened and the page drawn again. */
function inDetails(refresh, show) { show(); shownCtx?.openDetails?.(); refresh(); }
/** Choosing an issue shows its page of the grid and focuses its cell. */
const jumpTo = (row, col, ctx) => { mode = 'data'; rowPage = Math.floor(row / PAGE) + 1; focusCell = { row, col }; ctx.rerender(); };

const typedCell = (v, type) => { if (v == null || v === '') return ''; if (type === 'number' || type === 'integer') { const n = cellValue(v, type); return n == null ? String(v) : n; } if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v).trim())) return { date: String(v).trim() }; return String(v); };
const csvOf = rows => rows.map(r => r.map(v => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n');

export function assistContext() {
  sync();
  const all = datasets(get()), d = current ? datasetById(current) : null;
  return [`Datasets: ${all.length ? all.map(x => `${x.name} (${x.rows.length} rows, columns: ${x.columns.map(c => c.label).join(', ')})`).join('; ') : 'none'}. Query them with from: "dataset", dataset: <name>.`,
    (get().datasetAnalyses || []).length ? `Kept analyses: ${get().datasetAnalyses.length}; query them with from: "analyses".` : '',
    d ? `Open: ${d.name}` : ''].filter(Boolean).join('\n');
}

/** The header's one control: a chevron that opens the column's type and rules. */
const headMenu = (c, type) => `<button type="button" class="icon ds-col-menu" data-type="${esc(c.id)}" aria-haspopup="menu" aria-label="Type and rules of ${esc(c.label)}: ${esc(type)}" title="Type and rules">${icon('chevron-down', { size: 12 })}</button>`;
const pageBox = on => `<input type="checkbox" id="ds-all" aria-label="Select page"${on ? ' checked' : ''}>`;
const pickBox = i => `<input type="checkbox" data-pick="${i}" aria-label="Select row ${i + 1}"${picked.has(i) ? ' checked' : ''}>`;
const rowButton = (i, locked, ver) => `<button type="button" class="quiet ds-rowbtn" data-rowmenu="${i}" aria-haspopup="menu" aria-label="Row ${i + 1}${locked ? ', locked' : ''}${ver ? ', verified' : ''}">${i + 1}${locked ? '<span class="ds-rowstate">locked</span>' : ''}${ver ? icon('check', { size: 12 }) : ''}${icon('chevron-down', { size: 12 })}</button>`;

/** What a dataset holds, as the one quiet line under the title bar (the data page adds its checks to it). */
const factsLine = text => uiStatusLine({ id: 'ds-status', label: 'Dataset', parts: [{ id: 'ds-facts', text, drop: 8 }] });
const factsOf = d => [plural(d.rows.length, 'row'), plural(d.columns.length, 'column'), d.source?.file ? String(d.source.file) : '', d.source?.file && d.source.sheet && d.source.sheet !== d.name ? String(d.source.sheet) : ''].filter(Boolean).join(', ');

const readinessKey = src => `dataset:${src.id}`;
/** The analysis open on the page (the patient table, or a dataset's Analyse), or null. */
const analysed = () => { sync(); if (current === PATIENT_SOURCE) return patientDataset(); const d = current ? datasetById(current) : null; return d && mode === 'analyse' ? d : null; };
/** Details: the readiness of the analysis open on the page; for a dataset's data, its column rules, checks, issues and change log. */
export function inspect(ctx) {
  const src = analysed();
  if (src) return [readinessSection(readinessKey(src), () => analysisArgs(src), ctx)];
  const d = current && current !== PATIENT_SOURCE && !deidentifyOpen() ? datasetById(current) : null;
  // a dataset's data: the chosen column's rules, the edit checks, the issues and the change log (views/dataset-manage.mjs)
  return d ? manageSections(d, ctx, { jump: (row, col) => jumpTo(row, col, ctx) }) : [];
}
/** Patient data's Check readiness: the patient table's analysis here, checked, with its verdict in Details. */
export function checkPatientReadiness(ctx) {
  const p = patientDataset(); if (!p) return;
  select(PATIENT_SOURCE);
  try { checkReadiness(readinessKey(p), () => analysisArgs(p)); } catch (error) { ctx.go('datasets'); ctx.say(error.message); return; }
  ctx.go('datasets'); ctx.showDetails?.();
}
// An edit of the analysis drops its readiness report: the status and Details follow without repainting the form.
const analyseHooks = (ctx, src) => ({ changed: () => { ctx.status?.(readinessStatus(readinessKey(src), () => analysisArgs(src))); ctx.refreshDetails?.(); } });

let shownCtx = null;   // the shell's context of the last render: Edit patient data in the title bar goes with it
export function render(el, ctx, tableOnly = false) {
  sync();
  shownCtx = ctx;
  // the De-identify page is the page alone: the list pane is not drawn beside it, and it comes back with Back
  if (deidentifyOpen()) {
    ctx.focus?.(true);
    renderDeidentify(el, ctx, { onOpen: id => { current = id; rowPage = 1; picked = new Set(); mode = 'data'; ctx.rerender(); } });
    return;
  }
  ctx.focus?.(false);
  if (current === PATIENT_SOURCE) {
    const p = patientDataset();
    el.innerHTML = `<div class="ds ds-patient">${factsLine(`${plural(p.rows.length, 'participant')}, ${plural(p.columns.length, 'column')}`)}<div id="ds-analyse"></div></div>`;
    renderAnalyse(el.querySelector('#ds-analyse'), p, analyseHooks(ctx, p));
    return;
  }
  const d = current ? datasetById(current) : null;
  if (!d) {
    el.innerHTML = emptyState({ icon: 'dataset', title: datasets(get()).length ? 'Choose a dataset' : 'No datasets',
      detail: datasets(get()).length ? '' : 'A registry export, a survey or a laboratory sheet, kept with the project and open to queries.' });
    return;
  }
  if (mode === 'analyse') {
    el.innerHTML = `<div class="ds">${factsLine(factsOf(d))}<div id="ds-analyse"></div></div>`;
    renderAnalyse(el.querySelector('#ds-analyse'), d, analyseHooks(ctx, d));
    return;
  }
  const problems = validate(d), byCol = new Map(problems.map(p => [p.column, p]));
  const st = get(), issues = issueIndex(d), mgmt = managementSummary(st, d);
  const { items, page: cur, pages } = pageOf(d.rows.map((r, i) => ({ r, i })), rowPage, PAGE);
  rowPage = cur;
  const typeName = t => COLUMN_TYPES.find(([k]) => k === t)?.[1] || t;
  const lockOf = i => isLocked(st, d.id, rowIdOf(d, i)), verifiedOf = i => isVerified(st, d.id, rowIdOf(d, i));
  const cellIssues = (i, c) => issues.cells.get(`${i}\u0000${c}`);
  const state = [mgmt.locked ? `${mgmt.locked} locked` : '', mgmt.verified ? `${mgmt.verified} verified` : '', mgmt.changes ? plural(mgmt.changes, 'change') : ''].filter(Boolean).join(', ');
  const misfit = problems.reduce((n, p) => n + p.count, 0);
  const checked = !hasChecks(d) ? '' : issues.count || issues.ruleErrors.length ? `${plural(issues.count, 'issue')}${issues.ruleErrors.length ? `, ${plural(issues.ruleErrors.length, 'check')} to correct` : ''}` : 'No issues';
  const parts = [{ id: 'ds-facts', text: factsOf(d), drop: 8 }, ...(misfit ? [{ id: 'ds-misfit', text: misfit === 1 ? '1 cell does not fit its column type' : `${plural(misfit, 'cell')} do not fit their column type`, drop: 5 }] : []),
    ...(checked ? [{ id: 'ds-issues', text: checked, button: true, reserve: checked, drop: 2 }] : []), ...(state ? [{ id: 'ds-log', text: state, button: true, reserve: state, drop: 3 }] : [])];
  const isNum = c => c.type === 'number' || c.type === 'integer';
  const colHead = c => {
    const rules = rulesLine(c.rules), warn = byCol.has(c.id) ? `<span class="meta ds-warn">${byCol.get(c.id).count} not ${esc(typeName(c.type).toLowerCase())}</span>` : '';
    return `<th class="ds-colhead${isNum(c) ? ' num' : ''}"><span class="ds-col"><span class="ds-col-text"><span class="ds-col-label">${esc(c.label)}</span>
        <span class="meta ds-col-type">${esc(typeName(c.type))}${rules ? ` (${esc(rules)})` : ''}</span>${warn}</span>${headMenu(c, typeName(c.type))}</span></th>`;
  };
  const rowHead = (i, locked, ver) => `<td class="ds-first"><span class="ds-first-cell">${pickBox(i)}${rowButton(i, locked, ver)}</span></td>`;
  const cellOf = (i, c, r, locked) => {
    const bad = cellIssues(i, c.id);
    return `<td class="ds-cell${isNum(c) ? ' num' : ''}${bad ? ' ds-flag' : ''}" data-cell="${i}:${esc(c.id)}" tabindex="0" aria-label="Row ${i + 1}, ${esc(c.label)}${locked ? ', locked' : ''}"${bad ? ` title="${esc(bad.map(x => x.message).join('\n'))}"` : ''}${locked ? ' aria-readonly="true"' : ''}>${esc(r[c.id] ?? '')}</td>`;
  };
  const rowOf = ({ r, i }) => { const locked = lockOf(i), ver = verifiedOf(i);
    return `<tr data-row="${i}" class="${picked.has(i) ? 'sel' : ''}${locked ? ' ds-locked' : ''}">${rowHead(i, locked, ver)}${d.columns.map(c => cellOf(i, c, r, locked)).join('')}</tr>`; };
  const allBox = items.length && items.every(({ i }) => picked.has(i));
  const grid = `<table class="ds-grid"><thead><tr><th class="ds-first"><span class="ds-first-cell">${pageBox(allBox)}<span class="ds-n-label">#</span></span></th>${d.columns.map(colHead).join('')}</tr></thead>
      <tbody>${items.map(rowOf).join('')}</tbody></table>`;
  const summary = logSummaryHtml(d);
  const markup = `<div class="ds">
    ${uiStatusLine({ id: 'ds-status', label: 'Dataset and its checks', parts })}
    ${summary}
    <div class="ds-panel${summary ? '' : ' ds-fit'}">${tableRegion({ label: `${d.name} data table`, sticky: true, html: grid })}
    <div class="meta ds-note" id="ds-note" aria-live="polite"></div>
    ${pager({ id: 'ds-pager', page: cur, pages, total: d.rows.length, label: 'rows', size: PAGE })}</div>
  </div>`;
  if (tableOnly) { replaceRegions(el, markup, ['.ds-panel > .ui-table-region', '#ds-pager']); cueRegions(el); } else el.innerHTML = markup;
  const note = el.querySelector('#ds-note'), say = t => { note.textContent = t || ''; };
  wirePager(el, 'ds-pager', p => { rowPage = p; render(el,ctx,true); });
  if (!tableOnly) el.querySelector('#ds-issues')?.addEventListener('click', () => inDetails(() => ctx.rerender(), showIssues));
  if (!tableOnly) el.querySelector('#ds-log')?.addEventListener('click', () => inDetails(() => ctx.rerender(), () => showChangeLog()));
  el.querySelector('#ds-all').onchange = e => { items.forEach(({ i }) => e.target.checked ? picked.add(i) : picked.delete(i)); ctx.rerender(); };
  const syncPagePick = () => { const n = items.filter(({ i }) => picked.has(i)).length, all = el.querySelector('#ds-all'); all.indeterminate = n > 0 && n < items.length; all.checked = items.length > 0 && n === items.length; };
  syncPagePick();
  el.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => { const i = Number(cb.dataset.pick); cb.checked ? picked.add(i) : picked.delete(i); cb.closest('tr').classList.toggle('sel', cb.checked); syncPagePick(); });
  el.querySelectorAll('[data-type]').forEach(b => b.onclick = e => showMenu(e.currentTarget, [
    ...COLUMN_TYPES.map(([k, l]) => ({ label: l, checked: d.columns.find(c => c.id === b.dataset.type)?.type === k, run: () => { setColumnType(d.id, b.dataset.type, k); ctx.rerender(); } })),
    '-',
    { label: 'Rules', run: () => { showColumnRules(d.id, b.dataset.type); ctx.openDetails?.(); ctx.rerender(); } },
  ]));
  // The row menu: lock, unlock with a reason, verify, history; a picked row acts on every picked row.
  el.querySelectorAll('[data-rowmenu]').forEach(b => b.onclick = e => {
    const i = Number(b.dataset.rowmenu), rows = picked.has(i) && picked.size > 1 ? [...picked].sort((x, y) => x - y) : [i];
    const ids = rows.map(x => rowIdOf(d, x)), n = rows.length > 1 ? ` ${rows.length} rows` : '';
    const locked = ids.filter(id => isLocked(st, d.id, id)), ver = isVerified(st, d.id, ids[0]);
    showMenu(e.currentTarget, [
      { label: `Lock${n || ' row'}`, disabled: locked.length === ids.length, run: () => { lockDatasetRows(d.id, ids, who()); ctx.rerender(); } },
      { label: `Unlock${n || ' row'}…`, disabled: !locked.length, run: async () => {
        const reason = await ask('Reason for unlocking', { confirm: 'Unlock' });
        if (reason == null) return;
        const r = unlockDatasetRows(d.id, locked, { by: who(), reason });
        ctx.rerender(r.ok ? '' : r.error);
      } },
      { label: `Mark${n} verified`, disabled: rows.length === 1 && !!ver, meta: rows.length === 1 && ver ? (ver.by || '') : '', run: () => { verifyDatasetRows(d.id, ids, who()); ctx.rerender(); } },
      '-',
      { label: 'History', disabled: rows.length > 1, run: () => { showChangeLog(ids[0]); ctx.openDetails?.(); ctx.rerender(); } },
    ]);
  });
  const describe = td => {
    const [row, col] = [Number(td.dataset.cell.split(':')[0]), td.dataset.cell.split(':').slice(1).join(':')];
    const lock = lockOf(row), bad = cellIssues(row, col);
    say([lock ? `Row ${row + 1} is locked${lock.by ? ` by ${lock.by}` : ''}` : '', ...(bad || []).map(x => x.message)].filter(Boolean).join('; '));
  };
  // A cell edits in place: Enter or a click opens it, Enter or blur keeps the text, Escape leaves it.
  // Every kept edit goes through the change log; with the reason setting on, it asks why first.
  const edit = td => {
    if (td.querySelector('input')) return;
    const [row, col] = [Number(td.dataset.cell.split(':')[0]), td.dataset.cell.split(':').slice(1).join(':')];
    if (lockOf(row)) { describe(td); return; }
    const was = td.textContent;
    td.innerHTML = `<input class="ds-edit" value="${esc(was)}" aria-label="${esc(d.columns.find(c => c.id === col)?.label || col)}, row ${row + 1}">`;
    const input = td.querySelector('input'); input.focus(); input.select();
    let done = false;
    const finish = async keep => {
      if (done) return; done = true;
      const v = keep ? input.value : was; td.textContent = v;
      if (!keep || v.trim() === was.trim()) return;
      let reason = '';
      if (get().dataSettings?.requireReason) {
        reason = await ask(`Reason for changing ${d.columns.find(c => c.id === col)?.label || col}`, { confirm: 'Save' });
        if (reason == null || !reason.trim()) { td.textContent = was; say(reason == null ? '' : 'A reason for the change is required'); td.focus(); return; }
      }
      const r = setCell(d.id, row, col, v, { reason, by: who() });
      if (!r.ok) { td.textContent = was; say(r.error); return; }
      if (hasChecks(d) || reason) { focusCell = { row, col }; ctx.rerender(); }
    };
    input.onblur = () => finish(true);
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); td.focus(); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); td.focus(); } };
  };
  el.querySelectorAll('[data-cell]').forEach(td => {
    td.onclick = () => edit(td);
    td.onfocus = () => describe(td);
    td.onkeydown = e => {
      if (td.querySelector('input')) return;
      if (e.key === 'Enter') { e.preventDefault(); edit(td); return; }
      const directions = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }, direction = directions[e.key];
      if (!direction) return;
      const parts = td.dataset.cell.split(':'), row = parts[0], col = parts.slice(1).join(':'), index = d.columns.findIndex(c => c.id === col), nextColumn = d.columns[index + direction[1]];
      if (!nextColumn) return;
      const next = [...el.querySelectorAll('[data-cell]')].find(cell => cell.dataset.cell === `${Number(row) + direction[0]}:${nextColumn.id}`);
      if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    };
  });
  if (focusCell) {
    const at = focusCell; focusCell = null;
    const td = [...el.querySelectorAll('[data-cell]')].find(x => x.dataset.cell === `${at.row}:${at.col}`) || el.querySelector(`tr[data-row="${at.row}"] [data-cell]`);
    td?.focus(); td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** The dialog-free import of rows. Used from the page by the release check's table regression (docs/design-review-2026-10-05/table-regression.js). */
export const importRows = (rows, opts) => addDataset(fromRows(rows, opts));
