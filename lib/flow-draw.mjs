// Flow diagrams in the house style (FIGURE-STYLE §2): a box with a heading and
// wrapped lines, a phase band, an arm's title strip and an arrow, drawn from
// the token set (figureTokens) and classed for the screen theme (c-box, c-band,
// c-arrow). Monochrome by default: ink boxes, no radius, one arrowhead marker in user
// space; a profile can round the bands and titles (line.radius) and give the titles their own fill (color.title, PRISMA 2020's yellow).
// The PRISMA diagrams lay their boxes out and draw them through these.
import { r1, text, esc, arrowMarker, wrapText } from './figure-draw.mjs';

const rx = t => (t.line.radius ? ` rx="${r1(t.line.radius)}" ry="${r1(t.line.radius)}"` : '');

/**
 * The geometry of a flow in the token's unit, from the legacy pixel layout drawn at 11 px: every width and gap
 * scales with the label size, so the house export at 8 pt keeps the proportions of the diagram people know.
 */
export function flowGeometry(t, px) {
  const k = t.size.label / 11, out = {};
  for (const [key, v] of Object.entries(px)) out[key] = typeof v === 'number' ? v * k : v;
  return { ...out, FS: t.size.label, LH: t.size.label * 1.3 };
}

/** A box's lines: the heading (heading weight) then the body, each wrapped to the box's inner width. */
export function flowLines(t, width, padX, heading, lines) {
  const inner = width - 2 * padX, all = [];
  if (heading) all.push(...wrapText(t, heading, inner).map(s => ({ t: s, bold: true })));
  for (const l of lines) all.push(...wrapText(t, l, inner).map(s => ({ t: s, bold: false })));
  return all;
}

/** A box: its rectangle in ink and its centred lines. */
export function flowBox(t, b, { padY, lh }) {
  const cx = b.x + b.width / 2;
  const rect = `<rect class="c-box" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" fill="${t.color.page}" stroke="${t.color.ink}" stroke-width="${t.line.box}"/>`;
  return rect + b.lines.map((l, i) => text(t, cx, b.y + padY + t.size.label + i * lh, l.t, { anchor: 'middle', role: l.bold ? 'head' : 'label', cls: l.bold ? 'c-ink c-head' : 'c-ink' })).join('');
}

/** A phase band: a light fill with its name in ink, read bottom to top as the PRISMA statement prints it. */
export function flowBand(t, x, y, w, h, label) {
  const cx = x + w / 2, cy = y + h / 2;
  return `<g role="group" aria-label="${esc(label)} phase"><rect class="c-band" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${rx(t)} fill="${t.color.band}"/>` +
    text(t, cx, cy + t.size.label * 0.35, label, { anchor: 'middle', role: 'head', cls: 'c-ink c-head', attrs: `transform="rotate(-90 ${r1(cx)} ${r1(cy)})"` }) + '</g>';
}

/** An arm's title strip over its columns: the band fill and the title in heading weight. */
export const flowTitle = (t, x, y, w, h, label) =>
  `<g><rect class="c-band c-title" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${rx(t)} fill="${t.color.title || t.color.band}"${t.line.radius ? ` stroke="${t.color.ink}" stroke-width="${t.line.box}"` : ''}/>${text(t, x + w / 2, y + h / 2 + t.size.label * 0.35, label, { anchor: 'middle', role: 'head', cls: 'c-ink c-head' })}</g>`;

/** A straight arrow or an elbow path (`d`), ending in the figure's arrowhead `id`. */
export const flowArrow = (t, id, x1, y1, x2, y2) =>
  `<line class="c-arrow" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${t.color.ink}" stroke-width="${t.line.arrow}" marker-end="url(#${id})"/>`;
export const flowPath = (t, id, d) =>
  `<path class="c-arrow" d="${d}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.arrow}" marker-end="url(#${id})"/>`;
export const flowMarker = (t, id) => arrowMarker(t, id, 0.7);
