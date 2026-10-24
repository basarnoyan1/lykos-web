// A table's footnotes (plan §2, "Submission files, structured"): the abbreviations, the general notes, and the marked notes whose mark the
// cells that carry it show. Stored on the package item: `notes` (the lines the build writes under the table, as before) and `marks`
// (`[{ mark, text, cells: [{ row, col }] }]`, a cell named by its row's first cell and its column's header, as lib/package-select.mjs names
// them). Marks run in the order their first cell is read (the header, then row by row, left to right), lettered, by symbol or by number as
// the package's conventions say (lib/package-cites.mjs). The build draws each mark in its cells (`markGrid`, called by lib/package-sources.mjs).
// Pure.

const SYMBOLS = ['*', '†', '‡', '§', '¶', '‖'];
/** The mark of the i-th marked note (from 0). */
export function markOf(i, kind = 'letters') {
  if (kind === 'numbers') return String(i + 1);
  if (kind === 'symbols') return SYMBOLS[i % SYMBOLS.length].repeat(Math.floor(i / SYMBOLS.length) + 1);
  let s = '', n = i;
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

const MARKED = /^(\*{1,3}|[†‡§¶‖]{1,2}|[a-z]{1,2})[.)]?\s+(\S.*)$/u;
const ABBREV = /^(?:Abbreviations?\s*[:.]\s*)(.+)$/i;
const PAIRS = /^[A-Z][A-Za-z0-9²\-–/]{0,11}(?:,|\s=|:)\s[^;]+(?:;\s*[A-Z][A-Za-z0-9²\-–/]{0,11}(?:,|\s=|:)\s[^;]+)+\.?$/;
/**
 * A table's notes read back into their parts: `{ abbreviations, abbrAt, general: [], marked: [{ text, cells }] }` (`abbrAt`: how many
 * general notes stood before the abbreviations, so they are written back where they were). A line that starts with a mark
 * ("a ", "* ", "†") is a marked note; the cells that carry it come from `marks` when it holds the same text. A line of "ABBR, words; …"
 * pairs, or one headed "Abbreviations:", holds the abbreviations.
 */
export function readNotes(notes = [], marks = []) {
  const out = { abbreviations: '', abbrAt: 0, general: [], marked: [] };
  for (const raw of notes || []) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const kept = (marks || []).find(m => line === `${m.mark} ${m.text}`);
    if (kept) { out.marked.push({ text: kept.text, cells: (kept.cells || []).map(c => ({ ...c })) }); continue; }
    const a = ABBREV.exec(line);
    if (!out.abbreviations && (a || PAIRS.test(line))) { out.abbreviations = line; out.abbrAt = out.general.length; continue; }
    const m = MARKED.exec(line);
    if (m && (m[1].length === 1 || !/^[a-z]+$/.test(m[1]) || m[1].length === 2 && m[1][0] === m[1][1]) && /^[\p{Lu}\d(“"']/u.test(m[2])) { out.marked.push({ text: m[2].trim(), cells: [] }); continue; }
    out.general.push(line);
  }
  return out;
}

// a cell named as lib/package-select.mjs names rows and columns: a column by its header's text, a row by its key or its first cell
const colKey = (grid, c) => String(grid?.rows?.[0]?.cells?.[c]?.text ?? '');
const rowKey = r => (r ? r.key || String(r.cells?.[0]?.text ?? '') : '');
/** Where a named cell is in a grid: `[r, c]` (the header is row 0), or null. */
export function cellAt(grid, { row, col }) {
  const rows = grid?.rows || [];
  const c = (rows[0]?.cells || []).findIndex((_, k) => colKey(grid, k) === col);
  if (c < 0) return null;
  const r = row === '' ? 0 : rows.findIndex((x, k) => k > 0 && rowKey(x) === row);
  return r < 0 ? null : [r, c];
}
/** The name of the cell at `[r, c]`. */
export const cellName = (grid, r, c) => ({ row: r === 0 ? '' : rowKey(grid.rows[r]), col: colKey(grid, c) });
/** Reading order of a named cell in a grid, or Infinity when the grid has no such cell. */
const readAt = (grid, cell) => { const at = grid ? cellAt(grid, cell) : null; return at ? at[0] * 10000 + at[1] : Infinity; };

/**
 * The footnotes written back: `{ notes, marks }`. The general notes with the abbreviations where they stood (first, for new ones), then the marked notes, each mark given in the
 * order its first cell is read (notes on no cell after them, in their order). A marked note with no text is dropped.
 */
/** The marked notes in the order their marks run: `[{ ...note, i }]` (`i` its place in `marked`); notes with no text left out unless `all`. */
export function markOrder(marked = [], { grid = null, all = false } = {}) {
  const live = marked.map((m, i) => ({ ...m, i, first: Math.min(Infinity, ...(m.cells || []).map(c => readAt(grid, c))) })).filter(m => all || String(m.text || '').trim());
  return live.sort((a, b) => a.first - b.first || a.i - b.i);
}
export function writeNotes({ abbreviations = '', abbrAt = 0, general = [], marked = [] } = {}, { kind = 'letters', grid = null } = {}) {
  const live = markOrder(marked, { grid });
  const marks = live.map((m, i) => ({ mark: markOf(i, kind), text: String(m.text).trim(), cells: (m.cells || []).map(c => ({ row: c.row, col: c.col })) }));
  const abbr = String(abbreviations || '').trim();
  // the abbreviations stay as written and where they stood among the general notes; a bare "n, number" is headed so it reads back as one
  const lines = general.map(g => String(g).trim()).filter(Boolean), at = Math.max(0, Math.min(abbrAt, lines.length));
  const head = abbr && !ABBREV.test(abbr) && !PAIRS.test(abbr) ? `Abbreviations: ${abbr}` : abbr;
  const notes = [...lines.slice(0, at), ...(abbr ? [head] : []), ...lines.slice(at), ...marks.map(m => `${m.mark} ${m.text}`)];
  return { notes, marks };
}

/** An item's notes and marks with its marks given again in another style (the order is kept). */
export function remark(item, kind) {
  const marks = item.marks || [];
  if (!marks.length) return { notes: item.notes || [], marks };
  const next = marks.map((m, i) => ({ ...m, mark: markOf(i, kind) }));
  const notes = (item.notes || []).map(line => { const j = marks.findIndex(m => line === `${m.mark} ${m.text}`); return j < 0 ? line : `${next[j].mark} ${next[j].text}`; });
  return { notes, marks: next };
}

/** The grid with each mark drawn in the cells that carry it, as a superscript run after the cell's text (several marks joined by commas). */
export function markGrid(grid, marks = []) {
  if (!grid?.rows || !marks?.length) return grid;
  const on = new Map();
  for (const m of marks) for (const cell of m.cells || []) {
    const at = cellAt(grid, cell);
    if (!at) continue;
    const k = at.join(',');
    if (!on.has(k)) on.set(k, []);
    if (!on.get(k).includes(m.mark)) on.get(k).push(m.mark);
  }
  if (!on.size) return grid;
  return { ...grid, rows: grid.rows.map((r, ri) => ({ ...r, cells: r.cells.map((c, ci) => {
    const ms = on.get(`${ri},${ci}`);
    if (!ms || c?.merged) return c;
    const text = String(c?.text ?? ''), mark = ms.join(',');
    return { ...c, text: `${text}${mark}`, runs: [...(c.runs?.length ? c.runs : [{ t: text }]), { t: mark, sup: true }] };
  }) })) };
}
