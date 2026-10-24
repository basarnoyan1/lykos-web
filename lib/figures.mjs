// Rendered figures, kept beside the project rather than in it (plan §4.15b).
//
// An analysis result used to carry its R-drawn SVGs inline (`a.svg`,
// `a.funnel`, the sensitivity plots): about 2 MB of a 6.1 MB
// project file, serialised again on every save. The project now keeps
// only the numbers, inputs and results; each figure is stored once under the
// SHA-256 of its text and the result names it in `a.figures`:
//
//   { estimate, lo, hi, ..., figures: { svg: '<sha-256>', funnel: '<sha-256>' } }
//
// The name is the hash of the drawing, which is what the result and its render
// options produce, so a reader can check the file it got is the figure the
// result names, a figure is never stored twice, and a stored file is never
// rewritten. Where figures live depends on where the project does:
//   - a folder project: `.lykos/figures/<hash>.svg`, beside project.json;
//   - the app's own storage: the `lykos-figures` IndexedDB database, keyed by
//     the project's save channel and the hash.
// A figure is removed only by clean-up (store.mjs figureCleanup), when nothing
// that can still be opened names it and it is more than an hour old.
//
// Results written by code that still puts the SVG inline keep working: every
// reader goes through figureFor / figureNow / hasFigure, which answer for an
// inline figure and a stored one alike, and the store moves inline figures out
// on the next save (externalizeFigures). A figure that is named but cannot be
// found is not redrawn silently — R would have to run again — so readers get
// null and the view says the result needs a Run.

/** The result fields that hold a drawn figure. */
export const FIGURE_KEYS = ['svg', 'funnel', 'tf_svg', 'cumul_svg', 'baujat_svg', 'contour_svg'];
export const FIGURE_DIR = '.lykos/figures';
const HASH = /^[0-9a-f]{64}$/;
export const isFigureHash = h => typeof h === 'string' && HASH.test(h);

/** The analysis results a project holds: the primary's and each other outcome's. */
export function figureResults(st) {
  const out = [];
  if (st?.analysis && typeof st.analysis === 'object') out.push(st.analysis);
  if (st?.analyses && typeof st.analyses === 'object') for (const a of Object.values(st.analyses)) if (a && typeof a === 'object') out.push(a);
  return out;
}

/** Every figure hash a project names, for backups and checks. */
export function figureRefs(st) {
  const refs = new Set();
  for (const a of figureResults(st)) for (const h of Object.values(a.figures || {})) if (isFigureHash(h)) refs.add(h);
  return [...refs];
}

const enc = new TextEncoder(), dec = new TextDecoder();
/** SHA-256 of the text, as 64 hex digits; null where the runtime has no Web Crypto. */
export async function figureHash(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const d = new Uint8Array(await subtle.digest('SHA-256', enc.encode(String(text))));
  let hex = '';
  for (const b of d) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ---- stores ----------------------------------------------------------------
// A store answers get(hash) → text or null, and put(hash, text). It is not
// trusted to hand back what was put: every read is checked against its hash.

/** Figures in a project folder (lib/fsys.mjs shape), one file per figure. */
export function folderFigureStore(f) {
  const rel = h => `${FIGURE_DIR}/${h}.svg`;
  return {
    kind: 'folder',
    async get(h) {
      const st = await f.stat(rel(h)).catch(() => null);
      if (!st?.exists || st.dir) return null;
      return dec.decode(await f.read(rel(h)));
    },
    // Written even when the file is there (the same bytes): its time is then
    // this write's, so clean-up's grace period covers a figure a save names again.
    async put(h, text) { await f.writeText(rel(h), text); },
    /** Every stored figure: `{ hash, bytes, at }`. */
    async list() {
      const st = await f.stat(FIGURE_DIR).catch(() => null);
      if (!st?.exists) return [];
      return (await f.list(FIGURE_DIR)).filter(e => !e.dir && /^[0-9a-f]{64}\.svg$/.test(e.name))
        .map(e => ({ hash: e.name.slice(0, 64), bytes: e.size || 0, at: e.mtime || null }));
    },
    // Removed to the system Trash, not deleted: one rename, all or nothing,
    // and the person can still take it back. Where the folder has no Trash (a
    // browser folder), figures are not removed at all.
    canRemove: Boolean(f.can?.trash && f.trash),
    remove: h => f.trash(rel(h)),
  };
}

// The app's own storage: a database of its own, so the project database's
// version (and older builds that open it) are untouched.
const FIG_DB = 'lykos-figures';
let figDb = null;
function openFigDb() {
  if (figDb) return figDb;
  const opening = figDb = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(FIG_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('figures');
    req.onsuccess = () => { req.result.onclose = () => { if (figDb === opening) figDb = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { if (figDb === opening) figDb = null; });
  return figDb;
}
const figOp = (mode, fn) => openFigDb().then(d => new Promise((resolve, reject) => {
  const t = d.transaction('figures', mode);
  const r = fn(t.objectStore('figures'));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
}));

/** Figures of the project saved on `owner` (the store's save channel), in IndexedDB. */
export function idbFigureStore(owner) {
  const key = h => `${owner}|${h}`;
  return {
    kind: 'app',
    owner,
    // Kept as { svg, at }: when it was written, for clean-up's grace period.
    // A bare string is a figure from before that; its age is not known.
    get: async h => { const v = await figOp('readonly', s => s.get(key(h))); return typeof v === 'string' ? v : v?.svg ?? null; },
    put: (h, text) => figOp('readwrite', s => s.put({ svg: text, at: Date.now() }, key(h))).then(() => {}),
    async list() {
      const d = await openFigDb();
      return new Promise((resolve, reject) => {
        const t = d.transaction('figures', 'readonly'), st = t.objectStore('figures'), out = [];
        const keys = st.getAllKeys();
        keys.onsuccess = () => {
          for (const k of keys.result.filter(k => String(k).startsWith(`${owner}|`))) {
            const r = st.get(k);
            r.onsuccess = () => { const v = r.result; out.push({ hash: String(k).slice(owner.length + 1), bytes: (typeof v === 'string' ? v : v?.svg || '').length, at: typeof v === 'string' ? null : v?.at ?? null }); };
          }
        };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
      });
    },
    canRemove: true,
    remove: h => figOp('readwrite', s => s.delete(key(h))).then(() => {}),
    /** Gives a figure of unknown age the time now, so a later clean-up can judge it. */
    stamp: h => figOp('readwrite', s => { const r = s.get(key(h)); r.onsuccess = () => { if (typeof r.result === 'string') s.put({ svg: r.result, at: Date.now() }, key(h)); }; }).then(() => {}),
  };
}

/** A store in memory, for tests and for runtimes without storage. */
export function memoryFigureStore() {
  const m = new Map(), times = new Map();
  return { kind: 'memory', map: m, times, get: async h => m.get(h) ?? null, put: async (h, text) => { m.set(h, text); times.set(h, Date.now()); },
    list: async () => [...m].map(([hash, t]) => ({ hash, bytes: t.length, at: times.get(hash) ?? null })),
    canRemove: true, remove: async h => { m.delete(h); times.delete(h); } };
}

// ---- clean-up ----------------------------------------------------------------------
/** Every figure hash named anywhere in a text (a project, a backup, a log): cheap, and it can only keep more. */
export function hashesIn(text, into = new Set()) {
  for (const m of String(text).matchAll(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g)) into.add(m[0]);
  return into;
}
/**
 * Which of `hashes` a text names, added to `into`. A clean-up only asks about
 * the figures actually stored, so a substring test per stored figure replaces a
 * regular-expression pass over the whole text: on a project of 50,000 values
 * the pass held the window for over a second (review of 2026-09-29).
 */
export function namedIn(text, hashes, into = new Set()) {
  const t = String(text);
  for (const h of hashes) if (!into.has(h) && t.includes(h)) into.add(h);
  return into;
}
export const FIGURE_GRACE_MS = 3_600_000;
/**
 * Which stored figures may go: named by nothing in `refs`, and written more
 * than FIGURE_GRACE_MS ago (another window may have just written one it is
 * about to name). A figure whose age is not known is kept.
 */
export function figureGarbage(stored, refs, now = Date.now(), grace = FIGURE_GRACE_MS) {
  const remove = [], young = [], unknown = [];
  let kept = 0;
  for (const f of stored) {
    if (refs.has(f.hash)) { kept++; continue; }
    if (f.at == null) unknown.push(f);
    else if (now - f.at < grace) young.push(f);
    else remove.push(f);
  }
  return { remove, young, unknown, kept, bytes: remove.reduce((n, f) => n + f.bytes, 0) };
}

// ---- the open project's figures ----------------------------------------------
let active = null;
// Figures read or moved out in this window, by hash. Content-addressed, so an
// entry is right for any project; bounded so a long session does not hold
// every figure it ever drew.
const cache = new Map();
const CACHE_MAX = 48;
function remember(h, text) {
  cache.delete(h); cache.set(h, text);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Where the open project's figures are kept (store.mjs sets it with the backend). */
export function useFigureStore(store) { active = store || null; }
export const figureStore = () => active;

/** Whether the result has this figure, inline or stored. */
export const hasFigure = (a, key) => Boolean(a && ((typeof a[key] === 'string' && a[key]) || isFigureHash(a.figures?.[key])));

/** The figure now, without waiting: inline, or stored and already read in this window; else null. */
export function figureNow(a, key) {
  if (!a) return null;
  if (typeof a[key] === 'string' && a[key]) return a[key];
  const h = a.figures?.[key];
  return isFigureHash(h) ? cache.get(h) ?? null : null;
}

/** Reads a stored figure by hash and checks it is the one named; null when missing or altered. */
export async function readFigure(h, store = active) {
  if (!isFigureHash(h)) return null;
  if (cache.has(h)) return cache.get(h);
  if (!store) return null;
  let text = null;
  try { text = await store.get(h); } catch { return null; }
  if (typeof text !== 'string' || await figureHash(text) !== h) return null;
  remember(h, text);
  return text;
}

/**
 * The accessor every reader uses: the figure's SVG text, inline or stored, or
 * null when the result has none or its stored copy cannot be found (the result
 * then needs a Run to draw it again; see figureState).
 */
export async function figureFor(a, key, store = active) {
  const now = figureNow(a, key);
  if (now) return now;
  return readFigure(a?.figures?.[key], store);
}

/** 'none' (not drawn), 'ready' (inline or read), 'stored' (named, not read yet). */
export function figureState(a, key) {
  if (!hasFigure(a, key)) return 'none';
  return figureNow(a, key) ? 'ready' : 'stored';
}

/**
 * Draws a figure with `draw(svg)`: at once when it is at hand, else once it is
 * read. `missing()` runs when the result names a figure that cannot be found.
 * Answers whether the result has the figure at all.
 */
export function withFigure(a, key, draw, missing = () => {}) {
  if (!hasFigure(a, key)) return false;
  const now = figureNow(a, key);
  if (now) { draw(now); return true; }
  figureFor(a, key).then(svg => (svg ? draw(svg) : missing()), () => missing());
  return true;
}

/** The text a figure panel shows in place of a figure that cannot be found. */
export const MISSING_FIGURE = 'Figure not found on this computer. Run the analysis again to draw it.';
/** Puts that text in a figure host (`#id` under `root`), if it is still on screen. */
export function figureMissing(root, id) {
  const host = root?.querySelector?.('#' + id);
  if (host && host.isConnected !== false) host.textContent = MISSING_FIGURE;
}

// ---- moving figures out, and back in ---------------------------------------------

/**
 * Moves every inline figure of the project's results into the store, and puts
 * its hash in the result's `figures`. A figure leaves the result only after
 * the store has taken it; a figure the store refuses stays inline, and so
 * does everything when the runtime cannot hash. Mutates `st`'s results.
 * Answers what moved: `{ moved, bytes }`.
 */
export async function externalizeFigures(st, store = active) {
  let moved = 0, bytes = 0;
  if (!store) return { moved, bytes };
  for (const a of figureResults(st)) {
    for (const key of FIGURE_KEYS) {
      const text = a[key];
      if (typeof text !== 'string' || !text) continue;
      const h = await figureHash(text);
      if (!h) return { moved, bytes };
      try { await store.put(h, text); } catch { continue; }
      remember(h, text);
      // The result may have been given a new drawing while the store wrote.
      if (a[key] !== text) continue;
      a.figures = { ...(a.figures || {}), [key]: h };
      delete a[key];
      moved++; bytes += text.length;
    }
  }
  return { moved, bytes };
}

/**
 * A copy of the project with its stored figures back inline, for a file that
 * has to stand on its own (an export, a backup file, a move into a folder).
 * Results whose figures cannot be found keep the hash. Results are copied;
 * nothing else is.
 */
export async function inlineFigures(st, store = active) {
  // Every result is copied, so moving the copy's figures elsewhere
  // (externalizeFigures into another store) never changes the open project.
  const fill = async a => {
    if (!a?.figures) return { ...a };
    const copy = { ...a }, left = {};
    for (const [key, h] of Object.entries(a.figures)) {
      const text = typeof copy[key] === 'string' && copy[key] ? copy[key] : await readFigure(h, store);
      if (text) copy[key] = text; else left[key] = h;
    }
    if (Object.keys(left).length) copy.figures = left; else delete copy.figures;
    return copy;
  };
  const out = { ...st };
  if (st.analysis && typeof st.analysis === 'object') out.analysis = await fill(st.analysis);
  if (st.analyses && typeof st.analyses === 'object') {
    out.analyses = {};
    for (const [k, a] of Object.entries(st.analyses)) out.analyses[k] = a && typeof a === 'object' ? await fill(a) : a;
  }
  return out;
}

/** For tests: forget what this window has read. */
export const clearFigureCache = () => cache.clear();
