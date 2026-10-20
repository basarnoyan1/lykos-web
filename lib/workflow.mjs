import { RESEARCH_TYPES, typeById } from './research-types.mjs';
// Project shape controls navigation and progress. Older saved projects had no
// shape field; infer a review for those with work, without rewriting their data.
export const MODES = [
  { id: 'workspace', label: 'Literature workspace' },
  { id: 'systematic', label: 'Systematic review' },
  { id: 'scoping', label: 'Scoping review' },
];

// Research design is recorded separately from the available workflow (the
// registry in lib/research-types.mjs; several designs share screens without
// claiming identical methods).
export { RESEARCH_TYPES };
// A project saved before types existed is the plain type of its mode.
const PLAIN = { systematic: 'systematic-review', scoping: 'scoping-review', workspace: 'other' };
export const researchType = s => RESEARCH_TYPES.find(t => t.id === s.project?.researchType)
  || typeById(PLAIN[projectMode(s)] || 'other');
/** The appraisal instrument a research type starts with, unless the review chose another. */
export const defaultAppraisal = s => researchType(s).appraisal || 'rob2';

const hasWork = s => Boolean(
  s.paper?.title || s.protocol?.title || s.protocol?.criteria?.length ||
  s.papers?.length || s.searches?.length || Object.keys(s.values || {}).length ||
  s.manuscript?.blocks?.length || s.todos?.length || s.analysis || s.survival
);

export function projectMode(s) {
  if (s.project?.setupPending) return null;
  if (MODES.some(m => m.id === s.project?.mode)) return s.project.mode;
  return hasWork(s) ? 'systematic' : null;
}


export const patientDataEnabled = s => Boolean(s.project?.patientData ||
  (!s.project && (s.participants?.length || s.survival)));

const VIEWS = {
  workspace: ['overview', 'search', 'library', 'extraction', 'manuscript'],
  systematic: ['overview', 'protocol', 'search', 'library', 'screening', 'extraction',
    'appraisal', 'analysis', 'certainty', 'manuscript', 'reporting'],
  scoping: ['overview', 'protocol', 'search', 'library', 'screening', 'extraction', 'manuscript', 'reporting'],
};

/**
 * The views the rail lists for a project, in order. Tasks (views/tasks.mjs)
 * sits first in the Workspace group, before Notes, for every research type.
 */
export function visibleViews(s) {
  const keys = withSubmission(baseViews(s));
  const at = keys.indexOf('notes');
  const all = at < 0 || keys.includes('tasks') ? keys : [...keys.slice(0, at), 'tasks', ...keys.slice(at)];
  return all.length > 1 && !all.includes('changes') ? [...all, 'changes'] : all;
}
/** Submission (views/submissions.mjs) follows the manuscript's last page in the Report group, for every project that writes one. */
function withSubmission(keys) {
  if (!keys.includes('manuscript') || keys.includes('submissions')) return keys;
  const at = keys.indexOf(['reporting', 'outputs', 'manuscript'].find(k => keys.includes(k)));
  return [...keys.slice(0, at + 1), 'submissions', ...keys.slice(at + 1)];
}
function baseViews(s) {
  const mode = projectMode(s);
  if (!mode) return ['overview'];
  const type = researchType(s).id;
  // A primary study lists its own views (lib/research-types.mjs): its data are its own, not studies to screen.
  const own = typeById(type)?.views;
  if (own) { const keys = [...own]; if (patientDataEnabled(s)) keys.splice(keys.indexOf('datasets'), 0, 'patients'); return keys; }
  const keys = [...VIEWS[mode]];
  // A case report has one patient and no studies to screen, extract or appraise.
  if (type === 'case-report') return ['overview', 'case', 'search', 'library', 'datasets', 'manuscript', 'outputs', 'reporting', 'notes', 'notifications', 'imaging'];
  if (type === 'case-series') keys.splice(1, 0, 'protocol');
  // A plain systematic review lists Analysis from the start: appearing at the first include, it moved the rail mid-screening (2026-10-19).
  // An accuracy review pools sensitivity and specificity, not an effect between arms.
  if (type === 'dta-review') keys.splice(keys.indexOf('analysis'), 1, 'dta');
  // An umbrella review analyses its reviews: overlap and the credibility of what they report.
  if (type === 'umbrella-review') keys.splice(keys.indexOf('analysis'), 1, 'umbrella');
  // A network meta-analysis enters arms and fits the network in its own view.
  if (type === 'nma-review') keys.splice(keys.indexOf('analysis'), 1, 'nma');
  // A qualitative synthesis codes and themes findings, and rates confidence with CERQual.
  if (type === 'qualitative-review') {
    keys.splice(keys.indexOf('analysis'), 1, 'synthesis');
    keys.splice(keys.indexOf('certainty'), 1, 'confidence');
  }
  if (patientDataEnabled(s)) keys.splice(keys.indexOf('extraction') + 1, 0, 'patients');
  // A case series appraises its cases (JBI) and analyses its patients.
  if (type === 'case-series') keys.splice(keys.indexOf('extraction') + (patientDataEnabled(s) ? 2 : 1), 0, 'appraisal', 'analysis');
  // The researcher's own tables sit with the data, after the review's evidence tables.
  keys.splice(keys.indexOf('appraisal') > 0 ? keys.indexOf('appraisal') : keys.indexOf('extraction') + 1, 0, 'datasets');
  // Tables and figures sit beside the manuscript they are written for.
  return withOutputs([...keys, 'notes', 'notifications']);
}
const withOutputs = keys => { const at = keys.indexOf('manuscript'); return at < 0 || keys.includes('outputs') ? keys : [...keys.slice(0, at + 1), 'outputs', ...keys.slice(at + 1)]; };

export function projectName(s) {
  return s.project?.name?.trim() || s.paper?.title?.trim() || s.protocol?.title?.trim() || '';
}

// ---- target journal ---------------------------------------------------------
// One list, project.journals, whose first entry is the journal the manuscript
// is written for; paper.journal mirrors it for older readers. Protocol, Settings
// and setup all write through setJournals, so no page shows a different one.
// What follows from the target (reference style, journal profile) is worked out
// in lib/journal-context.mjs.
export { targetJournal, otherJournals, journalStyle, setJournals } from './journal-context.mjs';
