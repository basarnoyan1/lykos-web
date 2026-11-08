// The protocol scenarios' actions, defined once for the app, tools/lykos-scenarios.mjs and the MCP `review` action `scenarios` (spec
// docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Goal 5, owner 2 Nov 2026: "one standard way to view and change
// scenarios"). A read is one function of lib/scenario-compare.mjs; a write is the change-file ops scenarioOps answers (set_scenario,
// assign_run, screen with scenario), which the app's store applies through lib/change-file.mjs as lykos-apply does. `app` names the view
// that offers the action and the function it calls there; app/test/mcp-cli-parity.test.mjs fails when an action is missing from one of the
// three. Pure.
import { scenarioOf, runId, allRuns, MAIN_PROTOCOL } from './scenario-runs.mjs';
import { runName } from './prisma-counts.mjs';

const list = v => Array.isArray(v) ? v : [];
const str = v => String(v ?? '').trim();

/** Every action: `args` is its command line after the action word, `app` where the app offers it ('view file: function'). */
export const SCENARIO_ACTIONS = Object.freeze({
  list: { read: true, args: '', app: 'scenario-pick.mjs: scenarioPicker' },
  show: { read: true, args: '<id>', app: 'protocol-scenarios.mjs: scenarioSection' },
  compare: { read: true, args: '[id]', app: 'protocol-scenarios.mjs: scenarioRow' },
  flow: { read: true, args: '[id]', app: 'protocol-scenarios.mjs: scenarioFlow' },
  create: { args: '<name> [--reason <text>]', app: 'protocol-scenario.mjs: scenarioAct' },
  rename: { args: '<id> <name>', app: 'protocol-scenario.mjs: scenarioAct' },
  delete: { args: '<id>', app: 'protocol-scenario.mjs: scenarioAct' },
  criterion: { args: '<id> remove|restore <criterion> | reword <criterion> <text> | add include|exclude ta|ft <text>', app: 'protocol-scenario.mjs: scenarioAct' },
  search: { args: '<id> leave|keep <run>', app: 'protocol-scenario.mjs: scenarioAct' },
  promote: { args: '<run>', app: 'protocol-scenario.mjs: scenarioAct' },
  import: { args: '<id> <file>', app: 'library.mjs: importInto' },
  decide: { args: '<id> <record> include|exclude|uncertain [--stage ft] [--reason <text>]', app: 'screening.mjs: decideIn' },
});
export const READS = Object.keys(SCENARIO_ACTIONS).filter(k => SCENARIO_ACTIONS[k].read);
export const WRITES = Object.keys(SCENARIO_ACTIONS).filter(k => !SCENARIO_ACTIONS[k].read);

const without = (xs, x) => list(xs).filter(v => String(v) !== String(x));
const noKey = (o, k) => Object.fromEntries(Object.entries(o || {}).filter(([id]) => id !== String(k)));

/** A run a command names: its id, its name, or its source ("Embase"), among main's and the scenarios' runs. */
export function runRef(s, ref) {
  const r = str(ref), runs = allRuns(s), low = r.toLowerCase();
  const hit = runs.find(x => runId(x, s) === r) || runs.find(x => str(x?.name).toLowerCase() === low);
  if (hit) return runId(hit, s);
  const named = runs.filter(x => runName(x).toLowerCase() === low);
  if (named.length === 1) return runId(named[0], s);
  throw new Error(named.length ? `"${r}" names ${named.length} runs (${named.map(x => runId(x, s)).join(', ')}): give the run id` : `no search run ${r}`);
}

/** The first `S1`, `S2`, … neither main's criteria nor the scenario's use. */
function newCriterionId(s, sc) {
  const used = new Set([...list(s.protocol?.criteria).map(c => String(c?.id)), ...sc.criteria.add.map(c => String(c?.id))]);
  let n = 1;
  while (used.has(`S${n}`)) n++;
  return `S${n}`;
}

/**
 * The change-file ops one write is: a = { id, name, reason, criterion, how, text, kind, stage, run, keep, record, decision, reason }.
 * criterion: `how` remove | restore | reword | add (kind include | exclude, stage ta | ft, text); search: keep true takes a run back
 * (main's) or into the scenario (its own), false leaves it out. Throws on what the op would refuse anyway, before anything is written.
 */
export function scenarioOps(s, action, a = {}) {
  const sc = () => { const x = scenarioOf(s, str(a.id) || MAIN_PROTOCOL); if (!x) throw new Error(`${action} needs a scenario's id (main is the main protocol)`); return x; };
  switch (action) {
    case 'create': return [{ op: 'set_scenario', name: str(a.name), ...(str(a.reason) ? { reason: str(a.reason) } : {}) }];
    case 'rename': return [{ op: 'set_scenario', id: sc().id, name: str(a.name) }];
    case 'delete': return [{ op: 'set_scenario', id: sc().id, remove: true }];
    case 'criterion': {
      const x = sc(), k = x.criteria, cid = str(a.criterion), main = list(s.protocol?.criteria).find(c => String(c?.id) === cid);
      const own = k.add.find(c => String(c?.id) === cid), text = str(a.text);
      let next;
      if (a.how === 'add') {
        if (!text) throw new Error('an added criterion needs its text');
        next = { add: [...k.add, { id: newCriterionId(s, x), kind: a.kind === 'include' ? 'include' : 'exclude', stage: a.stage === 'ft' || /full/i.test(str(a.stage)) ? 'Full text' : 'Title/abstract', text }] };
      } else if (!main && !own && !k.remove.map(String).includes(cid) && !(cid in k.change)) throw new Error(`no criterion ${cid} in the main protocol or scenario ${x.id}`);
      else if (a.how === 'remove') next = own ? { add: k.add.filter(c => c !== own) } : { remove: [...without(k.remove, cid), cid], change: noKey(k.change, cid) };
      else if (a.how === 'restore') next = { remove: without(k.remove, cid), change: noKey(k.change, cid) };
      else if (a.how === 'reword') {
        if (!text) throw new Error('reword needs the new text');
        next = own ? { add: k.add.map(c => (c === own ? { ...c, text } : c)) }
          : { change: text === str(main?.text) ? noKey(k.change, cid) : { ...k.change, [cid]: text } };
      } else throw new Error('criterion is remove, restore, reword or add');
      return [{ op: 'set_scenario', id: x.id, criteria: next }];
    }
    case 'search': {
      const x = sc(), rid = runRef(s, a.run), own = list(s.scenarioSearches).some(r => runId(r, s) === rid);
      const searches = own ? { add: a.keep ? [...without(x.searches.add, rid), rid] : without(x.searches.add, rid) }
        : { remove: a.keep ? without(x.searches.remove, rid) : [...without(x.searches.remove, rid), rid] };
      return [{ op: 'set_scenario', id: x.id, searches }];
    }
    case 'promote': return [{ op: 'assign_run', run: runRef(s, a.run) }];
    case 'decide': {
      // the stage as criterion add reads it; another word is refused, not taken as title and abstract (final review M10)
      const x = sc(), w = str(a.stage).toLowerCase(), stage = !w || /^(ta|title)/.test(w) ? 'ta' : /^(ft|full)/.test(w) ? 'ft' : null;
      if (!stage) throw new Error(`stage is ta or ft, not ${a.stage}`);
      return [{ op: 'screen', scenario: x.id, paper: str(a.record), decision: str(a.decision), stage, ...(str(a.reason) ? { reason: str(a.reason) } : {}), ...(a.by ? { by: str(a.by) } : {}) }];
    }
    default: throw new Error(`${action} is not a scenario write (${WRITES.join(', ')})`);
  }
}
