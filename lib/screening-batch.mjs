// Project-scoped, idempotent screening imports with complete prior-state history.
import { lib_project_trim$retrievalRecord as retrievalRecord, lib_project_trim$workbookRow as workbookRow } from "../boot.mjs";
import { lib_rules_key$rulesKey as rulesKey, lib_rules_key$sameRules as sameRules, lib_rules_key$compactScreening as compactScreening, lib_rules_key$criterionStage as criterionStage } from "../boot.mjs";
import { lib_fields$carryValues as carryValues } from "../boot.mjs";
const same = (p, identity) => p && identity && p.title === identity.title && String(p.doi || '') === String(identity.doi || '');
function repairImportedReferences(s, batch) {
  for (const item of batch.records || []) {
    const p = s.papers.find(p => p.id === item.id);
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
export function applyScreeningBatch(s, batch) {
  if (!batch?.id) return s;
  if ((s.screeningBatches || []).some(b => b.id === batch.id)) return repairImportedReferences(s, batch);
  if (JSON.stringify(s.protocol?.criteria || []) !== JSON.stringify(batch.expectedCriteria || [])) throw new Error('Criteria changed since this review began; import needs reconciliation.');
  for (const item of batch.records || []) if (!same(s.papers.find(p => p.id === item.id), item.identity)) throw new Error('A paper changed since screening; import needs reconciliation.');
  const before = structuredClone({ protocol: s.protocol, proposals: s.proposals, screening: s.screening, fulltext: s.fulltext, papers: s.papers, merged: s.merged, manuscript: s.manuscript, collections: s.collections, notes: s.notes, values: s.values, assessments: s.assessments });
  const at = new Date().toISOString();
  s.protocol = { ...s.protocol, ...batch.protocol };
  s.protocol.amendments = [...(before.protocol?.amendments || []), { at, note: batch.note, source: batch.source }];
  // Preserve the reviewer's decisions and explicitly mark them for reassessment.
  for (const key of ['screening', 'fulltext']) for (const [id, d] of Object.entries(s[key] || {})) {
    if (s.papers.some(p => p.id === id)) s[key][id] = { ...d, needsCriteriaReview: true, criteriaAmendedAt: at };
  }
  s.proposals = { ...(s.proposals || {}), ta: {} };
  for (const item of batch.records || []) {
    if (item.proposal) s.proposals.ta[item.id] = item.proposal;
    const p = s.papers.find(p => p.id === item.id);
    if (item.preview?.url) p.pdfRetrieval = retrievalRecord({ ...(p.pdfRetrieval || {}), status: 'preview', kind: 'pdf', url: item.preview.url, provider: item.preview.provider, at, error: null });
    p.screeningReview = { workbook: workbookRow(item.workbook), independent: item.independent, batchId: batch.id };
  }
  // Only explicitly verified duplicate pairs are folded; originals remain reversible.
  for (const pair of batch.merges || []) {
    const keep = s.papers.find(p => p.id === pair.keep), dup = s.papers.find(p => p.id === pair.duplicate);
    if (!keep || !dup) continue;
    const prior = structuredClone(keep);
    for (const key of ['doi', 'pmid', 'journal', 'year', 'abstract', 'pdf', 'pdfName', 'language']) if (!keep[key] && dup[key]) keep[key] = dup[key];
    keep.mergedFrom = [...(keep.mergedFrom || []), { id: dup.id, at, before: prior }];
    s.merged = [...(s.merged || []), { keepId: keep.id, dup: structuredClone(dup), at, reason: pair.reason, batchId: batch.id }];
    s.papers = s.papers.filter(p => p.id !== dup.id);
    s.paperAliases = { ...(s.paperAliases || {}), [dup.id]: keep.id };
    // Rewrite structured citation/reference values, never prose or historical logs.
    const redirect = value => {
      if (value === dup.id) return keep.id;
      if (Array.isArray(value)) return value.map(redirect);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redirect(v)]));
      return value;
    };
    for (const key of ['manuscript', 'collections', 'notes']) if (s[key]) s[key] = redirect(s[key]);
    for (const key of ['screening', 'fulltext', 'assessments']) if (s[key]?.[dup.id] && !s[key][keep.id]) s[key][keep.id] = structuredClone(s[key][dup.id]);
    // a protocol scenario's own decisions move to the kept record the same way (lib/scenarios.mjs)
    for (const lane of Object.values(s.scenarioScreening || {})) for (const st of ['ta', 'ft']) {
      const byId = lane?.[st];
      if (!byId?.[dup.id]) continue;
      if (!byId[keep.id]) byId[keep.id] = byId[dup.id];
      delete byId[dup.id];
    }
    carryValues(s, dup.id, keep.id);
  }
  s.screeningBatches = [...(s.screeningBatches || []), { id: batch.id, at, source: batch.source, note: batch.note, before, review: batch.review }];
  compactScreening(s);
  s.screeningLog = [...(s.screeningLog || []), { action: 'protocol-amendment', at, via: 'screening-crosscheck', batchId: batch.id }];
  return repairImportedReferences(s, batch);
}

/** Import audited model proposals without modifying reviewer decisions. */
export function applyJevCrossCheck(s, batch) {
  if (!batch?.id || (s.jevRuns || []).some(run => run.id === batch.id)) return s;
  const rules = (s.protocol?.criteria || []).filter(r => (r.question || r.text) && criterionStage(r) !== 'ft');
  if (!sameRules(batch.rulesSnapshot, rules)) throw new Error('Screening criteria changed during the run.');
  for (const item of batch.records || []) {
    if (!same(s.papers.find(p => p.id === item.id), item.identity)) throw new Error('Screened paper identity changed.');
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
