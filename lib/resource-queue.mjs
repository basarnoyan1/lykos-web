// Serialized, owned evaluations: a cancelled client cannot interrupt another.
export const stoppedError = () => new DOMException('Work stopped', 'AbortError');
export class ResourceQueue {
  constructor({ maxPending = 16 } = {}) { this.maxPending = maxPending; this.pending = []; this.active = null; }
  get size() { return this.pending.length + Number(!!this.active); }
  run(work, options = {}) {
    const { signal, interrupt = () => {} } = options;
    if (signal?.aborted) return Promise.reject(stoppedError());
    if (this.pending.length >= this.maxPending) return Promise.reject(new Error('The work queue is full. Wait for a running task or cancel it.'));
    return new Promise((resolve, reject) => {
      const entry = { work, signal, interrupt, resolve, reject };
      entry.abort = () => {
        if (this.active === entry) { try { interrupt(); } catch {} }
        else { const at = this.pending.indexOf(entry); if (at >= 0) { this.pending.splice(at, 1); signal?.removeEventListener('abort', entry.abort); reject(stoppedError()); } }
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.pending.push(entry); this.drain();
    });
  }
  async drain() {
    if (this.active || !this.pending.length) return;
    const entry = this.active = this.pending.shift();
    try { if (entry.signal?.aborted) throw stoppedError(); const result = await entry.work(); if (entry.signal?.aborted) throw stoppedError(); entry.resolve(result); }
    catch (error) { entry.reject(entry.signal?.aborted ? stoppedError() : error); }
    finally { entry.signal?.removeEventListener('abort', entry.abort); this.active = null; this.drain(); }
  }
}
