// The manuscript as a word processor sees it: paragraph properties, styles,
// lists, tables, captions, notes, tracked changes, find and replace, counts.
//
// Pure functions over the block model, so the editor, the Word reader and the
// Word writer agree on what a document means, and node --test can check each
// operation without a page. The view calls these and re-renders; nothing here
// touches the DOM. See plan §4.11a.
//
// Units are points throughout, as in docx.mjs. A paragraph block is
// `{ id, type, styleId, props, runs, text }`; `props` may carry:
//   jc                       left | center | right | both
//   before, after            space in points
//   line | lineExact | lineAtLeast   a multiple of single, or points
//   indLeft, indRight, indFirst, indHanging   points
//   pageBreakBefore, keepNext
//   list: { id, level }      a list paragraph; the list's levels are in doc.lists
//   section: {...}           this paragraph ends a section with that page setup
// A table block is `{ id, type: 'table', grid, text }`, a figure block
// `{ id, type: 'figure', img, name, mime, w, h }`, a contents block
// `{ id, type: 'toc' }`.
import { sourceOf, textOfRuns, sliceRuns, formatAt, CHAR_PROPS } from './manuscript-format.mjs';
import { newId, wordCount } from './manuscript.mjs';

// ---- styles ------------------------------------------------------------------

/**
 * The paragraph styles a manuscript started here has, and those an imported
 * one gains when they are applied: Word's own ids, so they map onto a journal
 * template's styles of the same name.
 */
export const DEFAULT_STYLES = {
  default: { run: { font: 'Times New Roman', sz: 12 }, para: { after: 0, line: 2 } },
  byId: {
    Normal: { name: 'Normal', run: {}, para: {} },
    Title: { name: 'Title', run: { b: true, sz: 16 }, para: { jc: 'center', after: 12, keepNext: true } },
    Heading1: { name: 'heading 1', run: { b: true, sz: 14 }, para: { before: 12, after: 6, keepNext: true, outline: 0 } },
    Heading2: { name: 'heading 2', run: { b: true, sz: 12 }, para: { before: 12, after: 6, keepNext: true, outline: 1 } },
    Heading3: { name: 'heading 3', run: { b: true, i: true, sz: 12 }, para: { before: 6, after: 6, keepNext: true, outline: 2 } },
    Abstract: { name: 'Abstract', run: {}, para: { jc: 'both' } },
    Caption: { name: 'caption', run: { b: true, sz: 10 }, para: { after: 6, line: 1 } },
    Quote: { name: 'Quote', run: { i: true }, para: { indLeft: 36, indRight: 36 } },
    Bibliography: { name: 'Bibliography', run: {}, para: { indLeft: 36, indHanging: 36, line: 1, after: 6 } },
    ListParagraph: { name: 'List Paragraph', run: {}, para: { indLeft: 36 } },
  },
};

/** Label shown for a style id; Word's lower-case built-in names read as the menu does. */
export const styleLabel = (id, st) => ({ Heading1: 'Heading 1', Heading2: 'Heading 2', Heading3: 'Heading 3', Bibliography: 'References', Caption: 'Caption' })[id]
  || (st?.name ? st.name.replace(/^./, c => c.toUpperCase()) : id);

// A block written before styles existed takes the style of its type.
const TYPE_STYLE = { h1: 'Title', h2: 'Heading1', h3: 'Heading2', quote: 'Quote', p: 'Normal' };
export const styleIdOf = b => b.styleId || TYPE_STYLE[b.type] || 'Normal';

/** The styles the page renders with: the document's own, or the defaults. */
export const effectiveStyles = d => d?.styles?.byId && Object.keys(d.styles.byId).length ? d.styles : DEFAULT_STYLES;

/** Paragraph styles to offer: those used, the usual built-ins, and the academic defaults. */
export function styleOptions(d) {
  const st = effectiveStyles(d);
  const used = new Set((d?.blocks || []).map(styleIdOf));
  const out = new Map();
  const add = (id, v) => { if (!out.has(id) && (v?.type || 'paragraph') === 'paragraph') out.set(id, { id, label: styleLabel(id, v) }); };
  for (const [id, v] of Object.entries(st.byId)) if (used.has(id) || /^(Normal|Title|Subtitle|Heading[1-3]|Abstract|Caption|Quote|Bibliography|BodyText|FirstParagraph)$/.test(id)) add(id, v);
  for (const [id, v] of Object.entries(DEFAULT_STYLES.byId)) if (id !== 'ListParagraph') add(id, st.byId[id] || v);
  const order = ['Normal', 'Title', 'Heading1', 'Heading2', 'Heading3', 'Abstract', 'Caption', 'Quote', 'Bibliography'];
  return [...out.values()].sort((a, b) => ((order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99)) || a.label.localeCompare(b.label));
}

/** The block type a style reads as, for the checks and the outline. */
export function typeForStyle(id, st) {
  const para = st?.para || {};
  if (/^Title$/i.test(id)) return 'h1';
  if (para.outline === 0 || para.outline === 1 || /^Heading[12]$/i.test(id)) return 'h2';
  if (para.outline === 2 || /^Heading[3-9]$/i.test(id)) return 'h3';
  if (/^(Quote|IntenseQuote|BlockText)$/i.test(id)) return 'quote';
  return 'p';
}

/** Apply a paragraph style to blocks; a style a document lacks is added from the defaults. */
export function applyStyle(d, ids, styleId) {
  const styles = d.styles?.byId ? d.styles : structuredClone(DEFAULT_STYLES);
  if (!styles.byId[styleId] && DEFAULT_STYLES.byId[styleId]) styles.byId[styleId] = structuredClone(DEFAULT_STYLES.byId[styleId]);
  const set = new Set(ids);
  const blocks = d.blocks.map(b => set.has(b.id) && isParagraph(b)
    ? { ...b, styleId, type: typeForStyle(styleId, styles.byId[styleId]), semanticHeading: undefined } : b);
  return { ...d, styles, blocks };
}

/**
 * Word's "Update style to match selection": the paragraph's own properties and
 * its first run's character formatting become the style's, and every
 * paragraph of that style loses the same direct formatting so it follows.
 */
export function updateStyleFromBlock(d, blockId) {
  const b = d.blocks.find(x => x.id === blockId);
  if (!b || !isParagraph(b)) return d;
  const id = styleIdOf(b);
  const styles = d.styles?.byId ? structuredClone(d.styles) : structuredClone(DEFAULT_STYLES);
  const st = styles.byId[id] || (styles.byId[id] = structuredClone(DEFAULT_STYLES.byId[id] || { name: id, run: {}, para: {} }));
  const { list, section, pageBreakBefore, ...para } = b.props || {};
  const run = charFormat(formatAt(b, 0));
  st.para = { ...st.para, ...para };
  st.run = { ...st.run, ...run };
  const paraKeys = Object.keys(para), runKeys = Object.keys(run);
  const blocks = d.blocks.map(x => {
    if (!isParagraph(x) || styleIdOf(x) !== id) return x;
    const props = { ...(x.props || {}) }; paraKeys.forEach(k => delete props[k]);
    const runs = (x.runs || []).map(r => { if (r.cite) return r; const y = { ...r }; runKeys.forEach(k => { if (y[k] === run[k]) delete y[k]; }); return y; });
    return { ...x, styleId: id, props, runs };
  });
  return { ...d, styles, blocks };
}

/** Change a style's own definition (the style dialog). `para`/`run` values of null remove the property. */
export function editStyle(d, id, { para = {}, run = {}, name } = {}) {
  const styles = d.styles?.byId ? structuredClone(d.styles) : structuredClone(DEFAULT_STYLES);
  const st = styles.byId[id] || (styles.byId[id] = structuredClone(DEFAULT_STYLES.byId[id] || { name: id, run: {}, para: {} }));
  const merge = (to, from) => { for (const [k, v] of Object.entries(from)) { if (v == null || v === '') delete to[k]; else to[k] = v; } };
  merge(st.para ||= {}, para); merge(st.run ||= {}, run);
  if (name) st.name = name;
  return { ...d, styles };
}

const CHAR_KEYS = ['font', 'sz', 'b', 'i', 'u', 'strike', 'caps', 'smallCaps', 'color', 'highlight'];
const charFormat = r => Object.fromEntries(CHAR_KEYS.filter(k => r?.[k] != null).map(k => [k, r[k]]));

// ---- paragraph properties ------------------------------------------------------

export const isParagraph = b => b && !['table', 'figure', 'toc', 'bib'].includes(b.type);

/** Line spacing choices, as Word offers them. */
export const LINE_SPACING = [
  { label: 'Single', props: { line: 1 } },
  { label: '1.15', props: { line: 1.15 } },
  { label: '1.5', props: { line: 1.5 } },
  { label: 'Double', props: { line: 2 } },
];

/** The ids from one block to another, in document order. */
export function idsBetween(blocks, fromId, toId) {
  let a = blocks.findIndex(b => b.id === fromId), z = blocks.findIndex(b => b.id === toId);
  if (a < 0) return []; if (z < 0) z = a; if (z < a) [a, z] = [z, a];
  return blocks.slice(a, z + 1).map(b => b.id);
}

/**
 * Set paragraph properties on blocks. A value of null removes the property,
 * so the style's value shows through again. Line spacing is one choice: a
 * multiple removes an exact or minimum value and the other way round; a first
 * line indent and a hanging indent exclude each other, as in Word.
 */
export function setParagraphProps(blocks, ids, patch) {
  const set = new Set(ids);
  return blocks.map(b => {
    if (!set.has(b.id) || !isParagraph(b)) return b;
    const props = { ...(b.props || {}) };
    if ('line' in patch || 'lineExact' in patch || 'lineAtLeast' in patch) { delete props.line; delete props.lineExact; delete props.lineAtLeast; }
    if (patch.indFirst != null) delete props.indHanging;
    if (patch.indHanging != null) delete props.indFirst;
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === false) delete props[k]; else props[k] = v; }
    return { ...b, props };
  });
}

/** Resolved paragraph properties: document defaults, then the style, then the paragraph. */
export function resolvedPara(b, styles) {
  const st = styles?.byId?.[styleIdOf(b)] || {};
  return { ...(styles?.default?.para || {}), ...(st.para || {}), ...(b.props || {}) };
}

/** Indent changed by a step, never below zero (Word's Increase/Decrease Indent). */
export function shiftIndent(blocks, ids, delta, styles, step = 36) {
  const set = new Set(ids);
  return blocks.map(b => {
    if (!set.has(b.id) || !isParagraph(b) || b.props?.list) return b;
    const cur = resolvedPara(b, styles).indLeft || 0;
    const next = Math.max(0, Math.round((cur + delta * step) / step) * step);
    return { ...b, props: { ...(b.props || {}), indLeft: next } };
  });
}

// ---- lists ------------------------------------------------------------------

const BULLETS = ['•', '◦', '▪'];
const DECIMAL = ['decimal', 'lowerLetter', 'lowerRoman'];
/** A list definition: nine levels, each with its format, text and indent. */
export function listDefinition(kind) {
  return { levels: Array.from({ length: 9 }, (_, l) => kind === 'bullet'
    ? { fmt: 'bullet', text: BULLETS[l % 3], start: 1, indLeft: 36 * (l + 1), indHanging: 18 }
    : { fmt: DECIMAL[l % 3], text: `%${l + 1}.`, start: 1, indLeft: 36 * (l + 1), indHanging: 18 }) };
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const roman = n => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
const letters = n => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
/** A number in a Word list format. */
export function formatNumber(n, fmt) {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    case 'none': return '';
    case 'bullet': return '';
    default: return String(n);
  }
}

/**
 * The marker each list paragraph shows, by document order: a counter per list
 * and level, deeper levels restarting when a shallower item appears. Level text
 * is Word's: "%1." for the first level's number, "%1.%2." for both.
 */
export function listMarkers(blocks, lists = {}) {
  const out = new Map(), counters = new Map();
  for (const b of blocks) {
    const li = b.props?.list;
    if (!li || !isParagraph(b)) continue;
    const def = lists[li.id] || listDefinition('decimal');
    const level = Math.max(0, Math.min(8, li.level || 0));
    const lv = def.levels?.[level] || listDefinition('decimal').levels[level];
    const c = counters.get(li.id) || []; counters.set(li.id, c);
    for (let k = 0; k < level; k++) if (!c[k]) c[k] = def.levels?.[k]?.start ?? 1;
    c[level] = c[level] ? c[level] + 1 : (lv.start ?? 1);
    c.length = level + 1;
    if (lv.fmt === 'bullet') { out.set(b.id, lv.text || '•'); continue; }
    out.set(b.id, String(lv.text ?? `%${level + 1}.`).replace(/%(\d)/g, (m, d) => {
      const k = Number(d) - 1;
      return formatNumber(c[k] ?? 1, def.levels?.[k]?.fmt || 'decimal');
    }));
  }
  return out;
}

export const newListId = () => `L${newId().slice(1)}`;
const kindOf = (lists, li) => lists?.[li?.id]?.levels?.[li?.level || 0]?.fmt === 'bullet' ? 'bullet' : 'number';

/**
 * Bullets or numbering on and off for paragraphs. Selected paragraphs that are
 * all already lists of that kind leave the list; otherwise they join the list
 * just above when it is the same kind, or start a new one.
 */
export function toggleList(d, ids, kind) {
  const lists = { ...(d.lists || {}) };
  const set = new Set(ids);
  const targets = d.blocks.filter(b => set.has(b.id) && isParagraph(b));
  if (!targets.length) return d;
  const off = targets.every(b => b.props?.list && kindOf(lists, b.props.list) === kind);
  let id = null;
  if (!off) {
    const first = d.blocks.indexOf(targets[0]);
    const prev = d.blocks[first - 1];
    if (prev?.props?.list && kindOf(lists, prev.props.list) === kind) id = prev.props.list.id;
    else { id = newListId(); lists[id] = listDefinition(kind === 'bullet' ? 'bullet' : 'decimal'); }
  }
  const blocks = d.blocks.map(b => {
    if (!set.has(b.id) || !isParagraph(b)) return b;
    const props = { ...(b.props || {}) };
    if (off) delete props.list; else props.list = { id, level: b.props?.list?.level || 0 };
    delete props.indLeft; delete props.indHanging; delete props.indFirst;
    return { ...b, props };
  });
  return { ...d, lists, blocks };
}

/** Tab and Shift+Tab in a list: one level deeper or shallower; out of the list below level 1. */
export function shiftListLevel(d, ids, delta) {
  const set = new Set(ids);
  return { ...d, blocks: d.blocks.map(b => {
    const li = b.props?.list;
    if (!set.has(b.id) || !li) return b;
    const level = (li.level || 0) + delta;
    const props = { ...b.props };
    if (level < 0) delete props.list; else props.list = { ...li, level: Math.min(8, level) };
    return { ...b, props };
  }) };
}

/** Restart numbering at a paragraph: it and the rest of its list become a new list counting from the start. */
export function restartNumbering(d, blockId) {
  const i = d.blocks.findIndex(b => b.id === blockId);
  const li = d.blocks[i]?.props?.list;
  if (!li) return d;
  const id = newListId();
  const lists = { ...(d.lists || {}), [id]: structuredClone(d.lists?.[li.id] || listDefinition('decimal')) };
  return { ...d, lists, blocks: d.blocks.map((b, k) => k >= i && b.props?.list?.id === li.id ? { ...b, props: { ...b.props, list: { ...b.props.list, id } } } : b) };
}

/** Continue numbering: the paragraph's list joins the nearest earlier list of the same kind. */
export function continueNumbering(d, blockId) {
  const i = d.blocks.findIndex(b => b.id === blockId);
  const li = d.blocks[i]?.props?.list;
  if (!li) return d;
  const kind = kindOf(d.lists, li);
  const prev = d.blocks.slice(0, i).reverse().find(b => b.props?.list && b.props.list.id !== li.id && kindOf(d.lists, b.props.list) === kind);
  if (!prev) return d;
  const to = prev.props.list.id;
  return { ...d, blocks: d.blocks.map(b => b.props?.list?.id === li.id ? { ...b, props: { ...b.props, list: { ...b.props.list, id: to } } } : b) };
}

// ---- find and replace --------------------------------------------------------------

// Tokens are masked so a search cannot match inside a citation key or a result name.
const maskTokens = t => String(t).replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, m => '\u0000'.repeat(m.length));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Places a query occurs, in paragraphs and table cells, as source offsets. */
export function findMatches(blocks, query, { caseSensitive = false, wholeWord = false } = {}) {
  if (!query) return [];
  const re = new RegExp(`${wholeWord ? '(?<![\\p{L}\\p{N}_])' : ''}${escapeRe(query)}${wholeWord ? '(?![\\p{L}\\p{N}_])' : ''}`, `gu${caseSensitive ? '' : 'i'}`);
  const out = [];
  const scan = (text, where) => { for (const m of maskTokens(text).matchAll(re)) if (m[0].length) out.push({ ...where, start: m.index, end: m.index + m[0].length }); };
  for (const b of blocks) {
    if (b.type === 'table') b.grid?.rows.forEach((row, r) => row.cells.forEach((c, k) => { if (!c.merged) scan(cellText(c), { id: b.id, cell: [r, k] }); }));
    else if (isParagraph(b)) scan(b.text || '', { id: b.id });
  }
  return out;
}

/** A run container ({ runs, text }) with a source range replaced by text in the formatting where it starts. */
export function replaceInRuns(box, start, end, text) {
  const runs = box.runs?.length ? box.runs : [{ t: box.text || '' }];
  const fmt = { ...formatAt({ runs }, start) }; delete fmt.t; delete fmt.cite; delete fmt.del;
  const out = [...sliceRuns({ runs }, 0, start), ...(text ? [{ ...fmt, t: text }] : []), ...sliceRuns({ runs }, end, Infinity)];
  const merged = [];
  for (const r of out) { const last = merged.at(-1); if (last && !last.cite && !r.cite && !last.del && !r.del && sameFormat(last, r)) last.t += r.t; else merged.push({ ...r }); }
  return { ...box, runs: merged.length ? merged : [{ t: '' }], text: textOfRuns(merged) };
}
const sameFormat = (a, b) => { const ka = Object.keys(a).filter(k => k !== 't'), kb = Object.keys(b).filter(k => k !== 't'); return ka.length === kb.length && ka.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k])); };

/** Replace the given matches (from findMatches), last first so earlier offsets hold. */
export function replaceMatches(blocks, matches, text) {
  const out = blocks.map(b => b.type === 'table' ? { ...b, grid: structuredClone(b.grid) } : b);
  const sorted = [...matches].sort((a, b) => a.id === b.id ? (String(b.cell) === String(a.cell) ? b.start - a.start : 0) : 0);
  const byBlock = new Map();
  for (const m of sorted) byBlock.set(m.id, [...(byBlock.get(m.id) || []), m]);
  return out.map(b => {
    const ms = byBlock.get(b.id);
    if (!ms) return b;
    if (b.type === 'table') {
      for (const m of ms.sort((x, y) => y.start - x.start)) {
        const [r, k] = m.cell; const c = b.grid.rows[r].cells[k];
        b.grid.rows[r].cells[k] = replaceInRuns(c, m.start, m.end, text);
      }
      return { ...b, text: tableText(b.grid) };
    }
    let x = b;
    for (const m of ms.sort((p, q) => q.start - p.start)) x = replaceInRuns(x, m.start, m.end, text);
    return x;
  });
}

// ---- tables --------------------------------------------------------------------------

// A grid has one slot per column in every row. A slot is a cell
// ({ runs, text, props?, shade?, valign? }) or { merged: 'left' } when the cell
// to its left spans it, or { merged: 'up' } when the cell above spans it.
const emptyCell = () => ({ runs: [{ t: '' }], text: '' });
export const cellText = c => c?.merged ? '' : c?.text ?? textOfRuns(c?.runs || []);

/** A new table: rows × columns across the text width, the first row a header. */
export function newTable(rows = 3, cols = 3, { width = 468, header = true, borders = 'all' } = {}) {
  const w = Math.round((width / cols) * 20) / 20;
  const grid = { cols: Array(cols).fill(w), borders, rows: Array.from({ length: rows }, (_, r) => ({ header: header && r === 0, cells: Array.from({ length: cols }, emptyCell) })) };
  return { id: newId(), type: 'table', grid, text: '' };
}

/** A table's plain text: cells by tabs, rows by lines, as the checks and search read it. */
export const tableText = grid => (grid?.rows || []).map(r => r.cells.filter(c => !c.merged).map(cellText).join('\t')).join('\n').trim();

/** How far a cell reaches: columns right, rows down. */
export function spanOf(grid, r, c) {
  const row = grid.rows[r].cells;
  let span = 1; while (row[c + span]?.merged === 'left') span++;
  let down = 1; while (grid.rows[r + down]?.cells[c]?.merged === 'up') down++;
  return { span, down };
}

/** The cell that owns a slot (itself, or the one spanning it). */
export function ownerOf(grid, r, c) {
  while (grid.rows[r]?.cells[c]?.merged === 'left' && c > 0) c--;
  while (grid.rows[r]?.cells[c]?.merged === 'up' && r > 0) r--;
  while (grid.rows[r]?.cells[c]?.merged === 'left' && c > 0) c--;
  return [r, c];
}

const clone = g => structuredClone(g);
const withGrid = (block, grid) => ({ ...block, grid, text: tableText(grid) });

// A slot a new row or column takes where it lands inside a merged cell: it joins the merge.
function joinedSlot(row, c) {
  const s = row?.cells[c];
  if (s?.merged === 'up') return { merged: 'up' };
  if (s?.merged === 'left') { let k = c; while (k > 0 && row.cells[k].merged === 'left') k--; return row.cells[k].merged === 'up' ? { merged: 'left' } : emptyCell(); }
  return emptyCell();
}

export function insertRow(block, r, below = true) {
  const g = clone(block.grid), at = below ? r + 1 : r;
  const cells = g.cols.map((_, c) => at < g.rows.length ? joinedSlot(g.rows[at], c) : emptyCell());
  g.rows.splice(at, 0, { cells });
  return withGrid(block, g);
}

export function deleteRow(block, r) {
  const g = clone(block.grid);
  if (g.rows.length <= 1) return null;
  const below = g.rows[r + 1];
  // A merge that starts here continues from the row below.
  g.rows[r].cells.forEach((c, k) => { if (!c.merged && below?.cells[k]?.merged === 'up') below.cells[k] = c; });
  g.rows.splice(r, 1);
  return withGrid(block, g);
}

export function insertColumn(block, r, c, right = true) {
  const g = clone(block.grid);
  const [or, oc] = ownerOf(g, r, c);
  const at = right ? oc + spanOf(g, or, oc).span : oc;
  const w = g.cols[Math.min(c, g.cols.length - 1)];
  const total = g.cols.reduce((a, b) => a + b, 0);
  g.cols.splice(at, 0, w);
  const scale = total / (total + w);
  g.cols = g.cols.map(x => Math.round(x * scale * 20) / 20);
  for (const row of g.rows) row.cells.splice(at, 0, row.cells[at]?.merged === 'left' ? { merged: 'left' } : emptyCell());
  return withGrid(block, g);
}

export function deleteColumn(block, c) {
  const g = clone(block.grid);
  if (g.cols.length <= 1) return null;
  for (const row of g.rows) {
    // A cell (or a merge's continuation) spanning to the right keeps its place.
    if (row.cells[c].merged !== 'left' && row.cells[c + 1]?.merged === 'left') row.cells[c + 1] = row.cells[c];
    row.cells.splice(c, 1);
  }
  const w = g.cols.splice(c, 1)[0], total = g.cols.reduce((a, b) => a + b, 0);
  g.cols = g.cols.map(x => Math.round((x + w * x / total) * 20) / 20);
  return withGrid(block, g);
}

/**
 * Merge a cell with what lies to its right (or below): the cells beside it
 * across its whole height (or width) join it, as long as none reaches beyond
 * that edge. The text of each is kept, a line apart.
 */
export function mergeCells(block, r, c, direction = 'right') {
  const g = clone(block.grid);
  [r, c] = ownerOf(g, r, c);
  const { span, down } = spanOf(g, r, c);
  const cell = g.rows[r].cells[c];
  const right = direction === 'right';
  const [r0, c0] = right ? [r, c + span] : [r + down, c];
  if (right ? c0 >= g.cols.length : r0 >= g.rows.length) return null;
  // The owners along the edge, and how far the merge reaches past it.
  const owners = [];
  let reach = 0;
  for (let k = 0; k < (right ? down : span); k++) {
    const [rr, cc] = ownerOf(g, right ? r + k : r0, right ? c0 : c + k);
    if (right ? cc !== c0 : rr !== r0) return null;
    if (!owners.some(([a, b]) => a === rr && b === cc)) owners.push([rr, cc]);
  }
  for (const [rr, cc] of owners) {
    const s2 = spanOf(g, rr, cc);
    if (right ? rr < r || rr + s2.down > r + down : cc < c || cc + s2.span > c + span) return null;
    reach = Math.max(reach, right ? s2.span : s2.down);
    if (owners.some(([a, b]) => a === rr && b === cc) && (right ? s2.span : s2.down) !== reach) return null;
  }
  for (const [rr, cc] of owners) joinText(cell, g.rows[rr].cells[cc]);
  if (right) { for (let d = 0; d < down; d++) for (let k = 0; k < reach; k++) g.rows[r + d].cells[c0 + k] = { merged: 'left' }; }
  else for (let d = 0; d < reach; d++) for (let k = 0; k < span; k++) g.rows[r0 + d].cells[c + k] = { merged: k ? 'left' : 'up' };
  return withGrid(block, g);
}
function joinText(cell, other) {
  if (!cellText(other)) return;
  const runs = [...(cell.runs || []), ...(cellText(cell) ? [{ t: '\n' }] : []), ...(other.runs || [])];
  cell.runs = runs.filter(x => x.cite || x.t); cell.text = textOfRuns(cell.runs);
}

/** Split a merged cell back into single cells. */
export function splitCell(block, r, c) {
  const g = clone(block.grid);
  [r, c] = ownerOf(g, r, c);
  const { span, down } = spanOf(g, r, c);
  if (span === 1 && down === 1) return null;
  for (let d = 0; d < down; d++) for (let k = 0; k < span; k++) if (d || k) g.rows[r + d].cells[c + k] = emptyCell();
  return withGrid(block, g);
}

export const setHeaderRow = (block, on) => { const g = clone(block.grid); g.rows[0].header = !!on; return withGrid(block, g); };
export const setBorders = (block, borders) => { const g = clone(block.grid); g.borders = borders; return withGrid(block, g); };
export const distributeColumns = block => {
  const g = clone(block.grid); const total = g.cols.reduce((a, b) => a + b, 0);
  g.cols = g.cols.map(() => Math.round(total / g.cols.length * 20) / 20);
  return withGrid(block, g);
};
export const setColumnWidths = (block, widths) => { const g = clone(block.grid); g.cols = g.cols.map((w, k) => Number(widths[k]) > 0 ? Number(widths[k]) : w); return withGrid(block, g); };

// ---- tracked table changes ----------------------------------------------------------
//
// While changes are tracked a table records what was done to it as Word does:
// text typed or deleted in a cell as insertion and deletion runs; a row
// inserted or deleted as a mark on the row (`row.ins`, `row.del`, written as
// w:trPr/w:ins and w:del); a column as a mark on each of its slots (`cellIns`,
// `cellDel`, written as w:tcPr/w:cellIns and w:cellDel). Nothing is removed
// until the change is accepted or rejected.

const liveFmt = r => { const { t, cite, ins, del, fmtChange, cm, ...f } = r || {}; return r?.cite ? {} : f; };

/** A tracked edit in one cell: [from, to) deleted, `text` inserted at `from` as `change`'s insertion. */
export function trackCellEdit(block, r, c, from, to, text, change) {
  const g = clone(block.grid);
  const cell = g.rows[r]?.cells[c];
  if (!cell || cell.merged) return block;
  let runs = cell.runs?.length ? cell.runs : [{ t: cell.text || '' }];
  if (to > from) runs = trackDeleteRuns(runs, from, to, change);
  if (text) {
    const box = { runs };
    const head = sliceRuns(box, 0, from), tail = sliceRuns(box, from, Infinity);
    // A deletion at the point stays before what replaces it, as Word shows it.
    while (tail[0]?.del) head.push(tail.shift());
    const fmt = liveFmt(from > 0 ? formatAt(box, from - 1) : formatAt(box, 0));
    const last = head.at(-1);
    if (last && !last.cite && !last.del && last.ins?.author === change.author && sameFormat(liveFmt(last), fmt)) head[head.length - 1] = { ...last, t: last.t + text };
    else head.push({ ...fmt, t: text, ins: { ...change } });
    runs = [...head, ...tail].filter(x => x.cite || x.t || x.del);
    if (!runs.length) runs = [{ t: '' }];
  }
  cell.runs = runs; cell.text = textOfRuns(runs);
  return withGrid(block, g);
}

/** A row inserted while tracking carries the insertion. */
export function trackInsertRow(block, r, below, change) {
  const next = insertRow(block, r, below);
  next.grid.rows[below ? r + 1 : r].ins = { ...change };
  return next;
}

/** A row deleted while tracking is marked, not removed; a row the same author inserted simply goes. */
export function trackDeleteRow(block, r, change) {
  const row = block.grid.rows[r];
  if (!row) return block;
  if (row.ins?.author === change.author) return deleteRow(block, r);
  if (row.del) return block;
  const g = clone(block.grid); g.rows[r].del = { ...change };
  return withGrid(block, g);
}

/** A column inserted while tracking: each of its slots carries the insertion. */
export function trackInsertColumn(block, r, c, right, change) {
  const [or, oc] = ownerOf(block.grid, r, c);
  const at = right ? oc + spanOf(block.grid, or, oc).span : oc;
  const next = insertColumn(block, r, c, right);
  next.grid.rows.forEach(row => { row.cells[at] = { ...row.cells[at], cellIns: { ...change } }; });
  return next;
}

/** A column deleted while tracking is marked on each slot; a column the same author inserted simply goes. */
export function trackDeleteColumn(block, c, change) {
  const slots = block.grid.rows.map(row => row.cells[c]);
  if (slots.every(x => x?.cellIns?.author === change.author)) return deleteColumn(block, c);
  const g = clone(block.grid);
  g.rows.forEach(row => { if (row.cells[c] && !row.cells[c].cellDel) row.cells[c] = { ...row.cells[c], cellDel: { ...change } }; });
  return withGrid(block, g);
}

/** Tracked column marks by column: { ins, del } for each column that has any. */
export function columnMarks(grid) {
  return (grid?.cols || []).map((_, k) => {
    const slots = grid.rows.map(row => row.cells[k] || {});
    const ins = slots.find(x => x.cellIns)?.cellIns || null, del = slots.find(x => x.cellDel)?.cellDel || null;
    return ins || del ? { ins, del } : null;
  });
}

/**
 * Decide a table's tracked changes: the text in its cells, its row marks and
 * its column marks. `only` ({ r, c }) limits the decision to one cell, its
 * row and its column. An accepted deletion or a rejected insertion removes
 * the row or column; returns null when that leaves no table.
 */
function decideTable(block, how, only = null) {
  const g = clone(block.grid);
  g.rows.forEach((row, r) => row.cells.forEach((c, k) => {
    if (only && (r !== only.r || k !== only.c)) return;
    if (!c.merged && c.runs) { c.runs = decided(c.runs, how); c.text = textOfRuns(c.runs); }
  }));
  let b = withGrid(block, g);
  const gone = m => m && (how === 'accept' ? !!m.del : !!m.ins);
  // Columns first, from the right, so earlier indices hold; then rows, from the bottom.
  const marks = columnMarks(b.grid);
  for (let k = marks.length - 1; k >= 0; k--) {
    if (!marks[k] || only && only.c !== k) continue;
    if (gone(marks[k])) { b = deleteColumn(b, k); if (!b) return null; continue; }
    const g2 = clone(b.grid);
    g2.rows.forEach(row => { const { cellIns, cellDel, ...x } = row.cells[k]; row.cells[k] = x; });
    b = withGrid(b, g2);
  }
  for (let r = b.grid.rows.length - 1; r >= 0; r--) {
    const row = b.grid.rows[r];
    if (!(row.ins || row.del) || only && only.r !== r) continue;
    if (gone(row)) { b = deleteRow(b, r); if (!b) return null; continue; }
    const g2 = clone(b.grid); delete g2.rows[r].ins; delete g2.rows[r].del;
    b = withGrid(b, g2);
  }
  return b;
}

/** Accept or reject the changes of one table cell: its text, its row and its column. */
export function decideInCell(blocks, id, r, c, how) {
  return blocks.flatMap(b => {
    if (b.id !== id || !b.grid) return [b];
    const t = decideTable(b, how, { r, c });
    return t ? [t] : [];
  });
}

// ---- tracked changes --------------------------------------------------------------

// A run can carry an insertion or deletion and a formatting change at once
// (text typed, then made bold): deciding it decides both.
const decided = (runs, keep) => runs.flatMap(r => {
  if (r.ins && keep === 'reject') return [];
  if (r.del && keep === 'accept') return [];
  const { ins, del, ...x } = r;
  if (!x.fmtChange) return [x];
  const { fmtChange, ...y } = x;
  if (keep === 'accept') return [y];
  // Rejected: the run's character formatting is what it was before the change.
  for (const k of CHAR_PROPS) delete y[k];
  return [{ ...y, ...(fmtChange.old || {}) }];
});

/**
 * Paragraph `i` and the paragraph after it as one: the text runs on, with the
 * first one's formatting; the section the second ended, the joined one ends.
 */
export function joinWithNext(blocks, i) {
  const a = blocks[i], z = blocks[i + 1];
  if (!isParagraph(a) || !isParagraph(z)) return blocks;
  const runs = [...(a.runs?.length ? a.runs : [{ t: a.text || '' }]), ...(z.runs?.length ? z.runs : [{ t: z.text || '' }])].filter((r, k, all) => r.cite || r.t || r.del || all.length === 1);
  const { markIns, markDel, section, ...props } = a.props || {};
  if (z.props?.section) props.section = z.props.section;
  if (z.props?.markIns) props.markIns = z.props.markIns;
  if (z.props?.markDel) props.markDel = z.props.markDel;
  return [...blocks.slice(0, i), { ...a, props, runs, text: textOfRuns(runs) }, ...blocks.slice(i + 2)];
}

/**
 * Removing the paragraph mark after block `id` while changes are tracked: the
 * author's own inserted mark simply goes and the paragraphs join (as in Word);
 * any other mark is kept, marked deleted, until the change is decided.
 */
export function trackJoin(blocks, id, change) {
  const i = blocks.findIndex(b => b.id === id);
  if (i < 0 || i >= blocks.length - 1 || !isParagraph(blocks[i]) || !isParagraph(blocks[i + 1])) return blocks;
  const p = blocks[i].props || {};
  if (p.markIns && p.markIns.author === change.author) return joinWithNext(blocks, i);
  if (p.markDel) return blocks;
  return blocks.map((b, k) => k === i ? { ...b, props: { ...p, markDel: { ...change } } } : b);
}

/** Decide the tracked paragraph marks of the paragraphs in `ids` (all when null), from the last up. */
function decideMarks(blocks, how, ids) {
  let out = blocks;
  for (let i = out.length - 1; i >= 0; i--) {
    const b = out[i], p = b.props || {};
    if (!(p.markIns || p.markDel) || ids && !ids.has(b.id)) continue;
    // An accepted deletion or a rejected insertion removes the mark: the paragraphs join.
    const join = how === 'accept' ? !!p.markDel : !!p.markIns;
    const { markIns, markDel, ...rest } = p;
    out = [...out.slice(0, i), { ...b, props: rest }, ...out.slice(i + 1)];
    if (join && i < out.length - 1) out = joinWithNext(out, i);
  }
  return out;
}

/**
 * Accept or reject tracked insertions and deletions. `range` limits the
 * decision to runs touching { start: { id, at }, end: { id, at } }; without it
 * every change in the document, table cells included, is decided. Tracked
 * paragraph marks in the range are decided too.
 */
export function decideChanges(blocks, how, range = null) {
  const inRange = range ? new Set(idsBetween(blocks, range.start.id, range.end.id)) : null;
  return decideMarks(decideRuns(blocks, how, range, inRange), how, inRange);
}
function decideRuns(blocks, how, range, inRange) {
  return blocks.flatMap(b => {
    if (inRange && !inRange.has(b.id)) return [b];
    // A table in the range, or every table, is decided whole: cells, rows and columns.
    if (b.type === 'table') {
      if (!b.grid) return [b];
      const t = decideTable(b, how);
      return t ? [t] : [];
    }
    return [decideBlockRuns(b, how, range)];
  });
}
function decideBlockRuns(b, how, range) {
  {
    if (!b.runs?.some(r => r.ins || r.del || r.fmtChange)) return b;
    let runs;
    if (!range) runs = decided(b.runs, how);
    else {
      const from = b.id === range.start.id ? range.start.at : 0, to = b.id === range.end.id ? range.end.at : Infinity;
      let at = 0; runs = [];
      for (const r of b.runs) {
        const len = sourceOf(r).length, s = at; at += len;
        const touches = len ? s < to && at > from : s >= from && s <= to;
        runs.push(...(touches ? decided([r], how) : [r]));
      }
    }
    runs = runs.length ? runs : [{ t: '' }];
    return { ...b, runs, text: textOfRuns(runs) };
  }
}

/** Tracked changes in the document: how many insertions and deletions, and by whom. */
export function changeSummary(blocks) {
  let ins = 0, del = 0; const authors = new Set();
  let fmt = 0, rows = 0, cols = 0;
  const look = rs => { let prev = null; for (const r of rs || []) { const k = r.ins ? 'ins' : r.del ? 'del' : r.fmtChange ? 'fmt' : null; if (k && k !== prev) { if (k === 'ins') ins++; else if (k === 'del') del++; else fmt++; authors.add((r.ins || r.del || r.fmtChange).author || ''); } prev = k; } };
  const mark = (m, count) => { if (!m) return 0; authors.add(m.author || ''); return count; };
  for (const b of blocks) {
    if (b.type === 'table') {
      b.grid?.rows.forEach(r => { r.cells.forEach(c => look(c.runs)); rows += mark(r.ins, 1) + mark(r.del, 1); });
      // A row or column inserted or deleted is one change each, as Word's review list has it.
      for (const m of columnMarks(b.grid)) if (m) cols += mark(m.ins, 1) + mark(m.del, 1);
    } else look(b.runs);
    // A tracked paragraph mark is a change of its own.
    if (b.props?.markIns) { ins++; authors.add(b.props.markIns.author || ''); }
    if (b.props?.markDel) { del++; authors.add(b.props.markDel.author || ''); }
  }
  return { ins, del, fmt, rows, cols, total: ins + del + fmt + rows + cols, authors: [...authors].filter(Boolean) };
}

// ---- captions, cross-references, notes, contents -------------------------------------------

const TOKEN = /\{\{([A-Za-z0-9._:-]+)\}\}/g;
/** Token keys the document itself resolves (numbering, notes, fields), not analysis results. */
export const isDocToken = key => /^(fn|seq|xref|cm|fig|tab):|^(page|pages)$/.test(key);

/**
 * Caption numbers in document order. `{{seq:Figure}}` is the next Figure
 * number, as Word's SEQ field is. Returns, per block, its numbers in token
 * order, and the label a cross-reference to that block reads as.
 */
export function captionNumbers(blocks) {
  const counters = new Map(), perBlock = new Map(), label = new Map();
  for (const b of blocks) {
    if (!isParagraph(b)) continue;
    for (const m of String(b.text || '').matchAll(TOKEN)) {
      if (!m[1].startsWith('seq:')) continue;
      const name = m[1].slice(4);
      const n = (counters.get(name) || 0) + 1; counters.set(name, n);
      perBlock.set(b.id, [...(perBlock.get(b.id) || []), n]);
      // a prefixed sequence (Table_S) reads as "Table S1"; Word's SEQ identifier stays Table_S
      if (!label.has(b.id)) { const p = /^(.+)_([A-Za-z]{1,3})$/.exec(name); label.set(b.id, p ? `${p[1]} ${p[2]}${n}` : `${name} ${n}`); }
    }
  }
  return { perBlock, label };
}

/** Captions a cross-reference can point to: block id, its label and its text. */
export const captionTargets = blocks => {
  const { label } = captionNumbers(blocks);
  return blocks.filter(b => label.has(b.id)).map(b => ({ id: b.id, label: label.get(b.id), text: String(b.text || '').replace(/\{\{[^}]*\}\}|\[@[^\]]*\]/g, '').trim() }));
};

/** Footnote and endnote numbers by first reference: footnotes 1, 2, 3; endnotes i, ii, iii. */
export function noteNumbers(blocks, notes = {}) {
  const out = new Map(); let fn = 0, en = 0;
  const visit = text => { for (const m of String(text || '').matchAll(TOKEN)) {
    if (!m[1].startsWith('fn:')) continue;
    const id = m[1].slice(3);
    if (out.has(id) || !notes[id]) continue;
    if (notes[id].kind === 'endnote') { en++; out.set(id, { n: en, kind: 'endnote', label: formatNumber(en, 'lowerRoman') }); }
    else { fn++; out.set(id, { n: fn, kind: 'footnote', label: String(fn) }); }
  } };
  for (const b of blocks) { if (b.type === 'table') b.grid?.rows.forEach(r => r.cells.forEach(c => visit(c.text))); else visit(b.text); }
  return out;
}

/** Headings for a table of contents: level 1 for Title-level headings, 2 and 3 below. */
export const tocEntries = blocks => blocks.filter(b => /^h[1-3]$/.test(b.type) && String(b.text || '').trim())
  .map(b => ({ id: b.id, level: b.type === 'h3' ? 2 : 1, text: String(b.text).replace(/\{\{[^}]*\}\}|\[@[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() }));

// ---- counts ---------------------------------------------------------------------------

const REFS = /^(references?|bibliography|literature cited|works cited)$/i;
const headingName = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '').replace(/^\s*(\d+(\.\d+)*[.)]?|[IVX]+[.)])\s+/, '').trim();
const chars = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '');

/**
 * Words and characters, as a journal counts them: the text without the
 * reference list (a heading named References or Bibliography, to the next
 * heading of its level), by section, with the references counted apart.
 */
export function documentCounts(blocks) {
  const out = { words: 0, chars: 0, charsNoSpaces: 0, references: 0, sections: [] };
  let cur = null, inRefs = false;
  for (const b of blocks) {
    const text = b.type === 'table' ? b.text : isParagraph(b) ? b.text : '';
    if (b.type === 'h2') {
      inRefs = REFS.test(headingName(b.text));
      cur = { name: headingName(b.text) || 'Untitled', words: 0, references: inRefs };
      out.sections.push(cur);
      if (inRefs) continue;
    }
    const w = wordCount(text);
    if (inRefs) { out.references += w; cur.words += w; continue; }
    out.words += w;
    const c = chars(text);
    out.chars += c.length; out.charsNoSpaces += c.replace(/\s/g, '').length;
    if (cur && b.type !== 'h2') cur.words += w;
  }
  return out;
}

// ---- recording changes -----------------------------------------------------------------

/**
 * A deletion while changes are tracked: text in the range becomes a tracked
 * deletion, except text the same author inserted while tracking, which simply
 * goes (as in Word). Citations and results in the range are removed outright.
 * `change` is { author, date }. Across paragraphs, the marks between them are
 * deleted too (trackJoin): recorded, or gone when the author inserted them.
 */
export function trackDelete(blocks, start, end, change) {
  const ids = idsBetween(blocks, start.id, end.id);
  let out = trackDeleteText(blocks, new Set(ids), start, end, change);
  // Every paragraph mark inside the range is deleted with it, from the last up.
  for (const id of ids.slice(0, -1).reverse()) out = trackJoin(out, id, change);
  return out;
}
function trackDeleteText(blocks, ids, start, end, change) {
  return blocks.map(b => {
    if (!ids.has(b.id) || !isParagraph(b)) return b;
    const from = b.id === start.id ? start.at : 0, to = b.id === end.id ? end.at : Infinity;
    if (to <= from) return b;
    const runs = trackDeleteRuns(b.runs?.length ? b.runs : [{ t: b.text || '' }], from, to, change);
    return { ...b, runs, text: textOfRuns(runs) };
  });
}

/**
 * A tracked deletion of the source range [from, to) in a run list (a
 * paragraph's, a table cell's): the text becomes a deletion by `change`,
 * except what the same author inserted, which simply goes; citations go.
 */
export function trackDeleteRuns(runs, from, to, change) {
  const out = [];
  let at = 0;
  for (const r of runs?.length ? runs : [{ t: '' }]) {
    const src = sourceOf(r), s = at; at += src.length;
    if (!src.length || at <= from || s >= to) { out.push(r); continue; }
    if (r.cite) continue;
    const lo = Math.max(0, from - s), hi = Math.min(src.length, to - s);
    if (lo) out.push({ ...r, t: src.slice(0, lo) });
    const mid = src.slice(lo, hi);
    // Only plain text runs reach here (tokens are text too; they go with it).
    if (!(r.ins && r.ins.author === change.author)) { const { ins, fmtChange, ...x } = r; out.push({ ...x, t: mid, del: { ...change } }); }
    if (hi < src.length) out.push({ ...r, t: src.slice(hi) });
  }
  const kept = out.filter(r => r.cite || r.t || r.del);
  return kept.length ? kept : [{ t: '' }];
}

// ---- comments -------------------------------------------------------------------------

/**
 * Comments attach to a span: the runs they cover carry the comment's id in
 * `cm`. A comment on no text (a point) is a `{{cm:id}}` token where it was
 * made. Replies are comments with a `parent`.
 */
export function markComment(blocks, start, end, id) {
  const ids = new Set(idsBetween(blocks, start.id, end.id));
  return blocks.map(b => {
    if (!ids.has(b.id) || !isParagraph(b)) return b;
    const from = b.id === start.id ? start.at : 0, to = b.id === end.id ? end.at : Infinity;
    const out = []; let at = 0;
    for (const r of b.runs?.length ? b.runs : [{ t: b.text || '' }]) {
      const src = sourceOf(r), s = at; at += src.length;
      const add = x => ({ ...x, cm: [...new Set([...(x.cm || []), id])] });
      if (!src.length) { out.push(s >= from && s < to ? add(r) : r); continue; }
      if (at <= from || s >= to) { out.push(r); continue; }
      if (r.cite) { out.push(add(r)); continue; }
      const lo = Math.max(0, from - s), hi = Math.min(src.length, to - s);
      if (lo) out.push({ ...r, t: src.slice(0, lo) });
      out.push(add({ ...r, t: src.slice(lo, hi) }));
      if (hi < src.length) out.push({ ...r, t: src.slice(hi) });
    }
    return { ...b, runs: out, text: textOfRuns(out) };
  });
}

/** Take a comment (and its replies' marks) out of the text. */
export function removeComment(blocks, id) {
  const strip = runs => (runs || []).map(r => {
    let x = r;
    if (r.cm?.includes(id)) { const cm = r.cm.filter(c => c !== id); x = { ...r }; if (cm.length) x.cm = cm; else delete x.cm; }
    if (x.t?.includes(`{{cm:${id}}}`)) x = { ...x, t: x.t.split(`{{cm:${id}}}`).join('') };
    return x;
  }).filter(r => r.cite || r.t || r.del);
  return blocks.map(b => {
    if (b.type === 'table' && b.grid) {
      const g = structuredClone(b.grid);
      g.rows.forEach(row => row.cells.forEach(c => { if (!c.merged && c.runs) { c.runs = strip(c.runs); c.text = textOfRuns(c.runs); } }));
      return { ...b, grid: g };
    }
    if (!b.runs?.some(r => r.cm || r.t?.includes('{{cm:'))) return b;
    const runs = strip(b.runs);
    return { ...b, runs: runs.length ? runs : [{ t: '' }], text: textOfRuns(runs) };
  });
}

/** Comments in document order: those anchored in the text, each with its replies after it. */
export function commentOrder(blocks, comments = {}) {
  const seen = [];
  const note = id => { if (comments[id] && !seen.includes(id)) seen.push(id); };
  const visit = runs => { for (const r of runs || []) { (r.cm || []).forEach(note); for (const m of String(r.t || '').matchAll(/\{\{cm:([A-Za-z0-9._-]+)\}\}/g)) note(m[1]); } };
  for (const b of blocks) { if (b.type === 'table') b.grid?.rows.forEach(r => r.cells.forEach(c => visit(c.runs))); else visit(b.runs); }
  const roots = seen.filter(id => !comments[id].parent || !comments[comments[id].parent]);
  return roots.map(id => ({ id, ...comments[id], replies: Object.entries(comments).filter(([, c]) => c.parent === id).map(([rid, c]) => ({ id: rid, ...c })) }));
}

// ---- headers and footers -------------------------------------------------------------------

/**
 * The header or footer a page shows, as Word chooses it: the section's first
 * page part when the section has a different first page, the even part on
 * even pages when the document has different odd and even pages, else the
 * default. A section without its own part uses the previous section's.
 * `kind` is 'header' or 'footer'; `sections` are in order; `k` is the page's
 * section; `first` whether it is that section's first page; `page` its number.
 */
export function headerFooterFor(sections, k, kind, { first = false, page = 1, evenOdd = false } = {}) {
  const variant = sections[k]?.titlePg && first ? 'First' : evenOdd && page % 2 === 0 ? 'Even' : '';
  for (let j = k; j >= 0; j--) {
    const s = sections[j] || {};
    const key = `${kind}${variant}`;
    if (key in s) return s[key] || null;
  }
  return null;
}
