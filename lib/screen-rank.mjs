// Prioritised screening (plan E6, E8), in the manner of ASReview, with no
// dependency: TF-IDF features over title and abstract, then a classifier
// trained on the reviewer's own include and exclude decisions, ranking the
// records still to screen. The ranking only orders the queue. It never
// decides, and its score is an uncalibrated relevance score, not a
// probability of eligibility (E7).
//
// Two classifiers: multinomial naive Bayes on the TF-IDF weights (ASReview's
// long-standing default, alpha 3.822) and L2-regularised logistic regression
// (C = 1, as scikit-learn's default), both with the classes weighted equally
// whatever their sizes. Pure functions: they run in the screening worker,
// in Node for the tests and in bench/screening-rank.mjs for the evaluation.

import { termPattern } from './screen-highlight.mjs';

// ---- features ----------------------------------------------------------------
const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
  'however thus therefore using used use based study studies patients patient results result methods method conclusion conclusions background objective objectives purpose aim aims introduction').split(/\s+/));

/** Words of a text: folded to ASCII-ish lower case, stop words and single characters dropped. */
export function tokenize(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

const rxCache = new Map();
const rx = t => { let r = rxCache.get(t); if (!r) { r = termPattern(t); rxCache.set(t, r); } return r; };
/**
 * What a record is ranked on: title and abstract. With `extra`, more features
 * for the same model: `include` and `exclude` are the terms the reviewer
 * declared for the project (the screening highlights, lib/screen-highlight.mjs,
 * matched the same way). The number of distinct terms of each kind a record
 * contains, at most 3, becomes a word of its own; the model still learns from
 * the reviewer's decisions how much each counts, so a declared term nudges the
 * ranking and never decides a record. (MeSH descriptors as features were
 * measured too and are not used; see the plan's search and screening amendment.)
 */
export function recordText(p, extra = null) {
  const base = `${p.title || ''} ${p.abstract || ''}`;
  if (!extra) return base;
  let t = base;
  for (const [kind, list] of [['include', extra.include], ['exclude', extra.exclude]]) {
    const n = (list || []).filter(term => rx(term).test(base)).length;
    if (n) t += ` ${`declared${kind}term `.repeat(Math.min(3, n))}`;
  }
  return t;
}
/** The extra features a project's ranking settings ask for: its declared terms when switched on, else null. */
export function extraOf({ on = false, include = [], exclude = [] } = {}) {
  const clean = v => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean).slice(0, 100);
  const inc = clean(include), exc = clean(exclude);
  return on && (inc.length || exc.length) ? { include: inc, exclude: exc } : null;
}

/**
 * TF-IDF rows for documents: sublinear term frequency (1 + ln tf), smoothed
 * idf (ln((1 + n) / (1 + df)) + 1), each row scaled to unit length. Terms in
 * fewer than `minDf` documents are dropped; at most `maxFeatures` are kept, the
 * most frequent. Rows are sparse: `{ idx: Int32Array, val: Float64Array }`.
 */
export function tfidf(docs, { minDf = 2, maxFeatures = 30000 } = {}) {
  const toks = docs.map(tokenize);
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  let terms = [...df].filter(([, n]) => n >= minDf);
  if (terms.length > maxFeatures) terms = terms.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxFeatures);
  terms.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const vocab = new Map(terms.map(([w], i) => [w, i]));
  const n = docs.length;
  const idf = new Float64Array(terms.length);
  terms.forEach(([, d], i) => { idf[i] = Math.log((1 + n) / (1 + d)) + 1; });
  const rows = toks.map(t => {
    const tf = new Map();
    for (const w of t) { const j = vocab.get(w); if (j != null) tf.set(j, (tf.get(j) || 0) + 1); }
    const idx = Int32Array.from([...tf.keys()].sort((a, b) => a - b));
    const val = Float64Array.from(idx, j => (1 + Math.log(tf.get(j))) * idf[j]);
    let norm = 0; for (const v of val) norm += v * v; norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < val.length; k++) val[k] /= norm;
    return { idx, val };
  });
  return { vocab, idf, rows, dim: terms.length };
}

const dot = (row, w) => { let s = 0; for (let k = 0; k < row.idx.length; k++) s += w[row.idx[k]] * row.val[k]; return s; };

// ---- classifiers -------------------------------------------------------------
/**
 * Multinomial naive Bayes on TF-IDF weights, each class's weights scaled so
 * the two classes count equally. Returns weights and a bias whose dot with a
 * row is the log-odds of the included class.
 */
export function trainNB(rows, labels, dim, { alpha = 3.822 } = {}) {
  const n1 = labels.filter(Boolean).length, n0 = labels.length - n1;
  const c1 = new Float64Array(dim), c0 = new Float64Array(dim);
  const w1 = n1 ? 1 / n1 : 0, w0 = n0 ? 1 / n0 : 0;
  rows.forEach((r, i) => { const c = labels[i] ? c1 : c0, wt = labels[i] ? w1 : w0; for (let k = 0; k < r.idx.length; k++) c[r.idx[k]] += r.val[k] * wt; });
  let t1 = 0, t0 = 0; for (let j = 0; j < dim; j++) { t1 += c1[j]; t0 += c0[j]; }
  const w = new Float64Array(dim), d1 = Math.log(t1 + alpha * dim), d0 = Math.log(t0 + alpha * dim);
  for (let j = 0; j < dim; j++) w[j] = (Math.log(c1[j] + alpha) - d1) - (Math.log(c0[j] + alpha) - d0);
  return { w, b: 0, model: 'nb' };
}

/**
 * L2-regularised logistic regression, classes weighted to count equally,
 * fitted by accelerated gradient descent (FISTA-style momentum) on the mean
 * weighted loss. The penalty matches scikit-learn's C = 1 on the summed
 * loss. `warm` continues from an earlier fit.
 */
export function trainLR(rows, labels, dim, { C = 1, iters = 150, warm = null } = {}) {
  const n = rows.length, n1 = labels.filter(Boolean).length, n0 = n - n1;
  const cw = [n0 ? n / (2 * n0) : 0, n1 ? n / (2 * n1) : 0];
  const W = labels.reduce((a, y) => a + cw[y ? 1 : 0], 0) || 1;
  const lambda = 1 / (C * W);
  let w = warm?.w?.length === dim ? Float64Array.from(warm.w) : new Float64Array(dim), b = warm?.b || 0;
  let yw = Float64Array.from(w), yb = b, t = 1;
  const step = 1 / (0.25 + lambda);   // rows are unit length, so the loss gradient is at most 1/4-Lipschitz
  const g = new Float64Array(dim);
  for (let it = 0; it < iters; it++) {
    g.fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      const r = rows[i], z = dot(r, yw) + yb, p = 1 / (1 + Math.exp(-z)), e = cw[labels[i] ? 1 : 0] * (p - (labels[i] ? 1 : 0)) / W;
      for (let k = 0; k < r.idx.length; k++) g[r.idx[k]] += e * r.val[k];
      gb += e;
    }
    const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2, mom = (t - 1) / tn;
    let moved = 0;
    for (let j = 0; j < dim; j++) {
      const nw = yw[j] - step * (g[j] + lambda * yw[j]);
      yw[j] = nw + mom * (nw - w[j]); moved += Math.abs(nw - w[j]); w[j] = nw;
    }
    const nb = yb - step * gb; yb = nb + mom * (nb - b); b = nb; t = tn;
    if (moved < 1e-7 * dim) break;
  }
  return { w, b, model: 'lr' };
}

export const train = (rows, labels, dim, model = 'nb', opts = {}) => model === 'lr' ? trainLR(rows, labels, dim, opts) : trainNB(rows, labels, dim, opts);
/** A row's score: the model's log-odds squashed to 0–1. Uncalibrated; it orders, it does not estimate. */
export const scoreRow = (row, fit) => 1 / (1 + Math.exp(-(dot(row, fit.w) + fit.b)));

// ---- ranking a project -------------------------------------------------------
/**
 * The records still to screen, most likely relevant first: `{ order, scores,
 * trained }`. `labels` maps record id to true (include) or false (exclude);
 * other records are ranked. Needs at least one of each; without them the
 * order is null.
 */
export function rankRecords(papers, labels, { model = 'nb', features = null, warm = null } = {}) {
  const feats = features || tfidf(papers.map(recordText));
  const tr = [], ty = [];
  papers.forEach((p, i) => { if (labels[p.id] === true || labels[p.id] === false) { tr.push(feats.rows[i]); ty.push(labels[p.id]); } });
  const inc = ty.filter(Boolean).length;
  if (!inc || inc === ty.length) return { order: null, scores: {}, trained: { n: ty.length, includes: inc, model } };
  const fit = train(tr, ty, feats.dim, model, { warm });
  const scores = {};
  const open = [];
  papers.forEach((p, i) => { if (!(p.id in labels)) { scores[p.id] = scoreRow(feats.rows[i], fit); open.push(p.id); } });
  open.sort((a, b) => scores[b] - scores[a]);
  return { order: open, scores, fit, trained: { n: ty.length, includes: inc, model, dim: feats.dim } };
}

// ---- evaluation (plan E8) ------------------------------------------------------
/**
 * One simulated review, as ASReview simulates: a random prior of one include
 * and one exclude, then the model's top record is screened next, retraining
 * after every `every` decisions, until every record is screened. Returns the
 * labels in the order they were screened, priors left out.
 */
export function simulate(feats, y, { model = 'nb', seed = 1, every = 10, lrIters = 60 } = {}) {
  const rand = mulberry(seed), n = y.length;
  const inc = [], exc = []; y.forEach((v, i) => (v ? inc : exc).push(i));
  const prior = [inc[Math.floor(rand() * inc.length)], exc[Math.floor(rand() * exc.length)]];
  const known = new Uint8Array(n); for (const i of prior) known[i] = 1;
  const labelled = [...prior], order = [];
  let warm = null;
  while (labelled.length < n) {
    const rows = labelled.map(i => feats.rows[i]), ys = labelled.map(i => !!y[i]);
    const fit = train(rows, ys, feats.dim, model, { warm, iters: lrIters });
    if (model === 'lr') warm = fit;
    const scored = [];
    for (let i = 0; i < n; i++) if (!known[i]) scored.push([scoreRow(feats.rows[i], fit), i]);
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, i] of scored.slice(0, every)) { known[i] = 1; labelled.push(i); order.push(y[i] ? 1 : 0); }
  }
  return order;
}

/** Records screened (in order) until `share` of the relevant ones were found. */
export function workToRecall(order, share = 0.95) {
  const total = order.reduce((a, b) => a + b, 0), need = Math.ceil(share * total);
  let found = 0;
  for (let i = 0; i < order.length; i++) { found += order[i]; if (found >= need) return i + 1; }
  return order.length;
}
/** Work saved over sampling (Cohen et al. 2006) at a recall: (N − screened) / N − (1 − recall). */
export const wss = (order, share = 0.95) => (order.length - workToRecall(order, share)) / order.length - (1 - share);
// Further measures of a simulated or real screening order (Ferdinands et al.
// 2020 name them; the definitions used here are these and are stated wherever
// a number is shown). `order` holds 1 for a relevant record and 0 for the
// rest, in the order they were screened.
/** Average time to discovery: the mean position of the relevant records, as a share of all records. Random order gives about 0.5; lower is better. */
export function atd(order) {
  const n = order.length, r = order.reduce((a, b) => a + b, 0);
  if (!n || !r) return null;
  let sum = 0; order.forEach((v, i) => { if (v) sum += (i + 1) / n; });
  return sum / r;
}
/** Extra relevant found at a share screened: the share of relevant records found by then, less the share screened (what random order finds). */
export const erf = (order, share = 0.1) => order.reduce((a, b) => a + b, 0) ? recallAt(order, share) - share : null;
/**
 * Loss: how far the recall curve falls short of the best possible one,
 * relative to how far random order falls short. The area under the recall
 * curve is summed over every record screened; loss = (ideal − actual) /
 * (ideal − random). 0 is the best order, 1 is no better than random, and
 * above 1 is worse than random.
 */
export function loss(order) {
  const n = order.length, r = order.reduce((a, b) => a + b, 0);
  if (!n || !r || r === n) return null;
  let found = 0, actual = 0, ideal = 0, random = 0;
  for (let k = 1; k <= n; k++) { found += order[k - 1]; actual += found / r; ideal += Math.min(k, r) / r; random += k / n; }
  return ideal === random ? null : (ideal - actual) / (ideal - random);
}

/** Share of relevant records found after screening a share of all records. */
export function recallAt(order, share) {
  const total = order.reduce((a, b) => a + b, 0), k = Math.round(share * order.length);
  return total ? order.slice(0, k).reduce((a, b) => a + b, 0) / total : 0;
}

/** Area under the ROC curve from scores and 0/1 labels (ties count half). */
export function auc(scores, y) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, pos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i; while (j < idx.length && scores[idx[j]] === scores[idx[i]]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (y[idx[k]]) { sumPos += avg; pos++; }
    rank = j; i = j;
  }
  void rank;
  const neg = y.length - pos;
  return pos && neg ? (sumPos - pos * (pos + 1) / 2) / (pos * neg) : null;
}

/**
 * Held-out evaluation: stratified k-fold. Each fold is ranked by a model
 * trained on the other folds only (the evaluation labels are never trained
 * on), and scored by AUC and by the work to reach 95% recall within it.
 */
export function crossValidate(feats, y, { model = 'nb', folds = 5, seed = 1 } = {}) {
  const rand = mulberry(seed), fold = new Int32Array(y.length);
  for (const cls of [1, 0]) {
    const ids = y.map((v, i) => [v, i]).filter(([v]) => (v ? 1 : 0) === cls).map(([, i]) => i);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    ids.forEach((i, k) => { fold[i] = k % folds; });
  }
  const out = [];
  for (let f = 0; f < folds; f++) {
    const tr = [], ty = [], te = [];
    y.forEach((v, i) => { if (fold[i] === f) te.push(i); else { tr.push(feats.rows[i]); ty.push(!!v); } });
    const fit = train(tr, ty, feats.dim, model);
    const sc = te.map(i => scoreRow(feats.rows[i], fit)), yy = te.map(i => y[i] ? 1 : 0);
    const order = te.map((i, k) => [sc[k], yy[k]]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    out.push({ n: te.length, includes: yy.reduce((a, b) => a + b, 0), auc: auc(sc, yy), work95: workToRecall(order, 0.95), wss95: wss(order, 0.95) });
  }
  return out;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- stopping (plan E8) --------------------------------------------------------
/**
 * A prompt, not a rule: whether the run of records since the last include has
 * reached a threshold the reviewer set. Answers null when no threshold is set.
 */
export function stopPrompt(order, threshold) {
  const t = Math.floor(Number(threshold));
  if (!(t > 0)) return null;
  const run = sinceLastInclude(order);
  return { run, threshold: t, reached: run >= t && order.length > 0 };
}

/** Records decided since the last include, in the order they were decided (1 for include, 0 otherwise). */
export function sinceLastInclude(order) {
  let n = 0; for (let i = order.length - 1; i >= 0 && !order[i]; i--) n++;
  return n;
}

/**
 * The knee method (Cormack and Grossman, SIGIR 2016), on records screened in
 * the order they were decided. At each point the knee is where the gain curve
 * is farthest above the line to its end; the slope ratio compares the rate of
 * relevant records before the knee with the rate after it (+1). The rule is
 * met once at least 150 records are screened and the ratio is at least
 * 156 − min(relevant found, 150). It assumes the records were screened
 * most-likely-relevant first; on another order it says little.
 */
export function kneeRule(order) {
  const s = order.length, r = order.reduce((a, b) => a + b, 0);
  if (s < 2 || !r) return { screened: s, relevant: r, knee: null, ratio: null, needed: 156 - Math.min(r, 150), met: false };
  let best = 0, knee = 0, found = 0;
  for (let i = 1; i <= s; i++) {
    found += order[i - 1];
    // distance from (i, found) to the line (0,0)–(s, r), up to a constant
    const d = found * s - i * r;
    if (d > best) { best = d; knee = i; }
  }
  if (!knee) return { screened: s, relevant: r, knee: null, ratio: null, needed: 156 - Math.min(r, 150), met: false };
  const before = order.slice(0, knee).reduce((a, b) => a + b, 0);
  const ratio = (before / knee) / ((r - before + 1) / Math.max(1, s - knee));
  const needed = 156 - Math.min(r, 150);
  return { screened: s, relevant: r, knee, ratio, needed, met: s >= 150 && ratio >= needed };
}

/** Wilson score interval for a proportion x of n, at 95%. */
export function wilson(x, n, z = 1.959963984540054) {
  if (!n) return [0, 1];
  const p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

/**
 * Relevant records left, from a random check sample (a baseline-inclusion-
 * rate estimate): `k` records drawn at random from the `pool` records still
 * unscreened when it was drawn, `x` of them included. The estimate for the
 * rest of that pool is x/k of it, with a Wilson 95% interval, less the
 * relevant records found there since. It holds only if the sample was random
 * and the reviewer screened it as any other record.
 */
export function remainingFromSample({ k, x, pool, foundSince = 0 }) {
  const rest = Math.max(0, pool - k);
  const [lo, hi] = wilson(x, k);
  const est = rest * (k ? x / k : 0);
  return { estimate: Math.max(0, est - foundSince), low: Math.max(0, rest * lo - foundSince), high: Math.max(0, rest * hi - foundSince), k, x, pool };
}
