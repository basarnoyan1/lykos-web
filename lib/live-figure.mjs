// A figure of a manuscript drawn from the Lykos chart its caption names (plan W11, W4): which output a figure's place stands for, its
// definition, its rendered model (once per output and revision of the research inputs), and the chart drawn into a page box. The Manuscript
// reader draws it on screen (views/manuscript-reader.mjs); the Journal view draws it at the journal's figure size on the style's page
// (views/journal-preview.mjs), where the file's picture stood before.
import { store$get as get, store$getIndexVersion as getIndexVersion } from "../boot.mjs";
import { outputById, currentSpec } from './output-spec.mjs';
import { renderOutput, chartSvg } from './output-render.mjs';
import { figureTokens } from './figure-style.mjs';
import { lib_html$sanitizeSvg as sanitizeSvg } from "../boot.mjs";

/** The output's definition: the project's own, or the one the review's tools saved beside it (.lykos/mcp-outputs.json, `src.sidecar`). */
export function specOf(src, id) {
  const own = outputById(get(), id), spec = own && currentSpec(own);
  if (spec) return spec;
  return (src?.sidecar?.outputs || []).find(o => o.id === id)?.versions?.at(-1)?.spec || null;
}

/** The Lykos chart a figure's place ("Figure 2") names, in a read manuscript `{ stale, src }`: { id, spec, title }, or null when the figure is a picture of the file only. Nothing is rendered here. */
export function liveSpecOf({ stale, src }, place) {
  const o = stale?.outputs?.get(place), spec = o && specOf(src, o.id);
  return spec && spec.kind === 'chart' && spec.chart ? { id: o.id, spec, title: o.title || '' } : null;
}

const models = new Map();
/** An output's rendered model, once per output and revision of the research inputs (the store's index version), not per draw. */
export function liveModelOf(id, spec) {
  const key = `${id}:${getIndexVersion()}`;
  if (!models.has(key)) { if (models.size > 24) models.clear(); models.set(key, renderOutput(get(), spec)); }
  return models.get(key);
}

/**
 * The chart drawn for a printed page: `box` { width, height } in CSS px (96 to the inch) is the figure's page box. It is drawn as the house
 * export draws it (print colours, whatever the app's theme; rows and type made smaller until it fits the height), without the output's
 * own source line, since the manuscript's legend says what the figure is. Answers { svg, m } (the rendered output `m` for the marks), or
 * null when the output has no rows to draw.
 */
export function chartForBox(live, box) {
  let m;
  try { m = liveModelOf(live.id, live.spec); } catch { return null; }
  if (!m?.result?.rows?.length) return null;
  const inch = 96, fitted = { ...m, spec: { ...m.spec, chart: { ...m.spec.chart, widthIn: box.width / inch, heightIn: box.height / inch, footer: false } } };
  try { return { svg: sanitizeSvg(chartSvg(fitted, { width: box.width, style: figureTokens(null, { medium: 'export' }) })), m }; } catch { return null; }
}
