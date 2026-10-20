// A part of the package as a document (plan, package amendment): its items become the manuscript's blocks, written by the manuscript's own Word
// writer, so captions are SEQ fields (Table_S reads "Table S1"), references inside the document are REF fields and each orientation is a
// section. Pure: the sources are loaded by lib/package-sources.mjs and handed in. A table goes to the workbook too, one sheet each.
import { writeManuscriptDocx } from './docx-write-doc.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { DEFAULT_STYLES } from './manuscript-doc.mjs';
import { seqName, plainText } from './package.mjs';

export const PAGE_SIZES = { A4: [595, 842], Letter: [612, 792] };
const MARGIN = 72;
let n = 0;
const bid = () => `pk${(n++).toString(36)}`;
const KIND_WORD = { table: 'Table', figure: 'Figure' };

export function sourceProblems(snap, sources) {
  return snap.items.flatMap(it => { const s = sources.get(it.id); return !s ? [{ itemId: it.id, text: 'Missing source' }] : s.error ? [{ itemId: it.id, text: s.error }] : it.kind === 'document' && !Array.isArray(s.blocks) ? [{ itemId: it.id, text: 'The document could not be generated' }] : []; });
}
const sectionOf = (page, orient) => { const [w, h] = PAGE_SIZES[page.size] || PAGE_SIZES.A4; const land = orient === 'landscape'; return { pageW: land ? h : w, pageH: land ? w : h, orient: land ? 'landscape' : 'portrait', top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }; };
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
    const text = [head, title && `${title.replace(/\.?$/, '.')}`, legend].filter(Boolean).join(' ');
    return { id: capId.get(it.id), type: 'p', styleId: 'Caption', props: { after: 6 }, text, runs: [{ t: head, b: true }, { t: text.slice(head.length) }] };
  };
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
      const w = Math.min(textW * (orient === 'landscape' ? 1.4 : 1), src.image.ptW || src.image.w * 0.75 || textW), h = w * (src.image.h / src.image.w);
      blocks.push({ id: bid(), type: 'figure', img: `img-${it.id}`, name: it.title, mime: src.image.mime, w, h, props: { jc: 'center', keepNext: true }, text: '' });
      blocks.push(caption(it));
    } else {
      blocks.push({ ...caption(it), props: { after: 6, keepNext: true } });
      blocks.push({ id: bid(), type: 'table', grid: { ...src.grid, borders: src.grid.borders || 'all' }, text: '' });
      // the notes a drawing of the app carries (a Summary of findings' footnotes), then the item's own
      if (!noNotes) for (const note of [...(src.notes || []), ...(it.notes || [])]) blocks.push(para(refText(note, inPart, labelOf, id => capId.get(id)), { after: 0 }, 'Normal'));
    }
    if (i > 0 && !it.samePage) blocks[first].props = { ...blocks[first].props, pageBreakBefore: true };
  });
  if (blocks.length) { const last = blocks.at(-1); last.props = { ...last.props, section: sectionOf(page, orientNow) }; }
  const styles = structuredClone(DEFAULT_STYLES);
  styles.default.run = { font: page.font, sz: page.pt };
  styles.default.para = { after: 0, line: page.spacing };
  styles.byId.Caption.run = { b: false, sz: page.pt };
  const media = new Map(snap.items.filter(it => it.kind === 'figure').map(it => [`img-${it.id}`, { bytes: sources.get(it.id).image.bytes, mime: sources.get(it.id).image.mime }]));
  return { blocks, section: blocks.at(-1)?.props.section || sectionOf(page, page.orient), styles, media };
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
