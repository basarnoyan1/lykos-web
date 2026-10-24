// A submission's steps at a journal and the status lines of the common editorial systems (Submission > Record update > Status),
// each line with the step it names. Loaded by the Submission page only, so the startup graph does not carry them.
import { wordOf } from './submissions.mjs';

/** A journal's steps, one round at a time. */
export const STAGES = Object.freeze([['submitted', 'Submitted'], ['editor', 'With editor'], ['review', 'Under review'], ['reviewed', 'Reviews completed'], ['decision', 'Decision']]);
const STAGE_INDEX = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
/** The step a status line's words name, for a line not in the lists. */
export function stageOfWords(phrase) {
  const p = String(phrase || '').toLowerCase();
  return /decision/.test(p) ? 'decision' : /complete|recommend|ready/.test(p) ? 'reviewed' : /review|referee/.test(p) ? 'review'
    : /editor|assess|eic|\bae\b/.test(p) ? 'editor' : /submit|received|admin|quality/.test(p) ? 'submitted' : 'review';
}
/** { round, at (STAGES index), outcome }: submitted or revised starts a round, a status line moves it on, a decision ends it. */
export function progressOf(a) {
  let round = 0, at = -1, outcome = '';
  for (const e of a?.events || []) {
    if (e.kind === 'submitted' || e.kind === 'revised') { round++; at = 0; outcome = ''; }
    else if (e.kind === 'status') at = Math.max(at, STAGE_INDEX[e.stage] ?? STAGE_INDEX[stageOfWords(e.phrase)]);
    else if (['revise', 'accepted', 'rejected', 'published'].includes(e.kind)) { at = STAGES.length - 1; outcome = wordOf(e); }
    else if (e.kind === 'withdrawn') { outcome = wordOf(e); }
  }
  return { round, at, outcome };
}


/**
 * The status lines the common editorial systems show, each with its step. `match` finds the system from the submission's System field.
 * Decisions (revise, accept, reject) are outcomes, not status lines: they are recorded with Record update.
 */
export const SYSTEM_PHRASES = Object.freeze([
  { system: 'Editorial Manager', match: /editorial ?manager|\bem\b|elsevier|springer/i, phrases: [
    ['Submitted to Journal', 'submitted'], ['Revision Submitted to Journal', 'submitted'], ['With Editor', 'editor'], ['Editor Assigned', 'editor'],
    ['Editor Invited', 'editor'], ['Reviewers Invited', 'review'], ['Reviewers Assigned', 'review'], ['Under Review', 'review'],
    ['Required Reviews Completed', 'reviewed'], ['Ready for Decision', 'reviewed'], ['Decision in Process', 'decision']] },
  { system: 'Elsevier Track your submission', match: /track|elsevier/i, phrases: [
    ['Submitted to journal', 'submitted'], ['With editor', 'editor'], ['Under review', 'review'], ['Review complete', 'reviewed'],
    ['Ready for decision', 'reviewed'], ['Decision in process', 'decision']] },
  { system: 'ScholarOne', match: /scholar ?one|manuscript ?central/i, phrases: [
    ['Awaiting Admin Processing', 'submitted'], ['Awaiting EIC Assignment', 'editor'], ['Awaiting AE Assignment', 'editor'],
    ['Awaiting Reviewer Selection', 'editor'], ['Awaiting Reviewer Invitation', 'review'], ['Awaiting Reviewer Assignment', 'review'],
    ['Awaiting Reviewer Scores', 'review'], ['Awaiting AE Recommendation', 'reviewed'], ['Awaiting EIC Decision', 'decision'],
    ['Decision in Process', 'decision']] },
  { system: 'Springer Nature (SNAPP)', match: /snapp|springer ?nature|nature/i, phrases: [
    ['Submitted', 'submitted'], ['Editor assigned', 'editor'], ['Under review', 'review'], ['Reviews completed', 'reviewed'], ['Decision pending', 'decision']] },
  { system: 'Wiley Research Exchange', match: /research ?exchange|wiley|rex/i, phrases: [
    ['Submission received', 'submitted'], ['Initial quality check', 'submitted'], ['Editorial assessment', 'editor'], ['Under review', 'review'],
    ['Reviews complete', 'reviewed'], ['Decision pending', 'decision']] },
  { system: 'Other systems', match: /$^/, phrases: [
    ['With editor', 'editor'], ['Under review', 'review'], ['Reviews completed', 'reviewed'], ['Awaiting decision', 'decision']] },
]);
/** The phrase lists for a submission's System field: the matching system first, then the rest. */
export function phraseGroups(system = '') {
  const hit = SYSTEM_PHRASES.filter(g => system && g.match.test(system));
  return [...hit, ...SYSTEM_PHRASES.filter(g => !hit.includes(g))];
}
/** The step a phrase names: the systems' own lists first, then the words it holds. */
export function stageOfPhrase(phrase) {
  const p = String(phrase || '').trim().toLowerCase();
  for (const g of SYSTEM_PHRASES) for (const [w, st] of g.phrases) if (w.toLowerCase() === p) return st;
  return stageOfWords(phrase);
}
