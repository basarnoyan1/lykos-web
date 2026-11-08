// The stored journal profile and the review rounds as the store keeps them: the part of lib/manuscript-submission.mjs that store.mjs normalises on every
// load. The submission checks, the declarations and the decision-letter parser stay in lib/manuscript-submission.mjs, which re-exports these.
// The profile table itself (lib/journal-profiles.mjs) is not here, so the shell does not load it: a load asks only whether an id is one of its
// profiles, which PROFILE_IDS answers. `activeProfile`, which gives the profile, lives with the table, so nothing can read a profile before it is here.
import { newId } from './manuscript.mjs';

export const VARIETIES = ['us', 'uk'];

/**
 * The ids of the built-in profiles, generic and journal (lib/journal-profiles.mjs GENERIC_PROFILES, JOURNAL_PROFILES), in the table's order.
 * app/test/journal-profiles.test.mjs fails when the two differ: a profile added to the table is added here too.
 */
export const PROFILE_IDS = Object.freeze([
  'imrad-original', 'consort-abstract', 'prisma-abstract', 'case-report', 'letter', 'neurology-research-article',
  'turk-neurosurg-original-investigation', 'ijss-original-research', 'ulus-travma-acil-cerrahi-derg-research-article',
  'neurosurg-rev-original-article', 'jno-research-article', 'acta-neurochir-original-research-article', 'eur-spine-j-original-article',
  'j-neurol-original-communication', 'childs-nerv-syst-original-research-article', 'clin-exp-metastasis-research-article',
  'pituitary-research-article', 'neuroradiology-research', 'spine-deformity-original-article', 'indian-j-orthop-original-article',
  'nat-commun-article', 'sci-rep-article', 'neuro-onc-basic-translational-and-clinical-investigations', 'plos-one-research-article',
  'brain-original-article', 'oncogene-article', 'noro-psikiyatr-ars-original-article', 'surg-neurol-int-original-article',
  'diagn-interv-radiol-original-article', 'asian-spine-j-original-article', 'curr-drug-targets-research-article',
  'curr-neuropharmacol-research-article', 'j-integr-neurosci-original-research', 'j-korean-neurosurg-soc-clinical-article',
  'oncotarget-research-paper', 'neurospine-original-article',
]);
const KNOWN = new Set(PROFILE_IDS);

// ---- the stored journal profile ----------------------------------------------

/**
 * state.journalProfile as this version keeps it: null, or { id, variety,
 * custom, from? }. `from` is 'target' when the profile was set because the
 * target journal names it (lib/journal-context.mjs; a target change may then
 * replace it) and 'manual' when the author chose it; absent in a project saved
 * before it was recorded, which is treated as chosen by hand. `id` is a built-in profile's id, 'custom' for the author's own
 * profile (kept in `custom` whole, also while a generic one is chosen), or
 * null; `variety` is the spelling the consistency check expects ('us', 'uk'
 * or null). A custom profile that no longer validates is kept as the author
 * left it; `activeProfile` (lib/journal-profiles.mjs) then gives null.
 */
export function normalizeJournalProfile(jp) {
  if (!jp || typeof jp !== 'object' || Array.isArray(jp)) return null;
  const custom = jp.custom && typeof jp.custom === 'object' && !Array.isArray(jp.custom) ? { ...jp.custom } : null;
  const id = KNOWN.has(jp.id) ? jp.id : jp.id === 'custom' && custom ? 'custom' : null;
  const variety = VARIETIES.includes(jp.variety) ? jp.variety : null;
  // 'target' only describes a profile that is set; a chosen None (id null, from 'manual') keeps the target from setting one
  const from = jp.from === 'manual' || (jp.from === 'target' && id) ? jp.from : null;
  return id || custom || variety || from ? { id, variety, custom, ...(from ? { from } : {}) } : null;
}

// ---- review rounds -------------------------------------------------------------

const STATUSES = ['done', 'proposed'];
export function normalizePoint(p) {
  return {
    id: String(p?.id || newId()),
    reviewer: String(p?.reviewer || 'Reviewer 1'),
    n: Number.isInteger(p?.n) ? p.n : 1,
    text: String(p?.text || ''),
    ...(p?.section ? { section: String(p.section) } : {}),
    response: String(p?.response || ''),
    change: String(p?.change || ''),
    location: String(p?.location || ''),
    status: STATUSES.includes(p?.status) ? p.status : 'done',
  };
}

/** state.reviewRounds: [{ id, at, journal, manuscriptId, points }], anything else dropped. */
export function normalizeReviewRounds(rounds) {
  if (!Array.isArray(rounds)) return [];
  return rounds.filter(r => r && typeof r === 'object' && Array.isArray(r.points)).map(r => ({
    id: String(r.id || newId()),
    at: String(r.at || ''),
    journal: String(r.journal || ''),
    manuscriptId: String(r.manuscriptId || ''),
    points: r.points.map(normalizePoint),
  }));
}
