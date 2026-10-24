// Pinned WebR, owned computation queue, central jobs and idle release.
import { startR, installVendored } from './rengine.mjs';
import { createRSession, releaseWhenHidden } from './r-session.mjs';
import { subscribe, projectGeneration } from '../store.mjs';
import * as jobs from './jobs.mjs';
const status = text => { const el = globalThis.document?.getElementById('engine'); if (el) el.textContent = text; };
const session = createRSession({ start: startR, install: installVendored, status });
const POLICY_KEY = 'lykos-r-resources';
// The idle release choices (Settings > Resources). The default is 3 (plan 2026-10-12 footprint, Task 13): R alive held 250-450 MB of the web
// view (WebAssembly memory and WebKit's allocator; tools/measure-memory.mjs in WebKit, 24 October 2026), and a release gave it back.
export const IDLE_MINUTES = [1, 3, 5, 10, 30];
export const DEFAULT_IDLE_MINUTES = 3;
// A window that has been hidden this long releases R at once, whatever the idle choice (a refusal while an analysis runs leaves it be).
export const HIDDEN_RELEASE_MS = 60_000;
const cleanPolicy = value => ({ idleMinutes: IDLE_MINUTES.includes(Number(value?.idleMinutes)) ? Number(value.idleMinutes) : DEFAULT_IDLE_MINUTES, maxPending: [4,8,16,32].includes(Number(value?.maxPending)) ? Number(value.maxPending) : 16 });
let policy;
try { policy = cleanPolicy(JSON.parse((typeof document === 'undefined' ? null : globalThis.localStorage)?.getItem(POLICY_KEY) || '{}')); } catch { policy = cleanPolicy({}); }
session.configure({ idleMs: policy.idleMinutes * 60_000, maxPending: policy.maxPending });
export const resourcePolicy = () => ({ ...policy });
export function setResourcePolicy(value) { policy = cleanPolicy(value); session.configure({ idleMs: policy.idleMinutes * 60_000, maxPending: policy.maxPending }); try { (typeof document === 'undefined' ? null : globalThis.localStorage)?.setItem(POLICY_KEY, JSON.stringify(policy)); } catch {} return resourcePolicy(); }
if (typeof document !== 'undefined' && document.addEventListener) releaseWhenHidden(document, () => session.release(), HIDDEN_RELEASE_MS);
export const installed = session.installed;
export const releaseR = session.release;
export const engine = (pkgs, onProgress = () => {}) => session.engine(pkgs, onProgress);
async function owned(kind, pkgs, code, onProgress = () => {}, options = {}) {
  const generation = projectGeneration(), controller = new AbortController();
  const h = jobs.start('analysis', options.label || (kind === 'runSvg' ? 'R figure' : 'R analysis'), { resource: 'r' });
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const unsubscribe = subscribe(() => { if (projectGeneration() !== generation || h.stopped()) abort(); });
  const progress = text => { if (!controller.signal.aborted) { h.progress(text); status(text); onProgress(text); } };
  try { const result = await session[kind](pkgs, code, progress, controller.signal); h.done(); return result; }
  catch (error) { if (controller.signal.aborted) h.cancel(); else h.fail(error); throw error; }
  finally { unsubscribe(); options.signal?.removeEventListener('abort', abort); }
}
export const runR = (pkgs, code, onProgress, options) => owned('runR', pkgs, code, onProgress, options);
export const runSvg = (pkgs, code, onProgress, options) => owned('runSvg', pkgs, code, onProgress, options);
// R starts when a run asks for it, never ahead. Starting it while a person read an outcome (the Analysis page called warm on every render)
// added 250-500 MB to the web view for as long as R lived, mostly for pages that never ran anything (24 October 2026, docs/footprint-2026-10.md).
// the first run waits for R to start (a few seconds); nothing starts it ahead
