// What both PDF viewers (the Files tab's views/pdf-file.mjs and the study reader views/reader.mjs) do the same way, so they read alike: the text of
// the document for find (read once per open, from the page in view outward), the find bar's behaviour, the rail (page previews and contents), and
// drawing boxes from PDF units onto a drawn page. Each viewer keeps its own page column and calls these with what they need; the bars are declared
// in views/reader-bars.mjs. No observers and no timers: the rail plans its previews on its own scroll, as the page column does, and the scan for
// tables waits one frame between pages.
import { appUrl } from '../lib/app-url.mjs';
import { runsFromContent, preparePage, findHits, cursor, nearest, countText, hitRects, hitContext } from '../lib/pdf-find.mjs';
import { textLayerQuality } from '../lib/pdf-text-quality.mjs';
import { regionShow, uiList, uiRow } from '../lib/ui-actions.mjs';
import { pdfToBox } from '../lib/annotations.mjs';
import { placeBox } from '../lib/reader-geometry.mjs';
import { flag } from '../lib/pdf-view-state.mjs';
import { renderThumbnail } from '../lib/anchor.mjs';
import { flattenOutline, pdfResolver, sectionAt, findTables } from '../lib/pdf-outline.mjs';
import { pageLayout } from '../lib/page-layout.mjs';
import { detectTables } from '../lib/table-detect.mjs';
import { disclosure } from '../lib/ui-components.mjs';
import { esc } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';

const EMPTY = Object.freeze({ text: '', at: new Int32Array(0), off: new Int32Array(0) });
/** A letter key, by its place (⌥ changes what it types on a Mac) or by what it types (a key event a menu command dispatches has no code). */
export const isKey = (e, k) => e.code === `Key${k.toUpperCase()}` || String(e.key || '').toLowerCase() === k;

/**
 * The document's text, page by page, for find and for knowing which pages are pictures. `start(from)` reads every page once, from `from` outward
 * (the page in view first), one at a time; `on(fn)` hears each page as it arrives (0 when all are read). A page with no usable text is in `noText`
 * unless `ocr(n)` gives recognised text for it (PDF.js text content). Reading stops when `live()` turns false.
 */
export function pdfText(doc, { live = () => true, ocr = null } = {}) {
  const n = doc.numPages, runs = new Array(n).fill(null), noText = new Set(), heard = new Set();
  let job = null, done = false;
  async function readPage(p) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent().catch(() => null);
    if (!textLayerQuality(content, { view: page.view }).needsOcr) { noText.delete(p); return runsFromContent(content); }
    const alt = ocr ? await ocr(p).catch(() => null) : null;
    if (alt?.items?.length) { noText.delete(p); return runsFromContent(alt); }
    noText.add(p);
    return runsFromContent(content);
  }
  const order = from => { const out = []; for (let d = 0; out.length < n; d++) { if (from + d <= n) out.push(from + d); if (d && from - d >= 1) out.push(from - d); } return out; };
  const tell = p => { for (const f of heard) { try { f(p); } catch (err) { console.warn('[pdf] text listener', err); } } };
  return {
    pages: n, runs, noText,
    get done() { return done; },
    on(f) { heard.add(f); return () => heard.delete(f); },
    start(from = 1) {
      return job ||= (async () => {
        for (const p of order(Math.min(n, Math.max(1, from)))) {
          if (!live()) return;
          if (runs[p - 1] == null) { try { runs[p - 1] = await readPage(p); } catch { runs[p - 1] = []; } }
          if (!live()) return;
          tell(p);
        }
        done = true; tell(0);
      })();
    },
    /** A page read again (its text was recognised). */
    async again(p) { try { runs[p - 1] = await readPage(p); } catch {} if (live()) tell(p); },
  };
}

/** Boxes drawn on a page from PDF-unit rectangles, through the page's viewport: `cls` names them, and only that class is cleared first. */
export function drawBoxes(el, viewport, list, cls) {
  el.querySelectorAll(`:scope>.${cls.split(' ')[0]}`).forEach(e => e.remove());
  if (!viewport || !list.length) return;
  const frag = document.createDocumentFragment();
  for (const { rects, on = false, title = '', data = null, cls: kind = '' } of list) for (const r of rects || []) {
    const d = document.createElement('div');
    d.className = [cls, kind, on ? 'on' : ''].filter(Boolean).join(' ');
    if (title) d.title = title;
    if (data) for (const [k, v] of Object.entries(data)) d.dataset[k] = v;
    placeBox(d, pdfToBox(r, viewport));
    frag.append(d);
  }
  el.append(frag);
}
/**
 * Find hits on a drawn page. Where the page has its text layer, each hit is measured on the words themselves (PDF.js gives one span per run that has
 * text, in order); otherwise, or if the layer does not match the runs, the share of each run's advance stands in (lib/pdf-find.mjs hitRects).
 */
export function drawHits(el, viewport, list) {
  el.querySelectorAll(':scope>.hl-find').forEach(e => e.remove());
  if (!viewport || !list.length) return;
  const spans = el.querySelectorAll('.textlayer span[role="presentation"]'), base = el.getBoundingClientRect();
  const frag = document.createDocumentFragment(), boxes = [];
  for (const { hit, runs, rects, on } of list) {
    const where = i => { let k = -1; for (let j = 0; j <= i; j++) if (runs[j]?.str) k++; return spans[k]?.firstChild?.nodeType === 3 && spans[k].firstChild.data === runs[i].str ? spans[k].firstChild : null; };
    const a = runs && where(hit.item), b = runs && where(hit.endItem);
    let measured = null;
    if (a && b) {
      const r = document.createRange();
      try { r.setStart(a, Math.min(hit.start, a.length)); r.setEnd(b, Math.min(hit.end, b.length)); measured = [...r.getClientRects()].filter(x => x.width > 0.5 && x.height > 0.5).map(x => ({ left: x.left - base.left, top: x.top - base.top, width: x.width, height: x.height })); } catch { measured = null; }
    }
    for (const box of measured?.length ? measured : rects.map(rc => pdfToBox(rc, viewport))) boxes.push({ box, on });
  }
  for (const { box, on } of boxes) { const d = document.createElement('div'); d.className = on ? 'hl-find on' : 'hl-find'; placeBox(d, box); frag.append(d); }
  el.append(frag);
}

/**
 * The find bar of a viewer (views/reader-bars.mjs findSpec, in the region `${p}-top` with the strip). The search runs on the text cache, never on the
 * page; hits are drawn by the viewer (`redraw(pages)` asks it to draw those pages again, and `hitsOn(n)` is what to draw); `reveal(hit, rects)`
 * brings a hit into view. The count is written when every page is read; the first hit shows as soon as it is found.
 */
export function attachFind(root, { p, text, current, reveal, redraw, focusPage, caseFlag = flag('lykos.pdf.find', false) }) {
  const q = id => root.querySelector(`[id="${p}-${id}"]`);
  const region = q('top'), field = q('find-q'), count = q('find-count'), tool = q('find'), caseBtn = q('find-case'), prev = q('find-prev'), next = q('find-next');
  let open = false, query = '', matchCase = caseFlag.get(), hits = [], at = -1, preps = [], since = 0;
  caseBtn?.setAttribute('aria-pressed', String(matchCase));
  const prepAll = () => Array.from({ length: text.pages }, (_, i) => (text.runs[i] ? (preps[i] ||= preparePage(text.runs[i], { matchCase })) : EMPTY));
  const pagesOf = list => new Set(list.map(h => h.page));
  // All matches: every match in a list, with the words around it and its page; choosing one goes to it.
  const all = q('find-all'), SHOWN = 200;
  all?.addEventListener('click', () => {
    if (!hits.length) return;
    const items = hits.slice(0, SHOWN).map((h, i) => { const c = hitContext(h, text.runs[h.page - 1], 40);
      return { label: `${c.before}${c.match}${c.after}`.trim(), meta: `p. ${h.page}`, checked: i === at,
        run: () => { const was = hits[at]; at = i; redraw(new Set([was?.page, hits[at]?.page].filter(Boolean))); paint(); show(); } }; });
    showMenu(all, hits.length > SHOWN ? [...items, '-', { label: `${hits.length - SHOWN} more matches`, disabled: true }] : items, { align: 'end', minWidth: 420 });
  });
  function paint() {
    const t = countText({ n: hits.length, i: at, noText: text.noText.size, done: text.done, query });
    if (count.textContent !== t) count.textContent = t;
    field.title = t;   // the count stays readable when a narrow pane gives its slot to the field
    count.title = text.noText.size ? `${text.noText.size} page${text.noText.size === 1 ? ' has' : 's have'} no text to search: Recognise text is in More` : '';
    prev.disabled = next.disabled = !hits.length;
    if (all) all.disabled = !hits.length;
  }
  function show() { const h = hits[at]; if (h) reveal(h, hitRects(h, text.runs[h.page - 1])); }
  function rerun({ keep = true, move = false } = {}) {
    const was = hits[at], before = pagesOf(hits);
    hits = open && query ? findHits(prepAll(), query, { matchCase }) : [];
    at = was && keep ? hits.findIndex(h => h.page === was.page && h.item === was.item && h.start === was.start) : -1;
    const fresh = at < 0;
    if (fresh) at = hits.length ? nearest(hits, current()) : -1;
    redraw(new Set([...before, ...pagesOf(hits)]));
    paint();
    if (at >= 0 && (move || (fresh && !was))) show();
  }
  function step(dir) {
    if (!hits.length) return;
    const was = hits[at];
    at = cursor(hits, at, dir);
    redraw(new Set([was?.page, hits[at].page].filter(Boolean)));
    paint(); show();
  }
  function openFind(seed = null) {
    if (!region || !field) return;
    open = true; regionShow(region, 1); tool?.setAttribute('aria-pressed', 'true');
    if (seed != null) field.value = String(seed).replace(/\s+/g, ' ').trim().slice(0, 200);
    field.focus(); field.select();
    text.start(current());
    query = field.value; rerun({ keep: false, move: true });
  }
  function closeFind() {
    if (!open) return;
    open = false; regionShow(region, 0); tool?.setAttribute('aria-pressed', 'false');
    const pages = pagesOf(hits); hits = []; at = -1; redraw(pages);
    focusPage?.();
  }
  const off = text.on(pg => {
    if (!open || !query) return;
    if (pg === 0 || !hits.length || ++since >= 24) { since = 0; rerun({ keep: true, move: false }); }
  });
  tool?.addEventListener('click', () => (open ? closeFind() : openFind()));
  field?.addEventListener('input', () => { query = field.value; rerun({ keep: false, move: true }); });
  field?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  prev?.addEventListener('click', () => step(-1));
  next?.addEventListener('click', () => step(1));
  q('find-close')?.addEventListener('click', closeFind);
  caseBtn?.addEventListener('click', () => {
    matchCase = !matchCase; caseFlag.set(matchCase); caseBtn.setAttribute('aria-pressed', String(matchCase));
    preps = []; rerun({ keep: false, move: true });
  });
  paint();
  return {
    open: openFind, close: closeFind, step, isOpen: () => open,
    /** What to draw on page n: its hits, the current one marked. */
    hitsOn(n) { const out = [], runs = text.runs[n - 1]; hits.forEach((h, i) => { if (h.page === n) out.push({ hit: h, runs, rects: hitRects(h, runs), on: i === at }); }); return out; },
    /** The page's text changed (recognised): its prepared form is dropped. */
    forget(n) { preps[n - 1] = undefined; },
    state: () => ({ open, query, n: hits.length, at, current: hits[at] || null }),
    dispose: () => off(),
  };
}

/** A Contents entry (an outline row or a table): its title, going to its page, and the page's cell. */
const entryGo = r => `<button type="button" class="fv-entry fv-outline-go" data-go="${r.page}" title="${esc(r.title)}">${esc(r.title)}</button>`;
const pageCell = r => ({ col: 'page', kind: 'text', ch: 4, html: String(r.page) });

/**
 * The rail beside the page column (views/reader-bars.mjs railHtml): docked where the viewer says the page keeps its room (`dock()`), otherwise laid
 * over the page's left edge by its toggle and closed by a choice; Pages draws previews near the rail's view and lets far ones go (their box keeps its height, so nothing
 * moves); Contents is the outline, read when first shown, and under it a Tables group of the tables the page finder detects (caption and page), looked for
 * page by page once Contents has been shown and absent when there are none. `store` remembers the view for the file; `openFlag` the rail's openness for the app.
 */
export function attachRail(root, { p, doc, current, go, live, view = 'pages', store = () => {}, openFlag, dock = () => false, focusPage }) {
  const q = id => root.querySelector(`[id="${p}-${id}"]`);
  const rail = q('rail'), toggle = q('previews'), previews = rail.querySelector('.fv-pdf-previews'), contents = rail.querySelector('.fv-pdf-contents');
  const thumbs = [...previews.querySelectorAll('[data-thumb]')];
  let choice = openFlag.get(), overlay = false, rows = null, frame = 0, mark = -1, gone = false, tableScan = null, tableCount = 0;
  const shown = () => !rail.hidden;

  // ---- previews: sequential, near the view only; far ones let go ----
  const queue = []; let busy = false;
  const near = (t, top, h) => t.offsetTop + t.offsetHeight >= top - h && t.offsetTop <= top + 2 * h;
  const far = (t, top, h) => t.offsetTop + t.offsetHeight < top - 4 * h || t.offsetTop > top + 5 * h;
  function plan() {
    frame = 0;
    if (!shown() || previews.hidden || !live()) return;
    const top = previews.scrollTop, h = previews.clientHeight || 400;
    for (const t of thumbs) {
      if ('drawn' in t.dataset) { if (far(t, top, h)) release(t); }
      else if (near(t, top, h) && !queue.includes(t)) queue.push(t);
    }
    pump();
  }
  function release(t) {
    const img = t.querySelector('.fv-pdf-thumb-image');
    if (img) { img.style.setProperty('--th', `${img.getBoundingClientRect().height}px`); img.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; }); img.replaceChildren(); }
    delete t.dataset.drawn;
  }
  async function pump() {
    if (busy) return; busy = true;
    try {
      while (queue.length && live()) {
        const t = queue.shift(), n = +t.dataset.thumb;
        const top = previews.scrollTop, h = previews.clientHeight || 400;
        if ('drawn' in t.dataset || !shown() || previews.hidden || !near(t, top, h)) continue;
        try {
          const c = await renderThumbnail(doc, n, 136, live), img = t.querySelector('.fv-pdf-thumb-image');
          if (c && live() && img) { img.replaceChildren(c); img.style.removeProperty('--th'); t.dataset.drawn = ''; }
        } catch {}
      }
    } finally { busy = false; }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(plan); };
  previews.addEventListener('scroll', schedule, { passive: true });

  /** The rail keeps the current page's preview (or its section) in its own view; the page column never moves for it. */
  function follow() {
    const n = current();
    thumbs.forEach((t, i) => {
      if (i + 1 === n) { if (t.getAttribute('aria-current') !== 'page') { t.setAttribute('aria-current', 'page'); t.setAttribute('aria-selected', 'true'); t.tabIndex = 0; if (shown() && !previews.hidden) keepInView(previews, t); } }
      else if (t.hasAttribute('aria-current')) { t.removeAttribute('aria-current'); t.setAttribute('aria-selected', 'false'); t.tabIndex = -1; }
    });
    if (rows) {
      const at = sectionAt(rows, n);
      if (at !== mark) {
        contents.querySelector('[aria-current]')?.removeAttribute('aria-current');
        const row = contents.querySelector(`[data-outline="${at}"]`);
        if (row) { row.setAttribute('aria-current', 'true'); if (shown() && !contents.hidden) keepInView(contents, row); }
        mark = at;
      }
    }
  }
  const keepInView = (scroller, el) => {
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.max(0, top - (scroller.clientHeight - el.offsetHeight) / 2);
  };

  // ---- contents: the outline, once ----
  let loading = null;
  function loadContents() {
    return loading ||= (async () => {
      let found = [];
      try { found = await flattenOutline(await doc.getOutline(), pdfResolver(doc)); } catch { found = []; }
      if (!live()) return;
      rows = found;
      contents.innerHTML = `${uiList({ id: `${p}-outline`, label: 'Contents', text: 'short', cols: ['page'],
        empty: '<p class="fv-outline-none meta">No outline in this file</p>',
        rows: rows.map((r, i) => uiRow({ cls: 'fv-outline-row', depth: r.depth, attrs: { 'data-outline': i },
          main: { html: entryGo(r) }, cells: [pageCell(r)] })) })}<div class="fv-tables"></div>`;
      mark = -1; follow();
      scanTables();
    })();
  }
  // ---- tables: found page by page after the outline is drawn; the group appears with the first one and is never drawn when there is none ----
  const paintTables = list => {
    const host = contents.querySelector('.fv-tables'); if (!host) return;
    tableCount = list.length;
    const body = uiList({ id: `${p}-tables-list`, label: 'Tables', text: 'short', cols: ['page'],
      rows: list.map(t => uiRow({ cls: 'fv-outline-row', attrs: { 'data-table': '' },
        main: { html: entryGo(t) }, cells: [pageCell(t)] })) });
    const group = host.querySelector('details');
    if (group) { group.querySelector('.ui-disclosure-count').textContent = String(list.length); group.querySelector('.ui-disclosure-body').innerHTML = body; }
    else host.innerHTML = disclosure({ id: `${p}-tables-group`, title: 'Tables', count: list.length, open: true, body });
  };
  function scanTables() {
    return tableScan ||= (async () => {
      let OPS;
      try { ({ OPS } = await import(appUrl('pdfjs/build/pdf.min.mjs'))); } catch { return; }
      await findTables(doc.numPages, async n => detectTables(await pageLayout(await doc.getPage(n), OPS)),
        { live: () => live() && !gone, pause: () => new Promise(r => requestAnimationFrame(() => r())), onFound: paintTables });
      contents.querySelector('.fv-tables')?.setAttribute('data-scanned', '');   // every page was looked at (a test waits on it to see that none was found)
    })();
  }
  contents.addEventListener('click', e => {
    const b = e.target.closest?.('[data-go]'); if (!b) return;
    go(+b.dataset.go);
    if ('overlay' in rail.dataset) { overlay = false; paint(); focusPage?.(); }
  });

  // ---- the switch, the toggle, the dock ----
  function setView(v) {
    view = v === 'contents' ? 'contents' : 'pages';
    rail.querySelectorAll('[data-rail]').forEach(b => { const on = b.dataset.rail === view; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
    previews.hidden = view !== 'pages'; contents.hidden = view !== 'contents';
    if (view === 'contents') loadContents(); else schedule();
    mark = -1; follow();
  }
  rail.querySelector('.fv-pdf-rail-top')?.addEventListener('click', e => {
    const b = e.target.closest?.('[data-rail]'); if (!b || b.dataset.rail === view) return;
    setView(b.dataset.rail); store(view);
  });
  function paint() {
    const docked = dock(), on = docked ? choice : overlay;
    if (docked) overlay = false;
    if (rail.hidden === on) rail.hidden = !on;
    if (on && !docked) rail.dataset.overlay = ''; else delete rail.dataset.overlay;
    toggle?.setAttribute('aria-pressed', String(on));
    if (on) { follow(); schedule(); if (view === 'contents') loadContents(); }
  }
  toggle?.addEventListener('click', () => { if (dock()) { choice = !choice; openFlag.set(choice); } else overlay = !overlay; paint(); });
  previews.addEventListener('click', e => {
    const b = e.target.closest?.('[data-thumb]'); if (!b) return;
    go(+b.dataset.thumb);
    if ('overlay' in rail.dataset) { overlay = false; paint(); focusPage?.(); }
  });
  rail.addEventListener('keydown', e => {
    if (e.key === 'Escape' && 'overlay' in rail.dataset) { overlay = false; paint(); focusPage?.(); return; }
    if (!e.target.closest?.('[data-thumb]')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.closest('[data-thumb]').click(); return; }
    const n = current(), step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key], to = step ? n + step : e.key === 'Home' ? 1 : e.key === 'End' ? thumbs.length : 0;
    if (!to || to < 1 || to > thumbs.length) return;
    e.preventDefault(); go(to); thumbs[to - 1].focus({ preventScroll: true });
  });
  setView(view);
  paint();
  return {
    paint, follow, shown,
    dispose() { gone = true; cancelAnimationFrame(frame); queue.length = 0; },
    stats: () => ({ previews: thumbs.filter(t => 'drawn' in t.dataset).length, tables: tableCount }),
  };
}
