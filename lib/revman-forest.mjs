// A forest plot in RevMan Web's own layout (figure preset `asd-revman`; Batch 13 item 2, plan §4.15c.2), drawn over the app's own
// statistics. Nothing here pools: `revmanForest` takes a spec whose study effects, weights and pooled results are already computed
// (`revmanSpecFrom` builds it from a saved analysis), formats the numbers as RevMan prints them and lays the columns out by the rules
// measured from RevMan Web's SVG exports of 14 October 2026 (the review's `Evidence table/tools/revman`, whose exports are the
// fixtures of app/test/revman-forest.test.mjs):
//   Arial 14 px; arm and measure names at y = 21, column names at 41, the rule at 56; first row baseline 81, pitch 20; markers 4 px
//   above the baseline. Study column at x = 10, as wide as its widest label (bold "Study or Subgroup") + 10. Data columns at least
//   60 px, an arm header widening its columns to its width + 20. Effect column = widest of header and values + 10, right-aligned;
//   20 px gap; plot 210 px; 20 px margin. Square side = 2 + 16 × weight (fraction of the analysis); the diamond 18 px high; not
//   pooled, a 2 × 8 px tick and no weight column. Axis 29 px under the last plotted row, ticks ± 4, labels + 16, "Favors" + 31 at
//   20 px either side of the null line. Footnotes from max(Favors row, last row + 20) + 20; height = last baseline + 19; width =
//   rightmost text + 10. Text is measured with Arial's own advances and kerning (lib/revman-metrics.mjs).
import { arialWidth } from './revman-metrics.mjs';
import { pnorm, pt, qt } from './dist.mjs';

const RATIO = new Set(['RR', 'OR', 'PETO', 'HR', 'GIV_RATIO']);
const MEASURE_LABEL = { RR: 'Risk ratio', OR: 'Odds ratio', PETO: 'Odds ratio', RD: 'Risk difference', MD: 'Mean difference', SMD: 'Std. mean difference', GIV: 'Mean difference', HR: 'Hazard ratio' };
const METHOD_LABEL = { IV: 'IV', MH: 'M-H', PETO: 'Peto' };
const TAU2_LABEL = { REML: ['REML', 'Tau² calculated by Restricted Maximum-Likelihood method.'], DL: ['DL', 'Tau² calculated by DerSimonian and Laird method.'] };
const CI_LABEL = { Wald: ['Wald', 'CI calculated by Wald-type method.'], HKSJ: ['HKSJ', 'CI calculated by Hartung-Knapp-Sidik-Jonkman method.'] };
export const REVMAN_BLUE = 'rgb(0, 0, 204)';
const RATIO_TICKS = { 2: [0.5, 0.7, 1, 1.5, 2], 5: [0.2, 0.5, 1, 2, 5], 10: [0.1, 0.2, 0.5, 1, 2, 5, 10], 100: [0.01, 0.1, 1, 10, 100], 1000: [0.001, 0.1, 1, 10, 1000] };
const Z975 = 1.959963984540054;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- numbers as RevMan prints them --------------------------------------------------------------------------------------------
/** `x` to `nd` decimals, rounding half up on its decimal digits (RevMan rounds half up); never "-0.00". */
export function rnd(x, nd) {
  const neg = x < 0, [ip, fp] = Math.abs(x).toFixed(12).split('.');
  const digits = [...(ip + fp.slice(0, nd))].map(Number);
  if (fp.charCodeAt(nd) - 48 >= 5) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 9) digits[i--] = 0;
    if (i < 0) digits.unshift(1); else digits[i]++;
  }
  const str = digits.join(''), int = str.slice(0, str.length - nd).replace(/^0+(?=\d)/, '') || '0', frac = str.slice(str.length - nd);
  const out = nd ? `${int}.${frac}` : int;
  return (neg && !/^0(\.0*)?$/.test(out) ? '-' : '') + out;
}
export function fmtP(p) {
  if (!Number.isFinite(p)) return 'P = NA';
  if (p < 0.00001) return 'P < 0.00001';
  return `P = ${rnd(p, p < 0.0001 ? 5 : p < 0.001 ? 4 : p < 0.01 ? 3 : 2)}`;
}
const back = (meas, x) => (RATIO.has(meas) ? Math.exp(x) : x);
export const fmtCi = (meas, est, lo, hi, nd = 2) => `${rnd(back(meas, est), nd)} [${rnd(back(meas, lo), nd)} , ${rnd(back(meas, hi), nd)}]`;
const num = v => (v == null || v === '' ? '' : String(v));

// ---- text runs: [text, bold, superscript] ------------------------------------------------------------------------------------
const tw = (s, bold = false, size = 14) => arialWidth(String(s), size, bold);
const runsWidth = runs => runs.reduce((w, [t, b, sup]) => w + tw(t, b, sup ? 9 : 14), 0);
const n = v => { const s = v.toFixed(10); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

class Svg {
  constructor() { this.el = []; this.right = 0; this.bottom = 0; }
  /** `runs`: a string (bold → style on the text, as RevMan writes headers) or runs (bold → tspan, as it writes totals). */
  text(x, y, runs, anchor = 'start', bold = false) {
    let st = '', inner;
    if (typeof runs === 'string') {
      if (!runs) return;
      st = bold ? ' style="font-weight: bold;"' : '';
      runs = [[runs, bold, false]]; inner = esc(runs[0][0]);
    } else {
      if (!runs.map(r => r[0]).join('')) return;
      if (runs.length === 1 && !runs[0][2]) inner = runs[0][1] ? `<tspan style="font-weight: bold;">${esc(runs[0][0])}</tspan>` : `<tspan>${esc(runs[0][0])}</tspan>`;
      else {
        let raised = false; const out = [];
        for (const [t, b, sup] of runs) {
          const s = b ? ' style="font-weight: bold;"' : '';
          if (sup) { out.push(`<tspan dy="-5" font-size="9"${s}>${esc(t)}</tspan>`); raised = true; }
          else if (raised) { out.push(`<tspan dy="5"${s}>${esc(t)}</tspan>`); raised = false; }
          else out.push(`<tspan${s}>${esc(t)}</tspan>`);
        }
        inner = out.join('');
      }
    }
    const w = runsWidth(runs), xr = anchor === 'start' ? x + w : anchor === 'middle' ? x + w / 2 : x;
    this.right = Math.max(this.right, xr); this.bottom = Math.max(this.bottom, y);
    this.el.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="alphabetic" font-family="Arial" font-size="14"${st}>${inner}</text>`);
  }
  // the export writes these as style; presentation attributes draw the same and keep the lint's style rule for the interface
  line(x1, y1, x2, y2) { this.el.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="rgb(0, 0, 0)" stroke-width="1"></line>`); }
  rect(x, y, w, h, color) { this.el.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" stroke="${color}" fill="${color}"></rect>`); }
  poly(pts, color = 'rgb(0, 0, 0)') { this.el.push(`<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" stroke="${color}" fill="${color}"></polygon>`); }
  done(minRight = 0, title = '') {
    const W = Math.max(this.right, minRight) + 10, H = this.bottom + 19;
    return `<svg version="1.1" preserveAspectRatio="xMinYMin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}" role="img">${title ? `<title>${esc(title)}</title>` : ''}${this.el.join('')}</svg>`;
  }
}

/** Footnote letters in order of first use (a, b, c …). */
class Notes {
  constructor() { this.keys = []; }
  letter(text) { let i = this.keys.indexOf(text); if (i < 0) { this.keys.push(text); i = this.keys.length - 1; } return i < 26 ? 'abcdefghijklmnopqrstuvwxyz'[i] : String(i + 1); }
}

/**
 * The figure. `spec`:
 *   measure RR | OR | RD | PETO | MD | SMD | GIV | HR; method IV | MH | PETO; model random | fixed; tau2 REML | DL; ci Wald | HKSJ;
 *   pooled (false: study estimates only); overall (false: subtotals only); experimental, control (arm headers); favours [left, right];
 *   scale (ratio: 2, 5, 10, 100, 1000; difference: the axis half-width); ticks; decimals; extraColumns [{ key, header: [line, line] }];
 *   armColumns (false: no events and totals); subtotalRows (false: subgroups as headings under one overall pool); footnotes [text]; color; plotWidth;
 *   groups [{ name (null without subgroups), studies: [{ study, e1, n1, e2, n2 | m1, sd1, n1, m2, sd2, n2 | y, se, footnote, est: { y, v } | null, weight (%) }],
 *            result: pooled result | null, weight }];
 *   total: { k, mu, lo, hi, tau2, Q, df, pQ, I2, stat, p, stat_name 'Z' | 't', stat_df, pi: [lo, hi] } | null; subgroupTest: { Q, df, p, I2 } | null.
 * Effects and pooled results are on the analysis scale (log for ratios).
 */
export function revmanForest(spec) {
  const m = String(spec.measure || 'RR').toUpperCase();
  let method = String(spec.method || (['RR', 'OR', 'RD'].includes(m) ? 'MH' : 'IV')).toUpperCase();
  if (m === 'PETO') method = 'PETO';
  const model = method === 'PETO' ? 'fixed' : String(spec.model || 'random').toLowerCase(), random = model === 'random';
  const meas = m === 'GIV' && spec.ratio ? 'GIV_RATIO' : m, ratio = RATIO.has(meas);
  const pooled = spec.pooled !== false, hasSub = (spec.groups || []).some(g => g.name != null), overall = spec.overall !== false && pooled;
  const groups = spec.groups || [], tot = overall ? spec.total || null : null;
  const nd = spec.decimals ?? 2, notes = new Notes();
  const cont = m === 'MD' || m === 'SMD', giv = m === 'GIV', dich = !(cont || giv);
  const [ciTag, ciNote] = CI_LABEL[String(spec.ci || 'Wald').toUpperCase() === 'HKSJ' ? 'HKSJ' : 'Wald'];
  const [t2Tag, t2Note] = TAU2_LABEL[String(spec.tau2 || 'REML').toUpperCase()] || TAU2_LABEL.REML;
  // armColumns false leaves out the arms' counts (lib/forest-options.mjs events); subtotalRows false keeps subgroups as headings over one overall pool
  const armCols = spec.armColumns === false ? [] : dich ? [['e', 'Events'], ['n', 'Total']] : cont ? [['m', 'Mean'], ['sd', 'SD'], ['n', 'Total']] : [];
  const subtotals = spec.subtotalRows !== false;
  const extra = spec.extraColumns || [];

  // ---- rows: { kind, label (runs), cells { key: runs }, eff (runs), weight (runs), marker }
  const rows = [];
  const studyRow = s => {
    const lab = [[s.study, false, false]];
    if (s.footnote) lab.push([notes.letter(s.footnote), false, true]);
    const cells = {};
    for (const side of ['1', '2']) for (const [k] of armCols) cells[k + side] = [[num(s[k + side]), false, false]];
    if (giv) { cells.y = [[num(s.y), false, false]]; cells.se = [[num(s.se), false, false]]; }
    for (const c of extra) cells[`x:${c.key}`] = [[typeof s[c.key] === 'string' ? s[c.key] : num(s[c.key]), false, false]];   // a judgement (risk of bias) is text
    const e = s.est;
    if (!e) return { kind: 'study', label: lab, cells, eff: [['Not estimable', false, false]] };
    const se = Math.sqrt(e.v), z = spec._z ?? Z975;
    const r = { kind: 'study', label: lab, cells, eff: [[fmtCi(meas, e.y, e.y - z * se, e.y + z * se, nd), false, false]], marker: ['square', e.y, e.y - z * se, e.y + z * se, s.weight] };
    if (pooled && s.weight != null) r.weight = [[`${rnd(s.weight, 1)}%`, false, false]];
    return r;
  };
  const sum = (studies, key) => studies.reduce((a, s) => a + (Number(s[key]) || 0), 0);
  const totalRows = (label, studies, r, wsum) => {
    if (!r) return [{ kind: 'sum', label: [[`${label} (95% CI)`, true, false]], cells: {}, eff: [['Not estimable', false, false]] }];
    const lab = random ? [[`${label} (${ciTag}`, true, false], [notes.letter(ciNote), true, true], [')', true, false]] : [[`${label} (95% CI)`, true, false]];
    const cells = {};
    if (armCols.length) for (const side of ['1', '2']) cells[`n${side}`] = [[String(sum(studies, `n${side}`)), true, false]];
    const out = [{ kind: 'sum', label: lab, cells, weight: [[`${rnd(wsum, 1)}%`, true, false]], eff: [[fmtCi(meas, r.mu, r.lo, r.hi, nd), true, false]], marker: ['diamond', r.mu, r.lo, r.hi, wsum] }];
    if (r.pi) out.push({ kind: 'pi', label: [['Prediction interval', false, false]], cells: {}, eff: [[`[${rnd(back(meas, r.pi[0]), nd)} , ${rnd(back(meas, r.pi[1]), nd)}]`, false, false]], marker: ['pi', null, r.pi[0], r.pi[1], null] });
    if (dich) out.push({ kind: 'text', label: [['Total events:', false, false]], cells: { e1: [[String(sum(studies, 'e1')), false, false]], e2: [[String(sum(studies, 'e2')), false, false]] } });
    const test = r.stat_name === 't' ? `Test for overall effect: t = ${rnd(Math.abs(r.stat), 2)}, df = ${r.stat_df} (${fmtP(r.p)})` : `Test for overall effect: Z = ${rnd(Math.abs(r.stat), 2)} (${fmtP(r.p)})`;
    out.push({ kind: 'text', label: [[test, false, false]], cells: {} });
    return out;
  };
  const hetRow = r => {
    if (!r) return null;
    if (r.k < 2) return { kind: 'text', label: [['Heterogeneity: Not applicable', false, false]], cells: {} };
    if (r.Q == null) return null;   // a subgroup result the analysis kept without its heterogeneity
    const tail = `Chi² = ${rnd(r.Q, 2)}, df = ${r.df} (${fmtP(r.pQ)}); I² = ${rnd(r.I2, 0)}%`;
    return random ? { kind: 'text', label: [[`Heterogeneity: Tau² (${t2Tag}`, false, false], [notes.letter(t2Note), false, true], [`) = ${rnd(r.tau2, 2)}; ${tail}`, false, false]], cells: {} }
      : { kind: 'text', label: [[`Heterogeneity: ${tail}`, false, false]], cells: {} };
  };
  groups.forEach((g, gi) => {
    if (hasSub) rows.push({ kind: 'group', label: [[g.name, true, false]], cells: {} });
    for (const s of g.studies) rows.push(studyRow(s));
    if (hasSub && pooled && subtotals) {
      rows.push(...totalRows('Subtotal', g.studies, g.result, g.weight || 0));
      if (g.result) rows.push(hetRow(g.result));
      rows.push({ kind: 'blank' });
    } else if (hasSub && gi < groups.length - 1) rows.push({ kind: 'blank' });
  });
  const subgroupRow = st => ({ kind: 'text', label: [[`Test for subgroup differences: Chi² = ${rnd(st.Q, 2)}, df = ${st.df} (${fmtP(st.p)}), I² = ${st.I2 === 0 ? '0' : rnd(st.I2, 1)}%`, false, false]], cells: {} });
  if (overall && tot) {
    const all = groups.flatMap(g => g.studies);
    if (!hasSub || !subtotals) rows.push({ kind: 'blank' });
    rows.push(...totalRows('Total', all, tot, 100));
    if (spec.subgroupTest) rows.push(subgroupRow(spec.subgroupTest));
    else rows.push({ kind: 'blank' });
    rows.push(hetRow(tot));
  } else if (hasSub && pooled && rows.length && rows.at(-1).kind === 'blank') rows.pop();
  // without an overall pool the subgroups are still compared when the spec gives the test (lib/synth-figures.mjs, a comparison by subgroup)
  if (!overall && hasSub && pooled && subtotals && spec.subgroupTest) rows.push(subgroupRow(spec.subgroupTest));
  else if (!overall && hasSub && pooled && subtotals && spec.nooverallNote !== false) rows.push({ kind: 'text', label: [[spec.nooverallText || 'Subgroups not pooled with each other.', false, false]], cells: {} });
  const list = rows.filter(Boolean);

  // ---- column geometry
  const svg = new Svg(), headBold = s => tw(s, true);
  const namesW = Math.max(headBold('Study or Subgroup'), ...list.filter(r => r.kind === 'study').map(r => runsWidth(r.label)));
  let x = 10 + namesW + 10;
  const colx = {}, hdr21 = [], hdr41 = [];
  const colWidth = (key, header) => Math.max(60, headBold(header) + 10, ...list.filter(r => r.cells && key in r.cells).map(r => runsWidth(r.cells[key]) + 10));
  for (const c of extra) {
    const k = `x:${c.key}`, hd = Array.isArray(c.header) ? c.header : [c.header ?? c.key];
    const w = Math.max(60, ...hd.map(h => headBold(h) + 20), ...list.filter(r => r.cells && k in r.cells).map(r => runsWidth(r.cells[k]) + 20));
    colx[k] = [x, x + w, 'middle'];
    if (hd.length === 2) { hdr21.push([x + w / 2, hd[0]]); hdr41.push([x + w / 2, hd[1]]); } else hdr41.push([x + w / 2, hd[0]]);
    x += w;
  }
  if (armCols.length) for (const [side, armName] of [['1', spec.experimental || 'Experimental'], ['2', spec.control || 'Control']]) {
    let ws = armCols.map(([k, h]) => colWidth(k + side, h));
    const need = headBold(armName) + 20, have = ws.reduce((a, b) => a + b, 0);
    if (have < need) ws = ws.map(w => w + (need - have) / ws.length);
    const x0 = x;
    armCols.forEach(([k, h], i) => { colx[k + side] = [x, x + ws[i], 'end']; hdr41.push([x + ws[i] / 2, h]); x += ws[i]; });
    hdr21.push([(x0 + x) / 2, armName]);
  }
  if (giv) for (const [k, h] of [['y', spec.givLabel || `log[${meas === 'GIV_RATIO' ? 'RR' : 'MD'}]`], ['se', 'SE']]) { const w = colWidth(k, h); colx[k] = [x, x + w, 'end']; hdr41.push([x + w / 2, h]); x += w; }
  if (pooled) { const w = Math.max(60, headBold('Weight') + 10, ...list.filter(r => r.weight).map(r => runsWidth(r.weight) + 10)); colx.weight = [x, x + w, 'end']; hdr41.push([x + w / 2, 'Weight']); x += w; }
  const mlabel = spec.measureLabel || MEASURE_LABEL[m] || m, meth = `${METHOD_LABEL[method]}, ${random ? 'Random' : 'Fixed'}, 95% CI`;
  const ew = Math.max(headBold(meth), headBold(mlabel), ...list.filter(r => r.eff).map(r => runsWidth(r.eff))) + 10;
  const effL = x, effR = x + ew; x += ew;
  const P0 = x + 20, PW = spec.plotWidth || 210, P1 = P0 + PW, RULE = P1 + 20;

  // ---- scale
  let scale = spec.scale, X, tickPos;
  if (ratio) {
    scale = scale || 100;
    const lo = Math.log(1 / scale), hi = Math.log(scale), ticks = spec.ticks || RATIO_TICKS[scale] || [1 / scale, 1, scale];
    X = t => P0 + (t - lo) / (hi - lo) * PW;
    tickPos = ticks.map(t => [X(Math.log(t)), t]);
  } else {
    if (!scale) {
      const ext = Math.max(1e-9, ...list.filter(r => r.marker).flatMap(r => [Math.abs(r.marker[2]), Math.abs(r.marker[3])]));
      scale = [-3, -2, -1, 0, 1, 2, 3, 4, 5].flatMap(e => [1, 2, 5].map(b => b * 10 ** e)).find(s => s >= ext);
    }
    const ticks = spec.ticks || [-scale, -scale / 2, 0, scale / 2, scale];
    X = t => P0 + (t + scale) / (2 * scale) * PW;
    tickPos = ticks.map(t => [X(t), t]);
  }
  const xnull = X(0);

  // ---- headers
  svg.text(10, 41, 'Study or Subgroup', 'start', true);
  for (const [cx, t] of hdr21) svg.text(cx, 21, [[t, true, false]], 'middle');
  for (const [cx, t] of hdr41) svg.text(cx, 41, t, 'middle', true);
  svg.text((effL + effR) / 2, 21, [[mlabel, true, false]], 'middle');
  svg.text((effL + effR) / 2, 41, meth, 'middle', true);
  const pc = (P0 + P1) / 2;
  svg.text(pc, 21, [[mlabel, true, false]], 'middle');
  svg.text(pc, 41, meth, 'middle', true);

  // ---- rows
  let y = 81, lastPlot = null; const color = spec.color || REVMAN_BLUE;
  for (const r of list) {
    if (r.kind === 'blank') { y += 20; continue; }
    if (r.label) svg.text(10, y, r.label, 'start');
    for (const [k, runs] of Object.entries(r.cells || {})) { if (!colx[k]) continue; const [l, rr, anc] = colx[k]; svg.text(anc === 'end' ? rr : (l + rr) / 2, y, runs, anc); }
    if (r.weight) svg.text(colx.weight[1], y, r.weight, 'end');
    if (r.eff) svg.text(effR, y, r.eff, 'end');
    if (r.marker) {
      const [kind, est, lo, hi, w] = r.marker, cy = y - 4, xl = X(lo), xh = X(hi);
      if (kind === 'square') {
        svg.line(Math.max(xl, P0), cy, Math.min(xh, P1), cy);
        if (xh > P1) svg.poly([[P1, cy], [P1 - 6, cy - 3], [P1 - 6, cy + 3]]);
        if (xl < P0) svg.poly([[P0, cy], [P0 + 6, cy - 3], [P0 + 6, cy + 3]]);
        const xe = X(est);
        if (xe >= P0 && xe <= P1) {
          if (pooled && w != null) { const side = 2 + 16 * w / 100; svg.rect(xe - side / 2, cy - side / 2, side, side, color); }
          else svg.rect(xe - 1, cy - 4, 2, 8, color);
        }
      } else if (kind === 'diamond') {
        const hh = spec.subtotalDiamond === 'weight' ? (2 + 16 * w / 100) / 2 : 9, xe = X(est);
        svg.poly([[xe, cy + hh], [Math.max(xl, P0), cy], [xe, cy - hh], [Math.min(xh, P1), cy]]);
      } else if (kind === 'pi') {
        svg.line(Math.max(xl, P0), cy, Math.min(xh, P1), cy);
        for (const xx of [xl, xh]) if (xx >= P0 && xx <= P1) svg.line(xx, cy - 4, xx, cy + 4);
      }
      lastPlot = y;
    }
    y += 20;
  }
  const lastRow = y - 20;
  if (lastPlot == null) lastPlot = 81;
  const ay = lastPlot + 29;

  // ---- axis
  svg.line(P0, ay, P1, ay);
  for (const [px, t] of tickPos) { svg.line(px, ay - 4, px, ay + 4); svg.text(px, ay + 16, String(Number(t)), 'middle'); }
  svg.line(xnull, 56, xnull, ay);
  const fav = spec.favours || ['Favors experimental', 'Favors control'];
  svg.text(xnull - 20, ay + 31, [[fav[0], false, false]], 'end');
  svg.text(xnull + 20, ay + 31, [[fav[1], false, false]], 'start');
  svg.line(10, 56, RULE, 56);

  // ---- footnotes
  const extraNotes = (spec.footnotes || []).filter(Boolean);
  if (notes.keys.length || extraNotes.length) {
    let fy = Math.max(ay + 31, lastRow + 20) + 20;
    svg.text(10, fy, 'Footnotes', 'start', true);
    for (const t of notes.keys) { fy += 20; svg.text(10, fy, [[notes.letter(t), false, true], [t, false, false]], 'start'); }
    for (const t of extraNotes) { fy += 20; svg.text(10, fy, [[t, false, false]], 'start'); }
  }
  return svg.done(RULE, spec.title || `Forest plot, RevMan layout: ${mlabel}`);
}

// ---- from the app's own statistics -------------------------------------------------------------------------------------------
const LOG_MEASURES = new Set(['RR', 'OR', 'HR', 'PETO', 'IRR']);
const fin = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const vec = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * The spec of a saved analysis (`views/analysis.mjs` stores it: labels, values, study_est/lo/hi on the measure's scale, weights in
 * percent, estimate/lo/hi with mu/mu_lb/mu_ub on the analysis scale, tau2, q, qp, i2, k, method, test, measure, modValues). Nothing is
 * recomputed: each study's effect is the log (or the value) of what the analysis stored, its variance from the stored interval, the
 * pooled test from the stored interval's width (Z for a Wald interval, t on k − 1 for Hartung–Knapp). A study the analysis left out
 * (no events in either arm) is a "Not estimable" row. `opts`: experimental, control, favours, scale, footnotes, pooled, title.
 */
export function revmanSpecFrom(a, opts = {}) {
  const measure = String(a?.measure || 'RR').toUpperCase(), log = LOG_MEASURES.has(measure);
  const method = String(a?.method || 'REML').toUpperCase();
  const rm = method === 'MH' ? 'MH' : method === 'PETO' ? 'PETO' : 'IV', model = ['EE', 'MH', 'PETO'].includes(method) ? 'fixed' : 'random';
  const hk = String(a?.test || '').toLowerCase() === 'knha' || method === 'HKSJ';
  const labels = vec(a?.labels), est = vec(a?.study_est), lo = vec(a?.study_lo), hi = vec(a?.study_hi), weights = vec(a?.weights), values = vec(a?.values);
  const k = labels.length, wsum = weights.reduce((s, w) => s + (fin(w) || 0), 0) || 0;
  const onScale = v => (log ? Math.log(v) : v);
  const binary = measure !== 'MD' && measure !== 'SMD', cont = measure === 'MD' || measure === 'SMD';
  const arms = v => (binary ? { e1: fin(v?.events_t), n1: fin(v?.n_t), e2: fin(v?.events_c), n2: fin(v?.n_c) } : cont ? { m1: fin(v?.mean_t), sd1: fin(v?.sd_t), n1: fin(v?.n_t), m2: fin(v?.mean_c), sd2: fin(v?.sd_c), n2: fin(v?.n_c) } : {});
  const study = i => {
    const y = fin(est[i]) != null ? onScale(est[i]) : null, l = fin(lo[i]) != null ? onScale(lo[i]) : null, h = fin(hi[i]) != null ? onScale(hi[i]) : null;
    const v = y != null && l != null && h != null ? ((h - l) / (2 * Z975)) ** 2 : null;
    // the weight the analysis gives, as a share of the total; a pooled weight sum of 100 is RevMan's own
    const weight = fin(weights[i]) != null && wsum > 0 ? 100 * weights[i] / wsum : null;
    return { study: String(labels[i] ?? ''), ...arms(values[i]), est: v != null ? { y, v } : null, weight };
  };
  const studies = labels.map((_, i) => study(i));
  vec(a?.excluded).forEach((label, i) => studies.push({ study: String(label), ...arms(vec(a?.excludedValues)[i]), est: null, weight: null }));
  const pooled = opts.pooled ?? (fin(a?.estimate) != null && k >= 1);
  // the pooled test from the interval the analysis stored: Z = mu / se (Wald) or t on k − 1 (Hartung–Knapp)
  let total = null;
  const mu = fin(a?.mu) ?? (fin(a?.estimate) != null ? onScale(a.estimate) : null), mlb = fin(a?.mu_lb) ?? (fin(a?.lo) != null ? onScale(a.lo) : null), mub = fin(a?.mu_ub) ?? (fin(a?.hi) != null ? onScale(a.hi) : null);
  if (pooled && mu != null && mlb != null && mub != null) {
    const df = Math.max(1, k - 1), q = hk ? qt(0.975, df) : Z975, se = (mub - mlb) / (2 * q), stat = se > 0 ? mu / se : 0;
    const p = hk ? 2 * pt(-Math.abs(stat), df) : 2 * (1 - pnorm(Math.abs(stat)));
    total = { k, mu, lo: mlb, hi: mub, tau2: fin(a?.tau2) ?? 0, Q: fin(a?.q), df: fin(a?.k) != null ? a.k - 1 : k - 1, pQ: fin(a?.qp), I2: fin(a?.i2) ?? 0, stat, p, stat_name: hk ? 't' : 'Z', ...(hk ? { stat_df: df } : {}),
      ...(fin(a?.pi_lo) != null && fin(a?.pi_hi) != null ? { pi: [onScale(a.pi_lo), onScale(a.pi_hi)] } : {}) };
  }
  // subgroups: the moderator's levels, each with its own estimate when the analysis kept one (no heterogeneity line without its Q)
  const modValues = vec(a?.modValues);
  let groups;
  if (modValues.length === k && modValues.some(v => v != null)) {
    const levels = [...new Set(modValues.map(v => (v == null ? '' : String(v))))];
    const modEst = vec(a?.mod_est), modLo = vec(a?.mod_lo), modHi = vec(a?.mod_hi), modLevels = vec(a?.mod_levels).map(String);
    groups = levels.map(level => {
      const idx = modValues.map((v, i) => ((v == null ? '' : String(v)) === level ? i : -1)).filter(i => i >= 0);
      const j = modLevels.indexOf(level), me = j >= 0 ? fin(modEst[j]) : null, ml = j >= 0 ? fin(modLo[j]) : null, mh = j >= 0 ? fin(modHi[j]) : null;
      const gs = idx.map(i => studies[i]), gw = gs.reduce((s, x) => s + (x.weight || 0), 0);
      const result = pooled && me != null && ml != null && mh != null ? (() => { const se = (onScale(mh) - onScale(ml)) / (2 * Z975), stat = se > 0 ? onScale(me) / se : 0; return { k: gs.length, mu: onScale(me), lo: onScale(ml), hi: onScale(mh), stat, p: 2 * (1 - pnorm(Math.abs(stat))), stat_name: 'Z' }; })() : null;
      return { name: level || 'Not stated', studies: gs, result, weight: gw };
    });
    if (studies.length > k) groups.push({ name: 'Not estimable', studies: studies.slice(k), result: null, weight: 0 });
  } else groups = [{ name: null, studies }];
  return {
    measure: measure === 'IRR' ? 'GIV' : measure, ratio: log, method: rm, model, tau2: method === 'DL' ? 'DL' : 'REML', ci: hk ? 'HKSJ' : 'Wald', pooled, overall: pooled,
    experimental: opts.experimental || a?.armsLabel?.treated || 'Experimental', control: opts.control || a?.armsLabel?.control || 'Control',
    favours: opts.favours || [`Favors ${opts.experimental || 'experimental'}`, `Favors ${opts.control || 'control'}`],
    ...(opts.scale ? { scale: opts.scale } : {}), footnotes: opts.footnotes || [], decimals: opts.decimals ?? 2, color: opts.color || REVMAN_BLUE,
    title: opts.title || (a?.outcomeName ? `Forest plot, RevMan layout: ${a.outcomeName}` : ''), groups, total, subgroupTest: null,
  };
}
