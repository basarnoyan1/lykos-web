// Tables and figures as data (tables-and-figures amendment, 2026-09-28).
//
// An output is a spec: a query over the project (lib/project-query.mjs) and
// how to lay out its rows — a table, one table per group, or a chart — with
// its title, notes and export formats. The app, the assistant and an MCP
// client all create outputs by writing a spec; nothing about a new table or
// figure needs new code. Example:
//
//   { kind: 'table', title: 'Deformity studies',
//     query: { from: 'studies', collection: 'Table 5', select: ['Study', 'Study design', 'Deformity share'], sort: 'Study' },
//     columns: [{ col: 'Deformity share', label: 'Deformity (share of patients)' }],
//     notes: 'All: deformity is the study population.', exports: ['xlsx', 'docx', 'csv'] }
//
// Saved outputs keep immutable versions, like workflows (lib/flow-versions.mjs):
// `s.outputs = [{ id, versions: [{ n, at, author, message, summary, spec }] }]`.
// Every save that changes the spec adds a version; identical saves are skipped;
// restoring adds a version. Pure over plain objects: the app, Node tests and
// the MCP server share it.
import { addonChart } from './addons.mjs';
import { runQuery, normalizeQuery, QueryError, normName } from './project-query.mjs';
import { assessmentRows, itemColumns } from './appraisal-summary.mjs';
import { researchType } from './workflow.mjs';
import { isPrimaryType } from './research-types.mjs';
import { stable, recordVersion } from './versions.mjs';
import { sameTableName } from './template-import.mjs';

export const KINDS = ['table', 'chart'];
export const CHART_TYPES = ['bar', 'column', 'stacked', 'dot', 'forest', 'timeline', 'heat', 'pie', 'scatter'];
export const FORMATS = ['text', 'integer', 'number', '1dp', '2dp', 'percent'];
export const EXPORTS = { table: ['xlsx', 'docx', 'csv'], chart: ['svg', 'png', 'csv', 'xlsx'] };
export const VERSION_LIMIT = 50;
const CHART_FIELDS = ['type', 'x', 'y', 'series', 'lo', 'hi', 'value', 'sort', 'page', 'xLabel', 'yLabel', 'log', 'ref'];
const SPEC_FIELDS = ['id', 'kind', 'title', 'query', 'columns', 'groupRowsBy', 'chart', 'notes', 'exports'];
// Which chart fields each type reads, and which it must have.
const NEEDS = {
  bar: { required: ['x'], optional: ['y', 'sort', 'page', 'xLabel', 'yLabel'] },
  column: { required: ['x'], optional: ['y', 'sort', 'xLabel', 'yLabel'] },
  stacked: { required: ['x', 'series'], optional: ['y', 'sort', 'page', 'xLabel', 'yLabel'] },
  dot: { required: ['x', 'y'], optional: ['sort', 'page', 'xLabel', 'yLabel', 'ref'] },
  forest: { required: ['x', 'y', 'lo', 'hi'], optional: ['sort', 'page', 'xLabel', 'log', 'ref'] },
  timeline: { required: ['x'], optional: ['y', 'xLabel', 'yLabel'] },
  heat: { required: ['x', 'y'], optional: ['value', 'xLabel', 'yLabel'] },
  pie: { required: ['x'], optional: ['y', 'sort'] },   // parts of a whole: a few categories and their counts (the Data summary's Make)
  scatter: { required: ['x', 'y'], optional: ['xLabel', 'yLabel'] },   // two numbers, each row a point (the Data summary's Make)
};

const norm = normName;
export const newOutputId = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Checks a spec and brings it to its canonical shape. With the project state,
 * the query is run and every column the layout names must be a column of its
 * result. Returns `{ ok, spec, errors }`; each error says what to change, so a
 * model can correct its own spec.
 */
export function validateSpec(input, s = null) {
  const errors = [];
  const err = m => errors.push(m);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, spec: null, errors: ['The spec must be a JSON object with kind, title and query.'] };
  const extra = Object.keys(input).filter(k => !SPEC_FIELDS.includes(k) && !['group_rows_by', 'groupBy'].includes(k));
  if (extra.length) err(`Unknown field${extra.length > 1 ? 's' : ''} ${extra.map(k => `"${k}"`).join(', ')}. Fields: ${SPEC_FIELDS.join(', ')}.`);
  if (input.groupBy != null && input.query && !input.query.groupBy) err('groupBy belongs inside query (it aggregates rows); to split a table into one table per value use groupRowsBy.');
  const spec = { id: input.id ? String(input.id) : newOutputId(), kind: input.kind, title: String(input.title ?? '').trim() };
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/.test(spec.id)) err('id may hold letters, digits, "-", "_" and ":" (at most 64).');
  if (!KINDS.includes(spec.kind)) err(`kind must be "table" or "chart" (got ${JSON.stringify(input.kind)}).`);
  if (!spec.title) err('title is required: the caption readers see, e.g. "Follow-up by table".');
  if (spec.title.length > 160) err('title is longer than 160 characters.');
  // Stored without empty parts, so a spec reads as it was written.
  try { spec.query = Object.fromEntries(Object.entries(normalizeQuery(input.query)).filter(([k, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(k === 'scope' && v === 'included'))); } catch (e) { err(`query: ${e.message}`); }
  if (input.columns != null) {
    if (!Array.isArray(input.columns)) err('columns must be a list of { col, label, format, hidden } or column names.');
    else spec.columns = input.columns.map((c, i) => {
      const o = typeof c === 'string' ? { col: c } : c && typeof c === 'object' ? { ...c } : null;
      if (!o || !o.col) { err(`columns[${i}] needs col: a column of the query result.`); return null; }
      const bad = Object.keys(o).filter(k => !['col', 'label', 'format', 'hidden'].includes(k));
      if (bad.length) err(`columns[${i}]: unknown field ${bad.map(k => `"${k}"`).join(', ')}; use col, label, format, hidden.`);
      if (o.format != null && !FORMATS.includes(o.format)) err(`columns[${i}].format must be one of ${FORMATS.join(', ')}.`);
      return { col: String(o.col), ...(o.label ? { label: String(o.label).slice(0, 120) } : {}), ...(o.format ? { format: o.format } : {}), ...(o.hidden ? { hidden: true } : {}) };
    }).filter(Boolean);
  }
  const groupRows = input.groupRowsBy ?? input.group_rows_by;
  if (groupRows != null && groupRows !== '') spec.groupRowsBy = String(groupRows);
  if (spec.kind === 'chart') {
    const c = input.chart;
    if (!c || typeof c !== 'object') err(`A chart needs chart: { type, x, y, … }; type is one of ${CHART_TYPES.join(', ')}.`);
    else {
      // an addon's chart type (lib/addons.mjs) brings its own fields: columns it maps, and plain options (a scale's name, an MCID)
      const ac = CHART_TYPES.includes(c.type) ? null : addonChart(c.type);
      const fields = ac ? [...new Set([...CHART_FIELDS, ...ac.fields.required, ...ac.fields.optional, ...ac.options])] : CHART_FIELDS;
      const bad = Object.keys(c).filter(k => !fields.includes(k));
      if (bad.length) err(`chart: unknown field ${bad.map(k => `"${k}"`).join(', ')}. Fields: ${fields.join(', ')}.`);
      if (!CHART_TYPES.includes(c.type) && !ac) err(`chart.type must be one of ${CHART_TYPES.join(', ')} (got ${JSON.stringify(c.type)}).`);
      else {
        const need = ac ? { required: ac.fields.required, optional: [...ac.fields.optional, ...ac.options, 'xLabel', 'yLabel'] } : NEEDS[c.type];
        for (const f of need.required) if (c[f] == null || c[f] === '') err(`A ${c.type} chart needs chart.${f}${f === 'x' ? ' (the category or label column)' : f === 'y' ? ' (the numeric column)' : f === 'series' ? ' (the column that splits each bar)' : ''}.`);
        const unused = fields.filter(f => f !== 'type' && c[f] != null && !need.required.includes(f) && !need.optional.includes(f));
        if (unused.length) err(`A ${c.type} chart does not use ${unused.map(f => `chart.${f}`).join(', ')}.`);
        if (spec.groupRowsBy && !['bar', 'dot', 'forest'].includes(c.type)) err('groupRowsBy splits bar, dot and forest charts into sections; other chart types cannot use it.');
      }
      if (c.sort != null && !['value', '-value', 'label', '-label', 'none'].includes(c.sort)) err('chart.sort is value, -value, label, -label or none.');
      if (c.log && c.ref != null && c.ref !== '' && !(Number(c.ref) > 0)) err('On a log scale chart.ref must be above 0 (1 is no effect for a ratio).');
      if (c.page != null && !(Number.isInteger(c.page) && c.page >= 5 && c.page <= 200)) err('chart.page is the rows per page, a whole number from 5 to 200.');
      spec.chart = Object.fromEntries(fields.filter(f => c[f] != null && c[f] !== '').map(f => [f, ['page'].includes(f) ? Number(c[f]) : f === 'log' ? Boolean(c[f]) : f === 'ref' ? Number(c[f]) : String(c[f])]));
    }
  } else if (input.chart != null) err('Only a chart has chart settings; set kind to "chart" or remove chart.');
  if (input.notes != null) { spec.notes = String(input.notes).trim().slice(0, 2000); if (!spec.notes) delete spec.notes; }
  if (input.exports != null) {
    const allowed = EXPORTS[spec.kind] || [];
    const list = Array.isArray(input.exports) ? input.exports : [input.exports];
    const bad = list.filter(x => !allowed.includes(x));
    if (bad.length) err(`exports for a ${spec.kind || 'output'}: ${allowed.join(', ')} (not ${bad.join(', ')}).`);
    spec.exports = [...new Set(list.filter(x => allowed.includes(x)))];
  }
  // The query runs, and what the layout names must be columns of its result.
  if (s && spec.query && !errors.length) {
    try {
      const r = runQuery(s, { ...spec.query, limit: 1, offset: 0 });
      const names = r.columns.map(c => c.label);
      const known = ref => r.columns.some(c => norm(c.label) === norm(ref) || norm(c.id) === norm(ref));
      const need = (ref, where) => { if (ref != null && !known(ref)) err(`${where} "${ref}" is not a column of the query result. Result columns: ${names.join(', ')}.`); };
      for (const [i, c] of (spec.columns || []).entries()) need(c.col, `columns[${i}].col`);
      need(spec.groupRowsBy, 'groupRowsBy');
      const ac = spec.chart && addonChart(spec.chart.type);
      if (spec.chart) for (const f of ac ? [...ac.fields.required, ...ac.fields.optional] : ['x', 'y', 'series', 'lo', 'hi', 'value']) need(spec.chart[f], `chart.${f}`);
    } catch (e) { err(e instanceof QueryError ? `query: ${e.message}` : `query failed: ${e.message}`); }
  }
  return { ok: !errors.length, spec: errors.length ? null : spec, errors };
}

// ---- versions ------------------------------------------------------------------
const PARTS = [['title', 'title'], ['kind', 'kind'], ['columns', 'columns'], ['groupRowsBy', 'row groups'], ['notes', 'notes'], ['exports', 'exports']];
const QUERY_PARTS = { from: 'source', template: 'template', collection: 'collection', scope: 'scope', select: 'columns selected', where: 'filter', groupBy: 'grouping', aggregate: 'aggregates', sort: 'sort', limit: 'limit', offset: 'offset' };
const CHART_PARTS = { type: 'chart type', x: 'x', y: 'y', series: 'series', lo: 'lower limit', hi: 'upper limit', value: 'value', sort: 'bar order', page: 'rows per page', xLabel: 'x label', yLabel: 'y label', log: 'log scale', ref: 'reference line' };
const same = (a, b) => stable(a ?? null) === stable(b ?? null);
const emptyish = v => v == null || (Array.isArray(v) && !v.length);

/** What changed between two specs, by part: `[{ part, label, before, after }]`. */
export function diffSpecs(before = {}, after = {}) {
  const out = [];
  for (const [k, label] of PARTS) if (!same(before[k], after[k])) out.push({ part: k, label, before: before[k], after: after[k] });
  for (const [k, label] of Object.entries(QUERY_PARTS)) { const a = before.query?.[k], b = after.query?.[k]; if (!(emptyish(a) && emptyish(b)) && !same(a, b)) out.push({ part: `query.${k}`, label, before: a, after: b }); }
  for (const [k, label] of Object.entries(CHART_PARTS)) { const a = before.chart?.[k], b = after.chart?.[k]; if (!same(a, b)) out.push({ part: `chart.${k}`, label, before: a, after: b }); }
  return out;
}
/** "Changed title; changed filter and sort". */
export function describeSpecDiff(d) {
  if (!d.length) return 'No changes';
  const labels = [...new Set(d.map(x => x.label))];
  const text = `Changed ${labels.slice(0, 5).join(', ')}${labels.length > 5 ? ` and ${labels.length - 5} more` : ''}`;
  return text.replace(/, ([^,]+)$/, ' and $1');
}
/** Identity of a spec for versioning: its id aside, key order ignored. */
export const specKey = spec => { const { id, ...rest } = spec || {}; return stable(rest); };

/** Adds a version unless the spec equals the latest. Returns `{ versions, version }`; version is null when nothing changed (lib/versions.mjs). */
export const recordOutputVersion = (list = [], spec, { author = 'You', message = '', at = new Date().toISOString(), restoredFrom } = {}) =>
  recordVersion(list, spec, { field: 'spec', key: specKey, summarize: (a, b) => describeSpecDiff(diffSpecs(a, b)), author, message, at, restoredFrom, limit: VERSION_LIMIT });

/** The current spec of a saved output. */
export const currentSpec = entry => entry?.versions?.at(-1)?.spec || null;
export const outputById = (s, id) => (s.outputs || []).find(o => o.id === id) || null;

/**
 * Saves a spec on the state object as a new version of its output (created
 * when new). Mutates `s` — call inside the store's update(). Returns `{ entry, version }`.
 */
export function saveOutput(s, spec, opts = {}) {
  s.outputs ||= [];
  let entry = s.outputs.find(o => o.id === spec.id);
  if (!entry) { entry = { id: spec.id, versions: [] }; s.outputs.push(entry); }
  const { versions, version } = recordOutputVersion(entry.versions, { ...spec, id: entry.id }, opts);
  entry.versions = versions;
  return { entry, version };
}
/** Version `n` of an output, saved again as a new version. */
export function restoreOutput(s, id, n, opts = {}) {
  const entry = outputById(s, id); if (!entry) throw new Error('That output is not in the project.');
  const v = entry.versions.find(x => x.n === n); if (!v) throw new Error('That version is no longer kept.');
  return saveOutput(s, v.spec, { ...opts, message: `Restored v${n}`, restoredFrom: n });
}
export function removeOutput(s, id) { s.outputs = (s.outputs || []).filter(o => o.id !== id); }

// ---- built-in examples -------------------------------------------------------------
/**
 * The figures the app already draws, as specs: read-only examples to open and
 * duplicate. The PRISMA flow is its own diagram, listed with where it lives.
 */
export function builtinOutputs(s) {
  const tpl = (s.templates || []).find(t => Object.keys(s.values || {}).some(k => k.includes(`:${t.id}.`)));
  // the evidence table whole: every column of the extraction table but its ID and its grouping columns (Main table, a group's share), which
  // the person adds with the table's column chooser (withTableChoice)
  const cols = tpl ? tpl.columns.filter(c => !c.groupKey && !/\.main_table$/.test(c.id)).map(c => c.label) : ['Design', 'Population', 'Intervention', 'Comparator', 'Outcome definition'];
  const list = [
    { id: 'builtin:year', kind: 'chart', title: 'Publications per year', query: { from: 'studies', groupBy: ['Year'], aggregate: ['count'], sort: 'Year' }, chart: { type: 'column', x: 'Year', y: 'Count' }, exports: ['svg', 'png', 'csv'] },
    { id: 'builtin:collections', kind: 'chart', title: 'Included studies by collection', query: { from: 'studies', groupBy: ['collection'], aggregate: ['count'], sort: '-Count' }, chart: { type: 'bar', x: 'Collection', y: 'Count', xLabel: 'Studies' }, exports: ['svg', 'png', 'csv'] },
    { id: 'builtin:evidence', kind: 'table', title: tpl ? tpl.name : 'Evidence table', query: { from: 'studies', ...(tpl ? { template: tpl.id } : { template: 'default' }), select: ['Study label', 'Year', ...cols.filter(c => !/^(id|study)$/i.test(c))] }, exports: ['xlsx', 'docx', 'csv'] },
  ];
  // Patient data, the search log and the appraisal are the tables a patient-level review's supplement holds.
  const people = s.participants || [];
  if (people.length) {
    const cols = (s.ipdColumns || []).filter(c => people.some(p => p[c.id] != null && p[c.id] !== ''));
    const yearCol = cols.find(c => c.id === 'year'), caseCol = cols.find(c => c.id === 'case_no');
    const shown = cols.filter(c => c.id !== 'label' && c.id !== 'year').map(c => c.name);
    const groupCol = (s.ipdColumns || []).find(c => c.role === 'group'), timeCol = (s.ipdColumns || []).find(c => c.role === 'time'), eventCol = (s.ipdColumns || []).find(c => c.role === 'event');
    list.push({ id: 'builtin:cases', kind: 'table', title: 'Included cases',
      query: { from: 'patients', select: ['Study', ...(yearCol ? [yearCol.name] : []), ...shown], sort: [...(yearCol ? [`-${yearCol.name}`] : []), 'Study', ...(caseCol ? [caseCol.name] : [])] },
      ...(yearCol ? { columns: ['Study', ...shown].map(col => ({ col })) } : {}), notes: 'One row per patient, newest report first, then alphabetically; multi-patient reports keep their case numbers.', exports: ['xlsx', 'docx', 'csv'] });
    if (groupCol && timeCol && eventCol) list.push({ id: 'builtin:strategy', kind: 'table', title: `Patients, events and follow-up by ${groupCol.name.toLowerCase()}`,
      query: { from: 'patients', groupBy: [groupCol.name], aggregate: ['count as Patients', `sum(${eventCol.name}) as Events`, `sum(${timeCol.name}) as Person-time`], sort: groupCol.name }, exports: ['xlsx', 'docx', 'csv'] });
  }
  if ((s.searches || []).length) list.push({ id: 'builtin:searches', kind: 'table', title: 'Search strategies and yields',
    query: { from: 'searches', select: ['Source', 'Query', 'Date', 'Records retrieved'] }, notes: 'One row per search in the log, as run.', exports: ['xlsx', 'docx', 'csv'] });
  const graded = assessmentRows(s);
  if (graded.length) list.push({ id: 'builtin:appraisal', kind: 'table', title: 'Appraisal by study',
    query: { from: 'assessments', select: ['Study', 'Tool', ...itemColumns(graded).map(c => c.short), 'Items met', 'Items applicable', 'Risk of bias'], sort: 'Study' }, groupRowsBy: 'Tool',
    notes: 'Yes = criterion met; No = not met; Unclear = insufficient information; Not applicable = leaves the denominator.', exports: ['xlsx', 'docx', 'csv'] });
  return list.map(spec => ({ id: spec.id, builtin: true, versions: [{ n: 1, at: '', author: 'Lykos', message: '', summary: 'Built in', spec: withTableChoice(s, spec) }] }));
}

/**
 * A table drawn from the extraction as the person chose it (`s.tableChoices[spec.id]`: `{ select, perArm }`): its columns, any of the
 * extraction table's (the grouping columns the Data summary leaves unanalysed among them), and one row per arm instead of a study's arms
 * joined with ";" in one row. A spec without a choice is returned as it is.
 */
export function withTableChoice(s, spec) {
  const c = s?.tableChoices?.[spec?.id];
  if (!c || spec.kind !== 'table' || !spec.query || !['studies', 'arms', undefined].includes(spec.query.from)) return spec;
  const q = { ...spec.query, select: Array.isArray(c.select) && c.select.length ? c.select.slice() : (spec.query.select || []).slice() };
  if (c.perArm) {
    q.from = 'arms';
    if (!q.select.some(l => /^arm label$/i.test(l))) q.select.splice(q.select.findIndex(l => /^study( label)?$/i.test(l)) + 1, 0, 'Arm label');
  } else if (q.from === 'arms' && spec.query.from !== 'arms') q.from = 'studies';
  return { ...spec, query: q };
}
/** The extraction columns a table may show: every column of its table but its ID (its grouping columns among them), the study's label and year first. */
export function tableColumnChoices(s, spec) {
  const q = spec?.query || {}, t = (s.templates || []).find(x => x.id === q.template || sameTableName(x.name, q.template || ''));
  if (!t) return [];
  return ['Study label', 'Year', ...t.columns.filter(c => !/^id$/i.test(String(c.label || '').trim())).map(c => c.label || c.id)];
}
export const BUILTIN_LINKS = [{ id: 'builtin:prisma', title: 'PRISMA flow diagram', kind: 'chart', view: 'reporting', source: 'Screening decisions and counts', label: 'Screening decisions' }];
export function builtinLinks(state) {
  const type = researchType(state);
  if (isPrimaryType(type.id)) return [{ id:'builtin:participant-flow', title:'Participant flow', kind:'chart', view:'reporting', section:'participant-flow', source:'Recorded participant populations', label:'Participants' }];
  return type.kind === 'review' ? BUILTIN_LINKS.map(link => ({...link,section:'flow'})) : [];
}
export const isBuiltin = id => String(id || '').startsWith('builtin:');

// What an output reads, in a word or two for a list column (the whole sourceLine is its tooltip): the extraction table it reads when it
// reads one, else what it is drawn from. One map, so every list names a source alike.
const SOURCE_LABEL = { studies: 'Studies', records: 'Records', arms: 'Study arms', values: 'Values', screening: 'Screening decisions', collections: 'Collections', searches: 'Searches',
  appraisal: 'Appraisal', assessments: 'Appraisal', analysis: 'Analysis', criteria: 'Criteria', runs: 'Workflow runs', patients: 'Patient data' };
export function sourceLabel(spec, s = null) {
  const q = spec?.query || {};
  const tpl = q.template && q.template !== 'default' ? (s && (s.templates || []).find(t => t.id === q.template || sameTableName(t.name, q.template))?.name) || q.template : '';
  return tpl || SOURCE_LABEL[q.from || 'studies'] || String(q.from || 'Studies');
}
/** One line on what an output reads, for lists: "Studies · Evidence table v12 · Table 5". */
export function sourceLine(spec, s = null) {
  const q = spec?.query || {};
  const from = { studies: 'Studies', records: 'Records', arms: 'Study arms', values: 'Values', screening: 'Screening', collections: 'Collections', searches: 'Searches', appraisal: 'Appraisal', analysis: 'Analysis', criteria: 'Criteria', runs: 'Workflow runs', patients: 'Patient data', assessments: 'Appraisal' }[q.from || 'studies'] || q.from;
  const tpl = q.template && s ? ((s.templates || []).find(t => t.id === q.template || sameTableName(t.name, q.template))?.name || q.template) : q.template;
  return [from, tpl && tpl !== 'default' ? tpl : '', q.collection || ''].filter(Boolean).join(', ');
}
