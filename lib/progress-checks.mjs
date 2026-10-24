// The two checks that lib/progress.mjs and lib/research-workflow.mjs make only for some projects, and that cost the most to load (footprint Task 6):
// the manuscript's findings (lib/manuscript-checks.mjs and the results it reads: about 10 modules) and the reporting checklist of a primary study
// (lib/checklist.mjs and its catalogues). They load through lib/progress-gate.mjs, when the open project has a manuscript with blocks or is a primary study.
import { checkManuscript } from './manuscript-checks.mjs';
import { results } from './results.mjs';
import { checklistOf, checklistStates } from './checklist.mjs';

/** Every finding of the manuscript against the library and the results (the rows lib/progress.mjs `unresolved` counts). */
export function manuscriptFindings(s) {
  const ms = s.manuscript?.blocks || [];
  return checkManuscript(ms, {
    library: (s.papers || []).map(p => ({ ...p, included: s.screening?.[p.id]?.decision === 'include' })),
    results: results(s), snapshot: s.manuscript.snapshot || {}, citationCheck: s.manuscript.citationCheck || {},
  });
}

/** The reporting checklist the project is held to, and how many of its items are reported. */
export function reportingOf(s) {
  const cl = checklistOf(s), cs = checklistStates(s);
  return { name: cl.name, total: cl.items.length, reported: cl.items.filter(([n]) => cs[n]?.state === 'done').length };
}
