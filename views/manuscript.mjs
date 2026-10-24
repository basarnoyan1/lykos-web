import { REGISTRY } from './registry.mjs';
import { versionReviewPanel, runVersionReview, checkSupplement } from './manuscript-version-review.mjs';
import { projectFacts } from '../lib/review-checks.mjs';
import { activeProfile, normalizeJournalProfile } from '../lib/journal-profile-state.mjs';
import * as proposalLedger from '../lib/aid.mjs';
import { formatTextRange, formatAt, replaceTextRange, formatState, replaceWithParagraphs } from '../lib/manuscript-format.mjs';
import { editReference } from '../lib/reference-editor.mjs';
import { hasDocument } from '../lib/study.mjs';
import { focusPaper } from './library.mjs';
import { show as showFile } from './files.mjs';
import { openLink } from '../lib/native.mjs';
// Manuscript: the document, the evidence it cites, and the checks over it
// (plan J).
//
// The editing surface owns its own DOM. Re-rendering a block while the caret is
// inside it destroys the selection, so typing writes to the store and nothing
// else; the view is rebuilt only when the structure changes — a block added,
// removed, retyped — and the caret is restored explicitly afterwards.
//
// Nothing here writes prose. Citations and results are inserted as links to
// objects the project already holds; the words are the author's.
import { saveFile } from '../lib/save.mjs';
import { draftSection } from '../lib/helpers.mjs';
import { projectContext, reviseParagraph, diffWords } from '../lib/assist.mjs';
import { get, update, projects, getVersion, projectGeneration, recoveryOwner } from '../store.mjs';
import { submissionRoles } from '../lib/submission-checks.mjs';
import { manuscriptOutline } from '../lib/manuscript-outline.mjs';
import { updatePageRulers } from '../lib/page-rulers.mjs';
import { BLOCK_TYPES, blankBlock, starterDocument, citations, runs, toMarkdown, citeToken, resultToken, hashText, numbering, compactNumbers, recognizeSections, recognizedSection, renderText, resultTokens } from '../lib/manuscript.mjs';
import { checkManuscript } from '../lib/manuscript-checks.mjs';
// a table's or figure's works take their numbers with the text (lib/package-cites.mjs: at the first callout, or after the text)
import { withPackage } from '../lib/package-cites.mjs';
import { checkCitations, registryKey } from '../lib/reference-list.mjs';
import { verifyIdentifiers } from '../lib/ref-lookup.mjs';
import { proposeCitationFixes, citationFixes } from '../lib/citation-proposals.mjs';
import { day, plural } from '../lib/dates.mjs';
import { classifyStructure, structureCounts, ROLES, sentenceCase, keptWords } from '../lib/manuscript-structure.mjs';
import { results as allResults } from '../lib/results.mjs';
import { prismaData } from '../lib/prisma-counts.mjs';
import { IPD_FIELDS } from '../lib/prisma-ipd.mjs';
import { authorLine } from '../lib/bib.mjs';
import { formatReference, inText } from '../lib/cite.mjs';
import { download } from '../lib/figure.mjs';
import { confirmAsk, ask, formDialog } from '../lib/dialog.mjs';
import { putFile, getFile, getFileReference, deleteFile } from '../lib/files.mjs';
import { isIncluded } from '../lib/screen.mjs';
import { projectMode, researchType, projectName } from '../lib/workflow.mjs';
import { journalContext } from '../lib/journal-context.mjs';
import { parseDocx } from '../lib/docx.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { COMMENT_W, commentColumn, positionColumn, markComment as markCommentShown } from '../lib/comment-column.mjs';
import { paragraphElement, tableElement, figureElement, tocElement, paginate, resolve as resolveStyle, DEFAULT_SECTION, HIGHLIGHT_CSS } from '../lib/pages.mjs';
import { effectiveStyles, styleOptions, applyStyle, updateStyleFromBlock, editStyle, styleIdOf, styleLabel, isParagraph, idsBetween, setParagraphProps, resolvedPara, shiftIndent, listMarkers, toggleList, shiftListLevel, restartNumbering, continueNumbering, findMatches, replaceMatches, newTable, tableText, insertRow, deleteRow, insertColumn, deleteColumn, mergeCells, splitCell, setHeaderRow, setBorders, distributeColumns, setColumnWidths, ownerOf, decideChanges, changeSummary, trackCellEdit, trackInsertRow, trackDeleteRow, trackInsertColumn, trackDeleteColumn, decideInCell, captionNumbers, captionTargets, noteNumbers, tocEntries, documentCounts, trackDelete, trackJoin, joinWithNext, markComment, removeComment, commentOrder, LINE_SPACING } from '../lib/manuscript-doc.mjs';
import { htmlToParagraphs, tsvTable } from '../lib/paste-html.mjs';
import { findBarSpec, replaceBarSpec, findOption } from '../lib/ui-recipes.mjs';
import { uiBar, uiGroup, reviewSummarySpec, uiList, uiRow, uiRowEnd, uiRegion, summarySpec } from '../lib/ui-actions.mjs';
import { wireBar } from '../lib/bar-fit.mjs';
import { mountCaret } from '../lib/page-caret.mjs';
import { parseMarkdown, inlineMarkdown } from '../lib/markdown.mjs';
import { esc, emptyState, proposalBox } from '../lib/html.mjs';
import { disclosure, formField, uiLink } from '../lib/ui-components.mjs';
import { settings, modelFor } from '../lib/model-settings.mjs';
import { icon } from '../lib/icons.mjs';
import { focusResult } from './analysis.mjs';
import { showMenu } from '../lib/menu.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import {
  submissionParts, wireSubmission, insertAbstractHeadings, insertDeclarationStatements, openDeclarations,
  exportTitlePage, exportCoverLetter, exportBlinded,
  submissionPageSpec, renderSubmissionPage, submissionPageOpen, leaveSubmissionPage,
} from './manuscript-submission.mjs';
import { canInsertAbstract } from '../lib/manuscript-submission.mjs';
import { sections as claimSections, seedClaim, draftUpdate, sentenceAt } from './manuscript-inspect.mjs';
import { checkReferenceStyle } from '../lib/reference-style-check.mjs';
import { headerFooterParts } from '../lib/docx-write-doc.mjs';

export const usesDocument = true;
export const meta = { title: 'Manuscript',
  icon: 'manuscript' };

export const count = (...a) => REGISTRY.manuscript.count(...a);

/** The manuscript's parts as a journal counts them (lib/manuscript-structure.mjs). */
function structure(blocks = blocksOf()) {
  const roles = classifyStructure(blocks);
  return { roles, counts: structureCounts(blocks, { roles, citedCount: numbering(blocks, withPackage(get(), blocks, doc())).size }) };
}
const n = x => Number(x).toLocaleString('en');

/** Details: the word count, then a paragraph update being drafted and the claims (views/manuscript-inspect.mjs). */
export function inspect(ctx) {
  const blocks = get().manuscript?.blocks || [];
  if (!blocks.length || submissionPageOpen()) return [];   // a sub-page of Submission is the page alone (render() hands over to it)
  const { counts: s } = structure(blocks);
  // one row per part: its name, its count, and (where the part can be reclassified) a More that opens the role menu
  const row = (name, value, at, depth = 0, ch = 16, cls) => uiRow({ depth, cls,
    main: { html: `<span class="ms-wc-name">${esc(name)}</span>` },
    cells: [{ col: 'words', kind: 'text', ch, html: esc(value) }],
    end: at != null ? uiRowEnd({ more: { label: `Count ${name} as`, attrs: { 'data-role-at': at } } }) : uiRowEnd({ reserve: true }) });
  const list = (label, rows) => rows.length ? uiList({ label, cols: ['words'], rows }) : '';
  const front = [
    ...(s.title ? [row('Title', plural(s.title.characters, 'character'), s.title.index)] : []),
    ...(s.abstract.index != null ? [row('Abstract', plural(s.abstract.words, 'word'), s.abstract.index), ...s.abstract.parts.map(p => row(p.name, plural(p.words, 'word'), p.index, 1))] : []),
    ...(s.keywords ? [row('Keywords', plural(s.keywords, 'word'))] : [])];
  const main = [row('Main text', plural(s.main.words, 'word'), null, 0, 16, 'ms-wc-total'), ...s.main.sections.flatMap(x => [row(x.name, plural(x.words, 'word'), x.index, 1), ...x.subsections.map(y => row(y.name, plural(y.words, 'word'), y.index, 2))])];
  const excludedValue = e => e.role === 'references' ? plural(e.items, 'reference') : e.role === 'tables' ? plural(e.items, 'table') : e.role === 'legends' ? `${plural(e.items, 'legend')}, ${plural(e.words, 'word')}` : plural(e.words, 'word');
  const html = `<div class="ms-wc">
    ${list('Front matter word count', front)}
    <div class="ms-wc-group">${list('Main text word count', main)}</div>
    ${s.excluded.length ? `<div class="ms-wc-group"><h3 class="ms-wc-title">Not counted in the main text</h3>
      ${list('Not counted in the main text', s.excluded.map(e => row(e.label, excludedValue(e), e.index, 0, 24)))}</div>` : ''}
  </div>`;
  const wordCount = { title: 'Word count', meta: plural(s.main.words, 'word'), html, wire: (host, ctx) => {
    // A row's name sets what its part counts as; the choice is kept in the document.
    host.querySelectorAll('[data-role-at]').forEach(b => b.onclick = () => {
      const at = +b.dataset.roleAt, blk = blocksOf()[at];
      if (!blk) return;
      const cur = structure().roles[at];
      const roles = ROLES.map(([id, label]) => ({ label, checked: cur === id, run: () => setRole(ctx, blk.id, id) }));
      showMenu(b, [{ heading: 'Counts as' },
        { label: 'Front matter', checked: roles.slice(0, 5).some(r => r.checked), submenu: roles.slice(0, 5) },
        roles[5], { label: 'Other sections', checked: roles.slice(6).some(r => r.checked), submenu: roles.slice(6) },
        '-', { label: 'Automatic', checked: !blk.roleFixed, run: () => setRole(ctx, blk.id, null) }], { minWidth: 180, matchWidth: false });
    });
  } };
  return [wordCount, ...toolSections(claimSections(ctx))];
}

/**
 * The writing tools as sections of the inspector, after the word count: Cite and Insert a result (one search over both), the claims,
 * Checks, Journal and Submission readiness (views/manuscript-submission.mjs), Files, Review and Sections. A section's markup is built
 * when the shell draws it (a getter), not when it asks whether there is anything to show, which it does on every paint.
 */
function toolSections(claims) {
  const once = fn => { let done = false, v; return () => (done ? v : (done = true, v = fn())); };
  const data = once(() => { const s = get(), d = doc(); return { s, d, blocks: d.blocks || [], library: libraryRecords(s), resultList: allResults(s) }; });
  const checks = once(() => { const { s, d, blocks, library, resultList } = data(); return railChecks(s, d, blocks, library, resultList); });
  const part = once(() => { const { d, blocks } = data(); return submissionParts({ blocks, assets: d.assets || [], issues: checks().issues }); });
  const tool = (id, title, html, meta = null) => ({ title, get meta() { return meta ? meta() : ''; }, get html() { return html(); },
    wire: (host, ctx) => { host.closest('.insp-sec')?.setAttribute('data-ms-tool', id); wireTool(host, ctx, { library: data().library, resultList: data().resultList }); } });
  return [
    tool('cite', 'Cite', () => citeTool(data().library)),
    tool('results', 'Insert a result', () => `<div id="ms-results-body">${resultsBody(data().resultList)}</div>`, () => resultsMeta(data().resultList)),
    ...claims,
    tool('checks', 'Checks', () => checksPanel(checks().issues, checks().cites)),
    tool('journal', 'Journal', () => part().journal),
    tool('readiness', 'Submission readiness', () => `${part().status}${part().readiness}`),
    tool('files', 'Files', () => assetsPanel(data().d)),
    tool('review', 'Review', () => reviewPanel(), () => modelFor('write')?.model || 'No model'),
    versionReviewTool(tool, data),
    tool('sections', 'Outline', () => sectionPanel(data().d))];   // not Sections: the submission readiness already has a Sections group
}
const resultsMeta = resultList => plural(matchingResults(resultList).length, 'result');
/** Version review (views/manuscript-version-review.mjs): the rules now, a model run on request; its Run review is wired here, its links by wireTool. */
function versionReviewTool(tool, data) {
  const args = () => { const { s, blocks, library } = data(); const jc = journalContext(s);
    const { resultList } = data();
    return { blocks, library, profile: activeProfile(normalizeJournalProfile(s.journalProfile)), researchType: researchType(s).id, journal: jc.journal || '', style: jc.referenceStyle || '',
      facts: projectFacts({ results: resultList, prisma: s.prisma, included: library.filter(p => p.included).length, participants: (s.participants || []).length }) }; };
  const t = tool('version-review', 'Version review', () => versionReviewPanel(args()), () => modelFor('review')?.model || 'No model');
  const wire = t.wire;
  t.wire = (host, ctx) => {
    wire(host, ctx);
    host.querySelector('#vr-run')?.addEventListener('click', () => {
      const redraw = () => { const box = host.querySelector('.ms-vreview'); if (box) { box.outerHTML = versionReviewPanel(args()); t.wire(host, ctx); } };
      runVersionReview({ ...args(), researchType: researchType(get()).label, redraw });
    });
    host.querySelector('#vr-supp')?.addEventListener('click', () => {
      const redraw = () => { const box = host.querySelector('.ms-vreview'); if (box) { box.outerHTML = versionReviewPanel(args()); t.wire(host, ctx); } };
      checkSupplement({ ...args(), redraw });
    });
  };
  return t;
}

/** The inspector opened on a tool (Cite, Insert a result, Checks…) and scrolled to its section; the document keeps its caret. */
function openTool(ctx, id) {
  ctx.openDetails();
  if (id === 'cite' && document.activeElement?.closest?.('[data-cite-row]')) return;   // a citation's Go to reference in list: the row has the view
  document.querySelector(`.insp-sec[data-ms-tool="${id}"]`)?.scrollIntoView({ block: 'start' });
}
function setRole(ctx, id, role) {
  update(s => { const b = s.manuscript.blocks.find(x => x.id === id); if (b) { if (role) b.roleFixed = role; else delete b.roleFixed; } return s; });
  ctx.rerender();
}

const doc = () => get().manuscript || { blocks: [], snapshot: {} };
// One answer for the whole manuscript, its checks and its exports (lib/journal-context.mjs).
const citationStyle = () => journalContext(get()).citationStyle;
const refStyle = () => journalContext(get()).referenceStyle;

/**
 * A group of adjacent citations as the reader will see it. Numbered: "[1,2]"
 * with runs collapsed, numbers by first appearance. Author–year: "(Brat, 1998;
 * Louis, 2021)". Unresolved keys stay visible in either style.
 */
function formatGroup(group, byKey, numbers, { locator = true, style = citationStyle() } = {}) {
  if (style === 'numbered') {
    const nums = group.map(c => numbers.get(c.key)).filter(Boolean);
    const missing = group.filter(c => !byKey.has(c.key)).map(c => `@${c.key}`);
    const parts = [nums.length ? compactNumbers(nums) : '', ...missing].filter(Boolean);
    const loc = locator ? group.map(c => c.locator).filter(Boolean).join('; ') : '';
    return `[${parts.join(',')}${loc ? `, ${loc}` : ''}]`;
  }
  return `(${group.map(c => {
    const p = byKey.get(c.key);
    if (!p) return `@${c.key}`;
    return `${inText(p)}${locator && c.locator ? `, ${c.locator}` : ''}`;
  }).join('; ')})`;
}
const blocksOf = () => doc().blocks || [];
// Words the text keeps capitalised (lib/manuscript-structure.mjs), worked out once per change of the document.
let keptAt = null;
const keptNow = () => { const v = getVersion(); if (keptAt?.v !== v) keptAt = { v, words: keptWords(blocksOf()) }; return keptAt.words; };

let chosen = new Set();     // references picked for the next citation
let pick = '';              // the search over references and results (Cite, Insert a result)
let wantTool = null;        // the inspector section to open at once the page is drawn (Needs attention lands on Checks)
let sectionPick = null;
const sectionCollapsed = new Set();
/** Arrival from Needs attention (lib/arrive.mjs): manuscript errors and warnings, and the citation check, open the inspector at Checks, which lists each with its place. */
export function arrive(a) {
  if (a?.kind === 'manuscript-errors' || a?.kind === 'manuscript-warnings' || a?.kind === 'citation-check') wantTool = 'checks';
  // the reference list's findings open, each a button that lands on its citation or entry
  citeOpen = a?.kind === 'citation-check';
  return false;
}
/**
 * A write of the assistant's (lib/tracked-edit.mjs), shown where it is: the paragraph comes into view and the words it put in appear one
 * after another, in the place the page already holds for them, so nothing below moves (a highlight hides the words still to come; the
 * text is the document's own throughout). A press or a key anywhere shows the rest at once; with reduced motion all show at once.
 */
export function showWrite(w, until = Date.now() + 4000) {
  // the page is laid out after it opens (its first layout waits for fonts): the paragraph is looked for until it is there
  const page = mounted?.querySelector('#page'), paras = page ? [...page.querySelectorAll(`.mb-edit[data-b="${CSS.escape(w.block)}"]`)] : [];
  const ready = paras.some(p => p.querySelector('ins.tc-ins'));
  if (!ready) { if (Date.now() < until) setTimeout(() => showWrite(w, until), 50); return; }
  paras[0].scrollIntoView({ block: 'center' });
  const ofWrite = el => { try { return JSON.parse(el.dataset.ins || '{}').write === w.write; } catch { return false; } };
  const nodes = paras.flatMap(p => [...p.querySelectorAll('ins.tc-ins')].filter(ofWrite)).flatMap(el => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n); return out; });
  if (!nodes.length || !globalThis.CSS?.highlights || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // word ends, in order, across the inserted text: each step shows up to the next one, about two seconds in all
  const ends = nodes.flatMap((n, i) => [...n.data.matchAll(/\S+/g)].map(m => [i, m.index + m[0].length]));
  const step = Math.max(1, Math.ceil(ends.length / 60));
  let k = 0, timer = 0;
  const hidden = new Highlight();
  const paint = () => {
    hidden.clear();
    const [i, at] = k ? ends[Math.min(k, ends.length) - 1] : [0, 0];
    nodes.forEach((n, j) => { if (j < i || (j === i && at >= n.data.length)) return; const r = new Range(); r.setStart(n, j === i ? at : 0); r.setEnd(n, n.data.length); hidden.add(r); });
  };
  const stop = () => { clearInterval(timer); CSS.highlights.delete('ms-writing'); removeEventListener('pointerdown', stop, true); removeEventListener('keydown', stop, true); };
  addEventListener('pointerdown', stop, true); addEventListener('keydown', stop, true);
  paint(); CSS.highlights.set('ms-writing', hidden);
  timer = setInterval(() => { k += step; if (k >= ends.length || !nodes[0].isConnected) stop(); else paint(); }, 32);
}

/** What the assistant is told about this view: the outline and the paragraph in focus. */
export function assistContext() {
  const d = get().manuscript; if (!d?.blocks?.length) return 'Manuscript: empty';
  const heads = d.blocks.filter(b => /^h/.test(b.type) || b.type === 'title').map(b => b.text).slice(0, 30);
  const words = d.blocks.reduce((n, b) => n + (b.text || '').split(/\s+/).filter(Boolean).length, 0);
  const focus = caretBlock || document.activeElement?.closest?.('.mb-edit')?.dataset.b || document.querySelector('.mb-edit.on')?.dataset.b;
  const i = focus ? d.blocks.findIndex(b => b.id === focus) : -1;
  const fb = i >= 0 ? d.blocks[i] : null;
  const under = fb ? [...d.blocks.slice(0, i)].reverse().find(b => /^h/.test(b.type))?.text : '';
  const cites = fb ? (fb.runs || []).filter(r => r.cite).flatMap(r => r.cite).length : 0;
  const section = fb ? [...d.blocks.slice(0, i + 1)].reverse().find(b => /^h[23]$/.test(b.type)) : null;
  return [`Manuscript: ${words} words, ${d.blocks.length} paragraphs; sections: ${heads.join(' | ')}`,
    fb ? `Paragraph in focus (${fb.styleId || fb.type}${under ? `, under "${under}"` : ''}, ${cites} citation${cites === 1 ? '' : 's'}): ${fb.text.slice(0, 1500)}` : 'No paragraph in focus',
    section ? `Current section: ${section.text}; page break before: ${!!section.props?.pageBreakBefore}; alignment: ${section.props?.jc || 'inherited'}` : '',
    chosen.size ? `${chosen.size} references picked for citing` : ''].filter(Boolean).join('\n');
}
// The block the caret was last in. Kept after focus leaves the page, so an
// action chosen from a menu or the command palette still knows its paragraph.
let caretBlock = null;
/** What is in focus here, for model actions: the block with the caret and its section. */
export function focus() {
  const bs = get().manuscript?.blocks || [];
  const i = bs.findIndex(b => b.id === caretBlock);
  if (i < 0) return null;
  const b = bs[i];
  let h = i; while (h >= 0 && !/^h[1-3]$/.test(bs[h].type)) h--;
  const section = h >= 0 ? bs[h].text.trim() : '';
  const type = BLOCK_TYPES.find(t => t.id === b.type)?.label || b.type;
  return { kind: 'block', blockId: b.id, blockType: b.type, section,
    label: section && h !== i ? `${type} in ${section}` : `${type}${b.text.trim() ? '' : ' (empty)'}`, text: b.text };
}
let focusId = null;         // block to put the caret in after a structural redraw
let focusAt = 0;
let returnScroll = null;     // where the page was when a citation's paper was opened elsewhere; drawn there again on the way back
let revealKey = null;        // a reference to show in the Cite list (a citation's Go to reference in list)
let repaginateT = null;
let selectionAfterRender = null;
let selectionEvents = null;
let editorEvents = null;     // document listeners of the current page, dropped on each repaint
let typingFormat = null;
const formatUndo = [], formatRedo = [];
const blockSignature = () => JSON.stringify(blocksOf());
// The parts of the manuscript an editing command can change, kept whole for undo.
const DOC_KEYS = ['blocks', 'lists', 'styles', 'notes', 'comments', 'section'];
const docState = () => Object.fromEntries(DOC_KEYS.map(k => [k, structuredClone(doc()[k] ?? null)]));
function undoFormatting(redo, ctx) {
  const source = redo ? formatRedo : formatUndo, target = redo ? formatUndo : formatRedo;
  const entry = source.at(-1);
  if (!entry || entry.project !== projects().current || blockSignature() !== JSON.stringify(redo ? entry.before : entry.after)) return false;
  source.pop(); target.push(entry);
  update(s => {
    if (entry.doc) for (const k of DOC_KEYS) { const v = (redo ? entry.doc.after : entry.doc.before)[k]; if (v == null) delete s.manuscript[k]; else s.manuscript[k] = structuredClone(v); }
    else s.manuscript.blocks = structuredClone(redo ? entry.after : entry.before);
    return s;
  });
  typingFormat = null; selectionAfterRender = entry.selection; clearTimeout(repaginateT); ctx.rerender();
  return true;
}
/**
 * One editing command: the manuscript is changed through `mutate` (given a
 * copy, returning the new one), recorded for undo, and redrawn with the
 * selection put back.
 */
function commitDoc(ctx, mutate, selection = null) {
  clearTimeout(repaginateT); typingFormat = null;
  const before = docState();
  let changed = false;
  update(s => { const next = mutate(structuredClone(s.manuscript)); if (next) { s.manuscript = next; changed = true; } return s; });
  const after = docState();
  if (!changed || JSON.stringify(before) === JSON.stringify(after)) return false;
  const sel = typeof selection === 'function' ? selection() : selection;
  formatUndo.push({ project: projects().current, before: before.blocks, after: after.blocks, doc: { before, after }, selection: sel });
  if (formatUndo.length > 50) formatUndo.shift();
  formatRedo.length = 0;
  focusId = null; selectionAfterRender = sel;
  ctx.rerender();
  return true;
}
let pageLayout = false;
let zoom = 'fit';            // page zoom: 'fit' or a scale
let showChanges = true;      // tracked insertions and deletions marked, or the text as it would read
let focusCell = null;        // { id, r, c, at } or { note, at }: the caret to restore in a table cell or a note
let findState = { open: false, query: '', replace: '', caseSensitive: false, wholeWord: false, at: -1 };

// ---------------------------------------------------------------------------

let mounted = null;   // the view's root while it is on screen, for the menu bar's menus
let suggestionContext = null;
export function syncSuggestions(ctx = suggestionContext) {
  if (ctx) suggestionContext = ctx;
  const host = mounted?.querySelector('#ms-suggestions'); if (!host) return;
  const count = proposalLedger.allEntries().reduce((total, entry) => total + entry.items.filter(item => item.state === 'open' && item.accept && (item.manuscriptEdit || entry.view === 'manuscript' || ['edit_paragraph', 'insert_paragraph', 'insert_manuscript_output'].includes(item.op))).length, 0);
  host.hidden = !count;
  // the ledger's summary (its text and its one action), drawn at the strip's height: one slim line over the page
  host.innerHTML = count ? uiBar({ ...summarySpec(reviewSummarySpec({ count, id: 'ms-suggestions-summary' })), density: 'dense' }) : '';
  host.querySelector('[data-review-suggestions]')?.addEventListener('click', () => ctx?.openProposals());
}

// ---- the chrome around the document: one strip over it, the formatting strip, find and replace ---------------------------------------
// Every row of controls is declared (lib/ui-actions.mjs) and fits itself; nothing here places a control.

const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2];
const zoomText = () => zoom === 'fit' ? 'Fit width' : `${Math.round(zoom * 100)}%`;

let sectionLabel = 'Document';   // the section the caret is in: the title bar's title, written in place as the caret moves
/** The title bar's status: the words, and the pages once the print layout has counted them. */
/** What the title bar shows of the document, written in place: the bar is painted again only when the page is. */
const barTitle = text => { const t = document.getElementById('topbar-title')?.querySelector(':scope > span'); if (t && t.textContent !== text) t.textContent = text; };
const barCount = text => { const n = document.getElementById('topbar-status'); if (n && n.textContent !== text) n.textContent = text; };

let shownCtx = null;   // the title bar's commands repaint and open dialogs through the context of the last render
/**
 * The title bar (lib/topbar.mjs): the section the caret is in as the title, whose menu is the word count; the words (and pages) as the
 * status; Export; More holds Zoom and the document view as choices, then Import. With no manuscript yet: Import alone.
 */
export function page(rerender) {
  // the journal profile, the declarations and the responses are sub-pages of the Manuscript, each with Back (views/manuscript-submission.mjs)
  const subPage = submissionPageSpec(rerender, shownCtx && submissionApi(null, shownCtx));
  if (subPage) return subPage;
  const imp = { id: 'ms-tb-import', label: 'Import…', icon: 'import', run: () => importFile(rerender) };
  if (!blocksOf().length) return { title: 'Manuscript', actions: [{ ...imp, label: 'Import' }] };
  const zooms = [['fit', 'Fit width'], ...ZOOM_STEPS.map(z => [String(z), `${z * 100}%`]), ...(zoom !== 'fit' && !ZOOM_STEPS.includes(zoom) ? [[String(zoom), zoomText()]] : []), ['custom', 'Custom zoom…']];
  const chooseZoom = async v => {
    if (v === 'custom') { const r = await numberDialog('Zoom', [{ name: 'percent', label: 'Zoom (%)', value: zoom === 'fit' ? 100 : zoom * 100, min: 10, max: 500 }]); if (r?.percent) zoom = r.percent / 100; else { rerender(); return; } }
    else zoom = v === 'fit' ? 'fit' : Number(v);
    rerender();
  };
  const setView = paged => {
    if (pageLayout === paged) return;
    const n = getSelection()?.anchorNode, box = (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('.mb-edit') || mounted?.querySelector('.mb-edit.on');
    if (box) { focusId = box.dataset.b; focusAt = sourceOffset(box); }
    pageLayout = paged; rerender();
  };
  return { title: sectionLabel, titleMenu: a => showMenu(a, countItems(mounted || document), { minWidth: 220 }),
    // the word count is in the title's menu (countItems), not beside the title (Component review 2026-10-21, item 1)
    actions: [{ id: 'ms-tb-export', label: 'Export', icon: 'export', menu: true, run: a => showMenu(a, [
      { label: 'Word document (.docx)', icon: 'file', run: () => exportDocx(rerender).catch(() => {}) },
      { label: 'Markdown (.md)', icon: 'file', run: exportMarkdown },
      '-',
      { label: 'Title page (.docx)', icon: 'file', run: () => exportTitlePage(rerender) },
      { label: 'Cover letter (.docx)', icon: 'file', run: () => exportCoverLetter(rerender) },
      { label: 'Blinded manuscript (.docx)', icon: 'file', run: () => exportBlindedDocx(rerender) },
    ]) }],   // Response to reviewers is Submission's (its More): one home. The tools (Cite, Insert a result, Checks…) are sections of the inspector, whose toggle ends this bar.
    overflow: [{ id: 'ms-zoom', label: 'Zoom', kind: 'select', value: String(zoom), options: zooms, run: el => chooseZoom(el.value) },
      { id: 'ms-layout', label: 'Document view', kind: 'select', value: pageLayout ? 'print' : 'continuous', options: [['print', 'Print layout'], ['continuous', 'Continuous']], run: el => setView(el.value === 'print') },
      '-', { id: 'ms-check-claim', label: 'Check claim', icon: 'check-square', run: checkClaim },
      { id: 'ms-propose-update', label: 'Propose update from results', icon: 'proposals', run: proposeUpdate },
      { id: 'ms-ask', label: 'Ask about this', icon: 'assistant', attrs: { 'data-ask-about': 'manuscript-selection' } },
      '-', imp] };
}

/** The claim the caret points at: the words selected in one paragraph, else the sentence with the caret. */
function claimAtCaret() {
  const sel = heldSelection, b = blocksOf().find(x => x.id === (sel?.start.id || caretBlock));
  if (!b || !isParagraph(b) || /^h\d$/.test(b.type)) return '';
  const t = b.text || '';
  if (sel && sel.start.id === b.id && sel.end.id === b.id && sel.end.at > sel.start.at) return t.slice(sel.start.at, sel.end.at);
  return sentenceAt(t, sel?.start.id === b.id ? sel.start.at : 0);
}
/** Check claim (More): Details opens on Claims with the claim at the caret (views/manuscript-inspect.mjs). */
function checkClaim() {
  if (!shownCtx) return;
  seedClaim(claimAtCaret());
  shownCtx.openDetails(); shownCtx.refreshDetails();
  const t = document.getElementById('ms-claim-text');
  t?.scrollIntoView({ block: 'nearest' }); t?.focus({ preventScroll: true });
}
/** Propose update from results (More): the paragraph with the caret, as it reads, becomes a draft proposal in Details. */
function proposeUpdate() {
  if (!shownCtx) return;
  const b = blocksOf().find(x => x.id === caretBlock);
  try { draftUpdate({ block: b?.id, text: b?.text }); } catch (error) { shownCtx.say(error.message); return; }
  shownCtx.openDetails(); shownCtx.refreshDetails();
  const t = document.getElementById('ms-update-text');
  t?.scrollIntoView({ block: 'nearest' }); t?.focus({ preventScroll: true });
}

/** The formatting strip: two pickers, the size, four icon groups; the menus of the rest (paragraph, insert, table, layout, review) are in More. */
function formattingBar(d) {
  const styles = styleOptions(d);
  // The pickers open showing what the first paragraph has, so nothing changes under the strip when the caret first lands.
  const first = (d.blocks || []).find(isParagraph), st = effectiveStyles(d);
  const firstStyle = first ? styleLabel(styleIdOf(first), st.byId[styleIdOf(first)]) : styles[0]?.label || 'Normal';
  const firstFont = first ? formatAt(first, 0).font || resolveStyle(first, st).run.font || 'Times New Roman' : 'Times New Roman';
  const firstSize = first ? formatAt(first, 0).sz || resolveStyle(first, st).run.sz || 12 : 12;
  const fmt = (id, label, ico, attr, kbd) => ({ id, label, icon: ico, kbd, attrs: attr });
  return uiBar({ kind: 'strip', label: 'Formatting', id: 'mstools', density: 'dense', budget: { n: 6, reason: 'a word processor strip: style, font, text, alignment, lists and history' },
    actions: [
      { picker: true, id: 't-style', label: 'Paragraph style', icon: 'heading', value: firstStyle, valueCh: 12, role: 'quiet', fold: 3, options: styles.map(t => [t.id, t.label]) },
      { picker: true, id: 't-font', label: 'Font', icon: 'font', value: firstFont, valueCh: 16, role: 'quiet', fold: 5, options: docFonts(d).map(f => [f, f]) },
      { field: true, id: 't-size', label: 'Font size', type: 'number', width: { ch: 4 }, value: String(firstSize), role: 'quiet', attrs: { title: 'Font size in points', min: 1, max: 1638, step: 0.5, list: 'ms-font-sizes' } },
      uiGroup({ id: 'ms-char', label: 'Text style', fold: 1, items: [
        fmt('t-bold', 'Bold', 'bold', { 'data-fmt': 'bold' }, '⌘B'), fmt('t-italic', 'Italic', 'italic', { 'data-fmt': 'italic' }, '⌘I'),
        fmt('t-underline', 'Underline', 'underline', { 'data-fmt': 'underline' }, '⌘U'),
        fmt('t-char-menu', 'Text formatting', 'chevron-down', { 'data-menu': 'char', 'aria-haspopup': 'menu', 'aria-expanded': 'false' })] }),
      uiGroup({ id: 'ms-align', label: 'Alignment', fold: 7, items: [
        fmt('t-left', 'Align left', 'align-left', { 'data-align': 'left' }), fmt('t-centre', 'Centre', 'align-center', { 'data-align': 'center' }),
        fmt('t-right', 'Align right', 'align-right', { 'data-align': 'right' }), fmt('t-justify', 'Justify', 'align-justify', { 'data-align': 'both' })] }),
      uiGroup({ id: 'ms-lists', label: 'Lists and indents', fold: 6, items: [
        fmt('t-bullets', 'Bulleted list', 'list-bullet', { 'data-cmd': 'bullets' }), fmt('t-numbers', 'Numbered list', 'list-number', { 'data-cmd': 'numbers' }),
        fmt('t-outdent', 'Decrease indent', 'outdent', { 'data-cmd': 'outdent' }), fmt('t-indent', 'Increase indent', 'indent', { 'data-cmd': 'indent' })] }),
      uiGroup({ id: 'ms-history', label: 'History', fold: 8, items: [
        fmt('t-undo', 'Undo', 'undo', { 'data-fmt': 'undo' }), fmt('t-redo', 'Redo', 'redo', { 'data-fmt': 'redo' })] })],
    overflow: [{ id: 't-find', label: 'Find and replace' }] });
}

/** Find, and under it replace: the shared find bar and the replace row under it, in one floating panel (lib/ui-recipes.mjs). */
function findBars() {
  const find = uiBar(findBarSpec({ id: 'ms-find', label: 'Find', field: 'f-q', count: 'f-count', value: findState.query, ids: { prev: 'f-prev', next: 'f-next', close: 'f-close' },
    steps: { prevKbd: '⇧↵', nextKbd: '↵' }, options: [findOption.matchCase('f-case', findState.caseSensitive), findOption.wholeWord('f-word', findState.wholeWord)] }));
  const replace = uiBar(replaceBarSpec({ id: 'ms', field: 'f-r', ids: { one: 'f-one', all: 'f-all' }, value: findState.replace }));
  return `<div class="ms-find" id="ms-find" role="search" aria-label="Find and replace"${findState.open ? '' : ' hidden'}>${find}${replace}</div>`;
}

export function render(el, ctx) {
  mounted = el; shownCtx = ctx;
  // a sub-page of Submission is the page alone: the document, its toolbar and its caret are given back and come again with Back
  if (submissionPageOpen()) { unmount(); shownCtx = ctx; renderSubmissionPage(el, ctx); return; }
  const d = doc();
  const blocks = d.blocks || [];

  // Existing saved imports need the same recognition as new DOCX imports.
  if (blocks.some(b => b.type === 'p' && recognizedSection(b.text)))
    update(s => { recognizeSections(s.manuscript.blocks); return s; });
  // Each block's part of the paper (title, abstract, main text, references…) is kept on it for checks and exports.
  const roles = classifyStructure(blocks);
  if (blocks.some((b, i) => (b.role || null) !== roles[i]))
    update(s => { s.manuscript.blocks.forEach((b, i) => { if (roles[i]) b.role = roles[i]; else delete b.role; }); return s; });
  // a table or figure the app draws is linked: redrawn here once its data changed (views/paper-place.mjs, loaded only for such a block)
  if (blocks.some(b => b.app?.key)) import('./paper-place.mjs').then(m => m.refreshManuscript()).then(words => { if (words && mounted === el) ctx.rerender(`Redrawn from their data: ${words}`); }, () => {});

  if (!blocks.length) {
    el.innerHTML = emptyState({ icon: 'manuscript', title: 'No manuscript',
      actions: [{ id: 'start', label: 'Start a manuscript', icon: 'plus', primary: true }] });
    el.querySelector('#start').onclick = () => {
      update(s => { s.manuscript = { blocks: starterDocument(researchType(s).id, projectName(s)), snapshot: {} }; return s; });
      ctx.rerender(); ctx.refreshCounts();
    };
    return;
  }

  const s = get();
  const library = libraryRecords(s);
  const resultList = allResults(s);
  const numbers = numbering(blocks, withPackage(get(), blocks, d));

  el.innerHTML = `<div class="ms">
    <div class="ms-doc" id="docwrap">
      ${formattingBar(d)}
      <div id="ms-suggestions" class="ms-suggestions" hidden></div>
      ${findBars()}
      <div class="ms-ruler-bar" id="ms-ruler-bar" hidden><span class="ms-ruler-unit">in</span><button type="button" title="Page margins (inches)"></button></div>
      <div class="ms-scroll" id="ms-scroll"><div class="ms-ruler-verticals" id="ms-ruler-verticals" aria-hidden="true"></div><div class="ms-pages" id="page"></div></div>
      <datalist id="ms-font-sizes">${SIZES.map(n => `<option value="${n}"></option>`).join('')}</datalist>
    </div>
  </div>`;

  syncSuggestions(ctx);
  const compact = narrowEditor(el);
  layoutPages(el, blocks, d, library, resultList, numbers, ctx);
  fitRo?.disconnect(); cancelAnimationFrame(fitFrame);
  fitRo = new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!el.querySelector('.ms')?.isConnected) return;
      if (narrowEditor(el) !== compact) ctx.rerender();
      else { fitPages(el); positionComments(el); }
    });
  });
  fitRo.observe(el.querySelector('#docwrap'));
  wireEditor(el, ctx);
  wireTools(el, ctx);
  el.querySelector('#ms-scroll').addEventListener('scroll', () => updatePageRulers(el, { vertical: false }), { passive: true });
  el.querySelector('#ms-ruler-bar button').onclick = () => pageSetupDialog(el, ctx);
  if (returnScroll != null) { const sc = el.querySelector('#ms-scroll'); if (sc) sc.scrollTop = returnScroll; returnScroll = null; }
  if (selectionAfterRender) {
    restoreTextSelection(el.querySelector('#page'), selectionAfterRender);
    selectionAfterRender = null;
  } else restoreCaret(el);
  // a tool asked for from elsewhere (Needs attention, an Insert menu entry): the inspector opens on it once this page is painted
  if (wantTool) { const id = wantTool; wantTool = null; queueMicrotask(() => openTool(ctx, id)); }
}

// ---- the document, as pages ------------------------------------------------

/**
 * Render every block as a formatted paragraph and lay the paragraphs out on
 * pages of the document's own section. A citation run becomes its number
 * (or author–year); a result token becomes its value. Both are atomic chips
 * inside the editable paragraph: the caret moves over them, never into them.
 */
const narrowEditor = el => (el.querySelector('#docwrap')?.clientWidth || 0) < 560;

function layoutPages(el, blocks, d, library, resultList, numbers, ctx) {
  const host = el.querySelector('#page');
  // One editing host for the whole document, so a selection can run across
  // paragraphs and pages as in Word; each .mb-edit inside it is one block.
  host.contentEditable = 'true';
  host.spellcheck = true;
  host.classList.toggle('tc-hidden', !showChanges);
  el.querySelector('#ms-scroll')?.classList.toggle('has-comments', commentOrder(blocks, d.comments || {}).length > 0);
  if (pageLayout && !narrowEditor(el) && reusePages(el, host, ctx)) return;
  const byKey = new Map(library.map(p => [p.key, p]));
  const resByKey = new Map(resultList.map(r => [r.key, r]));
  const snapshot = d.snapshot || {};
  const styles = effectiveStyles(d);
  const section = d.section || DEFAULT_SECTION;
  const markers = listMarkers(blocks, d.lists || {});
  const captions = captionNumbers(blocks);
  const notes = d.notes || {};
  const noteNums = noteNumbers(blocks, notes);
  const seqAt = new Map();

  const chip = (tag, cls, src, shown, extra = '') => `<${tag} class="tok ${cls}" contenteditable="false" data-src="${esc(src)}"${extra}>${esc(shown)}</${tag}>`;
  const renderRun = (r, i, b) => {
    if (r.cite) {
      const group = r.cite.map(key => ({ key, locator: '' }));
      const missing = group.some(c => !byKey.has(c.key));
      const shown = formatGroup(group, byKey, numbers, { locator: false });
      const src = r.cite.map(k => citeToken(k)).join('');
      return chip('sup', `cite${missing ? ' missing' : ''}`, src, citationStyle() === 'numbered' ? shown.replace(/^\[|\]$/g, '') : shown);
    }
    // Text runs may contain result tokens; those become value chips too.
    return runs(r.t).map(x => {
      if (x.kind === 'text') return esc(x.text);
      if (x.kind === 'cite') {
        const p = byKey.get(x.key);
        const shown = formatGroup([x], byKey, numbers);
        return chip('sup', `cite${p ? '' : ' missing'}`, citeToken(x.key, x.locator), citationStyle() === 'numbered' ? shown.replace(/^\[|\]$/g, '') : shown);
      }
      const src = resultToken(x.key);
      // The document's own fields: notes, caption numbers, cross-references, page numbers, comments.
      if (x.key.startsWith('fn:')) { const n = noteNums.get(x.key.slice(3)); return chip('sup', `note${n ? '' : ' missing'}`, src, n ? n.label : '?', ` data-note="${esc(x.key.slice(3))}"`); }
      if (x.key.startsWith('seq:')) { const k = seqAt.get(b?.id) || 0; seqAt.set(b?.id, k + 1); return chip('span', 'seq', src, String(captions.perBlock.get(b?.id)?.[k] ?? '?')); }
      if (x.key.startsWith('xref:')) { const label = captions.label.get(x.key.slice(5)) || headingText(blocks.find(y => y.id === x.key.slice(5))?.text).slice(0, 80); return chip('span', `xref${label ? '' : ' missing'}`, src, label || 'Missing caption', ` data-xref="${esc(x.key.slice(5))}"`); }
      if (x.key === 'page' || x.key === 'pages') return chip('span', 'field', src, '#');
      if (x.key.startsWith('cm:')) { const c = d.comments?.[x.key.slice(3)]; return chip('sup', `comment${c ? '' : ' missing'}`, src, c?.initials || (c?.author || '').slice(0, 2) || '*', ` data-comment="${esc(x.key.slice(3))}"`); }
      const am = x.key.match(/^(fig|tab):(.+)$/);
      if (am) {
        const assets = d.assets || [];
        const a = assets.find(y => y.id === am[2]);
        return chip('span', `res${a ? '' : ' missing'}`, src, a ? assetLabel(a, assets) : x.key);
      }
      const res = resByKey.get(x.key);
      const was = snapshot[x.key];
      const stale = res && was != null && was !== res.text;
      return chip('span', `res${res ? (stale ? ' stale' : '') : ' missing'}`, src, res ? res.text : `{{${x.key}}}`, ` data-result="${esc(x.key)}"`);
    }).join('');
  };

  // Which section each block is in: a block carrying a section ends it.
  const sections = [];
  let secK = 0;
  const secOf = new Map();
  for (const b of blocks) { secOf.set(b.id, secK); if (b.props?.section) { sections.push(b.props.section); secK++; } }
  sections.push(section);
  const entries = blocks.some(b => b.type === 'toc') ? tocEntries(blocks) : [];

  const refLines = blocks.some(b => b.type === 'bib') ? referenceList(library, numbers).lines : [];
  const paras = blocks.flatMap(b => {
    let el2;
    if (b.type === 'bib') return bibElements(b, refLines, styles, renderRun, secOf.get(b.id));
    if (b.type === 'table' && b.grid) el2 = tableElement(b, styles, renderRun);
    else if (b.type === 'figure') el2 = figureElement(b);
    else if (b.type === 'toc') el2 = tocElement(b, entries);
    else {
      const li = b.props?.list;
      const def = li ? d.lists?.[li.id]?.levels?.[li.level || 0] : null;
      el2 = paragraphElement(withRuns(b), styles, renderRun, { marker: markers.get(b.id) ?? null, list: def });
      el2.classList.add('mb-edit');
      if (!b.text.trim()) el2.dataset.ph = placeholderFor(b.type);
      // A tracked paragraph mark: inserted by a split, or deleted by a join, while tracking.
      if (b.props?.markIns) el2.classList.add('tc-mark-ins');
      if (b.props?.markDel) el2.classList.add('tc-mark-del');
    }
    if (!el2.classList.contains('mb-edit')) { el2.classList.add('mb-obj'); el2.dataset.nosplit = b.type === 'table' ? '' : '1'; if (b.type === 'table') delete el2.dataset.nosplit; }
    if (b.props?.pageBreakBefore) el2.dataset.pageBreakBefore = '1';
    if (b.props?.section) el2.dataset.sectionEnd = '1';
    el2.dataset.sec = secOf.get(b.id);
    return el2;
  });
  // Footnotes and endnotes, in order of reference, after the text; each editable in place.
  // Notes, in order of reference, each editable in place. In page view a
  // footnote sits at the foot of the page that refers to it (pages.mjs);
  // endnotes, and every note in the continuous view, follow the text.
  const paged = pageLayout && !narrowEditor(el);
  const noteRow = (id, n) => {
    const row = document.createElement('div');
    row.className = 'pg-note';
    const num = document.createElement('span');
    num.className = 'pg-note-n'; num.textContent = n.label;
    const text = paragraphElement({ id: `note-${id}`, type: 'p', styleId: 'Normal', props: { after: 0, line: 1 }, runs: notes[id].runs?.length ? notes[id].runs : [{ t: notes[id].text || '' }] },
      { ...styles, default: { ...styles.default, run: { ...styles.default?.run, sz: 10 } } }, renderRun);
    text.classList.add('mb-note'); text.classList.remove('para');
    text.contentEditable = 'true'; text.dataset.note = id; delete text.dataset.b;
    row.append(num, text);
    return row;
  };
  const referenced = [...noteNums].filter(([id]) => notes[id]);
  const footRows = new Map();
  if (paged) for (const [id, n] of referenced) if (n.kind !== 'endnote') footRows.set(id, noteRow(id, n));
  const trailing = referenced.filter(([id]) => !footRows.has(id));
  if (trailing.length) {
    const box = document.createElement('div');
    box.className = 'pg-notes mb-obj';
    box.contentEditable = 'false';
    box.dataset.nosplit = '1';
    box.dataset.sec = String(sections.length - 1);
    for (const [id, n] of trailing) box.append(noteRow(id, n));
    paras.push(box);
  }
  const words = structureCounts(blocks, { citedCount: 0 }).main.words;
  layoutCache = null;
  if (!pageLayout || narrowEditor(el)) {
    host.classList.add('ms-flow');
    host.replaceChildren(...paras);
    loadFigures(host, [host]);
    host.style.setProperty('--ms-zoom', zoom === 'fit' ? '1' : String(zoom));
    updatePageRulers(el);
    barCount(`${words.toLocaleString('en')} words`);
    renderComments(el, ctx);
    return;
  }
  // A header or footer with pictures or tables is drawn by the same renderers as the text.
  const headerFooter = part => {
    const box = document.createElement('div');
    for (const b of part.blocks) box.append(b.type === 'table' && b.grid ? tableElement(b, styles, renderRun)
      : b.type === 'figure' ? figureElement(b) : paragraphElement(withRuns(b), styles, renderRun));
    return box;
  };
  const pages = paginate(host, paras, section, { lineNumbers: true, sections, footnotes: footRows, evenOdd: !!section.evenOdd, headerFooter });
  loadFigures(host, [host]);
  fitPages(el);
  const countText = `${pages} ${pages === 1 ? 'page' : 'pages'}, ${words.toLocaleString('en')} words`;
  barCount(countText);
  layoutCache = { key: layoutKey(), host, countText };
  layoutDirty = false;
  renderComments(el, ctx);
}

/**
 * The laid-out pages are kept with what they were laid out from: the project
 * state (its version counts every change) and the view's own settings. A
 * render with the same key — returning to the view, a panel switched —
 * takes the pages as they are instead of measuring them again. Typing marks
 * them stale until they are laid out anew.
 */
let layoutCache = null, layoutDirty = false;
const layoutKey = () => `${projects().current}|${getVersion()}|${zoom}|${showChanges}|${citationStyle()}|${refStyle()}`;
function reusePages(el, host, ctx) {
  const c = layoutCache;
  if (!c || layoutDirty || c.key !== layoutKey() || c.host === host || !c.host.firstChild) return false;
  host.replaceChildren(...c.host.childNodes);
  layoutCache = { ...c, host };
  fitPages(el);
  barCount(c.countText);
  renderComments(el, ctx);
  return true;
}

/**
 * The reference list the document generates, one paragraph per work, where the
 * document keeps it. Read-only: it follows the citations. A list read from a
 * Word file shows as it was until the text cites something.
 */
function bibElements(b, lines, styles, renderRun, sec) {
  const shown = lines.length ? lines : b.lines || [];
  const rows = (shown.length ? shown : ['No references cited']).map((line, k) => {
    const el2 = paragraphElement({ id: b.id, type: 'p', styleId: 'Normal', props: { indLeft: 32, indHanging: 32, after: 6 }, runs: [{ t: line }] }, styles, renderRun);
    el2.classList.add('mb-obj', 'mb-bib');
    el2.contentEditable = 'false';
    el2.dataset.b = b.id; el2.dataset.nosplit = '1'; el2.dataset.sec = sec;
    if (!shown.length) el2.classList.add('mb-bib-empty');
    if (k === 0 && b.props?.pageBreakBefore) el2.dataset.pageBreakBefore = '1';
    return el2;
  });
  return rows;
}

/**
 * The works the manuscript cites, in citation order for a numbered style and
 * A–Z for author–year, each formatted in the reference style: what the
 * document's reference list and the Word export show.
 */
function referenceList(library, numbers, { numbered = citationStyle() === 'numbered', referenceStyle = refStyle() } = {}) {
  const byKey = library instanceof Map ? library : new Map(library.map(p => [p.key, p]));
  const keys = [...numbers.keys()].filter(key => byKey.has(key)).sort(numbered ? (a, b) => numbers.get(a) - numbers.get(b)
    : (a, b) => String(byKey.get(a).label).localeCompare(String(byKey.get(b).label)));
  return { keys, lines: keys.map((k, i) => `${numbered ? numbers.get(k) : i + 1}. ${formatReference(byKey.get(k), referenceStyle)}`) };
}

const manuscriptFigures = (d, blocks = d.blocks || []) => [...blocks, ...headerFooterParts([...blocks.filter(b => b.props?.section).map(b => b.props.section), d.section || {}]).flatMap(p => p.blocks || [])].filter(b => b.type === 'figure');
let figureRequests = new WeakMap();
const figureUrls = new Map(), figureObservers = new Map();
function releaseFigureUrl(img) {
  const pending = figureUrls.get(img); if (!pending) return;
  URL.revokeObjectURL(pending.url); figureUrls.delete(img);
}
function clearFigureLoads() {
  figureRequests = new WeakMap();
  for (const img of figureUrls.keys()) releaseFigureUrl(img);
  for (const observer of figureObservers.values()) observer.disconnect();
  figureObservers.clear();
}
/** Figure images come from the project's files; each is read once per render and shown when ready. */
function loadFigures(host, els) {
  const generation = projectGeneration(), owner = recoveryOwner();
  const figures = manuscriptFigures(doc());
  for (const [oldHost, observer] of figureObservers) if (!oldHost.isConnected) { observer.disconnect(); figureObservers.delete(oldHost); }
  for (const [img, lease] of figureUrls) if (!img.isConnected || !lease.host.isConnected || !lease.host.contains(img)) releaseFigureUrl(img);
  if (typeof MutationObserver !== 'undefined' && !figureObservers.has(host)) {
    const observer = new MutationObserver(() => { for (const [img, lease] of figureUrls) if (lease.host === host && (!img.isConnected || !host.contains(img))) releaseFigureUrl(img); });
    observer.observe(host, { childList: true, subtree: true }); figureObservers.set(host, observer);
  }
  for (const img of els.flatMap(e => [...e.querySelectorAll?.('img[data-img]') || []])) {
    const id = img.dataset.img, request = {}; figureRequests.set(img, request); releaseFigureUrl(img);
    const figure = figures.find(b => b.img === id), originalHash = figure?.fileHash || '';
    const current = () => generation === projectGeneration() && owner === recoveryOwner() && figureRequests.get(img) === request && img.dataset.img === id && img.isConnected && host.isConnected && host.contains(img) && manuscriptFigures(doc()).some(b => b.img === id && (b.fileHash || '') === originalHash);
    (async () => {
      const fileHash = originalHash || (await getFileReference(`img-${id}`, { owner }))?.hash;
      if (!current()) return;
      if (!fileHash) throw new Error('This figure has no verified project-owned image. Reattach or reimport the intended file.');
      const blob = await getFile(`img-${id}`, { owner, expectedHash: fileHash });
      if (!current()) return;
      if (!blob) throw new Error('The saved figure image is unavailable. Reattach or reimport the intended file.');
      const url = URL.createObjectURL(blob); figureUrls.set(img, { url, host });
      img.onload = img.onerror = () => { if (figureUrls.get(img)?.url === url) releaseFigureUrl(img); };
      img.src = url;
    })().catch(error => { if (current()) { img.alt = `Figure unavailable: ${error.message}`; img.title = error.message; } });
  }
}

/** The runs of a block between two source offsets, cutting a text run if needed. */
function splitRuns(b, from, to) {
  const out = []; let at = 0;
  for (const r of withRuns(b).runs) {
    const src = r.cite ? r.cite.map(k => citeToken(k)).join('') : r.t;
    const s0 = at, s1 = at + src.length; at = s1;
    if (s1 <= from || s0 >= to) continue;
    if (r.cite) { out.push({ ...r }); continue; }
    out.push({ ...r, t: r.t.slice(Math.max(0, from - s0), Math.min(r.t.length, to - s0)) });
  }
  return out;
}

/**
 * Scale the pages to the column, as Word does at "page width". The layout is
 * measured at true size; only the display is scaled, so pagination and line
 * numbers are unaffected. CSS zoom keeps the scroll bounds at the displayed
 * page size.
 */
const PAGE_SIDE = 28;   // room for the vertical ruler outside the paper
function fitPages(el) {
  const wrap = el.querySelector('#ms-scroll'), host = el.querySelector('#page');
  if (!wrap || !host) return;
  const pgs = [...host.querySelectorAll('.pg')];
  if (!pgs.length) return;
  // A landscape section's pages are the widest; the column fits those. Line
  // numbers and change bars sit inside the page's own margin, so nothing
  // beside the page is reserved on one side only.
  const pageW = Math.max(...pgs.map(p => p.offsetWidth));
  // The comment column stands at the right; the pages are centred in the rest.
  const reserve = wrap.classList.contains('has-comments') ? COMMENT_W : 0;
  const area = wrap.clientWidth - reserve;
  wrap.dataset.reserve = String(reserve);
  // Fit fills the width less a gutter either side, as Word's page width does.
  const scale = zoom === 'fit' ? Math.min(2, Math.max(0.1, (area - 2 * PAGE_SIDE) / pageW)) : Number(zoom);
  // Centre whenever the page fits; wider pages start a gutter in and scroll.
  const inset = pageW * scale <= area ? (area - pageW * scale) / 2 : PAGE_SIDE;
  // CSS zoom scales the layout box as well as its paint. A transform left
  // the original wide box in the scrollable overflow even at Fit width.
  host.style.transform = 'none';
  host.style.zoom = String(scale);
  host.dataset.pagesFitted = '';   // `#ms-scroll #page[data-pages-fitted]` reads the two properties
  host.style.setProperty('--pages-w', `${pageW}px`);
  host.style.setProperty('--pages-inset', `${inset / scale}px`);
  host.style.paddingLeft = '0';
  // A page wider than the pane (zoomed in) scrolls with the same gutter at its right as at its left.
  wrap.style.setProperty('--pages-end', `${Math.round(inset + pageW * scale)}px`);
  host.parentElement.style.minHeight = '0';
  updatePageRulers(el);
}
let fitRo = null, fitFrame = 0;
/** Arriving from the navigation starts at the document: a sub-page of Submission is left (the shell's openList hook, as Tables and figures does). */
export const openList = () => leaveSubmissionPage();
export function unmount() { mounted = null; fitRo?.disconnect(); cancelAnimationFrame(fitFrame); selectionEvents?.abort(); editorEvents?.abort(); clearTimeout(repaginateT); clearFigureLoads(); document.getElementById('cite-pop')?.remove(); }

/** A block written before runs existed is one run of its text. */
const withRuns = b => (b.runs?.length ? b : { ...b, runs: [{ t: b.text || '' }] });

/**
 * Read a paragraph element back into runs and text. Chips contribute their
 * source token; text nodes contribute text with the formatting of the element
 * they sit in. This is the inverse of renderRun, and the only place the DOM
 * writes to the model.
 */
function serialise(el2, base) {
  const runs2 = [];
  const push = (t, fmt) => {
    if (!t) return;
    const last = runs2[runs2.length - 1];
    if (last && !last.cite && sameFmt(last, fmt)) last.t += t; else runs2.push({ t, ...fmt });
  };
  const walk = (node, fmt) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { push(n.textContent, fmt); continue; }
      if (n.nodeType !== 1) continue;
      // A tracked deletion is kept whole, as it was read.
      if (n.dataset?.del != null) { try { runs2.push(JSON.parse(n.dataset.del)); } catch {} continue; }
      if (n.dataset && 'src' in n.dataset) {
        const src = n.dataset.src;
        if (n.classList.contains('cite') && src.startsWith('[@') && !/\s/.test(src.slice(2, -1)))
          runs2.push({ t: '', cite: [...src.matchAll(/\[@([^\s\]]+)\]/g)].map(m => m[1]), sup: true, ...(fmt.cm ? { cm: fmt.cm } : {}) });
        else push(src, fmt);
        continue;
      }
      if (n.tagName === 'BR') { push('\n', fmt); continue; }
      const f = { ...fmt };
      if (n.tagName === 'SUP') f.sup = true;
      if (n.tagName === 'SUB') f.sub = true;
      if (n.tagName === 'B' || n.tagName === 'STRONG') f.b = true;
      if (n.tagName === 'I' || n.tagName === 'EM') f.i = true;
      if (n.tagName === 'U') f.u = true;
      if (n.tagName === 'S' || n.tagName === 'STRIKE') f.strike = true;
      if (n.tagName === 'INS' && n.dataset?.ins) { try { f.ins = JSON.parse(n.dataset.ins); } catch {} }
      if (n.dataset?.cm) f.cm = n.dataset.cm.split(' ').filter(Boolean);
      if (n.dataset?.fmtchange) { try { f.fmtChange = JSON.parse(n.dataset.fmtchange); } catch {} }
      const st = n.style;
      if (st?.fontWeight === '700' || st?.fontWeight === 'bold') f.b = true;
      if (st?.fontWeight === '400') f.b = false;
      if (st?.fontStyle === 'italic') f.i = true;
      if (st?.fontStyle === 'normal') f.i = false;
      if (st?.textDecoration?.includes('underline')) f.u = true;
      if (st?.textDecoration?.includes('line-through')) f.strike = true;
      if (st?.fontVariant === 'small-caps') f.smallCaps = true;
      if (st?.textTransform === 'uppercase') f.caps = true;
      if (st?.backgroundColor) { const h = Object.entries(HIGHLIGHT_CSS).find(([, v]) => v === st.backgroundColor)?.[0]; if (h) f.highlight = h; }
      if (st?.color) f.color = rgbToHex(st.color) || fmt.color;
      if (st?.fontFamily) f.font = st.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (st?.fontSize) f.sz = Math.round(parseFloat(st.fontSize) / (96 / 72) * 2) / 2;
      walk(n, f);
    }
  };
  walk(el2, {});
  // A trailing line break is the browser's placeholder for an empty line, not text.
  const lastText = [...runs2].reverse().find(r => !r.cite && !r.del);
  if (lastText) lastText.t = lastText.t.replace(/\n+$/, '');
  const kept = runs2.filter(r => r.cite || r.del || r.t);
  const text = kept.map(r => (r.cite ? r.cite.map(k => citeToken(k)).join('') : r.del ? '' : r.t)).join('');
  return { runs: kept.length ? kept : [{ t: '' }], text };
}
const FMT = ['font', 'sz', 'b', 'i', 'u', 'strike', 'color', 'highlight', 'sup', 'sub', 'caps', 'smallCaps', 'ins', 'cm', 'fmtChange'];
const sameFmt = (a, b) => !a.del && !b.del && FMT.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
const rgbToHex = c => {
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
};

/** Source offsets count citation chips by their saved token, not their displayed number. */
const isAtom = node => node.nodeType === 1 && !!node.dataset && 'src' in node.dataset;
function sourceLength(node) {
  if (node.nodeType === 3) return node.textContent.length;
  if (isAtom(node)) return node.dataset.src.length;
  if (node.nodeName === 'BR') return 1;
  return [...node.childNodes].reduce((n, child) => n + sourceLength(child), 0);
}
function offsetAt(box, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(box); range.setEnd(node, offset);
  return prefixOf(box) + sourceLength(range.cloneContents());
}
// A paragraph that runs over a page break is drawn as several .mb-edit parts
// with the same data-b; offsets count from the start of the whole paragraph.
const partsOf = box => {
  const page = box.closest('#page');
  return page ? [...page.querySelectorAll(`.mb-edit[data-b="${CSS.escape(box.dataset.b)}"]`)] : [box];
};
function prefixOf(box) {
  let n = 0;
  for (const part of partsOf(box)) { if (part === box) break; n += sourceLength(part); }
  return n;
}
/** The paragraph element holding a node, or null outside the document's paragraphs. */
/** A heading as a reader names it: citation and result tokens left out. */
const headingText = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();

/**
 * The chip right beside a collapsed caret, looking back (Backspace) or ahead
 * (Delete). A chip is not editable, so WebKit will not delete it on its own.
 */
function chipBeside(box, back) {
  const sel = getSelection(); if (!sel?.rangeCount || !sel.isCollapsed) return null;
  let node = sel.anchorNode, off = sel.anchorOffset;
  const blank = n => n.nodeType === 3 && !n.data.replace(/\u200b/g, '').length;
  if (node.nodeType === 3) {
    const rest = back ? node.data.slice(0, off) : node.data.slice(off);
    if (rest.replace(/\u200b/g, '').length) return null;
    node = back ? node.previousSibling : node.nextSibling;
  } else node = node.childNodes[back ? off - 1 : off];
  while (node && blank(node)) node = back ? node.previousSibling : node.nextSibling;
  const chip = node?.nodeType === 1 && (node.matches('.tok[data-src]') ? node : null);
  return chip && box.contains(chip) ? chip : null;
}

const boxOf = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.mb-edit') || null;
function textSelection(page) {
  const selection = getSelection();
  return selection?.rangeCount ? rangeSelection(page, selection.getRangeAt(0)) : null;
}
/** A DOM range as paragraph positions: { start: { id, at }, end: { id, at } }. */
function rangeSelection(page, range) {
  if (!page.contains(range.startContainer) || !page.contains(range.endContainer)) return null;
  const boxes = [...page.querySelectorAll('.mb-edit')].filter(box => range.intersectsNode(box));
  if (!boxes.length) return null;
  const first = boxes[0], last = boxes.at(-1);
  return {
    start: { id:first.dataset.b, at:first.contains(range.startContainer) ? offsetAt(first,range.startContainer,range.startOffset) : prefixOf(first) },
    end: { id:last.dataset.b, at:last.contains(range.endContainer) ? offsetAt(last,range.endContainer,range.endOffset) : prefixOf(last) + sourceLength(last) },
  };
}
function pointAt(box, offset) {
  let remaining = offset;
  const walk = parent => {
    for (const node of parent.childNodes) {
      const length = sourceLength(node);
      if (node.nodeType === 3 && remaining <= length) return [node, remaining];
      if (isAtom(node) || node.nodeName === 'BR') {
        if (remaining < length || (remaining === length && length > 0)) return [parent, [...parent.childNodes].indexOf(node) + (remaining ? 1 : 0)];
      } else if (node.nodeType === 1 && remaining <= length) return walk(node);
      remaining -= length;
    }
    return [parent, parent.childNodes.length];
  };
  return walk(box);
}
/** The DOM point for a paragraph offset, in whichever part of the paragraph holds it. */
function blockPoint(page, id, at) {
  const parts = [...page.querySelectorAll(`.mb-edit[data-b="${CSS.escape(id)}"]`)];
  for (const [k, part] of parts.entries()) {
    const length = sourceLength(part);
    if (at <= length || k === parts.length - 1) return pointAt(part, Math.min(at, length));
    at -= length;
  }
  return null;
}
function restoreTextSelection(page, saved) {
  const start = blockPoint(page, saved.start.id, saved.start.at), end = blockPoint(page, saved.end.id, saved.end.at);
  if (!start || !end) return;
  page.focus({preventScroll:true});
  const range = document.createRange();
  range.setStart(...start); range.setEnd(...end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
}

/** Source-text offset of the caret in its paragraph, counting chips by their token. */
function sourceOffset(box) {
  const sel = getSelection();
  if (!sel?.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  return box.contains(r.endContainer) ? offsetAt(box, r.endContainer, r.endOffset) : 0;
}

// ---- the document ---------------------------------------------------------

const placeholderFor = t =>
  t === 'h1' ? 'Title' : t === 'h2' ? 'Heading' : t === 'h3' ? 'Subheading' : '';

const shortCite = (p, locator) => {
  const first = (authorLine(p.authors) || p.label || '').split(' ')[0];
  const y = p.year ? `, ${p.year}` : '';
  return `(${first || p.label}${y}${locator ? `, ${locator}` : ''})`;
};

function wireEditor(el, ctx) {
  const page = el.querySelector('#page');
  if (!page) return;

  // A press on bare paper types where a writer expects: into the paragraph
  // level with the pointer, at its end, or after the last one when below it.
  page.addEventListener('mousedown', e => {
    if (!e.target.matches('#page,.pg,.pg-body,.pg-ln,.ms-pages')) return;
    e.preventDefault();
    const edits = [...page.querySelectorAll('.mb-edit')];
    if (!edits.length) return;
    const near = edits.find(x => x.getBoundingClientRect().bottom >= e.clientY) || edits.at(-1);
    (near.isContentEditable && near.closest('[contenteditable]') || near).focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(near);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  });

  page.addEventListener('click', e => {
    page.querySelectorAll('.mb-obj.picked').forEach(x => x.classList.remove('picked'));
    const obj = e.target.closest?.('.mb-figure,.mb-toc,.mb-bib');
    if (obj && !e.target.closest('[data-goto]')) { obj.classList.add('picked'); caretBlock = obj.dataset.b; page.focus({ preventScroll: true }); }
    const go = e.target.closest?.('.mb-toc [data-goto]');
    if (go) { const h = page.querySelector(`.mb-edit[data-b="${CSS.escape(go.dataset.goto)}"]`); h?.scrollIntoView({ block: 'center' }); if (h) restoreTextSelection(page, { start: { id: go.dataset.goto, at: 0 }, end: { id: go.dataset.goto, at: 0 } }); return; }
    const note = e.target.closest?.('.tok.note[data-note]');
    if (note) { const box = page.querySelector(`.mb-note[data-note="${CSS.escape(note.dataset.note)}"]`); if (box) { box.scrollIntoView({ block: 'center' }); box.focus(); const r = document.createRange(); r.selectNodeContents(box); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); } return; }
    const cm = e.target.closest?.('.tok.comment[data-comment]');
    if (cm) { focusComment(el, cm.dataset.comment); return; }
    const span = e.target.closest?.('.tc-cm[data-cm]');
    if (span) focusComment(el, span.dataset.cm.split(' ')[0]);
    const xr = e.target.closest?.('.tok.xref[data-xref]');
    if (xr) { page.querySelector(`.mb-edit[data-b="${CSS.escape(xr.dataset.xref)}"]`)?.scrollIntoView({ block: 'center' }); return; }
    const token = e.target.closest?.('.tok.res[data-result]');
    if (!token) return;
    const key = token.dataset.result;
    if (key.startsWith('pooled.') || key.startsWith('survival.') || key.startsWith('cox.')) {
      focusResult(key); ctx.go('analysis');
    } else if (key.startsWith('prisma.')) ctx.go('reporting');
    else if (key.startsWith('ipd.')) ctx.go('patients');
    else if (key.startsWith('appraisal.')) ctx.go('appraisal');
    else if (key.startsWith('certainty.')) ctx.go('certainty');
  });

  // Typing writes text only. No re-render: the caret lives in this DOM. Each
  // paragraph the edit touched is read back whole, all its page parts at once.
  const readBack = id => {
    const parts = [...page.querySelectorAll(`.mb-edit[data-b="${CSS.escape(id)}"]`)];
    if (!parts.length) return;
    let source = parts[0];
    if (parts.length > 1) {
      source = document.createElement('div');
      for (const part of parts) source.append(...[...part.childNodes].map(n => n.cloneNode(true)));
    }
    const { runs: rs, text } = serialise(source);
    update(s => { const b = s.manuscript.blocks.find(x => x.id === id); if (b) { b.runs = rs; b.text = text; } return s; });
  };
  // A table cell and a note are editing hosts of their own inside the page.
  const readBackCell = box => {
    const { runs: rs, text } = serialise(box);
    update(s => {
      const b = s.manuscript.blocks.find(x => x.id === box.dataset.b);
      const cell = b?.grid?.rows[+box.dataset.r]?.cells[+box.dataset.c];
      if (!cell || cell.merged) return s;
      cell.runs = rs; cell.text = text; b.text = tableText(b.grid);
      return s;
    });
  };
  // A footnote continued onto the next page is drawn in parts; it is read back whole.
  const noteParts = box => [...page.querySelectorAll(`.mb-note[data-note="${CSS.escape(box.dataset.note)}"]`)];
  const readBackNote = box => {
    const parts = noteParts(box);
    let source = box;
    if (parts.length > 1) { source = document.createElement('div'); for (const part of parts) source.append(...[...part.childNodes].map(n => n.cloneNode(true))); }
    const { runs: rs, text } = serialise(source);
    update(s => { const n = s.manuscript.notes?.[box.dataset.note]; if (n) { n.runs = rs; n.text = text; } return s; });
  };
  const subBox = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.mb-cell,.mb-note') || null;
  const rememberSub = box => {
    const sel = getSelection();
    let at = sel?.rangeCount && box.contains(sel.focusNode) ? offsetAt(box, sel.focusNode, sel.focusOffset) : 0;
    // In a later part of a continued note the offset counts from the note's start.
    if (box.dataset.note) for (const part of noteParts(box)) { if (part === box) break; at += sourceLength(part); }
    focusCell = box.dataset.note ? { note: box.dataset.note, at } : { id: box.dataset.b, r: +box.dataset.r, c: +box.dataset.c, at };
  };
  page.addEventListener('input', e => {
    const sub = subBox(e.target) || subBox(getSelection()?.focusNode);
    if (sub && page.contains(sub)) {
      layoutDirty = true;
      if (sub.classList.contains('mb-cell')) readBackCell(sub); else readBackNote(sub);
      clearTimeout(repaginateT);
      repaginateT = setTimeout(() => { if (!getSelection()?.isCollapsed) return; const now = subBox(getSelection()?.focusNode); if (now) rememberSub(now); ctx.rerender(); }, 900);
      return;
    }
    const ids = new Set(), own = boxOf(e.target), sel = getSelection();
    if (own) ids.add(own.dataset.b);
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      if (sel.isCollapsed) { const b = boxOf(sel.focusNode); if (b) ids.add(b.dataset.b); }
      else page.querySelectorAll('.mb-edit').forEach(b => { if (range.intersectsNode(b)) ids.add(b.dataset.b); });
    }
    ids.forEach(readBack);
    layoutDirty = true;
    // Repaginate after typing pauses, not per keystroke, and keep the caret.
    clearTimeout(repaginateT);
    repaginateT = setTimeout(() => {
      // A delayed page layout must not collapse a selection made after typing.
      const selection = getSelection();
      if (selection && !selection.isCollapsed) return;
      const box = boxOf(selection?.focusNode);
      if (box && page.contains(box)) { focusId = box.dataset.b; focusAt = sourceOffset(box); }
      ctx.rerender();
    }, 900);
  });

  // Paste, cut and any edit reaching across paragraphs go through the model:
  // a browser edit there would merge or split paragraph elements behind the
  // model's back, and pasted HTML (Word, web pages) is not ours to keep. The
  // text lands with the formatting at the caret, like Word's "keep text only".
  const replaceSelection = (saved, text) => {
    clearTimeout(repaginateT); typingFormat = null;
    const before = structuredClone(blocksOf());
    // While changes are tracked, the selection is marked deleted and the new text inserted.
    const change = tracking();
    const collapsed = saved.start.id === saved.end.id && saved.start.at === saved.end.at;
    const base = change && !collapsed ? trackDelete(before, saved.start, saved.end, change) : before;
    const done = replaceTextRange(base, saved.start, change ? saved.start : saved.end, text, () => blankBlock().id, change && text ? { ins: change } : null);
    if (!done) return;
    update(s => { s.manuscript.blocks = done.blocks; return s; });
    formatUndo.push({project:projects().current,before,after:structuredClone(blocksOf()),selection:saved});
    if (formatUndo.length > 30) formatUndo.shift();
    formatRedo.length = 0;
    focusId = null; selectionAfterRender = { start: done.caret, end: done.caret };
    ctx.rerender();
  };
  const spansBlocks = s => s && s.start.id !== s.end.id;
  page.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    // In a cell or a note, the text arrives as text, at the caret.
    const inSub = subBox(getSelection()?.focusNode);
    if (inSub) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!(inSub.classList.contains('mb-cell') && tracking() && trackCellInput({ inputType: 'insertText', data: text, preventDefault() {} }, inSub))) document.execCommand('insertText', false, text);
      return;
    }
    const saved = textSelection(page);
    if (!saved) return;
    e.preventDefault();
    const plain = e.clipboardData.getData('text/plain'), html = e.clipboardData.getData('text/html');
    // Text copied from this editor carries its tokens in the plain form; that is the one to keep.
    const own = /\[@[^\]]+\]|\{\{[A-Za-z0-9._:-]+\}\}/.test(plain) || /class="(?:para|mb-edit)/.test(html);
    if (html && !own) {
      let paras = [];
      try { paras = htmlToParagraphs(new DOMParser().parseFromString(html, 'text/html')); } catch {}
      if (paras.length) { pasteParagraphs(saved, paras); return; }
    }
    // Cells copied from a spreadsheet as plain text are a table too.
    const tsv = !own && !html && tsvTable(plain);
    if (tsv) { pasteParagraphs(saved, [tsv]); return; }
    replaceSelection(saved, plain);
  });
  // Formatted paste: paragraphs with their emphasis, headings and list items (Word's "merge formatting").
  const pasteParagraphs = (saved, paras) => {
    commitDoc(ctx, m => {
      const lists = { ...(m.lists || {}) }, made = {};
      const listFor = kind => made[kind] ||= (() => { const t = toggleList({ blocks: [{ id: 'x', type: 'p', props: {} }], lists: {} }, ['x'], kind); const id = t.blocks[0].props.list.id; lists[id] = t.lists[id]; return id; })();
      const change = tracking();
      if (change && (saved.start.id !== saved.end.id || saved.start.at !== saved.end.at)) { m.blocks = trackDelete(m.blocks, saved.start, saved.end, change); saved = { start: saved.start, end: saved.start }; }
      const done = replaceWithParagraphs(m.blocks, saved.start, saved.end, paras, () => blankBlock().id, listFor, change ? { ins: change } : null);
      if (!done) return null;
      m.blocks = done.blocks; m.lists = lists;
      caret = done.caret;
      return m;
    }, () => caret && { start: caret, end: caret });
  };
  let caret = null;
  // Typing and deleting in a table cell while tracking: typed text is the
  // author's insertion, deleted text is marked, as in a paragraph. Returns
  // whether the edit was taken over (the browser's own edit then does nothing).
  const trackCellInput = (e, box) => {
    const change = tracking();
    const insert = /^insert(Text|ReplacementText|LineBreak|Paragraph)$/.test(e.inputType), remove = /^delete/.test(e.inputType);
    if (!insert && !remove) return false;
    const sel = getSelection();
    if (!sel?.rangeCount) return false;
    const target = e.getTargetRanges?.()[0], range = sel.getRangeAt(0);
    const [sc, so, ec, eo] = target ? [target.startContainer, target.startOffset, target.endContainer, target.endOffset] : [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
    if (!box.contains(sc) || !box.contains(ec)) { e.preventDefault(); return true; }
    let from = offsetAt(box, sc, so), to = offsetAt(box, ec, eo);
    if (to < from) [from, to] = [to, from];
    const collapsed = from === to;
    const text = /LineBreak|Paragraph/.test(e.inputType) ? '\n' : insert ? e.data ?? e.dataTransfer?.getData('text/plain') ?? '' : '';
    // Inside the author's own insertion a typed character needs nothing more.
    if (insert && collapsed && text !== '\n') {
      const f = sel.focusNode, own = (f?.nodeType === 1 ? f : f?.parentElement)?.closest?.('ins.tc-ins');
      let mine = false; try { mine = own && box.contains(own) && JSON.parse(own.dataset.ins).author === change.author; } catch {}
      if (mine) return false;
    }
    e.preventDefault();
    const cell = blocksOf().find(x => x.id === box.dataset.b)?.grid?.rows[+box.dataset.r]?.cells[+box.dataset.c];
    if (!cell || cell.merged) return true;
    if (remove && collapsed && !target) { if (/Backward/.test(e.inputType)) { if (from <= 0) return true; from--; } else { if (to >= (cell.text || '').length) return true; to++; } }
    if (remove && from === to) return true;
    const r = +box.dataset.r, c = +box.dataset.c, id = box.dataset.b;
    focusCell = { id, r, c, at: from + text.length };
    commitDoc(ctx, m => { m.blocks = m.blocks.map(b => b.id === id && b.grid ? trackCellEdit(b, r, c, from, to, text, change) : b); return m; }, null);
    return true;
  };
  // The browser names the range an edit will change (a word deleted with
  // Option, a line with Cmd, dictation, an emoji); when that range reaches
  // across paragraphs, or lies outside every paragraph, the model does it.
  page.addEventListener('beforeinput', e => {
    if (e.isComposing || !/^(insert|delete)/.test(e.inputType) || e.inputType === 'insertFromPaste') return;
    if (/^(insertFromDrop|deleteByDrag)$/.test(e.inputType)) { e.preventDefault(); return; }
    // Cells and notes edit in place; a new paragraph there is a line break.
    const sub = subBox(e.target) || subBox(getSelection()?.focusNode);
    if (sub) {
      if (sub.classList.contains('mb-cell') && tracking() && trackCellInput(e, sub)) return;
      if (e.inputType === 'insertParagraph') { e.preventDefault(); document.execCommand('insertLineBreak'); }
      return;
    }
    const target = e.getTargetRanges?.()[0];
    let saved = textSelection(page);
    if (target) {
      const range = document.createRange();
      range.setStart(target.startContainer, target.startOffset); range.setEnd(target.endContainer, target.endOffset);
      saved = rangeSelection(page, range) || saved;
    }
    if (!saved) { e.preventDefault(); return; }
    // Tracked editing: typed text goes in as the author's insertion; deleted text is marked, not removed.
    const change = tracking();
    if (change && /^insert(Text|ReplacementText)$/.test(e.inputType)) {
      const collapsed = saved.start.id === saved.end.id && saved.start.at === saved.end.at;
      const f = getSelection()?.focusNode, own = (f?.nodeType === 1 ? f : f?.parentElement)?.closest?.('ins.tc-ins');
      let mine = false; try { mine = own && JSON.parse(own.dataset.ins).author === change.author; } catch {}
      if (collapsed && mine) return;   // already inside the author's own insertion: type as usual
      e.preventDefault();
      const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      if (collapsed) document.execCommand('insertHTML', false, `<ins class="tc-ins" data-ins="${esc(JSON.stringify(change))}">${esc(data)}</ins>`);
      else replaceSelection(saved, data);
      return;
    }
    if (change && /^delete/.test(e.inputType)) {
      e.preventDefault();
      let r = saved;
      if (r.start.id === r.end.id && r.start.at === r.end.at) {
        const b = blocksOf().find(x => x.id === r.start.id);
        if (/Backward/.test(e.inputType)) { if (r.start.at <= 0) return; r = { start: { id: r.start.id, at: r.start.at - 1 }, end: r.end }; }
        else { if (!b || r.end.at >= b.text.length) return; r = { start: r.start, end: { id: r.end.id, at: r.end.at + 1 } }; }
      }
      commitDoc(ctx, m => { m.blocks = trackDelete(m.blocks, r.start, r.end, change); return m; }, { start: r.start, end: r.start });
      return;
    }
    if (!spansBlocks(saved)) return;
    e.preventDefault();
    replaceSelection(saved, /^insert(Paragraph|LineBreak)$/.test(e.inputType) ? '\n'
      : e.inputType.startsWith('insert') ? e.data || e.dataTransfer?.getData('text/plain') || '' : '');
  });
  page.addEventListener('cut', e => {
    const saved = textSelection(page);
    if (!saved || !copySelection(e)) return;
    replaceSelection(saved, '');
  });
  page.addEventListener('copy', copySelection);
  function copySelection(e) {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !e.clipboardData) return false;
    const range = selection.getRangeAt(0);
    if (!page.contains(range.startContainer) || !page.contains(range.endContainer)) return false;
    const parts = [];
    for (const box of page.querySelectorAll('.mb-edit')) {
      if (!range.intersectsNode(box)) continue;
      const slice = document.createRange();
      slice.selectNodeContents(box);
      if (box.contains(range.startContainer)) slice.setStart(range.startContainer, range.startOffset);
      if (box.contains(range.endContainer)) slice.setEnd(range.endContainer, range.endOffset);
      const paragraph = document.createElement('div');
      paragraph.append(slice.cloneContents());
      parts.push(paragraph);
    }
    if (!parts.length) return false;
    e.preventDefault();
    // Plain text carries citation and result tokens, so a paste back here keeps them.
    e.clipboardData.setData('text/plain', parts.map(p => {
      const plain = p.cloneNode(true);
      plain.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      plain.querySelectorAll('[data-src]').forEach(t => t.replaceWith(t.dataset.src));
      return plain.textContent;
    }).join('\n'));
    e.clipboardData.setData('text/html', parts.map(p => p.outerHTML).join(''));
    return true;
  }

  // A citation mark answers on hover with the papers it cites, and lets one
  // be taken out of the group; the model changes through the same input path
  // as typing, so undo, repagination and numbering all follow.
  const pop = citePopover(ctx);
  page.addEventListener('mouseover', e => {
    const sup = e.target.closest?.('.tok.cite'); if (!sup || pop.pinnedTo) return;
    pop.show(sup, false);
  });
  page.addEventListener('mouseout', e => {
    const sup = e.target.closest?.('.tok.cite'); if (!sup || pop.pinnedTo) return;
    if (!pop.el.contains(e.relatedTarget)) pop.hide();
  });
  page.addEventListener('click', e => {
    const sup = e.target.closest?.('.tok.cite'); if (!sup) return;
    e.preventDefault(); pop.show(sup, true);
  });
  editorEvents?.abort(); editorEvents = new AbortController();
  document.addEventListener('mousedown', e => { if (pop.pinnedTo && !pop.el.contains(e.target) && !e.target.closest?.('.tok.cite')) pop.hide(); }, { capture: true, signal: editorEvents.signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop.pinnedTo) pop.hide(); }, { signal: editorEvents.signal });

  page.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z' && undoFormatting(e.shiftKey, ctx)) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey, key = e.key.toLowerCase();
    // Word's keys: find, replace, page break, strikethrough, super- and subscript.
    if (mod && !e.shiftKey && key === 'f') { e.preventDefault(); e.stopPropagation(); openFind(el, ctx, false); return; }
    if (mod && e.shiftKey && key === 'h') { e.preventDefault(); e.stopPropagation(); openFind(el, ctx, true); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runCommand(el, ctx, 'pageBreak'); return; }
    if (mod && e.shiftKey && key === 'x') { e.preventDefault(); e.stopPropagation(); runCommand(el, ctx, 'strike'); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); e.stopPropagation(); runCommand(el, ctx, e.shiftKey || e.key === '+' ? 'sup' : 'sub'); return; }
    // A selected figure or contents block goes with Delete or Backspace.
    const picked = page.querySelector('.mb-obj.picked');
    if (picked && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); runCommand(el, ctx, 'deleteObject', picked.dataset.b); return; }
    const sub = subBox(getSelection()?.focusNode);
    if (sub && page.contains(sub)) {
      if (mod && ['b', 'i', 'u'].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (sub.classList.contains('mb-cell')) { toggleCharacter(el, ctx, key); return; }
        document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[key], false, null);
        sub.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (!(sub.classList.contains('mb-cell') && tracking() && trackCellInput({ inputType: 'insertLineBreak', preventDefault() {} }, sub))) document.execCommand('insertLineBreak');
        return;
      }
      if (e.key === 'Tab' && sub.classList.contains('mb-cell')) { e.preventDefault(); moveCell(page, sub, e.shiftKey ? -1 : 1, ctx); return; }
      if (mod && key === 'a') {
        e.preventDefault(); e.stopPropagation();
        const r = document.createRange(); r.selectNodeContents(sub);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      }
      return;
    }
    // Tab changes a list item's level; elsewhere it is a tab character.
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const saved = textSelection(page);
      if (saved) {
        const ids = idsBetween(blocksOf(), saved.start.id, saved.end.id);
        const b = blocksOf().find(x => x.id === ids[0]);
        e.preventDefault();
        if (b?.props?.list) commitDoc(ctx, m => shiftListLevel(m, ids, e.shiftKey ? -1 : 1), saved);
        else if (!e.shiftKey) replaceSelection(saved, '\t');
        return;
      }
    }
    // Enter on an empty list item ends the list, as in Word.
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) {
      const saved = textSelection(page);
      const b = saved && saved.start.id === saved.end.id ? blocksOf().find(x => x.id === saved.start.id) : null;
      if (b?.props?.list && !b.text.trim()) { e.preventDefault(); commitDoc(ctx, m => shiftListLevel(m, [b.id], -99), saved); return; }
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      const paragraphs = page.querySelectorAll('.mb-edit');
      if (!paragraphs.length) return;
      e.preventDefault(); e.stopPropagation();
      clearTimeout(repaginateT);
      const range = document.createRange();
      range.setStart(paragraphs[0], 0);
      const last = paragraphs[paragraphs.length - 1];
      range.setEnd(last, last.childNodes.length);
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      return;
    }
    if (!e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(e.key))) {
      const saved = textSelection(page);
      // Enter splits the paragraph (a heading's next line is a paragraph), replacing any selection.
      if (spansBlocks(saved) || (saved && e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        replaceSelection(saved, e.key === 'Enter' ? '\n' : e.key.length === 1 ? e.key : '');
        return;
      }
    }
    const box = boxOf(getSelection()?.focusNode);
    if (!box || !page.contains(box)) return;
    const id = box.dataset.b;
    const collapsed = getSelection().isCollapsed;

    // Backspace or Delete beside a citation or result chip removes the chip's token.
    if ((e.key === 'Backspace' || e.key === 'Delete') && collapsed) {
      const chip = chipBeside(box, e.key === 'Backspace');
      const b = chip && blocksOf().find(x => x.id === id);
      if (b) {
        const at = sourceOffset(box), src = chip.dataset.src;
        const from = e.key === 'Backspace' ? at - src.length : at;
        if (b.text.slice(from, from + src.length) === src) {
          e.preventDefault();
          replaceSelection({ start: { id, at: from }, end: { id, at: from + src.length } }, '');
          return;
        }
      }
    }
    // Delete at a paragraph's end joins the next one to it, as in Word.
    if (e.key === 'Delete' && collapsed) {
      const bs = blocksOf(), i = bs.findIndex(b => b.id === id);
      if (i >= 0 && i < bs.length - 1 && sourceOffset(box) >= bs[i].text.length) {
        e.preventDefault();
        if (!isParagraph(bs[i + 1])) return;
        replaceSelection({ start: { id, at: bs[i].text.length }, end: { id: bs[i + 1].id, at: 0 } }, '');
        return;
      }
    }
    if (e.key === 'Backspace' && collapsed && sourceOffset(box) === 0) {
      clearTimeout(repaginateT);
      const bs = blocksOf();
      const i = bs.findIndex(b => b.id === id);
      // The first Backspace at the start of a list item takes away its number.
      if (bs[i]?.props?.list) { e.preventDefault(); commitDoc(ctx, m => shiftListLevel(m, [id], -99), { start: { id, at: 0 }, end: { id, at: 0 } }); return; }
      if (i <= 0) return;
      e.preventDefault();
      const prev = bs[i - 1];
      // A table, figure or contents block before is not merged into; an empty paragraph after it goes.
      if (!isParagraph(prev)) {
        if (!bs[i].text.trim() && bs.length > 1) commitDoc(ctx, m => { m.blocks = m.blocks.filter(x => x.id !== id); return m; }, null);
        return;
      }
      // Joining goes through the undo stack; while tracking, the mark is recorded as deleted.
      const change = tracking(), joinAt = prev.text.length;
      const caretAt = change && !(prev.props?.markIns?.author === change.author) ? { id, at: 0 } : { id: prev.id, at: joinAt };
      commitDoc(ctx, m => { m.blocks = change ? trackJoin(m.blocks, prev.id, change) : joinWithNext(m.blocks, i - 1); return m; },
        { start: caretAt, end: caretAt });
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      // Stopped here so the shell's own keys never see it (the inspector is ⌥⌘I).
      e.preventDefault(); e.stopPropagation();
      toggleCharacter(el, ctx, e.key.toLowerCase());
      return;
    }
    // Alt+Up/Down moves a block; the arrows alone still move the caret.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1, at = sourceOffset(box);
      commitDoc(ctx, m => {
        const i = m.blocks.findIndex(b => b.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= m.blocks.length) return null;
        [m.blocks[i], m.blocks[j]] = [m.blocks[j], m.blocks[i]];
        return m;
      }, { start: { id, at }, end: { id, at } });
    }
  });
}

/** Rewrite the resolved line under the caret without touching the editable. */
function paintRender(box, text) {
  const wrap = box.closest('.mb');
  const line = wrap.querySelector('.mb-render');
  const marks = [...citations(text), ...resultTokens(text)];
  // While typing, the resolved line only needs to say whether tokens are
  // present; a full re-resolve on every keystroke is work nobody sees.
  line.hidden = !marks.length;
}

const writeBlock = (id, text) => update(s => {
  const b = s.manuscript.blocks.find(x => x.id === id);
  if (b) b.text = text;
  return s;
});

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Garamond', 'Helvetica', 'Palatino'];
/** The paragraph styles a document brought with it, by name; a document without styles keeps the plain levels. */
function docStyles(d) {
  const by = d?.styles?.byId;
  if (!by) return BLOCK_TYPES;
  const used = new Set((d.blocks || []).map(b => b.styleId).filter(Boolean));
  const list = Object.entries(by).filter(([id, v]) => used.has(id) || /^(Normal|Title|Subtitle|Heading[1-4]|BodyText|FirstParagraph|Quote|Caption)$/.test(id))
    .map(([id, v]) => ({ id, label: v.name || id }));
  return list.sort((a, b) => (a.id === 'Normal' ? -1 : b.id === 'Normal' ? 1 : a.label.localeCompare(b.label)));
}
/** The common fonts plus every font the document's runs and styles already use. */
function docFonts(d) {
  const set = new Set(FONTS);
  for (const b of d?.blocks || []) for (const r of b.runs || []) if (r.font) set.add(r.font);
  for (const v of Object.values(d?.styles?.byId || {})) if (v.run?.font) set.add(v.run.font);
  if (d?.styles?.default?.run?.font) set.add(d.styles.default.run.font);
  return [...set].sort();
}

/** The one popover for citation marks: which papers, and a way to drop one. */
/**
 * A citation's references, each with the number (or author–year label) it
 * has in the text and the reference list, in a column of their own; actions
 * per reference in a small menu. Kept inside the window: below the mark, or
 * above it when there is no room, and shifted left from the right edge.
 */
/** The inspector open on Cite, at the page of the reference list that holds `key`, its row focused (a citation's Go to reference in list). */
function showInRail(key) {
  pick = ''; revealKey = key;
  if (shownCtx) openTool(shownCtx, 'cite');
}

function citePopover(ctx) {
  let el = document.getElementById('cite-pop');
  if (!el) { el = document.createElement('div'); el.id = 'cite-pop'; el.className = 'cite-pop'; el.hidden = true; document.body.append(el); }
  const pop = { el, pinnedTo: null,
    hide() { el.hidden = true; pop.pinnedTo = null; },
    show(sup, pin) {
      const byKey = new Map(get().papers.map(p => [p.key, p]));
      // [@key] or [@key p. 12]: the key and the place cited in it
      const cites = [...sup.dataset.src.matchAll(/\[@([^\s\]]+)(?:\s+([^\]]*))?\]/g)].map(m => ({ key: m[1], locator: (m[2] || '').trim() }));
      const keys = cites.map(c => c.key), locatorOf = k => cites.find(c => c.key === k)?.locator || '';
      const numbers = numbering(blocksOf(), withPackage(get(), blocksOf(), doc())), numbered = citationStyle() === 'numbered';
      const order = numbered ? [...keys].sort((a, b) => (numbers.get(a) ?? 1e9) - (numbers.get(b) ?? 1e9)) : keys;
      el.classList.toggle('cite-pop-ay', !numbered);
      const SEP = '<span class="ui-row-sep" aria-hidden="true"></span>';
      // A reference is a row of a list: pressing it (or Enter) opens the paper; its More holds the rest.
      const rows = order.map(k => {
        const p = byKey.get(k);
        const mark = numbered ? String(numbers.get(k) ?? '') : p ? inText(p) : '';
        const title = p ? p.title || 'Title not recorded' : 'Not in the library';
        // who and where give way; the year stays (as in Cite)
        const who = p ? [authorLine(p.authors), p.journalAbbr || p.journal].filter(Boolean).map(esc).join(SEP) : esc(k);
        const meta = `${who ? `<span class="cite-pop-who">${who}</span>` : ''}${p?.year ? `<span class="cite-pop-year">${who ? SEP : ''}${esc(p.year)}</span>` : ''}`;
        return uiRow({ cls: 'cite-pop-ref', attrs: { 'data-cite-open': k, tabindex: p ? 0 : undefined, 'aria-label': p ? `Open ${mark ? `${mark}. ` : ''}${title}` : undefined, 'data-missing': p ? undefined : 'true' },
          main: { html: `<span class="cite-pop-ref-main"><span class="cite-pop-n">${esc(mark)}</span><span class="cite-pop-title" title="${esc(title)}">${esc(title)}</span><span class="cite-pop-meta">${meta}</span></span>` },
          end: uiRowEnd({ more: { label: `Actions for reference ${mark || k}`, attrs: { 'data-ref-menu': k } } }) });
      });
      const head = uiBar({ kind: 'head', label: 'Citation', id: 'cite-pop-bar', lead: { title: `${keys.length} ${keys.length === 1 ? 'reference' : 'references'}`, level: 'h3' },
        actions: [{ id: 'cite-pop-close', label: 'Close citation', icon: 'close', role: 'quiet', plain: true, presence: 'reserve', keep: true }] });
      el.innerHTML = uiList({ id: 'cite-pop-list', label: 'References in this citation', head, rows, attrs: { 'data-cite-pop': true } });
      el.querySelector('#cite-pop-close').onclick = () => pop.hide();
      // Where the person was, so coming back to the manuscript puts the caret after this citation and the page where it was.
      const remember = () => {
        const box = sup.closest('.mb-edit');
        if (box) { const r = document.createRange(); r.setStartAfter(sup); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); focusId = box.dataset.b; focusAt = sourceOffset(box); }
        returnScroll = document.querySelector('#ms-scroll')?.scrollTop ?? null;
      };
      const pageOf = k => { const m = /\d+/.exec(locatorOf(k)); return m ? Number(m[0]) : null; };
      // The paper: its PDF in the reader beside the manuscript (at the cited page), else its record in the Library; with
      // Command or Control its PDF in a tab of Files.
      const openRef = async (k, e) => {
        const p = byKey.get(k);
        if (!p) return;
        pop.hide();
        if ((e?.metaKey || e?.ctrlKey) && p.pdfMode === 'folder' && p.pdfRel) { remember(); showFile(p.pdfRel); ctx.go('files'); return; }
        if (await hasDocument(p)) { const page = pageOf(k); ctx.openDocument(p.id, page ? { page } : null); return; }
        remember(); focusPaper(p.id); ctx.go('library');
      };
      el.querySelectorAll('[data-cite-open]').forEach(row => {
        if (row.dataset.missing) return;
        row.onclick = e => { if (!e.target.closest('[data-ref-menu]')) openRef(row.dataset.citeOpen, e); };
        row.onkeydown = e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRef(row.dataset.citeOpen, e); } };
      });
      el.querySelectorAll('[data-ref-menu]').forEach(b => b.onclick = async () => {
        const k = b.dataset.refMenu, p = byKey.get(k);
        const links = p ? [p.doi ? ['Open DOI', `https://doi.org/${encodeURI(String(p.doi))}`] : null, p.pmid ? ['Open in PubMed', `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pmid)}/`] : null].filter(Boolean) : [];
        const pdf = p ? await hasDocument(p) : false;
        showMenu(b, [
          ...(p ? [{ label: 'Copy citation', icon: 'copy', run: () => navigator.clipboard?.writeText(formatReference(p, refStyle())).catch(() => {}) },
            { label: 'Go to reference in list', icon: 'list', run: () => { pop.hide(); showInRail(k); } },
            ...(pdf ? [{ label: 'Open PDF', icon: 'file', run: () => { pop.hide(); const page = pageOf(k); ctx.openDocument(p.id, page ? { page } : null); } }] : []),
            ...links.map(([label, href]) => ({ label, icon: 'open', run: () => { openLink(href).catch(error => console.warn('[open]', String(error))); } })), '-'] : []),
          { label: 'Remove citation', icon: 'trash', danger: true, run: () => {
            const left = cites.filter(c => c.key !== k);
            const box = sup.closest('.mb-edit') || sup.closest('.para');
            if (left.length) sup.dataset.src = left.map(c => citeToken(c.key, c.locator)).join(''); else sup.remove();
            pop.hide();
            box?.dispatchEvent(new Event('input', { bubbles: true }));
          } }], { align: 'end', minWidth: 200 });
      });
      // Inside the editor: under the line of the mark, or over it when there is no room under; never across the line itself.
      const r = sup.getBoundingClientRect();
      const ed = (document.querySelector('#ms-scroll') || document.body).getBoundingClientRect();
      const lo = Math.max(8, ed.left + 8), hi = Math.min(innerWidth - 8, ed.right - 8), top0 = Math.max(8, ed.top + 8), bottom0 = Math.min(innerHeight - 8, ed.bottom - 8);
      el.style.setProperty('visibility', 'hidden');
      el.hidden = false;
      el.style.setProperty('left', `${lo}px`); el.style.setProperty('top', `${top0}px`);
      const w = el.offsetWidth, h = el.offsetHeight;
      const below = bottom0 - r.bottom - 6, above = r.top - 6 - top0;
      const top = h <= below || below >= above ? r.bottom + 6 : r.top - 6 - h;
      el.style.setProperty('left', `${Math.max(lo, Math.min(r.left, hi - w))}px`);
      el.style.setProperty('top', `${Math.max(top0, Math.min(top, bottom0 - h))}px`);
      el.style.removeProperty('visibility');
      pop.pinnedTo = pin ? sup : null;
      el.onmouseleave = e => { if (!pop.pinnedTo && !e.relatedTarget?.closest?.('.menu')) pop.hide(); };
    } };
  return pop;
}

function restoreCaret(el) {
  if (focusCell) {
    const fc = focusCell; focusCell = null;
    const page = el.querySelector('#page');
    let box = fc.note ? page?.querySelector(`.mb-note[data-note="${CSS.escape(fc.note)}"]`)
      : page?.querySelector(`.mb-cell[data-b="${CSS.escape(fc.id)}"][data-r="${fc.r}"][data-c="${fc.c}"]`);
    if (!box) return;
    // A note drawn in parts across pages: the part holding the offset.
    if (fc.note) for (const part of page.querySelectorAll(`.mb-note[data-note="${CSS.escape(fc.note)}"]`)) {
      const n = sourceLength(part); box = part;
      if ((fc.at || 0) <= n) break;
      fc.at -= n; if (fc.end != null) fc.end -= n;
    }
    box.focus({ preventScroll: true });
    const [node, off] = pointAt(box, Math.min(fc.at || 0, sourceLength(box)));
    const r = document.createRange(); r.setStart(node, off); r.collapse(true);
    if (fc.end != null && fc.end > fc.at) r.setEnd(...pointAt(box, Math.min(fc.end, sourceLength(box))));
    getSelection().removeAllRanges(); getSelection().addRange(r);
    box.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!focusId) return;
  const page = el.querySelector('#page'), id = focusId;
  focusId = null;
  if (!page?.querySelector(`.mb-edit[data-b="${CSS.escape(id)}"]`)) return;
  restoreTextSelection(page, { start: { id, at: focusAt }, end: { id, at: focusAt } });
  boxOf(getSelection().focusNode)?.scrollIntoView({ block: 'nearest' });
}

function insertAtCaret(text, { cite = null } = {}) {
  const box = boxOf(getSelection()?.anchorNode);
  if (!box) return false;
  const id = box.dataset.b;
  const at = sourceOffset(box);
  update(s => {
    const b = s.manuscript.blocks.find(x => x.id === id);
    if (!b) return s;
    const before = splitRuns(b, 0, at), after = splitRuns(b, at, Infinity);
    const cur = b.text;
    b.text = cur.slice(0, at) + text + cur.slice(at);
    // Several papers cited at once are one run, so they render as one mark.
    b.runs = [...before, cite ? { cite } : { t: text }, ...after];
    return s;
  });
  focusId = id; focusAt = at + text.length;
  return true;
}

// ---- the toolbar ----------------------------------------------------------

/**
 * Character formatting goes through the browser's own editing commands on the
 * selection, and the paragraph is read back into runs on the input event that
 * follows — so bold from the toolbar and bold pasted from Word end up as the
 * same run flag. Paragraph style and alignment are block properties.
 */
let heldSelection = null;   // the text selection the toolbar acts on, kept while a control has focus
function wireTools(el, ctx) {
  const page = el.querySelector('#page');
  heldSelection = null;
  const holdSelection = () => {
    const selection = textSelection(page);
    if (selection) heldSelection = selection;
    clearTimeout(repaginateT);
    return heldSelection;
  };
  const focused = () => {
    const sel = getSelection();
    const n = sel?.anchorNode;
    return (n?.nodeType === 1 ? n : n?.parentElement)?.closest('.mb-edit') || el.querySelector('.mb-edit.on');
  };
  const styleSel = el.querySelector('#t-style'), fontSel = el.querySelector('#t-font'), sizeSel = el.querySelector('#t-size');
  const syncToolbar = box => {
    if (!box) return;
    const b = blocksOf().find(x => x.id === box.dataset.b);
    if (!b || !isParagraph(b)) return;
    const at = blocksOf().findIndex(x => x.id === b.id);
    const section = [...blocksOf().slice(0, at + 1)].reverse().find(x => /^h[23]$/.test(x.type));
    // The section's name as a sentence, whatever capitals the document sets it in; the document is unchanged. It is the title bar's title.
    sectionLabel = section ? sentenceCase(headingText(section.text), keptNow()) || 'Untitled section' : 'Document';
    barTitle(sectionLabel);
    const selection = textSelection(page) || heldSelection;
    const offset = selection?.start.id === b.id ? selection.start.at : 0;
    const run = formatAt(b, offset);
    const pending = typingFormat?.id === b.id && typingFormat.at === offset ? typingFormat.patch : {};
    const styles = effectiveStyles(doc());
    const resolved = resolveStyle(b, styles);
    // Read the selected character's formatting, not the first run in the paragraph.
    if (styleSel) { const id = styleIdOf(b); setPicker(styleSel, id, styleLabel(id, styles.byId[id])); }
    if (fontSel) { const f = pending.font || run.font || resolved.run.font || ''; setPicker(fontSel, f || 'Times New Roman'); }
    if (sizeSel) sizeSel.value = String(pending.sz || run.sz || resolved.run.sz || 12);
    // The paragraph's alignment and list show as pressed controls: fill only.
    const jc = resolved.para.jc === 'both' ? 'both' : ['center', 'right'].includes(resolved.para.jc) ? resolved.para.jc : 'left';
    el.querySelectorAll('[data-align]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.align === jc)));
    const st = caretFormats(el).state;
    for (const [fmt, k] of [['bold', 'b'], ['italic', 'i'], ['underline', 'u']]) el.querySelector(`[data-fmt="${fmt}"]`)?.setAttribute('aria-pressed', String(!!st[k]));
    const kind = b.props?.list ? (doc().lists?.[b.props.list.id]?.levels?.[b.props.list.level || 0]?.fmt === 'bullet' ? 'bullets' : 'numbers') : '';
    el.querySelectorAll('[data-cmd="bullets"],[data-cmd="numbers"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cmd === kind)));
  };
  // In a table cell the toolbar shows the cell's character formatting.
  const syncCellToolbar = () => {
    const { state, run } = caretFormats(el);
    const base = resolveStyle({ styleId: 'Normal' }, effectiveStyles(doc())).run;
    const f = run?.font || base.font || 'Times New Roman', n = run?.sz || base.sz || 12;
    if (fontSel) setPicker(fontSel, f);
    if (sizeSel) sizeSel.value = String(n);
    for (const [fmt, k] of [['bold', 'b'], ['italic', 'i'], ['underline', 'u']]) el.querySelector(`[data-fmt="${fmt}"]`)?.setAttribute('aria-pressed', String(!!state[k]));
  };
  el.addEventListener('focusin', e => syncToolbar(e.target.closest?.('.mb-edit')));
  syncToolbar(el.querySelector('.mb-edit.on') || el.querySelector('.mb-edit'));
  selectionEvents?.abort();
  selectionEvents = new AbortController();
  document.addEventListener('selectionchange', () => {
    if (!page.isConnected || !page.contains(document.activeElement)) return;
    // The paragraph with the caret shows its controls and is the one model actions act on.
    const here = boxOf(getSelection()?.focusNode);
    if (here && page.contains(here) && !here.classList.contains('on')) {
      page.querySelectorAll('.mb-edit.on').forEach(n => n.classList.remove('on'));
      partsOf(here).forEach(n => n.classList.add('on'));
      caretBlock = here.dataset.b;
    }
    const sel = getSelection();
    const cell = sel?.focusNode && (sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement)?.closest?.('.mb-cell');
    if (cell && page.contains(cell) && cell.contains(sel.anchorNode)) {
      caretCell = { id: cell.dataset.b, r: +cell.dataset.r, c: +cell.dataset.c }; caretBlock = cell.dataset.b;
      // The characters selected in the cell, for the toolbar's formatting.
      const a = offsetAt(cell, sel.anchorNode, sel.anchorOffset), f = offsetAt(cell, sel.focusNode, sel.focusOffset);
      heldCell = { ...caretCell, start: Math.min(a, f), end: Math.max(a, f) };
      syncCellToolbar();
      return;
    }
    caretCell = null; heldCell = null;
    const selection = textSelection(page);
    if (!selection) return;
    heldSelection = selection;
    if (typingFormat && (selection.start.id !== typingFormat.id || selection.start.at !== typingFormat.at || selection.end.at !== typingFormat.at || selection.end.id !== typingFormat.id)) typingFormat = null;
    syncToolbar(focused());
  }, {signal:selectionEvents.signal});
  // The caret is drawn here, as high as the text, not as the line (lib/page-caret.mjs); the native one is hidden while it shows.
  mountCaret({ scroll: el.querySelector('#ms-scroll'), page, signal: selectionEvents.signal });
  for (const control of [styleSel,fontSel,sizeSel]) {
    control?.addEventListener('pointerdown', holdSelection);
    control?.addEventListener('focus', holdSelection);
  }
  page.addEventListener('beforeinput', e => {
    if (e.defaultPrevented || !typingFormat || e.isComposing || e.inputType !== 'insertText' || e.data == null) return;
    const selection = textSelection(page);
    if (!selection || selection.start.id !== typingFormat.id || selection.start.at !== typingFormat.at || selection.start.id !== selection.end.id || selection.start.at !== selection.end.at) return;
    e.preventDefault();
    // Text typed after choosing a font or size at a bare caret takes them.
    const span = document.createElement('span');
    span.textContent = e.data;
    if (typingFormat.patch.font) span.style.setProperty('font-family', typingFormat.patch.font);
    if (typingFormat.patch.sz) span.style.setProperty('font-size', `${typingFormat.patch.sz * 96 / 72}px`);
    if ('b' in typingFormat.patch) span.style.setProperty('font-weight', typingFormat.patch.b ? '700' : '400');
    if ('i' in typingFormat.patch) span.style.setProperty('font-style', typingFormat.patch.i ? 'italic' : 'normal');
    const deco = [['u', 'underline'], ['strike', 'line-through']].filter(([k]) => k in typingFormat.patch);
    if (deco.length) span.style.setProperty('text-decoration', [['u', 'underline'], ['strike', 'line-through']].filter(([k]) => typingFormat.patch[k]).map(([, w]) => w).join(' ') || 'none');
    const sel = getSelection(), range = sel.getRangeAt(0);
    range.insertNode(span); range.setStartAfter(span); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    span.closest('.mb-edit')?.dispatchEvent(new Event('input', { bubbles: true }));
    const next = textSelection(page);
    if (next) typingFormat.at = next.end.at;
  });

  // The two pickers open their menu here, and answer ui-pick when they have folded into More.
  const chooseStyle = id => {
    const saved = heldSelection || textSelection(page);
    const ids = saved ? idsBetween(blocksOf(), saved.start.id, saved.end.id) : caretBlock ? [caretBlock] : [];
    if (ids.length) commitDoc(ctx, m => applyStyle(m, ids, id), saved);
  };
  const chooseFont = font => applyCharacterFormat(el, ctx, { font });
  styleSel.onclick = () => { holdSelection(); showMenu(styleSel, styleOptions(doc()).map(t => ({ label: t.label, checked: t.id === styleSel.dataset.value, run: () => chooseStyle(t.id) })), { minWidth: 200 }); };
  styleSel.addEventListener('ui-pick', e => chooseStyle(e.detail.value));
  fontSel.onclick = () => { holdSelection(); showMenu(fontSel, docFonts(doc()).map(f => ({ label: f, font: f, checked: f === fontSel.dataset.value, run: () => chooseFont(f) })), { minWidth: 200 }); };
  fontSel.addEventListener('ui-pick', e => chooseFont(e.detail.value));
  if (sizeSel) sizeSel.onchange = () => { const sz = Number(sizeSel.value); if (sz >= 1 && sz <= 1638) applyCharacterFormat(el, ctx, { sz }); else sizeSel.value = String(caretFormats(el).run?.sz || 12); };
  el.querySelectorAll('[data-fmt]').forEach(btn => {
    // mousedown, not click: a click would move focus off the selection first
    btn.onmousedown = e => {
      e.preventDefault();
      if (['undo','redo'].includes(btn.dataset.fmt)) { if (!undoFormatting(btn.dataset.fmt === 'redo', ctx)) { document.execCommand(btn.dataset.fmt); } return; }
      // In the text, bold, italic and underline go through the model, so a style's own is turned off too.
      const key = { bold: 'b', italic: 'i', underline: 'u' }[btn.dataset.fmt];
      if (key && !getSelection()?.focusNode?.parentElement?.closest?.('.mb-note')) { toggleCharacter(el, ctx, key); return; }
      const box = focused() || subBoxOf(getSelection()?.focusNode); if (!box) return;
      document.execCommand(btn.dataset.fmt, false, null);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    btn.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.onmousedown(e); } };
  });
  el.querySelectorAll('[data-align]').forEach(btn => btn.onmousedown = e => { e.preventDefault(); runCommand(el, ctx, 'align', btn.dataset.align); });
  el.querySelectorAll('[data-cmd]').forEach(btn => btn.onmousedown = e => { e.preventDefault(); runCommand(el, ctx, btn.dataset.cmd); });
  el.querySelectorAll('[data-align],[data-cmd]').forEach(btn => btn.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.onmousedown(e); } });
  el.querySelectorAll('[data-menu]').forEach(btn => {
    btn.onmousedown = e => { e.preventDefault(); holdSelection(); };
    btn.onclick = () => { holdSelection(); showMenu(btn, menuItems(el, ctx, btn.dataset.menu), { minWidth: 200 }); };
  });
  wireFind(el, ctx);
  // The strip: the pointer holds the selection before any control takes focus, and More carries the menus that do not have a place in the strip.
  const strip = el.querySelector('#mstools');
  strip.addEventListener('pointerdown', () => holdSelection(), true);
  wireBar(strip, { more: () => ['para', 'insert', 'table', 'layout', 'review'].map(k => ({ label: MENU_TITLES[k], submenu: menuItems(el, ctx, k) })) });
  el.querySelector('#t-find')?.addEventListener('click', () => runCommand(el, ctx, 'find'));
  const title = document.getElementById('topbar-title'); if (title && blocksOf().length) title.title = 'Word count';   // the title bar's title is the section; its menu counts the words
}
/** A picker's shown value and the value its menu marks. */
function setPicker(btn, value, label = value) {
  const shown = btn.querySelector('.ui-picker-value');
  if (shown && shown.textContent !== label) shown.textContent = label;
  btn.dataset.value = value;
  btn.setAttribute('aria-label', `${btn.title}: ${label}`);
}
let caretCell = null, heldCell = null, activeComment = null;
const subBoxOf = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.mb-cell,.mb-note') || null;

// ---- word processing commands (plan §4.11a) ----------------------------------------
//
// Every command below changes the manuscript through commitDoc, so it can be
// undone, and acts on the paragraphs of the held selection (or the one with
// the caret), or on the table cell holding the caret.

/** The selection a command acts on, and the paragraph ids it covers. */
function targets(el) {
  const page = el.querySelector('#page');
  const saved = heldSelection || (page && textSelection(page));
  const ids = saved ? idsBetween(blocksOf(), saved.start.id, saved.end.id) : caretBlock ? [caretBlock] : [];
  return { saved, ids: ids.filter(id => isParagraph(blocksOf().find(b => b.id === id))) };
}
const caretAt = saved => saved ? { start: saved.end, end: saved.end } : null;

/** Character formatting on the selection (or, at a bare caret, for what is typed next). */
/** The author and time a tracked change records; null when changes are not being tracked. */
const authorName = () => String(settings().reviewerName || '').trim() || 'Author';
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const tracking = () => doc().trackChanges ? { author: authorName(), date: nowStamp() } : null;

function applyCharacterFormat(el, ctx, patch) {
  const page = el.querySelector('#page');
  // In a table cell: the selected characters, or the whole cell at a bare caret.
  if (heldCell) {
    const hc = heldCell;
    focusCell = { id: hc.id, r: hc.r, c: hc.c, at: hc.start, end: hc.end };
    commitDoc(ctx, m => {
      const cell = m.blocks.find(x => x.id === hc.id)?.grid?.rows[hc.r]?.cells[hc.c];
      if (!cell || cell.merged) return null;
      const box = { runs: cell.runs?.length ? cell.runs : [{ t: cell.text || '' }], text: cell.text || '' };
      const [from, to] = hc.start === hc.end ? [0, box.text.length] : [hc.start, hc.end];
      cell.runs = formatTextRange(box, from, to, patch, tracking()).runs;
      return m;
    }, null);
    return;
  }
  const saved = heldSelection || textSelection(page);
  if (!saved) return;
  clearTimeout(repaginateT);
  if (saved.start.id === saved.end.id && saved.start.at === saved.end.at) {
    const previous = typingFormat?.id === saved.start.id && typingFormat.at === saved.start.at ? typingFormat.patch : {};
    typingFormat = { id: saved.start.id, at: saved.start.at, patch: { ...previous, ...patch } };
    restoreTextSelection(page, saved);
    return;
  }
  commitDoc(ctx, m => {
    const first = m.blocks.findIndex(b => b.id === saved.start.id), last = m.blocks.findIndex(b => b.id === saved.end.id);
    if (first < 0 || last < first) return null;
    m.blocks = m.blocks.map((block, i) => i < first || i > last || !isParagraph(block) ? block : formatTextRange(block,
      i === first ? saved.start.at : 0, i === last ? saved.end.at : block.text.length, patch, tracking()));
    return m;
  }, saved);
}
/** A toggled character property: on unless the selection's first character already has it. */
/** The formats on at the caret: the run, its paragraph's style, and the elements the caret is in. */
function caretFormats(el) {
  const page = el.querySelector('#page');
  if (heldCell) {
    const cell = blocksOf().find(x => x.id === heldCell.id)?.grid?.rows[heldCell.r]?.cells[heldCell.c];
    if (!cell || cell.merged) return { state: {}, base: {} };
    const run = formatAt({ runs: cell.runs || [] }, heldCell.start);
    const base = resolveStyle({ styleId: 'Normal' }, effectiveStyles(doc())).run;
    const f = getSelection()?.focusNode, host = f?.nodeType === 1 ? f : f?.parentElement;
    const chain = [];
    for (let n = host; n && !n.classList?.contains('mb-cell'); n = n.parentElement)
      chain.push({ tag: n.tagName, className: n.className, textDecoration: n.style?.textDecoration || '' });
    const cs = host && getComputedStyle(host);
    return { state: formatState(chain, run, base, cs && { fontWeight: cs.fontWeight, fontStyle: cs.fontStyle }), base, run };
  }
  const saved = heldSelection || (page && textSelection(page));
  const b = saved && blocksOf().find(x => x.id === saved.start.id);
  if (!b) return { state: {}, base: {} };
  const at = saved.start.at === saved.end.at || saved.start.id !== saved.end.id ? saved.start.at : saved.start.at;
  const run = formatAt(b, at);
  const base = resolveStyle(b, effectiveStyles(doc())).run;
  let node = null;
  const pt = page && blockPoint(page, b.id, Math.min(at + (saved.start.at === saved.end.at ? 0 : 1), b.text.length));
  if (pt) node = pt[0].nodeType === 1 ? pt[0].childNodes[Math.max(0, pt[1] - 1)] || pt[0] : pt[0];
  const chain = [];
  for (let n = node?.nodeType === 1 ? node : node?.parentElement; n && !n.classList?.contains('mb-edit'); n = n.parentElement)
    chain.push({ tag: n.tagName, className: n.className, textDecoration: n.style?.textDecoration || n.style?.textDecorationLine || '' });
  const host = node?.nodeType === 1 ? node : node?.parentElement;
  const cs = host && getComputedStyle(host);
  const pending = typingFormat?.id === b.id && typingFormat.at === saved.start.at ? typingFormat.patch : {};
  return { state: { ...formatState(chain, run, base, cs && { fontWeight: cs.fontWeight, fontStyle: cs.fontStyle }), ...pending }, base, run };
}
function toggleCharacter(el, ctx, key, extra = {}) {
  const { state, base } = caretFormats(el);
  const on = !state[key];
  // Off where the style has it on is an explicit "not", so the paragraph style does not show through.
  applyCharacterFormat(el, ctx, { [key]: on ? true : base[key] ? false : undefined, ...(on ? extra : {}) });
}

function cellAction(ctx, fn) {
  const c = caretCell;
  if (!c) return;
  commitDoc(ctx, m => {
    const i = m.blocks.findIndex(b => b.id === c.id);
    if (i < 0 || !m.blocks[i].grid) return null;
    const next = fn(m.blocks[i], c.r, c.c);
    if (next === undefined) return null;
    if (next === null) m.blocks.splice(i, 1); else m.blocks[i] = next;
    return m;
  }, null);
}

/** Insert blocks after the paragraph with the caret (or at the end). */
function insertBlocksAfter(ctx, made, afterId = caretBlock, focus = null) {
  commitDoc(ctx, m => {
    let i = m.blocks.findIndex(b => b.id === afterId);
    if (i < 0) i = m.blocks.length - 1;
    const tail = m.blocks[i + 1];
    m.blocks.splice(i + 1, 0, ...made, ...(!tail || !isParagraph(tail) ? [blankBlock('p')] : []));
    return m;
  }, focus);
}

/** A dialog's number field; the step sets what the arrows add. */
const numberInput = f => `<input ${f.type ? `type="${f.type}"` : 'type="text" inputmode="decimal"'} name="${esc(f.name)}" value="${esc(f.value ?? '')}" spellcheck="false" autocomplete="off">`;
/**
 * A number from a dialog field, kept within its range. Values read from Word
 * are often off the arrows' step (2.5 cm margins are 70.85 pt), so the form
 * is not validated by step: any value in range is taken.
 */
export const numberValue = (raw, f) => { const n = Number(String(raw ?? '').trim().replace(',', '.')); return raw === '' || raw == null || !Number.isFinite(n) ? null : Math.min(f.max ?? 1000, Math.max(f.min ?? 0, n)); };   // a comma is a decimal point
/** The format dialogs of the word processor (Font, Paragraph, Page setup, Style, Table, Zoom): the fields of one format, drawn from a spec on the recipe. */
function numberDialog(title, fields, { wire, validate } = {}) {
  const box = f => f.options
    ? `<select name="${esc(f.name)}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(f.value ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : numberInput(f);
  const checks = fields.filter(f => f.type === 'checkbox'), others = fields.filter(f => f.type !== 'checkbox');
  return formDialog({ id: 'manuscript-format', title, tier: 'M', confirm: 'Apply',
    body: `<div class="an-settings">${others.map(f => formField(f.label, box(f))).join('')}
      ${checks.length ? `<div class="field an-checks" role="group" aria-label="Options">${checks.map(f => `<label class="cr-check"><input type="checkbox" name="${esc(f.name)}"${f.value ? ' checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}</div>` : ''}</div>
      <p class="note" data-dialog-error role="alert" hidden></p>`,
    onMount: d => wire?.(d),
    submit: (form, d) => {
      const out = {};
      for (const f of fields) { const x = d.querySelector(`[name="${f.name}"]`); out[f.name] = f.type === 'checkbox' ? x.checked : f.options || f.type ? x.value : numberValue(x.value, f); }
      const error = validate?.(out);
      if (error) { const hint = d.querySelector('[data-dialog-error]'); hint.textContent = error; hint.hidden = false; return undefined; }
      return out;
    } });
}

async function fontDialog(el, ctx) {
  const { state, base, run = {} } = caretFormats(el);
  const v = await numberDialog('Font', [
    { name: 'font', label: 'Font family', type: 'text', value: run.font || base.font || 'Times New Roman' },
    { name: 'sz', label: 'Size (pt)', value: run.sz || base.sz || 12, min: 1, max: 1638, step: .5 },
    { name: 'color', label: 'Colour (hex)', type: 'text', value: run.color || base.color || '000000' },
    ...[['b', 'Bold'], ['i', 'Italic'], ['u', 'Underline'], ['strike', 'Strikethrough'], ['smallCaps', 'Small capitals'], ['caps', 'All capitals']].map(([name, label]) => ({ name, label, type: 'checkbox', value: !!state[name] })),
  ], { validate: v => !v.font.trim() ? 'Enter a font family.' : !v.sz ? 'Enter a font size.' : !/^#?[0-9a-f]{6}$/i.test(v.color.trim()) ? 'Enter a six-digit hex colour.' : null });
  if (v) applyCharacterFormat(el, ctx, { ...v, font: v.font.trim(), color: v.color.trim().replace(/^#/, '') });
}

async function paragraphDialog(el, ctx) {
  const { saved, ids } = targets(el);
  const b = blocksOf().find(x => x.id === ids[0]);
  if (!b) return;
  const p = resolvedPara(b, effectiveStyles(doc()));
  const rule = p.lineExact != null ? 'exact' : p.lineAtLeast != null ? 'atLeast' : 'multiple';
  const v = await numberDialog('Paragraph', [
    { name: 'jc', label: 'Alignment', value: p.jc || 'left', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['both', 'Justified']] },
    { name: 'indLeft', label: 'Left indent (pt)', value: p.indLeft ?? 0, max: 432 },
    { name: 'indRight', label: 'Right indent (pt)', value: p.indRight ?? 0, max: 432 },
    { name: 'special', label: 'First line', value: p.indHanging ? 'hanging' : p.indFirst ? 'first' : 'none', options: [['none', 'None'], ['first', 'First line'], ['hanging', 'Hanging']] },
    { name: 'by', label: 'By (pt)', value: p.indHanging ?? p.indFirst ?? 36, max: 216 },
    { name: 'before', label: 'Space before (pt)', value: p.before ?? 0, max: 144 },
    { name: 'after', label: 'Space after (pt)', value: p.after ?? 0, max: 144 },
    { name: 'rule', label: 'Line spacing', value: rule, options: [['multiple', 'Multiple'], ['atLeast', 'At least'], ['exact', 'Exactly']] },
    { name: 'at', label: 'At', value: rule === 'exact' ? p.lineExact : rule === 'atLeast' ? p.lineAtLeast : p.line ?? 1, step: 0.05, max: 200 },
    { name: 'keepNext', label: 'Keep with next', type: 'checkbox', value: !!p.keepNext },
    { name: 'pageBreakBefore', label: 'Page break before', type: 'checkbox', value: !!p.pageBreakBefore },
  ]);
  if (!v) return;
  const at = Math.max(0.5, Number(v.at) || 1);
  const patch = { jc: v.jc, indLeft: v.indLeft, indRight: v.indRight || null, before: v.before, after: v.after,
    indFirst: v.special === 'first' ? v.by : null, indHanging: v.special === 'hanging' ? v.by : null,
    line: v.rule === 'multiple' ? at : null, lineExact: v.rule === 'exact' ? at : null, lineAtLeast: v.rule === 'atLeast' ? at : null,
    keepNext: v.keepNext || null, pageBreakBefore: v.pageBreakBefore || null };
  commitDoc(ctx, m => {
    m.blocks = setParagraphProps(m.blocks, ids, patch);
    // First-line and hanging exclude each other; "none" clears both.
    if (v.special === 'none') m.blocks = setParagraphProps(m.blocks, ids, { indFirst: null, indHanging: null });
    return m;
  }, saved);
}

/** The section the caret is in: the first block at or after it that ends a section, else the document's last. */
function sectionAtCaret() {
  const bs = blocksOf();
  const i = Math.max(0, bs.findIndex(b => b.id === caretBlock));
  const end = bs.slice(i).find(b => b.props?.section);
  return { blockId: end?.id || null, sec: { ...DEFAULT_SECTION, ...(end ? end.props.section : doc().section || {}) } };
}
const PAPER = { Letter: [612, 792], A4: [595.3, 841.9], Legal: [612, 1008], A3: [841.9, 1190.6], A5: [419.5, 595.3], A6: [297.6, 419.5], Tabloid: [792, 1224], Executive: [522, 756], B5: [498.9, 708.7] };

async function pageSetupDialog(el, ctx) {
  const { blockId, sec } = sectionAtCaret();
  const landscape = sec.pageW > sec.pageH;
  const [w, h] = landscape ? [sec.pageH, sec.pageW] : [sec.pageW, sec.pageH];
  const size = Object.entries(PAPER).find(([, [pw, ph]]) => Math.abs(pw - w) < 2 && Math.abs(ph - h) < 2)?.[0] || 'custom';
  const units = { in: 72, cm: 72 / 2.54, pt: 1 };
  const marginPresets = { normal: [72, 72, 72, 72], narrow: [36, 36, 36, 36], moderate: [72, 72, 54, 54], wide: [72, 72, 144, 144] };
  const preset = Object.entries(marginPresets).find(([, values]) => ['top', 'bottom', 'left', 'right'].every((key, i) => Math.abs(sec[key] - values[i]) < .1))?.[0] || 'custom';
  const v = await numberDialog('Page setup', [
    { name: 'size', label: 'Paper', value: size, options: [...Object.keys(PAPER).map(k => [k, k]), ['custom', 'Custom']] },
    { name: 'orient', label: 'Orientation', value: landscape ? 'landscape' : 'portrait', options: [['portrait', 'Portrait'], ['landscape', 'Landscape']] },
    { name: 'unit', label: 'Units', value: 'in', options: [['in', 'Inches'], ['cm', 'Centimetres'], ['pt', 'Points']] },
    { name: 'preset', label: 'Margins', value: preset, options: [['normal', 'Normal'], ['narrow', 'Narrow'], ['moderate', 'Moderate'], ['wide', 'Wide'], ['custom', 'Custom']] },
    { name: 'pageW', label: 'Page width', value: sec.pageW / 72, min: .1, max: 3000, step: .01 },
    { name: 'pageH', label: 'Page height', value: sec.pageH / 72, min: .1, max: 3000, step: .01 },
    ...['top', 'bottom', 'left', 'right'].map(name => ({ name, label: `${name[0].toUpperCase() + name.slice(1)} margin`, value: sec[name] / 72, max: 3000, step: .01 })),
  ], {
    wire: dialog => {
      const input = name => dialog.querySelector(`[name="${name}"]`);
      let unit = 'in';
      const lengths = ['pageW', 'pageH', 'top', 'bottom', 'left', 'right'];
      const put = (name, pt) => { input(name).value = String(Math.round(pt / units[unit] * 1000) / 1000); };
      // Unit changes convert the numbers rather than relabelling them.
      input('unit').onchange = () => { const next = input('unit').value; for (const name of lengths) input(name).value = String(Math.round(Number(input(name).value) * units[unit] / units[next] * 1000) / 1000); unit = next; };
      const syncSize = () => {
        const paper = PAPER[input('size').value];
        if (paper) { const [pw, ph] = input('orient').value === 'landscape' ? [...paper].reverse() : paper; put('pageW', pw); put('pageH', ph); }
        input('pageW').disabled = input('pageH').disabled = !!paper;
      };
      input('size').onchange = syncSize;
      input('orient').onchange = () => { if (input('size').value === 'custom') { const old = input('pageW').value; input('pageW').value = input('pageH').value; input('pageH').value = old; } else syncSize(); };
      input('preset').onchange = () => { const margins = marginPresets[input('preset').value]; if (margins) ['top', 'bottom', 'left', 'right'].forEach((key, i) => put(key, margins[i])); };
      for (const name of ['top', 'bottom', 'left', 'right']) input(name).oninput = () => { input('preset').value = 'custom'; };
      for (const name of ['pageW', 'pageH']) input(name).oninput = () => { input('orient').value = Number(input('pageW').value) > Number(input('pageH').value) ? 'landscape' : 'portrait'; };
      input('pageW').disabled = input('pageH').disabled = !!PAPER[size];
    },
    validate: values => {
      const factor = units[values.unit];
      if (!values.pageW || !values.pageH) return 'Enter the page width and height.';
      if (['top', 'bottom', 'left', 'right'].some(key => values[key] == null)) return 'Enter all four margins.';
      if ((values.left + values.right) * factor > values.pageW * factor - 36 || (values.top + values.bottom) * factor > values.pageH * factor - 36) return 'Margins must leave room for the text.';
      return null;
    },
  });
  if (!v) return;
  const factor = units[v.unit];
  const next = { ...sec, ...Object.fromEntries(['pageW', 'pageH', 'top', 'bottom', 'left', 'right'].map(key => [key, v[key] * factor])) };
  if (v.orient === 'landscape') next.orient = 'landscape'; else delete next.orient;
  commitDoc(ctx, m => {
    if (blockId) { const b = m.blocks.find(x => x.id === blockId); b.props = { ...b.props, section: { ...b.props.section, ...next } }; }
    else m.section = { ...(m.section || {}), ...next };
    return m;
  }, null);
}

// Page fields read as words in the dialog and are kept as tokens in the document.
const toWords = t => String(t || '').replace(/\{\{page\}\}/g, '[Page]').replace(/\{\{pages\}\}/g, '[Pages]');
const toTokens = t => String(t || '').replace(/\[Page\]/gi, '{{page}}').replace(/\[Pages\]/gi, '{{pages}}');

/**
 * Headers and footers of the section with the caret: the default ones, a
 * different first page, and (for the whole document) different even pages,
 * as Word has them. A part left empty on a page kind that is switched on is
 * blank there; the default left empty takes the previous section's.
 */
async function headerFooterDialog(ctx) {
  const { blockId, sec } = sectionAtCaret();
  const evenOdd = !!doc().section?.evenOdd;
  const kinds = [['', 'Header', 'Footer'], ['First', 'First page header', 'First page footer'], ['Even', 'Even page header', 'Even page footer']];
  const val = key => toWords(sec[key]?.text);
  const jc = kind => sec[kind]?.jc || sec[`${kind}First`]?.jc || sec[`${kind}Even`]?.jc || (kind === 'footer' ? 'center' : 'left');
  const opts = v => [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('');
  const hf = (suffix, h, f) => `<div class="an-settings" data-kind="${suffix}">${formField(h, `<input type="text" name="header${suffix}" value="${esc(val(`header${suffix}`))}" spellcheck="false">`)}${formField(f, `<input type="text" name="footer${suffix}" value="${esc(val(`footer${suffix}`))}" spellcheck="false">`)}</div>`;
  let last = null;
  const v = await formDialog({ id: 'manuscript-header-footer', title: 'Header and footer', tier: 'M', confirm: 'Apply', start: { id: 'field', label: 'Insert field' },
    body: `<div class="an-settings"><div class="field an-checks" role="group" aria-label="Pages"><label class="cr-check"><input type="checkbox" name="titlePg"${sec.titlePg ? ' checked' : ''}><span>Different first page</span></label>
        <label class="cr-check"><input type="checkbox" name="evenOdd"${evenOdd ? ' checked' : ''}><span>Different odd and even pages</span></label></div></div>
      ${kinds.map(([suffix, h, f]) => hf(suffix, h, f)).join('')}
      <div class="an-settings">${formField('Header alignment', `<select name="headerJc">${opts(jc('header'))}</select>`)}${formField('Footer alignment', `<select name="footerJc">${opts(jc('footer'))}</select>`)}</div>`,
    onMount: d => {
      last = d.querySelector('input[type="text"]');
      const show = () => {
        d.querySelectorAll('[data-kind="First"]').forEach(x => { x.hidden = !d.querySelector('[name="titlePg"]').checked; });
        d.querySelectorAll('[data-kind="Even"]').forEach(x => { x.hidden = !d.querySelector('[name="evenOdd"]').checked; });
      };
      show();
      d.querySelectorAll('input[type="checkbox"]').forEach(x => { x.onchange = show; });
      d.querySelectorAll('input[type="text"]').forEach(x => x.addEventListener('focus', () => { last = x; }));
    },
    // Page number and Page count go into the box that was last in use, at its caret.
    onAct: (id, d) => {
      const anchor = d.querySelector('[data-start]');
      showMenu(anchor, [['[Page]', 'Page number'], ['[Pages]', 'Page count']].map(([token, label]) => ({ label, run: () => {
        const at = last.selectionStart ?? last.value.length;
        last.value = last.value.slice(0, at) + token + last.value.slice(last.selectionEnd ?? at);
        last.focus(); last.setSelectionRange(at + token.length, at + token.length);
      } })));
      return true;
    },
    submit: (form, d) => Object.fromEntries([...new FormData(form)].concat([['titlePg', d.querySelector('[name="titlePg"]').checked], ['evenOdd', d.querySelector('[name="evenOdd"]').checked]])) });
  if (!v) return;
  commitDoc(ctx, m => {
    const next = { ...sec };
    for (const kind of ['header', 'footer']) for (const [suffix] of kinds) {
      const key = `${kind}${suffix}`, text = toTokens(v[key]).trim();
      const on = suffix === '' || (suffix === 'First' ? v.titlePg : v.evenOdd);
      const had = sec[key];
      // A part with pictures or tables keeps them: unchanged text keeps the part whole; new text replaces its paragraphs.
      if (on && had?.blocks?.length) {
        if (text === String(had.text || '').trim()) { next[key] = had; continue; }
        const kept = had.blocks.filter(b => b.type === 'table' || b.type === 'figure');
        const paras = text ? text.split('\n').map(line => ({ ...blankBlock('p'), props: { after: 0, jc: v[`${kind}Jc`] }, runs: [{ t: line }], text: line })) : [];
        next[key] = kept.length || paras.length ? { text, jc: v[`${kind}Jc`], blocks: [...kept, ...paras] } : null;
        continue;
      }
      if (text && on) next[key] = { text, jc: v[`${kind}Jc`] };
      else if (on && suffix) next[key] = null;
      else delete next[key];
    }
    if (v.titlePg) next.titlePg = true; else delete next.titlePg;
    if (blockId) { const b = m.blocks.find(x => x.id === blockId); b.props = { ...b.props, section: next }; }
    else m.section = { ...(m.section || {}), ...next, ...(Object.fromEntries(['header', 'footer', 'headerFirst', 'footerFirst', 'headerEven', 'footerEven', 'titlePg'].filter(k => !(k in next)).map(k => [k, undefined]))) };
    m.section = { ...DEFAULT_SECTION, ...(m.section || {}) };
    if (v.evenOdd) m.section.evenOdd = true; else delete m.section.evenOdd;
    for (const k of Object.keys(m.section)) if (m.section[k] === undefined) delete m.section[k];
    return m;
  }, null);
}

async function styleDialog(el, ctx) {
  const { ids } = targets(el);
  const b = blocksOf().find(x => x.id === ids[0]);
  if (!b) return;
  const id = styleIdOf(b), styles = effectiveStyles(doc());
  const { run, para } = resolveStyle({ styleId: id }, styles);
  const v = await numberDialog(`Style: ${styleLabel(id, styles.byId[id])}`, [
    { name: 'font', label: 'Font', value: run.font || 'Times New Roman', options: docFonts(doc()).map(f => [f, f]) },
    { name: 'sz', label: 'Size (pt)', value: run.sz || 12, step: 0.5, min: 6, max: 72 },
    { name: 'b', label: 'Bold', type: 'checkbox', value: !!run.b },
    { name: 'i', label: 'Italic', type: 'checkbox', value: !!run.i },
    { name: 'jc', label: 'Alignment', value: para.jc || 'left', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['both', 'Justified']] },
    { name: 'before', label: 'Space before (pt)', value: para.before ?? 0, max: 144 },
    { name: 'after', label: 'Space after (pt)', value: para.after ?? 0, max: 144 },
    { name: 'line', label: 'Line spacing', value: para.line ?? 1, step: 0.05, max: 4 },
    { name: 'indFirst', label: 'First line indent (pt)', value: para.indFirst ?? 0, max: 216 },
  ]);
  if (!v) return;
  commitDoc(ctx, m => editStyle(m, id, { run: { font: v.font, sz: v.sz, b: v.b, i: v.i },
    para: { jc: v.jc, before: v.before, after: v.after, line: v.line, indFirst: v.indFirst || null, lineExact: null, lineAtLeast: null } }), null);
}

async function insertTableDialog(ctx) {
  const v = await numberDialog('Insert table', [
    { name: 'rows', label: 'Rows', value: 3, min: 1, max: 200 },
    { name: 'cols', label: 'Columns', value: 3, min: 1, max: 20 },
    { name: 'borders', label: 'Borders', value: 'all', options: [['all', 'All'], ['apa', 'Top and bottom rules'], ['none', 'None']] },
    { name: 'header', label: 'Header row', type: 'checkbox', value: true },
  ]);
  if (!v) return;
  const sec = sectionAtCaret().sec;
  const t = newTable(Math.max(1, Math.min(200, v.rows || 3)), Math.max(1, Math.min(20, v.cols || 3)), { width: sec.pageW - sec.left - sec.right, header: v.header, borders: v.borders });
  focusCell = { id: t.id, r: 0, c: 0, at: 0 };
  insertBlocksAfter(ctx, [t]);
}

async function columnWidthsDialog(ctx) {
  const c = caretCell; const b = c && blocksOf().find(x => x.id === c.id);
  if (!b?.grid) return;
  const v = await numberDialog('Column widths', b.grid.cols.map((w, k) => ({ name: `c${k}`, label: `Column ${k + 1} (pt)`, value: w, step: 1, min: 12, max: 1000 })));
  if (!v) return;
  cellAction(ctx, blk => setColumnWidths(blk, blk.grid.cols.map((_, k) => v[`c${k}`])));
}

function insertFigure(ctx) {
  const generation = projectGeneration(), owner = recoveryOwner(), target = caretBlock;
  const original = JSON.stringify(target ? blocksOf().find(b => b.id === target) : blocksOf());
  const section = structuredClone(sectionAtCaret().sec);
  const current = () => generation === projectGeneration() && original === JSON.stringify(target ? blocksOf().find(b => b.id === target) : blocksOf());
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    try {
      if (!current()) throw new Error('The project or insertion paragraph changed. Choose the figure again.');
      const size = await new Promise((res, reject) => { const i = new Image(), u = URL.createObjectURL(f); i.onload = () => { URL.revokeObjectURL(u); i.naturalWidth > 0 && i.naturalHeight > 0 ? res([i.naturalWidth, i.naturalHeight]) : reject(new Error('The image has no usable dimensions.')); }; i.onerror = () => { URL.revokeObjectURL(u); reject(new Error('The image could not be opened.')); }; i.src = u; });
      if (!current()) throw new Error('The project or insertion paragraph changed. Choose the figure again.');
      const img = `im${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const fileHash = await putFile(`img-${img}`, f, { owner });
      if (!current()) throw new Error('The project or insertion paragraph changed. The figure was not inserted.');
      const width = section.pageW - section.left - section.right;
      const w = Math.min(width, size[0] * 0.75), h = w * size[1] / size[0];
      const fig = { id: blankBlock().id, type: 'figure', img, fileHash, name: f.name, mime: f.type, w, h, props: { jc: 'center' }, text: '' };
      const cap = { ...blankBlock('p'), styleId: 'Caption', runs: [{ t: 'Figure {{seq:Figure}}. ' }], text: 'Figure {{seq:Figure}}. ' };
      insertBlocksAfter(ctx, [fig, cap], target, { start: { id: cap.id, at: cap.text.length }, end: { id: cap.id, at: cap.text.length } });
    } catch (error) { ctx.rerender(error.message || 'The figure could not be inserted.'); }
  };
  input.click();
}

function insertText(el, ctx, text, after = null, tracked = false) {
  const { saved } = targets(el);
  if (!saved) return false;
  let caret = null;
  const change = tracked ? tracking() : null;
  commitDoc(ctx, m => {
    if (change && (saved.start.id !== saved.end.id || saved.start.at !== saved.end.at)) m.blocks = trackDelete(m.blocks, saved.start, saved.end, change);
    const done = replaceTextRange(m.blocks, saved.start, change ? saved.start : saved.end, text, () => blankBlock().id, change ? { ins: change } : null);
    if (!done) return null;
    m.blocks = done.blocks; caret = done.caret;
    after?.(m, done);
    return m;
  }, () => caret && { start: caret, end: caret });
  return true;
}

/** Run a named command from the toolbar, a menu or a key. */
function runCommand(el, ctx, name, arg) {
  const { saved, ids } = targets(el);
  const para = patch => ids.length && commitDoc(ctx, m => { m.blocks = setParagraphProps(m.blocks, ids, patch); return m; }, saved);
  switch (name) {
    case 'align':
      if (caretCell && !saved) return cellAction(ctx, (b, r, c) => { const g = structuredClone(b.grid); const cell = g.rows[r].cells[c]; cell.props = { ...(cell.props || {}), jc: arg }; return { ...b, grid: g }; });
      return para({ jc: arg });
    case 'line': return para(arg);
    case 'before': return para({ before: arg });
    case 'after': return para({ after: arg });
    case 'firstLine': return para({ indFirst: arg, indHanging: null });
    case 'hanging': return para({ indHanging: arg, indFirst: null });
    case 'noSpecial': return para({ indHanging: null, indFirst: null });
    case 'keepNext': case 'pageBreakBefore': {
      const b = blocksOf().find(x => x.id === ids[0]);
      return para({ [name]: !resolvedPara(b || {}, effectiveStyles(doc()))[name] || null });
    }
    case 'bullets': case 'numbers': return ids.length && commitDoc(ctx, m => toggleList(m, ids, name === 'bullets' ? 'bullet' : 'number'), saved);
    case 'indent': case 'outdent': {
      const d = name === 'indent' ? 1 : -1;
      const b = blocksOf().find(x => x.id === ids[0]);
      return ids.length && commitDoc(ctx, m => b?.props?.list ? shiftListLevel(m, ids, d) : { ...m, blocks: shiftIndent(m.blocks, ids, d, effectiveStyles(m)) }, saved);
    }
    case 'restartNumbering': return ids[0] && commitDoc(ctx, m => restartNumbering(m, ids[0]), saved);
    case 'continueNumbering': return ids[0] && commitDoc(ctx, m => continueNumbering(m, ids[0]), saved);
    case 'strike': return toggleCharacter(el, ctx, 'strike');
    case 'sup': return toggleCharacter(el, ctx, 'sup', { sub: undefined });
    case 'sub': return toggleCharacter(el, ctx, 'sub', { sup: undefined });
    case 'smallCaps': return toggleCharacter(el, ctx, 'smallCaps', { caps: undefined });
    case 'caps': return toggleCharacter(el, ctx, 'caps', { smallCaps: undefined });
    case 'highlight': return applyCharacterFormat(el, ctx, { highlight: arg || undefined });
    case 'clearFormat': return applyCharacterFormat(el, ctx, Object.fromEntries(['font', 'sz', 'b', 'i', 'u', 'strike', 'color', 'highlight', 'sup', 'sub', 'caps', 'smallCaps'].map(k => [k, undefined])));
    case 'updateStyle': return ids[0] && commitDoc(ctx, m => updateStyleFromBlock(m, ids[0]), saved);
    case 'pageBreak': return insertText(el, ctx, '\n', (m, done) => { const b = m.blocks.find(x => x.id === done.caret.id); b.props = { ...(b.props || {}), pageBreakBefore: true }; });
    case 'sectionBreak': return insertText(el, ctx, '\n', (m, done) => {
      const i = m.blocks.findIndex(x => x.id === done.caret.id);
      const prev = m.blocks[i - 1];
      const later = m.blocks.slice(i).find(x => x.props?.section);
      prev.props = { ...(prev.props || {}), section: structuredClone(later ? later.props.section : { ...DEFAULT_SECTION, ...(m.section || {}), header: undefined, footer: undefined }) };
    });
    case 'footnote': case 'endnote': {
      const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      focusCell = { note: id, at: 0 };
      const ok = insertText(el, ctx, `{{fn:${id}}}`, m => { m.notes = { ...(m.notes || {}), [id]: { kind: name, runs: [{ t: '' }], text: '' } }; });
      if (ok) { selectionAfterRender = null; ctx.rerender(); }
      return;
    }
    case 'caption': {
      const cap = { ...blankBlock('p'), styleId: 'Caption', runs: [{ t: `${arg} {{seq:${arg}}}. ` }], text: `${arg} {{seq:${arg}}}. ` };
      return insertBlocksAfter(ctx, [cap], ids.at(-1) || caretBlock, { start: { id: cap.id, at: cap.text.length }, end: { id: cap.id, at: cap.text.length } });
    }
    case 'xref': return insertText(el, ctx, `{{xref:${arg}}}`);
    case 'toc': return insertBlocksAfter(ctx, [{ id: blankBlock().id, type: 'toc', text: '' }], null, null);
    case 'bib': return !blocksOf().some(b => b.type === 'bib') && insertBlocksAfter(ctx, [{ id: blankBlock().id, type: 'bib', text: '' }], null, null);
    case 'comment': return (async () => {
      const held = saved;
      const text = await ask('Comment', { confirm: 'Add' });
      if (!text?.trim()) return;
      const id = `c${Date.now().toString(36)}`;
      const c = { author: authorName(), initials: String(settings().reviewerInitials || '').replace(/\W/g, ''), date: nowStamp(), text: text.trim() };
      activeComment = id;
      // On selected text the comment covers it; at a bare caret it is a mark at that point.
      if (held && (held.start.id !== held.end.id || held.start.at !== held.end.at))
        commitDoc(ctx, m => { m.blocks = markComment(m.blocks, held.start, held.end, id); m.comments = { ...(m.comments || {}), [id]: c }; return m; }, held);
      else insertText(el, ctx, `{{cm:${id}}}`, m => { m.comments = { ...(m.comments || {}), [id]: c }; });
    })();
    case 'abstractHeadings': return insertAbstractHeadings(submissionApi(el, ctx));
    case 'statements': return insertDeclarationStatements(submissionApi(el, ctx));
    case 'declarations': return openDeclarations(submissionApi(el, ctx));
    case 'table': return insertTableDialog(ctx);
    case 'figure': return insertFigure(ctx);
    case 'citation': return openTool(ctx, 'cite');
    case 'result': return openTool(ctx, 'results');
    case 'deleteObject': return commitDoc(ctx, m => { m.blocks = m.blocks.filter(x => x.id !== arg); if (!m.blocks.length) m.blocks.push(blankBlock('p')); return m; }, null);
    case 'find': return openFind(el, ctx, false);
    case 'paragraphDialog': return paragraphDialog(el, ctx);
    case 'styleDialog': return styleDialog(el, ctx);
    case 'pageSetup': return pageSetupDialog(el, ctx);
    case 'fontDialog': return fontDialog(el, ctx);
    case 'headerFooter': return headerFooterDialog(ctx);
    case 'lineNumbers': return commitDoc(ctx, m => {
      const set = s => ({ ...s, lineNumbers: arg ? { countBy: 1, distance: 18, ...(s?.lineNumbers || {}), restart: arg } : null });
      m.section = set({ ...DEFAULT_SECTION, ...(m.section || {}) });
      m.blocks = m.blocks.map(b => b.props?.section ? { ...b, props: { ...b.props, section: set(b.props.section) } } : b);
      return m;
    }, null);
    case 'showChanges': showChanges = !showChanges; return ctx.rerender();
    case 'trackChanges': return commitDoc(ctx, m => { m.trackChanges = !m.trackChanges; return m; }, saved);
    case 'accept': case 'reject': {
      // With the caret in a table cell, the cell's text, its row and its column are decided.
      const cell = arg !== 'all' && !saved && caretCell && blocksOf().some(x => x.id === caretCell.id) ? caretCell : null;
      if (cell) return commitDoc(ctx, m => { m.blocks = decideInCell(m.blocks, cell.id, cell.r, cell.c, name); return m; }, null);
      return commitDoc(ctx, m => { m.blocks = decideChanges(m.blocks, name, arg === 'all' ? null : saved); return m; }, arg === 'all' ? null : saved);
    }
    // table: rows and columns inserted or deleted while tracking are marked until decided
    case 'rowAbove': case 'rowBelow': { const below = name === 'rowBelow', ch = tracking(); return cellAction(ctx, (b, r) => ch ? trackInsertRow(b, r, below, ch) : insertRow(b, r, below)); }
    case 'colLeft': case 'colRight': { const right = name === 'colRight', ch = tracking(); return cellAction(ctx, (b, r, c) => ch ? trackInsertColumn(b, r, c, right, ch) : insertColumn(b, r, c, right)); }
    case 'deleteRow': { const ch = tracking(); return cellAction(ctx, (b, r) => (ch ? trackDeleteRow(b, r, ch) : deleteRow(b, r)) ?? null); }
    case 'deleteCol': { const ch = tracking(); return cellAction(ctx, (b, r, c) => { const k = ownerOf(b.grid, r, c)[1]; return (ch ? trackDeleteColumn(b, k, ch) : deleteColumn(b, k)) ?? null; }); }
    case 'deleteTable': return cellAction(ctx, () => null);
    case 'mergeRight': return cellAction(ctx, (b, r, c) => mergeCells(b, r, c, 'right') ?? undefined);
    case 'mergeDown': return cellAction(ctx, (b, r, c) => mergeCells(b, r, c, 'down') ?? undefined);
    case 'split': return cellAction(ctx, (b, r, c) => splitCell(b, r, c) ?? undefined);
    case 'headerRow': return cellAction(ctx, b => setHeaderRow(b, !b.grid.rows[0].header));
    case 'borders': return cellAction(ctx, b => setBorders(b, arg));
    case 'distribute': return cellAction(ctx, b => distributeColumns(b));
    case 'widths': return columnWidthsDialog(ctx);
    case 'figureWidth': {
      const b = blocksOf().find(x => x.id === caretBlock && x.type === 'figure');
      if (!b) return;
      const sec = sectionAtCaret().sec, width = (sec.pageW - sec.left - sec.right) * arg;
      return commitDoc(ctx, m => { m.blocks = m.blocks.map(x => x.id === b.id ? { ...x, w: width, h: width * (b.h / b.w) } : x); return m; }, null);
    }
  }
}

const HIGHLIGHTS = [['yellow', 'Yellow'], ['green', 'Green'], ['cyan', 'Turquoise'], ['magenta', 'Pink'], ['lightGray', 'Grey']];
/** The items of one of the strip's menus (Paragraph, Insert, Table, Layout, Review live in its More) and of the menu bar. */
function menuItems(el, ctx, name) {
  const cmd = (label, id, arg, extra = {}) => ({ label, run: () => runCommand(el, ctx, id, arg), ...extra });
  const { ids } = targets(el);
  const b = blocksOf().find(x => x.id === ids[0]);
  const p = b ? resolvedPara(b, effectiveStyles(doc())) : {};
  const cellOn = !!caretCell && blocksOf().some(x => x.id === caretCell.id);
  const fig = blocksOf().find(x => x.id === caretBlock && x.type === 'figure');
  const lineIs = props => Object.entries(props).every(([k, v]) => p[k] === v) && p.lineExact == null && p.lineAtLeast == null;
  const MENUS = {
    char: () => [
      ...['bold', 'italic', 'underline'].map(fmt => ({ label: fmt[0].toUpperCase() + fmt.slice(1), run: () => el.querySelector(`[data-fmt="${fmt}"]`).click() })), '-',
      cmd('Strikethrough', 'strike'), cmd('Superscript', 'sup'), cmd('Subscript', 'sub'),
      cmd('Small capitals', 'smallCaps'), cmd('All capitals', 'caps'), cmd('Font settings…', 'fontDialog'),
      { label: 'Highlight', submenu: [...HIGHLIGHTS.map(([k, l]) => cmd(l, 'highlight', k)), cmd('No highlight', 'highlight', null)] },
      '-', cmd('Clear formatting', 'clearFormat')],
    align: () => [['left', 'Align left'], ['center', 'Centre'], ['right', 'Align right'], ['both', 'Justify']].map(([k, l]) => cmd(l, 'align', k, { checked: (p.jc || 'left') === k })),
    list: () => [cmd('Bulleted list', 'bullets'), cmd('Numbered list', 'numbers'), cmd('Decrease indent', 'outdent'), cmd('Increase indent', 'indent')],
    para: () => [
      { label: 'Line spacing', submenu: [...LINE_SPACING.map(x => cmd(x.label, 'line', x.props, { checked: lineIs(x.props) })), cmd('Exactly…', 'paragraphDialog'), cmd('At least…', 'paragraphDialog')] },
      { label: 'Space before', submenu: [0, 6, 12, 18, 24].map(n => cmd(`${n} pt`, 'before', n, { checked: (p.before || 0) === n })) },
      { label: 'Space after', submenu: [0, 6, 8, 10, 12].map(n => cmd(`${n} pt`, 'after', n, { checked: (p.after || 0) === n })) },
      { label: 'Indentation', submenu: [cmd('First line 0.5 in', 'firstLine', 36, { checked: p.indFirst === 36 }), cmd('Hanging 0.5 in', 'hanging', 36, { checked: p.indHanging === 36 }), cmd('No special indent', 'noSpecial'), cmd('Increase indent', 'indent'), cmd('Decrease indent', 'outdent')] },
      { label: 'List', submenu: [cmd('Bulleted', 'bullets'), cmd('Numbered', 'numbers'), cmd('Restart numbering', 'restartNumbering', null, { disabled: !b?.props?.list }), cmd('Continue numbering', 'continueNumbering', null, { disabled: !b?.props?.list })] },
      '-', cmd('Keep with next', 'keepNext', null, { checkType: 'checkbox', checked: !!p.keepNext }), cmd('Page break before', 'pageBreakBefore', null, { checkType: 'checkbox', checked: !!p.pageBreakBefore }),
      '-', cmd('Paragraph settings…', 'paragraphDialog'), cmd('Update style to match', 'updateStyle'), cmd('Modify style…', 'styleDialog')],
    insert: () => {
      const targets2 = captionTargets(blocksOf());
      return [
        { label: 'Tables and figures', submenu: [cmd('Table…', 'table'), cmd('Figure…', 'figure'), { label: 'Caption', submenu: [cmd('Figure', 'caption', 'Figure'), cmd('Table', 'caption', 'Table')] }] },
        { label: 'References', submenu: [cmd('Citation', 'citation'), cmd('Reference list', 'bib', null, { disabled: blocksOf().some(x => x.type === 'bib') }), { label: 'Cross-reference', submenu: targets2.length ? targets2.map(t => cmd(`${t.label}${t.text ? ` ${t.text.slice(0, 40)}` : ''}`, 'xref', t.id)) : [{ label: 'No captions', disabled: true }] }] },
        { label: 'Notes and comments', submenu: [cmd('Footnote', 'footnote'), cmd('Endnote', 'endnote'), cmd('Comment…', 'comment')] },
        { label: 'Document structure', submenu: [cmd('Page break', 'pageBreak'), cmd('Section break', 'sectionBreak'), cmd('Table of contents', 'toc'), cmd('Abstract headings', 'abstractHeadings', null, { disabled: !canInsertAbstract(blocksOf()) })] },
        { label: 'Research content', submenu: [cmd('Result', 'result'), cmd('Declaration statements', 'statements'), cmd('Declarations…', 'declarations')] },
      ];
    },
    table: () => [cmd('Insert table…', 'table'), '-',
      { label: 'Rows and columns', disabled: !cellOn, submenu: [['Row above', 'rowAbove'], ['Row below', 'rowBelow'], ['Column left', 'colLeft'], ['Column right', 'colRight']].map(([l, id]) => cmd(l, id)) },
      { label: 'Merge and split', disabled: !cellOn, submenu: [['Merge with right', 'mergeRight'], ['Merge with below', 'mergeDown'], ['Split cell', 'split']].map(([l, id]) => cmd(l, id)) },
      { label: 'Table formatting', disabled: !cellOn, submenu: [cmd('Header row', 'headerRow', null, { checked: cellOn && !!blocksOf().find(x => x.id === caretCell.id)?.grid?.rows[0]?.header }), { label: 'Borders', submenu: [cmd('All', 'borders', 'all'), cmd('Top and bottom rules', 'borders', 'apa'), cmd('None', 'borders', 'none')] }, cmd('Distribute columns', 'distribute'), cmd('Column widths…', 'widths')] },
      { label: 'Delete', disabled: !cellOn, submenu: [['Delete row', 'deleteRow'], ['Delete column', 'deleteCol'], ['Delete table', 'deleteTable']].map(([l, id]) => cmd(l, id)) },
      ...(fig ? ['-', { label: 'Figure width', submenu: [0.25, 0.5, 0.75, 1].map(f => cmd(`${f * 100}% of text width`, 'figureWidth', f)) }] : [])],
    layout: () => {
      const ln = (doc().section || {}).lineNumbers?.restart || '';
      return [cmd('Page setup…', 'pageSetup'), cmd('Header and footer…', 'headerFooter'),
        { label: 'Line numbers', submenu: [cmd('None', 'lineNumbers', null, { checked: !ln }), cmd('Continuous', 'lineNumbers', 'continuous', { checked: ln === 'continuous' }), cmd('Restart each page', 'lineNumbers', 'newPage', { checked: ln === 'newPage' }), cmd('Restart each section', 'lineNumbers', 'newSection', { checked: ln === 'newSection' })] },
        cmd('Section break', 'sectionBreak'), cmd('Page break', 'pageBreak')];
    },
    review: () => {
      const sum = changeSummary(blocksOf());
      const parts = [[sum.ins, 'insertion'], [sum.del, 'deletion'], [sum.fmt, 'formatting change'], [sum.rows, 'row'], [sum.cols, 'column']].filter(([k]) => k).map(([k, l]) => plural(k, l));
      return [cmd('Track changes', 'trackChanges', null, { checkType: 'checkbox', checked: !!doc().trackChanges }), '-',{ heading: sum.total ? `${parts.join(', ')}${sum.authors.length ? `; ${sum.authors.slice(0, 2).join(', ')}` : ''}` : 'No tracked changes' },
        cmd('Show changes', 'showChanges', null, { checked: showChanges }),
        cmd('Accept in selection', 'accept', null, { disabled: !sum.total }), cmd('Reject in selection', 'reject', null, { disabled: !sum.total }),
        cmd('Accept all', 'accept', 'all', { disabled: !sum.total }), cmd('Reject all', 'reject', 'all', { disabled: !sum.total }),
        '-', cmd('Comment…', 'comment')];
    },
    history: () => [{ label: 'Undo', run: () => { if (!undoFormatting(false, ctx)) document.execCommand('undo'); } }, { label: 'Redo', run: () => { if (!undoFormatting(true, ctx)) document.execCommand('redo'); } }],
    find: () => [cmd('Find and replace', 'find')],
  };
  return MENUS[name]?.() || [];
}
const MENU_TITLES = { char: 'Text formatting', align: 'Alignment', list: 'Lists', para: 'Paragraph', insert: 'Insert', table: 'Table', layout: 'Layout', review: 'Review', history: 'Edit', find: 'Find' };

/**
 * The menu bar's menus while the manuscript is in view (desktop): Format,
 * Insert, Table and Review, from the same commands as the toolbar's menus.
 * Paragraph-level marks (alignment, spacing) are left unchecked: the menu is
 * built when the view changes, not when the caret moves.
 */
export function menus(ctx) {
  if (!mounted || !blocksOf().length) return [];
  const el = mounted;
  const native = (items, marks = false) => items.filter(x => x && !x.heading).map(x => x === '-' ? '-'
    : x.submenu ? { label: x.label, items: native(x.submenu, marks) }
    : { label: x.label, run: x.run, enabled: !x.disabled, ...(marks && typeof x.checked === 'boolean' ? { checked: x.checked } : {}) });
  const M = name => menuItems(el, ctx, name);
  const ch = key => ({ run: () => toggleCharacter(el, ctx, key) });
  return [
    { title: 'Format', items: [
      { label: 'Bold', accel: 'CmdOrCtrl+B', ...ch('b') }, { label: 'Italic', accel: 'CmdOrCtrl+I', ...ch('i') }, { label: 'Underline', accel: 'CmdOrCtrl+U', ...ch('u') },
      ...native(M('char')), '-', { label: 'Alignment', items: native(M('align')) }, { label: 'Lists', items: native(M('list')) }, '-', ...native(M('para')),
      '-', { label: 'Declarations…', run: () => runCommand(el, ctx, 'declarations') }] },
    { title: 'Insert', items: native(M('insert')) },
    { title: 'Table', items: native(M('table')) },
    { title: 'Review', items: native(M('review'), true) },
  ];
}

/** Word and character counts, as a journal counts them: without the reference list. */
function countItems(el) {
  const c = documentCounts(blocksOf()), { counts: s } = structure();
  const row = (label, v) => ({ label, meta: v, run: () => {} });
  const sel = getSelection();
  const selWords = sel && !sel.isCollapsed && el.querySelector('#page')?.contains(sel.anchorNode) ? String(sel).split(/\s+/).filter(Boolean).length : 0;
  return [
    ...(s.title ? [row('Title', plural(s.title.characters, 'character'))] : []),
    ...(s.abstract.index != null ? [row('Abstract', plural(s.abstract.words, 'word'))] : []),
    row('Main text', plural(s.main.words, 'word')),
    ...(selWords ? [row('Selected', plural(selWords, 'word'))] : []),
    { heading: 'Whole document' }, row('Characters', n(c.chars)), row('Without spaces', n(c.charsNoSpaces)),
    ...(s.excluded.length ? [{ heading: 'Not counted in the main text' }, ...s.excluded.map(e => row(e.label, e.role === 'references' ? plural(e.items, 'reference') : e.role === 'tables' ? plural(e.items, 'table') : plural(e.words, 'word')))] : []),
  ];
}

/** Tab and Shift+Tab between cells; Tab in the last cell adds a row. */
function moveCell(page, box, dir, ctx) {
  const cells = [...page.querySelectorAll(`.mb-cell[data-b="${CSS.escape(box.dataset.b)}"]`)];
  const k = cells.indexOf(box) + dir;
  if (k >= cells.length) {
    const r = +box.dataset.r;
    caretCell = { id: box.dataset.b, r, c: +box.dataset.c };
    focusCell = { id: box.dataset.b, r: r + 1, c: 0, at: 0 };
    cellAction(ctx, (b, rr) => insertRow(b, rr, true));
    return;
  }
  const next = cells[Math.max(0, k)];
  next.focus();
  const range = document.createRange(); range.selectNodeContents(next);
  getSelection().removeAllRanges(); getSelection().addRange(range);
}

// ---- comments in the margin ------------------------------------------------------------
//
// Comments stand in a column beside the page, each level with the text it is
// on and pushed down when the one above needs the room, as in Word's markup
// view. The column scrolls with the document: one scroller.

function renderComments(el, ctx) {
  const wrap = el.querySelector('#ms-scroll'), page = el.querySelector('#page');
  if (!wrap || !page) return;
  wrap.querySelector('.ms-comments')?.remove();
  const list = commentOrder(blocksOf(), doc().comments || {});
  wrap.classList.toggle('has-comments', list.length > 0);
  if (!list.length) return;
  const col = commentColumn(list, { active: activeComment, actions: true });
  wrap.append(col);
  positionComments(el);
  highlightComment(el, activeComment);
  col.querySelectorAll('[data-cm-card]').forEach(card => {
    const id = card.dataset.cmCard;
    card.onclick = e => { if (!e.target.closest('button')) focusComment(el, id); };
    card.querySelector('[data-cm-reply]').onclick = async () => {
      const text = await ask('Reply', { confirm: 'Reply' });
      if (!text?.trim()) return;
      activeComment = id;
      commitDoc(ctx, m => { m.comments = { ...(m.comments || {}), [`c${Date.now().toString(36)}`]: { author: authorName(), initials: String(settings().reviewerInitials || '').replace(/\W/g, ''), date: nowStamp(), text: text.trim(), parent: id } }; return m; }, null);
    };
    card.querySelector('[data-cm-done]').onclick = () => commitDoc(ctx, m => { const c = m.comments?.[id]; if (c) { if (c.done) delete c.done; else c.done = true; } return m; }, null);
    card.querySelector('[data-cm-del]').onclick = () => commitDoc(ctx, m => {
      m.blocks = removeComment(m.blocks, id);
      for (const [k, c] of Object.entries(m.comments || {})) if (k === id || c.parent === id) delete m.comments[k];
      return m;
    }, null);
  });
}

/** Each card level with the start of its text, below the card above it (lib/comment-column.mjs). */
const positionComments = el => positionColumn(el.querySelector('#ms-scroll'), el.querySelector('#page'));
const highlightComment = (el, id) => markCommentShown(el.querySelector('#ms-scroll'), el, id);

/** Bring a comment forward: its card marked, its text marked. */
function focusComment(el, id) {
  activeComment = id;
  highlightComment(el, id);
  el.querySelector(`[data-cm-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---- find and replace -------------------------------------------------------------------

function findRange(page, m) {
  if (m.cell) {
    const box = page.querySelector(`.mb-cell[data-b="${CSS.escape(m.id)}"][data-r="${m.cell[0]}"][data-c="${m.cell[1]}"]`);
    if (!box) return null;
    const r = document.createRange(); r.setStart(...pointAt(box, m.start)); r.setEnd(...pointAt(box, m.end)); return r;
  }
  const a = blockPoint(page, m.id, m.start), z = blockPoint(page, m.id, m.end);
  if (!a || !z) return null;
  const r = document.createRange(); r.setStart(...a); r.setEnd(...z); return r;
}

function openFind(el, ctx, replace) {
  findState.open = true;
  const bar = el.querySelector('#ms-find');
  if (!bar) return;
  bar.hidden = false;
  const sel = String(getSelection() || '').trim();
  const q = bar.querySelector('#f-q');
  if (sel && !sel.includes('\n') && sel.length < 120) { q.value = sel; findState.query = sel; }
  (replace ? bar.querySelector('#f-r') : q).focus();
  q.select();
  refreshFind(el);
}

function refreshFind(el, move = 0) {
  const page = el.querySelector('#page'), bar = el.querySelector('#ms-find');
  if (!page || !bar) return [];
  const matches = findMatches(blocksOf(), findState.query, findState);
  if (!matches.length) findState.at = -1;
  else findState.at = ((findState.at < 0 ? 0 : findState.at + move) % matches.length + matches.length) % matches.length;
  bar.querySelector('#f-count').textContent = findState.query ? (matches.length ? `${findState.at + 1} of ${matches.length}` : 'No matches') : '';
  // Matches are highlighted without taking the selection from the find field.
  if (globalThis.CSS?.highlights && globalThis.Highlight) {
    const ranges = matches.map(m => findRange(page, m)).filter(Boolean);
    CSS.highlights.set('ms-find', new Highlight(...ranges.filter((_, k) => k !== findState.at)));
    const cur = findState.at >= 0 ? ranges[findState.at] : null;
    CSS.highlights.set('ms-find-current', cur ? new Highlight(cur) : new Highlight());
    (cur?.startContainer.nodeType === 1 ? cur.startContainer : cur?.startContainer.parentElement)?.scrollIntoView({ block: 'nearest' });
  }
  return matches;
}

function wireFind(el, ctx) {
  const bar = el.querySelector('#ms-find');
  if (!bar) return;
  const q = bar.querySelector('#f-q'), rep = bar.querySelector('#f-r');
  q.oninput = () => { findState.query = q.value; findState.at = -1; refreshFind(el); };
  rep.oninput = () => { findState.replace = rep.value; };
  const toggle = (id, key) => { const b = bar.querySelector(id); b.onclick = () => { findState[key] = !findState[key]; b.setAttribute('aria-pressed', String(findState[key])); refreshFind(el); }; };
  toggle('#f-case', 'caseSensitive'); toggle('#f-word', 'wholeWord');
  bar.querySelector('#f-next').onclick = () => refreshFind(el, 1);
  bar.querySelector('#f-prev').onclick = () => refreshFind(el, -1);
  const close = () => {
    findState.open = false; bar.hidden = true;
    CSS.highlights?.delete('ms-find'); CSS.highlights?.delete('ms-find-current');
    const m = findMatches(blocksOf(), findState.query, findState)[findState.at];
    const r = m && findRange(el.querySelector('#page'), m);
    if (r) { el.querySelector('#page').focus({ preventScroll: true }); getSelection().removeAllRanges(); getSelection().addRange(r); }
  };
  bar.querySelector('#f-close')?.addEventListener('click', close);
  bar.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target === q) { e.preventDefault(); refreshFind(el, e.shiftKey ? -1 : 1); }
  };
  const replace = all => {
    const matches = findMatches(blocksOf(), findState.query, findState);
    if (!matches.length) return;
    const chosen = all ? matches : [matches[Math.max(0, findState.at)]];
    commitDoc(ctx, m => { m.blocks = replaceMatches(m.blocks, chosen, findState.replace); return m; }, null);
    if (!all) findState.at -= 1;
    requestAnimationFrame(() => { const again = el.querySelector('#ms-find'); if (again) { again.hidden = false; refreshFind(el, all ? 0 : 1); } });
  };
  bar.querySelector('#f-one')?.addEventListener('click', () => replace(false));
  bar.querySelector('#f-all').onclick = () => replace(true);
  if (findState.open) refreshFind(el);
}

// ---- the tools: sections of the inspector ----------------------------------
// Cite, Insert a result, Checks (with Journal and Submission readiness), Files, Review and Sections are sections of the shell's inspector
// (inspect() above), not a panel of the page: the page keeps its width, the inspector docks or comes over it as it does for every view.

function sectionPanel(d) {
  const blocks = d.blocks || [];
  const outline = manuscriptOutline(d);
  // the paper's title, set as a heading, is not a section of it (lib/submission-checks.mjs reads it as the title)
  const roles = submissionRoles(blocks);
  outline.nodes = outline.nodes.filter(n => roles[n.index] !== 'title');
  const heads = outline.nodes.map(n => ({ b: n.block, i: n.index }));
  if (!heads.length) return emptyState({ title: 'No sections', size: 'inline' });
  const selected = heads.find(x => x.b.id === sectionPick) || heads[0];
  sectionPick = selected.b.id;
  const p = selected.b.props || {};
  const tree = (nodes, depth = 0) => `<ul class="ms-section-tree">${nodes.map(n => treeNode(n, depth)).join('')}</ul>`;
  const treeNode = (n, depth) => {
    const id = n.block.id, collapsed = sectionCollapsed.has(id);
    return `<li><div class="ms-section-item" style="--section-depth:${depth}">
      ${n.children.length ? `<button class="ms-section-toggle icon" data-ms-section-toggle="${esc(id)}" aria-label="${esc(`Subsections of ${headingText(n.block.text)}`)}" aria-expanded="${!collapsed}" aria-controls="ms-section-children-${esc(id)}">${icon(collapsed ? 'chevron-right' : 'chevron-down')}</button>` : '<span class="ms-section-toggle-space" aria-hidden="true"></span>'}
      <button type="button" data-ms-section="${esc(id)}"${id === selected.b.id ? ' class="on" aria-current="true"' : ''}><span>${esc(sentenceCase(headingText(n.block.text), keptNow()) || 'Untitled section')}</span><small${n.children.length ? ' title="Including subsections"' : ''}>${n.words} words</small></button></div>
      ${n.children.length ? `<div id="ms-section-children-${esc(id)}"${collapsed ? ' hidden' : ''}>${tree(n.children, depth + 1)}</div>` : ''}</li>`;
  };
  return `<div class="ms-sections">
    <nav aria-label="Manuscript sections">${tree(outline.roots)}</nav>
    <div class="ms-section-props"><h3>${esc(selected.b.text)}</h3>
      ${formField('Alignment', `<select data-ms-prop="jc"><option value="">From style</option><option value="left"${p.jc === 'left' ? ' selected' : ''}>Left</option><option value="center"${p.jc === 'center' ? ' selected' : ''}>Center</option><option value="both"${p.jc === 'both' ? ' selected' : ''}>Justified</option></select>`)}
      ${formField('Space before (pt)', `<input data-ms-prop="before" inputmode="numeric" maxlength="3" value="${Number.isFinite(Number(p.before)) ? Number(p.before) : 0}">`)}
      ${formField('Space after (pt)', `<input data-ms-prop="after" inputmode="numeric" maxlength="3" value="${Number.isFinite(Number(p.after)) ? Number(p.after) : 0}">`)}
      <label class="ms-section-check"><input data-ms-prop="pageBreakBefore" type="checkbox"${p.pageBreakBefore ? ' checked' : ''}>Start on new page</label>
    </div>
  </div>`;
}

function libraryRecords(s) {
  return (s.papers || []).map(p => ({ ...p, included: projectMode(s) === 'workspace' || isIncluded(s, p.id) }));
}

let refOrder = 'cited', refPage = 1;
const REF_PAGE = 6;
const RESULT_PAGE = 6;
const resultOpen = new Set(), resultPages = new Map();
let resultProject = null;
const ipdResultCategory = r => {
  const field = IPD_FIELDS.find(f => `ipd.${f.id}` === r.key);
  return field?.phase === 'Obtaining data'
    ? (field.id.includes('participants') ? 'Participant data' : 'Study data')
    : field?.phase || 'Other results';
};
// A result group's pager is named after its branch; this maps the pager's id back to the branch (rebuilt on every draw).
const resultPagers = new Map();
/** The results the search leaves, in the order the project lists them. */
const matchingResults = resultList => { const q = pick.toLowerCase(); return resultList.filter(r => !q || `${r.group} ${r.label} ${r.key} ${r.text}`.toLowerCase().includes(q)); };
/** Insert a result: one shared disclosure per group (and per IPD category), each a page of rows and the shared pager. */
function resultsBody(resultList) {
  syncProject();
  resultPagers.clear();
  const res = matchingResults(resultList);
  if (!res.length) return emptyState({ title: pick ? 'Nothing matches' : 'No results', size: 'inline' });
  const branch = (name, items, path, content) => disclosure({ title: name, count: items.length, body: content, open: resultOpen.has(path), className: 'ms-result-branch', attrs: { 'data-result-branch': path } });
  const rows = (name, items, path) => {
    const page = pageOf(items, resultPages.get(path) || 1, RESULT_PAGE);
    const id = `ms-res-${resultPagers.size + 1}`;
    resultPagers.set(id, path);
    // A result is a row (its name, its value under it); the row inserts it, from the pointer or with Enter.
    return `${uiList({ id: `${id}-rows`, label: name, attrs: { 'data-ms-results': true },
      rows: page.items.map(r => uiRow({ attrs: { 'data-ins-res': r.key, tabindex: 0 }, main: { html: esc(r.label), detail: [esc(r.text)] } })) })}
      ${pager({ id, page: page.page, pages: page.pages, total: items.length, label: 'results', size: RESULT_PAGE })}`;
  };
  const groups = [...new Set(res.map(r => r.group))];
  return `<div class="ms-result-groups">${groups.map(g => {
    const items = res.filter(r => r.group === g), path = JSON.stringify([g]);
    const content = g === 'PRISMA-IPD' && items.length > RESULT_PAGE
      ? `<div class="ms-result-subgroups">${[...new Set(items.map(ipdResultCategory))].map(category => {
        const branchItems = items.filter(r => ipdResultCategory(r) === category), branchPath = JSON.stringify([g, category]);
        return branch(category, branchItems, branchPath, rows(category, branchItems, branchPath));
      }).join('')}</div>` : rows(g, items, path);
    return branch(g, items, path, content);
  }).join('')}</div>`;
}
/** A project of its own starts with its groups closed and on their first pages. */
function syncProject() {
  if (resultProject !== projects().current) { resultProject = projects().current; resultOpen.clear(); resultPages.clear(); }
}
const REF_ORDERS = [['cited', 'Cited order'], ['az', 'A–Z']];

/** Cite: one search over references and results (the results are the next section's); under it the references, which a search redraws. */
function citeTool(library) {
  return `${uiBar({ kind: 'tools', label: 'Search references and results', id: 'ms-cite-tools',
    filters: [{ type: 'search', id: 'ms-pick', label: 'Search references and results', placeholder: 'Search references and results', value: pick, width: 'flex' }] })}
    <div id="ms-insert-body">${referencesBody(library)}</div>`;
}

/**
 * The references as one list: a head (how many are cited, the order) that picked references replace with their own bar in the
 * same place, the cited ones in the chosen order, then those not cited under their own quiet heading.
 */
function referencesBody(library) {
  syncProject();
  const q = pick.toLowerCase();
  const numbers = numbering(blocksOf(), withPackage(get(), blocksOf(), doc())), numbered = citationStyle() === 'numbered';
  // The references the manuscript can cite: included ones, those it already cites, and any others a search finds.
  const recs = library.filter(p => (q ? `${p.label} ${p.title} ${(p.authors || []).join(' ')}`.toLowerCase().includes(q) : p.included || numbers.has(p.key)));
  const az = (a, b) => String(a.label || a.title || a.key).localeCompare(String(b.label || b.title || b.key));
  const cited = recs.filter(p => numbers.has(p.key)).sort(refOrder === 'cited' ? (a, b) => numbers.get(a.key) - numbers.get(b.key) : az);
  const uncited = recs.filter(p => !numbers.has(p.key)).sort(az);
  const sorted = [...cited, ...uncited];
  if (!sorted.length) return emptyState({ icon: 'search', title: q ? 'Nothing matches' : 'Nothing to insert', size: 'inline' });
  if (revealKey) { const i = sorted.findIndex(p => p.key === revealKey); if (i >= 0) refPage = Math.floor(i / REF_PAGE) + 1; }
  const page = pageOf(sorted, refPage, REF_PAGE);
  refPage = page.page;

  const n = chosen.size;
  const head = uiRegion({ id: 'ms-ref-region', label: 'References', active: n ? 1 : 0, bars: [
    uiBar({ kind: 'head', label: 'References', id: 'ms-ref-head', status: { id: 'ms-ref-count', text: `${cited.length} of ${sorted.length} cited`, ch: 18 },
      actions: [{ picker: true, id: 'ms-ref-sort', label: 'Sort', role: 'quiet', icon: 'sort', value: REF_ORDERS.find(o => o[0] === refOrder)[1], options: REF_ORDERS }] }),
    uiBar({ kind: 'tools', label: 'Picked references', id: 'ms-cite-bar', status: { id: 'ms-cite-n', text: `${n} selected`, ch: 12 },
      actions: [{ id: 'cite-insert', label: 'Cite', role: 'primary' }, { id: 'cite-clear', label: 'Clear selection', icon: 'close', role: 'quiet', keep: true }] })] });
  // Those not cited follow under one quiet heading, drawn again at the top of each page they continue on.
  const rows = [];
  page.items.forEach((p, i) => {
    if (cited.length && !numbers.has(p.key) && (i === 0 || numbers.has(page.items[i - 1].key)))
      rows.push(uiBar({ kind: 'head', label: 'Not cited', id: 'ms-ref-uncited', cls: 'ms-ref-group', lead: { title: 'Not cited', level: 'h3' }, status: { id: 'ms-ref-uncited-n', text: String(uncited.length), ch: 4 } }));
    rows.push(refRow(p, numbers.get(p.key), numbered));
  });
  return `${uiList({ id: 'ms-ref-list', label: 'References', head, rows, attrs: { 'data-ms-refs': numbered ? 'numbered' : 'author-year' } })}
    ${pager({ id: 'ms-ref-pager', page: page.page, pages: page.pages, total: sorted.length, label: 'references', size: REF_PAGE })}`;
}

/** One reference: its number in the text (blank when not cited), its title, then who, where and the year in two lines at most; its actions in a menu. */
function refRow(p, num, numbered) {
  // who and where, then the year: one separator (the rows' own) with one gap
  const SEP = '<span class="ui-row-sep" aria-hidden="true"></span>';
  const who = [shortAuthors(p.authors), p.journalAbbr || p.journal].filter(Boolean).map(esc).join(SEP);
  const name = p.label || p.title || p.key;
  // The row is the target (a row of a list, as the start page's projects are): the pointer or Enter cites, so the fill, the ring and
  // the rules are the row's, More included. A picked row is filled and says so to a screen reader in its name.
  return uiRow({ cls: 'ms-ref-row', attrs: { 'data-cite-row': p.key, tabindex: 0, 'data-picked': chosen.has(p.key) ? 'true' : undefined, 'aria-label': `${chosen.has(p.key) ? 'Picked: ' : ''}${num != null && numbered ? `${num}. ` : ''}${p.title || name}` },
    main: { html: `<span class="ms-ref">${numbered ? `<span class="ms-ref-n">${num ?? ''}</span>` : ''}<span class="ms-ref-title" title="${esc(p.title || p.label || p.key)}">${esc(p.title || p.label || p.key)}</span><span class="ms-ref-meta" title="${esc([shortAuthors(p.authors), p.journalAbbr || p.journal, p.year].filter(Boolean).join(', '))}">${who ? `<span class="ms-ref-who">${who}</span>` : ''}${p.year ? `<span class="ms-ref-year">${who ? SEP : ''}${esc(p.year)}</span>` : ''}</span></span>` },
    end: uiRowEnd({ more: { label: `Actions for ${name}`, attrs: { 'data-ref-menu': p.id } } }) });
}

/** "Akgun, Mehmet Yigit" → "Akgun MY"; three or more authors end in et al. */
function shortAuthors(list) {
  const one = a => { const [last, first = ''] = String(a).split(','); return `${last.trim()} ${first.trim().split(/[\s.-]+/).filter(Boolean).map(w => w[0].toUpperCase()).join('')}`.trim(); };
  const a = (list || []).map(one).filter(Boolean);
  if (!a.length) return '';
  return a.length > 2 ? `${a[0]}, ${a[1]}, et al.` : a.join(', ');
}

const SEVERITY = { error: 'bad', warn: 'warn', note: 'ink-2' };

/** The checks Checks shows; the citation check (lib/reference-list.mjs) runs once for the list and the section. */
function railChecks(s, d, blocks, library, resultList) {
  const cites = checkCitations(blocks, { library, citationCheck: d.citationCheck || {} });
  const issues = checkManuscript(blocks, { library, results: resultList, snapshot: d.snapshot || {}, authors: (s.paper?.authors || []).map(a => a?.name || a).filter(Boolean), citationResult: cites });
  issues.push(...checkReferenceStyle(cites, { style: refStyle() }).issues);   // the list's style consistency: a group of its own, silent when consistent
  return { issues, cites };
}

// One heading per cause: the typed list's findings under four, the rest by kind.
const ISSUE_GROUP = { citation: 'Citations', result: 'Linked results', stale: 'Stale results',
  'source-stale': 'Analysis inputs', 'source-untracked': 'Analysis inputs',
  unlinked: 'Typed numbers', statistics: 'Statistics', uncited: 'Uncited references', abbreviation: 'Abbreviations',
  wording: 'Wording', structure: 'Structure', retracted: 'Retractions', preprint: 'Preprints', 'duplicate-record': 'Duplicate records',
  'reference-doi': 'Identifiers', 'reference-age': 'Reference age', 'self-citation': 'Self-citation',
  'ref-missing': 'Citations and list', 'ref-uncited': 'Citations and list', 'ref-order': 'Citations and list', 'ref-numbering': 'Citations and list',
  'ref-ambiguous': 'Citations and list', 'ref-duplicate': 'Citations and list', 'ref-unmatched': 'Library', 'ref-doi': 'Library',
  'ref-unresolved': 'Registries', 'ref-wrong-id': 'Registries', 'ref-chimeric': 'Registries', 'ref-author': 'Registries', 'ref-year': 'Registries',
  'ref-details': 'Registries', 'ref-style': 'Reference style', 'ref-title': 'Registries', 'ref-retracted': 'Retractions', 'ref-corrected': 'Retractions' };
const ORDER = { error: 0, warn: 1, note: 2 };
let citeOpen = false;      // arrived from Needs attention: the reference list's findings open
let citeBusy = '';         // what the registry lookup is doing, while it runs

/**
 * The typed reference list (a manuscript cited from Word): its count, when the registries last answered, and the two actions, Check
 * identifiers (Crossref and PubMed, asked only now) and Propose fixes (filed in Proposals); its findings (`groups`) under it.
 */
function citeSection(cites, groups) {
  if (!cites?.list.typed) return '';
  const reg = doc().citationCheck?.registry || {};
  const keys = [...new Set(cites.list.entries.map(registryKey).filter(Boolean))];
  const dates = keys.map(k => reg[k]?.at).filter(Boolean).sort();
  const fixes = citationFixes(get(), cites, { style: refStyle() }).length;
  const message = citeBusy || (dates.length ? `Registries checked ${day(dates.at(-1))}` : 'Registries not checked');
  return `<section class="ms-refcheck" aria-labelledby="ms-refcheck-title">${uiBar({ kind: 'head', id: 'ms-refcheck-bar', label: 'Reference list', lead: { title: 'Reference list', level: 'h3', id: 'ms-refcheck-title' },
    status: { id: 'ms-refcheck-count', text: plural(cites.list.entries.length, 'entry', 'entries'), ch: 12 },
    actions: [{ id: 'ms-refcheck-verify', label: 'Check identifiers', icon: 'globe', disabled: !keys.length || !!citeBusy },
      { id: 'ms-refcheck-fix', label: 'Propose fixes', icon: 'proposals', disabled: !fixes || !!citeBusy }],
    overflow: [{ id: 'ms-refcheck-recheck', label: 'Check all identifiers again', disabled: !dates.length || !!citeBusy }] })}
    <p class="meta ms-refcheck-note" id="ms-refcheck-note">${esc(message)}</p>
    ${groups}</section>`;
}

/** A finding is a row; one that names a place in the text is a link to it, and the selected span is what the handler reads back (data-goto*). */
const issueRow = i => uiRow({ main: { wrap: true, html: i.blockId
  ? uiLink({ label: i.message, attrs: { 'data-goto': i.blockId, ...(i.at ? { 'data-goto-at': i.at } : {}), ...(i.text && i.at != null ? { 'data-goto-len': String(i.text).length } : {}) } })
  : esc(i.message) } });
function checksPanel(issues, cites = null) {
  // One heading per group, worst first: five "structure" rows say less than one "Structure" group with five lines under it.
  const groupsOf = (list, open = false) => {
    const groups = new Map();
    for (const i of list) {
      const name = ISSUE_GROUP[i.kind] || i.kind;
      const g = groups.get(name) || { name, severity: i.severity, items: [] };
      if (ORDER[i.severity] < ORDER[g.severity]) g.severity = i.severity;
      g.items.push(i);
      groups.set(name, g);
    }
    return [...groups.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).map(g => `<details class="ms-igroup ms-check-disclosure s-${esc(g.severity)}"${open ? ' open' : ''}>
      <summary><span>${esc(g.name)}</span><span class="meta">${g.items.length}</span></summary><div class="ms-check-items">
      ${uiList({ label: g.name, rows: [...g.items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).map(issueRow) })}</div></details>`).join('');
  };
  const typed = !!cites?.list.typed;
  const ref = i => typed && i.kind.startsWith('ref-');
  const rest = issues.filter(i => !ref(i));
  return `${citeSection(cites, groupsOf(issues.filter(ref), citeOpen))}
    ${rest.length ? groupsOf(rest) : issues.length ? '' : emptyState({ title: 'No issues', size: 'inline' })}`;
}

/** Asks Crossref and PubMed about the typed list's identifiers (only now, paced by lib/limiter.mjs) and keeps each answer with its date. */
async function checkIdentifiers(el, ctx, { force = false } = {}) {
  const s = get(), d = doc();
  const cites = checkCitations(d.blocks || [], { library: libraryRecords(s), citationCheck: d.citationCheck || {} });
  const entries = cites.list.entries.map(e => ({ ...e, rk: registryKey(e) })).filter(e => e.rk);
  if (!entries.length || citeBusy) return;
  const generation = projectGeneration();
  const say = text => { citeBusy = text; const m = el.querySelector('#ms-refcheck-note'); if (m) m.textContent = text; };
  say('Asking the registries');
  el.querySelectorAll('#ms-refcheck-verify, #ms-refcheck-fix').forEach(b => { b.disabled = true; });
  let r = null, error = '';
  try { r = await verifyIdentifiers(entries, { cache: d.citationCheck?.registry || {}, settings: settings(), force, onProgress: (k, n) => say(`Asking the registries, ${k} of ${n}`) }); }
  catch (err) { error = String(err?.message || err); }
  citeBusy = '';
  if (generation !== projectGeneration()) return;
  if (r && Object.keys(r.answers).length)
    update(st => { const cc = st.manuscript.citationCheck || {}; st.manuscript.citationCheck = { ...cc, registry: { ...(cc.registry || {}), ...r.answers } }; return st; });
  ctx.rerender(error ? `The lookup stopped: ${error}` : r.failed ? `${r.failed} ${r.failed === 1 ? 'lookup' : 'lookups'} failed; nothing was concluded from them` : r.asked ? 'Identifiers checked' : 'Every identifier was checked in the last 30 days');
}

/**
 * Supplementary tables and figures. Each is a file kept with the project and a
 * caption; its number follows its order. A token in the text, {{fig:id}} or
 * {{tab:id}}, renders as "Figure 2" / "Table S1" and renumbers as the list
 * changes, so a caption and its mention cannot drift apart.
 */
const ASSET_KINDS = [['figure', 'Figure'], ['table', 'Table'], ['supp-figure', 'Figure S'], ['supp-table', 'Table S']];
function assetLabel(a, assets) {
  const same = assets.filter(x => x.kind === a.kind);
  const n = same.findIndex(x => x.id === a.id) + 1;
  return `${ASSET_KINDS.find(k => k[0] === a.kind)?.[1] || 'Item'}${a.kind.startsWith('supp') ? '' : ' '}${n}`;
}
// The tables and figures the app draws that the text holds (views/paper-place.mjs inserts them): each by its place and what draws it, a link to it
const DRAWN_BY = { forest: 'Analysis', 'rob-traffic': 'Appraisal', 'rob-summary': 'Appraisal', prisma: 'Reporting', sof: 'Certainty', profile: 'Certainty', 'swim-table': 'Certainty', harvest: 'Certainty', output: 'Tables and figures', evidence: 'Extraction' };
function linkedList(blocks) {
  const n = { figure: 0, table: 0 }, rows = [];
  blocks.forEach((b, i) => {
    if (b.type !== 'figure' && b.type !== 'table') return;
    n[b.type]++;
    if (!b.app?.key) return;
    const label = `${b.type === 'figure' ? 'Figure' : 'Table'} ${n[b.type]}`;
    const cap = blocks[b.type === 'figure' ? i + 1 : i - 1];
    const title = b.type === 'figure' ? b.name : String(cap?.styleId === 'Caption' ? cap.text : '').replace(/^Table \{\{seq:Table\}\}\.\s*/, '');
    rows.push(uiRow({ attrs: { 'data-linked': b.id }, main: { html: uiLink({ label: `${label}: ${title || 'Untitled'}`, attrs: { 'data-goto': b.id } }), detail: [esc(`Drawn by ${DRAWN_BY[b.app.key.split(':')[0]] || 'the app'}`)] } }));
  });
  return rows.length ? `${uiBar({ kind: 'head', label: 'In the text', id: 'ms-linked-bar', lead: { title: 'In the text', level: 'h3' }, status: { id: 'ms-linked-count', text: String(rows.length), ch: 4 } })}${uiList({ id: 'ms-linked', label: 'Tables and figures in the text', rows })}` : '';
}
function assetsPanel(d) {
  const assets = d.assets || [];
  const head = uiBar({ kind: 'head', label: 'Files', id: 'ms-assets-bar', status: { id: 'ms-assets-count', text: plural(assets.length, 'file'), ch: 12 },
    actions: [{ id: 'ms-add-file', label: 'Add file', icon: 'plus', menu: true }] });
  return `${linkedList(d.blocks || [])}${head}
    ${assets.length ? assets.map(a => `<div class="ms-asset" data-asset="${esc(a.id)}">
      ${uiBar({ kind: 'head', label: assetLabel(a, assets), id: `ms-asset-${a.id}`, density: 'dense', lead: { title: assetLabel(a, assets), level: 'p' }, message: { text: a.name },
        actions: [{ id: `ms-asset-ins-${a.id}`, label: 'Insert reference', icon: 'link', role: 'quiet', attrs: { 'data-asset-ins': a.id } }, { id: `ms-asset-open-${a.id}`, label: 'Open', icon: 'open', role: 'quiet', attrs: { 'data-asset-open': a.id } }],
        overflow: [{ id: `ms-asset-del-${a.id}`, label: 'Remove', danger: true, attrs: { 'data-asset-del': a.id } }] })}
      ${/^image\//.test(a.type) ? `<img class="ms-asset-img" data-asset-img="${esc(a.id)}" alt="">` : ''}
      ${/\.csv$/i.test(a.name) ? `<div class="ms-grid" data-asset-grid="${esc(a.id)}"></div>` : ''}
      <input class="ms-asset-cap" data-asset-cap="${esc(a.id)}" value="${esc(a.caption || '')}" placeholder="Caption" aria-label="Caption for ${esc(a.name || assetLabel(a, assets))}" spellcheck="true">
    </div>`).join('')
    : ''}`;
}

/** A small CSV reader: quotes, escaped quotes, CRLF; rows padded to one width. */
function parseCsv(text) {
  const rows = [[]]; let field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { rows[rows.length - 1].push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows[rows.length - 1].push(field); field = ''; rows.push([]);
    } else field += ch;
  }
  rows[rows.length - 1].push(field);
  if (rows[rows.length - 1].every(c => c === '')) rows.pop();
  const w = Math.max(1, ...rows.map(r => r.length));
  return rows.map(r => [...r, ...Array(w - r.length).fill('')]);
}

/** Review: a bounded model pass on the focused paragraph, shown as a diff. */
let review = null;   // { blockId, hash, original, revised }
let reviewInstructions = '', reviewProject = null;
const DRAFT_SECTIONS = ['Methods', 'Results', 'Discussion', 'Abstract'];
let draftName = 'Methods';   // the section the Draft action writes
function reviewPanel() {
  const sectionDraft = doc().pendingDraft || null;
  const project = projects().current;
  if (reviewProject !== project) { reviewInstructions = ''; review = null; reviewProject = project; }
  const cfg = modelFor('write');
  const ready = Boolean(cfg?.provider && cfg?.model);
  const off = ready ? {} : { disabled: true };
  return `<div class="ms-review">
    <label class="ms-review-instructions"><span>Revision or draft instructions</span>
      <textarea id="rv-instructions" rows="3" maxlength="1200" spellcheck="true">${esc(reviewInstructions)}</textarea></label>
    ${uiBar({ kind: 'foot', label: 'Review actions', id: 'ms-review-bar',
      actions: [{ picker: true, id: 'rv-section', label: 'Section to draft', value: draftName, keep: true, options: DRAFT_SECTIONS.map(x => [x, x]), attrs: off },
        { id: 'rv-draft', label: 'Draft', icon: 'file-plus', keep: true, disabled: !ready },
        { id: 'rv-language', label: 'Revise paragraph', icon: 'draft', role: 'primary', disabled: !ready }] })}
    <div class="note" id="rv-note"></div>
    ${sectionDraft ? proposalBox({ id: 'rv-section-proposal', title: `${sectionDraft.name} draft`,
      meta: sectionDraft.model, accept: 'Insert', body: esc(sectionDraft.text) }) : ''}
    ${review ? `<div class="ms-diff" id="rv-diff">${diffWords(review.original, review.revised).map(w =>
        w.same != null ? esc(w.same) : w.del != null ? `<del>${esc(w.del)}</del>` : `<ins>${esc(w.ins)}</ins>`).join('')}</div>
      ${uiBar({ kind: 'foot', label: 'Revision', id: 'ms-revision-bar', actions: [{ id: 'rv-reject', label: 'Reject', icon: 'close' }, { id: 'rv-accept', label: 'Accept', icon: 'check', role: 'primary' }] })}` : ''}
  </div>`;
}

/** What the submission tools (views/manuscript-submission.mjs) may do to the document: one undoable step each. */
const submissionApi = (el, ctx) => ({ blocks: blocksOf, commit: (mutate, sel) => commitDoc(ctx, mutate, sel), rerender: msg => ctx.rerender(msg), status: msg => ctx.rerender(msg), go: k => ctx.go(k) });

/**
 * Wires whatever of the tools `el` holds: a section's body in the inspector (each section calls this on its own), or one a search or a
 * page change has just drawn again. The document is `mounted`, never `el`.
 */
function wireTool(el, ctx, deps) {
  const { library, resultList } = deps;
  wireSubmission(el, submissionApi(el, ctx));
  // --- the typed reference list: registry lookups only on this click; fixes are proposals
  el.querySelector('#ms-refcheck-verify')?.addEventListener('click', () => checkIdentifiers(el, ctx));
  el.querySelector('#ms-refcheck-recheck')?.addEventListener('click', () => checkIdentifiers(el, ctx, { force: true }));
  el.querySelector('#ms-refcheck-fix')?.addEventListener('click', () => {
    const filed = proposeCitationFixes(get(), { style: refStyle(), library: libraryRecords(get()) });
    ctx.rerender(filed ? `${plural(filed, 'fix', 'fixes')} in Proposals` : 'No fixes to propose');
    if (filed) ctx.openProposals?.();
  });
  // --- supplements
  const addAsset = kind => {
    const generation = projectGeneration(), owner = recoveryOwner();
    const i = document.createElement('input');
    i.type = 'file'; i.accept = kind.includes('table') ? '.csv,.xlsx,.xls,.docx,.pdf' : 'image/*,.pdf,.svg';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      const id = `as${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const fileHash = await putFile(`asset-${id}`, f, { owner });
      if (generation !== projectGeneration()) { ctx.rerender('The project changed; the supplement was not added.'); return; }
      update(s => { s.manuscript.assets = [...(s.manuscript.assets || []), { id, kind, name: f.name, type: f.type, size: f.size, caption: '', fileHash, assetRef: `sha256:${fileHash}` }]; return s; });
      ctx.rerender();
    };
    i.click();
  };
  el.querySelector('#ms-add-file')?.addEventListener('click', e => showMenu(e.currentTarget, ASSET_KINDS.map(([kind, label]) => ({ label: ({'supp-figure':'Supplementary figure','supp-table':'Supplementary table'})[kind] || label, run: () => addAsset(kind) }))));
  el.querySelectorAll('[data-asset-img]').forEach(async img => {
    const blob = await getFile(`asset-${img.dataset.assetImg}`).catch(() => null);
    if (!blob || !img.isConnected) return;
    const url = URL.createObjectURL(blob);
    img.onload = img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  });
  // A CSV supplement is a table: shown as a grid, edited in place, saved back
  // as CSV so the file in the bundle is the table that was edited.
  el.querySelectorAll('[data-asset-grid]').forEach(async host => {
    const id = host.dataset.assetGrid;
    const generation = projectGeneration(), owner = recoveryOwner();
    const blob = await getFile(`asset-${id}`).catch(() => null);
    if (!blob) return;
    const rows = parseCsv(await blob.text());
    if (!rows.length) rows.push(['']);
    const save = async () => {
      if (generation !== projectGeneration()) return;
      const csv = rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
      await putFile(`asset-${id}`, new Blob([csv], { type: 'text/csv' }), { owner });
    };
    const draw = () => {
      host.innerHTML = `<table class="ms-csv">${rows.map((r, ri) => `<tr>${r.map((c, ci) =>
        `<td contenteditable="true" data-r="${ri}" data-c="${ci}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
        ${uiBar({ kind: 'tools', label: 'Edit table', id: `ms-grid-bar-${id}`, density: 'dense', actions: [{ id: `ms-grid-row-${id}`, label: 'Add row', attrs: { 'data-grid-row': true } }, { id: `ms-grid-col-${id}`, label: 'Add column', attrs: { 'data-grid-col': true } }] })}`;
      let t = null;
      host.querySelectorAll('td[contenteditable]').forEach(td => td.oninput = () => {
        rows[+td.dataset.r][+td.dataset.c] = td.textContent;
        clearTimeout(t); t = setTimeout(save, 600);
      });
      host.querySelector('[data-grid-row]').onclick = () => { rows.push(rows[0].map(() => '')); save(); draw(); };
      host.querySelector('[data-grid-col]').onclick = () => { rows.forEach(r => r.push('')); save(); draw(); };
    };
    draw();
  });
  el.querySelectorAll('[data-asset-cap]').forEach(inp => inp.oninput = () =>
    update(s => { const a = (s.manuscript.assets || []).find(x => x.id === inp.dataset.assetCap); if (a) a.caption = inp.value; return s; }));
  el.querySelectorAll('[data-asset-open]').forEach(b => b.onclick = async () => {
    const blob = await getFile(`asset-${b.dataset.assetOpen}`).catch(() => null);
    if (!blob) return;
    saveFile(blob, (doc().assets || []).find(x => x.id === b.dataset.assetOpen)?.name || 'file');
  });
  el.querySelectorAll('[data-asset-del]').forEach(b => b.onclick = async () => {
    if (!await confirmAsk('Remove this supplement?', { confirm: 'Remove', danger: true })) return;
    await deleteFile(`asset-${b.dataset.assetDel}`).catch(() => {});
    update(s => { s.manuscript.assets = (s.manuscript.assets || []).filter(x => x.id !== b.dataset.assetDel); return s; });
    ctx.rerender();
  });
  el.querySelectorAll('[data-asset-ins]').forEach(b => b.onclick = () => {
    const a = (doc().assets || []).find(x => x.id === b.dataset.assetIns);
    if (!a) return;
    if (insertAtCaret(`{{${a.kind.includes('table') ? 'tab' : 'fig'}:${a.id}}}`)) ctx.rerender();
  });

  // --- review
  el.querySelector('#rv-instructions')?.addEventListener('input', e => { reviewInstructions = e.target.value; });
  const sectionPicker = el.querySelector('#rv-section');
  if (sectionPicker) {
    const chooseSection = name => { draftName = name; setPicker(sectionPicker, name); };
    sectionPicker.onclick = () => showMenu(sectionPicker, DRAFT_SECTIONS.map(x => ({ label: x, checked: x === draftName, run: () => chooseSection(x) })));
    sectionPicker.addEventListener('ui-pick', e => chooseSection(e.detail.value));
  }
  // A section drafted from the project's facts, inserted after its heading
  // (or at the end), for editing. The facts are the project context plus
  // what the section needs: the protocol, the searches, the pooled result.
  el.querySelector('#rv-draft')?.addEventListener('click', async () => {
    const name = draftName; const b = el.querySelector('#rv-draft'); b.disabled = true;
    const instructions = reviewInstructions.trim();
    const project = projects().current;
    const s2 = get(); const a = s2.analysis; const f = x => Number(x).toFixed(2);
    const facts = [projectContext(s2),
      `Protocol: ${JSON.stringify({ title: s2.protocol?.title, ...(s2.protocol?.pico || {}), criteria: (s2.protocol?.criteria || []).map(c => `${c.stage}: ${c.text}`) })}`,
      `Searches: ${(s2.searches || []).map(r => `${r.source || 'PubMed'} "${r.query}" ${r.at ? r.at.slice(0, 10) : ''} → ${r.total ?? '?'}`).join('; ') || 'none recorded'}`,
      a ? `Pooled ${a.measure} (${a.method}, k = ${a.k}): ${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]; I² ${Number(a.i2).toFixed(1)}%` : 'No pooled analysis',
      `PRISMA counts: ${JSON.stringify(prismaData(s2))}`].join('\n');
    try {
      const text = await draftSection(name, facts, modelFor('write'), { instructions });
      if (projects().current !== project) return;
      update(st => { st.manuscript.pendingDraft = { name, text, model: modelFor('write').model }; return st; });
      ctx.rerender();
    } catch (err) { el.querySelector('#rv-note').textContent = err.message.slice(0, 100); b.disabled = false; }
  });
  el.querySelector('#rv-section-proposal [data-accept]')?.addEventListener('click', () => {
    const draft = doc().pendingDraft; if (!draft) return;
    update(st => {
      const blocks = st.manuscript.blocks;
      const at = blocks.findIndex(x => x.type === 'h2' && x.text.trim().toLowerCase() === draft.name.toLowerCase());
      let end = at < 0 ? blocks.length : at + 1;
      while (end < blocks.length && !/^h[12]$/.test(blocks[end].type)) end++;
      if (at < 0) blocks.splice(end, 0, blankBlock('h2', draft.name), blankBlock('p', draft.text));
      else blocks.splice(end, 0, blankBlock('p', draft.text));
      delete st.manuscript.pendingDraft;
      return st;
    });
    ctx.rerender();
  });
  el.querySelector('#rv-section-proposal [data-discard]')?.addEventListener('click', () => {
    update(st => { delete st.manuscript.pendingDraft; return st; });
    ctx.rerender();
  });
  el.querySelector('#rv-language')?.addEventListener('click', async () => {
    const box = mounted?.querySelector('.mb-edit.on') || mounted?.querySelector('.mb-edit');
    const note = el.querySelector('#rv-note');
    if (!box) { note.textContent = 'Choose a paragraph'; return; }
    const b = blocksOf().find(x => x.id === box.dataset.b);
    if (!b || !b.text.trim()) { note.textContent = 'Choose a paragraph with text'; return; }
    const btn = el.querySelector('#rv-language'); btn.disabled = true;
    const instructions = reviewInstructions.trim();
    const project = projects().current;
    note.textContent = `~${Math.ceil((b.text.length + instructions.length) / 4) + 120} tokens`;
    try {
      const revised = await reviseParagraph(b.text, modelFor('write'), { instructions });
      if (projects().current !== project) return;
      review = { blockId: b.id, hash: hashText(b.text), original: b.text, revised };
      ctx.rerender();
    } catch (err) { note.textContent = err.message.slice(0, 120); btn.disabled = false; }
  });
  el.querySelector('#rv-accept')?.addEventListener('click', () => {
    // J5: the suggestion was made against a hash; text that has since changed
    // is not edited blind.
    const b = blocksOf().find(x => x.id === review?.blockId);
    if (!b || hashText(b.text) !== review.hash) { el.querySelector('#rv-note').textContent = 'The paragraph changed since; revise again'; review = null; ctx.rerender(); return; }
    update(s => { const x = s.manuscript.blocks.find(y => y.id === review.blockId); if (x) { x.text = review.revised; x.runs = [{ t: review.revised }]; } return s; });
    review = null; ctx.rerender();
  });
  el.querySelector('#rv-reject')?.addEventListener('click', () => { review = null; ctx.rerender(); });

  el.querySelectorAll('[data-ms-section]').forEach(b => b.onclick = () => {
    sectionPick = b.dataset.msSection;
    ctx.rerender();
    const box = mounted?.querySelector(`.mb-edit[data-b="${CSS.escape(sectionPick)}"]`);
    box?.scrollIntoView({ block: 'center' });
  });
  el.querySelectorAll('[data-ms-section-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.msSectionToggle;
    if (sectionCollapsed.has(id)) sectionCollapsed.delete(id); else sectionCollapsed.add(id);
    const collapsed = sectionCollapsed.has(id);
    b.setAttribute('aria-expanded', String(!collapsed));
    b.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down');
    document.getElementById(b.getAttribute('aria-controls')).hidden = collapsed;
  });
  el.querySelectorAll('[data-ms-prop]').forEach(control => control.onchange = () => {
    const id = sectionPick, key = control.dataset.msProp;
    update(s => {
      const b = s.manuscript.blocks.find(x => x.id === id);
      if (!b) return s;
      b.props = { ...(b.props || {}) };
      if (key === 'pageBreakBefore') b.props[key] = control.checked;
      else if (key === 'before' || key === 'after') b.props[key] = Math.max(0, Math.min(144, Number(control.value) || 0));
      else if (control.value) b.props[key] = control.value;
      else delete b.props[key];
      return s;
    });
    ctx.rerender();
  });

  // A row picks a reference; the bar inserts every picked one as one mark. A redraw gives the focus back to the control that had it.
  const redrawInsert = (focus = null) => {
    const body = el.querySelector('#ms-insert-body');
    if (!body) return;
    body.innerHTML = referencesBody(library);
    wireTool(el, ctx, deps);
    if (focus) body.querySelector(focus)?.focus({ preventScroll: true });
  };
  // The results are the next section's: drawn again where they are, with the count in the section's head.
  const redrawResults = () => {
    const body = document.getElementById('ms-results-body');
    if (!body) return;
    body.innerHTML = resultsBody(resultList);
    const meta = body.closest('.insp-sec')?.querySelector('.insp-head .meta');
    if (meta) meta.textContent = resultsMeta(resultList);
    wireTool(body.closest('.insp-body') || body, ctx, deps);
  };
  // A search redraws what is under it and the results, so the field keeps its focus and its caret.
  const filter = el.querySelector('#ms-pick');
  if (filter) {
    filter.oninput = () => {
      pick = filter.value; refPage = 1; resultPages.clear();
      redrawInsert(); redrawResults();
    };
  }
  el.querySelectorAll('[data-result-branch]').forEach(d => d.ontoggle = () => {
    if (!d.isConnected) return;
    const key = d.dataset.resultBranch;
    if (d.open) {
      resultOpen.add(key);
      // Expand only the requested category at each level, preserving its ancestors.
      [...d.parentElement.children].filter(sibling => sibling !== d && sibling.matches('details[data-result-branch]')).forEach(sibling => {
        sibling.open = false; resultOpen.delete(sibling.dataset.resultBranch);
      });
    } else resultOpen.delete(key);
  });
  resultPagers.forEach((path, id) => wirePager(el, id, p => { resultPages.set(path, p); redrawResults(); }));
  // The whole row cites its reference at the caret (its button is the keyboard's way in); with Command, Control or Shift it is
  // picked, to cite several as one mark. Pressing a row or its More leaves the caret in the page.
  el.querySelectorAll('[data-cite-row],[data-ref-menu],#cite-insert,#cite-clear,[data-ins-res]').forEach(b => b.onmousedown = e => e.preventDefault());
  const citeRow = (row, e, keyboard) => {
    const k = row.dataset.citeRow;
    if (e.metaKey || e.ctrlKey || e.shiftKey || chosen.size) {
      if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
      redrawInsert(keyboard ? `[data-cite-row="${CSS.escape(k)}"]` : null); return;
    }
    // Through the editing commands, so it can be undone and is tracked when changes are.
    if (mounted) insertText(mounted, ctx, citeToken(k), null, true);
  };
  el.querySelectorAll('[data-cite-row]').forEach(row => {
    row.onclick = e => { if (!e.target.closest('[data-ref-menu]')) citeRow(row, e, false); };
    row.onkeydown = e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); citeRow(row, e, true); } };
  });
  el.querySelectorAll('[data-ref-menu]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Preview', icon: 'file', run: () => ctx.openDocument(b.dataset.refMenu) },
    { label: 'Edit reference', icon: 'manuscript', run: () => editReference(b.dataset.refMenu, ctx) }], { align: 'end', minWidth: 170 }));
  // Sort is a picker: its menu from the head, and the folded form's entry (the engine sends ui-pick).
  if (revealKey) {
    const row = el.querySelector(`[data-cite-row="${CSS.escape(revealKey)}"]`);
    revealKey = null;
    if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }); }
  }
  const sortBtn = el.querySelector('#ms-ref-sort');
  if (sortBtn) {
    const setOrder = id => { if (!REF_ORDERS.some(o => o[0] === id)) return; refOrder = id; refPage = 1; redrawInsert('#ms-ref-sort'); };
    sortBtn.onclick = () => showMenu(sortBtn, REF_ORDERS.map(([id, label]) => ({ label, checked: id === refOrder, run: () => setOrder(id) })), { align: 'end' });
    sortBtn.addEventListener('ui-pick', e => setOrder(e.detail.value));
  }
  wirePager(el, 'ms-ref-pager', p => { refPage = p; redrawInsert(); });
  const clearBtn = el.querySelector('#cite-clear');
  if (clearBtn) clearBtn.onclick = () => { chosen.clear(); redrawInsert(); };
  const insBtn = el.querySelector('#cite-insert');
  if (insBtn) {
    insBtn.onmousedown = e => e.preventDefault();   // keep the caret in the page
    insBtn.onclick = () => {
      const keys = library.filter(p => chosen.has(p.key)).map(p => p.key);
      if (!keys.length) return;
      chosen.clear();
      if (mounted) insertText(mounted, ctx, keys.map(k => citeToken(k)).join(''), null, true);
    };
  }

  // Inserting a result also records the value it was inserted at, which is what
  // makes a later change detectable (plan J7).
  const insertResult = b => {
    const key = b.dataset.insRes;
    const r = resultList.find(x => x.key === key);
    if (!insertAtCaret(resultToken(key))) return;
    update(s => {
      s.manuscript.snapshot = { ...(s.manuscript.snapshot || {}), [key]: r?.text };
      return s;
    });
    ctx.rerender();
  };
  el.querySelectorAll('[data-ins-res]').forEach(b => {
    b.onclick = () => insertResult(b);
    b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertResult(b); } };
  });

  // A finding lands on its place: the citation marker it names is selected, an entry of the list starts at its first word.
  el.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => {
    const box = mounted?.querySelector(`.mb-edit[data-b="${CSS.escape(b.dataset.goto)}"]`);
    if (!box) return;
    const at = Number(b.dataset.gotoAt) || 0, len = Number(b.dataset.gotoLen) || 0;
    restoreTextSelection(mounted.querySelector('#page'), { start: { id: b.dataset.goto, at }, end: { id: b.dataset.goto, at: at + len } });
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

}

// ---- export ---------------------------------------------------------------

/**
 * The document as .docx, with the section and styles it came in with (or
 * Word-like defaults for a manuscript started here), citations rendered in the
 * chosen style, results as their values, and the reference list appended.
 */
/** An exported manuscript's file name: its own name, or the project's ("Spine fusion outcomes manuscript"), never a bare "manuscript". */
export const manuscriptFileName = (s, own = '') => String(own || '').replace(/\.docx$/i, '').trim()
  || `${String(projectName(s) || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 80)} manuscript`.trim();
export async function exportDocx(rerender, { blocks: given = null, suffix = '', comments = null } = {}) {
  // the linked tables and figures as their data are now (views/paper-place.mjs)
  if (!given && (get().manuscript?.blocks || []).some(b => b.app?.key)) await (await import('./paper-place.mjs')).refreshManuscript().catch(() => '');
  const generation = projectGeneration(), owner = recoveryOwner(), source = JSON.stringify(get().manuscript || null);
  const s = get(), d = structuredClone(s.manuscript || { blocks: [], snapshot: {} });
  const blocks = structuredClone(given || d.blocks || []), exportComments = structuredClone(comments || d.comments);
  const library = new Map(structuredClone(libraryRecords(s)).map(p => [p.key, p]));
  const res = new Map(structuredClone(allResults(s)).map(r => [r.key, r]));
  const numbers = numbering(blocks, withPackage(get(), blocks, d));
  const style = citationStyle(), numbered = style === 'numbered', referenceStyle = refStyle();
  const renderCite = keys => {
    const group = keys.map(key => ({ key, locator: '' }));
    const shown = formatGroup(group, library, numbers, { locator: false, style });
    return numbered ? shown.replace(/^\[|\]$/g, '') : shown;
  };
  // The list the document shows: cited works, table cells and notes included.
  const references = referenceList(library, numbers, { numbered, referenceStyle }).lines;
  // Figure images come from the project's files.
  const media = new Map();
  // Pictures in the text, and in the headers and footers of every section.
  const figures = manuscriptFigures(d, blocks), versions = new Map();
  try {
  for (const b of figures) {
    if (versions.has(b.img) && b.fileHash && versions.get(b.img) !== b.fileHash) throw new Error(`Figure ${b.name || b.img} names conflicting image versions.`);
    let fileHash = b.fileHash || versions.get(b.img);
    if (!fileHash) {
      fileHash = (await getFileReference(`img-${b.img}`, { owner }))?.hash;
      if (generation !== projectGeneration() || source !== JSON.stringify(get().manuscript || null)) throw new Error('The manuscript or project changed while verifying an older figure. Export the intended document again.');
      if (!fileHash) throw new Error(`Figure ${b.name || b.img} has no verified project-owned image. Reattach or reimport the intended file.`);
    }
    b.fileHash = fileHash; versions.set(b.img, fileHash);
    if (media.has(b.img)) continue;
    const blob = await getFile(`img-${b.img}`, { owner, expectedHash: fileHash });
    if (!blob) throw new Error(`Figure ${b.name || b.img} is unavailable. Reattach or reimport its image before exporting.`);
    media.set(b.img, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: b.mime || blob.type || 'image/png' });
  }
  const blob = await writeDocx({ blocks, section: d.section, styles: d.styles, lists: d.lists, notes: d.notes, comments: exportComments, media, trackChanges: !!d.trackChanges,
    renderCite, references, recordOf: k => library.get(k),
    renderResult: k => { const am = k.match(/^(fig|tab):(.+)$/); if (am) { const a = (d.assets || []).find(y => y.id === am[2]); return a ? assetLabel(a, d.assets || []) : null; } return res.get(k)?.text ?? null; } });
  await saveFile(blob, manuscriptFileName(s, d.name) + suffix + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if (!suffix && generation === projectGeneration()) rerender?.(`${blocks.length} paragraphs, ${references.length} references`);
  } catch (error) {
    if (generation === projectGeneration()) rerender?.(`Could not export: ${error.message}`);
    throw error;
  }
}

export function exportMarkdown() {
  const s = get();
  const blocks = blocksOf();
  const library = new Map(libraryRecords(s).map(p => [p.key, p]));
  const res = new Map(allResults(s).map(r => [r.key, r]));

  const numbers = numbering(blocks, withPackage(s, blocks, s.manuscript || {}));
  // The list stands where the document keeps it: its reference list block, else under its References heading.
  const MARK = '\u0000references';
  const roles = classifyStructure(blocks);
  const under = blocks.some(b => b.type === 'bib') ? -1 : roles.findIndex((r, i) => r === 'references' && /^h[1-3]$/.test(blocks[i].type));
  const placed = blocks.flatMap((b, i) => b.type === 'bib' ? [{ ...b, type: 'p', text: MARK }] : i === under ? [b, { id: 'refs', type: 'p', text: MARK }] : [b]);
  const opts = { cite: group => formatGroup(group, library, numbers), result: r => res.get(r.key)?.text ?? null };
  // Formatting, lists and tables are written from the blocks' runs; a citation run or a token in the text is rendered as the reader sees it.
  const body = toMarkdown(placed, { lists: s.manuscript?.lists, text: b => inlineMarkdown(b, r => (r.cite ? opts.cite(r.cite.map(key => ({ key }))) : renderText(r.t ?? '', opts))) });

  // Only what the manuscript cites goes in the list: in citation order for a
  // numbered style, alphabetical for author–year.
  const refs = referenceList(library, numbers).lines;
  const out = body.includes(MARK) ? body.replace(MARK, refs.join('\n')) : refs.length ? `${body}\n## References\n\n${refs.join('\n')}\n` : body;
  download(out, `${manuscriptFileName(s)}.md`, 'text/markdown');
}

// ---- toolbar --------------------------------------------------------------

async function exportBlindedDocx(rerender) {
  const generation = projectGeneration();
  const snapshot = () => JSON.stringify([get().manuscript || null, get().paper || null, libraryRecords(get()), citationStyle(), refStyle()]);
  const source = snapshot(), current = () => generation === projectGeneration() && source === snapshot();
  const status = text => { if (current()) rerender?.(text); };
  try {
    await exportBlinded(status, options => {
      if (!current()) throw new Error('The manuscript, author details or project changed during blinding review. Review the intended document again.');
      return exportDocx(status, options);
    }, structuredClone(libraryRecords(get())));
  } catch (error) { if (generation === projectGeneration()) rerender?.(`Could not export: ${error.message}`); }
}


/**
 * Import a draft: .docx (Mendeley citations become library records and
 * citation tokens) or Markdown. An existing manuscript is replaced only after
 * the user confirms; the records are merged into the library, never
 * duplicated, matched by the same key the search sources use.
 */
function importFile(rerender) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.docx,.md,.markdown,.txt';
  i.onchange = () => { if (i.files[0]) importManuscript(i.files[0], rerender); };
  i.click();
}

/** A .docx, Markdown or text file as the manuscript, after a yes if one exists. */
export async function importManuscript(file, rerender) {
  const generation = projectGeneration(), owner = recoveryOwner(), source = JSON.stringify(get().manuscript || null);
  const stored = []; let committed = false;
  const current = () => { if (generation !== projectGeneration() || source !== JSON.stringify(get().manuscript || null)) throw new Error('The project or manuscript changed. Choose the import again.'); };
  try {
    let blocks, records = [], citations = 0, section = null, styles = null, extra = {}, media = [];
    if (/\.docx$/i.test(file.name)) {
      const r = await parseDocx(new Uint8Array(await file.arrayBuffer()));
      blocks = r.blocks; records = r.records; citations = r.citations;
      section = r.section; styles = r.styles;
      extra = { lists: r.lists, notes: r.notes, comments: r.comments, trackChanges: r.trackChanges, results: r.results };
      media = r.media || [];
    } else { const md = parseMarkdown(await file.text()); blocks = md.blocks; extra = { lists: md.lists }; }
    current();
    if (!blocks.length) { rerender('Nothing readable in that file'); return; }
    if (blocksOf().length) {
      if (!await confirmAsk('Replace the current manuscript?', { detail: `${blocks.length} blocks from ${file.name}`, confirm: 'Replace', danger: true })) return;
      current();
    }
    // Parser-local image IDs must never replace another import's bytes.
    // Traverse shared header/footer parts once, including section breaks.
    const images = new Map(media.map(m => [m.id, { ...m, fresh: `im-${crypto.randomUUID()}` }]));
    const imported = { blocks, section, styles, ...extra }, seen = new WeakSet(), figures = [];
    const remap = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value);
      if (value.type === 'figure') {
        const m = images.get(value.img);
        if (!m?.bytes) throw new Error(`Figure ${value.name || value.img} has no image bytes in the imported file.`);
        value.img = m.fresh; delete value.fileHash; figures.push({ block: value, image: m }); m.used = true;
      }
      for (const child of Object.values(value)) remap(child);
    };
    remap(imported);
    for (const m of images.values()) if (m.used) {
      current(); stored.push(`img-${m.fresh}`);
      m.hash = await putFile(`img-${m.fresh}`, new Blob([m.bytes], { type: m.mime }), { owner }); current();
    }
    for (const { block, image } of figures) block.fileHash = image.hash;
    current();
    let added = 0;
    update(s => {
      for (const r of records)
        if (!s.papers.some(p => p.key === r.key)) { s.papers.push(r); added++; }
      // A linked result keeps the value the file showed, so a changed analysis shows it as stale.
      s.manuscript = { ...imported, snapshot: { ...(extra.results || {}) }, name: file.name };
      delete s.manuscript.results;
      return s;
    });
    committed = true;
    rerender(`${blocks.length} blocks, ${citations} citations, ${records.length} references, ${added} new in library`);
  } catch (err) {
    if (!committed) await Promise.allSettled(stored.map(id => deleteFile(id, { owner })));
    if (generation === projectGeneration()) rerender(`Could not import: ${err.message}`);
  }
}

/** A CSV table added to the manuscript's assets as its next table; returns the asset id. */
export async function addTableAsset(name, csvText, { caption = '' } = {}) {
  const generation = projectGeneration(), owner = recoveryOwner();
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const fileHash = await putFile(`asset-${id}`, new Blob([csvText], { type: 'text/csv' }), { owner });
  if (generation !== projectGeneration()) throw new Error('The project changed; the table was not added.');
  update(s => {
    s.manuscript = s.manuscript || { blocks: [], snapshot: {} };
    s.manuscript.assets = [...(s.manuscript.assets || []), { id, kind: 'table', name: name.endsWith('.csv') ? name : `${name}.csv`, type: 'text/csv', size: csvText.length, caption, fileHash, assetRef: `sha256:${fileHash}` }];
    return s;
  });
  return id;
}
