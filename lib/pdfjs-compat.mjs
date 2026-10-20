// PDF.js 6 calls Map.prototype.getOrInsertComputed (and getOrInsert in its
// worker), from the upsert proposal. An engine without them draws no page:
// Chromium 141 failed every page with "getOrInsertComputed is not a function"
// (review of 2026-09-29), and the packaged window's WebKit may be older still.
// These add the two methods to Map and WeakMap where they are missing, in the
// page and, by a worker built from the same source, in PDF.js's worker.

// Written once as a function: the page calls it, and the worker gets its source
// through toString (the window's policy allows blob workers, not eval).
function addUpsert() {
  for (const C of [Map, WeakMap]) {
    const p = C.prototype;
    if (typeof p.getOrInsert !== 'function') Object.defineProperty(p, 'getOrInsert', { configurable: true, writable: true,
      value(key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); } });
    if (typeof p.getOrInsertComputed !== 'function') Object.defineProperty(p, 'getOrInsertComputed', { configurable: true, writable: true,
      value(key, compute) { if (!this.has(key)) this.set(key, compute(key)); return this.get(key); } });
  }
}
/** The polyfill as source, prepended to PDF.js's worker. */
export const COMPAT_SOURCE = `(${addUpsert.toString()})();\n`;

/** Whether this engine lacks a method PDF.js needs. */
export const needsCompat = () => typeof Map.prototype.getOrInsertComputed !== 'function' || typeof Map.prototype.getOrInsert !== 'function'
  || typeof WeakMap.prototype.getOrInsertComputed !== 'function' || typeof WeakMap.prototype.getOrInsert !== 'function';

/** Adds the methods in this realm (the page). */
export function installCompat() { if (needsCompat()) addUpsert(); }

/**
 * PDF.js's worker with the methods added first: the worker's own source is
 * fetched and the polyfill prepended, so both run in one module (a worker that
 * imported PDF.js after a first script could miss PDF.js's first message).
 * Returns a Worker to hand PDF.js as its workerPort, or null to use workerSrc.
 */
export async function compatWorker(workerSrc) {
  if (!needsCompat() || typeof Worker === 'undefined') return null;
  const text = await (await fetch(workerSrc)).text();
  const url = URL.createObjectURL(new Blob([COMPAT_SOURCE, text], { type: 'text/javascript' }));
  return new Worker(url, { type: 'module', name: 'pdfjs-worker' });
}
