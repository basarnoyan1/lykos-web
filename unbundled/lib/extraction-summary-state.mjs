// The project state behind the extraction data summary (design note 2026-10-13 §2): what a person approved about how a field's texts count.
// Pure and free of the store, so the project normaliser (store.mjs normalizeProject) and the node tests load it. The thin store wrappers are
// in ./extraction-summary-store.mjs.
//
//   project.extractionSummary = { version: 1, fields, cache, review, runs, columns }   (absent until used; null in the empty project)
//
// Nothing here touches a value, a proposal or a study's text. Counts are never stored: they are recomputed from `values` on demand.
import { evictionPlan } from './cache-budget.mjs';

export const STATE_VERSION = 1;
export const CACHE_LIMIT_BYTES = 1048576;   // the answer cache: 1 MB, least recently used first
export const RUNS_KEPT = 20;
export const REVIEW_NOTES_PER_CELL = 20;

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = v => (typeof v === 'string' ? v : '');
const KINDS = ['multi', 'categorical', 'free'];
const NOTE_STATES = ['open', 'dismissed', 'applied'];
const ts = at => { const t = Date.parse(at); return Number.isFinite(t) ? t : 0; };
const size = v => { try { return JSON.stringify(v)?.length || 0; } catch { return 0; } };

/** One field's approved decisions in the shape the summary reads; null when nothing usable is left. */
function cleanField(m) {
  const f = obj(m); if (!f) return null;
  const out = { states: {}, markers: {}, categories: {}, cells: {} };
  if (KINDS.includes(f.kind)) out.kind = f.kind;
  if (f.parse === 'plain') out.parse = 'plain';
  for (const [k, v] of Object.entries(obj(f.states) || {})) if (k && str(v).trim()) out.states[k] = v.trim();
  for (const [k, v] of Object.entries(obj(f.markers) || {})) if (k && str(v).trim()) out.markers[k] = v.trim();
  for (const [id, c] of Object.entries(obj(f.categories) || {})) {
    const label = str(obj(c)?.label).trim(); if (!id || !label) continue;
    out.categories[id] = { label, from: c.from === 'model' ? 'model' : 'person' };
  }
  for (const [k, list] of Object.entries(obj(f.cells) || {})) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter(x => obj(x) && out.categories[x.category]).map(x => ({ category: x.category, ...(str(x.status).trim() ? { status: x.status.trim() } : {}) }));
    if (kept.length) out.cells[k] = kept;   // a text pointing at an unknown category is dropped
  }
  if (str(f.definitionHash)) out.definitionHash = f.definitionHash;
  if (str(f.approvedAt)) out.approvedAt = f.approvedAt;
  if (str(f.model)) out.model = f.model;
  const empty = !out.kind && !out.parse && ['states', 'markers', 'categories', 'cells'].every(k => !Object.keys(out[k]).length);
  return empty ? null : out;
}

function cleanNote(n) {
  const x = obj(n); if (!x || !str(x.id) || !str(x.text)) return null;
  return { ...x, state: NOTE_STATES.includes(x.state) ? x.state : 'open', kind: str(x.kind), runId: str(x.runId), valueHash: str(x.valueHash), at: str(x.at) };
}

/**
 * The summary state as this version holds it. Absent or not an object: null. A version this build does not know is returned untouched, so a
 * newer file is carried through and written back as it was. Otherwise: unknown shapes dropped, `cells` pointing at an unknown category
 * dropped, the answer cache trimmed to its byte limit (least recently used first), the review notes capped, the last RUNS_KEPT runs kept.
 * Notes whose value changed are not rewritten here: a reader retires them when it sees a different `valueHash`.
 */
export function normalizeExtractionSummary(next, { cacheLimit = CACHE_LIMIT_BYTES } = {}) {
  const s = obj(next); if (!s) return null;
  if (s.version !== STATE_VERSION) return s.version > STATE_VERSION ? s : null;
  const fields = {};
  for (const [id, m] of Object.entries(obj(s.fields) || {})) { const c = cleanField(m); if (c) fields[id] = c; }
  const cache = {};
  const entries = Object.entries(obj(s.cache) || {}).filter(([k, e]) => k && obj(e) && 'out' in e).map(([k, e]) => [k, { out: e.out, at: str(e.at), bytes: Number(e.bytes) > 0 ? Number(e.bytes) : size(e.out) }]);
  const drop = new Set(evictionPlan(entries.map(([k, e]) => [k, { bytes: e.bytes, at: ts(e.at) }]), cacheLimit));
  for (const [k, e] of entries) if (!drop.has(k)) cache[k] = e;
  const review = {};
  for (const [cell, list] of Object.entries(obj(s.review) || {})) {
    if (!Array.isArray(list)) continue;
    const kept = list.map(cleanNote).filter(Boolean).slice(-REVIEW_NOTES_PER_CELL);
    if (kept.length) review[cell] = kept;
  }
  const runs = (Array.isArray(s.runs) ? s.runs : []).filter(r => obj(r) && str(r.id)).slice(-RUNS_KEPT);
  const columns = {};
  for (const [t, c] of Object.entries(obj(s.columns) || {})) if (Array.isArray(obj(c)?.hidden)) columns[t] = { hidden: [...new Set(c.hidden.filter(x => typeof x === 'string' && x))] };
  return { version: STATE_VERSION, fields, cache, review, runs, columns };
}

// ---- writers: pure on a project state object (the setManualStateValue / setManualValue split) -------------------------------------------

/** The state to write into: created on first use. */
export function base(s) {
  s.extractionSummary = normalizeExtractionSummary(s.extractionSummary) ?? { version: STATE_VERSION, fields: {}, cache: {}, review: {}, runs: [], columns: {} };
  return s.extractionSummary;
}
const fieldOf = (s, id) => (base(s).fields[id] ||= { states: {}, markers: {}, categories: {}, cells: {} });
export const prune = (s, id) => { const f = s.extractionSummary.fields[id]; if (f && !cleanField(f)) delete s.extractionSummary.fields[id]; };

/** Approves a mapping for a field: `mapping` is { categories, cells, markers?, states?, kind?, parse?, definitionHash?, model? }; it replaces the field's earlier one. */
export function approveMapping(s, fieldId, mapping, now = new Date().toISOString()) {
  const c = cleanField({ ...mapping, approvedAt: now }); const st = base(s);
  if (c) st.fields[fieldId] = c; else delete st.fields[fieldId];
  return s;
}
/** Merges categories into one named `label` (the first id is kept); every text that pointed at a merged id points at the kept one. */
export function mergeCategories(s, fieldId, ids, label) {
  const f = fieldOf(s, fieldId), [keep, ...gone] = ids.filter(id => f.categories[id]); if (!keep || !str(label).trim()) return s;
  f.categories[keep] = { label: label.trim(), from: 'person' };
  for (const id of gone) delete f.categories[id];
  for (const [k, list] of Object.entries(f.cells)) {
    const seen = new Set();
    f.cells[k] = list.map(x => (gone.includes(x.category) ? { ...x, category: keep } : x)).filter(x => { const key = `${x.category}|${x.status || ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return s;
}
export function renameCategory(s, fieldId, id, label) {
  const f = fieldOf(s, fieldId); if (f.categories[id] && str(label).trim()) f.categories[id] = { label: label.trim(), from: 'person' };
  return s;
}
export function dropMapping(s, fieldId) { delete base(s).fields[fieldId]; return s; }
/** Marks texts (already folded with `valueKey`) as meaning "no value" for a field, by the label the person chose; an empty role clears them. */
export function markStatesFor(s, fieldId, keys, role) {
  const f = fieldOf(s, fieldId);
  for (const k of keys) if (str(role).trim()) f.states[k] = role.trim(); else delete f.states[k];
  prune(s, fieldId); return s;
}
/**
 * A short token for the value a review note was written for: the note is current only while the cell still holds that value. FNV-1a over the
 * state and the text, with the length, so a different value of the same length collides only by a 32-bit chance, and the worst a collision
 * does is leave a stale note on view until the next review.
 */
export function valueHash(v) {
  const t = v ? `${v.availability || ''}|${v.reported_value ?? v.normalized_value ?? ''}` : '';
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${t.length.toString(36)}.${h.toString(36)}`;
}
/** The notes of a cell that still apply: open, and written for the value the cell holds now. */
export const notesFor = (state, cellKey, value) => (state?.review?.[cellKey] || []).filter(n => n.state === 'open' && n.valueHash === valueHash(value));

/** Files the review notes of a cell (replacing the earlier ones of the same run). */
export function noteReview(s, cellKey, notes) {
  const st = base(s), runs = new Set(notes.map(n => n.runId));
  st.review[cellKey] = [...(st.review[cellKey] || []).filter(n => !runs.has(n.runId)), ...notes.map(cleanNote).filter(Boolean)].slice(-REVIEW_NOTES_PER_CELL);
  return s;
}
export function setNoteState(s, cellKey, id, state) {
  if (!NOTE_STATES.includes(state)) return s;
  const n = (base(s).review[cellKey] || []).find(x => x.id === id); if (n) n.state = state;
  return s;
}
/** The grid's column picker: the columns of a table that are folded away. */
export function setColumns(s, templateId, hidden) {
  const st = base(s), ids = [...new Set((hidden || []).filter(x => typeof x === 'string' && x))];
  if (ids.length) st.columns[templateId] = { hidden: ids }; else delete st.columns[templateId];
  return s;
}
