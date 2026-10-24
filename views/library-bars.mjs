// The Library list pane as declarations: what each bar, the status line and a row IS, with no DOM and no store (library plan, section 5 step 1).
// library.mjs builds the model from its state and renders these with the shared builders (lib/ui-actions.mjs); the tests render them under Node,
// where a bad spec throws. Nothing here places a control: placement is the builders' and ui-actions.css's.
import { uiBar, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
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
  return parts.join('; ');
}

// ---- counts -------------------------------------------------------------------------------------------------------------
/** "460", or "132 of 460" while a filter or the search narrows the scope. Plain digits: the head slot holds a fixed width. */
export const countText = ({ matched, inScope, narrowed }) => `${matched}${narrowed ? ` of ${inScope}` : ''}`;
export const selectAllText = ({ matched }) => `Select all ${matched} results`;

// ---- the page: its head is the shell's title bar (lib/topbar.mjs) ---------------------------------------------------------------
/**
 * The Library's title bar, declared (views/library.mjs page()): the collection as a picker title (its count only while narrowed), Add as the
 * one primary, and one More with Check and Export, the collection's commands and the list's (TOPBAR R10: one More per surface). Each act and entry keeps its id and
 * takes its handler from `run` by id; `run.pick(anchor)` opens the collection picker.
 * model: { collectionName, isUserCollection, matched, inScope, narrowed, compact }
 */
export function pageSpec(m, run = {}) {
  const on = id => run[id] || (() => {});
  const act = (id, label, icon) => ({ id, label, icon, menu: true, run: on(id) });
  const entry = (id, label, more = {}) => ({ id, label, ...more, run: on(id) });
  return { title: m.collectionName, ...(run.pick ? { titleMenu: run.pick } : {}),
    // the count only while a filter or the search narrows the list ("132 of 460"): the title alone otherwise (Component review 2026-10-21, item 1)
    status: { text: m.narrowed ? countText(m) : '', ch: 14, reserve: true },   // a reserved slot, empty until narrowed: the count appears in place
    // one primary and one More (Component review 2026-10-21, item 12): Add is the page's act; Check and Export open their menus from More
    actions: [{ ...act('lib-menu-add', 'Add', 'plus'), role: 'primary' }],
    overflow: [
      entry('lib-menu-check', 'Check records…', { attrs: { 'aria-haspopup': 'menu' } }),
      entry('lib-menu-export', 'Export…', { attrs: { 'aria-haspopup': 'menu' } }),
      '-',
      entry('lib-coll-new', 'New collection'),
      ...(m.isUserCollection ? [entry('rename-coll', 'Rename collection'), entry('del-coll', 'Delete collection', { danger: true })] : []),
      '-',
      entry('lib-select-page', 'Select this page'),
      // the list's saved views (lib/saved-views.mjs): a menu where More was, the view shown checked (the search row has no room at a narrow pane)
      entry('lib-views', 'Views…'),
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
 * model: { availability, inScope, shortcut, summary, hasScope } — the row is hidden, not removed, when the scope holds no record.
 * Which records the list shows by their PDF (2026-10-21, after the quick-filter tabs over Xero's and Remote's lists on Mobbin): one segmented
 * switch, All and the three PDF states, each with its count in a fixed slot, then Clear filters. A record has one PDF state, so the states are
 * one at a time; pressing the pressed one again, or All, clears it. They combine with every other filter (the Filters button shows pressed while
 * one is on). A state with no record is disabled, not hidden, so the switch keeps its parts; a pressed state stays pressable. Clear filters is
 * always there and disabled while nothing narrows the list (the Filters popover names what narrows it).
 */
export function statusLineSpec(m) {
  const a = m.availability || { available: 0, unresolved: 0, unchecked: 0 };
  const items = [['all', 'All', m.inScope || 0], ['available', 'PDF available', a.available], ['unresolved', 'Unresolved', a.unresolved], ['unchecked', 'Not checked', a.unchecked]];
  const narrowed = !!(m.summary || m.shortcut);
  return { kind: 'tools', id: 'lib-status', label: 'Records shown',
    view: { id: 'lib-pdf', label: 'PDF', attr: 'data-lib-pdf', value: m.shortcut || 'all', items,
      itemAttrs: k => ({ disabled: k !== 'all' && !a[k] && m.shortcut !== k }) },
    actions: [{ id: 'lib-filters-clear', label: 'Clear filters', role: 'quiet', disabled: !narrowed },
      // the page's search lives in its filter row, not in the title bar (Component review 2026-10-21, item 2): pressed while the search row is open
      { id: 'lib-find', label: 'Find', icon: 'search', role: 'quiet', iconOnly: true, kbd: '⌘F', pressed: !!m.finding }] };
}
export function statusLineHtml(m) {
  const html = uiBar(statusLineSpec(m));
  return m.hasScope === false ? html.replace('<div class="ui-bar"', '<div hidden class="ui-bar"') : html;
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
