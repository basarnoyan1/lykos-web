// The figure of a dataset analysis's result (lib/dataset-analysis.mjs), on its own so that a page that only draws kept results (Tables and
// figures, the package, the manuscript: lib/app-items.mjs) does not load the statistics. Always the house drawing (FIGURE-STYLE §2).
import { rocSvg, blandAltmanSvg, calibrationSvg, decisionCurveSvg } from './clinical-plots.mjs';
import { dotSvg, forestSvg } from './output-charts.mjs';
import { figureTokens } from './figure-style.mjs';
import { kmFigure } from './survival-fig.mjs';
import { houseXy } from './clinical-plots-house.mjs';

const styled = opts => (opts?.style ? opts : { ...opts, style: figureTokens(null, { medium: 'export' }) });

/** Points on two numeric axes with an optional straight line: a scatter plot or a normal Q–Q plot (the house drawing; `opts.style` is figureTokens, the print copy without one). */
export function xySvg(plot, opts = {}) {
  return houseXy(plot, styled(opts));
}

/**
 * The figure for a result, or '' when it has none: always the house drawing. `opts.style` (figureTokens of lib/figure-style.mjs)
 * names the medium (the print copy without one), `opts.source` adds the source lines under it.
 */
export function analysisSvg(plot, opts = {}) {
  if (!plot) return '';
  const o = { style: styled(opts).style, source: opts.source, width: opts.width };
  if (plot.kind === 'km') return kmFigure(plot.km, { ...o, title: plot.title, xLabel: plot.xLabel, ci: !!plot.ci, atRiskTimes: plot.atRiskTimes, xMax: plot.xMax, p: plot.p });
  if (plot.kind === 'qq' || plot.kind === 'scatter') return plot.points?.length ? xySvg(plot, o) : '';
  if (plot.kind === 'strip') return dotSvg(plot.groups.flatMap(g => g.values.map(v => ({ label: g.name, group: null, value: v }))), { title: plot.title, xLabel: plot.xLabel, ...o });
  if (plot.kind === 'roc') return rocSvg({ points: plot.points.map(p => ({ ...p, threshold: p.threshold ?? Infinity })), auc: { est: plot.auc } }, { title: plot.title, cutoff: plot.cutoff ? { cutoff: true, ...plot.cutoff } : null, ...o });
  if (plot.kind === 'roc-compare') return rocSvg(plot.curves.map(c => ({ ...c, result: { ...c.result, points: c.result.points.map(p => ({ ...p, threshold: p.threshold ?? Infinity })) } })), { title: plot.title, ...o });
  if (plot.kind === 'calibration') return calibrationSvg(plot.calibration, { title: plot.title, note: plot.note || 'Grouped observed risks with Wilson intervals; supplied predictions.', ...o });
  if (plot.kind === 'decision-curve') return decisionCurveSvg(plot.decisionCurve, { title: plot.title, ...o });
  if (plot.kind === 'bland-altman') return blandAltmanSvg(plot.points, plot.bias, plot.loa, { title: plot.title, yLabel: plot.yLabel, ...o });
  if (plot.kind === 'forest') return forestSvg(plot.rows, { title: plot.title, xLabel: plot.xLabel, log: plot.log, ...o });
  return '';
}
