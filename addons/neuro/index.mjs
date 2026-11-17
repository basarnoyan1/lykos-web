// Neurosurgery figures for Lykos: spine levels, sagittal alignment, cranial location and outcome scales. Each chart is drawn from the
// columns a person maps (patient data or extracted study data) and returns SVG. No imports: Lykos passes `kit` (escaping, numbers and the
// house figure style), so a figure looks like every other figure the app draws. Nothing here is a clinical claim beyond what each figure
// names with its source (the SRS-Schwab modifier thresholds).

import { SPINE, BRAIN } from './art.mjs';

const SEQ = [...Array.from({ length: 7 }, (_, i) => `C${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`), 'S1'];
const at = v => SEQ.indexOf(v);

/** A vertebra as written ("L5", "Th12", "T 12", "S1", "S") in its canonical name, or ''. */
function vertebra(letter, n) {
  const L = String(letter || '').toUpperCase().replace('TH', 'T');
  const name = `${L}${L === 'S' && !n ? 1 : Number(n)}`;
  return at(name) >= 0 ? name : '';
}

/**
 * The levels a text names: segments ("L4-L5", "L4-5", "L4/L5", "L3–S1" as L3-L4 … L5-S1) and single vertebrae ("T12"). Answers
 * { segments: ['L4-L5', …], vertebrae: ['T12', …] }, each once.
 */
export function parseLevels(text) {
  const segments = new Set(), vertebrae = new Set();
  const re = /\b(C|Th|T|L|S)\s*(\d{1,2})?(?:\s*[-–—/]\s*(C|Th|T|L|S)?\s*(\d{1,2})?)?/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const a = vertebra(m[1], m[2]); if (!a) continue;
    const toLetter = m[3] || (m[4] ? m[1] : null);
    const b = toLetter ? vertebra(toLetter, m[4] || (toLetter.toUpperCase() === 'S' ? 1 : null)) : '';
    if (!b || b === a) { vertebrae.add(a); continue; }
    const [lo, hi] = [at(a), at(b)].sort((x, y) => x - y);
    for (let i = lo; i < hi; i++) segments.add(`${SEQ[i]}-${SEQ[i + 1]}`);
  }
  return { segments: [...segments], vertebrae: [...vertebrae] };
}

const pick = (kit, f, k, d) => kit?.[f]?.[k] ?? d;
const T = (kit, x, y, s, { size, anchor = 'start', weight = 400, fill } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" font-family="${kit.esc(kit.font)}">${kit.esc(s)}</text>`;

// ---- spine level map ----------------------------------------------------------------------------------------------------------------
// Drawn as the Spine ASD review drew its construct atlas: Servier Medical Art's lateral column (neuro/art.mjs, CC BY 4.0, recoloured),
// anterior to the left, cropped to the operated segments with a level above and below. Each operated disc is filled with a wedge the
// shape of the disc (taller in front), a deeper blue with more patients; the counts sit in a table level with the discs.
const RAMP = ['#c4d7f0', '#1c3f7a'];
const ramp = t => `#${[0, 1, 2].map(i => { const a = parseInt(RAMP[0].slice(1 + i * 2, 3 + i * 2), 16), b = parseInt(RAMP[1].slice(1 + i * 2, 3 + i * 2), 16); return Math.round(a + (b - a) * t).toString(16).padStart(2, '0'); }).join('')}`;
function discWedge([p, a, th]) {
  const L = Math.hypot(a[0] - p[0], a[1] - p[1]), u = [(a[0] - p[0]) / L, (a[1] - p[1]) / L], n = [-u[1], u[0]];
  const at = (t, h) => [p[0] + u[0] * L * t + n[0] * h, p[1] + u[1] * L * t + n[1] * h];
  return [at(0.06, th * 0.42), at(0.95, th * 0.55), at(0.95, -th * 0.55), at(0.06, -th * 0.42)].map(q => q.map(v => v.toFixed(2)).join(',')).join(' ');
}
function spineLevels({ field, n, title, width = 560, kit }) {
  const xs = field('x') || [], groups = field('series');
  const names = groups ? [...new Set(groups.map(g => String(g ?? '').trim() || 'Not reported'))].slice(0, 3) : [''];
  const seg = new Map(), unread = [];
  for (let r = 0; r < n; r++) {
    const p = parseLevels(xs[r]), g = groups ? (String(groups[r] ?? '').trim() || 'Not reported') : '';
    if (!names.includes(g)) continue;
    const segs = p.segments.filter(s => SPINE.discs[s]);
    if (!segs.length) { if (String(xs[r] ?? '').trim()) unread.push(String(xs[r])); continue; }
    for (const s of segs) { const k = `${g}|${s}`; seg.set(k, (seg.get(k) || 0) + 1); }
  }
  if (!seg.size) return { svg: '', note: 'No segment in the mapped column could be read (write levels as L4-L5, L4-5 or L3–S1; C2-C3 to L5-S1)' };
  const D = SPINE.discs, all = Object.keys(D), keys = [...new Set([...seg.keys()].map(k => k.split('|')[1]))].sort((a, b) => all.indexOf(a) - all.indexOf(b));
  const total = new Map(); for (const [k, c] of seg) { const s = k.split('|')[1]; total.set(s, (total.get(s) || 0) + c); }
  const maxC = Math.max(...total.values()), i0 = all.indexOf(keys[0]), i1 = all.indexOf(keys.at(-1));
  const yTop = (i0 > 0 ? D[all[i0 - 1]][1][1] : D[all[0]][1][1] - 12) - 4;
  const yEnd = i1 === all.length - 1 ? 340 : i1 === all.length - 2 ? 318 : D[all[i1 + 1]][1][1] + 6;   // L5-S1 keeps the sacrum
  const ink = pick(kit, 'color', 'ink', '#222'), ink2 = pick(kit, 'color', 'ink2', '#666'), hair = pick(kit, 'color', 'hair', '#ccc'), page = pick(kit, 'color', 'page', '#fff');
  const fs = pick(kit, 'size', 'label', 12), fsS = pick(kit, 'size', 'small', 11);
  // the lumbar column at about the review's scale; a short span is enlarged no further than two lumbar vertebrae fill 250 px
  const k = Math.min(6, Math.max(3.4, 420 / (yEnd - yTop))), artW = SPINE.width * k, artH = (yEnd - yTop) * k;
  const head = names.length > 1 || names[0] ? fsS + 12 : 0, top = (title ? fs * 2.2 : 6) + head;
  const colW = Math.max(40, ...names.map(g => g.length * fsS * 0.58 + 14)), labW = 54 + names.length * colW, artX = labW + 22;
  const X = x => artX + x * k, Y = y => top + (y - yTop) * k;
  const out = [`<rect width="100%" height="100%" fill="${page}"/>`];
  if (title) out.push(T(kit, 0, fs * 1.2, title, { size: fs, weight: kit.weight?.head ?? 600, fill: ink }));
  const wedges = keys.map(s => { const t = maxC > 1 ? (total.get(s) - 1) / (maxC - 1) : 1;
    return `<polygon points="${discWedge(D[s])}" fill="${ramp(0.25 + 0.75 * t)}" stroke="${RAMP[1]}" stroke-width="0.25" stroke-linejoin="round"/>`; }).join('');
  out.push(`<svg x="${artX}" y="${top}" width="${artW.toFixed(1)}" height="${artH.toFixed(1)}" viewBox="0 ${yTop} ${SPINE.width} ${yEnd - yTop}">${SPINE.markup}${wedges}</svg>`);
  if (head) {
    out.push(T(kit, 0, top - 8, 'Segment', { size: fsS, weight: 600, fill: ink }));
    names.forEach((g, gi) => out.push(T(kit, 54 + (gi + 1) * colW, top - 8, g, { size: fsS, weight: 600, fill: ink, anchor: 'end' })));
  }
  // each row level with its disc, pushed down only as far as the row above needs; a short leader to the disc's front
  let below = -Infinity; const rowH = fsS + 8;
  for (const s of keys) {
    const a = D[s][1], y = Y(a[1]), ly = Math.max(y, below + rowH); below = ly;
    out.push(`<polyline fill="none" stroke="${hair}" points="${labW + 4},${ly.toFixed(1)} ${(X(a[0]) - 10).toFixed(1)},${y.toFixed(1)} ${(X(a[0]) - 2).toFixed(1)},${y.toFixed(1)}"/>`);
    out.push(T(kit, 0, ly + fsS * 0.35, s.replace('-', '–'), { size: fsS, fill: ink }));
    names.forEach((g, gi) => { const c = seg.get(`${g}|${s}`); out.push(T(kit, 54 + (gi + 1) * colW, ly + fsS * 0.35, String(c || '–'), { size: fsS, fill: c ? ink : ink2, anchor: 'end' })); });
  }
  const w = Math.max(Math.min(width, artX + artW + 8), artX + artW + 8), h = Math.max(top + artH, below + fsS) + 6;
  const notes = ['Anterior to the left', unread.length ? `${unread.length} not read as segments: ${unread.slice(0, 4).join('; ')}${unread.length > 4 ? '; …' : ''}` : '', SPINE.credit].filter(Boolean);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" role="img" aria-label="${kit.esc(title || 'Spine level map')}">${out.join('')}</svg>`, note: notes.join('. ') };
}

// ---- sagittal alignment ---------------------------------------------------------------------------------------------------------------
// SRS-Schwab sagittal modifiers (Schwab F, et al. Spine 2012;37:1077–82): PI–LL 0 < 10°, + 10–20°, ++ > 20°; PT 0 < 20°, + 20–30°, ++ > 30°;
// SVA 0 < 4 cm, + 4–9.5 cm, ++ > 9.5 cm (here in mm).
export const SCHWAB = { 'PI–LL': [10, 20], PT: [20, 30], SVA: [40, 95] };
export const modifier = (name, v) => v == null ? null : v < SCHWAB[name][0] ? '0' : v <= SCHWAB[name][1] ? '+' : '++';

function sagittal({ field, n, title, width = 640, kit }) {
  const num = kit.num, col = f => (field(f) || []).map(num);
  const pi = col('pi'), panels = [];
  if (field('pi') && field('llPre') && field('llPost')) {
    const pre = col('llPre'), post = col('llPost');
    panels.push({ name: 'PI–LL', unit: '°', pairs: [...Array(n).keys()].map(r => [pi[r] != null && pre[r] != null ? pi[r] - pre[r] : null, pi[r] != null && post[r] != null ? pi[r] - post[r] : null]) });
  }
  if (field('ptPre') && field('ptPost')) { const a = col('ptPre'), b = col('ptPost'); panels.push({ name: 'PT', unit: '°', pairs: [...Array(n).keys()].map(r => [a[r], b[r]]) }); }
  if (field('svaPre') && field('svaPost')) { const a = col('svaPre'), b = col('svaPost'); panels.push({ name: 'SVA', unit: ' mm', pairs: [...Array(n).keys()].map(r => [a[r], b[r]]) }); }
  if (!panels.length) return { svg: '', note: 'Map PI with LL before and after, PT before and after, or SVA before and after' };
  const ink = pick(kit, 'color', 'ink', '#222'), ink2 = pick(kit, 'color', 'ink2', '#666'), hair = pick(kit, 'color', 'hair', '#ccc'), band = pick(kit, 'color', 'band', '#f0f0f0');
  const fs = pick(kit, 'size', 'label', 12), fsS = pick(kit, 'size', 'small', 11);
  const top = title ? fs * 2.2 : 6, ph = 220, pw = Math.floor(width / panels.length), out = [];
  if (title) out.push(T(kit, 0, fs * 1.2, title, { size: fs, weight: kit.weight?.head ?? 600, fill: ink }));
  panels.forEach((p, i) => {
    const x0 = i * pw + 34, x1 = x0 + 28, x2 = x0 + pw - 70, y0 = top + 22, y1 = y0 + ph;
    const vals = p.pairs.flat().filter(v => v != null), [a, b] = SCHWAB[p.name];
    const lo = Math.min(0, ...vals, -5), hi = Math.max(b * 1.25, ...vals);
    const Y = v => y1 - (v - lo) / (hi - lo || 1) * (y1 - y0);
    out.push(T(kit, x0, top + 10, `${p.name}${p.unit.trim() ? ` (${p.unit.trim()})` : ''}`, { size: fsS, weight: 600, fill: ink }));
    // the modifier zones: 0 shaded, + and ++ marked by their thresholds
    out.push(`<rect x="${x1 - 10}" y="${Y(Math.min(a, hi))}" width="${x2 - x1 + 20}" height="${Math.max(0, Y(lo) - Y(Math.min(a, hi)))}" fill="${band}"/>`);
    for (const [t, lab] of [[a, '+'], [b, '++']]) if (t < hi) out.push(`<line x1="${x1 - 10}" x2="${x2 + 10}" y1="${Y(t)}" y2="${Y(t)}" stroke="${hair}" stroke-dasharray="3 3"/>`, T(kit, x2 + 14, Y(t) - 3, lab, { size: fsS, fill: ink2 }));
    out.push(T(kit, x2 + 14, Y(Math.min(a, hi)) + fsS + 2, '0', { size: fsS, fill: ink2 }));
    out.push(`<line x1="${x1 - 10}" x2="${x1 - 10}" y1="${y0}" y2="${y1}" stroke="${hair}"/>`, T(kit, x1 - 14, Y(lo) + 4, String(Math.round(lo)), { size: fsS, anchor: 'end', fill: ink2 }), T(kit, x1 - 14, Y(hi) + 4, String(Math.round(hi)), { size: fsS, anchor: 'end', fill: ink2 }));
    const both = p.pairs.filter(([u, v]) => u != null && v != null);
    for (const [u, v] of both) out.push(`<line x1="${x1}" y1="${Y(u)}" x2="${x2}" y2="${Y(v)}" stroke="${ink2}" stroke-opacity="0.45" stroke-width="1"/>`, `<circle cx="${x1}" cy="${Y(u)}" r="2.5" fill="${ink2}"/>`, `<circle cx="${x2}" cy="${Y(v)}" r="2.5" fill="${ink2}"/>`);
    if (both.length) { const m = k => both.reduce((s, q) => s + q[k], 0) / both.length; out.push(`<line x1="${x1}" y1="${Y(m(0))}" x2="${x2}" y2="${Y(m(1))}" stroke="${ink}" stroke-width="2.5"/>`); }
    out.push(T(kit, x1, y1 + fsS + 6, 'Before', { size: fsS, anchor: 'middle', fill: ink2 }), T(kit, x2, y1 + fsS + 6, 'After', { size: fsS, anchor: 'middle', fill: ink2 }));
    const count = k => ['0', '+', '++'].map(g => p.pairs.filter(q => modifier(p.name, q[k]) === g).length);
    const [b0, b1] = [count(0), count(1)];
    out.push(T(kit, x0, y1 + fsS * 2.6 + 8, `0 ${b0[0]}→${b1[0]}   + ${b0[1]}→${b1[1]}   ++ ${b0[2]}→${b1[2]}`, { size: fsS, fill: ink }));
    out.push(T(kit, x0, y1 + fsS * 3.9 + 8, `n = ${both.length}`, { size: fsS, fill: ink2 }));
  });
  const h = top + 22 + ph + fsS * 4.2 + 14;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${kit.esc(title || 'Sagittal alignment')}">${out.join('')}</svg>`,
    note: 'Zones: SRS-Schwab sagittal modifiers (Schwab et al., Spine 2012)' };
}

// ---- cranial location map --------------------------------------------------------------------------------------------------------------
// Drawn on an openly licensed midsagittal brain (neuro/art.mjs: DBCLS, CC BY 4.0): each region a location names is a marker
// sized by how many, with the count; the regions and counts are listed beside it. A location may name several regions.
export const REGIONS = [
  ['Frontal', /\bfrontal\b/], ['Parietal', /\bparietal\b/], ['Occipital', /\boccipital\b/], ['Temporal', /\btemporal\b/], ['Insula', /\binsul/],
  ['Corpus callosum', /callos/], ['Lateral ventricle', /lateral ventric/], ['Third ventricle', /third ventric|\b3rd ventric/], ['Thalamus / basal ganglia', /thalam|basal gangl/],
  ['Hypothalamus', /hypothalam/], ['Sellar / suprasellar', /sella|suprasellar|pituitar/], ['Pineal', /pineal/],
  ['Brainstem', /brain ?stem|\bpons\b|(?<!cerebello)pontine|midbrain|medulla/], ['Fourth ventricle', /fourth ventric|\b4th ventric/],
  ['Cerebellum', /cerebell(?!opontine)/], ['Cerebellopontine angle', /cerebellopontine|\bcpa\b/],
  ['Anterior skull base', /anterior (skull base|cranial fossa)|olfactory|planum/], ['Middle cranial fossa', /middle cranial fossa|cavernous/],
  ['Clivus', /cliv/], ['Craniocervical junction', /craniocervical|foramen magnum|craniovertebral/],
];
export const regionsOf = text => { const t = String(text ?? '').toLowerCase(); return REGIONS.filter(r => r[1].test(t)).map(r => r[0]); };

function cranial({ field, n, title, width = 560, kit }) {
  const xs = field('x') || [], counts = new Map(), unread = [];
  for (let r = 0; r < n; r++) {
    const rs = regionsOf(xs[r]);
    if (!rs.length) { if (String(xs[r] ?? '').trim()) unread.push(String(xs[r])); continue; }
    for (const name of rs) counts.set(name, (counts.get(name) || 0) + 1);
  }
  if (!counts.size) return { svg: '', note: 'No location in the mapped column names a region (frontal, third ventricle, cerebellopontine angle …)' };
  const ink = pick(kit, 'color', 'ink', '#222'), mark = pick(kit, 'color', 'mark', '#536076'), page = pick(kit, 'color', 'page', '#fff');
  const fs = pick(kit, 'size', 'label', 12), fsS = pick(kit, 'size', 'small', 11);
  const top = title ? fs * 2.2 : 4, artW = Math.min(width * 0.6, 360), k = artW / 360, artH = 310 * k, maxC = Math.max(...counts.values());
  const out = [];
  if (title) out.push(T(kit, 0, fs * 1.2, title, { size: fs, weight: kit.weight?.head ?? 600, fill: ink }));
  out.push(`<svg x="0" y="${top}" width="${artW.toFixed(1)}" height="${artH.toFixed(1)}" viewBox="${BRAIN.viewBox}">${BRAIN.markup}`);
  for (const [name, c] of counts) { const [x, y] = BRAIN.regions[name]; const r = 6 + 10 * Math.sqrt(c / maxC);
    out.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${mark}" fill-opacity="0.85" stroke="${page}" stroke-width="1.2"/><text x="${x}" y="${(y + (fsS / k) * 0.35).toFixed(1)}" font-size="${(fsS / k).toFixed(1)}" text-anchor="middle" fill="${page}" font-family="${kit.esc(kit.font)}">${c}</text>`); }
  out.push('</svg>');
  const lx = artW + 28, rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  rows.forEach(([name, c], i) => out.push(T(kit, lx, top + fsS + 4 + i * (fsS + 8), name, { size: fsS, fill: ink }), T(kit, width - 4, top + fsS + 4 + i * (fsS + 8), String(c), { size: fsS, anchor: 'end', fill: ink })));
  const h = Math.max(top + artH, top + 10 + rows.length * (fsS + 8)) + 6;
  const notes = [unread.length ? `${unread.length} not placed: ${unread.slice(0, 4).join('; ')}${unread.length > 4 ? '; …' : ''}` : '', 'Lateral regions (temporal, insula) are shown in projection', BRAIN.credit].filter(Boolean);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h.toFixed(0)}" width="${width}" height="${h.toFixed(0)}" role="img" aria-label="${kit.esc(title || 'Cranial location map')}">${out.join('')}</svg>`, note: notes.join('. ') };
}

// ---- outcome scales ---------------------------------------------------------------------------------------------------------------------
// Each scale's range and which end is better, as the instruments define them; no minimal clinically important difference is assumed:
// a person gives one (chart.ref) with its source when they want the line.
export const SCALES = {
  odi: ['ODI', 0, 100, 'lower'], ndi: ['NDI', 0, 100, 'lower'], vas10: ['VAS', 0, 10, 'lower'], vas100: ['VAS', 0, 100, 'lower'], nrs: ['NRS', 0, 10, 'lower'],
  mjoa: ['mJOA', 0, 18, 'higher'], joa: ['JOA', 0, 17, 'higher'], kps: ['KPS', 0, 100, 'higher'], gose: ['GOS-E', 1, 8, 'higher'], mrs: ['mRS', 0, 6, 'lower'], srs22r: ['SRS-22r', 1, 5, 'higher'],
};
function outcome({ field, n, title, width = 560, kit, chart = {} }) {
  const xs = field('x') || [], ys = (field('y') || []).map(kit.num), ss = field('series');
  const sc = SCALES[String(chart.scale || '').toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
  const times = [...new Set(xs.map(x => String(x ?? '').trim()).filter(Boolean))];
  const numeric = times.every(t => kit.num(t) != null); if (numeric) times.sort((a, b) => kit.num(a) - kit.num(b));
  const series = ss ? [...new Set(ss.map(s => String(s ?? '').trim() || 'Not reported'))].slice(0, 6) : [''];
  const stat = new Map();
  for (let r = 0; r < n; r++) { const t = String(xs[r] ?? '').trim(), v = ys[r]; if (!t || v == null) continue; const k = `${ss ? (String(ss[r] ?? '').trim() || 'Not reported') : ''}|${t}`; (stat.get(k) || stat.set(k, []).get(k)).push(v); }
  if (!stat.size) return { svg: '', note: 'Map a time point (x) and a score (y)' };
  const vals = [...stat.values()].flat(), lo = sc ? sc[1] : Math.min(...vals), hi = sc ? sc[2] : Math.max(...vals);
  const ink = pick(kit, 'color', 'ink', '#222'), ink2 = pick(kit, 'color', 'ink2', '#666'), hair = pick(kit, 'color', 'hair', '#ccc'), cats = kit.cat?.length ? kit.cat : [ink, ink2];
  const fs = pick(kit, 'size', 'label', 12), fsS = pick(kit, 'size', 'small', 11);
  const top = (title ? fs * 2.2 : 6) + 6, left = 46, right = 120, x0 = left, x1 = width - right, y0 = top + 8, y1 = top + 220;
  const X = i => times.length === 1 ? (x0 + x1) / 2 : x0 + i * (x1 - x0) / (times.length - 1), Y = v => y1 - (v - lo) / (hi - lo || 1) * (y1 - y0);
  const out = [];
  if (title) out.push(T(kit, 0, fs * 1.2, title, { size: fs, weight: kit.weight?.head ?? 600, fill: ink }));
  out.push(`<line x1="${x0 - 10}" x2="${x0 - 10}" y1="${y0}" y2="${y1}" stroke="${hair}"/>`, T(kit, x0 - 14, Y(lo) + 4, String(lo), { size: fsS, anchor: 'end', fill: ink2 }), T(kit, x0 - 14, Y(hi) + 4, String(hi), { size: fsS, anchor: 'end', fill: ink2 }));
  if (sc) out.push(T(kit, x0 - 14, y0 - 8, `${sc[0]}, ${sc[3]} is better`, { size: fsS, fill: ink2 }));
  times.forEach((t, i) => out.push(T(kit, X(i), y1 + fsS + 8, t, { size: fsS, anchor: 'middle', fill: ink2 })));
  series.forEach((g, si) => {
    const color = cats[si % cats.length], pts = times.map((t, i) => { const v = stat.get(`${g}|${t}`); if (!v) return null; const m = v.reduce((a, b) => a + b, 0) / v.length, sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { i, m, sd, n: v.length }; }).filter(Boolean);
    out.push(`<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(p => `${X(p.i)},${Y(p.m)}`).join(' ')}"/>`);
    for (const p of pts) out.push(`<line x1="${X(p.i)}" x2="${X(p.i)}" y1="${Y(Math.min(hi, p.m + p.sd))}" y2="${Y(Math.max(lo, p.m - p.sd))}" stroke="${color}"/>`, `<circle cx="${X(p.i)}" cy="${Y(p.m)}" r="3.5" fill="${color}"/>`);
    if (pts.length) { const last = pts[pts.length - 1]; out.push(T(kit, x1 + 10, Y(last.m) + 4, `${g || 'Mean'} (n ${last.n})`, { size: fsS, fill: color })); }
    // the minimal clinically important difference a person gave, from this series' first point, toward better
    if (chart.ref != null && kit.num(chart.ref) != null && pts.length && sc) { const d = kit.num(chart.ref) * (sc[3] === 'lower' ? -1 : 1), v = pts[0].m + d; if (v >= lo && v <= hi) out.push(`<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="${color}" stroke-dasharray="4 3" stroke-opacity="0.7"/>`); }
  });
  const h = y1 + fsS * 2 + 14;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${kit.esc(title || 'Outcome scale')}">${out.join('')}</svg>`,
    note: `Mean ± SD at each time point${chart.ref != null ? '; dashed: the minimal clinically important difference given, from the first time point' : ''}` };
}

/** The charts this addon gives Lykos's Tables and figures: `fields` are column fields (mapped to columns) and `options` plain values. */
export const charts = [
  { id: 'spine-levels', label: 'Spine level map', fields: { required: ['x'], optional: ['series'] }, help: 'x: the levels operated or involved (L4-L5, L3–S1); series: a group', draw: spineLevels },
  { id: 'sagittal-alignment', label: 'Sagittal alignment', fields: { required: [], optional: ['x', 'pi', 'llPre', 'llPost', 'ptPre', 'ptPost', 'svaPre', 'svaPost'] }, help: 'PI with LL, PT and SVA before and after surgery', draw: sagittal },
  { id: 'cranial-location', label: 'Cranial location map', fields: { required: ['x'], optional: [] }, help: 'x: the lesion location as written', draw: cranial },
  { id: 'outcome-scale', label: 'Outcome scale', fields: { required: ['x', 'y'], optional: ['series'] }, options: ['scale', 'ref'], help: 'x: time point; y: score; scale: odi, ndi, vas10, mjoa, kps, gose …; ref: an MCID', draw: outcome },
];
