// The review's working files as text with locators, so a quote from a docx
// or a sheet can be pointed at: paragraph, sheet and cell, or line. PDFs are
// not read here; they have positions and go through doctext.mjs.
import { codePoint } from './xml.mjs';
import { readText } from './unzip.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { loadPdf } from './anchor.mjs';

export const SUPPORTED = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'odt', 'rtf', 'pptx'];
export const extOf = name => String(name || '').toLowerCase().split('.').pop();

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => String(s).replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (m, n, hx, dc) => n ? ENT[n.toLowerCase()] : codePoint(parseInt(hx || dc, hx ? 16 : 10)));

function lines(text) {
  const locators = []; let at = 0;
  text.split('\n').forEach((l, i) => { locators.push({ start: at, end: at + l.length, line: i + 1 }); at += l.length + 1; });
  return { text, locators };
}

async function docx(bytes) {
  const xml = await readText(bytes, 'word/document.xml');
  if (!xml) throw new Error('not a Word document');
  const paras = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map(x => x[1] != null ? decode(x[1]) : (x[0] === '<w:tab/>' ? '\t' : '\n')).join(''));
  const locators = []; let text = '';
  paras.forEach((p, i) => { locators.push({ start: text.length, end: text.length + p.length, paragraph: i + 1 }); text += p + (i < paras.length - 1 ? '\n' : ''); });
  return { text, locators };
}

const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
async function xlsx(bytes) {
  const { sheets } = await readXlsx(bytes);
  const locators = []; let text = '';
  for (const sh of sheets) {
    text += `# ${sh.name}\n`;
    sh.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === '') return;
        locators.push({ start: text.length, end: text.length + v.length, sheet: sh.name, cell: `${colName(c)}${r + 1}` });
        text += v + '\t';
      });
      text += '\n';
    });
  }
  return { text, locators };
}

async function pdf(bytes) {
  const { doc } = await loadPdf(bytes);
  try {
    const locators = []; let text = '';
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      const words = content.items.filter(i => typeof i.str === 'string').map(i => i.str);
      const body = words.join(' ').replace(/\s+/g, ' ').trim();
      text += `[[page ${page}]]\n`;
      locators.push({ start: text.length, end: text.length + body.length, page });
      text += body + '\n\n';
    }
    return { text, locators };
  } finally { await doc.destroy?.(); }
}

// OpenDocument text: paragraphs and headings in content.xml, a table's rows as tab-separated lines.
async function odt(bytes) {
  const xml = await readText(bytes, 'content.xml');
  if (!xml) throw new Error('not an OpenDocument file');
  const inner = s => decode(s.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<[^>]+>/g, ''));
  const paras = [];
  const body = /<office:text>([\s\S]*?)<\/office:text>/.exec(xml)?.[1] || xml;
  for (const m of body.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>|<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)) {
    if (m[1] != null) paras.push([...m[1].matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)].map(c => inner(c[1]).replace(/\n/g, ' ')).join('\t'));
    else if (!/<text:(?:p|h)\b/.test(m[2])) paras.push(inner(m[2]));   // a paragraph inside a table cell was taken with its row
  }
  return paragraphs(paras);
}
// Rich Text: control words and groups dropped, paragraph marks and escaped characters kept.
export function rtfText(text) {
  let s = String(text).replace(/\r?\n/g, '');
  // groups that carry no text: fonts, colours, stylesheet, info, pictures, and any starred destination
  for (const word of ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore'])
    for (let i; (i = s.search(new RegExp(`\\{\\\\(?:\\*\\\\)?${word}\\b`))) >= 0;) { let d = 0, j = i; do { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } while (d && j < s.length); s = s.slice(0, i) + s.slice(j); }
  s = s.replace(/\{\\\*[^{}]*\}/g, '');
  const out = [];
  for (const m of s.matchAll(/\\'([0-9a-f]{2})|\\u(-?\d+)\s?\??|\\(par|line|tab|cell|row)\b\s?|\\[a-z]+-?\d*\s?|\\([\\{}])|[{}]|([^\\{}]+)/gi)) {
    if (m[1]) out.push(String.fromCharCode(parseInt(m[1], 16)));
    else if (m[2]) { const n = Number(m[2]); out.push(String.fromCharCode(n < 0 ? n + 65536 : n)); }
    else if (m[3]) out.push(m[3] === 'par' || m[3] === 'row' ? '\n' : m[3] === 'line' ? '\n' : '\t');
    else if (m[4]) out.push(m[4]);
    else if (m[5]) out.push(m[5]);
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').trim();
}
// PowerPoint: each slide's text in reading order, a marker per slide.
async function pptx(bytes) {
  const { entries } = await import('./unzip.mjs');
  const names = entries(bytes).map(e => e.name).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  if (!names.length) throw new Error('not a PowerPoint file');
  const locators = []; let text = '';
  for (const [i, name] of names.entries()) {
    const xml = await readText(bytes, name) || '';
    const paras = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(m => [...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(x => decode(x[1])).join('')).filter(Boolean);
    text += `[[slide ${i + 1}]]\n`;
    const body = paras.join('\n');
    locators.push({ start: text.length, end: text.length + body.length, slide: i + 1 });
    text += body + '\n\n';
  }
  return { text, locators };
}
function paragraphs(paras) {
  const locators = []; let text = '';
  paras.forEach((p, i) => { locators.push({ start: text.length, end: text.length + p.length, paragraph: i + 1 }); text += p + (i < paras.length - 1 ? '\n' : ''); });
  return { text, locators };
}

export async function fileText(name, bytes) {
  const ext = extOf(name);
  if (ext === 'pdf') return pdf(bytes);
  if (ext === 'odt') return odt(bytes);
  if (ext === 'pptx') return pptx(bytes);
  if (ext === 'rtf') return paragraphs(rtfText(new TextDecoder('latin1').decode(bytes)).split('\n'));
  if (ext === 'docx') return docx(bytes);
  if (ext === 'xlsx') return xlsx(bytes);
  if (ext === 'csv' || ext === 'txt' || ext === 'md') return lines(new TextDecoder().decode(bytes));
  throw new Error(`unsupported file type .${ext}`);
}

/** The locator covering an offset in `text`. */
export function locatorAt(ft, offset) {
  return ft.locators.find(l => offset >= l.start && offset < l.end) || null;
}
