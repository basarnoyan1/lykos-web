// Diagnostic test accuracy (plan §1.1, I8): an index test against a reference
// standard, one selected 2×2 table per study for each synthesis. Other tests
// and thresholds remain stored; overlapping tables never count as new studies.
//
// Per study, sensitivity TP/(TP+FN) and specificity TN/(TN+FP) with a Wilson
// score or an exact (Clopper–Pearson) interval, computed here. Pooled, two
// models run through metafor (lib/r.mjs): a univariate random-effects model on
// each logit proportion (escalc "PLO", 0.5 added only to a study with a zero
// cell), and the bivariate random-effects model of Reitsma et al. (2005) as
// rma.mv on the stacked logits with an unstructured study-level random effect.
// The summary operating point, its confidence region, the SROC curve and the
// likelihood ratios and diagnostic odds ratio follow from the bivariate
// estimates here, by the formulas below; bench/dta checks both stages.
import { studies } from './screen.mjs';
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text as svgText, lines, labelColumn, rowHeight, axisLine, hairLine, tick, measure, r1, esc, GAP, footBlock, emptyFigure, bottomAxis, legendRow, fullTitle, sourceOf } from './figure-kit.mjs';
import { setManualStateValue } from './fields.mjs';

export const COUNTS = ['tp', 'fp', 'fn', 'tn'];
export const Z95 = 1.959963984540054;               // qnorm(0.975)
// sqrt(qchisq(0.95, 2)): a chi-square on 2 df has quantile −2·ln(α).
export const C95 = Math.sqrt(-2 * Math.log(0.05));
export const MIN_BIVARIATE = 4;                      // three variance parameters need room
export const CI_METHODS = [['wilson', 'Wilson score'], ['exact', 'Exact (Clopper–Pearson)']];
export const ESTIMATORS = [['REML', 'REML'], ['DL', 'DerSimonian–Laird']];

export const ilogit = x => 1 / (1 + Math.exp(-x));

// ---- inputs -----------------------------------------------------------------

const count = (s, paperId, id) => {
  const v = s.values?.[`${paperId}:${id}`];
  // not reported, or blank: missing, never a zero count (plan F3)
  if (!v || v.availability === 'not_found') return null;
  const raw = v.normalized_value ?? v.reported_value;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
};
const text = (s, paperId, id) => String(s.values?.[`${paperId}:${id}`]?.normalized_value ?? s.values?.[`${paperId}:${id}`]?.reported_value ?? '').trim();
const META = { index: 'dta_index', reference: 'dta_reference', threshold: 'dta_threshold', population: 'dta_population', source: 'dta_source' };
export const PRIMARY_TABLE = 'primary';
export const tableSignature = r => JSON.stringify([r.index, r.reference, r.threshold]);
const rawCount = v => v == null || String(v).trim() === '' ? null : Number(v);

/** Stored alternatives and the original extraction table, whose value keys stay unchanged. */
export function dtaTables(s, paper) {
  const base = { id: paper.id, tableId: PRIMARY_TABLE, paperId: paper.id, paper, label: paper.label || paper.title || paper.id,
    ...Object.fromEntries(Object.entries(META).map(([k, f]) => [k, text(s, paper.id, f)])),
    ...Object.fromEntries(COUNTS.map(k => [k, count(s, paper.id, k)])) };
  const extras = (s.dtaTables?.[paper.id] || []).map(r => ({ ...r, id: `${paper.id}@${r.id}`, tableId: r.id,
    paperId: paper.id, paper, label: base.label,
    ...Object.fromEntries(Object.keys(META).map(k => [k, String(r[k] ?? '').trim()])),
    ...Object.fromEntries(COUNTS.map(k => [k, rawCount(r[k])])) }));
  const selected = s.dtaSelection?.[paper.id] || PRIMARY_TABLE;
  return [base, ...extras].map(r => ({ ...r, selected: r.tableId === selected, problems: tableProblems(r),
    status: COUNTS.some(k => r[k] === null) ? 'incomplete' : validTable(r) ? 'ready' : 'invalid' }));
}

/** Pure reducers: table edits are manual accepted inputs with a source and a change record. */
export function addDtaTable(s, paperId) {
  if (!(s.papers || []).some(p => p.id === paperId)) throw new Error('Unknown study');
  s.dtaTables ||= {}; const rows = s.dtaTables[paperId] ||= [];
  let n = 1; while (rows.some(r => r.id === `table${n}`) || (s.dtaTableTrash || []).some(r => r.paperId === paperId && r.table.id === `table${n}`)) n++;
  const id = `table${n}`; rows.push({ id, at: new Date().toISOString(), origin: 'manual' });
  return id;
}
export function setDtaSelection(s, paperId, tableId) {
  const p = (s.papers || []).find(p => p.id === paperId);
  if (!p || tableId !== 'none' && !dtaTables(s, p).some(r => r.tableId === tableId)) throw new Error('Unknown diagnostic table');
  s.dtaSelection ||= {}; s.dtaSelection[paperId] = tableId; return s;
}
export function removeDtaTable(s, paperId, tableId) {
  if (tableId === PRIMARY_TABLE) throw new Error('The extraction table cannot be removed here');
  const row = (s.dtaTables?.[paperId] || []).find(r => r.id === tableId); if (!row) return s;
  const wasSelected = s.dtaSelection?.[paperId] === tableId;
  s.dtaTableTrash = [...(s.dtaTableTrash || []), { id: `removed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, paperId, table: structuredClone(row), wasSelected, at: new Date().toISOString() }].slice(-100);
  s.dtaTables ||= {}; s.dtaTables[paperId] = (s.dtaTables[paperId] || []).filter(r => r.id !== tableId);
  if (wasSelected) delete s.dtaSelection[paperId];
  return s;
}
export function restoreDtaTable(s, removedId) {
  const entry = (s.dtaTableTrash || []).find(r => r.id === removedId);
  if (!entry || !(s.papers || []).some(p => p.id === entry.paperId)) throw new Error('The removed table or its study is unavailable');
  const rows = (s.dtaTables ||= {})[entry.paperId] ||= [];
  if (rows.some(r => r.id === entry.table.id)) throw new Error('A table with this ID already exists');
  rows.push(structuredClone(entry.table));
  if (entry.wasSelected && (!s.dtaSelection?.[entry.paperId] || s.dtaSelection[entry.paperId] === PRIMARY_TABLE)) setDtaSelection(s, entry.paperId, entry.table.id);
  s.dtaTableTrash = s.dtaTableTrash.filter(r => r.id !== removedId); return s;
}
export function setDtaTableValue(s, paperId, tableId, field, value) {
  if (![...COUNTS, ...Object.keys(META)].includes(field)) throw new Error('Unknown diagnostic field');
  const raw = String(value ?? '').trim(), at = new Date().toISOString();
  const key = `${paperId}:${tableId === PRIMARY_TABLE ? META[field] || field : `dta@${tableId}:${field}`}`;
  let previous;
  if (tableId === PRIMARY_TABLE) {
    if (!(s.papers || []).some(p => p.id === paperId)) throw new Error('Unknown study');
    const old = s.values?.[key];
    if (old?.locked) return false;
    previous = old?.reported_value ?? null;
    setManualStateValue(s, paperId, META[field] || field, raw, { type: COUNTS.includes(field) ? 'integer' : 'text', roundInteger: false });
  } else {
    const row = (s.dtaTables?.[paperId] || []).find(r => r.id === tableId);
    if (!row) throw new Error('Unknown diagnostic table');
    previous = row[field] ?? null; row[field] = raw; row.at = at; row.origin = 'manual';
  }
  s.extractionLog = [...(s.extractionLog || []), { key, action: 'manual-diagnostic-table', from: previous, value: raw, at }].slice(-2000);
  return true;
}

/** A 2×2 table is usable when every cell is a whole count and both reference groups have patients. */
export function tableProblems(r) {
  const problems = COUNTS.flatMap(k => r[k] == null ? [`${k.toUpperCase()} is missing`]
    : !Number.isInteger(r[k]) || r[k] < 0 ? [`${k.toUpperCase()} must be a nonnegative whole count`] : []);
  if (!problems.length) {
    if (r.tp + r.fn === 0) problems.push('No reference-positive participants (TP + FN = 0)');
    if (r.fp + r.tn === 0) problems.push('No reference-negative participants (FP + TN = 0)');
  }
  return problems;
}
export const validTable = r => !tableProblems(r).length;

/**
 * The included studies' 2×2 tables: ready, missing a cell, or not a valid
 * table. The snapshot is what a saved result is compared against.
 */
export function dtaInputs(s) {
  const ready = [], incomplete = [], invalid = [], tables = [], excluded = [];
  for (const p of studies(s)) {
    const all = dtaTables(s, p); tables.push(...all);
    const r = all.find(r => r.selected);
    if (!r) { excluded.push(p); continue; }
    ({ ready, incomplete, invalid })[r.status].push(r);
  }
  const snapshot = JSON.stringify({
    version: 2,
    rows: ready.map(r => [r.id, r.label, ...COUNTS.map(k => r[k]), ...Object.keys(META).map(k => r[k])]).sort((a, b) => a[0].localeCompare(b[0])),
    pending: [...incomplete, ...invalid].map(r => [r.id, r.status, ...COUNTS.map(k => r[k]), ...Object.keys(META).map(k => r[k])]).sort((a, b) => a[0].localeCompare(b[0])),
    excluded: excluded.map(p => p.id).sort(),
  });
  return { ready, incomplete, invalid, tables, excluded, snapshot };
}

/** 'current', 'stale' when the inputs changed after the saved run, or null when nothing was run. */
export function dtaStatus(s, result = s.dta) {
  if (!result) return null;
  return result.snapshot === dtaInputs(s).snapshot ? 'current' : 'stale';
}

// ---- per-study intervals ----------------------------------------------------

/** Wilson score interval for x of n. */
export function wilson(x, n, z = Z95) {
  if (!(n > 0)) return [NaN, NaN];
  const p = x / n, z2 = z * z, d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z / d) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Lanczos approximation (g = 7, nine terms) to log Γ.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
// Continued fraction for the incomplete beta (modified Lentz).
function betacf(a, b, x) {
  const TINY = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a, b). */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betacf(a, b, x) / a : 1 - front * betacf(b, a, 1 - x) / b;
}
/** Beta quantile by bisection: I_x is monotone in x, so this cannot miss. */
export function qbeta(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (ibeta(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Exact (Clopper–Pearson) interval for x of n. */
export function clopperPearson(x, n, level = 0.95) {
  if (!(n > 0)) return [NaN, NaN];
  const a = (1 - level) / 2;
  return [x === 0 ? 0 : qbeta(a, x, n - x + 1), x === n ? 1 : qbeta(1 - a, x + 1, n - x)];
}

/** Sensitivity and specificity of one study, with the chosen interval. */
export function studyAccuracy(r, method = 'wilson') {
  const ci = method === 'exact' ? clopperPearson : wilson;
  const np = r.tp + r.fn, nn = r.fp + r.tn;
  const [sensLo, sensHi] = ci(r.tp, np), [specLo, specHi] = ci(r.tn, nn);
  return { sens: r.tp / np, sensLo, sensHi, spec: r.tn / nn, specLo, specHi, n: np + nn };
}

// ---- pooled: R, and what follows from its estimates ---------------------------

const rvec = xs => `c(${xs.map(x => String(Number(x))).join(',')})`;

/**
 * R code for both models. Ends in a flat list(...) (lib/r.mjs flattens one
 * level). The bivariate fit is attempted only with enough studies, and a fit
 * that fails to converge is reported as such rather than as a number.
 */
export function rCode(rows, { method = 'REML' } = {}) {
  const ids = rows.map(r => r.paperId || r.paper?.id || r.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Select one test / threshold per study; dependent tables cannot be pooled as independent studies');
  if (rows.some(r => !validTable(r))) throw new Error('Invalid diagnostic 2×2 table');
  const m = method === 'DL' ? 'DL' : 'REML';
  const col = k => rvec(rows.map(r => r[k]));
  return `
    tp <- ${col('tp')}; fp <- ${col('fp')}; fn <- ${col('fn')}; tn <- ${col('tn')}
    k <- length(tp)
    s1 <- escalc(measure="PLO", xi=tp, ni=tp+fn, add=1/2, to="only0")
    s2 <- escalc(measure="PLO", xi=tn, ni=tn+fp, add=1/2, to="only0")
    u1 <- rma(yi, vi, data=s1, method="${m}")
    u2 <- rma(yi, vi, data=s2, method="${m}")
    b <- NULL; berr <- ""
    if (k >= ${MIN_BIVARIATE}) {
      d <- data.frame(study=rep(seq_len(k), 2), what=factor(rep(c("sens","spec"), each=k), levels=c("sens","spec")),
                      yi=c(as.numeric(s1$yi), as.numeric(s2$yi)), vi=c(as.numeric(s1$vi), as.numeric(s2$vi)))
      b <- tryCatch(rma.mv(yi, vi, mods=~ what - 1, random=~ what | study, struct="UN", data=d, method="REML"),
                    error=function(e) { berr <<- conditionMessage(e); NULL })
    }
    ok <- !is.null(b)
    V <- if (ok) vcov(b) else matrix(NA_real_, 2, 2)
    list(k=k,
      yi_sens=as.numeric(s1$yi), vi_sens=as.numeric(s1$vi), yi_spec=as.numeric(s2$yi), vi_spec=as.numeric(s2$vi),
      u_sens_b=as.numeric(coef(u1)), u_sens_se=u1$se, u_sens_tau2=u1$tau2, u_sens_i2=u1$I2, u_sens_q=u1$QE, u_sens_qp=u1$QEp,
      u_spec_b=as.numeric(coef(u2)), u_spec_se=u2$se, u_spec_tau2=u2$tau2, u_spec_i2=u2$I2, u_spec_q=u2$QE, u_spec_qp=u2$QEp,
      b_ok=ok, b_err=berr,
      b_sens=if (ok) as.numeric(coef(b)[1]) else NA_real_, b_spec=if (ok) as.numeric(coef(b)[2]) else NA_real_,
      v11=V[1,1], v12=V[1,2], v22=V[2,2],
      tau2_sens=if (ok) b$tau2[1] else NA_real_, tau2_spec=if (ok) b$tau2[2] else NA_real_,
      rho=if (ok) b$rho else NA_real_, ll=if (ok) as.numeric(logLik(b)) else NA_real_)`;
}

const num = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const arr = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]).map(Number);

/** The saved result, from R's list and the rows it was run on. */
export function fromR(out, rows, { method = 'REML', snapshot = '' } = {}) {
  const uni = key => ({ b: num(out[`u_${key}_b`]), se: num(out[`u_${key}_se`]), tau2: num(out[`u_${key}_tau2`]),
    i2: num(out[`u_${key}_i2`]), q: num(out[`u_${key}_q`]), qp: num(out[`u_${key}_qp`]) });
  const ok = out.b_ok === true || out.b_ok === 1 || out.b_ok === 'TRUE';
  return {
    at: new Date().toISOString(), method, k: rows.length, snapshot,
    ids: rows.map(r => r.id), labels: rows.map(r => r.label),
    papers: rows.map(r => r.paperId || r.paper?.id || r.id),
    tables: rows.map(r => ({ id: r.id, paperId: r.paperId || r.paper?.id || r.id, tableId: r.tableId || PRIMARY_TABLE,
      ...Object.fromEntries(Object.keys(META).map(k => [k, r[k] || ''])), ...Object.fromEntries(COUNTS.map(k => [k, r[k]])) })),
    yiSens: arr(out.yi_sens), viSens: arr(out.vi_sens), yiSpec: arr(out.yi_spec), viSpec: arr(out.vi_spec),
    uni: { sens: uni('sens'), spec: uni('spec') },
    biv: ok ? { sens: num(out.b_sens), spec: num(out.b_spec), v11: num(out.v11), v12: num(out.v12), v22: num(out.v22),
      tau2Sens: num(out.tau2_sens), tau2Spec: num(out.tau2_spec), rho: num(out.rho), ll: num(out.ll) } : null,
    bivError: ok ? '' : rows.length < MIN_BIVARIATE ? `needs ${MIN_BIVARIATE} studies` : String(out.b_err || 'did not converge'),
  };
}

/** A logit estimate and its SE as a proportion with its 95% interval. */
export const onProportion = (b, se) => ({ est: ilogit(b), lo: ilogit(b - Z95 * se), hi: ilogit(b + Z95 * se) });

/**
 * Summary sensitivity and specificity, the likelihood ratios and the
 * diagnostic odds ratio from the bivariate estimates (b = logit sens, logit
 * spec; V their covariance). DOR = exp(b1 + b2) is linear on the log scale;
 * the likelihood ratios' intervals are by the delta method on the log scale.
 */
export function summary(biv) {
  if (!biv) return null;
  const { sens: b1, spec: b2, v11, v12, v22 } = biv;
  const se = ilogit(b1), sp = ilogit(b2);
  const onLog = (est, g1, g2) => {
    const sd = Math.sqrt(g1 * g1 * v11 + 2 * g1 * g2 * v12 + g2 * g2 * v22);
    return { est, lo: est * Math.exp(-Z95 * sd), hi: est * Math.exp(Z95 * sd) };
  };
  return {
    sens: onProportion(b1, Math.sqrt(v11)), spec: onProportion(b2, Math.sqrt(v22)),
    lrPos: onLog(se / (1 - sp), 1 - se, sp),
    lrNeg: onLog((1 - se) / sp, -se, -(1 - sp)),
    dor: onLog(Math.exp(b1 + b2), 1, 1),
    rho: biv.rho, tau2Sens: biv.tau2Sens, tau2Spec: biv.tau2Spec,
  };
}

/**
 * The 95% confidence region of the summary point, in ROC space (x = 1 −
 * specificity, y = sensitivity): an ellipse in logit space, radius
 * sqrt(χ²₂(0.95)) in the metric of the estimates' covariance, mapped back.
 */
export function confidenceRegion(biv, steps = 96) {
  if (!biv) return [];
  // x = logit(1 − spec) = −b2, so its covariance with b1 changes sign.
  const sxx = biv.v22, syy = biv.v11, sxy = -biv.v12;
  const l11 = Math.sqrt(sxx), l21 = sxy / l11, l22 = Math.sqrt(Math.max(0, syy - l21 * l21));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = 2 * Math.PI * i / steps, u = Math.cos(t), v = Math.sin(t);
    out.push([ilogit(-biv.spec + C95 * l11 * u), ilogit(biv.sens + C95 * (l21 * u + l22 * v))]);
  }
  return out;
}

/**
 * The SROC curve implied by the bivariate model (Rutter–Gatsonis form, Harbord
 * et al. 2007): logit(sens) = μA + (σA/σB)(logit(1 − spec) + μB), drawn across
 * the studies' own range of 1 − specificity. None when a variance is zero.
 */
export function srocCurve(biv, yiSpec = [], steps = 60) {
  if (!biv || !(biv.tau2Sens > 1e-10) || !(biv.tau2Spec > 1e-10) || !yiSpec.length) return [];
  const slope = Math.sqrt(biv.tau2Sens / biv.tau2Spec);
  const xs = yiSpec.map(y => -y), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (x1 - x0) * i / steps;
    out.push([ilogit(x), ilogit(biv.sens + slope * (x + biv.spec))]);
  }
  return out;
}

// ---- figures ------------------------------------------------------------------
// The house style (FIGURE-STYLE §2): tokens for every colour and size, study labels that wrap to two lines or become a
// key, baseline axes, the source block under the drawing. `style` is figureTokens (the export set unless given); the
// screen copy is the same drawing in px, coloured by its c-* classes.

const f2 = x => Number(x).toFixed(2);
export const withCi = (e, lo, hi) => `${f2(e)} (${f2(lo)} to ${f2(hi)})`;
const estOf = (e, lo, hi) => ([e, lo, hi].every(Number.isFinite) ? withCi(e, lo, hi) : 'Not estimable');

const readout = (r, a) => `${r.label}: TP ${r.tp}, FP ${r.fp}, FN ${r.fn}, TN ${r.tn}; ` +
  `sensitivity ${estOf(a.sens, a.sensLo, a.sensHi)}; specificity ${estOf(a.spec, a.specLo, a.specHi)}`;

/**
 * Paired forest plot: each study's counts, then sensitivity and specificity with their intervals side by side on
 * 0–1 axes, the estimate written to the left of each. With a summary, a diamond row for the pooled estimate under
 * each, under a hairline. Study names wrap to two lines or become a key.
 */
export function forestSvg(rows, { method = 'wilson', pooled = null, title = 'Paired forest plot', style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  if (!rows?.length) return emptyFigure(t, { title, message: 'No study with a complete 2×2 table yet.', width, source });
  const P = t.pad, ls = t.size.label, gap = ls * GAP, w0 = width || t.width.double;
  const est = rows.map(r => ({ r, a: validTable(r) ? studyAccuracy(r, method) : { sens: NaN, sensLo: NaN, sensHi: NaN, spec: NaN, specLo: NaN, specHi: NaN } }));
  const overall = pooled ? { label: pooled.label || 'Summary', a: { sens: pooled.sens.est, sensLo: pooled.sens.lo, sensHi: pooled.sens.hi, spec: pooled.spec.est, specLo: pooled.spec.lo, specHi: pooled.spec.hi } } : null;
  const col = labelColumn(t, [...rows.map(r => r.label), ...(overall ? [overall.label] : [])], w0 * 0.28, { min: measure(t, 'Study') });
  const cntW = Math.max(measure(t, 'TP', 'head'), ...rows.flatMap(r => COUNTS.map(k => measure(t, String(r[k]))))) + ls * 0.8;
  const textW = key => Math.max(measure(t, `${key} (95% CI)`, 'head') * 1.08, ...est.map(({ a }) => measure(t, estOf(a[key === 'Sensitivity' ? 'sens' : 'spec'], a[key === 'Sensitivity' ? 'sensLo' : 'specLo'], a[key === 'Sensitivity' ? 'sensHi' : 'specHi'])))) + ls * 0.4;
  const tS = textW('Sensitivity'), tP = textW('Specificity');
  const fixed = P * 2 + col.w + 4 * cntW + gap + tS + gap + tP + gap * 3;
  const plotW = Math.max(ls * 8, (w0 - fixed) / 2);
  const xC = P + col.w, xTs = xC + 4 * cntW + gap + tS, xPs = xTs + gap, xTp = xPs + plotW + gap * 2 + tP, xPp = xTp + gap, w = xPp + plotW + P + ls * 0.6;
  const X = (x0, v) => x0 + plotW * Math.min(1, Math.max(0, v));
  const hy = P + ls, body = [];
  body.push(svgText(t, P, hy, 'Study', { role: 'head', cls: 'c-ink c-head' }),
    ...['TP', 'FP', 'FN', 'TN'].map((c, i) => svgText(t, xC + (i + 1) * cntW, hy, c, { role: 'head', anchor: 'end', cls: 'c-ink c-head' })),
    svgText(t, xTs, hy, 'Sensitivity (95% CI)', { role: 'head', anchor: 'end', cls: 'c-ink c-head' }),
    svgText(t, xTp, hy, 'Specificity (95% CI)', { role: 'head', anchor: 'end', cls: 'c-ink c-head' }));
  let y = hy + ls * 0.6;
  body.push(hairLine(t, P, y, w - P, y));
  const top = y, side = t.square[0] + t.square[1] * 0.5;
  const interval = (x0, cy, e, lo, hi) => ([e, lo, hi].every(Number.isFinite)
    ? `<line class="c-line" x1="${r1(X(x0, lo))}" y1="${r1(cy)}" x2="${r1(X(x0, hi))}" y2="${r1(cy)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>` +
      `<rect class="c-dot" x="${r1(X(x0, e) - side / 2)}" y="${r1(cy - side / 2)}" width="${r1(side)}" height="${r1(side)}" fill="${t.color.ink}"/>` : '');
  const diamond = (x0, cy, e, lo, hi) => {
    if (![e, lo, hi].every(Number.isFinite)) return '';
    const dh = t.row * t.diamond / 2;
    return `<polygon class="c-dot" points="${r1(X(x0, lo))},${r1(cy)} ${r1(X(x0, e))},${r1(cy - dh)} ${r1(X(x0, hi))},${r1(cy)} ${r1(X(x0, e))},${r1(cy + dh)}" fill="${t.color.ink}"/>`;
  };
  // each study row is one group: its <title> is the row's readout on screen (lib/figure.mjs), its band, unfilled, where it is hovered
  const row = ({ r, a }, k, pool) => {
    const ln = col.lines[k], h = rowHeight(t, ln.length), cy = y + h / 2, ty = cy + ls * 0.35, role = pool ? 'head' : 'label', cls = pool ? 'c-ink c-head' : 'c-ink';
    const say = pool ? `${r.label}: sensitivity ${estOf(a.sens, a.sensLo, a.sensHi)}; specificity ${estOf(a.spec, a.specLo, a.specHi)}` : readout(r, a);
    const g = `<g${r.paper?.id ? ` data-study="${esc(r.paper.id)}"` : ''}><title>${esc(say)}</title><rect class="fig-band" x="${r1(P)}" y="${r1(y)}" width="${r1(w - 2 * P)}" height="${r1(h)}" fill="none"/>` +
      lines(t, P, cy, ln, { role, cls, inner: fullTitle(r.label, ln) }) +
      (pool ? '' : COUNTS.map((c, j) => svgText(t, xC + (j + 1) * cntW, ty, String(r[c]), { anchor: 'end' })).join('')) +
      svgText(t, xTs, ty, estOf(a.sens, a.sensLo, a.sensHi), { anchor: 'end', role, cls }) + (pool ? diamond(xPs, cy, a.sens, a.sensLo, a.sensHi) : interval(xPs, cy, a.sens, a.sensLo, a.sensHi)) +
      svgText(t, xTp, ty, estOf(a.spec, a.specLo, a.specHi), { anchor: 'end', role, cls }) + (pool ? diamond(xPp, cy, a.spec, a.specLo, a.specHi) : interval(xPp, cy, a.spec, a.specLo, a.specHi)) + '</g>';
    y += h;
    return g;
  };
  est.forEach((e, k) => body.push(row(e, k, false)));
  if (overall) { body.push(hairLine(t, P, y, w - P, y)); body.push(row({ r: { label: overall.label }, a: overall.a }, rows.length, true)); }
  const parts = [...body];
  y += ls * 0.4;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1], fmt = v => (v === 0 || v === 1 ? String(v) : v.toFixed(1));
  const ay = bottomAxis(t, parts, v => xPs + plotW * v, ticks, xPs, xPs + plotW, y, fmt);
  bottomAxis(t, parts, v => xPp + plotW * v, ticks, xPp, xPp + plotW, y, fmt);
  const sm = t.size.small, ty = ay + sm * 1.5;
  parts.push(svgText(t, xPs + plotW / 2, ty, 'Sensitivity', { anchor: 'middle', role: 'small', cls: 'c-mute' }), svgText(t, xPp + plotW / 2, ty, 'Specificity', { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  const note = `${rows.length} ${rows.length === 1 ? 'study' : 'studies'}; ${method === 'exact' ? 'Exact (Clopper–Pearson)' : 'Wilson score'} intervals`;
  const h = footBlock(t, parts, ty, w, { source: [note, ...sourceOf(source)], keys: col.keys });
  void top;
  return svgRoot(t, w, h, parts.join(''), { title, desc: note });
}

/**
 * SROC plot in ROC space: the studies (area by size), the bivariate summary point, its 95% confidence region and the
 * SROC curve, on L-shaped axes with ticks. The marks are named in a legend under the plot.
 */
export function srocSvg(rows, result, { title = 'Summary ROC plot', style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  const pts = (rows || []).filter(validTable).map(r => ({ r, a: studyAccuracy(r) })).filter(({ a }) => Number.isFinite(a.sens) && Number.isFinite(a.spec));
  if (!pts.length) return emptyFigure(t, { title, message: 'No study with a complete 2×2 table yet.', width, source });
  const P = t.pad, ls = t.size.label, sm = t.size.small, k = t.row / 22, S = Math.round(300 * k);
  const L = Math.max(...[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => measure(t, v === 0 || v === 1 ? String(v) : v.toFixed(1), 'small'))) + sm * 0.9, top = P + sm * 1.9;
  const w = Math.max(P + L + S + P + ls, Math.min(t.width.single, t.width.single * 0.9)), x0 = P + L, y1 = top + S;
  const X = v => x0 + S * v, Y = v => y1 - S * v;
  const parts = [];
  parts.push(svgText(t, P, P + sm, 'Sensitivity', { role: 'small', cls: 'c-mute' }), axisLine(t, x0, top, x0, y1), axisLine(t, x0, y1, x0 + S, y1));
  parts.push(hairLine(t, X(0), Y(0), X(1), Y(1)));
  const label = v => (v === 0 || v === 1 ? String(v) : v.toFixed(1));
  for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    parts.push(tick(t, X(v), y1), svgText(t, X(v), y1 + sm * 1.45, label(v), { anchor: v === 1 ? 'end' : 'middle', role: 'small', cls: 'c-ink', color: t.color.ink }),
      tick(t, x0, Y(v), 'left'), svgText(t, x0 - sm * 0.5, Y(v) + sm * 0.35, label(v), { anchor: 'end', role: 'small', cls: 'c-ink', color: t.color.ink }));
  }
  parts.push(svgText(t, X(0.5), y1 + sm * 3, '1 − specificity', { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  const nMax = Math.max(1, ...pts.map(({ r }) => r.tp + r.fp + r.fn + r.tn));
  const dots = pts.map(({ r, a }) => {
    const rad = (3 + 6 * Math.sqrt((r.tp + r.fp + r.fn + r.tn) / nMax)) * k;
    return `<circle class="c-line" cx="${r1(X(1 - a.spec))}" cy="${r1(Y(a.sens))}" r="${r1(rad)}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}"${r.paper?.id ? ` data-study="${esc(r.paper.id)}"` : ''}><title>${esc(readout(r, a))}</title></circle>`;
  }).join('');
  const path = ps => ps.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join(' ');
  const biv = result?.biv, curve = srocCurve(biv, result?.yiSpec || []), region = confidenceRegion(biv), dash = `${r1(4 * k)} ${r1(3 * k)}`;
  const sq = 8 * k;
  parts.push((curve.length ? `<path class="c-line" d="${path(curve)}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci * 1.6}"/>` : '') +
    (region.length ? `<path class="c-line" d="${path(region)} Z" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}" stroke-dasharray="${dash}"/>` : '') + dots +
    (biv ? `<rect class="c-dot" x="${r1(X(1 - ilogit(biv.spec)) - sq / 2)}" y="${r1(Y(ilogit(biv.sens)) - sq / 2)}" width="${r1(sq)}" height="${r1(sq)}" fill="${t.color.ink}"><title>Summary point</title></rect>` : ''));
  const items = [{ label: 'Study', markW: 10 * k, mark: (x, y) => `<circle class="c-line" cx="${r1(x + 5 * k)}" cy="${r1(y)}" r="${r1(4 * k)}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>` }];
  if (biv) items.push({ label: 'Summary point', markW: sq, mark: (x, y) => `<rect class="c-dot" x="${r1(x)}" y="${r1(y - sq / 2)}" width="${r1(sq)}" height="${r1(sq)}" fill="${t.color.ink}"/>` });
  if (region.length) items.push({ label: '95% confidence region', markW: 14 * k, mark: (x, y) => `<line class="c-line" x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + 14 * k)}" y2="${r1(y)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}" stroke-dasharray="${dash}"/>` });
  if (curve.length) items.push({ label: 'SROC curve', markW: 14 * k, mark: (x, y) => `<line class="c-line" x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + 14 * k)}" y2="${r1(y)}" stroke="${t.color.ink}" stroke-width="${t.line.ci * 1.6}"/>` });
  const ky = legendRow(t, parts, y1 + sm * 3, w, items);
  const note = `${pts.length} ${pts.length === 1 ? 'study' : 'studies'}; marker area follows study size`;
  const h = footBlock(t, parts, ky, w, { source: [note, ...sourceOf(source)] });
  return svgRoot(t, w, h, parts.join(''), { title, desc: note });
}

/** The drawings app/lint-figures.mjs checks: a paired forest with a long study name and a summary, the SROC plot with every mark, a bare one, and the empty forest. */
export const __fixture = style => {
  const rows = [{ label: 'Aldermere 2012', tp: 45, fp: 12, fn: 5, tn: 88 }, { label: 'Ibarra-Montoya, Kowalczyk and Nowak 2019: a multicentre cohort in emergency departments', tp: 30, fp: 3, fn: 10, tn: 40 },
    { label: 'Bo 2020', tp: 18, fp: 0, fn: 2, tn: 61 }, { label: 'Cole 2021', tp: 70, fp: 20, fn: 14, tn: 150 }];
  const biv = { sens: 1.6, spec: 2.1, v11: 0.04, v12: -0.01, v22: 0.09, tau2Sens: 0.5, tau2Spec: 0.8, rho: -0.4 };
  const sm = summary(biv), yiSpec = [1.4, 2.6, 4.1, 1.9];
  return [{ name: 'forestSvg', svg: forestSvg(rows, { style, pooled: { label: 'Summary (bivariate)', sens: sm.sens, spec: sm.spec } }) },
    { name: 'srocSvg', svg: srocSvg(rows, { biv, yiSpec }, { style }) }, { name: 'srocSvg-points', svg: srocSvg(rows.slice(0, 1), null, { style }) },
    { name: 'forestSvg-empty', svg: forestSvg([], { style }) }];
};

/** Rows for a CSV: the 2×2 table and both proportions with their intervals. */
export function csvRows(rows, method = 'wilson') {
  return [['Study', 'Index test', 'Reference standard', 'Threshold', 'TP', 'FP', 'FN', 'TN',
    'Sensitivity', 'Sensitivity lower', 'Sensitivity upper', 'Specificity', 'Specificity lower', 'Specificity upper', 'Population', 'Source', 'Table ID', 'Selected', 'Status'],
  ...rows.map(r => { const a = validTable(r) ? studyAccuracy(r, method) : {};
    return [r.label, r.index, r.reference, r.threshold, r.tp, r.fp, r.fn, r.tn, a.sens, a.sensLo, a.sensHi, a.spec, a.specLo, a.specHi,
      r.population || '', r.source || '', r.tableId || PRIMARY_TABLE, r.selected === false ? 'no' : 'yes', r.status || (validTable(r) ? 'ready' : 'invalid')]; })];
}

/** For the assistant and the manuscript: the saved result in one line. */
export function resultLine(result) {
  const sm = summary(result?.biv);
  if (!sm) return result ? `Accuracy (k = ${result.k}): bivariate model ${result.bivError}` : 'Accuracy: not run';
  return `Bivariate (k = ${result.k}): sensitivity ${withCi(sm.sens.est, sm.sens.lo, sm.sens.hi)}, specificity ${withCi(sm.spec.est, sm.spec.lo, sm.spec.hi)}, ` +
    `LR+ ${withCi(sm.lrPos.est, sm.lrPos.lo, sm.lrPos.hi)}, LR− ${withCi(sm.lrNeg.est, sm.lrNeg.lo, sm.lrNeg.hi)}, DOR ${withCi(sm.dor.est, sm.dor.lo, sm.dor.hi)}, ρ ${f2(sm.rho)}`;
}
