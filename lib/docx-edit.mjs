// Editing an existing .docx in place: paragraph text changes, nothing else.
//
// The document is never rebuilt. word/document.xml is tokenised once, each
// edited paragraph is spliced back as a string, and every other entry of the
// archive is copied through unchanged. No DOMParser, so this runs under
// node --test as well as in the webview.
import { codePoint } from './xml.mjs';
import { entries, read, readText } from './unzip.mjs';
import { zip } from './zip.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => String(s).replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (m, n, hx, dc) => n ? ENT[n.toLowerCase()] : codePoint(parseInt(hx || dc, hx ? 16 : 10)));
// Characters XML 1.0 cannot carry at all are dropped, not escaped.
const xmlText = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Tags, comments, processing instructions and CDATA; attribute values may hold '>'.
const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function tokens(xml) {
  const out = [];
  TAG.lastIndex = 0;
  for (let m; (m = TAG.exec(xml));) {
    if (!m[2]) continue;
    out.push({ name: m[2], close: !!m[1], self: !!m[4], attrs: m[3], start: m.index, end: TAG.lastIndex });
  }
  return out;
}

/**
 * Paragraphs of the body in document order, with their extent in the XML.
 * Paragraphs inside mc:Fallback are the same text box drawn a second way and
 * are skipped; a text box's paragraphs inside a paragraph are listed on their
 * own, after the paragraph that holds them.
 */
function paragraphs(xml) {
  const toks = tokens(xml), stack = [], open = [], out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.close) {
      while (stack.length && stack.pop() !== t.name);
      if (t.name === 'w:p' && open.length) { const p = open.pop(); p.end = t.end; p.last = k; out.push(p); }
      continue;
    }
    const inTc = stack.includes('w:tc'), hidden = stack.includes('mc:Fallback');
    if (t.name === 'w:p') {
      const p = { start: t.start, openEnd: t.end, first: k, inTc, hidden, nested: open.length > 0 };
      if (t.self) { p.end = t.end; p.last = k; out.push(p); } else open.push(p);
    }
    if (!t.self) stack.push(t.name);
  }
  out.sort((a, b) => a.start - b.start);
  return { toks, list: out.filter(p => !p.hidden) };
}

/** Visible text of one paragraph: its own runs, not those of text boxes it holds. */
function paraText(xml, toks, p) {
  let s = '', skip = 0, inRun = 0;
  for (let k = p.first + 1; k < p.last; k++) {
    const t = toks[k];
    if (/^(w:txbxContent|mc:Fallback|w:del|w:pPr|w:rPr)$/.test(t.name) && !t.self) { skip += t.close ? -1 : 1; continue; }
    if (skip) continue;
    if (t.name === 'w:r' && !t.self) { inRun += t.close ? -1 : 1; continue; }
    if (!inRun || t.close) continue;
    if (t.name === 'w:t' && !t.self) {
      const end = toks[k + 1];
      s += decode(xml.slice(t.end, end.start)); k++;
    } else if (t.name === 'w:tab' || t.name === 'w:ptab') s += '\t';
    else if (t.name === 'w:br' || t.name === 'w:cr') s += '\n';
  }
  return s;
}

const attr = (a, n) => new RegExp(`\\b${n}="([^"]*)"`).exec(a || '')?.[1];

/** styleId → { name, outline } from word/styles.xml, so localised heading ids ("Balk1") still read as headings. */
function styleTable(xml) {
  const map = new Map();
  for (const m of (xml || '').matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[1], 'w:styleId');
    const name = attr(/<w:name\b([^>]*)\/>/.exec(m[2])?.[1], 'w:val') || '';
    if (id) map.set(id, { name, outline: /<w:outlineLvl\b/.test(m[2]) || /^(heading \d|title)$/i.test(name) });
  }
  return map;
}

function describe(xml, toks, p, styles) {
  const body = xml.slice(p.openEnd, p.end);
  const pPr = /^\s*<w:pPr\b[\s\S]*?<\/w:pPr>|^\s*<w:pPr\/>/.exec(body)?.[0] || '';
  const style = attr(/<w:pStyle\b([^>]*)\/>/.exec(pPr)?.[1], 'w:val') || '';
  const st = styles.get(style);
  const kind = p.inTc ? 'table-cell'
    : (/<w:outlineLvl\b/.test(pPr) || st?.outline || /^(heading|title)/i.test(style)) ? 'heading'
    : (/<w:numPr\b/.test(pPr) || /list/i.test(st?.name || style)) ? 'list' : 'p';
  return { text: p.end === p.openEnd ? '' : paraText(xml, toks, p), style, kind };
}

// Shared stable paragraph identities for the structured viewer and text saves.
export const paragraphIndexes = xml => new Map(paragraphs(xml).list.map((p, i) => [p.start, i]));

export async function openDocx(bytes) {
  const xml = await readText(bytes, 'word/document.xml');
  if (xml == null) throw new Error('not a Word document');
  const styles = styleTable(await readText(bytes, 'word/styles.xml'));
  const { toks, list } = paragraphs(xml);
  return { paragraphs: list.map((p, i) => ({ i, ...describe(xml, toks, p, styles), fixed: fixedPara(xml, toks, p) })) };
}

// Top-level children of a paragraph, as [start, end, name] extents in xml.
function children(toks, p) {
  const out = []; let depth = 0, at = null;
  for (let k = p.first + 1; k < p.last; k++) {
    const t = toks[k];
    if (depth === 0 && !t.close) { if (t.self) { out.push([t.start, t.end, t.name]); continue; } at = [t.start, 0, t.name]; }
    if (t.self) continue;
    depth += t.close ? -1 : 1;
    if (depth === 0 && at) { at[1] = t.end; out.push(at); at = null; }
  }
  return out;
}

// A run is kept when it carries something other than text: a drawing, a text
// box, a note or comment reference, an embedded object. Its own text elements
// are removed so the paragraph's text is only the new text.
const KEEP_RUN = /<(w:drawing|w:pict|w:object|mc:AlternateContent|w:footnoteReference|w:endnoteReference|w:commentReference|w:ruby)\b/;
// Markers with no text of their own stay where they were.
const KEEP_MARK = /^(w:bookmarkStart|w:bookmarkEnd|w:commentRangeStart|w:commentRangeEnd|w:permStart|w:permEnd|w:moveFromRangeStart|w:moveFromRangeEnd|w:moveToRangeStart|w:moveToRangeEnd|m:oMathPara|m:oMath)$/;
const TEXT_ELT = /<w:t\b[^>]*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:(tab|ptab|br|cr)\b[^>]*\/>/g;

function newRun(rPr, text) {
  if (!text) return '';
  const parts = String(text).split(/(\t|\r?\n)/).filter(x => x !== '').map(x =>
    x === '\t' ? '<w:tab/>' : /\n/.test(x) ? '<w:br/>' : `<w:t xml:space="preserve">${xmlText(x)}</w:t>`);
  return `<w:r>${rPr}${parts.join('')}</w:r>`;
}

/**
 * The paragraph rewritten with `text`. Kept: the w:p tag and its attributes,
 * w:pPr, bookmarks and comment ranges, math, and runs holding drawings, text
 * boxes, note and comment references (minus their text). Dropped: every other
 * run, and the wrappers whose content is text — hyperlinks, fields (simple and
 * complex, so a citation field becomes plain text), content controls, smart
 * tags, tracked insertions and deletions, proofing marks. The new text takes
 * the w:rPr of the first run that had text, at that run's position.
 */
function rewrite(xml, toks, p, text) {
  const tag = xml.slice(p.start, p.openEnd);
  const openTag = tag.endsWith('/>') ? tag.slice(0, -2).trimEnd() + '>' : tag;
  const { kids, pPr, rPr, first } = formatOf(xml, toks, p);
  const kept = [];
  let at = -1;
  kids.forEach(([s, e, name], k) => {
    const el = xml.slice(s, e);
    if (k === first) at = kept.length;
    if (KEEP_MARK.test(name)) kept.push(el);
    else if (name === 'w:r' && KEEP_RUN.test(el)) kept.push(shielded(el, x => x.replace(TEXT_ELT, '')));
  });
  if (at < 0) at = kept.length;
  kept.splice(at, 0, newRun(rPr, text));
  return `${openTag}${pPr}${kept.join('')}</w:p>`;
}

// Applies f to the parts of a run outside drawings and text boxes, whose own
// paragraphs are not this paragraph's text.
const INNER = /<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>|<w:object\b[\s\S]*?<\/w:object>/g;
const shielded = (el, f) => el.replace(INNER, x => `\0${x}\0`).split('\0').map((x, i) => i % 2 ? x : f(x)).join('');

/** The paragraph's w:pPr, the w:rPr of its first run with text, and which child holds that run. */
function formatOf(xml, toks, p) {
  const kids = p.end === p.openEnd ? [] : children(toks, p);
  let pPr = '', rPr = '', first = -1;
  kids.forEach(([s, e, name], k) => {
    const el = xml.slice(s, e);
    if (name === 'w:pPr') { pPr = el; return; }
    if (first >= 0 || name === 'w:del') return;
    const flat = el.replace(INNER, '');
    const run = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t\b[^>]*>[^<]/.exec(flat)?.[0];
    if (run) { first = k; rPr = /<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\/>/.exec(run)?.[0] || ''; }
  });
  return { kids, pPr, rPr, first };
}

async function repack(bytes, replace) {
  const out = [];
  for (const e of entries(bytes)) out.push({ name: e.name, data: e.name in replace ? replace[e.name] : await read(bytes, e) });
  return new Uint8Array(await (await zip(out)).arrayBuffer());
}

/**
 * New bytes with each `{ i, text }` paragraph's text replaced and each
 * `{ i, remove: true }` paragraph taken out; every other entry unchanged. A
 * paragraph that cannot go — one in a table cell (a cell needs one), one
 * carrying the section's page setup, one inside a text box — is emptied instead.
 */
export async function saveDocx(bytes, edits = []) {
  const xml = await readText(bytes, 'word/document.xml');
  if (xml == null) throw new Error('not a Word document');
  const { toks, list } = paragraphs(xml);
  const byIndex = new Map();
  for (const { i, text, remove } of edits) {
    if (!list[i]) throw new Error(`no paragraph ${i}`);
    byIndex.set(i, remove ? null : text);
  }
  const todo = [...byIndex].map(([i, text]) => ({ p: list[i], text })).sort((a, b) => b.p.start - a.p.start);
  for (const t of todo) if (t.text === null) t.text = fixedPara(xml, toks, t.p) ? '' : undefined;
  // A text box paragraph lives inside its anchor paragraph; editing both at
  // once would splice over itself.
  for (let k = 1; k < todo.length; k++)
    if (todo[k].p.end > todo[k - 1].p.start) throw new Error('edits overlap: a paragraph and a text box inside it');
  let doc = xml;
  for (const { p, text } of todo) doc = doc.slice(0, p.start) + (text === undefined ? '' : rewrite(xml, toks, p, text)) + doc.slice(p.end);
  return repack(bytes, { 'word/document.xml': doc });
}

// A paragraph that can be emptied but not removed: a table cell needs one,
// the section's page setup rides on one, and a text box lives in its anchor.
const fixedPara = (xml, toks, p) => p.inTc || p.nested || /<w:sectPr\b/.test(formatOf(xml, toks, p).pPr);

/** New bytes with a paragraph after paragraph `i`, carrying its w:pPr and first run's w:rPr. */
export async function insertParagraphAfter(bytes, i, text) {
  const xml = await readText(bytes, 'word/document.xml');
  if (xml == null) throw new Error('not a Word document');
  const { toks, list } = paragraphs(xml);
  const p = list[i];
  if (!p) throw new Error(`no paragraph ${i}`);
  if (p.nested) throw new Error('cannot insert inside a text box');
  // Formatting only: a section break in the pPr would start a new section,
  // and bookmarks, drawings and references belong to the original.
  const { pPr, rPr } = formatOf(xml, toks, p);
  const para = `<w:p>${pPr.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, '')}${newRun(rPr, text)}</w:p>`;
  return repack(bytes, { 'word/document.xml': xml.slice(0, p.end) + para + xml.slice(p.end) });
}
