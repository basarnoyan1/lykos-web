// How a journal draws a figure, for the study-selection flow diagram (lib/journal-flow.mjs), its PowerPoint file (lib/flow-pptx.mjs) and
// Manuscript › View › Journal (views/journal-preview.mjs). A journal style may declare `figure` (lib/addons.mjs journalStyles; the journals
// addon declares it for The Lancet journals, measured from their printed trial profiles and study-selection figures):
//   face        'sans' | 'serif'       which of the style's own faces a figure is set in (its `vars`), so a figure names no face the style does not ship
//   size, lead  6.5, 7.8               the type and its line pitch, in points
//   ink, line   '#000000', 0.5         the colour of text, outlines and arrows, and the weight of a line
//   digit       0.497                  the width of a figure of the face in em, so counts align whatever stands in for the face
//   thousands   { from, mark }         counts of `from` or more are grouped in threes with `mark` (10 000 with a thin space; 9999 as it is)
//   continues   { next, previous }     the words of a figure carried over a page ('({figure} continues on next page)', '(Continued from previous page)');
//                                      a style that declares them has a row chart deeper than its page go on in parts at the declared type size
//                                      and row pitch (lib/journal-charts.mjs journalForestParts), never set smaller to fit
//   flow        { box: { main, side, padX, padY }, gap: { row, side, branch, column, edge }, arrow: { head: [width, length] } }
//               a flow diagram: plain outlined boxes with the count first and the text flush left, no phase bands and no title strips;
//               the widths of a box in the main column and of one beside it, its paddings; the gaps between rows, around a side box,
//               from the line to a side box, between arms and at the edge; the filled arrowhead. All in points.
//   chart       { widths: { column, page }, inset, letter, series: [hex …], axis: { tick, label, title }, forest, scatter, funnel, rob }
//               a chart (lib/journal-charts.mjs): the widths of the journal's figure panels and the drawing's inset in them; the size of a
//               panel letter; the series colours in the journal's order; an axis's tick length, the gap to its labels and to its title;
//               forest { row, square: { fill, max, mark }, diamond, arrow: [length, height] }: the row pitch, the tinted square whose area
//               follows the weight (`max` the side of the heaviest) with a mark of the ink at its centre, the height of a total's open
//               diamond, the arrowhead of a cut interval; scatter { point: { color, line, min, max }, fit: { color, band, dash }, ref: dash }:
//               open circles (radius `min` to `max` by the root of the weight), the fitted line with its interval as a band of the
//               colour `band`, or as two dashed lines when it declares none, the dashed reference line; funnel { point: { color, fill,
//               size } } (its pseudo-interval drawn as the fit's interval is); rob { good, unclear, bad, mark, row, column, key: [w, h],
//               bar: { height, pitch, good, unclear, bad } }: the three inks of a judgement, a circle's diameter in a ruled grid of
//               `row` by `column`, and the summary's tinted bars with their key swatches. All measures in points.
// Nothing here names a journal. A style that declares no `figure` has its figures drawn as before. Pure: no document.
import { figureTokens } from './figure-style.mjs';
import { PRESETS, DEFAULT_ACTIVE } from './figure-presets.mjs';

const HEX = /^#[0-9a-f]{6}$/i, num = (v, d, lo = 0, hi = 1000) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const pair = (v, d, hi = 100) => (Array.isArray(v) && v.length === 2 ? [num(v[0], d[0], 0.1, hi), num(v[1], d[1], 0.1, hi)] : d);
/** A chart declaration with its defaults: a colour it leaves out is the ink or the first series colour, a risk-of-bias ink it leaves out null (the house's own). */
function chartRules(c, ink) {
  if (!c || typeof c !== 'object') return null;
  const series = (Array.isArray(c.series) ? c.series : []).filter(x => typeof x === 'string' && HEX.test(x)).map(x => x.toLowerCase()).slice(0, 12), one = series[0] || ink;
  const f = c.forest || {}, sc = c.scatter || {}, fu = c.funnel || {}, rb = c.rob || {}, bar = rb.bar || {};
  return { widths: { column: num(c.widths?.column, 304.5, 72, 1500), page: num(c.widths?.page, 529.8, 72, 1500) }, inset: num(c.inset, 6, 0, 40), letter: num(c.letter, 8.5, 4.5, 24),
    series: series.length ? series : [ink], axis: { tick: num(c.axis?.tick, 3.2, 0, 20), label: num(c.axis?.label, 1.3, 0, 20), title: num(c.axis?.title, 3.4, 0, 40) },
    forest: { row: num(f.row, 9.3, 4.5, 60), square: { fill: hex(f.square?.fill, one), max: num(f.square?.max, 12, 1, 60), mark: num(f.square?.mark, 4.2, 0.5, 20) }, diamond: num(f.diamond, 7.5, 1, 40), arrow: pair(f.arrow, [4.3, 5], 40) },
    scatter: { point: { color: hex(sc.point?.color, one), line: num(sc.point?.line, 0.75, 0.1, 4), min: num(sc.point?.min, 1.4, 0.2, 20), max: num(sc.point?.max, 11.5, 1, 60) },
      fit: { color: hex(sc.fit?.color, ink), band: hex(sc.fit?.band, null), dash: pair(sc.fit?.dash, [4.4, 2.2]) }, ref: pair(sc.ref, [1.4, 1.4]) },
    funnel: { point: { color: hex(fu.point?.color, one), fill: hex(fu.point?.fill, null), size: num(fu.point?.size, 3.9, 0.5, 20) } },
    rob: { good: hex(rb.good, null), unclear: hex(rb.unclear, null), bad: hex(rb.bad, null), mark: num(rb.mark, 9, 2, 40), row: num(rb.row, 15.1, 6, 60), column: num(rb.column, 22.4, 6, 120), key: pair(rb.key, [6.9, 4.3], 40),
      bar: { height: num(bar.height, 11.3, 2, 60), pitch: num(bar.pitch, 15.8, 4, 80), good: hex(bar.good, null), unclear: hex(bar.unclear, null), bad: hex(bar.bad, null) } } };
}
/** The style's figure declaration with its defaults; null when the style declares none. */
export function figureRules(style) {
  const f = style?.figure;
  if (!f || typeof f !== 'object') return null;
  const size = num(f.size, 7, 4.5, 24), fl = f.flow && typeof f.flow === 'object' ? f.flow : null, head = Array.isArray(fl?.arrow?.head) ? fl.arrow.head : [];
  const th = f.thousands && typeof f.thousands === 'object' ? { from: num(f.thousands.from, 10000, 1000, 1e9), mark: typeof f.thousands.mark === 'string' && f.thousands.mark.length === 1 ? f.thousands.mark : ' ' } : null;
  const words = v => (typeof v === 'string' && v.trim() && v.length <= 120 ? v.trim() : null), co = f.continues && typeof f.continues === 'object' ? { next: words(f.continues.next), previous: words(f.continues.previous) } : null;
  return {
    id: `journal-${String(style.family || style.id || 'style').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'style'}`,
    font: String(style.vars?.[f.face === 'serif' ? 'serif' : 'sans'] || 'Helvetica, Arial, sans-serif'),
    size, lead: num(f.lead, size * 1.2, size, size * 3), ink: HEX.test(f.ink || '') ? f.ink.toLowerCase() : '#000000', line: num(f.line, 0.5, 0.1, 4), digit: num(f.digit, 0, 0.2, 1), thousands: th,
    continues: co?.next && co.previous ? co : null,
    flow: fl && { box: { main: num(fl.box?.main, 125, 40), side: num(fl.box?.side, 155, 40), padX: num(fl.box?.padX, 5, 0, 40), padY: num(fl.box?.padY, 3.65, 0, 40) },
      gap: { row: num(fl.gap?.row, 12, 4, 200), side: num(fl.gap?.side, 4.5, 0, 100), branch: num(fl.gap?.branch, 12, 4, 200), column: num(fl.gap?.column, 12, 0, 200), edge: num(fl.gap?.edge, 6, 0, 100) },
      arrow: { head: [num(head[0], 5, 1, 40), num(head[1], 4.3, 1, 40)] } },
    chart: chartRules(f.chart, HEX.test(f.ink || '') ? f.ink.toLowerCase() : '#000000'),
  };
}

const first = stack => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
/**
 * The token set a figure is drawn with for the style (figureTokens of a profile made from the house one: the style's face, one size, its ink,
 * its line weight, no heavier heading), or null when the style declares no figure. Text is measured with the house table (Helvetica's
 * widths, which the stand-in faces do not exceed), the figures with the declared width: a count ends where it is placed in either face.
 */
export function journalFigureTokens(style) {
  const r = figureRules(style);
  if (!r) return null;
  const base = PRESETS[DEFAULT_ACTIVE], widths = r.digit ? Object.fromEntries([...'0123456789'].map(d => [d, r.digit])) : null;
  const size = Object.fromEntries(Object.entries(base.size).map(([k, v]) => [k, typeof v === 'number' ? r.size : v]));
  const profile = { ...base, id: r.id, label: style.label || r.id, basedOn: `preset:${base.id}@${base.version ?? 1}`, screen: undefined,
    colors: { ...base.colors, ink: r.ink, ink2: r.ink, rule: r.ink, axis: r.ink, page: '#ffffff' },
    fonts: { ...base.fonts, stack: r.font, family: first(r.font), roles: { heading: 400, label: 400, number: 400 } },
    size, line: { ...base.line, box: r.line, arrow: r.line, axis: r.line, header: Math.min(r.line, base.line.header) },
    metrics: { widths: widths && { ...widths, ' ': 0.2 }, scale: 1 } };
  return figureTokens({ profiles: [profile], active: profile.id }, { medium: 'export' });
}

/** What a flow diagram is drawn with for the style: { style (the tokens), look (the declaration's flow, its type and its counts) }, or null. */
export function flowLook(style) {
  const r = figureRules(style);
  return r?.flow ? { style: journalFigureTokens(style), look: { ...r.flow, lead: r.lead, thousands: r.thousands, face: first(r.font) } } : null;
}

/** The smallest type a chart fitted to a page box is set in, in points: under it only the rows close up. (A row chart of a style that declares
 *  `continues` is not fitted so: it keeps the declared size and pitch and goes on in parts, lib/journal-charts.mjs journalForestParts.) */
const CHART_MIN = 5;
/**
 * The token set a chart is drawn with for the style, or null when the style declares no chart: the flow's tokens with the heads in bold,
 * the declaration's series colours, square tint and risk-of-bias inks, its row pitch and its panel widths. `widthIn` is the width of a
 * chart fitted to a page box and `k` its scale (rows and type; type no smaller than CHART_MIN), as lib/output-render.mjs fittedTokens.
 */
export function journalChartTokens(style, { widthIn = null, k = 1 } = {}) {
  const r = figureRules(style), c = r?.chart;
  if (!c) return null;
  const base = PRESETS[DEFAULT_ACTIVE], widths = r.digit ? Object.fromEntries([...'0123456789'].map(d => [d, r.digit])) : null;
  const floor = Math.min(r.size, CHART_MIN), sz = Math.max(floor, Math.round(r.size * k * 100) / 100);
  const size = Object.fromEntries(Object.entries(base.size).map(([key, v]) => [key, key === 'min' ? floor : typeof v === 'number' ? sz : v]));
  const row = Math.max(Math.round(sz * 1.15 * 100) / 100, Math.round(c.forest.row * k * 100) / 100), rob = [c.rob.good, c.rob.unclear, c.rob.bad];
  const wi = { single: Math.min(widthIn ?? Infinity, c.widths.column / 72), double: widthIn ?? c.widths.page / 72, portrait: widthIn ?? c.widths.page / 72, landscape: base.geometry?.widthIn?.landscape ?? c.widths.page / 72 };
  const profile = { ...base, id: r.id, label: style.label || r.id, basedOn: `preset:${base.id}@${base.version ?? 1}`, screen: undefined,
    colors: { ...base.colors, ink: r.ink, ink2: r.ink, rule: r.ink, axis: r.ink, hair: r.ink, mark: c.series[0], bar: c.series[0], fill: c.forest.square.fill, page: '#ffffff',
      ...(rob.every(Boolean) ? { good: rob[0], unclear: rob[1], bad: rob[2] } : {}) },
    ramps: { ...base.ramps, categorical: c.series, ...(rob.every(Boolean) ? { rob } : {}) },
    fonts: { ...base.fonts, stack: r.font, family: first(r.font), roles: { heading: 700, label: 400, number: 400 } },
    size, line: { ...base.line, header: r.line, ci: r.line, ciProportion: r.line, zero: r.line, axis: r.line, hair: r.line, box: r.line, arrow: r.line },
    geometry: { ...base.geometry, widthIn: wi, pad: c.inset, row, rowPad: 0.1 }, metrics: { widths: widths && { ...widths, ' ': 0.2 }, scale: 1 } };
  return figureTokens({ profiles: [profile], active: profile.id }, { medium: 'export' });
}

/**
 * What a chart is drawn with for the style besides its tokens: the chart declaration with its defaults, the line pitch as a multiple of
 * the type, the weight of a line, the mark the style sets a decimal point with (its `decimalMark`) and its grouping of large counts; null
 * when the style declares no chart. `continues` is the figure declaration's words for a chart carried over a page (null when it declares none).
 * lib/journal-charts.mjs draws from it.
 */
export function chartLook(style) {
  const r = figureRules(style);
  return r?.chart ? { ...r.chart, id: r.id, size: r.size, lead: r.lead / r.size, line: r.line, thousands: r.thousands, continues: r.continues,
    decimalMark: typeof style.decimalMark === 'string' && [...style.decimalMark].length === 1 && !/[\d<>&"']/.test(style.decimalMark) ? style.decimalMark : null } : null;
}

/**
 * Whether a figure's SVG file was drawn for the style (its root says the style's figure tokens drew it). The journal preview sets such a
 * file into the page itself, where the style's own face is loaded: a picture that stands alone sees no font of the page.
 */
export function drawnForStyle(svg, style) {
  const r = figureRules(style);
  return !!r && new RegExp(`^\\s*<svg[^>]*\\sdata-style="${r.id}"`).test(String(svg ?? ''));
}
