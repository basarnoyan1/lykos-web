// Local bibliographic duplicate review. Nothing merges without a person.
import { authorList, familyName } from './bib.mjs';

const norm = value => String(value ?? '').normalize('NFKD').toLowerCase()
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const doi = value => String(value ?? '').trim().toLowerCase()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
const pmid = value => String(value ?? '').trim().replace(/^pmid:\s*/i, '');
const title = p => norm(p.title || p.label);
const surname = p => {
  const name = authorList(p.authors)[0] || '';
  return norm(familyName(name));
};
export const pairKey = (a, b) => { const x = String(a), y = String(b); return x < y ? `${x}|${y}` : `${y}|${x}`; };
export const signature = (a, b) => [a, b].map(p =>
  [title(p), surname(p), String(p.year || ''), doi(p.doi), pmid(p.pmid), p.pdfHash || ''].join('|')).sort().join('::');

// Word sets of a normalized title, compared by overlap.
const words = t => new Set(t.split(' ').filter(w => w.length > 3));
function overlap(x, y) {
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const word of x) if (y.has(word)) common++;
  return common / Math.max(x.size, y.size);
}

// What the comparison reads from a record, worked out once per record per
// call: normalizing titles and names for every candidate pair made a 5,000-
// record library take a quarter of a second (and the Library facts run it on
// every change). The cache is keyed by the record object and checked against
// the raw fields, since records are edited in place.
const featureCache = new WeakMap();
function features(p) {
  const raw = [p.id, p.title, p.label, authorList(p.authors)[0], p.year, p.doi, p.pmid, p.pdfHash].map(v => String(v ?? '')).join('\u0001');
  const hit = featureCache.get(p);
  if (hit && hit.raw === raw) return hit;
  const t = title(p);
  const f = { raw, t, a: surname(p), y: String(p.year || ''), doi: doi(p.doi), pmid: pmid(p.pmid), sigPdf: String(p.pdfHash || ''),
    pdf: p.pdfHash?.length >= 16 ? p.pdfHash : '', words: words(t) };
  featureCache.set(p, f);
  return f;
}

/**
 * The ids of every record in a duplicate candidate pair, for the Library's
 * Duplicates filter. Worked out again only when a record's identifying
 * fields, the records themselves or the distinct decisions change: the
 * Library used to rerun the whole analysis after any edit anywhere.
 */
let candidateMemo = { feats: null, dismissed: null, ids: null };
export function candidateIds(papers, dismissed = []) {
  const feats = papers.map(features);
  const dkey = dismissed.map(d => `${d.a}|${d.b}|${d.signature}`).join('\n');
  const m = candidateMemo;
  if (m.feats && m.dismissed === dkey && m.feats.length === feats.length && feats.every((f, i) => f === m.feats[i])) return m.ids;
  const data = prepareCandidates(papers, dismissed), ids = new Set();
  // Every shared strong identifier is a candidate even if titles conflict.
  // Count distinct decisions as edges; never materialize the clique's pairs.
  for (const [key, groups] of data.buckets) if (/^(doi|pmid|pdf):/.test(key)) {
    const members = new Set(groups.flatMap(g => g.records.map(p => p.id)));
    for (const id of members) if (members.size - 1 > [...(data.neighbors.get(id) || [])].filter(x => members.has(x)).length) ids.add(id);
  }
  const covered = g => g.records.every(p => ids.has(p.id));
  for (const block of candidateBlocks(data, covered)) if (block?.count) markCandidateIds(block, ids, data.neighbors);
  candidateMemo = { feats, dismissed: dkey, ids };
  return ids;
}

const strengths = ['exact', 'likely', 'possible'];
const featureKey = f => JSON.stringify([f.t, f.a, f.y, f.doi, f.pmid, f.pdf, f.sigPdf]);
const bucketKeys = f => [f.doi && `doi:${f.doi}`, f.pmid && `pmid:${f.pmid}`, f.pdf && `pdf:${f.pdf}`, f.t && `title:${f.t}`,
  f.a && f.y && `author-year:${f.a}:${f.y}`, f.y && f.t && `title-year:${f.t.split(' ').slice(0, 4).join(' ')}:${f.y}`].filter(Boolean);
const groupPair = (a, b) => a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
const groupSignature = (a, b) => [a.f, b.f].map(f => [f.t, f.a, f.y, f.doi, f.pmid, f.sigPdf].join('|')).sort().join('::');
const selfRank = (n, i, j) => i * (2 * n - i - 1) / 2 + j - i - 1;

function prepareCandidates(papers, dismissed) {
  const byFeature = new Map(), byId = new Map(), buckets = new Map(), bucketOrder = new Map();
  papers.forEach((p, index) => {
    const f = features(p), key = featureKey(f); let group = byFeature.get(key);
    if (!group) {
      group = { id: byFeature.size, f, records: [], keys: new Set(bucketKeys(f)), members: new Set() }; byFeature.set(key, group);
      for (const k of group.keys) { if (!buckets.has(k)) { bucketOrder.set(k, bucketOrder.size); buckets.set(k, []); } buckets.get(k).push(group); }
    }
    byId.set(p.id, { group, member: group.records.length, index }); group.records.push(p); group.members.add(p.id);
  });
  const ignored = new Map(), neighbors = new Map();
  const decisions = new Map(dismissed.map(d => [pairKey(d.a, d.b), d]));
  for (const d of decisions.values()) {
    let a = byId.get(d.a), b = byId.get(d.b); if (!a || !b || d.a === d.b || d.signature !== groupSignature(a.group, b.group)) continue;
    if (a.group.id > b.group.id || a.group === b.group && a.member > b.member) [a, b] = [b, a];
    const key = groupPair(a.group, b.group); if (!ignored.has(key)) ignored.set(key, new Set());
    ignored.get(key).add(a.group === b.group ? selfRank(a.group.records.length, a.member, b.member) : a.member * b.group.records.length + b.member);
    for (const [x, y] of [[d.a, d.b], [d.b, d.a]]) { if (!neighbors.has(x)) neighbors.set(x, new Set()); neighbors.get(x).add(y); }
  }
  const exclusions = new Map([...ignored].map(([key, ranks]) => [key, { ranks, sorted: [...ranks].sort((a, b) => a - b) }]));
  const groups = [...byFeature.values()], frequency = new Map();
  // Strong identifiers must own their pairs before fuzzy buckets: a shared
  // DOI can be added later than an author/year bucket yet still requires
  // review when the two titles have no overlapping words.
  const priority = key => /^(doi|pmid|pdf):/.test(key) ? 0 : key.startsWith('title:') ? 1 : 2;
  const ordered = [...buckets.keys()].sort((a, b) => priority(a) - priority(b) || bucketOrder.get(a) - bucketOrder.get(b));
  ordered.forEach((key, index) => bucketOrder.set(key, index));
  for (const g of groups) for (const word of g.f.words) frequency.set(word, (frequency.get(word) || 0) + 1);
  const wordOrder = (a, b) => frequency.get(a) - frequency.get(b) || (a < b ? -1 : a > b ? 1 : 0);
  for (const g of groups) g.prefix = [...g.f.words].sort(wordOrder).slice(0, g.f.words.size - Math.ceil(.7 * g.f.words.size) + 1);
  return { groups, buckets, bucketOrder, exclusions, neighbors, byId, fuzzyIndexes: new Map() };
}

function matchFeatures(fa, fb) {
    const sameDoi = fa.doi && fa.doi === fb.doi;
    const samePmid = fa.pmid && fa.pmid === fb.pmid;
    const samePdf = fa.pdf && fa.pdf === fb.pdf;
    const conflict = (fa.doi && fb.doi && fa.doi !== fb.doi) || (fa.pmid && fb.pmid && fa.pmid !== fb.pmid);
    const sim = !fa.t || !fb.t ? 0 : fa.t === fb.t ? 1 : overlap(fa.words, fb.words);
    const sameAuthor = fa.a && fa.a === fb.a;
    const sameYear = fa.y && fa.y === fb.y;
    let strength, reason;
    const titleConflict = fa.t && fb.t && sim < .4;
    if (sameDoi || samePmid || samePdf) {
      strength = conflict || titleConflict ? 'possible' : 'exact';
      reason = `${sameDoi ? 'Same DOI' : samePmid ? 'Same PMID' : 'Same PDF'}${conflict ? ' · conflicting identifier' : ''}${titleConflict ? ' · different titles' : ''}`;
    } else if (sim === 1 && (sameAuthor || sameYear)) {
      strength = conflict ? 'possible' : 'likely';
      reason = conflict ? 'Same title · conflicting identifier' : 'Same title';
    } else if (sim >= .85 && (sameAuthor || sameYear)) {
      strength = 'likely'; reason = `Similar title (${Math.round(sim * 100)}%)`;
    } else if (sim >= .7 && sameAuthor && sameYear) {
      strength = 'possible'; reason = `Similar title (${Math.round(sim * 100)}%)`;
    } else return null;
    return { reason, strength };
}

// A descriptor represents one Cartesian product (or an unordered clique).
// Identical bibliographic rows collapse to one group, so 10,000 copies of one
// DOI require one descriptor rather than 49,995,000 pair objects. Heterogeneous
// groups are visited lazily, including rejected comparisons, for bounded yields.
function* groupPairs(data, key, groups) {
  if (!/^(author-year|title-year):/.test(key)) {
    for (let i = 0; i < groups.length; i++) for (let j = i; j < groups.length; j++) yield [groups[i], groups[j]];
    return;
  }
  // Any fuzzy candidate shares at least 70% of the larger title's word set.
  // Under one global word order its first common word must therefore occur
  // within both n-ceil(.7*n)+1 prefixes. Rare words first prune unrelated
  // titles without changing the candidate threshold or storing pair objects.
  let inverted = data.fuzzyIndexes.get(key);
  if (!inverted) {
    inverted = new Map();
    for (const g of groups) for (const word of g.prefix) { if (!inverted.has(word)) inverted.set(word, []); inverted.get(word).push(g); }
    data.fuzzyIndexes.set(key, inverted);
  }
  for (const a of groups) for (const word of a.prefix) for (const b of inverted.get(word)) {
    if (a.id >= b.id || Math.min(a.f.words.size, b.f.words.size) < .7 * Math.max(a.f.words.size, b.f.words.size)) continue;
    // A pair belongs only to its earliest common prefix word. Exact title
    // and identifier buckets still own their pairs through bucketOrder.
    if (a.prefix.find(w => b.prefix.includes(w)) !== word) continue;
    yield [a, b];
  }
}
function* candidateBlocks(data, covered = null) {
  for (const [key, groups] of data.buckets) {
    if (covered && groups.every(covered)) continue;
    for (let [a, b] of groupPairs(data, key, groups)) {
      if (a === b && a.records.length < 2 || covered?.(a) && covered?.(b)) { yield null; continue; }
      if ([...a.keys].some(k => b.keys.has(k) && data.bucketOrder.get(k) < data.bucketOrder.get(key))) { yield null; continue; }
      if (a.id > b.id) [a, b] = [b, a];
      const match = matchFeatures(a.f, b.f);
      if (!match) { yield null; continue; }
      const excluded = data.exclusions.get(groupPair(a, b));
      const count = (a === b ? a.records.length * (a.records.length - 1) / 2 : a.records.length * b.records.length) - (excluded?.ranks.size || 0);
      yield { a, b, ...match, count, excluded };
    }
  }
}

function markCandidateIds(block, ids, neighbors) {
  for (const [a, b] of [[block.a, block.b], [block.b, block.a]]) for (const p of a.records) {
    if (ids.has(p.id)) continue;
    const removed = [...(neighbors.get(p.id) || [])].filter(id => b.members.has(id)).length;
    if (b.records.length - (a === b ? 1 : 0) > removed) ids.add(p.id);
  }
}
function pairAt(block, raw, positions) {
  const n = block.a.records.length, m = block.b.records.length; let i, j;
  if (block.a !== block.b) { i = Math.floor(raw / m); j = raw % m; }
  else {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (mid * (2 * n - mid - 1) / 2 <= raw) lo = mid; else hi = mid - 1; }
    i = lo; j = i + 1 + raw - i * (2 * n - i - 1) / 2;
  }
  let a = block.a.records[i], b = block.b.records[j]; if (positions.get(a.id).index > positions.get(b.id).index) [a, b] = [b, a];
  return { a, b, strength: block.strength, reason: block.reason };
}
function appendBlockPage(items, block, offset, limit, data) {
  let raw = offset; for (const rank of block.excluded?.sorted || []) { if (rank <= raw) raw++; else break; }
  const maximum = block.a === block.b ? block.a.records.length * (block.a.records.length - 1) / 2 : block.a.records.length * block.b.records.length;
  while (items.length < limit && raw < maximum) { if (!block.excluded?.ranks.has(raw)) items.push(pairAt(block, raw, data.byId)); raw++; }
}
function pageState(total, page, size) { const pages = Math.max(1, Math.ceil(total / size)), current = Math.min(pages, Math.max(1, page)); return { page: current, pages, total, offset: (current - 1) * size }; }
function completeIndex(data, counts, comparisons) {
  const total = strengths.reduce((n, k) => n + counts[k], 0);
  const walkPage = function* (page, size) {
    const view = pageState(total, page, size), items = []; let offset = view.offset;
    for (const strength of strengths) {
      if (offset >= counts[strength]) { offset -= counts[strength]; continue; }
      for (const block of candidateBlocks(data)) {
        yield null;
        if (!block?.count || block.strength !== strength) continue;
        if (offset >= block.count) { offset -= block.count; continue; }
        appendBlockPage(items, block, offset, size, data); offset = 0;
        if (items.length === size) break;
      }
      if (items.length === size) break;
    }
    return { ...view, items };
  };
  return { total, counts, stats: { records: data.byId.size, groups: data.groups.length, comparisons, storedPairs: 0 },
    page(page = 1, size = 15) { const walk = walkPage(page, size); let next; do { next = walk.next(); } while (!next.done); return next.value; },
    async pageAsync(page = 1, size = 15, options = {}) { return drainAsync(walkPage(page, size), options); } };
}
const pause = () => {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  if (typeof document !== 'undefined' && typeof MessageChannel !== 'undefined') return new Promise(resolve => {
    const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null);
  });
  return new Promise(resolve => setTimeout(resolve, 0));
};
async function drainAsync(walk, { yieldEvery = 256, yieldNow = pause, signal } = {}) {
  let steps = 0, next;
  do { if (signal?.aborted) throw new Error('Duplicate analysis cancelled'); next = walk.next(); if (!next.done && ++steps % yieldEvery === 0) await yieldNow(); } while (!next.done);
  return next.value;
}
function* countBlocks(data) {
  const counts = { exact: 0, likely: 0, possible: 0 }; let comparisons = 0;
  for (const block of candidateBlocks(data)) { comparisons++; if (block?.count) counts[block.strength] += block.count; yield null; }
  return completeIndex(data, counts, comparisons);
}
/** Accurate strongest-first paged review, without retaining candidate pairs. */
export const duplicateFingerprint = (papers, dismissed = []) => JSON.stringify([papers.map(p => features(p).raw), dismissed.map(d => [d.a, d.b, d.signature])]);
export function createDuplicateIndex(papers, dismissed = []) {
  const walk = countBlocks(prepareCandidates(papers, dismissed)); let next; do { next = walk.next(); } while (!next.done); return next.value;
}
export async function createDuplicateIndexAsync(papers, dismissed = [], options = {}) { return drainAsync(countBlocks(prepareCandidates(papers, dismissed)), options); }
/** Compatibility for callers explicitly requesting every pair. The app uses
 * the index/page API; only this legacy all-pairs API materializes all results. */
export function findDuplicates(papers, dismissed = []) { const index = createDuplicateIndex(papers, dismissed); return index.page(1, Math.max(1, index.total)).items; }

function containsId(value, id, seen = new WeakSet()) {
  if (typeof value === 'string')
    return value === id || value.includes(`[@${id}]`) || value.includes(`[@${id} `);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) =>
    key === id || key.startsWith(`${id}:`) || containsId(child, id, seen));
}

/** Pure state operation; fail before changing any field if linked work exists. */
export function mergeRecords(s, keepId, dupId) {
  if (keepId === dupId) throw new Error('Choose two different records.');
  const keep = s.papers.find(p => p.id === keepId), dup = s.papers.find(p => p.id === dupId);
  if (!keep || !dup) throw new Error('A record is no longer in the library.');
  if (keep.mergedFrom?.length || dup.mergedFrom?.length)
    throw new Error('Undo the earlier merge before merging this record.');
  if (dup.pdf && !keep.pdf)
    throw new Error('The record being removed owns a PDF. Keep that record instead.');
  if (s.papers.some(p => p.id !== dupId && containsId(p, dupId)))
    throw new Error('Another record links to this record. Keep this record instead.');
  for (const [area, value] of Object.entries(s)) {
    if (['papers', 'merged', 'dedupDismissed', 'libraryTrash', 'settings'].includes(area)) continue;
    if (containsId(value, dupId)) throw new Error(`This record has linked ${area}. Keep that record instead.`);
  }
  const copied = {};
  for (const field of ['doi', 'pmid', 'journal', 'year', 'volume', 'issue', 'pages', 'url', 'abstract']) {
    if (!keep[field] && dup[field]) { copied[field] = dup[field]; keep[field] = dup[field]; }
  }
  const at = new Date().toISOString();
  const index = s.papers.findIndex(p => p.id === dupId);
  keep.mergedFrom = [...(keep.mergedFrom || []), { id: dupId, at, copied }];
  s.papers = s.papers.filter(p => p.id !== dupId);
  s.merged = [...(s.merged || []), { keepId, dup, at, index }];
  return s;
}

export function unmergeRecords(s, keepId, dupId) {
  const keep = s.papers.find(p => p.id === keepId);
  const entry = (s.merged || []).find(m => m.keepId === keepId && m.dup.id === dupId);
  if (!entry) return s;
  if (keep) {
    const record = (keep.mergedFrom || []).find(m => m.id === dupId);
    if (record?.copied) {
      for (const [field, value] of Object.entries(record.copied))
        if (keep[field] === value) delete keep[field];
    } else if (record?.before) {
      // Earlier versions saved a full before snapshot.
      for (const field of ['doi', 'pmid', 'journal', 'year', 'pdf', 'pdfName', 'authors', 'abstract', 'language']) {
        const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
        if (same(keep[field], entry.dup[field]) && !same(record.before[field], entry.dup[field])) {
          if (Object.hasOwn(record.before, field)) keep[field] = record.before[field];
          else delete keep[field];
        }
      }
    }
    keep.mergedFrom = (keep.mergedFrom || []).filter(m => m.id !== dupId);
  }
  if (!s.papers.some(p => p.id === dupId))
    s.papers.splice(Math.min(entry.index ?? s.papers.length, s.papers.length), 0, entry.dup);
  s.merged = (s.merged || []).filter(m => !(m.keepId === keepId && m.dup.id === dupId));
  return s;
}
