// Editing an existing .xlsx in place: cell values change, nothing else.
//
// Only the worksheets that receive edits are rewritten, and within them only
// the edited cells, their rows and the dimension. Values read through
// xlsx-read.mjs; like it, this is regular expressions over XML, no DOMParser.
import { codePoint } from './xml.mjs';
import { entries, read, readText } from './unzip.mjs';
import { zip } from './zip.mjs';
import { workbookStyles, sheetAppearance } from './xlsx-appearance.mjs';
import { readXlsx } from './xlsx-read.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => String(s).replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (m, n, hx, dc) => n ? ENT[n.toLowerCase()] : codePoint(parseInt(hx || dc, hx ? 16 : 10)));
const xmlText = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colIndex = ref => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
const colLetters = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const attr = (a, n) => new RegExp(`\\b${n}="([^"]*)"`).exec(a || '')?.[1];
// A number is written as one only when it reads back the same: "007" and
// "1.50" stay text, so an identifier or a reported precision is not lost.
const NUMBER = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/;

/** Sheet name → part path, in workbook order. */
async function sheetPaths(bytes) {
  const wb = await readText(bytes, 'xl/workbook.xml');
  if (!wb) throw new Error('not a workbook');
  const rels = await readText(bytes, 'xl/_rels/workbook.xml.rels') || '';
  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) target.set(attr(m[1], 'Id'), attr(m[1], 'Target'));
  return [...wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map(m => {
    const t = target.get(attr(m[1], 'r:id')) || '';
    return { name: decode(attr(m[1], 'name') ?? ''), path: t.startsWith('/') ? t.slice(1) : `xl/${t}` };
  });
}

// A row or a cell, self-closing or not; group 1 is the attributes, group 2 the body.
const ROW = p => new RegExp(`<${p}row\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${p}row>)`, 'g');
const CELL = p => new RegExp(`<${p}c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${p}c>)`, 'g');
const prefixOf = xml => /<(\w+:)?worksheet\b/.exec(xml)?.[1] || '';

function formulas(xml) {
  const p = prefixOf(xml), out = {};
  for (const cm of xml.matchAll(CELL(p))) {
    const f = new RegExp(`<${p}f\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${p}f>)`).exec(cm[2] || '');
    const ref = attr(cm[1], 'r');
    // a shared formula's dependents carry no text of their own: ''
    if (f && ref) out[ref] = decode(f[1] ?? '');
  }
  return out;
}

export async function openXlsx(bytes) {
  const [paths, { sheets }, stylesXml, themeXml] = await Promise.all([
    sheetPaths(bytes), readXlsx(bytes), readText(bytes, 'xl/styles.xml'), readText(bytes, 'xl/theme/theme1.xml'),
  ]);
  const out = [];
  const styles = workbookStyles(stylesXml || '', themeXml || '');
  for (let k = 0; k < paths.length; k++) {
    const xml = await readText(bytes, paths[k].path) || '';
    out.push({ ...paths[k], rows: sheets[k]?.rows || [], formulas: formulas(xml), ...sheetAppearance(xml, styles) });
  }
  return { sheets: out };
}

/**
 * A formula moved from `from` to `to`, relative references shifted as Excel
 * does when it fills a shared formula. Strings and quoted sheet names are left
 * alone; whole-column and whole-row ranges (A:A, 1:1) are not shifted.
 */
function shift(formula, from, to) {
  const dr = Number(/\d+/.exec(to)[0]) - Number(/\d+/.exec(from)[0]);
  const dc = colIndex(to) - colIndex(from);
  return formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/).map((part, i) => i % 2 ? part :
    part.replace(/(^|[^A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, pre, ca, col, ra, row) =>
      pre + ca + (ca ? col : colLetters(colIndex(col) + dc)) + ra + (ra ? row : Math.max(1, Number(row) + dr)))).join('');
}

function cellXml(p, ref, s, value) {
  const style = s != null ? ` s="${s}"` : '';
  if (value === '' || value == null) return `<${p}c r="${ref}"${style}/>`;
  if (NUMBER.test(value)) return `<${p}c r="${ref}"${style}><${p}v>${value}</${p}v></${p}c>`;
  return `<${p}c r="${ref}"${style} t="inlineStr"><${p}is><${p}t xml:space="preserve">${xmlText(value)}</${p}t></${p}is></${p}c>`;
}

/** One sheet's XML with `edits` ([{ ref, value }]) applied. */
function editSheet(xml, edits) {
  const p = prefixOf(xml);
  // Editing the cell that holds a shared formula's text would leave its
  // dependents with nothing to copy: each is given its own formula first.
  const masters = new Map();
  for (const cm of xml.matchAll(CELL(p))) {
    const ref = attr(cm[1], 'r');
    const f = new RegExp(`<${p}f\\b([^>]*)>([\\s\\S]*?)<\\/${p}f>`).exec(cm[2] || '');
    if (ref && f && attr(f[1], 't') === 'shared' && edits.some(e => e.ref === ref)) masters.set(attr(f[1], 'si'), { ref, text: decode(f[2]) });
  }
  if (masters.size) xml = xml.replace(CELL(p), (m, a, body) => {
    const ref = attr(a, 'r');
    if (!body || !ref) return m;
    return m.replace(new RegExp(`<${p}f\\b([^>]*?)\\/>`), (f, fa) => {
      const master = attr(fa, 't') === 'shared' && masters.get(attr(fa, 'si'));
      return master ? `<${p}f>${xmlText(shift(master.text, master.ref, ref))}</${p}f>` : f;
    });
  });

  const byRow = new Map();
  for (const e of edits) {
    const r = Number(/\d+$/.exec(e.ref)[0]);
    if (!byRow.has(r)) byRow.set(r, new Map());
    byRow.get(r).set(colIndex(e.ref), e);
  }

  const sd = new RegExp(`<${p}sheetData\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${p}sheetData>)`).exec(xml);
  if (!sd) throw new Error('worksheet has no sheetData');
  const rows = [];
  let n = 0;
  for (const rm of (sd[1] || '').matchAll(ROW(p))) {
    n = Number(attr(rm[1], 'r') || n + 1);
    rows.push({ r: n, xml: rm[0], attrs: rm[1], body: rm[2] || '' });
  }
  for (const [r, cells] of byRow) {
    let row = rows.find(x => x.r === r);
    if (!row) {
      row = { r, attrs: ` r="${r}"`, body: '' };
      const at = rows.findIndex(x => x.r > r);
      rows.splice(at < 0 ? rows.length : at, 0, row);
    }
    // A row styled as a whole styles the cells created in it.
    const rowStyle = attr(row.attrs, 'customFormat') === '1' ? attr(row.attrs, 's') : null;
    const list = [];
    let c = -1;
    for (const cm of row.body.matchAll(CELL(p))) {
      const ref = attr(cm[1], 'r');
      c = ref ? colIndex(ref) : c + 1;
      list.push({ c, xml: cm[0], s: attr(cm[1], 's') });
    }
    for (const [col, e] of cells) {
      const old = list.find(x => x.c === col);
      const next = { c: col, xml: cellXml(p, e.ref, old ? old.s : rowStyle, e.value) };
      if (old) list[list.indexOf(old)] = next;
      else { const at = list.findIndex(x => x.c > col); list.splice(at < 0 ? list.length : at, 0, next); }
    }
    // spans is an optional loading hint; a stale one is worse than none
    const attrs = row.attrs.replace(/\s+spans="[^"]*"/, '');
    row.xml = `<${p}row${attrs}>${list.map(x => x.xml).join('')}</${p}row>`;
  }
  const open = /^<[^>]*?(?=\/?>)/.exec(sd[0])[0];
  const data = `${open}>${rows.map(x => x.xml).join('')}</${p}sheetData>`;
  xml = xml.slice(0, sd.index) + data + xml.slice(sd.index + sd[0].length);

  // The used range grows to take in any new cell.
  return xml.replace(new RegExp(`<${p}dimension\\b([^>]*?)ref="([^"]*)"`), (m, a, ref) => {
    const [a1, b1 = a1] = ref.split(':');
    if (!/^[A-Z]+\d+$/.test(a1) || !/^[A-Z]+\d+$/.test(b1)) return m;
    let c0 = colIndex(a1), r0 = +/\d+/.exec(a1)[0], c1 = colIndex(b1), r1 = +/\d+/.exec(b1)[0];
    for (const e of edits) {
      const c = colIndex(e.ref), r = +/\d+$/.exec(e.ref)[0];
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    const next = `${colLetters(c0)}${r0}` + (c0 === c1 && r0 === r1 ? '' : `:${colLetters(c1)}${r1}`);
    return `<${p}dimension${a}ref="${next}"`;
  });
}

// A sheet's merged ranges with some taken away and some added; the element is left out when none remain, and a new one goes where the
// schema puts it: after the sheet data and the elements that may follow it, before the rest.
function withMerges(xml, list) {
  if (!list.length) return xml;
  const p = prefixOf(xml), have = [...xml.matchAll(new RegExp(`<${p}mergeCell\\b[^>]*\\bref="([^"]+)"[^>]*\\/>`, 'g'))].map(m => m[1]);
  const drop = new Set(list.map(m => m.remove).filter(Boolean)), add = list.map(m => m.add).filter(Boolean);
  const refs = [...new Set([...have.filter(r => !drop.has(r)), ...add])];
  const block = refs.length ? `<${p}mergeCells count="${refs.length}">${refs.map(r => `<${p}mergeCell ref="${r}"/>`).join('')}</${p}mergeCells>` : '';
  const old = new RegExp(`<${p}mergeCells\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${p}mergeCells>)`);
  if (old.test(xml)) return xml.replace(old, block);
  if (!block) return xml;
  const after = ['sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews'];
  let at = -1;
  for (const tag of after) {
    const m = new RegExp(`<\\/${p}${tag}>|<${p}${tag}\\b[^>]*\\/>`).exec(xml);
    if (m) at = Math.max(at, m.index + m[0].length);
  }
  return at < 0 ? xml : xml.slice(0, at) + block + xml.slice(at);
}

/**
 * New bytes with each `{ sheet, cell, value }` written. Numbers go in as
 * numbers, everything else as an inline string; the cell keeps its style and
 * loses any formula. When anything is edited, xl/calcChain.xml is removed with its content-type
 * override and relationship, and the workbook is marked for a full
 * recalculation on load, because formulas that read an edited cell otherwise
 * show their old cached result. Every other entry is unchanged.
 */
export async function saveXlsx(bytes, edits = [], { merges = [] } = {}) {
  const paths = await sheetPaths(bytes);
  const bySheet = new Map();
  // `merges`: [{ sheet, add?: 'G17:G18', remove?: 'G17:G18' }], merged ranges added or taken away (a value given for a study over its arms' rows)
  const mergesBy = new Map();
  for (const m of merges) {
    const target = paths.find(x => x.name === m.sheet);
    if (!target) throw new Error(`no sheet ${m.sheet}`);
    for (const r of [m.add, m.remove]) if (r != null && !/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/.test(String(r))) throw new Error(`not a range: ${r}`);
    if (!mergesBy.has(target.path)) mergesBy.set(target.path, []);
    mergesBy.get(target.path).push(m);
    if (!bySheet.has(target.path)) bySheet.set(target.path, new Map());
  }
  for (const { sheet, cell, value } of edits) {
    const target = paths.find(x => x.name === sheet);
    if (!target) throw new Error(`no sheet ${sheet}`);
    const ref = String(cell).toUpperCase().replace(/\$/g, '');
    if (!/^[A-Z]{1,3}[1-9]\d*$/.test(ref)) throw new Error(`not a cell reference: ${cell}`);
    if (!bySheet.has(target.path)) bySheet.set(target.path, new Map());
    bySheet.get(target.path).set(ref, { ref, value: value == null ? '' : String(value) });
  }
  const replace = {};
  for (const [path, cells] of bySheet) replace[path] = withMerges(editSheet(await readText(bytes, path), [...cells.values()]), mergesBy.get(path) || []);

  const names = entries(bytes).map(e => e.name);
  const chain = bySheet.size > 0 && names.includes('xl/calcChain.xml');
  if (chain) {
    const ct = await readText(bytes, '[Content_Types].xml');
    replace['[Content_Types].xml'] = ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    const rels = await readText(bytes, 'xl/_rels/workbook.xml.rels');
    replace['xl/_rels/workbook.xml.rels'] = rels.replace(/<Relationship\b[^>]*Target="(?:\/xl\/)?calcChain\.xml"[^>]*\/>/, '');
  }
  if (bySheet.size) {
    const wb = await readText(bytes, 'xl/workbook.xml');
    const next = /<(\w+:)?calcPr\b/.test(wb)
      ? wb.replace(/<((?:\w+:)?calcPr)\b([^>]*?)(\/?)>/, (m, tag, a, self) =>
          `<${tag}${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${self}>`)
      // schema order: calcPr follows sheets, externalReferences and definedNames
      : wb.replace(/[\s\S]*(<\/(\w+:)?(?:sheets|functionGroups|externalReferences|definedNames)>)/, (m, end, pre = '') => `${m}<${pre}calcPr fullCalcOnLoad="1"/>`);
    if (next !== wb) replace['xl/workbook.xml'] = next;
  }

  const out = [];
  for (const e of entries(bytes)) {
    if (chain && e.name === 'xl/calcChain.xml') continue;
    out.push({ name: e.name, data: e.name in replace ? replace[e.name] : await read(bytes, e) });
  }
  return new Uint8Array(await (await zip(out)).arrayBuffer());
}
