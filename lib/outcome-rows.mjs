// Outcome rows and the instrument map from a wide evidence table (data-model plan S3; plan G3, G3a).
//
// A wide table keeps each study's outcomes in groups of columns, `o1_outcome`, `o1_rater`, `o1_direction`, `o1_time`, … then `o2_…`,
// with a cell per arm (`paper:table.o1_outcome@arm2`, lib/arms.mjs). outcomeRows reads it long: one row per study × arm × outcome
// group × time point, with the instrument code where the outcome column is coded against the instrument list (lib/instruments.mjs) and
// the registry's attributes beside it. instrumentMap counts studies per indication × procedure × instrument and lists, per indication,
// the scales the registry says usually serve it that no included study used. Nothing is guessed from text: an outcome column that is
// not coded gives rows with `instrument: null`. Pure: no store.
import { instrumentOf, registryIndication, usualInstruments, INSTRUMENTS_VOCAB } from './instruments.mjs';
import { vocabFor, termOf, pathOf, isLeaf } from './vocabularies.mjs';
import { weeksOf } from './change-rows.mjs';
import { hasOutcomeRows, entriesOf, entryKey, outcomeColumnId } from './outcome-store.mjs';

const str = v => String(v ?? '').trim();
const GROUP = /(?:^|[._])o(\d+)_outcome$/;

/** The table rows are read from: `table` by id, else the first table with outcome-group columns. */
export function outcomeTable(s, table = null) {
  const ts = s?.templates || [];
  return (table && ts.find(t => t.id === table)) || ts.find(t => hasOutcomeRows(t) || (t.columns || []).some(c => GROUP.test(c.id))) || null;
}
/** The outcome groups of a table: [{ k, prefix, outcome, rater, direction, time }] with each column's id ('' when the table lacks it). */
export function outcomeGroups(t) {
  const ids = new Set((t?.columns || []).map(c => c.id)), out = [];
  for (const c of t?.columns || []) {
    const m = GROUP.exec(c.id); if (!m) continue;
    const prefix = c.id.slice(0, c.id.length - 'outcome'.length), col = f => (ids.has(prefix + f) ? prefix + f : '');
    out.push({ k: Number(m[1]), prefix, outcome: c.id, rater: col('rater'), direction: col('direction'), time: col('time') });
  }
  return out.sort((a, b) => a.k - b.k);
}
const included = s => {
  const ids = new Set();
  for (const p of s?.papers || []) if (!p.reportOf && s.fulltext?.[p.id]?.decision === 'include') ids.add(p.id);
  return ids;
};
/** A study's value of a column: its study-level cell, else its first arm's. */
const cellOf = (values, pid, col, arm) => values[`${pid}:${col}${arm ? `@${arm}` : ''}`] ?? (arm ? values[`${pid}:${col}`] : undefined);
const textOf = v => str(v?.reported_value);
const columnOf = (t, id) => (t?.columns || []).find(c => c.id === id) || null;
const codeOf = (v, field) => (field?.vocabulary && typeof v?.normalized_value === 'string' && v.normalized_value ? v.normalized_value : null);
const recordedDirection = t => (/^lower/i.test(t) ? 'worse' : /^higher/i.test(t) ? 'better' : null);   // "Lower is better": a higher score is worse

/**
 * One row per study × arm × outcome group × time point: { paper_id, study, arm, arm_label, group, k, outcome, outcome_key, instrument,
 * instrument_label, domain, min, max, higher, rater, rater_recorded, direction_recorded, direction_conflict, time_text, timepoint_weeks }.
 * `instrument` is the code the outcome cell holds when its column takes the instrument list, else null; the registry attributes are
 * null then too. `direction_conflict` is true when the table's direction cell contradicts the registry's, null when either is unknown.
 * The table has one time column per group, so one time point per row; `studies` limits the papers (default: the included ones).
 */
export function outcomeRows(s, { table = null, studies = null } = {}) {
  const t = outcomeTable(s, table); if (!t) return [];
  const values = s.values || {}, groups = outcomeGroups(t), keep = studies ? new Set(studies) : included(s);
  const studyCol = (t.columns || []).find(c => /[._]study$/.test(c.id))?.id || '';
  const label = new Map((s.papers || []).map(p => [p.id, p.label || p.id]));
  const out = [];
  for (const pid of [...keep].sort()) {
    const arms = Array.isArray(t.arms?.[pid]) && t.arms[pid].length ? t.arms[pid] : [{ id: null, label: '' }];
    const study = textOf(values[`${pid}:${studyCol}`]) || label.get(pid) || pid;
    // stored outcome entries (lib/outcome-store.mjs) read as the groups they replaced: the entry's cells under its statistic columns
    const own = hasOutcomeRows(t) ? entriesOf(t, pid).filter(e => !e.none) : [];
    const entryGroups = own.map((e, i) => ({ k: i + 1, prefix: `${e.id}_`, entry: e.id, outcome: outcomeColumnId(t.id, 'outcome'), rater: outcomeColumnId(t.id, 'rater'),
      direction: outcomeColumnId(t.id, 'direction'), time: outcomeColumnId(t.id, 'time'), instrument: outcomeColumnId(t.id, 'instrument') }));
    for (const g of entryGroups) for (const a of arms) {
      const at = col => values[entryKey(pid, col, g.entry, a.id)] ?? (a.id ? values[entryKey(pid, col, g.entry)] : undefined);
      // an entry is placed by its outcome as reported or, without it, by its instrument (an outcome a person added in the grid names its scale only)
      const ov = at(g.outcome), outcome = textOf(ov);
      const iv = at(g.instrument), field = columnOf(t, g.instrument), code = iv?.availability !== 'not_found' ? codeOf(iv, field) : null, ins = code ? instrumentOf(s, code) : null;
      if (/^(NR|NA)\b/i.test(outcome) || (!outcome && !code)) continue;
      const time = textOf(at(g.time)), dirText = textOf(at(g.direction)), recorded = recordedDirection(dirText), w = time ? weeksOf(time) : null;
      out.push({ paper_id: pid, study, arm: a.id, arm_label: a.label || '', group: g.entry, k: g.k, outcome: ov?.qualifier ? `${outcome} (${ov.qualifier})` : outcome,
        outcome_key: entryKey(pid, g.outcome, g.entry, a.id), instrument: code, instrument_label: ins?.label ?? null, domain: ins?.domain || null, min: ins?.min ?? null,
        max: ins?.max ?? null, higher: ins?.higher ?? null, rater: ins?.rater || null, rater_recorded: textOf(at(g.rater)), direction_recorded: dirText,
        direction_conflict: recorded && ins?.higher ? recorded !== ins.higher : null, time_text: time, timepoint_weeks: w ? w.weeks : null });
    }
    for (const g of groups) {
      const field = columnOf(t, g.outcome), coded = field?.vocabulary === INSTRUMENTS_VOCAB;
      for (const a of arms) {
        const ov = cellOf(values, pid, g.outcome, a.id), outcome = textOf(ov);
        if (!outcome || /^(NR|NA)\b/i.test(outcome)) continue;
        const code = coded ? codeOf(ov, field) : null, ins = code ? instrumentOf(s, code) : null;
        const time = g.time ? textOf(cellOf(values, pid, g.time, a.id)) : '', dirText = g.direction ? textOf(cellOf(values, pid, g.direction, a.id)) : '';
        const recorded = recordedDirection(dirText), w = time ? weeksOf(time) : null;
        out.push({ paper_id: pid, study, arm: a.id, arm_label: a.label || '', group: g.prefix.replace(/^.*[.]/, '').replace(/_$/, ''), k: g.k,
          outcome: ov?.qualifier ? `${outcome} (${ov.qualifier})` : outcome, outcome_key: `${pid}:${g.outcome}${a.id ? `@${a.id}` : ''}`,
          instrument: code, instrument_label: ins?.label ?? null, domain: ins?.domain || null, min: ins?.min ?? null, max: ins?.max ?? null,
          higher: ins?.higher ?? null, rater: ins?.rater || null, rater_recorded: g.rater ? textOf(cellOf(values, pid, g.rater, a.id)) : '',
          direction_recorded: dirText, direction_conflict: recorded && ins?.higher ? recorded !== ins.higher : null,
          time_text: time, timepoint_weeks: w ? w.weeks : null });
      }
    }
  }
  return out;
}

/** The fields the map reads: the project's choice (s.instrumentMap, kept outside s.synthesis so choosing it marks no output stale), else the class column (Indication class), else the column labelled Indication / Procedure. */
export function mapFields(s, t, choice = s?.instrumentMap || {}) {
  const cols = t?.columns || [], has = id => cols.some(c => c.id === id);
  // a class column first (Indication class): a study's own wording of its indication is one level per study, which groups nothing
  const pick = (want, name) => (want && has(want) ? want
    : cols.find(c => str(c.label).toLowerCase() === `${name} class`)?.id || cols.find(c => str(c.label).toLowerCase() === name)?.id
      || cols.find(c => new RegExp(`[._]${name}_class$`).test(c.id))?.id || cols.find(c => new RegExp(`[._]${name}$`).test(c.id))?.id || '');
  return { indication: pick(choice.indication, 'indication'), procedure: pick(choice.procedure, 'procedure') };
}
/**
 * A study's level of a category field: { code, label, term, parents, top, classOnly } from its vocabulary, or the text itself; null when empty
 * or NR. A value coded at a class, a term with terms under it (Epilepsy, without the kind), is that class's own level, "Epilepsy, class only"
 * (W3): it counts under the class beside the class's terms, as the Data summary counts it (lib/extraction-summary-kinds.mjs). `top` is the
 * class at the top of the term's path, which the map orders rows by.
 */
export function studyLevel(s, t, values, pid, col) {
  if (!col) return null;
  const field = columnOf(t, col), v = cellOf(values, pid, col, (t.arms?.[pid] || [])[0]?.id || null), text = textOf(v);
  if (!text || /^(NR|NA)\b/i.test(text)) return null;
  const vocab = vocabFor(s, field), code = codeOf(v, field), term = vocab && code ? termOf(vocab, code) : null;
  if (term) {
    const path = pathOf(vocab, term.code), classOnly = !isLeaf(vocab, term.code), top = termOf(vocab, path[0]) || term;
    return { code: term.code, label: classOnly ? `${term.label}, class only` : term.label, term, parents: path.slice(0, -1).reverse().map(c => termOf(vocab, c)),
      top: { code: top.code, label: top.label }, classOnly };
  }
  return { code: text, label: text, term: null, parents: [], top: null, classOnly: false };
}

/**
 * The instrument map: { fields, instruments: [{ code, label }] (the columns: used ones by study count, then usual-but-unused ones),
 * rows: [{ indication, procedure, studies, cells: { code: n }, unused: [code] }], studies, uncoded }. A row is one indication ×
 * procedure; `cells[code]` counts the included studies of that row with at least one outcome coded `code`. `unused` lists, on each of an
 * indication's rows, the scales that usually serve it (lib/instruments.mjs) that no included study of the indication used. `uncoded`
 * counts studies with outcomes but none coded, which the map cannot place.
 */
export function instrumentMap(s, { table = null, fields = null } = {}) {
  const t = outcomeTable(s, table);
  const empty = { fields: { indication: '', procedure: '' }, instruments: [], rows: [], studies: 0, uncoded: 0 };
  if (!t) return empty;
  const F = fields || mapFields(s, t), values = s.values || {}, rows = outcomeRows(s, { table: t.id });
  const byStudy = new Map();
  for (const r of rows) { if (!byStudy.has(r.paper_id)) byStudy.set(r.paper_id, new Set()); if (r.instrument) byStudy.get(r.paper_id).add(r.instrument); }
  const NONE = { code: '', label: 'Not recorded', term: null, parents: [] };
  const cells = new Map(), usedIn = new Map(), totals = new Map(), indications = new Map();
  let uncoded = 0;
  for (const [pid, codes] of byStudy) {
    if (!codes.size) { uncoded++; continue; }
    const ind = studyLevel(s, t, values, pid, F.indication) || NONE, proc = studyLevel(s, t, values, pid, F.procedure) || NONE, key = `${ind.code}\u0000${proc.code}`;
    indications.set(ind.code, ind);
    if (!cells.has(key)) cells.set(key, { indication: ind, procedure: proc, studies: new Set(), counts: new Map() });
    const cell = cells.get(key); cell.studies.add(pid);
    if (!usedIn.has(ind.code)) usedIn.set(ind.code, new Set());
    for (const c of codes) { cell.counts.set(c, (cell.counts.get(c) || 0) + 1); usedIn.get(ind.code).add(c); totals.set(c, (totals.get(c) || 0) + 1); }
  }
  const unusedOf = new Map();
  for (const [code, ind] of indications) {
    const reg = ind.term ? registryIndication(ind.term, ind.parents) : registryIndication(ind.label);
    unusedOf.set(code, usualInstruments(s, reg).map(x => x.code).filter(c => !usedIn.get(code)?.has(c)));
  }
  const used = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
  const unusedAll = [...new Set([...unusedOf.values()].flat())].filter(c => !totals.has(c));
  const lbl = c => instrumentOf(s, c)?.label || c;
  const order = (a, b) => (a.code === '') - (b.code === '') || a.label.localeCompare(b.label);
  // a coded indication sits under its class: the classes in order, each class's own ("class only") first, then its terms
  const byClass = (a, b) => (a.top && b.top ? a.top.label.localeCompare(b.top.label) || (b.classOnly && b.code === b.top.code) - (a.classOnly && a.code === a.top.code) : 0);
  const outRows = [...cells.values()].sort((a, b) => (a.indication.code === '') - (b.indication.code === '') || byClass(a.indication, b.indication) || order(a.indication, b.indication) || order(a.procedure, b.procedure)).map(c => ({
    indication: { code: c.indication.code, label: c.indication.label, ...(c.indication.top ? { class: c.indication.top } : {}), ...(c.indication.classOnly ? { classOnly: true } : {}) },
    procedure: { code: c.procedure.code, label: c.procedure.label }, studies: c.studies.size,
    cells: Object.fromEntries(c.counts), unused: unusedOf.get(c.indication.code) || [] }));
  return { fields: F, instruments: [...used, ...unusedAll].map(c => ({ code: c, label: lbl(c), used: totals.has(c) })), rows: outRows,
    studies: [...byStudy.values()].filter(x => x.size).length, uncoded };
}
