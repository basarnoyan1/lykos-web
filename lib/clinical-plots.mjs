// Figures for the clinical calculators (lib/clinical-epi.mjs): ROC curve, Fagan nomogram, calibration plot, decision curve and
// Bland–Altman plot, as self-contained SVG strings. They are the house drawings of lib/clinical-plots-house.mjs (FIGURE-STYLE §2):
// one font, ink and one grey, marks told apart by weight and dash rather than hue, so a downloaded file is a publication figure
// and on screen the c-* classes take the app's theme. `opts.style` is figureTokens of lib/figure-style.mjs for the medium;
// without one the figure is the print copy (the export set). Every function is pure: data in, string out.
import { figureTokens } from './figure-style.mjs';
import { houseRoc, houseFagan, houseCalibration, houseDecisionCurve, houseBlandAltman } from './clinical-plots-house.mjs';

const styled = opts => (opts?.style ? opts : { ...opts, style: figureTokens(null, { medium: 'export' }) });

/**
 * ROC curve(s): 1 − specificity against sensitivity, one marker per threshold (data-threshold), the chance diagonal dashed.
 * `curves` is a roc() result or [{ label, result }]; `opts.cutoff` an optimalCutoff() result to ring.
 */
export const rocSvg = (curves, opts = {}) => houseRoc(curves, styled(opts));

/** Fagan nomogram: pre-test probability (left), likelihood ratio (middle), post-test probability (right); the positive-test line solid, the negative-test line dashed. */
export const faganSvg = (pretest, lrPos, lrNeg, opts = {}) => houseFagan(pretest, lrPos, lrNeg, styled(opts));

/** Calibration plot from a calibration() result: grouped observed proportions with Wilson whiskers against mean predicted risk, the ideal line dashed. */
export const calibrationSvg = (cal, opts = {}) => houseCalibration(cal, styled(opts));

/** Decision curve from a decisionCurve() result: net benefit of the model, treat all (dashed) and treat none (the zero line), against the threshold probability. */
export const decisionCurveSvg = (dc, opts = {}) => houseDecisionCurve(dc, styled(opts));

/** Bland–Altman plot: difference against mean of two measurements, the bias as a solid line and the limits of agreement dashed. points: [{ mean, diff }] or [[mean, diff]]; loa: [lo, hi] or { lo, hi }. */
export const blandAltmanSvg = (points, bias, loa, opts = {}) => houseBlandAltman(points, bias, loa, styled(opts));

/** The house drawings app/lint-figures.mjs checks: each figure of this module on small examples. */
export const __fixture = style => {
  const curve = k => { const pts = [{ threshold: Infinity, fpr: 0, se: 0, sp: 1 }, ...[0.95, 0.8, 0.6, 0.4, 0.2, 0.05].map((th, i) => ({ threshold: th, fpr: Math.min(1, (i + 1) / 7 * (k ? 1.3 : 1)), se: Math.min(1, (i + 1) / 6 * (k ? 1.0 : 1.2)), sp: 1 - (i + 1) / 7 })), { threshold: -Infinity, fpr: 1, se: 1, sp: 0 }]; return { points: pts, auc: { est: k ? 0.71 : 0.83 } }; };
  const groups = Array.from({ length: 5 }, (_, i) => { const pr = 0.1 + 0.18 * i, ob = Math.min(1, pr + (i % 2 ? 0.07 : -0.05)); return { group: i + 1, n: 20, predicted: pr, observed: ob, lo: Math.max(0, ob - 0.15), hi: Math.min(1, ob + 0.15) }; });
  const rows = Array.from({ length: 19 }, (_, i) => { const th = 0.05 + i * 0.05; return { threshold: th, model: 0.2 - th * 0.25, all: 0.3 - th * 0.55 + 0.1 * th * th }; });
  return [
    { name: 'rocSvg', svg: rocSvg(curve(0), { style, cutoff: { cutoff: true, se: 0.833, sp: 0.714, threshold: 0.4 }, source: ['12 patients'] }) },
    { name: 'rocSvgTwo', svg: rocSvg([{ label: 'Clinical score', result: curve(0) }, { label: 'Biomarker panel with a long name', result: curve(1) }], { style }) },
    { name: 'faganSvg', svg: faganSvg(0.2, 4.5, 0.125, { style }) },
    { name: 'calibrationSvg', svg: calibrationSvg({ groups, slope: { est: 0.92 }, intercept: { est: 0.03 }, oe: { est: 1.04 }, brier: 0.162 }, { style }) },
    { name: 'decisionCurveSvg', svg: decisionCurveSvg({ prevalence: 0.3, rows }, { style }) },
    { name: 'blandAltmanSvg', svg: blandAltmanSvg([[10, 0.5], [12, -0.3], [15, 1.1], [18, 0.2], [21, -0.9], [24, 0.7]], 0.22, [-1.3, 1.74], { style }) },
    { name: 'notDrawn', svg: blandAltmanSvg([], 0, [0, 0], { style }) },
  ];
};
