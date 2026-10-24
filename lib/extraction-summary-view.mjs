// What the data summary page says, as plain strings and rows (design note 2026-10-13 §6). Pure: no store, no DOM, so a test builds the same words
// for any project. It names no field, level or state: every word comes from the summary it is given (a field's label, a level's text, a mapping
// role the project chose); the only words written here are the interface's own (kinds of reading, "median", "not numeric").
import { plural, num } from './dates.mjs';

export const KIND_WORDS = Object.freeze({ measures: 'Measures', numeric: 'Number', categorical: 'Categories', multi: 'Multiple values', free: 'Free text', label: 'Study name' });

/** "47%" of `d`; empty when there is nothing to divide by. Whole percents, like a table in a paper. */
export const percent = (n, d) => (d > 0 ? `${Math.round(100 * n / d)}%` : '');

/** A number as a reader writes it: four significant figures below a thousand, no trailing zeros; from a thousand up, whole numbers with grouped thousands. */
export function fmt(n) {
  if (!Number.isFinite(n)) return '';
  const r = Number(n.toPrecision(4));
  return Math.abs(r) >= 1000 ? num(Math.round(n)) : String(r);
}

/** A level as a reader says it: a cell written as a truth value (true, false) reads Yes or No; anything else as written. */
export const levelText = label => (/^true$/i.test(String(label)) ? 'Yes' : /^false$/i.test(String(label)) ? 'No' : String(label));

/** A state key as a label: the engine's three, or the role a person chose for their own words, spelt out. */
export const stateLabel = key => ({ present: 'With a value', missing: 'No value', not_reported: 'Not reported' })[key]
  || (String(key).startsWith('written:') ? `Written as ${String(key).slice(8)}` : String(key).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));

/** The states of a field in reading order: the three the engine always counts, then the project's own roles, empty ones left out. */
export function stateRows(f) {
  const keys = ['present', 'missing', 'not_reported', ...Object.keys(f.states).filter(k => !['present', 'missing', 'not_reported'].includes(k)).sort()];
  return keys.filter(k => f.states[k] && (f.states[k].n > 0 || k === 'present')).map(k => ({ key: k, label: stateLabel(k), n: f.states[k].n, studies: f.states[k].studies }));
}

/** "38 of 40": the studies that hold a value, beside the field's name in the closed row. */
export const closedCount = f => `${num(f.states.present.n)} of ${num(f.studyCount)}`;

/** The one-line digest of a field: what it holds in a few words, for the row that says how the field was read. */
/** A measure in a line: events as n of N and the share, a change by medians, a number by median and range; how many studies give it. */
export function measureLine(m) {
  const s = m.summary, k = `${num(m.papers)} ${m.papers === 1 ? 'study' : 'studies'}`, u = x => (/^[°%]/.test(s.unit) ? `${fmt(x)}${s.unit}` : s.unit ? `${fmt(x)} ${s.unit}` : fmt(x));
  if (m.type === 'tally') return `${num(s.n)}/${num(s.N)} (${percent(s.n, s.N) || '0%'}), ${k}`;
  if (m.type === 'change') return `${u(s.from)} → ${u(s.to)} by median, ${k}`;
  if (m.type === 'number') return `median ${u(s.median)} (${u(s.lo)} to ${u(s.hi)}), ${k}`;
  return k;
}
export function digest(f) {
  const has = f.states.present.n;
  if (!has) return 'No values';
  // a field that names its studies has no distribution: how many studies it names is all there is to say
  if (f.kind === 'label') return `${num(has)} of ${plural(f.studyCount, 'study', 'studies')} filled`;
  // a field of one measure named by the field itself (Arm (n)) does not say its name again
  if (f.kind === 'measures') { const ms = f.measures.measures; if (ms.length === 1 && ms[0].key === String(f.label).toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim()) { const t = measureLine(ms[0]); return t.charAt(0).toUpperCase() + t.slice(1); }
    return ms.slice(0, 3).map(m => `${m.name} ${measureLine(m)}`).join('; '); }
  if (f.kind === 'numeric') {
    const d = f.numeric;
    if (!d.n) return `No numbers (${plural(d.unparsed.length, 'value')} not numeric)`;
    return `n ${num(d.n)}, median ${fmt(d.median)} (IQR ${fmt(d.q1)} to ${fmt(d.q3)})`;
  }
  const levels = byCount(f.levels.filter(l => l.n > 0));
  if (!levels.length) {
    const k = f.residual.items.length, P = f.parts;
    // a free text read part by part says what its cells open with and its first count
    if (P && (P.leads.some(l => l.k >= 2) || P.tallies.length)) return [P.leads.filter(l => l.k >= 2).slice(0, 3).map(l => `${l.label} ${num(l.k)}`).join(', '), ...P.tallies.slice(0, 1).map(t => `${t.name} ${num(t.n)}/${num(t.N)}`)].filter(Boolean).join('; ');
    return k ? `${plural(k, 'distinct text')}, none grouped` : 'No values';
  }
  const top = levels.slice(0, 3).map(l => `${levelText(l.label)} ${num(l.n)}`).join(', ');
  const out = levels.length > 3 ? `${top}, +${levels.length - 3} more` : top;
  // a free text some of which a person's grouping counts: what is left over is said
  return f.kind === 'free' && f.residual.cells ? `${out}, ${num(f.residual.cells)} not grouped` : out;
}

/** The numeric field's statistics, each labelled, as rows of [label, text]. */
export function numericRows(f) {
  const d = f.numeric; if (!d || !d.n) return [];
  return [['Studies with a number', num(d.n)], ['Median (IQR)', `${fmt(d.median)} (${fmt(d.q1)} to ${fmt(d.q3)})`], ['Range', `${fmt(d.min)} to ${fmt(d.max)}`],
    ...(d.n > 1 ? [['Mean (SD)', `${fmt(d.mean)} (${fmt(d.sd)})`]] : [['Mean', fmt(d.mean)]])];
}

/** The levels of a field with their share of the studies that hold a value, sub-levels included. */
/** Levels most held first (a stable sort: equal counts keep the order they were declared in). */
const byCount = list => list.map((l, i) => [l, i]).sort((a, b) => b[0].n - a[0].n || a[1] - b[1]).map(([l]) => l);
/** A field's levels, most held first; a level no study holds is left to `emptyLevels` (owner, 2026-10-22: zero rows among the counts read as noise). */
export function levelRows(f) {
  const d = f.states.present.n;
  const one = l => ({ key: l.key, label: levelText(l.label), n: l.n, studies: l.studies, pct: percent(l.n, d), ...(l.sub?.length ? { sub: l.sub.map(s => ({ key: s.key, label: s.label, n: s.n, studies: s.studies, pct: percent(s.n, l.n) })) } : {}) });
  return byCount(f.levels.filter(l => l.n > 0)).map(one);
}
/** The declared levels no study holds, by name. */
export const emptyLevels = f => f.levels.filter(l => !l.n).map(l => l.label);

/** The status line of the page. */
export const statusText = (summary, shown) => `${plural(summary.studyCount, 'study', 'studies')}, ${plural(shown ?? summary.fields.length, 'field')}`;

/** CSV rows (one row per field level, state and statistic) for the page's Export: the counts as the page shows them. */
export function csvRows(summary) {
  const rows = [['Field', 'Reading', 'Group', 'Item', 'Studies', 'Percent', 'Of']];
  for (const f of summary.fields) {
    const kind = KIND_WORDS[f.kind], has = f.states.present.n;
    for (const s of stateRows(f)) rows.push([f.label, kind, 'State', s.label, s.n, percent(s.n, f.studyCount).replace('%', ''), f.studyCount]);
    if (f.numeric?.n) for (const [k, v] of numericRows(f)) rows.push([f.label, kind, 'Number', k, v, '', f.numeric.n]);
    for (const l of levelRows(f)) {
      rows.push([f.label, kind, 'Level', l.label, l.n, l.pct.replace('%', ''), has]);
      for (const s of l.sub || []) rows.push([f.label, kind, `Level: ${l.label}`, s.label, s.n, s.pct.replace('%', ''), l.n]);
    }
  }
  return rows;
}

// ---- the Normalise dialog (stage 3): what would be sent, and what it would cost as an estimate -----------------------------------------------

/** One field's lines in the run dialog, from its plan: what is sent, what the cache answers, the calls and the ESTIMATED tokens. */
export function planDetail(f) {
  const out = [f.askedItems ? `${plural(f.askedItems, 'value')} to send` : 'Nothing new to send'];
  if (f.cachedCount) out.push(`${num(f.cachedCount)} answered before`);
  if (f.calls.length) out.push(`${plural(f.calls.length, 'call')}, about ${num(f.inTokens)} tokens in and ${num(f.outTokens)} out (estimate)`);
  if (f.stale) out.unshift('Definition changed since the grouping');
  return out;
}
/** The total line of the dialog: calls and estimated tokens against the budget, or what is over. `problems` come from checkBudget. */
export function planStatus(totals, budget, problems = []) {
  if (!totals.fields) return 'Choose a field';
  const head = `Estimate: ${plural(totals.calls, 'call')} and about ${num(totals.inTokens + totals.outTokens)} tokens, against ${num(budget.calls)} calls and ${num(budget.tokens)} tokens`;
  return problems.length ? `${head}. Over the budget: ${problems.join('; ')}` : head;
}

// ---- Review data (stage 4): what the dialog says before the model step ----------------------------------------------------------------------

/** The local findings as rows of [label, n] in reading order, empty kinds left out. `kinds` is lib/extraction-review.mjs REVIEW_KINDS (its order is the reading order). */
export const reviewRows = (counts, kinds) => Object.keys(kinds).filter(k => counts[k] > 0).map(k => [kinds[k], counts[k]]);

/** The line above the model step's fields: how much of the local review is left for a model. */
export const reviewScope = (items, studies) => `${plural(items, 'item')} in ${plural(studies, 'study', 'studies')} can go to the model`;

/** The estimate line of the model step, or what is wrong with the sample or what is over the budget. `totals` come from the plan's sample, `problems` from checkBudget. */
export function reviewStatus(totals, budget, problems = []) {
  const head = totals.calls
    ? `Estimate: ${plural(totals.calls, 'call')} and about ${num(totals.inTokens + totals.outTokens)} tokens, against ${num(budget.calls)} calls and ${num(budget.tokens)} tokens`
    : 'Every answer is already known: nothing is sent';
  return problems.length ? `${head}. Over the budget: ${problems.join('; ')}` : `${head}${totals.cached ? `; ${plural(totals.cached, 'item')} answered before` : ''}`;
}
