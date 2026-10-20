// What a project says about the analyses on its own data, without the statistics: the tables an analysis can read (the datasets and the patient
// table), the catalogue of analyses with their inputs and options, the hash that marks a kept result stale, and the kept results. The Overview, the
// progress counts, the checklist and the query layer read these on every start; the code that runs the analyses (lib/dataset-analysis.mjs, with
// the statistics modules, about 290 KB) loads with the Datasets, Analysis and Manuscript pages. dataset-analysis.mjs re-exports all of it.
import { get } from '../store.mjs';
import { DEFAULT_COLUMNS } from './ipd.mjs';

export const PATIENT_SOURCE = 'patients';
const IPD_TYPES = { number: 'number', category: 'category', boolean: 'category', date: 'date', text: 'text' };

/** The patient table as a dataset: its columns keep their ids, a yes/no column is a category. */
export function patientDataset(s = get()) {
  const people = s.participants || [];
  if (!people.length) return null;
  const columns = ((s.ipdColumns || []).length ? s.ipdColumns : DEFAULT_COLUMNS).map(c => ({ ...c, id: c.id, label: c.name || c.label || c.id, originalType: c.type, type: IPD_TYPES[c.type] || 'text' }));
  const rows = people.map(p => Object.fromEntries(columns.map(c => [c.id, p[c.id] == null ? '' : String(p[c.id])])));
  return { id: PATIENT_SOURCE, name: 'Patient data', columns, rows, rowIds: people.map(p => String(p.id)), virtual: true };
}
/** Every table an analysis can read: the datasets, then the patient table when there is one. */
export function analysisSources(s = get()) {
  const p = patientDataset(s);
  return [...(s.datasets || []), ...(p ? [p] : [])];
}
export const sourceById = (id, s = get()) => analysisSources(s).find(d => d.id === id) || null;

/** FNV-1a over the row count and the used columns' cells: cheap, and changes when any of them does. */
export function columnHash(d, ids) {
  let h = 0x811c9dc5;
  const feed = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  const cols = [...new Set((ids || []).filter(Boolean))].sort();
  feed(`${d.rows.length}|${cols.join(',')}|`);
  for (const r of d.rows) for (const id of cols) { feed(String(r[id] ?? '')); feed('\u0001'); }
  return h.toString(16).padStart(8, '0');
}

/** Input levels and reference values are settings, never column ids. */
export function usedColumns(inputs, kind = null) {
  const spec = kind ? analysisOf(kind) : null;
  const keys = spec ? spec.inputs.filter(i => !i.levelOf).map(i => i.key)
    : ['group', 'variables', 'x', 'y', 'row', 'col', 'predictors', 'exposure', 'raters', 'items', 'test', 'reference', 'score', 'scoreA', 'scoreB', 'predicted'];
  return [...new Set(keys.flatMap(k => Array.isArray(inputs?.[k]) ? inputs[k] : [inputs?.[k]]).filter(v => typeof v === 'string' && v))];
}
const legacyColumns = inputs => [...new Set(Object.values(inputs || {}).flatMap(v => Array.isArray(v) ? v : [v]).filter(v => typeof v === 'string' && v))];
export const schemaHash = (d, ids) => columnHash({ rows: ids.map(id => ({ schema: JSON.stringify(d.columns.find(c => c.id === id) || null) })) }, ['schema']);


/** True when the dataset a kept analysis came from is gone, or the columns it used have changed. */
export function isStale(saved, s = get()) {
  const d = sourceById(saved.datasetId, s);
  if (!d) return true;
  const ids = usedColumns(saved.inputs, saved.kind);
  if (ids.some(id => !d.columns.some(c => c.id === id))) return true;
  if (saved.schemaVersion && schemaHash(d, ids) !== saved.schemaVersion) return true;
  if (saved.provenanceVersion && identityHash(d) !== saved.provenanceVersion) return true;
  const hash = columnHash(d, ids);
  // Results saved before column roles were separated from levels used the
  // legacy hash. Check it against the current rows; never change the result.
  return hash !== saved.rowsVersion && Boolean(saved.schemaVersion || columnHash(d, legacyColumns(saved.inputs)) !== saved.rowsVersion);
}

// ---- kept analyses ------------------------------------------------------------------

export const savedAnalyses = (s = get()) => s.datasetAnalyses || [];
export const savedFor = (datasetId, s = get()) => savedAnalyses(s).filter(a => a.datasetId === datasetId);
export const currentDatasetAnalyses = (s = get()) => savedAnalyses(s).filter(a => !isStale(a, s));


export const identityHash = d => columnHash({ rows: d.rows.map((r, index) => ({ identity: d.rowIds?.[index] ?? (d.rowKey ? r[d.rowKey] : index + 1) })) }, ['identity']);

// ---- the catalogue -------------------------------------------------------------------------

/**
 * The analyses, grouped as the picker shows them. `inputs` name the columns
 * each needs, with the role that filters its select; `level` inputs choose a
 * value of another input's column; `options` are the method choices.
 */
const PREDICTION_OPTIONS = [
  { key: 'split', label: 'Validation split', choices: [['random', 'Seeded holdout'], ['column', 'Partition column']] },
  { key: 'fraction', label: 'Holdout fraction', number: true, min: .1, max: .5, step: .01, default: .3 },
  { key: 'seed', label: 'Split seed', number: true, min: 0, max: 4294967295, step: 1, default: 1729 },
  { key: 'evaluation', label: 'Validation population', choices: [['held-out', 'Held-out sample'], ['external', 'External cohort']] },
];
const predictionInputs = [
  { key: 'predictors', label: 'Prespecified predictors', role: 'any', multi: true },
  { key: 'unit', label: 'Split unit (participant or site)', role: 'identity', optional: true },
  { key: 'partition', label: 'Development/validation partition', role: 'category', optional: true },
  { key: 'development', label: 'Development level', levelOf: 'partition', defaultLevel: 'first', optional: true },
  { key: 'validation', label: 'Validation level', levelOf: 'partition', optional: true },
];
export const ANALYSES = [
  { group: 'Describe', kind: 'table1', label: 'Table 1', inputs: [{ key: 'group', label: 'Group by', role: 'category', optional: true }, { key: 'variables', label: 'Variables', role: 'any', multi: true }],
    options: [{ key: 'summary', label: 'Continuous', choices: [['auto', 'By normality'], ['mean', 'Mean (SD)'], ['median', 'Median [IQR]']] }] },
  { group: 'Describe', kind: 'describe', label: 'Describe a variable', inputs: [{ key: 'x', label: 'Variable', role: 'numeric' }] },
  { group: 'Compare groups', kind: 'two-groups', label: 'Compare two groups', inputs: [{ key: 'y', label: 'Outcome', role: 'numeric' }, { key: 'group', label: 'Group', role: 'binary' }],
    options: [{ key: 'test', label: 'Test', choices: [['welch', 'Welch t-test'], ['student', 'Student t-test'], ['mann-whitney', 'Mann–Whitney']] }] },
  { group: 'Compare groups', kind: 'several-groups', label: 'Compare several groups', inputs: [{ key: 'y', label: 'Outcome', role: 'numeric' }, { key: 'group', label: 'Group', role: 'category' }],
    options: [{ key: 'test', label: 'Test', choices: [['anova', 'ANOVA, Tukey'], ['welch', 'Welch ANOVA, Games–Howell'], ['kruskal', 'Kruskal–Wallis, Dunn']] }] },
  { group: 'Compare groups', kind: 'paired', label: 'Paired measurements', inputs: [{ key: 'x', label: 'First', role: 'numeric' }, { key: 'y', label: 'Second', role: 'numeric' }],
    options: [{ key: 'test', label: 'Test', choices: [['t', 'Paired t-test'], ['wilcoxon', 'Wilcoxon signed-rank'], ['sign', 'Sign test']] }] },
  { group: 'Association', kind: 'association', label: 'Categorical association', inputs: [{ key: 'row', label: 'Rows', role: 'category' }, { key: 'col', label: 'Columns', role: 'category' }],
    options: [{ key: 'test', label: 'Test', choices: [['auto', 'Chi-square, or Fisher when expected < 5'], ['chisq', 'Chi-square'], ['fisher', 'Fisher exact'], ['mcnemar', 'McNemar (paired)']] }] },
  { group: 'Association', kind: 'correlation', label: 'Correlation', inputs: [{ key: 'x', label: 'X', role: 'numeric' }, { key: 'y', label: 'Y', role: 'numeric' }],
    options: [{ key: 'method', label: 'Method', choices: [['pearson', 'Pearson'], ['spearman', 'Spearman'], ['kendall', 'Kendall']] }] },
  { group: 'Regression', kind: 'linear', label: 'Linear regression', inputs: [{ key: 'y', label: 'Outcome', role: 'numeric' }, { key: 'predictors', label: 'Predictors', role: 'any', multi: true }],
    options: [{ key: 'unadjusted', label: 'Estimates', choices: [['no', 'Adjusted'], ['yes', 'Unadjusted and adjusted']] }] },
  { group: 'Regression', kind: 'logistic', label: 'Logistic regression', inputs: [{ key: 'y', label: 'Outcome', role: 'category' }, { key: 'event', label: 'Event', levelOf: 'y' }, { key: 'predictors', label: 'Predictors', role: 'any', multi: true }],
    options: [{ key: 'unadjusted', label: 'Estimates', choices: [['no', 'Adjusted'], ['yes', 'Unadjusted and adjusted']] }] },
  { group: 'Regression', kind: 'poisson', label: 'Poisson regression', inputs: [{ key: 'y', label: 'Count', role: 'numeric' }, { key: 'exposure', label: 'Exposure time', role: 'numeric', optional: true }, { key: 'predictors', label: 'Predictors', role: 'any', multi: true }],
    options: [{ key: 'unadjusted', label: 'Estimates', choices: [['no', 'Adjusted'], ['yes', 'Unadjusted and adjusted']] }] },
  { group: 'Agreement', kind: 'icc', label: 'Intraclass correlation', inputs: [{ key: 'raters', label: 'Raters', role: 'numeric', multi: true }] },
  { group: 'Agreement', kind: 'bland-altman', label: 'Bland–Altman', inputs: [{ key: 'x', label: 'Method A', role: 'numeric' }, { key: 'y', label: 'Method B', role: 'numeric' }],
    options: [{ key: 'scale', label: 'Scale', choices: [['difference', 'Differences'], ['ratio', 'Ratios']] }] },
  { group: 'Agreement', kind: 'kappa', label: 'Kappa', inputs: [{ key: 'raters', label: 'Raters', role: 'category', multi: true }],
    options: [{ key: 'weights', label: 'Weights', choices: [['none', 'Unweighted'], ['linear', 'Linear'], ['quadratic', 'Quadratic']] }] },
  { group: 'Reliability', kind: 'cronbach', label: "Cronbach's alpha", inputs: [{ key: 'items', label: 'Items', role: 'numeric', multi: true }] },
  { group: 'Diagnostic accuracy', kind: 'diagnostic', label: '2×2 from two columns', inputs: [{ key: 'test', label: 'Index test', role: 'binary' }, { key: 'positive', label: 'Positive', levelOf: 'test' },
    { key: 'reference', label: 'Reference standard', role: 'binary' }, { key: 'diseased', label: 'Target condition', levelOf: 'reference' }],
    options: [{ key: 'prevalence', label: 'Prevalence', number: true }] },
  { group: 'Diagnostic accuracy', kind: 'roc', label: 'ROC curve', inputs: [{ key: 'score', label: 'Score', role: 'numeric' }, { key: 'reference', label: 'Reference standard', role: 'binary' }, { key: 'diseased', label: 'Target condition', levelOf: 'reference' }],
    options: [{ key: 'direction', label: 'Positive when', choices: [['>', 'Higher score'], ['<', 'Lower score']] }] },
  { group: 'Diagnostic accuracy', kind: 'roc-compare', label: 'Compare paired ROC curves', inputs: [{ key: 'scoreA', label: 'Score A', role: 'numeric' }, { key: 'scoreB', label: 'Score B', role: 'numeric' }, { key: 'reference', label: 'Reference standard', role: 'binary' }, { key: 'diseased', label: 'Target condition', levelOf: 'reference' }],
    options: [{ key: 'directionA', label: 'Score A positive when', choices: [['>', 'Higher score'], ['<', 'Lower score']] }, { key: 'directionB', label: 'Score B positive when', choices: [['>', 'Higher score'], ['<', 'Lower score']] }] },
  { group: 'Prediction performance', kind: 'calibration', label: 'Calibration and Brier score', inputs: [{ key: 'predicted', label: 'Predicted risk (0–1)', role: 'numeric' }, { key: 'reference', label: 'Observed outcome', role: 'binary' }, { key: 'diseased', label: 'Event', levelOf: 'reference' }],
    options: [{ key: 'evaluation', label: 'Prediction source', choices: [['unspecified', 'Not specified'], ['apparent', 'Development sample'], ['held-out', 'Held-out sample'], ['external', 'External cohort']] }] },
  { group: 'Prediction performance', kind: 'decision-curve', label: 'Decision curve', inputs: [{ key: 'predicted', label: 'Predicted risk (0–1)', role: 'numeric' }, { key: 'reference', label: 'Observed outcome', role: 'binary' }, { key: 'diseased', label: 'Event', levelOf: 'reference' }],
    options: [{ key: 'evaluation', label: 'Prediction source', choices: [['unspecified', 'Not specified'], ['apparent', 'Development sample'], ['held-out', 'Held-out sample'], ['external', 'External cohort']] }] },
  { group: 'Prediction development', kind: 'prediction-binary', label: 'Develop and validate a binary model', inputs: [{ key: 'y', label: 'Outcome', role: 'binary' }, { key: 'event', label: 'Event', levelOf: 'y' }, ...predictionInputs], options: PREDICTION_OPTIONS },
  { group: 'Prediction development', kind: 'prediction-continuous', label: 'Develop and validate a continuous model', inputs: [{ key: 'y', label: 'Outcome', role: 'numeric' }, ...predictionInputs], options: PREDICTION_OPTIONS },
];
export const analysisOf = kind => ANALYSES.find(a => a.kind === kind) || null;

