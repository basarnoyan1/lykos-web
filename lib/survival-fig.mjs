// Kaplan–Meier and swimmer figures, drawn here as self-contained SVG.
//
// R draws a Kaplan–Meier curve too (survivalPlot), but it cannot put a number-at-risk table under the axis aligned with it, and it
// costs an engine start. Like the appraisal figures and the PRISMA diagram these are computed from numbers already in hand (the
// step function kmSummary returns, or the patients themselves), so the picture is instant, runs anywhere and is the same file on
// screen, in the submission bundle and in Word. The drawings are the house ones of lib/survival-house.mjs (FIGURE-STYLE §2):
// groups told apart by dash, weight and grey and named at the end of their curve, never by hue. `style` is figureTokens of
// lib/figure-style.mjs for the medium; without one the figure is the print copy (the export set). The same input gives the same bytes.
import { pValue } from './describe.mjs';
import { figureTokens } from './figure-style.mjs';
import { houseKm, houseSwimmer } from './survival-house.mjs';

const styled = opts => (opts?.style ? opts : { ...opts, style: figureTokens(null, { medium: 'export' }) });
const logRank = o => o.pText ?? (o.p != null ? `Log-rank p ${pValue(o.p).startsWith('<') ? '< 0.001' : '= ' + pValue(o.p)}` : '');

/** Tick values from 0 up to a round maximum at or above `max`, about `target` of them. */
export function niceTicks(max, target = 8) {
  if (!(max > 0)) return { ticks: [0, 1], max: 1 };
  const raw = max / Math.max(1, target), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const n = Math.ceil(max / step - 1e-9), ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
  return { ticks, max: ticks[ticks.length - 1] };
}

/** Number at risk at time t from a group's step function: patients whose follow-up is at least t. */
export function riskAt(group, t) {
  const hit = group.atRisk?.find(a => a.time === t);
  if (hit) return hit.n;
  const s = group.steps.find(x => x.time >= t);
  return s ? s.nRisk : 0;
}

/**
 * A Kaplan–Meier figure from kmSummary's result: `{ svg, boxes, width, height }` (`boxes` is where every string landed).
 *
 * opts: style, source (the foot's lines), title (the figure's <title>), xLabel ("Months"), yLabel, percent (axis in %), ci (bands),
 * censorMarks (default true), atRisk (default true), atRiskTimes (default the x ticks), xMax, ticks (the x ticks; default round
 * numbers to xMax), width, p (a log-rank p-value) or pText, pairs ([{ a, b, mark, label }]: a bracket with its mark beside the two
 * groups' names), and groups (which of km.by to draw, by name; default all).
 */
export const kmFigureParts = (km, opts = {}) => houseKm(km, styled(opts), { ticksOf: niceTicks, pText: logRank });

export const kmFigure = (km, opts) => kmFigureParts(km, opts).svg;
const stars = p => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');
const pFmt = p => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
/**
 * The figure names the requested comparison; failed stratified tests never fall back silently. `spec.view` adds what the person set for
 * the drawing: the axis end (xMax), the ticks, the times of the number at risk, and pairwise marks ('adjusted', Holm–Šídák, or
 * 'unadjusted' log-rank p): a bracket with stars for each pair under 0.05, the method named in the figure's foot.
 */
export function survivalFigureOptions(tests, spec = {}) {
  const v = spec.view || {}, out = {};
  if (Number(v.xMax) > 0) out.xMax = Number(v.xMax);
  if (v.ticks?.length) out.ticks = v.ticks;
  if (v.riskTimes?.length) out.atRiskTimes = v.riskTimes;
  if (['adjusted', 'unadjusted'].includes(v.marks) && tests?.pairwise?.length) {
    const key = v.marks === 'adjusted' ? 'padj' : 'p';
    out.pairs = tests.pairwise.filter(x => Number.isFinite(x[key]) && x[key] < 0.05).map(x => ({ a: x.a, b: x.b, mark: stars(x[key]), label: pFmt(x[key]) }));
    out.source = [`Pairwise ${tests.pairwiseStratified ? 'stratified ' : ''}log-rank, ${v.marks === 'adjusted' ? 'Holm–Šídák adjusted' : 'unadjusted'}: * p < 0.05, ** p < 0.01, *** p < 0.001${out.pairs.length ? '' : '; no pair below 0.05'}`];
  }
  if (!spec.strata) return { ...out, p: tests?.logrank?.p ?? undefined };
  const p = tests?.stratified?.p;
  return p == null ? out : { ...out, pText: 'Stratified log-rank p ' + (p < .001 ? '< 0.001' : '= ' + p.toFixed(3)) };
}

/**
 * One bar per patient from time zero to the end of follow-up, grouped and sorted by follow-up (longest first). The end is a filled
 * circle for an event and an arrow for follow-up that ended without one; `markers` ({t, kind}) place other things that happened,
 * each kind its own shape, named in the legend.
 *
 * patients: {label, group, time, event, markers?}. opts: style, source, xLabel ("Months"), width, groups (order), showLabels (true).
 */
export const swimmerFigureParts = (patients, opts = {}) => houseSwimmer(patients, styled(opts), { ticksOf: niceTicks });

export const swimmerFigure = (patients, opts) => swimmerFigureParts(patients, opts).svg;

/** The house drawings app/lint-figures.mjs checks: a Kaplan-Meier figure of three groups (one with a long name) and a swimmer plot. */
export const __fixture = style => {
  const group = (name, n, steps) => ({ group: name, n, steps: steps.map(([time, surv, nEvent, nCensor, nRisk]) => ({ time, surv, nEvent, nCensor, nRisk, lo: Math.max(0, surv - 0.1), hi: Math.min(1, surv + 0.1) })) });
  const km = { by: [
    group('Standard care', 60, [[3, 0.93, 4, 0, 56], [6, 0.82, 6, 1, 49], [12, 0.66, 9, 2, 37], [18, 0.52, 6, 3, 25], [24, 0.43, 4, 4, 15], [30, 0.4, 1, 4, 8]]),
    group('Intervention A', 58, [[3, 0.97, 2, 0, 56], [6, 0.9, 4, 1, 52], [12, 0.8, 6, 1, 45], [18, 0.72, 4, 2, 37], [24, 0.66, 3, 3, 28], [30, 0.62, 1, 3, 18]]),
    group('Intervention B combined with a long-acting adjuvant regimen over twelve months', 55, [[3, 0.95, 3, 0, 52], [6, 0.86, 5, 0, 47], [12, 0.7, 8, 2, 37], [18, 0.6, 4, 2, 30], [24, 0.5, 4, 3, 21], [30, 0.47, 1, 3, 12]]),
  ] };
  const people = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'Patient with a very long record label 09'].map((label, i) => ({ label, group: i < 5 ? 'Responders' : 'Non-responders', time: 6 + (i * 7) % 29, event: i % 3 === 0, markers: i % 2 ? [{ t: 3 + i, kind: 'Dose change' }] : [{ t: 4, kind: 'Relapse' }] }));
  return [
    { name: 'kmFigure', svg: kmFigure(km, { style, p: 0.0213, xLabel: 'Months since randomisation', ci: false, xMax: 30, atRiskTimes: [0, 6, 12, 18, 24, 30], source: ['173 patients; log-rank test'] }) },
    { name: 'kmFigurePairs', svg: kmFigure(km, { style, p: 0.0213, ci: false, xMax: 36, ticks: [0, 12, 24, 36], atRiskTimes: [0, 12, 24, 36],
      pairs: [{ a: 'Standard care', b: 'Intervention A', mark: '**' }, { a: 'Standard care', b: km.by[2].group, mark: '*' }, { a: 'Intervention A', b: km.by[2].group, mark: '***' }],
      source: ['Pairwise log-rank, Holm–Šídák adjusted: * p < 0.05, ** p < 0.01, *** p < 0.001'] }) },
    { name: 'kmFigureBands', svg: kmFigure({ by: km.by.slice(0, 2) }, { style, ci: true, percent: true }) },
    { name: 'swimmerFigure', svg: swimmerFigure(people, { style, groups: ['Responders', 'Non-responders'], source: ['9 patients'] }) },
    { name: 'kmFigureEmpty', svg: kmFigure({ by: [] }, { style }) },
  ];
};
