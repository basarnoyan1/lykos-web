// Where the review stands, and what is still unresolved (plan §2, "Progress").
//
// The plan is explicit that progress means unresolved work, not completion
// percentages: unreadable PDFs, missing full texts, unverified cells, stale
// figures, unsupported claims. Everything here is derived from state on demand,
// never stored, so it cannot drift from the project it describes.
import { pdfRank } from './library-records.mjs';
import { fields } from './fields.mjs';
import { isIncluded, finalDecision } from './screen.mjs';
import { recordLevel } from './integrity-level.mjs';
import { get, getVersion } from '../store.mjs';
import {PRISMA_FIELDS, APPRAISAL_TOOLS, appraisalTool, prismaNeeded} from '../schema.mjs';
import { survivalRowsFrom, DEFAULT_COLUMNS } from './ipd.mjs';
import { savedAnalyses, currentDatasetAnalyses, isStale } from './dataset-analysis-core.mjs';
import { projectMode, visibleViews, patientDataEnabled, projectName, researchType } from './workflow.mjs';
import { isPrimaryType, typeById } from './research-types.mjs';
import { checks, checksKey, inputs } from './progress-gate.mjs';   // the manuscript findings and the reporting checklist load with a project that has them (lib/progress-gate.mjs)
import { outcomes as outcomeList, analysisOf } from './outcomes.mjs';
import { brokenRecords } from './library-broken.mjs';
import { ethicsAttention } from './governance-state.mjs';
import { figureAttention } from './figure-watch.mjs';
import { attentionItems as submissionAttention, syncTasks as submissionTasks, stageOf as submissionStage } from './submissions.mjs';
import { dateValue } from './date-picker.mjs';
import { hashText } from './manuscript.mjs';
import { ago, plural } from './dates.mjs';
import { groupRecent } from './overview-model.mjs';

/** A record's evidence and decision fingerprints, as an evidence baseline keeps them (lib/research-copilot.mjs evidenceBaseline). */
export const recordFingerprint = (s, p) => ({ id: p.id, key: p.key || p.id,
  evidence: hashText(JSON.stringify([p.title, p.abstract, p.pdfHash, p.documentVersion, p.doi, p.year])),
  decision: hashText(JSON.stringify([s.screening?.[p.id], s.fulltext?.[p.id]])) });
/** The records new, changed or removed between a baseline's fingerprints and the current ones: [{ kind, paperId }]. */
export function recordChanges(before = [], now = []) {
  const prior = new Map(before.map(p => [p.id, p])), live = new Set(now.map(p => p.id)), out = [];
  for (const p of now) { const old = prior.get(p.id); if (!old) out.push({ kind: 'new-record', paperId: p.id }); else if (old.evidence !== p.evidence || old.decision !== p.decision) out.push({ kind: 'changed-record', paperId: p.id }); }
  for (const p of before) if (!live.has(p.id)) out.push({ kind: 'removed-record', paperId: p.id });
  return out;
}

const included = s => (s.papers || []).filter(p => projectMode(s) === 'workspace' || isIncluded(s, p.id));
/** The studies the funnel counts as included (every record, in a workspace). */
export const includedStudies = s => included(s);
const appraised = (s, p) => {
  const rec = s.assessments?.[p.id];
  if (!rec) return false;
  // the instrument this study is appraised with (JBI, ROBINS-I, a custom one), else the project's
  const own = s.appraisalByStudy?.[p.id];
  if (own && rec[own] && Object.values(rec[own]).some(Boolean)) return true;
  const tool = appraisalTool(s.appraisalTool || 'rob2');
  if (rec[tool.id]) return true;
  return tool.id === 'rob2' && Object.keys(rec).some(k => !APPRAISAL_TOOLS.some(t => t.id === k));
};
/** The studies holding a value in any extraction table (a built-in field, a table's column, an arm's own value). */
export function extractedIds(s) {
  const cols = new Set([...fields(s), ...(s.templates || []).flatMap(t => t.columns || [])].map(c => c.id)), out = new Set();
  for (const [k, v] of Object.entries(s.values || {})) { const i = k.indexOf(':'); if (v && i > 0 && cols.has(k.slice(i + 1).replace(/@arm\d+$/, ''))) out.add(k.slice(0, i)); }
  return out;
}


/**
 * One entry per stage, in the order the work happens. `state` is one of
 * 'todo' | 'active' | 'done'; `line` is the one fact worth showing.
 */
export function stages(s = get()) {
  const papers = s.papers || [];
  const inc = included(s);
  const done = extractedIds(s);
  const screened = papers.filter(p => s.screening?.[p.id]).length;
  const runs = s.searches || [];
  const patients = s.participants || [];
  const usable = patients.length ? survivalRowsFrom(patients, s.ipdColumns || DEFAULT_COLUMNS).rows.length : 0;
  const ms = s.manuscript?.blocks || [];
  const words = ms.reduce((a, b) => a + b.text.split(/\s+/).filter(Boolean).length, 0);
  const prismaFilled = PRISMA_FIELDS.filter(f => s.prisma?.[f.id] != null && s.prisma[f.id] !== '').length, prismaFlow = prismaNeeded(s);
  const hasProtocol = Boolean(s.protocol?.title || s.paper?.title);
  const criteria = s.protocol?.criteria?.length || 0;

  const st = (state, line) => ({ state, line });
  // A primary study's stages are its own: question, data, analysis, writing, reporting.
  if (isPrimaryType(researchType(s).id)) {
    const t = typeById(researchType(s).id);
    const sets = s.datasets || [], rows = sets.reduce((a, d) => a + (d.rows || []).length, 0);
    const res = outcomeList(s).filter(o => analysisOf(s, o.id) && inputs.pooledInputStatus(s, analysisOf(s, o.id), o.id) === 'current').length + currentDatasetAnalyses(s).length + (inputs.survivalInputStatus(s) === 'current' ? 1 : 0) + (s.advancedAnalyses || []).filter(a => inputs.advancedInputStatus(a, s) === 'current').length;
    const stored = savedAnalyses(s).length + (s.survival ? 1 : 0) + outcomeList(s).filter(o => analysisOf(s, o.id)).length + (s.advancedAnalyses || []).length;
    const ran = res > 0, changed = stored > res;
    const rep = checks.module()?.reportingOf(s);   // null until the checks are here: the stage then reads as not started
    const bits = [s.paper?.registration ? 'registered' : '', s.protocol?.sampleSize ? 'sample size set' : ''].filter(Boolean);
    return [
      { key: 'protocol', name: 'Protocol', ...(hasProtocol ? st(bits.length === 2 ? 'done' : 'active', bits.join(', ') || 'Question set') : st('todo', 'Not started')) },
      ...(t?.patientData ? [{ key: 'patients', name: 'Patient data', ...(patients.length ? st('done', `${patients.length} ${patients.length === 1 ? 'participant' : 'participants'}`) : st('todo', 'No participants')) }] : []),
      { key: 'datasets', name: 'Datasets', ...(sets.length ? st('done', `${sets.length} ${sets.length === 1 ? 'dataset' : 'datasets'}, ${rows.toLocaleString()} rows`) : st('todo', 'No datasets')) },
      { key: 'analysis', name: 'Analysis', ...(changed ? st('active', `${res} current, ${stored - res} need checking`) : ran ? st('done', `${res} ${res === 1 ? 'result' : 'results'}`) : st(rows || patients.length ? 'active' : 'todo', rows || patients.length ? 'Ready to run' : 'Not run')) },
      { key: 'manuscript', name: 'Manuscript', ...(words ? st('active', `${words} ${words === 1 ? 'word' : 'words'}`) : st('todo', ms.length ? 'Empty' : 'Not started')) },
      { key: 'reporting', name: 'Reporting', ...(!rep ? st('todo', 'Not started') : rep.reported ? st(rep.reported === rep.total ? 'done' : 'active', `${rep.reported} of ${rep.total} ${rep.name} items`) : st('todo', `${rep.name} not started`)) },
      ...(visibleViews(s).includes('submissions') ? [{ key: 'submissions', name: 'Submission', ...submissionStage(s.submissions, dateValue(new Date())) }] : []),
    ];
  }
  const entries = [
    { key: 'protocol', name: 'Protocol',
      ...(hasProtocol && criteria ? st('done', `${criteria} criteria`)
        : hasProtocol || criteria ? st('active', criteria ? `${criteria} criteria` : 'No criteria')
        : st('todo', 'Not started')) },
    { key: 'search', name: 'Search',
      ...(runs.length ? st(runs.some(r => r.status === 'partial') ? 'active' : 'done',
          `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, ${papers.length} records`)
        : st('todo', 'No searches')) },
    { key: 'screening', name: 'Screening',
      ...(!papers.length ? st('todo', 'No records')
        : screened === papers.length ? st('done', `${inc.length} included`)
        : st(screened ? 'active' : 'todo', `${screened} of ${papers.length}`)) },
    { key: 'extraction', name: 'Extraction',
      ...(!inc.length ? st('todo', 'No included studies')
        : (() => { const n = inc.filter(p => done.has(p.id)).length;
            return st(n === inc.length ? 'done' : n ? 'active' : 'todo', `${n} of ${inc.length}`); })()) },
    { key: 'patients', name: 'Patient data',
      ...(!patients.length ? st('todo', 'No patients')
        : st(usable === patients.length ? 'done' : 'active',
            `${patients.length} patients${usable < patients.length ? `, ${patients.length - usable} not analysable` : ''}`)) },
    { key: 'appraisal', name: 'Appraisal',
      ...(!inc.length ? st('todo', 'No included studies')
        : (() => { const n = inc.filter(p => appraised(s, p)).length;
            return st(n === inc.length ? 'done' : n ? 'active' : 'todo', `${n} of ${inc.length}`); })()) },
    { key: 'analysis', name: 'Analysis',
      ...((s.analysis && inputs.pooledInputStatus(s) !== 'current') || (s.survival && inputs.survivalInputStatus(s) !== 'current')
        ? st('active', 'Inputs changed')
        : s.survival || s.analysis
        ? st('done', `Run ${ago(s.survival?.at || s.analysis?.at)}`)
        : st(usable >= 2 ? 'active' : 'todo', usable >= 2 ? 'Ready to run' : 'Not run')) },
    { key: 'certainty', name: 'Certainty',
      ...((s.grade || []).length ? st('done', `${s.grade.length} ${s.grade.length === 1 ? 'outcome' : 'outcomes'}`)
        : st('todo', 'No outcomes')) },
    // A qualitative synthesis: its codes and themes, then CERQual per finding.
    { key: 'synthesis', name: 'Synthesis',
      ...((s.qes?.analytical || []).length ? st('done', `${s.qes.analytical.length} analytical ${s.qes.analytical.length === 1 ? 'theme' : 'themes'}`)
        : (s.qes?.codes || []).length ? st('active', `${s.qes.codes.length} ${s.qes.codes.length === 1 ? 'code' : 'codes'}`)
        : st('todo', 'No codes')) },
    { key: 'confidence', name: 'Confidence',
      ...(() => { const all = s.qes?.analytical || [], n = all.filter(t => t.cerqual?.confidence).length;
        return !all.length ? st('todo', 'No findings') : st(n === all.length ? 'done' : n ? 'active' : 'todo', `${n} of ${all.length}`); })() },
    { key: 'manuscript', name: 'Manuscript',
      ...(words ? st('active', `${words} ${words === 1 ? 'word' : 'words'}`) : st('todo', ms.length ? 'Empty' : 'Not started')) },
    { key: 'reporting', name: 'Reporting',
      ...(prismaFilled ? st(prismaFlow.filled >= prismaFlow.total ? 'done' : 'active', `${prismaFilled} PRISMA counts`)
        : st('todo', 'No counts')) },
    // the journals the manuscript went to (lib/submissions.mjs): not submitted, where it stands, accepted or published
    { key: 'submissions', name: 'Submission', ...submissionStage(s.submissions, dateValue(new Date())) },
  ];
  if (projectMode(s) === 'workspace') entries.splice(2, 0, {
    key: 'library', name: 'Library',
    ...(papers.length ? st('active', `${papers.length} ${papers.length === 1 ? 'record' : 'records'}`)
      : st('todo', 'No records')),
  });
  const visible = new Set(visibleViews(s));
  return entries.filter(x => visible.has(x.key));
}

/**
 * The review as a funnel, for the overview: one entry per stage evidence
 * passes through, with its count, the pool it is drawn from, and the one fact
 * worth reading beside it. `pool` is how many could be at this stage (null
 * where the count is not a share of anything); the overview draws the pool
 * against everything identified, so the narrowing and the progress read at once.
 */
function funnelOf(s = get()) {
  const papers = s.papers || [];
  const total = papers.length;
  const inc = included(s);
  const ta = papers.filter(p => s.screening?.[p.id]).length;
  const taPass = papers.filter(p => s.screening?.[p.id]?.decision === 'include').length;
  const ft = papers.filter(p => s.fulltext?.[p.id]).length;
  const uncertain = papers.filter(p => s.screening?.[p.id]?.decision === 'uncertain').length;
  const runs = (s.searches || []).length;
  const done = extractedIds(s);
  const ex = inc.filter(p => done.has(p.id)).length;
  const ap = inc.filter(p => appraised(s, p)).length;
  const noPdf = inc.filter(p => !p.pdf).length;
  const ran = s.analysis?.at || s.survival?.at;
  return [
    { key: 'search', name: 'Identified', n: total, pool: null,
      line: runs ? plural(runs, 'search', 'searches') : total ? 'Imported' : 'No searches' },
    { key: 'screening', name: 'Screened', n: ta, pool: total,
      line: uncertain ? `${uncertain} uncertain` : total - ta ? `${total - ta} to screen` : total ? 'All screened' : '' },
    { key: 'screening', name: 'Full text', n: ft, pool: taPass,
      line: taPass - ft ? `${taPass - ft} to assess` : taPass ? 'All assessed' : '' },
    { key: 'screening', name: 'Included', n: inc.length, pool: null,
      line: noPdf ? `${noPdf} without PDF` : '' },
    { key: 'extraction', name: 'Extracted', n: ex, pool: inc.length,
      line: inc.length - ex ? `${inc.length - ex} to extract` : inc.length ? 'All extracted' : '' },
    { key: 'appraisal', name: 'Appraised', n: ap, pool: inc.length,
      line: inc.length - ap ? `${inc.length - ap} to appraise` : inc.length ? 'All appraised' : '' },
    { key: 'analysis', name: 'Synthesised', n: null, pool: null,
      line: ran ? `Run ${ago(ran)}` : 'Not run' },
  ];
}

/** Something a model wrote that no person has yet checked against its source. */
export const unchecked = x => Boolean(x) && String(x.extractor || '').startsWith('model:') && x.verification !== 'verified';
/** The same, counted across everything a model can write: values, notes, patient rows. */
function unverifiedOf(s = get()) {
  const values = Object.values(s.values || {}).filter(unchecked).length;
  const notes = (s.notes || []).filter(unchecked).length;
  const patients = (s.participants || []).filter(unchecked).length;
  const footnotes = (s.grade || []).reduce((n, o) => n + Object.values(o.explanations || {}).filter(unchecked).length, 0);
  return { values, notes, patients, footnotes, total: values + notes + patients + footnotes };
}
/** Marks one thing a model wrote as checked by a person, with when. */
export const checkedStamp = () => ({ verification: 'verified', verified_at: new Date().toISOString() });

/**
 * What still needs a person. Each item names a count and where to go.
 * Severity: 'block' stops a claim being made; 'gap' is work not yet done.
 */
function unresolvedOf(s = get()) {
  const out = [];
  // kind: what lib/arrive.mjs says on arrival; ids: the records the destination can narrow its list to
  const add = (kind, severity, view, text, n, extra = {}) => { if (n === undefined || n > 0) out.push({ kind, severity, view, text, n, ...extra }); };
  const idsOf = list => ({ ids: list.map(p => p.id) });
  const papers = s.papers || [];
  const inc = included(s);
  const done = extractedIds(s);

  const primary = isPrimaryType(researchType(s).id);
  // Screening, extraction, appraisal and PRISMA are a review's work: a case report or a primary study is not asked for them (COHERENCE-REVIEW A18)
  const reviewWork = !primary && researchType(s).id !== 'case-report';
  if (!projectName(s)) add('no-title', 'gap', 'protocol', primary ? 'Study has no title' : 'Review has no title');
  if (!primary && !(s.protocol?.criteria?.length)) add('no-criteria', 'gap', 'protocol', 'No eligibility criteria');
  // A retraction or expression of concern on a record still in the review (lib/integrity.mjs); a correction alone, or a record
  // excluded at screening, is shown on the Library's Retractions and corrections page but asks nothing here.
  const noticedList = papers.filter(p => ['retraction', 'concern'].includes(recordLevel(p)) && finalDecision(s, p.id)?.decision !== 'exclude'), noticed = noticedList.length;
  const noticedIncluded = noticedList.filter(p => isIncluded(s, p.id)).length === noticed && noticed > 0;
  const noticeWord = noticedList.some(p => recordLevel(p) === 'concern') ? 'a retraction or concern notice' : 'a retraction notice';
  add('retraction', 'block', 'library', `${noticed} ${noticedIncluded ? (noticed === 1 ? 'included study has' : 'included studies have') : noticed === 1 ? 'record has' : 'records have'} ${noticeWord}`, noticed, idsOf(noticedList));
  // Malformed identifiers and missing titles (lib/library-quality.mjs) break lookups and citations; the Overview points at the check.
  const broken = brokenRecords(papers).length;
  add('malformed', 'gap', 'library', `${broken} ${broken === 1 ? 'record has' : 'records have'} a malformed identifier or missing title`, broken);
  // Records new, changed or removed since the last evidence baseline kept (the Library's Evidence changes page); none kept, nothing asked.
  const baseline = (s.evidenceBaselines || []).at(-1);
  const moved = baseline ? recordChanges(baseline.papers, papers.map(p => recordFingerprint(s, p))).length : 0;
  add('evidence-changes', 'gap', 'library', `${moved} ${moved === 1 ? 'record' : 'records'} changed since the baseline`, moved, { go: 'library:changes' });

  const partial = (s.searches || []).filter(r => r.status === 'partial');
  add('partial-search', 'block', 'search', `${partial.length} ${partial.length === 1 ? 'search' : 'searches'} not fully retrieved`, partial.length);

  const freshList = papers.filter(p => p.isNew && !s.screening?.[p.id]), fresh = freshList.length;
  if (reviewWork) add('new-records', 'gap', 'screening', `${fresh} new ${fresh === 1 ? 'record' : 'records'} from repeated searches`, fresh, idsOf(freshList));
  const unscreened = papers.filter(p => !s.screening?.[p.id]).length;
  if (reviewWork) add('unscreened', 'gap', 'screening', `${unscreened} ${unscreened === 1 ? 'record' : 'records'} not screened`, unscreened);
  const uncertain = papers.filter(p => s.screening?.[p.id]?.decision === 'uncertain').length;
  if (reviewWork) add('uncertain', 'block', 'screening', `${uncertain} screening ${uncertain === 1 ? 'decision' : 'decisions'} uncertain`, uncertain);

  const noExtractList = inc.filter(p => !done.has(p.id)), noExtract = noExtractList.length;
  if (reviewWork) add('not-extracted', 'gap', 'extraction', `${noExtract} included ${noExtract === 1 ? 'study' : 'studies'} not extracted`, noExtract, idsOf(noExtractList));
  // A value the model read and a person accepted is not the same as one a
  // person checked against the source; the plan keeps those axes apart.
  const un = unverified(s);
  const unPapers = un.values ? [...new Set(Object.entries(s.values || {}).filter(([, v]) => unchecked(v)).map(([k]) => k.slice(0, k.indexOf(':'))))] : [];
  if (reviewWork) add('unverified-values', 'gap', 'extraction', `${un.values} model-read ${un.values === 1 ? 'value' : 'values'} not verified against source`, un.values, { ids: unPapers });
  add('unchecked-patients', 'gap', 'patients', `${un.patients} model-read patient ${un.patients === 1 ? 'row' : 'rows'} not checked`, un.patients);
  add('unchecked-notes', 'gap', 'notes', `${un.notes} unchecked model ${un.notes === 1 ? 'note' : 'notes'}`, un.notes, { go: 'notes:reading-notes' });
  add('unchecked-footnotes', 'gap', 'certainty', `${un.footnotes} model-drafted GRADE ${un.footnotes === 1 ? 'footnote' : 'footnotes'} not checked`, un.footnotes);

  const noAppraiseList = inc.filter(p => !appraised(s, p)), noAppraise = noAppraiseList.length;
  if (reviewWork) add('not-appraised', 'gap', 'appraisal', `${noAppraise} included ${noAppraise === 1 ? 'study' : 'studies'} not appraised`, noAppraise, idsOf(noAppraiseList));

  const patients = s.participants || [];
  if (patientDataEnabled(s) && patients.length) {
    const ex = survivalRowsFrom(patients, s.ipdColumns || DEFAULT_COLUMNS).excluded.length;
    add('missing-time', 'block', 'patients', `${ex} ${ex === 1 ? 'patient' : 'patients'} missing time or event`, ex);
  }

  const unidList = papers.filter(p => p.unidentified), unid = unidList.length;
  add('unidentified', 'gap', 'library', `${unid} ${unid === 1 ? 'file' : 'files'} not identified as a paper`, unid, idsOf(unidList));
  const noPdfList = inc.filter(p => pdfRank(p) < 2), noPdf = noPdfList.length;
  if (reviewWork) add('pdf-check', 'gap', 'library', `${noPdf} included ${noPdf === 1 ? 'study needs' : 'studies need'} a PDF availability check`, noPdf, idsOf(noPdfList));

  if (inputs.survivalInputStatus(s) === 'stale') add('analysis-stale', 'block', 'analysis', 'Survival analysis inputs changed');
  if (inputs.survivalInputStatus(s) === 'untracked') add('analysis-untracked', 'gap', 'analysis', 'Survival analysis has no saved input record');
  const stalePrimary = savedAnalyses(s).filter(a => isStale(a, s)).length;
  add('analysis-stale', 'block', 'analysis', `${stalePrimary} primary analyses have changed inputs`, stalePrimary);
  for (const a of s.advancedAnalyses || []) if (inputs.advancedInputStatus(a, s) !== 'current') add('analysis-stale', 'block', 'advancedAnalysis', `${a.result.title}: inputs ${inputs.advancedInputStatus(a, s) === 'stale' ? 'changed' : 'untracked'}`);
  if (s.trialOperations) {
    for (const text of inputs.trialReadiness(s).issues) add('trial', 'gap', 'trialOperations', text);
    const overdue = inputs.visitStatus(s).filter(v => v.status === 'overdue').length;
    add('visits-overdue', 'gap', 'trialOperations', `${overdue} scheduled visits overdue`, overdue);
  }
  if (inputs.pooledInputStatus(s) === 'stale') add('analysis-stale', 'block', 'analysis', 'Pooled analysis predates accepted inputs');
  if (inputs.pooledInputStatus(s) === 'untracked') add('analysis-untracked', 'gap', 'analysis', 'Pooled analysis has no saved input record');

  const ms = s.manuscript?.blocks || [];
  const all = ms.length ? checks.module()?.manuscriptFindings(s) : null;
  if (all) {
    // the typed reference list's errors are a row of their own, which lands on the list's findings (lib/reference-list.mjs)
    const issues = all.filter(i => !i.kind.startsWith('ref-'));
    const errors = issues.filter(i => i.severity === 'error').length;
    const warns = issues.filter(i => i.severity === 'warn').length;
    const cites = all.filter(i => i.kind.startsWith('ref-') && i.severity === 'error').length;
    add('manuscript-errors', 'block', 'manuscript', `${errors} manuscript ${errors === 1 ? 'error' : 'errors'}`, errors);
    add('manuscript-warnings', 'gap', 'manuscript', `${warns} manuscript ${warns === 1 ? 'warning' : 'warnings'}`, warns);
    add('citation-check', 'block', 'manuscript', `${cites} reference list ${cites === 1 ? 'error' : 'errors'}`, cites);
  }

  const flow = prismaNeeded(s), blank = flow.total - flow.filled;   // the counts the flow draws, as Submission readiness counts them
  if (papers.length && reviewWork) add('prisma-blank', 'gap', 'reporting', `${blank} PRISMA ${blank === 1 ? 'count' : 'counts'} blank`, blank);

  // ---- ethics (lib/governance.mjs): approvals expiring, reports due, amendments awaiting approval, within 90 days ----
  for (const e of ethicsAttention(s)) out.push({ kind: 'ethics', severity: e.severity, view: e.view, go: e.go, text: e.text });

  // ---- case report (lib/case-report.mjs): consent, identifiers, empty sections ----
  if (researchType(s).id === 'case-report') for (const u of inputs.caseIssues(s)) add('case', u.severity, 'case', u.text, u.n);

  // ---- submission (lib/submissions.mjs): a revision due, a chase day reached, a decision letter not read; nothing on elapsed time alone ----
  // read through the task sync: a chase ticked done on the Tasks page is not asked for again
  for (const u of submissionAttention(submissionTasks(s.submissions, s.todos).submissions, dateValue(new Date()))) out.push({ kind: u.go === 'submissions:read' ? 'letter' : u.severity === 'block' ? 'revision-due' : 'chase', severity: u.severity, view: u.view, text: u.text, ...(u.go ? { go: u.go } : {}), ...(u.attemptId ? { ids: [u.attemptId] } : {}) });

  // ---- figure checks (lib/figure-watch.mjs): the cached block and gap findings, at most three, then "N more figure checks"; never runs detection here ----
  for (const f of figureAttention(s)) out.push({ kind: f.coverage ? 'coverage' : typeof f.go === 'string' && f.go.startsWith('files:') ? 'drift' : 'figure', ...f });

  const visible = new Set(visibleViews(s));
  return out.filter(x => visible.has(x.view))
    .sort((a, b) => (a.severity === 'block' ? 0 : 1) - (b.severity === 'block' ? 0 : 1));
}

export { ago };

/** The last few things done in the project, newest first, from timestamps it already keeps. */
function recentActivityOf(s, limit = 6) {
  const out = [];
  for (const r of (s.searches || []).slice(-6))
    out.push({ at: r.at, view: 'search', text: `Searched ${r.source || 'PubMed'}: ${r.query}` });
  if (s.survival?.at) out.push({ at: s.survival.at, view: 'analysis', text: 'Time-to-event analysis run' });
  if (s.analysis?.at) out.push({ at: s.analysis.at, view: 'analysis', text: `Pooled ${s.analysis.measure || 'effect'} run` });
  for (const a of savedAnalyses(s)) if (a.at) out.push({ at: a.at, view: 'analysis', text: `${a.result.title || a.kind} kept` });
  for (const a of s.advancedAnalyses || []) if (a.at) out.push({ at: a.at, view: 'advancedAnalysis', text: `${a.result.title} kept` });
  // every checked value, newest first and a study's values of one moment together, so a run on one study reads as one line (groupRecent)
  const vals = Object.values(s.values || {}).filter(v => v?.verified_at)
    .sort((a, b) => b.verified_at.localeCompare(a.verified_at) || String(a.paper_id).localeCompare(String(b.paper_id)));
  const byId = new Map((s.papers || []).map(p => [p.id, p]));
  // A field is named by its column label and study, never by its internal id.
  const labelOf = new Map((s.templates || []).flatMap(t => (t.columns || []).map(c => [c.id, c.label || c.name || c.id])));
  for (const f of fields()) if (!labelOf.has(f.id)) labelOf.set(f.id, f.label || f.id);
  for (const v of vals) {
    const id = String(v.field_id || '').replace(/@arm\d+$/, ''), arm = /@arm(\d+)$/.exec(v.field_id || '')?.[1];
    const study = byId.get(v.paper_id)?.label;
    out.push({ at: v.verified_at, view: 'extraction', text: `Extracted ${labelOf.get(id) || id}${arm ? ` (arm ${arm})` : ''}${study ? `, ${study}` : ''}`,
      group: { key: `extract:${v.paper_id}`, verb: 'Extracted', many: 'values', subject: study || '' } });
  }
  for (const d of (s.screeningLog || []).slice(-200))
    if (d.action === 'decide' || d.action === 'change' || d.action === 'resolve') {
      const verb = d.decision === 'include' ? 'Included' : d.decision === 'exclude' ? 'Excluded' : 'Marked uncertain';
      out.push({ at: d.at, view: 'screening', text: `${verb} ${byId.get(d.id)?.label || 'a record'}${d.reason ? ` (${d.reason})` : ''}`, group: { key: `screen:${verb}`, verb, many: 'records' } });
    }
  for (const v of (s.protocolVersions || []).slice(-1)) out.push({ at: v.at, view: 'protocol', text: `Protocol version ${v.v} frozen` });
  for (const t of (s.todos || []).filter(t => t.done && t.at).slice(-2)) out.push({ at: t.at, view: 'overview', text: `To do: ${t.text}` });
  // Runs of the same screening decision read as one line ("Included 10 records"), and so do the values extracted from one study ("Extracted
  // 26 values · Akgun 2024"), not one row each; the newest time stands for the run (lib/overview-model.mjs groupRecent).
  return groupRecent(out.filter(r => r.at).sort((a, b) => b.at.localeCompare(a.at))).slice(0, limit);
}

// ---- once per change ----------------------------------------------------------
// Overview asks for these several times per paint and the status bar on every
// store change; each walks every record and value (50,000 cells take ~20 ms).
// The live project answers from the last computation until it changes (its
// version counts every update); any other state is computed fresh.
function perVersion(fn) {
  let version = -1, key = null, out;
  return (s = get(), ...args) => {
    if (s !== get()) return fn(s, ...args);
    const k = `${checksKey()}\u0000${args.join('\u0000')}`;   // an answer given before the checks arrived is not kept
    if (version !== getVersion() || key !== k) { out = fn(s, ...args); version = getVersion(); key = k; }
    return out;
  };
}
export const unverified = perVersion(unverifiedOf);
export const unresolved = perVersion(unresolvedOf);
export const funnel = perVersion(funnelOf);
export const recentActivity = perVersion(recentActivityOf);
