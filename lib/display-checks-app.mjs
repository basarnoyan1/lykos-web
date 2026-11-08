// The display-item checks (lib/display-checks.mjs) as the app shows them: in Tables and figures and in Submission readiness. The app reads
// no rendered file here, so the checks are of what the record gives now (statistics, size, place, readability, the rows' own accuracy); the
// files against the record are the folder's checks (tools/lykos-display-checks.mjs, run by the build and by save_output with render).
// Display items are the saved outputs whose title names a place ("Figure 2. …", "eTable 3. …") and the PRISMA flow. One result per state.
import { displayChecks, displayChecksAsync, journalLimits, associationOf, parsePlace } from './display-checks.mjs';
import { journalContext } from './journal-context.mjs';
import { currentSpec } from './output-spec.mjs';
import { prismaFlow } from './prisma-flow.mjs';
import { prismaData } from './prisma-counts.mjs';
import { changeInputs, changeModel, madeOf } from './change-records.mjs';
import { lib_workflow$researchType as researchType } from "../boot.mjs";
import { store$get as liveState, store$getIndexVersion as getIndexVersion } from "../boot.mjs";

// One result per state: the live project's by the store's index version (the revision of the research inputs: an edit that is not research, a
// job's progress, does not make the checks again), any other object by identity. Each check renders its output from the record, which for a
// fitted synthesis takes seconds on a large review: the page asks for the result with `peekDisplayChecks`, draws without it and has it made
// a task at a time (`appDisplayChecksLater`); `appDisplayChecks` is the whole thing at once (Submission readiness, the MCP, tests).
let live = null, pending = null;
const memo = new WeakMap();
const keyOf = s => (s === liveState() ? getIndexVersion() : null);
/** The checks' inputs: the display items, the journal and (a review) the PRISMA flow; the moderators' association is read when it is needed. */
function prepare(s) {
  const journal = journalLimits(journalContext(s));
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
const associationFor = (s, items) => {
  if (!items.some(x => /meta-regression|moderator|subgroup/i.test(x.spec?.title || '') || /Synthesis\s*(=|in|~)\s*(MR|G:|SUBGROUPS)/.test(x.spec?.query?.where || ''))) return null;
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
/**
 * The same checks made a task at a time (`tick()` is awaited between items: the page draws and answers in between). Answers the result; the same
 * run is shared by every caller while it works, and a result for a state the project has left is not kept. `progress(done, total, text)` is
 * told each step of the run it joins: the syntheses being fitted, then each item as it is checked.
 */
export function appDisplayChecksLater(s, tick = () => new Promise(r => setTimeout(r, 0)), progress = null) {
  const had = peekDisplayChecks(s);
  if (had !== undefined) return Promise.resolve(had);
  const key = keyOf(s);
  if (pending?.key === key && pending.s === s) { if (progress) pending.watch.push(progress); return pending.p; }
  const watch = progress ? [progress] : [], tell = (done, total, text) => { for (const w of watch) { try { w(done, total, text); } catch { /* the page's own */ } } };
  const p = (async () => {
    try {
      const { journal, items } = prepare(s);
      await tick();
      // a fitted synthesis is made off the page's thread when a worker can (lib/change-run.mjs); the outputs and the rule read what it made
      if (s.synthesis?.change) tell(0, items.length, 'Fitting the syntheses');
      try { const run = await import('./change-run.mjs'); for (const part of run.PARTS) await run.changeReady(s, part); } catch { /* made here, as before */ }
      const association = associationFor(s, items);
      await tick();
      const r = await displayChecksAsync(s, items, { journal, association }, (done, total, it) => { if (it) tell(done, total, `Checking ${parsePlace(it.spec?.title || it.title)?.label || it.title || it.id}`); return tick(); });
      return s === liveState() && keyOf(s) !== key ? r : keep(s, key, r);
    } catch { return keep(s, key, null); } finally { if (pending?.p === p) pending = null; }
  })();
  pending = { key, s, p, watch };
  return p;
}
/** How many display items the checks will go through (the placed outputs and, for a review, its PRISMA flow); for the page's meter before the run starts. */
export function displayItemCount(s) {
  try { return (s.outputs || []).filter(e => { const sp = currentSpec(e); return sp && parsePlace(sp.title); }).length + (researchType(s).kind === 'review' && (s.papers || []).length ? 1 : 0); } catch { return 0; }
}
/** The open checks (fail, warn, proposal), failures first. */
export const openChecks = r => (r ? [...r.items.flatMap(i => i.checks), ...r.set].filter(c => c.state !== 'pass').sort((a, b) => ['fail', 'warn', 'proposal'].indexOf(a.state) - ['fail', 'warn', 'proposal'].indexOf(b.state)) : []);
