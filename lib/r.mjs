// Pinned WebR, owned computation queue, central jobs and idle release.
import { startR, installVendored } from './rengine.mjs';
import { createRSession, releaseWhenHidden } from './r-session.mjs';
import { subscribe, projectGeneration } from '../store.mjs';
import * as jobs from './jobs.mjs';
const status = text => { const el = globalThis.document?.getElementById('engine'); if (el) el.textContent = text; };
const session = createRSession({ start: startR, install: installVendored, status });
const POLICY_KEY = 'lykos-r-resources';
// The idle release choices (Settings > Resources). 3 is offered but not the default: the plan (2026-10-12 footprint, Task 13) changes the
// default from 10 to 3 only after the idle, after-analysis and 15-minute memory of the packaged app has been measured with tools/measure-app.sh,
// which needs a person at the screen. Until then DEFAULT_IDLE_MINUTES stays 10.
export const IDLE_MINUTES = [1, 3, 5, 10, 30];
export const DEFAULT_IDLE_MINUTES = 10;
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
let warmed = false;
export function warm(pkgs) {
  if (warmed) return; warmed = true;
  const go = () => session.runR(pkgs, 'list(ok = TRUE)').catch(() => { warmed = false; });
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 500);
}
