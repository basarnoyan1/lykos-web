// The files a study is expected to have (Assurance plan, "Provenance and missing files", step 6): its article, and every supplement or
// appendix the article's own text points to ("Supplementary Table 2", "Table S2", "eAppendix", "Online Resource 1", "supplementary
// material"; proof/pointers.mjs). Read from the article's full text once per article: the app when it indexes the PDF
// (lib/fulltext-index.mjs), the command line from the kept text (tools/fulltext.mjs) where the app has not read it. Kept on the record:
//   expected: { v, of: the article's hash as read, items: [{ key, label, kind, seenAt: page, inArticle?, answer?, answeredAt? }] }
// A pointer in the references, an editorial comment or another article bound into the PDF is not this study's. A pointer whose caption
// is printed in the article (an appendix at its end, a supplement saved with the PDF) is in the article. Each item's status is read,
// not stored: in-article, held (the record holds a file with the supplement role; its contents are not read), not-needed (answered),
// or missing. Absent `expected` is not read yet, never "nothing missing". The warning is one per study: answering it answers every
// file it names; a file the text names later, or another article (other bytes), warns again.
// Not done: Europe PMC and Crossref supplement lists (plan step 5), ranking by unproven values (step 4), an attach path for a supplement.
import { pointersIn } from './proof/pointers.mjs';
import { buildIndex, NOT_OWN_WORDS } from './proof/text-index.mjs';
import { lib_file_provenance$normalizeFiles as normalizeFiles } from "../boot.mjs";

export const EXPECTED_VERSION = 1;   // the stored form; a new one drops every answer
export const READER = 6;             // the reading (proof/pointers.mjs, this file): a new one reads each article again and keeps its answers
const KINDS = new Set(['table', 'figure', 'appendix', 'file', 'material']);
const ANSWERS = new Set(['not-needed']);
const MAX_ITEMS = 60;
const str = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');

/** The stored object cleaned: known fields only, in a fixed order. Undefined for none. */
export function normalizeExpected(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || x.v !== EXPECTED_VERSION || !Array.isArray(x.items)) return undefined;
  const items = [];
  for (const i of x.items.slice(0, MAX_ITEMS)) {
    if (!i || typeof i !== 'object' || !str(i.key) || !KINDS.has(i.kind)) continue;
    const e = { key: str(i.key, 40), label: str(i.label) || str(i.key, 40), kind: i.kind };
    if (Number.isSafeInteger(i.seenAt) && i.seenAt > 0) e.seenAt = i.seenAt;
    if (i.inArticle === true) e.inArticle = true;
    if (ANSWERS.has(i.answer)) { e.answer = i.answer; if (str(i.answeredAt, 40)) e.answeredAt = str(i.answeredAt, 40); }
    items.push(e);
  }
  return { v: EXPECTED_VERSION, ...(Number.isSafeInteger(x.r) && x.r > 0 ? { r: x.r } : {}), of: str(x.of, 64), items };
}

const lineAt = (ix, off) => { let lo = 0, hi = ix.lines.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= off) lo = m; else hi = m - 1; } return lo; };

/**
 * The supplements a full text points to, one per file (keyed: "Table S2", "Supplementary Table 2" and "eTable 2" are one), in the order
 * first seen: [{ key, label, kind, seenAt, inArticle? }]. `text`: the pages joined by form feeds; `doi`: the paper's own (a page headed by
 * another DOI is another article).
 */
export function readExpected(text, { doi = '' } = {}) {
  const ix = buildIndex(String(text || ''), { doi });
  const lineText = i => (i >= 0 && i < ix.lines.length ? ix.t.slice(ix.lines[i].s, ix.lines[i].e) : '');
  const all = pointersIn(ix.t).filter(p => p.supplement);
  const single = new Map();
  for (const p of all) single.set(p.index, (single.get(p.index) || 0) + 1);
  const out = new Map();
  for (const p of all) {
    const li = lineAt(ix, p.index), L = ix.lines[li];
    if (!L || NOT_OWN_WORDS.has(L.zone)) continue;
    // a caption: the pointer starts its line after a sentence ends (or a page or a heading), one file, a title or a stop after it
    const before = ix.t.slice(L.s, p.index), after = ix.t.slice(p.end, L.e), prev = lineText(li - 1);
    const caption = !before.trim() && single.get(p.index) === 1 && (li === 0 || !prev.trim() || /[.!?:)\]]\s*$/.test(prev) || ix.lines[li - 1].heading || ix.lines[li - 1].page !== L.page)
      && /^(?:\s*$|\s*[.:|—–-]|\s+[\p{Lu}(\d])/u.test(after);
    const was = out.get(p.key);
    if (was) { if (caption) was.inArticle = true; continue; }
    out.set(p.key, { key: p.key, label: p.label, kind: p.what, seenAt: L.page || 1, ...(caption ? { inArticle: true } : {}) });
  }
  // "supplementary material", "supplementary tables" name no file: they stand for the supplement only when the text names no numbered one
  const items = [...out.values()];
  const numbered = items.some(i => !/:$/.test(i.key));
  return items.filter(i => !(numbered && /:$/.test(i.key))).slice(0, MAX_ITEMS);
}

/** Whether the record's reading is this article's by the current reader (else it is read again, its answers kept). */
export const readNow = (p, hash) => readFrom(p, hash) && normalizeExpected(p?.expected)?.r === READER;

/** Whether the record's expected files were read from this article (`hash`: its bytes' hash, or a prefix of it, as the reader names it). */
export function readFrom(p, hash) {
  const e = normalizeExpected(p?.expected);
  if (!e) return false;
  if (!hash && !e.of) return true;   // neither names its bytes (a record without a hash, read from its kept text): the same reading
  return Boolean(hash && e.of && (e.of === hash || String(hash).startsWith(e.of) || e.of.startsWith(String(hash))));
}

/**
 * Keeps what `readExpected` found on the record, read from the article `hash`. The same article keeps its answers (by key); another
 * article's answers go with it. Mutates `p`; returns whether anything changed. Idempotent.
 */
export function keepExpected(p, found, hash) {
  if (!p || typeof p !== 'object' || !Array.isArray(found)) return false;
  const was = normalizeExpected(p.expected), same = was && readFrom(p, hash);
  const answered = new Map(same ? was.items.filter(i => i.answer).map(i => [i.key, i]) : []);
  const next = normalizeExpected({ v: EXPECTED_VERSION, r: READER, of: str(hash, 64), items: found.map(i => {
    const a = answered.get(i.key);
    return a ? { ...i, answer: a.answer, answeredAt: a.answeredAt } : i;
  }) });
  if (JSON.stringify(next) === JSON.stringify(p.expected ?? null)) return false;
  p.expected = next;
  return true;
}

const hasArticle = p => Boolean(p?.pdf || p?.pdfRel || p?.pdfHash || p?.pdfRetrieval?.status === 'preview' || normalizeFiles(p?.files)?.some(f => f.role === 'article'));
const hasSupplement = p => Boolean(normalizeFiles(p?.files)?.some(f => f.role === 'supplement'));

/**
 * The files the study is expected to have, each with its status: { read, files: [{ key, label, kind, seenAt?, status }] }. The article
 * comes first (held or missing); `read` says whether its text was read for supplements.
 */
export function expectedFiles(p) {
  const e = normalizeExpected(p?.expected), supp = hasSupplement(p);
  const files = [{ key: 'article', label: 'Article', kind: 'article', status: hasArticle(p) ? 'held' : 'missing' }];
  for (const i of e?.items || []) files.push({ key: i.key, label: i.label, kind: i.kind, ...(i.seenAt ? { seenAt: i.seenAt } : {}),
    status: i.inArticle ? 'in-article' : i.answer ? i.answer : supp ? 'held' : 'missing' });
  return { read: Boolean(e), files };
}

/** The supplements the study's text points to that it does not hold and nobody has answered. */
export const missingOf = p => expectedFiles(p).files.filter(f => f.kind !== 'article' && f.status === 'missing');

/** Answers the study's warning: every missing file it names becomes `how` ('not-needed'). Mutates `p`; returns how many. */
export function answerExpected(p, how = 'not-needed', at = new Date().toISOString()) {
  if (!ANSWERS.has(how)) return 0;
  const e = normalizeExpected(p?.expected);
  if (!e) return 0;
  const open = new Set(missingOf(p).map(f => f.key));
  let n = 0;
  for (const i of e.items) if (open.has(i.key)) { i.answer = how; i.answeredAt = at; n++; }
  if (n) p.expected = e;
  return n;
}

const listWords = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const SHOWN = 4;
/** The warning's sentence for a study's missing files. */
export function noticeText(missing) {
  if (!missing.length) return '';
  const pages = [...new Set(missing.map(f => f.seenAt).filter(Boolean))].sort((a, b) => a - b);
  const at = pages.length === 1 ? ` (page ${pages[0]})` : '';
  const names = missing.slice(0, SHOWN).map(f => f.label), more = missing.length - names.length;
  if (missing.length === 1) return `The article cites ${names[0]}${at}, which is not held.`;
  return `The article cites ${missing.length} supplementary files that are not held: ${listWords(more ? [...names, `${more} more`] : names)}.`;
}

/**
 * The studies whose expected files are open, for the review's Files area: { missing: [{ id, label, files }], unread: [ids] }. `studies`:
 * the records under review (lib/review-state.mjs reviewStudies); `textOfStudy(p)`: the study's text where the stored reading is not this
 * article's (the command line), or null.
 */
export function reviewExpected(studies, { textOfStudy = null, hashOf = p => p?.pdfHash || '' } = {}) {
  const missing = [], unread = [];
  for (const p of studies || []) {
    let q = p;
    // the stored reading stands while it is this article's (or the record names no hash to tell)
    const stored = normalizeExpected(p.expected), h = hashOf(p);
    if (!(stored && stored.r === READER && (!h || readFrom(p, h))) && textOfStudy) {
      const text = textOfStudy(p);
      if (text) { q = { ...p }; keepExpected(q, readExpected(text, { doi: p.doi || '' }), h); }
    }
    if (!normalizeExpected(q.expected)) { if (hasArticle(q)) unread.push(p.id); continue; }
    const m = missingOf(q);
    if (m.length) missing.push({ id: p.id, label: p.label || p.id, files: m });
  }
  return { missing, unread };
}
