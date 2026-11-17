// The open project's records, linked once per version of the sections they come from (plan §4.15i): which record an id names, which keys
// of `values` (or any object keyed "<id>:…") belong to a record, which templates have values, and an id-only word index for the text filter
// (lib/paper-search.mjs). It holds ids, ordinals and offsets, never a copy of a record's text: the words of the index are each kept once.
//
// Nothing is built at open. A part is built the first time it is asked for, for the store's live project only, and kept while the sections
// it reads keep their version (store.mjs `sectionsVersion`, which moves with every update that reads or writes them); a tool's or a test's
// project object is answered directly, as before, and nothing is kept for it. Everything is let go when the project closes.
// The S5 record store (docs/Lightness_Storage_Plan_2026-11.md) reads its ids and counts here.
import { store$get as get, store$sectionsVersion as sectionsVersion, store$sectionLoaded as sectionLoaded, store$inUpdate as inUpdate, store$onProjectClose as onProjectClose } from "../boot.mjs";
import { foldSearch } from './search-ranking.mjs';

const kept = new Map();   // part name → { state, at, value }
onProjectClose(() => kept.clear());

/** Whether `s` is the store's live project, outside an update (inside one, `get()` answers a proxy and records may change under us). */
export const isLive = s => !!s && typeof s === 'object' && s === get() && !inUpdate();

// what was kept of a project that is no longer the live one is let go at the next question (a project replaced by an update)
const prune = state => { for (const [name, k] of kept) if (k.state !== state) kept.delete(name); };
// a part of the live project's index, kept by the versions of `sections`
function part(name, sections, build) {
  const state = get();
  prune(state);
  const at = sectionsVersion(...sections), k = kept.get(name);
  if (k && k.state === state && k.at === at) return k.value;
  const value = build(state, k?.state === state ? k.value : null);
  kept.set(name, { state, at, value });
  return value;
}

// ---- ids ---------------------------------------------------------------------------------------------------------------------------
// the first record with an id wins, as `papers.find(p => p.id === id)` answers
const idMap = list => { const m = new Map(); for (const p of list || []) if (p && !m.has(p.id)) m.set(p.id, p); return m; };

/** Records of a section (`papers` by default) by id, as a Map; the live project's is kept, a Map is built for any other. Callers must not change it. */
export function recordsById(s, section = 'papers') {
  if (!isLive(s) || !sectionLoaded(section)) return idMap(s?.[section]);
  return part(`ids:${section}`, [section], st => idMap(st[section]));
}

/** The record an id names in a section: the same record `papers.find(p => p.id === id)` finds. */
export function recordOf(s, id, section = 'papers') {
  if (!isLive(s) || !sectionLoaded(section)) return (s?.[section] || []).find(p => p.id === id);
  return recordsById(s, section).get(id);
}

// ---- keys of an object section that start with a record's id ------------------------------------------------------------------------
// The keys sorted, with each key's place in the object: every key that starts with "<id>:" lies in one run of the sorted list
// (between "<id>:" and "<id>;", ':' + 1 being ';'), and is handed back in the object's own order.
function keyIndex(obj) {
  const own = Object.keys(obj || {}), n = own.length, order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (own[a] < own[b] ? -1 : own[a] > own[b] ? 1 : 0));
  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = own[order[i]];
  return { keys, at: order, count: n, templates: null };
}
const lowerBound = (keys, x) => { let lo = 0, hi = keys.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (keys[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
const keysOf = (s, section) => part(`keys:${section}`, [section], st => keyIndex(st[section]));

/** The keys of `s[section]` (`values` by default) that start with `prefix`, in the object's order: `Object.keys(s.values).filter(k => k.startsWith(prefix))`. */
export function keysWithPrefix(s, prefix, section = 'values') {
  if (!isLive(s)) return Object.keys(s?.[section] || {}).filter(k => k.startsWith(prefix));
  const ix = keysOf(s, section), from = lowerBound(ix.keys, prefix), out = [];
  for (let i = from; i < ix.keys.length && ix.keys[i].startsWith(prefix); i++) out.push(i);
  return out.sort((a, b) => ix.at[a] - ix.at[b]).map(i => ix.keys[i]);
}

/** A record's values (or proposals) as [key, value] pairs, in the object's order: `Object.entries(s.values).filter(([k]) => k.startsWith(id + ':'))`. */
export function entriesOf(s, id, section = 'values') {
  const obj = s?.[section] || {};
  return keysWithPrefix(s, `${id}:`, section).map(k => [k, obj[k]]);
}

/**
 * A record's cells of `values` (or `proposals`) as [key, value] pairs, in the object's order: the keys "<id>:…" that belong to this record,
 * not to a longer record id that starts with "<id>:" (an id may hold ':'; the longest known id wins, as lib/project-index.mjs had it).
 */
export function cellsOf(s, id, section = 'values') {
  const own = entriesOf(s, id, section), cut0 = String(id).length;
  if (!own.length) return own;
  const ids = recordsById(s);
  return own.filter(([k]) => {
    let cut = k.lastIndexOf(':');
    while (cut > cut0 && !ids.has(k.slice(0, cut))) cut = k.lastIndexOf(':', cut - 1);
    return cut === cut0;
  });
}

/** A record's notes (`s.notes` whose `paper` is the id), in the list's order; the live project's map is kept by `notes`. Callers must not change it. */
export function notesOf(s, id) {
  const group = list => { const m = new Map(); for (const n of list || []) { if (!m.has(n?.paper)) m.set(n?.paper, []); m.get(n?.paper).push(n); } return m; };
  if (!isLive(s) || !sectionLoaded('notes')) return (s?.notes || []).filter(n => n?.paper === id);
  return part('notes:byRecord', ['notes'], st => group(st.notes)).get(id) || [];
}

/** Anything built from the live project kept while `sections` keep their version (`build(s)` for any other project): a caller's own index. */
export function keptBy(s, name, sections, build) {
  if (!isLive(s) || !sections.every(sectionLoaded)) return build(s);
  return part(`own:${name}`, sections, build);
}

/** How many keys `s[section]` has: `Object.keys(s.values).length`, without the copy. */
export function keyCount(s, section = 'values') {
  return isLive(s) ? keysOf(s, section).count : Object.keys(s?.[section] || {}).length;
}

// "<paper>:<template>.<column>": the text between a ':' and the next '.', with no ':' between them, for every ':' of every key
function templatesIn(keys) {
  const out = new Set();
  for (const k of keys) for (let i = k.indexOf(':'); i >= 0; i = k.indexOf(':', i + 1)) {
    const dot = k.indexOf('.', i + 1), next = k.indexOf(':', i + 1);
    if (dot > i && (next < 0 || next > dot)) out.add(k.slice(i + 1, dot));
  }
  return out;
}
/** Whether any key of `values` holds a column of template `tid`: `Object.keys(s.values).some(k => k.includes(':' + tid + '.'))`. */
export function hasTemplateValues(s, tid) {
  const t = String(tid);
  if (!isLive(s) || t.includes(':') || t.includes('.')) return Object.keys(s?.values || {}).some(k => k.includes(`:${t}.`));
  const ix = keysOf(s, 'values');
  return (ix.templates ||= templatesIn(ix.keys)).has(t);
}

// ---- words: the text filter ---------------------------------------------------------------------------------------------------------
// The fields a person searches a record by, as lib/paper-search.mjs always joined them.
export const searchParts = p => [p.label, p.title, p.journal, p.year, p.doi, p.pmid, ...(Array.isArray(p.authors) ? p.authors : [p.authors])].join(' ');
export const hayOf = p => foldSearch(searchParts(p));
// A query's words never hold white space, so a word is in a record's folded text exactly when it is inside one of the record's words
// (split at white space as the query is): the index keeps each distinct word once, in one string, and for each the records that have it.
const SPACE = /\s+/;
// A record's searched fields hashed as their join would be, without making the joined text: a record edited since the build is found by it.
const FNV = 0x811c9dc5;
function hashParts(p) {
  let h = FNV, size = 0, first = true;
  const feed = v => {
    if (!first) { h ^= 32; h = Math.imul(h, 0x01000193); size++; }
    first = false;
    if (v == null) return;
    const t = typeof v === 'string' ? v : String(v);
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    size += t.length;
  };
  feed(p.label); feed(p.title); feed(p.journal); feed(p.year); feed(p.doi); feed(p.pmid);
  if (Array.isArray(p.authors)) { if (p.authors.length) for (const a of p.authors) feed(a); else feed(undefined); } else feed(p.authors);
  return [h >>> 0, size];
}
// records changed or added since the build, answered from their own text until this many, then built again
const OVERLAY_MAX = n => Math.max(256, n >> 5);
const SHORT_LIST = 200;
const SLICE_MS = 8, SLICE_ROWS = 512;

// The build, a step at a time: `hays[i]` and `sums[i]` are record i's folded text and hash, taken together (one moment of the record).
function* wordSteps(recs, hays, sums) {
  const n = recs.length, words = new Map(), last = [];
  let pairs = new Uint32Array(1 << 16), count = 0;
  for (let i = 0; i < n; i++) {
    for (const w of hays[i].split(SPACE)) {
      if (!w) continue;
      let id = words.get(w);
      if (id === undefined) { id = words.size; words.set(w, id); last.push(-1); }
      if (last[id] === i) continue;
      last[id] = i;
      if (count + 2 > pairs.length) { const grown = new Uint32Array(pairs.length * 2); grown.set(pairs); pairs = grown; }
      pairs[count++] = id; pairs[count++] = i;
    }
    if ((i & (SLICE_ROWS - 1)) === SLICE_ROWS - 1) yield;
  }
  const nw = words.size, start = new Uint32Array(nw + 1);
  for (let k = 0; k < count; k += 2) start[pairs[k] + 1]++;
  for (let w = 0; w < nw; w++) start[w + 1] += start[w];
  const post = new Uint32Array(count >> 1), fill = start.slice(0, nw);
  for (let k = 0; k < count; k += 2) post[fill[pairs[k]]++] = pairs[k + 1];   // records in order within each word
  pairs = null;
  yield;
  // the words in one string, '\n' between them (never inside one), and where each begins
  const text = [...words.keys()].join('\n'), begin = new Uint32Array(nw + 1);
  let w = 0;
  for (const word of words.keys()) { begin[w + 1] = begin[w] + word.length + 1; w++; }
  return { recs, ord: ordOf(recs), hash: sums.hash, size: sums.size, text, begin, start, post, words: nw, stale: null, extra: new Map(), memo: new Map() };
}
const ordOf = recs => { const ord = new Map(); for (let i = 0; i < recs.length; i++) if (!ord.has(recs[i]?.id)) ord.set(recs[i]?.id, i); return ord; };
// each record's folded text and hash, at one moment
function foldAll(recs) {
  const n = recs.length, hays = new Array(n), hash = new Uint32Array(n), size = new Uint32Array(n);
  for (let i = 0; i < n; i++) { hays[i] = hayOf(recs[i]); [hash[i], size[i]] = hashParts(recs[i]); }
  return { hays, sums: { hash, size } };
}
/** The word index of a list of records, built at once (tests, tools); the app builds it in slices (`matchTerms`). */
export function buildWords(list) {
  const recs = list.slice(), { hays, sums } = foldAll(recs), steps = wordSteps(recs, hays, sums);
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}

// the words that hold `t`, by searching the one string and finding each hit's word
function wordsHolding(ix, t) {
  const out = [];
  if (!t) return out;
  for (let at = ix.text.indexOf(t); at >= 0;) {
    let lo = 0, hi = ix.words - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (ix.begin[mid] <= at) lo = mid; else hi = mid - 1; }
    out.push(lo);
    at = ix.text.indexOf(t, ix.begin[lo + 1]);   // the next word: one hit per word
  }
  return out;
}
const wordAt = (ix, w) => ix.text.slice(ix.begin[w], ix.begin[w + 1] - 1);
// the records holding any of these words, as a bitmap over the index's records
function recordsOf(ix, wordIds) {
  const hit = new Uint8Array(ix.recs.length);
  for (const w of wordIds) for (let k = ix.start[w]; k < ix.start[w + 1]; k++) hit[ix.post[k]] = 1;
  return hit;
}
function termHits(ix, t) {
  let hit = ix.memo.get(t);
  if (!hit) { hit = recordsOf(ix, wordsHolding(ix, t)); if (ix.memo.size >= 16) ix.memo.delete(ix.memo.keys().next().value); ix.memo.set(t, hit); }
  return hit;
}

// Brings an index kept from an earlier version up to date: a record whose searched fields changed, or one the build did not see, is
// answered from its own text (`extra`) and its old words no longer count (`stale`); too many such records and the index is built again.
function refresh(ix, list) {
  const extra = new Map(), stale = new Uint8Array(ix.recs.length);
  for (const p of list) {
    const i = ix.ord.get(p?.id);
    if (i !== undefined && ix.recs[i] === p) {
      const [h, size] = hashParts(p);
      if (size === ix.size[i] && h === ix.hash[i]) continue;
      stale[i] = 1;
    }
    if (p && !extra.has(p)) extra.set(p, hayOf(p));
    if (extra.size > OVERLAY_MAX(list.length)) return null;
  }
  ix.extra = extra; ix.stale = extra.size ? stale : null; ix.memo = new Map();
  return ix;
}

// the kept index of a section, brought up to its current version; null when there is none, or too much changed (built again)
function current(section, s) {
  prune(s);
  const key = `words:${section}`, k = kept.get(key);
  if (!k || k.state !== s) return null;
  const at = sectionsVersion(section);
  if (k.at === at) return k.value;
  const ix = refresh(k.value, s[section]);
  if (!ix) { kept.delete(key); return null; }
  kept.set(key, { state: s, at, value: ix });
  return ix;
}

/** The live project's word index of a section, built at once if it does not exist; null for a section on disk or no project. */
export function wordIndex(section = 'papers') {
  const s = get();
  if (!s || inUpdate() || !sectionLoaded(section) || !Array.isArray(s[section])) return null;
  const ix = current(section, s);
  if (ix) return ix;
  const built = buildWords(s[section]);
  kept.set(`words:${section}`, { state: s, at: sectionsVersion(section), value: built });
  return built;
}

/** The words index has for a record of a section, when it knows that record as it is now (else null: answer from its text). */
const knows = (ix, p) => { const i = ix.ord.get(p?.id); return i !== undefined && ix.recs[i] === p && !(ix.stale && ix.stale[i]) ? i : -1; };

// A build under way: the section's records as they were when it began, their folded text (what queries read meanwhile, as before the
// index), and the steps still to run, a slice at a time between the person's work.
const builds = new Map();
onProjectClose(() => { for (const b of builds.values()) clearTimeout(b.timer); builds.clear(); });
function startBuild(section, state) {
  const recs = state[section].slice(), { hays, sums } = foldAll(recs);
  const b = { state, at: sectionsVersion(section), recs, ord: ordOf(recs), hays, steps: wordSteps(recs, hays, sums), timer: 0 };
  const slice = () => {
    if (builds.get(section) !== b) return;
    if (get() !== b.state) { builds.delete(section); return; }
    const until = performance.now() + SLICE_MS;
    for (;;) {
      const r = b.steps.next();
      if (r.done) { builds.delete(section); kept.set(`words:${section}`, { state: b.state, at: b.at, value: r.value }); return; }
      if (performance.now() >= until) break;
    }
    b.timer = setTimeout(slice, 0);
  };
  builds.set(section, b);
  b.timer = setTimeout(slice, 0);
  return b;
}
// a record's folded text while the build runs: the build's own while the section is as it began, else read now
const hayDuring = (b, section, p) => { const i = b.ord.get(p?.id); return i !== undefined && b.recs[i] === p && sectionsVersion(section) === b.at ? b.hays[i] : hayOf(p); };

/** The sections of the live project a list's records come from (by the first, middle and last record's id and identity). */
function sectionsOf(s, list) {
  const probe = [list[0], list[list.length >> 1], list[list.length - 1]];
  return ['papers', 'scenarioPapers'].filter(section => sectionLoaded(section) && Array.isArray(s[section]) && s[section].length
    && probe.some(p => recordsById(s, section).get(p?.id) === p));
}
const sectionOf = (s, list) => sectionsOf(s, list)[0] || null;

/**
 * The records of `list` whose folded text holds every term, in the list's order, through the live project's index; null when the index
 * cannot answer (no live project, a short list before the index exists, records of no section): the caller reads the records' text.
 * The first long list starts its sections' indexes, built in slices; until one is done, queries read the folded text it keeps for the build.
 * A list may hold records of both sections (a scenario's view): each record is answered by its own section's index.
 */
export function matchTerms(list, terms) {
  if (!terms.length || !list.length) return null;
  const s = get();
  if (!s || inUpdate()) return null;
  const sections = sectionsOf(s, list);
  if (!sections.length) return null;
  const answer = [];
  for (const section of sections) {
    const ix = current(section, s);
    if (ix) { answer.push({ ix, hits: terms.map(t => termHits(ix, t)) }); continue; }
    let b = builds.get(section);
    if (!b || b.state !== s) {
      if (list.length < SHORT_LIST) return null;
      b = startBuild(section, s);
    }
    answer.push({ b, section });
  }
  const holds = hay => terms.every(t => hay.includes(t));
  return list.filter(p => {
    for (const a of answer) {
      if (a.ix) {
        const i = knows(a.ix, p);
        if (i >= 0) { for (const h of a.hits) if (!h[i]) return false; return true; }
        const own = a.ix.extra.get(p);
        if (own !== undefined) return holds(own);
      } else {
        const i = a.b.ord.get(p?.id);
        if (i !== undefined && a.b.recs[i] === p) return holds(hayDuring(a.b, a.section, p));
      }
    }
    return holds(hayOf(p));
  });
}

/** Resolves once no index is being built (tests and measurements). */
export const whenIndexed = () => new Promise(resolve => { const wait = () => (builds.size ? setTimeout(wait, 5) : resolve()); wait(); });

/**
 * The loose pass of the text filter (lib/search-smart.mjs `loosen`: stems first, else one typing slip, for every term), through the index's
 * words for the records it knows and through their own text for the others; through the folded text the build keeps while one runs.
 * `smart` is that module. Answers what `smart.loosen(list, hays, terms)` answers.
 */
export function loosenTerms(list, terms, smart) {
  const s = get();
  const section = s && !inUpdate() && list.length ? sectionOf(s, list) : null, ix = section && current(section, s);
  const b = section && !ix ? builds.get(section) : null;
  if (!ix) return smart.loosen(list, new Map(list.map(p => [p, b && b.state === s ? hayDuring(b, section, p) : hayOf(p)])), terms);
  const formsOf = terms.map(t => smart.forms(t).map(f => f.t));
  const unknown = list.filter(p => knows(ix, p) < 0);
  // a form with white space may span two words: the records' own text answers it
  if (formsOf.flat().some(f => SPACE.test(f) || !f)) return smart.loosen(list, new Map(list.map(p => [p, knows(ix, p) >= 0 ? hayOf(p) : ix.extra.get(p) ?? hayOf(p)])), terms);
  const own = unknown.length ? new Map(unknown.map(p => [p, ix.extra.get(p) ?? hayOf(p)])) : null;
  const wordsOf = text => text.split(/[^a-z0-9]+/).filter(Boolean);
  const run = (hitsOf, ownOk) => {
    const hits = terms.map(hitsOf);
    return list.filter(p => { const i = knows(ix, p); return i >= 0 ? hits.every(h => h[i]) : terms.every((t, j) => ownOk(own.get(p), t, j)); });
  };
  const stems = run((t, j) => recordsOf(ix, [...new Set(formsOf[j].flatMap(f => wordsHolding(ix, f)))]), (hay, t, j) => formsOf[j].some(f => hay.includes(f)));
  if (stems.length) return stems;
  return run(t => {
    const k = smart.slip(t);
    if (k <= 0) return new Uint8Array(ix.recs.length);
    const near = [];
    for (let w = 0; w < ix.words; w++) if (wordsOf(wordAt(ix, w)).some(x => smart.near(t, x, k))) near.push(w);
    return recordsOf(ix, near);
  }, (hay, t) => smart.slip(t) > 0 && wordsOf(hay).some(w => smart.near(t, w, smart.slip(t))));
}
