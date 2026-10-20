// Recorded model usage in this project. Unknown provider costs stay unknown.
const empty = () => ({ calls: 0, prompt: 0, completion: 0, cost: 0, cached: 0, unknownCost: 0, unknownTokens: 0, unknownCached: 0 });
function add(total, usage) {
  total.calls++;
  total.prompt += usage?.prompt || 0;
  total.completion += usage?.completion || 0;
  total.cost += usage?.cost || 0;
  total.cached = (total.cached || 0) + (usage?.cached || 0);
  if (usage?.cost == null) total.unknownCost++;
  if (usage?.prompt == null || usage?.completion == null) total.unknownTokens++;
  if (usage?.cached == null) total.unknownCached = (total.unknownCached || 0) + 1;
  if (usage?.estimated && usage?.cost != null) total.estimatedCost = (total.estimatedCost || 0) + 1;   // priced from a list, not reported
}
export function addModelUsage(models, call) {
  const model = call.model || '', provider = call.provider || '';
  let group = models.find(g => g.model === model && g.provider === provider && !g.unattributed);
  if (!group) models.push(group = { model, provider, ...empty(), unknownPrompt: 0, unknownCompletion: 0 });
  add(group, call.usage);
  if (call.usage?.prompt == null) group.unknownPrompt++;
  if (call.usage?.completion == null) group.unknownCompletion++;
}

// ---- by call type ------------------------------------------------------------------
// A call's kind is the prompt it ran (id only, so a new wording does not split
// the row): "screen.assess", "chat", "extract"; earlier calls carry none.
export const kindOfCall = call => String(call.prompt || '').split('@')[0] || call.task || 'other';
export function addKindUsage(kinds, call) {
  const kind = kindOfCall(call);
  let group = kinds.find(g => g.kind === kind);
  if (!group) kinds.push(group = { kind, ...empty() });
  add(group, call.usage);
}
export function kindCallTotals(state) {
  if (Array.isArray(state.aiKindTotals)) return state.aiKindTotals.map(g => ({ ...g }));
  const kinds = [];
  for (const call of state.aiCalls || []) addKindUsage(kinds, call);
  return kinds;
}

// Keep model totals independently of the bounded, recent-call log. Older projects
// can recover only the model attribution that remains in that log.
export function modelCallTotals(state) {
  if (Array.isArray(state.aiModelTotals)) return state.aiModelTotals.map(g => ({ ...g }));
  const models = [];
  for (const call of state.aiCalls || []) addModelUsage(models, call);
  const recorded = empty();
  for (const group of models) for (const key of Object.keys(recorded)) recorded[key] += group[key];
  if (state.aiCallTotals?.calls > recorded.calls) {
    const remaining = Object.fromEntries(Object.keys(recorded).map(key => [key, Math.max(0, (state.aiCallTotals[key] || 0) - recorded[key])]));
    models.push({ model: '', provider: '', unattributed: true, ...remaining,
      unknownPrompt: remaining.unknownTokens, unknownCompletion: remaining.unknownTokens });
  }
  return models;
}

export function aiUsage(state) {
  const since = state.aiUsageStartedAt || null;
  const recent = (state.aiCalls || []).map(r => ({ kind: r.status === 'failed' ? 'failed' : 'model', model: r.model || '', provider: r.provider || '', at: r.at, usage: r.usage, prompt: r.prompt || '', route: r.route || '' }));
  const historic = [
    ...(state.runs || []).filter(r => r.kind !== 'batch').filter(r => !since || (r.endedAt ? r.endedAt < since : r.status !== 'running' && r.startedAt < since))
      .map(r => ({ kind: 'run', model: r.model || '', provider: r.provider || '', at: r.startedAt, usage: r.usage })),
    ...(state.threads || []).flatMap(t => (t.messages || [])
      .filter(m => m.role === 'assistant' && m.usage && (!since || m.at < since))
      .map(m => ({ kind: 'chat', model: m.model || t.model || '', provider: m.provider || t.provider || '', at: m.at, usage: m.usage }))),
  ];
  const entries = [...recent, ...historic].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const total = empty();
  if (state.aiCallTotals) Object.assign(total, state.aiCallTotals);
  else recent.forEach(e => add(total, e.usage));
  historic.forEach(e => add(total, e.usage));
  const models = modelCallTotals(state);
  historic.forEach(e => addModelUsage(models, e));
  const kinds = kindCallTotals(state);
  historic.forEach(e => addKindUsage(kinds, { prompt: e.kind === 'chat' ? 'chat' : 'extract', usage: e.usage }));
  kinds.sort((a, b) => b.calls - a.calls || a.kind.localeCompare(b.kind));
  models.sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model) || a.provider.localeCompare(b.provider));
  return { total, entries, models, kinds };
}
