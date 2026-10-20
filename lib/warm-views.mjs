// Views loaded ahead (app.mjs, once the project is open): a first visit waited on the view's modules, 175 for Search
// (bench/perf/hosted.mjs). A rail item under the pointer, or reached by the keyboard, starts its view at once, and every rail view is
// loaded and prepared in idle time, one at a time in the rail's order. The owner chose this on 2026-10-19 knowing its cost: the seeded
// review's heap goes from 5.7 to 9.1 MB (app/tools/resource-budget.json). `load(k)` is the shell's viewOf, a no-op for a view already
// here. `globalThis.__lykosWarmed` resolves when the last one is in, so a measurement reads the settled shell, not a half-loaded one.
export function warmViews({ keys, load, lists }) {
  const warm = e => { const k = e.target.closest?.('button[data-k]')?.dataset.k; if (k) load(k); };
  for (const list of lists) { list?.addEventListener('pointerover', warm); list?.addEventListener('focusin', warm); }
  const idle = globalThis.requestIdleCallback || (f => setTimeout(f, 50));
  globalThis.__lykosWarmed = new Promise(done => {
    const next = () => { const k = keys.shift(); if (!k) return done(); idle(() => Promise.resolve(load(k)).finally(next), { timeout: 1500 }); };
    next();
  });
}
