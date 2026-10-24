// The manuscript's Word writer: the inverse of docx.mjs for everything the
// document editor holds (plan §4.11a).
//
// Paragraph properties (spacing, line rules, indents, alignment, list level),
// character formatting (strikethrough, small capitals, highlight, explicit
// "not bold"), tracked insertions and deletions, lists as numbering.xml,
// tables with merged cells, header rows, borders and widths, figures as
// inline pictures, footnotes, endnotes, comments, caption numbers as SEQ
// fields, a contents field, section breaks with their own page setup, and
// headers and footers with page fields. Elements are written in the order the
// WordprocessingML schema gives, which Word enforces more strictly than it
// documents.
//
// docx-write.mjs's writeDocx delegates here; its signature is unchanged, so
// every other view's Word export takes this path too. The table-document
// writer beside it (writeTablesDocx) is separate and untouched.
import { zip } from './zip.mjs';
import { captionNumbers, tocEntries } from './manuscript-doc.mjs';
import { encodeTag, citedItem } from './docx.mjs';
import { classifyStructure, isHeading } from './manuscript-structure.mjs';
import { citationContext } from './manuscript.mjs';

const esc = s => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = pt => Math.round(Number(pt) * 20);          // points -> twips
const hp = pt => Math.round(Number(pt) * 2);           // points -> half-points
const EMU = pt => Math.round(Number(pt) * 12700);
let revision = 5000;   // ids of tracked formatting changes, apart from insertions and deletions

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DRAW_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml', W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

// ---- properties -------------------------------------------------------------------

/** w:rPr in schema order. `false` is written, so a run can turn off its style's bold. */
export function rPrX(r = {}, { style } = {}) {
  const p = [];
  if (style) p.push(`<w:rStyle w:val="${esc(style)}"/>`);
  if (r.font) p.push(`<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`);
  const onOff = (tag, v) => { if (v === true) p.push(`<w:${tag}/>`); else if (v === false) p.push(`<w:${tag} w:val="0"/>`); };
  onOff('b', r.b); onOff('i', r.i); onOff('caps', r.caps); onOff('smallCaps', r.smallCaps); onOff('strike', r.strike);
  if (r.color) p.push(`<w:color w:val="${esc(String(r.color).replace('#', ''))}"/>`);
  if (r.sz) p.push(`<w:sz w:val="${hp(r.sz)}"/><w:szCs w:val="${hp(r.sz)}"/>`);
  if (r.highlight) p.push(`<w:highlight w:val="${esc(r.highlight)}"/>`);
  if (r.u === true) p.push('<w:u w:val="single"/>'); else if (r.u === false) p.push('<w:u w:val="none"/>');
  if (r.sup) p.push('<w:vertAlign w:val="superscript"/>');
  else if (r.sub) p.push('<w:vertAlign w:val="subscript"/>');
  // A tracked formatting change: what the run looked like before, last in rPr.
  if (r.fmtChange) p.push(`<w:rPrChange w:id="${revision++}" w:author="${esc(r.fmtChange.author || 'Lykos')}"${r.fmtChange.date ? ` w:date="${esc(r.fmtChange.date)}"` : ''}>${rPrX(r.fmtChange.old || {}) || '<w:rPr/>'}</w:rPrChange>`);
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
}

/** w:pPr in schema order, with the list number and a section break when the block carries them. */
export function pPrX(block, ctx = null, { inner = false } = {}) {
  const p = block.props || {};
  const parts = [];
  if (block.styleId && block.styleId !== 'Table') parts.push(`<w:pStyle w:val="${esc(block.styleId)}"/>`);
  if (p.keepNext) parts.push('<w:keepNext/>');
  if (p.pageBreakBefore) parts.push('<w:pageBreakBefore/>');
  if (p.list && ctx?.numIds?.has(p.list.id)) parts.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, p.list.level || 0))}"/><w:numId w:val="${ctx.numIds.get(p.list.id)}"/></w:numPr>`);
  const sp = [];
  if (p.before != null) sp.push(`w:before="${tw(p.before)}"`);
  if (p.after != null) sp.push(`w:after="${tw(p.after)}"`);
  if (p.lineExact != null) sp.push(`w:line="${tw(p.lineExact)}" w:lineRule="exact"`);
  else if (p.lineAtLeast != null) sp.push(`w:line="${tw(p.lineAtLeast)}" w:lineRule="atLeast"`);
  else if (p.line != null) sp.push(`w:line="${Math.round(p.line * 240)}" w:lineRule="auto"`);
  if (sp.length) parts.push(`<w:spacing ${sp.join(' ')}/>`);
  const ind = [];
  if (p.indLeft != null) ind.push(`w:left="${tw(p.indLeft)}"`);
  if (p.indRight != null) ind.push(`w:right="${tw(p.indRight)}"`);
  if (p.indHanging != null) ind.push(`w:hanging="${tw(p.indHanging)}"`);
  else if (p.indFirst != null) ind.push(`w:firstLine="${tw(p.indFirst)}"`);
  if (ind.length) parts.push(`<w:ind ${ind.join(' ')}/>`);
  if (p.jc) parts.push(`<w:jc w:val="${esc(p.jc)}"/>`);
  const outline = p.outline ?? (block.semanticHeading && block.type === 'h2' ? 1 : null);
  if (outline != null) parts.push(`<w:outlineLvl w:val="${outline}"/>`);
  // A tracked paragraph mark (a split or a join made while tracking) is the mark's own rPr.
  const mark = [['markIns', 'ins'], ['markDel', 'del']].filter(([k]) => p[k]).map(([k, tag]) =>
    `<w:${tag} w:id="${ctx ? ctx.ann++ : revision++}" w:author="${esc(p[k].author || 'Lykos')}"${p[k].date ? ` w:date="${esc(p[k].date)}"` : ''}/>`).join('');
  if (mark && !inner) parts.push(`<w:rPr>${mark}</w:rPr>`);
  if (!inner && p.section && ctx) parts.push(sectPrX(p.section, ctx));
  return parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
}

/** A section's w:sectPr: header and footer, page size and orientation, margins, line numbers. */
export function sectPrX(sec = {}, ctx = null) {
  const s = { pageW: 612, pageH: 792, top: 72, right: 72, bottom: 72, left: 72, ...sec };
  // Each header and footer the section defines, by kind; null writes an empty part (a blank first page).
  const refs = [];
  if (ctx?.hfPart) for (const [kind, tag] of [['header', 'headerReference'], ['footer', 'footerReference']])
    for (const [suffix, type] of [['', 'default'], ['First', 'first'], ['Even', 'even']])
      if (`${kind}${suffix}` in s) refs.push(`<w:${tag} w:type="${type}" r:id="${ctx.hfPart(kind, s[`${kind}${suffix}`])}"/>`);
  const landscape = s.orient === 'landscape' || s.pageW > s.pageH;
  const ln = s.lineNumbers
    ? `<w:lnNumType w:countBy="${s.lineNumbers.countBy || 1}" w:distance="${tw(s.lineNumbers.distance || 18)}" w:restart="${esc(s.lineNumbers.restart || 'newPage')}"/>` : '';
  return `<w:sectPr>${refs.join('')}${s.breakType ? `<w:type w:val="${esc(s.breakType)}"/>` : ''}<w:pgSz w:w="${tw(s.pageW)}" w:h="${tw(s.pageH)}"${landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${tw(s.top)}" w:right="${tw(s.right)}" w:bottom="${tw(s.bottom)}" w:left="${tw(s.left)}" w:header="${tw(s.headerDist ?? 36)}" w:footer="${tw(s.footerDist ?? 36)}" w:gutter="0"/>${ln}<w:cols w:space="720"/>${s.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
}

// ---- runs --------------------------------------------------------------------------

/** Plain text as runs: tabs and line breaks as their elements. */
function textRuns(text, fmt, { del = false } = {}) {
  if (text === '') return '';
  const t = del ? 'w:delText' : 'w:t';
  const inner = String(text).split(/(\t|\n)/).filter(x => x !== '').map(x => x === '\t' ? '<w:tab/>' : x === '\n' ? '<w:br/>' : `<${t} xml:space="preserve">${esc(x)}</${t}>`).join('');
  return `<w:r>${rPrX(fmt)}${inner}</w:r>`;
}
const field = (instr, shown, fmt) => `<w:r>${rPrX(fmt)}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPrX(fmt)}<w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText></w:r><w:r>${rPrX(fmt)}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPrX(fmt)}<w:t>${esc(shown)}</w:t></w:r><w:r>${rPrX(fmt)}<w:fldChar w:fldCharType="end"/></w:r>`;
// A document token (m[1]), a result (m[2]) or an inline citation (m[3]).
const LINK_TOKEN = /\{\{(?:(fn:[A-Za-z0-9._-]+|seq:[A-Za-z0-9._-]+|xref:[A-Za-z0-9._-]+|cm:[A-Za-z0-9._-]+|page|pages)|([A-Za-z0-9._:-]+))\}\}|\[@([^\s\]]+)(?:\s+[^\]]*)?\]/g;
/** Runs inside a content control tagged for this app. */
const sdtX = (tag, inner) => inner ? `<w:sdt><w:sdtPr><w:tag w:val="${esc(tag)}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>` : '';

/** The runs of a paragraph (or cell, or note) as WordprocessingML. */
function runsX(runs, ctx, block = null, { comments = true, deletedContent = false } = {}) {
  let seqAt = 0;
  // A cross-reference target carries a bookmark from its start to its caption number (or its end).
  const bm = block && !ctx.scan ? ctx.bookmarkFor.get(block.id) : null;
  let bmOpen = !!bm;
  const closeBm = () => { if (!bmOpen) return ''; bmOpen = false; return `<w:bookmarkEnd w:id="${bm.id}"/>`; };
  const body = (runs || []).map(r => {
    // Comment ranges: a comment starts before the first run it covers and ends, with its reference, after the last.
    const idx = ctx.runIdx++;
    let pre = '', post = '';
    for (const id of comments ? r.cm || [] : []) {
      if (ctx.scan) { ctx.useComment(id); const sp = ctx.cmSpan.get(id) || { first: idx }; sp.last = idx; ctx.cmSpan.set(id, sp); continue; }
      const sp = ctx.cmSpan.get(id), group = ctx.commentGroup(id);
      if (!sp || !group.length) continue;
      if (sp.first === idx) pre += group.map(n => `<w:commentRangeStart w:id="${n}"/>`).join('');
      if (sp.last === idx) post += group.map(n => `<w:commentRangeEnd w:id="${n}"/><w:r>${rPrX({})}<w:commentReference w:id="${n}"/></w:r>`).join('');
    }
    return pre + runX(r) + post;
  }).join('');
  return bm ? `<w:bookmarkStart w:id="${bm.id}" w:name="${bm.name}"/>${body}${closeBm()}` : body;

  // A citation: its text inside a content control that names the works, so it reads back as a citation.
  function citeX(keys, fmt) {
    const items = ctx.recordOf ? keys.map(k => ctx.recordOf(k)).filter(Boolean).map(citedItem) : [];
    return sdtX(encodeTag('LYKOS_CITATION', { keys, ...(items.length ? { items } : {}) }), textRuns(ctx.renderCite(keys), fmt));
  }
  function runX(r) {
    // Atomic citations follow trackDeleteRuns: a deleted citation goes rather
    // than being revived as an active reference in Word's citation control.
    if (r.cite) return r.del || deletedContent ? '' : citeX(r.cite, { sup: true });
    const { t = '', cite, ins, del, cm, ...fmt } = r;
    let out;
    // A deleted row/cell can still contain an earlier tracked insertion.
    // Keep that revision intact, but do not resolve its text into live links.
    if (del || deletedContent) out = textRuns(t, fmt, { del: Boolean(del) });
    else {
      // Results and inline citations become their text inside the app's content
      // controls, so they read back as links; the document's own tokens become
      // fields and references.
      const shown = String(t);
      let at = 0; const parts = [];
      for (const m of shown.matchAll(LINK_TOKEN)) {
        parts.push(textRuns(shown.slice(at, m.index), fmt));
        at = m.index + m[0].length;
        if (m[3]) { parts.push(citeX([m[3]], fmt)); continue; }
        if (!m[1]) {
          const value = ctx.renderResult(m[2]);
          parts.push(value == null ? textRuns(m[0], fmt) : sdtX(`LYKOS_RESULT_v1_${m[2]}`, textRuns(String(value), fmt)));
          continue;
        }
        const [kind, id] = m[1].includes(':') ? [m[1].slice(0, m[1].indexOf(':')), m[1].slice(m[1].indexOf(':') + 1)] : [m[1], ''];
        if (kind === 'fn') {
          const n = ctx.noteIds.get(id);
          if (n) parts.push(`<w:r>${rPrX({ ...fmt, sup: true, sub: false })}<w:${n.kind}Reference w:id="${n.wid}"/></w:r>`);
        } else if (kind === 'seq') {
          const nums = block ? ctx.captions.perBlock.get(block.id) || [] : [];
          parts.push(field(`SEQ ${id} \\* ARABIC`, String(nums[seqAt++] ?? 1), fmt), closeBm());
        } else if (kind === 'xref') {
          // A live cross-reference: Word's REF field to the target's bookmark, showing its current label.
          if (ctx.scan) { ctx.xrefTargets.add(id); continue; }
          const target = ctx.bookmarkFor.get(id), label = ctx.labelOf(id);
          parts.push(target ? field(`REF ${target.name} \\h`, label, fmt) : textRuns(label, fmt));
        }
        else if (kind === 'page') parts.push(field('PAGE', '1', fmt));
        else if (kind === 'pages') parts.push(field('NUMPAGES', '1', fmt));
        else if (kind === 'cm') {
          if (ctx.scan) { ctx.useComment(id); continue; }
          // A comment on no text: its range is empty, at this point.
          for (const n of ctx.commentGroup(id)) parts.push(`<w:commentRangeStart w:id="${n}"/><w:commentRangeEnd w:id="${n}"/><w:r><w:commentReference w:id="${n}"/></w:r>`);
        }
      }
      parts.push(textRuns(shown.slice(at), fmt));
      out = parts.join('');
    }
    if (ins) return out ? `<w:ins w:id="${ctx.ann++}" w:author="${esc(ins.author || 'Lykos')}"${ins.date ? ` w:date="${esc(ins.date)}"` : ''}>${out}</w:ins>` : '';
    if (del) return out ? `<w:del w:id="${ctx.ann++}" w:author="${esc(del.author || 'Lykos')}"${del.date ? ` w:date="${esc(del.date)}"` : ''}>${out}</w:del>` : '';
    return out;
  }
}

/** The reference list, one paragraph per entry, in a content control that reads back as the list. */
function bibX(lines) {
  const paras = lines.map(ref => `<w:p><w:pPr><w:ind w:left="640" w:hanging="640"/><w:spacing w:after="120"/></w:pPr>${textRuns(ref, {})}</w:p>`).join('');
  return `<w:sdt><w:sdtPr><w:tag w:val="LYKOS_BIBLIOGRAPHY"/></w:sdtPr><w:sdtContent>${paras || '<w:p/>'}</w:sdtContent></w:sdt>`;
}

/** Runs split at line breaks into paragraphs: a cell's or a note's paragraphs. */
function splitLines(runs) {
  const out = [[]];
  for (const r of runs || []) {
    if (r.cite || r.del || !String(r.t || '').includes('\n')) { out.at(-1).push(r); continue; }
    String(r.t).split('\n').forEach((piece, k) => { if (k) out.push([]); if (piece) out.at(-1).push({ ...r, t: piece }); });
  }
  return out;
}

// ---- blocks -------------------------------------------------------------------------

const BORDER = (sides, sz = 4) => sides.map(s => `<w:${s} w:val="single" w:sz="${sz}" w:space="0" w:color="auto"/>`).join('');
const NIL = sides => sides.map(s => `<w:${s} w:val="nil"/>`).join('');

/** A table block's w:tbl: grid widths, merged cells as gridSpan and vMerge, header rows repeated. */
function tableX(b, ctx) {
  const g = b.grid;
  const widths = g.cols.map(w => tw(w));
  const total = widths.reduce((a, x) => a + x, 0);
  const borders = g.borders === 'none' ? NIL(['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
    : g.borders === 'apa' ? BORDER(['top', 'bottom'], 8) + NIL(['left', 'right', 'insideH', 'insideV'])
    : g.borders === 'horizontal' ? BORDER(['top', 'bottom', 'insideH']) + NIL(['left', 'right', 'insideV'])   // rules only, as a journal's GRADE table
    : BORDER(['top', 'left', 'bottom', 'right', 'insideH', 'insideV']);
  const rows = g.rows.map((row, r) => {
    const cells = [];
    for (let c = 0; c < row.cells.length; c++) {
      const slot = row.cells[c];
      if (slot.merged === 'left') continue;
      let span = 1; while (row.cells[c + span]?.merged === 'left') span++;
      const w = widths.slice(c, c + span).reduce((a, x) => a + x, 0);
      const below = g.rows[r + 1]?.cells[c]?.merged === 'up';
      const vMerge = slot.merged === 'up' ? '<w:vMerge/>' : below ? '<w:vMerge w:val="restart"/>' : '';
      const headRule = g.borders === 'apa' && row.header && !g.rows[r + 1]?.header ? `<w:tcBorders>${BORDER(['bottom'], 4)}</w:tcBorders>` : '';
      const shd = slot.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${esc(slot.shade.replace('#', ''))}"/>` : '';
      const va = slot.valign ? `<w:vAlign w:val="${esc(slot.valign)}"/>` : '';
      // A column inserted or deleted while tracking: Word's cell revision marks, after vAlign in tcPr.
      const cellMark = slot.cellIns ? revX('cellIns', slot.cellIns, ctx) : slot.cellDel ? revX('cellDel', slot.cellDel, ctx) : '';
      const pr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${vMerge}${headRule}${shd}${va}${cellMark}</w:tcPr>`;
      if (slot.merged === 'up') { cells.push(`<w:tc>${pr}<w:p/></w:tc>`); continue; }
      // The text of a tracked row or column is inserted or deleted with it, so Word shows it so.
      const mark = row.del || slot.cellDel ? { del: row.del || slot.cellDel } : row.ins || slot.cellIns ? { ins: row.ins || slot.cellIns } : null;
      // `g.sz`: the table's own type size (pt), on every run that does not set one
      const runs = markRuns((slot.runs?.length ? slot.runs : [{ t: slot.text || '' }]).map(r => (g.sz && r.sz == null ? { ...r, sz: g.sz } : r)), mark);
      const paras = splitLines(runs).map(rs =>
        `<w:p>${pPrX({ props: { ...(g.line ? { line: g.line } : {}), ...(slot.props || {}), ...(row.keepNext ? { keepNext: true } : {}) } }, ctx, { inner: true })}${runsX(rs, ctx, null, { deletedContent: Boolean(row.del || slot.cellDel) })}</w:p>`);
      cells.push(`<w:tc>${pr}${paras.join('') || '<w:p/>'}</w:tc>`);
    }
    // Row properties in schema order: tblHeader, then the row's own insertion or deletion.
    // `g.keepRows`: a row is never split across pages (w:cantSplit, before w:tblHeader in schema order)
    const trPr = `${g.keepRows ? '<w:cantSplit/>' : ''}${row.header ? '<w:tblHeader/>' : ''}${row.ins ? revX('ins', row.ins, ctx) : ''}${row.del ? revX('del', row.del, ctx) : ''}`;
    return `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
  });
  const jc = g.jc ? `<w:jc w:val="${esc(g.jc)}"/>` : '';
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${jc}<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>${g.cellMargin ? `<w:top w:w="${tw(g.cellMargin[0])}" w:type="dxa"/>` : ''}<w:left w:w="${g.cellMargin ? tw(g.cellMargin[1]) : 80}" w:type="dxa"/>${g.cellMargin ? `<w:bottom w:w="${tw(g.cellMargin[0])}" w:type="dxa"/>` : ''}<w:right w:w="${g.cellMargin ? tw(g.cellMargin[1]) : 80}" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/** A revision mark element (w:ins, w:del, w:cellIns, w:cellDel) with its author and date. */
const revX = (tag, m, ctx) => `<w:${tag} w:id="${ctx ? ctx.ann++ : revision++}" w:author="${esc(m.author || 'Lykos')}"${m.date ? ` w:date="${esc(m.date)}"` : ''}/>`;

/** The runs of a tracked row or column, marked as its insertion or deletion; a run already deleted keeps its own mark. */
function markRuns(runs, mark) {
  if (!mark) return runs;
  return runs.map(r => {
    // A run already inserted or deleted keeps its own mark; the row's or column's stands for the rest.
    if (r.del || r.ins || r.cite || !r.t) return r;
    return mark.del ? { ...r, del: mark.del } : { ...r, ins: mark.ins };
  });
}

/** A figure block: its picture inline in a paragraph of its own. */
function figureX(b, ctx, { inner = false } = {}) {
  const m = ctx.media.get(b.img);
  if (!m) return `<w:p>${pPrX(b, ctx, { inner })}</w:p>`;
  const rid = ctx.rel('image', `media/${m.file}`);
  const id = ctx.docPr++;
  const cx = EMU(b.w || 300), cy = EMU(b.h || 200);
  const name = esc(b.name || `Figure ${id}`);
  return `<w:p>${pPrX(b, ctx, { inner })}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"${m.svgFile ? `><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${ctx.rel('image', `media/${m.svgFile}`)}"/></a:ext></a:extLst></a:blip>` : '/>'}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** A contents block: Word's TOC field, its cached result the headings as they stand. */
function tocX(blocks) {
  const entries = tocEntries(blocks);
  const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  if (!entries.length) return `<w:p>${begin}${end}</w:p>`;
  return entries.map((e, k) => `<w:p><w:pPr><w:pStyle w:val="TOC${e.level}"/><w:ind w:left="${(e.level - 1) * 240}"/></w:pPr>${k === 0 ? begin : ''}${textRuns(e.text, {})}${k === entries.length - 1 ? end : ''}</w:p>`).join('');
}

// ---- parts ------------------------------------------------------------------------------

function numberingX(lists, ids) {
  const abs = [], nums = [];
  [...ids].forEach(([id, numId], k) => {
    const def = lists[id] || { levels: [] };
    const lvls = Array.from({ length: 9 }, (_, i) => {
      const l = def.levels?.[i] || { fmt: 'decimal', text: `%${i + 1}.`, start: 1 };
      const left = l.indLeft ?? 36 * (i + 1), hang = l.indHanging ?? 18;
      return `<w:lvl w:ilvl="${i}"><w:start w:val="${l.start ?? 1}"/><w:numFmt w:val="${esc(l.fmt || 'decimal')}"/><w:lvlText w:val="${esc(l.text ?? '')}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${tw(left)}" w:hanging="${tw(hang)}"/></w:pPr></w:lvl>`;
    });
    abs.push(`<w:abstractNum w:abstractNumId="${k}"><w:multiLevelType w:val="multilevel"/>${lvls.join('')}</w:abstractNum>`);
    nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${k}"/></w:num>`);
  });
  return `${XML}<w:numbering ${NS}>${abs.join('')}${nums.join('')}</w:numbering>`;
}

function notesX(kind, list, ctx) {
  const sep = `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  const body = list.map(({ wid, note }) => {
    const paras = splitLines(note.runs?.length ? note.runs : [{ t: note.text || '' }]);
    return `<w:${kind} w:id="${wid}">${paras.map((rs, k) => `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${k === 0 ? `<w:r>${rPrX({ sup: true })}<w:${kind}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` : ''}${runsX(rs, ctx, null, { comments: false })}</w:p>`).join('')}</w:${kind}>`;
  }).join('');
  return `${XML}<w:${kind}s ${NS}>${sep}${body}</w:${kind}s>`;
}

function hdrFtrX(tag, part, ctx) {
  // A part with pictures or tables is written from its blocks, by the body's own writers; it ends with a paragraph, as Word requires.
  if (part?.blocks?.length) {
    const body = part.blocks.map(b => b.type === 'table' && b.grid ? tableX(b, ctx) : b.type === 'figure' ? figureX(b, ctx, { inner: true })
      : `<w:p>${pPrX(b, ctx, { inner: true })}${runsX(b.runs?.length ? b.runs : [{ t: b.text || '' }], ctx, null, { comments: false })}</w:p>`);
    if (part.blocks.at(-1).type === 'table') body.push('<w:p/>');
    return `${XML}<w:${tag} ${NS} ${DRAW_NS}>${body.join('')}</w:${tag}>`;
  }
  const lines = String(part?.text || '').split('\n');
  return `${XML}<w:${tag} ${NS}>${lines.map(line => `<w:p>${pPrX({ props: { after: 0, ...(part?.jc ? { jc: part.jc } : {}) } }, ctx, { inner: true })}${runsX([{ t: line }], ctx, null, { comments: false })}</w:p>`).join('')}</w:${tag}>`;
}

/** Every header and footer part the sections name, for the pictures they hold. */
export function headerFooterParts(sections) {
  const out = [];
  for (const sec of sections) for (const kind of ['header', 'footer']) for (const suffix of ['', 'First', 'Even'])
    if (sec?.[`${kind}${suffix}`]) out.push(sec[`${kind}${suffix}`]);
  return out;
}

/** styles.xml from the stored resolved styles, with each style's own type. */
function stylesX(styles) {
  const d = styles?.default || { run: { font: 'Times New Roman', sz: 12 }, para: { after: 10 } };
  const byId = styles?.byId || {};
  const body = (st, type) => {
    const pp = type === 'paragraph' ? pPrX({ props: st.para || {} }, null, { inner: true }) : '';
    const rp = type !== 'numbering' ? rPrX(st.run || {}) : '';
    return `${pp}${rp}`;
  };
  const list = Object.keys(byId).length ? Object.entries(byId) : [
    ['Normal', { name: 'Normal', para: {}, run: {} }],
    ['Heading1', { name: 'heading 1', para: { before: 24, after: 0, keepNext: true, outline: 0 }, run: { b: true, sz: 16 } }],
    ['Heading2', { name: 'heading 2', para: { before: 10, after: 0, keepNext: true, outline: 1 }, run: { b: true, sz: 13 } }]];
  const xml = list.filter(([, st]) => (st.type || 'paragraph') !== 'numbering').map(([id, st]) => {
    const type = ['character', 'table'].includes(st.type) ? st.type : 'paragraph';
    return `<w:style w:type="${type}" w:styleId="${esc(id)}"${id === 'Normal' ? ' w:default="1"' : ''}><w:name w:val="${esc(st.name || id)}"/>` +
      `${id !== 'Normal' && type === 'paragraph' ? '<w:basedOn w:val="Normal"/>' : ''}${type === 'paragraph' ? '<w:qFormat/>' : ''}${type === 'table' ? '' : body(st, type)}</w:style>`;
  }).join('');
  const dr = rPrX(d.run || {}).replace(/^<w:rPr>|<\/w:rPr>$/g, '');
  const dp = pPrX({ props: d.para || {} }, null, { inner: true }).replace(/^<w:pPr>|<\/w:pPr>$/g, '');
  return `${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${dr || '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/>'}</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault>${dp ? `<w:pPr>${dp}</w:pPr>` : ''}</w:pPrDefault></w:docDefaults>${xml}</w:styles>`;
}

const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/svg+xml': 'svg', 'image/emf': 'emf', 'image/wmf': 'wmf' };

/**
 * The parts of a .docx for the document, as zip entries. Blocks and options
 * as writeDocx takes them, plus `lists`, `notes`, `comments` and `media`
 * (image id -> { bytes, mime }); a section may carry `header` and `footer`
 * ({ text, jc }, with {{page}} and {{pages}}).
 */
export function manuscriptParts({ blocks = [], section, styles, renderCite = () => '', renderResult = () => null, recordOf = null, references = [], lists = {}, notes = {}, comments = {}, media = null, trackChanges = false }) {
  const rels = [];
  const rel = (type, target, base = REL) => {
    const found = rels.find(r => r.type === type && r.target === target);
    if (found) return found.id;
    const id = `rId${rels.length + 10}`; rels.push({ id, type, target, base }); return id;
  };
  revision = 5000;
  const captions = captionNumbers(blocks);
  const blockText = new Map(blocks.filter(b => b.text != null).map(b => [b.id, String(b.text).replace(/\{\{[^}]*\}\}|\[@[^\]]*\]/g, '').trim()]));
  const ctx = { renderCite, renderResult, recordOf, captions, ann: 1000, docPr: 1, rel, media: new Map(), numIds: new Map(), noteIds: new Map(), commentIds: new Map(),
    runIdx: 0, scan: true, cmSpan: new Map(), xrefTargets: new Set(), bookmarkFor: new Map(),
    labelOf: id => captions.label.get(id) || blockText.get(id) || '' };

  // Comments in order of use, each with its replies numbered after it.
  const commentList = [];
  ctx.useComment = id => {
    if (!comments[id] || ctx.commentIds.has(id)) return;
    const add = cid => { ctx.commentIds.set(cid, commentList.length); commentList.push({ id: cid, ...comments[cid] }); };
    add(id);
    for (const [rid, c] of Object.entries(comments)) if (c.parent === id && !ctx.commentIds.has(rid)) add(rid);
  };
  ctx.commentGroup = id => [id, ...Object.entries(comments).filter(([, c]) => c.parent === id).map(([rid]) => rid)].map(x => ctx.commentIds.get(x)).filter(n => n != null);

  // Headers and footers: one part per distinct content and kind.
  const hfParts = [];
  ctx.hfPart = (kind, value) => {
    const key = JSON.stringify([kind, value?.text || '', value?.jc || '', value?.blocks || null]);
    let p = hfParts.find(x => x.key === key);
    if (!p) { p = { key, kind, value, name: `${kind}${hfParts.filter(x => x.kind === kind).length + 1}.xml` }; hfParts.push(p); }
    return rel(kind, p.name);
  };

  // Lists, notes and comments that the text uses, numbered in order of use.
  for (const b of blocks) if (b.props?.list && !ctx.numIds.has(b.props.list.id)) ctx.numIds.set(b.props.list.id, ctx.numIds.size + 1);
  const noteList = { footnote: [], endnote: [] };
  for (const { id, note } of citationContext(blocks, { notes }).usedNotes) {
    const kind = note.kind === 'endnote' ? 'endnote' : 'footnote';
    const wid = noteList[kind].length + 1;
    ctx.noteIds.set(id, { kind, wid }); noteList[kind].push({ wid, note });
  }
  const files = [];
  let imageN = 0;
  // Pictures in the body and in the headers and footers of every section.
  const sectionList = [...blocks.filter(b => b.props?.section).map(b => b.props.section), section || {}];
  const hfBlocks = headerFooterParts(sectionList).flatMap(p => p.blocks || []);
  for (const b of [...blocks, ...hfBlocks]) if (b.type === 'figure' && media?.get?.(b.img) && !ctx.media.has(b.img)) {
    const m = media.get(b.img);
    const file = `image${++imageN}.${IMG_EXT[m.mime] || 'png'}`;
    // a drawing the app made goes in as SVG too (Word 2016 and later show it, vector; the picture is the fallback of older readers)
    const svgFile = m.svg ? `image${++imageN}.svg` : null;
    ctx.media.set(b.img, { ...m, file, svgFile });
    files.push({ name: `word/media/${file}`, data: m.bytes });
    if (svgFile) files.push({ name: `word/media/${svgFile}`, data: m.svg });
  }
  const sec = section || {};

  const buildBody = () => {
    const body = [];
    blocks.forEach((b, k) => {
      if (b.type === 'table' && b.grid) {
        body.push(tableX(b, ctx));
        // Word needs a paragraph between a table and whatever follows it.
        if (!blocks[k + 1] || blocks[k + 1].type === 'table' || blocks[k + 1].type === 'figure') body.push('<w:p/>');
        return;
      }
      if (b.type === 'table' && Array.isArray(b.rows)) {
        // The simple table other views export: rows of strings, the first a header when asked. A cell may be `{ runs }` (a bold judgement, its
        // explanation after a newline); `borders` 'horizontal' draws rules only; `sz` is the cell size in pt and `width` the table's in pt.
        const cols = Math.max(1, ...b.rows.map(r => r.length)), sz = b.sz || 10;
        const w = Math.round((b.width || 468) / cols);
        const cell = (c, head) => (c && typeof c === 'object' && Array.isArray(c.runs) ? c.runs.map(r => ({ ...r, t: String(r.t ?? ''), sz: r.sz || sz, ...(head ? { b: true } : {}) })) : [{ t: String(c ?? ''), sz, ...(head ? { b: true } : {}) }]);
        body.push(tableX({ grid: { cols: Array(cols).fill(w), borders: b.borders || 'all', rows: b.rows.map((r, ri) => ({ header: Boolean(b.header && ri === 0),
          cells: Array.from({ length: cols }, (_, ci) => ({ runs: cell(r[ci], Boolean(b.header && ri === 0)) })) })) } }, ctx), '<w:p/>');
        return;
      }
      if (b.type === 'figure') { body.push(figureX(b, ctx)); return; }
      if (b.type === 'toc') { body.push(tocX(blocks)); return; }
      if (b.type === 'bib') { body.push(bibX(references.length ? references : b.lines || [])); return; }
      const runs = b.runs?.length ? b.runs : [{ t: b.text || '' }];
      body.push(`<w:p>${pPrX(b, ctx)}${runsX(runs, ctx, b)}</w:p>`);
      if (k === refsAfter) body.push(bibX(references));
    });
    // With no list of its own and no References heading, the list goes at the end under one.
    if (references.length && !hasBib && refsAfter < 0) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="480" w:after="120"/></w:pPr>${textRuns('References', { b: true })}</w:p>`);
      body.push(bibX(references));
    }
    return body.join('');
  };
  // The reference list stands where the document keeps it: its own list block,
  // else under its References heading, else at the end.
  const hasBib = blocks.some(b => b.type === 'bib');
  const roles = hasBib || !references.length ? [] : classifyStructure(blocks);
  const refsAfter = roles.findIndex((r, i) => r === 'references' && isHeading(blocks[i]));
  // Two passes over the same runs: the first finds where each comment starts
  // and ends and which paragraphs are cross-referenced, the second writes.
  buildBody();
  let bmN = 0;
  for (const id of ctx.xrefTargets) if (blockText.has(id)) ctx.bookmarkFor.set(id, { id: 900 + bmN, name: `_Ref${String(100000000 + bmN++)}` });
  Object.assign(ctx, { scan: false, runIdx: 0, ann: 1000, docPr: 1 });
  revision = 5000;
  const documentXml = `${XML}<w:document ${NS} ${DRAW_NS}><w:body>${buildBody()}${sectPrX(sec, ctx)}</w:body></w:document>`;

  const parts = [];
  const overrides = [['/word/document.xml', `${CT}.document.main+xml`], ['/word/styles.xml', `${CT}.styles+xml`]];
  rel('styles', 'styles.xml');
  if (ctx.numIds.size) { rel('numbering', 'numbering.xml'); overrides.push(['/word/numbering.xml', `${CT}.numbering+xml`]); parts.push({ name: 'word/numbering.xml', data: numberingX(lists, ctx.numIds) }); }
  for (const kind of ['footnote', 'endnote']) if (noteList[kind].length) {
    rel(`${kind}s`, `${kind}s.xml`); overrides.push([`/word/${kind}s.xml`, `${CT}.${kind}s+xml`]);
    parts.push({ name: `word/${kind}s.xml`, data: notesX(kind, noteList[kind], ctx) });
  }
  if (commentList.length) {
    // Each comment's paragraph has a paraId; commentsExtended ties a reply to its parent's.
    const paraId = n => (0x10000000 + n * 7919).toString(16).toUpperCase().padStart(8, '0');
    rel('comments', 'comments.xml'); overrides.push(['/word/comments.xml', `${CT}.comments+xml`]);
    parts.push({ name: 'word/comments.xml', data: `${XML}<w:comments ${NS} xmlns:w14="${W14}">${commentList.map((c, n) => `<w:comment w:id="${n}" w:author="${esc(c.author || 'Lykos')}"${c.date ? ` w:date="${esc(c.date)}"` : ''} w:initials="${esc(c.initials || '')}"><w:p w14:paraId="${paraId(n)}"><w:r><w:annotationRef/></w:r>${textRuns(c.text || '', {})}</w:p></w:comment>`).join('')}</w:comments>` });
    rel('commentsExtended', 'commentsExtended.xml', 'http://schemas.microsoft.com/office/2011/relationships');
    overrides.push(['/word/commentsExtended.xml', `${CT}.commentsExtended+xml`]);
    parts.push({ name: 'word/commentsExtended.xml', data: `${XML}<w15:commentsEx xmlns:w15="${W15}">${commentList.map((c, n) => `<w15:commentEx w15:paraId="${paraId(n)}"${c.parent && ctx.commentIds.has(c.parent) ? ` w15:paraIdParent="${paraId(ctx.commentIds.get(c.parent))}"` : ''} w15:done="${c.done ? 1 : 0}"/>`).join('')}</w15:commentsEx>` });
  }
  for (const p of hfParts) {
    overrides.push([`/word/${p.name}`, `${CT}.${p.kind}+xml`]);
    // A part's pictures are its own relationships, in word/_rels/<part>.rels.
    const own = [], docRel = ctx.rel;
    ctx.rel = (type, target) => { const found = own.find(r => r.type === type && r.target === target); if (found) return found.id; const id = `rId${own.length + 1}`; own.push({ id, type, target }); return id; };
    parts.push({ name: `word/${p.name}`, data: hdrFtrX(p.kind === 'header' ? 'hdr' : 'ftr', p.value, ctx) });
    ctx.rel = docRel;
    if (own.length) parts.push({ name: `word/_rels/${p.name}.rels`, data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${own.map(r => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>` });
  }
  const toc = blocks.some(b => b.type === 'toc');
  if (toc || noteList.footnote.length || noteList.endnote.length || sec.evenOdd || trackChanges) {
    rel('settings', 'settings.xml'); overrides.push(['/word/settings.xml', `${CT}.settings+xml`]);
    // Settings in schema order: trackRevisions, evenAndOddHeaders, updateFields, footnotePr, endnotePr.
    parts.push({ name: 'word/settings.xml', data: `${XML}<w:settings ${NS}>${trackChanges ? '<w:trackRevisions/>' : ''}${sec.evenOdd ? '<w:evenAndOddHeaders/>' : ''}${toc ? '<w:updateFields w:val="true"/>' : ''}${noteList.footnote.length ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}${noteList.endnote.length ? '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>' : ''}</w:settings>` });
  }
  const exts = [...new Set(files.map(f => f.name.split('.').pop()))];
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    exts.map(e => `<Default Extension="${e}" ContentType="${Object.entries(IMG_EXT).find(([, x]) => x === e)?.[0] || 'application/octet-stream'}"/>`).join('') +
    overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') + '</Types>';
  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(r => `<Relationship Id="${r.id}" Type="${r.base}/${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>`;
  return [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesX(styles) },
    ...parts, ...files,
  ];
}

/** The document as a .docx Blob. */
export const writeManuscriptDocx = opts => zip(manuscriptParts(opts));
