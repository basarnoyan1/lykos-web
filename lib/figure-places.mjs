// Which Lykos figure a manuscript figure is, for the Manuscript page's App view (views/manuscript-reader.mjs), so the figure is drawn live and
// answers the pointer where it can (13 Nov 2026, the owner: "in the app view always, if possible, use app-style interactable figures"). Pure.
//
// The build's map of the manuscript decides first (lib/number-sources.mjs manuscriptOutputs: `outputs`). A place it does not name is looked for
// among the saved charts whose title states that place ("Figure 3. Sham SMCR by subgroup", lib/trace-links.mjs placeOfOutput), then, for the
// study-selection flow, in the app's own PRISMA flow diagram (a review project's built-in output). Whenever two candidates fit, the place is
// left as it was, so the file's picture stands: a guess would draw the wrong figure under a legend.
import { placeOfOutput } from './trace-links.mjs';
import { currentSpec } from './output-spec.mjs';
import { typeInText } from './paper-items.mjs';
import { boxDetail } from './prisma-records.mjs';

export const FLOW_ID = 'builtin:prisma';

/**
 * `outputs` is the map of places the build gave (place -> { id, title, stale, staleText }); `saved` the project's saved outputs; `captions` the
 * figure legends of the file, `[{ place: 'Figure 1', text }]`; `flow` whether the project has the built-in flow diagram and only one review
 * to draw it for. Answers a new Map: the given entries, and for each figure place found by the rules above `{ id, title, stale: false,
 * staleText: '', by: 'title' | 'flow' }` (the flow's has `flow: true`).
 */
export function figurePlaces({ outputs = new Map(), saved = [], captions = [], flow = false } = {}) {
  const out = new Map(outputs), taken = new Set([...outputs.values()].map(o => o.id));
  const byLabel = new Map();
  for (const o of saved) {
    if (taken.has(o?.id)) continue;
    const spec = currentSpec(o), at = spec?.kind === 'chart' && spec.chart ? placeOfOutput(o) : null;
    if (!at || at.kind !== 'figure') continue;
    (byLabel.get(at.label) || byLabel.set(at.label, []).get(at.label)).push({ id: o.id, title: spec.title || o.id });
  }
  const figures = captions.filter(c => /Figure$/i.test(c.place.split(' ')[0]));
  for (const { place } of figures) {
    if (out.has(place)) continue;
    const found = byLabel.get(place);
    if (found?.length === 1) out.set(place, { ...found[0], place, stale: false, staleText: '', by: 'title' });
  }
  // the flow: the one legend that says it is the study selection, when no saved chart took it and no other legend says so too
  if (flow && ![...out.values()].some(o => o.flow)) {
    const flows = figures.filter(c => typeInText(c.text, 'figure') === 'flow');
    if (flows.length === 1 && !out.has(flows[0].place)) out.set(flows[0].place, { id: FLOW_ID, title: 'PRISMA flow diagram', place: flows[0].place, stale: false, staleText: '', by: 'flow', flow: true });
  }
  return out;
}

/**
 * What a flow diagram's box says and opens (lib/chart-interact.mjs): `tip`, its heading and counts ("Records screened: 8", or one count per
 * line of a box that draws several: "Records removed before screening: 3 duplicates, 0 marked ineligible"); `ids`, the records its counts are
 * made of, each once, and `label` for them ("Records screened: 8"). `ids` is empty for a box whose counts were entered by hand or that keeps
 * no records, which opens Reporting.
 */
export function flowBoxMarks(s, boxId) {
  const d = boxDetail(s, boxId);
  if (!d) return { tip: '', ids: [], label: '' };
  const ids = [...new Set(d.parts.flatMap(p => (p.manual ? [] : p.records).map(r => r.id)))];
  const counts = d.parts.filter(p => p.count != null);
  const said = counts.length === 1 ? String(counts[0].count) : counts.map(p => `${p.count} ${String(p.label).toLowerCase()}`).join(', ');
  return { tip: said ? `${d.label}: ${said}` : `${d.label}: no count`, ids, label: `${d.label}: ${ids.length}` };
}
