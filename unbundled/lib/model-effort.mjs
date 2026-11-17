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
// A Claude model of the 5 family (direct or through OpenRouter: claude-opus-5-5, anthropic/claude-sonnet-5.5, claude-fable-5-1)
const claudeFive = model => /claude-(opus|sonnet|fable)-([5-9])(?:[-.]\d+)?\b/i.test(String(model || ''));
export function reasoningOptions(cfg, info) {
  if (cfg?.effort && effortLevels(cfg, info).includes(cfg.effort)) return { effort: cfg.effort };
  // Automatic on a Claude 5 model thinks at high: the API's own default is medium for Opus, and the chat's work is reading and writing
  // across a project (assistant review, 2026-10-23)
  if (!cfg?.effort && ['anthropic', 'openrouter'].includes(cfg?.provider) && claudeFive(cfg?.model)) return { effort: 'high' };
  return null;
}
export const effortLabel = value => ({ none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }[value] || 'Automatic');
