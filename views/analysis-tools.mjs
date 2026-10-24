// Calculators for the analysis: the power of a meta-analysis (Hedges and Pigott), effect-size conversions, trial design,
// sample size, diagnostic accuracy, epidemiology and rates. One calculator is open at a time: the title bar names it (the title is a
// picker of the calculators, toolsPage), holds its Calculate and, in More, the commands that act on its result. Nothing here is saved to the review except what Keep in protocol
// writes: a converted value is copied out with its method and inputs, which is what marks it as converted wherever it is used
// (lib/conversions.mjs).
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { outcomes, analysisOf } from '../lib/outcomes.mjs';
import { measureOf } from '../lib/effect-measures.mjs';
import { meanPower, qPower } from '../lib/power.mjs';
import { medianToMeanSd, CONVERSION_METHODS, sdFromSummary, countsToEffect } from '../lib/conversions.mjs';
import { sampleSizeProportions, sampleSizeMeans, randomisationList, randomisationCsv } from '../lib/trial-tools.mjs';
import { update } from '../store.mjs';
import { downloadCsv, figurePanel, showFigure } from '../lib/figure.mjs';
import * as ss from '../lib/sample-size.mjs';
import { diagnostic2x2, epi2x2, rateComparison, smr, directStandardise } from '../lib/clinical-epi.mjs';
import { faganSvg } from '../lib/clinical-plots.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { pValue } from '../lib/describe.mjs';
import { uiBar, uiRowEnd } from '../lib/ui-actions.mjs';
import { formField, formFit, tableRegion } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { copyText } from '../lib/clipboard.mjs';
import { allocationPanel, wireAllocationPanel, sealForEnrolment } from './allocation-panel.mjs';

const ui = { calc: 'power', power: { source: '', k: 10, v: 0.05, theta: '0.7', tau2: 0.05, alpha: 0.05, ratio: true }, conv: { kind: 'wan', method: 'wan', v: {} },
  trial: { kind: 'prop', p1: '0.30', p2: '0.20', delta: '5', sd: '12', alpha: 0.05, power: 0.8, ratio: 1, dropout: 0.1, n: 100, arms: 'A, B', blocks: '4, 6', strata: '', seed: 1 } };
const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
const fx = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
const num = t => { const x = Number(String(t ?? '').replace(',', '.')); return String(t ?? '').trim() === '' ? NaN : x; };

export const toolsLine = () => 'Power, conversions, sample size, diagnostic, epidemiology, rates';

// The calculators, in the order the picker lists them. `sub` is the title bar's status (24 characters at most).
const CALCS = [
  { id: 'power', title: 'Power', sub: 'Pooled effect and Q test' },
  { id: 'conv', title: 'Conversions', sub: 'Median, SE or 2×2 counts' },
  { id: 'trial', title: 'Trial design', sub: 'Sample size, two groups' },
  { id: 'random', title: 'Randomisation', sub: 'Blocked allocation list' },
  { id: 'ss', title: 'Sample size', sub: 'Primary study designs' },
  { id: 'dx', title: 'Diagnostic test', sub: 'Accuracy from 2×2 counts' },
  { id: 'epi', title: 'Epidemiology 2×2', sub: 'Exposure by outcome' },
  { id: 'rate', title: 'Rates', sub: 'Rates, SMR, standardised' },
];
/** The calculators the picker lists, in order, and the way to open one (the view's own state; a test drives it without a menu). */
export const CALCULATORS = Object.freeze(CALCS.map(({ id, title, sub }) => Object.freeze({ id, title, sub })));
export const openCalculator = id => { if (CALCS.some(c => c.id === id)) ui.calc = id; };
// What a calculator's result can be used for: commands in the title bar's More, enabled once there is a result.
const RESULT_ACTS = {
  conv: [{ id: 'calc-copy', label: 'Copy with derivation' }],
  trial: [{ id: 'calc-keep', label: 'Keep in protocol' }],
  random: [{ id: 'calc-csv', label: 'Download allocation list' }, { id: 'calc-seal', label: 'Seal for enrolment' }],
  ss: [{ id: 'calc-keep', label: 'Keep in protocol' }, { id: 'calc-copy', label: 'Copy sentence' }],
};
// The title bar's commands are pressed after the page is drawn: Calculate runs the open calculator's, and a result command runs the
// handler its last result left (none until Calculate has one). The bar is drawn before the page, so a result command finds its button there.
let calculate = null;
const onResult = {};
/** Copies a result and says, in the result's own status line, whether it was (the clipboard can refuse). */
const copyResult = async (out, text) => {
  const ok = await copyText(text);
  const note = out.querySelector('#calc-note') || out.appendChild(Object.assign(document.createElement('p'), { id: 'calc-note', className: 'meta' }));
  note.setAttribute('role', 'status'); note.textContent = ok ? 'Copied' : 'Could not copy';
};
const resultAct = (id, fn) => { onResult[id] = fn || null; const b = document.querySelector(`#${id}`); if (b) b.disabled = !fn; };

/** The calculators' part of the title bar (views/analysis.mjs page()): the open calculator is the title and a picker of them all. */
export function toolsPage(rerender) {
  const c = CALCS.find(x => x.id === ui.calc) || CALCS[0];
  return { title: c.title,
    titleMenu: anchor => showMenu(anchor, CALCS.map(x => ({ label: x.title, checked: x.id === c.id, run: () => { ui.calc = x.id; rerender(); } }))),
    actions: [{ id: 'calc-run', label: 'Calculate', icon: 'run', role: 'primary', run: () => calculate?.() }],
    overflow: (RESULT_ACTS[c.id] || []).map(a => ({ ...a, disabled: true, run: () => onResult[a.id]?.() })) };
}
// A table in a result is wide data: it scrolls in a named region, never past the pane. Results are tables of class calc-res: a label
// column and its values beside it (right-aligned figures), as wide as their content; the cells keep the row inset and the table stands
// out by that inset, so its text starts on the form's left edge and its rules and row fill reach past it (research-views.css).
const put = (out, html) => { out.innerHTML = html.replace(/<table\b[\s\S]*?<\/table>/g, t => `<div class="calc-table">${tableRegion({ label: 'Result', html: t })}</div>`); };
const res = (rows, head = '') => `<table class="calc-res">${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${rows.join('')}</tbody></table>`;
const pair = (label, value) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
/** What a calculator says when its values cannot be used: one note, where the result would be. */
const msg = text => `<p class="note calc-msg" role="status">${esc(text)}</p>`;
const method = text => `<p class="meta">${esc(text)}</p>`;
/** A form of fields (formField html strings) as one grid whose column counts leave no field alone (formFit). */
const grid = (fields, attrs = '') => `<div class="an-settings"${attrs}${formFit(fields.map(f => (f.includes('data-span="2"') ? 2 : 1)))}>${fields.join('')}</div>`;
// A number is typed into a text box (inputmode decimal): no spinner, a comma accepted as the decimal mark (num), and the same box as text.
const numBox = ({ id, span = 1 }, label, value, aria = label, extra = '') => formField(label, `<input id="${id}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(value)}" aria-label="${esc(aria)}"${extra}>`, { span });
const textBox = ({ id }, label, value, aria = label, span = 1) => formField(label, `<input id="${id}" autocomplete="off" spellcheck="false" value="${esc(value)}" aria-label="${esc(aria)}">`, { span });
const pick = ({ id }, label, options, current, span = 1, attrs = '') => formField(label, `<select id="${id}" aria-label="${esc(label)}"${attrs}>${options.map(([k, l]) => `<option value="${esc(k)}"${String(current) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`, { span });
const cap = t => String(t ?? '').replace(/^./, c => c.toUpperCase());
const keepSentence = sentence => update(st => { st.protocol = { ...(st.protocol || { title: '', pico: {}, criteria: [] }), sampleSize: sentence }; return st; });

export function renderTools(el, ctx) {
  const s = get(), c = CALCS.find(x => x.id === ui.calc) || CALCS[0];
  ui.calc = c.id;
  const mod = MODULES[c.id];
  for (const k of Object.keys(onResult)) delete onResult[k];
  el.innerHTML = `<div class="panel" id="calc">
    <div class="panel-body">${mod.html(s)}<div id="calc-out"></div></div></div>${c.id === 'random' ? allocationPanel(s) : ''}`;
  calculate = mod.wire(el, ctx, el.querySelector('#calc-out'), s);
  if (c.id === 'random') wireAllocationPanel(el, () => ctx.rerender());
  if (mod.auto) calculate();
}

// ---- power ---------------------------------------------------------------------------------------------------------

const POWER = {
  auto: true,
  html(s) {
    const p = ui.power, results = outcomes(s).map(o => [o, analysisOf(s, o.id)]).filter(([, a]) => a && vec(a.vi).length);
    if (!p.source && results.length) p.source = results[0][0].id;
    const src = results.find(([o]) => o.id === p.source);
    // the source names an outcome (a long name), so it takes two cells: 8 cells planned, 5 from an outcome
    return grid([
      pick({ id: 'pw-src' }, 'Studies', [...results.map(([o]) => [o.id, o.name]), ['', 'Planned']], src ? p.source : '', 2),
      ...(src ? [] : [numBox({ id: 'pw-k' }, 'Number of studies', p.k), numBox({ id: 'pw-v' }, 'Variance of each effect', p.v),
        pick({ id: 'pw-scale' }, 'Scale', [['1', 'Ratio (log scale)'], ['0', 'Difference']], p.ratio ? '1' : '0')]),
      numBox({ id: 'pw-theta' }, 'True effect', p.theta), numBox({ id: 'pw-tau2' }, 'Between-study variance τ²', p.tau2, 'Between-study variance'),
      numBox({ id: 'pw-alpha' }, 'Significance level', p.alpha)]);
  },
  wire(el, ctx, out, s) {
    const p = ui.power, results = outcomes(s).map(o => [o, analysisOf(s, o.id)]).filter(([, a]) => a && vec(a.vi).length);
    const src = results.find(([o]) => o.id === p.source);
    el.querySelector('#pw-src').onchange = e => { p.source = e.target.value; ctx.rerender(); };
    return () => {
      p.theta = el.querySelector('#pw-theta').value; p.tau2 = num(el.querySelector('#pw-tau2').value); p.alpha = num(el.querySelector('#pw-alpha').value);
      let vi, ratio;
      if (src) { vi = vec(src[1].vi).map(Number); ratio = measureOf(src[1].measure).ratio; }
      else { p.k = Math.round(num(el.querySelector('#pw-k').value)); p.v = num(el.querySelector('#pw-v').value); p.ratio = el.querySelector('#pw-scale').value === '1'; ratio = p.ratio; vi = Array(p.k).fill(p.v); }
      const t = num(p.theta), theta = ratio ? Math.log(t) : t;
      if (!Number.isFinite(theta) || (ratio && !(t > 0)) || !(p.tau2 >= 0) || !(p.alpha > 0 && p.alpha < 1) || vi.length < 2 || vi.some(v => !(v > 0))) { put(out, msg('Check the values')); return; }
      const m = meanPower({ theta, vi, tau2: p.tau2, alpha: p.alpha }), q = qPower({ vi, tau2: p.tau2, alpha: p.alpha });
      put(out, res([pair('Power of the test of the pooled effect', `${fx(m.power * 100, 1)}%`), pair('Power of the Q test of homogeneity', `${fx(q.power * 100, 1)}%`),
        pair('Standard error of the pooled effect', fx(m.se, 4)), pair('Studies', vi.length)]));
    };
  },
};

// ---- conversions ---------------------------------------------------------------------------------------------------

const CV_FIELDS = { wan: [['n', 'Sample size'], ['min', 'Minimum'], ['q1', 'Q1'], ['median', 'Median'], ['q3', 'Q3'], ['max', 'Maximum']],
  sd: [['text', 'Standard error, or CI as lower to upper'], ['n', 'Sample size']], or: [['a', 'Events, treated'], ['b', 'Non-events, treated'], ['c', 'Events, control'], ['d', 'Non-events, control'], ['measure', 'Measure']] };

const CONV = {
  html() {
    const v = ui.conv.v[ui.conv.kind] ||= {};
    // the CI is typed as text ("1.2 to 3.4") and takes two cells; the method names two papers and takes two
    const one = ([k, l]) => (k === 'measure' ? pick({ id: `cv-${k}` }, l, [['OR', 'Odds ratio'], ['RR', 'Risk ratio']], v[k] === 'RR' ? 'RR' : 'OR', 1, ` data-cv="${k}"`)
      : formField(l, `<input data-cv="${k}"${k === 'text' ? '' : ' inputmode="decimal"'} autocomplete="off" spellcheck="false" value="${esc(v[k] ?? '')}" aria-label="${esc(l)}">`, { span: k === 'text' ? 2 : 1 }));
    const fields = CV_FIELDS[ui.conv.kind].map(one);
    // the 95% CI box comes after the sample size, so its two cells start a row of a two- or four-column grid
    if (ui.conv.kind === 'sd') fields.reverse();
    return grid([pick({ id: 'cv-kind' }, 'From', [['wan', 'Median, range, quartiles'], ['sd', 'Standard error or 95% CI'], ['or', '2×2 counts']], ui.conv.kind),
      ...(ui.conv.kind === 'wan' ? [pick({ id: 'cv-method' }, 'Method', CONVERSION_METHODS, ui.conv.method, 2, ' data-cvm')] : []), ...fields]);
  },
  wire(el, ctx, out) {
    const v = ui.conv.v[ui.conv.kind] ||= {};
    el.querySelectorAll('[data-cv]').forEach(x => x.onchange = () => { v[x.dataset.cv] = x.value; });
    const mSel = el.querySelector('[data-cvm]'); if (mSel) mSel.onchange = () => { ui.conv.method = mSel.value; };
    el.querySelector('#cv-kind').onchange = e => { ui.conv.kind = e.target.value; ctx.rerender(); };
    return () => {
      el.querySelectorAll('[data-cv]').forEach(x => { v[x.dataset.cv] = x.value; });
      let r, rows = [];
      if (ui.conv.kind === 'wan') { r = medianToMeanSd({ n: num(v.n), min: num(v.min), q1: num(v.q1), median: num(v.median), q3: num(v.q3), max: num(v.max) }, ui.conv.method); if (!r.error) rows = [['Mean', fx(r.mean, 2)], ['SD', fx(r.sd, 2)]]; }
      else if (ui.conv.kind === 'sd') { r = sdFromSummary(v.text, num(v.n)); if (!r.error) rows = [['SD', fx(r.sd, 3)]]; }
      else { r = countsToEffect({ a: num(v.a), b: num(v.b), c: num(v.c), d: num(v.d), measure: v.measure === 'RR' ? 'RR' : 'OR' }); if (!r.error) rows = [[v.measure === 'RR' ? 'RR' : 'OR', `${fx(r.estimate, 3)} [${fx(r.lo, 3)}, ${fx(r.hi, 3)}]`]]; }
      const inputs = Object.entries(r.inputs || {}).filter(([, x]) => x != null && !Number.isNaN(x)).map(([k, x]) => `${k} = ${x}`).join(', ');
      put(out, r.error ? msg(r.error) : `${res(rows.map(([l, x]) => pair(esc(l), esc(x))))}${method(`Converted (${r.method})`)}${inputs ? method(`Inputs: ${inputs}`) : ''}`);
      resultAct('calc-copy', r.error ? null : () => copyResult(out, r.derivation));
    };
  },
};

// ---- trial design: sample size for two groups ----------------------------------------------------------------------

const TRIAL = {
  html() {
    const t = ui.trial;
    // the outcome type takes two cells: 8, so two or four columns of fields and no field alone
    return grid([pick({ id: 'td-kind' }, 'Outcome', [['prop', 'Two proportions'], ['means', 'Two means']], t.kind === 'means' ? 'means' : 'prop', 2),
      ...(t.kind === 'means' ? [numBox({ id: 'td-delta' }, 'Difference in means', t.delta), numBox({ id: 'td-sd' }, 'Standard deviation', t.sd)]
        : [numBox({ id: 'td-p1' }, 'Proportion, control', t.p1, 'Proportion in the control group'), numBox({ id: 'td-p2' }, 'Proportion, intervention', t.p2, 'Proportion in the intervention group')]),
      numBox({ id: 'td-alpha' }, 'Significance level', t.alpha), numBox({ id: 'td-power' }, 'Power', t.power),
      numBox({ id: 'td-ratio' }, 'Allocation ratio', t.ratio, 'Allocation ratio, intervention to control'), numBox({ id: 'td-drop' }, 'Expected dropout', t.dropout, 'Expected dropout, as a fraction')]);
  },
  wire(el, ctx, out) {
    const t = ui.trial;
    el.querySelector('#td-kind').onchange = e => { t.kind = e.target.value; ctx.rerender(); };
    return () => {
      t.alpha = num(el.querySelector('#td-alpha').value); t.power = num(el.querySelector('#td-power').value); t.ratio = num(el.querySelector('#td-ratio').value); t.dropout = num(el.querySelector('#td-drop').value) || 0;
      let r, said;
      if (t.kind === 'means') { t.delta = el.querySelector('#td-delta').value; t.sd = el.querySelector('#td-sd').value; r = sampleSizeMeans({ delta: num(t.delta), sd: num(t.sd), alpha: t.alpha, power: t.power, ratio: t.ratio, dropout: t.dropout }); said = `a difference of ${t.delta} (SD ${t.sd})`; }
      else { t.p1 = el.querySelector('#td-p1').value; t.p2 = el.querySelector('#td-p2').value; r = sampleSizeProportions({ p1: num(t.p1), p2: num(t.p2), alpha: t.alpha, power: t.power, ratio: t.ratio, dropout: t.dropout }); said = `${t.p1} against ${t.p2}`; }
      if (!r) { put(out, msg('Two different values are needed')); resultAct('calc-keep', null); return; }
      const sentence = `Sample size: ${r.n1} control and ${r.n2} intervention participants (${r.n1 + r.n2}) detect ${said} with ${Math.round(t.power * 100)}% power at a two-sided ${t.alpha} level; ${r.total} enrolled allowing for ${Math.round(t.dropout * 100)}% dropout.`;
      put(out, `${res([pair('Per group, control and intervention', `${r.n1} and ${r.n2}`), pair('Analysed in all', r.n1 + r.n2),
        pair('To enrol, allowing for dropout', `${r.n1Enrol} and ${r.n2Enrol} (${r.total})`)])}<p class="meta" id="calc-note" role="status"></p>`);
      resultAct('calc-keep', () => { keepSentence(sentence); out.querySelector('#calc-note').textContent = 'Kept with the protocol'; });
    };
  },
};

// ---- randomisation: an allocation list reproduced from its seed -----------------------------------------------------

const RANDOM = {
  html() {
    const t = ui.trial;
    // strata are a list typed as text and take two cells: 6, so two or three columns
    return grid([numBox({ id: 'rl-n' }, 'Participants to allocate', t.n), textBox({ id: 'rl-arms' }, 'Arms', t.arms, 'Arm names, separated by commas'),
      textBox({ id: 'rl-blocks' }, 'Block sizes', t.blocks, 'Block sizes, separated by commas'), numBox({ id: 'rl-seed' }, 'Seed', t.seed),
      textBox({ id: 'rl-strata' }, 'Strata', t.strata, 'Strata, separated by commas; blank for none', 2)]);
  },
  wire(el, ctx, out) {
    const t = ui.trial;
    let list = null, sealWith = null;
    // sealing keeps the list's settings, not the list: the sealed list is drawn again from a new random seed (allocation-panel.mjs)
    const csv = () => { if (list) downloadCsv(randomisationCsv(list), `allocation-seed-${list.seed}.csv`); };
    const seal = async () => { if (!sealWith) return; const r = await sealForEnrolment(sealWith); if (r.ok) ctx.rerender(); else if (r.error) out.insertAdjacentHTML('afterbegin', msg(r.error)); };
    return () => {
      t.n = Math.round(num(el.querySelector('#rl-n').value)); t.arms = el.querySelector('#rl-arms').value; t.blocks = el.querySelector('#rl-blocks').value; t.strata = el.querySelector('#rl-strata').value; t.seed = Math.round(num(el.querySelector('#rl-seed').value)) || 1;
      const arms = t.arms.split(',').map(x => x.trim()).filter(Boolean), blocks = t.blocks.split(',').map(x => Math.round(num(x))).filter(x => x > 0), strata = t.strata.split(',').map(x => x.trim()).filter(Boolean);
      list = randomisationList({ n: t.n, arms, blockSizes: blocks, seed: t.seed, strata: strata.length ? strata : [''] });
      if (!list) { put(out, msg('Two arms and a number are needed')); resultAct('calc-csv', null); resultAct('calc-seal', null); sealWith = null; return; }
      resultAct('calc-csv', csv); resultAct('calc-seal', seal);
      sealWith = { n: t.n, arms, blockSizes: blocks, seed: t.seed, strata: strata.length ? strata : [''] };
      // the list: a participant's number and block are figures (right), the stratum and arm are names (left: class calc-name)
      put(out, `${method(`${Object.entries(list.counts).map(([a, n]) => `${a} ${n}`).join(', ')}; blocks of ${list.blockSizes.join(' or ')}; seed ${list.seed}`)}
        <table class="calc-res"><thead><tr>${strata.length ? '<th class="calc-name">Stratum</th>' : ''}<th>Participant</th><th>Block</th><th class="calc-name">Allocation</th></tr></thead><tbody>${list.rows.slice(0, 40).map(r => `<tr>${strata.length ? `<td class="calc-name">${esc(r.stratum)}</td>` : ''}<td>${r.id}</td><td>${r.block}</td><td class="calc-name">${esc(r.arm)}</td></tr>`).join('')}</tbody></table>
        ${list.rows.length > 40 ? method(`${list.rows.length - 40} more rows in the CSV`) : ''}`);
    };
  },
};

// ---- calculators on lib/sample-size.mjs and lib/clinical-epi.mjs --------------------------------

// Each design: the sample-size function and its fields [key, label, default]; a blank optional field is left out.
const A = ['alpha', 'Significance level', 0.05], P = ['power', 'Power', 0.8], R = ['ratio', 'Allocation ratio', 1], D = ['dropout', 'Expected dropout', 0.1], C = ['conf', 'Confidence level', 0.95];
const DESIGNS = [
  ['meansTwoExact', 'Two means, t-test', [['delta', 'Difference in means', 5], ['sd', 'Standard deviation', 12], A, P, R, D]],
  ['meansPaired', 'Paired means', [['delta', 'Mean difference', 3], ['sdDiff', 'SD of differences', 8], A, P, D]],
  ['meansOne', 'One mean against a value', [['delta', 'Difference from the value', 3], ['sd', 'Standard deviation', 10], A, P, D]],
  ['meanPrecision', 'A mean to a precision', [['sd', 'Standard deviation', 10], ['precision', 'Precision, ±', 2], C, D]],
  ['proportionsTwoCC', 'Two proportions', [['p1', 'Proportion, control', 0.3], ['p2', 'Proportion, intervention', 0.2], A, P, R, D]],
  ['proportionsPaired', 'Paired proportions, McNemar', [['p10', 'Discordant, yes then no', 0.2], ['p01', 'Discordant, no then yes', 0.08], A, P, D]],
  ['proportionOne', 'One proportion against a value', [['p0', 'Reference proportion', 0.5], ['p1', 'Expected proportion', 0.65], A, P, D]],
  ['prevalence', 'A prevalence to a precision', [['p', 'Expected prevalence', 0.2], ['precision', 'Precision, ±', 0.05], C, ['population', 'Population size', ''], ['designEffect', 'Design effect', 1], D]],
  ['schoenfeldEvents', 'Survival, log-rank (Schoenfeld)', [['hr', 'Hazard ratio', 0.7], A, P, R, ['pEvent', 'Probability of an event', 0.4], D]],
  ['freedmanEvents', 'Survival, log-rank (Freedman)', [['hr', 'Hazard ratio', 0.7], A, P, R, ['pEvent', 'Probability of an event', 0.4], D]],
  ['withAccrual', 'Survival with accrual', [['accrualTime', 'Accrual time', 24], ['followUp', 'Further follow-up', 12], ['medianControl', 'Median survival, control', 18], ['hr', 'Hazard ratio', 0.7], A, P, R, D]],
  ['buderer', 'Sensitivity and specificity', [['se', 'Expected sensitivity', 0.85], ['sp', 'Expected specificity', 0.9], ['prevalence', 'Prevalence', 0.2], ['precision', 'Precision, ±', 0.07], C, D]],
  ['aucHanleyMcNeil', 'Area under the ROC curve', [['auc', 'Expected AUC', 0.8], ['precision', 'Precision, ±', 0.05], ['auc0', 'Null AUC, to test instead', ''], C, A, P, ['ratio', 'Non-cases per case', 1], D]],
  ['nonInferiorityMeans', 'Non-inferiority, means', [['margin', 'Margin', 3], ['sd', 'Standard deviation', 10], ['delta', 'True difference', 0], ['alpha', 'One-sided significance level', 0.025], P, R, D]],
  ['nonInferiorityProportions', 'Non-inferiority, proportions', [['p1', 'Proportion, new', 0.85], ['p2', 'Proportion, control', 0.85], ['margin', 'Margin', 0.1], ['alpha', 'One-sided significance level', 0.025], P, R, D]],
  ['correlation', 'A correlation', [['r', 'Expected correlation', 0.3], A, P, D]],
  ['regressionEPV', 'Regression, events per variable', [['parameters', 'Candidate parameters', 8], ['prevalence', 'Outcome prevalence', 0.2], ['epv', 'Events per parameter', 10], D]],
  ['rileyBinary', 'Prediction model, binary (Riley)', [['parameters', 'Candidate parameters', 10], ['prevalence', 'Outcome prevalence', 0.2], ['rsquaredCS', 'Cox–Snell R²', 0.1], ['shrinkage', 'Target shrinkage', 0.9], D]],
];
const calc = {
  ss: { design: 'meansTwoExact', v: {}, m: '', icc: '' },
  dx: { tp: '45', fp: '15', fn: '5', tn: '135', pre: '' },
  epi: { design: 'cohort', outcome: 'adverse', a: '30', b: '70', c: '15', d: '85' },
  rate: { e1: '30', t1: '1200', e2: '18', t2: '1500', per: '1000', o: '42', ex: '30', strata: [['40–59', '12', '4000', '30000'], ['60–79', '25', '3000', '20000'], ['80+', '18', '1000', '5000']] },
};
const pct1 = x => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '—');
const civ = (lo, hi, f = v => fx(v, 2)) => `${f(lo)} to ${f(hi)}`;
const field = (id, label, value, attrs = '') => numBox({ id }, label, value, label, attrs);
const read = (el, id) => el.querySelector('#' + id)?.value ?? '';

const SAMPLE = {
  html() {
    const x = calc.ss, design = DESIGNS.find(d => d[0] === x.design);
    const vals = x.v[x.design] ||= Object.fromEntries(design[2].map(([k, , def]) => [k, String(def)]));
    // the design names (up to 32 characters) take two cells; clustering is optional and is a section of its own
    return `<section class="an-section">${grid([pick({ id: 'ss-design' }, 'Design', DESIGNS.map(([k, l]) => [k, l]), x.design, 2), ...design[2].map(([k, l]) => field(`ss-${k}`, l, vals[k] ?? '', ` data-ss="${k}"`))])}</section>
      <section class="an-section" aria-labelledby="ss-cluster-h"><h3 id="ss-cluster-h">Clustered design</h3>${grid([field('ss-m', 'Cluster size', x.m), field('ss-icc', 'Intracluster correlation', x.icc)])}</section>`;
  },
  wire(el, ctx, out) {
    const x = calc.ss;
    el.querySelector('#ss-design').onchange = e => { x.design = e.target.value; ctx.rerender(); };
    el.querySelectorAll('[data-ss]').forEach(i => i.onchange = () => { x.v[x.design][i.dataset.ss] = i.value; });
    return () => {
      const design = DESIGNS.find(d => d[0] === x.design), vals = x.v[x.design];
      el.querySelectorAll('[data-ss]').forEach(i => { vals[i.dataset.ss] = i.value; });
      x.m = read(el, 'ss-m'); x.icc = read(el, 'ss-icc');
      const args = Object.fromEntries(design[2].map(([k]) => [k, num(vals[k])]).filter(([, v]) => Number.isFinite(v)));
      const r = ss[x.design](args);
      if (!r) { put(out, msg('Check the values')); resultAct('calc-keep', null); resultAct('calc-copy', null); return; }
      const cl = num(x.m) >= 1 && num(x.icc) >= 0 && r.total ? ss.clusterInflate(r.total, { m: num(x.m), icc: num(x.icc) }) : null;
      const sentence = [r.sentence, cl?.sentence].filter(Boolean).join(' ');
      const rows = [
        r.n1 != null ? ['Per group', `${r.n1} and ${r.n2}`] : r.n != null ? ['Sample', String(r.n)] : null,
        r.total != null && r.n1 != null ? ['Analysed in all', String(r.total)] : null,
        r.events != null ? ['Events', String(r.events)] : null,
        r.enrol && r.enrol.total !== r.total ? ['To enrol, allowing for dropout', String(r.enrol.total)] : null,
        r.criteria ? ['Riley criteria (i), (ii), (iii)', `${r.criteria.i}, ${r.criteria.ii}, ${r.criteria.iii}`] : null,
        cl ? ['With clustering', `${cl.n} in ${cl.clusters} clusters`] : null,
        cl ? ['Design effect', fx(cl.designEffect, 2)] : null,
      ].filter(Boolean);
      // the figures are the table; the method and its assumptions are lines under it, and the sentence to keep is a paragraph
      put(out, `${res(rows.map(([k, v]) => pair(esc(k), esc(v))))}
        <p>${esc(sentence)}</p>${method(`Method: ${r.method.name}; ${r.method.reference}`)}${r.assumptions.length ? method(`Assumptions: ${r.assumptions.join('; ')}`) : ''}<p class="meta" id="calc-note" role="status"></p>`);
      resultAct('calc-keep', () => { keepSentence(sentence); out.querySelector('#calc-note').textContent = 'Kept with the protocol'; });
      resultAct('calc-copy', () => copyResult(out, sentence));
    };
  },
};

const DIAGNOSTIC = {
  html() {
    const dx = calc.dx;
    // the four counts read as the 2×2 table at two columns; the pre-test probability takes two cells, so 6: two or three columns
    return grid([field('dx-tp', 'True positives', dx.tp), field('dx-fp', 'False positives', dx.fp), field('dx-fn', 'False negatives', dx.fn), field('dx-tn', 'True negatives', dx.tn),
      numBox({ id: 'dx-pre', span: 2 }, 'Pre-test probability', dx.pre, 'Pre-test probability', ' placeholder="Sample prevalence"')]);
  },
  wire(el, ctx, out) {
    const dx = calc.dx;
    return () => {
      for (const k of ['tp', 'fp', 'fn', 'tn', 'pre']) dx[k] = read(el, `dx-${k}`);
      const c = { tp: num(dx.tp), fp: num(dx.fp), fn: num(dx.fn), tn: num(dx.tn) }, pre = num(dx.pre);
      let r;
      try { r = diagnostic2x2(c, { prevalence: pre > 0 && pre < 1 ? pre : null }); } catch (err) { put(out, msg(String(err.message).replace(/^diagnostic2x2: /, ''))); return; }
      const pretest = pre > 0 && pre < 1 ? pre : r.samplePrevalence.est;
      const prop = (label, p) => `<tr><th scope="row">${label}</th><td>${pct1(p.est)}</td><td>${civ(p.lo, p.hi, pct1)}</td></tr>`;
      const ratio = (label, p) => `<tr><th scope="row">${label}</th><td>${fx(p.est, 2)}</td><td>${civ(p.lo, p.hi)}</td></tr>`;
      put(out, `${res([prop('Sensitivity', r.sensitivity), prop('Specificity', r.specificity), prop('Positive predictive value', r.ppv), prop('Negative predictive value', r.npv), prop('Accuracy', r.accuracy),
        ratio('Positive likelihood ratio', r.lrPos), ratio('Negative likelihood ratio', r.lrNeg), ratio('Diagnostic odds ratio', r.dor), ratio("Youden's J", r.youden),
        ...(r.atPrevalence ? [prop(`PPV at ${pct1(pre)}`, r.atPrevalence.ppv), prop(`NPV at ${pct1(pre)}`, r.atPrevalence.npv)] : [])], HEAD3)}
        ${method(cap(r.method))}
        ${pretest > 0 && pretest < 1 ? figurePanel({ title: 'Fagan nomogram', id: 'dx-fagan' }) : ''}`);
      if (pretest > 0 && pretest < 1) { const fagan1 = style => faganSvg(pretest, r.lrPos.est, r.lrNeg.est, { style }); showFigure(out, 'dx-fagan', fagan1(figureTokens(null, { medium: 'screen' })), 'fagan-nomogram', { exportSvg: () => fagan1(figureTokens(null, { medium: 'export' })) }); }
    };
  },
};
// The head of a result with an estimate and its interval; a p value sits in the estimate column, its interval cell empty.
const HEAD3 = '<th scope="col">Measure</th><th scope="col">Estimate</th><th scope="col">95% CI</th>';
const pRow = (label, p) => `<tr><th scope="row">${label}</th><td>${p}</td><td></td></tr>`;
const groupRow = label => `<tr class="calc-group"><th colspan="3" scope="colgroup">${esc(label)}</th></tr>`;

const EPI = {
  html() {
    const e = calc.epi;
    // design and outcome, then the counts as the 2×2 table (exposed a b, unexposed c d) at two columns: 6 cells
    return grid([pick({ id: 'epi-design' }, 'Design', [['cohort', 'Cohort'], ['case-control', 'Case–control'], ['cross-sectional', 'Cross-sectional']], e.design),
      pick({ id: 'epi-outcome' }, 'Outcome', [['adverse', 'Adverse'], ['beneficial', 'Beneficial']], e.outcome),
      field('epi-a', 'Exposed, cases', e.a), field('epi-b', 'Exposed, non-cases', e.b), field('epi-c', 'Unexposed, cases', e.c), field('epi-d', 'Unexposed, non-cases', e.d)]);
  },
  wire(el, ctx, out) {
    const e = calc.epi;
    return () => {
      e.design = read(el, 'epi-design'); e.outcome = read(el, 'epi-outcome');
      for (const k of ['a', 'b', 'c', 'd']) e[k] = read(el, `epi-${k}`);
      let r;
      try { r = epi2x2({ a: num(e.a), b: num(e.b), c: num(e.c), d: num(e.d) }, { design: e.design, outcome: e.outcome }); } catch (err) { put(out, msg(String(err.message).replace(/^epi2x2: /, ''))); return; }
      const word = e.design === 'cross-sectional' ? 'Prevalence' : 'Risk';
      const row = (label, p, f = v => fx(v, 2)) => p ? `<tr><th scope="row">${label}</th><td>${f(p.est)}</td><td>${civ(p.lo, p.hi, f)}</td></tr>` : '';
      put(out, `${res([r.risk1 ? row(`${word}, exposed`, r.risk1, pct1) + row(`${word}, unexposed`, r.risk0, pct1) : '',
        row(`${word} ratio`, r.rr), row('Odds ratio', r.or), r.rd ? row(`${word} difference`, r.rd, pct1) : '',
        row('Attributable fraction, exposed', r.afExposed, pct1), row('Population attributable fraction', r.paf, pct1),
        r.nnt ? pRow('Number needed to treat', esc(r.nnt.text)) : '', pRow('Fisher exact p', pValue(r.fisherP)), pRow('Mid-P', pValue(r.midP))], HEAD3)}
        ${method(cap(r.method))}`);
    };
  },
};

const RATES = {
  html() {
    const r = calc.rate;
    // the strata are an editable table in a scroll region of its own (wide on a narrow pane)
    const strata = `<table class="rt-strata"><thead><tr><th>Stratum</th><th>Events</th><th>Person-time</th><th>Standard population</th><th aria-label="Actions"></th></tr></thead>
        <tbody>${r.strata.map((row, i) => `<tr>${row.map((v, j) => `<td${j ? '' : ' class="grow"'}><input class="ui-cell-field" data-st="${i}:${j}"${j ? ' inputmode="decimal"' : ''} autocomplete="off" value="${esc(v)}" aria-label="${['Stratum', 'Events', 'Person-time', 'Standard population'][j]}, row ${i + 1}"></td>`).join('')}<td>${uiRowEnd({ more: { label: `More for stratum ${i + 1}`, attrs: { 'data-st-more': i } } })}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5">${uiBar({ kind: 'foot', label: 'Strata', id: 'rt-strata-bar', actions: [{ id: 'rt-add', label: 'Add stratum', icon: 'plus' }] })}</td></tr></tfoot></table>`;
    // three sections: the two groups' events and person-time (2×2 at two columns), the standardised ratio with the rate unit, the strata
    return `<section class="an-section" aria-labelledby="rt-h-rates"><h3 id="rt-h-rates">Rate comparison</h3>${grid([field('rt-e1', 'Events, group 1', r.e1), field('rt-t1', 'Person-time, group 1', r.t1), field('rt-e2', 'Events, group 2', r.e2), field('rt-t2', 'Person-time, group 2', r.t2)])}</section>
      <section class="an-section" aria-labelledby="rt-h-std"><h3 id="rt-h-std">Standardisation</h3>${grid([field('rt-per', 'Rates per', r.per), field('rt-o', 'Observed, for SMR', r.o), field('rt-ex', 'Expected, for SMR', r.ex)])}
      <div class="rt-strata-wrap">${tableRegion({ label: 'Strata', html: strata })}</div></section>`;
  },
  wire(el, ctx, out) {
    const r = calc.rate;
    const readStrata = () => el.querySelectorAll('[data-st]').forEach(i => { const [a, b] = i.dataset.st.split(':').map(Number); if (r.strata[a]) r.strata[a][b] = i.value; });
    el.querySelector('#rt-add').onclick = () => { readStrata(); r.strata.push(['', '', '', '']); ctx.rerender(); };
    el.querySelectorAll('[data-st-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove stratum', icon: 'trash', danger: true, run: () => { readStrata(); r.strata.splice(Number(b.dataset.stMore), 1); ctx.rerender(); } }], { align: 'end' }));
    return () => {
      for (const k of ['e1', 't1', 'e2', 't2', 'per', 'o', 'ex']) r[k] = read(el, `rt-${k}`);
      readStrata();
      // one table of three groups (rows under a group heading), so every estimate and interval stands in one column; what cannot be
      // computed is a note under it, the methods are lines under that
      const per = num(r.per) > 0 ? num(r.per) : 1, rows = [], notes = [], methods = [];
      const tryIt = (label, f) => { try { const [group, m] = f(); rows.push(groupRow(label), ...group); methods.push(method(cap(m))); } catch (err) { notes.push(msg(`${label}: ${String(err.message).replace(/^\w+: /, '')}`)); } };
      const est = (label, x) => `<tr><th scope="row">${label}</th><td>${fx(x.est, 2)}</td><td>${civ(x.lo, x.hi)}</td></tr>`;
      tryIt('Rate comparison', () => { const c = rateComparison({ events1: num(r.e1), time1: num(r.t1), events2: num(r.e2), time2: num(r.t2) }, { per });
        return [[est(`Rate, group 1, per ${per}`, c.rate1), est(`Rate, group 2, per ${per}`, c.rate2), est('Rate ratio', c.rateRatio), est(`Rate difference, per ${per}`, c.rateDifference), pRow('Exact p', pValue(c.p))], c.method]; });
      if (r.o !== '' && r.ex !== '') tryIt('Standardised ratio', () => { const m = smr(num(r.o), num(r.ex));
        return [[est('Observed / expected', m), pRow('p', pValue(m.p))], m.method]; });
      const strata = r.strata.filter(row => row.slice(1).some(v => String(v).trim()));
      if (strata.length) tryIt('Direct standardisation', () => { const ds = directStandardise(strata.map(row => ({ events: num(row[1]), time: num(row[2]) })), strata.map(row => num(row[3])), { per });
        return [[`<tr><th scope="row">Crude rate, per ${per}</th><td>${fx(ds.crude, 2)}</td><td></td></tr>`, est(`Standardised rate, per ${per}`, ds)], ds.method]; });
      put(out, `${rows.length ? res(rows, HEAD3) : ''}${notes.join('')}${methods.join('')}`);
    };
  },
};

const MODULES = { power: POWER, conv: CONV, trial: TRIAL, random: RANDOM, ss: SAMPLE, dx: DIAGNOSTIC, epi: EPI, rate: RATES };
