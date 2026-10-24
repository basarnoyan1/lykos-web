// What changed in a project's record between two states, in the reader's nouns: "Screening decisions, 12 changed", "Extraction values,
// 3 added". History's preview lists these as the project data a change brought in from the folder touched (views/history-tool.mjs): the folder's
// history leaves the record out (.lykos/ is ignored), and its JSON says nothing a person can read. Pure: two records (or parts of one) in, rows out.

// The record's parts a person works on, named as the app names them; the rest (timings, the model's call log, caches) is bookkeeping.
const LABELS = {
  project: 'Project', papers: 'Library records', screening: 'Screening decisions', screeningLog: 'Screening history', values: 'Extraction values',
  proposals: 'Proposed values', assessments: 'Risk of bias', prisma: 'PRISMA counts', protocol: 'Protocol', notes: 'Notes', collections: 'Collections',
  searches: 'Searches', manuscript: 'Manuscript', analysis: 'Analysis', datasets: 'Datasets', templates: 'Extraction tables', todos: 'Tasks',
  declarations: 'Declarations', registration: 'Registration', fulltext: 'Full texts', threads: 'Chats', customInstruments: 'Appraisal instruments',
  paper: 'Paper', extractionSummary: 'Extraction summary', searchStrategy: 'Search strategy', settings: 'Settings', notifications: 'Notifications',
};
const SKIP = new Set(['savedAt', 'format', 'aiCalls', 'aiCallTotals', 'aiModelTotals', 'aiUsageStartedAt', 'jobs', 'jevRuns', 'runs', 'folderInit', 'folderMap', 'paperAliases']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyed = v => (Array.isArray(v) && v.every(x => x && typeof x === 'object' && 'id' in x) ? new Map(v.map(x => [x.id, x]))
  : v && typeof v === 'object' && !Array.isArray(v) ? new Map(Object.entries(v)) : null);

/** Rows of what differs: [{ key, label, added, removed, changed }], in the record's order; a part that is not a collection counts as one change. */
export function projectDiff(before, after) {
  const a = before || {}, b = after || {}, out = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
    if (SKIP.has(key) || same(a[key], b[key])) continue;
    const x = keyed(a[key] ?? (Array.isArray(b[key]) ? [] : {})), y = keyed(b[key] ?? (Array.isArray(a[key]) ? [] : {}));
    let added = 0, removed = 0, changed = 0;
    if (x && y && (Array.isArray(a[key] ?? b[key]) ? Array.isArray(b[key] ?? a[key]) : true)) {
      for (const [k, v] of y) if (!x.has(k)) added++; else if (!same(x.get(k), v)) changed++;
      for (const k of x.keys()) if (!y.has(k)) removed++;
    } else changed = 1;
    if (added || removed || changed) out.push({ key, label: LABELS[key] || key.replace(/[A-Z]/g, m => ` ${m.toLowerCase()}`).replace(/^./, c => c.toUpperCase()), added, removed, changed });
  }
  return out;
}
