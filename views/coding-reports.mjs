// Retrieval, matrices and intercoder agreement in the coding workspace (views/coding.mjs).
import { get, update } from '../store.mjs';
import { readQual, codeTree } from '../lib/qual.mjs';
import { levelsOf } from '../lib/qual-cases.mjs';
import { retrieve, retrievalCsvRows, retrievalMarkdown, retrievalDocxBlocks, frequencies, cooccurrence, cooccurrenceCsvRows,
  crosstab, crosstabCsvRows, crosstabMethod, fmtP, frameworkTable, setFrameworkCell, frameworkCsvRows, jointDisplay, jointCsvRows, fmtMeanSd,
  agreement, agreementMethod, agreementCsvRows, coders } from '../lib/qual-analysis.mjs';
import { writeTablesDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { download, downloadCsv, wireDownload } from '../lib/figure.mjs';
import { esc, emptyState, autoGrow } from '../lib/html.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { uiLink, tableRegion } from '../lib/ui-components.mjs';
import { num } from '../lib/dates.mjs';
import { ui, plural, cut } from './coding-common.mjs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const docxOf = async blocks => saveFile(await writeTablesDocx({ blocks, landscape: false, page: { w: 11906, h: 16838, margin: 1134 }, size: 10 }), 'coding-retrieval.docx', DOCX);
const tableDocx = (title, rows) => [{ type: 'para', text: title, bold: true, size: 10, after: 6 },
  { type: 'table', widths: rows[0].map(() => Math.floor(15704 / rows[0].length)), header: rows[0].map(String), headerFill: 'F2F2F2', rows: rows.slice(1).map(r => ({ cells: r.map(t => ({ text: String(t ?? ''), span: 1 })) })) }];
const saveTables = async (title, rows, file) => saveFile(await writeTablesDocx({ blocks: tableDocx(title, rows) }), file, DOCX);
const nothing = (title, detail = '') => `<div class="panel-body">${emptyState({ title, detail, size: 'inline' })}</div>`;
/** A panel's head: its title, one line of what it holds, and a Download menu when it has something to download. */
const panelHead = (id, title, text, { download: dl = null, actions = [] } = {}) => uiBar({ kind: 'head', label: title, id, lead: { title }, ...(text ? { message: { text } } : {}),
  ...(dl || actions.length ? { actions: [...(dl ? [{ id: dl.id, label: 'Download', icon: 'download', menu: true, disabled: !!dl.disabled }] : []), ...actions] } : {}) });
/** One filter select of a panel: its first choice names what it filters, so the select needs no label of its own. */
const pick = (id, label, list, value, attrs, empty = null) => ({ type: 'select', id, label, options: [...(empty != null ? [['', empty]] : []), ...list], value, attrs });
const check = (id, label, on, attrs) => ({ type: 'check', id, label, value: on, attrs, foldable: false });
const filterBar = (id, label, filters, extra = {}) => uiBar({ kind: 'tools', label, id, filters, ...extra });

// ---- retrieval --------------------------------------------------------------------
function filters(s) {
  const f = ui.retrieve;
  return { codeIds: f.codeId ? [f.codeId] : null, includeChildren: f.children, docIds: f.docId ? [f.docId] : null, caseIds: f.caseId ? [f.caseId] : null,
    where: f.attrId && f.value !== '' ? { attrId: f.attrId, value: f.value } : null, coder: f.coder || null, exemplar: f.exemplar };
}
const retrievedSegment = r => `<div class="qc-ret"><blockquote class="qc-quote">${esc(cut(r.text, 1200))}</blockquote>
  <div class="meta qc-src"><span>${esc([r.document, r.case, r.locator, r.coder && `coder ${r.coder}`, r.exemplar ? 'exemplar' : '', r.weight != null ? `weight ${r.weight}` : ''].filter(Boolean).join(', '))}</span>
    ${uiLink({ label: 'Show', attrs: { 'data-open': `${r.docId}|${r.codingId}` } })}</div>
  ${r.memo ? `<div class="qc-memo meta">${esc(r.memo)}</div>` : ''}</div>`;
const retrievalGroup = (path, list) => `<h3 class="qc-h3"><span>${esc(path)}</span> <span class="meta">${plural(list.length, 'segment')}</span></h3>${list.map(retrievedSegment).join('')}`;
export function renderRetrieve(el, ctx) {
  const s = get(), q = readQual(s), f = ui.retrieve, rows = retrieve(s, filters(s));
  const levels = f.attrId ? levelsOf(s, f.attrId) : [];
  const groups = new Map(); for (const r of rows) { if (!groups.has(r.path)) groups.set(r.path, []); groups.get(r.path).push(r); }
  const tree = codeTree(s).map(({ code, depth }) => [code.id, `${'– '.repeat(depth)}${code.label}`]);
  const bar = filterBar('qc-ret-filters', 'Retrieve filters', [
    pick('qc-ret-code', 'Code', tree, f.codeId, { 'data-f': 'codeId' }, 'All codes'), check('qc-ret-children', 'With codes beneath', f.children, { 'data-f': 'children' }),
    pick('qc-ret-doc', 'Document', q.documents.map(d => [d.id, d.name]), f.docId, { 'data-f': 'docId' }, 'All documents'),
    pick('qc-ret-case', 'Case', q.cases.map(c => [c.id, c.label]), f.caseId, { 'data-f': 'caseId' }, 'All cases'),
    pick('qc-ret-attr', 'Attribute', q.attributes.map(a => [a.id, a.label]), f.attrId, { 'data-f': 'attrId' }, 'Any attribute'),
    ...(f.attrId ? [pick('qc-ret-value', 'Value', levels.map(v => [v, v]), f.value, { 'data-f': 'value' }, 'Any value')] : []),
    pick('qc-ret-coder', 'Coder', coders(s).map(w => [w, w || 'No coder']), f.coder, { 'data-f': 'coder' }, 'All coders'), check('qc-ret-exemplar', 'Exemplars only', f.exemplar, { 'data-f': 'exemplar' })]);
  el.innerHTML = `<section class="panel">${panelHead('qc-ret-head', 'Retrieve', plural(rows.length, 'segment'), { download: { id: 'qc-ret-dl', disabled: !rows.length } })}
    ${bar}
    ${rows.length ? `<div class="panel-body qc-retrieval">${[...groups].map(([path, list]) => retrievalGroup(path, list)).join('')}</div>` : nothing('No coded segments match')}
  </section>`;
  el.querySelectorAll('[data-f]').forEach(i => i.onchange = () => {
    const k = i.dataset.f; f[k] = i.type === 'checkbox' ? i.checked : i.value;
    if (k === 'attrId') f.value = '';
    ctx.rerender();
  });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [d, x] = b.dataset.open.split('|'); ui.docId = d; ui.coding = x; ui.tab = 'document'; ctx.rerender(); });
  wireDownload(el.querySelector('#qc-ret-dl'), () => {
    const r = retrieve(get(), filters(get()));
    return [{ label: 'Word', icon: 'file', run: () => docxOf(retrievalDocxBlocks(r)) },
      { label: 'CSV', icon: 'table', run: () => downloadCsv(retrievalCsvRows(r), 'coding-retrieval.csv') },
      { label: 'Markdown', icon: 'note', run: () => download(retrievalMarkdown(r), 'coding-retrieval.md', 'text/markdown') }];
  });
}

// ---- matrices -------------------------------------------------------------------------
const MATRICES = [['frequency', 'Frequencies'], ['cooccurrence', 'Co-occurrence'], ['crosstab', 'By attribute'], ['framework', 'Framework'], ['joint', 'Joint display']];
/** Framework and joint display columns: top-level codes, or descriptive or analytical themes. */
function columnIds(s, kind) {
  const q = readQual(s);
  if (kind === 'descriptive') return q.descriptive.map(t => t.id);
  if (kind === 'analytical') return q.analytical.map(t => t.id);
  return q.codes.filter(c => !c.parent).map(c => c.id);
}
const columnChoice = (s, value, key) => {
  const q = readQual(s);
  return pick(`qc-cols-${key}`, 'Columns', [['codes', 'Top-level codes'], ...(q.descriptive.length ? [['descriptive', 'Descriptive themes']] : []), ...(q.analytical.length ? [['analytical', 'Analytical themes']] : [])], value, { 'data-cols': key });
};
export function renderMatrices(el, ctx) {
  const s = get(), q = readQual(s);
  el.innerHTML = `${uiBar({ kind: 'tools', label: 'Matrix', id: 'qc-matrix-tools', view: { id: 'qc-matrix-view', label: 'Matrix', attr: 'data-m', value: ui.matrix, items: MATRICES } })}<div class="qc-matrix"></div>`;
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { ui.matrix = b.dataset.m; ctx.rerender(); });
  const host = el.querySelector('.qc-matrix');
  if (!q.codes.length) { host.innerHTML = `<section class="panel">${nothing('No codes')}</section>`; return; }
  ({ frequency: freqPanel, cooccurrence: coPanel, crosstab: crossPanel, framework: frameworkPanel, joint: jointPanel }[ui.matrix] || freqPanel)(host, ctx);
}

const freqRow = ({ code, depth }, byId) => { const f = byId.get(code.id); return `<tr><td class="qc-key"><span class="qc-indent ui-indent" style="--depth:${depth}">${esc(code.label)}</span></td><td class="num">${f.own.codings}</td><td class="num">${f.all.codings}</td><td class="num">${f.all.documents}</td><td class="num">${f.all.cases}</td><td class="num">${num(f.all.characters)}</td></tr>`; };
function freqPanel(el) {
  const s = get(), byId = new Map(frequencies(s).map(f => [f.codeId, f])), tree = codeTree(s);
  const rows = [['code', 'codings', 'codings_with_children', 'documents', 'cases', 'characters'], ...tree.map(({ code }) => { const f = byId.get(code.id); return [f.path, f.own.codings, f.all.codings, f.all.documents, f.all.cases, f.all.characters]; })];
  el.innerHTML = `<section class="panel">${panelHead('qc-freq-head', 'Code frequencies', 'Counts include the codes beneath', { download: { id: 'qc-freq-dl' } })}
    ${tableRegion({ label: 'Code frequencies', sticky: true, html: `<table class="qc-table"><thead><tr><th class="qc-key">Code</th><th class="num">Own codings</th><th class="num">Codings</th><th class="num">Documents</th><th class="num">Cases</th><th class="num">Characters</th></tr></thead><tbody>
    ${tree.map(t => freqRow(t, byId)).join('')}
    </tbody></table>` })}</section>`;
  wireDownload(el.querySelector('#qc-freq-dl'), [{ label: 'CSV', icon: 'table', run: () => downloadCsv(rows, 'code-frequencies.csv') }, { label: 'Word', icon: 'file', run: () => saveTables('Code frequencies', rows, 'code-frequencies.docx') }]);
}

const coRow = (c, i, m) => `<tr><td class="qc-key"><span class="qc-short">${esc(c.short || '')}</span> ${esc(c.label)}</td>${m.cells[i].map((n, j) => `<td class="num${i === j ? ' qc-diag' : n ? ' qc-hit' : ''}">${n || ''}</td>`).join('')}</tr>`;
function coPanel(el) {
  const s = get(), ids = codeTree(s).map(x => x.code.id).slice(0, 40), m = cooccurrence(s, ids);
  el.innerHTML = `<section class="panel">${panelHead('qc-co-head', 'Co-occurrence', 'Overlapping codings', { download: { id: 'qc-co-dl' } })}
    ${tableRegion({ label: 'Co-occurrence of codes', sticky: true, html: `<table class="qc-table qc-co"><thead><tr><th class="qc-key">Code</th>${m.codes.map(c => `<th class="num" title="${esc(c.label)}"><span class="qc-short">${esc(c.short || '')}</span></th>`).join('')}</tr></thead><tbody>
    ${m.codes.map((c, i) => coRow(c, i, m)).join('')}
    </tbody></table>` })}${ids.length < readQual(s).codes.length ? `<div class="panel-body"><span class="meta">The first 40 codes are shown; the CSV has them all</span></div>` : ''}</section>`;
  wireDownload(el.querySelector('#qc-co-dl'), [{ label: 'CSV', icon: 'table', run: () => downloadCsv(cooccurrenceCsvRows(cooccurrence(get())), 'code-cooccurrence.csv') }]);
}

const crossRow = r => `<tr><td class="qc-key">${esc(r.path)}</td>${r.counts.map((k, i) => `<td class="num">${k} <span class="meta">${r.pct[i] == null ? '' : `${Math.round(r.pct[i])}%`}</span></td>`).join('')}<td class="qc-test" title="${esc(r.test.note || '')}">${esc(r.test.method)}</td><td class="num">${fmtP(r.test.p)}</td></tr>`;
function crossPanel(el, ctx) {
  const s = get(), q = readQual(s), c = ui.crosstab;
  if (!q.attributes.some(a => a.id === c.attrId)) c.attrId = q.attributes.find(a => a.type === 'category')?.id || q.attributes[0]?.id || '';
  const t = c.attrId ? crosstab(s, { codeIds: null, attrId: c.attrId, includeUnknown: c.unknown }) : null;
  el.innerHTML = `<section class="panel">${panelHead('qc-ct-head', 'Codes by attribute', t ? 'Cases with each code' : '', { download: { id: 'qc-ct-dl', disabled: !t } })}
    ${filterBar('qc-ct-filters', 'Attribute', [pick('qc-ct-attr', 'Attribute', q.attributes.map(a => [a.id, a.label]), c.attrId, {}, q.attributes.length ? null : 'No attributes'), check('qc-ct-unk', 'Unknown as a level', c.unknown, {})])}
    ${t && t.levels.length ? `${tableRegion({ label: 'Codes by attribute', sticky: true, html: `<table class="qc-table"><thead><tr><th class="qc-key">Code</th>${t.levels.map((l, i) => `<th class="num">${esc(l)} <span class="meta">n = ${t.n[i]}</span></th>`).join('')}<th>Test</th><th class="num">p</th></tr></thead><tbody>
      ${t.rows.map(crossRow).join('')}
      </tbody></table>` })}<div class="panel-body"><p class="meta qc-method">${esc(crosstabMethod(t))}</p></div>`
      : nothing(q.attributes.length ? 'No cases have a value for this attribute' : 'No attributes', q.attributes.length ? '' : 'Add attributes to cases in Cases')}
  </section>`;
  el.querySelector('#qc-ct-attr')?.addEventListener('change', e => { c.attrId = e.target.value; ctx.rerender(); });
  el.querySelector('#qc-ct-unk')?.addEventListener('change', e => { c.unknown = e.target.checked; ctx.rerender(); });
  wireDownload(el.querySelector('#qc-ct-dl'), () => { const x = crosstab(get(), { attrId: c.attrId, includeUnknown: c.unknown }); return [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(crosstabCsvRows(x), 'codes-by-attribute.csv') },
    { label: 'Word', icon: 'file', run: () => saveTables(`Codes by ${x.attribute.label}`, crosstabCsvRows(x), 'codes-by-attribute.docx') }]; });
}

/** What a framework cell holds: the segments behind it, quoted, or a line saying there are none. */
const segmentsOf = (xs, docs) => xs.length ? xs.map(x => `<blockquote class="qc-quote">${esc(cut(docs.get(x.docId).text.slice(x.start, x.end), 500))}</blockquote><div class="meta qc-src">${esc(docs.get(x.docId).name)}</div>`).join('') : '<span class="meta">No coded segments</span>';
const fwCell = (f, i, j, ri, ci) => `<td class="qc-fw-cell${i === ri && j === ci ? ' on' : ''}">${uiLink({ label: plural(f.segments[i][j].length, 'segment'), cls: 'qc-fw-n', attrs: { 'data-cell': `${i}:${j}`, 'aria-label': `Segments for ${f.rows[i].label}, ${f.cols[j].label}` } })}
  <textarea rows="2" data-fw="${esc(f.rows[i].id)}|${esc(f.cols[j].id)}" data-cell-i="${i}:${j}" aria-label="Summary for ${esc(f.rows[i].label)}, ${esc(f.cols[j].label)}">${esc(f.cells[i][j])}</textarea></td>`;
function frameworkPanel(el, ctx) {
  const s = get(), fw = ui.framework, cols = columnIds(s, fw.columns), f = frameworkTable(s, cols);
  const [ri, ci] = fw.cell ? fw.cell.split(':').map(Number) : [-1, -1];
  const segs = ri >= 0 && f.segments[ri]?.[ci] ? f.segments[ri][ci] : null, docs = new Map(readQual(s).documents.map(d => [d.id, d]));
  const grid = `<table class="qc-table qc-fw-table"><thead><tr><th class="qc-fw-key">${f.byCase ? 'Case' : 'Document'}</th>${f.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${f.rows.map((r, i) => `<tr><th class="qc-fw-key">${esc(r.label)}</th>${f.cols.map((c, j) => fwCell(f, i, j, ri, ci)).join('')}</tr>`).join('')}
      </tbody></table>`;
  el.innerHTML = `<section class="panel">${panelHead('qc-fw-head', 'Framework matrix', `${f.byCase ? 'Cases' : 'Documents'} by ${plural(f.cols.length, 'column')}`, { download: { id: 'qc-fw-dl', disabled: !(f.rows.length && f.cols.length) } })}
    ${filterBar('qc-fw-filters', 'Framework columns', [columnChoice(s, fw.columns, 'framework')])}
    ${f.rows.length && f.cols.length ? `<div class="qc-fw"><div class="qc-fw-grid">${tableRegion({ label: 'Framework matrix', html: grid })}</div>
      <aside class="qc-fw-side">${segs ? `<h3 class="qc-h3">${esc(f.rows[ri].label)}: ${esc(f.cols[ci].label)}</h3>${segmentsOf(segs, docs)}` : '<span class="meta">Choose a cell to see its coded segments</span>'}</aside></div>` : nothing('Nothing to tabulate')}
  </section>`;
  el.querySelector('[data-cols]').onchange = e => { fw.columns = e.target.value; fw.cell = null; ctx.rerender(); };
  el.querySelectorAll('[data-cell]').forEach(b => b.onclick = () => { fw.cell = b.dataset.cell; ctx.rerender(); });
  el.querySelectorAll('[data-fw]').forEach(t => {
    autoGrow(t);
    t.onfocus = () => { if (fw.cell !== t.dataset.cellI) { fw.cell = t.dataset.cellI; const side = el.querySelector('.qc-fw-side'); const [a, b] = fw.cell.split(':').map(Number);
      el.querySelectorAll('.qc-fw-cell.on').forEach(x => x.classList.remove('on')); t.closest('td').classList.add('on');
      side.innerHTML = `<h3 class="qc-h3">${esc(f.rows[a].label)}: ${esc(f.cols[b].label)}</h3>${segmentsOf(f.segments[a][b], docs)}`; } };
    t.onchange = () => { const [r, c] = t.dataset.fw.split('|'); update(st => { setFrameworkCell(st, r, c, t.value); return st; }); };
  });
  wireDownload(el.querySelector('#qc-fw-dl'), () => { const x = frameworkTable(get(), columnIds(get(), fw.columns)); return [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(frameworkCsvRows(x), 'framework-matrix.csv') },
    { label: 'Word', icon: 'file', run: () => saveTables('Framework matrix', frameworkCsvRows(x), 'framework-matrix.docx') }]; });
}

const jointCell = (c, t) => `<td class="qc-wrap">${c.of ? `<span class="qc-strong">${c.cases}/${c.of}</span> <span class="meta">cases, ${esc(t.value)} ${esc(fmtMeanSd(c.stat) || '–')}</span>${c.exemplar ? `<blockquote class="qc-quote">${esc(cut(c.exemplar.text, 220))} <span class="meta">(${esc(c.exemplar.source)})</span></blockquote>` : ''}` : '<span class="meta">No coded data</span>'}</td>`;
function jointPanel(el, ctx) {
  const s = get(), j = ui.joint, sets = (s.datasets || []).filter(d => d.columns?.length);
  if (!sets.some(d => d.id === j.dataset)) Object.assign(j, { dataset: sets[0]?.id || '', key: '', group: '', value: '' });
  const d = sets.find(x => x.id === j.dataset);
  if (d) {
    const has = id => d.columns.some(c => c.id === id);
    if (!has(j.key)) j.key = (d.columns.find(c => /id|participant|respondent|case/i.test(c.label)) || d.columns[0]).id;
    if (!has(j.group)) j.group = (d.columns.find(c => c.type === 'category' && c.id !== j.key) || d.columns.find(c => c.id !== j.key) || d.columns[0]).id;
    if (!has(j.value)) j.value = (d.columns.find(c => c.type === 'number' || c.type === 'integer') || d.columns[0]).id;
  }
  const t = d ? jointDisplay(s, { dataset: d, keyColumn: j.key, groupColumn: j.group, valueColumn: j.value, columns: columnIds(s, j.columns) }) : null;
  const col = (k, label, list) => pick(`qc-j-${k}`, label, list.map(c => [c.id, c.label]), j[k], { 'data-j': k });
  const choices = d ? [pick('qc-j-dataset', 'Dataset', sets.map(x => [x.id, x.name]), j.dataset, { 'data-j': 'dataset' }), col('key', 'Case column', d.columns), col('group', 'Group', d.columns),
    col('value', 'Measure', d.columns.filter(c => c.type === 'number' || c.type === 'integer')), columnChoice(s, j.columns, 'joint')] : [];
  el.innerHTML = `<section class="panel">${panelHead('qc-jd-head', 'Joint display', '', { download: { id: 'qc-jd-dl', disabled: !t?.rows.length } })}
    ${d ? filterBar('qc-jd-filters', 'Joint display choices', choices) : ''}
    ${t && t.rows.length ? `${tableRegion({ label: 'Joint display', html: `<table class="qc-table qc-joint"><thead><tr><th>Theme</th>${t.groups.map(g => `<th>${esc(t.group)}: ${esc(g.group)}<br><span class="meta">${plural(g.cases, 'case')}, ${esc(t.value)} ${esc(fmtMeanSd(g.stat) || '–')}</span></th>`).join('')}</tr></thead><tbody>
      ${t.rows.map(r => `<tr><td class="qc-strong qc-wrap">${esc(r.label)}</td>${r.cells.map(c => jointCell(c, t)).join('')}</tr>`).join('')}
      </tbody></table>` })}<div class="panel-body"><p class="meta qc-method">${esc(t.value)}: mean (SD) by ${esc(t.group)}</p></div>`
      : nothing(d ? 'No cases match the dataset' : 'No dataset', d ? 'Case labels must equal the values of the case column' : 'Import a dataset in Datasets')}
  </section>`;
  el.querySelectorAll('[data-j]').forEach(i => i.onchange = () => { j[i.dataset.j] = i.value; ctx.rerender(); });
  el.querySelector('[data-cols]')?.addEventListener('change', e => { j.columns = e.target.value; ctx.rerender(); });
  wireDownload(el.querySelector('#qc-jd-dl'), () => [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(jointCsvRows(t), 'joint-display.csv') },
    { label: 'Markdown', icon: 'note', run: () => download(jointCsvRows(t).map((r, i) => `| ${r.map(x => String(x).replace(/\|/g, '\\|')).join(' | ')} |${i ? '' : `\n|${r.map(() => '---').join('|')}|`}`).join('\n'), 'joint-display.md', 'text/markdown') },
    { label: 'Word', icon: 'file', run: () => saveTables('Joint display', jointCsvRows(t), 'joint-display.docx') }]);
}

// ---- agreement -------------------------------------------------------------------------------
const agreementRow = (x, pct, k) => `<tr><td class="qc-key">${esc(x.path)}</td><td class="num">${num(x.table[0][0])}</td><td class="num">${num(x.table[0][1])}</td><td class="num">${num(x.table[1][0])}</td><td class="num">${num(x.table[1][1])}</td><td class="num">${pct(x.po)}</td><td class="num">${k(x.kappa)}</td></tr>`;
export function renderAgreement(el, ctx) {
  const s = get(), who = coders(s), a = ui.agreement;
  if (!who.includes(a.a)) a.a = who[0] ?? '';
  if (!who.includes(a.b) || a.b === a.a) a.b = who.find(w => w !== a.a) ?? '';
  const ok = who.length >= 2 && a.a !== a.b;
  const r = ok ? agreement(s, { coderA: a.a, coderB: a.b, unit: a.unit }) : null;
  const pct = x => (x == null ? '' : `${(100 * x).toFixed(1)}%`), k = x => (x == null ? 'n/a' : x.toFixed(2));
  const rows = r ? r.rows.filter(x => x.table[0][0] + x.table[0][1] + x.table[1][0] > 0) : [];
  const bar = who.length >= 2 ? uiBar({ kind: 'tools', label: 'Coders and unit', id: 'qc-ag-tools',
    view: { id: 'qc-ag-unit', label: 'Unit', attr: 'data-unit', value: a.unit, items: [['characters', 'Characters'], ['segments', 'Segments']] },
    filters: [pick('qc-ag-a', 'Coder A', who.map(w => [w, `Coder A: ${w || 'no coder'}`]), a.a, { 'data-ag': 'a' }), pick('qc-ag-b', 'Coder B', who.filter(w => w !== a.a).map(w => [w, `Coder B: ${w || 'no coder'}`]), a.b, { 'data-ag': 'b' })] }) : '';
  el.innerHTML = `<section class="panel">${panelHead('qc-ag-head', 'Intercoder agreement', '', { download: { id: 'qc-ag-dl', disabled: !rows.length } })}
      ${bar}
    ${r && r.docs ? `${tableRegion({ label: 'Intercoder agreement by code', sticky: true, html: `<table class="qc-table"><thead><tr><th class="qc-key">Code</th><th class="num">Both</th><th class="num">${esc(a.a || 'No coder')} only</th><th class="num">${esc(a.b || 'No coder')} only</th><th class="num">Neither</th><th class="num">Agreement</th><th class="num">Kappa</th></tr></thead><tbody>
      ${rows.map(x => agreementRow(x, pct, k)).join('')}
      ${agreementRow({ ...r.overall, path: 'All codes (pooled)' }, pct, k).replace('<tr>', '<tr class="qc-total">')}
      </tbody></table>` })}<div class="panel-body"><p class="meta qc-method">${esc(agreementMethod(r))}</p></div>`
      : nothing(who.length < 2 ? 'One coder so far' : 'No document coded by both', who.length < 2 ? 'Import a colleague’s codings from More, or code as a second coder' : '')}
  </section>`;
  el.querySelectorAll('[data-ag]').forEach(i => i.onchange = () => { a[i.dataset.ag] = i.value; ctx.rerender(); });
  el.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => { a.unit = b.dataset.unit; ctx.rerender(); });
  wireDownload(el.querySelector('#qc-ag-dl'), () => [{ label: 'CSV', icon: 'table', run: () => downloadCsv(agreementCsvRows(agreement(get(), { coderA: a.a, coderB: a.b, unit: a.unit }), a.a, a.b), 'intercoder-agreement.csv') }]);
}
