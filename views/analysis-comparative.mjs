// A comparison of two arms whose counts are read from an evidence table's text (plan §I, comparative analysis amendment
// 2026-10-17; lib/contrast-counts.mjs). The analysis view hands an outcome with `derived.kind = 'arm-contrast'` to this module:
// its document (each study's two arms and their counts, Run, the result, the forest plot, the subgroups and what could not be
// read) and its inspector sections. The model is the pairwise engine's (lib/contrast-r.mjs over lib/pooled-model.mjs).
import { get, update, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { formField, pagedTable } from '../lib/ui-components.mjs';
import { wireStudies, openStudy } from '../lib/study.mjs';
import { showMenu } from '../lib/menu.mjs';
import { runR } from '../lib/r.mjs';
import { analysisRunGuard } from '../lib/analysis-run-guard.mjs';
import { figurePanel, showFigure, compactSvg, downloadCsv } from '../lib/figure.mjs';
import { mountForest } from '../lib/forest-page.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { pooledInputs, pooledInputStatus, zeroEvents, zeroEventsText } from '../lib/analysis-inputs.mjs';
import { outcomeById, analysisOf, setAnalysis, setOutcomeMeasure } from '../lib/outcomes.mjs';
import { effectName } from '../lib/effect-measures.mjs';
import { contrastScript, levelsOf } from '../lib/contrast-r.mjs';
import { handlesGeneral, poolGeneral } from '../lib/meta-general.mjs';
import { handlesRare, poolRare, poolRareGroups } from '../lib/meta-rare.mjs';
import { poolGlmmOR } from '../lib/meta-glmm.mjs';
import { contrastUnits, contrastItems, studyItemNames, itemsFor, columnsOf, startContrast, stillToDo } from '../lib/contrast-counts.mjs';
import { subgroupLevel } from '../lib/derived-counts.mjs';
import { itemsIn } from '../lib/count-text.mjs';
import { armsOf } from '../lib/arms.mjs';
import { INFERENCE, PREDICTION, testFor, piFor, isHK, settingsOf, methodsUsed, revmanDifferences, heterogeneityRows } from '../lib/heterogeneity.mjs';
import { extraSection, trackSections } from './analysis-extras.mjs';

const PAGE = 25;
const MEASURES = [['RR', 'Risk ratio'], ['OR', 'Odds ratio'], ['RD', 'Risk difference']];
const ESTIMATORS = [['REML', 'Random effects · REML'], ['DL', 'Random effects · DerSimonian–Laird'], ['EE', 'Common effect'], ['MH', 'Common effect · Mantel–Haenszel']];
const PETO = ['PETO', 'Common effect · Peto odds ratio'];
// rma.glmm fits the odds ratio only (its other two-arm measures are not binomial–logit models)
const GLMM = ['GLMM', 'Random effects · GLMM'];
const estimatorsFor = m => [...ESTIMATORS, ...(m === 'OR' ? [PETO, GLMM] : [])];
const isRare = m => m === 'MH' || m === 'PETO';
const METHOD_WORD = { REML: 'REML', DL: 'DerSimonian–Laird', EE: 'Common effect', MH: 'Mantel–Haenszel', PETO: 'Peto', GLMM: 'GLMM' };
const choice = {};   // per outcome: { method, test, pi, moderator, page, skipped }
let choiceGeneration = -1;
const pick = oid => {
  if (choiceGeneration !== projectGeneration()) { for (const key of Object.keys(choice)) delete choice[key]; choiceGeneration = projectGeneration(); }
  return choice[oid] ||= { method: null, test: null, pi: null, moderator: null, page: 1, skipped: 1 };
};
const derivedOf = oid => outcomeById(get(), oid)?.derived || null;
const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
const f = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
const pval = p => (p == null || !Number.isFinite(Number(p)) ? '—' : Number(p) < 0.001 ? '<0.001' : Number(p).toFixed(3));
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const sideNames = d => [d?.arms?.treated || 'Treated', d?.arms?.control || 'Control'];

/** The measure: the outcome's own (RR, OR or RD). */
export const measure = oid => (['RR', 'OR', 'RD'].includes(outcomeById(get(), oid)?.measure) ? outcomeById(get(), oid).measure : 'RR');
const saved = (oid, k) => { const a = analysisOf(get(), oid); return k === 'test' ? a?.settings?.ci : k === 'pi' ? a?.settings?.pi : a?.[k]; };
const raw = (oid, k) => pick(oid)[k] ?? saved(oid, k) ?? { method: 'REML', test: 'z', pi: 'follow' }[k];
/** Whether the pooled estimate is drawn: the comparison's own setting (RevMan's totals), shown unless it says not. */
const totalsOf = oid => derivedOf(oid)?.totals !== false;
export const method = oid => { const m = raw(oid, 'method'); return estimatorsFor(measure(oid)).some(([id]) => id === m) ? m : 'REML'; };
/** The subgroup column in use: the person's choice, else the last result's, else the outcome's own. */
export const moderator = oid => { const c = pick(oid).moderator, a = analysisOf(get(), oid); return c ?? (a ? a.moderator || '' : derivedOf(oid)?.subgroup?.column || ''); };
const columnLabel = (s, d, id) => (s.templates || []).find(t => t.id === d?.template)?.columns.find(c => c.id === id)?.label || id;

/** The list's line for a comparison. */
export function listLine(s, o) {
  const pin = pooledInputs(s, '', measure(o.id), o.id), a = analysisOf(s, o.id), [t, c] = sideNames(o.derived);
  const of = pin.ready.length + pin.incomplete.length + pin.invalid.length;
  return { sub: `${t} vs ${c} · ${pin.ready.length} of ${of} studies`, mark: a ? `${a.measure} ${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]` : 'Not run' };
}

const countLine = inputs => {
  const of = inputs.ready.length + inputs.incomplete.length + inputs.invalid.length;
  return `${inputs.ready.length} of ${of} studies counted`;
};
const inputCsv = (s, oid, inputs) => {
  const d = derivedOf(oid), [tn, cn] = sideNames(d);
  downloadCsv([['Study', `${tn} arm`, `${tn} events`, `${tn} N`, `${tn} item`, `${tn} source cell`, `${cn} arm`, `${cn} events`, `${cn} N`, `${cn} item`, `${cn} source cell`, 'Status', 'Reason', 'Subgroup text', 'Subgroup'],
    ...inputs.all.map(u => [u.label, u.treated?.armLabel || '', u.treated?.events ?? '', u.treated?.n ?? '', u.treated?.item || '', u.treated?.key || '',
      u.control?.armLabel || '', u.control?.events ?? '', u.control?.n ?? '', u.control?.item || '', u.control?.key || '', u.status, u.reason, u.subgroupRaw || '', u.subgroup ?? ''])],
  `${outcomeById(s, oid).name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-input.csv`);
};
// Run is the title bar's: the page drawn last binds what it runs.
const acts = {};

/** A comparison's part of the title bar (views/analysis.mjs page()): Run, the studies counted beside the title, the input download in More. */
export function contrastPage(oid, title) {
  const inputs = pooledInputs(get(), moderator(oid), measure(oid), oid);
  return { title, status: { text: countLine(inputs), ch: 24 },
    actions: [{ id: 'run', label: 'Run', icon: 'run', role: 'primary', disabled: inputs.ready.length < 2, run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'csv', label: 'Download inputs', run: () => inputCsv(get(), oid, pooledInputs(get(), moderator(oid), measure(oid), oid)) }] };
}

export function render(el, ctx, oid) {
  const s = get(), d = derivedOf(oid), a = analysisOf(s, oid), mod = moderator(oid), m = measure(oid);
  const inputs = pooledInputs(s, mod, m, oid), { units } = inputs;
  const [tn, cn] = sideNames(d);
  const status0 = pooledInputStatus(s, a, oid);
  const c = pick(oid);
  const skipped = [...inputs.invalid, ...inputs.incomplete, ...inputs.aside];
  const notEstimable = zeroEvents(m, units.map(u => u.values)).excluded.map(i => units[i].label);
  const counts = x => `${x.events}/${x.n}`;
  const from = u => [...new Set([u.treated.item, u.control.item])].map(cap).join(' · ');

  const readyTable = () => {
    const shown = pageOf(units, c.page, PAGE);
    // the study names a row, as the input grid's do; its record opens from the forest plot
    return units.length ? pagedTable({ label: 'Studies compared', html: `<table><thead><tr><th scope="col">Study</th><th scope="col">${esc(tn)}</th><th scope="col">${esc(cn)}</th><th class="grow" scope="col">Read from</th>${mod ? '<th scope="col">Subgroup</th>' : ''}</tr></thead>
        <tbody>${shown.items.map(u => `<tr><th scope="row"${u.paper.title ? ` title="${esc(u.paper.title)}"` : ''}>${esc(u.label)}</th><td>${counts(u.treated)}</td><td>${counts(u.control)}</td><td class="grow">${esc(from(u))}</td>${mod ? `<td>${esc(u.subgroup || '—')}</td>` : ''}</tr>`).join('')}</tbody></table>`,
      pager: pager({ id: 'cc-studies', page: shown.page, pages: shown.pages, total: units.length, label: 'studies', size: PAGE }) }) : '';
  };
  const reasonOf = u => (u.status === 'aside' ? 'Set aside' : u.status === 'missing' ? `Not reported · ${u.reason}` : cap(u.reason));
  // each study not pooled with its reason; its row opens the cell the reason names in Extraction, where the text is corrected
  const skippedTable = () => {
    const shown = pageOf(skipped, c.skipped, PAGE);
    return uiList({ id: 'cc-skipped-list', label: 'Studies not pooled', rows: shown.items.map((u, i) => uiRow({
      main: { html: esc(u.label), detail: [esc(reasonOf(u))], wrap: true },
      end: uiRowEnd({ inline: { id: `cc-cell-${i}`, label: 'Open its cell in Extraction', icon: 'extraction', attrs: { 'data-cc-cell': u.key } },
        more: { label: `More for ${u.label}`, attrs: { 'data-cc-more': u.paperId } } }) })) })
      + pager({ id: 'cc-skipped', page: shown.page, pages: shown.pages, total: skipped.length, label: 'studies', size: PAGE });
  };
  const notes = [notEstimable.length ? `${notEstimable.length} not estimable · zero events, both arms` : '',
    inputs.oneSided.length ? `${inputs.oneSided.length} ${inputs.oneSided.length === 1 ? 'study has' : 'studies have'} arms on one side only` : ''].filter(Boolean);

  el.innerHTML = `<div class="panel">
    <div class="panel-body tight" id="cc-ready-table">${readyTable() || '<div class="note">No study has a counted arm on each side</div>'}</div>
    ${notes.length ? `<div class="panel-body">${notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}</div>
    <div class="panel" id="out"${a ? '' : ' hidden'}>
      ${uiBar({ kind: 'head', label: 'Result', id: 'an-result-head', lead: { title: 'Result' }, message: { id: 'rmeta', text: a ? resultMeta(a) : '' } })}
      <div class="panel-body">${status0 === 'stale' ? '<div class="note">Inputs changed · run again</div>' : ''}<div id="summary"></div><div id="methodsHost"></div></div>
    </div>
    <div id="forestHost"${a ? '' : ' hidden'}>${figurePanel({ title: 'Forest plot', id: 'forest' })}</div>
    <div class="panel" id="modHost" hidden>
      <div class="panel-head"><h2>Subgroups</h2><span class="meta"></span></div>
      <div class="panel-body tight"></div>
    </div>
    <div id="funnelHost" hidden>${figurePanel({ title: 'Funnel plot', id: 'funnel' })}</div>
    ${skipped.length ? `<div class="panel">
      <div class="panel-head"><h2>Not pooled</h2><span class="meta">${inputs.invalid.length} unreadable · ${inputs.incomplete.length} not reported${inputs.aside.length ? ` · ${inputs.aside.length} set aside` : ''}</span></div>
      <div class="panel-body tight" id="cc-skipped-table">${skippedTable()}</div></div>` : ''}`;

  wireStudies(el, ctx);
  // a study that was not pooled opens the cell its reason names in Extraction, where the text is corrected
  const wireCells = host => host.querySelectorAll('[data-cc-cell]').forEach(b => b.onclick = async () => {
    const k = b.dataset.ccCell, i = k.indexOf(':');
    if ((await import('./extraction.mjs')).focusCell(k.slice(0, i), k.slice(i + 1))) ctx.go('extraction');
  });
  wireCells(el);
  const wireMore = host => host.querySelectorAll('[data-cc-more]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Open record', icon: 'open', run: () => openStudy(ctx, b.dataset.ccMore) }], { align: 'end' }));
  wireMore(el);
  const wireTable = (hostId, pagerId, key, html) => {
    const host = el.querySelector(`#${hostId}`); if (!host) return;
    wirePager(host, pagerId, p => {
      c[key] = p;
      const top = host.getBoundingClientRect().top;
      host.innerHTML = html();
      wireStudies(host, ctx); wireCells(host); wireMore(host); wireTable(hostId, pagerId, key, html);
      host.querySelector(`#${pagerId} button:not(:disabled)`)?.focus({ preventScroll: true });
      const scroller = el.closest('.view') || el;
      scroller.scrollTop += host.getBoundingClientRect().top - top;
    });
  };
  wireTable('cc-ready-table', 'cc-studies', 'page', readyTable);
  wireTable('cc-skipped-table', 'cc-skipped', 'skipped', skippedTable);

  acts.run = async btn => {
    const now = pooledInputs(get(), mod, m, oid);
    if (now.snapshot !== inputs.snapshot) { ctx.rerender(); return; }
    const resultHost = el.querySelector('#out'), summaryHost = el.querySelector('#summary');
    const say = t => { if (summaryHost) summaryHost.textContent = t; if (resultHost) resultHost.hidden = false; };
    btn.disabled = true;
    try {
      const r = await runComparison(oid, say);
      if (!r.ok) { if (r.reason) say(r.reason); btn.disabled = false; return; }
      ctx.refreshCounts?.();
      if (btn.isConnected !== false) ctx.rerender();
      // R's result, behind the one shown at once: the page is drawn again when it arrives, if it is still the page in view
      r.background?.then(() => { ctx.refreshCounts?.(); if (el.isConnected) ctx.rerender(); });
    } catch (err) { say(String(err.message || err).slice(0, 160)); btn.disabled = false; }
  };
  if (a) show(el, ctx, a, units);
  trackSections(el);
}

const resultMeta = a => `${effectName(a.measure)} · ${METHOD_WORD[a.method] || a.method}${isHK(a.settings?.ci ?? a.test) ? ' · Hartung–Knapp' : ''} · k = ${a.k}`;

function show(el, ctx, a, units) {
  el.querySelector('#out').hidden = false;
  const pooled = a.totals !== false;
  const z = a.zval != null ? `Z = ${f(Math.abs(a.zval))} (p ${pval(a.pval)})` : '';
  el.querySelector('#summary').innerHTML = `<table><tbody>
    ${pooled ? `<tr><th>Pooled ${esc(effectName(a.measure))}</th><td>${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]</td></tr>` : `<tr><th>Pooled estimate</th><td>Not shown · ${a.k} study estimates</td></tr>`}
    ${pooled && a.pi_lo != null ? `<tr><th>95% prediction interval</th><td>${f(a.pi_lo)} to ${f(a.pi_hi)}</td></tr>` : ''}
    ${pooled && z ? `<tr><th>Overall effect</th><td>${esc(z)}</td></tr>` : ''}
    ${pooled ? heterogeneityRows(a).map(([l, t]) => `<tr><th>${l}</th><td>${esc(t)}</td></tr>`).join('') : ''}
    ${pooled ? `<tr><th>Q</th><td>${f(a.q)}, df ${Math.max(0, a.k - 1)} (p ${pval(a.qp)})</td></tr>` : ''}
    </tbody></table>
    <div class="note spaced">${esc(`${a.contrast?.treated || ''} vs ${a.contrast?.control || ''} · ${a.participants ?? '—'} participants`)}</div>
    ${a.zeroEvents ? `<div class="note">${esc(cap(a.zeroEvents))}</div>` : ''}`;
  const diffs = revmanDifferences(a);
  el.querySelector('#methodsHost').innerHTML = extraSection({ id: 'cc-methods', title: 'Methods used', meta: 'Recorded with the result',
    body: `<table><tbody>${[...methodsUsed(a), ['Events', 'Per arm, the largest count among the outcome\'s items in the arm\'s own cells; an item not reported is left out']].map(([l, t]) => `<tr><th>${esc(l)}</th><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      ${diffs.length ? `<table><thead><tr><th class="grow">Differs from RevMan 2025</th><th>RevMan</th><th>This result</th></tr></thead>
        <tbody>${diffs.map(([l, r, t]) => `<tr><td class="grow">${esc(l)}</td><td>${esc(r)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>` : ''}` });
  el.querySelector('#forestHost').hidden = false;
  mountForest(el, 'forest', a, { rSvg: a.svg || null, labels: a.labels, study: i => a.papers?.[i] || null, open: pid => openStudy(ctx, pid), whole: a.svg ? async () => a.svg : null });
  const fh = el.querySelector('#funnelHost'); fh.hidden = !a.funnel || !pooled; if (a.funnel && pooled) showFigure(el, 'funnel', a.funnel, 'funnel-plot');
  const mh = el.querySelector('#modHost');
  mh.hidden = a.mod_kind !== 'group' || !pooled;
  if (mh.hidden) return;
  const lv = vec(a.mod_levels), k = vec(a.mod_k), est = vec(a.mod_est), lo = vec(a.mod_lo), hi = vec(a.mod_hi), i2 = vec(a.mod_i2);
  mh.querySelector('h2').textContent = `Subgroups by ${a.moderatorLabel}`;
  mh.querySelector('.meta').textContent = `Test for subgroup differences: Q = ${f(a.qm)}, df = ${a.qm_df}, p = ${pval(a.qmp)}${a.mod_unassigned ? ` · ${a.mod_unassigned} in no subgroup` : ''}`;
  mh.querySelector('.panel-body').innerHTML = `<table><thead><tr><th class="grow">Subgroup</th><th>k</th><th>Pooled ${esc(a.measure)}</th><th>I²</th></tr></thead>
    <tbody>${lv.map((l, i) => `<tr><td class="grow">${esc(l)}</td><td>${k[i]}</td><td>${f(est[i])} [${f(lo[i])}, ${f(hi[i])}]</td><td>${f(i2[i], 1)}%</td></tr>`).join('')}</tbody></table>`;
}

// ---- inspector ----------------------------------------------------------------

const sel = (attr, label, options, cur) => `<label class="field"><span>${esc(label)}</span><select ${attr} aria-label="${esc(label)}">
  ${options.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const input = (attr, label, value) => formField(label, `<input ${attr} value="${esc(value || '')}" aria-label="${esc(label)}">`);
const checks = (label, list, attr) => `<div class="field an-checks" role="group" aria-label="${esc(label)}"><span>${esc(label)}</span>${list.map(([v, l, on]) =>
  `<label class="cr-check"><input type="checkbox" ${attr}="${esc(v)}"${on ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;

/** Sets part of an outcome's comparison rule; the inputs and any saved result follow. */
function setDerived(oid, patch) {
  update(st => { st.outcomes = (st.outcomes || []).map(o => (o.id === oid ? { ...o, derived: { ...o.derived, ...(typeof patch === 'function' ? patch(o.derived) : patch) } } : o)); return st; });
}

/** The sides a study's arms are on, as a choice: by their text, set aside, or one arm against another. */
function sideChoices(template, pid, d) {
  const arms = armsOf(template, pid) || [];
  const name = a => a.label.split('\n')[0].replace(/\s*\(n\s*=.*$/i, '').trim() || a.id;
  const pairs = [];
  for (const t of arms) for (const c of arms) if (t !== c) pairs.push([`${t.id}>${c.id}`, `${name(t)} ${d.arms.treated} · ${name(c)} ${d.arms.control}`]);
  const set = arms.map(a => d.arms.set?.[`${pid}@${a.id}`]);
  const cur = !set.some(Boolean) ? 'text' : set.every(x => x === 'none') ? 'none'
    : (() => { const t = arms.find((a, i) => set[i] === 'treated'), c = arms.find((a, i) => set[i] === 'control'); return t && c ? `${t.id}>${c.id}` : 'text'; })();
  return { options: [['text', 'By the arms\' text'], ['none', 'Set aside'], ...pairs], cur, arms };
}

/** Inspector sections for a comparison: model, arms, events, the events of each study, subgroup levels, heterogeneity. */
export function inspect(ctx, oid) {
  const s = get(), d = derivedOf(oid), a = analysisOf(s, oid), m = measure(oid);
  const tpl = (s.templates || []).find(t => t.id === d.template);
  const cols = (tpl?.columns || []).map(c => [c.id, c.label]);
  const meth = method(oid), random = !isRare(meth) && meth !== 'EE';
  const subCol = d.subgroup?.column || '';
  const { units, oneSided } = contrastUnits(s, d);
  const secs = [];
  // made from a figure's caption (Tables and figures, drawPrinted): what was filled from where, as the rule is now, and what is left
  if (d.from) {
    const todo = stillToDo(s, d), compared = units.filter(u => u.status !== 'aside').length, [tn, cn] = sideNames(d);
    const words = (list, none) => (list.length ? list.join(', ') : none), named = new Map(contrastItems(s, d).map(i => [i.key, i.name]));
    // first in Details until the comparison has run, so what is left to choose is what the inspector opens on
    secs.push({ setup: !a, title: d.from.label ? `Set up from ${d.from.label}` : 'Set up from a caption', html: `<dl class="props">
      <dt>Sides</dt><dd>${esc(`${tn} vs ${cn}${d.from.sides ? ' · from the caption' : ''}`)}</dd>
      <dt>Arm column</dt><dd>${esc(`${columnLabel(s, d, d.arms?.column)} · ${compared} ${compared === 1 ? 'study' : 'studies'} on both sides`)}</dd>
      <dt>Event columns</dt><dd>${esc(words(columnsOf(d).map(c => columnLabel(s, d, c)), 'None chosen'))}</dd>
      <dt>Events</dt><dd>${esc(words((d.items || []).map(k => cap(named.get(k) || k)), 'None chosen'))}${(d.items || []).length && d.from.items ? ' · named in the legend' : ''}</dd>
      <dt>To do</dt><dd>${esc(todo || 'Check the studies, then run')}</dd></dl>` });
  }
  secs.push({ title: 'Model', html: `<div class="an-settings">
      ${sel('data-cm="measure"', 'Effect measure', MEASURES, m)}
      ${sel('data-cm="method"', 'Model', estimatorsFor(m), meth)}
      ${random && meth !== 'GLMM' ? sel('data-cm="test"', 'Confidence interval', INFERENCE, raw(oid, 'test')) : ''}
      ${random && meth !== 'GLMM' ? sel('data-cm="pi"', 'Prediction interval', PREDICTION, raw(oid, 'pi')) : ''}
      ${sel('data-cm="moderator"', 'Subgroup', [['', 'No subgroup'], ...(subCol ? [[subCol, columnLabel(s, d, subCol)]] : [])], moderator(oid))}
      ${sel('data-cm="totals"', 'Pooled estimate', [['1', 'Shown'], ['0', 'Not shown · studies only']], totalsOf(oid) ? '1' : '0')}</div>`,
    wire: el => el.querySelectorAll('[data-cm]').forEach(x => x.onchange = e => {
      const k = x.dataset.cm, v = e.target.value;
      if (k === 'measure') update(st => setOutcomeMeasure(st, oid, v));
      else if (k === 'totals') setDerived(oid, { totals: v === '1' });
      else pick(oid)[k] = v;
      ctx?.rerender();
    }) });
  // the sides: which column names them, the words that put an arm on each side
  secs.push({ title: 'Arms', meta: `${units.filter(u => u.status !== 'aside').length} compared`, html: `<div class="an-settings">
      ${sel('data-ca="column"', 'Arm column', cols, d.arms?.column || '')}
      ${input('data-ca="treated"', 'First side', d.arms?.treated)}
      ${input('data-ca="treatedTerm"', 'First side\'s word', d.arms?.treatedTerm)}
      ${input('data-ca="control"', 'Second side', d.arms?.control)}
      ${input('data-ca="controlTerm"', 'Second side\'s word', d.arms?.controlTerm)}</div>
      ${oneSided.length ? `<div class="note spaced">${oneSided.length} ${oneSided.length === 1 ? 'study has' : 'studies have'} arms on one side only</div>` : ''}`,
    wire: el => el.querySelectorAll('[data-ca]').forEach(x => x.onchange = e => {
      const k = x.dataset.ca, v = String(e.target.value || '').trim();
      setDerived(oid, dd => ({ arms: { ...dd.arms, [k]: k === 'treated' || k === 'control' ? v || (k === 'treated' ? 'Treated' : 'Control') : v } }));
      ctx?.rerender();
    }) });
  // each study with an arm on a side, or set by hand: which arm is on which side
  const listed = [...units, ...oneSided].sort((x, y) => x.label.localeCompare(y.label));
  if (tpl && listed.length) secs.push({ title: 'Arms by study', meta: String(listed.length), html: `<div class="an-settings">${listed.map(u => {
      const ch = sideChoices(tpl, u.paperId, d);
      return sel(`data-cs="${esc(u.paperId)}"`, u.label, ch.options, ch.cur);
    }).join('')}</div>`,
    wire: el => el.querySelectorAll('[data-cs]').forEach(x => x.onchange = e => {
      const pid = x.dataset.cs, v = e.target.value, arms = armsOf(tpl, pid) || [];
      setDerived(oid, dd => {
        const set = Object.fromEntries(Object.entries(dd.arms?.set || {}).filter(([k]) => !k.startsWith(`${pid}@`)));
        if (v === 'none') for (const ar of arms) set[`${pid}@${ar.id}`] = 'none';
        else if (v !== 'text') { const [t, c] = v.split('>'); for (const ar of arms) set[`${pid}@${ar.id}`] = ar.id === t ? 'treated' : ar.id === c ? 'control' : 'none'; }
        return { arms: { ...dd.arms, set } };
      });
      ctx?.rerender();
    }) });
  // the event: the text columns it is named in, its items, the arm's size
  const countCols = (tpl?.columns || []).filter(c => columnsOf(d).includes(c.id) || itemsIn(Object.entries(s.values || {}).filter(([k]) => k.includes(`:${c.id}@`)).slice(0, 400).map(([, v]) => String(v?.reported_value ?? v?.normalized_value ?? ''))).some(i => i.count));
  const items = contrastItems(s, d), chosen = new Set((d.items || []).map(String));
  secs.push({ title: 'Events', html: `<div class="an-settings">
      ${sel('data-ce="template"', 'Table', (s.templates || []).map(t => [t.id, t.name || t.id]), d.template)}
      ${checks('Columns', countCols.map(c => [c.id, c.label, columnsOf(d).includes(c.id)]), 'data-ce-col')}
      ${items.length ? checks('Items', items.map(i => [i.key, `${cap(i.name)} (${i.count})`, chosen.has(i.key)]), 'data-ce-item') : ''}
      ${sel('data-ce="nColumn"', 'Arm size', [['', 'None'], ...cols], d.nColumn || '')}</div>
      <dl class="props"><dt>Several items</dt><dd>The largest count in each arm</dd></dl>`,
    wire: el => {
      el.querySelector('[data-ce="template"]').onchange = e => { const t = (get().templates || []).find(x => x.id === e.target.value); update(st => { st.outcomes = st.outcomes.map(o => (o.id === oid ? { ...o, derived: startContrast(t) } : o)); return st; }); ctx?.rerender(); };
      el.querySelector('[data-ce="nColumn"]').onchange = e => { setDerived(oid, { nColumn: e.target.value }); ctx?.rerender(); };
      el.querySelectorAll('[data-ce-col]').forEach(x => x.onchange = () => { setDerived(oid, { columns: [...el.querySelectorAll('[data-ce-col]:checked')].map(b => b.dataset.ceCol) }); ctx?.rerender(); });
      el.querySelectorAll('[data-ce-item]').forEach(x => x.onchange = () => { setDerived(oid, { items: [...el.querySelectorAll('[data-ce-item]:checked')].map(b => b.dataset.ceItem) }); ctx?.rerender(); });
    } });
  // a study whose event is named otherwise: its own items replace the outcome's
  const compared = units.filter(u => u.status !== 'aside');
  if (compared.length && (d.items || []).length) secs.push({ title: 'Events by study', meta: String(Object.keys(d.studyItems || {}).length || ''), html: compared.map(u => {
      const own = new Set(itemsFor(d, u.paperId));
      return checks(u.label, studyItemNames(s, d, u.paperId).map(i => [i.key, cap(i.name), own.has(i.key)]), `data-cy="${esc(u.paperId)}" data-cy-item`);
    }).join(''),
    wire: el => el.querySelectorAll('[data-cy-item]').forEach(x => x.onchange = () => {
      const pid = x.dataset.cy, list = [...el.querySelectorAll(`[data-cy="${CSS.escape(pid)}"]:checked`)].map(b => b.dataset.cyItem);
      const base = (derivedOf(oid).items || []).slice().sort().join('|');
      setDerived(oid, dd => { const own = { ...(dd.studyItems || {}) }; if (list.slice().sort().join('|') === base) delete own[pid]; else own[pid] = list; return { studyItems: own }; });
      ctx?.rerender();
    }) });
  // the subgroups: the column whose text groups the studies (a study's two arms joined when they differ), and each text's level
  const raws = [...new Set(units.map(u => u.subgroupRaw).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  secs.push({ title: 'Subgroups', meta: subCol && raws.length ? String(raws.length) : '',
    html: `<div class="an-settings">${sel('data-cg', 'Subgroup column', [['', 'None'], ...cols], subCol)}${subCol ? raws.map((r, i) => input(`data-lv="${i}"`, r, subgroupLevel(d.subgroup, r) ?? '')).join('') : ''}</div>`,
    wire: el => {
      el.querySelector('[data-cg]').onchange = e => { setDerived(oid, { subgroup: e.target.value ? { column: e.target.value, levels: [] } : null }); pick(oid).moderator = null; ctx?.rerender(); };
      el.querySelectorAll('[data-lv]').forEach(x => x.onchange = () => {
        const levels = raws.map((r, i) => [r, String(el.querySelector(`[data-lv="${i}"]`).value || '').trim()]).filter(([, l]) => l);
        setDerived(oid, { subgroup: { column: subCol, levels } });
        ctx?.rerender();
      });
    } });
  if (a) {
    secs.push({ title: 'Heterogeneity', meta: `k = ${a.k}`, html: `<dl class="props">
      ${heterogeneityRows(a).map(([l, t]) => `<dt>${l}</dt><dd>${esc(t)}</dd>`).join('')}
      <dt>Q</dt><dd>${f(a.q)} (p ${pval(a.qp)})</dd>
      ${a.cmh != null ? `<dt>Cochran–Mantel–Haenszel</dt><dd>${f(a.cmh)} (p ${pval(a.cmhp)})</dd>` : ''}
      ${a.egger_z != null ? `<dt>Egger's test</dt><dd>z = ${f(a.egger_z)}, p = ${pval(a.egger_p)}${a.k < 10 ? ' · k < 10' : ''}</dd>` : ''}</dl>` });
    const est = vec(a.loo_est), lo = vec(a.loo_lo), hi = vec(a.loo_hi), i2 = vec(a.loo_i2), labels = a.labels || [];
    if (est.length) secs.push({ title: 'Leave one out', meta: String(est.length), html: `<dl class="props">${est.map((e, i) =>
      `<dt>${esc(labels[i] || `Study ${i + 1}`)}</dt><dd>${f(e)} [${f(lo[i])}, ${f(hi[i])}] · I² ${f(i2[i], 1)}%</dd>`).join('')}</dl>` });
  }
  return secs;
}

/** Makes an outcome compare two arms read from a table's text: the first table, its first arm column for the sides. */
export function startComparison(st, oid) {
  const tpl = (st.templates || [])[0];
  if (!tpl) return st;
  st.outcomes = (st.outcomes || []).map(o => (o.id === oid ? { ...o, measure: ['RR', 'OR', 'RD'].includes(o.measure) ? o.measure : 'RR', derived: startContrast(tpl) } : o));
  return st;
}
/** Whether a comparison has something to show: its sides named and an arm counted, or a result. */
export const setUpContrast = (s, o) => !!analysisOf(s, o.id) || (columnsOf(o.derived).length > 0 && contrastUnits(s, o.derived).units.some(u => u.status !== 'aside'));

/**
 * Runs a comparison of two arms in R and keeps its result (the Run of its page, and Tables and figures' drawing of a printed comparison,
 * views/outputs.mjs): `{ ok }`, or `{ ok: false, reason }` when two studies are not estimable or the inputs changed while it ran. `say`
 * reports R's progress. Throws what R throws.
 */
export async function runComparison(oid, say = () => {}) {
  const s = get(), d = derivedOf(oid), mod = moderator(oid), m = measure(oid);
  const inputs = pooledInputs(s, mod, m, oid), { units } = inputs;
  const [tn, cn] = sideNames(d);
  const meth = method(oid), test = testFor(meth, raw(oid, 'test')), pi = piFor(meth, raw(oid, 'pi')), totals = totalsOf(oid);
  // a study with no events in either arm is not estimable for a ratio: left out and named (lib/analysis-inputs.mjs)
  const zero = zeroEvents(m, units.map(u => u.values)), used = zero.used.map(i => units[i]);
  if (used.length < 2) return { ok: false, reason: `${used.length} estimable ${used.length === 1 ? 'study' : 'studies'} · two are needed` };
  const order = [...new Set((d.subgroup?.levels || []).map(([, l]) => String(l)))];
  const rows = used.map(u => ({ label: u.label, study: u.paperId, values: u.values, level: u.subgroup }));
  const guard = analysisRunGuard(get, state => pooledInputs(state, mod, m, oid).snapshot, projectGeneration);
  const frozenName = outcomeById(get(), oid).name, frozenModerator = mod ? columnLabel(get(), d, mod) : '';
  const resultOf = res => {
    const zeroText = isRare(meth) ? `${METHOD_WORD[meth]} pooled the counts without a continuity correction${zeroEventsText(m, units.map(u => u.label), zero) ? `; ${zeroEventsText(m, units.map(u => u.label), zero)}` : ''}` : zeroEventsText(m, units.map(u => u.label), zero);
    const result = { ...res, measure: m, method: meth, test, settings: settingsOf({ method: meth, test, pi, measure: m }), contrast: { treated: tn, control: cn },
      favours: [`Favours ${tn.toLowerCase()}`, `Favours ${cn.toLowerCase()}`], totals,
      values: used.map(u => u.values), labels: used.map(u => u.label), papers: used.map(u => u.paperId),
      sources: used.map(u => [u.treated.key, u.control.key]), items: used.map(u => [u.treated.item, u.control.item]),
      modValues: mod ? used.map(u => (u.subgroup == null ? null : String(u.subgroup))) : undefined, levelOrder: order,
      zeroEvents: zeroText, excluded: zero.excluded.map(i => units[i].label),
      participants: used.reduce((t, u) => t + u.values[1] + u.values[3], 0),
      moderator: mod, moderatorLabel: frozenModerator, inputSnapshot: inputs.snapshot,
      outcomeId: oid, outcomeName: frozenName, at: new Date().toISOString() };
    return result;
  };
  const viaR = async onProgress => {
    const { code } = contrastScript({ rows, measure: m, method: meth, test, pi, subgroups: !!mod, order });
    const res = await runR(meth === 'GLMM' ? ['metafor', 'svglite', 'lme4'] : ['metafor', 'svglite'], code, onProgress);
    for (const k of ['svg', 'funnel']) if (res[k]) res[k] = compactSvg(res[k]);
    return res;
  };
  // At once where JavaScript gives metafor's numbers (lib/meta-general.mjs: RR, OR or RD, REML, DL or EE, z or Hartung–Knapp, subgroups;
  // checked against native metafor to 1e-9; lib/meta-rare.mjs likewise; the GLMM, lib/meta-glmm.mjs, to lme4's tolerance, 5e-5): that result is kept now, and R runs behind it.
  // R's result then takes its place, with what only R gives (Egger, leave-one-out, the τ² interval, R's figures), and records how far the two
  // differed (jsCheck); a difference past 1e-9 is R's numbers in any case.
  const levels = mod ? levelsOf(rows, order) : [];
  const js = meth === 'GLMM' ? poolGlmmOR(used.map(u => u.values), { mod: levels.length >= 2 ? { kind: 'group', values: rows.map(r => (levels.includes(r.level) ? r.level : null)), levels } : null })
    : isRare(meth) ? (!handlesRare({ measure: m, method: meth }) ? null : levels.length >= 2
    ? poolRareGroups({ measure: m, method: meth, values: used.map(u => u.values), groups: rows.map(r => (levels.includes(r.level) ? r.level : null)), levels })
    : poolRare({ measure: m, method: meth, values: used.map(u => u.values) }))
    : handlesGeneral({ measure: m, method: meth, test, pi })
      ? poolGeneral({ measure: m, method: meth, test, pi, values: used.map(u => u.values),
        mod: mod ? { kind: 'group', values: rows.map(r => r.level), levels, unassigned: true } : null })
      : null;
  if (js) {
    update(st => setAnalysis(st, oid, { ...resultOf(js), engine: 'js', checking: true }));
    const background = (async () => {
      const res = await viaR(() => {});
      if (guard.reason()) return;
      const rel = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / Math.max(Math.abs(y), 1e-12) : 0);
      const jsCheck = Math.max(...['estimate', 'lo', 'hi', 'tau2', 'i2', 'q', 'qp', 'zval', 'pval'].map(k => rel(js[k], res[k])), ...vec(res.weights).map((w, i) => rel(js.weights[i], w)));
      update(st => setAnalysis(st, oid, { ...resultOf(res), engine: 'r', jsCheck }));
    })().catch(() => update(st => { const was = analysisOf(st, oid); if (was?.checking) setAnalysis(st, oid, { ...was, checking: false }); return st; }));
    return { ok: true, background };
  }
  const res = await viaR(say);
  const discarded = guard.reason();
  if (discarded) return { ok: false, reason: guard.belongs() ? discarded : '' };
  update(st => setAnalysis(st, oid, resultOf(res)));
  return { ok: true };
}
