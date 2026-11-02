// Fields for patients the project already holds, from a table keyed by the patient's IPD id (plan §IPD import, amended 2026-10-23).
//
// A review adds columns after its patients are in: the radiosurgery details of the patients who had it, a dose, an intent, a date.
// Such a table is merged, never appended: each row names its patient by the id the project gave it (the "IPD id" column; a label
// is not an identity: two reports by one author in one year, a renamed case), and each cell is one of
//
//   added      the patient's cell was empty, the table's value goes in
//   same       the patient already holds that value
//   conflict   the patient holds another value: listed with both, and left as it is unless a person takes the table's value
//
// A column the project does not have is added, its type read from the values (number, date, a category of a few values, text). A
// row whose id no patient has, and a patient no row names, are listed. Pure: `mergePlan` reads, `applyMerge` mutates the state it is
// handed (inside `update`, or a copy).
/** A calendar date from a cell: an ISO date or date-time (what the workbook reader gives a date cell), else null. */
export function dateOf(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}
/** Months from one date to another, a month being a twelfth of the Julian year (30.4375 days), to four decimals. */
export const monthsBetween = (a, b) => Math.round(((b - a) / 86400000 / 30.4375) * 1e4) / 1e4;

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const blank = v => v == null || String(v).trim() === '';
const ID_HEADER = /^(ipd[ _-]?id|patient[ _-]?id|participant[ _-]?id|id)$/;
const isNum = v => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(v).trim());

/** A column's type from its values: all numbers, all ISO dates, a few repeated words, or text. */
export function inferType(values) {
  const vs = values.map(v => String(v ?? '').trim()).filter(Boolean);
  if (!vs.length) return 'text';
  if (vs.every(isNum)) return 'number';
  if (vs.every(v => dateOf(v) != null)) return 'date';
  const distinct = new Set(vs.map(fold));
  return distinct.size <= Math.min(12, Math.max(2, Math.ceil(vs.length / 2))) && vs.every(v => v.length <= 40) ? 'category' : 'text';
}

/** A column id from a header: lower case, words joined by underscores, unique among `taken`. */
export function columnIdOf(header, taken) {
  const base = fold(header).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'column';
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

const same = (a, b, type) => {
  if (type === 'number' && isNum(a) && isNum(b)) return Number(a) === Number(b);
  if (type === 'date' && dateOf(a) != null) return dateOf(a) === dateOf(b);
  return fold(a) === fold(b);
};

/**
 * What merging `table` ({ header, rows }: the first row's cells and the rows below) into `state` would do. `idColumn` names the key
 * header (default: the one called IPD id, patient id or id). `skip` lists headers to leave out. Returns { ok, reason?, idHeader,
 * columns: [{ header, id, name, type, created }], matched, unmatchedRows, unnamedPatients, changes: [{ patient, label, column,
 * name, from, to, kind }], counts }.
 */
export function mergePlan(state, table, { idColumn = null, skip = [] } = {}) {
  const header = (table.header || []).map(h => String(h ?? '').trim());
  const at = idColumn ? header.findIndex(h => fold(h) === fold(idColumn)) : header.findIndex(h => ID_HEADER.test(fold(h)));
  if (at < 0) return { ok: false, reason: 'The table has no IPD id column: a column of the ids the project gives its patients' };
  const people = state.participants || [], byId = new Map(people.map(p => [p.id, p]));
  const cols = state.ipdColumns || [], byName = new Map(cols.map(c => [fold(c.name), c])), byColId = new Map(cols.map(c => [c.id, c]));
  const taken = new Set(cols.map(c => c.id));
  const rows = (table.rows || []).filter(r => (r || []).some(v => !blank(v)));
  const skipSet = new Set(skip.map(fold));
  const columns = header.map((h, i) => {
    if (i === at || !h || skipSet.has(fold(h))) return null;
    const known = byName.get(fold(h)) || byColId.get(h);
    if (known) return { header: h, i, id: known.id, name: known.name, type: known.type, created: false };
    const type = inferType(rows.map(r => r[i]));
    return { header: h, i, id: columnIdOf(h, taken), name: h, type, created: true };
  }).filter(Boolean);
  const changes = [], unmatchedRows = [], seen = new Set();
  rows.forEach((r, k) => {
    const id = String(r[at] ?? '').trim(), p = byId.get(id);
    if (!p) { unmatchedRows.push({ row: k + 2, id, cells: Object.fromEntries(columns.map(c => [c.name, r[c.i] ?? ''])) }); return; }
    if (seen.has(id)) { unmatchedRows.push({ row: k + 2, id, why: 'a second row for this patient', cells: {} }); return; }
    seen.add(id);
    for (const c of columns) {
      const to = String(r[c.i] ?? '').trim(), from = p[c.id];
      if (!to) continue;
      const kind = blank(from) ? 'added' : same(from, to, c.type) ? 'same' : 'conflict';
      changes.push({ patient: id, label: p.label || id, column: c.id, name: c.name, from: blank(from) ? '' : String(from), to, kind });
    }
  });
  const unnamedPatients = people.filter(p => !seen.has(p.id)).map(p => ({ id: p.id, label: p.label || p.id }));
  const count = k => changes.filter(x => x.kind === k).length;
  return { ok: true, idHeader: header[at], columns, matched: seen.size, unmatchedRows, unnamedPatients, changes,
    counts: { rows: rows.length, matched: seen.size, unmatched: unmatchedRows.length, added: count('added'), same: count('same'), conflicts: count('conflict'),
      newColumns: columns.filter(c => c.created).length } };
}

/**
 * The plan into the state: new columns added, empty cells filled, and a conflict taken from the table only when `take` (a Set of
 * "patient|column") names it. Returns counts of what was written.
 */
export function applyMerge(state, plan, { take = new Set(), now = new Date().toISOString() } = {}) {
  if (!plan?.ok) return { ok: false, reason: plan?.reason || 'Nothing to apply' };
  const cols = [...(state.ipdColumns || [])];
  for (const c of plan.columns) if (c.created && !cols.some(x => x.id === c.id)) {
    const values = plan.changes.filter(x => x.column === c.id).map(x => x.to);
    cols.push({ id: c.id, name: c.name, type: c.type, ...(c.type === 'category' ? { levels: [...new Set(values)].sort() } : {}) });
  }
  state.ipdColumns = cols;
  const by = new Map();
  let added = 0, taken = 0;
  for (const x of plan.changes) {
    if (x.kind === 'same') continue;
    if (x.kind === 'conflict' && !take.has(`${x.patient}|${x.column}`)) continue;
    (by.get(x.patient) || by.set(x.patient, {}).get(x.patient))[x.column] = x.to;
    if (x.kind === 'added') added++; else taken++;
  }
  state.participants = (state.participants || []).map(p => (by.has(p.id) ? { ...p, ...by.get(p.id), updatedAt: now } : p));
  return { ok: true, added, taken, patients: by.size, columns: plan.columns.filter(c => c.created).length, conflictsLeft: plan.changes.filter(x => x.kind === 'conflict').length - taken };
}

/** The plan as lines a person reads before applying it: counts, new columns, conflicts, rows and patients without a match. */
export function mergeReport(plan) {
  if (!plan.ok) return [plan.reason];
  const c = plan.counts, out = [`${c.matched} of ${c.rows} rows matched a patient by ${plan.idHeader}; ${c.added} empty cells filled, ${c.same} already the same, ${c.conflicts} conflicts left as they are.`];
  const made = plan.columns.filter(x => x.created);
  if (made.length) out.push(`New columns: ${made.map(x => `${x.name} (${x.type})`).join(', ')}.`);
  for (const x of plan.changes.filter(y => y.kind === 'conflict')) out.push(`Conflict, ${x.label}, ${x.name}: the project has "${x.from}", the table "${x.to}".`);
  for (const r of plan.unmatchedRows) out.push(`Row ${r.row}: ${r.why || `no patient has the id "${r.id}"`}.`);
  return out;
}
