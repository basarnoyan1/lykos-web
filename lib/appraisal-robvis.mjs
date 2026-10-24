// Risk-of-bias figures by robvis's conventions (McGuinness & Higgins 2021; Batch 13 item 3, plan §4.9), drawn here so R is not
// needed: the traffic light as a grid of grey-headed cells with a coloured circle and its glyph per judgement, the domain key under
// it and the judgement key beside it; the summary as one stacked bar per domain on a 0–100% axis with a boxed key. Three templates,
// as robvis offers them: ROB2 (five domains, Low / Some concerns / High / No information), ROBINS-I (the instrument's domains, six in
// V2, Low / Low except for concerns about uncontrolled confounding / Moderate / Serious / Critical / No information) and Generic (any
// instrument; a checklist reads "Checklist items" and "Answer", as the review's JBI figures do). The colours and glyphs are the app's one
// risk-of-bias palette (lib/rob-palette.mjs: robvis's), which the house figures and the screen chart draw too. Text takes the figure
// style's font and sizes; the geometry is robvis's own proportions. Pure: `tool`, `rows` and `tones` as lib/appraisal-fig.mjs takes them.
import { figureTokens } from './figure-style.mjs';
import { textWidth } from './textwidth.mjs';
import { ROB_PALETTE, ROB_LEVELS, glyphSvg, robLevel } from './rob-palette.mjs';

/** The level colours (lib/rob-palette.mjs) by robvis's names. */
export const ROBVIS_COLOURS = ROB_PALETTE;
const LEVEL_ORDER = ROB_LEVELS;
const GREY = { head: '#AAAAAA', study: '#B3B3B3', overall: '#E6E6E6', border: '#4D4D4D', grid: '#CCCCCC', ink: '#000000', page: '#FFFFFF' };

export const ROBVIS_TEMPLATES = Object.freeze({
  rob2: { id: 'rob2', label: 'RoB 2', levels: ['Low', 'Some concerns', 'High', 'No information'], xTitle: 'Risk of bias domains', keyTitle: 'Judgement', overall: true },
  'robins-i': { id: 'robins-i', label: 'ROBINS-I', levels: ['Low', 'Low (except for concerns about uncontrolled confounding)', 'Moderate', 'Serious', 'Critical', 'No information'], xTitle: 'Risk of bias domains', keyTitle: 'Judgement', overall: true },
  generic: { id: 'generic', label: 'Generic', levels: null, xTitle: 'Risk of bias domains', keyTitle: 'Judgement', overall: null },
});
export const ROBVIS_TEMPLATE_IDS = Object.freeze(Object.keys(ROBVIS_TEMPLATES));

/** The level of a judgement word (lib/rob-palette.mjs robLevel). */
export const robvisLevel = robLevel;
const isChecklist = tool => (tool.domains || []).some(d => /^Q\d/i.test(d.short || ''));
/** The template an instrument draws with: ROB2 for RoB 2, ROBINS-I for ROBINS-I and its versions, Generic for the rest. */
export function robvisTemplateFor(tool) {
  const id = String(tool?.id || '').replace(/^custom-/, '');
  return id === 'rob2' ? 'rob2' : /^robins-i/.test(id) ? 'robins-i' : 'generic';
}
/** The template as resolved for an instrument: its levels in robvis's order, the titles, whether an Overall column is drawn. */
export function robvisPlan(tool, tones = {}, templateId = null, rows = null) {
  const T = ROBVIS_TEMPLATES[templateId] || ROBVIS_TEMPLATES[robvisTemplateFor(tool)];
  const checklist = isChecklist(tool);
  // the instrument's own judgement words, each at its level, ordered as robvis orders levels; with rows, only the levels that occur (robvis drops the rest from the key)
  const words = (tool.judgements || []).map(j => ({ word: j, level: robvisLevel(j, tones[j]) }));
  // only the drawn columns count (a study's values also hold its signalling answers, whose words would add levels no mark shows)
  const drawn = [...(tool.domains || []).map(d => d.id), 'overall'];
  const present = rows ? new Set(rows.flatMap(r => drawn.map(id => r.values?.[id]).filter(Boolean).map(w => robvisLevel(w, tones[w])))) : null;
  const seen = new Set(), levels = [];
  for (const lv of LEVEL_ORDER) for (const x of words) if (x.level === lv && !seen.has(lv) && (!present || present.has(lv))) { seen.add(lv); levels.push({ level: lv, word: T.levels?.find(l => robvisLevel(l) === lv) || x.word }); }
  return { id: T.id, levels, xTitle: checklist && T.id === 'generic' ? 'Checklist items' : T.xTitle, keyTitle: checklist && T.id === 'generic' ? 'Answer' : T.keyTitle,
    overall: T.overall ?? Boolean(tool.overall), checklist };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = x => String(Math.round(x * 10) / 10);
const styled = opts => (opts?.style ? opts.style : figureTokens(null, { medium: 'export' }));
const measure = (t, s, size) => textWidth(String(s ?? ''), size, t.metrics);
const text = (t, x, y, s, { anchor = 'start', size, weight = 400, fill = GREY.ink, attrs = '' } = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" font-family="${esc(t.font)}" font-size="${r1(size)}" font-weight="${weight}" fill="${fill}"${attrs}>${esc(s)}</text>`;
const columnsOf = (tool, plan) => [...tool.domains, ...(plan.overall ? [{ id: 'overall', short: 'Overall', label: 'Overall' }] : [])];
const mark = (t, cx, cy, r, level, size, title = '') =>
  `<g><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${ROBVIS_COLOURS[level]}" stroke="${GREY.ink}" stroke-width="${r1(Math.max(0.6, r * 0.08))}"/>${glyphSvg(level, cx, cy, r)}${title ? `<title>${esc(title)}</title>` : ''}</g>`;
const root = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(w)} ${r1(h)}" width="${r1(w)}" height="${r1(h)}" role="img"><title>${esc(title)}</title><rect x="0" y="0" width="${r1(w)}" height="${r1(h)}" fill="${GREY.page}"/>${body}</svg>`;

/**
 * The traffic light: a header row of grey cells (the domain shortcodes, Overall last), a grey study cell per row, a circle with its
 * symbol per judgement, the Overall column shaded; the x title over the columns, "Study" up the side; the domain key under the grid
 * and the judgement key at the right, as rob_traffic_light draws them. `opts.template` picks ROB2, ROBINS-I or Generic.
 */
export function robvisTrafficLight(tool, rows, tones = {}, opts = {}) {
  const t = styled(opts), plan = robvisPlan(tool, tones, opts.template, rows), cols = columnsOf(tool, plan);
  const fs = t.size.label, small = t.size.small, cell = Math.round(fs * 2.6), R = cell * 0.33;
  const studyW = Math.max(fs * 6, ...rows.map(r => measure(t, r.label, fs))) + fs * 1.6;
  const colW = Math.max(cell * 1.6, ...cols.map(c => measure(t, c.short, fs) + fs * 1.2));
  const left = fs * 2.2, top = fs * 2.4, gridX = left + studyW, gridW = cols.length * colW, headH = cell * 0.8;
  const rowsTop = top + headH, gridH = rows.length * cell;
  const parts = [];
  // the x title and the side title
  parts.push(text(t, gridX + gridW / 2, top - fs * 0.6, plan.xTitle, { anchor: 'middle', size: fs }));
  parts.push(text(t, left - fs * 1.2, rowsTop + gridH / 2, 'Study', { anchor: 'middle', size: fs, attrs: ` transform="rotate(-90 ${r1(left - fs * 1.2)} ${r1(rowsTop + gridH / 2)})"` }));
  // header cells
  cols.forEach((c, i) => {
    const x = gridX + i * colW;
    parts.push(`<rect x="${r1(x)}" y="${r1(top)}" width="${r1(colW)}" height="${r1(headH)}" fill="${GREY.head}" stroke="${GREY.border}" stroke-width="0.8"/>`);
    parts.push(text(t, x + colW / 2, top + headH / 2 + fs * 0.36, c.short, { anchor: 'middle', size: fs }));
  });
  // body: study cells and judgement cells
  rows.forEach((r, k) => {
    const y = rowsTop + k * cell, cy = y + cell / 2;
    parts.push(`<rect x="${r1(left)}" y="${r1(y)}" width="${r1(studyW)}" height="${r1(cell)}" fill="${GREY.study}" stroke="${GREY.border}" stroke-width="0.8"/>`);
    parts.push(text(t, left + studyW / 2, cy + fs * 0.36, r.label, { anchor: 'middle', size: fs }));
    const interactive = t.medium === 'screen' && r.study;
    if (interactive) parts.push(`<g data-study="${esc(r.study)}" role="button" tabindex="0" aria-label="${esc(`Open ${r.label}`)}">`);
    cols.forEach((c, i) => {
      const x = gridX + i * colW, overall = c.id === 'overall';
      parts.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(colW)}" height="${r1(cell)}" fill="${overall ? GREY.overall : GREY.page}" stroke="${GREY.grid}" stroke-width="0.8"/>`);
      const word = r.values[c.id], level = word ? robvisLevel(word, tones[word]) : 'na';
      if (word) parts.push(mark(t, x + colW / 2, cy, R, level, fs, `${r.label}, ${c.label}: ${word}`));
    });
    if (interactive) parts.push('</g>');
  });
  // the domain key under the grid, from the first domain column
  let y = rowsTop + gridH + fs * 1.6;
  const keyLines = tool.domains.filter(d => d.short !== d.label).map(d => `${d.short}: ${d.label}`);
  for (const line of keyLines) { parts.push(text(t, gridX, y, line, { size: fs })); y += fs * 1.35; }
  // the judgement key at the right, under the Overall column
  const kr = R * 0.8, kx = gridX + gridW - colW + kr, ky0 = rowsTop + gridH + fs * 1.6;
  parts.push(text(t, kx - kr, ky0, plan.keyTitle, { size: fs }));
  const keyW = Math.max(...plan.levels.map(l => measure(t, l.word, fs))) + kr * 2 + fs;
  plan.levels.slice().reverse().forEach((l, i) => { const cy = ky0 + fs * 1.2 + i * (kr * 2 + fs * 0.9) + kr; parts.push(mark(t, kx, cy, kr, l.level, fs * 0.9)); parts.push(text(t, kx + kr + fs * 0.6, cy + fs * 0.36, l.word, { size: fs })); });
  const keyBottom = ky0 + fs * 1.2 + plan.levels.length * (kr * 2 + fs * 0.9);
  const w = Math.max(gridX + gridW, kx - kr + keyW, gridX + Math.max(0, ...keyLines.map(l => measure(t, l, fs)))) + fs * 1.5;
  const h = Math.max(y, keyBottom) + small;
  return root(w, h, parts.join(''), `${tool.name} traffic light, robvis ${ROBVIS_TEMPLATES[plan.id].label} template`);
}

/**
 * The summary: one horizontal bar per domain (Overall last, in bold), the share of studies at each level stacked low → critical
 * left to right with black outlines, a 0–100% axis under them and a boxed key centred below, as rob_summary draws them. With
 * `weights` (study label → weight) each study counts by its weight and studies without one are left out.
 */
export function robvisSummary(tool, rows, tones = {}, opts = {}) {
  const t = styled(opts), plan = robvisPlan(tool, tones, opts.template, rows), cols = columnsOf(tool, plan), weights = opts.weights || null;
  const fs = t.size.label, small = t.size.small, barH = fs * 1.9, gap = fs * 0.5, pitch = barH + gap;
  const labelW = Math.max(...cols.map(c => measure(t, c.label, fs))) + fs * 1.5, left = fs, barW = Math.max(fs * 24, cols.length * fs * 4), x0 = left + labelW, top = fs;
  const used = weights ? rows.filter(r => weights.get(r.label) > 0) : rows, wt = r => (weights ? weights.get(r.label) : 1);
  const total = used.reduce((n, r) => n + wt(r), 0) || 1;
  const parts = [];
  cols.forEach((c, k) => {
    const y = top + k * pitch, overall = c.id === 'overall';
    parts.push(text(t, x0 - fs * 0.6, y + barH / 2 + fs * 0.36, c.label, { anchor: 'end', size: fs, weight: overall ? 700 : 400 }));
    const sums = new Map(), ns = new Map();
    for (const r of used) { const word = r.values[c.id], lv = word ? robvisLevel(word, tones[word]) : 'na'; sums.set(lv, (sums.get(lv) || 0) + wt(r)); ns.set(lv, (ns.get(lv) || 0) + 1); }
    let x = x0;
    for (const lv of LEVEL_ORDER) {
      const v = sums.get(lv) || 0;
      if (!v) continue;
      const sw = barW * v / total;
      parts.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(sw)}" height="${r1(barH)}" fill="${ROBVIS_COLOURS[lv]}" stroke="${GREY.ink}" stroke-width="0.8"><title>${esc(c.label)}: ${ns.get(lv)} of ${used.length}${weights ? `, ${Math.round(100 * v / total)}% of weight` : ''}</title></rect>`);
      x += sw;
    }
  });
  // the axis
  const ay = top + cols.length * pitch - gap + fs * 0.6;
  parts.push(`<line x1="${r1(x0 - fs * 0.6)}" y1="${r1(ay)}" x2="${r1(x0 + barW + fs * 0.6)}" y2="${r1(ay)}" stroke="${GREY.ink}" stroke-width="0.8"/>`);
  for (const v of [0, 25, 50, 75, 100]) { const x = x0 + barW * v / 100; parts.push(`<line x1="${r1(x)}" y1="${r1(ay)}" x2="${r1(x)}" y2="${r1(ay + small * 0.4)}" stroke="${GREY.ink}" stroke-width="0.8"/>`); parts.push(text(t, x, ay + small * 1.6, `${v}%`, { anchor: 'middle', size: small, fill: '#4D4D4D' })); }
  // the boxed key, centred under the bars
  const sw = fs * 1.1, items = plan.levels.map(l => ({ ...l, w: sw + fs * 0.5 + measure(t, l.word, small) + fs }));
  const keyW = items.reduce((n, i) => n + i.w, 0) + fs * 0.6, keyH = sw + fs, kx0 = x0 + barW / 2 - keyW / 2, ky = ay + small * 2.6;
  parts.push(`<rect x="${r1(kx0)}" y="${r1(ky)}" width="${r1(keyW)}" height="${r1(keyH)}" fill="${GREY.page}" stroke="${GREY.ink}" stroke-width="0.8"/>`);
  let kx = kx0 + fs * 0.6;
  for (const i of items) { parts.push(`<rect x="${r1(kx)}" y="${r1(ky + fs * 0.5)}" width="${r1(sw)}" height="${r1(sw)}" fill="${ROBVIS_COLOURS[i.level]}" stroke="${GREY.ink}" stroke-width="0.8"/>`); parts.push(text(t, kx + sw + fs * 0.5, ky + fs * 0.5 + sw / 2 + small * 0.36, i.word, { size: small })); kx += i.w; }
  const w = Math.max(x0 + barW + fs * 2, kx0 + keyW + fs), h = ky + keyH + fs;
  return root(w, h, parts.join(''), `${tool.name} summary${weights ? ', weighted' : ''}, robvis ${ROBVIS_TEMPLATES[plan.id].label} template`);
}
