// Analysis for a diagnostic test accuracy review (lib/dta.mjs). It takes the
// place of the pairwise Analysis view in that review's navigation, under the
// same title. Inputs are the accepted 2×2 counts, never retyped (plan I1, J7).
//
// The per-study intervals and the paired forest plot are computed here as soon
// as a table is complete; Run fits the univariate and bivariate models in
// metafor, and the summary point, SROC curve and derived ratios follow.
import { REGISTRY } from './registry.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { runR } from '../lib/r.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { uiBar, uiNotice } from '../lib/ui-actions.mjs';
import { formField, tableRegion, metadataLine } from '../lib/ui-components.mjs';
import { studyCell } from '../lib/bib.mjs';
import { wireStudies, openStudy } from '../lib/study.mjs';
import { screeningStarted } from '../lib/screen.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { dtaInputs, dtaStatus, rCode, fromR, summary, onProportion, forestSvg, srocSvg, csvRows, resultLine, withCi, CI_METHODS, ESTIMATORS, PRIMARY_TABLE, tableSignature, addDtaTable, setDtaSelection, setDtaTableValue, removeDtaTable, restoreDtaTable } from '../lib/dta.mjs';

export const usesDocument = true;
export const meta = { title: 'Analysis', icon: 'analysis' };
export const count = (...a) => REGISTRY.dta.count(...a);
export function assistContext() { return resultLine(get().dta); }
export function focus() {
  const s = get();
  return { kind: 'analysis', mode: 'accuracy', label: 'Diagnostic accuracy', detail: s.dta ? resultLine(s.dta) : 'not run' };
}

// Settings for this window; the model's are read back from the last result.
let ciMethod = 'wilson';
let method = null;
const model = () => method || get().dta?.method || 'REML';

const f2 = x => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(2));
const ci = p => (p ? withCi(p.est, p.lo, p.hi) : '—');

const PAGE = 20;
let pageNo = 1, openPaper = null, pageGeneration = -1;

const COUNT_FIELDS = [['tp', 'TP'], ['fp', 'FP'], ['fn', 'FN'], ['tn', 'TN']];
const META_FIELDS = [['index', 'Index test'], ['reference', 'Reference standard'], ['threshold', 'Threshold'], ['population', 'Population'], ['source', 'Source / table']];
const tableName = r => (r.tableId === PRIMARY_TABLE ? 'Extraction table' : r.tableId);

/** What the list says about one study: its selected table, or why it has none. */
function stateOf(shown, rows) {
  if (!shown) return 'Excluded';
  if (shown.status === 'ready') return rows.length > 1 ? `Complete · ${rows.length} tables` : 'Complete';
  if (shown.status === 'invalid') return 'Invalid counts';
  const missing = COUNT_FIELDS.filter(([k]) => shown[k] == null).map(([, l]) => l);
  return missing.length === COUNT_FIELDS.length ? 'Counts missing' : `${missing.join(', ')} missing`;
}

// Run, the input download and Open extraction are the title bar's: the page drawn last binds what they act on.
const acts = {};
const studyCount = ({ ready, incomplete, invalid, excluded }) => ready.length + incomplete.length + invalid.length + excluded.length;

/** The page's head is the title bar: Run, how many studies have a complete 2×2 table, and in More the input download and Extraction. */
export function page() {
  const inputs = dtaInputs(get()), total = studyCount(inputs);
  if (!total) return { title: 'Diagnostic accuracy', actions: [] };
  return { title: 'Diagnostic accuracy', status: { text: `${inputs.ready.length} of ${total} complete`, ch: 24 },
    actions: [{ id: 'dta-run', label: 'Run', icon: 'run', role: 'primary', disabled: inputs.ready.length < 2, run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'dta-csv', label: 'Download inputs', disabled: !inputs.tables.length, run: () => downloadCsv(csvRows(dtaInputs(get()).tables, ciMethod), 'accuracy-input.csv') },
      { id: 'dta-extract', label: 'Open extraction', run: () => acts.extract?.() }] };
}

export function render(el, ctx) {
  if (pageGeneration !== projectGeneration()) { pageNo = 1; openPaper = null; pageGeneration = projectGeneration(); }
  const s = get(), { ready, incomplete, invalid, tables, excluded, snapshot } = dtaInputs(s);
  const removed = (s.dtaTableTrash || []).filter(r => s.papers.some(p => p.id === r.paperId)).at(-1);
  const total = studyCount({ ready, incomplete, invalid, excluded });
  if (!total) {
    const screening = screeningStarted(s);
    el.innerHTML = emptyState({ icon: 'analysis', title: screening ? 'No included studies' : 'No studies',
      actions: [{ id: 'dta-go', label: screening ? 'Screening' : 'Library', icon: screening ? 'screening' : 'library', primary: true }] });
    el.querySelector('#dta-go').onclick = () => ctx.go(screening ? 'screening' : 'library');
    return;
  }
  const result = s.dta || null, status = dtaStatus(s);
  const groups = [...new Map(tables.filter(r => r.index || r.reference || r.threshold).map(r => [tableSignature(r), r])).values()];
  const papers = [...new Map(tables.map(r => [r.paperId, r.paper])).values()];
  const shownPage = pageOf(papers, pageNo, PAGE); pageNo = shownPage.page;
  if (!shownPage.items.some(p => p.id === openPaper)) openPaper = null;
  const choose = (options, cur) => options.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const notes = [invalid.length && `${invalid.length} invalid ${invalid.length === 1 ? 'table' : 'tables'}`, excluded.length && `${excluded.length} excluded from this synthesis`].filter(Boolean);

  const lines = shownPage.items.map(p => {
    const rows = tables.filter(r => r.paperId === p.id), shown = rows.find(r => r.selected), base = shown || rows[0];
    const open = p.id === openPaper;
    const test = shown ? [shown.index, shown.threshold].filter(Boolean).join(' · ') : '';
    const line = `<tr class="dta-line" data-dta-paper="${esc(p.id)}"${open ? ' data-dta-open' : ''}>
      <td class="grow dta-study"><div class="dta-lead"><button class="icon" data-dta-edit="${esc(p.id)}" aria-expanded="${open}" aria-label="${esc(`Edit 2×2 table: ${p.label || p.id}`)}" title="Edit 2×2 table">${icon('table')}</button>${studyCell(p, { open: true, titleLine: false })}</div></td>
      <td class="dta-test">${test ? esc(test) : `<span class="meta">${shown ? '—' : 'Not in this synthesis'}</span>`}</td>
      ${COUNT_FIELDS.map(([k]) => `<td class="num">${shown && base[k] != null ? esc(String(base[k])) : ''}</td>`).join('')}
      <td class="dta-state" title="${esc(shown?.problems.join('; ') || '')}">${esc(stateOf(shown, rows))}</td></tr>`;
    return line + (open ? `<tr class="dta-editor-tr"><td colspan="7">${editorHtml(s, p, rows)}</td></tr>` : '');
  }).join('');

  el.innerHTML = `<div class="panel">
    <div class="panel-body">
      <div class="an-settings">
        ${formField('Study intervals', `<select id="dta-ci" aria-label="Study intervals">${choose(CI_METHODS, ciMethod)}</select>`)}
        ${formField('Univariate model', `<select id="dta-model" aria-label="Univariate model">${choose(ESTIMATORS, model())}</select>`)}
        </div>
      ${groups.length ? uiBar({ kind: 'tools', label: 'Match studies', id: 'dta-match-tools', filters: [{ type: 'select', id: 'dta-match', label: 'Match test, reference and threshold',
        options: [['', 'Use one test for every study…'], ...groups.map(r => [tableSignature(r), [r.index, r.reference, r.threshold].filter(Boolean).join(' · ')])] }] }) : ''}
      ${removed ? uiNotice({ id: 'dta-removed', label: 'Removed table', text: `Removed ${removed.table.id} from ${s.papers.find(p => p.id === removed.paperId)?.label || removed.paperId}.${removed.wasSelected ? ' The selected input reverted to extraction.' : ''}`,
        actions: [{ id: 'dta-restore', label: 'Undo removal', icon: 'undo', attrs: { 'data-dta-restore': removed.id } }] }) : ''}
      ${notes.length ? metadataLine(notes) : ''}
    </div>
    <div class="dta-region">${tableRegion({ label: 'Studies and 2×2 tables', html: `<table class="dta-rows"><thead><tr><th class="grow">Study</th><th>Index test · threshold</th>
      ${COUNT_FIELDS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th>State</th></tr></thead><tbody>${lines}</tbody></table>` })}</div>
    ${pager({ id: 'dta-pager', page: shownPage.page, pages: shownPage.pages, total: papers.length, label: 'studies', size: PAGE })}
    </div>
    ${result ? resultPanel(result, status) : ''}
    <div id="dta-forest-host"${ready.length ? '' : ' hidden'}>${figurePanel({ title: 'Paired forest plot', id: 'dta-forest' })}</div>
    <div id="dta-sroc-host"${result && status === 'current' ? '' : ' hidden'}>${figurePanel({ title: 'Summary ROC', id: 'dta-sroc' })}</div>`;

  wireStudies(el, ctx);
  const sm = status === 'current' ? summary(result.biv) : null;
  const screen = figureTokens(null, { medium: 'screen' }), print = figureTokens(null, { medium: 'export' });
  const forest = style => forestSvg(ready, { method: ciMethod, style, pooled: sm ? { label: 'Summary (bivariate)', sens: sm.sens, spec: sm.spec } : null });
  if (ready.length) showFigure(el, 'dta-forest', forest(screen), 'dta-forest', { open: pid => openStudy(ctx, pid), exportSvg: () => forest(print) });
  if (result && status === 'current') showFigure(el, 'dta-sroc', srocSvg(ready, result, { style: screen }), 'dta-sroc', { open: pid => openStudy(ctx, pid), exportSvg: () => srocSvg(ready, result, { style: print }) });

  acts.extract = () => ctx.go('extraction');
  el.querySelector('#dta-ci').onchange = e => { ciMethod = e.target.value; ctx.rerender(); };
  el.querySelector('#dta-model').onchange = e => { method = e.target.value; };
  wireTables(el, ctx, tables);
  wirePager(el, 'dta-pager', n => { pageNo = n; openPaper = null; ctx.rerender(); });
  // what R reports while it works, and why a run failed, is the title bar's message
  acts.run = async btn => {
    const now = dtaInputs(get());
    if (now.snapshot !== snapshot) { ctx.rerender(); return; }
    btn.disabled = true;
    try {
      const methodUsed = model(), project = get().project;
      const out = await runR(['metafor'], rCode(now.ready, { method: methodUsed }), m => ctx.say?.(m));
      if (get().project !== project) return;
      const saved = fromR(out, now.ready, { method: methodUsed, snapshot: now.snapshot });
      update(st => { st.dta = saved; return st; });
      ctx.refreshCounts(); ctx.rerender();
    } catch (err) {
      ctx.say?.(String(err?.message || err).slice(0, 120));
      btn.disabled = false;
    }
  };
}

/** The one open editor: every table of a study, which one enters the synthesis, and the actions on them. */
function editorHtml(s, p, rows) {
  const selected = rows.find(r => r.selected)?.tableId || 'none';
  const valueKey = (r, f) => `${r.paperId}:${({ index: 'dta_index', reference: 'dta_reference', threshold: 'dta_threshold', population: 'dta_population', source: 'dta_source' })[f] || f}`;
  const input = (r, f, label) => {
    const count = COUNT_FIELDS.some(([k]) => k === f);
    return formField(label, `<input data-dta-field="${f}" data-dta-paper="${esc(p.id)}" data-dta-table="${esc(r.tableId)}" data-form-key="${esc(`dta:${p.id}:${r.tableId}:${f}`)}" aria-label="${esc(`${p.label || p.id}, ${r.tableId === PRIMARY_TABLE ? 'extraction table' : r.tableId}: ${label}`)}" value="${esc(r[f] ?? '')}"
      ${count ? 'type="text" inputmode="numeric" size="6"' : 'type="text"'}${r.tableId === PRIMARY_TABLE && s.values?.[valueKey(r, f)]?.locked ? ' disabled title="Locked accepted value"' : ''}>`);
  };
  const choices = [...rows.map(r => [r.tableId, `Use ${r.tableId === PRIMARY_TABLE ? 'extraction table' : r.tableId} · ${[r.index, r.threshold].filter(Boolean).join(' · ') || r.status}`]), ['none', 'Exclude this study']];
  const cell = (r, f) => `<td>${input(r, f, f.toUpperCase())}</td>`;
  return `<div class="dta-editor" data-dta-editor="${esc(p.id)}">
    ${uiBar({ kind: 'tools', label: `Tables of ${p.label || p.id}`, id: 'dta-ed-tools',
      filters: [{ type: 'select', id: 'dta-ed-select', label: `${p.label || p.id}: table for this synthesis`, options: choices, value: selected,
        attrs: { 'data-dta-select': p.id, 'data-form-key': `dta:${p.id}:selection` } }],
      actions: [{ id: 'dta-add', label: 'Add test / threshold', icon: 'plus', attrs: { 'data-dta-add': p.id } }, { id: 'dta-done', label: 'Done', icon: 'check' }] })}
    ${rows.map(r => `<section class="dta-table-body" aria-label="${esc(tableName(r))}">
      ${rows.length > 1 ? `<h3 class="dta-table-h">${esc(tableName(r))}</h3>${metadataLine([r.status === 'ready' ? 'Complete' : r.status === 'invalid' ? 'Invalid' : 'Incomplete', r.selected ? 'selected' : ''])}` : ''}
      <div class="an-settings">${META_FIELDS.map(([f, l]) => input(r, f, l)).join('')}</div>
      <table class="dta-2x2"><tbody>
        <tr><th></th><th scope="col">Reference positive</th><th scope="col">Reference negative</th></tr>
        <tr><th scope="row">Test positive</th>${cell(r, 'tp')}${cell(r, 'fp')}</tr>
        <tr><th scope="row">Test negative</th>${cell(r, 'fn')}${cell(r, 'tn')}</tr></tbody></table>
      ${r.problems.length ? metadataLine([r.problems.join('; ')]) : ''}
      ${r.tableId !== PRIMARY_TABLE ? uiBar({ kind: 'foot', label: `Remove ${r.tableId}`, id: `dta-rm-${r.tableId}`,
        start: [{ id: `dta-remove-${r.tableId}`, label: 'Remove table', role: 'destructive', attrs: { 'data-dta-remove': r.tableId, 'data-dta-paper': p.id } }] }) : ''}
    </section>`).join('')}
  </div>`;
}

function wireTables(el, ctx, tables) {
  const change = fn => { update(s => { fn(s); return s; }); rerenderForm(el, ctx); ctx.refreshCounts?.(); };
  const toggle = pid => {
    openPaper = openPaper === pid ? null : pid;
    rerenderForm(el, ctx, { after: () => {
      const target = openPaper ? el.querySelector(`[data-dta-editor="${CSS.escape(pid)}"] input:not(:disabled)`) : el.querySelector(`[data-dta-edit="${CSS.escape(pid)}"]`);
      target?.focus();
    } });
  };
  el.querySelectorAll('[data-dta-edit]').forEach(b => b.onclick = () => toggle(b.dataset.dtaEdit));
  el.querySelector('#dta-done')?.addEventListener('click', () => toggle(openPaper));
  el.querySelectorAll('[data-dta-field]').forEach(x => x.onchange = () => change(s => setDtaTableValue(s, x.dataset.dtaPaper, x.dataset.dtaTable, x.dataset.dtaField, x.value)));
  el.querySelectorAll('[data-dta-select]').forEach(x => x.onchange = () => change(s => setDtaSelection(s, x.dataset.dtaSelect, x.value)));
  el.querySelectorAll('[data-dta-add]').forEach(b => b.onclick = () => change(s => addDtaTable(s, b.dataset.dtaAdd)));
  el.querySelectorAll('[data-dta-remove]').forEach(b => b.onclick = () => change(s => removeDtaTable(s, b.dataset.dtaPaper, b.dataset.dtaRemove)));
  el.querySelector('[data-dta-restore]')?.addEventListener('click', e => change(s => restoreDtaTable(s, e.currentTarget.dataset.dtaRestore)));
  el.querySelector('#dta-match')?.addEventListener('change', e => {
    if (!e.target.value) return;
    change(s => {
      for (const pid of new Set(tables.map(r => r.paperId))) {
        const row = tables.find(r => r.paperId === pid && tableSignature(r) === e.target.value);
        setDtaSelection(s, pid, row?.tableId || 'none');
      }
    });
  });
}

function resultPanel(a, status) {
  const sm = summary(a.biv);
  const uni = key => (a.uni?.[key]?.b == null ? null : onProportion(a.uni[key].b, a.uni[key].se));
  const row = (label, biv, uniCell = '') => `<tr><th>${label}</th><td class="dta-ci">${biv}</td><td class="dta-ci">${uniCell}</td></tr>`;
  return `<div class="panel" id="dta-out">
    <div class="panel-head"><h2>Result</h2><span class="meta">k = ${a.k} · ${esc(String(a.at || '').slice(0, 10))}</span></div>
    <div class="panel-body">
      ${status === 'stale' ? '<div class="note">Inputs changed · run again</div>' : ''}
      <table class="dta-result"><thead><tr><th></th><th>Bivariate · REML</th><th>Univariate · ${esc(a.method === 'DL' ? 'DerSimonian–Laird' : 'REML')}</th></tr></thead><tbody>
        ${row('Sensitivity', sm ? ci(sm.sens) : esc(`Bivariate model ${a.bivError}`), ci(uni('sens')))}
        ${row('Specificity', sm ? ci(sm.spec) : '', ci(uni('spec')))}
        ${sm ? row('Positive likelihood ratio', ci(sm.lrPos)) + row('Negative likelihood ratio', ci(sm.lrNeg)) + row('Diagnostic odds ratio', ci(sm.dor)) : ''}
        ${row('τ² logit sensitivity', sm ? f2(sm.tau2Sens) : '', f2(a.uni?.sens?.tau2))}
        ${row('τ² logit specificity', sm ? f2(sm.tau2Spec) : '', f2(a.uni?.spec?.tau2))}
        ${sm ? row('Correlation ρ', f2(sm.rho)) : ''}
        ${row('I² sensitivity', '', `${f2(a.uni?.sens?.i2)}%`)}
        ${row('I² specificity', '', `${f2(a.uni?.spec?.i2)}%`)}
      </tbody></table>
      ${sm && Math.abs(Number(sm.rho)) > 0.99 ? '<div class="note spaced">Correlation at the boundary (|ρ| ≈ 1): the between-study variances are too small to estimate it; report the univariate results alongside</div>' : ''}
    </div></div>`;
}
