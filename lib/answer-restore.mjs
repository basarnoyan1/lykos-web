// A restore point for an assistant answer (plan §6, "Restore point before an answer's changes"; docs/Assistant_Gaps_Review_2026-11.md, G1).
// When the first item of an answer is accepted, the project is recorded in History as a step named "Before: <answer title>", once per answer
// (the answer's other entries and its later accepts reuse it): the project's data sections and the changed files, as any commit does, so a
// content already stored costs nothing. The answer's review line then offers Restore. Restore first says, by the project's own nouns, what
// moves back and what the person changed since, and only then puts the answer's sections back.
//
//   checkpoint({ entry, title, siblings }, d)   the step before the first accept; { id, at, title } or null (no history, nothing saved)
//   accepted(entry, from, d)                    after an accept begun at mark `from`: what the answer has touched so far, and where it ended
//   plan(point, d)                              what restoring would do: rows by section, each 'back', 'both' or 'kept'; files changed since
//   restore(point, plan, { entryIds }, d)       puts the answer's sections back and reopens its items; the present is recorded first
//
// A section the answer wrote and nothing touched since moves back ('back'); one both the answer and the person wrote moves back too, said
// first ('both': the person's entry is in the step recorded just before the restore); one only the person touched stays ('kept'). The
// sections are told by the store's own marks (store.mjs sectionsTouchedAfter), so after a restart (no marks) every section that differs
// moves back and none is called the person's. Files are never restored here: a file is the folder's own (History records it by hash, plan §4.15h).
//
// `d` (the deps) is { repo, settle(), tickNow(), touchedAfter(t), reload(), reopen(entryIds), state() }: lib/vcs.mjs's repo for the folder, the
// store's save and marks, the ledger's reopen. The default is read from the open project (`live`); a test passes its own with `useDeps`.
import { projectDiff } from './project-diff.mjs';
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { AUTO_BY, BEFORE_BY, isBeforeAnswer } from './vcs-log.mjs';

export { BEFORE_BY, isBeforeAnswer };
// The history's names for the project's data, as lib/vcs.mjs has them (test/answer-restore.test.mjs holds them equal). Not imported: lib/aid.mjs
// reaches this module statically, and vcs.mjs with project-format.mjs is 130 kB the model actions' views do not need on first open (aid-graph.test.mjs).
export const PROJECT = '.lykos/project.json';
export const isSection = p => p.startsWith(`${PROJECT}#`);
const PREFIX = 'Before: ';
const dec = new TextDecoder();
const clip = (t, n = 80) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const stepMessage = title => `${PREFIX}${clip(title || 'an answer')}`;

let override = null;
/** A test's (or another shell's) deps in place of the open project's: a function returning them, or null for the default. */
export const useDeps = fn => { override = fn; };
async function live() {
  const folder = activeFolder();
  if (!folder) return null;
  const [watch, store, aid] = await Promise.all([import('./vcs-watch.mjs'), import('../store.mjs'), import('./aid.mjs')]);
  return { repo: watch.repoOf(folder), settle: () => store.persist(), tickNow: store.tickNow, touchedAfter: store.sectionsTouchedAfter, reload: () => store.reloadFromDisk(),
    reopen: ids => aid.reopen(ids), state: store.get };
}
/** Whether there is anywhere to record a step now (a folder, or a test's deps): without, an accept does not wait for one. */
export const available = () => !!(override || activeFolder());
const depsOf = async () => (override ? override() : live());
/** The deps of the open project (null when there is no folder): taken once for a plan and its restore, so a project switched between them is not restored into. */
export const deps = depsOf;

/** The marks of each point of this session: { t0: where the answer began, t1: where its last accept ended, touched: sections it touched }. */
const marks = new Map();
const waiting = new Map();   // entry id -> the checkpoint being made, so two accepts at once make one step

/** The ids of every entry the answer that filed `entryId` filed (its message lists them), the entry's own when it is not an answer's. */
export function answerIds(state, entryId) {
  for (const t of state?.threads || []) for (const m of t.messages || []) if (Array.isArray(m.proposals) && m.proposals.includes(entryId)) return m.proposals;
  return [entryId];
}

/**
 * Records the project before the first accept of an answer. `siblings` are the answer's other entries (they may already hold the step).
 * Returns the point, or null when there is no history to record in, the project could not be saved, or the commit failed: the accept
 * goes on without one, and the answer simply offers no Restore.
 */
export function checkpoint({ entry, title, siblings = [] }, d) {
  const held = entry.before || siblings.find(e => e.before)?.before;
  if (held?.id) { entry.before = held; return Promise.resolve(held); }
  if (waiting.has(entry.id)) return waiting.get(entry.id);
  const run = (async () => {
    try {
      d ||= await depsOf();
      if (!d || !await d.repo.head()) return null;
      if (!await d.settle()) return null;
      const t0 = d.tickNow();
      let made = null;
      for (let tries = 0; tries < 2 && !made; tries++) {
        try { made = await d.repo.commit({ message: stepMessage(title), by: BEFORE_BY }); break; } catch (err) { if (tries) throw err; }
      }
      // nothing changed since the newest commit: that commit is already this state, and the point
      const id = made?.id || await d.repo.head();
      if (!id) return null;
      const point = { id, at: new Date().toISOString(), title: clip(title, 80) };
      marks.set(id, { t0, t1: t0, touched: [] });
      entry.before = point;
      return point;
    } catch { return null; } finally { waiting.delete(entry.id); }
  })();
  waiting.set(entry.id, run);
  return run;
}

/** After an accept of an item of the answer, begun at mark `from`: the sections that accept touched, added to the answer's, and where it ended.
 *  What the person did between two accepts is not counted: only the accept's own writes are the answer's. */
export async function accepted(entry, from, d) {
  const point = entry.before, m = point && marks.get(point.id);
  if (!m) return;
  d ||= await depsOf();
  if (!d) return;
  const now = d.touchedAfter(from);
  m.t1 = d.tickNow();
  m.touched = now == null || m.touched == null ? null : [...new Set([...m.touched, ...now])];
}

/** The earliest point among entries (an answer may have filed several), or null. */
export const pointOf = entries => entries.map(e => e.before).filter(p => p?.id).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0] || null;

// Never put back: the ledger (reopened item by item: a later answer's entries are in it) and the AI-use record of what was accepted and
// logged (state.aiOutcomes, state.aiChanges), which stays a record of what happened, restore included.
const IGNORE = new Set(['aiProposalLedger', 'aiOutcomes', 'aiChanges']);
const sectionJson = async (repo, ref, key) => { const b = await repo.read(ref, `${PROJECT}#${key}`); return b ? JSON.parse(dec.decode(b)) : undefined; };

/**
 * What restoring `point` would do, by section, in the project's nouns (lib/project-diff.mjs): [{ key, label, added, removed, changed, kind }]
 * and the number of files that differ from the step (not restored here). The present is recorded first (as the recorder would), so the
 * person's own entries are in History whatever follows.
 */
export async function plan(point, d) {
  d ||= await depsOf();
  await d.settle();
  const saved = await d.repo.commit({ message: 'Project data', by: AUTO_BY }).catch(() => null);
  const now = saved?.id || await d.repo.head();
  const diff = await d.repo.diff(point.id, now);
  const all = [...diff.added, ...diff.modified, ...diff.deleted];
  const keys = all.filter(isSection).map(p => p.slice(PROJECT.length + 1)).filter(k => !IGNORE.has(k));
  const before = {}, after = {};
  for (const k of keys) { before[k] = await sectionJson(d.repo, point.id, k); after[k] = await sectionJson(d.repo, now, k); }
  const m = marks.get(point.id), since = m ? d.touchedAfter(m.t1) : null;
  const rows = projectDiff(before, after).map(r => {
    const mine = !m || m.touched == null || m.touched.includes(r.key), later = since != null && since.includes(r.key);
    return { ...r, kind: !mine ? 'kept' : later ? 'both' : 'back' };
  });
  return { rows, files: all.filter(p => !isSection(p)).length, at: now };
}

/** The words that say what restoring does: one line per kind, by section ("Extraction values, 40 changed"). */
const part = r => [r.changed && `${r.changed} changed`, r.added && `${r.added} added`, r.removed && `${r.removed} removed`].filter(Boolean).join(', ');
export function describePlan(p) {
  const line = k => p.rows.filter(r => r.kind === k).map(r => `${r.label}, ${part(r)}`);
  const back = line('back'), both = line('both'), kept = line('kept');
  return { back, both, kept, files: p.files, empty: !back.length && !both.length };
}

/**
 * Puts the answer's sections back, reopens its items, and has the store read the project again. Throws when the step's data is not stored.
 * Returns { restored: [section labels], skipped: [...], saved }.
 */
export async function restore(point, p, { entryIds = [] } = {}, d) {
  d ||= await depsOf();
  const rows = p.rows.filter(r => r.kind !== 'kept');
  const paths = rows.map(r => `${PROJECT}#${r.key}`);
  let r = { restored: [], skipped: [], saved: null };
  if (paths.length) {
    r = await d.repo.restore(point.id, { paths, by: 'You' });
    if (!r.restored.length) throw new Error(r.skipped[0]?.why ? `Not restored: ${r.skipped[0].why}.` : 'Nothing was restored.');
    await d.reload();
  }
  marks.delete(point.id);
  d.reopen?.(entryIds);
  return { ...r, restored: rows.map(x => x.label) };
}
