// The manuscript as data (14 Nov 2026; the owner: "we keep the data as database not builder codes with hardcoded values right?"). The
// section `manuscriptText` holds a project's documents (the manuscript, its supplement, a cover letter) as the Word reader reads them
// (lib/docx.mjs parseDocx: blocks with runs, styles, lists, notes, the page setup), and each reported number as a run bound to what
// computed it rather than as typed text:
//
//   { t: '0·34', …character properties, n: { src: 'run', run, output, field, at? } }   a run output's field ("SMCR|All" estimate);
//                                                                                      `at`: the k-th number of a text field
//   { t: '42', n: { src: 'value', ids: [value id] } }                                   a value of the record (s.values)
//   { t: '15', n: { src: 'output', output, key, nth?, col, at } }                      a Lykos output's cell: the row whose first cell
//                                                                                      is `key` (its `nth` such row), the k-th number
//   { t: '0·86', n: { src: 'dataset', dataset, key, nth?, col, at } }               a project dataset's cell (s.datasets): the row
//                                                                                      whose key column (datasetKey) is `key`, column `col`
//   { t: '292', n: { src: 'named', text } }                                             typed: the source the build's check names
//                                                                                      (a protocol value, a page, a cited figure)
//
// The typed text `t` stays as it was imported: it is what the Word file printed, and what a renderer shows while a source cannot be read.
// Rendering from data formats the bound value as the typed text was written (its decimals, decimal point "·" or ".", minus sign, digit
// grouping, a leading "<").
//
// Stored (the storage coordinator's conditions, 14 Nov): the history keeps a map section in chunks by top-level key, so the section is a
// map keyed by document and block, and no key holds a whole 4 MB supplement: an edited paragraph moves one key.
//
//   { kind, v, docs: ['manuscript', 'supplement'],                     the documents in order
//     'doc:manuscript': { id, role, name, path, from, section, styles, lists, notes, media, records, citations, results, order: [block ids] },
//     'manuscript/<block id>': { type, runs, … } }                     a block as lib/docx.mjs parseDocx reads it, numbers cut and bound
//
// readManuscriptText gives the documents with their blocks in order; putManuscriptDocs writes them back. The number check is the section
// `manuscriptCheck` (manuscriptCheckOf): every bound number rendered from its source now against its typed text, `match` (the same
// characters), `rounding` (the same number at the text's decimals by another rounding rule, or a text field's number at other decimals) or
// `differs`; numbers whose source cannot be read are `missing`. It keeps data only: counts, and for each number that did not match its place
// (document, block id, run), verdict, the value its source gives now and why; never a copy of the text or the binding. Both sections are read
// on demand (store.mjs ON_DEMAND) and covered by the history and the restore points like any data. Pure: sections, runs and values in; text
// and verdicts out.
import { numsOf } from './number-check.mjs';

export const MS_TEXT_KIND = 'lykos-manuscript-text';
export const MS_TEXT_V = 1;
export const MS_CHECK_KIND = 'lykos-manuscript-check';
export const MS_CHECK_V = 1;
export const ROLES = Object.freeze(['manuscript', 'supplement', 'letter', 'other']);
export const VERDICTS = Object.freeze(['match', 'rounding', 'differs', 'missing']);
export const DOC_ID = /^[A-Za-z][\w-]{0,39}$/;

const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const metaKey = id => `doc:${id}`, blockKey = (id, b) => `${id}/${b}`;

/** The section as read from a project: `{ kind, v, docs }`, each doc with its `blocks` in order; empty for nothing, `newer` for a newer Lykos's. */
export function readManuscriptText(x) {
  const o = obj(x);
  if (!o) return { kind: MS_TEXT_KIND, v: MS_TEXT_V, docs: [] };
  if (Number(o.v) > MS_TEXT_V) return { kind: o.kind, v: o.v, docs: [], newer: true };
  const docs = [];
  for (const id of Array.isArray(o.docs) ? o.docs : []) {
    const m = obj(o[metaKey(id)]);
    if (!m) continue;
    const { order = [], ...meta } = m;
    docs.push({ ...meta, id, blocks: (Array.isArray(order) ? order : []).map(b => o[blockKey(id, b)]).filter(obj) });
  }
  return { kind: MS_TEXT_KIND, v: MS_TEXT_V, docs };
}

/**
 * Documents `docs` ({ id, …, blocks }) written into the stored section `x` (made when null), each replacing the one with its id, its old
 * blocks' keys removed. A block's key is its own id (parseDocx gives one), or `b<n>` when it has none or repeats one. Returns `x`.
 */
export function putManuscriptDocs(x, docs) {
  const o = obj(x) || {};
  if (Number(o.v) > MS_TEXT_V) throw new Error('the manuscript text was written by a newer Lykos');
  o.kind = MS_TEXT_KIND; o.v = MS_TEXT_V;
  if (!Array.isArray(o.docs)) o.docs = [];
  for (const d of docs) {
    const old = obj(o[metaKey(d.id)]);
    for (const b of Array.isArray(old?.order) ? old.order : []) delete o[blockKey(d.id, b)];
    const { blocks = [], ...meta } = d, order = [], seen = new Set();
    blocks.forEach((b, i) => {
      let k = typeof b?.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : `b${i + 1}`;
      while (seen.has(k)) k = `${k}-${i + 1}`;
      seen.add(k); order.push(k);
      o[blockKey(d.id, k)] = b?.id === k ? b : { ...b, id: k };   // a block carries the id it is keyed by (the check names blocks by it)
    });
    o[metaKey(d.id)] = { ...meta, id: d.id, order };
    if (!o.docs.includes(d.id)) o.docs.push(d.id);
  }
  return o;
}

/** The section `manuscriptCheck` as read from a project, or null. */
export function readManuscriptCheck(x) {
  const o = obj(x);
  if (!o || o.kind !== MS_CHECK_KIND || !obj(o.counts)) return null;
  return Number(o.v) > MS_CHECK_V ? { ...o, newer: true } : { ...o, rows: Array.isArray(o.rows) ? o.rows.filter(obj) : [] };
}

// ---- the runs of a block, in the order the number check reads them -----------------------------------------------------------------
/** Every run of a block with where it stands: [{ run, list, k }] (`list` the array holding it), paragraphs then table cells row by row. */
export function runSlots(b) {
  const out = [];
  if (b?.type === 'table') for (const r of b.grid?.rows || []) for (const c of r.cells || []) (c.runs || []).forEach((run, k, list) => out.push({ run, list, k }));
  else (b?.runs || []).forEach((run, k, list) => out.push({ run, list, k }));
  return out;
}
/** Every bound run of a section (as readManuscriptText gives it): [{ doc, block, id, run }], `block` its index, `id` the block's id. */
export function boundRuns(sec) {
  const out = [];
  for (const d of sec?.docs || []) (d.blocks || []).forEach((b, block) => { for (const { run } of runSlots(b)) if (run?.n) out.push({ doc: d.id, block, id: b.id, run }); });
  return out;
}

// ---- numbers as the text writes them --------------------------------------------------------------------------------------------------
const MINUS = /^[-−–]/;
// every number of a text in order, repeats kept (a binding's `at` counts them as printed: "0.30 (0.30 to 0.92)" holds three)
export const numberList = t => String(t ?? '').replace(/[\u2212\u2013]/g, '-').replace(/\u00b7/g, '.').match(/-?\d+(?:\.\d+)?/g) || [];   // lint-allow-dot: the decimal point a manuscript prints ("0·34")
/** The numbers of a table cell, a grouped one read whole ("1,000,000" is one number; a cell lists no numbers as "12,345"). */
export const cellNumbers = t => numberList(String(t ?? '').replace(/(\d)[,\u00a0\u202f](?=\d{3}(?!\d))/g, '$1'));
/** How a typed number is written: `{ dp, point, minus, group, lt }`, or null for text that is not one number. */
export function numberFormat(text, before = '') {
  const t = String(text ?? '').trim();
  const m = /^([-−–]?)(\d{1,3}(?:([,   ])\d{3})+|\d+)(?:([.·])(\d+))?$/.exec(t);
  if (!m) return null;
  return { dp: m[5] ? m[5].length : 0, point: m[4] || '.', minus: m[1] || (m[4] === '\u00b7' ? '\u2212' : '-'), group: m[3] || '', ...(/[<≤]\s*$/.test(before) ? { lt: true } : {}) };   // lint-allow-dot: the decimal point
}
/** The number a typed text says, with "·" and "−" read. */
export const typedNumber = text => Number(String(text ?? '').trim().replace(MINUS, '-').replace(/[,   ]/g, '').replace('·', '.'));
/** `value` written as `fmt` writes numbers (toFixed rounding, the sign kept on a negative that rounds to zero as the run prints it). */
export function formatNumber(value, fmt) {
  const v = Number(value);
  if (!Number.isFinite(v) || !fmt) return null;
  let s = Math.abs(v).toFixed(fmt.dp);
  if (fmt.group) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, fmt.group) + (f != null ? `.${f}` : ''); }
  if (fmt.point !== '.') s = s.replace('.', fmt.point);
  return (v < 0 && /[1-9]/.test(s) ? fmt.minus : '') + s;
}

// ---- what a binding reads now ---------------------------------------------------------------------------------------------------------
/**
 * The current value of a binding: `{ value }` (a number) or `{ text }` (a number as a text field printed it), or `{ missing }` saying why
 * there is none. `sources`: `runs` Map(run id -> run) whose outputs carry `values` (lib/analysis-run.mjs), `values` the record's values
 * (s.values), `cells(output)` a Lykos output's rows of cell texts (all its groups in order), null when it cannot be drawn.
 */
export function bindingValue(n, sources = {}) {
  if (!obj(n)) return { missing: 'not bound' };
  if (n.src === 'run') {
    const run = sources.runs?.get?.(n.run);
    if (!run) return { missing: `run ${n.run} not read` };
    const o = (run.outputs || []).find(x => x.id === n.output);
    if (!o) return { missing: `${n.output} is not an output of ${n.run}` };
    if (n.at != null) { const t = numberList(o.values?.[n.field] ?? o[n.field] ?? '')[n.at]; return t != null ? { text: t } : { missing: `${n.output} ${n.field} has no number ${n.at + 1}` }; }
    const v = o.values?.[n.field];
    return typeof v === 'number' && Number.isFinite(v) ? { value: v } : { missing: `${n.output} has no ${n.field}` };
  }
  if (n.src === 'value') {
    const ids = Array.isArray(n.ids) ? n.ids : [], vs = ids.map(id => sources.values?.[id]).filter(Boolean);
    if (!vs.length) return { missing: 'value not in the record' };
    const nums = vs.map(v => (typeof v.normalized_value === 'number' ? v.normalized_value : typedNumber(numsOfFirst(v.reported_value))));
    return nums.every(x => Number.isFinite(x) && x === nums[0]) ? { value: nums[0] } : { missing: 'the values named disagree' };
  }
  if (n.src === 'output') {
    const rows = sources.cells?.(n.output);
    if (!rows) return { missing: `${n.output} not read` };
    const row = rows.filter(r => String(r?.[0] ?? '') === n.key)[n.nth || 0], t = row?.[n.col];
    if (t == null) return { missing: `${n.output} has no row ${n.key}${n.nth ? ` (${n.nth + 1})` : ''}` };
    const x = cellNumbers(t)[n.at ?? 0];
    return x != null ? { text: x } : { missing: `${n.output} cell has no number` };
  }
  if (n.src === 'dataset') {
    const d = (sources.datasets || []).find(x => x?.id === n.dataset);
    if (!d) return { missing: `dataset ${n.dataset} not in the project` };
    const kc = datasetKey(d), row = (d.rows || []).filter(r => String(r?.[kc] ?? '') === n.key)[n.nth || 0], t = row?.[n.col];
    if (t == null) return { missing: `${n.dataset} has no row ${n.key}${n.nth ? ` (${n.nth + 1})` : ''} with ${n.col}` };
    const x = cellNumbers(String(t))[n.at ?? 0];
    return x != null ? { text: x } : { missing: `${n.dataset} cell has no number` };
  }
  return { missing: n.src === 'named' ? 'typed' : 'unknown source' };
}
/** The column that keys a dataset's rows: its first column, else the first field of its first row. */
export const datasetKey = d => d?.columns?.[0]?.id || Object.keys(d?.rows?.[0] || {})[0] || '';
const numsOfFirst = t => [...numsOf(String(t ?? ''))][0] ?? '';

/** A bound run's text rendered from its source, and the verdict against its typed text. `{ text, verdict, value?, why? }`. */
export function renderNumber(run, sources = {}, before = '') {
  const typed = String(run?.t ?? ''), fmt = numberFormat(typed, run?.n?.lt ? '<' : before), now = bindingValue(run?.n, sources);
  if (now.missing) return { text: typed, verdict: 'missing', why: now.missing };
  if (!fmt) return { text: typed, verdict: 'missing', why: 'the typed text is not one number' };
  // a text field's number is read at its printed decimals and written as the text writes numbers
  const value = now.value ?? Number(now.text), text = formatNumber(value, fmt);
  if (text === typed.trim()) return { text, verdict: 'match', value };
  // "<0·001" says the value is below it
  if (fmt.lt && value < typedNumber(typed)) return { text: typed, verdict: 'match', value };
  const half = 0.5 * 10 ** -fmt.dp + 1e-9;
  if (Math.abs(typedNumber(typed) - value) <= half) return { text, verdict: 'rounding', value };
  return { text, verdict: 'differs', value };
}

/** The text before run `k` of `list` (for a "<" in front of a number). */
const beforeOf = (list, k) => String(list[k - 1]?.t ?? '').slice(-3);

/**
 * The section `manuscriptCheck`: every bound number of `sec` (as readManuscriptText gives it) rendered from its source against its typed
 * text. `{ kind, v, at, run, counts, byDoc, rows }`, `rows` the numbers that did not match, at most `max`: { doc, block (its id), k (the
 * run's place in the block, lib/manuscript-data.mjs runSlots), verdict, value? (what the source gives now), why? }.
 */
export function manuscriptCheckOf(sec, sources = {}, { at = new Date().toISOString(), run = '', max = 2000 } = {}) {
  const counts = Object.fromEntries([...VERDICTS, 'named'].map(v => [v, 0])), byDoc = {}, rows = [];
  for (const d of sec?.docs || []) {
    const c = byDoc[d.id] = Object.fromEntries([...VERDICTS, 'named'].map(v => [v, 0]));
    for (const b of d.blocks || []) {
      runSlots(b).forEach(({ run: r, list, k }, slot) => {
        if (!r?.n) return;
        if (r.n.src === 'named') { counts.named++; c.named++; return; }
        const x = renderNumber(r, sources, beforeOf(list, k));
        counts[x.verdict]++; c[x.verdict]++;
        if (x.verdict !== 'match' && rows.length < max) rows.push({ doc: d.id, block: b.id, k: slot, verdict: x.verdict, ...(Number.isFinite(x.value) ? { value: x.value } : {}), ...(x.why ? { why: x.why } : {}) });
      });
    }
  }
  return { kind: MS_CHECK_KIND, v: MS_CHECK_V, at, run, counts, byDoc, rows };
}

/** The run a check row names, in a section as readManuscriptText gives it: { doc, block, run } or null. */
export function checkRowRun(sec, row) {
  const d = (sec?.docs || []).find(x => x.id === row?.doc), b = d?.blocks.find(x => x.id === row.block), slot = b && runSlots(b)[row.k];
  return slot ? { doc: d, block: b, run: slot.run } : null;
}

/** A document's text with every bound number rendered from data: blocks as text, a table's cells joined by " | " (the check's reading). */
export function renderedText(doc, sources = {}) {
  return (doc?.blocks || []).map(b => runSlots(b).map(({ run, list, k }) => (run?.n && run.n.src !== 'named' ? renderNumber(run, sources, beforeOf(list, k)).text : String(run?.t ?? ''))).join(b.type === 'table' ? ' | ' : ''));
}

/** A copy of a document whose bound runs read as rendered from data (for the Word writer and the reader). */
export function renderedDoc(doc, sources = {}) {
  const copy = structuredClone(doc);
  for (const b of copy.blocks || []) for (const { run, list, k } of runSlots(b)) if (run?.n && run.n.src !== 'named') run.t = renderNumber(run, sources, beforeOf(list, k)).text;
  return copy;
}
