// Integrity checks on the library (plan K4; RESEARCH-GAPS R3, R11): retraction, expression-of-concern and correction notices
// from two sources. Crossref's update metadata (which carries Retraction Watch) is read by DOI; PubMed's CommentsCorrections
// (RetractionIn, PartialRetractionIn, ExpressionOfConcernIn, ErratumIn) by PMID, which catches notices a publisher never
// registered with Crossref and records that have no DOI. Every check is dated on the record; a check older than the configured
// freshness (30 days unless Settings say otherwise) is stale. A missing notice is not proof a record is unaffected: what was
// checked, where and when is what the readiness row and the submission bundle report, nothing more.
import { crossrefUpdates, pubmedXml } from './sources.mjs';
import { citations } from './manuscript.mjs';
import { isIncluded } from './screen.mjs';
import { update } from '../store.mjs';
import { day, plural } from './dates.mjs';

export const FRESH_DAYS = 30;
const DAY = 864e5;
/** The freshness in days: the setting when it is a sensible number, else 30. */
export const freshDays = settings => { const n = Math.round(Number(settings?.retractionFreshDays)); return n >= 1 && n <= 365 ? n : FRESH_DAYS; };

/** PubMed's reference types that put a record in question, as the notice types Crossref uses for the same thing. */
export const PUBMED_TYPES = Object.freeze({ RetractionIn: 'retraction', PartialRetractionIn: 'partial_retraction', ExpressionOfConcernIn: 'expression_of_concern', ErratumIn: 'erratum' });
const SOURCE_NAME = { crossref: 'Crossref', pubmed: 'PubMed' };

export { noticeLevel, levelLabel, recordLevel } from './integrity-level.mjs';
import { noticeLevel, recordLevel, levelLabel, RANK } from './integrity-level.mjs';

const pmidOf = p => String(p?.pmid || '').replace(/\D/g, '');
const doiKey = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/[.,;]+$/, '').toLowerCase();
const unescape = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi,
  (_, n, d, h) => (n ? { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n] : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)))).replace(/\s+/g, ' ').trim();

/**
 * The notices in a PubMed efetch answer, by the PMID of the record they concern: Map pmid → notices. Every record the answer
 * holds has an entry (an empty list when it has no notice), so a PMID missing from the map is one PubMed did not return.
 * A record PubMed types "Retracted Publication" without a RetractionIn reference still carries one retraction notice.
 */
export function pubmedNotices(xml) {
  const out = new Map();
  for (const [, art] of String(xml || '').matchAll(/<PubmedArticle(?:\s[^>]*)?>([\s\S]*?)<\/PubmedArticle>/g)) {
    const pmid = /<MedlineCitation[^>]*>[\s\S]*?<PMID[^>]*>(\d+)<\/PMID>/.exec(art)?.[1];
    if (!pmid) continue;
    const notices = [];
    for (const [, ref, body] of art.matchAll(/<CommentsCorrections\s+RefType="(\w+)"[^>]*>([\s\S]*?)<\/CommentsCorrections>/g)) {
      const type = PUBMED_TYPES[ref];
      if (!type) continue;
      const cite = unescape(/<RefSource>([\s\S]*?)<\/RefSource>/.exec(body)?.[1]);
      notices.push({ type, pmid: /<PMID[^>]*>(\d+)<\/PMID>/.exec(body)?.[1] || '', doi: doiKey(/\bdoi:\s*(10\.\S+)/i.exec(cite)?.[1]), title: cite, date: '', sources: ['pubmed'] });
    }
    if (/<PublicationType[^>]*>Retracted Publication<\/PublicationType>/.test(art) && !notices.some(n => noticeLevel(n.type) === 'retraction'))
      notices.push({ type: 'retraction', pmid: '', doi: '', title: 'Retracted Publication (PubMed publication type)', date: '', sources: ['pubmed'] });
    out.set(pmid, notices);
  }
  return out;
}

/** Crossref's notices as stored: the type Crossref gives, the notice's DOI, title and date, and where it came from. */
const crossrefNotices = list => list.map(n => ({ type: n.type || 'update', pmid: '', doi: doiKey(n.doi), title: n.title || '', date: n.date || '', sources: ['crossref'] }));
const sourcesOf = n => (Array.isArray(n.sources) && n.sources.length ? n.sources : [n.source || 'crossref']);

/**
 * One notice per notice document: the same DOI (or notice PMID) from both sources is one notice with both sources, its type the
 * more serious of the two (Crossref files Wakefield 1998's 2004 notice as a correction, PubMed as a retraction).
 */
export function mergeNotices(lists) {
  const out = [], byKey = new Map();
  for (const n of lists.flat()) {
    const key = n.doi ? `doi:${doiKey(n.doi)}` : n.pmid ? `pmid:${n.pmid}` : `${sourcesOf(n).join()}:${n.type}:${n.title}`;
    const had = byKey.get(key);
    if (!had) { const x = { ...n, sources: sourcesOf(n) }; delete x.source; byKey.set(key, x); out.push(x); continue; }
    if (RANK[noticeLevel(n.type)] < RANK[noticeLevel(had.type)]) had.type = n.type;
    had.sources = [...new Set([...had.sources, ...sourcesOf(n)])].sort();
    for (const k of ['pmid', 'doi', 'date']) if (!had[k] && n[k]) had[k] = n[k];
    if (!had.title || (sourcesOf(n).includes('crossref') && n.title)) had.title = n.title || had.title;
  }
  return out.sort((a, b) => RANK[noticeLevel(a.type)] - RANK[noticeLevel(b.type)] || String(b.date).localeCompare(String(a.date)));
}

/**
 * Checks each record against Crossref (by DOI) and PubMed (by PMID, 100 to a request), writes `p.integrity` = { checkedAt,
 * sources, notices } and returns the tally. A record with neither identifier is skipped; a record whose every source failed keeps
 * its earlier check. Notices from a source that failed this time are kept, not dropped. `crossref`, `pubmed` and `write` replace
 * the network and the store (the tests).
 */
export async function checkRetractions(papers, { settings, onEach = () => {}, onProgress = () => {}, now = () => new Date(),
  crossref = crossrefUpdates, pubmed = pubmedXml, write = update } = {}) {
  const tally = { checked: 0, flagged: 0, questioned: 0, failed: 0, skipped: 0 };
  const pmids = [...new Set(papers.map(pmidOf).filter(Boolean))];
  let pm = null;
  if (pmids.length) { try { pm = pubmedNotices(await pubmed(pmids, { settings })); } catch { pm = null; } }
  let done = 0;
  for (const p of papers) {
    const pmid = pmidOf(p);
    if (!p.doi && !pmid) { tally.skipped++; continue; }
    const ok = new Set(), lists = [];
    if (p.doi) { try { lists.push(crossrefNotices(await crossref(p.doi, { settings }))); ok.add('crossref'); } catch { /* reported as not checked there */ } }
    if (pmid && pm?.has(pmid)) { lists.push(pm.get(pmid)); ok.add('pubmed'); }
    onProgress(++done, papers.length);
    if (!ok.size) { tally.failed++; continue; }
    // an earlier notice stays unless every source that reported it answered this time without it
    const kept = (p.integrity?.notices || []).filter(n => !sourcesOf(n).every(s => ok.has(s)));
    const notices = mergeNotices([...lists, kept]);
    const integrity = { checkedAt: now().toISOString(), sources: [...ok].sort(), notices };
    write(s => { const x = (s.papers || []).find(y => y.id === p.id); if (x) x.integrity = integrity; return s; });
    tally.checked++;
    if (notices.length) tally.flagged++;
    if (notices.some(n => noticeLevel(n.type) !== 'correction')) tally.questioned++;
    onEach(p, notices);
  }
  return tally;
}

/** A record's check: 'unidentified' (no DOI or PMID), 'never', 'stale' (older than `days`) or 'done'. */
export function checkState(p, { now = Date.now(), days = FRESH_DAYS } = {}) {
  if (!p?.doi && !pmidOf(p)) return 'unidentified';
  const at = Date.parse(p.integrity?.checkedAt || '');
  if (!Number.isFinite(at)) return 'never';
  return now - at > days * DAY ? 'stale' : 'done';
}
const ageDays = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));

/** The records by check state and by notice level, and the oldest check: what the page, the row and the tools say. */
export function retractionSummary(papers = [], { now = Date.now(), days = FRESH_DAYS } = {}) {
  const by = { unidentified: [], never: [], stale: [], done: [] }, level = { retraction: [], concern: [], correction: [] };
  for (const p of papers) {
    by[checkState(p, { now, days })].push(p);
    const l = recordLevel(p); if (l) level[l].push(p);
  }
  const dates = papers.map(p => p.integrity?.checkedAt).filter(d => Number.isFinite(Date.parse(d || ''))).sort();
  return { total: papers.length, ...by, retracted: level.retraction, concern: level.concern, corrected: level.correction,
    oldest: dates[0] || '', newest: dates.at(-1) || '', days, oldestDays: dates[0] ? ageDays(dates[0], now) : null };
}

const names = list => { const l = list.map(p => p.label || p.title || 'Untitled').slice(0, 2); return `${l.join(', ')}${list.length > 2 ? ` and ${list.length - 2} more` : ''}`; };
const records = n => plural(n, 'record');

/**
 * The submission readiness row "Retraction check" for the records the manuscript rests on, or null when there are none.
 * 'missing' when one is retracted or was never checked; 'warn' for an expression of concern or a check older than the freshness;
 * 'ok' when every record with an identifier was checked within it. `action` is the one way to act on it.
 */
export function retractionReadiness(papers = [], { now = Date.now(), days = FRESH_DAYS } = {}) {
  if (!papers.length) return null;
  const sum = retractionSummary(papers, { now, days });
  const parts = [], states = [];
  if (sum.retracted.length) { parts.push(`${names(sum.retracted)} ${sum.retracted.length === 1 ? 'is' : 'are'} retracted`); states.push('missing'); }
  if (sum.concern.length) { parts.push(`${records(sum.concern.length)} with an expression of concern`); states.push('warn'); }
  if (sum.never.length) { parts.push(`${records(sum.never.length)} never checked`); states.push('missing'); }
  if (sum.stale.length) { parts.push(`last checked ${ageDays(sum.stale.map(p => p.integrity.checkedAt).sort()[0], now)} days ago`); states.push('warn'); }
  if (!sum.never.length && !sum.stale.length && sum.done.length) parts.push(`Checked ${day(sum.oldest, now)}`);
  if (sum.unidentified.length === sum.total) { parts.push('No record has a DOI or PMID to check'); states.push('warn'); }
  else if (sum.unidentified.length) parts.push(`${records(sum.unidentified.length)} without a DOI or PMID`);
  const state = states.includes('missing') ? 'missing' : states.includes('warn') ? 'warn' : 'ok';
  return { label: 'Retraction check', state, detail: parts.join('; '), ...(sum.never.length || sum.stale.length ? { action: { id: 'ms-ready-retractions', label: 'Check now' } } : {}) };
}

/** The records a submission rests on: the included studies and every record the manuscript cites, in library order. */
export function reportedRecords(s) {
  const cited = new Set();
  for (const b of s.manuscript?.blocks || []) for (const c of citations(b.text)) cited.add(c.key);
  return (s.papers || []).filter(p => isIncluded(s, p.id) || (p.key && cited.has(p.key)));
}

const RESULT = { unidentified: 'No DOI or PMID', never: 'Not checked' };
export const REPORT_HEAD = ['Record', 'DOI', 'PMID', 'Checked', 'Checked in', 'Result', 'Notices'];
const noticeText = n => [String(n.type || 'notice').replace(/_/g, ' '), n.doi ? `doi ${n.doi}` : n.pmid ? `PMID ${n.pmid}` : '', n.date, `(${sourcesOf(n).map(x => SOURCE_NAME[x] || x).join(', ')})`].filter(Boolean).join(' ');

/**
 * The "Retractions and corrections" section of the submission bundle (R11): one row per record with what was checked, when, where
 * and the result, as CSV rows and as Markdown. Dates are the stored check dates, never the export time, so an unchanged library
 * gives the same bytes. `never` counts the records that could have been checked and were not.
 */
export function retractionReport(papers = []) {
  const rows = papers.map(p => {
    const state = checkState(p, { now: Date.now(), days: Infinity });
    const level = recordLevel(p);
    return [p.label || p.title || '', p.doi || '', pmidOf(p), (p.integrity?.checkedAt || '').slice(0, 10), (p.integrity?.sources || []).map(x => SOURCE_NAME[x] || x).join(', '),
      RESULT[state] || (level ? levelLabel(level) : 'No notice found'), (p.integrity?.notices || []).map(noticeText).join('; ')];
  });
  const never = rows.filter(r => r[5] === RESULT.never).length;
  const cell = v => String(v || '').replace(/\|/g, '\\|');
  const markdown = ['# Retractions and corrections', '',
    'Each record the submission rests on (the included studies and the cited records), checked for retraction, expression-of-concern and correction notices in Crossref (by DOI, including Retraction Watch) and PubMed (by PMID). "No notice found" means neither source listed one on the date shown; it is not proof that none exists.', '',
    `| ${REPORT_HEAD.join(' | ')} |`, `| ${REPORT_HEAD.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`), ''].join('\n');
  return { head: REPORT_HEAD, rows, markdown, never };
}

// ---- the assistant's read (lib/chat-tools.mjs retraction_status) -------------------------------------------------------------
const brief = p => ({ id: p.id, label: p.label || '', checked: (p.integrity?.checkedAt || '').slice(0, 10) || null,
  notices: (p.integrity?.notices || []).map(n => ({ type: n.type, doi: n.doi || undefined, pmid: n.pmid || undefined, date: n.date || undefined, sources: sourcesOf(n) })) });

/**
 * What the library's retraction checks say, compactly: counts by check state and by finding, the records with a retraction or
 * concern notice, and the submission readiness row; with `paper` (a record found by `find`), that record's check in full. Runs no
 * check: the person runs it from the Library (Check, Check retractions) or the readiness row.
 */
export function retractionStatusTool(s, { paper } = {}, find = () => null, { now = Date.now() } = {}) {
  const days = freshDays(s.settings);
  if (paper) {
    const p = find(paper, s);
    if (!p) throw new Error(`no record "${String(paper).slice(0, 60)}" in the library; use an id from query_library`);
    return { ...brief(p), doi: p.doi || null, pmid: pmidOf(p) || null, state: checkState(p, { now, days }), level: recordLevel(p) || 'none', checked_in: p.integrity?.sources || [] };
  }
  const sum = retractionSummary(s.papers || [], { now, days });
  const ready = retractionReadiness(reportedRecords(s), { now, days });
  return { fresh_days: days, records: sum.total, checked: sum.done.length, stale: sum.stale.length, never_checked: sum.never.length,
    without_identifier: sum.unidentified.length, oldest_check: sum.oldest.slice(0, 10) || null, newest_check: sum.newest.slice(0, 10) || null,
    retracted: sum.retracted.slice(0, 20).map(brief), concern: sum.concern.slice(0, 20).map(brief), corrected: sum.corrected.length,
    submission: ready ? { state: ready.state, detail: ready.detail } : null,
    note: 'Sources: Crossref (by DOI, includes Retraction Watch) and PubMed (by PMID). No notice found is not proof that none exists.' };
}
