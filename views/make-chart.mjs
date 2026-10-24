// Make's Chart (views/summary-make.mjs): one field as a pie, bars or histogram; two fields crossed as a heat map or stacked bars (the
// evidence map); a number by a level field as dots per level; two numbers as a scatter; a level field as a table of every other field by
// its levels (n, median (IQR) or n (%)). Each is kept as a Tables and figures output (lib/output-spec.mjs); the dots and the scatter as
// the charts the output engine draws from the same columns, the table with the aggregates it has (count, median, min, max).
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { donutChart, barChart, columnChart, histogramBins, scatterChart } from '../lib/charts.mjs';
import { heatSvg, stackedSvg, dotSvg } from '../lib/output-charts.mjs';
import { leveled, numberSources } from '../lib/make-sources.mjs';

const fmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
const quantile = (xs, q) => { const t = [...xs].sort((a, b) => a - b); if (!t.length) return NaN; const i = (t.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return t[lo] + (t[hi] - t[lo]) * (i - lo); };

export function chartHtml(ctx, kit) {
  const mk = ctx.make, fields = ctx.fields, kept = ctx.kept, { pick, figure, at, where, count } = kit;
  const cats = leveled(fields, ctx).map(g => ({ ...g, id: `c:${g.id}` })), nums = numberSources(fields, ctx);
  const list = [...cats, ...nums], f = list.find(x => x.id === mk.field) || list[0];
  if (!f) return kit.empty([], 'No field to draw');
  const numeric = !f.field, levels = numeric ? [] : f.levels;
  // a second field: a level field crossed with a level field (heat map, stacked bars), a number against a level (dots per level) or against a number (scatter)
  const bys = numeric ? [...cats, ...nums.filter(x => x.id !== f.id)] : [...cats.filter(x => x.id !== f.id), ...nums];
  const by = bys.find(x => x.id === mk.by) || null, byLevels = by?.field ? by.levels : [], byNum = by && !by.field ? by : null;
  const cross = !!by && !numeric && !!by.field, dotsBy = !!by && numeric && !!by.field, scatter = !!by && numeric && !!byNum, tableOf = !numeric && !!byNum;
  // a pie only when its parts are a whole: a few levels, each study in one
  const few = !by && levels.length >= 2 && levels.length <= 5 && levels.reduce((n, l) => n + l.ids.length, 0) <= kept.size;
  const allowed = numeric ? (dotsBy ? ['dots'] : scatter ? ['scatter'] : ['histogram']) : cross ? ['heat', 'stacked'] : tableOf ? ['table'] : [...(few ? ['pie'] : []), 'bar', 'table'];
  const type = allowed.includes(mk.type) ? mk.type : allowed[0];
  // the drawings the picks allow, one select: a number's (histogram, dots by a level, scatter) or a level field's
  const kinds = numeric ? [['histogram', 'Histogram'], ['dots', 'Dots by level'], ['scatter', 'Scatter']] : [['pie', 'Pie'], ['bar', 'Bars'], ['table', 'Table by level'], ['heat', 'Heat map'], ['stacked', 'Stacked bars']];
  const filters = [pick('field', 'Field', list.map(x => [x.id, x.label]), f.id), pick('by', 'With', [['', 'No second field'], ...bys.map(x => [x.id, x.label])], by?.id || ''), pick('type', 'Visualize as', kinds.filter(([id]) => allowed.includes(id)), type)];
  let svg = '', html = '', note = count, spec = null;
  const title = by ? `${f.label} by ${by.label}` : f.label;
  if (type === 'histogram') {
    const bins = histogramBins(f.values.map(x => x.value));
    if (bins.length >= 2) {
      svg = columnChart(bins.map((b, j) => ({ label: `b${j}`, count: b.count, title: `${b.lo} to ${b.hi}${f.unit ? ` ${f.unit}` : ''}` })), { width: 520, height: 180, xLabel: f.unit ? `${f.label}, ${f.unit}` : f.label, yLabel: 'Studies', edges: [...bins.map(b => b.lo), bins.at(-1).hi] });
      bins.forEach((b, j) => { const ids = f.values.filter(v => v.value >= b.lo && (v.value < b.hi || (j === bins.length - 1 && v.value <= b.hi))).map(v => v.paperId); if (ids.length && ctx.drill) svg = svg.replace(`data-chart-mark="b${j}"`, `data-chart-mark="b${j}" data-es-drill="${at(ids)['data-es-drill']}"`); });
      note = `${plural(f.values.length, 'study', 'studies')} with a number`;
      // kept: the field's numbers by study as a column chart (a histogram has no output type: the output draws the values)
      if (f.kind === 'numeric') spec = { kind: 'chart', title: `${f.label} by study`, query: { from: 'studies', select: ['label', f.label], ...where }, chart: { type: 'column', x: 'label', y: f.label, sort: '-value' } };
    }
  } else if (type === 'dots') {
    const rows = f.values.map(v => { const lv = byLevels.find(l => l.ids.includes(v.paperId)); return lv ? { label: lv.label, value: v.value, row: v.paperId, series: ctx.studyLabel(v.paperId), attrs: at([v.paperId]), order: byLevels.indexOf(lv) } : null; }).filter(Boolean).sort((a, b) => a.order - b.order || a.value - b.value);   // one line per level, its studies' dots on it
    if (rows.length) { svg = dotSvg(rows, { width: 560, title, xLabel: f.unit ? `${f.label}, ${f.unit}` : f.label }); note = `${plural(rows.length, 'study', 'studies')} with a number and a level`;
      if (f.kind === 'numeric') spec = { kind: 'chart', title, query: { from: 'studies', select: [by.label, f.label, 'label'], ...where }, chart: { type: 'dot', x: by.label, y: f.label } }; }
  } else if (type === 'scatter') {
    const byVal = new Map(byNum.values.map(v => [v.paperId, v.value]));
    const points = f.values.filter(v => byVal.has(v.paperId)).map(v => ({ x: v.value, y: byVal.get(v.paperId), label: ctx.studyLabel(v.paperId), weight: 0.3, attrs: at([v.paperId]), text: `${ctx.studyLabel(v.paperId)}: ${f.label} ${fmt(v.value)}${f.unit ? ` ${f.unit}` : ''}, ${byNum.label} ${fmt(byVal.get(v.paperId))}${byNum.unit ? ` ${byNum.unit}` : ''}` }));
    if (points.length >= 2) { svg = scatterChart(points, { width: 520, title, xLabel: f.unit ? `${f.label}, ${f.unit}` : f.label, yLabel: byNum.unit ? `${byNum.label}, ${byNum.unit}` : byNum.label }); note = `${plural(points.length, 'study', 'studies')} with both numbers`;
      if (f.kind === 'numeric' && byNum.kind === 'numeric') spec = { kind: 'chart', title, query: { from: 'studies', select: ['label', f.label, byNum.label], ...where }, chart: { type: 'scatter', x: f.label, y: byNum.label } }; }
  } else if (type === 'table') {
    // Table 1: the level field's levels as columns; every other field a row (a number: median (IQR); a level field: each level's n (%))
    const cols = tableOf ? [byNum] : [], groups = levels, idsOf = l => new Set(l.ids);
    const numRows = (tableOf ? cols : nums.filter(n => n.id !== f.id)).map(n => [n.label + (n.unit ? ` (${n.unit})` : ''), ...groups.map(g => { const vals = n.values.filter(v => idsOf(g).has(v.paperId)).map(v => v.value); return vals.length ? `${fmt(quantile(vals, 0.5))} (${fmt(quantile(vals, 0.25))}–${fmt(quantile(vals, 0.75))}), n ${vals.length}` : '—'; })]);
    const levRows = tableOf ? [] : cats.filter(c => c.id !== f.id).flatMap(c => c.levels.slice(0, 6).map(l => [`${c.label}: ${l.label}`, ...groups.map(g => { const n = l.ids.filter(id => idsOf(g).has(id)).length; return n ? `${n} (${Math.round(100 * n / g.ids.length)}%)` : '0'; })]));
    const rows = [['Studies', ...groups.map(g => String(g.ids.length))], ...numRows, ...levRows];
    html = kit.table(title, [f.label, ...groups.map(g => g.label)], rows);
    note = `${plural(groups.length, 'level')}, ${plural(numRows.length + levRows.length, 'row')}`;
    const aggs = ['count', ...(tableOf ? cols : nums.filter(n => n.id !== f.id)).filter(n => n.kind === 'numeric').flatMap(n => [`median(${n.label})`, `min(${n.label})`, `max(${n.label})`])];
    spec = { kind: 'table', title: `${f.label}: studies by level`, query: { from: 'studies', groupBy: [f.label], aggregate: aggs, ...where } };
  } else if (cross) {
    const cells = levels.flatMap(r => byLevels.map(c => ({ y: r.label, x: c.label, value: c.ids.filter(id => r.ids.includes(id)).length })));
    if (cells.some(c => c.value)) svg = type === 'heat' ? heatSvg(cells, { width: 560, title, xLabel: by.label, yLabel: f.label })
      : stackedSvg(cells.filter(c => c.value).map(c => ({ label: c.y, series: c.x, value: c.value })), { width: 560, title, xLabel: 'Studies' });
    // kept: a study per row with both fields, counted by the output as it draws (heat), or the counts by both fields (stacked)
    spec = svg ? (type === 'heat' ? { kind: 'chart', title, query: { from: 'studies', select: [f.label, by.label], ...where }, chart: { type: 'heat', x: by.label, y: f.label } }
      : { kind: 'chart', title, query: { from: 'studies', groupBy: [f.label, by.label], aggregate: ['count'], ...where }, chart: { type: 'stacked', x: f.label, series: by.label } }) : null;
  } else if (levels.length) {
    svg = type === 'pie' ? donutChart(levels.slice(0, 5).map(l => ({ label: l.label, n: l.ids.length, attrs: at(l.ids) })), { width: 460, size: 84, title: f.label })
      : barChart(levels.map(l => ({ label: l.label, count: l.ids.length, attrs: at(l.ids) })), { width: 520, xLabel: 'Studies', title: f.label, max: 12 });
    // kept: a chart of the field's levels over the studies kept, counted as the summary counts them
    spec = { kind: 'chart', title: `${f.label}${kept.size < ctx.total ? `, ${plural(kept.size, 'study', 'studies')}` : ''}`, query: { from: 'studies', groupBy: [f.label], aggregate: ['count'], ...where }, chart: { type: type === 'pie' ? 'pie' : 'bar', x: f.label } };
  }
  if (!svg && !html) return kit.empty(filters, 'Nothing to draw for these studies');
  return kit.panel(kit.tools(filters), html ? `<div class="mk-fig"><div class="mk-fig-cap"><span class="mk-fig-name">${esc(title)}</span><span class="mk-fig-count">${esc(note)}</span></div>${html}</div>` : figure(title, note, svg),
    { keep: spec ? { how: 'output', spec } : null, primary: kit.primary('Add to Tables and figures', !!spec) });
}
