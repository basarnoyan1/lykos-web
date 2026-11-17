// Shell commands that only views loaded on first use call (Settings › Storage, institutional access, the Web of Science and Scopus
// window): kept out of lib/native.mjs, which the shell loads at start (app/test/startup-graph.test.mjs, 15 November 2026).
import { lib_native$invoke as invoke } from "../boot.mjs";

/** The PDF the Lykos browser saved last, by the id of its `browser-pdf` event; once. */
export const browserTakePdfNative = id => invoke('browser_take_pdf', { id });
/** Calls `fn({ id, name, url, page, at })` when the Lykos browser has saved a PDF to Downloads: the file's address, the page it was on and when (RFC 3339). */
export function onBrowserPdf(fn) {
  const t = typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : null;
  if (!t?.transformCallback) return;
  const handler = t.transformCallback(ev => fn(ev?.payload || {}));
  t.invoke('plugin:event|listen', { event: 'browser-pdf', target: { kind: 'Any' }, handler }).catch(err => console.warn('[browser]', err));
}

/** What the app keeps on this machine, in bytes (Settings > Storage): `{ app_data, backups, cache, web, indexed_db: [[folder, bytes]], capped }`. */
export const storageSizesNative = () => invoke('storage_sizes');
/** The app's own backups: `[[name, bytes, modified ms]]`; the paper download tool removed (src-tauri/src/storage.rs). */
export const appBackupsNative = () => invoke('app_backups');
export const removePaperToolNative = () => invoke('remove_paper_tool');
/** Whether a chosen folder sits under a sync client (src-tauri/src/sync_root.rs): `{ client, root, how, running, paused }` or null. */
export const syncFolderNative = dir => invoke('sync_folder', { dir });

// Web of Science / Scopus session window (src-tauri/src/site.rs): a fixed list
// of page actions, evaluated by the shell; the site cannot call back.
export const siteOpenNative = (site, navigate = true, show = true, to = null) => invoke('site_open', { site, navigate, show, to });
export const sitePageNative = (action, args = {}) => invoke('site_eval', { action, args });
export const siteDownloadsNative = () => invoke('site_downloads');
export const siteTakeDownloadNative = id => invoke('site_take_download', { id });
