import { REGISTRY } from './registry.mjs';
import { analysisRunGuard } from '../lib/analysis-run-guard.mjs';
// Analysis for a network meta-analysis (lib/nma.mjs). It takes the place of the
// pairwise Analysis view in that review's navigation, under the same title.
//
// Arms are entered here, per included study, because several arms per study do
// not fit one value per extraction field. The network graph follows the arms as
// they are entered; Run fits the common-effect and random-effects models in
// metafor, and the league table, P-scores and forest plot follow.
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { runR } from '../lib/r.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiRowEnd } from '../lib/ui-actions.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { withIcon, icon } from '../lib/icons.mjs';
import { studyCell } from '../lib/bib.mjs';
import { wireStudies } from '../lib/study.mjs';
import { studies, screeningStarted } from '../lib/screen.mjs';
import { NMA_MEASURES, ARM_FIELDS, nmaMeasure, nmaInputs, nmaStatus, buildNetwork, rCode, fromR, leagueTable,
  versusReference, pScores, networkGeometry, networkSvg, forestSvg, csvRows, resultLine, withCi } from '../lib/nma.mjs';

export const usesDocument = true;
export const meta = { title: 'Analysis', icon: 'analysis' };
export const count = (...a) => REGISTRY.nma.count(...a);
export function assistContext() { const n = get().nma; return resultLine(n?.result, { smallBetter: n?.smallBetter !== false }); }
export function focus() {
  const n = get().nma;
  return { kind: 'analysis', mode: 'network', label: 'Network meta-analysis', detail: n?.result ? resultLine(n.result, { smallBetter: n.smallBetter !== false }) : 'not run' };
}

const FIELD_LABEL = { events: 'Events', n: 'N', mean: 'Mean', sd: 'SD' };
const f2 = x => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(2));
const pv = x => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x) < 0.001 ? '<0.001' : Number(x).toFixed(3));
const ci = c => (c ? withCi(c.est, c.lo, c.hi) : '—');

/** Writes into s.nma, creating it on first use. */
function edit(fn) {
  update(st => {
    st.nma ||= { measure: 'OR', treatments: [], arms: {}, reference: '', smallBetter: true };
    st.nma.treatments ||= []; st.nma.arms ||= {};
    fn(st.nma);
    return st;
  });
}

let armPage = 1, pageGeneration = -1;
const ARM_PAGE = 20;

// Run is the title bar's: the page drawn last binds what it runs.
const acts = {};
const runnable = inp => inp.ready.length >= 2 && inp.order.length >= 2 && inp.connected;
const statusText = inp => { const t = `${inp.ready.length} ready · ${inp.order.length} treatments`; return t.length <= 24 ? t : `${inp.ready.length} ready`; };

/** The page's head is the title bar: Run, the studies ready and the treatments beside the title, the arms' download in More. */
export function page() {
  const s = get();
  if (!studies(s).length) return { title: 'Network meta-analysis', actions: [] };
  const inp = nmaInputs(s);
  return { title: 'Network meta-analysis', status: { text: statusText(inp), ch: 24 },
    actions: [{ id: 'nma-run', label: 'Run', icon: 'run', role: 'primary', disabled: !runnable(inp), run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'nma-csv', label: 'Download arms', disabled: !inp.ready.length, run: () => { const now = nmaInputs(get()); downloadCsv(csvRows(now.ready, nmaMeasure(now.measure).family), 'network-arms.csv'); } }] };
}

export function render(el, ctx) {
  if (pageGeneration !== projectGeneration()) { armPage = 1; pageGeneration = projectGeneration(); }
  const s = get(), included = studies(s);
  if (!included.length) {
    const screening = screeningStarted(s);
    el.innerHTML = emptyState({ icon: 'analysis', title: screening ? 'No included studies' : 'No studies',
      actions: [{ id: 'nma-go', label: screening ? 'Screening' : 'Library', icon: screening ? 'screening' : 'library', primary: true }] });
    el.querySelector('#nma-go').onclick = () => ctx.go(screening ? 'screening' : 'library');
    return;
  }
  const nma = s.nma || {}, inp = nmaInputs(s), m = nmaMeasure(inp.measure), fields = ARM_FIELDS[m.family];
  const treatments = nma.treatments || [], smallBetter = nma.smallBetter !== false;
  const result = nma.result || null, status = nmaStatus(s);
  const used = new Set(Object.values(nma.arms || {}).flat().map(a => a?.treatment).filter(Boolean));
  // Per treatment: the included studies with an arm of it, their participants, and all its arms (what a removal takes).
  const usage = {};
  for (const [id, arms] of Object.entries(nma.arms || {})) for (const a of arms || []) {
    if (!a?.treatment) continue;
    const u = usage[a.treatment] ||= { k: 0, n: 0, arms: 0, ids: new Set() };
    u.arms++;
    if (included.some(p => p.id === id)) { if (!u.ids.has(id)) { u.ids.add(id); u.k++; } if (Number.isFinite(Number(a.n)) && a.n !== '') u.n += Number(a.n); }
  }
  const reference = inp.reference || (treatments.includes(nma.reference) ? nma.reference : treatments[0] || '');
  const choose = (options, cur) => options.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const treatOptions = cur => `<option value=""${cur ? '' : ' selected'}>Choose</option>` +
    treatments.map(t => `<option value="${esc(t)}"${t === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');

  // the arm table pages by study, as every long list does
  const armsHtml = () => {
  const shown = pageOf(included, armPage, ARM_PAGE); armPage = shown.page;
  const armRows = shown.items.map(p => {
    const arms = nma.arms?.[p.id] || [];
    const span = Math.max(1, arms.length);
    const head = `<td class="grow nma-study" rowspan="${span}">${studyCell(p, { open: true, titleLine: false })}<button class="quiet" data-add-arm="${esc(p.id)}">${withIcon('plus', 'Add arm')}</button></td>`;
    if (!arms.length) return `<tr>${head}<td colspan="${fields.length + 2}"><span class="meta">No arms yet</span></td></tr>`;
    return arms.map((a, i) => `<tr>${i ? '' : head}
        <td><select data-arm="${esc(p.id)}" data-i="${i}" data-f="treatment" aria-label="Treatment">${treatOptions(a.treatment)}</select></td>
        ${fields.map(f => `<td class="num"><input class="nma-num" inputmode="decimal" size="6" data-arm="${esc(p.id)}" data-i="${i}" data-f="${f}" aria-label="${FIELD_LABEL[f]}" value="${esc(a[f] ?? '')}"></td>`).join('')}
        <td class="nma-more">${uiRowEnd({ more: { label: 'More for this arm', attrs: { 'data-arm-more': p.id, 'data-i': i } } })}</td></tr>`).join('');
  }).join('');
  return `${tableRegion({ label: 'Arms by study', html: `<table class="nma-arms"><thead><tr><th class="grow">Study</th><th>Treatment</th>${fields.map(f => `<th class="num">${FIELD_LABEL[f]}</th>`).join('')}<th aria-label="Actions"></th></tr></thead><tbody>${armRows}</tbody></table>` })}${pager({ id: 'nma-pager', page: shown.page, pages: shown.pages, total: included.length, label: 'studies', size: ARM_PAGE })}`;
  };

  const pending = [
    inp.incomplete.length && `${inp.incomplete.length} incomplete`,
    inp.invalid.length && `${inp.invalid.length} with a treatment twice`,
    inp.excluded.length && `${inp.excluded.length} without events in any arm, excluded`,
    inp.ready.length >= 2 && !inp.connected && 'Network not connected',
  ].filter(Boolean);

  el.innerHTML = `<div class="panel">
    <div class="panel-body">
      <div class="an-settings nma-settings">
        <label class="field"><span>Effect measure</span><select id="nma-measure" aria-label="Effect measure">${choose(NMA_MEASURES.map(x => [x.id, x.label]), m.id)}</select></label>
        <label class="field"><span>Reference treatment</span><select id="nma-reference" aria-label="Reference treatment">${choose(treatments.map(t => [t, t]), inp.reference || nma.reference || treatments[0] || '')}</select></label>
        <label class="field"><span>Better values</span><select id="nma-better" aria-label="Better values">${choose([['lower', 'Lower'], ['higher', 'Higher']], smallBetter ? 'lower' : 'higher')}</select></label>
        <label class="field"><span>Model</span><select id="nma-model" aria-label="Model">
          <option value="random"${nma.model !== 'common' ? ' selected' : ''}${result && !result.random ? ' disabled' : ''}>Random effects</option>
          <option value="common"${nma.model === 'common' || (result && !result.random) ? ' selected' : ''}>Common effect</option></select></label></div>
    </div>
    ${tableRegion({ label: 'Treatments', html: `<table class="nma-treat"><thead><tr><th class="grow">Treatment</th><th class="num">Studies</th><th class="num">Participants</th><th aria-label="Actions"></th></tr></thead><tbody>
      ${treatments.map(t => { const st = usage[t] || { k: 0, n: 0, arms: 0 }, ref = t === reference;
        return `<tr><td class="grow nma-name-cell"><span class="nma-name">${esc(t)}</span>${ref ? '<span class="meta"> · reference</span>' : ''}</td>
          <td class="num">${st.k}</td><td class="num">${st.n.toLocaleString('en-US')}</td>
          <td class="nma-more">${uiRowEnd({ more: { label: `More for ${t}`, attrs: { 'data-treatment-more': t } } })}</td></tr>`; }).join('')}
      </tbody></table>` })}
    <div class="panel-body">${uiBar({ kind: 'tools', label: 'New treatment', id: 'nma-new', form: true,
      filters: [{ type: 'field', id: 'nma-new-treatment', label: 'New treatment', placeholder: 'New treatment', maxlength: 80, width: 'lg' }],
      actions: [{ id: 'nma-add-treatment', label: 'Add', icon: 'plus', type: 'submit' }] })}</div>
    <div id="nma-arm-region">${armsHtml()}</div>
    ${pending.length ? `<div class="panel-body"><div class="note">${esc(pending.join(' · '))}</div></div>` : ''}
    </div>
    ${result ? resultPanel(result, status, smallBetter, nma.model) : ''}
    <div id="nma-graph-host"${inp.order.length >= 2 ? '' : ' hidden'}>${figurePanel({ title: 'Network graph', id: 'nma-graph' })}</div>
    <div id="nma-forest-host"${result && status === 'current' ? '' : ' hidden'}>${figurePanel({ title: 'Forest plot', id: 'nma-forest' })}</div>`;

  wireStudies(el, ctx);

  const screen = figureTokens(null, { medium: 'screen' }), print = figureTokens(null, { medium: 'export' });
  if (inp.order.length >= 2) {
    const geo = networkGeometry(inp.ready, inp.order);
    showFigure(el, 'nma-graph', networkSvg(geo, { style: screen }), 'nma-network', { exportSvg: () => networkSvg(geo, { style: print }) });
  }
  if (result && status === 'current') {
    const fit = chosenFit(result, nma.model);
    const forest = style => forestSvg(result.order, versusReference(fit, result.measure), { measure: result.measure, scores: pScores(fit, { smallBetter }), style });
    showFigure(el, 'nma-forest', forest(screen), 'nma-forest', { exportSvg: () => forest(print) });
  }

  // Re-render after an edit and return focus to the same control, so Tab keeps its place.
  const refresh = target => {
    const key = target?.dataset ? Object.entries(target.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('') : '';
    ctx.rerender();
    if (key) document.querySelector(`#view ${key}`)?.focus();
  };
  el.querySelector('#nma-measure').onchange = e => { edit(n => { n.measure = e.target.value; }); ctx.rerender(); };
  el.querySelector('#nma-reference').onchange = e => { edit(n => { n.reference = e.target.value; }); ctx.rerender(); };
  el.querySelector('#nma-better').onchange = e => { edit(n => { n.smallBetter = e.target.value === 'lower'; }); ctx.rerender(); };
  el.querySelector('#nma-model').onchange = e => { edit(n => { n.model = e.target.value; }); ctx.rerender(); };
  const addTreatment = () => {
    const input = el.querySelector('#nma-new-treatment'), name = input.value.trim();
    if (!name || treatments.some(t => t.toLowerCase() === name.toLowerCase())) { input.select(); return; }
    edit(n => { n.treatments.push(name); n.reference ||= name; });
    ctx.rerender(); document.querySelector('#nma-new-treatment')?.focus();
  };
  el.querySelector('#nma-new').onsubmit = e => { e.preventDefault(); addTreatment(); };
  const removeTreatment = async t => {
    const arms = usage[t]?.arms || 0;
    if (arms && !await confirmAsk(`Remove ${t}?`, { detail: `${arms} ${arms === 1 ? 'arm' : 'arms'} of ${t} will be removed`, confirm: 'Remove', danger: true })) return;
    edit(n => {
      n.treatments = n.treatments.filter(x => x !== t);
      for (const id of Object.keys(n.arms)) { n.arms[id] = n.arms[id].filter(a => a.treatment !== t); if (!n.arms[id].length) delete n.arms[id]; }
      if (n.reference === t) n.reference = n.treatments[0] || '';
    });
    ctx.rerender();
  };
  // Rename in place: the name becomes an input; Enter saves, Escape cancels.
  const renameTreatment = old => {
    const label = [...el.querySelectorAll('.nma-name')].find(x => x.textContent === old);
    if (!label) return;
    const input = document.createElement('input');
    input.className = 'nma-rename'; input.value = old; input.maxLength = 80; input.size = 24; input.setAttribute('aria-label', `Rename ${old}`);
    label.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      const name = input.value.trim();
      if (save && name && name !== old && !treatments.some(t => t !== old && t.toLowerCase() === name.toLowerCase())) {
        edit(n => {
          n.treatments = n.treatments.map(t => (t === old ? name : t));
          for (const arms of Object.values(n.arms)) for (const a of arms) if (a.treatment === old) a.treatment = name;
          if (n.reference === old) n.reference = name;
        });
      }
      ctx.rerender();
    };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    input.onblur = () => finish(false);
  };
  el.querySelectorAll('[data-treatment-more]').forEach(b => b.onclick = () => {
    const t = b.dataset.treatmentMore;
    showMenu(b, [{ label: 'Rename', run: () => renameTreatment(t) }, ...(t === reference ? [] : ['-', { label: 'Remove treatment', danger: true, run: () => removeTreatment(t) }])]);
  });
  const wireArms = host => {
  host.querySelectorAll('[data-add-arm]').forEach(b => b.onclick = () => {
    const id = b.dataset.addArm;
    edit(n => { (n.arms[id] ||= []).push({ treatment: '' }); });
    refresh({ dataset: { arm: id, i: String((get().nma.arms[id] || []).length - 1), f: 'treatment' } });
  });
  host.querySelectorAll('[data-arm-more]').forEach(b => b.onclick = () => {
    const id = b.dataset.armMore, i = Number(b.dataset.i);
    showMenu(b, [{ label: 'Remove arm', danger: true, run: () => {
      edit(n => { n.arms[id] = (n.arms[id] || []).filter((_, j) => j !== i); if (!n.arms[id].length) delete n.arms[id]; });
      ctx.rerender();
    } }]);
  });
  host.querySelectorAll('[data-arm][data-f]').forEach(c => c.onchange = () => {
    const { arm, i, f } = c.dataset, v = c.value.trim();
    edit(n => { const a = n.arms[arm]?.[Number(i)]; if (a) a[f] = v; });
    const next = document.activeElement !== c && el.contains(document.activeElement) ? document.activeElement : c;
    refresh(next);
  });
    wireStudies(host,ctx);
    wirePager(host,'nma-pager',n=>{armPage=n;host.innerHTML=armsHtml();wireArms(host);host.querySelector('#nma-pager button:not(:disabled)')?.focus({preventScroll:true});});
  };
  wireArms(el.querySelector('#nma-arm-region'));
  // what R reports while it works, and why a run failed or was discarded, is the title bar's message
  acts.run = async btn => {
    const now = nmaInputs(get());
    if (now.snapshot !== inp.snapshot) { ctx.rerender(); return; }
    const guard = analysisRunGuard(get, state => nmaInputs(state).snapshot, projectGeneration);
    btn.disabled = true;
    try {
      const net = buildNetwork(now.ready, now.measure, now.order);
      const out = await runR(['metafor'], rCode(net), msg => ctx.say?.(msg));
      const discarded = guard.reason();
      if (discarded) { if (guard.belongs()) ctx.say?.(discarded); btn.disabled = false; return; }
      const saved = fromR(out, net, { measure: now.measure, order: now.order, snapshot: now.snapshot });
      edit(n => { n.result = saved; });
      ctx.refreshCounts(); ctx.rerender();
    } catch (err) {
      ctx.say?.(String(err?.message || err).slice(0, 120));
      btn.disabled = false;
    }
  };
}

/** The fit on display: random effects unless the review chose common effect or the random fit failed. */
const chosenFit = (a, model) => (model === 'common' || !a.random ? a.common : a.random);

function resultPanel(a, status, smallBetter, model) {
  const fit = chosenFit(a, model), m = nmaMeasure(a.measure);
  const scores = pScores(fit, { smallBetter }), vs = versusReference(fit, a.measure);
  const ranked = a.order.map((t, i) => ({ t, p: scores[i], vs: i ? vs[i - 1] : null })).sort((x, y) => y.p - x.p);
  const league = leagueTable(fit, a.measure);
  const q = a.q || {};
  const qRow = (label, v, df, p) => `<tr><th>${label}</th><td class="num">${f2(v)}</td><td class="num">${df ?? '—'}</td><td class="num">${pv(p)}</td></tr>`;
  const modelLabel = fit === a.random ? 'Random effects · REML' : 'Common effect';
  return `<div class="panel" id="nma-out">
    <div class="panel-head"><h2>Result</h2><span class="meta">${a.k} studies · ${a.order.length} treatments · ${a.designs} designs · ${esc(String(a.at || '').slice(0, 10))}</span></div>
    <div class="panel-body">
      ${status === 'stale' ? '<div class="note">Inputs changed · run again</div>' : ''}
      ${a.random ? '' : `<div class="note spaced">${esc(`Random-effects model ${a.randomError}`)}</div>`}
      <table class="nma-summary"><tbody>
        <tr><th>Effect measure</th><td>${esc(m.label)}</td></tr>
        <tr><th>Model</th><td>${modelLabel}</td></tr>
        <tr><th>τ²</th><td>${a.random ? f2(a.random.tau2) : '—'}</td></tr></tbody></table>
      <h3 class="nma-h">Heterogeneity and inconsistency</h3>
      <table class="nma-q"><thead><tr><th></th><th class="num">Q</th><th class="num">df</th><th class="num">p</th></tr></thead><tbody>
        ${qRow('Total', q.total, q.totalDf, q.totalP)}
        ${qRow('Within designs', q.within, q.withinDf, q.withinP)}
        ${qRow('Between designs', q.between, q.betweenDf, q.betweenP)}</tbody></table>
      <h3 class="nma-h">Ranking</h3>
      <table class="nma-rank"><thead><tr><th>Treatment</th><th class="num">P-score</th><th>vs ${esc(a.order[0])} (95% CI)</th></tr></thead><tbody>
        ${ranked.map(r => `<tr><td>${esc(r.t)}</td><td class="num">${f2(r.p)}</td><td class="nma-ci">${r.vs ? ci(r.vs) : 'Reference'}</td></tr>`).join('')}</tbody></table>
      <h3 class="nma-h">League table · row versus column</h3>
      <div class="nma-league-wrap"><table class="nma-league"><thead><tr><th></th>${a.order.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>
        ${a.order.map((t, i) => `<tr><th>${esc(t)}</th>${a.order.map((_, j) => (i === j ? '<td class="nma-diag"></td>' : `<td class="nma-ci">${ci(league[i][j])}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>
    </div></div>`;
}
