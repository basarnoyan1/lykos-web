// An output spec (lib/output-spec.mjs) made concrete: its query run, its rows
// split into one table per group, formatted, drawn as a chart, and written as
// xlsx, docx, csv, svg or png. Used by the Tables and figures view, the
// assistant's preview and the MCP server's outputs and save_output, so
// all three show and write the same numbers.
import { addonChart, kitFor } from './addons.mjs';
import { runQuery, toNumber, compareCells, normName } from './project-query.mjs';
import { sourceLine, CHART_TYPES } from './output-spec.mjs';
import { barSvg, columnSvg, stackedSvg, dotSvg, forestSvg, timelineSvg, heatSvg, fmtNumber } from './output-charts.mjs';
import { figureTokens } from './figure-style.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { writeTablesDocx } from './docx-write.mjs';
import { looksLikeQuery, queryLines } from './boolean.mjs';

const norm = normName;
const isEmpty = v => v == null || (Array.isArray(v) ? !v.length : String(v).trim() === '');
export const NOT_REPORTED = 'Not reported';

/** A cell as shown: lists joined, numbers in the column's format. */
export function formatCell(v, format, type, { fraction = null } = {}) {
  if (Array.isArray(v)) return v.join('; ');
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : (format && format !== 'text' ? toNumber(v) : null);
  if (n == null) return String(v);
  switch (format) {
    case 'text': return String(v);
    case 'integer': return String(Math.round(n));
    case '1dp': return n.toFixed(1);
    case '2dp': return n.toFixed(2);
    // A column of fractions (every value within ±1) is shown ×100; a column of
    // percentages as it is. Decided per column, so 1 and 45 read alike.
    case 'percent': return `${((fraction ?? (n <= 1 && n >= -1)) ? n * 100 : n).toFixed(1)}%`;
    case 'number': return fmtNumber(n);
    default: return type === 'number' && typeof v === 'number' ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)) : String(v);
  }
}
/** The value written to a spreadsheet cell: a number where the column holds one. */
function sheetValue(v, format, type) {
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'number' && format !== 'text') {
    if (format === 'integer') return Math.round(v);
    if (format === '1dp') return Math.round(v * 10) / 10;
    if (format === '2dp' || (!format && !Number.isInteger(v))) return Math.round(v * 100) / 100;
    return v;
  }
  return v ?? '';
}

const colIndex = (columns, ref) => columns.findIndex(c => norm(c.label) === norm(ref) || norm(c.id) === norm(ref));

/**
 * Runs the spec and lays out its rows. Returns `{ spec, result, columns,
 * groups: [{ label, rows, cells, refs }], notes, chart }`: `rows` are the raw
 * result rows of each group, `cells` the formatted text, `refs` the records
 * behind each row.
 */
export function renderOutput(s, spec) {
  const result = runQuery(s, { ...spec.query, offset: spec.query.offset || 0 }, { all: spec.query.limit == null });
  const gi = spec.groupRowsBy ? colIndex(result.columns, spec.groupRowsBy) : -1;
  if (spec.groupRowsBy && gi < 0) throw new Error(`groupRowsBy "${spec.groupRowsBy}" is not a column of the query result.`);
  const listed = spec.columns?.length ? spec.columns.filter(c => !c.hidden).map(c => ({ ...c, i: colIndex(result.columns, c.col) })) : null;
  if (listed?.some(c => c.i < 0)) throw new Error(`Column "${listed.find(c => c.i < 0).col}" is not in the query result.`);
  const columns = (listed || result.columns.map((c, i) => ({ col: c.label, i })).filter(c => c.i !== gi))
    .map(c => ({ i: c.i, label: c.label || result.columns[c.i].label, format: c.format || null, type: result.columns[c.i].type }));
  // Groups in natural order (Table 1, Table 2, … Table 10); a row with several
  // values of the group column (a study in two collections) is in each.
  const byKey = new Map();
  result.rows.forEach((row, r) => {
    const v = gi < 0 ? null : row[gi];
    const keys = gi < 0 ? [''] : Array.isArray(v) ? (v.length ? v : [NOT_REPORTED]) : [isEmpty(v) ? NOT_REPORTED : v];
    for (const k of keys) { const id = norm(k); if (!byKey.has(id)) byKey.set(id, { label: String(k), rows: [], refs: [], index: [] }); const g = byKey.get(id); g.rows.push(row); g.refs.push(result.refs[r]); g.index.push(r); }
  });
  const groups = [...byKey.values()].sort((a, b) => gi < 0 ? 0 : (a.label === NOT_REPORTED) - (b.label === NOT_REPORTED) || compareCells(a.label, b.label));
  for (const c of columns) if (c.format === 'percent') {
    const ns = result.rows.map(row => toNumber(row[c.i])).filter(x => x != null);
    c.fraction = ns.length > 0 && ns.every(x => x >= -1 && x <= 1);
  }
  for (const g of groups) g.cells = g.rows.map(row => columns.map(c => formatCell(row[c.i], c.format, c.type, { fraction: c.fraction })));
  const notes = [...(spec.notes ? [spec.notes] : []), ...result.notes];
  const out = { spec, result, columns, groups, notes, grouped: gi >= 0, source: sourceLine(spec, s) };
  if (spec.kind === 'chart') out.chart = chartData(out);
  if (out.chart?.dropped?.length) notes.push(out.chart.droppedNote);
  if (out.chart?.addon && out.chart.droppedNote) notes.push(out.chart.droppedNote);   // an addon's note: what it could not read, and its art's credit, which goes wherever the figure goes
  return out;
}

// ---- charts --------------------------------------------------------------------
/** An addon's chart (lib/addons.mjs): drawn from its mapped columns, one value per row; what it could not read is its note. */
function addonDraw(m, ac, { width = 640, style = null } = {}) {
  const c = m.spec.chart, cols = m.result.columns, rows = m.result.rows;
  const field = name => { if (c[name] == null || ac.options.includes(name)) return null; const i = colIndex(cols, c[name]); return i < 0 ? null : rows.map(r => r[i]); };
  try { const out = ac.draw({ field, n: rows.length, title: m.spec.title, width, kit: kitFor(style), chart: c }); return typeof out === 'string' ? { svg: out, note: '' } : { svg: out?.svg || '', note: out?.note || '' }; }
  catch (err) { return { svg: '', note: `The ${ac.label} could not be drawn: ${String(err?.message || err).slice(0, 160)}` }; }
}
function chartData(m) {
  const { spec, result } = m, c = spec.chart, cols = result.columns;
  const ac = !CHART_TYPES.includes(c.type) && addonChart(c.type);
  if (ac) return { type: c.type, addon: true, rows: [], dropped: [], droppedNote: addonDraw(m, ac).note, units: result.rows.length };
  const at = ref => ref == null ? -1 : colIndex(cols, ref);
  const xi = at(c.x), si = at(c.series), loi = at(c.lo), hii = at(c.hi), vi = at(c.value);
  let yi = at(c.y);
  if (yi < 0 && ['bar', 'column', 'stacked'].includes(c.type)) yi = cols.findIndex((col, i) => i !== xi && col.type === 'number');
  const rows = [], dropped = [];
  const push = (r, extra) => rows.push({ row: r, ...extra });
  if (c.type === 'heat') {
    const cells = new Map();
    result.rows.forEach((row, r) => {
      const xs = [row[xi]].flat(), ys = [row[yi]].flat();
      for (const x of xs) for (const y of ys) {
        const k = `${norm(y)}\u0000${norm(x)}`, v = vi >= 0 ? toNumber(row[vi]) : 1;
        if (!cells.has(k)) cells.set(k, { x: isEmpty(x) ? NOT_REPORTED : String(x), y: isEmpty(y) ? NOT_REPORTED : String(y), value: 0, row: r });
        if (v != null) cells.get(k).value += v;
      }
    });
    return { type: 'heat', cells: [...cells.values()], dropped };
  }
  result.rows.forEach((row, r) => {
    const label = c.type === 'timeline' ? String(row[cols.findIndex((col, i) => i !== xi && i !== yi && col.type !== 'number')] ?? '') : formatCell(row[xi]);
    const groups = m.grouped ? [row[colIndex(cols, spec.groupRowsBy)]].flat().map(g => isEmpty(g) ? NOT_REPORTED : String(g)) : [null];
    if (c.type === 'timeline') {
      const v = toNumber(row[xi]);
      if (v == null) { dropped.push({ label, value: row[xi] }); return; }
      for (const s of (yi >= 0 ? [row[yi]].flat() : [''])) push(r, { label, value: v, series: yi >= 0 ? (isEmpty(s) ? NOT_REPORTED : String(s)) : '' });
      return;
    }
    const v = yi >= 0 ? toNumber(row[yi]) : null;
    if (v == null && c.type !== 'forest') { dropped.push({ label, value: yi >= 0 ? row[yi] : '' }); return; }
    const base = { label: label || NOT_REPORTED, value: v };
    if (c.type === 'forest') Object.assign(base, { lo: toNumber(row[loi]), hi: toNumber(row[hii]) });
    if (c.type === 'stacked') for (const sv of [row[si]].flat()) push(r, { ...base, series: isEmpty(sv) ? NOT_REPORTED : String(sv) });
    else for (const g of groups) push(r, { ...base, group: g });
  });
  const dir = c.sort || 'none';
  if (dir !== 'none') {
    const key = dir.endsWith('value') ? (x => x.value) : (x => x.label), sign = dir.startsWith('-') ? -1 : 1;
    // A row with no value goes last either way (and never gives NaN to the sort).
    const byValue = (a, b) => { const x = key(a), y = key(b); return x == null || y == null ? (x == null) - (y == null) : sign * (y - x); };
    const cmp = (a, b) => dir.endsWith('value') ? byValue(a, b) : sign * compareCells(key(a), key(b));
    if (m.grouped) {
      const order = [...new Set(rows.map(r => r.group))].sort((a, b) => compareCells(a, b));
      rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || cmp(a, b));
    } else rows.sort(cmp);
  } else if (m.grouped) {
    const order = [...new Set(rows.map(r => r.group))].sort((a, b) => (a === NOT_REPORTED) - (b === NOT_REPORTED) || compareCells(a, b));
    rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }
  const yName = cols[c.type === 'timeline' ? xi : yi]?.label || 'value';
  const droppedNote = dropped.length ? `${dropped.length} row${dropped.length === 1 ? '' : 's'} without a numeric ${yName} not drawn: ${dropped.slice(0, 6).map(d => `${d.label} (${String(d.value ?? '').replace(/\s+/g, ' ').slice(0, 24) || 'empty'})`).join('; ')}${dropped.length > 6 ? '; …' : ''}` : '';
  return { type: c.type, rows, dropped, droppedNote, units: c.type === 'stacked' ? new Set(rows.map(r => r.label)).size : unitsOf(rows, c.type === 'dot') };
}
function unitsOf(rows, byLabel) {
  let n = 0, prev = null;
  for (const r of rows) { const k = `${r.group}\u0000${r.label}`; if (!byLabel || k !== prev) n++; prev = k; }
  return n;
}

/**
 * The chart as SVG. `offset` and `page` draw one page of a row chart; the
 * export draws every row at a fixed width. With a `style` (figureTokens) the
 * house drawing: on screen at `width`, exported on its journal column with the
 * output's source line and notes under it (figureSource).
 */
export function chartSvg(m, { width = 640, offset = 0, page = null, style = null } = {}) {
  const c = m.spec.chart, d = m.chart, title = m.spec.title;
  const opts = { width, title, xLabel: c.xLabel || '', yLabel: c.yLabel || '', offset, page: page ?? Infinity };
  if (style) Object.assign(opts, { style, width: style.medium === 'screen' ? width : undefined, source: style.medium === 'export' ? figureSource(m) : [] });
  switch (d.type) {
    case 'bar': return barSvg(d.rows, { ...opts, xLabel: opts.xLabel || m.result.columns[colIndex(m.result.columns, c.y ?? '')]?.label || '' });
    case 'column': return columnSvg(d.rows, { ...opts, xLabel: opts.xLabel || c.x });
    case 'stacked': return stackedSvg(d.rows, opts);
    case 'dot': return dotSvg(d.rows, { ...opts, xLabel: opts.xLabel || c.y, ref: c.ref ?? null });
    case 'forest': return forestSvg(d.rows, { ...opts, log: !!c.log, ref: c.ref ?? null });
    case 'timeline': return timelineSvg(d.rows, { ...opts, xLabel: opts.xLabel || c.x });
    case 'heat': return heatSvg(d.cells, { ...opts, xLabel: opts.xLabel || c.x, yLabel: opts.yLabel || c.y });
  }
  const ac = d.addon && addonChart(d.type);
  return ac ? addonDraw(m, ac, { width: opts.width || width, style }).svg : '';
}

/** The text block under an exported figure: the output's source line, then its notes. The card's caption is the same line. */
export const figureSource = m => [m.source, ...(m.notes || [])].filter(Boolean);

// ---- files ------------------------------------------------------------------------
const csvCell = v => { const x = String(v ?? ''); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
const groupHead = m => m.spec.groupRowsBy ? [m.result.columns[colIndex(m.result.columns, m.spec.groupRowsBy)].label] : [];

/** Every row as text, the group first when the output is grouped. */
export function outputCsv(m) {
  const head = [...groupHead(m), ...m.columns.map(c => c.label)];
  const lines = [head, ...m.groups.flatMap(g => g.cells.map(r => [...(m.grouped ? [g.label] : []), ...r]))];
  return lines.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Where it came from, for the Notes sheet. No time stamp: an unchanged output writes identical files, and the folder writer keeps its version. */
function provenance(m, s) {
  const q = m.spec.query;
  return [['Title', m.spec.title], ['Kind', m.spec.kind === 'chart' ? `${m.spec.chart.type} chart` : 'table'], ['Source', m.source],
    ['Project', s?.project?.name || ''], ['Query', JSON.stringify(q)], ['Rows', m.result.total],
    ...m.notes.map((n, i) => [i ? '' : 'Notes', n])];
}

/** A workbook: one sheet per group (Table 1, Table 2, …) or one sheet, and a Notes sheet. */
export async function outputXlsx(m, s = null) {
  const head = m.columns.map(c => c.label);
  const rowsOf = g => g.rows.map(r => m.columns.map(c => sheetValue(r[c.i], c.format, c.type)));
  const sheets = m.grouped && m.groups.length > 1 && m.spec.kind === 'table'
    ? m.groups.map(g => ({ name: g.label, rows: [head, ...rowsOf(g)] }))
    : [{ name: m.spec.kind === 'chart' ? 'Data' : 'Table', rows: [[...groupHead(m), ...head], ...m.groups.flatMap(g => rowsOf(g).map(r => [...(m.grouped ? [g.label] : []), ...r]))] }];
  return writeXlsx([...sheets, { name: 'Notes', rows: [['Field', 'Value'], ...provenance(m, s)] }]);
}

/**
 * A Word document through the evidence-table writer (docx-write.mjs
 * writeTablesDocx): the title, one captioned table per group with its header
 * repeated on each page, the notes under them. More than five columns go on a
 * landscape page. Column widths follow the length of what they hold.
 */
export async function outputDocx(m) {
  const landscape = m.columns.length > 5;
  const page = landscape ? { w: 16838, h: 11906, margin: 567 } : { w: 11906, h: 16838, margin: 1134 };
  const usable = page.w - 2 * page.margin, size = landscape ? 8 : 9;
  const need = m.columns.map((c, i) => Math.min(48, Math.max(6, ...String(c.label).split(/\s+/).map(w => w.length), ...m.groups.flatMap(g => g.cells.map(r => String(r[i] ?? '').split('\n').reduce((a, l) => Math.max(a, l.length), 0))))));
  const total = need.reduce((a, b) => a + b, 0), widths = need.map(n => Math.floor(usable * n / total));
  const blocks = [{ type: 'para', text: m.spec.title, bold: true, size: size + 2, after: 6 }];
  for (const g of m.groups) {
    if (m.grouped) blocks.push({ type: 'para', text: g.label, bold: true, size, before: 10, after: 4 });
    blocks.push({ type: 'table', widths, header: m.columns.map(c => c.label), headerFill: 'F2F2F2', rows: g.cells.map(r => ({ cells: r.map(text => ({ text, span: 1 })) })) });
  }
  for (const n of m.notes) blocks.push({ type: 'para', text: n, size: size - 1, before: 6 });
  return writeTablesDocx({ blocks, font: 'Arial', size, page, landscape });
}

/** File names for an output: its title, without characters a file system refuses or a leading dot. */
export const outputStem = spec => String(spec.title || spec.id).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s~$]+/, '').trim().slice(0, 100) || 'Output';

/**
 * The output's files in the formats asked for (default: its exports), as the
 * folder writer takes them: `{ key: 'manuscript', stem, ext, data }`. PNG needs
 * a rasteriser (the app's svgToPng); without one it is skipped and named in `skipped`.
 */
export async function outputFiles(s, spec, formats = null, { svgToPng = null, style = figureTokens(null, { medium: 'export' }) } = {}) {
  const m = renderOutput(s, spec);
  const want = formats?.length ? formats : spec.exports?.length ? spec.exports : spec.kind === 'chart' ? ['svg', 'csv'] : ['xlsx', 'docx', 'csv'];
  const stem = outputStem(spec), files = [], skipped = [];
  for (const ext of want) {
    if (ext === 'csv') files.push({ ext, data: outputCsv(m) });
    else if (ext === 'xlsx') files.push({ ext, data: await outputXlsx(m, s) });
    else if (ext === 'docx' && spec.kind === 'table') files.push({ ext, data: await outputDocx(m) });
    else if (ext === 'svg' && spec.kind === 'chart') files.push({ ext, data: chartSvg(m, { style }) });
    else if (ext === 'png' && spec.kind === 'chart') { const png = svgToPng ? await svgToPng(chartSvg(m, { style })).catch(() => null) : null; if (png) files.push({ ext, data: png }); else skipped.push('png'); }
    else skipped.push(ext);
  }
  return { model: m, skipped, files: files.map(f => ({ key: 'manuscript', stem, label: spec.title, kind: 'outputs', ...f })) };
}

/** The output as text: each group's rows tab-separated, capped, with its notes. */
export function outputText(m, { maxChars = 12000, cell = 120 } = {}) {
  const clean = v => String(v ?? '').replace(/[\t\n\r]+/g, ' ').slice(0, cell);
  const out = [`${m.spec.title} | ${m.spec.kind === 'chart' ? `${m.spec.chart.type} chart` : 'table'} | ${m.source} | ${m.result.total} rows${m.grouped ? ` in ${m.groups.length} groups` : ''}`];
  let used = out[0].length, cut = false;
  for (const g of m.groups) {
    const lines = [...(m.grouped ? [`## ${g.label} (${g.rows.length})`] : []), m.columns.map(c => c.label).join('\t'), ...g.cells.map(r => r.map(clean).join('\t'))];
    for (const l of lines) { if (used + l.length + 1 > maxChars) { cut = true; break; } out.push(l); used += l.length + 1; }
    if (cut) break;
  }
  if (cut) out.push(`…cut at ${maxChars} characters; export the output for every row`);
  if (m.notes.length) out.push(`notes: ${m.notes.join(' | ')}`);
  return out.join('\n');
}

// ---- the table on screen -------------------------------------------------------------
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** A text cell longer than LONG_TEXT is long: it shows three lines and opens per row. A column whose cells are all SHORT_TEXT or
 *  less (a source, a date, a status) keeps them on one line. */
export const LONG_TEXT = 80, SHORT_TEXT = 24;
/**
 * How each column is drawn. A number sits right-aligned under its header and keeps its width. A text column whose cells
 * run past LONG_TEXT is long (three lines, opened per row); the longest of them grows into the width the other columns
 * leave, so a source, a date and a count keep their own width beside it instead of being spread across the pane. A long
 * column whose long cells are mostly database queries opens one concept to a line (queryLines). A short column keeps its cells
 * on one line; a column between the two keeps some width (16ch) beside a growing one rather than being cut to its longest word.
 *   [{ label, num, short, long, grow, query }]
 */
export function tableColumns(m) {
  const cols = m.columns.map((c, j) => {
    let max = 0, long = 0, queries = 0;
    for (const g of m.groups) for (const r of g.cells) {
      const v = String(r[j] ?? '');
      if (v.length > max) max = v.length;
      if (v.length > LONG_TEXT) { long++; if (looksLikeQuery(v)) queries++; }
    }
    const num = c.type === 'number';
    return { label: c.label, num, short: !num && max <= SHORT_TEXT, long: !num && max > LONG_TEXT, grow: false, query: !num && long > 0 && queries * 2 >= long, max };
  });
  const widest = cols.filter(c => c.long).sort((a, b) => b.max - a.max)[0];
  if (widest) widest.grow = true;
  return cols;
}
/** A header cell, and a body cell: a long one holds its text in a clamp, and a query's lines beside it for the open row. */
const kindOf = c => c.num ? 'num' : c.grow ? 'grow' : c.short ? 'out-short' : c.long ? '' : 'out-mid';
export const headCell = c => `<th scope="col"${kindOf(c) ? ` class="${kindOf(c)}"` : ''}>${escHtml(c.label)}</th>`;
export function bodyCell(c, v) {
  if (!c.long) return `<td${kindOf(c) ? ` class="${kindOf(c)}"` : ''}>${escHtml(v)}</td>`;
  const text = String(v ?? ''), lines = c.query && text.length > LONG_TEXT ? queryLines(text) : [];
  return `<td class="out-long${c.grow ? ' grow' : ''}"><div class="out-clamp">${escHtml(text)}</div>${lines.length > 1 ? `<div class="out-lines">${lines.map(l => `<span>${escHtml(l)}</span>`).join('')}</div>` : ''}</td>`;
}

// ---- previews ----------------------------------------------------------------------
/** A small preview for a proposal or a chat answer: the first rows of the first groups, or the chart's first page. */
export function previewHtml(m, { rows = 8, groups = 2, width = 420 } = {}) {
  const notes = m.notes.length ? `<p class="meta out-preview-note">${escHtml(m.notes.join(' · ').slice(0, 400))}</p>` : '';
  if (m.spec.kind === 'chart') return `<div class="chart-svg out-preview-chart">${chartSvg(m, { width, page: Math.max(rows, 12) })}</div>${notes}`;
  const cols = tableColumns(m);
  const body = m.groups.slice(0, groups).map(g => `${m.grouped ? `<p class="out-preview-cap">${escHtml(g.label)}</p>` : ''}<div class="out-table-wrap"><table class="out-table"><thead><tr>${cols.map(headCell).join('')}</tr></thead><tbody>${
    g.cells.slice(0, rows).map(r => `<tr>${r.map((v, i) => bodyCell(cols[i], v)).join('')}</tr>`).join('')}</tbody></table></div>${g.cells.length > rows ? `<p class="meta">${g.cells.length - rows} more rows</p>` : ''}`).join('');
  const more = m.groups.length > groups ? `<p class="meta">${m.groups.length - groups} more groups</p>` : '';
  return `${body}${more}${notes}`;
}
