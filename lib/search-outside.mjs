// A search run outside Lykos (Scopus, Web of Science, Embase, a register): logged by hand with its database, date, strategy and the
// number of records the database reported, so the search log, the strategy appendix and PRISMA's records identified count it.
// With its export file the records come in through the library's import, and the entry that import writes ("Imported from x.ris")
// takes the person's database, date and strategy instead of a second line.

/** Databases a review commonly searches outside Lykos, offered as suggestions; any other name is accepted. */
export const OUTSIDE_DATABASES = ['Scopus', 'Web of Science', 'Embase', 'CINAHL', 'Cochrane Library', 'PsycINFO', 'Google Scholar', 'ClinicalTrials.gov', 'WHO ICTRP'];

/**
 * The fields of the Log a search form, checked: `{ entry }` or `{ error }`. `day` is YYYY-MM-DD; `found` the number the database
 * reported (blank when it was not noted). The entry is the search log's own shape (lib/search-library.mjs writes the same keys).
 */
export function outsideEntry({ source = '', day = '', query = '', found = '' } = {}) {
  const name = String(source).trim();
  if (!name) return { error: 'Name the database' };
  const d = String(day).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'Give the date it was run' };
  const text = String(query).trim();
  if (!text) return { error: 'Paste the strategy as it was run' };
  const raw = String(found).replace(/[,\s]/g, '');
  if (raw && !/^\d+$/.test(raw)) return { error: 'Records found is a whole number' };
  const n = raw ? Number(raw) : null;
  return { entry: { source: name, kind: 'database', query: text, at: `${d}T12:00:00.000Z`, total: n, retrieved: n, status: 'complete', outside: true } };
}

/**
 * After an import of the search's export file: the entries it added (from index `from` on) become this search, one line. It keeps
 * the import's file and duplicate count. `retrieved`, what PRISMA's records identified sums (lib/prisma-counts.mjs), is the file's
 * own count, the records the review holds; the number the database reported stays as `total`, and as `reported` when they differ.
 * Returns the new log.
 */
export function mergeImported(searches, from, entry) {
  const before = searches.slice(0, from), added = searches.slice(from);
  if (!added.length) return [...before, entry];
  const records = added.reduce((n, x) => n + (Number(x.retrieved) || 0), 0), duplicates = added.reduce((n, x) => n + (Number(x.duplicates) || 0), 0);
  const file = added.find(x => x.file)?.file, raw = added.find(x => x.raw)?.raw;
  return [...before, { ...entry, total: entry.total ?? records, retrieved: records, imported: true,
    ...(entry.total != null && entry.total !== records ? { reported: entry.total } : {}), ...(duplicates ? { duplicates } : {}),
    ...(file ? { file } : {}), ...(raw ? { raw } : {}) }];
}
