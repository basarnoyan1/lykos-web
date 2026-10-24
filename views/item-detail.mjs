// The detail of a table or figure of the paper, one pane for Submission › Files and Tables and figures (plan §2, "Submission files,
// structured: details"): an interactive preview, how it was made and what it depends on (lib/item-detail.mjs over the dependency graph
// Changes › Dependencies draws, which Show in Dependencies opens on the item). Submission adds its quality and references under these.
//
// The preview is the screen drawing where the app has one: a pooled analysis's forest as Make draws it (lib/analysis-charts.mjs: fluid at the
// pane's width, each study's values on hover), a table as an HTML table with its footnotes, each cell naming its source on hover. A figure
// the app draws only for print is shown as it prints; a file with no app source is its own picture.
import { get } from '../store.mjs';
import { esc, sanitizeSvg } from '../lib/html.mjs';
import { uiBar, watchWidth } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { cueRegions, pagedTable, uiLink } from '../lib/ui-components.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { labels } from '../lib/package-state.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { itemCites, libraryIndex, citesInText, reviewStudies, textCites } from '../lib/package-cites.mjs';
import { authorLine } from '../lib/bib.mjs';
import { markGrid } from '../lib/footnotes.mjs';
import { studyRow, studyList, wireStudyRows, wireDrill } from '../lib/figure-drill.mjs';
import { plainText } from '../lib/package.mjs';
import { armColumns, dependsOn, madeOf, nodeOfItem, sourceGrid, studyRows, tableAgainstApp } from '../lib/item-detail.mjs';

const STATE = { changed: 'Changed since the build', current: 'As built', unknown: '', none: '' };
let graphMemo = { s: null, g: null };
async function graphOf(s) {
  if (graphMemo.s === s && graphMemo.g) return graphMemo.g;
  const { buildGraph } = await import('../lib/deps-graph.mjs');
  graphMemo = { s, g: buildGraph(s, {}) };
  return graphMemo.g;
}

/** The facts the pane shows for package item `id`: `{ made, depends }` (lib/item-detail.mjs). */
export async function detailFacts(s, id, { graph = null, ...opts } = {}) {
  const pkg = s.package || { parts: [], items: {} }, it = pkg.items[id];
  if (!it) return null;
  const part = pkg.parts.find(p => p.items.includes(id)), builds = pkg.builds?.[part?.id] || [], last = builds.at(-1);
  const [app, dg, outc, reg, spec] = await Promise.all([import('../lib/app-items.mjs'), import('../lib/deps-graph.mjs'), import('../lib/outcomes.mjs'), import('../lib/results-registry.mjs'), import('../lib/output-spec.mjs')]);
  const key = it.source?.app || '', head = key.split(':')[0], arg = key.slice(head.length + 1);
  // the page that draws it: the app's list of drawings, else by its key (a synthesis is drawn by Syntheses, which that list leaves out)
  const drawn = key && !app.drawApp(s, key).error, byHead = { forest: 'Analysis', 'rob-traffic': 'Appraisal', 'rob-summary': 'Appraisal', prisma: 'Reporting', sof: 'Certainty', profile: 'Certainty',
    'swim-table': 'Certainty', harvest: 'Certainty', output: 'Tables and figures', evidence: 'Extraction', dataset: 'Datasets', survival: 'Analysis', synth: 'Syntheses', study: 'Tables and figures' };
  const drawer = key ? app.appItems(s).find(x => x.key === key) || (drawn && byHead[head] ? { key, view: byHead[head] } : null) : null;
  const SYNTH = { effects: 'Synthesis without meta-analysis: effect direction', forest: 'Comparison of two arms, pooled', proportions: 'Pooled proportions by arm' };
  const synth = head === 'synth' ? { method: SYNTH[arg.split(':')[0]] || 'Synthesis', of: '' } : null;
  // a synthesis in the reader's terms: its combination's record, or its SWiM sheet
  let facts = [];
  if (head === 'synth') {
    try {
      const [sp, sf, im] = await Promise.all([import('../lib/synth-project.mjs'), import('../lib/synth-figures.mjs'), import('../lib/item-detail.mjs')]);
      const [kind, oid, ...rest] = arg.split(':'), code = rest.join(':'), model = sp.synthesisModel(s);
      if (kind === 'effects') { const e = sf.effectsData(model, code); facts = e.error ? [] : im.synthesisFacts({ effects: e }); }
      else {
        const rec = model.records.find(r => r.code === code && r.outcomeId === oid && (kind === 'forest' ? r.method.startsWith('Meta') : r.family === 'Proportions'));
        const flat = list => (list || []).flatMap(o => [o, ...flat((o.parts || []).filter(p => typeof p === 'object'))]);
        const outs = flat(Array.isArray(model.outcomes) ? model.outcomes : Object.values(model.outcomes || {})), outcome = outs.find(o => o.id === oid);
        facts = im.synthesisFacts({ rec, definition: outcome ? sf.outcomeDefinition(outcome, x => outs.find(o => o.id === x)?.name || x) : '' });
      }
    } catch { facts = []; }
  }
  const analysis = head === 'forest' ? outc.analysisOf(s, arg) : null;
  const entry = head === 'output' ? (s.outputs || []).find(o => o.id === arg) : null;
  const said = entry ? reg.outputOrigin(entry) : '';
  const origin = entry ? (said ? reg.originWords(said) : 'From Tables and figures › New') : drawer ? `From ${drawer.view}` : '';
  const kept = key ? last?.sources?.[`app:${key}`] : null, dataCurrent = key && kept ? kept === app.appSig(s, key) : null;
  const g = graph || await graphOf(s);
  const byKey = new Map((s.papers || []).map(p => [p.key || p.id, p]));
  const cites = itemCites(it).map(k => { const p = byKey.get(k); return { key: k, paper: p || null, label: p ? p.label || `${authorLine(p.authors) || 'No authors'} ${p.year || ''}`.trim() : k }; });
  const printed = part?.file ? part.file.split('/').pop() : '';
  // a picture in the folder is drawn from what it prints, else its script's data, else the app's (lib/printed-data.mjs printedFacts)
  // a printed table set against the app's extraction: the studies it names, each value against Extraction's (lib/item-detail.mjs)
  const table = it.kind === 'table' && !key && opts.grid ? tableAgainstApp(s, opts.grid, t => studyOfLabel(t, studyIndex(s))) : null;
  const redraw = opts.redraw || (table?.cells ? { compare: { matched: table.matched, mismatches: table.mismatches, unit: ['value', 'values'] }, printedFile: printed } : null);
  const made = madeOf({ item: it, drawer, analysis, spec: entry ? spec.currentSpec(entry) : null, origin, builds, part, synth, facts, printed: opts.printed === false ? '' : printed, matched: table ? { n: table.studies, of: table.of } : null });
  // the print it was checked against, in a word: agrees, or how many values differ
  const pc = opts.redraw?.compare, pf = String(opts.redraw?.printedFile || opts.redraw?.file || '').split('/').pop();
  if (pc && pf) made.push({ label: 'Checked against', value: `${pf}, ${pc.mismatches.length ? `${pc.mismatches.length} ${pc.mismatches.length === 1 ? 'value differs' : 'values differ'}` : 'agrees'}` });
  else if (opts.redraw?.file && opts.redraw.source !== 'app') made.push({ label: 'Screen drawn from', value: String(opts.redraw.file).split('/').pop() });
  return { made, redraw, cites, depends: dependsOn(dg.reach(g, nodeOfItem(id), 'up'), { build: last || null, dataCurrent, cites }), node: nodeOfItem(id), analysis, dataCurrent, ...(opts.studies ? { studies: opts.studies } : {}) };
}

// ---- sections: definition rows on one rule for the whole pane: every title, label and row starts at the pane's left edge, and every value
// ends at its right edge with the rules (no list inset, no reserved More), whatever the section --------------------------------------------
/** One row of a section: its label (text or a press) with an optional second line, and its value at the row's end. */
export const paneRow = ({ label, sub = [], value = '', attrs = {}, cls = '' } = {}) => `<div class="idt-line${cls ? ` ${cls}` : ''}" role="listitem"${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>
  <div class="idt-lab">${label}${sub.length ? `<span class="idt-sub">${sub.join(', ')}</span>` : ''}</div><div class="idt-val">${value}</div></div>`;
/** A section: its title with a value or command at the title row's end (a score's bars, Show in Dependencies), then its rows. */
// a long section pages with the app's pager (lib/paging.mjs), its page kept by section id across Back and Previous / Next
const pages = new Map();
export const pageOfSection = id => pages.get(id) || 1;
/**
 * A section of the pane: its title, then its lines, paged. `end` is a value at the title's end (a score's bars), or `action` ({ id, label,
 * attrs }) one quiet command, placed by the head-bar builder as every section head's command is.
 */
export function paneSection(id, title, end, rows, empty = '', { noun = 'rows', action = null, size, list = false } = {}) {
  const shown = pageOf(rows, pageOfSection(id), size);
  const foot = pager({ id: `${id}-pages`, page: shown.page, pages: shown.pages, total: rows.length, label: noun, ...(size ? { size } : {}) });
  const top = action ? uiBar({ kind: 'head', id: `${id}-head`, cls: 'idt-top', label: title, lead: { title, level: 'h3' }, actions: [{ id: action.id, label: action.label, role: 'quiet', attrs: action.attrs || {} }] })
    : `<div class="idt-line idt-top"><div class="idt-lab"><h3 class="idt-title">${esc(title)}</h3></div><div class="idt-val">${end}</div></div>`;
  return `<section class="idt-sec" id="${esc(id)}" aria-label="${esc(title)}">${top}
  ${list ? studyList({ id: `${id}-list`, label: title, rows: shown.items, empty }) : `<div class="idt-lines" role="list" aria-label="${esc(title)}">${rows.length ? shown.items.join('') : empty}</div>`}${foot}</section>`;
}
/** A state as one word after a small mark in its tone (a failing check the bad tone); one weight for all. */
export const stateHtml = (state, word) => `<span class="idt-state" data-state="${esc(state)}">${esc(word)}</span>`;
/** A value with its file names breakable only after "_", "." or "/" (never inside a word): "Spine_ASD_publication_tables_v19.docx". */
const breakable = v => esc(v).replace(/([_./])(?=\S)/g, '$1<wbr>');
// the facts as the app's one label-and-value list (workspace.css .props): one grid for every row, so each value starts on one edge
// (owner, 2026-10-24: "weird looking and definitely not standardized", when each row sized its own label column)
const made = (id, list) => `<section class="idt-sec" id="idt-made-${esc(id)}" aria-label="How it was made"><div class="idt-line idt-top"><div class="idt-lab"><h3 class="idt-title">How it was made</h3></div><div class="idt-val"></div></div>
  <dl class="props idt-props">${list.map(r => `<dt>${esc(r.label)}</dt><dd>${breakable(r.value)}</dd>`).join('')}</dl></section>`;
// a section stands whole in its column (research-views.css .idt-sec): the works it cites are a section of their own, paged short
const REFS_PAGE = 8;
/** A study the item names that no one record answers: its label, and why (none, or several records); the Library settles it. */
function unsettledRow(x) {
  const byKey = new Map((get().papers || []).map(r => [r.key || r.id, r])), many = x.candidates.length > 1;
  const which = many ? x.candidates.map(k => byKey.get(k)).filter(Boolean).slice(0, 2).map(r => esc(`${r.journalAbbr || r.journal || ''} ${r.year || ''}`.trim())) : [];
  return studyRow(null, { label: x.label, detail: [esc(many ? `${x.candidates.length} records match` : 'Not in the Library'), ...which] });
}
/**
 * The works the item cites, one compact row each (lib/figure-drill.mjs studyRow): every study its rows and marks name, in their order, each
 * opening its record (`f.studies`, read with its source in Submission › Files), a label no one record answers listed where it stands as not in
 * the Library or as several records; then the works its title, legend and notes cite. Without its studies read, the works it records.
 */
function references(id, f) {
  const cites = f.cites || [], papers = new Map((get().papers || []).flatMap(p => [[p.key || p.id, p], [p.id, p]]));
  const studies = (f.studies || []).filter(x => !x.token), seen = new Set(), rows = [];
  studies.forEach(x => {
    if (!x.key) { rows.push(unsettledRow(x)); return; }
    if (seen.has(x.key)) return;
    seen.add(x.key);
    const p = papers.get(x.key) || null;
    rows.push(p ? studyRow(p) : studyRow(null, { label: x.label, detail: [esc('Not in the Library')] }));
  });
  for (const c of cites) if (!seen.has(c.key)) { seen.add(c.key); rows.push(c.paper ? studyRow(c.paper) : studyRow(null, { label: c.label, detail: [esc('Not in the Library')] })); }
  if (!rows.length) return '';
  const open = studies.filter(x => !x.key).length, n = seen.size;
  return paneSection(`idt-refs-${id}`, 'References it cites', `<span class="meta">${open ? `${n} (${open} to settle)` : n}</span>`, rows, '', { noun: 'references', size: REFS_PAGE, list: true });
}
function depends(id, all) {
  const STATE_KEY = { changed: 'missing', current: 'ok', unknown: 'na', none: 'none' };
  const groups = all.map(g => ({ ...g, rows: g.rows.filter(r => r.kind !== 'record') })).filter(g => g.rows.length);
  // a group of one input named as the group ("Appraisal" over "Appraisal") is that one line
  const one = g => g.rows.length === 1 && String(g.rows[0].label || '').trim().toLowerCase() === String(g.title || '').trim().toLowerCase();
  const rows = groups.flatMap(g => [...(one(g) ? [] : [paneRow({ cls: 'idt-group', label: `<span class="idt-group-name">${esc(g.title)}</span>` })]),
    ...g.rows.map(r => (r.kind === 'record' ? '' : paneRow({ attrs: { 'data-idt-dep': r.id },
      label: r.go ? `<button type="button" class="idt-go" data-idt-go="${esc(r.go === 'tables' ? 'outputs' : r.go)}"${r.path ? ` data-idt-path="${esc(r.path)}"` : ''}>${esc(r.label)}</button>` : `<span>${esc(r.label)}</span>`,
      value: r.why || STATE[r.state] ? stateHtml(STATE_KEY[r.state] || 'na', r.why || STATE[r.state]) : '' })))]);
  return paneSection(`idt-deps-${id}`, 'What it depends on', '', rows, '<p class="meta">Nothing the project records</p>',
    { noun: 'inputs', size: REFS_PAGE, action: { id: `idt-deps-open-${id}`, label: 'Show in Dependencies', attrs: { 'data-idt-deps': nodeOfItem(id) } } });   // paged as the references are (owner, 2026-10-24)
}
/**
 * The printed against the app: each value the app holds that the printed file does not say, by study and field (nothing is rebuilt: the
 * printed file is the truth, and a difference is the person's to settle), or one line that they agree.
 */
function printedSection(id, r) {
  const c = r?.compare;
  // nothing compared is nothing to say: no section (owner, 2026-10-24: "don't add these weird texts")
  if (!c) return '';
  const rows = c.mismatches.length ? c.mismatches.map(m => paneRow({ label: `<span>${esc(m.study)}</span>`, sub: [esc(m.field), `${esc(m.app)} in the app`, `${esc(m.printed)} printed`], value: stateHtml('missing', 'Differs') }))
    : [paneRow({ label: `<span>${esc(`${c.matched} ${(c.unit || ['study', 'studies'])[c.matched === 1 ? 0 : 1]} read`)}</span>`, value: stateHtml('ok', 'Agrees') })];
  const end = c.mismatches.length ? `<span class="meta">${c.mismatches.length}</span>` : '';
  return paneSection(`idt-printed-${id}`, 'Printed against the app', end, rows, '', { noun: 'differences', size: REFS_PAGE });
}
/** How it was made and what it depends on, as both pages draw them. */
export const factsHtml = (id, f) => (f ? `${made(id, f.made)}${printedSection(id, f.redraw)}${depends(id, f.depends)}${references(id, f)}` : '<p class="meta">Reading the project</p>');

/**
 * The whole pane: the preview on top (fluid, at most about 900 px), then the facts and `extra` (Submission's quality) flowing in two balanced
 * columns where the pane holds them (lib/split-fit.mjs fitSplit), one below that.
 */
export const paneHtml = (id, f, extra = '') => `<div class="idt ui-flush" data-idt="${esc(id)}"><div class="idt-preview" data-idt-preview="${esc(id)}"><p class="meta">Reading the drawing</p></div>
  <div class="idt-cols">${factsHtml(id, f)}${extra}</div></div>`;

/** Wires a pane drawn by paneHtml (or factsHtml): its inputs open where they live, its preview is drawn at its width. */
let paneCtx = null;   // the page's ctx, for a press in a preview drawn later
export function wirePane(root, ctx, { grids = new Map(), svgs = new Map(), printed = new Map(), folder = null, onChange = () => ctx.rerender?.() } = {}) {
  paneCtx = ctx;
  root.querySelectorAll('.idt-sec').forEach(sec => wirePager(sec, `${sec.id}-pages`, n => { pages.set(sec.id, n); onChange(); }));
  root.querySelectorAll('.idt-cols').forEach(el => fitSplit(el, 760));
  root.querySelectorAll('[data-idt-go]').forEach(b => b.onclick = async () => {
    const go = b.dataset.idtGo;
    if (b.dataset.idtKey) { const { focusPaper } = await import('./library.mjs'); focusPaper(b.dataset.idtKey); return ctx.go('library'); }
    if (b.dataset.idtPath && go === 'files') { const f = await import('./files.mjs'); f.show?.(b.dataset.idtPath); return ctx.go('files'); }
    return ctx.go(go === 'tables' ? 'outputs' : go);
  });
  // a preview's "3 values differ": the list of them, Printed against the app
  if (!root._idtDiffs) { root._idtDiffs = true; root.addEventListener('click', e => { const b = e.target.closest?.('[data-idt-diffs]'); if (!b) return; const sec = root.querySelector(`#idt-printed-${CSS.escape(b.dataset.idtDiffs)}`); sec?.scrollIntoView({ block: 'start' }); const h = sec?.querySelector('h3'); h?.setAttribute('tabindex', '-1'); h?.focus({ preventScroll: true }); }); }
  root.querySelectorAll('[data-idt-deps]').forEach(b => b.onclick = async () => { const changes = await import('./changes.mjs'); changes.focus(b.dataset.idtDeps); ctx.go('changes'); });
  const showInLibrary = async id => { const { focusPaper } = await import('./library.mjs'); focusPaper(id); ctx.go('library'); };
  // a study row opens as a study does everywhere (the shell's study page), else in the Library; its More: Open PDF, Show in Library
  root.querySelectorAll('.idt-cols').forEach(el => wireStudyRows(el, { open: (id, o) => (ctx.openStudy ? ctx.openStudy(id, o) : showInLibrary(id)), library: showInLibrary }));
  root.querySelectorAll('[data-idt-preview]').forEach(host => drawPreview(host, host.dataset.idtPreview, { grid: grids.get(host.dataset.idtPreview), svg: svgs.get(host.dataset.idtPreview),
    printed: printed.get(host.dataset.idtPreview), folder: folder || activeFolder() }));
}

// ---- the studies a preview names: a row or a mark opens its study as the app opens a study everywhere -----------------------------------
let indexMemo = { s: null, index: null };
/** The library by name and year, ties broken by the review's studies and then the works the text cites (lib/package-cites.mjs). */
function studyIndex(s = get()) {
  if (indexMemo.s !== s) indexMemo = { s, index: libraryIndex(s.papers || [], { prefer: new Set(textCites(s)), studies: reviewStudies(s) }) };
  return indexMemo.index;
}
/** The one record a label names, by its key, or null (none, or several: never guessed). */
const studyOfLabel = (label, index = studyIndex()) => { const keys = citesInText(String(label ?? ''), index); return keys.length === 1 ? keys[0] : null; };
/** A study's key (or id) as the id the shell's study page opens. */
const paperId = key => (get().papers || []).find(p => p.id === key || p.key === key)?.id || key;
/** Opens a study: the shell's study page, else its record in the Library. */
export async function openStudyKey(key) {
  const id = paperId(key);
  if (paneCtx?.openStudy) return paneCtx.openStudy(id);
  // the study's details pane where the page is (the shell's study panel), never the Library's list narrowed to it (owner, 2026-10-24:
  // "pressing them should open the details pane not showing a search result")
  document.dispatchEvent(new CustomEvent('lykos:open-study', { detail: { id } }));
}
/** A chart's rows with each study's row carrying its study (`data-idt-study`): its own, else the one record its label names. */
const withStudies = rows => rows.map(r => (r.pooled || r.attrs?.['data-idt-study'] ? r : (k => (k ? { ...r, attrs: { ...(r.attrs || {}), 'data-idt-study': k } } : r))(studyOfLabel(r.label))));

/** A picture file of the folder on its sheet, As it prints; null when the folder cannot give it. */
// the printed file an item stands for (lib/printed-data.mjs printedPath, which loads on use): a `was` that is an object is history, not a file
const printedPath = src => (typeof src?.was === 'string' && src.was) || (typeof src?.path === 'string' && src.path) || '';
// A picture's bytes are read once per open of an item: the preview draws before its printed facts arrive and again with them, and both
// drawings (As it prints, the file's own picture) share one read and one object URL, keyed by the file's path, size and time. A different
// item's open lets them go.
const pictures = { item: null, urls: new Map() };   // `${path}|${size}|${mtime}` -> Promise<url | null>
function openPictures(id) {
  if (pictures.item === id) return;
  for (const p of pictures.urls.values()) p.then(url => url && URL.revokeObjectURL(url)).catch(() => {});
  pictures.urls.clear(); pictures.item = id;
}
async function pictureUrl(folder, path) {
  const st = await Promise.resolve(folder.stat?.(path)).catch(() => null), key = `${path}|${st?.size ?? ''}|${st?.mtime ?? ''}`;
  if (!pictures.urls.has(key)) pictures.urls.set(key, Promise.resolve(folder.read(path)).then(bytes => URL.createObjectURL(new Blob([bytes], { type: /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png' })), () => null));
  return pictures.urls.get(key);
}
async function filePicture(folder, path, alt) {
  if (!folder || !path || !/\.(png|jpe?g|gif|webp)$/i.test(path)) return null;
  const url = await pictureUrl(folder, path);
  if (!url) return null;
  return { url, html: `<figure class="idt-sheet"><div class="idt-print"><img src="${esc(url)}" alt="${esc(alt)}"></div><figcaption>As it prints: ${esc(path.split('/').pop())}</figcaption></figure>` };
}
/** The rows of a redraw as a table's grid, the first its header. */
const gridOfRows = rows => ({ rows: rows.map((r, i) => ({ ...(i === 0 ? { header: true } : {}), cells: r.map(t => ({ text: String(t ?? '') })) })) });
/**
 * A picture in the folder, redrawn from its printed data (lib/printed-data.mjs printedFacts): a forest from the printed ratios (Make's screen
 * chart), a sheet of effects or a script's data as an interactive table; As it prints its own file. Its source is named under the switch.
 */
async function drawPrinted(host, it, r, folder) {
  if (r.panels?.length) return drawPanels(host, it, r, folder);
  const id = it.id, alt = it.title || 'Figure', pic = await filePicture(folder, r.path, alt);
  const ac = r.forest?.length ? await import('../lib/analysis-charts.mjs') : null;
  // what the screen shows: the printed values (a forest, a sheet of effects), the script's data, or the app's own drawing where it agrees with
  // the print (a flow, a traffic light, an evidence map whose panels are a switch of their own)
  const panels = r.draw?.panels ? [['articles', 'Articles'], ['patients', 'Patients']] : null;
  const gridOf = look => (r.effects ? gridOfRows(r.effects) : r.rows?.length ? gridOfRows(r.rows) : r.draw?.rows ? gridOfRows(r.draw.rows) : panels ? gridOfRows(r.draw.panels[look] || r.draw.panels.articles) : null);
  const flow = r.draw?.prisma ? (await import('../lib/app-items.mjs')).drawApp(get(), 'prisma').svg : '';
  const canRedraw = Boolean(r.forest?.length || gridOf('articles') || flow);
  if (r.effects || r.rows || r.draw?.rows || panels) host.dataset.idtWide = '';   // a redrawn table takes the page's width
  const note = '';   // where it is drawn from is said in How it was made; a difference is a quiet item of the bar (diffsAct)
  host.onclick = e => { const b = e.target.closest?.('[data-idt-look]'); if (b) { looks.set(id, b.dataset.idtLook); draw(); } };
  const draw = () => {
    if (!host.isConnected) return;
    const look = looks.get(id) || (panels ? 'articles' : 'screen'), print = !canRedraw || look === 'print';
    const items = [...(panels || [['screen', 'Screen']]), ['print', 'As it prints']];
    const bar = canRedraw ? uiBar({ kind: 'tools', id: `idt-look-${id}`, label: 'Drawing', view: { id: `idt-look-v-${id}`, label: 'Show', attr: 'data-idt-look', value: print ? 'print' : look, items }, actions: diffsAct(id, r?.compare?.mismatches?.length) }) : '';
    if (print) { host.innerHTML = `${bar}${note}${pic ? pic.html : '<p class="meta">The picture could not be read</p>'}`; return; }
    if (flow) { host.innerHTML = `${bar}${note}<div class="idt-surface"><div class="idt-chart">${sanitizeSvg(flow)}</div></div>`; return; }
    const grid = gridOf(look);
    // the printed legend under the table is its notes, after the item's own (lib/printed-data.mjs printedEffectsTable)
    if (grid) { liveTable(host, { ...it, id: panels ? `${id}-${look}` : id, notes: [...(it.notes || []), ...(r.notes || [])] }, grid, { from: r.file ? `from ${r.file.split('/').pop()}` : r.draw ? "from the app's data" : '', lead: `${bar}${note}` }); return; }
    host.innerHTML = `${bar}${note}<div class="idt-surface"></div>`;
    const box = host.querySelector('.idt-surface'), rows = withStudies(r.forest.map(x => ({ label: x.label, est: x.est, lo: x.lo, hi: x.hi, weight: x.weight ?? null, ...(x.pooled ? { pooled: true } : {}), attrs: x.sid ? { 'data-idt-study': x.sid } : {} })));
    box.innerHTML = `<div class="idt-chart chart-svg mk-plot">${ac.forestTable(rows, { width: innerWidth(box), log: true, ref: 1, title: refText(it.title) || 'Forest plot' })}</div>`;
    wireDrill(box, { id: `idt-drill-${id}`, open: openStudyKey, library: k => openStudyKey(k) });
  };
  draw(); watchWidth(host, () => { if (looks.get(id) !== 'print' && r.forest?.length) draw(); });
}
/** The picture a print stands for in the browser: a TIF's PNG of the same name beside it (a browser draws no TIF). */
const shownPicture = path => String(path || '').replace(/\.tiff?$/i, '.png');
/**
 * A print of several panels (lib/printed-data.mjs panelFacts), each under its letter in print order, drawn as the app draws its kind: a forest
 * as Make's screen forest with the print's options (its subgroups, no pooling without a total, the follow-up and each arm's events, its axis,
 * its favors labels), a table as the interactive table (Direction of effect rows and the printed notes kept); a panel nothing reads is that
 * part of the picture. Study rows open their records; As it prints is the picture whole.
 */
async function drawPanels(host, it, r, folder) {
  const id = it.id, pic = await filePicture(folder, shownPicture(r.path), it.title || 'Figure'), file = fileOf(r);
  const [ac, fo] = await Promise.all([import('../lib/analysis-charts.mjs'), import('../lib/forest-options.mjs')]);
  if (r.panels.some(p => p.kind === 'table')) host.dataset.idtWide = '';   // a table takes the page's width
  host.onclick = e => { const b = e.target.closest?.('[data-idt-look]'); if (b) { looks.set(id, b.dataset.idtLook); draw(); } };
  const forestRows = p => withStudies(p.forest.rows.map(x => (x.heading ? { heading: x.heading } : x.pooled ? { pooled: true, label: x.label, est: x.est, lo: x.lo, hi: x.hi }
    : { label: x.label, est: x.est, lo: x.lo, hi: x.hi, cells: { ...(x.fu ? { fu: x.fu } : {}), ...(x.a ? { a: x.a, b: x.b } : {}) }, attrs: x.sid ? { 'data-idt-study': x.sid } : {} })));
  const forestSvg = (p, width) => {
    const f = p.forest, cols = [...(f.fu ? [{ key: 'fu', head: 'Follow-up (mo)', keep: 1 }] : []), ...(f.events && f.arms.length === 2 ? [{ key: 'a', head: f.arms[0], keep: 2 }, { key: 'b', head: f.arms[1], keep: 2 }] : [])];
    const favours = f.favours.length === 2 ? f.favours.map(x => x.replace(/^favou?rs\b/i, 'Favors')) : null;
    return ac.forestTable(forestRows(p), { width, log: true, ref: 1, xLabel: f.measure, favours, cols, axis: fo.ratioAxis(f.axis), title: `${refText(it.title) || 'Figure'}, panel ${p.letter}` });
  };
  const forests = () => host.querySelectorAll('[data-idt-forest]').forEach(chart => {
    const p = r.panels.find(x => x.letter === chart.dataset.idtForest), box = chart.closest('.idt-surface');
    chart.innerHTML = forestSvg(p, innerWidth(box));
    wireDrill(box, { id: `idt-drill-${id}-${p.letter}`, open: openStudyKey, library: k => openStudyKey(k) });
  });
  const body = p => (p.kind === 'forest' ? `<div class="idt-surface"><div class="idt-chart chart-svg mk-plot" data-idt-forest="${esc(p.letter)}"></div></div>`
    : p.kind === 'table' ? `<div data-idt-table="${esc(p.letter)}"></div>`
      : pic ? `<div class="idt-print idt-crop"><img src="${esc(pic.url)}" alt="${esc(`${it.title || 'Figure'}, panel ${p.letter}`)}" data-idt-crop="${esc(p.letter)}"></div>` : '');
  const draw = () => {
    if (!host.isConnected) return;
    const print = looks.get(id) === 'print';
    const bar = uiBar({ kind: 'tools', id: `idt-look-${id}`, label: 'Drawing', view: { id: `idt-look-v-${id}`, label: 'Show', attr: 'data-idt-look', value: print ? 'print' : 'screen', items: [['screen', 'Screen'], ['print', 'As it prints']] }, actions: diffsAct(id, r.compare?.mismatches?.length) });
    if (print) { host.innerHTML = `${bar}${pic ? pic.html : '<p class="meta">The picture could not be read</p>'}`; return; }
    host.innerHTML = `${bar}${r.panels.map(p => `<section class="idt-panel" aria-label="${esc(`Panel ${p.letter}`)}"><h3 class="idt-title">${esc(p.letter)}</h3>${body(p)}</section>`).join('')}`;
    forests();
    for (const p of r.panels.filter(x => x.kind === 'table')) {
      liveTable(host.querySelector(`[data-idt-table="${CSS.escape(p.letter)}"]`), { ...it, id: `${id}-${p.letter}`, title: `${it.title || 'Figure'}, panel ${p.letter}`, notes: p.table.notes || [] }, gridOfRows(p.table.rows), { from: file ? `from ${file}` : '' });
    }
    // a panel nothing reads: its part of the picture, the picture's width at the panel's share of its height
    host.querySelectorAll('[data-idt-crop]').forEach(img => {
      const p = r.panels.find(x => x.letter === img.dataset.idtCrop), share = Math.max(0.05, p.bottom - p.top);
      const fit = () => { if (!img.naturalWidth) return; img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight * share}`; img.style.objectPosition = `0 ${share >= 1 ? 0 : (100 * p.top) / (1 - share)}%`; };
      if (img.complete) fit(); else img.onload = fit;
    });
  };
  draw(); watchWidth(host, () => { if (looks.get(id) !== 'print') forests(); });
}

/**
 * A synthesis's forest as Make's screen chart reads it (lib/analysis-charts.mjs forestRows over an analysis-shaped fit): a comparison's risk
 * ratios from its arms (lib/synth-figures.mjs forestSpec, the record's pooled result), or each arm's proportion with its exact interval;
 * each study row carries its study for the press. Null for a kind without a forest.
 */
function synthForest(model, kind, oid, code, sf, dta) {
  const recs = model.records.filter(r => r.code === code);
  if (kind === 'forest') {
    const rec = recs.find(x => x.outcomeId === oid && x.method.startsWith('Meta'));
    if (!rec) return null;
    const st = sf.forestSpec(rec).groups[0].studies.filter(x => x.est), z = 1.959963984540054, p = rec.pool;
    const fit = { study_est: st.map(x => Math.exp(x.est.y)), study_lo: st.map(x => Math.exp(x.est.y - z * Math.sqrt(x.est.v))), study_hi: st.map(x => Math.exp(x.est.y + z * Math.sqrt(x.est.v))),
      weights: st.map(x => x.weight), ...(p ? { estimate: p.rr, lo: p.lo, hi: p.hi } : { estimate: NaN, lo: NaN, hi: NaN }) };
    const rows = studyAttrs(ac => ac, st.map(x => x.sid), ac => ac)(fit, st.map(x => x.study));
    return { rows: p ? rows : rows.filter(r => !r.pooled), log: true, ref: 1, xLabel: 'Risk ratio', favours: ['Favors intervention', 'Favors comparator'] };
  }
  if (kind === 'proportions') {
    const rec = recs.find(x => x.outcomeId === oid && x.family === 'Proportions');
    const arms = (rec?.subgroups || []).filter(g => g.rows.length).flatMap(g => g.rows.map((r, i) => ({ ...r, w: g.pool?.weights?.[i] ?? null })));
    if (!arms.length) return null;
    const ci = arms.map(r => dta.clopperPearson(r.e, r.n)), one = rec.subgroups.filter(g => g.rows.length).length === 1 ? rec.subgroups.find(g => g.rows.length).pool : null;
    const fit = { study_est: arms.map(r => (100 * r.e) / r.n), study_lo: ci.map(c => 100 * c[0]), study_hi: ci.map(c => 100 * c[1]), weights: arms.map(r => r.w),
      ...(one ? { estimate: one.p, lo: one.lo, hi: one.hi } : { estimate: NaN, lo: NaN, hi: NaN }) };
    const rows = studyAttrs(null, arms.map(r => r.sid))(fit, arms.map(r => `${r.study}${r.role === 'C' ? ', comparator' : ''}`));
    return { rows: one ? rows : rows.filter(r => !r.pooled), log: false, ref: null, xLabel: 'Proportion (%)', favours: null };
  }
  return null;
}
/** forestRows with each study's row carrying its study id (`data-idt-study`) for the press. */
const studyAttrs = (_, ids) => (fit, labels) => forestRowsOf(fit, labels, { attrs: i => (ids[i] ? { 'data-idt-study': ids[i] } : {}), overallLabel: 'Pooled' });
let forestRowsOf = null;

// ---- the preview -------------------------------------------------------------------------------------------------------------------------
/** The screen chart's surface, at the preview's width; its inner width (less its 16 px padding) is what a chart is drawn at. */
const surface = host => { if (!host.querySelector(':scope > .idt-surface')) host.innerHTML = '<div class="idt-surface"></div>'; return host.querySelector(':scope > .idt-surface'); };
const innerWidth = box => Math.max(280, box.clientWidth - 32);
/** A print drawing on its white sheet: padded, scaled to the sheet's inner width with its proportions, a caption under it. */
const sheet = svg => `<figure class="idt-sheet"><div class="idt-print">${sanitizeSvg(svg)}</div><figcaption>As it prints</figcaption></figure>`;
const looks = new Map();   // item id -> 'screen' | 'print': the synthesis preview's view switch
/** A table as HTML: its cells (each naming its source on hover), its footnote marks in place, its notes under it. */
/**
 * A table as an interactive table: its header sticky, a column sorted by pressing its head (again: the other way), its rows filtered by
 * a word, paged with the app's pager; each cell names its source on hover, a study it names opens that study, a footnote mark links to its
 * note. `view` { sort: [col, dir], q, page }; `papers` the Library by key (lib/package-cites.mjs libraryIndex) for the study cells.
 */
export function tableHtml(it, grid, { from = '', view = {}, index = null, id = 'tbl', diffs = 0 } = {}) {
  const marked = markGrid(grid, it.marks || []), src = sourceGrid(grid, { from }), head = marked.rows[0], [sc, dir] = view.sort || [null, 1];
  // a study's further arms continue under an empty first cell: they filter, sort and page with their study (lib/item-detail.mjs studyRows)
  const all = marked.rows.slice(1), cell = (ri, ci) => String(marked.rows[ri]?.cells?.[ci]?.text ?? '');
  let body = studyRows(all).map(g => ({ rows: g.rows.map(k => k + 1), arm: g.arm }));
  const q = String(view.q || '').trim().toLowerCase();
  if (q) body = body.filter(g => g.rows.some(ri => marked.rows[ri].cells.some(c => String(c?.text ?? '').toLowerCase().includes(q))));
  if (sc != null) {
    const val = g => g.rows.map(ri => cell(ri, sc)).find(v => v.trim()) || '', num = v => (/^\s*-?\d+(\.\d+)?/.test(v) ? parseFloat(v) : NaN);
    body.sort((a, b) => { const x = val(a), y = val(b), nx = num(x), ny = num(y); return dir * (Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true })); });
  }
  const studies = body.some(g => g.rows.length > 1), shown = pageOf(body, view.page || 1);
  // the columns shown (the table's More hides some), the study's identity sticky at the left, a long value held to two lines, whole on hover
  const hide = new Set(view.hide || []), shownCol = ci => !hide.has(ci), heads = (head?.cells || []).map(c => String(c?.text ?? '').trim());
  const stick = new Set([0, ...(/^(id|#|no\.?)$/i.test(heads[0] || '') && /stud/i.test(heads[1] || '') ? [1] : [])].filter(shownCol));
  const cls = ci => (stick.has(ci) ? ` class="idt-stick${ci === [...stick].at(-1) ? ' idt-stick-end' : ''}"` : '');
  const tip = (text, source) => (text.length > LONG_CELL ? `${text}\n\n${source}` : source);
  const runs = (c, ri, ci) => (c.runs?.length ? c.runs.map(x => (x.sup ? x.t.split(',').map(m => `<sup><a href="#idt-note-${esc(id)}-${esc(m)}" class="idt-mark">${esc(m)}</a></sup>`).join(',') : esc(x.t))).join('') : esc(c.text ?? ''));
  const studyOf = text => { const keys = index ? citesInText(text, index) : []; return keys.length === 1 ? keys[0] : null; };
  // a study of several arms: the columns that differ between its arms lead, after the study's identity, so an arm's row always shows what
  // makes it an arm; the study-level columns follow (the person can still hide any)
  const ids = [...stick], armCols = studies ? armColumns(marked.rows, studyRows(all), new Set([0, 1].filter(ci => stick.has(ci) || ci === 0))) : [];
  const order = [...ids, ...armCols.filter(ci => !ids.includes(ci)), ...heads.map((_, ci) => ci).filter(ci => !ids.includes(ci) && !armCols.includes(ci))];
  const visible = order.filter(ci => shownCol(ci) && !head?.cells?.[ci]?.merged), labelAt = ids.at(-1) ?? visible[0], rest = visible.filter(ci => !stick.has(ci));
  const th = visible.map(ci => `<th scope="col"${cls(ci)} aria-sort="${sc === ci ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="idt-sort" data-idt-sort="${ci}" title="${esc(src[0]?.cells[ci]?.source || '')}">${runs(head.cells[ci], 0, ci)}</button></th>`).join('');
  // each arm is named once: by the arm's own column where it is shown ("Arm 2 (n=25) …"), else quietly under the study
  const armAt = armCols.find(ci => all.some(r => /^Arm\s+\d/i.test(String(r.cells?.[ci]?.text ?? '').trim()))), named = armAt != null && visible.includes(armAt);
  const open = new Set(view.open || []), tag = text => (text && !named ? `<span class="idt-armtag">${esc(text)}</span>` : '');
  const td = (ri, ci, extra = '') => {
    const c = marked.rows[ri].cells[ci] || { text: '' }, source = src[ri]?.cells[ci]?.source || '';
    if (c.merged) return `<td${cls(ci)}></td>`;
    const key = ci === 0 || (stick.has(ci) && /stud/i.test(heads[ci])) ? studyOf(String(grid.rows[ri]?.cells?.[ci]?.text ?? '')) : null, inner = `<span class="idt-clip">${runs(c, ri, ci)}</span>`;
    return `<td${cls(ci)} title="${esc(tip(String(c?.text ?? ''), source))}">${key ? `<button type="button" class="idt-go" data-open="${esc(key)}">${inner}</button>` : inner}${extra}</td>`;
  };
  // an arm's values in the columns the person hid: one quiet line, header and value, for a study's arms expanded in place
  // (the arm's own label, already at the line's start, is not said again: "Arm 2 (n=25) Conventional" reads "Conventional")
  const armLine = (ri, label) => armCols.map(ci => [heads[ci], cell(ri, ci).replace(/\s+/g, ' ').trim()]).filter(([, v]) => v)
    .map(([h, v]) => (label && v.startsWith(label) ? v.slice(label.length).trim() : `${h}: ${v}`)).filter(Boolean).join('; ');
  const tr = shown.items.flatMap(g => {
    const many = g.rows.length > 1, key = String(g.rows[0]);
    // an arm's row that would show nothing but its label in the columns shown is not drawn: its study offers its arms in place instead
    const blank = ri => rest.every(ci => !cell(ri, ci).trim()), folded = many && g.rows.slice(1).some(blank);
    const toggle = folded ? uiLink({ label: `${g.rows.length} arms`, icon: open.has(key) ? 'chevron-down' : 'chevron-right', cls: 'idt-arms', title: open.has(key) ? 'Hide its arms' : 'Show its arms', attrs: { 'data-idt-arms': key, 'aria-expanded': String(open.has(key)) } }) : '';
    // a row another row of its study follows carries idt-joined: no rule under it (research-views.css), set here rather than found by :has()
    const lead = `<tr${many && (!folded || open.has(key)) ? ' class="idt-lead idt-joined"' : many ? ' class="idt-lead"' : ''}>${visible.map(ci => (ci === labelAt && many ? td(g.rows[0], ci, `${folded ? '' : tag(g.arm[0])}${toggle}`) : td(g.rows[0], ci))).join('')}</tr>`;
    if (!many) return [lead];
    const arms = g.rows.map((ri, k) => {
      const joined = k < g.rows.length - 1 ? ' idt-joined' : '';
      if (folded) return open.has(key) ? `<tr class="idt-cont idt-armrow${joined}">${ids.map(ci => (ci === labelAt ? `<td class="idt-arm${cls(ci).replace(' class="', ' ').replace('"', '')}">${esc(g.arm[k] || `Arm ${k + 1}`)}</td>` : `<td${cls(ci)}></td>`)).join('')}<td colspan="${rest.length}" class="idt-armvals"><span class="idt-clip idt-clip-line">${esc(armLine(ri, g.arm[k]))}</span></td></tr>` : '';
      if (!k) return '';
      return `<tr class="idt-cont${joined}">${visible.map(ci => (ci === labelAt ? `<td class="idt-arm${cls(ci).replace(' class="', ' ').replace('"', '')}" title="${esc(src[ri]?.cells[ci]?.source || '')}">${named ? '' : esc(g.arm[k] || '')}</td>` : stick.has(ci) ? `<td${cls(ci)}></td>` : td(ri, ci))).join('')}</tr>`;
    });
    return [lead, ...arms];
  }).join('');
  // a reference to another item ({{xref:<id>}}) reads as that item's label now (lib/package.mjs plainText), "[missing item]" when it is gone
  const notes = (it.notes || []).length ? `<div class="idt-notes">${it.notes.map(n => { const m = (it.marks || []).find(x => n === `${x.mark} ${x.text}`); return `<p${m ? ` id="idt-note-${esc(id)}-${esc(m.mark)}"` : ''}>${esc(refText(n))}</p>`; }).join('')}</div>` : '';
  const wide = heads.length >= WIDE_TABLE;
  const tools = uiBar({ kind: 'tools', id: `idt-tq-${id}`, label: 'Table rows', filters: [{ type: 'search', id: `idt-tq-${id}-q`, label: 'Filter rows', placeholder: 'Filter rows', value: view.q || '' }], actions: diffsAct(id, diffs),
    ...(wide ? { overflow: [{ id: `idt-tc-${id}`, label: hide.size ? `Show or hide columns (${hide.size} hidden)` : 'Show or hide columns', attrs: { 'data-idt-cols': id } }] } : {}) });
  const foot = pager({ id: `idt-tp-${id}`, page: shown.page, pages: shown.pages, total: body.length, label: studies ? 'studies' : 'rows' });
  // the shared table region (lib/ui-components.mjs): sideways scroll inside it only, its first column kept, its cut edge fading
  return `${tools}${pagedTable({ label: it.title || 'Table', sticky: true, html: `<table class="pkg-grid idt-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`, pager: foot })}${notes}`;
}
const LONG_CELL = 60;    // a value longer than this is held to two lines; its tooltip carries it whole
const WIDE_TABLE = 8;    // a table of this many columns or more offers Show or hide columns in its More
/** After a draw: a second kept column (the study, after its ID) starts where the first ends; the region's cue follows the new table. */
function fitTable(host) {
  const region = host.querySelector('.ui-table-region'), table = region?.querySelector('table'), first = table?.querySelector('thead th.idt-stick');
  if (!table) return;
  table.style.setProperty('--idt-stick-at', `${first && !first.classList.contains('idt-stick-end') ? first.getBoundingClientRect().width : 0}px`);
  // a value the two lines hold only in part carries itself whole in its tooltip, ahead of where it comes from
  table.querySelectorAll('td .idt-clip').forEach(c => {
    const td = c.closest('td'), text = c.textContent;
    if (c.scrollHeight > c.clientHeight + 1 && !td.title.startsWith(text)) td.title = `${text}\n\n${td.title}`;
  });
  cueRegions(host);
}
const tableViews = new Map();   // item id -> { sort, q, page, hide, open }: a table's view kept across Back and Previous / Next
export const __setTableViewForTest = (id, view) => tableViews.set(id, view);
/** Draws the interactive table into `host` and keeps it live: sorting, filtering and paging redraw the table alone, so the filter keeps its caret. */
function liveTable(host, it, grid, { from = '', lead = '', diffs = 0 } = {}) {
  const index = studyIndex();
  const draw = (focusId = '') => {
    const view = tableViews.get(it.id) || {};
    host.innerHTML = `${lead}${tableHtml(it, grid, { from, view, index, id: it.id, diffs })}`;
    host.querySelectorAll('[data-idt-sort]').forEach(b => b.onclick = () => { const ci = Number(b.dataset.idtSort), v = tableViews.get(it.id) || {}; const d = v.sort?.[0] === ci ? -v.sort[1] : 1; tableViews.set(it.id, { ...v, sort: [ci, d], page: 1 }); draw(`[data-idt-sort="${ci}"]`); });
    const q = host.querySelector(`#idt-tq-${CSS.escape(it.id)}-q`);
    if (q) q.oninput = () => { const v = tableViews.get(it.id) || {}; tableViews.set(it.id, { ...v, q: q.value, page: 1 }); const at = q.selectionStart; draw(); const n = host.querySelector(`#idt-tq-${CSS.escape(it.id)}-q`); n?.focus({ preventScroll: true }); n?.setSelectionRange?.(at, at); };
    wirePager(host, `idt-tp-${it.id}`, n => { tableViews.set(it.id, { ...(tableViews.get(it.id) || {}), page: n }); draw(); });
    host.querySelectorAll('.idt-table [data-open]').forEach(b => b.onclick = () => openStudyKey(b.dataset.open));
    // Show or hide columns, from the table's More: each column checked while shown, the study's identity always
    // a study's arms, folded where the columns shown hold nothing of theirs, opened in place
    host.querySelectorAll('[data-idt-arms]').forEach(b => b.onclick = () => {
      const v = tableViews.get(it.id) || {}, open = new Set(v.open || []), key = b.dataset.idtArms;
      if (open.has(key)) open.delete(key); else open.add(key);
      tableViews.set(it.id, { ...v, open: [...open] }); draw(`[data-idt-arms="${key}"]`);
    });
    host.querySelectorAll('[data-idt-cols]').forEach(b => b.onclick = () => {
      const v = tableViews.get(it.id) || {}, hidden = new Set(v.hide || []), heads = (grid.rows[0]?.cells || []).map((c, ci) => [ci, String(c?.text ?? '').trim() || `Column ${ci + 1}`]).filter(([ci]) => !grid.rows[0].cells[ci]?.merged);
      const set = next => { tableViews.set(it.id, { ...v, hide: [...next] }); draw(); };
      // after the More's own menu has closed (it closes once its entry has run), under the More that offered it
      setTimeout(() => { const bar = host.querySelector(`#idt-tq-${CSS.escape(it.id)}`), at = bar?.contains(document.activeElement) ? document.activeElement : bar || b;
      showMenu(at, [{ label: 'Show all columns', disabled: !hidden.size, run: () => set([]) }, '-',
        ...heads.map(([ci, label]) => ({ label, checked: !hidden.has(ci), checkType: 'checkbox', disabled: ci === 0, run: () => { const next = new Set(hidden); if (next.has(ci)) next.delete(ci); else next.add(ci); set(next); } }))]); }, 0);
    });
    fitTable(host);
    if (focusId) host.querySelector(focusId)?.focus({ preventScroll: true });
  };
  draw();
}
// ---- the app's own screen drawing of an item, first; the print second (one mechanism for every printed item) -------------------------------
const screenStyle = async () => (await import('../lib/figure-style.mjs')).figureTokens(null, { medium: 'screen' });
const fileOf = r => String(r?.printedFile || r?.file || r?.path || '').split('/').pop();
/** A preview's differences from the app, said only when there are some: one quiet item of its bar that opens their list (Printed against the app). */
const diffsAct = (id, n) => (n ? [{ id: `idt-diffs-${id}`, label: `${n} ${n === 1 ? 'value differs' : 'values differ'}`, role: 'quiet', attrs: { 'data-idt-diffs': id } }] : []);
/** Marks that name a study by its label (`data-study`, a synthesis forest's rows) carry its record (`data-idt-study`) for the press. */
function studyMarks(root) {
  const ids = new Set((get().papers || []).map(p => p.id));
  for (const g of root.querySelectorAll('[data-study]:not([data-idt-study])')) {
    const v = g.getAttribute('data-study'), k = ids.has(v) ? v : studyOfLabel(v);
    if (k) g.setAttribute('data-idt-study', k);
  }
}
/**
 * The app's interactive drawing of an item, where the app can draw it: `{ from, html(width), after(box), print() }` (`print` the app's drawing
 * for print, used under As it prints when there is no printed file), or null. A synthesis's forest with the options kept for it (the print's
 * subgroups, columns, axis, favours: lib/synth-figures.mjs screenFigureOf), a risk-of-bias traffic light and its summary (Appraisal's charts),
 * the PRISMA flow with each box's records, the evidence map with each cell's, row's and total's studies.
 */
async function appScreen(s, it, r) {
  const key = it.source?.app || '', head = key.split(':')[0], arg = key.slice(head.length + 1), t = await screenStyle();
  if (head === 'synth') {
    const [sp, sf, ac, dta] = await Promise.all([import('../lib/synth-project.mjs'), import('../lib/synth-figures.mjs'), import('../lib/analysis-charts.mjs'), import('../lib/dta.mjs')]);
    const [kind, oid, ...rest] = arg.split(':'), code = rest.join(':'), model = sp.synthesisModel(s);
    // a sheet of effects read from its print is the print's own table (its heads in its order): drawPrinted shows it
    if (kind === 'effects' && r?.effects) return null;
    forestRowsOf = ac.forestRows;
    const print = () => { const f = sf.figureOf(model, kind, oid, code); return f.error ? '' : f.svg; };
    if (kind === 'proportions') {
      const forest = synthForest(model, kind, oid, code, sf, dta);
      if (!forest) return null;
      return { from: 'Syntheses', print, html: w => ac.forestTable(forest.rows, { width: w, log: forest.log, ref: forest.ref, xLabel: forest.xLabel, favours: forest.favours, title: refText(it.title) || 'Forest plot' }) };
    }
    // a forest drawn as its print is: the options kept for it (Syntheses), else those its print shows (its subgroups, pooling, axis, columns)
    let m = model, k = kind;
    if (kind === 'forest' && !model.forests?.[sf.forestKey(code, oid)] && r?.lines?.length) {
      const pd = await import('../lib/printed-data.mjs'), lay = pd.printedForestLayout(r.lines), rec = model.records.find(x => x.code === code && x.outcomeId === oid && x.method.startsWith('Meta'));
      // the split whose groups hold the studies the print's headings hold (by name where they agree, else by their studies)
      const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), sig = gs => gs.map(g => g.map(norm).sort().join(',')).sort().join('|');
      const wantNames = lay.headings.map(norm).sort().join('|'), wantStudies = sig(lay.groups.map(g => g.studies));
      const splits = rec && lay.headings.length ? sf.subgroupChoices(model, rec).map(([key]) => [key, sf.subgroupsOf(model, rec, key) || []]) : [];
      const by = (splits.find(([, gs]) => gs.map(g => norm(g.name)).sort().join('|') === wantNames) || splits.find(([, gs]) => sig(gs.map(g => g.rows.map(x => x.study))) === wantStudies) || [''])[0];
      m = { ...model, forests: { ...(model.forests || {}), [sf.forestKey(code, oid)]: { pool: lay.pool, axis: lay.axis, fu: lay.fu, events: lay.events, ...(by ? { by } : {}) } } };
      if (by) k = `forest/${by}`;
    }
    if (sf.screenFigureOf(m, k, oid, code, { width: 640 }).error) return null;
    return { from: 'Syntheses', print, html: w => sanitizeSvg(sf.screenFigureOf(m, k, oid, code, { width: w }).svg), after: studyMarks };
  }
  if (head === 'rob-traffic' || head === 'rob-summary') {
    // the studies the print draws: the item's own scope (Figure S2: the 7 ROBINS-I studies of "Any failure"), else the instrument's figures'
    const [app, rs, schema] = await Promise.all([import('../lib/app-items.mjs'), import('../lib/rob-screen.mjs'), import('../schema.mjs')]);
    const set = app.robSets(s, { item: it }).find(x => x.tool.id === arg);
    if (!set) return null;
    // the summary bars and the traffic light as one figure at the page's width, never scaled up (lib/rob-screen.mjs)
    const html = w => sanitizeSvg(rs.robScreen(set.tool, set.done, { style: t, width: w, tones: schema.JUDGEMENT_TONE, part: set.done.length > 1 ? 'both' : 'grid' }));
    const after = box => {
      // a judgement's mark opens the study's judgement in Appraisal; a segment carries its studies (data-studies) for the list under it
      for (const g of box.querySelectorAll('[data-study]')) g.setAttribute('data-idt-study', g.getAttribute('data-study'));
      box.dataset.idtOpen = 'appraisal';
    };
    return { from: 'Appraisal', html, after, print: () => app.drawApp(s, key, { item: it }).svg || '' };
  }
  if (head === 'prisma') {
    const [flow, pc, pr] = await Promise.all([import('../lib/prisma-flow.mjs'), import('../lib/prisma-counts.mjs'), import('../lib/prisma-records.mjs')]);
    const sets = pr.sets(s), opts = { previous: false, other: false, ...(s.prismaArms || {}) };
    const after = box => {
      for (const g of box.querySelectorAll('[data-box]')) {
        const b = pr.BOXES[g.dataset.box], recs = (b?.fields || []).flatMap(f => sets[f]?.records || []).filter(x => !x.removed);
        if (recs.length) { g.setAttribute('data-studies', [...new Set(recs.map(x => x.id))].join(' ')); g.setAttribute('data-drill-label', b.label); g.setAttribute('data-drill-noun', 'records'); g._notes = new Map(recs.map(x => [x.id, x.note || ''])); }
        else { g.setAttribute('title', `${b?.label || 'This box'}: the app holds no records for this count`); g.removeAttribute('role'); g.removeAttribute('tabindex'); }
      }
    };
    return { from: 'Reporting', after, print: () => flow.prismaFlow(pc.prismaData(s), opts), html: () => sanitizeSvg(flow.prismaFlow(pc.prismaData(s), { ...opts, style: t, interactive: true })) };
  }
  if (!key && it.kind === 'figure' && /evidence map/i.test(it.title || '') && s.evidenceMap) {
    const em = await import('../lib/evidence-map.mjs'), map = em.itemMap(s, it);
    if (!map) return null;
    const o = { ...(s.evidenceMap || {}), ...(it.map || {}) }, look = { shade: o.shade || 'linear', patients: map.patients ? o.patients || 'log' : '' };
    return { from: 'Tables and figures', html: w => sanitizeSvg(em.evidenceMapSvg(map, { style: t, width: w, ...look, drill: true })), print: () => em.evidenceMapSvg(map, look) };
  }
  return null;
}

/** Opens a study from a mark: in Appraisal for a judgement's mark, else as a study opens everywhere. */
function openFromMark(box, id) {
  if (box?.dataset.idtOpen === 'appraisal' && paneCtx?.openStudyResults) return paneCtx.openStudyResults('appraisal', paperId(id));
  return openStudyKey(id);
}
const libraryOf = async k => { const { focusPaper } = await import('./library.mjs'); focusPaper(paperId(k)); paneCtx?.go('library'); };
/** Draws the app's screen (Screen) and the print (As it prints) behind one switch; the marks list or open their studies. */
async function drawApp(host, it, screen, r, folder) {
  const id = it.id, path = r?.path || printedPath(it.source) || (it.source?.held ? `.lykos/package/${it.source.held}` : '');
  const pic = await filePicture(folder, path, it.title || 'Figure');
  host.onclick = e => { const b = e.target.closest?.('[data-idt-look]'); if (b) { looks.set(id, b.dataset.idtLook); draw(); } };
  const draw = () => {
    if (!host.isConnected) return;
    const print = looks.get(id) === 'print';
    const bar = uiBar({ kind: 'tools', id: `idt-look-${id}`, label: 'Drawing', view: { id: `idt-look-v-${id}`, label: 'Show', attr: 'data-idt-look', value: print ? 'print' : 'screen', items: [['screen', 'Screen'], ['print', 'As it prints']] }, actions: diffsAct(id, r?.compare?.mismatches?.length) });
    if (print) { const svg = pic ? '' : screen.print?.() || ''; host.innerHTML = `${bar}${pic ? pic.html : svg ? sheet(svg) : '<p class="meta">No printed file</p>'}`; return; }
    host.innerHTML = `${bar}<div class="idt-surface"><div class="idt-chart chart-svg mk-plot" data-idt-marks></div></div>`;
    const box = host.querySelector('.idt-surface'), chart = box.querySelector('[data-idt-marks]');
    chart.innerHTML = screen.html(innerWidth(box));
    screen.after?.(chart);
    wireDrill(chart, { id: `idt-drill-${id}`, open: k => openFromMark(chart, k), library: libraryOf, notesOf: el => el._notes || new Map() });
  };
  draw(); watchWidth(host, () => { if (looks.get(id) !== 'print') draw(); });
}

/** A caption's or note's references as the items' labels now. */
export const refText = t => { const L = labels(get().package || { parts: [], items: {} }); return plainText(t, id => L.get(id), '[missing item]'); };
/** The note over a printed table: the studies it names matched in the app, its values against Extraction's. */
const tableDiffs = g => tableAgainstApp(get(), g, t => studyOfLabel(t)).mismatches.length;
async function drawPreview(host, id, { grid = null, svg = null, printed = null, folder = null } = {}) {
  const s = get(), it = s.package?.items?.[id];
  if (!it || !host.isConnected) return;
  openPictures(id);
  const key = it.source?.app || '', head = key.split(':')[0], arg = key.slice(head.length + 1);
  try {
    // the app's own drawing first where it can draw the item (its marks open their studies), the print under As it prints; else the print
    // redrawn from what it prints (else its script's data); a difference between the two is listed under Printed against the app
    if (it.kind === 'figure') {
      // a print of several panels is drawn panel by panel from what it prints, whatever the item was made from (the print is the truth)
      if (printed?.panels?.length) return void await drawPrinted(host, it, printed, folder);
      const screen = await appScreen(s, it, printed).catch(err => { console.warn('[item detail] screen', err?.message || err); return null; });
      if (screen) return void await drawApp(host, it, screen, printed, folder);
      if (printed && printed.source !== 'app') return void await drawPrinted(host, it, printed, folder);
    }
    // a pooled analysis: the forest Make draws, at the pane's width
    if (head === 'forest') {
      const [outc, ac] = await Promise.all([import('../lib/outcomes.mjs'), import('../lib/analysis-charts.mjs')]);
      const a = outc.analysisOf(s, arg);
      if (a?.study_est?.length) {
        const ratio = /^(RR|OR|HR)$/i.test(a.measure || ''), rows = withStudies(ac.forestRows(a, (a.labels || a.studies || []).map(String)));
        const draw = () => { if (!host.isConnected) return; const box = surface(host); box.innerHTML = `<div class="idt-chart chart-svg mk-plot">${ac.forestTable(rows, { width: innerWidth(box), log: ratio, ref: ratio ? 1 : 0, title: refText(it.title) || 'Forest plot' })}</div>`; wireDrill(box, { id: `idt-drill-${id}`, open: openStudyKey, library: k => openStudyKey(k) }); };
        draw(); watchWidth(host, draw);
        return;
      }
    }
    // a synthesis: Make's screen forest from the combination's pooled data (the interface's tokens in both themes, a study on hover, a press
    // opens it), with As it prints, the print drawing on paper, one press away; a kind without a forest (effect direction) as Syntheses draws it
    if (head === 'synth') {
      const [sp, sf, ac, dta] = await Promise.all([import('../lib/synth-project.mjs'), import('../lib/synth-figures.mjs'), import('../lib/analysis-charts.mjs'), import('../lib/dta.mjs')]);
      const [kind, oid, ...rest] = arg.split(':'), code = rest.join(':'), model = sp.synthesisModel(s);
      forestRowsOf = ac.forestRows;
      const forest = synthForest(model, kind, oid, code, sf, dta);
      const draw = () => {
        if (!host.isConnected) return;
        const print = looks.get(id) === 'print';
        const bar = uiBar({ kind: 'tools', id: `idt-look-${id}`, label: 'Drawing', view: { id: `idt-look-v-${id}`, label: 'Show', attr: 'data-idt-look', value: print ? 'print' : 'screen', items: [['screen', 'Screen'], ['print', 'As it prints']] } });
        if (print) { const f = sf.figureOf(model, kind, oid, code); host.innerHTML = `${bar}${f.error ? `<p class="meta">${esc(f.error)}</p>` : sheet(f.svg)}`; }
        else {
          host.innerHTML = `${bar}<div class="idt-surface"></div>`;
          const box = host.querySelector('.idt-surface'), iw = innerWidth(box);
          if (forest) box.innerHTML = `<div class="idt-chart chart-svg mk-plot">${ac.forestTable(forest.rows, { width: iw, log: forest.log, ref: forest.ref, xLabel: forest.xLabel, favours: forest.favours, title: refText(it.title) || 'Forest plot' })}</div>`;
          else { const f = sf.screenFigureOf(model, kind, oid, code, { width: iw }); box.innerHTML = f.error ? `<p class="meta">${esc(f.error)}</p>` : `<div class="idt-chart">${sanitizeSvg(f.svg)}</div>`; }
        }
        host.querySelectorAll('[data-idt-look]').forEach(b => b.onclick = () => { looks.set(id, b.dataset.idtLook); draw(); });
        wireDrill(host.querySelector('.idt-surface') || host, { id: `idt-drill-${id}`, open: openStudyKey, library: k => openStudyKey(k) });
      };
      draw(); watchWidth(host, () => { if (looks.get(id) !== 'print') draw(); });
      return;
    }
    if (it.kind === 'table') {
      let g = grid;
      if (!g && key) { const app = await import('../lib/app-items.mjs'), d = app.drawApp(s, key); if (d.rows) g = { rows: d.rows.map((r, i) => ({ ...(i === 0 ? { header: true } : {}), cells: r.map(t => ({ text: String(t ?? '') })) })) }; }
      if (!g) { const { loadSources } = await import('../lib/package-sources.mjs'); g = (await loadSources(activeFolder(), [{ ...it, marks: undefined }], { state: s })).get(id)?.grid || null; }
      const from = it.source?.held || it.source?.path ? 'from its document' : '';
      host.dataset.idtWide = '';   // a data table takes the page's width; a figure keeps its measure
      if (g) liveTable(host, it, g, { from, diffs: key ? 0 : tableDiffs(g) }); else host.innerHTML = '<p class="meta">The table could not be read</p>';
      return;
    }
    // a figure the app draws for print only, as it prints; a file, its own picture
    const drawing = svg || (key ? (await import('../lib/app-items.mjs')).drawApp(s, key, { item: it }).svg : '');
    if (drawing) { host.innerHTML = sheet(drawing); return; }
    const path = it.source?.held ? `.lykos/package/${it.source.held}` : it.source?.path, from = folder || activeFolder();
    if (path && from) {
      const url = await pictureUrl(from, path);
      if (!url) throw new Error('The picture could not be read');
      if (!host.isConnected) return;
      host.innerHTML = `<figure class="idt-file"><img src="${esc(url)}" alt="${esc(labels(s.package).get(id) || 'Figure')}"></figure>`;
      return;
    }
    host.innerHTML = '<p class="meta">No app source; no project folder</p>';
  } catch (err) { if (host.isConnected) host.innerHTML = `<p class="meta">${esc(String(err?.message || err))}</p>`; }
}
