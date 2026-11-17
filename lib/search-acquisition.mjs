import { runSearch } from './sources.mjs';
/** Explicit acquisition scope. A bounded sample is never labelled complete. */
export async function acquireSearch(source, query, { limit = 100, all = false, maxRecords = 10000, signal, settings, onProgress = () => {}, onCheckpoint = () => {}, checkpoint, search = runSearch } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000) throw new Error('Choose a supported search acquisition limit');
  const target = all ? maxRecords : limit, signature = JSON.stringify({source,query,limit,all,maxRecords}), prior = checkpoint?.signature === signature ? checkpoint : null;
  const records = [...(prior?.records || [])], seen = new Set(records.map(r=>r.key||r.id||JSON.stringify(r))), pageSize = Math.min(100, target);
  let total = prior?.total ?? null, pages = prior?.pages || 0, offset = prior?.offset || 0, exhausted = prior?.exhausted || false, cursor = prior?.cursor ?? null, truncated = prior?.truncated || false;
  while (!exhausted && records.length < target) {
    if (signal?.aborted) throw new DOMException('Search stopped', 'AbortError');
    const result = await search(source, query, { offset, limit: pageSize, cursor, settings, signal });
    if (signal?.aborted) throw new DOMException('Search stopped', 'AbortError');
    pages++; if (Number.isFinite(result.total) && (total == null || result.total >= records.length)) total = result.total;
    const rows = result.records || []; let added = 0;
    for (const row of rows) { const key = row.key || row.id || JSON.stringify(row); if (!seen.has(key)) { if (records.length >= target) { truncated = true; continue; } seen.add(key); records.push(row); added++; } }
    cursor = result.nextCursor ?? null;
    offset += rows.length; onProgress(`${records.length} records, ${pages} pages`);
    exhausted = !rows.length || total != null && offset >= total;
    await onCheckpoint({ signature, records, total, pages, offset, exhausted, cursor, truncated, at: new Date().toISOString() });
    if (exhausted) break;
    // A source repeating pages cannot silently appear complete.
    if (!added) break;
    if (!all) break;
    if (pages >= 2000) break;
  }
  const complete = !truncated && (exhausted || total != null && records.length >= total);
  return { records, total, pages, complete, stoppedAtLimit: !complete && records.length >= target, offset, scope: all ? 'All available within limit' : 'Limited sample' };
}
