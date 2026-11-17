// The CUSUM learning curve of a surgical innovation (IDEAL Stage 2a item 8, Stage 2b items 5b and 10; PROCESS 6j; plan W7): the cases
// in their order, each case's outcome less a target, summed. For a measure (operative time, blood loss) the target is the series mean
// unless one is given; for a failure (a complication, a conversion) each case is 1 or 0 and the target is the acceptable failure rate,
// the observed rate unless one is given. While the team learns, the curve climbs (results worse than the target); where results reach
// the target it turns. The turning case, the curve's first highest point (its lowest when the outcome rises with experience, as a
// success rate does), divides the learning phase from the one after; both phases are described, not tested, since the split is read
// from the same data. Pure; app/test/cusum.test.mjs checks it against R's cumsum and which.max.

/**
 * `cases`: [{ order, y }], `order` the case's place in the sequence (a number or a date's time), `y` its outcome. Cases without a
 * finite order or outcome are dropped and counted; equal orders keep their given order. Null with fewer than two cases. Returns
 * { n, mean, target, series: [{ case, order, y, cusum }], turn, before: { n, mean }, after: { n, mean }, dropped }.
 */
export function cusum(cases, { target = null, direction = 'falls' } = {}) {
  const ok = cases.map((c, i) => ({ order: c?.order, y: c?.y, i })).filter(c => Number.isFinite(c.order) && Number.isFinite(c.y));
  ok.sort((a, b) => a.order - b.order || a.i - b.i);
  const n = ok.length;
  if (n < 2) return null;
  const mean = ok.reduce((s, c) => s + c.y, 0) / n, t = Number.isFinite(target) ? target : mean;
  let sum = 0;
  const series = ok.map((c, k) => { sum += c.y - t; return { case: k + 1, order: c.order, y: c.y, cusum: sum }; });
  let turn = 0;
  for (let k = 1; k < n; k++) if (direction === 'rises' ? series[k].cusum < series[turn].cusum : series[k].cusum > series[turn].cusum) turn = k;
  const phase = xs => ({ n: xs.length, mean: xs.length ? xs.reduce((s, c) => s + c.y, 0) / xs.length : null });
  return { n, mean, target: t, series, turn: turn + 1, before: phase(ok.slice(0, turn + 1)), after: phase(ok.slice(turn + 1)), dropped: cases.length - n };
}
