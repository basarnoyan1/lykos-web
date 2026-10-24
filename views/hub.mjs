// All projects (plan §2 "Workspace", amendments "Tasks hub" and "All projects: the portfolio"; designs: scratchpad plans/tasks-hub.md,
// plans/PORTFOLIO.md).
//
// A page, not a pane: it opens on the portfolio (every project at a glance: stage, tasks, next date, submission, when opened; the
// portfolio's own wiring is views/hub-portfolio.mjs) every time the rail item is pressed, and its one navigator is the head's title pick:
// Projects | All work, Today, Upcoming, Overdue, Logbook. A project's own task list (`p:<id>`) is reached from its row and inspector.
// A task section is grouped by when its tasks are due; the inspector shows the task (or the project) that was clicked (`inspect`).
// Reading, grouping, counting and the markup are lib/hub-tasks.mjs; this module owns the state, the keyboard and the writes.
//
// The open project's tasks come from memory and can be changed here. Every other project is read where it is kept, two at a time,
// through the project file only, and is read-only in this version: it is never written through its project file. A task added to
// another project, or moved to it, goes as one new file into that project's own inbox (lib/task-handoff.mjs); the target takes it in
// itself when it is next open, and Undo takes the file back until then.
import { get, update, getVersion, saveState, saveError, backupState } from '../store.mjs';
import * as projects from '../lib/projects.mjs';
import { readLocalProject, backupListedProject, backupReport } from '../lib/project-backup.mjs';
import { fullSummary, rememberSummary, cachedSummary } from '../lib/dashboard.mjs';
import { canOpenFolders } from '../lib/fsys.mjs';
import { createPortfolio } from './hub-portfolio.mjs';
import { inDesktop, allowFoldersNative } from '../lib/native.mjs';
import { folderAtPath, folderFromHandle, permitted } from '../lib/fsys.mjs';
import { newSelection, enterSelect, leaveSelect, toggleId, rangeTo, selectAllIn, reconcile, bulkTargets } from '../lib/task-select.mjs';
import { HandoffError, packTasks, droppedNote, makeHandoff, sendHandoff, withdrawHandoff } from '../lib/task-handoff.mjs';
import { rememberNavigation } from '../lib/navigation.mjs';
import { normaliseTasks, STATUSES, PRIORITIES, removeTasks, removalEffects, restoreRemoved, moveTasks, bulkPatch, patchTask, makeTask, tasksSignature, pendingRemoval, clearRemoval } from '../lib/tasks.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { dateField, wireDateField, dateValue } from '../lib/date-picker.mjs';
import { regionShow, inspectorActions } from '../lib/ui-actions.mjs';
import { esc, autoGrow } from '../lib/html.mjs';
import { plural, day } from '../lib/dates.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { focusControl } from '../lib/bar-fit.mjs';
import { absorberArmed } from '../lib/handoff-absorb.mjs';
import { createHubReader, loadHub, orderEntries, navModel, listModel, pendingAdds, hubListParts, projectKey, projectOfKey, PROJECTS_LIST, SMART_LISTS, PERIODS,
  defaultFilters, selectableIds, moveTargets, planRemoval, restoreOrAppend, localDay, projectName, titleCount, datesOfProject, hubPageSpec } from '../lib/hub-tasks.mjs';

// ---- what the page reads and writes in the running app. A test hands `render` its own. -----------------------------------------------

/** A browser project's folder handle as stored by projects.mjs; null when there is none. Read only. */
function storedHandle(id) {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open('lykos-projects', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onerror = () => resolve(null);
      r.onsuccess = () => {
        try {
          const q = r.result.transaction('handles', 'readonly').objectStore('handles').get(id);
          q.onsuccess = () => { resolve(q.result || null); r.result.close(); };
          q.onerror = () => { resolve(null); r.result.close(); };
        } catch { resolve(null); r.result.close(); }
      };
    } catch { resolve(null); }
  });
}
/** Only what reading needs: the reader gets `stat` and `read` and nothing that could write. */
const readOnly = f => ({ stat: rel => f.stat(rel), read: rel => f.read(rel) });

/** The open project's summary, made once per change of the project (store version), never per paint. */
let openMemo = { version: -1, summary: null };
const openSummary = () => {
  if (openMemo.version !== getVersion()) openMemo = { version: getVersion(), summary: (() => { try { return fullSummary(get()); } catch { return null; } })() };
  return openMemo.summary;
};

export const defaultDeps = () => ({
  list: () => projects.switchList(),
  summarize: raw => fullSummary(raw),
  keepSummary: (id, summary) => rememberSummary(id, null, { summary }),
  openSummary,
  cached: id => cachedSummary(id),
  openNote: () => saveError() ? 'Not saved' : saveState() === 'saving' ? 'Unsaved changes' : backupState().status === 'failed' ? 'Backup failed' : '',
  openHealth: () => { const b = backupState(); return [['Saved', saveError() ? `Not saved: ${saveError()}` : saveState() === 'saving' ? 'Unsaved changes' : 'All changes saved'], ...(b.status === 'failed' ? [['Backup', `Failed: ${b.error}`]] : b.status === 'current' ? [['Backup', 'Current']] : [])]; },
  locationOf: entry => projects.locationOf(entry),
  setFlags: (id, flags) => projects.setFlags(id, flags),
  removeFromList: id => projects.removeFromList(id),
  rename: (id, name) => projects.renameProject(id, name, { renameOpen: n => update(s => { s.project = { ...(s.project || {}), name: n }; return s; }) }),
  duplicate: async (id, name) => { const data = id === projects.currentId() ? structuredClone(get()) : id === projects.LOCAL ? await readLocalProject() : await projects.readAppProject(id); if (!data) throw new Error('That project is no longer stored here'); return projects.addAppProject(data, name); },
  deleteStored: id => projects.deleteStoredProject(id),
  backup: async id => backupReport(await backupListedProject(id)),
  reveal: async entry => { await allowFoldersNative([entry.path]).catch(() => {}); await folderAtPath(entry.path).reveal(''); },
  newProject: opts => projects.newProject(opts),
  openFolder: () => projects.openFolder(),
  findProjects: async () => projects.collectionMessage(await projects.addProjectCollection(null, { chooser: async (found, folder) => (await import('./folder-import-dialog.mjs')).chooseProjects(found, folder, { title: 'Add projects', confirm: 'Add' }) })),
  canOpenFolders: () => canOpenFolders(),
  canReveal: () => inDesktop(),
  openId: () => projects.isNone() ? null : projects.currentId(),
  openTasks: () => normaliseTasks(get().todos),
  openName: () => get().project?.name || '',
  openDates: () => datesOfProject(get()),
  change: fn => update(s => { s.todos = Array.isArray(s.todos) ? s.todos : []; fn(s); return s; }),
  readApp: id => projects.readAppProject(id),
  readLocal: () => readLocalProject(),
  async folderFor(entry) {
    if (entry.kind === 'path') {
      if (!inDesktop()) return null;
      await allowFoldersNative([entry.path]).catch(() => {});
      return readOnly(folderAtPath(entry.path));
    }
    const handle = await storedHandle(entry.id);
    return handle && await permitted(handle) ? readOnly(folderFromHandle(handle)) : null;
  },
  /** The folder of a project that is not open, with what a hand-off needs (create a file and folders, rename inside the inbox); null when it cannot be reached or written here. */
  async writableFolderFor(entry) {
    if (entry.kind === 'path') {
      if (!inDesktop()) return null;
      await allowFoldersNative([entry.path]).catch(() => {});
      return folderAtPath(entry.path);
    }
    const handle = await storedHandle(entry.id);
    return handle && await permitted(handle) ? folderFromHandle(handle) : null;
  },
  /** Whether the shell takes hand-offs in: without it a task sent away would wait in a folder nobody reads. */
  handoffReady: () => absorberArmed(),
  remember: (id, where) => rememberNavigation(id, where),
  open: id => projects.open(id),
});

// ---- the projects, read: one core per running app (a test makes its own) ---------------------------------------------------------------

function makeCore(d, timeoutMs) {
  const reader = createHubReader(d, { timeoutMs });
  const results = new Map(), seen = new Map(), listeners = new Set(), pend = pendingAdds();
  let gen = 0, started = 0;
  const stamp = r => r.error ? `error:${r.error.code}` : tasksSignature(r.tasks);
  const core = {
    d, reader, results, pend,
    /** The projects in the order the page reads them: the open one first. */
    entries: () => orderEntries(d.list(), d.openId()),
    /** The projects as the app lists them (most recently opened first), for the portfolio. */
    listed: () => d.list(),
    /** What was read, with the open project always as it is in memory now, not as it was when the page was read. */
    view() {
      const open = d.openId(), out = new Map(results);
      if (open) {
        const entry = d.list().find(e => e.id === open), base = results.get(open);
        if (!base?.error) out.set(open, { id: open, kind: entry?.kind || base?.kind, current: true, name: d.openName?.() || base?.name || (entry ? projectName(entry) : 'Project'), tasks: d.openTasks(), dates: d.openDates?.() || [], summary: d.openSummary?.() || base?.summary || null });
      }
      pend.reconcile(out);
      return out;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Reads every project again (an unchanged folder costs one stat); results are handed to the listeners as they arrive. */
    load({ only = null, gap = 0 } = {}) {
      if (gap && Date.now() - started < gap) return Promise.resolve();
      started = Date.now();
      const mine = ++gen, entries = core.entries().filter(e => !only || only(e));
      return loadHub(entries, reader, { cancelled: () => mine !== gen, onResult: r => {
        const before = seen.get(r.id); seen.set(r.id, stamp(r)); results.set(r.id, r);
        if (before === undefined || before !== stamp(r)) for (const fn of [...listeners]) fn(r);
      } });
    },
    get started() { return started; },
  };
  return core;
}
let core = null;
const theCore = () => (core ||= makeCore(defaultDeps()));

// ---- the view's own state ---------------------------------------------------------------------------------------------------------

let section = null;                           // the section that was chosen (a key of the title pick, or a project's list), kept while the app runs
let fresh = false;                            // the page was left: the next arrival opens on the portfolio, unless a link chose a section
let filters = defaultFilters();               // text of the search; the two toggles in More
const expanded = new Set();                   // groups opened with Show all: paged, fifty a page
const groupPages = new Map();                 // the page each opened group is on
let sel = newSelection();                     // the chosen tasks of the open project
let note = null;                              // { text, after, undo?, move?, record?, add? }: what the last action did
let selectedTask = null;                      // { pid, id }: the task the inspector shows
let focusKey = '';                            // the row that is the tab stop
let addProjectId = '';                        // where the quick-add row sends a task on a list that spans projects
let host = null, hostCtx = null, unlisten = null, keysOn = null, moving = false, live = null;
const keyOf = (pid, id) => `${pid}\u0000${id}`;
const today = () => localDay();

const defaultPage = () => PROJECTS_LIST;
/** The section on show: the one chosen, or the portfolio; a project that left the list is not one. */
function current() {
  const c = theCore();
  if (section && (section === PROJECTS_LIST || SMART_LISTS.some(([k]) => k === section) || c.entries().some(e => projectKey(e.id) === section))) return section;
  return defaultPage();
}
const alive = () => !!host && host.isConnected && !!host.querySelector(':scope > [data-hub]');

// ---- the sections: the title pick, links in -------------------------------------------------------------------------------------

/** What the title pick offers with its counts: navModel's items (All work, Today, Upcoming, Overdue, Logbook, Projects, one per project). */
export function navItems() {
  const c = theCore();
  if (!c.started) c.load().catch(() => {});
  return navModel(c.entries(), c.view(), today()).items;
}
/** Chooses a section (a key of the title pick, or `p:<id>` for a project's list). A link that chose a section is kept on the next arrival. */
export function select(id) {
  fresh = false;
  if (id === section) return;
  section = id; filters = { ...filters, text: '' }; expanded.clear(); groupPages.clear(); sel = leaveSelect(); note = null; selectedTask = null; focusKey = '';
}
export const selected = () => current();
export const navigationState = () => ({ list: current() });
export function restoreNavigation(s) { if (typeof s?.list === 'string') { section = s.list; fresh = false; } }
/** A link from elsewhere (the start screen) to one task: its project's list, the task selected. */
export function focusTask(projectId, taskId) { fresh = false; section = projectKey(projectId); selectedTask = taskId ? { pid: projectId, id: taskId } : null; focusKey = taskId ? keyOf(projectId, taskId) : ''; }

/** The shell left the page: the next time the rail item is pressed it opens on the portfolio. */
export function unmount() {
  unlisten?.(); unlisten = null; keysOn?.removeEventListener('keydown', onKey); keysOn = null; host = null; hostCtx = null; live = null;
  sel = leaveSelect(); note = null; fresh = true;
}

// ---- drawing ---------------------------------------------------------------------------------------------------------------------

const rowSel = (pid, id) => `[data-hub-row="${CSS.escape(id)}"][data-hub-project="${CSS.escape(pid)}"]`;
let model = null;
const listState = () => {
  const c = theCore(), chosen = sel.active ? sel.ids : null;
  return { today: today(), selecting: sel.active, chosen, selectedKey: selectedTask ? keyOf(selectedTask.pid, selectedTask.id) : '', focusKey, expanded, pages: groupPages, filters, note: note && { text: note.text, undo: !!(note.undo || note.move || note.record || note.add) }, addProjectId };
};
const buildModel = () => { const c = theCore(); return listModel(c.entries(), c.view(), { list: current(), text: filters.text, showDone: filters.showDone, byProject: filters.byProject, period: filters.period, pending: c.pend }, today()); };
const orderNow = () => selectableIds(model || buildModel());

/** The whole page: used when the section changes or the page is first drawn. */
function draw() {
  if (!host) return;
  const key = current(), c = theCore();
  if (sel.active) sel = reconcile(sel, new Set(selectableIds(model = buildModel())));
  if (note?.after && note.after !== tasksSignature(c.d.openTasks())) note = null;
  if (!note) { const r = pendingRemoval(c.d.openTasks()); if (r) { note = { text: r.text, after: r.record.after, record: r.record, undo: true }; clearRemoval(); } }      // tasks the assistant removed, while they are as it left them
  let html;
  if (key === PROJECTS_LIST) { model = null; const p = pf.parts(); html = `${p.tools}<div id="hub-portfolio">${p.body}</div><div class="meta" role="status" id="hub-status"></div>`; }
  else { model = buildModel(); const p = hubListParts(model, listState()); html = `${p.bars}${p.add}<div id="hub-results">${p.results}</div><div class="meta" role="status" id="hub-status"></div>`; }
  host.innerHTML = `<div class="hub-body" data-hub data-hub-page="${esc(key)}">${html}</div>`;
  syncCount();
  wire();
}
/** Only what is below the bars: the search box keeps its focus and the bars are not measured again. */
function drawResults() {
  if (!alive()) return;
  if (!host.querySelector('#hub-results')) { draw(); return; }
  model = buildModel();
  if (sel.active) sel = reconcile(sel, new Set(selectableIds(model)));
  const p = hubListParts(model, listState());
  host.querySelector('#hub-results').innerHTML = p.results;
  syncCount(); syncBars(); wireResults(); applyRoving();
}
/** The section's count, as the title bar shows it: the projects listed, or a task section's "16 open" ("Reading 2 projects" until every project answered). */
const countOf = key => (key === PROJECTS_LIST ? (n => (n ? String(n) : ''))(theCore().listed().length) : titleCount(model || buildModel()));
/** What the open section counts ('29 open', 'Reading 2 projects'): the title's menu says it; the title bar shows only a state (Component review 2026-10-21, item 1). */
export const pageCount = () => countOf(current());
/** The count is the title bar's status (page()): projects answer while the page is open, so it is written in place, in its reserved slot. */
const syncCount = () => { const n = document.getElementById('topbar-status'), text = countOf(current()); if (n && n.textContent !== text) n.textContent = text; };
/** The selection bar's count and its buttons, in place. */
function syncBars() {
  if (!host || !model) return;
  const order = orderNow(), n = bulkTargets(sel, order).length, put = (id, text) => { const p = host.querySelector(`#${id}`); if (p && p.textContent !== text) p.textContent = text; };
  put('hub-sel-n', `${n} selected of ${order.length}`);
  for (const id of ['hub-move', 'hub-due', 'hub-priority', 'hub-remove']) { const b = host.querySelector(`#${id}`); if (b) b.disabled = !n; }
  const pick = host.querySelector('#hub-select'); if (pick) pick.disabled = !order.length;
  const region = host.querySelector('#hub-region'); if (region) regionShow(region, sel.active ? 1 : 0);
  host.querySelectorAll('input[data-hub-select]').forEach(box => { box.checked = sel.ids.has(box.dataset.hubSelect); });
}
const status = text => { const n = host?.querySelector('#hub-status'); if (n) n.textContent = text; };
/** A repaint of the page that keeps the focus where it was: a row stays the one in focus even when its group changes. */
function redraw(after, { whole = false } = {}) {
  const active = host?.contains(document.activeElement) ? document.activeElement : null, row = active?.closest?.('[data-hub-row]');
  const was = row ? { pid: row.dataset.hubProject, id: row.dataset.hubRow, part: active.matches('input') ? 'input' : active.matches('[data-open]') ? 'open' : active.matches('[data-more]') ? 'more' : 'row' } : null;
  const run = () => (whole ? draw() : drawResults());
  rerenderForm(host, { rerender: run }, { fallback: '#hub-new-text', after: () => {
    if (was && (!document.activeElement || document.activeElement === document.body)) {
      const r = host?.querySelector(rowSel(was.pid, was.id)) || host?.querySelector(`[data-hub-row][tabindex="0"]`);
      (r && was.part !== 'row' ? r.querySelector(was.part === 'input' ? 'input' : was.part === 'open' ? '[data-open]' : '[data-more]') || r : r)?.focus({ preventScroll: true });
    }
    after?.();
  } });
}
/** The app's own counts, after something changed. */
const repaint = after => { hostCtx?.refreshCounts?.(); redraw(after); };

// ---- roving focus over the rows -----------------------------------------------------------------------------------------------------

const rowsNow = () => [...(host?.querySelectorAll('#hub-results [data-hub-row]') || [])];
function applyRoving() {
  const rows = rowsNow(); if (!rows.length) return;
  if (!rows.some(r => keyOf(r.dataset.hubProject, r.dataset.hubRow) === focusKey)) focusKey = keyOf(rows[0].dataset.hubProject, rows[0].dataset.hubRow);
  for (const r of rows) {
    const on = keyOf(r.dataset.hubProject, r.dataset.hubRow) === focusKey;
    r.tabIndex = on ? 0 : -1;
    r.querySelectorAll('input, button').forEach(b => { b.tabIndex = on ? 0 : -1; });
  }
}
function focusRow(row, { move = true } = {}) {
  if (!row) return;
  focusKey = keyOf(row.dataset.hubProject, row.dataset.hubRow); applyRoving();
  if (move) row.focus({ preventScroll: false });
}
const rowFor = (pid, id) => host?.querySelector(`#hub-results ${rowSel(pid, id)}`);

// ---- the task that is selected (the inspector) ---------------------------------------------------------------------------------------

function markSelected() {
  const k = selectedTask ? keyOf(selectedTask.pid, selectedTask.id) : '';
  for (const r of rowsNow()) r.setAttribute('aria-selected', String(keyOf(r.dataset.hubProject, r.dataset.hubRow) === k));
}
function selectTask(pid, id, { details = 'show' } = {}) {
  selectedTask = { pid, id }; markSelected();
  const row = rowFor(pid, id); if (row) focusRow(row, { move: false });
  if (details === 'open') hostCtx?.openDetails?.(); else if (details === 'show') hostCtx?.showDetails?.();
}
const taskOf = sel1 => { const r = sel1 && theCore().view().get(sel1.pid); return r && !r.error ? { r, t: r.tasks.find(x => x.id === sel1.id) } : null; };

// ---- writing the open project -----------------------------------------------------------------------------------------------------

const change = fn => theCore().d.change(fn);
const openSig = () => tasksSignature(theCore().d.openTasks());
const isOpen = pid => !!pid && pid === theCore().d.openId();

function setDone(id, done) {
  change(s => patchTask(s.todos, id, { done }));
  note = null; repaint();
}
function patchOne(id, patch) {
  change(s => patchTask(s.todos, id, patch));
  repaint();
}
function removeIds(ids, { text } = {}) {
  let result = null;
  change(s => { result = removeTasks(s.todos, ids); s.todos = result.list; });
  if (!result?.removed.length) return;
  if (selectedTask && ids.includes(selectedTask.id) && isOpen(selectedTask.pid)) selectedTask = null;
  const next = nextRowAfter(ids);
  sel = leaveSelect();
  note = { text: text || `${plural(result.removed.length, 'task')} removed`, after: result.after, record: result, undo: true };
  repaint(() => { if (next) focusRow(rowFor(next.pid, next.id)); hostCtx?.showDetails?.(); });
}
/** The row to move focus to when the focused one is removed: the next one in reading order, else the one before. */
function nextRowAfter(ids) {
  const rows = rowsNow(), gone = new Set(ids), at = rows.findIndex(r => keyOf(r.dataset.hubProject, r.dataset.hubRow) === focusKey);
  const pick = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0)).reverse()].find(r => !(gone.has(r.dataset.hubRow) && isOpen(r.dataset.hubProject)));
  return pick ? { pid: pick.dataset.hubProject, id: pick.dataset.hubRow } : null;
}
async function askRemove(ids) {
  // removed at once: its note's Undo takes it back, so nothing is asked first (Component review 2026-10-21, item 19)
  removeIds(ids);
}
function undoRemove() {
  const record = note?.record; if (!record) return;
  let back = null;
  change(s => { back = restoreRemoved(s.todos, record); if (back) s.todos = back; });
  note = back ? { text: `Restored ${plural(record.removed.length, 'task')}`, after: tasksSignature(back) } : null;
  repaint(() => { if (!back) status('Tasks changed, so the removal cannot be undone'); });
}

const chosen = () => bulkTargets(sel, orderNow());
function moveStatus(ids, status) {
  if (!ids.length) return;
  let r = null;
  change(s => { r = moveTasks(s.todos, ids, status); });
  const label = Object.fromEntries(STATUSES)[status], bulk = sel.active;
  sel = leaveSelect();
  note = { text: !r.moved ? `Already in ${label}` : ids.length === 1 && !bulk ? `Moved to ${label}` : `Moved ${r.moved} to ${label}${r.skipped.length ? `, ${r.skipped.length} already there` : ''}`, after: openSig() };
  repaint();
}
function patchChosen(patch, text) {
  const ids = chosen(); if (!ids.length) return;
  let r = null;
  change(s => { r = bulkPatch(s.todos, ids, patch); });
  sel = leaveSelect();
  note = { text: r.changed ? `${text} on ${plural(r.changed, 'task')}` : 'Nothing changed', after: openSig() };
  repaint();
}
const dayFrom = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateValue(d); };
const dueItems = apply => [['Today', 0], ['Tomorrow', 1], ['In a week', 7]].map(([label, n]) => ({ label, run: () => apply({ due: dayFrom(n) }, 'Due date set') })).concat([{ label: 'No date', run: () => apply({ due: '' }, 'Due date cleared') }]);
const priorityItems = apply => [['high', 'High'], ['low', 'Low'], ['none', 'No priority']].map(([k, l]) => ({ label: l, run: () => apply({ priority: k }, 'Priority set') }));
/** An action on one row's task, through the same note line the bulk actions use. */
const oneApply = id => (patch, text) => { change(s => bulkPatch(s.todos, [id], patch)); note = { text, after: openSig() }; repaint(); };

// ---- sending to another project (a hand-off), and what Undo takes back --------------------------------------------------------------------

const targetsNow = () => { const c = theCore(), ready = !!c.d.writableFolderFor && !!c.d.handoffReady?.(); return moveTargets(c.entries(), c.view(), c.d.openId()).map(t => (ready || !t.ok ? t : { ...t, ok: false, reason: 'Unavailable' })); };

async function moveToProject(ids, target) {
  const c = theCore(), d = c.d;
  if (!ids.length || moving) return false;
  const entry = c.entries().find(e => e.id === target.id), all = normaliseTasks(d.openTasks());
  const pack = packTasks(all, ids), fx = removalEffects(all, ids), n = pack.tasks.length;
  const detail = [droppedNote(pack.dropped),
    fx.lifted ? `${plural(fx.lifted, 'subtask')} that you did not select ${fx.lifted === 1 ? 'moves' : 'move'} up a level.` : '',
    fx.unblocked ? `${plural(fx.unblocked, 'task')} that waited for ${n === 1 ? 'it' : 'them'} will not wait any more.` : ''].filter(Boolean).join(' ');
  const later = `${target.name} adds ${n === 1 ? 'it' : 'them'} the next time it is opened.`;
  if (!await confirmAsk(`Move ${plural(n, 'task')} to ${target.name}?`, { detail: [later, detail].filter(Boolean).join(' '), confirm: 'Move' })) return false;
  moving = true;
  try {
    let sent;
    try {
      const folder = d.writableFolderFor ? await d.writableFolderFor(entry) : null;
      if (!folder) throw new HandoffError('unavailable');
      sent = await sendHandoff(folder, makeHandoff({ from: { id: d.openId() || '', name: d.openName() || '' }, tasks: pack.tasks }));
    } catch (err) { status(`${String(err?.message || err)}. Nothing was moved.`); return false; }
    // The copy is in the target's inbox and has been read back: only now do the tasks leave this project. A task that changed while it
    // was being written stays here as well (it is in both, never in neither).
    let plan = null, removal = null;
    change(s => { plan = planRemoval(s.todos, all, ids); removal = removeTasks(s.todos, plan.remove); s.todos = removal.list; });
    if (!removal.removed.length) {
      await withdrawHandoff(await d.writableFolderFor(entry), sent.id).catch(() => {});
      sel = leaveSelect(); note = null;
      redraw(() => status('The tasks changed while they were being sent, so nothing was moved'));
      return false;
    }
    sel = leaveSelect();
    if (selectedTask && ids.includes(selectedTask.id) && isOpen(selectedTask.pid)) selectedTask = null;
    const kept = plan.kept.length;
    note = { text: `Sent ${removal.removed.length} to ${target.name}`, after: removal.after, move: { id: sent.id, entry, name: target.name, record: removal } };
    repaint(() => { if (kept) status(`${plural(kept, 'task')} changed while sending, so ${kept === 1 ? 'it stays' : 'they stay'} here as well`); hostCtx?.showDetails?.(); });
    return true;
  } finally { moving = false; }
}

async function undoMove() {
  const m = note?.move; if (!m || moving) return;
  const d = theCore().d;
  moving = true;
  try {
    let r;
    try {
      const folder = d.writableFolderFor ? await d.writableFolderFor(m.entry) : null;
      if (!folder) throw new HandoffError('unavailable');
      r = await withdrawHandoff(folder, m.id);
    } catch (err) { status(`${String(err?.message || err)}. Nothing was undone.`); return; }
    if (!r.withdrawn) { note = { text: `${m.name} has added them already`, after: openSig() }; redraw(); return; }
    change(s => { s.todos = restoreOrAppend(s.todos, m.record); });
    note = { text: `Restored ${plural(m.record.removed.length, 'task')}`, after: openSig() };
    repaint();
  } finally { moving = false; }
}

/** A task added to a project that is not open: one new file in its inbox, drawn from memory until that project has taken it in. */
async function addToOther(entry, text) {
  const c = theCore(), d = c.d;
  const target = targetsNow().find(t => t.id === entry.id);
  if (!target?.ok) { status(`${target?.name || projectName(entry)} cannot take a task now${target?.reason ? `: ${target.reason}` : ''}`); return false; }
  const task = makeTask({ text });
  let sent;
  try {
    const folder = d.writableFolderFor ? await d.writableFolderFor(entry) : null;
    if (!folder) throw new HandoffError('unavailable');
    sent = await sendHandoff(folder, makeHandoff({ from: { id: d.openId() || '', name: d.openName() || '' }, tasks: [task] }));
  } catch (err) { status(`${String(err?.message || err)}. The task was not added.`); return false; }
  c.pend.add(entry.id, task, sent.id);
  note = { text: `Sent to ${target.name}`, add: { id: sent.id, entry, name: target.name } };
  return true;
}
async function undoAdd() {
  const a = note?.add; if (!a) return;
  const c = theCore(), d = c.d;
  try {
    const folder = d.writableFolderFor ? await d.writableFolderFor(a.entry) : null;
    if (!folder) throw new HandoffError('unavailable');
    const r = await withdrawHandoff(folder, a.id);
    if (!r.withdrawn) { note = { text: `${a.name} has added it already` }; redraw(); return; }
  } catch (err) { status(`${String(err?.message || err)}. Nothing was undone.`); return; }
  c.pend.takeBack(a.id); note = { text: 'Task taken back' };
  redraw();
}

async function addTask(text) {
  const c = theCore(), key = current(), pid = projectOfKey(key) || (model?.crossProject ? (model.projects.find(p => p.id === addProjectId) || model.projects.find(p => p.current) || model.projects[0])?.id : c.d.openId()) || c.d.openId();
  if (!text.trim() || !pid) return;
  if (pid === c.d.openId()) {
    change(s => { s.todos.push(makeTask({ text })); });
    note = null; repaint(() => host?.querySelector('#hub-new-text')?.focus());
    return;
  }
  const entry = c.entries().find(e => e.id === pid); if (!entry) return;
  if (await addToOther(entry, text.trim())) repaint(() => host?.querySelector('#hub-new-text')?.focus());
}

// ---- opening --------------------------------------------------------------------------------------------------------------------------

async function openProject(pid, taskId) {
  const c = theCore(), d = c.d;
  try {
    if (pid === d.openId()) {
      if (taskId) (await import('./tasks.mjs')).focusTask(taskId);
      hostCtx?.go?.(taskId ? 'tasks' : 'overview');
      return;
    }
    if (taskId) d.remember(pid, { view: 'tasks', section: `task:${taskId}` });
    await d.open(pid);
  } catch (err) { status(String(err?.message || err)); }
}

/** A dated item that is not a task (a milestone, an ethics deadline, the registry date): the page of its project that holds it. */
async function openDated(pid, view) {
  const d = theCore().d;
  try {
    if (pid === d.openId()) { hostCtx?.go?.(view); return; }
    const [v, section] = String(view).split(':');
    d.remember(pid, { view: v, ...(section ? { section } : {}) });
    await d.open(pid);
  } catch (err) { status(String(err?.message || err)); }
}

// ---- menus ----------------------------------------------------------------------------------------------------------------------------

/** A menu opens under its button. A click the bar forwards from More (not a person's click) has no button to open under, so the bar's trailing edge stands in. */
const menuFor = (button, e, bar, items, minWidth = 180) => (e?.isTrusted ? showMenu(button, items, { minWidth }) : showMenu(host.querySelector(bar), items, { align: 'end', minWidth, matchWidth: false }));
const moveItems = ids => [
  { label: 'Status', submenu: STATUSES.map(([k, l]) => ({ label: l, run: () => moveStatus(ids, k) })) },
  (() => { const t = targetsNow(); return { label: 'Project', ...(t.length ? {} : { disabled: true }), submenu: t.map(x => ({ label: x.name, disabled: !x.ok, ...(x.ok ? {} : { meta: x.reason }), run: () => moveToProject(ids, x) })) }; })(),
];
function rowMenu(button, pid, id) {
  const hit = taskOf({ pid, id }); if (!hit?.t) return;
  const items = [{ label: 'Details', icon: 'note', run: () => { selectTask(pid, id, { details: 'open' }); } }];
  if (isOpen(pid)) items.push({ label: 'Due date', icon: 'calendar', submenu: dueItems(oneApply(id)) }, { label: 'Priority', submenu: priorityItems(oneApply(id)) }, { label: 'Move to', icon: 'folder', submenu: moveItems([id]) }, '-',
    { label: 'Remove', icon: 'trash', run: () => askRemove([id]) });
  items.push(...(isOpen(pid) ? ['-'] : []), { label: 'Open in project', icon: 'open', run: () => openProject(pid, id) });
  showMenu(button, items, { align: 'end', minWidth: 180 });
}
async function restoreBackup() {
  const { importProjectFlow } = await import('./dashboard.mjs');
  await importProjectFlow(status, () => { theCore().load().catch(() => {}); if (alive()) draw(); });
}
/** The title pick: Projects, then the task sections with their counts. Choosing one draws it. */
function sectionMenu(button) {
  const key = current(), counts = Object.fromEntries(navItems().map(i => [i.id, i.meta]));
  const go = k => () => { select(k); drawPage(); document.getElementById('topbar-title')?.focus(); };
  showMenu(button, [{ label: 'Projects', meta: counts[PROJECTS_LIST] || '', checked: key === PROJECTS_LIST, checkType: 'radio', run: go(PROJECTS_LIST) }, '-',
    ...SMART_LISTS.map(([k, label]) => ({ label, meta: counts[k] || '', checked: key === k, checkType: 'radio', run: go(k) }))], { minWidth: 220 });
}

// ---- the title bar: project-level commands, reachable from every section --------------------------------------------------------------

async function openFolderFlow(rerender) {
  try { await theCore().d.openFolder?.(); } catch (err) { (rerender || status)(String(err?.message || err)); }
}
async function findProjects(rerender) {
  try { const msg = await theCore().d.findProjects?.(); theCore().load().catch(() => {}); if (rerender) rerender(msg); else { draw(); status(msg || ''); } }
  catch (err) { (rerender || status)(String(err?.message || err)); }
}
/** A list-wide toggle of a task section: the list is drawn again in place (a choice of rows is kept) and the toggle's entry in More follows. */
function toggleFilter(patch) {
  filters = { ...filters, ...patch }; expanded.clear(); groupPages.clear(); redraw(null, { whole: true });
  const pressed = (id, on) => document.getElementById(id)?.setAttribute('aria-pressed', String(!!on));
  pressed('hub-by-project', filters.byProject); pressed('hub-show-done', filters.showDone);
  for (const [k] of PERIODS) pressed(`hub-period-${k}`, k === (filters.period || 'all'));
}

let shownKey = '', barRerender = null;
/** The section changed: the page and its title bar are painted again (the title, count and More follow); else the page alone. */
const drawPage = () => { if (barRerender && shownKey !== current()) barRerender(); else draw(); };
/** Pressed in the rail: the portfolio, every time. page() runs before render(), so whichever comes first takes the arrival. */
function arrive() { if (!fresh) return; fresh = false; if (section !== PROJECTS_LIST) select(PROJECTS_LIST); pf.reset(); }

/** The title bar (lib/topbar.mjs): lib/hub-tasks.mjs hubPageSpec, from the section on show. */
export function page(rerender) {
  arrive();
  barRerender = rerender;
  const d = theCore().d, key = shownKey = current(), tasks = key === PROJECTS_LIST ? null : (model = buildModel());
  return hubPageSpec({ key, title: tasks ? tasks.title : 'Projects', count: countOf(key), crossProject: !!tasks?.crossProject, byProject: !!filters.byProject, showDone: !!filters.showDone,
    period: filters.period || 'all', canOpen: !!d.canOpenFolders?.(), desktop: inDesktop() }, {
    pick: a => sectionMenu(a), period: k => toggleFilter({ period: k }),
    'hub-by-project': () => toggleFilter({ byProject: !filters.byProject }), 'hub-show-done': () => toggleFilter({ showDone: !filters.showDone }),
    'hub-add-project': () => d.newProject?.(), 'hub-open-folder': () => openFolderFlow(rerender), 'hub-find-projects': () => findProjects(rerender), 'hub-restore': restoreBackup });
}

const pf = createPortfolio({ core: () => theCore(), host: () => host, ctx: () => hostCtx, today: () => today(), status: text => status(text), select: k => select(k), draw: () => drawPage(), syncCount: () => syncCount(),
  openProject: (id, taskId) => openProject(id, taskId), openAt: (id, view) => openDated(id, view), setDone: (id, done) => setDone(id, done) });

// ---- keyboard -----------------------------------------------------------------------------------------------------------------------------

const typing = t => t?.matches?.('select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=button])') || t?.isContentEditable;
function onKey(e) {
  if (!alive() || e.defaultPrevented) return;
  if (current() === PROJECTS_LIST) { pf.onKey(e); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') {
    if (typing(e.target) && e.target.id === 'hub-new-text') { e.target.value = ''; const r = host.querySelector(`#hub-results [data-hub-row][tabindex="0"]`); r?.focus(); e.preventDefault(); return; }
    if (sel.active) { e.preventDefault(); leave(); return; }
    if (selectedTask && !typing(e.target)) { e.preventDefault(); selectedTask = null; markSelected(); hostCtx?.showDetails?.(); }
    return;
  }
  if (mod && !e.altKey && e.key.toLowerCase() === 'a' && sel.active && !typing(e.target)) { e.preventDefault(); setSel(selectAllIn(sel, orderNow())); return; }
  const row = e.target.closest?.('#hub-results [data-hub-row]');
  if (!row || typing(e.target)) return;
  const pid = row.dataset.hubProject, id = row.dataset.hubRow, rows = rowsNow(), at = rows.indexOf(row);
  const go = i => { e.preventDefault(); const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; focusRow(r); r.scrollIntoView?.({ block: 'nearest' }); };
  if (e.key === 'ArrowDown') return go(at + 1);
  if (e.key === 'ArrowUp') return go(at - 1);
  if (e.key === 'Home') return go(0);
  if (e.key === 'End') return go(rows.length - 1);
  if (e.key === 'PageDown') return go(at + 10);
  if (e.key === 'PageUp') return go(at - 10);
  if (row.dataset.hubView) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!sel.active) openDated(pid, row.dataset.hubView); } return; }
  if (mod && (e.key === 'Backspace' || e.key === 'Delete')) {
    e.preventDefault();
    const ids = sel.active ? chosen() : isOpen(pid) ? [id] : [];
    if (ids.length) askRemove(ids); else status('Open the project to change it');
    return;
  }
  if (e.key === ' ' && !e.target.matches('input[type=checkbox]')) {
    e.preventDefault();
    if (sel.active) { if (isOpen(pid)) setSel(toggleId(sel, id)); }
    else if (isOpen(pid)) { const t = taskOf({ pid, id })?.t; if (t) setDone(id, !t.done); }
    else status('Open the project to change it');
    return;
  }
  if (e.key === 'Enter' && !e.target.matches('[data-more]')) { e.preventDefault(); if (sel.active) { if (isOpen(pid)) setSel(toggleId(sel, id)); } else selectTask(pid, id, { details: 'open' }); }
}

// ---- choosing ------------------------------------------------------------------------------------------------------------------------------

const setSel = next => { sel = next; syncBars(); };
function leave() {
  sel = leaveSelect();
  redraw(() => { const b = host?.querySelector('#hub-select'); if (b) focusControl(b); }); syncBars();
}
function enterSelecting(id) {
  note = null; sel = enterSelect(sel, id);
  const region = host?.querySelector('#hub-region'); if (region) regionShow(region, 1);
  redraw(() => (host?.querySelector('#hub-results input[data-hub-select]') || host?.querySelector('#hub-cancel'))?.focus());
}
/** One click on a row while selecting: the box or the row toggles it, Shift-click takes the range from the last one chosen. */
function pickRow(e, row) {
  const pid = row.dataset.hubProject, id = row.dataset.hubRow;
  if (!isOpen(pid)) return false;
  if (e.target.matches('label')) return true;
  if (!e.target.closest('.ui-row-check')) e.preventDefault();
  setSel(e.shiftKey ? rangeTo(sel, orderNow(), id) : toggleId(sel, id));
  return true;
}

// ---- wiring ----------------------------------------------------------------------------------------------------------------------------------

function wire() {
  if (!host) return;
  if (current() === PROJECTS_LIST) { pf.wire(); return; }
  const q = host.querySelector('#hub-q');
  if (q) q.oninput = () => { filters = { ...filters, text: q.value }; expanded.clear(); groupPages.clear(); drawResults(); };
  const fresh = host.querySelector('#hub-new');
  if (fresh) fresh.onclick = () => host.querySelector('#hub-new-text')?.focus();
  const add = host.querySelector('#hub-add');
  if (add) add.onsubmit = e => { e.preventDefault(); const f = add.querySelector('#hub-new-text'); const text = f.value; f.value = ''; addTask(text); };
  const picker = host.querySelector('#hub-new-project');
  if (picker) picker.onclick = e => {
    const c = theCore(), tl = targetsNow(), items = (model?.projects || []).map(p => { const t = p.current ? { ok: true } : tl.find(x => x.id === p.id) || { ok: false, reason: 'Unavailable' }; return { label: p.name, checked: p.id === (addProjectId || model.projects.find(x => x.current)?.id), checkType: 'radio', disabled: !t.ok, ...(t.ok ? {} : { meta: t.reason }),
      run: () => { addProjectId = p.id; const v = picker.querySelector('.ui-picker-value'); if (v) v.textContent = p.name; picker.setAttribute('aria-label', `Project: ${p.name}`); } }; });
    menuFor(picker, e, '#hub-add', items, 200);
  };
  const pickBtn = host.querySelector('#hub-select'); if (pickBtn) pickBtn.onclick = () => enterSelecting();
  const cancel = host.querySelector('#hub-cancel'); if (cancel) cancel.onclick = leave;
  const move = host.querySelector('#hub-move'); if (move) move.onclick = e => menuFor(move, e, '#hub-sel', moveItems(chosen()), 180);
  const due = host.querySelector('#hub-due'); if (due) due.onclick = e => menuFor(due, e, '#hub-sel', dueItems(patchChosen), 180);
  const priority = host.querySelector('#hub-priority'); if (priority) priority.onclick = e => menuFor(priority, e, '#hub-sel', priorityItems(patchChosen), 180);
  const remove = host.querySelector('#hub-remove'); if (remove) remove.onclick = () => { const ids = chosen(); if (ids.length) askRemove(ids); };
  wireResults();
  applyRoving();
}
function wireResults() {
  const results = host?.querySelector('#hub-results'); if (!results) return;
  results.onclick = e => {
    const row = e.target.closest('[data-hub-row]');
    const act = e.target.closest('#hub-note-act'); if (act) { if (note?.move) undoMove(); else if (note?.record) undoRemove(); else if (note?.add) undoAdd(); return; }
    const step = e.target.closest('[data-hub-pages] [data-page]'); if (step && !step.disabled) { groupPages.set(step.closest('[data-hub-pages]').dataset.hubPages, Number(step.dataset.page)); redraw(); return; }
    const all = e.target.closest('[data-hub-all]'); if (all) { expanded.add(all.dataset.hubAll); redraw(() => results.querySelector(`[data-hub-group="${CSS.escape(all.dataset.hubAll)}"] [data-open]`)?.focus({ preventScroll: true })); return; }
    const clear = e.target.closest('#hub-clear'); if (clear) { filters = { ...filters, text: '' }; redraw(() => host.querySelector('#hub-q')?.focus(), { whole: true }); return; }
    const perm = e.target.closest('[data-hub-open-project]'); if (perm) { openProject(perm.dataset.hubOpenProject); return; }
    if (!row) return;
    const pid = row.dataset.hubProject, id = row.dataset.hubRow;
    if (e.target.closest('[data-more]')) { rowMenu(e.target.closest('[data-more]'), pid, id); return; }
    if (row.dataset.hubView) { if (!sel.active) openDated(pid, row.dataset.hubView); return; }
    if (sel.active) { if (pickRow(e, row)) return; }
    if (e.target.closest('.ui-row-check')) return;                                // the done control writes through its change event
    if (!sel.active && (e.metaKey || e.ctrlKey) && isOpen(pid)) { e.preventDefault(); enterSelecting(id); return; }
    selectTask(pid, id, { details: 'show' });
  };
  results.ondblclick = e => { const row = e.target.closest('[data-hub-row]'); if (row && !row.dataset.hubView && !sel.active && !e.target.closest('.ui-row-check, [data-more]')) selectTask(row.dataset.hubProject, row.dataset.hubRow, { details: 'open' }); };
  results.onchange = e => {
    const box = e.target.closest('input[data-done]'); if (box && !box.disabled) { setDone(box.dataset.done, box.checked); return; }
  };
  results.onmousedown = e => { if (e.shiftKey && sel.active && e.target.closest('.ui-row')) e.preventDefault(); };
  results.onfocusin = e => { const row = e.target.closest?.('[data-hub-row]'); if (row) { focusKey = keyOf(row.dataset.hubProject, row.dataset.hubRow); applyRoving(); } };
}

// ---- the page ------------------------------------------------------------------------------------------------------------------------------

/** Draws the page into `el`. A test hands it its own `deps` (and `timeoutMs`); the app uses the real ones and one core for the life of the window. */
export function render(el, ctx, opts = {}) {
  if (opts.deps) core = makeCore(opts.deps, opts.timeoutMs);
  const c = theCore();
  arrive();
  unlisten?.(); host = el; hostCtx = ctx;
  if (keysOn !== el) { keysOn?.removeEventListener('keydown', onKey); el.addEventListener('keydown', onKey); keysOn = el; }
  ctx?.onKey?.(e => { if (e.key === 'Escape' && sel.active && alive() && !e.defaultPrevented) { e.preventDefault(); leave(); } });
  if (!el.querySelector(':scope > [data-hub]')) { sel = leaveSelect(); note = null; }          // arriving on the page again: nothing is carried over
  if (selectedTask && !taskOf(selectedTask)?.t) selectedTask = null;
  if (!inDesktop() && el.dataset.hubDrop !== '1') { el.dataset.hubDrop = '1'; import('../lib/drop-import.mjs').then(m => m.dropImport(el, status, () => { theCore().load().catch(() => {}); if (alive()) draw(); }, () => alive())); }
  draw();
  unlisten = c.onChange(() => { if (!alive()) return; if (current() === PROJECTS_LIST) pf.drawBody(); else drawResults(); });
  c.load({ gap: opts.deps ? 0 : 500 }).catch(err => { if (alive()) status(String(err?.message || err)); });
  let last = Date.now();
  live = () => {
    if (!alive()) { live = null; return; }
    if (sel.active || moving || Date.now() - last < 2000) return;              // not while choosing or sending, and not twice in a breath
    last = Date.now(); c.load({ only: e => e.id !== c.d.openId() }).catch(() => {});
  };
}
if (typeof window !== 'undefined') window.addEventListener('focus', () => live?.());

// ---- the inspector ----------------------------------------------------------------------------------------------------------------------------

const optionsOf = (pairs, value) => pairs.map(([k, l]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(l)}</option>`).join('');
const longDay = iso => (iso ? day(String(iso).slice(0, 10)) : '');

/** The selected task as the inspector's Details: title, notes, due, priority, project, status, when it was added and completed. Another project's task is read-only. */
export function inspect(ctx) {
  if (current() === PROJECTS_LIST) return pf.inspect(ctx);
  const hit = taskOf(selectedTask);
  if (!hit?.t) return [];
  const { r, t } = hit, c = theCore(), writable = !!r.current, dis = writable ? '' : ' disabled';
  const where = c.entries().map(e => [e.id, c.view().get(e.id)?.name || projectName(e)]);
  const html = `<div class="tk-insp" data-insp-task="${esc(t.id)}">
    <textarea class="tk-insp-title" rows="2" aria-label="Title" data-f="text"${dis}>${esc(t.text)}</textarea>
    <textarea class="tk-insp-notes" aria-label="Notes" placeholder="Notes" data-f="notes"${dis}>${esc(t.notes)}</textarea>
    <dl class="props">
      <dt>Due</dt><dd>${writable ? dateField('tk-insp-due', t.due, 'Due', 'No date') : esc(t.due ? longDay(t.due) : 'No date')}</dd>
      <dt>Priority</dt><dd><select aria-label="Priority" data-f="priority"${dis}>${optionsOf(PRIORITIES, t.priority)}</select></dd>
      <dt>Project</dt><dd><select aria-label="Project" data-f="project" title="${writable ? 'Choosing another project moves the task there' : ''}"${dis}>${optionsOf(where, r.id)}</select></dd>
      <dt>Status</dt><dd><select aria-label="Status" data-f="status"${dis}>${optionsOf(STATUSES, t.status)}</select></dd>
      ${t.at ? `<dt>Created</dt><dd>${esc(longDay(t.at))}</dd>` : ''}${t.doneAt ? `<dt>Completed</dt><dd>${esc(longDay(t.doneAt))}</dd>` : ''}
    </dl>
    ${inspectorActions({ id: 'tk-insp-acts', label: 'Task actions', start: [{ id: 'tk-insp-remove', label: 'Remove', role: 'destructive', disabled: !writable }],
      actions: [{ id: 'tk-insp-open', label: 'Open in project', icon: 'open', role: 'primary' }] })}
  </div>`;
  return [{ title: 'Task', html, wire: el => wireInspector(el, ctx, r.id, t.id) }];
}
function wireInspector(el, ctx, pid, id) {
  const root = el.querySelector('.tk-insp'); if (!root) return;
  const open = root.querySelector('#tk-insp-open'); if (open) open.onclick = () => openProject(pid, id);
  if (!isOpen(pid)) return;
  const title = root.querySelector('[data-f=text]'), notes = root.querySelector('[data-f=notes]');
  autoGrow(title, { max: 200 });
  title.onchange = () => { const v = title.value.trim(); if (v) { change(s => patchTask(s.todos, id, { text: v })); repaint(); } else title.value = taskOf({ pid, id })?.t?.text || ''; };
  title.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
  notes.onchange = () => { change(s => patchTask(s.todos, id, { notes: notes.value })); redraw(); };
  wireDateField(root, 'tk-insp-due', 'Due');
  root.querySelector('#tk-insp-due')?.addEventListener('change', e => { change(s => patchTask(s.todos, id, { due: e.target.value })); repaint(); });
  root.querySelector('[data-f=priority]').onchange = e => { change(s => patchTask(s.todos, id, { priority: e.target.value })); repaint(); };
  root.querySelector('[data-f=status]').onchange = e => { change(s => patchTask(s.todos, id, { status: e.target.value })); repaint(() => ctx?.showDetails?.()); };
  const proj = root.querySelector('[data-f=project]');
  proj.onchange = async () => {
    const target = targetsNow().find(t => t.id === proj.value), back = () => { proj.value = pid; };
    if (!target) { back(); return; }
    if (!target.ok) { status(`${target.name} cannot take a task now${target.reason ? `: ${target.reason}` : ''}`); back(); return; }
    if (!await moveToProject([id], target)) back();
  };
  const remove = root.querySelector('#tk-insp-remove'); if (remove) remove.onclick = () => askRemove([id]);
}
