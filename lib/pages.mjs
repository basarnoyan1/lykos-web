// Laying a document out as pages.
//
// The page is the section's page: its size, its margins, its line numbering,
// its header and footer. Each paragraph is styled from its resolved Word style
// plus its own properties, in the document's own units (points), so a Times 12
// paragraph at 1.5 spacing is exactly that. Pagination is by measurement:
// paragraphs fill a page until one no longer fits, and a paragraph that
// crosses the boundary is split at a line, found by measuring where its lines
// fall; a table is split between rows, its header rows repeated. Line numbers
// are then read off the rendered lines, so they count what is actually there.
//
// Document formatting is set with style.setProperty, never as a style="…"
// string in markup: the desktop shell's content security policy is what
// decides whether inline style attributes apply, and properties set from
// script are outside it (plan §4.11a).
//
// Nothing here produces the editable text; it renders what `renderRun` returns
// for each run, which is where citation and result tokens become what a reader
// sees.
import { esc } from './html.mjs';
import { styleIdOf, spanOf, cellText, headerFooterFor } from './manuscript-doc.mjs';

const PT = 96 / 72;   // CSS px per point

const DEFAULT_SECTION = { pageW: 612, pageH: 792, top: 72, right: 72, bottom: 72, left: 72, lineNumbers: null };

/**
 * The text area's top and bottom margins in points, as Word sets them: the
 * section's margin, or lower when the header or footer (its distance from the
 * page edge plus its own height) reaches past it, so the text never runs
 * under a page number. `header` and `footer` are the parts' heights in points,
 * 0 for none.
 */
export function pageMargins(sec, { header = 0, footer = 0 } = {}) {
  return {
    top: Math.max(sec.top, header ? (sec.headerDist ?? 36) + header : 0),
    bottom: Math.max(sec.bottom, footer ? (sec.footerDist ?? 36) + footer : 0),
  };
}

/**
 * Where a table may be cut. `reach[i]` is the row index one past the last row
 * that a cell of row `i` spans (`i + 1` with no merge). `crossing` is the first
 * row that runs past the page. A cut falls between rows and never through a
 * merged cell: it moves up to the first row no cell reaches across. Returns the
 * index of the first row of the next page; at most `headerRows` means that
 * nothing but the header fits.
 */
export function tableCut(reach, crossing, headerRows = 0) {
  let cut = crossing;
  while (cut > headerRows && reach.slice(0, cut).some(r => r > cut)) cut--;
  return cut;
}

/** Resolved paragraph and run formatting for a block. */
export function resolve(block, styles) {
  const st = styles?.byId?.[styleIdOf(block)] || {};
  const para = { ...(styles?.default?.para || {}), ...(st.para || {}), ...(block.props || {}) };
  const run = { ...(styles?.default?.run || {}), ...(st.run || {}) };
  return { para, run };
}

// Word's highlight colours are the sixteen standard ones; CSS names them.
export const HIGHLIGHT_CSS = { yellow: 'yellow', green: 'lime', cyan: 'cyan', magenta: 'magenta', blue: 'blue', red: 'red', darkBlue: 'navy', darkCyan: 'teal', darkGreen: 'green', darkMagenta: 'purple', darkRed: 'maroon', darkYellow: 'olive', darkGray: 'gray', lightGray: 'silver', black: 'black' };

const JC = { center: 'center', right: 'right', both: 'justify', left: 'left', start: 'left', end: 'right', distribute: 'justify' };

function paraProps(para, run, list) {
  const s = {};
  s['font-family'] = cssFont(run.font);
  s['font-size'] = `${(run.sz || 12) * PT}px`;
  if (run.b) s['font-weight'] = '700';
  if (run.i) s['font-style'] = 'italic';
  if (run.color) s.color = run.color;
  if (run.caps) s['text-transform'] = 'uppercase';
  if (run.smallCaps) s['font-variant'] = 'small-caps';
  const deco = [run.u && 'underline', run.strike && 'line-through'].filter(Boolean);
  if (deco.length) s['text-decoration'] = deco.join(' ');
  if (para.jc) s['text-align'] = JC[para.jc] || 'left';
  s['margin-top'] = `${(para.before || 0) * PT}px`;
  s['margin-bottom'] = `${(para.after || 0) * PT}px`;
  // Word's single line is about 1.15 times the font size.
  if (para.lineExact) s['line-height'] = `${para.lineExact * PT}px`;
  else if (para.lineAtLeast) s['line-height'] = `max(${para.lineAtLeast * PT}px, 1.15em)`;
  else s['line-height'] = String((para.line || 1) * 1.15);
  let left = para.indLeft, hang = para.indHanging, first = para.indFirst;
  if (list) { left ??= list.indLeft ?? 36; hang ??= first == null ? list.indHanging ?? 18 : null; }
  left = (left || 0) * PT;
  if (hang) { s['padding-left'] = `${left}px`; s['text-indent'] = `-${hang * PT}px`; }
  else { if (left) s['padding-left'] = `${left}px`; if (first) s['text-indent'] = `${first * PT}px`; }
  if (para.indRight) s['padding-right'] = `${para.indRight * PT}px`;
  if (list) s['--list-hang'] = `${(hang || 18) * PT}px`;
  return s;
}

function runProps(base, r) {
  const s = {};
  if (r.font && r.font !== base.font) s['font-family'] = cssFont(r.font);
  if (r.sz && r.sz !== base.sz) s['font-size'] = `${r.sz * PT}px`;
  if (r.b !== undefined && !!r.b !== !!base.b) s['font-weight'] = r.b ? '700' : '400';
  if (r.i !== undefined && !!r.i !== !!base.i) s['font-style'] = r.i ? 'italic' : 'normal';
  // Underline and strikethrough as the run has them against its paragraph: a run can also turn its style's off.
  const u = r.u ?? base.u, st = r.strike ?? base.strike;
  if (!!u !== !!base.u || !!st !== !!base.strike) s['text-decoration'] = [u && 'underline', st && 'line-through'].filter(Boolean).join(' ') || 'none';
  if (r.color && r.color !== base.color) s.color = r.color;
  if (r.caps) s['text-transform'] = 'uppercase';
  if (r.smallCaps) s['font-variant'] = 'small-caps';
  if (r.highlight && HIGHLIGHT_CSS[r.highlight]) s['background-color'] = HIGHLIGHT_CSS[r.highlight];
  return s;
}

const setProps = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v); };

const cssFont = f => {
  const name = f || 'Times New Roman';
  const generic = /times|georgia|garamond|cambria|book/i.test(name) ? 'serif'
    : /courier|mono|consolas/i.test(name) ? 'monospace' : 'sans-serif';
  return `'${name.replace(/['"\\]/g, '')}',${generic}`;
};

/** The inline content of a run list, appended to `host`: text runs formatted, tokens as the caller renders them. */
function appendRuns(host, runs, base, renderRun, block) {
  runs.forEach((r, i) => {
    if (r.cite) {
      if (!r.cm?.length) { host.insertAdjacentHTML('beforeend', renderRun(r, i, block)); return; }
      const t = document.createElement('span'); t.className = 'tc-cm'; t.dataset.cm = r.cm.join(' ');
      t.innerHTML = renderRun(r, i, block); host.append(t); return;
    }
    // A tracked deletion is shown struck through and is not part of the text:
    // an atomic mark with no source length, kept until it is accepted or rejected.
    if (r.del) {
      const del = document.createElement('del');
      del.className = 'tc-del'; del.contentEditable = 'false';
      del.dataset.src = ''; del.dataset.del = JSON.stringify(r);
      del.textContent = r.t || '';
      setProps(del, runProps(base, r));
      host.append(del);
      return;
    }
    let node = document.createElement('span');
    node.innerHTML = renderRun(r, i, block);
    const props = runProps(base, r);
    // Keep the native caret tied to the run's font metrics. Paragraph line
    // spacing still controls the line boxes and printed layout.
    node.className = 'text-run';
    node.style.lineHeight = 'normal';
    setProps(node, props);
    if (r.sup || r.sub) { const t = document.createElement(r.sup ? 'sup' : 'sub'); t.append(node); node = t; }
    // A tracked formatting change and a comment's span mark the run; the marks read back into the run.
    if (r.fmtChange) { const t = document.createElement('span'); t.className = 'tc-fmt'; t.dataset.fmtchange = JSON.stringify(r.fmtChange); t.append(node); node = t; }
    if (r.cm?.length) { const t = document.createElement('span'); t.className = 'tc-cm'; t.dataset.cm = r.cm.join(' '); t.append(node); node = t; }
    if (r.ins) { const t = document.createElement('ins'); t.className = 'tc-ins'; t.dataset.ins = JSON.stringify(r.ins); t.append(node); node = t; }
    host.append(node);
  });
}

/**
 * One paragraph as an element. `renderRun(run, index, block)` returns the
 * HTML of a run's content — escaped text, or a citation/result rendering —
 * and is the caller's. `marker` is the list number or bullet it shows.
 */
export function paragraphElement(block, styles, renderRun, { marker = null, list = null } = {}) {
  const { para, run } = resolve(block, styles);
  const el = document.createElement('div');
  el.className = `para para-${block.type}`;
  el.dataset.b = block.id;
  setProps(el, paraProps(para, run, marker != null ? list || {} : null));
  if (marker != null) { el.dataset.marker = marker; el.classList.add('para-list'); }
  const runs = block.runs?.length ? block.runs : [{ t: block.text || '' }];
  appendRuns(el, runs, run, renderRun, block);
  if (!el.childNodes.length || !el.textContent && !el.querySelector('.tok,.tc-del')) el.append(document.createElement('br'));
  return el;
}

/**
 * A table block: a grid of editable cells inside an element the caret cannot
 * enter except through a cell. Merged cells span; header rows are marked.
 */
export function tableElement(block, styles, renderRun) {
  const g = block.grid;
  const wrap = document.createElement('div');
  wrap.className = 'mb-table';
  wrap.dataset.b = block.id;
  wrap.contentEditable = 'false';
  const { run, para } = resolve({ styleId: 'Normal' }, styles);
  const table = document.createElement('table');
  table.className = `pg-table pg-table-${g.borders || 'all'}`;
  const total = g.cols.reduce((a, b) => a + b, 0);
  setProps(table, { width: `${total * PT}px`, 'font-family': cssFont(run.font), 'font-size': `${(run.sz || 12) * PT}px` });
  if (g.jc === 'center') setProps(table, { 'margin-left': 'auto', 'margin-right': 'auto' });
  const cg = document.createElement('colgroup');
  for (const w of g.cols) { const c = document.createElement('col'); setProps(c, { width: `${w * PT}px` }); cg.append(c); }
  table.append(cg);
  const tbody = document.createElement('tbody');
  g.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    tr.dataset.r = r;
    if (row.header) tr.dataset.header = '1';
    if (row.header && !g.rows[r + 1]?.header) tr.dataset.headerLast = '1';   // the APA rule under the last header row (research-views.css)
    // A row or column inserted or deleted while tracking is marked as its text would be.
    if (row.ins) tr.classList.add('tc-row-ins');
    if (row.del) tr.classList.add('tc-row-del');
    row.cells.forEach((cell, c) => {
      if (cell.merged) return;
      const { span, down } = spanOf(g, r, c);
      const td = document.createElement(row.header ? 'th' : 'td');
      if (cell.cellIns) td.classList.add('tc-col-ins');
      if (cell.cellDel) td.classList.add('tc-col-del');
      if (span > 1) td.colSpan = span;
      if (down > 1) td.rowSpan = down;
      if (cell.shade) td.style.setProperty('background-color', cell.shade);
      if (cell.valign) td.style.setProperty('vertical-align', cell.valign === 'center' ? 'middle' : cell.valign);
      const box = document.createElement('div');
      box.className = 'mb-cell';
      box.contentEditable = 'true';
      box.spellcheck = true;
      box.dataset.b = block.id; box.dataset.r = r; box.dataset.c = c;
      const cp = { ...para, ...(cell.props || {}) };
      if (cp.jc) box.style.setProperty('text-align', JC[cp.jc] || 'left');
      box.style.setProperty('line-height', cp.lineExact ? `${cp.lineExact * PT}px` : String(Math.min(cp.line || 1, 1.5) * 1.15));
      appendRuns(box, cell.runs?.length ? cell.runs : [{ t: cellText(cell) }], run, renderRun, block);
      if (!box.childNodes.length) box.append(document.createElement('br'));
      td.append(box);
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/** A figure block: the image at its size, aligned as its paragraph. */
export function figureElement(block) {
  const el = document.createElement('div');
  el.className = 'mb-figure';
  el.dataset.b = block.id;
  el.contentEditable = 'false';
  if (block.props?.jc) el.style.setProperty('text-align', JC[block.props.jc] || 'left');
  const img = document.createElement('img');
  img.alt = block.name || 'Figure';
  img.dataset.img = block.img;
  img.draggable = false;
  setProps(img, { width: `${(block.w || 300) * PT}px`, height: `${(block.h || 200) * PT}px` });
  el.append(img);
  return el;
}

/** A contents block: the headings, indented by level, each a link to its heading. */
export function tocElement(block, entries) {
  const el = document.createElement('div');
  el.className = 'mb-toc';
  el.dataset.b = block.id;
  el.contentEditable = 'false';
  el.innerHTML = entries.length ? entries.map(e => `<button type="button" class="pg-toc-line pg-toc-${e.level}" data-goto="${esc(e.id)}">${esc(e.text)}</button>`).join('')
    : '<div class="pg-toc-line">Contents</div>';
  return el;
}

/**
 * Paginate: distributes the already-rendered paragraph elements into pages.
 * `host` is emptied and filled with `.pg` elements. Returns the page count.
 * Each element's `data-sec` is the index of its section in `sections`; a
 * change of section starts a new page with that section's setup.
 *
 * Splitting: when a paragraph overflows the page, the line that crosses the
 * boundary is found from its client rects and the paragraph is cut there —
 * the second part continues on the next page with the same formatting. A
 * table is cut between rows; an element marked `data-nosplit` moves whole.
 */
export function paginate(host, paragraphs, section = DEFAULT_SECTION, opts = {}) {
  // Pages are cut at their own size: under a CSS zoom or a transform the client rects the cuts are read from are scaled, and the heights they are compared with are not.
  const { zoom, transform } = host.style;
  if (!zoom && !transform) return paginateAt(host, paragraphs, section, opts);
  host.style.zoom = ''; host.style.transform = '';
  try { return paginateAt(host, paragraphs, section, opts); } finally { host.style.zoom = zoom; host.style.transform = transform; }
}

function paginateAt(host, paragraphs, section, { lineNumbers = true, sections = null, footnotes = null, evenOdd = false, headerFooter = null }) {
  const secs = (sections?.length ? sections : [section]).map(s => ({ ...DEFAULT_SECTION, ...s }));
  host.innerHTML = '';
  let secIndex = 0;
  // The part of a footnote that did not fit on its page, carried to the top of the next page's notes.
  let carry = [];

  // A header or footer for page `n` of `total`: its text with the page fields filled, or the caller's blocks.
  const hfBox = (sec, kind, part, n, total) => {
    const cls = kind === 'header' ? 'head' : 'foot';
    const rich = part?.blocks?.length && headerFooter;
    if (!part?.text && !rich) return null;
    const hf = document.createElement('div');
    hf.className = `pg-${cls}`;
    hf.contentEditable = 'false';
    hf.dataset.kind = kind;
    const dist = (kind === 'header' ? sec.headerDist : sec.footerDist) ?? 36;
    setProps(hf, { left: `${sec.left * PT}px`, right: `${sec.right * PT}px`, [cls === 'head' ? 'top' : 'bottom']: `${dist * PT}px` });
    if (rich) {
      // Pictures and tables drawn by the caller's paragraph and table renderers, clipped to the header's area.
      hf.classList.add('pg-hf-blocks');
      hf.append(headerFooter(part, { kind, page: n }));
      hf.querySelectorAll('[contenteditable]').forEach(x => x.setAttribute('contenteditable', 'false'));
    } else {
      hf.textContent = part.text.replace(/\{\{page\}\}/g, String(n)).replace(/\{\{pages\}\}/g, String(total));
      hf.style.setProperty('text-align', JC[part.jc] || 'left');
    }
    // Page fields show this page's number and the count, as text or as field marks.
    hf.querySelectorAll('[data-src="{{page}}"],[data-src="{{pages}}"]').forEach(x => { x.textContent = x.dataset.src === '{{page}}' ? String(n) : String(total); });
    return hf;
  };
  // The text area keeps clear of the tallest header and footer the section can show: measured once per section.
  const marginCache = new Map();
  const marginsOf = k => {
    const at = secs[k] ? k : secs.length - 1;
    if (marginCache.has(at)) return marginCache.get(at);
    const sec = secs[at], height = { header: 0, footer: 0 };
    for (const kind of ['header', 'footer']) {
      const parts = new Set([{ first: true, page: 1 }, { first: false, page: 1 }, { first: false, page: 2 }].map(o => headerFooterFor(secs, at, kind, { ...o, evenOdd })).filter(Boolean));
      for (const part of parts) {
        const hf = hfBox(sec, kind, part, 1, 1);
        if (!hf) continue;
        const probe = document.createElement('div');
        probe.className = 'pg';
        setProps(probe, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: `${sec.pageW * PT}px`, height: `${sec.pageH * PT}px` });
        probe.append(hf); host.append(probe);
        height[kind] = Math.max(height[kind], Math.ceil(hf.offsetHeight) / PT);
        probe.remove();
      }
    }
    const m = pageMargins(sec, height);
    marginCache.set(at, m);
    return m;
  };

  const newPage = k => {
    const sec = secs[k] || secs.at(-1);
    const m = marginsOf(k);
    const pg = document.createElement('div');
    pg.className = 'pg';
    pg.dataset.sec = k;
    const pageW = sec.pageW * PT, pageH = sec.pageH * PT;
    setProps(pg, { width: `${pageW}px`, height: `${pageH}px`, padding: `${m.top * PT}px ${sec.right * PT}px ${m.bottom * PT}px ${sec.left * PT}px` });
    const body = document.createElement('div');
    body.className = 'pg-body';
    pg.appendChild(body);
    const gutter = document.createElement('div');
    gutter.className = 'pg-ln';
    gutter.contentEditable = 'false';
    gutter.style.setProperty('left', `${Math.max(8, sec.left * PT - (sec.lineNumbers?.distance || 18) * PT - 24)}px`);
    pg.appendChild(gutter);
    // Footnotes sit at the foot of the text area of the page that refers to them.
    const fn = document.createElement('div');
    fn.className = 'pg-fn';
    fn.contentEditable = 'false';
    setProps(fn, { left: `${sec.left * PT}px`, right: `${sec.right * PT}px`, bottom: `${m.bottom * PT}px` });
    pg.appendChild(fn);
    host.appendChild(pg);
    // A note continued from the page before comes first, under Word's continuation separator: a full-width rule.
    const page = { pg, body, fn, sec, bodyH: pageH - (m.top + m.bottom) * PT, carry, full: false };
    if (carry.length) { fn.classList.add('pg-fn-cont'); fn.append(...carry); }
    carry = [];
    return page;
  };

  let cur = newPage(0);
  // The notes a page's text refers to, in order, moved into its foot, after any continued from the page before.
  const syncNotes = page => {
    if (!footnotes?.size && !page.carry.length) return;
    const want = [...page.carry];
    if (footnotes?.size) for (const chip of page.body.querySelectorAll('.tok.note[data-note]')) { const row = footnotes.get(chip.dataset.note); if (row && !want.includes(row)) want.push(row); }
    for (const row of [...page.fn.children]) if (!want.includes(row)) row.remove();
    want.forEach(row => page.fn.appendChild(row));
  };
  // The body is the full text area; what matters is how much content is in it, and the notes under it.
  const used = () => cur.body.scrollHeight;
  const fnHeight = () => cur.fn.children.length ? cur.fn.offsetHeight : 0;
  // With notes at the foot, the text must end above them: the body's own
  // height hides how much of it the text fills, so its last element is measured.
  const contentBottom = () => { const last = cur.body.lastElementChild; return last ? last.getBoundingClientRect().bottom - cur.body.getBoundingClientRect().top : 0; };
  const fits = () => { syncNotes(cur); const fn = fnHeight(); return used() <= cur.bodyH + 0.5 && (!fn || contentBottom() + fn <= cur.bodyH + 0.5); };

  // Footnotes that do not all fit under the text are split with the same line
  // cut as a paragraph, and the rest continues at the top of the next page's
  // notes, as Word sets them: every note referred to on the page keeps at
  // least its first line there. The page then takes no more text, so the
  // continued note is the last on it. Returns whether the page now fits.
  const noteText = row => row.querySelector('.mb-note') || row.lastElementChild;
  const firstLine = row => { const t = noteText(row), tops = t ? lineTops(t) : []; return tops.length > 1 ? tops[1] - tops[0] : row.getBoundingClientRect().height; };
  const splitNotes = () => {
    const rows = [...cur.fn.children];
    if (!rows.length || used() > cur.bodyH + 0.5 && contentBottom() > cur.bodyH + 0.5) return false;
    const room = cur.bodyH - contentBottom();
    const box = cur.fn.getBoundingClientRect();
    if (box.height <= room + 0.5) return true;
    const limit = box.top + room;
    // A note referred to on this page must keep its first line here.
    if (rows.some(row => !cur.carry.includes(row) && row.getBoundingClientRect().top + firstLine(row) > limit + 0.5)) return false;
    const moved = [], out = [];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.bottom <= limit + 0.5) continue;
      if (r.top < limit - 0.5) {
        const t = noteText(row), rest = t && splitAt(t, limit);
        if (rest) {
          const cont = document.createElement('div');
          cont.className = row.className; cont.dataset.cont = '1';
          const n = document.createElement('span'); n.className = 'pg-note-n';
          cont.append(n, rest);
          out.push(cont);
          continue;
        }
      }
      // Only a note already continued from the page before may leave this page whole.
      if (!cur.carry.includes(row)) return false;
      moved.push(row); out.push(row);
    }
    if (!out.length) return false;
    moved.forEach(row => row.remove());
    cur.carry = cur.carry.filter(row => !moved.includes(row));
    carry = out; cur.full = true;
    return true;
  };

  // A cut that keeps the text above every note it refers to, whole, can leave
  // the notes of the lines it moved on with them and a gap where they were;
  // then the text is cut as low as the notes' first lines allow and the notes
  // are continued instead. Returns the part that moves on, or null.
  const cutParagraph = rest => {
    const top = cur.body.getBoundingClientRect().top;
    if (rest.dataset.nosplit) return null;
    if (rest.classList.contains('mb-table')) return splitTable(rest, top + cur.bodyH - fnHeight(), cur.body.children.length === 1);
    const before = cur.fn.children.length;
    const cut = splitAt(rest, top + cur.bodyH - fnHeight());
    syncNotes(cur);
    if (cut && cur.fn.children.length === before) return cut;
    if (!before) return cut;
    if (cut) rest.append(...cut.childNodes);
    syncNotes(cur);
    const rows = [...cur.fn.children];
    const floor = fnHeight() - rows.reduce((a, row) => a + (cur.carry.includes(row) ? 0 : row.getBoundingClientRect().height - firstLine(row)), 0);
    const low = splitAt(rest, top + cur.bodyH - floor);
    if (low && (fits() || splitNotes())) return low;
    if (low) rest.append(...low.childNodes);
    const again = splitAt(rest, top + cur.bodyH - fnHeight());
    syncNotes(cur);
    return again;
  };

  for (let el of paragraphs) {
    const k = Number(el.dataset.sec || 0);
    if (k !== secIndex) { secIndex = k; cur = newPage(k); }
    else if (cur.full) cur = newPage(secIndex);
    if (el.dataset.pageBreakBefore === '1' && cur.body.children.length) cur = newPage(secIndex);
    cur.body.appendChild(el);
    if (fits() || splitNotes()) continue;
    // Does not fit. Move whole if it would fit on an empty page, else split.
    cur.body.removeChild(el); syncNotes(cur);
    if (cur.body.children.length) {
      const before = cur;
      cur = newPage(secIndex);
      cur.body.appendChild(el);
      if (fits() || splitNotes()) continue;
      cur.body.removeChild(el); syncNotes(cur);
      // Too tall for a page of its own, and divisible: it starts where the page before ends, not on a fresh page below a gap.
      if (!el.dataset.nosplit && !before.full && !cur.carry.length && !cur.fn.children.length) { cur.pg.remove(); cur = before; }
    }
    // Split at the last line (or row) that fits.
    let rest = el;
    while (rest) {
      cur.body.appendChild(rest);
      if (fits() || splitNotes()) { rest = null; break; }
      const cut = cutParagraph(rest);
      if (!cut) { // nothing fits on this page; move on
        // An indivisible paragraph must stay in the document even when it is
        // taller than a page. Removing it here used to silently hide its text.
        if (cur.body.children.length === 1) { rest = null; break; }
        cur.body.removeChild(rest); syncNotes(cur);
        cur = newPage(secIndex);
        continue;
      }
      rest = cut;
      syncNotes(cur);
      cur = newPage(secIndex);
    }
  }
  // A note still continuing after the last text goes on pages of its own.
  for (let guard = 0; carry.length && guard < 50; guard++) { cur = newPage(secIndex); if (!fits()) splitNotes(); }

  // Headers and footers, now that the pages are counted: each page's own
  // (first page of a section, even page, or default), with its page fields.
  const pages = [...host.querySelectorAll('.pg')];
  pages.forEach((pg, i) => {
    const k = Number(pg.dataset.sec || 0), sec = secs[k] || secs.at(-1);
    const first = i === 0 || pages[i - 1].dataset.sec !== pg.dataset.sec;
    for (const kind of ['header', 'footer']) {
      const part = headerFooterFor(secs, k, kind, { first, page: i + 1, evenOdd });
      const hf = hfBox(sec, kind, part, i + 1, pages.length);
      if (!hf) continue;
      if (hf.classList.contains('pg-hf-blocks')) {
        const m = marginsOf(k), dist = (kind === 'header' ? sec.headerDist : sec.footerDist) ?? 36;
        hf.style.setProperty('max-height', `${Math.max(12, (kind === 'header' ? m.top : m.bottom) - dist) * PT}px`);
      }
      pg.appendChild(hf);
    }
  });
  if (lineNumbers) numberLines(host, secs);
  return pages.length;
}

/**
 * Cut a paragraph element so that everything rendered below `yLimit` moves
 * to a new element with the same attributes, returned; the original keeps
 * the lines above. Returns null when no complete line fits.
 */
function splitAt(el, yLimit) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let cutNode = null, cutOffset = 0;
  // Find the first character whose line box starts below the limit.
  outer: for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('[contenteditable="false"]') && n.parentElement.closest('[contenteditable="false"]') !== el && el.contains(n.parentElement.closest('[contenteditable="false"]'))) continue;
    const len = n.textContent.length;
    for (let i = 0; i < len; i++) {
      range.setStart(n, i); range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect();
      if (r.height && r.bottom > yLimit + 0.5) { cutNode = n; cutOffset = i; break outer; }
    }
  }
  if (!cutNode) return null;
  // Back up to the previous word boundary so a word is not split.
  const text = cutNode.textContent;
  let at = cutOffset;
  while (at > 0 && !/\s/.test(text[at - 1])) at--;
  if (at === 0 && cutNode === firstText(el)) return null;   // first line does not fit
  // A cut inside an atomic mark (a citation, a deletion) moves the whole mark.
  const atom = cutNode.parentElement?.closest('[contenteditable="false"]');
  const after = document.createRange();
  if (atom && atom !== el && el.contains(atom)) after.setStartBefore(atom); else after.setStart(cutNode, at);
  after.setEndAfter(el.lastChild);
  const frag = after.extractContents();
  const next = el.cloneNode(false);
  next.dataset.cont = '1';
  // A tracked paragraph mark stands at the paragraph's end: on the last part only.
  el.classList.remove('tc-mark-ins', 'tc-mark-del');
  setProps(next, { 'margin-top': '0' });
  if (!el.style.getPropertyValue('padding-left') || !el.style.getPropertyValue('text-indent').startsWith('-')) next.style.setProperty('text-indent', '0');
  delete next.dataset.marker;
  next.classList.remove('para-list');
  next.appendChild(frag);
  return next.textContent.trim() ? next : null;
}

/**
 * Cut a table between rows: the rows below the limit move to a copy that repeats the header rows. A row is never cut through a line:
 * the row that crosses the limit moves whole, with every row a merged cell joins it to. Only a row taller than the page (`alone`: the
 * table is all the page holds) is divided, between the lines of its cells.
 */
function splitTable(wrap, yLimit, alone = false) {
  const table = wrap.querySelector('table'), rows = [...table.tBodies[0].rows];
  const header = rows.filter(r => r.dataset.header);
  const crossing = rows.findIndex(r => !r.dataset.header && r.getBoundingClientRect().bottom > yLimit + 0.5);
  if (crossing < 0) return null;
  const reach = rows.map(r => Math.max(r.rowIndex + 1, ...[...r.cells].map(c => r.rowIndex + c.rowSpan)));
  const cut = tableCut(reach, crossing, header.length);
  const next = wrap.cloneNode(false);
  next.dataset.cont = '1';
  const t2 = table.cloneNode(false);
  t2.append(table.querySelector('colgroup').cloneNode(true));
  const body = document.createElement('tbody');
  // Repeated header rows are for reading only; the first copy is the one edited.
  for (const h of header) { const copy = h.cloneNode(true); copy.querySelectorAll('[contenteditable]').forEach(x => { x.contentEditable = 'false'; x.classList.remove('mb-cell'); x.classList.add('mb-cell-repeat'); }); body.append(copy); }
  if (cut > header.length) { for (const r of rows.slice(cut)) body.append(r); }
  else {
    // Not even the first row fits under the header: a row of its own height, with no cell merged into it, is cut between lines.
    const row = rows[crossing];
    if (!alone || crossing !== header.length || reach.slice(0, crossing).some(r => r > crossing) || [...row.cells].some(c => c.rowSpan > 1)) return null;
    const rest = splitRow(row, yLimit);
    if (!rest) return null;
    body.append(rest);
    for (const r of rows.slice(crossing + 1)) body.append(r);
  }
  t2.append(body); next.append(t2);
  return next;
}

/** A row cut at `yLimit`: each cell keeps its lines above, the rest moves to the returned row. Null when no cell has a line above the limit. */
function splitRow(row, yLimit) {
  const parts = [...row.cells].map(td => {
    const box = td.querySelector('.mb-cell') || td, pad = parseFloat(getComputedStyle(td).paddingBottom) || 0;
    const limit = yLimit - pad;
    const rest = splitAt(box, limit);
    if (rest) return { td, box, rest };
    // No line below the limit: the cell stays whole. Its first line below it: the cell moves whole.
    if (box.getBoundingClientRect().bottom <= limit + 0.5 || !box.textContent.trim()) return { td, box, rest: null };
    const all = box.cloneNode(false); all.dataset.cont = '1'; all.append(...box.childNodes); box.append(document.createElement('br'));
    return { td, box, rest: all, moved: true };
  });
  if (!parts.some(p => p.box.textContent.trim() || p.box.querySelector('img'))) {
    for (const p of parts) if (p.moved) { p.box.replaceChildren(...p.rest.childNodes); }
    return null;
  }
  const tr = row.cloneNode(false);
  tr.dataset.cont = '1';
  for (const { td, box, rest } of parts) {
    const td2 = td.cloneNode(false), box2 = rest || box.cloneNode(false);
    if (!rest) { box2.dataset.cont = '1'; box2.append(document.createElement('br')); }
    td2.append(box2); tr.append(td2);
    // A cell's lower part is under its upper part: where it began, nothing repeats.
    if (rest && !rest.textContent.trim()) rest.append(document.createElement('br'));
  }
  return tr;
}

const firstText = el => document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();

/** Line numbers per the section: one per rendered line, continuous, per page or per section. */
function numberLines(host, secs) {
  let n = 0, lastSec = null;
  for (const pg of host.querySelectorAll('.pg')) {
    const sec = secs[Number(pg.dataset.sec || 0)] || secs[0];
    const ln = sec.lineNumbers;
    const gutter = pg.querySelector('.pg-ln');
    gutter.innerHTML = '';
    if (!ln) { lastSec = pg.dataset.sec; continue; }
    if (ln.restart === 'newPage' || (ln.restart === 'newSection' && lastSec !== pg.dataset.sec)) n = 0;
    lastSec = pg.dataset.sec;
    const pgTop = pg.getBoundingClientRect().top;
    for (const para of pg.querySelectorAll('.pg-body > .para')) {
      for (const top of lineTops(para)) {
        n++;
        if (n % (ln.countBy || 1)) continue;
        const s = document.createElement('span');
        s.textContent = String(n);
        s.style.setProperty('top', `${top - pgTop}px`);
        gutter.appendChild(s);
      }
    }
  }
}

/** The top of each rendered line of a paragraph, from its text's client rects. */
function lineTops(para) {
  const range = document.createRange();
  range.selectNodeContents(para);
  const tops = [];
  let last = -Infinity;
  for (const r of range.getClientRects()) {
    if (!r.height) continue;
    if (r.top > last + r.height * 0.5) { tops.push(r.top); last = r.top; }
  }
  if (!tops.length) tops.push(para.getBoundingClientRect().top);   // an empty paragraph is a line
  return tops;
}

export { DEFAULT_SECTION, PT };
