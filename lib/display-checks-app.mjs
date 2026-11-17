// The display-item checks (lib/display-checks.mjs) as the app shows them: in Tables and figures and in Submission readiness. The app reads
// no rendered file here, so the checks are of what the record gives now (statistics, size, place, readability, the rows' own accuracy); the
// files against the record are the folder's checks (tools/lykos-display-checks.mjs, run by the build and by save_output with render).
// Display items are the saved outputs whose title names a place ("Figure 2. …", "eTable 3. …") and the PRISMA flow. One result per state.
import { displayChecks, displayChecksAsync, journalLimits, associationOf, parsePlace, itemNames } from './display-checks.mjs';
import { journalContext } from './journal-context.mjs';
import { journalStyleFor, loadJournalStyles } from './addons.mjs';
import { currentSpec } from './output-spec.mjs';
import { prismaFlow } from './prisma-flow.mjs';
import { prismaData } from './prisma-counts.mjs';
import { changeInputs, changeModel, madeOf } from './change-records.mjs';
import { lib_workflow$researchType as researchType } from "../boot.mjs";
import { store$get as liveState, store$getIndexVersion as getIndexVersion, store$sectionsVersion as sectionsVersion, store$unloadedSections as unloadedSections, store$heldBase as heldBase, store$textHash as textHash, store$recoveryOwner as recoveryOwner, store$onProjectClose as onProjectClose } from "../boot.mjs";

// One result per state: the live project's by the store's index version (the revision of the research inputs: an edit that is not research, a
// job's progress, does not make the checks again), any other object by identity. Each check renders its output from the record, which for a
// fitted synthesis takes seconds on a large review: the page asks for the result with `peekDisplayChecks`, draws without it and has it made
// a task at a time (`appDisplayChecksLater`); `appDisplayChecks` is the whole thing at once (Submission readiness, the MCP, tests).
let live = null, pending = null;
const memo = new WeakMap();
const keyOf = s => (s === liveState() ? getIndexVersion() : null);
onProjectClose(() => { live = null; pending = null; shown = null; hashes.clear(); });
/** The checks' inputs: the display items, the journal and (a review) the PRISMA flow; the moderators' association is read when it is needed. */
function prepare(s) {
  // with the journal's own style when the journal styles are loaded (lib/addons.mjs): the type size it prints a figure in is not a fault of a figure
  const ctx = journalContext(s), journal = journalLimits(ctx, journalStyleFor({ journal: ctx.journal || '', profile: ctx.profileId || '' }));
  const items = (s.outputs || []).map(e => ({ id: e.id, kind: 'output', spec: currentSpec(e) })).filter(x => x.spec && parsePlace(x.spec.title));
  if (researchType(s).kind === 'review' && (s.papers || []).length) {
    const fig1 = items.some(x => parsePlace(x.spec.title)?.label === 'Figure 1');
    items.unshift({ id: 'prisma', kind: 'flow', title: 'PRISMA flow diagram', place: fig1 ? '' : 'Figure 1',
      svg: prismaFlow(prismaData(s), { previous: false, other: false, ...(s.prismaArms || {}), layout: 'auto', page: journal.page }) });
  }
  return { journal, items };
}
// the moderators' rule only when a moderator or subgroup item is shown (the change synthesis is not run for nothing); the worker's answer
// (lib/change-run.mjs, part 'association') is read before the model is fitted here
const wantsAssociation = items => items.some(x => /meta-regression|moderator|subgroup/i.test(x.spec?.title || '') || /Synthesis\s*(=|in|~)\s*(MR|G:|SUBGROUPS)/.test(x.spec?.query?.where || ''));
const associationFor = (s, items) => {
  if (!wantsAssociation(items)) return null;
  try { const made = madeOf(changeInputs(s))?.association; return made ? (made.none ? null : made) : associationOf(changeModel(s)); } catch { return null; /* no change synthesis */ }
};
const keep = (s, key, r) => { if (s === liveState()) live = { key, r }; else memo.set(s, r); return r; };
/**
 * The checks already made for the project in its current state: the result (null when it has no display items), or undefined when they have not
 * been made. A project with nothing to check answers null without making anything.
 */
export function peekDisplayChecks(s) {
  if (!s || typeof s !== 'object') return null;
  const key = keyOf(s);
  if (key != null ? live?.key === key : memo.has(s)) return key != null ? live.r : memo.get(s);
  // (the PRISMA flow is drawn only when the checks are made: it counts every record)
  try {
    const placed = (s.outputs || []).some(e => { const sp = currentSpec(e); return sp && parsePlace(sp.title); });
    if (!placed && !(researchType(s).kind === 'review' && (s.papers || []).length)) return keep(s, key, null);
  } catch { return keep(s, key, null); }
  return undefined;
}
/** The checks of the project's display items, or null when it has none. */
export function appDisplayChecks(s) {
  const had = peekDisplayChecks(s);
  if (had !== undefined) return had;
  const key = keyOf(s);
  let r = null;
  try { const { journal, items } = prepare(s); r = displayChecks(s, items, { journal, association: associationFor(s, items) }); } catch { r = null; }
  return keep(s, key, r);
}
// ---- the checks kept across opens and launches ----------------------------------------------------------------------------------------
// Each check renders its output from the record, and an item drawn from a fitted synthesis waits for the fit (seconds to tens of seconds on
// a large review, after every new build: the fit is kept by build). Nothing is made again that was made for the same inputs (owner, 15 Nov
// 2026, "so slow"): each item's check is kept with a digest of what it reads, and only the items whose digest moved are checked again.
//   digest     the research token (every loaded section but the outputs, as JSON, hashed; a section still on disk by the head's entry for it,
//              lib/project-format.mjs), the journal's limits and style, and the item itself (its current spec, or the flow's drawing). The
//              fit and the moderators' rule are functions of the sections, so the token covers them. The item's name in its checks
//              (lib/display-checks.mjs itemNames) reads the other items' titles: it is part of the item. The outputs are left out so that editing
//              one output checks only that one again; no render reads another output.
//   kept       the last result per project (its items' checks and digests, what the set checks read of each, the moderators' rule), in
//              IndexedDB lykos-display-checks (the last KEEP projects; the browser's cache, not the folder: it is made again from the record),
//              by build: a result of another build is shown at once and checked again.
// A section's hash is kept for the live project by the store's section version, so a launch hashes the sections once (about 350 ms on the
// Sham review in WebKit, in slices between frames) and an edit hashes only the sections it touched.
const BUILD = typeof document !== 'undefined' ? document.querySelector('meta[name="lykos-build"]')?.content || '' : '';
const DB = 'lykos-display-checks', STORE = 'last', KEEP = 12, SKIP = new Set(['outputs', 'savedAt', 'format']);
let shown = null;                 // { owner, result, current }: the last result the page was given for the open project
const hashes = new Map();         // section -> { v, h } for the live project
let io = null;                    // where the results are kept: { read(owner), write(owner, value) }
/** Where the kept results go: IndexedDB in the app (a build known), or what a test gives; null keeps none. */
export function useCheckStore(store) { io = store; }
const idb = () => {
  if (!BUILD || typeof indexedDB === 'undefined') return null;
  let dbP = null;
  const db = () => (dbP ??= new Promise((resolve, reject) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); }));
  return {
    read: async owner => { const d = await db(); return new Promise(res => { const r = d.transaction(STORE).objectStore(STORE).get(owner); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); },
    write: async (owner, value) => {
      const d = await db(), st = d.transaction(STORE, 'readwrite').objectStore(STORE), seen = [];
      st.put(value, owner);
      const all = st.openCursor();
      all.onsuccess = () => { const c = all.result; if (c) { seen.push([c.value?.at || 0, c.key]); c.continue(); return; } seen.sort((x, y) => y[0] - x[0]).slice(KEEP).forEach(([, k]) => st.delete(k)); };
    },
  };
};
const store = () => (io === null ? (io = idb() || false) : io) || null;
const ownerOf = s => (s === liveState() ? `${recoveryOwner()}|${s?.project?.name || ''}` : `memo|${s?.project?.name || ''}`);
/** The research token: a hash of every section the checks may read; `tick()` is awaited between the large ones. */
async function researchToken(s, tick) {
  const isLive = s === liveState(), out = [], off = isLive ? new Set(unloadedSections()) : new Set(), held = isLive && off.size ? new Map((heldBase() || []).map(e => [e[0], e])) : null;
  for (const k of Object.keys(s).sort()) {
    if (SKIP.has(k)) continue;
    if (off.has(k)) { const e = held?.get(k); out.push(`${k}:${e ? textHash(JSON.stringify(e)) : `?${Math.random()}`}`); continue; }
    const v = isLive ? sectionsVersion(k) : null, had = isLive ? hashes.get(k) : null;
    if (had && had.v === v) { out.push(`${k}:${had.h}`); continue; }
    const h = await sectionHash(s[k], tick);
    if (h == null) continue;
    if (isLive) hashes.set(k, { v, h });
    out.push(`${k}:${h}`);
  }
  return String(textHash(out.join('|')));
}
// A section's hash, a slice of its entries at a time (a large review's records are 13 MB of JSON: one task would hold the page for about
// 90 ms), `tick()` awaited after about 200,000 characters. An array by runs of its items, an object by runs of its keys, anything else whole.
async function sectionHash(v, tick) {
  if (v === null || typeof v !== 'object') { const t = JSON.stringify(v); return t === undefined ? null : textHash(t); }
  const keys = Array.isArray(v) ? null : Object.keys(v), n = keys ? keys.length : v.length, parts = [];
  let size = 0, from = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && i - from < 500) continue;
    const t = keys ? JSON.stringify(keys.slice(from, i).map(k => [k, v[k]])) : JSON.stringify(v.slice(from, i));
    parts.push(textHash(t)); size += t.length; from = i;
    if (size > 200000) { size = 0; await tick(); }
  }
  return textHash(`${keys ? 'o' : 'a'}${n}:${parts.join(',')}`);
}
const journalKey = journal => String(textHash(JSON.stringify(journal) + (journal.drawnFor ? '|style' : '')));
const digestOf = (token, jk, it) => `${textHash(`${token}|${jk}|${JSON.stringify(it)}`)}`;
/**
 * The last result kept for the project, current or not (a result of another build or of other inputs, shown while the items are checked
 * again): { result, current } or null. Synchronous: what the page was last given, or what the run read from the cache.
 */
export function shownDisplayChecks(s) {
  if (!s || !shown || shown.owner !== ownerOf(s)) return null;
  return shown;
}
/**
 * The same checks made a task at a time (`tick()` is awaited between items: the page draws and answers in between). Answers the result; the same
 * run is shared by every caller while it works, and a result for a state the project has left is not kept. `progress(done, total, text)` is
 * told each step of the run it joins: each item as it is checked, the fit when an item waits for it. `stored(result)` is told the result kept
 * from an earlier open, when there is one, before anything is checked.
 */
export function appDisplayChecksLater(s, tick = () => new Promise(r => setTimeout(r, 0)), progress = null, { stored = null } = {}) {
  const had = peekDisplayChecks(s);
  if (had !== undefined) return Promise.resolve(had);
  const key = keyOf(s);
  if (pending?.key === key && pending.s === s) { if (progress) pending.watch.push(progress); if (stored) pending.told.push(stored); return pending.p; }
  const watch = progress ? [progress] : [], told = stored ? [stored] : [];
  const tell = (done, total, text) => { for (const w of watch) { try { w(done, total, text); } catch { /* the page's own */ } } };
  const owner = ownerOf(s);
  const p = (async () => {
    try {
      const kept = await store()?.read(owner).catch(() => null) || null;
      if (kept?.result && !(shown?.owner === owner)) { shown = { owner, result: kept.result, current: false }; for (const f of told) { try { f(kept.result); } catch { /* the page's own */ } } }
      await loadJournalStyles().catch(() => []);   // the journal's style, for the size it prints a figure in (none in a build without addons)
      const { journal, items } = prepare(s);
      await tick();
      const token = await researchToken(s, tick), jk = journalKey(journal), names = itemNames(items), digests = new Map(items.map(it => [it.id, digestOf(token, jk, { ...it, name: names.get(it.id) })]));
      const same = kept && kept.build === BUILD ? kept.items || {} : {};
      const reuse = it => (same[it.id]?.digest === digests.get(it.id) ? same[it.id].check : null);
      const fresh = {};
      for (const it of items) { const c = reuse(it); if (c) fresh[it.id] = { digest: digests.get(it.id), check: c }; }
      // a fitted synthesis is made off the page's thread when a worker can (lib/change-run.mjs); the outputs and the rule read what it made
      const fit = async () => {
        tell(0, items.length, 'Fitting the syntheses');
        try { const run = await import('./change-run.mjs'); for (const part of run.PARTS) await run.changeReady(s, part); } catch { /* made here, as before */ }
      };
      let fitted = false;
      const association = async () => {
        if (!wantsAssociation(items)) return null;
        if (kept?.build === BUILD && kept.token === token && 'association' in kept) return kept.association;
        if (!fitted) { fitted = true; await fit(); }
        return associationFor(s, items);
      };
      let asked = null;
      const r = await displayChecksAsync(s, items, { journal, reuse, beforeHeavy: async () => { if (!fitted) { fitted = true; await fit(); } },
        association: async () => (asked = await association()),
        made: (it, check) => { fresh[it.id] = { digest: digests.get(it.id), check }; } },
      (done, total, it) => { if (it) tell(done, total, `Checking ${parsePlace(it.spec?.title || it.title)?.label || it.title || it.id}`); return tick(); });
      if (s === liveState() && keyOf(s) !== key) return r;
      shown = { owner, result: r, current: true };
      store()?.write(owner, { build: BUILD, token, at: Date.now(), result: r, items: fresh, association: asked })?.catch?.(() => {});
      return keep(s, key, r);
    } catch { return keep(s, key, null); } finally { if (pending?.p === p) pending = null; }
  })();
  pending = { key, s, p, watch, told };
  return p;
}
/** How many display items the checks will go through (the placed outputs and, for a review, its PRISMA flow); for the page's meter before the run starts. */
export function displayItemCount(s) {
  try { return (s.outputs || []).filter(e => { const sp = currentSpec(e); return sp && parsePlace(sp.title); }).length + (researchType(s).kind === 'review' && (s.papers || []).length ? 1 : 0); } catch { return 0; }
}
/** The open checks (fail, warn, proposal), failures first. */
export const openChecks = r => (r ? [...r.items.flatMap(i => i.checks), ...r.set].filter(c => c.state !== 'pass').sort((a, b) => ['fail', 'warn', 'proposal'].indexOf(a.state) - ['fail', 'warn', 'proposal'].indexOf(b.state)) : []);
