// The records behind each box of the PRISMA 2020 flow diagram (plan K1).
//
// Every number in the diagram is derived from live data (lib/prisma-counts.mjs)
// unless it was entered by hand. This reads the same project state with the
// same predicates and returns the records that make each derived number, so a
// reader can click a box and see them. A number entered by hand has no records
// behind it, and says so. Nothing here is stored: the sets are recomputed from
// the project every time, and tests hold each set's size against the count.
//
// Pure over the project state.
import { derive } from './prisma-counts.mjs';
import { sourceName, sourceKind } from './prisma-counts.mjs';
import { databasesOf } from './search-library.mjs';
import { parseReasons } from './prisma-reasons.mjs';
import { isHandEntered } from './submission.mjs';
import { PRISMA_FIELDS } from '../schema.mjs';

/** The diagram's boxes: id, its heading, and the count fields it draws. */
export const BOXES = {
  identified:  { label: 'Records identified from databases and registers', fields: ['database_results', 'register_results'] },
  removed:     { label: 'Records removed before screening', fields: ['duplicates', 'excluded_automatic', 'excluded_other'] },
  screened:    { label: 'Records screened', fields: ['records_screened'] },
  excluded:    { label: 'Records excluded', fields: ['records_excluded'] },
  sought:      { label: 'Reports sought for retrieval', fields: ['dbr_sought_reports'] },
  notret:      { label: 'Reports not retrieved', fields: ['dbr_notretrieved_reports'] },
  assessed:    { label: 'Reports assessed for eligibility', fields: ['dbr_assessed'] },
  excl2:       { label: 'Reports excluded', fields: ['dbr_excluded'] },
  included:    { label: 'Studies included in review', fields: ['new_studies', 'new_reports'] },
  oIdentified: { label: 'Records identified via other methods', fields: ['website_results', 'organisation_results', 'citations_results'] },
  oSought:     { label: 'Reports sought for retrieval, other methods', fields: ['other_sought_reports'] },
  oNotret:     { label: 'Reports not retrieved, other methods', fields: ['other_notretrieved_reports'] },
  oAssessed:   { label: 'Reports assessed for eligibility, other methods', fields: ['other_assessed'] },
  oExcl:       { label: 'Reports excluded, other methods', fields: ['other_excluded'] },
  prev:        { label: 'Studies included in previous version', fields: ['previous_studies', 'previous_reports'] },
  total:       { label: 'Total studies included in review', fields: ['total_studies', 'total_reports'] },
};
const LABEL = Object.fromEntries(PRISMA_FIELDS.map(f => [f.id, f.label]));
export const NO_SOURCE = 'Source not recorded';

const rec = (p, note = '', extra = {}) => ({ id: p.id, label: p.label || p.title || p.id, title: p.title && p.title !== p.label ? p.title : '', year: p.year || '', note, ...extra });

/** The record sets, by the field whose count they make. Each is { records, groups? } or absent when the project has no set for that field. */
export function sets(s) {
  const papers = s.papers || [], sc = s.screening || {}, ft = s.fulltext || {}, out = {};
  const merged = s.merged || [];
  const byId = new Map(papers.map(p => [p.id, p]));
  const dups = merged.filter(m => m.dup).map(m => rec(m.dup, `Merged into ${byId.get(m.keepId)?.label || m.keepId}`, { removed: true }));
  out.duplicates = { records: dups };

  // Identification: every record the library holds or merged away, under the
  // sources that found it. A run's own retrieved number can exceed this (records
  // the library already held were not added again), which the part reports.
  const runs = (s.searches || []).filter(r => r.status !== 'failed' && !r.exploratory);
  const dupById = new Map(dups.map(d => [d.id, d]));
  const all = [...papers.map(p => ({ p, r: rec(p) })), ...merged.filter(m => m.dup).map(m => ({ p: m.dup, r: dupById.get(m.dup.id) }))];
  const group = kind => {
    const g = new Map();
    for (const { p, r } of all) {
      const names = databasesOf(p).map(sourceName);
      const own = (names.length ? names : [NO_SOURCE]).filter(n => n === NO_SOURCE ? kind === 'database' : sourceKind({ source: n }) === kind);
      for (const n of own) { if (!g.has(n)) g.set(n, []); g.get(n).push(r); }
    }
    const groups = [...g].map(([name, records]) => ({ name, records }));
    const seen = new Set(), records = [];
    for (const x of groups) for (const r of x.records) if (!seen.has(r.id)) { seen.add(r.id); records.push(r); }
    return { records, groups };
  };
  if (runs.length) { out.database_results = group('database'); out.register_results = group('register'); }
  else out.database_results = { records: all.map(x => x.r), groups: [] };

  const decided = papers.filter(p => sc[p.id] && !sc[p.id].needsCriteriaReview);
  const excl = decided.filter(p => sc[p.id].decision === 'exclude');
  const sought = papers.filter(p => sc[p.id]?.decision === 'include' && !sc[p.id].needsCriteriaReview);
  const why = (d, alt = '') => d?.reason || alt;
  out.records_excluded = { records: excl.map(p => rec(p, why(sc[p.id]))) };
  out.records_screened = { records: [...excl.map(p => rec(p, `Excluded${why(sc[p.id]) ? `: ${sc[p.id].reason}` : ''}`)), ...sought.map(p => rec(p, 'Sought'))] };
  out.dbr_sought_reports = { records: sought.map(p => rec(p)) };
  const assessed = sought.filter(p => ft[p.id] && !ft[p.id].needsCriteriaReview && ['include', 'exclude'].includes(ft[p.id].decision));
  const notFound = assessed.filter(p => ft[p.id].decision === 'exclude' && /not retriev/i.test(ft[p.id].reason || ''));
  const rest = assessed.filter(p => !notFound.includes(p));
  out.dbr_notretrieved_reports = { records: notFound.map(p => rec(p, why(ft[p.id]))) };
  out.dbr_assessed = { records: rest.map(p => rec(p, ft[p.id].decision === 'include' ? 'Included' : `Excluded: ${why(ft[p.id], 'Other')}`)) };
  const reasons = new Map();
  for (const p of rest) if (ft[p.id].decision === 'exclude') { const k = (ft[p.id].reason || 'Other').replace(/;/g, ','); if (!reasons.has(k)) reasons.set(k, []); reasons.get(k).push(rec(p, k)); }
  const groups = [...reasons].map(([name, records]) => ({ name, records }));
  out.dbr_excluded = { records: groups.flatMap(g => g.records), groups };
  out.new_studies = { records: rest.filter(p => ft[p.id].decision === 'include').map(p => rec(p)) };
  return out;
}

const sumReasons = v => parseReasons(v).reduce((a, r) => a + (/^-?\d+$/.test(r.count) ? Number(r.count) : 0), 0);
const numeric = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * One count of the diagram: what the diagram shows for it, whether it was
 * entered by hand, and the records behind it.
 * { field, label, count, manual, projectCount, records, groups, unlisted, note }
 * `count` is the number drawn (null when there is none). A hand-entered count
 * has no records and no groups. A derived one lists its records; `unlisted`
 * is how much of the count no record is kept for (a search log's retrieved
 * number exceeding what the library holds, or duplicates skipped on import).
 */
export function partOf(s, field, cache = null) {
  const derived = derive(s), entered = s.prisma?.[field];
  const manual = isHandEntered(entered, derived[field]);
  const text = PRISMA_FIELDS.find(f => f.id === field)?.text;
  const num = v => (text ? (v === undefined ? null : sumReasons(v)) : numeric(v));
  const projectCount = derived[field] === undefined ? null : num(derived[field]);
  const base = { field, label: LABEL[field] || field, manual, projectCount, records: [], groups: [], unlisted: 0, note: '' };
  if (manual) return { ...base, count: num(entered), note: 'Entered by hand. No records stand behind this number.' };
  if (derived[field] === undefined) {
    return { ...base, count: null, note: field in (cache || sets(s)) ? 'The project has no count for this yet.' : 'The project keeps no records for this count. Enter it by hand under Flow counts.' };
  }
  const set = (cache || sets(s))[field];
  const count = num(derived[field]);
  if (!set) return { ...base, count, note: 'The project keeps no records for this count.' };
  const unlisted = Math.max(0, count - set.records.length);
  const note = field === 'duplicates' && unlisted ? `${unlisted} not added at import, so no record is kept for them.`
    : unlisted ? `${unlisted} of the ${count} retrieved are not in the library (duplicates skipped at import or records not imported).` : '';
  return { ...base, count, records: set.records, groups: set.groups || [], unlisted, note };
}

/** A box with each of its counts. */
export function boxDetail(s, boxId) {
  const box = BOXES[boxId];
  if (!box) return null;
  const cache = sets(s);
  return { id: boxId, label: box.label, parts: box.fields.map(f => partOf(s, f, cache)) };
}
