// Back up a project to one .lykos.zip and restore one as a new project in the
// app's storage (lib/backup.mjs holds the format and the checks). Amendment
// "Workspace: backup, dashboard, tasks, timeline and translation".
//
// What a backup holds: the project with its figures written in and without
// connection keys, and every stored file it names — PDF copies, manuscript
// images and assets, kept raw imports — plus a folder project's PDFs read from
// its folder, and the two figure documents (`.lykos/figure-registry.json`, the
// decisions on figure checks, and `figure-style.json`) when the project has them.
// A PDF linked where it lies on disk is included when it can be
// read now; one that cannot (a moved file, a folder not granted) is counted
// and said. A restore never replaces a project: it adds a new one in the
// app's storage, and opening it is a separate, confirmed step.
import { persist, saveError, get, exportableState, normalizeProject, portableState, assertProject } from '../store.mjs';
import { textOf } from './gzip.mjs';
import { inlineFigures, idbFigureStore, folderFigureStore } from './figures.mjs';
import { listFiles, getFile, putFile, getBytes } from './files.mjs';
import { saveFile } from './save.mjs';
import { inDesktop, allowFoldersNative } from './native.mjs';
import { folderAtPath } from './fsys.mjs';
import * as projects from './projects.mjs';
import { sidecarTexts, restoreSidecars } from './figure-sidecar.mjs';
import { buildBackup, readBackup, projectFileKeys, backupName, sha256, BACKUP_SUFFIX } from './backup.mjs';

/** The app's version for the manifest: the desktop shell says; a browser build has none to give. */
async function appInfo() {
  if (inDesktop()) {
    try { return { version: String(await window.__TAURI_INTERNALS__.invoke('plugin:app|version')), shell: 'desktop' }; } catch {}
  }
  return { version: '', shell: 'browser' };
}

const LOCAL_DB = 'lykos-project';
/** The local project as stored, read without opening it. */
export function readLocalProject() {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open(LOCAL_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onerror = () => resolve(null);
      r.onsuccess = () => {
        try {
          const t = r.result.transaction('state', 'readonly'), q = t.objectStore('state').get('project');
          q.onsuccess = () => { resolve(q.result || null); r.result.close(); };
          q.onerror = () => { resolve(null); r.result.close(); };
        } catch { resolve(null); r.result.close(); }
      };
    } catch { resolve(null); }
  });
}

/**
 * The files to put beside a project: stored copies the project names, and the
 * PDFs a folder project keeps in its folder. `readRel` reads a folder file;
 * `readLinked` reads a linked PDF (the open project only). Answers
 * `{ files, skipped }`.
 */
async function filesFor(state, { readRel = null, readLinked = null } = {}) {
  const files = [], taken = new Set();
  let skipped = 0;
  const keys = await listFiles().catch(() => []);
  for (const key of projectFileKeys(state, keys)) {
    const blob = await getFile(key).catch(() => null);
    if (blob) { files.push({ key, data: blob, type: blob.type || '' }); taken.add(key); }
  }
  for (const p of state.papers || []) {
    if (!p?.pdf || taken.has(p.id)) continue;
    let bytes = null;
    if (p.pdfRel && readRel) bytes = await readRel(p.pdfRel).catch(() => null);
    else if (readLinked) bytes = await readLinked(p.id).catch(() => null);
    if (bytes?.length) { files.push({ key: p.id, data: bytes, type: 'application/pdf' }); taken.add(p.id); }
    else skipped++;
  }
  return { files, skipped };
}

async function write(state, extra, sidecars = []) {
  const { files, skipped } = await filesFor(state, extra);
  const { blob, manifest } = await buildBackup({ state, files, sidecars, app: await appInfo() });
  const name = backupName(state.project?.name || state.paper?.title);
  const saved = await saveFile(blob, name, 'application/zip');
  // a tab's reminder to keep a copy outside the browser counts from here (lib/browser-backups.mjs)
  if (saved != null && saved !== false && !inDesktop()) (await import('./browser-backups.mjs')).noteExport(projects.currentId());
  return { saved: saved != null && saved !== false, name, files: files.length, sidecars: sidecars.length, skipped, bytes: blob.size, manifest };
}

/** Backs up the open project; answers what was written. */
export async function backupOpenProject() {
  await persist();
  if (saveError()) throw new Error(`Save the project first: ${saveError()}`);
  const state = await inlineFigures(exportableState(get()));
  const folder = projects.activeFolder();
  return write(state, { readRel: folder ? rel => folder.read(rel) : null, readLinked: folder ? null : id => getBytes(id) }, await sidecarTexts());
}

/**
 * Backs up a listed project without opening it: one in the app's storage, the
 * local project, or (in the desktop app) a folder by its path. A browser
 * folder needs its permission granted by opening it.
 */
export async function backupListedProject(id) {
  if (id === projects.currentId() && !projects.isNone()) return backupOpenProject();
  const entry = projects.switchList().find(p => p.id === id);
  if (!entry) throw new Error('That project is not in the list');
  if (entry.kind === 'app' || entry.kind === 'local') {
    const data = entry.kind === 'app' ? await projects.readAppProject(id) : await readLocalProject();
    if (!data) throw new Error('That project is no longer stored here');
    const channel = entry.kind === 'app' ? projects.appBackend(id).channel : 'lykos-project';
    const state = await inlineFigures(exportableState(data), idbFigureStore(channel));
    return write(state, {}, await sidecarTexts({ folder: null, owner: channel }));
  }
  if (entry.kind === 'path' && inDesktop()) {
    await allowFoldersNative([entry.path]).catch(() => {});
    const f = folderAtPath(entry.path);
    const b = projects.folderBackend(f, id);
    const data = await b.read();
    if (!data) throw new Error('That folder holds no project file');
    const state = await inlineFigures(exportableState(data), folderFigureStore(f));
    return write(state, { readRel: rel => f.read(rel) }, await sidecarTexts({ folder: f, owner: b.channel }));
  }
  throw new Error('Open this project to back it up');
}

/**
 * Restores a backup file as a new project in the app's storage, after every
 * check in readBackup. Stored files go back under their keys; a key already
 * holding different bytes (another project's file of the same name) is left
 * as it is and counted, and its paper is not marked as having a PDF. The figure documents go back into the app's storage
 * for the new project. Answers `{ id, name, files, kept, manifest, sidecars, decisions }`:
 * `decisions` is what the restored figure registry holds (`{}` when the backup had none).
 */
export async function restoreBackupFile(file) {
  const { manifest, state, files, sidecars } = await readAnyBackup(file);
  const data = normalizeProject(portableState(state), { source: 'The backup' });
  delete data.saveToken;
  let kept = 0;
  const stored = new Set();   // keys whose backed-up bytes are what the store holds now
  for (const f of files) {
    const existing = await getFile(f.key).catch(() => null);
    if (existing) {
      if (await sha256(new Uint8Array(await existing.arrayBuffer())) !== await sha256(f.bytes)) { kept++; continue; }
      stored.add(f.key); continue;
    }
    await putFile(f.key, new Blob([f.bytes], { type: f.type || 'application/octet-stream' }));
    stored.add(f.key);
  }
  // A paper is marked as having its PDF only when the store holds the backup's bytes; a differing file of the same key
  // belongs to another project, and pointing this paper at it would show the wrong PDF.
  data.papers = (data.papers || []).map(p => {
    if (!files.some(f => f.key === p.id)) return p;
    if (!stored.has(p.id)) { const none = { ...p, pdf: null }; delete none.pdfRel; if (none.pdfMode === 'link' || none.pdfMode === 'folder') delete none.pdfMode; return none; }
    const copy = { ...p, pdf: true };
    delete copy.pdfRel;
    if (copy.pdfMode === 'link' || copy.pdfMode === 'folder') delete copy.pdfMode;
    return copy;
  });
  const base = String(manifest.project?.name || data.project?.name || data.paper?.title || 'Restored project').trim();
  const name = `${base} (restored ${new Date().toISOString().slice(0, 10)})`.slice(0, 160);
  data.project = { ...(data.project || {}), name };
  const id = await projects.addAppProject(data, name);
  const figureDocs = await restoreSidecars(sidecars, projects.appBackend(id).channel);
  return { id, name, files: files.length, kept, manifest, sidecars: figureDocs.names, decisions: figureDocs.decisions };
}

/**
 * A `.lykos.zip` through readBackup, or a folder's daily copy (`.lykos/backups/project-<day>.json`, or `.json.gz` since this
 * version): the project alone, with no stored files. A gzip that does not inflate, or a copy that is not a project, is refused
 * with the reason, never read as an empty project.
 */
async function readAnyBackup(file) {
  const bytes = file instanceof Uint8Array ? file : file instanceof ArrayBuffer ? new Uint8Array(file) : new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readBackup(bytes);
  let state;
  try { state = JSON.parse(await textOf(bytes)); }
  catch (err) { throw new Error(`This file cannot be restored: ${/compressed/.test(err?.message) ? err.message : 'it is neither a Lykos backup nor a project copy'}`); }
  assertProject(state, { source: 'This copy' });
  return { manifest: { project: { name: state.project?.name || state.paper?.title || '', records: (state.papers || []).length } }, state, files: [], sidecars: [] };
}

/** Asks for a backup file; answers the File or null. */
export function pickBackupFile() {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = `.zip,${BACKUP_SUFFIX},.json,.gz`; i.hidden = true;
    document.body.append(i);
    i.addEventListener('cancel', () => { i.remove(); resolve(null); }, { once: true });
    i.onchange = () => { const f = i.files?.[0] || null; i.remove(); resolve(f); };
    i.click();
  });
}

/** One line for the status bar or a dialog, from backupOpenProject's answer. */
export const backupReport = r => !r.saved ? 'Backup not saved'
  : `Backed up to ${r.name}: the project and ${r.files} ${r.files === 1 ? 'file' : 'files'}${r.skipped ? `; ${r.skipped} linked ${r.skipped === 1 ? 'PDF' : 'PDFs'} could not be read and ${r.skipped === 1 ? 'is' : 'are'} not included` : ''}`;
