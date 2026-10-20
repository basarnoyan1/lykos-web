// PRISMA 2020 flow diagram as self-contained SVG.
//
// Replaces the PRISMA2020 R package, which costs 95 R packages / 78 MB and
// drags in shiny, rmarkdown, rio, readxl and visNetwork to draw a fixed-layout
// box diagram. It also cannot emit a bitmap (rsvg is absent from the wasm repo)
// and needs a browser engine to run at all. See plan section 4.6.
//
// Counts come from the app's own reconciled state (plan K1). Field names match
// PRISMA2020's CSV contract so existing data maps across unchanged.
import { svgRoot } from './figure-draw.mjs';
import { figureTokens } from './figure-style.mjs';
import { flowGeometry, flowLines, flowBox, flowBand, flowTitle, flowArrow, flowPath, flowMarker } from './flow-draw.mjs';

const PADX = 8, PADY = 9;
const GAP_X = 26, GAP_Y = 30, PAD = 20;
const W_PREV = 210, W_MAIN = 250, W_EXCL = 250, W_OTHER = 215, W_OEXCL = 215;
const SIDEBAR_W = 30, SIDEBAR_GAP = 14;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const n = v => `(n = ${v ?? 'NA'})`;

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

export function prismaFlow(data = {}, opts = {}) {
  // `interactive` marks each box a target (data-box) for the screen; the exported figure is drawn without it.
  // `style` (figureTokens) is the medium's token set: monochrome boxes and bands (the print copy, the export set, without one);
  // a project that chose the `prisma-2020` profile gets the statement's template colours from its tokens.
  const { previous = false, other = true, title = 'PRISMA 2020 flow diagram', interactive = false } = opts;
  const ts = opts.style || figureTokens(null, { medium: 'export' });
  const d = data;
  const G = flowGeometry(ts, LAYOUT);
  const { GAP_X, GAP_Y, PAD, W_PREV, W_MAIN, W_EXCL, W_OTHER, W_OEXCL, SIDEBAR_W, SIDEBAR_GAP } = G;
  /** A box: optional heading line, then body lines. Height derives from wrapping. */
  const box = (width, heading, lines) => {
    const all = flowLines(ts, width, G.PADX, heading, lines);
    return { width, lines: all, height: Math.max(G.MIN_H, all.length * G.LH + 2 * G.PADY) };
  };

  // ---- boxes ------------------------------------------------------------
  const b = {};
  // Each database and register by name under its total, as the PRISMA 2020
  // statement asks ("PubMed (n = 120)"), when the counts say which.
  const named = raw => reasons(raw).map(x => `  ${x}`);
  b.identified = box(W_MAIN, 'Records identified from:', [
    `Databases ${n(d.database_results)}`, ...named(d.database_specific_results),
    `Registers ${n(d.register_results)}`, ...named(d.register_specific_results),
  ]);
  b.removed = box(W_EXCL, 'Records removed before screening:', [
    `Duplicate records ${n(d.duplicates)}`,
    `Records marked as ineligible by automation tools ${n(d.excluded_automatic)}`,
    `Records removed for other reasons ${n(d.excluded_other)}`,
  ]);
  b.screened   = box(W_MAIN, null, ['Records screened', n(d.records_screened)]);
  b.excluded   = box(W_EXCL, null, ['Records excluded', n(d.records_excluded)]);
  b.sought     = box(W_MAIN, null, ['Reports sought for retrieval', n(d.dbr_sought_reports)]);
  b.notret     = box(W_EXCL, null, ['Reports not retrieved', n(d.dbr_notretrieved_reports)]);
  b.assessed   = box(W_MAIN, null, ['Reports assessed for eligibility', n(d.dbr_assessed)]);
  b.excl2      = box(W_EXCL, 'Reports excluded:', reasons(d.dbr_excluded));
  b.included   = box(W_MAIN, null, [
    'New studies included in review', n(d.new_studies),
    'Reports of new included studies', n(d.new_reports),
  ]);

  if (other) {
    b.oIdentified = box(W_OTHER, 'Records identified from:', [
      `Websites ${n(d.website_results)}`,
      `Organisations ${n(d.organisation_results)}`,
      `Citation searching ${n(d.citations_results)}`,
    ]);
    b.oSought   = box(W_OTHER, null, ['Reports sought for retrieval', n(d.other_sought_reports)]);
    b.oNotret   = box(W_OEXCL, null, ['Reports not retrieved', n(d.other_notretrieved_reports)]);
    b.oAssessed = box(W_OTHER, null, ['Reports assessed for eligibility', n(d.other_assessed)]);
    b.oExcl     = box(W_OEXCL, 'Reports excluded:', reasons(d.other_excluded));
  }
  if (previous) {
    b.prev  = box(W_PREV, null, [
      'Studies included in previous version of review', n(d.previous_studies),
      'Reports of studies included in previous version of review', n(d.previous_reports),
    ]);
    b.total = box(W_MAIN, null, [
      'Total studies included in review', n(d.total_studies),
      'Reports of total included studies', n(d.total_reports),
    ]);
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
  const TITLE_H = G.TITLE_H;
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
  const right = (from, to) => A.push(flowArrow(ts, AH, from.x + from.width, from.y + from.height / 2, to.x - ts.line.box, from.y + from.height / 2));
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
  const titleBar = (x0, w, text) => flowTitle(ts, x0, titleY, w, TITLE_H, text);
  if (previous) out.push(titleBar(col.prev, W_PREV, 'Previous studies'));
  out.push(titleBar(col.main, W_MAIN + GAP_X + W_EXCL, 'Identification of new studies via databases and registers'));
  if (other) out.push(titleBar(col.other, W_OTHER + GAP_X + W_OEXCL, 'Identification of new studies via other methods'));

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

  return svgRoot(ts, canvasW, canvasH, out.join(''), { title, desc: `PRISMA 2020${other ? '' : ', databases and registers only'}`, defs: flowMarker(ts, AH) });
}

/** The house drawings app/lint-figures.mjs checks: the diagram with both other arms and named sources. */
export const __fixture = style => [{ name: 'prismaFlow', svg: prismaFlow({ database_results: 1240, register_results: 18, database_specific_results: 'PubMed, 800; Embase, 440', duplicates: 312,
  records_screened: 942, records_excluded: 801, dbr_sought_reports: 141, dbr_notretrieved_reports: 6, dbr_assessed: 135, dbr_excluded: 'Wrong population, 31; Wrong design, 22', new_studies: 65, new_reports: 71 },
  { style, previous: true, other: true }) }];
