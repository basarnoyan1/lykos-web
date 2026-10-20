// The numeric verification gate (plan §1.3: the model restates, it never computes).
//
// Why: categorical fields are extracted well; counts, arm assignment, units and
// time points are where a model goes wrong, and the commonest error is leaving
// out a value the paper states, more often than inventing one. The gate does
// not replace a reviewer. It makes three mechanical statements the reviewer
// would otherwise have to check by eye, and it never changes a value.
//
//   numericFindings({ column, value, quote, known })
//       [{ kind, severity: 'block' | 'flag', message }] for one cell.
//       'block' only where the value is impossible from its own words: a
//       number that is not in its quote (as a number: "45" is not in "145"),
//       or a count above its own denominator. Everything else is 'flag'.
//
//   gateProposal(proposal, ctx)                  -> { ok, findings }
//       CONTRACT (for validateProposal in agent-tools.mjs).
//       proposal: what validateProposal builds: { column_id, value,
//         availability, evidence: [{ kind, quote, page, ... }], ... }.
//       ctx: { columns: [column], known?: { armN?, totalN? } | (proposal) =>
//         that object }. `column` is { id, label, type, unit, ... }. armN is the
//         size of the arm the cell belongs to when the caller knows it (an arm
//         cell 'column@armN' whose arm-size cell is accepted), totalN the whole
//         study's size.
//       Returns ok = false exactly when some finding has severity 'block'.
//       findings is always an array of { kind, severity, message }. The
//       proposal is never modified. Only text evidence quotes are read (file
//       and image evidence carries none); the quotes are pooled, so a value
//       assembled from two quotes is checked against both. A proposal whose
//       availability is not 'present', an empty value, or an unknown column
//       yields { ok: true, findings: [] }. Without any quote the number-in-
//       quote and unit checks are skipped (the proposal is already marked
//       unsupported); the checks that need only the value still run. The caller
//       decides what 'block' does (the usual use: refuse the proposal and tell
//       the model why, so it can propose again) and what to do with 'flag'
//       (keep the proposal, show the finding beside it).
//
//   missedValues({ columns, proposals, values, pages })
//       [{ column, label, why, page, snippet }], at most 12: fields with no
//       accepted value and no usable proposal (none, 'not_found' or NR/NA) for
//       which the paper's text plainly states a matching value. Deterministic
//       (no model). It is a list of places to look, not a claim.
//       columns: [{ id, label, type, unit, guidance, options }]
//       proposals: [{ column_id, value, availability }] of this study
//       values: { [columnId]: text | record } accepted values of this study
//         (keys `${paper}:${columnId}` are accepted too; the part after the
//         first ':' is used)
//       pages: [{ page, text }] or [text, ...] (page = index + 1)
//       Heuristic, in order:
//         1. a field is skipped when it holds an accepted value or a present
//            proposal, or when it cannot be searched without a model: a text
//            field with no numeric cue (no numeric type, unit, "(n)", "%",
//            mean/rate/age/follow-up/number/count/duration/score/angle/failure/revision/complication/event in the
//            label or guidance) and no category options.
//         2. the label (and its ;,/ parts) gives concepts; each concept is its
//            content words, in order, up to two words apart, any plural or
//            "-ed" form. Concepts made only of generic words (study, outcome,
//            main, final, table, ...) are dropped. A category field matches
//            when one of its options is written.
//         3. a numeric field matches where a concept is followed or preceded
//            within a window of 40 characters before and 100 after by a number
//            that is not a year, and, where the field has a time/length/mass
//            unit (column.unit, a "(mo)" in the label, or "in months" in the
//            guidance), the number is immediately followed by that unit. A
//            field whose label is "(n)" matches "n = 68" or "68 patients"
//            (also participants, subjects, cases) instead.
//         4. the text after a References heading (in the later half of the
//            paper) is not searched. Best match per field: unit adjacency,
//            then closeness. One snippet of at most 200 characters.
//       Measured only on a fixture (tools in the report of the change that
//       added it, and test/numeric-gate.test.mjs for the precision cases); it
//       is not a claim about any other review.
//
//   crossCheck({ values, columns })
//       [{ kind, severity, message, cell }]: inconsistencies between the cells
//       of ONE study: an event count above its denominator, a percentage that
//       does not follow from its count and denominator, a denominator that is
//       neither the arm's size (arm cell, or "Arm N:" line) nor any arm's size
//       nor their sum, events above n for analysis fields events_t/n_t etc.
//       values: { [columnId | 'columnId@armN']: text | record }.
//       cell-rules.mjs runs it as the 'consistent' rule kind.
import { numbersIn } from './numbers.mjs';

const same = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const text = v => v == null ? '' : typeof v === 'object' ? String(v.reported_value ?? v.value ?? v.normalized_value ?? '') : String(v);
const isNR = s => /^(NR|NA|N\/A|not reported|not measured|not found)$/i.test(String(s).trim());
const dec = s => (String(s).replace(',', '.').split('.')[1] || '').length;
const numOf = s => Number(String(s).replace(/−/g, '-').replace(',', '.'));
const collapse = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---- counts, denominators, percentages ----------------------------------------

// "3/68", "3 of 68", "3 out of 68", each optionally followed by "(4.4%)" or ", 4.4%"
const PAIR = /(?<![\d.,/])(\d+)\s*(?:\/|out of|of)\s*(\d+)(?![\d.,/])(?:\s*[(,]\s*([≥≤<>~]?)\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?)?/g;
const isDate = (a, b) => Number(a) <= 31 && /^(?:19|20)\d\d$/.test(b);

export function pairsIn(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(PAIR)) {
    if (isDate(m[1], m[2])) continue;
    out.push({ n: Number(m[1]), N: Number(m[2]), pct: m[4] != null ? m[4] : null, approx: !!m[3], raw: m[0].trim() });
  }
  return out;
}

/** Allowed distance between a printed percentage and count/denominator, in points. */
const pctTolerance = printed => Math.max(0.1, 0.5 * 10 ** -dec(printed));

function pairFindings(pairs) {
  const out = [];
  for (const p of pairs) {
    if (p.n > p.N) { out.push({ kind: 'count-over-denominator', severity: 'block', message: `${p.raw}: the count ${p.n} is above its denominator ${p.N}` }); continue; }
    if (p.pct != null && p.N > 0 && !p.approx) {
      const actual = p.n / p.N * 100, printed = numOf(p.pct);
      if (Math.abs(actual - printed) > pctTolerance(p.pct))
        out.push({ kind: 'percentage', severity: 'flag', message: `${p.raw}: ${p.n}/${p.N} is ${actual.toFixed(Math.max(1, dec(p.pct)))}%, not ${p.pct}%` });
    }
  }
  return out;
}

// ---- units and time points ------------------------------------------------------

const FAMILIES = {
  time: { months: /\b(?:mo|mos|months?)\b/i, years: /\b(?:yrs?|years?)\b|(?<=\d)\s*y\b/i, weeks: /\b(?:wks?|weeks?)\b/i, days: /\bdays?\b/i },
  length: { mm: /(?<=\d)\s*mm\b/i, cm: /(?<=\d)\s*cm\b/i, m: /(?<=\d)\s*m\b(?!m)/i },
  mass: { kg: /(?<=\d)\s*kg\b/i, g: /(?<=\d)\s*g\b/i, mg: /(?<=\d)\s*mg\b/i },
};
const UNIT_WORDS = { mo: 'months', mos: 'months', month: 'months', months: 'months', y: 'years', yr: 'years', yrs: 'years', year: 'years', years: 'years',
  wk: 'weeks', wks: 'weeks', week: 'weeks', weeks: 'weeks', day: 'days', days: 'days', mm: 'mm', cm: 'cm', m: 'm', kg: 'kg', g: 'g', mg: 'mg' };

/** The unit a column names: column.unit, else "(mo)" in its label, else "in months" in its guidance. */
export function columnUnit(column) {
  const cands = [column?.unit, ...[...String(column?.label || '').matchAll(/\(([^)]{1,12})\)/g)].map(m => m[1]),
    /\bin\s+(months?|years?|weeks?|days?|mm|cm|kg)\b/i.exec(column?.guidance || '')?.[1]];
  for (const c of cands) {
    const k = String(c || '').trim().toLowerCase().replace(/\.$/, '');
    if (k === '%' || k === 'percent') return { family: 'percent', unit: '%' };
    if (UNIT_WORDS[k]) {
      const unit = UNIT_WORDS[k];
      const family = Object.keys(FAMILIES).find(f => unit in FAMILIES[f]);
      if (family) return { family, unit };
    }
  }
  return null;
}
const unitsIn = (family, t) => new Set(Object.entries(FAMILIES[family]).filter(([, re]) => re.test(t)).map(([u]) => u));

const DAYS = { months: 30.4375, years: 365.25, weeks: 7, days: 1 };
const familyOf = w => /^(?:mo|month)/i.test(w) ? 'months' : /^y/i.test(w) ? 'years' : /^w/i.test(w) ? 'weeks' : 'days';
const durationsIn = t => [...String(t).matchAll(/(\d+(?:[.,]\d+)?)\s*[-–]?\s*(months?|mos?|years?|yrs?|y|weeks?|wks?|days?)\b/gi)]
  .map(m => ({ days: numOf(m[1]) * DAYS[familyOf(m[2])], text: m[0] }));

// ---- one cell ---------------------------------------------------------------------

const ARM_PREFIX = /(?:^|\n)\s*(?:Arm \d+|NA):\s*/g;
const isNumericColumn = c => c && (c.type === 'number' || c.type === 'integer');
const countBearing = v => pairsIn(v).length > 0 || /\bn\s*=\s*\d|\d\s*%/i.test(v);

/**
 * Findings for one cell: its value against its quote (one string, or several
 * joined), the column it belongs to, and what the study already holds.
 * Findings only; the value is never changed.
 */
export function numericFindings({ column = null, value = '', quote = '', known = {} } = {}) {
  const v = collapse(value), q = collapse(quote), out = [];
  if (!v || isNR(v)) return out;
  const vNums = numbersIn(v.replace(ARM_PREFIX, ' ')).map(n => n.value);
  const qNums = numbersIn(q).map(n => Math.abs(n.value));
  const hard = isNumericColumn(column) || countBearing(v);
  if (isNumericColumn(column) && (/\d\s*(?:[–—]|\bto\b)\s*\d|[<>≤≥±~≈]|\b(?:range|between|at least|at most|approximately)\b/i.test(v) || vNums.length > 1))
    out.push({ kind: 'ambiguous-scalar', severity: 'block', message: 'A numeric column needs one explicitly selected scalar; ranges, bounds and multiple estimates require review.' });

  // 1. every number the value states is in the quote, as a number
  if (q && vNums.length) {
    const qPairs = pairsIn(q);
    const missing = [...new Set(vNums.filter(x => !qNums.some(y => same(y, Math.abs(x)))))];
    const notStated = [], derived = [];
    for (const x of missing) {
      const from = qPairs.find(p => p.N > 0 && Math.abs(p.n / p.N * 100 - Math.abs(x)) <= pctTolerance(String(x)));
      (from && new RegExp(`(?<![\\d.])${String(x).replace('.', '[.,]')}\\s*%`).test(v) ? derived : notStated).push(from ? `${x}% (${from.n}/${from.N})` : String(x));
    }
    if (notStated.length) out.push({ kind: 'number-not-in-quote', severity: hard ? 'block' : 'flag',
      message: `${notStated.join(', ')} ${notStated.length === 1 ? 'is' : 'are'} not in the quote as ${notStated.length === 1 ? 'a number' : 'numbers'}` });
    for (const d of derived) out.push({ kind: 'number-computed', severity: 'flag', message: `${d} is computed from the quote, not stated in it` });
  }

  // 2. counts, denominators, percentages inside the value
  const pairs = pairsIn(v);
  out.push(...pairFindings(pairs));

  // 3. a count above the arm's size, when the caller knows it
  const limit = Number.isFinite(known?.armN) ? { n: known.armN, what: 'the arm' } : Number.isFinite(known?.totalN) ? { n: known.totalN, what: 'the study' } : null;
  if (limit) {
    const over = new Set();
    for (const p of pairs) if (p.n <= p.N && p.n > limit.n) over.add(p.n);
    const base = String(column?.id || '').split('.').pop().replace(/__o[a-z0-9]+(?:#t\d+)?$/, '');
    if (/^events(_[tc])?$/.test(base) || (isNumericColumn(column) && /\b(events?|failures?|complications?|revisions?|deaths?)\b/i.test(column.label || ''))) {
      const x = vNums.length === 1 ? vNums[0] : NaN;
      if (Number.isFinite(x) && x > limit.n) over.add(x);
    }
    for (const n of over) out.push({ kind: 'count-over-arm-size', severity: 'flag', message: `${n} is more than the size of ${limit.what} (${limit.n})` });
  }

  // 4. the unit the column names
  const u = columnUnit(column);
  if (u && u.family !== 'percent' && vNums.length) {
    const found = new Set([...unitsIn(u.family, v), ...unitsIn(u.family, q)]);
    if (found.size && !found.has(u.unit)) out.push({ kind: 'unit', severity: 'flag', message: `the column is in ${u.unit}; the ${unitsIn(u.family, q).size ? 'quote' : 'value'} gives ${[...found].join(', ')} (not converted)` });
    else if (!found.size && q && u.family === 'time') out.push({ kind: 'unit', severity: 'flag', message: `the column is in ${u.unit}; neither the value nor the quote names a unit` });
  }

  // 5. a time point in the column's label
  if (column?.label && q) {
    const wanted = durationsIn(String(column.label).replace(/\([^)]*\)/g, m => /\d/.test(m) ? m : ' '));
    if (wanted.length) {
      const have = durationsIn(`${q} ${v}`);
      for (const w of wanted)
        if (!have.some(h => Math.abs(h.days - w.days) <= 0.03 * w.days)) out.push({ kind: 'time-point', severity: 'flag', message: `the column asks for ${w.text}; the quote does not mention it` });
    }
  }
  return out;
}

/** The gate for one proposal; see the contract at the top of this file. */
export function gateProposal(proposal, ctx = {}) {
  const column = (ctx.columns || []).find(c => c.id === proposal?.column_id) || null;
  const value = collapse(proposal?.value);
  if (!proposal || !column || proposal.availability !== 'present' || !value) return { ok: true, findings: [] };
  const quotes = (proposal.evidence || []).filter(e => e && e.kind === 'text' && e.quote).map(e => String(e.quote));
  const known = (typeof ctx.known === 'function' ? ctx.known(proposal) : ctx.known) || {};
  const findings = numericFindings({ column, value, quote: quotes.join(' … '), known });
  return { ok: !findings.some(f => f.severity === 'block'), findings };
}

// ---- cells of one study --------------------------------------------------------------

const baseOf = id => String(id).split('.').pop().replace(/__o[a-z0-9]+(?:#t\d+)?$/, '');
const isSizeColumn = c => /^(arm_n|n(_[tc])?)$/i.test(baseOf(c.id)) || /^\s*(arm\s*\(n\)|n|sample size|number of (patients|participants))\s*$/i.test(c.label || '');

function armSizes(cellText) {
  // "Arm 1: A (n=30)\nArm 2: B (n=38)" or "NA (n=68)" or "68"
  const lines = String(cellText).split('\n');
  const out = new Map();
  lines.forEach((line, i) => {
    const m = /^\s*Arm (\d+):/.exec(line), idx = m ? Number(m[1]) : i + 1;
    const n = /\bn\s*=\s*(\d+)/i.exec(line) || /^\s*(\d+)\s*$/.exec(line);
    if (n) out.set(idx, Number(n[1]));
  });
  return out;
}

/** Inconsistencies between the cells of one study. Findings carry `cell` (the key of the cell they concern). */
export function crossCheck({ values = {}, columns = [] } = {}) {
  const out = [], byId = new Map(columns.map(c => [c.id, c]));
  const cells = Object.entries(values).map(([key, v]) => {
    const k = key.includes(':') && !byId.has(key) ? key.slice(key.indexOf(':') + 1) : key;
    const at = k.lastIndexOf('@');
    return { key, columnId: at < 0 ? k : k.slice(0, at), arm: at < 0 ? null : Number(/^arm(\d+)$/.exec(k.slice(at + 1))?.[1]) || null, text: text(v) };
  }).filter(c => c.text.trim() && !isNR(c.text) && byId.has(c.columnId));

  // arm sizes: from size columns, per arm cell or from the lines of one cell
  const sizes = new Map();
  for (const c of cells) {
    if (!isSizeColumn(byId.get(c.columnId))) continue;
    if (c.arm) { const n = armSizes(c.text).get(1) ?? Number(/\d+/.exec(c.text)?.[0]); if (Number.isFinite(n)) sizes.set(c.arm, n); }
    else for (const [i, n] of armSizes(c.text)) if (!sizes.has(i)) sizes.set(i, n);
  }
  const total = sizes.size ? [...sizes.values()].reduce((a, b) => a + b, 0) : NaN;
  const allowed = new Set([...sizes.values(), ...(Number.isFinite(total) ? [total] : [])]);

  for (const c of cells) {
    const col = byId.get(c.columnId);
    // the size cells themselves have no denominators to compare
    const lines = String(c.text).split('\n');
    lines.forEach((line, i) => {
      const m = /^\s*Arm (\d+):/.exec(line), lineArm = c.arm || (m ? Number(m[1]) : lines.length > 1 && !m ? null : null);
      const size = lineArm ? sizes.get(lineArm) : NaN;
      const pairs = pairsIn(line);
      for (const f of pairFindings(pairs)) out.push({ ...f, cell: c.key });
      if (isSizeColumn(col) || !sizes.size) return;
      for (const p of pairs) {
        if (p.n > p.N) continue;
        if (Number.isFinite(size) ? p.N !== size : !allowed.has(p.N))
          out.push({ kind: 'denominator', severity: 'flag', cell: c.key,
            message: `${p.raw}: the denominator ${p.N} is ${Number.isFinite(size) ? `not the arm's size (${size})` : `no arm's size (${[...sizes.values()].join(', ')}) or their sum`}` });
      }
    });
  }

  // analysis fields: events above n, per arm and outcome
  const val = new Map(cells.map(c => [`${c.columnId}|${c.arm || ''}`, c]));
  for (const c of cells) {
    const m = /^events(_[tc])?(__o[a-z0-9]+(?:#t\d+)?)?$/.exec(baseOf(c.columnId));
    if (!m) continue;
    const nId = c.columnId.replace(/events(_[tc])?/, (_, s) => `n${s || ''}`), n = val.get(`${nId}|${c.arm || ''}`);
    const e = numOf(c.text), d = n && numOf(n.text);
    if (Number.isFinite(e) && Number.isFinite(d) && e > d) out.push({ kind: 'count-over-denominator', severity: 'block', cell: c.key, message: `${e} events with only ${d} participants` });
  }
  return out;
}

// ---- omissions -----------------------------------------------------------------------

const GENERIC = new Set(['study', 'studies', 'outcome', 'outcomes', 'main', 'final', 'table', 'share', 'author', 'defined', 'factor', 'factors', 'other', 'total', 'type', 'name', 'id', 'group', 'data', 'value', 'values', 'result', 'results', 'level', 'design', 'selection', 'rationale']);
const STOP = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'in', 'for', 'to', 'by', 'at', 'on', 'per', 'with', 'from', 'as', 'is', 'any', 'each', 'mean', 'median', 'sd']);
const NUMERIC_CUE = /\((?:n|mo|y|%|mm|cm|°)\)|\bn\b|%|\b(?:mean|median|rate|rates|number|count|age|follow[\s-]?up|duration|score|angle|incidence|proportion|percent\w*|months?|years?|failures?|revisions?|reoperations?|complications?|events?|mortality|deaths?|adverse|infections?)\b/i;

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = w => `${escapeRe(w)}(?:s|es|ed)?`;

function concepts(column) {
  const label = String(column.label || '').replace(/\([^)]*\)/g, ' ');
  const out = [];
  for (const part of label.split(/[;,/]|\bor\b|\band\b/i)) {
    const words = (part.toLowerCase().match(/\p{L}+/gu) || []).filter(w => w.length > 1 && !STOP.has(w));
    if (!words.length || words.every(w => GENERIC.has(w))) continue;
    out.push({ words, re: new RegExp(`(?<![\\p{L}])${words.map(wordRe).join('(?:\\W+\\p{L}+){0,2}?\\W+')}(?![\\p{L}])`, 'giu') });
  }
  return out;
}

const pageList = pages => (pages || []).map((p, i) => typeof p === 'string' ? { page: i + 1, text: p } : { page: p.page ?? i + 1, text: String(p.text || '') });

/** The searchable text: pages, with the reference list cut off. */
function body(pages) {
  const list = pageList(pages).map(p => ({ page: p.page, text: collapse(p.text) }));
  const all = list.map(p => p.text).join('\n');
  const ref = [...all.matchAll(/(?:^|\n|\s)(?:References|REFERENCES|Bibliography)\s+(?=\[?1[.\]]|\d+\.\s|[A-Z])/g)].map(m => m.index).filter(i => i > all.length * 0.5).pop();
  if (ref == null) return list;
  let pos = 0;
  return list.map(p => { const start = pos; pos += p.text.length + 1; return start >= ref ? { page: p.page, text: '' } : start + p.text.length > ref ? { page: p.page, text: p.text.slice(0, ref - start) } : p; });
}

function snippet(t, at, len) {
  let a = Math.max(0, at - 70), b = Math.min(t.length, at + len + 110);
  if (a > 0) { const s = t.indexOf(' ', a); if (s > 0 && s < at) a = s + 1; }
  if (b < t.length) { const s = t.lastIndexOf(' ', b); if (s > at + len) b = s; }
  const s = t.slice(a, b).trim();
  return s.length > 200 ? `${s.slice(0, 199).trim()}…` : s;
}

const yearLike = n => Number.isInteger(n) && n >= 1900 && n <= 2100;

function matchColumn(column, pages) {
  const u = columnUnit(column);
  const cue = isNumericColumn(column) || u || NUMERIC_CUE.test(`${column.label || ''} ${column.guidance || ''}`);
  const sizeOnly = /\((?:n)\)\s*$/i.test(column.label || '') && !concepts(column).length;
  let best = null;
  const consider = (page, t, at, len, score, why) => { if (!best || score > best.score) best = { score, page, snippet: snippet(t, at, len), why }; };

  if (column.type === 'category' && column.options?.length) {
    for (const p of pages) for (const o of column.options) {
      const m = new RegExp(`(?<![\\p{L}])${escapeRe(String(o).toLowerCase())}(?![\\p{L}])`, 'iu').exec(p.text);
      if (m) consider(p.page, p.text, m.index, m[0].length, 1, `the text names "${o}"`);
    }
    return best;
  }
  if (!cue) return null;
  const wantsN = /\(n\)/i.test(column.label || '');
  const cs = concepts(column);
  for (const p of pages) {
    const t = p.text;
    if (wantsN) for (const m of t.matchAll(/\bn\s*=\s*(\d+)/g)) consider(p.page, t, m.index, m[0].length, 3, `the text states ${m[0]}`);
    if (wantsN) for (const m of t.matchAll(/(?<![\p{L}\d.,])(\d{1,4})\s+(?:consecutive\s+|adult\s+|eligible\s+)?(?:patients|participants|subjects|cases)\b/giu)) if (!yearLike(Number(m[1]))) consider(p.page, t, m.index, m[0].length, 2, `the text states "${m[0]}"`);
    if (sizeOnly) continue;
    for (const c of cs) for (const m of t.matchAll(c.re)) {
      const from = Math.max(0, m.index - 40), to = Math.min(t.length, m.index + m[0].length + 100);
      const win = t.slice(from, to);
      for (const n of [...win.matchAll(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)?/gu)]) {
        const x = numOf(n[0]); if (yearLike(x)) continue;
        const after = win.slice(n.index + n[0].length);
        const unitOk = !u || (u.family === 'percent' ? /^\s*%/.test(after) : FAMILIES[u.family][u.unit].test(after.slice(0, 14)) || (u.family === 'time' && /^\s*(?:[-–]|to|and)\s*\d/.test(after) && FAMILIES.time[u.unit].test(after.slice(0, 30))));
        if (!unitOk) continue;
        const dist = Math.abs(from + n.index - m.index);
        consider(p.page, t, m.index, m[0].length, 2 + (u ? 2 : 0) + (dist <= 40 ? 1 : 0), `the text states "${collapse(win.slice(n.index, n.index + n[0].length + 10))}" next to "${m[0]}"`);
      }
    }
  }
  return best;
}

/** Fields with no value that the text plainly states; see the heuristic at the top of this file. */
export function missedValues({ columns = [], proposals = [], values = {}, pages = [] } = {}) {
  const held = new Set();
  for (const [key, v] of Object.entries(values || {})) {
    const t = text(v).trim(); if (!t || isNR(t)) continue;
    const id = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    held.add(id.replace(/@arm\d+$/, ''));
  }
  for (const p of proposals || []) {
    if (p?.availability === 'present' && text(p.value ?? p.normalized_value).trim() && !isNR(text(p.value))) held.add(String(p.column_id).replace(/@arm\d+$/, ''));
  }
  const src = body(pages);
  const found = [];
  for (const c of columns) {
    if (held.has(c.id) || !c.id) continue;
    const m = matchColumn(c, src);
    if (m) found.push({ column: c.id, label: c.label || c.id, why: m.why, page: m.page, snippet: m.snippet, score: m.score });
  }
  return found.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, 12).map(({ score, ...rest }) => rest);
}
