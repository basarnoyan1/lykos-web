// Pasted HTML (from Word, a browser, another manuscript) as paragraphs.
//
// Keeps what a manuscript means by formatting — paragraphs, headings, list
// items and their level, alignment, and the emphasis of runs (bold, italic,
// underline, strikethrough, super- and subscript, small capitals) — and drops
// the rest: fonts and sizes (the paste takes the document's), colours, class
// soup, Word's conditional comments and its hidden list-marker spans. The
// input is a parsed document; only childNodes, nodeType, nodeName, data and
// getAttribute are used, so lib/xml.mjs can stand in for DOMParser in tests.

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TBODY', 'THEAD', 'UL', 'OL', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'META', 'TITLE', 'LINK', 'XML', 'O:P', 'TEMPLATE', 'NOSCRIPT', 'IMG', 'SVG']);
const nameOf = n => String(n.nodeName || '').toUpperCase();
const styleOf = n => String(n.getAttribute?.('style') || '').toLowerCase();
const JC = { center: 'center', right: 'right', justify: 'both', left: 'left' };

function emphasis(n, fmt) {
  const f = { ...fmt }, tag = nameOf(n), st = styleOf(n);
  if (tag === 'B' || tag === 'STRONG') f.b = true;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE') f.i = true;
  if (tag === 'U' || tag === 'INS') f.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.strike = true;
  if (tag === 'SUP') { f.sup = true; delete f.sub; }
  if (tag === 'SUB') { f.sub = true; delete f.sup; }
  const w = /font-weight:\s*([a-z0-9]+)/.exec(st)?.[1];
  if (w) f.b = w === 'bold' || w === 'bolder' || Number(w) >= 600;
  const it = /font-style:\s*([a-z]+)/.exec(st)?.[1];
  if (it) f.i = it === 'italic' || it === 'oblique';
  const deco = /text-decoration(?:-line)?:\s*([^;]+)/.exec(st)?.[1] || '';
  if (/underline/.test(deco)) f.u = true;
  if (/line-through/.test(deco)) f.strike = true;
  if (/text-decoration(?:-line)?:\s*none/.test(st)) { delete f.u; delete f.strike; }
  const va = /vertical-align:\s*([a-z]+)/.exec(st)?.[1];
  if (va === 'super') { f.sup = true; delete f.sub; } else if (va === 'sub') { f.sub = true; delete f.sup; }
  if (/font-variant:\s*small-caps/.test(st)) f.smallCaps = true;
  for (const k of Object.keys(f)) if (f[k] === false) delete f[k];
  return f;
}

/** Paragraphs `{ type, runs, props, list }` from a parsed HTML document or element. */
export function htmlToParagraphs(root) {
  const out = [];
  let cur = null;
  const open = (type = 'p', props = {}, list = null) => { cur = { type, runs: [], props, ...(list ? { list } : {}) }; };
  const close = () => {
    if (!cur) return;
    // Collapse the whitespace HTML collapses; keep line breaks.
    const runs = [];
    for (const r of cur.runs) { const l = runs.at(-1); if (l && JSON.stringify({ ...l, t: '' }) === JSON.stringify({ ...r, t: '' })) l.t += r.t; else runs.push({ ...r }); }
    if (runs.length) { runs[0].t = runs[0].t.replace(/^[ \t]+/, ''); runs.at(-1).t = runs.at(-1).t.replace(/[ \t]+$/, ''); }
    const kept = runs.filter(r => r.t);
    if (kept.length || cur.list) out.push({ ...cur, runs: kept });
    cur = null;
  };
  const text = (t, fmt, pre) => {
    if (!cur) open();
    const s = pre ? t : t.replace(/[\s ]+/g, m => m.includes(' ') && m.length === 1 ? ' ' : ' ');
    if (!s) return;
    const prev = cur.runs.at(-1)?.t || '';
    const v = !pre && (!cur.runs.length || /[ \n\t]$/.test(prev)) ? s.replace(/^ /, '') : s;
    if (v) cur.runs.push({ t: v, ...fmt });
  };
  const listDepth = [];
  const walk = (node, fmt, pre = false) => {
    for (const n of node.childNodes || []) {
      if (n.nodeType === 3) { text(n.data ?? n.textContent ?? '', fmt, pre); continue; }
      if (n.nodeType !== 1) continue;
      const tag = nameOf(n), st = styleOf(n);
      if (SKIP.has(tag) || /^(O|V|W|M):/.test(tag) || /mso-list:\s*ignore/.test(st) || /display:\s*none/.test(st)) continue;
      if (tag === 'BR') { if (!cur) open(); cur.runs.push({ t: '\n', ...fmt }); continue; }
      if (tag === 'UL' || tag === 'OL') { close(); listDepth.push(tag === 'UL' ? 'bullet' : 'number'); walk(n, fmt, pre); listDepth.pop(); close(); continue; }
      // A table arrives as a table: its grid, merged cells, header rows and widths.
      if (tag === 'TABLE') { close(); const t = tableOf(n); if (t) out.push(t); continue; }
      if (tag === 'TD' || tag === 'TH') { if (cur?.runs.length) cur.runs.push({ t: '\t' }); walk(n, fmt, pre); continue; }
      if (BLOCK.has(tag)) {
        close();
        const align = JC[/text-align:\s*([a-z]+)/.exec(st)?.[1] || String(n.getAttribute?.('align') || '').toLowerCase()];
        const cls = String(n.getAttribute?.('class') || '');
        let type = 'p', list = null;
        if (/^H[12]$/.test(tag)) type = 'h2';
        else if (/^H[3-6]$/.test(tag)) type = 'h3';
        else if (tag === 'BLOCKQUOTE' || /MsoQuote/i.test(cls)) type = 'quote';
        if (/MsoTitle/i.test(cls)) type = 'h1';
        if (tag === 'LI') list = { kind: listDepth.at(-1) || 'bullet', level: Math.max(0, listDepth.length - 1) };
        // Word's own list paragraphs: the level is in the style, the kind in the hidden marker.
        const mso = /mso-list:\s*l\d+\s+level(\d)/.exec(st);
        if (mso) {
          const marker = hiddenMarker(n);
          list = { kind: /^[\s ]*([0-9]+|[a-z]{1,4}|[ivxlc]+)[.)]/i.test(marker) ? 'number' : 'bullet', level: Number(mso[1]) - 1 };
        }
        if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') { walk(n, fmt, pre); close(); continue; }
        open(type, align ? { jc: align } : {}, list);
        walk(n, emphasis(n, fmt), pre || tag === 'PRE');
        close();
        continue;
      }
      walk(n, emphasis(n, fmt), pre);
    }
  };
  walk(root.body || root, {});
  close();
  // Consecutive empty paragraphs from a web page's spacing are not the author's.
  return out.filter((p, k) => p.type === 'table' || p.runs.length || p.list || (out[k - 1]?.runs?.length));
}

function hiddenMarker(n) {
  let s = '';
  const find = x => { for (const c of x.childNodes || []) { if (c.nodeType === 1 && /mso-list:\s*ignore/.test(styleOf(c))) { s += textOf(c); } else if (c.nodeType === 1) find(c); } };
  find(n);
  return s;
}
const textOf = n => n.nodeType === 3 ? (n.data ?? '') : [...(n.childNodes || [])].map(textOf).join('');

// ---- tables ------------------------------------------------------------------------

const elements = (n, names) => [...(n.childNodes || [])].filter(c => c.nodeType === 1 && names.includes(nameOf(c)));
/** A length in CSS or HTML units as points; a bare number is pixels. */
function points(v) {
  const m = /^\s*([\d.]+)\s*(pt|px|in|cm|mm)?\s*$/i.exec(String(v || ''));
  if (!m) return null;
  const n = Number(m[1]), u = (m[2] || 'px').toLowerCase();
  return u === 'pt' ? n : u === 'in' ? n * 72 : u === 'cm' ? n * 72 / 2.54 : u === 'mm' ? n * 72 / 25.4 : n * 0.75;
}
const widthOf = n => points(/(?:^|;)\s*width:\s*([^;]+)/i.exec(n.getAttribute?.('style') || '')?.[1]) ?? points(n.getAttribute?.('width'));

/**
 * A table element as a grid (the editor's model, lib/manuscript-doc.mjs):
 * one slot per column in every row, colspan and rowspan as merged slots,
 * rows in <thead> or of <th> cells as header rows, widths from <col> or the
 * first full row's cells. Cell text keeps its emphasis; its paragraphs are
 * lines.
 */
export function tableOf(table) {
  const rows = [];
  for (const part of [table, ...elements(table, ['THEAD', 'TBODY', 'TFOOT'])]) {
    for (const tr of elements(part, ['TR'])) rows.push({ tr, head: nameOf(part) === 'THEAD' });
  }
  if (!rows.length) return null;
  const grid = [], widths = [];
  rows.forEach(({ tr }, r) => {
    grid[r] ||= [];
    let c = 0;
    for (const td of elements(tr, ['TD', 'TH'])) {
      while (grid[r][c]) c++;
      const span = Math.max(1, Number(td.getAttribute?.('colspan')) || 1), down = Math.max(1, Number(td.getAttribute?.('rowspan')) || 1);
      const paras = htmlToParagraphs(td).filter(p => p.type !== 'table');
      const runs = [];
      paras.forEach((p, k) => { if (k) runs.push({ t: '\n' }); runs.push(...p.runs); });
      const cell = { runs: runs.length ? runs : [{ t: '' }], text: runs.map(x => x.t).join('') };
      const jc = paras[0]?.props?.jc || JC[/text-align:\s*([a-z]+)/.exec(styleOf(td))?.[1] || String(td.getAttribute?.('align') || '').toLowerCase()];
      if (jc) cell.props = { jc };
      if (span === 1 && widthOf(td) != null && widths[c] == null) widths[c] = widthOf(td);
      for (let d = 0; d < down; d++) for (let k = 0; k < span; k++) {
        (grid[r + d] ||= [])[c + k] = d === 0 && k === 0 ? cell : { merged: k ? 'left' : 'up' };
      }
      c += span;
    }
  });
  const cols = Math.max(...grid.map(r => r.length));
  const colEls = [...elements(table, ['COLGROUP']).flatMap(g => elements(g, ['COL'])), ...elements(table, ['COL'])];
  colEls.forEach((col, k) => { const w = widthOf(col); if (w != null && k < cols) widths[k] = w; });
  const known = widths.filter(w => w > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 468 / cols;
  const out = {
    cols: Array.from({ length: cols }, (_, k) => Math.round((widths[k] > 0 ? widths[k] : fallback) * 20) / 20),
    borders: 'all',
    rows: grid.map((cells, r) => {
      const tr = rows[r]?.tr;
      const ths = tr ? elements(tr, ['TD', 'TH']) : [];
      const header = rows[r]?.head || (ths.length > 0 && ths.every(x => nameOf(x) === 'TH'));
      return { ...(header ? { header: true } : {}), cells: Array.from({ length: cols }, (_, k) => cells[k] || { runs: [{ t: '' }], text: '' }) };
    }),
  };
  // A row that continues a merge has to be under it: an 'up' slot whose owner
  // is not above (a ragged table) becomes an empty cell.
  out.rows.forEach((row, r) => row.cells.forEach((c, k) => { if (c.merged === 'up' && !(r > 0 && out.rows[r - 1].cells[k])) row.cells[k] = { runs: [{ t: '' }], text: '' }; }));
  return { type: 'table', grid: out };
}

/**
 * Plain text copied from a spreadsheet: lines of tab-separated cells, every
 * line with the same number of tabs. Anything else is not a table.
 */
export function tsvTable(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length < 2) return null;
  const n = lines[0].split('\t').length;
  if (n < 2 || !lines.every(l => l.split('\t').length === n)) return null;
  return { type: 'table', grid: { cols: Array(n).fill(Math.round(468 / n * 20) / 20), borders: 'all',
    rows: lines.map(l => ({ cells: l.split('\t').map(t => ({ runs: [{ t }], text: t })) })) } };
}
