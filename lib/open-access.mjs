// Open access first (RESEARCH-GAPS R6): before the PDF retrieval tries the user's lookup URLs and mirrors, ask Unpaywall (keyless;
// it asks for a contact email, which is the Unpaywall email in Settings or else the contact email sent with PubMed requests, never a
// built-in one) and then OpenAlex (keyless) for a legal open-access copy of the DOI. The answer is kept on the record with its date
// (`p.openAccess`), so a second retrieval within 30 days asks nobody; every request is paced by lib/limiter.mjs. A copy is accepted
// only when the source's own record carries the same DOI. Nothing is downloaded here: the retrieval (lib/paper-download.mjs) tries
// the URL first, under the same rules as any other source, and the retrieval report says which papers had an open-access copy.
import { limited } from './limiter.mjs';

export const OA_FRESH_DAYS = 30;
const DAY = 864e5;
const UNPAYWALL = 'https://api.unpaywall.org/v2/';
const OPENALEX = 'https://api.openalex.org/works/https://doi.org/';

export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
export const doiKey = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();

const firstOf = (locations, field) => locations.map(l => (l && typeof l === 'object' ? l[field] : '')).find(u => typeof u === 'string' && /^https?:\/\//i.test(u)) || '';

/** Unpaywall's answer for `doi` as a location { source, url, pdf, license, version, host }, or null (closed, or another DOI). */
export function fromUnpaywall(doi, data) {
  if (!data || doiKey(data.doi) !== doiKey(doi) || data.is_oa === false) return null;
  const locations = [data.best_oa_location, ...(Array.isArray(data.oa_locations) ? data.oa_locations : [])].filter(Boolean);
  const pdf = firstOf(locations, 'url_for_pdf'), landing = firstOf(locations, 'url_for_landing_page') || firstOf(locations, 'url');
  if (!pdf && !landing) return null;
  const best = data.best_oa_location || locations[0] || {};
  return { source: 'Unpaywall', url: pdf || landing, pdf: Boolean(pdf), license: best.license || '', version: best.version || '', host: best.host_type || '' };
}

/** OpenAlex's work for `doi` the same way: its best open location's PDF, else open_access.oa_url, else the landing page. */
export function fromOpenAlex(doi, data) {
  if (!data || doiKey(data.doi) !== doiKey(doi) || data.open_access?.is_oa === false) return null;
  const best = data.best_oa_location || {};
  const pdf = firstOf([best], 'pdf_url'), oa = data.open_access?.oa_url || '', landing = firstOf([best], 'landing_page_url');
  const url = pdf || oa || landing;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { source: 'OpenAlex', url, pdf: Boolean(pdf) || /\.pdf(?:$|[?#])/i.test(oa), license: best.license || '', version: best.version || '', host: '' };
}

/**
 * Looks one DOI up: Unpaywall when there is an email, then OpenAlex when Unpaywall has no copy. Returns what is stored on the record:
 * { doi, at, found, source?, url?, pdf?, license?, version?, host?, checked: sources that answered, errors: sources that failed }.
 * A source that answers 404 has no record of the DOI ("not found", not an error). `fetchImpl` replaces the network (the tests);
 * `retries` is the limiter's, for a request that does not reach the host.
 */
export async function lookupOpenAccess(doi, { email = '', settings = {}, fetchImpl = (u, o) => fetch(u, o), now = () => new Date(), signal, retries = 3 } = {}) {
  const clean = doiKey(doi);
  const out = { doi: clean, at: now().toISOString(), found: false, checked: [], errors: [] };
  if (!clean) return out;
  const ask = async (name, url, headers, read) => {
    try {
      const r = await limited(url, u => fetchImpl(u, headers ? { signal, headers } : { signal }), { signal, retries });
      if (r.status === 404) { out.checked.push(name); return null; }
      if (!r.ok) { out.errors.push(`${name}: HTTP ${r.status}`); return null; }
      out.checked.push(name);
      return read(JSON.parse(await r.text()));
    } catch (err) { if (err?.name === 'AbortError') throw err; out.errors.push(`${name}: ${String(err?.message || err).slice(0, 80)}`); return null; }
  };
  let hit = null;
  if (validEmail(email)) hit = await ask('Unpaywall', `${UNPAYWALL}${encodeURIComponent(clean)}?email=${encodeURIComponent(String(email).trim())}`, null, d => fromUnpaywall(clean, d));
  if (!hit) {
    const key = String(settings?.openalexKey || '').trim();
    hit = await ask('OpenAlex', `${OPENALEX}${encodeURIComponent(clean)}?select=id,doi,open_access,best_oa_location`, key ? { Authorization: `Bearer ${key}` } : null, d => fromOpenAlex(clean, d));
  }
  return hit ? { ...out, found: true, ...hit } : out;
}

/** A stored lookup still stands: the same DOI, asked within `days`, and at least one source answered. */
export function oaFresh(p, { now = Date.now(), days = OA_FRESH_DAYS } = {}) {
  const r = p?.openAccess, at = Date.parse(r?.at || '');
  return Boolean(r && Number.isFinite(at) && now - at <= days * DAY && doiKey(r.doi) === doiKey(p.doi) && (r.found || r.checked?.length));
}

/** The URL the retrieval should try first for this record: a fresh, found open-access copy, else ''. */
export const oaUrl = p => (oaFresh(p) && p.openAccess.found ? p.openAccess.url : '');

/** Providers that hand out legal open copies (lib/paper-download.mjs names the open-access copy "Open access (Unpaywall)"). */
const OPEN = /^(Open access|Unpaywall|OpenAlex|PubMed Central|Europe PMC|arXiv|Semantic Scholar)/i;
export const isOpenProvider = provider => OPEN.test(String(provider || ''));

/** The retrieval report's open-access column: 'Open access' when a copy was found, 'Not found' when looked up without one, else ''. */
export function oaColumn(p) {
  const r = p?.openAccess;
  if (!r || doiKey(r.doi) !== doiKey(p.doi)) return '';
  return r.found ? 'Open access' : r.checked?.length ? 'Not found' : '';
}

/** What the open-access lookups found across these records: { looked, found, notFound, bySource }. */
export function oaSummary(papers = []) {
  const out = { looked: 0, found: 0, notFound: 0, bySource: {} };
  for (const p of papers) {
    const c = oaColumn(p); if (!c) continue;
    out.looked++;
    if (c === 'Open access') { out.found++; out.bySource[p.openAccess.source] = (out.bySource[p.openAccess.source] || 0) + 1; } else out.notFound++;
  }
  return out;
}

/**
 * The assistant's read (lib/chat-tools.mjs open_access_status): what the stored open-access lookups found, and the records whose PDF
 * was not retrieved with their finding; with `paper` (found by `find`), that record's lookup. Looks nothing up.
 */
export function openAccessStatusTool(s, { paper } = {}, find = () => null) {
  const papers = s.papers || [];
  const row = p => ({ id: p.id, label: p.label || '', doi: p.doi || null, open_access: oaColumn(p) || 'not looked up', source: p.openAccess?.found ? p.openAccess.source : undefined,
    url: p.openAccess?.found ? p.openAccess.url : undefined, looked: (p.openAccess?.at || '').slice(0, 10) || undefined, retrieved_from: p.pdfRetrieval?.status === 'preview' ? p.pdfRetrieval.provider : undefined });
  if (paper) {
    const p = find(paper, s);
    if (!p) throw new Error(`no record "${String(paper).slice(0, 60)}" in the library; use an id from query_library`);
    return row(p);
  }
  const sum = oaSummary(papers), failed = papers.filter(p => p.pdfRetrieval?.status === 'unavailable');
  return { looked_up: sum.looked, found: sum.found, not_found: sum.notFound, by_source: sum.bySource,
    with_doi_not_looked_up: papers.filter(p => p.doi && !oaColumn(p)).length,
    retrieved_open_access: papers.filter(p => p.pdfRetrieval?.status === 'preview' && isOpenProvider(p.pdfRetrieval.provider)).length,
    not_retrieved: failed.slice(0, 20).map(row), not_retrieved_total: failed.length,
    note: 'Lookups run with Download PDFs (Library) and are kept 30 days; Unpaywall, then OpenAlex.' };
}
