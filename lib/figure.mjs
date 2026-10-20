// A figure with its own zoom and export controls.
//
// Figures arrive at wildly different natural sizes — a forest plot is far wider
// than a PRISMA diagram — so letting each one scale to whatever its container
// happens to be makes the app look arbitrarily zoomed. Every figure is shown at
// an explicit, stated scale instead, and the control is always in the same place.
import { sanitizeSvg } from './html.mjs';
import { icon, withIcon } from './icons.mjs';
import { saveFile } from './save.mjs';
import { showMenu } from './menu.mjs';
import { uiBar } from './ui-actions.mjs';
import { controlsOf } from './ui-components.mjs';
import { svgToPng } from './figure-draw.mjs';

const STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const plainText = t => String(t ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * The head of a figure panel as a head bar: the title, what the pointer is over, the caller's own controls (`extra`: a select or a
 * checkbox), a Zoom menu and Download. At most three controls are ever visible side by side, so zoom out, zoom in and Fit are
 * the entries of one Zoom menu whose label is the level (its tooltip is the figure's natural size). It never wraps: labels leave,
 * then the bar folds, then stacks. `extra` is read into declarations; markup it cannot read is an error, so no panel keeps a head of its own.
 */
function figureHead({ title, id, extra }) {
  const more = controlsOf(extra, id);
  const name = plainText(title) || 'Figure';
  // One head for every figure: a control the builders cannot read has no place in it (declare a button, select or label).
  if (!more) throw new TypeError(`figurePanel "${id}": extra must be buttons, selects or labels`);
  const hook = act => ({ 'data-fig': id, 'data-act': act });
  const used = new Set(more.acts.map(a => a.icon));
  const acts = [...more.acts,
    { id: `${id}-zoom`, label: '100%', icon: used.has('search') ? undefined : 'search', menu: true, dynamic: true, labelCh: 6, attrs: { ...hook('zoom'), 'aria-label': 'Zoom 100%' } },
    { id: `${id}-download`, label: 'Download', icon: used.has('download') ? undefined : 'download', menu: true, attrs: hook('download') }];
  return uiBar({ kind: 'head', label: `${name} controls`, id: `${id}-head`, cls: 'panel-head',
    lead: { title: name, level: 'h2' }, message: { id: `${id}-readout`, text: '' },
    filters: more.filters, actions: acts, overflow: more.overflow.length ? more.overflow : undefined,
    budget: acts.length > 4 ? { n: acts.length, reason: 'the caller declares extra controls' } : undefined });
}

/** The zoom level is the label of the Zoom menu. */
function showZoom(root, id, text) {
  const z = root.querySelector('#' + id + '-zoom'), label = z?.querySelector?.('.ui-act-label');
  if (label) { label.textContent = text; z.setAttribute('aria-label', `Zoom ${text}`); }
}

export function figurePanel({ title, id, extra = '' }) {
  return `<div class="panel">
    ${figureHead({ title, id, extra })}
    <div class="panel-body figure-wrap"><div class="figure" id="${id}"></div></div>
  </div>`;
}

/**
 * A figure at full size (DIALOGS #71, kind enlarge): the one modal that is not a width tier, since its content is the picture. Every figure
 * enlarges the same way: its panel in a dialog with a Close, the same zoom and download controls, and focus resting on the figure. `opts` is
 * showFigure's. Resolves when it closes.
 */
export function enlargeFigure({ title, svg, filename = 'figure', ...opts }) {
  const id = 'enlarged-figure', d = document.createElement('dialog');
  d.className = 'figure-enlarged'; d.dataset.dialog = 'enlarge-figure'; d.setAttribute('aria-label', title);
  d.innerHTML = figurePanel({ title, id, extra: '' });
  d.querySelector('.panel-head').insertAdjacentHTML('beforeend', `<button class="icon" data-close aria-label="Close">${icon('close')}</button>`);
  document.body.append(d);
  const previous = document.activeElement;
  return new Promise(resolve => {
    d.addEventListener('close', () => { d.remove(); previous?.focus?.(); resolve(); }, { once: true });
    d.querySelector('[data-close]').onclick = () => d.close();
    d.onclick = e => { const r = d.getBoundingClientRect(); if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close(); };
    d.showModal();
    showFigure(d, id, svg, filename, opts);
    const wrap = d.querySelector('.figure-wrap'); wrap?.setAttribute('tabindex', '-1'); wrap?.focus({ preventScroll: true });
  });
}

/**
 * Renders an SVG into a figure panel and wires its controls.
 *
 * The screen copy is drawn in the app's theme (themeSvg) and answers the
 * pointer: an element carrying a <title> is a target whose text becomes the
 * readout in the panel head. `labels` finds the study rows of an R forest plot
 * by their label text; `study(i)` gives such a row's paper id and `open(id)`
 * opens it. Downloads keep the publication drawing, white with black ink.
 */
export function showFigure(root, id, svg, filename = 'figure', { labels = null, study = null, open = null, whole = null, exportSvg = null, data = null } = {}) {
  const host = root.querySelector('#' + id);
  host.innerHTML = sanitizeSvg(svg);
  const el = host.querySelector('svg');
  if (!el) return;
  if (!el.hasAttribute('data-style')) themeTree(el);   // the screen copy, on the drawing itself (a house figure is drawn themed)
  interact(root, id, el, { labels, study, open });

  // Natural size, so a zoom percentage means something.
  const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = vb.length === 4 ? vb[2] : parseFloat(el.getAttribute('width')) || 600;
  const h = vb.length === 4 ? vb[3] : parseFloat(el.getAttribute('height')) || 400;
  el.removeAttribute('width'); el.removeAttribute('height');
  el.style.display = 'block';

  const state = { scale: 1 };
  const apply = () => {
    el.style.width = `${Math.round(w * state.scale)}px`;
    el.style.height = `${Math.round(h * state.scale)}px`;
    showZoom(root, id, `${Math.round(state.scale * 100)}%`);
  };
  // Fit shrinks a figure to the panel's width, never past its natural size,
  // and follows the panel while the person has not zoomed by hand. Height is
  // not fitted: a tall figure shrunk to the window was unreadable at a third of
  // its size; it is read at full width and scrolled, or paged (lib/forest-page.mjs).
  const fit = () => {
    const avail = host.parentElement.clientWidth - 24;
    // drawn while its pane is hidden (a narrow window shows the list first):
    // stay fitted, so the observer sizes it once the pane has a width
    if (avail <= 0) { state.fitted = true; return; }
    state.scale = Math.min(1, Math.max(0.25, avail / w)); state.fitted = true;
    apply();
  };
  host._fitWatch?.disconnect();
  cancelAnimationFrame(host._fitFrame || 0);
  let observedWidth = -1;
  host._fitWatch = new ResizeObserver(([entry]) => {
    if (!host.isConnected) { host._fitWatch.disconnect(); return; }
    const width = Math.round(entry.contentRect.width);
    if (width === observedWidth) return;
    observedWidth = width;
    cancelAnimationFrame(host._fitFrame || 0);
    host._fitFrame = requestAnimationFrame(() => { if (state.fitted && host.isConnected) fit(); });
  });
  host._fitWatch.observe(host.parentElement);

  const zoomIn = () => { state.scale = STEPS.find(s => s > state.scale + 1e-6) ?? STEPS.at(-1); state.fitted = false; apply(); };
  const zoomOut = () => { state.scale = [...STEPS].reverse().find(s => s < state.scale - 1e-6) ?? STEPS[0]; state.fitted = false; apply(); };
  root.querySelectorAll(`[data-fig="${id}"]`).forEach(b => b.onclick = () => {
    const act = b.dataset.act;
    if (act === 'in') return zoomIn();
    if (act === 'out') return zoomOut();
    if (act === 'fit') return fit();
    if (act === 'zoom') return showMenu(b, [{ label: 'Zoom in', icon: 'plus', run: zoomIn }, { label: 'Zoom out', icon: 'minus', run: zoomOut }, { label: 'Fit', icon: 'fit', run: fit }]);
    // Zoom and the download formats are one menu each, so a figure's header holds two controls.
    // The download is the publication drawing (exportSvg, the house export) or, for an R figure, the drawing shown.
    // A paged figure also offers the whole drawing (`whole()` reads it, an R figure kept by hash).
    if (act === 'download') return showMenu(b, downloadItems({ name: filename, svg: () => (exportSvg ? sanitizeSvg(exportSvg()) : clean), data, whole }));
  });

  fit();
  const size = `${Math.round(w)} × ${Math.round(h)}`, meta = root.querySelector('#' + id + '-meta');
  if (meta) meta.textContent = size; else { const z = root.querySelector('#' + id + '-zoom'); if (z) z.title = size; }
}

// ---- figure theme ---------------------------------------------------------
// Figures are drawn for publication: white paper, black ink, greys between.
// On screen the same drawing takes the theme. Every neutral fill and stroke is
// classed by its tone, 0 (paper) to 10 (ink), and the stylesheet mixes ink into
// the panel colour in that proportion, so a grey scale stays a grey scale in a
// dark theme. Hue is left alone: it carries a meaning (a risk-of-bias judgement).

const NAMED = { black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  dimgray: '#696969', dimgrey: '#696969', gainsboro: '#dcdcdc', whitesmoke: '#f5f5f5' };

/** A neutral colour's tone, 0 white to 10 ink; null for a hue, none or anything unparsed. */
export function tone(value) {
  const v = String(value ?? '').trim().toLowerCase(), c = NAMED[v] || v;
  let rgb, m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(c))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && parseInt(h.slice(6), 16) === 0) return null;
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c))) rgb = m.slice(1, 4).map(Number);
  else return null;
  if (Math.max(...rgb) - Math.min(...rgb) > 24) return null;
  const dark = 1 - (rgb[0] + rgb[1] + rgb[2]) / 765;
  return dark >= 0.85 ? 10 : Math.round(dark * 10);
}

const SHAPE = /^(rect|circle|ellipse|polygon|path)$/;
const styleOf = (style, prop) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style)?.[1].trim() ?? null;

/** What a panel shows: a house figure (data-style) as drawn, themed by its c-* classes; any other drawing (R's) through themeSvg (FIGURE-STYLE §2). */
export const screenCopy = svg => (/^<svg\b[^>]*\sdata-style="/.test(String(svg ?? '')) ? svg : themeSvg(svg));

/**
 * The screen copy of a publication SVG, on the parsed drawing (an <svg> element, sanitised): each neutral fill gets `tf-N` and each neutral
 * stroke `ts-N` (N its tone). Text and shapes left to the default black fill get `tf-10`. White text is left white: it only shows on a mark.
 * Nothing else changes. Classes are added to the elements, never to markup as text (2026-10-19: an edit of sanitised markup as text can wake
 * a tag the sanitiser left inert).
 */
export function themeTree(root) {
  const walk = (el, parent) => {
    const tag = String(el.localName || el.nodeName).toLowerCase();
    const style = el.getAttribute('style') || '', cls = el.getAttribute('class');
    const fill = styleOf(style, 'fill') ?? el.getAttribute('fill');
    const stroke = styleOf(style, 'stroke') ?? el.getAttribute('stroke');
    // svglite's own stylesheet gives its shapes no fill; its text is left black
    const svglite = parent.svglite || /\bsvglite\b/.test(cls || '');
    const add = [];
    if (fill != null) {
      const t = tone(fill);
      if (t != null && !(t === 0 && tag === 'text')) add.push(`tf-${t}`);
    } else if (!parent.fill && (tag === 'text' || (!svglite && SHAPE.test(tag)))) add.push('tf-10');
    if (stroke != null) { const t = tone(stroke); if (t != null) add.push(`ts-${t}`); }
    if (add.length) el.setAttribute('class', cls == null ? add.join(' ') : `${cls} ${add.join(' ')}`);
    for (const child of [...el.children]) walk(child, { fill: parent.fill || fill != null, svglite });
  };
  if (root) walk(root, { fill: false, svglite: false });
  return root;
}

/** The screen copy of an SVG as markup: parsed, its elements classed (themeTree), serialised; '' when it does not parse. */
export function themeSvg(svg) {
  if (typeof svg !== 'string') return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || !doc.documentElement) return '';
  return new XMLSerializer().serializeToString(themeTree(doc.documentElement));
}

/**
 * Pointer readout. A target is an element that had a <title>: the title's text
 * moves into data-readout, so no hover tooltip covers the figure, and shows in
 * the panel head while the pointer is on it. A study row may also carry
 * data-study, and a click opens that study.
 */
export function interact(root, id, el, { labels, study, open }) {
  for (const t of [...el.querySelectorAll('title')]) {
    const p = t.parentElement;
    if (p && p !== el && t.textContent.trim()) p.setAttribute('data-readout', t.textContent.trim());
    t.remove();
  }
  if (labels?.length) labelRows(el, labels, study);
  const out = root.querySelector(`#${id}-readout`);
  if (!out || !el.querySelector('[data-readout]')) return;
  let hot = null;
  const set = g => {
    if (g === hot) return;
    hot?.classList.remove('on');
    hot = g; hot?.classList.add('on');
    out.textContent = g ? g.getAttribute('data-readout') : '';
  };
  el.addEventListener('pointermove', e => set(e.target.closest?.('[data-readout]') || null));
  el.addEventListener('pointerleave', () => set(null));
  if (open) {
    const activate = e => {
      const g = e.target.closest?.('[data-study]');
      if (g) { e.preventDefault?.(); open(g.getAttribute('data-study')); }
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(e); });
  }
}

/**
 * Rows of an R forest plot, found by their study labels: a band under each
 * label's line whose readout is the line's text. The bands take the pointer,
 * so the text over them does not interrupt it (.fig-rows in the stylesheet).
 */
export function labelRows(el, labels, study) {
  const NS = 'http://www.w3.org/2000/svg';
  const texts = [...el.querySelectorAll('text')].map(t => ({ t, s: t.textContent.trim(), x: +t.getAttribute('x') || 0 }));
  const used = new Set();
  const found = labels.map(l => { const hit = texts.find(x => x.s === l && !used.has(x)); if (hit) used.add(hit); return hit; });
  if (found.some(f => !f)) return;
  const box = f => { try { return f.t.getBBox(); } catch { return null; } };
  const mid = found.map(f => { const b = box(f); return b && b.height ? b.y + b.height / 2 : NaN; });
  if (mid.some(v => !Number.isFinite(v))) return;
  const sorted = [...mid].sort((a, b) => a - b);
  const step = Math.min(...sorted.slice(1).map((v, i) => v - sorted[i]).filter(d => d > 1), 24);
  const vb = el.viewBox.baseVal, width = vb && vb.width ? vb.width : el.getBBox().width;
  const layer = document.createElementNS(NS, 'g');
  found.forEach((f, i) => {
    const line = texts.filter(x => { const b = box(x); return b && Math.abs(b.y + b.height / 2 - mid[i]) < step / 3; })
      .sort((a, b) => a.x - b.x).map(x => x.s).filter(Boolean);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-readout', line.join(' · '));
    const pid = study?.(i); if (pid) g.setAttribute('data-study', pid);
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('class', 'fig-band');
    r.setAttribute('x', '0'); r.setAttribute('width', String(width));
    r.setAttribute('y', (mid[i] - step / 2).toFixed(2)); r.setAttribute('height', step.toFixed(2));
    g.append(r); layer.append(g);
  });
  // over the white background, under everything drawn
  const bg = el.querySelector('rect');
  if (bg) bg.after(layer); else el.prepend(layer);
  el.classList.add('fig-rows');
}

export function download(text, filename, type) { return saveFile(text, filename, type); }

/** An SVG saved as a PNG through the one rasteriser: a house export at 600 dpi on its column, any other figure at three times its size. */
export async function downloadPng(svg, filename) {
  const bytes = await svgToPng(svg);
  if (bytes) return saveFile(bytes, filename, 'image/png');
}

/** The caption a figure carries: its title, then the lines of its source block (a house export's data-caption). */
export function captionOf(svg) {
  const s = String(svg ?? ''), title = plainText(s.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
  const block = s.match(/<g data-caption="">([\s\S]*?)<\/g>/)?.[1] || '';
  const lines = [...block.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => plainText(m[1]));
  return [title, lines.join(' ').replace(/\s+/g, ' ').trim()].filter(Boolean).join('. ').replace(/\.\./g, '.');
}

/**
 * The Download menu of every figure, cards and panels alike: SVG, PNG, Data (CSV) when the figure gives its
 * numbers, Copy caption; a paged figure adds the whole drawing as a section. `svg()` is the drawing to save.
 */
export function downloadItems({ name = 'figure', svg, data = null, whole = null }) {
  const page = whole ? 'This page · ' : '';
  return [
    { label: `${page}SVG`, icon: 'download', run: () => { const t = svg(); if (t) download(t, `${name}.svg`, 'image/svg+xml'); } },
    { label: `${page}PNG`, icon: 'download', run: () => { const t = svg(); if (t) downloadPng(t, `${name}.png`); } },
    ...(data ? [{ label: 'Data (CSV)', icon: 'download', run: () => { const rows = data(); if (rows?.length) downloadCsv(rows, `${name}.csv`); } }] : []),
    { label: 'Copy caption', icon: 'copy', run: () => { const t = captionOf(svg()); if (t) navigator.clipboard?.writeText(t); } },
    ...(whole ? ['-', { label: 'Whole figure · SVG', run: async () => { const t = await whole(); if (t) download(sanitizeSvg(t), `${name}.svg`, 'image/svg+xml'); } },
      { label: 'Whole figure · PNG', run: async () => { const t = await whole(); if (t) downloadPng(sanitizeSvg(t), `${name}.png`); } }] : []),
  ];
}

/** Rows are arrays; values are quoted so embedded commas and quotes survive. */
export function downloadCsv(rows, filename) {
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  download(rows.map(r => r.map(cell).join(',')).join('\n'), filename, 'text/csv');
}

/**
 * An SVG from R with its polygons and polylines thinned: repeated points and
 * points lying on the straight line between their neighbours are dropped.
 * metafor draws a summary diamond or a shaded funnel region as thousands of
 * points on a few straight edges; the drawing is unchanged, the file is not
 * stored hundreds of kilobytes larger than its content.
 */
export function compactSvg(svg) {
  if (typeof svg !== 'string') return svg;
  return svg.replace(/(<(?:polygon|polyline)\b[^>]*?\bpoints=')([^']*)(')/g, (_, open, pts, close) => {
    const p = pts.trim().split(/\s+/).map(xy => xy.split(',').map(Number));
    if (p.length < 3 || p.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return open + pts + close;
    const out = [];
    for (const q of p) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (b && b[0] === q[0] && b[1] === q[1]) continue;
      // b lies on the segment a–q when the triangle they span has (almost) no area.
      if (a && b && Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1])) < 1e-4
        && (b[0] - a[0]) * (q[0] - b[0]) + (b[1] - a[1]) * (q[1] - b[1]) >= 0) out.pop();
      out.push(q);
    }
    return open + out.map(([x, y]) => `${x},${y}`).join(' ') + close;
  });
}

/** One Download button whose menu lists the formats, the same on every figure and table. */
export const downloadButton = (attrs = '') =>
  `<button ${attrs} aria-haspopup="menu" aria-expanded="false">${withIcon('download', 'Download')}${icon('chevron-down', { size: 12 })}</button>`;
/** Opens the format menu from that button: items are [{ label, icon, run }]. */
export function wireDownload(button, items) {
  if (button) button.onclick = () => showMenu(button, typeof items === 'function' ? items() : items);
}
