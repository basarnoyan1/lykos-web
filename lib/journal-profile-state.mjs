// The stored journal profile and the review rounds as the store keeps them: the part of lib/manuscript-submission.mjs that store.mjs normalises on every
// load. The submission checks, the declarations and the decision-letter parser stay in lib/manuscript-submission.mjs, which re-exports these.
import { profileById, validateProfile } from './journal-profiles.mjs';
import { newId } from './manuscript.mjs';

export const VARIETIES = ['us', 'uk'];

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
 * left it; `activeProfile` then gives null.
 */
export function normalizeJournalProfile(jp) {
  if (!jp || typeof jp !== 'object' || Array.isArray(jp)) return null;
  const custom = jp.custom && typeof jp.custom === 'object' && !Array.isArray(jp.custom) ? { ...jp.custom } : null;
  const id = profileById(jp.id) ? jp.id : jp.id === 'custom' && custom ? 'custom' : null;
  const variety = VARIETIES.includes(jp.variety) ? jp.variety : null;
  // 'target' only describes a profile that is set; a chosen None (id null, from 'manual') keeps the target from setting one
  const from = jp.from === 'manual' || (jp.from === 'target' && id) ? jp.from : null;
  return id || custom || variety || from ? { id, variety, custom, ...(from ? { from } : {}) } : null;
}

/** The profile the checks run against, or null when none is chosen or the custom one is invalid. */
export function activeProfile(jp) {
  const n = normalizeJournalProfile(jp);
  if (!n?.id) return null;
  if (n.id !== 'custom') return profileById(n.id);
  return validateProfile(n.custom).length ? null : n.custom;
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
