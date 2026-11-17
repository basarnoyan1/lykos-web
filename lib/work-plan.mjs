// The assistant's plan of its own work (owner, 14 Nov 2026: "in-app ai should also be able to have progress things, task lists etc of its
// work so easier to see"; Claude Code's task list as the pattern). The model keeps it with update_plan (lib/chat-tools.mjs): the whole list
// of short steps once, then advance, done or start, and for a step over records how many are done. The list is a block of the answer
// ('work-plan'), so it is saved with the thread, its checkpoint and an interrupted turn; the step a turn left under way is drawn by how the
// turn ended (done, failed, else stopped), so a turn recovered after a quit needs no rewrite. Its steps have the Agent work page's shape (name, state, started, ended, done, total, unit: lib/agent-progress.mjs),
// so the chat draws them with that page's step rows (views/agents.mjs) and counts "5 of 12 records" as it does. State is a mark and a weight,
// never a hue (plan §2): a check, a turning ring, a dashed circle, a stop or a cross.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_components$hangRow as hangRow } from "../boot.mjs";
import { unitsText } from './agent-progress.mjs';
import { lib_assistant_status$elapsedLabel as elapsedLabel } from "../boot.mjs";

export const PLAN_KEY = 'work-plan';
export const PLAN_MAX = 12;
/** The model's words for a step's state, and the card's. */
const STATE_IN = { pending: 'waiting', in_progress: 'running', completed: 'done' };
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const count = v => (Number.isFinite(+v) && +v >= 0 && v !== '' && v != null ? Math.floor(+v) : null);

/** The plan block in a list of blocks (a run's or a saved answer's), or null. */
export const planOf = blocks => (blocks || []).find(b => b?.type === PLAN_KEY && Array.isArray(b.steps)) || null;

/**
 * The plan after one update_plan call. `a.steps` replaces the list (strings or { title, status, total, unit }; a step kept by its title
 * keeps its times); `advance` finishes the step under way and starts the next; `done` (1-based) finishes those; `start` starts that one
 * (the one under way before it goes back to waiting unless it was finished); `count`, `total` and `unit` say how far the step under way is
 * over records. One step is under way at most, and while steps wait one is always under way. Throws a sentence the model can act on.
 */
export function nextPlan(prev, a = {}, now = Date.now()) {
  const at = new Date(now).toISOString(), before = prev?.steps || [];
  let steps;
  if (Array.isArray(a.steps)) {
    if (!a.steps.length || a.steps.length > PLAN_MAX) throw new Error(`Pass 1 to ${PLAN_MAX} steps`);
    steps = a.steps.map(x => {
      const o = typeof x === 'string' ? { title: x } : x || {}, name = clip(o.title ?? o.content ?? o.name, 80);
      if (!name) throw new Error('Each step needs a short title');
      const was = before.find(s => s.name === name) || {}, total = count(o.total) ?? was.total;
      return { name, state: STATE_IN[o.status] || was.state || 'waiting', ...(was.started ? { started: was.started } : {}), ...(was.ended ? { ended: was.ended } : {}),
        ...(total ? { total, unit: clip(o.unit ?? was.unit, 24), done: Math.min(was.done || 0, total) } : {}) };
    });
  } else {
    if (!before.length) throw new Error('No plan yet: pass the whole list of steps first');
    steps = before.map(s => ({ ...s }));
  }
  const finish = i => { const s = steps[i]; if (s && s.state !== 'done') { s.state = 'done'; s.ended = at; s.started ||= at; if (s.total) s.done = s.total; } };
  const begin = i => { const s = steps[i]; s.state = 'running'; s.started ||= at; delete s.ended; };
  // steps count from 1; a call that names step 0 counts from 0 (both free models did, 15 Nov 2026), so its numbers are read one higher
  const zero = [...(Array.isArray(a.done) ? a.done : []), a.start].some(k => k != null && count(k) === 0);
  const index = k => { const c = count(k), i = c == null ? null : c + (zero ? 1 : 0); if (i == null || i < 1 || i > steps.length) throw new Error(`Steps are numbered 1 to ${steps.length}`); return i - 1; };
  if (a.advance) { const i = steps.findIndex(s => s.state === 'running'); if (i >= 0) finish(i); }
  for (const k of Array.isArray(a.done) ? a.done : []) finish(index(k));
  if (a.start != null) { const k = index(a.start); steps.forEach((s, i) => { if (i !== k && s.state === 'running') s.state = 'waiting'; }); begin(k); }
  let under = false;
  for (const s of steps) if (s.state === 'running') { if (under) s.state = 'waiting'; else { under = true; s.started ||= at; } }
  if (!under) { const i = steps.findIndex(s => s.state === 'waiting'); if (i >= 0) begin(i); }
  const cur = steps.find(s => s.state === 'running');
  if (cur) {
    const total = count(a.total);
    if (total) { cur.total = total; cur.unit = clip(a.unit ?? cur.unit, 24); }
    else if (a.unit != null && cur.total) cur.unit = clip(a.unit, 24);
    if (count(a.count) != null && cur.total) cur.done = Math.min(count(a.count), cur.total);
  }
  return { key: PLAN_KEY, type: PLAN_KEY, title: 'Plan', steps };
}

/** What the model is told back: the list as it now stands, numbered, so its next call can name a step. */
export const planReply = plan => ({ steps: plan.steps.map((s, i) => `${i + 1}. [${s.state === 'running' ? 'in_progress' : s.state === 'done' ? 'completed' : 'pending'}] ${s.name}${s.total ? ` (${s.done || 0} of ${s.total}${s.unit ? ` ${s.unit}` : ''})` : ''}`),
  shown: 'The list is shown to the person under your message. Advance it as each step ends; do not repeat it in your answer.' });
/** The tool row's own words ("Plan: step 2 of 4"). */
export const planRecord = plan => { const i = plan.steps.findIndex(s => s.state === 'running'), d = plan.steps.filter(s => s.state === 'done').length;
  return i >= 0 ? `Plan: step ${i + 1} of ${plan.steps.length}` : `Plan: ${d} of ${plan.steps.length} done`; };

/** The step under way in words, for the status bar's item: "Step 2 of 4: Read the screening log, 5 of 12 records". '' with no step under way. */
export function planNow(plan) {
  const steps = plan?.steps || [], i = steps.findIndex(s => s.state === 'running');
  if (i < 0) return '';
  const s = steps[i];
  return `Step ${i + 1} of ${steps.length}: ${s.name}${s.total ? `, ${unitsText({ done: s.done || 0, total: s.total, unit: s.unit })}` : ''}`;
}

const WORD = { done: 'Done', running: 'Under way', waiting: 'Not started', skipped: 'Not run', stopped: 'Stopped', failed: 'Failed' };
const MARK = { done: 'check', stopped: 'stop', failed: 'close' };
const since = s => Date.parse(s.started || '');
/** What the step a turn left under way became, by the answer's status (lib/assistant.mjs: done, error, stopped, interrupted, budget, incomplete). */
export const endedAs = status => (status === 'done' ? 'done' : status === 'error' ? 'failed' : 'stopped');
/**
 * The steps as the Agent work page's track (hangRow rows, `.agw-step` with its node), drawn without hue. `live` while the turn runs: the
 * step under way says its time so far (data-plan-since, which the shell's clock keeps current) and its count. Once ended (`status`, the
 * answer's), a step that never started is "Not run" and the one under way is done, failed or stopped as the turn ended.
 */
export function planRows(steps, { live = false, status = 'done', now = Date.now() } = {}) {
  return `<ol class="agw-track assist-plan-track">${(steps || []).map(s => {
    // a saved project is data: a state the list does not know is drawn as one not started, never written into the markup
    const was = WORD[s.state] ? s.state : 'waiting', state = live ? was : was === 'waiting' ? 'skipped' : was === 'running' ? endedAs(status) : was;
    const t0 = since(s), ms = Date.parse(s.ended) - t0, took = state === 'done' && ms >= 0 ? (ms < 1000 ? '<1s' : elapsedLabel(ms)) : '';
    const when = state === 'running' && Number.isFinite(t0) ? `<span class="agw-when" data-plan-since="${t0}">${esc(elapsedLabel(now - t0))}</span>`
      : took ? `<span class="agw-when">${esc(took)}</span>` : ['skipped', 'stopped', 'failed'].includes(state) ? `<span class="agw-when">${esc(WORD[state])}</span>` : '';
    const units = s.total && (state === 'running' || state === 'stopped' || state === 'failed') ? `<p class="agw-why">${esc(unitsText({ done: s.done || 0, total: s.total, unit: s.unit }))}</p>` : '';
    return hangRow({ tag: 'li', cls: 'agw-step', attrs: `data-step="${state}"`, mark: `<span class="agw-node">${MARK[state] ? icon(MARK[state], { size: 12 }) : ''}</span>`,
      body: `<p class="agw-step-title"><span class="agw-line"><span class="visually-hidden">${WORD[state]}: </span>${esc(s.name)}</span>${when}</p>${units}` });
  }).join('')}</ol>`;
}

/** The list while the turn runs, under its latest words. */
export const planLiveHtml = plan => (plan?.steps?.length ? `<section class="assist-plan" aria-label="Plan">${planRows(plan.steps, { live: true })}</section>` : '');

/** In the thread once the turn ended: folded to "4 steps" (or "4 steps, 2 done"), opened in place. `status` is the answer's. */
export function planFoldHtml(plan, key, status = 'done') {
  const steps = plan?.steps || [], n = steps.length;
  if (!n) return '';
  const done = steps.filter(s => s.state === 'done' || (s.state === 'running' && endedAs(status) === 'done')).length, said = `${n} ${n === 1 ? 'step' : 'steps'}${done < n ? `, ${done} done` : ''}`;
  return `<details class="assist-plan assist-plan-fold" data-activity-key="${esc(key)}"><summary>${esc(said)}</summary>${planRows(steps, { status })}</details>`;
}
