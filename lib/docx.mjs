// Reading a Word manuscript as what it is: paragraphs with their formatting,
// on pages with their setup — not a conversion to something plainer.
//
// What is kept, per paragraph: the style, alignment, spacing (multiple, exact
// or at least), indents, list membership and level, page breaks, and the
// section a paragraph ends; per run: font, size, bold, italic, underline,
// strikethrough, capitals and small capitals, colour, highlight,
// super/subscript, and tracked insertion or deletion with its author. Tables
// keep their grid, merged cells, header row and column widths; images become
// figure blocks; footnotes, endnotes and comments are kept as notes the text
// refers to; SEQ, PAGE and NUMPAGES fields become tokens the document numbers
// itself. Per section: page size, orientation, margins, line numbering,
// header and footer. The document renders from these (lib/pages.mjs) and
// writes back to .docx from them (lib/docx-write.mjs). See plan §4.11a.
//
// Mendeley Cite stores each citation as a content control whose tag is
// `MENDELEY_CITATION_v3_` + base64 CSL JSON: the works cited, with full
// bibliographic data, and the text it rendered. The bibliography control is
// dropped; the app regenerates it from the citations. Nothing is invented:
// every record created comes from the itemData the reference manager wrote.
//
// XML is read with lib/xml.mjs, not DOMParser, so the same reader runs in the
// webview and under node --test.
import { entries, read } from './unzip.mjs';
import { recordKey } from './sources.mjs';
import { newId, citeToken, recognizeSections } from './manuscript.mjs';
import { parseXml } from './xml.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CITED = '\u0000cited';   // a field whose result is a citation run already pushed
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const utf8 = new TextDecoder();

// ---- units --------------------------------------------------------------
// Word measures in twentieths of a point (twips) and font size in half-points.
export const twipsToPt = t => Number(t) / 20;
export const halfPtToPt = h => Number(h) / 2;
const EMU_PER_PT = 12700;

const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute?.(`w:${name}`) ?? null;
const kids = (el, name) => (el?.children || []).filter(c => c.localName === name);
const child = (el, name) => kids(el, name)[0] || null;
const deep = (el, name) => el?.getElementsByTagNameNS(W, name)[0] || null;
const flag = (el, name) => {
  const c = child(el, name);
  if (!c) return undefined;
  const v = attr(c, 'val');
  return v == null || v === '1' || v === 'true' || v === 'on';
};
const HIGHLIGHT = new Set(['yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'darkBlue', 'darkCyan', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray', 'black']);

// ---- styles ---------------------------------------------------------------

function readRPr(rPr) {
  if (!rPr) return {};
  const out = {};
  const fonts = child(rPr, 'rFonts');
  if (fonts) { const f = attr(fonts, 'ascii') || attr(fonts, 'hAnsi'); if (f) out.font = f; }
  const sz = child(rPr, 'sz'); if (sz) out.sz = halfPtToPt(attr(sz, 'val'));
  if (flag(rPr, 'b') !== undefined) out.b = flag(rPr, 'b');
  if (flag(rPr, 'i') !== undefined) out.i = flag(rPr, 'i');
  const u = child(rPr, 'u'); if (u) out.u = attr(u, 'val') !== 'none';
  if (flag(rPr, 'strike') || flag(rPr, 'dstrike')) out.strike = true;
  else if (flag(rPr, 'strike') === false) out.strike = false;
  const color = child(rPr, 'color');
  if (color) { const v = attr(color, 'val'); if (v && v !== 'auto') out.color = `#${v}`; }
  const hl = child(rPr, 'highlight');
  if (hl && HIGHLIGHT.has(attr(hl, 'val'))) out.highlight = attr(hl, 'val');
  const va = child(rPr, 'vertAlign');
  if (va) { const v = attr(va, 'val'); if (v === 'superscript') out.sup = true; if (v === 'subscript') out.sub = true; }
  if (flag(rPr, 'caps') !== undefined) out.caps = flag(rPr, 'caps');
  if (flag(rPr, 'smallCaps') !== undefined) out.smallCaps = flag(rPr, 'smallCaps');
  // A tracked formatting change keeps the formatting it replaced.
  const change = child(rPr, 'rPrChange');
  if (change) out.fmtChange = { author: attr(change, 'author') || '', date: attr(change, 'date') || '', old: readRPr(child(change, 'rPr')) };
  return out;
}

function readPPr(pPr) {
  if (!pPr) return {};
  const out = {};
  const jc = child(pPr, 'jc'); if (jc) out.jc = attr(jc, 'val');
  const sp = child(pPr, 'spacing');
  if (sp) {
    if (attr(sp, 'before') != null) out.before = twipsToPt(attr(sp, 'before'));
    if (attr(sp, 'after') != null) out.after = twipsToPt(attr(sp, 'after'));
    if (attr(sp, 'line') != null) {
      // "auto" is a multiple of the line in 240ths; "exact" and "atLeast" are twips
      const rule = attr(sp, 'lineRule') || 'auto';
      if (rule === 'auto') out.line = Number(attr(sp, 'line')) / 240;
      else if (rule === 'atLeast') out.lineAtLeast = twipsToPt(attr(sp, 'line'));
      else out.lineExact = twipsToPt(attr(sp, 'line'));
    }
  }
  const ind = child(pPr, 'ind');
  if (ind) {
    const left = attr(ind, 'left') ?? attr(ind, 'start'), right = attr(ind, 'right') ?? attr(ind, 'end');
    if (left != null) out.indLeft = twipsToPt(left);
    if (right != null) out.indRight = twipsToPt(right);
    if (attr(ind, 'hanging') != null) out.indHanging = twipsToPt(attr(ind, 'hanging'));
    if (attr(ind, 'firstLine') != null) out.indFirst = twipsToPt(attr(ind, 'firstLine'));
  }
  if (flag(pPr, 'pageBreakBefore')) out.pageBreakBefore = true;
  if (flag(pPr, 'keepNext')) out.keepNext = true;
  const num = child(pPr, 'numPr');
  if (num) out.num = { numId: attr(child(num, 'numId'), 'val'), ilvl: Number(attr(child(num, 'ilvl'), 'val') || 0) };
  const ol = child(pPr, 'outlineLvl'); if (ol) out.outline = Number(attr(ol, 'val'));
  // A tracked paragraph mark: inserted (a paragraph split) or deleted (a join), with its author.
  const markPr = child(pPr, 'rPr');
  for (const [k, prop] of [['ins', 'markIns'], ['del', 'markDel']]) { const m = child(markPr, k); if (m) out[prop] = { author: attr(m, 'author') || '', date: attr(m, 'date') || '' }; }
  return out;
}

/** styles.xml resolved: each style with its chain of basedOn folded in. */
export function readStyles(xml) {
  const doc = parseXml(xml);
  const out = { default: { run: {}, para: {} }, byId: new Map() };
  const dd = doc.getElementsByTagNameNS(W, 'docDefaults')[0];
  if (dd) {
    out.default.run = readRPr(child(child(dd, 'rPrDefault'), 'rPr'));
    out.default.para = readPPr(child(child(dd, 'pPrDefault'), 'pPr'));
  }
  const raw = new Map();
  for (const st of doc.getElementsByTagNameNS(W, 'style')) {
    const id = attr(st, 'styleId');
    if (!id) continue;
    raw.set(id, {
      id, type: attr(st, 'type'),
      name: attr(child(st, 'name'), 'val') || id,
      basedOn: attr(child(st, 'basedOn'), 'val') || null,
      run: readRPr(child(st, 'rPr')), para: readPPr(child(st, 'pPr')),
    });
  }
  const resolve = (id, seen = new Set()) => {
    const st = raw.get(id);
    if (!st || seen.has(id)) return { run: {}, para: {} };
    seen.add(id);
    const base = st.basedOn ? resolve(st.basedOn, seen) : { run: {}, para: {} };
    return { id, name: st.name, type: st.type, run: { ...base.run, ...st.run }, para: { ...base.para, ...st.para } };
  };
  for (const id of raw.keys()) out.byId.set(id, resolve(id));
  return out;
}

// ---- lists ------------------------------------------------------------------

/** numbering.xml as list definitions keyed by abstract definition, and each num's route to one. */
function readNumbering(xml) {
  const abstracts = new Map(), nums = new Map();
  if (!xml) return { abstracts, nums };
  const doc = parseXml(xml);
  for (const a of doc.getElementsByTagNameNS(W, 'abstractNum')) {
    const levels = [];
    for (const lvl of kids(a, 'lvl')) {
      const i = Number(attr(lvl, 'ilvl') || 0);
      const ind = readPPr(child(lvl, 'pPr'));
      let text = attr(child(lvl, 'lvlText'), 'val') ?? '';
      const fmt = attr(child(lvl, 'numFmt'), 'val') || 'decimal';
      // Symbol-font bullets are private-use code points; show them as bullets.
      if (fmt === 'bullet' && (!text || /[-]/.test(text))) text = ['•', 'o', '▪'][i % 3];
      if (fmt === 'bullet' && text === 'o') text = '◦';
      // A level without its own indent is given the one the page draws it with, so it writes back the same.
      levels[i] = { fmt, text, start: Number(attr(child(lvl, 'start'), 'val') ?? 1), indLeft: ind.indLeft ?? 36 * (i + 1), indHanging: ind.indHanging ?? 18 };
    }
    abstracts.set(attr(a, 'abstractNumId'), { levels });
  }
  for (const n of doc.getElementsByTagNameNS(W, 'num')) {
    const overrides = {};
    for (const o of kids(n, 'lvlOverride')) {
      const s = child(o, 'startOverride');
      if (s) overrides[Number(attr(o, 'ilvl') || 0)] = Number(attr(s, 'val'));
    }
    nums.set(attr(n, 'numId'), { abstract: attr(child(n, 'abstractNumId'), 'val'), overrides });
  }
  return { abstracts, nums };
}

// ---- citations ----------------------------------------------------------------

export function levelOf(styleId, props) {
  if (props.outline === 0) return 'h2';
  if (props.outline === 1) return 'h2';
  if (props.outline === 2) return 'h3';
  const id = String(styleId || '');
  if (/^(Title|Titre|Titel|Título|Titolo)$/i.test(id)) return 'h1';
  const m = id.match(/^(?:Heading|Titre|berschrift|Ttulo|Titolo|Encabezado)\s*(\d)$/i);
  if (m) return Number(m[1]) <= 2 ? 'h2' : 'h3';
  if (/^(Quote|Citation|BlockQuote)$/i.test(id)) return 'quote';
  return 'p';
}

function decodeTag(tag) {
  const i = tag.indexOf('_v3_');
  if (i < 0) return null;
  const b64 = tag.slice(i + 4);
  try {
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    return JSON.parse(utf8.decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { return null; }
}

/**
 * The app's own content controls, so a manuscript exported from here reads
 * back with its citations, results and reference list in place:
 * `LYKOS_CITATION_v1_` + base64 JSON `{ keys, items }` (items: the cited
 * records' bibliographic fields, for a project that lacks them),
 * `LYKOS_RESULT_v1_<key>` and `LYKOS_BIBLIOGRAPHY`.
 */
export function encodeTag(prefix, data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return `${prefix}_v1_${btoa(bin)}`;
}
function decodeOwnTag(tag) {
  const i = tag.indexOf('_v1_');
  if (i < 0) return null;
  try { return JSON.parse(utf8.decode(Uint8Array.from(atob(tag.slice(i + 4)), c => c.charCodeAt(0)))); } catch { return null; }
}
const RECORD_FIELDS = ['title', 'authors', 'journal', 'year', 'doi', 'pmid', 'url', 'volume', 'issue', 'pages', 'label'];
export const citedItem = p => Object.fromEntries([['key', p.key], ...RECORD_FIELDS.filter(k => p[k] != null && p[k] !== '' && !(Array.isArray(p[k]) && !p[k].length)).map(k => [k, p[k]])]);
function recordFromItem(item) {
  const r = { key: item.key, id: item.key, pdf: null, source: 'Word' };
  for (const k of RECORD_FIELDS) r[k] = item[k] ?? (k === 'authors' ? [] : '');
  if (!r.label) r.label = [String(r.authors[0] || 'Study').split(',')[0], r.year].filter(Boolean).join(' ');
  return r;
}
/** CSL citation JSON from a field's instruction (Zotero's ADDIN ZOTERO_ITEM, Mendeley Desktop's ADDIN CSL_CITATION). */
function cslFromField(instr) {
  const m = /^\s*ADDIN\s+(?:ZOTERO_ITEM\s+)?CSL_CITATION\s*(\{[\s\S]*\})\s*$/.exec(instr || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function recordFromCsl(item) {
  const d = item.itemData || {};
  const authors = (d.author || []).map(a =>
    [a.family, a.given].filter(Boolean).join(', ') || a.literal || '').filter(Boolean);
  const year = d.issued?.['date-parts']?.[0]?.[0];
  const doi = d.DOI ? String(d.DOI).trim() : '';
  const pmid = d.PMID ? String(d.PMID).trim() : '';
  const key = recordKey({ doi, pmid, fallback: `mendeley-${item.id || d.id}` });
  const family = (authors[0] || '').split(',')[0].trim().split(/\s+/).pop();
  return {
    key, id: key,
    title: d.title || '', authors, journal: d['container-title'] || '',
    year: year ? String(year) : '', doi, pmid, url: d.URL || '',
    volume: d.volume || '', issue: d.issue || '', pages: d.page || '',
    label: [family || 'Study', year].filter(Boolean).join(' '),
    source: 'Mendeley', pdf: null,
  };
}

// ---- sections -------------------------------------------------------------------

/** One sectPr: page and margins in points, orientation, line numbering, where its header and footer are. */
function readSectPr(sect) {
  const pg = child(sect, 'pgSz'), mar = child(sect, 'pgMar'), ln = child(sect, 'lnNumType');
  const out = {
    pageW: pg ? twipsToPt(attr(pg, 'w')) : 612, pageH: pg ? twipsToPt(attr(pg, 'h')) : 792,
    top: mar ? twipsToPt(attr(mar, 'top')) : 72, right: mar ? twipsToPt(attr(mar, 'right')) : 72,
    bottom: mar ? twipsToPt(attr(mar, 'bottom')) : 72, left: mar ? twipsToPt(attr(mar, 'left')) : 72,
    lineNumbers: ln ? {
      countBy: Number(attr(ln, 'countBy') || 1),
      distance: attr(ln, 'distance') ? twipsToPt(attr(ln, 'distance')) : 18,
      restart: attr(ln, 'restart') || 'newPage',
    } : null,
  };
  if (pg && attr(pg, 'orient') === 'landscape') out.orient = 'landscape';
  out.headerDist = mar && attr(mar, 'header') != null ? twipsToPt(attr(mar, 'header')) : 36;
  out.footerDist = mar && attr(mar, 'footer') != null ? twipsToPt(attr(mar, 'footer')) : 36;
  const type = attr(child(sect, 'type'), 'val'); if (type && type !== 'nextPage') out.breakType = type;
  // Header and footer parts by kind: default, first page, even pages.
  const refs = {};
  for (const k of ['headerReference', 'footerReference']) for (const r of kids(sect, k)) {
    const type = attr(r, 'type') || 'default';
    refs[`${k === 'headerReference' ? 'header' : 'footer'}${type === 'first' ? 'First' : type === 'even' ? 'Even' : ''}`] = r.getAttributeNS(R, 'id') ?? r.getAttribute('r:id');
  }
  out._refs = refs;
  if (flag(sect, 'titlePg')) out.titlePg = true;
  return out;
}

/**
 * Parse a .docx into `{ blocks, records, citations, results, section, styles,
 * lists, notes, comments, media }` (`results`: each linked result's value as
 * the file showed it). A paragraph block:
 * `{ id, type, styleId, props, runs, text }`, where `text` is the plain form
 * with citation tokens — what the checks, the results and the Markdown path
 * read — and `runs` is the formatting the page renders. `media` holds the
 * bytes of each figure block's image, for the caller to store.
 */
export async function parseDocx(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const list = entries(buf);
  const getBytes = async name => { const e = list.find(x => x.name === name); return e ? read(buf, e) : null; };
  const get = async name => { const b = await getBytes(name); return b ? utf8.decode(b) : null; };
  const xml = await get('word/document.xml');
  if (!xml) throw new Error('not a Word document');
  const styles = readStyles((await get('word/styles.xml')) || `<w:styles xmlns:w="${W}"/>`);
  let doc;
  try { doc = parseXml(xml); } catch { throw new Error('document.xml is not well-formed'); }
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('no document body');
  const numbering = readNumbering(await get('word/numbering.xml'));
  const readRels = xml => {
    const out = new Map();
    if (xml) for (const r of parseXml(xml).getElementsByTagName('Relationship')) out.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), type: r.getAttribute('Type'), external: r.getAttribute('TargetMode') === 'External' });
    return out;
  };
  const rels = readRels(await get('word/_rels/document.xml.rels'));
  // The relationships images are looked up in: the document's, or a header's or footer's own while it is read.
  let partRels = rels;
  const partPath = target => target?.startsWith('/') ? target.slice(1) : `word/${target}`;

  const records = new Map();
  const resultShown = {};   // result key -> the value the file showed
  let citations = 0;
  const blocks = [];
  const lists = {};
  const notes = {};
  const comments = {};
  const media = [];

  // Lists: a num with its own start overrides counts on its own; nums sharing
  // an abstract definition otherwise continue one another, as in Word.
  const listOf = (num, styleNum) => {
    const n = num || styleNum;
    if (!n || n.numId == null || n.numId === '0') return null;
    const route = numbering.nums.get(String(n.numId));
    if (!route) return null;
    const def = numbering.abstracts.get(route.abstract);
    if (!def) return null;
    const key = Object.keys(route.overrides).length ? `n${n.numId}` : `a${route.abstract}`;
    if (!lists[key]) {
      const levels = def.levels.map((l, i) => l && ({ ...l, ...(route.overrides[i] != null ? { start: route.overrides[i] } : {}) }));
      lists[key] = { levels: Array.from({ length: 9 }, (_, i) => levels[i] || { fmt: 'decimal', text: `%${i + 1}.`, start: 1, indLeft: 36 * (i + 1), indHanging: 18 }) };
    }
    return { id: key, level: n.ilvl || 0 };
  };

  // Notes and comments, read once, by id.
  const noteParts = {};
  for (const [kind, part] of [['footnote', 'word/footnotes.xml'], ['endnote', 'word/endnotes.xml'], ['comment', 'word/comments.xml']]) {
    const x = await get(part);
    if (!x) continue;
    const map = new Map();
    for (const n of parseXml(x).getElementsByTagNameNS(W, kind)) {
      if (attr(n, 'type') && attr(n, 'type') !== 'normal') continue;   // separators
      map.set(attr(n, 'id'), n);
    }
    noteParts[kind] = map;
  }
  const noteRuns = el => {
    const out = [];
    kids(el, 'p').forEach((p, k) => {
      const rs = [];
      collectRuns(p, rs, {}, { inNote: true });
      if (k && out.length) out.push({ t: '\n' });
      out.push(...rs.filter(r => !(r.t === '' && !r.cite)));
    });
    // The note's own number is a reference mark in its first run; the text follows.
    while (out.length && /^\s+/.test(out[0].t || '')) { out[0] = { ...out[0], t: out[0].t.replace(/^\s+/, '') }; if (!out[0].t) out.shift(); else break; }
    return out;
  };

  const walk = node => {
    for (const c of node.children) {
      const name = c.localName;
      if (name === 'p') paragraph(c).forEach(b => blocks.push(b));
      else if (name === 'sdt') {
        const pr = child(c, 'sdtPr');
        const tag = attr(child(pr, 'tag'), 'val') || '';
        // A reference manager's bibliography, or this app's, is the reference list the document generates.
        if (/^(MENDELEY|LYKOS)_BIBLIOGRAPHY/.test(tag)) {
          const content = child(c, 'sdtContent');
          const lines = content ? kids(content, 'p').map(p => { const rs = []; collectRuns(p, rs, {}); return rs.map(r => (r.del ? '' : r.t || '')).join('').trim(); }).filter(Boolean) : [];
          blocks.push({ id: newId(), type: 'bib', text: '', runs: [], ...(lines.length ? { lines } : {}) });
          continue;
        }
        const gallery = attr(deep(pr, 'docPartGallery'), 'val') || '';
        if (/table of contents/i.test(gallery)) { blocks.push({ id: newId(), type: 'toc', text: '', runs: [] }); continue; }
        const content = child(c, 'sdtContent');
        if (content) walk(content);
      }
      else if (name === 'tbl') { const t = table(c); if (t) blocks.push(t); }
      else if (name !== 'sectPr') walk(c);
    }
  };

  const paragraph = p => {
    const pPr = child(p, 'pPr');
    const styleId = attr(child(pPr, 'pStyle'), 'val') || 'Normal';
    const { num, ...props } = readPPr(pPr);
    const styleNum = styles.byId.get(styleId)?.para?.num;
    const li = listOf(num, styleNum);
    if (li) props.list = li;
    const sect = child(pPr, 'sectPr');
    if (sect) props.section = readSectPr(sect);
    const runs = [];
    const figures = [];
    const marks = [];
    // The paragraph mark's own rPr formats the mark, not the text.
    collectRuns(p, runs, {}, { figures, marks });
    // A page break inside a paragraph ends it: what follows starts a new page.
    const parts = [[]];
    for (const r of runs) { if (r.pageBreak) parts.push([]); else parts.at(-1).push(r); }
    const out = [];
    parts.forEach((rs, k) => {
      const text = rs.map(r => (r.cite ? r.cite.map(key => citeToken(key)).join('') : r.del ? '' : r.t)).join('');
      const first = k === 0, last = k === parts.length - 1;
      const own = { ...props };
      if (!first) { own.pageBreakBefore = true; delete own.list; }
      if (!last) delete own.section;
      // Empty paragraphs are kept: in a Word document a blank line is layout.
      // Only the empty remainder of a paragraph that held an image is not.
      if (figures.length && !text.trim() && !own.pageBreakBefore && !own.section) return;
      const merged = merge(rs);
      out.push({ id: newId(), type: levelOf(styleId, { ...(styles.byId.get(styleId)?.para || {}), ...props }), styleId, props: own, runs: merged, text: merged.map(r => (r.cite ? r.cite.map(key => citeToken(key)).join('') : r.del ? '' : r.t)).join('') });
    });
    if (marks.length && out[0]) for (const n of marks) if (!bookmarks.has(n)) bookmarks.set(n, out[0].id);
    // A paragraph holding only an image is the figure; the figure keeps its alignment.
    if (figures.length) {
      const figs = figures.map(f => ({ id: newId(), type: 'figure', img: f.id, name: f.name, mime: f.mime, w: f.w, h: f.h, props: { ...(props.jc ? { jc: props.jc } : {}), ...(props.section && !out.length ? { section: props.section } : {}) }, text: '' }));
      return [...figs, ...out];
    }
    return out;
  };

  const merge = runs => {
    // Adjacent runs with identical formatting are one run, so the model stays small.
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && !r.cite && !last.cite && sameFmt(last, r)) last.t += r.t;
      else merged.push({ ...r });
    }
    return merged.length ? merged : [{ t: '' }];
  };

  const imageOf = (drawing) => {
    const blip = drawing.getElementsByTagNameNS('*', 'blip')[0];
    const id = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttribute('r:embed');
    const rel = id && partRels.get(id);
    if (!rel || rel.external) return null;
    const ext = drawing.getElementsByTagNameNS('*', 'extent')[0];
    const docPr = drawing.getElementsByTagNameNS('*', 'docPr')[0];
    const path = partPath(rel.target);
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf' }[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
    return { path, mime, name: docPr?.getAttribute('descr') || docPr?.getAttribute('name') || path.split('/').pop(),
      w: ext ? Number(ext.getAttribute('cx')) / EMU_PER_PT : 300, h: ext ? Number(ext.getAttribute('cy')) / EMU_PER_PT : 200 };
  };

  // Complex fields: begin, instruction, separate, result, end. A field whose
  // meaning the document keeps (SEQ, PAGE, NUMPAGES) becomes a token and its
  // cached result is dropped; any other field keeps its result as text.
  const fieldToken = instr => {
    const m = /^\s*(SEQ|PAGE|NUMPAGES|REF)\b\s*([^\s\\]*)/i.exec(instr || '');
    if (!m) return null;
    const kind = m[1].toUpperCase();
    // A cross-reference names a bookmark; it is resolved to its paragraph once every bookmark is known.
    if (kind === 'REF') return m[2] ? `{{xref:@${m[2].replace(/[^A-Za-z0-9._-]/g, '')}}}` : null;
    return kind === 'SEQ' ? `{{seq:${(m[2] || 'Figure').replace(/[^A-Za-z0-9._-]/g, '')}}}` : kind === 'PAGE' ? '{{page}}' : '{{pages}}';
  };
  // A Zotero or Mendeley Desktop citation field becomes a citation run; its shown text is dropped.
  let citeRuns = null;
  const cslCitation = instr => {
    const data = cslFromField(instr);
    if (!data?.citationItems?.length || !citeRuns) return null;
    citations++;
    const keys = [];
    for (const item of data.citationItems) {
      const zotero = /ZOTERO_ITEM/.test(instr);
      const r = recordFromCsl({ ...item, id: zotero ? `zotero-${item.id ?? item.uris?.[0] ?? ''}` : item.id });
      if (zotero) { r.source = 'Zotero'; if (r.key.startsWith('mendeley-zotero-')) r.key = r.id = r.key.slice(9); }
      if (!records.has(r.key)) records.set(r.key, r);
      keys.push(r.key);
    }
    citeRuns.push({ t: '', cite: keys, sup: true });
    return CITED;
  };
  const refShown = new Map();   // bookmark -> the text a REF field showed, in case the bookmark is missing
  const bookmarks = new Map();  // bookmark -> the paragraph it starts in
  const openComments = new Set(), rangedComments = new Set();
  // A comment covers the runs read while its range is open; an empty range is a comment at a point.
  // A reply shares its parent's span: the span carries the parent only.
  const withComments = f => { if (!openComments.size) return f; openComments.forEach(id => rangedComments.add(id)); const cm = [...openComments].filter(id => !comments[id]?.parent); return cm.length ? { ...f, cm } : f; };

  const collectRuns = (el, runs, inherit, ctx = {}, mark = null) => {
    for (const c of el.children) {
      citeRuns = runs;
      const name = c.localName;
      if (name === 'sdt') {
        const tag = attr(child(child(c, 'sdtPr'), 'tag'), 'val') || '';
        const data = tag.startsWith('MENDELEY_CITATION') ? decodeTag(tag) : null;
        if (data?.citationItems?.length) {
          citations++;
          const keys = [];
          for (const item of data.citationItems) {
            const r = recordFromCsl(item);
            if (!records.has(r.key)) records.set(r.key, r);
            keys.push(r.key);
          }
          runs.push({ t: '', cite: keys, sup: true });
        } else if (tag.startsWith('LYKOS_CITATION')) {
          const own = decodeOwnTag(tag);
          const keys = (own?.keys || []).filter(k => typeof k === 'string' && k);
          if (keys.length) {
            citations++;
            for (const item of own.items || []) if (item?.key && keys.includes(item.key) && !records.has(item.key)) records.set(item.key, recordFromItem(item));
            runs.push({ t: '', cite: keys, sup: true });
          }
        } else if (tag.startsWith('LYKOS_RESULT_v1_') && /^[A-Za-z0-9._:-]+$/.test(tag.slice(16))) {
          // A result keeps its link; the value is drawn from the project, with the formatting it had.
          const shown = [];
          const content = child(c, 'sdtContent');
          if (content) collectRuns(content, shown, inherit, ctx, mark);
          const { t: _t, cite: _c, ...fmt } = shown.find(r => r.t) || {};
          runs.push({ ...fmt, t: `{{${tag.slice(16)}}}` });
          resultShown[tag.slice(16)] = shown.map(r => (r.del ? '' : r.t || '')).join('');
        } else {
          const content = child(c, 'sdtContent');
          if (content) collectRuns(content, runs, inherit, ctx, mark);
        }
      }
      else if (name === 'fldSimple') {
        const token = fieldToken(attr(c, 'instr'));
        if (token) {
          runs.push(withComments({ t: token, ...(mark || {}) }));
          if (token.startsWith('{{xref:@')) { const shown = []; collectRuns(c, shown, inherit, {}, null); refShown.set(token, shown.map(r => r.t || '').join('')); }
        }
        else collectRuns(c, runs, inherit, ctx, mark);
      }
      else if (name === 'bookmarkStart') { const n = attr(c, 'name'); if (n && ctx.marks) ctx.marks.push(n); }
      else if (name === 'commentRangeStart') openComments.add(`c${attr(c, 'id')}`);
      else if (name === 'commentRangeEnd') openComments.delete(`c${attr(c, 'id')}`);
      else if (name === 'r') {
        const rPr = child(c, 'rPr');
        const rStyle = attr(child(rPr, 'rStyle'), 'val');
        const fmt = withComments({ ...inherit, ...(rStyle ? styles.byId.get(rStyle)?.run : {}), ...readRPr(rPr), ...(mark || {}) });
        let t = '';
        const flush = () => { if (t) { if (!ctx.field || ctx.field.phase !== 'result' || !ctx.field.token) runs.push({ t, ...fmt }); else ctx.field.result = (ctx.field.result || '') + t; t = ''; } };
        for (const k of c.children) {
          const kn = k.localName;
          if (kn === 'fldChar') {
            flush();
            const type = attr(k, 'fldCharType');
            if (type === 'begin') ctx.field = { phase: 'instr', instr: '', token: null };
            else if (type === 'separate' && ctx.field) { ctx.field.phase = 'result'; ctx.field.token = fieldToken(ctx.field.instr) || cslCitation(ctx.field.instr); if (ctx.field.token && ctx.field.token !== CITED) runs.push({ t: ctx.field.token, ...(mark || {}) }); }
            else if (type === 'end' && ctx.field) {
              if (ctx.field.phase === 'instr') { const token = fieldToken(ctx.field.instr) || cslCitation(ctx.field.instr); if (token && token !== CITED) runs.push({ t: token, ...(mark || {}) }); }
              if (ctx.field.token?.startsWith('{{xref:@')) refShown.set(ctx.field.token, ctx.field.result || '');
              ctx.field = null;
            }
            continue;
          }
          if (kn === 'instrText') { if (ctx.field) ctx.field.instr += k.textContent; continue; }
          if (ctx.field?.phase === 'instr') continue;
          if (kn === 't' || kn === 'delText') t += k.textContent;
          else if (kn === 'tab' || kn === 'ptab') t += '\t';
          else if (kn === 'br' || kn === 'cr') {
            if (attr(k, 'type') === 'page') { flush(); runs.push({ pageBreak: true }); }
            else t += '\n';
          }
          else if (kn === 'noBreakHyphen') t += '‑';
          else if (kn === 'sym') { const ch = parseInt(attr(k, 'char') || '', 16); if (ch >= 0x20 && !(ch >= 0xF000 && ch <= 0xF0FF)) t += String.fromCodePoint(ch); }
          else if (kn === 'footnoteReference' || kn === 'endnoteReference') {
            flush();
            const kind = kn === 'footnoteReference' ? 'footnote' : 'endnote';
            const src = noteParts[kind]?.get(attr(k, 'id'));
            if (src) {
              const id = `${kind[0]}${attr(k, 'id')}`;
              if (!notes[id]) { const rs = noteRuns(src); notes[id] = { kind, runs: merge(rs), text: rs.map(r => r.t || '').join('') }; }
              runs.push({ t: `{{fn:${id}}}`, ...(mark || {}) });
            }
          }
          else if (kn === 'commentReference') {
            flush();
            // A comment on a span is carried by the span's runs; one on no text is a mark at its reference.
            const id = `c${attr(k, 'id')}`;
            if (comments[id] && !comments[id].parent && !rangedComments.has(id)) runs.push({ t: `{{cm:${id}}}` });
          }
          else if ((kn === 'drawing' || kn === 'pict') && ctx.figures) {
            const img = imageOf(k);
            if (img) { const id = `im${newId().slice(1)}`; ctx.figures.push({ id, ...img }); media.push({ id, path: img.path, name: img.name, mime: img.mime }); }
          }
        }
        flush();
      }
      else if (name === 'ins' || name === 'moveTo') collectRuns(c, runs, inherit, ctx, { ins: changeOf(c) });
      else if (name === 'del' || name === 'moveFrom') collectRuns(c, runs, inherit, ctx, { del: changeOf(c) });
      else if (name === 'hyperlink' || name === 'smartTag' || name === 'customXml') collectRuns(c, runs, inherit, ctx, mark);
    }
  };
  const changeOf = el => ({ author: attr(el, 'author') || '', date: attr(el, 'date') || '' });

  const table = tbl => {
    const grid = kids(child(tbl, 'tblGrid'), 'gridCol').map(g => twipsToPt(attr(g, 'w') || 0));
    const tblPr = child(tbl, 'tblPr');
    const borders = child(tblPr, 'tblBorders');
    const has = side => { const b = child(borders, side); return b && !/^(nil|none)$/.test(attr(b, 'val') || ''); };
    const border = !borders ? 'all' : ['insideH', 'insideV', 'left'].every(has) ? 'all'
      : has('top') && has('bottom') ? 'apa' : ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].some(has) ? 'all' : 'none';
    const rows = [];
    for (const tr of kids(tbl, 'tr')) {
      const trPr = child(tr, 'trPr');
      const cells = [];
      const before = Number(attr(child(trPr, 'gridBefore'), 'val') || 0);
      for (let k = 0; k < before; k++) cells.push({ runs: [{ t: '' }], text: '' });
      // A row inserted or deleted with changes tracked; its text carries the same mark, which the row's stands for.
      const rowMark = {};
      for (const k of ['ins', 'del']) { const m = child(trPr, k); if (m) rowMark[k] = changeOf(m); }
      for (const tc of kids(tr, 'tc')) {
        const tcPr = child(tc, 'tcPr');
        const span = Math.max(1, Number(attr(child(tcPr, 'gridSpan'), 'val') || 1));
        const vm = child(tcPr, 'vMerge');
        // A column inserted or deleted with changes tracked: Word's cell revision marks.
        const cellMark = {};
        for (const [k, prop] of [['cellIns', 'cellIns'], ['cellDel', 'cellDel']]) { const m = child(tcPr, k); if (m) cellMark[prop] = changeOf(m); }
        const same = (a, b) => a && b && a.author === b.author && a.date === b.date;
        const unmark = runs => runs.map(r => {
          if (r.del && (same(r.del, rowMark.del) || same(r.del, cellMark.cellDel))) { const { del, ...x } = r; return x; }
          if (r.ins && (same(r.ins, rowMark.ins) || same(r.ins, cellMark.cellIns))) { const { ins, ...x } = r; return x; }
          return r;
        });
        if (vm && attr(vm, 'val') !== 'restart') {
          cells.push({ merged: 'up', ...cellMark });
        } else {
          const rs = [];
          let props = null;
          for (const p of kids(tc, 'p')) {
            if (props == null) props = (({ num, ...x }) => x)(readPPr(child(p, 'pPr')));
            if (rs.length) rs.push({ t: '\n' });
            collectRuns(p, rs, {});
          }
          // A table nested in a cell is kept as its text.
          for (const inner of kids(tc, 'tbl')) { const t = table(inner); if (t?.text) rs.push({ t: (rs.length ? '\n' : '') + t.text }); }
          const clean = merge(unmark(rs.filter(r => !r.pageBreak)));
          const cell = { runs: clean, text: clean.map(r => (r.cite ? r.cite.map(key => citeToken(key)).join('') : r.del ? '' : r.t)).join(''), ...cellMark };
          if (props && Object.keys(props).length) cell.props = props;
          const shd = attr(child(tcPr, 'shd'), 'fill'); if (shd && /^[0-9a-f]{6}$/i.test(shd)) cell.shade = `#${shd}`;
          const va = attr(child(tcPr, 'vAlign'), 'val'); if (va && va !== 'top') cell.valign = va;
          cells.push(cell);
        }
        for (let k = 1; k < span; k++) cells.push({ merged: 'left', ...cellMark });
      }
      rows.push({ ...(child(trPr, 'tblHeader') && flag(trPr, 'tblHeader') !== false ? { header: true } : {}), ...rowMark, cells });
    }
    const cols = Math.max(grid.length, ...rows.map(r => r.cells.length));
    if (!cols || !rows.length) return null;
    // A continued merge's own row is short when its cell spans; pad every row to the grid.
    for (const r of rows) while (r.cells.length < cols) r.cells.push({ runs: [{ t: '' }], text: '' });
    const width = grid.length === cols ? grid : Array(cols).fill(Math.round(468 / cols));
    const g = { cols: width, rows, borders: border };
    const jc = attr(child(tblPr, 'jc'), 'val'); if (jc && jc !== 'left' && jc !== 'start') g.jc = jc;
    const text = rows.map(r => r.cells.filter(c => !c.merged).map(c => c.text).join('\t')).join('\n').trim();
    return { id: newId(), type: 'table', styleId: 'Table', grid: g, text };
  };

  // Every comment, with its replies: Word 2013+ keeps a reply's parent in
  // commentsExtended.xml, keyed by the paraId of each comment's last paragraph.
  const extended = await get('word/commentsExtended.xml');
  const parentOf = new Map(), doneOf = new Set();
  if (extended) for (const e of parseXml(extended).getElementsByTagName('w15:commentEx')) {
    if (e.getAttribute('w15:paraIdParent')) parentOf.set(e.getAttribute('w15:paraId'), e.getAttribute('w15:paraIdParent'));
    if (e.getAttribute('w15:done') === '1') doneOf.add(e.getAttribute('w15:paraId'));
  }
  const byPara = new Map();
  for (const [wid, src] of noteParts.comment || []) {
    const id = `c${wid}`;
    const rs = noteRuns(src);
    const paraId = kids(src, 'p').at(-1)?.getAttribute('w14:paraId');
    if (paraId) byPara.set(paraId, id);
    comments[id] = { author: attr(src, 'author') || '', initials: attr(src, 'initials') || '', date: attr(src, 'date') || '', text: rs.map(r => r.t || '').join(''), ...(paraId ? { _para: paraId } : {}) };
  }
  for (const c of Object.values(comments)) {
    if (c._para && parentOf.has(c._para)) { const p = byPara.get(parentOf.get(c._para)); if (p) c.parent = p; }
    if (c._para && doneOf.has(c._para)) c.done = true;
  }
  for (const c of Object.values(comments)) delete c._para;
  walk(body);
  // Cross-references to bookmarks become references to the paragraph that
  // holds the bookmark; one whose bookmark is gone keeps the text it showed.
  const resolveRefs = t => String(t).replace(/\{\{xref:@([A-Za-z0-9._-]+)\}\}/g, (m, name) => bookmarks.has(name) ? `{{xref:${bookmarks.get(name)}}}` : (refShown.get(m) ?? ''));
  const fixRuns = rs => (rs || []).map(r => r.t?.includes('{{xref:@') ? { ...r, t: resolveRefs(r.t) } : r);
  for (const b of blocks) {
    if (b.runs) { b.runs = fixRuns(b.runs); b.text = resolveRefs(b.text); }
    if (b.grid) for (const row of b.grid.rows) for (const c of row.cells) if (c.runs) { c.runs = fixRuns(c.runs); c.text = resolveRefs(c.text); }
  }
  for (const n of Object.values(notes)) { n.runs = fixRuns(n.runs); n.text = resolveRefs(n.text); }
  recognizeSections(blocks);

  // The document's last section is the body's own sectPr.
  const bodySect = kids(body, 'sectPr').at(-1) || [...body.getElementsByTagNameNS(W, 'sectPr')].pop();
  const section = bodySect ? readSectPr(bodySect) : readSectPr(null);
  // Headers and footers per section and kind, text with page fields as
  // tokens. A section names only the parts it defines; one it does not name
  // is the previous section's (lib/manuscript-doc.mjs headerFooterFor). A
  // part with no text is kept as null: a blank first page, say.
  // A part that holds a picture or a table also keeps its content as a small
  // block list, read by the same paragraph and table readers as the body and
  // drawn with the same renderers; its text stays the plain form the header
  // dialog edits. Its pictures are found through the part's own relationships.
  const partText = new Map();
  const readPart = async rid => {
    if (partText.has(rid)) return partText.get(rid);
    const rel = rels.get(rid);
    const path = rel && partPath(rel.target);
    const x = path && await get(path);
    let value = null;
    if (x) {
      const root = parseXml(x).documentElement;
      const ps = root ? kids(root, 'p').concat(kids(root, 'sdt').flatMap(s => kids(child(s, 'sdtContent'), 'p'))) : [];
      const lines = ps.map(p => { const rs = []; collectRuns(p, rs, {}); return { text: rs.map(r => r.t || '').join(''), jc: attr(child(child(p, 'pPr'), 'jc'), 'val') }; }).filter(l => l.text.trim());
      if (lines.length) value = { text: lines.map(l => l.text).join('\n'), ...(lines[0].jc ? { jc: lines[0].jc } : {}) };
      const rich = root && (kids(root, 'tbl').length || root.getElementsByTagNameNS('*', 'drawing').length || root.getElementsByTagNameNS('*', 'pict').length);
      if (rich) {
        partRels = readRels(await get(path.replace(/([^/]+)$/, '_rels/$1.rels')));
        const own = [];
        const walkPart = node => { for (const c of node.children) {
          if (c.localName === 'p') own.push(...paragraph(c));
          else if (c.localName === 'tbl') { const t = table(c); if (t) own.push(t); }
          else if (c.localName === 'sdt') { const content = child(c, 'sdtContent'); if (content) walkPart(content); }
        } };
        walkPart(root);
        partRels = rels;
        // Blank lines around the content are Word's paragraph marks, not content.
        while (own.length && isBlankPara(own.at(-1))) own.pop();
        while (own.length && isBlankPara(own[0])) own.shift();
        if (own.length) value = { ...(value || { text: '' }), blocks: own };
      }
    }
    partText.set(rid, value);
    return value;
  };
  for (const sec of [...blocks.filter(b => b.props?.section).map(b => b.props.section), section]) {
    for (const [k, rid] of Object.entries(sec._refs || {})) { const v = await readPart(rid); if (v || rels.has(rid)) sec[k] = v; }
    delete sec._refs;
  }
  const settingsXml = await get('word/settings.xml');
  if (settingsXml && /<w:evenAndOddHeaders(?![^>]*w:val="(?:0|false)")/.test(settingsXml)) section.evenOdd = true;
  const trackChanges = !!settingsXml && /<w:trackRevisions(?![^>]*w:val="(?:0|false)")/.test(settingsXml);
  for (const m of media) { m.bytes = await getBytes(m.path); delete m.path; }

  return { blocks, records: [...records.values()], citations, results: resultShown, section, styles: serialiseStyles(styles), lists, notes, comments, media: media.filter(m => m.bytes), trackChanges };
}

const isBlankPara = b => b.type !== 'table' && b.type !== 'figure' && !String(b.text || '').trim();

const FMT_KEYS = ['font', 'sz', 'b', 'i', 'u', 'strike', 'color', 'highlight', 'sup', 'sub', 'caps', 'smallCaps', 'ins', 'del', 'fmtChange', 'cm'];
const sameFmt = (a, b) => FMT_KEYS.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

/** Styles as plain data, so they can live in the project store. */
function serialiseStyles(st) {
  const byId = {};
  for (const [id, v] of st.byId) byId[id] = { name: v.name, ...(v.type && v.type !== 'paragraph' ? { type: v.type } : {}), run: v.run, para: (({ num, ...p }) => p)(v.para) };
  return { default: { run: st.default.run, para: (({ num, ...p }) => p)(st.default.para) }, byId };
}
