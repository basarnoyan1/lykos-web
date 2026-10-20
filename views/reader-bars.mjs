// The reader as declarations: what each bar over a document IS, with no DOM and no store (as views/screening-bars.mjs does for Screening).
// reader.mjs builds the model from its state and renders these with the shared builders (lib/ui-actions.mjs, lib/ui-recipes.mjs); the tests
// render them under Node, where a bad spec throws. Nothing here places a control.
//
// The pane is: head (docked pane only: the document's name and Close), the document strip, the page, one permanent foot. The foot is one
// region (uiRegion) holding five bars that replace each other in one cell, so the page never moves when the state changes:
//   idle      a message slot (what the last action reported); empty most of the time
//   assign    text is selected: the field it fills, Accept, and the marks that can be made of it
//   annotate  a mark is open: its comment, Save, Close, and Delete at the start
//   region    a box is drawn on the page: read its table, digitise its curve, clip it
//   offer     the file carries annotations of its own: import them or not
import { documentStripSpec, findBarSpec } from '../lib/ui-recipes.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiRegion, uiSwap } from '../lib/ui-actions.mjs';

// ---- what both PDF viewers share (this reader and the Files tab's plain viewer, views/pdf-file-bars.mjs): the find bar that replaces the strip in
// one region, the rail's head, and what a selection and an open mark offer. `p` is the id prefix: 'rd' here, the tab's own in a Files tab.
export const LOOKUP_LABEL = 'Look up reference';
/** Ask about this: attaches the selected words to the assistant (app.mjs hears `data-ask-about`, lib/chat-attach-ui.mjs). */
const ASK_ABOUT = 'Ask about this', ASK_PDF = { 'data-ask-about': 'pdf-selection' };
/** The strip's Find tool: pressed while the find bar shows. */
export const findTool = p => ({ id: `${p}-find`, label: 'Find in document', icon: 'search', pressed: false, kbd: '⌘F' });
/** The find bar of both viewers: the shared findBarSpec (lib/ui-recipes.mjs), ids `${p}-find-*`. Match case is a pressed toggle of the row, never a menu of one;
 *  the narrow row keeps the field's room (the count is a fixed slot at its end, the toggle and Close keep their places). */
export function findSpec({ p = 'rd', matchCase = false } = {}) {
  return findBarSpec({ id: `${p}-find`, label: 'Find in document', field: `${p}-find-q`, count: `${p}-find-count`, ids: { prev: `${p}-find-prev`, next: `${p}-find-next`, close: `${p}-find-close` },
    steps: { prevKbd: '⇧⌘G', nextKbd: '⌘G' }, options: [{ id: `${p}-find-all`, label: 'All matches', icon: 'list', disabled: true, keep: true, fold: undefined }, { id: `${p}-find-case`, label: 'Match case', icon: 'match-case', pressed: !!matchCase, keep: true, fold: undefined }], grow: true });   // both stay in the row: a menu of two icons would hide what the bar is for   // the field takes the row: no gap between it and its steps
}
/** The strip and the find bar in one cell (the Notes precedent): opening find replaces the strip, nothing below moves. */
export const topHtml = (p, strip, o = {}) => uiRegion({ id: `${p}-top`, label: 'Document controls', active: 0, bars: [uiBar(strip), uiBar(findSpec({ p, ...o }))] });
/** The rail's head: Pages | Contents, the sidebar's two-view switch. */
export const railHeadSpec = ({ p = 'rd', view = 'pages' } = {}) => ({ kind: 'tools', density: 'dense', label: 'Page rail', id: `${p}-rail-head`,
  view: { id: `${p}-rail-view`, label: 'Show', attr: 'data-rail', kind: 'segmented', value: view, items: [['pages', 'Pages'], ['contents', 'Contents']] } });
/** The rail's markup: the head, the page previews (a list of options, as the Files grid's tiles, each a placeholder until it comes near) and the contents (drawn when first asked for). */
export const railHtml = ({ p = 'rd', pages = 1, view = 'pages', labels = null } = {}) => `<div class="fv-pdf-rail" id="${p}-rail" hidden><div class="fv-pdf-rail-top">${uiBar(railHeadSpec({ p, view }))}</div>`
  + `<div class="fv-pdf-previews" role="listbox" aria-label="Page previews"${view === 'pages' ? '' : ' hidden'}>${Array.from({ length: pages }, (_, i) => `<div class="fv-pdf-thumb" role="option" aria-selected="false" tabindex="${i ? -1 : 0}" data-thumb="${i + 1}" aria-label="Page ${i + 1}"><span class="fv-pdf-thumb-image"></span><span class="fv-pdf-thumb-n">${esc(String(labels?.[i] ?? '').trim() || i + 1)}</span></div>`).join('')}</div>`
  + `<div class="fv-pdf-contents" role="region" aria-label="Contents"${view === 'contents' ? '' : ' hidden'}></div></div>`;
/**
 * Selected text in a viewer with no extraction fields (a Files tab): the quote, Highlight and Note, Cancel, and Copy quote as the primary; Underline
 * and Find this text are More's. The reader's assign bar offers the same Copy quote in its More, so one selection reads alike in both. `lookup`
 * adds Look up reference to More, for a viewer that shows its result (views/reference-lookup.mjs).
 */
export function selectSpec({ p = 'rd', lookup = false } = {}) {
  return { kind: 'foot', label: 'Selection', id: `${p}-foot-select`, density: 'dense', message: { id: `${p}-sel`, text: '' },
    actions: [{ id: `${p}-hl`, label: 'Highlight', icon: 'highlight' }, { id: `${p}-note`, label: 'Note', icon: 'note' },
      { id: `${p}-cancel`, label: 'Cancel', icon: 'close', iconOnly: true, role: 'quiet', fold: 6, kbd: 'Esc' }, { id: `${p}-copy-quote`, label: 'Copy quote', icon: 'copy', role: 'primary', kbd: '⇧⌘C' }],
    overflow: [{ id: `${p}-ul`, label: 'Underline' }, ...(lookup ? [{ id: `${p}-lookup`, label: LOOKUP_LABEL }] : []), { id: `${p}-ask`, label: ASK_ABOUT, attrs: ASK_PDF }, { id: `${p}-find-sel`, label: 'Find this text' }] };
}
/** An open mark: what it is and where, its comment, Save and Close; Delete is the start's act, visible and neutral. */
export const annotateSpec = ({ p = 'rd' } = {}) => ({ kind: 'foot', label: 'Annotation', id: `${p}-foot-annotate`, density: 'dense',
  start: [{ id: `${p}-ann-del`, label: 'Delete', icon: 'trash', role: 'destructive' }],
  message: { id: `${p}-ann-info`, text: '' },
  filters: [{ type: 'field', id: `${p}-comment`, label: 'Comment', placeholder: 'Comment', width: 'flex', maxlength: 2000 }],
  actions: [{ id: `${p}-ann-save`, label: 'Save', role: 'primary' }, { id: `${p}-ann-close`, label: 'Close' }] });

/** The kinds of note: a quotation, a paraphrase and the reader's interpretation are different claims and stay labelled as such (plan D6). */
export const NOTE_KINDS = Object.freeze([['quote', 'Quotation'], ['paraphrase', 'Paraphrase'], ['comment', 'Interpretation']]);
export const noteKindLabel = k => NOTE_KINDS.find(x => x[0] === k)?.[1] ?? k;

/** The foot's states, in the order of the region's panes. */
export const FOOT_STATES = Object.freeze(['idle', 'assign', 'annotate', 'region', 'offer']);

/**
 * The strip's tools are More's entries, so the strip shows its three units (pages, zoom, Fit) at every width: Select region and Find tables are
 * toggles, Recognise text is drawn only where text can be recognised (the desktop app) and is off until the page has no text, Suggest values is off
 * while no model is set up, and Notes opens the inspector, where the notes are.
 */
export function stripTools({ ocr = false, suggest = true } = {}) {
  return [
    { id: 'rd-region', label: 'Select region', kind: 'toggle', checked: false },
    { id: 'rd-tables', label: 'Find tables on this page', kind: 'toggle', checked: false },
    ...(ocr ? [{ id: 'rd-ocr', label: 'Recognise text', disabled: true }] : []),
    '-',
    { id: 'rd-suggest', label: 'Suggest values', disabled: !suggest },
    { id: 'rd-notes', label: 'Notes' }];
}

/**
 * The strip over the document: the shared documentStrip (the page rail's toggle, pages, zoom, Fit, Find) with the reader's tools in More. `pages` is
 * only what the "of N" slot is sized for (the real count is written when the document is open): its slot holds "of 99" with air, which is room for
 * the page count of a book.
 */
export function stripSpec({ ocr = false, suggest = true, pages = 99, previews = false } = {}) {
  return documentStripSpec({ id: 'rd', label: 'Document controls', page: 1, pages, zoom: '100%', fit: ['width', 'Fit width'], previews, tools: [findTool('rd')], overflow: stripTools({ ocr, suggest }) });
}

/**
 * What the docked pane's More holds for its PDF: where the file is and what it is. The path entries are off until the file is known to be on disk
 * (a copy kept by the app or a web preview has no path).
 */
export const FILE_ENTRIES = Object.freeze([
  { id: 'rd-reveal', label: 'Reveal in Finder', disabled: true },
  { id: 'rd-open-default', label: 'Open in default app', disabled: true },
  '-',
  { id: 'rd-copy-path', label: 'Copy path', disabled: true },
  { id: 'rd-copy-citation', label: 'Copy citation' }]);

/**
 * The head of the docked pane: the document's name (the whole name is its tooltip) and Close. `detail` is a line of context beside the name that
 * gives up its width before the name does (the quoted file's place, for evidence from a file). A PDF (`pdf`) also has Open full size (the same file
 * in a Files tab, at the same page and zoom), Save a copy and More (FILE_ENTRIES); the pane is a preview, so these are the ways out of it.
 */
export function headSpec({ title, detail = '', pdf = false } = {}) {
  return { kind: 'head', label: 'Document', id: 'rd-head', density: 'dense', lead: { title: title || 'Document' },
    ...(detail ? { message: { id: 'rd-head-detail', text: detail } } : {}),
    actions: [
      ...(pdf ? [
        { id: 'rd-full', label: 'Open full size', icon: 'full-size', role: 'quiet', fold: 2, kbd: '⌘↵', disabled: true },
        { id: 'rd-save-copy', label: 'Save a copy…', icon: 'download', role: 'quiet', fold: 3, kbd: '⌘S', disabled: true }] : []),
      { id: 'close', label: 'Close', icon: 'close', role: 'quiet', keep: true, attrs: { 'aria-label': 'Close document', title: 'Close document' } }],
    ...(pdf ? { overflow: [...FILE_ENTRIES] } : {}) };
}

// ---- the foot's five bars ---------------------------------------------------------------------------------------------------------------
const idle = () => ({ kind: 'foot', label: 'Document status', id: 'rd-foot-idle', density: 'dense', message: { id: 'rd-say', text: '' } });

/**
 * Selected text. The field is a picker held to 12 characters (the options carry each field's current value); Accept reads Replace while the chosen
 * field holds a value (one swap, so the slot is as wide as the longer word and nothing moves). What else can be made of the selection, the quote
 * with its citation, a code (in a qualitative review), a highlight or an underline, is More's; Cancel is quiet.
 */
export function assignSpec({ qualitative = false, fieldOptions = [], fieldValue = '' } = {}) {
  return { kind: 'foot', label: 'Assign selection', id: 'rd-foot-assign', density: 'dense',
    message: { id: 'rd-sel', text: '' },
    actions: [
      { picker: true, id: 'rd-field', label: 'Extraction field', value: fieldValue, options: fieldOptions, valueCh: 12, keep: true },
      uiSwap({ id: 'rd-accept-slot', members: [{ id: 'rd-accept', label: 'Accept', role: 'primary' }, { id: 'rd-replace', label: 'Replace', role: 'primary', hidden: true }] }),
      { id: 'rd-cancel', label: 'Cancel', role: 'quiet', fold: 6, kbd: 'Esc' }],
    overflow: [{ id: 'rd-copy-quote', label: 'Copy quote' }, { id: 'rd-lookup', label: LOOKUP_LABEL }, { id: 'rd-ask', label: ASK_ABOUT, attrs: ASK_PDF }, '-', ...(qualitative ? [{ id: 'rd-code', label: 'Code' }] : []), { id: 'rd-hl', label: 'Highlight' }, { id: 'rd-ul', label: 'Underline' }] };
}


/** A box drawn on the page (or a table the finder outlined): what can be made of it. `clip` is false where the reader keeps no clips; a clip is More's. */
const region = ({ clip = true } = {}) => ({ kind: 'foot', label: 'Region', id: 'rd-foot-region', density: 'dense',
  message: { id: 'rd-region-info', text: '' },
  actions: [
    { id: 'rd-region-table', label: 'Read table', icon: 'table' },
    { id: 'rd-region-km', label: 'Digitise curve', icon: 'curve' },
    { id: 'rd-region-cancel', label: 'Cancel', role: 'quiet' }],
  ...(clip ? { overflow: [{ id: 'rd-region-clip', label: 'Clip area' }] } : {}) });

/** The file's own annotations, offered once per paper: nothing is imported without asking. */
const offer = () => ({ kind: 'foot', label: 'Annotations in the file', id: 'rd-foot-offer', density: 'dense',
  message: { id: 'rd-offer-info', text: '' },
  actions: [{ id: 'rd-import-go', label: 'Import', role: 'primary' }, { id: 'rd-import-no', label: 'Dismiss', role: 'quiet' }] });

/** The five foot bars as specs, in FOOT_STATES order. */
export function footSpecs(o = {}) { return [idle(), assignSpec(o), annotateSpec(), region(o), offer()]; }

/** The foot as markup: one region, the idle bar showing. The reader switches panes with regionShow(); nothing is added to or removed from flow. */
export function footHtml(o = {}) {
  return uiRegion({ id: 'rd-foot', label: 'Document actions', active: 0, bars: footSpecs(o).map(uiBar) });
}

// ---- the inspector's two sections --------------------------------------------------------------------------------------------------------
/** The add-a-note form: kind, text and Add; it stacks as bands in a narrow inspector, so Add is never cut off. */
export function noteFormSpec({ kind = 'quote' } = {}) {
  return { kind: 'tools', label: 'Add a note', id: 'rd-note-form', form: true,
    filters: [
      { type: 'select', id: 'rd-note-kind', label: 'Note kind', options: NOTE_KINDS.map(([k, l]) => [k, l]), value: kind },
      { type: 'field', id: 'rd-note-text', label: 'Note text', placeholder: 'Note', width: 'flex' }],
    actions: [{ id: 'rd-note-add', label: 'Add', icon: 'plus', role: 'primary', type: 'submit' }] };
}
