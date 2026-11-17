// The figure rules of FIGURE-STYLE §5 (F1 to F8) as pure functions of a drawn SVG, shared by the build's figure lint (app/lint-figures.mjs, over
// every figure module's fixture) and the Submission page's quality of a figure the paper holds (lib/file-quality.mjs). No file access.
export const RULE_WORDS = Object.freeze({ F1: 'Labels shown whole', F2: 'Colors of the figure style', F3: 'Text sizes of the figure style', F4: 'One font', F5: 'Weights of the figure style',
  F6: 'Text inside the figure', F7: 'Title and description for screen readers', F8: 'Unique ids' });

const NAMED = /^(?:none|currentcolor|transparent|url\(#[\w-]+\))$/i;
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** The colors a token set may draw with, both media. */
export function paletteOf(tokens) {
  const out = new Set();
  for (const t of tokens) for (const v of [...Object.values(t.color), ...Object.values(t.rob), ...t.cat, ...t.seq]) out.add(String(v).toLowerCase());
  return out;
}

/**
 * Findings of one drawn figure: `[{ rule, detail }]`. `t` is the token set it was drawn with (sizes, font, metrics);
 * `palette` the colours allowed; `measure(text, size)` the width of a text in the figure's unit.
 */
export function checkSvg(svg, { t, palette, measure }) {
  const out = [], add = (rule, detail) => out.push({ rule, detail });
  const root = svg.match(/^<svg\b[^>]*>/)?.[0] || '';
  if (!/\srole="img"/.test(root)) add('F7', 'role="img"');
  if (!/<title>[^<]+<\/title>/.test(svg)) add('F7', '<title>');
  if (!/<desc>[^<]*<\/desc>/.test(svg)) add('F7', '<desc>');
  const ids = new Map();
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) add('F8', id);
  const sizes = new Set([t.size.label, t.size.small].map(String));
  const vb = (attr(root, 'viewBox') || '').split(/[\s,]+/).map(Number), W = vb[2] || Infinity;
  const rootSize = Number(attr(root, 'font-size')) || t.size.label;
  for (const m of svg.matchAll(/<([a-zA-Z]+)\b[^>]*>/g)) {
    const tag = m[0], name = m[1];
    for (const a of ['fill', 'stroke']) {
      const v = attr(tag, a);
      if (v != null && !NAMED.test(v) && !palette.has(v.toLowerCase())) add('F2', `${name} ${a}=${v}`);
    }
    const fs = attr(tag, 'font-size');
    if (fs != null && !sizes.has(fs)) add('F3', `${name} font-size=${fs}`);
    const ff = attr(tag, 'font-family');
    if (ff != null && decode(ff) !== t.font) add('F4', `${name} font-family=${decode(ff)}`);
    if (attr(tag, 'font-weight') === 'bold') add('F5', name);
  }
  // text and its lines: the content of each <text> without tspans, else each <tspan>
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const own = m[1], body = m[2].replace(/<title>[\s\S]*?<\/title>/g, '');
    const size = Number(attr(` ${own}`, 'font-size')) || rootSize, anchor = attr(` ${own}`, 'text-anchor') || 'start';
    const spans = [...body.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)].map(s => ({ x: Number(attr(` ${s[1]}`, 'x')), s: decode(s[2]) }));
    const parts = spans.length ? spans : [{ x: Number(attr(` ${own}`, 'x')), s: decode(body.replace(/<[^>]+>/g, '')) }];
    for (const p of parts) {
      if (/…|\.\.\./.test(p.s)) add('F1', p.s);
      if (/\stransform=/.test(` ${own}`) || !Number.isFinite(p.x) || !p.s.trim()) continue;
      const w = measure(p.s, size), left = anchor === 'end' ? p.x - w : anchor === 'middle' ? p.x - w / 2 : p.x;
      if (left < -1 || left + w > W + 1) add('F6', p.s.slice(0, 40));
    }
  }
  return out;
}


// ---- what a reader needs of a figure (Submission › Files quality, plan §2): legible in print, titled axes, a forest's parts, hues -----------
const decodeText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const GREYS = /^(#(?:0{3}|f{3}|0{6}|f{6}|([0-9a-f])\2\2|([0-9a-f]{2})\3\3)|black|white|none|transparent|currentcolor|rgb\((\d+),\s*\4,\s*\4\))$/i;
/** Red against green: a pair a reader with red–green colour blindness cannot tell apart. */
const hueOf = c => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c) || /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(c); if (!m) return null;
  const [r, g, b] = m.slice(1).map(x => (x.length === 2 && /[a-f]/i.test(x) || c.startsWith('#') ? parseInt(x, 16) : Number(x)) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.15) return null; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
/**
 * The content a reader needs, read from a drawn SVG: `minPt` (its smallest text at `widthIn` inches wide, in points), `texts`, whether it has an
 * axis title (`axisTitle`), and for a forest: `measure` (risk ratio…), `model` (random, fixed, REML, IV), `weights`, `heterogeneity`, `favors`;
 * `hues` (the distinct non-grey fills and strokes) and `redGreen` (a red and a green among them).
 */
export function figureContent(svg, { widthIn = null } = {}) {
  const root = svg.match(/^<svg\b[^>]*>/)?.[0] || '', vb = (attr(root, 'viewBox') || '').split(/[\s,]+/).map(Number), W = vb[2] || Number(attr(root, 'width')) || null;
  const rootSize = Number(attr(root, 'font-size')) || null, sizes = [], texts = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const t = decodeText(m[2].replace(/<title>[\s\S]*?<\/title>/g, '')).trim(); if (!t) continue;
    texts.push(t);
    const fs = Number(attr(` ${m[1]}`, 'font-size')) || Number((/font-size:\s*([\d.]+)/.exec(attr(` ${m[1]}`, 'style') || '') || [])[1]) || rootSize;
    if (fs) sizes.push(fs);
  }
  const all = texts.join('\n'), minSize = sizes.length ? Math.min(...sizes) : null;
  const minPt = minSize && W && widthIn ? Math.round((minSize / W) * widthIn * 72 * 10) / 10 : null;
  const colours = new Set();
  for (const m of svg.matchAll(/\s(?:fill|stroke)="([^"]+)"/g)) if (!GREYS.test(m[1].trim()) && !/^url\(/.test(m[1])) colours.add(m[1].trim().toLowerCase());
  const hues = [...colours].map(hueOf).filter(h => h != null);
  const red = hues.some(h => h < 20 || h > 340), green = hues.some(h => h > 80 && h < 160);
  return { minPt, texts, axisTitle: /(ratio|difference|proportion|percent|%|months|years|events|n\b|score|weight|favou?rs)/i.test(all),
    measure: /(risk ratio|odds ratio|hazard ratio|mean difference|risk difference|proportion)/i.test(all), model: /(random|fixed|REML|\bIV\b|Mantel)/i.test(all),
    weights: /weight/i.test(all), heterogeneity: /(heterogeneity|I²|I2|tau)/i.test(all), favors: /favou?rs/i.test(all), hues: colours.size, redGreen: red && green };
}
/** The style findings in plain words: "3 colors and 2 sizes outside the style; text past the edge". */
export function styleSummary(found) {
  const n = rule => found.filter(f => f.rule === rule).length, parts = [];
  if (n('F2')) parts.push(`${n('F2')} ${n('F2') === 1 ? 'color' : 'colors'} outside the style`);
  if (n('F3')) parts.push(`${n('F3')} text ${n('F3') === 1 ? 'size' : 'sizes'} outside the style`);
  if (n('F4')) parts.push('another font');
  if (n('F5')) parts.push('bold text');
  if (n('F6')) parts.push('text past the edge');
  if (n('F1')) parts.push('labels cut short');
  return parts.join('; ');
}

// ---- what was checked by eye (2 Nov 2026): label case, minus signs, decimals ---------------------------------------------------------------
// Each is a pure function of the drawn SVG's visible text (the <text> elements; hover titles keep a plain hyphen, which the checks read).
/** The visible texts of a drawing: [{ s (first line), lines, x, y, anchor }]. */
export function svgTexts(svg) {
  const out = [];
  for (const m of String(svg || '').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const own = ` ${m[1]}`, body = m[2].replace(/<title>[\s\S]*?<\/title>/g, '');
    const spans = [...body.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)];
    const lines = (spans.length ? spans.map(s => decode(s[2])) : [decode(body.replace(/<[^>]+>/g, ''))]).map(x => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    const at = n => Number(attr(own, n) ?? (spans[0] ? attr(` ${spans[0][1]}`, n) : null));
    out.push({ s: lines[0], lines, x: at('x'), y: at('y'), anchor: attr(own, 'text-anchor') || 'start' });
  }
  return out;
}
// Units and statistics written in lower case on purpose; a one- or two-letter first word (n, k, p, mg, df) is never flagged.
const LOWER_OK = new Set(['min', 'sec', 'khz', 'mhz', 'kda', 'mmhg', 'log', 'tau', 'ppm', 'rpm', 'bpm', 'iqr', 'sem']);
const NUMERIC = /^[−-]?\d[\d.,]*%?$/;
/** The first word of a label when it is an ordinary lower-case word ("clinician-rated", "week"): null for a capital, a number, an acronym, a unit. */
export function lowerCaseStart(text) {
  const w = /^[\s("'“]*([a-z][a-z-]{2,})(?=[\s,;:)]|$)/.exec(String(text || ''))?.[1];
  return w && !LOWER_OK.has(w) ? w : null;
}
/** Labels of a drawing that start with an ordinary lower-case word: the first line of each text, once each. */
export function lowerCaseLabels(svg) {
  const seen = new Set(), texts = svgTexts(svg);
  // a centred line drawn right under another continues it ("Records removed before" / "screening:" in a PRISMA box); rows of labels in a
  // column (a forest's study names) are anchored at their start or end, each a label of its own
  const continues = t => t.anchor === 'middle' && texts.some(u => u !== t && u.anchor === 'middle' && u.x === t.x && t.y > u.y && t.y - u.y <= 16);
  for (const t of texts) if (lowerCaseStart(t.s) && !continues(t)) seen.add(t.s);
  return [...seen];
}
/** Numbers in a drawing's visible text written with a hyphen-minus instead of U+2212 ("-0.5", "(-1.2 to 0.3)"): the texts, once each. */
export function hyphenMinus(svg) {
  const seen = new Set();
  for (const t of svgTexts(svg)) for (const l of t.lines) if (/(^|[\s(\[,;=<>/])-(?=\.?\d)/.test(l)) seen.add(l);
  return [...seen];
}
const decimalsOf = s => (String(s).split('.')[1] || '').length;
const numbersIn = s => [...String(s).matchAll(/[−-]?\d[\d,]*(?:\.\d+)?/g)].map(m => m[0].replace(/^[−-]/, '').replace(/,/g, ''));
/** A text made only of numbers and their punctuation ("0.5", "0.52 (0.10 to 0.94)", "12 (25.0%)"). */
const numberText = s => /\d/.test(s) && !/[A-Za-z]{2,}/.test(s.replace(/\bto\b/g, ''));
/**
 * Mixed decimal places within one numeric column or axis. A column is the numeric texts that share an x and an anchor (the estimate column of a
 * forest, a vertical axis); an axis is three or more single numbers on one baseline. In a column every number has the same decimals ("0.5" beside
 * "0.52" or "1"); on an axis ticks may drop a trailing zero ("0, 0.5, 1") but not mix two fractional lengths ("0.5, 0.25").
 * Returns [{ where: 'column' | 'axis', at, samples }].
 */
export function mixedDecimals(svg) {
  const texts = svgTexts(svg).filter(t => t.lines.length === 1 && numberText(t.s) && Number.isFinite(t.x) && Number.isFinite(t.y)), out = [];
  const group = key => { const m = new Map(); for (const t of texts) { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return m; };
  const single = t => NUMERIC.test(t.s);
  for (const [k, g] of group(t => `${t.anchor}|${Math.round(t.x)}`)) {
    if (g.length < 3) continue;
    const set = new Set(g.flatMap(t => numbersIn(t.s)).map(decimalsOf)), frac = new Set([...set].filter(d => d > 0));
    const axis = g.every(single), bad = axis ? frac.size > 1 : set.size > 1;
    if (bad) out.push({ where: axis ? 'axis' : 'column', at: k, samples: g.slice(0, 6).map(t => t.s) });
  }
  for (const [k, g] of group(t => String(Math.round(t.y)))) {
    const ax = g.filter(single);
    if (ax.length < 3) continue;
    const frac = new Set(ax.flatMap(t => numbersIn(t.s)).map(decimalsOf).filter(d => d > 0));
    if (frac.size > 1) out.push({ where: 'axis', at: `y${k}`, samples: ax.slice(0, 6).map(t => t.s) });
  }
  return out;
}
/** Decimal places mixed within one column of a table: cells that are one number or "estimate (lower to upper)", per column. */
export function mixedColumnDecimals(columns, rows) {
  const out = [];
  columns.forEach((label, i) => {
    const cells = rows.map(r => String(r[i] ?? '').trim()).filter(c => NUMERIC.test(c) || /^[−-]?\d[\d.]*\s*\([−-]?\d[\d.]*\s*(?:to|,|–)\s*[−-]?\d[\d.]*\)$/.test(c));
    if (cells.length < 3) return;
    const set = new Set(cells.flatMap(numbersIn).map(decimalsOf));
    if (set.size > 1) out.push({ column: label, samples: cells.slice(0, 5) });
  });
  return out;
}
