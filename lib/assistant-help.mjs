// "What can you do here": what the assistant can do in each view, and what is
// worth asking there. The abilities are read from the tables that grant them
// (the op registry and the page registry, lib/assist-menu.mjs, whose tools a test
// holds to the chat's own), so this cannot promise a tool that is not there; the
// first steps are the questions the chat panel offers.
import { opsForView } from './change-ops.mjs';
import { PAGE_HELP, PROJECT_ASK } from './assist-menu.mjs';

/** What is worth asking from each view: the page's questions from the registry (lib/assist-menu.mjs), the project-wide one last. */
export const SUGGESTIONS = Object.freeze(Object.fromEntries(Object.keys(PAGE_HELP).map(v => [v, [...new Set([...PAGE_HELP[v].asks, PROJECT_ASK])]])));

/** Read tools worth naming in each view: the ones the registry says its questions rely on (their groups load with discover_tools). */
const READS = Object.fromEntries(Object.entries(PAGE_HELP).map(([v, h]) => [v, h.tools.filter(t => !opsForView(v).includes(t)).join(', ')]).filter(([, t]) => t));

/** Where things are, for "where do I find ...": a phrase, the view, and what is there. */
export const WHERE = [
  ['duplicate records', 'library', 'Library › Duplicates'], ['full text pdf', 'library', 'Library: attach or fetch a PDF'],
  ['search log', 'search', 'Search › Log'], ['labels', 'screening', 'Screening inspector › Labels'], ['assignments calibration', 'screening', 'Screening inspector › Assignments'],
  ['conflicts', 'screening', 'Screening › Conflicts'], ['stopping recall check', 'screening', 'Screening inspector › Stopping'],
  ['cell rules', 'extraction', 'Extraction › Rules'], ['codebook', 'extraction', 'Extraction › Export › Codebook'], ['double extraction', 'extraction', 'Extraction › More › Double extraction'],
  ['risk of bias', 'appraisal', 'Appraisal'], ['forest plot funnel', 'analysis', 'Analysis'], ['grade certainty', 'certainty', 'Certainty'],
  ['prisma flow checklist', 'reporting', 'Reporting'], ['ai use record', 'reporting', 'Reporting › AI use'], ['submission bundle', 'reporting', 'Reporting › Export bundle'],
  ['model usage cost', 'settings', 'Settings › Usage'], ['model profiles keys', 'settings', 'Settings › Models'], ['organise folder', 'files', 'Project folder › Organise'],
  ['workflows runs', 'workflows', 'Workflows'], ['tables figures outputs', 'outputs', 'Tables and figures'],
];
export function whereIs(query) {
  const words = String(query || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  return WHERE.map(([phrase, view, where]) => ({ view, where, score: words.filter(w => phrase.includes(w)).length })).filter(x => x.score).sort((a, b) => b.score - a.score).slice(0, 4).map(({ view, where }) => ({ view, where }));
}

/** Whether the question asks what the assistant can do, or what to do next. */
export const wantsHelp = q => /\b(what can you|what (else )?can i (ask|do)|how can you help|can you help|what should i (do|ask)|where do i (start|begin)|get started)\b/i.test(String(q || ''));

/** The view's abilities as prompt text, a few lines. */
export function helpFor(view) {
  const v = view && SUGGESTIONS[view] ? view : 'overview';
  const ops = opsForView(v);
  return [`In ${v} you can: read the review (query_library, query_project, search_project)${READS[v] ? `, ${READS[v]}` : ''}`,
    ops.length ? `; propose ${ops.join(', ')} (propose_changes; the reviewer accepts each)` : '', '.',
    ` Good next steps: ${SUGGESTIONS[v].join('; ')}.`].join('').replace(/\s+/g, ' ');
}
