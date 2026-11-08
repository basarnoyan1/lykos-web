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
import { derive, sourceName, sourceKind, flowArms, isOtherMethod, recordSources, OTHER_METHODS, duplicatesBasis, NO_SOURCE, identification, IDENTIFICATION_RULE } from './prisma-counts.mjs';
import { parseReasons, reasonGroups } from './prisma-reasons.mjs';
import { isHandEntered } from './submission.mjs';
import { lib_screen$atFullText as atFullText, lib_screen$fullTextState as fullTextState } from "../boot.mjs";
import { schema$PRISMA_FIELDS as PRISMA_FIELDS } from "../boot.mjs";

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
  oIdentified: { label: 'Records identified via other methods', fields: ['website_results', 'organisation_results', 'citations_results', 'other_sources_results'] },
  oSought:     { label: 'Reports sought for retrieval, other methods', fields: ['other_sought_reports'] },
  oNotret:     { label: 'Reports not retrieved, other methods', fields: ['other_notretrieved_reports'] },
  oAssessed:   { label: 'Reports assessed for eligibility, other methods', fields: ['other_assessed'] },
  oExcl:       { label: 'Reports excluded, other methods', fields: ['other_excluded'] },
  prev:        { label: 'Studies included in previous version', fields: ['previous_studies', 'previous_reports'] },
  total:       { label: 'Total studies included in review', fields: ['total_studies', 'total_reports'] },
};
const LABEL = Object.fromEntries(PRISMA_FIELDS.map(f => [f.id, f.label]));
export { NO_SOURCE };

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
  // Records found only by other methods are counted there (lib/prisma-counts.mjs flowArms), not under the databases.
  const { runs, kindOf, methodOf, ownSources } = flowArms(s);
  const dupById = new Map(dups.map(d => [d.id, d]));
  const all = [...papers.map(p => ({ p, r: rec(p) })), ...merged.filter(m => m.dup).map(m => ({ p: m.dup, r: dupById.get(m.dup.id) }))];
  // a record of a review's previous version (lib/prisma-counts.mjs flowArms) is in neither column
  const inDb = p => methodOf(p).method === 'database';
  const group = kind => {
    const g = new Map();
    // each record under the databases that found it, by its own sources (a file's run included, lib/prisma-counts.mjs flowArms)
    for (const { p, r } of all.filter(x => inDb(x.p))) {
      const names = ownSources(p);
      const own = (names.length ? names : [NO_SOURCE]).filter(n => n === NO_SOURCE ? kind === 'database' : kindOf(n) === kind);
      for (const n of own) { if (!g.has(n)) g.set(n, []); g.get(n).push(r); }
    }
    const groups = [...g].map(([name, records]) => ({ name, records }));
    const seen = new Set(), records = [];
    for (const x of groups) for (const r of x.records) if (!seen.has(r.id)) { seen.add(r.id); records.push(r); }
    return { records, groups };
  };
  if (runs.some(r => !isOtherMethod(sourceKind(r)))) { out.database_results = group('database'); out.register_results = group('register'); }
  else out.database_results = { records: all.filter(x => inDb(x.p)).map(x => x.r), groups: [] };
  // other methods: citation searching, websites and organisations each a set, the rest grouped by source name
  for (const [method, field] of Object.entries(OTHER_METHODS)) {
    const mine = all.filter(x => methodOf(x.p).method === method);
    if (method !== 'other') { out[field] = { records: mine.map(x => x.r) }; continue; }
    const g = new Map();
    for (const x of mine) { const n = methodOf(x.p).name; if (!g.has(n)) g.set(n, []); g.get(n).push(x.r); }
    out[field] = { records: mine.map(x => x.r), groups: [...g].map(([name, records]) => ({ name, records })) };
  }

  // the screening column of the databases arm, and the other-methods column beside it (no screening box of its own)
  const why = (d, alt = '') => d?.reason || alt;
  const column = (recs, keys) => {
    // sought: the records at full text, as derive() counts them (lib/screen.mjs atFullText, fullTextState)
    const sought = recs.filter(p => atFullText(s, p));
    const excl = recs.filter(p => sc[p.id] && !sc[p.id].needsCriteriaReview && sc[p.id].decision === 'exclude' && !atFullText(s, p));
    if (keys.excluded) {
      out[keys.excluded] = { records: excl.map(p => rec(p, why(sc[p.id]))) };
      out[keys.screened] = { records: [...excl.map(p => rec(p, `Excluded${why(sc[p.id]) ? `: ${sc[p.id].reason}` : ''}`)), ...sought.map(p => rec(p, 'Sought'))] };
    }
    out[keys.sought] = { records: sought.map(p => rec(p)) };
    const state = new Map(sought.map(p => [p.id, fullTextState(s, p)]));
    const assessed = sought.filter(p => ['include', 'exclude'].includes(state.get(p.id)));
    const notFound = assessed.filter(p => ft[p.id].decision === 'exclude' && /not retriev/i.test(ft[p.id].reason || ''));
    const rest = assessed.filter(p => !notFound.includes(p));
    out[keys.notret] = { records: [...notFound.map(p => rec(p, why(ft[p.id]))), ...sought.filter(p => state.get(p.id) === 'not-retrieved').map(p => rec(p, 'Recorded as not retrieved'))] };
    out[keys.assessed] = { records: rest.map(p => rec(p, ft[p.id].decision === 'include' ? 'Included' : `Excluded: ${why(ft[p.id], 'Other')}`)) };
    const groups = reasonGroups(rest.filter(p => ft[p.id].decision === 'exclude'), p => ft[p.id].reason, s.protocol?.criteria)
      .map(g => ({ name: g.name, records: g.items.map(p => rec(p, g.name)) }));
    out[keys.excl] = { records: groups.flatMap(g => g.records), groups };
    return rest.filter(p => ft[p.id].decision === 'include');
  };
  const included = [
    ...column(papers.filter(inDb), { excluded: 'records_excluded', screened: 'records_screened', sought: 'dbr_sought_reports', notret: 'dbr_notretrieved_reports', assessed: 'dbr_assessed', excl: 'dbr_excluded' }),
    ...column(papers.filter(p => isOtherMethod(methodOf(p).method)), { sought: 'other_sought_reports', notret: 'other_notretrieved_reports', assessed: 'other_assessed', excl: 'other_excluded' }),
  ];
  out.new_studies = { records: included.map(p => rec(p)) };
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
  const note = field === 'duplicates' ? duplicatesNote(duplicatesBasis(s), set.records.length)
    : field === 'database_results' || field === 'register_results' ? identificationNote(s, field === 'register_results' ? 'register' : 'database', unlisted, count)
    : unlisted ? `${unlisted} of the ${count} retrieved are not in the library (duplicates skipped at import or records not imported).` : '';
  return { ...base, count, records: set.records, groups: set.groups || [], unlisted, note };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = n => Number(n).toLocaleString('en-US');
/**
 * How records identified were counted (31 Oct 2026): the rule, then each database searched more than once with its runs' own
 * numbers and the records it counted, so a re-run never reads as a database of its own.
 */
export function identificationNote(s, kind = 'database', unlisted = 0, count = 0) {
  const rows = identification(s).rows.filter(r => r.kind === kind && r.runs.length > 1);
  const each = rows.map(r => r.rule === 'summed'
    ? `${r.name}: ${plural(r.runs.length, 'run')} of this version, ${fmt(r.retrieved)} records`
    : `${r.name}: ${plural(r.runs.length, 'run')}, ${fmt(r.retrieved)} records retrieved, ${fmt(r.count)} distinct`);
  const left = unlisted ? ` ${unlisted} of the ${count} are not in the library (duplicates within a file, or records not imported).` : '';
  return `${IDENTIFICATION_RULE}${each.length ? ` ${each.join('; ')}.` : ''}${left}`;
}
/** How the duplicates removed were counted, in the words of the box's detail. */
export function duplicatesNote(b, listed = b.merged) {
  const seen = [b.merged && `${b.merged} merged here`, b.skipped && `${b.skipped} not added at import as already held`,
    b.before && `${b.before} removed before import`].filter(Boolean);
  if (b.exact) {
    // with a database searched more than once, a skip at import may be its own earlier run's record, which was identified once
    const parts = b.distinct ? [b.previous && `${b.previous} from the previous version`].filter(Boolean)
      : [...seen, b.outside && `${b.outside} removed before import or deleted from the library`, b.previous && `${b.previous} from the previous version`].filter(Boolean);
    if (b.distinct) return `${b.identified} records identified less ${plural(b.unique, 'unique record')} from databases and registers${parts.length ? `: ${parts.join(', ')}` : ''}. ${b.distinct.join(', ')} ${b.distinct.length === 1 ? 'was' : 'were'} searched more than once; each counts a record once across its runs.${b.count > listed ? ` No record is kept for ${b.count - listed}.` : ''}`;
    return `${b.identified} records identified less ${plural(b.unique, 'unique record')} from databases and registers${parts.length ? `: ${parts.join(', ')}` : ''}.${b.count > listed ? ` No record is kept for ${b.count - listed}.` : ''}`;
  }
  if (b.unknown.length) return `Only what the project saw removed (${seen.join(', ') || 'none'}): the search log has no retrieved count for ${b.unknown.join(', ')}, so duplicates removed before import are unknown.`;
  if (b.absent.length) return `Only what the project saw removed (${seen.join(', ') || 'none'}): the library holds no record from ${b.absent.join(', ')}, so the search log's count for it is not compared.`;
  if (b.short) return `Only what the project saw removed (${seen.join(', ') || 'none'}): the search log's ${b.identified} records identified do not cover the ${plural(b.unique, 'record')} the library holds from databases and registers and those removed.`;
  return seen.length ? `${seen.join(', ')}.` : '';
}

/** A box with each of its counts. */
export function boxDetail(s, boxId) {
  const box = BOXES[boxId];
  if (!box) return null;
  const cache = sets(s);
  return { id: boxId, label: box.label, parts: box.fields.map(f => partOf(s, f, cache)) };
}
