// The figure text primitives of the house style (FIGURE-STYLE §2): the root, a
// text, a label wrapped to two lines at a measured width (never an ellipsis),
// the label column with its overflow key, the source block under a figure, a
// baseline, a tick, the arrowhead and the one rasteriser every PNG goes
// through. Every colour, size and weight comes from the token set `t`
// (figureTokens of lib/figure-style.mjs): this file holds none, which
// figure-style-lint.test.mjs holds it to. Pure but for svgToPng, which needs
// a document (absent under node: it answers null).
import { textWidth } from './textwidth.mjs';
import { setPngDpi } from './png-meta.mjs';
import { isFigureTokens } from './figure-style.mjs';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A coordinate to one decimal, as text. */
export const r1 = x => String(Math.round(x * 10) / 10);
/** Line height of a label, and the gap between a label and what it names, as multiples of the label size. */
export const LINE = 1.25;
export const GAP = 0.6;
export const sizeOf = (t, role = 'label') => (role === 'small' ? t.size.small : t.size.label);
/** Width of `s` in the figure's unit, with the medium's measured font scale. */
export const measure = (t, s, role = 'label') => textWidth(String(s ?? ''), sizeOf(t, role), t.metrics);

/**
 * The root of a house figure. The export is sized in inches over a viewBox in
 * points, so it places at its printed size; the screen copy in px. `<title>`,
 * `aria-label` and `<desc>` carry the title (a figure never draws its title:
 * the journal sets the caption); `<desc>` also names the style that drew it.
 */
export function svgRoot(t, w, h, body, { title = '', desc = '', defs = '' } = {}) {
  // Tokens are written into attributes: only a set figureTokens checked (hex colours, finite numbers) may draw.
  if (!isFigureTokens(t)) throw new TypeError('A house figure is drawn with figureTokens() of lib/figure-style.mjs');
  // points keep a decimal, so a column is 3.35 in and not the next whole point; px are whole
  const inch = t.unit === 'pt' ? 72 : null, W = inch ? Number(r1(w)) : Math.ceil(w), H = inch ? Number(r1(h)) : Math.ceil(h);
  const size = inch ? `width="${Math.round(W / inch * 1000) / 1000}in" height="${Math.round(H / inch * 1000) / 1000}in"` : `width="${W}" height="${H}"`;
  const stamp = [`Lykos house style v${t.version}`, `profile ${t.id}@${t.version} ${t.hash.slice(0, 12)}`, desc].filter(Boolean).join(' · ');
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" data-style="${esc(t.id)}" font-family="${esc(t.font)}" font-size="${t.size.label}" style="font-variant-numeric:tabular-nums">` +
    `<title>${esc(title)}</title><desc>${esc(stamp)}</desc>${defs ? `<defs>${defs}</defs>` : ''}<rect class="c-bg" width="100%" height="100%" fill="${t.color.page}"/>${body}</svg>`;
}

/** One line of text. `role` is label (the root's size), small or head (label size, heading weight). */
export function text(t, x, y, s, { anchor = 'start', role = 'label', cls = 'c-ink', color = null, attrs = '', inner = '' } = {}) {
  const size = role === 'small' ? ` font-size="${t.size.small}"` : '';
  const weight = role === 'head' ? ` font-weight="${t.weight.head}"` : '';
  const fill = color || (role === 'small' || /\bc-(?:mute|note)\b/.test(cls) ? t.color.ink2 : t.color.ink);
  return `<text x="${r1(x)}" y="${r1(y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}${size}${weight} class="${cls}" fill="${fill}"${attrs ? ` ${attrs}` : ''}>${esc(s)}${inner}</text>`;
}

/**
 * Several lines as one `<text>` (a `<tspan>` per line), centred on `cy`: a row
 * label of one or two lines, or a box's lines. One element keeps one hit target.
 */
export function lines(t, x, cy, list, { anchor = 'start', role = 'label', cls = 'c-ink', color = null, attrs = '', inner = '', lh = null } = {}) {
  const size = sizeOf(t, role), step = lh ?? size * LINE, top = cy - (list.length - 1) * step / 2 + size * 0.35;
  if (list.length === 1) return text(t, x, top, list[0], { anchor, role, cls, color, attrs, inner });
  const spans = list.map((l, i) => `<tspan x="${r1(x)}" y="${r1(top + i * step)}">${esc(l)}</tspan>`).join('');
  return text(t, x, top, '', { anchor, role, cls, color, attrs, inner: spans + inner }).replace(/ x="[^"]*" y="[^"]*"/, '');
}

/**
 * `s` wrapped at `maxW` by measured width, words kept whole; a word wider than
 * the column is broken between characters (never an ellipsis). Returns every
 * line: the caller decides what more than two lines means.
 */
export function wrapText(t, s, maxW, role = 'label') {
  const out = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (measure(t, word, role) > maxW && word.length > 1) {
        // fill what is left of this line, else a line of its own, with as much of the word as fits
        let room = line ? maxW - measure(t, `${line} `, role) : maxW, k = 0;
        while (k < word.length && measure(t, word.slice(0, k + 1), role) <= room) k++;
        if (!k && line) { out.push(line); line = ''; continue; }
        k = Math.max(1, k);
        out.push(line ? `${line} ${word.slice(0, k)}` : word.slice(0, k)); line = ''; word = word.slice(k);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && measure(t, next, role) > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/**
 * The row-label column of a row chart: each label wrapped to at most two lines
 * at `maxW`; the column is the widest wrapped line plus the gap to the plot.
 * A label that still needs three lines is drawn as its key (1, 2, …) and listed
 * in `keys` for the figure's source block: a figure never cuts a label.
 */
export function labelColumn(t, labels, maxW, { min = 0 } = {}) {
  const keys = [];
  const wrapped = labels.map(l => {
    const ls = wrapText(t, l, maxW);
    if (ls.length <= 2) return ls;
    keys.push({ key: String(keys.length + 1), label: String(l) });
    return [String(keys.length)];
  });
  const widest = Math.max(min, ...wrapped.flat().map(l => measure(t, l)));
  return { lines: wrapped, w: Math.min(maxW, widest) + t.size.label * GAP, keys };
}

/** The height of a row holding `n` label lines: the row, or the lines with a little air. */
export const rowHeight = (t, n) => Math.max(t.row, n * t.size.label * LINE + t.row * 0.3);

/**
 * The text block under an export figure: source and N, a method note, the
 * overflow key, each wrapped to the figure's width, small, muted. Returns
 * `{ svg, h }`; nothing (h 0) for no lines. The one editable block of a figure.
 */
export function sourceBlock(t, x, y, w, items) {
  const all = items.filter(Boolean).flatMap(s => wrapText(t, s, w, 'small'));
  if (!all.length) return { svg: '', h: 0 };
  const step = t.size.small * 1.45;
  const svg = `<g data-caption="">${all.map((l, i) => text(t, x, y + t.size.small + i * step, l, { role: 'small', cls: 'c-note' })).join('')}</g>`;
  return { svg, h: t.size.small + (all.length - 1) * step + t.size.small * 0.6 };
}
/** The overflow key of a label column as source-block lines. */
export const keyLines = keys => keys.map(k => `${k.key} ${k.label}`);

/** A line in the axis colour and weight: a baseline, a null line. */
export const axisLine = (t, x1, y1, x2, y2, { cls = 'c-axis', width = null } = {}) =>
  `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${t.color.axis}" stroke-width="${width ?? t.line.axis}"/>`;
/** A hairline (a rule under column heads, above a pooled row). */
export const hairLine = (t, x1, y1, x2, y2) =>
  `<line class="c-grid" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${t.color.hair}" stroke-width="${t.line.hair}"/>`;
/** A short tick under a horizontal axis at `x`, or left of a vertical one at `y` (0.3 of the small size). */
export const tick = (t, x, y, dir = 'down') => dir === 'down' ? axisLine(t, x, y, x, y + t.size.small * 0.3) : axisLine(t, x - t.size.small * 0.3, y, x, y);
/** The figure's one arrowhead, sized to `k` (0.8) of the label in user space so it never scales with the line; a cut interval takes a smaller one. */
export const arrowMarker = (t, id, k = 0.8) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${r1(t.size.label * k)}" markerHeight="${r1(t.size.label * k)}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="c-arrowhead" d="M 0 0 L 10 5 L 0 10 z" fill="${t.color.ink}"/></marker>`;

// ---- raster -----------------------------------------------------------------------------
const viewBoxOf = svg => (String(svg).match(/viewBox="([^"]+)"/)?.[1] || '').split(/[\s,]+/).map(Number);
/**
 * The pixel size and resolution of a figure's PNG. A house export (sized in
 * inches) is drawn at `widthIn × dpi` (600 dpi unless named); any other SVG at
 * three times its viewBox, which at 96 px to the inch is 288 dpi.
 */
export function rasterPlan(svg, { widthIn = null, dpi = null, scale = null } = {}) {
  const vb = viewBoxOf(svg), w = vb.length === 4 && vb[2] > 0 ? vb[2] : 600, h = vb.length === 4 && vb[3] > 0 ? vb[3] : 400;
  const inches = widthIn ?? (Number(String(svg).match(/^<svg[^>]*\swidth="([\d.]+)in"/)?.[1]) || null);
  if (inches && !scale) { const d = dpi || 600, px = Math.round(inches * d); return { width: px, height: Math.round(px * h / w), dpi: d }; }
  const k = scale || 3;
  return { width: Math.round(w * k), height: Math.round(h * k), dpi: dpi || Math.round(96 * k) };
}

/**
 * The one rasteriser: an SVG drawn on `background` at the planned size, as
 * `{ bytes, width, height }` (PNG with its resolution in pHYs, or JPEG). Null
 * where there is no document (node).
 */
export async function rasterSvg(svg, { background, type = 'image/png', quality = 0.92, ...plan } = {}) {
  if (typeof document === 'undefined') return null;
  const size = rasterPlan(svg, plan);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The figure could not be drawn')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = size.width; c.height = size.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(resolve => c.toBlob(resolve, type, quality));
    if (!blob) throw new Error('Image export failed');
    const raw = new Uint8Array(await blob.arrayBuffer());
    return { bytes: type === 'image/png' ? setPngDpi(raw, size.dpi) : raw, width: size.width, height: size.height };
  } finally { URL.revokeObjectURL(url); }
}

/** PNG bytes of an SVG (see rasterPlan), white unless `background` says otherwise; null under node. */
export async function svgToPng(svg, { background = null, ...plan } = {}) {
  const r = await rasterSvg(svg, { ...plan, background: background || pageOf(svg) });
  return r ? r.bytes : null;
}
// The page colour the figure itself declares (its c-bg), so a PNG is never darker than its SVG.
const pageOf = svg => String(svg).match(/<rect class="c-bg"[^>]*\sfill="([^"]+)"/)?.[1] || 'white';
