// Reproduce (plan W9c 5; spec "Proven links", 2026-11-07): what a project registered, compared with the same made again now from the
// folder, by hash. A recorded change-synthesis run (lib/analysis-run.mjs) against one made now: its inputs, its code, each output's
// printed numbers and the effects a forest draws. A pooled result of the Analysis page (lib/pooled-run.mjs): its inputs now against its
// snapshot and the pool computed again where the JavaScript engine gives metafor's result (lib/meta-general.mjs handlesGeneral). An
// output written to the folder (.lykos/outputs.json): its files drawn again in memory against the files' bytes, and what a figure was
// drawn from against the result now. Each is `same`, `changed` (what) or `not reproducible here` (why). Pure: tools/lykos-reproduce.mjs
// rebuilds and reads the files.

export const VERDICTS = Object.freeze(['same', 'changed', 'not reproducible here']);
const NOT = 'not reproducible here';
const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
// the same number as kept and as computed again: within a thousandth of it (an R fit and the JavaScript one converge apart that far)
export const sameNumber = (a, b) => { const x = num(a), y = num(b); return x == null || y == null ? x === y : Math.abs(x - y) <= 1e-3 * Math.max(Math.abs(x), Math.abs(y)) + 1e-9; };
const est = r => (num(r?.estimate) == null ? '' : `${num(r.estimate).toPrecision(4)} (${num(r.lo)?.toPrecision(4) ?? '?'} to ${num(r.hi)?.toPrecision(4) ?? '?'})`);
const key = nums => (nums || []).join(' ');

/** The registered change run `reg` against `now`, made from the folder with the code of today; `vs` is runAgainst(reg, now, changed). */
export function changeAgain(reg, now, vs) {
  const by = new Map((now?.outputs || []).map(o => [o.id, o])), differ = [];
  for (const o of reg.outputs || []) {
    const n = by.get(o.id);
    if (!n) differ.push({ id: o.id, title: o.title || '', was: o.text || '', now: null });
    else if (key(o.nums) !== key(n.nums)) differ.push({ id: o.id, title: o.title || '', was: o.text || '', now: n.text || '' });
  }
  const had = new Set((reg.outputs || []).map(o => o.id)), added = (now?.outputs || []).filter(o => !had.has(o.id)).map(o => o.id);
  const effects = !reg.effectsHash || !now?.effectsHash ? 'unknown' : reg.effectsHash === now.effectsHash ? 'same' : 'changed';
  const what = [vs.inputs === 'changed' ? 'its inputs changed' : '', vs.changed ? `${vs.changed.toLocaleString('en')} of its values were written since` : '',
    differ.length ? `${differ.length} of ${(reg.outputs || []).length} outputs print other numbers` : '', added.length ? `${added.length} outputs are new` : '',
    effects === 'changed' ? 'the effects a forest draws changed' : ''].filter(Boolean);
  const same = vs.inputs === 'same' && !differ.length && !added.length && effects !== 'changed';
  // new code that prints the same numbers reproduces the run: it is said, not counted against it
  if (vs.code === 'changed') what.push(same ? 'the analysis code changed since and prints the same numbers' : 'the analysis code changed since');
  return { kind: 'change', id: reg.id, at: reg.at || '', verdict: same ? 'same' : 'changed', inputs: vs.inputs, code: vs.code, valuesSince: vs.changed || 0,
    outputs: (reg.outputs || []).length, differCount: differ.length, differ: differ.slice(0, 20), added: added.slice(0, 20), effects, what };
}

/**
 * A pooled result against the same made now. `inputs` lib/analysis-inputs.mjs pooledInputStatus (current, stale, untracked); `again` the
 * pool of the inputs now (null when the engine cannot, `why` then says so).
 */
export function pooledAgain({ slot, a, run, inputs, again = null, why = '' }) {
  const base = { kind: 'pooled', slot, id: run?.id || `pooled-${slot}`, title: a?.outcomeName || slot, at: a?.at || '', inputs };
  const agrees = again && ['estimate', 'lo', 'hi'].every(k => sameNumber(again[k], a[k]));
  const what = [];
  if (inputs === 'stale') what.push('its inputs changed since it ran');
  if (again && !agrees) what.push(`pooled now: ${est(again)}; the result keeps ${est(a)}`);
  if (what.length) return { ...base, verdict: 'changed', what, ...(again ? { again: { estimate: again.estimate, lo: again.lo, hi: again.hi } } : {}) };
  if (inputs === 'current' && agrees) return { ...base, verdict: 'same', what: [`pooled again: ${est(again)}`] };
  return { ...base, verdict: NOT, what: [inputs === 'untracked' ? 'its inputs were not recorded when it ran' : why || 'the pool was not computed again'] };
}

/**
 * An output written to the folder against the same drawn now. `files` [{ path, same: true | false | null, why }] (null: not compared,
 * `why` says so); `drawn` { was, now, run, runNow } when a figure records what it was drawn from.
 */
export function outputAgain({ key: k, entry, files = [], drawn = null, why = '' }) {
  const base = { kind: 'output', key: k, label: entry?.label || k.split('/').pop(), version: entry?.version ?? null };
  const what = [], gone = files.filter(f => f.missing), differ = files.filter(f => f.same === false && !f.missing), checked = files.filter(f => f.same === true);
  if (gone.length) what.push(`${gone.map(f => f.path).join(', ')} not in the folder`);
  if (differ.length) what.push(`${differ.map(f => f.path.split('/').pop()).join(', ')} ${differ.length === 1 ? 'differs' : 'differ'} from the same drawn now`);
  if (drawn && drawn.was && drawn.now && drawn.was !== drawn.now) what.push(`drawn from ${drawn.run || 'other effects'}; the result now is ${drawn.runNow || 'another'}`);
  if (what.length) return { ...base, verdict: 'changed', what };
  if (checked.length || (drawn && drawn.was && drawn.was === drawn.now)) {
    const skipped = files.filter(f => f.same == null);
    return { ...base, verdict: 'same', what: [checked.length ? `${checked.map(f => f.path.split('/').pop()).join(', ')} the same` : `drawn from the result as it is (${drawn.run})`,
      ...(skipped.length ? [`${skipped.map(f => f.path.split('/').pop()).join(', ')} not compared: ${skipped[0].why}`] : [])] };
  }
  return { ...base, verdict: NOT, what: [why || files.find(f => f.why)?.why || 'nothing to compare'] };
}

/** The verdicts counted: { same, changed, 'not reproducible here' }. */
export function reproduceCounts(r) {
  const all = [...(r.change ? [r.change] : []), ...(r.pooled || []), ...(r.outputs || [])], out = Object.fromEntries(VERDICTS.map(v => [v, 0]));
  for (const x of all) out[x.verdict]++;
  return out;
}
/** The report as lines: the run, each pooled result, each output, and the counts. */
export function reproduceText(r) {
  const line = (head, x) => `${head}: ${x.verdict}${x.what?.length ? `: ${x.what.join('; ')}` : ''}`;
  const out = [];
  if (r.change) {
    out.push(line(`change run ${r.change.id}${r.change.file ? ` (${r.change.file})` : ''}`, r.change));
    for (const d of r.change.differ || []) out.push(`  ${d.id}: ${d.was || '(none)'} -> ${d.now ?? 'not made now'}`);
    if (r.change.differCount > (r.change.differ || []).length) out.push(`  and ${r.change.differCount - r.change.differ.length} more`);
  } else out.push('change run: none registered');
  for (const p of r.pooled || []) out.push(line(`pooled ${p.title} (${p.id})`, p));
  if (!(r.pooled || []).length) out.push('pooled results: none');
  for (const o of r.outputs || []) out.push(line(`output ${o.key}${o.version != null ? ` v${o.version}` : ''}`, o));
  const c = reproduceCounts(r);
  out.push(`${c.same} same, ${c.changed} changed, ${c[NOT]} not reproducible here`);
  return out;
}
