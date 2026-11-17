// The protocol as labelled fields and what differs between two of them (plan W9b): the light half of lib/protocol-changes.mjs, which the
// Overview reads at start (its needs row "Protocol edited since version 2"), so it imports nothing heavy. The held changes found in the
// folder are kept here too (setHeld, by lib/handoff-absorb.mjs and the Changes section), so the Overview counts them without reading files.
import { lib_dates$day as day } from "../boot.mjs";

export const cap = s => { const t = String(s ?? ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
export const textOf = v => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const PICO = { population: 'Population', intervention: 'Intervention', comparator: 'Comparator', outcome: 'Outcome', design: 'Design', designs: 'Designs',
  language: 'Language', exposure: 'Exposure', setting: 'Setting', timing: 'Timing', condition: 'Condition', context: 'Context' };
const KNOWN = new Set(['title', 'pico', 'criteria', 'amendments', 'scenarios']);

/** A criterion as one text: its wording, then how it is applied. */
const criterionText = c => [textOf(c.text), [c.kind && c.kind !== 'include' ? cap(c.kind) : '', c.stage ? `stage ${textOf(c.stage)}` : ''].filter(Boolean).join(', '),
  c.question ? `Question: ${textOf(c.question)}` : ''].filter(Boolean).join('\n');
const rulesText = r => (Array.isArray(r?.rules) ? r.rules.map(x => `${x.id}${x.name ? ` ${x.name}` : ''}: ${textOf(x.text)}`).join('\n') : textOf(r));

/**
 * The protocol as labelled fields, in reading order: the question, each frame field, each criterion by id, each amendment, any other
 * field, and the eligibility rules when given. A Map of key → { key, label, text }; empty fields are left out.
 */
export function protocolFields(p = {}, rules) {
  const out = new Map();
  const put = (key, label, text) => { const t = textOf(text).trim(); if (t) out.set(key, { key, label, text: t }); };
  put('title', 'Question', p?.title);
  for (const [k, v] of Object.entries(p?.pico || {})) put(`pico.${k}`, PICO[k] || cap(k), v);
  for (const c of p?.criteria || []) if (c?.id) put(`criterion.${c.id}`, `Criterion ${c.id}`, criterionText(c));
  (p?.amendments || []).forEach((a, i) => put(`amendment.${i}`, `Amendment${a?.at ? ` of ${day(a.at)}` : ''}`, a?.note));
  for (const [k, v] of Object.entries(p || {})) if (!KNOWN.has(k)) put(`other.${k}`, cap(k), v);
  if (rules !== undefined) put('rules', 'Eligibility rules', rules ? rulesText(rules) : '');
  return out;
}

/** The fields that differ: [{ key, label, op: 'add' | 'del' | 'change', before, after }], the newer protocol's order first. */
export function fieldDiff(before, after) {
  const rows = [];
  for (const [key, a] of after) {
    const b = before.get(key);
    if (!b) rows.push({ key, label: a.label, op: 'add', before: '', after: a.text });
    else if (b.text !== a.text) rows.push({ key, label: a.label, op: 'change', before: b.text, after: a.text });
  }
  for (const [key, b] of before) if (!after.has(key)) rows.push({ key, label: b.label, op: 'del', before: b.text, after: '' });
  return rows;
}

export const fieldsOf = s => protocolFields(s?.protocol || {}, s?.eligibilityRules ?? null);
// a version recorded before 6 Nov 2026 kept no eligibility rules: compared without them, so they do not read as added
export const fieldsOfVersion = v => protocolFields(v?.protocol || {}, 'eligibilityRules' in (v || {}) ? v.eligibilityRules ?? null : undefined);
export const withoutKey = (m, key) => { const n = new Map(m); n.delete(key); return n; };

/**
 * Whether the protocol is under amendment: it has a version, a registration or an amendment. Then an accepted change records a version;
 * a protocol still being drafted takes the change without one.
 */
export const governed = s => (s?.protocolVersions || []).length > 0 || !!textOf(s?.paper?.registration).trim() || (s?.protocol?.amendments || []).length > 0;

/** The owner's own edits since the last version, or null: { since: v, rows }. */
export function ownerDraft(s) {
  const last = (s?.protocolVersions || []).at(-1);
  if (!last) return null;
  const legacy = !('eligibilityRules' in last), a = fieldsOfVersion(last), b = fieldsOf(s);
  const rows = fieldDiff(a, legacy ? withoutKey(b, 'rules') : b);
  return rows.length ? { since: last.v, rows } : null;
}


// ---- what waits for the owner, for the Overview -----------------------------------------------------------------------------------------

let held = [];
/** The held changes last read from the folder: [{ name, cf }]. */
export const heldNow = () => held;
/** Keeps the held changes read from the folder (lib/held-changes.mjs listHeld). */
export const setHeld = list => { held = Array.isArray(list) ? list : []; };

/** The Overview's needs rows for the protocol: the held changes, and the owner's edits since the last version. */
export function protocolNeeds(s) {
  const out = [];
  if (held.length) out.push({ view: 'protocol', go: 'protocol:changes', kind: 'protocol-changes', text: `${held.length} protocol ${held.length === 1 ? 'change' : 'changes'} waiting for you` });
  const d = ownerDraft(s);
  if (d) out.push({ view: 'protocol', go: 'protocol:changes', kind: 'protocol-draft', text: `Protocol edited since version ${d.since}: record the amendment` });
  return out;
}
