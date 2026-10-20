// The Library list pane as declarations: what each bar, the status line and a row IS, with no DOM and no store (library plan, section 5 step 1).
// library.mjs builds the model from its state and renders these with the shared builders (lib/ui-actions.mjs); the tests render them under Node,
// where a bad spec throws. Nothing here places a control: placement is the builders' and ui-actions.css's.
import { uiBar, uiStatusLine, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { pdfRank, availabilityCounts } from '../lib/library-records.mjs';
import { activeCount, activeParts, applyFilters, withoutPart } from '../lib/record-filters.mjs';

/** Sort choices: id, label. The id maps to the view's sortKey and sortDirection. */
export const SORT_OPTIONS = Object.freeze([['', 'Order added'], ['year-desc', 'Newest first'], ['year-asc', 'Oldest first'], ['title', 'Title A–Z'], ['authors', 'Authors A–Z'], ['source', 'Source A–Z'], ['pdf', 'PDF first']]);
export const SORT_LABEL = Object.freeze(Object.fromEntries(SORT_OPTIONS));
const SORTS = { '': ['', 1], 'year-desc': ['year', -1], 'year-asc': ['year', 1], title: ['title', 1], authors: ['authors', 1], source: ['source', 1], pdf: ['pdf', -1] };
/** The key and direction lib/library-records.mjs sortRecords takes for a sort id. */
export const sortOf = id => { const [key, direction] = SORTS[id] || SORTS['']; return { key, direction }; };
/** The sort id of a key and direction; a pair no choice names reads as the order added. */
export const sortIdOf = (key, direction = 1) => Object.entries(SORTS).find(([, [k, d]]) => k === (key || '') && d === (key ? direction : 1))?.[0] ?? '';

// ---- PDF availability shortcuts -----------------------------------------------------------------------------------------
/** The pdf filter section each status-line count sets. 'available' is what availabilityCounts calls available: attached or fetchable. */
export const PDF_SHORTCUTS = Object.freeze({ available: ['attached', 'available'], unresolved: ['unresolved'], unchecked: ['unchecked'] });
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
/** The shortcut whose picks equal the current pdf section exactly, else null: a pick no shortcut names must not show one pressed. */
export function shortcutOf(fs) {
  const pick = fs?.pick?.pdf || [];
  if (!pick.length) return null;
  return Object.keys(PDF_SHORTCUTS).find(k => sameSet(pick, PDF_SHORTCUTS[k])) ?? null;
}
/** The filter state after pressing a shortcut: its picks, or none when it is the one pressed. */
export function pressShortcut(fs, key) {
  if (shortcutOf(fs) === key) return withoutPart(fs, 'pdf');
  return { ...fs, pick: { ...(fs.pick || {}), pdf: [...PDF_SHORTCUTS[key]] } };
}
/** The three counts over everything except the pdf section, so pressing one never zeroes the other two. `facts` is recordFacts() of the papers. */
export function availabilityScope(found, fs, facts) {
  const base = fs?.pick?.pdf?.length ? withoutPart(fs, 'pdf') : fs;
  return availabilityCounts(activeCount(base) ? applyFilters(found, base, facts) : found);
}
/** What the status line says about the narrowing: the filters except the pdf one a pressed shortcut already shows, then the PDF text mode. */
export function summaryText(fs, sections, fullText, shortcut) {
  const parts = activeParts(withoutPart(fs, 'pdf'), sections).map(p => p.text);
  if (shortcut === null && fs?.pick?.pdf?.length) { const p = activeParts(fs, sections).find(x => x.key === 'pdf'); if (p) parts.push(p.text); }
  if (fullText) parts.push('Search within PDF text');
  return parts.join(' · ');
}

// ---- counts -------------------------------------------------------------------------------------------------------------
/** "460", or "132 of 460" while a filter or the search narrows the scope. Plain digits: the head slot holds a fixed width. */
export const countText = ({ matched, inScope, narrowed }) => `${matched}${narrowed ? ` of ${inScope}` : ''}`;
export const selectAllText = ({ matched }) => `Select all ${matched} results`;

// ---- the page: its head is the shell's title bar (lib/topbar.mjs) ---------------------------------------------------------------
/**
 * The Library's title bar, declared (views/library.mjs page()): the collection as a picker title, its count in a fixed slot, Add, Check and
 * Export, and one More with the collection's commands and the list's (TOPBAR R10: one More per surface). Each act and entry keeps its id and
 * takes its handler from `run` by id; `run.pick(anchor)` opens the collection picker.
 * model: { collectionName, isUserCollection, matched, inScope, narrowed, compact }
 */
export function pageSpec(m, run = {}) {
  const on = id => run[id] || (() => {});
  const act = (id, label, icon) => ({ id, label, icon, menu: true, run: on(id) });
  const entry = (id, label, more = {}) => ({ id, label, ...more, run: on(id) });
  return { title: m.collectionName, ...(run.pick ? { titleMenu: run.pick } : {}),
    status: { text: countText(m), ch: 14 },
    actions: [act('lib-menu-add', 'Add', 'plus'), act('lib-menu-check', 'Check', 'check'), act('lib-menu-export', 'Export', 'export')],
    overflow: [
      entry('lib-coll-new', 'New collection'),
      ...(m.isUserCollection ? [entry('rename-coll', 'Rename collection'), entry('del-coll', 'Delete collection', { danger: true })] : []),
      '-',
      entry('lib-select-page', 'Select this page'),
      // named for the non-default state: More is marked active while an overflow toggle is checked, and the default (compact) must not show it
      entry('lib-density', 'Detailed rows', { kind: 'toggle', checked: !m.compact })] };
}

/** model: { filter, fullText, sortId, filtersActive, popOpen } */
export function toolsSpec(m) {
  return { kind: 'tools', label: 'Find records', id: 'lib-tools',
    filters: [{ type: 'search', id: 'lib-filter', label: 'Filter records', placeholder: m.fullText ? 'Search PDF text' : 'Filter', value: m.filter || '' }],
    actions: [
      { picker: true, id: 'lib-sort', label: 'Sort', role: 'quiet', value: SORT_LABEL[m.sortId || ''] ?? SORT_LABEL[''], options: SORT_OPTIONS },
      { id: 'lib-filters', label: 'Filters', icon: 'filter', pressed: !!(m.filtersActive || m.fullText), attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': String(!!m.popOpen) } }] };
}

/** model: { selectedCount, hasCollections, batchRunning, matched }. Export is the title bar's: its menu acts on the selection while there is one. */
export function selectionSpec(m) {
  return { kind: 'tools', label: 'Selection', id: 'lib-selection',
    status: { id: 'lib-selected-count', text: `${m.selectedCount} selected`, ch: 14 },
    actions: [
      ...(m.hasCollections ? [{ id: 'lib-coll-selected', label: 'Collection', icon: 'folder', menu: true }] : []),
      // canDownload false: a browser tab, which cannot retrieve papers (views/library.mjs barModel)
      ...(m.canDownload === false ? [] : [{ id: 'lib-download-selected', label: 'Download PDFs', icon: 'download', disabled: !!m.batchRunning }]),
      { id: 'lib-clear-selection', label: 'Clear selection', icon: 'close', role: 'quiet', keep: true }],
    overflow: [{ id: 'lib-select-results', label: selectAllText(m) }, { id: 'lib-remove-selected', label: 'Remove records', danger: true }] };
}

/**
 * model: { availability, inScope, shortcut, summary, hasScope } — the line is hidden, not removed, when the scope holds no record.
 * The three PDF counts are the list's filters on the PDF state of its records: pressing one narrows the list to those records (pressed, its count
 * unchanged), pressing it again clears it. They are one at a time, because a record has one PDF state: pressing another count replaces the first.
 * They combine with every other filter, and the Filters button shows pressed while one is on. A count of nothing is disabled, not hidden, so the
 * line keeps its parts; a pressed count stays pressable. Each count holds the digits of the records in scope (every count is at most that
 * total, so the slot is constant while records are not added): a count that changes moves nothing after it, and a short one leaves at most
 * a digit or two before its number, never between its label and the next part.
 */
export function statusLineSpec(m) {
  const a = m.availability || { available: 0, unresolved: 0, unchecked: 0 };
  // the count that is pressed is what narrows the list: it is the last count to leave, after the summary
  const drop = (key, d) => (m.shortcut === key ? 1 : d);
  const digits = String(Math.max(m.inScope || 0, a.available, a.unresolved, a.unchecked)).length;
  const count = (id, key, label, d) => ({ id, text: `${a[key]} ${label}`, button: true, reserve: `${'9'.repeat(digits)} ${label}`, drop: drop(key, d),
    attrs: { 'aria-pressed': String(m.shortcut === key), disabled: !a[key] && m.shortcut !== key } });
  return { id: 'lib-status', label: 'Records shown', parts: [
    count('lib-pdf-available', 'available', 'PDF available', 6),
    count('lib-pdf-unresolved', 'unresolved', 'unresolved', 7),
    count('lib-pdf-unchecked', 'unchecked', 'not checked', 8),
    { id: 'lib-filter-summary', text: m.summary || ' ', drop: 5, hidden: !m.summary },
    { id: 'lib-filters-clear', text: 'Clear filters', button: true, drop: 0, hidden: !m.summary && !m.shortcut }] };
}
export function statusLineHtml(m) {
  const html = uiStatusLine(statusLineSpec(m));
  return m.hasScope === false ? html.replace('<div class="ui-statusline"', '<div hidden class="ui-statusline"') : html;
}

// ---- rows -------------------------------------------------------------------------------------------------------------------
/**
 * What a record's PDF is and what its row More offers for it. model: { downloading(id), inDesktop, canRetrieve(p) } (all optional).
 * `menu` names the press ("Open PDF", "Find PDF"); `note` is the row's quiet word for the state ('' when there is no PDF yet, which is
 * what most rows are and what the status line counts). Where the browser cannot fetch, the press is `needsDesktop` and the row has no entry.
 */
export function pdfState(p, m = {}) {
  const busy = !!m.downloading?.(p.id);
  const preprint = String(p.pdfRetrieval?.provider || '').includes('preprint');
  const [icon, state, menu, note] = busy ? ['refresh', 'busy', 'Finding PDF', 'Finding PDF']
    : p.pdf ? ['file-pdf', 'have', 'Open PDF', p.pdfMode === 'link' ? 'PDF linked' : 'PDF']
    : pdfRank(p) === 2 ? ['download', 'can', 'Fetch PDF', `${preprint ? 'Preprint' : 'Preview'} available`]
    : p.pdfRetrieval?.status === 'unavailable' ? ['warn', 'failed', 'Find PDF again', 'No PDF found']
    : ['search', 'none', 'Find PDF', ''];
  const needsDesktop = !p.pdf && !busy && (!m.inDesktop || (m.canRetrieve ? !m.canRetrieve(p) : false));
  return { icon, menu, note, state, busy, needsDesktop, disabled: busy || needsDesktop };
}
/** model: { selectedIds: Set, selectedPaper, citation(p) -> html, hits(p) -> html }. The row ends in its More: the PDF is one of its entries. */
export function rowSpec(p, i, m = {}) {
  const name = p.label || p.title || 'record';
  return { cls: p.id === m.selectedPaper ? 'sel' : '', attrs: { 'data-row': p.id },
    check: { checked: !!m.selectedIds?.has(p.id), label: `Select ${name}`, attrs: { 'data-select-paper': p.id } },
    main: { html: (m.citation ? m.citation(p) : '') + (m.hits ? m.hits(p) : '') },
    end: uiRowEnd({ more: { label: `More for ${name}`, attrs: { 'data-more': p.id } } }) };
}
export const rowHtml = (p, i, m) => uiRow(rowSpec(p, i, m));

export const toolsHtml = m => uiBar(toolsSpec(m));
export const selectionHtml = m => uiBar(selectionSpec(m));
