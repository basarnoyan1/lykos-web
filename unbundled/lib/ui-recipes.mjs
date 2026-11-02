// Recipes: executable examples of every shape the builders produce (action-system design, section 14).
//
// An agent that needs a row of controls copies the nearest recipe, changes ids and labels, and is done: width, order,
// More, style, folding, focus and presence are not decisions left to it. ui-library.html previews every recipe at the
// four modes; ui-actions-recipes.test.mjs renders each one, derives its BarSpec and runs it through the width logic, so a
// recipe that stops conforming fails npm test; bar-models.json holds the models measured from them.
//
// bar recipes carry `spec` (what uiBar() takes) so the library page and the tests can read the declaration, not only the markup.
import { CH_STEPS, uiDocTabs, uiBar, uiGroup, uiSwap, uiRegion, uiList, uiRow, uiRowEnd, uiReview, uiReviewList, uiDecisionRow, uiBatchReview,   noticeSpec, summarySpec, reviewSummarySpec, uiStatusLine, uiStatusBar, uiSettingsRow, uiComposer, dialogFoot } from './ui-actions.mjs';

const bar = (title, spec) => ({ kind: 'bar', title, spec, html: () => uiBar(spec) });
const html = (title, make, extra = {}) => ({ kind: 'html', title, html: make, ...extra });

const STATUSES = [['open', 'Open'], ['doing', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done']];
const PRIORITIES = [['', 'Any priority'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
const DUE = [['', 'Any due date'], ['overdue', 'Overdue'], ['week', 'Due this week']];

// A review diff is built by lib/review-diff.mjs; recipes carry the finished markup so they depend on nothing else.
const diffBody = `<div class="ui-diff"><p class="ui-diff-context">The earlier paragraph gives the setting and the sampling frame.</p>`
  + `<p class="ui-diff-block">Systolic pressure <del><span class="ui-diff-cue">deleted: </span>reduced</del><ins><span class="ui-diff-cue">inserted: </span>lowered</ins> by 6 mmHg in the intervention arm.</p>`
  + `<p class="ui-diff-context">The next paragraph reports the secondary outcomes.</p><p class="ui-diff-count">+1 word, -1 word</p></div>`;

const taskRows = [
  { id: 't1', text: 'Review evidence and update protocol', status: 'open', detail: ['High priority', 'Waits for Draft search', 'Due 12 Oct'], depth: 0, done: false },
  { id: 't2', text: 'Register on PROSPERO', status: 'done', detail: ['Normal priority'], depth: 0, done: true },
  { id: 't3', text: 'Draft methods section', status: 'doing', detail: ['Normal priority', 'Due 20 Oct'], depth: 1, done: false },
];
const taskRow = t => uiRow({
  cls: `tk-row${t.done ? ' done' : ''}`, attrs: { 'data-task': t.id, 'data-depth': t.depth }, depth: t.depth,
  check: { attrs: { 'data-done': t.id }, checked: t.done, label: `Done: ${t.text}` },
  main: { html: `<button type="button" class="tk-text" data-edit="${t.id}" aria-expanded="false">${t.text}</button>`, detail: t.detail },
  cells: [{ col: 'status', kind: 'control', html: `<select class="tk-status" data-status="${t.id}" aria-label="Status of ${t.text}">${STATUSES.map(([v, l]) => `<option value="${v}"${v === t.status ? ' selected' : ''}>${l}</option>`).join('')}</select>` }],
  end: uiRowEnd({ more: { label: `More for ${t.text}`, attrs: { 'data-more': t.id } } }) });

/**
 * The find bar: the one row for finding text in a document, a note or a page, whatever it finds in. Order: the field, its count as a quiet readout
 * at the field's end ("3 of 12", "No matches": a reserved slot, so a digit moves nothing), Previous and Next as one icon group, the option
 * toggles drawn directly (pressed, icon-only, tooltip names them) and a quiet icon-only Close whose tooltip carries Esc. `options` are
 * { id, label, icon, pressed }: two or more fold into one More when the row is tight, a single one never does (a menu of one is not drawn:
 * it stays, `keep`). `grow` lets the field take the row (a full-width page, so the replace row's field below it is one width and both rows end on one edge; a 320px field would leave the controls mid-row). `steps` false leaves out Previous (a finder that only goes forward: `next` then stands alone). Nothing places a control.
 */
export function findBarSpec({ id, label = 'Find', field, placeholder = label, count, ch = 14, steps = { prev: true }, ids = {}, options = [], close = 'Close', value, cls, grow = false } = {}) {
  const opts = options.map(o => ({ role: 'quiet', iconOnly: true, ...(options.length > 1 ? { fold: 6 } : { keep: true }), ...o }));
  const prev = steps.prev !== false ? [{ id: ids.prev || `${id}-prev`, label: 'Previous match', icon: 'arrow-up', kbd: steps.prevKbd }] : [];
  const stepItems = [...prev, { id: ids.next || `${id}-next`, label: steps.nextLabel || 'Next match', icon: 'arrow-down', kbd: steps.nextKbd }];
  return { kind: 'tools', density: 'dense', stack: false, label, id: `${id}-bar`, ...(cls ? { cls } : {}), status: { id: count || `${id}-count`, text: '', ch, after: 'filters' },
    filters: [{ type: 'search', id: field || `${id}-q`, label, placeholder, ...(grow ? { width: 'flex' } : {}), ...(value != null ? { value } : {}) }],
    actions: [stepItems.length > 1 ? uiGroup({ id: `${id}-steps`, label: 'Matches', keep: true, items: stepItems }) : { ...stepItems[0], role: 'secondary', iconOnly: true, keep: true }, ...opts,
      { id: ids.close || `${id}-close`, label: close, icon: 'close', role: 'quiet', iconOnly: true, keep: true, kbd: 'Esc' }] };
}

/** The option toggles a find bar may draw, one icon each (a different icon for a different option); `findBarSpec({ options })` takes them. */
export const findOption = {
  matchCase: (id, pressed = false) => ({ id, label: 'Match case', icon: 'match-case', pressed: !!pressed }),
  wholeWord: (id, pressed = false) => ({ id, label: 'Whole word', icon: 'whole-word', pressed: !!pressed }),
};

/**
 * The replace row under a find bar (the Manuscript, the spreadsheet): the same builders, a second row. The field first, then Replace and Replace all (both
 * secondary: neither is the row's decision, and a bulk replace is not made the loudest control; each has an icon, so the labels can leave when the row is
 * tight and the row never overflows). Both keep their places; the field takes what is left. `ids` name the
 * two acts; `value` is the text it holds; `width` is 'flex' (the field takes the row: a floating panel) or the find field's own width ({ ch: 44 }, about its 320px) on a full-width page, so the two fields match. Nothing places a control.
 */
export function replaceBarSpec({ id, label = 'Replace', field, placeholder = 'Replace with', ids = {}, value, cls, width = 'flex' } = {}) {
  return { kind: 'tools', density: 'dense', stack: false, label, id: `${id}-replace-bar`, ...(cls ? { cls } : {}),
    filters: [{ type: 'field', id: field || `${id}-r`, label: placeholder, placeholder, width, attrs: { autocomplete: 'off' }, ...(value != null ? { value } : {}) }],
    actions: [{ id: ids.one || `${id}-replace`, label: 'Replace', icon: 'replace', role: 'secondary', keep: true }, { id: ids.all || `${id}-replace-all`, label: 'Replace all', icon: 'replace-all', role: 'secondary', keep: true }] };
}

/**
 * The document strip (S8): the one strip over a document, a PDF page, a Word file or a reader. Pages (previous, a page field, "of N", next) never leave; the
 * zoom group folds before them, then the Fit picker (an icon at the compact step, a menu in More when it folds), then the quiet tools. Readouts hold a
 * character slot, so a changing digit moves nothing. Icons only: previous and next are chevrons, never glyph arrows; the document's name and Close belong to
 * the page head. `tools` are { id, label, icon, pressed?, attrs? } (quiet, icon-only); `overflow` is what More holds besides what folded. `previews`
 * (true or false: its pressed state) puts the page-previews toggle before the pages: of what folds, it leaves last (after the zoom group).
 * `pageText` makes the page field text, for a file whose pages carry printed labels ("iv", "S12").
 */
export function documentStripSpec({ id = 'doc', label = 'Document', page = 1, pages = 1, zoom = '100%', fit = ['width', 'Fit width'], tools = [], overflow = [], previews = null, pageText = false } = {}) {
  const ofText = `of ${pages}`, zoomText = String(zoom);
  const ch = n => CH_STEPS.find(c => c >= n + 1) ?? CH_STEPS.at(-1);     // one character of air: a % or an "of" is wider than the ch unit
  const rail = typeof previews === 'boolean' ? [{ id: `${id}-previews`, label: 'Page previews', icon: 'page-previews', role: 'quiet', fold: 3, pressed: previews }] : [];
  return { kind: 'strip', label, id: `${id}-strip`, density: 'dense', budget: { n: 3 + rail.length + tools.length, reason: 'a document strip is its previews toggle, pages, zoom, fit and its tools' },
    actions: [...rail,
      uiGroup({ id: `${id}-pages`, label: 'Pages', fold: 0, keep: true, items: [
        { id: `${id}-prev`, label: 'Previous page', icon: 'chevron-left' },
        { field: { id: `${id}-page`, label: 'Page', ...(pageText ? { type: 'text', width: { ch: 3 }, value: String(page), attrs: { inputmode: 'text', autocomplete: 'off', spellcheck: 'false' } } : { type: 'number', width: { ch: 3 }, value: String(page), attrs: { min: 1, max: pages, inputmode: 'numeric' } }) } },
        { readout: ofText, id: `${id}-of`, label: 'Pages in the document', ch: ch(ofText.length) },
        { id: `${id}-next`, label: 'Next page', icon: 'chevron-right' }] }),
      uiGroup({ id: `${id}-zoom`, label: 'Zoom', fold: 4, items: [
        { id: `${id}-zoom-out`, label: 'Zoom out', icon: 'minus' },
        { readout: zoomText, id: `${id}-zoom-level`, label: 'Zoom level', ch: ch(zoomText.length) },
        { id: `${id}-zoom-in`, label: 'Zoom in', icon: 'plus' }] }),
      { picker: true, id: `${id}-fit`, label: 'Fit', icon: 'fit', role: 'quiet', fold: 5, value: fit[1], options: [['width', 'Fit width'], ['page', 'Fit page'], ['actual', 'Actual size']] },
      ...tools.map(t => ({ role: 'quiet', fold: 6, ...t }))],
    overflow };
}
/** The strip as markup (a view calls this; the declaration above is what the recipe page and the tests read). */
export const documentStrip = opts => uiBar(documentStripSpec(opts));

export const RECIPES = {
  // ---- the four kinds, as written in the guidelines
  head: bar('Head: title and status lead; the whole trailing cluster (secondary, primary, More) sits at the trailing edge', { kind: 'head', label: 'Included studies', lead: { title: 'Included studies' }, status: { text: '12 of 40' },
    actions: [{ id: 'dl', label: 'Download CSV', icon: 'download' }, { id: 'add', label: 'Add study', icon: 'plus', role: 'primary' }], overflow: [{ id: 'rm', label: 'Remove all', danger: true }] }),
  tools: bar('Tools: view, search, filter, primary', { kind: 'tools', label: 'Filter tasks',
    view: { id: 'mode', label: 'Show', attr: 'data-mode', kind: 'segmented', value: 'list', items: [['list', 'List'], ['board', 'Board']] },
    filters: [{ type: 'search', id: 'q', label: 'Filter tasks', placeholder: 'Filter tasks' }, { type: 'select', id: 'p', label: 'Priority', options: PRIORITIES }],
    actions: [{ id: 'add', label: 'Add task', icon: 'plus', role: 'primary' }] }),
  foot: bar('Foot: destructive start, cancel, primary', { kind: 'foot', label: 'Save changes', start: [{ id: 'del', label: 'Delete round', role: 'destructive' }],
    actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'save', label: 'Save', role: 'primary' }] }),
  documentStrip: bar('Document strip: pages, zoom, Fit picker, quiet tools, More', documentStripSpec({ id: 'doc', label: 'Document', page: 3, pages: 140, zoom: '100%', fit: ['width', 'Fit width'],
    previews: true, tools: [{ id: 'doc-find', label: 'Find in document', icon: 'search' }],
    overflow: [{ id: 'doc-download', label: 'Download' }, { id: 'doc-print', label: 'Print' }] })),
  strip: bar('Strip: pager', { kind: 'strip', label: 'Pages', status: { text: '1-25 of 140', ch: 12 },
    actions: [{ id: 'prev', label: 'Previous page', icon: 'chevron-left' }, { id: 'next', label: 'Next page', icon: 'chevron-right' }] }),

  // ---- the title bar as a page's head (lib/topbar.mjs builds it from a view's page(); TOPBAR R1-R10). The title is the page's one h1 (14/600); the count
  // is a reserved status beside it; a switch of up to five peers follows; then at most three acts, the two panel toggles (reserved icon slots) and More.
  // It never stacks: it folds (labels, the switch to its dropdown, secondaries into More), then gives up its status and lets its title ellipsise, and keeps
  // one row. A sub-page's Back is a plain chevron before the title (test/topbar.test.mjs); a primary keeps its words, so a bar with one needs the
  // desktop window's 704px, which the recipe's 272px frame does not give (the shell's title bar at 704/776/1056: test/shell-chrome.browser.test.mjs).
  pageTitleBar: bar('Page title bar: the page title, its count, one act, the view switch at the end, the panel toggles, More', { kind: 'head', label: 'Title bar', cls: 'topbar', stack: false, switchAt: 'end', moreReserve: true,
    lead: { title: 'Synthesis', level: 'h1', id: 'ptb-title' },
    status: { id: 'ptb-status', text: '42 codes', ch: 8 },
    view: { id: 'ptb-view', label: 'Synthesis stage', attr: 'data-page-view', kind: 'segmented', value: 'codes', items: [['codes', 'Codes'], ['themes', 'Themes'], ['matrix', 'Matrix']] },
    message: { id: 'ptb-message', text: '' },
    actions: [{ id: 'ptb-export', label: 'Export', icon: 'export', menu: true },
      { id: 'ptb-aid', label: 'Model actions for this page', icon: 'model-actions', role: 'quiet', plain: true, presence: 'reserve', keep: true, trail: true },
      { id: 'ptb-insp', label: 'Inspector', icon: 'inspector', role: 'quiet', plain: true, presence: 'reserve', keep: true, trail: true, pressed: false }],
    overflow: [{ id: 'ptb-codebook', label: 'Codebook' }, { id: 'ptb-check', label: 'Check readiness' }, { id: 'ptb-remove', label: 'Remove all codes', danger: true }],
    budget: { n: 4, reason: 'the title bar carries a page’s own actions and view switch beside the two panel toggles' } }),

  // A title that is a menu (a collection, a template, a section) is the bar's standard picker: a filled control with its chevron, the count outside it as
  // quiet text; the shell gives it the tooltip "Switch <titleNoun>". A plain title stays text.
  pageTitleBarPicker: bar('Page title bar with a title menu: the picker, its count, one act, the panel toggles, More', { kind: 'head', label: 'Title bar', cls: 'topbar', stack: false, moreReserve: true,
    lead: { title: 'All records', level: 'h1', id: 'ptp-title', menu: true },
    status: { id: 'ptp-status', text: '65', ch: 4 },
    message: { id: 'ptp-message', text: '' },
    actions: [{ id: 'ptp-export', label: 'Export', icon: 'export', menu: true },
      { id: 'ptp-aid', label: 'Model actions for this page', icon: 'model-actions', role: 'quiet', plain: true, presence: 'reserve', keep: true, trail: true },
      { id: 'ptp-insp', label: 'Inspector', icon: 'inspector', role: 'quiet', plain: true, presence: 'reserve', keep: true, trail: true, pressed: false }],
    overflow: [{ id: 'ptp-new', label: 'New collection' }, { id: 'ptp-rename', label: 'Rename collection' }],
    budget: { n: 3, reason: 'the title bar carries a page’s own actions beside the two panel toggles' } }),

  // ---- the strip of open documents
  docTabs: html('Document tabs: a strip, not a bar. Full at its natural width, compact in n + 1 equal columns, then one dropdown with n of N; the close slot is always there, an edited tab shows a dot in it, a preview tab is quiet', () => uiDocTabs({ id: 'doc-tabs', label: 'Open documents', active: 'table.xlsx', tabs: [
    { id: 'Manuscript_v16.docx', label: 'Manuscript_v16.docx', icon: 'manuscript', path: 'Manuscript/Manuscript_v16.docx' }, { id: 'Response.docx', label: 'Response_to_reviewers.docx', icon: 'manuscript', dirty: true },
    { id: '07 - Okafor 2019.pdf', label: '07 - Okafor 2019.pdf', icon: 'file-pdf', preview: true }, { id: 'table.xlsx', label: 'Evidence_table_v13.xlsx', icon: 'table' }] })),

  // ---- CASE 2: notes
  // The Notes page is the shell's collection-and-detail page: the title bar holds the section pick and the New note menu, the list pane holds the search,
  // and the document has no head. Its commands are one dense strip under the text; the find bar replaces the strip in its place (uiRegion).
  notesPageHead: bar('Notes title bar: section pick, New note menu, More', { kind: 'head', label: 'Notes', id: 'nt-title-bar', lead: { title: 'Notes', level: 'p', id: 'nt-title', menu: true },
    actions: [{ id: 'nt-new', label: 'New note', icon: 'plus', menu: true }],
    overflow: [{ id: 'nt-sort-updated', label: 'Recently edited', kind: 'toggle', checked: true }, { id: 'nt-sort-title', label: 'Title A–Z', kind: 'toggle', checked: false }, '-',
      { id: 'nt-show-active', label: 'All notes', kind: 'toggle', checked: true }, { id: 'nt-show-pinned', label: 'Pinned', kind: 'toggle', checked: false },] }),
  notesSidebar: bar('Notes list search: one search field in the list pane', { kind: 'tools', label: 'Find', id: 'nt-find-notes',
    filters: [{ type: 'search', id: 'nt-q', label: 'Search', placeholder: 'Search notes and tags' }] }),
  notesFoot: bar('Notes strip over the text: word count, three formatting groups, Preview, More', { kind: 'strip', label: 'Note', id: 'nt-foot', density: 'dense', status: { id: 'nt-save-status', text: '100 words', ch: 20 },
    budget: { n: 5, reason: 'three formatting groups, the preview toggle and the reserved Retry save' }, actions: [
    { id: 'nt-save-retry', label: 'Retry save', icon: 'refresh', role: 'quiet', presence: 'reserve', fold: 9, hidden: true },
    uiGroup({ id: 'nt-history', label: 'History', fold: 3, items: [{ id: 'nt-undo', label: 'Undo', icon: 'undo', kbd: '⌘Z', attrs: { 'data-note-format': 'undo' } }, { id: 'nt-redo', label: 'Redo', icon: 'redo', kbd: '⇧⌘Z', attrs: { 'data-note-format': 'redo' } }] }),
    uiGroup({ id: 'nt-text-group', label: 'Text', fold: 5, items: [{ id: 'nt-heading', label: 'Heading', icon: 'heading', attrs: { 'data-note-format': 'heading' } }, { id: 'nt-bold', label: 'Bold', icon: 'bold', kbd: '⌘B', attrs: { 'data-note-format': 'bold' } },
      { id: 'nt-italic', label: 'Italic', icon: 'italic', kbd: '⌘I', attrs: { 'data-note-format': 'italic' } }, { id: 'nt-link', label: 'Link', icon: 'link', kbd: '⌘K', attrs: { 'data-note-format': 'link' } }] }),
    uiGroup({ id: 'nt-blocks', label: 'Blocks', fold: 7, items: [{ id: 'nt-bullet', label: 'Bulleted list', icon: 'list-bullet', attrs: { 'data-note-format': 'bullet' } }, { id: 'nt-task', label: 'Checklist', icon: 'checklist', attrs: { 'data-note-format': 'task' } },
      { id: 'nt-quote', label: 'Quote', icon: 'quote', attrs: { 'data-note-format': 'quote' } }, { id: 'nt-table', label: 'Table', icon: 'table', attrs: { 'data-note-format': 'table' } }] }),
    { id: 'nt-preview', label: 'Preview', icon: 'preview', role: 'quiet', keep: true, kbd: '⇧⌘P', pressed: false }],
    overflow: [{ id: 'nt-split', label: 'Split view', kind: 'toggle', checked: false }, { id: 'nt-focus', label: 'Focus', kind: 'toggle', checked: false }, { id: 'nt-find-open', label: 'Find in note' }, '-',
      { id: 'nt-pin', label: 'Pin', kind: 'toggle', checked: false }, { id: 'nt-details', label: 'Details' }, { id: 'nt-rename', label: 'Rename' }, { id: 'nt-duplicate', label: 'Duplicate' }, { id: 'nt-export', label: 'Export note' },
      { id: 'nt-save-template', label: 'Save as template' }, { id: 'nt-versions', label: 'Version history' }, { id: 'nt-archive', label: 'Archive note' }, { id: 'nt-delete', label: 'Move to trash', danger: true }] }),
  notesStrip: bar('Notes formatting strip: three groups', { kind: 'strip', label: 'Formatting', actions: [
    uiGroup({ id: 'nt-history', label: 'History', fold: 3, items: [{ id: 'nt-undo', label: 'Undo', icon: 'undo', attrs: { 'data-note-format': 'undo' } }, { id: 'nt-redo', label: 'Redo', icon: 'redo', attrs: { 'data-note-format': 'redo' } }] }),
    uiGroup({ id: 'nt-text', label: 'Text', fold: 5, items: [{ id: 'nt-heading', label: 'Heading', icon: 'heading', attrs: { 'data-note-format': 'heading' } }, { id: 'nt-bold', label: 'Bold', icon: 'bold', attrs: { 'data-note-format': 'bold' } },
      { id: 'nt-italic', label: 'Italic', icon: 'italic', attrs: { 'data-note-format': 'italic' } }, { id: 'nt-link', label: 'Link', icon: 'link', attrs: { 'data-note-format': 'link' } }] }),
    uiGroup({ id: 'nt-blocks', label: 'Blocks', fold: 7, items: [{ id: 'nt-bullets', label: 'Bulleted list', icon: 'list-bullet', attrs: { 'data-note-format': 'bullets' } }, { id: 'nt-checklist', label: 'Checklist', icon: 'checklist', attrs: { 'data-note-format': 'checklist' } },
      { id: 'nt-quote', label: 'Quote', icon: 'quote', attrs: { 'data-note-format': 'quote' } }, { id: 'nt-table', label: 'Table', icon: 'table', attrs: { 'data-note-format': 'table' } }] })] }),
  notesFind: bar('Find in note: the shared find bar (field, count, previous and next, close)', findBarSpec({ id: 'nt-find', label: 'Find in note', field: 'nt-find-q', count: 'nt-find-count', ch: 12 })),
  manuscriptFind: bar('Find and replace (Manuscript): the shared find bar with Match case and Whole word as pressed toggles', findBarSpec({ id: 'ms-find', label: 'Find', field: 'f-q', count: 'f-count', ids: { prev: 'f-prev', next: 'f-next', close: 'f-close' },
    options: [findOption.matchCase('f-case'), findOption.wholeWord('f-word')], steps: { prevKbd: '⇧↵', nextKbd: '↵' } })),
  manuscriptReplace: bar('Replace row under a find bar: the field, Replace, Replace all (labels leave before the field shrinks)', replaceBarSpec({ id: 'ms', field: 'f-r', ids: { one: 'f-one', all: 'f-all' } })),
  journal: bar('Journal dateline: the day, Today, More', { kind: 'head', label: 'Entry', id: 'jr-head', density: 'dense', lead: { title: 'Wednesday 7 October', level: 'h2' }, message: { text: 'Today' },
    overflow: [{ id: 'jr-del', label: 'Delete entry', danger: true }] }),

  // ---- CASE 1 companions: tasks
  tasksTools: bar('Tasks tools: view, search, three selects', { kind: 'tools', label: 'Filter tasks',
    view: { id: 'tk-view', label: 'Show', attr: 'data-mode', kind: 'segmented', value: 'list', items: [['list', 'List'], ['board', 'Board'], ['timeline', 'Timeline']], itemAttrs: k => ({ 'data-form-key': `tasks:mode:${k}` }) },
    filters: [{ type: 'search', id: 'tk-q', label: 'Filter tasks', placeholder: 'Filter tasks' }, { type: 'select', id: 'tk-f-status', label: 'Status', options: [['', 'Any status'], ...STATUSES] },
      { type: 'select', id: 'tk-f-priority', label: 'Priority', options: PRIORITIES }, { type: 'select', id: 'tk-f-due', label: 'Due date', options: DUE }] }),
  tasksAdd: bar('Tasks add form: field, select, date, primary', { kind: 'tools', label: 'Add task', id: 'tk-add', form: true,
    filters: [{ type: 'field', id: 'tk-new', label: 'New task', placeholder: 'New task', width: 'flex' },
      { type: 'select', id: 'tk-new-priority', label: 'Priority', options: PRIORITIES.slice(1), value: 'normal' }, { type: 'date', id: 'tk-new-due', label: 'Due date' }],
    actions: [{ id: 'tk-add-submit', label: 'Add task', icon: 'plus', role: 'primary', type: 'submit' }] }),

  // ---- CASE 4: workflow editor
  flowHeader: bar('Workflow header: back, name, Save, Run | Stop', { kind: 'head', label: 'Workflow', id: 'flow-head', cls: 'flow-heading-row',
    lead: { back: { id: 'flow-back', label: 'Back' }, input: { id: 'flow-name', label: 'Workflow name', value: 'Sweep workflow', placeholder: 'Untitled workflow' } },
    actions: [{ id: 'flow-save', label: 'Save', icon: 'save' },
      uiSwap({ id: 'flow-run-slot', members: [{ id: 'flow-run', label: 'Run', icon: 'run', role: 'primary', attrs: { 'aria-label': 'Save and run' } }, { id: 'flow-stop', label: 'Stop', icon: 'stop', role: 'primary', hidden: true }] })] }),
  flowTools: bar('Workflow tools: add, ask, reserved review, history, overflow', { kind: 'tools', label: 'Workflow tools', id: 'flow-tools',
    actions: [{ id: 'flow-gallery', label: 'Add block', icon: 'plus', pressed: false }, { id: 'flow-help', label: 'Ask AI', icon: 'assistant' },
      uiGroup({ id: 'flow-history', label: 'History', items: [{ id: 'flow-undo', label: 'Undo workflow edit', icon: 'undo' }, { id: 'flow-redo', label: 'Redo workflow edit', icon: 'redo' }] }),
      { id: 'flow-pending', label: 'Review', icon: 'check', presence: 'reserve', hidden: true }],
    overflow: [{ id: 'flow-templates', label: 'Templates' }, { id: 'flow-runs', label: 'Runs' }, { id: 'flow-check', label: 'Check' }, { id: 'flow-options', label: 'Options' }] }),

  // ---- libraries, dialogs, decisions
  libraryHead: bar('Library list head: collection picker title, count, the pane\'s one More with its list commands', { kind: 'head', label: 'Records', id: 'lib-head', cls: 'lib-head',
    lead: { title: 'All records', id: 'lib-collection', menu: true }, status: { id: 'lib-count', text: '132 of 460', ch: 14 },
    overflow: [{ id: 'lib-coll-new', label: 'New collection' }, { id: 'rename-coll', label: 'Rename collection' }, { id: 'del-coll', label: 'Delete collection', danger: true }, '-',
      { id: 'lib-select-page', label: 'Select this page' },
      { id: 'lib-density', label: 'Detailed rows', kind: 'toggle', checked: false }] }),
  libraryTools: bar('Library list tools: search, filters, sort picker (no More of its own; the head holds the list commands)', { kind: 'tools', label: 'Find records', id: 'lib-tools',
    filters: [{ type: 'search', id: 'lib-filter', label: 'Filter records', placeholder: 'Filter', value: '' }],
    actions: [{ picker: true, id: 'lib-sort', label: 'Sort', role: 'quiet', value: 'Order added', options: [['', 'Order added'], ['year-desc', 'Newest first'], ['year-asc', 'Oldest first'], ['title', 'Title A\u2013Z'], ['authors', 'Authors A\u2013Z'], ['source', 'Source A\u2013Z'], ['pdf', 'PDF first']] },
      { id: 'lib-filters', label: 'Filters', icon: 'filter', pressed: false, attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } }] }),
  librarySelection: bar('Library selection: count, collection, export, download, clear, More', { kind: 'tools', label: 'Selection', id: 'lib-selection', status: { id: 'lib-selected-count', text: '3 selected', ch: 14 },
    actions: [{ id: 'lib-coll-selected', label: 'Collection', icon: 'folder', menu: true }, { id: 'lib-export-selected', label: 'Export', icon: 'export', menu: true },
      { id: 'lib-download-selected', label: 'Download PDFs', icon: 'download' }, { id: 'lib-clear-selection', label: 'Clear selection', icon: 'close', role: 'quiet', keep: true }],
    overflow: [{ id: 'lib-select-results', label: 'Select all 460 results' }, { id: 'lib-remove-selected', label: 'Remove records', danger: true }] }),
  dialogFoot: bar('Dialog foot: cancel and a destructive confirm', { kind: 'foot', label: 'Confirm', cls: 'ui-dialog-foot',
    actions: [{ id: 'dlg-cancel', label: 'Cancel' }, { id: 'dlg-ok', label: 'Remove records', role: 'primary', danger: true }] }),
  screeningFoot: bar('Screening decisions: equal columns, never fold', { kind: 'foot', label: 'Decision', equal: true,
    actions: [{ id: 'sc-include', label: 'Include', pressed: false }, { id: 'sc-exclude', label: 'Exclude', pressed: false }, { id: 'sc-uncertain', label: 'Uncertain', pressed: false }, { id: 'sc-skip', label: 'Skip' }] }),
  screeningFootWide: bar('Decision with one long label: every action as wide as the widest', { kind: 'foot', label: 'Full text decision', equal: true,
    actions: [{ id: 'sw-include', label: 'Include' }, { id: 'sw-exclude', label: 'Exclude after full text review' }, { id: 'sw-maybe', label: 'Maybe' }, { id: 'sw-skip', label: 'Skip' }] }),
  libraryFoot: bar('Foot with a start message', { kind: 'foot', label: 'Import', start: [{ message: 'Reads 2 files, nothing is changed until you confirm' }],
    actions: [{ id: 'imp-cancel', label: 'Cancel' }, { id: 'imp-go', label: 'Import', role: 'primary' }] }),

  // ---- CASE 3: review items
  reviewItems: html('Review items: open, expanded, accepted, pending, failed', () => uiReviewList({ label: 'Suggested edits', items: [
    uiReview({ id: 'r1', kind: 'Edit paragraph', where: 'Results > paragraph 2', summary: '"reduced" to "lowered"' }),
    uiReview({ id: 'r2', kind: 'Edit heading', where: 'Methods > heading', summary: '"Study selection" to "Selection of studies"', open: true, body: diffBody }),
    uiReview({ id: 'r3', kind: 'Insert table', where: 'Results > after paragraph 3', summary: 'Table, 4 x 3', acceptLabel: 'Add to notes', pending: true }),
    uiReview({ id: 'r4', kind: 'Edit paragraph', where: 'Discussion > paragraph 1', summary: 'Adds 52 words', state: 'accepted', done: 'Added to manuscript' }),
    uiReview({ id: 'r5', kind: 'Edit paragraph', where: 'Abstract > paragraph 1', summary: 'Could not apply: earlier changes are retained', state: 'failed', acceptLabel: '' })] })),
  decision: html('Decision row: three-way choice', () => uiDecisionRow({ id: 'dupe-1', kind: 'Possible duplicate', where: 'Smith 2019 and Smith 2019b', summary: 'Same DOI prefix, 91% title match',
    choices: [{ id: 'dupe-1-first', label: 'Keep first' }, { id: 'dupe-1-second', label: 'Keep second' }, { id: 'dupe-1-distinct', label: 'Distinct' }], state: 'dupe-1-distinct' })),
  batch: html('Batch review: checkbox list, one Apply', () => uiBatchReview({ label: 'Screening proposals', items: [
    { id: 'b1', check: true, kind: 'Include', where: 'Lee 2020', summary: 'Meets all criteria' }, { id: 'b2', check: true, kind: 'Exclude', where: 'Park 2018', summary: 'Wrong population' },
    { id: 'b3', check: false, kind: 'Uncertain', where: 'Chen 2021', summary: 'Abstract only' }], apply: { id: 'b-apply', label: 'Apply 2' }, dismiss: { id: 'b-dismiss', label: 'Dismiss' } })),

  // ---- CASE 5: one call to action
  summary: bar('Summary: the count and one action', summarySpec(reviewSummarySpec({ count: 8 }))),
  notice: bar('Notice: text and two actions', noticeSpec({ id: 'lib-offers', label: 'Import offer', text: '3 files can be added to this review', actions: [{ id: 'offer-import', label: 'Import', icon: 'import' }, { id: 'offer-ignore', label: 'Ignore' }] })),
  undoToast: bar('Toast: floats in the corner and pushes nothing', noticeSpec({ id: 'undo-note', label: 'Removed', text: 'Removed 2 records', float: true, dismissible: true, actions: [{ id: 'undo-removal', label: 'Undo removal', icon: 'undo' }] })),

  // ---- lines, footers, settings, composer
  statusLine: html('Status line: parts drop by measurement, the pipeline is pinned', () => uiStatusLine({ id: 'flow-meta', label: 'Workflow status', parts: [
    { id: 'flow-block-count', text: '9 blocks', drop: 6 }, { id: 'flow-schedule-state', text: 'Manual', drop: 1 },
    { id: 'flow-last-run', button: true, text: 'Last run 2 h ago', drop: 4, ch: 18 }, { id: 'flow-live-summary', text: '', drop: 8, ch: 24 }],
    trail: '<span class="meta">5 of 5 blocks</span>' })),
  statusLineCounts: html('Status line of counts: each part reserves the widest text it will hold, so a count that changes moves nothing and leaves no hole', () => uiStatusLine({ id: 'lib-counts', label: 'Records shown', parts: [
    { id: 'cn-available', text: '0 PDF available', button: true, reserve: '999 PDF available', drop: 6 }, { id: 'cn-unresolved', text: '0 unresolved', button: true, reserve: '999 unresolved', drop: 7 },
    { id: 'cn-unchecked', text: '65 not checked', button: true, reserve: '999 not checked', drop: 8 }] })),
  statusLineTrail: html('Status line with real buttons at its end: the parts drop whole, the buttons never do (the shell\u2019s status bar)', () => uiStatusLine({ id: 'shell-status-line', label: 'Project status', parts: [
    { id: 'sl-save', text: 'Saved', drop: 0 }, { id: 'sl-where', text: 'App storage', drop: 7 }, { id: 'sl-stage', text: 'Extracted 65 of 65', drop: 6 }, { id: 'sl-job', text: 'PubMed search 12 of 65', drop: 2 }],
    actions: [{ id: 'sl-props', label: '3 proposals', icon: 'proposals' }, { id: 'sl-model', label: 'No model', icon: 'models', menu: true }, { id: 'sl-palette', label: 'Commands', icon: 'search', kbd: '\u2318K', iconOnly: true }] })),
  statusBar: html('Status bar: fixed slots, items fold by priority', () => uiStatusBar({ id: 'shell-status', label: 'Project status',
    leading: [{ id: 'st-save', text: 'Saved', ch: 8, label: 'Save state' }, { id: 'st-backup', text: 'Backup 2 min ago', ch: 20, label: 'Backup state' }],
    items: [{ id: 'st-props', label: 'Project properties', text: '1,204 records', priority: 6 }, { id: 'st-model', label: 'Model', text: 'Model: GPT', priority: 8 }] })),
  settingsRow: html('Settings row: label left, foot bar right', () => uiSettingsRow({ id: 'set-theme', label: 'Theme', description: 'Colour scheme of the interface',
    controls: { label: 'Theme', actions: [{ id: 'set-light', label: 'Light', pressed: true }, { id: 'set-dark', label: 'Dark', pressed: false }] } })),
  composer: html('Composer: textarea with a Send | Stop slot', () => uiComposer({ id: 'composer', input: { id: 'composer-input', label: 'Message', placeholder: 'Ask about this project' },
    send: { id: 'composer-send', label: 'Send' }, stop: { id: 'composer-stop', label: 'Stop' } })),
  list: html('List: rows with a status control and a trailing More', () => uiList({ label: 'Task list', cols: ['status'], id: 'tk-rows', rows: taskRows.map(taskRow) })),
  taskRowsWhen: html('List: task rows with a round check, one line of title, and two text columns (project, due date)', () => uiList({ label: 'Tasks by when', cols: ['project', 'due'], id: 'hub-g-today', rows: [
    { id: 'w1', text: 'Confirm with Reviewer B: The four-table split', project: 'Review A', due: 'Today' }, { id: 'w2', text: 'Check PRISMA flow counts against the screening log', project: 'Review B', due: 'Mon 5 Oct' },
    { id: 'w3', text: 'Tag figures with their source table', project: 'Reporting audit', due: '' }].map(t => uiRow({ attrs: { 'data-hub-row': t.id }, check: { attrs: { 'data-done': t.id }, checked: false, label: `Done: ${t.text}` },
    main: { html: `<button type="button" class="tk-text" title="${t.text}">${t.text}</button>` },
    cells: [{ col: 'project', kind: 'text', ch: 14, html: t.project }, { col: 'due', kind: 'text', ch: 14, html: t.due }],
    end: uiRowEnd({ more: { label: `More for ${t.text}`, attrs: { 'data-more': t.id } } }) })) })),
  portfolioRows: html('List: project rows of All projects: name and one detail line, two text columns (current stage, next date), Open and More', () => uiList({ label: 'Active projects', cols: ['stage', 'next'], id: 'hub-projects-active', attrs: { 'data-hub-projects': true }, rows: [
    { id: 'pa', name: 'Review A: a long project name that runs past its column and is cut short', detail: ['Systematic review', '12 open', 'Submitted to Journal B, 42 d', 'Open now'], stage: 'Screening 41 of 120', next: 'Tue 14 Oct' },
    { id: 'pb', name: 'Case report C', detail: ['Case report', 'No tasks', 'Opened 2 d ago'], stage: 'Manuscript 1,840 words', next: '' }].map(p => uiRow({ attrs: { 'data-hub-project-row': p.id },
    main: { html: `<button type="button" class="tk-text" title="${p.name}"><span class="hub-name">${p.name}</span></button>`, detail: p.detail },
    cells: [{ col: 'stage', kind: 'text', ch: 20, html: p.stage }, { col: 'next', kind: 'text', ch: 12, html: p.next }],
    end: uiRowEnd({ primary: { id: `hub-open-${p.id}`, label: 'Open', icon: 'open' }, more: { label: `More for ${p.name}`, attrs: { 'data-proj-more': p.id } } }) })) })),
  region: html('Region: a selection bar replaces the list controls without pushing', () => uiRegion({ id: 'sel-region', label: 'List controls', active: 0, bars: [
    uiBar({ kind: 'tools', label: 'List controls', id: 'sel-list', filters: [{ type: 'search', id: 'sel-q', label: 'Search', placeholder: 'Search' }], actions: [{ id: 'sel-add', label: 'Add', icon: 'plus', role: 'primary' }] }),
    uiBar({ kind: 'tools', label: 'Selection', id: 'sel-batch', status: { id: 'sel-count', text: '3 selected', ch: 12 }, actions: [{ id: 'sel-assign', label: 'Assign', icon: 'user' }, { id: 'sel-clear', label: 'Clear', icon: 'close', role: 'quiet' }] })] })),
  cellField: html('Cell field: an input or select in a table cell fills the cell; the table sets --cell-min, --cell-max or --cell-w, never a width on the control', () => `<table><thead><tr><th scope="col">Item</th><th scope="col">State</th><th scope="col">Where reported</th></tr></thead><tbody>${[['1', 'Title', 'Methods, page 3'], ['2', 'Abstract', '']].map(([n, name, where]) => `<tr><th scope="row">${name}</th><td><select class="ui-cell-field" aria-label="State of ${name}"><option>Reported</option><option>Not reported</option></select></td><td><input class="ui-cell-field" value="${where}" placeholder="Section, page" aria-label="Where ${name} is reported"></td></tr>`).join('')}</tbody></table>`),
  dialogFootHelper: html('dialogFoot() wrapper', () => dialogFoot({ label: 'Rename', actions: [{ id: 'rn-cancel', label: 'Cancel' }, { id: 'rn-ok', label: 'Rename', role: 'primary' }] })),
};

/** Recipes that are declarations of one bar: the library and the tests derive measurements and models from these. */
export const BAR_RECIPES = Object.fromEntries(Object.entries(RECIPES).filter(([, r]) => r.kind === 'bar'));
