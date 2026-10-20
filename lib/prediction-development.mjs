// Frozen prediction development: the validation rows never enter fitting,
// categorical coding, or choice of predictors. This is ordinary regression,
// with one disjoint validation population and no automated tuning.
import { cellValue } from './datasets.mjs';
import { linearRegression, logisticRegression } from './stats-regression.mjs';
import { roc, calibration, decisionCurve } from './clinical-epi.mjs';

const label = value => String(value ?? '').trim();
const numeric = c => c.type === 'number' || c.type === 'integer';
const number = (row, c) => cellValue(row[c.id], numeric(c) ? c.type : 'number');
const rowId = (d, row, index) => String(d.rowIds?.[index] ?? (d.rowKey ? row[d.rowKey] : index + 1));
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sig = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const need = (condition, message) => { if (!condition) throw new Error(message); };
function seededShuffle(values, seed) {
  const out = [...values]; let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function binaryPerformance(predicted, observed) {
  const events = observed.reduce((a, b) => a + b, 0);
  need(events >= 2 && observed.length - events >= 2, 'Each binary model population needs at least two events and two non-events');
  const cal = calibration(predicted, observed);
  const auc = roc(predicted, observed);
  return { n: observed.length, events, auc, calibration: cal, decisionCurve: decisionCurve(predicted, observed),
    logLoss: -observed.reduce((sum, y, i) => sum + y * Math.log(Math.max(1e-15, predicted[i])) + (1 - y) * Math.log(Math.max(1e-15, 1 - predicted[i])), 0) / observed.length };
}
function continuousPerformance(predicted, observed) {
  need(observed.length >= 3, 'Continuous validation requires at least three observations');
  const n = observed.length, mean = observed.reduce((a, b) => a + b, 0) / n;
  const sse = observed.reduce((s, y, i) => s + (y - predicted[i]) ** 2, 0), sst = observed.reduce((s, y) => s + (y - mean) ** 2, 0);
  return { n, rmse: Math.sqrt(sse / n), mae: observed.reduce((s, y, i) => s + Math.abs(y - predicted[i]), 0) / n, r2: sst > 0 ? 1 - sse / sst : null,
    meanObserved: mean, meanPredicted: predicted.reduce((a, b) => a + b, 0) / n };
}

/** Fits on development rows only and predicts both populations with the frozen model. */
export function developPrediction(d, family, inputs, options = {}) {
  need(['binary', 'continuous'].includes(family), 'Unknown prediction family');
  const { y, event, predictors = [], unit, partition, development, validation } = inputs;
  const col = id => { const c = d.columns.find(c => c.id === id); need(c, `Unknown prediction column ${id}`); return c; };
  const outcome = col(y), ids = [...new Set(predictors)];
  need(ids.length && !ids.includes(y), 'Choose predictors distinct from the outcome');
  need(!unit || !ids.includes(unit), 'A split-unit identifier cannot be a predictor');
  need(!partition || !ids.includes(partition), 'A validation-partition column cannot be a predictor');
  if (unit) col(unit); if (partition) col(partition);
  const columns = ids.map(col), split = options.split || 'random', evaluation = options.evaluation || 'held-out';
  need(['random', 'column'].includes(split), 'Choose a supported prediction split');
  need(['held-out', 'external'].includes(evaluation), 'Choose the validation population');
  need(evaluation !== 'external' || split === 'column', 'External validation needs an explicit development/validation partition, not a random holdout');
  const fraction = options.fraction === '' || options.fraction == null ? .3 : Number(options.fraction);
  const seed = options.seed === '' || options.seed == null ? 1729 : Number(options.seed);
  if (split === 'random') {
    need(fraction >= .1 && fraction <= .5, 'Choose a holdout fraction from 0.1 to 0.5');
    need(Number.isSafeInteger(seed) && seed >= 0 && seed <= 4294967295, 'The split seed must be a whole number from 0 to 4294967295');
  } else need(partition && development && validation && development !== validation, 'Choose a partition column and two different development/validation levels');
  const excluded = [], complete = [];
  const allOutcomes = [...new Set(d.rows.map(r => label(r[y])).filter(Boolean))];
  if (family === 'binary') need(allOutcomes.length === 2 && allOutcomes.includes(event), 'Choose an event from a two-level outcome');
  else need(numeric(outcome), 'Continuous development needs a numeric outcome');
  d.rows.forEach((row, index) => {
    const reasons = [], record = { index, rowId: rowId(d, row, index) };
    const observed = family === 'binary' ? (label(row[y]) ? +(label(row[y]) === event) : null) : number(row, outcome);
    if (observed == null) reasons.push(`Missing or invalid ${outcome.label || y}`);
    for (const c of columns) if (numeric(c) ? number(row, c) == null : !label(row[c.id])) reasons.push(`Missing or invalid ${c.label || c.id}`);
    if (unit && !label(row[unit])) reasons.push(`Missing split unit ${unit}`);
    if (split === 'column' && ![development, validation].includes(label(row[partition]))) reasons.push('Outside the selected development/validation partitions');
    if (reasons.length) excluded.push({ ...record, reasons });
    else complete.push({ ...record, row, observed, unit: unit ? label(row[unit]) : record.rowId });
  });
  need(complete.length >= 8, 'At least eight complete observations are required for development and validation');
  let training, testing;
  if (split === 'random') {
    const units = [...new Set(complete.map(r => r.unit))].sort(order);
    need(units.length >= 4, 'At least four independent split units are required');
    const count = Math.max(1, Math.min(units.length - 1, Math.round(units.length * fraction)));
    const heldOut = new Set(seededShuffle(units, seed).slice(0, count));
    training = complete.filter(r => !heldOut.has(r.unit)); testing = complete.filter(r => heldOut.has(r.unit));
  } else {
    training = complete.filter(r => label(r.row[partition]) === development); testing = complete.filter(r => label(r.row[partition]) === validation);
    const developmentUnits = new Set(training.map(r => r.unit));
    need(!testing.some(r => developmentUnits.has(r.unit)), 'A split unit occurs in both development and validation; keep each participant/site in one population');
  }
  need(training.length >= 5 && testing.length >= 3, 'The split needs at least five development and three validation observations');
  const specs = columns.map(c => ({ column: c.id, type: numeric(c) ? 'numeric' : 'categorical',
    ...(numeric(c) ? {} : { levels: [...new Set(training.map(r => label(r.row[c.id])))].sort(order) }) }));
  if (family === 'binary') binaryPerformance(training.map(() => .5), training.map(r => r.observed));
  const model = family === 'binary' ? logisticRegression(training.map(r => r.row), y, specs, { event, profile: false })
    : linearRegression(training.map(r => r.row), y, specs);
  need(model.coefficients.every(c => !c.aliased && Number.isFinite(c.estimate)), 'The development model has aliased or invalid coefficients; revise the prespecified predictors');
  need(model.dfResidual >= 2 || model.df >= 2, 'Development needs at least two residual degrees of freedom');
  if (family === 'binary') need(model.converged, 'The development model did not converge; revise the model before validating it');
  if (family === 'binary') need(!model.warnings.some(w => w.code === 'separation'), 'The development model shows possible separation; revise it before validating unstable predictions');
  const warnings = (model.warnings || []).map(w => w.message || String(w));
  const modelSpec = { format: 'lykos-prediction-model-v1', family, outcome: y, event: family === 'binary' ? event : null,
    predictors: model.predictors, levels: model.levels, coefficients: model.coefficients.map(c => ({ name: c.name, term: c.term, level: c.level, estimate: c.estimate })),
    trainingRows: training.map(r => ({ index: r.index, rowId: r.rowId, unit: r.unit })),
    split: { method: split, seed: split === 'random' ? seed : null, requestedFraction: split === 'random' ? fraction : null,
      partition: split === 'column' ? partition : null, development: split === 'column' ? development : null, validation: split === 'column' ? validation : null, evaluation,
      unit: unit || d.rowKey || (d.rowIds ? 'participant id' : 'row position') } };
  const accepted = [], predictions = [];
  for (const r of testing) {
    try { const predicted = predictFrozen(modelSpec, r.row); accepted.push(r); predictions.push({ index: r.index, rowId: r.rowId, unit: r.unit, observed: r.observed, predicted }); }
    catch (err) { excluded.push({ index: r.index, rowId: r.rowId, reasons: [String(err.message || err)], partition: 'validation' }); }
  }
  need(accepted.length >= 3, 'Too few validation observations remain after applying development-only predictor coding');
  const predictedTraining = training.map(r => predictFrozen(modelSpec, r.row));
  const metrics = family === 'binary' ? binaryPerformance : continuousPerformance;
  const performance = { development: metrics(predictedTraining, training.map(r => r.observed)), validation: metrics(predictions.map(r => r.predicted), accepted.map(r => r.observed)) };
  if (!unit && !d.rowKey && !d.rowIds) warnings.push('Rows were split independently. For repeated patients or clustered data, select a split-unit column so all rows from one unit stay together.');
  if (model.rank > training.length / 10) warnings.push('The development sample is small relative to its fitted parameters; prespecify sample size and assess overfitting before clinical use.');
  if (family === 'binary' && model.events / Math.max(1, model.rank - 1) < 10) warnings.push('Fewer than ten development events per fitted predictor parameter; assess small-sample bias and overfitting.');
  if (testing.length !== accepted.length) warnings.push(`${testing.length - accepted.length} validation observations were excluded because predictor levels were not represented in development.`);
  if (evaluation === 'external') warnings.push('The external cohort designation is researcher-provided; the app verifies disjoint split units but cannot establish independent cohort provenance.');
  warnings.push('Predictors were fitted once on development data. This workflow does not tune models, select predictors, perform cross-validation or account for clustered inference.');
  const population = { policy: 'Complete cases; split before fitting, with categorical levels learned from development only.', sourceRows: d.rows.length,
    used: training.length + accepted.length, dropped: excluded.length,
    included: [...training.map(r => ({ index: r.index, rowId: r.rowId, partition: 'development', unit: r.unit })), ...accepted.map(r => ({ index: r.index, rowId: r.rowId, partition: 'validation', unit: r.unit }))].sort((a, b) => a.index - b.index), excluded: excluded.sort((a, b) => a.index - b.index) };
  return { model: modelSpec, predictions, performance, population, warnings, fittedModel: model };
}

/** Applies saved coefficients without refitting or inspecting new outcomes. */
export function predictFrozen(model, row) {
  need(model?.format === 'lykos-prediction-model-v1', 'Unsupported frozen prediction model');
  for (const p of model.predictors) {
    if (p.type === 'categorical') need(model.levels[p.column].levels.includes(label(row[p.column])), `Validation level of ${p.column} was not present in development`);
    else need(Number.isFinite(Number(row[p.column])) && label(row[p.column]) !== '', `Missing or invalid predictor ${p.column}`);
  }
  const eta = model.coefficients.reduce((sum, c) => sum + c.estimate * (c.term == null ? 1 : c.level == null ? Number(row[c.term]) : +(label(row[c.term]) === c.level)), 0);
  need(Number.isFinite(eta), 'Invalid frozen model prediction');
  return model.family === 'binary' ? sig(eta) : eta;
}
