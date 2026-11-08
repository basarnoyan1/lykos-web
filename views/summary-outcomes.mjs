// The Data summary's outcomes (plan G3a; owner, 7 Nov 2026: "putting mean, SD, IQR etc as different rows look weird"): one compact table per
// scale, the time points as rows (Baseline, End, Change) and the statistics as columns (n, mean, SD, SE, median and IQR), each cell the
// number of the scale's studies that report the statistic (a derived value counts as reported), the not reported muted beside it; every
// count opens the studies behind it, each study's cells of the statistic on their own lines (each arm's and each time point's). Responders and percent change share one line under the table, and the key line says what the change
// synthesis can pool of the scale (lib/scales.mjs readinessText, the synthesis' own sets). The counts are the outcome store's
// (lib/outcome-store.mjs instrumentCoverage), so the page's own reading of values (the normalise stage) stays free of any not-reported
// vocabulary. The scale is named in full at its first mention (lib/instruments.mjs scaleTitle). Drawn under the Outcomes category by
// views/extraction-summary.mjs, which owns the page and its lists of studies.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink, lib_ui_components$metadataLine as metadataLine } from "../boot.mjs";
import { instrumentOf } from '../lib/instruments.mjs';
import { scaleFacts, scaleTitle, scaleDecision, decisionWords } from '../lib/scale-names.mjs';

/** The table's columns: a statistic, or two read as one (a study counts when it reports either), and its head. */
export const SCALE_COLUMNS = Object.freeze([
  { stats: ['n'], head: 'n', word: 'n' }, { stats: ['mean'], head: 'Mean', word: 'mean' }, { stats: ['sd'], head: 'SD', word: 'SD' },
  { stats: ['se'], head: 'SE', word: 'SE' }, { stats: ['median', 'iqr'], head: 'Median, IQR', word: 'median or IQR' },
  { stats: ['ci', 'range'], head: 'CI, range', word: 'CI or range', optional: true }]);
const LINE_STATS = [['responders', 'Responders'], ['percent_change', 'Percent change']];
const RANK = { reported: 3, derived: 2, nr: 1, empty: 0 };

/** Several statistics of a time point read as one: each study's best state over them, with the cell that holds it and all its cells. */
export function mergeStats(stats) {
  const by = new Map();
  for (const x of stats) for (const state of ['reported', 'derived', 'nr', 'empty']) for (const it of x.studies?.[state] || []) {
    const was = by.get(it.paperId), cells = [...(was?.cells || []), ...(it.cells || [])];
    by.set(it.paperId, !was || RANK[state] > RANK[was.state] ? { state, key: it.key, cells } : { ...was, cells });
  }
  const out = { reported: [], derived: [], nr: [], empty: [] };
  for (const [paperId, x] of by) out[x.state].push({ paperId, key: x.key, cells: x.cells });
  return out;
}
const valueText = v => (!v ? '' : v.availability === 'not_found' ? `NR${v.qualifier ? ` (${v.qualifier})` : ''}` : `${v.reported_value ?? ''}${v.qualifier ? ` (${v.qualifier})` : ''}`);
/**
 * The list a count opens: each study's cells in the states counted, each its own line, named where it is and what it holds
 * ("12 weeks; Sham: 4.1"); a study whose cells are not known opens its one cell.
 */
export function drillItems(list, states, values = {}) {
  return list.flatMap(it => {
    const cells = (it.cells || []).filter(c => states.includes(c.state));
    return cells.length ? cells.map(c => ({ paperId: it.paperId, cell: c.key, text: [c.where, valueText(values[c.key])].filter(Boolean).join(': ') })) : [{ paperId: it.paperId, cell: it.key }];
  });
}

/**
 * One scale: its whole name and facts, the table, the line of responders and percent change, and the key line. `drill(label, items)`
 * registers a list of studies ({ paperId, cell }) and returns its id; `key` is the scale's key line ('' while it is read, null without a
 * change synthesis).
 */
function scaleHtml(g, { st, drill, key }) {
  const ins = g.instrument ? instrumentOf(st, g.instrument) : null, name = ins?.label || g.label;
  const title = ins ? scaleTitle(ins) : g.label, f = ins ? scaleFacts(ins) : null;
  const point = p => g.points.find(x => x.point === p);
  const count = (label, merged, studies) => {
    const rep = [...merged.reported, ...merged.derived], nr = merged.nr, emp = studies - rep.length - nr.length;
    const items = (list, states) => drillItems(list, states, st.values || {});
    const tip = `${name}, ${label}: ${num(rep.length)} of ${plural(studies, 'study', 'studies')} report it${merged.derived.length ? ` (${num(merged.derived.length)} derived)` : ''}, ${num(nr.length)} not reported, ${num(Math.max(0, emp))} empty`;
    const main = rep.length ? uiLink({ label: num(rep.length), title: `Show the ${plural(rep.length, 'study', 'studies')}`, attrs: { 'data-es-drill': drill(`${name}, ${label}`, items(rep, ['reported', 'derived'])), 'aria-label': tip } })
      : `<span class="es-zero" title="${esc(tip)}">0</span>`;
    const muted = nr.length ? uiLink({ label: `${num(nr.length)} NR`, cls: 'es-nr', title: `Show the ${plural(nr.length, 'study', 'studies')} that do not report it`, attrs: { 'data-es-drill': drill(`${name}, ${label}: not reported`, items(nr, ['nr'])) } }) : '';
    return `<span class="es-scale-n">${main}${muted}</span>`;
  };
  const statsOf = (p, names) => (point(p)?.stats || []).filter(x => names.includes(x.stat));
  const cols = SCALE_COLUMNS.filter(c => !c.optional || ['baseline', 'end', 'change'].some(p => statsOf(p, c.stats).some(x => x.reported + x.derived + x.nr > 0)));
  const rows = ['baseline', 'end', 'change'].filter(p => point(p)).map(p => {
    const word = point(p).label;
    return `<tr><th scope="row">${esc(word)}</th>${cols.map(c => { const xs = statsOf(p, c.stats);
      return `<td>${xs.length ? count(`${word.toLowerCase()} ${c.word}`, mergeStats(xs), g.studies) : ''}</td>`; }).join('')}</tr>`;
  }).join('');
  const line = LINE_STATS.map(([stat, word]) => { const xs = statsOf('change', [stat]); return xs.length && xs.some(x => x.reported + x.derived + x.nr > 0) ? `${esc(word)} ${count(word.toLowerCase(), mergeStats(xs), g.studies)}` : ''; })
    .filter(Boolean).join('<span class="es-scale-sep" aria-hidden="true"></span>');
  const d = g.instrument ? scaleDecision(st, g.instrument) : null;
  const meta = metadataLine([plural(g.studies, 'study', 'studies'), f?.range, f?.direction, f?.rater, d && d.use !== 'own' ? decisionWords(st, d) : ''].filter(Boolean));
  const head = `<p class="es-group-title es-scale-title" title="${esc(title)}">${esc(ins?.name && ins.name !== name ? `${name}: ${ins.name}` : name)}</p>`;
  const open = g.instrument ? uiLink({ label: 'Scales', title: `Open ${name} in Scales: what it measures and how the review uses it`, cls: 'es-scale-open', attrs: { 'data-es-scale': g.instrument } }) : '';
  return `<div class="es-group es-scale" role="group" aria-label="${esc(name)}">${head}<div class="es-scale-meta">${meta}${open}</div>`
    + `<table class="es-scale-table"><thead><tr><th scope="col"><span class="visually-hidden">Time point</span></th>${cols.map(c => `<th scope="col">${esc(c.head)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    + (line ? `<p class="es-scale-line">${line}</p>` : '')
    + (key == null ? '' : `<p class="es-scale-key" data-es-key="${esc(g.instrument || '')}">${esc(key)}</p>`) + '</div>';
}

/**
 * Every scale the studies' outcomes are coded to, most studied first, the outcomes not coded last; '' when none holds a statistic.
 * `keyOf(code, studies)` gives a scale's key line ('' while it is read, null without a change synthesis).
 */
export function outcomesHtml(outcomes, { st = {}, drill = () => '', keyOf = () => null } = {}) {
  return outcomes.filter(g => g.points.some(p => p.stats.some(x => x.reported + x.derived + x.nr > 0)))
    .map(g => scaleHtml(g, { st, drill, key: g.instrument ? keyOf(g.instrument, g.studies) : null })).join('');
}
