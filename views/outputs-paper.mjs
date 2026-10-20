// The paper's tables and figures for Tables and figures (lib/paper-items.mjs): what the app draws from its own data, read beside the
// project folder's files, the captions of its documents and the dependency graph. Each drawing is the one its own page draws, with the
// same renderer: the PRISMA flow is Reporting's, the risk-of-bias plots are Appraisal's charts, a forest plot is Analysis's, the SWiM
// table and the evidence profile are Certainty's, the evidence table and its publication tables are the output renderer's over
// Extraction's data. An item opens that page with "Open in …", so a table or figure has one implementation and one place it is edited.
import { searchSummary } from '../lib/search-summary.mjs';
import { get, projectGeneration } from '../store.mjs';
import { esc, sanitizeSvg } from '../lib/html.mjs';
import { folderResults } from '../lib/folder-results.mjs';
import { paperItems, captionsIn, familyOf, typeWord, isEarlier, isWorking } from '../lib/paper-items.mjs';
import { captionOf } from '../lib/package-import.mjs';
import { parseDocx } from '../lib/docx.mjs';
import { labels as packageLabels, plainText } from '../lib/package.mjs';
import { builtinOutputs, builtinLinks, currentSpec } from '../lib/output-spec.mjs';
import { evidenceModel, wordTables, isIdColumn } from '../lib/evidence-export.mjs';
import { outcomes, timepointsOf, slotId, analysisOf } from '../lib/outcomes.mjs';
import { profileOf } from '../lib/evidence-profile.mjs';
import { swimOf } from '../lib/swim-state.mjs';
import { evidenceMap, evidenceMapSvg, evidenceMapRows, mapFields } from '../lib/evidence-map.mjs';
import { figurePanel, showFigure } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { trafficLight, summaryBars } from '../lib/appraisal-fig.mjs';
import { withFigure, figureMissing } from '../lib/figures.mjs';
import { JUDGEMENT_TONE } from '../schema.mjs';
import { chartSets, openCharts } from './appraisal.mjs';
import * as studyCharts from './study-charts.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { emptyState } from '../lib/html.mjs';
import { keysOfDrawn, placements, drawApp } from '../lib/app-items.mjs';

const baseOf = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);
const studiesWord = n => `${n} ${n === 1 ? 'study' : 'studies'}`;

/**
 * What the app draws from the project, as drawables (lib/paper-items.mjs): `{ key, concept, type, name, view, viewLabel, section, origin, node,
 * order, draw?, spec?, ... }`. `draw` names the renderer (prisma, rob, forest, summary, swim, swim-events, profile, study); `spec` is an output spec the output
 * renderer draws (the evidence table, its publication tables, the search log, the appraisal table and the built-in charts).
 */
export function drawables(s = get()) {
  const out = [], built = new Map(builtinOutputs(s).map(o => [o.id, currentSpec(o)]));
  if (builtinLinks(s).some(l => l.id === 'builtin:prisma')) out.push({ key: 'drawn:prisma', concept: 'prisma', type: 'flow', name: 'PRISMA flow diagram', view: 'reporting', viewLabel: 'Reporting', section: 'flow',
    origin: 'From Reporting · the screening counts', node: 'output:builtin:prisma', draw: 'prisma', order: 10 });
  // a primary study's participant flow is drawn by Reporting alone: its row opens that section
  const flow = builtinLinks(s).find(l => l.id === 'builtin:participant-flow');
  if (flow) out.push({ key: 'drawn:participant-flow', concept: '', type: 'flow', name: flow.title, view: 'reporting', viewLabel: 'Reporting', section: flow.section,
    origin: 'From Reporting · the recorded participant populations', node: '', link: true, order: 10 });
  let sets = [];
  try { sets = chartSets(s); } catch { sets = []; }
  for (const set of sets) {
    const fam = familyOf(`${set.tool.id} ${set.tool.name}`);
    out.push({ key: `drawn:rob:${set.tool.id}`, concept: fam ? `rob:${fam}` : '', type: 'rob-plots', name: `Risk of bias · ${set.tool.name}`, view: 'appraisal', viewLabel: 'Appraisal', tool: set.tool.id,
      origin: `From Appraisal · ${set.tool.name} · ${set.done.length} of ${studiesWord(set.n)}`, node: 'dataset:appraisal', draw: 'rob', order: 20 });
  }
  if (built.has('builtin:appraisal')) out.push({ key: 'drawn:rob-table', concept: 'rob-table', type: 'rob-table', name: built.get('builtin:appraisal').title, view: 'appraisal', viewLabel: 'Appraisal',
    origin: 'From Appraisal · every instrument', node: 'output:builtin:appraisal', spec: built.get('builtin:appraisal'), order: 25 });
  const ev = built.get('builtin:evidence'), tid = ev?.query?.template, tpl = (s.templates || []).find(t => t.id === tid);
  if (ev) {
    let model = null;
    try { model = tpl ? evidenceModel(s, tid) : null; } catch { model = null; }
    out.push({ key: 'drawn:evidence', concept: `evidence:${tid || 'default'}`, type: 'evidence', name: ev.title, view: 'extraction', viewLabel: 'Extraction', ...(tpl ? { evidence: tid } : {}),
      origin: `From Extraction${tpl ? ` · ${tpl.name}` : ''}${model ? ` · ${studiesWord(model.studies.length)}` : ''}`, node: 'output:builtin:evidence', spec: ev, order: 30 });
    // its publication tables (lib/evidence-export.mjs wordTables): one per collection named "Table N", drawn by the output renderer over the same columns
    for (const cfg of model ? wordTables(model) : []) {
      const coll = (s.collections || []).find(c => c.id === cfg.collection), n = Number(/\d+/.exec(coll?.name || '')?.[0]);
      if (!coll || !n) continue;
      const select = cfg.columns.map(id => tpl.columns.find(c => c.id === id)).filter(c => c && !isIdColumn(c)).map(c => c.label);
      if (!select.some(l => /^study$/i.test(l))) select.unshift('Study label');   // a row is named by its study once
      out.push({ key: `drawn:pubtable:${n}`, concept: `pubtable:${n}`, type: 'characteristics', name: `${coll.name}${cfg.caption ? ` · ${cfg.caption}` : ''}`, view: 'extraction', viewLabel: 'Extraction', evidence: tid, collection: coll.id,
        origin: `From Extraction · ${tpl.name} · ${studiesWord((coll.members || []).length)}`, node: `collection:${coll.id}`, order: 31 + n / 100,
        spec: { id: `paper:table-${n}`, kind: 'table', title: coll.name, query: { from: 'studies', template: tid, collection: coll.name, select }, exports: ['xlsx', 'docx', 'csv'] } });
    }
  }
  // the evidence map: once its fields are chosen (Reporting's map of a scoping review, or the fields a printed evidence map's legend names,
  // views/outputs.mjs drawPrinted), a cross-tabulation of the included studies, each arm in its own cell
  if (s.evidenceMap) {
    const { row, col } = mapFields(s), map = row && col ? evidenceMap(s, row, col) : null;
    if (map?.total) out.push({ key: 'drawn:evidence-map', concept: 'evidence-map', type: 'evidence-map', name: 'Evidence map', view: 'extraction', viewLabel: 'Extraction',
      origin: `From Extraction · ${map.rowField.label} by ${map.colField.label}`, node: 'dataset:extraction', draw: 'evidence-map', order: 35 });
  }
  if (built.has('builtin:searches')) {
    out.push({ key: 'drawn:searches', concept: 'searches', type: 'searches', name: built.get('builtin:searches').title, view: 'reporting', viewLabel: 'Reporting', section: 'search',
      origin: `From the search log · ${(s.searches || []).length} ${(s.searches || []).length === 1 ? 'search' : 'searches'}`, node: 'output:builtin:searches', spec: built.get('builtin:searches'), order: 40 });
    // the summary needs inclusion decisions as well as the log: before them it is an empty table, so it is not listed
    const summary = searchSummary(s);
    if (summary.started && summary.rows.length) out.push({ key: 'drawn:search-summary', concept: 'search-summary', type: 'search-summary', name: 'Search summary', view: 'reporting', viewLabel: 'Reporting', section: 'summary',
      origin: 'From the search log and the inclusion decisions', node: 'dataset:searches', draw: 'summary', order: 41 });
  }
  for (const o of outcomes(s)) for (const t of timepointsOf(s, o.id)) {
    const slot = slotId(o.id, t.id), a = analysisOf(s, slot), arms = o.derived?.kind === 'arm-contrast' ? o.derived.arms : null;
    const ran = !!a && a.estimate != null;
    // a comparison of two arms is the forest it will draw before it runs: its row says Not run, with Open in Analysis
    if (!ran && !(arms?.treated && arms?.control)) continue;
    const name = [o.name || 'Pooled effect', t.label].filter(Boolean).join(' · ');
    const sides = a?.contrast ? [a.contrast.treated, a.contrast.control] : arms ? [arms.treated, arms.control] : null;
    // a comparison of two arms names its sides, so the caption that names them places it (lib/paper-items.mjs)
    out.push({ key: `drawn:forest:${slot}`, concept: `forest:${slot}`, type: 'forest', name: `Forest plot · ${name}`, view: 'analysis', viewLabel: 'Analysis', outcome: o.id, slot, outcomeName: name,
      ...(sides ? { sides } : {}), ...(ran ? {} : { notRun: true }),
      origin: ran ? `From Analysis · ${name}${a.k ? ` · ${studiesWord(a.k)}` : ''}` : `From Analysis · ${name} · not run`, node: `analysis:${slot}`, draw: 'forest', order: 50 });
  }
  let profile = null, swim = null;
  try { profile = profileOf(s); swim = swimOf(s); } catch { /* a project with no certainty work draws neither */ }
  if (profile?.rows?.length) {
    const rated = `${profile.rows.length} ${profile.rows.length === 1 ? 'outcome' : 'outcomes'}`;
    out.push({ key: 'drawn:sof', concept: 'sof', type: 'sof', name: 'Summary of findings', view: 'certainty', viewLabel: 'Certainty', origin: `From Certainty · ${rated}`, node: '', draw: 'sof', order: 59 },
      { key: 'drawn:profile', concept: 'profile', type: 'profile', name: 'GRADE evidence profile', view: 'certainty', viewLabel: 'Certainty', section: 'evidence-profile',
        origin: `From Certainty · ${rated}`, node: '', draw: 'profile', order: 60 });
  }
  // a printed comparison drawn from its own counts (views/outputs.mjs drawPrinted, lib/figure-counts.mjs): placed at the figure it was run for
  for (const [label, run] of Object.entries(s.figureRuns || {})) {
    if (!run?.labels?.length) continue;
    out.push({ key: `drawn:figure-run:${label}`, concept: '', printedAs: label, type: 'forest', name: `Forest plot · ${run.outcomeName || `${run.contrast?.treated} vs ${run.contrast?.control}`}`,
      view: 'outputs', viewLabel: 'Tables and figures', origin: `From ${String(run.source).slice(String(run.source).lastIndexOf('/') + 1)} · ${studiesWord(run.labels.length)}`,
      node: '', draw: 'forest', run, order: 59 });
  }
  // a printed synthesis without meta-analysis of a collection's studies (views/outputs.mjs drawPrinted chose the collection its caption names):
  // each arm's events by outcome, read from the evidence table (lib/swim-events.mjs), placed at the figure it was made for
  for (const [label, choice] of Object.entries(s.swimTables || {})) {
    const coll = (s.collections || []).find(c => c.id === choice?.collection), t = (s.templates || []).find(x => x.id === choice?.template);
    if (!coll || !t) continue;
    out.push({ key: `drawn:swim-events:${label}`, concept: '', printedAs: label, type: 'swim', name: 'Synthesis without meta-analysis', view: 'extraction', viewLabel: 'Extraction',
      origin: choice.data ? `From ${choice.data.slice(choice.data.lastIndexOf('/') + 1)} · ${coll.name} · ${studiesWord((coll.members || []).length)}`
        : `From Extraction · ${t.name} · ${coll.name} · ${studiesWord((coll.members || []).length)}`, node: `collection:${coll.id}`, draw: 'swim-events', swim: choice, order: 62 });
  }
  if (swim?.outcomes?.length) out.push({ key: 'drawn:swim', concept: 'swim', type: 'swim', name: 'Synthesis without meta-analysis', view: 'certainty', viewLabel: 'Certainty', section: 'swim',
    origin: `From Certainty · ${swim.outcomes.length} outcome ${swim.outcomes.length === 1 ? 'domain' : 'domains'}`, node: '', draw: 'swim', order: 61 });
  // the built-in charts and tables of this page: drawn and edited here (a duplicate is a saved output)
  for (const id of ['builtin:year', 'builtin:collections', 'builtin:cases', 'builtin:strategy']) if (built.has(id)) {
    const spec = built.get(id);
    out.push({ key: `drawn:${id.slice(8)}`, concept: '', type: spec.kind === 'chart' ? 'chart' : id === 'builtin:cases' ? 'cases' : 'table', name: spec.title, view: 'outputs', viewLabel: 'Tables and figures',
      origin: 'Built in', node: `output:${id}`, spec, order: 70 });
  }
  if (studyCharts.hasFieldChart(s)) out.push({ key: 'drawn:study-field', concept: '', type: 'chart', name: 'Studies by characteristic', view: 'outputs', viewLabel: 'Tables and figures',
    origin: 'From the included studies', node: '', draw: 'study', order: 71 });
  return out;
}

// ---- the folder: its result files, the captions of its documents, the dependency graph ----------------------------------------------
const DOC_MAX = 8 * 1024 * 1024, DOCS_MAX = 8;
const captionCache = new Map();   // `${path}|${size}|${mtime}` → captions; a document is parsed once a session while it is unchanged
let loaded = null;                // { folder, generation, at, rows, captions, graph, facts }
const FRESH_MS = 30_000;

// a short, draft or copied version of a document numbers its items its own way: read after the documents of record
const variant = name => (/(^|[_\s-])(short|draft|copy|temp|old|test)([_\s.-]|$)/i.test(name) ? 1 : 0);
/** The documents whose captions place items: Word files named for figures, tables, a supplement or a manuscript, the newest first, not working or earlier copies. */
function captionDocs(rows, isEarlier, isWorking) {
  const seen = new Set(), out = [];
  const docs = rows.filter(r => r.paths.docx && !isEarlier(r.paths.docx) && !isWorking(r.paths.docx, r.name) && /figure|table|supplement|legend|manuscript|paper|main/i.test(r.name))
    .sort((a, b) => variant(a.name) - variant(b.name) || (b.mtime || 0) - (a.mtime || 0));
  for (const r of docs) {
    const key = `${r.name}|${r.size}`;
    if (seen.has(key) || (r.size || 0) > DOC_MAX) continue;
    seen.add(key); out.push(r);
    if (out.length >= DOCS_MAX) break;
  }
  return out;
}
async function readCaptions(folder, row) {
  const path = row.paths.docx, key = `${path}|${row.size}|${row.mtime}`;
  if (captionCache.has(key)) return captionCache.get(key);
  let found = [];
  try {
    const parsed = await parseDocx(await folder.read(path));
    found = captionsIn(parsed.blocks.filter(b => b.type !== 'table' && b.type !== 'figure').map(b => String(b.text || '').replace(/\{\{[^}]*\}\}/g, '')), path, captionOf);
  } catch { found = []; }
  captionCache.set(key, found);
  return found;
}
/** The package's items as captions: an item's label is its place in the paper, its source file a printed version (plan, package amendment). */
function packageCaptions(s) {
  const pkg = s.package;
  if (!pkg?.items) return [];
  const L = packageLabels(pkg), out = [];
  for (const part of pkg.parts || []) for (const id of part.items || []) {
    const it = pkg.items[id], label = L.get(id);
    const m = /^(Table|Figure)\s+(S?)(\d+)$/.exec(label || '');
    if (!it || !m) continue;
    out.push({ label, kind: m[1] === 'Table' ? 'table' : 'figure', supp: !!m[2], n: Number(m[3]), title: plainText(it.title, x => L.get(x)).trim() || label, text: plainText(it.legend || '', x => L.get(x)),
      doc: part.file || '', paths: it.source?.path ? [it.source.path] : [] });
  }
  return out;
}

/** What the dependency graph says of a file, for the items (lib/paper-items.mjs `graph`). */
export function graphFacts(g) {
  if (!g) return {};
  const nodeOf = p => g.nodes.get(`file:${p}`);
  const into = id => g.into.get(id) || [], outOf = id => g.out.get(id) || [];
  return {
    templateOf(p) {
      const n = nodeOf(p); if (!n) return null;
      for (const e of outOf(n.id)) if (e.kind === 'adopted-into') { const c = g.nodes.get(e.to); if (c?.table) return c.table; }
      return null;
    },
    madeFrom(p) {
      const n = nodeOf(p); if (!n) return [];
      const out = [];
      for (const e of into(n.id)) {
        const from = g.nodes.get(e.from);
        if (e.kind === 'writes') { const inputs = into(from.id).filter(x => x.kind === 'read-by').map(x => baseOf(g.nodes.get(x.from).label)); out.push(`Made by ${baseOf(from.label)}${inputs.length ? ` from ${inputs.slice(0, 3).join(', ')}${inputs.length > 3 ? ` and ${inputs.length - 3} more` : ''}` : ''}`); }
        else if (from?.kind === 'file') out.push(`Built from ${baseOf(from.label)}`);
      }
      return out;
    },
    usedBy(p) {
      const n = nodeOf(p); if (!n) return [];
      const out = [], tables = new Set();
      for (const e of outOf(n.id)) {
        const to = g.nodes.get(e.to);
        if (e.kind === 'adopted-into' && to?.table) { const t = g.nodes.get(`template:${to.table}`); tables.add(t?.label || to.table); }
        else if (to?.kind === 'script') out.push(`Read by ${baseOf(to.label)}`);
        else if (to?.kind === 'output') out.push(`In the package as ${to.label}`);
        else if (to?.kind === 'file') out.push(`Used for ${baseOf(to.label)}`);
      }
      return [...[...tables].map(t => `Supplied the cells of ${t}`), ...out];
    },
  };
}

/**
 * The folder read for the page: its result rows and captions first (`onRows`), then the dependency graph (`onGraph`), each once per folder
 * and project state for half a minute. Returns the last result at once when it is fresh, so a redraw shows what it showed.
 */
export function folderPaper(folder, { onUpdate = () => {} } = {}) {
  const gen = projectGeneration(), fresh = loaded && loaded.folder === folder && Date.now() - loaded.at < FRESH_MS;
  if (fresh && loaded.generation === gen) return loaded;
  if (!folder) { loaded = null; return null; }
  const had = loaded && loaded.folder === folder ? loaded : null;
  const cur = { folder, generation: gen, at: Date.now(), rows: had?.rows || null, captions: had?.captions || [], graph: had?.graph || null, facts: had?.facts || null, sig: had?.sig || '', state: had?.state || null };
  loaded = cur;
  (async () => {
    let rows = [];
    try { rows = (await folderResults(folder)).flatMap(g => g.items); } catch { rows = []; }
    const caps = [];
    for (const r of captionDocs(rows, isEarlier, isWorking)) caps.push(...await readCaptions(folder, r));
    if (loaded !== cur) return;
    // a folder read again that gives what it gave is not news: the page is not drawn again under the person
    const sig = `${rows.map(r => `${r.open}:${r.mtime}:${r.size}`).join('|')}#${caps.map(c => `${c.label}:${c.title}:${c.doc}`).join('|')}`;
    const same = had?.sig === sig;
    cur.sig = sig;
    if (!same) { cur.rows = rows; cur.captions = caps; onUpdate(cur); }
    try {
      const [depsFiles, depsGraph] = await Promise.all([import('../lib/deps-files.mjs'), import('../lib/deps-graph.mjs')]);
      const keep = had?.facts && had.at > Date.now() - FRESH_MS * 10;   // the scripts are read again after five minutes
      cur.facts = keep ? had.facts : await depsFiles.collectFileFacts(folder);
      cur.state = get();
      cur.graph = keep && same && had.graph && had.state === cur.state ? had.graph : depsGraph.buildGraph(cur.state, cur.facts);
    } catch { cur.graph = null; }
    if (loaded === cur && (!same || cur.graph !== had?.graph)) onUpdate(cur);
  })();
  return cur;
}
/** Forgets what was read, so the next visit reads the folder again. */
export const forgetFolder = () => { loaded = null; };

/**
 * The tables and figures the app draws that the package or the manuscript holds (lib/app-items.mjs placements), as captions that name their
 * drawing (`drawn`), so the drawing is listed at that place (Figure S2, Table 1) and its connections say where it is used.
 */
function placedCaptions(s, list) {
  const out = [];
  for (const [key, places] of placements(s)) {
    const d = list.find(x => keysOfDrawn(x).some(k => k.key === key));
    if (!d) continue;
    for (const p of places) {
      const m = /^(Table|Figure)\s+(S?)(\d+)$/.exec(p.label || '');
      if (!m) continue;
      out.push({ label: p.label, kind: m[1] === 'Table' ? 'table' : 'figure', supp: !!m[2], n: Number(m[3]), title: p.title || d.name, text: '', doc: '', drawn: d.key, where: p.where });
    }
  }
  return out;
}
/** The items of the page from the drawables and what the folder gave (lib/paper-items.mjs). */
export function itemsOf(s, got) {
  const list = drawables(s), placed = placedCaptions(s, list);
  const inPackage = placed.filter(c => c.where === 'package'), labelled = new Set(inPackage.map(c => c.label));
  const items = paperItems({ drawables: list, rows: got?.rows || [], graph: graphFacts(got?.graph),
    captions: [...inPackage, ...packageCaptions(s).filter(c => !labelled.has(c.label)), ...placed.filter(c => c.where === 'manuscript'), ...(got?.captions || [])] });
  // where the paper holds each drawing: the package's part and label, the manuscript's figure or table
  const at = placements(s);
  for (const it of items.items) if (it.drawn) for (const k of keysOfDrawn(it.drawn)) for (const p of at.get(k.key) || []) {
    const words = p.where === 'package' ? `In the package as ${p.label} (${p.part})` : `In the manuscript as ${p.label}`;
    if (!it.usedBy.includes(words)) it.usedBy.push(words);
  }
  return items;
}

/** What the graph says of a drawing: what it is read from and where it ends up, in words. */
export async function nodeFacts(g, id) {
  if (!g || !id || !g.nodes.has(id)) return { madeFrom: [], usedBy: [] };
  const dg = await import('../lib/deps-graph.mjs');
  const o = dg.origins(g, id), d = dg.deliverables(g, id, { steps: false });
  const named = o.items.filter(n => ['template', 'dataset', 'file', 'script', 'analysis', 'collection'].includes(n.kind)).slice(0, 4).map(n => (n.kind === 'file' || n.kind === 'script' ? baseOf(n.label) : n.label));
  const rest = dg.restText(o.rest);
  return { madeFrom: [named.length ? `Reads ${named.join(', ')}` : '', rest ? `Built from ${rest}` : ''].filter(Boolean), usedBy: d.total ? [`Used in ${dg.endsText(d.counts)}`] : [] };
}

// ---- drawing an item --------------------------------------------------------------------------------------------------------------
const screen = () => figureTokens(null, { medium: 'screen' }), print = () => figureTokens(null, { medium: 'export' });

/** Draws a drawable that is not an output spec into `host`, with the renderer its own page uses. */
/**
 * A drawn item with nothing to show yet: what fills it, and a button to the page that does (its source view). Tables and figures' item
 * page names the item in its title bar, so this says what is missing, not the item again.
 */
function emptyItem(host, d, ctx, title, detail) {
  host.innerHTML = emptyState({ icon: 'clock', title, detail, help: true, actions: [{ id: 'item-go', label: `Open ${d.viewLabel}`, primary: true }] });
  host.querySelector('#item-go')?.addEventListener('click', () => openSource(d, ctx));
}
/** Why a drawn item has nothing to show, or '' (its title bar's Download is off while there is nothing). */
export function drawnEmpty(d, s = get()) {
  if (d?.draw === 'summary') return !!searchSummary(s).rows.length && searchSummary(s).started ? '' : 'empty';
  if (d?.draw === 'sof') return drawApp(s, 'sof').error ? 'empty' : '';
  return '';
}
/** The downloads of a drawn item that has no output spec, for its title bar's Download: null when it has none of its own. */
export async function drawnMenu(d, note = () => {}) {
  if (d?.draw === 'summary') return (await import('./search-summary-panel.mjs')).summaryMenu(note);
  if (d?.draw === 'sof') {
    const { downloadCsv } = await import('../lib/figure.mjs');
    return [{ label: 'CSV', icon: 'download', run: () => { const sof = drawApp(get(), 'sof'); if (!sof.error) downloadCsv(sof.rows, 'summary-of-findings.csv'); } }];
  }
  return null;
}
export const hasItemMenu = d => ['summary', 'sof'].includes(d?.draw);

export async function drawInto(host, d, ctx) {
  const s = get();
  if (d.draw === 'prisma') {
    const rp = await import('./reporting.mjs'), sub = await import('../lib/submission.mjs');
    host.innerHTML = figurePanel({ title: 'Flow diagram', id: 'tf-flow' });
    showFigure(host, 'tf-flow', rp.previewSvg(false, 'screen'), 'prisma-flow', { exportSvg: () => rp.previewSvg(false, 'export'),
      data: () => [['Count', 'Value', 'Source'], ...sub.prismaCountRows(get()).map(r => [r.label, r.count, r.source])] });
    return;
  }
  if (d.draw === 'rob') {
    const set = chartSets(s).find(x => x.tool.id === d.tool);
    if (!set) { emptyItem(host, d, ctx, 'No complete assessment yet', 'The plots draw each study once its risk-of-bias judgements are complete.'); return; }
    const { tool, done } = set, source = [`${done.length} of ${studiesWord(set.n)} appraised`];
    const judgements = () => [['Study', ...[...tool.domains, ...(tool.overall ? [{ id: 'overall', label: 'Overall' }] : [])].map(x => x.label)],
      ...done.map(r => [r.label, ...[...tool.domains.map(x => x.id), ...(tool.overall ? ['overall'] : [])].map(id => r.values[id] || '')])];
    host.innerHTML = `${figurePanel({ title: 'Traffic light', id: 'tf-tl' })}${figurePanel({ title: 'Summary', id: 'tf-sm' })}`;
    showFigure(host, 'tf-tl', trafficLight(tool, done, JUDGEMENT_TONE, { style: screen() }), 'risk-of-bias-traffic-light',
      { exportSvg: () => trafficLight(tool, done, JUDGEMENT_TONE, { style: print(), source }), data: judgements });
    showFigure(host, 'tf-sm', summaryBars(tool, done, JUDGEMENT_TONE, { style: screen() }), 'risk-of-bias-summary',
      { exportSvg: () => summaryBars(tool, done, JUDGEMENT_TONE, { style: print(), source }), data: judgements });
    return;
  }
  if (d.draw === 'forest') {
    const a = d.run || analysisOf(s, d.slot), fp = await import('../lib/forest-page.mjs');
    // a comparison not run yet: the title bar's Open in Analysis runs it
    if (!a || a.estimate == null) { emptyItem(host, d, ctx, 'Not run yet', 'The forest plot draws once this outcome\'s analysis has run.'); return; }
    host.innerHTML = figurePanel({ title: 'Forest plot', id: 'tf-forest' });
    const opts = { labels: a.labels };
    if (!fp.mountForest(host, 'tf-forest', a, opts) && !withFigure(a, 'svg', svg => showFigure(host, 'tf-forest', svg, 'forest-plot', opts), () => figureMissing(host, 'tf-forest'))) figureMissing(host, 'tf-forest');
    return;
  }
  if (d.draw === 'summary') {
    const sp = await import('./search-summary-panel.mjs');
    if (sp.summaryEmpty(s)) { emptyItem(host, d, ctx, sp.summaryEmpty(s), 'The summary counts, for each database, the records found and the studies included. It fills in once screening has decisions.'); return; }
    host.innerHTML = sp.summaryBody(s);   // headed and downloaded from the title bar (views/outputs.mjs)
    return;
  }
  if (d.draw === 'sof') {
    const sof = drawApp(s, 'sof');
    if (sof.error) { emptyItem(host, d, ctx, sof.error, 'The table fills in once an outcome is rated in Certainty.'); return; }
    const [head, ...body] = sof.rows;
    host.innerHTML = `<div class="panel"><div class="panel-body">${tableRegion({ label: 'Summary of findings', sticky: true, html: `<table class="ep-table"><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map(r => `<tr><th scope="row">${esc(r[0] || '—')}</th>${r.slice(1).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}
      ${sof.notes.length ? `<ol class="ep-notes">${sof.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ol>` : ''}</div></div>`;
    return;
  }
  if (d.draw === 'evidence-map') {
    const { row, col } = mapFields(s), map = evidenceMap(s, row, col);
    host.innerHTML = figurePanel({ title: 'Evidence map', id: 'tf-map' });
    const shade = s.evidenceMap?.shade || '', patients = s.evidenceMap?.patients || '';
    showFigure(host, 'tf-map', evidenceMapSvg(map, { style: screen(), shade, patients }), 'evidence-map', { exportSvg: () => evidenceMapSvg(evidenceMap(get(), row, col), { style: print(), shade, patients }),
      data: () => evidenceMapRows(evidenceMap(get(), row, col)) });
    return;
  }
  if (d.draw === 'swim-events') {
    host.innerHTML = swimEventsHtml(await swimRowsFor(s, d.swim, (await import('../lib/projects.mjs')).activeFolder()));
    return;
  }
  if (d.draw === 'swim') { (await import('./certainty-extra.mjs')).renderSwim(host, ctx, true); return; }
  if (d.draw === 'profile') { (await import('./certainty-extra.mjs')).renderProfile(host, ctx); return; }
  if (d.draw === 'study') studyCharts.render(host, ctx, 'field');
}

/**
 * A synthesis without meta-analysis's rows: the printed figure's own table when the folder holds it (`choice.data`, found once by
 * views/outputs.mjs drawPrinted) and it reads, its names and results as printed; else the evidence table's (lib/swim-events.mjs).
 */
export async function swimRowsFor(s, choice, folder) {
  const se = await import('../lib/swim-events.mjs'), app = se.swimEventRows(se.swimEvents(s, choice));
  if (choice?.data && folder) {
    try { return se.rowsFromData(JSON.parse(new TextDecoder().decode(await folder.read(choice.data))), app) || app; } catch { /* a file that no longer reads: the evidence table's */ }
  }
  return app;
}

/**
 * A synthesis without meta-analysis as the page draws it: the evidence profile's table, a heading row per group, the study named on its first
 * arm, the counts and directions centred under their outcomes, the direction of effect in italics, the footnotes under it.
 */
export function swimEventsHtml(r) {
  if (!r.head.length) return '<p class="out-none meta">Its studies are no longer in the project</p>';
  const n = r.head.length, num = i => (i >= 2 ? ' class="swe-n"' : '');
  // a row just above a group's heading row is marked here (swe-pre), not found by the stylesheet: a :has() that styles the cells after it
  // makes every change on the page restyle the whole page (plan, 2026-10-18 speed entry)
  const pre = i => (r.body[i + 1]?.kind === 'group' ? ' swe-pre' : '');
  const row = (b, i) => (b.kind === 'group' ? `<tr class="swe-group${pre(i)}"><th scope="colgroup" colspan="${n}">${esc(b.cells[0])}</th></tr>`
    : `<tr${b.kind === 'direction' || pre(i) ? ` class="${[b.kind === 'direction' ? 'swe-dir' : '', pre(i).trim()].filter(Boolean).join(' ')}"` : ''}>${b.cells.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td${num(i)}>${esc(c)}</td>`)).join('')}</tr>`);
  return `<div class="panel"><div class="panel-body">${tableRegion({ label: 'Synthesis without meta-analysis', sticky: true, html: `<table class="ep-table swe-table"><thead><tr>${r.head.map((h, i) => `<th scope="col"${num(i)}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${r.body.map(row).join('')}</tbody></table>` })}
    ${r.notes.length ? `<ul class="ep-notes swe-notes">${r.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>`;
}

/** "Open in …": the drawable's own page, on the drawing. */
export async function openSource(d, ctx) {
  if (d.view === 'reporting') return ctx.openReporting ? ctx.openReporting(d.section || 'flow') : ctx.go('reporting');
  if (d.view === 'appraisal') { if (d.tool) openCharts(d.tool); return ctx.go('appraisal'); }
  if (d.view === 'analysis') { const an = await import('./analysis.mjs'); an.selectOutcome?.(d.outcome); return ctx.go('analysis'); }
  if (d.view === 'certainty') { const c = await import('./certainty.mjs'); c.select?.(d.section); return ctx.go('certainty'); }
  return ctx.go(d.view);
}

/** A printed version shown on its own: an image of the folder as it is, read when the item opens (PNG, JPEG, SVG, GIF, WebP). */
export async function imageOf(folder, row) {
  const ext = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].find(x => row.paths?.[x]);
  if (!folder || !ext) return '';
  try {
    const bytes = await folder.read(row.paths[ext]);
    if (ext === 'svg') return sanitizeSvg(new TextDecoder().decode(bytes));
    const url = URL.createObjectURL(new Blob([bytes], { type: ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}` }));
    return `<img class="tf-print-img" src="${esc(url)}" alt="${esc(baseOf(row.paths[ext]))}">`;
  } catch { return ''; }
}

export { typeWord };
