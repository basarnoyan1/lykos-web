// Living-review mode (plan L1, L2): a project that repeats its searches and
// keeps its synthesis up to date. The state is small and kept with the
// project: whether the mode is on, how often the searches are repeated, whether
// the review is active, paused or retired, and the note saying when it will be
// retired. Everything else is read from what the project already holds: the
// search log for the last search, the scheduled searches and citation searches
// for what is new, the screening decisions for what is ready to screen.
// No service is involved beyond the search sources already in use; the app
// runs searches only while it is open (plan 4.13).
export const CADENCES = [['weekly', 'Every week', 7], ['monthly', 'Every month', 30], ['quarterly', 'Every 3 months', 91], ['biannual', 'Every 6 months', 182]];
export const STATUSES = [['active', 'Active'], ['paused', 'Paused'], ['retired', 'Retired']];
const DAY = 86400e3;

export const livingOf = s => ({ on: false, cadence: 'monthly', status: 'active', retirement: '', ...(s.living || {}) });

/** Sets fields of the living state inside a store update; every field is checked and bounded. */
export function setLiving(state, patch) {
  const cur = livingOf(state);
  if ('on' in patch) cur.on = Boolean(patch.on);
  if (CADENCES.some(([k]) => k === patch.cadence)) cur.cadence = patch.cadence;
  if (STATUSES.some(([k]) => k === patch.status)) cur.status = patch.status;
  if ('retirement' in patch) cur.retirement = String(patch.retirement ?? '').slice(0, 4000);
  state.living = cur;
  return cur;
}

/** The date of the latest search run: the newest non-failed, non-exploratory entry of the log, or the date typed in Reporting. */
export function lastSearch(s) {
  let latest = 0;
  for (const r of s.searches || []) {
    if (r.status === 'failed' || r.exploratory) continue;
    const t = Date.parse(r.at); if (t > latest) latest = t;
  }
  const typed = Date.parse(s.searchStrategy?.lastSearched);
  if (typed > latest) latest = typed;
  return latest || null;
}

/** When the next update is due, whether it is overdue, and how many days remain (negative when overdue). */
export function schedule(s, now = Date.now()) {
  const l = livingOf(s), last = lastSearch(s);
  const days = CADENCES.find(([k]) => k === l.cadence)?.[2] || 30;
  if (!last) return { last: null, due: null, overdue: false, daysLeft: null, days };
  const due = last + days * DAY;
  return { last, due, overdue: now > due && l.status === 'active', daysLeft: Math.ceil((due - now) / DAY), days };
}

/**
 * Records found by a search since they were last marked seen: those from
 * scheduled searches, citation searches and related-article runs (`isNew`).
 * `ready` are those still to be decided at title and abstract.
 */
export function newRecords(s) {
  const fresh = (s.papers || []).filter(p => p.isNew).sort((a, b) => String(b.foundAt || '').localeCompare(String(a.foundAt || '')));
  const decided = p => Boolean(s.screening?.[p.id] && !s.screening[p.id].needsCriteriaReview);
  const by = p => p.foundBy === 'citation' ? 'Citation search' : p.foundBy === 'related' ? 'Related articles' : p.foundBy ? 'Scheduled search' : 'Search';
  const sources = {};
  for (const p of fresh) sources[by(p)] = (sources[by(p)] || 0) + 1;
  return { all: fresh, ready: fresh.filter(p => !decided(p)), sources, by };
}

/** Clears the "new" mark on the records looked at (all of them, or the ids given), inside a store update. */
export function markSeen(state, ids = null) {
  let n = 0;
  for (const p of state.papers || []) if (p.isNew && (!ids || ids.includes(p.id))) { delete p.isNew; n++; }
  return n;
}

/** How many times searches have been repeated: runs after the first date the log holds, from scheduled searches and citation searches. */
export function updates(s) {
  return (s.searches || []).filter(r => (r.scheduled || r.citationSearch) && r.status !== 'failed')
    .map(r => ({ at: r.at, source: r.source, kind: r.citationSearch ? 'citation' : 'scheduled', retrieved: r.retrieved, fresh: r.new ?? null })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** PRISMA-LSR reporting topics for a living review, in Lykos's own words (Akl et al. 2024, BMJ, doi:10.1136/bmj-2024-079183). */
export const LSR_CITATION = 'Akl EA, Khabsa J, Iannizzi C, et al. Extension of the PRISMA 2020 statement for living systematic reviews (PRISMA-LSR): checklist and explanation. BMJ 2024;387:e079183.';
export const LSR_ITEMS = [
  ['LSR1', 'Living review status', 'Identify the report as a living systematic review and state its current status: updated continuously, paused or retired'],
  ['LSR2', 'Rationale for a living approach', 'Say why the question suits a living review, for example priority, uncertainty in the evidence and new studies expected'],
  ['LSR3', 'Search update frequency', 'State how often the searches are repeated and give the date of each search'],
  ['LSR4', 'Screening and adding new studies', 'Describe how newly found records are screened and how eligible studies are added, and by whom'],
  ['LSR5', 'Triggers to update the synthesis', 'State what triggers a new analysis or a new published version'],
  ['LSR6', 'Flow of each update', 'Report the records found and the studies added at each update, and what changed since the last version'],
  ['LSR7', 'Retirement', 'State the conditions under which the review will stop being updated, and what will be reported then'],
];
/** Which items the project itself vouches for. */
export function lsrSupported(s) {
  const out = {}, l = livingOf(s);
  if (!l.on) return out;
  out.LSR1 = 'Living review status';
  if (lastSearch(s)) out.LSR3 = 'Cadence and search log';
  if (updates(s).length) out.LSR6 = 'Search log of updates';
  if (l.retirement.trim()) out.LSR7 = 'Retirement note';
  return out;
}
