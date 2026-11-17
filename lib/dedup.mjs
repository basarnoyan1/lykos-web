// Project-state adapters for local duplicate analysis.
import { store$get as get, store$getVersion as getVersion, store$update as update, store$projectGeneration as projectGeneration, store$withSections as withSections } from "../boot.mjs";
import { findDuplicates as analyze, createDuplicateIndexAsync, duplicateFingerprint, pairKey, markDistinctIn } from './dedup-core.mjs';
import { mergeRecords, unmergeRecords } from './dedup-merge.mjs';

export { mergeRecords, unmergeRecords } from './dedup-merge.mjs';
export function findDuplicates(papers = get().papers, dismissed = get().dedupDismissed || []) {
  return analyze(papers, dismissed);
}
let review = null;
// What a paint needs from every record (the review's fingerprint, the records by id), once per project version (F22, 9 Nov 2026): a
// paint, a page turn or a redraw with no edit between walks none of Sham's 30,000 records.
let seen = { key: '', fingerprint: '', byId: null };
function projectFacts(state = get()) {
  const key = `${projectGeneration()}:${getVersion()}`;
  if (seen.key !== key) seen = { key, fingerprint: duplicateFingerprint(state.papers, state.dedupDismissed || []), byId: new Map(state.papers.map(p => [p.id, p])) };
  return seen;
}
/** The open project's records by id, as of its current version. */
export const recordsById = () => projectFacts().byId;
export function resetDuplicateReview() { review?.controller.abort(); review = null; }
/** The visible page is computed cooperatively from frozen bibliographic inputs.
 * Identifying edits invalidate it; unrelated project edits reuse it. */
export function duplicateReview(page = 1, size = 15, onReady = () => {}) {
  const state = get(), epoch = projectGeneration(), { fingerprint, byId: records } = projectFacts(state);
  if (!review || review.epoch !== epoch || review.fingerprint !== fingerprint) {
    review?.controller.abort();
    const job = review = { epoch, fingerprint, controller: new AbortController(), index: null, pages: new Map(), requests: new Set(), error: '' };
    const frozen = structuredClone(state.papers), distinct = structuredClone(state.dedupDismissed || []);
    createDuplicateIndexAsync(frozen, distinct, { signal: job.controller.signal }).then(index => {
      if (review !== job || projectGeneration() !== epoch) return;
      job.index = index; onReady();
    }).catch(error => { if (review === job && !job.controller.signal.aborted && projectGeneration() === epoch) { job.error = String(error.message || error); onReady(); } });
  }
  const job = review;
  if (job.error) return { pending: false, error: job.error, total: null, counts: null, page: 1, pages: 1, items: [] };
  if (!job.index) return { pending: true, total: null, counts: null, page, pages: 1, items: [] };
  const current = Math.max(1, Math.min(Math.max(1, Math.ceil(job.index.total / size)), page)), key = `${current}:${size}`;
  if (!job.pages.has(key) && !job.requests.has(key)) {
    job.requests.add(key);
    job.index.pageAsync(current, size, { signal: job.controller.signal }).then(view => {
      if (review !== job || projectGeneration() !== epoch) return;
      job.requests.delete(key); job.pages.set(key, view); if (job.pages.size > 8) job.pages.delete(job.pages.keys().next().value); onReady();
    }).catch(error => { if (review === job && !job.controller.signal.aborted && projectGeneration() === epoch) { job.error = String(error.message || error); job.requests.delete(key); onReady(); } });
  }
  const view = job.pages.get(key);
  return { pending: !view, total: job.index.total, counts: job.index.counts, page: current, pages: Math.max(1, Math.ceil(job.index.total / size)),
    items: (view?.items || []).map(pair => ({ ...pair, a: records.get(pair.a.id), b: records.get(pair.b.id) })) };
}
export function markDistinct(aId, bId) { update(s => { markDistinctIn(s, aId, bId); return s; }); }
export function undoDistinct(aId, bId) {
  update(s => { s.dedupDismissed = (s.dedupDismissed || [])
    .filter(x => pairKey(x.a, x.b) !== pairKey(aId, bId)); return s; });
}
export function merge(keepId, dupId) { return withSections('scenarioPapers', () => update(s => mergeRecords(s, keepId, dupId))); }   // the reducer reads the scenario records (plan §4.15)
export function unmerge(keepId, dupId) { return withSections('scenarioPapers', () => update(s => unmergeRecords(s, keepId, dupId))); }
