// Changing a field's kind, and reading its values again as the new kind through proposals (data-model plan S1, step 1).
//
// A field's kind changes at once; its values do not. Each value that the new kind reads differently (a note split off, a text matched to
// a code, a list of countries) becomes a proposal of mode 'retype' that a person accepts or rejects in the ordinary proposal review
// (lib/proposals.mjs accept); a value no reading fits is listed for the person to edit. Nothing is rewritten silently. Pure reducers on
// the project state, apart from the store-backed wrappers at the end.
import { isKind, kindOf, parseValue, isListKind, usesLevels, KINDS } from './field-kinds.mjs';
import { vocabFor, vocabularyById } from './vocabularies.mjs';
import { schema$FIELDS as FIELDS } from "../boot.mjs";

const BUILT_IN = new Set(FIELDS.map(f => f.id));
/** Where a review's own field is defined: { field, set(next) } for a custom field or a table's column; null for a built-in one. */
export function definitionOf(s, fieldId) {
  if (BUILT_IN.has(fieldId)) return null;
  const ci = (s.customFields || []).findIndex(f => f.id === fieldId);
  if (ci >= 0) return { field: s.customFields[ci], set: f => { s.customFields = s.customFields.map((x, i) => (i === ci ? f : x)); } };
  for (const t of s.templates || []) {
    const i = (t.columns || []).findIndex(c => c.id === fieldId);
    if (i >= 0) return { field: t.columns[i], set: f => { t.columns = t.columns.map((x, j) => (j === i ? f : x)); } };
  }
  return null;
}
/** The fields (custom and table columns) that take their levels from a vocabulary. */
export function fieldsNaming(s, vocabId) {
  const all = [...(s.customFields || []), ...(s.templates || []).flatMap(t => t.columns || [])];
  return all.filter(f => f.vocabulary === vocabId).map(f => f.id);
}

/**
 * Sets a field's kind (and the vocabulary or options of a category kind). Returns '' or why it was refused. Values are untouched: call
 * proposeRetype next. The field's arm columns, guidance and other attributes stay.
 */
export function setFieldKind(s, fieldId, { type, vocabulary = null, options = null } = {}) {
  const def = definitionOf(s, fieldId);
  if (!def) return 'A built-in field keeps its kind.';
  if (!isKind(type)) return 'Not a field kind.';
  if (vocabulary && !usesLevels(type)) return 'Only a category field takes a list.';
  if (vocabulary && !vocabularyById(s, vocabulary)) return 'That list is not in the project.';
  const next = { ...def.field, type };
  delete next.vocabulary;
  if (vocabulary) next.vocabulary = vocabulary;
  if (usesLevels(type)) next.options = Array.isArray(options) ? options.map(o => String(o).trim()).filter(Boolean) : (def.field.options || []);
  else delete next.options;
  // a bound or pattern belongs to the kind it was set for
  if (type !== 'number' && type !== 'integer') { delete next.min; delete next.max; }
  if (type !== 'text') { delete next.pattern; delete next.allowed; }
  def.set(next);
  // retype proposals made under the old kind no longer apply
  for (const [k, p] of Object.entries(s.proposals || {})) if (p?.mode === 'retype' && k.slice(k.indexOf(':') + 1).split('@')[0] === fieldId) delete s.proposals[k];
  return '';
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cellText = v => (v.qualifier ? `${v.reported_value ?? ''} (${v.qualifier})` : String(v.reported_value ?? ''));

/** One retype proposal record for the value at `key`, from a reading `r` (parseValue's result). Origin, evidence and the earlier text are kept. */
export function retypeProposal(key, v, r, { kind, was, now = new Date().toISOString(), rationale = '' }) {
  const at = key.indexOf(':');
  return { paper_id: key.slice(0, at), column_id: key.slice(at + 1), value: r.shown, normalized: r.nr ? null : r.value, qualifier: r.note || '', kind,
    availability: r.nr ? 'not_found' : 'present', evidence: v.evidence || [], was, origin: 'retype', mode: 'retype', rationale, at: now };
}

/**
 * What reading a field's values as its kind would change. Pure. Returns { proposals: { key: record }, unchanged: [key], unreadable:
 * [key], locked: [key], pending: [key] } — `pending` are cells that already hold another proposal, left alone.
 */
export function retypePlan(s, fieldId, { now = new Date().toISOString() } = {}) {
  const def = definitionOf(s, fieldId), out = { proposals: {}, unchanged: [], unreadable: [], locked: [], pending: [] };
  if (!def) return out;
  const field = def.field, kind = kindOf(field), vocab = vocabFor(s, field);
  const label = KINDS.find(k => k[0] === kind)?.[1] || kind;
  for (const [key, v] of Object.entries(s.values || {})) {
    if (v?.field_id !== fieldId) continue;
    if (v.locked) { out.locked.push(key); continue; }
    if (v.availability === 'not_found') { out.unchanged.push(key); continue; }
    if (s.proposals?.[key]) { out.pending.push(key); continue; }
    const was = cellText(v), r = parseValue(was, field, vocab);
    if (!r.ok) { out.unreadable.push(key); continue; }
    const normalized = r.nr ? null : r.value;
    if (!r.nr && r.shown === String(v.reported_value ?? '') && (r.note || '') === (v.qualifier || '') && same(normalized, v.normalized_value)) { out.unchanged.push(key); continue; }
    out.proposals[key] = retypeProposal(key, v, r, { field, kind, was, now,
      rationale: `Read as ${label.toLowerCase()}${r.note ? ', with the bracketed part kept as its qualifier' : ''}${isListKind(kind) && Array.isArray(normalized) && normalized.length > 1 ? `, ${normalized.length} entries` : ''}.` });
  }
  return out;
}
/** Stores a retype plan's proposals in the project. Reducer. Returns the plan. */
export function proposeRetype(s, fieldId, opts) {
  const plan = retypePlan(s, fieldId, opts);
  if (Object.keys(plan.proposals).length) s.proposals = { ...(s.proposals || {}), ...plan.proposals };
  return plan;
}
