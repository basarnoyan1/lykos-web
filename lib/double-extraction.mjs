// Double extraction (plan G4): two people extract the same cells
// independently, the app compares them, and a final value is chosen per cell
// with its reason, then locked.
//
// `s.doubleExtraction = { on: true, entries: { [cellKey]: { A: entry, B: entry } } }`
// where an entry is `{ value, at, evidence?, from? }` — what that extractor
// typed or took from a proposal. Entries are not accepted values: nothing
// reads them but this module and the Extraction view. A final value reaches
// `s.values` only through lib/fields.mjs (setAnchoredValue), carrying a
// `resolution` that records both entries, which was taken and why; a lint
// rule refuses any other writer of values.
import { get, update } from '../store.mjs';
import { setAnchoredValue, cellNumber, isLocked } from './fields.mjs';
import { splitCellId } from './arms.mjs';

export const EXTRACTORS = ['A', 'B'];
export const doubleOn = (s = get()) => Boolean(s.doubleExtraction?.on);
export const entriesOf = (s, key) => s.doubleExtraction?.entries?.[key] || {};

/** Turns double extraction on or off; entries are kept either way. */
export function setDouble(on) {
  update(s => { s.doubleExtraction = { entries: {}, ...(s.doubleExtraction || {}), on: Boolean(on) }; return s; });
}

/** Records one extractor's entry for a cell; an empty text removes it. */
export function setEntry(key, who, text, { evidence = [], from = 'manual' } = {}) {
  if (!EXTRACTORS.includes(who)) return;
  const t = String(text ?? '').trim();
  update(s => {
    const d = s.doubleExtraction = { on: true, entries: {}, ...(s.doubleExtraction || {}) };
    d.entries = { ...(d.entries || {}) };
    const cell = { ...(d.entries[key] || {}) };
    if (t) cell[who] = { value: t, at: new Date().toISOString(), from, ...(evidence.length ? { evidence } : {}) };
    else delete cell[who];
    if (Object.keys(cell).length) d.entries[key] = cell; else delete d.entries[key];
    return s;
  });
}

// Two entries agree when they say the same thing: the same number for a
// number column ("1,234" and "1234"), the same words for text, ignoring case
// and spacing.
const norm = t => String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
export function agrees(a, b, type = 'text') {
  if (a == null || b == null) return false;
  if (type === 'number' || type === 'integer') {
    const x = cellNumber(a, type), y = cellNumber(b, type);
    if (Number.isFinite(x) && Number.isFinite(y)) return x === y;
  }
  return norm(a) === norm(b);
}

/**
 * A cell compared: A's and B's entries, their state and the final value.
 * state: 'none' (no entry), 'one' (only one extractor), 'agree', 'differ';
 * final: 'open', 'resolved' (a final value from these entries), 'changed'
 * (an entry changed after the final value was chosen), 'locked'.
 */
export function compareCell(s, key, column = {}) {
  const e = entriesOf(s, key), a = e.A?.value ?? null, b = e.B?.value ?? null;
  const state = a == null && b == null ? 'none' : a == null || b == null ? 'one' : agrees(a, b, column.type) ? 'agree' : 'differ';
  const v = s.values?.[key], r = v?.resolution;
  const final = !v || !r ? 'open' : r.a !== a || r.b !== b ? 'changed' : v.locked ? 'locked' : 'resolved';
  return { key, a, b, state, final, value: v || null };
}

/** Every cell with an entry among these studies and cells: [{ paperId, cellId, ...compareCell }]. */
export function compareTable(s, papers, cellIds) {
  const out = [];
  for (const p of papers) for (const id of cellIds(p)) {
    const key = `${p.id}:${id}`;
    if (!s.doubleExtraction?.entries?.[key]) continue;
    out.push({ paperId: p.id, cellId: id, ...compareCell(s, key, {}) });
  }
  return out;
}

/** Counts for the compare bar: cells with two entries, agreeing, differing, with one entry, resolved. */
export function agreementSummary(list) {
  const both = list.filter(x => x.state === 'agree' || x.state === 'differ');
  return { cells: list.length, both: both.length, agree: both.filter(x => x.state === 'agree').length,
    differ: both.filter(x => x.state === 'differ').length, one: list.filter(x => x.state === 'one').length,
    open: list.filter(x => x.final === 'open' || x.final === 'changed').length };
}

/**
 * The final value of a cell from the two entries: `pick` 'A' or 'B', or
 * 'edit' with its own text. Agreeing entries need no reason; a pick between
 * differing entries, or an edit, does. Returns false when refused (no reason,
 * no text, a locked value).
 */
export function resolveCell(paperId, cellId, column, { pick, text = null, reason = '' }) {
  const key = `${paperId}:${cellId}`, s = get();
  if (isLocked(s, key)) return false;
  const c = compareCell(s, key, column), why = String(reason || '').trim();
  const chosen = pick === 'A' ? c.a : pick === 'B' ? c.b : String(text ?? '').trim();
  if (chosen == null || chosen === '') return false;
  const agreed = c.state === 'agree' && pick !== 'edit';
  if (!agreed && !why) return false;
  const e = entriesOf(s, key);
  const evidence = [...(e[pick]?.evidence || e.A?.evidence || []), ...(pick === 'edit' ? e.B?.evidence || [] : [])];
  const numeric = column.type === 'number' || column.type === 'integer', n = numeric ? cellNumber(chosen, column.type) : NaN;
  const { columnId } = splitCellId(cellId);
  return setAnchoredValue(paperId, cellId, {
    reported_value: chosen, normalized_value: Number.isFinite(n) ? (column.type === 'integer' ? Math.round(n) : n) : chosen,
    origin: 'manual', extractor: agreed ? 'double:agreed' : `double:${pick === 'edit' ? 'edited' : pick}`, evidence,
    rationale: agreed ? `Extractors A and B agreed: “${c.a}”` : `A: “${c.a ?? '—'}”; B: “${c.b ?? '—'}”; ${pick === 'edit' ? 'edited' : `${pick} taken`}: ${why}`,
    resolution: { a: c.a, b: c.b, pick: agreed ? 'agreed' : pick, reason: why, column: columnId, at: new Date().toISOString() },
  });
}

/** Every agreeing cell without a final value gets one; returns how many. */
export function acceptAgreed(list, columnOf) {
  let n = 0;
  for (const x of list) if (x.state === 'agree' && (x.final === 'open' || x.final === 'changed') && resolveCell(x.paperId, x.cellId, columnOf(x.cellId), { pick: 'A' })) n++;
  return n;
}
