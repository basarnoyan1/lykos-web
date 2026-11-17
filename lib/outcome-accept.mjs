// Accepting one outcome-row proposal (lib/outcome-migrate.mjs makes them): the value moves to its entry with its proof record and its places on
// the verification lists. Apart from the plan, which reads cells with the change rows' rules, so the proposal review loads only this.
import { lib_fields$moveStateValue as moveStateValue } from "../boot.mjs";
import { lib_arms$splitCellId as splitCellId } from "../boot.mjs";

const suffix = id => String(id).slice(String(id).indexOf('.') + 1);
const proofKey = key => { const rest = key.slice(key.indexOf(':') + 1), { columnId, arm } = splitCellId(rest); return `${suffix(columnId)}${arm ? `@${arm}` : ''}`; };
/** The proof record and the verification-list places of a value follow it to its new key. `items`: a Map old item id → [list item] (built once for many). */
export function carryRecords(s, from, to, items = null) {
  const pid = from.slice(0, from.indexOf(':')), fields = s.valueChecks?.studies?.[pid]?.fields;
  if (fields) { const a = proofKey(from), b = proofKey(to); if (fields[a] && !fields[b]) { fields[b] = fields[a]; delete fields[a]; } }
  const hits = items ? items.get(`value:${from}`) || [] : Object.values(s.verification?.lists || {}).flatMap(l => (l.items || []).filter(i => i.id === `value:${from}`));
  for (const i of hits) i.id = `value:${to}`;
}
/**
 * Accepts one restructure proposal (lib/proposals.mjs accept calls this inside update). Reducer. True when the value moved; the proposal is
 * dropped either way when its value is gone or its text changed since (it no longer says what it proposed).
 */
export function acceptOutcomeRow(s, newKey, { at = new Date().toISOString(), by = '', items = null } = {}) {
  const p = s.proposals?.[newKey]; if (!p || p.mode !== 'restructure') return false;
  const done = moveStateValue(s, p.from, newKey, { was: p.was, nr: p.nr ? { qualifier: p.qualifier || '' } : null, column: p.column, at, by });
  if (done) carryRecords(s, p.from, newKey, items);
  if (done || !s.values?.[p.from] || String(s.values[p.from].reported_value ?? '') !== p.was) delete s.proposals[newKey];
  return done;
}
