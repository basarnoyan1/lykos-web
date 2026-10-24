import { cachedModels, listModelsDetailed, modelInfo, configured } from './ai.mjs';
import { effortLevels, effortLabel } from './model-effort.mjs';
import { chooseModel } from './model-picker.mjs';
import { isJev } from './ai.mjs';

/** One catalog chooser shared by chat, task routes and team roles. */
export async function chooseRouteModel(cfg) {
  const rows = cachedModels(cfg);
  return chooseModel({ current: cfg.model, models: rows.length ? rows.map(r => r.id) : cfg.models || [],
    labels: Object.fromEntries(rows.map(r => [r.id, r.label || r.id])), allowCustom: cfg.provider !== 'chatgpt',
    load: () => listModelsDetailed(cfg, { force: false }) });
}
export function quickModelItems(cfg, { profiles, change }) {
  const available = profiles.filter(p => configured(p) && !isJev(p));
  const pickConnection = async () => {
    const id = await chooseModel({ title: 'Choose connection', models: available.map(p => p.id), current: cfg.id,
      labels: Object.fromEntries(available.map(p => [p.id, `${p.label || p.model} (${p.provider})`])), allowCustom: false });
    if (id) { const p = available.find(p => p.id === id); if (p) change({ profileId: id, model: p.model, effort: '' }); }
  };
  const levels = effortLevels(cfg, modelInfo(cfg));
  return [
    { label: 'Choose model', meta: cfg.model || '', disabled: !configured(cfg), run: async () => { const model = await chooseRouteModel(cfg); if (model) change({ profileId: cfg.id, model, effort: '' }); } },
    { label: 'Connection', meta: cfg.label || cfg.provider || 'None', disabled: !available.length,
      submenu: [...available.slice(0, 8).map(p => ({ label: p.label || p.model, meta: p.provider, checked: p.id === cfg.id,
        run: () => change({ profileId: p.id, model: p.model, effort: '' }) })), ...(available.length > 8 ? [{ label: 'All connections', run: pickConnection }] : [])] },
    levels.length ? { label: 'Reasoning effort', meta: effortLabel(cfg.effort), submenu: [
      { label: 'Automatic', checked: !cfg.effort, run: () => change({ profileId: cfg.id, model: cfg.model, effort: '' }) },
      ...levels.map(effort => ({ label: effortLabel(effort), checked: cfg.effort === effort,
        run: () => change({ profileId: cfg.id, model: cfg.model, effort }) })),
    ] } : { label: 'Reasoning effort unavailable', disabled: true },
  ];
}
