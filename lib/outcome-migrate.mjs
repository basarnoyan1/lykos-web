// A wide table's numbered outcome columns (o1_outcome, o1_change_sd, … o3_source) turned into outcome entries (lib/outcome-store.mjs;
// plan G3, G3a, amended 2026-11-07), through proposals.
//
// propose: each value of an `oK_` column becomes a proposal of mode 'restructure' at its new key (the statistic's column, the entry `oK`,
// the same arm), and the table gains the outcome columns those values need and an entry per study and group. Nothing moves yet. accept
// (one proposal, or all of a table) moves the value with nothing of it lost (lib/fields.mjs moveStateValue: text, origin, extractor,
// evidence, verification, lock), moves its proof record (s.valueChecks) and its places on the verification lists, and records where it was.
// When no value is left in a numbered column, the column goes. The entry keeps the group's id (o1), so the change synthesis's settings that
// name a group (primary endpoints, "Study|o1") still name it; the id is never shown.
//
// What the move reads: an SD column's cell is filed under the statistic it is, by the change rows' own rule (lib/change-rows.mjs sdCell:
// the cell's words, else the group's dispersion column): SD, SE, IQR, CI or range; a cell whose type is unclear stays under SD, the
// column it was written in, and its proposal says so. A mean written "median …" is a median. A value written "NR" or "NR (…)" becomes
// not reported, the bracketed words its qualifier. A group whose outcome is not reported in any arm is an entry marked `none`: its values
// are kept, and the outcome views leave it out.
import { sdCell, nCell, isMissing } from './change-rows.mjs';
import { outcomeColumn, outcomeColumnId, outcomeColumnDef, entryKey, ensureOutcomeRows, entriesOf, OUTCOME_COLUMNS, splitEntry } from './outcome-store.mjs';
import { acceptOutcomeRow } from './outcome-accept.mjs';
export { acceptOutcomeRow };
import { lib_arms$splitCellId as splitCellId } from "../boot.mjs";

const WIDE = /(?:^|[._])(o\d+)_([a-z][a-z_]*)$/;
const str = v => String(v ?? '').trim();
const suffix = id => String(id).slice(String(id).indexOf('.') + 1);

/** The table's numbered outcome columns: [{ id, slot: 'o1', key: 'baseline_sd', label }]. */
export function wideColumns(t) {
  const out = [];
  for (const c of t?.columns || []) { if (c.group === 'outcome') continue; const m = WIDE.exec(c.id); if (m) out.push({ id: c.id, slot: m[1], key: m[2], label: c.label || c.id }); }
  return out;
}
const NR_TEXT = /^NR(?: \((.*)\))?$/s;
/** Where a wide value goes: { key (the outcome column's key), why }. `disp` is the group's dispersion text for the arm, `n` its count text. */
export function targetOf(key, text, { disp = '', nText = '' } = {}) {
  const m = /^(baseline|end|change)_(mean|sd)$/.exec(key);
  if (!m) return { key, why: '' };
  const [, point, stat] = m;
  if (stat === 'mean') return /^median\b/i.test(text) ? { key: `${point}_median`, why: 'written as a median' } : { key, why: '' };
  if (isMissing(text)) return { key, why: '' };
  const n = nCell(nText), type = sdCell(text, point, disp, n.n, n.known).type;
  const to = { SD: 'sd', SE: 'se', IQR: 'iqr', CI: 'ci', range: 'range' }[type];
  if (!to) return { key, why: 'its type is unclear, so it stays under SD where it was written' };
  return { key: `${point}_${to}`, why: to === 'sd' ? '' : /\b(SE|SEM|IQR|CI|CrI|range)\b/.test(text) ? `the cell says ${type}` : `the dispersion column says ${type}` };
}

/**
 * What turning a table's numbered outcome columns into entries would do. Pure. { table, entries: { paper: [{ id, from, none? }] },
 * columns: [outcome column keys], proposals: { newKey: record }, locked: [old keys moved with their lock], pending: [old keys holding another
 * proposal, left], taken: [new keys already holding a value, left] }.
 */
export function outcomeRowsPlan(s, tableId, { now = new Date().toISOString() } = {}) {
  const t = (s.templates || []).find(x => x.id === tableId);
  const out = { table: tableId, entries: {}, columns: [], proposals: {}, locked: [], pending: [], taken: [] };
  if (!t) return out;
  const wide = wideColumns(t); if (!wide.length) return out;
  const byId = new Map(wide.map(w => [w.id, w])), V = s.values || {}, keys = new Set(), groups = new Map();
  // the cells of every numbered column, by study, group and arm
  for (const [k, v] of Object.entries(V)) {
    const at = k.indexOf(':'); if (at < 0) continue;
    const { columnId, arm } = splitCellId(k.slice(at + 1)), w = byId.get(columnId); if (!w) continue;
    const pid = k.slice(0, at), g = `${pid}\u0000${w.slot}`;
    if (!groups.has(g)) groups.set(g, { pid, slot: w.slot, cells: [] });
    groups.get(g).cells.push({ k, v, w, arm });
  }
  const textAt = (cells, key, arm) => str((cells.find(c => c.w.key === key && c.arm === arm) || cells.find(c => c.w.key === key && !c.arm))?.v?.reported_value);
  for (const g of [...groups.values()].sort((a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : a.slot.localeCompare(b.slot, 'en', { numeric: true })))) {
    const outcomes = g.cells.filter(c => c.w.key === 'outcome'), none = !outcomes.some(c => !isMissing(str(c.v?.reported_value)));
    (out.entries[g.pid] ||= []).push({ id: g.slot, from: g.slot, ...(none ? { none: true } : {}) });
    for (const c of g.cells) {
      const text = str(c.v?.reported_value), to = targetOf(c.w.key, text, { disp: textAt(g.cells, 'dispersion', c.arm), nText: textAt(g.cells, /^change/.test(c.w.key) ? 'end_n' : `${c.w.key.split('_')[0]}_n`, c.arm) });
      const newKey = entryKey(g.pid, outcomeColumnId(tableId, to.key), g.slot, c.arm);
      if (s.proposals?.[c.k]) { out.pending.push(c.k); continue; }
      if (V[newKey]) { out.taken.push(newKey); continue; }
      if (c.v?.locked) out.locked.push(c.k);
      keys.add(to.key);
      const nr = c.v?.availability !== 'not_found' && NR_TEXT.exec(String(c.v?.reported_value ?? '')), def = outcomeColumnDef(to.key);
      const newLabel = def?.label || to.key;
      out.proposals[newKey] = { paper_id: g.pid, column_id: newKey.slice(newKey.indexOf(':') + 1), mode: 'restructure', origin: 'restructure', from: c.k, column: c.w.id,
        was: String(c.v?.reported_value ?? ''), value: nr ? 'NR' : String(c.v?.reported_value ?? ''), availability: nr || c.v?.availability === 'not_found' ? 'not_found' : 'present',
        ...(nr && nr[1] ? { qualifier: nr[1] } : {}), ...(nr ? { nr: true } : {}), evidence: c.v?.evidence || [],
        rationale: `${c.w.label} is the ${newLabel.toLowerCase()} of this outcome${to.why ? `: ${to.why}` : ''}${nr ? '; "NR" read as not reported' : ''}.`, at: now };
    }
  }
  out.columns = OUTCOME_COLUMNS.map(c => c.key).filter(k => keys.has(k)).concat([...keys].filter(k => !outcomeColumnDef(k)));
  return out;
}

/** Proposes the move: the plan's columns and entries join the table, its proposals join s.proposals. Reducer. Returns the plan. */
export function proposeOutcomeRows(s, tableId, opts) {
  const plan = outcomeRowsPlan(s, tableId, opts), t = (s.templates || []).find(x => x.id === tableId);
  if (!t || !Object.keys(plan.proposals).length) return plan;
  const have = new Set((t.columns || []).map(c => c.id)), add = plan.columns.map(k => outcomeColumn(tableId, k)).filter(c => !have.has(c.id));
  const first = (t.columns || []).findIndex(c => WIDE.test(c.id) && c.group !== 'outcome');
  t.columns = first < 0 ? [...(t.columns || []), ...add] : [...t.columns.slice(0, first), ...add, ...t.columns.slice(first)];
  const store = ensureOutcomeRows(t);
  for (const [pid, list] of Object.entries(plan.entries)) {
    const ids = new Set(entriesOf(t, pid).map(e => e.id));
    store.entries[pid] = [...entriesOf(t, pid), ...list.filter(e => !ids.has(e.id))];
  }
  s.proposals = { ...(s.proposals || {}), ...plan.proposals };
  return plan;
}

/** Removes the numbered columns that hold no value and no proposal; when none is left the store records when. Reducer. Returns the ids removed. */
export function finishOutcomeRows(s, tableId, { at = new Date().toISOString() } = {}) {
  const t = (s.templates || []).find(x => x.id === tableId); if (!t) return [];
  const wide = new Set(wideColumns(t).map(w => w.id)), held = new Set();
  for (const k of [...Object.keys(s.values || {}), ...Object.keys(s.proposals || {})]) {
    const rest = k.slice(k.indexOf(':') + 1), { columnId } = splitCellId(rest); if (wide.has(columnId)) held.add(columnId);
  }
  for (const p of Object.values(s.proposals || {})) if (p?.mode === 'restructure' && wide.has(p.column)) held.add(p.column);
  const gone = [...wide].filter(id => !held.has(id));
  if (gone.length) t.columns = t.columns.filter(c => !gone.includes(c.id));
  if (!wideColumns(t).length && t.outcomeRows) t.outcomeRows.migratedAt = at;
  return gone;
}
/**
 * Accepts every restructure proposal of a table and finishes it, recording the decision in the store (`decisions`: { at, by, text, moved,
 * notReported, refiled }). Reducer. `decision` is the words that say who decided and why ("Decided by Claude on the owner's instruction").
 */
export function acceptOutcomeRows(s, tableId, { by = '', decision = '', at = new Date().toISOString() } = {}) {
  const items = new Map();
  for (const l of Object.values(s.verification?.lists || {})) for (const i of l.items || []) if (String(i.id).startsWith('value:')) (items.get(i.id) || items.set(i.id, []).get(i.id)).push(i);
  const keys = Object.entries(s.proposals || {}).filter(([k, p]) => p?.mode === 'restructure' && k.includes(`:${tableId}.`)).map(([k]) => k);
  let moved = 0, notReported = 0, refiled = 0;
  for (const k of keys) {
    const p = s.proposals[k], from = suffix(splitCellId(p.from.slice(p.from.indexOf(':') + 1)).columnId).replace(/^o\d+_/, ''), to = splitEntry(suffix(splitCellId(k.slice(k.indexOf(':') + 1)).columnId)).column.replace(/^out_/, '');
    if (acceptOutcomeRow(s, k, { at, by, items })) { moved++; if (p.nr) notReported++; if (from !== to) refiled++; }
  }
  const removed = finishOutcomeRows(s, tableId, { at });
  const t = (s.templates || []).find(x => x.id === tableId);
  if (t?.outcomeRows && moved) (t.outcomeRows.decisions ||= []).push({ at, by, text: decision, moved, notReported, refiled, removed: removed.length });
  return { moved, notReported, refiled, removed, left: keys.length - moved };
}
