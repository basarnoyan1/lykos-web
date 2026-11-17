// The numbers of a registered manuscript and where each came from (views/manuscript-reader.mjs). A project's own build checks every number
// in its Word files against the sources it was built from and writes the check as a Markdown table (`| File | Number | Source | Context |`,
// "Number check v5.3.md", registered with tools/lykos-register.mjs --number-check). This reads that table back and finds each row's number
// in the document again, in the order the check wrote them, so the reader can show a number's source on the number itself; and it finds
// the line of the analysis results (results.md) a results number was read from. Pure: text in, rows and ranges out.

// The check's own normal form: a minus sign as a hyphen, a mid-line decimal point ("0·34") as a point, no thousands separators (the sham
// review's 07-check-numbers.mjs)
const NUM = /-?\d+(?:\.\d+)?/g;
// Labels a number check leaves out ("eTable 3", "Figure 2", "amendment 2", "S23", "e12"): blanked, at their length, before numbers and their
// context are read, so the reader's text lines up with the check's. A code of letters and digits is a label by itself ("S23", "R1",
// "AAV2", "sNN0031"): it takes no number after it, so "R1 0·51" keeps its 0·51 (15 Nov 2026: "[A-Z]\d" took the "0" and left ".51"); a
// name joined to its number by a hyphen is one name ("HDRS-28", "SF-36", "HAM-D-17", "AB-1005"); the level of an interval ("95% CI",
// "95% PI") and a version ("versions 8.0 and 8.1") are labels; so is the name of an appraisal tool wherever it stands ("RoB 2 algorithm",
// "QUADAS 2", "AMSTAR 2"), as lib/numbers.mjs reads it, not only before another number (work queue row 25). The project's build blanks the same.
export const LABEL = /\bversions?\s+\d+(?:\.\d+)*(?:\s*(?:,|and|to|–)\s*\d+(?:\.\d+)*)*|\b(?:80|90|95|99)\s?%(?=\s*(?:CI|PI|CrI|confidence|credible|prediction)\b)|\b(?:e?Tables?|e?Figures?|eMethods|eReferences?|Appendix|Panel|panel|domain|Domain|PRISMA 20\d\d|RoB 2|CR2|I²|amendment|item|Item|Class)\s*\d+(?:[–-]\d+)?(?:,\s*\d+)*|\b(?:RoB|QUADAS|AMSTAR)[\s-]*2\b(?![.·]\d)|\b[A-Za-z]+\d[A-Za-z\d]*\b(?![.·]\d)|\b[A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)*-\d+\b|\be\d+\b|\d+(?:st|nd|rd|th)\b/g;
const blank = t => t.replace(LABEL, m => ' '.repeat(m.length));
const letters = s => String(s || '').toLowerCase().replace(/[^\p{L}]+/gu, '');

/** Text in the check's normal form, with the place in the original text of each character: { text, at }. */
export function normalised(raw) {
  const s = String(raw || ''), out = [], at = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // "30,208" is 30208: a comma between groups of three digits is not text
    if (c === ',' && /\d/.test(s[i - 1] || '') && /^\d{3}(?!\d)/.test(s.slice(i + 1, i + 5))) continue;
    // "325 000 cells", "1 000 cells": a space between a group of two or three digits (or one before "000") and a group of three, before a
    // word, is a thousands separator ("weeks 4 120 days" is two numbers)
    if (c === ' ' && /^\d{3} [a-z]/.test(s.slice(i + 1, i + 6)) && (/(?<![\d.,/])\d{2,3}$/.test(s.slice(Math.max(0, i - 4), i)) || (/(?<![\d.,/])\d$/.test(s.slice(Math.max(0, i - 2), i)) && s.startsWith('000', i + 1)))) continue;
    // the journal's mid-line decimal point ("0·34", The Lancet's house style) is a decimal point, as the build's check reads it
    const mid = c === '·' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '');
    out.push(c === '−' ? '-' : mid ? '.' : c); at.push(i);
  }
  at.push(s.length);
  return { text: out.join(''), at };
}

/** The rows of a number check's table: [{ file, number, source, context }], in the order written. */
export function parseNumberCheck(md) {
  const rows = [];
  for (const line of String(md || '').split('\n')) {
    if (!line.startsWith('| ') || /^\|\s*-/.test(line)) continue;
    const cells = line.slice(1, line.trimEnd().endsWith('|') ? line.trimEnd().length - 1 : undefined).split(' | ').map(c => c.trim());
    if (cells.length < 4 || cells[0] === 'File') continue;
    const [file, number, source, ...rest] = cells;
    if (!/^-?\d+(?:\.\d+)?$/.test(number)) continue;
    rows.push({ file, number, source, context: rest.join(' | ') });
  }
  return rows;
}

// Each place a row's number stands in its context, as the letters before it and after it: [{ L, R }].
function sides(row) {
  const c = row.context, x = row.number, out = [];
  for (let p = c.indexOf(x); p >= 0; p = c.indexOf(x, p + 1)) {
    if (/\d/.test(c[p - 1] || '') || /\d/.test(c[p + x.length] || '') || (c[p + x.length] === '.' && /\d/.test(c[p + x.length + 1] || ''))) continue;
    out.push({ L: letters(c.slice(0, p)), R: letters(c.slice(p + x.length)) });
  }
  return out;
}
// A row agrees with the text around a number when the letters just before and just after it are the row's own: six before and four after,
// or all the row has on that side (a table's cells of numbers have few); or ten on one side, where the check left a label out of the other.
const agrees = (s, before, after) => s.some(({ L, R }) => {
  let l = 0; while (l < L.length && l < before.length && L[L.length - 1 - l] === before[before.length - 1 - l]) l++;
  let r = 0; while (r < R.length && r < after.length && R[r] === after[r]) r++;
  return (l >= Math.min(6, L.length) && r >= Math.min(4, R.length)) || l >= 10 || r >= 10;
});

/**
 * The numbers of one file's text with the rows of the check they match. `units` are the file's stretches of text in order (a paragraph, a
 * heading, or a table's cells joined by " | " as the check joins them); the answer is, per unit, [{ start, end, row }] in the unit's own
 * positions. A number matches a row of its value whose context agrees with the text around it; of those pairs the most that keep both
 * orders are taken (the rows were written in the order of the text), so a phrase repeated later in the file (a search strategy run
 * twice) does not take the earlier one's rows. A row the reader has no number for (a label the check left out) and a number the check
 * left out stay unmatched.
 */
export function linkNumbers(rows, file, units) {
  const mine = rows.filter(r => r.file === file), byValue = new Map();
  mine.forEach((r, j) => { if (!byValue.has(r.number)) byValue.set(r.number, []); byValue.get(r.number).push(j); });
  const sideOf = new Map(), side = j => { if (!sideOf.has(j)) sideOf.set(j, sides(mine[j])); return sideOf.get(j); };
  // every number of every unit, with the rows that could be its own
  const occ = [];
  units.forEach((raw, u) => {
    const { text: plain, at } = normalised(raw), text = blank(plain);
    for (const m of text.matchAll(NUM)) {
      const x = m[0], i = m.index, js = byValue.get(x);
      if (!js) continue;
      const before = letters(text.slice(Math.max(0, i - 45), i)), after = letters(text.slice(i + x.length, i + x.length + 25));
      const cand = js.filter(j => agrees(side(j), before, after));
      if (cand.length) occ.push({ u, start: at[i], end: at[i + x.length - 1] + 1, cand });
    }
  });
  // the longest chain increasing in both the text and the rows (Hunt–Szymanski: each number's rows taken from the last)
  const tails = [], tailAt = [], prev = new Map();
  occ.forEach((o, k) => {
    for (let c = o.cand.length - 1; c >= 0; c--) {
      const j = o.cand[c];
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < j) lo = mid + 1; else hi = mid; }
      tails[lo] = j; tailAt[lo] = [k, j];
      prev.set(`${k}:${j}`, lo ? tailAt[lo - 1] : null);
    }
  });
  const out = units.map(() => []);
  for (let link = tailAt[tails.length - 1]; link; link = prev.get(`${link[0]}:${link[1]}`)) {
    const o = occ[link[0]];
    out[o.u].unshift({ start: o.start, end: o.end, row: mine[link[1]] });
  }
  return out;
}

// a file of the project folder a source names: the source itself ("Analysis/Results/2026-11-14 (Lykos)/What changed.md") or the first path
// in its parentheses ("Pages of the appendix PDF (.lykos/cache/build/data/appendix-pages.json, 14-appendix-pages.mjs)"); a folder's name in
// a path may hold a parenthesis of its own ("Analysis/Results/2026-11-14 (Lykos)/R check.md: versions …")
const FILE_EXT = '(?:md|txt|json|csv)';
const WHOLE_FILE = new RegExp(`^(?:[^(),:;]|\\([^()]*\\))+\\.${FILE_EXT}$`, 'i');
const PAREN_FILE = new RegExp(`\\(\\s*((?:[^(),:;]|\\([^()]*\\))+?\\.${FILE_EXT})(?=[\\s,:;)]|$)`, 'i');
/** The file of the folder a source names, as written ("NOTES.md", ".lykos/cache/build/data/x.json"), or ''. */
export function namedFile(source) {
  const s = String(source || '').trim();
  if (WHOLE_FILE.test(s)) return s;
  return PAREN_FILE.exec(s)?.[1]?.trim() || '';
}

/**
 * What a row's source names: a Lykos output or a project dataset (by id), the analysis results, a part of the project's record, a section
 * of the project's store ("Lykos searches (state.searches: …)"), a file of the folder, or another source (which the check cannot read).
 */
export function sourceKind(source) {
  const s = String(source || '');
  const out = /^Lykos output ([\w-]+)/.exec(s);
  if (out) return { kind: 'output', id: out[1] };
  // a project dataset of the review's own store (s.datasets): "Lykos dataset dsrev11standard (…)"
  const ds = /^Lykos dataset ([\w-]+)/.exec(s);
  if (ds) return { kind: 'dataset', id: ds[1] };
  if (/^results\.md\b/.test(s) || /^Derived from results\.md/.test(s)) return { kind: 'results' };
  if (/Lykos record|project\.json|Full-text decision|PRISMA counts|Evidence table|Risk-of-bias record|Trial and risk-of-bias counts|Lykos query/i.test(s)) return { kind: 'record' };
  const sec = /\bstate\.([A-Za-z]\w*)\b/.exec(s);
  if (sec) return { kind: 'section', id: sec[1] };
  const file = namedFile(s);
  if (file) return { kind: 'file', path: file };
  return { kind: 'other' };
}

const numsOf = t => new Set([...normalised(t).text.matchAll(NUM)].map(m => m[0]));

// a line's numbers as values too ("0.001" holds the text's "0.0010", "12" its "12.0"), as a Lykos output's cells are read
export const valueKey = n => { const v = Number(n); return Number.isFinite(v) ? String(v) : String(n); };
const withValues = l => Object.assign(l, { vals: new Set([...l.nums].map(valueKey)) });
export const lineHolds = (l, n) => l.nums.has(n) || !!l.vals?.has(valueKey(n));
/** The analysis results (results.md) as lines with their section and numbers; a table's row reads with its header ("Code: S23; …"). */
export function resultsIndex(md) {
  const lines = [];
  let section = '', header = null;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) { section = line.replace(/^#+\s*/, ''); header = null; continue; }
    if (!line) { header = null; continue; }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      if (!header) { header = cells; continue; }
      lines.push(withValues({ section, text: cells.map((c, k) => (header[k] && k ? `${header[k]}: ${c}` : c)).join('; '), nums: numsOf(cells.join(' ')) }));
      continue;
    }
    header = null;
    const text = line.replace(/\*\*/g, '').replace(/^[-*]\s+/, '');
    lines.push(withValues({ section, text, nums: numsOf(text) }));
  }
  return lines;
}

/**
 * The results line a number was most likely read from: of the lines holding it, the one holding most of the numbers near it in the text
 * (`near`, the numbers of its sentence), the first on a tie. { section, text } or null.
 */
export function resultLine(index, number, near = []) {
  let best = null, score = -1;
  for (const l of index || []) {
    if (!lineHolds(l, number)) continue;
    let k = 0; for (const n of near) if (n !== number && lineHolds(l, n)) k++;
    if (k > score) { score = k; best = l; }
  }
  return best && { section: best.section, text: best.text.length > 240 ? `${best.text.slice(0, 239)}…` : best.text };
}

/** The numbers of the sentence (or table cell) around [start, end) of `raw`, in the check's normal form. */
export function nearNumbers(raw, start, end) {
  const s = String(raw || '');
  const from = Math.max(0, ...['. ', '; ', ' | '].map(t => { const i = s.lastIndexOf(t, start); return i < 0 ? 0 : i; }));
  const stops = ['. ', '; ', ' | '].map(t => s.indexOf(t, end)).filter(i => i >= 0);
  return [...numsOf(s.slice(from, stops.length ? Math.min(...stops) : s.length))];
}

const fileKey = p => String(p || '').replace(/ v\d+(?:\.\d+)?\.[a-z0-9]+$/i, '');
/**
 * The Lykos outputs a manuscript's tables and figures were made from, by their place in it ("Table 1", "eFigure 3"): the project build's
 * map (lykos-outputs.json: id -> { title, place, specVersion, fileVersion, renderedAt, files }), each with what changed after it was drawn
 * into the manuscript. `specs` is each output's definition version now (id -> n), `files` each output file's version now (its path
 * without " vN.ext" -> n, .lykos/outputs.json), `dataAfter(at)` what the review wrote after a time ({ changed, text }, lib/review-state.mjs
 * writtenAfter). Answers Map(place -> { id, title, place, stale, staleText }).
 */
export function manuscriptOutputs(map, { specs = new Map(), files = new Map(), dataAfter = () => null } = {}) {
  const out = new Map();
  for (const [id, o] of Object.entries(map || {})) {
    if (!o?.place) continue;
    const spec = specs.get(id), drawn = Math.max(0, ...Object.values(o.files || {}).map(f => files.get(fileKey(f?.path)) || 0)), data = o.renderedAt ? dataAfter(o.renderedAt) : null;
    const staleText = spec > (o.specVersion || 0) ? `Its definition changed after the manuscript was built (v${spec} now, v${o.specVersion} in the manuscript)`
      : drawn > (o.fileVersion || 0) ? `Drawn again after the manuscript was built (v${drawn} now, v${o.fileVersion} in the manuscript)`
      : data?.changed ? `Data changed after it was drawn: ${data.text}` : '';
    out.set(o.place, { id, title: o.title || id, place: o.place, stale: !!staleText, staleText });
  }
  return out;
}
