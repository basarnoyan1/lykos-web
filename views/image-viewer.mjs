// An image in the Files view: fitted to the window when it opens, zoomed from 10% to 800% by the zoom group, the wheel with ⌃ (a trackpad pinch) or
// the keys + - 0 1, centred on the pointer; dragged to pan when it is larger than the window; turned and flipped for viewing only (the file is never
// written); shown on the theme, white, black or a checkerboard; and stepped to the previous or next image of its folder in the folder page's order.
//
// The image is one <img> at its own size moved by a CSS transform, never a canvas, so a large image costs its decoded pixels at any zoom. The arithmetic
// is lib/image-view.mjs. The tools bar is the document's own (file-doc.mjs placeTools), the shape the Word and PDF viewers use.
import { esc, emptyState } from '../lib/html.mjs';
import { uiGroup, watchWidth } from '../lib/ui-actions.mjs';
import { baseName } from '../lib/fsys.mjs';
import * as V from '../lib/image-view.mjs';

const BG_KEY = 'lykos.files.imageBackground';
const BACKGROUNDS = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['checker', 'Checkerboard']];
const FITS = [['fit', 'Fit window'], ['width', 'Fit width'], ['actual', 'Actual size']];
const COPY_MAX = 50e6;               // pixels drawn to copy an image that is not a PNG
const readBg = () => { try { const v = localStorage.getItem(BG_KEY); return BACKGROUNDS.some(b => b[0] === v) ? v : 'auto'; } catch { return 'auto'; } };

/**
 * Shows the image `bytes` of `ops.rel` in `body`. `ops.siblings()` resolves to the folder's images in the page's order (lib/image-view.mjs imageOrder),
 * `ops.step(rel)` shows another image in this tab, `ops.autofocus` gives the image the keyboard once it is up.
 */
export async function imageViewer(ops, bytes, { body: b, placeTools }) {
  const { host, uid: u, rel, inst, isLive, say } = ops;
  const name = baseName(rel), mime = V.imageMime(name);
  const url = URL.createObjectURL(new Blob([bytes], mime ? { type: mime } : {})); inst.urls.push(url);
  const img = new Image();
  img.alt = name; img.draggable = false; img.decoding = 'async'; img.src = url;
  let decoded = true;
  try { await img.decode(); } catch { decoded = false; }
  if (!isLive()) return;
  let natural = [img.naturalWidth, img.naturalHeight];
  if (mime) { const s = V.svgSize(new TextDecoder().decode(bytes.subarray(0, 65536))); natural = s || (natural[0] > 0 ? natural : [300, 150]); }
  if (!decoded || !(natural[0] > 0 && natural[1] > 0)) { b.innerHTML = emptyState({ icon: 'image', title: 'This image cannot be shown here', detail: V.imageType(name) }); return; }

  let zoom = 1, mode = 'fit', deg = 0, flipX = false, flipY = false, bg = readBg(), order = [];
  const info = V.imageInfo(natural, name);
  host.classList.add('fv-image');
  b.classList.add('fv-image-body');
  // the probe is as tall as the viewer and written top to bottom, so the engine's width hook (its one observer) hears the viewer's height as well
  b.innerHTML = `<div class="fv-image-view" tabindex="0" role="region" aria-label="${esc(name)}" data-bg="${bg}"><div class="fv-image-stage"></div></div><span class="fv-image-tall" aria-hidden="true"></span>`;
  const view = b.querySelector('.fv-image-view'), stage = view.firstElementChild, tall = b.querySelector('.fv-image-tall');
  img.className = 'fv-image-img';
  stage.style.setProperty('--fv-iw', `${natural[0]}px`); stage.style.setProperty('--fv-ih', `${natural[1]}px`);
  stage.append(img);

  const bar = placeTools(ops, {
    label: 'Image tools',
    status: { id: `${u}-info`, text: info, ch: 24 },
    actions: [
      uiGroup({ id: `${u}-step`, label: 'Images in this folder', fold: 3, items: [
        { id: `${u}-prev`, label: 'Previous image', icon: 'chevron-left', kbd: '←', disabled: true },
        { id: `${u}-next`, label: 'Next image', icon: 'chevron-right', kbd: '→', disabled: true }] }),
      uiGroup({ id: `${u}-zoom`, label: 'Zoom', fold: 1, items: [
        { id: `${u}-zoom-out`, label: 'Zoom out', icon: 'minus', kbd: '-' },
        { readout: '100%', id: `${u}-zoom-level`, label: 'Zoom level', ch: 6 },
        { id: `${u}-zoom-in`, label: 'Zoom in', icon: 'plus', kbd: '+' }] }),
      uiGroup({ id: `${u}-rotate`, label: 'Rotate', fold: 7, items: [
        { id: `${u}-rotate-left`, label: 'Rotate left', icon: 'rotate-left' },
        { id: `${u}-rotate-right`, label: 'Rotate right', icon: 'rotate-right' }] }),
      // last before More: its value changes width (Fit window, Custom), and nothing comes after it to move
      { picker: true, id: `${u}-fit`, label: 'Fit', icon: 'fit', role: 'quiet', fold: 5, value: 'Fit window', options: FITS, valueCh: 12 },
    ],
    overflow: [
      { id: `${u}-flip-x`, label: 'Flip horizontally', checked: false, run: () => { flipX = !flipX; apply(); } },
      { id: `${u}-flip-y`, label: 'Flip vertically', checked: false, run: () => { flipY = !flipY; apply(); } },
      { id: `${u}-reset`, label: 'Reset view', run: () => { deg = 0; flipX = flipY = false; mode = 'fit'; apply(); } },
      '-',
      { id: `${u}-bg`, label: 'Background', kind: 'select', options: BACKGROUNDS, value: bg, run: el => setBg(el.value) },
      '-',
      { id: `${u}-copy`, label: 'Copy image', run: () => copy() },
    ],
    budget: { n: 4, reason: 'an image: its folder\'s images, zoom, rotate and fit' },
  });
  const q = id => bar.querySelector(`[id="${u}-${id}"]`);
  const client = () => [view.clientWidth, view.clientHeight];
  const geometry = () => ({ natural, deg, client: client() });

  /** Lays the image out at the zoom the mode gives (or `next`), keeping `pointer` (viewer coordinates) over the same image point. */
  function apply({ next = null, pointer = null } = {}) {
    const from = zoom, g = geometry();
    zoom = next != null ? next : mode === 'actual' ? 1 : mode === 'custom' ? zoom : V.fitZoom({ ...g, mode });
    const scroll = pointer && from > 0 ? V.zoomAt({ ...g, scroll: [view.scrollLeft, view.scrollTop], pointer }, from, zoom) : null;
    // the stage is the turned image and its margin, and never less than the viewer, with the image in its middle: one smaller than the viewer is centred
    // (a scroll bar that comes or goes changes the viewer, so it is measured again)
    const [w, h] = V.stageSize(g, zoom);
    for (let pass = 0, size = ''; pass < 2; pass++) {
      const [cw, ch] = client(), sw = Math.max(w, cw), sh = Math.max(h, ch);
      if (size === `${sw}x${sh}`) break;
      size = `${sw}x${sh}`;
      stage.style.setProperty('--fv-sw', `${sw}px`); stage.style.setProperty('--fv-sh', `${sh}px`);
    }
    stage.style.setProperty('--fv-turn', `scale(${flipX ? -1 : 1},${flipY ? -1 : 1}) rotate(${deg}deg) scale(${zoom})`);
    if (scroll) { view.scrollLeft = scroll[0]; view.scrollTop = scroll[1]; }
    view.toggleAttribute('data-pan', V.pannable(g, zoom));
    view.toggleAttribute('data-pixels', !mime && zoom >= 2);
    const level = q('zoom-level'); if (level) level.textContent = V.percent(zoom);
    q('zoom-out').disabled = zoom <= V.ZOOM_MIN + 1e-3;
    q('zoom-in').disabled = zoom >= V.ZOOM_MAX - 1e-3;
    const fit = q('fit'), label = FITS.find(f => f[0] === mode)?.[1] || 'Custom', value = fit?.querySelector('.ui-picker-value');
    if (value && value.textContent !== label) value.textContent = label;
    q('flip-x')?.setAttribute('aria-pressed', String(flipX)); q('flip-y')?.setAttribute('aria-pressed', String(flipY));
    // the status is the image's info, or while it is turned or flipped, that this is the view only (a fixed slot: nothing moves)
    const status = q('info'), text = V.viewNote({ deg, flipX, flipY }) || info;
    if (status && status.textContent !== text) status.textContent = text;
  }
  const centre = () => client().map(v => v / 2);
  const zoomTo = (z, pointer = centre()) => { mode = 'custom'; apply({ next: V.clampZoom(z), pointer }); };
  const zoomStep = dir => { if (dir < 0 && zoom <= V.ZOOM_MIN + 1e-3) return; zoomTo(V.stepZoom(zoom, dir)); };
  const setMode = (m, pointer = centre()) => { mode = m; apply({ pointer }); };
  const turn = d => { deg = V.rotation(deg + d); if (mode === 'custom') mode = 'fit'; apply(); };
  function setBg(value) {
    bg = BACKGROUNDS.some(x => x[0] === value) ? value : 'auto';
    view.dataset.bg = bg;
    const sel = q('bg'); if (sel && sel.value !== bg) sel.value = bg;
    try { localStorage.setItem(BG_KEY, bg); } catch {}
  }

  q('zoom-out').onclick = () => zoomStep(-1);
  q('zoom-in').onclick = () => zoomStep(1);
  q('rotate-left').onclick = () => turn(-90);
  q('rotate-right').onclick = () => turn(90);
  q('fit').addEventListener('ui-pick', e => { const v = e.detail?.value; if (FITS.some(f => f[0] === v)) setMode(v); });

  // ---- the folder's other images
  const neighbours = () => V.neighbours(order, rel);
  const stepTo = d => { const n = neighbours(), to = d > 0 ? n.next : n.prev; if (to && ops.step) ops.step(to); return !!to; };
  q('prev').onclick = () => stepTo(-1);
  q('next').onclick = () => stepTo(1);
  if (ops.siblings && ops.step) ops.siblings().then(list => {
    if (!isLive()) return;
    order = list || [];
    const n = neighbours();
    q('prev').disabled = !n.prev; q('next').disabled = !n.next;
  }).catch(() => {});

  // ---- pointer: ⌃ wheel and the trackpad pinch zoom at the pointer; a drag pans; a double click is Fit or 100%
  const at = e => { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let gesture = null;
  view.addEventListener('wheel', e => {
    if (!e.ctrlKey || gesture) return;
    e.preventDefault();
    zoomTo(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), at(e));
  }, { passive: false });
  // WebKit reports a pinch as gesture events with the scale since it began
  view.addEventListener('gesturestart', e => { e.preventDefault(); gesture = { zoom }; });
  view.addEventListener('gesturechange', e => { if (!gesture) return; e.preventDefault(); zoomTo(gesture.zoom * e.scale, at(e)); });
  view.addEventListener('gestureend', e => { e.preventDefault(); gesture = null; });
  let drag = null;
  view.addEventListener('pointerdown', e => {
    view.focus({ preventScroll: true });
    if (e.button !== 0 || !view.hasAttribute('data-pan')) return;
    if (e.target === view) return;                                         // a scroll bar: the stage covers the rest of the viewer
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop };
    view.setPointerCapture(e.pointerId); view.setAttribute('data-panning', '');
  });
  view.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    view.scrollLeft = drag.left - (e.clientX - drag.x); view.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const endDrag = e => { if (!drag || e.pointerId !== drag.id) return; drag = null; view.removeAttribute('data-panning'); };
  view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);
  view.addEventListener('dblclick', e => { if (Math.abs(zoom - 1) > 1e-3) setMode('actual', at(e)); else setMode('fit', at(e)); });

  // ---- keys, while the image has the focus
  view.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    let done = true;
    if (k === '+' || k === '=') zoomStep(1);
    else if (k === '-' || k === '_') zoomStep(-1);
    else if (k === '0') setMode('fit');
    else if (k === '1') setMode('actual');
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !V.pannable(geometry(), zoom, 0)) done = stepTo(k === 'ArrowRight' ? 1 : -1);
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  });

  // ---- the window: the image is laid out again when the viewer changes width or height (a fitted one refits)
  const refit = () => { if (isLive()) apply(); };
  const unwatch = [watchWidth(view, refit), watchWidth(tall, refit)];
  inst.releasers.push(() => unwatch.forEach(f => f()));

  /** The image as PNG on the clipboard: a PNG as it is, anything else drawn once at its own size. */
  async function copy() {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('copying images is not available here');
      const png = /\.png$/i.test(name) ? Promise.resolve(new Blob([bytes], { type: 'image/png' })) : (async () => {
        const [w, h] = natural.map(Math.round);
        if (w * h > COPY_MAX) throw new Error('the image is too large to copy');
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('the image could not be drawn');
        return blob;
      })();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      say('Image copied');
    } catch (err) { say(`Not copied: ${String(err?.message || err).slice(0, 80)}`); }
  }

  apply();
  if (ops.autofocus) view.focus({ preventScroll: true });
  inst.image = { state: () => ({ zoom, mode, deg, flipX, flipY, bg, natural: [...natural], order: order.map(e => e.rel) }) };
}
