// The reporting checklists (lib/checklist-core.mjs, re-exported here) and the items a project's own artefacts support.
import { researchType } from './workflow.mjs';
import { caseSupported } from './case-report.mjs';
import { projectMap } from './evidence-map.mjs';
import { currentDatasetAnalyses } from './dataset-analysis-core.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { advancedInputStatus } from './advanced-primary.mjs';
import { lsrSupported } from './living.mjs';
import { applied, choicesFor } from './checklist-choice.mjs';
import { typeById } from './research-types.mjs';
import { checklistOf } from './checklist-core.mjs';
export { PRISMA_2020, PRISMA_SCR, PRISMA_DTA, PRIOR, ENTREQ, CHECKLISTS, PRISMA_NMA, CARE, checklistOf, checklistStates, STATES } from './checklist-core.mjs';

/** Items a project's own artefacts can vouch for, with the artefact named. */
// Whether an object has any key, without listing them all: a project's
// screening and values hold one key per record and cell (tens of thousands).
const any = o => { for (const _ in o || {}) return true; return false; };
/**
 * Checklist items the project's own artefacts support. Cheap enough to run on
 * every paint (Reporting shows it per item; compute it once per render).
 */
export function supported(s) {
  const lsr = lsrSupported(s);
  return { ...supportedBase(s), ...lsr };
}
function supportedBase(s) {
  const out = {};
  if (checklistOf(s).id === 'care') return caseSupported(s);
  const listId = checklistOf(s).id;
  const primaryMaps = {
    consort: typeById('rct').vouch,
    tripod: typeById('prognostic-model').vouch,
    'consort-2025': { question: ['7'], criteria: ['12a'], versions: ['10'], registration: ['2'], datasets: ['25'], analysis: ['21a'], sampleSize: ['16a'] },
    'tripod-ai': { question: ['4'], criteria: ['6b'], versions: ['18c'], registration: ['18d'], datasets: ['20a'], analysis: ['12c'], sampleSize: ['10'] },
  };
  // Alternatives with known item numbers can use the same concrete artefacts.
  // Other alternatives await a reviewed mapping of their own.
  if (applied(s).checklist !== choicesFor(researchType(s).id).default && !primaryMaps[listId]) return out;
  // A primary study: what the registry says its protocol, datasets and analysis vouch for.
  const vouch = primaryMaps[listId] || typeById(researchType(s).id)?.vouch;
  if (vouch) {
    const say = (ids, what) => { for (const id of ids || []) out[id] = what; };
    if (s.protocol?.title) say(vouch.question, 'Protocol question');
    if (s.protocol?.criteria?.length) say(vouch.criteria, 'Protocol criteria');
    if ((s.protocolVersions || []).length) say(vouch.versions, 'Frozen protocol');
    if (s.paper?.registration) say(vouch.registration, 'Registration');
    if ((s.datasets || []).length || (s.participants || []).length) say(vouch.datasets, (s.datasets || []).length ? 'Datasets' : 'Patient data');
    const datasetResults = currentDatasetAnalyses(s), currentSurvival = survivalInputStatus(s) === 'current';
    const modelResults = listId === 'tripod-ai' ? datasetResults.filter(a => ['linear', 'logistic', 'poisson', 'prediction-binary', 'prediction-continuous'].includes(a.kind)) : datasetResults;
    const advancedResults = (s.advancedAnalyses || []).filter(a => advancedInputStatus(a, s) === 'current');
    if (currentSurvival || s.analysis || modelResults.length || advancedResults.length) say(vouch.analysis, [currentSurvival && 'Current survival analysis', s.analysis && 'Analysis', modelResults.length && `${modelResults.length} current kept dataset ${modelResults.length === 1 ? 'analysis' : 'analyses'}`, advancedResults.length && 'Current advanced analysis'].filter(Boolean).join('; '));
    if (listId === 'tripod-ai' && datasetResults.some(a => ['roc', 'roc-compare', 'calibration', 'decision-curve', 'prediction-binary', 'prediction-continuous'].includes(a.kind))) out['12e'] = 'Current kept prediction performance analysis';
    if (s.protocol?.sampleSize) say(vouch.sampleSize, 'Sample size in the protocol');
    // the coding workspace (lib/qual.mjs)
    const qual = s.qual || {}, codings = qual.codings || [];
    if ((qual.documents || []).length) say(vouch.corpus, (qual.cases || []).length ? 'Documents and cases' : 'Coded documents');
    if ((qual.documents || []).some(d => d.pseudonymised)) say(vouch.pseudonymised, 'Pseudonymised transcripts');
    if ((qual.codes || []).length && codings.length) say(vouch.coding, (qual.descriptive || []).length || (qual.analytical || []).length ? 'Codes and themes' : 'Codebook');
    if (new Set(codings.map(x => x.coder || '')).size > 1) say(vouch.coders, 'Two or more coders');
    if (codings.some(x => x.exemplar)) say(vouch.exemplars, 'Exemplar quotes');
    return out;
  }
  if (checklistOf(s).id === 'prisma-nma') {
    if ((s.protocolVersions || []).length) out['5'] = 'Frozen protocol';
    if (s.protocol?.criteria?.length) out['6'] = 'Protocol criteria';
    if ((s.searches || []).length) { out['7'] = 'Search log'; out['8'] = 'Search strategies (PRISMA-S)'; }
    if (any(s.screening)) { out['9'] = 'Screening log'; out['17'] = 'Flow diagram'; }
    if (Object.keys(s.nma?.arms || {}).length) { out['S3'] = 'Network graph'; out['20'] = 'Arm-level data'; }
    const r = s.nma?.result;
    if (r) {
      out['13'] = `${r.measure} and P-scores`; out['14'] = 'Contrast-based NMA (metafor)'; out['21'] = 'League table and P-scores';
      out['S2'] = 'Design-by-treatment Q'; out['S5'] = 'Q decomposition';
    }
    return out;
  }
  if (checklistOf(s).id === 'entreq') {
    const q = s.qes || {};
    if (s.protocol?.title) out['1'] = 'Protocol question';
    if (s.protocol?.criteria?.length) out['4'] = 'Protocol criteria';
    if ((s.searches || []).length) { out['5'] = 'Search log'; out['6'] = 'Search strategies (PRISMA-S)'; }
    if (any(s.screening)) { out['7'] = 'Screening log'; out['9'] = 'Flow diagram'; }
    if (any(s.values)) out['8'] = 'Extraction values';
    if (Object.values(s.assessments || {}).some(a => a?.['casp-qual'] && Object.keys(a['casp-qual']).length)) { out['11'] = 'CASP qualitative'; out['13'] = 'CASP qualitative judgements'; }
    if ((q.quotes || []).length) { out['14'] = 'Coded quotes'; out['17'] = 'Codes'; out['20'] = 'Quotes with sources'; }
    if ((q.descriptive || []).length && (q.analytical || []).length) out['19'] = 'Descriptive and analytical themes';
    if ((q.analytical || []).some(t => String(t.statement || '').trim())) out['21'] = 'Analytical theme findings';
    return out;
  }
  if (checklistOf(s).id === 'prior') {
    if ((s.protocolVersions || []).length) out['23b'] = 'Frozen protocol';
    if (s.protocol?.criteria?.length) out['5a'] = 'Protocol criteria';
    if ((s.searches || []).length) { out['6'] = 'Search log'; out['7'] = 'Search strategies (PRISMA-S)'; }
    if (any(s.screening)) { out['8a'] = 'Screening log'; out['15a'] = 'Flow diagram'; }
    if (any(s.values)) out['9a'] = 'Extraction values';
    if (Object.values(s.assessments || {}).some(a => a?.amstar2 && Object.keys(a.amstar2).length)) { out['11a'] = 'AMSTAR 2'; out['18a'] = 'AMSTAR 2 ratings'; }
    const covered = Object.values(s.umbrella?.matrix || {}).filter(l => l?.length).length;
    if (covered >= 2) { out['9b'] = 'Citation matrix and CCA'; out['17'] = 'Corrected covered area'; }
    const rows = s.umbrella?.results || [];
    if (rows.length) out['19a'] = 'Results summary';
    if ((s.grade || []).length || rows.some(r => r.grade)) { out['14'] = 'GRADE'; out['21'] = 'Certainty per outcome'; }
    return out;
  }
  if (checklistOf(s).id === 'prisma-scr') {
    if ((s.protocolVersions || []).length) out['5'] = 'Frozen protocol';
    if (s.protocol?.criteria?.length) out['6'] = 'Protocol criteria';
    if ((s.searches || []).length) { out['7'] = 'Search log'; out['8'] = 'Search strategies (PRISMA-S)'; }
    if (any(s.screening)) { out['9'] = 'Screening log'; out['14'] = 'Flow diagram'; }
    if (any(s.values)) { out['10'] = 'Charting values'; out['15'] = 'Charted data'; out['17'] = 'Charted data'; }
    { if (projectMap(s)?.total) out['18'] = 'Evidence map'; }
    return out;
  }
  if (checklistOf(s).id === 'prisma-dta') {
    if ((s.protocolVersions || []).length) out['5'] = 'Frozen protocol';
    if (s.protocol?.criteria?.length) out['6'] = 'Protocol criteria';
    if ((s.searches || []).length) { out['7'] = 'Search log'; out['8'] = 'Search strategies (PRISMA-S)'; }
    if (any(s.screening)) { out['9'] = 'Screening log'; out['17'] = 'Flow diagram'; }
    if (any(s.values)) out['10'] = 'Extraction values';
    if (Object.values(s.assessments || {}).some(a => a?.['quadas-2'] && Object.keys(a['quadas-2']).length)) { out['12'] = 'QUADAS-2'; out['19'] = 'QUADAS-2 judgements'; }
    if (s.dta) { out['13'] = 'Sensitivity and specificity'; out['20'] = '2×2 counts and forest plot'; if (s.dta.biv) { out['D2'] = 'Bivariate model'; out['21'] = 'Pooled accuracy'; } }
    return out;
  }
  if ((s.searches || []).length) { out['6'] = 'Search log'; out['7'] = 'Search strategies (PRISMA-S)'; }
  if (s.protocol?.criteria?.length) out['5'] = 'Protocol criteria';
  if (any(s.screening)) out['8'] = 'Screening log';
  if (any(s.values)) out['9'] = 'Extraction values';
  if (s.analysis) { out['12'] = 'Analysis'; out['20b'] = 'Pooled result'; if (s.analysis.loo_est) out['20d'] = 'Leave-one-out'; if (s.analysis.mod_kind) out['20c'] = 'Subgroups'; if (s.analysis.egger_z != null) out['21'] = "Egger's test"; }
  if ((s.grade || []).length) { out['15'] = 'GRADE'; out['22'] = 'Summary of findings'; }
  if (s.prisma || any(s.screening)) out['16a'] = 'Flow diagram';
  // The bundle's report of reports excluded at full text, with the reasons (lib/submission.mjs).
  for (const k in s.fulltext || {}) if (s.fulltext[k]?.decision === 'exclude') { out['16b'] = 'Excluded studies with reasons'; break; }
  if ((s.protocolVersions || []).length) out['24b'] = 'Frozen protocol';
  if ((s.protocolVersions || []).some(v => v.note)) out['24c'] = 'Amendments';
  return out;
}
