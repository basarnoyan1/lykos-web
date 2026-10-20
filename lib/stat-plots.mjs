// Diagnostic and sensitivity figures drawn here, in JavaScript, from a result's numbers (no R drawing). They are the house
// drawings of lib/stat-plots-house.mjs (FIGURE-STYLE §2): minimal L-shaped axes, neutral ink and one grey, state carried by
// weight, fill and dash, never by hue. Every mark that stands for a study has a <title>, which the figure panel turns into the
// pointer readout. `style` is figureTokens of lib/figure-style.mjs for the medium; without one the figure is the print copy
// (the export set). An input that cannot be drawn answers a short note in the figure, never NaN coordinates.
import { figureTokens } from './figure-style.mjs';
import { houseSelection, houseRadial, houseLabbe, houseGosh, houseOutlier, houseDiagnostic, houseLeaveOneOut, houseDoi, housePrediction } from './stat-plots-house.mjs';

const styled = o => (o?.style ? o : { ...o, style: figureTokens(null, { medium: 'export' }) });

/** The selection functions of the fitted selection models, w(p) against the one-sided p-value. */
export const selectionFunctionSvg = (models, opts = {}) => houseSelection(models, styled(opts));
/** Galbraith (radial) plot: standardised effect against precision, the pooled line through the origin with its ±2 band. */
export const radialSvg = o => houseRadial(styled(o));
/** L'Abbé plot: control risk against treated risk, with the line of no effect and the pooled effect's line. */
export const labbeSvg = o => houseLabbe(styled(o));
/** A two-dimensional histogram of the leave-some-out fits (GOSH): pooled estimate against I². */
export const goshSvg = o => houseGosh(styled(o));
/** Study intervals against the pooled interval: a study whose interval lies wholly outside it is drawn heavier (the confidence-interval outlier rule). */
export const outlierSvg = o => houseOutlier(styled(o));
/** Dot plot of one diagnostic per study with reference lines (studentised residuals, Cook's distance). */
export const diagnosticSvg = o => houseDiagnostic(styled(o));
/** Leave-one-out estimates with the full-data estimate and interval as a band. */
export const leaveOneOutSvg = o => houseLeaveOneOut(styled(o));
/** The Doi plot: the absolute Z-score of each effect against the effect, the LFK index in the corner. */
export const doiSvg = o => houseDoi(styled(o));
/** The distribution of true effects N(μ, τ²) with the confidence interval of the pooled effect, the prediction interval beneath it, and the studies' estimates. */
export const predictionSvg = o => housePrediction(styled(o));

/** The house drawings app/lint-figures.mjs checks: each figure of this module on a small set of studies, one with a long label, and one that cannot be drawn. */
export const __fixture = style => {
  const labels = ['Aldermere 2012', 'Ibarra-Montoya 2019', 'Kowalczyk-Nowak 2016 (extension cohort, long follow-up arm)', 'Singh 2020', 'Tanaka 2018'];
  const yi = [-0.62, -0.31, -0.05, -0.88, -0.4], vi = [0.04, 0.02, 0.06, 0.09, 0.03], mu = -0.42, se = vi.map(Math.sqrt);
  const counts = Array.from({ length: 10 }, (_, i) => Array.from({ length: 12 }, (_, j) => Math.round(40 * Math.exp(-((i - 4) ** 2 + (j - 6) ** 2) / 14))));
  const x = { style, labels, back: Math.exp };
  return [
    { name: 'selectionFunctionSvg', svg: selectionFunctionSvg([{ ok: true, type: 'halfnorm', label: 'Half-normal', p: [0.001, 0.025, 0.25, 0.5, 1], w: [1, 0.8, 0.5, 0.35, 0.3] }, { ok: true, type: 'logistic', label: 'Logistic', p: [0.001, 0.025, 0.25, 0.5, 1], w: [1, 0.9, 0.6, 0.45, 0.4] }], { style, source: ['5 studies'] }) },
    { name: 'radialSvg', svg: radialSvg({ ...x, yi, vi, tau2: 0.02, mu, source: ['5 studies · random-effects'] }) },
    { name: 'labbeSvg', svg: labbeSvg({ style, rows: [[5, 50, 10, 50], [8, 120, 14, 118], [20, 200, 31, 205]], effect: 0.6, measure: 'OR', labels }) },
    { name: 'goshSvg', svg: goshSvg({ style, counts, xrange: [-1, 0], full: { est: -0.42, i2: 38 }, back: Math.exp }) },
    { name: 'outlierSvg', svg: outlierSvg({ ...x, yi, vi, est: mu, lo: mu - 1.96 * 0.1, hi: mu + 1.96 * 0.1, flagged: [false, false, true, true, false], xlabel: 'Risk ratio' }) },
    { name: 'diagnosticSvg', svg: diagnosticSvg({ style, labels, values: [0.4, -1.2, 2.5, -2.2, 0.1], refs: [{ at: -1.96, label: '−1.96' }, { at: 1.96, label: '1.96' }], flagged: [false, false, true, true, false], title: 'Studentised residuals', xlabel: 'Externally studentised residual' }) },
    { name: 'leaveOneOutSvg', svg: leaveOneOutSvg({ ...x, est: yi.map(v => v + 0.03), lo: yi.map((v, i) => v - 1.96 * se[i]), hi: yi.map((v, i) => v + 1.96 * se[i]), full: { est: mu, lo: mu - 0.2, hi: mu + 0.2 }, xlabel: 'Risk ratio without the study' }) },
    { name: 'doiSvg', svg: doiSvg({ ...x, te: [-0.9, -0.62, -0.4, -0.31, -0.05], absZ: [1.6, 0.7, 0, 0.5, 1.2], lfk: 0.5, xlabel: 'Risk ratio' }) },
    { name: 'predictionSvg', svg: predictionSvg({ ...x, est: mu, lo: mu - 0.2, hi: mu + 0.2, piLo: -1.05, piHi: 0.2, tau2: 0.05, yi, xlabel: 'Risk ratio' }) },
    { name: 'notDrawn', svg: outlierSvg({ style, yi: [0, 1], vi: undefined, est: 0, lo: 0, hi: 1, title: 'Confidence-interval outlier rule' }) },
  ];
};
