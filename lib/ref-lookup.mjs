// Records completed, and records made, from the registries (plan B3).
//
// enrichRecords proposes the fields a record lacks — abstract, DOI, PMID,
// journal, year — from Crossref (by DOI) and PubMed (by PMID, or by DOI
// through PubMed's article-identifier search). It changes nothing: the
// proposals are shown, and applyEnrichment writes the accepted ones with an
// undo log (state.enrichLog), so a wrong fill can be taken back as a batch.
//
// recordsFromIdentifiers turns a pasted list (lib/ref-import-extra.mjs
// extractIdentifiers) into records: DOIs from Crossref, PMIDs from PubMed,
// PMCIDs through NCBI's ID converter, NCT numbers from ClinicalTrials.gov.
//
// Every request goes through lib/limiter.mjs, as lib/sources.mjs's do, unless
// `paced: false`. `fetchImpl` replaces fetch (tests pass fixtures through it).
import { limited } from './limiter.mjs';
import { plainAbstract, recordKey, PUBMED_BATCH } from './sources.mjs';
import { parseRecords } from './bib.mjs';
import { extraRecord, extractIdentifiers, normaliseType } from './ref-import-extra.mjs';
import { titleSimilarity, famKey, MATCH } from './reference-list.mjs';

// The dev server's /proxy/ over http; directly elsewhere, since eutils sends access-control-allow-origin: * (2026-10-18).
const dev = typeof location !== 'undefined' && location.protocol === 'http:';
const EUTILS = dev ? '/proxy/eutils' : 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const IDCONV = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';
const CROSSREF = 'https://api.crossref.org';
const CTGOV = 'https://clinicaltrials.gov/api/v2/studies';
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const cleanDoi = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);

function client({ fetchImpl, signal, paced = true } = {}) {
  const f = fetchImpl || ((url, init) => globalThis.fetch(url, init));
  const get = url => paced ? limited(url, u => f(u, signal ? { signal } : undefined), { signal }) : f(url, signal ? { signal } : undefined);
  return {
    async text(url) { const r = await get(url); if (!r.ok) { const e = new Error(`${r.status} ${r.statusText || ''}`.trim()); e.status = r.status; throw e; } return r.text(); },
    async json(url) { return JSON.parse(await this.text(url)); },
  };
}
const eutils = settings => ({ tool: 'Lykos', email: settings?.ncbiEmail || undefined, api_key: settings?.ncbiKey || undefined });

// ---- registry readers ----------------------------------------------------------
// plainAbstract leaves a JATS section title on its own line ("Purpose:\nText"):
// its ': \n' join runs after the spaces are gone. The label is joined here.
const crossrefAbstract = a => plainAbstract(a).replace(/^([^\n:]{1,40}):\n/gm, '$1: ');
/** A Crossref work as a record, with its type, publisher and ISBN kept. */
export function fromCrossrefWork(r) {
  const issued = r.issued?.['date-parts']?.[0]?.[0] ?? r['published-print']?.['date-parts']?.[0]?.[0] ?? r['published-online']?.['date-parts']?.[0]?.[0] ?? r.posted?.['date-parts']?.[0]?.[0];
  const type = r.type === 'posted-content' && r.subtype && r.subtype !== 'preprint' ? 'other' : r.type;
  return extraRecord({
    title: (r.title || [])[0], authors: (r.author || []).map(a => a.name || [a.family, a.given].filter(Boolean).join(', ')),
    journal: (r['container-title'] || [])[0] || (r.type === 'posted-content' ? r.institution?.[0]?.name || r['group-title'] : ''),
    journalAbbr: (r['short-container-title'] || [])[0], year: issued, volume: r.volume, issue: r.issue, pages: r.page,
    doi: r.DOI, url: r.URL, abstract: crossrefAbstract(r.abstract), language: r.language, publisher: r.publisher, isbn: (r.ISBN || [])[0],
    editors: (r.editor || []).map(a => [a.family, a.given].filter(Boolean).join(', ')),
    sourceType: type ? `CSL ${type}` : '', source: 'Crossref', raw: { type: r.type },
  });
}
/** A ClinicalTrials.gov v2 study as a 'trial-registration' record. */
export function fromCtgovStudy(s) {
  const ps = s?.protocolSection || {};
  const id = ps.identificationModule || {}, st = ps.statusModule || {};
  const nct = id.nctId;
  if (!nct) return null;
  const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor?.name;
  const rec = extraRecord({
    key: `nct-${nct}`, title: id.officialTitle || id.briefTitle, authors: sponsor ? [sponsor] : [], journal: 'ClinicalTrials.gov',
    year: st.studyFirstPostDateStruct?.date || st.studyFirstSubmitDate || st.startDateStruct?.date,
    abstract: ps.descriptionModule?.briefSummary, url: `https://clinicaltrials.gov/study/${nct}`, accession: nct,
    source: 'ClinicalTrials.gov', raw: null,
  });
  rec.type = 'trial-registration';
  if (id.briefTitle && id.officialTitle && id.briefTitle !== id.officialTitle) rec.shortTitle = id.briefTitle;
  if (st.overallStatus) rec.registryStatus = st.overallStatus;
  return rec;
}
/** PubMed efetch XML as records (lib/bib.mjs reads it), each with its publication types and type. */
function pubmedRecords(xml) {
  return parseRecords(xml, 'pubmed.xml').records.map(r => {
    const pubTypes = typeof r.raw === 'string' ? [...r.raw.matchAll(/<PublicationType\b[^>]*>([^<]+)<\/PublicationType>/g)].map(m => m[1].trim()) : [];
    const out = { ...r, source: 'PubMed', ...(pubTypes.length ? { pubTypes } : {}) };
    out.type = normaliseType(out);
    return out;
  });
}

async function crossrefByDoi(http, dois, settings) {
  const out = new Map();
  const list = [...new Set(dois.map(d => cleanDoi(d).toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const d = await http.json(`${CROSSREF}/works?${qs({ filter: chunk.map(x => `doi:${x}`).join(','), rows: String(chunk.length), mailto: settings?.ncbiEmail || undefined })}`);
    for (const r of d.message?.items || []) out.set(String(r.DOI).toLowerCase(), fromCrossrefWork(r));
  }
  return out;
}
async function pubmedByPmid(http, pmids, settings) {
  const out = new Map();
  const list = [...new Set(pmids.map(x => String(x).replace(/\D/g, '')).filter(Boolean))];
  for (let i = 0; i < list.length; i += PUBMED_BATCH) {
    const chunk = list.slice(i, i + PUBMED_BATCH);
    const xml = await http.text(`${EUTILS}/efetch.fcgi?${qs({ db: 'pubmed', retmode: 'xml', ...eutils(settings), id: chunk.join(',') })}`);
    for (const r of pubmedRecords(xml)) if (r.pmid) out.set(String(r.pmid), r);
  }
  return out;
}
/** PMIDs for DOIs: one search of PubMed's article identifiers per 20 DOIs, then each record's own DOI decides which is which. */
async function pmidsForDois(http, dois, settings) {
  const out = new Map();
  const list = [...new Set(dois.map(d => cleanDoi(d).toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const term = chunk.map(d => `"${d.replace(/"/g, '')}"[aid]`).join(' OR ');
    const s = await http.json(`${EUTILS}/esearch.fcgi?${qs({ db: 'pubmed', retmode: 'json', ...eutils(settings), term, retmax: String(chunk.length * 2) })}`);
    const ids = s.esearchresult?.idlist || [];
    if (!ids.length) continue;
    for (const r of (await pubmedByPmid(http, ids, settings)).values()) if (r.doi && chunk.includes(r.doi.toLowerCase())) out.set(r.doi.toLowerCase(), r);
  }
  return out;
}

// ---- enrichment ------------------------------------------------------------------
export const ENRICH_FIELDS = ['abstract', 'doi', 'pmid', 'journal', 'year', 'journalAbbr', 'volume', 'issue', 'pages', 'language'];

/**
 * Proposed fills for these records, applied to nothing:
 * [{ paperId, field, from, to, source }]. A field is proposed only where the
 * record lacks it, unless `overwrite` (then a differing value is proposed
 * too, and the reader decides). PubMed is preferred for abstract, journal and
 * year when both registries answer; Crossref for the DOI.
 */
export async function enrichRecords(papers, { fields = ['abstract', 'doi', 'pmid', 'journal', 'year'], fetchImpl, settings, signal, paced = true, overwrite = false, onProgress } = {}) {
  const http = client({ fetchImpl, signal, paced });
  const want = fields.filter(f => ENRICH_FIELDS.includes(f));
  const need = p => want.some(f => overwrite || empty(p[f]));
  const todo = (papers || []).filter(p => (p.doi || p.pmid) && need(p));
  const byDoi = await crossrefByDoi(http, todo.filter(p => p.doi).map(p => p.doi), settings);
  onProgress?.('Crossref');
  // PubMed by PMID, and by DOI for records that have no PMID yet
  const pmidOf = new Map(todo.filter(p => /^\d+$/.test(String(p.pmid || ''))).map(p => [p, String(p.pmid)]));
  const doiOnly = todo.filter(p => !pmidOf.has(p) && p.doi && (want.includes('pmid') || want.some(f => empty(p[f]) && f !== 'doi')));
  const pubmedFromDoi = doiOnly.length ? await pmidsForDois(http, doiOnly.map(p => p.doi), settings) : new Map();
  const byPmid = await pubmedByPmid(http, [...pmidOf.values()], settings);
  onProgress?.('PubMed');
  const changes = [];
  for (const p of todo) {
    const cr = p.doi ? byDoi.get(cleanDoi(p.doi).toLowerCase()) : null;
    const pm = pmidOf.has(p) ? byPmid.get(pmidOf.get(p)) : p.doi ? pubmedFromDoi.get(cleanDoi(p.doi).toLowerCase()) : null;
    for (const field of want) {
      const order = field === 'doi' ? [cr, pm] : [pm, cr];
      const hit = order.find(r => r && !empty(r[field]));
      if (!hit) continue;
      const to = String(hit[field]), from = p[field] ?? '';
      const same = field === 'doi' ? cleanDoi(from).toLowerCase() === cleanDoi(to).toLowerCase() : String(from).trim() === to.trim();
      if (same || (!overwrite && !empty(from))) continue;
      changes.push({ paperId: p.id || p.key, field, from, to, source: hit.source || (hit === cr ? 'Crossref' : 'PubMed') });
    }
  }
  return changes;
}

/**
 * Writes accepted proposals and logs them under `at` in state.enrichLog. A
 * proposal whose record has changed since (its field no longer holds `from`)
 * is skipped, not forced. Returns { applied, skipped }.
 */
export function applyEnrichment(state, changes, at = new Date().toISOString()) {
  const byId = new Map((state.papers || []).map(p => [p.id || p.key, p]));
  const done = []; let skipped = 0;
  for (const c of changes || []) {
    const p = byId.get(c.paperId);
    if (!p || !ENRICH_FIELDS.includes(c.field) || String(p[c.field] ?? '') !== String(c.from ?? '')) { skipped++; continue; }
    const had = Object.prototype.hasOwnProperty.call(p, c.field);
    p[c.field] = c.to;
    done.push({ paperId: c.paperId, field: c.field, from: c.from ?? '', to: c.to, source: c.source || '', ...(had ? {} : { absent: true }) });
  }
  if (done.length) state.enrichLog = [...(state.enrichLog || []), { at, changes: done }];
  return { applied: done.length, skipped };
}

/**
 * Takes back one applied batch (by its `at`; the latest not yet undone when
 * omitted). A field edited since the fill is left as it is and counted as
 * skipped. The log entry is kept, marked `undoneAt`.
 */
export function undoEnrichment(state, at, undoneAt = new Date().toISOString()) {
  const log = state.enrichLog || [];
  const entry = at ? log.find(e => e.at === at && !e.undoneAt) : [...log].reverse().find(e => !e.undoneAt);
  if (!entry) return { restored: 0, skipped: 0 };
  const byId = new Map((state.papers || []).map(p => [p.id || p.key, p]));
  let restored = 0, skipped = 0;
  for (const c of [...entry.changes].reverse()) {
    const p = byId.get(c.paperId);
    if (!p || String(p[c.field] ?? '') !== String(c.to)) { skipped++; continue; }
    if (c.absent) delete p[c.field]; else p[c.field] = c.from;
    restored++;
  }
  entry.undoneAt = undoneAt;
  return { restored, skipped };
}

// ---- records from identifiers ----------------------------------------------------
/**
 * Records for a list of identifiers: `ids` is extractIdentifiers' result, or
 * text to read it from. Returns the records (PubMed's where a PMID is known,
 * else Crossref's; registrations from ClinicalTrials.gov); the array's
 * `missing` lists [{ id, kind, reason }] for what was not found or not
 * looked up (ISBNs and other links have no registry here).
 */
export async function recordsFromIdentifiers(ids, { fetchImpl, settings, signal, paced = true } = {}) {
  const x = typeof ids === 'string' ? extractIdentifiers(ids) : { dois: [], pmids: [], pmcids: [], nctIds: [], isbns: [], urls: [], ...ids };
  const http = client({ fetchImpl, signal, paced });
  const missing = [];
  const pmids = [...x.pmids.map(String)], dois = [...x.dois];
  // PMCIDs become PMIDs (or DOIs) through the converter, 200 to a request
  for (let i = 0; i < x.pmcids.length; i += 200) {
    const chunk = x.pmcids.slice(i, i + 200);
    let d;
    try { d = await http.json(`${IDCONV}?${qs({ ids: chunk.join(','), format: 'json', idtype: 'pmcid', tool: 'Lykos', email: settings?.ncbiEmail || undefined })}`); }
    catch (e) { for (const id of chunk) missing.push({ id, kind: 'pmcid', reason: e.message }); continue; }
    for (const id of chunk) {
      const r = (d.records || []).find(rr => String(rr.pmcid || '').toUpperCase() === id.toUpperCase());
      if (r?.pmid) pmids.push(String(r.pmid));
      else if (r?.doi) dois.push(r.doi);
      else missing.push({ id, kind: 'pmcid', reason: r?.errmsg || 'not found' });
    }
  }
  const records = [], seen = new Set();
  const add = r => { const k = r.doi ? `doi:${r.doi.toLowerCase()}` : r.pmid ? `pmid:${r.pmid}` : r.key; if (!seen.has(k)) { seen.add(k); if (r.pmid) seen.add(`pmid:${r.pmid}`); if (r.doi) seen.add(`doi:${r.doi.toLowerCase()}`); records.push(r); } };
  const byPmid = pmids.length ? await pubmedByPmid(http, pmids, settings) : new Map();
  for (const id of [...new Set(pmids)]) { const r = byPmid.get(id); if (r) add(r); else missing.push({ id, kind: 'pmid', reason: 'not found' }); }
  const left = dois.filter(d => !seen.has(`doi:${cleanDoi(d).toLowerCase()}`));
  const byDoi = left.length ? await crossrefByDoi(http, left, settings) : new Map();
  for (const d of [...new Set(left.map(v => cleanDoi(v).toLowerCase()))]) { const r = byDoi.get(d); if (r) add(r); else missing.push({ id: d, kind: 'doi', reason: 'not found' }); }
  for (const nct of x.nctIds) {
    try {
      const r = fromCtgovStudy(await http.json(`${CTGOV}/${encodeURIComponent(nct)}?${qs({ format: 'json' })}`));
      if (r) add(r); else missing.push({ id: nct, kind: 'nct', reason: 'not found' });
    } catch (e) { missing.push({ id: nct, kind: 'nct', reason: e.status === 404 ? 'not found' : e.message }); }
  }
  for (const id of x.isbns) missing.push({ id, kind: 'isbn', reason: 'not looked up' });
  for (const id of x.urls) missing.push({ id, kind: 'url', reason: 'not looked up' });
  for (const r of records) if (!r.key) r.key = recordKey({ doi: r.doi, pmid: r.pmid });
  records.missing = missing;
  return records;
}

// ---- registry agreement (plan §4.11c) ----------------------------------------------
// The citation check (lib/reference-list.mjs) compares each typed reference with what
// its registry says: Crossref for a DOI (one works/{doi} request each, so a DOI that is
// not registered answers 404 and is told apart from a failed request), PubMed for a
// PMID, and a Crossref bibliographic query for an entry with neither, taken only when
// its top answer has the same title, first author and year. It runs only when a person
// asks; every answer is kept with its date, and a request that failed is not an answer:
// "not found" is said only of a 404 or a PMID PubMed did not return.
export const REGISTRY_DAYS = 30;
const datePart = d => (d?.['date-parts']?.[0] || []).filter(x => x != null).map((x, i) => (i ? String(x).padStart(2, '0') : String(x))).join('-');
const PUBMED_NOTICE = { RetractionIn: 'retraction', PartialRetractionIn: 'partial_retraction', ExpressionOfConcernIn: 'expression_of_concern', ErratumIn: 'erratum' };

/** What the check keeps of a Crossref work: the compared fields and its update notices (Crossref's `updated-by`, Retraction Watch included). */
export function workFromCrossref(m) {
  const issued = m.issued || m['published-print'] || m['published-online'] || m.posted;
  return {
    doi: String(m.DOI || '').toLowerCase(), title: (m.title || [])[0] || '', families: (m.author || []).slice(0, 3).map(a => a.family || a.name || '').filter(Boolean),
    // seven names: enough for a list that writes six and et al.
    names: (m.author || []).slice(0, 7).map(a => (a.family ? [a.family, a.given].filter(Boolean).join(', ') : a.name || '')).filter(Boolean),
    year: String(issued?.['date-parts']?.[0]?.[0] || ''), journal: (m['container-title'] || [])[0] || '', volume: m.volume || '', issue: m.issue || '', pages: m.page || '', type: m.type || '',
    notices: (m['updated-by'] || []).map(u => ({ type: u.type || 'update', doi: String(u.DOI || '').toLowerCase(), date: datePart(u.updated), source: u.source || 'crossref' })),
  };
}
/** The notices PubMed records against each article of an efetch answer: PMID → [{ type, pmid, source: 'pubmed' }]. */
export function pubmedNoticesOf(xml) {
  const out = new Map();
  for (const art of String(xml || '').split(/<PubmedArticle>/).slice(1)) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(art)?.[1];
    if (!pmid) continue;
    const list = [];
    for (const c of art.matchAll(/<CommentsCorrections\s+RefType="(\w+)"[^>]*>([\s\S]*?)<\/CommentsCorrections>/g)) {
      const type = PUBMED_NOTICE[c[1]];
      if (type) list.push({ type, pmid: /<PMID[^>]*>(\d+)<\/PMID>/.exec(c[2])?.[1] || '', source: 'pubmed' });
    }
    out.set(pmid, list);
  }
  return out;
}
const workFromPubmed = (r, notices = []) => ({
  doi: String(r.doi || '').toLowerCase(), title: r.title || '', families: authorFamilies(r.authors).slice(0, 3), names: (Array.isArray(r.authors) ? r.authors : []).slice(0, 7), year: String(r.year || ''), journal: r.journal || '',
  volume: r.volume || '', issue: r.issue || '', pages: r.pages || '', type: 'journal-article', notices });
const authorFamilies = authors => (Array.isArray(authors) ? authors : []).map(a => String(a).split(',')[0].trim()).filter(Boolean);

/** An answer still current: a found, missing or none answer younger than `days`. */
const fresh = (a, now, days) => a && (a.status === 'found' || a.status === 'missing' || a.status === 'none') && now - Date.parse(a.at || 0) < days * 864e5;

/**
 * Asks the registries about these entries (lib/reference-list.mjs entries, each with `rk`, its registry key).
 * Returns `{ answers, asked, failed }`: `answers` maps a registry key to `{ status, at, source, work? }` with status
 * 'found', 'missing' (a DOI Crossref answers 404 for, a PMID PubMed did not return) or 'none' (a bibliographic query
 * with no confident answer). A key answered within `days` is not asked again unless `force`. A failed request is
 * counted in `failed` and leaves no answer, so the next run asks again.
 */
export async function verifyIdentifiers(entries, { cache = {}, fetchImpl, settings, signal, paced = true, now = Date.now(), days = REGISTRY_DAYS, force = false, onProgress } = {}) {
  const http = client({ fetchImpl, signal, paced });
  const at = new Date(now).toISOString();
  const want = new Map();
  for (const e of entries || []) if (e.rk && !want.has(e.rk) && (force || !fresh(cache[e.rk], now, days))) want.set(e.rk, e);
  const answers = {}; let asked = 0, failed = 0, done = 0;
  const tick = () => onProgress?.(++done, want.size);
  // PMIDs: one efetch per batch
  const pmids = [...want.keys()].filter(k => k.startsWith('pmid:')).map(k => k.slice(5));
  for (let i = 0; i < pmids.length; i += PUBMED_BATCH) {
    const chunk = pmids.slice(i, i + PUBMED_BATCH);
    asked++;
    let xml;
    try { xml = await http.text(`${EUTILS}/efetch.fcgi?${qs({ db: 'pubmed', retmode: 'xml', ...eutils(settings), id: chunk.join(',') })}`); }
    catch (err) { if (signal?.aborted) throw err; failed += chunk.length; chunk.forEach(tick); continue; }
    const notices = pubmedNoticesOf(xml);
    const recs = new Map(pubmedRecords(xml).filter(r => r.pmid).map(r => [String(r.pmid), r]));
    for (const id of chunk) {
      const r = recs.get(id);
      answers[`pmid:${id}`] = r ? { status: 'found', at, source: 'PubMed', work: workFromPubmed(r, notices.get(id) || []) } : { status: 'missing', at, source: 'PubMed' };
      tick();
    }
  }
  for (const [key, e] of want) {
    if (key.startsWith('pmid:')) continue;
    asked++;
    try {
      if (key.startsWith('doi:')) {
        const d = await http.json(`${CROSSREF}/works/${encodeURIComponent(key.slice(4))}?${qs({ mailto: settings?.ncbiEmail || undefined })}`);
        answers[key] = { status: 'found', at, source: 'Crossref', work: workFromCrossref(d.message || {}) };
      } else {
        const q = [e.first, e.title, e.year].filter(Boolean).join(' ');
        const d = await http.json(`${CROSSREF}/works?${qs({ 'query.bibliographic': q.slice(0, 300), rows: '3', mailto: settings?.ncbiEmail || undefined })}`);
        const hit = (d.message?.items || []).map(workFromCrossref).find(w => titleSimilarity(e.title, w.title) >= MATCH.SAME
          && (!e.first || !w.families[0] || famKey(e.first) === famKey(w.families[0]))
          && (!e.year || !w.year || Math.abs(Number(e.year) - Number(w.year)) <= MATCH.YEAR_SLACK));
        answers[key] = hit ? { status: 'found', at, source: 'Crossref', work: hit, query: true } : { status: 'none', at, source: 'Crossref', query: true };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err.status === 404 && key.startsWith('doi:')) answers[key] = { status: 'missing', at, source: 'Crossref' };
      else failed++;
    }
    tick();
  }
  return { answers, asked, failed };
}

// ---- a reference selected in a document (plan §3, "Citation lookup on a selected reference") ----------------------------------------------
// Crossref's bibliographic query for the text of one reference, or its own record when the text carries a DOI. It runs only when a person asks
// (the reader's More › Look up reference), changes nothing, and never throws: a failed request is a short status, not an answer. The matches are
// Crossref's own ordering, the first few; which of them is the reference is the reader's call, and nothing is added until Add to library.
export const LOOKUP_ROWS = 3;
const lookupFailure = err => (err?.status === 429 ? 'Crossref is busy; try again later' : err?.status ? `Crossref answered ${err.status}` : 'Could not reach Crossref');

/**
 * What a match shows: the title, then its byline (first authors), its journal and year, and its DOI. A line with nothing in it is left out.
 * `m` is a match of lookupReference.
 */
export function describeMatch(m) {
  const r = m?.record || {};
  const names = (r.authors || []).map(a => String(a).split(',')[0].trim()).filter(Boolean);
  const byline = names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
  return { title: r.title || 'Untitled', detail: [byline, [r.journal, r.year].filter(Boolean).join(' · '), r.doi ? `DOI ${r.doi}` : ''].filter(Boolean) };
}

/**
 * The best Crossref matches for the text of a reference: `{ matches: [{ record, doi }], status }`. `record` is a library record
 * (fromCrossrefWork, with its key); `status` is '' when there are matches, else the short reason there are none ('No match found', 'Select the
 * whole reference', 'Could not reach Crossref'). A DOI in the text is asked for by itself first; one Crossref does not know falls back to the
 * words. An aborted request answers `{ matches: [], status: '', aborted: true }`.
 */
export async function lookupReference(text, { fetchImpl, settings, signal, paced = true, rows = LOOKUP_ROWS } = {}) {
  const words = String(text || '').replace(/\s+/g, ' ').trim();
  if (words.replace(/[^\p{L}\p{N}]/gu, '').length < 12) return { matches: [], status: 'Select the whole reference' };
  const http = client({ fetchImpl, signal, paced }), mailto = settings?.ncbiEmail || undefined;
  try {
    let items = null;
    const doi = cleanDoi(extractIdentifiers(words).dois[0]);
    if (doi) {
      try { items = [(await http.json(`${CROSSREF}/works/${encodeURIComponent(doi)}?${qs({ mailto })}`)).message]; }
      catch (err) { if (err?.status !== 404) throw err; }
    }
    if (!items) items = (await http.json(`${CROSSREF}/works?${qs({ 'query.bibliographic': words.slice(0, 300), rows: String(rows), mailto })}`)).message?.items || [];
    const matches = items.filter(w => w && (w.title || [])[0]).slice(0, rows).map(w => {
      const record = fromCrossrefWork(w);
      record.key = recordKey({ doi: record.doi }) || record.key;
      return { record, doi: record.doi || '' };
    });
    return { matches, status: matches.length ? '' : 'No match found' };
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') return { matches: [], status: '', aborted: true };
    return { matches: [], status: lookupFailure(err) };
  }
}
