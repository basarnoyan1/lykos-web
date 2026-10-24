// The plain PDF viewer of a Files tab as declarations (views/pdf-file.mjs draws them; as views/reader-bars.mjs is for the reader). No DOM, no
// store: the tests render them under Node, where a bad spec throws. Nothing here places a control.
//
// The tab is: the strip (or the find bar in its place: one region), the rail (Pages | Contents) beside the page column, and one foot over the
// column's lower edge whose three bars replace each other: idle (a message slot), select (text is selected), annotate (a mark is open).
import { documentStripSpec } from '../lib/ui-recipes.mjs';
import { uiBar, uiRegion } from '../lib/ui-actions.mjs';
import { annotateSpec, findTool, railHtml, selectSpec, topHtml } from './reader-bars.mjs';

export const FIT_LABEL = { page: 'Fit page', width: 'Fit width', actual: 'Actual size', custom: 'Custom' };
/** The foot's states, in the order of the region's panes. */
export const PDF_FOOT = Object.freeze(['idle', 'select', 'annotate']);

/**
 * More of the strip: the view's rotation, then what can be done with the file (Add to library when it is not in it, Recognise text where the
 * desktop app can), then where it is (on disk only) and its Details. `can` says which are drawn; nothing is drawn greyed without a reason.
 */
export function moreEntries(p, { add = false, ocr = false, reveal = false, open = false } = {}) {
  return [{ id: `${p}-rot-cw`, label: 'Rotate clockwise' }, { id: `${p}-rot-ccw`, label: 'Rotate anticlockwise' }, '-',
    ...(add ? [{ id: `${p}-add`, label: 'Add to library' }] : []), ...(ocr ? [{ id: `${p}-ocr`, label: 'Recognise text', disabled: true }] : []), '-',
    ...(reveal ? [{ id: `${p}-reveal`, label: 'Reveal in Finder' }] : []), ...(open ? [{ id: `${p}-open-default`, label: 'Open in default app' }] : []),
    { id: `${p}-details`, label: 'Details' }];
}

/** The strip: the shared documentStrip (previews toggle, pages, zoom, Fit, Find) and More. `pages` sizes the "of N" slot. */
export function pdfStripSpec({ p = 'pdf', pages = 1, previews = true, fit = 'page', can = {}, labelled = false } = {}) {
  return documentStripSpec({ id: p, label: 'PDF controls', page: 1, pages, zoom: '100%', fit: [fit, FIT_LABEL[fit] || FIT_LABEL.page], previews, pageText: labelled,
    tools: [findTool(p)], overflow: moreEntries(p, can) });
}

const idle = p => ({ kind: 'foot', label: 'Document status', id: `${p}-foot-idle`, density: 'dense', message: { id: `${p}-say`, text: '' } });
/** The foot's three bars as specs, in PDF_FOOT order. */
export const pdfFootSpecs = ({ p = 'pdf' } = {}) => [idle(p), selectSpec({ p, lookup: true }), annotateSpec({ p })];

/** The whole tab's markup: the top region, the rail and the page column, the foot. Page placeholders are the view's (they carry sizes). */
export function pdfFileHtml({ p = 'pdf', pages = 1, previews = true, fit = 'page', view = 'pages', can = {}, matchCase = false, labelled = false, labels = null } = {}) {
  return `${topHtml(p, pdfStripSpec({ p, pages, previews, fit, can, labelled }), { matchCase })}<div class="fv-pdf-workspace">${railHtml({ p, pages, view, labels })}`
    + `<div class="fv-pdf-scroll" tabindex="0" aria-label="PDF pages"><div class="fv-pdf"></div></div></div>`
    + `<div class="fv-pdf-end" hidden>${uiRegion({ id: `${p}-foot`, label: 'Document actions', active: 0, bars: pdfFootSpecs({ p }).map(uiBar) })}</div>`;
}
