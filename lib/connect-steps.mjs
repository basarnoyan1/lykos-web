// The connect wizard's steps as data and pure functions (views/settings-connect.mjs draws them). Nothing here sends a request.
//
//   1 where     "Where should the model run?": a server on this Mac, a ChatGPT account, or an API key
//   2 details   the provider or server, the key or address (at most three fields)
//   3 model     the models the connection listed; the test then asks the chosen one a fixed question
//
// A preset is "not tested" until a test has passed on this installation. That record is a list of connection names in this browser's or
// window's storage (no key, no project content), so it belongs to the installation and never travels with a project or a backup.
import { PRESETS, PROVIDERS } from './ai.mjs';

export const WHERE = Object.freeze([
  { id: 'mac', title: 'On this Mac', help: 'A model server running here, such as Ollama or LM Studio. Nothing leaves the computer.' },
  { id: 'chatgpt', title: 'My ChatGPT account', help: 'Sign in with your ChatGPT plan. Needs the desktop app.' },
  { id: 'key', title: 'An API key', help: 'A key from a model provider. Questions and the text sent with them go to that provider.' },
]);

const TESTED = 'lykos.connect.tested.v1';
/** A connection's identity for the record: provider and endpoint, never a key. */
export const connectionName = cfg => `${cfg?.provider || ''}|${String(cfg?.base || PROVIDERS[cfg?.provider]?.base || '').replace(/\/+$/, '').toLowerCase()}`;
function readTested(storage) {
  try { const v = JSON.parse(storage?.getItem(TESTED) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
/** When a test last passed for this connection on this installation (ISO), or ''. */
export const testedAt = (cfg, storage = store()) => readTested(storage)[connectionName(cfg)] || '';
/** Records a passed test. A failed storage is ignored: the label then stays "not tested". */
export function markTested(cfg, storage = store(), now = new Date()) {
  try { storage?.setItem(TESTED, JSON.stringify({ ...readTested(storage), [connectionName(cfg)]: now.toISOString() })); } catch { /* storage unavailable */ }
}

/** The presets of one wizard choice. */
export const presetsFor = where => PRESETS.filter(p => p.where === where);
export const presetById = id => PRESETS.find(p => p.id === id) || null;
/** A preset as the person reads it in a list: "Mistral (not tested)", or the plain name once a test has passed here. */
export const presetLabel = (preset, storage = store()) => testedAt(preset, storage) ? preset.label : `${preset.label} (not tested)`;

/** The first profile fields a preset gives; the key, model and id come from the person and the test. */
export function profileFromPreset(preset, { id, key = '', base, model = '', workspaceId = '' } = {}) {
  const definition = PROVIDERS[preset.provider];
  return { id, label: preset.label, provider: preset.provider, base: (base ?? preset.base ?? definition?.base ?? '').trim().replace(/\/+$/, ''),
    key: key.trim(), model, ...(workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}) };
}

/** The preset a server found on this Mac matches, by its endpoint. */
export const presetForBase = base => PRESETS.find(p => p.where === 'mac' && p.base === base) || null;

/** The model to preselect from a list: the provider's own default when the list holds it, else none (the person chooses). */
export const preselect = (cfg, models) => {
  const wanted = PROVIDERS[cfg.provider]?.defaultModel;
  return wanted && models.includes(wanted) ? wanted : '';
};
