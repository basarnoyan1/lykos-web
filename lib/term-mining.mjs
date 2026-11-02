// Term mining from seed records, for building or widening a search.
//
// Three views of the same records, each reimplemented here from its published
// description; no code from any of them was read or copied.
//  - a term grid in the manner of the Yale MeSH Analyzer: MeSH descriptors and
//    author keywords down the side, records across, a filled cell where the
//    record carries the term;
//  - frequency tables in the manner of PubReMiner: how many seed records
//    contain each word of title and abstract, each MeSH descriptor, each keyword;
//  - keyword candidates in the manner of litsearchr (Grames et al. 2019): RAKE
//    (Rose et al. 2010) finds multi-word phrases in titles and abstracts, a
//    document-term matrix of those phrases gives a co-occurrence network, and
//    a term's strength is the sum of its co-occurrence weights.
// A term is ranked first by how many seed records carry it, then by whether it
// is a MeSH descriptor or author keyword (curated), then by its RAKE score and
// strength. Terms the query already covers are left out of the candidates.
// This lists words that occur in the seeds; it does not judge that they belong in the query.
import { parseQuery } from './boolean.mjs';

const STOP = new Set(('a about above across after again against all almost also although always am among an and any are as at be because been before being between both but by can could did do does doing during each either else few for from further had has have having he her here hers him his how however i if in into is it its itself just may might more most much must my no nor not of off often on once only or other our out over own per rather same shall she should since so some such than that the their them then there these they this those through thus to too under until up upon use used using very via was we were what when where whether which while who whom whose why will with within without would yet you your ' +
  'background objective objectives purpose aim aims method methods result results conclusion conclusions introduction study studies patient patients group groups data analysis compared comparison versus vs including included include reported report reports findings found review').split(/\s+/));

const fold = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** A word as compared: folded, and a plural s dropped ("screws" and "screw" are one word). */
export const norm = w => { const x = fold(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); return x.length > 3 && /[^s]s$/.test(x) && !/(us|is|ss)$/.test(x) ? x.slice(0, -1) : x; };
const words = text => fold(text).split(/[^\p{L}\p{N}'-]+/u).map(w => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
const isStop = w => STOP.has(w) || /^\d+([.,]\d+)?$/.test(w) || w.length < 3;

/** The text of a record: title, abstract and author keywords. MeSH descriptors are an index, not text, so they stay out of phrase mining. */
const textOf = r => [r.title, r.abstract, ...(r.keywords || [])].filter(Boolean).join('. ');

/** MeSH check tags describe the sample, not the topic; they are counted but never offered as terms to add. */
export const CHECK_TAGS = new Set(['humans', 'animals', 'male', 'female', 'pregnancy', 'infant, newborn', 'infant', 'child, preschool', 'child', 'adolescent', 'adult', 'young adult', 'middle aged', 'aged', 'aged, 80 and over', 'newborn']);
const isCheckTag = (c) => c.kind === 'mesh' && CHECK_TAGS.has(fold(c.term).trim());

// ---- the query's own terms ---------------------------------------------------
/** The terms a query names: `{ words: [normalised], mesh: bool, truncated: bool }` for each. */
export function queryTerms(query) {
  const out = [];
  const walk = n => {
    if (!n) return;
    if (n.term != null) {
      const ws = words(n.term.replace(/\*/g, ' ')).map(norm).filter(Boolean);
      if (ws.length) out.push({ words: ws, mesh: /^(mh|mesh)/i.test(n.field || ''), truncated: n.truncated, text: n.term });
      return;
    }
    n.children.forEach(walk);
  };
  const { tree } = parseQuery(query || '');
  walk(tree);
  return out;
}

const hasRun = (hay, needle, prefixLast = false) => {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      const a = hay[i + j], b = needle[j];
      if (a === b || (prefixLast && j === needle.length - 1 && a.startsWith(b))) continue;
      ok = false; break;
    }
    if (ok) return true;
  }
  return false;
};
/**
 * Whether a query already covers a term: a query term occurs inside it (the
 * query would retrieve the term's records), or the term's words all occur in
 * one query term (the concept is already named). Names only: MeSH explosion
 * and synonyms are not known here.
 */
export function covered(term, qterms) {
  const t = words(term).map(norm).filter(Boolean);
  if (!t.length) return true;
  return qterms.some(q => hasRun(t, q.words, q.truncated) || (t.length <= q.words.length && t.every(w => q.words.some(x => x === w || (q.truncated && w.startsWith(x))))));
}

// ---- RAKE ---------------------------------------------------------------------
/** Candidate phrases of a text: runs of content words between stop words and punctuation. */
export function rakePhrases(text, { maxWords = 4 } = {}) {
  const out = [];
  for (const sentence of fold(text).split(/[.;:!?()[\]{}"“”,\n/]+/)) {
    let run = [];
    const flush = () => { if (run.length && run.length <= maxWords) out.push(run); run = []; };
    for (const w of sentence.split(/\s+/).map(x => x.replace(/^['-]+|['-]+$/g, '')).filter(Boolean)) {
      if (isStop(w)) flush(); else run.push(w);
    }
    flush();
  }
  return out;
}

/** RAKE word scores deg/freq over candidate phrases, and each phrase scored as the sum of its words. */
export function rake(texts, opts = {}) {
  const freq = new Map(), deg = new Map(), phrases = new Map();
  for (const t of texts) for (const p of rakePhrases(t, opts)) {
    const key = p.map(norm).join(' ');
    if (!phrases.has(key)) phrases.set(key, { words: p.map(norm), count: 0, text: p.join(' ') });
    phrases.get(key).count++;
    for (const w of p.map(norm)) { freq.set(w, (freq.get(w) || 0) + 1); deg.set(w, (deg.get(w) || 0) + p.length); }
  }
  const score = w => (deg.get(w) || 0) / (freq.get(w) || 1);
  for (const p of phrases.values()) p.score = p.words.reduce((a, w) => a + score(w), 0);
  return [...phrases.values()];
}

// ---- mining -------------------------------------------------------------------
const bump = (map, key, label, doc, extra = {}) => {
  const k = norm(key) || key;
  if (!map.has(k)) map.set(k, { term: label, docs: new Set(), count: 0, ...extra });
  const x = map.get(k); x.docs.add(doc); x.count++;
  return x;
};

/**
 * Mines `records` (each `{ title, abstract, keywords, mesh, meshMajor, label }`).
 * `query` leaves out what it already covers. `minDocs` is the fewest seed
 * records a term must appear in (default 2 for more than 3 records, else 1).
 * Answers `{ n, mesh, keywords, words, phrases, candidates, grid }`.
 */
export function mineTerms(records, { query = '', minDocs = null, maxGrid = 20 } = {}) {
  const n = records.length, need = minDocs ?? (n > 3 ? 2 : 1);
  const qt = queryTerms(query);
  const meshMap = new Map(), kwMap = new Map(), wordMap = new Map();
  records.forEach((r, i) => {
    for (const m of r.mesh || []) bump(meshMap, m, m, i, { major: false }).major ||= (r.meshMajor || []).includes(m);
    for (const k of r.keywords || []) bump(kwMap, fold(k).trim(), k.trim(), i);
    const seen = new Set();
    for (const w of words(`${r.title || ''}. ${r.abstract || ''}`)) {
      if (isStop(w)) continue;
      const k = norm(w); bump(wordMap, k, k, i);
      seen.add(k);
    }
  });
  const finish = (map, kind) => [...map.values()].map(x => ({ term: x.term, kind, docs: x.docs.size, count: x.count, records: [...x.docs].sort((a, b) => a - b), major: x.major || false, inQuery: covered(x.term, qt) }))
    .sort((a, b) => b.docs - a.docs || b.count - a.count || a.term.localeCompare(b.term));
  const mesh = finish(meshMap, 'mesh'), keywords = finish(kwMap, 'keyword'), wordRows = finish(wordMap, 'word');

  // RAKE phrases and the co-occurrence network over them
  const texts = records.map(textOf);
  const phraseList = rake(texts).filter(p => p.words.length >= 2 || p.words[0].length > 3);
  const docsOf = new Map();
  const tokens = texts.map(t => words(t).map(norm));
  for (const p of phraseList) {
    const inDocs = [];
    tokens.forEach((tk, i) => { if (hasRun(tk, p.words)) inDocs.push(i); });
    if (inDocs.length >= need) docsOf.set(p.words.join(' '), inDocs);
  }
  const phrases = phraseList.filter(p => docsOf.has(p.words.join(' '))).map(p => ({ term: p.text, kind: 'phrase', docs: docsOf.get(p.words.join(' ')).length, rake: p.score, records: docsOf.get(p.words.join(' ')), strength: 0, inQuery: covered(p.text, qt) }));
  // strength: the sum over other phrases of the records they share (litsearchr's node strength)
  for (const a of phrases) for (const b of phrases) if (a !== b) { let shared = 0; for (const i of a.records) if (b.records.includes(i)) shared++; a.strength += shared; }
  phrases.sort((a, b) => b.docs - a.docs || b.strength - a.strength || b.rake - a.rake || a.term.localeCompare(b.term));

  const rank = { mesh: 0, keyword: 1, phrase: 2, word: 3 };
  const seenTerm = new Set();
  const candidates = [...mesh, ...keywords, ...phrases, ...wordRows.filter(w => w.docs >= need)]
    .filter(c => !c.inQuery && !isCheckTag(c) && c.docs >= need && !seenTerm.has(`${c.kind === 'mesh' ? 'mesh' : 't'}:${norm(c.term)}`) && seenTerm.add(`${c.kind === 'mesh' ? 'mesh' : 't'}:${norm(c.term)}`))
    .sort((a, b) => b.docs - a.docs || rank[a.kind] - rank[b.kind] || (b.rake || 0) - (a.rake || 0) || (b.strength || 0) - (a.strength || 0) || a.term.localeCompare(b.term));
  // the grid: the most shared MeSH descriptors and keywords against the first records
  const cols = records.slice(0, maxGrid).map((r, i) => ({ index: i, label: r.label || r.pmid || `Record ${i + 1}` }));
  const grid = { columns: cols, rows: [...mesh, ...keywords].filter(x => x.docs >= Math.min(need, 2) || n <= 3).slice(0, 200).map(x => ({ term: x.term, kind: x.kind, docs: x.docs, major: x.major, inQuery: x.inQuery, cells: cols.map(c => x.records.includes(c.index)) })) };
  return { n, need, mesh, keywords, words: wordRows, phrases, candidates, grid };
}

/** A candidate as text to add to a PubMed query: MeSH as [Mesh], the rest as title/abstract. */
export const asQueryTerm = c => c.kind === 'mesh' ? `"${c.term}"[Mesh]` : `${/\s/.test(c.term) ? `"${c.term}"` : c.term}[tiab]`;
