// Synthesis without meta-analysis (SWiM; Campbell et al. BMJ 2020;368:l6890).
//
// When effects cannot be pooled, the review reports the direction of effect
// per study and outcome domain (the effect direction plot of Thomson & Thomas
// 2013), tests the balance of directions with a sign test, and draws a harvest
// plot (Ogilvie et al. 2008). Vote counting on statistical significance is not
// offered: SWiM advises against it. Pure; the figure is the house drawing (FIGURE-STYLE §2), given the style of its medium
// (`opts.style`, figureTokens) or, without one, the print copy.
import { figureTokens } from './figure-style.mjs';
import { svgRoot, lines, labelColumn, wrapText, measure, axisLine, hairLine, sourceBlock, r1, esc as hesc, LINE, keyLines } from './figure-draw.mjs';
import { noteFigure, legendRows, widthOf, sourceOf } from './plot-draw.mjs';

export { DIRECTIONS, combineDirections, signTest, effectDirection, robLevel, SWIM_ITEMS } from './swim-core.mjs';
import { effectDirection, robLevel } from './swim-core.mjs';

// ---- harvest plot ---------------------------------------------------------------------------

/**
 * A harvest plot: one panel row per outcome domain, one column per direction
 * group, a bar per study in the column of its direction, its height by
 * `weight` and its shade by risk of bias.
 * options: groups (direction order, default harm · no clear or mixed · benefit),
 * groupLabels, weight: 'n' (sample size, the default when any study has one) |
 * 'rob' (low 3, some concerns 2, high 1) | 'equal'.
 */
export function harvestPlotSvg(rows, opts = {}) {
  return houseHarvest(effectDirection(rows), { ...opts, style: opts.style || figureTokens(null, { medium: 'export' }) });
}

/** The house harvest plot (FIGURE-STYLE §2): bars in the greys of the style (darker is lower risk of bias), hairline panels, outcome names wrapped to two lines or keyed, the legend row and the bar-height note under the plot. */
function houseHarvest(ed, { style: t, groups = ['harm', 'no clear', 'benefit'], groupLabels = {}, weight, title = 'Harvest plot', width, source = [] }) {
  const W0 = widthOf(t, width, 'double');
  if (!ed.outcomes.length) return noteFigure(t, { title, message: 'Not drawn: no study has a direction of effect to show.', width: W0, kind: 'double', source });
  const P = t.pad, u = t.size.label, sm = t.size.small, gap = u * 0.6;
  const mode = weight || (ed.table.some(r => r.n > 0) ? 'n' : 'equal'), maxN = Math.max(0, ...ed.table.map(r => r.n || 0));
  const heightOf = r => mode === 'n' ? (r.n > 0 && maxN ? Math.max(0.12, r.n / maxN) : 0.12) : mode === 'rob' ? ({ low: 1, some: 2 / 3, high: 1 / 3 }[robLevel(r.rob)] || 1 / 3) : 1;
  const colOf = d => groups.includes(d) ? d : d === 'mixed' && groups.includes('no clear') ? 'no clear' : null;
  const LABEL = { benefit: 'Favours intervention', harm: 'Favours comparator', 'no clear': 'No clear or mixed', mixed: 'Mixed' };
  const name = g => groupLabels[g] || LABEL[g] || g;
  const perCol = groups.map(g => Math.max(1, ...ed.outcomes.map(o => ed.table.filter(r => colOf(r.directions[o]) === g).length)));
  const col = labelColumn(t, ed.outcomes, W0 * 0.25);
  const avail = W0 - 2 * P - col.w, need = perCol.reduce((a, n) => a + n, 0), k = Math.max(0.45, Math.min(1, (avail - groups.length * u * 0.35) / (need * u * 1.45)));
  const bar = u * 1.1 * k, bgap = u * 0.35 * k;
  const base = perCol.map((n, i) => Math.max(n * (bar + bgap) + bgap, Math.min(measure(t, name(groups[i])) + gap * 1.5, avail / groups.length)));
  const spare = Math.max(0, (avail - base.reduce((x, y) => x + y, 0)) / groups.length), colW = base.map(c => c + spare);
  const heads = groups.map((g, i) => wrapText(t, name(g), colW[i] - gap));
  const W = Math.max(W0, 2 * P + col.w + colW.reduce((a, b) => a + b, 0));
  const x0 = P + col.w, colX = colW.map((_, i) => x0 + colW.slice(0, i).reduce((a, b) => a + b, 0)), plotW = colW.reduce((a, b) => a + b, 0);
  const headH = Math.max(...heads.map(h => h.length)) * u * LINE + u * 0.4, panelH = u * 7;
  const parts = [];
  groups.forEach((g, i) => parts.push(lines(t, colX[i] + colW[i] / 2, P + headH / 2, heads[i], { anchor: 'middle', role: 'head', cls: 'c-ink c-head' })));
  const SHADE = { low: 1, some: 2, high: 4, '': 5 }, SHADE_LABEL = { low: 'Low risk of bias', some: 'Some concerns', high: 'High risk of bias', '': 'Not assessed' };
  ed.outcomes.forEach((o, oi) => {
    const top = P + headH + oi * panelH, base = top + panelH - u * 0.5, ln = col.lines[oi];
    parts.push(hairLine(t, P, top, W - P, top), lines(t, x0 - gap, top + panelH / 2, ln, { anchor: 'end', inner: ln.join(' ') === o ? '' : `<title>${hesc(o)}</title>` }));
    groups.forEach((g, gi) => {
      if (gi) parts.push(hairLine(t, colX[gi], top, colX[gi], top + panelH));
      ed.table.filter(r => colOf(r.directions[o]) === g).forEach((r, j) => {
        const bh = (panelH - u * 1.5) * heightOf(r), bx = colX[gi] + bgap + j * (bar + bgap), c = SHADE[robLevel(r.rob)];
        parts.push(`<rect class="c-cat${c}" x="${r1(bx)}" y="${r1(base - bh)}" width="${r1(bar)}" height="${r1(bh)}" fill="${t.cat[c]}" stroke="${t.color.axis}" stroke-width="${t.line.hair}" data-study="${hesc(r.study)}" data-outcome="${hesc(o)}"><title>${hesc(r.study)} · ${hesc(o)}: ${hesc(r.directions[o])}${r.n != null ? ` · n ${r.n}` : ''}${r.rob ? ` · ${hesc(r.rob)}` : ''}</title></rect>`);
      });
    });
    parts.push(axisLine(t, x0, base, x0 + plotW, base));
  });
  let y = P + headH + ed.outcomes.length * panelH + sm * 0.5;
  const leg = legendRows(t, P, y, W - 2 * P, ['low', 'some', 'high', ''].map(l => ({ label: SHADE_LABEL[l], sample: (x, yy, len) => `<rect class="c-cat${SHADE[l]}" x="${r1(x + len / 2 - u * 0.5)}" y="${r1(yy - u * 0.5)}" width="${r1(u)}" height="${r1(u)}" fill="${t.cat[SHADE[l]]}" stroke="${t.color.axis}" stroke-width="${t.line.hair}"/>` })));
  parts.push(leg.svg); y += leg.h;
  const note = mode === 'n' ? 'Bar height: sample size' : mode === 'rob' ? 'Bar height: risk of bias (taller is lower)' : 'Bars of equal height';
  const b = sourceBlock(t, P, y + sm * 0.5, W - 2 * P, [note, ...sourceOf(source), ...keyLines(col.keys)]);
  parts.push(b.svg); y += sm * 0.5 + b.h;
  return svgRoot(t, W, y + Math.max(P, sm * 0.6), parts.join(''), { title, desc: `${ed.outcomes.length} outcome domain${ed.outcomes.length === 1 ? '' : 's'}, ${ed.studies.length} stud${ed.studies.length === 1 ? 'y' : 'ies'}` });
}

/** The house drawings app/lint-figures.mjs checks: a harvest plot of two outcome domains with every risk-of-bias level, and an empty one. */
export const __fixture = style => {
  const rows = [['Aldermere 2012', 'Pain at 12 weeks', 'benefit', 120, 'Low'], ['Ibarra-Montoya 2019', 'Pain at 12 weeks', 'benefit', 60, 'Some concerns'], ['Kowalczyk 2016', 'Pain at 12 weeks', 'harm', 30, 'High'], ['Singh 2020', 'Pain at 12 weeks', 'no clear', 80, ''],
    ['Aldermere 2012', 'Function, measured on the Oxford hip score and the Harris hip score at one year', 'benefit', 120, 'Low'], ['Tanaka 2018', 'Function, measured on the Oxford hip score and the Harris hip score at one year', 'mixed', 45, 'Some concerns']]
    .map(([study, outcome, direction, n, rob]) => ({ study, outcome, direction, n, rob }));
  return [{ name: 'harvestPlotSvg', svg: harvestPlotSvg(rows, { style, source: ['4 studies · SWiM'] }) }, { name: 'harvestPlotEmpty', svg: harvestPlotSvg([], { style }) }];
};
