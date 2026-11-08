// Outcome rows as stored data (plan G3, G3a; amended 2026-11-07) and the categories a table's fields fall in.
//
// A table keeps a study's outcomes as entries, not as numbered column groups. An entry is one outcome of one study (its instrument, coded to
// the instrument list, and the time point it was measured at); its statistics are values in s.values under the statistic's column and the
// entry: `paper:table.out_change_sd~o1@arm2` is the change SD of entry o1 for arm 2. The column is the statistic ("Change SD"), so a column
// means the same thing in every study; the entry says which outcome. A value keeps its column as `field_id` and names its `entry`, as an
// arm's value names its `arm` (lib/arms.mjs). An entry's id is a handle, never shown: an entry is named by its instrument and time.
//
//   t.outcomeRows = { version: 1, entries: { [paperId]: [{ id, from? }] }, decisions: [...] }
//
// The long view (outcomeLong) reads one row per study × arm × entry × time point (baseline, end, change), each statistic with its state:
// reported, not reported (NR: availability, never a value), derived (with its derivation) or empty. Pure: no store.
import { instrumentOf, INSTRUMENTS_VOCAB } from './instruments.mjs';
import { lib_outcome_ids$ENTRY_SEP as ENTRY_SEP, lib_outcome_ids$splitEntry as splitEntry } from "../boot.mjs";
export { ENTRY_SEP, splitEntry };   // the shell reads these without the instrument list (lib/outcome-ids.mjs)

export const OUTCOME_VERSION = 1;
export const OUTCOME_PREFIX = 'out_';
export const POINTS = Object.freeze(['baseline', 'end', 'change']);
const POINT_WORD = { baseline: 'Baseline', end: 'End', change: 'Change' };
// the statistics a time point holds, in reading order; responders and percent change belong to the change
const STAT_DEFS = [['n', 'n', 'integer'], ['mean', 'mean', 'number'], ['sd', 'SD', 'number'], ['se', 'SE', 'number'], ['ci', '95% CI', 'text'],
  ['median', 'median', 'number'], ['iqr', 'IQR', 'text'], ['range', 'range', 'text']];
export const STATS = Object.freeze([...STAT_DEFS.map(d => d[0]), 'responders', 'percent_change']);
const STAT_WORD = Object.fromEntries([...STAT_DEFS.map(d => [d[0], d[1]]), ['responders', 'responders'], ['percent_change', 'percent change']]);
/** What an entry says about itself: its instrument, the outcome as the paper words it, who rated it, which way is better and when. */
export const DESCRIPTORS = Object.freeze([
  { key: 'instrument', label: 'Instrument', type: 'category', vocabulary: INSTRUMENTS_VOCAB },
  { key: 'outcome', label: 'Outcome as reported', type: 'text' },
  { key: 'rater', label: 'Rater', type: 'text' },
  { key: 'direction', label: 'Direction', type: 'text' },
  { key: 'time', label: 'Time point', type: 'text' },
  { key: 'baseline_timing', label: 'Baseline timing', type: 'text' },
  { key: 'dispersion', label: 'Dispersion as reported', type: 'text' },
  { key: 'source', label: 'Where reported', type: 'text' },
]);
/** Every outcome column a table may hold: the descriptors, then each time point's statistics. */
export const OUTCOME_COLUMNS = Object.freeze([
  ...DESCRIPTORS.map(d => ({ ...d, descriptor: true })),
  ...POINTS.flatMap(p => STAT_DEFS.map(([stat, word, type]) => ({ key: `${p}_${stat}`, label: `${POINT_WORD[p]} ${word}`, type, point: p, stat }))),
  { key: 'responders', label: 'Responders', type: 'text', point: 'change', stat: 'responders' },
  { key: 'percent_change', label: 'Percent change', type: 'number', point: 'change', stat: 'percent_change' },
]);
const BY_KEY = new Map(OUTCOME_COLUMNS.map(c => [c.key, c]));
export const outcomeColumnDef = key => BY_KEY.get(key) || null;

/** The id of a table's outcome column ("t.out_change_sd"). */
export const outcomeColumnId = (tableId, key) => `${tableId}.${OUTCOME_PREFIX}${key}`;
/** The key of an outcome column's id, or null when the id is not one: "t.out_change_sd" → "change_sd". */
export function outcomeKeyOf(columnId) {
  const id = String(columnId || ''), at = id.indexOf(`.${OUTCOME_PREFIX}`);
  return at < 0 ? null : id.slice(at + 1 + OUTCOME_PREFIX.length);
}
/** A value's key for an entry's statistic: "paper:column~entry" or "paper:column~entry@arm". */
export const entryKey = (paperId, columnId, entry, arm = null) => `${paperId}:${columnId}${ENTRY_SEP}${entry}${arm ? `@${arm}` : ''}`;

/** The table's outcome columns, in the catalogue's order. */
export const outcomeColumnsOf = t => (t?.columns || []).filter(c => c.group === 'outcome');
export const hasOutcomeRows = t => !!t?.outcomeRows && typeof t.outcomeRows === 'object';
/** A study's entries in the table: [{ id, from? }]. */
export const entriesOf = (t, paperId) => (Array.isArray(t?.outcomeRows?.entries?.[paperId]) ? t.outcomeRows.entries[paperId] : []);
/** A free entry id for a study: o1, o2, … (an id is a handle; an entry is named by its instrument and time). */
export function nextEntryId(t, paperId) {
  const used = new Set(entriesOf(t, paperId).map(e => e.id));
  for (let k = 1; ; k++) if (!used.has(`o${k}`)) return `o${k}`;
}
/** A column definition for the table, from the catalogue: { id, label, type, group: 'outcome', category: 'outcomes', … }. */
export function outcomeColumn(tableId, key) {
  const d = outcomeColumnDef(key) || { key, label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), type: 'text', descriptor: true };
  return { id: outcomeColumnId(tableId, key), label: d.label, type: d.type, ...(d.vocabulary ? { vocabulary: d.vocabulary, options: [] } : {}),
    group: 'outcome', category: 'outcomes', ...(d.point ? { point: d.point, stat: d.stat } : {}), guidance: '', examples: '', why: '' };
}
/** The table with an empty outcome-row store, for a reducer to fill. */
export function ensureOutcomeRows(t) {
  if (!hasOutcomeRows(t)) t.outcomeRows = { version: OUTCOME_VERSION, entries: {} };
  t.outcomeRows.entries ||= {};
  return t.outcomeRows;
}

/** A value's state: 'reported', 'nr' (not reported), 'derived' (computed from what the source states, with its derivation) or 'empty'. */
export function stateOf(v) {
  if (!v) return 'empty';
  if (v.availability === 'not_found') return 'nr';
  if (v.derivation) return 'derived';
  return String(v.reported_value ?? '').trim() || v.normalized_value != null ? 'reported' : 'empty';
}
const textOf = v => String(v?.reported_value ?? '').trim();

/**
 * The long view: one row per study × arm × entry × time point. { paper_id, arm, entry, point, instrument, instrument_label, domain, higher,
 * outcome, time, stats: { mean: { state, text, value, key } … } } for every statistic of the point that the table holds a column for. An
 * entry's descriptor is its arm's value, else the entry's study-level value. `studies` limits the papers (default: every study with entries).
 */
export function outcomeLong(s, t, { studies = null } = {}) {
  if (!hasOutcomeRows(t)) return [];
  const V = s?.values || {}, cols = outcomeColumnsOf(t), out = [];
  const statCols = POINTS.map(p => [p, cols.filter(c => c.point === p)]);
  const pids = studies ? studies.filter(p => entriesOf(t, p).length) : Object.keys(t.outcomeRows.entries || {}).sort();
  for (const pid of pids) {
    const arms = Array.isArray(t.arms?.[pid]) && t.arms[pid].length ? t.arms[pid].map(a => a.id) : [null];
    for (const e of entriesOf(t, pid).filter(x => !x.none)) for (const arm of arms) {
      const at = col => V[entryKey(pid, outcomeColumnId(t.id, col), e.id, arm)] ?? (arm ? V[entryKey(pid, outcomeColumnId(t.id, col), e.id)] : undefined);
      const iv = at('instrument'), code = iv?.availability !== 'not_found' && typeof iv?.normalized_value === 'string' && iv.normalized_value ? iv.normalized_value : null;
      const ins = code ? instrumentOf(s, code) : null;
      for (const [point, pc] of statCols) {
        const stats = {};
        for (const c of pc) { const key = entryKey(pid, c.id, e.id, arm), v = V[key]; stats[c.stat] = { state: stateOf(v), text: textOf(v), value: v?.normalized_value ?? null, key }; }
        if (!pc.length) continue;
        out.push({ paper_id: pid, arm, entry: e.id, point, instrument: code, instrument_label: ins?.label ?? null, domain: ins?.domain || null, higher: ins?.higher ?? null,
          outcome: textOf(at('outcome')), time: point === 'baseline' ? textOf(at('baseline_timing')) : textOf(at('time')), stats });
      }
    }
  }
  return out;
}

/**
 * Coverage per instrument, for the summaries: [{ instrument, label, studies, points: [{ point, stats: [{ stat, label, reported, nr, derived, empty, studies }] }] }],
 * `studies` listing each state's studies with the cell that holds the state ({ reported: [{ paperId, key }], derived, nr, empty }),
 * most studied first, uncoded outcomes last under instrument null. A study counts once per instrument × statistic: reported when any of its
 * arms or entries of that instrument reports it, else derived, else not reported, else empty.
 */
export function instrumentCoverage(s, t, { studies = null } = {}) {
  const rows = outcomeLong(s, t, { studies }), rank = { reported: 3, derived: 2, nr: 1, empty: 0 };
  const by = new Map();
  for (const r of rows) {
    const k = r.instrument || '';
    if (!by.has(k)) by.set(k, { instrument: r.instrument, label: r.instrument_label || (r.instrument ? r.instrument : 'Not coded'), studies: new Set(), cells: new Map() });
    const g = by.get(k); g.studies.add(r.paper_id);
    const where = [r.time, (t?.arms?.[r.paper_id] || []).find(a => a.id === r.arm)?.label].filter(Boolean).join('; ');
    for (const [stat, x] of Object.entries(r.stats)) {
      // a study's best state of the statistic and its cell, and each of its cells with its state and place: a count lists them
      const ck = `${r.point}|${stat}`, m = g.cells.get(ck) || new Map(), was = m.get(r.paper_id) || { state: 'empty', key: x.key, cells: [] };
      const now = rank[x.state] > rank[was.state] ? { state: x.state, key: x.key, cells: was.cells } : was;
      if (x.key) now.cells.push({ key: x.key, state: x.state, where });
      m.set(r.paper_id, now);
      g.cells.set(ck, m);
    }
  }
  const cols = outcomeColumnsOf(t);
  return [...by.values()].sort((a, b) => (a.instrument === null) - (b.instrument === null) || b.studies.size - a.studies.size || a.label.localeCompare(b.label)).map(g => ({
    instrument: g.instrument, label: g.label, studies: g.studies.size,
    points: POINTS.map(point => ({ point, label: POINT_WORD[point], stats: cols.filter(c => c.point === point).map(c => {
      const m = g.cells.get(`${point}|${c.stat}`) || new Map(), n = { reported: 0, derived: 0, nr: 0, empty: 0 }, studies = { reported: [], derived: [], nr: [], empty: [] };
      for (const [paperId, st] of m) { n[st.state]++; studies[st.state].push({ paperId, key: st.key, cells: st.cells }); }
      n.empty += g.studies.size - m.size;
      return { stat: c.stat, label: c.label, word: STAT_WORD[c.stat], ...n, studies };
    }) })).filter(p => p.stats.length) }));
}

// ---- categories --------------------------------------------------------------------------------------------------------------------
/** The categories a table's fields fall in, in the order the views show them. */
export const CATEGORIES = Object.freeze([
  { id: 'study', label: 'Study and design' }, { id: 'population', label: 'Population' }, { id: 'intervention', label: 'Intervention or sham procedure' },
  { id: 'outcomes', label: 'Outcomes' }, { id: 'rob', label: 'Risk of bias' }, { id: 'notes', label: 'Notes' }]);
const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id));
// read from the label, first match wins; a column's own `category` overrides these
const CATEGORY_RULES = [
  ['notes', /\b(notes?|comments?|remarks?|source|sources|where reported)\b/i],
  ['rob', /\b(blind\w*|bias|conceal\w*|allocation|attrition|masking|masked)\b/i],
  ['outcomes', /\b(outcomes?|endpoints?|adverse|responders?|response|complications?|mortality|survival|effect|instrument|scale)\b/i],
  ['population', /\b(indications?|diagnos\w*|age|female|male|sex|patients?|participants?|population|disease|conditions?|severity|bmi|comorbid\w*)\b/i],
  ['intervention', /\b(procedures?|interventions?|sham|device|stimulation|dose|surgery|surgical|implant\w*|treatment|arms?|control|comparator|washout|target|drug)\b/i],
];
/** The category of a column: its own `category`, an outcome column's 'outcomes', else read from its label; 'study' when nothing matches. */
export function categoryOf(column) {
  if (column?.category && CATEGORY_IDS.has(column.category)) return column.category;
  if (column?.group === 'outcome') return 'outcomes';
  const label = String(column?.label || '');
  for (const [id, re] of CATEGORY_RULES) if (re.test(label)) return id;
  return 'study';
}
/** Columns grouped by category in the categories' order: [{ id, label, columns }], empty categories left out. */
export function byCategory(columns) {
  const m = new Map(CATEGORIES.map(c => [c.id, []]));
  for (const c of columns || []) m.get(categoryOf(c)).push(c);
  return CATEGORIES.map(c => ({ ...c, columns: m.get(c.id) })).filter(c => c.columns.length);
}
/** An entry's readable name: its instrument's label, else the outcome as reported, with the time point ("HAM-D17, 12 weeks"). */
export function entryName(s, t, paperId, entry, arm = null) {
  const V = s?.values || {}, a = arm || t?.arms?.[paperId]?.[0]?.id || null;
  const get = k => V[entryKey(paperId, outcomeColumnId(t.id, k), entry, a)] ?? V[entryKey(paperId, outcomeColumnId(t.id, k), entry)];
  const iv = get('instrument'), code = iv?.availability !== 'not_found' && typeof iv?.normalized_value === 'string' ? iv.normalized_value : '';
  const name = (code && (instrumentOf(s, code)?.label || code)) || textOf(get('outcome')).replace(/\s*\(.*$/, '') || 'Outcome';
  const time = textOf(get('time')).replace(/\s*\(.*$/, '');
  return time && !/^NR$/i.test(time) ? `${name}, ${time}` : name;
}
