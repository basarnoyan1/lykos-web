// What Lykos keeps on this machine, row by row, for Settings > Storage: measured when that page is opened (never at start, never on a
// timer), and the caches it may clear. A cache is something the app makes again by itself; project data and backups are never cleared
// here.
//
//   project    projects kept in the app, attached copies, recognised text      measured (desktop: the database folders on disk)
//   backups    one safety copy per project (desktop)                           the folder on disk
//   previews   page text of opened PDFs (lib/files.mjs), under the limit       its ledger
//   fulltext   the full-text search index (lib/fulltext-index.mjs)             its entries
//   packages   R packages for analyses (lib/rengine.mjs)                       sizes from vendor.lock.json
//   models     model lists and prices (lib/ai.mjs)                             local storage
//   orphans    app backups of projects no longer kept here (desktop)          app_backups, by the rule orphanBackups
//   paperbot   the paper download tool's Python environment (desktop)          its folder; Remove, reinstalled by paperbot:setup
//   folderBackups  the open folder project's .lykos/backups, read only         its listing
//   folderCache    the open folder project's .lykos/cache (MCP text, tables)    its listing; Clear
//   other      the web view's HTTP cache, overhead                             the rest of the folders on disk (desktop)
import { appUrl } from './app-url.mjs';
import { inDesktop, storageSizesNative, appBackupsNative, removeAppBackupNative, removePaperToolNative } from './native.mjs';

export const CLEARABLE = ['previews', 'fulltext', 'packages', 'models', 'folderCache'];
/** Kept things that are not caches but may go when the person says so: their own confirmation names what is lost. */
export const REMOVABLE = ['orphans', 'paperbot'];
const DAY = 864e5;

/**
 * The app's backups that belong to no project kept here (plan "Footprint" Task 3). `files` is `[[name, bytes, mtime]]` from the
 * shell; `keptIds` the ids of projects stored in the app (listed or not) and of the local project ('local'). A `<id>.json` whose id
 * is not kept is an orphan; a `deleted-<id>.json` written before a delete is kept 30 days, then is one; a `.part` left by a write
 * that stopped is one. Anything else is not the app's and is never listed.
 */
export function orphanBackups(files, keptIds, now = Date.now()) {
  const kept = new Set(keptIds);
  return (files || []).filter(([name, , mtime]) => {
    if (/\.json\.part$/.test(name)) return true;
    const m = /^(deleted-)?([A-Za-z0-9_-]+)\.json$/.exec(name);
    if (!m) return false;
    if (m[1]) return now - Number(mtime || 0) > 30 * DAY;
    return !kept.has(m[2]);
  });
}

/** Ids whose app backup is kept: every project in the app's storage, listed or not, the local one, and every listed one. */
async function keptIds() {
  const projects = await import('./projects.mjs');
  const stored = await projects.storedProjects().catch(() => []);
  return ['local', ...stored.map(p => p.id), ...projects.recents().map(p => p.id)];
}

/** Count and bytes of a folder's directory, two levels down (the open folder project's backups or cache). */
async function folderUsage(f, dir) {
  let bytes = 0, entries = 0;
  const walk = async (rel, depth) => {
    let list; try { list = await f.list(rel); } catch { return; }
    for (const e of list) {
      if (e.dir) { if (depth < 2) await walk(e.rel || `${rel}/${e.name}`, depth + 1); }
      else { bytes += e.size || 0; entries++; }
    }
  };
  await walk(dir, 0);
  return { bytes, entries };
}
const PROJECT_DBS = ['lykos-project', 'lykos-projects', 'lykos-app', 'lykos-figures', 'lykos-files'];

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const lockFile = () => fetch(appUrl('vendor.lock.json')).then(r => (r.ok ? r.json() : null)).catch(() => null);

/** Bytes of the model lists kept in local storage (two bytes a character, as the browser counts them). */
export function modelCatalogBytes(store = globalThis.localStorage) {
  let bytes = 0, entries = 0;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith('lykos.models.')) { bytes += (key.length + (store.getItem(key) || '').length) * 2; entries++; }
    }
  } catch {}
  return { bytes, entries };
}

/**
 * The rows. `{ rows: { [id]: { bytes, entries? } }, total, desktop, capped }`; a row the build cannot measure (backups and other
 * outside the desktop app) is absent.
 */
export async function measureStorage() {
  const [{ docTextUsage }, { fullTextUsage }, { packageCacheUsage }] = await Promise.all([import('./files.mjs'), import('./fulltext-index.mjs'), import('./rengine.mjs')]);
  const native = inDesktop() ? await storageSizesNative().catch(() => null) : null;
  const zero = () => ({ bytes: 0, entries: 0 });
  const [previews, fulltext, packages] = await Promise.all([docTextUsage().catch(zero), fullTextUsage().catch(zero), lockFile().then(lock => packageCacheUsage(lock)).catch(zero)]);
  const models = modelCatalogBytes();
  const rows = { previews, fulltext, packages, models };
  // The open folder project's own .lykos: its backups (read only) and its cache. Outside the app's folders, so added to the total.
  const folder = (await import('./projects.mjs')).activeFolder?.() || null;
  let outside = 0;
  if (folder) {
    rows.folderBackups = await folderUsage(folder, '.lykos/backups');
    if (folder.clearCache) rows.folderCache = await folderUsage(folder, '.lykos/cache');
    outside = rows.folderBackups.bytes + (rows.folderCache?.bytes || 0);
  }
  const caches = previews.bytes + fulltext.bytes + packages.bytes + models.bytes;
  if (native) {
    const onDisk = new Map(native.indexed_db || []);
    let project = 0;
    for (const name of PROJECT_DBS) project += onDisk.get(await sha256Hex(name)) || 0;
    rows.project = { bytes: Math.max(0, project - previews.bytes) };
    const orphans = orphanBackups(await appBackupsNative().catch(() => []), await keptIds());
    const orphanBytes = orphans.reduce((n, [, b]) => n + Number(b || 0), 0);
    rows.backups = { bytes: Math.max(0, (native.backups || 0) - orphanBytes) };
    if (orphans.length) rows.orphans = { bytes: orphanBytes, entries: orphans.length };
    if (native.paperbot) rows.paperbot = { bytes: native.paperbot };
    const total = (native.app_data || 0) + (native.cache || 0) + (native.web || 0);
    const named = caches + rows.project.bytes + (native.backups || 0) + (native.paperbot || 0);
    rows.other = { bytes: Math.max(0, total - named) };
    return { rows, total: Math.max(total, named) + outside, desktop: true, capped: !!native.capped };
  }
  // In a browser the origin's usage is what there is to see; what is not a cache here is the project's.
  const usage = await navigator.storage?.estimate?.().then(e => e.usage || 0).catch(() => 0) || 0;
  rows.project = { bytes: Math.max(0, usage - (caches - models.bytes)) };
  return { rows, total: rows.project.bytes + caches + outside, desktop: false, capped: false };
}

/** Clears one cache; returns what the row holds afterwards (its measured usage). Anything that is not a cache is refused. */
export async function clearCache(id) {
  if (!CLEARABLE.includes(id)) throw new Error(`${id} is not a cache`);
  if (id === 'previews') { const { clearDocText, docTextUsage } = await import('./files.mjs'); await clearDocText(); return docTextUsage(); }
  if (id === 'fulltext') { const { clearFullTextIndex, fullTextUsage } = await import('./fulltext-index.mjs'); await clearFullTextIndex(); return fullTextUsage(); }
  if (id === 'packages') { const { clearPackageCache, packageCacheUsage } = await import('./rengine.mjs'); await clearPackageCache(); return packageCacheUsage(await lockFile()); }
  if (id === 'folderCache') {
    const folder = (await import('./projects.mjs')).activeFolder?.();
    if (!folder?.clearCache) throw new Error('No folder project is open');
    await folder.clearCache(); return folderUsage(folder, '.lykos/cache');
  }
  const { clearModelCatalogs } = await import('./ai.mjs'); clearModelCatalogs(); return modelCatalogBytes();
}

/** Removes what a REMOVABLE row holds, after the person confirmed: the orphan backups (each re-checked by the rule now), or the paper download tool. */
export async function removeStored(id) {
  if (!REMOVABLE.includes(id)) throw new Error(`${id} cannot be removed here`);
  if (!inDesktop()) throw new Error('Only the desktop app keeps this');
  if (id === 'paperbot') { await removePaperToolNative(); return { bytes: 0, entries: 0 }; }
  const orphans = orphanBackups(await appBackupsNative(), await keptIds());
  let failed = 0;
  for (const [name] of orphans) await removeAppBackupNative(name).catch(() => { failed++; });
  if (failed) throw new Error(`${failed} of ${orphans.length} could not be removed`);
  return { bytes: 0, entries: 0 };
}
