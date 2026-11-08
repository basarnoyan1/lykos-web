// A recorded analysis run (plan W9c 3; spec "Proven links, 2026-11-07 (W9c)"): what an analysis run in Lykos was computed from and what it
// gave, kept beside its report (`run.json` beside results.md), so a number of the manuscript names the run's output it came from and the
// values it rests on, and a later run can be compared with it by hash.
//   { kind: 'lykos-run', v: 2, id, family, at, report, inputHash, code: { lykos, engine: [files], hash }, effectsHash,
//     outputs: [{ id, title, level, text, nums, reads }], valueIds, trials }
// v2 (7 Nov 2026, per-output value sets): `trials` lists the studies the run reads (record ids) and each output's `reads` the units it was
// computed from: "3~o1@arm1" (study 3 of `trials`, its outcome o1, arm 1), "3@arm2" (an arm's own field, such as its serious adverse
// events). A value of an arm's outcome marks only the outputs that read that unit; a study's own field (its class, design, blinding,
// funding) decides which pools its rows enter, so it marks every output of the run. A v1 run has no `reads`: each output rests on all of it.
// inputHash is the hash of the inputs as text (the rows lib/change-rows.mjs reads and the plan); effectsHash of the rows a forest or funnel
// draws (lib/change-tables.mjs effectRowsOf), so a figure drawn from the same inputs is drawn from this run; valueIds the record's value ids
// the inputs read (lib/verification-lists.mjs synthesisValueKeys). Pure: the caller gives the model, its inputs and the code's version.
import { hash, hashOf } from './proof/hash.mjs';
import { synthesisRowsOf, effectRowsOf } from './change-tables.mjs';
import { synthesisValueKeys } from './verification-lists.mjs';
import { numsOf } from './number-check.mjs';
import { keyUnit, pidOfKey } from './run-reads.mjs';

export const RUN_KIND = 'lykos-run';
export const RUN_V = 2;
export const RUN_FILE = 'run.json';
/** The files of the change synthesis's code: their text, hashed, is the run's code version (tools/lykos-change-report.mjs reads them). */
export const CHANGE_ENGINE = Object.freeze(['change-rows.mjs', 'change-synthesis.mjs', 'change-tables.mjs', 'change-moderators.mjs', 'instrument-crosswalks.mjs', 'meta-multilevel.mjs', 'meta-cr2.mjs', 'meta-glmm.mjs']);

const f2 = x => (x == null || !Number.isFinite(x) ? null : (x < 0 && x > -0.005 ? '-0.00' : x.toFixed(2)));
// the numbers an output prints: its texts' numbers, its counts, its estimates to two decimals, its df to one, its p to three
function printed(r) {
  const parts = Object.entries(r).filter(([k, v]) => k !== 'order' && (typeof v === 'string' || (typeof v === 'number' && Number.isInteger(v)))).map(([, v]) => v);
  for (const k of ['estimate', 'lo', 'hi', 'pi_lo', 'pi_hi']) if (typeof r[k] === 'number') parts.push(f2(r[k]));
  if (typeof r.df === 'number' && Number.isFinite(r.df)) parts.push(r.df.toFixed(1));
  if (typeof r.p === 'number' && Number.isFinite(r.p)) parts.push(r.p.toFixed(3));
  return [...numsOf(parts.filter(x => x != null).join(' '))];
}

const byUnit = (a, b) => parseInt(a, 10) - parseInt(b, 10) || (a < b ? -1 : a > b ? 1 : 0);
/** The units the selectors of one output read: each selector names a study (`trial`), and maybe its outcome and arm(s) ("arm2+arm3"). */
function unitsOf(sel, base, at) {
  const out = new Set();
  for (const r of sel) {
    const rows = base.get(r.trial) || [], arms = r.arm == null ? null : String(r.arm).split('+');
    if (r.armLevel) { const t = at.get(rows[0]?.paper_id); if (t != null && arms) for (const a of arms) out.add(`${t}@${a}`); continue; }
    for (const b of rows) {
      if (r.outcome_slot != null && b.outcome_slot !== r.outcome_slot) continue;
      if (arms && !arms.includes(b.arm)) continue;
      for (const k of b.source_keys || []) { const u = keyUnit(k, at); if (u && !u.study) out.add(u.text); }
    }
  }
  return [...out].sort(byUnit);
}

/** The record of a change-synthesis run: `m` the model (lib/change-records.mjs changeModel), `inputs` its inputs ({ key }), `code` the code's version. */
export function changeRun(s, { m, inputs, at = new Date().toISOString(), code = {}, report = '' }) {
  const valueIds = synthesisValueKeys(s).keys, base = new Map();
  for (const a of m?.sets?.all || []) { if (!base.has(a.trial)) base.set(a.trial, []); base.get(a.trial).push(a); }
  const trials = [...new Set([...valueIds.map(pidOfKey), ...[...base.values()].map(x => x[0].paper_id)])].filter(Boolean).sort();
  const tAt = new Map(trials.map((p, i) => [p, i]));
  const seen = new Map(), outputs = [];
  for (const r of synthesisRowsOf(m, { reads: true }).rows) {
    const id0 = `${r.synthesis}|${r.level}`, k = (seen.get(id0) || 0) + 1;
    seen.set(id0, k);
    outputs.push({ id: k > 1 ? `${id0}#${k}` : id0, title: r.title || '', level: String(r.level ?? ''), text: r.ci_text || '', nums: printed(r), ...(r.reads ? { reads: unitsOf(r.reads, base, tAt) } : {}) });
  }
  const inputHash = hash(String(inputs?.key ?? '')), effects = effectRowsOf(m).rows;
  return { kind: RUN_KIND, v: RUN_V, id: `change-${inputHash.slice(0, 8)}-${at.slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '')}`, family: 'change', at,
    ...(report ? { report } : {}), inputHash, code, effectsHash: hashOf(effects), outputs, valueIds, trials };
}

/** A run record read from its file: the run, or null when it is not one; a newer version is kept unread (`newer`). */
export function readRun(x) {
  if (!x || typeof x !== 'object' || x.kind !== RUN_KIND || !(Number(x.v) >= 1)) return null;
  if (Number(x.v) > RUN_V) return { kind: x.kind, v: x.v, id: x.id, newer: true, outputs: [], valueIds: [] };
  return { ...x, outputs: Array.isArray(x.outputs) ? x.outputs : [], valueIds: Array.isArray(x.valueIds) ? x.valueIds : [], ...(Array.isArray(x.trials) ? { trials: x.trials } : {}) };
}

/**
 * A run against the project now: { inputs: 'same' | 'changed' | 'unknown', code: 'same' | 'changed' | 'unknown', changed (value ids it
 * reads written since), text }. `now` { inputHash, code } of a run made now; `changed` the value ids written after the run (changedSince).
 */
export function runAgainst(run, now = {}, changed = new Set()) {
  const inputs = !now.inputHash ? 'unknown' : now.inputHash === run.inputHash ? 'same' : 'changed';
  const code = !now.code?.hash || !run.code?.hash ? 'unknown' : now.code.hash === run.code.hash ? 'same' : 'changed';
  const hit = (run.valueIds || []).filter(k => changed.has(k)).length;
  const text = [inputs === 'changed' ? 'its inputs changed' : '', code === 'changed' ? 'the analysis code changed' : '', hit ? `${hit.toLocaleString('en')} of its values were written since` : ''].filter(Boolean).join('; ');
  return { inputs, code, changed: hit, text };
}
