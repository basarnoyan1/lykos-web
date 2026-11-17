// How a file in the project folder reached the machine, read natively (src-tauri where_from.rs): the download attributes macOS keeps
// on a file a browser saved, which Finder keeps when the file is moved or copied into the folder, and the line that shows a file's
// provenance where it is listed. Read when a file is attached or shown, not while the shell starts (the format is lib/file-provenance.mjs).
import { lib_native$inDesktop as inDesktop } from "../boot.mjs";
import { lib_file_provenance$fileEntry as fileEntry, lib_file_provenance$normalizeFiles as normalizeFiles, lib_file_provenance$same as same, lib_file_provenance$time as time, lib_file_provenance$relPath as relPath, lib_file_provenance$hashOf as hashOf, lib_file_provenance$plainUrl as plainUrl } from "../boot.mjs";

/** What macOS kept of how each file was downloaded (src-tauri where_from.rs): { urls, downloadedAt, quarantinedAt, agent } or null. */
const whereFromsNative = paths => window.__TAURI_INTERNALS__.invoke('where_froms', { paths });

/** For each path of the folder, the facts its download attributes give, or null (no attributes, not the desktop, or not a folder on disk). */
export async function downloadFactsOf(folder, rels) {
  const none = rels.map(() => null);
  if (!rels.length || !inDesktop() || folder?.kind !== 'path' || typeof folder.abs !== 'function') return none;
  try {
    const rows = await whereFromsNative(rels.map(r => folder.abs(r)));
    return rels.map((_, i) => downloadFacts(rows?.[i]));
  } catch { return none; }
}

/**
 * How a file placed in the folder was obtained: downloaded by hand when macOS kept that (its URL and date), else `fallback` (a file
 * added from the folder: when it was added). The file's modification time joins when the folder gives one.
 */
export async function folderFileFacts(folder, rel, fallback = {}) {
  const [facts] = await downloadFactsOf(folder, [rel]);
  let fileModified = '';
  try { const st = await folder?.stat?.(rel); if (Number.isFinite(st?.mtime) && st.mtime > 0) fileModified = new Date(st.mtime).toISOString(); } catch { /* no time */ }
  return { ...(facts || fallback), ...(fileModified ? { fileModified } : {}) };
}

/**
 * Fills the blanks of a file's entry from a later look (the download attributes macOS keeps) without changing what is known. Returns
 * whether anything changed.
 */
export function addKnown(paper, key = {}, facts = {}) {
  const files = normalizeFiles(paper?.files);
  if (!files?.length) return false;
  const k = { hash: hashOf(key.hash), path: relPath(key.path) };
  const at = files.findIndex(f => (!key.role || f.role === key.role) && same(f, k));
  if (at < 0) return false;
  const was = files[at], add = fileEntry({ ...facts, role: was.role }), next = { ...was };
  for (const f of ['obtainedAt', 'by', 'fileModified']) if (next[f] == null && add[f] != null) next[f] = add[f];
  // a download macOS recorded says more than "from a folder"; any other kind already known stays
  if (add.from) next.from = { ...add.from, ...(was.from || {}), ...(was.from?.kind === 'folder' && add.from.kind ? { kind: add.from.kind } : {}) };
  const clean = fileEntry(next);
  if (JSON.stringify(clean) === JSON.stringify(was)) return false;
  files[at] = clean;
  paper.files = files;
  return true;
}
/** Whether a look at the file's download attributes could add anything: a file in the folder with no source address and no time. */
export const wantsDownloadFacts = f => Boolean(f?.path && !f.from?.url && !f.obtainedAt);

/**
 * What macOS kept of a hand download (src-tauri where_from.rs) as provenance facts: the file's URL (the first web address) and the time
 * (the download date, else the quarantine time). The application that saved it is not the source and is not kept. Null when nothing.
 */
export function downloadFacts(w) {
  if (!w || typeof w !== 'object') return null;
  const urls = (Array.isArray(w.urls) ? w.urls : []).map(plainUrl).filter(Boolean);
  const at = time(w.downloadedAt) || (Number.isSafeInteger(w.quarantinedAt) && w.quarantinedAt > 0 ? new Date(w.quarantinedAt * 1000).toISOString() : '');
  if (!urls.length && !at) return null;
  return { ...(at ? { obtainedAt: at } : {}), from: { kind: 'manual', ...(urls[0] ? { url: urls[0] } : {}) } };
}

/** The record's files as stored, the article first. */
export const filesOf = p => (normalizeFiles(p?.files) || []).sort((a, b) => (a.role === 'article' ? 0 : 1) - (b.role === 'article' ? 0 : 1));

const KIND_WORDS = { retrieval: 'Retrieved', 'open-access': 'Open access copy', institution: 'Through the institution', manual: 'Added by hand', folder: 'Found in the folder' };
const ROLE_WORDS = { article: 'Article', supplement: 'Supplement', protocol: 'Protocol', registry: 'Registry entry', erratum: 'Erratum' };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * One line for where a file is listed: "Retrieved from Unpaywall, 3 Nov; file changed 5 Nov". `day` formats a time (lib/dates.mjs).
 * "Source not recorded" when nothing is known.
 */
export function provenanceLine(f, day, { role = false } = {}) {
  if (!f) return '';
  // lib/paper-download.mjs names the open-access copy's provider "Open access (Unpaywall)"; the kind already says open access
  const src = String(f.from?.provider || '').replace(/^open access \((.+)\)$/i, '$1') || host(f.from?.url || '');
  const word = f.from?.kind === 'manual' && f.from?.url ? 'Downloaded' : KIND_WORDS[f.from?.kind] || (src ? 'Obtained' : '');
  const how = [word, src && `from ${src}`].filter(Boolean).join(' ');
  const head = [how, f.obtainedAt ? day(f.obtainedAt) : ''].filter(Boolean).join(', ') || 'Source not recorded';
  const line = [head, f.fileModified ? `file changed ${day(f.fileModified)}` : ''].filter(Boolean).join('; ');
  return role ? `${ROLE_WORDS[f.role] || f.role}: ${line}` : line;
}
