// Provider usage is not a subscription balance. The direct OAuth API does not
// document a remaining-plan endpoint; never estimate it from local token counts.
const states = new Map();
export const chatGptUsageState = id => states.get(id) || { kind: 'unknown', at: null };
export function observeChatGptUsage(id, error = null) {
  const code = error?.code || '';
  states.set(id, { kind: !error ? 'available' : code === 'subscription_sharing_usage_limit_exceeded' ? 'limited'
    : code === 'subscription_sharing_user_not_eligible' ? 'ineligible' : 'unknown', code, at: new Date().toISOString() });
}
export function recordedChatGptUsage(state, profileId, at = new Date()) {
  const day = [at.getFullYear(), String(at.getMonth() + 1).padStart(2, '0'), String(at.getDate()).padStart(2, '0')].join('-');
  const calls = (state.aiCalls || []).filter(c => c.provider === 'chatgpt' && c.profileId === profileId && (() => {
    const d = new Date(c.at); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') === day;
  })());
  return { calls: calls.length, tokens: calls.reduce((n, c) => n + (c.usage?.prompt || 0) + (c.usage?.completion || 0), 0), incomplete: calls.some(c => c.usage?.prompt == null || c.usage?.completion == null) };
}
