// The screening ranker's worker (plan E6): features and training run here, off
// the page's thread, so ranking never holds up a keystroke or a decision.
// Messages: { id, papers: [{ id, text }], labels: { id: bool }, model } →
// { id, order, scores, trained, ms } or { id, error }.
import { tfidf, rankRecords, simulate, workToRecall, wss, recallAt, crossValidate, atd, erf, loss } from './screen-rank.mjs';

let cache = { key: '', feats: null };
const keyOf = papers => { let h = 2166136261; for (const p of papers) for (const s of [p.id, p.text]) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return `${papers.length}:${h >>> 0}`; };

// An evaluation replays the decided records (plan E8): simulated reviews from
// several random priors, and a stratified 5-fold held-out ranking.
function evaluate(papers, labels, model, seeds = 10, every = 10) {
  const decided = papers.filter(p => p.id in labels);
  const y = decided.map(p => labels[p.id] ? 1 : 0);
  const feats = tfidf(decided.map(p => p.text));
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) runs.push(simulate(feats, y, { model, seed, every }));
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const cv = crossValidate(feats, y, { model, folds: 5, seed: 1 });
  return { records: y.length, includes: y.reduce((a, b) => a + b, 0), seeds, every, model,
    work95: runs.map(o => workToRecall(o, 0.95)), wss95: runs.map(o => wss(o, 0.95)), recall25: mean(runs.map(o => recallAt(o, 0.25))),
    atd: runs.map(atd), erf10: runs.map(o => erf(o, 0.1)), loss: runs.map(loss),
    screened: runs[0]?.length || 0, auc: cv.map(c => c.auc), cvWss95: cv.map(c => c.wss95) };
}

self.onmessage = e => {
  const { id, papers, labels, model, type } = e.data || {};
  const t0 = performance.now();
  if (type === 'evaluate') {
    try { self.postMessage({ id, report: evaluate(papers, labels, model), ms: Math.round(performance.now() - t0) }); }
    catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
    return;
  }
  try {
    const key = keyOf(papers);
    if (cache.key !== key) cache = { key, feats: tfidf(papers.map(p => p.text)) };
    const r = rankRecords(papers, labels, { model, features: cache.feats });
    self.postMessage({ id, order: r.order, scores: r.scores, trained: r.trained, ms: Math.round(performance.now() - t0) });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
