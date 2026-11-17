// Vocabularies in use (data-model plan S1b): the editor's text form of a list, the plain-words report of a retype, and an approved
// grouping of a field's texts turned into retype proposals (text to term code). Pure on the project state; a person still accepts each.
import { definitionOf, retypeProposal, proposeRetype } from './field-retype.mjs';
import { parseValue, kindOf, KINDS } from './field-kinds.mjs';
import { vocabFor, matchTerm, termOf } from './vocabularies.mjs';
import { splitParts, valueKey } from './extraction-summary.mjs';

const cellText = v => (v.qualifier ? `${v.reported_value ?? ''} (${v.qualifier})` : String(v.reported_value ?? ''));

/** A list's terms as the editor shows them, one per line: code | label | parent | alias; alias. */
export const termsToText = v => (v?.terms || []).map(t => [t.code, t.label, t.parent || '', (t.aliases || []).join('; ')].join(' | ').replace(/( \| )+$/, '')).join('\n');
/** The editor's text as terms (not validated: see problemsOf). A line without a label takes its code as the label. */
export function textToTerms(text) {
  return String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [code = '', label = '', parent = '', aliases = ''] = line.split('|').map(x => x.trim());
    return { code, label: label || code, parent, aliases: aliases.split(';').map(a => a.trim()).filter(Boolean) };
  });
}

/** What a retype plan came to, in plain words. */
export function retypeSentence(plan) {
  const n = a => a.length, many = (k, one, more) => `${k} ${k === 1 ? one : more}`;
  const proposed = Object.keys(plan?.proposals || {}).length;
  const parts = [
    proposed && `${many(proposed, 'value is', 'values are')} proposed in the table for you to accept`,
    n(plan?.unchanged || []) && `${many(n(plan.unchanged), 'value already reads', 'values already read')} this way`,
    n(plan?.unreadable || []) && `${many(n(plan.unreadable), 'value does not', 'values do not')} read as this kind: edit ${n(plan.unreadable) === 1 ? 'it' : 'them'} in the table`,
    n(plan?.locked || []) && `${many(n(plan.locked), 'value is', 'values are')} locked and left as it is`,
    n(plan?.pending || []) && `${many(n(plan.pending), 'value has', 'values have')} another proposal waiting`,
  ].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : 'This field has no values yet.';
}

/**
 * The retype proposals an approved grouping of a field's texts implies. The grouping is `s.extractionSummary.fields[fieldId]` (its
 * `cells` lead each distinct text to categories, whose labels are the vocabulary's term labels); a text that names a term itself needs
 * no grouping. Same result shape as retypePlan, plus `unmapped` (texts the grouping does not place in the list). Pure.
 */
export function proposalsFromMapping(s, fieldId, { now = new Date().toISOString() } = {}) {
  const out = { proposals: {}, unchanged: [], unreadable: [], locked: [], pending: [], unmapped: [] };
  const def = definitionOf(s, fieldId), vocab = def && vocabFor(s, def.field);
  if (!vocab) return out;
  const field = def.field, kind = kindOf(field), mapping = s.extractionSummary?.fields?.[fieldId] || {};
  const label = KINDS.find(k => k[0] === kind)?.[1].toLowerCase() || kind;
  const termFor = part => {
    const direct = matchTerm(vocab, part); if (direct) return [direct.code];
    return (mapping.cells?.[valueKey(part)] || []).map(m => matchTerm(vocab, mapping.categories?.[m.category]?.label ?? m.category)?.code).filter(Boolean);
  };
  for (const [key, v] of Object.entries(s.values || {})) {
    if (v?.field_id !== fieldId) continue;
    if (v.locked) { out.locked.push(key); continue; }
    if (v.availability === 'not_found') { out.unchanged.push(key); continue; }
    if (s.proposals?.[key]) { out.pending.push(key); continue; }
    const parts = splitParts(v.reported_value), found = parts.map(termFor);
    const codes = [...new Set(found.flat())];
    if (!parts.length || found.some(c => !c.length) || (kind === 'category' && codes.length !== 1)) { out.unmapped.push(key); continue; }
    const r = parseValue(codes.map(c => termOf(vocab, c).label).join('; '), field, vocab);
    if (!r.ok || r.nr) { out.unmapped.push(key); continue; }
    if (JSON.stringify(r.value) === JSON.stringify(v.normalized_value) && r.shown === String(v.reported_value ?? '') && !v.qualifier) { out.unchanged.push(key); continue; }
    out.proposals[key] = retypeProposal(key, v, r, { kind, was: cellText(v), now,
      rationale: `Placed in the list ${vocab.label || vocab.id} by the approved grouping, as ${label}.` });
  }
  return out;
}
/** Stores the proposals of proposalsFromMapping. Reducer. Returns the plan. */
export function proposeFromMapping(s, fieldId, opts) {
  const plan = proposalsFromMapping(s, fieldId, opts);
  if (Object.keys(plan.proposals).length) s.proposals = { ...(s.proposals || {}), ...plan.proposals };
  return plan;
}

/** The fields with the term labels of their list attached, for what the normaliser tells a model (fieldDescription lists them as allowed). */
export const withVocabularyLabels = (s, list) => list.map(f => { const v = f?.vocabulary ? vocabFor(s, f) : null; return v ? { ...f, vocabularyLabels: v.terms.map(t => t.label) } : f; });

/**
 * Reads a field's values again as its kind, then places what is still unread through the approved grouping when the field has a list.
 * Reducer; returns one plan in retypePlan's shape (its `unreadable` no longer holds a value the grouping placed).
 */
export function readAgain(s, fieldId, opts) {
  const a = proposeRetype(s, fieldId, opts), def = definitionOf(s, fieldId);
  if (!def || !vocabFor(s, def.field)) return a;
  const b = proposeFromMapping(s, fieldId, opts), placed = new Set(Object.keys(b.proposals));
  return { ...a, proposals: { ...a.proposals, ...b.proposals }, unreadable: a.unreadable.filter(k => !placed.has(k)) };
}
