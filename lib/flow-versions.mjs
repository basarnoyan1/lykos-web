// Workflow versions and run history helpers, pure over plain objects.
//
// Every save that changes a workflow's structure adds an immutable version
// (v1, v2, …) with its time, author, an optional message and a summary of what
// changed. Restoring adds a new version; history is never rewritten. At most
// VERSION_LIMIT versions are kept per workflow; moving blocks alone is layout,
// not a new version.
import { BLOCKS, FIELD_LABELS } from './flow-blocks.mjs';
import { isSettled } from './flow-routing.mjs';

export const VERSION_LIMIT = 50;
const RUNTIME = ['lastSlot', 'scheduleCheckedSlot', 'scheduledFor', 'scheduleAt', 'scheduleStatus', 'scheduleError'];
const LAYOUT = ['x', 'y'];
const SETTINGS = { name: 'name', cron: 'schedule', enabled: 'schedule', catchUp: 'missed occurrences', concurrency: 'parallel blocks', keepRuns: 'run retention',
  maxAgentConcurrency: 'parallel agent calls', maxAgentCalls: 'agent call limit', protected: 'protection' };
const FIELD = { teamId:'model team', label: 'name', modelId: 'model', executor: 'assignee', review: 'approval', retries: 'retries', onError: 'failure handling',
  tools: 'agent tools', maxToolCalls: 'tool-call limit', instructions: 'instructions', query: 'query', text: 'text' };

const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
export const blockName = b => b?.label || BLOCKS.find(d => d.id === b?.type)?.label || b?.type || 'Block';
const edgeKey = e => `${e.from}>${e.to}:${e.port || 'main'}`;

/** What a version stores: the workflow without its scheduler bookkeeping. */
export function versionSnapshot(flow) {
  const f = structuredClone(flow);
  for (const k of RUNTIME) delete f[k];
  return f;
}
/** Identity of a workflow's structure: layout and bookkeeping excluded. */
export function structureKey(flow) {
  const f = versionSnapshot(flow); delete f.direction; f.enabled = !!f.enabled; f.protected = !!f.protected;
  f.blocks = (f.blocks || []).map(b => Object.fromEntries(Object.entries(b).filter(([k]) => !LAYOUT.includes(k))));
  f.edges = (f.edges || []).map(e => ({ from: e.from, to: e.to, port: e.port || 'main' }));
  return stable(f);
}

/** Blocks added, removed and changed (by field), connections and workflow settings. */
export function diffFlows(before, after) {
  const a = new Map((before?.blocks || []).map(b => [b.id, b])), b = new Map((after?.blocks || []).map(x => [x.id, x]));
  const added = [...b.values()].filter(x => !a.has(x.id)).map(x => ({ id: x.id, name: blockName(x) }));
  const removed = [...a.values()].filter(x => !b.has(x.id)).map(x => ({ id: x.id, name: blockName(x) }));
  const changed = [];
  for (const [id, next] of b) {
    const prev = a.get(id); if (!prev) continue;
    const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter(k => !['id', ...LAYOUT].includes(k));
    const fields = keys.filter(k => stable(prev[k] ?? null) !== stable(next[k] ?? null))
      .map(k => ({ key: k, before: prev[k], after: next[k] }));
    if (fields.length) changed.push({ id, name: blockName(prev), newName: blockName(next), fields });
  }
  const ea = new Set((before?.edges || []).map(edgeKey)), eb = new Set((after?.edges || []).map(edgeKey));
  const norm = (k, v) => k === 'enabled' || k === 'protected' ? !!v : v ?? null;
  const keys = Object.keys(SETTINGS).filter(k => stable(norm(k, before?.[k])) !== stable(norm(k, after?.[k])));
  const settings = [...new Set(keys.map(k => SETTINGS[k]))];
  const settingChanges = keys.map(k => ({ key: k, label: SETTINGS[k], before: before?.[k], after: after?.[k] }));
  return { added, removed, changed, edgesAdded: [...eb].filter(k => !ea.has(k)).length, edgesRemoved: [...ea].filter(k => !eb.has(k)).length, settings, settingChanges };
}
export const fieldLabel = k => FIELD[k] || (FIELD_LABELS[k] || k).toLowerCase();
export const isEmptyDiff = d => !d.added.length && !d.removed.length && !d.changed.length && !d.edgesAdded && !d.edgesRemoved && !d.settings.length;

/** "Added Screening pass 3; changed query of PubMed search". */
export function describeDiff(d) {
  const parts = [];
  if (d.added.length) parts.push(`added ${d.added.map(x => x.name).join(', ')}`);
  if (d.removed.length) parts.push(`removed ${d.removed.map(x => x.name).join(', ')}`);
  for (const c of d.changed) {
    const rename = c.fields.find(f => f.key === 'label'), rest = c.fields.filter(f => f.key !== 'label');
    if (rename) parts.push(`renamed ${c.name} to ${c.newName}`);
    if (rest.length) parts.push(`changed ${rest.map(f => fieldLabel(f.key)).join(' and ')} of ${c.newName}`);
  }
  const wires = d.edgesAdded + d.edgesRemoved;
  if (wires && !d.added.length && !d.removed.length) parts.push(`rewired ${wires} connection${wires === 1 ? '' : 's'}`);
  if (d.settings.length) parts.push(`changed ${d.settings.join(', ')}`);
  if (!parts.length) return 'No changes';
  const text = parts.length > 4 ? [...parts.slice(0, 3), `${parts.length - 3} more changes`].join('; ') : parts.join('; ');
  return text[0].toUpperCase() + text.slice(1);
}

/** Add a version unless the structure matches the latest. Returns the new list and version (or null). */
export function recordVersion(list = [], flow, { author = 'You', message = '', at = new Date().toISOString(), restoredFrom } = {}) {
  const last = list.at(-1);
  if (last && structureKey(last.flow) === structureKey(flow)) return { versions: list, version: null };
  const version = { n: (last?.n || 0) + 1, at, author, message: String(message || '').trim().slice(0, 160),
    summary: last ? describeDiff(diffFlows(last.flow, flow)) : 'Created', flow: versionSnapshot(flow), ...(restoredFrom ? { restoredFrom } : {}) };
  return { versions: [...list, version].slice(-VERSION_LIMIT), version };
}

/** The workflow as it was at version `n`, saved as a new version. The current schedule switch is kept. */
export function restoreVersion(list, n, current, { author, at } = {}) {
  const v = list.find(x => x.n === n); if (!v) throw new Error('That version is no longer kept.');
  const flow = { ...versionSnapshot(v.flow), id: current.id, enabled: !!current.enabled && !!v.flow.cron };
  for (const k of RUNTIME) if (current[k] != null) flow[k] = current[k];
  const { versions, version } = recordVersion(list, flow, { author, at, message: `Restored v${n}`, restoredFrom: n });
  return { flow, versions, version };
}

/** The latest version number for this exact structure, recording one if the saved workflow drifted (an assistant edit, an import). */
export function ensureVersion(s, flow, author = 'You') {
  s.workflowVersions ||= {};
  const list = s.workflowVersions[flow.id] || [];
  const { versions, version } = recordVersion(list, flow, { author });
  s.workflowVersions[flow.id] = versions;
  return (version || list.at(-1)).n;
}

// ---- runs --------------------------------------------------------------

const top = (runs, flowId) => (runs || []).filter(r => r.flowId === flowId && !r.parentRunId);
/** The number the next run of a workflow gets: stable while older runs are pruned. */
export function nextRunNumber(runs, flowId) {
  const mine = top(runs, flowId);
  return Math.max(mine.length, ...mine.map(r => r.number || 0)) + 1;
}
/** Run numbers, including runs recorded before numbering (numbered by age). */
export function runNumbers(runs, flowId) {
  const mine = top(runs, flowId), map = new Map();
  [...mine].filter(r => !r.number).sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach((r, i) => map.set(r.id, i + 1));
  for (const r of mine) if (r.number) map.set(r.id, r.number);
  return map;
}

/**
 * Which blocks a re-run executes again and which keep the earlier run's output.
 * `from` are the chosen blocks; any block the earlier run did not settle runs
 * again too, and so does everything downstream of a block that runs again.
 */
export function rerunPlan(run, from = []) {
  const blocks = run.flow?.blocks || [], edges = run.flow?.edges || [];
  const again = new Set(from.filter(id => blocks.some(b => b.id === id)));
  for (const b of blocks) if (!isSettled(run.nodeStates?.[b.id])) again.add(b.id);
  const queue = [...again];
  while (queue.length) { const id = queue.pop(); for (const e of edges) if (e.from === id && !again.has(e.to)) { again.add(e.to); queue.push(e.to); } }
  return { keep: blocks.filter(b => !again.has(b.id)).map(b => b.id), rerun: blocks.filter(b => again.has(b.id)).map(b => b.id) };
}

/** Blocks that write to the library or the review: approval-gated in a protected workflow. */
export const WRITE_BLOCKS = new Set(['collect', 'criteria', 'screening', 'consensus', 'extraction']);
