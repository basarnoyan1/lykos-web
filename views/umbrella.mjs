// Analysis for an umbrella review (lib/umbrella.mjs). It takes the place of the
// pairwise Analysis view in that review's navigation, under the same title.
//
// Two parts. Overlap: which primary studies each included review contains,
// entered or pasted per review, with the corrected covered area overall and
// between each pair of reviews. Results summary: each association as the
// reviews report it, graded into an evidence class by explicit criteria, with
// the review's AMSTAR 2 confidence beside it.
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { figurePanel, showFigure, downloadCsv, wireDownload } from '../lib/figure.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiRowEnd } from '../lib/ui-actions.mjs';
import { formField, tableRegion, metadataLine } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { plural } from '../lib/dates.mjs';
import { screeningStarted } from '../lib/screen.mjs';
import { cellNumber } from '../lib/fields.mjs';
import { umbrellaOf, reviewsOf, addInclusions, setInclusion, removePrimary, cca, pairwiseCca, citationRows, heatStep, amstarOf, amstarOverall, MEASURES, CRITERIA, CLASS_LABEL, evidenceClass, fmtP, sortedResults, matrixRows, ccaRows, resultRows, ccaHeatSvg, citationMatrixSvg, GRADE_LEVELS } from '../lib/umbrella.mjs';

export const usesDocument = true;
export const meta = { title: 'Analysis', icon: 'analysis' };
export const count = (...a) => REGISTRY.umbrella.count(...a);

const ccaLine = x => (x.pct == null ? 'CCA not defined' : `CCA ${x.pct.toFixed(1)}% · ${x.band.toLowerCase()}`);
export function assistContext() {
  const s = get(), reviews = reviewsOf(s), umb = umbrellaOf(s), all = cca(umb.matrix, reviews.map(r => r.id));
  return `Umbrella review: ${reviews.length} reviews, ${all.r} primary studies, ${ccaLine(all)}; ${umb.results.length} associations`;
}
export function focus() {
  return { kind: 'analysis', mode: 'umbrella', label: 'Umbrella review', detail: assistContext() };
}

let target = null;      // the review a pasted list is added to
let lastAdd = '';

const save = fn => update(st => { st.umbrella = fn(umbrellaOf(st)); return st; });
const f1 = v => (v == null ? '' : v.toFixed(1));

const overall = s => { const reviews = reviewsOf(s), umb = umbrellaOf(s); return cca(umb.matrix, reviews.map(r => r.id)); };

/** The page's head is the title bar: the overall covered area beside the title, the citation matrix and the overlap downloads in More. */
export function page() {
  const s = get(), reviews = reviewsOf(s);
  if (!reviews.length) return { title: 'Umbrella review', actions: [] };
  const rows = citationRows(umbrellaOf(s), reviews).length;
  return { title: 'Umbrella review', status: { text: ccaLine(overall(s)), ch: 24 }, actions: [],
    overflow: [{ id: 'umb-download-matrix', label: 'Download citation matrix', disabled: !rows, run: () => downloadCsv(matrixRows(umbrellaOf(get()), reviewsOf(get())), 'umbrella-citation-matrix.csv') },
      { id: 'umb-download-cca', label: 'Download overlap', disabled: !rows, run: () => downloadCsv(ccaRows(umbrellaOf(get()), reviewsOf(get())), 'umbrella-cca.csv') }] };
}

export function render(el, ctx) {
  const s = get(), reviews = reviewsOf(s), umb = umbrellaOf(s);
  if (!reviews.length) {
    const screening = screeningStarted(s);
    el.innerHTML = emptyState({ icon: 'analysis', title: screening ? 'No included reviews' : 'No reviews',
      actions: [{ id: 'umb-go', label: screening ? 'Screening' : 'Library', icon: screening ? 'screening' : 'library', primary: true }] });
    el.querySelector('#umb-go').onclick = () => ctx.go(screening ? 'screening' : 'library');
    return;
  }
  if (!reviews.some(r => r.id === target)) target = reviews[0].id;
  const ids = reviews.map(r => r.id), all = cca(umb.matrix, ids), pair = pairwiseCca(umb.matrix, ids);
  const rows = citationRows(umb, reviews);
  const covered = reviews.filter(r => (umb.matrix[r.id] || []).length).length;

  const matrix = rows.length ? tableRegion({ label: 'Primary studies by review', sticky: true, html: `<table class="umb-matrix"><thead><tr><th>Primary study</th>
          ${reviews.map(r => `<th class="umb-col" title="${esc(r.title || r.label)}">${esc(r.label)}</th>`).join('')}<th class="num">n</th><th aria-label="Actions"></th></tr></thead>
        <tbody>${rows.map(p => `<tr><td>${esc(p.label)}${p.doi ? `<div class="umb-doi">${esc(p.doi)}</div>` : ''}</td>
          ${reviews.map(r => `<td class="umb-col"><input type="checkbox" data-r="${esc(r.id)}" data-p="${esc(p.id)}" aria-label="${esc(`${p.label} in ${r.label}`)}"${(umb.matrix[r.id] || []).includes(p.id) ? ' checked' : ''}></td>`).join('')}
          <td class="num">${p.n}</td><td>${uiRowEnd({ more: { label: `More for ${p.label}`, attrs: { 'data-p-more': p.id } } })}</td></tr>`).join('')}</tbody></table>` }) : '';
  const heat = reviews.length > 1 && covered > 1 ? `<h3 class="umb-sub">Pairwise CCA %</h3>
        ${tableRegion({ label: 'Pairwise CCA', html: `<table class="umb-heat"><thead><tr><th></th>${reviews.map(r => `<th class="num">${esc(r.label)}</th>`).join('')}</tr></thead>
        <tbody>${reviews.map((a, i) => `<tr><th>${esc(a.label)}</th>${pair[i].map((c, j) => i === j ? '<td class="umb-diag"></td>'
          : `<td class="num umb-h${heatStep(c.pct)}" title="${esc(`N ${c.N} · r ${c.r} · ${c.band || 'not defined'}`)}">${f1(c.pct)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}
        <div class="meta umb-bands">Slight &lt;5 · moderate 5–10 · high 10–15 · very high &gt;15</div>` : '';
  el.innerHTML = `<div class="panel">
    <div class="panel-body">
      <div class="an-settings">
        ${reviewPick(reviews, umb)}
        ${pasteField()}</div>
      ${uiBar({ kind: 'foot', label: 'Add primary studies', id: 'umb-add-bar', start: lastAdd ? [{ id: 'umb-add-meta', message: lastAdd }] : undefined, actions: [{ id: 'umb-add', label: 'Add', icon: 'plus', role: 'primary' }] })}
      ${metadataLine([plural(all.r, 'primary study', 'primary studies'), plural(all.N, 'inclusion'), plural(reviews.length, 'review')])}
      ${matrix}${heat}
    </div></div>
    <div id="umb-heat-host"${covered > 1 ? '' : ' hidden'}>${figurePanel({ title: 'CCA heat map', id: 'umb-heat' })}</div>
    <div id="umb-cm-host"${rows.some(p => p.n) ? '' : ' hidden'}>${figurePanel({ title: 'Citation matrix', id: 'umb-cm' })}</div>
    ${resultsPanel(s, reviews, umb)}`;

  const screen = figureTokens(null, { medium: 'screen' }), print = figureTokens(null, { medium: 'export' });
  if (covered > 1) showFigure(el, 'umb-heat', ccaHeatSvg(umb, reviews, { style: screen }), 'umbrella-cca-heatmap', { exportSvg: () => ccaHeatSvg(umb, reviews, { style: print }) });
  if (rows.some(p => p.n)) showFigure(el, 'umb-cm', citationMatrixSvg(umb, reviews, { style: screen }), 'umbrella-citation-matrix', { exportSvg: () => citationMatrixSvg(umb, reviews, { style: print }) });

  el.querySelector('#umb-review').onchange = e => { target = e.target.value; };
  el.querySelector('#umb-add').onclick = () => {
    const text = el.querySelector('#umb-paste').value;
    if (!text.trim()) return;
    let out = null;
    save(u => { out = addInclusions(u, target, text); return out.umbrella; });
    lastAdd = [`${out.added} new`, out.matched && `${out.matched} matched`, out.repeated && `${out.repeated} already listed`].filter(Boolean).join(' · ');
    ctx.refreshCounts(); ctx.rerender();
  };
  el.querySelectorAll('input[data-p]').forEach(cb => cb.onchange = () => {
    save(u => setInclusion(u, cb.dataset.r, cb.dataset.p, cb.checked)); ctx.rerender();
  });
  el.querySelectorAll('[data-p-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove primary study', icon: 'trash', danger: true, run: () => { save(u => removePrimary(u, b.dataset.pMore)); ctx.rerender(); } }], { align: 'end' }));
  wireResults(el, ctx);
}

// ---- results summary --------------------------------------------------------------------

const NUMERIC = ['est', 'lo', 'hi', 'k', 'cases', 'participants', 'i2', 'piLo', 'piHi', 'p'];
const YES_NO = [['', '—'], ['yes', 'Yes'], ['no', 'No']];

const reviewPick = (reviews, umb) => formField('Review', `<select id="umb-review" aria-label="Review">${reviews.map(r => `<option value="${esc(r.id)}"${r.id === target ? ' selected' : ''}>${esc(r.label)} · ${(umb.matrix[r.id] || []).length}</option>`).join('')}</select>`);
const pasteField = () => formField('Primary studies', '<textarea id="umb-paste" rows="3" placeholder="One per line · label or DOI"></textarea>');

function resultsPanel(s, reviews, umb) {
  const results = sortedResults(umb.results || []);
  const sel = (row, f, options, label) => `<select class="ui-cell-field" data-f="${f}" aria-label="${label}">${options.map(([v, l]) =>
    `<option value="${esc(v)}"${String(row[f] ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const inp = (row, f, label, cls = 'umb-n', ph = '') => `<input class="ui-cell-field ${cls}" data-f="${f}" aria-label="${label}" value="${esc(row[f] ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`;
  const reviewOpts = [['', '—'], ...reviews.map(r => [r.id, r.label])];
  const body = results.map(r => {
    const { cls, criteria } = evidenceClass(r), a = amstarOf(s, r.review), o = a && Object.keys(a).length ? amstarOverall(a) : null;
    const met = CRITERIA.filter(([k]) => criteria[k] === true).map(([, l]) => l);
    const unknown = CRITERIA.filter(([k]) => criteria[k] == null).map(([, l]) => l);
    return `<tr data-row="${esc(r.id)}">
      <td>${inp(r, 'outcome', 'Outcome', 'umb-t')}</td>
      <td>${sel(r, 'review', reviewOpts, 'Review')}</td>
      <td>${sel(r, 'measure', MEASURES.map(([v]) => [v, v]), 'Measure')}</td>
      <td>${inp(r, 'est', 'Estimate')}</td><td>${inp(r, 'lo', 'Lower 95% CI')}</td><td>${inp(r, 'hi', 'Upper 95% CI')}</td>
      <td>${inp(r, 'k', 'k')}</td><td>${inp(r, 'cases', 'Cases')}</td><td>${inp(r, 'participants', 'Participants')}</td>
      <td>${inp(r, 'i2', 'I²')}</td><td>${inp(r, 'piLo', 'PI lower')}</td><td>${inp(r, 'piHi', 'PI upper')}</td>
      <td>${inp(r, 'p', 'P', 'umb-n', r.p === '' || r.p == null ? fmtP(criteria.p) : '')}</td>
      <td>${sel(r, 'sse', YES_NO, 'Small-study effects')}</td><td>${sel(r, 'esb', YES_NO, 'Excess significance')}</td>
      <td>${sel(r, 'largest', YES_NO, 'Largest study significant')}</td>
      <td>${sel(r, 'grade', [['', '—'], ...GRADE_LEVELS.map(g => [g, g])], 'GRADE')}</td>
      <td class="umb-amstar"${o ? ` title="${esc(o.complete ? '' : 'Incomplete')}"` : ''}>${o ? esc(o.complete ? o.rating : `${o.rating}?`) : ''}</td>
      <td class="umb-class">${esc(CLASS_LABEL[cls] || '')}</td>
      <td class="umb-crit"${unknown.length ? ` title="${esc(`Not reported: ${unknown.join(' · ')}`)}"` : ''}>${esc(met.join(' · '))}</td>
      <td>${uiRowEnd({ more: { label: `More for ${r.outcome || 'this association'}`, attrs: { 'data-row-more': r.id } } })}</td></tr>`;
  }).join('');
  return `<div class="panel">
    ${uiBar({ kind: 'head', label: 'Results summary', id: 'umb-res-head', lead: { title: 'Results summary' }, message: { id: 'umb-res-count', text: plural(results.length, 'association') },
      actions: [{ id: 'umb-row', label: 'Add row', icon: 'plus' }, { id: 'umb-res-csv', label: 'Download', icon: 'download', menu: true, disabled: !results.length }] })}
    <div class="panel-body">
      ${results.length ? `${tableRegion({ label: 'Results summary', sticky: true, html: `<table class="umb-results"><thead><tr>
        <th>Outcome</th><th>Review</th><th>Measure</th><th>Estimate</th><th>Lower</th><th>Upper</th><th>k</th><th>Cases</th>
        <th>Participants</th><th>I² %</th><th>PI lower</th><th>PI upper</th><th>P</th><th>Small-study</th><th>Excess sig.</th>
        <th>Largest sig.</th><th>GRADE</th><th>AMSTAR 2</th><th>Class</th><th>Criteria met</th><th aria-label="Actions"></th></tr></thead>
        <tbody>${body}</tbody></table>` })}
        <div class="meta umb-bands">Class I: &gt;1000 cases, P &lt; 10⁻⁶, I² &lt; 50%, PI excludes null, no small-study effects, no excess significance · II: &gt;1000 cases, P &lt; 10⁻⁶, largest study significant · III: &gt;1000 cases, P &lt; 10⁻³ · IV: P &lt; 0.05</div>`
      : emptyState({ title: 'No associations', size: 'inline' })}
    </div></div>`;
}

function wireResults(el, ctx) {
  el.querySelector('#umb-row').onclick = () => {
    const first = reviewsOf(get())[0];
    save(u => ({ ...u, results: [...(u.results || []), { id: `a${Date.now().toString(36)}${(u.results || []).length}`,
      outcome: '', review: first?.id || '', measure: 'OR' }] }));
    ctx.refreshCounts(); ctx.rerender();
  };
  wireDownload(el.querySelector('#umb-res-csv'), [{ label: 'CSV', icon: 'table', run: () => downloadCsv(resultRows(get(), reviewsOf(get())), 'umbrella-results-summary.csv') }]);
  el.querySelectorAll('tr[data-row] [data-f]').forEach(input => input.onchange = () => {
    const id = input.closest('tr').dataset.row, f = input.dataset.f, raw = input.value.trim();
    const value = NUMERIC.includes(f) ? (raw === '' ? '' : Number.isFinite(cellNumber(raw)) ? cellNumber(raw) : '') : raw;
    save(u => ({ ...u, results: (u.results || []).map(r => (r.id === id ? { ...r, [f]: value } : r)) }));
    ctx.rerender();
  });
  el.querySelectorAll('[data-row-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove row', icon: 'trash', danger: true, run: () => {
    save(u => ({ ...u, results: (u.results || []).filter(r => r.id !== b.dataset.rowMore) }));
    ctx.refreshCounts(); ctx.rerender();
  } }], { align: 'end' }));
}
