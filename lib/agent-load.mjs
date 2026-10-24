// The agent (lib/agent.mjs) loads when something needs it: a run left "running" by an earlier session is the only thing the shell asks of it at
// start (reconcileRuns); the chat takes it through lib/assistant-engine.mjs, the extraction and verify pages import it themselves.
import { get } from '../store.mjs';
import { lazyModule } from './lazy.mjs';

export const agent = lazyModule(() => import('./agent.mjs'), 'the model agent');
/** A saved table run still marked running: reconcileRuns decides whether another window owns it. */
export const agentRunsOpen = state => (state.runs || []).some(r => r.status === 'running');
export async function reconcileRunsIfAny() {
  if (!agentRunsOpen(get())) return;
  return (await agent.ensure()).reconcileRuns();
}
