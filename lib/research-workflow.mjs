// The next work in a review, derived from authoritative project state. A
// navigation action never changes a scientific decision or accepts a proposal.
// A primary study (a trial, a cohort, a survey…) has its own order: question,
// registration and sample size, then its data, its analysis, the manuscript
// and the reporting checklist; background reading comes last.
import { isIncluded } from './screen.mjs';
import { columnsOf, templates } from './templates.mjs';
import { projectMode, visibleViews, researchType } from './workflow.mjs';
import { isPrimaryType, typeById } from './research-types.mjs';
import { checks, inputs } from './progress-gate.mjs';   // the reporting checklist loads with a primary study (lib/progress-gate.mjs)
import { outcomes as outcomeList, analysisOf } from './outcomes.mjs';
import { currentDatasetAnalyses } from './dataset-analysis-core.mjs';

export function nextResearchActions(state, { limit = 8 } = {}) {
  const out = [];
  const add = (kind, view, text, extra = {}) => out.push({ kind, view, text, ...extra });
  const papers = state.papers || [];
  const mode = projectMode(state);
  const type = researchType(state).id;
  if (!mode) return [];
  if (isPrimaryType(type)) return primaryActions(state, type, limit);
  const included = papers.filter(p => mode === 'workspace' || isIncluded(state, p.id));

  if (mode !== 'workspace' && !state.protocol?.title && !state.paper?.title) add('protocol', 'protocol', 'Define review question');
  if (type === 'case-series' && !state.protocol?.title) add('protocol', 'protocol', 'Define study objective');
  if (mode !== 'workspace' && !state.protocol?.criteria?.length) add('protocol', 'protocol', 'Define eligibility criteria');
  if (!state.searches?.length && !papers.length) add('search', 'search', type === 'case-report' ? 'Find background literature' : mode === 'workspace' ? 'Find papers' : 'Run first literature search');

  const undecided = papers.filter(p => !state.screening?.[p.id] || state.screening[p.id].decision === 'uncertain');
  if (undecided.length) add('screening', 'screening', `Screen ${undecided.length} ${undecided.length === 1 ? 'record' : 'records'}`);

  const missingPdf = included.filter(p => !p.pdf);
  for (const p of missingPdf.slice(0, 2))
    add('full_text', 'library', `Attach full text · ${p.label || p.title || p.id}`, { paperId: p.id });

  const tableList = templates(state).map(t => ({ template: t, columns: columnsOf(t.id, state) }));
  const running = new Set(), completed = new Set();
  for (const r of state.runs || []) {
    const key = `${r.paper_id}:${r.template_id}`;
    if (r.status === 'running') running.add(key);
    if (r.kind === 'fill' && r.status === 'done') completed.add(key);
  }
  const pending = [];
  const fill = [];
  for (const p of included) {
    if (!p.pdf) continue;
    for (const { template: t, columns: cols } of tableList) {
      if (!cols.length) continue;
      let proposed = 0, firstProposed = '', missing = 0, firstMissing = '';
      for (const c of cols) {
        const key = `${p.id}:${c.id}`;
        if (state.proposals?.[key]) { proposed++; firstProposed ||= c.id; }
        else if (!state.values?.[key]) { missing++; firstMissing ||= c.id; }
      }
      if (proposed) {
        if (pending.length < 3) pending.push({ p, t, columnId: firstProposed, count: proposed });
        continue;
      }
      if (!missing || running.has(`${p.id}:${t.id}`)) continue;
      if (fill.length < 3) {
        fill.push({ p, t, count: missing, columnId: firstMissing, attempted: completed.has(`${p.id}:${t.id}`) });
      }
    }
    if (pending.length >= 3 && fill.length >= 3) break;
  }
  for (const { p, t, columnId, count } of pending.slice(0, 3))
    add('review', 'extraction', `Review ${count} proposed ${count === 1 ? 'cell' : 'cells'} · ${p.label || p.id} · ${t.name}`,
      { paperId: p.id, templateId: t.id, columnId });
  for (const { p, t, count, columnId, attempted } of fill.slice(0, 3))
    add(attempted ? 'complete' : 'fill', 'extraction', `${attempted ? 'Complete' : 'Fill'} ${count} ${count === 1 ? 'cell' : 'cells'} · ${p.label || p.id} · ${t.name}`,
      { paperId: p.id, templateId: t.id, columnId });

  const noAppraisal = included.filter(p => !Object.keys(state.assessments?.[p.id] || {}).length);
  if (noAppraisal.length) add('appraisal', 'appraisal', `Appraise ${noAppraisal.length} ${noAppraisal.length === 1 ? 'study' : 'studies'}`);

  const analysisStatus = inputs.pooledInputStatus(state);
  if (analysisStatus === 'stale') add('analysis', 'analysis', 'Rerun analysis · accepted inputs changed');
  else if (analysisStatus === 'untracked') add('analysis', 'analysis', 'Check analysis inputs');

  const blocks = state.manuscript?.blocks || [];
  if (included.length && !blocks.length) add('manuscript', 'manuscript', 'Start the manuscript');
  if (papers.length && !Object.values(state.prisma || {}).some(v => v !== '' && v != null))
    add('reporting', 'reporting', 'Reconcile reporting counts');

  // A case report's library is background reading: no full texts to chase and
  // no flow counts to reconcile. Its manuscript starts from the case.
  if (type === 'case-report') {
    const kept = out.filter(a => a.view === 'search');
    if (!blocks.length) kept.push({ kind: 'manuscript', view: 'manuscript', text: 'Start the manuscript' });
    return kept.slice(0, Math.max(0, limit));
  }
  const visible = new Set(visibleViews(state));
  return out.filter(a => visible.has(a.view)).slice(0, Math.max(0, limit));
}

const REGISTERED = new Set(['rct', 'cohort-study', 'diagnostic-study', 'prognostic-model', 'guideline']);
const SIZED = new Set(['rct', 'cohort-study', 'diagnostic-study', 'prognostic-model', 'survey-study']);
function primaryActions(s, type, limit) {
  const out = [];
  const add = (kind, view, text, extra = {}) => out.push({ kind, view, text, ...extra });
  const t = typeById(type);
  const rows = (s.datasets || []).reduce((a, d) => a + (d.rows || []).length, 0), patients = (s.participants || []).length;
  const hasData = rows > 0 || patients > 0;
  const ran = inputs.survivalInputStatus(s) === 'current' || currentDatasetAnalyses(s).length > 0 || (s.advancedAnalyses || []).some(a => inputs.advancedInputStatus(a, s) === 'current') || outcomeList(s).some(o => analysisOf(s, o.id));
  const blocks = s.manuscript?.blocks || [];
  const rep = checks.module()?.reportingOf(s);   // null until the checks are here: no reporting step is offered then
  if (!s.protocol?.title && !s.paper?.title) add('protocol', 'protocol', 'Define the study question');
  if (REGISTERED.has(type) && !s.paper?.registration) add('protocol', 'protocol', type === 'guideline' ? 'Record the guideline registration' : 'Record the registration', { go: 'protocol:registration' });
  if (SIZED.has(type) && !s.protocol?.sampleSize) add('analysis', 'analysis', 'Set the sample size');
  if (!hasData) add('data', t?.patientData ? 'patients' : 'datasets', t?.patientData ? 'Enter or import participant data' : 'Import the study data');
  else if (!ran) add('analysis', 'analysis', 'Run the analysis');
  if (!blocks.length) add('manuscript', 'manuscript', 'Start the manuscript');
  else if (rep && !rep.reported) add('reporting', 'reporting', `Report against ${rep.name}`);
  if (!s.searches?.length && !(s.papers || []).length) add('search', 'search', 'Find background literature');
  const visible = new Set(visibleViews(s));
  return out.filter(a => visible.has(a.view)).slice(0, Math.max(0, limit));
}
