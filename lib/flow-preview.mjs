// What a workflow run would send, shown before it starts (the shared run preview, lib/run-preview.mjs). The AI steps are the blocks run by a model: an
// AI task, a block that needs a model, and a team; the connections are the ones those blocks name. A workflow with no AI step has nothing to preview.
import { BLOCKS, workflowModels } from './flow-runner.mjs';
import { modelTeams } from './model-team-list.mjs';
import { confirmRun, promptSends } from './run-preview.mjs';
import { WORKFLOW_AGENT } from './prompts.mjs';

/** The AI steps of a flow and the connections they use: { steps, cfgs }. Pure over the flow, the saved connections and teams. */
export function flowAiSteps(flow, models = workflowModels(), teams = modelTeams()) {
  const steps = (flow?.blocks || []).filter(b => b.executor === 'ai' || BLOCKS.find(d => d.id === b.type)?.model || b.type === 'team');
  const cfgs = new Map();
  const use = (id, model) => { const p = models.find(m => m.id === id); if (p) cfgs.set(`${p.id}|${model || p.model}`, { ...p, model: model || p.model }); };
  for (const b of steps) {
    if (b.type !== 'team') { use(b.modelId); continue; }
    const t = teams.find(x => x.id === b.teamId);
    if (t) { use(t.leadProfileId, t.leadModel); for (const m of t.members || []) use(m.profileId, m.model); }
  }
  return { steps, cfgs: [...cfgs.values()] };
}

/** Asks before a run: true to go on (at once when no step uses a model), false when the person cancels. */
export async function confirmFlow(flow) {
  const { steps, cfgs } = flowAiSteps(flow);
  if (!steps.length || !cfgs.length) return true;
  return confirmRun({ title: `Run ${flow.name || 'this workflow'}?`, confirm: 'Run', cfgs, items: { n: steps.length, noun: 'AI step' }, classes: promptSends(WORKFLOW_AGENT) });
}
