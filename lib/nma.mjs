// Network meta-analysis (plan §1.1, I8): several treatments compared at once
// from arm-level data, direct and indirect evidence together.
//
// Arm data do not fit one value per extraction field, so they live in their
// own structure, s.nma = { measure, treatments, arms: { [paperId]: [arm] },
// reference, smallBetter, result }. Each study's contrasts are taken against
// its baseline arm with the within-study covariance of a multi-arm study (the
// baseline arm's variance on the off-diagonal), stacked, and fitted in
// metafor (lib/r.mjs) as a contrast-based model: rma.mv on the treatment
// indicators, common effect (no random term) and random effects with one
// random effect per contrast, compound symmetric within a study with ρ fixed
// at 1/2 (struct "CS", rho=1/2) — the homogeneous-variance consistency model,
// every comparison sharing τ². Q is decomposed as in Krahn et al. (2013):
// the common-effect Q of the consistency model, Q of the design-by-treatment
// interaction model (every design its own parameters) as within-design
// heterogeneity, and their difference as between-design inconsistency.
// Relative effects, the league table and P-scores (Rücker & Schwarzer 2015)
// follow here from the estimates and their covariance; bench/nma checks both.
import { studies } from './screen.mjs';
import { lgamma } from './dta.mjs';
import { figureTokens } from './figure-style.mjs';
import { niceTicks } from './output-charts.mjs';
import { svgRoot, text, lines, labelColumn, rowHeight, arrowMarker, axisLine, hairLine, measure, wrapText, r1, esc, LINE, GAP, footBlock, emptyFigure, bottomAxis, fullTitle, figId, sourceOf } from './figure-kit.mjs';

export const NMA_MEASURES = [
  { id: 'OR', label: 'Odds ratio', family: 'binary', ratio: true },
  { id: 'RR', label: 'Risk ratio', family: 'binary', ratio: true },
  { id: 'MD', label: 'Mean difference', family: 'continuous', ratio: false },
  { id: 'SMD', label: "Standardised mean difference (Hedges' g)", family: 'continuous', ratio: false },
];
export const nmaMeasure = id => NMA_MEASURES.find(m => m.id === id) || NMA_MEASURES[0];
export const ARM_FIELDS = { binary: ['events', 'n'], continuous: ['mean', 'sd', 'n'] };
export const Z95 = 1.959963984540054;

// ---- normal distribution --------------------------------------------------------

/** erfc to double precision: a positive series below 2, a continued fraction above. */
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) {
    // erf(x) = 2/√π · e^(−x²) · Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1)), every term positive
    let term = x, sum = x;
    for (let n = 1; n < 200 && term > 1e-17 * sum; n++) { term *= 2 * x * x / (2 * n + 1); sum += term; }
    return 1 - 2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum;
  }
  if (x > 27) return 0;
  // erfc(x) = e^(−x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …)))), modified Lentz
  const TINY = 1e-300;
  let f = x, c = x, d = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    d = x + a * d; if (Math.abs(d) < TINY) d = TINY;
    c = x + a / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; const del = c * d; f *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}
/** Standard normal CDF. */
export const pnorm = z => 0.5 * erfc(-z / Math.SQRT2);

// ---- inputs ---------------------------------------------------------------------

const isNum = v => v !== '' && v != null && Number.isFinite(Number(v));
const isCount = v => isNum(v) && Number.isInteger(Number(v)) && Number(v) >= 0;

/** An arm is usable when its treatment is named and its numbers fit the outcome. */
export function validArm(a, family) {
  if (!a?.treatment) return false;
  if (family === 'binary') return isCount(a.events) && isCount(a.n) && Number(a.n) > 0 && Number(a.events) <= Number(a.n);
  return isNum(a.mean) && isNum(a.sd) && Number(a.sd) > 0 && isCount(a.n) && Number(a.n) >= 2;
}
const cleanArm = (a, family) => family === 'binary'
  ? { treatment: a.treatment, events: Number(a.events), n: Number(a.n) }
  : { treatment: a.treatment, mean: Number(a.mean), sd: Number(a.sd), n: Number(a.n) };

/** A binary study carries no information when every arm has no events, or (odds) every arm only events. */
function uninformative(arms, measure) {
  if (nmaMeasure(measure).family !== 'binary') return false;
  return arms.every(a => a.events === 0) || (measure === 'OR' && arms.every(a => a.events === a.n));
}

/** Treatments joined by one study or a chain of studies, from the first. */
export function connected(treatments, studyArms) {
  if (treatments.length < 2) return treatments.length === 1;
  const parent = new Map(treatments.map(t => [t, t]));
  const find = t => (parent.get(t) === t ? t : find(parent.get(t)));
  for (const arms of studyArms) for (let i = 1; i < arms.length; i++) parent.set(find(arms[i].treatment), find(arms[0].treatment));
  const root = find(treatments[0]);
  return treatments.every(t => find(t) === root);
}

/**
 * The included studies' arms: ready (two or more usable arms, distinct
 * treatments), incomplete, invalid (a treatment twice) or excluded (no
 * information). The treatment order puts the reference first; the snapshot is
 * what a saved result is compared against.
 */
export function nmaInputs(s) {
  const nma = s.nma || {}, measure = nmaMeasure(nma.measure).id, family = nmaMeasure(measure).family;
  const listed = (nma.treatments || []).filter(Boolean);
  const ready = [], incomplete = [], invalid = [], excluded = [];
  for (const p of studies(s)) {
    const raw = nma.arms?.[p.id] || [];
    if (!raw.length) continue;
    const r = { id: p.id, label: p.label || p.title || p.id, paper: p };
    if (raw.some(a => !validArm(a, family)) || raw.length < 2) { incomplete.push(r); continue; }
    const arms = raw.map(a => cleanArm(a, family));
    if (new Set(arms.map(a => a.treatment)).size !== arms.length || arms.some(a => !listed.includes(a.treatment))) { invalid.push(r); continue; }
    if (uninformative(arms, measure)) { excluded.push(r); continue; }
    ready.push({ ...r, arms });
  }
  const used = listed.filter(t => ready.some(r => r.arms.some(a => a.treatment === t)));
  const reference = used.includes(nma.reference) ? nma.reference : used[0] || '';
  const order = reference ? [reference, ...used.filter(t => t !== reference)] : [];
  const snapshot = JSON.stringify({ measure, order,
    rows: ready.map(r => [r.id, r.label, r.arms.map(a => Object.values(a))]).sort((a, b) => a[0].localeCompare(b[0])) });
  return { measure, family, ready, incomplete, invalid, excluded, order, reference,
    connected: connected(order, ready.map(r => r.arms)), snapshot };
}

/** 'current', 'stale' when the inputs changed after the saved run, or null when nothing was run. */
export function nmaStatus(s, result = s.nma?.result) {
  if (!result) return null;
  return result.snapshot === nmaInputs(s).snapshot ? 'current' : 'stale';
}

// ---- contrasts ------------------------------------------------------------------

/** metafor's exact small-sample correction for Hedges' g (escalc's .cmicalc). */
export const hedgesJ = m => Math.exp(lgamma(m / 2) - Math.log(Math.sqrt(m / 2)) - lgamma((m - 1) / 2));

/**
 * One study's contrasts against its baseline arm, with their covariance. The
 * baseline is the arm whose treatment comes first in `order`, so every study
 * of a design is parametrised alike; for OR, RR and MD the model does not
 * depend on that choice.
 *
 * OR, RR, MD: arm-level θ with variance v; y_k = θ_k − θ_b, Var y_k = v_k + v_b,
 * Cov(y_j, y_k) = v_b. 0.5 is added to every cell of every arm of a binary
 * study that has a zero cell (escalc add=1/2, to="only0", study-wide).
 * SMD: Hedges' g per contrast with the pair's pooled SD and escalc's variance
 * (vtype "LS"); Cov(g_j, g_k) = 1/n_b + g_j g_k / (2N), N the study's total
 * (Gleser & Olkin 2009) — exact for a common SD, an approximation otherwise.
 */
export function studyContrasts(arms, measure, order) {
  const sorted = [...arms].sort((a, b) => order.indexOf(a.treatment) - order.indexOf(b.treatment));
  const base = sorted[0], rest = sorted.slice(1);
  let y, V;
  if (measure === 'SMD') {
    const N = sorted.reduce((t, a) => t + a.n, 0);
    y = rest.map(a => {
      const m = a.n + base.n - 2, sp = Math.sqrt(((a.n - 1) * a.sd ** 2 + (base.n - 1) * base.sd ** 2) / m);
      return hedgesJ(m) * (a.mean - base.mean) / sp;
    });
    V = rest.map((a, i) => rest.map((c, j) => (i === j
      ? 1 / a.n + 1 / base.n + y[i] ** 2 / (2 * (a.n + base.n))
      : 1 / base.n + y[i] * y[j] / (2 * N))));
  } else {
    let th, v;
    if (measure === 'MD') { th = a => a.mean; v = a => a.sd ** 2 / a.n; }
    else {
      const add = sorted.some(a => a.events === 0 || a.events === a.n) ? 0.5 : 0;
      const e = a => a.events + add, n = a => a.n + 2 * add;
      if (measure === 'RR') { th = a => Math.log(e(a) / n(a)); v = a => 1 / e(a) - 1 / n(a); }
      else { th = a => Math.log(e(a) / (n(a) - e(a))); v = a => 1 / e(a) + 1 / (n(a) - e(a)); }
    }
    y = rest.map(a => th(a) - th(base));
    V = rest.map((a, i) => rest.map((c, j) => v(base) + (i === j ? v(a) : 0)));
  }
  return { baseline: base.treatment, treatments: rest.map(a => a.treatment), y, V,
    design: sorted.map(a => a.treatment).join(':') };
}

/**
 * The stacked network: contrasts y, block-diagonal V, the consistency design
 * matrix X (one column per non-reference treatment, +1 for the arm, −1 for a
 * non-reference baseline), and the design-by-treatment matrix Xd (one column
 * per design and non-baseline treatment in it).
 */
export function buildNetwork(ready, measure, order) {
  const rows = [], blocks = [];
  ready.forEach((r, si) => {
    const c = studyContrasts(r.arms, measure, order);
    blocks.push(c.V);
    c.treatments.forEach((t, i) => rows.push({ study: si + 1, id: r.id, t, b: c.baseline, y: c.y[i], design: c.design }));
  });
  const n = rows.length, p = order.length - 1;
  const V = Array.from({ length: n }, () => new Array(n).fill(0));
  let at = 0;
  for (const B of blocks) { B.forEach((row, i) => row.forEach((v, j) => { V[at + i][at + j] = v; })); at += B.length; }
  const X = rows.map(r => order.slice(1).map(t => (t === r.t ? 1 : 0) - (t === r.b ? 1 : 0)));
  const cols = [...new Set(rows.map(r => `${r.design}|${r.t}`))];
  const Xd = rows.map(r => cols.map(c => (c === `${r.design}|${r.t}` ? 1 : 0)));
  return { rows, y: rows.map(r => r.y), V, X, Xd, p, designs: [...new Set(rows.map(r => r.design))], k: ready.length };
}

// ---- R ------------------------------------------------------------------------------

const rnum = x => (Number.isFinite(x) ? String(x) : 'NA');
const rvec = xs => `c(${xs.map(rnum).join(',')})`;
const rmat = M => `matrix(${rvec(M.flat())}, nrow=${M.length}, ncol=${M[0]?.length || 0}, byrow=TRUE)`;

/**
 * R code for the three fits, ending in a flat list(...). Estimates and their
 * covariance come back column-major (as.numeric of a matrix).
 */
export function rCode(net) {
  return `
    yi <- ${rvec(net.y)}
    V <- ${rmat(net.V)}
    X <- ${rmat(net.X)}
    Xd <- ${rmat(net.Xd)}
    d <- data.frame(yi=yi, study=${rvec(net.rows.map(r => r.study))}, trt=c(${net.rows.map(r => JSON.stringify(r.t)).join(',')}))
    fe <- rma.mv(yi, V, mods=X, intercept=FALSE, data=d)
    rerr <- ""
    re <- tryCatch(rma.mv(yi, V, mods=X, intercept=FALSE, random=~ trt | study, struct="CS", rho=1/2, data=d, method="REML"),
                   error=function(e) { rerr <<- conditionMessage(e); NULL })
    full <- if (ncol(Xd) < nrow(Xd)) rma.mv(yi, V, mods=Xd, intercept=FALSE, data=d) else NULL
    qt <- as.numeric(fe$QE); qtdf <- nrow(X) - ncol(X)
    qw <- if (is.null(full)) 0 else as.numeric(full$QE); qwdf <- nrow(Xd) - ncol(Xd)
    qb <- qt - qw; qbdf <- ncol(Xd) - ncol(X)
    ok <- !is.null(re)
    list(fe_b=as.numeric(coef(fe)), fe_v=as.numeric(vcov(fe)),
      q=qt, q_df=qtdf, q_p=if (qtdf > 0) pchisq(qt, qtdf, lower.tail=FALSE) else NA_real_,
      qw=qw, qw_df=qwdf, qw_p=if (qwdf > 0) pchisq(qw, qwdf, lower.tail=FALSE) else NA_real_,
      qb=qb, qb_df=qbdf, qb_p=if (qbdf > 0) pchisq(qb, qbdf, lower.tail=FALSE) else NA_real_,
      re_ok=ok, re_err=rerr,
      re_b=if (ok) as.numeric(coef(re)) else NA_real_, re_v=if (ok) as.numeric(vcov(re)) else NA_real_,
      tau2=if (ok) re$tau2 else NA_real_, ll=if (ok) as.numeric(logLik(re)) else NA_real_)`;
}

const num = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const arr = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]).map(Number);
/** A column-major p×p vector as rows. */
const square = (v, p) => Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => v[j * p + i]));
const truthy = v => v === true || v === 1 || v === 'TRUE';

/** The saved result, from R's list and the network it was fitted to. */
export function fromR(out, net, { measure, order, snapshot = '' }) {
  const p = order.length - 1;
  const fit = (b, v) => ({ b: arr(b), V: square(arr(v), p) });
  const ok = truthy(out.re_ok);
  return {
    at: new Date().toISOString(), measure, order, snapshot, k: net.k, contrasts: net.rows.length, designs: net.designs.length,
    common: fit(out.fe_b, out.fe_v),
    random: ok ? { ...fit(out.re_b, out.re_v), tau2: num(out.tau2), ll: num(out.ll) } : null,
    randomError: ok ? '' : String(out.re_err || 'did not converge'),
    q: { total: num(out.q), totalDf: num(out.q_df), totalP: num(out.q_p),
      within: num(out.qw), withinDf: num(out.qw_df), withinP: num(out.qw_p),
      between: num(out.qb), betweenDf: num(out.qb_df), betweenP: num(out.qb_p) },
  };
}

// ---- what follows from the estimates -------------------------------------------------

/** Effects of every treatment against the reference (0 for itself) and their full covariance. */
export function fullEffects(fit) {
  const p = fit.b.length;
  const d = [0, ...fit.b];
  const C = Array.from({ length: p + 1 }, (_, i) => Array.from({ length: p + 1 }, (_, j) => (i && j ? fit.V[i - 1][j - 1] : 0)));
  return { d, C };
}

/** Treatment i versus j on the model scale: estimate and SE. */
export function relative(fit, i, j) {
  const { d, C } = fullEffects(fit);
  return { est: d[i] - d[j], se: Math.sqrt(Math.max(0, C[i][i] + C[j][j] - 2 * C[i][j])) };
}

const onScale = (ratio, est, se) => {
  const lo = est - Z95 * se, hi = est + Z95 * se;
  return ratio ? { est: Math.exp(est), lo: Math.exp(lo), hi: Math.exp(hi), se } : { est, lo, hi, se };
};

/** League table: cell [i][j] is treatment i versus treatment j, back-transformed for ratios; null on the diagonal. */
export function leagueTable(fit, measure) {
  const ratio = nmaMeasure(measure).ratio, T = fit.b.length + 1;
  return Array.from({ length: T }, (_, i) => Array.from({ length: T }, (_, j) => {
    if (i === j) return null;
    const r = relative(fit, i, j);
    return onScale(ratio, r.est, r.se);
  }));
}

/** Each treatment against the reference, for the forest plot. */
export function versusReference(fit, measure) {
  const ratio = nmaMeasure(measure).ratio;
  return fit.b.map((b, i) => onScale(ratio, b, Math.sqrt(fit.V[i][i])));
}

/**
 * P-scores (Rücker & Schwarzer 2015): the mean, over the other treatments, of
 * the one-sided p-value that treatment i is better than j,
 * P_i = 1/(T−1) Σ_j Φ((d_j − d_i)/se_ij) when small values are better (sign
 * reversed otherwise). They equal SUCRA computed from the normal
 * approximation to the estimates, without resampling.
 */
export function pScores(fit, { smallBetter = true } = {}) {
  const { d, C } = fullEffects(fit), T = d.length;
  return d.map((di, i) => {
    let sum = 0;
    for (let j = 0; j < T; j++) {
      if (j === i) continue;
      const se = Math.sqrt(C[i][i] + C[j][j] - 2 * C[i][j]);
      const z = (d[j] - di) / se;
      sum += pnorm(smallBetter ? z : -z);
    }
    return T > 1 ? sum / (T - 1) : 1;
  });
}

/** Per treatment, the participants randomised to it; per pair, the studies comparing it directly. */
export function networkGeometry(ready, order) {
  const n = Object.fromEntries(order.map(t => [t, 0])), studiesOf = Object.fromEntries(order.map(t => [t, 0])), edges = new Map();
  for (const r of ready) {
    for (const a of r.arms) { n[a.treatment] += a.n; studiesOf[a.treatment]++; }
    const ts = r.arms.map(a => a.treatment).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const key = `${ts[i]}\u0000${ts[j]}`; edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return { k: ready.length, nodes: order.map(t => ({ t, n: n[t], studies: studiesOf[t] })),
    edges: [...edges].map(([key, k]) => { const [a, b] = key.split('\u0000'); return { a, b, k }; }) };
}

// ---- figures ------------------------------------------------------------------------
// The house style (FIGURE-STYLE §2): tokens for every colour and size, labels that wrap to two lines or become a key,
// baseline axes, the source block under the drawing. `style` is figureTokens (the export set unless given); the screen
// copy is the same drawing in px, coloured by its c-* classes.

const f2 = x => Number(x).toFixed(2);
export const withCi = (e, lo, hi) => `${f2(e)} (${f2(lo)} to ${f2(hi)})`;
const countOf = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The network graph: treatments on a circle, node area proportional to the participants randomised to it, edge width
 * to the number of studies making that comparison directly. Each edge carries its study count beside it; where two
 * edges cross at their midpoints the label moves along its edge. A treatment name wraps to two lines or becomes a key
 * listed under the figure; the encoding is stated in the source block.
 */
export function networkSvg(geo, { title = 'Network graph', style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  const nodes0 = geo?.nodes || [];
  if (!nodes0.length) return emptyFigure(t, { title, message: 'No treatment to draw yet.', width, source });
  const ls = t.size.label, sm = t.size.small, P = t.pad, k = t.row / 22, step = ls * LINE, gap = ls * 0.5;
  const RMIN = 7 * k, RMAX = 20 * k, T = nodes0.length;
  const col = labelColumn(t, nodes0.map(x => x.t), t.width.single * 0.3);
  const nLabel = x => `n = ${countOf(x.n)}`;
  const blocks = nodes0.map((x, i) => [...col.lines[i], nLabel(x)]);
  const labelW = Math.max(...nodes0.flatMap((x, i) => [...col.lines[i].map(l => measure(t, l)), measure(t, nLabel(x), 'small')]));
  const blockH = Math.max(...blocks.map(b => b.length)) * step;
  const hpad = P + labelW + gap + RMAX, vpad = P + blockH + gap + RMAX;
  const R = T === 1 ? 0 : Math.max(T * ls * 0.9, 90 * k, Math.min(130 * k, 230 * k - hpad));
  const cy = vpad + R, w = Math.max(2 * (hpad + R), Math.min(t.width.double, t.width.single * 0.9));
  const nMax = Math.max(1, ...nodes0.map(x => countOf(x.n))), kMax = Math.max(1, ...(geo.edges || []).map(e => countOf(e.k)));
  const pos = {};
  nodes0.forEach((x, i) => {
    const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, T);
    pos[x.t] = { x: w / 2 + R * Math.cos(a), y: cy + R * Math.sin(a), c: Math.cos(a), s: Math.sin(a), r: RMIN + (RMAX - RMIN) * Math.sqrt(countOf(x.n) / nMax) };
  });
  const edgesIn = (geo.edges || []).filter(e => pos[e.a] && pos[e.b]);
  // edge labels: the midpoint, else 35 % or 65 % along the edge, to the side away from the centre
  const placed = [], off = ls * 0.75;
  const toSegment = (x, y, A, B) => {
    const dx = B.x - A.x, dy = B.y - A.y, u = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(A.x + u * dx - x, A.y + u * dy - y);
  };
  // clear of other labels, of every node, and of every other edge
  const clear = (x, y, self) => placed.every(q => Math.hypot(q[0] - x, q[1] - y) > ls * 1.35) &&
    nodes0.every(n => Math.hypot(pos[n.t].x - x, pos[n.t].y - y) > pos[n.t].r + ls * 0.67) &&
    edgesIn.every(o => o === self || toSegment(x, y, pos[o.a], pos[o.b]) > ls * 0.67);
  const edges = edgesIn.map(e => {
    const A = pos[e.a], B = pos[e.b], dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if ((mx - w / 2) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const at = u => [A.x + dx * u + nx * off, A.y + dy * u + ny * off];
    const spot = [0.5, 0.35, 0.65, 0.25, 0.75].map(at).find(([x, y]) => clear(x, y, e)) || at(0.5);
    placed.push(spot);
    const kk = countOf(e.k), sw = Math.max(t.line.ci, (kMax > 1 ? 1 + 4 * (kk - 1) / (kMax - 1) : 1) * k);
    return `<line class="c-axis" x1="${r1(A.x)}" y1="${r1(A.y)}" x2="${r1(B.x)}" y2="${r1(B.y)}" stroke="${t.color.axis}" stroke-width="${r1(sw * 100) / 100}"><title>${esc(`${e.a} – ${e.b}: ${kk} ${kk === 1 ? 'study' : 'studies'}`)}</title></line>` +
      text(t, spot[0], spot[1] + sm * 0.35, String(kk), { anchor: 'middle', role: 'small', cls: 'c-mute' });
  }).join('');
  const nodes = nodes0.map((x, i) => {
    const P0 = pos[x.t], anchor = P0.c > 0.3 ? 'start' : P0.c < -0.3 ? 'end' : 'middle', b = blocks[i];
    const lx = anchor === 'middle' ? P0.x : P0.x + (P0.r + gap) * Math.sign(P0.c);
    // the block sits above, below or beside the node; the first line's centre, then each line below it
    const top = P0.s < -0.5 ? P0.y - P0.r - gap - b.length * step : P0.s > 0.5 ? P0.y + P0.r + gap : P0.y - b.length * step / 2;
    const ln = b.map((l, j) => `<tspan x="${r1(lx)}" y="${r1(top + step / 2 + j * step + ls * 0.35)}"${j === b.length - 1 ? ` font-size="${t.size.small}" fill="${t.color.ink2}" class="c-mute"` : ''}>${esc(l)}</tspan>`).join('');
    return `<circle class="c-dot" cx="${r1(P0.x)}" cy="${r1(P0.y)}" r="${r1(P0.r)}" fill="${t.color.ink}"><title>${esc(`${x.t}: ${countOf(x.n)} participants, ${countOf(x.studies)} ${x.studies === 1 ? 'study' : 'studies'}`)}</title></circle>` +
      `<text text-anchor="${anchor}" class="c-ink" fill="${t.color.ink}">${ln}</text>`;
  }).join('');
  const parts = [edges, nodes];
  const h = footBlock(t, parts, cy + R + vpad - P, w, { source: [`${T} ${T === 1 ? 'treatment' : 'treatments'}, ${countOf(geo.k)} ${countOf(geo.k) === 1 ? 'study' : 'studies'}`, 'Edge width is the number of studies; node area is the number of participants', ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title, desc: `${T} treatments, ${countOf(geo.k)} studies, ${edgesIn.length} direct comparisons` });
}

/**
 * Forest plot of every treatment against the reference, on the log scale (powers of two) for a ratio, with the
 * P-score beside each: column heads over a hairline, the null line behind the rows, a bottom axis with ticks, and an
 * arrowhead where an interval runs past the axis. Treatment names wrap to two lines or become a key.
 */
export function forestSvg(order, effects, { measure: measureId, scores = null, title = 'Forest plot', style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  const m = nmaMeasure(measureId), ratio = m.ratio;
  const rows = (order || []).slice(1).map((name, i) => ({ t: name, ...(effects?.[i] || {}) }));
  if (!rows.length) return emptyFigure(t, { title, message: 'No comparison to draw yet.', width, source });
  const P = t.pad, ls = t.size.label, sm = t.size.small, gap = ls * GAP, step = ls * LINE;
  const ok = r => [r.est, r.lo, r.hi].every(v => Number.isFinite(v) && (!ratio || v > 0));
  const tr = v => (ratio ? Math.log2(v) : v), back = v => (ratio ? 2 ** v : v);
  const est = r => (ok(r) ? withCi(r.est, r.lo, r.hi) : 'Not estimable');
  const sc = i => (scores && Number.isFinite(scores[i + 1]) ? f2(scores[i + 1]) : '–');
  const w0 = width || t.width.double;
  const col = labelColumn(t, rows.map(r => r.t), w0 * 0.3, { min: measure(t, 'Treatment') });
  const headEst = `${ratio || m.id === 'MD' ? m.label : m.id} (95% CI)`;
  const estW = Math.max(measure(t, headEst, 'head') * 1.08, ...rows.map(r => measure(t, est(r)))) + ls;
  const sW = scores ? Math.max(measure(t, 'P-score', 'head') * 1.08, ...rows.map((_, i) => measure(t, sc(i)))) + ls : 0;
  const plotW = Math.max(ls * 12, w0 * 0.34), x0 = P + col.w, x1 = x0 + plotW;
  const xEst = x1 + gap * 2 + estW, xS = xEst + (scores ? gap + sW : 0), w = xS + P;
  // the axis covers the estimates and the null; an interval past 1/32 or 32 (log) ends in an arrowhead
  const good = rows.filter(ok), refV = ratio ? 1 : 0, cap = ratio ? 5 : Infinity;
  let lo0 = Math.min(tr(refV), ...good.map(r => Math.max(-cap, tr(r.lo)))), hi0 = Math.max(tr(refV), ...good.map(r => Math.min(cap, tr(r.hi))));
  let ticks;
  if (ratio) { lo0 = Math.floor(lo0); hi0 = Math.ceil(hi0); if (hi0 === lo0) { lo0 -= 1; hi0 += 1; } ticks = Array.from({ length: hi0 - lo0 + 1 }, (_, i) => lo0 + i); }
  else ({ ticks, lo: lo0, hi: hi0 } = niceTicks(lo0, hi0, 5));
  const X = v => x0 + plotW * (Math.min(hi0, Math.max(lo0, tr(v))) - lo0) / (hi0 - lo0);
  const ARROW = figId('nf', title, order.join('|'), t.medium);
  // heads: "vs <reference>" over the plot (two lines at most), the rest on its last line
  let vs = wrapText(t, `vs ${order[0]}`, plotW), extra = '';
  if (vs.length > 2) { vs = ['vs reference']; extra = `Reference: ${order[0]}`; }
  const hy = P + (vs.length - 1) * step + ls, body = [];
  body.push(text(t, P, hy, 'Treatment', { role: 'head', cls: 'c-ink c-head' }), text(t, xEst, hy, headEst, { role: 'head', anchor: 'end', cls: 'c-ink c-head' }),
    lines(t, (x0 + x1) / 2, hy - ls * 0.35 - (vs.length - 1) * step / 2, vs, { anchor: 'middle', cls: 'c-mute', color: t.color.ink2 }));
  if (scores) body.push(text(t, xS, hy, 'P-score', { role: 'head', anchor: 'end', cls: 'c-ink c-head' }));
  let y = hy + ls * 0.6;
  body.push(hairLine(t, P, y, w - P, y));
  const top = y;
  let arrows = false;
  rows.forEach((r, i) => {
    const ln = col.lines[i], h = rowHeight(t, ln.length), cy = y + h / 2, say = `${r.t} vs ${order[0]}: ${m.id} ${est(r)}${scores ? `; P-score ${sc(i)}` : ''}`;
    const side = t.square[0] + t.square[1] * 0.5;
    let mark = '';
    if (ok(r)) {
      const cutL = tr(r.lo) < lo0, cutR = tr(r.hi) > hi0;
      arrows ||= cutL || cutR;
      mark = `<line class="c-line" x1="${r1(X(r.lo))}" y1="${r1(cy)}" x2="${r1(X(r.hi))}" y2="${r1(cy)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"${cutL ? ` marker-start="url(#${ARROW})"` : ''}${cutR ? ` marker-end="url(#${ARROW})"` : ''}/>` +
        `<rect class="c-dot" x="${r1(X(r.est) - side / 2)}" y="${r1(cy - side / 2)}" width="${r1(side)}" height="${r1(side)}" fill="${t.color.ink}"/>`;
    }
    // one group per row: the <title> is its readout on screen (lib/figure.mjs)
    body.push(`<g><title>${esc(say)}</title><rect class="fig-band" x="${r1(P)}" y="${r1(y)}" width="${r1(w - 2 * P)}" height="${r1(h)}" fill="none"/>` +
      lines(t, P, cy, ln, { inner: fullTitle(r.t, ln) }) + text(t, xEst, cy + ls * 0.35, est(r), { anchor: 'end' }) + mark +
      (scores ? text(t, xS, cy + ls * 0.35, sc(i), { anchor: 'end' }) : '') + '</g>');
    y += h;
  });
  const parts = [axisLine(t, X(refV), top, X(refV), y, { width: t.line.null }), ...body];
  const ay = bottomAxis(t, parts, v => x0 + plotW * (v - lo0) / (hi0 - lo0), ticks, x0, x1, y, v => String(Number(back(v).toPrecision(3))));
  const h = footBlock(t, parts, ay, w, { source: [extra, ...sourceOf(source)], keys: col.keys });
  return svgRoot(t, w, h, parts.join(''), { title, desc: `${rows.length} treatments against ${order[0]}, ${m.label}`, defs: arrows ? arrowMarker(t, ARROW, 0.5) : '' });
}

/** The drawings app/lint-figures.mjs checks: a five-treatment network with long names and a forest, ratio and difference, with an interval past the axis. */
export const __fixture = style => {
  const names = ['Placebo', 'Cognitive behavioural therapy', 'Selective serotonin reuptake inhibitor', 'Exercise', 'Combined therapy with medication and psychotherapy'];
  const geo = { k: 9, nodes: names.map((t, i) => ({ t, n: [420, 310, 580, 150, 90][i], studies: [5, 4, 6, 2, 1][i] })),
    edges: [['Placebo', 'Cognitive behavioural therapy', 3], ['Placebo', 'Selective serotonin reuptake inhibitor', 4], ['Placebo', 'Exercise', 1],
      ['Cognitive behavioural therapy', 'Combined therapy with medication and psychotherapy', 1], ['Selective serotonin reuptake inhibitor', 'Exercise', 2]].map(([a, b, k]) => ({ a, b, k })) };
  const ratio = [{ est: 0.62, lo: 0.41, hi: 0.94 }, { est: 0.55, lo: 0.36, hi: 0.84 }, { est: 1.1, lo: 0.52, hi: 40 }, { est: 0.31, lo: 0.12, hi: 0.8 }];
  const diff = ratio.map(r => ({ est: Math.log(r.est), lo: Math.log(r.lo), hi: Math.log(r.hi) }));
  return [{ name: 'networkSvg', svg: networkSvg(geo, { style }) }, { name: 'networkSvg-single', svg: networkSvg({ k: 0, nodes: [geo.nodes[0]], edges: [] }, { style }) },
    { name: 'forestSvg-ratio', svg: forestSvg(names, ratio, { measure: 'OR', scores: [0.12, 0.61, 0.74, 0.33, 0.7], style, source: ['Random-effects network meta-analysis'] }) },
    { name: 'forestSvg-difference', svg: forestSvg(names.slice(0, 3), diff.slice(0, 2), { measure: 'MD', style }) },
    { name: 'forestSvg-empty', svg: forestSvg(['A'], [], { measure: 'OR', style }) }];
};

/** Rows for a CSV: the arm-level input. */
export function csvRows(ready, family) {
  const f = ARM_FIELDS[family];
  return [['Study', 'Treatment', ...f.map(x => ({ events: 'Events', n: 'N', mean: 'Mean', sd: 'SD' }[x]))],
    ...ready.flatMap(r => r.arms.map(a => [r.label, a.treatment, ...f.map(x => a[x])]))];
}

/** For the assistant and the manuscript: the saved result in one line. */
export function resultLine(result, { smallBetter = true } = {}) {
  if (!result) return 'Network meta-analysis: not run';
  const fit = result.random || result.common, model = result.random ? 'random effects' : 'common effect';
  const scores = pScores(fit, { smallBetter });
  const best = result.order.map((t, i) => [t, scores[i]]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, s]) => `${t} ${f2(s)}`).join(', ');
  return `Network meta-analysis (${result.measure}, ${model}, ${result.k} studies, ${result.order.length} treatments, reference ${result.order[0]}): ` +
    `${result.random ? `τ² ${f2(result.random.tau2)}, ` : ''}Q ${f2(result.q.total)} (df ${result.q.totalDf}); P-scores ${best}`;
}
