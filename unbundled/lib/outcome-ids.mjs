// How an outcome entry is named inside a cell id (lib/outcome-store.mjs): "column~entry", the arm already split off (lib/arms.mjs). The shell's
// field lookups (lib/fields.mjs) split a cell id on every draw, so this part loads with them; the entries themselves and the instrument list
// they are coded against (lib/instruments.mjs) load with the views that read them. lib/outcome-store.mjs re-exports these.
export const ENTRY_SEP = '~';

/** A cell id ("column~entry", arm already split off) split into the column and the entry; entry null for an ordinary cell. */
export function splitEntry(cellId) {
  const id = String(cellId || ''), at = id.lastIndexOf(ENTRY_SEP);
  return at < 0 ? { column: id, entry: null } : { column: id.slice(0, at), entry: id.slice(at + 1) };
}
