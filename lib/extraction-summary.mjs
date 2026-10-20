// The data summary of an extraction: what the studies hold, field by field, counted exactly (Extraction data summary, stage 1).
//
// Pure. It takes the project's extraction schema (the field list), its studies and its values, and returns counts. It names no field,
// device, vocabulary, category or review topic: the kind of a field comes from its declared type and options and from the values present;
// categories come from the data (or from a mapping the project holds, which a person approved); the words a cell uses for "no value" come
// from that mapping too. Nothing here calls a model. A model is asked only about what is left over (`residual`), once per distinct value.
//
// Counts are of studies, never of cells: a study that names a part twice counts once. Every count carries the cells behind it, so a page can
// open the list of studies and their source anchors (the value record keeps its evidence; this module only names the cell).
//
// Numbers go through lib/describe.mjs (plan §4.9), whose order statistics are checked against R in bench/describe.mjs and
// bench/extraction-summary.mjs. Nothing is computed by hand here.
import { describe } from './describe.mjs';
import { fold } from './quotes.mjs';

export const SUMMARY_VERSION = 1;

/**
 * Thresholds that decide how a field with no declared levels is read. They are properties of the data's shape (shares and counts), not of any
 * vocabulary, and the summary returns them so a test or a person can see what decided.
 */
export const SUMMARY_LIMITS = Object.freeze({
  minCells: 4,          // fewer present cells than this: the field is listed value by value ('free'), not classified
  multiShare: 0.3,      // share of cells that split into two or more parts for the field to read as multi-valued
  repeatShare: 0.3,     // share of the distinct parts that recur in two or more cells for the same
  maxLevels: 12,        // a single-valued text field with more distinct values than this is free text
  levelRepeat: 0.5,     // ... and one whose distinct values exceed this share of its cells is free text
  markerStems: 3,       // a trailing token is a status marker when it ends parts with at least this many different stems ...
  markerCovary: 2,      // ... and at least this many stems occur with two or more of the markers
});

/** The key two spellings of one value share: case, accents' compatibility forms, quotes, dashes and runs of space folded. */
export const valueKey = text => fold(text).replace(/^[\s.;,:]+|[\s.;,:]+$/g, '');

const present = v => v != null && String(v).trim() !== '';
const isNumeric = f => f && (f.type === 'number' || f.type === 'integer');

// ---- splitting ------------------------------------------------------------------------------------------------------------------------

/**
 * The parts of a composite cell. Splits at `;`, `|`, a line break and a bullet, and at a comma that is neither inside brackets nor between
 * digits ("1,234"). A cell with none of these is one part. Keeps each part's text as written.
 */
export function splitParts(text) {
  const s = String(text ?? ''), out = [];
  let depth = 0, from = 0;
  const cut = i => { const t = s.slice(from, i).trim(); if (t) out.push(t); from = i + 1; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth) continue;
    else if (c === ';' || c === '|' || c === '\n' || c === '•') cut(i);
    else if (c === ',' && !(/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || ''))) cut(i);
  }
  cut(s.length);
  return out;
}

/**
 * The parts of one cell as the summary reads them, for a field whose markers are known (`markers`: the keys the field's summary lists).
 * Each part: { text as written, label (its stem when a marker is read), key, status (the project's meaning of the marker, else the marker as
 * written, else ''), groups (labels of the categories the project grouped the part in) }. Nothing here decides what a marker means.
 */
export function partsOf(text, { markers = [], mapping = null } = {}) {
  const set = markers instanceof Set ? markers : new Set(markers);
  return splitParts(text).map(part => {
    const { stem, marker } = stemAndMarker(part), mk = valueKey(marker), has = set.has(mk), label = has ? stem : part, key = valueKey(label);
    return { text: part, label, key, status: has ? (mapping?.markers?.[mk] ?? marker) : '',
      groups: (mapping?.cells?.[key] || []).map(m => mapping.categories?.[m.category]?.label ?? m.category) };
  });
}

/** The trailing token of a part and the rest: 'stem marker'. A one-token part has no marker. */
function stemAndMarker(part) {
  const t = part.trim().split(/\s+/);
  return t.length < 2 ? { stem: part.trim(), marker: '' } : { stem: t.slice(0, -1).join(' '), marker: t[t.length - 1] };
}

/**
 * The status markers a multi-valued field uses, read from its values: a trailing token that ends parts with several different stems, where
 * several stems also occur with more than one such marker (the same item recorded with different statuses). Returns a Set of marker keys; empty
 * when the evidence is not there. What a marker means is not decided here (see `mapping.markers`).
 */
export function inducedMarkers(partLists, limits = SUMMARY_LIMITS) {
  const stemsOf = new Map();    // marker key -> Set of stem keys
  for (const parts of partLists) for (const p of parts) {
    const { stem, marker } = stemAndMarker(p); if (!marker) continue;
    const m = valueKey(marker), st = valueKey(stem); if (!m || !st) continue;
    if (!stemsOf.has(m)) stemsOf.set(m, new Set());
    stemsOf.get(m).add(st);
  }
  const candidates = new Set([...stemsOf].filter(([, s]) => s.size >= limits.markerStems).map(([m]) => m));
  if (!candidates.size) return new Set();
  const per = new Map();        // stem key -> Set of candidate markers it occurs with
  for (const m of candidates) for (const st of stemsOf.get(m)) { if (!per.has(st)) per.set(st, new Set()); per.get(st).add(m); }
  return [...per.values()].filter(s => s.size >= 2).length >= limits.markerCovary ? candidates : new Set();
}

// ---- cells ----------------------------------------------------------------------------------------------------------------------------

export const cellKeyOf = (paperId, fieldId) => `${paperId}:${fieldId}`;
const textOf = v => String(v?.reported_value ?? v?.normalized_value ?? '').trim();

/**
 * Where a cell stands, from the record alone: 'missing' (no accepted value), 'not_reported' (the extractor marked it not found),
 * a role the project's mapping gave this exact text (`mapping.states`), or 'present'. A pending proposal does not make a value.
 */
export function cellState(v, mapping = null) {
  if (!v) return 'missing';
  if (v.availability === 'not_found') return 'not_reported';
  const t = textOf(v);
  if (!t) return 'missing';
  return mapping?.states?.[valueKey(t)] || 'present';
}

// ---- the summary ----------------------------------------------------------------------------------------------------------------------

/** A counted group: the studies behind it, each with the cell that holds the value. */
const group = (key, label) => ({ key, label, n: 0, studies: [], seen: new Set(), variants: new Map() });
function add(g, paperId, cell, text) {
  if (g.seen.has(paperId)) return;
  g.seen.add(paperId); g.n++; g.studies.push({ paperId, cell });
  if (text != null) g.variants.set(text, (g.variants.get(text) || 0) + 1);
}
/** The commonest spelling of a group, the first seen on a tie. */
const labelOf = g => { let best = '', n = -1; for (const [t, c] of g.variants) if (c > n) { best = t; n = c; } return best; };
const finish = (g, fixedLabel) => ({ key: g.key, label: fixedLabel ?? labelOf(g), n: g.n, studies: g.studies });
const byCount = (a, b) => b.n - a.n || a.label.localeCompare(b.label);

const declaredLevels = f => (f.options?.length ? f.options : f.allowed?.length ? f.allowed : []).map(String);

// ---- identifiers and the study column ---------------------------------------------------------------------------------------------------
// A table often carries the study's own name as a field (the citation "Author et al., year, country") and a running number. Both name the row;
// they are not data: counting their parts ("2024 7, Italy 6") says nothing, and the grid already shows the study's name as the row's head.

/** A field whose label names the study itself: "Study", "Study name", "Citation", "Author, year". The words of a table's header, not of a topic. */
export const isStudyColumn = c => /^(stud(y|ies)|study (name|label|citation|reference)|citation|reference|(first )?authors?,? (and )?year)$/i.test(String(c?.label || '').trim());
/** A field whose label says it is an identifier: "ID", "Study ID", "Record no.", "#". */
const isIdLabel = c => /^(#|no\.?|n°|number|id|identifier)$|\b(id|identifier|no\.?)$/i.test(String(c?.label || '').trim());
/** The words of a row's name a cell must repeat to name that row: its words of three letters or more and its year ("Akgun 2024" -> akgun, 2024). */
const nameWords = label => fold(label).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 || /^\d{4}$/.test(w));
/** Whether a cell's text repeats the name of its row: every word of the name is in it. */
export function namesRow(text, rowLabel) {
  const words = nameWords(rowLabel), t = fold(text);
  return words.length > 0 && words.every(w => t.includes(w));
}
const NAMES_SHARE = 0.8;   // the share of a field's values that must repeat their row's name for the field to be the study column
/** Whether `cells` ([{ text, label }]: a value and its row's name) are the rows' names over again, in most rows that have a value. */
const repeatsNames = (cells, limits = SUMMARY_LIMITS) => cells.length >= Math.min(limits.minCells, 3) && cells.filter(c => namesRow(c.text, c.label)).length >= NAMES_SHARE * cells.length;
/**
 * The column of a table that is the study's own name, or null: the one whose label says so, else a text column whose values repeat the rows'
 * names. `papers` are the rows ({ id, label }), `textOf(paper, column)` the text a cell holds.
 */
export function studyColumnOf(cols, papers, textOf) {
  const named = (cols || []).find(isStudyColumn);
  if (named) return named.id;
  for (const c of cols || []) {
    if (isNumeric(c) || declaredLevels(c).length) continue;
    const cells = (papers || []).map(p => ({ text: String(textOf(p, c) ?? '').trim(), label: p.label || '' })).filter(x => x.text && x.label);
    if (repeatsNames(cells)) return c.id;
  }
  return null;
}
/** A running number: distinct whole numbers that nearly fill the range they span (1 to 59 over 48 studies). */
function runningNumber(texts) {
  if (texts.length < 3 || !texts.every(t => /^\d{1,6}$/.test(t))) return false;
  const n = texts.map(Number), lo = Math.min(...n), hi = Math.max(...n);
  return new Set(n).size === n.length && hi - lo + 1 <= 1.5 * n.length;
}
/**
 * Whether a field names its studies instead of describing them: the study column, an identifier (its label says so and its values differ
 * between the studies) or a running number. `cells` are its present cells ([{ text, label }], the row's name beside each value).
 */
function identifierOf(f, cells) {
  if (isStudyColumn(f)) return 'names the study';
  const texts = cells.map(c => c.text), unique = texts.length > 0 && new Set(texts.map(valueKey)).size === texts.length;
  if (unique && isIdLabel(f)) return 'an identifier, one per study';
  if (unique && runningNumber(texts)) return 'a running number, one per study';
  if (!isNumeric(f) && !declaredLevels(f).length && repeatsNames(cells)) return 'repeats the study name';
  return '';
}

/** Decides how a field is read; returns { kind, reason, parts?, markers? }. `texts` are the present cells' texts, `named` why it names its studies. */
function kindOf(f, texts, mapping, limits, named = '') {
  if (mapping?.kind) return { kind: mapping.kind, reason: 'set by the project' };
  if (named) return { kind: 'label', reason: named };   // a name or an identifier: counted as filled, never as a distribution
  if (isNumeric(f)) return { kind: 'numeric', reason: 'declared number' };
  if (f.type === 'category' || declaredLevels(f).length) return { kind: 'categorical', reason: 'declared levels' };
  if (texts.length < limits.minCells) return { kind: 'free', reason: `fewer than ${limits.minCells} values` };
  const lists = texts.map(splitParts), split = lists.filter(p => p.length >= 2).length / texts.length;
  if (split >= limits.multiShare) {
    const markers = mapping?.parse === 'plain' ? new Set() : inducedMarkers(lists, limits);
    const stems = lists.map(ps => [...new Set(ps.map(p => valueKey(markers.has(valueKey(stemAndMarker(p).marker)) ? stemAndMarker(p).stem : p)))]);
    const seen = new Map(); for (const ss of stems) for (const s of ss) seen.set(s, (seen.get(s) || 0) + 1);
    // of the distinct parts, how many occur in two or more cells: a constant opening phrase in free text recurs, but it is one part of many
    const distinctParts = seen.size, recurring = [...seen.values()].filter(n => n >= 2).length;
    if (distinctParts && recurring / distinctParts >= limits.repeatShare) return { kind: 'multi', reason: `${Math.round(split * 100)}% of values have several parts, ${Math.round(100 * recurring / distinctParts)}% of distinct parts recur`, markers };
  }
  const distinct = new Set(texts.map(valueKey)).size;
  if (distinct <= limits.maxLevels && distinct <= texts.length * limits.levelRepeat) return { kind: 'categorical', reason: 'few distinct values that repeat' };
  return { kind: 'free', reason: 'values rarely repeat' };
}

/** Numbers of a numeric field through lib/describe.mjs; unparsable text is listed, never zero. */
function numericOf(f, cells) {
  const nums = [], unparsed = [];
  for (const c of cells) {
    const raw = c.v.normalized_value ?? c.v.reported_value;
    const n = raw == null || String(raw).trim() === '' || typeof raw === 'boolean' ? NaN : Number(raw);
    if (Number.isFinite(n)) nums.push({ paperId: c.paperId, cell: c.cell, value: n }); else unparsed.push({ paperId: c.paperId, cell: c.cell, text: textOf(c.v) });
  }
  const col = { id: 'x', name: f.label || f.id, type: 'number' };
  const rows = nums.map(x => ({ x: x.value }));
  const d = rows.length ? describe(rows, [col]).rows[0]?.slices[0] : null;
  const stats = d ? { n: d.n, median: d.median, q1: d.q1, q3: d.q3, min: d.min, max: d.max, mean: d.mean, sd: d.sd } : { n: 0 };
  return { ...stats, values: nums, unparsed };
}

/**
 * Summarises the extraction.
 *   fields   [{ id, label, type, options?, allowed?, unit? }]   the table's columns (lib/fields.mjs `fields()` or a template's columns)
 *   studies  [{ id, label }]                                    the rows
 *   values   { 'paperId:fieldId': { reported_value, normalized_value, availability, evidence } }
 *   proposals { 'paperId:fieldId': ... }                        optional; only counted (a pending value is not data)
 *   mappings { [fieldId]: { kind?, parse?, states?, markers?, categories?, cells? } }   the project's approved normalisation (see below)
 *
 * mapping.states   { valueKey: 'not_reported' | 'not_applicable' | ... }  a text the project treats as "no value", whatever its words
 * mapping.markers  { markerKey: statusLabel }                              what a trailing marker of a multi-valued field means
 * mapping.categories { id: { label } }, mapping.cells { valueKey: [{ category: id, status?: label }] }   a multi-valued or free-text value as categories
 *
 * Returns { version, studyCount, fields: [FieldSummary] }, a FieldSummary being
 *   { id, label, unit, kind, reason, studyCount, states: { present, missing, not_reported, ... : { n, studies } }, proposed,
 *     levels: [{ key, label, n, studies: [{ paperId, cell }], sub?: [...] }],   categorical, multi (parts or categories), mapped free text
 *     numeric?: { n, median, q1, q3, min, max, mean, sd, values, unparsed },
 *     residual: { items: [{ key, text, cells }], cells } }                      what no rule of this module can count; what a model may be asked
 */
export function summarise({ fields, studies, values = {}, proposals = {}, mappings = {}, limits = SUMMARY_LIMITS }) {
  const out = [], nameOf = new Map((studies || []).map(p => [p.id, p.label || '']));
  for (const f of fields || []) {
    const mapping = mappings[f.id] || null;
    const stateGroups = {}, cells = [];
    const stateAdd = (state, paperId, cell) => { (stateGroups[state] ||= { n: 0, studies: [] }); stateGroups[state].n++; stateGroups[state].studies.push({ paperId, cell }); };
    let proposed = 0;
    for (const p of studies || []) {
      const cell = cellKeyOf(p.id, f.id), v = values[cell], st = cellState(v, mapping);
      stateAdd(st, p.id, cell);
      if (st === 'missing' && proposals[cell]) proposed++;
      if (st === 'present') cells.push({ paperId: p.id, cell, v, text: textOf(v) });
    }
    for (const k of ['present', 'missing', 'not_reported']) stateGroups[k] ||= { n: 0, studies: [] };

    const named = identifierOf(f, cells.map(c => ({ text: c.text, label: nameOf.get(c.paperId) || '' })));
    const decided = kindOf(f, cells.map(c => c.text), mapping, limits, named), { kind, reason } = decided;
    let markers = decided.markers || new Set();
    if (kind === 'multi' && !decided.markers && mapping?.parse !== 'plain') markers = inducedMarkers(cells.map(c => splitParts(c.text)), limits);   // a kind the project set
    const res = { id: f.id, label: f.label || f.id, unit: f.unit || '', kind, reason, studyCount: (studies || []).length, states: stateGroups, proposed, levels: [], residual: { items: [], cells: 0 },
      markers: kind === 'multi' ? [...markers] : [] };

    if (kind === 'numeric') {
      res.numeric = numericOf(f, cells);
      // text a number field holds that is not a number is a cell the extractor must look at, and the only thing a model could read
      res.residual = residualOf(res.numeric.unparsed.map(u => ({ ...u, text: u.text })));
    } else if (kind === 'categorical') {
      const declared = declaredLevels(f), groups = new Map();
      for (const d of declared) groups.set(valueKey(d), { g: group(valueKey(d), d), fixed: d });
      for (const c of cells) {
        const k = valueKey(c.text); if (!groups.has(k)) groups.set(k, { g: group(k, c.text), fixed: null });
        add(groups.get(k).g, c.paperId, c.cell, c.text);
      }
      res.levels = [...groups.values()].map(({ g, fixed }) => finish(g, fixed ?? undefined)).sort(declared.length ? declaredOrder(declared) : byCount);
    } else if (kind !== 'label') {
      mappedAndSplit(res, f, cells, mapping, markers, kind);
    }
    out.push(res);
  }
  return { version: SUMMARY_VERSION, studyCount: (studies || []).length, fields: out };
}

/**
 * Where a number lies among the others of its field: the share of the field's order statistics below it, by the inverse of lib/describe.mjs'
 * quantile rule (R's type 7, whose h = (n - 1) p). A value equal to the quantile at p returns p; ties take the middle of their positions; a value
 * outside the range is 0 or 1. { p, n, below, above } or null when there is no number or nothing to compare with.
 */
export function placeNumeric(numeric, value) {
  const xs = (numeric?.values || []).map(v => v.value).filter(Number.isFinite).sort((a, b) => a - b), n = xs.length;
  if (!n || !Number.isFinite(value)) return null;
  let p;
  if (n === 1) p = 0.5;
  else if (value <= xs[0]) p = 0;
  else if (value >= xs[n - 1]) p = 1;
  else {
    const at = xs.findIndex(x => x >= value);
    if (xs[at] === value) { let hi = at; while (xs[hi + 1] === value) hi++; p = ((at + hi) / 2) / (n - 1); }
    else p = (at - 1 + (value - xs[at - 1]) / (xs[at] - xs[at - 1])) / (n - 1);
  }
  return { p, n, below: xs.filter(x => x < value).length, above: xs.filter(x => x > value).length };
}

const declaredOrder = declared => { const at = new Map(declared.map((d, i) => [valueKey(d), i])); return (a, b) => (at.has(a.key) ? at.get(a.key) : 1e9) - (at.has(b.key) ? at.get(b.key) : 1e9) || byCount(a, b); };

function residualOf(items) {
  const by = new Map();
  for (const it of items) { const k = valueKey(it.text); if (!k) continue; if (!by.has(k)) by.set(k, { key: k, text: it.text, cells: [] }); by.get(k).cells.push(it.cell); }
  return { items: [...by.values()], cells: items.length };
}

/** Multi-valued and free-text fields: counted through the project's mapping where it covers a value, else split locally (multi) or left over. */
function mappedAndSplit(res, f, cells, mapping, markers, kind) {
  const groups = new Map(), left = [];
  const sub = (g, label) => { g.sub ||= new Map(); if (!g.sub.has(label)) g.sub.set(label, group(valueKey(label), label)); return g.sub.get(label); };
  const gOf = (key, label) => { if (!groups.has(key)) groups.set(key, group(key, label)); return groups.get(key); };
  for (const c of cells) {
    const mapped = mapping?.cells?.[valueKey(c.text)];
    if (mapped?.length) {
      for (const m of mapped) {
        const label = mapping.categories?.[m.category]?.label ?? m.category, g = gOf(`c:${m.category}`, label);
        add(g, c.paperId, c.cell, label);
        if (m.status) add(sub(g, m.status), c.paperId, c.cell, m.status);
      }
    } else if (kind === 'multi') {
      for (const part of splitParts(c.text)) {
        const { stem, marker } = stemAndMarker(part), mk = valueKey(marker), has = markers.has(mk);
        const key = valueKey(has ? stem : part), status = has ? (mapping?.markers?.[mk] ?? marker) : '';
        // a part (its stem, when a marker is read) the project grouped counts in its categories; its marker, when it has one, is the status
        const grouped = mapping?.cells?.[key];
        if (grouped?.length) {
          for (const m of grouped) {
            const label = mapping.categories?.[m.category]?.label ?? m.category, g = gOf(`c:${m.category}`, label), st = status || m.status;
            add(g, c.paperId, c.cell, label);
            if (st) add(sub(g, st), c.paperId, c.cell, st);
          }
          continue;
        }
        const g = gOf(`p:${key}`, has ? stem : part);
        add(g, c.paperId, c.cell, has ? stem : part);
        if (has) add(sub(g, status), c.paperId, c.cell, status);
      }
    } else left.push({ cell: c.cell, text: c.text });
  }
  res.levels = [...groups.values()].map(g => {
    const o = finish(g);
    if (g.sub) o.sub = [...g.sub.values()].map(s => finish(s)).sort(byCount);
    return o;
  }).sort(byCount);
  res.residual = residualOf(left);
}

// ---- what a model may be asked ------------------------------------------------------------------------------------------------------

/**
 * The distinct things a model would be asked to normalise for a field, each once: for a multi-valued field its parts not yet in a project
 * category and its distinct markers (a handful), for free text its residual values. Counted, categorical and numeric fields ask nothing.
 * { items: [{ key, text, cells }], markers: [{ key, text, n }] }
 */
export function toNormalise(fieldSummary) {
  if (fieldSummary.kind === 'free') return { items: fieldSummary.residual.items, markers: [] };
  if (fieldSummary.kind !== 'multi') return { items: [], markers: [] };
  const items = fieldSummary.levels.filter(l => l.key.startsWith('p:')).map(l => ({ key: l.key.slice(2), text: l.label, cells: l.studies.map(s => s.cell) }));
  const markers = new Map();
  for (const l of fieldSummary.levels) for (const m of l.sub || []) { const o = markers.get(m.key) || { key: m.key, text: m.label, n: 0 }; o.n += m.n; markers.set(m.key, o); }
  return { items: [...items, ...fieldSummary.residual.items], markers: [...markers.values()] };
}

// ---- cost of asking a model about the rest --------------------------------------------------------------------------------------------

/**
 * What it would take to ask a model about a field's residual, as an estimate. The same rule as lib/assist.mjs estimateTokens (characters / 4
 * and a fixed overhead per call); not a measured count. `normalise` asks about a multi-valued field's parts and markers too (toNormalise);
 * `perItemReply` is the structured-output size of one item in the reply.
 */
export function residualCost(fieldSummary, { definitionChars = 0, overheadTokens = 120, perItemReply = 24, normalise = false } = {}) {
  const ask = normalise ? toNormalise(fieldSummary) : { items: fieldSummary.residual.items, markers: [] }, all = [...ask.items, ...ask.markers];
  const chars = all.reduce((n, it) => n + it.text.length + 8, 0) + definitionChars;
  return { items: all.length, cells: fieldSummary.residual.cells, inputTokens: all.length ? Math.ceil(chars / 4) + overheadTokens : 0, outputTokens: all.length * perItemReply };
}
