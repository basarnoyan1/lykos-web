// Projects.
//
// A project is a plain folder the user keeps wherever they like. Lykos adds
// one hidden folder to it, `.lykos/`, holding the project file and a daily
// backup of it; everything else in the folder is the user's, and the explorer
// shows it as it is. Copying or syncing the folder moves the project.
//
// The project that lived in the app's own storage before folders existed is
// still here, as the "local" project, and is never touched by opening another.
// It can be saved into a folder, which copies it; the original stays.
//
// Which project is open is remembered per machine. Switching reloads the page:
// every view and cache starts clean against the new project, and a reload of
// plain ES modules takes well under a second.
import { persist, saveError, saveState, exportableState, assertProject, normalizeProject, credentialsOf, PROJECT_FORMAT, get, getVersion, recoveryOwner, projectGeneration } from '../store.mjs';
import { folderFigureStore, idbFigureStore, inlineFigures, externalizeFigures } from './figures.mjs';
import { inDesktop, inHostedTab, pickFolderNative, allowFoldersNative, writeModelCredentialsNative, saveBackupNative, removeAppBackupNative } from './native.mjs';
import { folderAtPath, folderFromHandle, permitted, join, canOpenFolders, freeName } from './fsys.mjs';
import { confirmAsk } from './dialog.mjs';
import { newProjectDialog, initializeProjectFolder } from './new-project.mjs';
import { lazyModule } from './lazy.mjs';
const projectFolder = lazyModule(() => import('./project-folder.mjs'), 'the project folder layout');   // the folder's layout loads when a folder project is created or its papers are copied in
import { RESEARCH_TYPES } from './workflow.mjs';
import { getFile } from './files.mjs';
import { saveFile } from './save.mjs';
import { serializeProject } from './serialize-project.mjs';
import { documentHash } from './files.mjs';
import { gzipText, gunzipBlob, textOf } from './gzip.mjs';
import { keepBackups, compressible } from './backup-rule.mjs';

export const LOCAL = 'local';
// No project open: the start screen (views/start.mjs) is shown instead of a workspace.
export const NONE = 'none';
const LIST_KEY = 'lykos.projects';
const CUR_KEY = 'lykos.current';
export const DIR = '.lykos';
// A visible copy of the project file, for Safari (no hidden folder in its uploads); out of history (lib/vcs.mjs)
export const VISIBLE_COPY = 'Lykos project.json';
const VISIBLE_EVERY = 30_000;
export const FILE = `${DIR}/project.json`;

// ---- the list ------------------------------------------------------------
function readList() { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; } }
function writeList(list) { try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch {} }

/** Projects opened on this machine, most recent first, the local one included. */
export function recents() {
  return readList().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}
export function currentId() { try { return localStorage.getItem(CUR_KEY) || LOCAL; } catch { return LOCAL; } }
export const current = () => recents().find(p => p.id === currentId())
  || (currentId() === NONE ? { id: NONE, kind: 'none', name: '' } : { id: LOCAL, kind: 'local', name: '' });
/** Whether no project is open, so the start screen stands in for the workspace. */
export const isNone = () => currentId() === NONE;

// The local project is listed unless it is known to be empty (a first launch
// that never used it) or was moved into a folder; either is recorded here the
// last time it was open, since its contents cannot be read from another project.
const LOCAL_KEY = 'lykos.localProject';
const localInfo = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } };
const setLocalInfo = info => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...localInfo(), ...info })); } catch {} };

/**
 * The projects to offer: the recent list, with the local project when it holds
 * work and has not been moved into a folder. Most recently opened first.
 */
export function switchList() {
  const list = recents();
  const info = localInfo();
  const off = info.blank || info.movedTo || info.hidden;
  if (!list.some(p => p.id === LOCAL) && !off)
    list.push({ id: LOCAL, kind: 'local', name: info.name || '', type: info.type || '', openedAt: info.openedAt || 0, ...flagsOf(info) });
  return list.filter(p => !(p.id === LOCAL && off));
}

/**
 * Keeps the listed name and research type in step with the open project, and
 * whether the local project is empty. Called by the shell as the project changes.
 */
export function describe(id, { name = '', type = '', blank = false } = {}) {
  if (id === NONE) return;
  if (id === LOCAL) { setLocalInfo({ name, type, blank, ...(blank ? {} : { openedAt: Date.now() }) }); return; }
  const list = readList(); const e = list.find(p => p.id === id);
  if (!e) return;
  let changed = false;
  if (name && e.name !== name) { e.name = name; changed = true; }
  if (type && e.type !== type) { e.type = type; changed = true; }
  if (changed) writeList(list);
}

function remember(entry) {
  const was = readList().find(p => p.id === entry.id);
  const list = readList().filter(p => p.id !== entry.id);
  list.push({ ...flagsOf(was), ...entry, openedAt: Date.now() });
  writeList(list);
}

// ---- how a project is kept on the list (All projects): pinned, and active, paused or archived. Flags of this machine's list only:
// they are never written into a project file, so a project folder carries nothing of where one person keeps it.
export const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'archived']);
const flagsOf = e => ({ ...(e?.pinned ? { pinned: true } : {}), ...(PROJECT_STATUSES.includes(e?.status) && e.status !== 'active' ? { status: e.status } : {}) });
/** Sets `pinned` and/or `status` on a listed project's entry and nothing else. An unknown status is refused. */
export function setFlags(id, { pinned, status } = {}) {
  if (status !== undefined && !PROJECT_STATUSES.includes(status)) throw new Error(`Unknown project status: ${String(status).slice(0, 40)}`);
  const apply = e => {
    const next = { ...e };
    if (pinned !== undefined) { if (pinned) next.pinned = true; else delete next.pinned; }
    if (status !== undefined) { if (status === 'active') delete next.status; else next.status = status; }
    return next;
  };
  if (id === LOCAL && !readList().some(p => p.id === LOCAL)) { const i = localInfo(); const n = apply(flagsOf(i)); setLocalInfo({ pinned: !!n.pinned, status: n.status || 'active' }); return; }
  const list = readList(), at = list.findIndex(p => p.id === id);
  if (at < 0) throw new Error('That project is not in the list');
  list[at] = apply(list[at]);
  writeList(list);
}
/** Keeps the listed name in step with the review's title. */
export function rename(id, name) {
  const list = readList(); const e = list.find(p => p.id === id);
  if (e && name && e.name !== name) { e.name = name; writeList(list); }
}
export function forget(id) {
  writeList(readList().filter(p => p.id !== id));
  handleOp('readwrite', s => s.delete(id)).catch(() => {});
}
/** Removes a recent entry without deleting its stored project or folder. */
export async function removeFromList(id) {
  const active = id === currentId();
  if (id === LOCAL && !active) { setLocalInfo({ hidden: true }); return; }
  if (active) {
    do { await persist(); } while (!saveError() && saveState() === 'saving');
    if (saveError()) throw new Error(`Save the current project before removing it from the list: ${saveError()}`);
  }
  if (id === LOCAL) setLocalInfo({ hidden: true }); else forget(id);
  if (active) {
    try { localStorage.setItem(CUR_KEY, NONE); } catch {}
    location.reload();
  }
}

/** Closes the open project: saved first, then the start screen. */
export async function closeProject() {
  do { await persist(); } while (!saveError() && saveState() === 'saving');
  if (saveError()) throw new Error(`Save the current project before closing it: ${saveError()}`);
  try { localStorage.setItem(CUR_KEY, NONE); } catch {}
  location.reload();
}

// Browser directory handles cannot go in localStorage; they live here.
let hdb = null;
// A refused open is not kept: the next call opens again (as store.mjs does).
function handlesDb() {
  if (hdb) return hdb;
  const opening = hdb = new Promise((resolve, reject) => {
    const r = indexedDB.open('lykos-projects', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => { r.result.onclose = () => { if (hdb === opening) hdb = null; }; resolve(r.result); };
    r.onerror = () => reject(r.error);
  });
  opening.catch(() => { if (hdb === opening) hdb = null; });
  return hdb;
}
function handleOp(mode, fn) {
  return handlesDb().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('handles', mode); const q = fn(t.objectStore('handles'));
    t.oncomplete = () => resolve(q?.result); t.onerror = () => reject(t.error);
  }));
}

// ---- the open folder -------------------------------------------------------
let folder = null;
/** The open project's folder, or null for the local project. */
export const activeFolder = () => folder;
export const __setActiveFolderForTest = f => { folder = f; };

const decode = bytes => new TextDecoder().decode(bytes);
const today = () => new Date().toISOString().slice(0, 10);
const trimSlash = path => String(path || '').replace(/(.)\/+$/, '$1');

/** The project file's text as data; a file that is not JSON is an error that says so, never an empty project. */
function parseProject(text) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${FILE} could not be read as a project file (it may be incomplete or damaged); it was left as it is`); }
}

/**
 * The project a chosen folder already holds, or null when it holds none.
 * Unreadable, damaged, foreign or newer project files are refused with the
 * reason, before anything is registered or written.
 */
export async function projectIn(f) {
  const st = await f.stat(FILE);
  if (!st.exists) return null;
  if (st.dir) throw new Error(`${FILE} in this folder is a folder, not a project file`);
  return normalizeProject(parseProject(decode(await f.read(FILE))), { source: `${FILE} in this folder` });
}

/** What a folder that holds no project starts as: named, and waiting for its study design. */
export const seedProject = name => ({ project: { name, setupPending: true }, paper: { title: name, authors: [] }, format: PROJECT_FORMAT, savedAt: Date.now() });

/**
 * The store's backend for a folder: reads and writes the project file, and
 * refuses to overwrite a copy that changed on disk since it was read — another
 * window, or a sync client, got there first — so the store reloads instead.
 */
// Web Locks coordinate every granted handle, including two registrations of
// the same directory. The local queue also covers non-browser fixtures.
let folderQueue = Promise.resolve();
function withFolderCommit(fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request('lykos-folder-commit', fn);
  const work = folderQueue.then(fn, fn); folderQueue = work.catch(() => {}); return work;
}
/**
 * Writes one small file of Lykos's own (a `.lykos` sidecar such as
 * figure-registry.json) under the same commit protocol as the project file.
 * `expectedHash` is the SHA-256 of the bytes the caller last read, or null
 * when the caller read no file: a file that is there then, or that changed
 * since, is someone else's write and answers `{ stale: true }` without
 * writing. A folder that can commit atomically (`commitText`, the desktop
 * shell) does; any other holds the commit lock through a read, compare and
 * write. Answers `{ ok: true, hash }`. Callers never use `folder.writeText`
 * for a sidecar; an unwritable folder throws, and the caller decides what
 * to do (figure-sidecar.mjs keeps the document in the app).
 */
export function commitSidecar(target, path, text, expectedHash = null) {
  const bytes = new TextEncoder().encode(String(text));
  return withFolderCommit(async () => {
    if (target.commitText) {
      const result = await target.commitText(path, String(text), expectedHash ?? null);
      return result?.stale ? { stale: true } : { ok: true, hash: result?.hash || await documentHash(bytes) };
    }
    const st = await target.stat(path);
    if (st.exists) {
      if (st.dir || !expectedHash || await documentHash(await target.read(path)) !== expectedHash) return { stale: true };
    } else if (expectedHash) return { stale: true };
    await target.writeText(path, String(text));
    return { ok: true, hash: await documentHash(bytes) };
  });
}

export function folderBackend(f, id) {
  // read: whether this window has read the project file, and whether it was
  // there. A file that exists but was never read — or appeared after this
  // window found none — is never written over: the in-memory project is not
  // it, and saving would replace a real project with whatever is in memory.
  let stamp = 0, hash = null, backedOn = '', read = false, existed = false, tidyLater = false;
  let backupHealth = { status: 'pending', error: '', at: '' };
  let visibleText = null, visibleT = null;
  const keepVisible = text => { visibleText = text; if (visibleT) return; visibleT = setTimeout(() => { visibleT = null; const t = visibleText; visibleText = null; if (t != null) f.writeText(VISIBLE_COPY, t).catch(() => {}); }, VISIBLE_EVERY); visibleT.unref?.(); };
  return {
    channel: `lykos-project:${id}`,
    credentialId: f.kind === 'path' ? f.root : id,
    readOnly: !!f.readOnly,
    // Rendered figures: .lykos/figures/<sha-256>.svg, named from project.json (lib/figures.mjs).
    figures: folderFigureStore(f),
    // What figure clean-up must not remove figures from under: every JSON file
    // Lykos keeps in .lykos (the project file as stored, outputs logs, MCP
    // definitions, copies kept before migrations) and every daily backup.
    async *referenceTexts() {
      for (const dir of [DIR, join(DIR, 'backups')]) {
        let entries = [];
        try { entries = await f.list(dir); } catch { continue; }
        // A compressed copy is read like a plain one; one that does not inflate throws, so clean-up stops rather than misses a name.
        for (const e of entries) if (!e.dir && /\.json(\.gz)?$/i.test(e.name)) yield await textOf(await f.read(join(dir, e.name)));
      }
    },
    async read() {
      const st = await f.stat(FILE);
      if (!st.exists) { read = true; existed = false; hash = null; stamp = 0; return null; }
      // Counted as read only once it parsed: a damaged file is never saved over.
      const bytes = await f.read(FILE);
      const data = assertProject(parseProject(decode(bytes)), { source: FILE });
      hash = await documentHash(bytes);
      read = true; existed = true; stamp = st.mtime;
      if (f.writeText && ((await f.stat(VISIBLE_COPY).catch(() => ({}))).mtime || 0) < st.mtime) f.writeText(VISIBLE_COPY, decode(bytes)).catch(() => {});
      return data;
    },
    async write(state) {
      const text = await serializeProject(exportableState(state));
      return withFolderCommit(async () => {
      const st = await f.stat(FILE);
      if (st.exists && (!read || !existed)) return { stale: true };
      // Any change of stamp, not only a later one: a sync client that puts
      // back an older version is still someone else's write.
      if (st.exists && stamp && st.mtime !== stamp) return { stale: true };
      // commitText checks the hash itself: once the day's copy is kept, no second read here
      const day = today();   // the day is read on every save: a window left open past midnight keeps a copy of the new day too
      if (st.exists && !(f.commitText && backedOn === day) && await documentHash(await f.read(FILE)) !== hash) return { stale: true };
      if (!st.exists && existed) return { stale: true };
      // The day's first save keeps the day's starting point, one compressed file a day (a plain one of the day counts).
      if (st.exists && backedOn !== day) {
        const plain = join(DIR, 'backups', `project-${day}.json`), copy = `${plain}.gz`;
        try {
          if (!(await f.stat(copy)).exists && !(await f.stat(plain)).exists) {
            const bytes = new Uint8Array(await (await gzipText(decode(await f.read(FILE)))).arrayBuffer());
            if (f.writeBytes) await f.writeBytes(copy, bytes); else await f.writeText(plain, decode(await f.read(FILE)));
          }
          backedOn = day; backupHealth = { status: 'current', error: '', at: new Date().toISOString() };
          tidyLater = true;
        } catch (err) { backupHealth = { status: 'failed', error: String(err?.message || err), at: '' }; }
      }
      if (f.commitText) {
        const result = await f.commitText(FILE, text, hash);
        if (result.stale) return { stale: true };
        stamp = result.mtime; hash = result.hash;
      } else {
        // Cooperating browser writers hold the Web Lock through commit.
        stamp = await f.writeText(FILE, text);
        hash = await documentHash(new TextEncoder().encode(text));
      }
      existed = true;
      keepVisible(text);
      // once per session, outside the commit: the retention rule, and older plain copies compressed
      if (tidyLater) { tidyLater = false; queueMicrotask(() => tidyBackups(f).catch(() => {})); }
      return { backup: backupHealth };
      });
    },
  };
}

/**
 * The folder's backups after the retention rule (lib/backup-rule.mjs): copies the rule drops are removed, and kept plain
 * copies are compressed once (the compressed file is written and read back whole before the plain one goes). A folder that
 * cannot remove a file (no `removeBackup`) is left as it is. Answers `{ removed, compressed }`.
 */
export async function tidyBackups(f, day = today()) {
  if (!f.removeBackup) return { removed: 0, compressed: 0 };
  const dir = join(DIR, 'backups');
  let entries;
  try { entries = await f.list(dir); } catch { return { removed: 0, compressed: 0 }; }
  const names = entries.filter(e => !e.dir).map(e => e.name);
  const { keep, drop } = keepBackups(names, day);
  let removed = 0, compressed = 0;
  for (const n of drop) { try { await f.removeBackup(join(dir, n)); removed++; } catch {} }
  const present = new Set(names);
  for (const n of keep) {
    if (!compressible(n) || !f.writeBytes) continue;
    try {
      const text = decode(await f.read(join(dir, n)));
      // A compressed twin already there (a tidy stopped half way) is checked, not written again.
      if (!present.has(`${n}.gz`)) {
        const blob = await gzipText(text);
        if (await gunzipBlob(blob) !== text) continue;
        await f.writeBytes(join(dir, `${n}.gz`), new Uint8Array(await blob.arrayBuffer()));
      }
      if (await textOf(await f.read(join(dir, `${n}.gz`))) !== text) continue;
      await f.removeBackup(join(dir, n)); compressed++;
    } catch {}
  }
  return { removed, compressed };
}

/**
 * Resolves the project to open before anything is loaded. Returns the store
 * backend (null for the local project). A browser handle whose permission
 * lapsed with the last session needs a click to restore, so the user is asked;
 * declining opens the local project instead.
 */
export async function prepare() {
  const entry = current();
  if (entry.kind === 'none') { folder = null; return null; }
  if (entry.kind === 'app') { folder = null; remember(entry); return appBackend(entry.id); }
  if (entry.kind === 'path') {
    // A folder path is opened by the desktop shell; a browser has no way to it.
    if (!inDesktop()) return fallBack();
    await allowFoldersNative([entry.path]).catch(() => {});
    folder = folderAtPath(entry.path);
    // A folder that is gone is also outside every chosen folder to the shell,
    // so both answers mean the same thing to the person.
    const missing = 'The folder was moved, renamed or deleted, or its drive is not connected:';
    let problem = '';
    try { if (!(await folder.stat('')).exists) problem = missing; }
    catch (err) { const m = String(err?.message || err); problem = /outside a chosen folder/.test(m) ? missing : `${m.slice(0, 120)}:`; }
    if (problem) {
      // Nothing is removed: the entry stays in the list, and the folder
      // opens again once it is back where it was.
      await confirmAsk(`Could not open ${entry.name || baseOf(entry.path)}`, { detail: `${problem} ${entry.path}`, confirm: 'Show projects' }).catch(() => {});
      return fallBack();
    }
    remember(entry);
    return folderBackend(folder, entry.id);
  }
  if (entry.kind === 'handle') {
    const h = await handleOp('readonly', s => s.get(entry.id)).catch(() => null);
    if (!h) return fallBack(entry);
    if (!await permitted(h)) {
      const yes = await confirmAsk(`Open ${entry.name || h.name}`, { detail: h.name, confirm: 'Open' });
      if (!yes || !await permitted(h, { ask: true })) return fallBack(entry);
    }
    folder = folderFromHandle(h);
    remember(entry);
    return folderBackend(folder, entry.id);
  }
  if (entry.kind === 'drive') {
    // A Google Drive folder, in the hosted web build only: the desktop app opens the same folder through Google Drive for desktop.
    if (inDesktop()) return fallBack();
    const drive = await import('./drive-project.mjs');
    if (!await drive.signedInFor(entry)) return fallBack();
    folder = await drive.driveFolderFor(entry.driveId, entry.name);
    remember(entry);
    return folderBackend(folder, entry.id);
  }
  folder = null;
  return null;
}
/** Opens a Google Drive folder, from its link, as a project (hosted web build; lib/drive-project.mjs). Needs a Google sign-in first. */
export async function openDriveFolder(link) {
  return openChosen(await (await import('./drive-project.mjs')).chosenFromLink(link, projectIn));
}
const baseOf = path => trimSlash(path).split('/').pop();
// A project that cannot be opened leaves no project open: the start screen
// lists it (and every other) rather than the local project opening in its place.
function fallBack() {
  try { localStorage.setItem(CUR_KEY, NONE); } catch {}
  folder = null;
  return null;
}

// ---- opening and creating --------------------------------------------------
async function chooseFolder() {
  if (inDesktop()) {
    const picked = await pickFolderNative().catch(() => null);
    const path = picked && trimSlash(picked);
    return path ? { kind: 'path', path, folder: folderAtPath(path), name: baseOf(path) } : null;
  }
  if (!('showDirectoryPicker' in window)) throw new Error('this browser cannot open folders');
  let h;
  // Cancelling the picker is not an error; anything else is, and is said.
  // A cancel that comes back faster than a person could press Cancel is the
  // browser refusing to show a picker at all (an embedded browser does this).
  const asked = performance.now();
  const refused = () => new Error('this browser does not show a folder picker; open the folder in the Lykos app');
  // A real picker is a system dialog, which takes focus from the page. Some
  // embedded browsers neither show one nor answer; if the page still has
  // focus a moment later, nothing is being shown, and waiting would be silence.
  const shown = new Promise((_, reject) => setTimeout(() => { if (document.hasFocus()) reject(refused()); }, 1500));
  try { h = await Promise.race([window.showDirectoryPicker({ mode: 'readwrite', id: 'lykos-project' }), shown]); }
  catch (err) {
    if (err?.message?.startsWith('this browser')) throw err;
    if (err?.name === 'AbortError' && performance.now() - asked > 350) return null;
    throw new Error(err?.name === 'AbortError' ? 'this browser does not show a folder picker; open the folder in the Lykos app' : err.message);
  }
  return { kind: 'handle', handle: h, folder: folderFromHandle(h), name: h.name };
}

async function register(chosen, name) {
  const list = readList();
  let existing = null;
  if (chosen.kind === 'path') existing = list.find(p => p.kind === 'path' && trimSlash(p.path) === trimSlash(chosen.path));
  else if (chosen.kind === 'drive') existing = list.find(p => p.kind === 'drive' && p.driveId === chosen.driveId);
  else for (const p of list.filter(x => x.kind === 'handle')) {
    const h = await handleOp('readonly', s => s.get(p.id)).catch(() => null);
    if (h && await h.isSameEntry(chosen.handle).catch(() => false)) { existing = p; break; }
  }
  const id = existing?.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (chosen.kind === 'handle') await handleOp('readwrite', s => s.put(chosen.handle, id));
  remember({ id, kind: chosen.kind, path: chosen.path && trimSlash(chosen.path), ...(chosen.driveId ? { driveId: chosen.driveId } : {}), name: name || existing?.name || chosen.name });
  return id;
}

/** Switches to a listed project. */
export async function open(id, { beforeSwitch } = {}) {
  do { await persist(); } while (!saveError() && saveState() === 'saving');
  if (saveError()) throw new Error(`Save the current project before switching: ${saveError()}`);
  beforeSwitch?.();
  if (id === LOCAL) setLocalInfo({ hidden: false, movedTo: null });
  try { localStorage.setItem(CUR_KEY, id); } catch {}
  location.reload();
}

/**
 * Opens a folder as a project. A folder that already holds a project opens it;
 * any other folder becomes one, named after the folder, with its files left
 * exactly where they are.
 */
export async function openFolder() {
  const chosen = await chooseFolder();
  if (!chosen) return false;
  return openChosen(chosen);
}

/** Index existing projects in a chosen parent without writing project files or switching. */
export async function addProjectCollection(chosen = null, { chooser = null } = {}) {
  chosen ||= await chooseFolder();
  if (!chosen) return null;
  const report = { added: [], skipped: [], errors: [] }, found = [];
  const entries = (await chosen.folder.list('')).filter(e => e.dir && !e.name.startsWith('.'));
  for (const entry of entries) {
    try {
      const child = chosen.kind === 'path'
        ? { kind: 'path', path: join(chosen.path, entry.name), name: entry.name }
        : { kind: 'handle', handle: await chosen.handle.getDirectoryHandle(entry.name), name: entry.name };
      child.folder = child.kind === 'path' ? folderAtPath(child.path) : folderFromHandle(child.handle);
      const data = await projectIn(child.folder);
      if (!data) { report.skipped.push(entry.name); continue; }
      found.push({ child, data, key: entry.name, name: data.project?.name || data.paper?.title || entry.name });
    } catch (error) { report.errors.push({ name: entry.name, error: String(error?.message || error) }); }
  }
  const keep = chooser && found.length ? await chooser(found.map(f => ({ key: f.key, kind: 'folder', root: f.key, name: f.name, type: f.data.project?.researchType || '',
    records: (f.data.papers || []).length, pdfs: (f.data.papers || []).filter(p => p.pdf).length, missing: 0 })), chosen.name) : null;
  if (chooser && found.length && !keep) return null;
  for (const f of found) {
    if (keep && !keep.includes(f.key)) continue;
    try { const id = await register(f.child, f.name); describe(id, { name: f.name, type: f.data.project?.researchType || '' }); report.added.push({ id, name: f.name }); }
    catch (error) { report.errors.push({ name: f.key, error: String(error?.message || error) }); }
  }
  if (chosen.kind === 'path') rememberParent(chosen.path);
  return report;
}

export function collectionMessage(report) {
  if (!report) return '';
  const count = report.added.length;
  return `${count} ${count === 1 ? 'project' : 'projects'} added to the project list` +
    (report.skipped.length ? `; ${report.skipped.length} folders without a Lykos project skipped` : '') +
    (report.errors.length ? `. Could not read: ${report.errors.map(e => `${e.name}: ${e.error}`).join('; ')}` : '');
}

/** A folder dropped on the window, as a browser directory handle, opened as a project. */
export const openHandle = handle => openChosen({ kind: 'handle', handle, folder: folderFromHandle(handle), name: handle.name });

async function openChosen(chosen) {
  // A folder that holds a project opens it, exactly as it is. A project file
  // that cannot be read is refused here, before the folder joins the list.
  const found = await projectIn(chosen.folder);
  let name = chosen.name;
  if (found) name = found.project?.name || found.paper?.title || name;
  else await writeSeed(chosen.folder, JSON.stringify(seedProject(name)));
  await open(await register(chosen, name));
  return true;
}

/** The first write into a chosen folder; a folder that refuses it is said plainly. */
async function writeSeed(f, text) {
  try { await f.writeText(FILE, text); }
  catch (err) { throw new Error(`this folder cannot be written to (${String(err?.message || err).slice(0, 80)})`); }
}

/**
 * Moves the open app-storage project into a folder and switches to it. The
 * chosen folder gets the project's own child folder, laid out for its research
 * type (lib/project-folder.mjs); PDFs held in the app's storage are copied into
 * its papers folder, so the folder is complete on another machine. The copy in
 * the app's storage is kept, off the project list, as a fallback — Settings ›
 * Projects lists it and can delete it.
 */
export async function saveLocalToFolder(state = get()) {
  const boundary = projectGeneration(), owner = recoveryOwner();
  const live = state === get();
  const chosen = await chooseFolder();
  if (!chosen) return false;
  if (boundary !== projectGeneration()) throw new Error('The project changed while choosing a folder. Try again.');
  await persist();
  if (saveError()) throw new Error(`Save the current project first: ${saveError()}`);
  const revision = getVersion();
  state = structuredClone(state);
  const found = await projectIn(chosen.folder);
  if (found) {
    if (!await confirmAsk('This folder already holds a project', { detail: 'Open it instead', confirm: 'Open' })) return false;
    await open(await register(chosen, found.project?.name || found.paper?.title || chosen.name));
    return true;
  }
  const name = state.project?.name || state.paper?.title || 'Untitled project';
  const typeId = state.project?.researchType || 'other';
  // A new child folder named for the project, as New project makes; the
  // chosen folder's own files are not filled with a project's layout.
  const child = await initializeProjectFolder(chosen.folder, name, { format: PROJECT_FORMAT, papers: [] });
  const target = chosen.kind === 'path'
    ? { kind: 'path', path: join(chosen.path, child), name: child }
    : { kind: 'handle', handle: await chosen.handle.getDirectoryHandle(child), name: child };
  const f = target.kind === 'path' ? folderAtPath(target.path) : folderFromHandle(target.handle);
  if (inDesktop() && target.kind === 'path') await allowFoldersNative([target.path]).catch(() => {});
  await (await projectFolder.ensure()).createLayout(f, typeId, { name, type: RESEARCH_TYPES.find(t => t.id === typeId)?.label || '', question: state.protocol?.title || '' });
  const copy = { ...(await inlineFigures(exportableState(state))), savedAt: Date.now() };
  copy.papers = await copyPdfsInto(f, copy.papers || [], typeId, { owner });
  // Its figures go to the folder's own figure store, as a save there would put them.
  await externalizeFigures(copy, folderFigureStore(f)).catch(() => {});
  // The copy is portable: connection keys stay on this machine, in the
  // shell's private store under the folder's own identity.
  if (inDesktop() && target.kind === 'path') await writeModelCredentialsNative(f.root, credentialsOf(state)).catch(() => {});
  await f.writeText(FILE, await serializeProject(copy));
  const from = currentId();
  const id = await register(target, name);
  await open(id, { beforeSwitch: () => {
    if (boundary !== projectGeneration() || (live && revision !== getVersion()))
      throw new Error('The project changed while its folder copy was being created. The original remains open; the folder contains the earlier copy. Try again.');
    if (from === LOCAL) setLocalInfo({ movedTo: id });
    else writeList(readList().filter(p => p.id !== from));
  } });
  return true;
}

/**
 * PDFs the app holds as copies (IndexedDB), written into the folder's papers
 * folder and pointed at from their records by relative path. Linked files and
 * files already in a folder are left as they are.
 */
export async function copyPdfsInto(f, papers, typeId = 'other', { owner = recoveryOwner() } = {}) {
  const dir = await (await projectFolder.ensure()).papersDir(f, typeId);
  const out = [];
  for (const p of papers) {
    if (!p.pdf || p.pdfRel || p.pdfMode === 'link') { out.push(p); continue; }
    const blob = await getFile(p.id, { owner, expectedHash: p.pdfHash }).catch(() => null);
    if (!blob) { out.push(p); continue; }
    const rel = await freeName(f, join(dir, String(p.pdfName || `${p.label || p.id}.pdf`).replace(/[/\\:*?"<>|]/g, '-')));
    await f.writeBytes(rel, new Uint8Array(await blob.arrayBuffer()));
    out.push({ ...p, pdfRel: rel, pdfMode: 'folder', pdfName: rel.split('/').pop() });
  }
  return out;
}


// Each extra app-storage project has an independent record and save channel.
// Its connection keys stay in its own record, as the local project's do: the
// shell's credential store is keyed by chosen folders and refuses anything
// else, so asking it here failed every open and every save in the desktop app.
// In the desktop app each save also leaves a backup file named by the id.
//
// A save checks the stored copy's stamp on a small record beside it
// (`meta:<id>`), not by reading the whole project back, which cost as much as
// the write. The project is read only when that record is missing or names
// another stamp, so a record out of step never refuses a save by mistake.
export const appMetaKey = id => `meta:${id}`;
export function appBackend(id) {
  let stamp = 0;
  const key = `project:${id}`, metaKey = appMetaKey(id);
  return {
    channel: `lykos-project:${id}`, credentialId: null, backupName: id,
    // The project as stored, which another window may have saved since this one read it.
    async *referenceTexts() { yield JSON.stringify((await handleOp('readonly', s => s.get(key))) || {}); },
    async read() { const data = await handleOp('readonly', s => s.get(key)); stamp = data?.savedAt || 0; return data || null; },
    async write(state) {
      const db = await handlesDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite'), store = tx.objectStore('handles');
        let stale = false;
        const commit = () => { store.put(state, key); store.put({ savedAt: state.savedAt || 0 }, metaKey); };
        const meta = store.get(metaKey);
        meta.onsuccess = () => {
          if (meta.result && (meta.result.savedAt || 0) === stamp) { commit(); return; }
          const request = store.get(key);
          request.onsuccess = () => {
            if ((request.result?.savedAt || 0) !== stamp) { stale = true; return; }
            commit();
          };
        };
        tx.oncomplete = () => { if (!stale) stamp = state.savedAt; resolve({ stale }); };
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

/**
 * Creates a separate project and switches to it: in the app's storage, or in a
 * new child folder of `chosen` laid out for its research type. A research type
 * chosen here is the one setup starts with; setup still asks for the rest.
 */
export async function createProject({ name, researchType = '', question = '', chosen = null, setupFrom = 0 }) {
  if (!isNone()) {
    await persist();
    if (saveError()) throw new Error(`Save the current project first: ${saveError()}`);
  }
  const seed = seedProject(name);
  if (researchType) seed.project.researchType = researchType;
  // Setup continues from the step after the one already answered (views/start.mjs asks name, question and type).
  if (setupFrom) seed.project.setupFrom = setupFrom;
  if (question) seed.protocol = { title: question, pico: {}, criteria: [] };
  const type = RESEARCH_TYPES.find(t => t.id === researchType);
  let id;
  if (chosen?.kind === 'path') rememberParent(chosen.path);
  if (chosen) {
    const child = await initializeProjectFolder(chosen.folder, name, seed);
    const location = chosen.kind === 'path'
      ? { kind: 'path', path: join(chosen.path, child), name: child }
      : { kind: 'handle', handle: await chosen.handle.getDirectoryHandle(child), name: child };
    const f = location.kind === 'path' ? folderAtPath(location.path) : folderFromHandle(location.handle);
    if (inDesktop() && location.kind === 'path') await allowFoldersNative([location.path]).catch(() => {});
    // Without a type yet, the type's folders are made when setup is finished (views/overview.mjs).
    if (type) await (await projectFolder.ensure()).createLayout(f, type.id, { name, type: type.label });
    id = await register(location, name);
  } else {
    id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await handleOp('readwrite', s => s.put(seed, `project:${id}`));
    remember({ id, kind: 'app', name, type: type?.label || '' });
    import('./storage-keep.mjs').then(m => m.keepStorage()).catch(() => {});
  }
  await open(id);
}

// The folder new project folders were last made in, for the next one (desktop paths only).
const PARENT_KEY = 'lykos.lastParent';
export function rememberParent(path) { try { localStorage.setItem(PARENT_KEY, trimSlash(path)); } catch {} }
/** Where the next project folder goes by default: the last parent used, else the parent of the latest folder project. */
export function lastParent() {
  if (!inDesktop()) return '';
  try { const p = localStorage.getItem(PARENT_KEY); if (p) return p; } catch {}
  const latest = recents().find(p => p.kind === 'path');
  return latest ? trimSlash(latest.path).split('/').slice(0, -1).join('/') : '';
}

/** Name and destination are chosen before creating a separate, empty project. */
/** `name` fills the dialog's name; `onCreate` runs once the person confirmed, before the project opens (opening may reload the window). */
export function newProject({ name = '', onCreate = null } = {}) {
  const last = lastParent();
  // in a browser tab App storage is the default: a folder granted to a tab must be granted again on each visit
  return newProjectDialog({ chooseFolder, canChooseFolder: canOpenFolders(), preferFolder: canOpenFolders() && !inHostedTab(), name, initialParent: last ? { kind: 'path', path: last, folder: folderAtPath(last), name: baseOf(last) } : null,
    create: async ({ name, chosen }) => { if (chosen?.kind === 'path') await allowFoldersNative([chosen.path]).catch(() => {}); try { onCreate?.(name); } catch {} return createProject({ name, chosen }); } });
}

export { chooseFolder };

// ---- managing the list (Settings › Projects) --------------------------------
/**
 * Projects kept in this app's storage, whether listed or not: a project
 * removed from the list, or moved into a folder, is still here until deleted.
 */
export async function storedProjects() {
  const keys = (await handleOp('readonly', s => s.getAllKeys()).catch(() => [])) || [];
  const listed = new Set(readList().map(p => p.id));
  const out = [];
  for (const key of keys.filter(k => String(k).startsWith('project:'))) {
    const data = await handleOp('readonly', s => s.get(key)).catch(() => null);
    const id = String(key).slice('project:'.length);
    out.push({ id, name: data?.project?.name || data?.paper?.title || 'Untitled project', records: data?.papers?.length || 0,
      savedAt: data?.savedAt || 0, listed: listed.has(id) });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** The local project, off the list because it was moved into a folder: what the settings offer to list again. */
export const localMoved = () => !!(localInfo().movedTo || localInfo().hidden);

/** Puts a stored app-storage project back on the list. */
export async function relist(id) {
  if (id === LOCAL) { setLocalInfo({ movedTo: null, hidden: false, blank: false }); return; }
  const data = await handleOp('readonly', s => s.get(`project:${id}`));
  if (!data) throw new Error('That project is no longer stored here');
  remember({ id, kind: 'app', name: data.project?.name || data.paper?.title || 'Untitled project' });
}

/**
 * Renames a project. The open one is renamed through the store; an app-storage
 * project in its record; a desktop folder project in its project file, read
 * first and written only if unchanged since (the folder backend's own rule).
 */
export async function renameProject(id, name, { renameOpen } = {}) {
  const n = String(name || '').trim().slice(0, 160);
  if (!n) throw new Error('Enter a name');
  if (id === currentId()) { renameOpen?.(n); describe(id, { name: n }); return; }
  const entry = switchList().find(p => p.id === id);
  if (!entry) throw new Error('That project is not in the list');
  if (entry.kind === 'app') {
    const key = `project:${id}`;
    const data = await handleOp('readonly', s => s.get(key));
    if (!data) throw new Error('That project is no longer stored here');
    data.project = { ...(data.project || {}), name: n };
    await handleOp('readwrite', s => s.put(data, key));
  } else if (entry.kind === 'path' && inDesktop()) {
    await allowFoldersNative([entry.path]).catch(() => {});
    const b = folderBackend(folderAtPath(entry.path), id);
    const data = await b.read();
    if (!data) throw new Error('That folder holds no project file');
    data.project = { ...(data.project || {}), name: n };
    if ((await b.write(data))?.stale) throw new Error('The project file changed while renaming; try again');
  } else throw new Error('Open this project to rename it');
  const list = readList(); const e = list.find(p => p.id === id);
  if (e) { e.name = n; writeList(list); }
}

/**
 * Deletes a project kept in the app's storage, after a backup: in the desktop
 * app a JSON file beside the app's data, in a browser a download. A folder
 * project is never deleted here; its folder is the person's.
 */
export async function deleteStoredProject(id) {
  if (id === LOCAL || id === NONE) throw new Error('This project cannot be deleted here');
  if (id === currentId()) throw new Error('Close this project before deleting it');
  const key = `project:${id}`;
  const data = await handleOp('readonly', s => s.get(key));
  if (!data) throw new Error('That project is no longer stored here');
  // The backup stands on its own: the project's figures are written into it.
  const text = JSON.stringify(await inlineFigures(exportableState(data), idbFigureStore(`lykos-project:${id}`)));
  if (inDesktop()) await saveBackupNative(`deleted-${id}`, text);
  else if (!await saveFile(new Blob([text], { type: 'application/json' }), `lykos-${id}-before-delete.json`, 'application/json')) throw new Error('The backup was not saved, so nothing was deleted');
  await handleOp('readwrite', s => { s.delete(appMetaKey(id)); return s.delete(key); });
  writeList(readList().filter(p => p.id !== id));
  // The deleted-<id> copy above holds it now: the copy saves kept beside the app's data goes (plan "Footprint" Task 3).
  if (inDesktop()) await removeAppBackupNative(`${id}.json`).catch(() => {});
}

/** Where a listed project is, for people: its folder path, or the app's storage. */
export const locationOf = p => p.kind === 'path' ? p.path : p.kind === 'handle' ? `${p.name || 'Folder'} (browser folder)` : 'App storage';

// ---- backups and the dashboard (lib/project-backup.mjs, lib/dashboard.mjs) ----
/** A project kept in the app's storage, read without opening it; null when there is none. */
export const readAppProject = id => handleOp('readonly', s => s.get(`project:${id}`)).then(x => x || null);

/**
 * Keeps `data` as a new project in the app's storage and lists it; answers
 * its id. Nothing open is touched: switching to it is the caller's choice.
 */
export async function addAppProject(data, name) {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const at = Date.now();
  await handleOp('readwrite', s => { s.put({ ...data, savedAt: at }, `project:${id}`); s.put({ savedAt: at }, appMetaKey(id)); });
  const list = readList().filter(p => p.id !== id);
  list.push({ id, kind: 'app', name, type: RESEARCH_TYPES.find(t => t.id === data.project?.researchType)?.label || '', openedAt: at });
  writeList(list);
  return id;
}
