// The bibliographic databases and registers a review names, defined once. Every list that names a database (the search log's
// suggestions, the record filters, the folder and supplement readers, PRISMA's flow and the search summary, the query translator's
// targets, the signed-in site searches) reads its name here, and a name stored by an older version or written by a database's own
// export ("Cochrane Library", "CENTRAL", "wos") folds to the same entry, so one database counts once wherever it is counted.
//
// Fields: id; name, as the review reports it; platform, the interface it is searched through when that is not the database's own;
// aliases, other names it is stored or exported under (compared folded: case, accents and spacing do not matter); pattern, for
// finding it inside a longer text (a file name, a table cell), checked in this order; kind, PRISMA's database or register; target,
// the query translator's (lib/query-translate.mjs); access: 'api' (lib/sources.mjs runs it), 'site' (searched in the person's own
// session, lib/site-search.mjs) or absent (searched outside Lykos and logged by hand, lib/search-outside.mjs).
export const DATABASES = [
  { id: 'pubmed', name: 'PubMed', aliases: ['pubmed/medline', 'pubmed / medline'], pattern: /pubmed|medline/i, kind: 'database', access: 'api' },
  { id: 'wos', name: 'Web of Science', fullName: 'Web of Science Core Collection', platform: 'Clarivate', aliases: ['web of science core collection', 'wos core collection', 'webofscience'], pattern: /web.?of.?science|\bwos\b/i,
    kind: 'database', target: 'wos', access: 'site' },
  { id: 'scopus', name: 'Scopus', pattern: /scopus/i, kind: 'database', target: 'scopus', access: 'site' },
  { id: 'embase', name: 'Embase', aliases: ['embase (ovid)'], pattern: /embase/i, kind: 'database', target: 'ovid-embase' },
  { id: 'cochrane', name: 'Cochrane CENTRAL', platform: 'Cochrane Library',
    aliases: ['cochrane library', 'central', 'cochrane', 'cochrane central register of controlled trials', 'cochrane library (central)', 'cochrane library central',
      'cochrane central (cochrane library)', 'cochrane controlled register of trials'],
    pattern: /cochrane|central/i, kind: 'database', target: 'cochrane', access: 'site' },
  { id: 'cinahl', name: 'CINAHL', aliases: ['cinahl (ebscohost)', 'cinahl plus'], pattern: /cinahl/i, kind: 'database', target: 'cinahl' },
  { id: 'psycinfo', name: 'PsycINFO', aliases: ['apa psycinfo'], pattern: /psycinfo/i, kind: 'database' },
  { id: 'medline', name: 'MEDLINE', aliases: ['medline (ovid)', 'ovid medline'], kind: 'database', target: 'ovid-medline' },
  { id: 'epmc', name: 'Europe PMC', kind: 'database', access: 'api' },
  { id: 'crossref', name: 'Crossref', kind: 'database', access: 'api' },
  { id: 'openalex', name: 'OpenAlex', kind: 'database', access: 'api' },
  { id: 'scholar', name: 'Google Scholar', kind: 'database' },
  { id: 'ctgov', name: 'ClinicalTrials.gov', aliases: ['clinicaltrials', 'clinical trials.gov'], kind: 'register', access: 'api' },
  { id: 'ictrp', name: 'WHO ICTRP', aliases: ['ictrp', 'who international clinical trials registry platform'], kind: 'register' },
];

/** A name as compared: lower case, no accents, single spaces. */
export const foldName = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const BY_KEY = new Map();
for (const d of DATABASES) for (const k of [d.id, d.name, ...(d.aliases || [])]) BY_KEY.set(foldName(k), d);

// The same names written without spaces or punctuation ("WebOfScience", "EuropePMC", "ClinicalTrials.gov"), as export files are named.
const compact = v => foldName(v).replace(/[^a-z0-9]+/g, '');
const BY_COMPACT = new Map();
for (const d of DATABASES) for (const k of [d.id, d.name, d.fullName, ...(d.aliases || [])].filter(Boolean)) if (compact(k).length > 2) BY_COMPACT.set(compact(k), d);
/**
 * A run's or a file's name with what tells one run from another taken off: the extension, a version ("v3"), a date, a part or
 * batch number and a note in brackets. "WebOfScience_v3_2026-10-31.ris" → "WebOfScience", "Europe PMC v3 (non-MEDLINE)" → "Europe PMC".
 * 31 Oct 2026: a re-run imported from its file was logged under the file's name and counted as a database of its own.
 */
export function nameStem(v) {
  let t = String(v ?? '').trim().replace(/\.(ris|nbib|txt|csv|tsv|json|xml|ciw|enw|bib|medline)$/i, '');
  const tail = /(?:[\s_-]*\([^()]*\)|[\s_-]+(?:v\d+(?:\.\d+)?|\d{4}-\d{2}-\d{2}|\d{8}|part\s*\d+|records?[\s_-]*\d+(?:-\d+)?|batch\s*\d+|\d+-\d+|export|results|search|update|rerun|re-run))$/i;
  for (let i = 0; i < 8 && tail.test(t); i++) t = t.replace(tail, '');
  return t.trim();
}
/**
 * The database a stored name, id or alias stands for, or null. An exact name first; then the same name written without spaces, and
 * the name of a run or file with its version, date and part taken off (nameStem). Never a search inside a longer text (databaseIn).
 */
export const database = v => {
  if (v == null || v === '') return null;
  const exact = BY_KEY.get(foldName(v)) || BY_COMPACT.get(compact(v));
  if (exact) return exact;
  const stem = nameStem(v);
  return stem && stem !== String(v).trim() ? BY_KEY.get(foldName(stem)) || BY_COMPACT.get(compact(stem)) || null : null;
};
/** The version a run's name, label or file gives ("v3"), or ''. */
export const versionIn = (...texts) => { for (const t of texts) { const m = /(?:^|[\s_(-])(v\d+(?:\.\d+)?)(?=$|[\s_).-])/i.exec(String(t ?? '')); if (m) return m[1].toLowerCase(); } return ''; };
/** The database named inside a longer text (a file name, a table cell), by the first pattern that matches, or null. */
export const databaseIn = text => { const t = String(text ?? ''); return DATABASES.find(d => d.pattern?.test(t)) || null; };
/** The name a review reports for a stored name: the database's own when it is known, else the name as given. */
export const databaseName = v => database(v)?.name || String(v ?? '').trim();
