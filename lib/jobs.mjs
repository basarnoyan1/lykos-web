// The job log: every piece of long-running or scheduled work, recorded.
//
// Plan §4.2 asks that work which takes time or runs unattended be a job with a
// start, an end, an outcome and a log — so a search that ran overnight, an
// analysis that took a minute, or an export can be seen afterwards, not only
// while it spins. Jobs are records in the project, capped so the log cannot
// grow without bound.
import { get, update as storeUpdate, subscribe, projectGeneration } from '../store.mjs';
import { jobNotification } from './notifications.mjs';
// These reducers touch only the job log and its notifications, never research inputs.
const update = fn => storeUpdate(fn, { indexNeutral: true });

const KEEP = 200;
const listeners = new Set();

// Progress is said often — a count per record — and is held here, not in the
// project: a write to the project repaints the view, and a view repainted
// every few hundred milliseconds replaces the button under a pressing finger.
// A job's start and end are recorded; its progress only reaches the status bar.
const live = new Map();
const counts = new Map();
const tick = () => { for (const fn of liveListeners) fn(); };
const liveListeners = new Set();
/** Called when any running job reports progress. */
export const onProgress = fn => { liveListeners.add(fn); return () => liveListeners.delete(fn); };

export const jobs = () => get().jobs || [];
export const running = () => jobs().filter(j => j.status === 'running').map(j => ({ ...j,
  ...(live.has(j.id) ? { progress: live.get(j.id) } : {}), ...(counts.get(j.id) || {}) }));

const nid = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Begin a job. Returns handles to report progress and finish it. */
export function start(kind, label, meta = {}) {
  const generation = projectGeneration();
  const id = nid();
  const job = { id, kind, label, status: 'running', startedAt: new Date().toISOString(),
    endedAt: null, progress: '', done: 0, total: 0, stop: false, result: null, error: null, ...meta };
  update(s => {
    s.jobs = [job, ...(s.jobs || [])].slice(0, KEEP);
    return s;
  });
  const set = patch => { if (projectGeneration() !== generation) return; update(s => {
    const j = (s.jobs || []).find(x => x.id === id);
    if (j) { Object.assign(j, patch); jobNotification(s, j); }
    return s;
  }); };
  return {
    id,
    progress: text => { live.set(id, String(text || '')); tick(); },
    /** Numeric progress, for a bar: done of total. Held in memory like the text. */
    count: (done, total) => { counts.set(id, { done, total }); tick(); },
    /** True once someone asked this job to stop; long loops check it between steps. */
    stopped: () => projectGeneration() !== generation || !!jobs().find(x => x.id === id)?.stop,
    done: result => { live.delete(id); counts.delete(id); set({ status: 'done', endedAt: new Date().toISOString(), result: result ?? null, progress: '' }); },
    cancel: () => { live.delete(id); counts.delete(id); set({ status: 'stopped', endedAt: new Date().toISOString(), result: 'Stopped', progress: '' }); },
    fail: err => { live.delete(id); counts.delete(id); set({ status: 'failed', endedAt: new Date().toISOString(), error: String(err?.message || err || 'failed'), progress: '' }); },
  };
}

/** Run `fn(handle)` as a job; the outcome is recorded whichever way it ends. */
export async function run(kind, label, fn, meta = {}) {
  const h = start(kind, label, meta);
  try {
    const out = await fn(h);
    h.done(out);
    return out;
  } catch (err) {
    if (err?.name === 'AbortError' || h.stopped()) h.cancel(); else h.fail(err);
    throw err;
  }
}

/** Ask a running job to stop; it ends on its next check and records itself as stopped. */
export function cancel(id) {
  update(s => { const j = (s.jobs || []).find(x => x.id === id); if (j && j.status === 'running') j.stop = true; return s; });
}

/** Jobs left "running" by a previous session did not finish; say so. */
export function reconcile() {
  update(s => {
    for (const j of s.jobs || [])
      if (j.status === 'running') { j.status = 'failed'; j.error = 'interrupted'; j.endedAt = j.endedAt || new Date().toISOString(); jobNotification(s, j); }
    return s;
  });
}

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
subscribe(() => { for (const fn of listeners) fn(); });
