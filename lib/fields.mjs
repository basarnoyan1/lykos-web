// Extraction fields: the built-in set plus the ones this review defines.
//
// A review extracts what its question needs — a dose, a grading scale, a
// follow-up length — and the built-in list cannot know that. Custom fields
// live in the project (`customFields`), take part in the grid, the reader's
// field list, the export and the analysis moderators exactly as built-in
// ones do, and removing one removes its values, so nothing orphaned remains.
import { FIELDS } from '../schema.mjs';
import { get, getVersion, update } from '../store.mjs';
import { extractionFields } from './effect-measures.mjs';
import { outcomes, fieldFor, PRIMARY, timepointsOf, slotId } from './outcomes.mjs';
import { splitCellId } from './arms.mjs';
import { TREATED, maxArms, armsApply } from './multi-arm.mjs';
import { measureOf } from './effect-measures.mjs';
import { readableLabel } from './label-text.mjs';

export const TYPES = [['text', 'Text'], ['number', 'Number'], ['integer', 'Whole number'], ['category', 'Category']];
// Analysis inputs show when the project pools with a measure that uses them;
// a field that already holds a value always shows, so no data is hidden.
const pools = (s, o) => !s.project?.researchType || s.project.researchType === 'meta-analysis' || Boolean(s.analysis)
  || (/^(systematic|rapid)-review$/.test(s.project.researchType) && (o.id !== PRIMARY || s.settings?.measure));
// The field ids that hold a value in some study: every suffix after a ':' in
// the value keys ("paper:field", "paper:field@arm" alike). fields() asks about
// dozens of ids and runs on every status-bar frame; scanning every key per id
// cost 130 ms a call at 50,000 values (bench/perf). For the open project the
// set is kept for the store version, since values are edited in place.
let heldCache = { values: null, version: -1, ids: null };
function heldIds(s) {
  const values = s.values || {};
  const version = s === get() ? getVersion() : -1;
  if (version >= 0 && heldCache.values === values && heldCache.version === version) return heldCache.ids;
  const ids = new Set();
  for (const k of Object.keys(values)) for (let i = k.indexOf(':'); i >= 0; i = k.indexOf(':', i + 1)) ids.add(k.slice(i + 1));
  if (version >= 0) heldCache = { values, version, ids };
  return ids;
}
const accuracy = s => s.project?.researchType === 'dta-review';
const overview = s => s.project?.researchType === 'umbrella-review';
const qualitative = s => s.project?.researchType === 'qualitative-review';
// Each outcome after the first repeats its measure's input columns, named
// for the outcome ("Hazard ratio · Overall survival").
export const fields = (s = get()) => {
  const held = heldIds(s), hasValues = (_, id) => held.has(id);
  const inputs = FIELDS.filter(f => f.analysis && f.family !== 'dta'), at = FIELDS.findIndex(f => f.analysis);
  const list = outcomes(s), named = list.length > 1;
  // Each outcome's inputs in its measure's order (mean, SD, N per arm), then
  // any other input that already holds a value.
  const arms = maxArms(s);
  const perOutcome = list.flatMap(o => {
    // an outcome whose counts are read from a table's text has no input fields to fill (lib/derived-counts.mjs)
    // nor has a hidden one (lib/outcomes.mjs); inputs already holding values still show
    const wanted = pools(s, o) && !o.derived && !o.hidden ? extractionFields(o.measure) : [];
    const order = [...wanted, ...inputs.map(f => f.id).filter(id => !wanted.includes(id))];
    // one set of inputs per timepoint (plan G3); the first keeps the outcome's own keys
    const tps = o.derived ? timepointsOf({}, o.id) : timepointsOf(s, o.id), several = tps.length > 1;
    // a study with several treated arms: the treated inputs again per further arm (lib/multi-arm.mjs)
    const treated = armsApply(o.measure) ? TREATED[measureOf(o.measure).family] : [];
    return tps.flatMap(tp => order.flatMap(base => {
      const f = inputs.find(x => x.id === base), slot = slotId(o.id, tp.id), id = fieldFor(base, slot);
      const at = several ? `, ${tp.label || tp.id}` : '';
      if (!wanted.includes(base) && !hasValues(s, id)) return [];
      const main = o.id === PRIMARY && !several ? [named ? { ...f, label: `${f.label} (${o.name})` } : f]
        : [{ ...f, id, label: `${f.label} (${o.name}${at})`, ...(o.id === PRIMARY ? {} : { outcome: o.id }), ...(several ? { timepoint: tp.id } : {}) }];
      const extra = [];
      for (let k = 2; k <= arms && wanted.includes(base) && treated.includes(base); k++)
        extra.push({ ...main[0], id: `${id}@arm${k}`, label: main[0].label === f.label ? `${f.label} (Arm ${k})` : `${main[0].label.slice(0, -1)}, Arm ${k})`, arm: `arm${k}` });
      return [...main, ...extra];
    }));
  });
  const plain = FIELDS.filter(f => !f.analysis && f.family !== 'dta'
    // an included review's characteristics belong to an umbrella review
    && (f.family !== 'umbrella' || overview(s) || hasValues(s, f.id))
    // a qualitative study's setting, data collection and analysis belong to a qualitative synthesis
    && (f.family !== 'qual' || qualitative(s) || hasValues(s, f.id)));
  // The index test, reference standard and 2×2 counts belong to an accuracy
  // review; elsewhere they show only where a study already holds a value.
  const dta = FIELDS.filter(f => f.family === 'dta' && (accuracy(s) || hasValues(s, f.id)));
  return [...plain.slice(0, at), ...dta, ...perOutcome, ...plain.slice(at), ...(s.customFields || [])];
};
export const fieldById = (id, s = get()) => fields(s).find(f => f.id === id) || null;

// What a review's own field may state beyond its label and type (plan G1):
// a unit, whether it is required, the range or values it admits, a pattern,
// and its codebook entry. The checks are cell rules (lib/cell-rules.mjs
// fieldRules), so a value outside them is flagged like any broken rule.
export const FIELD_ATTRS = ['unit', 'required', 'min', 'max', 'allowed', 'pattern', 'definition', 'instructions'];
function cleanAttrs(a = {}, type = 'text') {
  const out = {};
  const txt = v => String(v ?? '').trim();
  if (txt(a.unit)) out.unit = txt(a.unit).slice(0, 40);
  if (a.required) out.required = true;
  const numeric = type === 'number' || type === 'integer';
  for (const k of ['min', 'max']) { const n = numeric && txt(a[k]) !== '' ? Number(txt(a[k])) : NaN; if (Number.isFinite(n)) out[k] = n; }
  const allowed = (Array.isArray(a.allowed) ? a.allowed : String(a.allowed ?? '').split(/\n|;/)).map(txt).filter(Boolean);
  if (type === 'text' && allowed.length) out.allowed = allowed;
  if (type === 'text' && txt(a.pattern)) out.pattern = txt(a.pattern);
  if (txt(a.definition)) out.definition = txt(a.definition).slice(0, 1000);
  if (txt(a.instructions)) out.instructions = txt(a.instructions).slice(0, 1000);
  return out;
}

export function addField({ label, type = 'text', options = [], ...attrs }) {
  const clean = String(label || '').trim(); if (!clean) return null;
  const base = `c_${clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}` || 'c_field';
  let id = base, n = 1;
  update(s => {
    const taken = new Set(fields(s).map(f => f.id));
    while (taken.has(id)) id = `${base}_${++n}`;
    s.customFields = [...(s.customFields || []), { id, label: clean, type, custom: true,
      options: type === 'category' ? options.map(o => String(o).trim()).filter(Boolean) : [], ...cleanAttrs(attrs, type) }];
    return s;
  });
  return id;
}

/** Changes a review's own field: its label, levels and attributes; the type and id stay. */
export function updateField(id, patch = {}) {
  update(s => {
    s.customFields = (s.customFields || []).map(f => {
      if (f.id !== id) return f;
      const kept = Object.fromEntries(Object.entries(f).filter(([k]) => !FIELD_ATTRS.includes(k)));
      const label = String(patch.label ?? f.label).trim() || f.label;
      const options = f.type === 'category' && patch.options != null ? patch.options.map(o => String(o).trim()).filter(Boolean) : f.options;
      return { ...kept, label, options, ...cleanAttrs({ ...f, ...patch }, f.type) };
    });
    return s;
  });
}

/** A field's label with its unit: "Dose (mg)". */
export const labelWithUnit = f => (f?.unit ? `${f.label} (${f.unit})` : f?.label || '');
/** The same, as the screen shows it: a header's semicolon-joined parts read as a list (lib/label-text.mjs); exports and briefs keep labelWithUnit. */
export const shownLabel = f => readableLabel(labelWithUnit(f));

export function removeField(id) {
  update(s => {
    s.customFields = (s.customFields || []).filter(f => f.id !== id);
    for (const k of Object.keys(s.values || {})) if (k.endsWith(`:${id}`)) delete s.values[k];
    return s;
  });
}

/**
 * A number as typed in a cell. A comma followed by groups of exactly three
 * digits separates thousands ("1,234" is 1234 — read as 1.234 before, which
 * rounded to 1 in a count); any other single comma is a decimal comma, as in
 * "0,72". In a count (integer) a comma is always a thousands separator.
 */
export function cellNumber(raw, type = 'number') {
  const t = String(raw ?? '').trim().replace(/\u2212/g, '-').replace(/[\s\u202f]/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || (type === 'integer' && /,/.test(t))) return Number(t.replace(/,/g, ''));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  return Number(t);
}

// ---- locks (plan G4) ------------------------------------------------------------
// An accepted value can be locked once it is final (after double extraction
// and discrepancy resolution, or at any point a reviewer chooses). A locked
// value is read only: typing, accepting a proposal, marking it not reported
// and the value writers below all leave it as it is. It changes only by
// amendValue, which needs a reason and adds the change to the value's own
// amendments and to the project's extraction log.
export const isLocked = (s, key) => Boolean(s.values?.[key]?.locked);
const logEntry = (s, entry) => { s.extractionLog = [...(s.extractionLog || []), { ...entry, at: new Date().toISOString() }].slice(-2000); };

/** Locks accepted values (by key); returns how many were locked. */
export function lockValues(keys, by = 'reviewer') {
  let n = 0;
  update(s => {
    for (const k of keys) {
      const v = s.values?.[k];
      if (!v || v.locked) continue;
      s.values[k] = { ...v, locked: { at: new Date().toISOString(), by } };
      logEntry(s, { key: k, action: 'lock', value: v.reported_value ?? null, by });
      n++;
    }
    return s;
  });
  return n;
}

/** Changes a locked value, with a reason; the value stays locked and the change is logged. */
export function amendValue(paperId, fieldId, text, reason, by = 'reviewer') {
  const key = `${paperId}:${fieldId}`, why = String(reason ?? '').trim(), raw = String(text ?? '').trim();
  const v = get().values?.[key];
  if (!v?.locked || !why || raw === '') return false;
  const f = fieldById(splitCellId(fieldId).columnId) || fieldById(fieldId);
  const num = f && (f.type === 'number' || f.type === 'integer') ? cellNumber(raw, f.type) : NaN;
  update(s => {
    const was = s.values[key];
    const amendment = { at: new Date().toISOString(), from: was.reported_value ?? null, to: raw, reason: why, by };
    s.values[key] = { ...was, reported_value: raw, availability: 'present',
      normalized_value: Number.isFinite(num) ? (f.type === 'integer' ? Math.round(num) : num) : raw,
      amendments: [...(was.amendments || []), amendment] };
    logEntry(s, { key, action: 'amend', from: amendment.from, to: raw, reason: why, by });
    return s;
  });
  return true;
}

/** A value typed in by hand, with no locator: its provenance says so. A locked value is left as it is. */
export function setManualValue(paperId, fieldId, text) {
  const f = fieldById(fieldId);
  if (isLocked(get(), `${paperId}:${fieldId}`)) return false;
  update(s => { setManualStateValue(s, paperId, fieldId, text, { type: f?.type || 'text' }); return s; });
  return true;
}

/** Reducer form for an editor already inside update; all accepted-cell writes stay here. */
export function setManualStateValue(s, paperId, fieldId, text, { type = 'text', roundInteger = true } = {}) {
  if (isLocked(s, `${paperId}:${fieldId}`)) return false;
  const raw = String(text ?? '').trim();
  const { columnId, arm } = splitCellId(fieldId);
  s.values = s.values || {};
  if (!raw) { delete s.values[`${paperId}:${fieldId}`]; return true; }
  const num = type === 'number' || type === 'integer' ? cellNumber(raw, type) : NaN;
  s.values[`${paperId}:${fieldId}`] = { paper_id: paperId, field_id: columnId, ...(arm ? { arm } : {}), reported_value: raw,
    normalized_value: Number.isFinite(num) ? (type === 'integer' && roundInteger ? Math.round(num) : num) : raw,
    origin: 'manual', extractor: 'manual', at: new Date().toISOString() };
  return true;
}

/**
 * A value with its evidence, whether a person selected it or accepted a
 * model's proposal. Every anchored write goes through here.
 */
export function setAnchoredValue(paperId, fieldId, { reported_value, normalized_value, origin, extractor, evidence = [], rationale = '', proposed_by = null, availability = 'present', derivation = null, resolution = null }) {
  // a locked value changes only by amendValue (plan G4)
  if (isLocked(get(), `${paperId}:${fieldId}`)) return false;
  update(s => {
    s.values = s.values || {};
    const first = evidence.find(e => e.kind === 'text');
    // a study arm's own cell ("column@arm2") keeps its column as the field and names the arm (lib/arms.mjs)
    const { columnId, arm } = splitCellId(fieldId);
    s.values[`${paperId}:${fieldId}`] = {
      paper_id: paperId, study_id: paperId, field_id: columnId, ...(arm ? { arm } : {}),
      reported_value, normalized_value, origin, availability, verification: 'accepted',
      evidence, rationale, proposed_by, extractor,
      // a value computed from what the source states (an SD from an SE), and how
      ...(derivation ? { derivation } : {}),
      // a final value from two extractors: what each entered, which was taken and why (plan G4)
      ...(resolution ? { resolution } : {}),
      // kept for code that still reads the first anchor directly
      source_locator: first ? { document_version: first.document_version, page: first.page, rects: first.rects } : null,
      verified_at: new Date().toISOString(), at: new Date().toISOString(),
    };
    return s;
  });
  return true;
}

/**
 * A duplicate folded into the record it duplicates: its accepted values go to
 * that record, where it has none of its own. Pure — for a reducer already
 * inside update() (lib/screening-batch.mjs).
 */
export function carryValues(s, fromId, toId) {
  for (const [k, v] of Object.entries(s.values || {})) if (v.paper_id === fromId) {
    const next = k.replace(fromId, toId); if (!s.values[next]) s.values[next] = { ...v, paper_id: toId, study_id: toId };
  }
  return s;
}

/** The value of a field for a study, as the analysis wants it: a number, or a category label. */
export function valueFor(s, paperId, field) {
  const v = s.values?.[`${paperId}:${field.id}`]; if (!v || v.availability === 'not_found') return null;
  // Number(null) is 0: a value with no number is missing, not zero (plan F3)
  if (field.type === 'number' || field.type === 'integer') { const raw = v.normalized_value ?? v.reported_value; const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw); return Number.isFinite(n) ? n : null; }
  return String(v.reported_value ?? v.normalized_value ?? '').trim() || null;
}

/**
 * Fields that can split or explain a pooled effect across these studies: a
 * category or short text with 2–6 levels each held by at least two studies,
 * or a number every study has.
 */
export function moderatorCandidates(s, papers, exclude = []) {
  const out = [];
  // an imported study table's columns first, then the built-in fields
  const table = (s.templates || []).filter(t => t?.source?.file).flatMap(t => (t.columns || []).map(c => ({ id: c.id, label: `${c.label || c.name || c.id} (${t.name})`, type: ['category', 'number', 'integer'].includes(c.type) ? c.type : 'text' })))
    .filter(f => !/^(?:id|study|study id|reference|doi|pmid)\b/i.test(f.label));
  for (const f of [...table, ...fields(s)]) {
    if (exclude.includes(f.id)) continue;
    const vals = papers.map(p => valueFor(s, p.id, f));
    if (vals.some(v => v == null)) continue;
    if (f.type === 'number' || f.type === 'integer') { if (new Set(vals).size >= 3) out.push({ field: f, kind: 'numeric' }); continue; }
    const levels = [...new Set(vals)];
    if (levels.length >= 2 && levels.length <= 6 && levels.every(l => vals.filter(v => v === l).length >= 2)) out.push({ field: f, kind: 'group', levels });
  }
  return out;
}

/**
 * Files a value's evidence cites moved in the folder (a version archived):
 * each citation follows its file. `moves` maps old paths to new ones.
 */
export function moveEvidencePaths(moves) {
  if (!Object.keys(moves || {}).length) return 0;
  let n = 0;
  update(s => {
    for (const [k, v] of Object.entries(s.values || {})) {
      if (!(v.evidence || []).some(e => e.path && moves[e.path])) continue;
      s.values[k] = { ...v, evidence: v.evidence.map(e => e.path && moves[e.path] ? { ...e, path: moves[e.path] } : e) };
      n++;
    }
    return s;
  });
  return n;
}
