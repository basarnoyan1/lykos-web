// Extraction: the study data tables (Extraction redesign). Every table lists its studies as rows and its fields as columns, as a
// spreadsheet does; a person may turn one to fields as rows. A cell is typed in place; a cell that holds a value returns to where it came
// from; a cell with a proposal waits for a person (plan F5, G4). Fill, in the title bar, is the one way to ask a model for values
// (./extraction-fill.mjs).
import { REGISTRY } from './registry.mjs';
import { get, update, projectGeneration, getVersion } from '../store.mjs';
import { fields, addField, removeField, TYPES, updateField, labelWithUnit, lockValues } from '../lib/fields.mjs';
// what a person types into a cell, the same from Extraction and from Analysis's input grid (lib/cell-write.mjs)
import { writeCellValue } from '../lib/cell-write.mjs';
import { templates, templateById, columnsOf, removeTemplate, saveTemplate, templateJson, templateFromJson, isTransposed, setTransposed } from '../lib/templates.mjs';
import { tableToShow, findStudies } from '../lib/table-with-data.mjs';
import { pick } from './library.mjs';
import { proposalFor, accept, reject, notReported, pendingStudies, nextPending, key as cellKey } from '../lib/proposals.mjs';
import { renderDetails } from './extraction-details.mjs';
import { importTable } from './runs.mjs';
import { cellCounts } from '../lib/batch-review.mjs';
import { confirmAcceptCleanCells } from './batch-proposals.mjs';
import { characteristics, toCsv as charCsv, toMarkdown as charMarkdown, toBlocks as charBlocks } from '../lib/characteristics.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { addTableAsset } from './manuscript.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { configured } from '../lib/ai.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { fieldGuide } from '../lib/field-guide.mjs';
// the study's own name as a field (the citation column) is the row's head, not a second column (lib/extraction-summary.mjs)
import { studyColumnOf } from '../lib/extraction-summary.mjs';
import { uiBar, watchWidth, menuAnchor } from '../lib/ui-actions.mjs';
import { tableRegion, formField } from '../lib/ui-components.mjs';
import { WINDOW_FROM } from '../lib/table-window.mjs';
import { setColumns } from '../lib/extraction-summary-store.mjs';
import { plural, num } from '../lib/dates.mjs';
import { studies } from '../lib/screen.mjs';
// arms: study arms as rows, and the evidence-table exports (lib/arms.mjs, ./extraction-arms.mjs)
import { splitCellId, keyInColumns, studyGrid } from '../lib/arms.mjs';
import { drawnCellId, armIndexOf, armColumn } from './extraction-arms.mjs';
// the grid that fits its pane: measured columns, folded fields in a row detail, long values held with Show all (./extraction-grid.mjs)
import { createGrid, clampHtml, cellIsOpen } from './extraction-grid.mjs';
import { wordTablesOpen, closeWordTables, wordTablesSpec, renderWordTables, evidenceExportItems } from './evidence-exports.mjs';
// the data summary: a sub-page of the table (./extraction-summary.mjs)
import { summaryOpen, openSummary, closeSummary, summaryBack, summarySpec, summaryExport, renderSummary } from './extraction-summary.mjs';
// cell rules: checks, header summary, inspector rules, editor, Suggest fixes (lib/cell-rules.mjs)
import { checkRules, ruleClass, rulesFilter, rulesMessage, rulesOverflow, wireRules, ruleEditorSections, cellRulesBox, rulesContext, brokenCount, rulesChoice, rulesShown, showRules } from './extraction-rules.mjs';
// evidence features: double extraction and locks (./extraction-double.mjs), field attributes and the codebook (lib/codebook.mjs), multi-arm inputs
import { doubleMode, doubleCell, doubleBarHtml, wireDoubleBar, ownEntry, entryLabel, renderEntryPanel, renderComparePanel } from './extraction-double.mjs';
import { doubleOn, setDouble, setEntry } from '../lib/double-extraction.mjs';
import { codebookRows, codebookCsv, codebookBlocks } from '../lib/codebook.mjs';
import { validPattern } from '../lib/cell-rules.mjs';
import { multiArmOf } from '../lib/multi-arm.mjs';
import { adjudicationQueue } from '../lib/research-copilot.mjs';
// Fill: the popover, the run, its notice and its log (./extraction-fill.mjs)
import { fillRun, fillMessage, openFill, closeFill, stopFill, fillAbstracts, summaryHtml, wireSummary, runSection, presetFill } from './extraction-fill.mjs';

let unwatchSelection,selectionFrame=0,selectionFocus=false;
export function unmount(again = false) { if (again) return; unwatchSelection?.(); host.grid?.release(); cancelAnimationFrame(selectionFrame); closeFill(); closeWordTables(); closeSummary(); }   // `again`: a repaint of the page, which keeps its popover and the Word tables and summary sub-pages
export const usesDocument = true;
export const meta = { title: 'Extraction', icon: 'extraction' };
export const count = (...a) => REGISTRY.extraction.count(...a);

// The text each study's cells hold in a table, for the filter box: "dynamic" finds the studies with a dynamic screw. Kept for the store version and table.
let hayKey = '', hayOf = new Map();
function valueHay(st, colIds) {
  const key = `${getVersion()}|${templateId}`;
  if (key !== hayKey) {
    hayOf = new Map(); hayKey = key;
    for (const [k, v] of Object.entries(st.values || {})) if (keyInColumns(k, colIds)) { const id = k.slice(0, k.indexOf(':')); hayOf.set(id, `${hayOf.get(id) || ''} ${String(v?.reported_value ?? v?.normalized_value ?? '')}`); }
  }
  return p => hayOf.get(p.id) || '';
}
let templateId = 'default', filter = '', showFields = false, pendingOnly = false, disagreeOnly = false;
// Find: the tools row (the filter and Show) is closed until the title bar's Find or ⌘F opens it, and stays open while it narrows the table
let findOpen = false;
/** What Show narrows the table to: '', 'pending', 'disagree' or 'rules'. */
const shownFilter = () => (pendingOnly ? 'pending' : disagreeOnly ? 'disagree' : rulesShown() ? 'rules' : '');
const findPressed = () => findOpen || !!filter || !!shownFilter();
let liveCtx = null;   // the context of the drawn page, for ⌘F (find())
function openFind(ctx) { findOpen = true; ctx.rerender(); document.querySelector('#ext-filter')?.focus(); }
function closeFind(ctx) { findOpen = false; filter = ''; ctx.rerender(); document.querySelector('#view .ext-body [tabindex], #view .ext-body')?.focus?.(); }
/** ⌘F (app.mjs findInView): opens the tools row and puts the caret in its filter; false when the table page is not drawn. */
export function find() { if (!liveCtx || summaryOpen() || wordTablesOpen()) return false; if (findOpen || filter || shownFilter()) document.querySelector('#ext-filter')?.focus(); else openFind(liveCtx); return true; }
// The table's disagreements (the adjudication queue of lib/research-copilot.mjs): conflicting evidence, a proposal that differs from the
// accepted value, a value with no source locator. Cell key -> reasons, for the tools row's filter and the cells' tooltips.
let disagreeCells = new Map();
const FILTER_DELAY = 120;
let filterTimer = 0;
let sel = null;   // { paperId, columnId }
// The cell typed in place: its draft outlives a repaint (a run repaints the page as it goes) and the editor is put back where it was.
let editing = null;   // { paperId, columnId, draft }
let fillNext = false;   // Overview's "Fill" of one study: the popover opens once the page is drawn
let arrivedIds = null, arrivedPending = false;   // the studies a Needs attention row named (lib/arrive.mjs), or its proposals: the table shows only those
// The frozen study column must not cover the selected cell: the region's scroll padding (research-views.css) is the column's width, so scrolling a
// cell into view stops clear of it. Run after the shell restores its scroll position, and again when Details changes width.
function revealSelectedCell(el, focus=false) {
  const cell=el.querySelector('.cell.sel');if(!cell)return;
  if(focus&&!el.querySelector('.ext-cell-input'))cell.focus({preventScroll:true});   // typing in a cell keeps the focus
  cell.scrollIntoView({block:'nearest',inline:'nearest'});
}
function scheduleSelection(el, focus=false) {
  cancelAnimationFrame(selectionFrame);selectionFocus ||= focus;
  selectionFrame=requestAnimationFrame(()=>{const takeFocus=selectionFocus;selectionFocus=false;if(el.isConnected)revealSelectedCell(el,takeFocus);});
}
export const setTemplate = id => { templateId = id; sel = null; editing = null; };
/**
 * The studies a table lists: the included studies once screening has
 * decisions (all records before), and any other record that already holds a
 * value or a proposal in this table, so nothing extracted is hidden. The
 * library's excluded records are not rows to fill.
 */
function tableStudies(st, id) {
  const inc = studies(st);
  if (inc.length === (st.papers || []).length) return inc;
  const cols = new Set(columnsOf(id).map(c => c.id)), held = new Set();
  for (const k of [...Object.keys(st.values || {}), ...Object.keys(st.proposals || {})]) if (keyInColumns(k, cols)) held.add(k.slice(0, k.indexOf(':')));
  const keep = new Set(inc.map(p => p.id));
  return (st.papers || []).filter(p => keep.has(p.id) || held.has(p.id));
}
/** The fields a person put away from this table's columns: they stay reachable in each study's row detail (More > Columns). */
const columnsHidden = (id, st = get()) => st.extractionSummary?.columns?.[id]?.hidden || [];
export const selection = () => sel ? { templateId, ...sel } : null;
/** Overview's Fill for one study: the study's first cell is chosen and Fill opens on it once the page shows. */
export function focusRun(paperId, id = 'default') {
  if (!templateById(id) || !get().papers.some(p => p.id === paperId)) return false;
  templateId = id; filter = ''; pendingOnly = false; disagreeOnly = false; editing = null;
  const first = columnsOf(id)[0];
  sel = first ? { paperId, columnId: first.id } : null;
  presetFill('study'); fillNext = true;
  return true;
}
/** Arrival from Needs attention: the studies not extracted or holding unverified values, or the pending proposals (the head's own
 * Pending filter). Null shows the whole table again. */
export function arrive(a) {
  if (!a) { arrivedIds = null; if (arrivedPending) pendingOnly = false; arrivedPending = false; return false; }
  if (a.kind === 'proposals') { pendingOnly = arrivedPending = true; return true; }
  if (!['not-extracted', 'unverified-values'].includes(a.kind) || !a.ids?.length) return false;
  arrivedIds = new Set(a.ids); filter = '';
  return true;
}
export const arrived = () => !!arrivedIds || (arrivedPending && pendingOnly);
/** The notice's "Open the first": the first of those studies, at its first empty or unverified cell. */
export function arriveFirst(a) {
  const st = get(), p = tableStudies(st, templateId).find(x => arrivedIds?.has(x.id)), cols = columnsOf(templateId);
  if (!p || !cols.length) return;
  const v = c => st.values?.[cellKey(p.id, c.id)];
  const c = cols.find(c => a?.kind === 'unverified-values' ? String(v(c)?.extractor || '').startsWith('model:') && v(c).verification !== 'verified' : !v(c)) || cols[0];
  sel = { paperId: p.id, columnId: c.id };
}
/** Open the paper's extraction results without starting an AI fill. */
export function focusPaper(paperId) {
  const st = get();
  const candidates = templates(st).map(t => t.id);
  for (const id of [templateId, ...candidates]) {
    const first = columnsOf(id)[0];
    if (first && focusCell(paperId, id === 'default' ? first.id : `${id}.${first.id}`)) return true;
  }
  return false;
}
export function focusCell(paperId, columnId) {
  const id = columnId.includes('.') ? columnId.split('.')[0] : 'default';
  if (!templateById(id) || !columnsOf(id).some(c => c.id === splitCellId(columnId).columnId)) return false;
  if (!tableStudies(get(), id).some(p => p.id === paperId)) return false;
  templateId = id; filter = ''; pendingOnly = false; disagreeOnly = false; editing = null;
  openedFor = projectGeneration();
  sel = { paperId, columnId };
  return true;
}
export function assistContext() {
  const t = templateById(templateId);
  if (!sel) return [`Extraction · ${t?.name || templateId} · template:${templateId}`, rulesContext()].filter(Boolean).join('\n');   // cell rules
  const p = get().papers.find(x => x.id === sel.paperId), c = columnsOf(templateId).find(x => x.id === splitCellId(sel.columnId).columnId);   // arms
  const v = get().values[cellKey(sel.paperId, sel.columnId)], pr = proposalFor(sel.paperId, sel.columnId);
  return [`Cell ${c?.label} of ${p?.label} · template:${templateId} · ${v ? `accepted "${v.reported_value}"` : pr ? `proposed "${pr.value}"` : 'empty'}`, rulesContext(sel)].filter(Boolean).join('\n');   // cell rules
}

/** The selected cell, for model actions and the assistant (lib/aid.mjs). */
export function focus() {
  if (!sel) return null;
  const p = get().papers.find(x => x.id === sel.paperId), c = columnsOf(templateId).find(x => x.id === splitCellId(sel.columnId).columnId);   // arms
  return { kind: 'cell', templateId, paperId: sel.paperId, fieldId: sel.columnId, label: [p?.label, c?.label].filter(Boolean).join(' · '), detail: assistContext() };
}

const numeric = c => c.type === 'integer' || c.type === 'number';
/** What a cell shows: the accepted value (NR when not reported, a number as read), else the proposal waiting for a person. All of it: a long
 * value wraps, and the grid holds it to four lines with Show all (./extraction-grid.mjs); nothing is cut here. */
const shownOf = (c, v, pr) => v ? (v.availability === 'not_found' ? 'NR' : numeric(c) && v.normalized_value != null && v.normalized_value !== '' ? String(v.normalized_value) : String(v.reported_value ?? '')) : pr ? String(pr.value ?? '') : '';

/**
 * A cell of the grid. Its state is drawn by weight, fill and rule, never hue (redesign §1.3): a proposal waiting is ink-2 with a dotted
 * underline, a disagreement heavier on a fill, not reported "NR" in ink-3, a broken rule the warning corner, an empty cell blank.
 */
const openAttr = (p, c) => cellIsOpen(`${p.id}|${c.id}`) ? ' data-open' : '';   // a long value opened with Show all
function cellHtml(p, c, v, pr) {
  const isSel = sel && sel.paperId === p.id && sel.columnId === c.id;
  // a further arm's input, for a study without that arm: nothing to fill (lib/multi-arm.mjs)
  if (c.arm && !multiArmOf(get(), p.id)?.arms.some(a => a.id === c.arm)) return '<td class="cell na"></td>';
  // double extraction: whose entries the table shows (./extraction-double.mjs)
  if (doubleMode()) {
    const d = doubleCell(get(), cellKey(p.id, c.id), c);
    const dcls = ['cell', numeric(c) ? 'num' : '', isSel ? 'sel' : '', d.cls ? `dx-${d.cls}` : '', ruleClass(p.id, c.id)].filter(Boolean).join(' ');
    return `<td class="${dcls}" data-cell="${esc(p.id)}|${esc(c.id)}" tabindex="-1"${d.title ? ` title="${esc(d.title)}"` : ''}${openAttr(p, c)}>${clampHtml(d.text, `${p.id}|${c.id}`)}</td>`;
  }
  const why = disagreeCells.get(cellKey(p.id, c.id));   // a disagreement: its reasons after the value
  const state = why ? 'conflict' : v?.availability === 'not_found' ? 'nr' : pr && !v ? 'proposed' : '';
  const cls = ['cell', numeric(c) ? 'num' : '', isSel ? 'sel' : '', state, ruleClass(p.id, c.id)].filter(Boolean).join(' ');   // cell rules: ruleClass
  const shown = shownOf(c, v, pr), written = String(v?.reported_value ?? pr?.value ?? '');
  const title = [written !== shown ? written : '', ...(why || [])].filter(Boolean).join(' · ');   // the cell shows its whole value: the tooltip adds what it does not (the value as reported, the reasons)
  return `<td class="${cls}" data-cell="${esc(p.id)}|${esc(c.id)}" tabindex="-1"${title ? ` title="${esc(title)}"` : ''}${openAttr(p, c)}>${clampHtml(shown, `${p.id}|${c.id}`)}</td>`;
}

let openedFor = -1;   // the project generation whose Extraction already looked for the table that holds its data
/**
 * The table in view. A project's first Extraction opens the table that holds its values when the built-in one holds none (a page of zeros is
 * not where the data is), and so does a table that is gone (an evidence update replaced it, it was removed elsewhere, nothing was chosen).
 * The title bar (page()) asks before the page is drawn, so both read the table from here.
 */
function currentTable(st = get()) {
  const fresh = openedFor !== projectGeneration();
  if (fresh) openedFor = projectGeneration();
  const id = tableToShow(templateId, st, { fresh }); if (id !== templateId) setTemplate(id);
  return templateId;
}
/** The included studies among `list` (all of them before screening has decisions): what the table's counts are of. */
const includedOf = (st, list) => { const inc = new Set(studies(st).map(p => p.id)); return list.filter(p => inc.has(p.id)); };

/**
 * The table in view as plain values, for the title bar (page()) and the page (render()): its studies, those that the filter, an arrival, the
 * rules and Pending leave, what is proposed and how many values it holds. The rules are checked here, before any cell is drawn (plan G1, G5).
 * The counts are of the included studies; a record outside them that still holds a value is listed, so nothing is hidden, but not counted.
 */
function tableModel(st = get()) {
  currentTable(st);
  const t = templateById(templateId), cols = columnsOf(templateId), rowsMode = !isTransposed(templateId, st);
  const all = tableStudies(st, templateId);
  // by study, arm cells ("column@arm2") included (lib/proposals.mjs)
  const { all: pendingIn, imported: importedIn, list: pendList } = pendingStudies(templateId);
  const pend = new Set(pendList.map(x => cellKey(x.paperId, x.columnId)));
  const colIds = new Set(cols.map(c => c.id));   // arms: arm values count with their column
  let matched = findStudies(all, filter, valueHay(st, colIds));   // the box finds a study by what its cells hold too
  if (arrivedIds) matched = matched.filter(p => arrivedIds.has(p.id));
  checkRules({ ...t, columns: cols }, st, templateId === 'default' ? all : null); matched = rulesFilter(matched);   // cell rules: check before cells are drawn; required fields (plan G1)
  if (pendingOnly) matched = matched.filter(p => pendingIn.has(p.id));
  const disagree = disagreementsIn(st, colIds);
  if (disagreeOnly) matched = matched.filter(p => disagree.studies.has(p.id));
  const counted = includedOf(st, all), inc = new Set(counted.map(p => p.id));
  const valueCount = Object.keys(st.values).filter(k => keyInColumns(k, colIds) && inc.has(k.slice(0, k.indexOf(':')))).length;
  // the field that is the study's own name is the row's head and its tooltip, not a column of its own
  const studyCol = studyColumnOf(cols, all, (p, c) => st.values?.[cellKey(p.id, c.id)]?.reported_value);
  const gridCols = studyCol ? cols.filter(c => c.id !== studyCol) : cols;
  return { st, t, cols, gridCols, studyCol, rowsMode, all, counted, matched, shownCount: matched.filter(p => inc.has(p.id)).length, pend, pendingIn, importedIn, colIds, valueCount, disagree };
}
/** The disagreements of the table's columns: cell key -> reasons, and the studies that hold one. */
function disagreementsIn(st, colIds) {
  const cells = new Map(), studies = new Set();
  for (let offset = 0; offset != null;) {
    const q = adjudicationQueue(st, { stage: 'extraction', limit: 100, offset });
    for (const i of q.items) if (keyInColumns(i.key, colIds)) { cells.set(i.key, i.reasons); studies.add(i.key.slice(0, i.key.indexOf(':'))); }
    offset = q.nextOffset;
  }
  return { cells, studies };
}
/** The cells of a study, each arm's own included: what double extraction compares and what Lock takes. */
const cellIdsFor = m => p => m.rowsMode ? studyGrid(m.t, m.st.values, p.id, m.cols).cells.flatMap(row => row.filter(Boolean).map(x => x.arm ? `${x.columnId}@${x.arm}` : x.columnId)) : m.cols.map(c => c.id);
/** The accepted values of the studies in view that are not yet locked. */
const lockableKeys = m => m.matched.flatMap(p => cellIdsFor(m)(p).map(id => cellKey(p.id, id))).filter(k => get().values?.[k] && !get().values[k].locked);

/** The count beside the title: the studies (of all while narrowed) and the values the table holds; what does not fit the 24ch slot goes. */
export function statusText(shown, all, values) {
  const studies = shown === all ? plural(all, 'study', 'studies') : `${num(shown)} of ${plural(all, 'study', 'studies')}`;
  const full = `${studies} · ${plural(values, 'value')}`;
  return full.length <= 24 ? full : studies.length <= 24 ? studies : plural(shown, 'study', 'studies');
}

/**
 * The title bar, from plain values (page()): the table as its title (a picker when there are several), the count, Fields on the built-in
 * table and Fill as the page's one primary (Stop while a run goes); the table's other commands in its More, destructive ones last.
 * `run` holds the handlers by id.
 */
export function pageSpec(m, run = {}) {
  const on = id => run[id] || (() => {});
  const e = (id, label, more = {}) => ({ id, label, ...more, run: on(id) });
  return { title: m.name, ...(m.tables > 1 ? { titleMenu: on('pick'), titleNoun: 'table' } : {}),
    ...(m.status ? { status: { text: m.status, ch: 24 } } : {}),
    // Find: the tools row, closed until asked for; the title bar draws it beside the panel toggles, pressed while the row is open or narrows the table
    ...(m.empty ? {} : { find: { pressed: !!m.finding, run: on('ext-find') } }),
    actions: m.empty ? [] : [
      ...(m.isDefault ? [e('fields-toggle', 'Fields', { icon: 'plus', pressed: !!m.showFields, attrs: { 'aria-expanded': String(!!m.showFields) } })] : []),
      e('summary', 'Summary', { icon: 'pie' }),   // what the studies hold, field by field (./extraction-summary.mjs)
      // Fill and Stop share the slot and the width: a run that starts or ends moves nothing
      // (one label width, 4ch, for both words: 'Stop' sets wider than 'Fill', and the act would grow by its difference when a run starts)
      m.running ? e('fill-stop', 'Stop', { icon: 'stop', role: 'primary', labelCh: 4, dynamic: true })
        : e('fill', 'Fill', { icon: 'run', role: 'primary', labelCh: 4, dynamic: true, disabled: !m.canFill, attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } })],
    overflow: m.empty ? [] : [
      e('ext-export', 'Export…', { disabled: !m.shown }),
      // the studies and fields in view as a table of the paper's package (views/package-view.mjs); a named table only, as the package reads s.templates
      ...(m.isDefault ? [] : [e('ext-make-table', 'Make a table from this view…', { disabled: !m.shown })]),
      '-',
      ...(m.isDefault ? [e('from-abs', 'From abstracts', { disabled: !m.canAbstract })] : []),
      e('import-tbl', 'Import table file…'),
      e('update-tbl', 'Update from a newer version…', { disabled: m.isDefault }),   // the source workbook's later version in the folder (./evidence-update-ui.mjs)
      e('add-cols', 'Add columns from a file…'),
      '-',
      ...(m.rules || []),   // cell rules: Table rules, Suggest fixes, each with its run
      e('ext-accept-clean', 'Accept clean cells', { disabled: !m.clean }),   // what a batch stamped clean, after a counted confirmation
      '-',
      e('ext-transpose', 'Fields as rows', { kind: 'toggle', checked: !!m.transposed }),
      e('ext-columns', 'Columns…', { disabled: !m.canColumns }),   // which fields are columns; the others are in each study's row detail
      // double extraction and locks (plan G4)
      e('ext-double', 'Double extraction', { kind: 'toggle', checked: !!m.double }),
      e('ext-lock', 'Lock accepted values', { disabled: !m.lockable }),
      '-',
      // the table's shape as a file, to reuse in another review (plan G1)
      e('ext-def-export', 'Export table definition'),
      e('ext-def-import', 'Import table definition…'),
      e('ext-clear', 'Clear values', { danger: true, disabled: !m.values }),
      ...(m.isDefault ? [] : [e('ext-remove', 'Remove table', { danger: true })])] };
}

let host = { el: null, ctx: null };   // the page as last drawn: the title bar's commands act on it
// The context a title-bar command runs with: the shell's, read when the command runs (the bar is declared before the page is first drawn).
const live = rerender => new Proxy({}, { get: (_, k) => (host.ctx || { rerender, refreshCounts: () => {}, openDetails: () => {}, go: () => {}, say: () => {} })[k] });

/** The page as Fill sees it: the table, the selected cell, the studies on show and all of them. */
const fillPage = m => ({ templateId, sel, shownIds: m.matched.map(p => p.id), all: m.all });

/** The table's commands, by id: each reads the table as it is when it runs. */
function commands(ctx) {
  const now = () => tableModel();
  const exportCsv = m => downloadCsv(
    [['Study', ...m.cols.map(c => labelWithUnit(c))], ...m.matched.map(p => [p.label, ...m.cols.map(c => m.st.values[cellKey(p.id, c.id)]?.reported_value ?? '')])],
    `${m.t.name.toLowerCase().replace(/\W+/g, '-')}.csv`);
  const exportCodebook = async (m, how) => {
    const rows = codebookRows(get(), m.cols);
    if (how === 'csv') { saveFile(codebookCsv(rows), 'extraction-codebook.csv', 'text/csv'); return; }
    const blob = await writeDocx({ blocks: codebookBlocks(rows), section: { pageW: 842, pageH: 595 }, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, 'extraction-codebook.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  };
  const exportLog = m => {
    const label = id => get().papers.find(p => p.id === id)?.label || id;
    const columnOf = id => m.cols.find(c => c.id === id) || m.cols.find(c => c.id === splitCellId(id).columnId) || { id };
    downloadCsv([['When', 'Study', 'Cell', 'Action', 'From', 'To', 'Reason', 'By'], ...(get().extractionLog || []).map(x => {
      const i = x.key.indexOf(':');
      return [x.at, label(x.key.slice(0, i)), columnOf(x.key.slice(i + 1)).label || x.key.slice(i + 1), x.action, x.from ?? x.value ?? '', x.to ?? '', x.reason || '', x.by || ''];
    })], 'extraction-log.csv');
  };
  return {
    pick: a => showMenu(a, templates().map(x => ({ label: x.name, checked: x.id === templateId, run: () => { setTemplate(x.id); ctx.rerender(); } }))),
    'fields-toggle': () => { showFields = !showFields; ctx.rerender(); },
    'ext-find': () => (findPressed() ? closeFind(ctx) : openFind(ctx)),
    summary: () => { openSummary(templateId); ctx.rerender(); },
    // the table and its tables as files: one entry in More, its formats as a menu where More was
    'ext-export': a => { const m = now(), publication = templateId !== 'default' && m.t.orientation === 'studies-rows'; showMenu(menuAnchor(a), [
      { label: 'Table · CSV', icon: 'table', run: () => exportCsv(m) },
      ...(templateId === 'default' ? ['-',
        { label: 'Table 1 · Word', run: () => exportCharacteristics('docx', ctx) },
        { label: 'Table 1 · CSV', run: () => exportCharacteristics('csv', ctx) },
        { label: 'Copy Table 1', icon: 'copy', run: () => exportCharacteristics('md', ctx) },
        { label: 'Table 1 to manuscript', run: () => exportCharacteristics('ms', ctx) }] : []),
      ...(publication ? ['-', ...evidenceExportItems(templateId, ctx.rerender)] : []),   // arms: publication table, with sources, Word tables
      // the codebook of the fields (plan G1, G8), and the log of locks and amendments (plan G4)
      ...(templateId === 'default' ? ['-', { label: 'Codebook · CSV', icon: 'table', run: () => exportCodebook(m, 'csv') }, { label: 'Codebook · Word', run: () => exportCodebook(m, 'docx') }] : []),
      ...((m.st.extractionLog || []).length ? [{ label: 'Extraction log · CSV', run: () => exportLog(m) }] : []),
    ]); },
    fill: a => openFill(menuAnchor(a), ctx, fillPage(now())),
    'fill-stop': () => stopFill(),
    'ext-make-table': async a => {
      const m = now(), hidden = new Set(columnsHidden(templateId, m.st));
      const view = { templateId, studies: m.matched.map(p => p.id), fields: m.cols.filter(c => !hidden.has(c.id)).map(c => c.id), title: m.t.name };
      const [pv, out] = await Promise.all([import('./package-view.mjs'), import('./outputs.mjs')]);
      pv.addTableFromView(menuAnchor(a), view, (item, part) => {
        out.selectShow('package'); out.openList();
        ctx.go('outputs');
        ctx.say?.(`Table added to ${part.name}: ${plural(view.studies.length, 'study', 'studies')}, ${plural(view.fields.length, 'field')}`);
      });
    },
    'from-abs': () => { const m = now(); fillAbstracts(ctx, { papers: m.matched, columns: m.cols, templateId }); },
    'add-cols': () => pick({ accept: '.csv,.tsv,.json,.txt' }, async files => {
      try { ctx.rerender(await (await import('../lib/columns-from-file.mjs')).addColumnsFromFile(files[0], templateId)); }   // read only when used: the start-up graph has a size budget
      catch (err) { ctx.rerender(String(err.message || err)); }
    }),
    'update-tbl': () => import('./evidence-update-ui.mjs').then(u => u.updateFromNewer(templateId, ctx)),
    'import-tbl': () => importTable(ctx, (id, r) => { setTemplate(id); ctx.rerender(r ? `${r.proposals} ${r.proposals === 1 ? 'value' : 'values'} proposed${r.note ? `. ${r.note}` : ''}` : ''); }, null, { into: templateId }),
    'ext-accept-clean': () => acceptClean(ctx),
    'ext-transpose': () => { setTransposed(templateId, !isTransposed(templateId)); editing = null; ctx.rerender(); },
    // the fields that are columns: a checked field is a column while the pane has room, an unchecked one is in each study's row detail
    'ext-columns': a => {
      const m = now(), hidden = new Set(columnsHidden(templateId, m.st)), inDetail = new Set(host.grid?.folded || []);
      const set = next => { setColumns(templateId, [...next]); ctx.rerender(); };
      showMenu(menuAnchor(a), [
        { label: 'Show all columns', disabled: !hidden.size, run: () => set([]) },
        '-',
        ...m.gridCols.map(c => ({ label: labelWithUnit(c), checked: !hidden.has(c.id), ...(inDetail.has(c.id) ? { meta: 'Row detail' } : {}), run: () => { const next = new Set(hidden); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); set(next); } }))]);
    },
    'ext-double': () => { setDouble(!doubleOn(get())); sel = null; editing = null; ctx.rerender(); },
    'ext-lock': async () => {
      const keys = lockableKeys(now());
      if (!await confirmAsk(`Lock ${keys.length} accepted ${keys.length === 1 ? 'value' : 'values'}?`, { detail: 'A locked value changes only by an amendment with a reason, which is logged.', confirm: 'Lock' })) return;
      lockValues(keys, 'reviewer'); ctx.rerender();
    },
    'ext-def-export': () => { const m = now(); saveFile(new Blob([templateJson({ ...m.t, columns: m.cols })], { type: 'application/json' }), `${(m.t.name || 'table').replace(/[^\w.-]+/g, '_')}.lykos-table.json`, 'application/json'); },
    'ext-def-import': () => pick({ accept: '.json' }, async files => {
      try { const tpl = templateFromJson(await files[0].text()); saveTemplate(tpl); setTemplate(tpl.id); ctx.rerender(`${tpl.name}: ${tpl.columns.length} columns`); }
      catch (err) { ctx.rerender(String(err.message || err)); }
    }),
    'ext-clear': async () => {
      // locked values stay: they change only by amendment (plan G4)
      const { colIds } = now(), V = get().values;
      const n = Object.keys(V).filter(k => keyInColumns(k, colIds) && !V[k]?.locked).length;
      if (!await confirmAsk(`Clear ${n} values?`, { confirm: 'Clear', danger: true })) return;
      update(s => { for (const k of Object.keys(s.values)) if (keyInColumns(k, colIds) && !s.values[k]?.locked) delete s.values[k]; return s; }); ctx.rerender(); ctx.refreshCounts();
    },
    'ext-remove': async () => {
      const t = templateById(templateId);
      if (!await confirmAsk(`Remove ${t.name}?`, { detail: 'Its values and proposals go with it', confirm: 'Remove', danger: true })) return;
      removeTemplate(templateId); setTemplate('default'); ctx.rerender();
    },
  };
}
/** Accept clean cells: what a batch stamped clean, after a counted confirmation (More, and the run's notice). */
async function acceptClean(ctx) { const note = await confirmAcceptCleanCells(templateId); if (note) { sel = null; ctx.rerender(note); ctx.refreshCounts(); } }

/** The title bar (lib/topbar.mjs): the table, its count and its commands; the page keeps one tools row (Filter, Pending, the rule filter). */
/** The table in view as the summary reads it: its studies and columns, not narrowed by the filter. */
function summaryModel() {
  const st = get(); currentTable(st);
  return { templateId, name: templateById(templateId).name, st, cols: columnsOf(templateId), all: includedOf(st, tableStudies(st, templateId)), focus: focusCell };
}
export function page(rerender) {
  // the summary sub-page: Back, its name and counts, Export in More
  if (summaryOpen()) {
    const m = summaryModel();
    return summarySpec({ studies: m.all.length, fields: m.cols.length }, { back: () => { summaryBack(); rerender(); }, export: a => summaryExport(menuAnchor(a), m) });
  }
  // the Word tables sub-page: Back to Extraction and its name
  if (wordTablesOpen()) return wordTablesSpec({ back: () => { closeWordTables(); rerender(); } });
  const m = tableModel(), ctx = live(rerender);
  liveCtx = ctx;
  const template = { ...m.t, columns: m.cols };
  return pageSpec({ name: m.t.name, tables: templates().length, empty: !m.all.length,
    status: m.counted.length ? statusText(m.shownCount, m.counted.length, m.valueCount) : '',
    isDefault: templateId === 'default', showFields, finding: findPressed(), shown: m.matched.length, running: fillRun.running,
    canFill: !fillRun.running && m.all.length > 0,
    canAbstract: configured(modelFor('extract')) && m.matched.some(p => p.abstract) && !fillRun.running,
    rules: rulesOverflow(ctx, template), clean: cellCounts(m.st, templateId).clean, transposed: !m.rowsMode, double: doubleOn(m.st), lockable: lockableKeys(m).length, values: m.valueCount, canColumns: m.rowsMode && m.gridCols.length > 1 }, commands(ctx));
}
/** The arrival notice goes under the tools row (the page's head is the title bar). */
export const arriveUnder = '#ext-tools';

// ---- typing in a cell -------------------------------------------------------------------------------------------------------

/**
 * Writes what a person typed into a cell; returns '' or why it was not written. "NR" is not reported. A proposal is accepted (edited
 * when the text differs); an accepted value corrected by hand keeps its evidence and says what it was; an empty cell takes a manual value.
 * In double extraction the text is the extractor's own entry.
 */
export function writeCell(paperId, columnId, text, column, table = templateId) {
  return writeCellValue(paperId, columnId, text, column, { table, double: doubleMode() });
}

const tdOf = (el, c) => el.querySelector(`td[data-cell="${CSS.escape(`${c.paperId}|${c.columnId}`)}"]`);
/**
 * Selects a cell: the two cells and the inspector change, the page is not drawn again (a table of a thousand studies stays as quick as one
 * of ten). `open` opens Details (a press); a key leaves Details as it is and redraws it when it shows.
 */
function selectCell(el, ctx, next, { open = false, keyboard = false } = {}) {
  const prev = sel ? tdOf(el, sel) : null;
  sel = { paperId: next.paperId, columnId: next.columnId };
  if (host.grid?.win) host.grid.win.reveal(host.papers.findIndex(p => p.id === sel.paperId));
  host.grid?.reveal(sel, { keyboard });   // a cell in a folded column opens its row detail first
  const td = tdOf(el, sel);
  if (!td) { ctx.rerender(); if (open) ctx.openDetails(); scheduleSelection(el, true); return; }
  prev?.classList.remove('sel'); td.classList.add('sel');
  if (open) ctx.openDetails(); else ctx.refreshDetails?.();
  revealSelectedCell(el, true);
}
/** Starts typing in the selected cell: `initial` is the key that started it (it replaces the value), else the value is kept to edit. */
function startEdit(el, ctx, c, initial = null) {
  if (!c || doubleMode() === 'compare') return false;
  const key = cellKey(c.paperId, c.columnId), v = get().values?.[key], pr = proposalFor(c.paperId, c.columnId);
  if (v?.locked) { ctx.say?.('Locked: amend it in Details'); return false; }
  const text = initial ?? (doubleMode() ? ownEntry(key) : v ? (v.availability === 'not_found' ? 'NR' : String(v.reported_value ?? '')) : pr ? String(pr.value ?? '') : '');
  sel = { paperId: c.paperId, columnId: c.columnId };
  editing = { ...sel, draft: String(text) };
  return mountEditor(el, ctx);
}
/** Puts the editor in its cell (again, after a repaint): Enter saves and goes down, Tab saves and goes across, Escape leaves it as it was. */
function mountEditor(el, ctx, { reveal = true } = {}) {
  const td = editing && tdOf(el, editing);
  if (!td) { editing = null; return false; }
  const column = columnsOf(templateId).find(x => x.id === splitCellId(editing.columnId).columnId) || { id: editing.columnId, type: 'text', label: '' };
  const study = get().papers.find(p => p.id === editing.paperId)?.label || '';
  // the cell keeps its text, hidden, under the field: the column keeps its width and nothing beside it moves
  td.classList.add('editing'); td.removeAttribute('title');
  td.innerHTML = `<span class="ext-cell-held" aria-hidden="true">${esc(td.textContent)}</span><input class="ext-cell-input" value="${esc(editing.draft)}" aria-label="${esc([column.label, study, doubleMode() ? entryLabel() : ''].filter(Boolean).join(', '))}" spellcheck="false" autocomplete="off"${numeric(column) ? ' inputmode="decimal"' : ''}>`;
  const input = td.querySelector('input');
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);   // the caret at the end, as F2 leaves it in a spreadsheet
  if (reveal) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const save = () => {
    const at = editing; if (!at) return true;
    const why = writeCell(at.paperId, at.columnId, input.value, column);
    if (why) { ctx.say?.(why); input.setAttribute('aria-invalid', 'true'); return false; }
    editing = null; return true;
  };
  input.oninput = () => { if (editing) editing.draft = input.value; input.removeAttribute('aria-invalid'); };
  input.onkeydown = e => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; ctx.rerender(); scheduleSelection(el, true); return; }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault(); e.stopPropagation();
    if (!save()) return;
    host.move?.(e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : 0, e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0);
    ctx.rerender(); ctx.refreshCounts?.(); scheduleSelection(el, true);
  };
  // A press elsewhere saves what was typed and shows it in the cell at once; the press itself repaints the page. A repaint that removed
  // the editor (a run going on) or the window losing focus keeps the draft: the editor comes back with the page.
  input.onblur = () => {
    if (!editing || !input.isConnected || !document.hasFocus()) return;
    if (!save()) return;
    const v = get().values?.[cellKey(sel.paperId, sel.columnId)], pr = proposalFor(sel.paperId, sel.columnId);
    td.classList.remove('editing', 'proposed'); td.textContent = shownOf(column, v, doubleMode() ? null : pr);
    ctx.refreshCounts?.();
  };
  return true;
}

export function render(el, ctx) {
  unwatchSelection?.();unwatchSelection=null;cancelAnimationFrame(selectionFrame);
  host = { el, ctx, papers: [], grid: null };
  if (wordTablesOpen()) { renderWordTables(el, ctx); return; }
  if (summaryOpen()) { renderSummary(el, ctx, summaryModel()); return; }
  const m = tableModel(), { st, t, cols, gridCols, studyCol, rowsMode, all, matched, pend, disagree } = m;
  disagreeCells = disagree.cells;
  if (!all.length) {
    const screening = (st.papers || []).length > 0;
    el.innerHTML = emptyState({ icon: 'extraction', title: screening ? 'No included studies' : 'No studies to extract from',
      actions: [screening ? { id: 'e-lib', label: 'Screening', icon: 'screening', primary: true } : { id: 'e-lib', label: 'Library', icon: 'library', primary: true }] });
    el.querySelector('#e-lib').onclick = () => ctx.go(screening ? 'screening' : 'library'); return;
  }
  const papers = matched; host.papers = papers;
  if (sel && (!papers.some(p => p.id === sel.paperId) || !cols.some(c => c.id === splitCellId(sel.columnId).columnId))) sel = null;   // arms: an arm's cell is its column's
  if (editing && !(sel && editing.paperId === sel.paperId && editing.columnId === sel.columnId)) editing = null;
  const V = st.values;
  const noMatches = emptyState({ icon: pendingOnly && !pend.size ? 'check' : 'search',
    title: pendingOnly && !pend.size ? 'No pending proposals' : 'No studies match your filters',
    actions: [{ id: 'ext-reset-filters', label: 'Show all studies' }], size: 'inline' });
  const cell = (p, c, id = c.id) => cellHtml(p, id === c.id ? c : { ...c, id }, V[cellKey(p.id, id)], proposalFor(p.id, id));   // arms: an arm's cell carries its own id
  const cellIdsOf = cellIdsFor(m);
  const columnOf = id => cols.find(c => c.id === id) || cols.find(c => c.id === splitCellId(id).columnId) || { id, type: 'text' };
  // What a field is (its definition, else its example) is its header's tooltip; the selected cell's Details shows it in full (Field definition).
  const about = c => { const g = fieldGuide(c); return g ? g.guide || (g.example ? `Example: ${g.example}` : '') : ''; };
  // a column's head: two lines of its title at most; a title the browser still cuts gets its full text before the definition (the grid sets it)
  const head = c => { const tip = about(c);
    return `<th scope="col" data-full="${esc(labelWithUnit(c))}"${tip ? ` data-title="${esc(tip)}" title="${esc(tip)}"` : ''}${numeric(c) ? ' class="num"' : ''}><span class="ui-head-cell"${numeric(c) ? ' data-align="end"' : ''}><span class="ui-head-label">${esc(labelWithUnit(c))}</span></span></th>`; };
  // a field as the head of a row (fields as rows) or of a folded field's row detail: its whole label, wrapped at its words, the definition as its tooltip
  const fieldHead = (c, label) => { const tip = about(c); return tip ? `<span title="${esc(tip)}">${esc(label)}</span>` : esc(label); };
  const studyHead = p => `<th scope="col" data-full="${esc(p.label || p.title || 'Untitled')}"${p.title ? ` data-title="${esc(p.title)}" title="${esc(p.title)}"` : ''}><span class="ext-head-label">${esc(p.label || p.title || 'Untitled')}</span></th>`;

  // The grid fits its pane (./extraction-grid.mjs, lib/table-fit.mjs): the columns that fit are drawn, the others are fields of their study's row
  // detail; a person's column picker (More > Columns) says which fields are columns first. A long table is drawn a window of studies at a
  // time (lib/table-window.mjs).
  const hiddenIds = new Set(rowsMode ? columnsHidden(templateId, st) : []);
  let ready = false;   // the rows put back what they hold (the editor, the focus) once the page is wired, not while it is first drawn
  const afterRows = ({ hadFocus }) => { if (!ready) return; if (editing) mountEditor(el, ctx, { reveal: false }); else if (hadFocus) el.querySelector('.cell.sel')?.focus({ preventScroll: true }); };
  // The page's head is the title bar (page()): the table, its count, Summary, Fill, Find and More. Under it, while Find has opened it or it
  // narrows the table, the tools row: the filter, and Show (all studies, those with pending values, with a disagreement, with a broken rule:
  // one choice, each with its count); what Suggest fixes is doing is its message, and keeps the row open while it runs.
  const showing = shownFilter();
  const showOptions = [['', 'All studies'], ['pending', pend.size ? `Pending · ${num(pend.size)}` : 'Pending'],
    // the disagreements of the table (DIALOGS #12), while it has any or the filter is on
    ...(disagree.cells.size || disagreeOnly ? [['disagree', disagree.cells.size ? `Disagreements · ${num(disagree.cells.size)}` : 'Disagreements']] : []),
    ...(rulesChoice() ? [rulesChoice()] : [])];   // cell rules
  const rowOpen = findOpen || !!filter || !!showing || !!rulesMessage();
  const tools = rowOpen ? uiBar({ kind: 'tools', label: 'Find studies', id: 'ext-tools',
    filters: [{ type: 'search', id: 'ext-filter', label: 'Filter studies and values', placeholder: 'Filter', value: filter },
      { type: 'select', id: 'ext-show', label: 'Show', value: showing, options: showOptions }],
    message: { id: 'ext-rules-run', text: rulesMessage() } }) : '';
  // what the last run came to, until the person dismisses it
  const ownRun = fillRun.templateId === templateId;
  const notice = ownRun && !fillRun.running ? summaryHtml({ clean: cellCounts(st, templateId).clean, pending: pend.size }) : '';
  el.innerHTML = `<div class="ext-layout">
  <div class="panel">${tools}
    ${doubleBarHtml(st, matched, cellIdsOf)}
    ${showFields && templateId === 'default' ? fieldsPanel(cols) : ''}
    ${notice}
    <div class="ext-body">${papers.length ? tableRegion({ label: `${t.name} table`, html: '' }) : `<div class="ext-empty">${noMatches}</div>`}</div>
  </div>
  </div>`;
  // the title bar's message while a run goes: a repaint clears it (app.mjs paint), so the page says it again
  if (fillRun.running && ownRun) ctx.say?.(fillMessage());
  const region = el.querySelector('.ext-body > .ui-table-region');
  // what a cell shows, for measuring its column: a study's arms each on their own lines (an arm's value is under its own key)
  const textOf = (p, c) => studyGrid(t, V, p.id, [c]).cells.flatMap(row => row.filter(Boolean)).map(x => { const id = x.arm ? `${c.id}@${x.arm}` : c.id; return shownOf(c, V[cellKey(p.id, id)], proposalFor(p.id, id)); }).filter(Boolean).join('\n');
  const studyColumn = studyCol && cols.find(c => c.id === studyCol);
  const grid = region ? createGrid({ region, templateId, rowsMode, papers, cols: gridCols, t, V, hidden: hiddenIds, windowFrom: WINDOW_FROM, cell, head, fieldHead, studyHead, numeric,
    label: labelWithUnit, textOf, rowNote: p => studyColumn ? shownOf(studyColumn, V[cellKey(p.id, studyCol)], null) : '', afterRows }) : null;
  host.grid = grid;
  grid?.refit(true);
  if (grid && sel) grid.reveal(sel);   // a selected cell in a folded column opens its row detail

  // ---- wiring ------------------------------------------------------------
  // The filter decides the rows, the selection, the title bar's count and enabled commands and the keyboard order, so it repaints the view
  // (and its title bar), once typing pauses.
  const fb = el.querySelector('#ext-filter');
  if (fb) fb.oninput = () => {
    filter = fb.value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      if (!fb.isConnected) return;
      const had = document.activeElement === fb, from = fb.selectionStart, to = fb.selectionEnd;
      ctx.rerender();
      const a = el.querySelector('#ext-filter');
      if (had && a) { a.focus(); a.setSelectionRange(from, to); }
    }, FILTER_DELAY);
  };
  // Escape in the empty filter closes the row when Show narrows nothing either
  fb?.addEventListener('keydown', e => { if (e.key === 'Escape' && !fb.value && !shownFilter()) { e.preventDefault(); e.stopPropagation(); closeFind(ctx); } });
  el.querySelector('#ext-reset-filters')?.addEventListener('click', () => { filter = ''; pendingOnly = false; disagreeOnly = false; showRules(false); ctx.rerender(); el.querySelector('#ext-show')?.focus(); });
  // Show: one of all studies, pending, disagreements and broken rules. Disagreements chooses the first of its cells, so the inspector shows its evidence at once
  const show = el.querySelector('#ext-show');
  if (show) show.onchange = () => {
    const v = show.value;
    pendingOnly = v === 'pending'; disagreeOnly = v === 'disagree'; showRules(v === 'rules');
    const p = disagreeOnly && !(sel && disagree.cells.has(cellKey(sel.paperId, sel.columnId))) ? matched.find(x => disagree.studies.has(x.id)) : null;
    const c = p && cols.find(x => disagree.cells.has(cellKey(p.id, x.id)));
    if (c) sel = { paperId: p.id, columnId: c.id };
    ctx.rerender(); if (c) ctx.openDetails();
    el.querySelector('#ext-show')?.focus();
  };
  // the first pending cell, in table order (the notice's Review)
  const reviewPending = () => { pendingOnly = true; sel = nextPending(templateId, null, order) || sel; ctx.rerender(); if (sel) { ctx.openDetails(); scheduleSelection(el, true); } };
  wireSummary(el, ctx, { review: reviewPending, accept: () => acceptClean(ctx) });

  // cells: a press selects the cell and opens its evidence; a second press on an empty cell, or a double press on any, types in it. One
  // listener on the table's body serves every cell, those a window draws later included.
  const cellOf = e => { const td = e.target.closest?.('td[data-cell]'); if (!td || td.classList.contains('editing')) return null; const [paperId, columnId] = td.dataset.cell.split('|'); return { paperId, columnId }; };
  const body = el.querySelector('.ext-body');
  grid?.wire(body);   // a row's opener and a long value's Show all, before the cell's own press
  body.addEventListener('click', e => {
    const c = cellOf(e); if (!c) return;
    const same = sel && sel.paperId === c.paperId && sel.columnId === c.columnId;
    if (same && !V[cellKey(c.paperId, c.columnId)] && !proposalFor(c.paperId, c.columnId) && startEdit(el, ctx, sel)) return;
    selectCell(el, ctx, c, { open: true });
  });
  body.addEventListener('dblclick', e => { const c = cellOf(e); if (c) startEdit(el, ctx, c); });
  if (grid?.win && sel && rowsMode) grid.win.reveal(papers.findIndex(p => p.id === sel.paperId));

  if(sel)scheduleSelection(el);
  // the pane's width decides the columns: a resize and Details opening or closing fit them again (no breakpoint), and so do the fonts arriving
  if (region) unwatchSelection = watchWidth(region, () => { grid.refit(); if (sel) scheduleSelection(el); });
  if (grid && document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (region.isConnected && host.grid === grid) grid.refit(true); });

  // keyboard: arrows move; Enter accepts a proposal or types; F2 or a letter types; E edits, R rejects, N not reported (a proposal);
  // Space next pending. In table order, each arm's own cells included, so Space reaches a proposal made for one arm.
  // (the cells drawn: the study's own name is the row head, not a column)
  const order = rowsMode
    ? papers.flatMap(p => studyGrid(t, V, p.id, gridCols).cells.flatMap(row => row.filter(Boolean).map(x => ({ paperId: p.id, columnId: x.arm ? `${x.columnId}@${x.arm}` : x.columnId }))))
    : gridCols.flatMap(c => papers.map(p => ({ paperId: p.id, columnId: c.id })));
  const move = (dr, dc) => {
    if (!sel) { sel = order[0]; return; }
    const pi = papers.findIndex(p => p.id === sel.paperId), ci = gridCols.findIndex(c => c.id === splitCellId(sel.columnId).columnId);
    const [np, nc] = rowsMode ? [pi + dr, ci + dc] : [pi + dc, ci + dr];
    // arms: the cell drawn in the same arm row, the study's own cell when it spans the arms
    if (papers[np] && gridCols[nc]) sel = { paperId: papers[np].id, columnId: rowsMode ? drawnCellId(t, V, papers[np].id, gridCols, gridCols[nc].id, np === pi ? armIndexOf(sel.columnId) : 0) : gridCols[nc].id };
  };
  host.move = move;
  // moving the selection changes two cells and the inspector, not the page
  const go = next => { if (next) selectCell(el, ctx, next, { keyboard: true }); };
  ctx.onKey(async e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.closest?.('.ui-pop, .ext-expand, .ext-more')) return;   // a popover, a row's opener and Show all keep their own keys
    const k = e.key, pr = sel && proposalFor(sel.paperId, sel.columnId);
    const steps = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    if (steps[k]) { e.preventDefault(); const was = sel; move(...steps[k]); const next = sel; sel = was; go(next); return; }
    if (k === ' ') { e.preventDefault(); go(nextPending(templateId, sel, order)); return; }
    // double extraction: Enter takes a proposal into the extractor's entry, N enters NR (plan G4)
    if (sel && doubleMode() && doubleMode() !== 'compare' && pr && ['enter', 'n'].includes(k.toLowerCase())) {
      const key = cellKey(sel.paperId, sel.columnId);
      if (get().values?.[key]?.locked) return;
      if (k === 'Enter') setEntry(key, doubleMode(), pr.value, { evidence: pr.evidence || [], from: 'proposal' }); else setEntry(key, doubleMode(), 'NR');
    }
    else if (sel && doubleMode() === 'compare') return;
    else if (pr && !doubleMode() && k === 'Enter') { try { accept(sel.paperId, sel.columnId); } catch (err) { ctx.say?.(err.message); return; } }
    else if (pr && !doubleMode() && k.toLowerCase() === 'e') { e.preventDefault(); startEdit(el, ctx, sel); return; }
    else if (pr && !doubleMode() && k.toLowerCase() === 'r') { const why = await ask('Reason', { placeholder: 'Why it is rejected', confirm: 'Reject' }); if (why != null) reject(sel.paperId, sel.columnId, why); }
    else if (pr && !doubleMode() && k.toLowerCase() === 'n') notReported(sel.paperId, sel.columnId);
    else if (sel && (k === 'Enter' || k === 'F2')) { e.preventDefault(); startEdit(el, ctx, sel); return; }
    else if (sel && k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(el, ctx, sel, k); return; }
    else return;
    e.preventDefault(); ctx.rerender(); ctx.refreshCounts(); scheduleSelection(el,true);
  });

  if (templateId === 'default') wireFields(el, ctx, { cols, V });
  wireRules(el);   // the layout while only broken rules are shown; the cell's rules and the editor are in the inspector (inspect)
  wireDoubleBar(el, ctx, { papers: matched, cellIds: cellIdsOf, columnOf });   // double extraction
  if (editing) mountEditor(el, ctx);
  ready = true;
  if (fillNext) { fillNext = false; requestAnimationFrame(() => { const b = document.getElementById('fill'); if (b && !b.disabled) b.click(); }); }
}

// A column as the inspector shows it: a field's unit in its label, its definition and instructions as guidance (plan G1).
const withGuidance = c => ({ ...c, label: labelWithUnit(c), guidance: c.guidance || [c.definition, c.instructions].filter(Boolean).join(' · ') });

let editingField = null;   // the custom field whose attributes are open in the Fields panel
function fieldsPanel(FS) {
  const row = f => f.id === editingField ? fieldForm(f) : `<div class="ext-field"><span>${esc(labelWithUnit(f))}</span><span class="meta">${esc([TYPES.find(t => t[0] === f.type)?.[1] || f.type,
      f.required ? 'Required' : '', f.options?.length ? f.options.join(', ') : '', Number.isFinite(f.min) || Number.isFinite(f.max) ? `${f.min ?? ''}–${f.max ?? ''}` : '', f.pattern ? 'Pattern' : ''].filter(Boolean).join(' · '))}</span>
        <button class="link" data-edit-field="${esc(f.id)}">Edit</button>
        <button class="icon" data-rm-field="${esc(f.id)}" title="Remove field" aria-label="Remove field">${icon('trash')}</button></div>`;
  return `<div class="ext-fields">
      <form id="field-add" class="an-settings ext-field-add">
        <label class="field"><span>Field name</span><input id="field-label" placeholder="Name" spellcheck="false" autocomplete="off"></label>
        <label class="field"><span>Type</span><select id="field-type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field" id="field-options-wrap" hidden><span>Levels</span><input id="field-options" placeholder="Comma-separated" spellcheck="false"></label>
        ${uiBar({ kind: 'tools', label: 'Add a field', id: 'field-add-bar', actions: [{ id: 'field-add-go', label: 'Add field', icon: 'plus', type: 'submit' }] })}
      </form>
      ${FS.filter(f => f.custom).map(row).join('')}
    </div>`;
}

// A review's own field in full (plan G1): unit, required, the values or range
// it admits, a pattern, and its codebook entry. The checks become cell rules.
function fieldForm(f) {
  const numericField = f.type === 'number' || f.type === 'integer';
  const input = (name, label, value, attrs = '') => formField(label, `<input name="${name}" value="${esc(value ?? '')}" spellcheck="false"${attrs}>`);
  const area = (name, label, value) => formField(label, `<textarea name="${name}" rows="2">${esc(value ?? '')}</textarea>`);
  return `<form class="cr-form ext-field-form" data-field-form="${esc(f.id)}"><div class="cr-form-kind">${esc(TYPES.find(t => t[0] === f.type)?.[1] || f.type)}</div>
    <div class="an-settings">${input('label', 'Name', f.label)}${input('unit', 'Unit', f.unit)}
    <label class="cr-check"><input type="checkbox" name="required"${f.required ? ' checked' : ''}><span>Required</span></label>
    ${numericField ? `${input('min', 'Minimum', f.min, ' type="number" step="any"')}${input('max', 'Maximum', f.max, ' type="number" step="any"')}` : ''}
    ${f.type === 'category' ? input('options', 'Levels', (f.options || []).join(', ')) : ''}
    ${f.type === 'text' ? `${area('allowed', 'Allowed values', (f.allowed || []).join('\n'))}${input('pattern', 'Pattern', f.pattern)}` : ''}
    ${area('definition', 'Definition', f.definition)}${area('instructions', 'Instructions', f.instructions)}</div>
    <div class="cr-error meta" hidden></div>
    ${uiBar({ kind: 'foot', label: 'Save the field', id: 'ext-field-foot', actions: [{ id: 'ext-field-cancel', label: 'Cancel', attrs: { 'data-cancel': '' } }, { id: 'ext-field-save', label: 'Save', type: 'submit' }] })}</form>`;
}

async function exportCharacteristics(how, ctx) {
    const t1 = characteristics(get());
    if (!t1.rows.length) { ctx.say?.('No included studies with extracted values'); return; }
    if (how === 'csv') saveFile(charCsv(t1), 'table-1-characteristics.csv', 'text/csv');
    else if (how === 'md') { try { await navigator.clipboard.writeText(charMarkdown(t1)); ctx.say?.('Table 1 copied'); } catch { ctx.say?.('The clipboard is not available: export Table 1 as Word or CSV'); } }
    else if (how === 'docx') {
      const blob = await writeDocx({ blocks: charBlocks(t1), section: { pageW: 792, pageH: 612 }, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
      await saveFile(blob, 'table-1-characteristics.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (how === 'ms') { await addTableAsset('Table 1 Characteristics of included studies', charCsv(t1), { caption: 'Characteristics of included studies' }); ctx.go('manuscript'); }
}

/** The built-in table's Fields panel: add a field, edit a custom field's attributes, remove one. */
function wireFields(el, ctx, { cols: FS, V: values }) {
  const typeSel = el.querySelector('#field-type'), optIn = el.querySelector('#field-options');
  typeSel?.addEventListener('change', () => { el.querySelector('#field-options-wrap').hidden = typeSel.value !== 'category'; });
  el.querySelector('#field-add')?.addEventListener('submit', e => {
    e.preventDefault();
    const label = el.querySelector('#field-label').value;
    if (!addField({ label, type: typeSel.value, options: optIn.value.split(',') })) return;
    ctx.rerender();
  });
  el.querySelectorAll('[data-edit-field]').forEach(b => b.onclick = () => { editingField = b.dataset.editField; ctx.rerender(); });
  el.querySelectorAll('[data-field-form]').forEach(form => {
    form.querySelector('[data-cancel]').onclick = () => { editingField = null; ctx.rerender(); };
    form.onsubmit = e => {
      e.preventDefault();
      const v = n => form.elements[n]?.value ?? '';
      const err = form.querySelector('.cr-error');
      const say = t => { err.hidden = false; err.textContent = t; };
      if (v('pattern').trim() && !validPattern(v('pattern').trim())) return say('Pattern does not compile');
      const min = v('min').trim(), max = v('max').trim();
      if (min !== '' && max !== '' && Number(min) > Number(max)) return say('Minimum is above maximum');
      updateField(form.dataset.fieldForm, { label: v('label'), unit: v('unit'), required: form.elements.required.checked, min, max,
        ...(form.elements.options ? { options: v('options').split(',') } : {}), allowed: v('allowed'), pattern: v('pattern'), definition: v('definition'), instructions: v('instructions') });
      editingField = null; ctx.rerender();
    };
  });
  el.querySelectorAll('[data-rm-field]').forEach(b => b.onclick = async () => {
    const f = FS.find(x => x.id === b.dataset.rmField);
    const n = Object.keys(values).filter(k => k.endsWith(`:${f.id}`)).length;
    if (n && !await confirmAsk(`Remove ${f.label}?`, { detail: `${n} ${n === 1 ? 'value' : 'values'} go with it`, confirm: 'Remove', danger: true })) return;
    removeField(f.id); ctx.rerender();
  });
}

/** Typing from Details: in the grid when the grid is in view beside it, else (Details lies over the grid) its one-field dialog. */
const editFromDetails = () => {
  if (document.getElementById('split')?.matches('.insp-over,.insp-sheet') || !host.el?.isConnected || !sel) return false;
  return startEdit(host.el, host.ctx, sel);
};

export function inspect(ctx) {
  const t = templateById(templateId), s = get();
  // an open rule editor takes the inspector, with or without a selected cell
  const editingRules = t && ruleEditorSections(ctx, { ...t, columns: columnsOf(templateId) });
  if (editingRules) return editingRules;
  // no cell chosen: the run, its steps and the table's earlier runs
  if (!sel) { const run = t && runSection(ctx, templateId); return run ? [run] : []; }
  if (!t || !tableStudies(s, templateId).some(p => p.id === sel.paperId)) return [];
  const c = columnsOf(templateId).find(c => c.id === splitCellId(sel.columnId).columnId);
  if (!c) return [];
  const column = withGuidance(armColumn(t, sel.paperId, c, sel.columnId));
  // while a run goes, its log follows the cell's evidence
  const run = fillRun.running ? runSection(ctx, templateId) : null;
  return [{ html: '<div class="evidence-detail"></div>', wire: host => {
    const options = { paperId: sel.paperId, columnId: sel.columnId, cellId: sel.columnId, column, ctx,
      value: s.values?.[cellKey(sel.paperId, sel.columnId)], proposal: proposalFor(sel.paperId, sel.columnId),
      onChange: () => { ctx.rerender(); ctx.refreshCounts(); }, onEdit: editFromDetails,
      // the panel's own reading of the cell: the table's studies, the field's approved grouping, what is wrong with it, and where its counts lead
      studies: includedOf(s, tableStudies(s, templateId)), templateId, mapping: s.extractionSummary?.fields?.[c.id] || null, disagree: disagreeCells.get(cellKey(sel.paperId, sel.columnId)) || [],
      rules: brokenCount(sel.paperId, sel.columnId), openList: drill => { openSummary(templateId, { drill }); ctx.rerender(); }, openSummary: () => { openSummary(templateId, { field: c.id }); ctx.rerender(); } };
    const render = doubleMode() ? (doubleMode() === 'compare' ? renderComparePanel : renderEntryPanel) : renderDetails;
    render(host.querySelector('.evidence-detail'), options);
    cellRulesBox(host.querySelector('.evidence-detail'), ctx, { ...t, columns: columnsOf(templateId) }, sel);   // the cell's rules, above its foot
  } }, ...(run ? [run] : [])];
}
