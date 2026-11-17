// Is this the same work? (31 Oct 2026) The import-time matcher that decides whether a record a file brings is one the library
// already holds when no exact identifier joins them: the sham review's Scopus v3 import added 143 records that PubMed, Web of
// Science or a citation search had already brought, because their DOIs were spelt differently (case, a doi.org prefix, a
// trailing full stop, a publisher's two prefixes, an Elsevier PII's "S"), a capitalised Web of Science title or a bracketed
// PubMed translation read as another title, the first author was written "Kuban, K C" in one and "Kuban, K.C.K." in the other,
// or the PMID sat in Scopus's C2 field. Each rule below is narrow on purpose: a companion report, an erratum, a preprint beside its
// article, a conference abstract beside its article and a duplicate publication in another journal stay apart.
import { lib_bib_names$authorList as authorList } from "../boot.mjs";
import { trialIdsOf } from './trial-ids.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hyphen: '-' };
/** HTML character references (&amp;, &#946;, &#x3b2;) as the characters they stand for. */
export const decodeEntities = v => String(v ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});

/**
 * A DOI as one spelling: no resolver prefix (https://doi.org/, dx.doi.org, doi:), no HTML or URL escapes, lower case (DOIs are
 * case-insensitive), no white space, no trailing full stop, comma or semicolon, and no closing bracket the DOI did not open
 * ("10.1016/0304-3959(76)90111-1" keeps its own). SICI DOIs keep their <, > and ; inside.
 */
export function normDoi(value) {
  let d = decodeEntities(value).trim();
  if (!d) return '';
  if (/%[0-9a-f]{2}/i.test(d)) { try { d = decodeURIComponent(d); } catch { /* left as written */ } }
  d = d.toLowerCase().replace(/\s+/g, '').replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//, '').replace(/^(?:doi|urn:doi)[:/]/, '');
  const at = d.indexOf('10.');
  if (at > 0 && at < 12) d = d.slice(at);
  for (;;) {
    const before = d;
    d = d.replace(/[.,;:'"]+$/, '');
    const unbalanced = (o, c) => d.endsWith(c) && (d.split(o).length - 1) < (d.split(c).length - 1);
    if (unbalanced('(', ')') || unbalanced('[', ']')) d = d.slice(0, -1);
    if (d === before) break;
  }
  return /^10\.\d{3,}\//.test(d) ? d : '';
}
/**
 * The DOI's suffix with its punctuation dropped: "jpn.JPN_112_17" and "jpn.jpn-112-17" (Scopus), Neurosurgery's 10.1097 and 10.1227
 * prefixes for one article, and an Elsevier PII with and without its "S" ("s0008-6363(96)88640-8") read alike. Only a match with
 * the title's agreement counts (sameWork); a short suffix is too common to compare.
 */
export function looseDoi(value) {
  const d = normDoi(value);
  if (!d) return '';
  const suffix = d.slice(d.indexOf('/') + 1).replace(/^s(?=\d{4}-?\d{3}[\dx])/, '').replace(/[^a-z0-9]+/g, '');
  return suffix.length >= 8 ? suffix : '';
}

const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', κ: 'kappa', λ: 'lambda', μ: 'mu', π: 'pi', σ: 'sigma', τ: 'tau', ω: 'omega' };
const LANGUAGE_NOTE = /\s*\((?:authors?'?s? transl\.?|author's translation|[a-z]+ (?:text|abstract)|in [a-z]+|japanese|german|french|spanish|russian|chinese|italian|portuguese|polish|dutch|czech|hungarian|turkish|korean|danish|swedish|norwegian|finnish|croatian|serbian|romanian|greek|hebrew|persian|arabic)\)\s*$/i;
/**
 * A title as words: HTML entities and tags out, Greek letters spelt, accents dropped, lower case, apostrophes out ("Parkinson's" and
 * Web of Science's "PARKINSONS" alike), PubMed's brackets round a translated title and its trailing full stop out, a closing
 * language note ("(author's transl)", "(Japanese)") out, a leading article out, punctuation as spaces.
 */
export function normTitle(value) {
  let t = decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/[αβγδεθκλμπστω]/g, c => ` ${GREEK[c]} `);
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (let i = 0; i < 3; i++) t = t.replace(/[\s.]+$/, '').replace(LANGUAGE_NOTE, '').replace(/^\[(.*)\]$/s, '$1').trim();
  t = t.replace(/['’‘`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return t.replace(/^(?:the|a|an) /, '');
}
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'with', 'by', 'at', 'from', 'as', 'its', 'is', 'are', 'vs', 'versus']);
const stem = w => w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const wordSet = t => new Set(t.split(' ').filter(w => w && !STOP.has(w)).map(stem));
function dice(x, y) {
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return 2 * n / (x.size + y.size);
}
function editRatio(a, b) {
  if (a === b) return 1;
  if (!a || !b || Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.1) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
// a title that announces a notice about another paper: never the paper itself
const NOTICE = /^(?:erratum|errata|corrigendum|corrigenda|correction|retraction|retracted|expression of concern|withdrawn|reply|response|author'?s'? reply|authors reply|in reply|comment on|comments on|re:|letter to the editor regarding)\b/;

const SUFFIX = /^(?:jr|sr|ii|iii|iv|2nd|3rd|4th)\.?$/i;
/**
 * The first author's family name as comparable keys: the name before the comma ("Kuban, K.C.K."), else without trailing initials
 * ("Kuban KC", "Baryl'nik IuB"), and a name of several words gives each long word too ("Sanchez Castro" meets "Castro",
 * "Ingrid Goh" meets "Goh"); suffixes (Jr, 3rd) and accents out, hyphens and apostrophes closed up ("Schrander-Stumpel").
 */
export function surnameKeys(authors) {
  const name = String(authorList(authors)[0] || '').trim();
  if (!name) return [];
  let words;
  if (name.includes(',')) words = name.split(',')[0].trim().split(/\s+/);
  else {
    words = name.split(/\s+/);
    // trailing initials: "KC", "IuB" (a transliterated Iu), "K.C.", or a suffix
    const initialsLike = w => SUFFIX.test(w) || /^[A-Z]{1,4}$/.test(w) || /^(?:[A-Z][a-z]?\.?){2,3}$/.test(w) && /[A-Z].*[A-Z]/.test(w) || /^(?:[A-Z]\.-?){1,4}$/.test(w);
    while (words.length > 1 && initialsLike(words.at(-1))) words.pop();
  }
  words = words.filter(w => !SUFFIX.test(w));
  const flat = w => w.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const keys = new Set([flat(words.join(''))]);
  if (words.length > 1) for (const w of words) if (flat(w).length >= 3) keys.add(flat(w));
  keys.delete('');
  return [...keys];
}

const rawField = (p, tag) => (Array.isArray(p.raw) ? p.raw : []).filter(l => typeof l === 'string' && l.startsWith(tag)).map(l => l.slice(tag.length).replace(/^\s*-\s?/, '').trim());
/** The record's PMID: its own, PubMed's accession, or Scopus's C2 field (where its RIS writes the PubMed ID). */
export function pmidOf(p) {
  const own = String(p.pmid ?? '').trim().replace(/^pmid:\s*/i, '');
  if (/^\d+$/.test(own)) return own;
  const acc = String(p.accession ?? '').trim();
  if (/^pmid:\s*\d+$/i.test(acc)) return acc.replace(/\D/g, '');
  if (/^\d+$/.test(acc) && /pubmed|medline/i.test(String(p.database || p.source || ''))) return acc;
  const key = String(p.key || p.id || '');
  if (/^pmid-\d+$/.test(key)) return key.slice(5);
  const c2 = rawField(p, 'C2  ')[0];
  if (c2 && /^\d{1,9}$/.test(c2) && (/scopus/i.test(String(p.database || '')) || rawField(p, 'DB  ').some(v => /scopus/i.test(v)))) return c2;
  const pm = rawField(p, 'PMID')[0];
  return pm && /^\d+$/.test(pm) ? pm : '';
}
/** Conference paper or abstract, notice (erratum, retraction), or article, from the RIS type, Scopus's document type and PubMed's publication types. */
export function kindOf(p) {
  const types = [p.type, p.publicationType, ...(Array.isArray(p.publicationTypes) ? p.publicationTypes : []), ...rawField(p, 'TY  '), ...rawField(p, 'M3  '), ...rawField(p, 'PT  ')]
    .map(v => String(v || '').toLowerCase()).filter(Boolean);
  if (types.some(t => /erratum|correction|retraction|corrigend|expression of concern/.test(t))) return 'notice';
  if (types.some(t => /^(?:conf|cpaper|abst)$|conference|proceeding|congress|meeting abstract|^abstract$/.test(t))) return 'conference';
  return 'article';
}
const PREPRINT_DOI = /^10\.(?:1101|21203|2139|48550|20944|31219|31234|31235|31222|64898)\//;
/** A preprint server's record (medRxiv, bioRxiv, Research Square, SSRN, arXiv, Preprints.org, Europe PMC's PPR ids). */
export const isPreprint = p => PREPRINT_DOI.test(normDoi(p.doi)) || /^(?:epmc-)?PPR\d+$/i.test(String(p.id || p.key || ''))
  || /\b(?:medrxiv|biorxiv|research square|ssrn|arxiv|preprints?(?:\.org)?|psyarxiv|osf preprints)\b/i.test(String(p.journal || ''));
const firstNumber = v => { const m = /\d+/.exec(String(v ?? '')); return m ? Number(m[0]) : null; };
/** The start page as a number: the last run of digits before the range's dash ("III44-6" 44, "7S111" 111, "CS29-32" 29, "1423-28; discussion" 1423). */
export function startPage(v) {
  const first = String(v ?? '').trim().split(/[-–—,;\s]/)[0];
  const runs = first.match(/\d+/g);
  return runs ? Number(runs.at(-1)) : null;
}

const cache = new WeakMap();
/** What the comparison reads from a record, worked out once per record (and again when its identifying fields change). */
export function recordFacts(p) {
  const raw = [p.title, p.doi, p.pmid, p.accession, p.year, p.volume, p.pages, JSON.stringify(authorList(p.authors)[0] || ''), p.key, p.id, Array.isArray(p.raw) ? p.raw.length : 0,
    p.journalAbbr, p.journal, p.url, Array.isArray(p.trialIds) ? p.trialIds.join(' ') : ''].join('\u0001');
  const hit = cache.get(p);
  if (hit && hit.raw === raw) return hit;
  const title = normTitle(p.title);
  const f = {
    raw, title, compact: title.replace(/ /g, ''), words: wordSet(title), preprint: isPreprint(p), notice: NOTICE.test(title) || kindOf(p) === 'notice', kind: kindOf(p),
    doi: normDoi(p.doi || (String(p.key || '').startsWith('doi-') ? String(p.key).slice(4) : '')), pmid: pmidOf(p),
    names: surnameKeys(p.authors), year: firstNumber(p.year), volume: firstNumber(p.volume), page: startPage(p.pages),
    // a register's entry: its registration numbers (lib/trial-ids.mjs), the same in the register's record and CENTRAL's or ICTRP's copy
    trials: trialIdsOf(p).map(t => t.toUpperCase()),
  };
  f.loose = looseDoi(f.doi);
  cache.set(p, f);
  return f;
}

/**
 * Whether two records are one work, and why: `{ same: true, reason }` or `{ same: false, reason }`. In order:
 * - a notice (erratum, retraction, reply) is never the paper it is about, and two PMIDs that differ are two works (PubMed's own
 *   duplicate citations are left to the Duplicates review);
 * - two register entries (no DOI or PMID) that name the same registration number are one (a ClinicalTrials.gov record and CENTRAL's or
 *   WHO ICTRP's copy of it), and two that name different NCT numbers are two, whatever their titles;
 * - the same DOI (as normDoi spells it) is the same work, as the library's index has always read it;
 * - DOIs alike but for punctuation, prefix or PII "S" (looseDoi) are the same work when the titles agree;
 * - otherwise the titles must agree (the same words, or one character in ten apart), the first authors must share a family name,
 *   the years may differ by one only when volume and start page agree, a volume or start page that differs keeps them apart
 *   (two pages' slack when the title is the same and the volume agrees), and each of these needs the volume and start page to agree:
 *   two different DOIs (a re-registered or mistyped DOI), a conference paper or abstract beside an article, a title that is only
 *   similar, a missing first author, or a title of three words or fewer; a preprint is never its journal article.
 */
export function sameWork(a, b) {
  const x = recordFacts(a), y = recordFacts(b);
  if (x.notice !== y.notice) return { same: false, reason: 'one is a notice about a paper' };
  if (x.pmid && y.pmid && x.pmid !== y.pmid) return { same: false, reason: 'different PMIDs' };
  if (x.pmid && x.pmid === y.pmid) return { same: true, reason: 'Same PMID' };
  if (x.trials.length && y.trials.length) {
    if (x.trials.some(t => y.trials.includes(t))) return { same: true, reason: 'Same trial registration' };
    const nct = f => f.trials.filter(t => /^NCT\d{8}$/.test(t));
    if (nct(x).length && nct(y).length) return { same: false, reason: 'different trial registrations' };
  }
  if (x.doi && x.doi === y.doi) return { same: true, reason: 'Same DOI' };
  if (x.notice) return { same: false, reason: 'a notice is matched by its identifier only' };
  if (x.preprint !== y.preprint) return { same: false, reason: 'a preprint beside its article' };
  const exact = Boolean(x.compact) && x.compact === y.compact;
  const similar = exact || Boolean(x.compact && y.compact) && (dice(x.words, y.words) >= 0.85 || dice(x.words, y.words) >= 0.6 && editRatio(x.compact, y.compact) >= 0.9);
  if (x.loose && x.loose === y.loose && similar) return { same: true, reason: 'Same DOI but for its spelling' };
  if (!similar) return { same: false, reason: 'different titles' };
  const bothNames = x.names.length > 0 && y.names.length > 0;
  if (bothNames && !x.names.some(n => y.names.includes(n))) return { same: false, reason: 'different first authors' };
  if (x.volume != null && y.volume != null && x.volume !== y.volume) return { same: false, reason: 'different volumes' };
  let pages = null;
  if (x.page != null && y.page != null) {
    const gap = Math.abs(x.page - y.page);
    pages = gap === 0 || (gap <= 2 && exact && x.volume != null && x.volume === y.volume);
    if (!pages) return { same: false, reason: 'different start pages' };
  }
  // volume and start page agree (a volume one side lacks is no conflict)
  const located = pages === true;
  const yearGap = x.year != null && y.year != null ? Math.abs(x.year - y.year) : 0;
  if (yearGap > 1 || (yearGap === 1 && !(located && x.volume != null && y.volume != null))) return { same: false, reason: 'different years' };
  const needs = [];
  if (x.doi && y.doi) needs.push('different DOIs');
  if (x.kind !== y.kind) needs.push('a conference paper beside an article');
  if (!exact) needs.push('similar title');
  if (!bothNames) needs.push('first author missing');
  if (x.title.split(' ').length <= 3) needs.push('short title');
  if (needs.length && !located) return { same: false, reason: `${needs[0]} without the same volume and page` };
  const how = exact ? 'Same title' : 'Similar title';
  return { same: true, reason: `${how}, first author${bothNames ? '' : ' (one side)'}, ${yearGap ? 'year ±1' : 'year'}${located ? ', volume and page' : ''}` };
}

/**
 * The records a library holds, findable by any record that is the same work (sameWork): candidates come from the PMID, DOI, loose
 * DOI, registration number, title and first author with year, so a 28,000-record library is searched without comparing every pair. `alias(record, paper)`
 * lets a merged-away duplicate find the record it was merged into.
 */
export function workIndex(papers = []) {
  const buckets = new Map();
  const put = (k, paper, record) => { if (!k) return; let list = buckets.get(k); if (!list) buckets.set(k, list = []); if (!list.some(e => e.record === record)) list.push({ record, paper }); };
  const keysOf = f => [f.pmid && `p:${f.pmid}`, f.doi && `d:${f.doi}`, f.loose && `l:${f.loose}`, f.compact && `t:${f.compact}`, ...f.trials.map(t => `r:${t}`),
    ...(f.year != null ? f.names.map(n => `a:${n}:${f.year}`) : [])];
  const add = (record, paper = record) => { for (const k of keysOf(recordFacts(record))) put(k, paper, record); };
  papers.forEach(p => add(p));
  return {
    add: p => add(p),
    alias: (record, paper) => add(record, paper),
    /** The library's record that `r` is the same work as, with the reason, or null. */
    find(r) {
      const f = recordFacts(r), seen = new Set();
      const keys = [...keysOf(f), ...(f.year != null ? f.names.flatMap(n => [`a:${n}:${f.year - 1}`, `a:${n}:${f.year + 1}`]) : [])];
      for (const k of keys) for (const e of buckets.get(k) || []) {
        if (e.record === r || seen.has(e.record)) continue;
        seen.add(e.record);
        const m = sameWork(r, e.record);
        if (m.same) return { paper: e.paper, reason: m.reason };
      }
      return null;
    },
  };
}

/**
 * Pairs of library records sameWork reads as one work (each pair once, the earlier record first), leaving out pairs a person marked
 * as different records (dedupDismissed). What Library › Duplicates shows is a superset; these are the ones an import would have merged.
 */
export function sameWorkPairs(papers = [], dismissed = []) {
  const no = new Set(dismissed.map(d => [d.a, d.b].sort().join('|')));
  const out = [], order = new Map(papers.map((p, i) => [p, i]));
  const buckets = new Map();
  for (const p of papers) {
    const f = recordFacts(p);
    const keys = [f.pmid && `p:${f.pmid}`, f.doi && `d:${f.doi}`, f.loose && `l:${f.loose}`, f.compact && `t:${f.compact}`, ...f.trials.map(t => `r:${t}`), ...(f.year != null ? f.names.flatMap(n => [`a:${n}:${f.year}`]) : [])].filter(Boolean);
    for (const k of keys) { let l = buckets.get(k); if (!l) buckets.set(k, l = []); l.push(p); }
  }
  const done = new Set();
  const consider = (a, b) => {
    if (a === b) return;
    if (order.get(a) > order.get(b)) [a, b] = [b, a];
    const key = `${a.id}|${b.id}`;
    if (done.has(key)) return;
    done.add(key);
    if (no.has([a.id, b.id].sort().join('|'))) return;
    const m = sameWork(a, b);
    if (m.same) out.push({ a, b, reason: m.reason });
  };
  for (const [k, list] of buckets) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) consider(list[i], list[j]);
  }
  // first author a year apart
  for (const [k, list] of buckets) if (k.startsWith('a:')) {
    const [, n, y] = k.split(':'), next = buckets.get(`a:${n}:${Number(y) + 1}`);
    if (next) for (const a of list) for (const b of next) consider(a, b);
  }
  return out;
}
