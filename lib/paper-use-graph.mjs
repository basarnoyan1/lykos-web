// Which pooled analyses the paper uses (plan amendment "Not used in the paper", 2026-10-17). An analysis is used when something past its
// own results reads it in the dependency graph (lib/deps-graph.mjs): a manuscript sentence citing one of its results, a GRADE row rating it,
// a table, figure or package item, a file. One that feeds none of these is "Not used in the paper": it stays listed and removable, but once
// its data changed since it ran it is at rest, and the Overview does not ask to run it again nor Certainty to rate it.
//
// The graph is built once per version of the open project (the store's version) and for any other state each time it is asked. The graph
// and what it reads are many modules: readers reach this through lib/paper-use.mjs, which loads it only for a project with a pooled result.
import { buildGraph, reach } from './deps-graph.mjs';
import { get, getVersion } from '../store.mjs';

let memo = { state: null, version: -1, use: null };

/** `Map(outcomeId -> { used, stale })` over the pooled analyses that ran: used when any timepoint is, stale when any timepoint's data changed. */
export function analysisUse(s) {
  const live = s === get(), version = live ? getVersion() : -1;
  if (live && memo.state === s && memo.version === version) return memo.use;
  const g = buildGraph(s), use = new Map();
  for (const n of g.nodes.values()) {
    if (n.kind !== 'analysis' || n.id.startsWith('analysis:ds:')) continue;
    const oid = n.id.slice('analysis:'.length).split('#')[0];
    const used = reach(g, n.id, 'down').some(h => h.node.kind !== 'result');
    const had = use.get(oid) || { used: false, stale: false };
    use.set(oid, { used: had.used || used, stale: had.stale || !!n.stale });
  }
  if (live) memo = { state: s, version, use };
  return use;
}

/** Whether an outcome's analysis ran and nothing in the paper uses it. */
export const notUsed = (s, outcomeId) => analysisUse(s).get(outcomeId)?.used === false;

/** The outcomes whose analysis the paper does not use and whose data changed since it ran: nothing asks to run or rate them again. */
export function atRest(s) {
  const out = new Set();
  for (const [oid, u] of analysisUse(s)) if (!u.used && u.stale) out.add(oid);
  return out;
}
