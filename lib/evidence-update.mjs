// A newer version of the evidence table brought into the project (the folder's v19 when the project holds v12): the same import as a project made
// from its folder (lib/folder-init.mjs evidenceImport: arms, the with-sources quotations, the column definitions, the table groups as collections),
// with two differences that matter once a table has been renumbered or a study excluded:
//
//   studies are matched to included records by the DOI the with-sources table gives, else by the study cell's "Surname year" against the record's
//   own label, never by the table's row number (a renumbered table would put one study's values on another);
//   only what the earlier file supplied is replaced (values imported from it); a value a person or the app added keeps its place, and a column the
//   table does not have (a derived field) stays in the table.
//
// Pure: the caller reads the files and writes the state.
import { evidenceImport, evidenceStudies, collectionsFromGroups } from './folder-init.mjs';
import { parseVersion } from './folder-map.mjs';
import { studyKey, paperKey } from './template-import.mjs';
import { isIncluded } from './screen.mjs';
import { DEFAULTS } from './vcs.mjs';
import { replaceValues, removeValues } from './value-import.mjs';

const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const dirOf = p => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');
const archived = p => DEFAULTS.hashOnly.some(d => p.startsWith(d) || p.includes(`/${d}`));
const cleanDoi = d => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[.,;)\]]+$/, '');

/** The newest later version of a template's source file among `paths`: `{ path, version, current, sources }` or null. The original's folder is preferred. */
export function newerVersion(template, paths) {
  const src = template?.source?.file;
  if (!src) return null;
  const was = parseVersion(baseOf(src)), wasDir = dirOf(src);
  const hits = paths.filter(p => /\.xlsx$/i.test(p) && !archived(p) && !/with[ _-]?sources/i.test(p)).map(p => ({ path: p, ...parseVersion(baseOf(p)) }))
    .filter(x => x.stem === was.stem && Number(x.version) > Number(was.version || 0))
    .sort((a, b) => b.version - a.version || (dirOf(b.path) === wasDir) - (dirOf(a.path) === wasDir));
  if (!hits.length) return null;
  const top = hits[0];
  return { path: top.path, version: top.version, current: was.version || 0, sources: twinOf(top.path, paths) };
}

/** The with-sources twin of a table workbook among `paths` (`Table_v19_with_sources.xlsx` beside `Table_v19.xlsx`), or ''. */
export function twinOf(path, paths) {
  const { stem, version } = parseVersion(baseOf(path));
  return paths.find(p => dirOf(p) === dirOf(path) && /with[ _-]?sources/i.test(p) && (({ stem: s, version: v }) => s === stem && String(v) === String(version))(parseVersion(baseOf(p).replace(/[ _-]?with[ _-]?sources/i, '')))) || '';
}

/**
 * The update: `{ template, values, collections, report, matched: Map(no → paperId) }` from the newer workbook (and its with-sources twin and table
 * groups when given). `report.unmatched` lists the table's study numbers no included record matched.
 */
export function evidenceUpdate(s, { path, workbook, sources = null, sourcesPath = '', groups = null, groupsPath = '', at = new Date().toISOString(), file = {} }) {
  const table = workbook.sheets.find(x => evidenceStudies(x.rows).studies.length) || workbook.sheets[0];
  const ev = evidenceStudies(table.rows), studyAt = ev.header.findIndex(h => /^study$/i.test(String(h).trim()));
  const included = (s.papers || []).filter(p => isIncluded(s, p.id));
  const byDoi = new Map(included.filter(p => p.doi).map(p => [cleanDoi(p.doi), p.id]));
  const byKey = new Map(); for (const p of included) { const k = paperKey(p); if (k) byKey.set(k, byKey.has(k) ? null : p.id); }   // a name two records share matches neither
  const rowOf = new Map(ev.studies.map(st => [String(Number(st.id)), st]));
  const matched = new Map();
  const paperOf = (no, src) => {
    const key = String(Number(no));
    if (matched.has(key)) return matched.get(key);
    let id = src?.doi ? byDoi.get(cleanDoi(src.doi)) || null : null;
    if (!id && studyAt >= 0) { const st = rowOf.get(key); id = st ? byKey.get(studyKey(table.rows[st.rows[0]]?.[studyAt])) || null : null; }
    matched.set(key, id);
    return id;
  };
  const out = evidenceImport({ path, workbook: { sheets: [table, ...workbook.sheets.filter(x => x !== table)] }, sheet: table.name, sourcesPath, sources, paperOf, groups, groupsPath,
    version: parseVersion(baseOf(path)).version, at, existingValues: {}, file });
  return { ...out, collections: collectionsFromGroups(groups, no => paperOf(no)), matched };
}

const columnOfKey = k => k.slice(k.indexOf(':') + 1).replace(/@arm\d+$/, '');
const paperOfKey = k => k.slice(0, k.indexOf(':'));
/** A value some file supplied (this table's import, an earlier import of its known columns), not one a person or the app wrote. */
const fromAFile = v => /^import:/.test(String(v?.extractor || ''));

/**
 * The studies the table has no row for: the value keys a file supplied in the columns of templates `tids` (arm cells included) for a paper not in
 * `rows`, and those papers. `rows` is null when a row of the table matched no record: then which study a row stands for is unknown and nothing is
 * counted as gone. A locked value stays.
 */
export function goneStudies(values, tids, rows) {
  const keys = [], papers = new Set();
  if (!rows) return { keys, papers };
  const inTables = k => { const c = columnOfKey(k); return tids.some(t => c.startsWith(`${t}.`)); };
  for (const [k, v] of Object.entries(values || {})) {
    if (!inTables(k) || rows.has(paperOfKey(k)) || !fromAFile(v) || v?.locked) continue;
    keys.push(k); papers.add(paperOfKey(k));
  }
  return { keys, papers };
}

/** The records a table's rows stand for (`matched` of evidenceUpdate), or null when a row matched none. */
export const rowStudies = upd => (upd.report?.unmatched?.length ? null : new Set([...upd.matched.values()].filter(Boolean)));

/** Removes the values of the studies a table no longer has (goneStudies), and their arm lists on the template. Answers `{ values, studies }`. */
export function dropGoneStudies(st, templateId, rows) {
  const gone = goneStudies(st.values, [templateId], rows);
  if (!gone.keys.length) return { values: 0, studies: 0 };
  removeValues(st, gone.keys);
  st.templates = (st.templates || []).map(t => (t.id === templateId && t.arms && [...gone.papers].some(p => t.arms[p])
    ? { ...t, arms: Object.fromEntries(Object.entries(t.arms).filter(([p]) => !gone.papers.has(p))) } : t));
  return { values: gone.keys.length, studies: gone.papers.size };
}

/**
 * Writes the update over the table it replaces (`replaces`, a template id): the earlier file's imported values go, the new ones come in, the
 * template's rules and any column the new table lacks are kept, and the table groups' collections replace those of the same name. A study the
 * newer table has no row for (excluded since, or merged) loses every value a file gave it in the table, arm cells included, so it is not left as a
 * row of old values. Answers `{ removed, added, keptColumns, goneStudies }` (goneStudies: how many studies' values went for that reason).
 */
export function applyEvidenceUpdate(st, upd, { replaces }) {
  const prior = (st.templates || []).find(t => t.id === replaces), tids = new Set([replaces, upd.template.id]);
  const inTables = k => [...tids].some(t => columnOfKey(k).startsWith(`${t}.`));
  const fromFile = v => v?.origin === 'imported' && /^import:/.test(String(v?.extractor || ''));
  const gone = goneStudies(st.values, [...tids], rowStudies(upd)), drop = new Set(gone.keys);
  let removed = 0;
  const values = {};
  for (const [k, v] of Object.entries(st.values || {})) { if (drop.has(k) || (inTables(k) && fromFile(v) && !v.locked)) { removed++; continue; } values[k] = v; }
  const has = new Set(upd.template.columns.flatMap(c => [c.id, c.label]));
  const kept = (prior?.columns || []).filter(c => !has.has(c.id) && !has.has(c.label) && Object.keys(values).some(k => columnOfKey(k) === c.id));
  const template = { ...upd.template, columns: [...upd.template.columns, ...kept], ...(prior?.rules ? { rules: prior.rules } : {}) };
  replaceValues(st, values, upd.values);
  st.templates = [...(st.templates || []).filter(t => !tids.has(t.id)), template];
  // the table groups' collections are the groups file's, as a whole: one the new file no longer has (v12's Table 5) goes with the others
  if (upd.collections?.length) st.collections = [...(st.collections || []).filter(c => !String(c.id).startsWith('c-table-') && !upd.collections.some(t => t.name === c.name && !c.parent)), ...upd.collections];
  return { removed, added: Object.keys(upd.values).length, keptColumns: kept.map(c => c.label), goneStudies: gone.papers.size };
}
