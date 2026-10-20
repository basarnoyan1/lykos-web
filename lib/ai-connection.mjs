// Trying a connection (the Settings wizard and Test connection): loaded when a person presses a test, not with the shell (startup budget).
import { inDesktop } from './native.mjs';
import { chatGptAccount } from './chatgpt.mjs';
import { PROVIDERS, PRESETS, routeOf, assertRoute, keyNeeded, listModelsDetailed, complete } from './ai.mjs';
import { providerWho, failure, stepOf, hostLabel, diagnose } from './provider-error.mjs';

// ---- trying a connection --------------------------------------------------------------------------------------------------------------
/**
 * The servers a person may run on this machine, tried only when asked (a button press: the app makes no background requests, plan §1.2).
 * Each is asked for its model list on loopback and nothing else; no key and no project content is sent. Resolves one row per server:
 * `up` (answered with a list), its `models`, or the failure `kind` that explains why not ("local-down", "cors-or-down", "not-api").
 */
export async function probeLocal({ signal, timeoutMs = 1500 } = {}) {
  const servers = PRESETS.filter(p => p.where === 'mac' && /^http:\/\/localhost:\d+\/v1$/.test(p.base));
  return Promise.all(servers.map(async server => {
    const cfg = { provider: server.provider, base: server.base };
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    const stop = () => ctl.abort(); signal?.addEventListener('abort', stop, { once: true });
    try {
      const list = server.provider === 'ollama' ? await PROVIDERS.ollama.listModels(cfg, ctl.signal) : await PROVIDERS.openaiCompatible.listModels(cfg, ctl.signal);
      return { id: server.id, label: server.label, base: server.base, up: true, models: list };
    } catch (error) {
      const timedOut = ctl.signal.aborted && !signal?.aborted;
      const why = timedOut ? failure('local-down', { host: hostLabel(server.base), ollama: server.provider === 'ollama' }) : error;
      return { id: server.id, label: server.label, base: server.base, up: false, models: [], kind: why?.kind || 'other' };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  }));
}

/**
 * One harmless check of a connection, in the order a person would fix things: is it set up, does the host answer, is the key accepted,
 * does the model answer. Sends no project content: the list request, then (with a model) one fixed prompt, as plan §6.2 requires.
 * Resolves, never throws: { ok, step ('setup'|'host'|'key'|'model'), kind, cause, next, text, full, models?, partial? }.
 *   text = cause and step as one sentence run; full = everything the provider said (for a tooltip or a disclosure), secrets removed.
 * `partial`: the host answered and the key was accepted but no model is chosen yet (`models` is the list to choose from).
 */
export async function testConnection(cfg, { signal, chooseModel = false } = {}) {
  const secrets = [cfg?.key];
  const fail = err => ({ ok: false, step: stepOf(err?.kind), ...diagnose(err, { secrets }) });
  const p = PROVIDERS[cfg?.provider];
  const who = providerWho(cfg, PROVIDERS), x = { who, ollama: cfg?.provider === 'ollama', model: cfg?.model };
  if (!p) return fail(failure('no-provider', x));
  if (p.oauth) {
    if (!inDesktop()) return fail(failure('desktop-only', x));
    if (!chatGptAccount(cfg.id)?.connected) return fail(failure('no-account', x));
  } else {
    if (!cfg.base) return fail(failure('no-endpoint', x));
    try { const u = new URL(cfg.base); if (!/^https?:$/.test(u.protocol) || (inDesktop() && u.protocol === 'http:' && routeOf(cfg) !== 'local')) throw 0; }
    catch { return fail(failure('bad-address', x)); }
    if (keyNeeded(cfg) && !cfg.key) return fail(failure('no-key', x));
  }
  try { assertRoute(cfg); } catch (error) { return fail(error); }
  const model = chooseModel ? cfg.model : cfg.model || p.defaultModel;
  try {
    if (!model) {
      const rows = (await listModelsDetailed(cfg, { force: true })).map(m => m.id);
      if (!rows.length) return fail(failure('no-models', x));
      return { ok: false, partial: true, step: 'model', models: rows, ...diagnose(failure('no-model', x), { secrets }), kind: 'no-model' };
    }
    if (p.decisions) {   // a decision model is tested with one harmless yes/no, not a sentence
      const { decide } = await import('./jev.mjs');
      const a = await decide(cfg, { text: 'ready' }, { ok: { type: 'noul', instructions: 'The text says ready' } }, { sends: [] });
      return Number(a.ok?.noul) >= 0.5 ? passed() : odd();
    }
    const out = await complete({ ...cfg, model }, [{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: p.checkTokens || 20, context: false, signal, sends: [] });
    return /ready/i.test(out) ? passed() : odd();
  } catch (error) { return signal?.aborted ? { ok: false, step: 'host', kind: 'stopped', cause: 'The test was stopped.', next: '', text: 'The test was stopped.', full: '' } : fail(error); }
  function passed() { return { ok: true, step: 'model', kind: 'ok', cause: 'Connection works.', next: '', text: 'Connection works', full: '' }; }
  function odd() { return { ok: true, step: 'model', kind: 'odd-reply', cause: 'The model replied, but not as asked.', next: '', text: 'The model replied, but not as asked', full: '' }; }
}
