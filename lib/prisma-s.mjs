// The search, reported the way PRISMA-S asks: every database, the full
// strategy as run, the date, the limits, the count — so another team can run
// it again. The strategies are the project's own search log; the items a log
// cannot know (limits applied, peer review of the strategy, other sources,
// how duplicates were removed) are stated once and kept with the project.
import { prismaData, sourceName, sourceKind, runName, IDENTIFICATION_RULE, identification } from './prisma-counts.mjs';
import { database } from './databases.mjs';
import { warningsOf, runVersion, runQuery } from './search-runs.mjs';
import { ownRun } from './reviews.mjs';

/** Recorded line breaks only. Database syntax must never be rewritten for reporting. */
export function strategyLines(query) {
  const text = String(query ?? '');
  return text.trim() ? text.split(/\r\n|\n|\r/) : [];
}

const NOT_RECORDED = 'Strategy not recorded.';
export const recordedQuery = entry => String(entry.query ?? entry.lines?.join('\n') ?? '');
const queryFence = query => { let length=3;for(const match of query.matchAll(/`+/g))length=Math.max(length,match[0].length+1);return '`'.repeat(length); };

/** One entry per database: the last complete run of each distinct query. */
export function compile(s) {
  // The same runs the flow diagram counts, named and kinded as it names them,
  // so the two reports agree: records are those retrieved, not the hits.
  // An identifiers import of studies found outside the searches is another method, not a database strategy.
  // a run that recorded no query (an import before 2 Nov 2026 logged "Imported from <file>", read as none: lib/search-runs.mjs runQuery)
  // is still reported, its strategy said to be not recorded, so its database, version and warnings are not lost
  const runs = (s.searches || []).filter(r => ownRun(r) && r.status !== 'failed' && !r.exploratory && !r.citationSearch && !r.related && ['database', 'register'].includes(sourceKind(r)));
  // Citation searching is its own PRISMA-S item: the seed set, direction and date, not a database strategy.
  const citation = (s.searches || []).filter(r => ownRun(r) && r.citationSearch && r.status !== 'failed')
    .map(r => ({ date: (r.at || '').slice(0, 10), direction: r.direction, seeds: r.seeds, retrieved: r.retrieved, fresh: r.new, via: r.dataSource || 'OpenAlex' }));
  const by = new Map();
  for (const r of runs) {
    const key = `${runName({ ...r, source: r.source || 'PubMed' })} :: ${runQuery(r)}`;
    const prev = by.get(key);
    if (!prev || (r.at || '') > (prev.at || '')) by.set(key, r);
  }
  const meta = s.searchStrategy || {};
  // each run keeps its version and the warnings the database showed (lib/search-runs.mjs): a list, [] for none shown, null when not recorded
  const databases = [...by.values()].map(r => { const name = runName({ ...r, source: r.source || 'PubMed' }), db = database(name);
    return { source: name, fullName: db?.fullName || name, platform: db?.platform || '', version: runVersion(r), kind: sourceKind(r), date: String(r.date || r.at || '').slice(0, 10), records: r.retrieved ?? r.total ?? null, before: Number(r.deduplicatedBefore) || 0,
      query: runQuery(r), lines: strategyLines(runQuery(r)), warnings: warningsOf(r), previous: !!r.previousVersion }; })
    .sort((a, b) => a.source.localeCompare(b.source) || a.date.localeCompare(b.date));
  const flow = prismaData(s);
  // what the flow counts for each database (each record once across its runs), beside each run's own number
  const counted = identification(s).rows.map(r => ({ source: r.name, kind: r.kind, records: r.count, runs: r.runs.length, retrieved: r.retrieved + r.before, rule: r.rule }));
  return { title: s.paper?.title || s.protocol?.title || 'Untitled review', databases, citation, meta, counted, rule: IDENTIFICATION_RULE,
    duplicates: flow.duplicates ?? null, identified: counted.filter(d => d.kind === 'database').reduce((a, d) => a + d.records, 0) };
}

/**
 * The yields table a paper prints for its searches (Database, date searched, records), with its total row: one row per database
 * as run, in the strategies' order, and the total of the rows. Dates read as the log has them (YYYY-MM-DD).
 */
export function yieldsTable(rep) {
  const rows = rep.databases.map(d => [d.source, d.date || '', d.records ?? '']);
  const total = rep.databases.reduce((a, d) => a + (Number(d.records) || 0), 0);
  return { head: ['Database', 'Date searched', 'Records'], rows, total };
}

/** Several reviews' strategies as one report: each review's own (lib/reviews.mjs), titled by its name. */
export const toMarkdownAll = reps => reps.length === 1 ? toMarkdown(reps[0]) : reps.map(r => toMarkdown(r)).join('\n\n');
export function toBlocksAll(reps) {
  if (reps.length === 1) return toBlocks(reps[0]);
  const out = [];
  reps.forEach((r, i) => { const b = toBlocks(r, { review: r.review }); out.push(...(i ? b.slice(1) : b)); });
  return out.map((b, i) => ({ ...b, id: `s${i + 1}` }));
}

/** What the database's page warned of when the search ran (PRISMA-S: limits and problems of the search as run). */
export function warningLine(d) {
  if (d.warnings == null) return '';   // not recorded: nothing is said for it (lib/search-runs.mjs unrecordedWarnings lists such runs)
  if (!d.warnings.length) return 'Warnings shown by the database: none.';
  return `Warnings shown by the database: ${d.warnings.map(w => w.replace(/[.\s]+$/, '')).join('; ')}.`;
}
/** The rule for records identified, and each database searched more than once with its runs' own total and what PRISMA counts. */
export function identifiedText(rep) {
  const several = (rep.counted || []).filter(c => c.runs > 1);
  return `${rep.rule || IDENTIFICATION_RULE}${several.length ? ` ${several.map(c => `${c.source}: ${c.runs} runs, ${c.retrieved} records retrieved, ${c.records} counted`).join('; ')}.` : ''}`;
}

export function toMarkdown(rep) {
  const out = [`# Search strategies — ${rep.review || rep.title}`, '', `Reported according to PRISMA-S.`, ''];
  if (rep.meta.lastSearched) out.push(`Date of last search: ${rep.meta.lastSearched}  `);
  if (rep.meta.limits) out.push(`Limits and filters: ${rep.meta.limits}  `);
  out.push(`Peer review of the strategy: ${rep.meta.press ? 'yes (PRESS)' : 'no'}  `);
  if (rep.meta.otherSources) out.push(`Other sources: ${rep.meta.otherSources}  `);
  if (rep.meta.dedup) out.push(`Deduplication: ${rep.meta.dedup}  `);
  out.push('');
  if (rep.databases.length) {
    const y = yieldsTable(rep), line = c => `| ${c.join(' | ')} |`;
    out.push(line(y.head), line(['---', '---', '---:']), ...y.rows.map(line), line(['Total', '', y.total]), '');
  }
  for (const d of rep.databases) {
    out.push(`## ${d.fullName || d.source}${d.version ? ` (${d.version})` : ''}${d.date ? ` — searched ${d.date}` : ''}${d.records != null ? ` — ${d.records} records` : ''}`, '');
    const query = recordedQuery(d), fence = queryFence(query);
    if (query.trim()) out.push(`${fence}text`, query, fence); else out.push(NOT_RECORDED);
    if (warningLine(d)) out.push(warningLine(d));
    out.push('');
  }
  for (const c of rep.citation || []) out.push(`Citation searching (${c.via}, ${c.direction}${c.date ? `, ${c.date}` : ''}): ${c.seeds} seed ${c.seeds === 1 ? 'study' : 'studies'}, ${c.retrieved} records retrieved, ${c.fresh} not already in the library`, '');
  if (rep.databases.length) out.push(`Records identified across databases: ${rep.identified}${rep.duplicates != null ? `; duplicates removed: ${rep.duplicates}` : ''}`, '', identifiedText(rep));
  return out.join('\n');
}

/** Blocks in the manuscript's own shape, for the Word writer. */
export function toBlocks(rep, { review = '' } = {}) {
  const b = []; let n = 0; const id = () => `s${++n}`;
  b.push({ id: id(), type: 'title', text: `Supplementary appendix: search strategies` });
  // a review of several in one paper heads its own part, and its databases sit one level beneath
  const db = review ? 'h2' : 'h1';
  if (review) b.push({ id: id(), type: 'h1', text: review });
  b.push({ id: id(), type: 'p', text: `${rep.title}. Reported according to PRISMA-S.` });
  const facts = [rep.meta.lastSearched ? `Date of last search: ${rep.meta.lastSearched}.` : '', rep.meta.limits ? `Limits and filters: ${rep.meta.limits}.` : '',
    `Peer review of the strategy: ${rep.meta.press ? 'yes (PRESS)' : 'no'}.`, rep.meta.otherSources ? `Other sources: ${rep.meta.otherSources}.` : '',
    rep.meta.dedup ? `Deduplication: ${rep.meta.dedup}.` : ''].filter(Boolean).join(' ');
  if (facts) b.push({ id: id(), type: 'p', text: facts });
  if (rep.databases.length) { const y = yieldsTable(rep); b.push({ id: id(), type: 'table', header: true, rows: [y.head, ...y.rows, ['Total', '', y.total]].map(r => r.map(String)) }); }
  for (const d of rep.databases) {
    b.push({ id: id(), type: db, text: `${d.fullName || d.source}${d.version ? ` ${d.version}` : ''}${d.date ? ` (searched ${d.date})` : ''}${d.records != null ? ` — ${d.records} records` : ''}` });
    const lines = strategyLines(recordedQuery(d));
    (lines.length ? lines : [NOT_RECORDED]).forEach(text => b.push({ id: id(), type: 'p', text }));
    if (warningLine(d)) b.push({ id: id(), type: 'p', text: warningLine(d) });
  }
  for (const c of rep.citation || []) b.push({ id: id(), type: 'p', text: `Citation searching (${c.via}, ${c.direction}${c.date ? `, ${c.date}` : ''}): ${c.seeds} seed ${c.seeds === 1 ? 'study' : 'studies'}, ${c.retrieved} records retrieved, ${c.fresh} not already in the library.` });
  if (rep.databases.length) b.push({ id: id(), type: 'p', text: `Records identified across databases: ${rep.identified}${rep.duplicates != null ? `; duplicates removed: ${rep.duplicates}` : ''}. ${identifiedText(rep)}` });
  return b;
}
