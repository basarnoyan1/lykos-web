// What Make keeps (views/summary-make.mjs): a chart as a Tables and figures output (lib/output-spec.mjs), a pooled proportion or a
// composite as an outcome read from the table's text with its result (the path Analysis uses: lib/derived-counts.mjs, lib/outcomes.mjs
// saveAnalysis), a contrast as the result of the outcome it was read from, a SWiM as Certainty's outcome domain (lib/swim-state.mjs), and
// a Kaplan–Meier as a dataset analysis (lib/dataset-analysis.mjs kind 'km'), kept with its dataset as the Datasets page keeps one. `keep(st, what)` is called inside update(); it answers { ok, message }. Pure but for the store it is given.
import { validateSpec, saveOutput, newOutputId } from './output-spec.mjs';
import { addOutcome } from './outcomes.mjs';
import { saveAnalysis } from './i2-q.mjs';
import { derivedInputs } from './derived-counts.mjs';
import { contrastInputs, isContrast } from './contrast-counts.mjs';
import { settingsOf } from './heterogeneity.mjs';
import { swimOf } from './swim-state.mjs';
import { analysisEntry } from './dataset-analysis.mjs';
import { keepDatasetEntry } from './result-versions.mjs';
import { emptyPackage, addItem, addPart } from './package.mjs';
import { forestOptions, favoursOf } from './forest-options.mjs';

const now = () => new Date().toISOString();

/** A chart or table output. */
export function keepOutput(st, spec) {
  const v = validateSpec({ ...spec, id: newOutputId() }, st);
  if (!v.ok) return { ok: false, message: v.errors[0] || 'That chart could not be kept' };
  saveOutput(st, v.spec, { author: 'You', message: 'Made on the Data summary' });
  return { ok: true, message: `Added to Tables and figures: ${v.spec.title}` };
}

/** Certainty's SWiM gets the measure as an outcome domain with each study's direction; Tables and figures lists its table and harvest plot. */
export function keepSwim(st, { name, rows }) {
  const x = swimOf(st); let n = x.outcomes.length + 1; while (x.outcomes.some(o => o.id === `o${n}`)) n++;
  const id = `o${n}`;
  x.outcomes.push({ id, name });
  for (const r of rows) { (x.cells[r.paperId] ||= {})[id] = r.direction; if (r.n && x.n[r.paperId] == null) x.n[r.paperId] = String(r.n); }
  st.swim = x;
  return { ok: true, message: `Added to Certainty: ${name}` };
}

/** An outcome that reads a measure's counts from the table's text (lib/derived-counts.mjs text-counts); one that exists already is reused. */
export function textCountsOutcome(st, { name, template, column, items }) {
  const same = (st.outcomes || []).find(o => o.derived?.kind === 'text-counts' && o.derived.column === column && JSON.stringify(o.derived.items) === JSON.stringify(items));
  if (same) return same.id;
  const oid = addOutcome(st, name, 'PR');
  st.outcomes = st.outcomes.map(o => (o.id === oid ? { ...o, derived: { kind: 'text-counts', template, column, items, unit: 'arm', nColumn: '', fromPercent: false, subgroup: null } } : o));
  return oid;
}

/**
 * A pooled proportion (or a composite) as an outcome with its result, in the shape Analysis saves (views/analysis-proportions.mjs resultOf):
 * `parts` [{ name, template, column, items }] (one for a plain measure, several for a composite with `rule`); `fit` lib/meta-pool.mjs's
 * result; `rows` [{ study, label, events, n, level? }]; `moderator` the subgroup field's id and `levels` its order when compared.
 */
export function keepProportion(st, { name, parts, rule = null, fit, rows, moderator = '', moderatorLabel = '', levels = null, forest = null, outcomeId = '' }) {
  // a defined outcome (Syntheses and Analysis) is kept as its own analysis; a measure becomes an outcome read from the table's text
  if (!fit || (!parts?.length && !(st.outcomes || []).some(o => o.id === outcomeId))) return { ok: false, message: 'Nothing pooled to keep' };
  let oid;
  if (!parts?.length) oid = outcomeId;
  else if (parts.length === 1 && !rule) oid = textCountsOutcome(st, parts[0]);
  else {
    const ids = parts.map(p => textCountsOutcome(st, p));
    const same = (st.outcomes || []).find(o => o.derived?.kind === 'composite' && o.derived.rule === rule && JSON.stringify(o.derived.parts) === JSON.stringify(ids));
    oid = same?.id || addOutcome(st, name, 'PR');
    if (!same) st.outcomes = st.outcomes.map(o => (o.id === oid ? { ...o, derived: { kind: 'composite', rule, parts: ids, unit: 'arm' } } : o));
  }
  const outcome = st.outcomes.find(o => o.id === oid);
  if (moderator) st.outcomes = st.outcomes.map(o => (o.id === oid ? { ...o, derived: { ...o.derived, subgroup: { column: moderator, levels: (levels || []).map(l => [l, l]) } } } : o));
  const derived = st.outcomes.find(o => o.id === oid).derived, inputs = derived ? derivedInputs(st, derived, moderator) : { snapshot: '' };
  const result = { ...fit, measure: 'PR', method: 'REML', derived: true, settings: settingsOf({ method: 'REML', test: 'z', pi: 'follow', measure: 'PR' }), labels: rows.map(r => r.label),
    units: rows.map(r => r.study), sources: [], levels: rows.map(r => (r.level == null ? null : String(r.level))), zeroEvents: '0.5 added to events and non-events of arms with 0 or all events (escalc add = 1/2, to = "only0")',
    moderator, moderatorLabel, inputSnapshot: inputs.snapshot, outcomeId: oid, outcomeName: outcome.name, engine: 'js', made: 'Data summary', at: now(), ...(forest && Object.keys(forest).length ? { forest } : {}) };
  saveAnalysis(st, oid, result);
  return { ok: true, message: `Kept as the analysis of ${outcome.name}`, outcomeId: oid };
}

/** A two-arm contrast pooled from an outcome that holds arms, as the result of that outcome (views/analysis-comparative.mjs resultOf). */
export function keepContrast(st, { outcomeId, measure, fit, rows, treated, control, moderator = '', moderatorLabel = '', forest = null }) {
  const o = (st.outcomes || []).find(x => x.id === outcomeId);
  if (!o || !fit) return { ok: false, message: 'Nothing pooled to keep' };
  st.outcomes = st.outcomes.map(x => (x.id === outcomeId ? { ...x, measure } : x));
  const inputs = isContrast(o.derived) ? contrastInputs(st, o.derived, moderator, measure) : null;
  const result = { ...fit, measure, method: 'REML', test: 'z', settings: settingsOf({ method: 'REML', test: 'z', pi: 'follow', measure }), contrast: { treated, control },
    favours: favoursOf(treated, control, forestOptions(forest)), ...(forest && Object.keys(forest).length ? { forest } : {}), values: rows.map(r => r.values), labels: rows.map(r => r.label), papers: rows.map(r => r.study),
    sources: rows.map(r => r.sources || []), modValues: moderator ? rows.map(r => (r.level == null ? null : String(r.level))) : undefined, zeroEvents: '0.5 added to all four cells of a study with a zero cell (escalc add = 1/2, to = "only0")',
    participants: rows.reduce((t, r) => t + (r.values[1] || 0) + (r.values[3] || 0), 0), moderator, moderatorLabel, inputSnapshot: inputs?.snapshot || '', outcomeId, outcomeName: o.name, engine: 'js', made: 'Data summary', at: now() };
  saveAnalysis(st, outcomeId, result);
  return { ok: true, message: `Kept as the analysis of ${o.name}`, outcomeId };
}

/** A Kaplan–Meier from a dataset or the patient table, kept as a dataset analysis (lib/dataset-analysis.mjs, the Datasets page's own kind 'km'). */
export function keepSurvival(st, { dataset, inputs, result }) {
  // the same curve of the same table kept again is a new version of the one kept (lib/result-versions.mjs); `made` names its origin in Tables and figures
  const id = keepDatasetEntry(st, { ...analysisEntry(dataset, 'km', inputs, {}, result, now()), made: 'Data summary' });
  return { ok: true, message: `Kept with ${dataset.name}: ${result.title || 'Kaplan–Meier'}`, id };
}

/**
 * A comparison of Syntheses drawn in Make: its forest's options kept with the combination (s.synthesis.forests, lib/forest-options.mjs) and
 * the figure added to the package, drawn again from the project each time the package is built (as Syntheses' Add to package).
 */
export function keepSynthForest(st, { code, outcomeId, options = {}, title = '' }) {
  if (!code || !outcomeId) return { ok: false, message: 'Nothing to keep' };
  st.synthesis = { ...(st.synthesis || {}), forests: { ...(st.synthesis?.forests || {}), [`${code}|${outcomeId}`]: options } };
  st.package ||= emptyPackage();
  const key = `synth:forest:${outcomeId}:${code}`, had = Object.values(st.package.items || {}).find(x => x.source?.app === key);
  if (had) return { ok: true, message: `Kept the figure's options: ${title}` };
  const part = st.package.parts.find(p => /figure/i.test(p.name)) || addPart(st.package, { name: 'Figures', file: 'Package/Figures v1.docx' });
  addItem(st.package, part.id, { kind: 'figure', source: { app: key }, title, legend: '' });
  return { ok: true, message: `Added to ${part.name}: ${title}` };
}

/** One door for the view: `what` names how (`{ how: 'output' | 'swim' | 'proportion' | 'contrast' | 'survival', ...payload }`). */
export function keep(st, what) {
  switch (what?.how) {
    case 'output': return keepOutput(st, what.spec);
    case 'swim': return keepSwim(st, what);
    case 'proportion': return keepProportion(st, what);
    case 'contrast': return keepContrast(st, what);
    case 'synth-forest': return keepSynthForest(st, what);
    case 'survival': return keepSurvival(st, what);
    default: return { ok: false, message: 'Nothing to keep' };
  }
}
