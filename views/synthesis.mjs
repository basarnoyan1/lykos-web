// Synthesis for a qualitative evidence synthesis: thematic synthesis after
// Thomas & Harden (lib/qes.mjs). It takes the place of Analysis in that
// review's navigation.
//
// Three stages, one shown at a time: codes on quoted findings, descriptive
// themes that group codes, analytical themes that interpret descriptive themes.
// The page's head is the title bar (page()): the stage switch, its count and
// Add quote. Rows are chosen with a checkbox; choosing swaps the list's tools
// row for a selection bar (Group, Merge, Clear, and Delete in More) in the same
// place, so nothing moves. A row's name expands it in place to show its members and
// quotes; every row has one More. The sources x themes matrix follows.
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { readQes, addQuote, deleteQuote, ensureCode, rename, merge, remove, addTheme, setMembers, setStatement,
  sourcesOf, quotesUnder, ungrouped, themeMatrix, matrixRows, matrixSvg, labelOf } from '../lib/qes.mjs';
import { assessmentOf } from '../lib/cerqual.mjs';
import { studies, screeningStarted } from '../lib/screen.mjs';
import { formDialog, ask } from '../lib/dialog.mjs';
import { download, downloadCsv, downloadPng, wireDownload } from '../lib/figure.mjs';
import { openStudy } from '../lib/study.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiRegion, regionShow } from '../lib/ui-actions.mjs';
import { formField, metadataLine, tableRegion } from '../lib/ui-components.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { plural } from '../lib/dates.mjs';
import { pager, wirePager } from '../lib/paging.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';
import { pagedList, wirePagedLists } from '../lib/paged-list.mjs';

export const usesDocument = true;
export const meta = { title: 'Synthesis', icon: 'layers' };
export const count = (...a) => REGISTRY.synthesis.count(...a);
export function assistContext() {
  const q = readQes(get());
  return `Thematic synthesis: ${q.codes.length} codes on ${q.quotes.length} quotes; descriptive themes ${q.descriptive.map(t => t.label).join(', ') || 'none'}; analytical themes ${q.analytical.map(t => t.label).join(', ') || 'none'}`;
}

const KINDS = {
  code: { list: 'codes', name: 'code', plural: 'codes' },
  descriptive: { list: 'descriptive', name: 'descriptive theme', plural: 'descriptive themes' },
  analytical: { list: 'analytical', name: 'analytical theme', plural: 'analytical themes' },
};
const STAGES = [['code', 'Codes'], ['descriptive', 'Descriptive themes'], ['analytical', 'Analytical themes']];
const EMPTY = {
  code: ['No codes', 'Add a quote and give it a code.'],
  descriptive: ['No descriptive themes', 'Select codes, then group them into a theme.'],
  analytical: ['No analytical themes', 'Select descriptive themes, then group them into a finding.'],
};
const chosen = { code: new Set(), descriptive: new Set(), analytical: new Set() };
const expanded = new Set();          // `${kind}:${id}`
let stage = 'code';                  // the stage shown
let level = 'analytical';            // the matrix's columns
let matrixPage = 1;                  // the matrix's page of sources
let shownCtx = null;                 // the shell's context of the last render: Add quote in the title bar runs with it
const MATRIX_PAGE = 25;
/** Back to the first stage with nothing chosen or open (the page keeps these between visits; a fresh project and the layout sweep start from here). */
export function resetPage() { stage = 'code'; level = 'analytical'; matrixPage = 1; expanded.clear(); for (const k of Object.keys(chosen)) chosen[k].clear(); }

const hasPage = (s, q) => q.codes.length > 0 || studies(s).length > 0;
// the switch names the stage, so its count needs only the short noun ("12 themes"), which keeps the switch in full at 1000
const stageCount = (q, kind) => plural(q[KINDS[kind].list].length, kind === 'code' ? 'code' : 'theme');
/** The title bar of the page, a pure function of its state (the tests read it without a shell). */
export function pageSpec({ stage: shown, count: n, open }, { show = () => {}, add = () => {} } = {}) {
  return { title: 'Synthesis',
    ...(open ? { view: { id: 'qes-stage', label: 'Stage', attr: 'data-qes-stage', value: shown, items: STAGES, run: show } } : {}),
    actions: open ? [{ id: 'qes-add', label: 'Add quote', icon: 'plus', role: 'primary', run: add }] : [], overflow: [] };
}
export function page(rerender) {
  const s = get(), q = readQes(s);
  return pageSpec({ stage, count: stageCount(q, stage), open: hasPage(s, q) }, {
    show: key => { stage = key; rerender(); },
    add: () => addQuoteDialog(shownCtx || { rerender, refreshCounts: () => {} }) });
}

export function render(el, ctx) {
  shownCtx = ctx;
  const s = get(), q = readQes(s);
  for (const k of Object.keys(chosen)) for (const id of chosen[k]) if (!q[KINDS[k].list].some(x => x.id === id)) chosen[k].delete(id);
  if (!q[level].length) level = q.analytical.length ? 'analytical' : q.descriptive.length ? 'descriptive' : level;

  if (!hasPage(s, q)) {
    const screening = screeningStarted(s);
    el.innerHTML = emptyState({ icon: 'layers', title: screening ? 'No included studies' : 'No studies',
      actions: [{ id: 'qes-go', label: screening ? 'Screening' : 'Library', icon: screening ? 'screening' : 'library', primary: true }] });
    el.querySelector('#qes-go').onclick = () => ctx.go(screening ? 'screening' : 'library');
    return;
  }

  el.innerHTML = `<div class="qes">
    ${stagePanel(s, q)}
    ${matrixPanel(s, q)}
  </div>`;

  wirePagedLists(el, () => ctx.rerender());
  wireSelection(el);
  el.querySelectorAll('[data-expand]').forEach(b => b.onclick = () => {
    const key = b.dataset.expand;
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
    rerenderForm(el, ctx);
  });
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.kind, b.dataset.act, ctx));
  el.querySelectorAll('[data-qes-more]').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.qesMore.split(':');
    showMenu(b, [{ label: 'Rename…', run: () => renameItem(kind, id, ctx) }, '-',
      { label: 'Delete…', danger: true, run: () => act(kind, 'delete', ctx, [id]) }], { align: 'end' });
  });
  el.querySelectorAll('[data-qes-member]').forEach(b => b.onclick = () => {
    const [lv, id, member] = b.dataset.qesMember.split(':');
    showMenu(b, [{ label: `Remove from ${KINDS[lv].name}`, run: () => { update(st => { setMembers(st, lv, id, [member], false); return st; }); ctx.rerender(); } }], { align: 'end' });
  });
  el.querySelectorAll('[data-qes-quote]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Delete quote…', danger: true, run: async () => {
    const point = undoPoint();
    update(st => { deleteQuote(st, b.dataset.qesQuote); return st; });
    ctx.rerender(); ctx.refreshCounts();
    offerUndo(point, 'Deleted the quote', () => { ctx.rerender(); ctx.refreshCounts(); });
  } }], { align: 'end' }));
  el.querySelectorAll('[data-open-quote]').forEach(b => b.onclick = () => {
    const x = readQes(get()).quotes.find(y => y.id === b.dataset.openQuote); if (!x) return;
    openStudy(ctx, x.paper, x.page ? { page: x.page, rects: x.rects, quote: x.text, kind: 'text' } : null);
  });
  el.querySelectorAll('[data-statement]').forEach(ta => ta.oninput = () => {
    update(st => { setStatement(st, ta.dataset.statement, ta.value); return st; });
  });
  el.querySelectorAll('[data-level]').forEach(b => b.onclick = () => { level = b.dataset.level; matrixPage = 1; rerenderForm(el, ctx); });
  wirePager(el, 'qes-matrix-pager', page => { matrixPage = page; ctx.rerender(); });
  wireDownload(el.querySelector('#qes-download'), () => [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(matrixRows(themeMatrix(get(), level)), `sources-by-${level}-themes.csv`) },
    { label: 'SVG', icon: 'download', run: () => download(matrixSvg(themeMatrix(get(), level)), `sources-by-${level}-themes.svg`, 'image/svg+xml') },
    { label: 'PNG', icon: 'image', run: () => downloadPng(matrixSvg(themeMatrix(get(), level)), `sources-by-${level}-themes.png`) }]);
}

// ---- the stage shown ---------------------------------------------------------
/** The rows of one stage: id, label, the counts of its detail line, and the rows its expansion adds. */
function stageRows(s, q) {
  if (stage === 'code') return q.codes.map(c => {
    const inD = q.descriptive.filter(t => t.codes.includes(c.id));
    return { id: c.id, label: c.label, n: quotesUnder(s, 'code', c.id).length, unit: 'quote', src: sourcesOf(s, 'code', c.id).length,
      where: inD.length ? `In ${inD.map(t => t.label).join('; ')}` : '', detail: () => codeDetail(s, c) };
  });
  if (stage === 'descriptive') return q.descriptive.map(t => {
    const inA = q.analytical.filter(a => a.themes.includes(t.id));
    return { id: t.id, label: t.label, n: t.codes.length, unit: 'code', src: sourcesOf(s, 'descriptive', t.id).length,
      where: inA.length ? `In ${inA.map(a => a.label).join('; ')}` : '', detail: () => themeDetail(s, 'descriptive', t) };
  });
  return q.analytical.map(t => {
    const a = assessmentOf(t);
    return { id: t.id, label: t.label, n: t.themes.length, unit: 'descriptive theme', src: sourcesOf(s, 'analytical', t.id).length,
      where: a.assessed ? `${a.confidence} confidence` : '', detail: () => themeDetail(s, 'analytical', t) };
  });
}

function stagePanel(s, q) {
  const kind = stage, title = STAGES.find(x => x[0] === kind)[1], rows = stageRows(s, q), n = chosen[kind].size, loose = ungrouped(s);
  // the title bar names the stage and counts it; the list's tools row says the rest (quotes, what is not grouped) and selects every row
  const line = [kind === 'code' ? plural(q.quotes.length, 'quote') : '', loose[KINDS[kind].list]?.length ? `${loose[KINDS[kind].list].length} ungrouped` : ''].filter(Boolean).join(', ');
  if (!rows.length) return `<div class="panel qes-stage" data-stage="${kind}">${emptyState({ icon: 'layers', title: EMPTY[kind][0], detail: EMPTY[kind][1], size: 'inline' })}</div>`;
  const toolsBar = uiBar({ kind: 'head', label: `${title} list`, id: 'qes-list-tools', message: { id: 'qes-count', text: line },
    overflow: [{ id: 'qes-select-all', label: 'Select all', attrs: { 'data-qes-all': '' } }] });
  const attrs = { 'data-kind': kind };
  const selection = uiBar({ kind: 'tools', label: 'Selection', id: 'qes-sel', status: { id: 'qes-sel-count', text: `${n} selected`, ch: 12 },
    actions: [...(kind === 'analytical' ? [] : [{ id: 'qes-group', label: 'Group', icon: 'folder-plus', attrs: { ...attrs, 'data-act': 'group' } }]),
      { id: 'qes-merge', label: 'Merge', icon: 'merge', disabled: n < 2, attrs: { ...attrs, 'data-act': 'merge' } },
      { id: 'qes-clear', label: 'Clear selection', icon: 'close', role: 'quiet', attrs: { 'data-qes-clear': '' } }],
    overflow: [{ id: 'qes-select-all-sel', label: 'Select all', attrs: { 'data-qes-all': '' } }, { id: 'qes-delete', label: 'Delete', danger: true, attrs: { ...attrs, 'data-act': 'delete' } }] });
  return `<div class="panel qes-stage" data-stage="${kind}">
    ${uiRegion({ id: 'qes-region', label: `${title} controls`, active: n ? 1 : 0, bars: [toolsBar, selection] })}
    ${(pg => uiList({ id: 'qes-rows', label: title, cls: 'qes-list', rows: pg.items.map(r => rowHtml(kind, r)) }) + pg.pager)(pagedList(`qes-${kind}`, rows, { label: title.toLowerCase() }))}
  </div>`;
}

function rowHtml(kind, r) {
  const key = `${kind}:${r.id}`, open = expanded.has(key);
  return uiRow({ cls: 'qes-row', attrs: { 'data-qes-row': key }, check: { attrs: { 'data-pick': key, 'data-form-key': `qes-pick-${key}` }, checked: chosen[kind].has(r.id), label: `Select ${r.label}` },
    main: { html: `<button type="button" class="qes-name" data-expand="${esc(key)}" data-form-key="qes-name-${esc(key)}" aria-expanded="${open}" title="${esc(r.label)}">${icon('chevron-right', { size: 12 })}<span>${esc(r.label)}</span></button>`,
      detail: [plural(r.n, r.unit), plural(r.src, 'source'), esc(r.where)], wrap: true },
    end: uiRowEnd({ more: { label: `More for ${r.label}`, attrs: { 'data-qes-more': key } } }) }) + (open ? r.detail() : '');
}

function wireSelection(el) {
  const region = el.querySelector('#qes-region');
  const sync = () => {
    const n = chosen[stage].size;
    if (region) regionShow(region, n ? 1 : 0);
    const count = el.querySelector('#qes-sel-count'); if (count) count.textContent = `${n} selected`;
    const mergeBtn = el.querySelector('#qes-merge'); if (mergeBtn) mergeBtn.disabled = n < 2;
  };
  el.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => {
    const [kind, id] = cb.dataset.pick.split(':');
    if (cb.checked) chosen[kind].add(id); else chosen[kind].delete(id);
    sync();
  });
  const pickAll = on => el.querySelectorAll('[data-pick]').forEach(x => {
    x.checked = on;
    const [kind, id] = x.dataset.pick.split(':');
    if (on) chosen[kind].add(id); else chosen[kind].delete(id);
  });
  el.querySelectorAll('[data-qes-all]').forEach(b => b.onclick = () => { pickAll(true); sync(); });
  el.querySelector('[data-qes-clear]')?.addEventListener('click', () => { pickAll(false); sync(); });
}

/** The rows a code adds when it opens: its quotes, each with its own More. */
function codeDetail(s, c) {
  const quotes = quotesUnder(s, 'code', c.id);
  if (!quotes.length) return child({ main: { html: '<span class="meta">No quotes</span>' } });
  return quotes.map(x => child({
    main: { html: `<blockquote class="qes-quote">${esc(x.text)}</blockquote>`, detail: [esc(labelOf(s, x.paper)), x.page ? `p. ${esc(x.page)}` : 'typed'], wrap: true },
    end: uiRowEnd({ inline: { id: `qes-open-${x.id}`, label: x.page ? 'Show in document' : 'Open study', icon: 'open', attrs: { 'data-open-quote': x.id } },
      more: { label: 'More for this quote', attrs: { 'data-qes-quote': x.id } } }) })).join('');
}

/** The rows a theme adds when it opens: its finding (analytical), its members, and the sources behind it. */
function themeDetail(s, lv, t) {
  const q = readQes(s);
  const members = lv === 'analytical' ? t.themes.map(id => q.descriptive.find(d => d.id === id)).filter(Boolean)
    : t.codes.map(id => q.codes.find(c => c.id === id)).filter(Boolean);
  const src = sourcesOf(s, lv, t.id);
  return [
    ...(lv === 'analytical' ? [child({ main: { html: formField('Finding', `<textarea rows="3" data-statement="${esc(t.id)}" aria-label="Finding">${esc(t.statement || '')}</textarea>`) } })] : []),
    ...members.map(m => child({ main: { html: `<span class="qes-member">${esc(m.label)}</span>`, detail: [plural(sourcesOf(s, lv === 'analytical' ? 'descriptive' : 'code', m.id).length, 'source')] },
      end: uiRowEnd({ more: { label: `More for ${m.label}`, attrs: { 'data-qes-member': `${lv}:${t.id}:${m.id}` } } }) })),
    child({ main: { html: metadataLine(['Sources', src.length ? src.map(id => labelOf(s, id)).join('; ') : 'No quotes']) } })].join('');
}
/** A row an open row adds: its content, and its detail line, sit one step in (the content is wrapped; a row's own indent does not reach its detail line). */
const child = ({ main = {}, end }) => uiRow({ depth: 1, cls: 'qes-child', end,
  main: { html: `<div class="qes-indent">${main.html ?? ''}${(main.detail || []).length ? `<span class="meta qes-detail">${main.detail.join(', ')}</span>` : ''}</div>` } });

// ---- sources by theme -----------------------------------------------------------
function matrixPanel(s, q) {
  const m = themeMatrix(s, level), both = q.analytical.length > 0 && q.descriptive.length > 0;
  const head = uiBar({ kind: 'head', label: 'Sources by theme', id: 'qes-matrix-head', lead: { title: 'Sources by theme' },
    ...(m.cols.length ? { status: { id: 'qes-matrix-count', text: plural(m.rows.length, 'source'), ch: 12 } } : {}),
    ...(both ? { view: { id: 'qes-level', label: 'Theme level', attr: 'data-level', kind: 'segmented', value: level, items: [['analytical', 'Analytical'], ['descriptive', 'Descriptive']] } }
      : m.cols.length ? { message: { id: 'qes-level-note', text: level === 'analytical' ? 'Analytical themes' : 'Descriptive themes' } } : {}),
    actions: [{ id: 'qes-download', label: 'Download', icon: 'download', menu: true, disabled: !m.cols.length }] });
  const pages = Math.max(1, Math.ceil(m.rows.length / MATRIX_PAGE)), page = matrixPage = Math.min(matrixPage, pages), from = (page - 1) * MATRIX_PAGE;
  const body = m.rows.slice(from, from + MATRIX_PAGE).map((p, i) => `<tr><td class="grow">${esc(p.label || p.id)}</td>${m.cells[from + i].map(n => `<td class="num${n ? ' qes-hit' : ''}">${n || ''}</td>`).join('')}</tr>`).join('');
  return `<div class="panel">${head}${m.cols.length ? `${tableRegion({ label: 'Sources by theme', html: `<table class="qes-matrix"><thead><tr><th class="grow">Source</th>
      ${m.cols.map(t => `<th class="num" title="${esc(t.label)}">${esc(t.label)}</th>`).join('')}</tr></thead>
      <tbody>${body}<tr class="qes-total"><td class="grow">Sources</td>${m.support.map(n => `<td class="num">${n}</td>`).join('')}</tr></tbody></table>` })}
      ${pager({ id: 'qes-matrix-pager', page, pages, total: m.rows.length, label: 'sources', size: MATRIX_PAGE })}` : ''}
  </div>`;
}

// ---- actions ----------------------------------------------------------------
async function act(kind, a, ctx, ids = [...chosen[kind]]) {
  const q = readQes(get()), items = q[KINDS[kind].list].filter(x => ids.includes(x.id));
  if (!items.length) return;
  if (a === 'delete') {
    const point = undoPoint();
    update(st => { remove(st, kind, ids); return st; });
    offerUndo(point, `Deleted ${plural(items.length, KINDS[kind].name, KINDS[kind].plural)}`, () => { ctx.rerender(); ctx.refreshCounts?.(); });
  } else if (a === 'merge') {
    const into = await pickDialog(`Merge ${plural(items.length, KINDS[kind].name, KINDS[kind].plural)}`, 'Keep', items, { confirm: 'Merge' });
    if (!into) return;
    update(st => { merge(st, kind, ids, into.id); return st; });
  } else if (a === 'group') {
    const up = kind === 'code' ? 'descriptive' : 'analytical';
    const target = await pickDialog(`Group into ${KINDS[up].name}`, 'Theme', q[up], { allowNew: true, confirm: 'Group' });
    if (!target) return;
    update(st => {
      if (target.id) setMembers(st, up, target.id, ids, true); else addTheme(st, up, target.label, ids);
      return st;
    });
  }
  for (const id of ids) chosen[kind].delete(id);
  ctx.rerender(); ctx.refreshCounts();
}

async function renameItem(kind, id, ctx) {
  const cur = readQes(get())[KINDS[kind].list].find(x => x.id === id);
  const name = await ask(`Rename ${KINDS[kind].name}`, { value: cur?.label || '', confirm: 'Rename' });
  if (!name?.trim()) return;
  update(st => { rename(st, kind, id, name); return st; });
  ctx.rerender(); ctx.refreshCounts();
}

/** Chooses one of `items`, or names a new one when allowed. Resolves to { id } or { label }, or null. */
function pickDialog(title, label, items, { allowNew = false, confirm = 'Save' } = {}) {
  const fields = [formField(label, `<select name="pick">${allowNew ? '<option value="">New theme</option>' : ''}${items.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}</select>`),
    ...(allowNew ? [`<div data-new>${formField('Name', '<input name="name" autocomplete="off">')}</div>`] : [])];
  return formDialog({ id: 'synthesis-pick', title, tier: 'S', confirm, body: fields.join(''),
    onMount: d => {
      const f = d.querySelector('form'), pick = f.elements.namedItem('pick');
      const sync = () => { const row = d.querySelector('[data-new]'); if (row) row.hidden = Boolean(pick.value); };
      pick.onchange = sync; sync();
      if (allowNew && !items.length) queueMicrotask(() => f.elements.namedItem('name')?.focus());
    },
    submit: form => {
      const pick = form.elements.namedItem('pick'), name = form.elements.namedItem('name');
      if (pick.value) return { id: pick.value };
      if (!name?.value.trim()) { name?.focus(); return undefined; }
      return { label: name.value.trim() };
    } });
}

/** A quote typed or pasted in, with its source, code and page. */
async function addQuoteDialog(ctx) {
  const s = get(), q = readQes(s);
  const sources = [...studies(s), ...(s.papers || []).filter(p => !studies(s).includes(p))];
  const fields = [formField('Source', `<select name="paper">${sources.map(p => `<option value="${esc(p.id)}">${esc(p.label || p.title || p.id)}</option>`).join('')}</select>`),
    formField('Quote', '<textarea name="text" rows="4"></textarea>'), formField('Code', '<input name="code" list="qes-codes" autocomplete="off">'),
    formField('Page', '<input name="page" inputmode="numeric" autocomplete="off">')];
  const out = await formDialog({ id: 'synthesis-quote', title: 'Add quote', tier: 'M', confirm: 'Add',
    body: `${fields.join('')}<datalist id="qes-codes">${q.codes.map(c => `<option value="${esc(c.label)}"></option>`).join('')}</datalist>`,
    submit: f => {
      const v = k => f.elements.namedItem(k).value.trim();
      if (!v('text')) { f.elements.namedItem('text').focus(); return undefined; }
      if (!v('code')) { f.elements.namedItem('code').focus(); return undefined; }
      return { paper: v('paper'), text: v('text'), code: v('code'), page: parseInt(v('page'), 10) || null };
    } });
  if (!out?.paper) return;
  update(st => {
    const code = ensureCode(st, out.code);
    addQuote(st, { code, paper: out.paper, text: out.text, locator: out.page ? { page: out.page, rects: null, document_version: null } : null });
    return st;
  });
  ctx.rerender(); ctx.refreshCounts();
}
