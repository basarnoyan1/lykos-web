// The picture a row of Tables and figures leads with (views/outputs.mjs): a pictogram of the item's type, not a crop of its drawing (owner,
// 2026-10-24: "previews should show the type of the figure like a symbolic risk of bias analysis or symbolic prisma"). A 56 by 40 box held
// a PRISMA too small to read, a traffic light as a speck of marks and a table as an icon; the type says more at that size. One style for
// all: a 56 × 40 grid, strokes of 1.25 in the quiet ink (--ink-2), fills in its lighter mixes, the risk-of-bias and effect-direction hues
// (--fig-good, --fig-unclear, --fig-bad) only where they carry their conventional meaning, and the evidence map's one-hue scale. The type is
// the item's (lib/paper-items.mjs TYPES, 'forest+swim' for a print of two panels: the two side by side) or a saved output's chart type;
// drawing one reads no file and lays nothing out. The real drawing is the item's page (views/item-detail.mjs). Styled by research-views.css
// (.tg). Pure.

const W = 56, H = 40;
const r1 = x => Math.round(x * 10) / 10;
const line = (x1, y1, x2, y2, cls = 'tg-i') => `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
const rect = (x, y, w, h, cls = 'tg-i', rx = 0) => `<rect class="${cls}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${rx ? ` rx="${rx}"` : ''}/>`;
const dot = (x, y, r, cls = 'tg-f') => `<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${r}"/>`;
const path = (d, cls = 'tg-i') => `<path class="${cls}" d="${d}"/>`;
const ROB = ['tg-good', 'tg-some', 'tg-bad'];

// each glyph draws inside 4..52 by 3..37 on the 56 × 40 grid
const GLYPHS = {
  // a flow diagram: three boxes down the middle joined by arrows, an exclusion box at the side
  flow: () => {
    const box = y => rect(10, y, 22, 7, 'tg-box', 1.5), down = (y1, y2) => `${line(21, y1, 21, y2)}${path(`M19 ${y2 - 2.5} L21 ${y2} L23 ${y2 - 2.5}`)}`;
    return `${box(3)}${box(16.5)}${box(30)}${down(10, 16.5)}${down(23.5, 30)}${line(21, 13.2, 37, 13.2)}${path('M34.5 11.2 L37 13.2 L34.5 15.2')}${rect(37, 9.7, 15, 7, 'tg-box', 1.5)}`;
  },
  // a traffic-light plot: a 4 × 3 grid of judgements
  'rob-traffic': () => {
    const at = [[0, 0, 1, 2], [0, 1, 0, 0], [2, 0, 1, 0]];
    return at.map((row, j) => row.map((v, i) => dot(13 + i * 10, 8 + j * 12, 3.6, ROB[v])).join('')).join('');
  },
  // a summary plot: three bars of shares, low, some concerns and high
  'rob-summary': () => [[0.6, 0.25], [0.4, 0.35], [0.75, 0.1]].map(([a, b], j) => {
    const y = 5 + j * 11, x = 6, w = 44, c = 1 - a - b;
    return `${rect(x, y, w * a, 8, 'tg-good')}${rect(x + w * a, y, w * b, 8, 'tg-some')}${rect(x + w * (a + b), y, w * c, 8, 'tg-bad')}`;
  }).join(''),
  // a forest plot: a line of no effect, three studies' intervals with their squares, the pooled diamond under them (none when not pooled)
  forest: ({ pooled = true } = {}) => {
    const rows = [[14, 34, 22], [20, 46, 31], [10, 30, 19]];
    return `${line(28, 3, 28, 37, 'tg-axis')}${rows.map(([a, b, m], j) => { const y = 7 + j * 8; return `${line(a, y, b, y)}${rect(m - 2.2, y - 2.2, 4.4, 4.4, 'tg-f')}`; }).join('')}${pooled ? path('M15 32 L22 29.5 L29 32 L22 34.5 Z', 'tg-f') : ''}`;
  },
  // synthesis without meta-analysis: an effect-direction grid of ▲ (benefit), – (no clear) and ▼ (harm)
  swim: () => {
    const at = [[1, 1, 0], [1, 0, -1], [0, 1, 1]], up = (x, y) => path(`M${x} ${y - 3.5} L${x + 4} ${y + 3} L${x - 4} ${y + 3} Z`, 'tg-good'), dn = (x, y) => path(`M${x} ${y + 3.5} L${x + 4} ${y - 3} L${x - 4} ${y - 3} Z`, 'tg-bad');
    return at.map((row, j) => row.map((v, i) => { const x = 14 + i * 14, y = 8 + j * 12; return v > 0 ? up(x, y) : v < 0 ? dn(x, y) : line(x - 4, y, x + 4, y); }).join('')).join('');
  },
  // an evidence map: a heat grid in shades of one hue
  'evidence-map': () => {
    const at = [[3, 1, 0, 2, 1], [1, 2, 3, 0, 1], [0, 1, 2, 3, 2]];
    return at.map((row, j) => row.map((v, i) => rect(5 + i * 9.4, 4 + j * 11, 8.4, 10, `tg-s${v}`, 1)).join('')).join('');
  },
  // Kaplan–Meier: two stepped curves over an axis
  km: () => `${path('M6 3 V35 H52', 'tg-axis')}${path('M6 6 H15 V11 H24 V15 H35 V18 H50', 'tg-i tg-thick')}${path('M6 6 H11 V15 H19 V23 H29 V28 H44', 'tg-i tg-thick tg-dim')}`,
  // a swimmer plot: a lane per patient, an event's dot or follow-up's arrow at its end, a mark along it
  swimmer: () => [[40, 1], [32, 0], [24, 1], [16, 0]].map(([len, ev], j) => {
    const y = 7 + j * 8.5, x = 8, end = x + len;
    return `${rect(x, y - 2, len, 4, 'tg-bar', 1)}${ev ? dot(end + 1, y, 2.6) : path(`M${end} ${y - 3} L${end + 4} ${y} L${end} ${y + 3} Z`, 'tg-f')}${j === 1 ? path(`M${x + 14} ${y - 3} L${x + 17} ${y} L${x + 14} ${y + 3} L${x + 11} ${y} Z`, 'tg-mk') : ''}`;
  }).join(''),
  // charts: each its glyph
  column: () => `${line(6, 35, 50, 35, 'tg-axis')}${[16, 26, 12, 21].map((h, i) => rect(10 + i * 10, 35 - h, 6, h, 'tg-bar')).join('')}`,
  bar: () => `${line(8, 4, 8, 36, 'tg-axis')}${[34, 22, 28, 14].map((w, i) => rect(8, 6 + i * 7.6, w, 5, 'tg-bar')).join('')}`,
  stacked: () => `${line(6, 35, 50, 35, 'tg-axis')}${[[12, 8], [18, 6], [9, 11], [14, 9]].map(([a, b], i) => `${rect(10 + i * 10, 35 - a, 6, a, 'tg-bar')}${rect(10 + i * 10, 35 - a - b, 6, b, 'tg-s1')}`).join('')}`,
  histogram: () => `${line(6, 35, 50, 35, 'tg-axis')}${[5, 12, 22, 27, 19, 10, 4].map((h, i) => rect(9 + i * 5.6, 35 - h, 5.6, h, 'tg-bar tg-edge')).join('')}`,
  pie: () => `${dot(28, 20, 15, 'tg-s1')}${path('M28 20 L28 5 A15 15 0 0 1 42.3 24.6 Z', 'tg-bar')}${path('M28 20 L42.3 24.6 A15 15 0 0 1 21 33.3 Z', 'tg-s2')}`,
  scatter: () => `${path('M6 3 V35 H52', 'tg-axis')}${[[12, 29], [17, 25], [21, 27], [26, 19], [31, 20], [36, 14], [41, 15], [46, 9]].map(([x, y]) => dot(x, y, 1.9)).join('')}${line(10, 31, 49, 8, 'tg-i tg-dim')}`,
  dot: () => [[18, 40], [26, 34], [14, 30], [30, 46]].map(([a, b], j) => { const y = 7 + j * 8.5; return `${line(6, y, 50, y, 'tg-axis')}${dot(a, y, 2.4)}${dot(b, y, 2.4, 'tg-s2')}`; }).join(''),
  timeline: () => `${line(6, 20, 50, 20)}${[10, 19, 31, 38, 47].map((x, i) => `${dot(x, 20, 2.6)}${line(x, i % 2 ? 23 : 17, x, i % 2 ? 29 : 11, 'tg-axis')}`).join('')}`,
  heat: () => GLYPHS['evidence-map'](),
  // a table: a ruled grid with its header row (a characteristics, search strategy or evidence table alike)
  table: () => `${rect(5, 4, 46, 7, 'tg-head', 1)}${[11, 19, 27, 35].map(y => line(5, y, 51, y, 'tg-rule')).join('')}${[20, 36].map(x => line(x, 4, x, 35, 'tg-rule')).join('')}${line(5, 4, 51, 4, 'tg-rule')}`,
  // a document: a page with its lines
  document: () => `${path('M14 3 H35 L42 10 V37 H14 Z', 'tg-box')}${path('M35 3 V10 H42', 'tg-i')}${[15, 20, 25, 30].map((y, i) => line(19, y, i === 3 ? 30 : 37, y, 'tg-rule')).join('')}`,
  // a figure the app cannot name: a frame with a line through it
  figure: () => `${rect(6, 4, 44, 32, 'tg-box', 2)}${path('M11 30 L21 19 L28 25 L37 13 L45 21', 'tg-i')}`,
};
// what each type of lib/paper-items.mjs draws as
const ALIAS = { 'rob-plots': ['rob-summary', 'rob-traffic'], chart: 'column', 'rob-table': 'table', evidence: 'table', characteristics: 'table', searches: 'table',
  'search-summary': 'table', sof: 'table', profile: 'table', cases: 'table', forest: 'forest', dataset: 'figure', survival: 'km', prisma: 'flow' };
const partsOf = key => { const a = ALIAS[key] ?? key; return Array.isArray(a) ? a : [a]; };

/** The glyphs a type draws: one per part ('forest+swim' two; risk-of-bias plots, the summary and the traffic light). */
export const glyphParts = type => String(type || 'figure').split('+').filter(Boolean).flatMap(partsOf).map(k => (GLYPHS[k] ? k : 'figure'));

/**
 * The pictogram of `type` as an <svg> (56 × 40, aria-hidden): one glyph, or two side by side for a figure of two panels. `pooled` false
 * draws a forest plot without its diamond.
 */
export function typeGlyph(type, { pooled = true } = {}) {
  const parts = glyphParts(type).slice(0, 2), one = k => GLYPHS[k]({ pooled });
  const body = parts.length < 2 ? one(parts[0])
    : parts.map((k, i) => `<svg x="${i * W / 2}" y="${H / 4}" width="${W / 2}" height="${H / 2}" viewBox="0 0 ${W} ${H}">${one(k)}</svg>`).join('');
  return `<svg class="tg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false" data-tg="${parts.join('+')}">${body}</svg>`;
}

/** The type of a row of Tables and figures: a paper item's own, a saved output's chart type, a table's rows, else its kind. */
export function rowType(it) {
  if (it?.type) return it.type;
  const d = it?.drawn || {}, spec = d.spec;
  if (spec) return spec.kind === 'chart' ? (GLYPHS[spec.chart?.type] ? spec.chart.type : 'chart') : 'table';
  if (d.rows) return 'table';
  if (d.draw === 'rob') return 'rob-plots';
  if (d.draw === 'prisma') return 'flow';
  if (d.draw === 'survival') return 'km';
  return it?.kind === 'table' ? 'table' : it?.kind === 'document' ? 'document' : 'figure';
}

/** The types a glyph exists for, for the library page and the tests. */
export const GLYPH_KEYS = Object.freeze(Object.keys(GLYPHS));
