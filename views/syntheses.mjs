// Syntheses: every comparison and grouping of the review's arms crossed with every outcome, with the verdict of each (lib/synth-project.mjs, plan §4.15g).
// Two tables: comparisons (a meta-analysis and a SWiM column per outcome) and groupings (a pooled proportion per outcome). A cell opens its details in a row under
// it, where it was clicked; nothing else on the page moves, and the page is not redrawn for a click.
import { get } from '../store.mjs';
import { esc, emptyState, sanitizeSvg } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, uiRowEnd, uiList, uiRow, watchWidth } from '../lib/ui-actions.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { tableRegion, disclosure } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { saveFile } from '../lib/save.mjs';
import { synthesisModel, configOf, fillArms, synthTemplate, levelsFromColumn } from '../lib/synth-project.mjs';
import { figureOf, screenFigureOf, subgroupChoices, optionsOf, forestKey, sidesOf } from '../lib/synth-figures.mjs';
import { forestOptions, storedOptions, favoursOf, RATIO_AXES } from '../lib/forest-options.mjs';
import { svgToPdf } from '../lib/svg-pdf.mjs';
import { rasterSvg } from '../lib/figure-draw.mjs';
import { VERDICTS, SETTINGS, PROPORTION_MODELS } from '../lib/synth.mjs';
import { weakSummary, customDefinition } from '../lib/synth-plan.mjs';
import { evaluateAll } from '../lib/synth.mjs';
import { formDialog, ask } from '../lib/dialog.mjs';
import { formField, formFit } from '../lib/ui-components.mjs';
import { runChecks, checksNow, withChecks, checksOf } from '../lib/synth-checks.mjs';

export const meta = { title: 'Syntheses', icon: 'matrix' };
export const assistContext = () => { const m = model(); return m ? `Syntheses: ${m.records.length} combinations, ${Object.entries(m.counts).filter(([, n]) => n).map(([v, n]) => `${n} ${v}`).join(', ')}` : ''; };

let build = null, mode = 'results', fUse = 'probably', fSet = 'named', fVerdict = 'Exploratory only', fOutcome = '', sel = null, fig = null, look = 'app', again = () => {};
/** The figure asked for; a forest's subgroups, pooling, columns, favors and axis are its stored options (s.synthesis.forests), so a kept one draws as it was set. */
const figKind = () => fig;
const model = () => { try { const m = synthesisModel(get()); return m.arms.length ? m : null; } catch (err) { console.error(err); return null; } };

/** The title bar: the page's name and the setup file in and out. */
export function page() {
  return { title: 'Syntheses', view: { id: 'syn-view', label: 'Syntheses view', attr: 'data-syn-view', value: mode, items: [['results', 'Results'], ['matrix', 'Matrix'], ['arms', 'Arms'], ['setup', 'Definitions']], run: k => { mode = k; again(); } },
    actions: [{ id: 'syn-setup', label: 'Setup', icon: 'settings', menu: true, run: a => showMenu(a, [
    { label: 'Methods and thresholds', icon: 'settings', run: () => editSettings() },
    { label: 'Figure sheet (PDF)', icon: 'download', run: () => figureSheetPdf() },
    { label: 'Fill empty levels from the rules', icon: 'refresh', run: async () => { const { update } = await import('../store.mjs'); update(s => { s.synthesis = { ...configOf(s), arms: fillArms(s) }; return s; }); again(); } },
    { label: 'Export setup', icon: 'export', run: () => saveFile(JSON.stringify(configOf(get()), null, 2) + '\n', 'synthesis-setup.json', 'application/json') },
    { label: 'Import setup', icon: 'import', run: () => pickSetup() }], { align: 'end', minWidth: 180 }) }] };
}

const MARK = { Usable: ['check', 'good'], 'Usable with caveat': ['warn', 'warn'], 'Usable, descriptive': ['check', 'quiet'], 'Exploratory only': ['warn', 'quiet'], 'Text only': ['minus', 'quiet'], 'Not usable': ['minus', 'faint'] };
const mark = (v, label = '') => `<span class="syn-mark" data-v="${esc(MARK[v][1])}" title="${esc(label ? `${label}: ${v}` : v)}">${icon(MARK[v][0], { size: 14 })}<span class="visually-hidden">${esc(label ? `${label}: ${v}` : v)}</span></span>`;
const rank = v => VERDICTS.indexOf(v);

// The thresholds a verdict is decided by, and the model of pooled proportions; stored in the project (s.synthesis.settings), defaults are the review's.
// in three groups of the grid's rows: comparisons (studies), groupings (arms), what is flagged
const LIMITS = [['usableStudies', 'Studies, Usable'], ['exploratoryStudies', 'Studies, Exploratory only'], ['usableDirections', 'Studies with a direction, SWiM'],
  ['usableArms', 'Arms, Usable'], ['caveatArms', 'Arms, Usable with caveat'], ['subgroupArms', 'Arms in each subgroup'], ['i2Flag', 'I² flagged above, %'], ['followupRatio', 'Follow-up ratio flagged']];
async function editSettings() {
  const cur = { ...SETTINGS, ...(configOf(get()).settings || {}) };
  const num = (k, l) => formField(l, `<input name="${k}" type="text" inputmode="${k === 'followupRatio' ? 'decimal' : 'numeric'}" pattern="${k === 'followupRatio' ? '[0-9]+([.,][0-9]+)?' : '[0-9]+'}" value="${esc(cur[k])}" required>`);
  const fields = [formField('Pooled proportions', `<select name="proportionModel">${PROPORTION_MODELS.map(([k, l]) => `<option value="${k}"${k === cur.proportionModel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`, { span: 2 }), ...LIMITS.map(([k, l]) => num(k, l))];
  const v = await formDialog({ id: 'syn-settings', title: 'Methods and thresholds', tier: 'L',
    body: `<div class="ask-scroll"><div class="an-settings"${formFit([2, 1, 1, 1, 1, 1, 1, 1, 1])}>${fields.join('')}</div></div>`,
    start: { id: 'reset', label: 'Defaults' } });
  if (!v) return;
  const next = v.act === 'reset' ? {} : Object.fromEntries([['proportionModel', v.proportionModel], ...LIMITS.map(([k]) => [k, Number(String(v[k]).replace(',', '.'))]).filter(([k, n]) => Number.isFinite(n) && n !== SETTINGS[k])].filter(([k, x]) => k !== 'proportionModel' || x !== SETTINGS.proportionModel));
  const { update } = await import('../store.mjs');
  update(s => { s.synthesis = { ...configOf(s), settings: next }; return s; });
  again();
}

function pickSetup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  input.onchange = async () => {
    const f = input.files[0]; input.remove();
    if (!f) return;
    try {
      const cfg = JSON.parse(await f.text()), { update } = await import('../store.mjs'), { namedFromSetup } = await import('../lib/synth-migrate.mjs');
      // the setup's facets, overlap and thresholds; its named combinations with their studies found by name; the arms' stored levels and the checks are kept
      update(s => { const was = configOf(s), named = namedFromSetup(s, cfg); if (named) delete named.missing; const { comparisons, groupings, outcomes, ...rest } = cfg; void comparisons; void groupings; void outcomes;
        s.synthesis = { ...was, ...rest, arms: was.arms, checks: was.checks, ...(named ? { named } : {}) }; return s; });
      again();
    }
    catch (err) { const n = document.getElementById('syn-note'); if (n) n.textContent = `${f.name}: ${String(err.message || err).slice(0, 100)}`; }
  };
  document.body.append(input); input.click();
}

const recsOf = (m, code, oid) => m.records.filter(r => r.code === code && r.outcomeId === oid);
const recOf = (m, code, oid, method) => recsOf(m, code, oid).find(r => r.method.startsWith(method));

/** The rows of one table: those with a verdict at least as good as the filter on the outcome shown (any, when all are shown), best first. */
function rowsOf(m, defs, methods) {
  const outs = fOutcome ? [fOutcome] : m.outcomes.map(o => o.id), floor = rank(fVerdict), named = defs.some(d => d.named);
  return defs.filter(d => !named || fSet === 'all' || d.named).map(d => {
    const vs = outs.flatMap(oid => methods.map(k => recOf(m, d.code, oid, k)?.verdict).filter(Boolean));
    return { d, best: Math.min(...vs.map(rank), 99), k: Math.max(0, ...m.records.filter(r => r.code === d.code).map(r => r.kEst ?? r.kBoth ?? 0)) };
  }).filter(r => r.best <= floor).sort((a, b) => a.best - b.best || b.k - a.k);
}

function tableHtml(m, rows, { label, methods }) {
  // an outcome none of these rows is evaluated on has no column
  const outs = m.outcomes.filter(o => (!fOutcome || o.id === fOutcome) && rows.some(({ d }) => recsOf(m, d.code, o.id).length)), two = methods.length > 1, cols = 1 + outs.length * methods.length;
  const head = two ? `<tr><th rowspan="2">${label}</th>${outs.map(o => `<th colspan="2" class="syn-oc">${esc(o.name)}</th>`).join('')}</tr><tr>${outs.map(() => '<th class="syn-sub">MA</th><th class="syn-sub">SWiM</th>').join('')}</tr>`
    : `<tr><th>${label}</th>${outs.map(o => `<th class="syn-oc">${esc(o.name)}</th>`).join('')}</tr>`;
  const body = rows.map(({ d }) => `<tr data-row="${esc(d.code)}"><td class="syn-label">${esc(d.title)}</td>${outs.map(o => methods.map(k => {
    const x = recOf(m, d.code, o.id, k), on = sel?.code === d.code && sel?.outcomeId === o.id;
    return `<td class="syn-cell">${x ? `<button type="button" class="syn-pick" data-code="${esc(d.code)}" data-oid="${esc(o.id)}" aria-pressed="${on}" aria-label="${esc(`${d.title}, ${o.name}, ${x.method.split(' (')[0]}: ${x.verdict}`)}">${mark(x.verdict)}</button>` : ''}</td>`;
  }).join('')).join('')}</tr>${sel?.code === d.code ? openRow(m, cols) : ''}`).join('');
  return tableRegion({ label, sticky: true, html: `<table class="cl syn-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>` });
}

// ---- the open row ------------------------------------------------------------------------------------------------------------------------
const pct = x => `${x.e}/${x.n}`;
function verdictBlock(r, title) {
  return `<div class="syn-v"><div class="syn-vhead">${mark(r.verdict)}<strong>${esc(title)}</strong><span>${esc(r.verdict)}</span></div>
    ${r.result ? `<div>${esc(r.result)}</div>` : ''}<div class="meta">${esc(r.reason)}</div></div>`;
}
/** The figure a combination opens with: its forest plot, else its effect directions, else its proportion forest. */
function firstFigure(m) {
  const rs = recsOf(m, sel.code, sel.outcomeId), meta = rs.find(r => r.method.startsWith('Meta')), swim = rs.find(r => r.method.startsWith('SWiM'));
  return meta?.kEst ? 'forest' : swim?.rows.length ? 'swim' : rs.some(r => r.family === 'Proportions') ? 'proportions' : null;
}
const defOf = m => [...m.comparisons, ...m.groupings].find(d => d.code === sel?.code);
const checkPrefix = () => `synth.${String(sel.code).toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${sel.outcomeId}.`;
/** The project's checks, failing ones first, each with what it reads now; folded when all hold. */
/**
 * The kept checks: grouped under their combination (the label's part before its last colon), the groups with a change first; each row
 * its measure, the value kept, and now: a check mark and Holds, or a warning and the value it reads now. A verdict carries its mark.
 * On Matrix the list folds when every check holds; Results shows it only when one does not.
 */
function checksHtml() {
  const res = runChecks(get());
  if (!res.length || (mode === 'results' && res.every(r => r.pass))) return '';
  const groups = new Map();
  for (const r of res) {
    const text = r.label || r.key, cut = text.lastIndexOf(': ');
    const [group, measure] = cut > 0 ? [text.slice(0, cut), text.slice(cut + 2)] : [text, 'Value'];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ ...r, measure: measure.replace(/^./, c => c.toUpperCase()) });
  }
  const ordered = [...groups].sort((a, b) => (a[1].every(r => r.pass) ? 1 : 0) - (b[1].every(r => r.pass) ? 1 : 0));
  const value = v => (VERDICTS.includes(v) ? `<span class="syn-check-v">${mark(v)}<span>${esc(v)}</span></span>` : esc(v ?? 'No value'));
  const now = r => r.pass ? `<span class="syn-check-now" data-pass>${icon('check', { size: 14 })}<span>Holds</span></span>`
    : `<span class="syn-check-now" data-fail>${icon('warn', { size: 14 })}<strong>${r.got == null ? 'No value' : value(r.got)}</strong></span>`;
  const body = ordered.map(([group, rows]) => `<tbody><tr class="syn-check-group"><th colspan="3" scope="colgroup">${esc(group)}</th></tr>
    ${rows.map(r => `<tr${r.pass ? '' : ' data-fail'}><td>${esc(r.measure)}</td><td>${value(r.expect)}</td><td>${now(r)}</td></tr>`).join('')}</tbody>`).join('');
  const bad = res.filter(r => !r.pass).length;
  const table = tableRegion({ label: 'Checks', html: `<table class="cl syn-studies syn-checks"><thead><tr><th>Measure</th><th>Kept</th><th>Now</th></tr></thead>${body}</table>` });
  if (!bad && mode !== 'results') return `<section class="syn-sec" id="syn-checks">${disclosure({ id: 'syn-checks-all', title: `Checks: all ${res.length} hold`, body: table })}</section>`;
  return `<section class="syn-sec" id="syn-checks"><h3>${esc(`Checks: ${bad} of ${res.length} no longer hold`)}</h3>${table}</section>`;
}

function openRow(m, cols) {
  const rs = recsOf(m, sel.code, sel.outcomeId);
  if (!rs.length) return '';
  const o = m.outcomes.find(x => x.id === sel.outcomeId), meta = rs.find(r => r.method.startsWith('Meta')), swim = rs.find(r => r.method.startsWith('SWiM')), prop = rs.find(r => r.family === 'Proportions');
  const issues = [...new Set(rs.flatMap(r => r.issues))];
  const figs = [...(meta?.kEst ? [['forest', 'Forest plot']] : []), ...(swim?.rows.length ? [['swim', 'Effect direction']] : []), ...(prop?.subgroups.some(s => s.rows.length) ? [['proportions', 'Proportion forest']] : [])];
  return `<tr class="syn-open"><td colspan="${cols}">${openBody(m, o, meta, swim, prop, figs, issues)}</td></tr>`;
}
/** The details of the selected combination: its verdicts, then its figure (the studies with their numbers), then what to keep in mind; in a matrix row or under a result row. */
function openBody(m, o, meta, swim, prop, figs, issues) {
  return `<div class="syn-open-in">
    ${uiBar({ kind: 'head', label: 'Combination', id: 'syn-open-head', lead: { title: o?.name || '', level: 'h3', id: 'syn-open-title' },
      // the figures are views of one combination: a switch, the shown one pressed (owner, 2026-10-23: "it works as a change of views but it does not look like it")
      ...(figs.length > 1 ? { view: { id: 'syn-fig', label: 'Figure', attr: 'data-fig', value: figs.some(([k]) => k === fig) ? fig : figs[0][0], items: figs } } : {}),
      actions: [{ id: 'syn-keep', label: 'Keep as checks', icon: 'check-square' }, { id: 'syn-close', label: 'Close', icon: 'close' }],
      overflow: [{ id: 'syn-rate', label: 'Rate certainty' }, ...(defOf(m)?.named ? [] : [{ id: 'syn-name', label: 'Name this combination' }]), ...(checksOf(get()).some(c => c.key.startsWith(checkPrefix())) ? [{ id: 'syn-unkeep', label: 'Remove its checks' }] : [])] })}
    <div class="syn-open-grid"><div class="syn-open-main" data-fig-host>${figureHtml(m)}</div>
      <div class="syn-open-side"><div class="syn-verdicts">${meta ? verdictBlock(meta, 'Meta-analysis') + verdictBlock(swim, 'SWiM') : verdictBlock(prop, 'Pooled proportion')}</div>
        ${issues.length ? `<h4 class="syn-side-h">To keep in mind</h4><ul class="syn-issues">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        <div data-legend-host>${legendHtml(m)}</div></div></div></div>`;
}

function figureHtml(m) {
  if (!fig || !sel) return '';
  const oid = fig === 'swim' ? '*' : sel.outcomeId, f = look === 'app' ? screenFigureOf(m, figKind(), oid, sel.code, { width: 560 }) : figureOf(m, figKind(), oid, sel.code);
  const rec = fig === 'forest' ? recsOf(m, sel.code, sel.outcomeId).find(r => r.method.startsWith('Meta')) : null, o = rec ? optionsOf(m, rec) : null;
  const splits = rec ? subgroupChoices(m, rec) : [];
  const filters = [{ type: 'select', id: 'syn-look', label: 'Figure style', options: [['app', 'App style'], ['print', fig === 'forest' ? 'RevMan layout' : 'Publication']], value: look },
    ...(splits.length ? [{ type: 'select', id: 'syn-by', label: 'Subgroups', options: [['', 'No subgroups'], ...splits], value: splits.some(([k]) => k === o.by) ? o.by : '' }] : [])];
  // a forest's own options (lib/forest-options.mjs), kept with the combination so the package and a download draw the same figure
  const opts = rec ? uiBar({ kind: 'tools', label: 'Forest options', id: 'syn-forest-opts', filters: [
    { type: 'select', id: 'syn-pool', label: 'Pool', options: [['yes', 'Pooled'], ['no', 'Not pooled']], value: o.pool ? 'yes' : 'no' },
    // present while there are subgroups, so the row does not change; it has nothing to do until the forest is pooled
    ...(f.subgroups ? [{ type: 'check', id: 'syn-subtotals', label: 'Subtotals', value: o.subtotals, ...(o.pool ? {} : { attrs: { disabled: '' } }) }] : []),
    { type: 'select', id: 'syn-axis', label: 'Axis', options: RATIO_AXES.map(([k, l]) => [k, k ? `Axis ${l}` : 'Axis fitted to the data']), value: o.axis }],
    actions: [{ id: 'syn-cols', label: 'Columns', icon: 'table', menu: true }, { id: 'syn-labels', label: 'Labels', icon: 'rename' }] }) : '';
  const inPart = packagePart();
  if (f.error) return `<div class="syn-figure">${uiBar({ kind: 'head', label: 'Figure', id: 'syn-figure-head', filters })}${opts}<p class="meta">${esc(f.error)}</p></div>`;
  return `<div class="syn-figure">${uiBar({ kind: 'head', label: 'Figure', id: 'syn-figure-head', filters,
      actions: [inPart ? { id: 'syn-open-pkg', label: `In ${inPart.name}`, icon: 'open' } : { id: 'syn-package', label: 'Add to package', icon: 'plus' }, { id: 'syn-download', label: 'Download', icon: 'download', menu: true }] })}${opts}
    <div class="${look === 'app' ? 'chart-svg' : 'syn-svg'}" data-syn-chart>${sanitizeSvg(f.svg)}</div>${look === 'app' && f.het ? `<p class="meta syn-het">${esc(f.het)}</p>` : ''}</div>`;
}
/** The open figure's legend, beside it with the verdicts. */
function legendHtml(m) {
  if (!fig || !sel) return '';
  const f = figureOf(m, figKind(), fig === 'swim' ? '*' : sel.outcomeId, sel.code);
  return f.error || !f.legend ? '' : `<h4 class="syn-side-h">Legend</h4><p class="syn-legend">${esc(f.legend)}</p>`;
}

/** The shown combinations (the set, verdict and outcome filters of the matrix) as one PDF: their table, then each one's figure. */
async function figureSheetPdf() {
  const m = model(); if (!m) return;
  const { documentPdf } = await import('../lib/svg-pdf.mjs'), { figureSheet } = await import('../lib/synth-figures.mjs');
  const named = m.records.some(r => r.named) && fSet === 'named', floor = rank(fVerdict);
  const recs = m.records.filter(r => (!named || r.named) && (!fOutcome || r.outcomeId === fOutcome) && rank(r.verdict) <= floor);
  await saveFile(documentPdf(figureSheet(m, recs), { title: 'Syntheses' }), 'syntheses-figure-sheet.pdf', 'application/pdf');
}

const slugName = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'figure';
async function download(kind, m) {
  const f = figureOf(m, figKind(), fig === 'swim' ? '*' : sel.outcomeId, sel.code);
  if (f.error) return;
  const name = slugName(f.title);
  if (kind === 'svg') await saveFile(f.svg, `${name}.svg`, 'image/svg+xml');
  else if (kind === 'pdf') await saveFile(svgToPdf(f.svg, { title: f.title }), `${name}.pdf`, 'application/pdf');
  else { const r = await rasterSvg(f.svg, { background: 'white', scale: 300 / 96 }); if (r) await saveFile(new Blob([r.bytes], { type: 'image/png' }), `${name}.png`, 'image/png'); }
}
/** The figure as an item of the package, its legend written from the method (nothing is added unless this is clicked). */
const pkgKey = () => `synth:${figKind()}:${fig === 'swim' ? '*' : sel.outcomeId}:${sel.code}`;
/** The part of the package that already holds this figure, or null. */
function packagePart() {
  const pkg = get().package, it = Object.values(pkg?.items || {}).find(x => x.source?.app === pkgKey());
  return it ? pkg.parts.find(p => p.items.includes(it.id)) || null : null;
}
/**
 * The figure as an item of the package (Tables and figures), its legend written from the method; a part named Figures is made when the package has
 * no part for figures yet. The item is drawn again from the project each time the package is built, so it follows the data. Returns the part's name.
 */
async function addToPackage(m) {
  const f = figureOf(m, figKind(), fig === 'swim' ? '*' : sel.outcomeId, sel.code);
  if (f.error) return null;
  const { update } = await import('../store.mjs'), { emptyPackage, addItem, addPart } = await import('../lib/package.mjs');
  let name = null;
  update(s => {
    s.package ||= emptyPackage();
    const part = s.package.parts.find(p => /figure/i.test(p.name)) || addPart(s.package, { name: 'Figures', file: 'Package/Figures v1.docx' });
    addItem(s.package, part.id, { kind: 'figure', source: { app: pkgKey() }, title: f.title, legend: f.legend });
    name = part.name;
    return s;
  });
  return name;
}

// ---- setup: facets and their levels, overlap groups, named combinations ------------------------------------------------------------------
/** A change to the project's synthesis setup; the facets are copied in first where the page was showing those it suggested. */
async function saveCfg(fn, m) {
  const { update } = await import('../store.mjs');
  update(s => {
    const cfg = configOf(s);
    if (!cfg.facets) cfg.facets = m.facets.filter(f => !f.derive).map(f => ({ id: f.id, label: f.label, levels: f.levels.map(l => ({ ...l })), ...(f.rules ? { rules: f.rules } : {}) }));
    fn(cfg);
    s.synthesis = cfg;
    return s;
  });
  again();
}
const slugId = (t, taken) => { const b = String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'level'; let id = b, n = 2; while (taken.includes(id)) id = `${b}_${n++}`; return id; };
const head = (id, title, action) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h3' }, actions: action ? [action] : [] });
const row = (attrs, title, detail, more) => uiRow({ attrs, main: { html: `<span class="syn-def-name">${esc(title)}</span>`, detail, wrap: true }, end: uiRowEnd({ more: { label: `More for ${title}`, attrs: { 'data-def-more': '' } } }) });

/** Facets, overlapping cohorts and named combinations, each a list of plain rows; every change is made from a row's More or its section's Add. */
function renderSetup(el, m) {
  const cfg = configOf(get()), facets = m.facets.filter(f => !f.derive), studies = [...new Map(m.arms.map(a => [a.sid, a.study])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const used = (f, l) => m.arms.filter(a => a.facets[f] === l).length, namedRefs = JSON.stringify(cfg.named || {});
  const overlap = cfg.overlap || [], nameOf = sid => studies.find(([k]) => k === sid)?.[1] || String(sid);
  const named = [...(cfg.named?.comparisons || []), ...(cfg.named?.groupings || [])];
  // composite outcomes: outcomes of the project (derived.kind 'composite'), so Analysis, the manuscript and the package read them too
  const s0 = get(), outs = s0.outcomes || [], comps = outs.filter(o => o.derived?.kind === 'composite'), oname = id => outs.find(o => o.id === id)?.name || id;
  const RULE_WORDS = { max: 'Larger of', sum: 'Sum of', reported: 'Reported composite of' };
  const partsText = o => (o.derived.parts?.length ? `${RULE_WORDS[o.derived.rule || 'max']} ${o.derived.parts.map(oname).join(', ')}` : 'No parts yet');
  el.innerHTML = `<div class="syn-page syn-defs">
    <section class="syn-sec">${head('syn-comp-head', 'Composite outcomes', { id: 'syn-comp-add', label: 'New composite', icon: 'plus' })}
      ${uiList({ label: 'Composite outcomes', id: 'syn-comps', empty: 'No composite outcome', rows: comps.map(o => row({ 'data-comp': o.id }, o.name, [esc(partsText(o)), o.derived.partial === false ? 'A missing part leaves it unreported' : 'Partly reported where a part is missing', ...(o.hidden ? ['Hidden'] : [])])) })}</section>
    <section class="syn-sec">${head('syn-facets-head', 'Facets', { id: 'syn-facet-add', label: 'New facet', icon: 'plus' })}
      ${uiList({ label: 'Facets', id: 'syn-facets', empty: 'No facet', rows: facets.map(f => row({ 'data-facet': f.id }, f.label, f.levels.map(l => `${esc(l.label)} ${used(f.id, l.id)}`))) })}</section>
    <section class="syn-sec">${head('syn-overlap-head', 'Overlapping cohorts', { id: 'syn-group-add', label: 'New group', icon: 'plus' })}
      ${uiList({ label: 'Overlapping cohorts', id: 'syn-overlap', empty: 'No group of overlapping cohorts', rows: overlap.map(g => row({ 'data-group': g.id }, g.id, [esc(g.studies.map(nameOf).join(', ')), esc(`Pooled arm-level: ${g.keep != null ? nameOf(g.keep) : 'the study with most patients'}`)])) })}</section>
    ${named.length ? `<section class="syn-sec">${head('syn-named-head', 'Named combinations')}
      ${uiList({ label: 'Named combinations', id: 'syn-named', rows: named.map(d => row({ 'data-code': d.code }, d.title, [esc(d.code), d.subgroups ? 'Grouping' : 'Comparison'])) })}</section>` : ''}
  </div>`;
  const facetOf = (c, id) => { const f = c.facets.find(x => x.id === id); if (!f.levels?.length) f.levels = m.facets.find(y => y.id === id).levels.map(l => ({ ...l })); return f; };
  const rename = async (title, value, fn) => { const v = await ask(title, { value, confirm: 'Rename' }); if (v?.trim()) saveCfg(c => fn(c, v.trim()), m); };
  // the rule-writing aid: a facet's levels and rules from a column with two to twelve values; arms without a level are then filled from the rules
  const tpl = synthTemplate(s0), columns = (tpl?.columns || []).map(c => ({ id: c.id, label: c.label || c.id, got: levelsFromColumn(m.arms, c.id) })).filter(c => c.got && c.got.levels.length >= 2);
  const fromColumn = async (fid, column) => {
    const { update } = await import('../store.mjs');
    update(s => {
      const c = configOf(s);
      if (!c.facets) c.facets = m.facets.filter(f => !f.derive).map(f => ({ id: f.id, label: f.label, levels: f.levels.map(l => ({ ...l })), ...(f.rules ? { rules: f.rules } : {}) }));
      const f = c.facets.find(x => x.id === fid), got = levelsFromColumn(m.arms, column, f);
      if (!got) return s;
      f.levels = got.levels; f.rules = got.rules; delete f.column;
      s.synthesis = c;
      s.synthesis = { ...c, arms: fillArms(s) };
      return s;
    });
    again();
  };
  // an outcome a composite may take as a part: a count read from the table, or another composite that does not already contain this one
  const contains = (id, target, seen = new Set()) => { const o = outs.find(x => x.id === id); if (!o?.derived?.parts || seen.has(id)) return false; seen.add(id); return o.derived.parts.some(p => p === target || contains(p, target, seen)); };
  const saveState = async fn => { const { update } = await import('../store.mjs'); update(s => { fn(s); return s; }); again(); };
  const compOf = (s, id) => s.outcomes.find(o => o.id === id);
  const inUse = id => outs.some(o => o.derived?.parts?.includes(id)) || namedRefs.includes(`"${id}"`) || JSON.stringify(cfg.checks || []).includes(`.${id}.`) || (s0.analyses && s0.analyses[id]);
  const menus = {
    comp: id => {
      const o = comps.find(x => x.id === id), d = o.derived, can = outs.filter(x => x.id !== id && x.derived && (x.derived.kind !== 'composite' || !contains(x.id, id)) && !(d.parts || []).includes(x.id));
      return [{ label: 'Rename…', run: async () => { const v = await ask('Rename outcome', { value: o.name, confirm: 'Rename' }); if (v?.trim()) saveState(s => { compOf(s, id).name = v.trim(); }); } },
        { label: 'Rule', submenu: [['max', 'Larger count'], ['sum', 'Sum, at most the arm\'s patients'], ['reported', 'Reported composite']].map(([k, l]) => ({ label: l, checked: (d.rule || 'max') === k, run: () => saveState(s => { compOf(s, id).derived.rule = k; }) })) },
        { label: 'A missing part', submenu: [{ label: 'Partly reported', checked: d.partial !== false, run: () => saveState(s => { delete compOf(s, id).derived.partial; }) }, { label: 'Not reported', checked: d.partial === false, run: () => saveState(s => { compOf(s, id).derived.partial = false; }) }] },
        { label: 'Add part', submenu: can.length ? can.map(x => ({ label: x.name, run: () => saveState(s => { const c = compOf(s, id).derived; c.parts = [...(c.parts || []), x.id]; if (!c.subgroup && x.derived.subgroup) c.subgroup = x.derived.subgroup; }) })) : [{ label: 'No outcome to add', disabled: true }] },
        { label: o.hidden ? 'Show' : 'Hide', run: () => saveState(s => { if (o.hidden) delete compOf(s, id).hidden; else compOf(s, id).hidden = true; }) },
        ...((d.parts || []).length ? ['-', { label: 'Remove part', danger: true, submenu: d.parts.map(p => ({ label: oname(p), run: () => saveState(s => { const c = compOf(s, id).derived; c.parts = c.parts.filter(x => x !== p); }) })) }] : []),
        ...(inUse(id) ? [] : [{ label: 'Remove outcome', danger: true, run: () => saveState(s => { s.outcomes = s.outcomes.filter(x => x.id !== id); }) }])];
    },
    facet: id => {
      const f = facets.find(x => x.id === id), spare = f.levels.filter(l => !used(id, l.id) && !namedRefs.includes(`"${l.id}"`));
      return [{ label: 'Rename…', run: () => rename('Rename facet', f.label, (c, v) => { facetOf(c, id).label = v; }) },
        { label: 'Add level…', run: async () => { const v = await ask(`New level of ${f.label}`, { confirm: 'Add' }); if (v?.trim()) saveCfg(c => { const x = facetOf(c, id); x.levels.push({ id: slugId(v, x.levels.map(l => l.id)), label: v.trim() }); }, m); } },
        { label: 'Levels from a column', submenu: columns.length ? columns.map(c => ({ label: c.label, run: () => fromColumn(id, c.id) })) : [{ label: 'No column with two to twelve values', disabled: true }] },
        { label: 'Rename level', submenu: f.levels.map(l => ({ label: l.label, run: () => rename('Rename level', l.label, (c, v) => { facetOf(c, id).levels.find(x => x.id === l.id).label = v; }) })) },
        ...(spare.length ? ['-', { label: 'Remove level', danger: true, submenu: spare.map(l => ({ label: l.label, run: () => saveCfg(c => { const x = facetOf(c, id); x.levels = x.levels.filter(y => y.id !== l.id); }, m) })) }] : [])];
    },
    group: id => {
      const g = overlap.find(x => x.id === id);
      return [{ label: 'Rename…', run: () => rename('Rename group', g.id, (c, v) => { c.overlap.find(x => x.id === id).id = v; }) },
        { label: 'Add study', submenu: studies.filter(([k]) => !g.studies.includes(k)).map(([k, n]) => ({ label: n, run: () => saveCfg(c => { for (const x of c.overlap) x.studies = x.studies.filter(s => s !== k); c.overlap.find(x => x.id === id).studies.push(k); }, m) })) },
        { label: 'Pooled arm-level', submenu: [{ label: 'The study with most patients', checked: g.keep == null, run: () => saveCfg(c => { delete c.overlap.find(x => x.id === id).keep; }, m) },
          ...g.studies.map(k => ({ label: nameOf(k), checked: g.keep === k, run: () => saveCfg(c => { c.overlap.find(x => x.id === id).keep = k; }, m) }))] },
        '-', { label: 'Remove study', danger: true, submenu: g.studies.map(k => ({ label: nameOf(k), run: () => saveCfg(c => { const x = c.overlap.find(y => y.id === id); x.studies = x.studies.filter(s => s !== k); if (x.keep === k) delete x.keep; c.overlap = c.overlap.filter(y => y.studies.length); }, m) })) },
        { label: 'Remove group', danger: true, run: () => saveCfg(c => { c.overlap = c.overlap.filter(x => x.id !== id); }, m) }];
    },
    code: code => {
      const d = named.find(x => x.code === code);
      return [{ label: 'Rename…', run: () => rename('Rename combination', d.title, (c, v) => { for (const x of [...(c.named?.comparisons || []), ...(c.named?.groupings || [])]) if (x.code === code) x.title = v; }) },
        '-', { label: 'Remove', danger: true, run: () => saveCfg(c => { c.named = { ...c.named, comparisons: (c.named.comparisons || []).filter(x => x.code !== code), groupings: (c.named.groupings || []).filter(x => x.code !== code) }; }, m) }];
    },
  };
  el.querySelectorAll('[data-def-more]').forEach(b => b.onclick = () => {
    const r = b.closest('[data-comp],[data-facet],[data-group],[data-code]'), [kind, id] = r.dataset.comp ? ['comp', r.dataset.comp] : r.dataset.facet ? ['facet', r.dataset.facet] : r.dataset.group ? ['group', r.dataset.group] : ['code', r.dataset.code];
    showMenu(b, menus[kind](id), { align: 'end', minWidth: 180 });
  });
  el.querySelector('#syn-comp-add').onclick = async () => {
    const v = await ask('New composite outcome', { confirm: 'Add' });
    if (!v?.trim()) return;
    saveState(s => { const taken = new Set(s.outcomes.map(o => o.id)); let n = 2; while (taken.has(`o${n}`)) n++; s.outcomes.push({ id: `o${n}`, name: v.trim(), named: true, measure: 'PR', derived: { kind: 'composite', rule: 'max', parts: [], unit: 'arm' } }); });
  };
  el.querySelector('#syn-facet-add').onclick = async () => { const v = await ask('New facet', { confirm: 'Add' }); if (v?.trim()) saveCfg(c => { c.facets.push({ id: slugId(v, c.facets.map(f => f.id)), label: v.trim(), levels: [] }); }, m); };
  el.querySelector('#syn-group-add').onclick = async () => { const v = await ask('New group of overlapping cohorts', { confirm: 'Add' }); if (v?.trim()) saveCfg(c => { c.overlap = [...(c.overlap || []), { id: v.trim(), studies: [] }]; }, m); };
}

// ---- the page ----------------------------------------------------------------------------------------------------------------------------
const fuField = a => `<input class="ui-cell-field" data-f="fu" type="text" inputmode="decimal" value="${a.fu ?? ''}" aria-label="Follow-up, ${esc(a.study)}">`;

/** The arms with their stored role, levels and follow-up, each editable; a change is stored at once and the matrix reads it. */
function renderArms(el, ctx, m) {
  const facets = m.facets.filter(f => !f.derive), arms = [...m.arms].sort((a, b) => a.study.localeCompare(b.study) || a.role.localeCompare(b.role));
  const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${k === (v ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const groups = (configOf(get()).overlap || []).map(g => `${g.id}: ${[...new Set(m.arms.filter(a => g.studies.includes(a.sid)).map(a => a.study))].join(', ')}`);
  const sel = (a, f, list, v, label) => `<select class="ui-cell-field" data-f="${esc(f)}" aria-label="${esc(`${label}, ${a.study}`)}">${opt(list, v)}</select>`;
  const row = a => `<tr data-key="${esc(a.key)}"><th scope="row">${esc(a.study)}</th><td>${a.label && a.label !== a.study ? esc(a.label) : ''}</td><td>${sel(a, 'role', [['I', 'Intervention'], ['C', 'Comparator']], a.role, 'Role')}</td>${
    facets.map(f => `<td>${sel(a, f.id, [['', 'Not set'], ...f.levels.map(l => [l.id, l.label])], a.facets[f.id], f.label)}</td>`).join('')}<td>${fuField(a)}</td></tr>`;
  el.innerHTML = `<div class="syn-page"><div class="note" id="syn-note" role="status"></div>${groups.length ? `<div class="syn-key">Overlap ${esc(groups.join('; '))}</div>` : ''}
    ${tableRegion({ label: 'Arms', sticky: true, html: `<table class="cl syn-arms"><thead><tr><th scope="col">Study</th><th scope="col">Arm</th><th scope="col">Role</th>${facets.map(f => `<th scope="col">${esc(f.label)}</th>`).join('')}<th scope="col">Follow-up, months</th></tr></thead><tbody>${arms.map(row).join('')}</tbody></table>` })}</div>`;
  el.querySelectorAll('[data-key] [data-f]').forEach(x => x.addEventListener('change', async () => {
    const key = x.closest('[data-key]').dataset.key, f = x.dataset.f, { update } = await import('../store.mjs');
    update(s => {
      const cfg = configOf(s), arm = { facets: {}, ...(cfg.arms[key] || {}) };
      if (f === 'role') arm.role = x.value;
      else if (f === 'fu') { const n = Number(String(x.value).replace(',', '.')); if (x.value === '') delete arm.fu; else if (Number.isFinite(n)) arm.fu = n; }
      else { arm.facets = { ...arm.facets }; if (x.value) arm.facets[f] = x.value; else delete arm.facets[f]; }
      s.synthesis = { ...cfg, arms: { ...cfg.arms, [key]: arm } };
      return s;
    });
  }));
}

// ---- results: only what can be used ----------------------------------------------------------------------------------------------------
const USEFUL = ['Usable', 'Usable with caveat'], PROBABLY = ['Usable, descriptive', 'Exploratory only'];
/** One entry per combination and outcome whose better verdict is useful or probably useful, best first: { code, outcomeId, title, outcome, verdict, parts }. */
function resultsOf(m) {
  const named = m.records.some(r => r.named) && fSet === 'named', by = new Map();
  for (const r of m.records) {
    if ((named && !r.named) || (fOutcome && r.outcomeId !== fOutcome)) continue;
    const k = `${r.code}|${r.outcomeId}`;
    if (!by.has(k)) by.set(k, { code: r.code, outcomeId: r.outcomeId, title: r.grouping, outcome: r.outcome, recs: [] });
    by.get(k).recs.push(r);
  }
  const short = r => (r.method.startsWith('SWiM') ? `SWiM ${r.result.replace('favor the intervention; sign test', 'favor the intervention,')}` : r.result);
  return [...by.values()].map(x => {
    const best = x.recs.reduce((a, r) => (rank(r.verdict) < rank(a.verdict) ? r : a));
    return { ...x, verdict: best.verdict, k: Math.max(...x.recs.map(r => r.kEst ?? r.kBoth ?? 0)), parts: x.recs.filter(r => r.result && r.verdict !== 'Not usable').map(short) };
  }).filter(x => USEFUL.includes(x.verdict) || PROBABLY.includes(x.verdict)).sort((a, b) => rank(a.verdict) - rank(b.verdict) || b.k - a.k);
}
// ---- the results table: grouped by outcome, a small plot beside each one's numbers --------------------------------------------------------
const PLOT_W = 220;   // px: the small plots and their axis
const ROW = 19.5;   // px: one line of a result cell (13 px at line height 1.5) and one row of its plot
const RR_LO = Math.log(0.02), RR_HI = Math.log(50);
/** A risk ratio and its interval on a log axis (0.02 to 50) with the line of no effect; an interval past the axis ends in an arrow. */
function rrPlot(p, w = PLOT_W) {
  const X = v => Math.max(2, Math.min(w - 2, 2 + (w - 4) * (Math.log(v) - RR_LO) / (RR_HI - RR_LO))), y = ROW / 2, x1 = X(1);
  const lo = X(p.lo), hi = X(p.hi), est = X(p.rr), cut = v => (Math.log(v) < RR_LO || Math.log(v) > RR_HI);
  return `<svg class="syn-mini" width="${w}" height="${ROW}" viewBox="0 0 ${w} ${ROW}" aria-hidden="true"><line class="syn-mini-null" x1="${x1}" y1="0" x2="${x1}" y2="${ROW}"/>
    <line class="syn-mini-ci" x1="${lo}" y1="${y}" x2="${hi}" y2="${y}"/>${cut(p.lo) ? `<path class="syn-mini-pt" d="M${lo} ${y}l5 -3v6z"/>` : ''}${cut(p.hi) ? `<path class="syn-mini-pt" d="M${hi} ${y}l-5 -3v6z"/>` : ''}
    <path class="syn-mini-pt" d="M${est} ${y - 5}l5 5l-5 5l-5 -5z"/></svg>`;
}
/** Each subgroup's pooled proportion and interval on a shared 0 to `max` percent axis, one row each. */
function propPlot(subs, max, w = PLOT_W) {
  const X = v => 2 + (w - 4) * Math.min(v, max) / max, h = ROW * subs.length;
  return `<svg class="syn-mini" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line class="syn-mini-null" x1="2" y1="0" x2="2" y2="${h}"/>${subs.map((s, i) => {
    const y = ROW * i + ROW / 2;
    const past = s.pool && s.pool.hi > max;   // an interval past the axis ends in an arrow
    return s.pool ? `<line class="syn-mini-ci" x1="${X(s.pool.lo)}" y1="${y}" x2="${X(s.pool.hi)}" y2="${y}"/>${past ? `<path class="syn-mini-pt" d="M${w - 2} ${y}l-5 -3v6z"/>` : ''}<circle class="syn-mini-pt" cx="${X(s.pool.p)}" cy="${y}" r="4"/>` : '';
  }).join('')}</svg>`;
}
/** Effect direction: a filled triangle up for each study that favors the intervention, a hollow one down for each that does not. */
function dirPlot(fav, unf) {
  const all = [...Array(fav).fill('up'), ...Array(unf).fill('down')], w = Math.max(20, all.length * 14);
  return `<svg class="syn-mini" width="${w}" height="${ROW}" viewBox="0 0 ${w} ${ROW}" aria-hidden="true">${all.map((d, i) => { const cx = 7 + i * 14;
    return d === 'up' ? `<path class="syn-mini-pt" d="M${cx} 5l5 9h-10z"/>` : `<path class="syn-mini-hollow" d="M${cx} 15l5 -9h-10z"/>`; }).join('')}</svg>`;
}
const pickButton = x => `<button type="button" class="syn-res-pick" data-code="${esc(x.code)}" data-oid="${esc(x.outcomeId)}" aria-expanded="false"><span>${esc(x.title)}</span></button>`;
// the verdict in words, shortened where the column is narrow; its tone is the verdict mark's
const VERDICT_WORD = { Usable: 'Usable', 'Usable with caveat': 'With caveat', 'Usable, descriptive': 'Descriptive', 'Exploratory only': 'Exploratory', 'Text only': 'Text only', 'Not usable': 'Not usable' };
const verdictCell = v => `<span class="syn-verdict-cell">${mark(v)}<span class="syn-vword" title="${esc(v)}">${esc(VERDICT_WORD[v])}</span></span>`;
const two = n => n.toFixed(2), one = n => n.toFixed(1);
function resultRow(x, max) {
  const meta = x.recs.find(r => r.method.startsWith('Meta')), swim = x.recs.find(r => r.method.startsWith('SWiM')), prop = x.recs.find(r => r.family === 'Proportions');
  let plot = '', lines = [], k = '';
  if (meta?.pool && meta.verdict !== 'Not usable') {
    const p = meta.pool;
    plot = rrPlot(p); k = `${p.k} studies`;
    lines = [`<strong>RR ${two(p.rr)}</strong> (${two(p.lo)} to ${two(p.hi)})`, `<span class="meta">I² ${p.I2.toFixed(0)}%${swim?.fav + swim?.unf ? `, ${swim.fav} of ${swim.fav + swim.unf} favor` : ''}</span>`];
  } else if (swim && swim.fav + swim.unf) {
    plot = dirPlot(swim.fav, swim.unf); k = `${swim.fav + swim.unf} studies`;
    lines = [`<strong>${swim.fav} of ${swim.fav + swim.unf}</strong> favor the intervention`, `<span class="meta">Sign test P = ${swim.signP.toFixed(2)}</span>`];
  } else if (prop) {
    const subs = prop.subgroups.filter(s => s.pool || s.kRep);
    plot = propPlot(subs, max); k = `${subs.reduce((n, s) => n + s.kRep, 0)} arms`;
    lines = subs.map(s => `${subs.length > 1 ? `${esc(s.name)} ` : ''}${s.pool ? `<strong>${one(s.pool.p)}%</strong> (${one(s.pool.lo)} to ${one(s.pool.hi)})` : `${s.kRep} arm${s.kRep === 1 ? '' : 's'}`}`);
    if (prop.subgroupTest) lines.push(`<span class="meta">Difference P = ${prop.subgroupTest.p < 0.001 ? '< 0.001' : prop.subgroupTest.p.toFixed(3)}</span>`);
  }
  return `<tr data-result="${esc(`${x.code}|${x.outcomeId}`)}"><td class="syn-res-title">${pickButton(x)}</td><td class="syn-res-plot">${plot}</td>
    <td class="syn-res-num">${lines.map(l => `<div>${l}</div>`).join('')}</td><td>${verdictCell(x.verdict)}</td><td class="syn-res-k">${k}</td></tr>`;
}
/** The axis over a column of small plots: risk ratio (log) or percent, with its tick labels, drawn at the plots' own scale. */
function axisHead(kind, max, w = PLOT_W) {
  const ticks = kind === 'rr' ? [[0.1, '0.1'], [1, '1'], [10, '10']].map(([v, l]) => [2 + (w - 4) * (Math.log(v) - RR_LO) / (RR_HI - RR_LO), l]) : [[0, '0'], [max / 2, `${max / 2}`], [max, `${max}%`]].map(([v, l]) => [2 + (w - 4) * v / max, l]);
  // a risk ratio's head: the null value centred over its line, which runs down into the plots; each side's words in two lines beside the line,
  // so they never meet in a 220 px column (Component review 2026-10-21, item 18)
  const x1 = 2 + (w - 4) * (0 - RR_LO) / (RR_HI - RR_LO);
  const h = kind === 'rr' ? 46 : 16, sides = kind === 'rr' ? `<line class="syn-mini-null" x1="${x1}" y1="16" x2="${x1}" y2="${h}"/>`
    + `<text x="${x1 - 6}" y="29" text-anchor="end">Favors</text><text x="${x1 - 6}" y="42" text-anchor="end">intervention</text>`
    + `<text x="${x1 + 6}" y="29">Favors</text><text x="${x1 + 6}" y="42">comparator</text>` : '';
  return `<svg class="syn-mini syn-axis" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${kind === 'rr' ? 'Risk ratio, log scale' : `Proportion, 0 to ${max}%`}">${ticks.map(([x, l], i) =>
    `<text x="${x}" y="12" text-anchor="${i === 0 && kind !== 'rr' ? 'start' : i === ticks.length - 1 && kind !== 'rr' ? 'end' : 'middle'}">${l}</text>`).join('')}${sides}</svg>`;
}
function resultsTable(m, list, kind, max) {
  if (!list.length) return '';
  const body = m.outcomes.filter(o => list.some(x => x.outcomeId === o.id)).map(o => `<tr class="syn-res-group"><th colspan="5" scope="colgroup">${esc(o.name)}</th></tr>${list.filter(x => x.outcomeId === o.id).map(x => resultRow(x, max)).join('')}`).join('');
  const title = kind === 'rr' ? 'Comparisons' : 'Proportions';
  return `<section class="syn-sec"><h3>${title}</h3>${tableRegion({ label: title, html: `<table class="cl syn-results"><thead><tr><th scope="col" class="syn-c-title">${kind === 'rr' ? 'Comparison' : 'Arms'}</th>
    <th scope="col" class="syn-c-plot">${axisHead(kind, max)}</th><th scope="col">${kind === 'rr' ? 'Risk ratio (95% CI)' : 'Pooled proportion (95% CI)'}</th><th scope="col" class="syn-c-v">Verdict</th><th scope="col" class="syn-c-k">Data</th></tr></thead><tbody>${body}</tbody></table>` })}</section>`;
}
/**
 * What the shown results come to, one line per outcome above the tables: the comparisons whose 95% CI excludes 1 (the best-supported one in full,
 * by studies then interval width), how many do not, and the pooled proportion of the largest grouping. Counts and estimates only, no adjectives.
 */
const rrPct = n => `${Math.round(Math.abs(1 - n) * 100)}%`;
// "1 of 4 significant (95% CI excludes 1)": the count first, then what significant means here (owner, 2026-10-23: "language is weird")
const sigCount = (n, of) => `${n} of ${of} significant (95% CI excludes 1)`;
const rrText = p => `RR ${two(p.rr)} (${two(p.lo)} to ${two(p.hi)}), ${rrPct(p.rr)} ${p.rr < 1 ? 'lower' : 'higher'} risk, ${p.k} studies, I² ${p.I2.toFixed(0)}%`;
export function summaryLines(m, list) {
  const out = [];
  for (const o of m.outcomes) {
    const mine = list.filter(x => x.outcomeId === o.id); if (!mine.length) continue;
    const pooled = mine.map(x => ({ x, p: x.recs.find(r => r.method.startsWith('Meta') && r.pool && r.verdict !== 'Not usable')?.pool })).filter(e => e.p);
    const sig = pooled.filter(e => e.p.hi < 1 || e.p.lo > 1).sort((a, b) => b.p.k - a.p.k || (Math.log(a.p.hi / a.p.lo) - Math.log(b.p.hi / b.p.lo)));
    const lines = [];
    if (sig.length) {
      const [top, ...rest] = sig;
      lines.push(`<strong>${esc(top.x.title)}</strong>: ${esc(rrText(top.p))}`);
      lines.push(`<span class="meta">${sigCount(sig.length, pooled.length)}${rest.length && rest.every(e => (e.p.rr < 1) === (top.p.rr < 1)) ? ', all in the same direction' : ''}</span>`);
    } else if (pooled.length) {
      const best = pooled.sort((a, b) => b.p.k - a.p.k)[0];
      lines.push(`<strong>${esc(best.x.title)}</strong>: ${esc(rrText(best.p))}`, `<span class="meta">${sigCount(0, pooled.length)}</span>`);
    } else {
      const swim = mine.map(x => x.recs.find(r => r.method.startsWith('SWiM') && r.fav + r.unf)).find(Boolean);
      if (swim) lines.push(`${swim.fav} of ${swim.fav + swim.unf} studies favor the intervention <span class="meta">(sign test P = ${swim.signP.toFixed(2)})</span>`);
    }
    const props = mine.map(x => ({ x, r: x.recs.find(r => r.family === 'Proportions') })).filter(e => e.r?.subgroups?.some(sg => sg.pool));
    if (props.length) {
      const { x, r } = props.sort((a, b) => b.r.subgroups.reduce((n, sg) => n + sg.kRep, 0) - a.r.subgroups.reduce((n, sg) => n + sg.kRep, 0))[0];
      const subs = r.subgroups.filter(sg => sg.pool);
      lines.push(`${esc(x.title)}: ${subs.map(sg => `${subs.length > 1 ? `${esc(sg.name)} ` : ''}<strong>${one(sg.pool.p)}%</strong> (${one(sg.pool.lo)} to ${one(sg.pool.hi)})`).join(', ')}${r.subgroupTest && r.subgroupTest.p < 0.05 ? ` <span class="meta">(difference P = ${r.subgroupTest.p < 0.001 ? '< 0.001' : r.subgroupTest.p.toFixed(3)})</span>` : ''}`);
    }
    if (lines.length) out.push({ outcome: o.name, lines });
  }
  return out;
}
function resultsHtml(m) {
  const list = resultsOf(m).filter(x => fUse === 'probably' || USEFUL.includes(x.verdict));
  if (!list.length) return emptyState({ icon: 'matrix', title: fUse === 'probably' ? 'Nothing useful or probably useful' : 'Nothing useful' });
  const props = list.filter(x => x.recs.some(r => r.family === 'Proportions')), cmps = list.filter(x => !props.includes(x));
  // one percent axis for every proportion shown: three times the median estimate (an outlier does not crowd the rest) and at least the largest
  // estimate, rounded up to 10, 20, 30, 50 or 100; a longer interval ends in an arrow
  const ps = props.flatMap(x => x.recs.filter(r => r.family === 'Proportions').flatMap(r => r.subgroups.map(s => s.pool?.p).filter(v => v != null))).sort((a, b) => a - b);
  const top = Math.max(1, 3 * (ps[Math.floor(ps.length / 2)] || 0), ps.at(-1) || 0);
  const max = [10, 20, 30, 50, 100].find(v => v >= top) || 100;
  // no summary box above the tables: it said again what their rows say (owner, 2026-10-24: duplicates across the pages)
  return resultsTable(m, cmps, 'rr', max) + resultsTable(m, props, 'prop', max);
}
// ---- New combination: two sides of the same studies compared, or the proportions of a set of arms, with a live preview ----------------------
const checks = (group, f, chosen, label) => `<div class="field ui-field syn-pick-group" role="group" aria-label="${esc(`${label}: ${f.label}`)}"><span>${esc(f.label)}</span><div class="an-checks">${f.levels.map(l =>
  `<label class="cr-check"><input type="checkbox" data-b-group="${group}" data-b-facet="${esc(f.id)}" value="${esc(l.id)}"${(chosen[f.id] || []).includes(l.id) ? ' checked' : ''}><span>${esc(l.label)}</span></label>`).join('')}</div></div>`;
// a group of proportions: how the chosen arms are split and which arms count
const splitSelect = (facets, b) => `<select data-b-split><option value="">No split</option>${facets.map(f => `<option value="${esc(f.id)}"${b.split === f.id ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>`;
const roleSelect = b => `<select data-b-role>${[['I', 'Intervention arms'], ['C', 'Comparator arms'], ['', 'All arms']].map(([k, l]) => `<option value="${k}"${b.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
const splitSide = (facets, b) => `<div class="syn-b-side an-settings"${formFit([1, 1])}>${formField('Split into groups by', splitSelect(facets, b))}${formField('Which arms', roleSelect(b))}</div>`;
function builderHtml(m) {
  const facets = m.facets.filter(f => !f.derive), b = build, side = (group, title, map) => `<div class="syn-b-side"><h4>${esc(title)}</h4>${facets.map(f => checks(group, f, map, title)).join('')}</div>`;
  const got = customDefinition(b, m.arms, m.facets);
  const outs = m.outcomes.map(o => `<label class="cr-check"><input type="checkbox" data-b-out value="${esc(o.id)}"${b.outcomes.includes(o.id) ? ' checked' : ''}><span>${esc(o.name)}</span></label>`).join('');
  let preview = `<p class="meta">${esc(got.error || '')}</p>`;
  if (!got.error) {
    const recs = evaluateAll({ arms: m.arms, outcomes: m.outcomes.filter(o => b.outcomes.includes(o.id)), comparisons: got.def.subgroups ? [] : [got.def], groupings: got.def.subgroups ? [got.def] : [], settings: m.settings });
    const names = [...new Set(m.arms.filter(a => got.studies.includes(a.sid)).map(a => a.study))];
    preview = `<p><strong>${esc(got.def.title)}</strong></p><p class="meta">${got.studies.length} ${got.studies.length === 1 ? 'study' : 'studies'}: ${esc(names.join(', '))}</p>
      ${recs.length ? `<table class="cl syn-studies"><tbody>${recs.map(r => `<tr><td>${esc(r.outcome)}</td><td>${esc(r.method.split(' (')[0])}</td><td>${esc(r.result || 'Nothing to pool')}</td><td>${verdictCell(r.verdict)}</td></tr>`).join('')}</tbody></table>` : '<p class="meta">Choose an outcome</p>'}`;
  }
  return `<section class="syn-sec syn-builder" id="syn-builder">
    ${uiBar({ kind: 'head', label: 'New combination', id: 'syn-b-head', lead: { title: 'New combination', level: 'h3' },
      view: { id: 'syn-b-kind', label: 'Kind', attr: 'data-b-kind', value: b.kind, items: [['comparison', 'Two arms compared'], ['proportions', 'Proportions of arms']] },
      actions: [{ id: 'syn-b-save', label: 'Save combination', role: 'primary' }, { id: 'syn-b-cancel', label: 'Cancel' }] })}
    <div class="syn-b-body">${b.kind === 'comparison' ? side('a', 'Intervention arms', b.a) + side('b', 'Comparator arms', b.b)
      : `<div class="syn-b-side"><h4>Arms</h4>${facets.map(f => checks('w', f, b.where, 'Arms')).join('')}</div>${splitSide(facets, b)}`}
      <div class="syn-b-side syn-b-wide"><h4>Outcomes</h4><div class="an-checks">${outs}</div><h4>Result</h4>${preview}</div></div></section>`;
}
function wireBuilder(el, m, redraw) {
  const host = el.querySelector('#syn-builder'); if (!host) return;
  const again2 = () => { host.outerHTML = builderHtml(m); wireBuilder(el, m, redraw); };
  host.querySelectorAll('[data-b-kind]').forEach(x => x.onclick = () => { build.kind = x.dataset.bKind; again2(); });
  host.querySelectorAll('[data-b-group]').forEach(x => x.onchange = () => {
    const map = build[{ a: 'a', b: 'b', w: 'where' }[x.dataset.bGroup]], f = x.dataset.bFacet;
    map[f] = x.checked ? [...new Set([...(map[f] || []), x.value])] : (map[f] || []).filter(v => v !== x.value);
    again2();
  });
  host.querySelectorAll('[data-b-out]').forEach(x => x.onchange = () => { build.outcomes = x.checked ? [...build.outcomes, x.value] : build.outcomes.filter(v => v !== x.value); again2(); });
  const sp = host.querySelector('[data-b-split]'); if (sp) sp.onchange = () => { build.split = sp.value; again2(); };
  const ro = host.querySelector('[data-b-role]'); if (ro) ro.onchange = () => { build.role = ro.value; again2(); };
  host.querySelector('#syn-b-cancel').onclick = () => { build = null; redraw(); };
  host.querySelector('#syn-b-save').onclick = async () => {
    const got = customDefinition(build, m.arms, m.facets);
    if (got.error || !build.outcomes.length) return;
    const title = await ask('Name the combination', { value: got.def.title, confirm: 'Save' });
    if (!title?.trim()) return;
    const { update } = await import('../store.mjs');
    update(s => {
      const cfg = configOf(s), named = { comparisons: [], groupings: [], outcomes: [], ...(cfg.named || {}) }, all = [...named.comparisons, ...named.groupings].map(x => x.code);
      let n = all.length + 1; while (all.includes(`N${n}`)) n++;
      const def = { ...got.def, code: `N${n}`, title: title.trim(), outcomes: [...build.outcomes] };
      if (def.subgroups) named.groupings = [...named.groupings, def]; else named.comparisons = [...named.comparisons, def];
      s.synthesis = { ...cfg, named };
      return s;
    });
    build = null; fSet = 'named'; redraw();
  };
}

/**
 * What is weak or missing, under the results: a table by outcome (the studies that report it as a bar, arms with a partly reported composite,
 * the best verdict and why it is not better), then the data problems, each under its label.
 */
function findingsHtml(m) {
  const shown = m.records.some(r => r.named) && fSet === 'named' ? m.records.filter(r => r.named) : m.records;
  const overlapKeep = Object.fromEntries((configOf(get()).overlap || []).filter(g => g.keep != null).map(g => [g.id, g.keep]));
  const w = weakSummary({ arms: m.arms, outcomes: m.outcomes, records: shown, facets: m.facets, overlapKeep }, m.settings);
  const bar = (n, of) => `<svg class="syn-mini syn-meter" width="80" height="8" viewBox="0 0 80 8" aria-hidden="true"><rect class="syn-meter-bg" width="80" height="8" rx="2"/><rect class="syn-meter-fg" width="${(80 * n) / Math.max(1, of)}" height="8" rx="2"/></svg>`;
  // each count opens the studies behind it (lib/figure-drill.mjs, under the table); the best result opens that result (owner, 2026-10-24: "why not interactive")
  const drill = (ids, label, html) => (ids.length ? `<button type="button" class="syn-drill" data-studies="${esc(ids.join(' '))}" data-drill-label="${esc(label)}">${html}</button>` : html);
  const rows = w.outcomes.map(o => `<tr><th scope="row">${esc(o.name)}</th><td>${drill(o.reportingIds, `Reporting ${o.name.replace(/^(?![A-Z]{2})./, c => c.toLowerCase())}`, `<span class="syn-cover">${bar(o.reporting, o.total)}<span>${o.reporting} of ${o.total}</span></span>`)}</td>
    <td class="num">${o.partial ? drill(o.partialIds, `Partly reporting ${o.name.replace(/^(?![A-Z]{2})./, c => c.toLowerCase())}`, String(o.partial)) : ''}</td><td>${o.best ? (o.bestCode ? `<button type="button" class="syn-pick syn-best" data-code="${esc(o.bestCode)}" data-oid="${esc(o.id)}" aria-pressed="false">${mark(o.best)}<span>${esc(o.best)}</span></button>` : `<span class="syn-best">${mark(o.best)}<span>${esc(o.best)}</span></span>`) : '<span class="meta">Not evaluated</span>'}</td><td class="meta">${esc(o.why)}</td></tr>`).join('');
  return `<section class="syn-sec"><h3>Weak or missing</h3>
    ${tableRegion({ label: 'Outcomes', html: `<table class="cl syn-weak"><thead><tr><th scope="col">Outcome</th><th scope="col">Studies reporting</th><th scope="col" class="num">Partly reported arms</th><th scope="col">Best result</th><th scope="col">Why not better</th></tr></thead><tbody>${rows}</tbody></table>` })}
    ${w.issues.length ? `<dl class="props syn-data">${w.issues.map(i => `<dt>${esc(i.label)}</dt><dd>${esc(i.text)}</dd>`).join('')}</dl>` : ''}</section>`;
}

export function render(el, ctx) {
  again = () => ctx.rerender();
  const m = model();
  if (m && mode === 'arms') { renderArms(el, ctx, m); return; }
  if (m && mode === 'setup') { renderSetup(el, m); return; }
  if (!m) { el.innerHTML = emptyState({ icon: 'matrix', title: 'No arms to compare' }); return; }
  const shown = m.records.some(r => r.named) && fSet === 'named' ? m.records.filter(r => r.named) : m.records;
  const key = VERDICTS.map(v => `<span class="syn-count">${mark(v)}<span>${esc(v)}</span><span class="syn-n">${shown.filter(r => r.verdict === v).length}</span></span>`).join('');
  // the outcomes the shown set evaluates (the review's combinations are on four)
  const shownOutcomes = m.outcomes.filter(o => shown.some(r => r.outcomeId === o.id));
  const results = mode === 'results', cmp = results ? [] : rowsOf(m, m.comparisons, ['Meta', 'SWiM']), grp = results ? [] : rowsOf(m, m.groupings, ['Pooled']);
  const draw = () => {
    // a check that no longer holds is shown first on Results; Matrix lists them all at the end
    const checks = checksHtml();
    return `<div class="syn-page">
      ${uiBar({ kind: 'tools', label: 'Filters', id: 'syn-tools',
        // the outcome and what to show are one click each; which combinations is a choice made once
        view: [...(results ? [{ id: 'syn-use', label: 'Show', attr: 'data-syn-use', value: fUse, items: [['useful', 'Useful only'], ['probably', 'Include probably useful']] }] : [])],
        actions: [{ id: 'syn-new', label: 'New combination', icon: 'plus' }],
        filters: [{ type: 'select', id: 'syn-oc', label: 'Outcome', options: [['all', 'All outcomes'], ...shownOutcomes.map(o => [o.id, o.name])], value: fOutcome || 'all' },
        ...(m.comparisons.some(d => d.named) || m.groupings.some(d => d.named) ? [{ type: 'select', id: 'syn-set', label: 'Combinations', options: [['named', 'Combinations in the review'], ['all', 'All combinations']], value: fSet }] : []),
        ...(results ? [] : [{ type: 'select', id: 'syn-verdict', label: 'Verdict', options: VERDICTS.map(v => [v, v === 'Not usable' ? 'All verdicts' : `${v} or better`]), value: fVerdict }])] })}
      <div class="note" id="syn-note" role="status"></div>
      ${results ? '' : `<div class="syn-key">${key}</div>`}
      ${build ? builderHtml(m) : ''}
      ${results ? checks : ''}
      ${results ? resultsHtml(m) : `<section class="syn-sec">${cmp.length ? tableHtml(m, cmp, { label: 'Comparison', methods: ['Meta', 'SWiM'] }) : '<p class="meta">No comparison</p>'}</section>
      <section class="syn-sec">${grp.length ? tableHtml(m, grp, { label: 'Grouping', methods: ['Pooled'] }) : '<p class="meta">No grouping</p>'}</section>${checks}`}
      ${findingsHtml(m)}</div>`;
  };
  el.innerHTML = draw();
  const redraw = again = () => ctx.rerender();
  el.querySelector('#syn-new')?.addEventListener('click', () => { build ||= { kind: 'comparison', a: {}, b: {}, where: {}, split: '', role: 'I', outcomes: m.outcomes.slice(0, 1).map(o => o.id) }; redraw(); });
  wireBuilder(el, m, redraw);
  el.querySelectorAll('[data-syn-use]').forEach(b => b.onclick = () => { fUse = b.dataset.synUse; redraw(); });
  el.querySelector('#syn-oc')?.addEventListener('change', e => { fOutcome = e.target.value === 'all' ? '' : e.target.value; redraw(); });
  const vSel = el.querySelector('#syn-verdict'); if (vSel) vSel.onchange = e => { fVerdict = e.target.value; redraw(); };
  const set = el.querySelector('#syn-set'); if (set) set.onchange = e => { fSet = e.target.value; redraw(); };
  // a click changes the open row in place: the rows above it do not move, and the page keeps its scroll
  const wireOpen = () => {
    el.querySelector('#syn-close')?.addEventListener('click', () => { sel = null; fig = null; setOpen(); });
    const keep = async drop => {
      const { update } = await import('../store.mjs'), p = checkPrefix(), now = checksNow(get(), sel.code, sel.outcomeId);
      update(s => { s.synthesis = { ...configOf(s), checks: drop ? checksOf(s).filter(c => !c.key.startsWith(p)) : withChecks(s, now) }; return s; });
      redraw();
    };
    el.querySelector('#syn-keep')?.addEventListener('click', () => keep(false));
    // a GRADE row for this combination and outcome, its numbers from the record; the judgements are made on Certainty
    el.querySelector('#syn-rate')?.addEventListener('click', async () => {
      const rs = recsOf(m, sel.code, sel.outcomeId), meta = rs.find(r => r.method.startsWith('Meta')), prop = rs.find(r => r.family === 'Proportions'), r = meta || prop;
      if (!r) return;
      const { update } = await import('../store.mjs'), { blankOutcome } = await import('../lib/grade.mjs'), key = `${sel.code}|${sel.outcomeId}`;
      const one = prop?.subgroups.length === 1 ? prop.subgroups[0].pool : null;
      const effect = meta?.pool ? `RR ${meta.pool.rr.toFixed(2)} (${meta.pool.lo.toFixed(2)} to ${meta.pool.hi.toFixed(2)})` : one ? `Proportion ${one.p.toFixed(1)}% (${one.lo.toFixed(1)}% to ${one.hi.toFixed(1)}%)` : '';
      update(s => {
        s.grade ||= [];
        if (!s.grade.some(g => g.synth === key)) s.grade.push({ ...blankOutcome(`${r.outcome}: ${r.grouping.replace(/^./, c => c.toLowerCase())}`), synth: key, analysisOutcome: 'none',
          studies: String(meta ? meta.kEst : (prop?.subgroups[0]?.pool?.k ?? '')), participants: String(r.patients || ''), effect, comment: `${r.method}; ${r.verdict}`,
          ...(meta?.events ? { events: { intervention: meta.events.split(' vs ')[0], comparator: meta.events.split(' vs ')[1] } } : {}) });
        return s;
      });
      ctx.go('certainty');
    });
    // an automatic combination kept under a title of its own: it stays when the facets change, and Setup lists it
    el.querySelector('#syn-name')?.addEventListener('click', async () => {
      const d = defOf(m); if (!d) return;
      const title = await ask('Name this combination', { value: d.title, confirm: 'Save' });
      if (!title?.trim()) return;
      const { update } = await import('../store.mjs');
      update(s => {
        const cfg = configOf(s), named = { comparisons: [], groupings: [], outcomes: [], ...(cfg.named || {}) }, all = [...named.comparisons, ...named.groupings].map(x => x.code);
        let n = all.length + 1; while (all.includes(`N${n}`)) n++;
        const { auto, named: _n, ...rest } = d; void auto; void _n;
        const kept = { ...rest, code: `N${n}`, title: title.trim() };
        if (d.subgroups) named.groupings = [...named.groupings, kept]; else named.comparisons = [...named.comparisons, kept];
        s.synthesis = { ...cfg, named };
        return s;
      });
      sel = null; fig = null; redraw();
    });
    el.querySelector('#syn-unkeep')?.addEventListener('click', () => keep(true));
    el.querySelectorAll('[data-fig]').forEach(b => b.onclick = () => { fig = b.dataset.fig; el.querySelectorAll('[data-fig]').forEach(x => { const on = x === b; x.setAttribute('aria-pressed', String(on)); x.classList.toggle('on', on); }); const host = el.querySelector('[data-fig-host]'); if (host) { host.innerHTML = figureHtml(m); const lg = el.querySelector('[data-legend-host]'); if (lg) lg.innerHTML = legendHtml(m); wireFig(); } });
    wireFig();
  };
  const wireFig = () => {
    // a study named in the figure opens its row of the evidence table (its data), as a study named anywhere else does
    const host = el.querySelector('[data-fig-host]');
    if (host && sel) {
      const studies = new Map(recsOf(m, sel.code, sel.outcomeId).flatMap(r => [...(r.rows || []), ...(r.subgroups || []).flatMap(s => s.rows)]).filter(x => x?.sid && x.study).map(x => [x.study, x.sid]));
      host.querySelectorAll('svg text').forEach(tx => {
        const name = tx.textContent.trim().replace(/, comparator$/, ''), sid = studies.get(name);
        if (!sid) return;
        tx.classList.add('syn-study-link'); tx.setAttribute('role', 'link'); tx.setAttribute('tabindex', '0'); tx.setAttribute('aria-label', `${name}: open its data`);
        const go = () => ctx.openStudyResults?.('extraction', sid);
        tx.addEventListener('click', go); tx.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      });
    }
    el.querySelector('#syn-look')?.addEventListener('change', e => { look = e.target.value; const host = el.querySelector('[data-fig-host]'); if (host) { host.innerHTML = figureHtml(m); const lg = el.querySelector('[data-legend-host]'); if (lg) lg.innerHTML = legendHtml(m); wireFig(); } });
    const refig = () => { const host = el.querySelector('[data-fig-host]'); if (host) { host.innerHTML = figureHtml(m); const lg = el.querySelector('[data-legend-host]'); if (lg) lg.innerHTML = legendHtml(m); wireFig(); } };
    // a forest's option is stored with its combination and outcome (s.synthesis.forests); the figure is drawn again in place
    const setOpt = async patch => {
      const key = forestKey(sel.code, sel.outcomeId), next = storedOptions({ ...forestOptions(m.forests?.[key]), ...patch });
      m.forests = { ...(m.forests || {}), [key]: next };
      const { update } = await import('../store.mjs');
      update(s => { const forests = { ...(s.synthesis?.forests || {}), [key]: next }; if (!Object.keys(next).length) delete forests[key]; s.synthesis = { ...(s.synthesis || {}), forests }; return s; });
      refig();
    };
    el.querySelector('#syn-by')?.addEventListener('change', e => setOpt({ by: e.target.value }));
    el.querySelector('#syn-pool')?.addEventListener('change', e => setOpt({ pool: e.target.value === 'yes' }));
    el.querySelector('#syn-axis')?.addEventListener('change', e => setOpt({ axis: e.target.value }));
    el.querySelector('#syn-subtotals')?.addEventListener('change', e => setOpt({ subtotals: e.target.checked }));
    const cols = el.querySelector('#syn-cols');
    if (cols) cols.onclick = () => { const o = forestOptions(m.forests?.[forestKey(sel.code, sel.outcomeId)]);
      showMenu(cols, [{ label: 'Events in each arm', checked: o.events, run: () => setOpt({ events: !o.events }) }, { label: 'Follow-up', checked: o.fu, run: () => setOpt({ fu: !o.fu }) }], { align: 'end', minWidth: 180 }); };
    // the labels under the axis name the arms; a pair set here is kept with the forest, the arms' own names when they are put back
    el.querySelector('#syn-labels')?.addEventListener('click', async () => {
      const rec = recsOf(m, sel.code, sel.outcomeId).find(r => r.method.startsWith('Meta')); if (!rec) return;
      const own = favoursOf(...sidesOf(m, rec)), cur = favoursOf(...sidesOf(m, rec), forestOptions(m.forests?.[forestKey(sel.code, sel.outcomeId)]));
      const field = (name, label, v) => formField(label, `<input name="${name}" type="text" value="${esc(v)}" autocomplete="off" spellcheck="false">`);
      const v = await formDialog({ id: 'syn-labels-dialog', title: 'Labels under the axis', body: `<div class="an-settings"${formFit([1, 1])}>${field('left', 'Left of the null line', cur[0])}${field('right', 'Right of the null line', cur[1])}</div>`, start: { id: 'reset', label: 'Arms\u2019 names' } });
      if (!v) return;
      const pair = v.act === 'reset' ? own : [String(v.left || '').trim(), String(v.right || '').trim()];
      setOpt({ favours: JSON.stringify(pair) === JSON.stringify(own) ? null : pair });
    });
    // the screen forest fills the width its box has
    const box = host?.querySelector('[data-syn-chart].chart-svg');
    if (box && sel && fig === 'forest') {
      const fitBox = () => { const w = Math.round(box.clientWidth); if (!w || box.dataset.w === String(w)) return; box.dataset.w = String(w); const g = screenFigureOf(m, figKind(), sel.outcomeId, sel.code, { width: w }); if (!g.error) box.innerHTML = sanitizeSvg(g.svg); };
      fitBox(); watchWidth(box, fitBox);
    }
    el.querySelector('#syn-package')?.addEventListener('click', async () => { if (await addToPackage(m)) refig(); });
    el.querySelector('#syn-open-pkg')?.addEventListener('click', () => ctx.go('outputs'));
    const dl = el.querySelector('#syn-download');
    if (dl) dl.onclick = () => showMenu(dl, [{ label: 'SVG', icon: 'download', run: () => download('svg', m) }, { label: 'PDF', icon: 'download', run: () => download('pdf', m) }, { label: 'PNG, 300 dpi', icon: 'image', run: () => download('png', m) }], { align: 'end', minWidth: 160 });
  };
  const setOpen = () => {
    el.querySelectorAll('tr.syn-open, .syn-open-li').forEach(r => r.remove());
    el.querySelectorAll('.syn-res-pick').forEach(b => b.setAttribute('aria-expanded', String(!!sel && b.dataset.code === sel.code && b.dataset.oid === sel.outcomeId)));
    if (results) {
      if (!sel) return;
      const row = el.querySelector(`tr[data-result="${CSS.escape(`${sel.code}|${sel.outcomeId}`)}"]`); if (!row) return;
      row.insertAdjacentHTML('afterend', openRow(m, 5));
      wireOpen();
      return;
    }
    el.querySelectorAll('.syn-pick').forEach(b => b.setAttribute('aria-pressed', String(!!sel && b.dataset.code === sel.code && b.dataset.oid === sel.outcomeId)));
    if (!sel) return;
    const row = el.querySelector(`tr[data-row="${CSS.escape(sel.code)}"]`); if (!row) return;
    row.insertAdjacentHTML('afterend', openRow(m, row.children.length));
    wireOpen();
  };
  // the open combination: its words beside the figure while the pane holds both, under it when it does not (measured, never a breakpoint)
  el.querySelectorAll('.syn-open-grid').forEach(g => fitSplit(g, 760));
  el.querySelectorAll('tr[data-result]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('button, a, input, select')) tr.querySelector('.syn-res-pick')?.click(); }));
  // Weak or missing: a count lists its studies under the table, each opening its details
  const weak = el.querySelector('.syn-weak');
  if (weak) import('../lib/figure-drill.mjs').then(({ wireDrill }) => wireDrill(weak.parentElement, { id: 'syn-weak-drill',
    open: id => document.dispatchEvent(new CustomEvent('lykos:open-study', { detail: { id } })),
    library: id => document.dispatchEvent(new CustomEvent('lykos:show-in-library', { detail: { id } })) }));
  el.querySelectorAll('.syn-pick, .syn-res-pick').forEach(b => b.onclick = () => {
    const same = sel && sel.code === b.dataset.code && sel.outcomeId === b.dataset.oid;
    sel = same ? null : { code: b.dataset.code, outcomeId: b.dataset.oid }; fig = sel ? firstFigure(m) : null; setOpen();
  });
  wireOpen();
}
