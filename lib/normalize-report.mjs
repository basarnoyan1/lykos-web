// What the load-time normalizers set aside (review F7, 8 Nov 2026). normalizeProject (store.mjs) brings an older or foreign shape
// forward and drops what this version cannot hold; until now nothing said what went, and the first save made the loss permanent. Now
// each section a normalizer may change is copied before it runs (`copyGuarded`), and `lostLeaves` lists every value of that copy which the
// normalized section no longer holds at its place, with its path and its old value. The store keeps the project as it was read as a
// recovery copy ("before normalize") when the list is not empty, and the hub says so.

/**
 * The sections normalizeProject's normalizers may change or drop. Not copied: the record-sized sections (papers, values, screening,
 * screeningLog), whose normalizers bring older shapes forward (migrateValue, compactScreening), the scenario records (separateRecords
 * keeps a copy it moves aside in scenarioMerged), and the sent log (moved to the app's own storage). Every other section passes through
 * untouched. normalize-report.test.mjs fails when normalizeProject changes a section that is in neither list.
 */
export const GUARDED = Object.freeze([
  'templates', 'customInstruments', 'swim', 'assessments', 'robReview', 'multiArm', 'doubleExtraction', 'extractionLog', 'extractionSummary',
  'screeningLabels', 'screeningAssignments', 'rankingRuns', 'importWatch', 'prismaNotes',
  'datasets', 'allocationLog', 'allocations', 'dataChangeLog', 'dataSettings', 'dataLocks', 'dataVerification',
  'journalProfile', 'paper', 'declarations', 'reviewRounds', 'reviewRuns', 'submissions',
  'registration', 'ethics', 'sap', 'spiritSchedule', 'checklistChoice',
  'reading', 'journal', 'journalMany', 'milestones', 'noteTemplates', 'projectNotes',
  'qual', 'datasetAnalyses',
]);
/** The sections not copied, and why (above). */
export const NOT_GUARDED = Object.freeze(['papers', 'values', 'screening', 'screeningLog', 'scenarioPapers', 'scenarioMerged', 'notifications', 'sentLog']);

/** At most this many entries are listed; `more` counts the rest (the copy holds them all). */
export const LIST_LIMIT = 200;

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
/** Nothing to lose: absent, null, an empty string, list or object. */
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
const textOf = v => { try { return JSON.stringify(v); } catch { return String(v); } };

/**
 * A report for normalizeProject to fill: `entries` [{ path, old }], `more` (entries past LIST_LIMIT) and `before` (the copies taken).
 * normalizeProject calls `guard(saved)` before its first normalizer and `collect(next)` after its last, so the store loads this module
 * beside the read rather than on the startup graph.
 */
export function createReport() {
  const report = { entries: [], more: 0, before: null, sections: new Set() };
  report.guard = saved => { report.before = copyGuarded(saved); };
  report.collect = next => { for (const [k, old] of report.before || []) lostLeaves(old, next?.[k], k, report); };
  return report;
}

/** Copies of the guarded sections of `saved` that hold anything, taken before a normalizer changes them in place. */
export function copyGuarded(saved) {
  const before = new Map();
  for (const k of GUARDED) if (saved && !isEmpty(saved[k])) before.set(k, structuredClone(saved[k]));
  return before;
}

function add(report, path, old) {
  report.sections?.add(sectionOf(path));   // every section that lost a value, past the list's limit too (the copy restores them all)
  if (report.entries.length < LIST_LIMIT) report.entries.push({ path, old });
  else report.more++;
}

/**
 * Lists in `report` every value of `old` that `now` no longer holds at the same place. A list keeps an element when an equal one is
 * still in it (wherever it now stands), and a record (an object with an id) is compared with the record of that id; an object keeps a
 * key when the key's value is kept; a number, string or boolean is kept when it is the same value. An empty value has nothing to lose.
 */
export function lostLeaves(old, now, path, report) {
  if (isEmpty(old)) return report;
  if (Array.isArray(old)) {
    if (!Array.isArray(now)) { add(report, path, old); return report; }
    const left = new Map();
    for (const x of now) { const t = textOf(x); left.set(t, (left.get(t) || 0) + 1); }
    const byId = new Map(now.filter(x => isObj(x) && x.id != null).map(x => [x.id, x]));
    old.forEach((x, i) => {
      const t = textOf(x), n = left.get(t);
      if (n) { left.set(t, n - 1); return; }
      if (isObj(x) && x.id != null && byId.has(x.id)) lostLeaves(x, byId.get(x.id), `${path}[id=${x.id}]`, report);
      else if (!isEmpty(x)) add(report, `${path}[${i}]`, x);
    });
    return report;
  }
  if (isObj(old)) {
    if (!isObj(now)) { add(report, path, old); return report; }
    for (const [k, v] of Object.entries(old)) lostLeaves(v, now[k], `${path}.${k}`, report);
    return report;
  }
  if (!Object.is(old, now)) add(report, path, old);
  return report;
}

/** The top-level section of an entry's path ('prismaNotes.n1' → 'prismaNotes'). */
export const sectionOf = path => String(path).split(/[.[]/)[0];

/** What the hub says of a report: how many values, in which sections. Null when nothing was set aside. */
export function asideSummary(report) {
  if (!report?.entries?.length) return null;
  const sections = report.sections?.size ? [...report.sections] : [...new Set(report.entries.map(e => sectionOf(e.path)))];
  return { count: report.entries.length + (report.more || 0), sections };
}

/**
 * The recovery copy of a read that set values aside: the project as read (the normalized sections, and those that lost values as they
 * were), what the hub says of it, the first paths, and a signature, so the same values set aside again are not copied twice.
 */
export function asideOf(report, project) {
  const summary = asideSummary(report);
  const copy = { ...project, ...Object.fromEntries([...(report.before || [])].filter(([k]) => summary.sections.includes(k))) };
  return { copy, summary, sig: textOf(report.entries) + report.more, paths: report.entries.slice(0, 20).map(e => e.path) };
}
