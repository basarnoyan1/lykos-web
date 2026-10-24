// Getting started (views/guide.mjs): the steps of a systematic review in the order the work happens, each done or not from the project as it
// is, so a person new to reviews or to Lykos sees where they are and what comes next. Nothing is entered twice: every step reads the same state
// the pages write. Only the checks live here, so the sidebar's count costs little at start-up; the words are the page's. Pure: state in, steps out.
import { isIncluded } from './screen.mjs';
import { projectMode, researchType } from './workflow.mjs';
import { outcomes, analysisOf } from './outcomes.mjs';

const hasValue = (s, pid) => Object.keys(s.values || {}).some(k => k.startsWith(`${pid}:`));
const included = s => (s.papers || []).filter(p => isIncluded(s, p.id));

/** The steps in order, each with the check that says it is done. */
export const GUIDE_CHECKS = Object.freeze([
  ['question', s => Boolean((s.protocol?.title || s.paper?.title) && s.protocol?.criteria?.length)],
  ['search', s => Boolean(s.searches?.length || s.papers?.length)],
  ['screening', s => (s.papers || []).length > 0 && (s.papers || []).every(p => s.screening?.[p.id] && s.screening[p.id].decision !== 'uncertain')],
  ['fulltext', s => { const kept = (s.papers || []).filter(p => s.screening?.[p.id]?.decision === 'include'); return kept.length > 0 && kept.every(p => s.fulltext?.[p.id]?.decision); }],
  ['extraction', s => { const inc = included(s); return inc.length > 0 && inc.every(p => hasValue(s, p.id)); }],
  ['appraisal', s => { const inc = included(s); return inc.length > 0 && inc.every(p => Object.keys(s.assessments?.[p.id] || {}).length); }],
  ['analysis', s => outcomes(s).some(o => analysisOf(s, o.id))],
  ['certainty', s => (s.grade || []).length > 0],
  ['manuscript', s => (s.manuscript?.blocks || []).length > 0],
  ['submission', s => (s.submissions || []).length > 0],
]);

/** Whether the guide applies: a review project (a primary study or a case has its own order on the Overview). */
export const guideApplies = s => Boolean(projectMode(s)) && researchType(s).kind === 'review';

/** The steps of this project: [{ id, done, current }], `current` on the first that is not done; none when the guide does not apply. */
export function guideSteps(s) {
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
