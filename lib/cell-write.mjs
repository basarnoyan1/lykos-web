// What a person types into an extraction cell, from whichever page holds the cell (plan G4). Extraction's grid and the Analysis
// page's input grid (views/analysis-grid.mjs) write through here, so a value typed in either is the same accepted extraction value:
// a locked value is refused (it changes only by amendment), in double extraction the text is the extractor's own entry, "NR" marks the
// value not reported, a proposal is accepted (edited when the text differs), an accepted value corrected by hand keeps its evidence and
// says what it was, and an empty cell takes a manual value.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_app_settings$byMe as byMe } from "../boot.mjs";
import { lib_fields$setManualStateValue as setManualStateValue, lib_fields$setAnchoredValue as setAnchoredValue, lib_fields$cellNumber as cellNumber, lib_fields$fieldById as fieldById, lib_fields$isLocked as isLocked } from "../boot.mjs";
import { proposalFor, accept, notReported, key as cellKey } from './proposals.mjs';
import { entriesOf, setEntry } from './double-extraction.mjs';
import { kindOf, parseValue, isNumericKind, KINDS } from './field-kinds.mjs';
import { vocabFor } from './vocabularies.mjs';

const numeric = c => c?.type === 'integer' || c?.type === 'number';
/** The text a cell holds as typed: "NR" for a value not reported, else the reported text, '' when empty. */
export const cellText = v => (v ? (v.availability === 'not_found' ? 'NR' : v.qualifier ? `${v.reported_value ?? ''} (${v.qualifier})` : String(v.reported_value ?? '')) : '');

/**
 * Writes `text` into the cell; returns '' or why it was not written. `double` is the extractor whose entry the text is ('A', 'B'),
 * 'compare' (nothing is typed while comparing), or null. `via` names a page other than Extraction: the write is added to the
 * extraction log with it, as the diagnostic table's are (lib/dta.mjs).
 */
export function writeCellValue(paperId, columnId, text, column, { table = 'default', double = null, via = '' } = {}) {
  const key = cellKey(paperId, columnId), t = String(text ?? '').trim();
  const v = get().values?.[key], pr = proposalFor(paperId, columnId);
  if (v?.locked || isLocked(get(), key)) return 'Locked: amend it in Extraction';
  if (double) {
    if (double !== 'compare' && t !== (entriesOf(get(), key)[double]?.value ?? '')) { setEntry(key, double, t); logged(key, via, entriesOf(get(), key)[double]?.value ?? null, t, `entry ${double}`); }
    return '';
  }
  const was = cellText(v);
  if (/^nr$/i.test(t)) { if (was !== 'NR') { notReported(paperId, columnId); logged(key, via, was || null, 'NR'); } return ''; }
  // a proposal over no value, or a value read again as its field's new kind (mode 'retype', lib/field-retype.mjs): typing it accepts it
  if (pr && (!v || pr.mode === 'retype')) {
    if (!t) return '';
    const shownText = (pr.qualifier ? `${pr.value} (${pr.qualifier})` : String(pr.value)).trim();
    try { accept(paperId, columnId, t === shownText || t === String(pr.value).trim() ? {} : { editedValue: t }); } catch (err) { return err.message; }
    logged(key, via, v ? was : null, t, 'proposal accepted');
    return '';
  }
  if (!t || t === was) return '';
  // a kind with a reading (lib/field-kinds.mjs): the value is read as the kind and a bracketed qualifier kept as its note; a number
  // that does not read keeps the old lenient path (the cell rules flag it), any other kind refuses the text
  const kind = kindOf(column);
  let shown = t, note = '', typed;
  if (kind !== 'text') {
    const r = parseValue(t, column, vocabFor(get(), column));
    if (!r.ok && !isNumericKind(kind) && !(kind === 'category' && !column.vocabulary)) return `Not a value of this field (${KINDS.find(k => k[0] === kind)[1].toLowerCase()})`;
    if (r.ok && r.nr) { notReported(paperId, columnId); logged(key, via, was || null, 'NR'); return ''; }
    if (r.ok && (!isNumericKind(kind) || r.split)) { shown = r.shown; note = r.note; typed = r.value; }
  }
  const n = typed === undefined && numeric(column) ? cellNumber(t, column.type) : NaN;
  const normalized = typed !== undefined ? typed : Number.isFinite(n) ? (column.type === 'integer' ? Math.round(n) : n) : t;
  if (v && (v.evidence?.length || v.origin !== 'manual')) {
    setAnchoredValue(paperId, columnId, { reported_value: shown, normalized_value: normalized, qualifier: note, origin: 'manual', extractor: 'manual (edited)', evidence: v.evidence || [], rationale: `Edited by hand; was “${was.slice(0, 200)}”` });
  } else if (table === 'default') update(s => { setManualStateValue(s, paperId, columnId, shown, { type: fieldById(columnId)?.type || column?.type || 'text', ...(typed !== undefined ? { normalized: typed } : {}), qualifier: note }); return s; });
  else setAnchoredValue(paperId, columnId, { reported_value: shown, normalized_value: normalized, qualifier: note, origin: 'manual', extractor: 'manual', evidence: [] });
  logged(key, via, was || null, t);
  return '';
}

function logged(key, via, from, to, note = '') {
  if (!via) return;
  update(s => { s.extractionLog = [...(s.extractionLog || []), { key, action: `typed in ${via}${note ? ` (${note})` : ''}`, from, to, by: byMe(s), at: new Date().toISOString() }].slice(-2000); return s; });
}
