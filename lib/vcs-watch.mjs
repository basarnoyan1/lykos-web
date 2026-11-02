// The history keeps itself up to date: the folder is looked at on a change (lib/folder-poll.mjs). A change that has stopped moving
// (the same files two looks in a row, EVERY apart) is committed with a message that says what changed (lib/vcs.mjs describe), by "Lykos (automatic)". A person still commits by
// hand to name a step ("Round 20") or tag a version. Nothing starts until the folder has a history: the History tab's Start history begins it.
//
// Recording can be turned off for a folder (`.lykos/vcs/settings.json`, { auto: false }); the History tab's toggle writes it. Each look that
// finds the folder as before reads only the folder's listing (one native call in the desktop app) and writes nothing.
import { vcs, describe, DIR, PROJECT } from './vcs.mjs';
import { statOf } from './vcs-diff.mjs';
import { lib_folder_poll$pollFolder as pollFolder, lib_folder_poll$watchFolder as watchFolder, lib_folder_poll$pollState as pollState } from "../boot.mjs";
import { AUTO_BY } from './vcs-log.mjs';
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { lib_agent_state$agentEditing as agentEditing } from "../boot.mjs";
import { lib_timings$timing as timing, lib_timings$busy as mainShare } from "../boot.mjs";
import { releaseSoon } from './memory-release.mjs';

// A measurement build's main-thread slices of a look, its own code only: wait(p) around each await, then end() records `<name> (own)`, their
// total, and `<name> (slice)`, the largest (lib/timings.mjs busy counts whatever else ran meanwhile too). Elsewhere it records nothing.
const pass = { wait: p => p, end() {} };
function slices(name) {
  if (!globalThis.__lykosMeasureTour) return pass;
  let t = performance.now(), sum = 0, max = 0;
  const cut = () => { const d = performance.now() - t; sum += d; if (d > max) max = d; };
  return {
    async wait(p) { cut(); try { return await p; } finally { t = performance.now(); } },
    end() { cut(); const now = performance.now(); timing(`${name} (own)`, now - sum, now); timing(`${name} (slice)`, now - max, now); },
  };
}

export const EVERY = 5000;      // ms between timed looks; the settling look's delay
export const SYNC_EVERY = 30000;   // ms after which a look brings the folder in again even when its listing did not move (a file saved in place
                                  // with the same size, a folder with no history), each pass cheap: files are compared by size and time first
export const SETTLE = 2;        // looks with the same changes before they are committed
export const PROJECT_EVERY = 10 * 60_000;   // the project's data alone (edits in the app, no file changed) is committed at most this often
export const BY = AUTO_BY;   // who the recorder commits as
const dec = new TextDecoder();
const repos = new WeakMap();
const listeners = new Set();
let pending = { folder: null, key: '', seen: 0 }, stop = null, busy = false, synced = new WeakMap(), syncing = false, lastPass = 0;
// One look later where the folder is watched: the settling look, or the project data's commit.
let laterT = null, laterAt = 0;
function lookLater(ms) {
  if (!pollState().events) return;   // timed looks come anyway
  const at = Date.now() + ms;
  if (laterT && laterAt <= at) return;
  clearTimeout(laterT); laterAt = at;
  laterT = setTimeout(() => { laterT = null; look(); }, ms);
  laterT.unref?.();
}
// A change outside Lykos's own files brings the folder in.
const outside = paths => paths.some(p => p === '*' || !(p.startsWith('.lykos/') || p === '.lykos' || p === 'Lykos project.json'));

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
/** Calls fn({ folder, status?, committed?, syncing?, synced? }) after each look and around each folder sync; returns the way to stop listening. */
export function onHistory(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = e => { for (const fn of [...listeners]) { try { fn(e); } catch { /* one listener does not stop the next */ } } };
const keyOf = s => [s.added.length, s.modified.length, s.deleted.length, s.moved.length, ...s.added, ...s.modified, ...s.deleted, ...s.moved.map(m => m.to)].join('|');

/**
 * The project catches up with its folder (lib/folder-sync.mjs): on the first look at a folder and whenever its files change, loaded on that use.
 * One pass at a time; a pass that finds nothing writes nothing but the empty list of needs.
 */
async function catchUp(folder, key, { force = false } = {}) {
  if (syncing || (!force && synced.get(folder) === key) || folder !== activeFolder()) return;   // only the open project's own folder: its state is the one written
  if (agentEditing()) { synced.delete(folder); return; }   // another program is editing the folder: read it in once it is done (lib/agent-activity.mjs)
  syncing = true; synced.set(folder, key); lastPass = Date.now();
  const own = slices('folder catch-up');
  emit({ folder, syncing: true });
  try {
    const [sync, store, notes] = await own.wait(Promise.all([import('./folder-sync.mjs'), import('../store.mjs'), import('./notifications.mjs')]));
    const t0 = performance.now();
    const r = await own.wait(sync.syncFolder(folder, { get: store.get, update: store.update }));
    timing('folder sync', t0);
    if (r.applied.length) store.update(st => { for (const e of r.applied) notes.notify(st, { id: `auto-${e.id}`, title: `From the folder: ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}`, detail: e.detail, tone: 'info', view: 'changes' }); return st; });
    // the guide's Lykos part follows the project too (lib/folder-outputs.mjs refreshGuide): written only when it changed, only inside its markers
    await own.wait(import('./folder-outputs.mjs').then(o => o.refreshGuide(folder, store.get())).catch(() => null));
    emit({ folder, synced: r, syncing: false });
  } catch (err) { emit({ folder, error: String(err.message || err), syncing: false }); } finally { syncing = false; own.end(); releaseSoon(); }
}
/** Brings the folder in now (the app came to the front, a project opened, a file was written through the MCP): one pass, not waiting for a change. */
export function syncNow(folder = activeFolder()) {
  if (!folder) return null;
  return catchUp(folder, `now:${Date.now()}`, { force: true });
}

// The project's data is recorded with every commit (lib/vcs.mjs sections); edits made only in the app change no file, so they are committed
// on their own once the project file is newer than the last commit and that commit is PROJECT_EVERY old.
const headAt = new WeakMap();   // folder -> { id, at } of the newest commit, read once per head
async function projectOnly(folder, repo, head) {
  if (!head || !(await autoOn(folder))) return null;
  let known = headAt.get(folder);
  if (known?.id !== head) { const c = await repo.readCommit(head); known = { id: head, at: Date.parse(c?.at || '') || 0 }; headAt.set(folder, known); }
  const st = await folder.stat(PROJECT).catch(() => null);
  if (!st?.exists || !(st.mtime > known.at)) return null;
  if (Date.now() - known.at < PROJECT_EVERY) { lookLater(PROJECT_EVERY - (Date.now() - known.at) + 1000); return null; }
  return repo.commit({ message: 'Project data', by: BY, paths: [PROJECT] });
}

/** One look: status, and a commit once the same changes were seen SETTLE times. `paths`: what a file event says changed. */
export const look = (folder = activeFolder(), paths = null) => mainShare('history look', lookOnce(folder, paths));
async function lookOnce(folder, paths) {
  watchFolder(folder);
  if (!folder || busy) return null;
  busy = true;
  const began = performance.now(), own = slices('history look');
  try {
    const repo = repoOf(folder), status = await own.wait(repo.status());
    const force = paths ? outside(paths) : Date.now() - lastPass > SYNC_EVERY;
    catchUp(folder, `${status.head}|${keyOf(status)}`, { force });   // not awaited: a long read of a workbook never holds the next look
    if (!status.head) { emit({ folder, status }); return { status }; }
    const n = status.added.length + status.modified.length + status.deleted.length + status.moved.length;
    if (!n) {
      pending = { folder, key: '', seen: 0 };
      const made = await own.wait(projectOnly(folder, repo, status.head));
      emit({ folder, status, ...(made ? { committed: made.id } : {}) });
      return { status, ...(made ? { committed: made.id } : {}) };
    }
    const key = keyOf(status);
    pending = pending.folder === folder && pending.key === key ? { ...pending, seen: pending.seen + 1 } : { folder, key, seen: 1 };
    if (pending.seen < SETTLE || !(await own.wait(autoOn(folder)))) {
      if (pending.seen < SETTLE) lookLater(EVERY);
      emit({ folder, status }); return { status };
    }
    const made = await own.wait(repo.commit({ message: describe(status), by: BY }));
    pending = { folder, key: '', seen: 0 };
    const after = made ? await own.wait(repo.status()) : status;
    emit({ folder, status: after, committed: made?.id || null });
    return { status: after, committed: made?.id || null };
  } catch (err) { emit({ folder, error: String(err.message || err) }); return null; } finally { busy = false; own.end(); timing('history look', began); }
}

/** Starts looking (idempotent). The app calls it once after it starts. */
export function start(every = EVERY) {
  if (!stop) {
    stop = pollFolder(paths => look(activeFolder(), paths), every);
    // the app coming to the front reads the folder at once: a file changed while it was behind (by hand, a script, the MCP) is in when it is seen
    if (typeof window !== 'undefined') window.addEventListener('focus', () => { lastPass = 0; look(); });
    // a project opened (or replaced) is read at once, not at the next change
    import('../store.mjs').then(st => st.onProjectReplaced?.(() => { lastPass = 0; setTimeout(() => look(), 400); }), () => {});
  }
  return () => { stop?.(); stop = null; };
}
