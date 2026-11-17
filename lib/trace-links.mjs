// Where a table or figure comes from, and what a dataset feeds: the links Tables and figures and Datasets draw between each other
// (Findability review, 12 Nov 2026, findings 2, 3 and 5). Pure: the project state in, plain facts out; the views make the links.
import { lib_datasets$findDataset as findDataset, lib_datasets$datasets as datasets } from "../boot.mjs";
import { labelInName, isEarlier } from './paper-items.mjs';
import { currentSpec } from './output-spec.mjs';
import { namesInSource } from './analysis-headlines.mjs';

/** The dataset an output reads (a spec drawn `from: 'dataset'`, by id or by name), or null. */
export const datasetOfSpec = (s, spec) => (spec?.query?.from === 'dataset' ? findDataset(spec.query.dataset, s) : null);

/** The analysis run folder a dataset records as its source ("Analysis/Results/2026-11-12 (Lykos)/results.md, Same-instrument pools; …"), or null. */
const RUN_FILE = /^((?:[^/\s][^/]*\/)*?Analysis\/Results\/([^/]+)\/[^/,;]+?\.(?:md|csv|xlsx|json|txt))(?=$|[\s,;(])/;
export function runOfDataset(d) {
  const m = RUN_FILE.exec(String(d?.source?.file || '').trim());
  return m ? { path: m[1], name: m[2], earlier: isEarlier(m[1]) } : null;
}

/** Whether a dataset was read from a superseded folder (Old versions, Archive, …): listed after the current ones. */
export const isSuperseded = d => !!d?.source?.file && isEarlier(String(d.source.file).split(/[,;(]/)[0].trim());

/**
 * The place a saved output states for itself: the build's map of the manuscript (`map[id].place`), else the label its title begins with
 * ("eTable 9. Serious adverse events …"). An id is not read: Sham's ids are older than its titles (three begin `figure3-`). `{ label, place, kind, n }` or null.
 */
export function placeOfOutput(o, map = null) {
  const spec = currentSpec(o) || {}, id = o?.id || '';
  const built = map?.[id]?.place ? labelInName(map[id].place) : null;
  const found = built || labelInName(spec.title);
  return found ? { label: found.label, place: found.supp ? 'supplement' : 'main', kind: found.kind, n: found.n } : null;
}

/** The tables and figures that read a dataset: `[{ id, title, kind }]`, in the order the outputs are kept. */
export function outputsUsing(s, datasetId) {
  const out = [];
  for (const o of s.outputs || []) {
    const spec = currentSpec(o);
    if (spec && datasetOfSpec(s, spec)?.id === datasetId) out.push({ id: o.id, title: spec.title, kind: spec.kind === 'chart' ? 'figure' : 'table' });
  }
  return out;
}

/** Datasets in the order the list shows them: the current ones, then those read from a superseded folder, each in the order they are kept. */
export function datasetGroups(s) {
  const all = datasets(s);
  return { current: all.filter(d => !isSuperseded(d)), earlier: all.filter(isSuperseded) };
}

/**
 * The saved tables and figures made from a registered run (Findability review, item 6): those whose dataset records this run's results file,
 * under each analysis the dataset's source names, the rest of them in `other`. `{ bySection: { [name]: [{ id, title, kind }] }, other: [...] }`;
 * an output stands once under an analysis, and once in `other` when no dataset of it names one.
 */
export function outputsOfRun(s, runFile, names) {
  const bySection = {}, named = new Set();
  const stand = (list, o) => { if (!list.some(x => x.id === o.id)) list.push(o); };
  for (const d of datasets(s)) {
    if (runOfDataset(d)?.path !== runFile) continue;
    const used = outputsUsing(s, d.id), at = namesInSource(String(d.source?.file || '').slice(runFile.length), names);
    for (const o of used) { for (const n of at) stand(bySection[n] ||= [], o); if (at.length) named.add(o.id); }
  }
  const other = [];
  for (const d of datasets(s)) if (runOfDataset(d)?.path === runFile) for (const o of outputsUsing(s, d.id)) if (!named.has(o.id)) stand(other, o);
  return { bySection, other };
}
