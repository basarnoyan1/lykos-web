// Bringing in every record of a search (plan B6), and taking it up again.
//
// The download is a job that can be stopped. When a source refuses for the day
// (OpenAlex's allowance, lib/limiter.mjs AllowanceError) the run is not a
// failure: what was fetched is added, the search-log entry says it is paused
// with the offset it reached and the time it may go on, and `resumePaused`
// (called from the search view and by the hourly check) continues from that
// offset. The entry stays partial until the source has handed over everything
// it reported.
import { get, update, projectGeneration } from '../store.mjs';
import { runSearch, source as sourceOf, SOURCES } from './sources.mjs';
import { libraryIndex, addSearchRecords, fetchAll, libraryRecord } from './search-library.mjs';
import { run as runJob, running } from './jobs.mjs';

export const CAP = 10000;

/** Runs that stopped for an allowance and are due to continue. */
export const pausedRuns = (s = get()) => (s.searches || []).map((r, i) => ({ r, i })).filter(({ r }) => r.paused);
export const isDuePaused = (r, now = Date.now()) => Boolean(r.paused) && now >= Number(r.paused.resumeAt || 0);

/**
 * Downloads a search's records into the library. `entry` is the index of the
 * search-log entry that owns the run; `start` the offset to continue from.
 * Answers the job's outcome text.
 */
export function addAll({ query, sourceId, total, dest = '', entry = null, start = 0, settings, label = '' }) {
  // the run belongs to this project until it is replaced (the store's generation): an edit made meanwhile (a proposal accepted, a
  // decision) does not stop it, as comparing the state object did
  const src = sourceOf(sourceId), n = Math.min(total, CAP), owner = projectGeneration();
  return runJob('search', label || `${src.name}: all ${n.toLocaleString()} records`, async h => {
    h.progress('Retrieving');
    const got = await fetchAll((offset, limit) => runSearch(sourceId, query, { offset, limit, settings }),
      { total, start, stopped: () => h.stopped() || projectGeneration() !== owner, onPage: (done, of) => h.count(done, of - start) });
    if (projectGeneration() !== owner) return 'Project changed';
    let added = 0;
    update(st => {
      const log = st.searches || [];
      const e = entry != null && log[entry]?.query === query ? log[entry] : null;
      // Each record remembers the run that brought it (plan B7), so running
      // Add all again does not count this run's own records as duplicates.
      const runId = e?.at || new Date().toISOString();
      const index = libraryIndex(st.papers);
      const dup = got.records.filter(r => { const p = index.find(r); return p && p.searchRun !== runId; }).length;
      added = addSearchRecords(st, got.records.map(r => ({ ...libraryRecord(r), searchRun: runId })), dest);
      const before = start && e ? Number(e.retrieved) || 0 : 0;
      const fields = { total: got.total, retrieved: before + got.records.length, status: got.complete ? 'complete' : 'partial',
        ...(dup || (start && e?.duplicates) ? { duplicates: (start && e ? Number(e.duplicates) || 0 : 0) + dup } : {}) };
      const paused = got.paused ? { offset: got.offset, resumeAt: got.paused.resumeAt, dest, sourceId } : null;
      if (e) { Object.assign(e, fields); if (!fields.duplicates) delete e.duplicates; if (paused) e.paused = paused; else delete e.paused; }
      else st.searches = [...log, { at: runId, query, source: src.name, kind: src.kind, ...fields, ...(paused ? { paused } : {}) }];
      return st;
    });
    return `${added.toLocaleString()} added, ${got.records.length.toLocaleString()} retrieved${got.complete ? '' : got.paused ? `; paused, ${src.name} allowance used up` : ', incomplete'}`;
  }, { allOf: query });
}

/**
 * Continues every paused run whose time has come, one after another. Safe to
 * call often; a run whose source is still closed pauses again at once.
 */
export async function resumePaused({ settings, now = Date.now() } = {}) {
  const out = [];
  for (const { r, i } of pausedRuns()) {
    if (!isDuePaused(r, now)) continue;
    if (running().some(j => j.kind === 'search' && j.allOf === r.query)) continue;
    const id = SOURCES.find(x => x.name === r.source)?.id || r.paused.sourceId;
    if (!id) continue;
    try { out.push({ index: i, message: await addAll({ query: r.query, sourceId: id, total: Number(r.total) || 0, dest: r.paused.dest || '', entry: i, start: Number(r.paused.offset) || 0, settings }) }); }
    catch (error) { out.push({ index: i, error: String(error?.message || error) }); }
  }
  return out;
}
