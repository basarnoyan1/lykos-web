// One small query over a project's state (tables-and-figures amendment,
// 2026-09-28). The Tables and figures view, the assistant's query_project and
// propose_output tools and the MCP server all read the project through this,
// so a new table or figure is a query plus a layout (lib/output-spec.mjs), not
// new code.
//
// A query is plain data:
//   { from: 'studies', template: 'Evidence table v12', collection: 'Table 5',
//     select: ['Study', 'Study design', 'Deformity share'],
//     where: 'Deformity share!=; Year>=2010',            // or [{ col, op, value }]
//     groupBy: ['collection', 'Surgical intent'], aggregate: ['count', 'mean(Follow-up (mo))'],
//     sort: ['collection', '-count'], limit: 50, offset: 0 }
// and answers plain rows with column metadata:
//   { columns: [{ id, label, type }], rows: [[…], …], refs: [[paperId, …], …],
//     total, offset, next_offset, notes: [] }
//
// Columns are named by id or label, case and spacing ignored: built-in record
// fields (Study, Year, DOI, collection, …), extraction fields, and the columns
// of an imported table ("Follow-up (mo)" or t_x.follow_up_mo or follow_up_mo).
// An unknown name is refused with the nearest names, so a caller can correct
// itself. Pure over the state object; nothing is written.
import { studies as includedStudies, finalDecision } from './screen.mjs';
import { datasets, findDataset, cellValue as datasetCell } from './datasets.mjs';
import { savedAnalyses, sourceById, isStale } from './dataset-analysis-core.mjs';
import { fields } from './fields.mjs';
import { armsOf, cellKey } from './arms.mjs';
import { foldSearch } from './search-ranking.mjs';
import { assessmentRows, itemColumns } from './appraisal-summary.mjs';

export const SOURCES = {
  studies: 'Included studies (all records before screening), one row per study',
  records: 'Every library record, one row per record',
  arms: 'One row per study arm; a study without arms is one row. Arm values where recorded, else the study value',
  values: 'One row per extracted value, with its provenance (origin, verification, evidence)',
  screening: 'One row per record: title/abstract and full-text decisions with reasons',
  collections: 'One row per collection: name, parent, member count',
  searches: 'One row per logged search: source, query, date, records retrieved',
  appraisal: 'One row per study and appraisal domain: tool, domain, judgement',
  analysis: 'One row per pooled result of the saved analysis',
  criteria: 'One row per eligibility criterion',
  runs: 'One row per workflow run: workflow, status, trigger, time',
  assessments: 'One row per study and appraisal instrument, wide: an answer per item (Q1…), items met of those that apply, and the grade under the review\'s stated rule',
  patients: 'One row per patient of the patient data, with the study it came from and every patient column (strategy, follow-up, event, …)',
  dataset: 'One of the project\'s own datasets (name it with `dataset`), one row per row of the table',
  dependencies: 'One row per dependency of the project: a decision counted in a PRISMA box, a column a table reads, a result a manuscript sentence links, a script that reads a file. From, to, their kinds, how it is known',
  analyses: 'One row per analysis kept from a dataset or the patient data: dataset, analysis, results sentence, method, n, kept date, whether its data changed since',
};
export const OPS = ['=', '!=', '~', '!~', '>', '<', '>=', '<=', 'in', 'empty', 'not empty'];
export const AGGREGATES = ['count', 'count_distinct', 'sum', 'mean', 'median', 'min', 'max', 'list'];
export const LIMIT = 500;
/** The query language in one paragraph, for tools that describe it to a model or a person. */
export const QUERY_SYNTAX = 'query: { from: studies|arms|records|values|screening|collections|searches|appraisal|analysis|criteria|runs|patients|assessments|dataset|analyses|dependencies, dataset: a dataset\'s name (from: dataset), template: table name or id, collection: name (members only), scope: all (studies: every record), select: [column], where: "Year>=2020; Study design~cohort; collection in Table 1|Table 2; Deformity share is not empty" (operators = != ~ !~ > < >= <= in, is empty, is not empty; = and in on Collection keep only those collections), groupBy: [column], aggregate: ["count", "count(Col)", "count_distinct(Record ID) as Studies", "sum|mean|median|min|max(Col)", "list(Col)"], sort: ["Collection", "-Count"], limit, offset }. Columns by label or id; a list column (Collection) puts a row in each of its values when grouped. Numbers are read strictly: "≥24", "60–96" or "2–3 days" are not numbers and are listed in notes.';

export class QueryError extends Error {}
const fail = m => { throw new QueryError(m); };

// ---- values ------------------------------------------------------------------
// Case, accents, and spaces, "_" and "-" between words are not significant in names.
export const normName = s => foldSearch(s).replace(/[\s_\u2010-\u2015-]+/g, ' ').trim();   // accents, ı and İ do not matter
const norm = normName;
const squash = s => norm(s).replace(/[^a-z0-9]+/g, '');
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
const text = v => v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
const isEmpty = v => v == null || (Array.isArray(v) ? !v.length : String(v).trim() === '');

/**
 * A cell read as a number, strictly: "39.1", "0,72", "1,234", or a number
 * followed by a parenthetical note ("64 (whole cohort)"). A bound ("≥24"), a
 * range ("60–96"), a unit ("2–3 days") or several arms in one cell are not a
 * number, and are reported rather than guessed.
 */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null || Array.isArray(v)) return null;
  let t = String(v).trim().replace(/−/g, '-').replace(/\s*\([^()]*\)\s*$/, '').replace(/[\s ]/g, '');
  if (!t) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?%?$/i.test(t)) return null;
  const n = Number(t.replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}
const yearOf = p => { const m = String(p?.year ?? '').match(/\b(1[89]\d\d|20\d\d|21\d\d)\b/); return m ? Number(m[1]) : null; };
const valueText = v => v == null ? null : v.availability === 'not_found' && v.reported_value == null ? 'NR' : String(v.reported_value ?? v.normalized_value ?? '');
const authorName = a => typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' ');

// ---- templates and columns ----------------------------------------------------------
/** The project's tables: the default extraction fields and every imported template. */
export function tablesOf(s) {
  return [{ id: 'default', name: 'Study data', columns: fields(s) }, ...(s.templates || []).map(t => ({ ...t, columns: t.columns || [] }))];
}
/** The table a query reads: named by id or name; else the imported table holding the most values, else the default. */
export function tableFor(s, ref) {
  const all = tablesOf(s);
  if (ref != null && ref !== '') {
    const r = norm(ref), hit = all.find(t => t.id === ref) || all.find(t => norm(t.name) === r) || (r === norm('Extraction') ? all[0] : null) || all.find(t => norm(t.name).includes(r));   // the default table was called Extraction
    if (!hit) fail(`Unknown template "${ref}". Templates: ${all.map(t => `${t.name} (${t.id})`).join(', ')}`);
    return hit;
  }
  const counts = new Map();
  for (const k of Object.keys(s.values || {})) { const f = k.slice(k.indexOf(':') + 1); const dot = f.indexOf('.'); const id = dot > 0 ? f.slice(0, dot) : 'default'; counts.set(id, (counts.get(id) || 0) + 1); }
  const best = all.filter(t => t.id !== 'default').sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))[0];
  return best && (counts.get(best.id) || 0) > 0 ? best : all[0];
}

/** Collections as name lists per record, parents included (a record in "Table 1/Arm" is also in "Table 1"). */
function collectionIndex(s) {
  const all = s.collections || [], byId = new Map(all.map(c => [c.id, c])), out = new Map();
  for (const c of all) for (const m of c.members || []) {
    const names = out.get(m) || [];
    for (let x = c, guard = 0; x && guard < 20; x = byId.get(x.parent), guard++) if (!names.includes(x.name)) names.push(x.name);
    out.set(m, names);
  }
  const order = new Map(all.map((c, i) => [c.name, i]));
  for (const [k, v] of out) out.set(k, v.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) || order.get(a) - order.get(b)));
  return out;
}

// A column: { id, label, type, get(row) }. Record columns read row.p; table
// columns read the value store (by arm on the arms source).
function recordColumns(s) {
  const colls = collectionIndex(s);
  const dec = (stage, p) => (stage === 'ft' ? s.fulltext : s.screening)?.[p.id]?.decision || '';
  return [
    { id: 'id', label: 'Record ID', type: 'text', get: r => r.p.id },
    { id: 'label', label: 'Study label', type: 'text', get: r => r.p.label || r.p.title || r.p.id, aliases: ['study', 'record'] },
    { id: 'title', label: 'Title', type: 'text', get: r => r.p.title || '' },
    { id: 'year', label: 'Year', type: 'number', get: r => yearOf(r.p) },
    { id: 'authors', label: 'Authors', type: 'text', get: r => (r.p.authors || []).slice(0, 3).map(authorName).join('; ') + ((r.p.authors || []).length > 3 ? '; et al.' : '') },
    { id: 'first_author', label: 'First author', type: 'text', get: r => { const a = authorName((r.p.authors || [])[0] || ''); return a.includes(',') ? a.split(',')[0].trim() : a.split(/\s+/).at(-1) || ''; } },
    { id: 'journal', label: 'Journal', type: 'text', get: r => r.p.journal || '' },
    { id: 'doi', label: 'DOI', type: 'text', get: r => r.p.doi || '' },
    { id: 'pmid', label: 'PMID', type: 'text', get: r => r.p.pmid || '' },
    { id: 'number', label: 'Study number', type: 'number', get: r => Number(r.p.folderNo) || null, aliases: ['no'] },
    { id: 'pdf', label: 'PDF', type: 'text', get: r => r.p.pdf ? 'attached' : 'missing' },
    { id: 'ta_decision', label: 'Title/abstract decision', type: 'text', get: r => dec('ta', r.p), aliases: ['ta'] },
    { id: 'ft_decision', label: 'Full-text decision', type: 'text', get: r => dec('ft', r.p), aliases: ['ft'] },
    { id: 'decision', label: 'Decision', type: 'text', get: r => finalDecision(s, r.p.id)?.decision || '' },
    { id: 'collection', label: 'Collection', type: 'list', get: r => colls.get(r.p.id) || [], aliases: ['collections'] },
  ];
}

/** The value of a table column for a row: the arm's own value, else the study value (split per arm when the import kept the arms). */
function cellValue(s, table, row, col) {
  const plain = s.values?.[cellKey(row.p.id, col.id)];
  if (row.arm == null) {
    // A study row of a study whose arms hold this column reads the arms, in order.
    const arms = plain || table?.id === 'default' ? null : armsOf(table, row.p.id);
    if (!arms?.length) return plain;
    const own = arms.map(a => s.values?.[cellKey(row.p.id, col.id, a.id)]).filter(v => valueText(v) != null);
    if (!own.length) return plain;
    const text = own.map(v => valueText(v)).join('; ');
    return { ...own[0], reported_value: text, normalized_value: own.length === 1 ? own[0].normalized_value : text };
  }
  if (row.arm.id) { const own = s.values?.[cellKey(row.p.id, col.id, row.arm.id)]; if (own) return own; }
  if (Array.isArray(plain?.arms) && plain.arms.length > 1) {
    const t = plain.arms[row.arm.index];
    return t == null || String(t).trim() === '' ? null : { ...plain, reported_value: String(t), normalized_value: String(t) };
  }
  return plain;
}
function tableColumns(s, table) {
  return (table.columns || []).flatMap(c => {
    const short = table.id === 'default' ? c.id : c.id.slice(c.id.indexOf('.') + 1);
    const multi = c.multiple === true;   // a cell of several levels ("A; B"), read apart as a list
    const type = multi ? 'list' : c.type === 'number' || c.type === 'integer' ? 'number' : 'text';
    const label = c.label || c.name || c.id;
    const levels = r => { const t = valueText(cellValue(s, table, r, c)); return t == null ? [] : String(t).split(';').map(x => x.trim()).filter(Boolean); };
    const col = { id: c.id, label, type, table: table.id, short, aliases: [`${table.name} · ${label}`],
      get: multi ? r => { const l = levels(r); return l.length ? l : null; } : r => { const v = cellValue(s, table, r, c); const t = valueText(v); if (t == null) return null; return type === 'number' ? (toNumber(v.normalized_value) ?? toNumber(t) ?? t) : t; },
      raw: r => cellValue(s, table, r, c) };
    // the levels per cell: 1 is "only this"
    return multi ? [col, { id: `${c.id}#n`, label: `${label} (levels)`, type: 'number', table: table.id, short: `${short}_levels`, aliases: [], get: r => levels(r).length || null }] : [col];
  });
}
const armColumns = () => [
  { id: 'arm', label: 'Arm', type: 'number', get: r => r.arm ? r.arm.index + 1 : 1 },
  { id: 'arm_label', label: 'Arm label', type: 'text', get: r => r.arm?.label || '' },
];

function simpleColumns(defs) { return defs.map(([id, label, type, get, aliases]) => ({ id, label, type, get, aliases })); }

// ---- sources -----------------------------------------------------------------
function armsFor(s, table, p) {
  const split = table?.id !== 'default' ? armsOf(table, p.id) : null;
  if (split) return split.map((a, i) => ({ id: a.id, label: a.label, index: i }));
  // Joined imports keep each arm's text on the study value (`arms`).
  let n = 1, labels = null;
  for (const c of table?.columns || []) {
    const v = s.values?.[cellKey(p.id, c.id)];
    if (Array.isArray(v?.arms) && v.arms.length > n) { n = v.arms.length; if (/^arm\b/i.test(c.label || '')) labels = v.arms; }
    if (Array.isArray(v?.arms) && /^arm\b/i.test(c.label || '') && v.arms.length > 1) labels = v.arms;
  }
  if (n < 2) return [null];
  return Array.from({ length: n }, (_, i) => ({ id: null, label: String(labels?.[i] ?? `Arm ${i + 1}`).split('\n')[0].trim(), index: i }));
}

const lazySources = new Map();
/** A source that lives in its own module, loaded on first use (lib/deps-source.mjs registers `dependencies`): `make(s, q, { simpleColumns })` answers { rows, cols, refOf }. */
export const registerSource = (name, make) => { lazySources.set(name, make); };
const LAZY = { dependencies: () => import('./deps-source.mjs') };

function source(s, q) {
  const from = q.from || 'studies';
  if (LAZY[from] && !lazySources.has(from)) { LAZY[from]().catch(() => {}); fail(`The ${from} source is loading: ask again in a moment`); }
  if (lazySources.has(from)) return lazySources.get(from)(s, q, { simpleColumns });
  if (!SOURCES[from]) fail(`Unknown source "${from}". Sources: ${Object.keys(SOURCES).join(', ')}`);
  const inCollection = q.collection != null && q.collection !== '' ? collectionMembers(s, q.collection) : null;
  const keep = p => !inCollection || inCollection.has(p.id);
  if (from === 'studies' || from === 'records' || from === 'arms') {
    const table = tableFor(s, q.template);
    const scope = from === 'records' || q.scope === 'all' ? (s.papers || []) : includedStudies(s);
    const papers = scope.filter(keep);
    const rows = from === 'arms' ? papers.flatMap(p => armsFor(s, table, p).map(arm => ({ p, arm }))) : papers.map(p => ({ p, arm: null }));
    const extra = [...tablesOf(s).filter(t => t.id !== table.id && t.id !== 'default')];
    const cols = [...recordColumns(s), ...(from === 'arms' ? armColumns() : []), ...tableColumns(s, table),
      ...(table.id !== 'default' ? tableColumns(s, tablesOf(s)[0]) : []), ...extra.flatMap(t => tableColumns(s, t))];
    return { rows, cols, table, refOf: r => r.p.id };
  }
  const byId = new Map((s.papers || []).map(p => [p.id, p]));
  const label = id => byId.get(id)?.label || byId.get(id)?.title || id;
  if (from === 'values') {
    const tables = tablesOf(s), colOf = new Map(tables.flatMap(t => t.columns.map(c => [c.id, { c, t }])));
    const rows = Object.entries(s.values || {}).map(([k, v]) => {
      const i = k.indexOf(':'), pid = k.slice(0, i), rest = k.slice(i + 1), at = rest.lastIndexOf('@');
      const cid = at > 0 && /^@arm\d+$/.test(rest.slice(at)) ? rest.slice(0, at) : rest, arm = cid === rest ? '' : rest.slice(at + 1);
      return { pid, cid, arm, v, meta: colOf.get(cid) };
    }).filter(r => byId.has(r.pid) && keep(byId.get(r.pid)) && (q.template == null || q.template === '' || r.meta?.t.id === tableFor(s, q.template).id));
    return { rows, refOf: r => r.pid, cols: simpleColumns([
      ['study', 'Study', 'text', r => label(r.pid), ['label']], ['id', 'Record ID', 'text', r => r.pid],
      ['template', 'Template', 'text', r => r.meta?.t.name || ''], ['column_id', 'Column ID', 'text', r => r.cid],
      ['column', 'Column', 'text', r => r.meta?.c.label || r.cid, ['field']], ['arm', 'Arm', 'text', r => r.arm],
      ['value', 'Value', 'text', r => valueText(r.v)], ['number', 'Number', 'number', r => toNumber(r.v?.normalized_value) ?? toNumber(r.v?.reported_value)],
      ['origin', 'Origin', 'text', r => r.v?.origin || ''], ['verification', 'Verification', 'text', r => r.v?.verification || ''],
      ['availability', 'Availability', 'text', r => r.v?.availability || ''], ['extractor', 'Extractor', 'text', r => r.v?.extractor || ''],
      ['evidence', 'Evidence', 'text', r => (r.v?.evidence || []).map(e => e.kind === 'text' ? `p. ${e.page}` : e.kind === 'file' ? `${String(e.path || '').split('/').pop()}${e.locator?.sheet ? ` ${e.locator.sheet}!${e.locator.cell || ''}` : ''}` : e.kind).join('; ')],
      ['source', 'Source', 'text', r => r.v?.source || ''], ['at', 'Recorded', 'text', r => r.v?.at || ''],
    ]) };
  }
  if (from === 'dataset') {
    const d = findDataset(q.dataset, s) || (q.dataset == null || q.dataset === '' ? datasets(s)[0] : null);
    if (!d) fail(q.dataset ? `No dataset "${q.dataset}". Datasets: ${datasets(s).map(x => x.name).join(', ') || 'none'}` : 'No datasets in the project');
    const rows = d.rows.map((r, i) => ({ r, i }));
    const own = d.columns.map(c => ({ id: c.id, label: c.label, type: c.type === 'number' || c.type === 'integer' ? 'number' : 'text',
      get: r => c.type === 'number' || c.type === 'integer' ? datasetCell(r.r[c.id], c.type) : (r.r[c.id] === '' || r.r[c.id] == null ? null : String(r.r[c.id])) }));
    return { rows, refOf: () => null, cols: [...own, ...simpleColumns([['row', 'Row', 'number', r => r.i + 1]]).filter(c => !own.some(o => o.id === c.id))] };
  }
  if (from === 'analyses') {
    // Analyses kept from the Datasets view's Analyse page (lib/dataset-analysis.mjs).
    const rows = savedAnalyses(s).map(a => ({ a, d: sourceById(a.datasetId, s) }));
    return { rows, refOf: () => null, cols: simpleColumns([['dataset', 'Dataset', 'text', r => r.d?.name || ''], ['analysis', 'Analysis', 'text', r => r.a.result?.title || r.a.kind],
      ['sentence', 'Result', 'text', r => r.a.result?.sentence || ''], ['method', 'Method', 'text', r => r.a.method || r.a.result?.method || ''],
      ['n', 'n', 'number', r => r.a.result?.n?.used ?? null], ['kept', 'Kept', 'text', r => r.a.at || ''], ['stale', 'Data changed since', 'text', r => isStale(r.a, s) ? 'yes' : 'no']]) };
  }
  if (from === 'patients') {
    // Patient data: one row per patient, the study's own fields beside the patient's columns.
    const rows = (s.participants || []).filter(p => !inCollection || (p.study_id && inCollection.has(p.study_id))).map(p => ({ p, paper: byId.get(p.study_id) || null }));
    const own = (s.ipdColumns || []).map(c => ({ id: c.id, label: c.name || c.id, type: c.type === 'number' || c.type === 'boolean' ? 'number' : 'text',
      get: r => { const v = r.p[c.id]; if (v == null || v === '') return null; return c.type === 'number' || c.type === 'boolean' ? toNumber(v) : String(v); }, aliases: c.id === 'label' ? ['patient'] : [] }));
    const fixed = simpleColumns([['study', 'Study', 'text', r => r.paper?.label || r.paper?.title || '', ['report', 'study label']], ['study_id', 'Record ID', 'text', r => r.p.study_id || ''],
      ['first_author', 'First author', 'text', r => { const a = authorName((r.paper?.authors || [])[0] || ''); return a.includes(',') ? a.split(',')[0].trim() : a.split(/\s+/).at(-1) || ''; }],
      ['doi', 'DOI', 'text', r => r.paper?.doi || ''], ['journal', 'Journal', 'text', r => r.paper?.journal || ''],
      ['source_row', 'Source row', 'number', r => r.p.src?.row ?? null]]);
    const taken = new Set(own.map(c => c.id));
    return { rows, refOf: r => r.p.study_id, cols: [...own, ...fixed.filter(c => !taken.has(c.id))] };
  }
  if (from === 'screening') {
    const rows = (s.papers || []).filter(keep).map(p => ({ p, ta: s.screening?.[p.id] || {}, ft: s.fulltext?.[p.id] || {} }));
    return { rows, refOf: r => r.p.id, cols: [...recordColumns(s).filter(c => ['id', 'label', 'title', 'year', 'collection'].includes(c.id)), ...simpleColumns([
      ['ta_decision', 'Title/abstract decision', 'text', r => r.ta.decision || 'undecided', ['ta']], ['ta_reason', 'Title/abstract reason', 'text', r => r.ta.reason || ''],
      ['ta_by', 'Title/abstract reviewer', 'text', r => r.ta.by || ''], ['ft_decision', 'Full-text decision', 'text', r => r.ft.decision || (r.ta.decision === 'include' ? 'undecided' : ''), ['ft']],
      ['ft_reason', 'Full-text reason', 'text', r => r.ft.reason || ''], ['ft_by', 'Full-text reviewer', 'text', r => r.ft.by || ''],
      ['decision', 'Decision', 'text', r => (r.ft.decision || r.ta.decision || 'undecided')],
    ])] };
  }
  if (from === 'collections') {
    const all = s.collections || [], byC = new Map(all.map(c => [c.id, c]));
    return { rows: all.map(c => ({ c })), refOf: r => (r.c.members || []), cols: simpleColumns([
      ['name', 'Collection', 'text', r => r.c.name, ['collection']], ['parent', 'Parent', 'text', r => byC.get(r.c.parent)?.name || ''],
      ['members', 'Members', 'number', r => (r.c.members || []).length, ['count']], ['id', 'Collection ID', 'text', r => r.c.id],
    ]) };
  }
  if (from === 'searches') return { rows: (s.searches || []).map(x => ({ x })), refOf: () => null, cols: simpleColumns([
    ['source', 'Source', 'text', r => r.x.source || ''], ['kind', 'Kind', 'text', r => r.x.kind || ''], ['query', 'Query', 'text', r => r.x.query || ''],
    ['date', 'Date', 'text', r => String(r.x.date || r.x.at || '').slice(0, 10)], ['total', 'Records found', 'number', r => toNumber(r.x.total)],
    ['retrieved', 'Records retrieved', 'number', r => toNumber(r.x.retrieved ?? r.x.count)], ['status', 'Status', 'text', r => r.x.status || ''],
  ]) };
  if (from === 'appraisal') {
    const rows = [];
    for (const [pid, a] of Object.entries(s.assessments || {})) {
      if (!byId.has(pid) || !keep(byId.get(pid))) continue;
      const judged = j => typeof j === 'object' ? j?.judgement || j?.value || '' : j;
      // As the Appraisal view keeps them: one object of domain judgements per
      // instrument (assessments[paper][tool][domain]). A record from before
      // instruments holds its judgements flat, or as { tool, domains }.
      if (a.domains || a.judgements) {
        const tool = a.tool || 'rob2';
        for (const [d, j] of Object.entries(a.domains || a.judgements)) rows.push({ pid, tool, domain: d, judgement: judged(j) });
        if (a.overall) rows.push({ pid, tool, domain: 'overall', judgement: judged(a.overall) });
        continue;
      }
      for (const [k, v] of Object.entries(a || {})) {
        if (k === 'tool') continue;
        if (v && typeof v === 'object' && !('judgement' in v) && !('value' in v)) { for (const [d, j] of Object.entries(v)) rows.push({ pid, tool: k, domain: d, judgement: judged(j) }); }
        else rows.push({ pid, tool: a.tool || 'rob2', domain: k, judgement: judged(v) });
      }
    }
    return { rows, refOf: r => r.pid, cols: simpleColumns([['study', 'Study', 'text', r => label(r.pid)], ['id', 'Record ID', 'text', r => r.pid],
      ['tool', 'Tool', 'text', r => r.tool], ['domain', 'Domain', 'text', r => r.domain], ['judgement', 'Judgement', 'text', r => String(r.judgement || '')]]) };
  }
  if (from === 'assessments') {
    const rows = assessmentRows(s).filter(r => !inCollection || inCollection.has(r.paperId));
    const items = itemColumns(rows).map(c => ({ id: c.id.toLowerCase(), label: c.short, type: 'text', get: r => r.byShort[c.short] || null }));
    const cols = simpleColumns([['study', 'Study', 'text', r => r.study, ['label']], ['id', 'Record ID', 'text', r => r.paperId], ['tool', 'Tool', 'text', r => r.toolName], ['design', 'Design', 'text', r => r.design]]);
    const tail = simpleColumns([['met', 'Items met', 'number', r => r.met], ['applicable', 'Items applicable', 'number', r => r.applicable], ['pct', 'Proportion met (%)', 'number', r => r.pct == null ? null : Math.round(r.pct * 10) / 10],
      ['overall', 'Overall', 'text', r => r.overall || null], ['grade', 'Risk of bias', 'text', r => r.grade || null, ['grade', 'risk of bias']]]);
    return { rows, refOf: r => r.paperId, cols: [...cols, ...items, ...tail] };
  }
  if (from === 'analysis') {
    const a = s.analysis, list = a ? [a, ...(Array.isArray(a.outcomes) ? a.outcomes : [])] : [];
    const rows = list.flatMap(x => { const r = x?.result || x?.results || x; return r && (r.estimate != null || r.est != null || r.b != null) ? [{ x, r }] : []; });
    return { rows, refOf: () => null, cols: simpleColumns([
      ['outcome', 'Outcome', 'text', r => r.x.outcome || r.x.name || 'Primary outcome'], ['measure', 'Measure', 'text', r => r.x.measure || ''],
      ['estimate', 'Estimate', 'number', r => toNumber(r.r.estimate ?? r.r.est ?? r.r.b)], ['lo', 'Lower 95% CI', 'number', r => toNumber(r.r.lo ?? r.r.ci_lb)],
      ['hi', 'Upper 95% CI', 'number', r => toNumber(r.r.hi ?? r.r.ci_ub)], ['k', 'Studies', 'number', r => toNumber(r.r.k)], ['i2', 'I²', 'number', r => toNumber(r.r.I2 ?? r.r.i2)],
      ['model', 'Model', 'text', r => r.x.model || r.x.method || ''],
    ]) };
  }
  if (from === 'criteria') return { rows: (s.protocol?.criteria || []).map(c => ({ c })), refOf: () => null, cols: simpleColumns([
    ['id', 'Criterion ID', 'text', r => r.c.id || ''], ['kind', 'Kind', 'text', r => r.c.kind || ''], ['stage', 'Stage', 'text', r => r.c.stage || ''],
    ['text', 'Criterion', 'text', r => r.c.text || '', ['criterion']], ['question', 'Tested statement', 'text', r => r.c.question || ''],
  ]) };
  // runs
  const flows = new Map((s.workflows || []).map(f => [f.id, f]));
  return { rows: (s.workflowRuns || []).map(r => ({ r })), refOf: () => null, cols: simpleColumns([
    ['workflow', 'Workflow', 'text', x => flows.get(x.r.flowId)?.name || x.r.name || ''], ['number', 'Run', 'number', x => x.r.number || null],
    ['status', 'Status', 'text', x => x.r.status || ''], ['trigger', 'Trigger', 'text', x => x.r.trigger || 'manual'],
    ['at', 'Started', 'text', x => x.r.at || ''], ['error', 'Error', 'text', x => String(x.r.error || '').slice(0, 200)],
  ]) };
}

/** Members of a collection named by id or name, its descendants included. */
export function collectionMembers(s, ref) {
  const all = s.collections || [], r = norm(ref);
  const c = all.find(x => x.id === ref) || all.find(x => norm(x.name) === r);
  if (!c) fail(`Unknown collection "${ref}". Collections: ${all.map(x => x.name).join(', ') || 'none'}`);
  const ids = new Set(), walk = id => { const x = all.find(y => y.id === id); if (!x) return; (x.members || []).forEach(m => ids.add(m)); all.filter(y => y.parent === id).forEach(y => walk(y.id)); };
  walk(c.id);
  return ids;
}

// ---- column references ------------------------------------------------------------
// Names resolve in tiers, first match wins: an exact id; a label of the table
// the query reads ("Study" is that table's Study column); a record column
// ("Year", "Study label", "collection"); the table's short ids
// ("follow_up_mo"); then other tables and aliases ("study" for the record label).
function resolver(cols, mainTable = null) {
  const byKey = new Map();
  const add = (k, c) => { const n = norm(k); if (n && !byKey.has(n)) byKey.set(n, c); };
  const exact = new Map(cols.map(c => [c.id, c]));
  const main = cols.filter(c => c.table && c.table === mainTable), record = cols.filter(c => !c.table), rest = cols.filter(c => c.table && c.table !== mainTable);
  for (const c of main) add(c.label, c);
  for (const c of record) { add(c.id, c); add(c.label, c); }
  for (const c of main) add(c.short, c);
  for (const c of rest) { add(c.label, c); add(c.short, c); }
  for (const c of cols) for (const a of c.aliases || []) add(a, c);
  return ref => {
    if (exact.has(String(ref))) return exact.get(String(ref));
    const c = byKey.get(norm(ref));
    if (c) return c;
    const q = squash(ref), near = [...new Set(cols.filter(x => { const l = squash(x.label); return q && l && (l.includes(q) || q.includes(l) || distance(l, q) <= 2); }).map(x => x.label))].slice(0, 5);
    const names = [...new Set(cols.map(x => x.label))];
    fail(`Unknown column "${ref}".${near.length ? ` Did you mean: ${near.map(x => `"${x}"`).join(', ')}?` : ''} Columns: ${names.slice(0, 40).join(', ')}${names.length > 40 ? ', …' : ''}`);
  };
}

// ---- where ----------------------------------------------------------------------
const OP_RE = /\s+is\s+not\s+empty\s*$|\s+is\s+empty\s*$|\s+not\s+empty\s*$|\s+in\s+|>=|<=|!=|!~|=|~|>|</i;
const SYMBOL_OP = />=|<=|!=|!~|=|~|>|</;
const WORD_OP = /\s+is\s+not\s+empty\s*$|\s+is\s+empty\s*$|\s+not\s+empty\s*$|\s+in\s+/i;
/**
 * A string split at a separator outside parentheses and double quotes, so
 * column labels such as "Confounding factors (smoking, osteoporosis, BMI)"
 * or a quoted "Age; sex" stay whole.
 */
export function splitTop(str, sep) {
  const out = []; let depth = 0, quoted = false, cur = '';
  for (const ch of String(str)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && !depth && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
const unquote = t => /^".*"$/.test(t) ? t.slice(1, -1) : t;
/** Where a condition's operator is: after a quoted column; else a symbol (Change in BMI>2 is ">"); else a word operator. */
function opIn(t) {
  const q = /^\s*"[^"]*"/.exec(t);
  const from = q ? q[0].length : 0, rest = t.slice(from);
  const m = SYMBOL_OP.exec(rest) || WORD_OP.exec(rest) || OP_RE.exec(rest);
  return m && { index: m.index + from, 0: m[0] };
}
/** "Year>=2020; Design~cohort; Deformity share is not empty" or a list of { col, op, value } / [col, op, value]. */
export function parseWhere(where) {
  if (where == null || where === '') return [];
  const list = typeof where === 'string' ? splitTop(where, ';') : Array.isArray(where) && where.length && !Array.isArray(where[0]) && typeof where[0] !== 'object' ? [where] : Array.isArray(where) ? where : [where];
  return list.map(w => {
    if (Array.isArray(w)) return check({ col: w[0], op: w[1], value: w[2] });
    if (w && typeof w === 'object') return check({ col: w.col ?? w.column, op: w.op ?? '=', value: w.value ?? w.values });
    const t = String(w), m = opIn(t);
    if (!m) fail(`Cannot read the condition "${t}". Write column, operator, value: "Year>=2020", "Design~cohort", "collection in Table 1|Table 2", "Deformity share is not empty".`);
    const opText = m[0].trim().toLowerCase().replace(/\s+/g, ' ');
    const op = opText === 'is empty' ? 'empty' : opText === 'is not empty' || opText === 'not empty' ? 'not empty' : opText;
    return check({ col: unquote(t.slice(0, m.index).trim()), op, value: unquote(t.slice(m.index + m[0].length).trim()) });
  });
  function check(c) {
    if (!c.col) fail('A condition names no column.');
    const op = c.op === 'contains' ? '~' : c.op === '==' ? '=' : c.op === '<>' ? '!=' : c.op === 'not contains' ? '!~' : c.op === 'is empty' ? 'empty' : c.op === 'is not empty' ? 'not empty' : c.op;
    if (!OPS.includes(op)) fail(`Unknown operator "${c.op}". Operators: ${OPS.join(' ')}`);
    return { col: String(c.col), op, value: c.value };
  }
}
function matches(v, op, want) {
  if (op === 'empty') return isEmpty(v);
  if (op === 'not empty') return !isEmpty(v);
  const vals = Array.isArray(v) ? v : [v];
  if (op === 'in') { const set = (Array.isArray(want) ? want : String(want ?? '').split('|')).map(norm); return vals.some(x => set.includes(norm(x))); }
  if (op === '=' || op === '!=') {
    if (op === '!=' && (want === '' || want == null)) return !isEmpty(v);
    const w = norm(want), wn = toNumber(want);
    const eq = vals.some(x => (wn != null && toNumber(x) === wn) || norm(x) === w);
    return op === '=' ? eq : !eq;
  }
  if (op === '~' || op === '!~') { const has = vals.some(x => norm(x).includes(norm(want))); return op === '~' ? has : !has; }
  const a = toNumber(Array.isArray(v) ? v[0] : v), b = toNumber(want);
  if (a == null || b == null) return false;
  return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
}

// ---- aggregates ---------------------------------------------------------------------
/** "count", "mean(Follow-up (mo))", { fn: 'max', col: 'Year', as: 'Latest' }. */
export function parseAggregate(a) {
  if (a && typeof a === 'object') { const fn = String(a.fn || a.op || '').toLowerCase(); if (!AGGREGATES.includes(fn)) fail(`Unknown aggregate "${a.fn}". Aggregates: ${AGGREGATES.join(', ')}`); return { fn, col: a.col ?? a.column ?? null, as: a.as || a.label || null }; }
  const t = String(a || '').trim(), m = /^([a-z_]+)\s*(?:\((.*)\))?(?:\s+as\s+(.+))?$/i.exec(t);
  if (!m || !AGGREGATES.includes(m[1].toLowerCase())) fail(`Cannot read the aggregate "${t}". Write count, count(Column), count_distinct(Study), sum/mean/median/min/max(Column) or list(Column).`);
  return { fn: m[1].toLowerCase(), col: m[2]?.trim() || null, as: m[3]?.trim() || null };
}
const median = xs => { const v = [...xs].sort((a, b) => a - b), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };
const round = x => x == null ? null : Math.round(x * 1e6) / 1e6;
function aggregate(fn, vals) {
  if (fn === 'count') return vals.filter(v => !isEmpty(v)).length;
  if (fn === 'count_distinct') return new Set(vals.filter(v => !isEmpty(v)).map(v => norm(text(v)))).size;
  if (fn === 'list') { const seen = new Map(); for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) if (!isEmpty(x) && !seen.has(norm(x))) seen.set(norm(x), String(x)); return [...seen.values()].join('; '); }
  const xs = vals.map(toNumber).filter(x => x != null);
  if (!xs.length) return null;
  if (fn === 'sum') return round(xs.reduce((a, b) => a + b, 0));
  if (fn === 'mean') return round(xs.reduce((a, b) => a + b, 0) / xs.length);
  if (fn === 'median') return round(median(xs));
  if (fn === 'min') return Math.min(...xs);
  return Math.max(...xs);
}

// ---- sort ------------------------------------------------------------------------
export function parseSort(sort) {
  if (sort == null || sort === '') return [];
  const list = typeof sort === 'string' ? splitTop(sort, ',') : Array.isArray(sort) ? sort : [sort];
  return list.filter(x => x != null && x !== '').map(x => typeof x === 'object' ? { col: String(x.col ?? x.column), desc: x.desc === true || /^desc/i.test(x.dir || '') }
    : String(x).startsWith('-') ? { col: unquote(String(x).slice(1).trim()), desc: true } : { col: unquote(String(x).replace(/\s+(asc|desc)$/i, '').trim()), desc: /\s+desc$/i.test(String(x)) });
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareCells(a, b) {
  const ea = isEmpty(a), eb = isEmpty(b);
  if (ea || eb) return ea - eb;            // empty last, whichever direction
  const na = toNumber(Array.isArray(a) ? a[0] : a), nb = toNumber(Array.isArray(b) ? b[0] : b);
  if (na != null && nb != null) return na - nb;
  return collator.compare(text(a), text(b));
}

// ---- the query ---------------------------------------------------------------------
const listOf = x => x == null || x === '' ? [] : Array.isArray(x) ? x : typeof x === 'string' ? splitTop(x, ',').map(unquote) : [x];
/** Accepts snake_case aliases, which models write as often as camelCase. */
export function normalizeQuery(q = {}) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) fail('A query is an object, e.g. { "from": "studies", "select": ["Study", "Year"] }.');
  const known = new Set(['from', 'template', 'collection', 'dataset', 'scope', 'select', 'where', 'groupBy', 'group_by', 'aggregate', 'aggregates', 'sort', 'order_by', 'orderBy', 'limit', 'offset']);
  const unknown = Object.keys(q).filter(k => !known.has(k));
  if (unknown.length) fail(`Unknown query key${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `"${k}"`).join(', ')}. Keys: from, template, collection, dataset, scope, select, where, groupBy, aggregate, sort, limit, offset.`);
  return { from: q.from || 'studies', template: q.template ?? null, collection: q.collection ?? null, dataset: q.dataset ?? null, scope: q.scope === 'all' ? 'all' : 'included',
    select: listOf(q.select), where: q.where ?? null, groupBy: listOf(q.groupBy ?? q.group_by), aggregate: listOf(q.aggregate ?? q.aggregates),
    sort: q.sort ?? q.orderBy ?? q.order_by ?? null, limit: q.limit, offset: q.offset };
}

/**
 * Runs a query. `opts.limit` caps the rows returned (default all, at most
 * LIMIT unless opts.all); `refs` are the record ids behind each row, for
 * hover cards and "open these studies".
 */
export function runQuery(s, query, opts = {}) {
  const q = normalizeQuery(query);
  const src = source(s, q), col = resolver(src.cols, src.table?.id), notes = [];
  const where = parseWhere(q.where).map(w => ({ ...w, c: col(w.col) }));
  let rows = src.rows.filter(r => where.every(w => matches(w.c.get(r), w.op, w.value)));
  // A list column filtered by = or in keeps only the values asked for: a study
  // in Table 1 and Table 5, asked for Tables 1–4, counts under Table 1 only.
  const narrowed = new Map();
  for (const w of where) if (w.c.type === 'list' && (w.op === '=' || w.op === 'in')) {
    const want = (w.op === 'in' ? (Array.isArray(w.value) ? w.value : String(w.value ?? '').split('|')) : [w.value]).map(norm);
    const base = narrowed.get(w.c.id)?.get || w.c.get;
    narrowed.set(w.c.id, { ...w.c, get: r => base(r).filter(x => want.includes(norm(x))) });
  }
  const colOf = ref => { const c = col(ref); return narrowed.get(c.id) || c; };
  const nonNumeric = new Map();
  const noteNumber = (c, v) => { if (!isEmpty(v) && toNumber(Array.isArray(v) ? null : v) == null) { const l = nonNumeric.get(c.label) || []; if (l.length < 200) l.push(text(v)); nonNumeric.set(c.label, l); } };
  let columns, out, refs;
  if (q.groupBy.length || q.aggregate.length) {
    const keys = q.groupBy.map(colOf);
    const aggs = (q.aggregate.length ? q.aggregate : ['count']).map(parseAggregate).map(a => ({ ...a, c: a.col ? colOf(a.col) : null }));
    const groups = new Map();
    for (const r of rows) {
      // A list column (collection) puts the row in each of its values.
      let combos = [[]];
      for (const k of keys) { const v = k.get(r), vs = Array.isArray(v) ? (v.length ? v : [null]) : [v]; combos = combos.flatMap(c => vs.map(x => [...c, isEmpty(x) ? null : x])); }
      for (const c of combos) { const id = JSON.stringify(c.map(x => x == null ? null : norm(x))); if (!groups.has(id)) groups.set(id, { key: c, rows: [] }); groups.get(id).rows.push(r); }
    }
    columns = [...keys.map(k => ({ id: k.id, label: k.label, type: k.type === 'list' ? 'text' : k.type })),
      ...aggs.map(a => ({ id: a.col ? `${a.fn}_${a.c.id}` : a.fn, label: a.as || (a.col ? `${cap(a.fn.replace('_', ' '))} ${a.c.label}` : a.fn === 'count' ? 'Count' : cap(a.fn)), type: a.fn === 'list' ? 'text' : 'number', aggregate: a.fn }))];
    out = []; refs = [];
    for (const g of groups.values()) {
      out.push([...g.key.map(x => x == null ? '' : x), ...aggs.map(a => {
        if (a.fn === 'count' && !a.c) return g.rows.length;
        const vals = g.rows.map(r => a.c.get(r));
        if (!['count', 'count_distinct', 'list'].includes(a.fn)) vals.forEach(v => noteNumber(a.c, v));
        return aggregate(a.fn, vals);
      })]);
      refs.push([...new Set(g.rows.flatMap(r => [src.refOf(r)].flat()).filter(Boolean))]);
    }
  } else {
    const picked = (q.select.length ? q.select : defaultSelect(q.from, src)).map(x => typeof x === 'object' && x ? { c: colOf(x.col ?? x.column), as: x.as || x.label } : { c: colOf(x) });
    columns = picked.map(({ c, as }) => ({ id: c.id, label: as || c.label, type: c.type }));
    out = rows.map(r => picked.map(({ c }) => c.get(r) ?? ''));
    refs = rows.map(r => [src.refOf(r)].flat().filter(Boolean));
  }
  // Sort by result columns (label or id), or by a source column when rows are not grouped.
  const order = parseSort(q.sort).map(o => {
    const i = columns.findIndex(c => norm(c.label) === norm(o.col) || norm(c.id) === norm(o.col));
    if (i < 0) fail(`Sort by "${o.col}": not a column of the result. Result columns: ${columns.map(c => c.label).join(', ')}`);
    return { i, desc: o.desc };
  });
  if (order.length) {
    const idx = out.map((_, i) => i).sort((a, b) => { for (const o of order) { const d = compareCells(out[a][o.i], out[b][o.i]); if (d) return o.desc && !isEmpty(out[a][o.i]) && !isEmpty(out[b][o.i]) ? -d : d; } return a - b; });
    out = idx.map(i => out[i]); refs = idx.map(i => refs[i]);
  }
  for (const [label, vals] of nonNumeric) notes.push(`${vals.length} value${vals.length === 1 ? '' : 's'} of ${label} not read as a number: ${[...new Set(vals)].slice(0, 6).map(v => `"${v.replace(/\s+/g, ' ').slice(0, 30)}"`).join(', ')}${new Set(vals).size > 6 ? ', …' : ''}`);
  const total = out.length, offset = Math.max(0, Math.floor(Number(q.offset ?? opts.offset) || 0));
  const cap0 = opts.all ? Infinity : LIMIT;
  // limit 0 asks for the count alone.
  const want = q.limit ?? opts.limit;
  const limit = Number(want) === 0 && want !== '' && want != null ? 0 : Math.max(1, Math.min(cap0, Math.floor(Number(want) || (opts.all ? Infinity : LIMIT))));
  return { columns, rows: out.slice(offset, offset + limit), refs: refs.slice(offset, offset + limit), total, offset,
    next_offset: limit && offset + limit < total ? offset + limit : null, notes, from: q.from, template: src.table ? { id: src.table.id, name: src.table.name } : null };
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
function defaultSelect(from, src) {
  if (from === 'studies' || from === 'records' || from === 'arms') {
    const own = src.cols.filter(c => c.table === src.table.id).slice(0, 6).map(c => c.id);
    return ['label', 'year', ...(from === 'arms' ? ['arm_label'] : []), ...own];
  }
  return src.cols.slice(0, 8).map(c => c.id);
}

// ---- describing the data ---------------------------------------------------------------
/**
 * What there is to query: sources, the tables and their columns (with fill,
 * distinct values, examples and how many read as numbers), built-in record
 * columns and collections. What a model reads before writing a query, so it
 * names columns that exist.
 */
export function describeData(s, { template = null, examples = 3 } = {}) {
  const inc = includedStudies(s), all = s.papers || [];
  const tables = tablesOf(s).filter(t => template == null || t === tableFor(s, template));
  const describeTable = t => {
    const cols = tableColumns(s, t).map(c => {
      const vals = inc.map(p => c.raw({ p, arm: null })).filter(Boolean).map(valueText).filter(x => x != null && x !== '');
      const numbers = vals.filter(v => toNumber(v) != null).length, distinct = new Set(vals.map(norm)).size;
      const ex = [...new Map(vals.map(v => [norm(v), v])).values()].slice(0, examples).map(v => v.replace(/\s+/g, ' ').slice(0, 60));
      return { id: c.id, label: c.label, type: c.type, filled: vals.length, distinct, numeric: numbers, examples: ex };
    }).filter(c => c.filled > 0 || t.id !== 'default');
    const armStudies = inc.filter(p => armsFor(s, t, p).length > 1).length;
    return { id: t.id, name: t.name, columns: cols, studies_with_arms: armStudies };
  };
  return {
    sources: SOURCES,
    counts: { records: all.length, included: inc.length, values: Object.keys(s.values || {}).length, collections: (s.collections || []).length, outputs: (s.outputs || []).length },
    default_template: tableFor(s, null).name,
    tables: tables.map(describeTable),
    record_columns: recordColumns(s).map(c => c.label),
    collections: (s.collections || []).map(c => ({ name: c.name, members: (c.members || []).length, included: (c.members || []).filter(m => inc.some(p => p.id === m)).length, ...(c.parent ? { parent: (s.collections || []).find(x => x.id === c.parent)?.name || c.parent } : {}) })),
    syntax: QUERY_SYNTAX,
  };
}

/** A result as a tab-separated block, capped, for tools that answer in text. */
export function resultText(r, { maxChars = 12000, cell = 160 } = {}) {
  const clean = v => text(v).replace(/[\t\n\r]+/g, ' ').slice(0, cell);
  const lines = [r.columns.map(c => c.label).join('\t')];
  let used = lines[0].length, shown = 0;
  for (const row of r.rows) { const l = row.map(clean).join('\t'); if (used + l.length + 1 > maxChars) break; lines.push(l); used += l.length + 1; shown++; }
  const more = r.offset + shown < r.total ? ` | next_offset ${r.offset + shown}` : '';
  return `${r.total} row${r.total === 1 ? '' : 's'}${shown ? ` | showing ${r.offset + 1}-${r.offset + shown}` : r.total ? ` | none shown from offset ${r.offset}` : ''}${more}${r.notes.length ? `\nnotes: ${r.notes.join(' | ')}` : ''}\n${lines.join('\n')}`;
}
