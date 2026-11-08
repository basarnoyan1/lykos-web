// Descriptive statistics for a patient table, by group — the "Table 1/Table 2"
// of a clinical paper.
//
// Computed here rather than in R. These are exact order statistics and counts;
// sending them through WebR would mean starting an engine and waiting seconds
// for numbers a browser produces instantly. The two tests that accompany them
// (Kruskal-Wallis, Pearson chi-square) need only a chi-square upper tail, which
// is implemented below and checked against R in bench/describe.mjs.
//
// Nothing here decides significance. A p-value is reported beside the counts it
// came from, with the test named, so the reader can judge whether the test was
// appropriate (plan H4).
import { fisherExact } from './stats-tables.mjs';

// ---- distributions --------------------------------------------------------

// Lanczos approximation; accurate to ~15 significant figures for x > 0.
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(s, x), by series or continued fraction. */
function gammaP(s, x) {
  if (x <= 0) return 0;
  if (x < s + 1) {                       // series converges fast here
    let sum = 1 / s, term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - lgamma(s));
  }
  return 1 - gammaQcf(s, x);
}

/** Regularised upper incomplete gamma Q(s, x) by Lentz's continued fraction. */
function gammaQcf(s, x) {
  const TINY = 1e-300;
  let b = x + 1 - s, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;  if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x + s * Math.log(x) - lgamma(s));
}

/** P(X > q) for a chi-square with `df` degrees of freedom. */
export function pchisqUpper(q, df) {
  if (!(q > 0) || !(df > 0)) return 1;
  return q < df + 1 ? 1 - gammaP(df / 2, q / 2) : gammaQcf(df / 2, q / 2);
}

// ---- order statistics -----------------------------------------------------

/** Quantile by R's default (type 7). */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const median = sorted => quantile(sorted, 0.5);

function moments(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1
    ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    : NaN;
  return { mean, sd };
}

// ---- tests ----------------------------------------------------------------

/**
 * Kruskal-Wallis across groups, with the standard correction for ties.
 * Returns null when fewer than two groups have data.
 */
export function kruskalWallis(groups) {
  const present = groups.filter(g => g.values.length);
  if (present.length < 2) return null;
  const all = present.flatMap(g => g.values);
  const N = all.length;
  if (N < 3) return null;

  // Mid-ranks, so tied values share the average of the ranks they span.
  const order = all.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(N);
  const tieGroups = [];
  for (let i = 0; i < N;) {
    let j = i;
    while (j + 1 < N && order[j + 1][0] === order[i][0]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[order[k][1]] = mid;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }

  let at = 0, H = 0;
  for (const g of present) {
    const rs = rank.slice(at, at + g.values.length).reduce((a, b) => a + b, 0);
    H += rs * rs / g.values.length;
    at += g.values.length;
  }
  H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
  const tieCorrection = 1 - tieGroups.reduce((a, t) => a + t ** 3 - t, 0) / (N ** 3 - N);
  if (tieCorrection > 0) H /= tieCorrection;
  const df = present.length - 1;
  return { test: 'Kruskal–Wallis', statistic: H, df, p: pchisqUpper(H, df) };
}

/**
 * Pearson chi-square on a levels x groups table. `smallExpected` reports the
 * share of cells below 5, which is when the approximation stops holding.
 */
export function chiSquare(table) {
  const rows = table.length, colsN = table[0]?.length || 0;
  if (rows < 2 || colsN < 2) return null;
  const rowSum = table.map(r => r.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: colsN }, (_, j) =>
    table.reduce((a, r) => a + r[j], 0));
  const N = rowSum.reduce((a, b) => a + b, 0);
  if (!N) return null;

  let x2 = 0, small = 0, cells = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < colsN; j++) {
      const e = rowSum[i] * colSum[j] / N;
      cells++;
      if (e < 5) small++;
      if (e > 0) x2 += (table[i][j] - e) ** 2 / e;
    }
  const df = (rows - 1) * (colsN - 1);
  return {
    test: 'Pearson χ²', statistic: x2, df, p: pchisqUpper(x2, df),
    smallExpected: small / cells,
  };
}

// ---- table ----------------------------------------------------------------

const missing = v => v == null || String(v).trim() === '';
const isNum = v => !missing(v) && Number.isFinite(Number(v));

/**
 * A column that identifies a patient is not a variable. Summarising one yields
 * a level per row ("P001, 1 (0.9%)"), which is noise, so identifiers are left
 * out: anything carrying an id role, and any categorical column whose values
 * are nearly all distinct.
 */
export function isIdentifier(col, rows) {
  if (['id', 'study', 'identifier', 'subject-id', 'participant-id'].includes(col.role)) return true;
  const namedId = /^(?:id|identifier|label|(?:patient|participant|subject|record|study|case)(?:[\s_-]*(?:id|identifier|number|code|label|no))?)$/i;
  if ([col.id, col.name, col.label].some(name => name && namedId.test(String(name).trim()))) return true;
  if (['number', 'integer', 'boolean', 'category', 'date'].includes(col.type)) return false;
  const vals = rows.map(r => String(r[col.id] ?? '').trim()).filter(Boolean);
  if (vals.length < 8) return false;
  const distinct = new Set(vals).size;
  // A characteristic has few levels. Many levels, each covering a small share
  // of the cohort, describes which record a patient came from — a source of
  // provenance, not a variable to compare across groups.
  return distinct > 12 && distinct >= vals.length * 0.9;
}

/** Default clinical descriptives omit identifiers and unsummarised date fields. */
export const baselineColumns = (rows, columns, groupCol = null) => columns.filter(col => col.id !== groupCol && col.type !== 'date' && !isIdentifier(col, rows));
const booleanLevel = value => {
  if (missing(value)) return null;
  const text = String(value).trim().toLowerCase();
  return ['yes', 'true', '1'].includes(text) ? 'Yes' : ['no', 'false', '0'].includes(text) ? 'No' : null;
};
const isBooleanColumn = (col, values) => ['boolean', 'binary'].includes(col.type) || col.originalType === 'boolean'
  || col.role === 'event' && values.length > 0 && values.every(value => booleanLevel(value) != null);
export function descriptiveKind(col, rows) {
  const values = rows.map(row => row[col.id]).filter(value => !missing(value));
  if (isBooleanColumn(col, values) || ['category', 'text', 'date'].includes(col.type) || col.levels?.length) return 'categorical';
  return ['number', 'integer'].includes(col.type) || values.length > 0 && values.every(isNum) ? 'numeric' : 'categorical';
}
export function descriptiveConverter(col, rows = []) {
  const values = rows.map(row => row[col.id]).filter(value => !missing(value));
  if (isBooleanColumn(col, values)) return booleanLevel;
  return descriptiveKind(col, rows) === 'numeric' ? value => isNum(value) ? Number(value) : null : value => missing(value) ? null : String(value).trim();
}

/**
 * One summary row per column, split by `groupCol` (omit for a single column).
 * Types follow the codebook; values are inferred only for columns without a
 * declared type. Binary events are counts. Missing numeric cells are never zero.
 *
 * Groups keep the order they first appear in the data, not alphabetical order:
 * a comparison is reported in the order the review states it.
 */
export function describe(rows, columns, groupCol) {
  const groupNames = groupCol
    ? [...new Set(rows.map(r => String(r[groupCol] ?? '').trim() || '—'))]
    : [];
  const slices = [
    { name: 'Overall', rows },
    ...groupNames.map(g => ({
      name: g,
      rows: rows.filter(r => (String(r[groupCol] ?? '').trim() || '—') === g),
    })),
  ];

  const out = [], notes = ['Percentages use nonmissing observations for each variable; missing or invalid values are excluded per variable.'];
  const omitted = columns.filter(col => col.id !== groupCol && (col.type === 'date' || isIdentifier(col, rows)));
  if (omitted.length) notes.push(`Identifier or date fields omitted: ${omitted.map(col => col.name || col.label || col.id).join(', ')}.`);
  for (const col of baselineColumns(rows, columns, groupCol)) {
    const present = rows.map(r => r[col.id]).filter(v => !missing(v));
    if (!present.length) continue;
    const numeric = descriptiveKind(col, rows) === 'numeric';

    if (numeric) {
      const per = slices.map(s => {
        const xs = s.rows.map(r => r[col.id]).filter(isNum).map(Number).sort((a, b) => a - b);
        if (!xs.length) return { name: s.name, n: 0, missing: s.rows.length };
        const { mean, sd } = moments(xs);
        return {
          name: s.name, n: xs.length, missing: s.rows.length - xs.length,
          median: median(xs), q1: quantile(xs, 0.25), q3: quantile(xs, 0.75),
          min: xs[0], max: xs[xs.length - 1], mean, sd,
        };
      });
      const invalid = present.filter(v => !isNum(v)).length;
      if (invalid) notes.push(`${col.name || col.label || col.id}: ${invalid} nonnumeric ${invalid === 1 ? 'value was' : 'values were'} excluded.`);
      out.push({
        column: col, kind: 'numeric', slices: per,
        test: groupCol ? kruskalWallis(per.slice(1).map((p, i) => ({
          values: slices[i + 1].rows.map(r => r[col.id]).filter(isNum).map(Number),
        }))) : null,
      });
    } else {
      const binary = isBooleanColumn(col, present), level = binary ? booleanLevel : value => missing(value) ? null : String(value).trim();
      const observed = [...new Set(rows.map(r => level(r[col.id])).filter(v => v != null))].sort();
      const declared = binary ? ['No', 'Yes'] : (col.levels || []).map(String);
      const levels = [...declared.filter(l => observed.includes(l)), ...observed.filter(l => !declared.includes(l))];
      const invalid = binary ? present.filter(v => booleanLevel(v) == null).length : 0;
      if (invalid) notes.push(`${col.name || col.label || col.id}: ${invalid} invalid yes/no ${invalid === 1 ? 'value was' : 'values were'} excluded.`);
      const per = slices.map(s => {
        const known = s.rows.map(r => level(r[col.id])).filter(v => v != null);
        return {
          name: s.name, n: known.length, missing: s.rows.length - known.length,
          counts: Object.fromEntries(levels.map(l =>
            [l, known.filter(value => value === l).length])),
        };
      });
      const table = levels.map(l => per.slice(1).map(p => p.counts[l] || 0));
      let test = groupCol && levels.length > 1 ? chiSquare(table) : null;
      if (test?.smallExpected > 0) {
        if (table.length === 2 && table[0].length === 2) {
          const exact = fisherExact(table);
          if (Number.isFinite(exact.p)) test = { ...exact, test: 'Fisher exact' };
        }
        if (test.test !== 'Fisher exact') notes.push(`${col.name || col.label || col.id}: Pearson χ² is approximate; ${(test.smallExpected * 100).toFixed(0)}% of expected cell counts are below 5.`);
      }
      out.push({
        column: col, kind: 'categorical', levels, slices: per,
        test,
      });
    }
  }
  if (groupCol && rows.some(r => missing(r[groupCol]))) notes.push('Rows missing the grouping variable are retained in the “—” group.');
  return { groups: ['Overall', ...groupNames], counts: Object.fromEntries(slices.map(s => [s.name, s.rows.length])), rows: out, notes };
}

// ---- formatting -----------------------------------------------------------

export const num = (v, d = 1) =>
  Number.isFinite(v) ? v.toFixed(d).replace(/\.0+$/, '') : '—';

export const pValue = p =>
  !Number.isFinite(p) ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3);

/** "24 (12–48)" — median with the interquartile range, the usual clinical form. */
export const medianIQR = s =>
  s.n ? `${num(s.median)} (${num(s.q1)}–${num(s.q3)})` : '—';

export const rangeOf = s => (s.n ? `${num(s.min)}–${num(s.max)}` : '—');

export const countPct = (s, level) => {
  const c = s.counts?.[level] ?? 0;
  return s.n ? `${c} (${(100 * c / s.n).toFixed(1)}%)` : '—';
};
