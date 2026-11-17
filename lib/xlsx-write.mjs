// A workbook from rows: sheets of text, numbers and dates, a bold filterable header
// row frozen at the top, and column widths from the content. No formulas, so
// what is written is exactly what the review holds, and xlsx-read.mjs reads it
// back unchanged. No dependency: the parts are small XML strings zipped by
// zip.mjs.
//
// A sheet may also be laid out as a publication table (the evidence table a
// review team keeps by hand): `merges` ("A7:A8"), a style per cell from
// `styleOf(row, col)` — 'head', 'body', 'number', 'noteHead', 'note',
// 'plain', or 'include' / 'uncertain' / 'exclude' (a body cell filled green, yellow or red) — fixed `widths` and `heights`, `freeze` ({ x, y } panes), `filter`
// (the autofilter range), and `landscape` with the header row repeated on
// every printed page. `styleOf` may also give `{ fill: 'C6EFCE', bold?: true }`: a bordered, wrapped cell in that colour (a judgement's
// colour in a risk-of-bias workbook), its format made on demand. `writeXlsx(sheets, { font, size })` sets the workbook's font.
import { zip } from './zip.mjs';
import { isoToSerial } from './xlsx-read.mjs';

const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // characters XML 1.0 does not allow, which Excel refuses to open
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const colName = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
// Sheet names: 31 characters, none of []:*?/\ , unique in the workbook.
export function sheetName(name, taken = new Set()) {
  let base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = base, i = 2;
  while (taken.has(n.toLowerCase())) { const suffix = ` ${i++}`; n = base.slice(0, 31 - suffix.length) + suffix; }
  taken.add(n.toLowerCase());
  return n;
}

// Cell formats, by the index each has in STYLES' cellXfs.
// include, uncertain and exclude are body cells filled green, yellow and red: a screening decision's colour convention (92D050, FFFF00, FF0000).
const XF = { head: 3, body: 4, number: 5, noteHead: 6, note: 7, plain: 8, date: 9, datetime: 10, include: 11, uncertain: 12, exclude: 13 };
const filterOf = s => s.filter !== undefined ? s.filter : (s.rows.length > 1 && width(s.rows) ? `A1:${colName(Math.max(0, width(s.rows) - 1))}${s.rows.length}` : null);
const width = rows => rows.reduce((w, r) => Math.max(w, r.length), 0);

function sheetXml(sheet) {
  const { rows } = sheet;
  const w = width(rows);
  const widths = sheet.widths || Array.from({ length: w }, (_, c) => Math.min(60, Math.max(8,
    ...rows.slice(0, 200).map(r => String(r[c] ?? '').split('\n').reduce((a, l) => Math.max(a, l.length), 0) + 2))));
  const styleOf = sheet.styleOf || ((i, c) => i === 0 ? 1 : 2);
  const sIdx = (i, c) => { const k = styleOf(i, c); return typeof k === 'number' ? k : XF[k] ?? 2; };
  // A styled sheet writes every cell of its table, empty ones too, so borders reach merged and blank cells.
  const dense = !!sheet.styleOf;
  const body = rows.map((r, i) => `<row r="${i + 1}"${sheet.heights?.[i] ? ` ht="${sheet.heights[i]}" customHeight="1"` : ''}>${Array.from({ length: dense ? w : r.length }, (_, c) => {
    const v = r[c];
    const ref = `${colName(c)}${i + 1}`, style = ` s="${sIdx(i, c)}"`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    // a date: `{ date: '2024-03-01' }` or a Date, written as Excel's serial with a date format, so it sorts and filters as a date
    if (v instanceof Date || (v && typeof v === 'object' && v.date != null)) { const serial = isoToSerial(v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v.date); if (serial != null) return `<c r="${ref}" s="${/[: ]\d{2}:/.test(String(v.date || '')) ? 10 : 9}"><v>${serial}</v></c>`; return `<c r="${ref}"${style} t="inlineStr"><is><t>${xml(v.date || '')}</t></is></c>`; }
    if (v == null || v === '') return dense && styleOf(i, c) != null ? `<c r="${ref}"${style}/>` : '';
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const f = sheet.freeze || (rows.length > 1 ? { x: 0, y: 1 } : null);
  const pane = f && (f.x || f.y) ? `<pane${f.x ? ` xSplit="${f.x}"` : ''}${f.y ? ` ySplit="${f.y}"` : ''} topLeftCell="${colName(f.x || 0)}${(f.y || 0) + 1}" activePane="${f.x && f.y ? 'bottomRight' : f.y ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
  const filter = filterOf(sheet);
  const merges = sheet.merges || [];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${sheet.landscape ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
${w ? `<cols>${widths.map((x, c) => `<col min="${c + 1}" max="${c + 1}" width="${x}" customWidth="1"/>`).join('')}</cols>` : ''}
<sheetData>${body}</sheetData>${filter ? `<autoFilter ref="${filter}"/>` : ''}${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}${
  sheet.landscape ? '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="8" fitToHeight="0" fitToWidth="1"/>' : ''}
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF253243"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF253243"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF002060"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="1" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** `sheets`: `[{ name, rows: [[cell, …], …], …layout }]`, the first row of each the header. Returns a Blob. */
export async function writeXlsx(sheets, { font = null, size = null } = {}) {
  const taken = new Set(), extra = [];
  // a style given as { fill, bold } becomes a format of its own after the fixed ones
  const custom = k => { const id = `${String(k.fill || '').toUpperCase()}|${k.bold ? 1 : 0}`; let n = extra.findIndex(e => e.id === id); if (n < 0) { extra.push({ id, fill: String(k.fill || '').replace(/^#/, '').toUpperCase(), bold: !!k.bold }); n = extra.length - 1; } return XF_FIXED + n; };
  const list = (sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]).map(s => ({ ...s, name: sheetName(s.name, taken), rows: s.rows || [],
    ...(s.styleOf ? { styleOf: (i, c) => { const k = s.styleOf(i, c); return k && typeof k === 'object' ? custom(k) : k; } } : {}) }));
  const sheetParts = list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames(list)}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml(extra, { font, size }) },
    ...sheetParts,
  ];
  return zip(entries);
}

// The fixed formats, then one per { fill, bold } a sheet asked for (a thin grey border, wrapped at the top, black text); the font set for all.
const XF_FIXED = 14;
function stylesXml(extra, { font, size }) {
  let x = STYLES;
  if (font) x = x.replace(/<name val="Calibri"\/>/g, `<name val="${xml(font)}"/>`);
  if (size) x = x.replace(/<sz val="11"\/>/g, `<sz val="${Number(size)}"/>`);
  if (!extra.length) return x;
  const fills = [...new Set(extra.map(e => e.fill).filter(Boolean))];
  x = x.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (m, n, body) => `<fonts count="${Number(n) + 1}">${body}<font><b/><sz val="${size ? Number(size) : 11}"/><color rgb="FF000000"/><name val="${xml(font || 'Calibri')}"/></font></fonts>`);
  x = x.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (m, n, body) => `<fills count="${Number(n) + fills.length}">${body}${fills.map(f => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`);
  const boldFont = 6, fillAt = f => (f ? 6 + fills.indexOf(f) : 0);
  return x.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (m, n, body) => `<cellXfs count="${Number(n) + extra.length}">${body}${extra.map(e =>
    `<xf numFmtId="0" fontId="${e.bold ? boldFont : 3}" fillId="${fillAt(e.fill)}" borderId="1" xfId="0" applyFont="1"${e.fill ? ' applyFill="1"' : ''} applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs>`);
}

// The filter range of each filtered sheet, and a landscape sheet's printed header row.
function definedNames(list) {
  const q = s => `'${xml(s.name.replace(/'/g, "''"))}'`;
  const abs = ref => ref.split(':').map(x => x.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':');
  const names = list.flatMap((s, i) => [
    filterOf(s) && `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${q(s)}!${abs(filterOf(s))}</definedName>`,
    s.landscape && `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${q(s)}!$1:$1</definedName>`,
  ].filter(Boolean));
  return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
}
