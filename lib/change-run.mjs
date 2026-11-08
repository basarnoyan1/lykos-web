// The change syntheses made off the page's thread (lib/change-worker.mjs): the Syntheses page asks for the list, or for the effects a figure
// draws, and has them at once when they were made for the project's inputs (its rows and plan; lib/change-records.mjs keeps them by
// inputs, so an edit elsewhere in the project does not fit them again). Otherwise the answers an earlier session kept for the same inputs
// and the same build are read (IndexedDB lykos-change-syntheses: the last few, by a hash of the inputs; the fit is a pure function of its
// inputs and the build's code), and failing that the worker fits them and the page draws them when they arrive. Without a worker (Node, a
// failed start) they are made on the page's thread, as before.
import { changeInputs, changeInputsKnown, madeOf, keepMade } from './change-records.mjs';
import { changeList } from './change-list.mjs';

let worker = null, failed = false, seq = 0;
const BUILD = typeof document !== 'undefined' ? document.querySelector('meta[name="lykos-build"]')?.content || '' : '';
/** The worker's parts, in the order it answers them: the Syntheses list, the effects source, the syntheses source, the moderators' rule. */
export const PARTS = ['list', 'effects', 'table', 'association'];
const LAST = PARTS[PARTS.length - 1];
const runs = new Map();          // inputs key -> { id, settle: { part: resolve }, made: { part: value }, ready: { part: Promise } }
const byId = new Map();          // worker job id -> key
const threw = new Set();         // inputs the worker could not take or fit: the page's thread makes them (and says what failed)

// whether a worker can be had: it is started only when something has to be fitted (an answer kept from an earlier session needs none)
const canWork = () => !failed && typeof Worker !== 'undefined';
function getWorker() {
  if (worker || !canWork()) return worker;
  try {
    worker = new Worker(new URL('./change-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const { id, part, value, error } = e.data || {}, key = byId.get(id), run = runs.get(key);
      if (!run) return;
      if (error) { byId.delete(id); runs.delete(key); threw.add(key); for (const p of PARTS) run.settle[p](false); return; }
      keepMade(key, part, value); run.settle[part]?.(true);
      run.made[part] = value;
      if (part === LAST) { byId.delete(id); runs.delete(key); keep(key, run.made); }
    };
    worker.onerror = () => { failed = true; worker = null; for (const r of runs.values()) for (const p of PARTS) r.settle[p](false); runs.clear(); byId.clear(); };
  } catch { failed = true; worker = null; }
  return worker;
}

/**
 * The project's change list when it is made for its inputs, else null: the inputs are read and the worker started after the page has
 * drawn (reading the rows from the extraction takes tens of milliseconds on a large review). Without a worker it is made now.
 */
export function changeListNow(s) {
  if (!s?.synthesis?.change) return [];
  if (!canWork()) return changeList(s);
  const known = changeInputsKnown(s), e = known && madeOf(known);
  if (e?.list) return e.list;
  if (known && threw.has(known.key)) return changeList(s);
  return null;
}

/**
 * Resolves when `part` (one of PARTS: 'list', 'effects', 'table' or 'association') is made for the project's inputs (true), or when the worker
 * could not make it (false). The inputs are read in a task of their own after the next frame, and handed to the worker in another.
 */
export async function changeReady(s, part = 'list') {
  if (!s?.synthesis?.change || !canWork()) return true;
  if (!changeInputsKnown(s)) await afterFrame();
  const inputs = changeInputs(s);
  if (!inputs || madeOf(inputs)[part] || !canWork() || threw.has(inputs.key)) return true;
  if (!runs.has(inputs.key)) {
    const got = await kept(inputs.key);
    if (got && PARTS.every(p => got[p])) { for (const p of PARTS) keepMade(inputs.key, p, got[p]); return true; }
    if (madeOf(inputs)[part]) return true;
    await afterFrame();
  }
  return start(inputs)[part];
}
const afterFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

function start(inputs) {
  let run = runs.get(inputs.key);
  if (run) return run.ready;
  const settle = {}, ready = {};
  for (const p of PARTS) ready[p] = new Promise(r => { settle[p] = r; });
  run = { id: ++seq, settle, made: {}, ready };
  runs.set(inputs.key, run); byId.set(run.id, inputs.key);
  // no worker, or a value it cannot be handed (a clone error), leaves the run to the page's thread
  try { getWorker().postMessage({ id: run.id, rows: inputs.rows, plan: inputs.plan }); } catch { runs.delete(inputs.key); byId.delete(run.id); threw.add(inputs.key); for (const p of PARTS) settle[p](false); }
  return run.ready;
}

// ---- the answers kept between sessions ----------------------------------------------------------------------------------------------
const DB = 'lykos-change-syntheses', STORE = 'made', KEEP = 6;
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  return dbP;
}
const hashes = new Map();   // inputs key -> its stored name
async function nameOf(key) {
  if (!hashes.has(key)) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
    hashes.clear(); hashes.set(key, `${BUILD}:${[...d].map(b => b.toString(16).padStart(2, '0')).join('')}`);
  }
  return hashes.get(key);
}
const usable = () => !!BUILD && typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle;
/** The answers an earlier session kept for these inputs and this build: { list, effects, table, association }, or null. */
async function kept(key) {
  if (!usable()) return null;
  try {
    const name = await nameOf(key), d = await db();
    return await new Promise(resolve => { const r = d.transaction(STORE).objectStore(STORE).get(name); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
  } catch { return null; }
}
/** Keeps the worker's answers for the next session; only the last KEEP sets of inputs stay. */
async function keep(key, value) {
  if (!usable() || !PARTS.every(p => value[p])) return;
  try {
    const name = await nameOf(key), d = await db(), tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    st.put({ ...value, at: Date.now() }, name);
    const all = st.openCursor(), seen = [];
    all.onsuccess = () => { const c = all.result; if (c) { seen.push([c.value?.at || 0, c.key]); c.continue(); return; }
      seen.sort((x, y) => y[0] - x[0]).slice(KEEP).forEach(([, k]) => st.delete(k)); };
  } catch { /* nothing kept: the next session fits them again */ }
}
