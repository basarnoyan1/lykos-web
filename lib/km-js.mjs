// Kaplan–Meier in JavaScript, for Make's survival preview (views/summary-make.mjs) drawn at once from a dataset's rows: the product-limit
// estimate per group with Greenwood's variance and survfit's log-log interval (conf.type = "log-log", the app's survival run's choice), the
// number at risk, each group's median, and the log-rank test as survdiff gives it (the hypergeometric sums, rho = 0). The app's survival
// run (lib/survival-run.mjs, R's survival) stays the analysis of record; this gives the same numbers for the figure and its p, checked in
// app/test/km-js.test.mjs against survival 3.x (scratch oracle.R). Pure.
import { pchisqUpper } from './describe.mjs';

const Z975 = 1.959963984540054;

/**
 * One group's step function from `rows` [{ time, event }] (event 1 or true at an event, 0 at a censoring): `{ group, n, events, steps:
 * [{ time, surv, lo, hi, nRisk, nEvent, nCensor }], atRisk(t), median: { est } }`, the steps at every distinct time (survfit's summary lists
 * them all; the figure draws the events). The interval is log-log: exp(−exp(log(−log S) ± z · se / log S)) with Greenwood's se of log S.
 */
export function kmGroup(rows, group = 'All') {
  const r = rows.map(x => ({ time: Number(x.time), event: x.event === true || Number(x.event) === 1 })).filter(x => Number.isFinite(x.time) && x.time >= 0).sort((a, b) => a.time - b.time);
  const steps = []; let s = 1, atRisk = r.length, i = 0, g = 0, events = 0;
  while (i < r.length) {
    const t = r[i].time; let ev = 0, all = 0;
    while (i < r.length && r[i].time === t) { if (r[i].event) ev++; all++; i++; }
    const nRisk = atRisk;
    if (ev) { s *= 1 - ev / nRisk; g += ev / (nRisk * (nRisk - ev)); events += ev; }
    let lo = null, hi = null;
    if (s > 0 && s < 1 && Number.isFinite(g)) { const se = Math.sqrt(g), l = Math.log(-Math.log(s)), d = Z975 * se / Math.log(s); lo = Math.exp(-Math.exp(l - d)); hi = Math.exp(-Math.exp(l + d)); }   // log s < 0: the sign of d turns the band round
    steps.push({ time: t, surv: s, lo, hi, nRisk, nEvent: ev, nCensor: all - ev });
    atRisk -= all;
  }
  const med = steps.find(x => x.surv <= 0.5 + 1e-12);
  const times = steps.map(x => x.time);
  return { group, n: r.length, events, steps, median: { est: med ? med.time : null }, maxTime: times.length ? Math.max(...times) : 0,
    atRisk: null, survival: steps.filter(x => x.nEvent > 0).map(x => ({ time: x.time, surv: x.surv, lo: x.lo, hi: x.hi, nRisk: x.nRisk })) };
}

/** Number at risk at time t: patients whose follow-up is at least t. */
export const riskAt = (rows, t) => rows.filter(x => Number(x.time) >= t).length;

/**
 * The estimate for a figure (lib/survival-fig.mjs kmFigure reads `km.by`): one group per level of `group` in the rows (every row in 'All'
 * without one), in `levels` order when given, with `atRisk` at `times`.
 */
export function kmEstimate(rows, { levels = null, times = null } = {}) {
  const names = levels || [...new Set(rows.map(x => x.group ?? 'All'))];
  const by = names.map(name => { const mine = rows.filter(x => (x.group ?? 'All') === name); const g = kmGroup(mine, name);
    g.atRisk = (times || []).map(t => ({ time: t, n: riskAt(mine, t) })); return g; }).filter(g => g.n);
  return { by, overall: kmGroup(rows, 'All') };
}

/**
 * The log-rank test over the groups of `rows` as survdiff computes it (rho = 0): at each event time the observed and expected events per
 * group from the hypergeometric distribution, the statistic (O − E)ᵀ V⁻¹ (O − E) over all groups but the last, on groups − 1 df.
 */
export function logRank(rows) {
  const names = [...new Set(rows.map(x => x.group ?? 'All'))], G = names.length;
  if (G < 2) return { chisq: null, df: 0, p: null, observed: [], expected: [] };
  const r = rows.map(x => ({ time: Number(x.time), event: x.event === true || Number(x.event) === 1, g: names.indexOf(x.group ?? 'All') })).sort((a, b) => a.time - b.time);
  const O = Array(G).fill(0), E = Array(G).fill(0), V = Array.from({ length: G }, () => Array(G).fill(0));
  let i = 0;
  while (i < r.length) {
    const t = r[i].time, atRisk = Array(G).fill(0); for (const x of r.slice(i)) atRisk[x.g]++;
    const n = atRisk.reduce((a, b) => a + b, 0); let d = 0; const dg = Array(G).fill(0);
    while (i < r.length && r[i].time === t) { if (r[i].event) { d++; dg[r[i].g]++; } i++; }
    if (!d) continue;
    for (let a = 0; a < G; a++) {
      O[a] += dg[a]; E[a] += d * atRisk[a] / n;
      for (let b = 0; b < G; b++) V[a][b] += n > 1 ? d * (atRisk[a] / n) * ((a === b ? 1 : 0) - atRisk[b] / n) * (n - d) / (n - 1) : 0;
    }
  }
  // the statistic on the first G − 1 groups (the last is determined by them)
  const m = G - 1, u = O.slice(0, m).map((o, a) => o - E[a]), Vm = V.slice(0, m).map(row => row.slice(0, m));
  const inv = inverse(Vm);
  if (!inv) return { chisq: null, df: m, p: null, observed: O, expected: E };
  const chisq = u.reduce((s, ua, a) => s + ua * inv[a].reduce((t2, x, b) => t2 + x * u[b], 0), 0);
  return { chisq, df: m, p: pchisqUpper(chisq, m), observed: O, expected: E, groups: names };
}

function inverse(M) {
  const n = M.length, A = M.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-300) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
}
