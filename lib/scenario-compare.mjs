// The protocol scenarios compared with the main protocol (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Goal 4):
// the counts per scenario, the studies each gains and loses, and the flow, main's as the trunk and each scenario branching at the first
// step its choice changes. Every count is lib/review-counts.mjs run on lib/scenarios.mjs scenarioView and every flow number the PRISMA flow's
// (prismaData of main, lib/scenario-prisma.mjs scenarioPrisma of a scenario, as Reporting › Flow shows them),
// none reduced here. The app's Scenarios part (views/protocol-scenarios.mjs), tools/lykos-scenarios.mjs and the MCP `review` action
// `scenarios` read these and the texts below, so a page, a shell and an agent say the same. Pure.
import { scenarioView, reaskTotal } from './scenarios.mjs';
import { scenariosOf, scenarioOf, runId, allRuns, MAIN_PROTOCOL } from './scenario-runs.mjs';
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";
import { lib_review_studies$perVersion as perVersion } from "../boot.mjs";
import { prismaData, derive, runName } from './prisma-counts.mjs';
import { scoped, MAIN } from './reviews.mjs';
import { lib_rules_key$criterionStage as criterionStage } from "../boot.mjs";
import { scenarioBranch, scenarioPrisma, mainOnBasis } from './scenario-prisma.mjs';
import { scenarioPool } from './sensitivity-runs.mjs';

const list = v => Array.isArray(v) ? v : [];
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const listSum = v => String(v || '').split(';').reduce((a, part) => a + num(part.split(',').pop()), 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const named = s => [{ id: MAIN_PROTOCOL, name: 'Main protocol' }, ...scenariosOf(s).map(x => ({ id: x.id, name: x.name || x.id }))];

/**
 * One row per protocol, main first: { id, name, records, screened, taIncluded, ftIncluded, studies, reask } (reask: the decisions the
 * scenario asks again, both stages, stale entries among them; 0 for main).
 */
export const scenarioSummary = perVersion(summaryOf);   // once per version of the live project
function summaryOf(s) {
  return named(s).map(({ id, name }) => {
    const c = reviewCounts(scenarioView(s, id)), reask = reaskTotal(s, id);
    return { id, name, records: c.ta.records, screened: c.ta.decided, taIncluded: c.ta.include, ftIncluded: c.ft.include, studies: c.studies, reask };
  });
}

/** The studies a scenario includes that main does not (gained) and main's it does not (lost): record ids, each in its own order. */
// kept per view: the live project's views are kept per version (lib/scenarios.mjs), so a revisit or a second selection costs nothing
const diffs = new WeakMap();
export function studiesDiff(s, id) {
  const view = scenarioView(s, id), hit = diffs.get(view);
  if (hit && hit.s === s) return hit.out;
  const main = reviewCounts(s).ids.studies, mine = reviewCounts(view).ids.studies;
  const a = new Set(main), b = new Set(mine), out = { gained: mine.filter(x => !a.has(x)), lost: main.filter(x => !b.has(x)) };
  diffs.set(view, { s, out });
  return out;
}

/**
 * The records of the studies a scenario gains, for Extraction while that scenario is picked (spec Settled 7, final review I6): their values go to the
 * one pool (s.values, keyed by record id), so the scenario's pooled estimate reads them; main's tables list main's studies as before.
 */
export function gainedPapers(s, id) {
  const byId = new Map([...list(s.papers), ...list(s.scenarioPapers)].filter(p => p?.id).map(p => [p.id, p]));
  return studiesDiff(s, id).gained.map(x => byId.get(x)).filter(Boolean);
}

// ---- the flow -------------------------------------------------------------------------------------------------------------------------

/** The flow's steps, as the PRISMA counts give them: [id, label, unit of its difference]. */
export const FLOW_STEPS = Object.freeze([['identified', 'Records identified', 'record'], ['screened', 'Records screened', 'record'],
  ['sought', 'Reports sought', 'report'], ['eligible', 'Reports assessed', 'report'], ['included', 'Studies included', 'study']]);
const UNIT = Object.fromEntries(FLOW_STEPS.map(([id, , u]) => [id, u]));
const LABEL = Object.fromEntries(FLOW_STEPS.map(([id, l]) => [id, l]));

/** A flow's numbers from its PRISMA counts (both columns of the PRISMA 2020 diagram summed): { identified, screened, sought, eligible, included }. */
function flowNumbers(d) {
  return {
    identified: num(d.database_results) + num(d.register_results) + num(d.citations_results) + num(d.website_results) + num(d.organisation_results) + listSum(d.other_sources_results),
    screened: num(d.records_screened),
    sought: num(d.dbr_sought_reports) + num(d.other_sought_reports),
    eligible: num(d.dbr_assessed) + num(d.other_assessed),
    included: num(d.new_studies),
  };
}

// the first step a scenario's choice changes, as its PRISMA flow takes it (lib/scenario-prisma.mjs scenarioBranch, Ruling 4): searches change
// what is identified, a criterion what is screened (title and abstract) or assessed (full text only)
const INPUT = { identification: 'identified', screening: 'screened', eligibility: 'eligible' };
const inputStep = (s, sc) => INPUT[scenarioBranch(s, sc.id).step] || null;

/**
 * The flow, in the numbers Reporting › Flow shows: { trunk: [{ step, label, n }] (main's), branches: [{ id, name, at: step, steps: [{ step, label, n, delta }] }] }, one branch
 * per scenario that differs, from the first step whose number or input differs from main's on (an empty scenario has no branch); and `lanes`, main's
 * then every scenario's: [{ id, name, at: step | null, steps: [{ step, label, n, delta, own }] }], a step before the branch point being main's (own false).
 * Once per version of the live project.
 */
export const scenarioFlow = perVersion(flowOf);
function flowOf(s) {
  // the numbers Reporting › Flow shows (Ruling 4): main's as main reports them (hand-entered counts among them), a scenario's main's up to its
  // branch point and derived from its view from there on (lib/scenario-prisma.mjs)
  const main = flowNumbers(prismaData(scoped(s, MAIN)));
  const trunk = FLOW_STEPS.map(([step, label]) => ({ step, label, n: main[step] }));
  const branches = [];
  for (const sc of scenariosOf(s)) {
    // prismaData of scenarioPrisma, with derive read on the view itself: the view is kept per version, so its derive is too (scenarioPrisma's
    // object is new on each call, and derive of it is the view's: it reads no `prisma`)
    const view = scenarioView(s, sc.id), mine = flowNumbers({ ...derive(view), ...scenarioPrisma(s, sc.id).prisma }), input = inputStep(s, sc);
    // the difference from the branch on is against main counted the same way (final review I3: derived against derived); `base` is that number,
    // `reported` main's as main reports it (by hand, where it entered one)
    const basis = flowNumbers(mainOnBasis(s, sc.id));
    const first = FLOW_STEPS.findIndex(([step]) => step === input || mine[step] !== basis[step]);
    if (first < 0) continue;
    branches.push({ id: sc.id, name: sc.name || sc.id, at: FLOW_STEPS[first][0],
      steps: FLOW_STEPS.slice(first).map(([step, label]) => ({ step, label, n: mine[step], delta: mine[step] - basis[step], base: basis[step], reported: main[step] })) });
  }
  const lanes = [{ id: MAIN_PROTOCOL, name: 'Main protocol', at: null, steps: trunk.map(t => ({ ...t, delta: 0, own: true })) },
    ...scenariosOf(s).map(sc => {
      const b = branches.find(x => x.id === sc.id), from = b ? FLOW_STEPS.findIndex(([step]) => step === b.at) : FLOW_STEPS.length;
      return { id: sc.id, name: sc.name || sc.id, at: b?.at || null, steps: trunk.map((t, i) => (i < from ? { ...t, delta: 0, own: false } : { ...b.steps[i - from], own: true })) };
    })];
  return { trunk, branches, lanes };
}

const short = (x, n = 48) => { const v = String(x || '').trim().replace(/\s+/g, ' '); return v.length > n ? `${v.slice(0, n - 1).replace(/[\s,;:.]+$/, '')}…` : v; };
const both = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
/**
 * What a scenario changes, as one plain line for its row (owner, 2 Nov 2026): "Removes E3: Sham shorter than 7 days", "Removes E3 and E7 together",
 * "Rewords E1 to: Not randomized", "Adds S1: Drug delivery", "Adds the Embase search", "Leaves out PubMed v3"; several kinds joined by "; ".
 */
export function changeLine(s, id) {
  const sc = scenarioOf(s, id);
  if (!sc) return '';
  const crit = new Map(list(s.protocol?.criteria).map(c => [String(c?.id), c])), runs = new Map(allRuns(s).map(r => [runId(r, s), r]));
  const runWord = r => (r ? r.name || runName(r) : '');
  const out = [], rm = sc.criteria.remove.map(String), ch = Object.entries(sc.criteria.change);
  if (rm.length === 1) out.push(`Removes ${rm[0]}${crit.get(rm[0])?.text ? `: ${short(crit.get(rm[0]).text)}` : ''}`);
  else if (rm.length) out.push(`Removes ${both(rm)} together`);
  if (ch.length === 1) out.push(`Rewords ${ch[0][0]} to: ${short(ch[0][1])}`);
  else if (ch.length) out.push(`Rewords ${both(ch.map(([c]) => c))}`);
  if (sc.criteria.add.length === 1) out.push(`Adds ${sc.criteria.add[0].id}: ${short(sc.criteria.add[0].text)}`);
  else if (sc.criteria.add.length) out.push(`Adds ${both(sc.criteria.add.map(c => c.id))}`);
  if (sc.searches.add.length) out.push(`Adds the ${both(sc.searches.add.map(r => runName(runs.get(String(r)) || {}) || r))} search${sc.searches.add.length > 1 ? 'es' : ''}`);
  if (sc.searches.remove.length) out.push(`Leaves out ${both(sc.searches.remove.map(r => runWord(runs.get(String(r))) || String(r).replace(/^db:/, '')))}`);
  return out.join('; ') || 'No change of the main protocol';
}

/** What a scenario changes of the main protocol, a line each ("criterion E3 removed", "search Embase_2026-11-01 added"). */
export function scenarioChanges(s, id) {
  const sc = scenarioOf(s, id);
  if (!sc) return [];
  const runs = new Map(allRuns(s).map(r => [runId(r, s), r.name || runName(r)])), crit = new Map(list(s.protocol?.criteria).map(c => [String(c?.id), c]));
  return [
    ...sc.criteria.remove.map(c => `criterion ${c} removed${crit.has(String(c)) ? '' : ' (no longer in the main protocol)'}`),
    ...Object.entries(sc.criteria.change).map(([c, t]) => `criterion ${c} reworded: ${t}`),
    ...sc.criteria.add.map(c => `criterion ${c.id} added (${c.kind === 'include' ? 'include' : 'exclude'}, ${criterionStage(c) === 'ft' ? 'full text' : 'title and abstract'}): ${c.text}`),
    ...sc.searches.remove.map(r => `search ${runs.get(String(r)) || r} left out`),
    ...sc.searches.add.map(r => `search ${runs.get(String(r)) || r} added`)];
}

/** "+6 records", "−2 studies", "No change". */
export function deltaText(step, delta) {
  if (!delta) return 'No change';
  const unit = UNIT[step] || 'record', n = Math.abs(delta);
  return `${delta > 0 ? '+' : '−'}${n} ${n === 1 ? unit : unit === 'study' ? 'studies' : `${unit}s`}`;
}

// ---- the texts a shell and an agent read -------------------------------------------------------------------------------------------------

const ROWS = [['records', 'Records'], ['screened', 'Records decided'], ['taIncluded', 'Included at title and abstract'], ['ftIncluded', 'Included at full text'], ['studies', 'Studies']];
const labelOf = (s, id) => [...list(s.papers), ...list(s.scenarioPapers)].find(p => p?.id === id)?.label || id;
const ids = (s, xs) => (xs.length ? xs.map(id => `${labelOf(s, id)} (${id})`).join(', ') : 'none');

/** The scenarios, one line each: "sc1  No duration limit: why". */
export function listText(s) {
  const all = scenariosOf(s);
  if (!all.length) return 'No scenarios. A scenario varies the protocol\'s searches or criteria and reuses every decision it can.';
  return all.map(x => `${x.id}  ${x.name || x.id}${x.reason ? `: ${x.reason}` : ''}`).join('\n');
}

/** "Revision: 8.5% [6.0, 11.9], 2 of 3 with data", or why it was not re-run. */
export function poolLine(o) {
  const pct = /^(PR|PLO|PFT|PLN|PAS|PRAW)$/i.test(String(o.measure || '')), f = v => (v == null ? '–' : pct ? `${(100 * v).toFixed(1)}%` : Number(v).toFixed(2));
  const est = o.run ? `${f(o.run.estimate)} [${f(o.run.lo).replace('%', '')}, ${f(o.run.hi).replace('%', '')}]` : `not re-run (${o.reason})`;
  return `${o.name}: ${est}${o.k != null ? `, ${o.k} of ${o.n} with data` : ''}`;
}

/** The comparison table as text (main and every scenario, or main and one), then for one scenario its studies gained and lost and its pooled estimates. */
export function compareText(s, id = null) {
  const rows = scenarioSummary(s).filter(r => !id || r.id === MAIN_PROTOCOL || r.id === id);
  if (id && rows.length < 2) scenarioOf(s, id);   // an unknown id throws
  const w0 = Math.max(...ROWS.map(([, l]) => l.length)), w = rows.map(r => Math.max(r.name.length, 6));
  const line = (head, cells) => `${head.padEnd(w0)}  ${cells.map((c, i) => String(c).padStart(w[i])).join('  ')}`;
  const out = [line('', rows.map(r => r.name)), ...ROWS.map(([k, l]) => line(l, rows.map(r => r[k])))];
  for (const r of rows.slice(1)) {
    if (rows.length > 2 && !id) continue;
    const d = studiesDiff(s, r.id), pool = scenarioPool(s, r.id).outcomes;
    out.push('', `${r.name}: gained ${ids(s, d.gained)}; lost ${ids(s, d.lost)}`);
    for (const o of pool) out.push(`  ${poolLine(o)}`);
  }
  return out.join('\n');
}

/** One scenario: its reason, what it changes, what it asks again, where its flow branches and its counts against main's. */
export function showText(s, id) {
  const sc = scenarioOf(s, id);
  if (!sc) throw new Error('show needs a scenario\'s id (main is the main protocol)');
  const changes = scenarioChanges(s, id);
  const flow = scenarioFlow(s).branches.find(b => b.id === sc.id), row = scenarioSummary(s).find(r => r.id === sc.id);
  return [`${sc.id}  ${sc.name}${sc.reason ? `: ${sc.reason}` : ''}`,
    ...(changes.length ? changes.map(c => `  ${c}`) : ['  no change of the main protocol']),
    `Re-asks ${plural(row.reask, 'record')}`,
    flow ? `Branches at ${LABEL[flow.at].toLowerCase()}` : 'Its flow is main\'s',
    '', compareText(s, sc.id)].join('\n');
}

/** The flow as text: main's steps, then each branch from its step with the difference at each. */
export function flowText(s, id = null) {
  const f = scenarioFlow(s), branches = f.branches.filter(b => !id || b.id === id);
  if (id) scenarioOf(s, id);
  const out = [`Main protocol: ${f.trunk.map(t => `${t.label} ${t.n}`).join(', ')}`];
  for (const b of branches) out.push(`${b.name} (${b.id}), from ${LABEL[b.at].toLowerCase()}: ${b.steps.map(t => `${t.label} ${t.n} (${deltaText(t.step, t.delta)})`).join(', ')}`);
  if (id && !branches.length) out.push(`${scenarioOf(s, id).name} (${id}): no branch, its flow is main's`);
  return out.join('\n');
}
