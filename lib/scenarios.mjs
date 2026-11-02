// Protocol scenarios (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Settled 2 to 6): which of the main protocol's
// decisions a scenario inherits and which it asks again (effectiveDecision), and the project as the scenario sees it (scenarioView), so
// lib/review-counts.mjs, the queues and PRISMA's derive count a scenario through the path they count the main protocol by. Nothing here
// writes: a scenario's own decisions are its overlay, s.scenarioScreening[id].ta|ft, single-screened, each with the main decision it was
// made against (`against`). Pure, but for the views kept per version of the store's live project.
import { MAIN_PROTOCOL, scenarioOf, scenariosOf, memberIds, keptRuns, runId, recordRuns, ensureRunIds, allRuns, allPapers, pinRunIds } from './scenario-runs.mjs';
import { lib_screen$decisionAt as decisionAt, lib_screen$stageOf as stageOf } from "../boot.mjs";
import { scoped, MAIN } from './reviews.mjs';
import { reasonCode } from './screening-checks.mjs';
import { lib_review_studies$liveVersion as liveVersion, lib_review_studies$keepView as keepView } from "../boot.mjs";
import { lib_search_library$addMainRecords as addMainRecords, lib_search_library$noteSource as noteSource } from "../boot.mjs";
import { lib_rules_key$criterionStage as criterionStage } from "../boot.mjs";

const list = v => Array.isArray(v) ? v : [];
const RANK = { ta: 0, ft: 1 };
const rank = stage => RANK[criterionStage(stage)];   // a criterion's stage written either way (lib/rules-key.mjs)

/**
 * What a scenario changes of the main protocol's criteria, read once for a pass over the records. A `remove` or `change` naming a criterion
 * main no longer has is ignored (rule 6); a criterion both removed and changed is removed.
 */
function judge(s, sc) {
  const main = list(s.protocol?.criteria).filter(c => c && c.id != null), mainIds = new Set(main.map(c => String(c.id)));
  const removed = new Set(sc.criteria.remove.map(String).filter(id => mainIds.has(id)));
  const changed = new Set(Object.keys(sc.criteria.change).filter(id => mainIds.has(id) && !removed.has(id)));
  const added = sc.criteria.add.filter(c => c && c.id != null);
  const has = new Set([...[...mainIds].filter(id => !removed.has(id)), ...added.map(c => String(c.id))]);
  const from = cs => cs.length ? Math.min(...cs.map(c => rank(c.stage))) : Infinity;
  // a reworded inclusion criterion may no longer admit what it admitted: as an added one, from its stage on (includes cite nothing)
  const addedFrom = from(added), changedFrom = from(main.filter(c => changed.has(String(c.id)) && c.kind === 'include'));
  const touched = removed.size + changed.size > 0, overlay = s.scenarioScreening?.[sc.id] || {};
  const fresh = new Set(list(s.scenarioPapers).map(p => p?.id));   // only a scenario's runs found them (s.scenarioPapers)
  for (const p of list(s.papers)) fresh.delete(p?.id);
  const criteria = [...main.filter(c => !removed.has(String(c.id))).map(c => changed.has(String(c.id)) ? { ...c, text: String(sc.criteria.change[c.id]) } : c),
    ...added.map(c => ({ ...c }))];
  const j = {
    criteria,
    at(stage, id) {
      const st = stageOf(stage).id, was = decisionAt(s, st, id), own = overlay[st]?.[id];
      if (own) {
        const code = reasonCode(own.reason);
        // a code that names no criterion of main cites none (as below); one main has and the scenario removed is no longer the scenario's
        const stale = (own.against ?? null) !== (was?.decision ?? null) || Boolean(code && mainIds.has(code) && !has.has(code));
        return { decision: own, source: 'scenario', ...(stale ? { stale: true } : {}), ...(was ? { was } : {}) };
      }
      return j.inherited(st, id, was);
    },
    /** What the scenario takes of main's decision, its own entry aside: main's, or a question (reask), or none. */
    inherited(stage, id, was = decisionAt(s, stageOf(stage).id, id)) {
      const st = stageOf(stage).id;
      if (fresh.has(id)) return { decision: null, source: 'none', reask: 'new' };
      if (!was) return { decision: null, source: 'none' };
      const ask = reask => ({ decision: null, source: 'none', reask, was });
      if (was.decision === 'exclude') {
        const code = reasonCode(was.reason), cites = code && mainIds.has(code);
        if (cites && removed.has(code)) return ask('removed');
        if (cites && changed.has(code)) return ask('changed');
        if (!cites && touched) return ask('uncited');
      } else if (was.decision === 'include' || was.decision === 'uncertain') {
        const why = addedFrom <= RANK[st] ? 'added' : changedFrom <= RANK[st] ? 'changed' : '';
        if (why) {
          // a full-text exclusion the scenario keeps settles the record: its title and abstract include is not asked again (final review M1)
          if (st === 'ta') { const f = j.at('ft', id); if (f.source !== 'none' && !f.stale && f.decision?.decision === 'exclude') return { decision: was, source: 'main' }; }
          return ask(why);
        }
      }
      return { decision: was, source: 'main' };
    },
  };
  return j;
}

/**
 * A record's decision at a stage as a scenario sees it: { decision: entry | null, source: 'scenario' | 'main' | 'none', reask?, stale?, was? }.
 * The scenario's own entry wins, stale when the main decision is no longer the one it was made against or its reason cites a criterion the
 * scenario does not have. A record only the scenario's searches found is new (undecided). With no main decision, undecided. A main exclusion
 * is asked again when its reason's code is a criterion the scenario removes ('removed') or rewords ('changed'), or when it cites none (no
 * code, or a code no criterion of main has) and the scenario removes or rewords any ('uncited'); a main include or uncertain when a
 * criterion the scenario adds ('added') or an inclusion criterion it rewords ('changed') applies at this stage or an earlier one. Else main's decision holds. `was` is main's decision a scenario entry or a question replaces. 'main' (or no id) is
 * the main decision itself; an unknown id throws.
 */
export function effectiveDecision(s, scenarioId, stage, recordId) {
  const sc = scenarioOf(s, scenarioId);
  if (!sc) { const d = decisionAt(s, stage, recordId); return { decision: d, source: d ? 'main' : 'none' }; }
  return judge(s, sc).at(stage, recordId);
}

/** effectiveDecision for many records of one scenario: (stage, recordId) => the same answer, the scenario's changes read once. */
export function scenarioDecisions(s, scenarioId) {
  const sc = scenarioOf(s, scenarioId);
  if (!sc) return (stage, id) => effectiveDecision(s, null, stage, id);
  const j = judge(s, sc);
  return (stage, id) => j.at(stage, id);
}

/** How many decisions a scenario asks again, and why, per stage: { ta: { removed, changed, uncited, added, new, stale }, ft: { … } }. */
export function reaskCounts(s, scenarioId) {
  const zero = () => ({ removed: 0, changed: 0, uncited: 0, added: 0, new: 0, stale: 0 }), out = { ta: zero(), ft: zero() };
  const sc = scenarioOf(s, scenarioId);
  if (!sc) return out;
  const j = judge(s, sc), members = memberIds(s, scenarioId);
  for (const id of members) for (const st of ['ta', 'ft']) {
    const e = j.at(st, id);
    if (e.stale) out[st].stale++;
    else if (e.reask) out[st][e.reask]++;
  }
  return out;
}

/** How many records a scenario asks again at either stage (stale entries among them), each record once (final review M2). */
export function reaskTotal(s, scenarioId) {
  const sc = scenarioOf(s, scenarioId);
  if (!sc) return 0;
  const j = judge(s, sc);
  let n = 0;
  for (const id of memberIds(s, scenarioId)) if (STAGE_IDS.some(st => { const e = j.at(st, id); return e.stale || e.reask; })) n++;
  return n;
}

/**
 * What a scenario asks again, by why, both stages summed: { codes: Map<criterion id, n> (main exclusions citing a criterion it removes or
 * rewords, in main's criteria order), uncited, added (includes and uncertain under a criterion it adds), reworded (the same under an inclusion
 * criterion it rewords), new, stale }. The protocol page's summary line reads it.
 */
export function reaskReasons(s, scenarioId) {
  const out = { codes: new Map(), uncited: 0, added: 0, reworded: 0, new: 0, stale: 0 }, once = { added: new Set(), reworded: new Set() };
  const sc = scenarioOf(s, scenarioId);
  if (!sc) return out;
  for (const c of list(s.protocol?.criteria)) if (c?.id != null) out.codes.set(String(c.id), 0);
  const j = judge(s, sc);
  for (const id of memberIds(s, scenarioId)) for (const st of STAGE_IDS) {
    const e = j.at(st, id);
    if (e.stale) { out.stale++; continue; }
    if (!e.reask || (e.reask === 'new' && st === 'ft')) continue;   // a record new to the scenario counts once
    if (e.reask === 'removed' || (e.reask === 'changed' && e.was?.decision === 'exclude')) { const code = reasonCode(e.was.reason); out.codes.set(code, (out.codes.get(code) || 0) + 1); }
    else if (e.reask === 'changed') once.reworded.add(id);
    else if (e.reask === 'added') once.added.add(id);
    else out[e.reask]++;
  }
  out.added = once.added.size; out.reworded = once.reworded.size;   // records, whichever stage asks again
  for (const [k, n] of out.codes) if (!n) out.codes.delete(k);
  return out;
}

/**
 * How many of main's exclusions cite each criterion of the main protocol, at one stage ('ta', 'ft') or both: Map<criterion id, n>, every
 * criterion there (0 when none cites it). A reason's code (screening-checks reasonCode, a bare code too) that names no criterion counts nowhere.
 */
export function criterionCitations(s, stage) {
  const out = new Map();
  for (const c of list(s?.protocol?.criteria)) if (c?.id != null) out.set(String(c.id), 0);
  const stages = stage ? [criterionStage(stage)] : STAGE_IDS;
  for (const p of list(s?.papers)) for (const st of stages) {
    const d = p?.id != null && decisionAt(s, st, p.id);
    if (d?.decision !== 'exclude') continue;
    const code = reasonCode(d.reason);
    if (out.has(code)) out.set(code, out.get(code) + 1);
  }
  return out;
}

// One view per scenario while the live project stays at one version (lib/review-studies.mjs perVersion's rule; a tool's project is computed).
// One entry: another project or version drops every view of the last.
let views = { s: null, v: null, byId: new Map() };
/** For the tests: how many projects and views the cache holds. */
export const _viewsHeld = () => ({ projects: views.s ? 1 : 0, views: views.byId.size });

/**
 * The project as a scenario sees it: its review's (lib/reviews.mjs scoped) with its records (lib/scenario-runs.mjs memberIds, in the
 * library's order, a scenario-only record's mark dropped on a copy), the merges into them, its searches (its review's less the runs it
 * removes, plus the runs it adds, their scenario mark dropped), its decisions (effectiveDecision; a stale entry carries needsCriteriaReview,
 * so the queue opens it), single-screened, and its criteria in the protocol, which names it (`protocol.scenario`). Every reader of the
 * project then counts the scenario unchanged. 'main' (or no id) is scoped(s, MAIN) itself. Callers must not change what they get.
 */
export function scenarioView(s, scenarioId) {
  const sc = scenarioOf(s, scenarioId);
  if (!sc) return scoped(s, MAIN);
  const v = liveVersion(s);
  if (typeof v !== 'number') return viewOf(s, sc);
  if (views.s !== s || views.v !== v) views = { s, v, byId: new Map() };
  let out = views.byId.get(sc.id);
  if (!out) { views.byId.set(sc.id, out = viewOf(s, sc)); keepView(out, v); }   // the counts of a view are then kept per version too
  return out;
}

function viewOf(s, sc) {
  const base = scoped(s, sc.review), members = memberIds(s, sc.id), j = judge(s, sc);
  // its review's records it holds, then those only a scenario's runs found (s.scenarioPapers), for a scenario of any review
  const own = list(s.scenarioPapers), ids = new Set(list(base.papers).map(p => p?.id));
  const papers = [...list(base.papers), ...own.filter(p => !ids.has(p?.id))].filter(p => p?.id && members.has(p.id));
  const screening = {}, fulltext = {}, exclusions = { ta: [], ft: [] };
  for (const p of papers) for (const [st, into] of [['ta', screening], ['ft', fulltext]]) {
    const e = j.at(st, p.id);
    if (e.decision) into[p.id] = e.stale ? { ...e.decision, needsCriteriaReview: true } : e.decision;
    else if (e.reask && e.was?.decision === 'exclude') exclusions[st].push(p);
  }
  const { dual, ...rest } = base;
  const out = {
    ...rest, papers, screening, fulltext,
    merged: [...list(base.merged), ...list(s.scenarioMerged)].filter(m => members.has(m?.keepId)),
    // its own model proposals (Ruling 4: s.scenarioProposals[id], each with the fingerprint of the rules it was made under), never main's
    proposals: s.scenarioProposals?.[sc.id] || {},
    searches: searchesOf(s, sc, base),
    settings: { ...(base.settings || {}), dualScreening: false },
    protocol: { ...(base.protocol || {}), criteria: j.criteria, scenario: sc.id },
  };
  asked.set(out, exclusions);
  return out;
}

const asked = new WeakMap();
/** The records of a scenario's view whose main exclusion at `stage` it asks again (none it decided itself), in the view's order. */
export const reaskedExclusions = (view, stage) => asked.get(view)?.[stage] || [];

/**
 * The scenario's search log, in log order: its review's runs (as scoped gives them) less those it removes, and the runs it adds with their
 * scenario mark dropped. A failed or exploratory run, which no protocol keeps, stays as the review's log has it.
 */
function searchesOf(s, sc, base) {
  const all = allRuns(s), view = list(base.searches), kept = keptRuns(s, sc.id), added = new Set(sc.searches.add);
  const idx = new Map(all.map((r, i) => [r, i]));
  // scoped's runs: the main review's are the log's own objects; another review's are copies of its runs, in log order
  const origin = view.every(r => idx.has(r)) ? view.map(r => idx.get(r)) : all.map((_, i) => i).filter(i => all[i]?.review === sc.review && !all[i]?.scenario);
  const at = new Map(origin.map((i, k) => [i, view[k]]));
  const out = [];
  all.forEach((r, i) => {
    const id = runId(r, s), mine = at.get(i);
    if (mine) { if (kept.has(id) || r.status === 'failed' || r.exploratory) out.push(mine); return; }
    if (added.has(id) && kept.has(id)) { const { scenario, ...run } = r; out.push(sc.review === MAIN ? run : { ...run, review: undefined }); }
  });
  return out;
}

// ---- writes (spec Settled 5, 6 and 8) -------------------------------------------------------------------------------------------------
// Pure on a project state, as lib/screen.mjs applyDecision is: the app's go through lib/scenario-screen.mjs (update, whenSaved), a change
// file's through lib/change-file.mjs. A scenario's decisions are its overlay, s.scenarioScreening[id].ta|ft, and nothing here writes main's
// (screening, fulltext, dual): main's decision is read only to say what an entry was made against. Each checks everything before it
// changes anything (store.mjs update keeps what a reducer changed before it threw). The screening log is only appended to.

const STAGE_IDS = ['ta', 'ft'];
const DECISIONS = ['include', 'exclude', 'uncertain'];
const FIELDS = ['name', 'reason', 'searches', 'criteria'];
const copy = v => JSON.parse(JSON.stringify(v));
const isMain = id => id == null || id === '' || id === MAIN_PROTOCOL;

/** The scenario a write names, normalized; the main protocol is refused (its decisions are main's), an unknown id throws (scenarioOf). */
function writable(st, id) {
  if (isMain(id)) throw new Error('main is the main protocol, not a scenario: its decisions are made without one');
  return scenarioOf(st, id);
}
/** The scenario's own entry in protocol.scenarios, to change in place. */
const entryOf = (st, id) => st.protocol.scenarios.find(x => x && String(x.id) === id);

/**
 * Adds a scenario of a review's protocol and answers its id, the first `sc1`, `sc2`, … no scenario or scenario's run names (a removed
 * scenario's runs keep its id). `from` copies another scenario's searches and criteria (its diff).
 */
export function addScenario(st, { name = '', reason = '', review = MAIN, from = null } = {}) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('a scenario needs a name');
  const base = isMain(from) ? null : scenarioOf(st, from);
  if (review !== MAIN && !list(st.reviews).some(r => r?.id === review)) throw new Error(`no review ${review}`);
  st.protocol ||= {};
  if (!Array.isArray(st.protocol.scenarios)) st.protocol.scenarios = [];
  const taken = new Set([...st.protocol.scenarios.map(x => String(x?.id)), ...allRuns(st).map(r => r?.scenario).filter(Boolean)]);
  let k = 1;
  while (taken.has(`sc${k}`)) k++;
  const id = `sc${k}`;
  st.protocol.scenarios.push({ id, name: n, reason: String(reason ?? ''), created: new Date().toISOString(), review: review || MAIN,
    searches: base ? copy(base.searches) : { add: [], remove: [] }, criteria: base ? copy(base.criteria) : { add: [], remove: [], change: {} } });
  return id;
}

/**
 * Changes a scenario: `name`, `reason`, `searches` ({ add?, remove? }: run ids, `db:<database id>` in remove) and `criteria` ({ add?: [{ id,
 * kind, stage, text }], remove?: [ids], change?: { id: text } }); a list or map given replaces the one there, one left out stays. A run it
 * names keeps its id from then on (ensureRunIds); a run id no run has is refused.
 */
export function editScenario(st, id, patch = {}) {
  const sc = writable(st, id);
  const bad = Object.keys(patch || {}).find(k => !FIELDS.includes(k));
  if (bad) throw new Error(`${bad} is not a scenario field (${FIELDS.join(', ')})`);
  const next = { searches: { ...sc.searches }, criteria: { ...sc.criteria } };
  if ('name' in patch && !String(patch.name ?? '').trim()) throw new Error('a scenario needs a name');
  for (const [part, keys] of [['searches', ['add', 'remove']], ['criteria', ['add', 'remove', 'change']]]) {
    const p = patch[part];
    if (p == null) continue;
    if (typeof p !== 'object' || Array.isArray(p)) throw new Error(`${part} is { ${keys.join(', ')} }`);
    for (const k of Object.keys(p)) {
      if (!keys.includes(k)) throw new Error(`${part}.${k} is not one of ${keys.join(', ')}`);
      const v = p[k];
      if (k === 'change' ? !v || typeof v !== 'object' || Array.isArray(v) : !Array.isArray(v)) throw new Error(`${part}.${k} is ${k === 'change' ? 'a map of criterion id to text' : 'a list'}`);
      next[part][k] = copy(v);
    }
  }
  const mainIds = new Set(list(st.protocol?.criteria).map(c => String(c?.id)));
  for (const c of next.criteria.add) {
    if (!c || c.id == null || !String(c.text ?? '').trim()) throw new Error('an added criterion needs an id and its text');
    if (mainIds.has(String(c.id))) throw new Error(`${c.id} is a criterion of the main protocol: change its text instead`);
  }
  const named = [...next.searches.add, ...next.searches.remove.filter(x => !String(x).startsWith('db:'))].map(String);
  const ids = new Set(allRuns(st).map(r => runId(r, st)));   // a scenario's own runs (s.scenarioSearches) are named in its add
  const missing = named.find(x => !ids.has(x));
  if (missing) throw new Error(`no search run ${missing}`);
  const entry = entryOf(st, sc.id);
  if ('name' in patch) entry.name = String(patch.name).trim();
  if ('reason' in patch) entry.reason = String(patch.reason ?? '');
  if (patch.searches) entry.searches = next.searches;
  if (patch.criteria) entry.criteria = next.criteria;
  ensureRunIds(st, named);
  return st;
}

/**
 * Removes a scenario and its overlay. The runs imported for it and the records only they found stay where they are (s.scenarioSearches,
 * s.scenarioPapers), still the scenario's, for the person to decide on: answered as { runs: [run ids], records: [record ids] }. Nothing
 * is deleted.
 */
export function removeScenario(st, id) {
  const sc = writable(st, id);
  const runs = list(st.scenarioSearches).filter(r => r?.scenario === sc.id), rids = new Set(runs.map(r => runId(r, st))), byRec = recordRuns(st);
  const records = list(st.scenarioPapers).filter(p => [...(byRec.get(p?.id) || [])].some(r => rids.has(r))).map(p => p.id);
  st.protocol.scenarios = st.protocol.scenarios.filter(x => !(x && String(x.id) === sc.id));
  if (st.scenarioScreening && sc.id in st.scenarioScreening) delete st.scenarioScreening[sc.id];
  if (st.scenarioProposals && sc.id in st.scenarioProposals) delete st.scenarioProposals[sc.id];
  return { runs: [...rids], records };
}

// a run of the log put back in time order (its id is pinned first, so no id moves)
const ordered = (list, r) => { const i = list.findIndex(x => String(x?.at || '') > String(r.at || '')); i < 0 ? list.push(r) : list.splice(i, 0, r); };

/**
 * Makes a run imported for a scenario main's (Settled 1, Ruling 3: a main run is never moved into a scenario; a scenario leaves one out
 * with `searches.remove`). `run` is a run id, or an index into the log (main's runs, then the scenarios'). The run goes to `searches`
 * in time order, its id and those of the runs that share its derived id stored, its id out of every scenario's `add`; every scenario
 * record it found becomes main's (lib/search-library.mjs addMainRecords), with the merges into them; and a scenario record it found that
 * was merged into one of main's (across) is a duplicate main removed. So main's PRISMA balances: what the run identified is its records
 * plus its duplicates. The scenarios' decisions stay theirs. Answers { run: its id, records: [ids made main's], merges: how many }.
 */
export function assignRun(st, run, scenarioId = MAIN_PROTOCOL) {
  if (!isMain(scenarioId)) throw new Error('a main run is never moved into a scenario: a scenario leaves it out with searches.remove; only a scenario\'s run is made main\'s');
  const all = allRuns(st), r = typeof run === 'number' ? (Number.isInteger(run) ? all[run] : null) : all.find(x => runId(x, st) === run);
  if (!r) throw new Error(`no search run ${run}`);
  const rid = runId(r, st);
  if (!list(st.scenarioSearches).includes(r)) throw new Error(`search run ${rid} is main's already`);
  pinRunIds(st, r);
  const runs = recordRuns(st), found = p => Boolean(runs.get(p?.id)?.has(rid));
  const back = list(st.scenarioPapers).filter(found), ids = new Set(back.map(p => p.id));
  st.scenarioSearches = list(st.scenarioSearches).filter(x => x !== r);
  // the main records it found are credited to it as a main import credits them (lib/search-import.mjs noteSource; final review I4), and a
  // scenario's record it found is main's now, an addition rather than a duplicate, as a main import of the file makes it
  const matched = list(r.matched), mainHeld = new Map(list(st.papers).map(p => [p?.id, p]));
  for (const mid of matched) { const p = mainHeld.get(mid); if (p) noteSource(p, r.source); }
  const nowAdded = matched.filter(mid => ids.has(mid)).length;
  if (nowAdded && r.duplicates) { r.duplicates -= nowAdded; if (r.duplicates <= 0) delete r.duplicates; }
  delete r.matched;
  delete r.scenario;
  st.searches ||= [];
  ordered(st.searches, r);
  // addMainRecords promotes each, the scenario's merges into them kept as across ones; a merge into one of main's records is main's now
  // when a main run (this one among them) found its dup: a duplicate main removed. One only another scenario's run found stays across
  addMainRecords(st, back);
  const mainRuns = new Set(list(st.searches).map(x => runId(x, st)));
  const dupFound = m => [...(recordRuns({ searches: st.searches, scenarioSearches: st.scenarioSearches, papers: [m.dup] }).get(m.dup.id) || [])].some(x => mainRuns.has(x));
  const across = list(st.scenarioMerged).filter(m => m?.across && !m.repaired && m.dup && dupFound(m));
  if (across.length) {
    st.scenarioMerged = list(st.scenarioMerged).filter(m => !across.includes(m));
    st.merged = [...list(st.merged), ...across.map(({ across: _, ...m }) => m)];
  }
  for (const e of list(st.protocol?.scenarios)) if (e?.searches?.add?.includes(rid)) e.searches.add = e.searches.add.filter(x => x !== rid);
  return { run: rid, records: [...ids], merges: across.length };
}

const logEntry = (st, entry) => { st.screeningLog ||= []; st.screeningLog.push({ ...entry, at: new Date().toISOString() }); };
const extras = ({ via = '', note = '' } = {}) => ({ ...(via ? { via } : {}), ...(String(note || '').trim() ? { note: String(note).trim().slice(0, 2000) } : {}) });

function decideOne(st, sc, j, members, stage, recordId, decision, { reason = '', by = '', via = '', note = '' } = {}) {
  const main = decisionAt(st, stage, recordId), inherited = j.inherited(stage, recordId, main);
  const why = decision === 'exclude' ? String(reason).trim() : '';
  const lane = ((st.scenarioScreening ||= {})[sc.id] ||= {}), byId = (lane[stage] ||= {}), prior = byId[recordId];
  const same = inherited.source === 'main' && inherited.decision?.decision === decision && (decision !== 'exclude' || String(inherited.decision.reason || '').trim() === why);
  if (same) delete byId[recordId];
  else byId[recordId] = { decision, reason: why, by: String(by || ''), at: new Date().toISOString(), against: main?.decision ?? null, ...(String(note || '').trim() ? { note: String(note).trim().slice(0, 2000) } : {}) };
  logEntry(st, { action: prior ? 'change' : 'decide', stage, id: recordId, decision, reason: why, by: String(by || ''), scenario: sc.id, prior: prior?.decision, ...extras({ via, note }) });
  return same ? 'dropped' : 'saved';
}
function checkDecision(sc, members, stage, d) {
  if (!STAGE_IDS.includes(stage)) throw new Error(`stage is ${STAGE_IDS.join(' or ')}`);
  if (!DECISIONS.includes(d.decision)) throw new Error(`decision is ${DECISIONS.join(', ')}`);
  if (d.decision === 'exclude' && !String(d.reason || '').trim()) throw new Error('An exclusion needs a reason');
  if (!members.has(d.id)) throw new Error(`${d.id} is not in scenario ${sc.id}`);
}

/**
 * A decision in a scenario's overlay: { decision, reason, by, at, against: main's decision it was made against, note? }, single-screened.
 * One equal to the main decision the scenario inherits as valid is no entry ('dropped', an entry there taken away); otherwise 'saved'.
 * Logged with `scenario`. Refuses the main protocol, an unknown scenario, an exclusion without a reason and a record not in the scenario.
 */
export function decideScenario(st, scenarioId, stage, recordId, decision, opts = {}) {
  return decideScenarioMany(st, scenarioId, stage, [{ id: recordId, decision, reason: opts.reason }], opts)[0];
}

/** Several decisions of one stage: [{ id, decision, reason?, via?, note? }], each logged; all checked before any is written. */
export function decideScenarioMany(st, scenarioId, stage, decisions, { by = '', via = '', note = '' } = {}) {
  const sc = writable(st, scenarioId), members = memberIds(st, sc.id);
  for (const d of decisions) checkDecision(sc, members, stage, d);
  const j = judge(st, sc);
  return decisions.map(d => decideOne(st, sc, j, members, stage, d.id, d.decision, { reason: d.reason || '', by, via: d.via ?? via, note: d.note ?? note }));
}

/** Takes a scenario's own decision on a record away (logged as an undo); the scenario inherits main's again. 'undone', or 'none'. */
export function undoScenario(st, scenarioId, stage, recordId, { by = '' } = {}) {
  const sc = writable(st, scenarioId);
  if (!STAGE_IDS.includes(stage)) throw new Error(`stage is ${STAGE_IDS.join(' or ')}`);
  const byId = st.scenarioScreening?.[sc.id]?.[stage], prior = byId?.[recordId];
  if (!prior) return 'none';
  delete byId[recordId];
  logEntry(st, { action: 'undo', stage, id: recordId, by: String(by || ''), scenario: sc.id, prior: prior.decision });
  return 'undone';
}

/**
 * Puts a scenario's own entry back as it was before a re-decision (an Undo on the scenario's page, Task 5 Minor 13): the entry verbatim, its
 * `at`, `by` and `against` among them, logged as an undo. Refuses what decideScenario refuses.
 */
export function restoreScenario(st, scenarioId, stage, recordId, entry, { by = '' } = {}) {
  const sc = writable(st, scenarioId);
  if (!STAGE_IDS.includes(stage)) throw new Error(`stage is ${STAGE_IDS.join(' or ')}`);
  if (!entry || !DECISIONS.includes(entry.decision)) throw new Error(`decision is ${DECISIONS.join(', ')}`);
  if (!memberIds(st, sc.id).has(recordId)) throw new Error(`${recordId} is not in scenario ${sc.id}`);
  const byId = (((st.scenarioScreening ||= {})[sc.id] ||= {})[stage] ||= {}), prior = byId[recordId];
  byId[recordId] = copy(entry);
  logEntry(st, { action: 'undo', stage, id: recordId, decision: entry.decision, reason: entry.reason || '', by: String(by || ''), scenario: sc.id, prior: prior?.decision });
  return 'restored';
}

/**
 * Every scenario's entries for records leaving the pool (lib/change-file.mjs remove_records, the Library's trash): taken out of the overlay
 * and answered, { [scenario]: { ta?, ft?: { [id]: entry } } } ({} when none), for a restore to put back.
 */
export function dropScenarioEntries(st, ids) {
  const gone = new Set(ids), out = {};
  for (const [sc, lane] of Object.entries(st.scenarioScreening || {})) for (const stage of STAGE_IDS) {
    const byId = lane?.[stage];
    if (!byId) continue;
    for (const id of Object.keys(byId)) if (gone.has(id)) { ((out[sc] ||= {})[stage] ||= {})[id] = byId[id]; delete byId[id]; }
  }
  return out;
}
/** Puts entries dropScenarioEntries took back, where the overlay has none for the record now. */
export function restoreScenarioEntries(st, kept) {
  for (const [sc, lane] of Object.entries(kept || {})) for (const [stage, byId] of Object.entries(lane || {})) for (const [id, e] of Object.entries(byId || {})) {
    const into = ((st.scenarioScreening ||= {})[sc] ||= {})[stage] ||= {};
    if (!into[id]) into[id] = e;
  }
  return st;
}

export { MAIN_PROTOCOL, scenariosOf };
