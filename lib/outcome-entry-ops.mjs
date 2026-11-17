// Adding an outcome entry and recoding its instrument on a state, with no store (plan G3a; Fable review F34, 9 Nov 2026). The app's
// dialogs (lib/outcome-edit.mjs) and the change-file ops add_outcome and recode_outcome (lib/change-file.mjs, applied by the CLI's
// lykos-apply and the MCP's files › apply) make the same entry: its id, its descriptor columns, and the instrument (and time) in every
// cell the grid draws for it, each arm's. The app writes those cells as a person's typed values; a change file writes them here.
import { entriesOf, hasOutcomeRows, outcomeColumn, outcomeColumnId, ensureOutcomeRows, nextEntryId, ENTRY_SEP } from './outcome-store.mjs';
import { instrumentOf } from './instruments.mjs';

/**
 * Adds an entry to a study's outcomes and answers its id (the next free one). The entry is the table's structure; its instrument and time
 * are values written into its cells, never set here. The descriptor columns it needs are added when missing. Reducer on the table.
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

export const tableOf = (s, table) => (s.templates || []).find(t => t.id === table) || null;
const LOCKED = 'Locked: amend it in Extraction';

/** Why an outcome cannot be added to the study, or ''. */
export function addProblem(s, table, paperId, instrument) {
  const t = tableOf(s, table);
  if (!t || !hasOutcomeRows(t)) return 'This table keeps no outcome entries';
  if (!(s.papers || []).some(p => p.id === paperId)) return 'No such study';
  if (!instrumentOf(s, instrument)) return 'Choose an instrument from the list';
  return '';
}
/** Why the entry's instrument cannot be coded again, or ''. */
export function recodeProblem(s, table, paperId, entry, instrument) {
  const t = tableOf(s, table);
  if (!t || !entriesOf(t, paperId).some(e => e.id === entry)) return 'No such outcome';
  if (!instrumentOf(s, instrument)) return 'Choose an instrument from the list';
  if (entryCells(s, t, paperId, entry, 'instrument').some(cell => s.values?.[`${paperId}:${cell}`]?.locked)) return LOCKED;
  return '';
}

/**
 * Writes `text` into every cell of the entry's descriptor `key` as an agent's value, built afresh as a cell typed in is: a value with evidence
 * keeps only the evidence and says what it was (as a cell edited by hand does, lib/cell-write.mjs), never the old check or qualifier. All or none: a locked cell refuses the whole write. Answers '' or why. `put(key, record)`
 * stores a value: the caller is a writer of values (lib/change-file.mjs), this module only builds them.
 */
function writeEntryAs(s, t, paperId, entry, key, text, { by = 'agent', at = new Date().toISOString(), put }) {
  const cells = entryCells(s, t, paperId, entry, key);
  if (cells.some(cell => s.values?.[`${paperId}:${cell}`]?.locked)) return LOCKED;
  const field = outcomeColumnId(t.id, key);
  for (const cell of cells) {
    const k = `${paperId}:${cell}`, was = s.values[k], arm = cell.includes('@') ? cell.slice(cell.indexOf('@') + 1) : '';
    if (was && String(was.reported_value ?? '') === text) continue;
    put(k, { paper_id: paperId, study_id: paperId, field_id: field, entry, ...(arm ? { arm } : {}), reported_value: text, normalized_value: text,
      availability: 'present', origin: 'imported', extractor: by, verification: 'accepted', at,
      ...(was?.evidence?.length ? { evidence: was.evidence, rationale: `Recoded by ${by}; was “${String(was.reported_value ?? '').slice(0, 200)}”` } : {}) });
  }
  return '';
}

/**
 * Adds an outcome to a study on the state: an entry measured with `instrument` (a code of the project's scales) at `time` (as the paper
 * words it, optional). Answers { entry } or { problem }; a refused write leaves the state as it was.
 */
export function addOutcomeIn(s, table, paperId, { instrument = '', time = '' } = {}, { by = 'agent', at = new Date().toISOString(), put }) {
  const problem = addProblem(s, table, paperId, instrument);
  if (problem) return { problem };
  const t = tableOf(s, table), entry = addEntry(t, paperId, { at, by });
  const why = writeEntryAs(s, t, paperId, entry, 'instrument', instrument, { by, at, put }) || (String(time).trim() ? writeEntryAs(s, t, paperId, entry, 'time', String(time).trim(), { by, at, put }) : '');
  return why ? { problem: why } : { entry };
}
/** Codes an entry's instrument again on the state, in every cell of the entry. Answers '' or why it was not written. */
export function recodeOutcomeIn(s, table, paperId, entry, instrument, { by = 'agent', at = new Date().toISOString(), put }) {
  const problem = recodeProblem(s, table, paperId, entry, instrument);
  return problem || writeEntryAs(s, tableOf(s, table), paperId, entry, 'instrument', instrument, { by, at, put });
}
