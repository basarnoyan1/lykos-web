// The counts the integration checks read (lib/coverage-needs.mjs, plan §4.15e): what the project record holds at each
// stage, as plain numbers. Collected once per pass by lib/figure-facts.mjs (`state.coverage`) so the detector never
// reaches into the project. Pure: no store, no clock, no file; the same state gives the same counts.
import { schema$APPRAISAL_TOOLS as APPRAISAL_TOOLS, schema$appraisalTool as appraisalTool } from "../boot.mjs";
import { importedSources } from './audit-findings.mjs';

const arr = v => Array.isArray(v) ? v : [];
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const keys = o => Object.keys(isObj(o) ? o : {});

/** Whether a study has an answer under its own instrument, the project's, or (for RoB 2 projects) any custom one: lib/progress.mjs's rule. */
function appraised(s, id) {
  const rec = s.assessments?.[id];
  if (!isObj(rec)) return false;
  const own = s.appraisalByStudy?.[id];
  if (own && isObj(rec[own]) && Object.values(rec[own]).some(Boolean)) return true;
  let tool = null;
  try { tool = appraisalTool(s.appraisalTool || 'rob2'); } catch { tool = null; }
  if (tool && rec[tool.id]) return true;
  // no instrument chosen for the study: it takes the one that holds its answers (lib/study-instrument.mjs, rule 2), so any started checklist counts
  if (!own && Object.values(rec).some(v => isObj(v) && Object.values(v).some(Boolean))) return true;
  return (!tool || tool.id === 'rob2') && Object.keys(rec).some(k => !APPRAISAL_TOOLS.some(t => t.id === k));
}

/**
 * `{ type, criteria, searches, papers, taDecided, taWaiting, ftWaiting, included, values, unextracted, assessed, rated, analyses,
 *    prismaFilled, participants, submissions, manuscriptBlocks, auditSources }` of a project state.
 */
export function coverageState(s) {
  s = isObj(s) ? s : {};
  const papers = arr(s.papers).filter(p => isObj(p) && p.id != null), ids = papers.map(p => String(p.id));
  const ta = ids.filter(id => s.screening?.[id]?.decision);
  const taInclude = ids.filter(id => s.screening?.[id]?.decision === 'include');
  const records = ids.filter(id => (s.fulltext?.[id] || s.screening?.[id])?.decision === 'include');
  // studies, not reports (lib/review-studies.mjs): a trial's further reports (reportOf) count once with it. 2 Nov 2026: the Sham response
  // folder's appraisal check read "117 of 138 included studies" for 114 trials, all appraised, counting 24 companion reports.
  const reportOf = new Map(papers.map(p => [String(p.id), p.reportOf ? String(p.reportOf) : String(p.id)])), lead = new Map();
  for (const id of records) { const k = reportOf.get(id), was = lead.get(k); if (!was || (id === k && was !== k)) lead.set(k, id); }
  const included = records.filter(id => lead.get(reportOf.get(id)) === id);
  const values = keys(s.values).filter(k => s.values[k]);
  const withValue = new Set(values.map(k => k.slice(0, k.indexOf(':'))));
  const analyses = [...(isObj(s.analysis) ? [s.analysis] : []), ...Object.values(isObj(s.analyses) ? s.analyses : {}).filter(isObj), ...(isObj(s.survival) ? [s.survival] : []), ...arr(s.advancedAnalyses).filter(isObj)];
  return {
    type: typeof s.project?.researchType === 'string' ? s.project.researchType : '',
    criteria: arr(s.protocol?.criteria).length,
    searches: arr(s.searches).length,
    papers: papers.length,
    taDecided: ta.length,
    taWaiting: papers.length - ta.length,
    ftWaiting: taInclude.filter(id => !s.fulltext?.[id]?.decision).length,
    included: included.length,
    values: values.length,
    unextracted: included.filter(id => !withValue.has(id)).length,
    assessed: included.filter(id => appraised(s, id)).length,
    rated: arr(s.grade).filter(isObj).length,
    analyses: analyses.length,
    prismaFilled: keys(s.prisma).filter(k => s.prisma[k] != null && s.prisma[k] !== '').length,
    participants: arr(s.participants).length,
    submissions: arr(s.submissions).filter(isObj).length,
    manuscriptBlocks: arr(s.manuscript?.blocks).length,
    auditSources: [...importedSources(s.todos)].sort(),
  };
}
