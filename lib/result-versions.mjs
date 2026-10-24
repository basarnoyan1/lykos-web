// Versions of the kept results (plan §2, "One registry", 2026-10-23): an outcome's pooled analysis (`analysis:<slot>`), a kept dataset
// analysis (`dataset:<id>`, a Kaplan–Meier from Make among them) and the patient data's time-to-event analysis (`survival`) keep their
// earlier states as output specs do (lib/versions.mjs), in `s.resultVersions[key]`. A result kept again or run again with what it read
// changed adds a version; one that holds what the latest holds adds none; an interim result (a JavaScript check while R runs) adds none.
// Restore puts a version back as the result and adds a version. A result kept before versions were (no list) is its own first version.
// Pure over the state it is given: call the writers inside the store's update().
import { stable, recordVersion } from './versions.mjs';
import { analysisOf, setAnalysis } from './outcomes.mjs';

export const RESULT_VERSION_LIMIT = 12;
// what a result holds, without when it was made, its drawing or its working state: two results that hold the same compare equal
const VOLATILE = new Set(['id', 'at', 'checking', 'jsCheck', 'figures', 'jobId', 'plot', 'frozenData', 'population', 'implementation', 'made']);
export const resultKey = r => stable(Object.fromEntries(Object.entries(r || {}).filter(([k]) => !VOLATILE.has(k))));
const inputsOf = r => stable(r?.inputSnapshot ?? r?.rowsVersion ?? r?.ext?.inputSnapshot ?? null);
const settingsOf = r => stable([r?.settings ?? null, r?.inputs ?? null, r?.options ?? null, r?.ext?.inputSpec ?? null, r?.measure ?? null]);
/** What changed between two states of a result, in a few words. */
export const resultChange = (a, b) => (inputsOf(a) !== inputsOf(b) ? 'Data changed' : settingsOf(a) !== settingsOf(b) ? 'Settings changed' : 'Result changed');

/** The live result a key names, or null. */
export function resultOf(s, key) {
  const k = String(key || '');
  if (k === 'survival') return s.survival || null;
  if (k.startsWith('analysis:')) return analysisOf(s, k.slice(9));
  if (k.startsWith('dataset:')) return (s.datasetAnalyses || []).find(a => a.id === k.slice(8)) || null;
  return null;
}
function writeResult(st, key, data) {
  if (key === 'survival') st.survival = data;
  else if (key.startsWith('analysis:')) setAnalysis(st, key.slice(9), data);
  else if (key.startsWith('dataset:')) { const id = key.slice(8); st.datasetAnalyses = (st.datasetAnalyses || []).map(a => (a.id === id ? { ...data, id } : a)); }
}
const firstOf = r => ({ n: 1, at: r.at || '', author: '', message: '', summary: 'Kept', data: structuredClone(r) });

/**
 * Notes that the result `key` goes from `before` to `after` (both as stored). Returns the version added, or null. Call it with the state
 * the change is written to; it does not write the result itself.
 */
export function noteResult(st, key, before, after, opts = {}) {
  if (!after) return null;
  let list = st.resultVersions?.[key] || [];
  if (!list.length) {
    if (!before || before.checking || resultKey(before) === resultKey(after)) return null;   // nothing earlier to keep
    list = [firstOf(before)];
    // an interim result replaces the kept one while R runs: the kept one is its first version now, the interim none
    if (after.checking) { st.resultVersions = { ...(st.resultVersions || {}), [key]: list }; return null; }
  }
  if (after.checking) return null;
  const { versions, version } = recordVersion(list, after, { field: 'data', key: resultKey, summarize: resultChange, author: opts.author || 'You', message: opts.message || '',
    summary: opts.summary || '', at: opts.at || after.at || new Date().toISOString(), restoredFrom: opts.restoredFrom, limit: RESULT_VERSION_LIMIT });
  if (version) st.resultVersions = { ...(st.resultVersions || {}), [key]: versions };
  return version;
}

/**
 * The versions of `key`, oldest first: the kept ones, and the result as it is when it holds something they do not (a result kept before
 * versions were, or changed by a path that kept none). `[]` when there is no result.
 */
export function resultVersions(s, key) {
  const live = resultOf(s, key), list = s.resultVersions?.[key] || [];
  if (!live || live.checking) return list;   // an interim result while R runs is no version
  if (!list.length) return [firstOf(live)];
  return resultKey(list.at(-1).data) === resultKey(live) ? list : [...list, { n: list.at(-1).n + 1, at: live.at || '', author: '', message: '', summary: 'Changed', data: structuredClone(live) }];
}

/** Version `n` of `key` put back as the result, recorded as a new version. Throws when it is gone. */
export function restoreResult(st, key, n, { author = 'You' } = {}) {
  const v = resultVersions(st, key).find(x => x.n === n);
  if (!v) throw new Error('That version is no longer kept.');
  const before = resultOf(st, key);
  if (!before) throw new Error('That result is no longer in the project.');
  // the list as shown (with the live result when it was unrecorded) is kept first, so the state restored over stays a version
  st.resultVersions = { ...(st.resultVersions || {}), [key]: resultVersions(st, key) };
  const data = { ...structuredClone(v.data), at: new Date().toISOString() };
  writeResult(st, key, data);
  return noteResult(st, key, before, resultOf(st, key), { author, summary: `Restored v${n}`, message: `Restored v${n}`, restoredFrom: n });
}

/**
 * A dataset analysis kept (lib/dataset-analysis.mjs analysisEntry): the same analysis of the same table (its kind, inputs and options) kept
 * again replaces the one kept, under its id, as a new version; any other is added. Returns the id it is kept under.
 */
export function keepDatasetEntry(st, entry, opts = {}) {
  const list = st.datasetAnalyses || [];
  const same = list.find(a => a.datasetId === entry.datasetId && a.kind === entry.kind && stable(a.inputs || {}) === stable(entry.inputs || {}) && stable(a.options || {}) === stable(entry.options || {}));
  if (!same) { st.datasetAnalyses = [...list, entry]; return entry.id; }
  const kept = { ...entry, id: same.id, ...(same.made && !entry.made ? { made: same.made } : {}) };
  noteResult(st, `dataset:${same.id}`, same, kept, opts);
  st.datasetAnalyses = list.map(a => (a.id === same.id ? kept : a));
  return same.id;
}

/** The patient data's time-to-event analysis run again (views/analysis-survival.mjs). */
export function setSurvival(st, result, opts = {}) {
  noteResult(st, 'survival', st.survival || null, result, opts);
  st.survival = result;
  return st;
}
