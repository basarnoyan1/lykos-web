// What each output of an analysis run reads (plan W9c, per-output value sets; spec "Proven links", 2026-11-07). A pool, a test or a summary
// registers the rows it was computed from (or selectors of them: { trial, outcome_slot?, arm?, armLevel? }), and the run's record
// (lib/analysis-run.mjs) turns them into the value units each output rests on, so a changed value marks only the outputs that read it.
// A WeakMap: nothing is kept alive, and no row or result changes shape (a stored resampling result's fingerprint reads named columns).
const reads = new WeakMap();

/** `o` (a pool, a test, a summary) computed from `rows`; returns `o`. */
export const withReads = (o, rows) => { if (o && typeof o === 'object' && Array.isArray(rows)) reads.set(o, rows); return o; };
/** The rows `o` was computed from, or null when it registered none. */
export const readsOf = o => (o && typeof o === 'object' ? reads.get(o) || null : null);
/** A sham/active pair's two arms on its outcome, as selectors (the joint model and the bootstrap read both). */
export const pairReads = pairs => pairs.flatMap(p => [{ trial: p.trial, outcome_slot: p.outcome_slot, arm: p.sham_arm }, { trial: p.trial, outcome_slot: p.outcome_slot, arm: p.active_arms }]);

// ---- the units a value id belongs to ----------------------------------------------------------------------------------------------------
export const pidOfKey = k => k.slice(0, k.indexOf(':'));
// a value id's field without its outcome slot and arm ("t.out_baseline_sd"), so a value written later in a column the run reads is known
export const fieldOfKey = k => k.slice(k.indexOf(':') + 1).replace(/~o\d+/, '').replace(/@[^@]*$/, '');
/** The unit of value id `key`: { text: "3~o1@arm1" | "3@arm2" | "3", study (a study's own field: neither slot nor arm) }; null when its
 *  study is not one of the run's (`at` Map(record id -> index in trials)). */
export function keyUnit(key, at) {
  const t = at.get(pidOfKey(String(key)));
  if (t == null) return null;
  const f = String(key).slice(String(key).indexOf(':') + 1), slot = /~(o\d+)/.exec(f)?.[1] || '', arm = /@([^@]+)$/.exec(f)?.[1] || '';
  return { text: `${t}${slot ? `~${slot}` : ''}${arm ? `@${arm}` : ''}`, study: !slot && !arm };
}
/**
 * What of a run rests on the values in `changed` (value ids written after it): { study (the run's study fields among them: they mark every
 * output), values (the changed ids the run reads), output(id) -> the changed ids that output rests on }. A value counts when the run read
 * it, or when it is in a column the run reads of one of its studies (a value written where there was none). An output with no `reads`
 * (a v1 run, or an output that named none) rests on every changed value of the run.
 */
export function runHits(run, changed = new Set()) {
  const ids = run?.valueIds || [], read = new Set(ids), at = new Map((run?.trials || []).map((p, i) => [p, i]));
  const fields = new Set(ids.map(fieldOfKey)), pids = new Set(ids.map(pidOfKey)), study = [], values = [], byUnitText = new Map();
  // a study's field marks every output unless an output reads that study as a unit of its own (a pooled analysis: one row a study);
  // a selection field (a pooled analysis's moderator) always does
  const outs = new Map((run?.outputs || []).map(o => [o.id, o])), exact = new Set([...outs.values()].flatMap(o => o.reads || [])), sel = new Set(run?.selection || []);
  for (const k of changed) {
    if (!read.has(k) && !(pids.has(pidOfKey(k)) && fields.has(fieldOfKey(k)))) continue;
    values.push(k);
    const u = keyUnit(k, at);
    if (!u) continue;
    if (sel.has(fieldOfKey(k)) || (u.study && !exact.has(u.text))) study.push(k); else { if (!byUnitText.has(u.text)) byUnitText.set(u.text, []); byUnitText.get(u.text).push(k); }
  }
  const output = id => {
    const o = outs.get(id);
    if (!o || !Array.isArray(o.reads) || !run?.trials) return values;
    return [...study, ...o.reads.flatMap(u => byUnitText.get(u) || [])];
  };
  return { study, values, output };
}

/** The value ids output `id` of a run rests on: those of its units, and its studies' own fields; every value id for an output with no `reads`. */
export function outputValueIds(run, id) {
  const o = (run?.outputs || []).find(x => x.id === id);
  if (!o || !Array.isArray(o.reads) || !run?.trials) return run?.valueIds || [];
  const at = new Map(run.trials.map((p, i) => [p, i])), units = new Set(o.reads), studies = new Set(o.reads.map(u => parseInt(u, 10)));
  return (run.valueIds || []).filter(k => { const u = keyUnit(k, at); return u && (u.study ? studies.has(parseInt(u.text, 10)) : units.has(u.text)); });
}
