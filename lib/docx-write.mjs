// Writing the manuscript back out as a Word document.
//
// The inverse of docx.mjs: the same paragraph properties, run properties,
// styles and section setup go back into WordprocessingML, so a file that came
// in with Times 12 at 1.5 spacing, one-inch margins and continuous line
// numbers opens in Word the same way. Citations are written as the numbers or
// author–year the chosen style produces, as superscript runs where the source
// had them; the reference list is appended as its own section. Word accepts a
// STORE-only zip, which is what zip.mjs writes.
import { zip } from './zip.mjs';
import { writeManuscriptDocx } from './docx-write-doc.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const tw = pt => Math.round(Number(pt) * 20);          // points -> twips
const hp = pt => Math.round(Number(pt) * 2);           // points -> half-points

function rPr(r, base = {}) {
  const parts = [];
  const font = r.font || base.font;
  if (r.font) parts.push(`<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`);
  if (r.b) parts.push('<w:b/>');
  if (r.i) parts.push('<w:i/>');
  if (r.u) parts.push('<w:u w:val="single"/>');
  if (r.caps) parts.push('<w:caps/>');
  if (r.color) parts.push(`<w:color w:val="${esc(String(r.color).replace('#', ''))}"/>`);
  if (r.sz) parts.push(`<w:sz w:val="${hp(r.sz)}"/><w:szCs w:val="${hp(r.sz)}"/>`);
  if (r.sup) parts.push('<w:vertAlign w:val="superscript"/>');
  if (r.sub) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function pPr(block) {
  const p = block.props || {};
  const parts = [];
  if (block.styleId) parts.push(`<w:pStyle w:val="${esc(block.styleId)}"/>`);
  if (block.semanticHeading && block.type === 'h2') parts.push('<w:outlineLvl w:val="1"/>');
  if (p.keepNext) parts.push('<w:keepNext/>');
  if (p.pageBreakBefore) parts.push('<w:pageBreakBefore/>');
  const sp = [];
  if (p.before != null) sp.push(`w:before="${tw(p.before)}"`);
  if (p.after != null) sp.push(`w:after="${tw(p.after)}"`);
  if (p.lineExact != null) sp.push(`w:line="${tw(p.lineExact)}" w:lineRule="exact"`);
  else if (p.line != null) sp.push(`w:line="${Math.round(p.line * 240)}" w:lineRule="auto"`);
  if (sp.length) parts.push(`<w:spacing ${sp.join(' ')}/>`);
  const ind = [];
  if (p.indLeft != null) ind.push(`w:left="${tw(p.indLeft)}"`);
  if (p.indRight != null) ind.push(`w:right="${tw(p.indRight)}"`);
  if (p.indHanging != null) ind.push(`w:hanging="${tw(p.indHanging)}"`);
  if (p.indFirst != null) ind.push(`w:firstLine="${tw(p.indFirst)}"`);
  if (ind.length) parts.push(`<w:ind ${ind.join(' ')}/>`);
  if (p.jc) parts.push(`<w:jc w:val="${esc(p.jc)}"/>`);
  return parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
}

const run = (text, fmt = {}) => {
  const parts = String(text).split('\n');
  return parts.map((t, i) => `<w:r>${rPr(fmt)}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
};

/**
 * document.xml for the blocks. `renderCite(keys)` returns the visible text of
 * a citation group (e.g. "1,2"); `renderResult(key)` the value of a result
 * token, or null.
 */
function documentXml(blocks, section, { renderCite, renderResult, references = [] }) {
  const paras = [];
  for (const b of blocks) {
    // A table block: rows of cells, the first row a header when asked; single
    // hairline borders, the width of the text column, cells top-aligned.
    // `borders: 'horizontal'` draws rules only (a journal's GRADE table); a cell is a string or `{ runs: [{ t, b, … }] }`; `sz` is the cell size in pt.
    if (b.type === 'table' && Array.isArray(b.rows)) {
      const cols = Math.max(1, ...b.rows.map(r => r.length));
      const w = Math.floor((b.width || 9360) / cols);   // 6.5 in of text width in twentieths of a point, or the block's own width (twips)
      const sides = b.borders === 'horizontal' ? ['top', 'bottom', 'insideH'] : ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
      const border = sides.map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`).join('');
      const sz = b.sz || 10;
      const cellRuns = (c, head) => (c && typeof c === 'object' && Array.isArray(c.runs) ? c.runs.map(r => run(String(r.t ?? ''), { ...r, b: Boolean(r.b || head), sz: r.sz || sz })).join('') : run(String(c ?? ''), { b: head, sz }));
      const rows = b.rows.map((r, ri) => `<w:tr>${b.header && ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: cols }, (_, ci) =>
        `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${cellRuns(r[ci], Boolean(b.header && ri === 0))}</w:p></w:tc>`).join('')}</w:tr>`).join('');
      paras.push(`<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>
        <w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl><w:p/>`);
      continue;
    }
    const runs = b.runs?.length ? b.runs : [{ t: b.text || '' }];
    const body = runs.map(r => {
      if (r.cite) return run(renderCite(r.cite), { sup: true });
      // result tokens inside text runs become their values
      const t = String(r.t || '').replace(/\{\{([A-Za-z0-9._-]+)\}\}/g, (m, k) => renderResult(k) ?? m)
        .replace(/\[@([^\s\]]+)(?:\s+[^\]]*)?\]/g, (m, k) => renderCite([k]));
      const { t: _t, cite: _c, ...fmt } = r;
      return run(t, fmt);
    }).join('');
    paras.push(`<w:p>${pPr(b)}${body}</w:p>`);
  }
  if (references.length) {
    paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="480" w:after="120"/></w:pPr>${run('References', { b: true })}</w:p>`);
    for (const ref of references)
      paras.push(`<w:p><w:pPr><w:ind w:left="640" w:hanging="640"/><w:spacing w:after="120"/></w:pPr>${run(ref)}</w:p>`);
  }
  const sec = section || {};
  const ln = sec.lineNumbers
    ? `<w:lnNumType w:countBy="${sec.lineNumbers.countBy || 1}" w:distance="${tw(sec.lineNumbers.distance || 18)}" w:restart="${esc(sec.lineNumbers.restart || 'newPage')}"/>`
    : '';
  const sectPr = `<w:sectPr>${ln}<w:pgSz w:w="${tw(sec.pageW || 612)}" w:h="${tw(sec.pageH || 792)}"/>
    <w:pgMar w:top="${tw(sec.top ?? 72)}" w:right="${tw(sec.right ?? 72)}" w:bottom="${tw(sec.bottom ?? 72)}" w:left="${tw(sec.left ?? 72)}" w:header="720" w:footer="720" w:gutter="0"/>
    <w:cols w:space="720"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}${sectPr}</w:body></w:document>`;
}

/** styles.xml from the stored resolved styles, or Word-like defaults. */
function stylesXml(styles) {
  const d = styles?.default || { run: { font: 'Times New Roman', sz: 12 }, para: { after: 10 } };
  const byId = styles?.byId || {};
  const styleXml = (id, st) => {
    const pp = pPr({ props: st.para || {} }).replace('<w:pPr>', '').replace('</w:pPr>', '');
    const rp = rPr(st.run || {}).replace('<w:rPr>', '').replace('</w:rPr>', '');
    return `<w:style w:type="paragraph" w:styleId="${esc(id)}"><w:name w:val="${esc(st.name || id)}"/>
      ${id !== 'Normal' ? '<w:basedOn w:val="Normal"/>' : ''}
      ${pp ? `<w:pPr>${pp}</w:pPr>` : ''}${rp ? `<w:rPr>${rp}</w:rPr>` : ''}</w:style>`;
  };
  const ids = Object.keys(byId);
  const list = ids.length ? ids.map(id => styleXml(id, byId[id])).join('')
    : [['Normal', { name: 'Normal', para: {}, run: {} }],
       ['Heading1', { name: 'heading 1', para: { before: 24, after: 0, keepNext: true }, run: { b: true, sz: 16 } }],
       ['Heading2', { name: 'heading 2', para: { before: 10, after: 0, keepNext: true }, run: { b: true, sz: 13 } }]]
      .map(([id, st]) => styleXml(id, st)).join('');
  const dr = rPr(d.run || {}).replace('<w:rPr>', '').replace('</w:rPr>', '');
  const dp = pPr({ props: d.para || {} }).replace('<w:pPr>', '').replace('</w:pPr>', '');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${dr || '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/>'}</w:rPr></w:rPrDefault>
<w:pPrDefault>${dp ? `<w:pPr>${dp}</w:pPr>` : ''}</w:pPrDefault></w:docDefaults>${list}</w:styles>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * A .docx Blob for the document. The manuscript writer (docx-write-doc.mjs,
 * plan §4.11a) writes it: lists, notes, comments, figures, merged-cell
 * tables, sections, headers and footers, tracked changes. `lists`, `notes`,
 * `comments` and `media` are optional; without them the output is the plain
 * document the earlier writer produced, with elements in schema order.
 */
export async function writeDocx({ blocks, section, styles, renderCite, renderResult, recordOf, references, lists, notes, comments, media, trackChanges }) {
  return writeManuscriptDocx({ blocks, section, styles, renderCite, renderResult, recordOf, references, lists, notes, comments, media, trackChanges });
}

// ---- table documents ----------------------------------------------------------
// A document of captioned tables on landscape pages, as a review's evidence
// tables go to a journal: one font at a set size, a shaded header row repeated
// on every page, thin black borders, cells merged down where a study's arms
// share a value, a page break between tables, notes at the end and the page
// number in the footer.
const pageNumberFooter = size => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${rPr({ sz: size })}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr({ sz: size })}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rPr({ sz: size })}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr({ sz: size })}<w:t>1</w:t></w:r><w:r>${rPr({ sz: size })}<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

function tableXml(b, font, size) {
  const border = sz => ['top', 'left', 'bottom', 'right'].map(s => `<w:${s} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`).join('');
  const lines = (text, { bold = false, keepNext = false } = {}) => String(text ?? '').split('\n').map(line =>
    `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:keepLines/><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/></w:pPr>${line ? `<w:r>${rPr({ font, sz: size, b: bold })}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>` : ''}</w:p>`).join('');
  const tc = (w, inner, { fill = null, vMerge = null } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : vMerge ? '<w:vMerge/>' : ''}<w:tcBorders>${border(4)}</w:tcBorders>${
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${esc(fill)}"/>` : ''}<w:tcMar><w:top w:w="30" w:type="dxa"/><w:left w:w="50" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tcMar><w:vAlign w:val="top"/></w:tcPr>${inner}</w:tc>`;
  const head = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${b.header.map((h, i) => tc(b.widths[i], lines(h, { bold: true }), { fill: b.headerFill || null })).join('')}</w:tr>`;
  // A cell merged down: its first row restarts the merge, the rows below continue it.
  const body = b.rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.cells.map((c, i) => c == null
    ? tc(b.widths[i], '<w:p/>', { vMerge: 'continue' })
    : tc(b.widths[i], lines(c.text, { keepNext: r.keepNext }), { vMerge: (c.span || 1) > 1 ? 'restart' : null })).join('')}</w:tr>`).join('');
  const total = b.widths.reduce((a, x) => a + x, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>
<w:tblGrid>${b.widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${body}</w:tbl>`;
}

/**
 * A .docx Blob of tables. `blocks`: `{ type: 'para', text, size, bold, after,
 * before }`, `{ type: 'table', widths (twips), header: [text], headerFill,
 * rows: [{ cells: [{ text, span } | null], keepNext }] }` (null: the cell
 * above spans into this row) and `{ type: 'pageBreak' }`. `page` is in
 * twips; `size` in points.
 */
export async function writeTablesDocx({ blocks, font = 'Arial', size = 6.5, page = { w: 16838, h: 11906, margin: 567 }, landscape = true, footerSize = 7 }) {
  const body = blocks.map(b => {
    if (b.type === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (b.type === 'table') return tableXml(b, font, size);
    return `<w:p><w:pPr><w:spacing w:before="${tw(b.before || 0)}" w:after="${tw(b.after || 0)}"/></w:pPr>${run(b.text || '', { font, sz: b.size || size, b: !!b.bold })}</w:p>`;
  }).join('');
  const m = page.margin;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="${page.w}" w:h="${page.h}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = stylesXml({ default: { run: { font, sz: size }, para: {} }, byId: { Normal: { name: 'Normal', para: {}, run: {} } } });
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES.replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>\n</Types>') },
    { name: '_rels/.rels', data: RELS },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS.replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>\n</Relationships>') },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/footer1.xml', data: pageNumberFooter(footerSize) },
  ]);
}
