// Off-thread JSON preparation. postMessage still clones the input on the
// caller thread; this moves stringify, not every large-project cost.
export function serializeProject(value) {
  if (typeof Worker === 'undefined') return Promise.resolve(JSON.stringify(value));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./serialize-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = e => { worker.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.text); };
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'Project serialization failed')); };
    try { worker.postMessage(value); } catch (e) { worker.terminate(); reject(e); }
  });
}
