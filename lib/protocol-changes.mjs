// Protocol › Changes (plan W9b; owner, 6 Nov 2026: "protocol changes should be much more convenient and easier to find and edit"). One place
// lists every change to the review's protocol: pending (an agent's change held in .lykos/inbox/held/, lib/held-changes.mjs, and the owner's
// own edits since the last version), accepted (the versions, and the amendments recorded between them) and declined. A change reads as a field
// diff against the protocol it would change, with its reason, who proposed it and when, and what follows from it: the screening decisions,
// PRISMA reasons, manuscript sections and registration fields to look at again. The owner can edit a held change before accepting it; accepting
// records a numbered version that keeps the protocol as it then stood, the fields that changed and, when the owner edited it, the words they
// replaced. Only the owner accepts: an agent's change file never reaches acceptInPlace (lib/change-file.mjs ownerOnly, tools/lykos-apply.mjs).
//
// Pure of the store and the DOM: views/protocol-changes.mjs and tools/lykos-apply.mjs call the same functions.
import { applyChanges, applyInPlace, changeFileWhat, OWNER_OPS, scaleWrite } from './change-file.mjs';
import { wordParts } from './vcs-diff.mjs';
import { fieldDiff, fieldsOf, fieldsOfVersion, withoutKey, governed, ownerDraft, textOf, cap } from './protocol-fields.mjs';

export { protocolFields, fieldDiff, governed, ownerDraft } from './protocol-fields.mjs';
const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));   // the store hands proxies; structuredClone refuses them

/** A field's two texts as runs, the changed words marked (lib/vcs-diff.mjs wordParts); a whole-text change when little is shared. */
export function wordRuns(before, after) {
  const parts = before && after ? wordParts(before, after) : null;
  return parts || { before: before ? [{ t: before, x: true }] : [], after: after ? [{ t: after, x: true }] : [] };
}

// ---- what a held change does ---------------------------------------------------------------------------------------------------------

/** The protocol ops of a change file; the rest (values, tasks) are listed, not diffed. */
const isProtocolOp = c => OWNER_OPS.includes(c?.op) || scaleWrite(c) || (['set', 'unset', 'set_if'].includes(c?.op) && Array.isArray(c.path) && ['protocol', 'eligibilityRules'].includes(c.path[0]));

/**
 * What a change file would do to the protocol now: { rows, other, errors }. It is applied to a copy of the protocol alone (a project's
 * records are not copied for a preview), so `errors` names a change the protocol no longer takes; `other` counts the ops that are not
 * protocol changes.
 */
export function changePreview(s, cf) {
  const ops = (cf?.changes || []).filter(isProtocolOp), other = (cf?.changes || []).length - ops.length;
  if (!ops.length) return { rows: [], other, errors: [] };
  // a scale decision reads the scales, the decisions, the versions and the registration, and files its amendment in the protocol (lib/scales.mjs)
  const slim = { protocol: copy(s?.protocol || {}), eligibilityRules: copy(s?.eligibilityRules ?? null), values: {},
    ...Object.fromEntries(['synthesis', 'instruments', 'crosswalks', 'protocolVersions', 'paper'].filter(k => s?.[k] != null).map(k => [k, copy(s[k])])) };
  const r = applyChanges(slim, { ...cf, changes: ops });
  if (r.errors) return { rows: [], other, errors: r.errors };
  return { rows: fieldDiff(fieldsOf(slim), fieldsOf(r.state)), other, errors: [] };
}

/** The reason a change gives: its amendment's note when it has one, else its own `why`, else what it does. */
export function changeReason(cf) {
  const own = textOf(cf?.why || cf?.reason).trim();
  if (own) return own;
  const notes = (cf?.changes || []).filter(c => c?.op === 'add_amendment' && textOf(c.note).trim()).map(c => textOf(c.note).trim());
  return notes.length ? notes.join('\n\n') : changeFileWhat(cf);
}

// ---- what follows from a change ------------------------------------------------------------------------------------------------------

const reasonCache = new WeakMap();
/** Screening decisions per criterion id ("E7: Not a primary trial report" counts for E7): Map id → { ta, ft }, read once per decision map. */
function decidedUnder(s) {
  const ta = s?.screening || {}, ft = s?.fulltext || {};
  const key = ta;
  const hit = reasonCache.get(key);
  if (hit && hit.ft === ft) return hit.counts;
  const counts = new Map();
  const count = (map, stage) => {
    for (const d of Object.values(map)) {
      const m = /^\s*([A-Z]{1,3}\d+[a-z]?)\b/.exec(textOf(d?.reason));
      if (!m) continue;
      const c = counts.get(m[1]) || { ta: 0, ft: 0 };
      c[stage]++; counts.set(m[1], c);
    }
  };
  count(ta, 'ta'); count(ft, 'ft');
  if (ta && typeof ta === 'object') reasonCache.set(key, { ft, counts });
  return counts;
}
const n = (k, one, many) => `${k.toLocaleString('en')} ${k === 1 ? one : many}`;
/** The registration a project names (paper.registration): "the OSF registration", "the PROSPERO record" or "the registration". */
export function registrationName(s) {
  const r = textOf(s?.paper?.registration);
  return /prospero|crd\s*\d/i.test(r) ? 'PROSPERO record' : /osf/i.test(r) ? 'OSF registration' : 'Registration';
}

/**
 * What follows from a change, as [{ where, text }]: the places a person looks at again once it is accepted. A criterion names the
 * records decided under it at each stage and the PRISMA reasons they feed; every field names the registration's field and the
 * manuscript's section that state it.
 */
export function consequences(s, rows) {
  const out = [], seen = new Set();
  const add = (where, text) => { const k = `${where}\u0000${text}`; if (!seen.has(k)) { seen.add(k); out.push({ where, text }); } };
  const reg = registrationName(s);
  for (const r of rows || []) {
    if (r.key === 'title') { add('Manuscript', 'Title, objective and introduction'); add(reg, 'Review question'); continue; }
    if (r.key.startsWith('pico.')) {
      add('Manuscript', 'Methods: eligibility criteria'); add(reg, r.label);
      if (/outcome/i.test(r.key)) add('Analysis', 'Outcomes and their analyses');
      continue;
    }
    if (r.key.startsWith('criterion.')) {
      const id = r.key.slice('criterion.'.length), c = decidedUnder(s).get(id);
      if (c?.ta || c?.ft) {
        add('Screening', `${[c.ta ? `${n(c.ta, 'record', 'records')} at title and abstract` : '', c.ft ? `${n(c.ft, 'report', 'reports')} at full text` : ''].filter(Boolean).join(' and ')} decided under ${id}`);
        if (c.ft) add('PRISMA', `Full-text exclusions under ${id}`);
      } else add('Screening', `No record is decided under ${id}`);
      add('Manuscript', 'Methods: eligibility criteria'); add(reg, 'Eligibility criteria');
      continue;
    }
    if (r.key.startsWith('amendment.')) { add('Manuscript', 'Methods: protocol and registration'); add(reg, 'Amendments'); continue; }
    if (r.key === 'rules') { add('Eligibility', 'Recorded facts are read again under the new rules'); add('Screening', 'Decisions the rules propose'); continue; }
    add('Manuscript', 'Methods');
  }
  return out;
}

// ---- editing a held change before it is accepted ------------------------------------------------------------------------------------

const EDITABLE = { set_criterion: ['text', 'question'], set_protocol: ['value'], add_amendment: ['note'] };
const fieldName = (c, f) => (c.op === 'set_criterion' ? `${c.id} ${f === 'text' ? 'wording' : f}` : c.op === 'set_protocol' ? cap(c.field === 'title' ? 'question' : c.field) : 'Amendment note');
/** The words a person may change in a held change: [{ i, field, label, value }], one per editable field of each change. */
export function editableFields(cf) {
  return (cf?.changes || []).flatMap((c, i) => (EDITABLE[c?.op] || []).filter(f => f !== 'question' || f in c)
    .map(field => ({ i, field, label: fieldName(c, field), value: textOf(c[field]) })));
}
/**
 * The change file with the person's edits ([{ i, field, value }]); each edit's earlier words are kept in `edited`, so the version that
 * accepts it records what the owner changed. Answers the same object when nothing differs.
 */
export function editChange(cf, edits, { by, at = new Date().toISOString() } = {}) {
  const changes = (cf?.changes || []).map(c => ({ ...c })), before = [];
  for (const e of edits || []) {
    const c = changes[e.i];
    if (!c || !(EDITABLE[c.op] || []).includes(e.field)) continue;
    const old = textOf(c[e.field]), now = textOf(e.value);
    if (old === now) continue;
    before.push({ i: e.i, field: e.field, value: old }); c[e.field] = now;
  }
  return before.length ? { ...cf, changes, edited: [...(cf.edited || []), { by: textOf(by) || 'You', at, before }] } : cf;
}

// ---- versions -----------------------------------------------------------------------------------------------------------------------

/**
 * Records a version of the protocol as it stands in `s` (mutated: the store's draft or a copy): { v, at, note, protocol, paper,
 * eligibilityRules } and, for an accepted change, who proposed it (`by`), who accepted it (`accepted`), the fields it changed
 * (`changes`: key, label, op; the texts are the snapshots'), the owner's edits and the file it came from. Answers the version.
 */
export function recordVersion(s, { at = new Date().toISOString(), note = '', by, accepted, edited, file, rows, auto } = {}) {
  const list = s.protocolVersions || [];
  const v = { v: list.length + 1, at, note: textOf(note).trim(), protocol: copy(s.protocol || {}), paper: copy(s.paper || {}), eligibilityRules: copy(s.eligibilityRules ?? null),
    ...(by ? { by: textOf(by) } : {}), ...(accepted ? { accepted } : {}), ...(file ? { file } : {}), ...(auto ? { auto: true } : {}),
    ...(rows?.length ? { changes: rows.map(r => ({ key: r.key, label: r.label, op: r.op })) } : {}), ...(edited?.length ? { edited: copy(edited) } : {}) };
  s.protocolVersions = [...list, v];
  return v;
}

/**
 * Accepts a change file into `s` itself (the store's draft, so only the parts it touches are saved), after applyChanges has passed it on a
 * copy. A governed protocol records a version: when it has none yet, first the protocol as it stood (v1, `auto`), then the change.
 * Answers { lines, version } (version null for a protocol still being drafted).
 */
export function acceptInPlace(s, cf, { person, at = new Date().toISOString(), file = '' } = {}) {
  const before = fieldsOf(s), versioned = governed(s);
  if (versioned && !(s.protocolVersions || []).length) recordVersion(s, { at, auto: true });
  const lines = applyInPlace(s, cf);
  if (!versioned) return { lines, version: null };
  const v = recordVersion(s, { at, note: changeReason(cf), by: cf.by || 'An agent', accepted: { by: textOf(person) || 'You', at }, edited: cf.edited, file, rows: fieldDiff(before, fieldsOf(s)) });
  return { lines, version: v.v };
}

/** acceptInPlace on a copy, for the command line: { state, applied, version } or { errors } (nothing applied). */
export function acceptChange(state, cf, opts = {}) {
  const r = applyChanges(state, cf);
  if (r.errors) return { errors: r.errors };
  const s = copy(state); s.values ||= {};
  const { lines, version } = acceptInPlace(s, cf, opts);
  return { state: s, applied: lines, version };
}

/** The owner records their own edits as the next version, with the reason they give. Answers the version. */
export function recordDraft(s, { note, person, at = new Date().toISOString() } = {}) {
  const d = ownerDraft(s);
  return recordVersion(s, { at, note, by: textOf(person) || 'You', accepted: { by: textOf(person) || 'You', at }, rows: d?.rows || [] });
}

/** The protocol back as the last version holds it: the owner's draft discarded (the amendments and criteria as recorded). */
export function revertDraft(s) {
  const last = (s?.protocolVersions || []).at(-1);
  if (!last) return false;
  const scenarios = s.protocol?.scenarios;
  s.protocol = { ...copy(last.protocol || {}), ...(scenarios ? { scenarios } : {}) };
  if ('eligibilityRules' in last) s.eligibilityRules = copy(last.eligibilityRules);
  return true;
}

/**
 * Two versions side by side: every field of either, in reading order, [{ key, label, op, before, after }] with op 'same' for a field
 * both hold alike. `a` and `b` are versions or { current: state }.
 */
export function compareVersions(a, b) {
  const fa = a?.current ? fieldsOf(a.current) : fieldsOfVersion(a), fb = b?.current ? fieldsOf(b.current) : fieldsOfVersion(b);
  const legacy = (!a?.current && !('eligibilityRules' in (a || {}))) || (!b?.current && !('eligibilityRules' in (b || {})));
  const [x, y] = legacy ? [withoutKey(fa, 'rules'), withoutKey(fb, 'rules')] : [fa, fb];
  const changed = new Map(fieldDiff(x, y).map(r => [r.key, r]));
  const keys = [...new Set([...x.keys(), ...y.keys()])];
  return keys.map(key => changed.get(key) || { key, label: (y.get(key) || x.get(key)).label, op: 'same', before: x.get(key)?.text || '', after: y.get(key)?.text || '' });
}

/** The changes a version made, as field rows against the version before it (its own snapshot, so nothing is stored twice). */
export function versionRows(versions, v) {
  const i = (versions || []).findIndex(x => x.v === v);
  if (i <= 0) return [];
  return compareVersions(versions[i - 1], versions[i]).filter(r => r.op !== 'same');
}

/**
 * The accepted history, newest first: each version, and each amendment no version recorded (one written before the first version, or
 * since the last). An amendment a version's change wrote is that version's: it is in its snapshot and not in the one before.
 * [{ kind: 'version' | 'amendment', at, version | (i, amendment) }].
 */
export function acceptedHistory(s) {
  const versions = s?.protocolVersions || [], amendments = s?.protocol?.amendments || [];
  const count = v => (v?.protocol?.amendments || []).length;
  const owned = new Set();
  versions.forEach((v, k) => { if (k > 0) for (let i = count(versions[k - 1]); i < Math.min(count(v), amendments.length); i++) owned.add(i); });
  const items = [...versions.map(v => ({ kind: 'version', at: v.at, version: v })),
    ...amendments.map((a, i) => ({ kind: 'amendment', at: a.at, i, amendment: a })).filter(a => !owned.has(a.i))];
  const rank = x => (x.kind === 'version' ? 1e6 + x.version.v : x.i);
  return items.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')) || rank(y) - rank(x));
}
