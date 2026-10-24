// A workflow's last run drawn as a CI pipeline: blocks grouped into stages by
// dependency depth, each a small status circle, stages joined by an arrow, and
// "+N" for what does not fit the row. Pure: stages, fitting and markup here;
// the view measures the row and wires the pointer card.
import { graphOrder } from './flow-graph.mjs';
import { BLOCKS } from './flow-blocks.mjs';
import { esc } from './html.mjs';
import { VISUAL_CELL } from './ui-components.mjs';
import { MARK_LABEL, glyph } from './status-marks.mjs';
export { MARK_LABEL, glyph };

/** Run states (flow-runner) → the six marks a pipeline shows. */
const MARK = { done: 'passed', skipped: 'skipped', cancelled: 'skipped', error: 'warning', waiting: 'warning',
  failed: 'failed', running: 'running', retrying: 'running', queued: 'pending' };
export const STATE_LABEL = { queued: 'Pending', running: 'Running', retrying: 'Retrying', waiting: 'Waiting for review', done: 'Passed',
  failed: 'Failed', cancelled: 'Stopped', skipped: 'Skipped', error: 'Error handled' };

/** The mark for one block of a run; a block a finished run never reached is "not run". */
export function blockMark(run, id) {
  if (!run) return 'pending';
  const state = run.nodeStates?.[id];
  if (!state) return run.imported ? 'pending' : ['running', 'waiting'].includes(run.status) ? 'pending' : 'skipped';
  return MARK[state] || 'pending';
}
/** The words for a block's mark; an imported run says what its source did not record. */
export const markLabel = (run, id) => run?.imported && !run.nodeStates?.[id] ? 'Not recorded' : MARK_LABEL[blockMark(run, id)];

/** Blocks grouped by longest path from a source: stage 0 holds the sources. */
export function pipelineStages(flow) {
  const blocks = flow?.blocks || [];
  if (!blocks.length) return [];
  let order;
  try { order = graphOrder(flow, { allowDisconnected: true }).blocks; }
  catch { return [blocks.slice()]; }
  const depth = new Map(), ids = new Set(blocks.map(b => b.id));
  for (const b of order) depth.set(b.id, 0);
  for (const b of order) for (const e of flow.edges || [])
    if (e.from === b.id && ids.has(e.to)) depth.set(e.to, Math.max(depth.get(e.to), depth.get(b.id) + 1));
  const stages = [];
  for (const b of order) (stages[depth.get(b.id)] ||= []).push(b);
  return stages.filter(Boolean);
}

// Geometry in CSS pixels; index.html's `.pipe` rules use the same numbers.
export const PIPE = Object.freeze({ dot: 20, link: 6, arrow: 24, more: 40 });

/** As many blocks as `width` allows, in stage order, reserving room for "+N". */
export function fitPipeline(stages, width, g = PIPE) {
  const total = stages.reduce((n, s) => n + s.length, 0), out = [];
  let used = 0, shown = 0;
  outer: for (let i = 0; i < stages.length; i++) {
    for (let j = 0; j < stages[i].length; j++) {
      const cost = g.dot + (j ? g.link : shown ? g.arrow : 0);
      const rest = total - shown - 1;
      if (used + cost + (rest ? g.more : 0) > width) break outer;
      used += cost; shown++; (out[i] ||= []).push(stages[i][j]);
    }
  }
  return { stages: out.filter(Boolean), hidden: total - shown };
}

const blockName = b => b.label || BLOCKS.find(d => d.id === b.type)?.label || b.type;

/** The pipeline row's markup for `width` pixels. Dots are buttons carrying their block id. */
export function pipelineHtml(flow, run, width) {
  const { stages, hidden } = fitPipeline(pipelineStages(flow), width);
  const dot = b => {
    const mark = blockMark(run, b.id);
    return `<button type="button" class="pipe-dot" data-mark="${mark}" data-pipe-node="${esc(b.id)}" aria-label="${esc(blockName(b))}, ${markLabel(run, b.id)}">${glyph(mark)}</button>`;
  };
  return stages.map(s => `<span class="pipe-stage" ${VISUAL_CELL}>${s.map(dot).join('<i class="pipe-link"></i>')}</span>`).join('<span class="pipe-arrow" aria-hidden="true">→</span>')
    + (hidden ? `<span class="pipe-more" ${VISUAL_CELL}>+${hidden}</span>` : '');
}

/** "48 s", "2 min 14 s", "1 h 3 min". */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(s / 3600)} h${Math.round((s % 3600) / 60) ? ` ${Math.round((s % 3600) / 60)} min` : ''}`;
}
export function ago(iso, now = Date.now()) {
  const m = (now - new Date(iso).getTime()) / 60000;
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** The card a pointed-at circle shows: block, state, time, first line of its error. */
export function pipelineCard(run, id) {
  const b = run?.flow?.blocks?.find(n => n.id === id); if (!b) return '';
  const d = run.nodeDetails?.[id], state = run.nodeStates?.[id];
  const label = state ? STATE_LABEL[state] || state : markLabel(run, id);
  const time = d?.durationMs != null ? duration(d.durationMs) : '';
  // an imported run states only the counts its source recorded
  const counts = state === 'done' && d ? (run.imported ? [d.inputCount != null ? `${d.inputCount} in` : '', d.outputCount != null ? `${d.outputCount} out` : ''].filter(Boolean).join(', ') : `${d.inputCount || 0} in, ${d.outputCount ?? 0} out`) : '';
  const error = String(d?.error || '').split('\n')[0];
  return `<strong>${esc(blockName(b))}</strong><span class="meta">${esc([label, time].filter(Boolean).join(', '))}</span>${counts ? `<span class="meta">${esc(counts)}</span>` : ''}${d?.reused ? '<span class="meta">Earlier output reused</span>' : ''}${error ? `<span class="pipe-card-error">${esc(error)}</span>` : ''}`;
}

/**
 * Wire the pointer card for every `.pipe[data-run]` under `root`. One card, on
 * the page, beside the circle; `runOf(id)` finds the run. Returns a remover.
 */
export function attachPipelineCards(root, runOf) {
  const card = document.createElement('div');
  card.className = 'chart-card pipe-card'; card.hidden = true; document.body.append(card);
  let at = null;   // the circle the card is beside: moving over its parts draws nothing again
  const show = e => {
    const dot = e.target.closest?.('[data-pipe-node]'), host = dot?.closest('[data-run]');
    if (!dot || !host) { card.hidden = true; at = null; return; }
    if (dot === at && !card.hidden) return;
    at = dot;
    const html = pipelineCard(runOf(host.dataset.run), dot.dataset.pipeNode);
    if (!html) { card.hidden = true; return; }
    card.innerHTML = html; card.hidden = false;
    const r = dot.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
    const x = r.right + 8 + cw <= innerWidth - 4 ? r.right + 8 : Math.max(4, r.left - cw - 8);
    const y = Math.max(4, Math.min(innerHeight - ch - 4, r.top - 4));
    card.style.setProperty('left', `${Math.round(x)}px`); card.style.setProperty('top', `${Math.round(y)}px`);
  };
  const hide = () => { card.hidden = true; at = null; };
  root.addEventListener('pointerover', show); root.addEventListener('focusin', show);
  root.addEventListener('pointerleave', hide); root.addEventListener('focusout', hide);
  return () => { card.remove(); root.removeEventListener('pointerover', show); root.removeEventListener('focusin', show); root.removeEventListener('pointerleave', hide); root.removeEventListener('focusout', hide); };
}
