// A watched import folder (plan B3). While a folder project is open, one of
// its folders — the search folder unless the person picks another — is
// listed every WATCH_MS. A search export that appears there is offered for
// import; nothing is imported without the person's say. The folder is read
// one level deep, so the raw copies Lykos keeps under it ("Raw imports/")
// are not offered back.
//
// Files present when watching begins are the baseline and are not offered:
// they are what the folder already held (an export the folder set-up read, a
// file the person keeps for reference). A file is known by its name, size and
// modified time; an offered file ignored stays ignored until it changes.
import { get, update } from '../store.mjs';
import { notify } from './notifications.mjs';

export const WATCH_MS = 15000;
export const WATCH_EXT = /\.(ris|nbib|enw|bib|bibtex|csv|tsv|txt|xml)$/i;
const MEDLINE_TXT = /(pubmed|medline|scopus|wos|web[\s_-]?of[\s_-]?science|embase|cinahl|records?|export|citations?)/i;

/** Whether a file name reads as a search export: RIS, NBIB, BibTeX, CSV/TSV, XML, or a .txt named as one. */
export const isExportName = name => WATCH_EXT.test(name) && !/^[.~]/.test(name) && (!/\.txt$/i.test(name) || MEDLINE_TXT.test(name));
export const stampOf = e => `${e.size}:${e.mtime}`;

/**
 * What a listing adds to the watch state (pure): `{ offers, seen }`. `watch`
 * is `{ dir, seen: {name: stamp}, ignored: {name: stamp}, baseline }`;
 * `imported` holds file names already imported from this folder.
 */
export function newExports(entries, watch = {}, imported = new Set()) {
  const seen = { ...(watch.seen || {}) }, offers = [];
  for (const e of entries) {
    if (e.dir || !isExportName(e.name)) continue;
    const stamp = stampOf(e);
    if (seen[e.name] === stamp) continue;
    seen[e.name] = stamp;
    if (!watch.baseline) continue;                           // first listing: what was already there
    if (watch.ignored?.[e.name] === stamp) continue;
    if (imported.has(`${watch.dir}/${e.name}`)) continue;
    offers.push({ name: e.name, rel: `${watch.dir}/${e.name}`, size: e.size, mtime: e.mtime, stamp });
  }
  return { offers, seen };
}

// ---- the poll ---------------------------------------------------------------
let timer = null, folderRef = null, busy = false;
let offered = [];                 // offers on show this session
const listeners = new Set();
export const offers = () => offered.slice();
export const onOffers = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const l of [...listeners]) l(offered); };

/** The folder watched in this project, or null when watching is off or there is no project folder. */
export const watchState = (s = get()) => s.importWatch || null;

/**
 * Starts (or keeps) the poll for the open folder. `defaultDir` is the search
 * folder the project's layout names; it is used the first time only.
 */
export function ensureWatch(folder, defaultDir) {
  if (!folder) { stopWatch(); return; }
  if (folderRef === folder && timer) return;
  stopWatch();
  folderRef = folder;
  const s = get();
  if (!s.importWatch && defaultDir) update(st => { st.importWatch = { dir: defaultDir, on: true, seen: {}, ignored: {}, baseline: false }; return st; });
  timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) poll().catch(() => {}); }, WATCH_MS);
  poll().catch(() => {});
}

export function stopWatch() { clearInterval(timer); timer = null; folderRef = null; offered = []; changed(); }

/** Lists the watched folder once; new exports are offered and announced. */
export async function poll() {
  if (busy || !folderRef) return;
  const w = watchState();
  if (!w?.on || !w.dir) return;
  busy = true;
  try {
    const st = await folderRef.stat(w.dir);
    if (!st.exists || !st.dir) return;
    const entries = await folderRef.list(w.dir);
    const imported = new Set((get().searches || []).map(e => e.file).filter(Boolean));
    const { offers: fresh, seen } = newExports(entries, w, imported);
    const same = JSON.stringify(seen) === JSON.stringify(w.seen || {}) && w.baseline;
    if (!same) update(s => { s.importWatch = { ...s.importWatch, seen, baseline: true }; return s; });
    if (fresh.length) {
      offered = [...offered.filter(o => !fresh.some(f => f.name === o.name)), ...fresh];
      update(s => { for (const f of fresh) notify(s, { id: `watch-${f.rel}-${f.stamp}`, title: `New search export: ${f.name}`, detail: `In ${w.dir}`, view: 'library' }); return s; });
      changed();
    }
  } finally { busy = false; }
}

/** An offer taken or set aside. Ignoring is remembered for that version of the file. */
export function settle(name, { ignore = false } = {}) {
  const o = offered.find(x => x.name === name);
  offered = offered.filter(x => x.name !== name);
  if (ignore && o) update(s => { s.importWatch = { ...s.importWatch, ignored: { ...(s.importWatch?.ignored || {}), [o.name]: o.stamp } }; return s; });
  changed();
  return o;
}

/** Watch another folder (a new baseline is taken there), or stop watching. */
export function setWatchDir(dir) {
  offered = []; changed();
  update(s => { s.importWatch = dir ? { dir, on: true, seen: {}, ignored: {}, baseline: false } : { ...(s.importWatch || {}), on: false }; return s; });
  if (dir) poll().catch(() => {});
}
