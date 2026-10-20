// The workflow runner (lib/flow-runner.mjs, 14 modules) loads when a project has something for it to do, not with the shell (footprint Task 6).
// Both entry points start from the project alone: a run left "running" by a previous session is the only thing reconcileFlowRuns changes, and
// a scheduled flow (enabled with a cron) the only thing runDueFlows looks at, so a project with neither never loads the runner. Everything
// else that runs a flow (the Workflows page, the assistant's tools) imports the runner itself.
import { get } from '../store.mjs';
import { lazyModule } from './lazy.mjs';

export const flowRunner = lazyModule(() => import('./flow-runner.mjs'), 'the workflow runner');
/** A saved run still marked running: the runner decides whether another window owns it. */
export const flowRunsOpen = state => (state.workflowRuns || []).some(r => r.status === 'running');
/** A flow with a schedule switched on. */
export const flowsScheduled = state => (state.workflows || []).some(f => f.enabled && f.cron);

export async function reconcileFlowRunsIfAny() {
  if (!flowRunsOpen(get())) return;
  return (await flowRunner.ensure()).reconcileFlowRuns();
}
export async function runDueFlowsIfAny(now) {
  if (!flowsScheduled(get())) return;
  return (await flowRunner.ensure()).runDueFlows(now);
}
