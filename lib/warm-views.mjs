// Views loaded ahead (app.mjs, once the project is open): a first visit waited on the view's modules, 175 for Search
// (bench/perf/hosted.mjs). A rail item under the pointer, or reached by the keyboard, starts its view at once, and the views next to the
// one on screen (the rail's neighbors, AHEAD_EACH_SIDE on each side) load in idle time, again whenever another view becomes current. Until
// 24 October 2026 every rail view loaded ahead (the owner's choice of 2026-10-19): 735 modules and 9.7 MB of JS after 1.5 s on the ASD
// review, against 500 now, for a pointer that reaches a rail item well before the click (docs/footprint-2026-10.md).
// `load(k)` is the shell's viewOf, a no-op for a view already here. `globalThis.__lykosWarmed` resolves when the first neighbors are in,
// so a measurement reads the settled shell, not a half-loaded one.
export const AHEAD_EACH_SIDE = 1;

/** The keys to load ahead around `current` in the rail order `keys`: its neighbors, nearest first. */
export function nearKeys(keys, current, near = AHEAD_EACH_SIDE) {
  const i = keys.indexOf(current), out = [];
  if (i < 0) return keys.slice(0, near);
  for (let d = 1; d <= near; d++) for (const j of [i + d, i - d]) if (j >= 0 && j < keys.length) out.push(keys[j]);
  return out;
}

export function warmViews({ keys, load, lists, current = () => null }) {
  const warm = e => { const k = e.target.closest?.('button[data-k]')?.dataset.k; if (k) load(k); };
  for (const list of lists) { list?.addEventListener('pointerover', warm); list?.addEventListener('focusin', warm); }
  const idle = globalThis.requestIdleCallback || (f => setTimeout(f, 50));
  const queue = [];
  let running = null;
  const drain = () => running || (running = new Promise(done => {
    const next = () => { const k = queue.shift(); if (!k) { running = null; return done(); } idle(() => Promise.resolve(load(k)).finally(next), { timeout: 1500 }); };
    next();
  }));
  const around = k => { for (const n of nearKeys(keys, k)) if (!queue.includes(n)) queue.push(n); return drain(); };
  globalThis.__lykosWarmed = around(current());
  // the shell marks the view on screen with aria-current on its rail button: its neighbors are the likely next ones
  if (typeof MutationObserver === 'function') {
    const seen = new MutationObserver(records => {
      for (const r of records) if (r.target.getAttribute?.('aria-current') === 'page' && r.target.dataset?.k) around(r.target.dataset.k);
    });
    for (const list of lists) if (list) seen.observe(list, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  }
}
