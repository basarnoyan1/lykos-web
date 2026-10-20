// Capability-gated reasoning controls. Unknown endpoints keep their defaults.
export const EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export function reportedEfforts(reasoning) {
  if (!reasoning || !Object.hasOwn(reasoning, 'supported_efforts')) return [];
  const values = reasoning.supported_efforts === null ? EFFORTS.filter(e => e !== 'ultra') : reasoning.supported_efforts;
  return Array.isArray(values) ? EFFORTS.filter(e => values.includes(e) && !(e === 'none' && reasoning.mandatory)) : [];
}
export function effortLevels(cfg, info = {}) {
  if (!['chatgpt', 'openrouter', 'anthropic'].includes(cfg?.provider)) return [];
  if (Array.isArray(info.efforts)) return EFFORTS.filter(e => info.efforts.includes(e));
  // Exact documented Responses models, not a guess for future model families.
  if (cfg.provider === 'chatgpt' && ['gpt-5.6', 'gpt-5.6-sol', 'gpt-6-sol'].includes(cfg.model))
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  return [];
}
export function reasoningOptions(cfg, info) {
  return cfg?.effort && effortLevels(cfg, info).includes(cfg.effort) ? { effort: cfg.effort } : null;
}
export const effortLabel = value => ({ none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }[value] || 'Automatic');
