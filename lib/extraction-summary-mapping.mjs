// The writers of stage 3 of the extraction data summary (design note 2026-10-13 §4): a model's grouping once a person approves it, the answer
// cache and the run record. Pure on a project state object, like the writers of ./extraction-summary-state.mjs, which holds the shape and the
// normaliser; they live apart because that file is part of what the shell loads at start, and only the Data summary writes these.
import { base, approveMapping, normalizeExtractionSummary, RUNS_KEPT, prune, noteReview } from './extraction-summary-state.mjs';

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = v => (typeof v === 'string' ? v : '');
const size = v => { try { return JSON.stringify(v)?.length || 0; } catch { return 0; } };

/**
 * Approves what a normalisation run proposed for a field: `add` is { categories, cells, markers, definitionHash?, model? }. It is added to the
 * grouping the field already has; an entry already there (a category, a text's cells, a marker's meaning) is kept, so what a person renamed or
 * merged is not undone. `replace` starts the grouping again (a mapping made under an older field definition) and keeps the person's states and
 * marker meanings. Nothing here reads or writes a value.
 */
export function applyMapping(s, fieldId, add, { replace = false, now = new Date().toISOString() } = {}) {
  const cur = base(s).fields[fieldId] || { states: {}, markers: {}, categories: {}, cells: {} };
  const keep = replace ? { ...cur, categories: {}, cells: {} } : cur;
  const merged = { ...keep,
    categories: { ...(add.categories || {}), ...keep.categories },
    cells: { ...(add.cells || {}), ...keep.cells },
    markers: { ...(add.markers || {}), ...keep.markers },
    definitionHash: add.definitionHash || keep.definitionHash, model: add.model || keep.model };
  return approveMapping(s, fieldId, merged, now);
}
/** The person keeps a grouping after the field's definition changed: it is current under the new definition. */
export function acceptDefinition(s, fieldId, hash) {
  const f = base(s).fields[fieldId]; if (f && str(hash)) f.definitionHash = hash;
  return s;
}
/** Remembers model answers (key -> { out, at, bytes }). The cache is bounded by the normaliser on every write, least recently used first. */
export function cachePut(s, entries) {
  const st = base(s);
  for (const [k, e] of Object.entries(entries || {})) if (k && obj(e)) st.cache[k] = { out: e.out, at: str(e.at), bytes: Number(e.bytes) > 0 ? Number(e.bytes) : size(e.out) };
  s.extractionSummary = normalizeExtractionSummary(st);
  return s;
}
/** Marks cached answers as used now, so the ones left unused are the ones to go. */
export function cacheTouch(s, keys, at = new Date().toISOString()) {
  const st = base(s);
  for (const k of keys || []) if (st.cache[k]) st.cache[k].at = at;
  return s;
}
/** Files the record of a run (the last RUNS_KEPT are kept): { id, at, kind, model, fieldIds, estimate, used, cached, skipped }. */
export function recordRun(s, run) {
  const st = base(s);
  if (obj(run) && str(run.id)) st.runs = [...st.runs.filter(r => r.id !== run.id), run].slice(-RUNS_KEPT);
  return s;
}
/** Removes a field's grouping (its categories and the texts' categories) and keeps what a person said about its no-value words and markers. */
export function removeGrouping(s, fieldId) {
  const f = base(s).fields[fieldId]; if (!f) return s;
  f.categories = {}; f.cells = {}; delete f.definitionHash; delete f.model;
  prune(s, fieldId); return s;
}

/**
 * Files the notes of a Review data run: `byCell` is { cellKey: [note] }. The open notes an earlier review left are superseded (a cell the new
 * run no longer flags loses them); a note a person dismissed or applied stays, and a new note that says the same of the same value is not
 * filed again, so a dismissed finding does not come back on the next run. Cells listed in `byCell` and the cells of earlier reviews only.
 * Nothing here reads or writes a value.
 */
export function fileReviewRun(s, byCell, { runId, prefix = 'review-' } = {}) {
  const st = base(s);
  for (const [cell, list] of Object.entries(st.review)) {
    const kept = list.filter(n => !(String(n.runId).startsWith(prefix) && n.state === 'open'));
    if (kept.length) st.review[cell] = kept; else delete st.review[cell];
  }
  for (const [cell, notes] of Object.entries(byCell || {})) {
    const earlier = st.review[cell] || [];
    const fresh = notes.filter(n => !earlier.some(e => e.kind === n.kind && e.text === n.text && e.valueHash === n.valueHash));
    noteReview(s, cell, fresh.map(n => ({ ...n, runId })));
  }
  return s;
}
