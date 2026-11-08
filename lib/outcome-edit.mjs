// Adding an outcome entry and recoding its instrument, as a person does from the extraction grid (plan G3a). The entry is the table's
// structure (lib/outcome-store.mjs addEntry); its instrument and time are the person's own values, written through lib/cell-write.mjs as a
// cell typed in is (G4): a value with a source keeps its evidence and says what it was, a locked one is refused, and in double extraction
// the text is the extractor's own entry. A recode writes the instrument into every cell of the entry the grid draws (each arm's), so the
// entry keeps one instrument.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_app_settings$byMe as byMe } from "../boot.mjs";
import { writeCellValue } from './cell-write.mjs';
import { lib_fields$isLocked as isLocked } from "../boot.mjs";
import { entriesOf, hasOutcomeRows, outcomeColumn, outcomeColumnId, ensureOutcomeRows, nextEntryId, ENTRY_SEP } from './outcome-store.mjs';
import { instrumentOf } from './instruments.mjs';

/**
 * Adds an entry to a study's outcomes and answers its id (the next free one). The entry is the table's structure; its instrument and time
 * are values a person writes into its cells (lib/outcome-edit.mjs), never set here. The descriptor columns it needs are added when missing.
 * Reducer on the table.
 */
export function addEntry(t, paperId, { at = '', by = '' } = {}) {
  const rows = ensureOutcomeRows(t), id = nextEntryId(t, paperId);
  for (const key of ['instrument', 'time']) if (!(t.columns ||= []).some(c => c.id === outcomeColumnId(t.id, key))) t.columns.push(outcomeColumn(t.id, key));
  rows.entries[paperId] = [...entriesOf(t, paperId), { id, added: { ...(at ? { at } : {}), ...(by ? { by } : {}) } }];
  return id;
}
/**
 * The cells of an entry's descriptor (`key`, e.g. 'instrument') a write reaches: one per arm, as the grid draws the entry's lines, or the
 * study's own when it has no arms; and the entry's study-level cell beside the arms' when it holds a value. Cell ids "column~o1@arm2".
 */
export function entryCells(s, t, paperId, entry, key) {
  const col = outcomeColumnId(t.id, key), arms = t?.arms?.[paperId] || [], own = `${col}${ENTRY_SEP}${entry}`;
  const cells = arms.length ? arms.map(a => `${own}@${a.id}`) : [own];
  if (arms.length && s?.values?.[`${paperId}:${own}`]) cells.unshift(own);
  return cells;
}

const tableOf = (s, table) => (s.templates || []).find(t => t.id === table) || null;
const columnOf = (t, key) => (t.columns || []).find(c => c.id === outcomeColumnId(t.id, key)) || outcomeColumn(t.id, key);

/** Writes `text` into each of the entry's cells of the descriptor `key`, or none of them: a locked cell refuses the whole write. Answers '' or why. */
function writeEntry(table, paperId, entry, key, text, double) {
  const s = get(), t = tableOf(s, table), column = columnOf(t, key), cells = entryCells(s, t, paperId, entry, key);
  if (cells.some(cell => s.values?.[`${paperId}:${cell}`]?.locked || isLocked(s, `${paperId}:${cell}`))) return 'Locked: amend it in Extraction';
  for (const cell of cells) {
    const why = writeCellValue(paperId, cell, text, column, { table, double });
    if (why) return why;
  }
  return '';
}

/**
 * Adds an outcome to a study: an entry measured with `instrument` (a code of the project's instrument list) at `time` (as the paper words
 * it, optional). Answers { entry } or { problem }.
 */
export function addOutcome(table, paperId, { instrument = '', time = '' } = {}, { double = null } = {}) {
  const s = get(), t = tableOf(s, table);
  if (!t || !hasOutcomeRows(t)) return { problem: 'This table keeps no outcome entries' };
  if (!(s.papers || []).some(p => p.id === paperId)) return { problem: 'No such study' };
  if (!instrumentOf(s, instrument)) return { problem: 'Choose an instrument from the list' };
  let entry = '';
  update(st => { entry = addEntry(tableOf(st, table), paperId, { at: new Date().toISOString(), by: byMe(st) }); return st; });
  const why = writeEntry(table, paperId, entry, 'instrument', instrument, double) || (String(time).trim() ? writeEntry(table, paperId, entry, 'time', String(time).trim(), double) : '');
  if (!why) return { entry };
  // a refused write leaves no entry behind: the entry and what was written into it go
  update(st => { const tt = tableOf(st, table); tt.outcomeRows.entries[paperId] = entriesOf(tt, paperId).filter(e => e.id !== entry);
    for (const k of Object.keys(st.values || {})) if (k.startsWith(`${paperId}:`) && k.slice(k.indexOf(':') + 1).split('@')[0].endsWith(`~${entry}`)) delete st.values[k]; return st; });
  return { problem: why };
}

/** Codes an entry's instrument again, in every cell of the entry. Answers '' or why it was not written. */
export function recodeOutcome(table, paperId, entry, instrument, { double = null } = {}) {
  const s = get(), t = tableOf(s, table);
  if (!t || !entriesOf(t, paperId).some(e => e.id === entry)) return 'No such outcome';
  if (!instrumentOf(s, instrument)) return 'Choose an instrument from the list';
  return writeEntry(table, paperId, entry, 'instrument', instrument, double);
}
