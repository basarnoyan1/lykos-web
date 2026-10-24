// A Word file drawn read-only with the manuscript editor's own reader and
// page layout (lib/docx.mjs, lib/pages.mjs), so a .docx opened in Files looks
// as it does in the Manuscript view: its pages, margins, sections, headers
// and footers, lists, tables, figures, footnotes at the foot of their page
// and tracked changes. Nothing on it can be edited (plan §4.11a).
import { parseDocx } from './docx.mjs';
import { paragraphElement, tableElement, figureElement, tocElement, paginate, PT, DEFAULT_SECTION } from './pages.mjs';
import { effectiveStyles, listMarkers, captionNumbers, noteNumbers, tocEntries, commentOrder } from './manuscript-doc.mjs';
import { runs, compactNumbers } from './manuscript.mjs';
import { esc } from './html.mjs';

/**
 * Lay the document out in `host` (which must be in the page, to be measured).
 * Returns { width, pages, urls, comments }: the widest page in CSS pixels, the
 * page count, the object URLs made for its images, for the caller to revoke,
 * and the comments in document order for the margin column.
 */
export async function renderDocxPages(host, bytes) {
  const d = await parseDocx(bytes);
  const blocks = d.blocks, styles = effectiveStyles(d), notes = d.notes || {};
  const urls = [], media = new Map();
  for (const m of d.media || []) { const u = URL.createObjectURL(new Blob([m.bytes], { type: m.mime })); urls.push(u); media.set(m.id, u); }
  // Citations numbered by first appearance, as a numbered style shows them.
  const citeNo = new Map();
  for (const b of blocks) for (const r of b.runs || []) for (const k of r.cite || []) if (!citeNo.has(k)) citeNo.set(k, citeNo.size + 1);
  const captions = captionNumbers(blocks), noteNums = noteNumbers(blocks, notes), markers = listMarkers(blocks, d.lists || {});
  const seqAt = new Map();
  const chip = (tag, cls, shown, extra = '') => `<${tag} class="tok ${cls}"${extra}>${esc(shown)}</${tag}>`;
  const renderRun = (r, i, b) => {
    if (r.cite) return chip('sup', 'cite', compactNumbers(r.cite.map(k => citeNo.get(k)).filter(Boolean)));
    return runs(r.t).map(x => {
      if (x.kind === 'text') return esc(x.text);
      if (x.kind === 'cite') return chip('sup', 'cite', String(citeNo.get(x.key) || ''));
      if (x.key.startsWith('fn:')) { const n = noteNums.get(x.key.slice(3)); return chip('sup', 'note', n ? n.label : '', ` data-note="${esc(x.key.slice(3))}"`); }
      if (x.key.startsWith('seq:')) { const k = seqAt.get(b?.id) || 0; seqAt.set(b?.id, k + 1); return esc(String(captions.perBlock.get(b?.id)?.[k] ?? '')); }
      if (x.key.startsWith('xref:')) return esc(captions.label.get(x.key.slice(5)) || '');
      // A comment made at a point is a small mark there; the margin column is level with it.
      if (x.key.startsWith('cm:')) { const c = d.comments?.[x.key.slice(3)]; return c ? chip('sup', 'comment', c.initials || (c.author || '').slice(0, 2) || '*', ` data-comment="${esc(x.key.slice(3))}"`) : ''; }
      if (x.key === 'page' || x.key === 'pages') return `<span data-src="{{${x.key}}}">#</span>`;
      return esc(d.results?.[x.key] ?? `{{${x.key}}}`);
    }).join('');
  };
  const sections = [];
  let k = 0;
  const secOf = new Map();
  for (const b of blocks) { secOf.set(b.id, k); if (b.props?.section) { sections.push(b.props.section); k++; } }
  const section = { ...DEFAULT_SECTION, ...(d.section || {}) };
  sections.push(section);
  const entries = blocks.some(b => b.type === 'toc') ? tocEntries(blocks) : [];
  const els = blocks.flatMap(b => {
    let el;
    // The reference list as the file had it, one entry per paragraph.
    if (b.type === 'bib') return (b.lines || []).map((line, k) => {
      const row = paragraphElement({ id: b.id, type: 'p', styleId: 'Normal', props: { indLeft: 32, indHanging: 32, after: 6 }, runs: [{ t: line }] }, styles, renderRun);
      row.dataset.nosplit = '1'; row.dataset.sec = secOf.get(b.id);
      if (!k && b.props?.pageBreakBefore) row.dataset.pageBreakBefore = '1';
      return row;
    });
    if (b.type === 'table' && b.grid) el = tableElement(b, styles, renderRun);
    else if (b.type === 'figure') { el = figureElement(b); const img = el.querySelector('img'); if (media.has(b.img)) img.src = media.get(b.img); el.dataset.nosplit = '1'; }
    else if (b.type === 'toc') { el = tocElement(b, entries); el.dataset.nosplit = '1'; }
    else {
      const li = b.props?.list;
      el = paragraphElement(b, styles, renderRun, { marker: markers.get(b.id) ?? null, list: li ? d.lists?.[li.id]?.levels?.[li.level || 0] : null });
      // Notes on a file anchor to paragraphs by their text (views/files.mjs).
      el.classList.add('fv-p'); el.dataset.i = '-1';
    }
    if (b.props?.pageBreakBefore) el.dataset.pageBreakBefore = '1';
    el.dataset.sec = secOf.get(b.id);
    return el;
  });
  const row = (id, n) => {
    const r = document.createElement('div');
    r.className = 'pg-note';
    const num = document.createElement('span'); num.className = 'pg-note-n'; num.textContent = n.label;
    const text = paragraphElement({ id: `note-${id}`, type: 'p', styleId: 'Normal', props: { after: 0, line: 1 }, runs: notes[id].runs?.length ? notes[id].runs : [{ t: notes[id].text || '' }] },
      { ...styles, default: { ...styles.default, run: { ...styles.default?.run, sz: 10 } } }, renderRun);
    text.classList.remove('para'); text.classList.add('mb-note');
    r.append(num, text);
    return r;
  };
  const footRows = new Map(), endRows = [];
  for (const [id, n] of noteNums) { if (!notes[id]) continue; if (n.kind === 'endnote') endRows.push(row(id, n)); else footRows.set(id, row(id, n)); }
  if (endRows.length) { const box = document.createElement('div'); box.className = 'pg-notes'; box.dataset.nosplit = '1'; box.dataset.sec = String(sections.length - 1); box.append(...endRows); els.push(box); }
  host.classList.add('ms-pages', 'fv-pages');
  // Headers and footers with pictures or tables, drawn as the body is.
  const headerFooter = part => {
    const box = document.createElement('div');
    for (const b of part.blocks) {
      let el;
      if (b.type === 'table' && b.grid) el = tableElement(b, styles, renderRun);
      else if (b.type === 'figure') { el = figureElement(b); if (media.has(b.img)) el.querySelector('img').src = media.get(b.img); }
      else el = paragraphElement(b, styles, renderRun);
      box.append(el);
    }
    return box;
  };
  const pages = paginate(host, els, section, { lineNumbers: true, sections, footnotes: footRows, evenOdd: !!section.evenOdd, headerFooter });
  // Read-only: nothing in it takes the caret.
  host.querySelectorAll('[contenteditable]').forEach(x => x.setAttribute('contenteditable', 'false'));
  const width = Math.max(...[...host.querySelectorAll('.pg')].map(p => p.offsetWidth), section.pageW * PT);
  // The file's comments in document order, with their replies, for the margin column.
  return { width, pages, urls, comments: commentOrder(blocks, d.comments || {}) };
}
