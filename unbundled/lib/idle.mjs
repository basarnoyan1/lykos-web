// Idle time for work nobody waits on. WebKit (the desktop app) has no requestIdleCallback: there it runs after the next frame once no input
// came for QUIET ms, by `timeout` at the latest (17 Nov 2026: fixed timers ran it under a moving pointer and held its hover).
export const QUIET = 300;
let last = -Infinity;
const now = () => performance.now();
for (const t of ['pointermove', 'pointerdown', 'keydown', 'wheel']) globalThis.addEventListener?.(t, () => { last = now(); }, { capture: true, passive: true });
export function idle(fn, { timeout = 2000 } = {}) {
  if (globalThis.requestIdleCallback) return void requestIdleCallback(fn, { timeout });
  const at = now(), frame = globalThis.requestAnimationFrame || (f => setTimeout(f, 0));
  const check = () => { const t = now(), wait = Math.min(QUIET - (t - last), timeout - (t - at)); if (wait > 0 && QUIET > t - last) setTimeout(check, Math.ceil(wait)); else frame(() => setTimeout(fn, 0)); };
  check();
}
