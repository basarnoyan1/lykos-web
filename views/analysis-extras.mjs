// Sensitivity analyses and diagnostics of a saved pooled result (plan §4.6 amendment of 2026-09-29): small-study
// effects and publication bias, diagnostic figures, GOSH, dependent effects and missing outcome data. Each runs
// on demand from the result's own saved inputs and settings, stores its numbers in the result (`a.extras`) and
// is dropped with the result when it is run again. Nothing here changes the pooled estimate: every panel is a
// sensitivity analysis, says so, and says when it does not run.
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { num } from '../lib/dates.mjs';
import { uiBar, uiSwap } from '../lib/ui-actions.mjs';
import { disclosure, tableRegion } from '../lib/ui-components.mjs';
import { runR } from '../lib/r.mjs';
import { figurePanel, showFigure, showChart } from '../lib/figure.mjs';
import { looChart } from '../lib/analysis-charts.mjs';
import { analysisOf } from '../lib/outcomes.mjs';
import { fields, valueFor } from '../lib/fields.mjs';
import * as jobs from '../lib/jobs.mjs';
import { biasScript, assembleBias, biasGate, backOf, SELECTION_TYPES, ETAS, MIN_K } from '../lib/bias.mjs';
import { selectionFunctionSvg, radialSvg, labbeSvg, goshSvg, outlierSvg, diagnosticSvg, leaveOneOutSvg, doiSvg, predictionSvg } from '../lib/stat-plots.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { diagnosticInputs, outlierRule, countRows } from '../lib/diagnostics.mjs';
import { subsetMasks, goshChunkR, summariseGosh, CHUNK, EXHAUSTIVE_K, SAMPLE_SIZE } from '../lib/gosh.mjs';
import { dependenceScript, clusterLabels, clusterShape, DEFAULT_RHO } from '../lib/dependence.mjs';
import { scenarioImors, studyEffect, gambleHollis, MEASURES_WITH_MISSING } from '../lib/missing-outcome.mjs';
import { fragilityScript, fragilityStudy } from '../lib/fragility.mjs';
import { lfkIndex } from '../lib/lfk.mjs';
import { qchisq } from '../lib/dist.mjs';
import { measureOf, backTransform } from '../lib/effect-measures.mjs';

const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
const fx = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
const pv = p => (p == null || !Number.isFinite(Number(p)) ? '—' : Number(p) < 0.001 ? '<0.001' : Number(p).toFixed(3));
const ci = (e, lo, hi, d = 2) => `${fx(e, d)} [${fx(lo, d)}, ${fx(hi, d)}]`;
const ok = r => r && !r.error && r.est != null;
/** The estimator the extras refit with: the result's own, or REML for a model they cannot refit (the mixed model, Mantel–Haenszel, Peto). */
const fitMethod = a => { const m = a.settings?.estimator ?? a.method; return ['REML', 'DL', 'EE'].includes(m) ? m : m === 'MH' || m === 'PETO' ? 'EE' : 'REML'; };

// state that lives with the view, not with the project
const ui = { diag: 'radial', gosh: null, dep: {}, miss: {} };
const stateFor = slot => { ui.dep[slot] ||= { field: '', rho: DEFAULT_RHO }; ui.miss[slot] ||= { treated: '', control: '', imorE: 2, imorC: 1, eventBad: true }; return { dep: ui.dep[slot], miss: ui.miss[slot] }; };

/** Stores an extra analysis in the saved result it belongs to. */
function save(slot, kind, payload) {
  update(st => { const a = analysisOf(st, slot); if (a) a.extras = { ...(a.extras || {}), [kind]: { ...payload, at: new Date().toISOString() } }; return st; });
}

// What the person opened stays open when the page redraws (a run redraws it): disclosures are keyed by id, the way the allocation audit trail is.
const OPEN = new Set();
// A table in a section's body is wide data: it scrolls in a named region with its first column held, never past the pane.
const regions = (html, title) => html.replace(/<table\b[\s\S]*?<\/table>/g, t => tableRegion({ label: `${title}, table`, html: t }));
const section = ({ id, title, meta = '', body, open }) => disclosure({ id: `x-sec-${id}`, title, meta, body: regions(body, title), open: open ?? OPEN.has(`x-sec-${id}`) });
export const extraSection = section;
/** Remembers which disclosures of `root` are open; call it after the page is drawn. */
export function trackSections(root) {
  root.querySelectorAll('details[id^="x-sec-"]').forEach(d => { d.ontoggle = () => { if (d.open) OPEN.add(d.id); else OPEN.delete(d.id); }; });
}
/** A section's own commands: Run, in a foot bar of the section (its body is hidden until the section opens). */
const runBar = (id, label, ...acts) => uiBar({ kind: 'foot', label, id: `${id}-bar`, actions: acts });
/** A titled part of a section's body: the tables of one analysis. */
const part = (title, meta, body) => `<h3 class="x-part">${esc(title)}${meta ? ` <span class="meta">${esc(meta)}</span>` : ''}</h3>${body}`;

/** The sections of the extras; each draws into its own host, as a disclosure closed until it is asked for. */
export const extrasHtml = () => `
  <div id="x-diagnostics"></div>
  <div id="x-bias"></div>
  <div id="x-frag"></div>
  <div id="x-lfk"></div>
  <div id="x-gosh"></div>
  <div id="x-dep"></div>
  <div id="x-miss"></div>`;

/** Draws the extras of result `a` into `host` (the element holding extrasHtml). */
export function mountExtras(host, ctx, a, slot) {
  if (!host || !a) return;
  const inputs = diagnosticInputs(a);
  diagnostics(host, a, inputs);
  bias(host, ctx, a, slot);
  fragility(host, ctx, a, slot);
  lfk(host, ctx, a, slot, inputs);
  gosh(host, ctx, a, slot, inputs);
  dependence(host, ctx, a, slot);
  missing(host, ctx, a, slot);
}

// ---- diagnostics -------------------------------------------------------------------------------------------------

const KINDS = [['radial', 'Radial plot'], ['outlier', 'Interval outlier rule'], ['rstudent', 'Studentized residuals'], ['cook', "Cook's distance"], ['loo', 'Leave one out'], ['looinf', 'Leave one out, by influence'], ['pred', 'Prediction interval'], ['labbe', "L'Abbé plot"]];

/** The analysis-scale value of a reported one, for the measures whose back-transformation has an inverse here; null otherwise. */
const predForth = measure => ({ exp: Math.log, 'transf.ilogit': x => Math.log(x / (1 - x)), 'transf.ztor': Math.atanh }[backTransform(measure)] ?? (backTransform(measure) ? null : (x => x)));

/**
 * Leave-one-out on screen (lib/analysis-charts.mjs looChart, as Make draws it): a row per study in `order`, the pooled estimate without it,
 * the full estimate's line and band; a row opens its study. Answers draw(width).
 */
const looScreen = (a, labels, order, title) => {
  const v = k => vec(a[k]).map(Number), est = v('loo_est'), lo = v('loo_lo'), hi = v('loo_hi'), ratio = measureOf(a.measure).ratio, papers = vec(a.papers);
  const rows = order.map(i => ({ label: labels[i] ?? `Study ${i + 1}`, est: est[i], lo: lo[i], hi: hi[i], attrs: papers[i] ? { 'data-idt-study': papers[i] } : {} }));
  const full = { est: Number(a.estimate), lo: Number(a.lo), hi: Number(a.hi) };
  return w => looChart(rows, { width: w, full, log: !!ratio, fmt: x => fx(x), xLabel: `${a.measure} without the study`, title });
};

function diagramFor(kind, a, inputs, style = null) {
  const back = backOf(a.measure) || (x => x), labels = inputs?.labels || vec(a.labels);
  if (kind === 'radial' && inputs) return { svg: radialSvg({ style, yi: inputs.yi, vi: inputs.vi, tau2: a.settings?.estimator === 'EE' || ['MH', 'PETO'].includes(a.method) ? 0 : inputs.tau2, mu: inputs.mu, labels, back }), file: 'radial-plot',
    note: 'Studies more than 2 from the line lie outside the band' };
  if (kind === 'outlier' && inputs) {
    const rule = outlierRule({ yi: inputs.yi, vi: inputs.vi, lo: inputs.lo, hi: inputs.hi }), n = rule.filter(r => r.outlier).length;
    return { svg: outlierSvg({ style, yi: inputs.yi, vi: inputs.vi, labels, est: inputs.mu, lo: inputs.lo, hi: inputs.hi, flagged: rule.map(r => r.outlier), back, xlabel: a.measure }), file: 'outlier-rule', note: `${n} of ${rule.length} outside the pooled interval` };
  }
  if (kind === 'rstudent' && vec(a.infl_rstudent).length) { const v = vec(a.infl_rstudent).map(Number);
    return { svg: diagnosticSvg({ style, values: v, labels: vec(a.infl_labels), refs: [{ at: -1.959964, label: '−1.96' }, { at: 1.959964, label: '1.96' }], flagged: v.map(x => Math.abs(x) > 1.959964), title: 'Studentized residuals', xlabel: 'Externally studentised residual' }), file: 'studentised-residuals', note: `${v.filter(x => Math.abs(x) > 1.959964).length} beyond ±1.96` }; }
  if (kind === 'cook' && vec(a.infl_cook).length) { const v = vec(a.infl_cook).map(Number), cut = qchisq(0.5, 1);
    return { svg: diagnosticSvg({ style, values: v, labels: vec(a.infl_labels), refs: [{ at: cut, label: fx(cut, 2) }], flagged: v.map(x => x > cut), title: "Cook's distance", xlabel: "Cook's distance" }), file: 'cooks-distance', note: `${v.filter(x => x > cut).length} beyond metafor's cut-off, the median of χ²(1)` }; }
  if (kind === 'looinf' && vec(a.loo_est).length) {
    const est = vec(a.loo_est).map(Number), lo = vec(a.loo_lo).map(Number), hi = vec(a.loo_hi).map(Number), full = Number(a.estimate), ratio = measureOf(a.measure).ratio;
    const dev = est.map(e => Math.abs(ratio ? Math.log(e / full) : e - full)), ord = est.map((_, i) => i).sort((p, q) => dev[q] - dev[p] || p - q), pick = v => ord.map(i => v[i]);
    return { svg: leaveOneOutSvg({ style, est: pick(est), lo: pick(lo), hi: pick(hi), full: { est: full, lo: Number(a.lo), hi: Number(a.hi) }, labels: ord.map(i => labels[i] ?? `Study ${i + 1}`), xlabel: `${a.measure} without the study`, title: 'Leave-one-out plot, by influence' }), file: 'leave-one-out-by-influence',
      chart: looScreen(a, labels, ord, 'Leave-one-out, by influence'),
      note: `Ordered by the size of the change in the pooled ${ratio ? 'log ' : ''}estimate` };
  }
  if (kind === 'pred' && inputs && a.pi_lo != null && a.pi_hi != null) {
    const forth = predForth(a.measure); if (!forth) return null;
    return { svg: predictionSvg({ style, est: inputs.mu, lo: inputs.lo, hi: inputs.hi, piLo: forth(Number(a.pi_lo)), piHi: forth(Number(a.pi_hi)), tau2: a.settings?.estimator === 'EE' || ['MH', 'PETO'].includes(a.method) ? 0 : inputs.tau2, yi: inputs.yi, labels, back, xlabel: a.measure }), file: 'prediction-interval',
      note: 'The interval is the result’s own; the curve is the distribution of true effects it describes' };
  }
  if (kind === 'loo' && vec(a.loo_est).length) return { svg: leaveOneOutSvg({ style, est: vec(a.loo_est).map(Number), lo: vec(a.loo_lo).map(Number), hi: vec(a.loo_hi).map(Number), full: { est: Number(a.estimate), lo: Number(a.lo), hi: Number(a.hi) }, labels, xlabel: `${a.measure} without the study` }), file: 'leave-one-out', note: '',
    chart: looScreen(a, labels, vec(a.loo_est).map((_, i) => i), 'Leave-one-out') };
  if (kind === 'labbe') { const rows = countRows(a); if (rows) return { svg: labbeSvg({ style, rows, labels, effect: Number(a.estimate), measure: a.measure }), file: 'labbe-plot', note: '' }; }
  return null;
}

function diagnostics(host, a, inputs) {
  const el = host.querySelector('#x-diagnostics'); if (!el) return;
  const kinds = KINDS.filter(([k]) => diagramFor(k, a, inputs));
  if (!kinds.length) { el.innerHTML = section({ id: 'diagnostics', title: 'Diagnostics', meta: 'Run again to draw them', body: '<div class="note">Not in the saved result</div>' }); return; }
  if (!kinds.some(([k]) => k === ui.diag)) ui.diag = kinds[0][0];
  el.innerHTML = section({ id: 'diagnostics', title: 'Diagnostics', meta: `${kinds.length} plots`,
    // the plot's pick is a tools bar over the drawing, the head its name and Download: the head keeps one row at every width (check:bars
    // wrap-ragged at 320 and 340 px, when the pick shared it)
    body: figurePanel({ title: 'Diagnostic plot', id: 'x-diag', zoom: false }).replace('<div class="panel-body figure-wrap">',
      `<div class="panel-body">${uiBar({ kind: 'tools', id: 'x-diag-tools', label: 'Diagnostic', filters: [{ type: 'select', id: 'x-diag-kind', label: 'Diagnostic', options: kinds, value: ui.diag }] })}</div><div class="panel-body figure-wrap">`) });
  // a plot Make draws for the screen (leave-one-out) is that chart at the panel's width; the others are their house drawings
  const draw = () => { const d = diagramFor(ui.diag, a, inputs, figureTokens(null, { medium: 'screen' })); if (!d) return;
    // no zoom: a house drawing is fitted to the panel, never past its size
    const exportSvg = () => diagramFor(ui.diag, a, inputs, figureTokens(null, { medium: 'export' })).svg;
    if (d.chart) showChart(el, 'x-diag', d.chart, d.file, { exportSvg }); else showFigure(el, 'x-diag', d.svg, d.file, { exportSvg });
    el.querySelector('.diag-note')?.remove();
    if (d.note) el.querySelector('.figure-wrap').insertAdjacentHTML('afterend', `<div class="panel-body diag-note"><div class="note">${esc(d.note)}</div></div>`); };
  el.querySelector('#x-diag-kind').onchange = e => { ui.diag = e.target.value; draw(); };
  draw();
}

// ---- small-study effects and publication bias --------------------------------------------------------------------

const TEST_NOTES = { Egger: 'Effect on standard error', Begg: 'Rank correlation', Harbord: 'Efficient score', Peters: 'Effect on 1/n', 'Rücker (arcsine)': 'Arcsine difference' };

function bias(host, ctx, a, slot) {
  const el = host.querySelector('#x-bias'); if (!el) return;
  const gate = biasGate(a), b = a.extras?.bias, parts = b ? biasPanels(a, b) : null;
  el.innerHTML = section({ id: 'bias', title: 'Small-study effects', meta: b ? `k = ${b.k}, sensitivity analysis` : 'Sensitivity analysis', body: `
    ${gate.ok ? '' : `<div class="note">${esc(gate.why)}</div>`}
    ${runBar('bias', 'Small-study effects', { id: 'bias-run', label: 'Run', icon: 'run', disabled: !gate.ok })}
    <div id="bias-body">${parts?.tests ? part('Tests', '', parts.tests) : ''}</div>${parts ? parts.rest : ''}<div id="x-selfun"></div>` });
  const fig = el.querySelector('#x-selfun');
  if (fig) {
    const shown = vec(b?.selection).filter(s => s.ok && vec(s.p).length);
    fig.innerHTML = shown.length ? figurePanel({ title: 'Selection functions', id: 'x-sel' }) : '';
    if (shown.length) {
      const models = shown.map(s => ({ ...s, label: SELECTION_TYPES.find(t => t[0] === s.type)?.[1] || s.type, p: vec(s.p), w: vec(s.w) }));
      showFigure(fig, 'x-sel', selectionFunctionSvg(models, { style: figureTokens(null, { medium: 'screen' }) }), 'selection-functions', { exportSvg: () => selectionFunctionSvg(models, { style: figureTokens(null, { medium: 'export' }) }) });
    }
  }
  el.querySelector('#bias-run').onclick = async () => {
    const btn = el.querySelector('#bias-run'), body = el.querySelector('#bias-body'); btn.disabled = true;
    const say = t => { body.innerHTML = `<div class="note">${esc(t)}</div>`; };
    try {
      say('Fitting');
      const values = vec(a.values).map(r => vec(r).map(Number));
      const res = await runR(['metafor', 'svglite'], biasScript({ measure: a.measure, method: fitMethod(a), test: a.settings?.ci ?? a.test, values }), say);
      const out = assembleBias(JSON.parse(res.json), { measure: a.measure, rows: measureOf(a.measure).family === 'binary' ? values : null });
      save(slot, 'bias', { ...out, settings: { fit: 'REML', selection: 'one-sided p in the direction of the pooled estimate', steps: [0.025, 1], etas: ETAS, minK: MIN_K }, rScript: res.rScript });
      ctx.rerender();
    } catch (err) { say(String(err?.message || err).slice(0, 200)); btn.disabled = false; }
  };
}

/** The tables of a saved bias run: `tests` for the panel that holds Run, `rest` the panels after it. */
function biasPanels(a, b) {
  const back = backOf(a.measure) || (x => x), m = esc(a.measure);
  const tests = vec(b.tests);
  const regT = tests.length ? `<table><thead><tr><th class="grow">Test</th><th>Statistic</th><th>p</th><th>Asymmetry</th></tr></thead><tbody>${tests.map(t =>
    `<tr><td class="grow">${esc(t.name)}<span class="meta"> ${esc(TEST_NOTES[t.name] || '')}</span></td><td>${t.df != null ? `t = ${fx(t.statistic)}, df ${t.df}` : `z = ${fx(t.statistic)}`}</td><td>${pv(t.p)}</td>
      <td>${t.bias != null ? `${fx(t.bias)} (SE ${fx(t.se)})` : `τ ${fx(t.tau)}`}</td></tr>`).join('')}</tbody></table>` : '';
  const pp = ['pet', 'peese'].filter(k => ok(b[k])).map(k => [k === 'pet' ? 'PET' : 'PEESE', b[k]]);
  const petT = pp.length ? `<table><thead><tr><th class="grow">Regression</th><th>Effect with no sampling error</th><th>p</th><th>Bias term (p)</th></tr></thead><tbody>${pp.map(([n, r]) =>
    `<tr><td class="grow">${n}<span class="meta"> ${n === 'PET' ? 'on standard error' : 'on variance'}</span></td><td>${ci(r.est, r.lo, r.hi)}</td><td>${pv(r.p)}</td><td>${fx(r.slope)} (${pv(r.slope_p)})</td></tr>`).join('')}</tbody></table>` : '';
  const sel = vec(b.selection);
  const nameOf = t => SELECTION_TYPES.find(x => x[0] === t)?.[1] || t;
  const selT = sel.length ? `<table><thead><tr><th class="grow">Model</th><th>Adjusted ${m}</th><th>τ²</th><th>Selection</th><th>LRT p</th></tr></thead><tbody>${sel.map(s => {
    if (!s.ok) return `<tr><td class="grow">${esc(nameOf(s.type))}</td><td colspan="4">Did not converge</td></tr>`;
    const d = vec(s.delta), dl = d.length > 1 ? d[d.length - 1] : d[0];
    return `<tr><td class="grow">${esc(nameOf(s.type))}</td><td>${ci(s.est, s.lo, s.hi)}</td><td>${fx(s.tau2, 3)}</td><td>${fx(dl, 3)}</td><td>${pv(s.lrt_p)}</td></tr>`; }).join('')}</tbody></table>` : '';
  const warn = sel.flatMap(s => vec(s.warnings).map(w => `<div class="note spaced">${esc(`${nameOf(s.type)}: ${w}`)}</div>`)).join('');
  const v = b.mvw, cell = r => (r ? ci(back(r.est), back(r.lo), back(r.hi)) : '—');
  const eta = r => (r == null || r.eta == null ? 'Not possible' : r.note ? 'Already' : fx(r.eta, 1));
  const mvwT = v ? `<table><thead><tr><th class="grow">Selection ratio</th><th>Common effect</th><th>Random effects</th></tr></thead><tbody>${vec(v.common.rows).map((r, i) =>
    `<tr><td class="grow">${fx(r.eta, 0)}</td><td>${cell(r)}</td><td>${cell(vec(v.robust.rows)[i])}</td></tr>`).join('')}
    <tr><td class="grow">Non-affirmative studies only${v.kN ? ` (k = ${v.kN})` : ''}</td><td>${cell(v.common.worst)}</td><td>${cell(v.robust.worst)}</td></tr>
    <tr><td class="grow">Ratio that shrinks the estimate to the null</td><td>${eta(v.common.sEst)}</td><td>${eta(v.robust.sEst)}</td></tr>
    <tr><td class="grow">Ratio that brings the interval to the null</td><td>${eta(v.common.sCI)}</td><td>${eta(v.robust.sCI)}</td></tr></tbody></table>
    <div class="note">${esc(`${v.kA} of ${v.k} studies are affirmative; publication is assumed to favour ${v.favourPositive ? 'positive' : 'negative'} estimates.`)}</div>` : '';
  const l = b.limit, limT = l ? `<table><thead><tr><th class="grow">Adjusted estimate</th><th>${m}</th><th>p</th></tr></thead><tbody>
    <tr><td class="grow">Study of infinite precision</td><td>${ci(back(l.est), back(l.lo), back(l.hi))}</td><td>${pv(l.p)}</td></tr>
    <tr><td class="grow">Bias parameter α</td><td>${fx(l.alpha)}</td><td></td></tr></tbody></table>` : '';
  const rest = (petT ? part('PET and PEESE', 'Weighted regression', petT) : '') + (selT ? part('Selection models', `k = ${b.k}, REML, ${b.alternative === 'greater' ? 'positive' : 'negative'} direction`, selT + warn) : '')
    + (mvwT ? part('Publication bias sensitivity', 'Mathur–VanderWeele', mvwT) : '') + (limT ? part('Limit meta-analysis', 'Rücker et al.', limT) : '');
  return { tests: regT, rest };
}

// ---- GOSH, as a background job -----------------------------------------------------------------------------------

function gosh(host, ctx, a, slot, inputs) {
  const el = host.querySelector('#x-gosh'); if (!el) return;
  const g = a.extras?.gosh, k = Number(a.k), why = !inputs ? 'Run again to draw it' : k < 3 ? 'Needs three or more studies' : '';
  const running = ui.gosh && ui.gosh.slot === slot && ui.gosh.a === a.at;
  const summary = g ? `${num(g.n)} of ${num(g.requested)} subsets${g.exhaustive ? ', all of them' : `, seeded sample of ${num(g.requested)}`}${g.stopped ? ', stopped' : ''}${g.failed ? `, ${g.failed} did not fit` : ''}` : '';
  const back = backOf(a.measure) || (x => x);
  const inn = vec(g?.meanIncluded), out = vec(g?.meanExcluded), labels = vec(a.labels);
  const order = g ? inn.map((v, i) => [v != null && out[i] != null ? Math.abs(v - out[i]) : 0, i]).sort((x, y) => y[0] - x[0]).slice(0, 8).map(x => x[1]) : [];
  el.innerHTML = section({ id: 'gosh', title: 'GOSH', meta: g ? summary : 'Subsets of the studies', body: `
    <div id="gosh-status">${why ? `<div class="note">${esc(why)}</div>` : ''}</div>
    ${runBar('gosh', 'GOSH', uiSwap({ id: 'gosh-slot', members: [{ id: 'gosh-run', label: 'Run', icon: 'run', disabled: !!(why || running), hidden: !!running }, { id: 'gosh-stop', label: 'Stop', icon: 'stop', hidden: !running }] }))}
    ${g ? `<table><thead><tr><th class="grow">Study</th><th>Mean estimate with it</th><th>Without it</th></tr></thead><tbody>${order.map(i =>
      `<tr><td class="grow">${esc(labels[i] ?? `Study ${i + 1}`)}</td><td>${fx(back(inn[i]))}</td><td>${fx(back(out[i]))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${g ? figurePanel({ title: 'GOSH plot', id: 'x-gosh-fig' }) : ''}` });
  const gosh1 = style => goshSvg({ style, counts: g.counts, xrange: vec(g.xrange), yrange: vec(g.yrange), full: g.full, back, xlabel: `Pooled ${a.measure}` });
  if (g) showFigure(el, 'x-gosh-fig', gosh1(figureTokens(null, { medium: 'screen' })), 'gosh-plot', { exportSvg: () => gosh1(figureTokens(null, { medium: 'export' })) });
  el.querySelector('#gosh-stop').onclick = () => { if (ui.gosh) jobs.cancel(ui.gosh.id); };
  el.querySelector('#gosh-run').onclick = () => runGosh(ctx, a, slot, inputs);
}

async function runGosh(ctx, a, slot, inputs) {
  const status = t => { const host = document.getElementById('gosh-status'); if (!host) return; let n = host.querySelector('.note:not([data-ui-help])') || host.appendChild(Object.assign(document.createElement('div'), { className: 'note' })); host.querySelector('[data-ui-help]')?.remove(); n.textContent = t; };
  const btns = on => { const r = document.getElementById('gosh-run'), s = document.getElementById('gosh-stop'); if (r) { r.disabled = on; r.hidden = on; } if (s) s.hidden = !on; };
  const k = inputs.yi.length, { masks, exhaustive, seed } = subsetMasks(k, { size: SAMPLE_SIZE, seed: 1 });
  const method = fitMethod(a);
  const h = jobs.start('gosh', 'GOSH plot', {});
  ui.gosh = { id: h.id, slot, a: a.at }; btns(true);
  const est = [], i2 = [];
  let stopped = false;
  try {
    for (let i = 0; i < masks.length; i += CHUNK) {
      if (h.stopped()) { stopped = true; break; }
      const part = masks.slice(i, i + CHUNK);
      const res = await runR(['metafor'], goshChunkR({ yi: inputs.yi, vi: inputs.vi, method, masks: part }));
      est.push(...vec(res.est).map(x => (x == null ? NaN : Number(x)))); i2.push(...vec(res.i2).map(x => (x == null ? NaN : Number(x))));
      h.count(est.length, masks.length); h.progress(`${est.length} of ${masks.length}`);
      status(`${num(est.length)} of ${num(masks.length)} subsets`);
    }
    const sum = summariseGosh({ masks: masks.slice(0, est.length), est, i2 }, { est: inputs.mu, i2: Number(a.i2) });
    if (!sum) throw new Error('No subset could be fitted');
    save(slot, 'gosh', { ...sum, exhaustive, seed: exhaustive ? null : seed, requested: masks.length, stopped, method });
    stopped ? h.cancel() : h.done(`${sum.n} subsets`);
  } catch (err) { h.fail(err); status(String(err?.message || err).slice(0, 160)); btns(false); ui.gosh = null; return; }
  ui.gosh = null;
  if (document.getElementById('gosh-run')) ctx.rerender();
}

// ---- dependent effects ------------------------------------------------------------------------------------------

function dependence(host, ctx, a, slot) {
  const el = host.querySelector('#x-dep'); if (!el) return;
  const { dep } = stateFor(slot), d = a.extras?.dependence;
  const papers = vec(a.papers), s = get();
  const cands = fields(s).filter(f => f.custom && papers.some(p => valueFor(s, p, f) != null));
  const why = a.derived ? 'Not available for arms read from a table' : Number(a.k) < 3 ? 'Needs three or more rows' : '';
  const labels = clusterLabels({ papers, values: dep.field ? papers.map(p => valueFor(s, p, cands.find(f => f.id === dep.field))) : null }), shape = clusterShape(labels);
  el.innerHTML = section({ id: 'dep', title: 'Dependent effects', meta: d ? `${d.rows} rows, ${d.clusters} clusters, ρ = ${fx(d.rho, 2)}` : `${shape.rows} rows, ${shape.clusters} clusters`, body: `
    ${why ? `<div class="note">${esc(why)}</div>` : ''}
    <div class="an-settings">
      <label class="field"><span>Cluster</span><select id="dep-field" aria-label="Cluster"><option value="">Study</option>${cands.map(f => `<option value="${esc(f.id)}"${dep.field === f.id ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Correlation within a cluster</span><input id="dep-rho" inputmode="decimal" autocomplete="off" value="${esc(String(dep.rho))}" aria-label="Correlation within a cluster"></label></div>
    ${shape.multi ? '' : '<div class="note spaced">No cluster holds more than one row</div>'}
    <div id="dep-status"></div>
    ${runBar('dep', 'Dependent effects', { id: 'dep-run', label: 'Run', icon: 'run', disabled: !!why })}
    ${d ? depTable(a, d) : ''}` });
  el.querySelector('#dep-field').onchange = e => { dep.field = e.target.value; ctx.rerender(); };
  el.querySelector('#dep-rho').onchange = e => { const v = Number(e.target.value); dep.rho = Number.isFinite(v) ? Math.min(0.99, Math.max(0, v)) : DEFAULT_RHO; };
  el.querySelector('#dep-run').onclick = async () => {
    const btn = el.querySelector('#dep-run'), status = el.querySelector('#dep-status'); btn.disabled = true;
    const say = t => { const n = status.querySelector('.note') || status.appendChild(Object.assign(document.createElement('div'), { className: 'note' })); n.textContent = t; };
    try {
      say('Fitting');
      const values = vec(a.values).map(r => vec(r).map(Number));
      const res = await runR(['metafor', 'svglite'], dependenceScript({ measure: a.measure, method: a.settings?.estimator ?? a.method, test: 'z', values, clusters: labels, rho: dep.rho }), say);
      save(slot, 'dependence', { ...JSON.parse(res.json), rho: dep.rho, clusterField: cands.find(f => f.id === dep.field)?.label || 'Study', shape, rScript: res.rScript });
      ctx.rerender();
    } catch (err) { say(String(err?.message || err).slice(0, 200)); btn.disabled = false; }
  };
}

function depTable(a, d) {
  const row = (name, r, note = '') => (r?.error ? `<tr><td class="grow">${esc(name)}</td><td colspan="2">${esc(String(r.error).slice(0, 90))}</td></tr>`
    : `<tr><td class="grow">${esc(name)}<span class="meta"> ${esc(note)}</span></td><td>${ci(r.est, r.lo, r.hi)}</td><td>${r.dfs != null ? `t, df ${fx(r.dfs, 1)}` : r.sigma2 ? `σ² ${vec(r.sigma2).map(x => fx(x, 3)).join(' + ')}` : r.tau2 != null ? `τ² ${fx(r.tau2, 3)}` : ''}</td></tr>`);
  const rho = vec(d.by_rho);
  return `<table><thead><tr><th class="grow">Analysis</th><th>${esc(a.measure)}</th><th></th></tr></thead><tbody>
    ${row('Independent rows', d.independent, 'as run, REML')}${row('Independent, cluster-robust', d.independent_robust, 'sandwich variance')}
    ${row('Aggregated by cluster', d.aggregated, `ρ = ${fx(d.rho, 2)}`)}${row('Multilevel', d.multilevel, `ρ = ${fx(d.rho, 2)}`)}${row('Multilevel, cluster-robust', d.multilevel_robust, `ρ = ${fx(d.rho, 2)}`)}</tbody></table>
    <table><thead><tr><th class="grow">Assumed ρ</th><th>Aggregated</th><th>Multilevel</th></tr></thead><tbody>${rho.map(r => `<tr><td class="grow">${fx(r.rho, 1)}</td><td>${r.aggregated?.error ? '—' : ci(r.aggregated.est, r.aggregated.lo, r.aggregated.hi)}</td><td>${r.multilevel?.error ? '—' : ci(r.multilevel.est, r.multilevel.lo, r.multilevel.hi)}</td></tr>`).join('')}</tbody></table>`;
}

// ---- missing outcome data ---------------------------------------------------------------------------------------

const SCENARIOS = [['p', 'Missing at their own group’s observed risk'], ['0', 'All missing without the event'], ['1', 'All missing with the event'],
  ['pc', 'Missing at the control group’s risk'], ['pe', 'Missing at the treated group’s risk'], ['b', 'Best case for the treated group'], ['w', 'Worst case for the treated group'], ['imor', 'IMOR set here'], ['gh', 'Uncertainty interval, Gamble–Hollis']];

function missing(host, ctx, a, slot) {
  const el = host.querySelector('#x-miss'); if (!el) return;
  if (!MEASURES_WITH_MISSING.includes(a.measure) || a.derived) { el.innerHTML = ''; return; }
  const { miss } = stateFor(slot), d = a.extras?.missing, s = get(), papers = vec(a.papers);
  const nums = fields(s).filter(f => f.custom && ['number', 'integer'].includes(f.type));
  const sel = (id, label, cur) => `<label class="field"><span>${label}</span><select id="${id}" aria-label="${label}"><option value="">Choose a field</option>${nums.map(f => `<option value="${esc(f.id)}"${cur === f.id ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>`;
  el.innerHTML = section({ id: 'miss', title: 'Missing outcome data', meta: d ? `${d.rows.length} scenarios, sensitivity analysis` : 'Sensitivity analysis', body: `
    <div class="an-settings">${sel('miss-t', 'Missing, treated', miss.treated)}${sel('miss-c', 'Missing, control', miss.control)}
      <label class="field"><span>Event is</span><select id="miss-bad" aria-label="Event is"><option value="1"${miss.eventBad ? ' selected' : ''}>Undesirable</option><option value="0"${miss.eventBad ? '' : ' selected'}>Desirable</option></select></label>
      <label class="field"><span>IMOR, treated</span><input id="miss-ie" inputmode="decimal" autocomplete="off" value="${esc(String(miss.imorE))}" aria-label="IMOR, treated"></label>
      <label class="field"><span>IMOR, control</span><input id="miss-ic" inputmode="decimal" autocomplete="off" value="${esc(String(miss.imorC))}" aria-label="IMOR, control"></label></div>
    ${d ? '' : '<div class="note spaced" data-ui-help>Counts and participants are those with an outcome. Missing participants are added under each assumption; the completers’ result is the primary one.</div>'}
    <div id="miss-status"></div>
    ${runBar('miss', 'Missing outcome data', { id: 'miss-run', label: 'Run', icon: 'run', disabled: !(miss.treated && miss.control) })}
    ${d ? `<table><thead><tr><th class="grow">Assumption for the missing</th><th>k</th><th>${esc(a.measure)}</th><th>I²</th></tr></thead><tbody>
      <tr><td class="grow">Completers, as run<span class="meta"> ${esc(a.method)}</span></td><td>${a.k}</td><td>${ci(a.estimate, a.lo, a.hi)}</td><td>${fx(a.i2, 1)}%</td></tr>
      ${vec(d.rows).map(r => `<tr><td class="grow">${esc(r.label)}</td><td>${r.error ? '' : r.k}</td><td>${r.error ? esc(String(r.error).slice(0, 80)) : ci(r.est, r.lo, r.hi)}</td><td>${r.error ? '' : `${fx(r.i2, 1)}%`}</td></tr>`).join('')}</tbody></table>` : ''}` });
  const read = (id, k, num) => { el.querySelector(id).onchange = e => { miss[k] = num ? Math.max(0, Number(e.target.value) || 0) : e.target.value; if (!num || k === 'eventBad') ctx.rerender(); }; };
  read('#miss-t', 'treated'); read('#miss-c', 'control'); read('#miss-ie', 'imorE', true); read('#miss-ic', 'imorC', true);
  el.querySelector('#miss-bad').onchange = e => { miss.eventBad = e.target.value === '1'; };
  el.querySelector('#miss-run').onclick = async () => {
    const btn = el.querySelector('#miss-run'), body = el.querySelector('#miss-status'); btn.disabled = true;
    const say = t => { let n = body.querySelector('.note'); if (!n) { n = document.createElement('div'); n.className = 'note spaced'; body.append(n); } n.textContent = t; };
    try {
      const ft = nums.find(f => f.id === miss.treated), fc = nums.find(f => f.id === miss.control);
      const values = vec(a.values).map(r => vec(r).map(Number));
      const rows = values.map(([rE, nE, rC, nC], i) => ({ rE, nE, rC, nC, mE: Number(valueFor(s, papers[i], ft)), mC: Number(valueFor(s, papers[i], fc)) }));
      if (rows.some(r => !Number.isFinite(r.mE) || !Number.isFinite(r.mC) || r.mE < 0 || r.mC < 0)) throw new Error('Every study needs a missing count in both fields');
      const scen = SCENARIOS.map(([id, label]) => ({ id, label, eff: rows.map(r => { if (id === 'gh') return gambleHollis(a.measure, r, { correct: true }); const [ie, ic] = id === 'imor' ? [miss.imorE, miss.imorC] : scenarioImors(id, r, { eventBad: miss.eventBad }); return studyEffect(a.measure, r, ie, ic, { correct: true }); }) }));
      const code = scen.map(sc => { const keep = sc.eff.filter(e => Number.isFinite(e.yi) && Number.isFinite(e.vi) && e.vi > 0); sc.k = keep.length; sc.left = sc.eff.length - keep.length; return keep; });
      const back = measureOf(a.measure).ratio ? 'exp' : 'identity';
      const method = ['REML', 'DL', 'EE'].includes(a.settings?.estimator ?? a.method) ? (a.settings?.estimator ?? a.method) : 'EE';
      const test = ['knha', 'adhoc'].includes(a.settings?.ci ?? a.test) ? (a.settings?.ci ?? a.test) : 'z';
      const script = `
        tf <- function(x) ${back === 'exp' ? 'exp(x)' : 'x'}
        fit <- function(yi, vi) tryCatch({ r <- rma(yi, vi, method="${method}"${test !== 'z' && method !== 'EE' ? `, test="${test}"` : ''}); list(est=tf(r$beta[1]), lo=tf(r$ci.lb), hi=tf(r$ci.ub), i2=r$I2, k=r$k) }, error=function(e) list(error=conditionMessage(e)))
        res <- list(${code.map(keep => `fit(c(${keep.map(e => e.yi).join(',')}), c(${keep.map(e => e.vi).join(',')}))`).join(',')})
        list(json = as.character(jsonlite::toJSON(res, auto_unbox=TRUE, digits=NA, null="null", na="null")))`;
      say('Fitting');
      const res = await runR(['metafor', 'svglite'], script, say);
      const fits = JSON.parse(res.json);
      save(slot, 'missing', { rows: scen.map((sc, i) => ({ id: sc.id, label: sc.label, ...fits[i], k: fits[i].k ?? sc.k, left: sc.left })), settings: { treated: ft.label, control: fc.label, eventBad: miss.eventBad, imorE: miss.imorE, imorC: miss.imorC, method, test, correction: '0.5 added to the observed counts of a study with a zero cell, before imputation', gh: 'Gamble–Hollis (2005): each study keeps its completers’ effect; its standard error is the width of the interval from the lower limit in the worst case to the upper limit in the best case, over 2 × 1.96' }, rScript: res.rScript });
      ctx.rerender();
    } catch (err) { say(String(err?.message || err).slice(0, 200)); btn.disabled = false; }
  };
}

// ---- fragility ---------------------------------------------------------------------------------------------------

const FRAG_MEASURES = ['OR', 'RR', 'RD'], FRAG_STEPS = 100, FRAG_TRIAL_STEPS = 100, FRAG_ALPHA = 0.05;
/** Cells of work a Fisher search of one trial would take; a trial beyond the budget is not searched. */
const fragCost = ([e1, n1, e0, n0]) => 2 * FRAG_TRIAL_STEPS ** 2 * Math.min(e0 + e1, n0 + n1 - e0 - e1);

function fragility(host, ctx, a, slot) {
  const el = host.querySelector('#x-frag'); if (!el) return;
  const rows = countRows(a);
  if (!FRAG_MEASURES.includes(a.measure) || a.derived || !rows) { el.innerHTML = ''; return; }
  const f = a.extras?.fragility, back = backOf(a.measure) || (x => x), labels = vec(a.labels), k = rows.length, why = k >= 2 ? '' : 'Needs two or more studies';
  const pooled = f && (f.fi != null
    ? `<tr><th>Fragility index</th><td>${f.fi} event ${f.fi === 1 ? 'status' : 'statuses'} changed</td></tr><tr><th>Fragility quotient</th><td>${fx(f.fi / f.n, 4)} of ${num(f.n)} participants</td></tr>`
    : `<tr><th>Fragility index</th><td>${f.reason === 'limit' ? `Not reached in ${f.limit ?? FRAG_STEPS} changes` : f.reason === 'exhausted' ? 'Cannot be altered by changing event status' : 'Not found'}</td></tr>`);
  const chg = s => `${s.change < 0 ? 'Event removed' : 'Event added'}`;
  const stepsT = f && vec(f.steps).length ? `<table><thead><tr><th>No.</th><th class="grow">Study and change</th><th>${esc(a.measure)}</th></tr></thead><tbody>${vec(f.steps).slice(0, 12).map((s, i) =>
    `<tr><td>${i + 1}</td><td class="grow">${esc(labels[s.study - 1] ?? `Study ${s.study}`)}<span class="meta"> ${s.arm === 0 ? 'control' : 'treated'}, ${chg(s).toLowerCase()}</span></td><td>${ci(back(s.est), back(s.lo), back(s.hi))}</td></tr>`).join('')}${vec(f.steps).length > 12 ? `<tr><td></td><td class="grow">${vec(f.steps).length - 12} more changes</td><td></td></tr>` : ''}</tbody></table>` : '';
  const studyT = f && vec(f.studies).length ? `<table><thead><tr><th class="grow">Trial</th><th>p</th><th>Index</th><th>Quotient</th></tr></thead><tbody>${vec(f.studies).map((s, i) =>
    `<tr><td class="grow">${esc(labels[i] ?? `Study ${i + 1}`)}<span class="meta"> ${rows[i][0]}/${rows[i][1]} vs ${rows[i][2]}/${rows[i][3]}</span></td><td>${s.skipped ? '' : pv(s.p)}</td><td>${s.skipped ? 'Not searched' : s.fi != null ? s.fi : `Over ${s.maxF}`}</td><td>${s.fq != null ? fx(s.fq, 4) : ''}</td></tr>`).join('')}</tbody></table>` : '';
  el.innerHTML = section({ id: 'frag', title: 'Fragility', meta: f ? `${f.significant ? 'Significant' : 'Not significant'} at ${fx(f.alpha * 100, 0)}%, exploratory` : 'Exploratory', body: `
    ${why ? `<div class="note">${esc(why)}</div>` : ''}
    ${runBar('frag', 'Fragility', { id: 'frag-run', label: 'Run', icon: 'run', disabled: !!why })}
    <div id="frag-body">${why ? '' : f ? `<table><tbody><tr><th>Direction</th><td>${esc(f.direction.charAt(0).toUpperCase() + f.direction.slice(1))}${f.side ? `, interval moved ${f.side} the null` : ''}</td></tr>${pooled}</tbody></table>` : ''}</div>
    ${stepsT}${studyT}` });
  el.querySelector('#frag-run').onclick = async () => {
    const btn = el.querySelector('#frag-run'), body = el.querySelector('#frag-body'); btn.disabled = true;
    const say = t => { body.innerHTML = `<div class="note">${esc(t)}</div>`; };
    try {
      say('Fitting');
      const t = a.settings?.ci ?? a.test, res = await runR(['metafor', 'svglite'], fragilityScript({ measure: a.measure, method: fitMethod(a), test: ['knha', 'adhoc'].includes(t) ? t : 'z', values: rows, alpha: FRAG_ALPHA, maxSteps: FRAG_STEPS }), say);
      const out = JSON.parse(res.json);
      await new Promise(r => setTimeout(r, 0));
      const studies = rows.map(([e1, n1, e0, n0], i) => { if (fragCost(rows[i]) > 3e8) return { skipped: true }; const r = fragilityStudy(e0, n0, e1, n1, { alpha: FRAG_ALPHA, maxF: FRAG_TRIAL_STEPS }); return { p: r.p, significant: r.significant, fi: r.fi, fq: r.fq, maxF: r.maxF }; });
      save(slot, 'fragility', { ...out, steps: vec(out.steps), studies, limit: FRAG_STEPS, settings: { estimator: fitMethod(a), test: ['knha', 'adhoc'].includes(t) ? t : 'z', trialMaxChanges: FRAG_TRIAL_STEPS }, rScript: res.rScript });
      ctx.rerender();
    } catch (err) { say(String(err?.message || err).slice(0, 200)); btn.disabled = false; }
  };
}

// ---- LFK index and Doi plot --------------------------------------------------------------------------------------

function lfk(host, ctx, a, slot, inputs) {
  const el = host.querySelector('#x-lfk'); if (!el) return;
  const l = a.extras?.lfk, back = backOf(a.measure);
  if (!backOf(a.measure)) { el.innerHTML = ''; return; }
  const why = !inputs ? 'Run again to draw it' : inputs.yi.length < 3 ? 'Needs three or more studies' : '';
  el.innerHTML = section({ id: 'lfk', title: 'LFK index and Doi plot', meta: l ? `k = ${l.k}, exploratory` : 'Exploratory', body: `
    ${why ? `<div class="note">${esc(why)}</div>` : ''}
    <div class="note${l ? ' spaced' : ''}" data-ui-help>Exploratory picture, not a test: its false positives depend on study number, size and heterogeneity (Schwarzer, Rücker and Semaca 2024).</div>
    ${runBar('lfk', 'LFK index', { id: 'lfk-run', label: 'Run', icon: 'run', disabled: !!why })}
    ${l ? `<table><tbody><tr><th>LFK index</th><td>${fx(l.lfk, 2)}</td></tr><tr><th>Furuya-Kanamori cut-offs</th><td>${l.interpretation === 'no asymmetry' ? 'Within ±1' : l.interpretation === 'minor asymmetry' ? 'Between ±1 and ±2' : 'Beyond ±2'}</td></tr></tbody></table>` : ''}
    <div id="x-doi"></div>` });
  const fig = el.querySelector('#x-doi');
  if (fig) { fig.innerHTML = l ? figurePanel({ title: 'Doi plot', id: 'x-doi-fig' }) : ''; if (l) { const doi1 = style => doiSvg({ style, te: vec(l.te), absZ: vec(l.absZ), lfk: l.lfk, labels: vec(l.labels), back, xlabel: a.measure }); showFigure(fig, 'x-doi-fig', doi1(figureTokens(null, { medium: 'screen' })), 'doi-plot', { exportSvg: () => doi1(figureTokens(null, { medium: 'export' })) }); } }
  el.querySelector('#lfk-run').onclick = () => {
    const r = lfkIndex(inputs.yi, inputs.vi); if (!r) return;
    const labels = inputs.labels.length === inputs.yi.length ? inputs.labels : inputs.yi.map((_, i) => `Study ${i + 1}`);
    save(slot, 'lfk', { lfk: r.lfk, interpretation: r.interpretation, k: r.k, te: r.te, absZ: r.absZ, labels: r.order.map(i => labels[i]) });
    ctx.rerender();
  };
}
