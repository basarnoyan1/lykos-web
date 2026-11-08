// What a project file keeps of logs (plan "Footprint" Task 5): the facts the app reads, not the logs that produced them.
//   pdfRetrieval      status, when, from where (provider, url, kind, doi), the first lines of the error and up to four browser
//                     links: what the Library's "Preview unavailable" and the assistant's "last attempt failed" read. The
//                     availability audit's flag and longer logs go.
//   screeningReview   the imported sheet's row kept to what is read: its record number ('#') and its decision columns (Screening's
//                     "Prior assessments"); the independent review and the batch id as they are.
//   workflowRuns      each workflow's completed runs to its own "Keep completed runs" (default DEFAULT_KEEP_RUNS); running
//                     and waiting runs are never dropped.
// Applied once to a project saved before this (marker `trimmed`), and by the writers from now on. The screening log, abstracts
// and values are kept whole.
export const TRIM_VERSION = 1;
export const DEFAULT_KEEP_RUNS = 25;
const RETRIEVAL_KEYS = ['status', 'at', 'provider', 'url', 'kind', 'doi'];
const ERROR_CHARS = 300, BROWSER_LINKS = 4;

/** A retrieval record with the facts only. Anything that is not a record is returned as it is. */
export function retrievalRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
  const out = {};
  for (const k of RETRIEVAL_KEYS) if (r[k] != null && r[k] !== '') out[k] = r[k];
  if (r.error) { const e = String(r.error); out.error = e.length > ERROR_CHARS ? `${e.slice(0, e.lastIndexOf('\n', ERROR_CHARS) > 40 ? e.lastIndexOf('\n', ERROR_CHARS) : ERROR_CHARS - 1).trimEnd()}…` : e; }
  if (Array.isArray(r.browserSources)) { const links = r.browserSources.filter(u => typeof u === 'string' && u.length <= 500).slice(0, BROWSER_LINKS); if (links.length) out.browserSources = links; }
  return out;
}

/** The imported sheet's row as the app reads it: its number and decision columns. */
export function workbookRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  return Object.fromEntries(Object.entries(row).filter(([k, v]) => k === '#' || (/decision/i.test(k) && String(v ?? '').trim())));
}

/** Completed runs of each workflow past its retention go, with the runs they started (lib/flow-runner.mjs retainWorkflowRuns). */
export function retainRuns(runs, workflows = []) {
  if (!Array.isArray(runs)) return runs;
  const keepOf = new Map((workflows || []).map(f => [f?.id, Number(f?.keepRuns) || DEFAULT_KEEP_RUNS]));
  const count = new Map(), removed = new Set();
  for (const r of runs) {
    if (!r || r.parentRunId || ['running', 'waiting'].includes(r.status)) continue;
    const n = (count.get(r.flowId) || 0) + 1; count.set(r.flowId, n);
    if (n > (keepOf.get(r.flowId) ?? DEFAULT_KEEP_RUNS)) removed.add(r.id);
  }
  return removed.size ? runs.filter(r => !removed.has(r?.id) && !removed.has(r?.rootRunId)) : runs;
}

/** The one-time trim of a project saved before it. Mutates `st` (a normalised copy) and marks it; a marked project is left alone. */
export function trimProject(st) {
  if (!st || st.trimmed >= TRIM_VERSION) return st;
  if (Array.isArray(st.papers)) st.papers = st.papers.map(p => {
    if (!p || typeof p !== 'object') return p;
    let next = p;
    if (p.pdfRetrieval && typeof p.pdfRetrieval === 'object') next = { ...next, pdfRetrieval: retrievalRecord(p.pdfRetrieval) };
    if (p.screeningReview?.workbook) next = { ...next, screeningReview: { ...p.screeningReview, workbook: workbookRow(p.screeningReview.workbook) } };
    return next;
  });
  if (Array.isArray(st.workflowRuns)) st.workflowRuns = retainRuns(st.workflowRuns, st.workflows);
  st.trimmed = TRIM_VERSION;
  return st;
}

/** Whether the one-time trim would drop data a person might want back: imported sheet columns beyond the decisions, or completed runs past retention. */
export function trimWouldDrop(st) {
  if (!st || st.trimmed >= TRIM_VERSION) return false;
  const cut = w => w && typeof w === 'object' && !Array.isArray(w) && Object.keys(workbookRow(w)).length < Object.keys(w).length;
  if (Array.isArray(st.papers) && st.papers.some(p => cut(p?.screeningReview?.workbook))) return true;
  return Array.isArray(st.workflowRuns) && retainRuns(st.workflowRuns, st.workflows).length < st.workflowRuns.length;
}
