// Tasks: the project's to-do list with priority, status, a start date,
// subtasks, blocked-by and an optional link (plan §2 "Progress"; amendment
// "Workspace: backup, dashboard, tasks, timeline and translation").
//
// A task is the to-do record the app has always kept — `{ id, text, done,
// due, at }` — with optional fields added beside it. Nothing is migrated on
// load: every reader goes through normaliseTask, so a project saved by an
// older build reads the same, and a build that knows only `done` still reads
// a task this one wrote. `done` stays the authority other code writes
// (file notes, workflows, the Overview checkbox); status follows it:
//
//   status      'todo' | 'doing' | 'waiting' | 'done'   (absent: from done)
//   priority    'none' | 'low' | 'high'                  (absent: none)
//   start       'YYYY-MM-DD' or ''
//   parentId    the task this one is a subtask of, or ''
//   blockedBy   [task id]: blocked while any of them is open
//   link        { view, paperId?, label? } or null
//   notes       free text, kept beside the title ('' when none)
//   doneAt      when it was completed (ISO day or time), '' while open
//
// Pure: nothing here imports the store or a view.

export const STATUSES = [['todo', 'To do'], ['doing', 'Doing'], ['waiting', 'Waiting'], ['done', 'Done']];
export const PRIORITIES = [['none', 'No priority'], ['low', 'Low'], ['high', 'High']];
const STATUS_IDS = new Set(STATUSES.map(([k]) => k)), PRIORITY_IDS = new Set(PRIORITIES.map(([k]) => k));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = v => (DAY.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : '');
const STAMP = /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]*Z?)?$/;
const stamp = v => (typeof v === 'string' && v.length <= 40 && STAMP.test(v) ? v : '');

/** The status a task is in: `done` wins over a stale status, and a reopened task is back to do. */
export function statusOf(t) {
  if (!t) return 'todo';
  if (t.done) return 'done';
  return STATUS_IDS.has(t.status) && t.status !== 'done' ? t.status : 'todo';
}

/** A task as this version reads it, every field present; other fields are kept as they were. */
export function normaliseTask(t) {
  const x = t && typeof t === 'object' ? t : {};
  const status = statusOf(x);
  return {
    ...x,
    id: String(x.id || ''),
    text: String(x.text ?? ''),
    done: status === 'done',
    due: day(x.due),
    status,
    priority: PRIORITY_IDS.has(x.priority) ? x.priority : 'none',
    start: day(x.start),
    parentId: typeof x.parentId === 'string' ? x.parentId : '',
    blockedBy: Array.isArray(x.blockedBy) ? [...new Set(x.blockedBy.filter(id => typeof id === 'string' && id && id !== x.id))] : [],
    notes: String(x.notes ?? ''),
    doneAt: status === 'done' ? stamp(x.doneAt) : '',
    link: x.link && typeof x.link === 'object' && typeof x.link.view === 'string' && x.link.view ? { view: x.link.view, ...(x.link.paperId ? { paperId: String(x.link.paperId) } : {}), ...(x.link.label ? { label: String(x.link.label) } : {}) } : null,
  };
}
export const normaliseTasks = list => (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object').map(normaliseTask);

export const newTaskId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A new task record: only the fields that carry something are written. */
export function makeTask({ text, due = '', priority = 'none', status = 'todo', start = '', parentId = '', link = null, notes = '' } = {}, { id = newTaskId(), at = new Date().toISOString() } = {}) {
  const t = { id, text: String(text || '').trim(), done: status === 'done', due: day(due), at };
  if (String(notes || '').trim()) t.notes = String(notes);
  if (status !== 'todo') t.status = status;
  if (priority && priority !== 'none') t.priority = priority;
  if (day(start)) t.start = day(start);
  if (parentId) t.parentId = parentId;
  if (link?.view) t.link = link;
  return t;
}

/**
 * The fields to write for a status change: status and done together, so the
 * Overview checkbox, file notes and this list agree.
 */
export function statusPatch(status) {
  const s = STATUS_IDS.has(status) ? status : 'todo';
  return { status: s, done: s === 'done' };
}

/**
 * Applies a patch to one task in a list, in place; answers the task or null. A task that becomes done
 * gets `doneAt` once (the clock is `now`, injectable for tests); one that is reopened loses it.
 */
export function patchTask(list, id, patch, { now = () => new Date() } = {}) {
  const t = (list || []).find(x => x.id === id);
  if (!t) return null;
  const wasDone = !!t.done;
  const p = { ...patch };
  if ('status' in p) Object.assign(p, statusPatch(p.status));
  else if ('done' in p) p.status = p.done ? 'done' : (t.status === 'done' ? 'todo' : t.status || 'todo');
  if ('blockedBy' in p) p.blockedBy = (p.blockedBy || []).filter(b => b !== id && !wouldCycle(list, id, b));
  if ('parentId' in p && p.parentId && (p.parentId === id || descendants(list, id).has(p.parentId))) delete p.parentId;
  Object.assign(t, p);
  if ('done' in p) {
    if (t.done && !wasDone && !stamp(t.doneAt)) t.doneAt = now().toISOString();
    else if (!t.done) delete t.doneAt;
  }
  return t;
}

const asList = list => (Array.isArray(list) ? list : []);
const idSet = ids => new Set(ids == null ? [] : typeof ids === 'string' ? [ids] : ids);

/**
 * Removes tasks (missing ids are ignored) and answers everything needed to put them back.
 * Each surviving subtask moves up to its nearest surviving ancestor, or to the top level
 * when none is left; nothing stays blocked by a removed task. The input list and its tasks
 * are not touched: a surviving task that changes is a copy. `removed` are the old records
 * with their index in `list`; `lifted` is `{ id, from, to }`; `unblocked` is
 * `{ id, removed, before }` (the ids dropped and the whole blockedBy it had); `after` is
 * tasksSignature of the new list, which restoreRemoved compares.
 */
export function removeTasks(list, ids) {
  const src = asList(list), want = idSet(ids);
  const gone = new Set(), parentOf = new Map(), present = new Set();
  for (const t of src) if (t && typeof t === 'object') { present.add(t.id); parentOf.set(t.id, t.parentId); if (want.has(t.id)) gone.add(t.id); }
  const removed = [], lifted = [], unblocked = [], out = [];
  src.forEach((t, index) => {
    if (t && typeof t === 'object' && gone.has(t.id)) { removed.push({ task: structuredClone(t), index }); return; }
    if (!t || typeof t !== 'object') { out.push(t); return; }
    let next = t;
    if (typeof t.parentId === 'string' && gone.has(t.parentId)) {
      let cur = t.parentId; const seen = new Set();
      while (gone.has(cur) && !seen.has(cur)) { seen.add(cur); cur = typeof parentOf.get(cur) === 'string' ? parentOf.get(cur) : ''; }
      const to = gone.has(cur) || cur === t.id || !present.has(cur) ? '' : cur;
      lifted.push({ id: t.id, from: t.parentId, to });
      next = { ...next, parentId: to };
    }
    if (Array.isArray(t.blockedBy) && t.blockedBy.some(b => gone.has(b))) {
      unblocked.push({ id: t.id, removed: t.blockedBy.filter(b => gone.has(b)), before: [...t.blockedBy] });
      next = { ...next, blockedBy: t.blockedBy.filter(b => !gone.has(b)) };
    }
    out.push(next);
  });
  return { list: out, removed, lifted, unblocked, after: tasksSignature(out) };
}

/** Removes one task; its subtasks move up to its parent, and nothing stays blocked by it. */
export const removeTask = (list, id) => removeTasks(list, [id]).list;

/** What removing these tasks would do besides removing them, for the confirmation: counts of tasks. */
export function removalEffects(list, ids) {
  const r = removeTasks(list, ids);
  return { count: r.removed.length, lifted: r.lifted.length, unblocked: r.unblocked.length };
}

/**
 * The list as it was before removeTasks gave `record`, or null: when the tasks changed since
 * (tasksSignature differs from record.after), when a removed id is back, or when there is
 * nothing to restore. A new list; the input is not touched.
 */
export function restoreRemoved(list, record) {
  if (!record || !Array.isArray(record.removed) || !record.removed.length || typeof record.after !== 'string') return null;
  const src = asList(list);
  if (tasksSignature(src) !== record.after) return null;
  const back = new Set(record.removed.map(r => r?.task?.id));
  if (src.some(t => t && back.has(t.id))) return null;
  const parents = new Map((record.lifted || []).map(l => [l.id, l.from])), blockers = new Map((record.unblocked || []).map(u => [u.id, u.before]));
  const out = src.map(t => {
    if (!t || (!parents.has(t.id) && !blockers.has(t.id))) return t;
    return { ...t, ...(parents.has(t.id) ? { parentId: parents.get(t.id) } : {}), ...(blockers.has(t.id) ? { blockedBy: [...blockers.get(t.id)] } : {}) };
  });
  for (const { task, index } of [...record.removed].sort((a, b) => a.index - b.index)) out.splice(Math.min(index, out.length), 0, structuredClone(task));
  return out;
}

// Two FNV-1a lanes over the same text, so a chance clash needs both to agree.
const fnv = (s, h) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
/** A short fingerprint of what a task list says (order, ids, status, priority, dates, links between tasks, text, notes, completion time). */
export function tasksSignature(list) {
  const ts = normaliseTasks(list);
  let s = String(ts.length);
  for (const t of ts) s += `\n${JSON.stringify([t.id, t.status, t.done, t.priority, t.due, t.start, t.parentId, t.blockedBy, t.text, t.notes, t.doneAt])}`;
  return fnv(s, 0x811c9dc5) + fnv(s, 0x2545f491);
}

const realDay = v => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
/** The checked patch for bulkPatch (status, priority, due only), or null when it is empty, names another field or holds a bad value. */
function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object') return null;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(k => !['status', 'priority', 'due'].includes(k))) return null;
  if ('status' in patch && !STATUS_IDS.has(patch.status)) return null;
  if ('priority' in patch && !PRIORITY_IDS.has(patch.priority)) return null;
  if ('due' in patch && patch.due !== '' && !realDay(patch.due)) return null;
  return { ...patch, ...('status' in patch ? statusPatch(patch.status) : {}) };
}
const sameAs = (t, p) => (!('status' in p) || statusOf(t) === p.status) && (!('priority' in p) || (PRIORITY_IDS.has(t.priority) ? t.priority : 'none') === p.priority) && (!('due' in p) || day(t.due) === p.due);

/**
 * Sets status, priority or due date on several tasks, in place: `{ changed, skipped, missing }`.
 * A task that already has every value is skipped, not counted; an unknown id is missing.
 * A patch that names another field or holds a bad value changes nothing (`invalid: true`).
 * Status writes done with it, as statusPatch does.
 */
export function bulkPatch(list, ids, patch) {
  const p = cleanPatch(patch), res = { changed: 0, skipped: [], missing: [] };
  if (!p) return { ...res, invalid: true };
  const map = new Map();
  for (const t of asList(list)) if (t && typeof t === 'object' && !map.has(t.id)) map.set(t.id, t);
  for (const id of idSet(ids)) {
    const t = map.get(id);
    if (!t) res.missing.push(id);
    else if (sameAs(t, p)) res.skipped.push(id);
    else {
      const wasDone = !!t.done;
      Object.assign(t, p);
      if ('status' in p) { if (t.done && !wasDone && !stamp(t.doneAt)) t.doneAt = new Date().toISOString(); else if (!t.done) delete t.doneAt; }
      res.changed++;
    }
  }
  return res;
}

/** Moves tasks to a status, in place: `{ moved, skipped, missing }`; a task already there is skipped, not counted. */
export function moveTasks(list, ids, status) {
  const r = bulkPatch(list, ids, { status });
  return { moved: r.changed, skipped: r.skipped, missing: r.missing, ...(r.invalid ? { invalid: true } : {}) };
}

const byId = list => new Map(normaliseTasks(list).map(t => [t.id, t]));

/** The open tasks this one waits for. */
export function blockersOf(t, list) {
  const map = byId(list), x = normaliseTask(t);
  return x.blockedBy.map(id => map.get(id)).filter(b => b && !b.done);
}
/** Whether a task waits for another that is still open. */
export const isBlocked = (t, list) => blockersOf(t, list).length > 0;

/** Every task below `id` (children, their children…). */
export function descendants(list, id) {
  const out = new Set(), all = normaliseTasks(list);
  const walk = p => { for (const t of all) if (t.parentId === p && !out.has(t.id)) { out.add(t.id); walk(t.id); } };
  walk(id);
  return out;
}
export const subtasksOf = (list, id) => normaliseTasks(list).filter(t => t.parentId === id);

/** Whether making `id` wait for `blocker` would close a loop (blocker already waits, directly or not, for id). */
export function wouldCycle(list, id, blocker) {
  if (id === blocker) return true;
  const map = byId(list), seen = new Set();
  const walk = x => {
    if (x === id) return true;
    if (seen.has(x)) return false;
    seen.add(x);
    return (map.get(x)?.blockedBy || []).some(walk);
  };
  return walk(blocker);
}

const RANK = { high: 0, low: 1, none: 2 };
/** Whether a normalised task waits for a task of `all` that is still open: one lookup built once, not one per task. */
function blockedTest(all) {
  const done = new Map(all.map(t => [t.id, t.done]));
  return t => t.blockedBy.some(id => done.get(id) === false);
}
/** Sorts normalised tasks: open before done; unblocked before blocked; priority; due date; added; position. */
function orderTasks(ts, isBlockedTask) {
  const blocked = new Set(ts.filter(isBlockedTask).map(t => t.id));
  return ts.map((t, i) => [t, i]).sort(([a, i], [b, j]) =>
    (a.done - b.done) || (blocked.has(a.id) - blocked.has(b.id)) || (RANK[a.priority] - RANK[b.priority])
    || (a.due || '9999').localeCompare(b.due || '9999') || String(a.at || '').localeCompare(String(b.at || '')) || i - j).map(([t]) => t);
}
/**
 * Open before done; unblocked before blocked; high priority first; then by
 * due date (undated last), then by when it was added. Stable.
 */
export function sortTasks(list, all = list) {
  const ts = normaliseTasks(list);
  return orderTasks(ts, blockedTest(all === list ? ts : normaliseTasks(all)));
}

/**
 * The list as rows in reading order: each top-level task followed by its
 * subtasks (depth 1, 2…), each level sorted by sortTasks. A subtask whose
 * parent is filtered out is shown at the top level.
 */
export function treeRows(list, all = list) {
  const ts = normaliseTasks(list), ids = new Set(ts.map(t => t.id)), isB = blockedTest(all === list ? ts : normaliseTasks(all));
  const kids = new Map();
  for (const t of ts) { const p = ids.has(t.parentId) ? t.parentId : ''; kids.set(p, [...(kids.get(p) || []), t]); }
  const out = [];
  const walk = (p, depth) => { for (const t of orderTasks(kids.get(p) || [], isB)) { out.push({ task: t, depth }); if (depth < 6) walk(t.id, depth + 1); } };
  walk('', 0);
  return out;
}

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** What a due filter keeps: 'overdue', 'week' (due within 7 days, overdue included), 'none' (no date). */
export function dueMatches(t, when, today) {
  if (!when || when === 'any') return true;
  if (when === 'none') return !t.due;
  if (!t.due) return false;
  if (when === 'overdue') return !t.done && t.due < today;
  if (when === 'week') return t.due <= addDays(today, 7);
  return true;
}

/** Tasks passing the filters `{ status: 'open'|'all'|<status>, priority, due, text, view }`. */
export function filterTasks(list, { status = 'open', priority = 'any', due = 'any', text = '', view = '' } = {}, today = new Date().toISOString().slice(0, 10)) {
  const q = String(text || '').trim().toLowerCase();
  return normaliseTasks(list).filter(t =>
    (status === 'all' || (status === 'open' ? !t.done : t.status === status))
    && (priority === 'any' || t.priority === priority)
    && dueMatches(t, due, today)
    && (!view || t.link?.view === view)
    && (!q || t.text.toLowerCase().includes(q)));
}

/** The board: one column per status, each sorted, done last as a column. */
export function boardColumns(list, all = list) {
  const ts = normaliseTasks(list), isB = blockedTest(all === list ? ts : normaliseTasks(all));
  return STATUSES.map(([id, label]) => ({ id, label, tasks: orderTasks(ts.filter(t => t.status === id), isB) }));
}

/** Subtask progress for a parent: `{ done, total }`. */
export function subtaskProgress(list, id) {
  const kids = subtasksOf(list, id);
  return { done: kids.filter(t => t.done).length, total: kids.length };
}

/** Open tasks with a due date, soonest first: what the dashboard and timeline read. */
export const dueTasks = list => normaliseTasks(list).filter(t => !t.done && t.due).sort((a, b) => a.due.localeCompare(b.due));

// ---- when: the buckets, the date as a person says it, the lead of a title -------------------------------------------------------

/** The groups of a list by when: id and label, in the order the hub shows them. */
export const WHEN = Object.freeze([['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['none', 'No date']]);
const dayOf = iso => new Date(`${iso}T12:00:00Z`);
const daysBetween = (a, b) => Math.round((dayOf(b) - dayOf(a)) / 864e5);
/** The Sunday that ends the calendar week of `iso` (the day itself when it is a Sunday). */
const sundayOf = iso => addDays(iso, (7 - dayOf(iso).getUTCDay()) % 7);

/**
 * Where a task's due date sits against `today`: 'overdue', 'today', 'week' (after today, up to the Sunday that ends this
 * week), 'later' or 'none'. A done task is never overdue: one dated before today has no bucket ('none').
 */
export function dueBucket(t, today) {
  const due = day(t?.due);
  if (!due) return 'none';
  if (due < today) return t?.done || statusOf(t) === 'done' ? 'none' : 'overdue';
  if (due === today) return 'today';
  return due <= sundayOf(today) ? 'week' : 'later';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * A due date as it is said: Today, Tomorrow, Yesterday, a weekday name while it falls later this week, else the date
 * ('Mon 12 Oct'), with the year when it is not this year's. Written out, not asked of the machine's region (UI_Guidelines, dates).
 */
export function dueText(iso, today) {
  const d = day(iso); if (!d) return '';
  const n = daysBetween(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const date = dayOf(d), weekday = WEEKDAYS[date.getUTCDay()];
  if (n >= 2 && d <= sundayOf(today)) return weekday;
  return `${weekday} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${d.slice(0, 4) !== today.slice(0, 4) ? ` ${date.getUTCFullYear()}` : ''}`;
}

const LEAD = /^([^:.;!?]{3,40}):\s+(\S.*)$/;
/** "Lead: rest" as `{ lead, rest }` when the lead is 3 to 40 characters with no sentence punctuation and something follows; else null. The text is never changed. */
export function titleParts(text) {
  const m = LEAD.exec(String(text ?? ''));
  return m ? { lead: m[1], rest: m[2] } : null;
}

/** Open tasks grouped by when, in WHEN order, then the done ones as 'done' (Completed); a group with no task is absent. Each group is sortTasks-ordered. */
export function whenGroups(list, today) {
  const ts = normaliseTasks(list), all = ts, buckets = new Map();
  for (const t of ts) {
    const b = t.done ? 'done' : dueBucket(t, today);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(t);
  }
  return [...WHEN, ['done', 'Completed']].filter(([id]) => buckets.has(id)).map(([id, label]) => ({ id, label, tasks: sortTasks(buckets.get(id), all) }));
}

// ---- a removal made elsewhere (the assistant), kept so the page can offer its Undo ---------------------------------------------------
// The Tasks page and the hub keep the record of a removal they made themselves. A removal the assistant makes after a person accepts
// it is kept here, and the page shows the same "removed, Undo" line as long as the tasks are exactly as that removal left them
// (restoreRemoved checks the same fingerprint, so Undo is never offered over changed tasks).
let lastRemoval = null;
/** Remembers `record` (what removeTasks returned) and the line to show beside its Undo. */
export function noteRemoval(record, text) { lastRemoval = record?.removed?.length ? { record, text: String(text || '') } : null; }
/** `{ record, text }` when the last remembered removal still fits `list` (nothing changed since), else null. It stays until a page takes it. */
export function pendingRemoval(list) { return lastRemoval && lastRemoval.record.after === tasksSignature(list) ? lastRemoval : null; }
/** Forgets the remembered removal (a page took it over, or it was undone). */
export function clearRemoval() { lastRemoval = null; }

// ---- tasks added elsewhere (an accepted suggestion), kept so the page can offer Undo the same way --------------------------------------
// Consecutive additions that follow one another with nothing else changed between are one run ("6 tasks added"); Undo removes them while
// the tasks are exactly as the last addition left them.
let lastAdded = null;
/** Remembers that the task `id` was added, `before` and `after` being tasksSignature of the list around the addition. */
export function noteAdded(id, before, after) {
  lastAdded = lastAdded && lastAdded.after === before ? { ids: [...lastAdded.ids, id], after } : { ids: [id], after };
}
/** `{ ids, after }` when the last run of additions still fits `list`, else null. */
export function pendingAdded(list) { return lastAdded && lastAdded.after === tasksSignature(list) ? lastAdded : null; }
export function clearAdded() { lastAdded = null; }

