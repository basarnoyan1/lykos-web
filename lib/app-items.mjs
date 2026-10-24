// The tables and figures the app draws from its own data, as things the paper can hold (plan amendment "The package and the manuscript take
// the app's tables and figures", 2026-10-17). One key names each: the package's item (`source: { app: key }`), the manuscript's linked block
// (`app: { key, sig }`) and Tables and figures' row are three views of the same drawing, made by the renderer its own page uses:
//
//   forest:<slot>            Analysis's forest plot of a pooled outcome (the house drawing in full; R's figure for a result without per-study numbers)
//   rob-traffic:<tool>       Appraisal's traffic-light plot of one instrument;  rob-summary:<tool> its summary plot
//   prisma                   Reporting's PRISMA flow diagram
//   sof · profile            Certainty's Summary of findings and GRADE evidence profile (tables)
//   swim-table · harvest     Certainty's effect direction table and harvest plot (synthesis without meta-analysis)
//   output:<id>              a saved or built-in output of Tables and figures (a table, or a chart drawn as a figure)
//   synth:<kind>:<outcome>:<code>   Syntheses' forest, effect-direction or proportion figure of one combination (lib/synth-figures.mjs)
//   evidence:<table>[:<collection>]   Extraction's evidence table, or one of its publication tables
//   dataset:<id>             a kept dataset analysis (Datasets, or a Kaplan–Meier from Make): its figure, else its first table
//   survival                 the patient data's Kaplan–Meier (Analysis)
//   study:<field>            the included studies by one characteristic (Tables and figures' study chart)
//
// `appSig` signs what a drawing reads (its print copy, or its rows), so a package part built from it and a manuscript block inserted from it
// can tell that the data changed since. Pure but for the rasteriser, which is given (Node has none) or the browser's (lib/figure-draw.mjs).
import { inRobScope, robScopeWords } from './rob-scope.mjs';
import { figureTokens } from './figure-style.mjs';
import { rasterSvg, rasterPlan } from './figure-draw.mjs';
import { JUDGEMENT_TONE } from '../schema.mjs';
import { trafficLight, summaryBars } from './appraisal-fig.mjs';
import { robvisTrafficLight, robvisSummary } from './appraisal-robvis.mjs';
import { studies } from './screen.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { effectiveAnswers, STUDY } from './rob-review.mjs';
import { isComplete } from './appraisal-summary.mjs';
import { outcomes, timepointsOf, slotId, analysisOf, parseSlot } from './outcomes.mjs';
import { forestData, forestPageSvg, forestSource } from './forest-page.mjs';
import { heterogeneityLine } from './figure-house-render.mjs';
import { figureFor } from './figures.mjs';
import { prismaFlow } from './prisma-flow.mjs';
import { prismaData } from './prisma-counts.mjs';
import { summaryOfFindings, toBlocks as sofBlocks } from './sof.mjs';
import { profileOf } from './evidence-profile.mjs';
import { profileCells } from './grade-profile.mjs';
import { swimOf, swimRows, signP } from './swim-state.mjs';
import { effectDirection, harvestPlotSvg } from './swim.mjs';
import { builtinOutputs, builtinLinks, outputById, currentSpec } from './output-spec.mjs';
import { renderOutput, chartSvg } from './output-render.mjs';
import { evidenceGrid } from './package-select.mjs';
import { labels as packageLabels, plainText } from './package.mjs';
import { synthesisModel } from './synth-project.mjs';
import { figureOf } from './synth-figures.mjs';
import { analysisSvg } from './analysis-svg.mjs';
import { kmFigure, survivalFigureOptions } from './survival-fig.mjs';
import { sourceById, analysisOf as datasetKind } from './dataset-analysis-core.mjs';
import { chartableFields } from './charts.mjs';
import { valueFor } from './fields.mjs';
import { detectCharacteristic, selectedVisual, renderCharacteristic, visualNote } from './characteristic-visuals.mjs';
import { fieldParts, itemMap, projectMap, evidenceMapSvg } from './evidence-map.mjs';

const print = () => figureTokens(null, { medium: 'export' });
const studiesWord = n => `${n} ${n === 1 ? 'study' : 'studies'}`;
const DIRECTION_WORD = { benefit: 'Benefit', harm: 'Harm', 'no clear': 'No clear effect', mixed: 'Mixed' };

/**
 * Each instrument in use with its complete study-level assessments: what Appraisal's charts draw (views/appraisal.mjs chartSets). `item` a
 * package item whose own scope (it.robScope) its figure draws; `all` every appraised study, whatever is saved (lib/folder-sync.mjs).
 */
export function robSets(s, { item = null, all = false } = {}) {
  const used = new Map();
  for (const x of studies(s)) {
    const t = instrumentFor(s, x.id), u = used.get(t.id) || { tool: t, n: 0, done: [] }, values = effectiveAnswers(s, x.id, t.id, STUDY).answers;
    u.n++;
    if (isComplete(t, values)) u.done.push({ study: x.id, label: x.label, values });
    used.set(t.id, u);
  }
  // a figure restricted to the studies of an outcome, or a chosen set, draws those (lib/rob-scope.mjs)
  if (!all) for (const u of used.values()) u.done = inRobScope(s, u.tool.id, u.done, item);
  return [...used.values()].filter(u => u.done.length).sort((a, b) => b.done.length - a.done.length || b.n - a.n);
}

/**
 * A grid of the package's and the manuscript's table blocks from rows of text, the first row the header. A column is given its longest word
 * (no word breaks inside a column whose cells are short) or half its longest cell, whichever is more, so long text wraps in the wide columns.
 */
export function gridOf(rows, { borders = 'all' } = {}) {
  const cols = Math.max(1, ...rows.map(r => r.length));
  const need = Array.from({ length: cols }, (_, c) => {
    const texts = rows.map(r => String(r[c] ?? ''));
    return Math.max(4, ...texts.flatMap(x => x.split(/\s+/).map(w => Math.min(16, w.length) + 2)), ...texts.map(x => Math.min(30, Math.ceil(x.length / 2))));
  });
  const total = need.reduce((a, x) => a + x, 0);
  return { cols: need.map(x => Math.round((468 * x) / total)), borders,
    rows: rows.map((r, i) => ({ header: i === 0, cells: Array.from({ length: cols }, (_, c) => ({ text: String(r[c] ?? '') })) })) };
}

const outputSpec = (s, id) => currentSpec(outputById(s, id)) || currentSpec(builtinOutputs(s).find(o => o.id === id)) || null;
const forestTitle = (s, slot) => {
  const { outcomeId } = parseSlot(slot), o = outcomes(s).find(x => x.id === outcomeId), t = timepointsOf(s, outcomeId).find(x => slotId(outcomeId, x.id) === slot);
  return [o?.name || 'Pooled effect', t?.label].filter(Boolean).join(', ');
};

/** A kept dataset analysis's name: its result's own title, else its figure's ("Kaplan–Meier: Revision by Construct"), else its kind's ("Table 1"). */
export const datasetTitle = a => { const kind = datasetKind(a?.kind)?.label, r = a?.result || {}; return (r.title && r.title !== kind ? r.title : r.plot?.title || r.title) || kind || 'Analysis'; };
/** The patient data's Kaplan–Meier, by name. */
export const survivalTitle = sv => sv?.ext?.figure?.title || (sv?.ext?.groupName ? `Kaplan–Meier by ${String(sv.ext.groupName).toLowerCase()}` : 'Kaplan–Meier');
/** Whether a kept dataset analysis draws as a figure (else as its first table). */
export const datasetDrawsFigure = a => !!a?.result?.plot && a.result.plot.kind !== 'none';
/**
 * The characteristic Tables and figures charts the included studies by: `preferred` when it is still charted, else the study-design field
 * that holds the most answers, else the first (views/study-charts.mjs chooses the same way).
 */
export function studyField(s, preferred = '') {
  const inc = studies(s), opts = chartableFields(s, inc), filled = f => inc.filter(p => valueFor(s, p.id, f)).length;
  return opts.find(x => x.id === preferred) || opts.filter(x => /design/i.test(x.label)).sort((a, b) => filled(b) - filled(a))[0] || opts[0] || null;
}

/** What can be placed now: `[{ key, kind: 'figure' | 'table', title, view }]`, in the order of the review. */
export function appItems(s) {
  const out = [];
  if (builtinLinks(s).some(l => l.id === 'builtin:prisma')) out.push({ key: 'prisma', kind: 'figure', title: 'PRISMA flow diagram', view: 'Reporting' });
  for (const set of robSets(s)) {
    out.push({ key: `rob-traffic:${set.tool.id}`, kind: 'figure', title: `Risk of bias: ${set.tool.name}, traffic light`, view: 'Appraisal' },
      { key: `rob-summary:${set.tool.id}`, kind: 'figure', title: `Risk of bias: ${set.tool.name}, summary`, view: 'Appraisal' });
  }
  for (const o of outcomes(s)) for (const t of timepointsOf(s, o.id)) {
    const slot = slotId(o.id, t.id), a = analysisOf(s, slot);
    if (a && a.estimate != null) out.push({ key: `forest:${slot}`, kind: 'figure', title: `Forest plot: ${forestTitle(s, slot)}`, view: 'Analysis' });
  }
  if ((s.grade || []).some(r => r && typeof r === 'object')) out.push({ key: 'sof', kind: 'table', title: 'Summary of findings', view: 'Certainty' }, { key: 'profile', kind: 'table', title: 'GRADE evidence profile', view: 'Certainty' });
  if (projectMap(s)?.total) out.push({ key: 'map', kind: 'figure', title: 'Evidence map', view: 'Tables and figures' });
  if (swimOf(s).outcomes.length) out.push({ key: 'swim-table', kind: 'table', title: 'Effect direction table', view: 'Certainty' }, { key: 'harvest', kind: 'figure', title: 'Harvest plot', view: 'Certainty' });
  for (const a of s.datasetAnalyses || []) if (a?.result) out.push({ key: `dataset:${a.id}`, kind: datasetDrawsFigure(a) ? 'figure' : 'table', title: datasetTitle(a), view: a.made || 'Datasets' });
  if (s.survival?.ext?.km || s.survival?.plot) out.push({ key: 'survival', kind: 'figure', title: survivalTitle(s.survival), view: 'Analysis' });
  return out;
}

/**
 * The drawing of `key` from the project as it is, synchronously: `{ kind: 'figure', title, svg }` (the print copy, FIGURE-STYLE §2),
 * `{ kind: 'table', title, rows, notes }` (the header first), `{ kind: 'figure', title, slot }` for a forest only R drew, or `{ error }`.
 */
export function drawApp(s, key, { item = null, doc = null } = {}) {
  const [head, ...rest] = String(key || '').split(':'), arg = rest.join(':');
  // item:<id>: a Package item's figure as one drawing, its several drawings (`source.apps`) stacked, under A, B, ... when it has `panels`
  if (head === 'item') {
    const it = s.package?.items?.[arg];
    if (!it) return { error: 'No such Package item' };
    const keys = Array.isArray(it.source?.apps) && it.source.apps.length ? it.source.apps : it.source?.app ? [it.source.app] : [];
    if (!keys.length) return { error: 'The item is not drawn by the app' };
    const ds = keys.map(k => drawApp(s, k, { item: it, doc }));
    const bad = ds.find(d => d.error || !d.svg);
    if (bad) return { error: bad.error || 'Not a drawing' };
    return ds.length === 1 ? { ...ds[0], title: it.title || ds[0].title } : { kind: 'figure', title: it.title || ds[0].title, svg: stackSvgs(ds.map(d => d.svg), { letters: Boolean(it.panels) }) };
  }
  // `doc`: the project's figure style (.lykos/figure-style.json), whose `assign.prisma` can give the flow the PRISMA 2020 template colours
  if (head === 'prisma') return { kind: 'figure', title: 'PRISMA flow diagram', svg: prismaFlow(prismaData(s), { previous: false, other: false, ...(s.prismaArms || {}), style: doc ? figureTokens(doc, { medium: 'export', chart: 'prisma' }) : print() }) };
  if (head === 'rob-traffic' || head === 'rob-summary') {
    const set = robSets(s, { item }).find(x => x.tool.id === arg);
    if (!set) return { error: 'No complete assessment with this instrument' };
    const source = [robScopeWords(s, set.tool.id, set.done.length, item) || `${set.done.length} of ${studiesWord(set.n)} appraised`], robvis = item?.template === 'robvis';
    // an item with template 'robvis' draws by robvis's conventions (lib/appraisal-robvis.mjs: grey cells, its keys), as the review's printed figures are
    const draw = head === 'rob-traffic' ? (robvis ? robvisTrafficLight : trafficLight) : (robvis ? robvisSummary : summaryBars);
    return { kind: 'figure', title: `Risk of bias: ${set.tool.name}`, svg: draw(set.tool, set.done, JUDGEMENT_TONE, { style: print(), ...(robvis ? {} : { source }) }) };
  }
  if (head === 'forest') {
    const a = analysisOf(s, arg);
    if (!a || a.estimate == null) return { error: 'The analysis has no result' };
    const data = forestData(a), title = `Forest plot: ${forestTitle(s, arg)}`;
    if (!data) return { kind: 'figure', title, slot: arg };
    const all = data.rows.length + data.groups.length + 1;
    return { kind: 'figure', title, svg: forestPageSvg(data, { page: 1, size: all, style: print(), het: heterogeneityLine(a), weights: a.weights, title, source: [forestSource(a)] }).svg };
  }
  if (head === 'sof') {
    const sof = summaryOfFindings(s), table = sofBlocks(sof).find(b => b.type === 'table');
    if (!sof.rows.length) return { error: 'No outcome is rated' };
    const question = sof.question.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    return { kind: 'table', title: 'Summary of findings', rows: table.rows, notes: [...question, ...sof.notes.map((t, i) => `${String.fromCharCode(97 + i)}. ${t}`)] };
  }
  if (head === 'profile') {
    const p = profileOf(s);
    if (!p.rows.length) return { error: 'No outcome is rated' };
    return { kind: 'table', title: 'GRADE evidence profile', rows: [['Outcome', ...p.columns], ...p.rows.map(r => [r.outcome, ...profileCells(r)])], notes: p.footnotes.map((t, i) => `${i + 1}. ${t}`) };
  }
  if (head === 'synth') {
    const [kind, oid, ...rest] = arg.split(':'), f = figureOf(synthesisModel(s), kind, oid, rest.join(':'));
    return f.error ? { error: f.error } : { kind: 'figure', title: f.title, svg: f.svg, legend: f.legend };
  }
  if (head === 'swim-table' || head === 'harvest') {
    const sw = swimOf(s), rows = swimRows(s);
    if (!sw.outcomes.length) return { error: 'No outcome domain' };
    if (head === 'harvest') return { kind: 'figure', title: 'Harvest plot', svg: harvestPlotSvg(rows, { weight: sw.weight || undefined, title: 'Harvest plot', style: print() }) };
    const ed = effectDirection(rows);
    return { kind: 'table', title: 'Effect direction table', rows: [['Study', 'n', 'Risk of bias', ...ed.outcomes], ...ed.table.map(t => [t.study, t.n ?? '', t.rob || '', ...ed.outcomes.map(o => DIRECTION_WORD[t.directions[o]] || '')])],
      notes: ed.byOutcome.map(o => `${o.outcome}: ${o.text}${o.signTest.p != null ? `; sign test p ${signP(o.signTest.p)}` : ''}`) };
  }
  if (head === 'output') {
    const spec = outputSpec(s, arg);
    if (!spec) return { error: 'The output was deleted' };
    let m;
    try { m = renderOutput(s, spec); } catch (err) { return { error: err.message }; }
    if (spec.kind === 'chart') return { kind: 'figure', title: spec.title, svg: chartSvg(m, { style: print() }) };
    const cols = [...(m.grouped ? [spec.groupRowsBy] : []), ...m.columns.map(c => c.label)];
    return { kind: 'table', title: spec.title, rows: [cols, ...m.groups.flatMap(g => g.cells.map(r => [...(m.grouped ? [g.label] : []), ...r.map(v => String(v ?? ''))]))], notes: m.notes };
  }
  if (head === 'evidence') {
    const [evidence, collection] = arg.split(':');
    if (!(s.templates || []).some(t => t.id === evidence)) return { error: 'The extraction table was removed' };
    const g = evidenceGrid(s, { evidence, collection: collection || null });
    return { kind: 'table', title: (s.collections || []).find(c => c.id === collection)?.name || 'Evidence table', rows: g.rows.map(r => r.cells.map(c => (c.merged ? '' : c.text))), notes: [] };
  }
  if (head === 'dataset') {
    const a = (s.datasetAnalyses || []).find(x => x.id === arg), r = a?.result;
    if (!r) return { error: 'The analysis was removed' };
    const title = datasetTitle(a), d = sourceById(a.datasetId, s), source = [[d?.name || a.frozenData?.name, r.n?.used != null ? `${r.n.used} rows analyzed` : ''].filter(Boolean).join(', ')].filter(Boolean);
    const svg = datasetDrawsFigure(a) ? analysisSvg(r.plot, { style: print(), source }) : '';
    if (svg) return { kind: 'figure', title, svg };
    const t = (r.tables || []).find(x => x?.header?.length);
    if (!t) return { error: 'The analysis has no table or figure' };
    return { kind: 'table', title, rows: [t.header.map(String), ...t.rows.map(row => row.map(c => String(c ?? '')))], notes: [r.sentence, r.method].filter(Boolean) };
  }
  if (head === 'survival') {
    const sv = s.survival, e = sv?.ext;
    if (!sv) return { error: 'No time-to-event analysis is kept' };
    const title = survivalTitle(sv), svg = e?.km ? kmFigure(e.km, { title, xLabel: 'Months', ci: false, ...survivalFigureOptions(e.tests, e.spec), style: print() }) : sv.plot;
    return svg ? { kind: 'figure', title, svg } : { error: 'The curve was not kept' };
  }
  // map: the evidence map, as a Package item keeps its options (it.map: fields, orders, the Prism layout of the Spine review's Figure 1), else the project's
  if (head === 'map') {
    const map = item?.map ? itemMap(s, item) : projectMap(s);
    if (!map?.total) return { error: 'No source of evidence to map yet' };
    const o = item?.map || s.evidenceMap || {};
    return { kind: 'figure', title: 'Evidence map', svg: evidenceMapSvg(map, { style: print(), shade: o.shade || '', patients: o.patients || '' }) };
  }
  if (head === 'study') {
    const inc = studies(s), f = chartableFields(s, inc).find(x => x.id === arg);
    if (!f) return { error: 'The characteristic is no longer charted' };
    const profile = detectCharacteristic(s, f, inc), config = selectedVisual(profile, s.characteristicViews?.[f.id]);
    const title = `Included studies by ${fieldParts(s, profile.field)[0].toLowerCase()}`, source = [`${inc.length} included ${inc.length === 1 ? 'study' : 'studies'}; ${visualNote(profile, config)}`];
    return { kind: 'figure', title, svg: renderCharacteristic(profile, config, { style: print(), source, title, max: Infinity, offset: 0, exportNotes: true }) };
  }
  return { error: `Nothing the app draws is named ${key}` };
}

// cyrb53: a 53-bit hash of a string, as hex; a signature, not a secret
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
/** What the drawing of `key` reads, signed: its print copy or its rows and notes (a forest only R drew: its result). '' when it cannot be drawn. */
// the physical width of an SVG in points (its width attribute: in, pt, mm, cm or px), else its viewBox width read as pixels
const PT = { in: 72, pt: 1, px: 0.75, mm: 72 / 25.4, cm: 72 / 2.54 };
function svgBox(svg) {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] || '', vb = /viewBox="([^"]+)"/.exec(root)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const wa = /\swidth="([\d.]+)(in|pt|px|mm|cm)?"/.exec(root), ha = /\sheight="([\d.]+)(in|pt|px|mm|cm)?"/.exec(root);
  const w = vb?.[2] || Number(wa?.[1]) || 100, h = vb?.[3] || Number(ha?.[1]) || 100;
  return { vb: vb || [0, 0, w, h], w, h, pt: wa ? Number(wa[1]) * PT[wa[2] || 'px'] : w * 0.75 };
}
/**
 * Several print drawings as one: each scaled to the width of the widest (in points) and stacked, a bold letter above each when `letters`
 * (panel A over panel B, as a forest plot over its SWiM table). The result is as wide as the widest drawing prints.
 */
export function stackSvgs(svgs, { letters = false } = {}) {
  const boxes = svgs.map(svgBox), W = Math.max(...boxes.map(b => b.pt)), L = letters ? 16 : 0, gap = 10;
  let y = 0;
  const parts = svgs.map((svg, i) => {
    // the drawing keeps its own root (its font and type size are set there); only its place and size are set anew
    const b = boxes[i], h = (b.h / b.w) * W, body = svg.replace(/^[\s\S]*?(?=<svg\b)/, '');
    const root = /^<svg\b[^>]*>/.exec(body)[0], attrs = root.slice(4, -1).replace(/\s(?:x|y|width|height|viewBox|preserveAspectRatio|xmlns(?::\w+)?|version)="[^"]*"/g, '');
    const letter = letters ? `<text x="0" y="${(y + 12).toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#000">${String.fromCharCode(65 + i)}</text>` : '';
    const out = `${letter}<svg x="0" y="${(y + L).toFixed(1)}" width="${W.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${b.vb.join(' ')}" preserveAspectRatio="xMinYMin meet"${attrs}>${body.slice(root.length).replace(/<\/svg>\s*$/, '')}</svg>`;
    y += L + h + gap;
    return out;
  });
  const H = y - gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(1)}pt" height="${H.toFixed(1)}pt"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
}

export function appSig(s, key) {
  const d = drawApp(s, key);
  if (d.error) return '';
  if (d.slot) { const { figures, ...a } = analysisOf(s, d.slot) || {}; void figures; return hash(JSON.stringify(a)); }
  return hash(d.svg ?? JSON.stringify([d.rows, d.notes]));
}

/** PNG bytes of a print-copy SVG at its own size (600 dpi): `{ bytes, w, h, mime, ptW, ptH }`, or null where nothing rasterises (Node). */
export async function rasterize(svg) {
  if (typeof Image === 'undefined') return null;
  const r = await rasterSvg(svg, { background: 'white' });
  if (!r) return null;
  const { dpi } = rasterPlan(svg);
  return { bytes: r.bytes, w: r.width, h: r.height, mime: 'image/png', ptW: (r.width / dpi) * 72, ptH: (r.height / dpi) * 72 };
}

/**
 * The drawing of `key` as a package source (lib/package-sources.mjs): `{ image, sig }` for a figure, `{ grid, notes, sig }` for a table, or
 * `{ error }`. `raster(svg)` draws a figure as an image (default: the browser's, `rasterize`).
 */
export async function renderApp(s, key, { raster = rasterize, item = null } = {}) {
  const d = drawApp(s, key, { item });
  if (d.error) return { error: d.error };
  const sig = appSig(s, key);
  if (d.kind === 'table') return { grid: gridOf(d.rows), notes: d.notes || [], sig, title: d.title };
  const svg = d.svg ?? await figureFor(analysisOf(s, d.slot), 'svg');
  if (!svg) return { error: 'The forest plot is not on this computer: run the analysis again' };
  const image = await raster(svg);
  return image ? { image, sig, title: d.title, svg } : { error: 'Figures are drawn in the app' };
}

/** The loader lib/package-sources.mjs `loadSources` takes for `{ app }` sources (and each drawing of `{ apps }`); the item gives its scope and template. */
export const appLoader = (s, opts = {}) => (source, item = null) => renderApp(s, source.app, { ...opts, item });

/** Whether a manuscript block or a package item was drawn from `key`. */
const blockKey = b => b?.app?.key || '';
const itemKey = it => it?.source?.app || (it?.source?.evidence && !it.source.studies && !it.source.fields ? `evidence:${it.source.evidence}${it.source.collection ? `:${it.source.collection}` : ''}` : '');

/** The package items and manuscript blocks drawn from the app whose data changed since they were built or inserted. */
export function staleBlocks(s, blocks = s.manuscript?.blocks || []) {
  return blocks.filter(b => b?.app?.key && b.app.sig !== appSig(s, b.app.key));
}

/**
 * Where the paper holds each drawing: `Map(key -> [{ where: 'package' | 'manuscript', label, part?, itemId?, blockId?, section?, para? }])`. A
 * manuscript figure or table is numbered by its place among the document's figures or tables (its caption's sequence), and placed by the
 * heading it is under (`section`, in sentence case) and its place among that section's paragraphs, figures and tables (`para`, from 1).
 */
export function placements(s) {
  const out = new Map(), add = (k, p) => { if (k) (out.get(k) || out.set(k, []).get(k)).push(p); };
  const pkg = s.package, L = pkg?.items ? packageLabels(pkg) : new Map();
  for (const part of pkg?.parts || []) for (const id of part.items || []) {
    const it = pkg.items[id];
    if (it) add(itemKey(it), { where: 'package', label: L.get(id) || '', part: part.name, itemId: id, title: plainText(it.title, x => L.get(x)) });
  }
  const n = { figure: 0, table: 0 };
  let section = '', para = 0;
  for (const b of s.manuscript?.blocks || []) {
    if (/^h\d$/.test(b.type || '')) { section = sentenceCase(b.text); para = 0; continue; }
    if ((b.type === 'p' && b.styleId !== 'Caption' && String(b.text || '').trim()) || b.type === 'figure' || b.type === 'table') para++;
    if (b.type !== 'figure' && b.type !== 'table') continue;
    n[b.type]++;
    if (b.app?.key) add(b.app.key, { where: 'manuscript', label: `${b.type === 'figure' ? 'Figure' : 'Table'} ${n[b.type]}`, blockId: b.id, section, para });
  }
  return out;
}
// a heading set in capitals ("RESULTS") read as a name ("Results"); one written in mixed case is kept as written
const sentenceCase = t => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x && x === x.toUpperCase() ? x[0] + x.slice(1).toLowerCase() : x; };
/** A placement in words: "Supplement · Table S2", "Manuscript · Figure 1". */
export const placeWords = p => (p.where === 'package' ? `${p.part}: ${p.label}` : `Manuscript: ${p.label}`);
/** Where a row's thing is used, in words: "In Main figures as Figure 3", "In the manuscript, Results ¶4". */
export const useWords = p => (p.where === 'package' ? `In ${p.part} as ${p.label}` : `In the manuscript, ${p.section ? `${p.section} ` : ''}¶${p.para || 1}`);

// ---- the manuscript's linked blocks ---------------------------------------------------------------------------------------------------
const cellOf = text => ({ text: String(text ?? ''), runs: [{ t: String(text ?? '') }] });
const para = (id, text, extra = {}) => ({ id, type: 'p', text, runs: [{ t: text }], ...extra });

/** A table block of the manuscript from a drawn table: its grid with runs, ruled as the journal's tables are (APA rules), linked by `app`. */
export function tableBlock(id, d, key, sig) {
  const g = gridOf(d.rows, { borders: 'apa' });
  return { id, type: 'table', text: '', grid: { ...g, rows: g.rows.map(r => ({ ...r, cells: r.cells.map(c => cellOf(c.text)) })) }, app: { key, sig } };
}

/**
 * The blocks "Insert in manuscript" adds for `key`: the caption ("Figure {{seq:Figure}}. Title"), then the figure or the table with its notes,
 * each drawn block carrying `app: { key, sig }` so it is redrawn when its data changes. `image` is the figure's `{ img, fileHash, w, h }`
 * (stored by the caller), `width` the text width in points.
 */
export function linkedBlocks(s, key, { newId, image = null, width = 451 } = {}) {
  const d = drawApp(s, key);
  if (d.error) throw new Error(d.error);
  const sig = appSig(s, key), kind = d.kind === 'table' ? 'Table' : 'Figure';
  const capText = `${kind} {{seq:${kind}}}. `;
  const cap = { id: newId(), type: 'p', styleId: 'Caption', runs: [{ t: capText }, { t: `${d.title}.` }], text: `${capText}${d.title}.` };
  if (d.kind === 'table') return [{ ...cap, props: { keepNext: true } }, tableBlock(newId(), d, key, sig), ...(d.notes || []).map(t => para(newId(), t, { app: { key, sig, note: true } }))];
  if (!image) throw new Error('The figure was not drawn');
  const w = Math.min(width, image.ptW || image.w * 0.75), h = w * (image.h / image.w);
  return [{ id: newId(), type: 'figure', img: image.img, fileHash: image.fileHash, name: d.title, mime: 'image/png', w, h, props: { jc: 'center', keepNext: true }, text: '', app: { key, sig } }, cap];
}

/**
 * The manuscript's linked tables redrawn from the data as it is: each stale table's grid and its notes replaced, the caption and the
 * person's text kept. Returns `{ blocks, tables, figures }`: the new blocks, the ids of the tables redrawn and the stale figures left to
 * the caller (an image needs the rasteriser and the file store).
 */
export function refreshTables(s, blocks) {
  const out = [], figures = [], tables = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b?.app?.key || b.app.note) { out.push(b); continue; }   // a note whose table was removed stays the person's text
    const sig = appSig(s, b.app.key);
    if (b.type === 'figure') { out.push(b); if (sig && sig !== b.app.sig) figures.push(b); continue; }
    // a table: its notes follow it; when its data changed, both are drawn again
    const notes = [];
    while (blocks[i + 1]?.app?.note && blocks[i + 1].app.key === b.app.key) notes.push(blocks[++i]);
    if (!sig || sig === b.app.sig) { out.push(b, ...notes); continue; }
    const d = drawApp(s, b.app.key);
    const fresh = tableBlock(b.id, d, b.app.key, sig);
    out.push({ ...b, grid: { ...fresh.grid, borders: b.grid?.borders || fresh.grid.borders }, app: fresh.app },
      ...(d.notes || []).map((t, k) => para(notes[k]?.id || `${b.id}-n${k + 1}`, t, { app: { key: b.app.key, sig, note: true } })));
    tables.push(b.id);
  }
  return { blocks: out, tables, figures };
}

/**
 * The keys of a drawing listed by Tables and figures (views/outputs-paper.mjs drawables): `[{ key, kind, label }]`, the label naming the
 * part when a drawing has two (the risk-of-bias plots, the SWiM table and its harvest plot). An evidence table is a package source of its own.
 */
export function keysOfDrawn(d) {
  if (!d) return [];
  if (d.draw === 'prisma') return [{ key: 'prisma', kind: 'figure', label: 'Flow diagram' }];
  if (d.draw === 'synth') return [{ key: d.app, kind: 'figure', label: 'Figure' }];
  if (d.draw === 'rob') return [{ key: `rob-traffic:${d.tool}`, kind: 'figure', label: 'Traffic-light plot' }, { key: `rob-summary:${d.tool}`, kind: 'figure', label: 'Summary plot' }];
  if (d.draw === 'forest') return [{ key: `forest:${d.slot}`, kind: 'figure', label: 'Forest plot' }];
  if (d.draw === 'profile') return [{ key: 'profile', kind: 'table', label: 'Evidence profile' }];
  if (d.draw === 'sof') return [{ key: 'sof', kind: 'table', label: 'Summary of findings' }];
  if (d.draw === 'swim') return [{ key: 'swim-table', kind: 'table', label: 'Effect direction table' }, { key: 'harvest', kind: 'figure', label: 'Harvest plot' }];
  if (d.draw === 'dataset') return [{ key: `dataset:${d.id}`, kind: d.type === 'table' ? 'table' : 'figure', label: d.type === 'table' ? 'Table' : 'Figure' }];
  if (d.draw === 'survival') return [{ key: 'survival', kind: 'figure', label: 'Kaplan–Meier' }];
  if (d.draw === 'study' && d.field) return [{ key: `study:${d.field}`, kind: 'figure', label: 'Figure' }];
  if (d.evidence) return [{ key: `evidence:${d.evidence}${d.collection ? `:${d.collection}` : ''}`, kind: 'table', label: 'Table' }];
  if (d.spec?.id && !String(d.spec.id).startsWith('paper:')) return [{ key: `output:${d.spec.id}`, kind: d.spec.kind === 'chart' ? 'figure' : 'table', label: d.spec.kind === 'chart' ? 'Figure' : 'Table' }];
  return [];
}

/** A package source for `key`: an evidence table stays an evidence source (its rows and columns can be narrowed there); anything else `{ app }`. */
export function sourceOfKey(key) {
  const m = /^evidence:([^:]+)(?::(.+))?$/.exec(key);
  return m ? { evidence: m[1], ...(m[2] ? { collection: m[2] } : {}) } : { app: key };
}
export { itemKey };
