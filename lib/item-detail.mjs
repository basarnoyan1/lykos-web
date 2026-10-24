// A table's or figure's details as the registry knows them (plan §2, "Submission files, structured: details"): how it was made and what it
// depends on, for the one detail pane Submission › Files and Tables and figures share (views/item-detail.mjs). Pure: the graph is the
// dependency graph (lib/deps-graph.mjs buildGraph, the one Changes › Dependencies draws), the rest is the project.
//
// - Made: where it comes from (the page that draws it, or a document it was read from), its method (an analysis's model and measure, a
//   chart's type and fields, the studies a filter kept), and its builds (version, day).
// - Depends on: the graph's nodes upstream of the item, grouped as the owner reads them (extraction fields and studies, analyses and
//   outcomes, appraisal, source files), then the works it cites; each with whether it changed since the item's last build and the page that
//   holds it.
const KIND_GROUP = { template: 'data', column: 'data', collection: 'data', record: 'data', count: 'counts', dataset: 'data', outcome: 'analyses', analysis: 'analyses',
  result: 'analyses', plan: 'analyses', grade: 'analyses', swim: 'analyses', file: 'files', script: 'files', output: 'outputs', block: 'outputs' };
export const DEPEND_GROUPS = Object.freeze([['data', 'Extraction fields and studies'], ['counts', 'Flow counts'], ['analyses', 'Analyses and outcomes'], ['appraisal', 'Appraisal'], ['files', 'Source files'],
  ['outputs', 'Tables and figures'], ['references', 'Studies it cites']]);
const VIEW_OF = { template: 'extraction', column: 'extraction', collection: 'library', record: 'library', dataset: 'extraction', outcome: 'analysis', analysis: 'analysis', result: 'analysis',
  plan: 'protocol', grade: 'certainty', swim: 'certainty', file: 'files', script: 'files', output: 'outputs', block: 'manuscript' };
const day = at => (at ? String(at).slice(0, 10) : '');

/** The graph's node of a package item. */
export const nodeOfItem = id => `output:package:${id}`;

/**
 * Its inputs, nearest first, grouped: `[{ id, title, rows: [{ id, label, kind, state ('changed' | 'current' | 'unknown'), why, go, path? }] }]`.
 * `reach` is lib/deps-graph.mjs reach(g, node, 'up'); `build` the last build of its part ({ at, sources }); `dataCurrent` whether the
 * drawing's data is what that build read (null: not drawn by the app, or never built); `cites` its works ([{ key, label }]).
 */
export function dependsOn(reach = [], { build = null, dataCurrent = null, cites = [] } = {}) {
  const built = build?.at ? Date.parse(build.at) : null, groups = new Map(DEPEND_GROUPS.map(([id, title]) => [id, { id, title, rows: [] }]));
  for (const { node: n } of reach) {
    if (!n || n.kind === 'output' && /^output:part:/.test(n.id)) continue;
    const group = n.id === 'dataset:appraisal' || /appraisal|rob/i.test(n.id) ? 'appraisal' : KIND_GROUP[n.kind] || 'data';
    let state = 'unknown', why = '';
    // an input of an item the app never built has nothing to be compared with: no state (an imported evidence table is not built)
    if (!built) { state = 'none'; why = ''; }
    else if (n.kind === 'file' || n.kind === 'script') {
      if (Number.isFinite(n.mtime)) { state = n.mtime > built ? 'changed' : 'current'; why = state === 'changed' ? 'Changed since the build' : 'As built'; }
    } else if (n.kind === 'analysis' && n.stale) { state = 'changed'; why = 'Run again since the build'; }
    else if (dataCurrent != null) { state = dataCurrent ? 'current' : 'changed'; why = dataCurrent ? 'Current' : 'Changed since this was made'; }
    const path = n.kind === 'file' || n.kind === 'script' ? n.id.slice(n.id.indexOf(':') + 1) : '';
    groups.get(group).rows.push({ id: n.id, label: n.label, kind: n.kind, state, why, go: n.view || VIEW_OF[n.kind] || '', ...(path ? { path } : {}) });
  }
  // a work it cites is a reference, not data the build read: it carries no state
  // the works it cites are the studies it draws on: under the extraction table they come from when it reads one, else a group of their own
  const studies = cites.map(c => ({ id: `ref:${c.key}`, label: c.label, kind: 'record', state: 'none', why: '', go: 'library', key: c.key, paper: c.paper || null }));
  const data = groups.get('data');
  if (data.rows.some(r => r.kind === 'template')) data.rows.push(...studies.map(r => ({ ...r, depth: 1 })));
  else groups.get('references').rows.push(...studies);
  return [...groups.values()].filter(g => g.rows.length);
}

/**
 * How it was made: `[{ label, value }]` rows. `item` the package item; `drawer` the app's drawing it is ({ view, title } of lib/app-items.mjs
 * appItems), `analysis` (lib/outcomes.mjs analysisOf, for a forest), `spec` (an output's current spec), `origin` (lib/results-registry.mjs
 * outputOrigin's words), `builds` its part's builds, `part` its part.
 */
/**
 * A synthesis in the reader's terms, from its record (lib/synth-project.mjs synthesisModel): what was compared, on which outcome and how
 * defined, in which studies, by which measure and model, by what. `rec` the combination's record (or `effects`, a SWiM sheet's data);
 * `definition` the outcome's definition (lib/synth-figures.mjs outcomeDefinition). No internal ids.
 */
const MEASURE = { RR: 'Risk ratio', OR: 'Odds ratio', RD: 'Risk difference', MD: 'Mean difference', SMD: 'Standardized mean difference' };
export function synthesisFacts({ rec = null, effects = null, definition = '' } = {}) {
  const out = [];
  if (effects) {
    out.push({ label: 'Grouping', value: effects.name || 'Effect direction' }, { label: 'Outcomes', value: (effects.outcomes || []).join(', ') },
      { label: 'Metric', value: 'Direction of effect per study and outcome' }, { label: 'Method', value: 'Synthesis without meta-analysis (SWiM), vote counting by direction' },
      { label: 'Test', value: 'Sign test per outcome' });
    return out;
  }
  if (!rec) return out;
  const m = /\(([A-Z]{2,3}),\s*([^,)]+?)(?:,\s*([^)]+))?\)/.exec(rec.method || ''), measure = rec.family === 'Proportions' ? 'Pooled proportion' : MEASURE[m?.[1]] || m?.[1] || '';
  out.push({ label: 'Outcome', value: rec.outcome });
  if (definition) out.push({ label: 'Definition', value: definition.replace(/^.+? was defined as /, '').replace(/\.$/, '').replace(/^./, c => c.toUpperCase()) });
  out.push({ label: 'Comparison', value: rec.grouping });
  const names = rec.names || [], missing = rec.notReported || [];
  out.push({ label: 'Studies', value: `${rec.kEst ?? names.length - missing.length} of ${rec.kTotal ?? names.length} with data${rec.patients ? `, ${rec.patients} patients` : ''}` });
  if (missing.length) out.push({ label: 'Not reported', value: missing.join(', ') });
  if (rec.events) out.push({ label: 'Events', value: rec.events });
  if (measure) out.push({ label: 'Effect measure', value: measure });
  if (rec.family === 'Proportions') out.push({ label: 'Model', value: 'Random effects, Freeman–Tukey double arcsine; exact intervals per arm' });
  else if (m) out.push({ label: 'Model', value: `${/random/i.test(m[2]) ? 'Random effects' : 'Fixed effect'} (${(m[3] || 'REML').trim()}), ${/IV/.test(m[2]) ? 'inverse variance' : m[2].trim()}; Wald intervals` });
  if (rec.pool && Number.isFinite(rec.pool.rr)) out.push({ label: 'Result', value: `${m?.[1] || 'RR'} ${rec.pool.rr.toFixed(2)} (${rec.pool.lo.toFixed(2)} to ${rec.pool.hi.toFixed(2)}), I² ${Math.round(rec.pool.I2 ?? 0)}%` });
  // the verdict's reasons are the quality checks beside it; here the word
  if (rec.verdict) out.push({ label: 'Verdict', value: rec.verdict });
  return out;
}

export function madeOf({ item = {}, drawer = null, analysis = null, spec = null, origin = '', builds = [], part = null, synth = null, facts = [], printed = '', matched = null } = {}) {
  const src = item.source || {}, out = [];
  if (src.app) out.push({ label: 'Source', value: origin || (drawer ? `Drawn by ${drawer.view}` : 'Drawn by the app; its source is gone') });
  else if (src.held || src.path) out.push({ label: 'Source', value: String(src.from || src.path || '').split('/').pop() || 'Kept in the project' });
  // a printed item set against the app: how many of the studies it names the app holds (`matched` { n, of })
  if (matched && matched.of) out.push({ label: 'Checked against', value: `Extraction, ${matched.n === matched.of ? '' : `${matched.n} of `}${matched.of} ${matched.of === 1 ? 'study' : 'studies'}` });
  else if (src.evidence) out.push({ label: 'Source', value: 'Extraction, the evidence table' });
  else if (src.generated) out.push({ label: 'Source', value: 'Written by the app' });
  if (analysis) {
    if (analysis.outcomeName) out.push({ label: 'Outcome', value: analysis.outcomeName });
    if (analysis.measure) out.push({ label: 'Effect measure', value: MEASURE[analysis.measure] || analysis.measure });
    if (analysis.method) out.push({ label: 'Model', value: `${analysis.method === 'FE' ? 'Fixed effect' : `Random effects (${analysis.method})`}` });
    out.push({ label: 'Software', value: analysis.engine === 'metafor' || analysis.engine === 'R' ? 'R metafor via WebR' : analysis.engine ? `Lykos ${analysis.engine}` : 'R metafor via WebR' });
    if (Number.isFinite(analysis.k)) out.push({ label: 'Studies', value: `${analysis.k}${analysis.moderatorLabel || analysis.moderator ? `, by ${analysis.moderatorLabel || analysis.moderator}` : ''}` });
    if (analysis.at) out.push({ label: 'Run', value: day(analysis.at) });
  }
  if (facts.length) out.push(...facts);
  else if (synth) out.push({ label: 'Method', value: `${synth.method}${synth.of ? ` (${synth.of})` : ''}` });
  if (spec) {
    const fields = [spec.chart?.x, spec.chart?.y, spec.chart?.group, ...(spec.columns || []).map(c => c.label || c.field)].filter(Boolean);
    out.push({ label: 'Method', value: [spec.kind === 'chart' ? `${spec.chart?.type || 'Chart'} chart` : 'Table', fields.length ? `of ${fields.slice(0, 5).join(', ')}` : ''].filter(Boolean).join(' ') });
    if (spec.query?.where || spec.query?.collection) out.push({ label: 'Studies kept', value: [spec.query.collection ? `Collection ${spec.query.collection}` : '', spec.query.where ? String(spec.query.where) : ''].filter(Boolean).join('; ') });
  }
  if (src.keep && (src.keep.rows || src.keep.cols || item.keep)) out.push({ label: 'Kept', value: 'A selection of its rows and columns' });
  else if (item.keep) out.push({ label: 'Kept', value: [item.keep.rows ? `${item.keep.rows.length} rows` : '', item.keep.cols ? `${item.keep.cols.length} columns` : ''].filter(Boolean).join(', ') });
  const last = builds.at(-1);
  out.push({ label: 'Built', value: last ? `Version ${last.version} of ${part?.name || 'its part'}, ${day(last.at)}${builds.length > 1 ? `; ${builds.length} versions` : ''}`
    // the source already says the app draws it: here only where it prints
    : src.app ? (printed ? `Printed in ${printed}` : 'Not yet built into a file')
    : printed ? `Printed in ${printed}` : 'Not yet built in the app; no printed file found' });
  return out;
}

/** A table's rows as an HTML-ready grid with each cell's source named: `[{ cells: [{ text, head, source }] }]` (`source`: "row, column"). */
export function sourceGrid(grid, { from = '' } = {}) {
  const rows = grid?.rows || [], head = rows[0]?.cells || [], txt = c => (c?.merged ? '' : String(c?.text ?? '').trim());
  // a row is named by its study (the Study column after an ID, else the first), an arm's row by its study and arm
  const nameAt = /^(id|#|no\.?)$/i.test(txt(head[0])) && /stud/i.test(txt(head[1])) ? 1 : 0;
  let study = '';
  const names = rows.map((r, ri) => {
    if (!ri) return '';
    const own = txt(r.cells?.[nameAt]);
    if (own) { study = own; return own; }
    const arm = (r.cells || []).map(txt).map(t => /^Arm\s+\d+/i.exec(t)?.[0]).find(Boolean);
    return study ? `${study}${arm ? `, ${arm}` : ''}` : `Row ${ri}`;
  });
  return rows.map((r, ri) => ({ cells: (r.cells || []).map((c, ci) => (c?.merged ? null : { text: String(c?.text ?? ''), head: ri === 0,
    source: ri === 0 ? `Column ${ci + 1}${from ? `, ${from}` : ''}` : `${names[ri]}, ${String(head[ci]?.text ?? '') || `column ${ci + 1}`}${from ? `; ${from}` : ''}` })) }));
}

/**
 * A table's body rows as studies: a row whose first cell is empty continues the study above it (a second arm), so filtering, sorting and paging
 * keep a study's rows together. `rows` the grid's body rows; returns `[{ rows: [index…], arm: [label…] }]`, each arm its "Arm n" or ''.
 */
export function studyRows(rows) {
  const text = c => (c?.merged ? '' : String(c?.text ?? '').trim());
  const arm = r => ((r.cells || []).map(text).map(t => /^Arm\s+\d+(?:\s*\(n\s*=\s*\d+\))?/i.exec(t)?.[0]).find(Boolean) || '').replace(/\s+/g, ' ');
  const out = [];
  rows.forEach((r, i) => {
    if (text(r.cells?.[0]) || !out.length) out.push({ rows: [i], arm: [arm(r)] });
    else { out.at(-1).rows.push(i); out.at(-1).arm.push(arm(r)); }
  });
  return out;
}
/**
 * The columns that differ between a study's arms: those a further arm's row fills (the arm and its n, the construct, the outcomes), in the
 * table's order, `skip` aside (the study's identity). `rows` the grid's rows with the header first; `groups` studyRows of its body.
 */
export function armColumns(rows, groups, skip = new Set()) {
  const text = c => (c?.merged ? '' : String(c?.text ?? '').trim()), out = new Set();
  for (const g of groups) for (const k of g.rows.slice(1)) (rows[k + 1]?.cells || []).forEach((c, ci) => { if (!skip.has(ci) && text(c)) out.add(ci); });
  return [...out].sort((a, b) => a - b);
}

// ---- a printed table set against the app's extraction (2026-10-24) ---------------------------------------------------------------------------
const normCell = t => String(t ?? '').normalize('NFKC').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const normHead = t => normCell(t).replace(/[^a-z0-9]+/g, ' ').trim();
/** A stored value as text: its reported words, else its normalized value. */
const valueText = v => (v == null || v.availability === 'not_found' ? '' : String(v.reported_value ?? v.normalized_value ?? (typeof v === 'object' ? '' : v)).trim());
/**
 * A printed table against the app: each row that names a study (`keyOf(text)` -> one record's key or null) is that study, a further row of it
 * (its first cell empty) its next arm; each column whose head is an extraction column's label is that column. Each cell read so is set against
 * the value Extraction holds for that study, column and arm (`paperId:column`, `paperId:column@armN`). `{ studies, of, fields, cells, matched,
 * mismatches: [{ study, field, app, printed }] }`: nothing is changed, a difference is the person's to settle.
 */
export function tableAgainstApp(s, grid, keyOf) {
  const rows = (grid?.rows || []).map(r => (r.cells || []).map(c => (c?.merged ? '' : String(c?.text ?? c ?? '')))), head = rows[0] || [];
  const cols = new Map();
  for (const t of s?.templates || []) for (const c of t.columns || []) if (!cols.has(normHead(c.label))) cols.set(normHead(c.label), c);
  const byCol = head.map(h => cols.get(normHead(h)) || null);
  const nameAt = /^(id|#|no\.?)$/i.test(String(head[0] || '').trim()) && /stud/i.test(String(head[1] || '')) ? 1 : 0;
  const papers = new Map((s?.papers || []).flatMap(p => [[p.key || p.id, p], [p.id, p]]));
  const out = { studies: 0, of: 0, fields: byCol.filter(Boolean).length, cells: 0, matched: 0, unextracted: 0, mismatches: [] };
  const extracted = new Set(Object.keys(s?.values || {}).map(k => k.slice(0, k.indexOf(':'))));
  const none = t => /^(nr|na|n\/a|not reported|-|—|–)?$/.test(normCell(t));   // nothing said, printed or extracted
  let cur = null, arm = 0;
  rows.slice(1).forEach(r => {
    const label = String(r[nameAt] ?? '').trim();
    if (label) {
      out.of += /\b(19|20)\d{2}[a-z]?\b/.test(label) ? 1 : 0; const k = keyOf(label); cur = k ? papers.get(k) || null : null; arm = 1;
      if (cur) { out.studies++; if (!extracted.has(cur.id)) { out.unextracted++; cur = null; } }   // a study with no extracted value: nothing to set against
    }
    else arm++;
    if (!cur) return;
    byCol.forEach((c, ci) => {
      if (!c || ci === nameAt || ci === 0) return;
      const printed = String(r[ci] ?? '').trim();
      const v = s.values?.[`${cur.id}:${c.id}@arm${arm}`] ?? (arm === 1 ? s.values?.[`${cur.id}:${c.id}`] : null), app = valueText(v);
      if (none(printed) && none(app)) return;
      out.cells++;
      if (normCell(printed) === normCell(app)) out.matched++;
      else out.mismatches.push({ study: `${cur.label || label}${arm > 1 ? `, arm ${arm}` : ''}`, field: c.label, app: app || 'Not extracted', printed: printed || 'Not printed' });
    });
  });
  return out;
}
/** The words for a printed table set against the app: what it matched and what agrees. */
export function tableWords(c) {
  if (!c || !c.of) return 'Printed file; not yet built in the app';
  const studies = `matched to ${c.studies} of ${c.of} ${c.of === 1 ? 'study' : 'studies'} in the app`;
  if (!c.cells) return `Printed file, ${studies}${c.unextracted ? `; ${c.unextracted} not extracted` : ''}${c.fields ? '' : '; no column is an extraction column'}`;
  const rest = c.unextracted ? `; ${c.unextracted} not extracted` : '';
  return `Printed file, ${studies}${rest}; ${c.matched} of ${c.cells} values agree with Extraction`;
}
