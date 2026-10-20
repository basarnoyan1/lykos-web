// Loaded on demand: observable task progress and tool activity in the chat.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { describeActivity, elapsedLabel, visibleActivity, activityResult, activityInputs } from './assistant-activity.mjs';

export const activityRows = (steps, key, papers = []) => `<div class="assist-timeline">${visibleActivity(steps).map((s, i) => {
  const d = describeActivity(s, papers);
  const inputs = activityInputs(s, papers);
  const result = activityResult(s);
  return `<details class="assist-tool" data-activity-key="${key}-${i}"><summary><span class="assist-tool-mark" aria-label="${d.failed ? 'Failed' : 'Completed'}">${icon(d.failed ? 'close' : 'check', { size: 12 })}</span><span class="assist-tool-heading"><strong>${esc(d.title)}${d.detail ? `<span class="assist-tool-source">${esc(d.detail)}</span>` : ''}</strong><span class="assist-tool-outcome">${esc(result.slice(0, 140))}${result.length > 140 ? '…' : ''}</span></span>${s.durationMs != null ? `<span class="assist-tool-time">${s.durationMs < 1000 ? '<1s' : elapsedLabel(s.durationMs)}</span>` : ''}</summary><div class="assist-tool-body">${inputs.length ? `<section><h4>Input</h4><dl>${inputs.map(x => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl></section>` : ''}<section><h4>Result</h4><div class="assist-tool-result">${esc(result)}</div></section></div></details>`;
}).join('')}</div>`;

export function renderAssistantActivity(run, papers, planHtml = '') {
  const active = run.active;
  const info = active ? describeActivity(active, papers) : null;
  const title = run.stopping ? 'Stopping…' : active?.name==='team_plan' ? 'Assigning team work' : active?.name==='team_synthesis' ? 'Combining team findings' : active?.agent ? `${active.agent} · ${active.type==='tool'?info.title:'Investigating'}` : active?.type === 'tool' ? info.title : active?.type === 'compact' ? 'Condensing context' : 'Preparing response';
  const completed = visibleActivity(run.steps), plan = run.blocks?.find(b => b.type === 'plan')?.plan;
  const done = plan?.steps?.filter(s => s.status === 'done').length || 0;
  const failed = completed.filter(s => describeActivity(s).failed).length;
  const used = (run.usage?.prompt || 0) + (run.usage?.completion || 0);
  const progress = `<div class="assist-task-progress">${plan?.steps?.length ? `<span>${done} of ${plan.steps.length} tasks complete</span><progress aria-label="Task progress" value="${done}" max="${plan.steps.length}"></progress>` : `<span>${completed.length - failed} actions completed${failed ? ` · ${failed} failed` : ''}</span>`}<span class="meta">${used ? `${Math.round(used / 1000)}k / ` : ''}${Math.round(run.budget.tokens / 1000)}k token ceiling · ${run.modelCalls || 0} / ${run.budget.calls} calls</span></div>`;
  let html = progress + `<div class="assist-live-state" role="status"><span class="assist-live-dot"></span><span class="assist-live-title">${esc(title)}</span><span class="assist-tool-time" data-live-elapsed>${elapsedLabel(Date.now() - run.startedAt)}</span></div>${active?.type === 'tool' && info.detail ? `<div class="assist-live-source">${esc(info.detail)}</div>` : ''}${run.agents?.length?`<div class="assist-team-status meta">${run.agents.map(a=>`${esc(a.role)} · ${esc(a.status)}`).join('<br>')}</div>`:''}${planHtml}${run.steps.some(s => s.type !== 'model' && s.name !== 'finish') ? `<details class="assist-steps" data-activity-key="live"><summary>Activity · ${run.steps.filter(s => s.type !== 'model' && s.name !== 'finish').length} completed</summary>${activityRows(run.steps, 'live', papers)}</details>` : ''}`;
  if (completed.length) html += activityRows(completed.slice(-4), 'recent', papers);
  return html;
}
