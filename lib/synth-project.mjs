// A project read for the synthesis explorer (plan §4.15g): its arms, their facets, their outcomes, and the whole of what lib/synth.mjs and lib/synth-plan.mjs find
// from them. Nothing is stored beyond the person's own choices (`s.synthesis`, below): the arms, their counts and their facet levels are read from the cells
// each time, so the matrix follows the table and a changed cell changes the verdicts.
//
//   s.synthesis = {
//     facets:     [{ id, label, column, levels?, rules?, otherwise?, derive?, mixing? }]   the arms' attributes; absent: suggested from the table's short text columns
//                   rules:  [{ level, when: [{ column, pattern }] }]  the first rule whose every pattern (a regular expression, case-insensitive) matches the arm's cells
//                   derive: { from, map: { level: level }, otherwise }  a facet taken from another
//     arms:       { 'paper@arm': { role, facets: { facet: level }, fu } }                  the arms' stored attributes (approved 21 October 2026): these are the
//                   arms' levels; the rules only propose levels for an arm that has none stored (`fillArms`)
//     manual:     { 'paper@arm': { facet: level } }                                      the earlier form of a person's own level, read under `arms`
//     composites: [outcome]                                                              lib/synth.mjs outcomes built from the table's outcomes
//     roles:      { 'paper@arm': 'I'|'C' }                                               the first arm is the intervention, the second the comparator, unless said
//     overlap:    [{ id, studies: [paper id], keep? }]                                   studies that share patients
//     settings:   { … }                                                                  verdict thresholds (lib/synth.mjs SETTINGS)
//     sheets:     [{ id, name, intervention, outcomes: [outcome id], sections: [{ title, arms: { facet: [level] }, versus?: { facet: [level] } }] }]   effect-direction sheets (lib/synth-figures.mjs effectsData): a section with `versus` lists the studies whose intervention arm and comparator arm have those levels, one without it the studies with a single arm
//     forests:    { 'code|outcome id': options }                                         a forest's options (lib/forest-options.mjs): pooled or not, subgroups, columns, favors, axis
//     items:      { outcome id: [phrase] }                                               the phrases a count outcome reads for, over the table's own (breakage may be written screw, rod or cord breakage)
//     followUpColumn, nColumn
//   }
import { studies } from './screen.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { effectiveAnswers, STUDY } from './rob-review.mjs';
import { isComplete } from './appraisal-summary.mjs';
import { armsOf, cellKey } from './arms.mjs';
import { countFor } from './count-text.mjs';
import { derivedUnits } from './derived-counts.mjs';
import { studies as includedOf } from './screen.mjs';
import { measureOf } from './effect-measures.mjs';
import { outcomes as projectOutcomes } from './outcomes.mjs';
import { studyInputs } from './analysis-inputs.mjs';
import { SETTINGS, evaluateAll, verdictCounts } from './synth.mjs';
import { deriveFacet, proposeComparisons, proposeGroupings, highlights, findings } from './synth-plan.mjs';
import { get as liveState, getVersion, inUpdate } from '../store.mjs';

const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const textOf = v => (v == null ? '' : String(v.reported_value ?? v.normalized_value ?? ''));
const NONE = /^(nr|na|n\/a|none|not reported|not stated|-|–)?$/i;

export const configOf = s => ({ facets: null, arms: {}, manual: {}, composites: [], roles: {}, overlap: [], settings: {}, ...(s?.synthesis || {}) });

/** Months from a follow-up cell ("39.1", "Median 24 months", "3 years"): the first number, years taken as twelve months; null when none. */
export function followUpMonths(text) {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return /\byears?\b|\byrs?\b/i.test(text) ? v * 12 : v;
}

/** The table the arms come from: the one the derived outcomes read, else the first with arms. */
export function synthTemplate(s) {
  const named = (s.outcomes || []).find(o => o.derived?.kind === 'text-counts')?.derived?.template;
  const all = s.templates || [];
  return all.find(t => t.id === named) || all.find(t => t.arms && Object.keys(t.arms).length) || all[0] || null;
}

// ---- outcomes ---------------------------------------------------------------------------------------------------------------------
/** The components (one per outcome the table reads counts for) and the outcomes the matrix crosses with: the person's composites, then each component. */
export function synthOutcomes(s) {
  const cfg = configOf(s), comps = [];
  for (const o of projectOutcomes(s)) {
    const source = s.outcomes?.find(x => x.id === o.id) || o;
    if (o.hidden) continue;
    if (source.derived?.kind === 'text-counts') comps.push({ id: o.id, name: o.name, kind: 'text', derived: cfg.items?.[o.id] ? { ...source.derived, items: cfg.items[o.id] } : source.derived });
    else if (measureOf(o.measure).family === 'binary') comps.push({ id: o.id, name: o.name, kind: 'numeric', measure: o.measure });
  }
  // an outcome with numbers of its own that no study has filled in is not an outcome of this review
  const filled = new Set(synthArmsRaw(s, comps).flatMap(x => Object.keys(x.counts)));
  for (let i = comps.length - 1; i >= 0; i--) if (comps[i].kind === 'numeric' && !filled.has(comps[i].id)) comps.splice(i, 1);
  const ids = new Set(comps.map(c => c.id));
  // the project's composite outcomes (derived.kind 'composite'), a part that is itself a composite read as its own node
  const byId = new Map((s.outcomes || []).map(o => [o.id, o]));
  const node = (o, seen = new Set()) => ({ id: o.id, name: o.name || o.id, rule: o.derived.rule || 'max', ...(o.derived.partial === false ? { partial: false } : {}),
    parts: o.derived.parts.map(p => (ids.has(p) ? p : byId.get(p)?.derived?.kind === 'composite' && !seen.has(p) ? node(byId.get(p), new Set([...seen, o.id])) : null)).filter(Boolean) });
  const own = projectOutcomes(s).filter(o => !o.hidden && byId.get(o.id)?.derived?.kind === 'composite').map(o => node({ ...byId.get(o.id), name: o.name })).filter(n => n.parts.length);
  const composites = [...own, ...(cfg.composites || []).filter(c => !own.some(o => o.name === c.name) && c?.parts?.length && c.parts.every(function ok(p) { return typeof p === 'string' ? ids.has(p) : p.parts?.every(ok); }))];
  return { components: comps, outcomes: [...composites, ...comps.map(c => ({ id: c.id, name: c.name, rule: 'reported', parts: [c.id] }))] };
}

// ---- arms -----------------------------------------------------------------------------------------------------------------------
/** The arms of the included studies with their counts and denominators per component, their follow-up and their cell text. */
export function synthArms(s) { return synthArmsRaw(s, synthOutcomes(s).components); }

/** The arms for a given list of components (synthOutcomes asks for them before it knows which numeric outcomes have data). */
function synthArmsRaw(s, components) {
  const cfg = configOf(s), template = synthTemplate(s), arms = new Map();
  const cellText = (pid, col, arm) => tidy(textOf(s.values?.[cellKey(pid, col, arm)]) || textOf(s.values?.[cellKey(pid, col)]));
  const fuCol = cfg.followUpColumn || template?.columns?.find(c => /follow/.test(c.id))?.id, nCol = cfg.nColumn || components.find(c => c.derived)?.derived?.nColumn;
  const pap = new Map((s.papers || []).map(p => [p.id, p]));
  const touch = (pid, armId, label) => {
    const key = `${pid}@${armId || ''}`;
    if (!arms.has(key)) arms.set(key, { key, sid: pid, study: pap.get(pid)?.label || pid, armId: armId || null, label, role: 'I', facets: {}, n: null, fu: null, counts: {}, ns: {}, bounds: {}, cells: {}, text: {} });
    return arms.get(key);
  };
  const inc = new Set(includedOf(s).map(p => p.id));
  for (const c of components.filter(x => x.kind === 'text')) {
    for (const u of derivedUnits(s, c.derived)) {
      if (!inc.has(u.paperId)) continue;
      const a = touch(u.paperId, u.arm, u.label.split(', ').slice(1).join(', ') || u.label);
      a.counts[c.id] = u.status === 'count' ? u.events : null;
      a.ns[c.id] = u.status === 'count' ? u.n : null;
      a.text[c.id] = u.text;
      // a count given only as a bound ("up to 9/26") is no number to the synthesis, but a figure of the table shows it as written
      if (u.status !== 'count') { const h = countFor(u.text, c.derived.items || []), m = /(?:up to|at most|≤)\s*(\d+)\s*\/\s*(\d+)/i.exec(h.text || ''); if (m) a.bounds[c.id] = { e: Number(m[1]), n: Number(m[2]) }; }
      if (a.n == null && u.armN != null) a.n = u.armN;
    }
  }
  for (const c of components.filter(x => x.kind === 'numeric')) {
    for (const pid of inc) {
      if (arms.has(`${pid}@`) || [...arms.keys()].some(k => k.startsWith(`${pid}@`) && k !== `${pid}@`)) { /* a study the table already splits */ }
      const [e1, n1, e2, n2] = studyInputs(s, pid, c.measure, c.id).map(x => (Number.isFinite(x) ? x : null));
      if (n1 == null && n2 == null) continue;
      const i = touch(pid, 'I', 'Intervention'), k = touch(pid, 'C', 'Comparator'); k.role = 'C';
      i.counts[c.id] = e1; i.ns[c.id] = n1; k.counts[c.id] = e2; k.ns[c.id] = n2;
      if (i.n == null && n1 != null) i.n = n1; if (k.n == null && n2 != null) k.n = n2;
    }
  }
  // roles: the first arm of a study is the intervention, the next the comparator, a person's choice over both
  const per = new Map();
  for (const a of arms.values()) (per.get(a.sid) || per.set(a.sid, []).get(a.sid)).push(a);
  for (const list of per.values()) list.forEach((a, i) => { if (a.armId !== 'I' && a.armId !== 'C') a.role = i === 0 ? 'I' : 'C'; a.role = cfg.arms?.[a.key]?.role || cfg.roles?.[a.key] || a.role; });
  for (const a of arms.values()) {
    if (fuCol) a.fu = followUpMonths(cellText(a.sid, fuCol, a.armId));
    // an arm of a study whose follow-up is given only for the whole cohort (no value of its own): the figures mark it "(cohort)"
    if (fuCol && a.armId && !textOf(s.values?.[cellKey(a.sid, fuCol, a.armId)]) && textOf(s.values?.[cellKey(a.sid, fuCol)])) a.fuShared = true;
    if (Number.isFinite(cfg.arms?.[a.key]?.fu)) a.fu = cfg.arms[a.key].fu;
    for (const col of (template?.columns || [])) { const t = cellText(a.sid, col.id, a.armId); if (t) a.cells[col.id] = t; }
    // the arm's name: the line under "Arm 1 (n=26)" in the size cell, where the table writes what the arm received
    const second = nCol ? tidy(String(textOf(s.values?.[cellKey(a.sid, nCol, a.armId)]) || '').split('\n')[1]) : '';
    if (second) a.label = second.length > 70 ? `${second.slice(0, 68)}…` : second;
    if (a.n == null && nCol) { const m = /n\s*=\s*(\d[\d,]*)/i.exec(cellText(a.sid, nCol, a.armId)); if (m) a.n = Number(m[1].replace(/,/g, '')); }
    // the denominators the counts came with decide the arm's n (the most common; the larger on a tie); the arm cell's own n is kept to show where they differ
    const den = Object.values(a.ns).filter(x => Number.isFinite(x) && x > 0);
    a.nCell = a.n;
    if (den.length) { const tally = new Map(); for (const x of den) tally.set(x, (tally.get(x) || 0) + 1); a.n = [...tally].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0]; }
    if (a.n == null) a.n = 0;
  }
  return [...arms.values()];
}

// ---- facets ---------------------------------------------------------------------------------------------------------------------
const slug = t => tidy(t).toLowerCase();
const SKIP = /^(id|study|arm_n|age_sex|follow_up|main_table)|outcome|result|conclusion|rationale|confounding|radiographic|mechanical_failure|asd_pjk|technique_construct$/;
/** The facets a table offers by itself: each short text column whose cells take two to twelve different short values, each value a level. */
export function suggestFacets(arms, template, { exclude = [] } = {}) {
  const out = [];
  for (const col of template?.columns || []) {
    const id = col.id.split('.').pop();
    if (SKIP.test(id) || exclude.includes(col.id) || ['integer', 'number'].includes(col.type)) continue;
    const seen = new Map();
    for (const a of arms) { const t = tidy(a.cells[col.id]); if (t && !NONE.test(t)) seen.set(slug(t), [(seen.get(slug(t)) || [t, 0])[0], (seen.get(slug(t)) || [t, 0])[1] + 1]); }
    const vals = [...seen];
    if (vals.length < 2 || vals.length > 12 || vals.some(([, [t]]) => t.length > 40)) continue;
    out.push({ id, label: tidy(col.label || id.replace(/_/g, ' ')).replace(/^./, c => c.toUpperCase()), column: col.id, auto: true, levels: vals.sort((a, b) => b[1][1] - a[1][1]).map(([k, [t]]) => ({ id: k, label: t })) });
  }
  return out;
}

/** The level an arm has in a facet: a person's own, a rule's, the cell's own text, or null. */
function levelOf(a, f, cfg) {
  const own = cfg.arms?.[a.key]?.facets?.[f.id] ?? cfg.manual?.[a.key]?.[f.id];
  if (own) return own;
  return proposedLevel(a, f);
}
/** The level the facet's rules (or, without rules, the cell's own text) give an arm: a proposal, never stored by itself. */
export function proposedLevel(a, f) {
  if (f.rules) {
    for (const r of f.rules) if ((r.when || []).every(w => new RegExp(w.pattern, 'i').test(a.cells[w.column] || ''))) return r.level;
    return f.otherwise ?? null;
  }
  const t = tidy(a.cells[f.column]);
  return t && !NONE.test(t) ? slug(t) : null;
}

/**
 * A facet's levels and rules read from one column of the table (the rule-writing aid): a level for each value its arms' cells take, at most twelve,
 * each with the rule that reads it (the cell starts with that value; longer values are tried first); a value with the name of a level the facet
 * has keeps that level. Null when the column takes none or more than twelve values. { levels, rules }
 */
export function levelsFromColumn(arms, column, facet = {}) {
  const vals = [...new Set(arms.map(a => tidy(a.cells?.[column])).filter(v => !NONE.test(v)))];
  if (!vals.length || vals.length > 12) return null;
  const levels = (facet.levels || []).map(l => ({ ...l })), rules = [], esc = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const v of vals.sort((a, b) => b.length - a.length || a.localeCompare(b))) {
    let l = levels.find(x => x.label.toLowerCase() === v.toLowerCase());
    if (!l) { const base = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'level'; let id = base, n = 2; while (levels.some(x => x.id === id)) id = `${base}_${n++}`; l = { id, label: v }; levels.push(l); }
    rules.push({ level: l.id, when: [{ column, pattern: `^\\s*${esc(v).replace(/ /g, '\\s+')}` }] });
  }
  return { levels, rules };
}

/** The arms with their facet levels, and the facets (the person's, else suggested; derived ones last). */
export function withFacets(s, arms) {
  const cfg = configOf(s), template = synthTemplate(s);
  let facets = (cfg.facets || suggestFacets(arms, template)).filter(f => !f.derive);
  const derived = (cfg.facets || []).filter(f => f.derive);
  let out = arms.map(a => ({ ...a, facets: Object.fromEntries(facets.map(f => [f.id, levelOf(a, f, cfg)]).filter(([, v]) => v != null)) }));
  for (const f of derived) { out = deriveFacet(out, { id: f.id, from: f.derive.from, map: f.derive.map, otherwise: f.derive.otherwise }); facets = [...facets, f]; }
  // a facet without stored levels takes the values its arms have (a free-text facet such as the device)
  for (const f of facets) if (!f.levels?.length) f.levels = [...new Set(out.map(a => a.facets[f.id]).filter(Boolean))].sort().map(id => ({ id, label: id }));
  return { arms: out, facets };
}

// ---- the model --------------------------------------------------------------------------------------------------------------------
/**
 * Everything the matrix shows: { arms, facets, outcomes, comparisons, groupings, records, counts, highlights, findings, settings }. Comparisons and groupings are the
 * ones found from the facets, `restrictBy` the facets (population, staging) that also restrict each comparison.
 */
/** Each included study's overall risk-of-bias judgement, from a complete assessment with an instrument that has one: Map(study id -> { tool, overall }). */
export function robOverall(s) {
  const out = new Map();
  for (const x of studies(s)) {
    const t = instrumentFor(s, x.id), values = effectiveAnswers(s, x.id, t.id, STUDY).answers;
    if (t.overall && isComplete(t, values) && values.overall) out.set(x.id, { tool: t.name, overall: values.overall });
  }
  return out;
}

// The model of the live project, kept until the project changes (store.mjs getVersion): a page drew it once per item, 27 to 44 ms each, and
// Tables and figures and Submission › Files about 130 ms on entering. Only the live state is kept, never inside a reducer (the state is
// being changed there), and per restriction. Callers read the model and never change it.
let modelMemo = null;
export function synthesisModel(s, opts = {}) {
  const key = s && s === liveState() && !inUpdate() ? `${getVersion()}|${JSON.stringify(opts.restrictBy ?? null)}` : null;
  if (key && modelMemo?.s === s && modelMemo.key === key) return modelMemo.m;
  const m = buildModel(s, opts);
  if (key) modelMemo = { s, key, m };
  return m;
}
function buildModel(s, { restrictBy = configOf(s).restrictBy || [] } = {}) {
  const cfg = configOf(s), settings = { ...SETTINGS, ...(cfg.settings || {}) };
  const { outcomes } = synthOutcomes(s), base = synthArms(s);
  const { arms, facets } = withFacets(s, base);
  const overlapKeep = {};
  for (const g of cfg.overlap || []) { for (const a of arms) if (g.studies.includes(a.sid)) a.overlap = g.id; if (g.keep != null) overlapKeep[g.id] = g.keep; }
  const fx = facets.filter(f => f.levels.length > 1);
  // the setup's own combinations (a review's named ones, cfg.named) first, on their own outcomes; then every one the facets give
  const named = cfg.named, nc = (named?.comparisons || []).map(c => ({ ...c, named: true })), ng = (named?.groupings || []).map(g => ({ ...g, named: true }));
  const namedOut = named?.outcomes?.length ? named.outcomes.map(id => outcomes.find(o => o.id === id)).filter(Boolean) : outcomes;
  const comparisons = [...nc, ...proposeComparisons(arms, fx, { restrictBy: restrictBy.filter(r => fx.some(f => f.id === r)) })];
  const groupings = [...ng, ...proposeGroupings(arms, fx, { restrictBy: restrictBy.filter(r => fx.some(f => f.id === r)) })];
  // a named combination with its own outcomes (one built on Syntheses) is evaluated on those; the review's on the setup's outcomes
  const own = d => (d.outcomes?.length ? d.outcomes.map(id => outcomes.find(o => o.id === id)).filter(Boolean) : namedOut);
  const plain = [...nc, ...ng].filter(d => !d.outcomes?.length), mine = [...nc, ...ng].filter(d => d.outcomes?.length);
  const records = [...(plain.length ? evaluateAll({ arms, outcomes: namedOut, comparisons: plain.filter(d => !d.subgroups), groupings: plain.filter(d => d.subgroups), settings, overlapKeep }).map(r => ({ ...r, named: true })) : []),
    ...mine.flatMap(d => evaluateAll({ arms, outcomes: own(d), comparisons: d.subgroups ? [] : [d], groupings: d.subgroups ? [d] : [], settings, overlapKeep }).map(r => ({ ...r, named: true }))),
    ...evaluateAll({ arms, outcomes, comparisons: comparisons.filter(c => !c.named), groupings: groupings.filter(g => !g.named), settings, overlapKeep })];
  // the table's columns, for a forest split by one (lib/synth-figures.mjs subgroupsOf); each forest's options as the person set them
  const columns = (synthTemplate(s)?.columns || []).filter(c => arms.some(a => a.cells?.[c.id])).map(c => ({ id: c.id, label: c.label || c.id }));
  return { arms, facets: fx, columns, forests: cfg.forests || {}, sheets: cfg.sheets || [], outcomes, comparisons, groupings, records, rob: robOverall(s), counts: verdictCounts(records), highlights: highlights(records), findings: findings({ arms, outcomes, records, facets: fx }, settings), settings };
}

/**
 * The arms' attributes to store: for every arm, its role, follow-up and each facet's level, the stored value where there is one and the rules' proposal
 * where there is none (`only: 'empty'`), or the proposal everywhere (`only: 'all'`). Returns the new `s.synthesis.arms`; the caller stores it.
 */
export function fillArms(s, { only = 'empty' } = {}) {
  const cfg = configOf(s), { facets } = withFacets({ ...s, synthesis: { ...cfg, arms: {}, manual: {} } }, synthArms(s)), base = synthArms(s), out = { ...(cfg.arms || {}) };
  for (const a of base) {
    const had = out[a.key] || {}, levels = { ...(had.facets || {}) };
    for (const f of facets.filter(x => !x.derive)) if (only === 'all' || levels[f.id] == null) { const v = proposedLevel(a, f); if (v != null) levels[f.id] = v; }
    out[a.key] = { role: had.role || a.role, facets: levels, ...(Number.isFinite(had.fu) ? { fu: had.fu } : Number.isFinite(a.fu) ? { fu: a.fu } : {}) };
  }
  return out;
}
