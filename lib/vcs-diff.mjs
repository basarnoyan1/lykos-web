// What changed inside one file between two versions, for History and the history command: the lines of a text file (numbered, the words that
// changed inside a changed line marked), the cells and rows of a workbook, the paragraphs of a Word document; an image is shown before and after;
// any other file only has a size.
//
// Pure apart from the readers it calls (lib/xlsx-read.mjs, lib/unzip.mjs, lib/docx.mjs loaded on first use); it names no file, sheet, column or
// project. `before` or `after` is null for a file that was added or deleted.
import { lineDiff } from './vcs.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { readText } from './unzip.mjs';

/** The text files a commit counts in lines (the same list as src-tauri/src/history.rs, so a count does not depend on which engine committed). */
export const TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'py', 'js', 'mjs', 'svg', 'html', 'css', 'tex', 'bib', 'ris', 'yaml', 'yml', 'xml', 'sh']);
/** The files compared line by line: the counted ones, and scripts and notes a review keeps (R, Quarto, Stata, SAS, logs). An SVG is a picture. */
export const DIFF_TEXT_EXT = new Set([...TEXT_EXT, 'r', 'rmd', 'qmd', 'rnw', 'do', 'sas', 'sps', 'stan', 'jl', 'm', 'log', 'ini', 'toml', 'cfg', 'ts', 'jsx', 'tsx', 'csl', 'nbib', 'enw', 'markdown', 'rst']);
DIFF_TEXT_EXT.delete('svg');
export const IMAGE_EXT = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['svg', 'image/svg+xml']]);
export const MAX_CELLS = 200;     // changed cells and rows listed per file
export const CONTEXT = 3;         // unchanged lines kept around a change
const WORDS_MAX = 2000;           // a line longer than this is not compared word by word
const PAIRS_MAX = 400;            // changed lines compared word by word per file
const ROWS_MAX = 5000;            // a sheet longer than this is compared cell by cell in place, not row by row
const dec = new TextDecoder();
export const extOf = path => { const b = path.slice(path.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const colName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

/** How a file is compared: 'text', 'sheet', 'document', 'image' or 'binary'. */
export function kindOf(path) {
  const ext = extOf(path);
  return DIFF_TEXT_EXT.has(ext) ? 'text' : ext === 'xlsx' ? 'sheet' : ext === 'docx' ? 'document' : IMAGE_EXT.has(ext) ? 'image' : 'binary';
}

// ---- words inside a changed line --------------------------------------------------------------------------------------------------------
const tokens = s => String(s).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
const merge = parts => parts.reduce((out, p) => { const last = out.at(-1); if (last && last.x === p.x) last.t += p.t; else out.push({ ...p }); return out; }, []);
/**
 * The words two versions of a line share and the words that changed: { before: [{ t, x }], after: [{ t, x }] }, x true for a changed run.
 * Null when the line is too long, or when so little is shared that marking words would mark nearly everything (the whole line changed).
 */
export function wordParts(a, b) {
  if (a.length > WORDS_MAX || b.length > WORDS_MAX) return null;
  const ops = lineDiff(tokens(a), tokens(b), 1200);
  if (!ops) return null;
  const before = [], after = [];
  let same = 0;
  for (const o of ops) {
    if (o.op === ' ') { before.push({ t: o.text, x: false }); after.push({ t: o.text, x: false }); if (o.text.trim()) same += o.text.length; }
    else (o.op === '-' ? before : after).push({ t: o.text, x: true });
  }
  if (same < 0.3 * Math.max(a.replace(/\s/g, '').length, b.replace(/\s/g, '').length)) return null;
  return { before: merge(before), after: merge(after) };
}

/** Numbers a diff's lines: `a` the line in the earlier version, `b` in the later one. */
function numbered(ops) {
  let a = 0, b = 0;
  return ops.map(l => (l.op === ' ' ? { ...l, a: ++a, b: ++b } : l.op === '-' ? { ...l, a: ++a } : { ...l, b: ++b }));
}
/** Marks the words that changed in each removed line followed by its added line (the runs are paired in order). */
function markWords(lines) {
  let pairs = 0;
  for (let i = 0; i < lines.length && pairs < PAIRS_MAX;) {
    if (lines[i].op !== '-') { i++; continue; }
    let j = i; while (j < lines.length && lines[j].op === '-') j++;
    let k = j; while (k < lines.length && lines[k].op === '+') k++;
    for (let n = 0; n < Math.min(j - i, k - j) && pairs < PAIRS_MAX; n++, pairs++) {
      const w = wordParts(lines[i + n].text, lines[j + n].text);
      if (w) { lines[i + n].parts = w.before; lines[j + n].parts = w.after; }
    }
    i = k;
  }
  return lines;
}

/**
 * Changed lines with `context` lines around each, the runs between them folded into one entry that keeps what it hides:
 * [{ op: ' ' | '+' | '-' | '~', ... } | { op: '…', text: 'N unchanged lines', n, hidden }].
 */
export function foldLines(lines, context = CONTEXT, noun = 'line') {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => { if (l.op !== ' ') for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true; });
  const out = []; let gap = [];
  const fold = () => { if (gap.length) out.push({ op: '…', text: `${gap.length} unchanged ${noun}${gap.length === 1 ? '' : 's'}`, n: gap.length, hidden: gap }); gap = []; };
  lines.forEach((l, i) => { if (keep[i]) { fold(); out.push(l); } else gap.push(l); });
  if (out.length) fold();
  return out;
}

// ---- documents -------------------------------------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const docxByPattern = async bytes => {   // the paragraphs read directly from document.xml, when the document reader cannot read the file
  const xml = await readText(bytes, 'word/document.xml');
  if (xml == null) throw new Error('not a document');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(p => [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => t[1]).join('').replace(/&(amp|lt|gt|quot|apos);/g, (m, n) => ENT[n])).filter(t => t.trim());
};
/** A Word document as the units a reader compares: each paragraph's text, and each table row as its cells joined by " | ". */
export async function docxUnits(bytes) {
  let blocks;
  try { blocks = (await (await import('./docx.mjs')).parseDocx(bytes)).blocks; } catch { return docxByPattern(bytes); }
  return blocks.flatMap(b => (b.type === 'table' ? (b.grid?.rows || []).map(r => (r.cells || []).map(c => String(c.text || '').trim()).join(' | ')) : [String(b.text || '')]))
    .map(t => t.replace(/\s+/g, ' ').trim()).filter(t => t && !/^(\|\s*)+$/.test(t));
}
/** Paragraph runs: a removed paragraph followed by an added one that shares its words is one changed paragraph ('~'), with the words marked. */
function pairParagraphs(lines) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].op !== '-') { out.push(lines[i++]); continue; }
    let j = i; while (j < lines.length && lines[j].op === '-') j++;
    let k = j; while (k < lines.length && lines[k].op === '+') k++;
    const gone = lines.slice(i, j), come = lines.slice(j, k), used = new Set();
    for (const g of gone) {
      let hit = -1, w = null;
      for (let n = 0; n < come.length && hit < 0; n++) { if (used.has(n)) continue; const p = wordParts(g.text, come[n].text); if (p) { hit = n; w = p; } }
      if (hit < 0) { out.push(g); continue; }
      used.add(hit);
      out.push({ op: '~', before: g.text, after: come[hit].text, a: g.a, b: come[hit].b, partsBefore: w.before, partsAfter: w.after });
    }
    come.forEach((c, n) => { if (!used.has(n)) out.push(c); });
    i = k;
  }
  return out;
}

// ---- workbooks -------------------------------------------------------------------------------------------------------------------------
const rowKey = row => JSON.stringify(trimRow(row));
const trimRow = row => { const r = (row || []).map(v => String(v ?? '')); while (r.length && r.at(-1) === '') r.pop(); return r; };
/**
 * One sheet against its earlier version: the rows matched as lines are (an inserted row is a row added, not every cell under it changed), a removed
 * row and an added row with the same first value paired as one row whose cells changed. Items in the sheet's order:
 * { type: 'cell', cell, head, before, after } | { type: 'row', op: '+' | '-', row, values }. `head` is the column's name from the first row.
 */
function sheetDiff(x, y, room) {
  const ra = x?.rows || [], rb = y?.rows || [], heads = trimRow(rb[0] || ra[0] || []);
  const items = [];
  let changed = 0, added = 0, removed = 0, cells = 0;   // cells: changed cells of matched rows; changed: those and the filled cells of added and removed rows
  const push = it => { if (room.left > 0) { items.push(it); room.left--; } else room.dropped++; };
  const cellsOf = (p, q, rowNo) => {
    const n = Math.max(p.length, q.length);
    for (let c = 0; c < n; c++) {
      const a = String(p[c] ?? ''), b = String(q[c] ?? '');
      if (a !== b) { cells++; changed++; push({ type: 'cell', cell: `${colName(c)}${rowNo}`, head: rowNo > 1 ? heads[c] || '' : '', before: a, after: b }); }
    }
  };
  const ops = ra.length <= ROWS_MAX && rb.length <= ROWS_MAX ? lineDiff(ra.map(rowKey), rb.map(rowKey), ROWS_MAX) : null;
  if (!ops) {   // too long to match: cell by cell in place
    for (let r = 0; r < Math.max(ra.length, rb.length); r++) cellsOf(trimRow(ra[r]), trimRow(rb[r]), r + 1);
    return { items, changed, cellsChanged: cells, added, removed };
  }
  let ia = 0, ib = 0;
  const rowOut = (op, row, no) => { const values = trimRow(row); if (!values.some(v => v !== '')) return; if (op === '+') added++; else removed++; changed += values.filter(v => v !== '').length; push({ type: 'row', op, row: no, values }); };
  for (let i = 0; i < ops.length;) {
    if (ops[i].op === ' ') { ia++; ib++; i++; continue; }
    let j = i; while (j < ops.length && ops[j].op === '-') j++;
    let k = j; while (k < ops.length && ops[k].op === '+') k++;
    const gone = [], come = [];
    for (let n = i; n < j; n++) gone.push({ row: ra[ia], no: ++ia });
    for (let n = j; n < k; n++) come.push({ row: rb[ib], no: ++ib });
    // pair a removed row with the added row that has its first value (its ID), else in order
    const used = new Set(), pairs = new Map();
    gone.forEach((g, gi) => { const id = String(g.row?.[0] ?? ''); const hit = id ? come.findIndex((c, ci) => !used.has(ci) && String(c.row?.[0] ?? '') === id) : -1; if (hit >= 0) { used.add(hit); pairs.set(gi, hit); } });
    const freeGone = gone.map((g, gi) => gi).filter(gi => !pairs.has(gi)), freeCome = come.map((c, ci) => ci).filter(ci => !used.has(ci));
    for (let n = 0; n < Math.min(freeGone.length, freeCome.length); n++) { pairs.set(freeGone[n], freeCome[n]); used.add(freeCome[n]); }
    const emitted = new Set();
    gone.forEach((g, gi) => {
      if (!pairs.has(gi)) { rowOut('-', g.row, g.no); return; }
      const ci = pairs.get(gi);
      for (let n = 0; n < ci; n++) if (!used.has(n) && !emitted.has(n)) { emitted.add(n); rowOut('+', come[n].row, come[n].no); }
      emitted.add(ci); cellsOf(trimRow(g.row), trimRow(come[ci].row), come[ci].no);
    });
    come.forEach((c, ci) => { if (!emitted.has(ci)) rowOut('+', c.row, c.no); });
    i = k;
  }
  return { items, changed, cellsChanged: cells, added, removed };
}

/**
 * { kind: 'text', lines, added, removed } (lines numbered and folded, `parts` on a changed line) | { kind: 'sheet', sheets: [{ name, status,
 * items, cells, changed, added, removed }], changed, truncated } | { kind: 'document', lines, added, removed, changed } | { kind: 'image', mime,
 * before, after } | { kind: 'binary', before, after } | { kind: 'too-long' }; sizes in bytes. A file that cannot be read says `unreadable`.
 */
export async function compareFiles(path, before, after, { maxCells = MAX_CELLS } = {}) {
  const kind = kindOf(path), size = b => (b ? b.length : 0);
  try {
    if (kind === 'text') {
      const ops = lineDiff(before ? dec.decode(before).split('\n') : [], after ? dec.decode(after).split('\n') : []);
      if (!ops) return { kind: 'too-long', before: size(before), after: size(after) };
      return { kind: 'text', lines: foldLines(markWords(numbered(ops))), added: ops.filter(l => l.op === '+').length, removed: ops.filter(l => l.op === '-').length };
    }
    if (kind === 'sheet') {
      const [a, b] = await Promise.all([before ? readXlsx(before) : { sheets: [] }, after ? readXlsx(after) : { sheets: [] }]);
      const names = [...new Set([...a.sheets.map(s => s.name), ...b.sheets.map(s => s.name)])], sheets = [], room = { left: maxCells, dropped: 0 };
      let total = 0;
      for (const name of names) {
        const x = a.sheets.find(s => s.name === name), y = b.sheets.find(s => s.name === name), d = sheetDiff(x, y, room);
        if (d.changed || !x || !y) sheets.push({ name, status: !x ? 'added' : !y ? 'removed' : 'changed', ...d, cells: d.items.filter(i => i.type === 'cell') });
        total += d.changed;
      }
      return { kind: 'sheet', sheets, changed: total, truncated: room.dropped > 0 };
    }
    if (kind === 'document') {
      const ops = lineDiff(before ? await docxUnits(before) : [], after ? await docxUnits(after) : []);
      if (!ops) return { kind: 'too-long', before: size(before), after: size(after) };
      const lines = pairParagraphs(numbered(ops));
      return { kind: 'document', lines: foldLines(lines, 1, 'paragraph'), added: ops.filter(l => l.op === '+').length, removed: ops.filter(l => l.op === '-').length, changed: lines.filter(l => l.op === '~').length };
    }
    if (kind === 'image') return { kind: 'image', mime: IMAGE_EXT.get(extOf(path)), before: size(before), after: size(after) };
  } catch (err) { return { kind: 'unreadable', message: String(err.message || err), before: size(before), after: size(after) }; }
  return { kind: 'binary', before: size(before), after: size(after) };
}

/** A comparison as plain text lines, for the history command and for logs. */
export function comparisonText(c) {
  const line = l => (l.op === '…' ? `  … ${l.text}` : l.op === '~' ? `- ${l.before}\n+ ${l.after}` : `${l.op} ${l.text}`);
  if (c.kind === 'text' || c.kind === 'document') return [`${c.added} added, ${c.removed} removed`, ...c.lines.map(line)].join('\n');
  const val = v => (v === '' ? '(empty)' : v);
  if (c.kind === 'sheet') return [`${c.changed} cell${c.changed === 1 ? '' : 's'} changed`, ...c.sheets.flatMap(s => [`${s.name}: ${s.status}${s.changed ? `, ${s.changed} cells` : ''}`,
    ...s.items.map(x => (x.type === 'cell' ? `  ${x.cell}: ${val(x.before)} → ${val(x.after)}` : `  ${x.op === '+' ? 'row added' : 'row removed'} ${x.row}: ${x.values.join(' | ')}`))]), ...(c.truncated ? ['  … more cells than listed'] : [])].join('\n');
  if (c.kind === 'binary' || c.kind === 'image') return `${c.kind === 'image' ? 'image' : 'binary file'}: ${c.before} → ${c.after} bytes`;
  if (c.kind === 'too-long') return 'too long to compare here';
  return `could not be compared: ${c.message || 'unreadable'}`;
}

/** What a commit records about a file's change: { a, r } lines (or paragraphs) added and removed, { c } cells changed, or null when it cannot be counted. */
export async function statOf(path, before, after) {
  if (TEXT_EXT.has(extOf(path))) {   // the counted text files, an SVG among them, in lines (as the shell counts them)
    const ops = lineDiff(before ? dec.decode(before).split('\n') : [], after ? dec.decode(after).split('\n') : []);
    return ops ? { a: ops.filter(l => l.op === '+').length, r: ops.filter(l => l.op === '-').length } : null;
  }
  const c = await compareFiles(path, before, after, { maxCells: 0 });
  if (c.kind === 'text' || c.kind === 'document') return { a: c.added, r: c.removed };
  if (c.kind === 'sheet') return { c: c.changed };
  return null;
}
