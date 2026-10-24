// Regions of a page in the reader: drag a box over a figure or a table, then
// digitise the curve in it or read the table in it (plan §4.8a, §4.5a).
//
// The reader owns the document and its pages and draws the strip's tools and the foot's region bar; this wires them: the drag, the table finder,
// and what can be done to the box. It touches the reader only through the accessors it is given.
import { appUrl } from '../lib/app-url.mjs';
import { placeBox } from '../lib/reader-geometry.mjs';
import { openDigitiser } from './km-digitiser.mjs';
import { openTableReader } from './table-reader.mjs';
import { pageLayout } from '../lib/page-layout.mjs';
import { pagesWithoutText, recognisePage } from '../lib/ocr.mjs';
import { refreshIndex } from '../lib/doctext.mjs';
import { detectTables, readTable } from '../lib/table-detect.mjs';
import { get, projectGeneration } from '../store.mjs';
import { queuePaper } from '../lib/fulltext-index.mjs';

/** A rectangle of a page, in PDF units, as a canvas at a resolution fit for reading small print. */
export async function regionCanvas(doc, pageNo, rect, { width = 2200, maxPixels = 14_000_000 } = {}) {
  const page = await doc.getPage(pageNo);
  const w = Math.abs(rect.x2 - rect.x1) || 1, h = Math.abs(rect.y2 - rect.y1) || 1;
  const scale = Math.max(1, Math.min(6, width / w, Math.sqrt(maxPixels / (w * h))));
  const vp = page.getViewport({ scale });
  const [ax, ay] = vp.convertToViewportPoint(rect.x1, rect.y1), [bx, by] = vp.convertToViewportPoint(rect.x2, rect.y2);
  const left = Math.min(ax, bx), top = Math.min(ay, by);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(Math.abs(bx - ax))); canvas.height = Math.max(1, Math.ceil(Math.abs(by - ay)));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, -left, -top], background: 'rgb(255,255,255)' }).promise;
  return canvas;
}

/**
 * acc: { viewer, doc(), hash(), paperId(), page(), stageFor(n), viewportFor(n), live(), rerender(), say(text), foot(on), clip(region)? } from the reader.
 * The tools (#rd-region, #rd-tables, #rd-ocr) are in the reader's strip and the five buttons of the region bar in its foot: this wires them.
 * Returns { detach() }.
 */
export function attachRegion(el, ctx, acc) {
  const q = id => el.querySelector(`#${id}`);
  const toggle = q('rd-region'), finder = q('rd-tables'), reader = q('rd-ocr');
  const info = text => { const b = q('rd-region-info'); if (b) { b.textContent = text; b.title = text; } };

  // ---- scanned pages: recognise their text (desktop app only; lib/ocr.mjs) ----
  let reading = false;
  if (reader) {
    reader.onclick = async () => {
      if (reading || !acc.doc()) return;
      reading = true; reader.disabled = true;
      const doc = acc.doc(), hash = acc.hash(), paperId = acc.paperId(), generation = projectGeneration();
      const fileHash = get().papers.find(p => p.id === paperId)?.pdfHash;
      const current = () => acc.live() && acc.doc() === doc && acc.hash() === hash && acc.paperId() === paperId &&
        generation === projectGeneration() && get().papers.find(p => p.id === paperId)?.pdfHash === fileHash;
      try {
        const { OPS } = await import(appUrl('pdfjs/build/pdf.min.mjs'));
        const todo = await pagesWithoutText(doc, { OPS, isCurrent: current });
        const first = todo.indexOf(acc.page()); if (first > 0) todo.unshift(...todo.splice(first, 1));
        let words = 0;
        for (let i = 0; i < todo.length; i++) {
          if (!current()) return;
          acc.say(`Reading page ${todo[i]} (${i + 1} of ${todo.length})`);
          words += await recognisePage(doc, hash, todo[i], [], { isCurrent: current, OPS });
        }
        if (!current()) return;
        refreshIndex(paperId);
        if (todo.length) await queuePaper(paperId, { force: true });
        if (!current()) return;
        acc.say(todo.length ? `${words} words recognised on ${todo.length} page${todo.length === 1 ? '' : 's'}. Check recognised text against the page.` : '');
        acc.rerender?.();
      } catch (err) { if (current()) acc.say(String(err.message || err).slice(0, 140)); }
      finally { reading = false; syncOcr(); }
    };
  }
  let syncQueued = false;
  function syncOcr() {
    if (!reader || reading) return;
    const vp = acc.viewportFor(acc.page());
    reader.disabled = !(vp?.noText && !vp.recognised);
  }
  const watcher = reader ? new MutationObserver(() => { if (!syncQueued) { syncQueued = true; requestAnimationFrame(() => { syncQueued = false; syncOcr(); }); } }) : null;
  watcher?.observe(acc.viewer, { childList: true, subtree: true });

  const viewer = acc.viewer;
  let on = false, drag = null, region = null;

  const set = v => {
    on = v; toggle.setAttribute('aria-pressed', String(v));
    viewer.classList.toggle('region-mode', v);
    if (!v) clear();
  };
  function clear() {
    region = null; acc.foot(false);
    viewer.querySelectorAll('.region-draw').forEach(e => e.remove());
  }
  // ---- tables the page holds, outlined for a click ----
  const layouts = new Map();   // page -> layout, for this document
  async function layoutOf(n) {
    if (layouts.has(n)) return layouts.get(n);
    const { OPS } = await import(appUrl('pdfjs/build/pdf.min.mjs'));
    const l = await pageLayout(await acc.doc().getPage(n), OPS);
    layouts.set(n, l); return l;
  }
  function unfind() { viewer.querySelectorAll('.region-found').forEach(e => e.remove()); finder.setAttribute('aria-pressed', 'false'); }
  finder.onclick = async () => {
    if (finder.getAttribute('aria-pressed') === 'true') { unfind(); return; }
    const n = acc.page(), stage = acc.stageFor(n), vp = acc.viewportFor(n);
    if (!stage || !vp || !acc.doc()) return;
    finder.disabled = true;
    try {
      const found = detectTables(await layoutOf(n));
      finder.setAttribute('aria-pressed', 'true');
      if (!found.length) { acc.say('No table found on this page'); return; }
      acc.say('');
      found.forEach((t, i) => {
        const [ax, ay] = vp.convertToViewportPoint(t.rect.x1, t.rect.y1), [bx, by] = vp.convertToViewportPoint(t.rect.x2, t.rect.y2);
        stage.insertAdjacentHTML('beforeend', `<button type="button" class="region-found" aria-label="Table ${i + 1}"></button>`);
        const b = stage.lastElementChild;
        placeBox(b, { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) });
        b.onclick = () => { unfind(); selectRegion(n, t.rect); };
      });
    } catch (err) { acc.say(String(err.message || err).slice(0, 120)); }
    finally { finder.disabled = false; }
  };
  function selectRegion(n, rect) {
    region = { page: n, rect };
    info(`Page ${n}`);
    acc.foot(true);
  }
  toggle.onclick = () => set(!on);
  q('rd-region-cancel').onclick = () => set(false);

  const stageOf = e => e.target.closest?.('.stage');
  const local = (stage, e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  viewer.addEventListener('pointerdown', e => {
    if (!on || e.button !== 0) return;
    const stage = stageOf(e); if (!stage) return;
    const n = Number(stage.dataset.page), vp = acc.viewportFor(n);
    if (!vp) return;
    e.preventDefault();
    clear();
    const box = document.createElement('div'); box.className = 'region-draw'; stage.appendChild(box);
    drag = { stage, n, vp, box, from: local(stage, e) };
    viewer.setPointerCapture(e.pointerId);
  });
  viewer.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = local(drag.stage, e), a = drag.from;
    const x = Math.max(0, Math.min(a.x, p.x)), y = Math.max(0, Math.min(a.y, p.y));
    const w = Math.min(drag.stage.clientWidth, Math.max(a.x, p.x)) - x, h = Math.min(drag.stage.clientHeight, Math.max(a.y, p.y)) - y;
    placeBox(drag.box, { left: x, top: y, width: Math.max(0, w), height: Math.max(0, h) });
    drag.rect = { x, y, w, h };
  });
  viewer.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.rect || d.rect.w < 24 || d.rect.h < 24) { d.box.remove(); return; }
    const [x1, y1] = d.vp.convertToPdfPoint(d.rect.x, d.rect.y), [x2, y2] = d.vp.convertToPdfPoint(d.rect.x + d.rect.w, d.rect.y + d.rect.h);
    selectRegion(d.n, { x1, y1, x2, y2 });
  });

  q('rd-region-table').onclick = async () => {
    if (!region || !acc.doc()) return;
    const btn = q('rd-region-table'); btn.disabled = true;
    try {
      const read = readTable(await layoutOf(region.page), region.rect);
      if (!read.rows.length) { info('No text in the region'); return; }
      await openTableReader({ read, ctx, where: { paperId: acc.paperId(), page: region.page, hash: acc.hash() } });   // a tab of Files; what it fills it reports there
    } catch (err) { info(String(err.message || err).slice(0, 120)); }
    finally { btn.disabled = false; }
  };

  q('rd-region-clip')?.addEventListener('click', () => {
    if (!region) return;
    const r = region; set(false);
    acc.clip(r);
  });

  q('rd-region-km').onclick = async () => {
    if (!region || !acc.doc()) return;
    const btn = q('rd-region-km'); btn.disabled = true;
    try {
      const image = await regionCanvas(acc.doc(), region.page, region.rect);
      await openDigitiser({ image, ctx, paperId: acc.paperId(), source: { kind: 'pdf', paper: acc.paperId(), page: region.page, region: region.rect, document_version: acc.hash() } });
    } catch (err) { info(String(err.message || err).slice(0, 120)); }
    finally { btn.disabled = false; }
  };

  return { detach() { watcher?.disconnect(); set(false); unfind(); } };
}
