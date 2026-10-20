// Scheduled work: a saved search that runs again on a cadence and reports
// what is new.
//
// A living review re-runs its searches. The schedule records the query, the
// source, the interval and when it last ran; the app checks what is due when
// it opens and every hour it stays open, runs it as a job, and marks records
// it has not seen before as new, so they surface in the overview and in
// screening rather than vanishing into the library. Nothing runs while the
// app is closed — this is a desktop app, not a server — so a schedule's next
// run is "the first time the app is open after it falls due".
import { get, update } from '../store.mjs';
import { runSearch } from './sources.mjs';
import { run as runJob } from './jobs.mjs';
import { libraryIndex, noteSource, libraryRecord } from './search-library.mjs';

export const INTERVALS = [
  { id: 'daily', label: 'Every day', ms: 24 * 3600e3 },
  { id: 'weekly', label: 'Every week', ms: 7 * 24 * 3600e3 },
  { id: 'monthly', label: 'Every month', ms: 30 * 24 * 3600e3 },
];

export const schedules = () => get().schedules || [];

const nid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function add({ query, sourceId, sourceName, interval = 'weekly' }) {
  const id = nid();
  update(s => {
    s.schedules = [...(s.schedules || []), {
      id, query, sourceId, sourceName, interval, enabled: true,
      createdAt: new Date().toISOString(), lastRun: null, lastNew: 0, lastTotal: 0,
    }];
    return s;
  });
  return id;
}

export const remove = id => update(s => { s.schedules = (s.schedules || []).filter(x => x.id !== id); return s; });
export const toggle = (id, on) => update(s => { const x = (s.schedules || []).find(y => y.id === id); if (x) x.enabled = on; return s; });
export const setInterval_ = (id, interval) => update(s => { const x = (s.schedules || []).find(y => y.id === id); if (x) x.interval = interval; return s; });

export function isDue(sc, now = Date.now()) {
  if (!sc.enabled) return false;
  // a source that refused for the day is not asked again before it said it would answer
  if (sc.pausedUntil && now < sc.pausedUntil) return false;
  const every = INTERVALS.find(i => i.id === sc.interval)?.ms || INTERVALS[1].ms;
  return !sc.lastRun || now - new Date(sc.lastRun).getTime() >= every;
}

export const nextRun = sc => {
  const every = INTERVALS.find(i => i.id === sc.interval)?.ms || INTERVALS[1].ms;
  return sc.lastRun ? new Date(new Date(sc.lastRun).getTime() + every) : new Date();
};

/**
 * Run one schedule now: fetch up to `limit` records, add the ones the library
 * does not have, marked new, and log the run. Returns what was new.
 */
export async function runSchedule(id, { limit = 100, settings } = {}) {
  const sc = schedules().find(x => x.id === id);
  if (!sc) throw new Error('no such schedule');
  return runJob('search', `${sc.sourceName}: ${sc.query}`, async h => {
    h.progress('Searching');
    let r;
    try { r = await runSearch(sc.sourceId, sc.query, { offset: 0, limit, settings }); }
    catch (err) {
      // OpenAlex's daily allowance: pause this schedule until it renews (lastRun stays, so it runs then), and say so
      if (err?.name !== 'AllowanceError') throw err;
      update(s => { const x = (s.schedules || []).find(y => y.id === id); if (x) { x.pausedUntil = err.resumeAt; x.pauseReason = err.message; } return s; });
      return { paused: true, resumeAt: err.resumeAt, message: err.message };
    }
    const fresh = [];
    update(s => {
      // the same work by key, DOI or PMID: a record another source brought in is not new
      const have = libraryIndex(s.papers);
      for (const rec of r.records) {
        const known = have.find(rec);
        if (known) { noteSource(known, r.source); continue; }
        const p = { ...libraryRecord(rec), isNew: true, foundBy: id, foundAt: new Date().toISOString() };
        s.papers.push(p); fresh.push(p); have.add(p);
      }
      // the run is also a search-log entry, so PRISMA counts see it
      const dup = r.records.length - fresh.length;
      s.searches = [...(s.searches || []), { at: new Date().toISOString(), query: sc.query,
        total: r.total, retrieved: r.records.length, ...(dup ? { duplicates: dup } : {}), source: r.source, kind: r.kind,
        status: r.records.length >= r.total ? 'complete' : 'partial', scheduled: true }];
      const x = (s.schedules || []).find(y => y.id === id);
      if (x) { x.lastRun = new Date().toISOString(); x.lastNew = fresh.length; x.lastTotal = r.total; delete x.pausedUntil; delete x.pauseReason; }
      return s;
    });
    return { total: r.total, retrieved: r.records.length, fresh: fresh.length };
  }, { scheduleId: id });
}

/** Run whatever is due. Called on open and on a timer; safe to call often. */
export async function runDue({ settings } = {}) {
  const due = schedules().filter(sc => isDue(sc));
  const out = [];
  for (const sc of due) {
    try { out.push({ id: sc.id, ...(await runSchedule(sc.id, { settings })) }); }
    catch (err) { out.push({ id: sc.id, error: String(err.message || err) }); }
  }
  return out;
}
