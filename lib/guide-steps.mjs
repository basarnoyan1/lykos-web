// Getting started (views/guide.mjs): the steps of a systematic review in the order the work happens, each done or not from the project as it
// is, so a person new to reviews or to Lykos sees where they are and what comes next. Nothing is entered twice: every step reads the same state
// the pages write. Only the checks live here, so the sidebar's count costs little at start-up; the words are the page's. Pure: state in, steps out.
import { lib_screen$isIncluded as isIncluded } from "../boot.mjs";
import { lib_workflow$projectMode as projectMode, lib_workflow$researchType as researchType } from "../boot.mjs";
import { lib_outcomes$outcomes as outcomes, lib_outcomes$analysisOf as analysisOf } from "../boot.mjs";
import { lib_review_studies$reviewStudies as reviewStudies, lib_review_studies$perVersion as perVersion } from "../boot.mjs";

const withValues = s => { const ids = new Set(); for (const k of Object.keys(s.values || {})) { const i = k.indexOf(':'); if (i > 0) ids.add(k.slice(0, i)); } return ids; };
// a review's studies: its trials with a full-text include, linked reports apart (lib/review-studies.mjs, 31 Oct 2026: the steps read 2 of 10
// for a review whose 40 includes waiting for their full text and 19 linked reports counted as studies without values or risk of bias)
const included = s => (projectMode(s) === 'workspace' ? (s.papers || []).filter(p => isIncluded(s, p.id)) : reviewStudies(s).studies);
const appraised = (s, id) => Object.keys(s.assessments?.[id] || {}).length > 0 || Object.keys(s.robReview?.records?.[id] || {}).length > 0;

/** The steps in order, each with the check that says it is done. */
export const GUIDE_CHECKS = Object.freeze([
  ['question', s => Boolean((s.protocol?.title || s.paper?.title) && s.protocol?.criteria?.length)],
  ['search', s => Boolean(s.searches?.length || s.papers?.length)],
  // a record awaiting classification (PRISMA 2020) is decided as that: it does not hold screening open
  ['screening', s => (s.papers || []).length > 0 && reviewStudies(s).taOpen.length === 0],
  ['fulltext', s => { const kept = (s.papers || []).filter(p => s.screening?.[p.id]?.decision === 'include'); return kept.length > 0 && kept.every(p => s.fulltext?.[p.id]?.decision); }],
  ['extraction', s => { const inc = included(s); if (!inc.length) return false; const ids = withValues(s); return inc.every(p => ids.has(p.id)); }],
  ['appraisal', s => { const inc = included(s); return inc.length > 0 && inc.every(p => appraised(s, p.id)); }],
  // analyses and a manuscript the project's scripts built, registered with register_output (lib/review-state.mjs externalOutputs), count
  ['analysis', s => outcomes(s).some(o => analysisOf(s, o.id)) || Boolean(s.externalOutputs?.analysis?.file)],
  ['certainty', s => (s.grade || []).length > 0],
  ['manuscript', s => (s.manuscript?.blocks || []).length > 0 || Boolean(s.externalOutputs?.manuscript?.file)],
  ['submission', s => (s.submissions || []).length > 0],
]);

/** Whether the guide applies: a review project (a primary study or a case has its own order on the Overview). */
export const guideApplies = s => Boolean(projectMode(s)) && researchType(s).kind === 'review';

/** The steps of this project: [{ id, done, current }], `current` on the first that is not done; none when the guide does not apply. */
export const guideSteps = perVersion(stepsOf);
function stepsOf(s) {
  if (!guideApplies(s)) return [];
  const out = GUIDE_CHECKS.map(([id, done]) => ({ id, done: Boolean(done(s)) }));
  const at = out.findIndex(x => !x.done);
  if (at >= 0) out[at].current = true;
  return out;
}

/** "3/10": the steps done, for the sidebar; '' when the guide does not apply. */
export function guideCount(s) {
  const steps = guideSteps(s);
  return steps.length ? `${steps.filter(x => x.done).length}/${steps.length}` : '';
}
