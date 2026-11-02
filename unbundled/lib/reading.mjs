// The project's reading list: which papers to read, which are being read,
// which are read, with a priority and a short reason (amendment "Workspace:
// backup, dashboard, tasks, timeline and translation").
//
//   state.reading  { [paperId]: { status: 'to-read'|'reading'|'read', priority: 'none'|'low'|'high', reason, at } }
//
// A paper is on the list when it has an entry; clearing its status takes it
// off. It is set from the Library (a row's Reading menu, the paper's details)
// and listed, filtered, in Notes › Reading list. Pure.

export const READING_STATUSES = [['to-read', 'To read'], ['reading', 'Reading'], ['read', 'Read']];
export const READING_PRIORITIES = [['none', 'No priority'], ['low', 'Low'], ['high', 'High']];
const STATUS = new Set(READING_STATUSES.map(([k]) => k)), PRIORITY = new Set(READING_PRIORITIES.map(([k]) => k));
export const statusLabel = k => READING_STATUSES.find(([id]) => id === k)?.[1] || '';

const clean = e => ({ status: e.status, priority: PRIORITY.has(e.priority) ? e.priority : 'none', reason: String(e.reason || '').slice(0, 280), at: String(e.at || '') });

/** The stored list, with every entry valid; an entry without a known status is dropped. */
export function normaliseReading(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  return Object.fromEntries(Object.entries(r).filter(([id, e]) => id && e && STATUS.has(e.status)).map(([id, e]) => [id, clean(e)]));
}

/** A paper's entry, or null when it is not on the list. */
export const readingOf = (state, paperId) => {
  const e = state?.reading?.[paperId];
  return e && STATUS.has(e.status) ? clean(e) : null;
};

/**
 * Sets part of a paper's entry in place: `{ status, priority, reason }`.
 * A status of '' removes the paper from the list; a priority or reason for a
 * paper not yet on it puts it on as To read.
 */
export function setReading(state, paperId, patch, at = new Date().toISOString()) {
  if (!paperId) return null;
  const was = readingOf(state, paperId);
  if ('status' in patch && !patch.status) {
    if (state.reading) delete state.reading[paperId];
    return null;
  }
  const next = clean({ ...(was || { status: 'to-read' }), ...patch, at });
  if (!STATUS.has(next.status)) return was;
  state.reading = { ...(state.reading || {}), [paperId]: next };
  return next;
}

const RANK = { high: 0, low: 1, none: 2 }, ORDER = { reading: 0, 'to-read': 1, read: 2 };
/**
 * The list as rows `{ paper, entry }` for papers still in the library,
 * filtered by `{ status: 'all'|'open'|<status>, priority: 'any'|<priority>, text }`
 * and ordered: reading, then to read, then read; high priority first; then
 * most recently set.
 */
export function readingRows(state, { status = 'open', priority = 'any', text = '' } = {}) {
  const papers = new Map((state?.papers || []).map(p => [p.id, p]));
  const q = String(text || '').trim().toLowerCase();
  return Object.entries(normaliseReading(state?.reading))
    .filter(([id]) => papers.has(id))
    .map(([id, entry]) => ({ paper: papers.get(id), entry }))
    .filter(({ paper, entry }) => (status === 'all' || (status === 'open' ? entry.status !== 'read' : entry.status === status))
      && (priority === 'any' || entry.priority === priority)
      && (!q || [paper.title, paper.label, entry.reason, ...(paper.authors || []).map(a => typeof a === 'string' ? a : a?.name || '')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => ORDER[a.entry.status] - ORDER[b.entry.status] || RANK[a.entry.priority] - RANK[b.entry.priority] || b.entry.at.localeCompare(a.entry.at));
}

/** How many papers are in each status (papers still in the library only). */
export function readingCounts(state) {
  const out = { 'to-read': 0, reading: 0, read: 0 };
  for (const { entry } of readingRows(state, { status: 'all' })) out[entry.status]++;
  return out;
}
