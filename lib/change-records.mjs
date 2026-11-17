// The change syntheses of a project (lib/change-synthesis.mjs) as the rest of Lykos reads them: one evaluation per set of inputs (the rows
// lib/change-rows.mjs reads from the extraction and the plan; looked up once per store version, as lib/synth-project.mjs does), the query
// sources `syntheses` (one row per pooled result, with its printed text, and the benchmark by class as wide rows) and `effects` (the rows a
// forest or funnel draws: each effect with its CI, SE and weight, the pooled rows and prediction intervals marked; lib/change-tables.mjs), `changes`
// (one row per study, outcome and arm with its SMCR and standing, as the Scales page words it: lib/scale-guide.mjs armStanding),
// and the records Syntheses lists (family "Change"). Nothing is stored: a changed cell changes them. A worker's answers for the same inputs
// (lib/change-run.mjs) are kept here too, so the page and the query layer read them instead of fitting again on the page's thread.
import { changeSynthesis, changePlan } from './change-synthesis.mjs';
import { guideSets, armStanding } from './scale-guide.mjs';
import { changeRows } from './change-rows.mjs';
import { effectRowsOf, synthesisRowsOf, figureListOf, CHANGE_FIGURES, EFFECT_COLUMNS, SYNTHESIS_COLUMNS, f2, f1, ciText, piText, pText } from './change-tables.mjs';
import { store$get as liveState, store$getVersion as getVersion, store$inUpdate as inUpdate } from "../boot.mjs";

export { f2, f1, ciText, piText, pText, CHANGE_FIGURES };

// the inputs of the open project, once per store version; a state that is not the live one (a test's, the MCP's) once per object
let looked = null;
const weakInputs = new WeakMap();
// each set of inputs (by its key, a digest of the inputs as text) with what was made of it: { m, list, effects, table, association }; the last few, so an undo finds its own
const made = new Map();
const KEEP = 3;
// JSON with the values JSON would fold together (NaN, the infinities, undefined) kept apart, so two inputs that differ never share a key
const keyText = (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `\u0000${v}` : v === undefined ? '\u0000u' : v);
// The key is a digest of that text (3.7 MB on Sham, a copy in each memo and run: docs/footprint-2026-11.md): its length, two cyrb53 hashes
function digest(text) {
  const h = seed => {
    let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (2097152 * (b & 2097151) + (a >>> 0)).toString(36);
  };
  return `${text.length.toString(36)}.${h(1)}.${h(0x9e3779b9)}`;
}
/** The inputs of a project's change synthesis: { rows, plan, key }, or null when it has no plan (s.synthesis.change). */
export function changeInputs(s) {
  const plan = changePlan(s);   // with the review's scale decisions, so a decision is a new set of inputs
  if (!plan) return null;
  const live = s === liveState() && !inUpdate(), v = live ? getVersion() : null;
  if (live && looked?.s === s && looked.v === v) return looked.inputs;
  if (!live && weakInputs.has(s)) return weakInputs.get(s);
  const rows = changeRows(s, plan.rows || {}), inputs = { rows, plan, key: digest(JSON.stringify([rows, plan], keyText)) };
  if (live) looked = { s, v, inputs }; else weakInputs.set(s, inputs);
  return inputs;
}
/** The open project's inputs when they were already looked up for its current version, else null (nothing is read). */
export function changeInputsKnown(s) {
  const live = s === liveState() && !inUpdate();
  if (live) return looked?.s === s && looked.v === getVersion() ? looked.inputs : null;
  return weakInputs.get(s) || null;
}
/** What has been made of these inputs (an entry kept for the last few). */
export function madeOf(inputs) {
  if (!inputs) return null;
  let e = made.get(inputs.key);
  if (e) { made.delete(inputs.key); made.set(inputs.key, e); return e; }
  made.set(inputs.key, (e = {}));
  while (made.size > KEEP) made.delete(made.keys().next().value);
  return e;
}
/** The worker's answers for a set of inputs: `list` (lib/change-list.mjs changeListOf), `effects` and `table` (the sources) and `association` (the moderators' rule). */
export function keepMade(key, part, value) { const e = made.get(key); if (e) e[part] = value; }

/** The project's change synthesis, or null when it has no plan (s.synthesis.change). */
export function changeModel(s) {
  const inputs = changeInputs(s);
  if (!inputs) return null;
  const e = madeOf(inputs);
  return (e.m ||= changeSynthesis(s, inputs.plan, { rows: inputs.rows }));
}

// ---- the printed numbers, as the review's report writes them ---------------------------------------------------------------------
/** The `syntheses` source: { columns, rows }, made once per set of inputs (a worker's answer, lib/change-run.mjs, is read before the model is fitted here). */
export function synthesisTable(s) {
  const inputs = changeInputs(s);
  if (!inputs) return { columns: SYNTHESIS_COLUMNS, rows: [] };
  const e = madeOf(inputs);
  return (e.table ||= synthesisRowsOf(changeModel(s)));
}

// ---- the per-outcome rows ------------------------------------------------------------------------------------------------------------
const lowerHigher = { lower_better: 'Lower is better', higher_better: 'Higher is better' };
/** The `changes` source's columns: [id, label, type, alias?, get?] (get reads the row when the column is not a field of it). */
export const OUTCOME_ROW_COLUMNS = [['trial', 'Study', 'text', ['label', 'trial']], ['paper_id', 'Record ID', 'text'], ['arm', 'Arm', 'text'], ['arm_label', 'Arm label', 'text'],
  ['arm_role', 'Role', 'text'], ['indication_class', 'Indication class', 'text'], ['design', 'Design', 'text'], ['outcome_slot', 'Outcome slot', 'text'], ['outcome', 'Outcome', 'text'],
  ['instrument', 'Instrument', 'text'], ['direction', 'Direction', 'text', null, r => lowerHigher[r.direction] || 'Not recorded'],
  ['baseline_mean', 'Baseline mean', 'number'], ['baseline_sd', 'Baseline SD', 'number'], ['baseline_n', 'Baseline n', 'number'],
  ['end_mean', 'End mean', 'number'], ['end_sd', 'End SD', 'number'], ['end_n', 'End n', 'number'], ['change_used', 'Change', 'number'], ['change_source', 'Change source', 'text'],
  ['change_sd', 'Change SD', 'number'], ['n', 'n', 'number'], ['r_prim', 'Pre-post r', 'number'], ['r_source', 'Pre-post r source', 'text'], ['yi', 'SMCR', 'number'], ['vi', 'Variance', 'number'],
  ['standing', 'Standing', 'text'], ['prerand_mean', 'Pre-randomization baseline mean', 'number'], ['prerand_sd', 'Pre-randomization baseline SD', 'number'], ['flags', 'Flags', 'text']];
/** The `changes` source: one row per study, outcome and arm the change synthesis reads, with its SMCR and standing (task 8694 of the Sham review); made once per set of inputs. */
export function outcomeRowTable(s) {
  const inputs = changeInputs(s);
  if (!inputs) return { columns: OUTCOME_ROW_COLUMNS, rows: [] };
  const e = madeOf(inputs);
  // every arm as recorded (an excluded scale's too) with its SMCR, and where it stands after the scale decisions: the Scales page's words
  const g = guideSets(inputs);
  return (e.outcomeRows ||= { columns: OUTCOME_ROW_COLUMNS, rows: (g?.all || []).map(a => ({ ...a, standing: armStanding(a, g).words })) });
}

// ---- the rows a figure draws -------------------------------------------------------------------------------------------------------
/** The `effects` source: { columns, rows } in drawing order (lib/change-tables.mjs), made once per set of inputs. */
export function effectTable(s) {
  const inputs = changeInputs(s);
  if (!inputs) return { columns: EFFECT_COLUMNS, rows: [] };
  const e = madeOf(inputs);
  return (e.effects ||= effectRowsOf(changeModel(s)));
}

// ---- the figures, as Syntheses lists and draws them ---------------------------------------------------------------------------------
/** The change figures a project can draw, each with how many rows it has: [{ code, title, kind, k }]. */
export function changeFigureList(s) {
  const m = changeModel(s);
  return m ? figureListOf(m) : [];
}
/**
 * One change figure as SVG ({ svg, title, rows } or { error }), drawn by the output chart renderer in the given figure style (export unless
 * given). `group` draws one group of a forest (a class, or one subgroup of SUBGROUPS) with its subtotal; `width` is the screen width.
 * `rows` are the query rows in the order the marks' data-row count them: [{ label, paperId }] (paperId null on a pooled row).
 */
export async function changeFigure(s, code, { style = null, group = '', width } = {}) {
  const f = CHANGE_FIGURES.find(x => x.code === code);
  // the inputs, not the model: the rows come from the effects source, which the worker may already have made (lib/change-run.mjs)
  if (!f || !changeInputs(s)) return { error: `No change synthesis "${code}"` };
  // loaded here: output-render reads the query layer, which reads this module
  const [spec, render, style0] = await Promise.all([import('./output-spec.mjs'), import('./output-render.mjs'), import('./figure-style.mjs')]);
  const query = { ...f.spec.query, select: [...f.spec.query.select, 'Record ID'], ...(group ? { where: `${f.spec.query.where}; Group = ${group}` } : {}) };
  const v = spec.validateSpec({ id: `synth-${code.toLowerCase()}`, kind: 'chart', title: group ? `${f.title}: ${group}` : f.title, ...f.spec, query, chart: Object.fromEntries(Object.entries(f.spec.chart).filter(([, x]) => x !== undefined)) });
  if (!v.ok) return { error: v.errors.join(' ') };
  const out = render.renderOutput(s, v.spec);
  if (!out.result.rows.length) return { error: group ? `${f.title} has no rows in ${group}` : `${f.title} has no rows to draw` };
  const li = out.result.columns.findIndex(c => c.label === 'Study'), ri = out.result.columns.findIndex(c => c.label === 'Record ID');
  return { svg: render.chartSvg(out, { style: style || style0.figureTokens(null, { medium: 'export' }), ...(width ? { width } : {}) }), title: v.spec.title,
    rows: out.result.rows.map(r => ({ label: String(r[li] ?? ''), paperId: r[ri] || null })) };
}
