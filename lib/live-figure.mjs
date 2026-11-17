// A figure of a manuscript drawn from the Lykos chart its caption names (plan W11, W4): which output a figure's place stands for, its
// definition, its rendered model (once per output and revision of the research inputs), and the chart drawn into a page box. The Manuscript
// reader draws it on screen (views/manuscript-reader.mjs); the Journal view draws it at the journal's figure size on the style's page
// (views/journal-preview.mjs), where the file's picture stood before.
import { store$get as get, store$getIndexVersion as getIndexVersion } from "../boot.mjs";
import { outputById, currentSpec } from './output-spec.mjs';
import { renderOutput, chartSvg, chartParts } from './output-render.mjs';
import { figureTokens } from './figure-style.mjs';
import { lib_html$sanitizeSvg as sanitizeSvg } from "../boot.mjs";

/** The output's definition: the project's own, or the one the review's tools saved beside it (.lykos/mcp-outputs.json, `src.sidecar`). */
export function specOf(src, id) {
  const own = outputById(get(), id), spec = own && currentSpec(own);
  if (spec) return spec;
  return (src?.sidecar?.outputs || []).find(o => o.id === id)?.versions?.at(-1)?.spec || null;
}

/** The Lykos chart a figure's place ("Figure 2") names, in a read manuscript `{ stale, src }`: { id, spec, title }, or null when the figure is a picture of the file only (`flow: true`, `spec: null` for the study-selection flow). Nothing is rendered here. */
export function liveSpecOf({ stale, src }, place) {
  const o = stale?.outputs?.get(place);
  // the app's own flow diagram (lib/figure-places.mjs): no saved definition, drawn from the review's counts
  if (o?.flow) return { id: o.id, flow: true, spec: null, title: o.title || '' };
  const spec = o && specOf(src, o.id);
  return spec && spec.kind === 'chart' && spec.chart ? { id: o.id, spec, title: o.title || '' } : null;
}

const models = new Map();
/** An output's rendered model, once per output and revision of the research inputs (the store's index version), not per draw. */
export function liveModelOf(id, spec) {
  const key = `${id}:${getIndexVersion()}`;
  if (!models.has(key)) { if (models.size > 24) models.clear(); models.set(key, renderOutput(get(), spec)); }
  return models.get(key);
}

const appModels = new Map();
const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * The model the App view draws: `liveModelOf`, and a row whose study column ("Kawabori 2021" of a dataset) names exactly one paper of the
 * project given the paper's id as its record, so a press on it opens that study as a row of an evidence table does. A label that fits two
 * papers or none leaves the row as it was. The printed figure (chartForBox) and the Journal view are drawn from `liveModelOf` and are not changed.
 */
export function appModelOf(id, spec, papers = []) {
  const m = liveModelOf(id, spec), key = `${id}:${getIndexVersion()}:${papers.length}`;
  if (appModels.has(key)) return appModels.get(key);
  const col = m.result.columns.findIndex(c => c.id === 'study'), refs = m.result.refs || [];
  let out = m;
  if (col >= 0 && m.result.rows.some((_, i) => !refs[i]?.length)) {
    const by = new Map();
    for (const p of papers) { const k = norm(p.label); if (k) by.set(k, by.has(k) ? null : p.id); }
    const next = m.result.rows.map((row, i) => (refs[i]?.length ? refs[i] : by.get(norm(row[col])) ? [by.get(norm(row[col]))] : (refs[i] || [])));
    out = { ...m, result: { ...m.result, refs: next } };
  }
  if (appModels.size > 24) appModels.clear();
  appModels.set(key, out);
  return out;
}

/**
 * The chart drawn for a printed page: `box` { width, height } in CSS px (96 to the inch) is the figure's page box. It is drawn as the house
 * export draws it (print colours, whatever the app's theme; rows and type made smaller until it fits the height), without the output's
 * own source line, since the manuscript's legend says what the figure is. With a `journal` (lib/journal-charts.mjs journalCharts of the
 * page's journal style) it is drawn as that journal draws a chart, and a chart that journal carries over pages in place of setting it
 * smaller (lib/output-render.mjs chartParts) comes in parts: `whole` is the height a page leaves a part that stands without the legend
 * (default the box's), `place` the figure's name ("Figure 2") for the words that say it goes on. Answers { svg, m } (the rendered output
 * `m` for the marks) and, when the chart takes more than one page, `parts` (the SVG of each, `svg` the last, which stands in the box
 * with the legend), or null when the output has no rows to draw.
 */
export function chartForBox(live, box, journal = null, { whole = null, place = '' } = {}) {
  let m;
  try { m = liveModelOf(live.id, live.spec); } catch { return null; }
  if (!m?.result?.rows?.length) return null;
  const inch = 96, fitted = { ...m, spec: { ...m.spec, chart: { ...m.spec.chart, widthIn: box.width / inch, heightIn: box.height / inch, footer: false } } };
  try {
    const opts = { width: box.width, style: figureTokens(null, { medium: 'export' }), journal };
    if (!journal) return { svg: sanitizeSvg(chartSvg(fitted, opts)), m };
    const parts = chartParts(fitted, { ...opts, heightIn: Math.max(whole ?? 0, box.height) / inch, lastIn: box.height / inch, place }).map(sanitizeSvg);
    return parts.length > 1 ? { svg: parts.at(-1), parts, m } : { svg: parts[0], m };
  } catch { return null; }
}
