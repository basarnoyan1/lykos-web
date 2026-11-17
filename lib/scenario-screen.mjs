// A protocol scenario's decisions from the app (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Settled 5 and 8):
// lib/scenarios.mjs writes them into the scenario's overlay, one store update each, saved as lib/screen.mjs's decide is (the store's short
// debounce; while the screening log's earlier chunks are loading the save waits for them, store.mjs lateLog). Main's decisions are
// lib/screen.mjs's alone.
import { store$update as update, store$whenSaved as whenSaved } from "../boot.mjs";
import { decideScenarioMany, undoScenario, restoreScenario, assignRun } from './scenarios.mjs';

// a refusal (the main protocol, an unknown scenario, a missing reason, a record not in it) is thrown before anything changes
function apply(fn) {
  let out;
  try { update(s => { out = fn(s); return s; }); } catch (e) { return Promise.reject(e); }
  return whenSaved().then(() => out);
}

/** One decision in a scenario: 'saved', or 'dropped' when it equals the main decision the scenario inherits. */
export const decideIn = (scenarioId, stage, id, decision, { reason = '', by = '', via = '', note = '' } = {}) =>
  apply(s => decideScenarioMany(s, scenarioId, stage, [{ id, decision, reason }], { by, via, note })[0]);

/** Several decisions of one stage as one change and one write: [{ id, decision, reason?, via? }]; every one is logged. */
export const decideManyIn = (scenarioId, stage, list, { by = '' } = {}) =>
  (list.length ? apply(s => decideScenarioMany(s, scenarioId, stage, list, { by })) : Promise.resolve([]));

/** A scenario's own decision taken away: 'undone', or 'none'. */
export const undoIn = (scenarioId, stage, id, { by = '' } = {}) => apply(s => undoScenario(s, scenarioId, stage, id, { by }));

/** A scenario's own entry put back verbatim (an Undo of a re-decision): 'restored'. */
export const restoreIn = (scenarioId, stage, id, entry, { by = '' } = {}) => apply(s => restoreScenario(s, scenarioId, stage, id, entry, { by }));

/** A run imported for a scenario made main's, with its records (lib/scenarios.mjs assignRun; their abstracts are on them, inline). */
export const assignRunIn = run => apply(s => assignRun(s, run));
