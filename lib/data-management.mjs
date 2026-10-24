// Glue between the Datasets view and the data-management modules (amendment
// of 2026-09-29): the pure pieces a view needs from lib/data-rules.mjs,
// lib/trial-logs.mjs, lib/redcap.mjs and lib/deidentify.mjs, kept here so they
// can be tested without a page. Nothing here reads or writes the store.
import { checkAll, parseRule, rowIdOf } from './data-rules.mjs';
import { summarizeLog, saeReports, LOG_KINDS, DEVIATION_CATEGORIES, SEVERITY_GRADES, CAUSALITY } from './trial-logs.mjs';
import { DICTIONARY_HEADERS } from './redcap.mjs';
import { deidentify } from './deidentify.mjs';

// ---- issues on the grid -------------------------------------------------------------

/** Whether a dataset has anything to check: a column constraint or an edit check. */
export const hasChecks = d => !!(d?.rules?.length || d?.columns?.some(c => c.rules && Object.keys(c.rules).length));

/**
 * Issues from checkAll indexed for the grid: `cells` maps "row\u0000column" to
 * the issues on that cell (an edit check marks every column it names), `rows`
 * the rows with any, `ruleErrors` the checks that do not parse, and `list`
 * every row issue in row order. Info-level issues (a declared missing code)
 * are listed but not marked.
 */
export function issueIndex(dataset, issues = hasChecks(dataset) ? checkAll(dataset) : []) {
  const cells = new Map(), rows = new Set(), ruleErrors = [], list = [];
  for (const x of issues) {
    if (x.kind === 'rule-error') { ruleErrors.push(x); continue; }
    list.push(x);
    if (x.severity === 'info') continue;
    rows.add(x.row);
    for (const col of x.columns?.length ? x.columns : [x.column]) {
      if (!col) continue;
      const k = `${x.row}\u0000${col}`;
      (cells.get(k) || cells.set(k, []).get(k)).push(x);
    }
  }
  list.sort((a, b) => a.row - b.row);
  return { cells, rows, ruleErrors, list, count: list.filter(x => x.severity !== 'info').length };
}

// ---- edit checks as text, one per line ------------------------------------------------

/** Each non-blank line of the Edit checks box parsed: [{ line, text, error, pos }]. */
export function parseCheckLines(text) {
  return String(text ?? '').split('\n').map((t, i) => ({ line: i + 1, text: t.trim() })).filter(x => x.text && !x.text.startsWith('#'))
    .map(x => { const p = parseRule(x.text); return { ...x, error: p.error, pos: p.pos }; });
}

/** The lines as dataset.rules, keeping the id and message of a check whose text is unchanged. */
export function checksFromText(text, previous = []) {
  const byText = new Map((previous || []).map(r => [String(typeof r === 'string' ? r : r.text).trim(), typeof r === 'string' ? { text: r } : r]));
  const used = new Set((previous || []).map(r => r?.id).filter(Boolean));
  let n = 0;
  const fresh = () => { let id; do id = `check${++n}`; while (used.has(id)); used.add(id); return id; };
  return parseCheckLines(text).map(x => {
    const old = byText.get(x.text);
    return old ? { ...old, id: old.id || fresh(), text: x.text } : { id: fresh(), text: x.text };
  });
}
/** dataset.rules as the text of the Edit checks box. */
export const checksToText = rules => (rules || []).map(r => typeof r === 'string' ? r : r.text).join('\n');

// ---- the Rules dialog --------------------------------------------------------------------

const list = t => String(t ?? '').split(/[\n,;|]/).map(x => x.trim()).filter(Boolean);
/**
 * The Rules form (all text) as column.rules: { rules, error }. Bounds are
 * numbers for a number column and dates as written for a date column; a
 * pattern that is not a regular expression, a bound that does not read, and
 * a minimum above the maximum are errors.
 */
export function rulesFromForm(form, type = 'text') {
  const rules = {};
  if (form.required) rules.required = true;
  for (const k of ['min', 'max']) {
    const v = String(form[k] ?? '').trim(); if (!v) continue;
    if (type === 'number' || type === 'integer') { const x = Number(v.replace(',', '.')); if (!Number.isFinite(x)) return { rules: null, error: `The ${k === 'min' ? 'minimum' : 'maximum'} is not a number` }; rules[k] = x; }
    else rules[k] = v;
  }
  if (typeof rules.min === 'number' && typeof rules.max === 'number' && rules.min > rules.max) return { rules: null, error: 'The minimum is above the maximum' };
  const allowed = list(form.allowed); if (allowed.length) rules.allowed = allowed;
  const pattern = String(form.pattern ?? '').trim();
  if (pattern) { try { new RegExp(pattern, 'u'); } catch { return { rules: null, error: 'The pattern is not a regular expression' }; } rules.pattern = pattern; }
  const missing = list(form.missingCodes); if (missing.length) rules.missingCodes = missing;
  const unit = String(form.unit ?? '').trim(); if (unit) rules.unit = unit;
  return { rules, error: null };
}
/** column.rules as the Rules form's text values. */
export const formFromRules = (r = {}) => ({ required: !!r.required, min: r.min ?? '', max: r.max ?? '', allowed: (r.allowed || []).join(', '),
  pattern: r.pattern || '', missingCodes: (r.missingCodes || []).join(', '), unit: r.unit || '' });
/** A short reading of a column's rules for its header: "required · 18–90 kg". */
export function rulesLine(r) {
  if (!r) return '';
  const unit = r.unit ? ` ${r.unit}` : '';
  const range = r.min != null && r.max != null ? `${r.min}–${r.max}${unit}` : r.min != null ? `≥ ${r.min}${unit}` : r.max != null ? `≤ ${r.max}${unit}` : r.unit || '';
  return [r.required ? 'required' : '', range, r.allowed?.length ? `${r.allowed.length} values` : '', r.pattern ? 'pattern' : '', r.missingCodes?.length ? `missing ${r.missingCodes.join('/')}` : ''].filter(Boolean).join(', ');
}

// ---- REDCap ---------------------------------------------------------------------------------

/** Whether a CSV's first line is a REDCap data dictionary header (the field name and field type columns). */
export function looksLikeDictionary(text) {
  const first = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase();
  return first.includes(DICTIONARY_HEADERS[0].toLowerCase()) && first.includes('field type') && first.includes('form name');
}

/**
 * Records read by parseRecords, joined to a dataset: rows whose key (the
 * dataset's rowKey) is already there are left out, not overwritten, so an
 * import never changes a value past the change log. Returns
 * { columns, rows, skipped }.
 */
export function recordsToAppend(dataset, parsed) {
  const key = dataset.rowKey;
  // a record with events or a repeating instrument has one row per event and instance
  const id = r => key && String(r[key] ?? '').trim() ? [r[key], r.redcap_event_name, r.redcap_repeat_instrument, r.redcap_repeat_instance].map(v => String(v ?? '').trim()).join('\u0000') : null;
  const have = new Set((dataset.rows || []).map(id).filter(Boolean));
  const rows = [];
  let skipped = 0;
  for (const r of parsed.rows) {
    const k = id(r);
    if (k && have.has(k)) { skipped++; continue; }
    if (k) have.add(k);
    rows.push(r);
  }
  return { columns: parsed.columns, rows, skipped };
}

// ---- trial logs ---------------------------------------------------------------------------------

export const logName = kind => LOG_KINDS.find(([k]) => k === kind)?.[1] || kind;
const STATUS_ORDER = { overdue: 0, 'no-awareness': 1, due: 2, late: 3, reported: 4 };
export const SAE_STATUS = { overdue: 'Overdue', 'no-awareness': 'No awareness time', due: 'Due', late: 'Reported late', reported: 'Reported on time' };
const top = (o, n = 6) => Object.entries(o || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

/**
 * What a log shows above its grid: { kind, facts: [[label, value]], tables:
 * [{ title, head, rows }], sae?: [...] (overdue first), flow? }. `now` sets
 * the SAE clock (a date-time text or ms; the present by default).
 */
export function logSummary(dataset, { now = Date.now() } = {}) {
  const s = summarizeLog(dataset);
  if (!s) return null;
  const kind = dataset.template;
  if (kind === 'adverse-events') {
    const sae = saeReports(dataset, { now }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || String(a.dueBy).localeCompare(String(b.dueBy)));
    return { kind, facts: [['Events', s.events], ['Participants', s.participants], ['Serious', `${s.serious} in ${s.seriousParticipants}`], ['Grade 3 or above', s.gradeThreePlus], ['Related', s.related], ['SUSAR', s.susar]],
      tables: [
        { title: 'Grade', head: [...SEVERITY_GRADES.map(([g]) => String(g)), 'Missing'], rows: [[...SEVERITY_GRADES.map(([g]) => s.byGrade[g]), s.byGrade.missing]] },
        { title: 'Causality', head: [...CAUSALITY, 'Missing'], rows: [[...CAUSALITY.map(c => s.byCausality[c]), s.byCausality.missing]] },
        { title: 'Seriousness', head: Object.keys(s.bySeriousness).map(k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())), rows: [Object.values(s.bySeriousness)] },
      ],
      sae, note: s.scaleNote };
  }
  if (kind === 'deviations') {
    const cats = [...DEVIATION_CATEGORIES.filter(c => s.byCategory[c]), ...Object.keys(s.byCategory).filter(c => !DEVIATION_CATEGORIES.includes(c))];
    return { kind, facts: [['Deviations', s.total], ['Major', s.major], ['Minor', s.minor], ['Without corrective action', s.withoutCorrectiveAction]],
      tables: cats.length ? [{ title: 'By category', head: ['Category', 'Total', 'Major', 'Minor'], rows: cats.map(c => [c, s.byCategory[c].total, s.byCategory[c].major, s.byCategory[c].minor]) }] : [] };
  }
  if (kind === 'conmeds') {
    const meds = top(s.byMedication);
    return { kind, facts: [['Records', s.records], ['Participants', s.participants], ['Ongoing', s.ongoing]],
      tables: meds.length ? [{ title: 'Most recorded', head: ['Medication', 'Participants'], rows: meds }] : [] };
  }
  if (kind === 'screening') {
    return { kind, facts: [['Assessed', s.assessed], ['Excluded', s.excluded.total], ['Randomised', s.randomised], ['Withdrawn', s.totals.withdrawn], ['Lost to follow-up', s.totals.lost], ['Analysed', s.totals.analysed ?? 'not recorded']],
      tables: [], flow: s };
  }
  return null;
}

// ---- de-identification ------------------------------------------------------------------------------

export const DEID_ACTIONS = [['keep', 'Keep'], ['drop', 'Drop'], ['pseudonymise', 'Pseudonymise'], ['shift', 'Shift dates'], ['generalise', 'Generalise dates'], ['age', 'Cap age'], ['zip', 'Truncate ZIP']];

/** A recipe (deidentify) as one action per column. */
export function actionsFromRecipe(recipe, columns) {
  const out = Object.fromEntries((columns || []).map(c => [c.id, 'keep']));
  const set = (ids, a) => (ids || []).forEach(id => { if (id in out) out[id] = a; });
  set(recipe.generaliseColumns, 'generalise');
  set(recipe.zipColumns, 'zip');
  set(recipe.ageColumns, 'age');
  set(recipe.dateShift?.columns, 'shift');
  if (recipe.pseudonymise) set([recipe.pseudonymise.column || recipe.pseudonymise], 'pseudonymise');
  set(recipe.drop, 'drop');
  return out;
}

/**
 * One action per column, and the settings, as a recipe for deidentify().
 * Only one column is pseudonymised (the first so marked). Returns { recipe, error }.
 */
export function recipeFromActions(actions, { days = 180, level = 'year', ageCap = 89, zipDigits = 3, prefix = 'P' } = {}) {
  const of = a => Object.entries(actions || {}).filter(([, v]) => v === a).map(([k]) => k);
  const pseudo = of('pseudonymise');
  if (pseudo.length > 1) return { recipe: null, error: 'Pseudonymise one column: the participant identifier' };
  const recipe = { drop: of('drop') };
  if (pseudo.length) recipe.pseudonymise = { column: pseudo[0], prefix: String(prefix || 'P') };
  if (of('shift').length) {
    const d = Math.floor(Number(days));
    if (!(d >= 1)) return { recipe: null, error: 'The date shift needs a number of days' };
    recipe.dateShift = { columns: of('shift'), days: d };
  }
  if (of('generalise').length) { recipe.generaliseDates = level === 'month' ? 'month' : 'year'; recipe.generaliseColumns = of('generalise'); }
  if (of('age').length) { const c = Number(ageCap); if (!(c > 0)) return { recipe: null, error: 'The age cap needs a number' }; recipe.ageCap = c; recipe.ageColumns = of('age'); }
  if (of('zip').length) { const z = Math.floor(Number(zipDigits)); if (!(z >= 1)) return { recipe: null, error: 'ZIP truncation needs a number of digits' }; recipe.truncateZip = z; recipe.zipColumns = of('zip'); }
  return { recipe, error: null };
}

/**
 * A pseudonym prefix no value of the column already starts with, so that a
 * pseudonym cannot be read as an original identifier: P, then S, R, K, then PS.
 */
export function freePrefix(dataset, columnId) {
  const values = (dataset?.rows || []).map(r => String(r?.[columnId] ?? '').trim().toUpperCase()).filter(Boolean);
  return ['P', 'S', 'R', 'K', 'PS', 'PX'].find(p => !values.some(v => v.startsWith(p))) || 'PSEUDO-';
}

/**
 * A de-identified copy under an id no dataset has: { dataset, key, report }.
 * The key is returned for a separate download and never put in the dataset.
 */
export function deidentifiedCopy(dataset, recipe, seed, takenIds = []) {
  const r = deidentify(dataset, recipe, seed);
  const taken = new Set(takenIds);
  let id = r.dataset.id, n = 1;
  while (taken.has(id)) id = `${r.dataset.id}${++n}`;
  const name = n > 1 ? `${r.dataset.name.replace(/\)$/, '')} ${n})` : r.dataset.name;
  return { ...r, dataset: { ...r.dataset, id, name } };
}

/** The key file's text: the pseudonyms and date shifts, with what they are. */
export function keyFileText(key, { dataset = '', at = new Date().toISOString() } = {}) {
  return JSON.stringify({ warning: 'This key re-identifies the de-identified dataset. Store it apart from the data, with access limited.', dataset, createdAt: at, ...key }, null, 2);
}

// ---- change log --------------------------------------------------------------------------------------------

/** One change-log entry in words, for the Change log panel. */
export function describeEntry(e, columns = []) {
  const col = c => columns.find(x => x.id === c)?.label || c;
  switch (e.action) {
    case 'change': return `${col(e.column)}: ${e.from === '' ? 'empty' : e.from} → ${e.to === '' ? 'empty' : e.to}`;
    case 'lock': return 'Locked';
    case 'unlock': return 'Unlocked';
    case 'verify': return 'Source data verified';
    case 'remove': return 'Row removed';
    case 'import': return `${e.rows} rows imported${e.source ? ` from ${e.source}` : ''}`;
  }
  return e.action;
}

/** The grid row index of a logged row identifier (a key value or an index), or -1. */
export function rowIndexOf(dataset, rowId) {
  if (rowId == null) return -1;
  if (dataset.rowKey) return (dataset.rows || []).findIndex((_, i) => String(rowIdOf(dataset, i)) === String(rowId));
  const i = Number(rowId);
  return Number.isInteger(i) && i >= 0 && i < (dataset.rows || []).length ? i : -1;
}
