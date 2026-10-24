// Safety copies of a project kept in a browser tab's storage (the hosted site, or app storage outside the desktop app): one compressed
// copy a day, the day's first, in their own IndexedDB database, trimmed by the folder rule (lib/backup-rule.mjs: 7 days, then a copy a
// week for 8 weeks, then a copy a month). store.mjs runBackup writes them; Settings > Storage lists and downloads them, and Restore
// backup… on the start page reads a downloaded copy back (.json.gz).
//
// They live in the same browser as the project, so they guard against a bad edit or a damaged save, not against the browser clearing
// the site's storage: only a file outside the browser does that (Export project…, and the reminder `exportDue` drives).
import { keepBackups } from './backup-rule.mjs';
import { gzipText } from './gzip.mjs';

const DB = 'lykos-backups', STORE = 'copies';
let dbP = null;
const db = () => dbP || (dbP = new Promise((ok, no) => {
  const q = indexedDB.open(DB, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
  q.onsuccess = () => ok(q.result); q.onerror = () => { dbP = null; no(q.error); };
}));
const op = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => {
  const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error);
}); };
const prefix = name => `${name}/`;
export const copyName = day => `project-${day}.json.gz`;

/** Whether this browser can keep them (IndexedDB and gzip). */
export const canKeepCopies = () => typeof indexedDB !== 'undefined' && typeof CompressionStream !== 'undefined';

/** This project's copies, newest first: `[{ key, file, day, bytes }]`. */
export async function listCopies(name) {
  const keys = (await op('readonly', s => s.getAllKeys())) || [];
  const mine = keys.filter(k => String(k).startsWith(prefix(name)));
  const out = [];
  for (const key of mine) {
    const blob = await op('readonly', s => s.get(key));
    const file = String(key).slice(prefix(name).length), day = /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] || '';
    out.push({ key, file, day, bytes: blob?.size || 0 });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}
/** The stored copy as a Blob (application/gzip), or null. */
export const copyBlob = key => op('readonly', s => s.get(key)).then(b => b || null);

/**
 * Keeps `text` as the project's copy for `day`, unless that day has one (the day's first copy stays, as in a folder), then drops what
 * the rule drops. Answers `{ kept, day }`: kept is false when the day already had its copy.
 */
export async function keepDailyCopy(name, text, day) {
  const key = prefix(name) + copyName(day);
  const have = await op('readonly', s => s.getKey(key));
  if (have === undefined) {
    const blob = await gzipText(text);
    await op('readwrite', s => s.put(blob, key));
  }
  const files = (await listCopies(name)).map(c => c.file);
  const { drop } = keepBackups(files, day);
  if (drop.length) await op('readwrite', s => { for (const f of drop) s.delete(prefix(name) + f); });
  return { kept: have === undefined, day };
}

// ---- the reminder to keep a copy outside the browser -----------------------------------------------------------------------------
// When this project was last exported (Export project…), per browser: a convenience of this viewer, not project data.
const EXPORT_KEY = id => `lykos.lastExport.${id}`;
export const EXPORT_AFTER_DAYS = 7;
export function noteExport(id, at = new Date().toISOString()) { try { localStorage.setItem(EXPORT_KEY(id), at); } catch {} }
export function lastExport(id) { try { return localStorage.getItem(EXPORT_KEY(id)) || ''; } catch { return ''; } }
/** Whether a project made `createdAt` and last exported `exported` (ISO, or '') is due a copy outside the browser on `now`. */
export function exportDue({ exported = '', createdAt = '', now = Date.now() } = {}) {
  const since = Date.parse(exported || createdAt || '');
  return Number.isFinite(since) ? now - since > EXPORT_AFTER_DAYS * 864e5 : false;
}
