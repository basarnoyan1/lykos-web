// The arithmetic of the image viewer (views/image-viewer.mjs): zoom steps, the fit of a turned image, the scroll that keeps the point under the pointer
// where it is while the zoom changes, the images of a folder in the order its page lists them, and what an image is called.
//
// Pure: no DOM. A zoom is a factor (1 is the image's own pixels). The image is drawn by a CSS transform of its <img>, never a canvas, so a large
// image costs its decoded pixels and nothing more at any zoom. The stage the viewer scrolls is the turned image at the zoom plus MARGIN on each side.
import { sortFolderEntries, extension } from './folder-view.mjs';

export const ZOOM_MIN = 0.1, ZOOM_MAX = 8, MARGIN = 16;
/** The zoom levels Zoom in and Zoom out step through. */
export const ZOOM_STEPS = Object.freeze([0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]);
/** The kinds the viewer shows; the webview decides what it can decode (TIFF only in WebKit). */
export const IMAGE_EXT = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'tif', 'tiff']);
const NAMES = { png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', svg: 'SVG', bmp: 'BMP', avif: 'AVIF', tif: 'TIFF', tiff: 'TIFF' };

const finite = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, finite(z, 1)));
/** A zoom as the readout shows it. */
export const percent = z => `${Math.round(finite(z, 1) * 100)}%`;

/** The next step above (`dir` 1) or below (-1) a zoom; a zoom between steps goes to the nearest one in that direction. Stays at the ends. */
export function stepZoom(z, dir) {
  const at = finite(z, 1), eps = 1e-3;
  if (dir > 0) return ZOOM_STEPS.find(s => s > at + eps) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find(s => s < at - eps) ?? Math.min(at, ZOOM_MIN);
}

/** A rotation in quarter turns, as 0, 90, 180 or 270. */
export const rotation = deg => ((Math.round(finite(deg) / 90) % 4 + 4) % 4) * 90;
/** The width and height the image takes once turned. */
export function turned([w, h], deg = 0) { return rotation(deg) % 180 ? [h, w] : [w, h]; }

/**
 * The zoom that fits the turned image in the viewer: `fit` the whole image in the window, `width` its width; never above 1 (a small image keeps
 * its own pixels). An empty viewer or an image with no size gives 1.
 */
export function fitZoom({ client = [0, 0], natural = [0, 0], deg = 0, mode = 'fit', margin = MARGIN } = {}) {
  const [w, h] = turned(natural.map(v => finite(v)), deg), cw = finite(client[0]) - 2 * margin, ch = finite(client[1]) - 2 * margin;
  if (!(w > 0 && h > 0) || !(cw > 0)) return 1;
  const across = cw / w;
  const z = mode === 'width' || !(ch > 0) ? across : Math.min(across, ch / h);
  return Math.max(0.001, Math.min(1, z));
}

/** The stage the viewer scrolls at a zoom: the turned image and its margin. */
export const stageSize = ({ natural = [0, 0], deg = 0, margin = MARGIN }, z) => turned(natural, deg).map(v => Math.max(0, finite(v)) * z + 2 * margin);

/**
 * The scroll that keeps the point under the pointer where it is when the zoom goes from `from` to `to`. A stage narrower than the viewer is
 * centred (no scroll on that axis); the result is kept inside what can be scrolled.
 *   view: { scroll: [left, top], client: [w, h], pointer: [x, y] (from the viewer's top left), natural, deg, margin }
 */
export function zoomAt(view, from, to) {
  const { scroll = [0, 0], client = [0, 0], pointer = [0, 0] } = view, margin = view.margin ?? MARGIN;
  const before = stageSize({ ...view, margin }, from), after = stageSize({ ...view, margin }, to);
  return [0, 1].map(i => {
    const off = Math.max(0, (client[i] - before[i]) / 2), offAfter = Math.max(0, (client[i] - after[i]) / 2);
    const at = (pointer[i] - off + scroll[i] - margin) / from;          // the image coordinate under the pointer, in the turned image's pixels
    const next = at * to + margin + offAfter - pointer[i];
    return Math.round(Math.min(Math.max(0, after[i] - client[i]), Math.max(0, next)));
  });
}

/** Whether the stage at a zoom is larger than the viewer on either axis (a drag pans it), or on one (`axis` 0 across, 1 down). */
export const pannable = (view, z, axis = -1) => stageSize(view, z).some((s, i) => (axis < 0 || axis === i) && s > finite(view.client?.[i]) + 0.5);

/** The image files of a folder listing in the order the folder page lists them (its sort, folders aside); `keep` filters out hidden entries. */
export function imageOrder(entries, prefs = {}, keep = () => true) {
  const images = (entries || []).filter(e => e && !e.dir && typeof e.name === 'string' && IMAGE_EXT.includes(extension(e.name)) && keep(e));
  return sortFolderEntries(images, { ...prefs, foldersFirst: false });
}
/** The images before and after `rel` in `order`, wrapping; null each when it is the only one (or not in it). */
export function neighbours(order, rel) {
  const i = (order || []).findIndex(e => e.rel === rel), n = order?.length || 0;
  if (i < 0 || n < 2) return { prev: null, next: null, index: i, count: n };
  return { prev: order[(i - 1 + n) % n].rel, next: order[(i + 1) % n].rel, index: i, count: n };
}

/** The type of an image as people name it: PNG, JPEG, SVG. */
export const imageType = name => NAMES[extension(String(name || ''))] || (extension(String(name || '')).toUpperCase() || 'Image');
/** The MIME type a Blob of these bytes needs: SVG must say so to be drawn; the others are sniffed. */
export const imageMime = name => (extension(String(name || '')) === 'svg' ? 'image/svg+xml' : '');

/**
 * The size an SVG declares: its width and height in px (or unitless), else its viewBox. Null when it says neither (the browser then draws it at
 * 300 by 150). Percentages and other units are not sizes here.
 */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(String(text || ''))?.[0];
  if (!tag) return null;
  const attr = name => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]?.trim();
  const px = v => { const m = /^(\d+(?:\.\d+)?)(px)?$/.exec(v || ''); return m ? +m[1] : 0; };
  const w = px(attr('width')), h = px(attr('height'));
  const box = (attr('viewBox') || '').split(/[\s,]+/).map(Number);
  const vb = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? [box[2], box[3]] : null;
  if (w && h) return [w, h];
  if (vb && w) return [w, w * vb[1] / vb[0]];
  if (vb && h) return [h * vb[0] / vb[1], h];
  return vb;
}

/** The info the viewer's status shows: "1600 × 1200 px · PNG". */
export const imageInfo = ([w, h], name) => `${Math.round(finite(w))} × ${Math.round(finite(h))} px · ${imageType(name)}`;

/**
 * What the view does to the image, said once while it is turned or flipped (the file is never changed). It stands in the status in place of the
 * image's info, so it fits the status's 24 characters: "View only: rotated 90°", "View only: flipped", "View only: 270°, flipped".
 */
export function viewNote({ deg = 0, flipX = false, flipY = false } = {}) {
  const turn = rotation(deg), flip = flipX || flipY;
  if (!turn && !flip) return '';
  return `View only: ${turn && flip ? `${turn}°, flipped` : turn ? `rotated ${turn}°` : 'flipped'}`;
}
