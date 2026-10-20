// One timer for every view that looks at the folder again while it is on screen (the explorer, the folder page).
// It runs only while the document is visible and someone is subscribed; hidden, it is cleared, and showing the page again
// ticks once at once so a change made meanwhile appears. Each tick runs the subscribers one after another, never overlapping.
const subs = new Set();
let timer = null, ms = 3000, running = false;

async function tick() {
  if (running || document.visibilityState !== 'visible') return;
  running = true;
  try { for (const fn of [...subs]) { try { await fn(); } catch { /* one view's failure does not stop the next */ } } } finally { running = false; }
}
function sync() {
  const want = subs.size > 0 && document.visibilityState === 'visible';
  if (want && !timer) timer = setInterval(tick, ms);
  else if (!want && timer) { clearInterval(timer); timer = null; }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { sync(); if (timer) tick(); });

/** Calls fn on every tick (about every `every` ms; the shortest asked for wins) while the document is visible. Returns the way to stop. */
export function pollFolder(fn, every = 3000) {
  subs.add(fn); ms = Math.min(ms, every); sync();
  return () => { subs.delete(fn); sync(); };
}
export const pollState = () => ({ subscribers: subs.size, running: timer !== null });
