// Project-scoped, idempotent screening imports with complete prior-state history.
import { lib_project_trim$retrievalRecord as retrievalRecord, lib_project_trim$workbookRow as workbookRow } from "../boot.mjs";
import { lib_rules_key$rulesKey as rulesKey, lib_rules_key$sameRules as sameRules, lib_rules_key$compactScreening as compactScreening, lib_rules_key$criterionStage as criterionStage } from "../boot.mjs";
import { lib_fields$carryValues as carryValues } from "../boot.mjs";
const same = (p, identity) => p && identity && p.title === identity.title && String(p.doi || '') === String(identity.doi || '');
const idsOf = s => { const m = new Map(); for (const p of s.papers || []) if (!m.has(p.id)) m.set(p.id, p); return m; };
function repairImportedReferences(s, batch) {
  const ids = idsOf(s);
  for (const item of batch.records || []) {
    const p = ids.get(item.id);
    if (p?.screeningReview?.batchId === batch.id && p.pdfRetrieval?.status === 'available') p.pdfRetrieval.status = 'preview';
  }
  const rewrite = value => {
    if (typeof value === 'string') {
      for (const pair of batch.merges || []) {
        value = value.split(`[@${pair.duplicate}]`).join(`[@${pair.keep}]`);
        value = value.replace(/\[@([^\s\]]+)((?:\s+[^\]]*)?)\]/g, (token, key, locator) => key === pair.duplicate ? `[@${pair.keep}${locator}]` : token);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,rewrite(v)]));
    return value;
  };
  if (s.manuscript) s.manuscript = rewrite(s.manuscript);
  return s;
}
// The record kept in screeningBatches[].before. Version 2 holds only what the import changed (a project of 30,000 records used to copy eleven
// whole sections into the saved file); the older shape, the sections themselves, is still read by restoreScreeningBatch. Earlier batches lose
// their `before` when a later one is applied (compactScreening), so only the last import can be put back.
const clone = v => v === undefined ? undefined : structuredClone(v);
const slotOf = (o, k) => o && Object.hasOwn(o, k) ? [k, 1, clone(o[k])] : [k, 0];
const setSlot = (o, [k, had, v]) => { if (had) o[k] = clone(v); else delete o[k]; };
const mentions = (v, id) => typeof v === 'string' ? v.includes(id) : Array.isArray(v) ? v.some(x => mentions(x, id)) : v && typeof v === 'object' ? Object.values(v).some(x => mentions(x, id)) : false;
const FLAGS = ['needsCriteriaReview', 'criteriaAmendedAt'];
export function applyScreeningBatch(s, batch) {
  if (!batch?.id) return s;
  if ((s.screeningBatches || []).some(b => b.id === batch.id)) return repairImportedReferences(s, batch);
  if (JSON.stringify(s.protocol?.criteria || []) !== JSON.stringify(batch.expectedCriteria || [])) throw new Error('Criteria changed since this review began; import needs reconciliation.');
  const byId = new Map(s.papers.map(p => [p.id, p]));
  for (const item of batch.records || []) if (!same(byId.get(item.id), item.identity)) throw new Error('A paper changed since screening; import needs reconciliation.');
  const merges = batch.merges || [], at = new Date().toISOString();
  const before = { v: 2, protocol: slotOf(s, 'protocol'), proposals: [s.proposals !== undefined ? 1 : 0, slotOf(s.proposals, 'ta')], flags: { screening: {}, fulltext: {} },
    papers: { changed: [], removed: [] }, merged: Array.isArray(s.merged) ? s.merged.length : null, aliases: [s.paperAliases !== undefined ? 1 : 0, []], carried: { screening: [], fulltext: [], assessments: [] },
    values: [], scenario: [], sections: [], rk: [], log: Array.isArray(s.screeningLog) ? s.screeningLog.length : null, batches: s.screeningBatches !== undefined ? 1 : 0 };
  const orig = new Map(), touch = p => { if (!orig.has(p.id)) orig.set(p.id, structuredClone(p)); };
  const index = merges.length ? new Map(s.papers.map((p, i) => [p.id, i])) : null;
  // citation sections are copied whole, and only when a duplicate is cited in them
  for (const key of ['manuscript', 'collections', 'notes']) if (s[key] && merges.some(m => mentions(s[key], m.duplicate))) before.sections.push([key, clone(s[key])]);
  const amendments = [...(s.protocol?.amendments || []), { at, note: batch.note, source: batch.source }];
  s.protocol = { ...s.protocol, ...batch.protocol };
  s.protocol.amendments = amendments;
  // Preserve the reviewer's decisions and explicitly mark them for reassessment.
  for (const key of ['screening', 'fulltext']) for (const [id, d] of Object.entries(s[key] || {})) {
    if (!byId.has(id)) continue;
    const had = {}; for (const f of FLAGS) if (d && Object.hasOwn(d, f)) had[f] = clone(d[f]);
    if (Object.keys(had).length) before.flags[key][id] = had;
    s[key][id] = { ...d, needsCriteriaReview: true, criteriaAmendedAt: at };
  }
  s.proposals = { ...(s.proposals || {}), ta: {} };
  for (const item of batch.records || []) {
    if (item.proposal) s.proposals.ta[item.id] = item.proposal;
    const p = byId.get(item.id);
    touch(p);
    if (item.preview?.url) p.pdfRetrieval = retrievalRecord({ ...(p.pdfRetrieval || {}), status: 'preview', kind: 'pdf', url: item.preview.url, provider: item.preview.provider, at, error: null });
    p.screeningReview = { workbook: workbookRow(item.workbook), independent: item.independent, batchId: batch.id };
  }
  // Only explicitly verified duplicate pairs are folded; originals remain reversible.
  const seen = new Set(), once = (list, key, entry) => { if (!seen.has(key)) { seen.add(key); list.push(entry); } };
  const ids = idsOf(s);
  // A pass over the records, the merges, the aliases, the values or a citation section per pair made 3,000 merges of 30,000 records take
  // 5 s (15 Nov 2026): each is copied once, written in place and, for the records, filtered once after the loop
  const gone = new Set(), to = new Map(), toward = new Map();   // the removed ids; each value's redirect, and the values redirected to an id
  const byPaper = new Map();   // a paper's value keys, in their order in s.values
  const valueOf = (pid, k) => { const l = byPaper.get(pid); if (l) l.push(k); else byPaper.set(pid, [k]); };
  if (merges.length) for (const [k, v] of Object.entries(s.values || {})) valueOf(v?.paper_id, k);
  let owned = false;
  for (const pair of merges) {
    const keep = ids.get(pair.keep), dup = ids.get(pair.duplicate);
    if (!keep || !dup) continue;
    touch(keep); touch(dup);
    if (!owned) { s.merged = [...(s.merged || [])]; s.paperAliases = { ...(s.paperAliases || {}) }; owned = true; }
    const prior = structuredClone(keep);
    for (const key of ['doi', 'pmid', 'journal', 'year', 'abstract', 'pdf', 'pdfName', 'language']) if (!keep[key] && dup[key]) keep[key] = dup[key];
    keep.mergedFrom = [...(keep.mergedFrom || []), { id: dup.id, at, before: prior }];
    s.merged.push({ keepId: keep.id, dup: structuredClone(dup), at, reason: pair.reason, batchId: batch.id });
    gone.add(dup.id);
    before.papers.removed.push({ i: index.get(dup.id), p: orig.get(dup.id) });
    once(before.aliases[1], `a:${dup.id}`, slotOf(s.paperAliases, dup.id));
    s.paperAliases[dup.id] = keep.id;
    // Rewrite structured citation/reference values, never prose or historical logs: the pairs in order, made one map of where each value
    // ends (with B→A then C→B, a B is A and a C is B) and written once after the loop
    const moved = toward.get(dup.id) || new Set();
    if (!to.has(dup.id)) moved.add(dup.id);
    toward.delete(dup.id);
    const there = toward.get(keep.id) || new Set();
    for (const x of moved) { to.set(x, keep.id); there.add(x); }
    toward.set(keep.id, there);
    for (const key of ['screening', 'fulltext', 'assessments']) if (s[key]?.[dup.id] && !s[key][keep.id]) {
      once(before.carried[key], `${key}:${keep.id}`, slotOf(s[key], keep.id));
      s[key][keep.id] = structuredClone(s[key][dup.id]);
    }
    // a protocol scenario's own decisions move to the kept record the same way (lib/scenarios.mjs)
    for (const [name, lane] of Object.entries(s.scenarioScreening || {})) for (const st of ['ta', 'ft']) {
      const byStage = lane?.[st];
      if (!byStage?.[dup.id]) continue;
      // each place once, as it was before the first merge touched it, so the order of restoring does not matter
      for (const id of [dup.id, keep.id]) once(before.scenario, `s:${name}:${st}:${id}`, [name, st, slotOf(byStage, id)]);
      if (!byStage[keep.id]) byStage[keep.id] = byStage[dup.id];
      delete byStage[dup.id];
    }
    // the duplicate's accepted values go to the kept record where it has none of its own (lib/fields.mjs carryValues, by the index)
    if (byPaper.has(dup.id)) for (const next of carryValues(s, dup.id, keep.id, byPaper.get(dup.id))) { before.values.push(next); valueOf(keep.id, next); }
  }
  if (gone.size) s.papers = s.papers.filter(p => !gone.has(p.id));
  if (to.size) {
    const redirect = value => {
      if (to.has(value)) return to.get(value);
      if (Array.isArray(value)) return value.map(redirect);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redirect(v)]));
      return value;
    };
    for (const key of ['manuscript', 'collections', 'notes']) if (s[key]) s[key] = redirect(s[key]);
  }
  before.papers.changed = [...orig.values()].filter(p => !gone.has(p.id));
  // compactScreening shortens the rules text of proposals outside the replaced stage: keep the long form
  for (const [stage, map] of Object.entries(s.proposals)) if (stage !== 'ta' && map && typeof map === 'object') for (const [id, p] of Object.entries(map))
    for (const [which, q] of [['', p], ['jev', p?.jev]]) if (q && typeof q.rulesSnapshot === 'string' && !q.rulesSnapshot.startsWith('rk:')) before.rk.push([stage, id, which, q.rulesSnapshot]);
  s.screeningBatches = [...(s.screeningBatches || []), { id: batch.id, at, source: batch.source, note: batch.note, before, review: batch.review }];
  compactScreening(s);
  s.screeningLog = [...(s.screeningLog || []), { action: 'protocol-amendment', at, via: 'screening-crosscheck', batchId: batch.id }];
  return repairImportedReferences(s, batch);
}

/** Puts the project back as it was before batch `batchId` was applied, and drops the batch's record so it can be applied again.
 *  Reads both shapes of `before`: version 2 (what the import changed) and the older whole sections. Throws when the record was compacted away. */
export function restoreScreeningBatch(s, batchId) {
  const b = (s.screeningBatches || []).find(x => x.id === batchId), r = b?.before;
  if (!r) throw new Error('This import did not keep its prior state.');
  // a record a merge removed comes back as main's: never while a protocol scenario holds that id (an id is in one of the two, lib/search-library.mjs)
  const here = new Set((s.papers || []).map(p => p.id)), back = new Set((r.v === 2 ? r.papers.removed.map(x => x.p) : r.papers || []).map(p => p?.id).filter(id => !here.has(id)));
  if ((s.scenarioPapers || []).some(p => back.has(p?.id))) throw new Error('A protocol scenario found a merged record again since this import; undoing it needs reconciliation.');
  if (r.v !== 2) {
    for (const k of ['protocol', 'proposals', 'screening', 'fulltext', 'papers', 'merged', 'manuscript', 'collections', 'notes', 'values', 'assessments']) { if (r[k] === undefined) delete s[k]; else s[k] = clone(r[k]); }
    if (s.screeningLog) s.screeningLog = s.screeningLog.filter(e => !(e.action === 'protocol-amendment' && e.batchId === batchId));
  } else {
    setSlot(s, r.protocol);
    if (!r.proposals[0]) delete s.proposals; else if (s.proposals) setSlot(s.proposals, r.proposals[1]);
    for (const [stage, id, which, text] of r.rk) { const p = s.proposals?.[stage]?.[id], q = which ? p?.jev : p; if (q) q.rulesSnapshot = text; }
    for (const key of ['screening', 'fulltext']) {
      for (const [id, d] of Object.entries(s[key] || {})) if (d?.criteriaAmendedAt === b.at) { for (const f of FLAGS) delete d[f]; Object.assign(d, clone(r.flags[key][id])); }
    }
    for (const key of ['screening', 'fulltext', 'assessments']) for (const slot of r.carried[key]) setSlot(s[key], slot);
    for (const k of r.values) delete s.values?.[k];
    for (const [name, st, slot] of r.scenario) { const m = s.scenarioScreening?.[name]?.[st]; if (m) setSlot(m, slot); }
    for (const [key, v] of r.sections) s[key] = clone(v);
    if (r.aliases[0]) { for (const slot of r.aliases[1]) setSlot(s.paperAliases, slot); } else delete s.paperAliases;
    if (r.merged === null) delete s.merged; else if (s.merged) s.merged = s.merged.slice(0, r.merged);
    if (s.screeningLog) { s.screeningLog = s.screeningLog.filter(e => !(e.action === 'protocol-amendment' && e.batchId === batchId)); if (r.log === null && !s.screeningLog.length) delete s.screeningLog; }
    const back = new Map(r.papers.changed.map(p => [p.id, p]));
    s.papers = s.papers.map(p => back.has(p.id) ? clone(back.get(p.id)) : p);
    for (const { i, p } of [...r.papers.removed].sort((x, y) => x.i - y.i)) s.papers.splice(i, 0, clone(p));
  }
  const rest = s.screeningBatches.filter(x => x.id !== batchId);
  if (rest.length || (r.v === 2 ? r.batches : 1)) s.screeningBatches = rest; else delete s.screeningBatches;
  return s;
}

/** Import audited model proposals without modifying reviewer decisions. */
export function applyJevCrossCheck(s, batch) {
  if (!batch?.id || (s.jevRuns || []).some(run => run.id === batch.id)) return s;
  const rules = (s.protocol?.criteria || []).filter(r => (r.question || r.text) && criterionStage(r) !== 'ft');
  if (!sameRules(batch.rulesSnapshot, rules)) throw new Error('Screening criteria changed during the run.');
  const ids = idsOf(s);
  for (const item of batch.records || []) {
    if (!same(ids.get(item.id), item.identity)) throw new Error('Screened paper identity changed.');
    const p = item.proposal;
    if (!p || p.error || p.passes?.length !== 3 || !sameRules(p.rulesSnapshot, batch.rulesSnapshot) || !['include', 'exclude', 'uncertain'].includes(p.verdict)) throw new Error('Incomplete cross-check results.');
  }
  const at = new Date().toISOString();
  const before = structuredClone(s.proposals?.ta || {});
  s.proposals = { ...(s.proposals || {}), ta: { ...before } };
  for (const item of batch.records || []) s.proposals.ta[item.id] = { ...item.proposal, rulesSnapshot: rulesKey(item.proposal.rulesSnapshot), tier: 'jev', runId: batch.id };
  // One copy of the rules per run; only the latest run keeps what it replaced.
  s.jevRuns = [...(s.jevRuns || []), { id: batch.id, at, model: batch.model, rulesSnapshot: rulesKey(rules), rules: JSON.stringify(rules), total: batch.records.length, before, summary: batch.summary }];
  compactScreening(s);
  s.jobs = [{ id: batch.id, kind: 'screen', label: `Jev cross-check: ${batch.records.length} records, 3 passes`, status: 'done', startedAt: batch.startedAt || at, endedAt: at, done: batch.records.length, total: batch.records.length, progress: '', result: batch.summary || '', error: null }, ...(s.jobs || [])].slice(0,200);
  return s;
}
