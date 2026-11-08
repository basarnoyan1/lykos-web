// The analysis charts on screen (owner, 2026-10-23: "you don't have to show the print aligned versions of the graphs … make it a much more
// professional analysis thing"): one system for Make (views/make-*.mjs) and the Data summary, as a results pane draws them (JASP, RevMan
// Web, a Stata graph window), not as a printed figure. Each fills the width it is given, fluidly, with no floor and nothing scrolling
// inside: the forest as an analysis table (study, weight bar, the plot taking the free width, the effect as text on the right), leave-one-out
// as a compact row per study, the Kaplan–Meier curve with its number at risk aligned to the axis, the harvest plot, and a lane per patient.
// Type is the page's (the svg inherits Geist at 12 px, lib/charts.mjs svg()), gridlines are --line, ink and hues the app's tokens through the
// classes research-views.css colours (.c-ink, .c-mute, .c-grid, .c-axis, .c-band, .c-cat0…4, .c-ln0…4, .c-out). Ticks are chosen for the
// width, so labels never overlap; a long name is cut with an ellipsis and whole in the tooltip; every mark names its study on hover and
// carries the view's hooks (`attrs`) to open it. The print drawings (lib/forest-page.mjs, lib/stat-plots-house.mjs, lib/survival-house.mjs,
// lib/swim.mjs) stay what Keep and Add to Tables and figures export. app/test/analysis-charts.test.mjs holds the layout.
import { textWidth } from './textwidth.mjs';

const FS = 12, FONT = 'inherit', INK = '#000', AXIS = '#555', GRID = '#e3e3e3', BAR = '#8f8f8f';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = x => (Math.round(x * 10) / 10).toString();
const attrsOf = a => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" role="img" aria-label="${esc(title)}" font-family="${FONT}" font-size="${FS}"><title>${esc(title)}</title>${body}</svg>`;
/** A text cut to `maxW` with an ellipsis. */
export function clip(text, maxW, fs = FS) {
  const t = String(text ?? '');
  if (textWidth(t, fs) <= maxW) return t;
  let s = t;
  while (s.length > 1 && textWidth(s + '…', fs) > maxW) s = s.slice(0, -1);
  return s + '…';
}
const fmtN = v => (!Number.isFinite(v) ? '' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));
const ROW = 22, HEAD = 20;

/**
 * Tick values that fit a plot of `plotW` pixels: round steps on a linear scale, powers of two on a log one (`log`), thinned until the widest
 * label and a gap fit between neighbours. `fmt` writes a tick. Answers [{ v, text }].
 */
export function ticksFor(lo, hi, plotW, { log = false, fmt = fmtN } = {}) {
  if (!(hi > lo) || !(plotW > 0)) return [];
  let ticks;
  if (log) { const a = Math.ceil(Math.log2(lo) - 1e-9), b = Math.floor(Math.log2(hi) + 1e-9); ticks = []; for (let e = a; e <= b; e++) ticks.push(2 ** e); if (ticks.length < 2) ticks = [lo, hi]; }
  else {
    const n = Math.max(2, Math.min(8, Math.floor(plotW / 56))), raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p, step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    ticks = []; for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 1e9) / 1e9);
  }
  const X = v => (log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo)) * plotW;
  const fits = list => list.every((t, i) => i === 0 || X(t) - X(list[i - 1]) >= (textWidth(fmt(t), FS) + textWidth(fmt(list[i - 1]), FS)) / 2 + 8);
  while (ticks.length > 2 && !fits(ticks)) ticks = ticks.filter((_, i) => i % 2 === 0 || i === ticks.length - 1).filter((t, i, a) => i === 0 || X(t) - X(a[i - 1]) > 1);
  if (ticks.length === 2 && !fits(ticks)) ticks = [ticks[0]];
  return ticks.map(v => ({ v, text: fmt(v) }));
}

// the weight column: a 32 px bar, then its percent right-aligned in the 44 px after it ("100.0%" at 12 px)
const WBAR = 32, WPCT = 44, WCOL = WBAR + WPCT;
/**
 * The forest as an analysis table: `rows` in drawing order, each { label, est, lo, hi, weight (percent), cells, attrs, tip } for a study,
 * { heading } for a subgroup's name, { pooled: true, label, est, lo, hi } for a diamond. `log` draws a ratio scale; `ref` the line of no
 * effect (null for a proportion); `fmt` writes an estimate; `xLabel` the axis name; `favours` [left, right] under the axis, either side of
 * the null line; `cols` [{ key, head, keep }] text columns between the name and the plot (events over the total of each arm, the follow-up), a
 * study's text in its `cells[key]`; `axis` { lo, hi, ticks } a set axis (lib/forest-options.mjs ratioAxis), an interval past it ending in
 * an arrow. A forest drawn without pooling has no diamond and no weights: its rows carry none.
 */
// a ratio is written with two decimals and a weight with one, as a printed forest has them (0.40, 62.0%)
export function forestTable(rows, { width = 600, log = false, ref = null, fmt = log ? (x => (Number.isFinite(x) ? x.toFixed(2) : '')) : fmtN, xLabel = '', favours = null, title = 'Forest plot', cols = [], axis = null } = {}) {
  const w = Math.max(280, width), studies = rows.filter(r => !r.heading);
  const G = 12, okR = r => [r.est, r.lo, r.hi].every(Number.isFinite) && (!log || r.lo > 0), full = r => (okR(r) ? `${fmt(r.est)} (${fmt(r.lo)} to ${fmt(r.hi)})` : 'Not estimable');
  // the columns: the plot takes what the label, the text columns, the weight bar and the effect text leave; a narrow box drops the weight
  // bar, then the text columns from the last, then shortens the effect to its estimate
  let effect = full, weighted = studies.some(r => Number.isFinite(r.weight)), labelW = Math.min(Math.round(w * 0.32), Math.max(60, ...rows.map(r => textWidth(r.label || r.heading || '', FS) + 6)));
  const colW = c => Math.min(140, Math.max(textWidth(c.head, FS), ...studies.map(r => textWidth(r.cells?.[c.key] ?? '', FS))) + G);
  let shown = cols.filter(c => studies.some(r => r.cells?.[c.key] != null && r.cells[c.key] !== ''));
  const colsW = () => shown.reduce((a, c) => a + colW(c), 0);
  const effWOf = () => Math.max(textWidth(effect === full ? 'Effect (95% CI)' : 'Effect', FS), ...studies.map(r => textWidth(effect(r), FS))) + 8;
  const plotWOf = () => w - labelW - colsW() - (weighted ? WCOL : 0) - effWOf() - G * (weighted ? 3 : 2);
  if (plotWOf() < 120) weighted = false;
  // a column's `keep` ranks it (the lowest goes first, columns of one rank together: an arm's events never stand without the other's)
  while (plotWOf() < 120 && shown.length) { const low = Math.min(...shown.map((c, i) => c.keep ?? i)); shown = shown.filter((c, i) => (c.keep ?? i) !== low); }
  if (plotWOf() < 120) { labelW = Math.min(labelW, Math.round(w * 0.24)); effect = r => (okR(r) ? fmt(r.est) : 'NE'); }
  const effW = effWOf(), plotW = Math.max(80, plotWOf()), cx0 = labelW + G, x0 = cx0 + colsW(), wX = x0 + plotW + G, effX = w;
  const vals = studies.flatMap(r => [r.lo, r.hi, r.est]).filter(v => Number.isFinite(v) && (!log || v > 0)).concat(ref != null && (!log || ref > 0) ? [ref] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (!(hi > lo)) { lo = log ? lo / 2 : lo - 1; hi = log ? hi * 2 : hi + 1; }
  if (!log) { const pad = (hi - lo) * 0.04; lo -= pad; hi += pad; if (ref == null && lo < 0 && Math.min(...vals) >= 0) lo = 0; }
  if (axis && axis.hi > axis.lo && (!log || axis.lo > 0)) { lo = axis.lo; hi = axis.hi; }
  const X = v => x0 + plotW * (log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo));
  const ticks = axis?.ticks ? axis.ticks.filter(v => v >= lo && v <= hi).map(v => ({ v, text: String(Number(v)) })) : ticksFor(lo, hi, plotW, { log, fmt: v => fmtN(v) });
  const h = HEAD + rows.length * ROW + 28 + (favours ? 18 : 0), parts = [];
  parts.push(`<text x="0" y="14" class="c-ink" fill="${INK}" font-weight="600">Study</text>`, weighted ? `<text x="${x0 + plotW + G}" y="14" class="c-mute" fill="${AXIS}">Weight</text>` : '',
    `<text x="${effX}" y="14" text-anchor="end" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(effect === full ? (xLabel ? `${xLabel} (95% CI)` : 'Effect (95% CI)') : (xLabel || 'Effect'), effW + (weighted ? 0 : G)))}</text>`,
    `<line x1="0" y1="${HEAD}" x2="${w}" y2="${HEAD}" stroke="${AXIS}" class="c-axis"/>`);
  // the text columns: each head and value right-aligned on the column's end, as a table of counts reads
  const colEnds = []; let cx = cx0;
  for (const c of shown) { cx += colW(c); colEnds.push(cx - G); }
  shown.forEach((c, j) => parts.push(`<text x="${f1(colEnds[j])}" y="14" text-anchor="end" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(c.head, colW(c) - G / 2))}<title>${esc(c.head)}</title></text>`));
  const top = HEAD + 2, bottom = HEAD + rows.length * ROW + 2;
  for (const t of ticks) parts.push(`<line x1="${f1(X(t.v))}" y1="${top}" x2="${f1(X(t.v))}" y2="${bottom}" stroke="${GRID}" class="c-grid"/>`);
  if (ref != null && ref > lo && ref < hi) parts.push(`<line x1="${f1(X(ref))}" y1="${top}" x2="${f1(X(ref))}" y2="${bottom}" stroke="${AXIS}" class="c-axis"/>`);
  const wMax = Math.max(1, ...studies.map(r => r.weight || 0));
  rows.forEach((r, i) => {
    const y = HEAD + i * ROW, cy = y + ROW / 2;
    if (r.heading) { parts.push(`<text x="0" y="${cy + 4}" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(r.heading, labelW + colsW()))}</text>`); return; }
    const name = clip(r.label, labelW), tip = r.tip || `${r.label}: ${full(r)}${Number.isFinite(r.weight) ? `, weight ${f1(r.weight)}%` : ''}`;
    const inside = v => Math.max(lo, Math.min(hi, v)), xl = X(inside(r.lo)), xh = X(inside(r.hi)), xe = X(inside(r.est));
    // a study's square is sized by its weight; without pooling every study has the same mark
    const half = Number.isFinite(r.weight) ? 3 + 3 * Math.sqrt(r.weight / wMax) : 4;
    const body = !okR(r) ? '' : r.pooled
      ? `<path d="M ${f1(xl)} ${cy} L ${f1(xe)} ${cy - 6} L ${f1(xh)} ${cy} L ${f1(xe)} ${cy + 6} Z" class="c-diamond" fill="${INK}"/>`
      : `<line x1="${f1(xl)}" y1="${cy}" x2="${f1(xh)}" y2="${cy}" stroke="${INK}" class="c-ci"/>${r.lo < lo ? `<path d="M ${f1(xl + 5)} ${cy - 4} L ${f1(xl)} ${cy} L ${f1(xl + 5)} ${cy + 4}" fill="none" stroke="${INK}" class="c-ci"/>` : ''}${r.hi > hi ? `<path d="M ${f1(xh - 5)} ${cy - 4} L ${f1(xh)} ${cy} L ${f1(xh - 5)} ${cy + 4}" fill="none" stroke="${INK}" class="c-ci"/>` : ''}`
        + (r.est >= lo && r.est <= hi ? `<rect x="${f1(xe - half)}" y="${f1(cy - half)}" width="${f1(2 * half)}" height="${f1(2 * half)}" class="c-mark" fill="${INK}"/>` : '');
    // the weight as the printed forest gives it, a percent beside its bar (owner, 2026-10-23); the pooled row is the whole, 100%
    const pct = v => `<text x="${wX + WBAR + WPCT}" y="${cy + 4}" text-anchor="end" class="c-mute" fill="${AXIS}" font-variant-numeric="tabular-nums">${Number(v).toFixed(1)}%</text>`;
    const weight = !weighted ? '' : r.pooled ? pct(100)
      : Number.isFinite(r.weight) ? `<rect x="${wX}" y="${cy - 4}" width="${WBAR}" height="8" rx="2" class="c-track" fill="${GRID}"/><rect x="${wX}" y="${cy - 4}" width="${f1(WBAR * r.weight / 100)}" height="8" rx="2" class="c-bar" fill="${BAR}"/>${pct(r.weight)}` : '';
    const cells = shown.map((c, j) => (r.cells?.[c.key] == null ? '' : `<text x="${f1(colEnds[j])}" y="${cy + 4}" text-anchor="end" class="c-mute" fill="${AXIS}" font-variant-numeric="tabular-nums">${esc(clip(String(r.cells[c.key]), colW(c) - G / 2))}</text>`)).join('');
    parts.push(`<g data-chart-mark="r${i}"${attrsOf(r.attrs)} class="c-study${r.pooled ? ' c-pooled' : ''}"><title>${esc(tip)}</title><rect x="0" y="${y}" width="${w}" height="${ROW}" class="c-lane" fill="transparent"/>`,
      `<text x="0" y="${cy + 4}" class="c-ink" fill="${INK}"${r.pooled ? ' font-weight="600"' : ''}>${esc(name)}</text>${cells}${body}${weight}`,
      `<text x="${effX}" y="${cy + 4}" text-anchor="end" class="${r.pooled ? 'c-ink' : 'c-mute'}" fill="${r.pooled ? INK : AXIS}"${r.pooled ? ' font-weight="600"' : ''}>${esc(effect(r))}</text></g>`);
  });
  parts.push(`<line x1="${x0}" y1="${bottom}" x2="${x0 + plotW}" y2="${bottom}" stroke="${AXIS}" class="c-axis"/>`);
  for (const t of ticks) parts.push(`<text x="${f1(X(t.v))}" y="${bottom + 14}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(t.text)}</text>`);
  if (favours) {
    // either side of the null line, as RevMan sets them; at the plot's ends when there is no null line on it
    const zx = ref != null && ref > lo && ref < hi ? X(ref) : null;
    parts.push(zx == null ? `<text x="${f1(x0)}" y="${bottom + 32}" class="c-mute" fill="${AXIS}">${esc(clip(favours[0], plotW / 2 - 6))}</text>` : `<text x="${f1(zx - 6)}" y="${bottom + 32}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(clip(favours[0], zx - 6))}</text>`,
      zx == null ? `<text x="${f1(x0 + plotW)}" y="${bottom + 32}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(clip(favours[1], plotW / 2 - 6))}</text>` : `<text x="${f1(zx + 6)}" y="${bottom + 32}" class="c-mute" fill="${AXIS}">${esc(clip(favours[1], w - zx - 6))}</text>`);
  }
  return svg(w, h, parts.join(''), title);
}

/**
 * The rows of a forest from a pooled result (lib/meta-pool.mjs, meta-contrast.mjs, meta-general.mjs): studies under their subgroups' names
 * and diamonds, then the overall diamond. `groups` each study's subgroup (in `order`, else the fit's levels, else as they come); `pool`
 * false draws the studies alone (no diamond, no weight); `subtotals` false keeps the headings without their diamonds; `cells(i)` a study's
 * text columns.
 */
export function forestRows(fit, labels, { scale = v => v, pooledScale = scale, groups = null, order = null, attrs = () => ({}), overallLabel = 'Pooled', pool = true, subtotals = true, cells = () => undefined } = {}) {
  // scale: the studies' estimates (study_est as the pool gives them); pooledScale: the diamonds' (a proportion's overall and subgroup estimates come as shares, its studies in percent)
  const study = i => ({ label: labels[i], est: scale(fit.study_est[i]), lo: scale(fit.study_lo[i]), hi: scale(fit.study_hi[i]), ...(pool ? { weight: fit.weights?.[i] } : {}), cells: cells(i), attrs: attrs(i) });
  const all = labels.map((_, i) => i), out = [];
  const levels = groups ? (order || (fit.mod_kind === 'group' ? fit.mod_levels : null) || [...new Set(groups.filter(g => g != null))]) : null;
  if (levels?.length) {
    levels.forEach(lv => { const mine = all.filter(i => groups[i] === lv); if (!mine.length) return;
      const j = fit.mod_kind === 'group' ? (fit.mod_levels || []).indexOf(lv) : -1;
      out.push({ heading: lv }, ...mine.map(study), ...(pool && subtotals && j >= 0 ? [{ pooled: true, label: `${lv} (k = ${mine.length})`, est: pooledScale(fit.mod_est[j]), lo: pooledScale(fit.mod_lo[j]), hi: pooledScale(fit.mod_hi[j]) }] : [])); });
    const loose = all.filter(i => !levels.includes(groups[i]));
    if (loose.length) out.push(...loose.map(study));
  } else out.push(...all.map(study));
  if (pool) out.push({ pooled: true, label: overallLabel, est: pooledScale(fit.estimate), lo: pooledScale(fit.lo), hi: pooledScale(fit.hi) });
  return out;
}

/**
 * Leave-one-out: one row per study, the pooled estimate without it on a line with its interval, the full pooled value as a reference line
 * and its interval as a band; a row whose omission moves the estimate outside the full interval is marked (`c-out`). `rows` [{ label, est,
 * lo, hi, attrs }], `full` { est, lo, hi }.
 */
export function looChart(rows, { width = 600, full, log = false, fmt = fmtN, xLabel = '', title = 'Leave-one-out' } = {}) {
  const w = Math.max(280, width), labelW = Math.min(Math.round(w * 0.32), Math.max(60, ...rows.map(r => textWidth(r.label, FS) + 6)));
  const effW = Math.max(...rows.map(r => textWidth(fmt(r.est), FS))) + 8, G = 12, x0 = labelW + G, plotW = Math.max(80, w - labelW - effW - 2 * G);
  const vals = [...rows.flatMap(r => [r.lo, r.hi, r.est]), full.lo, full.hi, full.est].filter(v => Number.isFinite(v) && (!log || v > 0));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (!(hi > lo)) { lo = log ? lo / 2 : lo - 1; hi = log ? hi * 2 : hi + 1; }
  if (!log) { const pad = (hi - lo) * 0.06; lo -= pad; hi += pad; }
  const X = v => x0 + plotW * (log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo));
  const ticks = ticksFor(lo, hi, plotW, { log }), top = HEAD, bottom = HEAD + rows.length * ROW + 2, h = bottom + 30, parts = [];
  parts.push(`<text x="0" y="14" class="c-ink" fill="${INK}" font-weight="600">Without</text>`, `<text x="${w}" y="14" text-anchor="end" class="c-ink" fill="${INK}" font-weight="600">${esc(xLabel || 'Pooled')}</text>`,
    `<rect x="${f1(X(full.lo))}" y="${top}" width="${f1(X(full.hi) - X(full.lo))}" height="${bottom - top}" class="c-band" fill="${GRID}"/>`,
    `<line x1="${f1(X(full.est))}" y1="${top}" x2="${f1(X(full.est))}" y2="${bottom}" stroke="${AXIS}" stroke-dasharray="3 3" class="c-axis"/>`);
  for (const t of ticks) parts.push(`<line x1="${f1(X(t.v))}" y1="${top}" x2="${f1(X(t.v))}" y2="${bottom}" stroke="${GRID}" class="c-grid"/>`);
  rows.forEach((r, i) => { const y = HEAD + i * ROW, cy = y + ROW / 2, out = r.est < full.lo || r.est > full.hi;
    parts.push(`<g data-chart-mark="l${i}"${attrsOf(r.attrs)} class="c-study${out ? ' c-out' : ''}"><title>${esc(`Without ${r.label}: ${fmt(r.est)} (${fmt(r.lo)} to ${fmt(r.hi)})${out ? ', outside the full interval' : ''}`)}</title><rect x="0" y="${y}" width="${w}" height="${ROW}" class="c-lane" fill="transparent"/>`,
      `<text x="0" y="${cy + 4}" class="c-ink" fill="${INK}">${esc(clip(r.label, labelW))}</text><line x1="${f1(X(r.lo))}" y1="${cy}" x2="${f1(X(r.hi))}" y2="${cy}" stroke="${INK}" class="c-ci"/><rect x="${f1(X(r.est) - 4)}" y="${cy - 4}" width="8" height="8" class="c-mark" fill="${INK}"/>`,
      `<text x="${w}" y="${cy + 4}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(fmt(r.est))}</text></g>`); });
  parts.push(`<line x1="${x0}" y1="${bottom}" x2="${x0 + plotW}" y2="${bottom}" stroke="${AXIS}" class="c-axis"/>`);
  for (const t of ticks) parts.push(`<text x="${f1(X(t.v))}" y="${bottom + 14}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(t.text)}</text>`);
  return svg(w, h, parts.join(''), title);
}

/**
 * The Kaplan–Meier curves with the number at risk under the axis, aligned to its ticks: `km.by` [{ group, steps: [{ time, surv, lo, hi,
 * nEvent, nCensor }], atRisk: [{ time, n }], n }]; `times` the ticks (and the at-risk times); `p` the log-rank p for the corner; `band` draws
 * the interval of a lone group; `xMax` ends the axis there, the curves cut at it.
 */
export function kmChart(km, { width = 600, times = [], xLabel = 'Months', p = null, title = 'Kaplan–Meier', band = true, xMax = null } = {}) {
  const cut = Number(xMax) > 0 ? Number(xMax) : null;
  const w = Math.max(280, width), groups = km.by.map(g => (cut ? { ...g, steps: (g.steps || []).filter(st => st.time <= cut) } : g)).filter(g => g.steps?.length), R = 12, T = 8;
  const plotH = Math.max(160, Math.min(320, Math.round(w * 0.45))), labelW = Math.min(Math.round(w * 0.25), Math.max(40, ...groups.map(g => textWidth(g.group, FS) + 8)));
  const L = Math.max(36, labelW + 18);   // the axis starts after the group names of the at-risk table, so their numbers stand under the ticks
  const riskTop = T + plotH + 40, h = riskTop + 18 + groups.length * 16 + 4, maxT = cut ?? Math.max(...times, ...groups.map(g => g.steps.at(-1).time)), plotW = w - L - R;
  const X = t => L + plotW * t / (maxT || 1), Y = s => T + plotH * (1 - s), parts = [];
  for (const s of [0, 0.25, 0.5, 0.75, 1]) parts.push(`<line x1="${L}" y1="${f1(Y(s))}" x2="${w - R}" y2="${f1(Y(s))}" stroke="${GRID}" class="c-grid"/><text x="${L - 6}" y="${f1(Y(s) + 4)}" text-anchor="end" class="c-mute" fill="${AXIS}">${s}</text>`);
  const ticks = times.filter(t => t <= maxT), riskX = [...ticks];
  for (const t of ticks) parts.push(`<text x="${f1(X(t))}" y="${T + plotH + 16}" text-anchor="middle" class="c-mute" fill="${AXIS}">${t}</text>`);
  parts.push(`<line x1="${L}" y1="${T + plotH}" x2="${w - R}" y2="${T + plotH}" stroke="${AXIS}" class="c-axis"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" stroke="${AXIS}" class="c-axis"/>`,
    `<text x="${f1(L + plotW / 2)}" y="${T + plotH + 34}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  if (p != null) parts.push(`<text x="${w - R}" y="${T + 12}" text-anchor="end" class="c-mute" fill="${AXIS}">${esc(`Log-rank p ${p < 0.001 ? '< 0.001' : '= ' + p.toFixed(3)}`)}</text>`);
  groups.forEach((g, gi) => {
    const pts = [[0, 1], ...g.steps.flatMap(s => [[s.time, null], [s.time, s.surv]])];   // a step: across at the old level, then down
    let last = 1; const d = pts.map(([t, s], i) => { if (s == null) return `L ${f1(X(t))} ${f1(Y(last))}`; last = s; return `${i ? 'L' : 'M'} ${f1(X(t))} ${f1(Y(s))}`; }).join(' ');
    if (band && groups.length === 1) { const up = g.steps.filter(s => s.hi != null), lo = [...up].reverse(); if (up.length)
      parts.push(`<path d="M ${f1(X(0))} ${f1(Y(1))} ${up.map(s => `L ${f1(X(s.time))} ${f1(Y(s.hi))}`).join(' ')} ${lo.map(s => `L ${f1(X(s.time))} ${f1(Y(s.lo))}`).join(' ')} Z" class="c-band" fill="${GRID}" fill-opacity="0.6"/>`); }
    parts.push(`<g class="c-curve c-ln${gi % 5}"><title>${esc(`${g.group}: ${g.n} patients, ${g.events ?? ''} events${g.median?.est != null ? `, median ${fmtN(g.median.est)}` : ''}`)}</title><path d="${d}" fill="none" stroke="${INK}" stroke-width="1.6" class="c-line"/>`,
      ...g.steps.filter(s => s.nCensor > 0).map(s => `<line x1="${f1(X(s.time))}" y1="${f1(Y(s.surv) - 4)}" x2="${f1(X(s.time))}" y2="${f1(Y(s.surv) + 4)}" stroke="${INK}" class="c-line"/>`), '</g>');
    const ry = riskTop + 18 + gi * 16;
    parts.push(`<rect x="0" y="${ry - 10}" width="8" height="8" class="c-sw c-cat${gi % 5}" fill="${INK}"/><text x="12" y="${ry - 2}" class="c-ink" fill="${INK}">${esc(clip(g.group, L - 18))}</text>`,
      ...riskX.map(t => `<text x="${f1(X(t))}" y="${ry - 2}" text-anchor="middle" class="c-mute" fill="${AXIS}">${g.atRisk?.find(a => a.time === t)?.n ?? ''}</text>`));
  });
  parts.push(`<text x="0" y="${riskTop - 2}" class="c-ink" fill="${INK}" font-weight="600">Number at risk</text>`);
  return svg(w, h, parts.join(''), title);
}

/**
 * The harvest plot on screen: a panel per group, three zones (harm, no clear, benefit), a bar per study in the zone of its direction, its
 * height by n when sizes are known. `rows` [{ label, group, direction, n, attrs }], `groups` the panels in order (one when there are none).
 */
export function harvestChart(rows, { width = 600, groups = null, title = 'Harvest plot', sized = true } = {}) {
  const w = Math.max(280, width), zones = ['harm', 'no clear', 'benefit'], NAME = { harm: 'Favors comparator', 'no clear': 'No clear or mixed', benefit: 'Favors intervention' };
  const panels = groups?.length ? groups : [''], labelW = panels[0] ? Math.min(Math.round(w * 0.25), Math.max(40, ...panels.map(g => textWidth(g, FS) + 8))) : 0;
  const x0 = labelW + (labelW ? 12 : 0), zoneW = (w - x0) / 3, nMax = Math.max(1, ...rows.map(r => r.n || 0)), BAR_H = 28, PANEL = BAR_H + 14, parts = [];
  zones.forEach((z, zi) => parts.push(`<text x="${f1(x0 + zoneW * zi + zoneW / 2)}" y="12" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(clip(NAME[z], zoneW - 8))}</text>`));
  panels.forEach((g, pi) => {
    const top = HEAD + pi * PANEL, base = top + PANEL - 4, mine = rows.filter(r => !g || r.group === g);
    parts.push(`<line x1="${x0}" y1="${base}" x2="${w}" y2="${base}" stroke="${AXIS}" class="c-axis"/>`, g ? `<text x="0" y="${f1(top + PANEL / 2 + 4)}" class="c-ink" fill="${INK}">${esc(clip(g, labelW))}</text>` : '');
    zones.forEach((z, zi) => {
      const list = mine.filter(r => (r.direction === 'mixed' ? 'no clear' : r.direction) === z), bw = Math.max(3, Math.min(10, (zoneW - 8) / Math.max(1, list.length) - 2));
      if (zi) parts.push(`<line x1="${f1(x0 + zoneW * zi)}" y1="${top}" x2="${f1(x0 + zoneW * zi)}" y2="${base}" stroke="${GRID}" class="c-grid"/>`);
      list.forEach((r, j) => { const bh = sized && r.n > 0 ? Math.max(4, BAR_H * r.n / nMax) : BAR_H * 0.6, bx = x0 + zoneW * zi + 4 + j * (bw + 2);
        parts.push(`<rect data-chart-mark="h${pi}-${zi}-${j}"${attrsOf(r.attrs)} x="${f1(bx)}" y="${f1(base - bh)}" width="${f1(bw)}" height="${f1(bh)}" class="c-bar c-dir-${z.replace(' ', '-')}" fill="${BAR}"><title>${esc(`${r.label}: ${z}${r.n ? `, n ${r.n}` : ''}`)}</title></rect>`); });
    });
  });
  return svg(w, HEAD + panels.length * PANEL + 4, parts.join(''), title);
}

/**
 * One lane per patient: the length from zero, a filled end for an event and an arrow for follow-up that ended without one, markers along
 * the lane (each kind its own symbol, named in the legend), lanes under their group's name. `rows` [{ label, time, event, group, markers:
 * [{ t, kind }], attrs }] in drawing order; `groups` the bands in order; `unit` the axis unit.
 */
export function laneChart(rows, { width = 600, groups = [], unit = '', title = 'Swimmer plot', xLabel = '' } = {}) {
  const w = Math.max(280, width), LANE = 16, kinds = [...new Set(rows.flatMap(r => (r.markers || []).map(m => m.kind)))].slice(0, 4);
  const labelW = Math.min(Math.round(w * 0.25), Math.max(40, ...rows.map(r => textWidth(r.label, FS) + 8))), x0 = labelW + 10, plotW = w - x0 - 16;
  const maxT = Math.max(1, ...rows.map(r => Math.max(r.time, ...(r.markers || []).map(m => m.t || 0)))), ticks = ticksFor(0, maxT, plotW), X = t => x0 + plotW * t / (ticks.at(-1)?.v > maxT ? ticks.at(-1).v : maxT);
  const units = groups.length ? groups.flatMap(g => { const mine = rows.filter(r => r.group === g); return mine.length ? [{ band: `${g} (n = ${mine.length}, ${mine.filter(r => r.event).length} events)` }, ...mine] : []; }) : rows;
  const legendH = 18, top = legendH + 4, bottom = top + units.length * LANE + 4, h = bottom + 36, parts = [];
  const SYM = (k, x, y) => k === 0 ? `<circle cx="${f1(x)}" cy="${y}" r="3" class="c-sym" fill="none" stroke="${INK}"/>` : k === 1 ? `<path d="M ${f1(x)} ${y - 4} l 4 4 l -4 4 l -4 -4 Z" class="c-sym" fill="${INK}"/>` : k === 2 ? `<rect x="${f1(x - 3)}" y="${y - 3}" width="6" height="6" class="c-sym" fill="none" stroke="${INK}"/>` : `<path d="M ${f1(x)} ${y - 4} l 4 7 l -8 0 Z" class="c-sym" fill="${INK}"/>`;
  let lx = x0; const legend = [['● event', ''], ['→ follow-up without it', '']];
  for (const [t] of legend) { parts.push(`<text x="${f1(lx)}" y="12" class="c-mute" fill="${AXIS}">${esc(t)}</text>`); lx += textWidth(t, FS) + 16; }
  kinds.forEach((k, i) => { parts.push(SYM(i, lx + 4, 8), `<text x="${f1(lx + 12)}" y="12" class="c-mute" fill="${AXIS}">${esc(k)}</text>`); lx += textWidth(k, FS) + 28; });
  for (const t of ticks) parts.push(`<line x1="${f1(X(t.v))}" y1="${top}" x2="${f1(X(t.v))}" y2="${bottom}" stroke="${t.v ? GRID : AXIS}" class="${t.v ? 'c-grid' : 'c-axis'}"/><text x="${f1(X(t.v))}" y="${bottom + 14}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(t.text)}</text>`);
  if (xLabel) parts.push(`<text x="${f1(x0 + plotW / 2)}" y="${bottom + 32}" text-anchor="middle" class="c-mute" fill="${AXIS}">${esc(xLabel)}</text>`);
  units.forEach((r, i) => { const y = top + i * LANE, cy = y + LANE / 2;
    if (r.band) { parts.push(`<text x="0" y="${cy + 4}" class="c-ink" fill="${INK}" font-weight="600">${esc(clip(r.band, w - 4))}</text>`); return; }
    const xe = X(r.time), tip = `${r.label}: ${fmtN(r.time)}${unit ? ` ${unit}` : ''}${r.event ? ', event' : ', no event'}${r.group ? `, ${r.group}` : ''}${(r.markers || []).map(m => `; ${m.kind} at ${fmtN(m.t)}`).join('')}`;
    parts.push(`<g data-chart-mark="p${i}"${attrsOf(r.attrs)} class="c-study"><title>${esc(tip)}</title><rect x="0" y="${y}" width="${w}" height="${LANE}" class="c-lane" fill="transparent"/><text x="${x0 - 6}" y="${cy + 4}" text-anchor="end" class="c-ink" fill="${INK}">${esc(clip(r.label, labelW))}</text>`,
      `<rect x="${x0}" y="${cy - 3}" width="${f1(Math.max(1, xe - x0))}" height="6" rx="2" class="c-bar" fill="${BAR}"/>`,
      r.event ? `<circle cx="${f1(xe)}" cy="${cy}" r="3.5" class="c-swim-end" fill="${INK}"/>` : `<path d="M ${f1(xe)} ${cy - 4} L ${f1(xe + 6)} ${cy} L ${f1(xe)} ${cy + 4} Z" class="c-swim-end" fill="${INK}"/>`,
      ...(r.markers || []).map(m => SYM(kinds.indexOf(m.kind), X(m.t), cy)), '</g>'); });
  return svg(w, h, parts.join(''), title);
}
