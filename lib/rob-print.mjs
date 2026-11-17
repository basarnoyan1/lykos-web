// What a printed risk-of-bias summary shows, read from its pixels, and the studies that give it (plan §2, "Risk-of-bias figures: the print's
// studies", 2026-10-24). A robvis or house summary is one stacked bar per domain: the share of studies at each level, in a level's hue, the
// segments parted by thin dark edges. The bars are read from the PNG (decoded here: no canvas, so Node reads it too), each segment's share
// measured along the bar's middle line, and the number of studies is the smallest one every share is a whole count of (7 when every share is
// a multiple of 1/7). A figure that draws a subset of the instrument's studies (the studies of one outcome's syntheses) is then found by the
// counts: the candidate sets whose judgements give the same counts, domain by domain. Pure but for DecompressionStream.
import { robLevel as robvisLevel } from './rob-palette.mjs';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const type4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

async function inflate(bytes) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * A PNG's pixels as RGB: `{ width, height, rgb }` (3 bytes a pixel), or null for what this reader does not take (16-bit, interlaced, under
 * 8-bit grey). Greyscale, RGB, palette and their alpha forms at 8 bits; alpha is laid over white, as the page a print sits on.
 */
export async function decodePng(bytes, { maxPixels = 40e6 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || !SIG.every((v, i) => bytes[i] === v)) return null;
  let i = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
  const idat = [];
  while (i + 8 <= bytes.length) {
    const len = u32(bytes, i), t = type4(bytes, i + 4), d = i + 8;
    if (t === 'IHDR') { width = u32(bytes, d); height = u32(bytes, d + 4); depth = bytes[d + 8]; type = bytes[d + 9]; interlace = bytes[d + 12]; }
    else if (t === 'PLTE') palette = bytes.subarray(d, d + len);
    else if (t === 'tRNS') alpha = bytes.subarray(d, d + len);
    else if (t === 'IDAT') idat.push(bytes.subarray(d, d + len));
    else if (t === 'IEND') break;
    i = d + len + 4;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!width || !height || depth !== 8 || interlace || !channels || width * height > maxPixels || (type === 3 && !palette)) return null;
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0; for (const c of idat) { all.set(c, at); at += c.length; }
  const raw = await inflate(all), bpp = channels, stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[prev + x] : 0, c = x >= bpp && y ? px[prev + x - bpp] : 0, v = raw[src + x];
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = (v + p) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3), over = (v, al) => Math.round((v * al + 255 * (255 - al)) / 255);
  for (let k = 0; k < width * height; k++) {
    let r, g, b, al = 255;
    if (type === 0) { r = g = b = px[k]; }
    else if (type === 4) { r = g = b = px[k * 2]; al = px[k * 2 + 1]; }
    else if (type === 2) { r = px[k * 3]; g = px[k * 3 + 1]; b = px[k * 3 + 2]; }
    else if (type === 6) { r = px[k * 4]; g = px[k * 4 + 1]; b = px[k * 4 + 2]; al = px[k * 4 + 3]; }
    else { const j = px[k]; r = palette[j * 3]; g = palette[j * 3 + 1]; b = palette[j * 3 + 2]; al = alpha && j < alpha.length ? alpha[j] : 255; }
    rgb[k * 3] = over(r, al); rgb[k * 3 + 1] = over(g, al); rgb[k * 3 + 2] = over(b, al);
  }
  return { width, height, rgb };
}

// the hues a printed summary draws its levels in: robvis's (the app's own since 2026-10-24) and the earlier house Okabe–Ito set
const HUES = [['low', '#02c100'], ['lowx', '#a6e08f'], ['concerns', '#e2df07'], ['high', '#bf0000'], ['critical', '#820000'], ['ninfo', '#4ea1f7'],
  ['low', '#009e73'], ['concerns', '#e69f00'], ['high', '#d55e00'], ['low', '#2fb38a'], ['concerns', '#e3a93a'], ['high', '#e0714a']]
  .map(([level, h]) => ({ level, c: [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) }));
/** The level a pixel's colour stands for, or '' (ink, paper, a grey, an edge's blend). */
export function levelOfPixel(r, g, b) {
  let best = '', d = 40 * 40 * 3;
  for (const h of HUES) { const e = (r - h.c[0]) ** 2 + (g - h.c[1]) ** 2 + (b - h.c[2]) ** 2; if (e < d) { d = e; best = h.level; } }
  return best;
}

/**
 * The bars of a printed summary, top to bottom: `[[{ level, share }]]`, each bar's segments left to right. A bar is a band of rows where at
 * least a fifth of the width is in a level's hue; its segments are read along the band's middle row, an edge between two segments split
 * between them. Empty when the picture holds no such bar.
 */
export function summaryBars(img) {
  const { width: W, height: H, rgb } = img, levelAt = (x, y) => { const k = (y * W + x) * 3; return levelOfPixel(rgb[k], rgb[k + 1], rgb[k + 2]); };
  const rowLevels = y => { const out = new Array(W); for (let x = 0; x < W; x++) out[x] = levelAt(x, y); return out; };
  const bandRows = [];
  for (let y = 0; y < H; y++) {
    let n = 0; for (let x = 0; x < W; x += 2) if (levelAt(x, y)) n++;
    bandRows.push(n * 2 >= W * 0.2);
  }
  const bands = [];
  for (let y = 0; y < H; y++) if (bandRows[y]) { const top = y; while (y + 1 < H && bandRows[y + 1]) y++; if (y - top >= 2) bands.push(Math.round((top + y) / 2)); }
  return bands.map(y => {
    const row = rowLevels(y), runs = [];
    for (let x = 0; x < W; x++) {
      if (!row[x]) continue;
      const level = row[x], from = x; while (x + 1 < W && row[x + 1] === level) x++;
      if (x - from >= 2) runs.push({ level, from, to: x + 1 });
    }
    // runs of one level parted only by an edge are one segment (a level's own outline does not split it)
    const segs = [];
    for (const r of runs) { const last = segs.at(-1); if (last && last.level === r.level && r.from - last.to <= 12) last.to = r.to; else segs.push({ ...r }); }
    if (!segs.length) return [];
    const start = segs[0].from, end = segs.at(-1).to, total = end - start;
    return segs.map((sg, k) => {
      const l = k ? (segs[k - 1].to + sg.from) / 2 : start, r = k < segs.length - 1 ? (sg.to + segs[k + 1].from) / 2 : end;
      return { level: sg.level, share: (r - l) / total };
    });
  }).filter(b => b.length);
}

/** The number of studies the bars count: the smallest whole number every share is a count of (within `tol` of one study), or 0. */
export function studiesCounted(bars, { max = 80, tol = 0.15 } = {}) {
  const shares = bars.flat().map(s => s.share);
  if (!shares.length) return 0;
  for (let n = 1; n <= max; n++) if (shares.every(v => { const c = v * n; return Math.round(c) >= 1 && Math.abs(c - Math.round(c)) <= tol; })) return n;
  return 0;
}

/** The counts the bars show: `{ n, bars: [{ level: count }] }`, or null when they are not counts of one number of studies. */
export function printedCounts(bars) {
  const n = studiesCounted(bars);
  if (!n) return null;
  return { n, bars: bars.map(b => { const o = {}; for (const s of b) o[s.level] = (o[s.level] || 0) + Math.round(s.share * n); return o; }) };
}

/** The counts a set of assessments gives: one `{ level: count }` per column (the domains, then Overall when drawn). */
export function countsOf(columns, rows) {
  return columns.map(c => { const o = {}; for (const r of rows) { const w = r.values?.[c.id], lv = w ? robvisLevel(w) : 'na'; o[lv] = (o[lv] || 0) + 1; } return o; });
}
const same = (a, b) => { const ka = Object.keys(a).filter(k => a[k]), kb = Object.keys(b).filter(k => b[k]); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };

/**
 * The candidate study sets whose judgements give the printed counts: `candidates` [{ key, label, rows }] (rows as Appraisal's charts take
 * them), `columns` the bars' columns in order. Answers the matching candidates; a print with another number of bars matches none.
 */
export function matchingSets(printed, columns, candidates) {
  if (!printed || printed.bars.length !== columns.length) return [];
  return candidates.filter(c => c.rows.length === printed.n && countsOf(columns, c.rows).every((o, k) => same(o, printed.bars[k])));
}

/** The shares, as a reader says them: "Serious 86%, Critical 14%". */
export const sharesWords = (bar, words = {}) => bar.map(s => `${words[s.level] || s.level} ${Math.round(s.share * 100)}%`).join(', ');

/**
 * The studies a package item's printed summary draws, from its bars: `{ status, printed, scope, label }`. `set` is the item's instrument with
 * every appraised study ({ tool, done }, lib/app-items.mjs robSets with `all`), `outcomes` [{ id, name, studies: Set }] the studies of each
 * outcome's syntheses (lib/rob-scope.mjs outcomeStudies). status: 'unread' (no bars counted), 'all' (every appraised study gives the print:
 * nothing to keep), 'outcome' (one outcome's studies give it: `scope` is the item's robScope), 'none' or 'many' (no set, or several sets that
 * differ, give it).
 */
export function printScope(bars, set, outcomes) {
  const printed = printedCounts(bars);
  if (!printed || !set) return { status: 'unread', printed };
  const columns = [...set.tool.domains, ...(set.tool.overall ? [{ id: 'overall' }] : [])];
  const cands = [{ key: 'all', label: 'every appraised study', rows: set.done },
    ...outcomes.map(o => ({ key: o.id, label: o.name, rows: set.done.filter(r => o.studies.has(r.study)) })).filter(c => c.rows.length)];
  const hits = matchingSets(printed, columns, cands);
  if (hits.some(h => h.key === 'all')) return { status: 'all', printed };
  const sets = new Map(hits.map(h => [h.rows.map(r => r.study).sort().join(' '), h]));
  if (!sets.size) return { status: 'none', printed };
  if (sets.size > 1) return { status: 'many', printed, labels: hits.map(h => h.label) };
  const h = hits[0];
  return { status: 'outcome', printed, label: h.label, scope: { scope: 'outcome', outcome: h.key, label: h.label, studies: h.rows.map(r => r.study), from: 'print' } };
}
