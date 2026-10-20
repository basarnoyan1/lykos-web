import { REGISTRY } from './registry.mjs';
import { formField, disclosure } from '../lib/ui-components.mjs';
import { outputFindings } from '../lib/output-checks.mjs';
import { journalContext } from '../lib/journal-context.mjs';
import { artifactHtml } from '../lib/research-artifacts.mjs';
import { assistantWork, outputSpecOf, questionFor, queryWords, rowsOf, partialNote } from '../lib/assistant-work.mjs';
import { removeResearchRecord } from '../lib/research-ledger.mjs';
import { renderAnswerBlocks } from '../lib/chat-blocks.mjs';
// Tables and figures (tables-and-figures amendment, 2026-09-28; the paper's items, 2026-10-17): the paper's tables and figures as things,
// not files (lib/paper-items.mjs, views/outputs-paper.mjs). Each has a type, a place (Figure 2, Table S1, or not placed yet; the page that
// owns its data) and its connections (what it is made from, what uses it: the dependency graph). Where the app draws it from its own data
// the item is that drawing, by the renderer its own page uses, and the folder's files of it are its printed versions, shown when asked.
// The project's own tables and charts are specs (lib/output-spec.mjs) kept with their versions; an output opens in place with Edit,
// Download and Write to folder. The assistant and MCP clients propose specs.
import { get, update, getVersion } from '../store.mjs';
import { esc, sanitizeSvg } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { askItem } from '../lib/chat-attach-menu.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { saveFile } from '../lib/save.mjs';
import { pageList } from '../lib/list-pager.mjs';
import { matcher, mergeAnswers } from '../lib/output-list.mjs';
import { pager, wirePager } from '../lib/paging.mjs';
import { when, ago, plural } from '../lib/dates.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiStatusLine, watchWidth } from '../lib/ui-actions.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { writeOutputs, svgToPng } from '../lib/project-folder.mjs';
import { researchType } from '../lib/workflow.mjs';
import { runQuery } from '../lib/project-query.mjs';
import { validateSpec, saveOutput, restoreOutput, removeOutput, outputById, currentSpec, builtinOutputs, isBuiltin,
  sourceLine, sourceLabel, newOutputId, CHART_TYPES, EXPORTS } from '../lib/output-spec.mjs';
import { renderOutput, chartSvg, outputFiles, outputStem, tableColumns, headCell, bodyCell } from '../lib/output-render.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { pendingMcpOutputs, settleMcpOutput } from '../lib/output-proposals.mjs';
import { folderPaper, itemsOf, nodeFacts, drawInto, openSource, imageOf, hasItemMenu, drawnMenu, drawnEmpty } from './outputs-paper.mjs';
import { sectionOf, SECTIONS, FILE_GROUPS, typeWord, canSetUp, captionTitle, captionSides } from '../lib/paper-items.mjs';
import { keysOfDrawn } from '../lib/app-items.mjs';
import { showSubset } from './library.mjs';
import { floatingCard, placeCard } from '../lib/chart-card.mjs';
import * as studyCharts from './study-charts.mjs';
import { loadAddons, addonCharts, addonChart } from '../lib/addons.mjs';

export const meta = { title: 'Tables and figures', icon: 'outputs' };
export const count = (...a) => REGISTRY.outputs.count(...a);

// page: 'list' | 'output' | 'edit' | 'versions' | 'record' (a piece of the assistant's saved work, nav.id its record id) | 'item' (a table or figure of the paper, nav.id its item id)
const nav = { page: 'list', id: null, draft: null, errors: [], feedback: '', from: 'list', chartPage: 0, tablePages: {}, openRows: new Set() };   // openRows: `${group}:${row}` of the rows shown in full
// Show, the title bar's switch: Results (the folder's tables and figures first, then Saved and Built in) and From chats (the assistant's
// answers, one row per question). The filter field above the list narrows the rows shown by name, accents folded.
const SHOW = [['results', 'Results'], ['chats', 'From chats'], ['package', 'Package']];
let show = 'results', query = '', stopPackage = null;
// the paper's items: the app's drawings, the folder's files and captions and the dependency graph, built again when one of them changes
// (the store changes its state in place: its version says when it changed)
let paperMemo = { s: null, version: -1, got: null, rows: null, captions: null, graph: null, out: null };
function paperNow() {
  const s = get(), version = getVersion(), got = folderPaper(activeFolder(), { onUpdate: arrived });
  if (paperMemo.s === s && paperMemo.version === version && paperMemo.got === got && paperMemo.rows === got?.rows && paperMemo.captions === got?.captions && paperMemo.graph === got?.graph) return paperMemo.out;
  const out = { ...itemsOf(s, got), loading: !!got && !got.rows, graph: got?.graph || null, folder: got?.folder || null };
  paperMemo = { s, version, got, rows: got?.rows, captions: got?.captions, graph: got?.graph, out };
  return out;
}
const itemOf = id => paperNow().items.find(it => it.id === id) || null;
// The folder's answers arrive after the page is drawn: the rows and captions redraw the page (they change its counts), the graph only the
// lines it adds to (each row's origin, an item's connections), in place, so nothing the person scrolled to moves.
function arrived(got) {
  const ctx = shownCtx; if (!ctx || !document.querySelector('.out-page')) return;
  if (nav.page === 'list' && show === 'results') {
    const body = document.querySelector('[data-out-body]');
    if (got.graph && body) { body.innerHTML = listHtml(); wire(body, ctx); loadPending(body, ctx); wireFiles(body, ctx); return; }
    return redraw(ctx);
  }
  if (nav.page === 'item') {
    if (!got.graph) return redraw(ctx);
    const host = document.querySelector('[data-item-links]'); if (host) linksInto(host, itemOf(nav.id));
  }
}
// Find: the list's filter row is closed until the title bar's Find or ⌘F opens it, and stays open while it narrows the list
let findOpen = false;
export function selectShow(key) { if (SHOW.some(([k]) => k === key)) show = key; }
export function setFilter(q) { query = String(q || ''); }
/** ⌘F (app.mjs findInView): on the list of tables and figures, opens the filter row and puts the caret in it. */
export function find() {
  if (nav.page !== 'list' || show === 'package' || !shownCtx) return false;
  if (!findOpen && !query) { findOpen = true; redraw(shownCtx); }
  document.querySelector('#out-q')?.focus();
  return true;
}
let pending = [];            // MCP definitions waiting for import
let fitChart = null;         // releases the chart's width hook
let pagers = [];             // the table and chart pagers of this render: [{ id, set(page) }]
let fitTables = [];          // releases the tables' width hooks
let shownCtx = null;         // the shell's context of the last render: the title bar's commands run with it

const TABLE_PAGE = 25;
const FORMAT_LABEL = { xlsx: 'Excel workbook', docx: 'Word table', csv: 'CSV', svg: 'SVG', png: 'PNG' };
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', svg: 'image/svg+xml', png: 'image/png' };
const TYPE_LABEL = { bar: 'Bar chart', column: 'Column chart', stacked: 'Stacked bars', dot: 'Dot plot', forest: 'Forest plot', timeline: 'Timeline', heat: 'Heat map' };

const entryOf = id => outputById(get(), id) || builtinOutputs(get()).find(o => o.id === id) || null;
const kindLabel = spec => spec.kind === 'chart' ? TYPE_LABEL[spec.chart?.type] || 'Chart' : 'Table';
const exportsOf = spec => spec.exports?.length ? spec.exports : EXPORTS[spec.kind];

// The included studies drawn as figures (views/study-charts.mjs): rows of the Built in list that open a page of their own, one figure each.
const STUDY_FIGURES = { field: 'Studies by characteristic' };   // publications per year is the built-in figure of that name
const studyOf = id => (id === 'field' && studyCharts.hasFieldChart(get())) ? STUDY_FIGURES[id] : '';
const workOf = id => assistantWork(get()).find(w => w.id === id) || null;
export const navigationState = () => ({ section: nav.page === 'output' || nav.page === 'versions' ? nav.id || '' : nav.page === 'record' ? `record:${nav.id}` : nav.page === 'study' ? `study:${nav.id}` : nav.page === 'item' ? `item:${nav.id}` : '' });
export function restoreNavigation(state) {
  const section = String(state?.section || '');
  if (section.startsWith('item:')) Object.assign(nav, { page: 'item', id: section.slice(5), printedOpen: false });
  else if (section.startsWith('record:') && workOf(section.slice(7))) Object.assign(nav, { page: 'record', id: section.slice(7) });
  else if (section.startsWith('study:') && studyOf(section.slice(6))) Object.assign(nav, { page: 'study', id: section.slice(6) });
  else if (section && entryOf(section)) Object.assign(nav, { page: 'output', id: section });
}
/** Opens a piece of the assistant's saved work in the page (it was the inspector's "Saved assistant work"). */
export function openRecord(id) { Object.assign(nav, { page: workOf(id) ? 'record' : 'list', id, feedback: '', chartPage: 0, tablePages: {}, openRows: new Set() }); }
/** Opens one output (from a proposal or the assistant). */
export function openList() { Object.assign(nav, { page: 'list', id: null, feedback: '' }); }
export function openOutput(id) { Object.assign(nav, { page: entryOf(id) ? 'output' : 'list', id, feedback: '', chartPage: 0, tablePages: {}, openRows: new Set() }); }
/** Opens one table or figure of the paper (lib/paper-items.mjs), its printed versions shown when `printed`. */
export function openItem(id, { printed = false } = {}) { Object.assign(nav, { page: 'item', id, feedback: '', chartPage: 0, tablePages: {}, openRows: new Set(), printedOpen: printed }); }

export function assistContext() {
  const paper = paperNow().items.map(it => `${it.name} (${typeWord(it.type)}${it.drawn ? `, drawn by ${it.drawn.viewLabel}` : ''}${it.printed.length ? `, ${it.printed.length} printed` : ''})`).slice(0, 40);
  const s = get(), list = (s.outputs || []).flatMap(o => { const sp = currentSpec(o); return sp ? [`${o.id}: ${sp.title} (${kindLabel(sp)}, v${o.versions?.at(-1)?.n ?? 1})`] : []; });
  const open = nav.id && entryOf(nav.id) ? currentSpec(entryOf(nav.id)) : null;
  return [`The paper's tables and figures: ${paper.join('; ') || 'none'}.`, `Saved outputs: ${list.length ? list.join('; ') : 'none saved'}. Use describe_data, query_project and propose_output.`,
    open ? `Open output spec (data): ${JSON.stringify(open).slice(0, 3000)}` : ''].filter(Boolean).join('\n');
}

export function unmount() { stopPreviews(); fitChart?.(); fitChart = null; fitTables.forEach(f => f()); fitTables = []; studyCharts.unmount(); stopPackage?.(); stopPackage = null; }
export const focus = () => (nav.page === 'study' ? studyCharts.focus() : null);
/** The output open on the page, for "Ask about this" (app.mjs). */
export const current = () => (nav.page === 'output' && entryOf(nav.id) ? nav.id : null);

// ---- the title bar ------------------------------------------------------------------------
// The page's head is the title bar (lib/topbar.mjs): the list names the page, counts it and offers New table and New figure; an output,
// its versions, its editor and a piece of the assistant's work are sub-pages, each with Back, its own name and its own commands. What an
// action reported is the bar's message on the list and the versions (the other sub-pages have a status line that carries it).
// an item waits while the folder is read (a restored page names one the folder gives); once read, one that is gone goes back to the list
const itemGone = () => { const p = paperNow(); return !p.loading && !p.items.some(it => it.id === nav.id); };
const checkPage = () => { if (nav.page === 'item' ? itemGone() : nav.page === 'record' ? !workOf(nav.id) : nav.page === 'study' ? !studyOf(nav.id) : nav.page !== 'list' && nav.page !== 'edit' && !entryOf(nav.id)) nav.page = 'list'; };
const message = () => (nav.page === 'list' || nav.page === 'versions' || nav.page === 'item' ? nav.feedback : '');
const redraw = ctx => ctx.rerender(message());
const goTo = (page, rerender) => { nav.page = page; nav.feedback = ''; nav.errors = []; rerender(); };

/** The title bar of the page in view, a pure function of the page's state; `run(act, extra)` makes a command's handler. */
export function pageSpec(st, run = () => () => {}) {
  // a table or figure of the paper: Open in the page that owns its data, its Download (a table the output renderer draws; a figure's
  // panel has its own), or Open in Files for one that is a file only; Show in Dependencies and Duplicate in More
  if (st.page === 'item') return { title: st.title, back: { label: 'Back to Tables and figures', run: run('back', { to: 'list' }) },
    actions: [...(st.open ? [{ id: 'out-item-open', label: `Open in ${st.open}`, run: run('item-source') }] : []),
      ...(st.file ? [{ id: 'out-item-file', label: 'Open in Files', run: run('item-file') }] : []),
      // a drawn table without a spec of its own (the search summary, Summary of findings) downloads from here too, its panel not headed twice
      ...(st.download ? [{ id: 'out-download', label: 'Download', icon: 'download', menu: true, disabled: !!st.downloadOff, run: run('item-download') }] : [])],
    overflow: [...(st.place ? [{ id: 'out-item-package', label: 'Add to package…', run: run('item-package') }, { id: 'out-item-insert', label: 'Insert in manuscript', run: run('item-insert') }] : []),
      ...(st.deps ? [{ id: 'out-item-deps', label: 'Show in Dependencies', run: run('item-deps') }] : []), ...(st.duplicable ? [{ id: 'out-item-duplicate', label: 'Duplicate', run: run('item-duplicate') }] : [])] };
  if (st.page === 'output') return { title: st.title, back: { label: 'Back to Tables and figures', run: run('back', { to: 'list' }) },
    actions: [st.builtin ? { id: 'out-duplicate', label: 'Duplicate', icon: 'duplicate', run: run('duplicate') } : { id: 'out-edit', label: 'Edit', run: run('edit') },
      { id: 'out-download', label: 'Download', icon: 'download', menu: true, disabled: !st.ready, run: run('download') }],
    // Write to folder is the last entry of Download, so a built-in output has no More of one entry.
    overflow: st.builtin ? [] : [{ id: 'out-package', label: 'Add to package…', run: run('place-package') }, { id: 'out-insert', label: 'Insert in manuscript', run: run('place-insert') }, '-',
      { id: 'out-versions', label: 'Versions', run: run('versions') }, { id: 'out-ask', label: 'Ask about this', run: run('ask') }, { id: 'out-copy-duplicate', label: 'Duplicate', run: run('duplicate') },
      { id: 'out-copy-spec', label: 'Copy spec', run: run('copy') }, '-', { id: 'out-delete', label: 'Delete', danger: true, run: run('delete') }] };
  if (st.page === 'study') return { title: st.title, back: { label: 'Back to Tables and figures', run: run('back', { to: 'list' }) },
    actions: [{ id: 'out-study-download', label: 'Download', icon: 'download', menu: true, run: run('study-download') }], overflow: [] };
  if (st.page === 'versions') return { title: `Versions · ${st.title}`, back: { label: `Back to ${st.title}`, run: run('back', { to: 'output' }) }, actions: [], overflow: [] };
  if (st.page === 'edit') return { title: st.title, back: { label: st.backTo ? `Back to ${st.backTo}` : 'Back to Tables and figures', run: run('back', { to: st.from }) },
    actions: [{ id: 'out-save', label: 'Save', role: 'primary', run: run('save') }], overflow: [] };   // Back is the one way out
  if (st.page === 'record') {
    // An answer with no rows cannot be saved as an output; Open in chat (to ask again) is then the page's one action.
    const chat = { id: 'out-rec-chat', label: 'Open in chat', run: run('record-chat') }, remove = { id: 'out-rec-delete', label: 'Delete', danger: true, run: run('record-delete') };
    return { title: st.title, back: { label: 'Back to Tables and figures', run: run('back', { to: 'list' }) },
      actions: st.saveable ? [{ id: 'out-rec-save', label: 'Save as output', role: 'primary', run: run('record-save') }] : st.empty ? [{ ...chat, role: 'quiet' }] : [],
      overflow: st.empty ? [remove] : [chat, '-', remove] };
  }
  if (st.show === 'package') return { title: 'Tables and figures', status: { text: `${st.parts} ${st.parts === 1 ? 'document' : 'documents'}`, ch: 14 },
    view: { id: 'out-show', label: 'Show', attr: 'data-out-show', value: 'package', items: SHOW, run: st.onShow || (() => {}) },
    // Find stays, disabled (the package lists no outputs to find in): the switch stands before the end group, so a Find that went
    // away moved it when Package was pressed
    find: { disabled: true, run: () => {} },
    actions: [{ id: 'pkg-build-changed', label: 'Build changed', role: 'primary', run: run('pkg-build-changed') }],
    overflow: [{ id: 'pkg-add-part', label: 'Add part', run: run('pkg-add-part') }, { id: 'pkg-import', label: 'Read from the folder\'s documents…', run: run('pkg-import') }, { id: 'pkg-files', label: 'Export figures as files…', run: run('pkg-files') }] };
  // the list: its counts, the Show switch, Find and one New menu (a table or a figure), so the bar holds one act
  return { title: 'Tables and figures', status: { text: st.show === 'chats' ? `${st.answers} ${st.answers === 1 ? 'answer' : 'answers'}` : `${plural(st.figures, 'figure')} · ${plural(st.tables, 'table')}`, ch: 24 },
    view: { id: 'out-show', label: 'Show', attr: 'data-out-show', value: st.show || 'results', items: SHOW, run: st.onShow || (() => {}) },
    // Find: the filter row, closed until asked for; the title bar draws it beside the panel toggles, pressed while the row is open or narrows the list
    find: { pressed: !!st.finding, run: run('find') },
    actions: [{ id: 'out-new', label: 'New', icon: 'plus', menu: true, run: run('new-menu') }], overflow: [] };
}
export function page(rerender) {
  checkPage();
  if ((get().outputs || []).some(o => currentSpec(o)?.query?.from === 'dependencies')) import('../lib/deps-source.mjs').then(() => rerender?.());   // a saved table of dependencies reads a source that loads on use
  const s = get(), run = (act, o = {}) => anchor => doAct(act, { id: nav.id, ...o, anchor }, shownCtx || { rerender, refreshCounts: () => {}, go: () => {} });
  if (nav.page === 'output') { const spec = currentSpec(entryOf(nav.id)); return pageSpec({ page: 'output', title: spec.title, builtin: isBuiltin(nav.id), ready: !!modelOf(spec).m }, run); }
  if (nav.page === 'study') return pageSpec({ page: 'study', title: studyOf(nav.id) }, run);
  if (nav.page === 'versions') return pageSpec({ page: 'versions', title: currentSpec(entryOf(nav.id)).title }, run);
  if (nav.page === 'edit') return pageSpec({ page: 'edit', from: nav.from, backTo: nav.from === 'output' && entryOf(nav.id) ? currentSpec(entryOf(nav.id)).title : '', title: !outputById(s, nav.draft.id) ? (nav.draft.kind === 'chart' ? 'New figure' : 'New table') : `Edit · ${nav.draft.title}` }, run);
  if (nav.page === 'record') { const w = workOf(nav.id), empty = emptyAnswer(w); return pageSpec({ page: 'record', title: w.title, empty, saveable: !empty && !!outputSpecOf(s, w.record) }, run); }
  if (nav.page === 'item') {
    const it = itemOf(nav.id), d = it?.drawn;
    if (!it) return pageSpec({ page: 'item', title: 'Tables and figures' }, run);
    return pageSpec({ page: 'item', title: it.name, open: d && d.view !== 'outputs' ? d.viewLabel : '', file: !d && !!it.printed.length, download: !!d?.spec || hasItemMenu(d), downloadOff: !d?.spec && !!drawnEmpty(d), duplicable: !!d?.spec, place: keysOfDrawn(d).length > 0 && !d.notRun,
      deps: !!(d?.node || it.printed.length) && !!activeFolder() }, run);
  }
  const paper = paperNow();
  return pageSpec({ page: 'list', show, finding: findOpen || !!query, parts: (s.package?.parts || []).length, onShow: key => { selectShow(key); rerender?.(); }, answers: mergeAnswers(assistantWork(s)).length,
    figures: paper.counts.figures + (s.outputs || []).filter(o => currentSpec(o)?.kind === 'chart').length, tables: paper.counts.tables + (s.outputs || []).filter(o => currentSpec(o)?.kind !== 'chart').length }, run);
}

let shownKey = null, listTop = 0, opensAt = null, waiting = false, leftList = false;   // the page last drawn, the list's place when an item opened from it
/** Where the view opens after this paint (app.mjs paint, given the place before it), once: the top of a page just opened, the list's place on the way back; else null. */
export function scrollPlace(before = 0) {
  if (leftList) { listTop = before; leftList = false; }   // the list's place as it was before this paint (app.mjs's snapshot)
  const at = opensAt; opensAt = null;
  return at;
}
// the addons' chart types (lib/addons.mjs) load with the page; once here, an editor or item open draws again with them
let addonsAsked = false;
export function render(el, ctx) {
  if (!addonsAsked) { addonsAsked = true; loadAddons().then(list => { if (list.length && el.isConnected) ctx.rerender(); }); }
  unmount();
  shownCtx = ctx;
  pagers = [];
  checkPage();
  // a page of its own (an item, an output, its editor) opens at its top; back on the list, the list is where it was left (scrollPlace)
  const key = `${nav.page}:${nav.id || ''}:${show}`, moved = key !== shownKey;
  leftList = moved && !!shownKey?.startsWith('list:');
  if (moved && shownKey != null) opensAt = nav.page === 'list' && !shownKey.startsWith('list:') ? listTop : 0;
  else if (!moved) opensAt = waiting ? listTop : null;
  waiting = nav.page === 'list' && opensAt > 0 && !!paperNow().loading;   // the list is short until the folder is read: its place waits for it
  shownKey = key;
  const html = nav.page === 'study' ? '<div id="out-study-body"></div>' : nav.page === 'item' ? itemHtml() : nav.page === 'output' ? outputHtml() : nav.page === 'edit' ? editHtml() : nav.page === 'versions' ? versionsHtml() : nav.page === 'record' ? recordHtml()
    : show === 'package' ? '<div class="pkg-root" data-pkg-root></div>' : `${findOpen || query ? filterBar() : ''}<div class="out-list-body" data-out-body>${listHtml()}</div>`;
  el.innerHTML = `<section class="out-page" data-page="${nav.page}">${html}</section>`;
  wire(el, ctx);
  if (nav.page === 'list' && show === 'package') {
    const host = el.querySelector('[data-pkg-root]');
    Promise.all([import('./package-view.mjs'), import('../lib/vcs-watch.mjs')]).then(([pv, w]) => { if (!host.isConnected) return; const folder = activeFolder(); stopPackage = pv.mountPackage(host, { say: m => ctx?.say?.(m), folder, repo: folder ? w.repoOf(folder) : null }); });
  }
  if (nav.page === 'list' && show !== 'package') {
    if (show === 'results') { loadPending(el, ctx); wireFiles(el, ctx); }
    // typing filters the list below the field; the field itself is never redrawn, so it keeps its caret
    const q = el.querySelector('#out-q'), body = el.querySelector('[data-out-body]');
    if (q && body) q.oninput = () => { query = q.value; body.innerHTML = listHtml(); wire(body, ctx); if (show === 'results') { loadPending(body, ctx); wireFiles(body, ctx); } };
    // Escape in the empty field closes the row
    q?.addEventListener('keydown', e => { if (e.key === 'Escape' && !q.value) { e.preventDefault(); e.stopPropagation(); findOpen = false; redraw(ctx); } });
  }
  if (nav.page === 'study') studyCharts.render(el.querySelector('#out-study-body'), ctx, nav.id);
  if (nav.page === 'item') drawItem(el, ctx);
  if (nav.page === 'list' && show === 'results') drawPrinted(ctx);
}

// ---- one table or figure of the paper -----------------------------------------------------------
// Its type, place and printed versions in one status line; then the item: the app's drawing by its own page's renderer, or, for an item
// that is a file only, its printed image as it is. Under it the caption's legend (closed), its connections (what it is made from, what uses
// it, from the dependency graph; Show in Dependencies for the whole path) and its printed versions (closed unless asked for), each a row
// that opens the file in Files.
const placeText = it => (it.label ? `${it.label}, ${it.place === 'supplement' ? 'supplement' : 'main text'}` : 'Not placed yet');
function itemHtml() {
  const it = itemOf(nav.id);
  if (!it) return `<p class="out-none meta">Reading the project folder</p>`;
  const d = it.drawn;
  // the item's type, place and source are rows of Details below the drawing, never one line of dot-joined parts; a run's feedback stands alone
  const meta = nav.feedback ? uiStatusLine({ id: 'out-meta', label: 'Item details', parts: [{ id: 'out-feedback', text: nav.feedback, drop: 0 }] }) : '';
  const spec = d?.spec, model = spec ? modelOf(spec) : null;
  const drawing = spec ? (model.error ? `<p class="out-error">${esc(model.error)}</p>` : bodyHtml(model.m)) : '<div class="tf-drawing" data-item-draw></div>';
  const legend = it.legend ? disclosure({ id: 'out-legend', title: it.kind === 'table' ? 'Caption' : 'Legend', className: 'out-legend', body: `<p class="tf-legend">${esc(`${it.label}. ${it.legend}`)}</p>` }) : '';
  const printed = it.printed.length ? disclosure({ id: 'out-printed-list', title: 'Printed versions', count: it.printed.length, open: !!nav.printedOpen, className: 'out-printed',
    body: uiList({ id: 'out-printed-rows', label: 'Printed versions', cols: COLS, rows: it.printed.map(r => uiRow({ table: true, attrs: { 'data-printed': r.path },
      main: { html: openTitle({ title: baseName(r.path) }, `data-act="file" data-path="${esc(r.path)}"`, r.part === 'caption' ? 'Document' : it.kind === 'table' ? 'Table' : 'Figure'),
        detail: detailOf([r.place, (r.copies?.length || 1) > 1 ? `${plural(r.copies.length - 1, 'copy', 'copies')} elsewhere` : '', r.part === 'caption' ? 'holds its caption' : ''].filter(Boolean).join(' · ')) },
      cells: [whenCell(r.mtime ? ago(r.mtime) : ''), sourceCell(r.formats.map(f => f.toUpperCase()).join(' · '), (r.copies || [r.path]).join('\n'))], end: uiRowEnd({ reserve: true }) })) }) }) : '';
  return `${meta}${drawing}${legend}<section class="out-section" data-item-links>${linksHtml(it, [])}</section>${printed}`;
}
/** The item's details as rows: its type, place and source, then what it is made from and what uses it (the graph's words added when read). */
function linksHtml(it, extra) {
  const made = [...new Set([...(it?.madeFrom || []), ...(extra.madeFrom || [])])], used = [...new Set([...(it?.usedBy || []), ...(extra.usedBy || [])])];
  const line = (id, label, list, none) => uiRow({ attrs: { 'data-link': id }, main: { html: `<span class="out-cell">${esc(label)}</span>`, detail: list.length ? list.map(esc) : [esc(none)], wrap: true } });
  // the whole path is Dependencies': its head's one act, there while a folder gives the graph something to show
  const deps = activeFolder() && (it?.drawn?.node || it?.printed.length);
  const head = uiBar({ kind: 'head', label: 'Details', id: 'out-links-head', cls: 'out-sec-head', lead: { title: 'Details', level: 'h2' },
    ...(deps ? { actions: [{ id: 'out-links-deps', label: 'Show in Dependencies' }] } : {}) });
  const facts = it ? [line('kind', 'Type', [typeWord(it.type)], ''), line('place', 'Placed', [placeText(it)], ''), line('source', 'Drawn by', [it.drawn ? it.drawn.viewLabel : 'File only'], ''),
    ...(it.printed.length ? [line('printed', 'Printed', [printedText(it)], '')] : [])] : [];
  return `${head}${uiList({ id: 'out-links', label: 'Details', rows: [...facts, line('from', 'Made from', made, paperNow().graph ? 'Nothing the project records' : 'Reading the project'),
    line('used', 'Used by', used, paperNow().graph ? 'Nothing the project records' : 'Reading the project')] })}`;
}
async function linksInto(host, it) {
  if (!host || !it) return;
  const extra = it.drawn?.node ? await nodeFacts(paperNow().graph, it.drawn.node) : {};
  if (!host.isConnected) return;
  host.innerHTML = linksHtml(it, extra);
  const deps = host.querySelector('#out-links-deps'); if (deps && shownCtx) deps.onclick = () => showDependencies(it, shownCtx);
}
async function drawItem(el, ctx) {
  const it = itemOf(nav.id), host = el.querySelector('[data-item-draw]');
  if (!it) return;
  linksInto(el.querySelector('[data-item-links]'), it);
  if (!host) return;
  if (it.drawn) { await drawInto(host, it.drawn, ctx); return; }
  // a file only: its newest printed image as it is (the folder's own pixels), else nothing to draw
  const image = it.printed.find(r => ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].some(x => r.paths?.[x]));
  const html = image ? await imageOf(activeFolder(), image) : '';
  if (host.isConnected) host.innerHTML = html ? `<figure class="tf-print">${html}<figcaption class="meta">${esc(baseName(image.path))}</figcaption></figure>` : '<p class="out-none meta">No image to show</p>';
}

// ---- details --------------------------------------------------------------------------------
/** Details: the spec of the output in view as JSON, read only, for the assistant and for copying. The page itself shows the table or figure. */
export function inspect() {
  const spec = nav.page === 'edit' ? nav.draft : nav.page === 'output' && entryOf(nav.id) ? currentSpec(entryOf(nav.id)) : nav.page === 'record' ? workOf(nav.id)?.record.block.spec : null;
  if (!spec) return [];
  return [{ title: 'Spec', html: `<textarea class="out-json" readonly rows="14" spellcheck="false" aria-label="Spec as JSON">${esc(JSON.stringify(spec, null, 2))}</textarea>` }];
}

// ---- list -------------------------------------------------------------------------
// One list page under the title bar (the page title, its counts, New and Find), grouped by where each item belongs in the paper: the main
// text's figures and tables in their numbered order, the supplement, what is not placed yet, then Saved (the project's own outputs) and
// Built in (what the app draws that the folder has no file of). Each row is one item: its name (the caption's words, never a file name),
// its type and where it comes from on the line under it ("From Appraisal · JBI case series", "Made by figure2.py"), when its printed
// versions last changed and how many there are. The folder's other files follow, quiet, in closed groups by what they are. A row's
// title opens it; its More opens the page that owns it, its printed versions and Dependencies.
const sectionHead = (id, title, text = '') => uiBar({ kind: 'head', label: title, id, cls: 'out-sec-head', lead: { title, level: 'h2' }, ...(text ? { status: { id: `${id}-count`, text, ch: text.length > 4 ? 16 : 4 } } : {}) });
const detailOf = (...parts) => parts.filter(x => x != null && x !== '').map(esc);
const KIND_ICON = { Table: 'table', Document: 'file', Infographic: 'image', 'Kaplan–Meier': 'curve' };
const kindIcon = kind => KIND_ICON[kind] || (/chart|figure|plot|map|diagram|timeline|bars/i.test(kind) ? 'image' : 'file');
const openTitle = (spec, attrs, kind, glyph = kind ? kindIcon(kind) : '') => `<button type="button" class="out-title" ${attrs} title="${esc(`${spec.title}${kind ? ` · ${kind}` : ''}`)}"${kind ? ` aria-label="${esc(`${spec.title}, ${kind}`)}"` : ''}>${glyph ? `<span class="out-kind" aria-hidden="true">${icon(glyph, { size: 14 })}</span>` : ''}<span class="out-title-text">${esc(spec.title)}</span></button>`;
const COLS = ['when', 'source'];
const cell = (col, text, ch, tip = text) => ({ col, kind: 'text', ch, html: `<span class="out-cell" title="${esc(tip)}">${esc(text)}</span>` });
const sourceCell = (label, tip) => cell('source', label, 20, tip);
const whenCell = at => cell('when', at, 12);
const section = (id, title, count, body, attrs = '') => `<section class="out-section" id="${id}"${attrs}>${sectionHead(`${id}-head`, title, count == null ? '' : String(count))}${body}</section>`;
const baseName = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);
/** An item's icon follows its type (a table or a figure), never its file's extension. */
const itemGlyph = it => (it.kind === 'table' ? 'table' : it.kind === 'document' ? 'file' : 'image');
/** Where an item comes from, in a few words: the page that draws it and from what, else the script that made its file. */
const originOf = it => (it.drawn ? it.drawn.origin : it.madeFrom[0] || (it.printed.length ? 'File only' : ''));
const printedText = it => (it.printed.length ? plural(it.printed.length, 'printed version') : '');

// ---- previews ------------------------------------------------------------------------------------------------------------------------------
// Each row leads with its table or figure drawn small (views/outputs-preview.mjs, loaded with the first row that comes into view). The box is
// reserved at its full size when the row is drawn, so a drawing that arrives moves nothing; a row drawn again shows the preview it had at
// once. A preview is kept by its item and the version of what it shows: the project's state for the app's drawings, the printed file's
// size and time for a file only; one whose version moved is drawn again when its row is next in view, its old drawing shown until then.
const previews = new Map();     // row id -> { key, kind, html, url? }
const previewOf = new Map();    // row id -> the item drawn (the list's current rows)
let previewIo = null, previewQueue = [], previewPump = null, previewMod = null, previewFrame = 0;
const previewKey = it => (it.drawn ? `v${getVersion()}` : `f${it.printed.map(r => `${r.path}:${r.mtime || 0}:${r.size || 0}`).join('|')}`);
function thumbSlot(it) {
  previewOf.set(it.id, it);
  const had = previews.get(it.id), fresh = had && had.key === previewKey(it);
  // a picture of what the row's name opens: a mouse's way in, its words the name's and the line's (hidden from a screen reader, never selected)
  return `<div class="tf-thumb" aria-hidden="true" data-tf-preview="${esc(it.id)}"${had ? ` data-tf-kind="${esc(had.kind)}"` : ''}${fresh ? ' data-tf-ready' : ''}>${had ? had.html : ''}</div>`;
}
function stopPreviews() { if (previewFrame) cancelAnimationFrame(previewFrame); previewFrame = 0; previewIo?.disconnect(); previewIo = null; previewQueue = []; }
function paintPreview(id) {
  const box = document.querySelector(`[data-tf-preview="${CSS.escape(id)}"]`), had = previews.get(id);
  if (!box || !had) return;
  box.innerHTML = had.html; box.dataset.tfKind = had.kind; box.setAttribute('data-tf-ready', '');
  performance.mark?.('lykos:tf-preview', { detail: id });
}
async function drawQueued() {
  previewMod ||= import('./outputs-preview.mjs');
  const mod = await previewMod;
  while (previewQueue.length) {
    const id = previewQueue.shift(), it = previewOf.get(id);
    if (!it) continue;
    const key = previewKey(it);
    if (previews.get(id)?.key !== key) {
      const got = await mod.drawPreview(it, { folder: activeFolder() }), old = previews.get(id);
      if (old?.url && old.url !== got.url) URL.revokeObjectURL(old.url);
      previews.set(id, { key, ...got });
    }
    paintPreview(id);
    await new Promise(r => setTimeout(r, 0));   // one drawing at a time: a press or a scroll is served between them
  }
}
const kickPreviews = () => { previewPump ||= drawQueued().catch(() => {}).finally(() => { previewPump = null; if (previewQueue.length) kickPreviews(); }); };
/** Draws each row's preview as the row comes into view (and a screen ahead of it), one at a time. */
function watchPreviews(el) {
  stopPreviews();
  const page = el.closest?.('.out-page') || el;
  const boxes = [...page.querySelectorAll('[data-tf-preview]')];
  // a press on a preview is a press on its row's title
  for (const box of boxes) box.onclick = () => box.closest('.ui-row')?.querySelector('.out-title')?.click();
  const todo = boxes.filter(b => !b.hasAttribute('data-tf-ready'));
  if (!todo.length || typeof IntersectionObserver !== 'function') return;
  // on the next frame: finding the scroller reads the styles of the page just drawn, which here computed them all in the middle of drawing it
  // (8 ms of a switch into Tables and figures, 2026-10-19); a frame later the browser has computed them anyway
  const watch = () => {
    previewFrame = 0;
    if (!todo[0].isConnected) return;
    // the scroller the rows are in (from a box, which is in the page: the list may be drawn before it is placed), so a screen ahead is of it
    let root = todo[0].parentElement;
    while (root && typeof getComputedStyle === 'function' && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    previewIo = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { previewIo?.unobserve(en.target); previewQueue.push(en.target.dataset.tfPreview); }
      kickPreviews();
    }, { root: root && root !== document.documentElement ? root : null, rootMargin: '100% 0px' });
    todo.forEach(b => previewIo.observe(b));
  };
  if (typeof requestAnimationFrame === 'function') previewFrame = requestAnimationFrame(watch); else watch();
}

function row(o) {
  const spec = currentSpec(o), v = o.versions.at(-1);
  return uiRow({ table: true, attrs: { 'data-output': o.id },
    main: { html: `${thumbSlot({ id: `saved:${o.id}`, drawn: { spec } })}${openTitle(spec, `data-act="open" data-id="${esc(o.id)}"`, kindLabel(spec))}`, detail: detailOf(kindLabel(spec), sourceLabel(spec, get()), ago(v.at)) },
    cells: [],
    end: uiRowEnd({ more: { label: `More for ${spec.title}`, attrs: { 'data-act': 'more', 'data-id': o.id } } }) });
}
/**
 * An item's line under its name: its type, where it comes from, and its printed versions and when they last changed; a file only says its
 * preview is the printed version (the app does not draw it), and names the script that made it when one did; so does a comparison not run yet.
 */
function itemLine(it) {
  const type = it.name.startsWith(typeWord(it.type)) ? '' : typeWord(it.type), when = it.mtime ? ago(it.mtime) : '';
  if (it.drawn) return [type, originOf(it), it.drawn.notRun && it.printed.length ? 'Printed version' : printedText(it), when];
  return [type, it.printed.length ? 'Printed version' : '', it.madeFrom[0] || '', when];
}
/** A row's one labelled action: a comparison the app could not run yet (fewer than two studies it can count) opens in Analysis. */
const rowAct = it => (it.drawn?.notRun ? { id: `out-source-${slug(it.id)}`, label: `Open in ${it.drawn.viewLabel}`, attrs: { 'data-act': 'item-source', 'data-id': it.id } } : null);
const slug = id => String(id).replace(/[^\w-]+/g, '-');
/** One table or figure of the paper: its name opens it (the included studies' chart opens its own page), its More the rest. */
function itemRow(it) {
  const d = it.drawn, study = d?.draw === 'study', link = d?.link;
  const act = study ? `data-act="study" data-id="field"` : link ? `data-act="go" data-view="${esc(d.view)}" data-section="${esc(d.section || '')}"` : `data-act="item" data-id="${esc(it.id)}"`;
  // a built-in output keeps its id, so "Ask about this" (lib/chat-attach-ui.mjs) attaches it as before
  return uiRow({ table: true, cls: 'out-item-row', attrs: { 'data-item': it.id, ...(study ? { 'data-study-figure': 'field' } : {}), ...(d?.spec && isBuiltin(d.spec.id) ? { 'data-output': d.spec.id } : {}) },
    main: { html: `${thumbSlot(it)}${openTitle({ title: it.name }, act, typeWord(it.type), itemGlyph(it))}`, detail: detailOf(...itemLine(it)), wrap: true },   // a narrow pane wraps the name, never cuts it
    cells: [],
    end: uiRowEnd({ primary: rowAct(it), more: { label: `More for ${it.name}`, attrs: { 'data-act': 'item-more', 'data-id': it.id } } }) });
}
/** A file of the folder that is no table or figure the page knows: its name in words, the file's own name and folder under it. */
function fileRow(r, kind) {
  const canPackage = kind === 'figures' || kind === 'tables';
  return uiRow({ table: true, attrs: { 'data-file-result': r.path },
    main: { html: openTitle({ title: r.words }, `data-act="file" data-path="${esc(r.path)}"`, kind === 'tables' ? 'Table' : kind === 'figures' ? 'Figure' : 'Document'), detail: detailOf(baseName(r.path), r.place, r.formats.map(f => f.toUpperCase()).join(', '), r.mtime ? ago(r.mtime) : '') },
    cells: [],
    end: canPackage ? uiRowEnd({ more: { label: `More for ${r.words}`, attrs: { 'data-file-more': r.path, 'data-kind': kind === 'tables' ? 'table' : 'figure', 'data-paths': JSON.stringify(r.paths) } } }) : uiRowEnd({ reserve: true }) });
}
const filterBar = () => uiBar({ kind: 'tools', id: 'out-tools', label: 'Filter', cls: 'out-tools', filters: [{ type: 'search', id: 'out-q', label: 'Filter tables and figures', placeholder: 'Filter', value: query }] });
const workRow = w => uiRow({ table: true, attrs: { 'data-record': w.id },
  main: { html: w.count > 1 ? `<span class="out-title-line">${openTitle(w, `data-act="record" data-id="${esc(w.id)}"`, w.kind)}<span class="out-dim">${w.count} answers</span></span>` : openTitle(w, `data-act="record" data-id="${esc(w.id)}"`, w.kind), detail: detailOf(w.source, w.at ? ago(w.at) : '') }, cells: [],
  end: uiRowEnd({ more: { label: `More for ${w.title}`, attrs: { 'data-act': 'record-more', 'data-id': w.id } } }) });

function listHtml() {
  const s = get(), m = matcher(query), keep = (...texts) => !m || m(...texts);
  if (show === 'chats') {
    const work = mergeAnswers(assistantWork(s)).filter(w => keep(w.title, w.source));
    // one list, no section head: the title bar's switch says From chats and its count how many
    return `<section class="out-section" id="out-assistant">${uiList({ id: 'out-work', label: 'From chats', attrs: { 'data-list': 'work', 'data-tf-list': '' }, rows: work.map(workRow),
      empty: `<p class="meta">${query ? 'No matches' : 'None yet'}</p>` })}</section>`;
  }
  const paper = paperNow();
  const items = paper.items.filter(it => keep(it.name, typeWord(it.type), originOf(it), ...it.printed.map(r => baseName(r.path))));
  const mine = [...(s.outputs || [])].filter(o => keep(currentSpec(o).title)).sort((a, b) => String(b.versions.at(-1)?.at).localeCompare(String(a.versions.at(-1)?.at)));
  // Nothing saved: no section (the title bar's New starts one)
  const own = mine.length ? section('out-saved', 'Saved', mine.length, uiList({ id: 'out-mine', label: 'Saved tables and figures', attrs: { 'data-list': 'mine', 'data-tf-list': '' }, rows: mine.map(o => row(o)) })) : '';
  // A built-in drawn from the included studies is left out until there is one: an empty preview is not a result (the item still opens by its id).
  let included = null;
  const hasData = it => it.drawn?.spec?.query?.from !== 'studies' || it.printed?.length
    || (included ??= (() => { try { return runQuery(s, { from: 'studies', limit: 1 }).total; } catch { return 1; } })()) > 0;
  const listOf = ([id, title]) => {
    const rows = items.filter(it => sectionOf(it) === id && (id !== 'app' || hasData(it)));
    // Built in is a list of its own id (out-built), as it was; the paper's sections are named by their place
    const listId = id === 'app' ? 'out-built' : `out-${id}-list`;
    return rows.length ? section(id === 'app' ? 'out-built-in' : `out-${id}`, title, rows.length, uiList({ id: listId, label: title, attrs: { 'data-list': id, 'data-tf-list': '' }, rows: rows.map(itemRow) })) : '';
  };
  const placed = SECTIONS.filter(([id]) => id !== 'app').map(listOf).join('');
  const reading = paper.loading ? `<p class="out-none meta" data-out-reading>Reading the project folder</p>` : '';
  // The folder's other files: each group a closed disclosure, a figure or a table able to join the package from its More
  const groups = FILE_GROUPS.map(([k, title]) => [k, title, paper.files[k].filter(r => keep(r.words, baseName(r.path), r.place))]).filter(([, , list]) => list.length);
  const total = groups.reduce((n, [, , list]) => n + list.length, 0);
  const files = total ? section('out-files', 'Other files', total, groups.map(([k, title, list]) => disclosure({ id: `out-files-${k}`, title, count: list.length, className: 'out-files',
    body: uiList({ id: `out-files-${k}-list`, label: title, attrs: { 'data-list': `files-${k}`, 'data-tf-list': '' }, rows: list.map(r => fileRow(r, k)) }) })).join('')) : '';
  const listed = items.some(it => sectionOf(it) !== 'app' || hasData(it));
  const none = !listed && !mine.length && !total && !paper.loading ? `<p class="out-none meta">${query ? 'No matches' : 'None yet'}</p>` : '';
  return `${reading}${placed}<section class="out-section" data-pending hidden></section>${own}${listOf(SECTIONS.find(([id]) => id === 'app'))}${files}${none}`;
}
/** A file row of the folder opens in Files; its More adds a figure or a table to the package. */
function wireFiles(el, ctx) {
  el.querySelectorAll('[data-file-more]').forEach(more => more.onclick = () => {
    // a figure goes in by its PNG or JPEG, a table by its workbook
    const paths = JSON.parse(more.dataset.paths || '{}'), path = paths.png || paths.jpg || paths.jpeg || paths.xlsx || more.dataset.fileMore;
    showMenu(more, [{ label: 'Add to package…', run: () => doAct('pkg-add', { anchor: more, path, kind: more.dataset.kind }, ctx) }], { align: 'end' });
  });
}
async function openFile(path, ctx) {
  const files = await import('./files.mjs');
  ctx.go?.('files'); files.show(path);
}
async function loadPending(el, ctx) {
  const folder = activeFolder();
  pending = await pendingMcpOutputs(folder).catch(() => []);
  const host = el.querySelector('[data-pending]');
  if (!host || !pending.length) return;
  host.hidden = false;
  host.innerHTML = `${sectionHead('out-pending-head', 'Defined through MCP', String(pending.length))}${uiList({ id: 'out-pending', label: 'Defined through MCP', cols: COLS, attrs: { 'data-tf-list': '' }, rows: pending.map((p, i) => uiRow({ table: true,
    main: { html: `<strong class="out-name" title="${esc(p.spec.title)}">${esc(p.spec.title)}</strong>` }, cells: [whenCell([outputById(get(), p.id) ? 'Update' : 'New', p.at ? ago(p.at) : ''].filter(Boolean).join(' · ')), sourceCell(sourceLabel(p.spec, get()), sourceLine(p.spec, get()))],
    end: uiRowEnd({ primary: { id: `out-import-${i}`, label: 'Import', attrs: { 'data-mcp': 'import', 'data-id': p.id } }, more: { label: `More for ${p.spec.title}`, attrs: { 'data-mcp-more': p.id } } }) })) })}`;
  const settle = async (id, accept) => {
    try { await settleMcpOutput(folder, id, { accept }); nav.feedback = accept ? 'Imported' : 'Discarded'; }
    catch (e) { nav.feedback = e.message; }
    redraw(ctx);
  };
  host.querySelectorAll('[data-mcp]').forEach(b => b.onclick = () => settle(b.dataset.id, true));
  host.querySelectorAll('[data-mcp-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Discard', danger: true, run: () => settle(b.dataset.mcpMore, false) }], { align: 'end' }));
}

// ---- one output ---------------------------------------------------------------------
// The title bar asks for the model before the page draws it (Download is disabled without one): one render per spec and project state.
let modelMemo = { spec: null, s: null, out: null };
function modelOf(spec) {
  const s = get();
  if (modelMemo.spec === spec && modelMemo.s === s) return modelMemo.out;
  let out; try { out = { m: renderOutput(s, spec) }; } catch (e) { out = { error: e.message }; }
  modelMemo = { spec, s, out };
  return out;
}

function pagerOf(id, { page, total, size, label, set }) {
  const pages = Math.ceil(total / size);
  if (pages > 1) pagers.push({ id, set });
  return pager({ id, page: page + 1, pages, total, label, size });
}
// A long text cell shows three lines (tableColumns); the chevron that leads its row shows the row in full, a query one concept
// to a line, with Copy under the chevron. Which rows are open is kept by group and row, so a redraw or another page keeps it.
const rowKey = (key, at) => `${key}:${at}`;
function openCell(rk, label, open) {
  const name = label || 'row';
  return `<td class="out-open"><button type="button" class="icon" data-act="row-open" data-row-key="${esc(rk)}" aria-expanded="${open}" aria-label="${esc(`${open ? 'Show less of' : 'Show all of'} ${name}`)}" title="${open ? 'Show less' : 'Show all'}">${icon(open ? 'chevron-down' : 'chevron-right', { size: 14 })}</button>`
    + `<button type="button" class="icon" data-act="row-copy" aria-label="${esc(`Copy the text of ${name}`)}" title="Copy">${icon('copy', { size: 14 })}</button></td>`;
}
function tableHtml(m, g, key, n) {
  const pages = Math.ceil(g.cells.length / TABLE_PAGE), p = Math.min(nav.tablePages[key] || 0, Math.max(0, pages - 1));
  const shown = g.cells.slice(p * TABLE_PAGE, (p + 1) * TABLE_PAGE), offset = p * TABLE_PAGE;
  const cols = tableColumns(m), opens = cols.some(c => c.long);
  const rows = shown.map((r, i) => {
    const at = offset + i, rk = rowKey(key, at), open = opens && nav.openRows.has(rk), long = opens && cols.some((c, j) => c.long && String(r[j] ?? '').length);
    return `<tr data-row="${at}"${open ? ' data-open' : ''}>${opens ? (long ? openCell(rk, String(r[0] ?? ''), open) : '<td class="out-open"></td>') : ''}${r.map((v, j) => bodyCell(cols[j], v)).join('')}</tr>`;
  }).join('');
  return `<div class="out-table-wrap"><table class="out-table"><thead><tr>${opens ? '<th class="out-open"><span class="visually-hidden">Show all</span></th>' : ''}${cols.map(headCell).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${
    pagerOf(`out-tp-${n}`, { page: p, total: g.cells.length, size: TABLE_PAGE, label: 'rows', set: next => { nav.tablePages[key] = next; } })}`;
}
// Which rows are cut by their three lines, measured (heights) at the width the table has; a row that is open keeps its chevron.
function fitTable(wrap) {
  const table = wrap.querySelector('table'); if (!table || typeof wrap.toggleAttribute !== 'function') return;   // nothing to measure without a layout
  const measure = () => {
    let any = false;
    for (const tr of table.querySelectorAll('tbody > tr')) {
      const clipped = tr.hasAttribute('data-open') || [...tr.querySelectorAll('.out-clamp')].some(c => c.scrollHeight > c.clientHeight + 1);
      tr.toggleAttribute('data-clipped', clipped); any ||= clipped;
    }
    return any;
  };
  if (measure() && !table.hasAttribute('data-clipped')) { table.setAttribute('data-clipped', ''); measure(); }
  else if (!table.querySelector('tr[data-clipped]')) table.removeAttribute('data-clipped');
}
function bodyHtml(m) {
  const notes = m.notes.length ? `<ul class="out-notes">${m.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  if (!m.result.total) return `<p class="out-none meta">No matching rows</p>${notes}`;   // one quiet line, not a hero
  if (m.spec.kind === 'chart') {
    const size = m.spec.chart.page || 40, units = m.chart.units || 0, pages = ['bar', 'dot', 'forest', 'stacked'].includes(m.chart.type) ? Math.ceil(units / size) : 1;
    // The page drawn is the page shown: an edit that leaves fewer rows brings it back in range.
    const p = nav.chartPage = Math.min(nav.chartPage, Math.max(0, pages - 1));
    return `<figure class="chart-fig out-chart"><div class="chart-svg" data-out-chart></div>${pagerOf('out-cp', { page: p, total: units, size, label: 'rows', set: next => { nav.chartPage = next; } })}</figure>${notes}`;
  }
  return `${m.groups.map((g, i) => `<section class="out-group">${m.grouped ? `<h3>${esc(g.label)}<span class="meta"> · ${g.rows.length}</span></h3>` : ''}${tableHtml(m, g, g.label, i)}</section>`).join('')}${notes}`;
}
// Checks: what the statistics and reference-style checks find in the text of the output in view. Nothing is drawn when they find
// nothing; otherwise one disclosure, closed, whose rows name the place and say the finding (read only: the output is not changed).
function checksHtml({ model = null, artifact = null } = {}) {
  const s = get(), found = outputFindings({ model, artifact, library: s.papers || [], style: journalContext(s).referenceStyle });
  if (!found.length) return '';
  const rows = found.map(f => uiRow({ attrs: { 'data-check': f.kind }, main: { html: `<span class="out-cell" title="${esc(f.message)}">${esc(f.message)}</span>`, detail: detailOf(f.where), wrap: true } }));
  return disclosure({ id: 'out-checks', title: 'Checks', count: found.length, className: 'out-checks', body: uiList({ id: 'out-check-list', label: 'Checks on this output', rows }) });
}
function outputHtml() {
  const o = entryOf(nav.id), spec = currentSpec(o), v = o.versions.at(-1), builtin = isBuiltin(o.id), { m, error } = modelOf(spec);
  const meta = uiStatusLine({ id: 'out-meta', label: 'Output details', parts: [{ id: 'out-kind', text: kindLabel(spec), drop: 1 }, { id: 'out-source', text: sourceLine(spec, get()), drop: 5 },
    ...(m ? [{ id: 'out-rows', text: `${plural(m.result.total, 'row')}${m.grouped ? ` · ${plural(m.groups.length, 'group')}` : ''}`, drop: 7 }] : []),
    { id: 'out-revision', text: builtin ? 'Built in' : `v${v.n} · ${ago(v.at)}`, drop: 3 }, ...(nav.feedback ? [{ id: 'out-feedback', text: nav.feedback, drop: 0 }] : [])] });
  return `${meta}${error ? `<p class="out-error">${esc(error)}</p>` : bodyHtml(m)}${m ? checksHtml({ model: m }) : ''}`;
}

// ---- versions -------------------------------------------------------------------------
function versionsHtml() {
  const o = entryOf(nav.id);
  const rows = [...o.versions].reverse().map((v, i) => uiRow({
    main: { html: `<span class="out-version-line"><span class="out-vnum">v${v.n}</span> ${esc(v.summary)}</span>`, detail: detailOf(i ? '' : 'Current', v.message, v.author, when(v.at)), wrap: true },
    end: i ? uiRowEnd({ more: { label: `More for v${v.n}`, attrs: { 'data-act': 'version-more', 'data-n': v.n } } }) : '' }));
  return uiList({ id: 'out-versions', label: 'Versions', rows });
}

// ---- the assistant's saved work ----------------------------------------------------------
// A record opens as a page of its own like an output: a query result as an output table, a proposed output drawn from the project as it is
// now, a draft document as its sections, anything else as the conversation showed it. One that is a table or figure of the project's data
// can be saved as an output; Open in chat shows it in its conversation, Delete takes it out of the saved work (the conversation keeps it).
// A query answer's only note is the plain one, and only when the table is the first rows of a longer answer (the conversation's own
// "N rows" and provenance wording are not repeated here).
const textModel = b => {
  const rows = (b.rows || []).map(r => r.map(v => String(v ?? ''))), numeric = j => rows.some(r => r[j] !== '') && rows.every(r => r[j] === '' || Number.isFinite(Number(r[j].replace(/,/g, ''))));
  return { spec: { kind: 'table' }, columns: (b.columns || []).map((label, j) => ({ label: String(label), type: numeric(j) ? 'number' : 'text' })), groups: [{ label: 'record', rows, cells: rows }], grouped: false,
    notes: [partialNote(rowsOf(b))].filter(Boolean), result: { total: rows.length } };
};
const emptyAnswer = w => w.record.block.type === 'table' && rowsOf(w.record.block).total === 0;
// An answer with no rows says so in one quiet line, then what was asked, so the question can be judged and asked again from the chat.
function askedHtml(w) {
  const question = questionFor(get(), w.record), words = queryWords(w.record.block.provenance?.query);
  return `<p class="out-none meta">No rows matched this question</p>${question || words ? `<ul class="out-notes">${question ? `<li>Asked: ${esc(question)}</li>` : ''}${words ? `<li>Query: ${esc(words)}</li>` : ''}</ul>` : ''}`;
}
function recordBody(w) {
  const b = w.record.block;
  if (emptyAnswer(w)) return askedHtml(w);
  if (b.type === 'table') { const m = textModel(b); return `${bodyHtml(m)}${checksHtml({ model: m })}`; }
  if (b.type === 'output' && b.spec) { const { m, error } = modelOf(b.spec); return error ? `<p class="out-error">${esc(error)}</p>` : `${bodyHtml(m)}${checksHtml({ model: m })}`; }
  if (b.type === 'artifact' && b.artifact) return `${artifactHtml(b.artifact)}${checksHtml({ artifact: b.artifact })}`;
  return `<div class="out-record">${renderAnswerBlocks([b], 0, get(), { detailed: true, live: true })}</div>`;
}
function recordHtml() {
  // The question is the page's name (the title bar's, one line, the whole of it in the tooltip); its commands are the bar's (pageSpec).
  const w = workOf(nav.id);
  const meta = uiStatusLine({ id: 'out-meta', label: 'Details', parts: [{ id: 'out-kind', text: w.kind, drop: 1 }, { id: 'out-source', text: w.source, drop: 5 },
    ...(w.at ? [{ id: 'out-revision', text: when(w.at), drop: 3 }] : []), ...(nav.feedback ? [{ id: 'out-feedback', text: nav.feedback, drop: 0 }] : [])] });
  return `${meta}${recordBody(w)}`;
}
function recordMenu(b, id, ctx) {
  const w = workOf(id); if (!w) return;
  showMenu(b, [...(!emptyAnswer(w) && outputSpecOf(get(), w.record) ? [{ label: 'Save as output', run: () => saveRecord(id, ctx) }] : []),
    { label: 'Open in chat', run: () => ctx.showResearchRecord?.(id) }, '-', { label: 'Delete', danger: true, run: () => deleteRecord(id, ctx) }], { align: 'end' });
}
function saveRecord(id, ctx) {
  const w = workOf(id), spec = w && !emptyAnswer(w) && outputSpecOf(get(), w.record); if (!spec) return;
  const v = validateSpec(spec, get());
  if (!v.ok) { nav.feedback = `Not saved: ${v.errors[0]}`; return redraw(ctx); }
  update(s => { saveOutput(s, v.spec, { author: 'Assistant' }); return s; });
  Object.assign(nav, { page: 'output', id: v.spec.id, feedback: 'Saved as v1', chartPage: 0, tablePages: {}, openRows: new Set() });
  ctx.refreshCounts?.(); redraw(ctx);
}
async function deleteRecord(id, ctx) {
  if (!(await confirmAsk('Delete this from the saved work?', { detail: 'The conversation keeps its answer.', confirm: 'Delete', danger: true }))) return;
  update(s => { removeResearchRecord(s, id); return s; });
  Object.assign(nav, { page: 'list', id: null, feedback: 'Deleted' }); redraw(ctx);
}

// ---- editing ----------------------------------------------------------------------------
function starter(kind) {
  const s = get(), tpl = (s.templates || []).find(t => Object.keys(s.values || {}).some(k => k.includes(`:${t.id}.`)));
  const base = { id: newOutputId(), kind, title: kind === 'chart' ? 'New figure' : 'New table' };
  if (kind === 'chart') return { ...base, query: { from: 'studies', groupBy: ['Year'], aggregate: ['count'], sort: 'Year' }, chart: { type: 'column', x: 'Year', y: 'Count' } };
  return { ...base, query: { from: 'studies', ...(tpl ? { template: tpl.name } : {}), select: ['Study label', 'Year', ...(tpl ? tpl.columns.slice(2, 5).map(c => c.label) : [])] } };
}
const resultColumns = spec => { try { return runQuery(get(), { ...spec.query, limit: 1 }).columns.map(c => c.label); } catch { return null; } };
const opt = (value, current, label = value) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
/** An addon chart's own fields: a column for each it maps (its required ones first), a plain value for each option (a scale's name, an MCID). */
const FIELD_LABEL = { x: 'X', y: 'Y', series: 'Series', pi: 'PI', llPre: 'LL before', llPost: 'LL after', ptPre: 'PT before', ptPost: 'PT after', svaPre: 'SVA before (mm)', svaPost: 'SVA after (mm)', scale: 'Scale', ref: 'MCID' };
function addonFields(ac, d, colSelect) {
  const label = f => ac.labels?.[f] || FIELD_LABEL[f] || f;
  return [...ac.fields.required.map(f => formField(label(f), colSelect(`chart.${f}`, d.chart?.[f], false))),
    ...ac.fields.optional.map(f => formField(label(f), colSelect(`chart.${f}`, d.chart?.[f]))),
    ...ac.options.map(f => formField(label(f), `<input data-field="chart.${f}" value="${esc(d.chart?.[f] ?? '')}" aria-label="${esc(label(f))}">`))];
}
function editHtml() {
  const d = nav.draft, cols = resultColumns(d) || [], chart = d.kind === 'chart', ct = d.chart?.type || 'bar';
  const colSelect = (field, value, optional = true) => `<select data-field="${field}" aria-label="${esc(field)}"${cols.length ? '' : ' disabled'}>${optional ? opt('', value || '', 'None') : ''}${cols.map(c => opt(c, value)).join('')}</select>`;
  const { m, error } = nav.errors.length ? { error: '' } : modelOf(d);
  const fields = [formField('Title', `<input data-field="title" value="${esc(d.title)}" aria-label="Title">`),
    formField('Kind', `<select data-kind-field aria-label="Kind">${opt('table', chart ? 'figure' : 'table', 'Table')}${opt('figure', chart ? 'figure' : 'table', 'Figure')}</select>`),
    ...(chart ? [formField('Chart', `<select data-field="chart.type" aria-label="Chart type">${CHART_TYPES.map(t => opt(t, ct, TYPE_LABEL[t])).join('')}${addonCharts().map(a => opt(a.id, ct, a.label)).join('')}</select>`),
      ...(addonChart(ct) ? addonFields(addonChart(ct), d, colSelect) : [formField('X', colSelect('chart.x', d.chart?.x, false)), formField('Y', colSelect('chart.y', d.chart?.y)), ...(ct === 'stacked' ? [formField('Series', colSelect('chart.series', d.chart?.series))] : [])])] : []),
    ...(!chart || ['bar', 'dot', 'forest'].includes(ct) ? [formField(chart ? 'Sections' : 'One table per', colSelect('groupRowsBy', d.groupRowsBy))] : []),
    formField('Notes', `<textarea data-field="notes" rows="2" aria-label="Notes">${esc(d.notes || '')}</textarea>`)];
  return `<div class="out-form">${fields.join('')}</div>
    ${nav.errors.length ? `<ul class="out-errors" role="alert">${nav.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <section class="out-section">${sectionHead('out-preview-head', 'Preview')}${error ? `<p class="out-error">${esc(error)}</p>` : m ? bodyHtml(m) : '<p class="meta">Fix the errors to preview</p>'}</section>`;
}
function setPath(obj, path, value) {
  const [a, b] = path.split('.');
  if (!b) { if (value === '' || value == null) delete obj[a]; else obj[a] = value; return; }
  obj[a] ||= {}; if (value === '' || value == null) delete obj[a][b]; else obj[a][b] = value;
}
function checkDraft(d) {
  const v = validateSpec(d, get());
  nav.errors = v.ok ? [] : v.errors;
  return v;
}

// ---- actions ----------------------------------------------------------------------------
async function download(spec, ext) {
  const { files, skipped } = await outputFiles(get(), spec, [ext], { svgToPng });
  if (!files.length) throw new Error(`${FORMAT_LABEL[ext]} is not available for this output${skipped.includes('png') ? ' here' : ''}`);
  const f = files[0];
  await saveFile(f.data, `${outputStem(spec)}.${f.ext}`, MIME[f.ext]);
}
async function writeToFolder(spec) {
  const folder = activeFolder(); if (!folder) return 'Open a project folder to write files';
  const { files, skipped } = await outputFiles(get(), spec, exportsOf(spec), { svgToPng });
  const r = await writeOutputs(folder, files, { typeId: researchType(get()).id });
  if (r.failed.length) return `Not written: ${r.failed.map(f => f.error).join('; ')}`;
  if (r.unchanged.length && !r.written.length) return 'Unchanged since the last version in the folder';
  return `Wrote ${r.written.join(', ')}${r.archived.length ? `; earlier version moved to ${r.archived[0].split('/').slice(0, -1).join('/')}` : ''}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`;
}

const duplicateOf = id => {
  const spec = structuredClone(currentSpec(entryOf(id)));
  nav.draft = { ...spec, id: newOutputId(), title: isBuiltin(id) ? spec.title : `${spec.title} (copy)` }; nav.from = nav.page; nav.errors = []; nav.page = 'edit';
};
async function deleteOutput(id, ctx) {
  if (!(await confirmAsk('Delete this output?', { detail: 'Its versions are removed from the project. Files already written stay in the folder.', confirm: 'Delete', danger: true }))) return;
  update(s => { removeOutput(s, id); return s; });
  nav.page = 'list'; nav.feedback = 'Deleted'; ctx.refreshCounts?.(); redraw(ctx);
}
/** Download: one entry per format the output exports, then Write to folder (every format into the project folder, earlier files kept). */
export function downloadItems(spec, { rerender }) {
  const folder = activeFolder();
  return [...exportsOf(spec).map(ext => ({ label: FORMAT_LABEL[ext], icon: ext === 'png' || ext === 'svg' ? 'image' : 'download', run: () => download(spec, ext).catch(err => { nav.feedback = err.message; rerender(); }) })),
    '-', { label: 'Write to folder', icon: 'folder', disabled: !folder, run: async () => { nav.feedback = await writeToFolder(spec).catch(err => err.message); rerender(); } }];
}
/** The More of a list row: built-in rows can only be duplicated. */
function rowMenu(b, id, ctx) {
  const rerender = () => redraw(ctx);
  const ask = askItem({ kind: 'output', ref: { outputId: id }, key: id });
  showMenu(b, isBuiltin(id) ? [{ label: 'Duplicate', run: () => { duplicateOf(id); rerender(); } }, '-', ask] : [
    { label: 'Add to package…', run: () => place('package', b, [{ key: `output:${id}` }], ctx) },
    { label: 'Insert in manuscript', run: () => place('insert', b, [{ key: `output:${id}` }], ctx) }, '-',
    { label: 'Versions', run: () => { nav.id = id; nav.page = 'versions'; rerender(); } },
    { label: 'Duplicate', run: () => { duplicateOf(id); rerender(); } },
    { label: 'Copy spec', run: () => navigator.clipboard?.writeText(JSON.stringify(currentSpec(entryOf(id)), null, 2)) },
    '-', ask, '-',
    { label: 'Delete', danger: true, run: () => deleteOutput(id, ctx) },
  ], { align: 'end' });
}

/** Dependencies, on the item's drawing or on its first printed file (Changes, views/changes.mjs focus). */
async function showDependencies(it, ctx) {
  const node = it.drawn?.node || (it.printed[0] ? `file:${it.printed[0].path}` : '');
  const changes = await import('./changes.mjs');
  changes.focus(node); ctx.go('changes');
}
/** The More of an item's row: the page that owns it, Dependencies, then its printed versions (each opens in Files), all of them on its page. */
function itemMenu(b, id, ctx) {
  const it = itemOf(id); if (!it) return;
  const d = it.drawn, shown = it.printed.slice(0, 5);
  const head = [...(d && d.view !== 'outputs' ? [{ label: `Open in ${d.viewLabel}`, run: () => openSource(d, ctx) }] : []),
    ...(activeFolder() && (d?.node || it.printed.length) ? [{ label: 'Show in Dependencies', run: () => showDependencies(it, ctx) }] : [])];
  const printed = shown.map(r => ({ label: `Open ${baseName(r.path)}`, run: () => openFile(r.path, ctx) }));
  if (it.printed.length > shown.length) printed.push({ label: `All ${it.printed.length} printed versions`, run: () => { openItem(id, { printed: true }); redraw(ctx); } });
  // a drawing of the app goes in as the app draws it, from the data at each build; a file only, by its PNG or workbook
  const keys = d?.notRun ? [] : keysOfDrawn(d), pkg = it.printed.find(r => r.part !== 'caption' && (r.paths?.png || r.paths?.jpg || r.paths?.jpeg || r.paths?.xlsx));
  const add = keys.length ? [{ label: 'Add to package…', run: () => place('package', b, keys, ctx) }, { label: 'Insert in manuscript', run: () => place('insert', b, keys, ctx) }]
    : pkg ? [{ label: 'Add to package…', run: () => doAct('pkg-add', { anchor: b, path: pkg.paths.png || pkg.paths.jpg || pkg.paths.jpeg || pkg.paths.xlsx, kind: it.kind === 'table' ? 'table' : 'figure' }, ctx) }] : [];
  const items = [head, printed, add].filter(x => x.length).flatMap((x, i) => (i ? ['-', ...x] : x));
  if (items.length) showMenu(b, items, { align: 'end' });
}

// ---- printed figures the app draws itself ---------------------------------------------------------------------------------------------------
// A figure of the paper that sets two sides against each other ("Any failure with dynamic versus rigid stabilization") is drawn by the app
// without being asked: its comparison is made from the caption and legend (lib/figure-comparison.mjs) and run in R in the background, once
// per figure. s.autoComparisons keeps which figure made which comparison, so one the reader removes in Analysis is not made again; a
// comparison set up by hand and never run is run the same way.
// A printed evidence map is drawn from the fields its legend names ("each rod and screw construct, stratified by fusion status": Rod type and
// Screw type by Fusion technique, lib/evidence-map.mjs fieldsNamedIn), once, unless the project has chosen a map's fields already.
// A printed synthesis without meta-analysis ("…of the studies of adult spinal deformity") is drawn from the collection its caption names: each
// arm's events by outcome with the direction of effect (lib/swim-events.mjs), s.swimTables keeping the collection chosen for each figure.
let comparing = false;
async function drawPrinted(ctx) {
  const paper = paperNow();
  if (comparing || paper.loading) return;
  const made = get().autoComparisons || {};
  const map = !get().evidenceMap && paper.items.find(it => it.type === 'evidence-map' && !it.drawn && it.label && !(`map:${it.label}` in made));
  if (map) {
    const em = await import('../lib/evidence-map.mjs'), fc = await import('../lib/figure-comparison.mjs');
    const legend = fc.legendOf(map, paper.items), named = em.fieldsNamedIn(get(), legend);
    // a legend that says its cells are shaded ("Cell shading is proportional to the count on a linear scale") is drawn shaded, on its scale
    const scale = /\b(linear|log\w*) scale for (?:the )?(?:number of )?(?:articles|studies|sources)\b/i.exec(legend)?.[1] || /\b(?:articles|studies|sources)\b[^,;.]*?\b(linear|log\w*)\b/i.exec(legend)?.[1] || 'linear';
    const shade = /shad|heat ?map/i.test(legend) ? (/^log/i.test(scale) ? 'log' : 'linear') : '';
    // a legend that counts patients too ("articles (left) and patients (right)") has a patients block, on the scale it names for them
    const ptScale = /\b(linear|log\w*) scale for (?:the )?(?:number of )?(?:patients|participants)\b/i.exec(legend)?.[1] || '';
    const patients = shade && /\b(?:patients|participants)\b/i.test(legend) ? (/^log/i.test(ptScale) ? 'log' : 'linear') : '';
    update(st => { if (named && !st.evidenceMap) st.evidenceMap = { rows: named.rows, row: named.rows[0], col: named.col, ...(shade ? { shade } : {}), ...(patients ? { patients } : {}) }; st.autoComparisons = { ...(st.autoComparisons || {}), [`map:${map.label}`]: named ? 'map' : '' }; return st; });
    if (named) { redraw(ctx); return; }
  }
  // a printed synthesis without meta-analysis: the collection its caption names (its words against the collections' names and the captions
  // the paper prints for their publication tables), once per figure; the evidence table's arms and counts are read each time it is drawn
  // the table the printed figure was made from, when the folder holds one (a JSON of its rows, named for it: swim_table.json), found once;
  // a figure drawn before this was known is looked at once more
  const dataFor = async () => {
    const folder = activeFolder(); if (!folder) return '';
    const [fr, se] = await Promise.all([import('../lib/folder-results.mjs'), import('../lib/swim-events.mjs')]);
    const found = (await fr.projectFiles(folder).catch(() => [])).filter(f => /swim[^/]*\.json$/i.test(f.path)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    for (const f of found) { try { if (se.rowsFromData(JSON.parse(new TextDecoder().decode(await folder.read(f.path))))) return f.path; } catch { /* not such a table */ } }
    return '';
  };
  const unsought = Object.entries(get().swimTables || {}).find(([, c]) => c && !('data' in c));
  if (unsought) {
    const data = await dataFor();
    update(st => { if (st.swimTables?.[unsought[0]]) st.swimTables[unsought[0]] = { ...st.swimTables[unsought[0]], data }; return st; });
    if (data) { redraw(ctx); return; }
  }
  const swim = paper.items.find(it => it.type === 'swim' && it.label && it.drawn?.draw !== 'swim-events' && !(`swim:${it.label}` in made));
  if (swim) {
    const [se, fc] = await Promise.all([import('../lib/swim-events.mjs'), import('../lib/figure-comparison.mjs')]);
    const tables = paper.items.filter(x => x.drawn?.concept?.startsWith('pubtable:')).map(x => ({ collection: x.drawn.collection, caption: x.caption || '', template: x.drawn.evidence }));
    const collection = se.collectionFor(get(), captionTitle(swim), tables);
    const template = tables.find(t => t.collection === collection)?.template || fc.tableFor(get())?.id || '';
    const data = collection && template ? await dataFor() : '';
    update(st => { if (collection && template) st.swimTables = { ...(st.swimTables || {}), [swim.label]: { collection, template, legend: fc.legendOf(swim, paper.items), data } };
      st.autoComparisons = { ...(st.autoComparisons || {}), [`swim:${swim.label}`]: collection && template ? collection : '' }; return st; });
    if (collection && template) { redraw(ctx); return; }
  }
  // a printed comparison drawn from its own counts: the arm-level table it was made from (RevMan_arm_level.csv), found once and run in R in the
  // background (lib/figure-counts.mjs; pooled in JavaScript where that gives metafor's numbers); the figure is then that forest plot, its line
  // naming the file, and Analysis keeps the evidence table's
  const runs = get().figureRuns || {};
  const own = paper.items.filter(it => it.label && it.kind === 'figure' && !runs[it.label] && !(`csv:${it.label}` in made) && captionSides(captionTitle(it)));
  if (own.length && activeFolder()) {
    comparing = true;
    try {
      const [fr, fcnt, fc, sp, cr, rr, ai, mc] = await Promise.all([import('../lib/folder-results.mjs'), import('../lib/figure-counts.mjs'), import('../lib/figure-comparison.mjs'),
        import('../lib/spreadsheet.mjs'), import('../lib/contrast-r.mjs'), import('../lib/r.mjs'), import('../lib/analysis-inputs.mjs'), import('../lib/meta-contrast.mjs')]);
      const folder = activeFolder(), csvs = [];
      for (const f of (await fr.projectFiles(folder).catch(() => [])).filter(x => /\.csv$/i.test(x.path)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))) {
        try { csvs.push({ path: f.path, rows: sp.parseDelimited(new TextDecoder().decode(await folder.read(f.path)).replace(/^\uFEFF/, '')).rows }); } catch { /* not a table */ }
      }
      for (const it of own) {
        const sides = captionSides(captionTitle(it)), legend = fc.legendOf(it, paper.items);
        let found = null;
        for (const f of csvs) { const c = fcnt.countsFor(f.rows, sides, legend); if (c) { found = { ...c, path: f.path }; break; } }
        update(st => { st.autoComparisons = { ...(st.autoComparisons || {}), [`csv:${it.label}`]: found?.path || '' }; return st; });
        if (!found) continue;
        const measure = fc.measureIn(legend), totals = !/not pooled|without (?:a )?pooled|no pooled|not combined/i.test(legend);
        // a study with no events in either arm is not estimable for a ratio and is left out, as Analysis and RevMan leave it (lib/analysis-inputs.mjs)
        const zero = ai.zeroEvents(measure, found.rows.map(r => r.values)), used = zero.used.map(i => found.rows[i]);
        if (used.length < 2) continue;
        // pooled at once in JavaScript where it gives metafor's numbers (lib/meta-contrast.mjs: RR or OR, REML, Wald intervals, checked to 1e-9),
        // else in R
        let res = null;
        if (mc.handles({ measure, method: 'REML', test: 'z' })) res = mc.poolContrast(used.map(r => r.values), { measure, method: 'REML' });
        else {
          const { code } = cr.contrastScript({ rows: used.map(r => ({ label: r.label, study: r.label, values: r.values, level: null })), measure, method: 'REML', test: 'z', pi: 'follow' });
          res = await rr.runR(['metafor', 'svglite'], code).catch(() => null);
          if (res) { delete res.svg; delete res.funnel; }   // the app draws the forest from the numbers; R's own drawing is not kept
        }
        if (!res) continue;
        const low = w => String(w).toLowerCase();
        update(st => { st.figureRuns = { ...(st.figureRuns || {}), [it.label]: { ...res, measure, method: 'REML', test: 'z', totals, source: found.path, outcomeName: found.outcome,
          contrast: { treated: sides.treated, control: sides.control }, favours: [`Favours ${low(sides.treated)}`, `Favours ${low(sides.control)}`],
          labels: used.map(r => r.label), values: used.map(r => r.values), excluded: zero.excluded.map(i => found.rows[i].label), at: new Date().toISOString() } }; return st; });
      }
    } finally { comparing = false; }
    redraw(ctx);
  }
  const todo = paper.items.filter(it => it.label && it.kind === 'figure'
    && ((canSetUp(it) && !(it.label in made)) || (it.drawn?.draw === 'forest' && it.drawn.notRun && !made[`ran:${it.label}`])));
  if (!todo.length) return;
  comparing = true;
  try {
    const [fc, cmp] = await Promise.all([import('../lib/figure-comparison.mjs'), import('./analysis-comparative.mjs')]);
    for (const it of todo) {
      let oid = it.drawn?.slot || '';
      if (!oid) {
        const plan = fc.planFromCaption(get(), { label: it.label, caption: captionTitle(it), legend: fc.legendOf(it, paperNow().items) });
        update(st => { if (plan) oid = fc.applyPlan(st, plan); st.autoComparisons = { ...(st.autoComparisons || {}), [it.label]: oid }; return st; });
        if (!oid) continue;
      }
      update(st => { st.autoComparisons = { ...(st.autoComparisons || {}), [`ran:${it.label}`]: oid }; return st; });
      await cmp.runComparison(oid).catch(() => {});   // R's run is a background job of its own (lib/r.mjs), in the status bar while it runs
    }
  } finally { comparing = false; }
  ctx.refreshCounts?.();
  if (nav.page === 'list') redraw(ctx);
}

/**
 * Add to package… or Insert in manuscript for a drawing of the app (views/paper-place.mjs): with two drawings (the risk-of-bias plots, the
 * SWiM table and its harvest plot) a menu names them first. What it did is the page's message.
 */
function place(how, anchor, keys, ctx) {
  const rerender = () => redraw(ctx), say = text => { nav.feedback = text; rerender(); };
  const one = async key => {
    const pp = await import('./paper-place.mjs');
    try {
      if (how === 'package') await pp.addToPackage(anchor, key, (made, part, label) => say(`Added to ${part.name} as ${label}`));
      else say(`Inserted at the end of the manuscript as ${await pp.insertInManuscript(key)}`);
    } catch (err) { say(err.message); }
  };
  if (keys.length > 1) return showMenu(anchor, keys.map(k => ({ label: k.label, run: () => one(k.key) })), { align: 'end' });
  return one(keys[0].key);
}

/** One command of the page, from a row (its data-act) or the title bar (pageSpec's run): `o` carries id, kind, to, view, section, n and the anchor. */
async function doAct(act, o, ctx) {
  const rerender = () => redraw(ctx), id = o.id || nav.id, b = o.anchor;
  if (act.startsWith('pkg-')) { const pv = await import('./package-view.mjs'); return act === 'pkg-add' ? pv.addToPackage(b, { path: o.path, kind: o.kind }) : pv.act(act.slice(4), { anchor: b }); }
  if (act === 'record') { openRecord(id); return rerender(); }
  if (act === 'record-more') return recordMenu(b, id, ctx);
  if (act === 'record-save') return saveRecord(id, ctx);
  if (act === 'record-chat') return ctx.showResearchRecord?.(id);
  if (act === 'record-delete') return deleteRecord(id, ctx);
  if (act === 'back') return goTo(o.to, rerender);
  if (act === 'new-menu') return showMenu(b, [{ label: 'New table', icon: 'table', run: () => doAct('new', { kind: 'table' }, ctx) }, { label: 'New figure', icon: 'image', run: () => doAct('new', { kind: 'chart' }, ctx) }]);
  if (act === 'file') return openFile(o.path, ctx);
  if (act === 'item') { openItem(id); return rerender(); }
  if (act === 'item-more') return itemMenu(b, id, ctx);
  if (act.startsWith('item-')) {
    const it = itemOf(id), d = it?.drawn; if (!it) return;
    if (act === 'item-source' && d) return openSource(d, ctx);
    if (act === 'item-file' && it.printed[0]) return openFile(it.printed[0].path, ctx);
    if (act === 'item-download' && d?.spec) return showMenu(b, downloadItems(d.spec, { rerender }));
    if (act === 'item-download' && d) { const items = await drawnMenu(d, msg => { nav.feedback = msg; rerender(); }); if (items) showMenu(b, items); return; }
    if (act === 'item-duplicate' && d?.spec) { nav.draft = { ...structuredClone(d.spec), id: newOutputId() }; nav.from = 'list'; nav.errors = []; nav.page = 'edit'; return rerender(); }
    if (act === 'item-deps') return showDependencies(it, ctx);
    if (act === 'item-package' || act === 'item-insert') return place(act === 'item-package' ? 'package' : 'insert', b, keysOfDrawn(d), ctx);
    return;
  }
  if (act === 'place-package' || act === 'place-insert') return place(act === 'place-package' ? 'package' : 'insert', b, [{ key: `output:${id}` }], ctx);
  if (act === 'find') { if (findOpen || query) { findOpen = false; query = ''; } else findOpen = true; rerender(); if (findOpen) document.querySelector('#out-q')?.focus(); return; }
  if (act === 'go') return o.view === 'reporting' && ctx.openReporting ? ctx.openReporting(o.section) : ctx.go(o.view);
  if (act === 'study-download') return studyCharts.downloadMenu(nav.id, b);
  if (act === 'open') { openOutput(id); return rerender(); }
  if (act === 'study') { if (!studyOf(id)) return; Object.assign(nav, { page: 'study', id, feedback: '' }); return rerender(); }
  if (act === 'new') { nav.from = nav.page === 'output' ? 'output' : 'list'; nav.draft = starter(o.kind); nav.errors = []; nav.page = 'edit'; return rerender(); }
  if (act === 'edit') { nav.from = 'output'; nav.draft = structuredClone(currentSpec(entryOf(nav.id))); nav.errors = []; nav.page = 'edit'; return rerender(); }
  if (act === 'duplicate') { duplicateOf(id); return rerender(); }
  if (act === 'versions') { nav.id = id; nav.page = 'versions'; return rerender(); }
  if (act === 'ask') return askItem({ kind: 'output', ref: { outputId: id }, key: id }).run();
  if (act === 'copy') return navigator.clipboard?.writeText(JSON.stringify(currentSpec(entryOf(id)), null, 2));
  if (act === 'delete') return deleteOutput(id, ctx);
  if (act === 'save') {
    const v = checkDraft(nav.draft); if (!v.ok) return rerender();
    let n = 0; update(s => { n = saveOutput(s, v.spec, { author: 'You' }).version?.n || 0; return s; });
    Object.assign(nav, { page: 'output', id: v.spec.id, feedback: n ? `Saved as v${n}` : 'No changes', chartPage: 0, tablePages: {} });
    ctx.refreshCounts?.(); return rerender();
  }
  if (act === 'download') return showMenu(b, downloadItems(currentSpec(entryOf(nav.id)), { rerender }));
  if (act === 'row-open') {
    const tr = b.closest('tr'), k = o.rowKey, open = !nav.openRows.has(k);
    if (open) nav.openRows.add(k); else nav.openRows.delete(k);
    tr.toggleAttribute('data-open', open);
    const name = b.getAttribute('aria-label').replace(/^Show (all|less) of /, '');
    b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', `${open ? 'Show less of' : 'Show all of'} ${name}`); b.title = open ? 'Show less' : 'Show all';
    b.innerHTML = icon(open ? 'chevron-down' : 'chevron-right', { size: 14 });
    const wrap = b.closest('.out-table-wrap'); if (wrap) fitTable(wrap);
    return;
  }
  if (act === 'row-copy') {
    const text = [...b.closest('tr').querySelectorAll('.out-clamp')].map(c => c.textContent).filter(Boolean).join('\n\n');
    return navigator.clipboard?.writeText(text).then(() => { b.innerHTML = icon('check', { size: 14 }); b.title = 'Copied'; }).catch(() => {});   // the check stays until the row is drawn again
  }
  if (act === 'more') return rowMenu(b, id, ctx);
  if (act === 'version-more') { const n = Number(o.n); return showMenu(b, [{ label: 'Restore', run: () => { update(s => { restoreOutput(s, nav.id, n, { author: 'You' }); return s; }); nav.feedback = `Restored v${n} as a new version`; nav.page = 'output'; rerender(); } }], { align: 'end' }); }
}

function wire(el, ctx) {
  const rerender = () => redraw(ctx);
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => doAct(b.dataset.act, { id: b.dataset.id || nav.id, kind: b.dataset.kind, to: b.dataset.to, view: b.dataset.view, section: b.dataset.section, n: b.dataset.n, rowKey: b.dataset.rowKey, path: b.dataset.path, anchor: b }, ctx));
  el.querySelectorAll('.out-table-wrap').forEach(wrap => { if (!wrap.querySelector('.out-clamp')) return; fitTables.push(watchWidth(wrap, () => fitTable(wrap))); fitTable(wrap); });
  if (nav.page === 'list') el.querySelectorAll('[data-list]').forEach(list => pageList(list, `outputs-${list.dataset.list}`, ':scope > .ui-row', 12));
  if (nav.page === 'list' && show === 'results') watchPreviews(el);
  // Table and chart pagers
  for (const p of pagers) wirePager(el, p.id, page => { p.set(page - 1); rerender(); });
  // The editor: fields write into the draft and its JSON; the JSON, once it parses, replaces the draft.
  if (nav.page === 'edit') {
    const d = nav.draft;
    const reflect = () => { checkDraft(d); rerender(); };
    el.querySelectorAll('[data-field]').forEach(f => f.onchange = () => { setPath(d, f.dataset.field, f.value.trim ? (f.dataset.field === 'title' || f.dataset.field === 'notes' ? f.value : f.value.trim()) : f.value); reflect(); });
    el.querySelectorAll('[data-kind-field]').forEach(sel => sel.onchange = () => {
      const kind = sel.value === 'figure' ? 'chart' : 'table'; if (kind === d.kind) return;
      d.kind = kind;
      if (kind === 'chart') { const cols = resultColumns(d) || []; d.chart = { type: 'bar', x: cols[0] || '' }; }
      else delete d.chart;
      delete d.exports; reflect();
    });
  }
  // Chart: drawn at the width it has, redrawn when that changes; marks answer with a card.
  const host = el.querySelector('[data-out-chart]');
  if (host) {
    const spec = nav.page === 'edit' ? nav.draft : nav.page === 'record' ? workOf(nav.id)?.record.block.spec : nav.page === 'item' ? itemOf(nav.id)?.drawn?.spec : currentSpec(entryOf(nav.id));
    const { m } = spec ? modelOf(spec) : {}; if (!m) return;
    const size = spec.chart.page || 40;
    const draw = force => {
      const w = Math.round(host.clientWidth); if (!w || (!force && w === host._w)) return; host._w = w;
      host.innerHTML = sanitizeSvg(chartSvg(m, { width: w, offset: nav.chartPage * size, page: size, style: figureTokens(null, { medium: 'screen' }) }));
      host.querySelectorAll('[data-row] > title, [data-row] title').forEach(t => t.remove());
    };
    const card = floatingCard();
    const labelOf = id => { const p = (get().papers || []).find(x => x.id === id); return p?.label || p?.title || id; };
    host.addEventListener('pointermove', ev => {
      const mark = ev.target.closest?.('[data-row]'); if (!mark) { card.hidden = true; return; }
      const r = Number(mark.getAttribute('data-row')), row = m.result.rows[r], refs = m.result.refs[r] || [];
      const values = m.result.columns.map((c, i) => [c.label, row?.[i]]).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).slice(0, 4);
      card.innerHTML = `<strong>${esc(mark.getAttribute('data-chart-mark'))}</strong>${values.map(([k, v]) => `<span class="meta">${esc(k)}: ${esc(Array.isArray(v) ? v.join('; ') : v)}</span>`).join('')}${refs.length > 1 ? refs.slice(0, 4).map(id => `<span>${esc(labelOf(id))}</span>`).join('') + (refs.length > 4 ? `<span class="meta">${refs.length - 4} more</span>` : '') : ''}`;
      card.hidden = false;
      placeCard(card, mark.getBoundingClientRect());
    });
    host.addEventListener('pointerleave', () => { card.hidden = true; });
    host.addEventListener('click', ev => {
      const mark = ev.target.closest?.('[data-row]'); if (!mark) return;
      const refs = m.result.refs[Number(mark.getAttribute('data-row'))] || []; if (!refs.length) return;
      showSubset(refs, `${refs.length} ${refs.length === 1 ? 'study' : 'studies'} · ${mark.getAttribute('data-chart-mark')}`); ctx.go('library');
    });
    fitChart = watchWidth(host, () => draw()); draw(true);
  }
}
