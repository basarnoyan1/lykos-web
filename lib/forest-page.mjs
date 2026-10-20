// The forest plot on screen, one page at a time (plan §4.6, review amendment
// of 2026-09-29). R draws the publication figure in full; a review of sixty
// arms gave a drawing 1,458 px tall that fitted the window at a third of its
// size, unreadable. The screen copy is drawn here from the same numbers the
// result keeps — each study's back-transformed estimate and interval, the
// subgroup and overall estimates — thirty rows to a page with the subgroup
// diamonds where R places them and the overall estimate under every page. The
// R figure stays the download and the bundle's copy.
import { forestSvg } from './output-charts.mjs';
import { isRatio } from './effect-measures.mjs';
import { pager, wirePager } from './paging.mjs';
import { showFigure } from './figure.mjs';
import { figureTokens } from './figure-style.mjs';
import { revmanForest, revmanSpecFrom } from './revman-forest.mjs';
import { heterogeneityLine } from './figure-house-render.mjs';

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
  const bare = a.totals === false;
  const weights = bare ? [] : vec(a.weights).map(num), wMax = Math.max(0, ...weights.filter(Number.isFinite));
  const groupOf = a.mod_kind === 'group' || (a.totals === false && a.modValues) ? vec(a.modValues ?? a.levels).map(v => (v == null || v === '' ? null : String(v))) : [];
  const rows = labels.map((label, i) => ({ label: String(label), value: est[i], lo: lo[i], hi: hi[i], row: i, index: i,
    weight: wMax > 0 && Number.isFinite(weights[i]) ? weights[i] / wMax : null, group: groupOf[i] ?? null }));
  // a comparison drawn without its pooled estimate (RevMan's "no totals"): its subgroups are headings over their studies, no diamonds
  const present = [...new Set(groupOf.filter(g => g != null))], order = vec(a.levelOrder).map(String);
  const levels = bare ? [...order.filter(l => present.includes(l)), ...present.filter(l => !order.includes(l))] : vec(a.mod_levels).map(String);
  const groups = levels.map((level, j) => ({ level, label: `${level} (k = ${(bare ? null : vec(a.mod_k)[j]) ?? rows.filter(r => r.group === level).length})`, ...(bare ? { bare } : {}),
    value: num(vec(a.mod_est)[j]) * scale, lo: num(vec(a.mod_lo)[j]) * scale, hi: num(vec(a.mod_hi)[j]) * scale }));
  const overall = { label: a.derived ? `${a.method || 'Pooled'} model` : `${a.method === 'EE' ? 'Common-effect' : a.method === 'MH' ? 'Mantel–Haenszel' : a.method === 'PETO' ? 'Peto' : 'Random-effects'} model`,
    value: num(a.estimate) * scale, lo: num(a.lo) * scale, hi: num(a.hi) * scale, pooled: true, row: -1 };
  return { rows, groups, overall: bare ? null : overall, log: !a.derived && isRatio(a.measure), xLabel: percent ? `${a.outcomeName || 'Proportion'} (%)` : String(a.measure || '') };
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
  const units = forestUnits(data), pages = Math.max(1, Math.ceil(units.length / size)), cur = Math.min(Math.max(1, page), pages);
  const note = pages > 1 ? `Studies ${(cur - 1) * size + 1}–${Math.min(units.length, cur * size)} of ${units.length}; the overall estimate is on every page` : '';
  if (style) {
    const pct = forestPercent(weights), rows = pct ? units.map(u => (u.index != null && Number.isFinite(pct[u.index]) ? { ...u, weightPct: pct[u.index] } : u)) : units;
    return { svg: forestSvg(rows, { style, width: style.medium === 'screen' ? width : undefined, title, measure: data.xLabel, log: data.log, offset: (cur - 1) * size, page: size,
      foot: data.overall, het, note, source, favours }), page: cur, pages, total: units.length };
  }
  return { svg: forestSvg(units, { width, xLabel: data.xLabel, log: data.log, offset: (cur - 1) * size, page: size, foot: data.overall, note }), page: cur, pages, total: units.length };
}

/** The source line of a forest under the figure: the outcome, the number of studies and the model. */
export const forestSource = a => [a?.outcomeName, a?.k != null ? `${a.k} ${a.derived ? 'arms' : a.k === 1 ? 'study' : 'studies'}` : '',
  a?.method ? `${{ EE: 'Common-effect', MH: 'Mantel–Haenszel', PETO: 'Peto' }[a.method] || `${a.method} random-effects`} model; squares sized by weight` : ''].filter(Boolean).join(' · ');

/**
 * Draws the result's forest plot into the figure panel `#id` under `root`, a
 * page at a time with a pager under the panel, or the R figure when the result
 * has no per-study numbers. `study(i)` names the record of row i; `open(id)`
 * opens it; `whole()` reads the R figure for download.
 */
export function mountForest(root, id, a, { study = null, open = null, whole = null, rSvg = null, filename = 'forest-plot', labels = null, style = figureTokens(null, { medium: 'screen' }), revman = null } = {}) {
  const data = forestData(a);
  const panel = root.querySelector('#' + id)?.closest('.panel');
  panel?.querySelector(`#${id}-pager`)?.remove();
  if (!data) { if (rSvg) showFigure(root, id, rSvg, filename, { labels, study, open }); return false; }
  // the RevMan Web layout (preset asd-revman): one unpaged figure over the same statistics, the export the same drawing
  if (style?.id === 'asd-revman') {
    const svg = revmanForest(revmanSpecFrom(a, revman || {}));
    showFigure(root, id, svg, `${filename}-revman`, { open, whole, exportSvg: () => svg, data: () => forestCsv(data, a) });
    return true;
  }
  for (const r of data.rows) r.study = study ? study(r.index) : null;
  let page = 1;
  const draw = () => {
    // a comparison names its two sides under the axis; one drawn without its pooled estimate has no heterogeneity line and no weights
    const house = { het: a.totals === false ? '' : heterogeneityLine(a), weights: a.totals === false ? null : a.weights, title: `Forest plot${a.outcomeName ? ` · ${a.outcomeName}` : ''}`, favours: a.favours?.length === 2 ? a.favours : null };
    const p = forestPageSvg(data, { page, width: Math.max(560, Math.min(760, (panel?.clientWidth || 700) - 32)), style, ...house });
    page = p.page;
    // the download is the same page drawn for print: a journal column in pt, with its source line
    const exportStyle = style ? figureTokens(null, { medium: 'export', profile: style.id }) : null;
    const exportSvg = exportStyle ? () => forestPageSvg(data, { page, style: exportStyle, ...house, source: [forestSource(a)] }).svg : null;
    showFigure(root, id, p.svg, filename, { open, whole, exportSvg, data: () => forestCsv(data, a) });
    panel?.querySelector(`#${id}-pager`)?.remove();
    if (p.pages > 1) {
      panel?.insertAdjacentHTML('beforeend', pager({ id: `${id}-pager`, page: p.page, pages: p.pages, total: p.total, label: 'rows', size: PAGE_ROWS }).replace('class="pager"', 'class="pager figure-pager"'));
      wirePager(panel, `${id}-pager`, n => { page = n; draw(); });
    }
  };
  draw();
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
