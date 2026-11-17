// What ⌘K finds that has a name (Findability review, 12 Nov 2026, finding 1): saved and built-in tables and figures, datasets, the analyses
// of a run, the manuscript's versions and the folder's key files. Each builder is pure: the project state (or a list of file paths) in,
// palette rows out (lib/palette.mjs: { label, meta, keys, group, icon, rank, boost, run }). `open` carries the actions, so a row opens the
// thing it names; app.mjs wires them and loads this module the first time the palette is asked.
import { currentSpec, builtinOutputs } from './output-spec.mjs';
import { CHART_WORDS } from './output-describe.mjs';
import { outputFacts } from './output-places.mjs';

// A match on a name's kind or place ("forest", "eFigure 5") stands above a record whose long title merely holds the word.
const BOOST = 14, KEY = 26;   // a role's file stands above a plain file whose name starts with the word
const OLD = /(^|\/)Old versions?\//i;
/** Whether a path is a superseded copy: a current file of the same name ranks over it. */
export const isArchived = rel => OLD.test(String(rel || ''));

/** Saved and built-in tables and figures: title, id, type ("Forest plot", "Table") and the place the id or title gives; `places` maps an id to the build's place. */
export function outputItems(s, open, places = {}) {
  const out = [];
  for (const o of [...(s.outputs || []), ...builtinOutputs(s)]) {
    const spec = currentSpec(o); if (!spec) continue;
    const f = outputFacts(o, spec, places[o.id] || '');
    const type = spec.kind === 'chart' ? CHART_WORDS[spec.chart?.type] || 'Chart' : 'Table';
    const place = f.place || f.strong[0] || f.weak[0] || '';
    out.push({ label: f.title, meta: [type, place].filter(Boolean).join(', '), keys: [o.id, type, f.kind, place, o.builtin ? 'built in' : ''].filter(Boolean).join(' '),
      group: f.kind === 'figure' ? 'Figure' : 'Table', icon: 'outputs', rank: 2, boost: BOOST, run: () => open.output(o.id) });
  }
  return out;
}

/** Datasets by name and column names. A dataset read from `Old versions/` ranks below the rest. */
export function datasetItems(s, open) {
  return (s.datasets || []).map(d => {
    const old = isArchived(d.source?.file);
    return { label: d.name || d.id, meta: [`${(d.rows || []).length.toLocaleString('en-US')} rows`, old ? 'Old version' : ''].filter(Boolean).join(', '),
      keys: (d.columns || []).map(c => c.label || c.id).join(' '), group: 'Dataset', icon: 'dataset', rank: old ? 5 : 2, run: () => open.dataset(d.id) };
  });
}

/**
 * The analyses by name: the sections of the registered run (`run.sections`, one entry in Analysis) and the app's own analyses
 * (`rows`: the Analysis list's rows, { id, title, meta }, group heads and calculators left out).
 */
export function analysisItems({ run = null, rows = [] } = {}, open) {
  const out = [];
  for (const name of run?.sections || []) out.push({ label: name, meta: 'Registered run', keys: 'analysis registered run', group: 'Analysis', icon: 'analysis', rank: 2, boost: BOOST, run: () => open.analysis('registered') });
  for (const r of rows) {
    if (r.group || !r.title || r.id === 'registered') continue;
    out.push({ label: r.title, meta: r.meta || '', keys: 'analysis', group: 'Analysis', icon: 'analysis', rank: 2, boost: BOOST, run: () => open.analysis(r.id) });
  }
  return out;
}

// ---- the folder's files by role ------------------------------------------------------------------------------------------------------
const ROLES = [
  { role: 'Manuscript', test: n => /manuscript|\bdraft\b/i.test(n) && /\.(docx?|pdf|odt)$/i.test(n), words: 'manuscript paper draft' },
  { role: 'Results', test: n => /^results?\b[^/]*\.(md|docx?|txt)$/i.test(n), words: 'results analysis run' },
  { role: 'Evidence table', test: n => /evidence[ _-]?table|extraction[^/]*\.(xlsx|csv)$/i.test(n), words: 'evidence table extraction' },
  { role: 'Protocol', test: n => /protocol/i.test(n) && /\.(docx?|pdf|md)$/i.test(n), words: 'protocol' },
  { role: 'Screening sheet', test: n => /screening/i.test(n) && /\.(xlsx|csv)$/i.test(n), words: 'screening sheet' },
];
/** The version a file name states ("…v8.8.docx" -> [8, 8]), [] when it states none. */
export const versionOf = name => { const m = /[\s_-]v(\d+(?:\.\d+)*)/i.exec(String(name || '')); return m ? m[1].split('.').map(Number) : []; };
// the newer file: the higher version in its name; at one version a manuscript's Word file over its PDF, then the shallower path (a Preview copy sits deeper), then the shorter name
const newer = (a, b, wordFirst = false) => {
  const x = versionOf(a.split('/').pop()), y = versionOf(b.split('/').pop());
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  const word = f => (/\.docx?$/i.test(f) ? 0 : 1);
  return wordFirst && word(a) !== word(b) ? word(a) < word(b) : a.split('/').length !== b.split('/').length ? a.split('/').length < b.split('/').length : a.length < b.length;
};

/**
 * `rels` are the folder's paths. Every manuscript file is a version (the newest by the number in its name first in the rank, old ones last),
 * and each other role names its newest current file.
 */
export function keyFileItems(rels, open) {
  const out = [];
  for (const { role, test, words } of ROLES) {
    const hits = rels.filter(rel => test(rel.split('/').pop()));
    if (!hits.length) continue;
    const current = hits.filter(rel => !isArchived(rel));
    let top = null;
    for (const rel of current) if (!top || newer(rel, top, role === 'Manuscript')) top = rel;
    if (role === 'Manuscript') {
      for (const rel of hits) {
        const name = rel.split('/').pop(), v = versionOf(name).join('.'), old = isArchived(rel);
        out.push({ label: name, meta: [rel === top ? 'Newest manuscript' : 'Manuscript version', v && `v${v}`, old ? 'Old version' : ''].filter(Boolean).join(', '), keys: `${words} ${rel}`,
          group: 'Manuscript', icon: 'file', rank: old ? 5 : rel === top ? 2 : 3, boost: rel === top ? KEY : 0, rel, run: () => open.file(rel) });
      }
    } else if (top) {
      out.push({ label: top.split('/').pop(), meta: role, keys: `${words} ${top}`, group: 'Key file', icon: 'file', rank: 2, boost: KEY, rel: top, run: () => open.file(top) });
    }
  }
  return out;
}

/** Plain files: a file under `Old versions/` ranks below a current file of the same name. */
export function fileItems(rels, open) {
  return rels.map(rel => {
    const old = isArchived(rel);
    return { label: rel.split('/').pop(), meta: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', keys: rel, group: 'File', icon: 'file', rank: old ? 5 : 4, run: () => open.file(rel) };
  });
}

// ---- what app.mjs registers (it passes its own get, viewOf, go, explorer and subtitle) ------------------------------------------------
const actions = ({ viewOf, go }) => ({
  output: async id => { (await viewOf('outputs')).openOutput(id); go('outputs'); },
  dataset: async id => { (await viewOf('datasets')).select(id); go('datasets'); },
  analysis: async id => { (await viewOf('analysis')).select(id); go('analysis'); },
});
/** The files and key files, the tables and figures and the datasets. */
export async function fixed(deps) {
  const open = actions(deps), s = deps.get(), out = [...outputItems(s, open), ...datasetItems(s, open)];
  try {
    const tree = await deps.explorer.ensure(), rels = await tree.allFiles(), file = { file: rel => tree.openEntry(rel) };
    const keyed = keyFileItems(rels, file), named = new Set(keyed.map(k => k.rel));   // a file with a role is listed once, under its role
    out.push(...fileItems(rels.filter(rel => !named.has(rel)), file), ...keyed);
  } catch (err) { deps.subtitle.textContent = err.message; }
  return out;
}
/** The analyses: the registered run's sections and the Analysis page's own rows (its module loads here). */
export async function analyses(deps) {
  const [view, reg] = await Promise.all([deps.viewOf('analysis'), import('../views/analysis-registered.mjs')]);
  let rows = []; try { rows = view.list.items(deps.get()); } catch { /* the page's rows are not at hand: the registered run still answers */ }
  return analysisItems({ run: reg.registeredAnalysis(deps.get()), rows }, actions(deps));
}
