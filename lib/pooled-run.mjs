// The run record of a pooled analysis of the Analysis page (plan W9c, "run records from the Analysis page"; spec "Proven links", 2026-11-07).
// A pooled result already keeps what a run record names: the studies it pooled (`papers` or `units`), its inputs as text (`inputSnapshot`), its
// engine, settings and time, and each earlier state as a result version (lib/result-versions.mjs). The record is derived from the result it
// describes, so every kept result has one, those kept before 7 Nov 2026 included, and nothing is stored twice:
//   { kind: 'lykos-run', v: 2, id: "pooled-<slot>-v<n>", family: 'pooled', key: "analysis:<slot>", version: n, at, inputHash (the snapshot,
//     hashed), code: { engine, settings, hash }, effectsHash (the study rows and pooled row a forest draws), outputs: [{ id, title, level,
//     text, nums, reads }], valueIds, trials, selection }
// A study's units are its index in `trials`: a value of a study marks the outputs that pooled it; the moderator (`selection`) decides the
// subgroups, so a change to it marks every output. Pure over the state given.
import { hash, hashOf } from './proof/hash.mjs';
import { lib_outcomes$analysisOf as analysisOf, lib_outcomes$fieldFor as fieldFor } from "../boot.mjs";
import { lib_effect_measures$inputFields as inputFields } from "../boot.mjs";
import { resultVersions } from './result-versions.mjs';
import { pidOfKey } from './run-reads.mjs';

const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const f = (x, d = 2) => (num(x) == null ? null : num(x).toFixed(d));
const PROPORTION = /^P(R|LO|FT|AS)$/;
const estOf = a => [num(a.estimate ?? a.est ?? a.b), num(a.lo ?? a.ci_lb), num(a.hi ?? a.ci_ub)];

/** The rows a forest of the result draws: its studies' estimates and its pooled row; a figure drawn from the result records this hash. */
export function pooledEffectsHash(a) {
  if (!a) return '';
  return hashOf({ measure: a.measure || '', method: a.method || '', labels: a.labels || [], values: a.values ?? null,
    study: [a.study_est ?? null, a.study_lo ?? null, a.study_hi ?? null], pooled: estOf(a) });
}
// the numbers an output prints: the estimate and its interval to two decimals (and as a percentage to one, for a proportion), k and I²
function printed(measure, est, lo, hi, k, i2) {
  const out = [f(est), f(lo), f(hi)];
  if (PROPORTION.test(measure || '')) out.push(...[est, lo, hi].map(x => f(num(x) == null ? null : num(x) * 100, 1)));
  if (num(k) != null) out.push(String(num(k)));
  if (num(i2) != null) out.push(f(i2, 1));
  return [...new Set(out.filter(x => x != null))];
}
// the value ids the result read: its derived rows' own (a table read from text names each), else its studies' values in the fields of its
// measure on its outcome (any arm) and its moderator
function valueIdsOf(s, slot, a, trials) {
  try {
    const snap = JSON.parse(a.inputSnapshot || 'null'), named = (snap?.rows || []).map(r => (Array.isArray(r) ? r.find(x => typeof x === 'string' && /^[^:\s]+:[^\s]+$/.test(x) && trials.has(pidOfKey(x))) : null)).filter(Boolean);
    if (named.length) return [...new Set([...named, ...(a.moderator ? [...trials].map(p => `${p}:${a.moderator}`).filter(k => s.values?.[k]) : [])])].sort();
  } catch { /* a snapshot that is not JSON names no keys */ }
  const fields = new Set([...(a.measure ? inputFields(a.measure).map(x => fieldFor(x, slot)) : []), ...(a.moderator ? [a.moderator] : [])]);
  return Object.keys(s.values || {}).filter(k => trials.has(pidOfKey(k)) && fields.has(k.slice(k.indexOf(':') + 1).replace(/@[^@]*$/, ''))).sort();
}

/** The run record of the pooled result of `slot` (the live one, or `a`); null when there is none. */
export function pooledRun(s, slot, a = analysisOf(s, slot)) {
  if (!a) return null;
  const key = `analysis:${slot}`, pids = (a.papers || a.units || []).map(String), trials = [...new Set(pids)].filter(Boolean).sort();
  const at = new Map(trials.map((p, i) => [p, i])), unit = p => String(at.get(p));
  const versions = resultVersions(s, key), version = versions.find(v => v.data?.at && v.data.at === a.at)?.n ?? versions.at(-1)?.n ?? 1;
  const [est, lo, hi] = estOf(a), title = a.outcomeName || (slot === 'primary' ? 'Primary outcome' : slot);
  const outputs = [{ id: 'pooled|All', title, level: 'All', text: est == null ? '' : `${f(est)} (${f(lo)} to ${f(hi)})`, nums: printed(a.measure, est, lo, hi, a.k ?? pids.length, a.i2),
    reads: [...new Set(pids.map(unit))].sort((x, y) => x - y) }];
  // subgroups: each level's studies (the result's own level per row, or the moderator's values the Analysis page kept)
  const levelOf = Array.isArray(a.levels) && a.levels.length === pids.length ? a.levels : Array.isArray(a.modValues) && a.modValues.length === pids.length ? a.modValues : null;
  (a.mod_levels || []).forEach((level, i) => {
    const reads = levelOf ? [...new Set(pids.filter((_, j) => String(levelOf[j]) === String(level)).map(unit))].sort((x, y) => x - y) : outputs[0].reads;
    const e = num(a.mod_est?.[i]), l = num(a.mod_lo?.[i]), h = num(a.mod_hi?.[i]);
    outputs.push({ id: `pooled|${level}`, title, level: String(level), text: e == null ? '' : `${f(e)} (${f(l)} to ${f(h)})`, nums: printed(a.measure, e, l, h, a.mod_k?.[i], a.mod_i2?.[i]), reads });
  });
  const code = { engine: a.engine || 'R', settings: a.settings || null };
  return { kind: 'lykos-run', v: 2, id: `pooled-${slot}-v${version}`, family: 'pooled', key, version, at: a.at || '', inputHash: hash(String(a.inputSnapshot ?? '')),
    code: { ...code, hash: hashOf(code) }, effectsHash: pooledEffectsHash(a), outputs, valueIds: valueIdsOf(s, slot, a, new Set(trials)), trials,
    ...(a.moderator ? { selection: [a.moderator] } : {}) };
}

/** What a figure of the pooled result of `slot` is drawn from, as `.lykos/outputs.json` keeps it beside the version it drew (plan W9c):
 *  `{ source: 'pooled', run: "pooled-<slot>-v<n>", effectsHash }`; null when there is no result. */
export function pooledDrawnFrom(s, slot, a = analysisOf(s, slot)) {
  const r = a ? pooledRun(s, slot, a) : null;
  return r ? { source: 'pooled', run: r.id, effectsHash: r.effectsHash } : null;
}
