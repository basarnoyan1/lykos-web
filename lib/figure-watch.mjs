// Keeps the figure checks current without a view asking for them (plan §4.15c.4 and §4.15c.7).
//
//   figureAttention(s)      the Overview rows, an O(1) read of the last result; [] for a state that is not the live one
//   onFigureNeeds(fn)       told when a pass changed the digest
//   checkNow()              "Check again": one pass now, applied
//   applyFigureResults()    the shell's hook for "at the next navigation": applies the result a late pass held
//   figureProposalAccepted() the hook point for an accepted figure proposal (400 ms trailing pass)
//   startFigureWatch(deps)  test hook: installs with injected deps; stopFigureWatch() undoes it
//
// There is no import-time effect: nothing here runs a timer, a listener or a read when the module is
// imported. The first figureAttention(s) call for the live state of a folder project installs the
// visibility and focus listeners, the store listener (for the end of an analysis run) and the open + 4 s
// pass. A project that is not a folder installs nothing. Detection never runs inside unresolvedOf: that
// function only reads what this module cached. Heavy modules (the facts collector, the rules, the
// folder) are imported on the first pass, not before.
//
// A pass is: collect facts (the folder is read through lib/figure-facts.mjs, which never writes), run the
// pure detector, publish. Only one pass flies at a time per project, across windows when navigator.locks
// exists (an unavailable lock waits for the other window's digest on a BroadcastChannel, then retries a few
// times); without them the local queue is the only guard and nothing is said. Publishing goes through
// store.notify() only when the digest of the findings changed. No sidecar is written by this module.
//
// Late results (plan §4.15c.7): once the shell has called applyFigureResults() the rows a view shows are the
// snapshot taken at the last navigation or Check again; a pass that finishes later is held and applied
// at the next one, so rows on screen never gain, lose or reorder members. Until the shell calls it, a
// result applies as it is published; no view repaints on notify, so it shows at the next paint.
import { get, notify, subscribe, projectGeneration, recoveryOwner } from '../store.mjs';
import { PARAMS } from './figure-lexicon.mjs';

/** Milliseconds: the open delay, the trailing coalescing window, the focus floor and the lock retry. */
export const TIMING = Object.freeze({ open: 4000, trail: 400, floor: PARAMS.FOCUS_FLOOR * 1000, retry: 2000, retries: 3 });

/** Where a row leads: a finding about the manuscript's figures opens the Manuscript, which holds the text it is about; the rest open Tables and figures. */
export const VIEW_OF_RULE = Object.freeze({ M1: 'manuscript', M2: 'manuscript', M3: 'manuscript', W1: 'manuscript', R1: 'manuscript' });

const W = {
  deps: null, gen: -1, armed: false, listening: false,
  shown: null, held: null, digest: null, hooked: false,
  running: null, again: false, timer: null, lastPassAt: 0, sig: null, name: '',
  cache: null, channel: null, peer: null, listeners: new Set(), unsub: null,
};

const real = () => ({
  document: globalThis.document, window: globalThis.window,
  setTimeout: (f, ms) => { const t = globalThis.setTimeout(f, ms); t?.unref?.(); return t; },
  clearTimeout: t => globalThis.clearTimeout(t),
  now: () => Date.now(),
  locks: globalThis.navigator?.locks, BroadcastChannel: globalThis.BroadcastChannel,
  folder: async () => (await import('./projects.mjs')).activeFolder(),
  pass: defaultPass,
  timing: TIMING,
});

const canInstall = () => typeof globalThis.document !== 'undefined' && typeof globalThis.document?.addEventListener === 'function';
const timing = () => ({ ...TIMING, ...W.deps?.timing });

// ---- the read -------------------------------------------------------------------------------------
/**
 * The rows the Overview adds to "Needs attention": the cached block and gap findings, at most OVERVIEW_CAP,
 * then one "N more figure checks" row, in the row shape of lib/progress.mjs ({ severity, view, text }; `key`
 * names the finding). Never runs a pass, never reads a file; [] when there is no result yet.
 */
export function figureAttention(s) {
  if (s !== get()) return [];
  if (!W.deps) { if (!canInstall()) return []; W.deps = real(); }
  const gen = projectGeneration();
  if (W.gen !== gen) sync(gen);
  return W.shown && W.shown.generation === gen ? W.shown.rows : [];
}

/** The findings behind the rows now shown (for the Outputs panel), or []. */
export const figureFindings = () => (W.shown && W.shown.generation === projectGeneration() ? W.shown.findings : []);

/** Calls `fn(result)` when a pass changed the digest. Returns the unsubscribe function. */
export function onFigureNeeds(fn) { W.listeners.add(fn); return () => W.listeners.delete(fn); }

// ---- arming ----------------------------------------------------------------------------------------
/** A new project (or none): drop what belonged to the last one and, for a folder project, arm the triggers. */
function sync(gen) {
  W.gen = gen; W.armed = false; W.shown = W.held = null; W.digest = null; W.again = false; W.sig = null;
  W.cache = null; W.name = '';
  W.deps.clearTimeout(W.timer); W.timer = null;
  Promise.resolve().then(() => W.deps?.folder()).then(folder => { if (W.deps && W.gen === gen && folder) { W.name = folder.name || ''; arm(gen); } }).catch(() => {});
}

function arm(gen) {
  W.armed = true;
  W.sig = analysisSig(get());
  W.lastPassAt = W.deps.now();            // opening counts as a pass: the focus floor runs from here
  listen();
  schedule(0, timing().open);
}

function listen() {
  if (W.listening) return;
  W.listening = true;
  const { document, window } = W.deps;
  document.addEventListener('visibilitychange', onVisibility);
  window?.addEventListener?.('focus', onFocus);
  W.unsub = subscribe(onStore);
}

/** Whatever marks the end of an analysis run: the times the app stamps on its results. */
const analysisSig = s => [s?.analysis?.at, s?.survival?.at, ...Object.values(s?.analyses || {}).map(a => a?.at), ...(s?.advancedAnalyses || []).map(a => a?.at)].filter(Boolean).join('|');

function onStore(s) {
  if (!W.armed) return;
  const sig = analysisSig(s);
  if (sig === W.sig) return;
  W.sig = sig;
  schedule(0, timing().trail);
}
function onVisibility() { if (W.deps?.document?.visibilityState !== 'hidden') floorPass(); }
function onFocus() { floorPass(); }
function floorPass() {
  if (!W.armed) return;
  if (W.deps.now() - W.lastPassAt < timing().floor) return;
  schedule(0, 0);
}

/** The accepted figure proposal hook point: a 400 ms trailing pass. Not wired by anything in this package. */
export function figureProposalAccepted() { if (W.armed) schedule(0, timing().trail); }

/** One timer at a time: a trigger inside the window of an earlier one replaces it, so triggers coalesce. */
function schedule(_why, delay) {
  W.deps.clearTimeout(W.timer);
  W.timer = W.deps.setTimeout(() => { W.timer = null; if (W.running) { W.again = true; return; } fly().catch(() => {}); }, delay);
}

// ---- one flight ---------------------------------------------------------------------------------------
/** Starts a pass after any pass in flight (never two at once). Resolves to the result, or null. */
function fly() {
  const gen = W.gen, prior = W.running;
  const p = (prior ? prior.catch(() => {}) : Promise.resolve()).then(() => lockedPass(gen, 0));
  W.running = p;
  p.catch(() => {}).then(() => {
    if (W.running !== p) return;
    W.running = null;
    if (W.again && W.armed) { W.again = false; fly().catch(() => {}); }
  });
  return p;
}

const waitFor = (ms, onPeer) => new Promise(res => {
  const t = W.deps.setTimeout(() => { W.peer = null; res(); }, ms);
  W.peer = () => { W.deps.clearTimeout(t); W.peer = null; res(); };
  onPeer?.();
});

async function lockedPass(gen, tries) {
  const d = W.deps;
  if (!d || W.gen !== gen) return null;
  const key = projectKey();
  const run = () => runPass(gen);
  if (!d.locks?.request) return run();
  let out;
  try {
    out = await d.locks.request(`lykos-figure-check:${key}`, { ifAvailable: true }, async lock => (lock ? { flew: true, value: await run() } : { flew: false }));
  } catch { return run(); }                       // the locks API failed: the local queue is the guard, silently
  if (out?.flew) return out.value;
  if (tries >= timing().retries) return null;
  channelFor(key);
  await waitFor(timing().retry);                  // another window is checking: wait for its digest, then try again
  return lockedPass(gen, tries + 1);
}

function projectKey() {
  const s = get();
  return String(s.researchLedger?.projectId || W.name || 'project').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

function channelFor(key) {
  const d = W.deps;
  if (W.channel || !d.BroadcastChannel) return W.channel;
  try {
    W.channel = new d.BroadcastChannel(`lykos-figure-needs:${key}`);
    W.channel.onmessage = () => W.peer?.();
  } catch { W.channel = null; }
  return W.channel;
}

async function runPass(gen) {
  const d = W.deps;
  let findings;
  const key = projectKey();
  try { findings = await d.pass({ generation: gen, key, folder: await d.folder(), cache: () => (W.cache ||= import('./figure-facts.mjs').then(f => f.openFigureCache(key))) }); }
  catch (err) { console.warn('[figure checks]', err?.message || err); return null; }
  W.lastPassAt = d.now();
  if (!findings || W.gen !== gen || gen !== projectGeneration()) return null;
  return receive(findings, gen);
}

/** A drift row (plan §4.15d) leads to the file it is about: go('files:<rule>:<path>'), where the Files view opens on it. */
function driftTarget(f) {
  if (!/^D[1-5]$/.test(f.rule || '')) return {};
  const path = (f.evidence || []).find(e => (e.kind === 'file' || e.kind === 'import') && e.path)?.path;
  return path ? { go: `files:${f.rule}:${path}` } : {};
}

async function receive(findings, gen) {
  const needs = await import('./figure-needs.mjs');
  if (W.gen !== gen) return null;
  const digest = needs.digest(findings), ov = needs.overview(findings.filter(f => f.kind !== 'coverage'));
  // The integration checks (lib/coverage-needs.mjs) are not capped with the figure rows: each is one stage's step, under that stage.
  const coverage = needs.routed(findings.filter(f => f.kind === 'coverage'), 'overview').filter(f => f.severity !== 'info');
  const rows = [...coverage.map(f => ({ severity: f.severity, view: f.view || 'outputs', text: f.text, key: f.key, coverage: true })),
    ...ov.rows.map(f => ({ severity: f.severity, view: f.view || VIEW_OF_RULE[f.rule] || 'outputs', text: f.text, key: f.key, ...driftTarget(f) }))];
  if (ov.moreText) rows.push({ severity: 'gap', view: 'outputs', text: ov.moreText, key: 'more' });
  const result = { generation: gen, at: W.deps.now(), digest, findings, rows };
  const changed = digest !== W.digest;
  W.held = result; W.digest = digest;
  try { W.channel?.postMessage({ digest, at: result.at }); } catch { /* a closed channel is not a failed pass */ }
  if (!changed) return result;
  if (!W.hooked) W.shown = result;
  notify();
  for (const fn of [...W.listeners]) { try { fn(result); } catch { /* a listener's error is its own */ } }
  return result;
}

// ---- applying and asking --------------------------------------------------------------------------------
/** The shell's navigation hook: from now on results apply here, not as they arrive. Applies the held one. */
export function applyFigureResults() {
  W.hooked = true;
  if (W.held && W.held !== W.shown && W.held.generation === projectGeneration()) { const same = W.shown?.digest === W.held.digest; W.shown = W.held; if (!same) notify(); }
  return W.shown;
}

/** "Check again": a pass now (after one in flight), applied. Resolves to the result, or null when nothing could run. */
export async function checkNow() {
  if (!W.deps) { if (!canInstall()) return null; W.deps = real(); }
  const gen = projectGeneration();
  if (W.gen !== gen) sync(gen);
  if (!W.deps || !(await W.deps.folder())) return null;
  W.armed = true; listen();
  const result = await fly();
  if (result && W.held === result && W.shown !== result) { const same = W.shown?.digest === result.digest; W.shown = result; if (!same) notify(); }
  return result;
}

// ---- the default pass -----------------------------------------------------------------------------------------
/** Facts, then findings, for the open folder project; null when there is no folder. Reads only. */
async function defaultPass({ cache, generation, folder }) {
  if (!folder) return null;
  const [facts, needs] = await Promise.all([import('./figure-facts.mjs'), import('./figure-needs.mjs')]);
  const state = get();
  const memo = await cache();
  const now = Date.now();
  const base = { now, owner: recoveryOwner(), ...(state.researchLedger?.projectId ? { projectId: state.researchLedger.projectId } : {}) };
  const first = await facts.collectFacts(folder, state, memo, base);
  const png = needs.pngCandidates(first, {}, now);
  const second = png.length ? await facts.collectFacts(folder, state, memo, { ...base, png }) : first;
  await memo.flush?.();
  if (generation !== projectGeneration()) return null;
  return needs.detect(second, {}, now);
}

// ---- test hooks --------------------------------------------------------------------------------------------------
/** Installs with injected dependencies ({ document, window, setTimeout, clearTimeout, now, locks, BroadcastChannel, folder, pass, timing }). Test hook only. */
export function startFigureWatch(over = {}) {
  stopFigureWatch();
  W.deps = { ...real(), ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) };
  W.gen = -1;
  const gen = projectGeneration();
  sync(gen);
  return W.deps;
}

/** Removes what startFigureWatch or the first figureAttention call installed and forgets every result. */
export function stopFigureWatch() {
  const d = W.deps;
  if (d) {
    d.clearTimeout(W.timer);
    d.document?.removeEventListener?.('visibilitychange', onVisibility);
    d.window?.removeEventListener?.('focus', onFocus);
  }
  W.unsub?.();
  try { W.channel?.close?.(); } catch { /* already closed */ }
  Object.assign(W, { deps: null, gen: -1, armed: false, listening: false, shown: null, held: null, digest: null, hooked: false, running: null, again: false, timer: null, lastPassAt: 0, sig: null, name: '', cache: null, channel: null, peer: null, unsub: null });
  W.listeners.clear();
}
