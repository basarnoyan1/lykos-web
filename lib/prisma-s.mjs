// The search, reported the way PRISMA-S asks: every database, the full
// strategy as run, the date, the limits, the count — so another team can run
// it again. The strategies are the project's own search log; the items a log
// cannot know (limits applied, peer review of the strategy, other sources,
// how duplicates were removed) are stated once and kept with the project.
import { prismaData, sourceName, sourceKind } from './prisma-counts.mjs';

/** Recorded line breaks only. Database syntax must never be rewritten for reporting. */
export function strategyLines(query) {
  const text = String(query ?? '');
  return text.trim() ? text.split(/\r\n|\n|\r/) : [];
}

export const recordedQuery = entry => String(entry.query ?? entry.lines?.join('\n') ?? '');
const queryFence = query => { let length=3;for(const match of query.matchAll(/`+/g))length=Math.max(length,match[0].length+1);return '`'.repeat(length); };

/** One entry per database: the last complete run of each distinct query. */
export function compile(s) {
  // The same runs the flow diagram counts, named and kinded as it names them,
  // so the two reports agree: records are those retrieved, not the hits.
  const runs = (s.searches || []).filter(r => r.query && r.status !== 'failed' && !r.exploratory && !r.citationSearch && !r.related);
  // Citation searching is its own PRISMA-S item: the seed set, direction and date, not a database strategy.
  const citation = (s.searches || []).filter(r => r.citationSearch && r.status !== 'failed')
    .map(r => ({ date: (r.at || '').slice(0, 10), direction: r.direction, seeds: r.seeds, retrieved: r.retrieved, fresh: r.new, via: r.dataSource || 'OpenAlex' }));
  const by = new Map();
  for (const r of runs) {
    const key = `${sourceName(r.source || 'PubMed')} :: ${r.query}`;
    const prev = by.get(key);
    if (!prev || (r.at || '') > (prev.at || '')) by.set(key, r);
  }
  const meta = s.searchStrategy || {};
  const databases = [...by.values()].map(r => ({ source: sourceName(r.source || 'PubMed'), kind: sourceKind(r), date: (r.at || '').slice(0, 10), records: r.retrieved ?? r.total ?? null,
      query: r.query, lines: strategyLines(r.query) }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.date.localeCompare(b.date));
  const flow = prismaData(s);
  return { title: s.paper?.title || s.protocol?.title || 'Untitled review', databases, citation, meta,
    duplicates: flow.duplicates ?? null, identified: databases.filter(d => d.kind === 'database').reduce((a, d) => a + (Number(d.records) || 0), 0) };
}

export function toMarkdown(rep) {
  const out = [`# Search strategies — ${rep.title}`, '', `Reported according to PRISMA-S.`, ''];
  if (rep.meta.lastSearched) out.push(`Date of last search: ${rep.meta.lastSearched}  `);
  if (rep.meta.limits) out.push(`Limits and filters: ${rep.meta.limits}  `);
  out.push(`Peer review of the strategy: ${rep.meta.press ? 'yes (PRESS)' : 'no'}  `);
  if (rep.meta.otherSources) out.push(`Other sources: ${rep.meta.otherSources}  `);
  if (rep.meta.dedup) out.push(`Deduplication: ${rep.meta.dedup}  `);
  out.push('');
  for (const d of rep.databases) {
    out.push(`## ${d.source}${d.date ? ` — searched ${d.date}` : ''}${d.records != null ? ` — ${d.records} records` : ''}`, '');
    const query = recordedQuery(d), fence = queryFence(query);
    out.push(`${fence}text`, query, fence);
    out.push('');
  }
  for (const c of rep.citation || []) out.push(`Citation searching (${c.via}, ${c.direction}${c.date ? `, ${c.date}` : ''}): ${c.seeds} seed ${c.seeds === 1 ? 'study' : 'studies'}, ${c.retrieved} records retrieved, ${c.fresh} not already in the library`, '');
  if (rep.databases.length) out.push(`Records identified across databases: ${rep.identified}${rep.duplicates != null ? `; duplicates removed: ${rep.duplicates}` : ''}`);
  return out.join('\n');
}

/** Blocks in the manuscript's own shape, for the Word writer. */
export function toBlocks(rep) {
  const b = []; let n = 0; const id = () => `s${++n}`;
  b.push({ id: id(), type: 'title', text: `Supplementary appendix: search strategies` });
  b.push({ id: id(), type: 'p', text: `${rep.title}. Reported according to PRISMA-S.` });
  const facts = [rep.meta.lastSearched ? `Date of last search: ${rep.meta.lastSearched}.` : '', rep.meta.limits ? `Limits and filters: ${rep.meta.limits}.` : '',
    `Peer review of the strategy: ${rep.meta.press ? 'yes (PRESS)' : 'no'}.`, rep.meta.otherSources ? `Other sources: ${rep.meta.otherSources}.` : '',
    rep.meta.dedup ? `Deduplication: ${rep.meta.dedup}.` : ''].filter(Boolean).join(' ');
  if (facts) b.push({ id: id(), type: 'p', text: facts });
  for (const d of rep.databases) {
    b.push({ id: id(), type: 'h1', text: `${d.source}${d.date ? ` (searched ${d.date})` : ''}${d.records != null ? ` — ${d.records} records` : ''}` });
    strategyLines(recordedQuery(d)).forEach(text => b.push({ id: id(), type: 'p', text }));
  }
  for (const c of rep.citation || []) b.push({ id: id(), type: 'p', text: `Citation searching (${c.via}, ${c.direction}${c.date ? `, ${c.date}` : ''}): ${c.seeds} seed ${c.seeds === 1 ? 'study' : 'studies'}, ${c.retrieved} records retrieved, ${c.fresh} not already in the library.` });
  if (rep.databases.length) b.push({ id: id(), type: 'p', text: `Records identified across databases: ${rep.identified}${rep.duplicates != null ? `; duplicates removed: ${rep.duplicates}` : ''}.` });
  return b;
}
