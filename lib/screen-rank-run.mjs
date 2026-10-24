// The ranking behind "Most likely relevant first" (plan E6): trained in a
// worker on the reviewer's include and exclude decisions, retrained after
// every RETRAIN_EVERY new ones, never on the page's thread when a worker can
// be had. A result is only kept here; the queue takes its order the next time
// it is drawn, so a finished training never repaints the record being read.
// Each run is recorded (`rankingRuns`, the last 20): when, which model, how
// many decisions it learned from. The fitted weights are not stored; they are
// rebuilt from the decisions in well under a second at review sizes.
import { update } from '../store.mjs';
import { recordText, rankRecords } from './screen-rank.mjs';

export const RETRAIN_EVERY = 10;
export const MODELS = { nb: 'Naive Bayes', lr: 'Logistic regression' };
const state = new Map();        // stage -> { order, scores, trained, n, pending, at }
let worker = null, workerFailed = false, seq = 0;
const waiting = new Map();
const listeners = new Set();
export const onRanked = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function getWorker() {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./screen-rank-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data?.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
    worker.onerror = () => { workerFailed = true; worker = null; for (const w of waiting.values()) w({ error: 'worker failed' }); waiting.clear(); };
  } catch { workerFailed = true; worker = null; }
  return worker;
}

function runRank(papers, labels, model) {
  const w = getWorker();
  if (w) return new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); w.postMessage({ id, papers, labels, model }); });
  // No worker: when the page is idle, in one piece.
  return new Promise(resolve => {
    const go = () => { const t0 = performance.now(); try { const r = rankRecords(papers.map(p => ({ id: p.id, title: p.text, abstract: '' })), labels, { model }); resolve({ ...r, fit: undefined, ms: Math.round(performance.now() - t0) }); } catch (err) { resolve({ error: String(err.message || err) }); } };
    (globalThis.requestIdleCallback || (f => setTimeout(f, 50)))(go);
  });
}

/**
 * Replays the stage's decisions (plan E8) in the worker: a report of work to
 * 95% recall, WSS@95 and held-out AUC. Needs the worker; null without one.
 */
export function evaluateRanking(papers, labels, model = 'nb', extra = null) {
  const w = getWorker(); if (!w) return Promise.resolve(null);
  const input = papers.filter(p => p.id in labels).map(p => ({ id: p.id, text: recordText(p, extra) }));
  return new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); w.postMessage({ id, type: 'evaluate', papers: input, labels, model }); });
}

/** The ranking held for a stage: `{ order, scores, trained, at }`, or null before the first result. */
export const ranking = stage => state.get(stage)?.order ? state.get(stage) : null;
export const rankingBusy = stage => !!state.get(stage)?.pending;

/**
 * Asks for a (re)training when there is none yet, when the decisions have
 * moved on by RETRAIN_EVERY, or when the model changed. `papers` is the
 * stage's pool; `labels` maps decided record ids to true (include) / false.
 */
export function ensureRanking(stage, papers, labels, { model = 'nb', force = false, extra = null } = {}) {
  const st = state.get(stage) || {};
  const n = Object.keys(labels).length;
  const inc = Object.values(labels).filter(Boolean).length;
  if (!inc || inc === n) return false;                     // nothing to learn from yet
  if (st.pending) { st.again = true; return false; }
  const extraKey = JSON.stringify(extra);
  const stale = force || !st.order || st.model !== model || st.extraKey !== extraKey || st.pool !== papers.length || Math.abs(n - (st.n || 0)) >= RETRAIN_EVERY;
  if (!stale) return false;
  st.pending = true; st.again = false; state.set(stage, st);
  const input = papers.map(p => ({ id: p.id, text: recordText(p, extra) }));
  runRank(input, labels, model).then(r => {
    st.pending = false;
    if (r.error || !r.order) { st.error = r.error || ''; return; }
    Object.assign(st, { order: r.order, rank: new Map(r.order.map((id, i) => [id, i])), scores: r.scores, trained: r.trained, n, model, extraKey, pool: papers.length, at: new Date().toISOString(), ms: r.ms, error: '' });
    update(s => { s.rankingRuns = [...(Array.isArray(s.rankingRuns) ? s.rankingRuns : []), { at: st.at, stage, model, decisions: n, includes: inc, records: papers.length, terms: r.trained?.dim || 0, ms: r.ms }].slice(-20); return s; });
    for (const l of [...listeners]) l(stage);
  });
  return true;
}

/** `list` in the ranking's order, records it has not scored (decided ones) after, in their own order. */
export function rankOrder(stage, list) {
  const r = ranking(stage); if (!r) return list;
  const at = id => r.rank.has(id) ? r.rank.get(id) : Infinity;
  return list.map((p, i) => [at(p.id), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
}
export const scoreOf = (stage, id) => ranking(stage)?.scores?.[id] ?? null;
