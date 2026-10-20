// Shared by Reporting, Overview, the manuscript's live results and every export.
import { SOURCES } from './sources.mjs';

// A source is logged by id (workflows) or by name (the search page, imports);
// the diagram names it the way the database calls itself.
export const sourceName = v => SOURCES.find(x => x.id === v || x.name === v)?.name || String(v || 'Database');
export const sourceKind = r => r.kind || SOURCES.find(x => x.id === r.source || x.name === r.source)?.kind || 'database';

/** "Name, n; Name, n" per source of one kind, in PRISMA2020's own format for these fields. */
function perSource(runs, kind) {
  const by = new Map();
  for (const r of runs.filter(r => sourceKind(r) === kind)) {
    const name = sourceName(r.source);
    by.set(name, (by.get(name) || 0) + (Number(r.retrieved) || 0));
  }
  return [...by].map(([name, n]) => `${name}, ${n}`).join('; ');
}

/** The counts every page shows: derived from the project, then the ones entered by hand. */
export const prismaData = s => ({ ...derive(s), ...(s.prisma || {}) });

export function derive(s) {
  const out = {};

  // PRISMA counts records identified per source, before de-duplication, and
  // keeps databases and registers apart. The search log holds exactly that:
  // one entry per run, with the number the review actually retrieved. Entries
  // written before sources were distinguished were all databases.
  // A run the reviewer marked exploratory (plan B7: kept distinguishable from
  // the protocol's searches) is in the log but not in the flow.
  const runs = (s.searches || []).filter(r => r.status !== 'failed' && !r.exploratory);
  const byKind = k => runs
    .filter(r => sourceKind(r) === k)
    .reduce((a, r) => a + (Number(r.retrieved) || 0), 0);

  if (runs.length) {
    const db = byKind('database');
    const reg = byKind('register');
    if (db) { out.database_results = db; out.database_specific_results = perSource(runs, 'database'); }
    if (reg) { out.register_results = reg; out.register_specific_results = perSource(runs, 'register'); }
  } else if (s.papers.length) {
    // No searches recorded, so the library was imported rather than searched:
    // what was identified is the library and the duplicates merged out of it.
    out.database_results = s.papers.length + (s.merged || []).length;
  }
  // The duplicates removed: records merged into another as the same study,
  // and records an import or a saved run did not add because the library
  // already held them (counted on its search-log entry). Without the second
  // part a library built from two overlapping exports reported more records
  // identified than screened with no duplicates to account for the gap.
  const skipped = runs.reduce((a, r) => a + (Number(r.duplicates) || 0), 0);
  if ((s.merged || []).length || skipped) out.duplicates = (s.merged || []).length + skipped;

  // Title/abstract decisions fill the screening row; full-text decisions, once
  // any exist, fill the retrieval and eligibility rows beneath it.
  const sc = s.screening || {}, ft = s.fulltext || {};
  const decided = s.papers.flatMap(p=>sc[p.id]&&!sc[p.id].needsCriteriaReview?[sc[p.id]]:[]);
  if (decided.length) {
    // A record still undecided (uncertain) is neither excluded nor sought, so
    // it is not yet counted as screened: screened = excluded + sought, as the
    // diagram reads. pending() says how many wait.
    out.records_excluded = decided.filter(d => d.decision === 'exclude').length;
    const sought = s.papers.filter(p => sc[p.id]?.decision === 'include' && !sc[p.id].needsCriteriaReview);
    out.records_screened = out.records_excluded + sought.length;
    out.dbr_sought_reports = sought.length;
    const assessed = sought.filter(p => ft[p.id] && !ft[p.id].needsCriteriaReview && ['include', 'exclude'].includes(ft[p.id].decision));
    if (assessed.length) {
      const notFound = assessed.filter(p => ft[p.id].decision === 'exclude' && /not retriev/i.test(ft[p.id].reason || ''));
      out.dbr_notretrieved_reports = notFound.length;
      out.dbr_assessed = assessed.length - notFound.length;
      const reasons = {};
      for (const p of assessed) {
        const d = ft[p.id];
        if (d.decision === 'exclude' && !notFound.includes(p)) reasons[d.reason || 'Other'] = (reasons[d.reason || 'Other'] || 0) + 1;
      }
      out.dbr_excluded = Object.entries(reasons).map(([r, n]) => `${r.replace(/;/g, ',')}, ${n}`).join('; ');
      out.new_studies = assessed.filter(p => ft[p.id].decision === 'include').length;
    }
  }
  return out;
}

/** Decisions not yet counted in the flow: records undecided at title/abstract and reports undecided at full text. */
export function pending(s) {
  const sc = s.screening || {}, ft = s.fulltext || {};
  const open = d => d && !d.needsCriteriaReview && !['include', 'exclude'].includes(d.decision);
  return {
    screening: (s.papers || []).filter(p => open(sc[p.id])).length,
    fulltext: (s.papers || []).filter(p => sc[p.id]?.decision === 'include' && open(ft[p.id])).length,
  };
}
