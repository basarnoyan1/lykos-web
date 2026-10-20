import { retrievalRecord } from './project-trim.mjs';
import { requestPreview } from './preview-request.mjs';
import { matchesRetrievedPdf } from './pdf-identity.mjs';
import { get, update, projects } from '../store.mjs';
import { getBytes } from './files.mjs';
import { inDesktop, unpaywallEmailNative } from './native.mjs';
import { cachePreview, previewBytes, previewArticle, discardTextPreview } from './preview-cache.mjs';
import { loadPdf } from './anchor.mjs';
import { activePdfSources } from './pdf-sources.mjs';
import { lookupOpenAccess, oaFresh, oaUrl } from './open-access.mjs';
import { settingsOf } from './app-settings.mjs';
import { listeners, onDownloadProgress } from './download-progress.mjs';

const pending = new Map();
let lane = Promise.resolve();
export { onDownloadProgress };
const notify = () => { for (const fn of listeners) fn(); };
export const downloadingPaper = id => pending.has(`${projects().current}:${id}`);
export const canRetrievePaper = p => Boolean(p?.doi || p?.pmid || p?.url || p?.pdfUrl || p?.title);

export function previewError(error) {
  let data; try { data = JSON.parse(String(error?.message || error)); } catch {}
  if (!data?.code) {
    const reason = String(error?.message || error);
    const code = /timed out|timeout/i.test(reason) ? 'TIMEOUT' : /32 MB|limit exceeded/i.test(reason) ? 'PREVIEW_TOO_LARGE' : /setup|installation|Cannot start/i.test(reason) ? 'PREVIEW_SETUP_ERROR' : /invalid PDF/i.test(reason) ? 'INVALID_PDF' : 'PREVIEW_ERROR';
    return `${code} — ${reason}`;
  }
  const seen = new Set(), rows = [];
  for (const a of data.attempts || []) {
    let host = a.source; try { host = new URL(a.source).hostname; } catch {}
    const code = a.code || (/\b(\d{3}) (?:Client|Server) Error/.exec(a.error || '')?.[1] ? 'HTTP_' + /\b(\d{3}) (?:Client|Server) Error/.exec(a.error)[1] : 'SOURCE_ERROR');
    const row = `${host}: ${code} — ${a.reason || a.error || 'Unavailable'}`;
    if (!seen.has(`${host}:${code}`)) { seen.add(`${host}:${code}`); rows.push(row); }
  }
  return `${data.code} — ${data.reason}\n${rows.join('\n')}`;
}

export function browserPreviewSources(error) {
  let data; try { data = JSON.parse(String(error?.message || error)); } catch { return []; }
  const urls = new Set();
  for (const attempt of data.attempts || []) {
    if (attempt.code !== 'ACCESS_CHALLENGE') continue;
    try {
      const url = new URL(attempt.source);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) urls.add(url.href);
    } catch {}
  }
  return [...urls].slice(0, 4);
}

/** Keep available PDFs; recover missing attachments without touching decisions. */
export async function retrievePaper(id, { allowText = false, isWanted = () => true } = {}) {
  const project = projects().current, key = `${project}:${id}`;
  if (pending.has(key)) {
    try { return await pending.get(key); }
    catch (error) { if (error.name !== 'AbortError' || !isWanted()) throw error; }
    return retrievePaper(id, { allowText, isWanted });
  }
  const paper = get().papers.find(p => p.id === id);
  if (!paper) throw new Error('Record no longer exists');
  const identity = () => JSON.stringify(['doi','title','url','pdfUrl','pmid','year'].map(k => paper[k] || ''));
  const requestedIdentity = identity();
  const current = () => projects().current === project && get().papers.find(p => p.id === id) === paper && identity() === requestedIdentity;
  const task = (async () => {
    const usable = async () => {
      if (previewBytes(id)) return true; // Cached PDFs already passed identity validation.
      const existing = await getBytes(id).catch(() => null);
      if (!existing) return false;
      try { const parsed = await loadPdf(existing); await parsed.doc.destroy?.(); return true; }
      catch { return false; }
    };
    if (!allowText) discardTextPreview(id);
    if ((allowText ? previewArticle(id) : await usable())) return;
    if (!inDesktop()) throw new Error('Open the desktop app to retrieve papers');
    if (!canRetrievePaper(paper)) throw new Error('Add a title, DOI or source link first');
    // Open access first (lib/open-access.mjs): a legal copy found by Unpaywall or OpenAlex is the first URL the shell tries.
    if (!allowText && paper.doi && !paper.pdfUrl && !paper.pdf_url && !oaFresh(paper)) {
      const cfg = settingsOf(get());
      const email = (await unpaywallEmailNative().catch(() => '')) || String(cfg.ncbiEmail || '');
      const found = await lookupOpenAccess(paper.doi, { email, settings: cfg }).catch(() => null);
      if (found && (found.found || found.checked.length) && current()) update(s => { paper.openAccess = found; return s; });
    }
    const open = allowText ? '' : oaUrl(paper);
    const request = Object.fromEntries(['doi', 'title', 'url', 'pmid', 'year'].map(k => [k, String(paper[k] || '')]));
    request.allowText = allowText;
    request.scihubMirror = String(get().settings?.scihubMirror || '');
    request.scidbMirror = String(get().settings?.scidbMirror || '');
    request.pdfSources = activePdfSources(get().settings?.pdfSources);
    const previous = paper.pdfRetrieval?.url || '';
    request.pdfUrl = String(allowText ? (/fullTextXML/.test(previous) ? previous : '') : paper.pdfUrl || paper.pdf_url || open || (!/fullTextXML/.test(previous) ? previous : '') || '');
    const operation = lane.then(async () => {
      const rejectedUrls = [];
      // Each rejected document lets the native resolver advance to the next
      // source. Leave room for every configured source and the built-ins.
      for (let attempt = 0; attempt < Math.min(16, request.pdfSources.length + 3); attempt++) {
        if (!isWanted()) { const error = new Error('Preview changed'); error.name = 'AbortError'; throw error; }
        if (!current()) throw new Error('Review changed; retry in the original review');
        const found = await requestPreview({ ...request, rejectedUrls }, { isWanted: () => isWanted() && current() });
        if (found.article) return found;
        const parsed = await loadPdf(new Uint8Array(found.bytes));
        let matches;
        try { matches = await matchesRetrievedPdf(parsed.doc, paper); }
        finally { await parsed.doc.destroy?.(); }
        if (matches) { found.verifiedHash = parsed.hash; return found; }
        const url = found.provenance?.url;
        if (url && !rejectedUrls.includes(url)) rejectedUrls.push(url);
        else break;
      }
      throw new Error(JSON.stringify({ code: 'PDF_IDENTITY_UNCONFIRMED', reason: 'PDFs were found, but their title or DOI could not be matched to this paper. Scanned or translated papers may need manual review.', attempts: rejectedUrls.map(source => ({ source, code: 'PDF_IDENTITY_UNCONFIRMED', reason: 'Document identity could not be confirmed' })) }));
    });
    lane = operation.catch(() => {});
    const result = await operation;
    const bytes = new Uint8Array(result.bytes);
    let hash = null;
    if (!result.article) {
      if (result.verifiedHash) hash = result.verifiedHash;
      else { const parsed = await loadPdf(bytes); hash = parsed.hash; await parsed.doc.destroy?.(); }
    }
    if (!current()) throw new Error('Review changed during download; retry');
    if (!allowText) discardTextPreview(id);
    if ((allowText ? previewArticle(id) : await usable())) return;
    if (!current()) throw new Error('Review changed during download; retry');
    cachePreview(id, result.article ? null : bytes, result.article);
    update(s => {
      Object.assign(paper, {
        // the shell names the first URL "Source"; when that URL was the open-access copy, the report says so
        pdfRetrieval: { ...result.provenance, provider: open && request.pdfUrl === open && result.provenance?.provider === 'Source' ? `Open access (${paper.openAccess.source})` : result.provenance?.provider || 'PyPaperBot',
          doi: result.provenance?.doi || request.doi, hash, status: 'preview', at: new Date().toISOString() } });
      return s;
    });
  })();
  pending.set(key, task); notify();
  try { await task; }
  catch (e) {
    if (current() && e.name !== 'AbortError') update(s => { paper.pdfRetrieval = retrievalRecord({ ...(paper.pdfRetrieval || {}), status: 'unavailable', error: previewError(e), browserSources: browserPreviewSources(e), at: new Date().toISOString() }); return s; });
    if (e.name === 'AbortError') throw e;
    throw new Error(previewError(e));
  } finally { pending.delete(key); notify(); }
}
