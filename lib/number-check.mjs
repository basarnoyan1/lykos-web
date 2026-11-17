// The number check as data (plan W9c; spec "Proven links, 2026-11-07 (W9c)"). Every number of a registered manuscript keeps its place in the
// file (section, paragraph and sentence, or a table's row and cell), the source the project's own check names for it, what that source is in
// Lykos (a line of the analysis results, an output of the recorded analysis run, a Lykos output's cell, value ids of the record) and a status.
// tools/lykos-register.mjs builds it from the build's Markdown check (lib/number-sources.mjs parseNumberCheck) and the Word files and writes
// `.lykos/number-check.json.gz` (gzip since 14 Nov 2026, design O2; a plain `.json` written before still reads); the Manuscript reader reads it back instead of matching the numbers again on every open. A number rests on the
// value ids its source names (a run's inputs, a record's values), so a value written after the build marks that number and no other.
// Pure: rows, blocks and records in; the check, its places and its stale numbers out.
import { linkNumbers, sourceKind, resultsIndex, nearNumbers, normalised, lineHolds } from './number-sources.mjs';
import { runHits } from './run-reads.mjs';
import { crossChecks } from './cross-checks.mjs';
import { numberVerdict } from './number-trace.mjs';

export const NUMBER_CHECK_KIND = 'lykos-number-check';
// v2 (7 Nov 2026): a run's entry also keeps `trials` and, for the run outputs its numbers name, the units each read (lib/run-reads.mjs), so a
// changed value marks the numbers of the outputs that read it; a v1 file's runs have neither and their numbers rest on the whole run.
export const NUMBER_CHECK_V = 2;
export const NUMBER_CHECK_FILE = '.lykos/number-check.json.gz';
/** A number's status: its source holds it; its source holds it in several places the numbers around it do not choose between; the check
 *  names no source, or the source named does not hold it; the number was not found in the file at its context. */
export const STATUSES = Object.freeze(['matched', 'ambiguous', 'unmatched', 'unplaced']);

const NUM = /-?\d+(?:\.\d+)?/g;
export const numsOf = t => new Set([...normalised(t).text.matchAll(NUM)].map(m => m[0]));
const NOT_FOUND = /^(not found|no source|unmatched|unknown|none)\b|^\s*[—–-]?\s*$/i;
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
/** The results line a row names ({ section, text }), or null. */
export const lineOfRow = (check, r) => (Number.isInteger(r?.source?.line) ? check?.lines?.[r.source.line] || null : null);

// ---- the text the check reads, as the reader reads it ------------------------------------------------------------------------------
const REFS = /^e?references$/i;
const CAPTION = /^(?:Supplementary\s+)?(e?(?:Table|Figure))\s+(S?\d+)\b/;
const isHeading = b => /^h[1-6]$/.test(b.type) || /^Heading\d$/i.test(b.styleId || '') || b.styleId === 'Title';
/** A run the check reads: a citation's number and a raised eReference number are not numbers of the text (the sham review's 07-check-numbers.mjs). */
export const counted = r => !r.cite && !(r.sup && /^e?[\d,–-]+$/.test(r.t || ''));
export const runsOf = b => (b.type === 'table' ? (b.grid?.rows || []).flatMap(r => (r.cells || []).flatMap(c => c.runs || [])) : (b.runs || []));

// where each counted run of a table starts in the table's text (runs joined by " | "), with its row and its cell's place in the row
function cellStarts(b) {
  const out = [];
  let at = 0, first = true;
  (b.grid?.rows || []).forEach((r, row) => (r.cells || []).forEach((c, col) => {
    for (const run of c.runs || []) {
      if (!counted(run)) continue;
      if (!first) at += 3;
      first = false;
      out.push({ at, row, col });
      at += (run.t || '').length;
    }
  }));
  return out;
}
const cellAt = (cells, at) => { let hit = null; for (const c of cells) { if (c.at > at) break; hit = c; } return hit ? { row: hit.row, col: hit.col } : null; };
// the sentence a place is in, counted by its full stops (a stop followed by a space and a capital or an opening bracket)
const sentenceAt = (t, at) => { let n = 1; for (const _ of t.slice(0, at).matchAll(/[.!?](?=\s+[A-Z(“"])/g)) n++; return n; };

/**
 * The stretches of a Word file the number check reads, in order: every block outside the reference list (a heading, a paragraph, a caption,
 * a table's runs joined by " | "). [{ i (the block), t (its text), section (the heading above), paragraph (its place under that heading, 0 for
 * a heading or a table), part (the table or figure a caption or table belongs to, else the section), cells (a table's runs' cells) }].
 * lib/docx-reading.mjs reads the same stretches, so a place found here lands on the reader's own characters.
 */
export function checkedUnits(blocks) {
  const out = [];
  let inRefs = false, section = '', paragraph = 0, caption = '';
  (blocks || []).forEach((b, i) => {
    if (b.type === 'bib') return;
    const t = runsOf(b).filter(counted).map(r => r.t || '').join(b.type === 'table' ? ' | ' : '');
    const h = isHeading(b);
    if (h && REFS.test(t.trim())) { inRefs = true; return; }
    if (inRefs && h) inRefs = false;
    if (inRefs) return;
    const table = b.type === 'table', cap = !h && !table ? CAPTION.exec(t.trim()) : null;
    if (h) { section = b.styleId === 'Title' ? 'Title page' : t.trim().slice(0, 120); paragraph = 0; caption = ''; } else if (!table) paragraph++;
    if (cap) caption = `${cap[1]} ${cap[2]}`;
    const u = { i, t, section, paragraph: h || table ? 0 : paragraph, part: (cap || table) && caption ? caption : section };
    // a table's cells as text, row by row (lib/cross-checks.mjs reads its totals and its summary of findings)
    if (table) { u.cells = cellStarts(b); u.grid = (b.grid?.rows || []).map(r => (r.cells || []).map(c => (c.runs || []).filter(counted).map(x => x.t || '').join(''))); u.rows = u.grid.map(r => r.join(' / ')); caption = ''; }
    out.push(u);
  });
  return out;
}

/** Each row's place in the files: Map(row -> { place, near }). `docs` [{ name (as the check names the file), blocks }]. */
export function placeRows(rows, docs, unitsOf = null) {
  const placed = new Map();
  docs.forEach((d, f) => {
    if (!d.blocks) return;
    const units = unitsOf?.[f] || checkedUnits(d.blocks), found = linkNumbers(rows, d.name, units.map(u => u.t));
    units.forEach((u, k) => {
      for (const g of found[k]) {
        const place = { file: f, block: u.i, at: g.start, len: g.end - g.start, section: u.section, part: u.part };
        if (u.cells) place.cell = cellAt(u.cells, g.start); else { place.paragraph = u.paragraph; place.sentence = sentenceAt(u.t, g.start); }
        // a table's row names its study in a cell the check's context may not reach
        placed.set(g.row, { place, near: nearNumbers(u.t, g.start, g.end), around: place.cell ? u.rows?.[place.cell.row] || '' : '' });
      }
    });
  });
  return placed;
}

// ---- what a source is in Lykos ------------------------------------------------------------------------------------------------------
/** The lines of the analysis results (resultsIndex) holding a number, those holding most of the numbers near it: { lines, score }. */
export function resultCandidates(index, number, near = []) {
  let lines = [], score = -1;
  for (const l of index || []) {
    if (!lineHolds(l, number)) continue;
    let k = 0; for (const n of near) if (n !== number && lineHolds(l, n)) k++;
    if (k > score) { score = k; lines = [l]; } else if (k === score) lines.push(l);
  }
  return { lines, score };
}
const runNums = new WeakMap();
/** The outputs of a recorded run (lib/analysis-run.mjs) whose printed numbers hold `number`, those holding most of the numbers near it. */
export function runOutputFor(run, number, near = []) {
  let best = [], score = -1;
  for (const o of run?.outputs || []) {
    let set = runNums.get(o);
    if (!set) runNums.set(o, (set = new Set(o.nums || [])));
    if (!set.has(number)) continue;
    let k = 0; for (const n of near) if (n !== number && set.has(n)) k++;
    if (k > score) { score = k; best = [o]; } else if (k === score) best.push(o);
  }
  return best;
}
/** The record's values by the numbers they hold: Map(number -> [{ key, pid }]); `labels` Map(record id -> label) names the review's studies. */
export function valueIndex(values, labels) {
  const by = new Map();
  for (const [key, v] of Object.entries(values || {})) {
    const pid = key.slice(0, key.indexOf(':'));
    if (!labels.has(pid) || !v) continue;
    const nums = numsOf(String(v.reported_value ?? ''));
    if (typeof v.normalized_value === 'number' && Number.isFinite(v.normalized_value)) nums.add(String(v.normalized_value));
    for (const n of nums) { if (!by.has(n)) by.set(n, []); by.get(n).push({ key, pid }); }
  }
  return by;
}
// the value ids a record row names: the values holding its number, of the studies its source, its context or its table row names (at most
// 8, else none)
function recordValues(row, values, around = '') {
  const hits = values.index.get(row.number);
  if (!hits) return [];
  const text = `${row.source} ${row.context} ${around}`, named = new Set();
  for (const [pid, label] of values.labels) if (label && text.includes(label)) named.add(pid);
  const ids = hits.filter(h => named.has(h.pid)).map(h => h.key);
  return ids.length <= 8 ? ids.sort() : [];
}

// a number as a value, so "9.70" in a cell is the text's "9.7" and "2,821" its "2821"
const valueOf = n => { const v = Number(normalised(String(n)).text); return Number.isFinite(v) ? String(v) : ''; };
/** The numbers of a Lykos output's cells (rows of cell texts), or of any texts, as values: Set. */
export function cellValues(rows) {
  const out = new Set();
  for (const r of rows || []) for (const c of r || []) for (const n of numsOf(String(c ?? ''))) out.add(valueOf(n));
  return out;
}
/**
 * The project's datasets (s.datasets: [{ id, rows: [{ column: value }], note }]) by id, each as the values of its rows and of its note:
 * Map(id -> { rows: [Set], all: Set }). A row's values are its cells' numbers ("0.31 (0.21 to 0.42)" gives three), so an estimate with
 * its interval is found whole in one row.
 */
export function datasetValues(list) {
  const out = new Map();
  for (const d of list || []) {
    if (!d?.id) continue;
    const rows = (Array.isArray(d.rows) ? d.rows : []).map(r => cellValues([Object.values(r || {})]));
    const all = new Set([...rows.flatMap(x => [...x]), ...cellValues([[d.note]])]);
    out.set(d.id, { rows, all });
  }
  return out;
}
const dec = s => (String(s).split('.')[1] || '').length;
// a source holds a number when it prints it, or, for a decimal, prints it with more decimals that round to it (4.425 for 4.43)
const holds = (set, number) => set.has(valueOf(number)) || (dec(number) > 0 && numberVerdict(number, [...set].filter(x => dec(x) > dec(number))).verdict === 'rounding');
const outputSets = new WeakMap();
// A number whose source is a Lykos output or the record counts as matched only when that source holds it (Fable review, 15 Nov 2026: the
// Sham check said "0 unmatched" while it took both kinds on the build's word). `cells(id)` draws an output's cells (null when it cannot be
// drawn); `recordNumbers(text)` the values the record source a row names holds (the app's flow and counts, the build's data file it
// names), null when the caller read none.
/** The limits an output spec's chart is drawn to, as numbers: its xMin, xMax, yMin and yMax that are set. [] for a table. */
export function axisValues(spec) {
  const c = spec?.chart;
  return c && typeof c === 'object' ? ['xMin', 'xMax', 'yMin', 'yMax'].map(k => c[k]).filter(v => typeof v === 'number' && Number.isFinite(v)) : [];
}
// `axes(id)` the limits an output's chart is drawn to (its spec's xMin, xMax, yMin, yMax: axisValues), which a legend states ("The axis runs
// from −4 to 4") and no cell prints
function outputHolds(id, number, cells, axes) {
  if (!cells) return { ok: false, why: 'the output was not drawn for the check' };
  let set = outputSets.get(cells)?.get(id);
  if (set === undefined) {
    const rows = cells(id);
    set = rows ? cellValues(rows) : null;
    if (set) for (const a of axes?.(id) || []) set.add(valueOf(String(a)));
    if (!outputSets.has(cells)) outputSets.set(cells, new Map());
    outputSets.get(cells).set(id, set);
  }
  if (!set) return { ok: false, why: `Lykos output ${id} could not be drawn` };
  return holds(set, number) ? { ok: true } : { ok: false, why: `Lykos output ${id} does not print ${number}` };
}

// A source may state, for its one number, the signed value the sentence's words stand for: "...; read as the signed value -3.3" ("worsens by 3.3"
// against the source's "-3.3 to 11.1"; work queue row 25, decided 15 Nov 2026 as an explicit binding, not a sign match). Only the number's own
// negative counts, only in a source the sentence names (not "by value only"), and only a declaration the source then holds.
const SIGNED = /;\s*read as the signed value\s+(-\d+(?:\.\d+)?)(?!\d|\.\d)/;
const signedAs = row => {
  const text = String(row.source || ''), m = SIGNED.exec(text);
  return m && !/by value only/i.test(text) && !/^-/.test(String(row.number)) && valueOf(m[1]) === valueOf(`-${row.number}`) ? valueOf(m[1]) : null;
};

function resolve(row, near, around, { index, run, values, lineOf, cells, recordNumbers, datasets, axes, fileNumbers, sectionNumbers }) {
  const text = String(row.source || ''), k = sourceKind(text);
  if (NOT_FOUND.test(text)) return { source: { kind: 'none', text }, status: 'unmatched' };
  // a project dataset holds the number in its rows or its note (a triple naming it must stand whole in one row: wholeTriples)
  if (k.kind === 'dataset') {
    const d = datasets?.get(k.id), src = { kind: 'dataset', text, id: k.id };
    if (!d) return { source: src, status: 'unmatched', why: datasets ? `the project has no dataset ${k.id}` : 'the datasets were not read for the check' };
    const as = signedAs(row), num = holds(d.all, row.number) ? row.number : as && holds(d.all, as) ? as : null;
    if (num === null) return { source: src, status: 'unmatched', why: `dataset ${k.id} does not hold ${row.number}` };
    if (num === as) src.signed = as;
    // the row it was read from: of the rows holding it, the one holding most of the numbers of its sentence (the first on a tie), so a
    // binding names that row (lib/manuscript-import.mjs); a number of the dataset's note has none
    let best = -1, score = -1;
    d.rows.forEach((set, i) => { if (!holds(set, num)) return; const k2 = near.filter(n => n !== row.number && set.has(valueOf(n))).length; if (k2 > score) { score = k2; best = i; } });
    return { source: best >= 0 ? { ...src, row: best } : src, status: 'matched' };
  }
  if (k.kind === 'output') {
    const h = outputHolds(k.id, row.number, cells, axes);
    return { source: { kind: 'output', text, id: k.id }, status: h.ok ? 'matched' : 'unmatched', ...(h.ok ? {} : { why: h.why }) };
  }
  if (k.kind === 'results') {
    const src = { kind: 'results', text };
    // a number the build derived from the results ("Derived from results.md: S23 keeps 33 …") is not on a line of them
    if (/^Derived/i.test(text)) return { source: { ...src, derived: true }, status: 'matched' };
    const { lines, score } = index ? resultCandidates(index, row.number, near) : { lines: [], score: -1 };
    if (index && !lines.length) return { source: src, status: 'unmatched' };
    // ambiguous: the numbers around it agree with lines of different sections equally; a number no neighbour confirms is matched to the
    // first line holding it, and says so (`weak`)
    let status = score > 0 && new Set(lines.map(l => l.section)).size > 1 ? 'ambiguous' : 'matched';
    if (lines.length) { src.line = lineOf(lines[0]); if (score === 0 && near.length > 1) src.weak = true; }
    const outs = run ? runOutputFor(run, row.number, near) : [];
    if (outs.length) {
      src.run = run.id; src.outputs = outs.slice(0, 5).map(o => o.id);
      // outputs of one run rest on the same inputs: a tie between them leaves the number's values known, so it is ambiguous only in its line
      if (status === 'ambiguous' && outs.length === 1) status = 'matched';
    }
    return { source: src, status };
  }
  if (k.kind === 'record') {
    const ids = values ? recordValues(row, values, around) : [], src = { kind: 'record', text, ...(ids.length ? { valueIds: ids } : {}) };
    // the values of the studies it names hold it by construction; else the record's counts or the data file the source names must
    if (ids.length) return { source: src, status: 'matched' };
    const held = recordNumbers ? recordNumbers(text) : null;
    if (held && holds(held, row.number)) return { source: src, status: 'matched' };
    return { source: src, status: 'unmatched', why: held ? `the record does not hold ${row.number}` : 'the record was not read for the check' };
  }
  // a file of the folder or a section of the store the source names must hold the number (Fable review, 15 Nov 2026: the Sham check took
  // "Cited literature", "Protocol" and "Search files" on the build's word, and a page number or a CI limit matched a cited figure by its value)
  if (k.kind === 'file' || k.kind === 'section') {
    const src = { kind: k.kind, text, ...(k.kind === 'file' ? { path: k.path } : { id: k.id }) }, read = k.kind === 'file' ? fileNumbers : sectionNumbers;
    if (!read) return { source: src, status: 'unmatched', why: `the ${k.kind === 'file' ? 'files' : 'sections'} were not read for the check` };
    const held = read(k.kind === 'file' ? k.path : k.id);
    if (!held) return { source: src, status: 'unmatched', why: k.kind === 'file' ? `${k.path} is not a file of the folder` : `the project has no section ${k.id}` };
    return holds(held, row.number) ? { source: src, status: 'matched' } : { source: src, status: 'unmatched', why: `${k.kind === 'file' ? k.path : `the section ${k.id}`} does not hold ${row.number}` };
  }
  // a source the check cannot read (a list typed into the build, a folder, a publication cited by name) is a failure, not a match
  return { source: { kind: k.kind, text }, status: 'unmatched', why: 'the build names a source Lykos cannot read: a store dataset, a Lykos output, the record or a file of the folder' };
}

/**
 * The structured check (NUMBER_CHECK_V). `rows` the build's check (parseNumberCheck); `docs` [{ name, path, sha256, blocks }] the files it
 * names (a file not given is listed with `missing`, its rows unplaced); `results` the analysis results' text; `run` the recorded run of that
 * analysis (lib/analysis-run.mjs); `values` { index: valueIndex, labels }; `datasets` the project's datasets (datasetValues); `outputs` Map(place "Table 2" -> Lykos output id), the build's map
 * of the outputs its tables and figures were made from, so a number in such a table also names that output's cell.
 */
// "0.45 (0.20 to 0.71)", "9.0% (95% CI 6.3 to 11.7)", a table's cell "0·45 (0·20 to 0·71)": an estimate of decimals with its interval, read
// on the text (normalised: the mid-line point is a decimal point), a cell's text never crossing into the next cell
const TRIPLE = /(?<![\d.])(-?\d+\.\d+)\s*%?\s*\(\s*(?:95\s*%\s*(?:CI|CrI|PI)[,:]?\s*|CI[,:]?\s*)?(-?\d+\.\d+)\s*%?\s*(?:to|–)\s*(-?\d+\.\d+)/dg;
/**
 * Each "estimate (lo to hi)" of the text whose numbers the check names the results for, checked as a whole (number-trace.mjs tripleCheck
 * reads the same triples): one output of the run prints all three (or rounds to them), else, when no output prints two of them, one line
 * of the results holds all three. A triple that is not whole marks the numbers that stand on it unmatched, with why: each may stand
 * somewhere on its own ("0.45 (0.20 to 0.71)": the run prints 0.45 and 0.20 in one output, 0.65 beside them). The triple is read on the
 * text, not on the check's rows: the build's own check may read an estimate otherwise ("45" in "0·45").
 */
// the rows of a Lykos output's cells, each as its numbers (values), memoized by the drawing function
const rowSets = new WeakMap();
function outputRows(id, cells) {
  if (!cells) return [];
  if (!rowSets.has(cells)) rowSets.set(cells, new Map());
  const m = rowSets.get(cells);
  if (!m.has(id)) { let rows = null; try { rows = cells(id); } catch { rows = null; } m.set(id, (rows || []).map(r => cellValues([r]))); }
  return m.get(id);
}
function wholeTriples(out, units, run, index, cells, datasets) {
  const by = new Map();
  for (const r of out) if (r.place) { const k = `${r.place.file}:${r.place.block}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const outs = run?.outputs || [], held = new Map();
  // each output by the values it prints and those values rounded to fewer decimals, so a triple's candidates are found at once
  for (const o of outs) for (const y of new Set(o.nums || [])) {
    const keys = [valueOf(y)];
    for (let d = 0; d < dec(y); d++) keys.push(valueOf(Number(y).toFixed(d)));
    for (const key of keys) { if (!held.has(key)) held.set(key, new Set()); held.get(key).add(o); }
  }
  for (const [k, rs] of by) {
    const [f, i] = k.split(':').map(Number), u = units[f]?.find(x => x.i === i);
    if (!u) continue;
    const N = normalised(u.t), raw = ([a, z]) => [N.at[a], N.at[z - 1] + 1];
    for (const m of N.text.matchAll(TRIPLE)) {
      const on = [1, 2, 3].map(g => { const [a, z] = raw(m.indices[g]); return rs.filter(r => r.place.at < z && r.place.at + r.place.len > a); }).flat();
      const three = [m[1], m[2], m[3]], said = `${m[1]} (${m[2]} to ${m[3]})`, vals = three.map(valueOf);
      // a triple naming a project dataset stands whole in one row of it
      const dsIds = [...new Set(on.filter(r => r.source.kind === 'dataset').map(r => r.source.id))];
      if (dsIds.length) {
        if (dsIds.some(id => datasets?.get(id)?.rows.some(set => three.every(x => holds(set, x))))) continue;
        const why = `no row of dataset ${dsIds.join(', ')} holds ${said} whole`;
        for (const r of on) { r.status = 'unmatched'; r.why = why; }
        continue;
      }
      if (!on.some(r => r.source.kind === 'results' && !r.source.derived)) continue;
      // whole in one run output, one line of the results, or one row of a Lykos output a number on it names (its source, or the output
      // its table was made from)
      const cands = [...new Set(vals.flatMap(v => [...(held.get(v) || [])]))].map(o => ({ o, k: three.filter(x => numberVerdict(x, o.nums || []).verdict).length }));
      if (cands.some(c => c.k === 3)) continue;
      if (index?.some(l => three.every(x => lineHolds(l, x)))) continue;
      const ids = new Set(on.flatMap(r => [r.source.kind === 'output' ? r.source.id : '', r.output?.id || '']).filter(Boolean));
      if ([...ids].some(id => outputRows(id, cells).some(set => vals.every(v => set.has(v))))) continue;
      const best = cands.sort((a, b) => b.k - a.k)[0];
      const why = best && best.k >= 2 ? `${said} is not one run output's: ${best.o.title || best.o.id}${best.o.level ? `, ${best.o.level}` : ''} prints ${best.o.text || (best.o.nums || []).join(', ')}`
        : `no line of the results${ids.size ? ` and no row of ${[...ids].join(', ')}` : ''} holds ${said} whole`;
      for (const r of on) { r.status = 'unmatched'; r.why = why; }
    }
  }
}

export function buildNumberCheck({ rows, docs = [], results = null, run = null, values = null, outputs = null, flow = null, grade = null, cells = null, recordNumbers = null, datasets = null, axes = null, fileNumbers = null, sectionNumbers = null, built = new Date().toISOString(), check = null }) {
  const names = [...new Set(rows.map(r => r.file))], files = docs.map(d => ({ name: d.name, ...(d.path ? { path: d.path } : {}), ...(d.sha256 ? { sha256: d.sha256 } : {}) }));
  for (const n of names) if (!files.some(f => f.name === n)) files.push({ name: n, missing: true });
  const units = docs.map(d => (d.blocks ? checkedUnits(d.blocks) : null));
  const placed = placeRows(rows, docs.map(d => ({ name: d.name, blocks: d.blocks })), units), index = results != null ? resultsIndex(results) : null;
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0])), byKind = {}, out = [];
  // the results lines the numbers name, each once (a row names its line by index)
  const lines = [], lineAt = new Map(), lineOf = l => { if (!lineAt.has(l)) { lineAt.set(l, lines.length); lines.push({ section: l.section, text: cut(l.text, 240) }); } return lineAt.get(l); };
  rows.forEach((row, n) => {
    const p = placed.get(row) || null, r = { n, file: files.findIndex(f => f.name === row.file), number: row.number, context: cut(String(row.context || ''), 120), ...resolve(row, p?.near || [], p?.around || '', { index, run, values, lineOf, cells, recordNumbers, datasets, axes, fileNumbers, sectionNumbers }) };
    if (p) {
      r.place = p.place;
      const id = p.place.cell && outputs?.get(p.place.part);
      if (r.source.kind === 'output' && p.place.cell) r.source.cell = p.place.cell;
      else if (id) r.output = { id, cell: p.place.cell };
    } else if (r.source.kind !== 'none') { r.status = 'unplaced'; delete r.why; }   // the check's own "no source" stays unmatched wherever it stands
    out.push(r);
  });
  // the run outputs the numbers name, with the units each read (a v2 run): the rest of the run is not needed to say what a value marks
  const named = new Set(out.flatMap(r => r.source?.outputs || []));
  const reads = run?.trials ? { trials: run.trials, outputs: (run.outputs || []).filter(o => named.has(o.id) && Array.isArray(o.reads)).map(o => ({ id: o.id, reads: o.reads })) } : {};
  // what the numbers say against each other and against the app (lib/cross-checks.mjs): kept in the file, an empty list when all agree
  const cross = crossChecks({ rows: out, units, run, flow, grade });
  // then each triple as a whole: after the cross-checks, which read an unmatched number beside the matched numbers of its output
  wholeTriples(out, units, run, index, cells, datasets);
  for (const r of out) { counts[r.status]++; byKind[r.source.kind] = (byKind[r.source.kind] || 0) + 1; }
  return { kind: NUMBER_CHECK_KIND, v: NUMBER_CHECK_V, built, ...(check ? { check } : {}), files,
    ...(run ? { runs: { [run.id]: { file: run.file || '', at: run.at || '', inputHash: run.inputHash || '', valueIds: run.valueIds || [], ...reads } } } : {}),
    counts, byKind, lines, rows: out, cross };
}

/**
 * The check's summary, its failures first: { failures, cross, unmatched, text }. A cross-check that disagrees (lib/cross-checks.mjs: the
 * flow, a run output, a total, a percentage, the certainty record) and a number its named source does not hold are each a failure; a check
 * built before cross-checks counts its unmatched numbers only. "2 cross-checks disagree; 259 unmatched; 8,665 matched, 863 ambiguous, …".
 */
export function checkSummary(check) {
  const c = check?.counts || {}, cross = Array.isArray(check?.cross) ? check.cross.length : 0, unmatched = Number(c.unmatched) || 0;
  const n = x => Number(x).toLocaleString('en');
  const rest = ['matched', 'ambiguous', 'unplaced'].filter(k => c[k]).map(k => `${n(c[k])} ${k}`);
  const head = [cross ? `${n(cross)} cross-check${cross === 1 ? ' disagrees' : 's disagree'}` : '', unmatched ? `${n(unmatched)} unmatched` : ''].filter(Boolean);
  return { failures: cross + unmatched, cross, unmatched, text: [...head, rest.join(', ')].filter(Boolean).join('; ') || 'no numbers' };
}

/** A structured check read from its file: the check, or null when the file is not one; a check a newer Lykos wrote is kept unread (`newer`). */
export function readNumberCheck(x) {
  if (!x || typeof x !== 'object' || x.kind !== NUMBER_CHECK_KIND || !(Number(x.v) >= 1)) return null;
  if (Number(x.v) > NUMBER_CHECK_V) return { kind: x.kind, v: x.v, newer: true, files: [], rows: [], counts: x.counts || {} };
  return { ...x, files: Array.isArray(x.files) ? x.files : [], rows: Array.isArray(x.rows) ? x.rows : [], lines: Array.isArray(x.lines) ? x.lines : [], runs: x.runs && typeof x.runs === 'object' ? x.runs : {},
    // the cross-checks (lib/cross-checks.mjs); null in a check built before them
    cross: Array.isArray(x.cross) ? x.cross : null };
}

/** The check from a file's bytes, gzip (written since 14 Nov 2026, docs/Lykos_Storage_Design_2026-11.md O2: 5.3 MB of JSON on Sham) or
 *  the plain JSON written before, whatever the name: null when it does not read. */
export async function readNumberCheckBytes(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const text = b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b
      ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(b);
    return readNumberCheck(JSON.parse(text));
  } catch { return null; }
}

/**
 * A registration's number check in its current form (the migration of 7 Nov 2026): { file, checked, unmatched, date, structured }. A
 * manuscript registered before kept the totals only; its `structured` is null and the reader matches the numbers itself, as before, until
 * `node tools/lykos-register.mjs <folder> number-check` builds the file.
 */
export function numberCheckEntry(e) {
  const nc = e?.numberCheck;
  if (!nc || typeof nc !== 'object' || !nc.file) return null;
  const st = nc.structured && typeof nc.structured === 'object' && nc.structured.file ? nc.structured : null;
  return { file: nc.file, checked: Number(nc.checked) || 0, unmatched: Number(nc.unmatched) || 0, ...(nc.date ? { date: nc.date } : {}), structured: st };
}

/**
 * The places of one file's numbers for the reader (lib/docx-reading.mjs readingModel `placed`): Map(block -> [{ start, end, row }]), a row
 * as parseNumberCheck gives it with the structured row as `check`. null when the check does not name the file.
 */
export function placedRows(check, name) {
  const f = (check?.files || []).findIndex(x => x.name === name);
  if (f < 0) return null;
  const by = new Map();
  for (const r of check.rows) {
    if (r.file !== f || !r.place) continue;
    const row = { file: name, number: r.number, source: r.source?.text || '', context: r.context || '', check: r };
    if (!by.has(r.place.block)) by.set(r.place.block, []);
    by.get(r.place.block).push({ start: r.place.at, end: r.place.at + r.place.len, row });
  }
  for (const a of by.values()) a.sort((x, y) => x.start - y.start);
  return by;
}

// ---- what rests on a changed value ----------------------------------------------------------------------------------------------------
/** The value ids written after `at` (an ISO time): Set. */
export function changedSince(values, at) {
  const out = new Set(), t = String(at || '');
  if (!t) return out;
  for (const [k, v] of Object.entries(values || {})) if (v && String(v.at || '') > t) out.add(k);
  return out;
}
const values = n => (n === 1 ? 'a value' : `${n.toLocaleString('en')} values`);
/**
 * The numbers of a check that rest on changed values: { rows: Map(n -> why), text }. A number rests on its own value ids (a record's
 * values) or on the run outputs it names: the values those outputs read (a v2 run's units) or, for a run without them, all its inputs;
 * a study's own field the run reads (its class, design) marks every output. `changed` is the value ids written after the build
 * (changedSince). "3 numbers in Results and Table 2 rest on changed values".
 */
export function staleNumbers(check, changed = new Set()) {
  const rows = new Map(), hits = new Map();
  if (!changed.size) return { rows, text: '' };
  for (const r of check?.rows || []) {
    const own = (r.source?.valueIds || []).filter(k => changed.has(k));
    if (own.length) { rows.set(r.n, `${values(own.length)} written after the build (${own.slice(0, 3).join(', ')})`); continue; }
    const id = r.source?.run;
    if (!id || !check.runs?.[id]) continue;
    if (!hits.has(id)) hits.set(id, runHits(check.runs[id], changed));
    const h = hits.get(id), outs = r.source.outputs || [];
    // a number tied between outputs of the run rests on each of them
    const keys = outs.length ? [...new Set(outs.flatMap(o => h.output(o)))] : h.values;
    if (!keys.length) continue;
    const study = keys.filter(k => h.study.includes(k)).length;
    rows.set(r.n, study ? `${values(study)} deciding which studies the analysis pools ${study === 1 ? 'was' : 'were'} written after the build`
      : outs.length && check.runs[id].outputs?.some(o => outs.includes(o.id)) ? `${values(keys.length)} that ${outs.length === 1 ? 'its output reads' : 'its outputs read'} ${keys.length === 1 ? 'was' : 'were'} written after the build`
        : `${values(keys.length)} of the analysis run written after the build`);
  }
  return { rows, text: staleText(check, [...rows.keys()].map(n => check.rows[n])) };
}
/** "3 numbers in Results and Table 2 rest on changed values" for the given rows; '' for none. */
export function staleText(check, stale) {
  if (!stale.length) return '';
  const parts = [];
  for (const r of stale) { const p = r.place?.part || r.place?.section || check.files?.[r.file]?.name; if (p && !parts.includes(p)) parts.push(p); }
  const n = stale.length, shown = parts.slice(0, 3), more = parts.length - shown.length;
  const list = more > 0 ? `${shown.join(', ')} and ${more} other part${more === 1 ? '' : 's'}` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] || '';
  return `${n.toLocaleString('en')} number${n === 1 ? '' : 's'}${list ? ` in ${list}` : ''} rest${n === 1 ? 's' : ''} on changed values`;
}
/** Where a number stands, as words: "Results, paragraph 3, sentence 2" or "Table 2, row 4, cell 3". */
export function placeText(p) {
  if (!p) return '';
  if (p.cell) return `${p.part || p.section || 'Table'}, row ${p.cell.row + 1}, cell ${p.cell.col + 1}`;
  return [p.section || '', p.paragraph ? `paragraph ${p.paragraph}` : '', p.sentence ? `sentence ${p.sentence}` : ''].filter(Boolean).join(', ');
}
