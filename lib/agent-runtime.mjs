// Runtime boundaries are independent of the model and tool implementations.
export const LOOP_LIMITS = Object.freeze({ batch: 16, parallel: 4, tools: 160, readMs: 90000, args: 120000 });

export function toolArguments(raw = '{}') {
  if (typeof raw !== 'string') throw new Error('Tool arguments must be one JSON object encoded as a string');
  if (raw.length > LOOP_LIMITS.args) throw new Error('Tool arguments exceed 120,000 characters. Send fewer items in separate calls, waiting for each result before continuing.');
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Tool arguments are not valid JSON. Retry with one complete JSON object. For a large request, send one item per call and wait for its result before continuing.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be one JSON object');
  return value;
}

export const failedResult = r => !r || r.argError || r.fatal || (typeof r.content === 'string' && /^error:/i.test(r.content));
export const transientError = e => /(?:network|fetch failed|failed to fetch|timed? ?out|ECONNRESET|ETIMEDOUT|temporarily unavailable|\b(?:429|502|503|504)\b)/i.test(String(e?.message || e));
const failure = (error, extra = {}) => ({ content: `error: ${String(error?.message || error).slice(0, 300)}`, record: String(error?.message || error).slice(0, 300), ...extra });

/** Only thrown transient read errors are retried; writes never are. */
export async function executeTool({ exec, name, args, read = false, signal, timeoutMs = LOOP_LIMITS.readMs, onRetry }) {
  try { toolArguments(args); } catch (e) { return failure(e, { argError: true }); }
  const attempts = read ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) return failure('Run stopped', { stopped: true });
    let timer, abort;
    try {
      const work = Promise.resolve().then(() => exec(name, args));
      const stops = new Promise((_, reject) => {
        abort = () => reject(Object.assign(new Error('Run stopped'), { name: 'AbortError' }));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        if (read && timeoutMs > 0) timer = setTimeout(() => reject(Object.assign(new Error(`Read timed out after ${timeoutMs} ms; use a narrower request`), { toolTimeout: true })), timeoutMs);
      });
      const result = await Promise.race([work, stops]);
      if (!result || (typeof result.content !== 'string' && !Array.isArray(result.content))) return failure('Tool returned no usable result');
      return result;
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') return failure('Run stopped', { stopped: true });
      // A timed-out read may still be running, so don't start a duplicate.
      if (error.toolTimeout) return failure(error, { timedOut: true });
      if (attempt + 1 < attempts && transientError(error)) { onRetry?.({ name, attempt: attempt + 1 }); continue; }
      return failure(error);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}

/** Start only N jobs at a time; callers retain results in original order. */
export function orderedPool(items, run, width = LOOP_LIMITS.parallel) {
  let next = 0;
  const slots = items.map(() => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; });
  const worker = async () => { while (next < items.length) { const i = next++; try { slots[i].resolve(await run(items[i], i)); } catch (e) { slots[i].resolve(failure(e)); } } };
  for (let i = 0; i < Math.min(width, items.length); i++) void worker();
  return slots.map(s => s.promise);
}

/** Durable recovery stores observable results, never keys or model transcripts. */
export function checkpointOf(run) {
  return { turnId: run.turnId, startedAt: run.startedAt, model: run.model, updatedAt: new Date().toISOString(),
    agents: structuredClone((run.agents || []).slice(0, 8)), steps: structuredClone((run.steps || []).slice(-160)), blocks: structuredClone((run.blocks || []).slice(0, 12)), usage: run.usage || null };
}
export function interruptedMessage(checkpoint, status = 'interrupted', text = 'Interrupted. Saved results are available; resume to continue the work.') {
  return { id: `${checkpoint.turnId}:recovery`, role: 'assistant', status, text, agents: checkpoint.agents || [], cites: [], steps: checkpoint.steps || [], blocks: checkpoint.blocks || [], usage: checkpoint.usage || null,
    model: checkpoint.model, durationMs: Math.max(0, Date.parse(checkpoint.updatedAt) - checkpoint.startedAt), at: checkpoint.updatedAt };
}
