// The Datasets view's Analyse page: choose an analysis, its variables and
// options, run it, and keep the result with the project (lib/dataset-analysis.mjs).
// A kept result reopens as it was; one whose columns have changed since is
// marked stale. The source is a dataset or the patient table.
import { when as day } from '../lib/dates.mjs';
import { esc } from '../lib/html.mjs';
import { saveFile } from '../lib/save.mjs';
import { writeTablesDocx } from '../lib/docx-write.mjs';
import { figurePanel, showFigure } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import {
  ANALYSES, analysisOf, columnsFor, levelsOf, runAnalysis, analysisSvg, analysisEntry, keepAnalysis, removeAnalysis,
  savedFor, isStale, resultCsv, resultDocxBlocks, baselineVariables,
} from '../lib/dataset-analysis.mjs';
import { loadReplayEngine } from '../lib/primary-replay.mjs';
import { sentenceLabel, tableRegion } from '../lib/ui-components.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { copyText } from '../lib/clipboard.mjs';
import { showMenu } from '../lib/menu.mjs';
import { wireDownload } from '../lib/figure.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

const byDataset = new Map();   // datasetId -> { kind, inputs, options, result, savedId }
const stateOf = id => { if (!byDataset.has(id)) byDataset.set(id, { kind: 'table1', inputs: {}, options: {}, result: null, savedId: null }); return byDataset.get(id); };
const fileName = s => String(s || 'analysis').replace(/[^\w.-]+/g, '_').slice(0, 60);

/**
 * The analysis the page has configured for dataset `d`, as the readiness check and a frozen proposal read it
 * (views/analysis-readiness.mjs): the method's own inputs, and every option with the value Run would use.
 */
export function analysisArgs(d) {
  const st = stateOf(d.id), spec = analysisOf(st.kind);
  if (st.kind === 'table1' && st.inputs.variables == null) st.inputs.variables = baselineVariables(d);
  const inputs = Object.fromEntries(Object.entries(st.inputs).filter(([k, v]) => v != null && spec.inputs.some(i => i.key === k)));
  const options = {};
  for (const o of spec.options || []) { const v = st.options[o.key] ?? (o.number ? o.default : o.choices[0][0]); if (v != null && v !== '') options[o.key] = v; }
  return { datasetId: d.id, method: st.kind, inputs: structuredClone(inputs), options };
}

/** Draws the Analyse page for dataset `d` into `el`. `changed` is told after an edit of the analysis (the readiness report it held is gone). */
export function renderAnalyse(el, d, { changed } = {}) {
  const st = stateOf(d.id), spec = analysisOf(st.kind);
  st.changed = changed;
  if (st.kind === 'table1' && st.inputs.variables == null) st.inputs.variables = baselineVariables(d);
  const prediction = st.kind.startsWith('prediction-'), columnSplit = prediction && st.options.split === 'column';
  const visibleInput = input => !prediction || !['partition', 'development', 'validation'].includes(input.key) || columnSplit;
  const visibleOption = option => !columnSplit || !['fraction', 'seed'].includes(option.key);
  const kept = savedFor(d.id);
  const groups = [...new Set(ANALYSES.map(a => a.group))];
  const colSelect = (inp, value) => {
    const cols = columnsFor(d, inp.role);
    if (value && !cols.some(c => c.id === value)) { value = null; st.inputs[inp.key] = null; }
    return `<select data-in="${inp.key}" data-form-key="input-${inp.key}" aria-label="${esc(inp.label)}">${inp.optional || !value ? `<option value="">${inp.optional ? 'None' : 'Choose'}</option>` : ''}${cols.map(c => `<option value="${esc(c.id)}"${value === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;
  };
  const inputHtml = inp => {
    const v = st.inputs[inp.key];
    if (inp.levelOf) {
      const of = st.inputs[inp.levelOf], lv = of ? levelsOf(d, of) : [];
      if (lv.length && !lv.includes(v)) st.inputs[inp.key] = inp.defaultLevel === 'first' ? lv[0] : lv[lv.length - 1];
      return `<label class="field"><span>${esc(inp.label)}</span><select data-in="${inp.key}" data-form-key="input-${inp.key}" aria-label="${esc(inp.label)}"${lv.length ? '' : ' disabled'}>${lv.map(l => `<option value="${esc(l)}"${st.inputs[inp.key] === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    }
    if (inp.multi) {
      const baseline = st.kind === 'table1' ? new Set(baselineVariables(d)) : null;
      const cols = columnsFor(d, inp.role).filter(c => (!baseline || baseline.has(c.id)) && !Object.entries(st.inputs).some(([k, x]) => k !== inp.key && x === c.id));
      const chosen = new Set((Array.isArray(v) ? v : []).filter(id => cols.some(c => c.id === id)));
      st.inputs[inp.key] = [...chosen];
      return `<div class="da-variables" role="group" aria-labelledby="da-label-${inp.key}">${uiBar({ kind: 'head', label: inp.label, id: `da-head-${inp.key}`, lead: { title: inp.label, level: 'h3', id: `da-label-${inp.key}` }, status: { id: `da-count-${inp.key}`, text: `${chosen.size} of ${cols.length} selected`, ch: 24 },
        actions: [{ id: `da-all-${inp.key}`, label: 'Select all', disabled: chosen.size === cols.length, attrs: { 'data-choose-variables': inp.key, 'data-choice': 'all', 'data-form-key': `all-${inp.key}`, 'aria-label': `Select all ${inp.label.toLowerCase()}` } },
          { id: `da-none-${inp.key}`, label: 'Clear', disabled: !chosen.size, attrs: { 'data-choose-variables': inp.key, 'data-choice': 'none', 'data-form-key': `none-${inp.key}`, 'aria-label': `Clear ${inp.label.toLowerCase()}` } }] })}<div class="da-variable-grid" role="region" aria-label="${esc(inp.label)} options" tabindex="0">${cols.map(c => `<label class="cr-check da-variable-option"><input type="checkbox" data-multi="${inp.key}" data-form-key="multi-${inp.key}-${esc(c.id)}" value="${esc(c.id)}"${chosen.has(c.id) ? ' checked' : ''}><span>${esc(c.label)}</span></label>`).join('') || '<span class="meta">No suitable columns</span>'}</div></div>`;
    }
    return `<label class="field"><span>${esc(inp.label)}</span>${colSelect(inp, v)}</label>`;
  };
  // A categorical predictor in a regression chooses its reference level.
  const refHtml = () => {
    if (!['linear', 'logistic', 'poisson'].includes(st.kind)) return '';
    const cats = (st.inputs.predictors || []).map(id => d.columns.find(c => c.id === id)).filter(c => c && c.type !== 'number' && c.type !== 'integer');
    st.inputs.refs ||= {};
    return cats.map(c => { const lv = levelsOf(d, c.id); const cur = st.inputs.refs[c.id] || lv[0];
      return `<label class="field"><span>Reference, ${esc(c.label)}</span><select data-ref="${esc(c.id)}" data-form-key="reference-${esc(c.id)}" aria-label="Reference level of ${esc(c.label)}">${lv.map(l => `<option value="${esc(l)}"${cur === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`; }).join('');
  };
  const optionHtml = o => o.number
    ? `<label class="field"><span>${esc(o.label)}</span><input data-opt="${o.key}" data-form-key="option-${o.key}" inputmode="decimal" autocomplete="off" value="${esc(st.options[o.key] ?? o.default ?? '')}" aria-label="${esc(o.label)}"></label>`
    : `<label class="field"><span>${esc(o.label)}</span><select data-opt="${o.key}" data-form-key="option-${o.key}" aria-label="${esc(o.label)}">${o.choices.map(([k, l]) => `<option value="${esc(k)}"${(st.options[o.key] ?? o.choices[0][0]) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

  el.innerHTML = `<div class="ds-analysis">
    <section class="da-setup" aria-labelledby="da-setup-title"><h2 id="da-setup-title">Analysis setup</h2>
      <div class="an-settings da-fields">
        <label class="field"><span>Method</span><select id="da-kind" aria-label="Method">${groups.map(g => `<optgroup label="${esc(g)}">${ANALYSES.filter(a => a.group === g).map(a => `<option value="${a.kind}"${a.kind === st.kind ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${spec.inputs.filter(i => !i.multi && visibleInput(i)).map(inputHtml).join('')}
        ${(spec.options || []).filter(visibleOption).map(optionHtml).join('')}
        ${refHtml()}
      </div>${spec.inputs.filter(i => i.multi && visibleInput(i)).map(inputHtml).join('')}
      ${prediction ? '<p class="meta" data-ui-help>Use a partition column for external data; keep each participant or site within one split. Predictors are prespecified.</p>' : ''}
      ${uiBar({ kind: 'foot', label: 'Run analysis', id: 'da-setup-foot', actions: [{ id: 'da-run', label: 'Run analysis', icon: 'run', role: 'primary' }] })}</section>
    <div id="da-out" role="region" aria-label="Analysis result"></div>
    ${kept.length ? `<div class="panel">${uiBar({ kind: 'head', label: 'Kept', id: 'da-kept-head', lead: { title: 'Kept' }, status: { text: String(kept.length), ch: 6 } })}
      <div class="panel-body tight">${uiList({ id: 'da-kept', label: 'Kept analyses', rows: kept.slice().reverse().map(a => { const name = a.result.title || a.kind, note = a.result.sentence ? a.result.sentence.slice(0, 90) + (a.result.sentence.length > 90 ? '…' : '') : '';
        return uiRow({ cls: a.id === st.savedId ? 'sel' : '', main: { html: esc(name), detail: [esc(note), esc(day(a.at)), sentenceLabel(isStale(a) ? 'stale' : a.frozenData && a.implementation ? 'current' : 'untracked')], wrap: true },
          end: uiRowEnd({ primary: { id: `da-open-${a.id}`, label: 'Open', attrs: { 'data-open': a.id, 'aria-label': `Open ${name}` } }, more: { label: `More for ${name}`, attrs: { 'data-kept-more': a.id } } }) }); }) })}</div></div>` : ''}
  </div>`;

  const redraw = () => rerenderForm(el, { rerender: () => renderAnalyse(el, d, { changed }) });
  // the handlers change the analysis after they invalidate: `changed` is told once they have
  const invalidate = () => { Object.assign(st, { result: null, run: null, savedId: null, error: null, pending: false, token: (st.token || 0) + 1 }); showResult(el, d, st); if (changed) queueMicrotask(changed); };
  el.querySelector('#da-kind').onchange = e => {
    const next = analysisOf(e.target.value);
    // keep the columns that still fit the new analysis's inputs
    const inputs = {};
    for (const i of next.inputs) { const v = st.inputs[i.key]; if (v && !i.levelOf && (i.multi ? Array.isArray(v) : typeof v === 'string')) inputs[i.key] = v; }
    invalidate(); Object.assign(st, { kind: next.kind, inputs, options: {} });
    redraw();
  };
  el.querySelectorAll('select[data-in]').forEach(s => s.onchange = () => { invalidate(); st.inputs[s.dataset.in] = s.value || null; if (spec.inputs.some(i => i.levelOf === s.dataset.in) || spec.inputs.some(i => i.multi)) redraw(); });
  el.querySelectorAll('[data-multi]').forEach(cb => cb.onchange = () => {
    invalidate(); const k = cb.dataset.multi, set = new Set(st.inputs[k] || []);
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    st.inputs[k] = [...set];
    reflectSelection(k);
    if (['linear', 'logistic', 'poisson'].includes(st.kind)) redraw();
  });
  const reflectSelection = key => {
    const boxes=[...el.querySelectorAll('[data-multi]')].filter(cb=>cb.dataset.multi===key),chosen=new Set(st.inputs[key]||[]);
    boxes.forEach(cb=>{cb.checked=chosen.has(cb.value);});
    const count=el.querySelector(`#da-count-${key}`);
    if(count)count.textContent=`${chosen.size} of ${boxes.length} selected`;
    el.querySelectorAll('[data-choose-variables]').forEach(button=>{if(button.dataset.chooseVariables===key)button.disabled=button.dataset.choice==='all'?chosen.size===boxes.length:chosen.size===0;});
  };
  el.querySelectorAll('[data-choose-variables]').forEach(button=>button.onclick=()=>{
    const key=button.dataset.chooseVariables;
    invalidate();st.inputs[key]=button.dataset.choice==='all'?[...el.querySelectorAll('[data-multi]')].filter(cb=>cb.dataset.multi===key).map(cb=>cb.value):[];
    reflectSelection(key);
    if(['linear','logistic','poisson'].includes(st.kind))redraw();
  });
  el.querySelectorAll('[data-ref]').forEach(s => s.onchange = () => { invalidate(); st.inputs.refs = { ...(st.inputs.refs || {}), [s.dataset.ref]: s.value }; });
  el.querySelectorAll('[data-opt]').forEach(x => x.onchange = () => {
    invalidate(); st.options[x.dataset.opt] = x.value;
    if (prediction && x.dataset.opt === 'split') {
      if (x.value === 'random') { for (const key of ['partition', 'development', 'validation']) delete st.inputs[key]; st.options.evaluation = 'held-out'; }
      redraw();
    }
  });
  el.querySelector('#da-run').onclick = async () => {
    el.querySelectorAll('[data-opt]').forEach(x => { st.options[x.dataset.opt] = x.value; });
    for (const o of spec.options || []) if (!o.number && st.options[o.key] == null) st.options[o.key] = o.choices[0][0];
    invalidate();
    const token = st.token, run = { data: structuredClone(d), kind: st.kind, inputs: structuredClone(st.inputs), options: structuredClone(st.options), engine: null };
    st.pending = true; showResult(el, d, st);
    try {
      const result = runAnalysis(run.data, run.kind, run.inputs, run.options);
      // Source packaging is required for an exact executable export, but a
      // unavailable pack must not prevent the researcher computing statistics.
      let replayNotice = null;
      try { run.engine = await loadReplayEngine(); } catch { replayNotice = 'The replay source pack is unavailable. This result can be kept with frozen inputs; rebuild the app and rerun for a self-contained executable export.'; }
      if (st.token !== token) return;
      st.run = run; st.result = result; st.replayNotice = replayNotice; st.error = null;
    } catch (err) { if (st.token !== token) return; st.result = null; st.error = String(err.message || err); }
    st.pending = false;
    showResult(el, d, st);
  };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    const a = kept.find(x => x.id === b.dataset.open); if (!a) return;
    invalidate(); Object.assign(st, { kind: a.kind, inputs: structuredClone(a.inputs || {}), options: structuredClone(a.options || {}), result: a.result, savedId: a.id, error: null, replayNotice: null });
    redraw();
  });
  el.querySelectorAll('[data-kept-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove analysis', icon: 'trash', danger: true, run: async () => {
    const id = b.dataset.keptMore;
    const point = undoPoint();
    removeAnalysis(id); if (st.savedId === id) st.savedId = null; redraw();
    offerUndo(point, 'Removed the kept analysis', () => redraw());
  } }], { align: 'end' }));
  showResult(el, d, st);
}

function showResult(el, d, st) {
  const out = el.querySelector('#da-out'); if (!out) return;
  const button = el.querySelector('#da-run'); if (button) button.disabled = Boolean(st.pending);
  if (st.pending) { out.innerHTML = '<p class="meta spaced" role="status">Keeping the analysis source for replay…</p>'; return; }
  if (st.error) { out.innerHTML = `<div class="note spaced" role="alert">${esc(st.error)}</div>`; return; }
  const r = st.result;
  if (!r) { out.innerHTML = ''; return; }
  const saved = st.savedId ? savedFor(d.id).find(a => a.id === st.savedId) : null;
  const stale = saved && isStale(saved);
  // in a wide table a value breaks between estimate and interval, not inside "[52.0, 76.0]"
  const table = t => { const subs = new Set(t.sub || []), fit = t.header.includes('Test');
    const cell = c => fit ? esc(c).replace(/, /g, ',\u00a0') : esc(c);
    return `<div class="panel-body tight">${t.title && t.title !== r.title ? `<div class="meta">${esc(t.title)}</div>` : ''}${tableRegion({ label: `${t.title || r.title} table`, html: `<table class="da-table${fit ? ' da-fit' : ''}"><thead><tr>${t.header.map((h, i) => `<th scope="col"${i ? '' : ' class="grow"'}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((row, i) => `<tr>${row.map((c, j) => j ? `<td>${cell(c)}</td>` : `<th scope="row" class="grow${subs.has(i) ? ' da-sub' : ''}">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table>` })}</div>`; };
  out.innerHTML = `<div class="panel">${uiBar({ kind: 'head', label: 'Result', id: 'da-result-head', lead: { title: r.title }, message: { id: 'da-meta', text: `n ${r.n?.used ?? '—'}${r.n?.dropped ? `, ${r.n.dropped} left out` : ''}${saved ? `, kept ${day(saved.at)}` : ''}${stale ? ', data changed since' : ''}` },
      actions: [...(saved ? [] : [{ id: 'da-keep', label: 'Keep', icon: 'check' }]), ...(r.sentence ? [{ id: 'da-copy', label: 'Copy sentence', icon: 'copy' }] : []), { id: 'da-download', label: 'Download', icon: 'download', menu: true }] })}
    ${r.tables.map(table).join('')}
    <div class="panel-body">${r.sentence ? `<p>${esc(r.sentence)}</p>` : ''}<p class="meta da-method">${esc(r.method)}</p>
      ${(r.warnings || []).map(w => `<div class="note spaced">${esc(w)}</div>`).join('')}</div></div>
    ${st.replayNotice ? `<p class="note spaced">${esc(st.replayNotice)}</p>` : ''}
    ${r.plot ? figurePanel({ title: esc(r.plot.title || 'Figure'), id: 'da-fig' }) : ''}`;
  if (r.plot) { const svg = analysisSvg(r.plot, { style: figureTokens(null, { medium: 'screen' }) }); if (svg) showFigure(out, 'da-fig', svg, fileName(r.plot.title), { exportSvg: () => analysisSvg(r.plot, { style: figureTokens(null, { medium: 'export' }) }) }); }
  out.querySelector('#da-keep')?.addEventListener('click', () => {
    if (!st.run) return;
    const run = st.run, entry = analysisEntry(run.data, run.kind, run.inputs, run.options, r, new Date().toISOString(), run.engine);
    st.savedId = keepAnalysis(entry); renderAnalyse(el, d, { changed: st.changed });
  });
  out.querySelector('#da-copy')?.addEventListener('click', async () => { const ok = await copyText(r.sentence); const m = out.querySelector('#da-meta'); if (m) m.textContent = ok ? 'Sentence copied' : 'Could not copy the sentence'; });
  const stem = fileName(`${d.name}-${r.title}`);
  wireDownload(out.querySelector('#da-download'), () => [
    { label: 'CSV', icon: 'table', run: () => saveFile(new Blob([resultCsv(r)], { type: 'text/csv' }), `${stem}.csv`, 'text/csv') },
    ...(r.kind === 'table1' ? [{ label: 'Word', icon: 'file', run: async () => saveFile(await writeTablesDocx({ blocks: resultDocxBlocks(r, `${r.title}. ${d.name}`) }), `${stem}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') }] : [])]);
}
