// Tasks: the project's to-do list with priority, status, subtasks and
// blocked-by, a board by status, and the project timeline (amendment
// "Workspace: backup, dashboard, tasks, timeline and translation").
//
// One Workspace item rather than three: the list, the board and the timeline
// read the same records (lib/tasks.mjs, lib/timeline.mjs), and the Overview
// keeps its short To do panel, which opens here. The timeline sits here and
// not below the Overview's stages because a Gantt chart needs the page's full
// width and the Overview already holds the funnel, the charts and the lists.
//
// The title bar carries List, Board or Timeline (page()); the page is one tools row (add field, Filter, Select), one count line and quiet rows.
// Select swaps the bar for the selection bar in the same cell (uiRegion), so nothing moves;
// the selection model is lib/task-select.mjs and the removal, move and patch logic is lib/tasks.mjs.
import { activeFolder } from '../lib/projects.mjs';
import { scanFolder } from '../lib/project-folder.mjs';
import { parseAuditReport, auditTasks, importedSources, isAuditReport } from '../lib/audit-findings.mjs';
import { showShellNotice } from '../lib/shell-notice.mjs';
import { REGISTRY } from './registry.mjs';
import { get, update, projects, projectGeneration } from '../store.mjs';
import { esc, emptyState, autoGrow } from '../lib/html.mjs';
import { icon, withIcon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { configured } from '../lib/ai.mjs';
import { isJev } from '../lib/jev.mjs';
import { readModel } from './tasks-model.mjs';
import { classifyTasks, detectTasks, parseTasks, projectContext, estimateTokens, TASK_KINDS } from '../lib/assist.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { dateField, wireDateField, dateValue } from '../lib/date-picker.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiRegion, uiStatusLine, uiNotice, CH_STEPS } from '../lib/ui-actions.mjs';
import { formField, formFit, formCells } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';
import { focusControl } from '../lib/bar-fit.mjs';
import { dueLabel } from '../lib/actions.mjs';
import { suggestedTasksList, cleanSuggestion, addSuggested, suggestionState } from '../lib/task-suggest.mjs';
import { openStudy } from '../lib/study.mjs';
import { visibleViews } from '../lib/workflow.mjs';
import { pagedItems, wireDataPager, resetPagedList, revealPagedItem } from '../lib/list-pager.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { recordPicker, wireRecordPicker } from '../lib/record-picker.mjs';
import { STATUSES, PRIORITIES, normaliseTasks, makeTask, patchTask, treeRows, filterTasks, boardColumns, blockersOf, subtaskProgress, descendants, wouldCycle,
  removeTasks, restoreRemoved, tasksSignature, bulkPatch, moveTasks, pendingRemoval, clearRemoval, pendingAdded, clearAdded } from '../lib/tasks.mjs';
import { newSelection, enterSelect, leaveSelect, toggleId, rangeTo, selectAllIn, clearIds, reconcile, orderFromRows, orderFromColumns, bulkTargets, selectedCount, isAllSelected, selectedLine, selectedCh } from '../lib/task-select.mjs';
import { timelineHtml, wireTimeline, resetTimeline } from './tasks-timeline.mjs';
import { dueHtml, titleHtml } from '../lib/hub-tasks.mjs';
import { teamOf, byMe, currentPerson, personOf } from '../lib/team.mjs';

export const meta = { title: 'Tasks', icon: 'tasks' };
/** Open tasks due within a week, overdue included: what needs doing soon. */
export const count = (...a) => REGISTRY.tasks.count(...a);

const VIEW_NAMES = { files: 'Files', overview: 'Overview', protocol: 'Protocol', search: 'Literature', library: 'Library', screening: 'Screening', extraction: 'Extraction',
  patients: 'Patient data', datasets: 'Datasets', appraisal: 'Appraisal', analysis: 'Analysis', certainty: 'Certainty', manuscript: 'Manuscript',
  outputs: 'Tables and figures', reporting: 'Reporting', notes: 'Notes', workflows: 'Workflows' };
const STATUS_LABEL = Object.fromEntries(STATUSES), PRIORITY_LABEL = Object.fromEntries(PRIORITIES);
const FILTER_STATUS = [['open', 'Open'], ...STATUSES, ['all', 'All']];
const FILTER_PRIORITY = [['any', 'Any'], ['high', 'High'], ['low', 'Low'], ['none', 'No priority']];
const FILTER_DUE = [['any', 'Any'], ['overdue', 'Overdue'], ['week', 'This week'], ['none', 'No date']];
const FILTER_NAME = { priority: { high: 'High priority', low: 'Low priority', none: 'No priority' }, due: { overdue: 'Overdue', week: 'Due this week', none: 'No date' } };
// Owners: the project's team (lib/team.mjs); a task names its owner by id or initials.
const ownerName = (s, who) => { const p = personOf(s, who); return p?.name || who; };
const ownerInitials = (s, who) => personOf(s, who)?.initials || who;
// The assignee column shows only once someone is assigned: a person working alone never sees an empty column.
const assigned = all => all.some(t => t.owner);
const ownerPairs = s => teamOf(s).map(p => [p.id, p.name || p.initials]);
function ownerFilterName() {
  if (filters.owner === 'any') return '';
  if (filters.owner === 'none') return 'Unassigned';
  return filters.owner === currentPerson(get()).id ? 'Assigned to you' : `Assigned to ${ownerName(get(), filters.owner)}`;
}
const opt = (pairs, value) => pairs.map(([k, l]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(l)}</option>`).join('');

let mode = 'list';           // 'list' | 'board' | 'timeline'
let filters = { status: 'open', priority: 'any', due: 'any', owner: 'any', text: '' };
let editing = null;          // the task whose details are open
let reveal = '';             // a task the next list paint brings onto its page (a link from the hub)
let host = null, hostCtx = null, keysOn = null, barRerender = null;
let sel = newSelection(), selKey = '';      // the selection, kept per project (and per load of it) across repaints
let note = null;             // { text, after, record }: what the last bulk action did; its Undo (a delete) lasts while no task changes
/** Opens the page at one of its modes, for links from elsewhere (Overview, the dashboard). */
export function showMode(m) { if (['list', 'board', 'timeline'].includes(m)) mode = m; }
/** Opens the page at one task: List, nothing filtered out, its details open. */
export function focusTask(id) { mode = 'list'; filters = { status: 'all', priority: 'any', due: 'any', owner: 'any', text: '' }; editing = id; reveal = id; }
export const navigationState = () => ({ mode });
export function restoreNavigation(s) {
  if (s?.mode) showMode(s.mode);
  if (typeof s?.section === 'string' && s.section.startsWith('task:') && s.section.length > 5) focusTask(s.section.slice(5));
}
export function unmount(again = false) {
  if (again) return;   // a repaint of the page keeps its selection and the sub-page
  resetTimeline();
  keysOn?.removeEventListener('keydown', onViewKey); keysOn = null;
  sel = leaveSelect(); note = null; host = null; hostCtx = null;
  suggestGrow?.release?.(); suggestGrow = null; suggesting = false;   // leaving Tasks closes the sub-page
}

const change = fn => update(s => { s.todos = Array.isArray(s.todos) ? s.todos : []; fn(s); return s; });
const taskPageKey = suffix => `${projects().current}:tasks:${suffix}`;
const resetTaskPages = () => ['list', ...STATUSES.map(([id]) => id)].forEach(id => resetPagedList(taskPageKey(id)));
const today = () => dateValue(new Date());
const dayFrom = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateValue(d); };
const allTasks = () => normaliseTasks(get().todos);

export function assistContext() {
  const open = normaliseTasks(get().todos).filter(t => !t.done);
  return `Tasks. ${open.length} open: ${open.slice(0, 10).map(t => `${t.text} (${t.status}${t.priority !== 'none' ? `, ${t.priority} priority` : ''}${t.due ? `, due ${t.due}` : ''})`).join('; ') || 'none'}`;
}

// ---- what the page shows, in reading order -------------------------------------------------------------------------------

const listRows = all => treeRows(filterTasks(all, filters, today()), all);
const boardCols = all => boardColumns(filterTasks(all, { ...filters, status: 'all' }, today()), all);
/** Every task id the filters show, in reading order, across pages and columns: what range and Select all read. */
const orderOf = all => mode === 'board' ? orderFromColumns(boardCols(all)) : mode === 'list' ? orderFromRows(listRows(all)) : [];
const isFiltered = () => filters.priority !== 'any' || filters.due !== 'any' || filters.owner !== 'any' || !!filters.text.trim() || (mode === 'list' && filters.status !== 'open');

/** The selection of this project; a different project (or a reload of it) starts with none. */
function selection() {
  const key = `${projects().current}:${projectGeneration()}`;
  if (key !== selKey) { selKey = key; sel = newSelection(); note = null; }
  return sel;
}
const selecting = () => mode !== 'timeline' && selection().active;

export function render(el, ctx) {
  host = el; hostCtx = ctx;
  ctx?.onKey?.(e => {
    if (e.key === 'Escape' && suggesting && !e.defaultPrevented) { e.preventDefault(); leaveSuggest(); return; }
    if (e.key === 'Escape' && selecting() && !e.defaultPrevented) { e.preventDefault(); leave(); }
  });
  if (suggesting) { renderSuggest(el, ctx); return; }
  if (keysOn !== el) { keysOn?.removeEventListener('keydown', onViewKey); el.addEventListener('keydown', onViewKey); keysOn = el; }
  selection();
  if (!el.querySelector(':scope > section.tk')) { sel = leaveSelect(); note = null; }      // arriving on the page again: nothing is carried over
  const s = get(), all = normaliseTasks(s.todos), order = orderOf(all);
  if (sel.active) sel = reconcile(sel, new Set(order));                                    // a task removed elsewhere leaves the selection
  if (note && note.after !== tasksSignature(all)) note = null;
  if (!note) { const r = pendingRemoval(all); if (r) { note = { text: r.text, after: r.record.after, record: r.record }; clearRemoval(); } }      // tasks the assistant removed, while they are as it left them
  if (!note) { const a = pendingAdded(all); if (a) { note = { text: `${plural(a.ids.length, 'task')} added`, after: a.after, record: null, added: a.ids }; clearAdded(); } }   // suggested tasks accepted elsewhere
  if (reveal) {
    if (mode === 'list') { const i = listRows(all).findIndex(r => r.task.id === reveal); revealPagedItem(taskPageKey('list'), i, 25); }
    reveal = '';
  }
  el.innerHTML = `<section class="tk" data-tk-page="${mode}">
    ${controlsHtml(all, order)}
    ${mode === 'timeline' ? timelineHtml(s, today()) : `${countLine(all, order)}${mode === 'board' ? boardHtml(all) : listHtml(s, all)}`}
    <div class="meta" role="status" id="tk-status"></div>
  </section>`;
  wire(el, ctx);
}

// ---- the bar, the selection bar and the count line ------------------------------------------------------------------------

/** The title bar (lib/topbar.mjs): List, Board or Timeline is the page's view switch; Suggest tasks from text is a page command in its More. */
export function pageSpec({ mode: shown }, { show = () => {}, suggest = () => {} } = {}) {
  return { title: 'Tasks',
    view: { id: 'tk-view', label: 'Show', attr: 'data-tk-mode', value: shown, items: [['list', 'List'], ['board', 'Board'], ['timeline', 'Timeline']], run: show },
    actions: [], overflow: [{ id: 'tk-suggest', label: 'Suggest tasks from text…', run: suggest }, { id: 'tk-audits', label: 'Import findings from audits…', run: importAudits }] };
}
/** Each audit report of the folder whose findings are not tasks yet becomes tasks, after one confirm naming the count (lib/audit-findings.mjs). */
async function importAudits() {
  const folder = activeFolder();
  if (!folder) { showShellNotice({ id: 'tk-audits', text: 'Audits are read from a project folder' }); return; }
  const done = importedSources(get().todos), scanned = await scanFolder(folder).catch(() => []), files = Array.isArray(scanned) ? scanned.filter(f => !f.dir) : [];
  const reports = files.map(f => f.rel || f.path).filter(p => p && isAuditReport(p) && !done.has(p));
  const found = [];
  for (const rel of reports) { try { const f = parseAuditReport(new TextDecoder().decode(await folder.read(rel))); if (f.length) found.push([rel, f]); } catch { /* an unreadable report is skipped */ } }
  const n = found.reduce((a, [, f]) => a + f.length, 0);
  if (!n) { showShellNotice({ id: 'tk-audits', text: 'No audit report with numbered findings is waiting' }); return; }
  if (!await confirmAsk(`Add ${n} tasks from ${found.length} audit ${found.length === 1 ? 'report' : 'reports'}?`, { confirm: 'Add tasks' })) return;
  update(st => { for (const [rel, f] of found) st.todos = [...(st.todos || []), ...auditTasks(f, rel, st.todos).tasks]; return st; });
  showShellNotice({ id: 'tk-audits', text: `Added ${n} tasks; each names its report and finding in its notes` });
  barRerender?.();
}

export function page(rerender) {
  barRerender = rerender;
  if (suggesting) return suggestSpec({ back: () => leaveSuggest(rerender) });
  return pageSpec({ mode }, { show: key => { mode = key; editing = null; note = null; rerender(); }, suggest: () => openSuggest() });
}

/** The list's one tools row (the timeline has its own bar, views/tasks-timeline.mjs, so none here): the add field, Filter and Select, swapped for the selection bar. */
function controlsHtml(all, order) {
  if (mode === 'timeline') return '';
  const n = selectedCount(selection(), order);
  const main = uiBar({ kind: 'tools', label: 'Tasks', id: 'tk-add', form: true,
    filters: [{ type: 'field', id: 'tk-new', label: 'New task', placeholder: 'Add a task', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'true' } }],
    actions: [{ id: 'tk-filter', label: 'Filter', icon: 'filter', menu: true, role: 'quiet' },
      { id: 'tk-select', label: 'Select', icon: 'checklist', role: 'quiet', disabled: !order.length }] });
  const bulk = uiBar({ kind: 'tools', label: 'Selection', id: 'tk-sel',
    actions: [{ id: 'tk-move', label: 'Move to', icon: 'folder', menu: true, disabled: !n },
      { id: 'tk-cancel', label: 'Cancel', icon: 'close', role: 'quiet', keep: true }],
    overflow: [{ id: 'tk-priority', label: 'Priority', disabled: !n }, { id: 'tk-owner', label: 'Assignee', disabled: !n }, { id: 'tk-due', label: 'Due date', disabled: !n }, { id: 'tk-delete', label: 'Delete', danger: true, disabled: !n }] });
  return uiRegion({ id: 'tk-region', label: 'Task controls', active: selecting() ? 1 : 0, bars: [main, bulk] });
}

/** The one line under the bar: what is shown, what is chosen, and the one button that resets either. */
function countLine(all, order) {
  const cur = selection(), shown = order.length;
  let text, summary = '', button = '';
  if (cur.active) { text = selectedLine(selectedCount(cur, order), shown); button = isAllSelected(cur, order) ? 'Clear selection' : 'Select all'; }
  else if (note) { text = note.text; button = note.record || note.added ? 'Undo' : ''; }
  else if (isFiltered()) {
    text = `${shown} of ${all.length}`; button = 'Clear filters';
    summary = [mode === 'list' ? Object.fromEntries(FILTER_STATUS)[filters.status] : '', FILTER_NAME.priority[filters.priority], FILTER_NAME.due[filters.due], ownerFilterName(),
      filters.text.trim() ? `Search "${filters.text.trim()}"` : ''].filter(Boolean).join(', ');
  } else if (!all.length) text = ' ';   // no tasks: the list's own empty state says so, the line keeps its place
  else { const ids = new Set(order); text = `${mode === 'board' ? all.filter(t => ids.has(t.id) && !t.done).length : shown} open`; }   // one word for the count in both views; the board also draws the done column
  return uiStatusLine({ id: 'tk-count', label: 'Tasks shown', parts: [
    { id: 'tk-count-n', text, drop: 1, attrs: { role: 'status' }, ...(cur.active ? { ch: selectedCh(shown, CH_STEPS) } : {}) },
    { id: 'tk-count-filters', text: summary || ' ', drop: 5, hidden: !summary },
    { id: 'tk-count-act', text: button || ' ', drop: 0, button: true, ch: 16, hidden: !button }] });
}

/** Repaints the chosen boxes, the count and the bulk buttons in place: a click on a row repaints nothing else. */
function syncSelection() {
  if (!host) return;
  const all = allTasks(), order = orderOf(all), cur = selection(), n = selectedCount(cur, order);
  host.querySelectorAll('.ui-row[data-task]').forEach(row => { const box = row.querySelector('.ui-row-check input'); if (box) box.checked = cur.ids.has(row.dataset.task); });
  const set = (id, text) => { const p = host.querySelector(`#${id}`); if (p) p.textContent = text; };
  set('tk-count-n', selectedLine(n, order.length)); set('tk-count-act', isAllSelected(cur, order) ? 'Clear selection' : 'Select all');
  for (const id of ['tk-move', 'tk-delete', 'tk-priority', 'tk-owner', 'tk-due']) { const b = host.querySelector(`#${id}`); if (b) b.disabled = !n; }
}


// ---- rows -------------------------------------------------------------------------------------------------------------------

const linkLabel = (t, s) => {
  if (!t.link) return '';
  const p = t.link.paperId && (s.papers || []).find(x => x.id === t.link.paperId);
  return p ? (p.label || p.title || 'Record') : VIEW_NAMES[t.link.view] || t.link.label || t.link.view;
};
/** The one quiet line under a task. The board omits the status (the column is the status) and leads with the date. */
function detailParts(t, all, s, board) {
  const blockers = blockersOf(t, all), sub = subtaskProgress(all, t.id), out = [];
  if (t.due && board) out.push(dueHtml(t, today()));
  if (!board && t.status !== 'todo') out.push(esc(STATUS_LABEL[t.status] || ''));
  if (t.priority !== 'none') out.push(esc(`${PRIORITY_LABEL[t.priority]} priority`));
  if (board && t.owner) out.push(esc(ownerInitials(s, t.owner)));
  if (blockers.length) out.push(esc(board ? 'Blocked' : `Waits for ${blockers.map(b => b.text).join(', ')}`));
  if (!board && sub.total) out.push(esc(`${sub.done} of ${sub.total} subtasks`));
  if (!board && t.start) out.push(esc(`Starts ${dueLabel(t.start)}`));
  if (!board && t.link) out.push(`<button type="button" class="tk-link" data-link="${esc(t.id)}">${withIcon('open', esc(linkLabel(t, s)))}</button>`);
  return out;
}
/** A task as a quiet row: the round box (done, or chosen while selecting), one line of title, its date as a text column, one detail line and a flat More. The board has no date column: its date is in the detail line. */
function taskRow(t, all, s, { depth = 0, board = false } = {}) {
  const picking = selecting(), blocked = blockersOf(t, all).length > 0, name = t.text || 'Untitled task';
  const state = [t.done && 'done', blocked && 'blocked', t.priority === 'high' && 'high'].filter(Boolean).join(' ');
  return uiRow({ depth, attrs: { 'data-task': t.id, 'data-tk-state': state || false, draggable: board && !picking ? 'true' : false },
    check: picking ? { checked: selection().ids.has(t.id), label: `Select: ${t.text}`, attrs: { 'data-select': t.id } }
      : { checked: t.done, label: `Done: ${t.text}`, attrs: { 'data-done': t.id, 'data-form-key': `task:${t.id}:done` } },
    main: { html: `<button type="button" class="tk-text" ${board ? `data-open-edit="${esc(t.id)}"` : `data-edit="${esc(t.id)}" aria-expanded="${editing === t.id}"`} title="${esc(name)}">${titleHtml(t.text)}</button>`, detail: detailParts(t, all, s, board) },
    ...(board ? {} : { cells: [...(assigned(all) ? [{ col: 'owner', kind: 'text', ch: 4, html: t.owner ? `<span title="${esc(ownerName(s, t.owner))}">${esc(ownerInitials(s, t.owner))}</span>` : '' }] : []), { col: 'due', kind: 'text', ch: 14, html: dueHtml(t, today()) }] }),
    end: uiRowEnd({ more: { label: `More for ${t.text}`, attrs: { 'data-more': t.id } } }) });
}

function listHtml(s, all) {
  const rows = listRows(all), page = pagedItems(rows, taskPageKey('list'), 25);
  return uiList({ id: 'tk-rows', label: 'Task list', cols: assigned(all) ? ['owner', 'due'] : ['due'], reveal: true, attrs: { 'data-tk-selecting': selecting(), 'data-tk-list': true },
    rows: page.items.map(({ task: t, depth }) => taskRow(t, all, s, { depth }) + (editing === t.id ? editHtml(t, all, s) : '')),
    empty: emptyState({ icon: 'tasks', title: all.length ? 'No tasks match' : 'No tasks yet', size: 'inline' }) });
}

function editHtml(t, all, s) {
  const views = visibleViews(s).filter(k => VIEW_NAMES[k]);
  const children = descendants(all, t.id);
  const parents = all.filter(x => x.id !== t.id && !children.has(x.id) && !x.done);
  const others = all.filter(x => x.id !== t.id && (!x.done || t.blockedBy.includes(x.id)));
  const papers = s.papers || [];
  const picker = papers.length ? formField('Record', recordPicker({ id: `tk-link-${t.id}`, label: 'Record', value: t.link?.paperId || '', records: papers })) : '';
  const waiting = others.filter(o => t.blockedBy.includes(o.id));
  const free = others.filter(o => !t.blockedBy.includes(o.id) && !wouldCycle(all, t.id, o.id));
  const grid = [
    formField('Status', `<select data-f="status">${opt(STATUSES, t.status)}</select>`),
    formField('Priority', `<select data-f="priority">${opt(PRIORITIES, t.priority)}</select>`),
    formField('Assignee', `<select data-f="owner"><option value="">Unassigned</option>${opt(ownerPairs(s).some(([k]) => k === t.owner) || !t.owner ? ownerPairs(s) : [...ownerPairs(s), [t.owner, t.owner]], t.owner)}</select>`),
    formField('Start', dateField(`tk-start-${t.id}`, t.start, 'Start')),
    formField('Due', dateField(`tk-due-${t.id}`, t.due, 'Due')),
    formField('Subtask of', `<select data-f="parentId"><option value="">None</option>${parents.map(p => `<option value="${esc(p.id)}"${p.id === t.parentId ? ' selected' : ''}>${esc(p.text.slice(0, 80))}</option>`).join('')}</select>`),
    formField('Link', `<select data-f="linkView"><option value="">None</option>${views.map(k => `<option value="${k}"${t.link?.view === k ? ' selected' : ''}>${esc(VIEW_NAMES[k])}</option>`).join('')}</select>`),
    picker].join('');
  return `<div class="tk-edit" data-editing="${esc(t.id)}">
    ${formField('Task', `<input data-f="text" value="${esc(t.text)}">`)}
    <div class="an-settings"${formFit(formCells(grid))}>${grid}</div>
    ${others.length ? `<div class="tk-blockers" role="group" aria-labelledby="tk-waits-${esc(t.id)}"><span class="tk-blockers-title" id="tk-waits-${esc(t.id)}">Waits for</span>${waiting.map(o => `<label class="tk-blocker"><input type="checkbox" data-blocker="${esc(o.id)}" data-form-key="task:${esc(t.id)}:blocker:${esc(o.id)}" checked><span>${esc(o.text)}</span></label>`).join('')}
      ${free.length ? formField('Add a blocking task', recordPicker({ id: `tk-blocker-${t.id}`, label: 'Blocking task', records: free.map(o => ({ id: o.id, label: o.text })) })) : ''}</div>` : ''}
    ${uiBar({ kind: 'foot', label: 'Task details', id: `tk-edit-foot-${t.id}`, actions: [{ id: `tk-close-${t.id}`, label: 'Close', icon: 'close', attrs: { 'data-close-edit': true } }],
      overflow: t.link?.paperId ? [{ id: `tk-clear-record-${t.id}`, label: 'Clear record' }] : [] })}
  </div>`;
}

/** The board takes the page's width: a column with tasks shares it (240 to 420px), a column with none keeps only its head, so the busy
 * columns get the room; a pane too narrow for the columns scrolls the board sideways, never the page. A card is dragged to another
 * column, or moved with Alt and the left or right arrow, or with More > Move to. */
function boardHtml(all) {
  return `<div class="tk-board" role="region" aria-label="Board" tabindex="0">${boardCols(all).map(c => `<section class="tk-col" aria-label="${esc(c.label)}" data-status="${esc(c.id)}"${c.tasks.length ? '' : ' data-tk-empty'}>
      ${uiBar({ kind: 'head', label: `${c.label} column, ${plural(c.tasks.length, 'task')}`, id: `tk-col-${c.id}`, lead: { title: c.label, level: 'h2' }, status: { id: `tk-col-${c.id}-count`, text: String(c.tasks.length), ch: c.tasks.length ? 4 : 3 } })}
      ${uiList({ label: `${c.label} tasks`, reveal: true, attrs: { 'data-task-column': c.id, 'data-tk-list': true, 'data-tk-board': true, 'data-tk-selecting': selecting() },
        rows: pagedItems(c.tasks, taskPageKey(c.id), 25).items.map(t => taskRow(t, all, {}, { board: true })), empty: '<p class="meta tk-col-empty">No tasks</p>' })}
    </section>`).join('')}</div>`;
}

// ---- behaviour --------------------------------------------------------------------------------------------------------------

// The repaint runs a tick after it is asked for; a page that was left in that tick has no host to draw into.
const redraw = after => { if (host) rerenderForm(host, { rerender: () => { if (host) render(host, hostCtx); } }, { fallback: '#tk-new', after }); };
const repaint = after => { hostCtx?.refreshCounts?.(); redraw(after); };
const setStatus = text => { const p = host?.querySelector('#tk-status'); if (p) p.textContent = text; };
const editingGone = () => { if (editing && !allTasks().some(t => t.id === editing)) editing = null; };

/** What an action on the selection touches: chosen and shown, in reading order. */
const targetsNow = () => bulkTargets(selection(), orderOf(allTasks()));
const setSel = next => { sel = next; syncSelection(); };

function onViewKey(e) {
  if (!host || !host.querySelector(':scope > section.tk')) return;
  if (mode === 'board' && e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !selecting()) {
    const row = e.target.closest?.('.ui-list[data-task-column] .ui-row[data-task]'); if (!row) return;
    e.preventDefault(); shiftColumn(row.dataset.task, e.key === 'ArrowLeft' ? -1 : 1); return;
  }
  if (!selecting()) return;
  const typing = e.target.matches?.('select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=button])') || e.target.isContentEditable;
  if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); leave(); return; }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a' && !typing) { e.preventDefault(); setSel(selectAllIn(selection(), orderOf(allTasks()))); }
}
function leave() {
  sel = leaveSelect();
  redraw(() => { const b = host?.querySelector('#tk-select'); if (b) focusControl(b); });
}

const setFilter = (key, value) => () => { note = null; filters[key] = value; resetTaskPages(); redraw(); };
const radios = (pairs, key) => pairs.map(([k, l]) => ({ label: l, checked: filters[key] === k, checkType: 'radio', run: setFilter(key, k) }));
function filterMenu() {
  const name = (pairs, key) => pairs.find(([k]) => k === filters[key])?.[1] || '';
  return [
    ...(mode === 'list' ? [{ label: 'Status', meta: name(FILTER_STATUS, 'status'), submenu: radios(FILTER_STATUS, 'status') }] : []),
    { label: 'Priority', meta: name(FILTER_PRIORITY, 'priority'), submenu: radios(FILTER_PRIORITY, 'priority') },
    { label: 'Assignee', meta: ownerFilterName() || 'Any assignee', submenu: radios([['any', 'Any assignee'], ...(currentPerson(get()).id ? [[currentPerson(get()).id, `${currentPerson(get()).name || 'You'} (you)`]] : []), ...ownerPairs(get()).filter(([k]) => k !== currentPerson(get()).id), ['none', 'Unassigned']], 'owner') },
    { label: 'Due', meta: name(FILTER_DUE, 'due'), submenu: radios(FILTER_DUE, 'due') },
    '-',
    { label: 'Search…', icon: 'search', run: async () => {
      const text = await ask('Search tasks', { value: filters.text, placeholder: 'Words in the task', confirm: 'Search' });
      if (text === null) return;
      note = null; filters.text = text.trim(); resetTaskPages(); redraw();
    } },
  ];
}
const clearFilters = () => { note = null; filters = { status: 'open', priority: 'any', due: 'any', owner: 'any', text: '' }; resetTaskPages(); redraw(); };

/** Deletes tasks and offers Undo while nothing else about the tasks changes. `ids` come from the selection or one row. */
function deleteTasks(ids, { selected = false } = {}) {
  let result = null;
  change(s => { result = removeTasks(s.todos, ids); s.todos = result.list; });
  if (!result?.removed.length) return;
  if (ids.includes(editing)) editing = null;
  if (selected) sel = leaveSelect();
  note = { text: `${plural(result.removed.length, 'task')} deleted`, after: result.after, record: result };
  repaint();
}
async function askDelete(ids, opts) {
  // deleted at once: its note's Undo takes it back, so nothing is asked first (Component review 2026-10-21, item 19)
  deleteTasks(ids, opts);
}
function undoDelete() {
  const record = note?.record; if (!record) return;
  let back = null;
  change(s => { back = restoreRemoved(s.todos, record); if (back) s.todos = back; });
  note = back ? { text: `Restored ${plural(record.removed.length, 'task')}`, after: tasksSignature(back), record: null } : null;
  repaint(() => { if (!back) setStatus('Tasks changed, so the deletion cannot be undone'); });
}

/** Takes back suggested tasks that were added elsewhere, while the tasks are as the additions left them. */
function undoAdded() {
  const ids = note?.added; if (!ids?.length || note.after !== tasksSignature(get().todos)) return;
  change(s => { s.todos = removeTasks(s.todos, ids).list; });
  note = { text: `Removed ${plural(ids.length, 'task')}`, after: tasksSignature(get().todos), record: null };
  repaint();
}

/** Moves a card one column left or right and keeps the focus on it. */
function shiftColumn(id, step) {
  const t = allTasks().find(x => x.id === id); if (!t) return;
  const next = STATUSES[STATUSES.findIndex(([k]) => k === t.status) + step]; if (!next) return;
  moveTo([id], next[0], { after: () => host?.querySelector(`[data-open-edit="${CSS.escape(id)}"]`)?.focus() });
}
function moveTo(ids, status, { selected = false, after } = {}) {
  let r = null;
  change(s => { r = moveTasks(s.todos, ids, status); });
  if (selected) sel = leaveSelect();
  const label = STATUS_LABEL[status];
  const text = !r.moved ? `Already in ${label}` : ids.length === 1 && !selected ? `Moved to ${label}` : `Moved ${r.moved} to ${label}${r.skipped.length ? `, ${r.skipped.length} already there` : ''}`;
  note = { text, after: tasksSignature(get().todos), record: null };
  repaint(after);
}
function patchSelected(patch, text) {
  const ids = targetsNow(); if (!ids.length) return;
  let r = null;
  change(s => { r = bulkPatch(s.todos, ids, patch); });
  sel = leaveSelect();
  note = { text: r.changed ? `${text} on ${plural(r.changed, 'task')}` : 'Nothing changed', after: tasksSignature(get().todos), record: null };
  repaint();
}
/** The Priority and Due date menus open under the selection bar's trailing edge, where its More button is. */
/** A menu opens under its button. A click the bar forwards from More (not a person's click) has no button to open under, so the bar's trailing edge stands in. */
const menuFor = (button, e, bar, items, minWidth) => e.isTrusted ? showMenu(button, items, { minWidth })
  : showMenu(host.querySelector(bar), items, { align: 'end', minWidth, matchWidth: false });
const menuAtBar = items => showMenu(host.querySelector('#tk-sel'), items, { align: 'end', minWidth: 180, matchWidth: false });

function rowMenu(b, id) {
  const t = allTasks().find(x => x.id === id); if (!t) return;
  showMenu(b, [
    { label: 'Edit details', icon: 'note', run: () => openEditor(id) },
    { label: 'Move to', icon: 'folder', submenu: STATUSES.map(([k, l]) => ({ label: l, checked: t.status === k, checkType: 'radio', run: () => moveTo([id], k) })) },
    { label: 'Add subtask', icon: 'plus', run: async () => {
      const text = (await ask('Add subtask', { placeholder: 'Subtask', confirm: 'Add' }))?.trim(); if (!text) return;
      change(s => { s.todos.push(makeTask({ text, parentId: id, by: byMe(s) })); }); repaint();
    } },
    '-',
    { label: 'Delete', icon: 'trash', run: async () => {
      const kids = descendants(get().todos, id).size;
      if (kids) await askDelete([id]); else deleteTasks([id]);
    } },
  ], { align: 'end', minWidth: 180 });
}

function openEditor(id) {
  editing = id;
  const fromBoard = mode !== 'list';   // the board or the timeline: List again
  if (fromBoard) { mode = 'list'; filters.status = 'all'; }
  const all = allTasks();
  revealPagedItem(taskPageKey('list'), listRows(all).findIndex(row => row.task.id === id), 25);
  if (fromBoard && hostCtx?.rerender) hostCtx.rerender(); else render(host, hostCtx);   // List again: the title bar's switch follows
  host?.querySelector('.tk-edit [data-f="text"]')?.focus();
}

function wire(el, ctx, collectionOnly = false) {
  if (!collectionOnly) wireBars(el, ctx);
  wireRows(el, ctx);
  const rows = el.querySelector('#tk-rows'), all = allTasks();
  const redrawCollection = selector => {
    const target = el.querySelector(selector); if (!target) return;
    const template = document.createElement('template');
    const state = get(), now = normaliseTasks(state.todos);
    template.innerHTML = mode === 'board' ? boardHtml(now) : listHtml(state, now);
    const next = template.content.querySelector(selector);
    target.innerHTML = next.innerHTML;
    wire(el, ctx, true);
    if (selection().active) syncSelection();
  };
  if (rows) wireDataPager(rows, taskPageKey('list'), { total: listRows(all).length, size: 25, onChange: () => redrawCollection('#tk-rows') });
  if (mode === 'board') for (const c of boardCols(all)) wireDataPager(el.querySelector(`[data-task-column="${c.id}"]`), taskPageKey(c.id), { total: c.tasks.length, size: 25, onChange: () => redrawCollection(`[data-task-column="${c.id}"]`) });
  const ed = el.querySelector('.tk-edit');
  if (ed && !collectionOnly) wireEdit(ed, el, ctx);
  if (mode === 'timeline') wireTimeline(el, { openPage: v => ctx.go(v), repaint: () => render(el, ctx), openTask: openEditor, today: today() });
}

function wireBars(el, ctx) {
  const add = el.querySelector('#tk-new');
  if (add) el.querySelector('#tk-add').onsubmit = e => {
    e.preventDefault();
    const text = add.value.trim(); if (!text) return;
    change(s => { s.todos.push(makeTask({ text, by: byMe(s) })); });
    ctx.refreshCounts?.(); render(el, ctx); el.querySelector('#tk-new')?.focus();
  };
  const filter = el.querySelector('#tk-filter');
  if (filter) filter.onclick = e => menuFor(filter, e, '#tk-add', filterMenu(), 200);
  const pick = el.querySelector('#tk-select');
  if (pick) pick.onclick = () => { note = null; sel = enterSelect(selection()); redraw(() => (el.querySelector('.ui-row-check input') || el.querySelector('#tk-cancel'))?.focus()); };
  const part = el.querySelector('#tk-count-act');
  if (part) part.onclick = () => {
    if (selecting()) { const order = orderOf(allTasks()); setSel(isAllSelected(selection(), order) ? clearIds(selection()) : selectAllIn(selection(), order)); }
    else if (note?.record) undoDelete();
    else if (note?.added) undoAdded();
    else clearFilters();
  };
  const cancel = el.querySelector('#tk-cancel'); if (cancel) cancel.onclick = leave;
  const move = el.querySelector('#tk-move');
  if (move) move.onclick = e => menuFor(move, e, '#tk-sel', STATUSES.map(([k, l]) => ({ label: l, run: () => { const ids = targetsNow(); if (ids.length) moveTo(ids, k, { selected: true }); } })), 160);
  const del = el.querySelector('#tk-delete'); if (del) del.onclick = () => { const ids = targetsNow(); if (ids.length) askDelete(ids, { selected: true }); };
  const owner = el.querySelector('#tk-owner');
  if (owner) owner.onclick = () => menuAtBar([...ownerPairs(get()), ['', 'Unassigned']].map(([k, l]) => ({ label: l, run: () => patchSelected({ owner: k }, k ? `Assigned to ${l}` : 'Unassigned') })));
  const priority = el.querySelector('#tk-priority');
  if (priority) priority.onclick = () => menuAtBar([['high', 'High'], ['low', 'Low'], ['none', 'No priority']]
    .map(([k, l]) => ({ label: l, run: () => patchSelected({ priority: k }, 'Priority set') })));
  const due = el.querySelector('#tk-due');
  if (due) due.onclick = () => menuAtBar([['Today', 0], ['Tomorrow', 1], ['In a week', 7]].map(([l, n]) => ({ label: l, run: () => patchSelected({ due: dayFrom(n) }, 'Due date set') }))
    .concat([{ label: 'No date', run: () => patchSelected({ due: '' }, 'Due date cleared') }]));
}

// ---- suggest tasks from text ------------------------------------------------------------------------------------------------
// A sub-page of Tasks with Back in the title bar (DIALOGS plan #67). A note typed or pasted here becomes tasks: by rule as it is typed
// (nothing leaves the machine), and by a model only when asked. The decision model classifies each sentence (kind, whether it asks for work,
// which study it names); a text model reads the note with a few lines about the project instead. Each result is a suggested task
// (lib/task-suggest.mjs): linked to the page that does the work, with a query in its notes, and added only when ticked and added; nothing
// runs a search or creates a schedule from here.

let askDraft = '';           // the text survives leaving the page
let suggesting = false;      // the sub-page is the page shown
let suggestGrow = null;      // the textarea's auto-grow, released when the page is left
const modelStatus = () => {
  const r = readModel(); if (r) return r.model || r.provider;
  const a = modelFor('tasks') || {};
  if (!a.provider) return 'No model';
  if (!configured(a)) return a.provider === 'claudeCli' ? 'Unavailable' : 'Not connected';
  return a.model || a.provider;
};
/** Opens the sub-page from the title bar's More; `text` starts it with a note already typed (the layout sweep). */
export function openSuggest(text = null) { if (text != null) askDraft = text; suggesting = true; editing = null; note = null; if (text == null) (barRerender || hostCtx?.rerender)?.(); }
/** Closes the sub-page without repainting (the layout sweep draws the page itself). */
export function closeSuggest() { suggestGrow?.release?.(); suggestGrow = null; suggesting = false; }
function leaveSuggest(rerender = barRerender || hostCtx?.rerender) { suggestGrow?.release?.(); suggestGrow = null; suggesting = false; rerender?.(); }
/** The title bar of the sub-page: Back to Tasks and its name. */
export function suggestSpec(run = {}) {
  return { title: 'Suggest tasks', back: { label: 'Back to Tasks', run: run.back || (() => {}) }, actions: [], overflow: [] };
}

function renderSuggest(el, ctx) {
  const cfg = readModel();
  // One primary (Suggest tasks); the model is configuration, so it is a line of status and an entry in More, never a second button.
  const foot = uiBar({ kind: 'foot', label: 'Suggest tasks', id: 'tk-ask-foot',
    ...(cfg ? { message: { id: 'tk-ask-model-line', text: `Model: ${modelStatus()}` } } : {}),
    actions: [{ id: 'tk-ask-model', label: 'Suggest tasks', icon: 'checklist', role: 'primary', disabled: !cfg }],
    overflow: cfg ? [{ id: 'tk-model-settings', label: 'Choose model…' }] : [] });
  el.innerHTML = `<section class="tk-suggest" id="tk-ask-form" aria-label="Suggest tasks">
      ${cfg ? '' : uiNotice({ id: 'tk-ask-notice', label: 'Model', text: 'Connect a model to get suggestions', actions: [{ id: 'tk-model-settings', label: 'Choose model…', icon: 'settings' }] })}
      ${formField('Text to plan from', `<textarea id="tk-ask" class="tk-ask" rows="4" placeholder="Describe what needs doing…" spellcheck="true">${esc(askDraft)}</textarea>`)}
      ${foot}
      <p class="meta tk-ask-note" id="tk-ask-note" role="status"></p>
      <div id="tk-ask-out"></div>
    </section>`;
  const box = el.querySelector('#tk-ask'), msg = el.querySelector('#tk-ask-note'), out = el.querySelector('#tk-ask-out');
  suggestGrow?.release?.(); suggestGrow = autoGrow(box);
  let shown = { items: [], origin: '', model: '' }, unticked = new Set();
  const draw = (focusAt = null) => {
    out.innerHTML = suggestedTasksList({ items: shown.items, origin: shown.origin, unticked, s: get() });
    out.querySelectorAll('[data-sugg-tick]').forEach(c => c.onchange = () => { const i = +c.dataset.suggTick; if (c.checked) unticked.delete(i); else unticked.add(i); draw(i); });
    const add = out.querySelector('[data-sugg-add]');
    if (add) add.onclick = () => {
      let n = 0;
      shown.items.forEach((x, i) => { if (!unticked.has(i) && !suggestionState(x.text, get()) && !addSuggested(x, { model: shown.model, source: 'text' }).refused) n++; });
      msg.textContent = n ? `${plural(n, 'task')} added` : '';
      ctx.refreshCounts?.(); draw();
    };
    if (focusAt != null) out.querySelector(`[data-sugg-tick="${focusAt}"]`)?.focus();
  };
  // A parsed sentence as a suggested task: a search or a schedule is linked to Search with its query kept in the notes.
  const asSuggestion = t => cleanSuggestion({ text: t.text, due: t.due || '', link: t.kind && t.kind !== 'todo' && TASK_KINDS[t.kind] ? { view: TASK_KINDS[t.kind].view, ...(t.target?.id ? { paperId: t.target.id } : {}) } : null,
    why: [t.query ? `Query: ${t.query}` : '', t.kind === 'schedule' && t.interval ? `Repeat ${t.interval}` : ''].filter(Boolean).join('. ') });
  const show = (tasks, origin, model = '') => { shown = { items: tasks.map(asSuggestion).filter(x => !x.error), origin, model }; unticked = new Set(); draw(); };
  const parseNow = () => {
    askDraft = box.value;
    const text = box.value.trim();
    if (!text) { out.innerHTML = ''; msg.textContent = ''; return; }
    const tasks = parseTasks(text, get());
    msg.textContent = tasks.length ? '' : 'Nothing actionable found';
    show(tasks, 'by rule');
  };
  let timer = null;
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(parseNow, 180); });
  box.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); el.querySelector('#tk-ask-model').click(); } });
  el.querySelectorAll('#tk-model-settings').forEach(b => { b.onclick = () => { askDraft = box.value; leaveSuggest(() => {}); ctx.go('settings:models'); }; });
  if (askDraft) parseNow();
  el.querySelector('#tk-ask-model').onclick = async () => {
    const text = box.value.trim(), model = readModel(); if (!text || !model) return;
    const btn = el.querySelector('#tk-ask-model'); btn.disabled = true;
    if (!isJev(model)) msg.textContent = `~${estimateTokens(text + projectContext(get()))} tokens`;
    try {
      const tasks = isJev(model) ? await classifyTasks(text, get(), model) : await detectTasks(text, model, { state: get() });
      if (!el.isConnected || !suggesting) return;
      msg.textContent = tasks.length ? '' : 'Nothing actionable found';
      show(tasks, model.model, model.model);
    } catch (err) { msg.textContent = String(err.message).slice(0, 120); }
    btn.disabled = false;
  };
  box.focus();
}

/** One click on a row while selecting: the box or the row toggles it, Shift-click takes the range from the last one chosen. */
function pickRow(e) {
  const row = e.target.closest('.ui-row[data-task]'); if (!row || e.target.closest('.ui-row-end, .tk-link') || e.target.matches('label')) return;   // a click on the label's padding is followed by the box's own click
  const id = row.dataset.task, order = orderOf(allTasks()), cur = selection();
  if (!cur.active) {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault(); note = null; sel = enterSelect(cur, id);                      // a silent shortcut: Cmd or Ctrl and click enters with this row chosen
    redraw(); return;
  }
  if (!e.target.closest('.ui-row-check')) e.preventDefault();
  setSel(e.shiftKey ? rangeTo(cur, order, id) : toggleId(cur, id));
}

function wireRows(el, ctx) {
  const lists = el.querySelectorAll('.ui-list[data-task-column], #tk-rows');
  lists.forEach(list => { list.onclick = pickRow; list.onmousedown = e => { if (e.shiftKey && selecting() && e.target.closest('.ui-row')) e.preventDefault(); }; });
  el.querySelectorAll('[data-done]').forEach(c => c.onchange = () => { change(s => patchTask(s.todos, c.dataset.done, { done: c.checked })); repaint(); });
  const open = id => { if (!selecting()) openEditor(id); };
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = e => {
    if (selecting() || e.metaKey || e.ctrlKey) return;
    if (editing !== b.dataset.edit) { openEditor(b.dataset.edit); return; }
    editing = null; render(el, ctx); el.querySelector(`[data-edit="${CSS.escape(b.dataset.edit)}"]`)?.focus();
  });
  el.querySelectorAll('[data-open-edit]').forEach(b => b.onclick = e => { if (!e.metaKey && !e.ctrlKey) open(b.dataset.openEdit); });
  el.querySelectorAll('[data-link]').forEach(b => b.onclick = () => {
    const t = allTasks().find(x => x.id === b.dataset.link); if (!t?.link) return;
    if (t.link.paperId && (get().papers || []).some(p => p.id === t.link.paperId)) openStudy(ctx, t.link.paperId);
    else ctx.go(t.link.view);
  });
  el.querySelectorAll('[data-more]').forEach(b => b.onclick = () => rowMenu(b, b.dataset.more));
  if (mode === 'board') wireDrag(el);
}

/** Dragging a card onto another column moves it there; the column under the pointer takes a fill, nothing else moves. */
let dragged = '', draggedFrom = '';
function wireDrag(el) {
  const unmark = () => el.querySelectorAll('.tk-col[data-tk-drop]').forEach(c => delete c.dataset.tkDrop);
  el.querySelectorAll('.ui-row[data-task][draggable="true"]').forEach(r => {
    r.ondragstart = e => { dragged = r.dataset.task; draggedFrom = r.closest('.tk-col')?.dataset.status || ''; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.querySelector('.tk-text')?.title || ''); };
    r.ondragend = () => { dragged = ''; draggedFrom = ''; unmark(); };
  });
  el.querySelectorAll('.tk-col[data-status]').forEach(col => {
    col.ondragover = e => { if (!dragged || col.dataset.status === draggedFrom) return;   /* its own column is not a target */ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!('tkDrop' in col.dataset)) { unmark(); col.dataset.tkDrop = ''; } };
    col.ondragleave = e => { if (!col.contains(e.relatedTarget)) delete col.dataset.tkDrop; };
    col.ondrop = e => {
      e.preventDefault(); unmark();
      const id = dragged; dragged = ''; draggedFrom = ''; if (!id) return;
      if (allTasks().find(x => x.id === id)?.status !== col.dataset.status) moveTo([id], col.dataset.status);
    };
  });
}

function wireEdit(ed, el, ctx) {
  const id = ed.dataset.editing;
  ed.querySelectorAll('[data-f]').forEach(input => input.setAttribute('data-form-key', `task:${id}:${input.dataset.f}`));
  const set = patch => change(s => patchTask(s.todos, id, patch));
  const text = ed.querySelector('[data-f="text"]');
  text.onchange = () => { if (text.value.trim()) set({ text: text.value.trim() }); };
  ed.querySelector('[data-f="status"]').onchange = e => { set({ status: e.target.value }); ctx.refreshCounts?.(); redraw(); };
  ed.querySelector('[data-f="priority"]').onchange = e => { set({ priority: e.target.value }); redraw(); };
  ed.querySelector('[data-f="owner"]').onchange = e => { set({ owner: e.target.value }); redraw(); };
  for (const [k, name] of [['start', 'Start'], ['due', 'Due']]) {
    const fid = `tk-${k}-${id}`;
    wireDateField(ed, fid, name);
    ed.querySelector(`#${CSS.escape(fid)}`).addEventListener('change', e => { set({ [k]: e.target.value }); ctx.refreshCounts?.(); redraw(); });
  }
  ed.querySelector('[data-f="parentId"]').onchange = e => { set({ parentId: e.target.value }); redraw(); };
  const lv = ed.querySelector('[data-f="linkView"]'), lp = ed.querySelector(`#tk-link-${CSS.escape(id)}`);
  const setLink = () => {
    const paperId = lp?.value || '';
    const view = paperId ? (lv.value || 'library') : lv.value;
    set({ link: view ? { view, ...(paperId ? { paperId } : {}) } : null }); redraw();
  };
  lv.onchange = setLink;
  if (lp) {
    wireRecordPicker(ed, { id: `tk-link-${id}`, label: 'Record', records: () => get().papers || [], onSelect: setLink });
    const clear = ed.querySelector(`#tk-clear-record-${CSS.escape(id)}`);
    if (clear) clear.onclick = () => { lp.value = ''; setLink(); };
  }
  ed.querySelectorAll('[data-blocker]').forEach(c => c.onchange = () => {
    const t = normaliseTasks(get().todos).find(x => x.id === id);
    const next = c.checked ? [...t.blockedBy, c.dataset.blocker] : t.blockedBy.filter(b => b !== c.dataset.blocker);
    set({ blockedBy: next }); redraw();
  });
  wireRecordPicker(ed, { id: `tk-blocker-${id}`, label: 'Blocking task', records: () => {
    const all = normaliseTasks(get().todos), task = all.find(x => x.id === id);
    return task ? all.filter(x => x.id !== id && !x.done && !task.blockedBy.includes(x.id) && !wouldCycle(all, id, x.id)).map(x => ({ id: x.id, label: x.text })) : [];
  }, onSelect: blocker => {
    const all = normaliseTasks(get().todos), task = all.find(x => x.id === id);
    if (task && !task.blockedBy.includes(blocker) && !wouldCycle(all, id, blocker)) { set({ blockedBy: [...task.blockedBy, blocker] }); redraw(); }
  } });
  ed.querySelector('[data-close-edit]').onclick = () => { editing = null; render(el, ctx); el.querySelector(`[data-edit="${CSS.escape(id)}"]`)?.focus(); };
}


