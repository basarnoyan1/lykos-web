// Full-text search across the library's attached PDFs (plan §4.7, "PDF
// annotations and full-text search", 2026-09-29).
//
// Each PDF's text comes from the document index (lib/doctext.mjs), which is
// already cached per document hash. From it this builds an inverted index of
// normalised terms to the pages they occur on, one record per document hash,
// kept in its own IndexedDB database beside the files, not in the project: it
// is derived, rebuilt on demand, and shared by every project that holds the
// same PDF. The page text is kept with it so a phrase can be checked and a
// snippet shown without reopening the PDF.
//
// A query is terms and "quoted phrases", all of which must occur in the paper
// (AND). Terms are compared after case folding, accent stripping and ligature
// expansion, so "Gonzalez" finds "González" and "ﬁxation" finds "fixation".

// ---- pure ---------------------------------------------------------------------

const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'ı': 'i' };
/** One word as it is indexed: lower case, without accents, ligatures spelled out. */
export const normaliseTerm = w => String(w || '').toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[ﬁﬂﬀﬃﬄßæœøłı]/g, c => LIG[c]);
const WORD = /[\p{L}\p{N}]+/gu;

/** The words of a text in order, each with its span in the text it came from. */
export function tokenize(text) {
  const out = [];
  for (const m of String(text || '').matchAll(WORD)) out.push({ term: normaliseTerm(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}
export const terms = text => tokenize(text).map(t => t.term);

/**
 * A query to groups of terms: a quoted phrase is one group of several terms,
 * a bare word is a group of one. Every group must occur (AND). Punctuation
 * inside a bare word splits it, the way the text is split: "follow-up" is the
 * phrase follow up.
 */
export function parseQuery(q) {
  const groups = [];
  const s = String(q || '');
  const re = /"([^"]*)"?|(\S+)/g;
  for (const m of s.matchAll(re)) {
    const t = terms(m[1] ?? m[2]);
    if (t.length) groups.push(t);
  }
  // the same group twice adds nothing
  const seen = new Set();
  return groups.filter(g => { const k = g.join(' '); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Term -> 1-based pages it occurs on, for a document's page texts. */
export function postings(pageTexts) {
  const out = {};
  pageTexts.forEach((text, i) => {
    for (const t of new Set(terms(text))) (out[t] ||= []).push(i + 1);
  });
  return out;
}

/** Whether a document's postings contain every term of every group: a necessary condition for a match. */
export const mayMatch = (post, groups) => groups.length > 0 && groups.every(g => g.every(t => post[t]));

/** Where a group occurs in one page: spans of the page text, one per occurrence. */
function occurrences(tokens, group) {
  const out = [];
  for (let i = 0; i + group.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < group.length; k++) if (tokens[i + k].term !== group[k]) { ok = false; break; }
    if (ok) out.push({ start: tokens[i].start, end: tokens[i + group.length - 1].end });
  }
  return out;
}

/**
 * Matches a query against a document's page texts. Returns null when some
 * group does not occur anywhere; otherwise the number of occurrences and up to
 * `max` snippets in page order, each with its page, the words around it and
 * the matched words themselves (`quote`), which is what the reader locates,
 * and `nth`, which occurrence of those words on the page it is (0 for the first).
 */
export function matchDocument(pageTexts, groups, { max = 3, context = 70 } = {}) {
  if (!groups.length) return null;
  const found = new Set(); let count = 0; const hits = [];
  pageTexts.forEach((text, i) => {
    const tokens = tokenize(text);
    for (const [gi, g] of groups.entries()) {
      const occ = occurrences(tokens, g);
      if (!occ.length) continue;
      found.add(gi); count += occ.length;
      for (const o of occ) hits.push({ page: i + 1, ...o, text });
    }
  });
  if (found.size < groups.length) return null;
  hits.sort((a, b) => a.page - b.page || a.start - b.start);
  const snippets = [];
  for (const h of hits) {
    if (snippets.length >= max) break;
    // one snippet per stretch of text: a second hit inside the first's context is already shown
    const last = snippets.at(-1);
    if (last && last.page === h.page && h.start < last.end + context) continue;
    const from = Math.max(0, h.start - context), to = Math.min(h.text.length, h.end + context);
    const cut = (s, atStart) => atStart ? s.replace(/^\S*\s/, '') : s.replace(/\s\S*$/, '');
    // which occurrence of these words on the page this is, so the reader marks this one and not the first
    const needle = h.text.slice(h.start, h.end).replace(/\s+/g, ' ').toLowerCase(), head = h.text.slice(0, h.start).replace(/\s+/g, ' ').toLowerCase();
    let nth = 0; for (let at = head.indexOf(needle); at >= 0; at = head.indexOf(needle, at + 1)) nth++;
    snippets.push({ page: h.page, end: h.end, nth,
      before: (from > 0 ? '…' : '') + (from > 0 ? cut(h.text.slice(from, h.start), true) : h.text.slice(from, h.start)),
      quote: h.text.slice(h.start, h.end),
      after: (to < h.text.length ? cut(h.text.slice(h.end, to), false) : h.text.slice(h.end, to)) + (to < h.text.length ? '…' : '') });
  }
  return { count, snippets: snippets.map(({ end, ...s }) => s) };
}

/** What identifies the file a record holds, so a replaced PDF is indexed again. */
export const fileSignature = p => [p?.pdfHash || '', p?.pdfName || '', p?.pdfSize || '', p?.pdfRel || '', p?.pdfMode || ''].join('|');

/** The progress line: "Indexed 120 of 300 PDFs". */
export function progressText({ indexed, total, failed = 0, running = false, paused = false }) {
  if (!total) return 'No PDFs attached';
  const base = `Indexed ${indexed} of ${total} PDF${total === 1 ? '' : 's'}`;
  const extra = [failed ? `${failed} could not be read` : '', paused ? 'Paused' : running ? 'Indexing' : ''].filter(Boolean).join(' · ');
  return extra ? `${base} · ${extra}` : base;
}

// ---- browser side -----------------------------------------------------------------
// Imported lazily by the functions below, so the pure part loads in Node.

const DB = 'lykos-fulltext';
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('terms')) d.createObjectStore('terms');   // hash -> { hash, pages, postings }
      if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts');   // hash -> [page text]
      if (!d.objectStoreNames.contains('papers')) d.createObjectStore('papers'); // project|paperId -> { hash, sig } or { failed, sig }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}
const idb = (store, mode, fn) => db().then(d => new Promise((resolve, reject) => {
  const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
  t.oncomplete = () => resolve(r?.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
}));

// The session's view of the index for the open project.
const ft = { project: null, generation: null, epoch: 0, revisions: new Map(), run: null, papers: new Map(), terms: new Map(), loaded: null, running: false, paused: false, queue: [], current: null, listeners: new Set() };
const emit = () => { for (const fn of ft.listeners) { try { fn(); } catch { /* a closed view */ } } };
/** Calls fn on every change of progress; returns a function that stops it. */
export function onIndexChange(fn) { ft.listeners.add(fn); return () => ft.listeners.delete(fn); }

async function store() { return import('../store.mjs'); }
const attached = s => (s.papers || []).filter(p => p.pdf);
const context = s => ({ s, project: ft.project, generation: ft.generation, epoch: ft.epoch });
const live = c => c.s.projectGeneration() === c.generation && c.s.projects().current === c.project && ft.epoch === c.epoch;
const paperLive = (c, p, sig, revision) => {
  const actual = c.s.get().papers?.find(x => x.id === p.id && x.pdf);
  return live(c) && actual && fileSignature(actual) === sig && (ft.revisions.get(p.id) || 0) === revision;
};

/** Loads what is already indexed for this project's papers. */
async function load() {
  const s = await store(), project = s.projects().current, generation = s.projectGeneration();
  if (ft.project !== project || ft.generation !== generation) {
    ft.project = project; ft.generation = generation; ft.epoch++;
    ft.papers = new Map(); ft.terms = new Map(); ft.loaded = null; ft.queue = []; ft.revisions = new Map();
    ft.run = null; ft.running = false; ft.current = null; ft.paused = false;
  }
  if (ft.loaded) return ft.loaded;
  const c = context(s), papers = attached(s.get()).map(p => ({ ...p }));
  ft.loaded = (async () => {
    for (const p of papers) {
      const sig = fileSignature(p), revision = ft.revisions.get(p.id) || 0;
      const rec = await idb('papers', 'readonly', s => s.get(`${project}|${p.id}`)).catch(() => null);
      if (!paperLive(c,p,sig,revision)) { if (!live(c)) return; continue; }
      if (!rec || rec.sig !== sig) continue;
      ft.papers.set(p.id, rec);
      if (rec.hash && !ft.terms.has(rec.hash)) {
        const t = await idb('terms', 'readonly', s => s.get(rec.hash)).catch(() => null);
        if (!paperLive(c,p,sig,revision)) { if (!live(c)) return; ft.papers.delete(p.id); continue; }
        if (t) ft.terms.set(rec.hash, t.postings); else ft.papers.delete(p.id);
      }
    }
  })();
  return ft.loaded;
}

/** The stored index of every project: its bytes and how many documents (Settings > Storage, measured when that page opens). */
export async function fullTextUsage() {
  let bytes = 0, entries = 0;
  for (const name of ['terms', 'texts']) {
    const keys = await idb(name, 'readonly', s => s.getAllKeys());
    if (name === 'texts') entries = keys.length;
    for (const k of keys) bytes += JSON.stringify(await idb(name, 'readonly', s => s.get(k)) ?? '').length;
  }
  return { bytes, entries };
}
/** Forgets the index of every project, including documents no project holds any more; PDFs are indexed again as they are opened. */
export async function clearFullTextIndex() {
  Object.assign(ft, { project: null, generation: null, epoch: ft.epoch + 1, run: null, running: false, current: null, queue: [], papers: new Map(), terms: new Map(), loaded: null });
  for (const name of ['papers', 'terms', 'texts']) {
    const keys = await idb(name, 'readonly', s => s.getAllKeys());
    await idb(name, 'readwrite', s => { keys.forEach(k => s.delete(k)); });
  }
  emit();
}

/** Reads what is already indexed for the open project; call before indexStatus. */
export const loadIndex = () => load();

const current = (p, rec) => rec && rec.sig === fileSignature(p) && (rec.failed || ft.terms.has(rec.hash));
/** Where indexing stands for the open project. */
export function indexStatus(papers) {
  const list = (papers || []).filter(p => p.pdf);
  let indexed = 0, failed = 0;
  for (const p of list) { const r = ft.papers.get(p.id); if (!current(p, r)) continue; if (r.failed) failed++; else indexed++; }
  return { indexed, failed, total: list.length, running: ft.running, paused: ft.paused, current: ft.current };
}

async function indexOne(p, c) {
  const { index } = await import('./doctext.mjs');
  const sig = fileSignature(p), revision = ft.revisions.get(p.id) || 0;
  const valid = () => paperLive(c,p,sig,revision);
  try {
    if (!valid()) return;
    const idx = await index(p.id);
    if (!valid()) return;
    if (p.pdfHash && !p.pdfHash.startsWith(idx.hash)) throw new Error('The indexed document does not match the recorded file version.');
    const texts = idx.pages.map(pg => pg.text || '');
    const post = postings(texts);
    await idb('terms', 'readwrite', s => valid() ? s.put({ hash: idx.hash, pages: texts.length, postings: post }, idx.hash) : null);
    if (!valid()) return;
    await idb('texts', 'readwrite', s => valid() ? s.put(texts, idx.hash) : null);
    if (!valid()) return;
    const rec = { hash: idx.hash, sig, at: new Date().toISOString() };
    await idb('papers', 'readwrite', s => valid() ? s.put(rec, `${c.project}|${p.id}`) : null);
    if (!valid()) return;
    ft.terms.set(idx.hash, post); ft.papers.set(p.id, rec);
  } catch (err) {
    if (!valid()) return;
    const rec = { failed: String(err?.message || err).slice(0, 120), sig };
    ft.papers.set(p.id, rec);
    await idb('papers', 'readwrite', s => valid() ? s.put(rec, `${c.project}|${p.id}`) : null).catch(() => {});
  }
}

/** Indexes every attached PDF not yet indexed, one at a time, until done or paused. */
export async function startIndexing() {
  await load();
  if (ft.running || ft.paused) { emit(); return; }
  const s = await store(), c = context(s), run = Symbol('full-text run');
  if (!live(c)) return;
  if (ft.running || ft.paused) return;
  ft.run = run; ft.running = true; emit();
  try {
    const { get } = s;
    for (;;) {
      if (ft.paused || !live(c) || ft.run !== run) break;
      const papers = attached(get());
      const queued = ft.queue.map(id => papers.find(p => p.id === id)).filter(Boolean);
      ft.queue = [];
      const next = [...queued, ...papers].find(p => !current(p, ft.papers.get(p.id)));
      if (!next) break;
      ft.current = next.id; emit();
      await indexOne({ ...next }, c);
      if (!live(c) || ft.run !== run) break;
      ft.current = null; emit();
      // let the interface breathe between documents
      await new Promise(r => setTimeout(r, 0));
    }
  } finally { if (ft.run === run) { ft.running = false; ft.current = null; ft.run = null; emit(); } }
}
export function pauseIndexing() { ft.paused = true; emit(); }
export function resumeIndexing() { ft.paused = false; return startIndexing(); }
/** Forgets this project's index and builds it again. */
export async function rebuildIndex() {
  await load();
  const c = context(await store());
  const project = ft.project;
  const keys = [...ft.papers.keys()];
  for (const id of keys) {
    if (!live(c)) return;
    ft.revisions.set(id,(ft.revisions.get(id) || 0)+1);
    await idb('papers', 'readwrite', s => live(c) ? s.delete(`${project}|${id}`) : null).catch(() => {});
  }
  if (!live(c)) return;
  ft.papers = new Map(); ft.terms = new Map();
  ft.paused = false;
  emit();
  return startIndexing();
}
/** A paper opened or attached: index it soon, before the rest. Does nothing while paused. */
export async function queuePaper(paperId, { force = false } = {}) {
  if (!paperId) return;
  const s = await store(), generation = s.projectGeneration();
  await load();
  const c = context(s);
  if (generation !== c.generation || !live(c)) return;
  if (force) {
    ft.revisions.set(paperId,(ft.revisions.get(paperId) || 0)+1);
    ft.papers.delete(paperId);
    await idb('papers','readwrite', db => live(c) ? db.delete(`${c.project}|${paperId}`) : null).catch(() => {});
    if (!live(c)) return;
  }
  ft.queue.push(paperId);
  if (ft.paused) return;
  setTimeout(() => { if (live(c)) startIndexing().catch(() => {}); }, 1200);
}

/**
 * Searches the given papers' PDF text. Returns { groups, results: Map
 * paperId -> { count, snippets } } for the papers that match, and how many of
 * the papers were searchable.
 */
export async function searchFullText(query, papers, { snippets = 3 } = {}) {
  await load();
  const c = context(await store());
  const groups = parseQuery(query);
  const results = new Map();
  let searched = 0;
  if (!groups.length) return { groups, results, searched };
  const texts = new Map();
  for (const p of papers) {
    if (!live(c)) return { groups, results: new Map(), searched: 0 };
    const actual = c.s.get().papers?.find(x => x.id === p.id && x.pdf);
    if (!actual || fileSignature(actual) !== fileSignature(p)) continue;
    const rec = ft.papers.get(p.id);
    if (!rec?.hash || rec.sig !== fileSignature(p)) continue;
    const post = ft.terms.get(rec.hash);
    if (!post) continue;
    searched++;
    if (!mayMatch(post, groups)) continue;
    let t = texts.get(rec.hash);
    if (!t) { t = await idb('texts', 'readonly', s => s.get(rec.hash)).catch(() => null); if (!t) continue; texts.set(rec.hash, t); }
    if (!live(c)) return { groups, results: new Map(), searched: 0 };
    if (fileSignature(c.s.get().papers?.find(x => x.id === p.id && x.pdf)) !== rec.sig) continue;
    const m = matchDocument(t, groups, { max: snippets });
    if (m) results.set(p.id, m);
  }
  return { groups, results, searched };
}
