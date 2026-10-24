// The move of a project to the stored synthesis model (plan §4.15g, approved 21 October 2026), as one pure step over the project state: the setup's
// count phrases onto its outcomes, its composites as outcomes of the project (derived.kind 'composite'), its facets and every arm's stored role, levels
// and follow-up (s.synthesis.arms), its overlap groups; the figure runs read from CSV files removed with their autoComparisons entries; `hide` outcomes
// hidden (kept). Returns what it did, a line each. tools/migrate-synthesis.mjs runs it on a project file, after a backup.
import { fillArms, synthArms, synthOutcomes } from './synth-project.mjs';

export function migrateSynthesis(s, setup, { hide = [] } = {}) {
  const log = [];
  // phrases first: they change the counts the arms are filled from
  for (const [id, items] of Object.entries(setup.items || {})) {
    const o = s.outcomes.find(x => x.id === id);
    if (o?.derived) { log.push(`${o.name}: reads ${items.join(', ')} (was ${(o.derived.items || []).join(', ')})`); o.derived.items = items; }
  }

  // composites as outcomes: a part named by an outcome id stays; a nested composite becomes its own outcome first
  const taken = new Set(s.outcomes.map(o => o.id));
  const nextId = () => { let n = 2; while (taken.has(`o${n}`)) n++; taken.add(`o${n}`); return `o${n}`; };
  const leafOf = c => (typeof c === 'string' ? c : c.parts.map(leafOf).find(Boolean));
  const made = new Map();
  function asOutcome(c) {
    if (typeof c === 'string') return c;
    const have = s.outcomes.find(o => o.name === c.name && o.derived?.kind === 'composite');
    if (have) return have.id;
    if (made.has(c.name)) return made.get(c.name);
    const parts = c.parts.map(asOutcome), id = nextId(), sub = s.outcomes.find(o => o.id === leafOf(c))?.derived?.subgroup;
    s.outcomes.push({ id, name: c.name, named: true, measure: 'PR', derived: { kind: 'composite', rule: c.rule || 'max', parts, ...(c.partial === false ? { partial: false } : {}), unit: 'arm', ...(sub ? { subgroup: sub } : {}) } });
    made.set(c.name, id);
    log.push(`Outcome ${id} ${c.name} = ${c.rule || 'max'} of ${parts.join(', ')}`);
    return id;
  }
  for (const c of setup.composites || []) asOutcome(c);

  // facets, arms, overlap
  s.synthesis = { facets: setup.facets, overlap: setup.overlap || [], settings: setup.settings || {}, arms: {} };
  s.synthesis.arms = fillArms(s, { only: 'all' });
  log.push(`${Object.keys(s.synthesis.arms).length} arms stored with ${setup.facets.length} facets; overlap groups: ${(setup.overlap || []).map(g => `${g.id} (${g.studies.length})`).join(', ') || 'none'}`);

  const named = namedFromSetup(s, setup);
  if (named) { s.synthesis.named = named; log.push(`Named combinations: ${named.comparisons.length} comparisons and ${named.groupings.length} groupings on ${named.outcomes.length || 'all'} outcomes${named.missing.length ? `; studies not found: ${named.missing.join(', ')}` : ''}`); delete named.missing; }

  // figure runs from CSV files
  const runs = Object.keys(s.figureRuns || {});
  if (runs.length) { log.push(`Removed figure runs read from CSV files: ${runs.map(k => `${k} (${s.figureRuns[k].source}, ${s.figureRuns[k].labels.length} studies)`).join('; ')}`); delete s.figureRuns; }
  for (const k of Object.keys(s.autoComparisons || {})) if (k.startsWith('csv:')) { delete s.autoComparisons[k]; log.push(`Removed autoComparisons ${k}`); }
  for (const id of hide) { const o = s.outcomes.find(x => x.id === id); if (o) { o.hidden = true; log.push(`Hidden outcome ${id} ${o.name}`); } }
  return log;
}

const fold = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase().trim();
/**
 * A setup's own combinations (a review's named comparisons and groupings, beside those the page finds itself), with their studies named as the
 * table names them and turned into the project's study ids; `outcomes` named the same way become outcome ids. Null when the setup names none.
 * { comparisons, groupings, outcomes, missing } (`missing`: study names no arm has).
 */
export function namedFromSetup(s, setup) {
  if (!setup.comparisons?.length && !setup.groupings?.length) return null;
  const sid = new Map(synthArms(s).map(a => [fold(a.study), a.sid])), missing = [];
  const id = name => { const v = sid.get(fold(name)); if (v == null) missing.push(name); return v; };
  const { outcomes } = synthOutcomes(s), oid = n => outcomes.find(o => fold(o.name) === fold(n))?.id || s.outcomes.find(o => fold(o.name) === fold(n))?.id;
  return { comparisons: (setup.comparisons || []).map(c => ({ ...c, studies: c.studies.map(x => (typeof x === 'string' ? id(x) : x)).filter(x => x != null) })),
    groupings: setup.groupings || [], outcomes: (setup.outcomes || []).map(oid).filter(Boolean), missing };
}
