// Patient data: one row per patient, each attributed to the report it came from.
//
// Named for what it holds rather than for the PRISMA-IPD term "participants",
// which beside Protocol and Screening reads as though it meant the review's own
// people.
import { REGISTRY } from './registry.mjs';
import { parsePatients } from '../lib/helpers.mjs';
import { unchecked, checkedStamp } from '../lib/progress.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { askText, ask, confirmAsk } from '../lib/dialog.mjs';
import { proposalBox, esc, emptyState } from '../lib/html.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { icon } from '../lib/icons.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiRowEnd } from '../lib/ui-actions.mjs';
import { tableRegion, disclosure } from '../lib/ui-components.mjs';
import { num } from '../lib/dates.mjs';
import * as ipd from '../lib/ipd.mjs';
import { flowPanel, wireFlow } from './patients-flow.mjs';
import * as review from './patient-review.mjs';
import { ipdListFromRows, looksLikeIpdList, applyIpdList } from '../lib/ipd-import.mjs';
import { mergePlan, applyMerge, mergeReport } from '../lib/ipd-merge.mjs';
import { readXlsx } from '../lib/xlsx-read.mjs';
import { writeDelimited } from '../lib/spreadsheet.mjs';
import { headerRow } from '../lib/folder-map.mjs';
import { patientDataset, PATIENT_SOURCE } from '../lib/dataset-analysis-core.mjs';
import { startDeidentify } from './dataset-manage.mjs';
import { checkPatientReadiness } from './datasets.mjs';
import { isPrimaryType } from '../lib/research-types.mjs';
import { researchType } from '../lib/workflow.mjs';
import { exclusionPreview, wireExclusionPreview } from '../lib/scientific-exclusions.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { locateInFolder, recordImport, untrackedNote } from '../lib/adoption.mjs';

export const usesDocument = true;
export const meta = { title: 'Patient data',
  icon: 'patients' };
export const count = (...a) => REGISTRY.patients.count(...a);
export function assistContext() {
  const s = get(); const rows = ipd.participants();
  const cols = Object.keys(rows[0] || s.patientSchema || {}).slice(0, 20);
  return `Patient data: ${rows.length} participants${filter ? `, filter "${filter}"` : ''}; columns ${cols.join(', ') || 'none'}`;
}

/**
 * A CSV, or a workbook: a review's master list (patients with the review's own include/exclude on every row) is read as such and confirmed;
 * any other sheet with a patient in each row is read by its column names.
 */
async function importPatientFile(file) {
  if (!/\.xlsx$/i.test(file.name)) {
    const text = await file.text(), merged = await mergeFile(file.name, csvTable(text));
    if (merged) return merged;
    const { added, columns } = ipd.fromCsv(text); return `${added} patients${columns ? `, ${columns} new columns` : ''}`;
  }
  const wb = await readXlsx(new Uint8Array(await file.arrayBuffer()));
  const sheet = wb.sheets.find(x => looksLikeIpdList(headerRow(x.rows).cells)) || wb.sheets[0];
  const { index, cells } = headerRow(sheet.rows);
  if (index < 0) return 'No header row';
  if (looksLikeIpdList(cells)) {
    // The chooser gives a name, not a path: a file that is in the project folder is recorded under its path there, so its changes can be tracked (plan §4.15d).
    const folder = activeFolder(), at = folder ? await locateInFolder(folder, file).catch(() => null) : null;
    const plan = ipdListFromRows(sheet.rows, { file: at || file.name, sheet: sheet.name });
    if (!plan.ok) return `Could not read it: ${plan.reason}`;
    const c = plan.counts;
    if (!await confirmAsk(`Import ${file.name}?`, { detail: `Sheet ${sheet.name}: ${c.patients} patients from ${c.included} reports${c.institutional ? ' and the institutional case' : ''}, and a decision on ${c.reports} reports (${c.included} include, ${c.excluded} exclude). Decisions already made are left as they are.${plan.notes.length ? ` Not read: ${plan.notes.join('; ')}.` : ''}`, confirm: 'Import' })) return 'Cancelled';
    let r; update(st => { r = applyIpdList(st, plan); return st; });
    const kept = at ? await recordImport(folder, r.adoption) : null;
    const note = at ? (kept?.ok ? '' : 'The adoption record could not be written, so changes to the file are not tracked') : untrackedNote(folder);
    return `${r.patients} patients, ${r.records.created} new records, ${r.decisions.included + r.decisions.excluded} decisions${note ? `. ${note}` : ''}`;
  }
  const merged = await mergeFile(file.name, { header: cells, rows: sheet.rows.slice(index + 1) });
  if (merged) return merged;
  const { added, columns } = ipd.fromCsv(writeDelimited(sheet.rows.slice(index), {}));
  return `${added} patients${columns ? `, ${columns} new columns` : ''}`;
}

const csvTable = text => { const rows = ipd.parseCsv(text); return { header: rows[0] || [], rows: rows.slice(1) }; };
/**
 * A table with an IPD id column adds fields to the patients it names (lib/ipd-merge.mjs) instead of adding patients: empty cells are
 * filled, and a cell that already holds another value is listed and changed only when the person takes the table's values. Null when the
 * table has no such column.
 */
async function mergeFile(name, table) {
  const plan = mergePlan(get(), table);
  if (!plan.ok || !plan.matched) return null;   // an id column of new patients is a list of patients, read as before
  const lines = mergeReport(plan), c = plan.counts;
  if (!await confirmAsk(`Add fields from ${name}?`, { detail: lines.slice(0, 12).join(' ') + (lines.length > 12 ? ` And ${lines.length - 12} more.` : ''), confirm: 'Add fields' })) return 'Cancelled';
  const conflicts = plan.changes.filter(x => x.kind === 'conflict');
  const take = conflicts.length && await confirmAsk(`Replace ${conflicts.length} values with the table's?`, { detail: conflicts.slice(0, 10).map(x => `${x.label}, ${x.name}: "${x.from}" becomes "${x.to}".`).join(' '), confirm: 'Replace', danger: true })
    ? new Set(conflicts.map(x => `${x.patient}|${x.column}`)) : new Set();
  let r; update(st => { r = applyMerge(st, plan, { take }); return st; });
  return `${r.added + r.taken} cells in ${r.patients} patients${r.columns ? `, ${r.columns} new columns` : ''}${r.conflictsLeft ? `, ${r.conflictsLeft} conflicts kept as they were` : ''}${c.unmatched ? `, ${c.unmatched} rows without a patient` : ''}`;
}

let listPage = 1, filter = '', editingSchema = false, pageGeneration = -1;
let exclusionPage = 1, exclusionOwner = null, exclusionsOpen = false;
/** Arrival from Needs attention (lib/arrive.mjs): patients missing a time or an event are the Not analysable list, opened. */
export function arrive(a) { if (a?.kind === 'missing-time') { exclusionOwner = projectGeneration(); exclusionsOpen = true; exclusionPage = 1; } return false; }

// The row (and cell) last clicked or focused, for model actions
// (lib/aid.mjs). It outlives renders, so an action chosen after the click
// still acts on it.
let focused = null;   // { id, col? }
export function focus() {
  if (!focused) return null;
  const p = ipd.participants().find(x => x.id === focused.id);
  if (!p) return null;
  const cols = ipd.columns();
  const c = focused.col ? cols.find(x => x.id === focused.col) : null;
  return { kind: 'patient', participantId: p.id, columnId: c?.id, paperId: p.study_id || undefined,
    label: `${p.label || p.id} (row ${p.id})`, detail: c ? `${c.name}: ${p[c.id] ?? 'empty'}` : '',
    text: cols.map(x => `${x.name}: ${p[x.id] ?? ''}`).join('; ') };
}

/** A new project, or the same one reloaded: the page starts again at the first page with no filter. page() and render() both call it. */
function sync() {
  if (pageGeneration === projectGeneration()) return;
  pageGeneration = projectGeneration(); listPage = 1; filter = ''; pendingRows = null; pendingSource = ''; focused = null; review.resetReview();
}

/** The title bar's count slot (ch): wide enough for "650 · 120 analysable", so the switch beside it does not sit far off. */
export const STATUS_CH = 20;
/** The count beside the title: shown, of all while filtered, and how many an analysis can use; the parts that do not fit the slot go. */
export function statusText(shown, all, usable, filtered = shown !== all) {
  const n = `${num(shown)}${filtered ? ` of ${num(all)}` : ''}`, full = `${n}, ${num(usable)} analysable`;
  return full.length <= STATUS_CH ? full : n.length <= STATUS_CH ? n : num(shown);
}

/**
 * The title bar (lib/topbar.mjs), from plain values: the page of patient data shown, as a picker of the five (Patients, Intake, Proposed,
 * Report, Rules: the Library's collections and Extraction's tables are chosen the same way), the patients' count, Add patient; importing,
 * exporting, a de-identified copy and reading a pasted table are its More. The bar has one shape on every page (the count and Add patient
 * are the patient table's, which every page is about), so choosing a page moves nothing in it. `tab` is the page shown.
 */
export function pageSpec({ tab = 'patients', status = '', reviewing = false, readiness = false, back = null } = {}, run = {}) {
  const on = f => run[f] || (() => {});
  const name = (review.PAGES.find(([k]) => k === tab) || review.PAGES[0])[1];
  // rows read from text are reviewed before anything else, so the picker waits until they are added or discarded
  return { title: reviewing ? 'Patient data' : name, ...(reviewing ? {} : { titleMenu: on('pick') }),
    // the Report opened from Extraction's earlier runs goes back there
    ...(back && !reviewing ? { back: { label: back.label, run: on('back') } } : {}),
    ...(status ? { status: { text: status, ch: STATUS_CH } } : {}),
    // secondary, not the primary: a primary never loses its words, and the bar must fit a 320 px window
    actions: reviewing ? [] : [{ id: 'add', label: 'Add patient', icon: 'plus', run: on('add') }],
    overflow: [
      { id: 'pt-import', label: 'Import…', run: on('import') },
      { id: 'pt-export', label: 'Export', run: on('export') },
      '-',
      // a de-identified copy goes to Datasets; the patient table itself is not changed
      { id: 'pt-deidentify', label: 'De-identify', run: on('deidentify') },
      { id: 'pt-parse', label: 'Parse text…', run: on('parse') },
      // the patient table's analysis is on Datasets: checked there, its verdict in Details (views/analysis-readiness.mjs)
      ...(readiness ? ['-', { id: 'pt-readiness', label: 'Check readiness', run: on('readiness') }] : [])] };
}

export function page(rerender) {
  sync();
  const tab = review.reviewTab(), cols = ipd.columns();
  const shown = pendingRows ? null : listModel(cols);
  const from = review.reportFrom();
  return pageSpec({ tab, reviewing: !!pendingRows, readiness: !!patientDataset(), back: from === 'extraction' ? { label: 'Back to Extraction' } : null, status: shown ? statusText(shown.matched.length, shown.all.length, ipd.survivalRows().rows.length, !!filter) : '' }, {
    back: () => { review.leaveReport(); shownCtx?.go?.('extraction'); },
    pick: at => showMenu(at, review.PAGES.map(([key, label]) => ({ label, checked: key === tab, run: () => { review.setReviewTab(key); rerender(); } }))),
    add: () => {
      // The row is appended, so it lives on the last page of the table; a filter would hide a blank row entirely. Go where the row is and put the caret in it.
      review.setReviewTab('patients');
      const id = ipd.addParticipant(get().papers[0]?.id ?? null);
      filter = ''; listPage = Number.MAX_SAFE_INTEGER;
      rerender();
      const cell = document.querySelector(`table.ipd tr[data-row="${CSS.escape(id)}"] input`);
      if (cell) { cell.focus(); cell.scrollIntoView({ block: 'center' }); }
    },
    import: () => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.csv,.txt,.xlsx';
      i.onchange = async () => {
        if (!i.files[0]) return;
        try { rerender(await importPatientFile(i.files[0])); } catch (err) { rerender(String(err.message || err).slice(0, 80)); }
      };
      i.click();
    },
    export: () => downloadCsv(ipd.toCsv(), 'patients.csv'),
    readiness: () => { if (shownCtx) checkPatientReadiness(shownCtx); },
    // a de-identified copy is made on Datasets, on a page of its own; the patient table itself is not changed
    deidentify: () => { if (!patientDataset()) { rerender('No patients'); return; } startDeidentify(PATIENT_SOURCE); shownCtx?.go?.('datasets'); },
    parse: async () => {
      const text = await askText('Paste patient data', { placeholder: 'A table or paragraph from the paper', confirm: 'Read' });
      if (!text?.trim()) return;
      rerender('Reading');
      try {
        const rows = await parsePatients(text, ipd.columns(), modelFor('extract'));
        if (!rows.length) { rerender('No patients found in the text'); return; }
        pendingRows = rows; pendingSource = rows.source === 'table' ? 'table' : modelFor('extract').model;
        rerender(`${rows.length} rows to review`);
      } catch (err) { rerender(err.message.slice(0, 80)); }
    },
  });
}

// The rows as a model and as markup, so the filter can redraw the table body
// and pager in place instead of the whole view on every keystroke.
const FILTER_DELAY = 120;
let filterTimer = 0, analysable = 0;
function listModel(cols) {
  const all = ipd.participants();
  const papers = get().papers;
  const labelOf = id => papers.find(p => p.id === id)?.label ?? id ?? '';
  const matched = filter
    ? all.filter(p => [labelOf(p.study_id), ...cols.map(c => p[c.id])]
        .join(' ').toLowerCase().includes(filter.toLowerCase()))
    : all;
  const view = pageOf(matched, listPage, 25);
  listPage = view.page;
  return { all, papers, labelOf, matched, view };
}
const pagerHtml = (view, matched) => pager({ id: 'ipd-pager', page: view.page, pages: view.pages, total: matched.length, label: 'patients', size: 25 });
// The table shows the columns not hidden in Columns (In table); the filter still reads them all.
const inTable = cols => cols.filter(c => !c.hidden);
function bodyHtml(view, cols, papers) {
  cols = inTable(cols);
  return `<tbody>${view.items.map((p, i) => `<tr data-row="${esc(p.id)}">
          <td class="study-cell"><select class="ipd-cell" data-study="${esc(p.id)}" aria-label="Study for participant ${esc(p.label || p.id)}">
            <option value="">—</option>
            ${papers.map(x => `<option value="${esc(x.id)}"${x.id === p.study_id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
          </select></td>
          ${cols.map(c => `<td${c.type === 'number' ? ' class="num-cell"' : ''}>${cell(p, c)}</td>`).join('')}
          <td class="ipd-more">${uiRowEnd({
            ...(unchecked(p) ? { inline: { id: `ipd-check-${i}`, label: 'Mark checked', icon: 'check', attrs: { 'data-check': p.id } } } : {}),
            more: { label: `More for ${p.label || p.id}`, attrs: { 'data-row-more': p.id } } })}</td>
        </tr>`).join('')}</tbody>`;
}

function redrawRows(el, ctx) {
  const tbody = el.querySelector('table.ipd > tbody');
  if (!tbody) { ctx.rerender(); return; }
  const cols = ipd.columns();
  const { all, papers, matched, view } = listModel(cols);
  // the count is the title bar's status, in a reserved slot: it follows the filter without a repaint
  ctx.status?.({ text: statusText(matched.length, all.length, analysable, !!filter), ch: STATUS_CH });
  const t = document.createElement('template');
  t.innerHTML = `<table>${bodyHtml(view, cols, papers)}</table>`;
  const next = t.content.querySelector('tbody');
  tbody.replaceWith(next);
  const panel = next.closest('.panel');
  const old = panel.querySelector('#ipd-pager');
  t.innerHTML = pagerHtml(view, matched).trim();
  const pages = t.content.firstElementChild;
  if (old && pages) old.replaceWith(pages);
  else if (old) old.remove();
  else if (pages) panel.querySelector(':scope > .ui-table-region').after(pages);
  wireRows(panel, ctx);
  ctx.fitRows?.(panel);
}

/** The handlers inside the rows and pager, which the filter redraws. */
function wireRows(scope, ctx) {
  wirePager(scope, 'ipd-pager', n => { listPage = n; redrawRows(scope.closest('#view') || scope, ctx); });
  scope.querySelectorAll('[data-study]').forEach(s => s.onchange = () => {
    update(st => { st.participants = st.participants.map(p =>
      p.id === s.dataset.study ? { ...p, study_id: s.value || null } : p); return st; });
  });
  scope.querySelectorAll('[data-cell]').forEach(inp => {
    const commit = () => ipd.setValue(inp.dataset.cell, inp.dataset.col, inp.value);
    inp.onchange = commit;
    inp.onblur = commit;
  });
  scope.querySelectorAll('[data-row-more]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Remove patient', danger: true, run: () => { ipd.removeParticipant(b.dataset.rowMore); ctx.rerender(); ctx.refreshCounts(); } }], { align: 'end' }));
  scope.querySelectorAll('[data-check]').forEach(b => b.onclick = () => {
    update(s => { const r = (s.participants || []).find(x => x.id === b.dataset.check); if (r) Object.assign(r, checkedStamp()); return s; });
    ctx.rerender(); ctx.refreshCounts();
  });
}

let pendingRows = null;      // rows read from text, waiting for a study and a yes
let pendingSource = '';
let shownCtx = null;   // the shell's context of the last render: Check readiness in More goes to Datasets with it
export function render(el, ctx) {
  sync();
  shownCtx = ctx;
  const cols = ipd.columns();
  const pendingHtml = () => {
    if (!pendingRows) return '';
    const studies = get().papers.filter(p => (get().fulltext?.[p.id] || get().screening?.[p.id])?.decision === 'include');
    const list = studies.length ? studies : get().papers;
    return proposalBox({ id: 'ipd-prop', title: `${pendingRows.length} patients read`, meta: pendingSource, accept: 'Add', body:
      `<label class="field"><span>Study</span><select id="ipd-study">${list.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select></label>
       <table><thead><tr>${cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${pendingRows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c.id] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` });
  };
  // Rows read from text are reviewed before anything else is shown.
  if (pendingRows) {
    el.innerHTML = pendingHtml();
    el.querySelector('[data-discard]').onclick = () => { pendingRows = null; ctx.rerender(); };
    el.querySelector('[data-accept]').onclick = () => {
      const study = el.querySelector('#ipd-study').value;
      for (const r of pendingRows) ipd.addParticipant(study, r);
      pendingRows = null; ctx.rerender(); ctx.refreshCounts();
    };
    return;
  }
  // The pages of a batch (proposed rows, its report, the rules) are beside the table, not instead of it.
  if (review.reviewTab() !== 'patients') { review.renderPage(el, ctx); return; }
  const batchWork = review.hasBatchWork();
  const { all, papers, labelOf, matched, view } = listModel(cols);
  if (exclusionOwner !== projectGeneration()) { exclusionOwner = projectGeneration(); exclusionPage = 1; exclusionsOpen = false; }

  if (!all.length && !editingSchema && !batchWork) {
    // Add patient is the title bar's
    el.innerHTML = `<div id="ipd-body">${emptyState({ icon: 'patients', title: 'No patients', actions: [{ id: 'e-schema', label: 'Edit columns', icon: 'extraction' }] })}</div>`;
    el.querySelector('#e-schema').onclick = () => { editingSchema = true; ctx.rerender(); };
    return;
  }

  const { rows: usable, excluded } = ipd.survivalRows();

  // the page's head is the title bar (page()): the count, the switch and Add patient; the table keeps its own tools
  el.innerHTML = `
    ${editingSchema ? schemaPanel(cols) : ''}
    <div class="panel ipd-panel" id="ipd-body">
      ${uiBar({ kind: 'tools', label: 'Find patients', id: 'ipd-tools',
        filters: [{ type: 'search', id: 'ipd-filter', label: 'Filter patients', placeholder: 'Filter', value: filter }],
        actions: [{ id: 'schema', label: 'Columns', icon: 'table', pressed: editingSchema }] })}
      ${tableRegion({ label: 'Patients', sticky: true, html: `<table class="ipd"><thead><tr>
          <th>Record</th>${inTable(cols).map(headCell).join('')}
          <th aria-label="Actions"></th></tr></thead>
        ${bodyHtml(view, cols, papers)}</table>` })}
      ${pagerHtml(view, matched)}
    </div>
    ${isPrimaryType(researchType(get()).id) ? '' : flowPanel(get())}
    ${excluded.length ? `<div class="panel">${disclosure({ id: 'ipd-exclusions', title: 'Not analysable', count: excluded.length, open: exclusionsOpen,
      body: exclusionPreview(excluded, { papers, page: exclusionPage, id: 'patient-exclusions' }) })}</div>` : ''}`;

  el.querySelector('#ipd-exclusions')?.addEventListener('toggle', e => { exclusionsOpen = e.target.open; });
  wireExclusionPreview(el, { id: 'patient-exclusions', onPage: n => { exclusionPage = n; }, ctx });

  const track = e => {
    const tr = e.target.closest?.('tr[data-row]');
    if (tr) focused = { id: tr.dataset.row, col: e.target.closest?.('[data-col]')?.dataset.col };
  };
  const tbl = el.querySelector('table.ipd');
  tbl?.addEventListener('focusin', track);
  tbl?.addEventListener('click', track);

  wireRows(el, ctx);
  if (!isPrimaryType(researchType(get()).id)) wireFlow(el, () => ctx.rerender());
  analysable = usable.length;
  const fb = el.querySelector('#ipd-filter');
  // The box itself is never replaced, so it keeps focus and caret.
  if (fb) fb.oninput = () => {
    filter = fb.value; listPage = 1;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { if (fb.isConnected) redrawRows(el, ctx); }, FILTER_DELAY);
  };

  el.querySelector('#schema').onclick = () => { editingSchema = !editingSchema; ctx.rerender(); };


  // schema editing
  el.querySelectorAll('[data-col-name]').forEach(i => i.onchange = () => {
    ipd.setColumns(cols.map(c => c.id === i.dataset.colName ? { ...c, name: i.value } : c));
    ctx.rerender();
  });
  el.querySelectorAll('[data-col-role]').forEach(s => s.onchange = () => {
    // A role belongs to exactly one column, or an analysis cannot tell which is which.
    ipd.setColumns(cols.map(c => {
      if (c.id === s.dataset.colRole) return { ...c, role: s.value || undefined };
      return s.value && c.role === s.value ? { ...c, role: undefined } : c;
    }));
    ctx.rerender();
  });
  // a column a patient's label already says (its paper, year, case) can leave the table and stay in the data, the filter and every analysis
  el.querySelectorAll('[data-col-shown]').forEach(b => b.onchange = () => {
    ipd.setColumns(cols.map(c => c.id === b.dataset.colShown ? { ...c, hidden: b.checked ? undefined : true } : c));
    ctx.rerender();
  });
  el.querySelector('#add-col')?.addEventListener('click', async () => {
    const name = await ask('New column', { placeholder: 'Name', confirm: 'Add' });
    if (!name?.trim()) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32);
    ipd.setColumns([...cols, { id, name: name.trim(), type: 'text' }]);
    ctx.rerender();
  });
  el.querySelector('#close-schema')?.addEventListener('click', () => { editingSchema = false; ctx.rerender(); });

}

function cell(p, c) {
  const v = p[c.id] ?? '';
  if (c.type === 'category' && c.levels?.length) {
    return `<select class="ipd-cell" data-cell="${esc(p.id)}" data-col="${esc(c.id)}" aria-label="${esc(c.name)}, participant ${esc(p.label || p.id)}">
      <option value="">—</option>
      ${v && !c.levels.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)} (outside choices)</option>` : ''}
      ${c.levels.map(l => `<option${l === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;
  }
  if (c.type === 'boolean') {
    return `<select class="ipd-cell" data-cell="${esc(p.id)}" data-col="${esc(c.id)}" aria-label="${esc(c.name)}, participant ${esc(p.label || p.id)}">
      <option value="">—</option>
      ${v !== '' && !['0', '1'].includes(String(v)) ? `<option value="${esc(v)}" selected>${esc(v)} (unrecognised)</option>` : ''}
      <option value="1"${String(v) === '1' ? ' selected' : ''}>Yes</option>
      <option value="0"${String(v) === '0' ? ' selected' : ''}>No</option></select>`;
  }
  const numeric = c.type === 'number';
  return `<input data-cell="${esc(p.id)}" data-col="${esc(c.id)}" value="${esc(v)}"
    class="ipd-cell${numeric ? ' num' : ''}" inputmode="${numeric ? 'numeric' : 'text'}"
    aria-label="${esc(c.name)}, participant ${esc(p.label || p.id)}">`;
}

const ROLE_NAME = { group: 'Comparison group', time: 'Follow-up time', event: 'Event' };
/** A column's header: a number is right-aligned like its cells, and a column with a role in the analysis says which. */
function headCell(c) {
  const cls = [c.role ? 'has-role' : '', c.type === 'number' ? 'num' : ''].filter(Boolean).join(' '), why = c.role ? ROLE_NAME[c.role] || c.role : '';
  return `<th${cls ? ` class="${cls}"` : ''}${why ? ` title="${esc(why)}"` : ''}>${esc(c.name)}</th>`;
}
const COLUMN_ROLES = [['', '—'], ['time', 'Follow-up time'], ['event', 'Event'], ['group', 'Comparison group']];
const schemaRow = c => `<tr>
  <td class="grow">${nameInput(c)}</td>
  <td>${esc(c.type)}</td>
  <td>${roleSelect(c)}</td>
  <td><input type="checkbox" data-col-shown="${esc(c.id)}"${c.hidden ? '' : ' checked'} aria-label="Show ${esc(c.name)} in the table"></td></tr>`;
const nameInput = c => `<input data-col-name="${esc(c.id)}" value="${esc(c.name)}" aria-label="Column name: ${esc(c.name)}">`;
const roleSelect = c => `<select data-col-role="${esc(c.id)}" aria-label="Analysis role: ${esc(c.name)}">${COLUMN_ROLES.map(([v, l]) => `<option value="${v}"${(c.role ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
/** Columns, and which of them carries the time, event and group an analysis needs. */
function schemaPanel(cols) {
  return `<div class="panel">
    ${uiBar({ kind: 'head', label: 'Columns', id: 'ipd-schema-head', lead: { title: 'Columns' },
      actions: [{ id: 'add-col', label: 'Add column', icon: 'plus' }, { id: 'close-schema', label: 'Close', icon: 'close', role: 'quiet' }] })}
    ${tableRegion({ label: 'Columns', html: `<table><thead><tr><th class="grow">Name</th><th>Type</th><th>Role in analysis</th><th>In table</th></tr></thead><tbody>${cols.map(schemaRow).join('')}</tbody></table>` })}</div>`;
}
