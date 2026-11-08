// PRISMA 2020 flow diagram as self-contained SVG.
//
// Replaces the PRISMA2020 R package, which costs 95 R packages / 78 MB and
// drags in shiny, rmarkdown, rio, readxl and visNetwork to draw a fixed-layout
// box diagram. It also cannot emit a bitmap (rsvg is absent from the wasm repo)
// and needs a browser engine to run at all. See plan section 4.6.
//
// Counts come from the app's own reconciled state (plan K1). Field names match
// PRISMA2020's CSV contract so existing data maps across unchanged.
import { svgRoot, wrapText, measure } from './figure-draw.mjs';
import { figureTokens } from './figure-style.mjs';
import { flowGeometry, flowLines, flowBox, flowBand, flowTitle, flowArrow, flowPath, flowMarker } from './flow-draw.mjs';

const PADX = 8, PADY = 9;
const GAP_X = 26, GAP_Y = 30, PAD = 20;
const W_PREV = 210, W_MAIN = 250, W_EXCL = 250, W_OTHER = 250, W_OEXCL = 250;   // the other-methods column as wide as the main one: its reasons fit a line
const SIDEBAR_W = 30, SIDEBAR_GAP = 14;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// counts as the template prints them ("(n = 3478)"), or with thousands separated ("(n = 3,478)") when a journal's style asks (opts.thousands)
let grouped = false;
const n = v => `(n = ${v == null ? 'NA' : grouped && /^\d{4,}$/.test(String(v)) ? Number(v).toLocaleString('en-US') : v})`;
const has = v => v != null && v !== '';
/**
 * A box's count lines by the template's rule: the PRISMA 2020 template asks authors to delete the lines that do not apply to
 * their review (registers, automation tools, websites, organisations, reports of included studies), so a line marked optional
 * is drawn only when it has a count. A required line keeps "(n = NA)", and a box with no count at all keeps its template lines.
 * Rows are [text, value, optional, extra lines under it].
 */
function countLines(rows) {
  const any = rows.some(([, v]) => has(v));
  return rows.filter(([, v, optional]) => !optional || has(v) || !any).flatMap(([text, v, , extra = []]) => [extra.length ? { t: `${text} ${n(v)}`, bold: true } : `${text} ${n(v)}`, ...extra]);
}

/** "Peer review, 2; Trial register, 1" -> count rows [label, count, optional] for countLines. */
function sourceRows(raw) {
  return String(raw ?? '').split(';').filter(part => part.trim()).map(part => {
    const i = part.lastIndexOf(','), count = i < 0 ? '' : part.slice(i + 1).trim();
    return [(i < 0 ? part : part.slice(0, i)).trim(), /^\d+$/.test(count) ? count : 'NA', true];
  });
}

/** "Reason1, 4; Reason2, 7" -> ["Reason1 (n = 4)", "Reason2 (n = 7)"] */
function reasons(raw) {
  if (raw == null || raw === '') return [];
  // A trailing or doubled ";" is no entry of its own.
  return String(raw).split(';').filter(part => part.trim()).map(part => {
    const i = part.lastIndexOf(',');
    if (i < 0) return `${part.trim()} ${n('NA')}`;
    const raw = part.slice(i + 1).trim();
    // a non-numeric count is not a count; show NA rather than echo the text
    const count = /^-?\d+$/.test(raw) ? raw : 'NA';
    return `${part.slice(0, i).trim()} ${n(count)}`;
  });
}

// The layout in px at 11 px type; the house style scales it to its own label size (flow-draw.mjs flowGeometry).
const LAYOUT = { PADX, PADY, GAP_X, GAP_Y, PAD, W_PREV, W_MAIN, W_EXCL, W_OTHER, W_OEXCL, SIDEBAR_W, SIDEBAR_GAP, TITLE_H: 30, MIN_H: 38 };
const columnCount = ({ previous, other }) => 2 + (other ? 2 : 0) + (previous ? 1 : 0);
/** The canvas width of a layout (in the tokens' unit, after flowGeometry). */
const canvasWidth = (G, { previous, other }) => 2 * G.PAD + G.SIDEBAR_W + G.SIDEBAR_GAP + G.W_MAIN + G.W_EXCL + (other ? G.W_OTHER + G.W_OEXCL : 0) + (previous ? G.W_PREV : 0) + G.GAP_X * (columnCount({ previous, other }) - 1);
const unitsPerInch = ts => (ts.unit === 'pt' ? 72 : 96);
/**
 * The portrait layout (display-item checks amendment, 2 Nov 2026): the same rows and columns of the PRISMA 2020 template, each box narrower
 * and its text wrapped, so the whole flow fits a journal's page width (Neurology 6.8 in) at the house label size (8 pt). Gaps and the phase
 * bands are tighter; every arm keeps its two columns, and its boxes share the width left, the main column a little wider than its exclusions.
 */
function portraitLayout(ts, pageW, { previous, other }) {
  const k = ts.size.label / 11, total = pageW * unitsPerInch(ts) / k;
  const L = { ...LAYOUT, PAD: 8, GAP_X: 12, GAP_Y: 22, SIDEBAR_W: 24, SIDEBAR_GAP: 8, PADX: 5, PADY: 6, MIN_H: 30 };
  const avail = total - 2 * L.PAD - L.SIDEBAR_W - L.SIDEBAR_GAP - L.GAP_X * (columnCount({ previous, other }) - 1);
  const arms = (other ? 2 : 1) + (previous ? 0.5 : 0), arm = avail / arms;
  return { ...L, W_MAIN: arm * 0.52, W_EXCL: arm * 0.48, W_OTHER: arm * 0.52, W_OEXCL: arm * 0.48, W_PREV: arm * 0.5 };
}
/**
 * Which layout a page box asks for: 'landscape' (the template's own) when it fits the page's width, else 'portrait'. `page` is { w, h } in
 * inches (a journal preset's figures.page, lib/display-checks.mjs journalLimits); none keeps landscape.
 */
export function prismaLayoutFor(page, opts = {}) {
  if (!page?.w) return 'landscape';
  const ts = opts.style || figureTokens(null, { medium: 'export' });
  return canvasWidth(flowGeometry(ts, LAYOUT), { previous: !!opts.previous, other: opts.other !== false }) <= page.w * unitsPerInch(ts) + 1e-6 ? 'landscape' : 'portrait';
}

export function prismaFlow(data = {}, opts = {}) {
  // `interactive` marks each box a target (data-box) for the screen; the exported figure is drawn without it.
  // `style` (figureTokens) is the medium's token set: monochrome boxes and bands (the print copy, the export set, without one);
  // a project that chose the `prisma-2020` profile gets the statement's template colours from its tokens.
  // `layout`: 'landscape' (the template's own, the default), 'portrait' (narrower boxes on `page`'s width, 6.8 in without one) or 'auto'
  // (portrait when the landscape drawing is wider than `page`, { w, h } in inches: a journal's page box)
  // `thousands`: counts of 1,000 or more with a thousands separator, as the manuscript's text prints them (AMA, Neurology)
  grouped = !!opts.thousands;
  try { return drawFlow(data, opts); } finally { grouped = false; }
}

function drawFlow(data, opts) {
  const { previous = false, other = true, title = 'PRISMA 2020 flow diagram', interactive = false } = opts;
  const ts = opts.style || figureTokens(null, { medium: 'export' });
  const d = data;
  const layout = opts.layout === 'auto' ? prismaLayoutFor(opts.page, { style: ts, previous, other }) : opts.layout === 'portrait' ? 'portrait' : 'landscape';
  const G = flowGeometry(ts, layout === 'portrait' ? portraitLayout(ts, opts.page?.w || 6.8, { previous, other }) : LAYOUT);
  const { GAP_X, GAP_Y, PAD, W_PREV, W_MAIN, W_EXCL, W_OTHER, W_OEXCL, SIDEBAR_W, SIDEBAR_GAP } = G;
  /** A box: optional heading line, then body lines. Height derives from wrapping. */
  // in the portrait layout a line too long for its box breaks before its count, so "(n = 3478)" is never split across lines
  const keepCounts = (width, lines) => layout !== 'portrait' ? lines : lines.flatMap(l => {
    const txt = typeof l === 'object' ? l.t : l, bold = typeof l === 'object' && l.bold;
    const m = /^(.*\S) (\(n = [^)]*\))$/.exec(txt);
    return m && measure(ts, txt) > width - 2 * G.PADX ? (bold ? [{ t: m[1], bold }, { t: m[2], bold }] : [m[1], m[2]]) : [l];
  });
  const box = (width, heading, lines) => {
    const all = flowLines(ts, width, G.PADX, heading, keepCounts(width, lines));
    return { width, lines: all, height: Math.max(G.MIN_H, all.length * G.LH + 2 * G.PADY) };
  };

  // ---- boxes ------------------------------------------------------------
  const b = {};
  // Each database and register by name under its total, as the PRISMA 2020
  // statement asks ("PubMed (n = 120)"), when the counts say which.
  const named = raw => reasons(raw).map(x => `  ${x}`);
  b.identified = box(W_MAIN, 'Records identified from:', countLines([
    ['Databases', d.database_results, false, named(d.database_specific_results)],
    ['Registers', d.register_results, !has(d.register_specific_results), named(d.register_specific_results)],
  ]));
  b.removed = box(W_EXCL, 'Records removed before screening:', countLines([
    ['Duplicate records', d.duplicates, false],
    ['Records marked as ineligible by automation tools', d.excluded_automatic, true],
    ['Records removed for other reasons', d.excluded_other, true],
  ]));
  b.screened   = box(W_MAIN, null, ['Records screened', n(d.records_screened)]);
  b.excluded   = box(W_EXCL, null, ['Records excluded', n(d.records_excluded)]);
  b.sought     = box(W_MAIN, null, ['Reports sought for retrieval', n(d.dbr_sought_reports)]);
  // reports sought and not yet decided (full text not obtained, a registry entry without results) are the difference between sought and
  // assessed; a review that counts them (dbr_awaiting_reports, other_awaiting_reports) shows them under the reports not retrieved
  const awaiting = v => (has(v) ? ['Reports awaiting classification', n(v)] : []);
  b.notret     = box(W_EXCL, null, ['Reports not retrieved', n(d.dbr_notretrieved_reports), ...awaiting(d.dbr_awaiting_reports)]);
  b.assessed   = box(W_MAIN, null, ['Reports assessed for eligibility', n(d.dbr_assessed)]);
  b.excl2      = box(W_EXCL, 'Reports excluded:', reasons(d.dbr_excluded));
  // the PRISMA 2020 template for a new review says "Studies included in review"; "new studies" belongs to an updated one (previous)
  const fresh = previous ? 'new ' : '', New = previous ? 'New studies' : 'Studies';
  b.included   = box(W_MAIN, null, [`${New} included in review`, n(d.new_studies), ...(has(d.new_reports) ? [`Reports of ${fresh}included studies`, n(d.new_reports)] : [])]);

  if (other) {
    b.oIdentified = box(W_OTHER, 'Records identified from:', countLines([
      ['Websites', d.website_results, true], ['Organisations', d.organisation_results, true], ['Citation searching', d.citations_results, true],
      // the template's "etc.": any other source, each a line of its own ("Peer review, 2")
      ...sourceRows(d.other_sources_results),
    ]));
    b.oSought   = box(W_OTHER, null, ['Reports sought for retrieval', n(d.other_sought_reports)]);
    b.oNotret   = box(W_OEXCL, null, ['Reports not retrieved', n(d.other_notretrieved_reports), ...awaiting(d.other_awaiting_reports)]);
    b.oAssessed = box(W_OTHER, null, ['Reports assessed for eligibility', n(d.other_assessed)]);
    b.oExcl     = box(W_OEXCL, 'Reports excluded:', reasons(d.other_excluded));
  }
  if (previous) {
    b.prev  = box(W_PREV, null, ['Studies included in previous version of review', n(d.previous_studies),
      ...(has(d.previous_reports) ? ['Reports of studies included in previous version of review', n(d.previous_reports)] : [])]);
    b.total = box(W_MAIN, null, ['Total studies included in review', n(d.total_studies),
      ...(has(d.total_reports) ? ['Reports of total included studies', n(d.total_reports)] : [])]);
  }

  // ---- columns ----------------------------------------------------------
  let x = PAD + SIDEBAR_W + SIDEBAR_GAP;
  const col = {};
  if (previous) { col.prev = x; x += W_PREV + GAP_X; }
  col.main = x; x += W_MAIN + GAP_X;
  col.excl = x; x += W_EXCL + GAP_X;
  if (other) { col.other = x; x += W_OTHER + GAP_X; col.oexcl = x; x += W_OEXCL + GAP_X; }
  const canvasW = x - GAP_X + PAD;

  // ---- rows -------------------------------------------------------------
  // an arm's title wraps when its columns are narrower than it (the portrait layout); the strip grows to hold it
  const titleLines = (w, text) => (layout === 'portrait' ? wrapText(ts, text, w - 2 * G.PADX, 'head') : [text]);
  const sources = has(d.register_results) || has(d.register_specific_results) || !has(d.database_results) ? 'databases and registers' : 'databases';
  const mainTitle = titleLines(W_MAIN + GAP_X + W_EXCL, opts.mainTitle || `Identification of ${fresh}studies via ${sources}`);
  const otherTitle = other ? titleLines(W_OTHER + GAP_X + W_OEXCL, opts.otherTitle || `Identification of ${fresh}studies via other methods`) : [];
  const prevTitle = previous ? titleLines(W_PREV, 'Previous studies') : [];
  const TITLE_H = Math.max(G.TITLE_H, Math.max(mainTitle.length, otherTitle.length, prevTitle.length) * G.LH + G.PADY * 1.4);
  let y = PAD;
  const place = (bx, cx, yy) => { bx.x = cx; bx.y = yy; return bx; };
  const rowH = (...boxes) => Math.max(...boxes.filter(Boolean).map(bb => bb.height));

  const titleY = y; y += TITLE_H + GAP_Y * 0.6;
  const r1 = y; y += rowH(b.identified, b.removed, b.oIdentified) + GAP_Y;
  const r2 = y; y += rowH(b.screened, b.excluded) + GAP_Y;
  const r3 = y; y += rowH(b.sought, b.notret, b.oSought, b.oNotret) + GAP_Y;
  const r4 = y; y += rowH(b.assessed, b.excl2, b.oAssessed, b.oExcl) + GAP_Y;
  const r5 = y; y += b.included.height + GAP_Y;
  const r6 = previous ? y : null; if (previous) y += b.total.height + GAP_Y;
  const canvasH = y - GAP_Y + PAD;

  place(b.identified, col.main, r1); place(b.removed, col.excl, r1);
  place(b.screened,   col.main, r2); place(b.excluded, col.excl, r2);
  place(b.sought,     col.main, r3); place(b.notret,  col.excl, r3);
  place(b.assessed,   col.main, r4); place(b.excl2,   col.excl, r4);
  place(b.included,   col.main, r5);
  if (other) {
    place(b.oIdentified, col.other, r1);
    place(b.oSought, col.other, r3); place(b.oNotret, col.oexcl, r3);
    place(b.oAssessed, col.other, r4); place(b.oExcl, col.oexcl, r4);
  }
  if (previous) { place(b.prev, col.prev, r1); place(b.total, col.main, r6); }

  // ---- emit -------------------------------------------------------------
  const out = [];
  const AH = 'ah-prisma';
  const body = bx => flowBox(ts, bx, { padY: G.PADY, lh: G.LH });
  const drawBox = (bx, aria, id) => !bx ? '' : interactive
    ? `<g role="button" tabindex="0" data-box="${id}" aria-label="${esc(aria)}">${body(bx)}</g>`
    : `<g role="group" aria-label="${esc(aria)}">${body(bx)}</g>`;

  // arrows
  const A = [];
  const down = (from, to) => A.push(flowArrow(ts, AH, from.x + from.width / 2, from.y + from.height, to.x + to.width / 2, to.y - ts.line.box));
  // a side arrow meets both boxes: at the middle of the shorter one (a tall Records identified box beside a short Records removed box)
  const right = (from, to) => { const y = Math.max(from.y, to.y) + Math.min(from.height, to.height) / 2; A.push(flowArrow(ts, AH, from.x + from.width, y, to.x - ts.line.box, y)); };
  const elbow = d => A.push(flowPath(ts, AH, d));
  down(b.identified, b.screened); down(b.screened, b.sought);
  down(b.sought, b.assessed);     down(b.assessed, b.included);
  right(b.identified, b.removed); right(b.screened, b.excluded);
  right(b.sought, b.notret);      right(b.assessed, b.excl2);
  if (other) {
    down(b.oIdentified, b.oSought); down(b.oSought, b.oAssessed);
    right(b.oSought, b.oNotret);    right(b.oAssessed, b.oExcl);
    // elbow from the other-methods column back into the included box
    const sx = b.oAssessed.x + b.oAssessed.width / 2, sy = b.oAssessed.y + b.oAssessed.height;
    const ty = b.included.y + b.included.height / 2, tx = b.included.x + b.included.width;
    elbow(`M ${sx} ${sy} V ${ty} H ${tx + 1}`);
  }
  if (previous) {
    down(b.included, b.total);
    const sx = b.prev.x + b.prev.width / 2, sy = b.prev.y + b.prev.height;
    const ty = b.total.y + b.total.height / 2, tx = b.total.x;
    elbow(`M ${sx} ${sy} V ${ty} H ${tx - 1}`);
  }

  // phase bands
  const band = (text, top, bottom) => flowBand(ts, PAD, top, SIDEBAR_W, bottom - top, text);
  const bandIdEnd = r1 + rowH(b.identified, b.removed, b.oIdentified);
  const bandScEnd = r4 + rowH(b.assessed, b.excl2, b.oAssessed, b.oExcl);
  out.push(band('Identification', titleY, bandIdEnd));
  out.push(band('Screening', r2 - GAP_Y * 0.5, bandScEnd));
  out.push(band('Included', r5 - GAP_Y * 0.5, (r6 ?? r5) + (previous ? b.total.height : b.included.height)));

  // title bars
  // registers named only when the review searched one (the template asks to delete what does not apply); one line keeps flowTitle's drawing
  const titleBar = (x0, w, list) => flowTitle(ts, x0, titleY, w, TITLE_H, list.length === 1 ? list[0] : list);
  if (previous) out.push(titleBar(col.prev, W_PREV, prevTitle));
  out.push(titleBar(col.main, W_MAIN + GAP_X + W_EXCL, mainTitle));
  if (other) out.push(titleBar(col.other, W_OTHER + GAP_X + W_OEXCL, otherTitle));

  out.push(...A);
  out.push(drawBox(b.prev, 'Previous studies', 'prev'));
  out.push(drawBox(b.identified, 'Records identified', 'identified'), drawBox(b.removed, 'Records removed before screening', 'removed'));
  out.push(drawBox(b.screened, 'Records screened', 'screened'), drawBox(b.excluded, 'Records excluded', 'excluded'));
  out.push(drawBox(b.sought, 'Reports sought for retrieval', 'sought'), drawBox(b.notret, 'Reports not retrieved', 'notret'));
  out.push(drawBox(b.assessed, 'Reports assessed for eligibility', 'assessed'), drawBox(b.excl2, 'Reports excluded', 'excl2'));
  out.push(drawBox(b.oIdentified, 'Records identified via other methods', 'oIdentified'));
  out.push(drawBox(b.oSought, 'Reports sought for retrieval, other methods', 'oSought'), drawBox(b.oNotret, 'Reports not retrieved, other methods', 'oNotret'));
  out.push(drawBox(b.oAssessed, 'Reports assessed for eligibility, other methods', 'oAssessed'), drawBox(b.oExcl, 'Reports excluded, other methods', 'oExcl'));
  out.push(drawBox(b.included, 'Studies included in review', 'included'));
  out.push(drawBox(b.total, 'Total studies included in review', 'total'));

  return svgRoot(ts, canvasW, canvasH, out.join(''), { title, desc: `PRISMA 2020${other ? '' : ', databases and registers only'}${layout === 'portrait' ? ', portrait' : ''}`, defs: flowMarker(ts, AH) });
}

/** The house drawings app/lint-figures.mjs checks: the diagram with both other arms and named sources. */
export const __fixture = style => [{ name: 'prismaFlow', svg: prismaFlow({ database_results: 1240, register_results: 18, database_specific_results: 'PubMed, 800; Embase, 440', duplicates: 312,
  records_screened: 942, records_excluded: 801, dbr_sought_reports: 141, dbr_notretrieved_reports: 6, dbr_assessed: 135, dbr_excluded: 'Wrong population, 31; Wrong design, 22', new_studies: 65, new_reports: 71 },
  { style, previous: true, other: true }) }];
