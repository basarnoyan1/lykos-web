// The cross-project list: what every project on this machine has coming up
// (lib/project-summary.mjs), for the start screen's Upcoming and All projects.
//
// A project in the app's storage (and the local project) is read where it is
// kept, without opening it. A folder project is known by the summary kept on
// this machine each time it was saved while open, and says how old that is.
// Nothing here goes to the network.
import * as projects from './projects.mjs';
import { get, onSaveState } from '../store.mjs';
import { summarizeProject, isSummary, asCurrent } from './project-summary.mjs';
import { stages, unresolved, recentActivity } from './progress.mjs';
import * as submissions from './submissions.mjs';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const safe = (fn, fallback) => { try { return fn() ?? fallback; } catch { return fallback; } };
/**
 * The summary with where the work stands (summary version 2): each stage and its count, the blockers (at most three), the last few things
 * done and the submission. Computed when a project is saved and when All projects reads a project file, never on paint. A project file
 * read from disk is not normalised, so each part that cannot read it is left empty rather than failing the summary.
 */
export function fullSummary(state, { today = localDay() } = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const subs = safe(() => submissions.normaliseSubmissions(s.submissions), []);
  const blocks = [...safe(() => unresolved(s), []), ...safe(() => submissions.attentionItems(subs, today), [])].filter(x => x?.severity === 'block');
  const seen = new Set(), attention = blocks.filter(x => !seen.has(x.text) && seen.add(x.text));
  return summarizeProject(s, { today, extras: {
    stages: safe(() => stages(s), []), attention, recent: safe(() => recentActivity(s, 5), []),
    submission: safe(() => submissions.submissionSummary?.(subs, today), null) } });
}

const KEY = id => `lykos.summary.${id}`;
/** Keeps a summary of `state` (or the summary itself, already computed: `{ summary }`) for this machine. */
export function rememberSummary(id, state, { summary = null } = {}) {
  if (!id || id === projects.NONE) return;
  try { localStorage.setItem(KEY(id), JSON.stringify({ at: Date.now(), summary: summary || fullSummary(state) })); } catch {}
}
/** The kept summary of a project, `{ at, summary }` in the shape of this version (a version 1 one reads with no stages), or null. */
export function cachedSummary(id) {
  try { const x = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); return x && isSummary(x.summary) ? { ...x, summary: asCurrent(x.summary) } : null; } catch { return null; }
}

let watching = false;
/** Keeps the open project's summary on each completed save. */
export function keepSummaries() {
  if (watching) return;
  watching = true;
  onSaveState(st => { if (st === 'saved' && !projects.isNone()) rememberSummary(projects.currentId(), get()); });
}

export const nameOf = p => p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project');
const whereOf = p => p.kind === 'path' ? (p.path.replace(/\/+$/, '').split('/').slice(-2, -1)[0] || p.path) : p.kind === 'handle' ? 'Folder' : 'App storage';

/**
 * Every listed project with its summary: `{ id, name, where, kind, summary,
 * stale, at }`. `stale` means the summary is the one kept when the project was
 * last open (`at`), not read now.
 */
export async function projectSummaries({ openState = null } = {}) {
  const out = [];
  const openId = projects.isNone() ? null : projects.currentId();
  for (const p of projects.switchList()) {
    let summary = null, stale = false, at = 0;
    try {
      if (p.id === openId && openState) summary = summarizeProject(openState);
      else if (p.kind === 'app') { const d = await projects.readAppProject(p.id); if (d) { summary = summarizeProject(d); at = d.savedAt || 0; } }
      // project-backup.mjs loads with the first read of the local project; a failed import falls to the kept summary below
      else if (p.kind === 'local') { const d = await (await import('./project-backup.mjs')).readLocalProject(); if (d) { summary = summarizeProject(d); at = d.savedAt || 0; } }
    } catch {}
    if (!summary) { const c = cachedSummary(p.id); if (c) { summary = c.summary; stale = true; at = c.at; } }
    out.push({ id: p.id, name: p.id === openId && openState ? (openState.project?.name || nameOf(p)) : nameOf(p), where: whereOf(p), kind: p.kind, summary, stale, at });
  }
  return out;
}
