// Moving tasks into another project, by hand-off (plan §2 "Workspace"; design: scratchpad tasks-design.md section 11, option C).
//
// A project that is not open is never written through its project file. The sender writes one new file into the target's own
// `.lykos/inbox/`, create-only and under a fresh name, and the target takes the tasks in itself the next time it is open
// (absorbHandoffs, called by the shell after a project loads and when the window is focused). `.lykos/project.json` is not
// touched, so no window that has the target open can conflict, and normalizeProject / assertProject stay the only door into a project.
//
//   packTasks      what travels: the chosen tasks, their links to each other, and a count of what cannot go
//   sendHandoff    one create-only write, then a read back that must match; anything less throws and nothing else has happened
//   withdrawHandoff  undo while the target has not taken it: the file moves to inbox/withdrawn/
//   listHandoffs, mergeIncoming, absorbHandoffs   the receiving side
//
// The sender removes tasks from its own project only after sendHandoff returned, so the worst outcome of any failure or race is a
// task in both projects, never in neither. A task already in the target (same id, same content) is skipped on absorbing, which makes
// a second absorb of the same file harmless; one with the same id and other content gets a new id.
//
// Pure of the store and the DOM: a `folder` is the fsys.mjs shape (stat, read, list, writeBytes, mkdir, rename), so the tests run it
// over a scratch directory and the page over a project folder.
import { normaliseTask, normaliseTasks, newTaskId } from './tasks.mjs';

export const HANDOFF_FORMAT = 1;
export const INBOX = '.lykos/inbox';
export const PROJECT_FILE = '.lykos/project.json';
export const MAX_FILE_BYTES = 2_000_000;
export const MAX_FILES = 50;
export const MAX_TASKS = 2000;
export const MAX_NOTES = 20000;

const MESSAGES = {
  notproject: 'The folder is not a Lykos project',
  unwritable: 'Could not write into the project folder',
  unverified: 'The copy could not be checked, so nothing was moved',
  damaged: 'Not a task hand-off',
  unavailable: 'Not available here',
};
export class HandoffError extends Error {
  constructor(code, detail = '') {
    super(detail && code === 'unwritable' ? `${MESSAGES.unwritable}: ${detail}` : MESSAGES[code] || MESSAGES.unwritable);
    this.name = 'HandoffError'; this.code = code in MESSAGES ? code : 'unwritable';
  }
}

const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);
const short = err => String(err?.message || err).slice(0, 100);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** A fresh hand-off id: a uuid where the platform has one. */
export function newHandoffId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

/** A task as it travels: the fields that mean the same in any project, written sparsely as makeTask writes them. */
function travelling(t, { parentId = '', blockedBy = [], link = null } = {}) {
  const o = { id: t.id, text: t.text, done: t.done, due: t.due, at: t.at || '' };
  if (t.status !== 'todo') o.status = t.status;
  if (t.priority !== 'none') o.priority = t.priority;
  if (t.start) o.start = t.start;
  if (t.notes) o.notes = t.notes;
  if (t.doneAt) o.doneAt = t.doneAt;
  if (parentId) o.parentId = parentId;
  if (blockedBy.length) o.blockedBy = blockedBy;
  if (link) o.link = link;
  return o;
}

/**
 * The chosen tasks of `all`, ready to travel, in list order: `{ tasks, dropped: { parents, blockers, links } }`.
 * A subtask keeps its parent, and a task keeps what it waits for, only when that task travels too; a link to a record of this project
 * keeps its page and loses the record. `dropped` counts what was left behind, for the confirmation.
 */
export function packTasks(all, ids) {
  const want = new Set(typeof ids === 'string' ? [ids] : ids || []);
  const chosen = normaliseTasks(all).filter(t => want.has(t.id));
  const inSet = new Set(chosen.map(t => t.id));
  const dropped = { parents: 0, blockers: 0, links: 0 };
  const tasks = chosen.map(t => {
    const parentId = t.parentId && inSet.has(t.parentId) ? t.parentId : '';
    if (t.parentId && !parentId) dropped.parents++;
    const blockedBy = t.blockedBy.filter(b => inSet.has(b));
    dropped.blockers += t.blockedBy.length - blockedBy.length;
    let link = null;
    if (t.link) { link = { view: t.link.view, ...(t.link.label ? { label: t.link.label } : {}) }; if (t.link.paperId) dropped.links++; }
    return travelling(t, { parentId, blockedBy, link });
  });
  return { tasks, dropped };
}

/** The sentence under the confirmation: what does not come along. Empty when everything does. */
export function droppedNote(dropped) {
  const out = [];
  if (dropped?.parents) out.push(`${plural(dropped.parents, 'task')} will no longer be a subtask`);
  if (dropped?.blockers) out.push(`${plural(dropped.blockers, 'wait', 'waits')} for other tasks end`);
  if (dropped?.links) out.push(`${plural(dropped.links, 'record link')} will be dropped`);
  return out.length ? `${out.join('; ')}.` : '';
}

/** The file's content for one hand-off. */
export const makeHandoff = ({ id = newHandoffId(), from = {}, tasks, at = new Date().toISOString() }) =>
  ({ format: HANDOFF_FORMAT, kind: 'tasks', id, from: { id: String(from.id || ''), name: String(from.name || '') }, at, tasks });

/**
 * A hand-off file's text as checked content `{ id, from, at, tasks }`, or a HandoffError. Only known task fields survive, and
 * parent and wait links survive only between tasks of the file, whatever the file says.
 */
export function parseHandoff(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new HandoffError('damaged'); }
  if (!raw || typeof raw !== 'object' || raw.format !== HANDOFF_FORMAT || raw.kind !== 'tasks' || !SAFE_ID.test(String(raw.id || '')) || !Array.isArray(raw.tasks)) throw new HandoffError('damaged');
  if (!raw.tasks.length || raw.tasks.length > MAX_TASKS) throw new HandoffError('damaged');
  const seen = new Set(), list = [];
  for (const x of raw.tasks) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || x.id.length > 80 || typeof x.text !== 'string' || seen.has(x.id)) throw new HandoffError('damaged');
    seen.add(x.id); list.push(normaliseTask({ id: x.id, text: x.text.slice(0, 2000), done: x.done, due: x.due, status: x.status, priority: x.priority, start: x.start, notes: typeof x.notes === 'string' ? x.notes.slice(0, MAX_NOTES) : '', doneAt: typeof x.doneAt === 'string' ? x.doneAt.slice(0, 40) : '', at: typeof x.at === 'string' ? x.at.slice(0, 40) : '', parentId: x.parentId, blockedBy: x.blockedBy, link: x.link }));
  }
  const tasks = list.map(t => travelling(t, { parentId: seen.has(t.parentId) ? t.parentId : '', blockedBy: t.blockedBy.filter(b => seen.has(b)), link: t.link ? { view: t.link.view, ...(t.link.label ? { label: t.link.label } : {}) } : null }));
  return { id: raw.id, from: { id: String(raw.from?.id || '').slice(0, 80), name: String(raw.from?.name || '').slice(0, 200) }, at: String(raw.at || '').slice(0, 40), tasks };
}

async function ensureDir(folder, rel) {
  const st = await folder.stat(rel);
  if (st.exists) { if (st.dir) return; throw new HandoffError('unwritable', `${rel} is a file`); }
  try { await folder.mkdir(rel); }
  catch (err) {
    const again = await folder.stat(rel).catch(() => null);      // another window may have made it a moment ago
    if (!(again?.exists && again.dir)) throw new HandoffError('unwritable', short(err));
  }
}
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Writes one hand-off into `folder`'s inbox and reads it back. Resolves `{ id, rel }` only when the bytes read back are the bytes written;
 * rejects with a HandoffError otherwise, having removed nothing and changed no project file. A failed check moves its own file aside.
 */
export async function sendHandoff(folder, handoff) {
  let proj;
  try { proj = await folder.stat(PROJECT_FILE); } catch (err) { throw new HandoffError('unwritable', short(err)); }
  if (!proj.exists || proj.dir) throw new HandoffError('notproject');
  await ensureDir(folder, INBOX);
  const bytes = encode(`${JSON.stringify(handoff, null, 1)}\n`), rel = `${INBOX}/${handoff.id}.json`;
  try { await folder.writeBytes(rel, bytes); }                    // create-only: a name that exists is refused, never replaced
  catch (err) { throw new HandoffError('unwritable', short(err)); }
  let back = null;
  try { back = await folder.read(rel); } catch { /* checked below */ }
  if (!back || !sameBytes(back, bytes)) {
    await withdrawHandoff(folder, handoff.id).catch(() => {});
    throw new HandoffError('unverified');
  }
  return { id: handoff.id, rel };
}

const MOVED = { withdrawn: 'withdrawn', done: 'done' };
/** Moves an inbox file into a sub-folder of the inbox under its own name (a number after it when that name is taken there). */
async function fileAway(folder, id, where) {
  const rel = `${INBOX}/${id}.json`;
  const st = await folder.stat(rel);
  if (!st.exists || st.dir) return false;
  const dir = `${INBOX}/${MOVED[where]}`;
  await ensureDir(folder, dir);
  let to = `${dir}/${id}.json`;
  for (let n = 2; (await folder.stat(to)).exists && n < 100; n++) to = `${dir}/${id}-${n}.json`;
  await folder.rename(rel, to);
  return true;
}

/**
 * Takes a hand-off back while the target has not absorbed it: `{ withdrawn: true }`, or `{ withdrawn: false, reason: 'gone' }` when the
 * file is no longer in the inbox (the target took it in, or it was removed); the caller then leaves the tasks where they are.
 */
export async function withdrawHandoff(folder, id) {
  if (!SAFE_ID.test(String(id))) throw new HandoffError('damaged');
  try { return (await fileAway(folder, id, 'withdrawn')) ? { withdrawn: true } : { withdrawn: false, reason: 'gone' }; }
  catch (err) { throw new HandoffError('unwritable', short(err)); }
}

// ---- the receiving side -------------------------------------------------------------------------------------------------------

/** The hand-offs waiting in `folder`'s inbox: `{ items: [{ id, from, at, tasks }], invalid: [file name] }`. A file that does not check out is left where it is. */
export async function listHandoffs(folder) {
  const st = await folder.stat(INBOX).catch(() => null);
  if (!st?.exists || !st.dir) return { items: [], invalid: [] };
  const rows = (await folder.list(INBOX)).filter(r => !r.dir && /\.json$/i.test(r.name)).slice(0, MAX_FILES);
  const items = [], invalid = [];
  for (const r of rows) {
    try {
      if (r.size > MAX_FILE_BYTES) throw new HandoffError('damaged');
      const h = parseHandoff(decode(await folder.read(`${INBOX}/${r.name}`)));
      if (`${h.id}.json` !== r.name) throw new HandoffError('damaged');
      items.push(h);
    } catch { invalid.push(r.name); }
  }
  return { items, invalid };
}

const sameTask = (a, b) => a.text === b.text && a.status === b.status && a.done === b.done && a.priority === b.priority && a.due === b.due && a.start === b.start && a.notes === b.notes;

/**
 * What adding `incoming` to `existing` does: `{ added: [task], skipped, renamed }`. A task already there with the same id and content is skipped;
 * one with the same id and other content is added under a new id; links between incoming tasks follow the new ids. Neither list is touched.
 */
export function mergeIncoming(existing, incoming, options = {}) {
  const freshId = options.newId || newTaskId;
  const have = new Map(normaliseTasks(existing).map(t => [t.id, t]));
  const used = new Set(have.keys()), map = new Map(), keep = [];
  let skipped = 0, renamed = 0;
  for (const raw of incoming || []) {
    const t = normaliseTask(raw), there = have.get(t.id);
    if (there && sameTask(there, t)) { map.set(t.id, t.id); skipped++; continue; }
    let id = t.id;
    if (used.has(id)) { do { id = freshId(); } while (used.has(id)); renamed++; }
    used.add(id); map.set(t.id, id); keep.push({ raw, id });
  }
  const added = keep.map(({ raw, id }) => {
    const t = { ...raw, id };
    if (raw.parentId) { if (map.has(raw.parentId)) t.parentId = map.get(raw.parentId); else delete t.parentId; }
    if (raw.blockedBy) { const b = raw.blockedBy.filter(x => map.has(x)).map(x => map.get(x)).filter(x => x !== id); if (b.length) t.blockedBy = b; else delete t.blockedBy; }
    return t;
  });
  return { added, skipped, renamed };
}

/**
 * Takes in what waits in `folder`'s inbox. Per hand-off, with deps:
 *   existing()        the open project's tasks now
 *   ask({ from, count })   whether to add them (resolves true or false); false leaves the file for next time
 *   apply(tasks)      adds the tasks to the open project (the caller's store update); resolves how many were added
 * A hand-off whose tasks are all there already is filed as done without asking. `seen` (a Set the caller keeps for the session) stops a
 * declined or unfiled hand-off from asking twice. Resolves `{ added, declined, filed, failed: [message] }`.
 */
export async function absorbHandoffs(folder, { existing, ask, apply, seen = new Set() }) {
  const out = { added: 0, declined: 0, filed: 0, failed: [] };
  let listed;
  try { listed = await listHandoffs(folder); } catch (err) { out.failed.push(short(err)); return out; }
  for (const h of listed.items) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const merge = mergeIncoming(existing(), h.tasks);
    if (merge.added.length) {
      if (!await ask({ from: h.from.name || 'another project', count: merge.added.length })) { out.declined++; continue; }
      out.added += await apply(h.tasks);
    }
    try { if (await fileAway(folder, h.id, 'done')) out.filed++; } catch (err) { out.failed.push(short(err)); }
  }
  return out;
}
