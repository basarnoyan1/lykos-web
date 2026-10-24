// The risk-of-bias figure on screen (plan §2, "Risk-of-bias figures", 2026-10-24): the summary bars and the traffic light as one drawing, at
// the width the page gives and never larger than its own size, in the app's type (12 px; the closed scale). The print copy is the house
// drawing (lib/figure-house-render.mjs) or robvis's (lib/appraisal-robvis.mjs); this one is for reading and pressing:
//
//   bars   one per domain, Overall last: "D1  Bias due to confounding" (the code is the traffic light's column head, so the bars are its key),
//          the share of studies at each level stacked on a 0–100% axis, 14 px tall on a 28 px pitch
//   grid   one row per study, one column per domain code, a 16 px mark per judgement on the same 28 px pitch
//   key    the levels drawn, in the instrument's own words, under both
//
// Side by side when the width holds both at their size (bars at 240 px at least), else the bars over the grid. Colours and glyphs are the one
// risk-of-bias palette (lib/rob-palette.mjs, through the tokens), the same as in print; the edges take the theme's ink (.c-rob-edge), so the
// dark red of Critical reads on a dark page. Every mark says what it is (`data-chart-tip`, shown at once by lib/chart-interact.mjs, no
// <title> under it): a segment its domain, level, n of N and studies, and it carries them (`data-studies`, lib/figure-drill.mjs lists them);
// a judgement its study, the domain's full name and the judgement, and it carries the study (`data-study`, opened in Appraisal). Nothing
// moves or grows on hover: a hit shape around each mark takes the ring (research-views.css, .rob-fig). Pure.
import { esc, r1, svgRoot } from './figure-draw.mjs';
import { textWidth } from './textwidth.mjs';
import { ROB_LEVELS, glyphSvg, robFill, robLevel as robvisLevel } from './rob-palette.mjs';
import { robKeyLevels } from './figure-house-render.mjs';

const FS = 12, PITCH = 28, BAR = 14, R = 8, COL = 36, GAP = 32, PAD = 4, BAR_MIN = 240, BAR_MAX = 480, KEY_R = 6;
const levelOf = (word, tones) => (word ? robvisLevel(word, tones?.[word]) : 'na');
const columnsOf = tool => [...tool.domains, ...(tool.overall ? [{ id: 'overall', short: 'Overall', label: 'Overall' }] : [])];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const names = list => (list.length > 8 ? `${list.slice(0, 8).join(', ')} and ${list.length - 8} more` : list.join(', '));

/** The layout the figure takes at `width`: { side, gridW, barsW, barW, labelW, codeW }. */
export function robScreenLayout(tool, rows, { style: t, width = null, part = 'both' } = {}) {
  const m = (s, w = 400) => textWidth(String(s), FS, t.metrics) * (w === 600 ? 1.04 : 1);
  const cols = columnsOf(tool);
  const studyW = Math.min(220, Math.max(60, ...rows.map(r => m(r.label)))) + 16;
  const colW = cols.map(c => Math.max(COL, m(c.short, c.id === 'overall' ? 600 : 400) + 12));
  const gridW = studyW + colW.reduce((a, b) => a + b, 0);
  const coded = cols.some(c => c.short && c.short !== c.label);
  const codeW = coded ? Math.max(...cols.filter(c => c.id !== 'overall').map(c => m(c.short))) + 10 : 0;
  const labelW = codeW + Math.max(...cols.map(c => m(c.label, c.id === 'overall' ? 600 : 400))) + 12;
  const pctW = m('100%') / 2 + PAD;
  const fitBar = room => Math.max(BAR_MIN, Math.min(BAR_MAX, room - labelW - pctW));
  const avail = width || Infinity;
  if (part === 'bars') return { side: false, gridW: 0, barW: fitBar(avail), labelW, codeW, studyW, colW };
  if (part === 'grid') return { side: false, gridW, barW: 0, labelW, codeW, studyW, colW };
  const side = avail >= gridW + GAP + labelW + BAR_MIN + pctW;
  return { side, gridW, barW: side ? fitBar(avail - gridW - GAP) : fitBar(avail), labelW, codeW, studyW, colW };
}

/**
 * The screen figure: `part` 'both' (the item page), 'bars' or 'grid' (Appraisal's two panels; the grid then keys its codes under it).
 * `rows` [{ study, label, values }] as Appraisal's charts take them; `weights` (label → weight) counts each study by its weight in the bars.
 */
export function robScreen(tool, rows, { style: t, width = null, tones = {}, weights = null, part = 'both' } = {}) {
  const L = robScreenLayout(tool, rows, { style: t, width, part }), cols = columnsOf(tool), key = robKeyLevels(tool, rows, tones);
  const m = s => textWidth(String(s), FS, t.metrics);
  const wordOf = lv => key.find(k => k.level === lv)?.word || 'Not assessed';
  const ink = t.color.ink, mute = t.color.ink2, edge = `stroke="${ink}" stroke-width="1"`;
  const txt = (x, y, s, { anchor = 'start', cls = 'c-ink', weight = 0, fill = cls === 'c-mute' ? mute : ink } = {}) =>
    `<text x="${r1(x)}" y="${r1(y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} font-size="${FS}"${weight ? ` font-weight="${weight}"` : ''} class="${cls}" fill="${fill}">${esc(s)}</text>`;
  const parts = [];
  const doBars = part !== 'grid', doGrid = part !== 'bars';
  const gridX = 0, barsX = L.side ? L.gridW + GAP : 0;
  let barsTop = 0, gridTop = 0, bottom = 0;
  if (doBars && doGrid && !L.side) { barsTop = 0; gridTop = (cols.length * PITCH) + 32 + 20; }
  if (L.side) { barsTop = PITCH; gridTop = 0; }   // the first bar on the first study's line

  // ---- the bars ----
  if (doBars) {
    const used = weights ? rows.filter(r => weights.get(r.label) > 0) : rows, wt = r => (weights ? weights.get(r.label) : 1);
    const total = used.reduce((n, r) => n + wt(r), 0) || 1, x0 = barsX + L.labelW;
    cols.forEach((c, k) => {
      const y = barsTop + k * PITCH, cy = y + PITCH / 2, overall = c.id === 'overall';
      if (L.codeW && !overall) parts.push(txt(barsX, cy + 4, c.short, { cls: 'c-mute' }));
      parts.push(txt(barsX + (overall ? 0 : L.codeW), cy + 4, c.label, { weight: overall ? 600 : 0 }));
      const by = new Map();
      for (const r of used) { const lv = levelOf(r.values?.[c.id], tones), e = by.get(lv) || { w: 0, rows: [] }; e.w += wt(r); e.rows.push(r); by.set(lv, e); }
      let x = x0;
      for (const lv of ROB_LEVELS) {
        const e = by.get(lv);
        if (!e) continue;
        const sw = L.barW * e.w / total, n = e.rows.length, pct = Math.round(100 * e.w / total);
        const said = [...new Set(e.rows.map(r => String(r.values?.[c.id] || wordOf(lv))))].join(' or ');
        const tip = `${c.label}, ${said}: ${n} of ${used.length}${weights ? ` (${pct}% of weight)` : ` (${pct}%)`}. ${names(e.rows.map(r => r.label))}`;
        const ids = e.rows.map(r => r.study).filter(Boolean);
        const press = ids.length ? ` data-studies="${esc(ids.join(' '))}" data-drill-label="${esc(`${c.label}, ${said}`)}" role="button" tabindex="0"` : '';
        parts.push(`<g class="rob-seg" data-rob-domain="${esc(c.id)}" data-rob-level="${lv}" data-chart-tip="${esc(tip)}" data-tip-now="" aria-label="${esc(tip)}"${press}>` +
          `<rect class="rob-hit" x="${r1(x)}" y="${r1(cy - BAR / 2 - 4)}" width="${r1(sw)}" height="${BAR + 8}" fill="transparent"/>` +
          `<g class="rob-ink"><rect class="c-rob-edge" x="${r1(x)}" y="${r1(cy - BAR / 2)}" width="${r1(sw)}" height="${BAR}" fill="${lv === 'na' ? t.rob.none : robFill(t, lv)}" ${edge}/>` +
          `${lv !== 'na' && sw >= BAR * 1.6 ? glyphSvg(lv, x + sw / 2, cy, BAR * 0.7, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } }) : ''}</g></g>`);
        x += sw;
      }
    });
    const ay = barsTop + cols.length * PITCH + 4;
    parts.push(`<line class="c-axis" x1="${r1(x0)}" y1="${r1(ay)}" x2="${r1(x0 + L.barW)}" y2="${r1(ay)}" stroke="${t.color.axis}" stroke-width="1"/>`);
    for (const v of [0, 25, 50, 75, 100]) {
      const x = x0 + L.barW * v / 100;
      parts.push(`<line class="c-axis" x1="${r1(x)}" y1="${r1(ay)}" x2="${r1(x)}" y2="${r1(ay + 4)}" stroke="${t.color.axis}" stroke-width="1"/>`, txt(x, ay + 18, `${v}%`, { anchor: 'middle', cls: 'c-mute' }));
    }
    bottom = Math.max(bottom, ay + 24);
  }

  // ---- the grid ----
  if (doGrid) {
    const colX = L.colW.map((_, i) => gridX + L.studyW + L.colW.slice(0, i).reduce((a, b) => a + b, 0) + L.colW[i] / 2);
    cols.forEach((c, i) => parts.push(txt(colX[i], gridTop + PITCH / 2 + 4, c.short, { anchor: 'middle', cls: c.id === 'overall' ? 'c-ink' : 'c-mute', weight: c.id === 'overall' ? 600 : 0 })));
    rows.forEach((r, k) => {
      const y = gridTop + PITCH * (k + 1), cy = y + PITCH / 2;
      parts.push(`<line class="c-hair" x1="${r1(gridX)}" y1="${r1(y)}" x2="${r1(gridX + L.gridW)}" y2="${r1(y)}" stroke="${t.color.hair}" stroke-width="1"/>`);
      const shown = m(r.label) > L.studyW - 16 ? `${String(r.label).slice(0, Math.max(4, Math.floor(String(r.label).length * (L.studyW - 24) / m(r.label))))}…` : r.label;
      parts.push(txt(gridX, cy + 4, shown));
      cols.forEach((c, i) => {
        const word = r.values?.[c.id], lv = levelOf(word, tones);
        if (lv === 'na') return;
        const tip = `${r.label}, ${c.label}: ${word}`;
        parts.push(`<g class="rob-mk"${r.study ? ` data-study="${esc(r.study)}" role="button" tabindex="0"` : ''} data-rob-domain="${esc(c.id)}" data-rob-level="${lv}" data-chart-tip="${esc(tip)}" data-tip-now="" aria-label="${esc(tip)}">` +
          `<circle class="rob-hit" cx="${r1(colX[i])}" cy="${r1(cy)}" r="${R + 4}" fill="transparent"/>` +
          `<g class="rob-ink"><circle class="c-rob-edge" cx="${r1(colX[i])}" cy="${r1(cy)}" r="${R}" fill="${robFill(t, lv)}" ${edge}/>${glyphSvg(lv, colX[i], cy, R, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } })}</g></g>`);
      });
    });
    let y = gridTop + PITCH * (rows.length + 1);
    parts.push(`<line class="c-hair" x1="${r1(gridX)}" y1="${r1(y)}" x2="${r1(gridX + L.gridW)}" y2="${r1(y)}" stroke="${t.color.hair}" stroke-width="1"/>`);
    // alone (Appraisal's traffic light panel), the grid keys its codes under it; with the bars, the bars' labels are the key
    if (part === 'grid') for (const c of tool.domains.filter(d => d.short && d.short !== d.label)) { y += 20; parts.push(txt(gridX, y, c.short, { cls: 'c-mute' }), txt(gridX + L.codeW, y, c.label)); }
    bottom = Math.max(bottom, y + 8);
  }

  // ---- the key: the levels drawn, wrapped to the figure's width ----
  const W = Math.ceil(Math.max(L.side ? L.gridW + GAP + L.labelW + L.barW : 0, doGrid ? L.gridW : 0, doBars ? L.labelW + L.barW : 0) + m('100%') / 2 + PAD);
  let kx = 0, ky = bottom + 16;
  for (const { level, word } of key) {
    const iw = KEY_R * 2 + 6 + m(word) + 20;
    if (kx + iw > W && kx > 0) { kx = 0; ky += 22; }
    parts.push(`<circle class="c-rob-edge" cx="${r1(kx + KEY_R)}" cy="${r1(ky - 4)}" r="${KEY_R}" fill="${robFill(t, level)}" ${edge}/>${glyphSvg(level, kx + KEY_R, ky - 4, KEY_R, { inks: { dark: t.rob.glyph, light: t.rob.glyphOn } })}`, txt(kx + KEY_R * 2 + 6, ky, word));
    kx += iw;
  }
  const H = Math.ceil(ky + 8);
  const title = `${tool.name}: ${part === 'grid' ? 'traffic light' : part === 'bars' ? 'summary' : 'summary and traffic light'}, ${plural(rows.length, 'study', 'studies')}`;
  return svgRoot(t, W, H, parts.join(''), { title }).replace('<svg ', '<svg class="rob-fig" ');
}
