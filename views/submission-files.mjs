// Submission › Files (plan §2, "Submission files, structured"): what the submission sends, by kind (Manuscript, Tables, Figures,
// Supplementary, Cover letter and declarations), derived from the manuscript and the package each time (lib/submission-package.mjs). A row
// is the file's name, its file and format, its state (built, stale, missing) and the works it cites; pressing the count lists them in the
// order of the reference list. Tables, figures and supplementary items reorder by drag or by Move up and Move down in their More, and move
// between the main text and the supplement; a change is shown first (the labels, the manuscript's mentions and the reference numbers it
// changes) and is undone from the title bar. A table's caption and footnotes are edited here, its marks on the cells that carry them
// (lib/footnotes.mjs). Loaded on first use of Show: Files (views/submissions.mjs).
import { get, update, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiNotice } from '../lib/ui-actions.mjs';
import { formField } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk, formDialog, planDialog, pickerDialog, pickerRows } from '../lib/dialog.mjs';
import { agreement, buildGate, withChoices, builtAgainstPrinted } from '../lib/build-in-app.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { plural } from '../lib/dates.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { journalContext } from '../lib/journal-context.mjs';
import { authorLine } from '../lib/bib.mjs';
import { partState, appSigner, labels } from '../lib/package-state.mjs';
import { CONVENTIONS, conventionsOf, referenceOrder, numberChanges, isThePaper, libraryIndex, svgText, textCites, callouts, reviewStudies, itemStudies, gridTexts, svgTexts, lineTexts, studyKeys, unsettled } from '../lib/package-cites.mjs';
import { getVersion } from '../store.mjs';
import { submissionFiles, packageGroups, groupOf, reorderPlan, undoOf, applyUndo } from '../lib/submission-package.mjs';
import { otherPaper } from '../lib/manuscript-fit.mjs';
import { readNotes, writeNotes, remark, cellName, markGrid, markOrder, markOf } from '../lib/footnotes.mjs';
import { bars, card, cards } from '../lib/grade-cards.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { commentsSection } from './comments-pane.mjs';
// the printed file an item stands for (lib/printed-data.mjs printedPath, which loads on use): a `was` that is an object is history, not a file
const printedPath = src => (typeof src?.was === 'string' && src.was) || (typeof src?.path === 'string' && src.path) || '';

const STATE_WORD = { built: 'Built', stale: 'Stale', folder: 'In the folder', cannot: 'Cannot build', missing: 'Missing', unknown: 'Not built', other: 'Not the review\'s' };
let shown = null;                    // { el, ctx, extra } of the last render
let undo = null;                     // { gen, data, said } of the last reorder
let counted = { key: '', running: false };
const facts = new Map();             // item id -> { grid, svg, png, unresolved }: what the sources hold, read with the counts (count)
let quality = { key: '', running: false, value: null };   // the scores (assess), once per change of the project or of the facts
// a file or a quality dimension opens on a page of its own within Submission, with Back to the list (as Tables and figures' item page does)
let page = null;                     // { kind: 'item' | 'dim', id }: the page shown, or null for the list
let fresh = false;                   // the page was just opened: it starts at its top
let listPlace = null;                // { top, focus }: the list's scroll and the control that opened the page, put back by Back
let anchor = null;                   // { sel, top, focus }: a row kept where it is on screen across the next draw (a reorder, Undo)
const partFiles = new Map();         // a part's file path -> whether it is in the folder (read with the counts)
let partFilesFor = null;             // the browser test's answer for a fixture with no folder
export const __setPartFilesForTest = fn => { partFilesFor = fn; };

/** The title bar while Files is shown (views/submissions.mjs page()): the list's commands, or a page's Back, title, Previous and Next. */
export function pageParts() {
  if (page) return pageHead();
  return {
    actions: [{ id: 'sf-review-paper', label: running === 'paper' ? 'Reviewing…' : 'Review with the assistant', role: 'secondary', disabled: !!running || !quality.value?.paper, run: () => review('paper') }],
    overflow: [{ id: 'sf-conventions', label: 'Conventions…', run: () => conventionsDialog() }, { id: 'sf-package', label: 'Open package', run: () => openPackage() }],
  };
}
const undoNow = () => (undo && undo.gen === projectGeneration() ? undo : null);

// ---- the list ------------------------------------------------------------------------------------------------------------------------------
function filesOf(s, extra = {}) {
  const pkg = s.package, sigOf = pkg?.parts?.length ? appSigner(s) : null;
  const jc = journalContext(s);
  const partFile = part => (partFilesFor ? partFilesFor(part) : partFiles.has(part.file) ? partFiles.get(part.file) : null);
  return submissionFiles(s, { partState: part => partState(pkg, part, { state: s, sigOf }), partFile, files: extra.files || [], attempt: extra.attempt || null,
    profile: jc.profile, statements: extra.statements || {} });
}

// One table for every group (the file lists of PandaDoc, Gusto, Mistral, Xero and Adobe the owner pointed to): a header row, a quiet row per
// group, and plain cells: File (its name over its file and format), Status (a mark and a word), References (a count, right-aligned, a press
// that lists them; a dash with no text), Quality (three bars and the score, a press that opens the breakdown under the row), More. One list,
// so every column lines up across the groups.
const refsCell = r => (r.refs == null
  ? '<span class="sf-c-refs sf-num sf-none" title="Nothing to read: a picture file">—</span>'
  : r.refs.length ? `<button type="button" class="sf-c-refs sf-refs sf-num" data-sf-refs="${esc(r.id)}" aria-label="${esc(`${plural(r.refs.length, 'reference')} in ${r.label || r.name}`)}">${r.refs.length}</button>`
  : '<span class="sf-c-refs sf-num">0</span>');
const scoreCell = (r, q) => (q?.overall?.pct != null
  ? `<button type="button" class="sf-c-score sf-score" data-sf-page="${esc(r.id)}" aria-label="${esc(`Quality ${q.overall.pct} of 100, ${q.overall.word}`)}" title="${esc(q.overall.word)}">${bars(q.overall.bars)}<span class="sf-num">${q.overall.pct}</span></button>`
  : `<span class="sf-c-score sf-score" aria-label="Quality not assessed yet">${bars(null)}<span class="sf-num">${quality.value ? '—' : ''}</span></span>`);
const COLS = [['status', 'Status'], ['refs', 'References'], ['score', 'Quality']];
function fileRow(r, movable, q) {
  const other = r.state === 'other';
  // the row's name opens its detail; another paper's main text says why there, with the way to the manuscript
  const name = `<button type="button" class="sf-open" data-sf-page="${esc(r.id)}">${esc(r.name)}</button>`;
  const row = uiRow({ table: true, attrs: { 'data-sf-row': r.id, 'data-sf-group': r.group, ...(movable ? { draggable: 'true' } : {}) },
    main: { html: name, detail: [r.file, r.format].filter(Boolean).map(esc) },
    cells: [{ col: 'status', kind: 'text', ch: 16, html: `<span class="sf-state" data-state="${r.state}"${r.reason ? ` title="${esc(String(r.reason).replace(/^./, c => c.toUpperCase()))}"` : r.state === 'folder' ? ' title="Not built by the app"' : ''}>${esc(STATE_WORD[r.state])}</span>` },
      { col: 'refs', kind: 'visual', html: refsCell(r) }, { col: 'score', kind: 'visual', html: scoreCell(r, q) }],
    end: uiRowEnd({ more: { label: `More for ${r.label || r.name}`, attrs: { 'data-sf-more': r.id } } }) });
  return row;
}
const details = new Map();   // package item id -> its detail facts (views/item-detail.mjs detailFacts), read when its pane first opens
/** The detail's facts with the studies the item's rows and marks name (read with its source, count), for its References. */
const withStudies = (f, id) => (f && facts.get(id)?.studies ? { ...f, studies: facts.get(id).studies } : f);
let detailView = null;
async function loadDetail(id) {
  if (details.has(id)) return;
  details.set(id, null);
  try { details.set(id, await detailView.detailFacts(get(), id, { redraw: facts.get(id)?.printed || null, grid: facts.get(id)?.grid || null })); } catch (err) { details.delete(id); console.warn('[submission details]', err?.message || err); }
  redraw();
}
const blankCells = () => [{ col: 'status', kind: 'text', ch: 16, html: '' }, { col: 'refs', kind: 'visual', html: '' }, { col: 'score', kind: 'visual', html: '' }];
const sectionRow = g => uiRow({ table: true, cls: 'sf-section', attrs: { 'data-sf-section': g.id }, main: { html: `<span class="sf-section-name">${esc(g.title)}<span class="sf-section-n">${g.rows.length}</span></span>` },
  cells: blankCells(), end: uiRowEnd({ reserve: true }) });
/** The files as one table: the header, then each group's quiet row and its files. */
function filesTable(groups) {
  const q = quality.value?.rows;
  const head = uiRow({ table: true, cls: 'sf-colhead', attrs: { role: 'presentation' }, main: { html: '<span>File</span>' },
    cells: COLS.map(([col, word]) => ({ col, kind: col === 'status' ? 'text' : 'visual', ...(col === 'status' ? { ch: 16 } : {}), html: `<span class="sf-c-${col}">${word}</span>` })), end: uiRowEnd({ reserve: true }) });
  const all = groups.flatMap(g => [sectionRow(g), ...(g.rows.length ? g.rows.map(r => fileRow(r, ['tables', 'figures', 'supplementary'].includes(g.id), q?.get(r.id)))
    : [uiRow({ table: true, cls: 'sf-empty', main: { html: `<span class="sf-file">${g.id === 'tables' ? 'No tables in the package' : 'No figures in the package'}</span>` }, cells: blankCells(), end: uiRowEnd({ reserve: true }) })])]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // the count a quiet number beside the title; Undo reorder at the head's end, in a slot kept while there is nothing to undo
  // a long list pages with the app's pager, its page kept across Back
  const shown = pageOf(all, listPage), foot = pager({ id: 'sf-list-pages', page: shown.page, pages: shown.pages, total: all.length, label: 'rows' });
  const filesHead = uiBar({ kind: 'head', id: 'sf-files-head', label: 'Files', lead: { title: 'Files', level: 'h2' }, status: { id: 'sf-files-count', text: String(total), ch: 4 },
    actions: [{ id: 'sf-undo', label: 'Undo reorder', icon: 'undo', role: 'quiet', presence: 'reserve', hidden: !undoNow() }] });
  return `<section class="sf-files" aria-label="Files">${filesHead}
    ${uiList({ id: 'sf-list', label: 'Submission files', cols: ['status', 'refs', 'score'], head, rows: shown.items, cls: 'sf-table' })}${foot}</section>`;
}

// ---- quality ------------------------------------------------------------------------------------------------------------------------------
const CHECK_WORD = { ok: 'Met', warn: 'To review', missing: 'Not met', na: 'Not assessed' };
const GO_WORD = { manuscript: 'Manuscript', reporting: 'Reporting', certainty: 'Certainty', appraisal: 'Appraisal', analysis: 'Analysis', outputs: 'Tables and figures', library: 'Library', extraction: 'Extraction', submission: 'this page' };
/** One check: its label (a press to the page that fixes it when it fails), what it found, and Met, To review or Not met after its mark. */
function checkRow(c) {
  const bad = c.state === 'warn' || c.state === 'missing', go = bad && c.go && c.go !== 'submission';
  const label = go ? `<button type="button" class="sf-go" data-sf-go="${esc(c.go)}" title="${esc(`Open ${GO_WORD[c.go] || c.go}`)}">${esc(c.label)}</button>` : `<span class="sf-check">${esc(c.label)}</span>`;
  // a failing check says what was found and what to do; the label goes to where it is done
  return detailView.paneRow({ attrs: { 'data-sf-check': c.id, 'data-state': c.state }, label, sub: [c.detail, c.fix].filter(Boolean).map(esc), value: detailView.stateHtml(c.state, CHECK_WORD[c.state]) });
}
const ORDER = { missing: 0, warn: 1, ok: 2, na: 3 };
/** A score at a section's end: its bars and the score, as the table's Quality column draws them. */
const scoreEnd = d => `<span class="sf-c-score sf-score">${bars(d.bars)}<span class="sf-num">${d.pct ?? '—'}</span></span>`;
/** One dimension as a section of the pane: its title with its score at the row's end, then its checks, failing ones first. */
const dimSection = (id, d) => detailView.paneSection(`sf-checks-${id}-${d.id}`, d.label, scoreEnd(d), [...d.checks].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map(checkRow), '', { noun: 'checks' });
/** The dimensions of one file, its latest review, and Review with the assistant. */
function qualityHtml(id, q, label) {
  const rev = reviewsOf(id)[0];
  return `${q.dims.filter(d => d.checks.some(c => c.state !== 'na')).map(d => dimSection(id, d)).join('')}${rev ? reviewHtml(id, rev, reviewsOf(id)[1]) : ''}
    <div class="idt-sec">${uiBar({ kind: 'foot', id: `sf-q-foot-${id}`, label: `Quality of ${label}`, actions: [{ id: `sf-review-${id}`, label: running === id ? 'Reviewing…' : 'Review with the assistant', role: 'secondary', disabled: !!running, attrs: { 'data-sf-review': id } }] })}</div>`;
}

/**
 * The scores, from the checks the app already has (lib/file-quality.mjs): Submission readiness and its inputs (lib/overview-facts.mjs), the
 * manuscript's checks (lib/progress-checks.mjs, lib/review-checks.mjs 'facts'), the reporting checklist, each table's and figure's facts read
 * with its counts, and its drawing's signature against the one its build kept. Draws the page again when they change.
 */
async function assess() {
  const s = get(), key = `${projectGeneration()}|${getVersion()}|${facts.size}|${[...facts.values()].filter(f => f.png).length}|${[...facts.values()].filter(f => f.grid).length}|${[...facts.values()].filter(f => f.printed).length}`;
  if (quality.key === key || quality.running) return;
  quality = { ...quality, key, running: true };
  details.clear();   // the panes' facts follow the project as the scores do
  try {
    const [fq, of, gate, pc, rc, res, ck, app, fs, tw, outc, prog, sp] = await Promise.all([import('../lib/file-quality.mjs'), import('../lib/overview-facts.mjs'),
      import('../lib/progress-gate.mjs'), import('../lib/progress-checks.mjs'), import('../lib/review-checks.mjs'), import('../lib/results.mjs'), import('../lib/checklist-core.mjs'),
      import('../lib/app-items.mjs'), import('../lib/figure-style.mjs'), import('../lib/textwidth.mjs'), import('../lib/outcomes.mjs'), import('../lib/progress.mjs'), import('../lib/synth-project.mjs')]);
    await gate.checks.ensure();
    const today = new Date().toISOString().slice(0, 10), standing = of.standingFacts(s, today), readiness = of.readinessFacts(s, standing);
    const blocks = s.manuscript?.blocks || [], pkg = s.package || { parts: [], items: {} }, L = labels(pkg);
    const cl = ck.checklistOf(s), st = ck.checklistStates(s);
    const checklist = cl?.items?.length ? { name: cl.name, done: cl.items.filter(([n]) => st[n]?.state === 'done').length, na: cl.items.filter(([n]) => st[n]?.state === 'na').length, total: cl.items.length } : null;
    const report = readiness.report;
    const issues = blocks.length ? pc.manuscriptFindings(s) : [];
    const included = prog.includedStudies(s).length, results = res.results(s);
    const factsText = rc.projectFacts({ results, prisma: s.prisma, included, participants: (s.participants || []).length });
    const unsupported = rc.runRules(rc.categoryById('facts'), { blocks, facts: factsText });
    let section = '', paragraphs = 0;
    for (const b of blocks) { if (/^h[1-3]$/.test(b.type)) section = String(b.text || ''); else if (b.type === 'p' && String(b.text || '').trim() && /abstract|results?|findings/i.test(section)) paragraphs++; }
    const stale = app.staleBlocks(s, blocks).map(b => b.app?.key || b.id);
    const analyses = [s.analysis, ...Object.values(s.analyses || {})].filter(Boolean);
    const certain = standing.certainty ? { rated: standing.certainty.rows.filter(r => r.rated !== false).length, of: standing.certainty.rows.length + standing.certainty.toRate.length } : null;
    const methods = fq.paperMethods({ certainty: certain, appraisal: standing.appraisal ? { complete: standing.appraisal.complete, of: standing.appraisal.of } : null, analyses, searches: s.searches || [] });
    // a manuscript that is not the review's: one line, in place of its checks (lib/manuscript-fit.mjs)
    const other = otherPaper(s), fit = other ? { ok: false, reason: other } : { ok: true };
    // all-caps words the Library's titles hold (device names such as KAPSS) are names, not abbreviations to define
    const skip = new Set((s.papers || []).flatMap(p => String(p.title || '').match(/\b[A-Z][A-Z0-9]{2,7}\b/g) || []));
    const consistent = fq.manuscriptConsistent({ issues, unsupported, paragraphs, stale, fit });
    // the text against its tables and figures (lib/submission-checks.mjs assetOrderCheck): one cited that is not there, one first cited after a later one
    const ao = fit.ok ? (await import('../lib/submission-checks.mjs')).assetOrderCheck(blocks, []) : null, flat = t => String(t || '').replace(/\s+/g, '');
    const orderMsg = new Map((ao?.findings || []).filter(x => x.kind === 'order' && x.label).map(x => [flat(x.label), x.message]));
    const gone = (ao?.findings || []).filter(x => x.kind === 'missing');
    if (fit.ok) consistent.push(fq.fixCheck('cited-exist', 'Every cited table and figure exists', gone.length ? 'missing' : 'ok', { w: 2, detail: gone.map(x => x.message).slice(0, 3).join('; '), fix: 'Add the item, or correct the citation', go: 'manuscript' }));
    // the registration, written in the text or only recorded; the certainty of each outcome rated and stated
    const allText = blocks.map(b => String(b.text || '')).join(' '), recorded = String(s.paper?.registration || s.protocol?.registration || '').trim();
    const inText = (/\b(CRD\d{11}|osf\.io\/[\w]+|NCT\d{8}|INPLASY\d+|ISRCTN\d+)/i.exec(allText) || [])[0] || (recorded && allText.includes(recorded) ? recorded : '');
    const resultsText = blocks.filter((b, i) => { let h = ''; for (let j = i; j >= 0; j--) if (/^h[1-3]$/.test(blocks[j].type)) { h = String(blocks[j].text || ''); break; } return /results?|findings/i.test(h); }).map(b => String(b.text || '')).join(' ');
    const graded = standing.certainty ? { rated: standing.certainty.rows.filter(r => r.rated !== false).length, of: standing.certainty.rows.length + standing.certainty.toRate.length,
      stated: /\b(high|moderate|low|very low)[- ]certainty|certainty[ ](?:of[ ](?:the[ ])?evidence[ ])?(?:was|is)[ ](?:high|moderate|low|very low)/i.test(resultsText) } : null;
    const clarity = fq.manuscriptClarity(blocks, { fit, skip });
    // the tables and figures
    const tokens = fs.figureTokens(null, { medium: 'export' }), measure = (t, size) => tw.textWidth(t, size, tokens?.metrics);
    const resolution = await figureResolution(fs);
    // another paper's "Table 2" is not the package's: the callout check is not assessed
    const thePaper = isThePaper(s), calls = thePaper ? callouts(pkg, blocks) : [], called = new Set(calls.map(c => c.id)), profile = journalContext(s).profile;
    // cited in order: within each kind and place, the order of first callouts follows the numbers
    const outOfOrder = new Set(), byKind = new Map();
    for (const c of calls) { const l = L.get(c.id) || '', key = l.replace(/\d+$/, ''); if (!byKind.has(key)) byKind.set(key, []); byKind.get(key).push({ id: c.id, n: Number((/\d+$/.exec(l) || [])[0]) }); }
    for (const list of byKind.values()) list.forEach((x, i) => { if (Number.isFinite(x.n) && x.n !== i + 1) outOfOrder.add(x.id); });
    let model = null; const synthModel = () => (model ||= sp.synthesisModel(s));
    const groups = filesOf(s, shown?.extra), rowsAll = groups.flatMap(g => g.rows), main = rowsAll.filter(r => r.group === 'tables' || r.group === 'figures').length;
    const rows = new Map(), items = [];
    for (const r of rowsAll) {
      if (r.itemId) {
        const it = pkg.items[r.itemId], part = pkg.parts.find(p => p.items.includes(r.itemId)), last = (pkg.builds?.[part.id] || []).at(-1), f = facts.get(r.itemId) || {};
        const k = it.source?.app, kept = k ? last?.sources?.[`app:${k}`] : null;
        // a pooled analysis behind a forest: Analysis's, or a synthesis's pool (lib/synth-project.mjs), in the analysis's shape for the Make grade
        const slot = /^forest:/.test(k || '') ? k.slice(7) : null, sm = /^synth:forest:([^:]+):(.+)$/.exec(k || '');
        let a = slot ? outc.analysisOf(s, slot) : null;
        if (sm) { const rec = synthModel().records.find(x => x.code === sm[2] && x.outcomeId === sm[1] && x.method.startsWith('Meta')); if (rec?.pool) a = { estimate: rec.pool.rr, lo: rec.pool.lo, hi: rec.pool.hi, i2: rec.pool.I2, k: rec.kEst ?? rec.pool.k, xi: (rec.rows || []).map(x => (x.e1 || 0) + (x.e2 || 0)), measure: 'RR' }; }
        const q = fq.itemQuality({ item: it, label: L.get(r.itemId), kind: it.kind, supplementary: r.group === 'supplementary', state: r.state, reason: r.reason, cited: thePaper ? called.has(r.itemId) : null,
          order: thePaper ? !(outOfOrder.has(r.itemId) || orderMsg.has(flat(L.get(r.itemId)))) : null, orderDetail: orderMsg.get(flat(L.get(r.itemId))) || '', included, grid: f.grid, svg: f.svg, png: f.png, printed: f.printed, built: builtAgainstPrinted(it, f.printed, last && last.note === 'Built in the app from Submission › Files' ? last : null), resolution, widthIn: resolution?.widthIn || 6.89, unresolved: f.unresolved, studies: (f.studies || []).filter(x => !x.token).length, missingRefs: [it.title, it.legend, ...(it.notes || [])].flatMap(t => [...String(t || '').matchAll(/\{\{xref:([A-Za-z0-9._-]+)\}\}/g)].map(m => m[1])).filter(x => !pkg.items[x]), analysis: a, ratio: /^(RR|OR|HR)$/i.test(a?.measure || ''),
          forest: !!(slot || sm), skipWords: skip, dataCurrent: k && kept ? kept === app.appSig(s, k) : null, limit: profile?.figureTableLimit ? { max: profile.figureTableLimit, count: main } : null, tokens, measure });
        rows.set(r.id, q); items.push({ id: r.id, label: L.get(r.itemId), q });
      } else if (r.id === 'main-text') {
        rows.set(r.id, fq.dimensions(other ? { complete: fq.unfitCheck(other) } : { complete: fq.manuscriptComplete({ report, checklist, fit, registration: { recorded, inText }, grade: graded }), consistent, methods, clarity }));
      } else rows.set(r.id, fq.documentQuality(r));
    }
    const paper = fq.paperQuality({ readiness, consistent, methods, clarity, items });
    quality = { key, running: false, value: { rows, paper } };
    redraw();
  } catch (err) { quality = { ...quality, running: false }; console.warn('[submission quality]', err?.message || err); }
}
/** The width and dpi the figure style holds a supplied picture to (the figure needs' rule Y5: its forest profile, else the active one). */
async function figureResolution(fs) {
  try {
    const { readSidecar } = await import('../lib/figure-sidecar.mjs'), { PRESETS, DEFAULT_ACTIVE } = await import('../lib/figure-presets.mjs');
    const doc = (await readSidecar('style')).doc || {}, id = doc.assign?.forest || doc.active || DEFAULT_ACTIVE, p = doc.profiles?.[id] || PRESETS[id] || PRESETS[DEFAULT_ACTIVE];
    return p?.geometry?.widthIn?.portrait && p.geometry.dpi ? { widthIn: p.geometry.widthIn.portrait, dpi: p.geometry.dpi } : null;
  } catch { return null; }
}

/** The paper's quality above the files: four graded tiles (Make's cards) under a title with the overall score; a tile opens its checks below. */
const TILE = { complete: 'Completeness', consistent: 'Consistency', methods: 'Methods', clarity: 'Clarity' };
function paperHtml() {
  const v = quality.value, q = v?.paper;
  if (!q) return `<section class="sf-paper" aria-label="Paper quality"><div class="sf-tiles">${cards([card('Overall', quality.running || !v ? '…' : '—', { score: null })], 'Paper quality', 'sf-tile-grid')}</div></section>`;
  // a metric is a tile: its label, its number, its verdict in its tone, its bars; the overall first
  const overall = card('Overall', q.overall.pct == null ? '—' : String(q.overall.pct), { score: q.overall.bars, verdict: q.overall.pct == null ? null : { word: q.overall.word, tone: q.overall.tone },
    tip: 'The dimensions\' weighted mean' });
  const tiles = q.dims.map(d => { const bad = d.checks.filter(c => c.state === 'warn' || c.state === 'missing').length;
    return card(TILE[d.id], d.pct == null ? '—' : String(d.pct), { score: d.bars, tip: `${d.label}: ${d.pct == null ? 'not assessed' : bad ? plural(bad, 'check') + ' to fix' : 'every check met'}`,
      press: { 'data-sf-dim': d.id, 'data-sf-tile': d.id } }); });
  const rev = reviewsOf('paper')[0];
  return `<section class="sf-paper" aria-label="Paper quality"><div class="sf-tiles">${cards([overall, ...tiles], 'Paper quality', 'sf-tile-grid')}</div>
    ${rev ? `<div class="ui-flush sf-paper-open">${reviewHtml('paper', rev, reviewsOf('paper')[1])}</div>` : ''}</section>`;
}

// ---- the reviewer view ------------------------------------------------------------------------------------------------------------------
let running = '';
const reviewsOf = target => (get().qualityReviews || []).filter(r => r.target === target).sort((a, b) => String(b.at).localeCompare(String(a.at)));
/** The latest review: its date and model, its scores beside the last one's, its major and minor issues. */
function reviewHtml(id, r, before) {
  const day = String(r.at).slice(0, 10), dims = ['complete', 'consistent', 'methods', 'clarity'];
  const scores = dims.filter(d => r.scores?.[d]).map(d => detailView.paneRow({ label: `<span class="sf-check">${esc(TILE[d])}</span>`, sub: r.scores[d].reason ? [esc(r.scores[d].reason)] : [],
    value: `<span class="sf-score">${bars(r.scores[d].score)}<span class="sf-num">${r.scores[d].score} of 3${before?.scores?.[d] ? `, was ${before.scores[d].score}` : ''}</span></span>` }));
  const issue = (x, kind) => detailView.paneRow({ label: `<span class="sf-check">${esc(x.text)}</span>`, sub: x.where ? [esc(x.where)] : [], value: detailView.stateHtml(kind === 'Major' ? 'missing' : 'warn', kind) });
  return detailView.paneSection(`sf-rev-${id}`, 'Reviewer view', `<span class="meta"><time datetime="${esc(day)}">${esc(day)}</time></span>`,
    [...scores, ...(r.major || []).map(x => issue(x, 'Major')), ...(r.minor || []).map(x => issue(x, 'Minor'))], '<p class="meta">No issues raised</p>');
}
/** The item or the paper as the reviewer reads it: the outline and captions, or the item's caption, notes and rows. */
async function reviewBody(target) {
  const s = get(), pkg = s.package || { parts: [], items: {} }, L = labels(pkg);
  const strip = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
  if (target === 'paper' || target === 'main-text') {
    const outline = (s.manuscript?.blocks || []).map(b => (/^h[1-3]$/.test(b.type) ? `# ${strip(b.text)}` : b.type === 'p' && strip(b.text) ? strip(b.text).slice(0, 400) : '')).filter(Boolean).join('\n').slice(0, 24000);
    const items = Object.keys(pkg.items).map(id => `${L.get(id)}: ${strip(pkg.items[id].title)}${(pkg.items[id].notes || []).length ? ` (notes: ${strip(pkg.items[id].notes.join(' ')).slice(0, 300)})` : ''}`).join('\n');
    return { label: target === 'paper' ? 'The whole paper' : 'The main text', body: `${outline}\n\nTables and figures:\n${items}` };
  }
  const it = pkg.items[target], f = facts.get(target) || {};
  const rows = f.grid ? f.grid.rows.slice(0, 40).map(r => r.cells.map(c => (c?.merged ? '' : strip(c?.text))).join(' | ')).join('\n') : f.svg ? svgText(f.svg).slice(0, 4000) : f.printed?.lines ? f.printed.lines.map(l => l.join(' | ')).join('\n').slice(0, 4000) : '(a picture file)';
  return { label: `${L.get(target)}: ${strip(it?.title)}`, body: `Legend: ${strip(it?.legend) || 'none'}\nNotes:\n${(it?.notes || []).map(strip).join('\n') || 'none'}\nContent:\n${rows}` };
}
/** Review with the assistant: one request to the configured review model, kept as a dated review; never part of the scores. */
async function review(target) {
  if (running) return;
  const { modelFor } = await import('../lib/model-settings.mjs');
  const cfg = modelFor('review');
  if (!cfg?.model) { shown?.ctx.say?.('No model for reviews: choose one in Settings'); return; }
  const fq = await import('../lib/file-quality.mjs'), { REVIEW_QUALITY } = await import('../lib/prompts-views.mjs');
  const q = target === 'paper' ? quality.value?.paper : quality.value?.rows.get(target);
  running = target; redraw();
  try {
    const { label, body } = await reviewBody(target);
    const { complete } = await import('../lib/ai.mjs');
    const text = await complete(cfg, fq.reviewMessages(REVIEW_QUALITY, { label, body, quality: q }), { temperature: 0, json: true, prompt: REVIEW_QUALITY, maxTokens: REVIEW_QUALITY.maxTokens });
    const got = fq.parseReview(text);
    if (got.error) { shown?.ctx.say?.(got.error); return; }
    const entry = { id: `qr${Date.now().toString(36)}`, target, at: new Date().toISOString(), model: cfg.model, ...got };
    update(st => { st.qualityReviews = fq.normaliseReviews([entry, ...(st.qualityReviews || [])]); return st; });
  } catch (err) { shown?.ctx.say?.(`Review failed: ${err?.message || err}`); }
  finally { running = ''; redraw(); }
}

/** Draws Files into `el`; `extra`: the folder's documents and the current submission (views/submissions.mjs). */
export async function render(el, ctx, extra = {}) {
  const decl = await import('../lib/declarations.mjs');
  detailView ||= await import('./item-detail.mjs');
  const s = get();
  const statements = (() => { try { return decl.statements(s.declarations, s.paper?.authors || []); } catch { return {}; } })();
  extra = { ...extra, statements };
  shown = { el, ctx, extra };
  const groups = filesOf(s, extra);
  if (page && !pageExists(groups)) page = null;   // the item left the package, or its dimension is not scored
  if (page) {
    el.innerHTML = pageHtml(groups);
    wire(el, ctx);
    el.onkeydown = e => { if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('dialog')) { e.preventDefault(); back(); } };
    if (fresh) { fresh = false; const sc = scrollerOf(el); if (sc) sc.scrollTop = 0; el.querySelector('.sf-detail')?.focus({ preventScroll: true }); }
  } else {
    el.onkeydown = null;
    el.innerHTML = `<section class="sb-page sf-page" aria-label="Submission files">${paperHtml()}${followListNotice(groups)}${filesTable(groups)}</section>`;
    wire(el, ctx);
    place(el);
  }
  count();
  assess();
  follow();
}

// ---- an item read from a document follows it (lib/package-follow.mjs): texts never edited here at once, an edited one asks -----------------
let F = null;   // lib/package-follow-run.mjs, loaded on the first pass (it reads Word documents: not part of the start)
function follow() {
  const folder = folderFor || activeFolder();
  if (!folder || !get().package?.parts?.length) return;
  import('../lib/package-follow-run.mjs').then(m => { const first = !F; F = m;
    F.syncFollow(folder, { onDone: changed => redraw(changed.length ? `Updated from the file: ${changed.join(', ')}` : undefined) }); if (first && F.followAsks().size) redraw(); });
}
/** On the list: the items edited here whose file changed, one press to the first of them. */
function followListNotice(groups) {
  if (!F) return '';
  const asks = F.followAsks(), rows = rowsOf(groups).filter(r => r.itemId && asks.has(r.itemId));
  if (!rows.length) return '';
  const names = rows.map(r => r.label || r.name);
  const text = `${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}` : names.join(' and ')} ${names.length > 1 ? 'were' : 'was'} edited here and ${names.length > 1 ? 'their files' : 'its file'} changed`;
  return uiNotice({ id: 'sf-follow-list', label: 'Files changed', text, actions: [{ id: 'sf-follow-open', label: 'Open', attrs: { 'data-sf-page': rows[0].id } }] });
}
/** On an item's page: what its file now says where it was edited here, Use the file's or Keep mine; Undo after Use. */
function followItemNotice(itemId) {
  if (!F) return '';
  const u = F.followUndo();
  if (u?.id === itemId) return uiNotice({ id: 'sf-follow', label: 'File changed', text: u.text, actions: [{ id: 'sf-follow-undo', label: 'Undo', icon: 'undo' }] });
  const ch = F.followAsks().get(itemId);
  if (!ch) return '';
  return uiNotice({ id: 'sf-follow', label: 'File changed', text: F.followText(ch),
    actions: [{ id: 'sf-follow-use', label: 'Use the file\'s', attrs: { 'data-sf-follow': itemId } }, { id: 'sf-follow-keep', label: 'Keep mine', attrs: { 'data-sf-follow': itemId } }] });
}

// ---- pages: a file or a dimension on a page of its own, Back to the list where it was ---------------------------------------------------------
/** The element that scrolls the page: the view, the fixture's document, whichever holds `el`. */
function scrollerOf(el) {
  if (typeof getComputedStyle !== 'function') return null;   // the Node render smoke has no layout
  for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return document.scrollingElement;
}
/** Opens a page, keeping the list's place and the control that opened it for Back. */
function openPage(p, from) {
  const el = shown?.el;
  if (!el) return;
  const focus = from?.matches?.('[data-sf-page]') ? `[data-sf-page="${CSS.escape(from.dataset.sfPage)}"]${from.classList.contains('sf-score') ? '.sf-score' : '.sf-open'}`
    : from?.dataset?.sfDim ? `[data-sf-dim="${CSS.escape(from.dataset.sfDim)}"]` : '';
  // the list's place is the pressed control's place on screen: Back puts it there again, whatever was drawn above it meanwhile
  listPlace = { top: scrollerOf(el)?.scrollTop || 0, focus, at: from?.getBoundingClientRect?.().top ?? null };
  page = p; fresh = true;
  redraw();
}
function back() { if (!page) return; page = null; redraw(); }
/** After the list is drawn: its place before a page opened (Back), or a row kept where it was across a reorder. */
let listPage = 1;   // the Files table's page
let held = null;   // { sel, top, sc, until }: a place just put back, kept across the draws that follow at once (the shell's, the scores') unless the person scrolls
function place(el) {
  const sc = scrollerOf(el);
  const pin = (sel, top) => {
    const n = sel && el.querySelector(sel); if (!n || !sc) return false;
    sc.scrollTop += n.getBoundingClientRect().top - top;
    // the draws that follow at once (the shell's, the scores') keep it there too, until the person scrolls or the moment passes
    if (held?.sc !== sc) { const drop = () => { held = null; }; for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) sc.addEventListener(ev, drop, { once: true, passive: true }); }
    held = { sel, top, sc, until: Date.now() + 1500 };
    return true;
  };
  if (listPlace) {
    const { top, focus, at } = listPlace; listPlace = null;
    if (!(at != null && pin(focus, at)) && sc) sc.scrollTop = top;
    if (focus) el.querySelector(focus)?.focus({ preventScroll: true });
  } else if (anchor) {
    const { sel, top, focus } = anchor; anchor = null;
    pin(sel, top);
    if (focus) el.querySelector(focus)?.focus({ preventScroll: true });
  } else if (held && Date.now() < held.until && held.sc === sc) pin(held.sel, held.top);
  else held = null;
}
/** Keeps the row of `id` where it is on screen across the next draw, its More focused. */
function keepRow(id) {
  const row = shown?.el?.querySelector(`[data-sf-row="${CSS.escape(id)}"]`);
  if (row) anchor = { sel: `[data-sf-row="${CSS.escape(id)}"]`, top: row.getBoundingClientRect().top, focus: `[data-sf-more="${CSS.escape(id)}"]` };
}
const rowsOf = groups => groups.flatMap(g => g.rows);
function pageExists(groups) { return page.kind === 'item' ? rowsOf(groups).some(r => r.id === page.id) : !!quality.value?.paper?.dims.some(d => d.id === page.id); }
/** The page's title bar: Back to Files, the file's name or the dimension's, Previous and Next through the files in list order, the file's own commands. */
function pageHead() {
  const backTo = { label: 'Back to Files', run: () => back() };
  if (page.kind === 'dim') { const d = quality.value?.paper?.dims.find(x => x.id === page.id); return { title: d?.label || 'Quality', back: backTo, actions: [], overflow: [] }; }
  const rows = rowsOf(filesOf(get(), shown?.extra)), i = rows.findIndex(r => r.id === page.id), r = rows[i];
  const step = d => () => { const n = rows[i + d]; if (n) { page = { kind: 'item', id: n.id }; fresh = true; redraw(); } };
  return { title: r?.name || 'File', back: backTo,
    actions: [{ id: 'sf-prev', label: 'Previous file', icon: 'chevron-up', disabled: i <= 0, run: step(-1) }, { id: 'sf-next', label: 'Next file', icon: 'chevron-down', disabled: i < 0 || i >= rows.length - 1, run: step(1) }],
    overflow: r ? rowMenu(r.id, shown?.ctx || {}).map((x, k) => (x === '-' ? '-' : { id: `sf-page-act-${k}`, label: x.label, disabled: !!x.disabled, run: x.run })) : [] };
}
/** A file's page: for a table or figure the detail Tables and figures shares (views/item-detail.mjs), its quality under its facts; else its quality. */
function pageHtml(groups) {
  const q = quality.value;
  if (page.kind === 'dim') {
    const d = q?.paper?.dims.find(x => x.id === page.id);
    return `<section class="sb-page sf-detail" tabindex="-1" aria-label="${esc(d?.label || 'Quality')}"><div class="idt ui-flush"><div class="idt-cols sf-dim-page">${d ? dimSection('paper', d) : ''}</div></div></section>`;
  }
  const r = rowsOf(groups).find(x => x.id === page.id), rq = q?.rows.get(r.id);
  if (r.itemId) {
    if (!details.has(r.itemId)) loadDetail(r.itemId);
    return `<section class="sb-page sf-detail" tabindex="-1" aria-label="${esc(r.name)}">${followItemNotice(r.itemId)}${detailView.paneHtml(r.itemId, withStudies(details.get(r.itemId), r.itemId), `${rq ? qualityHtml(r.id, rq, r.label || r.name) : ''}${itemComments(r.itemId).html}`)}</section>`;
  }
  const why = r.state === 'other' ? detailView.paneSection(`sf-why-${r.id}`, 'Not the review\'s manuscript', '',
    [detailView.paneRow({ label: `<span>${esc(String(r.reason || '').replace(/^./, c => c.toUpperCase()))}</span>` })], '', { action: { id: `sf-why-open-${r.id}`, label: 'Open manuscript', attrs: { 'data-sf-go': 'manuscript' } } }) : '';
  return `<section class="sb-page sf-detail" tabindex="-1" aria-label="${esc(r.name)}"><div class="idt ui-flush"><div class="idt-cols">${why}${rq ? qualityHtml(r.id, rq, r.label || r.name) : '<p class="meta">Scoring</p>'}</div></div></section>`;
}
// Comments on a table or figure (views/comments-pane.mjs), the last section of its details.
function itemComments(itemId) {
  const c = commentsSection({ kind: 'item', id: itemId }, { rerender: () => redraw() }, { id: 'cmi' });
  return { html: `<section class="idt-sec" data-item-comments="${esc(itemId)}" aria-label="Comments"><div class="idt-line idt-top"><div class="idt-lab"><h3 class="idt-title">Comments</h3></div><div class="idt-val">${esc(c.meta)}</div></div>${c.html}</section>`, wire: c.wire };
}
function redraw(msg) { if (shown?.el?.isConnected) shown.ctx.rerender(msg); }

function wire(el, ctx) {
  el.querySelectorAll('[data-sf-refs]').forEach(b => b.onclick = () => listRefs(b.dataset.sfRefs));
  const undoBtn = el.querySelector('#sf-undo'); if (undoBtn) undoBtn.onclick = () => undoLast();
  el.querySelectorAll('[data-sf-more]').forEach(b => b.onclick = () => showMenu(b, rowMenu(b.dataset.sfMore, ctx), { align: 'end' }));
  el.querySelectorAll('.sf-tiles').forEach(x => fitSplit(x, 520));
  el.querySelectorAll('[data-sf-page]').forEach(b => b.onclick = () => openPage({ kind: 'item', id: b.dataset.sfPage }, b));
  // the whole row is the way in, as its hover shows: a press anywhere on it but its own controls opens the file (owner, 2026-10-24: "where is
  // the clickable region", when only the name did)
  el.querySelectorAll('[data-sf-row]').forEach(r => r.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, label, [role="button"]')) return;
    const b = r.querySelector('.sf-open'); if (b) openPage({ kind: 'item', id: b.dataset.sfPage }, b);
  }));
  el.querySelectorAll('[data-sf-dim]').forEach(b => b.onclick = () => openPage({ kind: 'dim', id: b.dataset.sfDim }, b));
  el.querySelectorAll('[data-sf-go]').forEach(b => b.onclick = () => ctx.go?.(b.dataset.sfGo));
  el.querySelectorAll('[data-sf-review]').forEach(b => b.onclick = () => review(b.dataset.sfReview));
  const settle = (b, how) => { if (F?.settleFollow(b.dataset.sfFollow, how)) redraw(how.use ? undefined : 'Kept your text'); };
  el.querySelector('#sf-follow-use')?.addEventListener('click', e => settle(e.currentTarget, { use: true }));
  el.querySelector('#sf-follow-keep')?.addEventListener('click', e => settle(e.currentTarget, { keep: true }));
  el.querySelector('#sf-follow-undo')?.addEventListener('click', () => { if (F?.undoFollow()) { redraw(); follow(); } });
  el.querySelectorAll('[data-item-comments]').forEach(node => itemComments(node.dataset.itemComments).wire(node));
  detailView?.wirePane(el, ctx, { grids: new Map([...facts].filter(([, f]) => f.grid).map(([id, f]) => [id, f.grid])), printed: new Map([...facts].filter(([, f]) => f.printed).map(([id, f]) => [id, f.printed])),
    folder: folderFor || activeFolder(), onChange: () => redraw() });
  wirePager(el, 'sf-list-pages', n => { listPage = n; redraw(); });
  // drag within a group: the row dropped on takes the dragged row's place
  let dragged = null;
  el.querySelectorAll('[data-sf-row][draggable="true"]').forEach(r => {
    r.ondragstart = e => { dragged = r.dataset.sfRow; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.querySelector('.sf-open')?.textContent || ''); };
    r.ondragend = () => { dragged = null; el.querySelectorAll('[data-sf-drop]').forEach(x => delete x.dataset.sfDrop); };
    r.ondragover = e => { if (!dragged || dragged === r.dataset.sfRow || el.querySelector(`[data-sf-row="${CSS.escape(dragged)}"]`)?.dataset.sfGroup !== r.dataset.sfGroup) return; e.preventDefault(); r.dataset.sfDrop = ''; };
    r.ondragleave = () => delete r.dataset.sfDrop;
    r.ondrop = e => { e.preventDefault(); delete r.dataset.sfDrop; const id = dragged; dragged = null; if (id) moveTo(id, r.dataset.sfRow); };
  });
}

// ---- the works a file cites --------------------------------------------------------------------------------------------------------------
/**
 * What each table and figure cites in its cells or drawing, read once per change of its source: a table's rows (the folder's copy, the
 * evidence table, a drawing of the app), a drawing's text. Kept on the item as `cites` (lib/package-cites.mjs), written only when it changed.
 */
async function count() {
  const s = get(), pkg = s.package;
  if (!pkg?.parts?.length || counted.running) return;
  // a printed figure's files by size and time (lib/package-follow.mjs printedStamps): a figure whose file changed is read again, its Screen
  // view following the file
  const stamps = await (await import('../lib/package-follow.mjs')).printedStamps(folderFor || activeFolder(), pkg).catch(() => '');
  const key = `${projectGeneration()}|${(s.papers || []).length}|${JSON.stringify(Object.values(pkg.items).map(it => [it.id, it.source, it.keep]))}|${stamps}`;
  if (counted.key === key || counted.running) return;
  counted = { key, running: true };
  try {
    const [{ loadSources }, app] = await Promise.all([import('../lib/package-sources.mjs'), import('../lib/app-items.mjs')]);
    const idx = libraryIndex(s.papers || [], { prefer: new Set(textCites(s)), studies: reviewStudies(s) }), found = new Map(), folder = folderFor || activeFolder();
    if (facts.gen !== projectGeneration()) { facts.clear(); details.clear(); facts.gen = projectGeneration(); }
    // whether each part's file is in the folder: a part the app never built is In the folder, not Missing, when its file is there
    if (folder) for (const part of pkg.parts) if (part.file && !partFiles.has(part.file)) { try { const st = await folder.stat(part.file); partFiles.set(part.file, !!st?.exists); } catch { partFiles.set(part.file, false); } }
    const asGridOf = rows => ({ rows: rows.map((r, i) => ({ ...(i === 0 ? { header: true } : {}), cells: r.map(t => ({ text: String(t ?? '') })) })) });
    for (const it of Object.values(pkg.items)) {
      let texts = null;
      const f = {};
      if (gridFor && it.kind === 'table') { f.grid = asGrid(gridFor(it)); texts = f.grid ? gridTexts(f.grid) : null; }
      else if (it.source?.app) {
        const d = app.drawApp(s, it.source.app, { item: it });
        if (d.svg) { f.svg = d.svg; texts = svgTexts(d.svg); }
        // a risk-of-bias summary draws its studies as bars: they are the studies appraised with its instrument, kept to the item's own scope
        if (/^rob-(summary|traffic):/.test(it.source.app)) { const set = app.robSets(s, { item: it }).find(x => x.tool.id === it.source.app.split(':')[1]); if (set) texts = set.done.map(x => ({ t: x.label, label: true })); }
        else if (d.rows) { f.grid = asGridOf(d.rows); texts = gridTexts(f.grid); }
      } else if (it.kind === 'table') {
        const got = (await loadSources(folder, [{ ...it, marks: undefined }], { state: s })).get(it.id);
        if (got?.grid) { f.grid = got.grid; texts = gridTexts(got.grid); }
      } else if (it.kind === 'figure' && folder && (it.source?.path || it.source?.held)) {
        // a picture file: its pixels, for the figure style's resolution (lib/file-quality.mjs, rule Y5)
        try { const { readPngMeta } = await import('../lib/png-meta.mjs'), bytes = await folder.read(it.source.held ? `.lykos/package/${it.source.held}` : it.source.path); const m = readPngMeta(bytes); if (m?.width) f.png = { width: m.width, dpi: m.dpi }; } catch { /* not a PNG, or not there */ }
      }
      // a picture in the folder: what it prints, read back and set against the app's data (lib/printed-data.mjs); the printed file is the truth
      if (printedFor && printedFor(it)) f.printed = printedFor(it);
      else if (it.kind === 'figure' && folder && printedPath(it.source)) {
        try { f.printed = await (await import('../lib/printed-data.mjs')).printedFacts(s, it, folder); } catch (err) { console.warn('[submission files] printed', err?.message || err); }
      }
      // the studies it includes, from its own rows and marks: the printed file's where it names studies (the printed file is the truth), else
      // the app's drawing or the table's cells; each label matched to one record, else reported (lib/package-cites.mjs itemStudies)
      const printedStudies = f.printed?.lines?.length ? itemStudies(lineTexts(f.printed.lines), idx) : [];
      if (printedStudies.some(x => !x.token) && !/^rob-/.test(it.source?.app || '')) f.studies = printedStudies;
      else if (texts) f.studies = itemStudies(texts, idx);
      if (f.studies) f.unresolved = unsettled(f.studies);
      facts.set(it.id, f);
      if (f.studies) found.set(it.id, studyKeys(f.studies));
    }
    if (projectGeneration() !== Number(key.split('|')[0])) return;
    details.clear();   // a detail read before its sources were (its grid, its printed facts) is read again with them
    const now = get().package, changed = [...found].filter(([id, k]) => now?.items[id] && JSON.stringify(now.items[id].cites || null) !== JSON.stringify(k));
    if (changed.length) update(st => { for (const [id, k] of changed) if (st.package?.items[id]) st.package.items[id].cites = k; return st; });
    redraw();   // the counts, and the facts the scores read
  } catch (err) { console.warn('[submission files]', err?.message || err); }
  finally { counted.running = false; }
}

/** The works a file cites, in the reference list's order, each opening its record. */
async function listRefs(id) {
  const s = get(), row = filesOf(s, shown?.extra).flatMap(g => g.rows).find(r => r.id === id);
  if (!row?.refs?.length) return;
  const order = referenceOrder(s), byKey = new Map((s.papers || []).map(p => [p.key || p.id, p]));
  const numberOf = k => (row.group === 'supplementary' && order.supplement ? (order.supplement.get(k) != null ? `S${order.supplement.get(k)}` : '') : order.main.get(k) ?? '');
  const items = row.refs.map(k => { const p = byKey.get(k), n = numberOf(k); return { value: k, title: `${n ? `${n}. ` : ''}${p ? `${authorLine(p.authors) || 'No authors'} ${p.year || ''}`.trim() : k}`, detail: p?.title || 'Not in the library' }; });
  const value = await pickerDialog({ id: 'sf-refs', title: `${row.label || row.name}: ${plural(row.refs.length, 'reference')}`, search: 'Search references', onMount: (d, close) => {
    // paged with the app's pager under the list, out of its scroll (as the record picker's)
    const q = d.querySelector('[type=search]'), host = d.querySelector('.ask-picker-list'), pages = document.createElement('div'); host.after(pages);
    let at = 1;
    const draw = () => { const t = q.value.trim().toLowerCase(), list = items.filter(x => !t || `${x.title} ${x.detail}`.toLowerCase().includes(t)), shown = pageOf(list, at); at = shown.page;
      host.innerHTML = pickerRows(shown.items, { id: 'sf-ref-list', label: 'References', empty: '<p class="meta">No reference matches</p>' });
      pages.innerHTML = pager({ id: 'sf-ref-pages', page: shown.page, pages: shown.pages, total: list.length, label: 'references' });
      host.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => close(b.dataset.pick));
      wirePager(pages, 'sf-ref-pages', n => { at = n; draw(); host.scrollTop = 0; }); };
    q.oninput = () => { at = 1; draw(); }; draw();
  } });
  if (value && byKey.has(value)) { const { focusPaper } = await import('./library.mjs'); focusPaper(value); shown?.ctx.go('library'); }
}

// ---- reordering ----------------------------------------------------------------------------------------------------------------------------
function rowMenu(id, ctx) {
  const s = get(), pkg = s.package;
  if (!pkg?.items?.[id]) return [{ label: 'Details', run: () => openPage({ kind: 'item', id }, document.querySelector(`[data-sf-page="${CSS.escape(id)}"]`)) }, { label: id === 'main-text' || id === 'title-page' || id === 'blinded' ? 'Open manuscript' : 'Open declarations', run: () => ctx.go('manuscript') }];
  const g = groupOf(pkg, id), ids = packageGroups(pkg)[g] || [], i = ids.indexOf(id), it = pkg.items[id], part = pkg.parts.find(p => p.items.includes(id));
  const swap = d => { const order = [...ids]; [order[i], order[i + d]] = [order[i + d], order[i]]; return order; };
  const supp = g === 'supplementary', hasSupp = pkg.parts.some(p => p.prefix);
  return [
    { label: 'Move up', disabled: i <= 0, run: () => reorder({ id, order: swap(-1) }) },
    { label: 'Move down', disabled: i < 0 || i >= ids.length - 1, run: () => reorder({ id, order: swap(1) }) },
    supp ? { label: 'Move to main text', run: () => reorder({ id, to: 'main' }) } : { label: 'Move to supplementary', disabled: !hasSupp, run: () => reorder({ id, to: 'supplementary' }) },
    '-',
    ...(page ? [] : [{ label: 'Details', run: () => openPage({ kind: 'item', id }, document.querySelector(`[data-sf-page="${CSS.escape(id)}"]`)) }]),
    { label: it.kind === 'table' ? 'Caption and footnotes…' : 'Caption…', run: () => footnotesDialog(id) },
    ...(part?.file ? [{ label: 'Open file', run: async () => { const f = await import('./files.mjs'); f.show(part.file); ctx.go?.('files'); } }] : []),
    { label: 'Open in Tables and figures', run: () => openPackage() },
    ...buildItems(it, part),
  ];
}
// ---- building in the app a part that is in the folder (lib/build-in-app.mjs): beside the person's file, never over it ------------------------
/** The row's source choice, where the printed picture and the app's drawing may differ, and the part's build, offered when it may be built. */
function buildItems(it, part) {
  if (!part) return [];
  const a = agreement(it, facts.get(it.id)?.printed), gate = buildGate(get().package, part.id, id => facts.get(id)?.printed);
  const inFolder = (folderFor || activeFolder()) && gate.items.some(x => x.why);   // a part with something printed to agree with
  const use = v => update(s => { const x = s.package?.items?.[it.id]; if (x) { if (x.use === v) delete x.use; else x.use = v; } return s; });
  return [
    ...(a.choose ? ['-', { label: 'Use the printed picture', checked: it.use === 'printed', checkType: 'checkbox', run: () => use('printed') },
      { label: "Use the app's data", checked: it.use === 'app', checkType: 'checkbox', run: () => use('app') }] : []),
    ...(inFolder ? ['-', { label: `Build ${String(part.file || part.name).split('/').pop()} in the app…`, disabled: !gate.ok, meta: gate.ok ? '' : `${gate.blocked.length} to settle`, run: () => buildInApp(part.id) }] : []),
  ];
}
/**
 * One confirm names the files the build writes and the person's file it keeps; the build is a new version beside it (lib/package-write.mjs
 * buildPart, keep), from the app's data where it agrees with the printed version and from the source the person chose where they differ.
 */
async function buildInApp(partId) {
  const say = m => shown?.ctx?.say?.(m), s = get(), pkg = s.package, part = pkg?.parts.find(p => p.id === partId), folder = folderFor || activeFolder();
  if (!part || !folder) { say('No project folder'); return; }
  const gate = buildGate(pkg, partId, id => facts.get(id)?.printed);
  if (!gate.ok) { say(`Not built: ${gate.blocked.length} ${gate.blocked.length === 1 ? 'item differs' : 'items differ'} from the printed version`); return; }
  const { planBuild, buildPart } = await import('../lib/package-write.mjs'), name = p => String(p).split('/').pop();
  const plan = await planBuild(folder, pkg, partId);
  const ok = await confirmAsk(`Build ${part.name} in the app?`, { confirm: 'Build',
    detail: `Writes ${plan.files.map(name).join(', ')}.${plan.kept.length ? ` ${plan.kept.map(name).join(', ')} ${plan.kept.length === 1 ? 'is' : 'are'} kept as ${plan.kept.length === 1 ? 'it is' : 'they are'}.` : ''}` });
  if (!ok) return;
  const work = withChoices(pkg), [app, w] = await Promise.all([import('../lib/app-items.mjs'), folderFor ? null : import('../lib/vcs-watch.mjs')]);
  let res;
  try { res = await buildPart(folder, work, partId, { keep: true, note: 'Built in the app from Submission › Files', state: s, app: app.appLoader(s), repo: w ? w.repoOf(folder) : null }); }
  catch (err) { say(`Not built: ${err.message}`); return; }
  if (res.status === 'built' || res.status === 'unchanged') update(st => {
    st.package.builds = { ...(st.package.builds || {}), [partId]: work.builds[partId] };
    const p = st.package.parts.find(x => x.id === partId); if (p) p.file = work.parts.find(x => x.id === partId).file;
    return st;
  });
  partFiles.clear(); counted = { key: '', running: false };
  say(res.status === 'blocked' ? `Cannot build: ${res.problems.map(p => p.text).join('; ')}` : res.status === 'unchanged' ? `No change since v${res.version}` : `Built ${res.files.map(f => name(f.path)).join(', ')}; ${plan.kept.map(name).join(', ') || 'nothing'} kept`);
  redraw();
}
function moveTo(id, onto) {
  const pkg = get().package, g = groupOf(pkg, id);
  if (!g || g !== groupOf(pkg, onto)) return;
  const ids = packageGroups(pkg)[g].filter(x => x !== id), at = packageGroups(pkg)[g].indexOf(onto);
  ids.splice(at, 0, id);
  reorder({ id, order: ids });
}

const changeLine = list => list.map(c => `${c.from ?? 'new'} → ${c.to ?? 'out'}`);
const clip = (t, at, n = 70) => { const a = Math.max(0, at - 30); return `${a ? '…' : ''}${t.slice(a, a + n)}${a + n < t.length ? '…' : ''}`; };
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
/** The plan as the dialog shows it: one table of what changes. */
function planRows(plan, L) {
  const rows = [['Numbers', plan.labels.length ? plan.labels.map(l => `${l.from} becomes ${l.to}`).join('; ') : 'No number changes']];
  const paras = plan.mentions.filter(m => !m.table);
  rows.push(['Manuscript', plan.mentions.length ? `${plural(plan.mentions.reduce((n, m) => n + m.n, 0), 'mention')} in ${plural(plan.mentions.length, 'paragraph')}` : 'No mentions to change']);
  for (const m of paras.slice(0, 4)) { const strip = t => t.replace(/\[@[^\]]*\]/g, ''); const a = strip(m.after), at = firstDiff(strip(m.before), a); rows.push(['', clip(a, at)]); }
  if (paras.length > 4) rows.push(['', `and ${plural(paras.length - 4, 'more paragraph')}`]);
  const refs = changeLine(plan.refs);
  rows.push(['References', refs.length ? `${plural(refs.length, 'number')} change: ${refs.slice(0, 10).join(', ')}${refs.length > 10 ? ` and ${refs.length - 10} more` : ''}` : 'No number changes']);
  if (plan.supplementRefs.length) rows.push(['Supplementary references', changeLine(plan.supplementRefs).slice(0, 10).join(', ')]);
  return `<table class="ask-table sf-plan"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}
async function reorder(op) {
  const s = get(), plan = reorderPlan(s, op);
  if (plan.error) { shown?.ctx.say?.(plan.error); return; }
  if (!plan.labels.length && !plan.mentions.length && !plan.refs.length) return;
  const L = labels(s.package), title = op.to ? (op.to === 'supplementary' ? `Move ${L.get(op.id)} to supplementary` : `Move ${L.get(op.id)} to main text`) : `Reorder ${groupOf(s.package, op.id)}`;
  const ok = await planDialog({ id: 'sf-reorder', title, body: planRows(plan, L), confirm: op.to ? 'Move' : 'Reorder' });
  if (!ok) return;
  const gen = projectGeneration();
  let data = null;
  if (!page) keepRow(op.id);   // the moved row stays where it is on screen; the list moves under it
  update(st => {
    if (gen !== projectGeneration()) return st;
    data = undoOf(st, plan);
    st.package = plan.package;
    if (plan.mentions.length && st.manuscript) st.manuscript.blocks = plan.blocks;
    return st;
  });
  const said = plan.labels.length ? `${plan.labels[0].from} is now ${plan.labels[0].to}${plan.labels.length > 1 ? `, ${plural(plan.labels.length - 1, 'other label')} changed` : ''}` : 'Order changed';
  undo = { gen, data, said, id: op.id };
  redraw(said);
}
function undoLast() {
  const u = undoNow();
  if (!u) return;
  if (!page && u.id) keepRow(u.id);
  update(st => { applyUndo(st, u.data); return st; });
  undo = null;
  redraw('Order restored');
}
async function openPackage() { const o = await import('./outputs.mjs'); o.selectShow('package'); shown?.ctx.go('outputs'); }

// ---- conventions ---------------------------------------------------------------------------------------------------------------------------
async function conventionsDialog() {
  const cv = conventionsOf(get().package);
  const select = (k, label) => formField(label, `<select id="sf-cv-${k}" data-cv="${k}">${CONVENTIONS[k].map(([v, l]) => `<option value="${v}"${cv[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  const got = await formDialog({ id: 'sf-conventions', title: 'Conventions', tier: 'M', confirm: 'Save',
    body: `<div class="an-settings">${select('tables', 'Table and figure references')}${select('supplement', 'Supplementary references')}${select('marks', 'Footnote marks')}</div>`,
    submit: (form, d) => Object.fromEntries([...d.querySelectorAll('[data-cv]')].map(x => [x.dataset.cv, x.value])) });
  if (!got) return;
  // a convention that renumbers the text's references is shown first, as a reorder is
  const s = get(), was = referenceOrder(s), next = referenceOrder({ ...s, package: { ...s.package, conventions: { ...(s.package?.conventions || {}), ...got } } });
  const main = numberChanges(was.main, next.main), supp = was.supplement || next.supplement ? numberChanges(was.supplement || new Map(), next.supplement || new Map()) : [];
  if (main.length || supp.length) {
    const line = list => `${plural(list.length, 'number')} change: ${changeLine(list).slice(0, 10).join(', ')}${list.length > 10 ? ` and ${list.length - 10} more` : ''}`;
    const rows = [['References', main.length ? line(main) : 'No number changes'], ...(supp.length ? [['Supplementary references', line(supp)]] : [])];
    const ok = await planDialog({ id: 'sf-conventions-plan', title: 'Renumber the references', body: `<table class="ask-table sf-plan"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`, confirm: 'Renumber' });
    if (!ok) return;
  }
  update(st => {
    if (!st.package) return st;
    const before = conventionsOf(st.package).marks;
    st.package.conventions = { ...(st.package.conventions || {}), ...got };
    if (got.marks !== before) for (const it of Object.values(st.package.items)) if (it.marks?.length) Object.assign(it, remark(it, got.marks));
    return st;
  });
  redraw('Conventions saved');
}

// ---- caption and footnotes -----------------------------------------------------------------------------------------------------------------
const GRID_ROWS = 60;
let gridFor = null;   // the browser test's drawing of a table (a fixture has no folder to read)
export const __setGridForTest = fn => { gridFor = fn; counted = { key: "", running: false }; };
let printedFor = null;   // a fixture's printed facts for an item (lib/printed-data.mjs printedFacts), where it has no printed file to read
export const __setPrintedForTest = fn => { printedFor = fn; counted = { key: '', running: false }; facts.clear(); };
let folderFor = null;   // a headless run's folder (read, stat, list over a copy): the seeded browser mounts none
export const __setFolderForTest = f => { folderFor = f; counted = { key: '', running: false }; facts.clear(); };
const asGrid = d => (d?.rows ? { rows: d.rows.map((r, i) => ({ ...(i === 0 ? { header: true } : {}), cells: r.map(t => ({ text: String(t ?? '') })) })) } : null);
async function gridOf(it) {
  const s = get();
  if (gridFor) return asGrid(gridFor(it));
  if (it.source?.app) { const app = await import('../lib/app-items.mjs'); return asGrid(app.drawApp(s, it.source.app, { item: it })); }
  const { loadSources } = await import('../lib/package-sources.mjs');
  return (await loadSources(activeFolder(), [{ ...it, marks: undefined }], { state: s })).get(it.id)?.grid || null;
}
/** Title and legend; for a table its abbreviations, notes and marked notes, a mark set on cells by pressing them in the preview. */
async function footnotesDialog(id) {
  const s = get(), it = s.package?.items?.[id];
  if (!it) return;
  const L = labels(s.package), table = it.kind === 'table', cv = conventionsOf(s.package);
  const grid = table ? await gridOf(it).catch(() => null) : null;
  const edit = readNotes(it.notes || [], it.marks || []);
  let active = edit.marked.length ? 0 : -1;
  // the grid shows every note's mark, one still without text too, in the order the marks will run
  const composed = () => ({ marks: markOrder(edit.marked, { grid, all: true }).map((m, k) => ({ mark: markOf(k, cv.marks), cells: m.cells })) });
  const markOfNote = i => markOf(markOrder(edit.marked, { grid, all: true }).findIndex(x => x.i === i), cv.marks);
  const cellWords = cells => (cells.length ? cells.map(c => `${c.row || 'Header'}, ${c.col}`).join('; ') : 'On no cell');
  const markedHtml = () => uiList({ id: 'sf-fn-list', label: 'Marked notes', cols: ['text'], rows: edit.marked.map((m, i) => uiRow({ attrs: { 'data-fn': String(i) },
    main: { html: `<button type="button" class="sf-fn-pick" data-fn-pick="${i}" aria-pressed="${i === active}" title="Mark cells for this note">${esc(markOfNote(i))}</button>`, detail: [esc(cellWords(m.cells))] },
    cells: [{ col: 'text', kind: 'control', html: `<input type="text" data-fn-text="${i}" value="${esc(m.text)}" aria-label="Note ${esc(markOfNote(i))}">` }],
    end: uiRowEnd({ more: { label: `More for note ${markOfNote(i)}`, attrs: { 'data-fn-more': String(i) } } }) })), empty: '<p class="meta">No marked notes</p>' });
  const gridHtml = () => {
    if (!grid) return table ? '<p class="meta">The table could not be read</p>' : '';
    const shownGrid = markGrid(grid, composed().marks), mine = new Set((edit.marked[active]?.cells || []).map(c => `${c.row}\u0000${c.col}`));
    const rows = shownGrid.rows.slice(0, GRID_ROWS + 1).map((r, ri) => `<tr>${r.cells.map((c, ci) => {
      if (c?.merged) return '<td></td>';
      const n = cellName(grid, ri, ci), on = mine.has(`${n.row}\u0000${n.col}`), tag = ri === 0 ? 'th' : 'td';
      const runs = c.runs?.length ? c.runs.map(x => (x.sup ? `<sup>${esc(x.t)}</sup>` : esc(x.t))).join('') : esc(c.text ?? '');
      return `<${tag}><button type="button" class="sf-fn-cell" data-fn-cell="${ri},${ci}" aria-pressed="${on}"${active < 0 ? ' disabled' : ''}>${runs}</button></${tag}>`;
    }).join('')}</tr>`).join('');
    return `<div class="sf-fn-grid"><table class="pkg-grid">${rows}</table></div>${grid.rows.length > GRID_ROWS + 1 ? `<p class="meta">First ${GRID_ROWS} of ${grid.rows.length - 1} rows</p>` : ''}`;
  };
  const body = `${formField('Title', `<input type="text" id="sf-fn-title" value="${esc(it.title || '')}">`)}
    ${formField('Legend', `<textarea id="sf-fn-legend" rows="2">${esc(it.legend || '')}</textarea>`)}
    ${table ? `${formField('Abbreviations', `<input type="text" id="sf-fn-abbr" value="${esc(edit.abbreviations)}" placeholder="CI, confidence interval; RR, risk ratio">`)}
    ${formField('Notes, one per line', `<textarea id="sf-fn-general" rows="2">${esc(edit.general.join('\n'))}</textarea>`)}
    ${uiBar({ kind: 'head', id: 'sf-fn-head', label: 'Marked notes', lead: { title: 'Marked notes', level: 'h3' }, actions: [{ id: 'sf-fn-add', label: 'Add marked note', icon: 'plus', role: 'secondary' }] })}
    <div id="sf-fn-marked">${markedHtml()}</div><div id="sf-fn-cells">${gridHtml()}</div>` : ''}`;
  const got = await formDialog({ id: 'sf-footnotes', title: `${L.get(id)}: ${table ? 'caption and footnotes' : 'caption'}`, tier: 'L', confirm: 'Save', body,
    onMount: d => {
      if (!table) return;
      const draw = () => { d.querySelector('#sf-fn-marked').innerHTML = markedHtml(); d.querySelector('#sf-fn-cells').innerHTML = gridHtml(); bind(); };
      const bind = () => {
        d.querySelectorAll('[data-fn-pick]').forEach(b => b.onclick = () => { active = Number(b.dataset.fnPick); draw(); });
        d.querySelectorAll('[data-fn-text]').forEach(x => x.oninput = () => { edit.marked[Number(x.dataset.fnText)].text = x.value; });
        d.querySelectorAll('[data-fn-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove note', danger: true, run: () => {
          const i = Number(b.dataset.fnMore); edit.marked.splice(i, 1); active = Math.min(active, edit.marked.length - 1); draw(); } }], { align: 'end' }));
        d.querySelectorAll('[data-fn-cell]').forEach(b => b.onclick = () => {
          const m = edit.marked[active];
          if (!m) return;
          const [r, c] = b.dataset.fnCell.split(',').map(Number), n = cellName(grid, r, c), k = m.cells.findIndex(x => x.row === n.row && x.col === n.col);
          if (k >= 0) m.cells.splice(k, 1); else m.cells.push(n);
          draw();
        });
      };
      d.querySelector('#sf-fn-add').onclick = () => { edit.marked.push({ text: '', cells: [] }); active = edit.marked.length - 1; draw(); d.querySelector(`[data-fn-text="${active}"]`)?.focus(); };
      bind();
    },
    submit: (form, d) => ({ title: d.querySelector('#sf-fn-title').value.trim(), legend: d.querySelector('#sf-fn-legend').value.trim(),
      ...(table ? { abbreviations: d.querySelector('#sf-fn-abbr').value, general: d.querySelector('#sf-fn-general').value.split('\n') } : {}) }) });
  if (!got) return;
  const patch = { title: got.title, legend: got.legend };
  if (table) Object.assign(patch, writeNotes({ ...edit, abbreviations: got.abbreviations, general: got.general }, { kind: cv.marks, grid }));
  update(st => { const x = st.package?.items?.[id]; if (x) { Object.assign(x, patch); if (table && !patch.marks.length) delete x.marks; } return st; });
  redraw(`${L.get(id)} saved`);
}

/** The dialogs, for the layout sweep and the browser test. */
export const dialogs = { footnotes: id => footnotesDialog(id), conventions: () => conventionsDialog(), refs: id => listRefs(id) };
