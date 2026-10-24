// What depends on what in a project, as a small graph (plan: Project history, lineage and rules — dependencies are not only files).
//
// A change to one decision, cell or file can move a count, a pooled result, a table, a figure and a sentence of the manuscript, none of
// which is a file. The graph holds all of them as nodes of a kind, and an edge says "this feeds that" with how it is known:
//
//   project     read from the project's own data (a record counted in a PRISMA box, a column an output reads)
//   manuscript  a {{result}} token in a block of the manuscript
//   adopted     a cell a file supplied when it was adopted (.lykos/adopted.json)
//   script      read from a script's text (lib/figure-lineage.mjs); inferred, never run
//   commit      recorded by a commit's link (lib/vcs.mjs)
//   dated       read from two dates (a package part built on or before the day a submission sent it); inferred
//
// Without a project folder (a project kept in app storage) `ext` is empty: the graph is the record's alone, with no adopted cell, script or commit
// edge, and a file the record names is not checked against a folder.
// Pure over the project state and the facts the caller gathered from files (`ext`); nothing is stored, so the graph is rebuilt from what
// is true now and cannot go stale. It names no project, file, column or study: every edge comes from a rule below reading the state.
import { normName, tablesOf, tableFor } from './project-query.mjs';
import { sets as prismaSets, BOXES } from './prisma-records.mjs';
import { derive } from './prisma-counts.mjs';
import { isHandEntered } from './submission.mjs';
import { PRISMA_FIELDS } from '../schema.mjs';
import { results, slugify } from './results.mjs';
import { resultTokens } from './manuscript.mjs';
import { outcomes, timepointsOf, slotId, analysisOf, resultPrefix, fieldFor, PRIMARY } from './outcomes.mjs';
import { inputFields, measureOf, effectName } from './effect-measures.mjs';
import { savedAnalyses, sourceById } from './dataset-analysis-core.mjs';
import { currentSpec, builtinOutputs } from './output-spec.mjs';
import { labels as packageLabels, plainText, snapshotOf, changesBetween, changesText } from './package.mjs';
import { assessmentRows } from './appraisal-summary.mjs';
import { FIGURE_EXTENSIONS } from './figure-lexicon.mjs';
import { certainty } from './grade.mjs';
import { linkedOutcome } from './grade-rated.mjs';
import { swimOf } from './swim-state.mjs';
import { usesOf } from './outcome-links.mjs';
import { outcomeStudies } from './grade-appraisal.mjs';
import { sapLinks } from './governance.mjs';
import { normaliseSubmissions, statusOf } from './submissions.mjs';

export const KINDS = Object.freeze({ record: 'Record', count: 'Count', template: 'Extraction table', collection: 'Collection', column: 'Column', dataset: 'Dataset', outcome: 'Outcome', analysis: 'Analysis', grade: 'Certainty rating', swim: 'SWiM domain', result: 'Result', output: 'Output', block: 'Manuscript', file: 'File', script: 'Script', plan: 'Planned analysis', submission: 'Submission' });
export const HOW = Object.freeze({ project: 'Project data', manuscript: 'Manuscript link', adopted: 'Adopted file', script: 'Script text', commit: 'Commit link', dated: 'Dates' });
/** `project`, `manuscript`, `adopted` and `commit` are facts the project recorded; `script` is read from text and `dated` from two dates, and either can be wrong. */
export const confidenceOf = how => (how === 'script' || how === 'dated' ? 'inferred' : 'recorded');

const FIELD_LABEL = new Map(PRISMA_FIELDS.map(f => [f.id, f.label]));
const TABLE_ROWS = new Set(['studies', 'records', 'arms']);   // the sources whose columns are the project's tables' columns (lib/project-query.mjs)
const MEASURE_ROWS = new Set(['studies', 'arms', 'values', 'appraisal', 'assessments', 'patients']);

/**
 * Builds the graph: `state` is the project, `ext` what files say ({ adopted: {files}, scans: [scanProducer result], links: [{ from, to, kind }],
 * files: Set of paths, times: Map of path to ms }). Some nodes carry facts for reading: a table its studies and values, a collection its
 * members, a result its status, an analysis `stale`, a package part its last build, a file or script `mtime` and a file a script wrote `older`.
 */
export function buildGraph(state, ext = {}) {
  const nodes = new Map(), edges = [], seen = new Set();
  const node = (kind, key, label, extra = {}) => {
    const id = `${kind}:${key}`, had = nodes.get(id);
    if (!had) nodes.set(id, { id, kind, label: String(label ?? key), ...extra });
    else if (extra.label || extra.manual != null) Object.assign(had, extra);
    return id;
  };
  const edge = (from, to, kind, how, extra = {}) => {
    const k = `${from}|${to}|${kind}`;
    if (from === to || seen.has(k)) return;
    seen.add(k);
    edges.push({ from, to, kind, how, confidence: confidenceOf(how), ...extra });
  };
  const s = { papers: [], screening: {}, fulltext: {}, ...(state || {}) };

  // ---- columns of every table, by id and by name -----------------------------------------------------------------
  const tables = tablesOf(s), colById = new Map();
  for (const t of tables) for (const c of t.columns || []) colById.set(c.id, { c, t });
  const stats = new Map();   // a table's studies and values, counted once
  const tableNode = t => {
    if (!stats.has(t.id)) {
      const pids = new Set(); let values = 0;
      if (t.id !== 'default') for (const k of Object.keys(s.values || {})) if (k.includes(`:${t.id}.`)) { values++; pids.add(k.slice(0, k.indexOf(':'))); }
      stats.set(t.id, { studies: pids.size, values, pids });
    }
    const st = stats.get(t.id);
    return node('template', t.id, t.name, { view: 'extraction', studies: st.studies, values: st.values, columns: (t.columns || []).length });
  };
  const made = new Map();   // a column's node, made once however many cells name it
  const column = id => made.get(id) || made.set(id, columnNode(id)).get(id);
  const columnNode = id => {
    const hit = colById.get(id), cid = node('column', id, hit ? `${hit.t.name}: ${hit.c.label || hit.c.name || id}` : id, { table: hit?.t.id || '', short: hit ? hit.c.label || hit.c.name || id : id });
    if (hit) edge(tableNode(hit.t), cid, 'has-column', 'project');   // a table of the project holds its columns, so it can be started from
    return cid;
  };

  // ---- decisions → counts: each record in the box it is counted in ------------------------------------------------------
  const derived = derive(s), recs = prismaSets(s), byId = new Map((s.papers || []).map(p => [p.id, p]));
  const labelOf = id => byId.get(id)?.label || byId.get(id)?.title || id;
  const countFields = new Set(Object.values(BOXES).flatMap(b => b.fields));
  for (const f of countFields) {
    const manual = isHandEntered(s.prisma?.[f], derived[f]), n = node('count', f, FIELD_LABEL.get(f) || f, { manual, value: derived[f] ?? null });
    if (manual || !recs[f]) continue;
    for (const r of recs[f].records) edge(node('record', r.id, labelOf(r.id) || r.label), n, 'counted-in', 'project', { note: r.note || '' });
  }
  if ((s.searches || []).length) {
    const log = node('dataset', 'searches', 'Search log', { view: 'search', rows: s.searches.length });
    for (const f of ['database_results', 'register_results', 'duplicates']) if (nodes.has(`count:${f}`)) edge(log, `count:${f}`, 'counted-in', 'project');
  }
  const included = node('count', 'new_studies', FIELD_LABEL.get('new_studies') || 'Studies included');

  // ---- the manuscript's linked results ----------------------------------------------------------------------------------
  const all = results(s), resultKeys = new Map(all.map(r => [r.key, r]));
  const resultNode = key => { const r = resultKeys.get(key); return node('result', key, r ? `${r.group}: ${r.label}` : key, { text: r?.text ?? '', short: r?.label || key, group: r?.group || '', status: r?.inputStatus || '' }); };
  for (const r of all) resultNode(r.key);
  for (const [k, r] of resultKeys) if (k.startsWith('prisma.')) edge(node('count', k.slice(7), FIELD_LABEL.get(k.slice(7)) || r.label), resultNode(k), 'shown-as', 'project');
  const flow = node('output', 'builtin:prisma', 'PRISMA flow diagram', { view: 'reporting', shape: 'figure' });
  for (const f of countFields) if (nodes.has(`count:${f}`)) edge(`count:${f}`, flow, 'drawn-in', 'project');
  (s.manuscript?.blocks || []).forEach((b, i) => {
    const toks = resultTokens(b.text || '');
    if (!toks.length) return;
    const head = String(b.text || '').replace(/\{\{[^}]*\}\}|\[@[^\]]*\]/g, '').trim().slice(0, 48);
    const id = node('block', b.id, `${b.type === 'p' ? '¶' : b.type} ${i + 1}${head ? `: ${head}` : ''}`, { view: 'manuscript' });
    for (const t of toks) edge(resultNode(t.key), id, 'written-in', 'manuscript');
  });

  // ---- pooled analyses: the columns they read, and the results they give -----------------------------------------------------
  for (const o of outcomes(s)) for (const t of timepointsOf(s, o.id)) {
    const slot = slotId(o.id, t.id), a = analysisOf(s, slot);
    if (!a) continue;
    // named by its outcome where a page shows it (the kind is its icon); its estimate kept raw so a proportion reads as a percent
    const id = node('analysis', slot, `Pooled effect${o.id === PRIMARY ? '' : `: ${o.name}`}${t.label ? `${o.id === PRIMARY ? ':' : ','} ${t.label}` : ''}`,
      { view: 'analysis', display: [o.name || 'Pooled effect', t.label].filter(Boolean).join(', '), measure: a.measure || o.measure || '', est: a.estimate ?? a.est ?? null, lo: a.lo ?? null, hi: a.hi ?? null });
    edge(included, id, 'computed-from', 'project');
    // read from a table's text: its column, or a comparison's columns and the column naming its arms
    if (o.derived) for (const c of new Set([o.derived.column, ...(o.derived.columns || []), o.derived.arms?.column].filter(Boolean))) edge(column(c), id, 'computed-from', 'project');
    else for (const f of inputFields(a.measure || o.measure)) if ([...Object.keys(s.values || {})].some(k => k.endsWith(`:${fieldFor(f, slot)}`))) edge(column(fieldFor(f, slot)), id, 'computed-from', 'project');
    const prefix = `${resultPrefix(slot)}.`;
    for (const k of resultKeys.keys()) if (k.startsWith(prefix)) edge(id, resultNode(k), 'gives', 'project');
  }
  for (const a of savedAnalyses(s)) {
    const d = sourceById(a.datasetId, s), id = node('analysis', `ds:${a.id}`, a.result?.title || a.kind, { view: 'datasets' });
    if (d) edge(node('dataset', d.id, d.name), id, 'computed-from', 'project');
    for (const k of resultKeys.keys()) if (k.startsWith(`dataset.${a.id}.`)) edge(id, resultNode(k), 'gives', 'project');
  }
  const c = { s, node, edge, nodes, resultKeys, resultNode };
  survivalNodes(c);
  planNodes(c);

  // ---- certainty: each GRADE row, rating the pooled analysis it reports (by its link, else by its name) and giving its certainty result ----------
  (s.grade || []).forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const name = String(row.name || '').trim(), gid = node('grade', row.id || `row${i + 1}`, name || 'Unnamed outcome', { view: 'certainty', level: certainty(row).final || '' });
    const o = linkedOutcome(s, row);
    if (o) for (const t of timepointsOf(s, o.id)) if (nodes.has(`analysis:${slotId(o.id, t.id)}`)) edge(`analysis:${slotId(o.id, t.id)}`, gid, 'rated-in', 'project');
    if (name && resultKeys.has(`certainty.${slugify(name)}`)) edge(gid, resultNode(`certainty.${slugify(name)}`), 'gives', 'project');
  });

  // ---- outputs: the rows and columns a table or figure reads --------------------------------------------------------------
  const outs = [...(s.outputs || []), ...builtinOutputs(s)];
  for (const o of outs) {
    const q = currentSpec(o)?.query;
    if (!q) continue;
    const id = node('output', o.id, currentSpec(o)?.title || o.id, { view: 'tables', shape: currentSpec(o)?.kind === 'chart' ? 'figure' : 'table' });
    if (!q.from || MEASURE_ROWS.has(q.from)) edge(included, id, 'rows-of', 'project');
    if (q.from === 'searches' && nodes.has('dataset:searches')) edge('dataset:searches', id, 'read-by', 'project');
    if (q.from === 'dataset' || q.from === 'analysis') for (const d of s.datasets || []) if (!q.dataset || normName(d.name) === normName(q.dataset)) edge(node('dataset', d.id, d.name), id, 'read-by', 'project');
    for (const c of columnsOfQuery(s, q, tables)) edge(column(c), id, 'read-by', 'project');
  }

  // ---- the package: each table and figure of the paper, from a folder file or the evidence table's columns ----------------------
  const pkg = s.package, L = pkg?.items ? packageLabels(pkg) : new Map();
  for (const it of Object.values(pkg?.items || {})) {
    if (!it?.id || !['table', 'figure'].includes(it.kind)) continue;
    const title = plainText(it.title, x => L.get(x)).trim();
    const id = node('output', `package:${it.id}`, [L.get(it.id), title].filter(Boolean).join(': ') || it.id, { view: 'tables', shape: it.kind });
    const src = it.source || {};
    if (src.path) edge(node('file', src.path, src.path), id, 'shown-in', 'project');
    if (src.evidence) {
      // the columns lib/package-select.mjs evidenceGrid draws: the ones named, else the publication columns, else every column but a group's
      const t = (s.templates || []).find(x => x.id === src.evidence), cols = t?.columns || [];
      if (t) {
        edge(included, id, 'rows-of', 'project');
        const shown = src.fields ? cols.filter(c => src.fields.includes(c.id)) : t.publicationColumns ? cols.filter(c => t.publicationColumns.includes(c.id)) : cols.filter(c => !c.groupKey && !/\.main_table$/.test(c.id));
        for (const c of shown) edge(column(c.id), id, 'read-by', 'project');
      }
    }
  }

  // the parts of the package: each a document (Main tables, Supplement) that holds its items, with its last build and what changed since
  for (const part of pkg?.parts || []) {
    const last = (pkg.builds?.[part.id] || []).at(-1) || null;
    let edits = '';
    try { edits = last?.snapshot ? changesText(changesBetween(last.snapshot, snapshotOf(pkg, part.id))) : ''; } catch { edits = ''; }
    const pid = node('output', `part:${part.id}`, part.name || part.file || part.id, { view: 'tables', shape: 'part', file: part.file || '', version: last?.version ?? null, built: last?.at || '', edits });
    for (const iid of part.items || []) if (nodes.has(`output:package:${iid}`)) edge(`output:package:${iid}`, pid, 'part-of', 'project');
  }
  submissionNodes(c);

  // ---- collections: the studies a table or figure keeps, and the extraction tables whose studies they are ------------------------
  for (const c of s.collections || []) {
    if (!c?.id || !(c.members || []).length) continue;
    const members = new Set(c.members), tables = [...stats.entries()].filter(([, st]) => [...st.pids].some(p => members.has(p))).map(([id]) => id);
    const cid = node('collection', c.id, c.name || c.id, { view: 'library', members: members.size, tables });
    for (const o of outs) { const q = currentSpec(o)?.query; if (q?.collection != null && q.collection !== '' && normName(q.collection) === normName(c.name || '') && nodes.has(`output:${o.id}`)) edge(cid, `output:${o.id}`, 'rows-of', 'project'); }
    for (const it of Object.values(pkg?.items || {})) if (it?.source?.collection === c.id && nodes.has(`output:package:${it.id}`)) edge(cid, `output:package:${it.id}`, 'rows-of', 'project');
  }

  // ---- appraisal: the answers per study and instrument, read by the appraisal table and its results ------------------------------
  const graded = assessmentRows(s);
  if (graded.length) {
    const tools = {};
    for (const r of graded) tools[r.toolName || r.tool] = (tools[r.toolName || r.tool] || 0) + 1;
    const aid = node('dataset', 'appraisal', 'Appraisal', { view: 'appraisal', tools });
    if (nodes.has('output:builtin:appraisal')) edge(aid, 'output:builtin:appraisal', 'read-by', 'project');
    for (const k of resultKeys.keys()) if (k.startsWith('appraisal.')) edge(aid, resultNode(k), 'shown-as', 'project');
    // the charts Appraisal draws from the same answers: the traffic light and the summary
    for (const [key, label] of [['builtin:rob-traffic', 'Risk-of-bias traffic light'], ['builtin:rob-summary', 'Risk-of-bias summary']]) edge(aid, node('output', key, label, { view: 'appraisal', shape: 'figure' }), 'drawn-in', 'project');
  }

  // ---- synthesis without meta-analysis: each outcome domain, from the studies given a direction in it and their risk of bias ----------------
  const sw = swimOf(s);
  if (sw.outcomes.length) {
    const table = node('output', 'builtin:swim-table', 'Effect direction table', { view: 'certainty', shape: 'table' });
    const harvest = node('output', 'builtin:harvest', 'Harvest plot', { view: 'certainty', shape: 'figure' });
    for (const d of sw.outcomes) {
      const judged = Object.keys(sw.cells).filter(pid => sw.cells[pid][d.id]);
      const id = node('swim', d.id, d.name || 'Unnamed domain', { view: 'certainty', studies: judged.length });
      for (const pid of judged) edge(node('record', pid, labelOf(pid)), id, 'judged-in', 'project');
      if (nodes.has('dataset:appraisal')) edge('dataset:appraisal', id, 'read-by', 'project');
      edge(id, table, 'shown-in', 'project');
      edge(id, harvest, 'drawn-in', 'project');
    }
  }

  // ---- outcomes: the one id the plan, Analysis, Certainty and SWiM name (lib/outcome-links.mjs); the appraisals beside a GRADE row ----------
  for (const o of outcomes(s)) {
    const u = usesOf(s, o.id), slots = timepointsOf(s, o.id).map(t => slotId(o.id, t.id));
    const pooled = slots.map(x => `analysis:${x}`).filter(x => nodes.has(x));
    const inputs = o.derived?.column ? [o.derived.column] : slots.flatMap(x => inputFields(o.measure).map(f => fieldFor(f, x))).filter(f => Object.keys(s.values || {}).some(k => k.endsWith(`:${f}`)));
    if (o.hidden && !pooled.length && !u.grade.length && !u.swim.length && !u.sap.length) continue;
    const id = node('outcome', o.id, o.name, { view: 'analysis', measure: o.measure || '', planned: u.sap.map(r => String(r.method || '').trim()).filter(Boolean) });
    for (const c of inputs) edge(id, column(c), 'entered-in', 'project');
    for (const a of pooled) edge(id, a, 'pooled-in', 'project');
    for (const g of u.grade) {
      const gid = `grade:${g.id || `row${(s.grade || []).indexOf(g) + 1}`}`;
      if (!nodes.has(gid)) continue;
      edge(id, gid, 'rated-in', 'project');
      const studied = outcomeStudies(s, o.id);
      if (nodes.has('dataset:appraisal') && studied.basis !== 'included' && graded.some(r => studied.ids.includes(r.paperId))) edge('dataset:appraisal', gid, 'informs', 'project');
    }
    for (const d of u.swim) if (nodes.has(`swim:${d.id}`)) edge(id, `swim:${d.id}`, 'synthesised-in', 'project');
  }

  // ---- the package's tables and figures the app draws (lib/app-items.mjs): from the analysis, appraisal, GRADE rows, SWiM domains or output they show
  for (const it of Object.values(pkg?.items || {})) {
    const k = String(it?.source?.app || ''), head = k.split(':')[0], arg = k.slice(head.length + 1), id = `output:package:${it?.id}`;
    if (!k || !nodes.has(id)) continue;
    const of = kind => [...nodes.keys()].filter(x => x.startsWith(`${kind}:`));
    const from = head === 'forest' ? [`analysis:${arg}`] : head.startsWith('rob-') ? ['dataset:appraisal'] : head === 'prisma' ? ['output:builtin:prisma'] : head === 'output' ? [`output:${arg}`]
      : head === 'sof' || head === 'profile' ? of('grade') : head === 'swim-table' || head === 'harvest' ? of('swim')
      : head === 'synth' ? of('template') : [];   // a synthesis is drawn from the extraction tables (lib/synth-figures.mjs)
    for (const f of from) if (nodes.has(f)) edge(f, id, 'shown-in', 'project');
  }

  // ---- files: cells adopted from them, scripts that read and write them, links a commit recorded -------------------------
  for (const f of Object.values(ext.adopted?.files || {})) {
    const fid = node('file', f.path, f.path), cols = new Map();
    for (const c of f.cells || []) {
      const m = /^v:[^:]*:(.+?)(?:@arm\d+)?$/.exec(c.k);
      const col = m ? column(m[1]) : /^p:/.test(c.k) ? node('column', `patients.${c.k.split(':').pop()}`, `Patient data: ${c.n || c.k.split(':').pop()}`) : null;
      if (col) cols.set(col, (cols.get(col) || 0) + 1);
    }
    for (const [col, n] of cols) edge(fid, col, 'adopted-into', 'adopted', { cells: n });
  }
  const index = fileIndex(ext.files);
  for (const sc of ext.scans || []) {
    const sid = node('script', sc.script, sc.script);
    for (const i of sc.inputs || []) if (i.resolved !== false) edge(node('file', i.path, i.path), sid, 'read-by', 'script');
    for (const o of sc.outputs || []) for (const p of writtenFiles(o, index)) edge(sid, node('file', p, p), 'writes', 'script');
  }
  for (const l of ext.links || []) edge(node('file', l.from, l.from), node('file', l.to, l.to), l.kind || 'built-from', 'commit');

  const out = new Map(), into = new Map();
  for (const n of nodes.keys()) { out.set(n, []); into.set(n, []); }
  for (const e of edges) { out.get(e.from).push(e); into.get(e.to).push(e); }

  // ---- states that matter: a result whose data changed since it ran, a file a script wrote before its inputs last changed, a part older than its sources
  const times = ext.times instanceof Map ? ext.times : null;
  for (const n of nodes.values()) {
    if ((n.kind === 'file' || n.kind === 'script') && times?.has(n.label)) n.mtime = times.get(n.label);
    if (n.kind === 'analysis') {
      const status = out.get(n.id).filter(e => e.kind === 'gives').map(e => nodes.get(e.to).status);
      n.stale = status.includes('stale');
      n.current = !!status.length && status.every(x => x === 'current');
    }
    if (n.kind === 'file' && ext.files instanceof Set && ext.files.size) n.missing = !ext.files.has(n.label);   // named by the project or a script, and not in the folder
  }
  const SLACK = 2000;   // a file system's times are not finer than this everywhere
  for (const n of nodes.values()) {
    if (n.kind === 'file' && n.mtime) {
      // older than its input when every script said to write it (a name can match several) has a newer input or was changed itself since
      const latest = into.get(n.id).filter(e => e.kind === 'writes').map(e => Math.max(nodes.get(e.from).mtime || 0, ...into.get(e.from).map(x => nodes.get(x.from).mtime || 0)));
      if (latest.length && Math.min(...latest) > n.mtime + SLACK) n.older = true;
    }
    if (n.shape === 'part' && n.built) {
      const at = Date.parse(n.built);
      n.sourceChanged = into.get(n.id).some(e => into.get(e.from).some(x => nodes.get(x.from).kind === 'file' && (nodes.get(x.from).mtime || 0) > at + SLACK));
    }
  }
  return { nodes, edges, out, into };
}

// ---- nodes of their own kind, each from one part of the project (`c` is the graph being built: { s, node, edge, nodes, resultKeys, resultNode }) ----

/** Time to event: the survival analysis of the patient data (plan §4.8), fed by the patient table, giving the survival and Cox results. */
function survivalNodes({ s, node, edge, nodes, resultKeys, resultNode }) {
  const sv = s.survival;
  if (!sv || typeof sv !== 'object') return;
  const n = Number(sv.n), events = Number(sv.events);
  const brief = [Number.isFinite(n) && sv.n != null ? `${n} ${n === 1 ? 'patient' : 'patients'}` : '', Number.isFinite(events) && sv.events != null ? `${events} ${events === 1 ? 'event' : 'events'}` : ''].filter(Boolean).join(', ');
  const id = node('analysis', 'survival', 'Time to event', { view: 'analysis', brief });
  const people = (s.participants || []).length;
  if (people) {
    const pid = node('dataset', 'patients', 'Patient data', { view: 'patients' });
    nodes.get(pid).rows = people;
    edge(pid, id, 'computed-from', 'project');
  }
  for (const k of resultKeys.keys()) if (/^(survival|cox)\./.test(k)) edge(id, resultNode(k), 'gives', 'project');
}

/** The graph's node for an analysis as lib/governance.mjs executedAnalyses names its source, or ''. */
const analysisNodeOf = src => (src === 'analysis' ? `analysis:${PRIMARY}` : src.startsWith('analyses.') ? `analysis:${src.slice(9)}` : src.startsWith('datasetAnalyses.') ? `analysis:ds:${src.slice(16)}` : '');

/**
 * The statistical analysis plan: a node per stored planned analysis, run as each analysis its outcome names (lib/governance.mjs sapLinks, the
 * Protocol page's "Planned and done"). A planned row nothing runs is a gap; an analysis no row names is marked `unplanned`.
 */
function planNodes({ edge, node, nodes, s }) {
  const { rows, unplanned } = sapLinks(s);
  rows.forEach((r, i) => {
    const id = node('plan', `sap${i + 1}`, r.outcome || 'Unnamed outcome', { view: 'protocol', method: r.method, status: r.status });
    for (const src of r.sources) { const a = analysisNodeOf(src); if (nodes.has(a)) edge(id, a, 'run-as', 'project'); }
  });
  for (const src of unplanned) { const a = nodes.get(analysisNodeOf(src)); if (a) a.unplanned = true; }
}

/**
 * Each journal the paper went to: the manuscript and cover letter it sent (the attempt's files, a revision's file), and each part of the package
 * as last built on or before the day it was last sent (by the dates, so inferred).
 */
function submissionNodes({ s, node, edge, nodes }) {
  const parts = (s.package?.parts || []).filter(p => nodes.has(`output:part:${p.id}`));
  for (const a of normaliseSubmissions(s.submissions)) {
    const st = statusOf(a);
    const id = node('submission', a.id, a.journal.label || 'Untitled journal', { view: 'submissions', status: st.word, at: st.at });
    const sentFile = f => { if (f?.rel) edge(node('file', f.rel, f.rel), id, 'sent-in', 'project'); };
    sentFile(a.file); sentFile(a.coverLetter);
    for (const e of a.events) if (e.kind === 'submitted' || e.kind === 'revised') sentFile(e.file);
    const sent = a.events.filter(e => (e.kind === 'submitted' || e.kind === 'revised') && e.at).map(e => e.at).sort().at(-1);
    if (!sent) continue;
    for (const p of parts) {
      const b = (s.package.builds?.[p.id] || []).filter(x => x?.at && String(x.at).slice(0, 10) <= sent).at(-1);
      if (b) edge(`output:part:${p.id}`, id, 'sent-in', 'dated', { version: b.version ?? null });
    }
  }
}

/** The project files a script's output names: the expected path when it exists, a glob's matches, a file of the same name; else the path as written. */
const baseName = p => p.slice(p.lastIndexOf('/') + 1);
/** The folder's files by name, built once per graph: `{ files, all, byBase }`. */
function fileIndex(files) {
  if (!(files instanceof Set) || !files.size) return null;
  const all = [...files], byBase = new Map();
  for (const f of all) { const b = baseName(f); byBase.set(b, [...(byBase.get(b) || []), f]); }
  return { files, all, byBase };
}
function writtenFiles(o, index) {
  if (o.ext === null) return [];
  const own = o.expected || o.path, base = baseName;
  if (!own) return [];
  if (!index) return [own];
  if (index.files.has(own)) return [own];
  const all = index.all;
  if (o.glob || /[*?]/.test(own)) {
    const re = new RegExp(`^${base(own).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    const hit = all.filter(f => re.test(base(f)));
    return hit.length ? hit : [own];
  }
  const same = index.byBase.get(base(own)) || [], live = same.filter(f => !EARLIER.test(f));   // a copy kept as an earlier state is not what the script writes now
  return live.length ? live : same.length ? same : [own];
}

/** The names a saved query reads from its table, as column ids: select, columns, groupBy, aggregate, sort and the left side of each filter. */
function columnsOfQuery(s, q, tables) {
  if (q.from && !TABLE_ROWS.has(q.from)) return new Set();   // another source (assessments, searches, a dataset) has columns of its own: a "Study" there is not the evidence table's
  let table;
  try { table = tableFor(s, q.template); } catch { table = null; }
  const pool = [...(table ? [table] : []), ...tables.filter(t => t !== table)], byName = new Map();
  for (const t of pool) for (const c of t.columns || []) for (const n of [c.id, c.label, c.name, c.id.slice(c.id.indexOf('.') + 1)]) if (n && !byName.has(normName(n))) byName.set(normName(n), c.id);
  const names = [];
  const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/[;,](?![^(]*\))/)).forEach(x => names.push(typeof x === 'string' ? x : x?.col));
  list(q.select); list(q.groupBy); list(q.sort); (q.columns || []).forEach(c => names.push(c?.col));
  for (const a of [].concat(q.aggregate || [])) { const m = /\((.+)\)/.exec(a); if (m) names.push(m[1]); }
  const w = q.where;
  for (const x of Array.isArray(w) ? w : String(w || '').split(';')) {
    const left = typeof x === 'string' ? (/^(.+?)\s*(?:!=|!~|>=|<=|=|~|>|<|\s+in\s+|\s+is\s+)/.exec(x.trim())?.[1] ?? x.trim()) : x?.col;
    names.push(left);
  }
  const ids = new Set();
  for (const n of names) { const id = byName.get(normName(String(n || '').replace(/^-/, ''))); if (id) ids.add(id); }
  return ids;
}

// ---- reading the graph -------------------------------------------------------------------------------------------------
const arrows = { down: 'out', up: 'into' };

/**
 * Every node reachable from `id`, nearest first: `down` is what the node affects, `up` what it is built from.
 * `[{ node, depth, edge, via }]` (`via` is the node it was reached through), each node once, by its shortest path.
 */
export function reach(g, id, dir = 'down', { depth = 8 } = {}) {
  if (!g.nodes.has(id)) return [];
  const side = g[arrows[dir]], seen = new Set([id]), out = [];
  let layer = [id];
  for (let d = 1; d <= depth && layer.length; d++) {
    const next = [];
    for (const from of layer) for (const e of side.get(from) || []) {
      const to = dir === 'down' ? e.to : e.from;
      if (seen.has(to)) continue;
      seen.add(to);
      out.push({ node: g.nodes.get(to), depth: d, edge: e, via: from });
      next.push(to);
    }
    layer = next;
  }
  return out;
}

/** The same as a tree: `{ node, edge, children }`, a node under the first path that reached it. */
export function tree(g, id, dir = 'down', opts = {}) {
  const hits = reach(g, id, dir, opts), kids = new Map();
  for (const h of hits) { const l = kids.get(h.via) || []; l.push(h); kids.set(h.via, l); }
  const build = (nid, edge) => ({ node: g.nodes.get(nid), edge, children: (kids.get(nid) || []).map(h => build(h.node.id, h.edge)) });
  return g.nodes.has(id) ? build(id, null) : null;
}

const ORDER = Object.keys(KINDS);
const plural = (n, k) => `${n} ${KINDS[k].toLowerCase()}${n === 1 ? '' : k === 'analysis' ? '' : 's'}`.replace('analysiss', 'analyses');

// ---- where a thing ends up -----------------------------------------------------------------------------------------------
// A change matters where it reaches something a person hands in or reads: a table, a figure, an analysis as a whole, a sentence of the
// manuscript, a file nothing else reads. Columns, counts, results, records and scripts are steps on the way, said only as a step's name.

/** The kinds of end point, in the order a page lists them, with their words for one and many. */
export const ENDS = Object.freeze({ table: ['table', 'tables'], figure: ['figure', 'figures'], analysis: ['analysis', 'analyses'], grade: ['certainty rating', 'certainty ratings'], block: ['manuscript sentence', 'manuscript sentences'], submission: ['submission', 'submissions'], file: ['file', 'files'] });
const EARLIER = /(^|\/)(Old versions|Archive)\//;   // a copy kept as an earlier state: not what the project hands in now
const FIGURE_EXT = new Set(FIGURE_EXTENSIONS), TABLE_EXT = new Set(['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv']);
const extOf = p => { const b = String(p).slice(String(p).lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });
const keyOf = n => n.id.slice(n.id.indexOf(':') + 1);

/**
 * The end-point kind of a node (a key of ENDS), or '' for a step on the way. A file is a figure or a table by its type; any other file is an
 * end only when nothing reads it; a file kept as an earlier state (Old versions/, Archive/) is never one.
 */
export function endOf(g, n) {
  if (!n) return '';
  if (n.kind === 'output') return n.shape === 'part' ? '' : n.shape === 'figure' ? 'figure' : 'table';   // a part of the package is the document its items are in
  if (n.kind === 'analysis' || n.kind === 'block' || n.kind === 'grade' || n.kind === 'submission') return n.kind;   // a GRADE row is a line of the Summary of findings
  if (n.kind !== 'file' || EARLIER.test(n.label)) return '';
  const x = extOf(n.label);
  return FIGURE_EXT.has(x) ? 'figure' : TABLE_EXT.has(x) ? 'table' : g.out.get(n.id)?.length ? '' : 'file';
}

/** An analysis in one line, from the results it gives: "PR 0.1 (95% CI 0.07 to 0.13)", else its results text or its estimate; '' when it gives none. */
export function headline(g, id) {
  const n = g.nodes.get(id);
  if (n?.brief) return n.brief;   // an analysis that says itself in its own words (time to event: its patients and events)
  if (n && Number.isFinite(Number(n.est))) return estimateText(n.measure, n.est, n.lo, n.hi);
  const res = (g.out.get(id) || []).filter(e => e.kind === 'gives').map(e => g.nodes.get(e.to)).filter(r => r?.text);
  const ends = suffix => res.find(r => keyOf(r).endsWith(suffix));
  const full = ends('.full');
  if (full) return `${String(full.short || '').replace(' with CI', '')} ${full.text}`.trim();
  return (ends('.sentence') || ends('.estimate') || ends('.effect'))?.text || '';
}

/**
 * An estimate as a researcher reads it: a proportion as a percent with its interval ("5.7% [3.5, 9.0]"), any other measure by its name
 * ("RR 1.23 [0.98, 1.54]"); an interval it does not have is left out.
 */
export function estimateText(measure, est, lo, hi) {
  const m = measure ? measureOf(measure) : null, pct = m?.family === 'proportion';
  const f = v => (pct ? (Number(v) * 100).toFixed(1) : Number(v).toFixed(2));
  const ci = [lo, hi].every(v => v != null && v !== '' && Number.isFinite(Number(v))) ? ` [${f(lo)}, ${f(hi)}]` : '';
  return pct ? `${f(est)}%${ci}` : `${m ? `${effectName(measure)} ` : ''}${f(est)}${ci}`;
}

/** "1 table, 5 analyses" for `{ table: 1, analysis: 5 }`; kinds with none are left out. */
export const endsText = (counts, sep = ', ') => Object.keys(ENDS).filter(k => counts[k]).map(k => `${counts[k]} ${ENDS[k][counts[k] === 1 ? 0 : 1]}`).join(sep);

/**
 * Where a change to `id` ends up: `{ total, counts, groups, through }`.
 * `groups` are the end points by kind (ENDS order; empty kinds left out): `{ kind, items: [{ node, via, used, headline }] }`, where `via` are
 * the nodes on the way that feed it (the subject among them when it feeds it directly), `used` (an analysis) its results that something
 * reads, each with what reads it, and `headline` (an analysis) its result in one line. `through` are the subject's own next steps that are
 * not end points (its columns, counts, scripts), each with the end points it reaches: `{ node, ends }`, the ones that reach something first;
 * `steps: false` leaves them out (a list that only counts).
 */
export function deliverables(g, id, { depth = 8, steps = true } = {}) {
  const hits = reach(g, id, 'down', { depth }), near = new Set([id, ...hits.map(h => h.node.id)]);
  const by = Object.fromEntries(Object.keys(ENDS).map(k => [k, []])), counts = {};
  for (const h of hits) {
    const kind = endOf(g, h.node);
    if (!kind) continue;
    const item = { node: h.node, via: (g.into.get(h.node.id) || []).map(e => g.nodes.get(e.from)).filter(n => near.has(n.id)).sort(byLabel), used: [], headline: '' };
    if (kind === 'analysis') {
      item.headline = headline(g, h.node.id);
      for (const e of g.out.get(h.node.id) || []) if (e.kind === 'gives') {
        const readers = (g.out.get(e.to) || []).map(x => g.nodes.get(x.to));
        if (readers.length) item.used.push({ result: g.nodes.get(e.to), in: readers });
      }
    }
    by[kind].push(item);
    counts[kind] = (counts[kind] || 0) + 1;
  }
  const groups = Object.keys(ENDS).filter(k => by[k].length).map(k => ({ kind: k, items: by[k].sort((a, b) => byLabel(a.node, b.node)) }));
  const through = !steps ? [] : hits.filter(h => h.depth === 1 && !endOf(g, h.node) && h.node.kind !== 'result')
    .map(h => ({ node: h.node, ends: reach(g, h.node.id, 'down', { depth }).map(x => x.node).filter(n => endOf(g, n)).sort(byLabel) }))
    .sort((a, b) => (b.ends.length ? 1 : 0) - (a.ends.length ? 1 : 0) || byLabel(a.node, b.node));
  return { total: Object.values(counts).reduce((a, n) => a + n, 0), counts, groups, through };
}

/** "Used in 1 table · 5 analyses", or that nothing the project records uses it. */
export function usedText(g, id, opts) {
  const text = endsText(deliverables(g, id, { ...opts, steps: false }).counts, ', ');
  return text ? `Used in ${text}` : 'Used in nothing the project records';
}

const SOURCE_KINDS = new Set(['analysis', 'output', 'template', 'dataset', 'file', 'script']);
/**
 * What `id` is built from, for reading: `{ total, items, rest }`. `items` are what feeds it directly and every table, dataset, file, script,
 * analysis or output further back (kind, then nearest, then name); `rest` counts the other steps further back by kind ({ record: 48 }).
 */
export function origins(g, id, { depth = 8 } = {}) {
  const hits = reach(g, id, 'up', { depth }), rest = {};
  const items = hits.filter(h => h.depth === 1 || SOURCE_KINDS.has(h.node.kind))
    .sort((a, b) => ORDER.indexOf(a.node.kind) - ORDER.indexOf(b.node.kind) || a.depth - b.depth || byLabel(a.node, b.node)).map(h => h.node);
  const shown = new Set(items.map(n => n.id));
  for (const h of hits) if (!shown.has(h.node.id)) rest[h.node.kind] = (rest[h.node.kind] || 0) + 1;
  return { total: hits.length, items, rest };
}
/** "17 columns, 48 records" for an origins' `rest`. */
export const restText = rest => ORDER.filter(k => rest[k]).map(k => plural(rest[k], k)).join(', ');

// ---- the project as a tree, in the order the work flows ----------------------------------------------------------------
// Sources (the folder's files the project reads) → project data (extraction tables and their collections, datasets, screening counts)
// → results (each analysis with its result, results of their own such as a certainty rating) → deliverables (tables, figures, the package's
// parts and items, manuscript sentences). A node of the tree is `{ key, label, node, fact, state, children }`: `node` is the graph's node (null
// for a layer, a group or a folder), `fact` a short line of what it is ("48 studies · 1,441 values"), `state` set only when it matters.

export const LAYERS = Object.freeze([['sources', 'Sources'], ['data', 'Project data'], ['results', 'Results'], ['deliverables', 'Deliverables']]);
const DATA_KINDS = new Set(['template', 'dataset', 'collection', 'count']);
const SCRIPT_EXT = new Set(['py', 'r', 'js', 'mjs', 'cjs']);
const PRISMA_ORDER = PRISMA_FIELDS.map(f => f.id);
const count = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many || `${one}s`}`;
const base = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const folderOf = p => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');

/** The project as a tree of four layers (LAYERS order; a layer with nothing in it is left out). Pure over the graph. */
export function homeTree(g) {
  const all = [...g.nodes.values()], of = kind => all.filter(n => n.kind === kind).sort(byLabel);
  const leaf = (n, fact = '', children = []) => ({ key: n.id, label: n.label, node: n, fact, ...markOf(g, n), children });
  const group = (key, label, children) => ({ key, label, node: null, fact: '', state: '', mark: '', children });
  const written = n => g.into.get(n.id).some(e => e.kind === 'writes');
  const names = list => { const u = [...new Set(list)]; return u.length > 3 ? `${u.slice(0, 3).join(', ')} and ${u.length - 3} more` : u.join(', '); };
  /** The project data a table or figure is drawn from: the nearest tables, datasets, collections and counts above it. */
  const fromOf = id => {
    const tableOf = n => g.into.get(n.id).map(e => g.nodes.get(e.from)).find(t => t.kind === 'template');   // a column reads as its table
    const up = reach(g, id, 'up', { depth: 3 }).map(h => (h.node.kind === 'column' && tableOf(h.node) ? { ...h, node: tableOf(h.node) } : h)).filter(h => DATA_KINDS.has(h.node.kind));
    const near = up.length ? Math.min(...up.map(h => h.depth)) : 0;
    const list = up.filter(h => h.depth === near).map(h => h.node), kinds = new Set(list.map(n => n.kind));
    const unique = [...new Map(list.map(n => [n.id, n])).values()];
    if (unique.length > 3 && kinds.size === 1) return `From ${plural(unique.length, unique[0].kind)}`;   // a diagram of 24 counts reads as that
    return unique.length ? `From ${names(unique.map(n => n.label))}` : '';
  };
  /** Files under folder nodes, the folder's path as its label, so a long run of script outputs reads by where they are. */
  const byFolder = (files, fact) => {
    const dirs = new Map();
    for (const f of files) { const d = folderOf(f.label) || 'Project folder'; dirs.set(d, [...(dirs.get(d) || []), f]); }
    return [...dirs].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([d, list]) => ({ key: `dir:${d}`, label: d, node: null, fact: count(list.length, 'file'), state: '', mark: '', children: list.map(f => leaf(f, fact(f))) }));
  };

  // sources: a file the project reads its data from, or a script reads on its way to a table or figure; never a file a script writes or an earlier copy
  const read = [], scripted = [];
  for (const n of of('file')) {
    if (EARLIER.test(n.label) || FIGURE_EXT.has(extOf(n.label)) || SCRIPT_EXT.has(extOf(n.label)) || written(n)) continue;   // a module a script imports is code, not data
    const direct = g.out.get(n.id).filter(e => !['file', 'script'].includes(g.nodes.get(e.to).kind));
    const d = deliverables(g, n.id, { steps: false });
    if (!direct.length && !d.total) continue;
    const cells = direct.reduce((a, e) => a + (e.cells || 0), 0), cols = direct.filter(e => e.kind === 'adopted-into').length;
    const fact = cols ? `${count(cols, 'column')}, ${count(cells, 'cell')}` : d.total ? `Feeds ${endsText(d.counts)}` : '';
    (direct.length ? read : scripted).push({ n, fact, total: d.total });
  }
  const bySize = (a, b) => b.total - a.total || byLabel(a.n, b.n);
  const sources = [group('sources/read', 'Read into the project', read.sort(bySize).map(x => leaf(x.n, x.fact))),
    group('sources/scripts', 'Read by scripts', scripted.sort(bySize).map(x => leaf(x.n, x.fact)))];

  // project data
  const collections = of('collection'), placed = new Set();
  const tables = of('template').filter(t => t.studies || g.out.get(t.id).length).map(t => {
    const kids = collections.filter(c => (c.tables || []).includes(t.id.slice('template:'.length)));
    kids.forEach(c => placed.add(c.id));
    return leaf(t, [t.studies ? count(t.studies, 'study', 'studies') : '', t.values ? count(t.values, 'value') : ''].filter(Boolean).join(', '), kids.map(c => leaf(c, count(c.members, 'study', 'studies'))));
  });
  const datasetFact = d => (d.tools ? Object.entries(d.tools).map(([t, k]) => `${k} ${t}`).join(', ') : d.rows != null ? count(d.rows, 'row') : '');
  const counts = of('count').filter(c => c.value !== '' && c.value != null && Number.isFinite(Number(c.value))).sort((a, b) => PRISMA_ORDER.indexOf(keyOf(a)) - PRISMA_ORDER.indexOf(keyOf(b)));
  const data = [group('data/tables', 'Extraction tables', tables),
    group('data/collections', 'Collections', collections.filter(c => !placed.has(c.id)).map(c => leaf(c, count(c.members, 'study', 'studies')))),
    group('data/datasets', 'Datasets', of('dataset').map(d => leaf(d, datasetFact(d)))),
    group('data/screening', 'Screening', counts.map(c => leaf(c, `${Number(c.value).toLocaleString('en')}${c.manual ? ', entered by hand' : ''}`)))];

  // results: each analysis as a whole, each GRADE row with its certainty and the analysis it rates, each SWiM domain with its studies, then
  // results that stand alone, by their group (a count's or the appraisal's results sit with them)
  const own = new Map(), SYNTH = /^Syntheses(: |$)/;
  for (const r of of('result')) if (!g.into.get(r.id).length && r.text && !/^result:(prisma|appraisal)\./.test(r.id)) own.set(r.group || 'Results', [...(own.get(r.group || 'Results') || []), r]);
  const rates = n => g.into.get(n.id).filter(e => e.kind === 'rated-in').map(e => g.nodes.get(e.from).display || g.nodes.get(e.from).label);
  // the statistical analysis plan before what was run: each planned row with its method and the analyses that run it; an analysis it does not name says so
  const runs = n => g.out.get(n.id).filter(e => e.kind === 'run-as').map(e => g.nodes.get(e.to).display || g.nodes.get(e.to).label);
  const results = [group('results/plan', 'Planned analyses', of('plan').map(n => leaf(n, [n.method, runs(n).length ? `Run as ${names(runs(n))}` : ''].filter(Boolean).join(', ')))),
    group('results/analyses', 'Analyses', of('analysis').map(a => leaf(a, [headline(g, a.id), a.unplanned ? 'Not in the plan' : ''].filter(Boolean).join(', ')))),
    group('results/certainty', 'Certainty', of('grade').map(n => leaf(n, [n.level, rates(n).length ? `Rates ${names(rates(n))}` : ''].filter(Boolean).join(', ')))),
    group('results/swim', 'Synthesis without meta-analysis', of('swim').map(n => leaf(n, count(n.studies, 'study', 'studies')))),
    ...[...own].filter(([name]) => !SYNTH.test(name)).map(([name, list]) => group(`results/${name}`, name, list.map(r => leaf(r, r.text)))),
    // a synthesis's values under one Syntheses group, a group per combination and outcome named by its value alone, not a top-level group each;
    // the group's figure is its combinations
    ...(list => (list.length ? [{ ...group('results/syntheses', 'Syntheses', list), fact: String(list.filter(x => !x.node).length) }] : []))([...own].filter(([name]) => SYNTH.test(name))
      .flatMap(([name, list]) => { const sub = name.replace(SYNTH, ''), kids = list.map(r => ({ ...leaf(r, r.text), label: r.short || r.label })); return sub ? [group(sub, sub, kids)] : kids; }))];

  // deliverables
  const outputs = of('output'), isPackage = n => /^output:(package|part):/.test(n.id);
  const made = f => { const by = g.into.get(f.id).filter(e => e.kind === 'writes').map(e => base(g.nodes.get(e.from).label)); return by.length ? `Made by ${names(by)}` : ''; };
  const folderFiles = kind => of('file').filter(f => written(f) && !EARLIER.test(f.label) && endOf(g, f) === kind);
  const parts = outputs.filter(n => n.shape === 'part').map(p => {
    const items = g.into.get(p.id).filter(e => e.kind === 'part-of').map(e => g.nodes.get(e.from)).sort(byLabel);
    const itemFact = it => { const src = g.into.get(it.id).map(e => g.nodes.get(e.from)).find(x => x.kind === 'file' || x.kind === 'template'); return src ? `From ${src.kind === 'file' ? base(src.label) : src.label}` : ''; };
    return leaf(p, [p.file ? base(p.file) : '', p.version != null ? `v${p.version}` : 'Not built'].filter(Boolean).join(', '), items.map(it => leaf(it, itemFact(it))));
  });
  const deliver = [group('deliverables/tables', 'Tables', [...outputs.filter(n => !isPackage(n) && n.shape === 'table').map(n => leaf(n, fromOf(n.id))), ...byFolder(folderFiles('table'), made)]),
    group('deliverables/figures', 'Figures', [...outputs.filter(n => !isPackage(n) && n.shape === 'figure').map(n => leaf(n, fromOf(n.id))), ...byFolder(folderFiles('figure'), made)]),
    group('deliverables/package', 'Package', parts),
    group('deliverables/manuscript', 'Manuscript', of('block').map(b => leaf(b, `Cites ${names(g.into.get(b.id).map(e => g.nodes.get(e.from).short || g.nodes.get(e.from).label))}`))),
    // a journal by its name alone: a name such as "Neuro-Oncology" needs the whole row in a narrow window; its decision is said where it is focused
    group('deliverables/submissions', 'Submissions', of('submission').map(n => leaf(n)))];

  const layers = { sources, data, results, deliverables: deliver };
  const tree = LAYERS.map(([key, label]) => group(key, label, layers[key].filter(x => x.children.length)));
  const keyed = (list, up) => list.map(x => ({ ...x, key: up ? `${up}/${x.key}` : x.key, children: keyed(x.children, up ? `${up}/${x.key}` : x.key) }));
  return keyed(tree.filter(l => l.children.length), '');
}

/**
 * A node's status as the workflows mark one (lib/pipeline-graph.mjs): `{ mark, state }`, `mark` one of passed, warning, failed or '' and
 * `state` its words. Only a node whose state the project can check has one: an analysis by its inputs, a file by the folder and the
 * scripts that write it, a part of the package by its last build, an item by its source file, a planned analysis by whether one runs it.
 * Anything else says nothing.
 */
export function markOf(g, n) {
  const say = (mark, state) => ({ mark, state });
  if (n.kind === 'analysis') return n.stale ? say('warning', 'Data changed since it ran') : n.current ? say('passed', 'Current') : say('', '');
  if (n.kind === 'plan') return n.status === 'not done' ? say('warning', 'Not run') : n.status === 'changed' ? say('warning', 'Method changed') : say('passed', 'Run as planned');
  if (n.kind === 'file') {
    if (n.missing) return say('failed', 'Missing');
    if (n.older) return say('warning', 'Older than its input');
    return g.into.get(n.id).some(e => e.kind === 'writes') && n.mtime ? say('passed', 'Current') : say('', '');
  }
  if (n.shape === 'part') return n.version == null ? say('', '') : n.edits || n.sourceChanged ? say('warning', `Changed since v${n.version}`) : say('passed', 'Current');
  if (n.kind === 'output' && n.id.startsWith('output:package:') && g.into.get(n.id).some(e => g.nodes.get(e.from).missing)) return say('failed', 'Source missing');
  return say('', '');
}

/** The tree with only the nodes whose shown name (a file's own name) holds every word of `text` (case, accents and Turkish dotted letters ignored) and the nodes above them. */
export function filterTree(tree, text) {
  const words = normName(text).split(' ').filter(Boolean);
  if (!words.length) return tree;
  const shown = x => (x.node && (x.node.kind === 'file' || x.node.kind === 'script') ? base(x.label) : x.node?.display ? `${x.node.display} ${x.label}` : x.label);   // a file by its own name, not its folder's
  const hit = x => { const hay = normName(shown(x)); return words.every(w => hay.includes(w)); };
  const prune = list => list.flatMap(x => { const kids = prune(x.children); return hit(x) || kids.length ? [{ ...x, children: kids }] : []; });
  return prune(tree);
}

/**
 * The tree as rows to draw, top to bottom: `{ key, depth, item, path, expanded, last, cont }`, `path` the keys above it, `last` whether it
 * ends its run of siblings, `cont[d]` whether the node above it at depth d has a sibling still to come (the lines a tree draws through the
 * row). A key in `closed` hides what is under it; more than `cap` children under one node are cut to `cap` and followed by
 * `{ key, depth, more, parent, path, last: true, cont }`, and a parent's key in `open` shows them all.
 */
export function treeRows(tree, { closed = new Set(), open = new Set(), cap = 8 } = {}) {
  const rows = [];
  const walk = (list, depth, path, cont) => {
    const parent = path.at(-1) ?? '', shown = open.has(parent) || !parent ? list : list.slice(0, cap), folded = shown.length < list.length;
    shown.forEach((it, i) => {
      const expanded = it.children.length > 0 && !closed.has(it.key), last = i === shown.length - 1 && !folded;
      rows.push({ key: it.key, depth, item: it, path, expanded, last, cont });
      if (expanded) walk(it.children, depth + 1, [...path, it.key], [...cont, !last]);
    });
    if (folded) rows.push({ key: `${parent}|more`, depth, more: list.length - shown.length, parent, path, last: true, cont });
  };
  walk(tree, 0, [], []);
  return rows;
}

/** The keys from the top of the tree down to the first node that is graph node `id`, or [] when the tree does not hold it. */
export function pathTo(tree, id) {
  const find = (list, up) => { for (const x of list) { const here = [...up, x.key]; if (x.node?.id === id) return here; const deep = find(x.children, here); if (deep) return deep; } return null; };
  return find(tree, []) || [];
}

/** A sentence for what `id` reaches: "Affects 8: 2 scripts, 6 files", or that it reaches nothing. */
export function impactText(g, id, opts) {
  const i = impact(g, id, opts);
  return i.total ? `Affects ${i.total}: ${ORDER.filter(k => i.kinds[k]).map(k => plural(i.kinds[k], k)).join(', ')}` : 'Affects nothing the project records';
}

/** What a change to `id` reaches, counted by kind: `{ total, kinds: { output: 3, … } }`. */
export function impact(g, id, opts) {
  const hits = reach(g, id, 'down', opts), kinds = {};
  for (const h of hits) kinds[h.node.kind] = (kinds[h.node.kind] || 0) + 1;
  return { total: hits.length, kinds };
}

/** Nodes whose name contains every word of `text` (case, accents and Turkish dotted letters ignored), best first; `kind` narrows. */
export function findNodes(g, text, { kind = '', limit = 30 } = {}) {
  const words = normName(text).split(' ').filter(Boolean);
  const hit = [];
  for (const n of g.nodes.values()) {
    if (kind && n.kind !== kind) continue;
    const hay = normName(n.label);
    if (!words.every(w => hay.includes(w))) continue;
    hit.push({ n, rank: (hay === words.join(' ') ? 0 : hay.startsWith(words[0]) ? 1 : 2) * 1000 + (g.out.get(n.id)?.length ? 0 : 500) + hay.length });
  }
  return hit.sort((a, b) => a.rank - b.rank).slice(0, limit).map(h => h.n);
}

/** One row per edge, for the `dependencies` source of the query layer and for exports. */
export function edgeRows(g) {
  return g.edges.map(e => { const a = g.nodes.get(e.from), b = g.nodes.get(e.to);
    return { from: a.label, fromKind: KINDS[a.kind], fromId: a.id, to: b.label, toKind: KINDS[b.kind], toId: b.id, relation: e.kind, how: HOW[e.how] || e.how, confidence: e.confidence, cells: e.cells ?? null, note: e.note || '' }; });
}
