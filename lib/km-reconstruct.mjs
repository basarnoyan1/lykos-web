// Patient-level data from a published Kaplan–Meier curve (plan §4.8a).
//
// Guyot P, Ades AE, Ouwens MJNM, Welton NJ. Enhanced secondary analysis of
// survival data: reconstructing the data from published Kaplan–Meier survival
// curves. BMC Med Res Methodol 2012;12:9. The published curve is read as
// (time, survival) points; the numbers at risk printed under it fix how many
// patients were censored between two printed times; within an interval the
// censoring is taken as evenly spread, and the events follow from the drop in
// survival. The result is one row per patient, not the original patients: it
// is always marked reconstructed, with the method (lib/km-ipd.mjs).
//
// This is written from the paper's description. IPDfromKM and reconstructKM
// (GPL) were not consulted as code.

const round = Math.round;

/**
 * Digitised points as a survival function: sorted by time, starting at
 * (0, 1), never rising, one point per time (the lowest survival there).
 * The times and the survival are as given; only order and the impossible are
 * repaired.
 */
export function cleanCurve(points, { tMax = Infinity } = {}) {
  const pts = points.filter(p => Number.isFinite(p.t) && Number.isFinite(p.s) && p.t <= tMax)
    .map(p => ({ t: Math.max(0, p.t), s: Math.min(1, Math.max(0, p.s)) }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  if (pts[0].t > 0 || pts[0].s < 1) pts.unshift({ t: 0, s: 1 });
  const out = [];
  let s = 1;
  for (const p of pts) {
    s = Math.min(s, p.s);
    const q = { t: p.t, s };
    if (out.length && out[out.length - 1].t === q.t) out[out.length - 1] = q; else out.push(q);
  }
  return out;
}

/**
 * @param points  [{t, s}] the digitised curve (cleanCurve is applied)
 * @param risk    [{t, n}] numbers at risk at printed times, the first at the
 *                start of follow-up; more than one interval is far better
 * @param opts    totalEvents: the events the paper reports for this arm
 * @returns { rows: [{time, event}], events, censored, n, warnings, curve }
 */
export function reconstructKm(points, risk, { totalEvents = null } = {}) {
  const warnings = [];
  const S = cleanCurve(points);
  if (S.length < 2) throw new Error('The curve needs at least two points');
  const R = risk.filter(r => Number.isFinite(r.t) && Number.isFinite(r.n) && r.n >= 0)
    .map(r => ({ t: r.t, n: round(r.n) })).sort((a, b) => a.t - b.t);
  if (!R.length) throw new Error('Enter the number at risk at the start');
  if (R[0].t > 0) R.unshift({ t: 0, n: R[0].n });
  const N0 = R[0].n;
  if (!(N0 > 0)) throw new Error('The number at risk at the start is zero');

  // A risk time beyond the end of the curve has no points to attach to.
  const tEnd = S[S.length - 1].t;
  let m = R.length;
  while (m > 1 && R[m - 1].t > tEnd) { m--; warnings.push(`The curve ends before ${R[m].t}; that number at risk was not used`); }
  R.length = m;
  const t = S.map(p => p.t), s = S.map(p => p.s), N = t.length;

  // lo[i]: first point at or after risk time i; up[i]: last point before risk time i+1.
  const lo = R.map(r => { let k = 0; while (k < N - 1 && t[k] < r.t) k++; return k; });
  const up = R.map((_, i) => (i === m - 1 ? N - 1 : lo[i + 1] - 1));
  for (let i = 0; i < m; i++) if (up[i] < lo[i]) up[i] = lo[i];

  const nHat = new Array(N + 1).fill(0);
  const d = new Array(N).fill(0);
  const cen = new Array(N).fill(0);     // censored between point k and point k+1
  const km = new Array(N).fill(1);
  const lastAt = new Array(m).fill(0);  // the last point with an event before interval i

  // One pass through interval i: events and numbers at risk from the drop in
  // survival, given the censoring in it. Returns the number at risk that
  // remains at the end.
  const censorTimes = (c, a, b) => Array.from({ length: c }, (_, j) => a + (j + 1) * (b - a) / (c + 1));
  const place = (i, c, aT, bT) => {
    for (let k = lo[i]; k <= up[i]; k++) cen[k] = 0;
    for (const x of censorTimes(c, aT, bT)) {
      // the sub-interval (t_k, t_k+1] holding x
      let k = lo[i];
      while (k < up[i] && x > t[k + 1]) k++;
      cen[k]++;
    }
  };
  const run = i => {
    nHat[lo[i]] = R[i].n;
    let last = lastAt[i];
    for (let k = lo[i]; k <= up[i]; k++) {
      if (i === 0 && k === lo[0]) { d[k] = 0; km[k] = 1; }
      else {
        const ref = km[last] > 0 ? km[last] : 1e-12;
        d[k] = nHat[k] > 0 ? Math.min(nHat[k], Math.max(0, round(nHat[k] * (1 - s[k] / ref)))) : 0;
        km[k] = km[last] * (nHat[k] > 0 ? 1 - d[k] / nHat[k] : 1);
      }
      nHat[k + 1] = Math.max(0, nHat[k] - d[k] - cen[k]);
      if (d[k] !== 0) last = k;
    }
    return last;
  };

  for (let i = 0; i < m - 1; i++) {
    const aT = t[lo[i]], bT = t[lo[i + 1]];
    const target = R[i + 1].n;
    let c = Math.max(0, round(R[i].n * s[lo[i + 1]] / (s[lo[i]] || 1e-12) - target));
    let best = null;
    for (let it = 0; it < 200; it++) {
      place(i, c, aT, bT);
      const last = run(i);
      const diff = nHat[lo[i + 1]] - target;
      if (!best || Math.abs(diff) < best.abs) best = { abs: Math.abs(diff), c, diff };
      if (diff === 0 || (diff < 0 && c <= 0)) { lastAt[i + 1] = last; break; }
      c = Math.max(0, c + diff);
      if (it === 199) { c = best.c; place(i, c, aT, bT); lastAt[i + 1] = run(i); warnings.push(`Interval from ${R[i].t}: numbers at risk not matched exactly (off by ${best.diff})`); }
    }
    // the next interval starts from what the paper printed
    nHat[lo[i + 1]] = target;
  }

  // The last interval: the paper's total events fix the censoring in it;
  // without them, everyone left at the end is censored there.
  const iL = m - 1;
  const sumD = () => d.reduce((a, b) => a + b, 0);
  if (totalEvents != null && Number.isFinite(totalEvents)) {
    let c = 0, best = null;
    for (let it = 0; it < 200; it++) {
      place(iL, c, t[lo[iL]], t[up[iL]]);
      lastAt[iL] = lastAt[iL];
      run(iL);
      const diff = sumD() - totalEvents;
      if (!best || Math.abs(diff) < best.abs) best = { abs: Math.abs(diff), c, diff };
      if (diff === 0 || (diff < 0 && c <= 0)) break;
      c = Math.max(0, c + diff);
      if (it === 199) { place(iL, best.c, t[lo[iL]], t[up[iL]]); run(iL); warnings.push(`Total events not matched exactly (off by ${best.diff})`); }
    }
  } else {
    place(iL, 0, t[lo[iL]], t[up[iL]]);
    run(iL);
  }

  // Patients: events at their times, censored at the middle of the digitised
  // interval they fall in, the rest still under follow-up at the end.
  const rows = [];
  for (let k = 0; k < N; k++) for (let j = 0; j < d[k]; j++) rows.push({ time: t[k], event: 1 });
  const events = rows.length;
  let censored = 0;
  for (let k = 0; k < N - 1; k++) for (let j = 0; j < cen[k]; j++) { rows.push({ time: (t[k] + t[k + 1]) / 2, event: 0 }); censored++; }
  if (rows.length > N0) {
    const drop = rows.length - N0;
    warnings.push(`${drop} more patients than at the start were implied; censored ones were removed`);
    let removed = 0;
    for (let k = rows.length - 1; k >= 0 && removed < drop; k--) if (!rows[k].event) { rows.splice(k, 1); removed++; censored--; }
  }
  while (rows.length < N0) { rows.push({ time: t[N - 1], event: 0 }); censored++; }
  if (totalEvents != null && events !== totalEvents) warnings.push(`Reconstructed ${events} events; the paper reports ${totalEvents}`);
  rows.sort((a, b) => a.time - b.time || b.event - a.event);
  return { rows, events, censored, n: N0, warnings, curve: S };
}

// ---- Kaplan–Meier of the reconstructed patients (to show against the curve) ----------------

/** Product-limit estimate: [{t, s}] at each event time, starting (0, 1). */
export function kaplanMeier(rows) {
  const r = [...rows].sort((a, b) => a.time - b.time);
  const out = [{ t: 0, s: 1 }];
  let s = 1, atRisk = r.length, i = 0;
  while (i < r.length) {
    const t = r[i].time; let ev = 0, all = 0;
    while (i < r.length && r[i].time === t) { ev += r[i].event ? 1 : 0; all++; i++; }
    if (ev) { s *= 1 - ev / atRisk; out.push({ t, s }); }
    atRisk -= all;
  }
  return out;
}

/** The smallest time at which the estimate reaches 0.5 or less; null when it does not. */
export function medianOf(km) {
  const p = km.find(x => x.s <= 0.5 + 1e-12);
  return p ? p.t : null;
}

/** The estimate at a time (right-continuous step function). */
export function survivalAt(km, time) {
  let s = 1;
  for (const p of km) { if (p.t > time) break; s = p.s; }
  return s;
}

/** How far the reconstructed estimate is from the digitised curve: mean and largest absolute difference in survival. */
export function curveError(rows, curve) {
  const km = kaplanMeier(rows);
  let sum = 0, max = 0;
  for (const p of curve) { const e = Math.abs(survivalAt(km, p.t) - p.s); sum += e; if (e > max) max = e; }
  return { mean: sum / curve.length, max };
}
