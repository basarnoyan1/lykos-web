// Loaded on demand: observable task progress and tool activity in the chat.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { describeActivity, elapsedLabel, visibleActivity, activityResult, activityInputs } from './assistant-activity.mjs';
export { stepSummary } from './assistant-activity.mjs';

/** Steps shown before the earlier ones fold under "N earlier steps". */
export const STEPS_SHOWN = 4;

/** One step as one grey line (AirOps, Replit): a check or a cross, what was done, on what, what came of it; its time, inputs and whole result open under it. */
function stepRow(s, key, papers) {
  const d = describeActivity(s, papers), inputs = activityInputs(s, papers), result = activityResult(s);
  const outcome = (d.failed ? `failed: ${result.replace(/^error:\s*/i, '')}` : result).slice(0, 160);
  const time = s.durationMs != null ? (s.durationMs < 1000 ? '<1s' : elapsedLabel(s.durationMs)) : '';
  return `<details class="assist-tool" data-activity-key="${key}"${d.failed ? ' data-failed' : ''}><summary>`
    + `<span class="assist-tool-mark" aria-label="${d.failed ? 'Failed' : 'Done'}">${icon(d.failed ? 'close' : 'check', { size: 12 })}</span>`
    + `<span class="assist-tool-line"><span class="assist-tool-title">${esc(d.title)}</span>${d.detail ? `<span class="assist-tool-source">: ${esc(d.detail)}</span>` : ''}`
    + `<span class="assist-tool-outcome">, ${esc(outcome)}${result.length > 160 ? '…' : ''}</span></span>`
    + `</summary>`
    + `<div class="assist-tool-body">${time ? `<p class="meta">Took ${time}</p>` : ''}${inputs.length ? `<section><h4>Input</h4><dl>${inputs.map(x => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl></section>` : ''}<section><h4>Result</h4><div class="assist-tool-result">${esc(result)}</div></section></div></details>`;
}

/** The steps of a turn, the last few in view and the earlier ones folded. */
export const activityRows = (steps, key, papers = []) => {
  const rows = visibleActivity(steps).map((s, i) => stepRow(s, `${key}-${i}`, papers)), early = rows.length - STEPS_SHOWN;
  return `<div class="assist-timeline">${early > 1 ? `<details class="assist-earlier" data-activity-key="${key}-earlier"><summary>${early} earlier steps</summary>${rows.slice(0, early).join('')}</details>${rows.slice(early).join('')}` : rows.join('')}</div>`;
};

export function renderAssistantActivity(run, papers, planHtml = '') {
  const active = run.active;
  const info = active ? describeActivity(active, papers) : null;
  const title = run.stopping ? 'Stopping…' : active?.name === 'ask_person' ? 'Waiting for your answer' : active?.name==='team_plan' ? 'Assigning team work' : active?.name==='team_synthesis' ? 'Combining team findings' : active?.agent ? `${active.agent}: ${active.type==='tool'?info.title:'Investigating'}` : active?.type === 'tool' ? info.title : active?.type === 'compact' ? 'Condensing context' : 'Preparing response';
  const completed = visibleActivity(run.steps), plan = run.blocks?.find(b => b.type === 'plan')?.plan;
  const done = plan?.steps?.filter(s => s.status === 'done').length || 0;
  const failed = completed.filter(s => describeActivity(s).failed).length;
  const used = (run.usage?.prompt || 0) + (run.usage?.completion || 0);
  // the steps so far, then what it is doing now, then one quiet line of what it has used (once it has used something)
  const spent = [plan?.steps?.length ? `${done} of ${plan.steps.length} tasks done` : '', failed ? `${failed} failed` : '',
    run.modelCalls ? `${run.modelCalls} of ${run.budget.calls} calls` : '', used ? `${Math.round(used / 1000)}k of ${Math.round(run.budget.tokens / 1000)}k tokens` : ''].filter(Boolean).join(', ');
  const now = `${title}${active?.type === 'tool' && info.detail ? `: ${info.detail}` : ''}`;
  let html = planHtml + (completed.length ? activityRows(run.steps, 'live', papers) : '')
    + `<div class="assist-live-state" role="status"><span class="assist-live-dot"></span><span class="assist-live-title">${esc(now)}</span><span class="assist-tool-time" data-live-elapsed>${elapsedLabel(Date.now() - run.startedAt)}</span></div>`
    + (run.agents?.length ? `<div class="assist-team-status meta">${run.agents.map(a => `${esc(a.role)}: ${esc(a.status)}`).join('<br>')}</div>` : '')
    + (spent ? `<div class="assist-live-spent meta">${esc(spent)}</div>` : '');
  return html;
}
