import { REGISTRY } from './registry.mjs';
import { foldSearch } from '../lib/search-ranking.mjs';
import { num } from '../lib/dates.mjs';
import { replaceRegions } from '../lib/local-region.mjs';
import { isIncluded, screeningStarted, finalDecision, isDual } from '../lib/screen.mjs';
import { settings } from '../lib/model-settings.mjs';
import { libraryAccessContext, paperAccessContext } from '../lib/assist.mjs';
import { nonEnglishLanguage } from '../lib/languages.mjs';
import { ensurePaperLanguages } from '../lib/language-enrichment.mjs';
// Library: records, the collections they are filed under, and their PDFs.
//
// File import is the default path because it works on every machine — the
// Zotero local API is read-only and off until the user enables it (plan 4.7).
import { showMenu } from '../lib/menu.mjs';
import { askItem } from '../lib/chat-attach-menu.mjs';
import { loadPdf } from '../lib/anchor.mjs';
import { retrievePaper, downloadingPaper, canRetrievePaper } from '../lib/paper-download.mjs';
import { toRisWithDecisions, toCsvWithDecisions, formattedBibliography } from '../lib/ref-export-extra.mjs';
import { openCheck, checkOpen, closeCheck, checkPanelHtml, wireCheckPanel, checkPage } from './library-checks.mjs';
import { zoteroItems, lookupDoi, matchTitle } from '../lib/sources.mjs';
import { saveFile } from '../lib/save.mjs';
import { sortRecords, pdfFilename, availabilityCounts } from '../lib/library-records.mjs';
import { get, update, projectGeneration, projects, getVersion } from '../store.mjs';
import { emptyFilters, recordFacts, applyFilters, filterSections, activeCount, withoutPart, toggle, lastYears, cleanYear, describeFilters, sectionSummary } from '../lib/record-filters.mjs';
import { esc, emptyState, abstractHtml } from '../lib/html.mjs';
import { ask, confirmAsk, formDialog } from '../lib/dialog.mjs';
import { toRis, toBibtex, toCsv } from '../lib/bib-export.mjs';
import { icon } from '../lib/icons.mjs';
import { parseRecords, authorLine, authorList, familyName, studyCell, journalShort, journalDisplay, recordsFromRows, looksLikeRecords } from '../lib/bib.mjs';
import { referenceDraft, startEdit, startAdd, takeReferenceSelection, referenceEditorHtml, wireReferenceEditor } from '../lib/reference-editor.mjs';
import { identify, similarity } from '../lib/pdfmeta.mjs';
import { lookupOpenAccess, oaUrl } from '../lib/open-access.mjs';
import { settingsOf, appValues, updateApp } from '../lib/app-settings.mjs';
import { formField } from '../lib/ui-components.mjs';
import { inDesktop, inHostedTab, openLink, pickDownloadFolderNative, savePdfToFolderNative, pickFolderNative, listPdfsNative, readFileNative } from '../lib/native.mjs';
import { runIdentification } from '../lib/identify.mjs';
import * as coll from '../lib/collections.mjs';
import { duplicateReview, resetDuplicateReview, merge, unmerge, markDistinct, undoDistinct } from '../lib/dedup.mjs';
import { putFile, putHandle, canLink, getBytes } from '../lib/files.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { filterPapers } from '../lib/paper-search.mjs';
import { importInto, libraryIndex } from '../lib/search-library.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { join, baseName, freeName } from '../lib/fsys.mjs';
import { papersDir, projectLayout } from '../lib/project-folder.mjs';
import { offers as watchOffers, settle as settleOffer, setWatchDir, watchState, onOffers } from '../lib/import-watch.mjs';
import { decodeImport, encodingNote, keepRawFile } from '../lib/import-safety.mjs';
import { researchType } from '../lib/workflow.mjs';
import { annotationsOf, sortAnnotations, annotationNoteText, KIND_LABEL } from '../lib/annotations.mjs';
import { addFileNote } from '../lib/file-notes.mjs';
import { loadIndex, indexStatus, startIndexing, pauseIndexing, resumeIndexing, rebuildIndex, queuePaper, onIndexChange, searchFullText, progressText } from '../lib/fulltext-index.mjs';
import { regionCanvas } from './reader-region.mjs';
import { readingMenuItems, readingPanel, wireReadingPanel } from './reading-ui.mjs';   // the reading list
import { uiBar, uiList, uiNotice, uiRegion, uiRow, uiRowEnd, inspectorActions, regionShow, watchWidth, menuAnchor } from '../lib/ui-actions.mjs';
import { disclosure, uiLink } from '../lib/ui-components.mjs';
import { duplicatesPage, pairsStack, PAIRS_PER_PAGE } from './library-pages.mjs';
import * as bars from './library-bars.mjs';
import { batchNoticeHtml, wireBatchNotice, countOpen } from './library-retrieval.mjs';   // the download notice, Retry failed and the report

const UNDO_NOTICE_MS = 30_000;
let undoNoticeTimer;
let compactRecords = true;

function libraryCitation(p) {
  const authors = authorLine(p.authors) || 'Authors not recorded';
  const journal = journalDisplay(journalShort(p) || p.journal) || 'Journal not recorded';
  const publication = [journal, p.year, p.volume ? `${p.volume}${p.issue ? `(${p.issue})` : ''}${p.pages ? `:${p.pages}` : ''}` : p.pages].filter(Boolean).join(' · ');
  // the PDF's state is a quiet word ("PDF", "Preview available"); finding or opening it is the row's More and the selection's Download PDFs
  const pdf = bars.pdfState(p, { downloading: downloadingPaper, inDesktop: inDesktop(), canRetrieve: canRetrievePaper }).note;
  return `<button class="study lib-citation" data-open="${esc(p.id)}" title="${esc(p.title || p.label || '')}">
    <span class="study-label">${esc(p.title || p.label || 'Untitled reference')}</span>
    <span class="lib-citation-compact">${esc([authors, p.year, pdf, nonEnglishLanguage(p.language)].filter(Boolean).join(' · '))}</span>
    <span class="lib-citation-authors" title="${esc(authorList(p.authors).join('; '))}">${esc(authors)}</span>
    <span class="lib-citation-publication" title="${esc(p.journal || '')}">${esc(publication)}</span>
    <span class="lib-citation-meta">${p.integrity?.notices?.length ? `<span class="status warn" role="img" aria-label="Retraction or correction notice" title="${esc(p.integrity.notices.map(n => `${n.type}: ${n.title}`).join('; '))}">${icon('warn', { size: 12 })}</span>` : ''}${nonEnglishLanguage(p.language) ? `<span class="paper-language">${esc(nonEnglishLanguage(p.language))}</span>` : ''}${pdf ? `<span class="lib-citation-pdf">${esc(pdf)}</span>` : ''}${p.doi ? `<span class="lib-citation-doi" title="DOI ${esc(p.doi)}">${esc(p.doi)}</span>` : ''}</span>
  </button>`;
}

export const usesDocument = true;
export const meta = { title: 'Library', icon: 'library' };
export const count = (...a) => REGISTRY.library.count(...a);
export function assistContext() {
  const s = get(); const papers = s.papers || [];
  const checked = papers.filter(x => selectedIds.has(x.id));
  const p = selectedPaper ? papers.find(x => x.id === selectedPaper) : checked.length === 1 ? checked[0] : null;
  const coll = selectedCollection ? autoOf(selectedCollection)?.name || (s.collections || []).find(c => c.id === selectedCollection)?.name : '';
  return [`${libraryAccessContext(papers)}${coll ? `; collection "${coll}"` : ''}${filter ? `; filter "${filter}"` : ''}${activeCount(filtersOf()) ? `; filters: ${describeFilters(filtersOf(), sectionsFor(get().papers))}` : ''}${showDuplicates ? '; duplicates shown' : ''}`,
    p ? `Record ${selectedPaper === p.id ? 'open' : 'selected'}: ${p.label} — ${p.title} (${(p.authors || []).slice(0, 3).join('; ')}${(p.authors || []).length > 3 ? ' et al.' : ''}; ${p.journal || ''} ${p.year || ''}; DOI ${p.doi || 'none'}; ${paperAccessContext(p)})${p.language ? `\nRecorded language: ${nonEnglishLanguage(p.language) || (/^en(?:glish)?$/i.test(p.language) ? 'English' : p.language)} (metadata; full-text language unverified)` : '\nRecorded language: unknown'}${p.abstract ? `\nAbstract: ${p.abstract.slice(0, 1200)}` : ''}` : checked.length ? `${checked.length} records selected; no single paper in focus` : 'No record selected'].join('\n');
}

let selectedCollection = null;   // null = everything
// Collections kept by the screening decisions themselves, never stale and never edited by hand.
const AUTO = {
  'auto:included': { name: 'Included', icon: 'check', papers: s => screeningStarted(s) ? (s.papers || []).filter(p => isIncluded(s, p.id)) : [] },
  'auto:excluded': { name: 'Excluded', icon: 'minus', papers: s => (s.papers || []).filter(p => finalDecision(s, p.id)?.decision === 'exclude') },
};
const autoOf = id => AUTO[id] || null;
let subset = null;               // { ids: Set, label } — a set opened from elsewhere (a chart bar)
/** Opens the library on a given set of records, named, until cleared. */
export function showSubset(ids, label) { subset = { ids: new Set(ids), label }; selectedCollection = null; listPage = 1; }
/** Arrival from Needs attention (lib/arrive.mjs): the records a row names, as a subset whose notice the shell draws; null clears it. */
export function arrive(a) {
  if (!a) { if (subset?.arrival) { subset = null; listPage = 1; } return false; }
  if (!a.ids?.length) return false;
  subset = { ids: new Set(a.ids), label: a.text, arrival: true }; selectedCollection = null; listPage = 1;
  return true;
}
export const arrived = () => !!subset?.arrival;
/** What the shell's arrival notice goes under: the list's tools (the page's head is the title bar). */
export const arriveUnder = '#lib-region';
// Plan C3: a duplicate record is not a companion paper. These name the relation.
// Each relation reads into the record it names: "Same study as Di Silvestre 2013".
const LINK_KINDS = [['same-study', 'Same study as'], ['companion', 'Companion report of'], ['preprint', 'Preprint of'], ['correction', 'Correction of'], ['protocol', 'Protocol of'], ['registry', 'Registry entry of']];
let selectedPaper = null;
let importNote = '';   // what an import from the empty library found, since that screen has no status line
let showDuplicates = false;
/** What the person is looking at: the record selected in the list, if any. */
export function focus() {
  const p = selectedPaper && get().papers.find(x => x.id === selectedPaper);
  return p ? { kind: 'record', paperId: p.id, label: p.label, detail: p.title || '' } : null;
}
let duplicatePage = 1, duplicateError = '';
const duplicateSwapped = new Set();   // pairs shown the other way round: 'aId|bId'
let duplicateMergedPage = 1, duplicateDistinctPage = 1;
const duplicateHistoryOpen = { merged: false, distinct: false };
let listPage = 1, filter = '';
// Find: the list's tools row (the filter, Filters, Sort) is closed until the title bar's Find or ⌘F opens it, and open while it narrows or orders
// the list; the PDF counts of the status line stay where they are (pressing one never opens the row above them, so nothing moves under the pointer)
let findOpen = false;
let selectedIds = new Set(), selectionProject = null, selectionGeneration = -1, sortKey = '', sortDirection = 1, batch = null;
export function selection() {
  return get().papers.some(p => p.id === selectedPaper) ? selectedPaper : null;
}

export function focusPaper(id) {
  const p = get().papers.find(x => x.id === id);
  if (!p) return false;
  selectedCollection = null; subset = null; showDuplicates = false; closeCheck();
  selectedPaper = id;
  filter = p.label || p.title || id;
  listPage = 1;
  return true;
}

/** Opens the duplicate review as a page of its own, in place of the list. */
export function openDuplicates() { closeCheck(); resetDuplicateReview(); showDuplicates = true; duplicatePage = 1; duplicateError = ''; duplicateSwapped.clear(); }

let host = { el: null, ctx: null };   // the page as last drawn, for the title bar's commands that act on it in place

/** A new project, or the same one reloaded: the selection, the filter and the pages start again. page() and render() both call it. */
function sync() {
  const project = projects().current;
  if (selectionProject === project && selectionGeneration === projectGeneration()) return;
  selectedIds.clear(); selectionProject = project; selectionGeneration = projectGeneration(); listPage = 1; filter = ''; duplicatePage = 1; duplicateMergedPage = 1; duplicateDistinctPage = 1;
}

/** The automatic collections that hold anything: [id, definition, count]. */
const autoCollections = () => Object.entries(AUTO).map(([id, a]) => [id, a, a.papers(get()).length]).filter(([, , n]) => n);
async function newCollection(rerender) {
  const name = await ask('New collection', { placeholder: 'Name', confirm: 'Create' });
  if (name?.trim()) { coll.add(name.trim(), autoOf(selectedCollection) ? null : selectedCollection); rerender(); }
}
/** The title is the collection picker: All records, the automatic collections, the person's own (nested), and New collection. */
function collectionMenu(at, rerender) {
  const choose = id => () => { selectedCollection = id; subset = null; listPage = 1; rerender(); };
  const flat = (nodes, trail = []) => nodes.flatMap(n => [{ label: [...trail, n.name].join(' › '), meta: String(coll.countIn(n.id)), checked: selectedCollection === n.id, run: choose(n.id) }, ...flat(n.children, [...trail, n.name])]);
  const users = flat(coll.tree());
  showMenu(at, [
    { label: 'All records', meta: String(get().papers.length), checked: selectedCollection === null && !subset, run: choose(null) },
    ...autoCollections().map(([id, a, n]) => ({ label: a.name, meta: String(n), checked: selectedCollection === id, run: choose(id) })),
    ...(users.length ? ['-', ...users] : []),
    '-', { label: 'New collection', icon: 'plus', run: () => newCollection(rerender) }]);
}

/** Add, Check and Export: three menus, built when they open so they read the project as it is then. Export acts on the ticked records first. */
function libraryMenus(rerender) {
  const mk = (iconName, label, run) => ({ label, icon: iconName, run });
  let addAt = null, exportAt = null;   // the buttons the Add and Export menus hang from
  const items = [
    mk('import', 'Import records',
       () => pick({ accept: IMPORT_ACCEPT }, files => importRecords(files[0], rerender))),
    mk('paperclip', 'Attach PDFs',
       () => pick({ accept: '.pdf', multiple: true }, files => attachPdfs(files, rerender))),
    ...canLink() ? [mk('file', 'Link folder', () => linkFolder(rerender))] : [],
    mk('refresh', 'Duplicates', () => { openDuplicates(); rerender(); }),
    mk('search', 'Identify files', async () => { rerender('Identifying'); const t = await runIdentification({ retry: true }); rerender(`${t.fixed} identified · ${t.merged} merged · ${t.still} still unidentified`); }),
    // Crossref and PubMed notices, dated per record, on their own page (views/library-checks.mjs), which starts the check as it opens.
    mk('warn', 'Check retractions', () => { openCheck('retractions', { run: true }); rerender(); }),
    // Zotero's local API answers this computer only; a browser tab on https reads the online library instead (api.zotero.org, by the
    // person's user ID and a key that can read it, asked once and kept with the app-wide settings).
    mk('connector', 'From Zotero', async () => {
      let web = null;
      if (inHostedTab()) { web = await zoteroAccount(); if (!web) return; }
      rerender('Reading the Zotero library');
      try {
        let added = 0, start = 0, batch;
        do {
          batch = await zoteroItems({ start, web });
          update(st => { const known = libraryIndex(st.papers); for (const r of batch) if (!known.find(r)) { const rec = toLibrary(r); st.papers.push(rec); known.add(rec); added++; } return st; });
          start += 100;
          rerender(`${Math.min(start, batch.total)} of ${batch.total} read`);
        } while (start < batch.total && start < 5000);
        rerender(`${added} records imported from Zotero`);
      } catch (err) { rerender(err.message.slice(0, 120)); }
    }),
    mk('plus', 'Enter reference', () => { startAdd({}, id => { selectedPaper = id; rerender('Reference added'); }); rerender(); host?.ctx?.openDetails?.(); }),
    ...canLink() ? [mk('folder', 'Watched folder', () => watchMenu(addAt, rerender))] : [],
    // The quality of what is in the library and of the references it will give (views/library-checks.mjs).
    mk('check', 'Check record quality', () => { openCheck('quality'); rerender(); }),
    mk('merge', 'Unify author and journal names', () => { openCheck('authors'); rerender(); }),
    mk('branch', 'Map cross-citations', () => { openCheck('citations'); rerender(); }),
    // Missing abstracts, DOIs, PMIDs, journals and years from Crossref and PubMed, shown before anything is written.
    mk('refresh', 'Fill missing details', () => fillMissing(rerender)),
    mk('undo', 'Undo filled details', () => undoFill(rerender)),
    // What changed since the last evidence baseline and the work it reaches (views/library-checks.mjs).
    mk('clock', 'Evidence changes', () => { openCheck('changes'); rerender(); }),
  ];
  // by name, not by place: Link folder and Watched folder exist only where folders can be linked, and a missing one is left out
  const named = (...labels) => labels.map(l => items.find(x => x.label === l)).filter(Boolean);
  const exportItems = [['RIS', 'ris'], ['BibTeX', 'bib'], ['CSV', 'csv']]
    .map(([label, format]) => mk('export', label, () => exportRecords(format, rerender)));
  // Records with their screening decisions, labels and notes, and a formatted reference list (lib/ref-export-extra.mjs).
  exportItems.push(
    mk('export', 'RIS with decisions', () => { saveFile(toRisWithDecisions(get().papers, get()), 'lykos-library-decisions.ris', 'text/plain'); rerender(`${get().papers.length} records exported`); }),
    mk('export', 'CSV with decisions', () => { saveFile(toCsvWithDecisions(get().papers, get()), 'lykos-library-decisions.csv', 'text/csv'); rerender(`${get().papers.length} records exported`); }),
    mk('copy', 'Copy reference list', () => showMenu(exportAt, [['vancouver', 'Vancouver'], ['ama', 'AMA'], ['apa', 'APA'], ['harvard', 'Harvard']].map(([style, label]) => ({ label, run: async () => {
      const text = formattedBibliography(get().papers, style, { format: 'text' });
      try { await navigator.clipboard.writeText(text); rerender(`${get().papers.length} references copied, ${label}`); } catch { saveFile(text, `references-${style}.txt`, 'text/plain'); }
    } })))),
  );
  const exportSelection = a => {
    const chosen = get().papers.filter(p => selectedIds.has(p.id));
    if (!chosen.length) return [];
    const one = ([fmt, label]) => ({ label, icon: 'download', run: () => { saveFile(fmt === 'ris' ? toRis(chosen) : fmt === 'bib' ? toBibtex(chosen) : toCsv(chosen), `lykos-selection.${fmt}`, 'text/plain'); rerender(`${chosen.length} records exported`); } });
    return [{ heading: `${chosen.length} selected` }, ...[['ris', 'RIS'], ['bib', 'BibTeX'], ['csv', 'CSV']].map(one), '-', { heading: 'All records' }];
  };
  return {
    'lib-menu-add': a => { addAt = menuAnchor(a); showMenu(addAt, named('Enter reference', 'Import records', 'From Zotero', 'Attach PDFs', 'Link folder', ...(activeFolder() ? ['Watched folder'] : []))); },
    'lib-menu-check': a => showMenu(menuAnchor(a), [
      ...named('Duplicates'),
      { label: 'Record quality', icon: 'check', submenu: named('Check record quality', 'Unify author and journal names') },
      { label: 'Metadata', icon: 'refresh', submenu: named('Fill missing details', ...((get().enrichLog || []).some(e => !e.undoneAt) ? ['Undo filled details'] : []), 'Check retractions', 'Identify files') },
      ...named('Map cross-citations'),
      ...named('Evidence changes'),
      ...(get().libraryTrash?.length ? [{ label: 'Undo removal', icon: 'undo', run: () => undoRemoval({ rerender, refreshCounts: () => {} }) }] : []),
    ]),
    'lib-menu-export': a => { exportAt = menuAnchor(a); showMenu(exportAt, [...exportSelection(a), ...exportItems]); },
  };
}

/**
 * The title bar (lib/topbar.mjs): the collection as a picker with its count, Add, Check and Export, and one More with the collection's
 * commands and the list's. A check or the duplicate review is a page of its own: Back to Library, its name and its commands.
 */
export function page(rerender) {
  sync();
  if (checkOpen()) showDuplicates = false;
  const back = { label: 'Back to Library', run: () => { closeCheck(); showDuplicates = false; rerender(); } };
  if (checkOpen()) return { ...checkPage(rerender), back };
  if (showDuplicates) return { title: 'Duplicates', back, actions: [] };
  const model = barModel(listModel());
  const current = coll.collections().find(c => c.id === selectedCollection);
  const spec = bars.pageSpec(model, { ...libraryMenus(rerender),
    pick: a => collectionMenu(a, rerender),
    'lib-coll-new': () => newCollection(rerender),
    'rename-coll': async () => { const name = await ask('Rename collection', { value: current.name }); if (name?.trim()) { coll.rename(current.id, name.trim()); rerender(); } },
    'del-coll': async () => {
      const n = coll.papersIn(current.id).length;
      if (!await confirmAsk(`Delete ${current.name}?`, { detail: n ? `${n} record${n === 1 ? '' : 's'} stay in the library.` : '', confirm: 'Delete', danger: true })) return;
      coll.remove(current.id); selectedCollection = null; rerender();
    },
    'lib-select-page': () => { listed.shown.forEach(p => selectedIds.add(p.id)); if (host.el?.isConnected) syncSelection(host.el); },
    'lib-density': () => { compactRecords = !compactRecords; rerender(); },
  });
  const ctx = host.ctx || { rerender };
  return { ...spec, find: { pressed: finding(model), run: () => (finding(model) ? closeFind(host.el, ctx) : openFind(ctx)) } };
}


// The records list, as a model and as markup, so the filter can redraw the
// rows and pager in place instead of the whole view on every keystroke.
let listed = { matched: [], shown: [] };
const scopeOf = papers => {
  if (subset) return papers.filter(p => subset.ids.has(p.id));
  const auto = autoOf(selectedCollection);
  if (auto) { const ids = new Set(auto.papers(get()).map(p => p.id)); return papers.filter(p => ids.has(p.id)); }
  return selectedCollection ? coll.papersIn(selectedCollection) : papers;
};
function listModel(papers = get().papers) {
  const inScope = scopeOf(papers);
  // Record facts only when a filter needs them: with none set, opening the
  // Library does not work out every record's facts and duplicate candidates.
  // With Full text on, the box searches the PDFs' text (lib/fulltext-index.mjs) instead of the records.
  const found = fullText ? (filter.trim() ? (ftResult ? inScope.filter(p => ftResult.results.has(p.id)) : []) : inScope) : filterPapers(inScope, filter), fs = filtersOf();
  const facts = activeCount(fs) ? factsFor(papers) : null;
  const filtered = facts ? applyFilters(found, fs, facts) : found;
  const matched = sortRecords(filtered, sortKey, sortDirection);
  const view = pageOf(matched, listPage);
  listPage = view.page;
  listed = { matched, shown: view.items };
  // the three PDF counts ignore the pdf filter, so pressing one never zeroes the others
  const availability = fs.pick?.pdf?.length ? bars.availabilityScope(found, fs, facts) : availabilityCounts(filtered);
  return { inScope, matched, view, shown: view.items, availability };
}
/** Whether the tools row is drawn: Find opened it, or it narrows (text, Filters other than a PDF count, PDF text) or orders the list. */
function finding(model) {
  const fs = filtersOf(), others = activeCount(fs) - (bars.shortcutOf(fs) ? 1 : 0);
  return findOpen || !!filter || others > 0 || fullText || (model.sortId || '') !== '';
}
function openFind(ctx) { findOpen = true; ctx.rerender(); document.querySelector('#lib-filter')?.focus(); }
/** Find pressed again: the row closes and lets go of what it narrowed or ordered, so the list is as it was. */
function closeFind(el, ctx) {
  findOpen = false; sortKey = ''; sortDirection = 1;
  if (el?.isConnected) clearFilters(el, ctx, { text: true }); else { filter = ''; setFilters(emptyFilters()); fullText = false; ftResult = null; }
  ctx.rerender();
}
/** ⌘F (app.mjs findInView): opens the row and puts the caret in its filter; false on the check and duplicates pages. */
export function find() {
  if (!host.ctx || checkOpen() || showDuplicates) return false;
  if (finding(barModel(listModel()))) document.querySelector('#lib-filter')?.focus(); else openFind(host.ctx);
  return true;
}
/** What the bar declarations in library-bars.mjs read: plain values from this view's state. */
function barModel(m) {
  const fs = filtersOf(), narrowed = !!(filter || activeCount(fs)), shortcut = bars.shortcutOf(fs);
  const current = coll.collections().find(c => c.id === selectedCollection), auto = autoOf(selectedCollection);
  return { canDownload: !inHostedTab(), collectionName: current ? current.name : auto ? auto.name : 'All records', isUserCollection: !!current,
    matched: m.matched.length, inScope: m.inScope.length, narrowed, compact: compactRecords,
    filter, fullText, sortId: bars.sortIdOf(sortKey, sortDirection), filtersActive: activeCount(fs) > 0, popOpen: !!filtersPop,
    selectedCount: selectedIds.size, hasCollections: coll.collections().length > 0, batchRunning: !!batch?.running,
    availability: m.availability, shortcut, summary: bars.summaryText(fs, activeCount(fs) ? sectionsFor(get().papers) : [], fullText, shortcut), hasScope: m.inScope.length > 0 };
}
const rowModel = () => ({ selectedIds, selectedPaper, citation: libraryCitation, inDesktop: inDesktop(), canRetrieve: canRetrievePaper, downloading: downloadingPaper,
  hits: p => fullText && ftResult?.results.get(p.id) ? ftHitsHtml(p.id, ftResult.results.get(p.id)) : '' });
function emptyList(m) {
  if (!m.inScope.length) return emptyState({ icon: 'file', title: 'Nothing filed here', size: 'inline' });
  return emptyState({ icon: 'search', title: fullText ? 'No PDF text matches' : 'No records match', actions: [{ id: 'lib-empty-clear', label: 'Clear filters' }], size: 'inline' });
}
const listHtml = m => { const row = rowModel(); return uiList({ id: 'lib-rows', label: 'Records', rows: m.shown.map((p, i) => bars.rowHtml(p, i, row)), empty: m.shown.length ? '' : emptyList(m) }); };
const pagerHtml = m => pager({ id: 'lib-pager', page: m.view.page, pages: m.view.pages, total: m.matched.length });

// ---- full text (lib/fulltext-index.mjs) --------------------------------------------
let fullText = false, ftResult = null, ftSeq = 0, ftSub = null;
const FULLTEXT_DELAY = 250;
function ftHitsHtml(id, r) {
  return `<div class="lib-ft-hits"><span class="meta">${r.count} match${r.count === 1 ? '' : 'es'}</span>${r.snippets.map(sn =>
    `<button class="lib-ft-snippet" data-ft-open="${esc(id)}" data-ft-page="${sn.page}" data-ft-quote="${esc(sn.quote)}" data-ft-nth="${sn.nth || 0}"><span class="lib-ft-page">p. ${sn.page}</span><span class="lib-ft-text">${esc(sn.before)}<mark>${esc(sn.quote)}</mark>${esc(sn.after)}</span></button>`).join('')}</div>`;
}
function ftProgress() {
  const st = indexStatus(get().papers);
  return { st, text: progressText(st) };
}
/** The PDF text index as a notice: progress left, Pause or Resume and Rebuild right. */
function ftNoticeHtml() {
  const { st, text } = ftProgress();
  return uiNotice({ id: 'lib-ft', label: 'PDF text index', text: text || 'PDF text index',
    actions: [...(st.running || st.paused ? [{ id: 'lib-ft-pause', label: st.paused ? 'Resume' : 'Pause', labelCh: 6, dynamic: true }] : []),
      ...(st.total ? [{ id: 'lib-ft-rebuild', label: 'Rebuild index' }] : [])] });
}
/** Runs the query over the indexed PDFs of the records in scope, then redraws the rows. */
async function runFullText(el, ctx) {
  const mine = ++ftSeq, q = filter;
  if (!q.trim()) { ftResult = null; if (el.isConnected) redrawRows(el, ctx); return; }
  const r = await searchFullText(q, scopeOf(get().papers)).catch(() => null);
  if (mine !== ftSeq || !el.isConnected) return;
  ftResult = r ? { query: q, results: r.results, searched: r.searched } : null;
  redrawRows(el, ctx);
}
function wireFtStatus(el) {
  el.querySelector('#lib-ft-pause')?.addEventListener('click', () => { if (indexStatus(get().papers).paused) resumeIndexing().catch(() => {}); else pauseIndexing(); });
  el.querySelector('#lib-ft-rebuild')?.addEventListener('click', () => { rebuildIndex().catch(() => {}); });
}
function wireFullText(el, ctx) {
  wireFtStatus(el);
  if (!fullText) return;
  if (!ftResult && filter.trim()) queueMicrotask(() => runFullText(el, ctx));
  loadIndex().then(() => startIndexing()).catch(() => {});
  // The progress line follows the indexer in place; a finished run refreshes the results.
  ftSub?.();
  let wasRunning = indexStatus(get().papers).running;
  ftSub = onIndexChange(() => {
    const line = el.querySelector('#lib-ft');
    if (!line || !el.isConnected) { ftSub?.(); ftSub = null; return; }
    const { st } = ftProgress();
    const focused = document.activeElement?.id;
    line.replaceWith(fromHtml(ftNoticeHtml()));
    wireFtStatus(el);
    if (focused?.startsWith('lib-ft-')) (el.querySelector(`#${focused}`) || el.querySelector('#lib-ft-rebuild'))?.focus({ preventScroll: true });
    if (wasRunning && !st.running && filter.trim()) runFullText(el, ctx);
    wasRunning = st.running;
  });
}

const FILTER_DELAY = 120;
let filterTimer = 0;

/** Redraws the count, the status line, the rows and the pager for the current filter; the bars and the rest of the view stay. */
function redrawRows(el, ctx) {
  const panel = el.querySelector('.lib-list');
  const rows = panel?.querySelector('#lib-rows');
  if (!rows) { ctx.rerender(); return; }
  const m = listModel(), model = barModel(m);
  const set = (sel, text) => { const x = panel.querySelector(sel); if (x) x.textContent = text; };
  ctx.status?.({ text: bars.countText(model), ch: 14 });   // the title bar's count, in its fixed slot
  set('#lib-select-results', bars.selectAllText(model));
  const pressed = panel.querySelector('#lib-filters');
  if (pressed) pressed.setAttribute('aria-pressed', String(model.filtersActive || fullText));
  const status = panel.querySelector('#lib-status');
  if (status) {
    const held = status.contains(document.activeElement) ? document.activeElement.id : '';
    status.replaceWith(fromHtml(bars.statusLineHtml(model)));
    wireStatus(panel, el, ctx);
    const back = held && panel.querySelector(`#${held}`);
    if (held) (back && !back.hidden ? back : panel.querySelector('#lib-filters'))?.focus({ preventScroll: true });
  }
  rows.replaceWith(fromHtml(listHtml(m)));
  const pages = pagerHtml(m), old = panel.querySelector('#lib-pager');
  if (old && pages) old.replaceWith(fromHtml(pages));
  else if (old) old.remove();
  else if (pages) panel.querySelector('#lib-rows').after(fromHtml(pages));
  wireRows(panel, el, ctx);
}
function fromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---- library filters --------------------------------------------------------
// The Filters popover and the status line that says what narrows the list. The
// logic lives in lib/record-filters.mjs; this is the surface. State is kept
// per project for the session.
const filtersByProject = new Map();
const filtersOf = () => filtersByProject.get(projects().current) || emptyFilters();
const setFilters = next => { filtersByProject.set(projects().current, next); };
let factsCache = { version: -1, project: null, papers: null, facts: null };
/** Record facts, recomputed only when the project changes. */
function factsFor(papers) {
  const version = getVersion(), project = projects().current;
  // Under blind dual screening the Labels filter shows the reviewer's own labels only.
  const labelsBy = isDual(get()) ? (settings().reviewerInitials || settings().reviewerName || '') : '';
  if (factsCache.version !== version || factsCache.project !== project || factsCache.papers !== papers || factsCache.labelsBy !== labelsBy)
    factsCache = { version, project, papers, labelsBy, facts: recordFacts(papers, get(), { labelsBy }) };
  return factsCache.facts;
}
const sectionsFor = papers => filterSections(papers, scopeOf(papers), filtersOf(), factsFor(papers), get());

let filtersPop = null, popAnchor = null, popView = null, popTimer = 0;
function closeFilters({ focus = false } = {}) {
  if (!filtersPop) return;
  filtersPop.remove(); filtersPop = null; fpPage = null;
  document.removeEventListener('pointerdown', onPopOutside, true);
  document.removeEventListener('keydown', onPopKey, true);
  document.removeEventListener('scroll', onPopScroll, true);
  removeEventListener('resize', onPopResize);
  popAnchor?.setAttribute('aria-expanded', 'false');
  if (focus && popAnchor?.isConnected) popAnchor.focus({ preventScroll: true });
  popAnchor = null;
}
function onPopOutside(e) {
  if (!filtersPop || filtersPop.contains(e.target) || popAnchor?.contains(e.target)) return;
  closeFilters();
}
// Esc goes back from a section, then closes the panel, wherever focus is (a control that disables itself leaves focus on the page).
function onPopKey(e) { if (e.key === 'Escape' && filtersPop) { e.preventDefault(); e.stopPropagation(); if (fpPage) showList(); else closeFilters({ focus: true }); } }
function onPopScroll(e) { if (filtersPop && !filtersPop.contains(e.target)) closeFilters(); }
function onPopResize() { closeFilters(); }
function placeFilters() {
  if (!filtersPop || !popAnchor?.isConnected) { closeFilters(); return; }
  const r = popAnchor.getBoundingClientRect(), w = filtersPop.offsetWidth;
  // Under the button, ending at its right edge; starting at its left edge when that would run off the window.
  const left = Math.max(8, Math.min(r.right - w >= 8 ? r.right - w : r.left, innerWidth - w - 8));
  // Below the button when it fits there, else above it; when neither side
  // holds it, as high as the window allows, capped at the window's height
  // with the panel as its only scroller (a narrow window stacks the Library).
  const below = innerHeight - r.bottom - 12, above = r.top - 12, h = filtersPop.scrollHeight + filtersPop.offsetHeight - filtersPop.clientHeight;   // content and border
  filtersPop.style.setProperty('left', `${left}px`);
  filtersPop.style.removeProperty('bottom');
  if (h <= below || below >= above && below >= 360) {
    filtersPop.style.setProperty('top', `${r.bottom + 4}px`); filtersPop.style.setProperty('max-height', `${Math.max(200, below)}px`);
  } else if (h <= above) {
    // held by the edge next to the button, so a list that shrinks as it is searched stays attached
    filtersPop.style.removeProperty('top'); filtersPop.style.setProperty('bottom', `${innerHeight - r.top + 4}px`); filtersPop.style.setProperty('max-height', `${above}px`);
  } else {
    const top = Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8));
    filtersPop.style.setProperty('top', `${top}px`); filtersPop.style.setProperty('max-height', `${innerHeight - top - 8}px`);
  }
}

const PICKS_SHOWN = 5;
const pickPages = new Map();   // section id -> page of its searched list, while the popover is open
const foldText = foldSearch;   // accents, ı and İ do not matter
const optHtml = (sec, o, chosen) => `<label class="lib-fp-opt"><input type="checkbox" data-fp-set="${esc(sec.id)}" value="${esc(o.id)}"${chosen.has(o.id) ? ' checked' : ''}><span class="lib-fp-name">${esc(o.label)}</span><span class="lib-fp-n" data-fp-count="${esc(`${sec.id}:${o.id}`)}">${o.count}</span></label>`;
/** A searchable list, paged: the chosen names on every page, then the most used that match what is typed. */
function picksHtml(sec, query) {
  const chosen = new Set(filtersOf().pick?.[sec.id] || []), q = foldText(query).trim();
  const matches = sec.options.filter(o => !chosen.has(o.id) && (!q || foldText(o.label).includes(q)));
  const pages = Math.max(1, Math.ceil(matches.length / PICKS_SHOWN));
  const page = Math.min(pickPages.get(sec.id) || 0, pages - 1), from = page * PICKS_SHOWN;
  const shown = [...sec.options.filter(o => chosen.has(o.id)), ...matches.slice(from, from + PICKS_SHOWN)];
  const noun = esc(sec.label.toLowerCase());
  const pager = pages > 1 ? uiBar({ kind: 'strip', label: `${sec.label} pages`, cls: 'lib-fp-pager', status: { text: `${from + 1}–${Math.min(from + PICKS_SHOWN, matches.length)} of ${matches.length}`, ch: 20 },
    actions: [{ id: `lib-fp-prev-${sec.id}`, label: `Previous ${noun}s`, icon: 'chevron-left', disabled: !page, attrs: { 'data-fp-page': sec.id, 'data-step': -1 } },
      { id: `lib-fp-next-${sec.id}`, label: `Next ${noun}s`, icon: 'chevron-right', disabled: page >= pages - 1, attrs: { 'data-fp-page': sec.id, 'data-step': 1 } }] }) : '';
  return `${shown.map(o => optHtml(sec, o, chosen)).join('')}${!shown.length ? '<span class="lib-fp-none">No match</span>' : ''}${pager}`;
}

// Drill-down, as system settings do: a list page with one short row per
// section (its label, what it is set to, a chevron), grouped as the record,
// its content and the review; a row opens a page holding only that section's
// controls, with a way back. The panel stays short whatever the library holds.
const FP_GROUPS = [['year', 'author', 'author-text', 'journal', 'journal-text', 'language', 'source'], ['pdf', 'abstract', 'notes', 'duplicates', 'collection'], ['ta', 'ft', 'included', 'label', 'extraction']];
let fpPage = null;    // the section on show, or null for the list
let fpFocus = null;   // the row to focus when the list comes back
function secBody(sec) {
  const state = filtersOf();
  if (sec.kind === 'range') return uiBar({ kind: 'tools', label: 'Years', id: 'lib-fp-years',
    filters: [{ type: 'field', id: 'lib-fp-year-from', label: 'Year from', value: state.yearFrom, placeholder: String(sec.min ?? 'From'), maxlength: 4, width: { ch: 6 }, attrs: { inputmode: 'numeric', 'data-fp-year': 'from' } },
      { type: 'field', id: 'lib-fp-year-to', label: 'Year to', value: state.yearTo, placeholder: String(sec.max ?? 'To'), maxlength: 4, width: { ch: 6 }, attrs: { inputmode: 'numeric', 'data-fp-year': 'to' } }],
    actions: [{ id: 'lib-fp-last-5', label: 'Last 5 years', attrs: { 'data-fp-last': 5 } }, { id: 'lib-fp-last-10', label: 'Last 10 years', attrs: { 'data-fp-last': 10 } }] });
  if (sec.kind === 'text') return `<input type="text" class="lib-fp-text" data-fp-text="${sec.key}" value="${esc(state[sec.key])}" aria-label="${esc(sec.label)}">`;
  if (sec.kind === 'search') return `<input type="search" class="lib-fp-find" data-fp-find="${esc(sec.id)}" placeholder="Search ${num(sec.options.length)} ${sec.id === 'author' ? (sec.options.length === 1 ? 'author' : 'authors') : (sec.options.length === 1 ? 'journal' : 'journals')}" aria-label="Search ${esc(sec.label.toLowerCase())}"><div class="lib-fp-picks" data-fp-picks="${esc(sec.id)}">${picksHtml(sec, '')}</div>`;
  return `<div class="lib-fp-opts">${sec.options.map(o => optHtml(sec, o, new Set(state.pick?.[sec.id] || []))).join('')}</div>`;
}
function listPageHtml(sections) {
  const byId = new Map(sections.map(x => [x.id, x]));
  const row = sec => { const sum = sectionSummary(sec, filtersOf());
    return `<button class="lib-fp-item" data-fp-open="${esc(sec.id)}"><span class="lib-fp-label">${esc(sec.label)}</span><span class="lib-fp-sum${sum.active ? ' set' : ''}" data-fp-sum="${esc(sec.id)}">${esc(sum.text)}</span>${icon('chevron-right', { size: 12 })}</button>`; };
  const known = new Set(FP_GROUPS.flat());
  const groups = FP_GROUPS.map(ids => ids.map(id => byId.get(id)).filter(Boolean));
  groups[0].push(...sections.filter(x => !known.has(x.id)));
  return `${uiBar({ kind: 'head', label: 'Filters', id: 'lib-fp-head', cls: 'lib-fp-head', lead: { title: 'Filters', level: 'h2' },
      actions: [{ id: 'lib-fp-clear', label: 'Clear all', disabled: !(activeCount(filtersOf()) || fullText) }, { id: 'lib-fp-close', label: 'Close', icon: 'close', role: 'quiet' }] })}
    <div class="lib-fp-body lib-fp-list"><div class="lib-fp-group"><label class="lib-fp-opt lib-fp-search-mode"><input type="checkbox" id="lib-fulltext"${fullText ? ' checked' : ''}><span class="lib-fp-name">Search within PDF text</span></label></div>${groups.filter(g => g.length).map(g => `<div class="lib-fp-group" role="group">${g.map(row).join('')}</div>`).join('')}</div>`;
}
function sectionPageHtml(sec) {
  const on = sectionSummary(sec, filtersOf()).active;
  return `${uiBar({ kind: 'head', label: sec.label, id: 'lib-fp-head', cls: 'lib-fp-head', lead: { title: sec.label, level: 'h2', id: 'lib-fp-title', back: { id: 'lib-fp-back', label: 'Back to filters' } },
      actions: [{ id: 'lib-fp-sec-clear', label: 'Clear', disabled: !on }, { id: 'lib-fp-close', label: 'Close', icon: 'close', role: 'quiet' }] })}
    <div class="lib-fp-body lib-fp-page" role="group" aria-labelledby="lib-fp-title">${secBody(sec)}</div>`;
}

/** Applies a changed filter: rows, count, status line, the Filters button and the popover's counts. */
function refreshFiltered(el, ctx) {
  listPage = 1;
  redrawRows(el, ctx);
  if (!el.querySelector('.lib-list')) return;
  if (filtersPop) {
    const papers = get().papers;
    for (const sec of sectionsFor(papers)) {
      // each row's summary, heavier with a quiet underline while it narrows the list
      const sum = filtersPop.querySelector(`[data-fp-sum="${CSS.escape(sec.id)}"]`), st = sectionSummary(sec, filtersOf());
      if (sum) { sum.textContent = st.text; sum.classList.toggle('set', st.active); }
      if (sec.id === fpPage) { const c = filtersPop.querySelector('#lib-fp-sec-clear'); if (c) c.disabled = !st.active; }
      for (const o of sec.options || []) {
        const n = filtersPop.querySelector(`[data-fp-count="${CSS.escape(`${sec.id}:${o.id}`)}"]`);
        if (n) n.textContent = String(o.count);
      }
    }
    const clear = filtersPop.querySelector('#lib-fp-clear');
    if (clear) clear.disabled = !activeCount(filtersOf()) && !fullText;
  }
}

/** Clears the filters (and the PDF text mode, which re-renders the view); `text` also empties the search box. */
function clearFilters(el, ctx, { text = false } = {}) {
  setFilters(emptyFilters());
  if (text) { filter = ''; const box = el.querySelector('#lib-filter'); if (box) box.value = ''; }
  closeFilters();
  if (fullText) { fullText = false; ftResult = null; ftSeq++; ctx.rerender(); return; }
  if (text) ftResult = null;
  refreshFiltered(el, ctx);
}
/** The status line: the three PDF counts are filter shortcuts, and Clear removes what narrows the list. */
function wireStatus(scope, el, ctx) {
  for (const key of Object.keys(bars.PDF_SHORTCUTS)) {
    const b = scope.querySelector(`#lib-pdf-${key}`);
    if (b) b.onclick = () => { setFilters(bars.pressShortcut(filtersOf(), key)); closeFilters(); refreshFiltered(el, ctx); };
  }
  const clear = scope.querySelector('#lib-filters-clear');
  if (clear) clear.onclick = () => clearFilters(el, ctx);
}

function openFilters(btn) {
  const pop = document.createElement('div');
  pop.className = 'lib-filters-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Filters');
  pickPages.clear(); fpPage = null; fpFocus = null;
  pop.innerHTML = listPageHtml(sectionsFor(get().papers));
  document.body.append(pop);
  filtersPop = pop; popAnchor = btn; btn.setAttribute('aria-expanded', 'true');
  placeFilters();
  document.addEventListener('pointerdown', onPopOutside, true);
  document.addEventListener('keydown', onPopKey, true);
  document.addEventListener('scroll', onPopScroll, true);
  addEventListener('resize', onPopResize);
  wirePop(pop);
  pop.querySelector('.lib-fp-item')?.focus({ preventScroll: true });
}

// The popover's pages. Changing page keeps its top edge where it is: an
// upward-opened panel is held by its top from the first change on.
function holdTop(pop) {
  const r = pop.getBoundingClientRect();
  pop.style.removeProperty('bottom'); pop.style.setProperty('top', `${r.top}px`);
  pop.style.setProperty('max-height', `${Math.max(200, innerHeight - r.top - 8)}px`);
}
function showSection(id) {
  const pop = filtersPop, sec = sectionsFor(get().papers).find(x => x.id === id); if (!pop || !sec) return;
  holdTop(pop); fpPage = id; fpFocus = id; pickPages.delete(id);
  pop.innerHTML = sectionPageHtml(sec); pop.scrollTop = 0;
  (pop.querySelector('.lib-fp-page input:not([type=checkbox]), .lib-fp-page input, .lib-fp-page button') || pop.querySelector('#lib-fp-back'))?.focus({ preventScroll: true });
}
function showList() {
  const pop = filtersPop; if (!pop) return;
  holdTop(pop); fpPage = null;
  pop.innerHTML = listPageHtml(sectionsFor(get().papers)); pop.scrollTop = 0;
  (pop.querySelector(`[data-fp-open="${CSS.escape(fpFocus || '')}"]`) || pop.querySelector('.lib-fp-item'))?.focus({ preventScroll: true });
}
function wirePop(pop) {
  const change = next => { setFilters(next); refreshFiltered(popView.el, popView.ctx); };
  const later = fn => { clearTimeout(popTimer); popTimer = setTimeout(fn, FILTER_DELAY * 2); };
  const secOf = id => sectionsFor(get().papers).find(x => x.id === id);
  const repick = id => {
    const sec = secOf(id), box = pop.querySelector(`[data-fp-picks="${CSS.escape(id)}"]`);
    const find = pop.querySelector(`[data-fp-find="${CSS.escape(id)}"]`);
    if (sec && box) box.innerHTML = picksHtml(sec, find?.value || '');
  };
  const years = () => {
    const from = pop.querySelector('[data-fp-year="from"]'), to = pop.querySelector('[data-fp-year="to"]');
    change({ ...filtersOf(), yearFrom: cleanYear(from?.value), yearTo: cleanYear(to?.value) });
  };
  // Delegated: each page's controls are drawn when it shows.
  pop.onchange = e => { if (e.target.id === 'lib-fulltext') { fullText = e.target.checked; listPage = 1; ftResult = null; ftSeq++; closeFilters(); popView.ctx.rerender(); return; } const c = e.target.closest?.('[data-fp-set]'); if (c) change(toggle(filtersOf(), c.dataset.fpSet, c.value, c.checked)); };
  pop.oninput = e => {
    const t = e.target;
    if (t.dataset?.fpFind) { pickPages.set(t.dataset.fpFind, 0); repick(t.dataset.fpFind); }
    else if (t.dataset?.fpText) later(() => change({ ...filtersOf(), [t.dataset.fpText]: t.value }));
    else if (t.dataset?.fpYear) later(years);
  };
  pop.onclick = e => {
    const t = e.target;
    const open = t.closest?.('[data-fp-open]'); if (open) { showSection(open.dataset.fpOpen); return; }
    if (t.closest?.('#lib-fp-back')) { showList(); return; }
    if (t.closest?.('#lib-fp-close')) { closeFilters({ focus: true }); return; }
    if (t.closest?.('#lib-fp-clear')) { if (fullText) { fullText = false; ftResult = null; ftSeq++; setFilters(emptyFilters()); closeFilters(); popView.ctx.rerender(); return; } change(emptyFilters()); t.closest('#lib-fp-clear').disabled = true; pop.querySelector('.lib-fp-item')?.focus({ preventScroll: true }); return; }
    if (t.closest?.('#lib-fp-sec-clear')) {
      const sec = secOf(fpPage); if (!sec) return;
      change(sec.kind === 'range' ? { ...filtersOf(), yearFrom: '', yearTo: '' } : sec.kind === 'text' ? { ...filtersOf(), [sec.key]: '' } : withoutPart(filtersOf(), sec.id));
      showSection(fpPage); return;
    }
    const last = t.closest?.('[data-fp-last]');
    if (last) {
      const from = pop.querySelector('[data-fp-year="from"]'), to = pop.querySelector('[data-fp-year="to"]');
      if (from) from.value = lastYears(Number(last.dataset.fpLast));
      if (to) to.value = '';
      years(); return;
    }
    const b = t.closest?.('[data-fp-page]'); if (!b) return;
    const id = b.dataset.fpPage; pickPages.set(id, Math.max(0, (pickPages.get(id) || 0) + Number(b.dataset.step)));
    repick(id);
    pop.querySelector(`[data-fp-page="${CSS.escape(id)}"][data-step="${b.dataset.step}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };
  // Arrows move through the rows; Enter or → opens one; ← or Backspace goes back.
  pop.onkeydown = e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox';
    if (!fpPage) {
      const rows = [...pop.querySelectorAll('.lib-fp-item')], i = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus(); }
      else if (e.key === 'ArrowRight' && i >= 0) { e.preventDefault(); showSection(rows[i].dataset.fpOpen); }
      return;
    }
    if (!typing && (e.key === 'ArrowLeft' || e.key === 'Backspace') || (e.metaKey && e.key === '[')) { e.preventDefault(); showList(); }
  };
}

function wireFilters(el, ctx) {
  popView = { el, ctx };
  const btn = el.querySelector('#lib-filters');
  if (btn) {
    btn.onclick = () => { if (filtersPop) closeFilters(); else openFilters(btn); };
    // A redraw of the view while the popover is open keeps it, under the new button.
    if (filtersPop) { popAnchor = btn; btn.setAttribute('aria-expanded', 'true'); placeFilters(); }
  } else closeFilters();
  wireStatus(el, el, ctx);
}
// ---- end library filters ----------------------------------------------------

/** Removes a record behind a confirmation; the removal can be undone from the notice. */
async function removePaper(id, ctx) {
  const project = projects().current;
  const paper = get().papers.find(p => p.id === id);
  if (!paper) return;
  if (!await confirmAsk('Remove this paper?', { detail: paper.title || paper.label, confirm: 'Remove paper', danger: true })) return;
  if (projects().current !== project) return;
  update(s => {
    const index = s.papers.findIndex(p => p.id === id);
    if (index < 0) return s;
    s.libraryTrash = [...(s.libraryTrash || []), {paper:s.papers[index],index,at:Date.now()}];
    s.papers = s.papers.filter(p => p.id !== id); return s;
  });
  selectedIds.delete(id);
  if (selectedPaper === id) selectedPaper = null;
  if (ctx.openPaper?.() === id) ctx.closeDocument();
  ctx.rerender(); ctx.refreshCounts();
}

/** The row More's PDF entry: opens a saved PDF, or looks for one. */
async function pressPdf(p, ctx) {
  const s = bars.pdfState(p, { downloading: downloadingPaper, inDesktop: inDesktop(), canRetrieve: canRetrievePaper });
  if (s.disabled) return;
  if (s.state === 'have') { ctx.openDocument(p.id); return; }
  const run = retrievePaper(p.id);
  ctx.rerender();                                     // the row shows Finding PDF while it runs
  try { await run; } catch { /* the row shows the failed state */ }
  ctx.rerender(); ctx.refreshCounts();
}

/** A record's More menu: details, its PDF, the reading list, the reference, its collections, removal. */
function rowMenu(btn, p, ctx, selectPaper) {
  const s = bars.pdfState(p, { downloading: downloadingPaper, inDesktop: inDesktop(), canRetrieve: canRetrievePaper });
  const all = coll.collections();
  showMenu(btn, [
    { label: 'Open details', icon: 'inspector', run: () => selectPaper(p.id) },
    // where the PDF cannot be fetched (the browser, a record with nothing to look up) there is no entry, not a disabled one
    ...(s.needsDesktop ? [] : [{ label: s.menu, icon: s.icon, disabled: s.busy, run: () => pressPdf(p, ctx) }]),
    '-',
    { label: 'Reading list', icon: 'book', submenu: readingMenuItems(p.id, ctx) },
    { label: 'Edit reference', icon: 'note', run: () => { startEdit(p.id, () => ctx.rerender()); selectPaper(p.id); } },
    askItem({ kind: 'reference', ref: { paperId: p.id }, key: p.id }),
    ...(all.length ? [{ label: 'Collections', icon: 'folder', submenu: all.map(c => { const has = coll.membersOf(c.id).has(p.id);
      return { label: c.name, checked: has, run: () => { coll.setMembership(c.id, p.id, !has); ctx.rerender(`${p.label || 'Record'} ${has ? 'removed from' : 'added to'} ${c.name}`); } }; }) }] : []),
    '-',
    { label: 'Remove record', icon: 'trash', run: () => removePaper(p.id, ctx) },
  ], { align: 'end', minWidth: 200 });
}

/** Ticks and clears move the selection bar in and out in place: no rerender, so the box keeps its focus and nothing below moves. */
function syncSelection(el) {
  const n = selectedIds.size;
  el.querySelectorAll('[data-select-paper]').forEach(b => { b.checked = selectedIds.has(b.dataset.selectPaper); });
  const region = el.querySelector('#lib-region');
  if (region) regionShow(region, n ? 1 : 0);
  const count = el.querySelector('#lib-selected-count');
  if (count) count.textContent = `${n} selected`;
}

/** The handlers inside the rows and pager, which the filter redraws. */
function wireRows(scope, el, ctx) {
  wirePager(scope, 'lib-pager', n => { listPage = n; redrawRows(el, ctx); });
  // a snippet opens the reader at its page with the words marked
  scope.querySelectorAll('[data-ft-open]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const id = b.dataset.ftOpen;
    selectedPaper = id; ctx.rerender();
    ctx.openDocument(id, { page: Number(b.dataset.ftPage), quote: b.dataset.ftQuote, nth: Number(b.dataset.ftNth) || 0, kind: 'text' });
  });
  scope.querySelectorAll('[data-select-paper]').forEach(b => b.onchange = () => {
    if (b.checked) selectedIds.add(b.dataset.selectPaper); else selectedIds.delete(b.dataset.selectPaper);
    syncSelection(el);
  });
  const selectPaper = id => {
    const reading = Boolean(ctx.openPaper?.());
    selectedPaper = id;
    ctx.rerender();
    if (reading) ctx.openDocument(id); else ctx.openDetails?.();
  };
  scope.querySelectorAll('[data-row]').forEach(tr => tr.onclick = e => {
    if (e.target.closest('button,a,input,label')) return;
    selectPaper(tr.dataset.row);
  });
  scope.querySelectorAll('[data-open]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.open === selectedPaper));
    b.onclick = e => { e.stopPropagation(); const id = b.dataset.open; selectPaper(id);
      el.querySelector(`[data-open="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); };
  });
  const emptyClear = scope.querySelector('#lib-empty-clear');
  if (emptyClear) emptyClear.onclick = () => clearFilters(el, ctx, { text: true });
  scope.querySelectorAll('[data-more]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const p = get().papers.find(x => x.id === b.dataset.more);
    if (p) rowMenu(b, p, ctx, selectPaper);
  });
}

export function render(el, ctx) {
  clearTimeout(undoNoticeTimer);
  queueMicrotask(() => ensurePaperLanguages(() => { if (el.querySelector('.lib-citation') && !el.contains(document.activeElement)) ctx.rerender(); }));
  const papers = get().papers;
  const project = projects().current;
  const removed = get().libraryTrash?.at(-1);
  const noticeRemaining = removed ? removed.at + UNDO_NOTICE_MS - Date.now() : 0;
  const showUndoNotice = noticeRemaining > 0 && removed.at > (get().libraryTrashDismissedAt || 0);
  if (showUndoNotice) undoNoticeTimer = setTimeout(() => {
    if (el.isConnected && projects().current === project && el.querySelector('#lib-undo-remove')) ctx.rerender();
  }, noticeRemaining + 1);
  sync();
  host = { el, ctx };
  selectedPaper = takeReferenceSelection() || selectedPaper;   // an edit started from another page lands on its record
  const ids = new Set(papers.map(p => p.id));
  selectedIds = new Set([...selectedIds].filter(id => ids.has(id)));
  if (papers.length) importNote = '';
  // A check or the duplicate review is a page of its own (the title bar has its Back): the list is not drawn while it is open.
  if (checkOpen()) showDuplicates = false;
  if (checkOpen() || showDuplicates) {
    el.innerHTML = checkOpen() ? checkPanelHtml() : duplicatesPage(duplicateModel(() => { if (showDuplicates && el.isConnected && el.querySelector('[data-lib-page="duplicates"]')) ctx.rerender(); }));
    if (checkOpen()) wireCheckPanel(el, ctx); else wireDuplicates(el, ctx);
    return;
  }
  if (!papers.length && !coll.collections().length) {
    // Removing every record lands here; the removal can still be undone.
    const trash = get().libraryTrash || [];
    el.innerHTML = emptyState({ icon: 'library', title: importNote || (trash.length ? trashLine(trash.at(-1)) : 'No records'),
      actions: [...(trash.length ? [{ id: 'e-undo', label: 'Undo removal', icon: 'undo', primary: true }] : []),
                { id: 'e-import', label: 'Import records', icon: 'import', primary: !trash.length },
                { id: 'e-folder', label: 'Add folder', icon: 'folder' },
                { id: 'e-search', label: 'Search', icon: 'search' }] });
    el.querySelector('#e-import').onclick = () =>
      pick({ accept: IMPORT_ACCEPT }, f => importRecords(f[0], msg => { importNote = msg; ctx.rerender(); }));
    el.querySelector('#e-folder').onclick = () =>
      pick({ directory: true }, f => importFolder(f, () => ctx.rerender()));
    el.querySelector('#e-search').onclick = () => ctx.go('search');
    el.querySelector('#e-undo')?.addEventListener('click', () => undoRemoval(ctx));
    return;
  }

  const m = listModel(papers), model = barModel(m);
  const activeBatch = batch?.project === project ? batch : null;
  const notices = [
    subset && !subset.arrival ? uiNotice({ id: 'lib-subset', label: 'Subset', text: subset.label, actions: [{ id: 'lib-subset-clear', label: 'Show all records' }] }) : '',
    fullText ? ftNoticeHtml() : '',
    offersHtml(),
    showUndoNotice ? uiNotice({ id: 'lib-undo', label: 'Removed', text: trashLine(removed), dismissible: true, actions: [{ id: 'lib-undo-remove', label: 'Undo removal', icon: 'undo' }] }) : '',
    activeBatch ? batchNoticeHtml(activeBatch) : '',
  ].join('');
  // The page's head is the title bar (page()): the collection picker, its count, Add, Check, Export, Find and More. Under it, the list's tools
  // while Find has them open (the selection bar replaces them in their cell, the status line under them); closed, the status line is the cell
  // the selection bar replaces. Ticking a record moves nothing either way.
  el.innerHTML = `<div class="lib">
    <div class="panel lib-list${compactRecords ? ' is-compact' : ''}">
      ${finding(model)
        ? `${uiRegion({ id: 'lib-region', label: 'List controls', active: selectedIds.size ? 1 : 0, bars: [bars.toolsHtml(model), bars.selectionHtml(model)] })}${bars.statusLineHtml(model)}`
        : uiRegion({ id: 'lib-region', label: 'List controls', active: selectedIds.size ? 1 : 0, bars: [bars.statusLineHtml(model), bars.selectionHtml(model)] })}
      ${notices}
      ${listHtml(m)}
      ${pagerHtml(m)}
    </div>
  </div>`;

  wireRows(el, el, ctx);
  const fb = el.querySelector('#lib-filter');
  if (fb) {
    // The box itself is never replaced, so it keeps focus and caret.
    fb.oninput = () => {
      filter = fb.value; listPage = 1;
      clearTimeout(filterTimer);
      if (fullText) { filterTimer = setTimeout(() => runFullText(el, ctx), FULLTEXT_DELAY); return; }
      filterTimer = setTimeout(() => { if (fb.isConnected) redrawRows(el, ctx); }, FILTER_DELAY);
    };
    if (fullText) fb.placeholder = 'Search PDF text';
  }
  wireFullText(el, ctx);
  wireFilters(el, ctx);
  wireOffers(el, ctx);
  el.querySelector('#lib-select-results')?.addEventListener('click', () => { listed.matched.forEach(p => selectedIds.add(p.id)); syncSelection(el); });
  el.querySelector('#lib-clear-selection')?.addEventListener('click', () => { selectedIds.clear(); syncSelection(el); });
  // Sort is a picker: the same menu from the bar, and the folded form's submenu (the engine sends ui-pick).
  const sortBtn = el.querySelector('#lib-sort');
  if (sortBtn) {
    const setSort = id => { const s = bars.sortOf(id); sortKey = s.key; sortDirection = s.direction; listPage = 1; ctx.rerender(); };
    const current = bars.sortIdOf(sortKey, sortDirection);
    sortBtn.onclick = () => showMenu(sortBtn, bars.SORT_OPTIONS.map(([id, label]) => ({ label, checked: id === current, run: () => setSort(id) })), { align: 'end' });
    sortBtn.addEventListener('ui-pick', e => setSort(e.detail.value));
  }
  el.querySelector('#lib-subset-clear')?.addEventListener('click', () => { subset = null; listPage = 1; ctx.rerender(); });
  el.querySelector('#lib-download-selected')?.addEventListener('click', () => downloadSelected(ctx));
  const chosen = () => get().papers.filter(p => selectedIds.has(p.id));
  const collBtn = el.querySelector('#lib-coll-selected');
  if (collBtn) collBtn.onclick = () => {
    const ps = chosen(), items = [];
    for (const c of coll.collections()) {
      const members = coll.membersOf(c.id), all = ps.every(p => members.has(p.id));
      items.push({ label: all ? `Remove from ${c.name}` : `Add to ${c.name}`, icon: all ? 'minus' : 'plus',
        run: () => { ps.forEach(p => coll.setMembership(c.id, p.id, !all)); ctx.rerender(`${ps.length} ${ps.length === 1 ? 'record' : 'records'} ${all ? 'removed from' : 'added to'} ${c.name}`); } });
    }
    showMenu(collBtn, items);
  };
  el.querySelector('#lib-remove-selected')?.addEventListener('click', async () => {
    const project = projects().current, ids = new Set(selectedIds), n = ids.size;
    if (!n || !await confirmAsk(`Remove ${n} ${n === 1 ? 'paper' : 'papers'}?`, { confirm: 'Remove', danger: true })) return;
    if (projects().current !== project) return;
    update(s => {
      const gone = s.papers.map((paper, index) => ({ paper, index })).filter(x => ids.has(x.paper.id));
      if (!gone.length) return s;
      s.libraryTrash = [...(s.libraryTrash || []), { papers: gone, at: Date.now() }];
      s.papers = s.papers.filter(p => !ids.has(p.id)); return s;
    });
    if (ids.has(selectedPaper)) selectedPaper = null;
    if (ids.has(ctx.openPaper?.())) ctx.closeDocument();
    selectedIds.clear();
    ctx.rerender(); ctx.refreshCounts();
  });
  el.querySelector('#lib-stop-download')?.addEventListener('click', () => { batch.cancelled = true; ctx.rerender(); });
  if (activeBatch) wireBatchNotice(el, ctx, activeBatch);
  el.querySelector('#lib-undo-remove')?.addEventListener('click', () => undoRemoval(ctx));
  el.querySelector('#lib-undo-dismiss')?.addEventListener('click', () => {
    update(s => { s.libraryTrashDismissedAt = removed.at; return s; });
    ctx.rerender();
  });
}

/** What the duplicate page draws, from this view's state and the review (lib/dedup.mjs). */
function duplicateModel(onReady) {
  const view = duplicateReview(duplicatePage, PAIRS_PER_PAGE, onReady);
  const state = get(), merged = state.merged || [], distinct = state.dedupDismissed || [];
  const mergedView = pageOf(merged, duplicateMergedPage, PAIRS_PER_PAGE), distinctView = pageOf(distinct, duplicateDistinctPage, PAIRS_PER_PAGE);
  duplicateMergedPage = mergedView.page; duplicateDistinctPage = distinctView.page; duplicatePage = view.page;
  return { view, error: duplicateError, swapped: duplicateSwapped, merged, distinct, mergedView, distinctView, byId: new Map(state.papers.map(p => [p.id, p])), open: duplicateHistoryOpen };
}
/** Redraws one region of the page (the pairs and their pager, or a history), leaving the rest and the scroll where they are. */
function redrawDuplicates(el, ctx, selector) {
  replaceRegions(el, duplicatesPage(duplicateModel(() => {})), [selector]);
  wireDuplicates(el, ctx);
  el.querySelector(`${selector} [data-page]:not(:disabled)`)?.focus({ preventScroll: true });
}
function wireDuplicates(el, ctx) {
  const region = '#dupe-candidate-region';
  // the two records of a pair sit side by side while the list is wide enough for both; below that they stack (measured by the engine's width hook)
  const pairs = el.querySelector('#dupe-rows');
  if (pairs) watchWidth(pairs, () => pairs.toggleAttribute('data-stack', pairsStack(pairs.clientWidth)));
  wirePager(el, 'dupe-pager', n => { duplicatePage = n; redrawDuplicates(el, ctx, region); });
  for (const [id, key] of [['dupe-merged-pager', 'merged'], ['dupe-distinct-pager', 'distinct']]) wirePager(el, id, n => {
    if (key === 'merged') duplicateMergedPage = n; else duplicateDistinctPage = n;
    redrawDuplicates(el, ctx, `#dupe-${key}`);
  });
  el.querySelectorAll('#dupe-merged, #dupe-distinct').forEach(d => d.ontoggle = () => { duplicateHistoryOpen[d.id.replace('dupe-', '')] = d.open; });
  const show = id => ctx.showStudy?.(id, Boolean(get().papers.find(p => p.id === id)?.pdf));
  el.querySelectorAll('[data-check-open]').forEach(b => b.onclick = () => show(b.dataset.checkOpen));
  el.querySelectorAll('[data-merge]').forEach(b => b.onclick = async () => {
    const keep = b.dataset.keep, dup = b.dataset.dup;
    const paper = get().papers.find(p => p.id === dup);
    if (!paper || !await confirmAsk('Merge duplicate records?', {
      detail: `Remove ${paper.title || paper.label} from the active library. Its original record remains available under Merged.`,
      confirm: 'Merge records' })) return;
    try { merge(keep, dup); duplicateError = ''; ctx.rerender(); ctx.refreshCounts(); }
    catch (error) { duplicateError = error.message; ctx.rerender(); }
  });
  // More on a pair: swap which record stays, or mark the two distinct.
  el.querySelectorAll('[data-pair-more]').forEach(b => b.onclick = () => {
    const row = b.closest('.ui-row'), a = row.dataset.pairA, other = row.dataset.pairB, key = `${a}|${other}`;
    showMenu(b, [
      { label: 'Swap keep and remove', icon: 'refresh', run: () => { if (duplicateSwapped.has(key)) duplicateSwapped.delete(key); else duplicateSwapped.add(key); redrawDuplicates(el, ctx, region); } },
      { label: 'Distinct', icon: 'split', run: () => { markDistinct(a, other); duplicateError = ''; ctx.rerender(); } }], { align: 'end' });
  });
  el.querySelectorAll('[data-history-more]').forEach(b => b.onclick = () => {
    const merged = b.dataset.historyMore === 'merged';
    showMenu(b, (merged ? [['Show kept record', b.dataset.keep]] : [['Show first record', b.dataset.a], ['Show second record', b.dataset.b]])
      .map(([label, id]) => ({ label, icon: 'open', disabled: !get().papers.some(p => p.id === id), run: () => show(id) })), { align: 'end' });
  });
  el.querySelectorAll('[data-undo-distinct]').forEach(b => b.onclick = () => {
    undoDistinct(b.dataset.a, b.dataset.b); ctx.rerender();
  });
  el.querySelectorAll('[data-unmerge]').forEach(b => b.onclick = () => {
    unmerge(b.dataset.keep, b.dataset.dup); ctx.rerender(); ctx.refreshCounts();
  });
}

// The inspector's parts remember whether the person opened them: a checkbox or a link redraws the panel, and a part must stay as it was left.
const partOpen = new Map();
const isOpen = (id, fallback) => (partOpen.has(id) ? partOpen.get(id) : fallback);
const relationOf = kind => LINK_KINDS.find(k => k[0] === kind)?.[1] || kind;

/** The record's citation block: label, title, authors, journal and year, DOI, language. */
function paperHeader(p) {
  const doi = p.doi ? `<a class="lib-paper-doi" href="https://doi.org/${esc(encodeURIComponent(p.doi))}" target="_blank" rel="noopener noreferrer">${esc(p.doi)}${icon('open', { size: 12 })}</a>` : '';
  const language = nonEnglishLanguage(p.language) ? `<span class="paper-language">${esc(nonEnglishLanguage(p.language))}</span>` : '';
  return `<div class="lib-paper-info"><span class="meta">${esc(p.label || '')}</span><h3>${esc(p.title || 'Untitled paper')}</h3>
    <p class="lib-paper-authors">${esc(authorLine(p.authors))}</p><p class="meta">${esc([journalDisplay(p.journal), p.year].filter(Boolean).join(' · '))}</p>${doi}${language}</div>`;
}
/** The online Zotero library's user ID and read key: kept ones, or asked once (zotero.org/settings/keys) and kept app-wide. */
async function zoteroAccount() {
  const v = appValues();
  if (v.zoteroUserId && v.zoteroKey) return { userId: v.zoteroUserId, key: v.zoteroKey };
  const got = await formDialog({ id: 'zotero-account', title: 'Your Zotero library', confirm: 'Read library',
    detail: 'Your user ID and a key that can read the library, from zotero.org/settings/keys',
    body: `${formField('User ID', '<input name="userId" inputmode="numeric" autocomplete="off" aria-label="Zotero user ID">')}
      ${formField('API key', '<input name="key" type="password" autocomplete="off" spellcheck="false" aria-label="Zotero API key">')}` });
  if (!got?.userId || !got?.key) return null;
  updateApp(x => { x.zoteroUserId = got.userId.trim(); x.zoteroKey = got.key.trim(); });
  return { userId: got.userId.trim(), key: got.key.trim() };
}
let oaBusy = null;   // the record whose open-access lookup is running (a tab)
/** Open the PDF or find one, Edit reference, and the rest in More. */
function paperActions(p) {
  const busy = downloadingPaper(p.id), needsMatch = !p.doi && p.identified !== 'registry';
  // A browser tab cannot retrieve papers (lib/paper-download.mjs runs in the shell): there a record without a PDF looks for a legal
  // open-access copy (lib/open-access.mjs, Unpaywall then OpenAlex) and opens it, to be downloaded and attached.
  const oa = oaUrl(p);
  const pdf = p.pdf ? { id: 'paper-preview', label: 'Open PDF', icon: 'file-pdf', role: 'primary' }
    : inHostedTab() ? (oa ? { id: 'paper-oa-open', label: 'Open access copy', icon: 'open', role: 'primary' }
      : { id: 'paper-oa', label: oaBusy === p.id ? 'Looking…' : 'Find open access', labelCh: 16, dynamic: true, icon: 'search', role: 'primary', disabled: !p.doi || oaBusy === p.id })
    : { id: 'paper-retrieve', label: busy ? 'Finding PDF…' : 'Find PDF', labelCh: 14, dynamic: true, icon: 'download', role: 'primary', disabled: !inDesktop() || !canRetrievePaper(p) || busy };
  return inspectorActions({ id: 'paper-actions', label: 'Record actions', actions: [...(pdf ? [pdf] : []), { id: 'paper-edit', label: 'Edit reference', icon: 'note' }],
    overflow: [...(p.pdf || inHostedTab() ? [] : [{ id: 'paper-text', label: 'Find full text', disabled: busy }]), ...(needsMatch ? [{ id: 'match-rec', label: 'Match reference' }] : [])] });
}
/** Why the PDF could not be shown, and where else to look. */
function previewPart(p) {
  const error = p.pdfRetrieval?.error || '';
  if (!error) return '';
  const sources = (p.pdfRetrieval?.browserSources || []).filter(url => { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; } });
  const links = sources.map(url => uiLink({ label: `Open ${new URL(url).hostname}`, icon: 'open', attrs: { 'data-preview-browser': url } }));
  if (p.doi && get().settings?.scidbMirror) links.push(uiLink({ id: 'paper-open-scidb', label: 'Open SciDB in browser', icon: 'open' }));
  return disclosure({ id: 'lib-part-preview', title: 'Preview unavailable', open: isOpen('lib-part-preview', false), body: `<div class="lib-preview-error">${esc(error)}</div>${links.join('')}` });
}
const abstractPart = p => disclosure({ id: 'lib-part-abstract', title: 'Abstract', open: isOpen('lib-part-abstract', true),
  body: p.abstract ? `<div class="lib-abstract-body">${abstractHtml(p.abstract)}</div>` : '<p class="meta">No abstract available.</p>' });
/** The collections the record is filed under: a checkbox each. */
function collectionsPart(paperId) {
  const all = coll.collections();
  if (!all.length) return '';
  const mine = new Set(coll.collectionsOf(paperId).map(c => c.id));
  const row = c => `<label class="lib-check"><input type="checkbox" data-member="${esc(c.id)}"${mine.has(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`;
  return disclosure({ id: 'lib-part-collections', title: 'Collections', count: mine.size, open: isOpen('lib-part-collections', false), body: all.map(row).join('') });
}
/** Reports that are the same study, a companion, a preprint: the relation and the report, with a form to add one. */
function linksPart(paperId) {
  const links = (get().links || []).filter(l => l.a === paperId || l.b === paperId);
  const add = uiBar({ kind: 'tools', label: 'Link a report', id: 'link-bar',
    filters: [{ type: 'select', id: 'link-kind', label: 'Relation', options: LINK_KINDS, value: LINK_KINDS[0][0] },
      { type: 'select', id: 'link-to', label: 'Record', options: [['', 'Choose a paper…'], ...get().papers.filter(x => x.id !== paperId).map(x => [x.id, x.label])], value: '' }],
    actions: [{ id: 'link-add', label: 'Link', icon: 'plus' }] });
  const rows = links.map(l => {
    const other = get().papers.find(x => x.id === (l.a === paperId ? l.b : l.a)); if (!other) return '';
    return uiRow({ main: { html: studyCell(other, { open: true }), detail: [relationOf(l.kind)] },
      end: uiRowEnd({ more: { label: `More for ${other.label || 'this report'}`, attrs: { 'data-link-more': l.id } } }) });
  }).filter(Boolean);
  return disclosure({ id: 'lib-part-links', title: 'Related reports', count: links.length, open: isOpen('lib-part-links', false),
    body: `${add}${rows.length ? uiList({ id: 'lib-links', label: 'Related reports', rows }) : ''}` });
}

/** The selected record, for the inspector's Details: its citation, where to find the paper, then its parts, each folded under its title and count. */
function filePanel(paperId) {
  const p = get().papers.find(x => x.id === paperId);
  if (!p) return '';
  const notes = annotationsPanel(p, sortAnnotations(annotationsOf(get(), p.id)));
  return `<div class="lib-file">${paperHeader(p)}${paperActions(p)}${previewPart(p)}${abstractPart(p)}${notes}${collectionsPart(paperId)}${readingPanel(paperId, { open: isOpen('rd-panel', undefined) })}${linksPart(paperId)}</div>`;
}

/** The record's PDF annotations (lib/annotations.mjs), in reading order, each opening the reader where it is. */
function annotationsPanel(p, list) {
  if (!p.pdf && !list.length) return '';
  const rows = list.map(a => uiRow({
    main: { html: `${uiLink({ label: a.text || a.comment || KIND_LABEL[a.kind], cls: 'lib-ann', attrs: { 'data-ann-jump': a.id } })}${a.text && a.comment ? `<span class="lib-ann-comment">${esc(a.comment)}</span>` : ''}`,
      detail: [`p. ${a.page}`, KIND_LABEL[a.kind], a.imported ? 'imported' : ''] } }));
  return disclosure({ id: 'lib-part-annotations', title: 'Annotations', count: list.length, open: isOpen('lib-part-annotations', list.length > 0),
    body: list.length ? `${inspectorActions({ id: 'ann-actions', label: 'Annotation actions', actions: [{ id: 'ann-note', label: 'Note from annotations', icon: 'note' }, { id: 'ann-export', label: 'Export', icon: 'export' }] })}${uiList({ id: 'lib-annotations', label: 'Annotations', rows })}`
      : '<p class="meta">No annotations</p>' });
}

/** The annotations as a page to keep: quotes, comments, and area clips drawn from the PDF. */
async function exportAnnotations(paperId) {
  const p = get().papers.find(x => x.id === paperId);
  const list = sortAnnotations(annotationsOf(get(), paperId));
  let doc = null;
  try {
    if (list.some(a => a.kind === 'area')) { const bytes = await getBytes(paperId); if (bytes) doc = (await loadPdf(bytes)).doc; }
    const parts = [];
    for (const a of list) {
      let img = '';
      if (a.kind === 'area' && doc) img = `<img alt="Area clip, page ${a.page}" src="${(await regionCanvas(doc, a.page, a.rects[0], { width: 1200 })).toDataURL('image/png')}">`;
      parts.push(`<section><h2>Page ${a.page} · ${esc(KIND_LABEL[a.kind])}${a.imported ? ' · imported' : ''}</h2>${a.text ? `<blockquote>${esc(a.text)}</blockquote>` : ''}${img}${a.comment ? `<p>${esc(a.comment)}</p>` : ''}</section>`);
    }
    const title = `${p?.label || p?.title || 'Paper'}: annotations`;
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;line-height:1.5;max-width:760px;margin:32px auto;padding:0 16px}h2{margin:24px 0 4px}blockquote{margin:0;padding-left:12px;border-left:2px solid}img{max-width:100%;border:1px solid}</style><h1>${esc(title)}</h1><p>${esc(p?.title || '')}</p>${parts.join('')}`;
    return saveFile(html, `${String(p?.label || 'paper').replace(/[^\w-]+/g, '-')}-annotations.html`, 'text/html');
  } finally { doc?.destroy?.(); }
}

/** Wires the selected record's details, drawn by the inspector. */
function wirePaper(root, ctx) {
  root.querySelector('#paper-edit')?.addEventListener('click', () => { if (startEdit(selectedPaper, () => ctx.rerender())) ctx.rerender(); });
  wireReadingPanel(root, selectedPaper, ctx);
  root.querySelectorAll('[data-preview-browser]').forEach(button => button.onclick = () => openLink(button.dataset.previewBrowser).catch(error => ctx.rerender(String(error))));
  root.querySelector('#paper-open-scidb')?.addEventListener('click', async () => {
    const p = get().papers.find(p => p.id === selectedPaper);
    try { const root = new URL(get().settings?.scidbMirror || ''); if (!['http:','https:'].includes(root.protocol) || !p?.doi) return; if(root.pathname === '/') root.pathname = '/scidb/'; root.pathname = root.pathname.replace(/\/$/,'') + '/' + p.doi; root.search = ''; root.hash = ''; await openLink(root.href); } catch(e) { ctx.rerender(String(e)); }
  });
  root.querySelector('#paper-preview')?.addEventListener('click', () => ctx.openDocument(selectedPaper));
  root.querySelectorAll('[data-ann-jump]').forEach(b => b.onclick = () => {
    const a = annotationsOf(get(), selectedPaper).find(x => x.id === b.dataset.annJump);
    if (a) ctx.openDocument(selectedPaper, { page: a.page, rects: a.rects, kind: a.kind === 'area' ? 'image' : 'text' });
  });
  root.querySelector('#ann-note')?.addEventListener('click', () => {
    const p = get().papers.find(x => x.id === selectedPaper), list = annotationsOf(get(), selectedPaper);
    if (!p || !list.length) return;
    update(st => { const n = addFileNote(st, { text: annotationNoteText(p, list), source: { kind: 'paper', paperId: p.id, label: p.label || p.title || 'Paper' }, anchor: null }); n.kind = 'literature'; return st; });
    ctx.refreshCounts(); ctx.rerender('Literature note added to Notes');
  });
  root.querySelector('#ann-export')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await exportAnnotations(selectedPaper); } catch (err) { ctx.rerender(String(err.message || err)); } finally { b.disabled = false; }
  });
  root.querySelector('#paper-oa-open')?.addEventListener('click', () => { const p = get().papers.find(x => x.id === selectedPaper); if (oaUrl(p)) openLink(oaUrl(p)).catch(err => ctx.rerender(String(err))); });
  root.querySelector('#paper-oa')?.addEventListener('click', async () => {
    const id = selectedPaper, p = get().papers.find(x => x.id === id); if (!p?.doi) return;
    oaBusy = id; ctx.rerender();
    try {
      const cfg = settingsOf(get());
      const found = await lookupOpenAccess(p.doi, { email: String(cfg.ncbiEmail || ''), settings: cfg });
      update(s => { const x = s.papers.find(q => q.id === id); if (x) x.openAccess = found; return s; });
      oaBusy = null; ctx.rerender(found.found ? `Open access copy found (${found.source}${found.version ? `, ${found.version}` : ''})` : 'No open-access copy found');
    } catch (err) { oaBusy = null; ctx.rerender(`Open access not checked: ${String(err?.message || err).slice(0, 100)}`); }
  });
  for (const [selector, action, working] of [['#paper-retrieve', retrievePaper, 'Finding PDF…'], ['#paper-text', id => retrievePaper(id, { allowText: true }), 'Finding text…']]) {
    root.querySelector(selector)?.addEventListener('click', async () => {
      const id = selectedPaper;
      root.querySelectorAll('#paper-retrieve, #paper-text').forEach(b => { b.disabled = true; });
      const label = root.querySelector('#paper-retrieve .ui-act-label'); if (label) label.textContent = working;
      try { await action(id); ctx.rerender(); ctx.refreshCounts(); if (selectedPaper === id) ctx.openDocument(id); }
      catch (e) { if (selectedPaper === id) ctx.rerender(); }
    });
  }
  // A record identification could not resolve (a scan without a text layer,
  // a preprint) is matched by hand: a DOI or a title, looked up the same way.
  root.querySelector('#link-add')?.addEventListener('click', () => {
    const to = root.querySelector('#link-to').value, kind = root.querySelector('#link-kind').value;
    if (!to || !selectedPaper) return;
    update(st => { st.links = [...(st.links || []), { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, a: selectedPaper, b: to, kind, at: new Date().toISOString() }]; return st; });
    ctx.rerender();
  });
  root.querySelectorAll('[data-link-more]').forEach(b => b.onclick = () => {
    const link = (get().links || []).find(l => l.id === b.dataset.linkMore); if (!link) return;
    const other = link.a === selectedPaper ? link.b : link.a;
    showMenu(b, [{ label: 'Show report', icon: 'open', run: () => ctx.showStudy?.(other, Boolean(get().papers.find(x => x.id === other)?.pdf)) },
      { label: 'Remove link', icon: 'close', run: () => { update(st => { st.links = (st.links || []).filter(l => l.id !== link.id); return st; }); ctx.rerender(); } }], { align: 'end' });
  });
  root.querySelectorAll('.lib-file details.ui-disclosure[id]').forEach(d => d.addEventListener('toggle', () => partOpen.set(d.id, d.open)));
  root.querySelector('#match-rec')?.addEventListener('click', async () => {
    const p = get().papers.find(x => x.id === selectedPaper);
    if (!p) return;
    const q = await ask('Match record', { value: p.doi || p.title || '', placeholder: 'DOI or title', confirm: 'Look up' });
    if (!q?.trim()) return;
    let rec = null;
    try {
      const doi = q.match(/10\.\d{4,9}\/[^\s"'<>]+/)?.[0];
      rec = doi ? await lookupDoi(doi) : (await matchTitle(q.trim(), { threshold: 0.7 }))?.record || null;
    } catch { rec = null; }
    if (!rec) { ctx.say?.(`No match for “${q.trim()}”`); return; }
    const ok = await confirmAsk(rec.title, { detail: [authorLine(rec.authors), rec.journal, rec.year].filter(Boolean).join(' · '), confirm: 'Use this' });
    if (!ok) return;
    update(s => {
      const x = s.papers.find(y => y.id === p.id); if (!x) return s;
      Object.assign(x, { title: rec.title, authors: rec.authors, journal: rec.journal, year: rec.year ? String(rec.year) : '',
        doi: rec.doi, url: rec.url, source: rec.source, identified: 'registry', unidentified: false,
        label: [rec.authors[0] ? familyName(rec.authors[0]) : 'Study', rec.year].filter(Boolean).join(' ') });
      return s;
    });
    ctx.rerender(); ctx.refreshCounts();
  });
  root.querySelectorAll('[data-member]').forEach(cb => cb.onchange = () => {
    coll.setMembership(cb.dataset.member, selectedPaper, cb.checked);
    ctx.rerender();
  });
}

/** The inspector's Details: the selected record. */
export function inspect(ctx) {
  // a reference being edited or made takes the record's detail until it is saved or cancelled (lib/reference-editor.mjs)
  if (referenceDraft()) return [{ html: referenceEditorHtml(), wire: root => wireReferenceEditor(root, { rerender: () => ctx.rerender() }) }];
  if (!selectedPaper || !get().papers.some(x => x.id === selectedPaper)) return [];
  return [{ html: filePanel(selectedPaper), wire: root => wirePaper(root, ctx) }];
}

// ---- the watched folder (plan B3) ------------------------------------------
// New exports in the watched folder are offered here, one row each, and
// imported only when Import is pressed.
function offersHtml() {
  const list = watchOffers(); if (!list.length) return '';
  const w = watchState();
  return list.map((o, i) => uiNotice({ id: `lib-offer-${i}`, label: 'Import offer', text: `New in ${w?.dir || 'the watched folder'}: ${o.name}`,
    actions: [{ id: `lib-offer-import-${i}`, label: 'Import', icon: 'import', attrs: { 'data-offer-import': o.name } }, { id: `lib-offer-ignore-${i}`, label: 'Ignore', attrs: { 'data-offer-ignore': o.name } }] })).join('');
}
let offersUnsub = null;
function wireOffers(el, ctx) {
  offersUnsub?.();
  offersUnsub = onOffers(() => { offersUnsub?.(); offersUnsub = null; setTimeout(() => { if (el.isConnected && !el.contains(document.activeElement)) ctx.rerender(); }, 0); });
  el.querySelectorAll('[data-offer-ignore]').forEach(b => b.onclick = () => { settleOffer(b.dataset.offerIgnore, { ignore: true }); ctx.rerender(); });
  el.querySelectorAll('[data-offer-import]').forEach(b => b.onclick = async () => {
    const o = settleOffer(b.dataset.offerImport); const folder = activeFolder();
    if (!o || !folder) return;
    b.disabled = true;
    try { await importRecords(new File([await folder.read(o.rel)], o.name), msg => ctx.rerender(msg), { rel: o.rel }); }
    catch (err) { ctx.rerender(`${o.name}: ${err.message.slice(0, 100)}`); }
  });
}
/** Which folder is watched: the project's top-level folders, or off. */
async function watchMenu(anchor, rerender) {
  const folder = activeFolder(); if (!folder) return;
  const dirs = (await folder.list('').catch(() => [])).filter(e => e.dir && !e.name.startsWith('.')).map(e => e.name);
  const w = watchState(); const on = w?.on ? w.dir : '';
  showMenu(anchor?.isConnected ? anchor : document.querySelector('.library-action-add') || document.body, [
    { heading: 'Watched folder' },
    ...dirs.map(d => ({ label: d, checked: on === d, run: () => { setWatchDir(d); rerender(`Watching ${d}`); } })),
    '-', { label: 'Off', checked: !on, run: () => { setWatchDir(''); rerender('Not watching a folder'); } }]);
}

// ---- import -------------------------------------------------------------
export function pick({ accept, multiple, directory }, fn) {
  const i = document.createElement('input');
  i.type = 'file';
  if (accept) i.accept = accept;
  if (multiple) i.multiple = true;
  if (directory) { i.webkitdirectory = true; i.multiple = true; }
  i.hidden = true; document.body.appendChild(i);
  i.onchange = async () => { try { if (i.files.length) await fn([...i.files]); } finally { i.remove(); } };
  i.oncancel = () => i.remove();
  i.click();
}

export const IMPORT_ACCEPT = '.ris,.nbib,.enw,.ciw,.txt,.bib,.bibtex,.json,.xml,.csv,.tsv,.xlsx';

/**
 * Imports a search export (plan B3). The bytes are decoded by what they are
 * (lib/import-safety.mjs: BOM, UTF-8, else Windows-1252, then mojibake
 * repaired) and the file itself is kept: in a folder project a copy goes to
 * "<search folder>/Raw imports/", in app storage a gzip copy is kept in the
 * app's file store when it is at most RAW_STORE_MAX compressed, else only its
 * hash. The search-log entry names the copy and its SHA-256. `rel` is the
 * file's path when it already lives in the project folder (the watched
 * folder, the folder view): then it is not copied again.
 */
export async function importRecords(file, done, opts = {}) {
  try { return await importRecordsFrom(file, done, opts); }
  catch (err) { done?.(`Could not import ${file?.name || 'the file'}: ${String(err?.message || err).slice(0, 120)}`); }
}
async function importRecordsFrom(file, done, { rel = '' } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A workbook (a database's Excel export, or a sheet someone kept) is read
  // sheet by sheet: the first whose header names a title column is the records.
  const workbook = /\.xlsx$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  const decoded = workbook ? { text: '', encoding: 'utf-8', repaired: false } : decodeImport(bytes);
  const text = decoded.text;
  // Importing a Lykos backup through Library restores missing record IDs only.
  // Existing records and review decisions stay intact.
  let backup; try { backup = JSON.parse(text); } catch { /* bibliographic text */ }
  if (Array.isArray(backup?.papers)) {
    let added = 0;
    update(s => {
      const have = new Set(s.papers.map(p => p.id));
      for (const p of backup.papers) if (typeof p.id === 'string' && p.title && !have.has(p.id)) {
        s.papers.push({ ...p, pdf: null }); have.add(p.id); added++;
      }
      return s;
    });
    done(`${added} missing records restored`); return;
  }
  let { records, format, errors, identifiers } = workbook ? await recordsFromWorkbook(bytes) : parseRecords(text, file.name);
  let missing = 0;
  // A file of identifiers: each is looked up (Crossref, PubMed, ClinicalTrials.gov) and added as a record.
  if (!records.length && identifiers) {
    done('Looking up identifiers');
    const { recordsFromIdentifiers } = await import('../lib/ref-lookup.mjs');
    try { records = await recordsFromIdentifiers(identifiers, { settings: settings() }); missing = records.missing?.length || 0; format = 'identifiers'; }
    catch (err) { done(`Could not look up identifiers: ${err.message}`); return; }
  }
  if (!records.length) { done(`No records read from ${file.name}${errors ? ` · ${errors} unparsed` : ''}`); return; }
  const result = importInto(get(), records, file.name);   // a dry run: the counts for the message
  const at = new Date().toISOString();
  const raw = await keepRaw(file.name, bytes, decoded, { rel, at }).catch(err => ({ kept: 'hash', error: err.message.slice(0, 120) }));
  update(s => { importInto(s, records, file.name, { at, raw, file: raw.rel || rel || '' }); return s; });
  done([`${result.added} added from ${format}`, result.duplicates ? `${result.duplicates} already in the library` : '', result.possible ? `${result.possible} possible ${result.possible === 1 ? 'duplicate' : 'duplicates'} kept for review` : '', errors ? `${errors} unparsed` : '', missing ? `${missing} not found` : '', encodingNote(decoded)].filter(Boolean).join(' · '));
}

/** Looks up missing details, lists them, and writes them only after a yes; the batch is undone as one. */
async function fillMissing(rerender) {
  const { enrichRecords, applyEnrichment } = await import('../lib/ref-lookup.mjs');
  const papers = get().papers.filter(p => p.doi || p.pmid);
  if (!papers.length) { rerender('No record has a DOI or PMID to look up'); return; }
  rerender(`Looking up ${papers.length} records`);
  let changes;
  try { changes = await enrichRecords(papers, { settings: settings() }); } catch (err) { rerender(`Could not look up: ${err.message}`); return; }
  if (!changes.length) { rerender('Nothing missing that the sources could fill'); return; }
  const by = changes.reduce((m, c) => (m[c.field] = (m[c.field] || 0) + 1, m), {});
  if (!await confirmAsk(`Fill ${changes.length} missing ${changes.length === 1 ? 'detail' : 'details'}?`, { detail: Object.entries(by).map(([f, n]) => `${n} ${f}`).join(' · '), confirm: 'Fill' })) return;
  const at = new Date().toISOString();
  let applied = 0; update(s => { applied = applyEnrichment(s, changes, at).applied; return s; });
  rerender(`${applied} details filled`);
}
/** Undoes the last fill that has not been undone; a detail edited since is left as it is. */
async function undoFill(rerender) {
  const { undoEnrichment } = await import('../lib/ref-lookup.mjs');
  let restored = 0; update(s => { restored = undoEnrichment(s).restored; return s; });
  rerender(`${restored} filled details undone`);
}

async function recordsFromWorkbook(bytes) {
  const { readXlsx } = await import('../lib/xlsx-read.mjs');
  const wb = await readXlsx(bytes);
  const sheet = wb.sheets.find(sh => looksLikeRecords(sh.rows.find(r => r.some(c => String(c ?? '').trim())) || [])) || null;
  if (!sheet) return { records: [], format: 'Workbook', errors: wb.sheets.reduce((n, sh) => n + sh.rows.length, 0) };
  const at = sheet.rows.findIndex(r => r.some(c => String(c ?? '').trim()));
  return recordsFromRows(sheet.rows.slice(at), `Workbook · ${sheet.name}`);
}

// The raw file kept (plan B3); returns what the search log records about it.
async function keepRaw(name, bytes, decoded, { rel = '', at }) {
  const folder = activeFolder();
  const searchDir = folder ? (await projectLayout(folder, researchType(get()).id)).dirFor('search') : '';
  return keepRawFile({ folder, state: get(), name, bytes, decoded, rel, at, searchDir, putFile });
}

/**
 * Copies a file we were handed, because a file input gives nothing to re-find.
 * In a folder project the copy goes into the folder's papers/ directory, where
 * the user can see it, rather than into the app's storage, where they cannot.
 */
async function storePdf(paperId, file, hash = null) {
  const folder = activeFolder();
  if (folder) {
    // The project's papers folder: "04 Papers" in a folder Lykos laid out, the person's own otherwise, else papers/.
    const rel = await freeName(folder, join(await papersDir(folder, researchType(get()).id), file.name));
    await folder.writeBytes(rel, new Uint8Array(await file.arrayBuffer()));
    markFolderPdf(paperId, rel, file.size, hash);
    return;
  }
  await putFile(paperId, file);
  markPdf(paperId, file.name, file.size, 'copy');
  queuePaper(paperId);
  if (hash) update(s2 => { const p = s2.papers.find(x => x.id === paperId); if (p) p.pdfHash = hash; return s2; });
}

/** Links a file that stays where the user keeps it. */
async function linkPdf(paperId, handle, name, size) {
  await putHandle(paperId, handle);
  markPdf(paperId, name, size, 'link');
  queuePaper(paperId);
}

export function markFolderPdf(paperId, rel, size, hash) {
  update(s => {
    const p = s.papers.find(x => x.id === paperId);
    if (p) { p.pdf = true; p.pdfName = baseName(rel); p.pdfSize = size; p.pdfMode = 'folder'; p.pdfRel = rel; if (hash) p.pdfHash = hash; }
    return s;
  });
  queuePaper(paperId);
}

/** The record a placed file belongs to, made when the library has none. */
function recordFor(r, filename, tally) {
  let paper = r.paper;
  if (!paper) {
    // Nothing in the file identifies it. A record is still made, named
    // after the file and marked so it shows up as work to do, rather than
    // dropping the file on the floor.
    const stem = filename.replace(/\.pdf$/i, '');
    const id = `pdf-${r.meta.hash.slice(0, 12)}`;
    paper = { id, key: id, title: stem, label: stem.slice(0, 40), authors: [], year: '',
      source: 'file', pdf: null, unidentified: true };
    tally.unidentified++;
    update(s2 => { if (!s2.papers.some(x => x.key === paper.key)) s2.papers.push(paper); return s2; });
  } else if (r.how.startsWith('new')) {
    update(s2 => { if (!s2.papers.some(x => x.key === paper.key)) s2.papers.push(paper); return s2; });
    tally.created++;
  }
  return paper;
}

/**
 * A run of PDFs shown in the progress card (lib/transfers.mjs), driven by the run's own "3 of 40: name.pdf" lines and ended by its last
 * line (the summary); the card appears with the first file, so a picker left closed shows nothing. A run that throws ends its row so.
 */
async function carded(title, done, run) {
  let card = null, last = '';
  const say = text => {
    last = String(text || ''); done(text);
    const m = /^(\d+) of (\d+): (.*)$/.exec(last);
    if (m) { card ??= cardOf(title); card.then(c => c.step(+m[1] - 1, +m[2], m[3])); }
  };
  try { const out = await run(say); card?.then(c => c.finish(last)); return out; }
  catch (err) { card?.then(c => c.fail(String(err?.message || err))); throw err; }
}
const cardOf = title => import('../lib/transfers.mjs').then(m => m.transfer(title));
export const addFolderPdfs = (rels, done) => carded('PDFs from the folder', done, d => addFolderPdfsRun(rels, d));
const linkFolder = done => carded('Linked folder', done, d => linkFolderRun(d));
const attachPdfs = (files, done) => carded('PDFs', done, d => attachPdfsRun(files, d));
export const importFolder = (files, done) => carded('PDFs from a folder', done, d => importFolderRun(files, d));

/**
 * PDFs already inside the project folder, added where they lie. A file whose
 * bytes are already in the library is pointed at from its record, so the
 * folder copy is the one the reader opens from then on.
 */
export async function addFolderPdfsRun(rels, done) {
  const folder = activeFolder();
  if (!folder) return null;
  const tally = { attached: 0, duplicates: 0, created: 0, unidentified: 0 };
  let i = 0, last = null;
  for (const rel of rels) {
    i++;
    done(`${i} of ${rels.length}: ${baseName(rel)}`);
    const bytes = await folder.read(rel);
    const file = new File([bytes], baseName(rel), { type: 'application/pdf' });
    const r = await placeFile(file, bytes, { say: done });
    if (r.how === 'duplicate-file') {
      markFolderPdf(r.paper.id, rel, bytes.length, r.meta.hash);
      tally.duplicates++; last = r.paper; continue;
    }
    last = recordFor(r, baseName(rel), tally);
    markFolderPdf(last.id, rel, bytes.length, r.meta.hash);
    tally.attached++;
  }
  done(summary(tally));
  return last;
}

function markPdf(paperId, name, size, mode) {
  update(s => {
    const p = s.papers.find(x => x.id === paperId);
    if (p) { p.pdf = true; p.pdfName = name; p.pdfSize = size; p.pdfMode = mode; }
    return s;
  });
}

/**
 * Walks a directory the user picked and links every PDF in place. Folders
 * become collections, exactly as before — but nothing is copied, so linking a
 * library of several gigabytes costs a handle per file.
 */
async function linkFolderRun(done) {
  if (!canLink()) { done('Folder linking is not available here'); return; }
  // Two ways to reach a folder: the browser's directory handle, or the shell's
  // picker with reads through Rust. The rest is the same either way.
  let entries = [], manifest = null;
  const review = get();
  if (inDesktop()) {
    const dir = await pickFolderNative().catch(() => null);
    if (!dir) return;
    try {
      const decoded = JSON.parse(new TextDecoder().decode(await readFileNative(`${dir}/manifest.json`)));
      if (decoded.format === 'lykos-paper-downloads-1' && Array.isArray(decoded.files)) manifest = decoded.files;
    } catch { /* Ordinary folders do not need a manifest. */ }
    entries = (await listPdfsNative(dir)).map(x => ({
      kind: 'file', name: x.path.split('/').pop(), path: x.path, size: x.size,
      getFile: async () => { const bytes = await readFileNative(x.path); return new File([bytes], x.path.split('/').pop(), { type: 'application/pdf' }); },
    }));
  } else {
    let dir;
    try { dir = await window.showDirectoryPicker({ mode: 'read' }); } catch { return; }
    await putHandle(`dir:${dir.name}`, dir);
    for await (const entry of dir.values())
      if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) entries.push(entry);
  }
  const tally = { attached: 0, duplicates: 0, created: 0, unidentified: 0 };
  let i = 0;
  for (const entry of entries) {
    i++;
    done(`${i} of ${entries.length}: ${entry.name}`);
    const file = await entry.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (get() !== review) { done('Review changed; folder linking stopped'); return; }
    const receipt = manifest?.find(x => x.file === entry.name && !/[\\/]/.test(x.file));
    const matched = receipt && get().papers.find(p => p.id === receipt.id &&
      String(p.doi || '').toLowerCase() === String(receipt.doi || '').toLowerCase());
    let r;
    if (matched) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== receipt.sha256) { done(`Changed file skipped: ${entry.name}`); continue; }
      const parsed = await loadPdf(bytes);
      await parsed.doc.destroy?.();
      r = { paper: matched, how: 'matched-download', meta: { hash: parsed.hash } };
    } else r = await placeFile(file, bytes, { say: done });
    if (r.how === 'duplicate-file') { tally.duplicates++; continue; }
    const paper = recordFor(r, entry.name, tally);
    await linkPdf(paper.id, entry.path ? { path: entry.path } : entry, entry.name, file.size);
    update(s2 => { const p2 = s2.papers.find(x => x.id === paper.id); if (p2) p2.pdfHash = r.meta.hash; return s2; });
    tally.attached++;
  }
  done(summary(tally));
}

/** Matches a PDF to a record by filename, falling back to the open selection. */
async function attachPdfsRun(files, done) {
  const tally = { attached: 0, duplicates: 0, created: 0, unidentified: 0 };
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await placeFile(f, bytes, { say: done });
    if (r.how === 'duplicate-file') { tally.duplicates++; continue; }
    if (!r.paper) {
      // Nothing in the file identifies it; the selected record, if one, is the
      // user's answer.
      const sel = files.length === 1 ? get().papers.find(p => p.id === selectedPaper) : null;
      if (!sel) { tally.unidentified++; continue; }
      r.paper = sel;
    }
    if (r.how.startsWith('new')) {
      update(s2 => { if (!s2.papers.some(x => x.key === r.paper.key)) s2.papers.push(r.paper); return s2; });
      tally.created++;
    }
    await storePdf(r.paper.id, f, r.meta.hash);
    tally.attached++;
  }
  done(summary(tally));
}

const summary = t => [`${t.attached} attached`, t.created ? `${t.created} new records` : '',
  t.duplicates ? `${t.duplicates} already in the library` : '',
  t.unidentified ? `${t.unidentified} not identified` : ''].filter(Boolean).join(' · ');

export async function importFolderRun(files, done) {
  const pdfs = [...files].filter(f => /\.pdf$/i.test(f.name));
  const tally = { attached: 0, duplicates: 0, created: 0, unidentified: 0 };
  let i = 0;
  for (const f of pdfs) {
    i++;
    done(`${i} of ${pdfs.length}: ${f.name}`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await placeFile(f, bytes, { say: done });
    if (r.how === 'duplicate-file') { tally.duplicates++; continue; }
    const paper = recordFor(r, f.name, tally);
    await storePdf(paper.id, f, r.meta.hash);
    tally.attached++;
  }
  done(summary(tally));
}

function matchByName(filename) {
  const norm = s => String(s).toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const target = norm(filename);
  if (!target) return null;
  return get().papers.find(p =>
    norm(p.pdfName || '') === target || norm(p.key) === target ||
    norm(p.label) === target || norm(p.title).startsWith(target.slice(0, 24)));
}


/**
 * Which record a PDF belongs to — found, never assumed from the file name.
 *
 * Order: the same bytes already stored (a copy); a record with the paper's
 * DOI; a record whose title is the paper's title; then Crossref by DOI, then
 * by title with a strict match; last, a record made from the paper's own
 * title. Each outcome is named in the result so the import can say what it
 * did with every file.
 */
export async function placeFile(file, bytes, { say } = {}) {
  const meta = await identify(bytes, { name: file.name });
  const papers = get().papers;
  const byHash = papers.find(p => p.pdfHash === meta.hash);
  if (byHash) return { how: 'duplicate-file', paper: byHash, meta };
  if (meta.doi) {
    const key = `doi-${meta.doi.toLowerCase()}`;
    const byDoi = papers.find(p => p.key === key || (p.doi && p.doi.toLowerCase() === meta.doi.toLowerCase()));
    if (byDoi) return { how: 'matched-doi', paper: byDoi, meta };
  }
  if (meta.title) {
    let best = null, score = 0;
    for (const p of papers) { const sc = similarity(meta.title, p.title); if (sc > score) { score = sc; best = p; } }
    if (best && score >= 0.85) return { how: 'matched-title', paper: best, meta };
  }
  say?.(`Looking up ${file.name}`);
  try {
    if (meta.doi) {
      const rec = await lookupDoi(meta.doi);
      if (rec) return { how: 'new-from-doi', paper: toLibrary(rec), meta };
    }
    if (meta.title) {
      const m = await matchTitle(meta.title);
      if (m) return { how: 'new-from-title', paper: toLibrary(m.record), meta };
    }
  } catch (err) { say?.(`Registry: ${err.message}`); }
  if (meta.title) {
    const id = `pdf-${meta.hash.slice(0, 12)}`;
    return { how: 'new-from-pdf', meta, paper: { id, key: id, title: meta.title,
      label: meta.title.split(/\s+/).slice(0, 3).join(' '), authors: [], year: '', doi: meta.doi || '',
      source: 'PDF', pdf: null } };
  }
  return { how: 'unidentified', meta, paper: null };
}

function toLibrary(r) {
  const first = r.authors[0] ? familyName(r.authors[0]) : '';
  const y = r.year ? String(r.year) : '';
  return { ...r, id: r.key, year: y, label: [first || 'Study', y].filter(Boolean).join(' '), pdf: null };
}




/** Export the library (or the open collection) as RIS, BibTeX or CSV. */
export function exportRecords(fmt, rerender) {
  const s = get();
  const papers = autoOf(selectedCollection) ? autoOf(selectedCollection).papers(s) : selectedCollection ? s.papers.filter(p => coll.collectionsOf(p.id).some(c => c.id === selectedCollection)) : s.papers;
  const text = fmt === 'ris' ? toRis(papers) : fmt === 'bib' ? toBibtex(papers) : toCsv(papers);
  const name = `${(s.paper?.title || 'lykos-library').replace(/[^\w-]+/g, '-').slice(0, 40)}.${fmt}`;
  saveFile(text, name, 'text/plain');
  rerender(`${papers.length} records exported`);
}

/** Puts back the last removal: one paper, or a whole batch at its old places. */
function undoRemoval(ctx) {
  update(s => {
    const trash = [...(s.libraryTrash || [])], item = trash.pop();
    const back = item ? (item.papers || [{ paper: item.paper, index: item.index }]) : [];
    for (const x of back.slice().sort((a, b) => a.index - b.index))
      if (!s.papers.some(p => p.id === x.paper.id)) s.papers.splice(Math.min(x.index, s.papers.length), 0, x.paper);
    s.libraryTrash = trash; return s;
  });
  ctx.rerender(); ctx.refreshCounts();
}

const trashLine = item => item.papers
  ? `${item.papers.length} ${item.papers.length === 1 ? 'paper' : 'papers'} removed`
  : `Paper removed · ${item.paper.label || 'Reference'}`;

async function downloadSelected(ctx) {
  if (batch?.running) return;
  if (!inDesktop()) { ctx.rerender('Open the desktop app to download selected PDFs'); return; }
  const project = projects().current, chosen = get().papers.filter(p => selectedIds.has(p.id));
  if (!chosen.length) return;
  let dir;
  try { dir = await pickDownloadFolderNative(); } catch (e) { ctx.rerender(String(e)); return; }
  if (!dir || projects().current !== project) return;
  const task = batch = { project, dir, running:true, cancelled:false, total:chosen.length, finished:0, saved:0, errors:[] };
  ctx.rerender();
  try {
    for (const paper of chosen) {
      if (task.cancelled || projects().current !== project) { task.cancelled = true; break; }
      try {
        await retrievePaper(paper.id);
        if (projects().current !== project) { task.cancelled = true; break; }
        const bytes = await getBytes(paper.id);
        if (!bytes) throw new Error('No PDF returned');
        await savePdfToFolderNative(dir, pdfFilename(paper), bytes);
        task.saved++; countOpen(task, paper.id);
      } catch (e) { task.errors.push({id:paper.id,label:paper.label || paper.title,error:String(e.message || e)}); }
      task.finished++; ctx.rerender();
    }
  } finally { task.running = false; ctx.rerender(); }
}

/** The check panel a key like library:quality opens (app.mjs go). */
export { openCheck };
