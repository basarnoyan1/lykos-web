// Project-state adapters for local duplicate analysis.
import { get, update, projectGeneration } from '../store.mjs';
import { findDuplicates as analyze, createDuplicateIndexAsync, duplicateFingerprint, mergeRecords, unmergeRecords, pairKey, signature } from './dedup-core.mjs';

export { mergeRecords, unmergeRecords } from './dedup-core.mjs';
export function findDuplicates(papers = get().papers, dismissed = get().dedupDismissed || []) {
  return analyze(papers, dismissed);
}
let review = null;
export function resetDuplicateReview() { review?.controller.abort(); review = null; }
/** The visible page is computed cooperatively from frozen bibliographic inputs.
 * Identifying edits invalidate it; unrelated project edits reuse it. */
export function duplicateReview(page = 1, size = 15, onReady = () => {}) {
  const state = get(), epoch = projectGeneration(), fingerprint = duplicateFingerprint(state.papers, state.dedupDismissed || []);
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
  const view = job.pages.get(key), records = new Map(state.papers.map(p => [p.id, p]));
  return { pending: !view, total: job.index.total, counts: job.index.counts, page: current, pages: Math.max(1, Math.ceil(job.index.total / size)),
    items: (view?.items || []).map(pair => ({ ...pair, a: records.get(pair.a.id), b: records.get(pair.b.id) })) };
}
export function markDistinct(aId, bId) {
  update(s => {
    const a = s.papers.find(p => p.id === aId), b = s.papers.find(p => p.id === bId);
    if (!a || !b) return s;
    s.dedupDismissed = [...(s.dedupDismissed || []).filter(x => pairKey(x.a, x.b) !== pairKey(aId, bId)),
      { a: aId, b: bId, signature: signature(a, b) }];
    return s;
  });
}
export function undoDistinct(aId, bId) {
  update(s => { s.dedupDismissed = (s.dedupDismissed || [])
    .filter(x => pairKey(x.a, x.b) !== pairKey(aId, bId)); return s; });
}
export function merge(keepId, dupId) { update(s => mergeRecords(s, keepId, dupId)); }
export function unmerge(keepId, dupId) { update(s => unmergeRecords(s, keepId, dupId)); }
