// A workbook as text: sheet names, rows of strings, the merged ranges
// ("A7:A8") and the column widths set on the sheet, nothing more. A cell
// whose style is a date format comes back as an ISO date (or date-time),
// not the serial number Excel keeps.
//
// No DOMParser — this runs under node --test as well as in the webview — so
// the three parts that matter (workbook, rels, shared strings, sheets) are read
// with regular expressions over their XML, which is stable and small.
import { codePoint } from './xml.mjs';
import { readText } from './unzip.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => String(s).replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (m, n, hx, dc) => n ? ENT[n.toLowerCase()] : codePoint(parseInt(hx || dc, hx ? 16 : 10)));
const texts = xml => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decode(m[1])).join('');
const colIndex = ref => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

export const WORKBOOK_LIMITS = Object.freeze({ maxRows: 100_001, maxColumns: 512, maxCells: 2_000_000, maxSheets: 100 });
export async function readXlsx(bytes, options = {}) {
  const limits = { ...WORKBOOK_LIMITS, ...options };
  const readXml = name => readText(bytes, name, options);
  const wb = await readXml('xl/workbook.xml');
  if (!wb) throw new Error('not a workbook');
  const rels = await readXml('xl/_rels/workbook.xml.rels') || '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map(m => [m[1], m[2]]));
  // attribute order varies between writers, so Target-before-Id is read too
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) target.set(m[2], m[1]);
  const sst = await readXml('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => texts(m[1])) : [];
  const dateStyles = dateStylesOf(await readXml('xl/styles.xml') || '');
  const sheets = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    if (options.signal?.aborted) throw new DOMException('Import stopped', 'AbortError');
    if (sheets.length >= limits.maxSheets) throw new Error('The workbook has too many sheets');
    const name = decode(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(m[1])?.[1];
    let path = target.get(rid) || '';
    path = path.startsWith('/') ? path.slice(1) : `xl/${path}`;
    const xml = await readXml(path);
    sheets.push({ name, rows: xml ? parseSheet(xml, shared, dateStyles, limits) : [], merges: xml ? [...xml.matchAll(/<(?:\w+:)?mergeCell\b[^>]*\bref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(x => x[1]) : [], widths: xml ? colWidths(xml) : [] });
    options.onProgress?.(`Read ${sheets.length} sheets`);
  }
  return { sheets };
}

function parseSheet(xml, shared, dateStyles = new Map(), limits = WORKBOOK_LIMITS) {
  const rows = [];
  let width = 0;
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] || rows.length + 1);
    if (!Number.isSafeInteger(r) || r <= rows.length || r > limits.maxRows) throw new Error('The sheet row range exceeds the supported limit');
    while (rows.length < r - 1) rows.push([]);
    const row = [];
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1])?.[1];
      const c = ref ? colIndex(ref) : row.length;
      if (!Number.isSafeInteger(c) || c < 0 || c >= limits.maxColumns || r * Math.max(width, c + 1) > limits.maxCells) throw new Error('The sheet column or cell range exceeds the supported limit');
      const type = /\bt="([^"]*)"/.exec(cm[1])?.[1] || '';
      const style = /\bs="(\d+)"/.exec(cm[1])?.[1];
      const body = cm[2] || '';
      let v = '';
      if (type === 's') { const i = Number(/<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(body)?.[1]); v = shared[i] ?? ''; }
      else if (type === 'inlineStr') v = texts(body);
      else { const raw = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(body)?.[1]; v = raw == null ? '' : decode(raw); if (type === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
        else if (!type && style != null && dateStyles.has(style) && raw !== '' && Number.isFinite(Number(raw))) v = serialToIso(Number(raw), dateStyles.get(style)); }
      while (row.length < c) row.push('');
      row[c] = v;
    }
    rows.push(row);
    width = Math.max(width, row.length);
  }
  for (const row of rows) while (row.length < width) row.push('');
  return rows;
}

// Column widths as the sheet sets them (<col min max width>), by column index; unset columns are null.
// Where two ranges overlap, the later one holds, as openpyxl reads it.
function colWidths(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(?:\w+:)?col\b([^>]*)\/?>/g)) {
    const a = k => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1];
    const min = Number(a('min')), max = Math.min(Number(a('max')), min + 200, WORKBOOK_LIMITS.maxColumns), w = Number(a('width'));
    if (!min || !Number.isFinite(w)) continue;
    for (let c = min; c <= max; c++) out[c - 1] = w;
  }
  return Array.from(out, x => x ?? null);
}

// ---- dates ---------------------------------------------------------------------
// Excel keeps a date as days since 1899-12-30 and tells it apart from a number
// only by the cell's format: the built-in date formats (14–22, 27–36, 45–47,
// 50–58) or a custom format made of day, month, year, hour and second codes.
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const TIME_BUILTIN = new Set([18, 19, 20, 21, 22, 45, 46, 47]);
const looksDate = code => { const c = String(code).replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, ''); return /[dmy]/i.test(c) && !/[#0]/.test(c); };
const hasTime = code => /[hs]/i.test(String(code).replace(/"[^"]*"/g, ''));
/** cellXfs index -> 'date' | 'datetime' for the styles that format a date. */
function dateStylesOf(styles) {
  const custom = new Map([...styles.matchAll(/<(?:\w+:)?numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)].map(m => [Number(m[1]), decode(m[2])]));
  const out = new Map();
  const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles)?.[1] || '';
  [...xfs.matchAll(/<(?:\w+:)?xf\b([^>]*)\/?>/g)].forEach((m, i) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0);
    if (BUILTIN_DATE.has(id)) out.set(String(i), TIME_BUILTIN.has(id) ? 'datetime' : 'date');
    else if (custom.has(id) && looksDate(custom.get(id))) out.set(String(i), hasTime(custom.get(id)) ? 'datetime' : 'date');
  });
  return out;
}
/** An Excel serial as an ISO date, or date-time when the format shows a time; a time alone (serial below 1) keeps the clock only. */
export function serialToIso(n, kind = 'date') {
  const ms = Math.round((n - 25569) * 86400 * 1000), d = new Date(ms);
  if (!Number.isFinite(ms)) return String(n);
  const pad = x => String(x).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${pad(d.getUTCSeconds())}` : ''}`;
  if (n < 1) return time;
  return kind === 'datetime' && (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) ? `${date} ${time}` : date;
}
/** The serial Excel keeps for an ISO date or date-time; null when the text is not one. */
export function isoToSerial(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return Number.isFinite(ms) ? ms / 86400000 + 25569 : null;
}
