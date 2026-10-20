// The Workflows pages around the canvas: the home list of saved workflows with
// the pipeline of each one's last run, a workflow's runs and required checks,
// one run's detail, and its versions with structural diffs (plan, workflow
// amendment of 2026-09-28). The canvas editor stays in workflows.mjs.
import { get, update, subscribe } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { saveFile } from '../lib/save.mjs';
import { runFlow, rerunFlow, stopFlow, preflight } from '../lib/flow-runner.mjs';
import { pipelineHtml, pipelineStages, attachPipelineCards, glyph, duration, ago } from '../lib/pipeline-graph.mjs';
import { runWhen } from '../lib/workflow-history.mjs';
import { recordVersion, restoreVersion, diffFlows, isEmptyDiff, fieldLabel, blockName, runNumbers, structureKey, versionSnapshot } from '../lib/flow-versions.mjs';
import { settingsOf } from '../lib/app-settings.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiStatusLine } from '../lib/ui-actions.mjs';
import { when, day, plural } from '../lib/dates.mjs';

import { workflowNavigation } from '../lib/workflow-navigation.mjs';

/** Which page shows, and what is open on it. Kept across renders. */
const visits = workflowNavigation({ follow: null, page: 'home', flowId: null, runId: null, query: '', openBlock: undefined, openVersion: null, compare: null, feedback: '' });
export const nav = visits.state;
export const go = (page, props = {}) => visits.go(page, props);
export const back = (fallback = 'home') => visits.back(fallback);
export const resetNavigation = (page = 'home', props = {}) => visits.reset(page, props);

const PRESETS = { '0 * * * *': 'Every hour', '*/15 * * * *': 'Every 15 minutes', '0 9 * * *': 'Daily at 09:00', '0 9 * * 1-5': 'Weekdays at 09:00', '0 9 * * 1': 'Mondays at 09:00', '0 9 1 * *': 'Monthly at 09:00' };
const pad = n => String(n).padStart(2, '0');
export function scheduleLabel(cron) {
  if (PRESETS[cron]) return PRESETS[cron];
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(String(cron || '').trim());
  return m ? `Daily at ${pad(m[2])}:${pad(m[1])}` : `Cron ${cron}`;
}
const triggerText = f => [f.enabled && f.cron ? `Scheduled · ${scheduleLabel(f.cron)}` : 'Manual', f.protected ? 'Protected' : '', `${f.blocks?.length || 0} block${f.blocks?.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
const runsOf = id => (get().workflowRuns || []).filter(r => r.flowId === id && !r.parentRunId);
const flowOf = id => (get().workflows || []).find(f => f.id === id);
const runMark = r => !r ? 'pending' : r.superseded ? 'skipped' : ({ done: 'passed', failed: 'failed', waiting: 'warning', running: 'running', cancelled: 'skipped' })[r.status] || 'pending';
// an imported run has a duration only when its source measured one (a job's start and end)
const runTime = r => r?.imported ? (r.durationMs != null ? duration(r.durationMs) : '') : r ? duration((r.endedAt ? new Date(r.endedAt) : r.status === 'running' ? Date.now() : NaN) - new Date(r.at)) : '';
// A run's state is a word, kept short so a list's state column stays narrow; the rest of the old status text is its note.
const statusWord = r => !r ? 'Not run' : r.imported ? (r.superseded ? 'Superseded' : 'Imported')
  : ({ running: 'Running', waiting: 'Waiting for review', done: 'Passed', failed: 'Failed', cancelled: 'Stopped' })[r.status] || r.status;
function statusNote(r) {
  if (!r) return '';
  if (r.imported) return runWhen(r, { time: false });
  const settled = Object.values(r.nodeStates || {}).filter(s => ['done', 'skipped', 'error'].includes(s)).length;
  const failed = r.flow?.blocks?.find(b => r.nodeStates?.[b.id] === 'failed');
  return ({ running: `${settled} of ${r.flow?.blocks?.length || 0} blocks`, done: ago(r.endedAt || r.at), failed: [failed ? `at ${blockName(failed)}` : '', ago(r.endedAt || r.at)].filter(Boolean).join(' · '),
    cancelled: ago(r.endedAt || r.at) })[r.status] || '';
}
const runStatus = r => [statusWord(r), statusNote(r)].filter(Boolean).join(' · ');
function runTrigger(r, numbers) {
  if (r.imported) return ['Imported', r.tableVersion ? `Table ${r.tableVersion}` : '', r.by].filter(Boolean).join(' · ');
  if (r.trigger === 'schedule') return 'Scheduled';
  if (r.trigger === 'rerun') return `Re-run of run ${numbers.get(r.rerunOf) || ''} · ${r.by || 'You'}`;
  return `Manual${r.by ? ` · ${r.by}` : ''}`;
}
const runNumber = (r, numbers) => numbers.get(r.id) || r.number || '';
const runRef = (r, numbers) => `Run ${runNumber(r, numbers)}${r.version ? ` · v${r.version}` : ''}`;
const statusHtml = (r, text = runStatus(r)) => `<span class="wf-status-mark wf-status-wrap">${`<span class="pipe-dot" data-mark="${runMark(r)}">${glyph(runMark(r))}</span>`}<span>${esc(text)}</span></span>`;
// A pipeline in a row is drawn at one design width (it folds stages into "+n" itself), so no row needs measuring.
const ROW_PIPE = 200;
const pipeHost = (flowId, r) => { const flow = r?.flow || flowOf(flowId); return `<div class="pipe" data-run="${esc(r?.id || '')}" data-flow="${esc(flowId)}">${flow ? pipelineHtml(flow, r || null, ROW_PIPE) : ''}</div>`; };
/** The list row's state, one phrase that says what the last run did and when (a run kept from the project's records is a run like any other). */
export function listState(r) {
  if (!r) return 'Not run';
  if (r.imported) return `Last run ${day(r.endedAt || r.at)}`;
  return ({ running: 'Running', waiting: 'Waiting for review', failed: 'Failed', cancelled: 'Stopped', done: `Finished ${day(r.endedAt || r.at)}` })[r.status] || r.status;
}
/** The tone of a list row's state: a verdict colour only where the state asks for the reader (failed, waiting), neutral otherwise. */
const stateTone = r => (r && !r.imported ? ({ failed: 'bad', waiting: 'warn' })[r.status] : '') || '';
/**
 * A workflow's blocks as a strip under its title: a circle a block in run order on a thin line, each with its verdict's glyph and colour (done a
 * green check, failed a red cross, waiting amber, running the accent, not run an empty neutral ring), seven at most and then "+N".
 */
const STRIP_MAX = 7;
export function stripHtml(flow, r) {
  const blocks = pipelineStages(flow || { blocks: [] }).flat(), shown = blocks.slice(0, STRIP_MAX);
  const word = { passed: 'done', failed: 'failed', warning: 'waits for review', running: 'running', skipped: 'skipped', pending: 'not run' };
  const dots = shown.map(b => { const mark = r ? runMarkOf(r, b.id) : 'pending'; return `<span class="pipe-dot" data-mark="${mark}" title="${esc(blockName(b))}: ${word[mark] || mark}">${glyph(mark)}</span>`; });
  return `<span class="wf-strip" role="img" aria-label="${esc(`${blocks.length} blocks`)}">${dots.join('<span class="wf-strip-link"></span>')}${blocks.length > STRIP_MAX ? `<span class="wf-strip-more">+${blocks.length - STRIP_MAX}</span>` : ''}</span>`;
}
const short = v => { const t = v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };

// ---- pages ---------------------------------------------------------------

export function homeHtml() {
  const flows = [...(get().workflows || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Empty, it reads like every other empty view: a mark and a title; New workflow is the title bar's.
  if (!flows.length) return emptyState({ icon: 'workflow', title: 'No workflows' });
  const head = uiBar({ kind: 'tools', label: 'Workflows', id: 'wf-home',
    filters: [{ type: 'search', id: 'wf-filter', label: 'Filter workflows', placeholder: 'Filter', value: nav.query }] });
  const rows = flows.map(f => {
    const r = runsOf(f.id)[0], numbers = runNumbers(get().workflowRuns, f.id), failing = preflight(f).find(c => !c.ok && c.error);
    const busy = r && ['running', 'waiting'].includes(r.status), name = f.name || 'Untitled workflow';
    // the row's one quiet action: what the workflow's state asks for next (Review a waiting run, Cancel a running one, else Run)
    const action = r?.status === 'waiting' ? { id: `wf-review-${f.id}`, label: `Review ${name}`, icon: 'check', attrs: { 'data-act': 'review', 'data-id': f.id } }
      : r?.status === 'running' ? { id: `wf-cancel-${f.id}`, label: `Cancel the run of ${name}`, icon: 'stop', attrs: { 'data-act': 'cancel', 'data-run': r.id } }
      : { id: `wf-run-${f.id}`, label: `Run ${name}`, icon: 'run', disabled: !!failing, attrs: { 'data-act': 'run', 'data-id': f.id } };
    return uiRow({ cls: 'wf-item', attrs: { 'data-name': String(f.name || '').toLowerCase() },
      // line 1: the title, then the state, the action and More on its line; line 2: the blocks' strip under the title and what the workflow is
      main: { html: `<button type="button" class="tk-text" data-act="open" data-id="${esc(f.id)}" title="${esc(name)}">${esc(name)}</button>`,
        detail: [stripHtml(r?.flow || f, r), ...[triggerText(f), r ? runRef(r, numbers) : '', failing && !busy ? failing.error : ''].filter(Boolean).map(esc)] },
      cells: [{ col: 'state', kind: 'text', ch: 20, html: failing && !busy ? '<span class="wf-state">Needs setup</span>' : `<span class="wf-state"${stateTone(r) ? ` data-tone="${stateTone(r)}"` : ''}>${esc(listState(r))}</span>` }],
      end: uiRowEnd({ inline: action, more: { label: `More for ${name}`, attrs: { 'data-act': 'more', 'data-id': f.id } } }) });
  });
  return `${head}<p class="wf-feedback meta" role="status">${esc(nav.feedback)}</p>${uiList({ id: 'wf-list', label: 'Workflows', cols: ['state'], attrs: { 'data-wf-list': '' }, rows })}<p class="wf-nomatch meta" hidden>No matching workflows</p>`;
}

/** The checks a run must pass: a row each, its result in a fixed cell and what to fix under its name. */
function checksHtml(f) {
  const rows = preflight(f).map(c => { const mark = c.ok ? 'passed' : c.blocked ? 'skipped' : 'warning';
    return uiRow({ main: { html: esc(c.label), detail: c.ok || c.blocked ? [] : [esc(c.error)], wrap: true },
      cells: [{ col: 'result', kind: 'text', ch: 12, html: `<span class="wf-status-mark"><span class="pipe-dot" data-mark="${mark}">${glyph(mark)}</span><span>${c.ok ? 'Passed' : c.blocked ? 'Not checked' : 'To fix'}</span></span>` }] }); });
  return `<section class="wf-section"><h3>Checks</h3>${uiList({ id: 'wf-checks', label: 'Checks', cols: ['result'], rows })}</section>`;
}

export function runsHtml() {
  const f = flowOf(nav.flowId); if (!f) { go('home'); return homeHtml(); }
  const runs = runsOf(f.id), numbers = runNumbers(get().workflowRuns, f.id);
  const rows = runs.map(r => uiRow({ cls: 'wf-run-item',
    main: { html: `<button type="button" class="wf-link" data-act="run-detail" data-run="${esc(r.id)}"><strong>${esc(runRef(r, numbers))}</strong></button>${pipeHost(f.id, r)}`,
      detail: [statusHtml(r, statusWord(r)), esc(runTrigger(r, numbers)), esc([statusNote(r), r.imported ? runWhen(r) : when(r.at), runTime(r)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · '))] } }));
  return `<p class="wf-feedback meta" role="status">${esc(nav.feedback)}</p>${checksHtml(f)}
    <section class="wf-section"><h3>Runs</h3>${uiList({ id: 'wf-runs', label: 'Runs', rows, empty: '<p class="meta">No runs yet</p>' })}</section>`;
}

function blockDetail(r, b) {
  const d = r.nodeDetails?.[b.id] || {}, error = String(d.error || '');
  // the error is said once, here; the log keeps the other events
  const logs = (r.nodeLogs?.[b.id] || []).filter(l => !error || l.message !== error).slice(-20), text = String(r.texts?.[b.id] || '');
  const finished = !['running', 'waiting'].includes(r.status);
  return `<div class="wf-step-detail">${error ? `<p class="wf-error">${esc(error)}</p>` : ''}${d.reused ? '<p class="meta">Output kept from an earlier run</p>' : ''}
    ${text ? `<div class="wf-output">${esc(text.length > 1200 ? `${text.slice(0, 1200)}…` : text)}</div>` : ''}
    ${logs.length ? `<ol class="wf-log">${logs.map(l => `<li>${l.at && !r.dateOnly ? `<time>${esc(when(l.at))}</time>` : ''}<span>${esc(l.message)}</span></li>`).join('')}</ol>` : ''}
    ${uiBar({ kind: 'tools', label: 'Block', id: `wf-step-actions-${b.id}`, actions: [
      ...(finished && !r.imported ? [{ id: `wf-rerun-from-${b.id}`, label: 'Re-run from here', attrs: { 'data-act': 'rerun-from', 'data-run': r.id, 'data-node': b.id } }] : []),
      { id: `wf-inspect-${b.id}`, label: 'Open block', attrs: { 'data-act': 'inspect', 'data-run': r.id, 'data-node': b.id } }] })}</div>`;
}
const runMarkOf = (r, id) => { const s = r.nodeStates?.[id]; return !s ? (r.imported || ['running', 'waiting'].includes(r.status) ? 'pending' : 'skipped') : ({ done: 'passed', skipped: 'skipped', cancelled: 'skipped', error: 'warning', waiting: 'warning', failed: 'failed', running: 'running', retrying: 'running' })[s] || 'pending'; };

/** One run: a sentence for its outcome, one meta line, and the blocks as a vertical timeline in run order. */
export function runHtml() {
  const r = (get().workflowRuns || []).find(x => x.id === nav.runId); if (!r) { go(nav.flowId ? 'runs' : 'home'); return nav.page === 'runs' ? runsHtml() : homeHtml(); }
  const numbers = runNumbers(get().workflowRuns, r.flowId), failed = r.flow.blocks.find(b => r.nodeStates?.[b.id] === 'failed'), waiting = r.flow.blocks.find(b => r.nodeStates?.[b.id] === 'waiting');
  const by = r.imported ? ['Imported', r.tableVersion ? `table ${r.tableVersion}` : '', r.by ? `by ${r.by}` : ''].filter(Boolean).join(', ') : r.trigger === 'schedule' ? 'Scheduled' : r.trigger === 'rerun' ? `Re-run of run ${numbers.get(r.rerunOf) || ''}, by ${r.by === 'You' || !r.by ? 'you' : r.by}` : `Manual, by ${r.by === 'You' || !r.by ? 'you' : r.by}`;
  const at = r.imported ? runWhen(r) : when(r.at);
  const metaLine = uiStatusLine({ id: 'wf-run-meta', label: 'Run details', parts: [
    ...(r.version ? [{ id: 'wf-run-version', button: true, text: `v${r.version}`, drop: 4, attrs: { 'data-act': 'versions', 'data-id': r.flowId } }] : []),
    { id: 'wf-run-by', text: by, drop: 6 }, { id: 'wf-run-at', text: at, drop: 2 }, ...(runTime(r) ? [{ id: 'wf-run-time', text: runTime(r), drop: 8 }] : [])] });
  // the failed or waiting block is open unless the reader chose otherwise
  const open = nav.openBlock === undefined ? (failed || waiting)?.id : nav.openBlock;
  const stages = pipelineStages(r.flow);
  const steps = stages.map((s, i) => `${i && stages.length > 1 ? `<li class="wf-step-cap" aria-hidden="true"><span></span><span class="meta">Stage ${i + 1}</span></li>` : ''}${s.map(b => {
    const state = r.nodeStates?.[b.id], d = r.nodeDetails?.[b.id], mark = runMarkOf(r, b.id), quiet = ['skipped', 'pending'].includes(mark);
    const right = quiet ? (state === 'skipped' ? 'Skipped' : state === 'cancelled' ? 'Stopped' : r.imported ? 'Not recorded' : 'Not run') : d?.durationMs != null ? duration(d.durationMs)
      : r.imported && d?.outputCount != null ? plural(d.outputCount, 'record') : state === 'running' ? 'Running' : '';
    const line = `<span class="wf-step-name">${esc(blockName(b))}</span><span class="meta">${esc(right)}</span>`;
    return `<li class="wf-step" data-mark="${mark}"><span class="pipe-dot" data-mark="${mark}">${glyph(mark)}</span><div class="wf-step-body">${quiet
      ? `<div class="wf-step-line">${line}</div>`
      : `<button class="wf-step-line" data-act="block" data-node="${esc(b.id)}" aria-expanded="${open === b.id}">${line}</button>${open === b.id ? blockDetail(r, b) : ''}`}</div></li>`;
  }).join('')}`).join('');
  return `${metaLine}
    ${r.imported ? `<div class="wf-history"><p>${esc(r.summary || '')}</p>${r.imported.note ? `<p class="meta">${esc(r.imported.note)}</p>` : ''}<p class="meta">From ${esc(r.imported.source || 'project records')}</p></div>` : ''}
    <p class="wf-feedback meta" role="status">${esc(nav.feedback)}</p>
    <ol class="wf-timeline">${steps}</ol>`;
}

function diffHtml(before, after) {
  const d = diffFlows(before, after);
  if (isEmptyDiff(d)) return emptyState({ title: 'No structural changes', size: 'inline' });
  const rows = [['Added', d.added.map(x => x.name)], ['Removed', d.removed.map(x => x.name)],
    ['Changed', d.changed.map(c => `${c.newName}: ${c.fields.map(x => `${fieldLabel(x.key)} ${short(x.before)} → ${short(x.after)}`).join('; ')}`)],
    ['Connections', d.edgesAdded || d.edgesRemoved ? [[d.edgesAdded ? `${d.edgesAdded} added` : '', d.edgesRemoved ? `${d.edgesRemoved} removed` : ''].filter(Boolean).join(' · ')] : []],
    ['Workflow', d.settingChanges.map(x => `${x.key === 'enabled' ? 'Schedule on' : x.label[0].toUpperCase() + x.label.slice(1)}: ${x.key === 'enabled' ? `${x.before ? 'Yes' : 'No'} → ${x.after ? 'Yes' : 'No'}` : `${short(x.before)} → ${short(x.after)}`}`)]].filter(([, v]) => v.length);
  return uiList({ label: 'Changes', rows: rows.map(([k, v]) => uiRow({ main: { html: esc(k), detail: v.map(esc), wrap: true } })) });
}

export function versionsHtml() {
  const f = flowOf(nav.flowId); if (!f) { go('home'); return homeHtml(); }
  const list = get().workflowVersions?.[f.id] || [], latest = list.at(-1);
  const rows = [...list].reverse().map(v => {
    const current = v === latest, open = nav.openVersion === v.n, comparing = nav.compare === v.n, prev = list[list.indexOf(v) - 1];
    const diff = `${open ? `<div class="wf-version-diff"><p class="meta">${prev ? `Changes from v${prev.n}` : 'First kept version'}</p>${prev ? diffHtml(prev.flow, v.flow) : ''}</div>` : ''}${comparing ? `<div class="wf-version-diff"><p class="meta">From v${v.n} to current</p>${diffHtml(v.flow, latest.flow)}</div>` : ''}`;
    return uiRow({ cls: 'wf-version-item',
      main: { html: `<button type="button" class="wf-link wf-version-main" data-act="version" data-n="${v.n}" aria-expanded="${open}"><strong>v${v.n}</strong><span class="wf-version-text">${esc(v.message || v.summary)}</span></button>${diff}`,
        detail: [current ? 'Current' : '', v.message ? esc(v.summary) : '', esc(v.author || ''), esc(when(v.at))] },
      end: current ? '' : uiRowEnd({ primary: { id: `wf-compare-${v.n}`, label: 'Compare', pressed: comparing, attrs: { 'data-act': 'compare', 'data-n': v.n } },
        more: { label: `More for v${v.n}`, attrs: { 'data-act': 'version-more', 'data-n': v.n } } }) });
  });
  return `<p class="wf-feedback meta" role="status">${esc(nav.feedback)}</p>${uiList({ id: 'wf-versions', label: 'Versions', rows })}${list.length >= 50 ? '<p class="meta">Latest 50 versions</p>' : ''}`;
}

// ---- the title bar ----------------------------------------------------------

/** A command of the title bar does what the same command of a row does (act below), on the page that is open. */
const press = (api, data) => anchor => act({ dataset: data, getAttribute: () => null, disabled: false, anchor }, document.querySelector('#view .wf-page'), api);
/** What a run is called: its number and how it ended. */
export function runTitle(r, numbers = runNumbers(get().workflowRuns, r.flowId)) {
  const n = runNumber(r, numbers), failed = r.flow?.blocks?.find(b => r.nodeStates?.[b.id] === 'failed'), waiting = r.flow?.blocks?.find(b => r.nodeStates?.[b.id] === 'waiting');
  if (r.imported) return `Run ${n} · Imported${r.superseded ? ' · Superseded' : ''}`;
  return ({ done: `Run ${n} passed`, failed: `Run ${n} failed${failed ? ` at ${blockName(failed)}` : ''}`, running: `Run ${n} is running`,
    waiting: `Run ${n} waits for review${waiting ? ` at ${blockName(waiting)}` : ''}`, cancelled: `Run ${n} was stopped` })[r.status] || `Run ${n}`;
}
/**
 * The title bar of the page that is open (lib/topbar.mjs): the list's (New workflow), a workflow's runs and checks (Run, Open, Versions),
 * one run (Re-run, Review or Cancel, and Open in editor) or a workflow's versions (Open). A sub-page goes back with the bar's Back.
 * `api` is the view's (workflows.mjs): render, newWorkflow, openEditor.
 */
export function pageSpec(api) {
  const backTo = (page, label) => ({ label, run: () => { back(page); api.render(); } });
  const r = nav.page === 'run' ? (get().workflowRuns || []).find(x => x.id === nav.runId) : null, f = flowOf(r?.flowId || nav.flowId);
  if (nav.page === 'run' && r) {
    const cancel = { id: 'wf-cancel', label: 'Cancel run', run: press(api, { act: 'cancel', run: r.id }) };
    const unsettled = r.flow.blocks.some(b => !['done', 'skipped', 'error'].includes(r.nodeStates?.[b.id]));
    // imported history is read only: Re-run starts a new run of the workflow as it is now
    const acts = r.imported ? [{ id: 'wf-rerun', label: 'Re-run', run: press(api, { act: 'run-fresh', id: r.flowId }) }]
      : r.status === 'running' ? [cancel]
      : r.status === 'waiting' ? [{ id: 'wf-review', label: 'Review', role: 'primary', run: press(api, { act: 'review', id: r.flowId }) }, cancel]
      : [{ id: 'wf-rerun', label: 'Re-run', run: press(api, { act: 'rerun', run: r.id }) }, ...(unsettled ? [{ id: 'wf-rerun-failed', label: 'Re-run failed', run: press(api, { act: 'rerun-failed', run: r.id }) }] : [])];
    return { title: runTitle(r), back: backTo('runs', 'Back to runs'), actions: [...acts, { id: 'wf-open-editor', label: 'Open in editor', run: press(api, { act: 'inspect', run: r.id }) }] };
  }
  if ((nav.page === 'runs' || nav.page === 'versions') && f) {
    const open = { id: 'wf-open', label: 'Open', run: () => api.openEditor(f.id) };
    if (nav.page === 'versions') {
      const n = (get().workflowVersions?.[f.id] || []).length;
      return { title: `Versions of ${f.name || 'Untitled workflow'}`, status: { text: plural(n, 'version'), ch: 12 }, back: backTo('runs', 'Back to runs'), actions: [open] };
    }
    const busy = runsOf(f.id).some(x => ['running', 'waiting'].includes(x.status)), failing = preflight(f).some(c => !c.ok);
    return { title: f.name || 'Untitled workflow', status: { text: plural(runsOf(f.id).length, 'run'), ch: 12 }, back: backTo('home', 'Back to Workflows'),
      actions: [{ id: 'wf-versions', label: 'Versions', run: press(api, { act: 'versions', id: f.id }) }, open,
        { id: 'wf-run', label: 'Run', icon: 'run', role: 'primary', disabled: failing || busy, run: press(api, { act: 'run', id: f.id }) }] };
  }
  const n = (get().workflows || []).length;
  return { title: 'Workflows', ...(n ? { status: { text: plural(n, 'workflow'), ch: 14 } } : {}),
    actions: [{ id: 'wf-new', label: 'New workflow', icon: 'plus', role: 'primary', menu: true, run: anchor => api.newWorkflow(anchor) }] };
}

// ---- actions -------------------------------------------------------------

const author = () => settingsOf(get()).reviewerName || 'You';
/** Record the saved workflow as a version if it changed since the latest (an assistant edit, an import). */
function syncVersion(id) {
  const f = flowOf(id); if (!f) return;
  const list = get().workflowVersions?.[id] || [];
  if (list.length && structureKey(list.at(-1).flow) === structureKey(f)) return;
  update(s => { const r = recordVersion(s.workflowVersions?.[id] || [], f, { author: list.length ? 'Saved outside the editor' : author() }); (s.workflowVersions ||= {})[id] = r.versions; return s; });
}

async function act(b, el, api) {
  const { act: kind, id } = b.dataset, say = t => { nav.feedback = t; const p = el?.querySelector('.wf-feedback'); if (p) p.textContent = t; };
  // A run that starts and then fails says so in its own row; only a refusal (checks, a run already active) is feedback here.
  const since = Date.now() - 1000, created = flowId => runsOf(flowId).some(r => new Date(r.at) >= since);
  const start = (promise, flowId) => { promise.catch(e => { if (!created(flowId)) { nav.feedback = e.message; api.render(); } }); api.render(); };
  switch (kind) {
    case 'new': return api.newWorkflow(b.anchor || b);
    case 'open': return api.openEditor(id);
    case 'review': return api.openEditor(id, { review: true });
    case 'back': back(b.dataset.to); return api.render();
    case 'runs': go('runs', { flowId: id }); return api.render();
    case 'versions': syncVersion(id); go('versions', { flowId: id }); return api.render();
    case 'run-detail': go('run', { flowId: nav.flowId, runId: b.dataset.run }); return api.render();
    case 'run': return start(runFlow(id), id);
    case 'run-fresh': go('runs', { flowId: id }); return start(runFlow(id), id);
    case 'cancel': stopFlow(b.dataset.run); say('Stopping after active requests finish'); return;
    case 'rerun': case 'rerun-failed': case 'rerun-from': {
      const old = get().workflowRuns.find(r => r.id === b.dataset.run);
      const opts = kind === 'rerun' ? { all: true } : kind === 'rerun-from' ? { from: [b.dataset.node] } : {};
      // the page follows the new run once the runner records it (renderPage)
      nav.follow = { of: old.id, at: Date.now() - 1000 };
      rerunFlow(old.id, opts).catch(e => { if (created(old.flowId)) return; nav.follow = null; nav.feedback = e.message; api.render(); }); return;
    }
    case 'inspect': return api.openEditor(get().workflowRuns.find(r => r.id === b.dataset.run)?.flowId, { inspectRun: b.dataset.run, node: b.dataset.node });
    case 'block': { const open = b.getAttribute('aria-expanded') === 'true'; nav.openBlock = open ? null : b.dataset.node; return api.render(); }
    case 'version': nav.openVersion = nav.openVersion === Number(b.dataset.n) ? null : Number(b.dataset.n); return api.render();
    case 'compare': nav.compare = nav.compare === Number(b.dataset.n) ? null : Number(b.dataset.n); return api.render();
    case 'restore': return restore(Number(b.dataset.n), say, api);
    case 'version-more': { const n = Number(b.dataset.n); return showMenu(b, [{ label: 'Restore…', run: () => restore(n, say, api) }], { align: 'end' }); }
    case 'more': return moreMenu(b, id, api);
  }
}

async function restore(n, say, api) {
  const f = flowOf(nav.flowId);
  if (!await confirmAsk(`Restore v${n}?`, { detail: 'Saved as a new version', confirm: 'Restore' })) return;
  if ((get().workflowRuns || []).some(r => r.flowId === f.id && ['running', 'waiting'].includes(r.status))) return say('Finish or stop the current run first');
  update(s => { const r = restoreVersion(s.workflowVersions?.[f.id] || [], n, s.workflows.find(x => x.id === f.id), { author: author() }); s.workflows = s.workflows.map(x => x.id === f.id ? r.flow : x); s.workflowVersions[f.id] = r.versions; return s; });
  nav.openVersion = nav.compare = null; nav.feedback = `Restored v${n}`; return api.render();
}

function moreMenu(b, id, api) {
  const f = flowOf(id);
  showMenu(b, [
    { label: 'Open', run: () => api.openEditor(id) },
    { label: 'Runs', run: () => { go('runs', { flowId: id }); api.render(); } },
    { label: 'Versions', run: () => { syncVersion(id); go('versions', { flowId: id }); api.render(); } },
    '-',
    { label: 'Duplicate', run: () => {
      const copy = { ...versionSnapshot(f), id: crypto.randomUUID(), name: `${f.name || 'Workflow'} copy`, enabled: false };
      update(s => { s.workflows = [...(s.workflows || []), copy]; (s.workflowVersions ||= {})[copy.id] = recordVersion([], copy, { author: author(), message: `Duplicated from ${f.name}` }).versions; return s; });
      nav.feedback = `Duplicated as ${copy.name}`; api.render();
    } },
    { label: 'Export…', run: () => saveFile(JSON.stringify({ format: 'lykos-workflow-1', workflow: { ...versionSnapshot(f), enabled: false } }, null, 2), 'workflow.json', 'application/json') },
    '-',
    { label: 'Delete…', danger: true, run: async () => {
      if (!await confirmAsk(`Delete ${f.name || 'this workflow'}?`, { detail: 'Its versions are deleted too', confirm: 'Delete', danger: true })) return;
      update(s => { s.workflows = (s.workflows || []).filter(x => x.id !== id); if (s.workflowVersions) delete s.workflowVersions[id]; return s; });
      api.render();
    } },
  ], { align: 'end' });
}

// ---- render --------------------------------------------------------------

let cleanup = () => {};
export function unmountPage() { cleanup(); cleanup = () => {}; }
const signature = () => {
  const s = get();
  return JSON.stringify([nav, (s.workflows || []).map(f => [f.id, f.name, f.cron, f.enabled, f.protected, structureKey(f)]),
    (s.workflowRuns || []).filter(r => !r.parentRunId).slice(0, 300).map(r => [r.id, r.status, r.nodeStates, r.endedAt]),
    Object.entries(s.workflowVersions || {}).map(([k, v]) => [k, v.length, v.at(-1)?.n]), settingsOf(s).models.profiles.map(p => p.id)]);
};

export function renderPage(el, api) {
  cleanup();
  if (nav.follow) {
    const next = (get().workflowRuns || []).find(r => r.rerunOf === nav.follow.of && new Date(r.at) >= nav.follow.at);
    if (next) { go('run', { flowId: next.flowId, runId: next.id }); nav.follow = null; }
  }
  const html = nav.page === 'runs' ? runsHtml() : nav.page === 'run' ? runHtml() : nav.page === 'versions' ? versionsHtml() : homeHtml();
  el.innerHTML = `<section class="wf-page" data-page="${nav.page}">${html}</section>`;
  const root = el.firstElementChild;
  const filter = () => {
    const q = nav.query.trim().toLowerCase(); let shown = 0;
    root.querySelectorAll('.wf-item[data-name]').forEach(row => { row.hidden = !!q && !row.dataset.name.includes(q); if (!row.hidden) shown++; });
    const none = root.querySelector('.wf-nomatch'); if (none) none.hidden = shown > 0;
  };
  root.querySelector('#wf-filter')?.addEventListener('input', e => { nav.query = e.target.value; filter(); });
  filter();
  root.addEventListener('click', e => {
    const dot = e.target.closest('[data-pipe-node]');
    if (dot) {
      const host = dot.closest('[data-run]');
      if (host.dataset.run) { go('run', { flowId: host.dataset.flow, runId: host.dataset.run, openBlock: dot.dataset.pipeNode }); api.render(); }
      else api.openEditor(host.dataset.flow);
      return;
    }
    const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b, root, api);
  });
  const cards = attachPipelineCards(root, id => (get().workflowRuns || []).find(r => r.id === id));
  let seen = signature(), frame = 0;
  // a run that moves on changes the page and its title bar's commands (Cancel becomes Re-run): the view is drawn again, head and body
  const off = subscribe(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!root.isConnected) return; const next = signature(); if (next !== seen) { seen = next; api.render(); } }); });
  cleanup = () => { off(); cards(); cancelAnimationFrame(frame); };
}
