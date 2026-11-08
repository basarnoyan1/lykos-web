// Answers kept from the last session, so the Overview's first paint does not compute them again (docs/footprint-2026-10.md, "Bundled boot and
// warm start", 28 October 2026). The manuscript's findings, the stages' facts and the submission readiness took about 50 of the 75 ms of
// the first Overview paint on the ASD review, and they depend only on the project as saved, the day and which checks are loaded.
//
//   warm(name, s, compute)   the answer for the open project: at the opening (the store's version has not changed since the first call)
//                            and when the kept answer was made for this project, its saved stamp (savedAt, saveToken), the day, the checks
//                            and this build, the kept one; otherwise compute(). Either way the answer is kept for the next session.
//
// What is kept: each answer as JSON, made while the project in memory was the file as saved (or given the stamp of a save that wrote that
// version), recorded two seconds after it was made or a save settled, and at pagehide, in localStorage under lykos.warm (the last few
// projects). An answer served from the kept copy is computed again once the page is idle after the first view; if it differs (another program changed the project without its stamp, or the build's rules
// changed under the same build id) the store is notified and the page draws the computed one. An answer that does not survive JSON exactly
// (undefined, NaN, Infinity, a Map or a Set) is never kept.
import { store$get as get, store$getVersion as getVersion, store$projects as projects, store$saveState as saveState, store$onSaveState as onSaveState, store$notify as notify } from "../boot.mjs";
import { lib_progress_gate$checksKey as checksKey } from "../boot.mjs";

const KEY = 'lykos.warm';
const PROJECTS = 4;
const BUILD = typeof document !== 'undefined' ? document.querySelector('meta[name="lykos-build"]')?.content || '' : '';
let opening = null;                 // the store version of the first call: the kept answers serve only it
let kept;                           // { stamp, answers: { name: json } } for the open project, read on first use
const made = new Map();             // name -> { v, json, stamp }: this session's answers, by store version, with the saved stamp they hold for
const served = new Map();           // name -> compute: answered from the kept copy, to verify once idle
let verifying = false;
let page = typeof window !== 'undefined';   // a window keeps answers; a Node caller (the MCP server, a test) computes

const stampOf = s => JSON.stringify([projects().current, s.savedAt || 0, s.saveToken || '', new Date().toDateString(), checksKey(), BUILD]);
const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
function readAll() { try { return JSON.parse(storage()?.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function keptFor() {
  if (kept === undefined) { const all = readAll(); kept = all[projects().current] || null; }
  return kept;
}
/** JSON that reads back as the same value, or null. */
function exactJson(value) {
  let exact = true;
  const json = JSON.stringify(value, (k, v) => {
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || v instanceof Map || v instanceof Set || typeof v === 'function' || typeof v === 'bigint') exact = false;
    return v;
  });
  return exact && json !== undefined ? json : null;
}

export function warm(name, s, compute) {
  if (s !== get() || !page) return compute();
  const v = getVersion();
  if (opening === null) opening = v;
  const k = v === opening && !verifying && saveState() === 'saved' ? keptFor() : null;   // only the file as saved: nothing changed in memory
  if (k && k.answers?.[name] != null && k.stamp === stampOf(s)) {
    made.set(name, { v, json: k.answers[name], stamp: k.stamp });
    served.set(name, compute);
    verifySoon();
    return JSON.parse(k.answers[name]);
  }
  const value = compute();
  const json = exactJson(value);
  // an answer holds for the saved file only when the project in memory is the saved one (nothing waiting to be written)
  if (json != null) { made.set(name, { v, json, stamp: saveState() === 'saved' ? stampOf(s) : null }); recordSoon(); } else made.delete(name);
  return value;
}

// ---- verifying a served answer --------------------------------------------------------------------------------------------------------
let verifyT = null;
function verifySoon() {
  if (verifyT) return;
  const later = typeof requestIdleCallback === 'function' ? f => requestIdleCallback(f, { timeout: 4000 }) : f => setTimeout(f, 1500);
  verifyT = setTimeout(() => later(verify), 600); verifyT.unref?.();
}
function verify() {
  verifyT = null;
  if (getVersion() !== opening) { served.clear(); return; }   // the project changed since: every answer was computed for it
  let differs = false;
  verifying = true;
  try {
    for (const [name, compute] of served) {
      const json = exactJson(compute());
      if (json !== made.get(name)?.json) differs = true;
      if (json != null) made.set(name, { ...made.get(name), v: opening, json }); else made.delete(name);
    }
  } finally { verifying = false; served.clear(); }
  if (differs) { kept = null; notify(); }   // a new version: every memo asks again, and the page draws the computed answers
}

// ---- keeping the answers for the next session ------------------------------------------------------------------------------------------
// The answers kept are those made for the file as it is saved now: its stamp is the one in memory (a save changes it in place), and an
// answer made while the project in memory was that file carries it. A save that left nothing to write gives the current version's answers
// the new stamp (the file now holds exactly that version).
function restamp() {
  if (saveState() !== 'saved') return;
  const v = getVersion(), stamp = stampOf(get());
  for (const a of made.values()) if (a.v === v) a.stamp = stamp;
}
function record() {
  const s = get(), st = storage();
  if (!st || !s) return;
  const stamp = stampOf(s), answers = {};
  for (const [name, a] of made) if (a.stamp === stamp) answers[name] = a.json;
  if (!Object.keys(answers).length) return;
  const all = readAll(), id = projects().current;
  if (all[id]?.stamp === stamp && Object.keys(answers).every(n => all[id].answers?.[n] === answers[n])) return;   // kept already
  all[id] = { stamp, at: Date.now(), answers };
  const ids = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const old of ids.slice(PROJECTS)) delete all[old];
  try { st.setItem(KEY, JSON.stringify(all)); } catch { try { st.removeItem(KEY); } catch {} }
}
let recordT = null;
function recordSoon() { clearTimeout(recordT); recordT = setTimeout(record, 2000); recordT.unref?.(); }
if (typeof window !== 'undefined') {
  onSaveState(() => { restamp(); recordSoon(); });
  window.addEventListener('pagehide', record);
}

/** Test hooks: keep now, verify now, and forget this session (as a new page would). */
export const warmTesting = { record, verify, page: () => { page = true; }, reset: () => { opening = null; kept = undefined; made.clear(); served.clear(); clearTimeout(verifyT); verifyT = null; clearTimeout(recordT); } };
