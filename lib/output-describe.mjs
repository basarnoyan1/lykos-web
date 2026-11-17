// A table or figure of the project in plain words, for its Details (views/outputs.mjs inspect): what it is, what it is drawn from and how
// many rows it reads now, what it shows and in what order, its filters, its notes, where the paper uses it, and when a file of it was last
// drawn and what changed since. Details showed the definition as JSON alone until 11 Nov 2026 (owner, on the sham review's Figure 2:
// "weird and not useful"); the JSON stays under the words for the people who edit it.
// Pure over the project and what the page knows of the output: the app, Node tests and any other reader share it. Nothing here throws on a
// definition that is half written (the Edit page's draft): what cannot be read is said in its row.
import { runQuery, parseWhere, parseSort, parseAggregate, normName } from './project-query.mjs';
import { lib_dates$when as when, lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";

/** A chart type as a person names it. */
export const CHART_WORDS = { bar: 'Bar chart', column: 'Column chart', stacked: 'Stacked bars', dot: 'Dot plot', forest: 'Forest plot', timeline: 'Timeline', heat: 'Heat map', pie: 'Pie chart',
  scatter: 'Scatter plot', funnel: 'Funnel plot', 'traffic-light': 'Risk-of-bias traffic light', 'rob-summary': 'Risk-of-bias summary' };
export const kindWords = spec => (spec?.kind === 'chart' ? CHART_WORDS[spec.chart?.type] || 'Chart' : 'Table');

// What a query reads, and what one row of it is: [name, one, many].
const SOURCE = {
  studies: ['The included studies', 'study', 'studies'], records: ['The library\'s records', 'record', 'records'], arms: ['Study arms', 'arm', 'arms'],
  values: ['Extracted values', 'value', 'values'], screening: ['Screening decisions', 'record', 'records'], collections: ['Collections', 'collection', 'collections'],
  searches: ['The search log', 'search', 'searches'], appraisal: ['Appraisal judgements', 'judgement', 'judgements'], assessments: ['Appraisal, a row per study and instrument', 'row', 'rows'],
  analysis: ['The saved analysis', 'pooled result', 'pooled results'], criteria: ['Eligibility criteria', 'criterion', 'criteria'], runs: ['Workflow runs', 'run', 'runs'],
  patients: ['Patient data', 'patient', 'patients'], dataset: ['A dataset', 'row', 'rows'], dependencies: ['The project\'s dependencies', 'dependency', 'dependencies'],
  certainty: ['Certainty, the GRADE outcomes', 'outcome', 'outcomes'], analyses: ['Analyses kept from datasets and patient data', 'analysis', 'analyses'],
  syntheses: ['Syntheses, Change: the pooled results', 'pooled result', 'pooled results'], effects: ['Syntheses, Change: the effects each synthesis pools', 'effect', 'effects'],
};
const OP = { '=': 'is', '!=': 'is not', '~': 'contains', '!~': 'does not contain', '>': 'is above', '<': 'is below', '>=': 'is at least', '<=': 'is at most', in: 'is one of', empty: 'is empty', 'not empty': 'is not empty' };
const AGG = { count: c => (c ? `count of ${c}` : 'count'), count_distinct: c => `distinct ${c}`, sum: c => `sum of ${c}`, mean: c => `mean of ${c}`, median: c => `median of ${c}`, min: c => `smallest ${c}`,
  max: c => `largest ${c}`, list: c => `list of ${c}`, tally: c => `each ${c} with its count` };
const and = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const arr = v => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const has = v => v != null && v !== '';
const base = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);
const tryOr = (fn, or) => { try { return fn(); } catch (e) { return typeof or === 'function' ? or(e) : or; } };
const row = (label, value) => ({ label, value: String(value) });
const datasetOf = (s, q) => (q.from === 'dataset' ? (s?.datasets || []).find(d => d.id === q.dataset || normName(d.name) === normName(q.dataset)) || null : null);

/** A query's conditions in words, one to an entry: ["Year is at least 2020", "Design contains cohort"]. */
export function filterWords(q = {}) {
  const out = [];
  if (has(q.collection)) out.push(`In the collection ${q.collection}`);
  if (q.from === 'studies' && q.scope === 'all') out.push('Every record, not only the included studies');
  const conds = tryOr(() => parseWhere(q.where).map(w => [w.col, OP[w.op] || w.op, ['empty', 'not empty'].includes(w.op) ? '' : arr(w.value).flatMap(v => String(v).split('|')).join(' or ')].filter(Boolean).join(' ')), has(q.where) ? [String(q.where)] : []);
  return [...out, ...conds];
}

/**
 * The rows the output reads now: { total (rows of its result), kept (rows of the source the filters keep), all (rows of the source), error }.
 * `known.total` is the result's count where the page has drawn it already; a count that is the same as another is not asked for twice
 * (a query over a review of 30,000 records takes a fifth of a second).
 */
export function rowCounts(s, q = {}, known = null) {
  const count = query => runQuery(s, { ...query, limit: 0, offset: 0 }).total;
  const src = { from: q.from, dataset: q.dataset, template: q.template, scope: q.scope };
  const grouped = arr(q.groupBy).length || arr(q.aggregate).length || q.total, filtered = has(q.where) || has(q.collection);
  try {
    const { limit, offset, ...whole } = q;
    const total = Number.isFinite(known?.total) ? known.total : count(whole), kept = grouped ? count({ ...src, collection: q.collection, where: q.where }) : total;
    return { total, kept, all: filtered ? count(src) : kept, error: '' };
  } catch (e) { return { total: null, kept: null, all: null, error: e.message }; }
}

// The Data rows: what it is drawn from, how many rows it reads now, its filters.
function dataRows(s, spec, result) {
  const q = spec.query || {}, from = q.from || 'studies', [name, one, many] = SOURCE[from] || [String(from), 'row', 'rows'], out = [];
  const d = datasetOf(s, q), tpl = has(q.template) && q.template !== 'default' ? (s?.templates || []).find(t => t.id === q.template || normName(t.name) === normName(q.template))?.name || q.template : '';
  out.push(row('Drawn from', from === 'dataset' ? `The dataset ${d?.name || q.dataset || ''}`.trim() : `${name}${tpl ? `, the extraction table ${tpl}` : ''}`));
  // a dataset says where it came from and when it was written
  if (d?.source?.file) out.push(row('Dataset from', d.source.file));
  if (d?.at) out.push(row('Dataset written', when(d.at)));
  const n = rowCounts(s, q, result), grouped = arr(q.groupBy).length || arr(q.aggregate).length, filtered = n.kept !== n.all;
  const read = n.error ? `Not read: ${n.error}` : `${filtered ? `${num(n.kept)} of ${plural(n.all, one, many)}` : plural(n.all, one, many)}${grouped ? `, as ${plural(n.total, 'row')}` : ''}`;
  out.push(row('Reads now', has(q.limit) && Number(q.limit) > 0 && n.total > Number(q.limit) ? `${read}; the first ${num(Number(q.limit))} are shown` : read));
  const filters = filterWords(q);
  out.push(row(filters.length > 1 ? 'Filters' : 'Filter', filters.length ? filters.join('; ') : 'None'));
  return out;
}

const SORT = { value: 'Smallest value first', '-value': 'Largest value first', label: 'By name', '-label': 'By name, from the end', none: 'As the data are ordered' };
const orderWords = q => tryOr(() => parseSort(q.sort).map(o => `${o.col}${o.desc ? ', largest first' : ''}`).join('; then '), has(q.sort) ? String(q.sort) : '');
// a chart's own fields in words, by type: [label, value] pairs of what is set
function chartRows(spec, columns) {
  const c = spec.chart || {}, t = c.type, out = [], add = (label, value) => { if (has(value)) out.push(row(label, value)); };
  const range = (lo, hi) => (has(lo) || has(hi) ? `${has(lo) ? `from ${lo}` : ''}${has(lo) && has(hi) ? ' ' : ''}${has(hi) ? `to ${hi}` : ''}` : '');
  if (t === 'forest') {
    add('Rows', has(c.x) ? `One per ${c.x}` : '');
    add('Estimate', has(c.y) ? `${c.y}${has(c.lo) && has(c.hi) ? `, with its interval from ${c.lo} to ${c.hi}` : ''}${has(c.decimals) ? `, to ${plural(Number(c.decimals), 'decimal place')}` : ''}` : '');
    add('Pooled rows', has(c.pooled) ? `Those marked in ${c.pooled}, drawn as diamonds` : '');
    add('Prediction interval', has(c.interval) ? `Rows marked in ${c.interval}${c.intervalInline ? ', drawn as a line through the diamond' : ', each a row of its own'}` : '');
    add('Weights', has(c.weight) ? `${c.weight}, as the size of each square` : '');
    add('Axis', [c.xLabel || c.y, c.log ? 'log scale' : '', range(c.xMin, c.xMax), has(c.ref) ? `line of no effect at ${c.ref}` : '', c.axisTitle === false ? 'no title under the axis' : ''].filter(Boolean).join(', '));
    add('Row heading', c.yLabel);
  } else if (t === 'scatter' || t === 'funnel') {
    add('Across', has(c.x) ? `${c.x}${c.xLabel && c.xLabel !== c.x ? ` (${c.xLabel})` : ''}${range(c.xMin, c.xMax) ? `, ${range(c.xMin, c.xMax)}` : ''}` : '');
    add('Up', has(c.y) ? `${c.y}${c.yLabel && c.yLabel !== c.y ? ` (${c.yLabel})` : ''}${range(c.yMin, c.yMax) ? `, ${range(c.yMin, c.yMax)}` : ''}` : '');
    add('Point size', c.weight);
    add('Fitted line', has(c.interval) ? `Rows marked in ${c.interval}${has(c.lo) && has(c.hi) ? `, its band from ${c.lo} to ${c.hi}` : ''}` : '');
    add(t === 'funnel' ? 'Pooled line' : 'Reference line', has(c.ref) ? `At ${c.ref}` : has(c.pooled) ? c.pooled : '');
  } else if (t === 'traffic-light' || t === 'rob-summary') {
    add('Studies', c.x);
    add('Domains', (columns || []).filter(l => normName(l) !== normName(c.x)).join(', '));
  } else if (t === 'heat') {
    add('Columns', c.x); add('Rows', c.y); add('Cells', c.value || 'Count of rows');
  } else if (CHART_WORDS[t]) {
    add(t === 'timeline' ? 'Along the line' : t === 'pie' ? 'Parts' : 'Categories', c.x);
    add('Values', c.y || 'Count of rows');
    add('Split by', c.series);
    add('Reference line', has(c.ref) ? `At ${c.ref}` : '');
    add('Axis labels', [c.xLabel, c.yLabel].filter(Boolean).join(', '));
  } else {
    // an addon's chart: the columns and options it was given, by their own names
    for (const [k, v] of Object.entries(c)) if (!['type', 'footer', 'widthIn', 'heightIn', 'page', 'sort'].includes(k)) add(k[0].toUpperCase() + k.slice(1), v);
  }
  return out;
}

// The Shows rows: columns or measures, grouping and order.
function showsRows(s, spec, known) {
  const q = spec.query || {}, out = [], chart = spec.kind === 'chart';
  const result = known?.columns || tryOr(() => runQuery(s, { ...q, limit: 1, offset: 0 }).columns.map(c => c.label), null);
  // the columns as the output draws them (lib/output-render.mjs renderOutput): those its definition lists, under the names it gives them and
  // without the hidden ones, else every column of the result but the one its tables or sections are split by
  const all = result || arr(q.select).map(String), listed = arr(spec.columns).filter(c => c?.col);
  const shown = listed.length ? listed.filter(c => !c.hidden).map(c => c.label || all.find(l => normName(l) === normName(c.col)) || String(c.col))
    : all.filter(l => !has(spec.groupRowsBy) || normName(l) !== normName(spec.groupRowsBy));
  if (chart) out.push(...chartRows(spec, shown));
  else out.push(row('Columns', shown.length ? shown.join(', ') : 'Every column of the source'));
  const by = arr(q.groupBy).map(String), aggs = tryOr(() => arr(q.aggregate).map(parseAggregate).map(a => a.as || (AGG[a.fn] || (c => `${a.fn} of ${c}`))(a.col || '')), arr(q.aggregate).map(String));
  if (by.length || aggs.length) out.push(row('Summarised', `${by.length ? `One row per ${and(by)}` : 'One row for all'}, with ${and(aggs.length ? aggs : ['count'])}`));
  if (q.total) out.push(row('Total', 'A total row at the foot'));
  if (has(spec.groupRowsBy)) out.push(row('Grouped', chart ? `A section per ${spec.groupRowsBy}${spec.chart?.groupOrder === 'rows' ? ', in the order of the data' : ''}` : `A table per ${spec.groupRowsBy}`));
  const order = [chart && has(spec.chart?.sort) ? SORT[spec.chart.sort] || String(spec.chart.sort) : '', orderWords(q) ? `By ${orderWords(q)}` : ''].filter(Boolean);
  out.push(row('Order', order.length ? order.join('; ') : 'As the data are ordered'));
  if (chart && (has(spec.chart?.widthIn) || has(spec.chart?.heightIn))) out.push(row('Size', [has(spec.chart.widthIn) ? `${spec.chart.widthIn} in wide` : '', has(spec.chart.heightIn) ? `${spec.chart.heightIn} in high at most` : ''].filter(Boolean).join(', ')));
  if (chart && has(spec.chart?.page)) out.push(row('Pages', `${spec.chart.page} rows to a page`));
  return out;
}

/**
 * Where the paper uses an output, each place once: the item of the paper it draws (`item`: { label, place }), the package parts and
 * manuscript blocks that hold it (`uses`, lib/results-registry.mjs usesOf), and the place the project's build gave it in the registered
 * manuscript (`built.place`: "Figure 2", "appendix"; `manuscript` the registered file).
 */
export function usedWords({ item = null, uses = [], built = null, manuscript = '' } = {}) {
  const out = [];
  if (item?.label) out.push(`${item.label}, ${item.place === 'supplement' ? 'supplement' : 'main text'}`);
  for (const u of uses || []) if (!out.includes(u)) out.push(u);
  const place = String(built?.place || '').trim();
  if (place && !out.some(x => x.startsWith(`${place},`))) out.push(`${/^appendix$/i.test(place) ? 'An appendix item' : place}${manuscript ? ` of ${base(manuscript)}` : ' of the registered manuscript'}`);
  return out;
}

/**
 * The rows on when a file of the output was last drawn and what changed since. `file` is the newest file of it in the folder ({ path, mtime }
 * in ms), null when there is none, undefined while the folder is being read; `after(iso)` is what the review wrote after a time
 * (lib/review-state.mjs writtenAfter: { changed, text }).
 */
export function drawnRows(s, spec, { entry = null, builtin = false, file, after = null, built = null } = {}) {
  const out = [], v = entry?.versions?.at(-1) || null;
  if (builtin) out.push(row('Definition', 'Built in'));
  else if (v) out.push(row('Definition', `Version ${v.n}, saved ${when(v.at)}${v.author && v.author !== 'You' ? ` by ${v.author}` : ''}`));
  if (v?.summary && v.n > 1) out.push(row('Last change', v.summary));
  if (file === undefined) { out.push(row('Last drawn', 'Reading the folder')); return out; }
  if (!file?.mtime) { out.push(row('Last drawn', 'No file of it in the folder; this page draws it from the data as they are now')); return out; }
  const at = new Date(file.mtime).toISOString(), d = datasetOf(s, spec.query || {}), since = [];
  out.push(row('Last drawn', `${when(at)}, ${base(file.path)}`));
  if (v?.at && String(v.at) > at) since.push(`Its definition was saved after (version ${v.n})`);
  if (d?.at && String(d.at) > at) since.push(`The dataset was written after (${when(d.at)})`);
  const wrote = !d && after ? after(at) : null;
  if (wrote?.changed) since.push(`${wrote.text} after`);
  out.push(row('Changed since', since.length ? since.join('; ') : d || after ? 'Nothing: the file shows the data as they are now' : 'Not known for this source'));
  if (has(built?.specVersion) && v && v.n !== Number(built.specVersion)) out.push(row('In the manuscript', `Drawn from version ${built.specVersion} of the definition; it is version ${v.n} now`));
  return out;
}

/**
 * The output in words: `[{ id, title, rows: [{ label, value }] } | { id, title, text }]`: what it is (`about`), its data (`data`), what it
 * shows (`shows`), its notes (`notes`, when it has any) and its state (`drawn`, for a saved or built-in output or a file found). `facts`: { entry, builtin, item, uses, built, manuscript,
 * file, after } as usedWords and drawnRows take them, and `result` ({ total, columns: [label] }) where the page has run the query already.
 */
export function describeOutput(s, spec, facts = {}) {
  if (!spec || typeof spec !== 'object') return [];
  const used = usedWords(facts), chart = spec.kind === 'chart';
  const out = [{ id: 'about', title: chart ? 'Figure' : 'Table', rows: [row('Type', kindWords(spec)), row('Title', spec.title || 'No title yet'),
    row('Used as', used.length ? used.join('; ') : 'Nothing the project records')] }];
  if (spec.query && typeof spec.query === 'object') out.push({ id: 'data', title: 'Data', rows: dataRows(s, spec, facts.result) }, { id: 'shows', title: 'Shows', rows: showsRows(s, spec, facts.result) });
  if (has(spec.notes)) out.push({ id: 'notes', title: chart ? 'Legend' : 'Notes', text: String(spec.notes) });
  // when it was drawn is said of a saved or built-in output, or of a file the page found: a draft has neither
  const drawn = facts.entry || facts.builtin || facts.file ? drawnRows(s, spec, facts) : [];
  if (drawn.length) out.push({ id: 'drawn', title: 'Drawn', rows: drawn });
  return out;
}
