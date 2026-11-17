// Traffic-light and summary figures for any appraisal instrument, drawn here.
//
// robvis draws these, but only for RoB 1/2 and ROBINS-I — it has no notion of a
// JBI checklist — and going through WebR costs tens of seconds for a figure
// that is a grid of coloured circles. Drawing natively is instant and works for
// every instrument, the same trade the PRISMA diagram makes (plan 4.6). A reader
// who wants robvis's own look (a journal that expects it) has it from
// lib/appraisal-robvis.mjs, drawn here too, by template.
// The drawings are the house ones of lib/figure-house-render.mjs (FIGURE-STYLE §2: robvis's palette, glyphs, no rotated heads);
// `opts.style` is figureTokens of lib/figure-style.mjs for the medium, the print copy (the export set) without one.
import { houseTrafficLight, houseSummary } from './figure-house-render.mjs';
import { figureTokens } from './figure-style.mjs';
// robvis's conventions (Cochrane colours, its glyphs, grey-headed grid, boxed summary key) as a second layout, by template (Batch 13 item 3)
export { robvisTrafficLight, robvisSummary, robvisTemplateFor, robvisPlan, robvisLevel, ROBVIS_TEMPLATES, ROBVIS_TEMPLATE_IDS, ROBVIS_COLOURS } from './appraisal-robvis.mjs';

const styled = opts => (opts?.style ? opts : { ...opts, style: figureTokens(null, { medium: 'export' }) });

/** One row per study, one column per item, a mark per judgement. The study column takes the widest wrapped label, so the figure never grows unbounded on one long citation. */
export const trafficLight = (tool, rows, tones, opts = {}) => houseTrafficLight(tool, rows, tones, styled(opts));

/**
 * One stacked bar per item: the share of studies at each judgement level, on a
 * 0–100% axis. With `weights` (study label → weight, as a pooled analysis
 * assigns them) each study counts by its weight rather than as one, as robvis's
 * weighted summary does; studies without a weight are left out of that figure.
 */
export const summaryBars = (tool, rows, tones, opts = {}) => houseSummary(tool, rows, tones, styled(opts));

/**
 * The per-study weights of a pooled analysis, keyed by study label, when the
 * analysis recorded them (`weights`, in percent, in the order of `labels`).
 * Null when it did not, so a figure is never weighted by a guess.
 */
export function analysisWeights(a) {
  const labels = a?.labels, raw = a?.weights;
  const ws = Array.isArray(raw) ? raw : Array.isArray(raw?.values) ? raw.values : raw == null ? [] : [raw];
  if (!Array.isArray(labels) || !labels.length || ws.length !== labels.length) return null;
  const m = new Map();
  labels.forEach((l, i) => { const v = Number(ws[i]); if (Number.isFinite(v) && v > 0) m.set(l, v); });
  return m.size ? m : null;
}

/** The house drawings app/lint-figures.mjs checks: a five-domain instrument with every judgement. */
export const __fixture = style => {
  const tool = { name: 'RoB 2', overall: true, judgements: ['Low', 'Some concerns', 'High', 'No information'],
    domains: ['Randomisation process', 'Deviations from intended interventions', 'Missing outcome data', 'Measurement of the outcome', 'Selection of the reported result'].map((label, i) => ({ id: `d${i + 1}`, short: `D${i + 1}`, label })) };
  const tones = { Low: 'good', 'Some concerns': 'unclear', High: 'bad', 'No information': 'none' }, J = tool.judgements;
  const rows = ['Aldermere 2012', 'Ibarra-Montoya 2019', 'Kowalczyk-Nowak 2016'].map((label, i) => ({ label, values: Object.fromEntries([...tool.domains.map(d => d.id), 'overall'].map((id, k) => [id, J[(i + k) % 4]])) }));
  return [{ name: 'trafficLight', svg: trafficLight(tool, rows, tones, { style, source: ['3 of 3 studies appraised'] }) },
    { name: 'summaryBars', svg: summaryBars(tool, rows, tones, { style, weights: new Map([['Aldermere 2012', 2], ['Ibarra-Montoya 2019', 1]]) }) }];
};
