// A Word file as a reading page (views/manuscript-reader.mjs): a registered manuscript or supplement drawn as text that reflows, not as
// Word's pages. The document's own structure is kept (title, headings, paragraphs with their italics, bold, super- and subscripts, lists,
// tables with their merged cells, figures, captions, the reference list and footnotes); its fonts, sizes and colours are not, so the page
// reads in the app's own type. Read-only: the Word file stays the source and opens in Word from the title bar.
//
// What is built here is HTML text, one unit per block (a long reference list in parts), so the view can put a large supplement on the page
// a part at a time. Each unit keeps its plain text for the search and its words for the outline. Numbers that the project's number check
// matched to a source (lib/number-sources.mjs) are marked with that row; captions name the Lykos output they were made from.
// Pure: takes what lib/docx.mjs parseDocx returned.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { parseEntry, prepareLibrary, matchEntry } from './reference-list.mjs';
import { lib_manuscript$runs as tokens, lib_manuscript$wordCount as wordCount } from "../boot.mjs";
import { listMarkers, spanOf } from './manuscript-doc.mjs';
import { linkNumbers, nearNumbers, normalised } from './number-sources.mjs';
import { checkedUnits } from './number-check.mjs';

const REFS = /^e?references$/i;
// a caption names its table or figure first: "Table 1 …", "eTable 3. …", "Figure 2 …", "eFigure 9. …", "Supplementary Table S1. …"
const CAPTION = /^(?:Supplementary\s+)?(e?(?:Table|Figure))\s+(S?\d+)\b/;
const REF_CHUNK = 60;
const plainOf = html => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[k]);

/** A heading's level: 1 for Heading 1, 2 for Heading 2…; 0 for the document's title. */
export function headingLevel(b) {
  if (b.styleId === 'Title') return 0;
  const n = /^Heading(\d)$/i.exec(b.styleId || '')?.[1] || (b.props?.outline != null ? b.props.outline + 1 : null);
  if (n) return Number(n);
  return { h1: 0, h2: 1, h3: 2 }[b.type] ?? null;
}
const isHeading = b => /^h[1-6]$/.test(b.type) || /^Heading\d$/i.test(b.styleId || '') || b.styleId === 'Title';
// the text a number check reads: a citation's number and a superscript eReference number are not numbers of the text (the sham review's
// 07-check-numbers.mjs); a table's runs are joined by " | "
const counted = r => !r.cite && !(r.sup && /^e?[\d,–-]+$/.test(r.t || ''));

/**
 * The reading page of a parsed Word file.
 *   numberRows   the number check's rows (parseNumberCheck), `file` the name the check gives this file
 *   placed       the structured check's places of this file's numbers (lib/number-check.mjs placedRows): used instead of matching the
 *                rows again while every place still holds its number (a file edited since is matched again)
 *   stale        { results, record, outputs: Set of output ids, rows: Map(structured row n -> why) }: what changed in the data after it was
 *                built (marks those numbers; with `rows`, a structured number is stale only when the values it rests on changed)
 *   outputs      Map of a caption's place ("Table 1", "eFigure 3") to { id, title, stale, staleText }: the Lykos output it was made from
 *   figures      Map of a figure legend's place to a picture file in the folder (a manuscript's figures travel as their own files)
 *   sectionWords Map of a heading's block index to its words as the journal counts them (lib/manuscript-structure.mjs structureCounts)
 * Returns { title, units, outline, numbers, linked }: units [{ kind, block (the index of the file's block), level, html, text, words }], outline [{ unit, level, name, words,
 * value }], numbers [{ row, number, near }] that the units' marks name by index.
 */
export function readingModel(d, { file = '', numberRows = null, placed = null, stale = {}, outputs = null, figures = null, sectionWords = null } = {}) {
  const blocks = d?.blocks || [];
  const markers = listMarkers(blocks, d?.lists || {});
  const records = new Map((Array.isArray(d?.records) ? d.records : Object.values(d?.records || {})).map(p => [p.key, p]));
  const refs = referencesOf(blocks);
  const cited = new Map();   // a reference's key -> how many citations in the text name it
  const tally = keys => { for (const k of keys) cited.set(k, (cited.get(k) || 0) + 1); };
  // the number check's text: every block outside the reference list, in order (lib/number-check.mjs, as the registration placed them)
  const checked = checkedUnits(blocks);
  const linksOf = new Map();
  let linked = 0;
  const holds = (c, g) => normalised(c.t.slice(g.start, g.end)).text === g.row.number;
  if (placed?.size && checked.every(c => (placed.get(c.i) || []).every(g => holds(c, g)))) {
    for (const c of checked) { const ranges = placed.get(c.i); if (ranges?.length) { linksOf.set(c.i, { raw: c.t, ranges: ranges.map(g => ({ ...g })) }); linked += ranges.length; } }
  } else if (numberRows?.length) {
    const found = linkNumbers(numberRows, file, checked.map(c => c.t));
    checked.forEach((c, k) => { if (found[k].length) { linksOf.set(c.i, { raw: c.t, ranges: found[k] }); linked += found[k].length; } });
  }
  const numbers = [];

  // A unit's runs as HTML. `st.at` follows each run's place in the checked text (runs that count joined by `joint`, " | " in a table, whose
  // cells share one text), so a number's range lands on its own characters.
  const runsHtml = (rs, links, st = { at: 0, first: true }, joint = '') => {
    let html = '';
    const ranges = links?.ranges || [];
    for (const r of rs || []) {
      const base = counted(r) ? (st.first ? st.at : st.at + joint.length) : st.at;
      if (counted(r)) { st.at = base + (r.t || '').length; st.first = false; }
      if (r.cite) { html += citeHtml(r); continue; }
      if (r.del) continue;
      // a citation typed as a raised number ("¹²", "e114") names its entries of the reference list when this file holds them
      if (r.sup && /^e?[\d,–-]+$/.test(r.t || '')) { const keys = citedKeys(r.t, refs); if (keys) { tally(keys); html += `<sup class="msd-cite" data-refs="${esc(keys.join(' '))}" tabindex="0">${esc(r.t)}</sup>`; continue; } }
      let inner = '', off = base;
      for (const piece of tokens(r.t || '')) {
        if (piece.kind === 'text') { inner += textHtml(piece.text, off, ranges, links?.raw); off += piece.text.length; continue; }
        off += piece.end - piece.start;
        if (piece.kind === 'result') inner += tokenHtml(piece.key, d);
      }
      html += wrap(r, inner);
    }
    return html;
  };
  const textHtml = (text, base, ranges, raw) => {
    let out = '', at = 0;
    for (const g of ranges) {
      const s = Math.max(g.start - base, at), e = Math.min(g.end - base, text.length);
      if (e <= s || g.end <= base || g.start >= base + text.length) continue;
      out += esc(text.slice(at, s));
      if (g.n == null) { g.n = numbers.length; numbers.push({ row: g.row, number: g.row.number, near: nearNumbers(raw, g.start, g.end) }); }
      const k = g.row.check && stale.rows ? (stale.rows.has(g.row.check.n) ? 'values' : '') : staleKind(g.row.source, stale);
      // an unmatched number carries its own warning rule: a paragraph's check card folds every unmatched number after the first (W11)
      out += `<span class="msd-num${k ? ' is-stale' : ''}${g.row.check?.status === 'unmatched' ? ' is-unmatched' : ''}" data-n="${g.n}">${esc(text.slice(s, e))}</span>`;
      at = e;
    }
    return out + esc(text.slice(at));
  };
  const citeHtml = r => {
    const shown = r.shown || '';
    const names = (r.cite || []).map(k => records.get(k)).filter(Boolean).map(p => [p.authors?.[0]?.split(',')[0], p.year].filter(Boolean).join(' ') + (p.title ? `. ${p.title}` : ''));
    // a citation shows the entries it cites (views/manuscript-reader.mjs): by its numbers in the file's own reference list, else by the
    // reference manager's records the file carries
    const keys = (r.cite || []).filter(k => records.has(k)), nums = citedKeys(shown, refs);
    if (nums) tally(nums);
    const attrs = `${nums ? ` data-refs="${esc(nums.join(' '))}"` : ''}${keys.length ? ` data-keys="${esc(keys.join(' '))}"` : ''}`;
    return `<sup class="msd-cite"${attrs}${attrs ? ' tabindex="0"' : names.length ? ` title="${esc(names.join('\n'))}"` : ''}>${esc(shown || '*')}</sup>`;
  };

  const units = [], outline = [];
  let title = '', afterTable = false, legends = false, level = 0, refsSeen = false;
  blocks.forEach((b, i) => {
    const links = linksOf.get(i);
    if (b.type === 'bib') {
      const lines = b.lines || [];
      for (let k = 0; k < lines.length; k += REF_CHUNK) {
        const html = lines.slice(k, k + REF_CHUNK).map(line => {
          const m = /^(e?\d+\.)\s+/.exec(line);
          return `<p class="msd-ref">${m ? `<span class="msd-ref-n">${esc(m[1])}</span>${esc(line.slice(m[0].length))}` : esc(line)}</p>`;
        }).join('');
        units.push({ kind: 'refs', block: i, html: `<div class="msd-refs">${html}</div>`, refs: Math.min(REF_CHUNK, lines.length - k), words: 0 });
      }
      return;
    }
    if (b.type === 'figure') {
      afterTable = false;
      // the figure's place, from its caption under it (or over it): the Lykos output it was made from draws it in the app's style
      const near = [blocks[i + 1], blocks[i - 1]].map(x => x?.type === 'p' && CAPTION.exec((x.runs || []).map(r => r.t || '').join('').trim())).find(Boolean);
      const place = near && /Figure/.test(near[1]) ? `${near[1]} ${near[2]}` : '';
      units.push({ kind: 'figure', block: i, html: `<figure class="msd-fig"${place ? ` data-place="${esc(place)}"` : ''}><img alt="${esc(b.name || place || 'Figure')}" data-media="${esc(b.img || '')}"${b.w && b.h ? ` width="${Math.round(b.w)}" height="${Math.round(b.h)}"` : ''} decoding="async"></figure>`, words: 0, ...(place ? { place } : {}) });
      return;
    }
    if (b.type === 'table' && b.grid) {
      afterTable = true;
      const st = { at: 0, first: true };
      units.push({ kind: 'table', block: i, html: tableHtml(b, rs => runsHtml(rs, links, st, ' | ')), words: 0 });
      return;
    }
    const text = (b.runs || []).map(r => (r.cite || r.del ? '' : r.t || '')).join('');
    if (isHeading(b) && text.trim()) {
      afterTable = false;
      const lv = headingLevel(b) ?? 1;
      if (lv === 0 && !title) { title = text.trim(); units.push({ kind: 'title', block: i, level: 0, html: `<h1 class="msd-title">${runsHtml(b.runs, links)}</h1>`, words: 0 }); return; }
      level = lv;
      legends = /legends?$/i.test(text.trim());
      if (REFS.test(text.trim())) refsSeen = true;
      const tag = `h${Math.min(6, lv + 1)}`;
      outline.push({ unit: units.length, block: i, level: lv, name: text.trim(), own: 0 });
      units.push({ kind: 'heading', block: i, level: lv, html: `<${tag} class="msd-h" data-level="${lv}">${runsHtml(b.runs, links)}</${tag}>`, words: 0 });
      return;
    }
    if (!text.trim()) { afterTable = false; return; }
    const cap = CAPTION.exec(text.trim());
    const next = blocks.slice(i + 1).find(x => x.type !== 'p' || (x.runs || []).some(r => (r.t || '').trim()));
    const isCaption = !!cap && (legends || next?.type === 'table' || next?.type === 'figure' || blocks[i - 1]?.type === 'figure');
    const place = isCaption ? `${cap[1]} ${cap[2]}` : '';
    const cls = ['msd-p', isCaption ? 'msd-cap' : '', !isCaption && afterTable ? 'msd-note' : '', b.props?.jc === 'center' ? 'msd-center' : ''].filter(Boolean).join(' ');
    if (isCaption) afterTable = false;
    const marker = markers.get(b.id);
    const body = runsHtml(b.runs, links);
    // a caption made from a Lykos output opens it from one quiet mark at its end; what changed since it was drawn is said under it
    const o = isCaption ? outputs?.get(place) : null;
    const open = o ? ` <button type="button" class="msd-out" data-out="${esc(o.id)}" data-title="${esc(o.title || '')}" title="${esc(`Open ${place} in Tables and figures`)}" aria-label="${esc(`Open ${place} in Tables and figures`)}">${icon('outputs', { size: 12 })}</button>` : '';
    let html = `<p class="${cls}"${place ? ` data-place="${esc(place)}"` : ''}>${marker != null ? `<span class="msd-marker">${esc(marker)}</span>` : ''}${body}${open}</p>`;
    if (o?.stale) html += `<p class="msd-stale">${esc(o.staleText || 'Changed since the manuscript was built')}</p>`;
    if (isCaption) {
      // a legend whose picture travels as a file beside the manuscript ("Figures/Figure2_rob_summary.png"): the figure stands over its legend,
      // as on a journal's page (2 Nov 2026: drawn under it, a figure read as the next legend's)
      const pic = figures?.get(place);
      if (legends && /Figure/.test(cap[1]) && (pic || o)) html = `<figure class="msd-fig" data-place="${esc(place)}">${pic ? `<img alt="${esc(place)}" data-file="${esc(pic)}" decoding="async">` : ''}</figure>${html}`;
      // a figure's legend sits under its legends heading; a table or a supplement's eFigure is an item of the document's own
      outline.push({ unit: units.length, block: i, level: legends && /Figure/.test(cap[1]) ? level + 1 : 1, name: captionTitle(b.runs, text), caption: place, own: 0 });
    }
    const words = isCaption || afterTable || refsSeen && !legends ? 0 : wordCount(text);
    units.push({ kind: isCaption ? 'caption' : 'p', block: i, html, words, ...(place ? { place } : {}) });
  });
  if (!refsSeen && units.some(u => u.kind === 'refs')) {
    // a reference list with no heading of its own still has its place in the outline
    const at = units.findIndex(u => u.kind === 'refs');
    outline.push({ unit: at, level: 1, name: 'References', own: 0 });
    outline.sort((a, b) => a.unit - b.unit);
  }
  for (const u of units) u.text = plainOf(u.html);

  // each heading's words: its own paragraphs, the journal's count where one is given, and its sub-sections' words under it
  if (outline[0] && outline[0].unit > 1) outline.unshift({ unit: 0, level: 1, name: 'Title page', own: 0 });
  const heads = outline.filter(o => !o.caption);
  heads.forEach(h => {
    // up to the next heading, or an item of the document's own (a table, a supplement's eFigure) at the heading's level or above
    const end = outline.find(o => o.unit > h.unit && (!o.caption || o.level <= h.level))?.unit ?? units.length;
    for (let u = h.unit + 1; u < end; u++) h.own += units[u].words || 0;
    h.refs = units.slice(h.unit + 1, end).reduce((n, u) => n + (u.refs || 0), 0);
    if (sectionWords?.has(h.block)) h.own = sectionWords.get(h.block);
  });
  // a heading's parent is the nearest heading above it of a higher level; its words are its own and its sub-sections'
  const parent = heads.map((h, k) => { for (let j = k - 1; j >= 0; j--) if (heads[j].level < h.level) return j; return -1; });
  heads.forEach(h => { h.words = h.own; });
  for (let k = heads.length - 1; k >= 0; k--) if (parent[k] >= 0) heads[parent[k]].words += heads[k].words;
  for (const h of heads) if (h.name === 'Title page') h.words = 0;
  for (const h of heads) h.value = h.refs ? `${h.refs.toLocaleString('en')} references` : h.words ? h.words.toLocaleString('en') : '';
  for (const o of outline) delete o.own;
  return { title, units, outline, numbers, linked, refs, records, cited };
}

/**
 * A caption's title for the outline: its bold lead ("Figure 2 Risk of Bias Summary (RoB 2)"), else its first sentence; a long one is cut at a
 * word, so the outline holds the title, not the legend.
 */
export function captionTitle(runs, text) {
  let lead = '';
  for (const r of runs || []) { if (r.cite || r.del) continue; if (!r.b && (r.t || '').trim()) break; lead += r.t || ''; }
  const whole = String(text || '').trim().replace(/\s+/g, ' ');
  let t = lead.trim().replace(/\s+/g, ' ');
  if (!t.replace(CAPTION, '').trim()) {
    // no bold title: the place, then the caption's first sentence
    const place = CAPTION.exec(whole)?.[0] || '', rest = whole.slice(place.length).replace(/^[.:\s]+/, '');
    t = `${place} ${/^(.+?[.:])(?:\s|$)/.exec(rest)?.[1] || rest}`.trim();
  }
  t = t.replace(/[.:]$/, '');
  if (t.length <= 90) return t;
  const cut = t.slice(0, 88), sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * The file's own reference list, by the number each entry carries ("12." or "e12."): { key: '12' | 'e12', text (the entry without its
 * number), doi, title, year, journal }.
 */
export function referencesOf(blocks) {
  const out = new Map();
  for (const b of blocks || []) {
    if (b.type !== 'bib') continue;
    for (const line of b.lines || []) {
      const m = /^(e?)(\d{1,4})\.\s+/.exec(line);
      if (!m) continue;
      const e = parseEntry(line);
      out.set(`${m[1]}${Number(m[2])}`, { key: `${m[1]}${Number(m[2])}`, text: line.slice(m[0].length).trim(), doi: e.doi || '', title: e.title || '', year: e.year || '', journal: e.journal || '', pmid: e.pmid || '', first: e.first || '' });
    }
  }
  return out;
}
/** The reference-list keys a citation's shown numbers name ("1,2", "10–12", "e3-e5"), or null when one of them is not in the list. */
export function citedKeys(shown, refs) {
  const keys = [];
  for (const part of String(shown || '').split(/\s*,\s*/)) {
    const m = /^(e?)(\d{1,4})(?:\s*[-–]\s*e?(\d{1,4}))?$/.exec(part.trim());
    if (!m) return null;
    const a = Number(m[2]), z = m[3] ? Number(m[3]) : a;
    if (z < a || z - a > 60) return null;
    for (let k = a; k <= z; k++) keys.push(`${m[1]}${k}`);
  }
  return keys.length && refs?.size && keys.every(k => refs.has(k)) ? keys : null;
}

// A run's formatting as the document has it: bold, italics, underline, struck, raised, lowered, capitals and highlight; never its font,
// size or colour.
function wrap(r, html) {
  if (!html) return '';
  if (r.sup) html = `<sup>${html}</sup>`; else if (r.sub) html = `<sub>${html}</sub>`;
  if (r.b) html = `<strong>${html}</strong>`;
  if (r.i) html = `<em>${html}</em>`;
  if (r.u) html = `<u>${html}</u>`;
  if (r.strike) html = `<s>${html}</s>`;
  if (r.caps) html = `<span class="msd-caps">${html}</span>`; else if (r.smallCaps) html = `<span class="msd-sc">${html}</span>`;
  if (r.highlight) html = `<mark class="msd-hl">${html}</mark>`;
  return html;
}
// A field the document numbers itself (a page number, a caption's number) or a result's shown value.
function tokenHtml(key, d) {
  if (key.startsWith('fn:') || key.startsWith('cm:') || key === 'page' || key === 'pages') return '';
  if (key.startsWith('seq:') || key.startsWith('xref:')) return '';
  return esc(d?.results?.[key] ?? '');
}

function tableHtml(b, cellRuns) {
  const g = b.grid, head = [], body = [];
  g.rows.forEach((row, r) => {
    const cells = row.cells.map((cell, c) => {
      if (cell.merged) { cellRuns(cell.runs || []); return ''; }
      const { span, down } = spanOf(g, r, c);
      const tag = row.header ? 'th' : 'td';
      const jc = cell.props?.jc === 'center' ? ' class="msd-c"' : cell.props?.jc === 'right' ? ' class="msd-r"' : '';
      return `<${tag}${span > 1 ? ` colspan="${span}"` : ''}${down > 1 ? ` rowspan="${down}"` : ''}${jc}>${cellRuns(cell.runs || []).replace(/\n/g, '<br>')}</${tag}>`;
    }).join('');
    (row.header && !body.length ? head : body).push(`<tr>${cells}</tr>`);
  });
  return `<div class="msd-table" tabindex="0"><table>${head.length ? `<thead>${head.join('')}</thead>` : ''}<tbody>${body.join('')}</tbody></table></div>`;
}

/** What changed after a number's source was read: results numbers go stale with the analysis run, record numbers with the record. */
export function staleKind(source, stale = {}) {
  const s = String(source || '');
  const out = /^Lykos output ([\w-]+)/.exec(s);
  if (out) return stale.outputs?.has?.(out[1]) ? 'output' : '';
  if (/^results\.md\b|^Derived from results\.md/.test(s)) return stale.results ? 'results' : '';
  if (stale.record && /Lykos record|project\.json|Full-text decision|PRISMA counts|Evidence table|Risk-of-bias record|Trial and risk-of-bias counts|Lykos query/i.test(s)) return 'record';
  return '';
}

/**
 * The line near the top of a scroller that a heading must have reached to count as the section being read: a quarter of the
 * view down (at least 60 px, at most 240), so a heading under a page's top margin or a click's landing room already counts.
 */
export function readingLine(top, height) { return top + Math.max(60, Math.min(240, (height || 0) * 0.25)); }

/**
 * The outline entry being read: the last whose heading is at or above `line`, the next being below it (topOf(i) is entry i's top, or
 * null where it is not on the page; the tops rise). At the very top it is the first entry, even when its heading is lower than
 * the line; at the very bottom the last, even when its heading could not reach the line. -1 when nothing has been reached.
 */
export function currentSection(count, topOf, line, { atTop = false, atEnd = false } = {}) {
  if (!count) return -1;
  if (atEnd) { for (let i = count - 1; i >= 0; i--) if (topOf(i) != null) return i; }
  let k = -1;
  for (let i = 0; i < count; i++) { const t = topOf(i); if (t == null) continue; if (t <= line) k = i; else break; }
  if (k < 0 && atTop) for (let i = 0; i < count; i++) if (topOf(i) != null) return i;
  return k;
}

/**
 * The project record a reference of the file is: by its DOI, else its PMID, else its title (with the year and first author where it
 * has them; lib/reference-list.mjs matchEntry), or null when the project holds no such record. `lib` is prepareLibrary(papers, { exact: true }):
 * the maps alone, so no reference is compared with every record.
 * Only a sure match counts: a near miss is not taken.
 */
export function referenceRecord(entry, lib) {
  if (!entry || !lib) return null;
  const m = matchEntry({ key: entry.key, doi: entry.doi || '', pmid: String(entry.pmid || '').replace(/\D/g, ''), title: entry.title || '', year: entry.year || '', first: entry.first || '' }, lib);
  return m?.paper ? (m.paper.id ?? m.paper.key ?? null) : null;
}
export { prepareLibrary };
