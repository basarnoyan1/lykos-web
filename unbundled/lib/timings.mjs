// How long the app's own background and save work took, kept in memory for the measurements (tools/measure-speed-tour.js reads it to see
// which work overlaps a late frame): the last 400 { name, start, ms } entries, start in performance.now() time. Costs one push per entry.
const MAX = 400;
const list = [];
export function timing(name, start, end = performance.now()) {
  list.push({ name, start: Math.round(start), ms: Math.round(end - start) });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  return end;
}
/** Runs fn and records how long it took, synchronous or not. */
export function timed(name, fn) {
  const t = performance.now();
  let r;
  try { r = fn(); } catch (e) { timing(name, t); throw e; }
  if (r && typeof r.then === 'function') return r.finally(() => timing(name, t));
  timing(name, t);
  return r;
}
/** A measurement build's `<name> (main)`: what of an async job held the main thread (gaps over 8 ms in one shared timer chain while jobs
 *  run; a job not settled in 10 s is dropped, so a hung one costs nothing), not its waits. */
const jobs = new Set();
let sampling = false, last = 0;
function sample() {
  const now = performance.now(), gap = now - last > 8 ? now - last : 0;
  last = now;
  for (const j of jobs) { j.held += gap; if (now - j.start > 10_000) jobs.delete(j); }
  sampling = jobs.size > 0;
  if (sampling) setTimeout(sample, 0);
}
export function busy(name, job) {
  if (!globalThis.__lykosMeasureTour || !job?.finally) return job;
  const j = { start: performance.now(), held: 0 };
  jobs.add(j);
  if (!sampling) { sampling = true; last = j.start; setTimeout(sample, 0); }
  return job.finally(() => { if (jobs.delete(j)) timing(`${name} (main)`, j.start, j.start + j.held); });
}
export const timings = () => list.slice();
if (typeof globalThis !== 'undefined') globalThis.__lykosTimings = timings;
