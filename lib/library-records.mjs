import { retrievalRecord } from './project-trim.mjs';
export function pdfRank(p) {
  if (p.pdf) return 3;
  const r = p.pdfRetrieval;
  if (r?.status === 'preview' && !/full text/i.test(r.provider || '') && !/fullTextXML/.test(r.url || '')) return 2;
  return r?.status === 'unavailable' ? 0 : 1;
}
export function sortRecords(papers, key, direction = 1) {
  if (!key) return papers;
  const value = p => key === 'authors' ? (p.authors || []).join('; ') : key === 'source' ? p.journal || p.source || '' : key === 'pdf' ? pdfRank(p) : key === 'year' ? Number(p.year) || 0 : p.title || '';
  return [...papers].sort((a,b) => {
    const x = value(a), y = value(b);
    const missing = v => v === '' || (key === 'year' && v === 0);
    if (missing(x) !== missing(y)) return missing(x) ? 1 : -1;
    return direction * (typeof x === 'number' ? x-y : String(x).localeCompare(String(y), undefined, { numeric:true, sensitivity:'base' }));
  });
}
export const pdfFilename = paper => `${[paper.label, paper.title].filter(Boolean).join(' — ').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100) || 'Paper'}.pdf`;

/** Counts are derived from current records, never a fixed audit total. */
export function availabilityCounts(papers) {
  return papers.reduce((counts, p) => {
    const rank = pdfRank(p);
    counts[rank >= 2 ? 'available' : rank === 0 ? 'unresolved' : 'unchecked']++;
    return counts;
  }, { available: 0, unresolved: 0, unchecked: 0 });
}

/** Merge only audit observations for unchanged records; never resurrect records. */
export function applyAvailabilityAudit(state, audit) {
  for (const row of audit?.papers || []) {
    const paper = state.papers.find(p => p.id === row.id);
    if (!paper || ['doi','title','url','pmid','year'].some(k => String(paper[k] || '') !== String(row.identity?.[k] || ''))) continue;
    const checked = Date.parse(row.checkedAt);
    if (!Number.isFinite(checked) || Date.parse(paper.pdfRetrieval?.at || '') >= checked) continue;
    if (row.reachable && /^https?:\/\//.test(row.url || '') && !/fullTextXML/.test(row.url)) {
      paper.pdfRetrieval = retrievalRecord({ status: 'preview', provider: row.provider || 'Verified source', url: row.url, at: row.checkedAt, doi: paper.doi || '' });
    } else if (!row.reachable && !paper.pdf) {
      paper.pdfRetrieval = retrievalRecord({ ...(paper.pdfRetrieval || {}), status: 'unavailable', at: row.checkedAt, error: row.error || 'Last check did not return a readable PDF', browserSources: row.browserSources || [] });
    }
  }
  return state;
}
