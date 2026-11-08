// Persist one immutable copy per distinct record version, not per graph edge.
const indexes = new WeakMap();
export function outputRecords(run, nodeId) {
  const output = run.outputs?.[nodeId];
  if (Array.isArray(output)) return output; // legacy runs
  if (!output) return [];
  if (!Array.isArray(output.refs)) throw new Error('The workflow output is damaged');
  return output.refs.map(ref => { const row = run.recordPool?.[ref]; if (!row) throw new Error('A saved workflow record version is missing'); return row; });
}
export function setOutputRecords(run, nodeId, records) {
  run.recordPool ||= {}; run.outputs ||= {};
  let index = indexes.get(run);
  if (!index) { index = new Map(Object.entries(run.recordPool).map(([key, record]) => [JSON.stringify(record), key])); indexes.set(run, index); }
  const refs = records.map(record => {
    const signature = JSON.stringify(record); let key = index.get(signature);
    if (!key) { key = `record-${index.size + 1}`; while (Object.hasOwn(run.recordPool, key)) key += '-v'; run.recordPool[key] = structuredClone(record); index.set(signature, key); }
    return key;
  });
  run.outputs[nodeId] = { refs, count: refs.length };
}
const HEAVY = new Set(['workflowRuns','threads','researchLedger','datasets','datasetAnalyses','survival','advancedAnalyses','propensityAnalyses','predictionModels','outputs','paper','manuscript','manuscriptVersions','imagingMeasurements','figures','files']);
/** Only the research domains and record IDs used by this task are copied. */
export function researchSnapshot(state, records, { allRecords = false } = {}) {
  const ids = new Set(records.map(r => r.id));
  const matches = key => { for (let at = key.indexOf(':'); at >= 0; at = key.indexOf(':', at + 1)) if (ids.has(key.slice(0, at))) return true; return false; };
  const picked = Object.fromEntries(Object.entries(state).filter(([key]) => !HEAVY.has(key)));
  picked.papers = allRecords ? state.papers : (state.papers || []).filter(p => ids.has(p.id));
  for (const key of ['values','proposals']) picked[key] = Object.fromEntries(Object.entries(state[key] || {}).filter(([id]) => allRecords || matches(id)));
  for (const key of ['screening','fulltext']) picked[key] = Object.fromEntries(Object.entries(state[key] || {}).filter(([id]) => allRecords || ids.has(id)));
  for (const key of ['dual','jev']) picked[key] = Object.fromEntries(Object.entries(state[key] || {}).map(([stage, values]) => [stage, Object.fromEntries(Object.entries(values || {}).filter(([id]) => allRecords || ids.has(id)))]));
  for (const stage of ['ta','ft']) if (state.proposals?.[stage]) picked.proposals[stage] = Object.fromEntries(Object.entries(state.proposals[stage]).filter(([id]) => allRecords || ids.has(id)));
  return structuredClone(picked);
}
