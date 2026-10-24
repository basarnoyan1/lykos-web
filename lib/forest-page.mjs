// The forest plot of an Analysis result (plan §4.6, review amendment of 2026-09-29; §2, "Screen charts in Analysis", 2026-10-24). The
// numbers the result keeps (each study's back-transformed estimate and interval, the subgroup and overall estimates, the weights) draw
// it twice: on screen as the analysis table Make draws (lib/analysis-charts.mjs forestTable, fluid at the panel's width, thirty rows to a
// page), and for print as the house forest of the same page (forestPageSvg) or RevMan Web's layout, which Download saves. A result kept before those
// numbers shows its R figure, which also stays the whole-figure download and the bundle's copy.
import { forestSvg } from './output-charts.mjs';
import { isRatio } from './effect-measures.mjs';
import { pager, wirePager } from './paging.mjs';
import { showFigure, showChart } from './figure.mjs';
import { figureTokens } from './figure-style.mjs';
import { revmanForest, revmanSpecFrom } from './revman-forest.mjs';
import { heterogeneityLine } from './figure-house-render.mjs';
import { forestOptions, ratioAxis, favoursOf } from './forest-options.mjs';
import { forestTable } from './analysis-charts.mjs';
import { funnelChart } from './charts.mjs';
import { funnelData } from './make-stats.mjs';
import { funnelInputs } from './diagnostics.mjs';
import { backOf } from './bias.mjs';
import { hasFigure, withFigure, figureMissing } from './figures.mjs';

export const PAGE_ROWS = 30;
const vec = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = x => (x == null || x === '' ? NaN : Number(x));

/**
 * What a result gives the paged plot, or null when it predates the per-study
 * numbers (drawn before this amendment) and only its R figure can be shown.
 * `{ rows, groups, overall, log, xLabel }`: rows in R's order with a study's
 * group; each group's pooled row; the overall row.
 */
export function forestData(a) {
  const est = vec(a?.study_est).map(num), lo = vec(a?.study_lo).map(num), hi = vec(a?.study_hi).map(num);
  const labels = vec(a?.labels);
  if (!est.length || est.length !== labels.length || lo.length !== est.length || hi.length !== est.length) return null;
  const percent = Boolean(a.derived);   // pooled proportions are drawn in percent, as R draws them
  const scale = percent ? 100 : 1;
  // drawn without its pooled estimate (RevMan's "no totals", or the forest's options set not pooled: lib/forest-options.mjs); subtotals off
  // keeps the subgroups as headings under the overall estimate
  const fo = a?.forest ? forestOptions(a.forest) : null, bare = a.totals === false || fo?.pool === false, subBare = bare || fo?.subtotals === false;
  const weights = bare ? [] : vec(a.weights).map(num), wMax = Math.max(0, ...weights.filter(Number.isFinite));
  const groupOf = a.mod_kind === 'group' || (bare && (a.modValues || a.levels)) ? vec(a.modValues ?? a.levels).map(v => (v == null || v === '' ? null : String(v))) : [];
  // each arm's events over its total, as columns, where the result keeps a two-arm table per study
  const values = vec(a.values), counted = !a.derived && fo?.events !== false && values.length === labels.length && values.every(v => Array.isArray(v) && v.length === 4);
  const rows = labels.map((label, i) => ({ label: String(label), value: est[i], lo: lo[i], hi: hi[i], row: i, index: i,
    weight: wMax > 0 && Number.isFinite(weights[i]) ? weights[i] / wMax : null, group: groupOf[i] ?? null, ...(counted ? { cells: { a: `${values[i][0]}/${values[i][1]}`, b: `${values[i][2]}/${values[i][3]}` } } : {}) }));
  const cols = counted ? [{ key: 'a', head: a.contrast?.treated || 'Intervention' }, { key: 'b', head: a.contrast?.control || 'Comparator' }] : [];
  // a comparison drawn without its pooled estimate (RevMan's "no totals"): its subgroups are headings over their studies, no diamonds
  const present = [...new Set(groupOf.filter(g => g != null))], order = vec(a.levelOrder).map(String);
  const levels = bare || !vec(a.mod_levels).length ? [...order.filter(l => present.includes(l)), ...present.filter(l => !order.includes(l))] : vec(a.mod_levels).map(String);
  const groups = levels.map((level, j) => ({ level, label: `${level} (k = ${(subBare ? null : vec(a.mod_k)[j]) ?? rows.filter(r => r.group === level).length})`, ...(subBare ? { bare: true } : {}),
    value: num(vec(a.mod_est)[j]) * scale, lo: num(vec(a.mod_lo)[j]) * scale, hi: num(vec(a.mod_hi)[j]) * scale }));
  const overall = { label: a.derived ? `${a.method || 'Pooled'} model` : `${a.method === 'EE' ? 'Common-effect' : a.method === 'MH' ? 'Mantel–Haenszel' : a.method === 'PETO' ? 'Peto' : 'Random-effects'} model`,
    value: num(a.estimate) * scale, lo: num(a.lo) * scale, hi: num(a.hi) * scale, pooled: true, row: -1 };
  const log = !a.derived && isRatio(a.measure);
  return { rows, groups, overall: bare ? null : overall, log, xLabel: percent ? `${a.outcomeName || 'Proportion'} (%)` : String(a.measure || ''), bare, cols, axis: log ? ratioAxis(fo?.axis) : null };
}

/** The rows in drawing order: each group's studies then its diamond, ungrouped studies first; `total` counts them. */
export function forestUnits(data) {
  const { rows, groups } = data;
  if (!groups.length) return rows.map(r => ({ ...r, group: null }));
  const out = [];
  const loose = rows.filter(r => r.group == null || !groups.some(g => g.level === r.group));
  out.push(...loose.map(r => ({ ...r, group: null })));
  for (const g of groups) {
    const mine = rows.filter(r => r.group === g.level);
    if (!mine.length) continue;
    out.push(...mine.map(r => ({ ...r, group: g.level })), ...(g.bare ? [] : [{ label: g.label, value: g.value, lo: g.lo, hi: g.hi, pooled: true, group: g.level, row: -1 }]));
  }
  return out;
}

/** Each study's share of the weight in percent, in R's order, from a result's `weights`; null without them. */
export function forestPercent(weights) {
  const w = vec(weights).map(num), sum = w.filter(v => Number.isFinite(v) && v > 0).reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map(v => (Number.isFinite(v) && v >= 0 ? 100 * v / sum : null)) : null;
}

/**
 * One page of the plot as SVG. With a `style` (figureTokens) the house forest (FIGURE-STYLE §2): column heads,
 * the weight column from `weights`, the heterogeneity line `het` under the overall row; `width` is used on screen
 * only (the export is a journal column). Without, today's drawing.
 */
export function forestPageSvg(data, { page = 1, size = PAGE_ROWS, width = 640, style = null, het = '', weights = null, source = [], title = '', favours = null } = {}) {
  // a forest drawn without pooling has no weights and no heterogeneity line, whatever the caller passes
  if (data.bare) { het = ''; weights = null; }
  const units = forestUnits(data), pages = Math.max(1, Math.ceil(units.length / size)), cur = Math.min(Math.max(1, page), pages);
  const note = pages > 1 ? `Studies ${(cur - 1) * size + 1}–${Math.min(units.length, cur * size)} of ${units.length}; the overall estimate is on every page` : '';
  if (style) {
    const pct = forestPercent(weights), rows = pct ? units.map(u => (u.index != null && Number.isFinite(pct[u.index]) ? { ...u, weightPct: pct[u.index] } : u)) : units;
    return { svg: forestSvg(rows, { style, width: style.medium === 'screen' ? width : undefined, title, measure: data.xLabel, log: data.log, offset: (cur - 1) * size, page: size,
      foot: data.overall, het, note, source, favours, cols: data.cols || [], axis: data.axis || null }), page: cur, pages, total: units.length };
  }
  return { svg: forestSvg(units, { width, xLabel: data.xLabel, log: data.log, offset: (cur - 1) * size, page: size, foot: data.overall, note }), page: cur, pages, total: units.length };
}

/** The source line of a forest under the figure: the outcome, the number of studies and the model. */
export const forestSource = a => [a?.outcomeName, a?.k != null ? `${a.k} ${a.derived ? 'arms' : a.k === 1 ? 'study' : 'studies'}` : '',
  a?.method ? `${{ EE: 'Common-effect', MH: 'Mantel–Haenszel', PETO: 'Peto' }[a.method] || `${a.method} random-effects`} model; squares sized by weight` : ''].filter(Boolean).join('; ');

/**
 * One page of the screen forest's rows (lib/analysis-charts.mjs forestTable), the same units as the print's page (forestUnits, `size` to a
 * page): studies under their subgroups' headings with each subgroup's diamond, then the overall diamond on every page; each study's weight in
 * percent and its arms' counts; a study row carries its record (`study(i)`) for the press. `{ rows, page, pages, total }`.
 */
export function forestScreenRows(data, a = {}, study = null, { page = 1, size = PAGE_ROWS } = {}) {
  const pct = data.bare ? null : forestPercent(a.weights), units = forestUnits(data), pages = Math.max(1, Math.ceil(units.length / size)), cur = Math.min(Math.max(1, page), pages);
  const row = r => { const id = study ? study(r.index) : null;
    return { label: r.label, est: r.value, lo: r.lo, hi: r.hi, ...(pct && Number.isFinite(pct[r.index]) ? { weight: pct[r.index] } : {}), ...(r.cells ? { cells: r.cells } : {}), attrs: id ? { 'data-idt-study': id } : {} }; };
  const rows = []; let group = null;
  for (const u of units.slice((cur - 1) * size, cur * size)) {
    if (u.group != null && u.group !== group) rows.push({ heading: u.group });
    group = u.group;
    rows.push(u.pooled ? { pooled: true, label: u.label, est: u.value, lo: u.lo, hi: u.hi } : row(u));
  }
  if (data.overall) rows.push({ pooled: true, label: data.overall.label, est: data.overall.value, lo: data.overall.lo, hi: data.overall.hi });
  return { rows, page: cur, pages, total: units.length };
}

/**
 * Draws the result's forest plot into the figure panel `#id` under `root` (made with figurePanel({ zoom: false }) when the result has its
 * per-study numbers): on screen the analysis table Make draws (lib/analysis-charts.mjs forestTable, plan §2, "Screen charts in Analysis",
 * 2026-10-24), fluid at the panel's width, thirty rows to a page with the overall estimate on every page, its rows opening their studies,
 * with the forest's options (lib/forest-options.mjs: pooled or not, subtotals, each arm's events, the axis, the favors labels); Download is
 * the print drawing of the same page, the house forest or RevMan Web's layout (whole) when the project's style assigns it. A result without
 * the per-study numbers shows its R figure. `study(i)` names the record of row i; `open(id)` opens it; `whole()` reads the R figure.
 */
export function mountForest(root, id, a, { study = null, open = null, whole = null, rSvg = null, filename = 'forest-plot', labels = null, style = figureTokens(null, { medium: 'screen' }), revman = null } = {}) {
  const data = forestData(a);
  const panel = root.querySelector('#' + id)?.closest('.panel');
  panel?.querySelector(`#${id}-pager`)?.remove();
  if (!data) { if (rSvg) showFigure(root, id, rSvg, filename, { labels, study, open }); return false; }
  const fo = a.forest ? forestOptions(a.forest) : null, revmanStyle = style?.id === 'asd-revman';
  const favours = a.favours?.length === 2 ? a.favours : fo?.favours || (a.contrast && data.log ? favoursOf(a.contrast.treated, a.contrast.control) : null);
  const cols = (data.cols || []).map(c => ({ ...c, keep: 2 }));
  const pct = Boolean(a.derived) && !data.log, fmt = data.log ? null : pct ? (v => (Number.isFinite(v) ? `${v.toFixed(2)}%` : '')) : null;
  const title = `Forest plot${a.outcomeName ? `: ${a.outcomeName}` : ''}`;
  // a narrow panel names the overall row by its role: "Random-effects model" cut short says less than "Overall"
  const narrowed = (rows, w) => (w >= 560 || !data.overall ? rows : rows.map((r, i) => (i === rows.length - 1 && r.pooled ? { ...r, label: 'Overall' } : r)));
  let page = 1;
  const draw = () => {
    const p = forestScreenRows(data, a, study, { page });
    page = p.page;
    const chart = w => forestTable(narrowed(p.rows, w), { width: w, log: data.log, ref: data.log ? 1 : pct ? null : 0, ...(fmt ? { fmt } : {}), xLabel: data.xLabel, favours, cols, axis: data.axis, title });
    // the print: RevMan Web's layout (preset asd-revman) with the forest's options, else this page of the house forest for a journal column
    const exportSvg = revmanStyle
      ? () => revmanForest(revmanSpecFrom(a, { ...(revman || {}), ...(fo && !fo.pool ? { pooled: false } : {}), ...(fo?.axis ? { scale: Number(fo.axis) } : {}), ...(fo?.favours ? { favours: fo.favours } : {}) }))
      : () => forestPageSvg(data, { page, style: figureTokens(null, { medium: 'export', profile: style?.id }), het: a.totals === false ? '' : heterogeneityLine(a),
        weights: a.totals === false ? null : a.weights, title, favours: a.favours?.length === 2 ? a.favours : null, source: [forestSource(a)] }).svg;
    showChart(root, id, chart, revmanStyle ? `${filename}-revman` : filename, { open, whole, exportSvg, data: () => forestCsv(data, a) });
    panel?.querySelector(`#${id}-pager`)?.remove();
    if (p.pages > 1) {
      panel?.insertAdjacentHTML('beforeend', pager({ id: `${id}-pager`, page: p.page, pages: p.pages, total: p.total, label: 'rows', size: PAGE_ROWS }).replace('class="pager"', 'class="pager figure-pager"'));
      wirePager(panel, `${id}-pager`, n => { page = n; draw(); });
    }
  };
  draw();
  return true;
}

/** Whether a result has a funnel plot to show: one R drew with it (kept inline or by hash, lib/figures.mjs); the screen draws it again. */
export const hasFunnel = a => hasFigure(a, 'funnel');

/**
 * Draws the result's funnel plot into the figure panel `#id`: on screen Make's funnel (lib/charts.mjs funnelChart over
 * lib/diagnostics.mjs funnelInputs), each point opening its study (`study(i)`, `open(id)`); Download is the print, R's figure where the
 * result kept one (lib/figures.mjs), else the chart. A result without its effects shows R's figure, or says it is missing.
 */
export function mountFunnel(root, id, a, { study = null, open = null, filename = 'funnel-plot' } = {}) {
  const f = funnelInputs(a, backOf(a?.measure) || (x => x));
  if (!f) { withFigure(a, 'funnel', svg => showFigure(root, id, svg, filename, { open }), () => figureMissing(root, id)); return false; }
  let print = typeof a.funnel === 'string' ? a.funnel : null;
  if (!print && hasFigure(a, 'funnel')) withFigure(a, 'funnel', svg => { print = svg; });
  const fd = funnelData(f.yi, f.vi, f.mu);
  const fmtX = f.percent ? (v => `${v.toFixed(1)}%`) : (v => v.toFixed(2));
  const xLabel = f.percent ? `${a.outcomeName || 'Proportion'} (%)` : String(a.measure || '');
  const draw = w => { const cw = Math.min(w, 640);
    return funnelChart(fd, { width: cw, height: Math.max(220, Math.min(420, Math.round(cw * 0.7))), title: `Funnel plot${a.outcomeName ? `: ${a.outcomeName}` : ''}`, xLabel,
      labels: f.labels, show: f.back, fmtX, attrsOf: i => { const pid = study ? study(i) : null; return pid ? { 'data-idt-study': pid } : {}; } }); };
  showChart(root, id, draw, filename, { open, exportSvg: () => print || draw(640) });
  return true;
}

/** The plot's numbers as rows for a CSV: study, estimate, interval and weight, then the pooled rows. */
export function forestCsv(data, a = {}) {
  const pct = forestPercent(a.weights), head = [['Study', 'Estimate', 'Lower', 'Upper', 'Weight (%)']];
  const row = (r, w = '') => [r.label, r.value, r.lo, r.hi, w];
  return [...head, ...data.rows.map(r => row(r, pct?.[r.index] != null ? Number(pct[r.index].toFixed(2)) : '')), ...data.groups.filter(g => !g.bare).map(g => row(g)), ...(data.overall ? [row(data.overall, pct ? 100 : '')] : [])];
}

/** The house drawing app/lint-figures.mjs checks: a paged forest with weights and heterogeneity. */
export const __fixture = style => {
  const a = { labels: ['A 2015', 'B 2016', 'C 2017'], study_est: [1.2, 0.8, 1.9], study_lo: [0.7, 0.4, 1.1], study_hi: [2.1, 1.6, 3.3], weights: [30, 50, 20], measure: 'OR', method: 'REML', estimate: 1.15, lo: 0.7, hi: 1.9, i2: 12, tau2: 0.01, q: 2.3, qp: 0.31, k: 3 };
  return [{ name: 'forestPageSvg', svg: forestPageSvg(forestData(a), { style, size: 2, het: heterogeneityLine(a), weights: a.weights, source: [forestSource(a)] }).svg }];
};
