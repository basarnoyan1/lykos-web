// Figure style presets: data only (figure feature, plan §4.15c.2).
// lib/figure-style.mjs validates, hashes and reads these; nothing here runs.
//
// A preset is a Profile as stored in .lykos/figure-style.json. Values are the
// ones plan §4.15c.2 records, with their source: `lykos-neutral` is the constants
// at the top of lib/output-charts.mjs today (FONT, FS, ROW, PAD, INK, AXIS,
// GRID, BAR), `prisma-2020` is the palette of lib/prisma-flow.mjs, `asd-house`
// is section 3.3, `asd-revman` is RevMan Web's export layout (lib/revman-forest.mjs).
// The ids `asd-house` and `asd-revman` are historical and kept because saved projects name them; the
// labels shown are "House style" and "RevMan forest".
//
// No font file is bundled or referenced from here. `metrics.widths` is null
// where no table has been measured: layout then uses the Helvetica table
// times `metrics.scale`.

const ASD_INK = '#141413';

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

export const PRESETS = deepFreeze({
  'lykos-neutral': {
    id: 'lykos-neutral', label: 'Lykos neutral', version: 1, basedOn: 'preset:lykos-neutral@1', render: true,
    source: [],
    // Today's chart constants. Marks and line weights are not named constants
    // in output-charts.mjs (strokes use the SVG default of 1), so they are null
    // or 1 here and a renderer keeps drawing what it draws until it adopts a token.
    colors: { ink: '#000', ink2: '#555', rule: '#555', hair: '#e3e3e3', bar: '#8f8f8f', page: '#ffffff' },
    ramps: {}, presence: {}, encodings: {},
    fonts: { stack: 'Helvetica, Arial, sans-serif', family: null, weights: {}, roles: {} },
    size: { unit: 'px', base: 12, header: 12, groupHead: 12, rowLabel: 12, study: 12, value: 12, secondary: 12, tick: 12,
      sideLabel: 12, note: 12, panelLetter: 12, panelTitle: 12, caption: 12, min: 4.5 },
    line: { header: 1, ci: 1, ciProportion: 1, zero: 1, axis: 1, hair: 1 },
    mark: { dot: null, squareBase: null, squareScale: null, diamondRow: null },
    geometry: { width: 640, widthIn: null, dpi: null, pad: 12, rowIn: null, row: 22 },
    wording: {}, caption: {}, rules: { gridlines: true },
    export: {}, metrics: { widths: null, scale: 1 },
  },
  // The Lykos house style (FIGURE-STYLE §2): one style in two media. The export
  // values are printed sizes in pt on journal columns (single 85 mm, double
  // 175 mm) at 600 dpi; `screen` holds the same geometry in px for the app,
  // whose colours come from the theme (--fig-* in research-views.css), so the
  // colours here are the paper's. Hue only for risk of bias (robvis's, lib/rob-palette.mjs).
  'lykos-house': {
    id: 'lykos-house', label: 'Lykos house style', version: 1, basedOn: 'preset:lykos-house@1', render: true,
    source: [],
    colors: { ink: '#1a1a1a', ink2: '#5c5c5c', rule: '#8a8a8a', axis: '#8a8a8a', hair: '#d6d6d6', bar: '#7a7a7a', mark: '#7a7a7a',
      fill: '#e6e6e6', band: '#efefef', page: '#ffffff', good: '#02c100', unclear: '#e2df07', bad: '#bf0000', onMark: '#ffffff',
      critical: '#820000', lowx: '#a6e08f', ninfo: '#8c8c8c' },
    ramps: {
      // L* 15/38/58/77/91/100: told apart by lightness, the same under every dichromacy; the last is white with an ink outline.
      categorical: ['#262626', '#595959', '#8c8c8c', '#bfbfbf', '#e6e6e6', '#ffffff'],
      sequential: ['#f2f2f2', '#c9c9c9', '#9a9a9a', '#5f5f5f', '#1a1a1a'],
      rob: ['#02c100', '#e2df07', '#bf0000'],
    },
    presence: {}, encodings: {},
    fonts: { stack: 'Helvetica, Arial, sans-serif', family: null, weights: {}, roles: { heading: 600, label: 400, number: 400 } },
    // Two steps: label 8 pt, small 7 pt (ticks, weights, the source block). Nothing under 7 pt in print.
    size: { unit: 'pt', base: 8, header: 8, groupHead: 8, rowLabel: 8, study: 8, value: 8, secondary: 7, tick: 7,
      sideLabel: 7, note: 7, panelLetter: 8, panelTitle: 8, caption: 7, min: 7 },
    line: { header: 0.4, ci: 0.75, ciProportion: 0.75, zero: 0.6, axis: 0.5, hair: 0.4, box: 0.6, arrow: 0.6 },
    mark: { dot: 2.2, squareBase: 2.4, squareScale: 4.8, diamondRow: 0.55, bar: 0.6 },
    geometry: { width: null, widthIn: { single: 3.35, double: 6.89, portrait: 6.89, landscape: 9.7 }, dpi: 600, pad: 4, rowIn: null, row: 13 },
    wording: {}, caption: {}, rules: { gridlines: false, ellipsis: false, titleInFigure: false, legend: 'below-left' },
    export: { png: { dpi: 600, phys: true, background: '#ffffff' } },
    metrics: { widths: null, scale: 1 },
    // The same figure on screen: px, every text the app's small size, row 22. The app's
    // font is measured against the Helvetica table (figure-draw.mjs SCREEN_SCALE).
    // Geist measured 0.95–1.06 (400) and 1.00–1.12 (600) times the Helvetica table over twenty figure
    // strings at 12 px (canvas measureText, 2026-10-21); 1.12 is the largest ratio measured (IBM Plex Sans, used before, 1.08).
    screen: { unit: 'px', size: { label: 12, small: 12 }, row: 22, pad: 0, width: { single: 560, double: 760 }, metrics: { widths: null, scale: 1.12 },
      line: { header: 1, ci: 1.25, ciProportion: 1.25, zero: 1, axis: 1, hair: 1, box: 1, arrow: 1 },
      mark: { dot: 3.5, squareBase: 4, squareScale: 8, diamondRow: 0.55, bar: 0.6 } },
  },
  'asd-house': {
    id: 'asd-house', label: 'House style', version: 1, basedOn: 'preset:asd-house@1', render: true,
    source: [],
    colors: { ink: ASD_INK, ink2: '#6b6a64', rule: '#b0aea5', hair: '#d9d6cc', light: '#e8e6dc', page: '#ffffff', accent: '#d97757', captionText: '#3D3D3A' },
    ramps: {
      blue: ['#eef3f9', '#c6d8ec', '#8db2da', '#4f86bd', '#2f5f8f', '#1d3d5e'],
      clay: ['#fbf1ec', '#f3d3c4', '#e8a88c', '#d97757', '#b3553a', '#7a3422'],
      grey: ['#f4f3ee', '#e8e6dc', '#cfccc0', '#b0aea5', '#8a877d', '#5e5c55'],
      // clay[3], clay[1], grey[0], blue[1], blue[4]: positive is blue, only where zero means change.
      diverging: ['#d97757', '#f3d3c4', '#f4f3ee', '#c6d8ec', '#2f5f8f'],
    },
    presence: { all: '#2f5f8f', some: '#8db2da', none: '#e8e6dc' },
    encodings: { nrCell: { fill: '#ffffff', hatch: '//////', edgePt: 0.3, padIn: 0.04 }, diverging: { clampPct: [-50, 100], positive: 'blue' } },
    fonts: {
      stack: 'Poppins, "Helvetica Neue", Helvetica, Arial, sans-serif', family: 'Poppins',
      weights: { 400: 400, 500: 500, 600: 500, 700: 700 },
      roles: { heading: 600, label: 400, number: 400, strong: 700 },
    },
    size: { unit: 'pt', base: 6.5, header: 5.8, groupHead: 6, rowLabel: 5.4, study: 5.8, value: 5.2, secondary: 5, tick: 4.6,
      sideLabel: 4.8, note: 5.3, panelLetter: 8.5, panelTitle: 6.3, caption: 7.5, armHeatHead: 6.4, min: 4.5 },
    line: { header: 0.6, ci: 0.7, ciProportion: 0.8, zero: 0.5, axis: 0.4, hair: 0.4, hairMax: 0.5, arrowMarker: 2 },
    mark: { dot: 2.6, squareBase: 1.6, squareScale: 3.2, diamondRow: 0.36 },
    // 0.04 in is the NR cell pad, the only pad plan §4.15c.2 names; widths are a
    // contract (the A4 text block is 6.69 / 10.69 in), not derived.
    geometry: { width: null, widthIn: { portrait: 6.3, landscape: 9.7 }, dpi: 300, pad: 2.88,
      rowIn: { forest: 0.165, 'forest-table': 0.165, heat: 0.155, proportions: 0.36, device: 0.34 },
      axes: { rr: { log: true, min: 0.01, max: 100, ticks: [0.01, 0.1, 1, 10, 100] }, proportions: { min: 0, max: 40, unit: '%' } } },
    wording: {
      direction: 'intervention minus control', sideLeft: 'Fewer events with the intervention', sideRight: 'More events with the intervention',
      notReported: 'NR', notApplicable: 'NA', control: 'Control: ', notEstimable: 'Not estimable (no events)', decimals: { rr: 2, percent: 1, p: 3 }, dash: '–',
    },
    caption: {
      supplement: 'Figure S{n}: ', report: 'Figure {n}: ', manuscript: 'Figure {n}. ',
      abbreviations: { supplement: {}, manuscript: {} },
    },
    rules: { titleInFigure: false, legend: 'below-left', accentMax: 1, gridlines: false },
    export: { png: { dpi: 300, phys: true, physPxPerM: 11811, background: '#ffffff' }, svgFor: ['drawing', 'prisma'], pdf: false },
    // Poppins Regular measured 1.048-1.139 times the Helvetica table over eight
    // house strings (plan §4.15c.2); 1.14 is the largest ratio measured. No Poppins
    // table is shipped, so layout is the Helvetica table times this scale.
    metrics: { widths: null, scale: 1.14 },
  },
  'prisma-2020': {
    id: 'prisma-2020', label: 'PRISMA 2020', version: 1, basedOn: 'preset:prisma-2020@1', render: true,
    source: [],
    // lib/prisma-flow.mjs PALETTE (phase, main, aside, plain, ink), Helvetica as today.
    colors: { ink: '#000000', ink2: '#555', rule: '#555', hair: '#e3e3e3', page: '#ffffff', phase: '#bcd2ee', main: '#ffc125', aside: '#dcdcdc', plain: '#ffffff',
      band: '#bcd2ee', title: '#ffc125' },   // what the drawing reads: the statement's blue phase bands and yellow titles
    ramps: {}, presence: {}, encodings: {},
    fonts: { stack: 'Helvetica, Arial, sans-serif', family: null, weights: {}, roles: {} },
    size: { unit: 'px', base: 12, header: 12, groupHead: 12, rowLabel: 12, study: 12, value: 12, secondary: 12, tick: 12,
      sideLabel: 12, note: 12, panelLetter: 12, panelTitle: 12, caption: 12, min: 4.5 },
    line: { header: 1, ci: 1, ciProportion: 1, zero: 1, axis: 1, hair: 1, radius: 6 },
    mark: { dot: null, squareBase: null, squareScale: null, diamondRow: null },
    geometry: { width: null, widthIn: { portrait: 9.7, landscape: 9.7 }, dpi: 300, pad: 12, rowIn: null, row: 22 },
    wording: {}, caption: {}, rules: { gridlines: false },
    export: { png: { dpi: 300, phys: true }, svgFor: ['prisma'] },
    metrics: { widths: null, scale: 1 },
  },
  // RevMan Web's forest plot, as its SVG export draws it (measured from the review's exports of 14 October 2026; Batch 13 item 2):
  // Arial 14 px, black rules 1 px, blue squares rgb(0, 0, 204) of side 2 + 16 × weight, a black diamond 18 px high, rows 20 px
  // apart, the plot 210 px wide. lib/revman-forest.mjs draws it over the app's own statistics when a forest's style is this profile
  // (lib/forest-page.mjs mountForest); text is measured with Arial's own metrics (lib/revman-metrics.mjs), not the Helvetica table.
  'asd-revman': {
    id: 'asd-revman', label: 'RevMan forest', version: 2, basedOn: 'preset:asd-revman@2', render: true,
    source: [],
    colors: { ink: '#000000', ink2: '#000000', rule: '#000000', hair: '#000000', page: '#ffffff', squareRr: '#0000cc', squareProportion: '#0000cc', squareMeanDifference: '#0000cc' },
    ramps: {}, presence: {}, encodings: {},
    fonts: { stack: 'Arial, "Liberation Sans", Helvetica, sans-serif', family: 'Arial', weights: {}, roles: { heading: 700, label: 400, number: 400 } },
    size: { unit: 'px', base: 14, header: 14, groupHead: 14, rowLabel: 14, study: 14, value: 14, secondary: 14, tick: 14,
      sideLabel: 14, note: 14, panelLetter: 14, panelTitle: 14, caption: 14, min: 9 },
    line: { header: 1, ci: 1, ciProportion: 1, zero: 1, axis: 1, hair: 1 },
    mark: { dot: null, squareBase: 2, squareScale: 16, diamondRow: 0.9 },
    geometry: { width: null, widthIn: { portrait: 12.8, landscape: 12.8 }, dpi: null, pad: 10, rowIn: null, row: 20, plot: 210 },
    wording: {}, caption: {}, rules: { footnoteBlock: true, layout: 'revman' },
    export: { svgFor: ['forest'] }, metrics: { widths: null, scale: 1 },   // lib/revman-forest.mjs measures with Arial's own table, not these
  },
}); // frozen: a profile in a project is a copy (structuredClone), never this object

/** Default assign map (plan §4.15c.2): every chart role but prisma to asd-house. */
export const DEFAULT_ASSIGN = deepFreeze({
  forest: 'asd-house', 'forest-table': 'asd-house', heat: 'asd-house', bar: 'asd-house', column: 'asd-house',
  dot: 'asd-house', stacked: 'asd-house', timeline: 'asd-house', prisma: 'prisma-2020',
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));
/** The profile a project draws with when its style names none: the house style. */
export const DEFAULT_ACTIVE = 'lykos-house';
/**
 * The constants the renderers draw with when they are given no style at all
 * (`style == null`): today's figures, byte for byte (figure-golden.test.mjs).
 * `tokensFor(null)` reads this profile, and an unknown id falls back to it.
 */
export const NEUTRAL = 'lykos-neutral';
