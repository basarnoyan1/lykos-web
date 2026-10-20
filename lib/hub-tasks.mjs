// The all-projects task hub (plan §2 "Workspace", amendment "Tasks hub"; design: scratchpad plans/tasks-hub.md).
//
// What it does: lists the tasks of every project on this machine as one set of lists (All work, Today, Upcoming, Overdue,
// Logbook, one per project, and a portfolio of the projects themselves), grouped by when they are due, so the researcher
// sees all the work without opening each project. It reads every project and writes none through its project file.
// The one project that is open is read from memory (so unsaved edits show) and is the only one whose tasks can be changed
// here. A task is never written into a project this window does not own; it goes as a file into that project's own inbox
// (lib/task-handoff.mjs) and the target takes it in itself when it is next open.
//
// Reading a project that is not open takes two calls on its folder, `stat` and `read`, both on `.lykos/project.json`
// and nothing else. The text goes through JSON.parse and assertProject (store.mjs: a foreign or newer file is refused
// with its own message) and only its `todos` are kept, through normaliseTasks. normalizeProject is deliberately not
// called: it migrates, and a migration is a write in waiting.
//
// Pure: no DOM, no store state. Everything that is not data arrives as `deps`, so the tests read synthetic projects
// through a folder of their own and the page reads real ones through the same seam.
import { assertProject } from '../store.mjs';
import { normaliseTasks, tasksSignature, restoreRemoved, sortTasks, whenGroups, dueBucket, dueText } from './tasks.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiRegion, uiStatusLine, CH_STEPS } from './ui-actions.mjs';
import { selectedLine } from './task-select.mjs';
import { esc, emptyState } from './html.mjs';
import { summarizeProject, dashboardRows } from './project-summary.mjs';
import { icon } from './icons.mjs';
import { num, ago, day } from './dates.mjs';
import { openIdeas } from './ideas.mjs';

/** The project file inside a project folder (the same constant as projects.mjs FILE; a test pins it). */
export const PROJECT_FILE = '.lykos/project.json';
export const READ_TIMEOUT_MS = 4000;
export const READ_LANES = 2;
export const GROUP_ROWS = 12;              // rows a group draws before "Show all" (a list of more than fifteen children is a long list the quality scan counts)

export const REASONS = Object.freeze({
  missing: 'Project file not found',
  damaged: 'Project file is damaged',
  foreign: 'Not a Lykos project file',
  newer: 'Saved by a newer version of Lykos',
  permission: 'Open it once to read it',
  desktop: 'Open it in the desktop app to read it',
  timeout: 'Took too long to read',
  failed: 'Could not be read',
});

export class HubReadError extends Error {
  constructor(code, detail = '') {
    super(code === 'failed' && detail ? `${REASONS.failed}: ${detail}` : REASONS[code] || REASONS.failed);
    this.name = 'HubReadError'; this.code = code in REASONS ? code : 'failed';
  }
}

const decode = bytes => new TextDecoder().decode(bytes);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The name a project is listed under: the registry's name, or the folder's. */
export const projectName = entry => entry?.name || (entry?.kind === 'local' ? 'Untitled review' : String(entry?.path || '').replace(/\/+$/, '').split('/').pop() || 'Project');

/** The tasks of a parsed project file, or a HubReadError that says why it is not one. */
export function tasksOfProject(raw) {
  try { assertProject(raw); }
  catch (err) { throw new HubReadError(/newer version/.test(String(err?.message)) ? 'newer' : 'foreign'); }
  return normaliseTasks(raw.todos);
}

/** What a project has dated besides its tasks: ethics deadlines, the registry results date and milestones, as `[{ date, text, kind, view }]` (`kind` is 'ethics', 'registration' or 'milestone'). Read only, and only from what is already read. */
export function datesOfProject(raw, today = localDay()) {
  try { return summarizeProject(raw, { today, within: 400, limit: 80 }).due.filter(d => d.kind !== 'task').map(d => ({ date: d.date, text: d.text, kind: d.kind, view: d.view })); }
  catch { return []; }
}

/** Ids of the listed projects in the order the page shows them: the open project, then the list's own order. */
export function orderEntries(list, openId) {
  const seen = new Set(), out = [];
  const add = e => { if (e && e.id && !seen.has(e.id)) { seen.add(e.id); out.push(e); } };
  add((list || []).find(e => e.id === openId));
  for (const e of list || []) add(e);
  return out;
}

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new HubReadError('timeout')), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

/**
 * A reader over `deps`:
 *   openId()                    the id of the project that is open, or null
 *   openTasks(), openName()     the open project's tasks and name, from memory (openDates(): its dated items, optional)
 *   readApp(id), readLocal()    a project kept in the app's storage, as stored; null when there is none
 *   folderFor(entry)            a folder with `stat(rel)` and `read(rel)` for a project kept in a folder; null when it cannot be reached
 *                               here (a browser handle whose permission lapsed, a path outside the desktop app)
 *   summarize(raw)              the project's summary (default: summarizeProject; the app hands lib/dashboard.mjs fullSummary, with its stages)
 *   keepSummary(id, summary)    keeps a summary made from a fresh read (optional: the app keeps it for this machine, lib/dashboard.mjs)
 *   openSummary()               the open project's summary, from memory (optional)
 * `result(entry)` never rejects: it answers `{ id, name, kind, current, tasks, dates, summary }` or the same with `error: { code, message }`.
 * A second read of an unchanged folder project (same modified time and size) costs one stat, and its summary is not made again.
 */
export function createHubReader(deps, { timeoutMs = READ_TIMEOUT_MS } = {}) {
  const cache = new Map();
  const summarize = deps.summarize || (raw => summarizeProject(raw));
  const summaryOf = (id, raw) => {
    let sum = null;
    try { sum = summarize(raw) || null; } catch { sum = null; }
    if (sum) try { deps.keepSummary?.(id, sum); } catch { /* keeping it is a convenience */ }
    return sum;
  };
  async function fromFolder(entry) {
    const folder = await deps.folderFor(entry);
    if (!folder) throw new HubReadError(entry.kind === 'handle' ? 'permission' : 'desktop');
    let st;
    try { st = await folder.stat(PROJECT_FILE); }
    catch (err) { throw new HubReadError(/outside a chosen folder/.test(String(err?.message)) ? 'missing' : 'failed', String(err?.message || err).slice(0, 80)); }
    if (!st.exists) throw new HubReadError('missing');
    if (st.dir) throw new HubReadError('damaged');
    const hit = cache.get(entry.id);
    if (hit && hit.mtime === st.mtime && hit.size === st.size) return hit.read;
    let raw;
    const bytes = await folder.read(PROJECT_FILE);
    try { raw = JSON.parse(decode(bytes)); } catch { throw new HubReadError('damaged'); }
    const read = { tasks: tasksOfProject(raw), dates: datesOfProject(raw), summary: summaryOf(entry.id, raw) };
    cache.set(entry.id, { mtime: st.mtime, size: st.size, read });
    return read;
  }
  const readOf = (id, raw) => { const tasks = tasksOfProject(raw); return { tasks, dates: datesOfProject(raw), summary: summaryOf(id, raw) }; };
  async function tasksFor(entry) {
    if (entry.id === deps.openId()) return { tasks: deps.openTasks(), dates: deps.openDates?.() || [], summary: deps.openSummary?.() || null };
    if (entry.kind === 'app') { const raw = await deps.readApp(entry.id); if (!raw) throw new HubReadError('missing'); return readOf(entry.id, raw); }
    if (entry.kind === 'local') { const raw = await deps.readLocal(); return raw ? readOf(entry.id, raw) : { tasks: [], dates: [], summary: null }; }
    if (entry.kind === 'path' || entry.kind === 'handle') return fromFolder(entry);
    throw new HubReadError('missing');
  }
  const base = entry => ({ id: entry.id, kind: entry.kind, current: entry.id === deps.openId(), name: entry.id === deps.openId() && deps.openName?.() || projectName(entry) });
  return {
    cacheSize: () => cache.size,
    forget: id => cache.delete(id),
    async result(entry) {
      try { return { ...base(entry), ...await withTimeout(Promise.resolve().then(() => tasksFor(entry)), timeoutMs) }; }
      catch (err) {
        const e = err instanceof HubReadError ? err : new HubReadError('failed', String(err?.message || err).slice(0, 80));
        return { ...base(entry), error: { code: e.code, message: e.message } };
      }
    },
  };
}

/** Reads `entries` `lanes` at a time and hands each result to `onResult` as it arrives; stops starting reads once `cancelled()`. */
export async function loadHub(entries, reader, { lanes = READ_LANES, onResult = () => {}, cancelled = () => false } = {}) {
  let next = 0;
  const lane = async () => {
    while (next < entries.length && !cancelled()) {
      const r = await reader.result(entries[next++]);
      if (!cancelled()) onResult(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, entries.length) }, lane));
}

// ---- what the page shows: lists, counts, the portfolio -----------------------------------------------------------------------

/** The lists the navigation offers before the projects, in order: key, title, icon. */
export const SMART_LISTS = Object.freeze([['all', 'All work', 'list'], ['today', 'Today', 'calendar'], ['upcoming', 'Upcoming', 'clock'], ['overdue', 'Overdue', 'warn'], ['logbook', 'Logbook', 'check']]);
export const PROJECTS_LIST = 'projects';
export const projectKey = id => `p:${id}`;
export const projectOfKey = key => (String(key).startsWith('p:') ? String(key).slice(2) : '');
export const defaultFilters = () => ({ text: '', showDone: false, byProject: false, period: 'all' });
/** The periods the Upcoming list can be limited to: key, label, days (Infinity: every date). */
export const PERIODS = Object.freeze([['30', '30 days', 30], ['90', '90 days', 90], ['all', 'All', Infinity]]);
export const DATED_KINDS = Object.freeze({ ethics: 'Ethics', registration: 'Registration', milestone: 'Milestone' });
const DATED_LISTS = ['today', 'upcoming', 'overdue'];
const plusDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
export const isFiltered = f => !!String(f?.text || '').trim();

const dayNow = () => localDay();
/** The tasks of every project that has been read and could be, each with where it lives: `{ task, pid, pname, current, writable }`. */
function poolOf(entries, results) {
  const out = [], errors = []; let pending = 0;
  for (const e of entries) {
    const r = results.get(e.id);
    if (!r) { pending++; continue; }
    if (r.error) { errors.push({ id: e.id, name: r.name, error: r.error }); continue; }
    for (const task of r.tasks) out.push({ task, pid: e.id, pname: r.name, current: !!r.current, writable: !!r.current });
  }
  return { out, errors, pending };
}

/**
 * The counts the navigation shows, from what has been read: `{ items, pending }`. An item is what the shell's list pane draws:
 * `{ id, title, icon, meta, kind: 'nav', markTone? }`; a count of 0 is blank, an unreadable project says "—", and a project with an
 * overdue task is marked ('late') so its count is set heavier. The Logbook has no count (a count of what is done is not work to do).
 */
export function navModel(entries, results, today = dayNow()) {
  const { out, errors, pending } = poolOf(entries, results);
  const open = out.filter(r => !r.task.done), bucket = r => dueBucket(r.task, today);
  const n = x => (x ? String(x) : '');
  const dated = datedPool(entries, results);
  const count = { all: open.length, today: [...open, ...dated].filter(r => ['today', 'overdue'].includes(bucket(r))).length, upcoming: [...open, ...dated].filter(r => ['week', 'later'].includes(bucket(r))).length, overdue: [...open, ...dated].filter(r => bucket(r) === 'overdue').length };
  const items = SMART_LISTS.map(([id, title, icon]) => ({ id, title, icon, kind: 'nav', meta: id === 'logbook' ? '' : n(count[id]), sub: '' }));
  items.push({ id: PROJECTS_LIST, title: 'Projects', icon: 'projects', kind: 'nav', meta: n(entries.length), sub: '' });
  for (const e of entries) {
    const r = results.get(e.id), bad = errors.some(x => x.id === e.id);
    const mine = open.filter(x => x.pid === e.id);
    items.push({ id: projectKey(e.id), title: r?.name || projectName(e), icon: 'dot', kind: 'nav', meta: bad ? '—' : r ? n(mine.length) : '', sub: '',
      ...(mine.some(x => bucket(x) === 'overdue') ? { markTone: 'late' } : {}) });
  }
  return { items, pending };
}

/**
 * The dated items besides tasks (ethics deadlines, the registry results date, milestones) of every project read, as rows in the shape of
 * a task's: `{ task, pid, pname, current: false, writable: false, dated: true }`. They are read only and appear on Today, Upcoming and
 * Overdue; opening one goes to the page that holds it.
 */
function datedPool(entries, results) {
  const out = [];
  for (const e of entries) {
    const r = results.get(e.id); if (!r || r.error) continue;
    for (const d of r.dates || []) out.push({ pid: e.id, pname: r.name, current: !!r.current, writable: false, dated: true,
      task: { id: `date:${d.kind}:${d.date}:${String(d.text).slice(0, 40)}`, text: d.text, due: d.date, kind: d.kind, view: d.view, done: false, status: 'todo', priority: 'none', notes: '', parentId: '', blockedBy: [] } });
  }
  return out;
}
const inPeriod = (due, today, period) => { const days = PERIODS.find(([k]) => k === period)?.[2] ?? Infinity; return days === Infinity || (due && due <= plusDays(today, days)); };

const TITLES = Object.fromEntries(SMART_LISTS.map(([k, t]) => [k, t]));
const sameText = (r, q) => !q || r.task.text.toLowerCase().includes(q) || r.task.notes.toLowerCase().includes(q) || r.pname.toLowerCase().includes(q);
const gid = id => `hub-g-${String(id).replace(/[^a-zA-Z0-9-]/g, '-')}`;

/**
 * One list page: `{ key, title, crossProject, tasks, groups: [{ id, label, rows }], shown, pending, errors, empty }`. A row is
 * `{ task, pid, pname, current, writable, waiting? }`. `opts` is `{ list, text, showDone, byProject, period, pending }` (`period` limits Upcoming to '30' or '90' days; '' or 'all' shows every date); `pending` is a
 * pendingAdds() whose rows (tasks sent to a project that has not taken them in yet) draw in their project's group.
 * With one project listed there is no project column and no project group, whatever the list. `empty` names the empty state to draw,
 * or '' (while projects are still being read nothing is empty yet).
 */
export function listModel(entries, results, opts = {}, today = dayNow()) {
  const key = opts.list || 'all', q = String(opts.text || '').trim().toLowerCase(), pid = projectOfKey(key);
  const { out, errors, pending } = poolOf(entries, results);
  let pool = out;
  if (pid) pool = pool.filter(r => r.pid === pid);
  const waiting = [];
  if (opts.pending && (key === 'all' || pid)) {
    for (const e of entries) {
      if (pid && e.id !== pid) continue;
      const r = results.get(e.id); if (!r || r.error) continue;
      for (const task of opts.pending.rowsFor(e.id)) waiting.push({ task, pid: e.id, pname: r.name, current: false, writable: false, waiting: true });
    }
  }
  const showDone = key === 'logbook' || !!opts.showDone;
  const bucket = r => dueBucket(r.task, today);
  const keep = r => {
    if (key === 'logbook') return r.task.done;
    if (r.task.done) return showDone;
    if (key === 'today') return ['today', 'overdue'].includes(bucket(r));
    if (key === 'upcoming') return ['week', 'later'].includes(bucket(r));
    if (key === 'overdue') return bucket(r) === 'overdue';
    return true;
  };
  const dated = !pid && DATED_LISTS.includes(key) ? datedPool(entries, results) : [];
  const rows = [...pool, ...waiting, ...dated].filter(r => keep(r) && sameText(r, q) && (key !== 'upcoming' || inPeriod(r.task.due, today, opts.period)));
  const crossProject = !pid && entries.length > 1;
  const link = new Map(rows.map((r, i) => [`${r.pid}\u0000${r.task.id}`, r]));
  const tagged = rows.map(r => ({ ...r.task, __k: `${r.pid}\u0000${r.task.id}` }));
  const rowOf = t => link.get(t.__k);
  let groups;
  if (key === 'logbook') {
    const sorted = [...tagged].sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')) || a.text.localeCompare(b.text));
    groups = sorted.length ? [{ id: 'logbook', label: 'Completed', rows: sorted.map(rowOf) }] : [];
  } else if (opts.byProject && crossProject) {
    groups = entries.map(e => ({ e, rows: rows.filter(r => r.pid === e.id) })).filter(g => g.rows.length).map(g => {
      const ts = sortTasks(g.rows.map(r => ({ ...r.task, __k: `${r.pid}\u0000${r.task.id}` })), g.rows.map(r => r.task));
      return { id: `proj-${g.e.id}`, label: results.get(g.e.id)?.name || projectName(g.e), rows: ts.map(rowOf) };
    });
  } else {
    groups = whenGroups(tagged, today).map(g => ({ id: g.id, label: g.label, rows: g.tasks.map(rowOf) }));
  }
  const title = pid ? (results.get(pid)?.name || projectName(entries.find(e => e.id === pid))) : TITLES[key] || 'Tasks';
  const shown = groups.reduce((a, g) => a + g.rows.length, 0);
  const pidErrors = pid ? errors.filter(e => e.id === pid) : errors;
  let empty = '';
  if (!entries.length) empty = 'projects';
  else if (!shown && !pending && (!pid || !pidErrors.length)) empty = q ? 'search' : key === 'all' || pid ? 'open' : key;
  const projects = entries.filter(e => results.get(e.id) && !results.get(e.id).error).map(e => ({ id: e.id, name: results.get(e.id).name, current: !!results.get(e.id).current }));
  return { key, title, crossProject, tasks: rows, groups, shown, pending, errors: pidErrors, empty, projects };
}

/** Ids of the tasks that can be chosen: the open project's, as the list shows them, in reading order (every one, not only the rows drawn). */
export function selectableIds(model) {
  const ids = [];
  for (const g of model?.groups || []) for (const r of g.rows) if (r.writable && !ids.includes(r.task.id)) ids.push(r.task.id);
  return ids;
}

/** The count in the title: "16 open", "6 done" in the Logbook, "Reading 2 projects" until every project answered. */
export function titleCount(model) {
  if (model.pending) return `Reading ${plural(model.pending, 'project')}`;
  return model.key === 'logbook' ? `${model.shown} done` : `${model.shown} open`;
}

/** One line a person reads: "today", "yesterday", "3 days ago", else the day. */
export function openedText(ms, now = Date.now()) {
  if (!ms) return '';
  const days = Math.floor((startOfDay(now) - startOfDay(ms)) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return day(ms, now);
}
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---- the portfolio: every project at a glance (plans PORTFOLIO.md) ----------------------------------------------------------------

/** Where a project is in its life, in the order the portfolio groups them: key, heading. */
export const PHASES = Object.freeze([['active', 'Active'], ['submitted', 'Submitted'], ['published', 'Published'], ['paused', 'Paused'], ['archived', 'Archived']]);
/** What the Show picker offers: Current (everything but Archived), each phase, All. */
export const SHOW = Object.freeze([['current', 'Current'], ...PHASES, ['all', 'All']]);
const SENT_STATUS = new Set(['submitted', 'with-editor', 'under-review', 'revise', 'revised']), DONE_STATUS = new Set(['accepted', 'published']);
/** The phase of a listed project: archived and paused are the person's choice on the list; submitted and published come from the submission. "Planned", "Rejected" and "Withdrawn" are active work between journals. */
export function phaseOf(entry, summary) {
  if (entry?.status === 'archived') return 'archived';
  const st = summary?.submission?.status;
  if (DONE_STATUS.has(st)) return 'published';
  if (SENT_STATUS.has(st)) return 'submitted';
  if (entry?.status === 'paused') return 'paused';
  return 'active';
}
/** Whether a phase is shown under a Show choice. */
export const shows = (phase, show = 'current') => (show === 'all' ? true : !show || show === 'current' ? phase !== 'archived' : phase === show);

/** The current stage as one line: "Screening 41 of 120", "Manuscript 1,840 words", "Protocol"; '' with no stages (a summary kept before they were). */
export function stageText(summary) {
  const st = summary?.stages?.find?.(x => x.key === summary.current);
  if (!st) return '';
  const count = st.of != null && st.n != null ? `${num(st.n)} of ${num(st.of)}` : st.n != null ? `${num(st.n)}${st.unit ? ` ${st.unit}` : ''}` : '';
  return count ? `${st.name} ${count}` : st.name;
}
const daysFrom = (a, b) => (a && b ? Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5) : null);
/** Where the paper is with its journal, for the detail line: "Submitted to Neuro-Oncology, 42 d", "Planned: World Neurosurgery", "Published in X"; '' when never submitted. */
export function submissionText(sub, today = dayNow()) {
  if (!sub?.status) return '';
  const j = sub.journal || 'a journal', d = daysFrom(sub.since, today), wait = d != null && d >= 0 ? `, ${d} d` : '';
  switch (sub.status) {
    case 'planned': return `Planned: ${j}`;
    case 'submitted': case 'with-editor': case 'under-review': return `Submitted to ${j}${wait}`;
    case 'revise': return sub.due ? `Revision for ${j} due ${dueText(sub.due, today)}` : `Revision requested by ${j}`;
    case 'revised': return `Revision sent to ${j}${wait}`;
    case 'accepted': return `Accepted by ${j}`;
    case 'published': return `Published in ${j}`;
    case 'rejected': return `Rejected by ${j}`;
    case 'rejected-desk': return `Rejected without review by ${j}`;
    case 'withdrawn': return `Withdrawn from ${j}`;
    default: return '';
  }
}

/**
 * The projects as a portfolio: `{ id, name, current, kind, type, openedAt, pinned, status, phase, open, overdue, nextDue, next, stage,
 * submission, summary, stale, at, pending, error }`, pinned first and otherwise in the order of `entries` (the app's own most-recent-first
 * order). It paints from what is at hand and never reads: `results` (what the hub reader has read) and `cached(id)`, the summary this
 * machine kept (`{ at, summary }` or null). A project read now counts from its tasks; one not read yet (or not reachable) from its kept
 * summary, `stale` with the time it was kept; one with neither is `pending` with nothing to say yet. `next` is the soonest dated item,
 * overdue included: `{ date, overdue }` or null; `nextDue` the soonest that is not past (a task's).
 */
export function portfolioModel(entries, results, today = dayNow(), { cached = () => null } = {}) {
  const rows = entries.map(e => {
    const r = results.get(e.id), fresh = r && !r.error ? r.summary || null : null;
    const kept = fresh ? null : cached(e.id);
    const summary = fresh || kept?.summary || null;
    const base = { id: e.id, name: r?.name || projectName(e), current: !!(r?.current ?? e.current), kind: e.kind, type: e.type || summary?.type || '', openedAt: e.openedAt || 0,
      pinned: !!e.pinned, status: e.status || 'active', phase: phaseOf(e, summary), summary, stale: !fresh && !!kept, at: kept?.at || 0,
      stage: stageText(summary) || null, submission: summary?.submission || null, open: 0, overdue: 0, nextDue: null, next: null, pending: !r, error: r?.error || null };
    if (r && !r.error) {
      const open = r.tasks.filter(t => !t.done), dues = open.filter(t => t.due && t.due >= today).map(t => t.due).sort();
      const dated = [...open.filter(t => t.due).map(t => t.due), ...(r.dates || []).map(d => d.date)].filter(Boolean).sort();
      return { ...base, open: open.length, overdue: open.filter(t => dueBucket(t, today) === 'overdue').length, nextDue: dues[0] || null, next: dated[0] ? { date: dated[0], overdue: dated[0] < today } : null };
    }
    if (summary) {
      const late = (summary.due || []).filter(d => d.kind === 'task' && d.date < today).length, first = (summary.due || [])[0];
      return { ...base, open: summary.openTasks || 0, overdue: late, nextDue: (summary.due || []).find(d => d.kind === 'task' && d.date >= today)?.date || null, next: first ? { date: first.date, overdue: first.date < today } : null };
    }
    return base;
  });
  return rows.map((p, i) => [p, i]).sort((a, b) => (b[0].pinned - a[0].pinned) || a[1] - b[1]).map(([p]) => p);
}

export const BLOCK_ROWS = 5;            // rows a block (Needs attention, Upcoming) draws before "Show all"
/**
 * What needs a person across the projects shown, per project in their order: its overdue tasks as one row ("2 tasks overdue"), each
 * overdue task that is a submission's chase or revision (a real task, lib/submissions.mjs syncTasks) as a row of its own, then the
 * project's blockers (summary.attention). A chase or revision task is counted once: it is not among "n tasks overdue", and a blocker of
 * the submission page is left out when its task already says it. Rows: `{ projectId, project, text, date, view, overdue }`; the view
 * '@overdue' is the project's own task list.
 */
export function attentionRows(rows, results, today = dayNow()) {
  const out = [];
  for (const p of rows) {
    if (p.error && !p.summary) continue;
    const r = results.get(p.id), base = { projectId: p.id, project: p.name, kind: '' };
    let subTasks = 0;
    if (r && !r.error) {
      const late = r.tasks.filter(t => !t.done && dueBucket(t, today) === 'overdue');
      const own = late.filter(t => t.link?.view !== 'submissions'), sub = late.filter(t => t.link?.view === 'submissions');
      if (own.length) out.push({ ...base, text: `${plural(own.length, 'task')} overdue`, date: own.map(t => t.due).sort()[0], view: '@overdue', overdue: true });
      for (const t of sub) out.push({ ...base, text: t.text, date: t.due, view: 'submissions', overdue: true });
      subTasks = sub.length;
    } else if (p.summary) {
      const late = (p.summary.due || []).filter(d => d.kind === 'task' && d.date < today);
      if (late.length) out.push({ ...base, text: `${plural(late.length, 'task')} overdue`, date: late[0].date, view: '@overdue', overdue: true });
    }
    for (const a of p.summary?.attention || []) if (!(a.view === 'submissions' && subTasks)) out.push({ ...base, text: a.text, date: '', view: a.view || 'overview', overdue: false });
  }
  return out;
}
/** The dated items of the projects shown in the next `days` days, not overdue (Needs attention holds those), soonest first. */
export function upcomingRows(rows, today = dayNow(), days = 30) {
  const until = plusDays(today, days);
  return dashboardRows(rows.filter(p => p.summary).map(p => ({ id: p.id, name: p.name, summary: p.summary, stale: p.stale })), { today })
    .filter(r => r.date && !r.overdue && r.date <= until);
}

/**
 * Tasks sent to another project that has not taken them in yet. The hub draws them in that project's group (with "Waiting for the
 * project to open") until a read of the project contains them; Undo takes one back. `{ add, takeBack, rowsFor, reconcile, size }`.
 */
export function pendingAdds() {
  const items = new Map();                    // hand-off id -> { projectId, task }
  return {
    add(projectId, task, handoffId) { items.set(handoffId, { projectId, task: normaliseTasks([task])[0] }); },
    takeBack(handoffId) { return items.delete(handoffId); },
    rowsFor(projectId) { return [...items.values()].filter(x => x.projectId === projectId).map(x => x.task); },
    reconcile(results) {
      for (const [h, x] of [...items]) { const r = results.get(x.projectId); if (r?.tasks?.some(t => t.id === x.task.id)) items.delete(h); }
    },
    get size() { return items.size; },
  };
}

// ---- markup ------------------------------------------------------------------------------------------------------------------

const EMPTY = {
  projects: { icon: 'projects', title: 'No projects' },
  search: { icon: 'search', title: 'No tasks match', actions: [{ id: 'hub-clear', label: 'Clear search' }] },
  open: { icon: 'tasks', title: 'No open tasks' },
  today: { icon: 'check', title: 'Nothing due today' },
  upcoming: { icon: 'clock', title: 'Nothing scheduled' },
  overdue: { icon: 'check', title: 'Nothing overdue' },
  logbook: { icon: 'check', title: 'Nothing completed yet' },
};
/** The empty state of a list page: 'projects', 'search', 'open', 'today', 'upcoming', 'overdue' or 'logbook'. */
export const hubEmpty = kind => (EMPTY[kind] ? emptyState(EMPTY[kind]) : '');

/**
 * The page's title bar (views/hub.mjs page, lib/topbar.mjs), the same on every section: the section pick as the title (Projects, All work,
 * Today, Upcoming, Overdue, Logbook; a project's own list shows its name) with its count, New project the one primary. More holds a task
 * section's list-wide toggles (Group by project, Show completed, and on Upcoming the period), then Open folder…, Find projects… and
 * Import project…. `run` maps an id to its handler: `pick` (the title's menu, given its anchor) and `period` (given the period's key).
 */
export function hubPageSpec({ key = PROJECTS_LIST, title = 'Projects', count = '', crossProject = false, byProject = false, showDone = false, period = 'all', canOpen = true, desktop = true } = {}, run = {}) {
  const tasks = key !== PROJECTS_LIST, on = id => run[id] || (() => {});
  const toggles = !tasks ? [] : [...(crossProject ? [{ id: 'hub-by-project', label: 'Group by project', kind: 'toggle', checked: !!byProject, run: on('hub-by-project') }] : []),
    { id: 'hub-show-done', label: 'Show completed', kind: 'toggle', checked: !!showDone, run: on('hub-show-done') },
    ...(key === 'upcoming' ? ['-', ...PERIODS.map(([k, l]) => ({ id: `hub-period-${k}`, label: l, kind: 'toggle', checked: k === (period || 'all'), run: () => on('period')(k) }))] : []), '-'];
  return { title, titleMenu: on('pick'), ...(count ? { status: { text: count, ch: tasks ? 18 : 4 } } : {}),
    // Import project… beside New project, not in More: bringing a project (or a folder of them) in is how a person starts on another computer
    actions: [{ id: 'hub-add-project', label: 'New project', icon: 'plus', role: 'primary', run: on('hub-add-project') }, { id: 'hub-restore', label: 'Import project…', icon: 'import', run: on('hub-restore') }],
    // canOpen false (a browser without folder access, or the hosted web build): no folder entries at all, rather than two that do nothing
    overflow: [...toggles, ...(canOpen ? [{ id: 'hub-open-folder', label: 'Open folder…', run: on('hub-open-folder') },
      { id: 'hub-find-projects', label: 'Find projects…', run: on('hub-find-projects') }] : [])] };
}

const plainId = id => String(id).replace(/[^\w:.-]/g, '-');

/**
 * The bar above the list and the selection bar that replaces it in the same cell, so pressing Select moves nothing.
 * `n` is how many are chosen, `total` how many can be, `shown` how many the list shows (Select is idle with nothing to choose).
 */
export function hubBars({ title = 'Tasks', text = '', selecting = false, canSelect = false, n = 0, total = 0 } = {}) {
  // the same units on every task section: search, Select, New task; the list-wide toggles live in the title bar's More (views/hub.mjs page)
  const tools = uiBar({ kind: 'tools', label: title, id: 'hub-head',
    filters: [{ type: 'search', id: 'hub-q', label: 'Search tasks', placeholder: 'Search', value: text }],
    actions: [{ id: 'hub-select', label: 'Select', icon: 'checklist', role: 'quiet', fold: 9, disabled: !canSelect }, { id: 'hub-new', label: 'New task', icon: 'plus', role: 'primary' }] });
  const bulk = uiBar({ kind: 'tools', label: 'Selection', id: 'hub-sel', status: { id: 'hub-sel-n', text: selectedLine(n, total), ch: CH_STEPS.find(c => c >= selectedLine(total, total).length) ?? CH_STEPS.at(-1) },
    actions: [{ id: 'hub-move', label: 'Move to', icon: 'folder', menu: true, disabled: !n }, { id: 'hub-due', label: 'Due date', icon: 'calendar', menu: true, disabled: !n },
      { id: 'hub-cancel', label: 'Cancel', icon: 'close', role: 'quiet', keep: true }],
    overflow: [{ id: 'hub-priority', label: 'Priority', disabled: !n }, { id: 'hub-remove', label: 'Remove', danger: true, disabled: !n }] });
  return uiRegion({ id: 'hub-region', label: 'Task controls', active: selecting ? 1 : 0, bars: [tools, bulk] });
}

/** The quick-add row: always there, so nothing moves when it is used; a project picker only on a list that spans projects. */
export function hubAddRow({ crossProject = false, project = null, options = [] } = {}) {
  return uiBar({ kind: 'tools', form: true, id: 'hub-add', cls: 'hub-add', label: 'Add a task',
    filters: [{ type: 'field', id: 'hub-new-text', label: 'New task', placeholder: 'Add a task', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'true' } }],
    actions: crossProject && project ? [{ picker: true, id: 'hub-new-project', label: 'Project', value: project.name, options }] : [] });
}

/** The line for what the last action did and the one button that takes it back. It ends the results and holds the bottom of the pane while the list is on screen, so its slot is always there and no blank band sits above the groups. */
export function hubNote(note = null) {
  const text = note?.text || ' ';
  return uiStatusLine({ id: 'hub-note', label: 'Last action', parts: [
    { id: 'hub-note-text', text, drop: 1, attrs: { role: 'status', ...(note?.text ? { title: note.text, 'data-note': '' } : {}) } },
    { id: 'hub-note-act', text: note?.undo ? 'Undo' : ' ', drop: 0, button: true, ch: 8, hidden: !note?.undo }] });
}

export { titleHtml, dueHtml } from './task-cells.mjs';
import { titleHtml, dueHtml } from './task-cells.mjs';

/**
 * A dated item that is not a task (an ethics deadline, the registry results date, a milestone): the same columns as a task's row, no
 * control to complete it (its check keeps the room, hidden), its kind in the detail line, and a click that opens the page that holds it.
 */
function datedRow(r, { today, locale, crossProject, focused }) {
  const t = r.task, kind = DATED_KINDS[t.kind] || 'Date';
  return uiRow({ attrs: { 'data-hub-row': t.id, 'data-hub-project': r.pid, 'data-hub-view': t.view || 'overview', 'data-tk-kind': t.kind, 'aria-selected': 'false', tabindex: focused ? '0' : '-1' },
    check: { checked: false, label: `${kind}: ${t.text}`, attrs: { 'data-row-blank': true, disabled: true, 'aria-hidden': 'true', tabindex: '-1' } },
    main: { html: `<button type="button" class="tk-text" data-open="${esc(t.id)}" title="${esc(`${kind}: ${t.text}`)}"><span class="tk-kind">${esc(kind)}</span>${esc(t.text)}</button>` },
    cells: [...(crossProject ? [{ col: 'project', kind: 'text', ch: 14, html: `<span title="${esc(r.pname)}">${esc(r.pname)}</span>` }] : []), { col: 'due', kind: 'text', ch: 14, html: dueHtml(t, today, locale) }],
    end: uiRowEnd({ reserve: true }) });
}

/**
 * One task as a row: a round control (done, or chosen while selecting), one line of title, then the project (on a list that spans
 * projects) and the date as text columns, and a More that shows on hover. Another project's task is read-only: its control is disabled.
 */
export function hubRow(r, { today = dayNow(), locale, crossProject = false, selecting = false, chosen = null, selectedKey = '', focusKey = '' } = {}) {
  const t = r.task, key = `${r.pid}\u0000${t.id}`, pick = selecting && r.writable;
  if (r.dated) return datedRow(r, { today, locale, crossProject, focused: key === focusKey });
  const state = [t.done && 'done', t.priority === 'high' && 'high'].filter(Boolean).join(' ');
  const label = t.text || 'Untitled task';
  return uiRow({ attrs: { 'data-hub-row': t.id, 'data-hub-project': r.pid, 'data-tk-state': state || false, 'aria-selected': key === selectedKey ? 'true' : 'false', tabindex: key === focusKey ? '0' : '-1' },
    check: pick ? { checked: !!chosen?.has(t.id), label: `Select: ${label}`, attrs: { 'data-hub-select': t.id } }
      : { checked: t.done, label: `Done: ${label}`, attrs: { 'data-done': t.id, disabled: !r.writable, title: r.writable ? false : r.waiting ? 'Waiting for the project to open' : 'Open the project to change it' } },
    main: { html: `<button type="button" class="tk-text" data-open="${esc(t.id)}" title="${esc(label)}">${titleHtml(t.text)}</button>`, ...(r.waiting ? { detail: ['Waiting for the project to open'] } : {}) },
    cells: [...(crossProject ? [{ col: 'project', kind: 'text', ch: 14, html: r.waiting ? '' : `<span title="${esc(r.pname)}">${esc(r.pname)}</span>` }] : []), { col: 'due', kind: 'text', ch: 14, html: dueHtml(t, today, locale) }],
    end: uiRowEnd({ more: { label: `More for ${label}`, attrs: { 'data-more': t.id } } }) });
}

/**
 * The groups as lists, each a quiet head with its count then its rows (the first GROUP_ROWS, then "Show all"). `expanded` is the set of
 * group ids that show every row. The focus key is the one row that is a tab stop (the first when `focusKey` is not drawn).
 */
export function hubGroupsHtml(model, { today = dayNow(), locale, selecting = false, chosen = null, selectedKey = '', focusKey = '', expanded = new Set() } = {}) {
  const all = model.groups.flatMap(g => g.rows).map(r => `${r.pid}\u0000${r.task.id}`);
  const focus = all.includes(focusKey) ? focusKey : all[0] || '';
  const cols = model.crossProject ? ['project', 'due'] : ['due'];
  return model.groups.map(g => {
    const id = gid(g.id), n = g.rows.length, more = n > GROUP_ROWS && !expanded.has(g.id);
    const head = uiBar({ kind: 'head', label: `${g.label}, ${plural(n, 'task')}`, id: `${id}-head`, lead: { title: g.label, level: 'h3' }, status: { id: `${id}-n`, text: String(n), ch: 4 } });
    const rows = (more ? g.rows.slice(0, GROUP_ROWS) : g.rows).map(r => hubRow(r, { today, locale, crossProject: model.crossProject, selecting, chosen, selectedKey, focusKey: focus }));
    if (more) rows.push(uiRow({ attrs: { 'data-hub-more': g.id }, main: { html: `<button type="button" class="tk-text" data-hub-all="${esc(g.id)}"><span class="meta">Show all ${n}</span></button>` },
      cells: cols.map(c => ({ col: c, kind: 'text', html: '' })) }));
    return uiList({ id, label: `${g.label} tasks`, cols, attrs: { 'data-hub-group': g.id, 'data-tk-list': true, 'data-tk-selecting': selecting || undefined }, head, rows });
  }).join('');
}

/** A project that could not be read, on its own page or among the others: why, and for a folder awaiting permission the button to open it. */
export function hubErrorsHtml(errors) {
  if (!errors?.length) return '';
  return uiList({ id: 'hub-errors', label: 'Projects that could not be read', cols: [], attrs: { 'data-tk-list': true },
    rows: errors.map(e => uiRow({ attrs: { 'data-hub-error': e.error.code, 'data-hub-project': e.id },
      main: { html: e.error.code === 'permission' ? `<button type="button" class="tk-text" data-hub-open-project="${esc(e.id)}">${esc(e.name)}</button>` : `<span class="tk-text">${esc(e.name)}</span>`, detail: [esc(e.error.message)] } })) });
}

/** The parts of one task list page (its title and count are the title bar's, views/hub.mjs page): bars, add row, and the results (the last action, the groups). `state` is the view's own (see views/hub.mjs). */
export function hubListParts(model, state = {}) {
  const { today = dayNow(), locale, selecting = false, chosen = null, selectedKey = '', focusKey = '', expanded, filters = defaultFilters(), note = null, addProjectId = '', total = selectableIds(model).length } = state;
  const addProject = model.projects.find(p => p.id === addProjectId) || model.projects.find(p => p.current) || model.projects[0] || null;
  const n = selecting && chosen ? [...chosen].filter(id => selectableIds(model).includes(id)).length : 0;
  const bars = hubBars({ title: model.title, text: filters.text, selecting, canSelect: total > 0 && !model.pending, n, total });
  const body = model.groups.length ? hubGroupsHtml(model, { today, locale, selecting, chosen, selectedKey, focusKey, expanded }) : model.empty ? hubEmpty(model.empty) : '';
  return { bars,
    add: hubAddRow({ crossProject: model.crossProject, project: addProject, options: model.projects.map(p => [p.id, p.name]) }),
    results: `${body}${hubErrorsHtml(model.errors)}${hubNote(note)}`, addProject };
}
/** The whole page: the parts above, the results in one box a redraw can replace without touching the bars, and the live region. */
export function hubListHtml(model, state = {}) {
  const p = hubListParts(model, state);
  return `${p.bars}${p.add}<div id="hub-results">${p.results}</div><div class="meta" role="status" id="hub-status"></div>`;
}

export const SHOW_LABEL = Object.freeze(Object.fromEntries(SHOW));
/** The empty portfolio: no project on this machine yet. New project and Open folder… are the title bar's (views/hub.mjs actions), not repeated here. */
export const PORTFOLIO_EMPTY = Object.freeze({ icon: 'projects', title: 'No projects yet', detail: 'A project is a folder you keep anywhere; Lykos adds one hidden folder to it.' });
const portfolioEmpty = () => emptyState(PORTFOLIO_EMPTY).replace('class="empty-detail"', 'class="empty-detail" data-ui-help');

/**
 * A list of dated rows (what, its project and kind, the date as a column): the start screen's Upcoming and the portfolio's two blocks.
 * A row carries `data-db-project` and `data-db-view` for the page that opens it. `head` and `attrs` dress it as a block of the hub;
 * `more` adds a last row "Show all n" (`data-hub-all`). `oneLine` (Needs attention) sets the project as a quiet text cell before the date,
 * so each row is one line: what needs doing, then whose.
 */
export function datedListHtml(rows, { id = 'db-rows', label = 'Upcoming', head = '', attrs = {}, more = 0, today = dayNow(), oneLine = false } = {}) {
  const cols = oneLine ? ['project', 'when'] : ['when'];
  const items = rows.map(r => uiRow({ cls: 'start-row', attrs: { 'data-db-project': r.projectId, 'data-db-view': r.view || '', tabindex: '0' },
    main: { html: `<span class="start-row-name" title="${esc(r.text)}">${esc(r.text)}</span>`, ...(oneLine ? {} : { detail: [esc(r.project), r.kind && DATED_KINDS[r.kind] ? esc(DATED_KINDS[r.kind]) : ''] }) },
    cells: [...(oneLine ? [{ col: 'project', kind: 'text', ch: 20, html: esc(r.project) }] : []),
      { col: 'when', kind: 'text', ch: 12, html: r.date ? `<span class="tk-due${r.overdue ? ' overdue' : ''}" title="${esc(r.date)}">${esc(dueText(r.date, today))}</span>` : '' }] }));
  if (more) items.push(uiRow({ attrs: { 'data-hub-more': id }, main: { html: `<button type="button" class="tk-text" data-hub-all="${esc(id)}"><span class="meta">Show all ${more}</span></button>` }, cells: cols.map(col => ({ col, kind: 'text', html: '' })) }));
  return uiList({ id, label, hook: 'start-list', cols, attrs, ...(head ? { head } : {}), rows: items });
}
const blockHead = (id, title, n) => uiBar({ kind: 'head', label: `${title}, ${n}`, id: `${id}-head`, lead: { title, level: 'h3' }, status: { id: `${id}-n`, text: String(n), ch: 4 } });

/**
 * One project as a row: its name (pinned: a pin before it), one detail line (type · tasks · submission · when), two text cells (the
 * current stage and the next date, overdue heavier), Open and More. `openNote` is what the open project says of itself ("Unsaved
 * changes"); every other project says when it was opened, or how old its summary is when it was not read now.
 */
export function portfolioRow(p, { today = dayNow(), now = Date.now(), locale, selectedId = '', focusId = '', openNote = '' } = {}) {
  const tasks = p.error && !p.summary ? esc(p.error.message) : p.pending && !p.summary ? 'Reading…'
    : p.open ? `${p.open} open${p.overdue ? `, <span class="tk-late">${p.overdue} overdue</span>` : ''}` : 'No tasks';
  const whenText = p.current ? openNote || 'Open now' : p.stale && p.error ? `as of ${ago(p.at, now)}` : p.openedAt ? `Opened ${openedText(p.openedAt, now, locale)}` : '';
  const detail = [esc(p.type), tasks, esc(submissionText(p.submission, today)), esc(whenText)].filter(Boolean);
  const next = p.next ? dueHtml({ due: p.next.date, done: false }, today, locale) : '';
  return uiRow({ attrs: { 'data-hub-project-row': p.id, 'data-hub-project': p.id, 'data-hub-phase': p.phase, 'aria-selected': String(p.id === selectedId), tabindex: p.id === focusId ? '0' : '-1' },
    main: { html: `<button type="button" class="tk-text" data-hub-open="${esc(p.id)}" title="${esc(p.name)}">${p.pinned ? `<span class="hub-pin" title="Pinned">${icon('pin', { size: 14 })}</span>` : ''}<span class="hub-name">${esc(p.name)}</span></button>`, detail },
    cells: [{ col: 'stage', kind: 'text', ch: 20, html: p.stage ? `<span title="${esc(p.stage)}">${esc(p.stage)}</span>` : '' }, { col: 'next', kind: 'text', ch: 12, html: next }],
    end: uiRowEnd({ primary: { id: `hub-open-${plainId(p.id)}`, label: 'Open', icon: 'open' }, more: { label: `More for ${p.name}`, attrs: { 'data-proj-more': p.id } } }) });
}

/**
 * The portfolio page in two parts a redraw can take one at a time (the section pick and the count are the title bar's, views/hub.mjs
 * page): `tools` (search and the Show picker) and `body`: Needs attention, the projects in their phases (a head for each only when more than one phase is shown) and
 * Upcoming; the blocks are absent when empty. With no project at all the page is the empty state and nothing else.
 */
/**
 * You (plan §2, Projects page; review of 2026-10-12 §C3): the researcher's papers across every project listed, as one row of quiet figures:
 * active, with a journal, accepted or published, due in the next seven days, overdue. Counted from the rows the page already holds.
 */
export function youCounts(rows, today = dayNow()) {
  const week = plusDays(today, 7);
  return { active: rows.filter(p => p.phase === 'active').length, submitted: rows.filter(p => p.phase === 'submitted').length,
    published: rows.filter(p => p.phase === 'published').length, dueWeek: rows.filter(p => p.next && !p.next.overdue && p.next.date <= week).length,
    overdue: rows.reduce((n, p) => n + (p.overdue || 0), 0) };
}
export function youStripHtml(c) {
  const items = [['Active', c.active], ['With a journal', c.submitted], ['Accepted or published', c.published], ['Due this week', c.dueWeek], ...(c.overdue ? [['Overdue', c.overdue]] : [])];
  return `<dl class="ov-strip hub-you" aria-label="Your papers">${items.map(([k, v]) => `<div class="ov-strip-i"><dt>${esc(k)}</dt><dd>${num(v)}</dd></div>`).join('')}</dl>`;
}
/** Ideas, last on the page: an add row ("Title: question"), then each idea waiting with Start project and More. */
export function ideasHtml(ideas = []) {
  const open = openIdeas(ideas);
  const add = uiBar({ kind: 'tools', form: true, id: 'hub-idea-add', cls: 'ov-add', label: 'Add an idea',
    filters: [{ type: 'field', id: 'hub-idea-text', label: 'New idea', placeholder: 'Add an idea: title, then a colon and the question', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'false' } }] });
  const list = open.length ? uiList({ id: 'hub-ideas', label: 'Ideas', rows: open.map(x => uiRow({ attrs: { 'data-hub-idea': x.id },
    main: { html: `<span class="hub-name" title="${esc(x.title)}">${esc(x.title)}</span>`, detail: x.question ? [esc(x.question)] : [] },
    end: uiRowEnd({ primary: { id: `hub-idea-start-${x.id}`, label: 'Start project', icon: 'plus', attrs: { 'data-idea-start': x.id } }, more: { label: `More for ${x.title}`, attrs: { 'data-idea-more': x.id } } }) })) }) : '';
  return `<section class="hub-ideas" aria-label="Ideas">${blockHead('hub-ideas-sec', 'Ideas', open.length)}${add}${list}</section>`;
}

export function portfolioParts(rows, { today = dayNow(), now = Date.now(), locale, text = '', show = 'current', results = new Map(), expanded = new Set(), selectedId = '', focusId = '', openNote = '', ideas = [] } = {}) {
  if (!rows.length) return { tools: '', body: portfolioEmpty() };
  const q = String(text || '').trim().toLowerCase();
  const inShow = rows.filter(p => shows(p.phase, show));
  const shown = inShow.filter(p => !q || [p.name, p.type, p.stage, p.submission?.journal].some(x => String(x || '').toLowerCase().includes(q)));
  const tools = uiBar({ kind: 'tools', label: 'Projects', id: 'hub-head', filters: [{ type: 'search', id: 'hub-q', label: 'Search projects', placeholder: 'Search', value: text }],
    actions: [{ picker: true, id: 'hub-show', label: 'Show', icon: 'filter', role: 'quiet', value: SHOW_LABEL[show] || 'Current', options: SHOW.map(([k, l]) => [k, l]) }] });
  if (!shown.length) {
    const none = q ? { icon: 'search', title: 'No projects match', actions: [{ id: 'hub-clear', label: 'Clear search' }] } : { icon: 'projects', title: `No ${String(SHOW_LABEL[show] || '').toLowerCase()} projects` };
    return { tools, body: emptyState(none) };
  }
  const focus = shown.some(p => p.id === focusId) ? focusId : shown[0].id;
  const block = (id, title, all, oneLine = false) => {
    if (!all.length) return '';
    const open = expanded.has(id), list = open ? all : all.slice(0, BLOCK_ROWS);
    return datedListHtml(list, { id, label: title, today, oneLine, head: blockHead(id, title, all.length), attrs: { 'data-hub-group': id.replace(/^hub-/, ''), 'data-hub-block': true }, more: open || all.length <= BLOCK_ROWS ? 0 : all.length });
  };
  const phases = PHASES.filter(([k]) => shown.some(p => p.phase === k));
  const lists = phases.map(([k, label]) => {
    const mine = shown.filter(p => p.phase === k);
    return uiList({ id: `hub-projects-${k}`, label: `${label} projects`, cols: ['stage', 'next'], attrs: { 'data-hub-projects': true, 'data-hub-group': k },
      ...(phases.length > 1 ? { head: blockHead(`hub-projects-${k}`, label, mine.length) } : {}),
      rows: mine.map(p => portfolioRow(p, { today, now, locale, selectedId, focusId: focus, openNote })) });
  }).join('');
  const body = `${youStripHtml(youCounts(rows, today))}${block('hub-attention', 'Needs attention', attentionRows(shown, results, today), true)}${lists}${block('hub-upcoming', 'Upcoming', upcomingRows(shown, today))}${ideasHtml(ideas)}`;
  return { tools, body };
}
/** The portfolio page as one string (tests, and the first draw): tools, the body in its own box, the live region. */
export function portfolioHtml(rows, opts = {}) {
  const p = portfolioParts(rows, opts);
  return `${p.tools}<div id="hub-portfolio">${p.body}</div><div class="meta" role="status" id="hub-status"></div>`;
}

// ---- moving: what the page asks of the model ----------------------------------------------------------------------------------

/**
 * The projects a selection can be sent to, in `entries` order, without the open one: `[{ id, name, ok, reason }]`.
 * Only a project kept in a folder that was read without trouble can receive: a project kept in the app's storage has no folder to
 * leave a file in, and one that could not be read may not be a project at all. `reason` says why not, for the menu.
 */
export function moveTargets(entries, results, openId) {
  return entries.filter(e => e.id !== openId).map(e => {
    const r = results.get(e.id), name = r?.name || projectName(e);
    if (!r) return { id: e.id, name, ok: false, reason: 'Reading' };
    if (r.error) return { id: e.id, name, ok: false, reason: r.error.message };
    if (e.kind !== 'path' && e.kind !== 'handle') return { id: e.id, name, ok: false, reason: 'Kept in app storage' };
    return { id: e.id, name, ok: true, reason: '' };
  });
}

/**
 * What leaves the open project once a copy is safely in the target: of the chosen `ids`, those whose task is still exactly what it was
 * when the copy was made (`snapshot`) are removed; one that changed since stays here and is named in `kept`; one already gone is `gone`.
 * `{ remove: [id], kept: [id], gone: [id] }`.
 */
export function planRemoval(current, snapshot, ids) {
  const now = new Map(normaliseTasks(current).map(t => [t.id, t])), then = new Map(normaliseTasks(snapshot).map(t => [t.id, t]));
  const out = { remove: [], kept: [], gone: [] };
  for (const id of ids) {
    const a = now.get(id), b = then.get(id);
    if (!a) out.gone.push(id);
    else if (b && tasksSignature([a]) === tasksSignature([b])) out.remove.push(id);
    else out.kept.push(id);
  }
  return out;
}

/**
 * Puts tasks that a move took out of `list` back, exactly as restoreRemoved does when nothing changed since. When something did
 * change (so restoreRemoved refuses), the removed tasks whose ids are not in the list are added at the end instead, so an undone move
 * never loses a task. A new list; the input is not touched.
 */
export function restoreOrAppend(list, record) {
  const back = restoreRemoved(list, record);
  if (back) return back;
  const have = new Set((Array.isArray(list) ? list : []).map(t => t?.id));
  return [...(Array.isArray(list) ? list : []), ...(record?.removed || []).map(r => structuredClone(r.task)).filter(t => !have.has(t.id))];
}
