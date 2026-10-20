// The history keeps itself up to date: while the app is in front, the project folder is looked at every few seconds (lib/folder-poll.mjs),
// and a change that has stopped moving (the same set of files two looks in a row, so a script or a save in progress is not caught half
// written) is committed with a message that says what changed (lib/vcs.mjs describe), by "Lykos (automatic)". A person still commits by
// hand to name a step ("Round 20") or tag a version. Nothing starts until the folder has a history: the History tab's Start history begins it.
//
// Recording can be turned off for a folder (`.lykos/vcs/settings.json`, { auto: false }); the History tab's toggle writes it. Each look that
// finds the folder as before reads only the folder's listing (one native call in the desktop app) and writes nothing.
import { vcs, describe, DIR } from './vcs.mjs';
import { statOf } from './vcs-diff.mjs';
import { pollFolder } from './folder-poll.mjs';
import { AUTO_BY } from './vcs-log.mjs';
import { activeFolder } from './projects.mjs';

export const EVERY = 5000;      // ms between looks while the app is visible
export const SETTLE = 2;        // looks with the same changes before they are committed
export const BY = AUTO_BY;   // who the recorder commits as
const dec = new TextDecoder();
const repos = new WeakMap();
const listeners = new Set();
let pending = { folder: null, key: '', seen: 0 }, stop = null, busy = false, synced = new WeakMap(), syncing = false;

/** The history of a folder, one per folder for the whole window, so the tab and the recorder share its caches. */
export function repoOf(folder) {
  if (!repos.has(folder)) repos.set(folder, vcs(folder, { by: 'You', stat: statOf }));
  return repos.get(folder);
}
/** Whether a folder records itself; true unless it was turned off. */
export async function autoOn(folder) {
  try { const st = await folder.stat(`${DIR}/settings.json`); return !st.exists || JSON.parse(dec.decode(await folder.read(`${DIR}/settings.json`))).auto !== false; } catch { return true; }
}
const readSettings = async folder => { try { return JSON.parse(dec.decode(await folder.read(`${DIR}/settings.json`))) || {}; } catch { return {}; } };
export async function setAuto(folder, on) {
  await folder.writeText(`${DIR}/settings.json`, JSON.stringify({ ...await readSettings(folder), auto: !!on }));
  emit({ folder, settings: true });
}
/** Names a built document's path prefix as derived: History keeps its hash, not its content (lib/package-write.mjs). */
export async function addDerived(folder, prefix) {
  const cur = await readSettings(folder);
  if ((cur.derived || []).includes(prefix)) return;
  await folder.writeText(`${DIR}/settings.json`, JSON.stringify({ ...cur, derived: [...(cur.derived || []), prefix] }));
}
/** Calls fn({ folder, status?, committed? }) after each look; returns the way to stop listening. */
export function onHistory(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = e => { for (const fn of [...listeners]) { try { fn(e); } catch { /* one listener does not stop the next */ } } };
const keyOf = s => [s.added.length, s.modified.length, s.deleted.length, s.moved.length, ...s.added, ...s.modified, ...s.deleted, ...s.moved.map(m => m.to)].join('|');

/**
 * The project catches up with its folder (lib/folder-sync.mjs): on the first look at a folder and whenever its files change, loaded on that use.
 * One pass at a time; a pass that finds nothing writes nothing but the empty list of needs.
 */
async function catchUp(folder, key) {
  if (syncing || synced.get(folder) === key || folder !== activeFolder()) return;   // only the open project's own folder: its state is the one written
  syncing = true; synced.set(folder, key);
  try {
    const [sync, store, adopt, notes] = await Promise.all([import('./folder-sync.mjs'), import('../store.mjs'), import('./adopt.mjs'), import('./notifications.mjs')]);
    const r = await sync.syncFolder(folder, { get: store.get, update: store.update, adopt: adopt.adoptFromFolder });
    if (r.applied.length) store.update(st => { for (const e of r.applied) notes.notify(st, { id: `auto-${e.id}`, title: `From the folder: ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}`, detail: e.detail, tone: 'info', view: 'changes' }); return st; });
    // the guide's Lykos part follows the project too (lib/folder-outputs.mjs refreshGuide): written only when it changed, only inside its markers
    await import('./folder-outputs.mjs').then(o => o.refreshGuide(folder, store.get())).catch(() => null);
    emit({ folder, synced: r });
  } catch (err) { emit({ folder, error: String(err.message || err) }); } finally { syncing = false; }
}

/** One look at the active folder: status, and a commit when the same changes were seen SETTLE times. Answers what it did. */
export async function look(folder = activeFolder()) {
  if (!folder || busy) return null;
  busy = true;
  try {
    const repo = repoOf(folder), status = await repo.status();
    catchUp(folder, `${status.head}|${keyOf(status)}`);   // not awaited: a long read of a workbook never holds the next look
    if (!status.head) { emit({ folder, status }); return { status }; }
    const n = status.added.length + status.modified.length + status.deleted.length + status.moved.length;
    if (!n) { pending = { folder, key: '', seen: 0 }; emit({ folder, status }); return { status }; }
    const key = keyOf(status);
    pending = pending.folder === folder && pending.key === key ? { ...pending, seen: pending.seen + 1 } : { folder, key, seen: 1 };
    if (pending.seen < SETTLE || !(await autoOn(folder))) { emit({ folder, status }); return { status }; }
    const made = await repo.commit({ message: describe(status), by: BY });
    pending = { folder, key: '', seen: 0 };
    const after = made ? await repo.status() : status;
    emit({ folder, status: after, committed: made?.id || null });
    return { status: after, committed: made?.id || null };
  } catch (err) { emit({ folder, error: String(err.message || err) }); return null; } finally { busy = false; }
}

/** Starts looking (idempotent). The app calls it once after it starts. */
export function start(every = EVERY) {
  if (!stop) stop = pollFolder(() => look(), every);
  return () => { stop?.(); stop = null; };
}
