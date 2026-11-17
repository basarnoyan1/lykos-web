// How far a run is and how long it has left, from its card (owner, 1 Nov 2026: "3 of 5 steps, 48 min" said nothing about how far a step was
// or how long was left). A step may carry work units: `done` of `total` `unit` ("records", "trials", "PDFs") with the `item` under way
// ("Gruber 2018") and `samples`, the [time, done] points the writer kept (tools/activity-writer.mjs addSample). The rate is read from the
// samples and smoothed (the whole step's rate blended with the recent one), and the time left is a range from the two; until a step has
// enough points the page says "Estimating…". A step not started may declare `estimateMs`; one with no estimate takes the time learned from
// the steps done (the rate of a step with the same unit, else their mean). The run's share weights each step by its expected time, so a
// long step counts for more than a short one; a card with no times at all counts its steps. Everything here is pure: lib/agent-activity.mjs,
// lib/agent-card.mjs, views/agents.mjs and the writer's `show` read it.

/** The fewest units, the shortest span and the fewest points before a rate is given: under these the page says "Estimating…". */
export const MIN_UNITS = 3;
export const MIN_SPAN_MS = 15000;
export const SLOW_SPAN_MS = 120000;   // one unit over two minutes is a rate too (a PDF fetched every three minutes)
export const SAMPLES_MAX = 40;
/** A step whose time runs past its estimate by more than this share is said to be over it. */
export const OVER_SHARE = 0.1;

const MIN = 60000, HOUR = 60 * MIN;
const fin = v => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
const ms = v => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(t) ? t : null; };

/** "20 min", "1 h 30 min", "1.5 h", "90 s", "2h", "45" (minutes) → milliseconds; null when it is not a duration. */
export function parseDuration(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? Math.round(text * MIN) : null;
  const t = String(text ?? '').trim().toLowerCase().replace(/^(about|around|~)\s*/, '');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(+t * MIN);
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let total = 0, any = false, rest = t;
  for (const m of t.matchAll(re)) {
    any = true; rest = rest.replace(m[0], '');
    const n = +m[1], u = m[2][0];
    total += u === 'h' ? n * HOUR : u === 'm' ? n * MIN : n * 1000;
  }
  return any && !rest.replace(/[\s,and]+/g, '') ? Math.round(total) : null;
}

/** The samples with a new point: one per change of `done` (the first point of a step is kept), thinned to SAMPLES_MAX, oldest halved first. */
export function addSample(samples, done, t = Date.now()) {
  const out = (Array.isArray(samples) ? samples : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]]);
  const d = fin(done);
  if (d == null) return out;
  const last = out.at(-1);
  if (last && last[1] === d) return out;   // no progress: the point already there says when it got here
  if (last && d < last[1]) out.length = 0; // counted again from the start: a new series
  out.push([t, d]);
  while (out.length > SAMPLES_MAX) { const half = Math.floor(out.length / 2); for (let i = half - 1; i >= 1; i -= 2) out.splice(i, 1); }
  return out;
}

/** The samples of a card or step, cleaned: [[t, done]] in time order. */
export function samplesOf(raw) {
  return (Array.isArray(raw) ? raw : []).map(p => (Array.isArray(p) ? [ms(p[0]), fin(p[1])] : null)).filter(p => p && p[0] != null && p[1] != null).sort((a, b) => a[0] - b[0]).slice(-SAMPLES_MAX);
}

/**
 * The rate of a series in units per ms: { mid, lo, hi } (lo the slower, hi the faster), or null while it has too few points to say. `mid`
 * blends the whole series' rate with the recent part's, so a step that speeds up or slows down is followed without jumping; `lo` also
 * counts the time since the last point when it is longer than a unit takes (a slow item).
 */
export function rateOf(samples, now = Date.now()) {
  const s = samplesOf(samples);
  if (s.length < 2) return null;
  const [t0, d0] = s[0], [tl, dl] = s.at(-1), span = tl - t0, units = dl - d0;
  if (units <= 0 || span <= 0) return null;
  if (!((units >= MIN_UNITS && span >= MIN_SPAN_MS) || (units >= 1 && span >= SLOW_SPAN_MS))) return null;
  const all = units / span;
  // the recent part: the points of the last 40 % of the span, at least the last three
  const cut = tl - span * 0.4;
  let k = s.findIndex(p => p[0] >= cut); if (k < 0 || k > s.length - 3) k = Math.max(0, s.length - 3);
  const [tk, dk] = s[k], recent = tl > tk && dl > dk ? (dl - dk) / (tl - tk) : all;
  const mid = 0.6 * recent + 0.4 * all;
  const quiet = Math.max(0, now - tl), sinceNow = units / (span + quiet);
  const lo = Math.min(all, recent, quiet > 1 / mid ? sinceNow : Infinity), hi = Math.max(all, recent);
  return { mid, lo: Math.min(lo, mid), hi: Math.max(hi, mid) };
}

/** The time a series has left to `total`: { ms, lo, hi } (lo the soonest), or null while its rate is not known. */
export function leftOf(samples, total, now = Date.now()) {
  const r = rateOf(samples, now), s = samplesOf(samples), t = fin(total);
  if (!r || t == null || !s.length) return null;
  const left = Math.max(0, t - s.at(-1)[1]);
  if (!left) return { ms: 0, lo: 0, hi: 0 };
  // the item under way has been worked on since the last point: that part of a unit's time is spent already
  const credit = Math.min(Math.max(0, now - s.at(-1)[0]), 0.9 / r.mid);
  const mid = Math.max(0, left / r.mid - credit), lo = Math.max(0, left / r.hi - credit), hi = Math.max(mid, left / r.lo - credit * 0.5);
  return { ms: mid, lo: Math.min(lo, mid * 0.9), hi: Math.max(hi, mid * 1.1) };
}

const unitsOf = x => {
  const total = fin(x?.total), done = fin(x?.done);
  return total != null && total > 0 ? { done: Math.max(0, Math.min(done ?? 0, total)), total, unit: String(x.unit || '').trim(), item: String(x.item || '').trim() } : null;
};

/**
 * One step's timing: { units, elapsed, left, estimating, rate, declared, expected, learned, over, share }. `left` { ms, lo, hi } or null;
 * `estimating` true when it counts units but has too few points yet; `expected` the step's whole time as far as it can be told (done: what
 * it took; running: elapsed and left; ahead: declared, else `learn(step)`), `learned` true when that is the learned one; `over` how far a
 * running step is past its declared estimate (0 when it is not); `share` how much of it is done (units, else time against its estimate).
 */
export function stepTiming(step, now = Date.now(), learn = () => null) {
  const st = step?.state || 'waiting', units = unitsOf(step), declared = fin(step?.estimateMs);
  const started = ms(step?.started), ended = ms(step?.ended);
  const out = { state: st, units, elapsed: null, left: null, estimating: false, rate: null, declared, expected: null, learned: false, over: 0, share: null };
  if (st === 'done') {
    out.elapsed = started != null && ended != null ? Math.max(0, ended - started) : null;
    out.expected = out.elapsed; out.share = 1;
    out.rate = units && out.elapsed ? units.total / out.elapsed : null;
    return out;
  }
  if (st === 'running') {
    out.elapsed = started != null ? Math.max(0, now - started) : null;
    if (units) {
      const samples = step.samples?.length ? step.samples : started != null ? [[started, 0]] : [];
      const r = rateOf(samples, now);
      out.rate = r?.mid ?? null;
      out.left = units.done >= units.total ? { ms: 0, lo: 0, hi: 0 } : leftOf(samples, units.total, now);
      out.estimating = !out.left;
      out.share = units.done / units.total;
      // no rate yet: a declared estimate still says something
      if (!out.left && declared != null && out.elapsed != null) out.left = { ms: Math.max(0, declared - out.elapsed), lo: Math.max(0, declared * 0.8 - out.elapsed), hi: Math.max(0, declared * 1.25 - out.elapsed), declared: true };
    } else if (declared != null && out.elapsed != null) {
      out.left = { ms: Math.max(0, declared - out.elapsed), lo: Math.max(0, declared * 0.8 - out.elapsed), hi: Math.max(0, declared * 1.25 - out.elapsed), declared: true };
      out.share = Math.min(0.95, out.elapsed / Math.max(1, declared));
    }
    if (declared != null && out.elapsed != null && out.elapsed > declared * (1 + OVER_SHARE)) out.over = out.elapsed - declared;
    // past its estimate and nothing better: it is not "0 min left", it is unknown
    if (out.left?.declared && out.over) out.left = null;
    out.expected = out.elapsed != null && out.left ? out.elapsed + out.left.ms : declared != null ? Math.max(declared, out.elapsed || 0) : null;
    return out;
  }
  const l = declared == null ? learn(step) : null;
  out.expected = declared ?? l;
  out.learned = declared == null && l != null;
  return out;
}

/**
 * The whole run: { share, stepAt, steps, elapsed, left, partial, unknown, estimating, finishAt, over, timings, units, current }.
 * `a` is a card as lib/agent-activity.mjs reads it (steps with their units and times, or a card's own done/total/unit/samples when it
 * names no steps; `since`, `estimateMs`). `left` { ms, lo, hi } is the time to the end as far as it can be told; `partial` when some steps
 * ahead have no estimate (it is then the least), `unknown` how many; `estimating` when the running step counts units but has too few points;
 * `finishAt` (ms) only when the whole is known.
 */
export function runTiming(a, now = Date.now()) {
  const since = ms(a?.since);
  const elapsed = since != null ? Math.max(0, (ms(a?.ended) ?? now) - since) : null;
  const raw = Array.isArray(a?.steps) ? a.steps : [];
  // a card without named steps is one step: its own count and estimate
  const steps = raw.length ? raw : [{ name: a?.current || '', state: a?.ended ? 'done' : 'running', started: a?.since, ended: a?.ended,
    done: a?.done, total: a?.total, unit: a?.unit, item: a?.item || a?.current, samples: a?.samples, estimateMs: a?.estimateMs }];
  const done = steps.filter(s => s.state === 'done');
  // what is learned from the steps done: a unit's rate, and how long a step took
  const rates = new Map(), took = [];
  for (const s of done) {
    const t = stepTiming(s, now);
    if (t.elapsed != null) took.push(t.elapsed);
    if (t.units?.unit && t.rate) rates.set(t.units.unit, t.rate);
  }
  const running0 = steps.map(s => (s.state === 'running' ? stepTiming(s, now) : null));
  for (const t of running0) if (t?.units?.unit && t.rate && !rates.has(t.units.unit)) rates.set(t.units.unit, t.rate);
  const mean = took.length ? took.reduce((x, y) => x + y, 0) / took.length : null;
  const learn = s => { const u = unitsOf(s); return u?.unit && rates.has(u.unit) ? u.total / rates.get(u.unit) : mean; };
  const timings = steps.map((s, i) => running0[i] || stepTiming(s, now, learn));
  const at = steps.findIndex(s => s.state === 'running');
  const run = at >= 0 ? timings[at] : null;
  // the share: each step weighted by its expected time, when every step has one; else each step alike, the running one by its units
  const known = timings.every(t => t.expected != null && t.expected > 0);
  let share;
  if (!steps.length) share = null;
  else if (known && timings.length > 1) {
    const total = timings.reduce((x, t) => x + t.expected, 0);
    const got = timings.reduce((x, t) => x + (t.state === 'done' ? t.expected : t.state === 'running' ? t.expected * (t.share ?? Math.min(0.95, (t.elapsed || 0) / t.expected)) : 0), 0);
    share = total ? got / total : null;
  } else {
    const n = timings.length, d = timings.filter(t => t.state === 'done').length;
    share = (d + (run?.share ?? 0)) / n;
    if (!raw.length && run && run.share == null) share = null;   // one step that counts nothing: a moving bar
  }
  if (a?.ended && !a?.failed) share = 1;
  // the time left: the running step's, then each step ahead's
  let left = null, partial = false, unknown = 0, estimating = false;
  const open = !a?.ended;
  if (open) {
    const ahead = timings.filter(t => t.state === 'waiting');
    const parts = [];
    if (run) { if (run.left) parts.push(run.left); else { estimating = !!run.estimating; partial = true; if (!run.estimating) unknown++; } }
    for (const t of ahead) { if (t.expected != null) parts.push({ ms: t.expected, lo: t.expected * (t.learned ? 0.6 : 0.8), hi: t.expected * (t.learned ? 1.6 : 1.25) }); else { partial = true; unknown++; } }
    if (parts.length) left = parts.reduce((x, p) => ({ ms: x.ms + p.ms, lo: x.lo + p.lo, hi: x.hi + p.hi }), { ms: 0, lo: 0, hi: 0 });
    // a run with a declared estimate of its own and no better word
    const own = fin(a?.estimateMs);
    if (!left && own != null && elapsed != null && raw.length) { left = { ms: Math.max(0, own - elapsed), lo: Math.max(0, own * 0.8 - elapsed), hi: Math.max(0, own * 1.25 - elapsed) }; partial = false; unknown = 0; }
    if (!left && !run && !ahead.length) partial = false;
  }
  const over = open && fin(a?.estimateMs) != null && elapsed != null && elapsed > fin(a.estimateMs) * (1 + OVER_SHARE) ? elapsed - fin(a.estimateMs) : 0;
  const finishAt = open && left && !partial && !estimating ? now + left.ms : null;
  return { share: share == null ? null : Math.max(0, Math.min(1, share)), stepAt: at >= 0 ? at + 1 : done.length, steps: raw.length, elapsed, left, partial, unknown, estimating,
    finishAt, over, timings: raw.length ? timings : [], units: run?.units || null, rate: run?.rate ?? null, step: run || null };
}

// ---- in words ----

const two = n => String(n).padStart(2, '0');
/** A duration as the page says it, rounded as far as it is known: "under a minute", "4 min", "25 min", "1 h 20 min". */
export function durationText(t) {
  const v = fin(t);
  if (v == null) return '';
  if (v < 45000) return 'under a minute';
  const m = v < 15 * MIN ? Math.max(1, Math.round(v / MIN)) : v < HOUR ? Math.round(v / (5 * MIN)) * 5 : Math.round(v / (10 * MIN)) * 10;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
/** "about 12 min", "10–15 min", "1–2 h": a range when its ends differ by more than a quarter, else "about". */
export function rangeText(r) {
  if (!r) return '';
  if (r.ms < 45000 && r.hi < 90000) return 'under a minute';
  const a = durationText(r.lo), b = durationText(r.hi), mid = durationText(r.ms);
  if (!a || !b || a === b || r.hi <= r.ms * 1.25 && r.lo >= r.ms * 0.8) return `about ${mid}`;
  if (a === 'under a minute') return `up to ${b}`;
  const [na, ua] = [a.replace(/ (min|h)$/, ''), a.match(/(min|h)$/)?.[1]], [nb, ub] = [b.replace(/ (min|h)$/, ''), b.match(/(min|h)$/)?.[1]];
  return ua && ua === ub && /^\d+$/.test(na) && /^\d+$/.test(nb) ? `${na}–${nb} ${ua}` : `${a} to ${b}`;
}
/** What the run has left: "About 12 min left", "10–15 min left", "At least 25 min left", "Estimating…", '' when nothing can be said. */
export function leftText(t) {
  if (!t) return '';
  if (t.estimating && !t.left) return 'Estimating…';
  if (!t.left) return '';
  const r = rangeText(t.left);
  if (t.partial) return `At least ${durationText(t.left.ms)} left`;
  return `${r.charAt(0).toUpperCase()}${r.slice(1)} left`;
}
/** "Done around 14:30" (to five minutes, since it is an estimate). */
export function finishText(at) {
  const t = fin(at);
  if (t == null) return '';
  const d = new Date(Math.round(t / (5 * MIN)) * 5 * MIN);
  return `Done around ${two(d.getHours())}:${two(d.getMinutes())}`;
}
const unitWord = (u, n) => {
  const w = String(u || 'items');
  if (n !== 1) return w;
  return /PDFs$/.test(w) ? w.slice(0, -1) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /(ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w;
};
const num = n => Number(n).toLocaleString('en-US');
/** "12 records a minute", "1 PDF every 3 min", "2 records a second". */
export function rateText(perMs, unit = 'items') {
  const r = fin(perMs);
  if (!r || r <= 0) return '';
  const perMin = r * MIN;
  if (perMin >= 120) { const s = Math.round(r * 1000); return `${num(s)} ${unitWord(unit, s)} a second`; }
  if (perMin >= 1) { const m = perMin >= 3 ? Math.round(perMin) : Math.round(perMin * 10) / 10; return `${num(m)} ${unitWord(unit, m)} a minute`; }
  const every = 1 / perMin;
  return every < 60 ? `1 ${unitWord(unit, 1)} every ${Math.round(every)} min` : `1 ${unitWord(unit, 1)} every ${durationText(every * MIN)}`;
}
/** "64 of 208 records, Shirvalkar 2025". */
export function unitsText(u, { item = true } = {}) {
  if (!u) return '';
  return `${num(u.done)} of ${num(u.total)}${u.unit ? ` ${u.total === 1 ? unitWord(u.unit, 1) : u.unit}` : ''}${item && u.item ? `, ${u.item}` : ''}`;
}
/** "6 min over its 20 min estimate". */
export const overText = (over, declared) => (over > 0 && declared ? `${durationText(over)} over its ${durationText(declared)} estimate` : '');
/** "48%". */
export const percentText = share => (share == null ? '' : `${Math.floor(share * 100)}%`);
