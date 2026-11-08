// The two checks that lib/progress.mjs and lib/research-workflow.mjs make only for some projects, and that cost the most to load (footprint Task 6):
// the manuscript's findings (lib/manuscript-checks.mjs and the results it reads: about 10 modules) and the reporting checklist of a primary study
// (lib/checklist.mjs and its catalogues). They load through lib/progress-gate.mjs, when the open project has a manuscript with blocks or is a primary study.
import { checkManuscript } from './manuscript-checks.mjs';
import { citableRecords } from './reference-list.mjs';
import { results } from './results.mjs';
import { checklistOf, checklistStates } from './checklist.mjs';
import { store$get as get, store$getVersion as getVersion, store$inUpdate as inUpdate } from "../boot.mjs";
import { warm } from './warm-start.mjs';

/**
 * Every finding of the manuscript against the library and the results (the rows lib/progress.mjs `unresolved` counts). The live project
 * answers from the last check until its version or the day changes (an Overview paint asked four times, 20 to 30 ms each); never inside a
 * reducer, and any other state is checked fresh. Each call gets its own array; callers never change the findings.
 */
let findingsMemo = null;
export function manuscriptFindings(s) {
  const live = s === get() && !inUpdate(), v = getVersion(), day = new Date().toDateString();
  if (live && findingsMemo?.v === v && findingsMemo.s === s && findingsMemo.day === day) return findingsMemo.out.slice();
  const out = live ? warm('findings', s, () => checkFindings(s)) : checkFindings(s);   // the last session's answer at the opening (lib/warm-start.mjs)
  if (live) findingsMemo = { v, s, day, out };
  return out.slice();
}
function checkFindings(s) {
  const ms = s.manuscript?.blocks || [];
  return checkManuscript(ms, {
    library: citableRecords(s, (s.papers || []).map(p => ({ ...p, included: s.screening?.[p.id]?.decision === 'include' }))),
    results: results(s), snapshot: s.manuscript.snapshot || {}, citationCheck: s.manuscript.citationCheck || {},
  });
}

/** The reporting checklist the project is held to, and how many of its items are reported. */
export function reportingOf(s) {
  const cl = checklistOf(s), cs = checklistStates(s);
  return { name: cl.name, total: cl.items.length, reported: cl.items.filter(([n]) => cs[n]?.state === 'done').length };
}
