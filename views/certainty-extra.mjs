// Two items of the Certainty rail beside the outcomes: the GRADE evidence
// profile across them (lib/grade-profile.mjs, lib/evidence-profile.mjs), and
// synthesis without meta-analysis (lib/swim.mjs, lib/swim-state.mjs).
//
// SWiM sits here rather than in Analysis: a systematic review that does not
// pool has no Analysis view at all (lib/workflow.mjs), and its effect
// directions feed the certainty judgements of the same outcomes.
//
// The profile is drawn from the ratings the reviewer made; a linked pooled
// result's facts appear beside the domains in the outcome's own form as
// suggestions, never as ratings.
import { get, update, projectGeneration } from '../store.mjs';
import { toCsv as profileCsv, profileCells } from '../lib/grade-profile.mjs';
import { profileOf, tablesDocxBlocks, readPrevalences, accuracyPerThousand } from '../lib/evidence-profile.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { effectDirection, harvestPlotSvg, SWIM_ITEMS, DIRECTIONS } from '../lib/swim.mjs';
import { swimOf, swimRows, swimCsv, robOf, signP } from '../lib/swim-state.mjs';
import { assessmentRows } from '../lib/appraisal-summary.mjs';
import { writeTablesDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { toRate, rateAnalysed } from '../lib/grade-link.mjs';
import { studies } from '../lib/screen.mjs';
import { researchType } from '../lib/workflow.mjs';
import { figurePanel, showFigure, download, downloadCsv, wireDownload } from '../lib/figure.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { pageOf, pager, wirePager, EDITOR_PAGE_SIZE } from '../lib/paging.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiRowEnd, inspectorActions, menuAnchor } from '../lib/ui-actions.mjs';
import { tableRegion, pagedTable } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { plural } from '../lib/dates.mjs';
import { nameAt, linkPlace, linkChoices, usesOf, setUpOutcome } from '../lib/outcome-links.mjs';
import { shownOutcomes } from '../lib/outcomes.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const PROFILE = 'evidence-profile';
export const SWIM = 'swim';
export const isExtra = id => id === PROFILE || id === SWIM;

const isDta = s => researchType(s)?.id === 'dta-review';

/** The two rail items, after the outcomes. */
export function extraItems(s) {
  const p = profileOf(s), sw = swimOf(s);
  const withDir = Object.keys(sw.cells).length;
  return [
    { id: PROFILE, title: 'Evidence profile', sub: `${plural(p.rows.length, 'outcome')}, ${plural(p.footnotes.length, 'footnote')}`, meta: '', mark: p.missing.length ? `${p.missing.length} unexplained` : '' },
    { id: SWIM, title: 'Synthesis without meta-analysis', sub: `${plural(sw.outcomes.length, 'outcome domain')}, ${plural(withDir, 'study', 'studies')}`, meta: '', mark: '' },
  ];
}

export function extraFocus(id) {
  const s = get();
  if (id === PROFILE) return { kind: 'certainty', label: 'Evidence profile', detail: `${profileOf(s).rows.length} outcomes` };
  const ed = effectDirection(swimRows(s));
  return { kind: 'certainty', label: 'Synthesis without meta-analysis', detail: ed.byOutcome.map(o => o.text).join('; ') || 'no directions recorded' };
}

// ---- evidence profile ------------------------------------------------------------------

// footnote numbers in a cell ("Serious [1,2]") are drawn as superscripts
const withMarks = t => esc(t).replace(/ \[(\d+(?:,\d+)*)\]/g, '<sup>$1</sup>');

async function profileDocx() {
  const blob = await writeTablesDocx({ blocks: tablesDocxBlocks(profileOf(get())), font: 'Arial', size: 7, landscape: true });
  await saveFile(blob, 'grade-evidence-profile.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
const profileCsvDownload = () => download(profileCsv(profileOf(get())), 'grade-evidence-profile.csv', 'text/csv');

// The evidence profile goes into the manuscript linked (views/paper-place.mjs): a table the manuscript redraws when the ratings change
async function insertProfile(ctx) {
  const p = profileOf(get());
  if (!p.rows.length) return;
  if (!await confirmAsk('Insert the evidence profile in the manuscript?', { detail: `A table with ${plural(p.rows.length, 'outcome')} and ${plural(p.footnotes.length, 'footnote')} is added at the end.`, confirm: 'Insert' })) return;
  try { const at = await (await import('./paper-place.mjs')).insertInManuscript('profile'); ctx.say?.(`Inserted at the end of the manuscript as ${at}`); }
  catch (err) { ctx.say?.(err.message); }
  ctx.refreshCounts?.();
}

const profileDownloads = [{ label: 'CSV', icon: 'table', run: () => profileCsvDownload() }, { label: 'Word', icon: 'file', run: () => profileDocx() }];
const fitStatus = (full, short) => ({ text: full.length <= 24 ? full : short, ch: 24 });

/** The evidence profile's part of the title bar (views/certainty.mjs page()): its outcomes and footnotes, Download and Insert in manuscript. */
export function profilePage(rerender) {
  const p = profileOf(get());
  return { title: 'Evidence profile', status: fitStatus(`${plural(p.rows.length, 'outcome')}, ${plural(p.footnotes.length, 'footnote')}`, plural(p.rows.length, 'outcome')),
    actions: [{ id: 'ep-download', label: 'Download', icon: 'download', menu: true, disabled: !p.rows.length, run: btn => showMenu(btn, profileDownloads) },
      { id: 'ep-insert', label: 'Insert in manuscript', icon: 'manuscript', disabled: !p.rows.length, run: () => insertProfile({ say: m => rerender(m) }) }] };
}

export function renderProfile(el, ctx) {
  const s = get(), p = profileOf(s);
  const head = ['Outcome', ...p.columns];
  // the table is wide: it scrolls in a named region that holds the outcome column in place
  const table = p.rows.length ? `${tableRegion({ label: 'Evidence profile', sticky: true, html: `<table class="ep-table"><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${p.rows.map(r => `<tr><th scope="row">${esc(r.outcome || '—')}</th>${profileCells(r).map(c => `<td>${withMarks(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}
    ${p.footnotes.length ? `<ol class="ep-notes">${p.footnotes.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
    ${p.missing.length ? `<div class="ep-missing"><span class="meta">No explanation written</span> ${p.missing.map(m => `<span class="ep-miss">${esc(m.outcome || 'Unnamed')}: ${esc(m.domain)}</span>`).join(' ')}</div>` : ''}`
    : (() => { const n = toRate(s).length;   // rating starts from the outcomes the analyses pooled
      return emptyState({ icon: 'certainty', title: 'No outcomes rated', ...(n ? { actions: [{ id: 'ep-rate', label: `Rate the ${n} analysed ${n === 1 ? 'outcome' : 'outcomes'}`, primary: true }] } : {}) }); })();
  el.innerHTML = `<div class="panel">
    <div class="panel-body">${table}</div></div>
    ${isDta(s) ? accuracyHtml(s) : ''}`;
  const rate = el.querySelector('#ep-rate');
  if (rate) rate.onclick = () => { update(st => { rateAnalysed(st); return st; }); ctx.rerender(); };
  const prev = el.querySelector('[data-prev]');
  if (prev) prev.onchange = () => {
    update(st => { st.evidenceProfile = { ...(st.evidenceProfile || {}), prevalences: prev.value.trim() }; return st; });
    ctx.rerender();
    el.querySelector('[data-prev]')?.focus();
  };
}

// A diagnostic accuracy review states what the summary sensitivity and
// specificity mean for 1,000 people tested, at the prevalences it names.
function accuracyHtml(s) {
  const text = s.evidenceProfile?.prevalences ?? '';
  const prev = readPrevalences(text), rows = accuracyPerThousand(s, prev);
  const body = !s.dta?.biv ? emptyState({ title: 'Bivariate model not run', size: 'inline' })
    : !prev.length ? emptyState({ title: 'No prevalence entered', size: 'inline' })
    : `<table class="ep-table ep-dta"><thead><tr><th scope="col">Prevalence</th><th scope="col">True positives</th><th scope="col">False negatives</th><th scope="col">True negatives</th><th scope="col">False positives</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${r.perThousand} per 1,000</th><td>${esc(r.text.tp)}</td><td>${esc(r.text.fn)}</td><td>${esc(r.text.tn)}</td><td>${esc(r.text.fp)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="panel">${uiBar({ kind: 'head', label: 'Accuracy per 1,000 tested', id: 'ep-accuracy-head', lead: { title: 'Accuracy per 1,000 tested' } })}
    <div class="panel-body"><div class="an-settings"><label class="field"><span>Prevalences</span><input type="text" data-prev value="${esc(text)}" placeholder="5%, 20%" aria-label="Prevalences" spellcheck="false"></label></div>${body}</div></div>`;
}

export function profileInspect(ctx) {
  const p = profileOf(get());
  return [{ title: 'Evidence profile', meta: plural(p.rows.length, 'outcome'),
    html: `<dl class="props"><dt>Footnotes</dt><dd>${p.footnotes.length}</dd><dt>Unexplained</dt><dd>${p.missing.length}</dd></dl>
      ${inspectorActions({ id: 'epi-acts', label: 'Profile actions', actions: [
        { id: 'epi-download', label: 'Download', icon: 'download', menu: true, disabled: !p.rows.length, attrs: { 'data-epi': 'download' } },
        { id: 'epi-insert', label: 'Insert', icon: 'manuscript', disabled: !p.rows.length, attrs: { 'data-epi': 'insert' } }] })}`,
    wire: el => {
      wireDownload(el.querySelector('[data-epi="download"]'), profileDownloads);
      el.querySelector('[data-epi="insert"]').onclick = () => insertProfile(ctx);
    } }];
}

// ---- synthesis without meta-analysis -------------------------------------------------------

const DIR_LABEL = { benefit: '▲ Favors intervention', harm: '▼ Favors comparator', 'no clear': '◄► No clear difference', mixed: '◄► Mixed' };
const WEIGHT_LABEL = { n: 'Sample size', rob: 'Risk of bias', equal: 'Equal' };
const SWIM_PAGE = EDITOR_PAGE_SIZE;   // an edited list pages by 20 (UI_Guidelines, editorRows)
let swimPage = 1, pageGeneration = -1;

const writeSwim = fn => update(st => { const sw = swimOf(st); fn(sw); st.swim = sw; return st; });
const oid = sw => { for (let n = sw.outcomes.length + 1; ; n++) if (!sw.outcomes.some(o => o.id === `o${n}`)) return `o${n}`; };

function harvest(s, medium = 'screen') {
  const sw = swimOf(s), rows = swimRows(s);
  return rows.length ? harvestPlotSvg(rows, { weight: sw.weight || undefined, title: 'Harvest plot', style: figureTokens(null, { medium }) }) : '';
}

// Add outcome domain is the title bar's: the page drawn last binds it, so the new domain's name field takes the focus.
const acts = {};

/** Synthesis without meta-analysis's part of the title bar: the studies and outcome domains, Add outcome domain and Download. */
export function swimPageSpec() {
  const s = get(), sw = swimOf(s), add = { id: 'swim-add', label: 'Add outcome domain', icon: 'plus', run: btn => acts.add?.(btn) };
  // with no domain yet, Add outcome domain is the effect-direction table's own head (renderSwim): the table is there from the start
  if (!sw.outcomes.length) return { title: 'Synthesis without meta-analysis', status: fitStatus(plural(studies(s).length, 'study', 'studies'), plural(studies(s).length, 'study', 'studies')), actions: [] };
  return { title: 'Synthesis without meta-analysis',
    status: fitStatus(`${plural(studies(s).length, 'study', 'studies')}, ${plural(sw.outcomes.length, 'outcome domain')}`, plural(sw.outcomes.length, 'outcome domain')),
    actions: [add, { id: 'swim-download', label: 'Download', icon: 'download', menu: true, disabled: !swimRows(s).length, run: btn => showMenu(btn, swimDownloads()) }] };
}

export function renderSwim(el, ctx, tableOnly = false) {
  if (pageGeneration !== projectGeneration()) { swimPage = 1; pageGeneration = projectGeneration(); }
  const s = get(), sw = swimOf(s), list = studies(s), arows = assessmentRows(s);
  const blank = () => {
    let id = '';
    writeSwim(x => { id = oid(x); x.outcomes.push({ id, name: '' }); });
    ctx.rerender(); el.querySelector(`[data-oname="${id}"]`)?.focus();
  };
  // the review's outcomes with no domain yet are offered first: choosing one adds its column, linked (lib/outcome-links.mjs)
  acts.add = btn => {
    const free = shownOutcomes(get()).filter(o => !usesOf(get(), o.id).swim.length);
    if (!free.length || !btn) return blank();
    showMenu(menuAnchor(btn), [{ label: 'New outcome domain', icon: 'plus', run: blank }, '-',
      ...free.map(o => ({ label: o.name, run: () => { update(st => { setUpOutcome(st, o.id, { grade: false, swim: true }); return st; }); ctx.rerender(); } }))]);
  };
  const view = pageOf(list, swimPage, SWIM_PAGE); swimPage = view.page;
  const rows = swimRows(s), ed = effectDirection(rows);
  const cell = (p, o) => `<td><select data-dir="${esc(p.id)}" data-o="${esc(o.id)}" aria-label="${esc(`${p.label} ${o.name || 'outcome'}`)}">${['', ...DIRECTIONS].map(d =>
    `<option value="${esc(d)}"${sw.cells[p.id]?.[o.id] === d ? ' selected' : ''}>${esc(d ? DIR_LABEL[d] : '')}</option>`).join('')}</select></td>`;
  const table = `<table class="ipd swim-table"><thead><tr><th scope="col">Study</th><th scope="col">n</th><th scope="col">Risk of bias</th>
      ${sw.outcomes.map((o, i) => `<th scope="col"><span class="swim-oh"><input type="text" size="16" data-oname="${esc(o.id)}" value="${esc(o.name)}" placeholder="Outcome domain ${i + 1}" aria-label="Outcome domain ${i + 1}" spellcheck="false">
        ${uiRowEnd({ more: { label: `More for ${o.name || `outcome domain ${i + 1}`}`, attrs: { 'data-odel-more': o.id } } })}</span></th>`).join('')}</tr></thead>
    <tbody>${view.items.map(p => `<tr><td class="study-cell">${esc(p.label)}</td>
      <td><input class="num" size="6" inputmode="numeric" data-n="${esc(p.id)}" value="${esc(sw.n[p.id] || '')}" aria-label="${esc(`${p.label} sample size`)}"></td>
      <td class="swim-rob">${esc(robOf(s, p.id, arows) || '—')}</td>${sw.outcomes.map(o => cell(p, o)).join('')}</tr>`).join('')}</tbody></table>`;
  const tests = ed.byOutcome.length ? `<table class="ep-table swim-tests"><thead><tr><th scope="col">Outcome domain</th><th scope="col">Studies</th><th scope="col">Favour intervention</th><th scope="col">Favour comparator</th><th scope="col">No clear or mixed</th><th scope="col">Sign test p</th></tr></thead>
      <tbody>${ed.byOutcome.map(o => `<tr><th scope="row">${esc(o.outcome)}</th><td>${o.k}</td><td>${o.votes.benefit}</td><td>${o.votes.harm}</td><td>${o.votes['no clear'] + o.votes.mixed}</td><td>${esc(signP(o.signTest.p) || '—')}</td></tr>`).join('')}</tbody></table>`
    : emptyState({ title: 'No directions recorded', size: 'inline' });
  const weight = `<select data-sw="weight" aria-label="Bar height">${['', 'n', 'rob', 'equal'].map(w => `<option value="${w}"${sw.weight === w ? ' selected' : ''}>${esc(w ? WEIGHT_LABEL[w] : 'Bar height: automatic')}</option>`).join('')}</select>`;
  const tableHtml = list.length ? pagedTable({ label: 'Studies by outcome domain', html: table, pager: pager({ id: 'swim-pager', page: view.page, pages: view.pages, total: list.length, label: 'studies', size: SWIM_PAGE }) }) : emptyState({ title: 'No included studies', size: 'inline' });
  if (tableOnly) { const host = el.querySelector('#swim-table-region'); host.innerHTML = tableHtml; wireSwim(host,ctx,n=>{swimPage=n;renderSwim(el,ctx,true);}); return; }
  // No domain yet: the table of included studies is already there, with its first Add outcome domain in its head (a domain is a column)
  if (!sw.outcomes.length) {
    el.innerHTML = `<div class="panel">${uiBar({ kind: 'head', label: 'Effect direction', id: 'swim-head', lead: { title: 'Effect direction' },
        message: { id: 'swim-head-note', text: 'Each outcome domain is a column of directions' },
        actions: [{ id: 'swim-add-first', label: 'Add outcome domain', icon: 'plus', role: 'primary', disabled: !list.length }] })}
      <div class="panel-body tight" id="swim-table-region">${tableHtml}</div></div>
      ${itemsHtml(sw)}`;
    el.querySelector('#swim-add-first').onclick = e => acts.add(e?.currentTarget);
    wireSwim(el, ctx, n => { swimPage = n; renderSwim(el, ctx); });
    return;
  }
  el.innerHTML = `<div class="panel">${uiBar({ kind: 'head', label: 'Effect direction', id: 'swim-head', lead: { title: 'Effect direction' } })}
    <div class="panel-body tight" id="swim-table-region">${tableHtml}</div></div>
    <div class="panel">${uiBar({ kind: 'head', label: 'Sign test', id: 'swim-sign-head', lead: { title: 'Sign test' }, message: { id: 'swim-sign-note', text: 'Benefit against harm, two-sided' } })}
      <div class="panel-body">${tests}</div></div>
    ${rows.length ? figurePanel({ title: 'Harvest plot', id: 'swim-hp', extra: weight }) : ''}
    ${itemsHtml(sw)}`;
  if (rows.length) showFigure(el, 'swim-hp', harvest(s), 'harvest-plot', { exportSvg: () => harvest(get(), 'export') });
  wireSwim(el, ctx,n=>{swimPage=n;renderSwim(el,ctx,true);});
}

// The nine SWiM items (Campbell et al. 2020), with where the review reports each.
function itemsHtml(sw) {
  const done = SWIM_ITEMS.filter(i => sw.items[i.id]).length;
  return `<div class="panel">${uiBar({ kind: 'head', label: 'SWiM reporting items', id: 'swim-items-head', lead: { title: 'SWiM reporting items' }, message: { id: 'swim-items-count', text: `${done} of ${SWIM_ITEMS.length} located` } })}
    <div class="panel-body tight"><table class="ep-table swim-items"><tbody>${SWIM_ITEMS.map(i => `<tr><th scope="row">${esc(i.id)}</th>
      <td><div>${esc(i.name)}</div><div class="meta">${esc(i.section)}: ${esc(i.text)}</div></td>
      <td><input type="text" class="ui-cell-field" data-item="${esc(i.id)}" value="${esc(sw.items[i.id] || '')}" placeholder="Where reported" aria-label="${esc(`Item ${i.id} where reported`)}" spellcheck="false"></td></tr>`).join('')}</tbody></table></div></div>`;
}

function wireSwim(el, ctx, onPage) {
  const again = sel => { ctx.rerender(); if (sel) el.querySelector(sel)?.focus(); };
  // A domain is an outcome of the review (lib/outcome-links.mjs): naming it links it to the outcome of that name or makes one, set up in
  // Analysis and Certainty too; renaming a linked domain renames its outcome everywhere.
  el.querySelectorAll('[data-oname]').forEach(inp => inp.onchange = () => {
    update(st => { st.swim = swimOf(st); nameAt(st, 'swim', inp.dataset.oname, inp.value); return st; });
    again();
  });
  const linkMenu = id => {
    const d = swimOf(get()).outcomes.find(x => x.id === id);
    return linkChoices(get(), 'swim', d).map(c => ({ label: c.name, checked: c.checked, run: () => { update(st => { st.swim = swimOf(st); return linkPlace(st, 'swim', id, c.id); }); again(); } }));
  };
  el.querySelectorAll('[data-odel-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Outcome', icon: 'link', submenu: linkMenu(b.dataset.odelMore) }, '-', { label: 'Remove outcome domain', icon: 'trash', danger: true, run: async () => {
    const sw = swimOf(get()), o = sw.outcomes.find(x => x.id === b.dataset.odelMore);
    const used = Object.values(sw.cells).filter(r => r[o.id]).length;
    const point = undoPoint();
    writeSwim(x => { x.outcomes = x.outcomes.filter(y => y.id !== o.id); for (const r of Object.values(x.cells)) delete r[o.id]; });
    again();
    offerUndo(point, `Removed ${o.name || 'the outcome domain'}${used ? ` and ${plural(used, 'direction')}` : ''}`, () => again());
  } }], { align: 'end' }));
  el.querySelectorAll('[data-dir]').forEach(sel => sel.onchange = () => {
    const { dir: pid, o } = sel.dataset;
    writeSwim(sw => { sw.cells[pid] = { ...(sw.cells[pid] || {}) }; if (sel.value) sw.cells[pid][o] = sel.value; else delete sw.cells[pid][o]; if (!Object.keys(sw.cells[pid]).length) delete sw.cells[pid]; });
    again(`[data-dir="${CSS.escape(pid)}"][data-o="${CSS.escape(o)}"]`);
  });
  el.querySelectorAll('[data-n]').forEach(inp => inp.onchange = () => {
    writeSwim(sw => { const v = inp.value.trim(); if (v) sw.n[inp.dataset.n] = v; else delete sw.n[inp.dataset.n]; });
    again();
  });
  el.querySelectorAll('[data-item]').forEach(inp => inp.onchange = () => writeSwim(sw => { const v = inp.value.trim(); if (v) sw.items[inp.dataset.item] = v; else delete sw.items[inp.dataset.item]; }));
  const w = el.querySelector('[data-sw="weight"]');
  if (w) w.onchange = () => { writeSwim(sw => { sw.weight = w.value; }); again('[data-sw="weight"]'); };
  wirePager(el, 'swim-pager', onPage);
}

const swimDownloads = () => [
  { label: 'CSV', icon: 'table', run: () => downloadCsv(swimCsv(swimRows(get())), 'effect-direction.csv') },
  { label: 'Harvest plot (SVG)', icon: 'download', run: () => { const svg = harvest(get(), 'export'); if (svg) download(svg, 'harvest-plot.svg', 'image/svg+xml'); } },
];

export function swimInspect() {
  const s = get(), ed = effectDirection(swimRows(s));
  return [{ title: 'Synthesis without meta-analysis', meta: plural(ed.outcomes.length, 'outcome domain'),
    html: `<dl class="props">${ed.byOutcome.map(o => `<dt>${esc(o.outcome)}</dt><dd>${esc(o.text)}${o.signTest.p != null ? `; sign test p ${esc(signP(o.signTest.p))}` : ''}</dd>`).join('') || '<dt>Directions</dt><dd>None recorded</dd>'}</dl>
      ${inspectorActions({ id: 'swi-acts', label: 'Direction actions', actions: [
        { id: 'swi-download', label: 'Download', icon: 'download', menu: true, disabled: !ed.studies.length, attrs: { 'data-swi': 'download' } }] })}`,
    wire: el => wireDownload(el.querySelector('[data-swi="download"]'), swimDownloads) }];
}
