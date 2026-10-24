// A part of the package as a document (plan, package amendment): its items become the manuscript's blocks, written by the manuscript's own Word
// writer, so captions are SEQ fields (Table_S reads "Table S1"), references inside the document are REF fields and each orientation is a
// section. Pure: the sources are loaded by lib/package-sources.mjs and handed in. A table goes to the workbook too, one sheet each.
import { writeManuscriptDocx } from './docx-write-doc.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { DEFAULT_STYLES } from './manuscript-doc.mjs';
import { seqName, plainText } from './package.mjs';
import { documentPdf } from './svg-pdf.mjs';

export const PAGE_SIZES = { A4: [595, 842], Letter: [612, 792] };
const MARGIN = 72;
let n = 0;
const bid = () => `pk${(n++).toString(36)}`;
const KIND_WORD = { table: 'Table', figure: 'Figure' };

export function sourceProblems(snap, sources) {
  return snap.items.flatMap(it => { const s = sources.get(it.id); return !s ? [{ itemId: it.id, text: 'Missing source' }] : s.error ? [{ itemId: it.id, text: s.error }] : it.kind === 'document' && !Array.isArray(s.blocks) ? [{ itemId: it.id, text: 'The document could not be generated' }] : []; });
}
// `page.margin` (pt) narrows the margins for a wide table; `page.pageNumbers` puts the page number centred in the footer
// `page.margin` is one number or one per orientation ({ portrait: 56.7, landscape: 28.35 })
const sectionOf = (page, orient) => { const [w, h] = PAGE_SIZES[page.size] || PAGE_SIZES.A4; const land = orient === 'landscape', mm = page.margin && typeof page.margin === 'object' ? page.margin[land ? 'landscape' : 'portrait'] : page.margin, m = Number(mm) > 0 ? Number(mm) : MARGIN;
  return { pageW: land ? h : w, pageH: land ? w : h, orient: land ? 'landscape' : 'portrait', top: m, right: m, bottom: m, left: m, ...(page.pageNumbers ? { footer: { text: '{{page}}', jc: 'center' } } : {}) }; };
// Inside the document a reference stays a token (Word REF field to the caption's paragraph); a reference to an item of another part reads as text.
const refText = (text, inPart, labelOf, captionOf) => String(text || '').replace(/\{\{xref:([A-Za-z0-9._-]+)\}\}/g, (m, id) => (inPart.has(id) ? `{{xref:${captionOf(id)}}}` : labelOf(id) || '[removed item]'));

export function composeBlocks(snap, sources, { labelOf }) {
  const problems = sourceProblems(snap, sources);
  if (problems.length) throw new Error(problems.map(p => p.text).join('; '));
  const { page, prefix } = snap.part, inPart = new Set(snap.items.map(it => it.id)), noNotes = snap.part.variant && snap.part.variant.notes === false;
  const capId = new Map(snap.items.map(it => [it.id, bid()]));
  const textW = sectionOf(page, 'portrait').pageW - 2 * MARGIN;
  const blocks = [];
  const para = (text, props = {}, styleId = 'Normal') => ({ id: bid(), type: 'p', styleId, props, text, runs: [{ t: text }] });
  const caption = it => {
    const head = `${KIND_WORD[it.kind]} ${prefix}{{seq:${seqName(it.kind, prefix)}}}.`;
    const title = refText(it.title, inPart, labelOf, id => capId.get(id)), legend = refText(it.legend, inPart, labelOf, id => capId.get(id));
    // a title ends with a full stop unless the part says otherwise (`page.captionStop: false`, a title printed as a heading)
    const text = [head, title && (page.captionStop === false ? title : `${title.replace(/\.?$/, '.')}`), legend].filter(Boolean).join(' ');
    // `page.captionBold: 'all'`: the whole caption in bold, as some journals print it; else the label alone
    // `captionBold`: 'all', or 'title' (the label and title bold, the legend plain); `captionPt`: one size or one per kind ({ table: 10, figure: 9 })
    const cpt = page.captionPt && typeof page.captionPt === 'object' ? page.captionPt[it.kind] : null, sz = Number(cpt) > 0 ? { sz: Number(cpt) } : {};
    const titled = [head, title && (page.captionStop === false ? title : `${title.replace(/\.?$/, '.')}`)].filter(Boolean).join(' ');
    const runs = page.captionBold === 'all' ? [{ t: text, b: true, ...sz }]
      : page.captionBold === 'title' ? [{ t: titled, b: true, ...sz }, ...(text.length > titled.length ? [{ t: text.slice(titled.length), ...sz }] : [])]
      : [{ t: head, b: true, ...sz }, { t: text.slice(head.length), ...sz }];
    return { id: capId.get(it.id), type: 'p', styleId: 'Caption', props: { after: 6, ...(page.captionJustify && it.kind === 'figure' ? { jc: 'both' } : {}) }, text, runs };
  };
  // `page.heading`: a title above the part's first item ('Supplementary material')
  if (page.heading) blocks.push({ id: bid(), type: 'p', styleId: 'Normal', props: { after: 10 }, text: page.heading, runs: [{ t: page.heading, b: true, sz: Number(page.headingPt) > 0 ? Number(page.headingPt) : 14 }] });
  let orientNow = page.orient;
  snap.items.forEach((it, i) => {
    const orient = it.orient || page.orient, first = blocks.length;
    if (i > 0 && orient !== orientNow) {   // the previous run of items ends its section
      const last = blocks.at(-1); last.props = { ...last.props, section: sectionOf(page, orientNow) };
      orientNow = orient;
    }
    const src = sources.get(it.id);
    if (it.kind === 'document') {
      // a generated document: its own blocks, with the part's ids, no caption and no number; its first block starts the page
      blocks.push(...src.blocks.map(b => ({ ...b, id: bid() })));
      if (i > 0 && !it.samePage) blocks[first].props = { ...blocks[first].props, pageBreakBefore: true };
      return;
    }
    if (it.kind === 'figure') {
      // a drawing of the app knows its print size (lib/app-items.mjs rasterize); a file's pixels are read at 96 per inch
      // several pictures share the page: scaled together to fit the text height left for the caption
      const pics = src.images || [src.image];
      // `it.panels`: each picture is a panel under its letter (A, B, ...), as a figure of a forest plot over its SWiM table is printed
      const lettered = it.panels && pics.length > 1;
      const sec = sectionOf(page, orient), fullW = sec.pageW - sec.left - sec.right, room = sec.pageH - sec.top - sec.bottom - 140 - (lettered ? 18 * pics.length : 0);
      const ws = pics.map(im => Math.min(page.margin ? fullW : textW * (orient === 'landscape' ? 1.4 : 1), im.ptW || im.w * 0.75 || textW));
      const k = pics.length > 1 ? Math.min(1, room / pics.reduce((a, im, j) => a + ws[j] * im.h / im.w, 0)) : 1;
      pics.forEach((im, j) => {
        if (lettered) blocks.push({ id: bid(), type: 'p', styleId: 'Normal', props: { before: j ? 6 : 0, after: 2, keepNext: true }, text: String.fromCharCode(65 + j), runs: [{ t: String.fromCharCode(65 + j), b: true }] });
        blocks.push({ id: bid(), type: 'figure', img: j ? `img-${it.id}-${j}` : `img-${it.id}`, name: it.title, mime: im.mime, w: ws[j] * k, h: ws[j] * k * (im.h / im.w), props: { jc: lettered ? 'left' : 'center', keepNext: true, ...(pics.length > 1 ? { after: 8 } : {}) }, text: '' });
      });
      blocks.push(caption(it));
    } else {
      blocks.push({ ...caption(it), props: { after: 6, keepNext: true } });
      // a table laid out in relative widths (`fit`) fills the text width of its page, whatever the margins and orientation
      const sec = sectionOf(page, orient), fitW = sec.pageW - sec.left - sec.right;
      // `it.pt`: this table's type size, whatever its source
      const sized = Number(it.pt) > 0 ? { ...src.grid, sz: Number(it.pt) } : src.grid;
      const grid = sized.fit ? { ...sized, cols: (t => sized.cols.map(c => c / t * fitW))(sized.cols.reduce((a, b) => a + b, 0)) } : sized;
      blocks.push({ id: bid(), type: 'table', grid: { ...grid, borders: grid.borders || 'all' }, text: '' });
      // the notes a drawing of the app carries (a Summary of findings' footnotes), then the item's own; `notesHeading` is set in bold above them,
      // and `page.notePt` gives notes their own size
      const nr = Number(page.notePt) > 0 ? { sz: Number(page.notePt) } : {};
      const notes = noNotes ? [] : [...(src.notes || []), ...(it.notes || [])];
      if (notes.length && it.notesHeading) blocks.push({ id: bid(), type: 'p', styleId: 'Normal', props: { before: 12, after: 4 }, text: it.notesHeading, runs: [{ t: it.notesHeading, b: true, ...(Number(page.notePt) > 0 ? { sz: Number(page.notePt) + 1 } : {}) }] });
      for (const note of notes) { const t = refText(note, inPart, labelOf, id => capId.get(id)); blocks.push({ ...para(t, { after: 3 }, 'Normal'), runs: [{ t, ...nr }] }); }
    }
    if (i > 0 && !it.samePage) blocks[first].props = { ...blocks[first].props, pageBreakBefore: true };
  });
  if (blocks.length) { const last = blocks.at(-1); last.props = { ...last.props, section: sectionOf(page, orientNow) }; }
  const styles = structuredClone(DEFAULT_STYLES);
  styles.default.run = { font: page.font, sz: page.pt };
  styles.default.para = { after: 0, line: page.spacing };
  styles.byId.Caption.run = { b: false, sz: Number(page.captionPt) > 0 ? Number(page.captionPt) : page.pt };
  const media = new Map(snap.items.filter(it => it.kind === 'figure').flatMap(it => { const src = sources.get(it.id); return (src.images || [src.image]).map((im, j) => [j ? `img-${it.id}-${j}` : `img-${it.id}`, { bytes: im.bytes, mime: im.mime, svg: (j ? null : src.svg) || im.svg || null }]); }));
  return { blocks, section: blocks.at(-1)?.props.section || sectionOf(page, page.orient), styles, media };
}

/**
 * The part as a PDF written by the app (lib/svg-pdf.mjs documentPdf): a figure the app draws stays vector, a picture file is held as it is, a table is
 * set as text between rules; each item on a page of its own, numbered in order as the Word copy's SEQ fields number it (Figure S1 in a part with prefix S).
 */
export function buildPdf(snap, sources, { labelOf }) {
  const problems = sourceProblems(snap, sources);
  if (problems.length) throw new Error(problems.map(p => p.text).join('; '));
  const { page, prefix } = snap.part, count = { table: 0, figure: 0 }, noNotes = snap.part.variant && snap.part.variant.notes === false;
  const numberOf = new Map(snap.items.filter(it => it.kind !== 'document').map(it => [it.id, `${KIND_WORD[it.kind]} ${prefix || ''}${++count[it.kind]}`]));
  const text = s => String(s || '').replace(/\{\{xref:([A-Za-z0-9._-]+)\}\}/g, (m, id) => numberOf.get(id) || labelOf(id) || '[removed item]');
  const items = snap.items.map(it => {
    const src = sources.get(it.id);
    if (it.kind === 'document') return { blocks: src.blocks };
    const caption = `${numberOf.get(it.id)}. ${text(it.title).replace(/\.?$/, '.')}`;
    if (it.kind === 'figure') return src.svg ? { caption, legend: text(it.legend), svg: src.svg } : { caption, legend: text(it.legend), image: src.image };
    return { caption: [caption, text(it.legend)].filter(Boolean).join(' '), grid: src.grid, notes: noNotes ? [] : [...(src.notes || []), ...(it.notes || [])].map(text) };
  });
  return documentPdf(items, { page: PAGE_SIZES[page.size] || PAGE_SIZES.A4, title: snap.part.name || 'Package' });
}

export async function buildDocx(snap, sources, { labelOf }) {
  const { blocks, section, styles, media } = composeBlocks(snap, sources, { labelOf });
  // the last section is the document's own (w:body's sectPr), not a paragraph's
  const last = blocks.at(-1); if (last) { const { section: _, ...rest } = last.props; last.props = rest; }
  const blob = await writeManuscriptDocx({ blocks, section, styles, media });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildXlsx(snap, sources, { labelOf }) {
  const sheets = snap.items.filter(it => it.kind === 'table' && sources.get(it.id)?.grid).map(it => {
    const label = labelOf(it.id), g = sources.get(it.id).grid;
    const rows = [[`${label}. ${plainText(it.title, labelOf)}`], ...g.rows.map(r => r.cells.map(c => c.merged ? '' : c.text ?? '')), ...[...(sources.get(it.id).notes || []), ...(it.notes || [])].map(t => [plainText(t, labelOf)])];
    return { name: label, rows };
  });
  if (!sheets.length) return null;
  const blob = await writeXlsx(sheets);
  return new Uint8Array(await blob.arrayBuffer());
}
