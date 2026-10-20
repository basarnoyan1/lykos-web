// The workflow editor's side panes, as strings from the shared builders (they render in Node: workflow-inspector.test.mjs).
//
// The inspector is one pane beside the canvas. Its head names what it shows and holds Close and the pane's one More; its body is one of five:
// a block's settings, the block's result in a run, the blocks of a run, the review a run waits for, and the workflow's options. Every row of it
// is a builder row (uiBar, uiList and uiRow, formField, disclosure) and every state is said once: a run's state is the first part of one status
// line, an empty section is one quiet line with nothing to press. The two panes on the canvas's left are the block palette and Find block.
//
// A block's Settings are drawn by one renderer from one table (FIELD_CONTROLS in lib/flow-blocks.mjs): the type of a block decides only which
// rows exist, in one order for every type (name, who does it, the type's fields, approval, failure, inputs, the foot).
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { when, plural } from '../lib/dates.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiStatusLine, uiNotice } from '../lib/ui-actions.mjs';
import { formField, disclosure } from '../lib/ui-components.mjs';
import { BLOCKS, FIELD_CONTROLS, FIELD_OPTIONS, FIELD_LABELS, BLOCK_DEFAULTS, FLOW_TEMPLATES, usableHere } from '../lib/flow-blocks.mjs';
import { AGENT_TOOLS } from '../lib/flow-agent.mjs';
import { RESEARCH_TYPES } from '../lib/flow-research.mjs';
import { SOURCES } from '../lib/sources.mjs';
import { SITES } from '../lib/site-search.mjs';
import { queryOutline } from '../lib/query-view.mjs';

/** A block's state in a run, one word. */
export const STATE_LABEL = { queued: 'Queued', running: 'Running', retrying: 'Retrying', waiting: 'Review', done: 'Done', failed: 'Failed', cancelled: 'Stopped', skipped: 'Skipped', error: 'Error handled' };
/** A run's state, one word. */
export const RUN_LABEL = { done: 'Done', waiting: 'Waiting for review', running: 'Running', failed: 'Failed', cancelled: 'Stopped', skipped: 'Skipped', error: 'Error handled' };
export const GROUPS = ['Sources', 'Research', 'Routing', 'Enrichment', 'Records', 'Actions'];
const def = b => BLOCKS.find(d => d.id === b?.type);
export const blockName = b => b?.label || def(b)?.label || b?.type || 'Block';
const options = (list, value) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
const check = (id, label, checked, attrs = '') => `<label class="cr-check"><input type="checkbox"${id ? ` id="${id}"` : ''}${checked ? ' checked' : ''}${attrs}><span>${esc(label)}</span></label>`;
const form = rows => `<div class="flow-form">${rows.filter(Boolean).join('')}</div>`;
const quiet = text => `<p class="meta">${esc(text)}</p>`;

// ---- the pane head and the switch under it --------------------------------------------------------------------------------

/** The pane's head: what it shows, Close (an icon, as every pane's), and the pane's one More with the commands of what it shows. */
export function inspectorHeadHtml({ title, overflow = [] }) {
  return uiBar({ kind: 'head', label: 'Inspector', id: 'flow-inspector-head', lead: { title, level: 'h3', id: 'flow-inspector-title' }, plainMore: true,
    actions: [{ id: 'flow-close', label: 'Close', icon: 'close', role: 'quiet', plain: true, presence: 'reserve' }], overflow });
}
/** A block of a workflow that has run shows its settings or its result in that run. The switch stands under the pane's head and is named by it (the block). */
export const modeSwitchHtml = (mode, name = 'Block') => uiBar({ kind: 'tools', label: 'Inspector view', id: 'flow-inspector-tabs',
  view: { id: 'flow-inspector-mode', label: name, attr: 'data-inspector-mode', kind: 'segmented', value: mode, items: [['settings', 'Settings'], ['result', 'Run result']] } });

// ---- a block's settings ------------------------------------------------------------------------------------------------

const TEXT_LABEL = { notify: 'Message', todo: 'Task text', note: 'Note text' };
const NO_EXECUTOR = new Set(['team', 'merge', 'condition', 'input', 'output', 'subworkflow', 'batch', 'wait', 'http']);
const NO_APPROVAL = new Set(['team', 'criteria', 'dual_review', 'screen_pass', 'fanout']);

/** Which rows a block's Settings hold, in the one order every type shares. Pure: the renderer below draws each row. */
export function settingsPlan(b) {
  const d = def(b) || { fields: [] }, ai = b.executor === 'ai', human = b.executor === 'human', templated = ['note', 'todo', 'notify'].includes(b.type) && !ai;
  const rows = [{ row: 'name' }];
  if (!RESEARCH_TYPES.has(b.type) && !NO_EXECUTOR.has(b.type)) rows.push({ row: 'executor' });
  if (ai || d.model) rows.push({ row: 'model' });
  if ((ai || human) && b.type !== 'task') rows.push({ row: 'field', field: 'instructions' });
  for (const field of d.fields) {
    if (b.type === 'note' && field === 'text' && !ai && !human) rows.push({ row: 'note' });
    else if (field === 'text' && templated) rows.push({ row: 'text' });
    else rows.push({ row: 'field', field });
  }
  if (!human && !NO_APPROVAL.has(b.type)) rows.push({ row: 'approval' });
  rows.push({ row: 'field', field: 'retries' }, { row: 'field', field: 'onError' });
  if (ai) rows.push({ row: 'tools' });
  return rows;
}

const RETRIES = [['0', 'Off'], ['1', '1'], ['2', '2'], ['3', '3']];
const ON_ERROR = [['stop', 'Stop workflow'], ['continue', 'Use error output']];
/** One field of a block, drawn from its kind in FIELD_CONTROLS. `env` carries the project's lists (teams, workflows, collections). */
function fieldHtml(b, field, env) {
  const value = b[field] ?? BLOCK_DEFAULTS[field] ?? '', at = `data-field="${field}"`;
  if (field === 'retries') return formField('Retry temporary failures', `<select ${at}>${options(RETRIES, Number(b.retries || 0))}</select>`);
  if (field === 'onError') return formField('On failure', `<select ${at}>${options(ON_ERROR, b.onError === 'continue' ? 'continue' : 'stop')}</select>`);
  const label = FIELD_LABELS[field] || field, kind = FIELD_CONTROLS[field] || 'long';
  // A search's query is read as its logic under the text: each AND, OR, NOT and proximity group with its terms (lib/query-view.mjs).
  if (field === 'query' && b.type === 'search') return `${formField(label, `<textarea ${at} rows="6" spellcheck="false">${esc(value)}</textarea>`)}<div class="bq" id="flow-query-outline" aria-label="Query logic">${queryOutline(value, { source: b.source })}</div>`;
  switch (kind) {
    case 'text': return formField(label, `<input ${at} value="${esc(value)}" spellcheck="false">`);
    case 'url': return formField(label, `<input ${at} type="url" value="${esc(value)}" placeholder="https://…" spellcheck="false">`);
    case 'number': return formField(label, `<input ${at} inputmode="decimal" value="${esc(value)}">`);
    case 'choice': return formField(label, `<select ${at}>${options(FIELD_OPTIONS[field] || [], value)}</select>`);
    case 'source': return formField(label, `<select ${at}>${options([...SOURCES, ...SITES].map(s => [s.id, s.name]), value)}</select>`);
    case 'collection': return formField(label, `<select ${at}>${options([['', 'All library records'], ...(env.collections || []).map(c => [c.id, c.name])], value)}</select>`);
    case 'workflow': return formField(label, `<select ${at}>${options([['', 'Choose a saved workflow'], ...(env.workflows || []).map(f => [f.id, f.name || 'Untitled workflow'])], value)}</select>`);
    case 'team': return formField(label, `<span class="record-picker"><button type="button" id="flow-team-pick" aria-haspopup="menu" aria-expanded="false">${esc((env.teams || []).find(t => t.id === value)?.name || 'Choose a model team')}</button></span>`);
    default: return formField(label, `<textarea ${at} rows="3"${field === 'text' ? ` placeholder="${b.type === 'criteria' ? 'Paste protocol criteria' : 'Write text'}"` : ''}>${esc(value)}</textarea>`);
  }
}

/** The text of a note, a task or a message: the field, Insert value, and what it will say with the values filled in. */
function textEditorHtml(b, value) {
  const label = TEXT_LABEL[b.type] || 'Text';
  return `${formField(label, `<textarea data-field="text" rows="4" placeholder="Write ${b.type === 'notify' ? 'a message' : b.type === 'todo' ? 'a task' : 'a note'}">${esc(value)}</textarea>`)}
    ${uiBar({ kind: 'tools', label: 'Text values', id: 'flow-value-tools', actions: [{ id: 'flow-insert', label: 'Insert value', icon: 'plus', menu: true }] })}
    ${uiBar({ kind: 'head', label: 'Preview', id: 'flow-preview-head', lead: { title: 'Preview', level: 'h3' }, status: { id: 'flow-preview-source', text: 'Example', ch: 16 } })}
    <div id="flow-text-preview" class="flow-text"></div><p id="flow-value-warning" class="meta" role="status" hidden></p>`;
}

function rowHtml(b, r, env) {
  const value = b[r.field] ?? BLOCK_DEFAULTS[r.field] ?? '';
  switch (r.row) {
    case 'name': return formField('Name', `<input data-field="label" value="${esc(b.label || '')}" placeholder="${esc(def(b)?.label || '')}">`);
    case 'executor': return formField('Assigned to', `<select id="flow-executor">${options((b.type === 'task' ? ['ai', 'human'] : ['automatic', 'ai', 'human']).map(m => [m, { automatic: 'Automatic', ai: 'AI model', human: 'Person' }[m]]), b.executor || 'automatic')}</select>`);
    case 'model': return (env.models || []).length
      ? formField('Model', `<select data-field="modelId">${options([['', 'Choose a model'], ...env.models.map(m => [m.id, `${m.label || m.model} · ${m.provider}`])], b.modelId)}</select>`)
      : uiNotice({ id: 'flow-model-missing', label: 'Model', text: 'No model is set up', actions: [{ id: 'flow-model-setup', label: 'Set up a model' }] });
    case 'note': {
      const fromOutput = String(b.text ?? '').trim() === '{{output}}';
      return `${formField('Note content', `<select id="flow-note-content">${options([['output', 'Previous step’s output'], ['custom', 'Write text']], fromOutput ? 'output' : 'custom')}</select>`)}<div id="flow-note-text" class="flow-form"${fromOutput ? ' hidden' : ''}>${textEditorHtml(b, fromOutput ? '' : value)}</div>`;
    }
    case 'text': return textEditorHtml(b, value);
    case 'approval': return check('flow-review-required', 'Require human approval', !!b.review);
    case 'tools': return `<h3 class="flow-section">Agent tools</h3>${AGENT_TOOLS.map(([id, label]) => check('', label, b.tools?.includes(id), ` data-agent-tool="${id}"`)).join('')}${formField('Tool calls per task', `<input data-field="maxToolCalls" inputmode="decimal" value="${esc(b.maxToolCalls ?? 3)}">`)}`;
    default: return fieldHtml(b, r.field, env);
  }
}

/**
 * A block's Settings. env: { models (those this block can use), teams, workflows (those it can call), collections, inputs (null for a source:
 * [{ label, detail }] of its connections) }.
 */
export function settingsHtml(b, env = {}) {
  const rows = settingsPlan(b).map(r => rowHtml(b, r, env));
  const inputs = env.inputs == null ? '' : inputsHtml(env.inputs);
  const foot = uiBar({ kind: 'foot', label: 'Block', id: 'flow-node-actions', start: [{ id: 'flow-remove', label: 'Remove block', role: 'destructive' }],
    actions: [{ id: 'flow-duplicate-block', label: 'Duplicate', icon: 'duplicate' }], overflow: [{ id: 'flow-reuse', label: 'Save to blocks' }] });
  return `${form(rows)}${inputs}${foot}`;
}

/** A block's connected inputs: a head with its count and Add input, a row per connection, and the place where a new one is chosen. */
function inputsHtml(inputs) {
  const rows = inputs.map((x, i) => uiRow({ main: { html: esc(x.label), detail: x.detail ? [esc(x.detail)] : [] },
    end: uiRowEnd({ inline: { id: `flow-disconnect-${i}`, label: `Disconnect ${x.label}`, icon: 'close', attrs: { 'data-disconnect-index': i } }, more: { label: `More for ${x.label}`, attrs: { 'data-input-more': i } } }) }));
  const head = uiBar({ kind: 'head', label: 'Inputs', id: 'flow-inputs-head', lead: { title: 'Inputs', level: 'h3' }, status: { id: 'flow-inputs-count', text: String(inputs.length), ch: 4 },
    actions: [{ id: 'flow-add-input', label: 'Add input', icon: 'plus', role: 'quiet', attrs: { 'aria-expanded': 'false' } }] });
  return `<section class="flow-inputs">${uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-input-list', label: 'Inputs', head, rows, empty: quiet('No inputs connected') })}
    <div id="flow-input-picker" hidden>${uiBar({ kind: 'tools', label: 'Find an input', id: 'flow-connect-tools', filters: [{ type: 'search', id: 'flow-connect-query', label: 'Find an input block', placeholder: 'Find a block', width: 'flex' }] })}<div id="flow-input-choices"></div></div></section>`;
}
/** The outputs a new input can come from: a row each, pressed to connect; eight at most, the count of the rest said under them. */
export function inputChoicesHtml(choices, total) {
  const rows = choices.map(c => uiRow({ main: { html: `<button type="button" class="flow-pick" data-connect-source="${esc(c.id)}" data-connect-port="${esc(c.port)}">${esc(c.label)}</button>`, detail: c.detail ? [esc(c.detail)] : [] } }));
  return `${uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-input-choice-list', label: 'Outputs to connect', rows, empty: quiet('No matching outputs') })}${total > choices.length ? quiet(`${choices.length} of ${total} outputs`) : ''}`;
}

// ---- runs and a block's result ---------------------------------------------------------------------------------------

/** A run as its picker names it: when it ran and how it ended. */
export const runLabel = (r, whenOf = x => when(x.at)) => [whenOf(r), r.imported ? 'Imported' : RUN_LABEL[r.status] || r.status, r.parentRunId ? 'Child run' : ''].filter(Boolean).join(' · ');
/** The run the inspector shows: one picker, the latest first. */
export function runPickHtml(runs, current, whenOf) {
  return formField('Run', `<select id="flow-run-pick">${options(runs.map(r => [r.id, runLabel(r, whenOf)]), current?.id)}</select>`);
}

/** A run's blocks, each with its state; pressing one shows its result. */
export function runBlocksHtml(blocks, stateOf) {
  const rows = blocks.map(b => uiRow({ main: { html: `<button type="button" class="flow-pick" data-inspect-node="${esc(b.id)}">${esc(blockName(b))}</button>` }, cells: [{ col: 'state', kind: 'text', html: esc(stateOf(b.id)), ch: 12 }] }));
  return uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-run-blocks', label: 'Blocks of this run', cols: ['state'], rows, empty: quiet('No matching blocks') });
}

/**
 * The one status line of a block's result: its state first, then what the run measured. `state` is the word; `detail` the run's record of the
 * block (counts, attempts, time). Nothing is said twice and nothing is a dash.
 */
export function resultStatusParts({ state, detail, imported = false, pending = false, trimmed = false }) {
  const parts = [state];
  if (detail) {
    if (detail.inputCount != null) parts.push(`${detail.inputCount} in`);
    if (detail.outputCount != null) parts.push(`${detail.outputCount} out`);
    if (!imported && detail.attempts) parts.push(plural(detail.attempts, 'attempt'));
    if (!imported && detail.durationMs != null) parts.push(`${(detail.durationMs / 1000).toFixed(1)} s`);
  }
  if (pending) parts.push('Awaiting approval');
  if (trimmed) parts.push('Latest 200 events');
  return parts.filter(Boolean);
}
export function resultStatusHtml(parts) {
  return uiStatusLine({ id: 'flow-result-status', label: 'Block result', parts: parts.map((text, i) => ({ id: `flow-result-part-${i}`, text, drop: i ? Math.min(9, i + 2) : 0 })) });
}
/** The head of a block's result: its name for the section, and the switch of what it shows. */
export const resultHeadHtml = tab => uiBar({ kind: 'head', label: 'Block result', id: 'flow-result-head', lead: { title: 'Block result', level: 'h3' },
  view: { id: 'flow-result-view', label: 'Block result', attr: 'data-result-tab', kind: 'segmented', value: tab, items: [['input', 'Input'], ['output', 'Output'], ['logs', 'Logs']] } });

/** Events of a block in a run: when, then what happened; the run page's log (workflow-pages.mjs), so a log reads the same everywhere. */
export function logsHtml(logs, { dateOnly = false } = {}) {
  if (!logs.length) return quiet('No events recorded');
  return `<ol class="wf-log" id="flow-log" aria-label="Events">${logs.map(e => `<li>${e.at && !dateOnly ? `<time>${esc(when(e.at))}</time>` : ''}<span>${esc(e.message)}</span></li>`).join('')}</ol>`;
}
/** What a block received: a row per connection with its records, and the text it passed on. */
export function inputsResultHtml(inputs) {
  if (!inputs.length) return quiet('No incoming data');
  const rows = inputs.map(x => uiRow({ main: { html: `${esc(x.label)}${x.text ? `<div class="flow-text">${esc(x.text)}</div>` : ''}`, detail: [x.port && x.port !== 'main' ? esc(x.port) : '', esc(plural(x.records.length, 'record')), x.active ? '' : 'Skipped'] } }));
  return uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-input-results', label: 'Inputs received', rows });
}
/** The records of a result, a page at a time. */
export function recordRowsHtml(records) {
  return records.map(r => uiRow({ main: { html: esc(r.title || r.label || r.id || r.key || 'Record'), detail: [r.year ? esc(r.year) : '', r.doi ? esc(r.doi) : ''] } }));
}
/** The workflows a block ran (Run workflow, For each batch): a row each, pressed to inspect it. */
export function childRunsHtml(children) {
  const rows = children.map(c => uiRow({ main: { html: `<button type="button" class="flow-pick" data-child-run="${esc(c.id)}">${esc(c.name)} · ${esc(c.iteration ?? '')}</button>` }, cells: [{ col: 'state', kind: 'text', html: esc(RUN_LABEL[c.status] || c.status), ch: 12 }] }));
  return disclosure({ id: 'flow-child-runs', title: 'Workflow runs', count: children.length, open: true, body: uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-child-list', label: 'Workflow runs', cols: ['state'], rows }) });
}
/** A tool an agent called, with what it asked and how many records came back. */
export function toolCallsHtml(tools, labelOf) {
  const rows = tools.map(t => uiRow({ main: { html: `${esc(labelOf(t.tool))}<pre class="flow-raw">${esc(JSON.stringify(t.arguments, null, 2))}</pre>`, detail: [esc(plural(t.count || 0, 'record'))] } }));
  return disclosure({ id: 'flow-tool-calls', title: 'Tool requests', count: tools.length, body: uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-tool-list', label: 'Tool requests', rows }) });
}

// ---- the review a run waits for ----------------------------------------------------------------------------------------

/** What a run waits for: which step (when more than one), what to do, the fields for it, the records it passes, and Stop or continue. */
export function reviewHtml({ pending, current, block, cache = null, labelOf }) {
  const p = current, records = p.records || [], fixed = p.kind === 'dual_review' || p.kind === 'criteria';
  const pick = pending.length > 1 ? formField('Step', `<select id="flow-review-node">${options(pending.map(x => [x.nodeId, x.label || labelOf(x.nodeId)]), p.nodeId)}</select>`) : '';
  const fields = p.kind === 'site'
    ? [formField('Query', `<textarea rows="5" readonly>${esc(p.query || '')}</textarea>`), formField('Export file', '<input type="file" id="flow-review-files" accept=".ris,.txt,.nbib" multiple>')]
    : [block?.type === 'search' && p.kind === 'human' ? formField('Search query', `<input id="flow-review-query" value="${esc(cache?.query ?? p.query ?? '')}">`) : '',
      formField(p.kind === 'human' ? 'Completed work' : 'Review notes', `<textarea id="flow-review-text" rows="5"${fixed ? ' readonly' : ''}>${esc(cache?.text ?? p.text ?? '')}</textarea>`)];
  const rows = records.map((r, i) => uiRow({ check: { checked: !cache?.recordIds || cache.recordIds.includes(r.id || r.key), label: `Pass on: ${r.title || r.label || r.id}`, attrs: { 'data-record': i, ...(fixed ? { disabled: true } : {}) } },
    main: { html: esc(r.title || r.label || r.id) } }));
  const list = p.kind === 'site' ? '' : disclosure({ id: 'flow-review-records', title: 'Output records', count: records.length, open: true, body: uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-review-list', label: 'Output records', rows, empty: quiet('No records') }) });
  const approve = p.kind === 'human' ? 'Complete and continue' : p.kind === 'site' ? 'Add and continue' : 'Approve and continue';
  const foot = uiBar({ kind: 'foot', label: 'Review', id: 'flow-review-actions', start: [{ id: 'flow-reject', label: 'Stop run' }],
    actions: [...(p.kind === 'dual_review' ? [{ id: 'flow-open-screening', label: 'Open Screening' }] : []), { id: 'flow-approve', label: approve, role: 'primary' }] });
  return `${form([pick, `<h3 class="flow-section">${['human', 'site'].includes(p.kind) ? 'Your step' : 'Review before continuing'}</h3>`, p.instructions ? `<p class="flow-text">${esc(p.instructions)}</p>` : '', ...fields])}${list}${foot}`;
}

// ---- the workflow's options --------------------------------------------------------------------------------------------

export const SCHEDULE_PRESETS = [['0 * * * *', 'Every hour'], ['*/15 * * * *', 'Every 15 minutes'], ['0 9 * * *', 'Daily at 09:00'], ['0 9 * * 1-5', 'Weekdays at 09:00'], ['0 9 * * 1', 'Mondays at 09:00'], ['0 9 1 * *', 'Monthly at 09:00']];
/** How many runs to keep, how much runs at once, protection and the schedule. */
export function optionsHtml(draft) {
  const preset = SCHEDULE_PRESETS.find(([v]) => v === draft.cron);
  const schedule = form([check('flow-enabled', 'Run on this schedule', !!draft.enabled),
    formField('Repeat', `<select id="flow-schedule-preset">${options([['', 'Custom'], ...SCHEDULE_PRESETS], preset ? preset[0] : '')}</select>`),
    formField('Cron expression', `<input id="flow-cron" value="${esc(draft.cron || '')}" placeholder="0 9 * * 1" title="Minute, hour, day, month, weekday" spellcheck="false">`),
    formField('Missed occurrences', `<select id="flow-catch-up">${options([['skip', 'Skip'], ['latest', 'Run the latest on reopening']], draft.catchUp === 'latest' ? 'latest' : 'skip')}</select>`),
    '<div id="flow-schedule-preview" aria-live="polite"></div>']);
  return `${form([
    formField('Keep completed runs', `<select id="flow-retention">${options([10, 25, 50, 100].map(n => [n, String(n)]), Number(draft.keepRuns || 25))}</select>`),
    formField('Parallel agent calls', `<input id="flow-agent-concurrency" inputmode="decimal" value="${esc(draft.maxAgentConcurrency || 4)}">`),
    formField('Agent calls per run', `<input id="flow-agent-limit" inputmode="decimal" value="${esc(draft.maxAgentCalls || 1000)}">`),
    formField('Parallel blocks', `<select id="flow-concurrency">${options([1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, n === 1 ? '1, one at a time' : String(n)]), Number(draft.concurrency || 3))}</select>`),
    check('flow-protected', 'Approve library writes', !!draft.protected)])}
    ${disclosure({ id: 'flow-schedule', title: 'Schedule', meta: draft.enabled && draft.cron ? preset?.[1] || draft.cron : 'Off', body: schedule })}`;
}
/** The next times a schedule runs, in local time while the app is open, or why it cannot. */
export function schedulePreviewHtml({ dates = [], enabled = false, status = '', at = '', error = '' }) {
  const rows = dates.map((d, i) => uiRow({ main: { html: esc(when(d)) }, cells: [{ col: 'n', kind: 'text', html: i ? '' : 'Next', ch: 4 }] }));
  return `<h3 class="flow-section">${enabled ? 'Next runs' : 'Schedule preview'}</h3>${dates.length ? uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-next-runs', label: 'Next runs', cols: ['n'], rows }) : quiet('No matching date within eight years')}
    ${quiet('Runs in local time while the app is open')}${at ? quiet(`${status} · ${when(at)}`) : ''}${error ? `<p class="flow-error">${esc(error)}</p>` : ''}`;
}

// ---- the palette, Find block and the empty canvas ----------------------------------------------------------------------

/** The blocks to add, by group: a search, then a row per block (pressed to add beside the selection, or dragged onto the canvas). */
export function paletteHtml(custom = []) {
  const row = (attr, iconName, label, group, tip = '') => uiRow({ main: { html: `<button type="button" class="flow-pick" data-block="${esc(attr)}" data-group="${esc(group)}"${tip ? ` title="${esc(tip)}"` : ''}>${icon(iconName)}<span>${esc(label)}</span></button>` } });
  const groups = GROUPS.map(g => ({ g, rows: usableHere(BLOCKS).filter(b => b.group === g).map(b => row(b.id, b.icon, b.label, g, b.description)) }));
  if (custom.length) groups.push({ g: 'Custom', rows: custom.map(c => row(`custom:${c.id}`, def(c.block)?.icon || 'note', c.name, 'Custom')) });
  const lists = groups.map(({ g, rows }) => `<h3 class="flow-block-group" data-group="${esc(g)}">${esc(g)}</h3>${uiList({ label: `${g} blocks`, attrs: { 'data-block-group': g, 'data-flow-list': '' }, rows })}`);
  return `${uiBar({ kind: 'tools', label: 'Find a block', id: 'flow-palette-tools', filters: [{ type: 'search', id: 'flow-block-search', label: 'Find a block', placeholder: 'Find a block', width: 'flex' }] })}
    <div class="flow-block-list" role="region" aria-label="Workflow blocks">${lists.join('')}<p class="meta flow-block-none" hidden>No matching blocks</p></div>`;
}
/** Find block: a search and a state filter over the blocks, a row each. */
export function finderHtml({ query = '', status = '' } = {}) {
  return `${uiBar({ kind: 'head', label: 'Find block', id: 'flow-navigator-head', lead: { title: 'Find block', level: 'h3' }, plainMore: true, actions: [{ id: 'flow-navigator-close', label: 'Close', icon: 'close', role: 'quiet', plain: true, presence: 'reserve' }] })}
    ${uiBar({ kind: 'tools', label: 'Find blocks', id: 'flow-find-tools', filters: [{ type: 'search', id: 'flow-find-query', label: 'Search workflow blocks', placeholder: 'Name, type or instructions', value: query, width: 'flex' },
      { type: 'select', id: 'flow-find-status', label: 'Filter blocks by state', value: status, options: [['', 'All blocks'], ...Object.entries(STATE_LABEL)] }] })}
    <div id="flow-find-results"></div>`;
}
export function finderRowsHtml(blocks, noteOf) {
  const rows = blocks.map(b => uiRow({ main: { html: `<button type="button" class="flow-pick" data-find-node="${esc(b.id)}">${esc(blockName(b))}</button>`, detail: [esc(noteOf(b))] } }));
  return uiList({ cls: 'flow-list', attrs: { 'data-flow-list': '' }, id: 'flow-find-list', label: 'Blocks', rows, empty: quiet('No matching blocks') });
}
/** An empty canvas offers a blank start and a few templates, each named by what it does for the review. */
export function starterHtml(ids = ['watch', 'multi', 'review-team']) {
  const rows = [uiRow({ main: { html: `<button type="button" id="flow-start" class="flow-pick">Blank workflow</button>`, detail: ['Place blocks on the canvas yourself'] } }),
    ...ids.map(id => usableHere(FLOW_TEMPLATES).find(t => t.id === id)).filter(Boolean).map(t => uiRow({ main: { html: `<button type="button" class="flow-pick" data-template="${esc(t.id)}">${esc(t.name)}</button>`, detail: [esc(t.purpose || '')] } }))];
  return `<div class="flow-empty"><div class="flow-starters"><h2 class="empty-title">New workflow</h2>${uiList({ id: 'flow-starter-list', label: 'Start a workflow', attrs: { 'data-flow-list': '' }, rows })}</div></div>`;
}
