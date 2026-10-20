import { normalizeLanguage } from './languages.mjs';
// Bibliographic sources behind one interface.
//
// A review searches more than one database, and PRISMA separates databases from
// registers, so each source declares which it is; the flow diagram's
// `database_results` and `register_results` are then counted correctly rather
// than lumped together (plan B1, K1).
//
// Only sources that a browser can actually reach are listed. Embase needs an
// institutional key and a server to hold it, so it is absent rather than
// present and permanently failing — a source that cannot run is worse than no
// source, because a review would record an empty result as if it had searched.
// Web of Science and Scopus are searched in the user's own signed-in session
// instead (lib/site-search.mjs; plan 4.10a).
import { limited, budgetOf, closedUntilOf, nextMidnightUtc, reopen, AllowanceError } from './limiter.mjs';
import { aiRequestNative, inDesktop, inHostedTab, fetchTextNative } from './native.mjs';
import { authorList } from './bib.mjs';
import { doiQuery, doiRecords } from './doi.mjs';

// Served over http (the dev server) NCBI and EBI go through its /proxy/; the packaged app and an https tab call them
// directly. Both send access-control-allow-origin: * (eutils.ncbi.nlm.nih.gov and the Europe PMC REST API, measured
// 2026-10-18), so a hosted tab reaches them; the proxy predates that. The rest are CORS-clean and identical everywhere.
const dev = typeof location !== 'undefined' && location.protocol === 'http:';
const EUTILS = dev ? '/proxy/eutils' : 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EPMC = dev ? '/proxy/epmc' : 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const ZOTERO = dev && !inDesktop() ? '/proxy/zotero' : 'http://localhost:23119/api';   // Zotero's local API sends no CORS headers: an https tab cannot read it

// Every registry call is paced and retried by lib/limiter.mjs. In the packaged app the shell fetches EBI, as it did when
// EBI sent no CORS headers.
const raw = (signal, headers) => async url => {
  if (inDesktop() && url.startsWith('https://www.ebi.ac.uk/')) {
    try { return { ok: true, status: 200, text: async () => fetchTextNative(url) }; }
    catch (err) { return { ok: false, status: /429/.test(String(err)) ? 429 : 502, text: async () => String(err) }; }
  }
  return fetch(url, headers ? { signal, headers } : { signal });
};
const json = async (url, signal, headers) => {
  const r = await limited(url, raw(signal, headers), { signal });
  if (!r.ok) {
    // OpenAlex refuses with 429 once the day's allowance is spent; that is not a fault to retry but a wait to name.
    if (r.status === 429 && OPENALEX.test(url)) throw new AllowanceError('OpenAlex', closedUntilOf('OpenAlex') || budgetOf('OpenAlex')?.resetAt || nextMidnightUtc(), Boolean(headers));
    if (r.status === 401 && OPENALEX.test(url) && headers) throw new Error('OpenAlex did not accept the API key. Check it in Settings, Sources');
    throw new Error(`${r.status} ${r.statusText || ''}`.trim());
  }
  return JSON.parse(await r.text());
};

// ---- OpenAlex access ------------------------------------------------------
// Without a key OpenAlex answers a small daily allowance (1,000 credits when
// measured on 2026-09-29: a search page costs 10, a filtered list 1, one work
// by id 0); a free key raises it about tenfold. The key goes in the
// Authorization header, which the documentation gives as equal to the api_key
// parameter and which keeps it out of URLs, logs and error text. The
// `mailto` parameter changed neither limit nor cost when compared, so it is
// no longer sent.
const OPENALEX = /^https:\/\/api\.openalex\.org\//;
const OA = 'https://api.openalex.org';
const oaHeaders = settings => { const k = String(settings?.openalexKey || '').trim(); return k ? { Authorization: `Bearer ${k}` } : undefined; };
/** One OpenAlex GET: `path` like '/works', `params` an object. Paced by the shared limiter. */
export const openalexJson = (path, params, { settings, signal } = {}) => json(`${OA}${path}?${qs(params || {})}`, signal, oaHeaders(settings));
/** Credits each kind of OpenAlex request cost when measured; a search page is the dearest. */
export const OPENALEX_SEARCH_COST = 10;
/**
 * What is left of today's allowance, from the last answer seen; `probe` asks
 * for a fresh figure with a request that costs no credits (one work by id,
 * measured 2026-09-29). Answers { remaining, limit, searches, resetAt } or null.
 */
export async function openalexBudget({ settings, signal, probe = false } = {}) {
  if (probe || !budgetOf('OpenAlex')) {
    if (closedUntilOf('OpenAlex')) return budgetSummary();
    try { await json(`${OA}/works/W2741809807?${qs({ select: 'id' })}`, signal, oaHeaders(settings)); } catch (e) { if (e?.name === 'AllowanceError') return budgetSummary(); if (signal?.aborted) throw e; }
  }
  return budgetSummary();
}
function budgetSummary() {
  const b = budgetOf('OpenAlex'), until = closedUntilOf('OpenAlex');
  if (!b && !until) return null;
  const remaining = until ? 0 : b?.remaining;
  return { remaining, limit: b?.limit ?? null, searches: remaining == null ? null : Math.floor(remaining / OPENALEX_SEARCH_COST), resetAt: until || b?.resetAt || null, closed: Boolean(until) || remaining === 0 };
}
/** A key was added or removed: a closed day is forgotten and the figures are read again. */
export const openalexKeyChanged = () => reopen('OpenAlex');

const qs = o => new URLSearchParams(
  Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

const year = v => {
  const m = String(v ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
};

/**
 * Every source returns this shape, so the view never branches on the source.
 * The key is what decides whether two records are the same work, across
 * sources and across sessions: a DOI when there is one, then a PMID, then the
 * source's own id. The `pmid-` form predates multi-source search and is kept so
 * existing libraries still match.
 */
export function recordKey({ doi, pmid, fallback }) {
  if (doi) return `doi-${String(doi).replace(/^https?:\/\/doi\.org\//, '').toLowerCase()}`;
  if (pmid) return `pmid-${pmid}`;
  return fallback;
}

// Registries hand back XML-escaped text ("Neuropathology &amp; Experimental");
// a record stores the text itself.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const unescape = t => String(t || '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENT[e]);
const record = (r) => ({
  key: r.key,
  title: unescape(r.title).replace(/\s+/g, ' ').trim(),
  authors: authorList(r.authors).map(unescape),
  journal: unescape(r.journal),
  journalAbbr: unescape(r.journalAbbr || ''),
  year: r.year,
  doi: r.doi || '',
  pmid: r.pmid || '',
  url: r.url || '',
  abstract: r.abstract || '',
  source: r.source,
  language: normalizeLanguage(r.language),
  ...(r.zotero ? { zotero: r.zotero } : {}),
});

// ---- PubMed ---------------------------------------------------------------

async function pubmed(query, { offset, limit, settings, signal }) {
  const common = { db: 'pubmed', retmode: 'json', tool: 'Lykos',
    email: settings?.ncbiEmail || undefined, api_key: settings?.ncbiKey || undefined };
  const s = await json(`${EUTILS}/esearch.fcgi?${qs({ ...common,
    term: query, retmax: String(limit), retstart: String(offset) })}`, signal);
  const ids = s.esearchresult?.idlist || [];
  const total = Number(s.esearchresult?.count ?? 0);
  if (!ids.length) return { total, records: [] };
  const sum = await json(`${EUTILS}/esummary.fcgi?${qs({ ...common, id: ids.join(',') })}`, signal);
  const records = ids.map(id => sum.result?.[id]).filter(Boolean).map(d => record({
    key: recordKey({ doi: (d.articleids || []).find(a => a.idtype === 'doi')?.value, pmid: d.uid }),
    language: d.lang, title: d.title, authors: (d.authors || []).map(a => a.name),
    journal: d.fulljournalname || d.source, journalAbbr: d.source || '', year: year(d.pubdate),
    doi: (d.articleids || []).find(a => a.idtype === 'doi')?.value,
    pmid: d.uid, url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
    source: 'PubMed',
  }));
  return { total, records };
}

// ---- Europe PMC -----------------------------------------------------------

async function europepmc(query, { offset, limit, signal }) {
  const page = Math.floor(offset / limit) + 1;
  const d = await json(`${EPMC}/search?${qs({ query, format: 'json',
    pageSize: String(limit), page: String(page), resultType: 'core' })}`, signal);
  const list = d.resultList?.result || [];
  return {
    total: Number(d.hitCount ?? list.length),
    records: list.map(r => record({
      key: recordKey({ doi: r.doi, pmid: r.pmid, fallback: `epmc-${r.id}` }),
      language: r.language, title: r.title,
      authors: (r.authorList?.author || []).map(a => a.fullName || a.lastName).filter(Boolean),
      journal: r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher,
      journalAbbr: r.journalInfo?.journal?.isoabbreviation || r.journalInfo?.journal?.medlineAbbreviation || '',
      year: year(r.pubYear), doi: r.doi, pmid: r.pmid,
      url: r.doi ? `https://doi.org/${r.doi}`
        : `https://europepmc.org/article/${r.source}/${r.id}`,
      abstract: plainAbstract(r.abstractText),
      source: 'Europe PMC',
    })),
  };
}

// ---- Crossref -------------------------------------------------------------

async function crossref(query, { offset, limit, settings, signal }) {
  const d = await json(`https://api.crossref.org/works?${qs({ query,
    rows: String(limit), offset: String(offset),
    mailto: settings?.ncbiEmail || undefined })}`, signal);
  const items = d.message?.items || [];
  return {
    total: Number(d.message?.['total-results'] ?? items.length),
    records: items.map(r => record({
      key: recordKey({ doi: r.DOI }),
      language: r.language, title: (r.title || [])[0],
      authors: (r.author || []).map(a => [a.family, a.given].filter(Boolean).join(', ')),
      journal: (r['container-title'] || [])[0], journalAbbr: (r['short-container-title'] || [])[0] || '',
      year: r.issued?.['date-parts']?.[0]?.[0],
      doi: r.DOI, url: r.URL,
      abstract: plainAbstract(r.abstract),
      source: 'Crossref',
    })),
  };
}

// ---- OpenAlex -------------------------------------------------------------

/** OpenAlex keeps an abstract as word -> positions; put it back in reading order. */
export function openalexAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [w, at] of Object.entries(index)) for (const i of Array.isArray(at) ? at : []) if (Number.isInteger(i) && i >= 0 && i < 20000) words[i] = w;
  return words.filter(w => w != null).join(' ');
}
/** One OpenAlex work as the record every source returns. */
export const fromOpenAlexWork = (r, source = 'OpenAlex') => {
  const pmid = (r.ids?.pmid || '').split('/').pop();
  const doi = (r.doi || '').replace(/^https?:\/\/doi\.org\//, '');
  return record({
    key: recordKey({ doi: r.doi, pmid, fallback: `openalex-${String(r.id).split('/').pop()}` }),
    language: r.language, title: r.title || r.display_name,
    authors: (r.authorships || []).map(a => a.author?.display_name).filter(Boolean),
    journal: r.primary_location?.source?.display_name,
    year: r.publication_year, doi, pmid, url: r.doi || r.id,
    abstract: openalexAbstract(r.abstract_inverted_index),
    source,
  });
};
async function openalex(query, { offset, limit, settings, signal }) {
  const page = Math.floor(offset / limit) + 1;
  const d = await openalexJson('/works', { search: query, per_page: String(limit), page: String(page) }, { settings, signal });
  const items = d.results || [];
  return { total: Number(d.meta?.count ?? items.length), records: items.map(r => fromOpenAlexWork(r)) };
}

// ---- ClinicalTrials.gov ---------------------------------------------------

// A register, not a database. Its records are studies, not reports, so they
// carry a registration id where a citation would have a DOI.
const ctgPages = new Map();   // query -> nextPageToken, since the API is cursored

async function clinicaltrials(query, { offset, limit, signal, cursor }) {
  const token = offset ? (cursor === undefined ? ctgPages.get(query) : cursor) : undefined;
  if (offset && !token) return { total: 0, records: [] };
  const d = await json(`https://clinicaltrials.gov/api/v2/studies?${qs({
    'query.term': query, pageSize: String(limit), countTotal: 'true',
    pageToken: token })}`, signal);
  if (d.nextPageToken) ctgPages.set(query, d.nextPageToken);
  else ctgPages.delete(query);
  const studies = d.studies || [];
  return {
    total: Number(d.totalCount ?? studies.length),
    nextCursor: d.nextPageToken || null,
    records: studies.map(s => {
      const id = s.protocolSection?.identificationModule;
      const status = s.protocolSection?.statusModule;
      const sponsor = s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name;
      return record({
        key: `nct-${id?.nctId}`,
        title: id?.briefTitle || id?.officialTitle,
        authors: sponsor ? [sponsor] : [],
        journal: 'ClinicalTrials.gov',
        year: year(status?.startDateStruct?.date || status?.studyFirstSubmitDate),
        pmid: '', doi: '',
        url: `https://clinicaltrials.gov/study/${id?.nctId}`,
        abstract: s.protocolSection?.descriptionModule?.briefSummary,
        source: 'ClinicalTrials.gov',
      });
    }),
  };
}

// ---------------------------------------------------------------------------

export const SOURCES = [
  { id: 'pubmed',  name: 'PubMed',            kind: 'database', run: pubmed,
    hint: 'Enter keywords or paste your search strategy' },
  { id: 'epmc',    name: 'Europe PMC',        kind: 'database', run: europepmc,
    hint: 'Enter keywords or paste your search strategy' },
  { id: 'crossref', name: 'Crossref',         kind: 'database', run: crossref,
    hint: 'Search by topic, title, author or DOI' },
  { id: 'openalex', name: 'OpenAlex',         kind: 'database', run: openalex,
    hint: 'Search by topic, title, author or DOI' },
  { id: 'ctgov',   name: 'ClinicalTrials.gov', kind: 'register', run: clinicaltrials,
    hint: 'Search by condition, treatment or trial name' },
];

export const source = id => SOURCES.find(s => s.id === id) || SOURCES[0];

/** Run one source. Errors carry the source name, so a log entry names what failed. */
export { applyRates } from './limiter.mjs';   // the shell applies the pace without loading the sources

export async function runSearch(id, query, opts = {}) {
  const s = source(id);
  const doi = doiQuery(query);
  if (doi) {
    const records = await searchDoi(s, doi, opts);
    const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
    return { total: records.length, records: offset ? [] : records, source: s.name, kind: s.kind, match: 'exact-doi', doi };
  }
  const { total, records, nextCursor } = await s.run(query, {
    offset: 0, limit: 25, ...opts,
  });
  return { total, records, source: s.name, kind: s.kind, ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

// A DOI identifies one work. Relevance search can return unrelated records and
// a corpus-sized total even when the identifier is absent from the registry.
async function searchDoi(s, doi, opts) {
  let records;
  if (s.id === 'crossref') {
    const p = await lookupDoi(doi, opts);
    records = p ? [p] : [];
  } else if (s.id === 'openalex') {
    try {
      const work = await openalexJson(`/works/https://doi.org/${encodeURIComponent(doi)}`, {}, opts);
      records = work ? [fromOpenAlexWork(work)] : [];
    } catch (e) { if (/^404\b/.test(e.message)) return []; throw e; }
  } else if (s.id === 'pubmed' || s.id === 'epmc') {
    const escaped = doi.replace(/[\\"]/g, '\\$&');
    const query = s.id === 'pubmed' ? `"${escaped}"[aid]` : `DOI:"${escaped}"`;
    ({ records } = await s.run(query, { ...opts, offset: 0, limit: 25 }));
  } else {
    throw new Error('ClinicalTrials.gov searches trial registrations. Choose a scholarly database for a DOI lookup.');
  }
  return doiRecords(doi, records);
}


/**
 * An abstract delivered as markup — Europe PMC's <h4>Background</h4>…, or
 * Crossref's JATS <jats:title> and <jats:sec> — as plain text with each
 * section on its own line as "Label: text". Stripping the tags alone glued
 * each heading to the sentence after it ("BackgroundInterspinous…").
 */
export function plainAbstract(markup) {
  return String(markup || '')
    .replace(/<(?:h\d|jats:title|title)[^>]*>([\s\S]*?)<\/(?:h\d|jats:title|title)>\s*/gi, (_, t) => `\n${t.trim().replace(/[:.]$/, '')}: `)
    .replace(/<\/?(?:p|br|div|sec|jats:p|jats:sec)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n')
    .replace(/:\n/g, ': ').trim();   // a section title and its text on one line (the collapse above removed the space)
}

/**
 * The abstract for a record, from Europe PMC, which carries abstracts for
 * PubMed and many DOI-only works. Returns '' when it has none; never invents.
 */
export async function fetchAbstract(p, { signal } = {}) {
  const q = p.pmid ? `EXT_ID:${p.pmid} AND SRC:MED` : p.doi ? `DOI:"${p.doi}"` : null;
  if (!q) return '';
  const d = await json(`${EPMC}/search?${qs({ query: q, format: 'json', pageSize: '1', resultType: 'core' })}`, signal);
  const epmc = plainAbstract(d.resultList?.result?.[0]?.abstractText);
  if (epmc || !p.pmid) return epmc;
  // Europe PMC lags PubMed by days for new records; PubMed's own XML has it.
  const r = await limited(`${EUTILS}/efetch.fcgi?${qs({ db: 'pubmed', id: p.pmid, retmode: 'xml', tool: 'Lykos' })}`, raw(signal), { signal });
  if (!r.ok) return '';
  const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
  return [...xml.querySelectorAll('AbstractText')].map(n => {
    const label = n.getAttribute('Label'); return `${label ? `${label}: ` : ''}${n.textContent.trim()}`;
  }).join('\n').trim();
}


// ---- PubMed by identifier (seed records, related articles) ----------------
// Only queries and PMIDs leave the machine. Requests go through the same
// limiter as every other PubMed call (3 per second, 10 with a key).
const eutilsCommon = settings => ({ tool: 'Lykos', email: settings?.ncbiEmail || undefined, api_key: settings?.ncbiKey || undefined });
export const PUBMED_BATCH = 100;

/** PubMed records as XML for these PMIDs (efetch), 100 to a request. */
export async function pubmedXml(pmids, { settings, signal, onProgress } = {}) {
  const list = [...new Set(pmids.map(x => String(x).replace(/\D/g, '')).filter(Boolean))];
  let xml = '';
  for (let i = 0; i < list.length; i += PUBMED_BATCH) {
    const chunk = list.slice(i, i + PUBMED_BATCH);
    const r = await limited(`${EUTILS}/efetch.fcgi?${qs({ db: 'pubmed', retmode: 'xml', ...eutilsCommon(settings), id: chunk.join(',') })}`, raw(signal), { signal });
    if (!r.ok) throw new Error(`PubMed: HTTP ${r.status}`);
    xml += await r.text();
    onProgress?.(Math.min(list.length, i + PUBMED_BATCH), list.length);
  }
  return xml;
}

/** PMIDs a PubMed query finds, most recent first, up to `max`. */
export async function pubmedIds(term, { settings, signal, max = 200 } = {}) {
  const s = await json(`${EUTILS}/esearch.fcgi?${qs({ db: 'pubmed', retmode: 'json', ...eutilsCommon(settings), term, retmax: String(max) })}`, signal);
  return { ids: s.esearchresult?.idlist || [], total: Number(s.esearchresult?.count ?? 0), error: s.esearchresult?.ERROR ? String(s.esearchresult.ERROR) : '' };
}

/**
 * PubMed's related articles (ELink, neighbor_score) for each PMID: a Map of
 * PMID -> [{ id, score }] best first, `top` of each. One linkset per PMID
 * because they are sent as separate `id` parameters.
 */
export async function pubmedRelated(pmids, { settings, signal, top = 20, onProgress } = {}) {
  const out = new Map();
  const list = [...new Set(pmids.map(x => String(x).replace(/\D/g, '')).filter(Boolean))];
  for (let i = 0; i < list.length; i += PUBMED_BATCH) {
    const chunk = list.slice(i, i + PUBMED_BATCH);
    const params = new URLSearchParams({ dbfrom: 'pubmed', db: 'pubmed', cmd: 'neighbor_score', retmode: 'json', ...Object.fromEntries(Object.entries(eutilsCommon(settings)).filter(([, v]) => v)) });
    for (const id of chunk) params.append('id', id);
    const d = await json(`${EUTILS}/elink.fcgi?${params}`, signal);
    for (const ls of d.linksets || []) {
      const links = (ls.linksetdbs || []).find(x => x.linkname === 'pubmed_pubmed')?.links || [];
      const id = String((ls.ids || [])[0] || '');
      if (id) out.set(id, links.filter(l => String(l.id) !== id).slice(0, top).map(l => ({ id: String(l.id), score: Number(l.score) || 0 })));
    }
    onProgress?.(Math.min(list.length, i + PUBMED_BATCH), list.length);
  }
  return out;
}

// ---- identifying a paper -------------------------------------------------

/** One work by DOI, from Crossref. Null when Crossref has no such DOI. */
export async function lookupDoi(doi, { signal } = {}) {
  const clean = doiQuery(doi);
  if (!clean) throw new Error('Supply a valid DOI.');
  let d;
  try { d = await json(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, signal); }
  catch (e) { if (/^404\b/.test(e.message)) return null; throw e; }
  const r = d.message;
  if (!r || doiQuery(r.DOI) !== clean) return null;
  return record({
    key: recordKey({ doi: r.DOI }),
    language: r.language, title: (r.title || [])[0],
    authors: (r.author || []).map(a => [a.family, a.given].filter(Boolean).join(', ')),
    journal: (r['container-title'] || [])[0], journalAbbr: (r['short-container-title'] || [])[0] || '',
    year: r.issued?.['date-parts']?.[0]?.[0],
    doi: r.DOI, url: r.URL,
    abstract: plainAbstract(r.abstract),
    source: 'Crossref',
  });
}

/**
 * The best Crossref match for a title, or null. A match is accepted only when
 * the returned title is close to the one asked for: a loose hit would attach
 * the wrong paper to a file, which is worse than no match.
 */
export async function matchTitle(title, { signal, threshold = 0.82, settings } = {}) {
  if (!title || title.split(/\s+/).length < 3) return null;
  const { similarity } = await import('./pdfmeta.mjs');
  const pick = (cands, source) => {
    let best = null, score = 0;
    // A registry entry naming no author is not a paper (a dictionary entry, a
    // journal front matter); it never matches however close the title.
    for (const c of cands) {
      if (!(c.authors || []).some(a => String(a || '').trim())) continue;
      const sc = similarity(title, c.title || ''); if (sc > score) { score = sc; best = c; }
    }
    return best && score >= threshold ? { score, record: record({ ...best, source }) } : null;
  };
  // Three registries, in order of precision for a biomedical paper: PubMed's
  // title field, Crossref's bibliographic search, OpenAlex's search. Each
  // candidate must still match the title closely; a near miss is a miss.
  const attempts = [
    async () => {
      const common = { db: 'pubmed', retmode: 'json', tool: 'Lykos', email: settings?.ncbiEmail || undefined, api_key: settings?.ncbiKey || undefined };
      const s2 = await json(`${EUTILS}/esearch.fcgi?${qs({ ...common, term: `${title.replace(/["\[\]]/g, ' ')}[Title]`, retmax: '3' })}`, signal);
      const ids = s2.esearchresult?.idlist || [];
      if (!ids.length) return null;
      const sum = await json(`${EUTILS}/esummary.fcgi?${qs({ ...common, id: ids.join(',') })}`, signal);
      return pick(ids.map(id => sum.result?.[id]).filter(Boolean).map(d => ({
        key: recordKey({ doi: (d.articleids || []).find(a => a.idtype === 'doi')?.value, pmid: d.uid }),
        language: d.lang, title: d.title, authors: (d.authors || []).map(a => a.name), journal: d.fulljournalname || d.source, journalAbbr: d.source || '',
        year: year(d.pubdate), doi: (d.articleids || []).find(a => a.idtype === 'doi')?.value, pmid: d.uid,
        url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
      })), 'PubMed');
    },
    async () => {
      const d = await json(`https://api.crossref.org/works?${qs({ 'query.bibliographic': title, rows: '3', select: 'DOI,title,author,container-title,short-container-title,issued,URL' })}`, signal);
      return pick((d.message?.items || []).map(r => ({
        key: recordKey({ doi: r.DOI }), language: r.language, title: (r.title || [])[0],
        authors: (r.author || []).map(a => [a.family, a.given].filter(Boolean).join(', ')),
        journal: (r['container-title'] || [])[0], journalAbbr: (r['short-container-title'] || [])[0] || '', year: r.issued?.['date-parts']?.[0]?.[0], doi: r.DOI, url: r.URL,
      })), 'Crossref');
    },
    async () => {
      const d = await openalexJson('/works', { search: title, per_page: '3' }, { settings, signal });
      return pick((d.results || []).map(r => ({
        key: recordKey({ doi: r.doi, pmid: (r.ids?.pmid || '').split('/').pop(), fallback: `openalex-${String(r.id).split('/').pop()}` }),
        language: r.language, title: r.title || r.display_name, authors: (r.authorships || []).map(a => a.author?.display_name).filter(Boolean),
        journal: r.primary_location?.source?.display_name, year: r.publication_year,
        doi: (r.doi || '').replace(/^https?:\/\/doi\.org\//, ''), pmid: (r.ids?.pmid || '').split('/').pop(), url: r.doi || r.id,
      })), 'OpenAlex');
    },
  ];
  for (const attempt of attempts) {
    try { const m = await attempt(); if (m) return m; } catch { /* next registry */ }
  }
  return null;
}


const fromCrossref = r => record({
  key: recordKey({ doi: r.DOI }), language: r.language, title: (r.title || [])[0],
  authors: (r.author || []).map(a => [a.family, a.given].filter(Boolean).join(', ')),
  journal: (r['container-title'] || [])[0], journalAbbr: (r['short-container-title'] || [])[0] || '', year: r.issued?.['date-parts']?.[0]?.[0],
  doi: r.DOI, url: r.URL, abstract: plainAbstract(r.abstract), source: 'Crossref',
  volume: r.volume || '', issue: r.issue || '', pages: r.page || '',
});

/**
 * One work by volume, issue and first page, from PubMed. The triple alone is
 * not unique across journals, so the journal must agree with the slug the
 * publisher's URL used: the initials of its abbreviation, or its start.
 */
export async function lookupVip({ slug = '', volume, issue, page }, { signal, settings } = {}) {
  if (!volume || !page) return null;
  const common = { db: 'pubmed', retmode: 'json', tool: 'Lykos', email: settings?.ncbiEmail || undefined, api_key: settings?.ncbiKey || undefined };
  const term = [`${volume}[vi]`, issue ? `${issue}[ip]` : '', `${page}[pg]`].filter(Boolean).join(' AND ');
  // the triple is shared by dozens of journals; all of them come back and the slug decides
  const s2 = await json(`${EUTILS}/esearch.fcgi?${qs({ ...common, term, retmax: '150' })}`, signal);
  const ids = s2.esearchresult?.idlist || [];
  if (!ids.length || ids.length > 150) return null;
  const sum = await json(`${EUTILS}/esummary.fcgi?${qs({ ...common, id: ids.join(',') })}`, signal);
  const docs = ids.map(id => sum.result?.[id]).filter(Boolean);
  const fits = d => {
    if (!slug) return false;
    const abbr = String(d.source || '').toLowerCase();
    const initials = abbr.split(/\s+/).map(w => w[0]).join('');
    const squashed = abbr.replace(/[^a-z]/g, '');
    return initials === slug || squashed.startsWith(slug) || slug.startsWith(squashed);
  };
  const pick = docs.find(fits) || (docs.length === 1 ? docs[0] : null);
  if (!pick) return null;
  const doi = (pick.articleids || []).find(a => a.idtype === 'doi')?.value;
  return record({ key: recordKey({ doi, pmid: pick.uid }), title: pick.title, authors: (pick.authors || []).map(a => a.name),
    journal: pick.fulljournalname || pick.source, journalAbbr: pick.source || '', year: year(pick.pubdate), doi, pmid: pick.uid,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pick.uid}/`, volume: pick.volume || '', issue: pick.issue || '', pages: pick.pages || '', source: 'PubMed' });
}

/** Notices that update a work — retractions, corrections, expressions of concern — from Crossref. */
export async function crossrefUpdates(doi, { signal } = {}) {
  const clean = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const d = await json(`https://api.crossref.org/works?${qs({ filter: `updates:${clean}`, rows: '5', select: 'DOI,title,update-to,issued' })}`, signal);
  return (d.message?.items || []).map(r => ({
    type: (r['update-to'] || []).find(u => String(u.DOI || '').toLowerCase() === clean.toLowerCase())?.type || 'update',
    doi: r.DOI, title: (r.title || [])[0] || '', date: (r.issued?.['date-parts']?.[0] || []).join('-'),
  }));
}

/**
 * Zotero's local API (read-only; off by default — plan §4.7). Items of the
 * user's library, mapped to records with (libraryID, key, version) kept as
 * provenance. A 403 means the setting is off; a refused connection means
 * Zotero is not running.
 */
export async function zoteroItems({ limit = 100, start = 0, web = null } = {}) {
  // `web`: the online library (api.zotero.org, which answers a browser), by the person's user ID and a read-only key; the same items
  if (web) return zoteroMap(await (await import('./zotero-web.mjs')).zoteroWeb(web, { limit, start }));
  // /items/top: parent items only, so child notes and attachments never
  // arrive (a negated itemType filter did not exclude them; measured
  // 2026-09-19 against 1309 items). Standalone notes are dropped below. The
  // returned array carries `total`, the library's top-level count, so the
  // caller pages by it and not by how many records survived the filter.
  if (inHostedTab()) throw new Error('Zotero’s local library is read by the desktop app; a browser tab cannot reach it');
  const url = `${ZOTERO}/users/0/items/top?${qs({ format: 'json', limit: String(limit), start: String(start) })}`;
  let text, status, total;
  try {
    if (inDesktop()) { const r = await aiRequestNative(`zotero-${crypto.randomUUID()}`, url, { method: 'GET' }); status = r.status; text = r.text; total = Number(r.total); }
    else { const r = await fetch(url); status = r.status; text = await r.text(); total = Number(r.headers.get('total-results')); }
  } catch { throw new Error('Zotero is not running, or its local API is off (Settings → Advanced)'); }
  if (status === 403) throw new Error('Zotero: enable the local API (Settings → Advanced → Allow other applications on this computer to communicate with Zotero)');
  if (status !== 200) throw new Error(`Zotero: HTTP ${status}`);
  return zoteroMap({ items: JSON.parse(text), total });
}
/** Zotero items (the local and the online API answer alike) as records, with `total` the library's top-level count. */
function zoteroMap({ items, total }) {
  const out = items.filter(it => it.data && !/^(attachment|note|annotation)$/.test(it.data.itemType)).map(it => {
    const d = it.data;
    const doi = d.DOI || (d.extra || '').match(/DOI:\s*(10\.\S+)/i)?.[1] || '';
    const pmid = (d.extra || '').match(/PMID:\s*(\d+)/i)?.[1] || '';
    return record({
      key: recordKey({ doi, pmid, fallback: `zotero-${it.library?.id ?? 0}-${it.key}` }),
      title: d.title, authors: (d.creators || []).filter(c => c.creatorType !== 'editor').map(c => c.lastName ? `${c.lastName}, ${c.firstName || ''}`.trim() : c.name).filter(Boolean),
      language: d.language, journal: d.publicationTitle || d.bookTitle || '', journalAbbr: d.journalAbbreviation || '', year: year(d.date), doi, pmid,
      url: d.url || (doi ? `https://doi.org/${doi}` : ''), abstract: d.abstractNote || '', source: 'Zotero',
      volume: d.volume || '', issue: d.issue || '', pages: d.pages || '',
      zotero: { libraryID: it.library?.id ?? 0, key: it.key, version: it.version },
    });
  });
  out.total = Number.isFinite(total) ? total : items.length;
  return out;
}

/** Many DOIs in one call: a Map of lower-cased DOI -> record, for those found. */
export async function lookupDois(dois, { signal, settings } = {}) {
  const out = new Map();
  const list = [...new Set(dois.map(d => String(d).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const d = await json(`https://api.crossref.org/works?${qs({ filter: chunk.map(x => `doi:${x}`).join(','), rows: String(chunk.length),
      select: 'DOI,title,author,container-title,short-container-title,issued,URL,volume,issue,page', mailto: settings?.ncbiEmail || undefined })}`, signal);
    for (const r of d.message?.items || []) out.set(String(r.DOI).toLowerCase(), fromCrossref(r));
  }
  return out;
}

/** An Elsevier PII resolved through Crossref's alternative-id filter. */
export async function lookupPii(pii, { signal } = {}) {
  const d = await json(`https://api.crossref.org/works?${qs({ filter: `alternative-id:${pii}`, rows: '1',
    select: 'DOI,title,author,container-title,short-container-title,issued,URL,volume,issue,page' })}`, signal);
  const r = d.message?.items?.[0];
  return r ? fromCrossref(r) : null;
}

/** Bounded exact-identifier lookup for existing library language metadata. */
export async function lookupPaperLanguages(papers) {
  const doiOf = x => String(x || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase().trim();
  const pmidOf = p => String(p.pmid || /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/.exec(p.url || '')?.[1] || '');
  const clauses = papers.flatMap(p => p.doi ? [`DOI:"${doiOf(p.doi).replace(/["\\]/g,'')}"`] : /^\d+$/.test(pmidOf(p)) ? [`(EXT_ID:${pmidOf(p)} AND SRC:MED)`] : []);
  if (!clauses.length) return [];
  const data = await json(`${EPMC}/search?${qs({query:clauses.join(' OR '),format:'json',resultType:'core',pageSize:'1000'})}`);
  return papers.map(p => {
    const matches = (data.resultList?.result || []).filter(x => p.doi ? doiOf(x.doi) === doiOf(p.doi) : x.source === 'MED' && String(x.id) === pmidOf(p));
    const language = normalizeLanguage(matches.map(x => x.language).filter(Boolean));
    return {id:p.id,language};
  });
}
