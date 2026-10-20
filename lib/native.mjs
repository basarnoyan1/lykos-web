// The Rust side of the desktop app, when there is one.
//
// A browser refuses cross-origin fetches to hosts that send no CORS headers. In the packaged app the Rust process makes
// those requests instead, through one command with a host allowlist; served over http this is the dev server's job and
// its /proxy/ handles it.
export const inDesktop = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
// A browser tab served over https (the hosted build, https://basarnoyan1.github.io/lykos-web/): no shell and no proxy, so only
// hosts that send CORS headers answer, and nothing on this computer does (Zotero's local API, an http page on localhost).
export const inHostedTab = () => !inDesktop() && typeof location !== 'undefined' && location.protocol === 'https:';

export async function fetchTextNative(url) {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('no native shell');
  return invoke('fetch_text', { url });
}


const invoke = (cmd, args, options) => {
  const f = window.__TAURI_INTERNALS__?.invoke;
  if (!f) throw new Error('no native shell');
  return options ? f(cmd, args, options) : f(cmd, args);
};

/**
 * Bytes to the shell as the request body, the text arguments in percent-encoded `Lykos-*` headers (src-tauri main.rs save_file,
 * downloads.rs). Never `{ bytes: Array.from(...) }`: serde reads that as a JSON array of numbers, several times the file in text
 * and in arrays in the WebView (the shell's read_file comment has the measurement). test/native-bytes.test.mjs holds the rule.
 */
export const invokeBytes = (cmd, bytes, headers = {}) => invoke(cmd, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [`Lykos-${k}`, encodeURIComponent(String(v))])),
});

/** A folder chosen with the system dialog; null when cancelled. */
export const pickFolderNative = () => invoke('pick_folder');
/** PDFs in a chosen folder: `[{ path, size }]`. */
export const listPdfsNative = async dir => (await invoke('list_pdfs', { dir })).map(([path, size]) => ({ path, size }));
/** Bytes of a file inside a chosen folder. */
export const readFileNative = async path => new Uint8Array(await invoke('read_file', { path }));
export const chosenFoldersNative = () => invoke('chosen_folders');
export const forgetFolderNative = dir => invoke('forget_folder', { dir });
/**
 * Entries of a folder inside a chosen root: `[{ name, path, is_dir, size }]`,
 * hidden entries left out. The explorer's list_dir answers every entry as
 * (name, is_dir, size, modified); this shapes it for the assistant's tools.
 */
export const listDirNative = async dir => (await invoke('list_dir', { dir }))
  .filter(([name]) => !name.startsWith('.'))
  .map(([name, is_dir, size]) => ({ name, path: `${dir.replace(/\/$/, '')}/${name}`, is_dir, size }));
/** A web address in the system browser. */
export const openUrlNative = url => invoke('open_url', { url });

// ---- Opening links (src-tauri/src/browser.rs; design in docs/handover-2026-10-12/plans/BROWSER.md) ---------------------------
// Every web link the app opens goes through openLink(): in the desktop app into the Lykos browser window, which keeps its own
// session (cookies are the web engine's, never read here), or into the system browser when the person turned that off; in a
// browser tab into a new tab. Nothing is opened except by a person's click or command.

export const browserOpenNative = url => invoke('open_browser', { url });
export const browserClearDataNative = () => invoke('browser_clear_data');
/** `{ available, open, url }`: whether the Lykos browser can open on this system, whether its window is showing, and its page. */
export const browserStateNative = () => invoke('browser_state');

const LOOPBACK = /^(localhost|.*\.localhost|::1|127\..*|0\.0\.0\.0)$/;
/** The address of a web link, or null: http or https with a host. A file:, javascript:, data: or mailto: address is never a web link. */
export function webUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 4096) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
}

/** Whether the Lykos browser takes the address (the shell checks the same): not this computer, no user name or password in it. */
export function inAppUrl(raw) {
  const href = webUrl(raw);
  if (!href) return false;
  const url = new URL(href);
  return !LOOPBACK.test(url.hostname.replace(/^\[|\]$/g, '').toLowerCase()) && !url.username && !url.password;
}

/** A DOI as a web address (https://doi.org/<doi>); accepts a bare DOI, "doi:10.…" and a doi.org link. Null when it is not a DOI. */
export function doiUrl(raw) {
  let doi = String(raw ?? '').trim().replace(/^doi:\s*/i, '');
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(doi)) {
    try { doi = decodeURIComponent(new URL(doi).pathname.slice(1)); } catch { return null; }
  }
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return null;
  return `https://doi.org/${encodeURI(doi).replace(/[#?]/g, c => (c === '#' ? '%23' : '%3F'))}`;
}

const OPEN_IN_APP = 'lykos.openLinksInApp';
/** Whether links open in the Lykos browser (the default in the desktop app); a per-computer choice, kept like the theme. */
export function openLinksInApp() {
  try { return localStorage.getItem(OPEN_IN_APP) !== 'off'; } catch { return true; }
}
export function setOpenLinksInApp(on) {
  try { localStorage.setItem(OPEN_IN_APP, on ? 'on' : 'off'); } catch { /* the choice is not kept; the default applies */ }
}

/**
 * The one place a web link is opened from. Resolves to where it went: 'app' (the Lykos browser), 'system' (the system browser, also for an address on this computer) or
 * 'tab' (a new browser tab, the web build). `system: true` asks for the system browser. When the Lykos browser cannot open (macOS
 * older than 14) the link goes to the system browser rather than nowhere.
 */
export async function openLink(raw, { system = false } = {}) {
  const url = webUrl(raw);
  if (!url) throw new Error('only web addresses are opened');
  if (!inDesktop()) { window.open(url, '_blank', 'noopener,noreferrer'); return 'tab'; }
  if (!system && openLinksInApp() && inAppUrl(url)) {
    try { await browserOpenNative(url); return 'app'; }
    catch (error) { console.warn('[browser]', String(error)); }
  }
  await openUrlNative(url);
  return 'system';
}

/**
 * What a click on a web link does in the desktop app, given the event and the anchor it hit: `{ href, system }` when the app takes
 * it over, null when the browser's own behaviour stands (not a primary click, already handled, no http(s) address, a download link).
 * A modifier key asks for the system browser, as it asks a browser for another tab. In the web build every link keeps its default.
 */
export function linkClick(event, link) {
  if (!link || event.defaultPrevented || (event.button ?? 0) !== 0) return null;
  const attr = link.getAttribute?.('href');
  if (!attr || link.hasAttribute?.('download')) return null;
  const href = webUrl(typeof link.href === 'string' ? link.href : attr);
  if (!href) return null;
  return { href, system: !!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) };
}

/** Routes the document's web links through openLink in the desktop app; one delegated listener, so no view needs to change. */
export function installLinkRouting(doc = document, { desktop = inDesktop, open = openLink } = {}) {
  if (!desktop()) return false;
  doc.addEventListener('click', event => {
    const hit = linkClick(event, event.target?.closest?.('a[href]'));
    if (!hit) return;
    // Not every http(s) address is one the shell opens (a link to this computer): leave the default off so the window never navigates away.
    event.preventDefault();
    open(hit.href, { system: hit.system }).catch(error => console.warn('[open]', String(error)));
  });
  return true;
}

/** A model-endpoint request made by the shell; returns { status, text }. */
export const aiRequestNative = (requestId, url, { method = 'GET', headers = {}, body = null } = {}) =>
  invoke('ai_request', { requestId, url, method, headers: Object.entries(headers), body });
export const readWebNative = (requestId, url) => invoke('read_web_page', { requestId, url });
export const cancelAiRequestNative = requestId => invoke('cancel_ai_request', { requestId });
/** Restores folders the person chose before and has not forgotten; the shell ignores any other path (src-tauri main.rs allow_folders). */
export const allowFoldersNative = dirs => invoke('allow_folders', { dirs });
export const cancelPaperRetrievalNative = requestId => invoke('cancel_paper_retrieval', { requestId });
export const retrievePaperNative = paper => invoke('retrieve_paper', { paper });
/** Asks where, then writes the bytes (a Uint8Array or ArrayBuffer): the chosen path, or null when cancelled. */
export const saveFileNative = (name, bytes) => invokeBytes('save_file', bytes, { Name: name });
/** A file inside a chosen folder, shown in the Finder or opened with the application the system assigns to it (absolute paths). */
export const revealPathNative = path => invoke('reveal_path', { path });
export const openPathNative = path => invoke('open_path', { path });
export const readModelCredentialsNative = project => invoke('read_model_credentials', { project });
export const writeModelCredentialsNative = (project, credentials) =>
  invoke('write_model_credentials', { project, credentials });
/** The app-wide settings file in the shell's data directory (src-tauri/src/app_settings.rs). */
export const readAppSettingsNative = () => invoke('read_app_settings');
export const writeAppSettingsNative = settings => invoke('write_app_settings', { settings });
export const saveBackupNative = (name, text) => invoke('save_backup', { name, text });
/** A protocol waiting in the app's inbox, read once; null when there is none. */
export const takeInboxNative = () => invoke('take_inbox');

export const testPaperMirrorNative = url => invoke('test_paper_mirror', { url });

export const pickDownloadFolderNative = () => invoke('pick_download_folder');
export const savePdfToFolderNative = (dir, name, bytes) => invokeBytes('save_pdf_to_folder', bytes, { Dir: dir, Name: name });

export const unpaywallEmailNative = () => invoke('unpaywall_email');
export const setUnpaywallEmailNative = email => invoke('set_unpaywall_email', { email });

export const libraryRecoveryNative = () => invoke('library_recovery');

export const libraryAuditNative = () => invoke('library_audit');
/** What the app keeps on this machine, in bytes (Settings > Storage): `{ app_data, backups, cache, web, indexed_db: [[folder, bytes]], capped }`. */
export const storageSizesNative = () => invoke('storage_sizes');
/** The app's own backups: `[[name, bytes, modified ms]]`; one removed by name; the paper download tool removed (src-tauri/src/storage.rs). */
export const appBackupsNative = () => invoke('app_backups');
export const removeAppBackupNative = name => invoke('remove_app_backup', { name });
export const removePaperToolNative = () => invoke('remove_paper_tool');

// Web of Science / Scopus session window (src-tauri/src/site.rs). The page
// actions are a fixed list evaluated by the shell; the site cannot call back.
export const siteOpenNative = (site, navigate = true) => invoke('site_open', { site, navigate });
export const sitePageNative = (action, args = {}) => invoke('site_eval', { action, args });
export const siteDownloadsNative = () => invoke('site_downloads');
export const siteTakeDownloadNative = id => invoke('site_take_download', { id });

// ChatGPT secrets never cross IPC. These commands return metadata or model output.
export const chatGptAccountsNative = () => invoke('chatgpt_accounts');
export const chatGptSigninNative = profile => invoke('chatgpt_signin', { profile });
export const chatGptCancelSigninNative = () => invoke('chatgpt_cancel_signin');
export const chatGptSignoutNative = profile => invoke('chatgpt_signout', { profile });
export const chatGptRequestNative = (profile, requestId, body = null) => invoke('chatgpt_request', { profile, requestId, body });
