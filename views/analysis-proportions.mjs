// A pooled proportion whose counts are read from an evidence table's text,
// one row per study arm (plan §I, pooled proportions amendment 2026-09-28).
// The analysis view hands an outcome with `derived` inputs to this module:
// its document (the arms and their counts, Run, the result, the forest plot,
// the subgroups and what could not be read) and its inspector sections.
import { saveAnalysis } from '../lib/i2-q.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { formField, pagedTable, uiLink } from '../lib/ui-components.mjs';
import { studyCell } from '../lib/bib.mjs';
import { wireStudies, openStudy } from '../lib/study.mjs';
import { runR } from '../lib/r.mjs';
import { analysisRunGuard } from '../lib/analysis-run-guard.mjs';
import { figurePanel, showFigure, downloadCsv, compactSvg } from '../lib/figure.mjs';
import { mountForest, mountFunnel, hasFunnel, forestData } from '../lib/forest-page.mjs';
import { funnelInputs } from '../lib/diagnostics.mjs';
import { withFigure, hasFigure, figureMissing } from '../lib/figures.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { pooledInputs, pooledInputStatus } from '../lib/analysis-inputs.mjs';
import { outcomeById, analysisOf } from '../lib/outcomes.mjs';
import { handlesProportion, poolProportion } from '../lib/meta-pool.mjs';
import { proportionScript } from '../lib/pooled-r.mjs';
import { derivedUnits, subgroupLevel } from '../lib/derived-counts.mjs';
import { itemsIn } from '../lib/count-text.mjs';
import { FT_WARNING, settingsOf, methodsUsed, heterogeneityRows } from '../lib/heterogeneity.mjs';

const PAGE = 25;
const TRANSFORMS = [['PLO', 'Logit (default)'], ['PFT', 'Freeman–Tukey double arcsine']];
const ESTIMATORS = [['REML', 'Random effects (REML)'], ['DL', 'Random effects (DerSimonian–Laird)'], ['EE', 'Common effect']];
const choice = {};   // per outcome: { method, moderator, page, skipped }
let choiceGeneration = -1;
const pick = oid => {
  if (choiceGeneration !== projectGeneration()) { for (const key of Object.keys(choice)) delete choice[key]; choiceGeneration = projectGeneration(); }
  return choice[oid] ||= { method: null, moderator: null, page: 1, skipped: 1, transform: null };
};
const derivedOf = oid => outcomeById(get(), oid)?.derived || null;
const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
const pct = (x, d = 1) => (Number.isFinite(Number(x)) && x != null ? `${(Number(x) * 100).toFixed(d)}%` : '—');
const ci = (e, lo, hi) => `${pct(e)} (${pct(lo)} to ${pct(hi)})`;
const f = (x, d = 2) => Number(x).toFixed(d);
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const pval = p => (p == null || !Number.isFinite(Number(p)) ? '—' : Number(p) < 0.001 ? '<0.001' : Number(p).toFixed(3));

/** The transformation: the person's choice, else the last result's, else logit. */
export const transform = oid => pick(oid).transform ?? (analysisOf(get(), oid)?.measure === 'PFT' ? 'PFT' : 'PLO');
export const method = oid => pick(oid).method ?? analysisOf(get(), oid)?.method ?? 'REML';
/** The subgroup column in use: the last result's choice, else the outcome's own subgroup. */
export const moderator = oid => { const c = pick(oid).moderator, a = analysisOf(get(), oid); return c ?? (a ? a.moderator || '' : derivedOf(oid)?.subgroup?.column || ''); };
const columnLabel = (s, d, id) => (s.templates || []).find(t => t.id === d?.template)?.columns.find(c => c.id === id)?.label || id;
const dependenceText = (d, m) => (d === 'multilevel' ? 'Multilevel: study and arm' : d === 'one arm per study' ? 'One arm per study'
  : d === 'independent' ? (m === 'EE' ? 'Arms independent (common effect)' : 'Arms treated as independent') : d || '—');

/** The list's line for a derived outcome. */
export function listLine(s, o) {
  const pin = pooledInputs(s, '', 'PR', o.id), a = analysisOf(s, o.id);
  const of = pin.ready.length + pin.incomplete.length + pin.invalid.length;
  return { sub: `Proportion: ${pin.ready.length} of ${of} arms`, mark: a ? `${pct(a.estimate)} [${pct(a.lo)}, ${pct(a.hi)}]` : 'Not run' };
}

/** The arms counted beside the studies they come from, in the 24 characters the title bar's status holds. */
const countLine = inputs => {
  const total = inputs.ready.length + inputs.invalid.length + inputs.incomplete.length, counted = `${inputs.ready.length} of ${total} arms counted`;
  const full = `${counted}, ${inputs.studies} ${inputs.studies === 1 ? 'study' : 'studies'}`;
  return full.length <= 24 ? full : counted;
};
const inputCsv = (s, oid, inputs) => {
  const paper = id => (s.papers || []).find(p => p.id === id) || { id };
  downloadCsv([['Study', 'Arm', 'Source cell', 'Text', 'Status', 'Events', 'N', 'Reason', 'Subgroup text', 'Subgroup'],
    ...inputs.units.map(u => [paper(u.paperId).label || u.paperId, u.arm || '', u.key, u.text, u.status, u.events ?? '', u.n ?? '', u.reason, u.subgroupRaw, u.subgroup ?? ''])],
    `${outcomeById(s, oid).name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-input.csv`);
};
// Run is the title bar's: the page drawn last binds what it runs.
const acts = {};

/** A pooled proportion's part of the title bar (views/analysis.mjs page()): Run, the arms counted beside the title, the input download in More. */
export function proportionPage(oid, title) {
  const s = get(), inputs = pooledInputs(s, moderator(oid), 'PR', oid);
  return { title,
    actions: [{ id: 'run', label: 'Run', icon: 'run', role: 'primary', disabled: inputs.ready.length < 2, run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'csv', label: 'Download inputs', run: () => inputCsv(get(), oid, pooledInputs(get(), moderator(oid), 'PR', oid)) }] };
}

export function render(el, ctx, oid) {
  const s = get(), d = derivedOf(oid), a = analysisOf(s, oid), mod = moderator(oid);
  const inputs = pooledInputs(s, mod, 'PR', oid);
  const { ready, incomplete, invalid } = inputs;
  const status0 = pooledInputStatus(s, a, oid);
  const c = pick(oid);
  const skipped = [...invalid, ...incomplete];
  const paper = id => (s.papers || []).find(p => p.id === id) || { id };

  // A study's arms sit together: the study named on its first arm's row, a dotted rule between its arms (as Extraction parts them), each arm
  // by its own name; a page holds whole studies
  const readyTable = () => {
    const studies = [];
    for (const u of ready) { const last = studies[studies.length - 1]; if (last && last[0].paperId === u.paperId) last.push(u); else studies.push([u]); }
    const shown = pageOf(studies, c.page, PAGE);
    const armOf = u => { if (!u.arm) return ''; const own = String(paper(u.paperId)?.label || u.paperId); return u.label.startsWith(own) ? u.label.slice(own.length).replace(/^(?: · |, )/, '') : u.label.slice(u.label.indexOf(' · ') + 3); };   // lint-allow-dot: reads labels saved before 2026-10-20
    const rows = arms => arms.map((u, r) => `<tr${arms.length > 1 ? ` class="arm-row${r === 0 ? ' arm-first' : ''}${r === arms.length - 1 ? ' arm-last' : ''}"` : ''}><td class="grow">${r === 0
      ? studyCell(paper(u.paperId), { open: true, titleLine: false }) : ''}</td><td>${esc(armOf(u))}</td><td>${u.events}</td><td>${u.n}</td>${mod ? `<td>${esc(u.subgroup || '—')}</td>` : ''}</tr>`).join('');
    return ready.length ? pagedTable({ label: 'Study arms', html: `<table class="arm-grid"><thead><tr><th class="grow">Study</th><th>Arm</th><th>Events</th><th>N</th>${mod ? '<th>Subgroup</th>' : ''}</tr></thead>
        <tbody>${shown.items.map(rows).join('')}</tbody></table>`,
      pager: pager({ id: 'pp-arms', page: shown.page, pages: shown.pages, total: studies.length, label: 'studies', size: PAGE }) }) : '';
  };
  const skippedTable = () => {
    const shownSkipped = pageOf(skipped, c.skipped, PAGE);
    return pagedTable({ label: 'Arms not pooled', html: `<table><thead><tr><th>Study arm</th><th class="grow">Text</th><th>Reason</th></tr></thead>
        <tbody>${shownSkipped.items.map(u => `<tr><td>${uiLink({ label: u.label, title: 'Open its cell in Extraction', attrs: { 'data-pp-cell': u.key } })}</td><td class="grow">${esc(u.text || '—')}</td><td>${esc(u.status === 'missing' ? `Not reported, ${u.reason}` : cap(u.reason))}</td></tr>`).join('')}</tbody></table>`,
      pager: pager({ id: 'pp-skipped', page: shownSkipped.page, pages: shownSkipped.pages, total: skipped.length, label: 'arms', size: PAGE }) });
  };

  el.innerHTML = `<div class="panel">
    <div class="panel-body tight" id="pp-ready-table">
      ${readyTable()}
    </div></div>
    <div class="panel" id="out"${a ? '' : ' hidden'}>
      ${uiBar({ kind: 'head', label: 'Result', id: 'an-result-head', lead: { title: 'Result' }, message: { id: 'rmeta', text: a ? `${a.method}, ${a.k} arms, ${a.studies} studies` : '' } })}
      <div class="panel-body">${status0 === 'stale' ? '<div class="note">Inputs changed, run again</div>' : ''}<div id="summary"></div></div>
    </div>
    <div id="forestHost"${a ? '' : ' hidden'}>${figurePanel({ title: 'Forest plot', id: 'forest', zoom: !(a && forestData(a)) })}</div>
    <div class="panel" id="modHost" hidden>
      <div class="panel-head"><h2>Subgroups</h2><span class="meta"></span></div>
      <div class="panel-body tight"></div>
    </div>
    <div id="funnelHost" hidden>${figurePanel({ title: 'Funnel plot', id: 'funnel', zoom: !(a && funnelInputs(a)) })}</div>
    ${skipped.length ? `<div class="panel">
      <div class="panel-head"><h2>Not pooled</h2><span class="meta">${invalid.length} unreadable, ${incomplete.length} not reported</span></div>
      <div class="panel-body tight" id="pp-skipped-table">${skippedTable()}</div></div>` : ''}`;

  wireStudies(el, ctx);
  // a row that was not pooled opens its source cell in Extraction, where the text is corrected (lib/derived-counts.mjs: key = paper:column[@arm])
  const wireCells = host => host.querySelectorAll('[data-pp-cell]').forEach(b => b.onclick = async () => {
    const k = b.dataset.ppCell, i = k.indexOf(':');
    if ((await import('./extraction.mjs')).focusCell(k.slice(0, i), k.slice(i + 1))) ctx.go('extraction');
  });
  wireCells(el);
  const wireTable = (hostId, pagerId, key, html) => {
    const host = el.querySelector(`#${hostId}`); if (!host) return;
    wirePager(host, pagerId, p => {
      c[key] = p;
      const top = host.getBoundingClientRect().top;
      host.innerHTML = html();
      wireStudies(host, ctx); wireCells(host); wireTable(hostId, pagerId, key, html);
      host.querySelector(`#${pagerId} button:not(:disabled)`)?.focus({ preventScroll: true });
      const scroller = el.closest('.view') || el;
      scroller.scrollTop += host.getBoundingClientRect().top - top;
    });
  };
  wireTable('pp-ready-table', 'pp-arms', 'page', readyTable);
  wireTable('pp-skipped-table', 'pp-skipped', 'skipped', skippedTable);
  acts.run = async btn => {
    const now = pooledInputs(get(), mod, 'PR', oid);
    if (now.snapshot !== inputs.snapshot) { ctx.rerender(); return; }
    btn.disabled = true;
    const order = [...new Set((d.subgroup?.levels || []).map(([, l]) => String(l)))];
    const rows = ready.map(u => ({ label: u.label, study: u.paperId, events: u.events, n: u.n, level: u.subgroup }));
    const m = method(oid);
    const guard = analysisRunGuard(get, state => pooledInputs(state, mod, 'PR', oid).snapshot, projectGeneration);
    const frozenName = outcomeById(get(), oid).name, frozenModerator = mod ? columnLabel(get(), d, mod) : '';
    const resultHost = el.querySelector('#out'), summaryHost = el.querySelector('#summary');
    const say = t => { if (summaryHost) summaryHost.textContent = t; if (resultHost) resultHost.hidden = false; };
    try {
      const tr = transform(oid);
      const measure = tr === 'PFT' ? 'PFT' : 'PR';
      const resultOf = res => ({ ...res, measure, method: m, derived: true, settings: settingsOf({ method: m, test: 'z', pi: 'follow', measure }), labels: rows.map(r => r.label),
        units: ready.map(u => u.id), sources: ready.map(u => u.key), levels: rows.map(r => (r.level == null ? null : String(r.level))),
        zeroEvents: tr === 'PFT' ? '' : '0.5 added to events and non-events of arms with 0 or all events (escalc add = 1/2, to = "only0")',
        moderator: mod, moderatorLabel: frozenModerator, inputSnapshot: inputs.snapshot,
        outcomeId: oid, outcomeName: frozenName, at: new Date().toISOString() });
      const viaR = async onProgress => {
        const { code } = proportionScript({ rows, method: m, subgroups: !!mod, order, transform: tr });
        const res = await runR(['metafor', 'svglite'], code, onProgress);
        for (const k of ['svg', 'funnel']) if (res[k]) res[k] = compactSvg(res[k]);
        return res;
      };
      // At once where the JavaScript pool gives metafor's numbers (lib/meta-pool.mjs: REML, DL or EE, the multilevel model, subgroups; checked
      // against native metafor), R behind it: R's result takes its place with its figures and records how far the two differed (jsCheck).
      const js = handlesProportion({ method: m, transform: tr }, rows) ? poolProportion(rows, { method: m, subgroups: !!mod, order, transform: tr }) : null;
      if (js) {
        update(st => saveAnalysis(st, oid, { ...resultOf(js), engine: 'js', checking: true }));
        ctx.refreshCounts?.();
        if (btn.isConnected !== false) ctx.rerender();
        viaR(() => {}).then(res => {
          if (guard.reason()) return;
          const rel = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / Math.max(Math.abs(y), 1e-12) : 0);
          const jsCheck = Math.max(...['estimate', 'lo', 'hi', 'tau2', 'i2', 'q', 'qp'].map(k => rel(js[k], res[k])));
          update(st => saveAnalysis(st, oid, { ...resultOf(res), engine: 'r', jsCheck }));
          ctx.refreshCounts?.();
          if (el.isConnected) ctx.rerender();
        }).catch(() => update(st => { const was = analysisOf(st, oid); if (was?.checking) saveAnalysis(st, oid, { ...was, checking: false }); return st; }));
        return;
      }
      const res = await viaR(say);
      const discarded = guard.reason();
      if (discarded) { if (guard.belongs()) say(discarded); btn.disabled = false; return; }
      update(st => saveAnalysis(st, oid, resultOf(res)));
      ctx.refreshCounts?.();
      if (btn.isConnected !== false) ctx.rerender();
    } catch (err) { say(String(err.message || err).slice(0, 160)); btn.disabled = false; }
  };
  if (a) show(el, ctx, a, ready);
}

function show(el, ctx, a, ready) {
  el.querySelector('#out').hidden = false;
  el.querySelector('#rmeta').textContent = `${a.method}, ${a.k} arms, ${a.studies} studies`;
  el.querySelector('#summary').innerHTML = `<table><tbody>
    <tr><th>Pooled proportion</th><td>${ci(a.estimate, a.lo, a.hi)}</td></tr>
    ${a.pi_lo != null ? `<tr><th>95% prediction interval</th><td>${pct(a.pi_lo)} to ${pct(a.pi_hi)}</td></tr>` : ''}
    ${heterogeneityRows(a).map(([l, t]) => `<tr><th>${l}</th><td>${esc(t)}</td></tr>`).join('')}
    <tr><th>Q</th><td>${f(a.q)} (p ${pval(a.qp)})</td></tr>
    <tr><th>Arms of one study</th><td>${esc(dependenceText(a.dependence, a.method))}</td></tr>${a.convergence ? `
    <tr><th>Estimation</th><td>${esc(a.convergence)}</td></tr>` : ''}
    ${methodsUsed(a).map(([l, t]) => `<tr><th>${esc(l)}</th><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
    ${a.measure === 'PFT' ? `<div class="note spaced" data-ui-help>${FT_WARNING}</div>` : ''}`;
  el.querySelector('#forestHost').hidden = false;
  const units = vec(a.units);
  const byUnit = new Map(ready.map(u => [u.id, u.paperId]));
  // Paged from the result's own numbers; the R figure (kept by hash) is the download, and the drawing for a result made before those numbers were kept.
  const opts = { study: i => byUnit.get(units[i]) || null, open: pid => openStudy(ctx, pid), labels: a.labels, whole: hasFigure(a, 'svg') ? () => new Promise(res => withFigure(a, 'svg', res, () => res(null))) : null };
  if (!mountForest(el, 'forest', a, opts)) withFigure(a, 'svg', svg => showFigure(el, 'forest', svg, 'forest-plot', opts), () => figureMissing(el, 'forest'));
  const fh = el.querySelector('#funnelHost'); fh.hidden = !hasFunnel(a); if (!fh.hidden) mountFunnel(el, 'funnel', a, { study: opts.study, open: opts.open });
  const mh = el.querySelector('#modHost');
  mh.hidden = a.mod_kind !== 'group';
  if (a.mod_kind !== 'group') return;
  const lv = vec(a.mod_levels), k = vec(a.mod_k), st = vec(a.mod_studies), est = vec(a.mod_est), lo = vec(a.mod_lo), hi = vec(a.mod_hi), i2 = vec(a.mod_i2);
  mh.querySelector('h2').textContent = `Subgroups by ${a.moderatorLabel}`;
  mh.querySelector('.meta').textContent = `Test for subgroup differences: Q = ${f(a.qm)}, df = ${a.qm_df}, p = ${pval(a.qmp)}${a.mod_unassigned ? `; ${a.mod_unassigned} ${a.mod_unassigned === 1 ? 'arm' : 'arms'} in no subgroup` : ''}`;
  mh.querySelector('.panel-body').innerHTML = `<table><thead><tr><th class="grow">Subgroup</th><th>Arms</th><th>Studies</th><th>Proportion (95% CI)</th><th>I²</th></tr></thead>
    <tbody>${lv.map((l, i) => `<tr><td class="grow">${esc(l)}</td><td>${k[i]}</td><td>${st[i]}</td><td>${ci(est[i], lo[i], hi[i])}</td><td>${f(i2[i], 1)}%</td></tr>`).join('')}</tbody></table>`;
}

// ---- inspector ----------------------------------------------------------------

const sel = (attr, label, options, cur) => `<label class="field"><span>${label}</span><select ${attr} aria-label="${esc(label)}">
  ${options.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

/** Sets part of an outcome's derived-input rule; the inputs and any saved result follow. */
function setDerived(oid, patch) {
  update(st => { st.outcomes = (st.outcomes || []).map(o => (o.id === oid ? { ...o, measure: 'PR', derived: { ...o.derived, ...patch } } : o)); return st; });
}

const RULES = [['max', 'Larger count'], ['sum', 'Sum, at most the arm\'s patients'], ['reported', 'Reported composite']];
/** The inputs of a composite outcome: its parts, the rule that joins them, and how many arms have it only in part. */
function compositeInputs(s, oid, d, units, ctx) {
  const names = d.parts.map(id => (s.outcomes || []).find(o => o.id === id)?.name || id), partial = units.filter(u => u.partial).length;
  return { title: 'Inputs', html: `<div class="an-settings">${sel('data-dc="rule"', 'Rule', RULES, d.rule || 'max')}</div>
      <dl class="props"><dt>Parts</dt><dd>${esc(names.join(', '))}</dd><dt>Partly reported</dt><dd>${partial ? `${partial} ${partial === 1 ? 'arm' : 'arms'}` : 'None'}</dd></dl>`,
    wire: el => el.querySelectorAll('[data-dc]').forEach(x => x.onchange = e => { setDerived(oid, { rule: e.target.value }); ctx?.rerender(); }) };
}

/** Inspector sections for a derived outcome: model, inputs, subgroup levels, heterogeneity. */
export function inspect(ctx, oid) {
  const s = get(), d = derivedOf(oid), a = analysisOf(s, oid);
  const tpl = (s.templates || []).find(t => t.id === d.template);
  const cols = (tpl?.columns || []).map(c => [c.id, c.label]);
  const units = derivedUnits(s, d);
  const items = itemsIn(units.map(u => u.text));
  const subCol = d.subgroup?.column || '';
  const raws = [...new Set(derivedUnits(s, { ...d, items: [] }).map(u => u.subgroupRaw).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const secs = [{ title: 'Model', html: `<div class="an-settings">
      ${sel('data-dm="method"', 'Model', ESTIMATORS, method(oid))}
      ${sel('data-dm="transform"', 'Transformation', TRANSFORMS, transform(oid))}
      ${sel('data-dm="moderator"', 'Subgroup', [['', 'No subgroup'], ...(subCol ? [[subCol, columnLabel(s, d, subCol)]] : [])], moderator(oid))}</div>
      ${transform(oid) === 'PFT' ? `<div class="note spaced" data-ui-help>${FT_WARNING}</div>` : ''}
      <dl class="props"><dt>Measure</dt><dd>${transform(oid) === 'PFT' ? 'Proportion, double arcsine scale' : 'Proportion, logit scale'}</dd>
      <dt>Zero events</dt><dd>${transform(oid) === 'PFT' ? 'No correction' : '0.5 added at 0 or all events'}</dd>
      <dt>Arms of one study</dt><dd>${method(oid) === 'DL' ? 'Treated as independent' : method(oid) === 'EE' ? 'Independent under a common effect' : 'Multilevel: study and arm'}</dd></dl>`,
    wire: el => el.querySelectorAll('[data-dm]').forEach(x => x.onchange = e => { pick(oid)[x.dataset.dm] = e.target.value; ctx?.rerender(); }) },
  d.kind === 'composite' ? compositeInputs(s, oid, d, units, ctx) : { title: 'Inputs', html: `<div class="an-settings">
      ${sel('data-dd="template"', 'Table', (s.templates || []).map(t => [t.id, t.name || t.id]), d.template)}
      ${sel('data-dd="column"', 'Column', cols, d.column)}
      ${sel('data-dd="items"', 'Item', [...(items.some(i => i.key === (d.items || [])[0]) ? [] : [[(d.items || [])[0] || '', (d.items || [])[0] || 'None']]), ...items.map(i => [i.key, `${cap(i.name)} (${i.count})`])], (d.items || [])[0] || '')}
      ${sel('data-dd="nColumn"', 'Arm size', [['', 'None'], ...cols], d.nColumn || '')}
      ${sel('data-dd="subgroup"', 'Subgroup column', [['', 'None'], ...cols], subCol)}</div>
      <dl class="props"><dt>Unit</dt><dd>${d.unit === 'study' ? 'Study' : 'Study arm'}</dd>
      <dt>Percentages</dt><dd>${d.fromPercent ? 'Counted when the arm size fits exactly one count' : 'Not turned into counts'}</dd></dl>`,
    wire: el => el.querySelectorAll('[data-dd]').forEach(x => x.onchange = e => {
      const v = e.target.value, k = x.dataset.dd;
      if (k === 'items') setDerived(oid, { items: v ? [v] : [] });
      else if (k === 'subgroup') setDerived(oid, { subgroup: v ? { column: v, levels: [] } : null });
      else if (k === 'template') setDerived(oid, { template: v, column: '', items: [], nColumn: '', subgroup: null });
      else setDerived(oid, { [k]: v });
      ctx?.rerender();
    }) }];
  const levelFields = raws.map((r, i) => formField(r, `<input data-lv="${i}" value="${esc(subgroupLevel(d.subgroup, r) ?? '')}" aria-label="${esc(`Subgroup of ${r}`)}">`)).join('');
  if (subCol && raws.length) secs.push({ title: 'Subgroup levels', meta: String(raws.length), html: `<div class="an-settings">${levelFields}</div>`,
    wire: el => el.querySelectorAll('[data-lv]').forEach(x => x.onchange = () => {
      // every text gets an entry, so the map is complete and an empty level means "no subgroup"
      const levels = raws.map((r, i) => [r, String(el.querySelector(`[data-lv="${i}"]`).value || '').trim()]).filter(([, l]) => l);
      setDerived(oid, { subgroup: { column: subCol, levels: levels.length ? levels : [] } });
      ctx?.rerender();
    }) });
  if (a) secs.push({ title: 'Heterogeneity', meta: `${a.k} arms`, html: `<dl class="props">
      ${heterogeneityRows(a).map(([l, t]) => `<dt>${l}</dt><dd>${esc(t)}</dd>`).join('')}
      ${vec(a.sigma2).length === 2 ? `<dt>Between studies</dt><dd>σ² ${f(vec(a.sigma2)[0], 4)}</dd><dt>Within studies</dt><dd>σ² ${f(vec(a.sigma2)[1], 4)}</dd>` : ''}
      <dt>Q</dt><dd>${f(a.q)} (p ${pval(a.qp)})</dd>
      <dt>Model</dt><dd>${esc(dependenceText(a.dependence, a.method))}${a.optimizer ? ` (${esc(a.optimizer)})` : ''}</dd>${a.convergence ? `<dt>Estimation</dt><dd>${esc(a.convergence)}</dd>` : ''}
      ${a.egger_z != null ? `<dt>Egger's test</dt><dd>z = ${f(a.egger_z)}, p = ${pval(a.egger_p)}${a.k < 10 ? '; k < 10' : ''}</dd>` : ''}</dl>` });
  return secs;
}

/** Makes an outcome read its counts from a table's text: the first table, text column and item found. */
export function startDerived(st, oid) {
  const tpl = (st.templates || [])[0];
  if (!tpl) return st;
  st.outcomes = (st.outcomes || []).map(o => (o.id === oid ? { ...o, measure: 'PR', derived: { kind: 'text-counts', template: tpl.id, column: '', items: [], unit: 'arm', nColumn: '', fromPercent: false, subgroup: null } } : o));
  return st;
}
/** Back to numeric extraction fields. */
export function stopDerived(st, oid) {
  st.outcomes = (st.outcomes || []).map(o => { if (o.id !== oid) return o; const { derived, ...rest } = o; return rest; });
  return st;
}
