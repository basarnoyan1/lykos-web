// The facts the figure-need rules read (plan §4.15c.4).
//
// collectFacts(folder, state, cache, { budgetBytes, now }) gathers what is true
// of a project folder and its state, as a plain JSON object the pure detector
// (lib/figure-needs.mjs) reads and never reaches around:
//
//   * the folder is scanned (scanFolder, not indexFolder, which would parse every
//     workbook), and a file whose `size:mtime` stamp is unchanged is never read
//     again: what was derived from it is in the cache;
//   * every byte read through the folder is counted by one wrapper, and the
//     automatic reads of a pass stop at `budgetBytes` (4 MB by default); a PNG
//     header is read only for the paths asked for (`png`), a twin pair is hashed
//     only on request (`hashTwins`), no file above 8 MB is read, and a scan that
//     reached its limit says so in a notice;
//   * documents (manuscript, supplement, reviewer comments, response, cover
//     letter) and the guide are reduced to structure: legend numbers, mention
//     ranges with their kind, placeholder brackets, request sentences, guide
//     declarations. Facts carry no document prose beyond the short quoted
//     request sentences, legend fragments and guide lines the rules show as
//     evidence (each clipped), and those are held in memory only;
//   * the files the project was built from (`.lykos/adopted.json`, lib/drift.mjs) are compared with what they held when they
//     were adopted: a file whose stamp is the adopted one is not read; one that moved is read once per stamp (a changed
//     workbook for the cells the record names only), and the facts say only where it, or the app, differs (`drift`);
//   * dates are `mtimeMs`, converted here and nowhere else; a date at or below
//     zero, or more than a day after `now`, is ignored and counted; when most
//     files share one short window the `time` evidence kind is switched off.
//
// Nothing here writes a project file or a sidecar, calls a model, reads a clock
// (`now` is a parameter) or depends on the time zone or locale: the same folder,
// state and cache give the same facts.
import { scanFolder } from './project-folder.mjs';
import { folderIndex, classifyFile } from './folder-map.mjs';
import { parseDocx } from './docx.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { parseDelimited } from './spreadsheet.mjs';
import { documentHash } from './files.mjs';
import { readPngMeta } from './png-meta.mjs';
import { hasFigure, isFigureHash } from './figures.mjs';
import { assetOrderCheck } from './submission-checks.mjs';
import { PRISMA_FIELDS } from '../schema.mjs';
import { coverageState } from './coverage-state.mjs';
import { open as openRegistry } from './figure-registry.mjs';
import { validateStyle } from './figure-style.mjs';
import { scanScript, scanProducer } from './figure-lineage.mjs';
import { legendParagraphs, placeholderLegends, mentionsOf, requestSentences, declarationItems } from './figure-text.mjs';
import { openAdopted, appValues, observe as observeDrift, observeWorkbook } from './drift.mjs';
import { PARAMS, FIGURE_EXTENSIONS, SCRATCH_PATH, FIGURE_NOUNS, DECLINE_WORDS, STATUS_WORDS, FUNCTION_WORDS } from './figure-lexicon.mjs';

export const FACTS_VERSION = 1;
/** Text above this size is skipped (plan §4.15c.4); the 8 MB read cap of PARAMS.FILE_MAX_BYTES comes first. */
export const TEXT_MAX_BYTES = 24 * 1024 * 1024;
/** Documents read per role, newest first. */
const DOCS_PER_ROLE = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLIP = { request: 240, legend: 80, bracket: 60, guide: 200, task: 200, title: 80 };
const SCAN_LIMIT = 5000;

export const NOTICES = Object.freeze({
  scan: `Folder scan stopped at ${SCAN_LIMIT} files`,
  copied: 'File dates in this folder look copied; date checks off',
  ignored: n => `${n} file ${n === 1 ? 'date' : 'dates'} ignored`,
  budget: 'Some files were not read in this pass',
});

const enc = new TextEncoder();
const sha = text => documentHash(enc.encode(text));
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : '';
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const extOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const stemOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const FIGURE_EXT = new Set(FIGURE_EXTENSIONS);
const NOUN_RE = new RegExp(`\\b(?:${FIGURE_NOUNS.join('|')}|figures?)\\b`, 'i');
const DECLINE_RE = new RegExp(`\\b(?:${DECLINE_WORDS.join('|')})\\b`, 'i');
const STATUS_RE = new RegExp(`\\b(?:${STATUS_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

/** A text squeezed to one line and cut to `n` characters (an ellipsis marks the cut). */
export const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** A short deterministic hash of a text (cyrb53, 14 hex digits). Not cryptographic: it only tells two file lists apart. */
function hash53(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Sorted keys at every depth, undefined dropped, a non-finite number null: equal facts serialise equally. */
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canonical(v[k]); return o; }
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

// ---- cache --------------------------------------------------------------------------------
// The cache is any Map-like object. A key that starts with "~" is held in memory only (document
// facts, script text and sidecar text); the others hold no document prose and may be persisted.

/**
 * A cache for one project: a Map that loads from IndexedDB (`figure-cache:<projectId>`) and writes the
 * persistable keys back on `flush()`. Without IndexedDB (a test, the MCP) it is a plain Map.
 */
export async function openFigureCache(projectId, { idb = globalThis.indexedDB } = {}) {
  const cache = new Map();
  const key = `figure-cache:${projectId}`;
  const tx = async (mode, fn) => {
    const db = await new Promise((res, rej) => { const r = idb.open('lykos-figure-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('cache'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try { return await new Promise((res, rej) => { const r = fn(db.transaction('cache', mode).objectStore('cache')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } finally { db.close?.(); }
  };
  cache.persisted = false;
  if (idb) {
    try {
      const saved = await tx('readonly', s => s.get(key));
      if (saved?.v === FACTS_VERSION && isObj(saved.entries)) for (const [k, v] of Object.entries(saved.entries)) cache.set(k, v);
      cache.persisted = true;
    } catch { /* an unreadable cache is an empty one */ }
  }
  cache.flush = async () => {
    if (!idb || !cache.persisted) return false;
    const entries = {};
    for (const [k, v] of cache) if (!k.startsWith('~')) entries[k] = v;
    try { await tx('readwrite', s => s.put({ v: FACTS_VERSION, entries }, key)); return true; } catch { return false; }
  };
  return cache;
}

const fresh = (cache, key, stamp, extra) => {
  const e = cache.get(key);
  return e && e.v === FACTS_VERSION && e.stamp === stamp && (extra === undefined || e.extra === extra) ? e : null;
};
const keep = (cache, key, stamp, value, extra) => { const e = { v: FACTS_VERSION, stamp, ...(extra === undefined ? {} : { extra }), value }; cache.set(key, e); return e; };

// ---- the byte meter -------------------------------------------------------------------------
/** The folder with every read counted. `auto` bytes count against the pass budget, `demand` bytes against the on-demand limit. */
function metered(folder, { budgetBytes, demandBytes }) {
  const meter = { limit: budgetBytes, demandLimit: demandBytes, auto: 0, demand: 0, reads: 0, skipped: [], mode: 'auto' };
  const counted = {
    kind: folder.kind, name: folder.name,
    list: rel => folder.list(rel),
    stat: rel => folder.stat(rel),
    async read(rel) {
      const bytes = await folder.read(rel);
      meter.reads++;
      meter[meter.mode === 'demand' ? 'demand' : 'auto'] += bytes.length;
      return bytes;
    },
  };
  /** Reads `path` (of `size` bytes) when the caps allow; null, and a reason on the record, when not. */
  meter.take = async (path, size, mode = 'auto') => {
    if (size > PARAMS.FILE_MAX_BYTES || size > TEXT_MAX_BYTES) { meter.skipped.push({ path, reason: 'size' }); return null; }
    const used = mode === 'demand' ? meter.demand : meter.auto, limit = mode === 'demand' ? meter.demandLimit : meter.limit;
    if (used + size > limit) { meter.skipped.push({ path, reason: 'budget' }); return null; }
    meter.mode = mode;
    try { return await counted.read(path); }
    catch { meter.skipped.push({ path, reason: 'unreadable' }); return null; }
    finally { meter.mode = 'auto'; }
  };
  return { counted, meter };
}

// ---- the scan, the clock and the roles ------------------------------------------------------
/** The one place a file time is converted: a whole number of milliseconds (0 when the shell gave none). */
const msOf = v => Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0;
const stampOf = e => `${e.size}:${msOf(e.mtime)}`;
const isoMs = v => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

async function scan(counted) {
  const rows = await scanFolder(counted, { maxFiles: SCAN_LIMIT + 1 });
  const truncated = rows.length > SCAN_LIMIT;
  const kept = rows.slice(0, SCAN_LIMIT);
  return { dirs: kept.filter(r => r.dir).length, files: kept.filter(r => !r.dir), truncated };
}

/** The most files in one window of `seconds` seconds, over a sorted list of times. */
function densest(times, seconds) {
  let best = 0, lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] > seconds * 1000) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

function clockOf(files, now) {
  const valid = [];
  let ignored = 0;
  for (const f of files) {
    const t = msOf(f.mtime);
    if (t <= 0 || t > now + DAY_MS) ignored++; else valid.push(t);
  }
  valid.sort((a, b) => a - b);
  const together = densest(valid, PARAMS.COPIED_WINDOW_S);
  const share = files.length ? together / files.length : 0;
  const copied = files.length > 0 && share > PARAMS.COPIED_SHARE;
  return { ignored, copied, timeKind: !copied, window: { files: together, share: Math.round(share * 1000) / 1000 } };
}

const scratchPath = path => path.split('/').some(seg => SCRATCH_PATH.test(seg));

/** Every file with its role and stamp: `{ path, size, mtimeMs, ext, role, older?, archived?, scratch?, copyOf?, version? }`, sorted by path. */
function fileRows(files, now) {
  const entries = files.map(f => ({ path: f.path, size: f.size, mtime: msOf(f.mtime) }));
  const index = folderIndex(entries, { typeId: 'other' });
  const byPath = new Map(index.files.map(f => [f.path, f]));
  return files.map(f => {
    const t = msOf(f.mtime), c = byPath.get(f.path) || {};
    const role = !c.role || c.role === 'copy' ? classifyFile(f.path, { size: f.size }).role : c.role;
    return {
      path: f.path, size: f.size, mtimeMs: t > 0 && t <= now + DAY_MS ? t : null, ext: extOf(f.path), role,
      stamp: stampOf(f),
      ...(c.older ? { older: true } : {}), ...(c.archived ? { archived: true } : {}), ...(scratchPath(f.path) ? { scratch: true } : {}),
      ...(c.copyOf ? { copyOf: c.copyOf } : {}), ...(c.version ? { version: c.version } : {}),
    };
  }).sort((a, b) => byText(a.path, b.path));
}

/** Files with the same name and size in more than one place (decided by name and size; hashing is on request). */
function twinCandidates(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!FIGURE_EXT.has(r.ext)) continue;
    const k = `${baseOf(r.path)}\u0000${r.size}`;
    groups.set(k, [...(groups.get(k) || []), r.path]);
  }
  return [...groups.values()].filter(g => g.length > 1)
    .map(paths => ({ name: baseOf(paths[0]), size: rows.find(r => r.path === paths[0]).size, paths: paths.sort(byText), verified: false, hash: null }))
    .sort((a, b) => byText(a.paths[0], b.paths[0]));
}

// ---- documents --------------------------------------------------------------------------------
const PROSE_SKIP = new Set(['figure', 'table', 'bib', 'toc']);

/** Plain text of parsed Word blocks, one line per paragraph; a table's text joins in only when `tables` is set (a response letter often is one). */
function blocksText(blocks, { tables = false } = {}) {
  const lines = [];
  for (const b of arr(blocks)) {
    if (typeof b?.text !== 'string') continue;
    if (b.type === 'table') { if (tables && b.text) lines.push(...b.text.split('\n')); continue; }
    if (PROSE_SKIP.has(b.type)) continue;
    lines.push(b.text.replace(/\n+/g, ' '));
  }
  return lines.join('\n');
}

/** Most words of an answer kept as `answerTokens` (appearance order, then sorted). */
const ANSWER_TOKENS_MAX = 120;
const ANSWER_STOP = new Set(FUNCTION_WORDS);

/** The lower-case words of an answer, 3 letters or more, distinct, no function word, sorted: a bag of words, never prose. */
export function answerTokensOf(text) {
  const seen = new Set();
  for (const w of String(text ?? '').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) {
    if (ANSWER_STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    if (seen.size >= ANSWER_TOKENS_MAX) break;
  }
  return [...seen].sort(byText);
}

/** A request sentence as a fact: a clipped quote, what asked, and what the answer did (never the answer's text, only its words). */
function requestFact(r, answer = r.response) {
  const reply = String(answer || '');
  return {
    key: r.key, quote: clip(r.text, CLIP.request), nouns: r.nouns, asks: r.asks, from: r.from,
    answered: reply.trim().length > 0, declined: DECLINE_RE.test(reply),
    answerLabels: [...new Set(mentionsOf(reply, { legends: true }).map(m => m.label))],
    answerTokens: answerTokensOf(reply),
  };
}

/** What a text says about figures, as structure: legends, placeholder brackets, mentions (with kind and range), requests. */
export function reduceText(text) {
  return {
    chars: text.length,
    legends: legendParagraphs(text).map(l => ({ kind: l.kind, n: l.n, label: l.label, para: l.para, fragment: clip(l.text, CLIP.legend) })),
    placeholders: placeholderLegends(text).map(p => ({ kind: p.kind, n: p.n, label: p.label, para: p.para, bracket: clip(p.bracket, CLIP.bracket) })),
    mentions: mentionsOf(text).map(m => ({ kind: m.kind, n: m.n, label: m.label, at: m.at, end: m.end, para: m.para })),
  };
}

/** The role a Word file plays for figure detection, or null. */
function docRoleOf(r) {
  if (r.ext !== 'docx') return null;
  if (r.role === 'manuscript') return 'manuscript';
  if (r.role === 'supplement') return 'supplement';
  // the classifier names a cover letter by a substring ("Recovery", "Discovery", "newsletter"); here the word has to be one
  if (r.role === 'cover-letter') return /(?:^|[^a-z])(?:cover|letter)(?![a-z])/i.test(baseOf(r.path)) ? 'cover' : 'manuscript';
  if (r.role === 'reviewer-comments') return /response|reply|rebuttal/i.test(baseOf(r.path)) ? 'response' : 'comments';
  return null;
}

async function readDoc(ctx, row, role) {
  const hit = fresh(ctx.cache, `~doc:${row.path}`, row.stamp, role);
  if (hit) return hit.value;
  const bytes = await ctx.meter.take(row.path, row.size);
  if (!bytes) return null;
  let value;
  try {
    const parsed = await parseDocx(bytes);
    const text = blocksText(parsed.blocks, { tables: role === 'comments' || role === 'response' });
    const asks = role === 'comments' || role === 'response';
    value = {
      path: row.path, role, stamp: row.stamp, mtimeMs: row.mtimeMs, size: row.size,
      paragraphs: text ? text.split('\n').length : 0,
      embedded: arr(parsed.blocks).filter(b => b.type === 'figure').length,
      hash: await sha(blocksText(parsed.blocks, { tables: true })),
      ...reduceText(text), ...(asks ? { requests: requestsOf(role, text) } : {}),
    };
  } catch { value = { path: row.path, role, stamp: row.stamp, mtimeMs: row.mtimeMs, size: row.size, error: 'unreadable' }; }
  keep(ctx.cache, `~doc:${row.path}`, row.stamp, value, role);
  return value;
}

/** Requests of one reviewer or response document: comments are read as the comment half, a response document by its quoted points. */
const requestsOf = (role, text) => (role === 'response' ? requestSentences('', text) : requestSentences(text, '')).map(r => requestFact(r));

/** The Word files to read, in the order the budget is spent: the manuscript of record first, then the newest of each role. */
function documentPlan(rows, registry, state) {
  const live = rows.filter(r => !r.scratch && !r.archived && !r.older && !r.copyOf && docRoleOf(r));
  const chosen = [];
  const add = (r, role) => { if (r && !chosen.some(c => c.row.path === r.path)) chosen.push({ row: r, role }); };
  const byPath = new Map(rows.map(r => [r.path, r]));
  if (registry?.manuscript?.path && byPath.has(registry.manuscript.path)) add(byPath.get(registry.manuscript.path), 'manuscript');
  for (const p of Object.keys(state?.folderMap?.applied || {}).sort()) { const r = byPath.get(p); if (r && docRoleOf(r) === 'manuscript') add(r, 'manuscript'); }
  for (const role of ['manuscript', 'supplement', 'response', 'comments', 'cover']) {
    const list = live.filter(r => docRoleOf(r) === role).sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0) || byText(a.path, b.path));
    for (const r of list.slice(0, DOCS_PER_ROLE)) add(r, role);
  }
  return chosen;
}

/** Documents with the same request sentence become one request that remembers every document that held it. */
function mergeRequests(docs) {
  const found = new Map();
  for (const d of docs) for (const r of arr(d.requests)) {
    const had = found.get(r.key);
    if (!had) { found.set(r.key, { ...r, docs: [d.path] }); continue; }
    had.docs = [...new Set([...had.docs, d.path])].sort(byText);
    had.from = [...new Set([...had.from, ...r.from])].sort();
    had.answered ||= r.answered; had.declined ||= r.declined;
    had.answerLabels = [...new Set([...had.answerLabels, ...r.answerLabels])].sort();
    had.answerTokens = [...new Set([...arr(had.answerTokens), ...arr(r.answerTokens)])].sort(byText).slice(0, ANSWER_TOKENS_MAX);
  }
  return [...found.values()].sort((a, b) => byText(a.key, b.key));
}

// ---- the guide --------------------------------------------------------------------------------
const COMMAND = /^\s*(?:\$\s*)?(?:cd|python3?|node|Rscript|bash|sh|make|npm|npx|\.\/\S+)\s/;

/** A guide as structure: the lines that declare an output behind, the commands it quotes, the status lines about figures. */
function reduceGuide(text) {
  const lines = text.split('\n');
  const commands = [], statusLines = [];
  let fence = false, heading = '';
  lines.forEach((raw, i) => {
    const t = raw.replace(/\r$/, ''), no = i + 1;
    if (/^\s*(```|~~~)/.test(t)) { fence = !fence; return; }
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (!fence && h) { heading = clip(h[1], 60); return; }
    if (fence && COMMAND.test(t) && commands.length < 60) commands.push({ line: no, text: clip(t, CLIP.guide), heading });
    else if (!fence && /\b(?:figures?|figs?\.?|F\d+)\b/i.test(t) && STATUS_RE.test(t) && statusLines.length < 40) statusLines.push({ line: no, text: clip(t, CLIP.guide) });
  });
  const declarations = declarationItems(text).map(d => ({
    line: d.line, text: clip(d.text, CLIP.guide), rule: d.rule, fenced: d.fenced, classes: d.classes, ext: d.ext, pages: d.pages, scope: d.scope, tokens: d.tokens,
  }));
  return { lines: lines.length, declarations, commands, statusLines };
}

async function readGuide(ctx, rows) {
  const guides = rows.filter(r => r.role === 'guide' && !r.scratch && !r.archived).sort((a, b) => a.path.split('/').length - b.path.split('/').length || byText(a.path, b.path));
  const row = guides[0];
  if (!row) return null;
  const hit = fresh(ctx.cache, `~guide:${row.path}`, row.stamp);
  if (hit) return hit.value;
  const bytes = await ctx.meter.take(row.path, row.size);
  if (!bytes) return { path: row.path, stamp: row.stamp, mtimeMs: row.mtimeMs, size: row.size, unread: true };
  const value = { path: row.path, stamp: row.stamp, mtimeMs: row.mtimeMs, size: row.size, ...reduceGuide(new TextDecoder().decode(bytes)) };
  keep(ctx.cache, `~guide:${row.path}`, row.stamp, value);
  return value;
}

// ---- sidecars (registry and style): read, never written ---------------------------------------
const SIDECAR_PATHS = { registry: '.lykos/figure-registry.json', style: '.lykos/figure-style.json' };

/** The folder as readSidecar sees it: a sidecar whose stamp is unchanged is served from the cache, so a rescan reads 0 bytes of it. */
function sidecarFolder(counted, cache) {
  return {
    ...counted,
    async read(rel) {
      const st = await counted.stat(rel);
      const stamp = `${st.size}:${msOf(st.mtime)}`;
      const hit = fresh(cache, `~sidecar:${rel}`, stamp);
      if (hit) return hit.value;
      const bytes = await counted.read(rel);
      keep(cache, `~sidecar:${rel}`, stamp, bytes);
      return bytes;
    },
  };
}

function sidecarFact(answer) {
  return {
    source: answer.source || 'none', exists: !!answer.exists, readOnly: !!answer.readOnly, damaged: !!answer.damaged,
    notice: answer.notice || '', notices: arr(answer.notices), folderChecks: answer.folderChecks !== false, appCopy: !!answer.appCopy,
    hash: answer.hash || null, doc: answer.doc ?? null,
  };
}

/** `over.sidecars` ({ registry, style }, each a readSidecar answer or a bare document) wins; otherwise the sidecars are read through lib/figure-sidecar.mjs, loaded on first use. */
async function readSidecars(counted, cache, over) {
  const out = {};
  const given = isObj(over.sidecars) ? over.sidecars : null;
  let lib = null;
  for (const kind of ['registry', 'style']) {
    const g = given?.[kind];
    if (g) {
      const a = isObj(g) && 'doc' in g ? g : { doc: g, source: 'given', exists: true };
      if (kind === 'registry') { const o = openRegistry(a.doc, { projectId: over.projectId || '' }); out[kind] = sidecarFact({ ...a, doc: o.registry, readOnly: a.readOnly || o.readOnly, notice: a.notice || o.notice }); }
      else { const v = validateStyle(a.doc); out[kind] = sidecarFact({ ...a, doc: v.ok ? v.doc : null, damaged: !v.ok, readOnly: a.readOnly || !v.ok || v.readOnly }); }
      continue;
    }
    try {
      lib ||= await import('./figure-sidecar.mjs');
      const folder = counted ? sidecarFolder(counted, cache) : null;
      const a = await lib.readSidecar(kind, { folder, ...(over.owner !== undefined ? { owner: over.owner } : {}), ...(over.projectId !== undefined ? { projectId: over.projectId } : {}) });
      out[kind] = sidecarFact(a);
    } catch { out[kind] = sidecarFact({ doc: null, source: 'none', notice: `The ${kind} could not be read` }); }
  }
  return out;
}


// ---- adopted files and drift (plan §4.15d) ---------------------------------------------------------------------
/** The adoption record: `over.sidecars.adopted` (an answer or a document) wins, else `.lykos/adopted.json` is read through lib/figure-sidecar.mjs. */
async function readAdopted(counted, cache, over) {
  const g = isObj(over.sidecars) ? over.sidecars.adopted : null;
  if (g) return openAdopted(isObj(g) && 'doc' in g ? g.doc : g, { projectId: over.projectId || '' }).adopted;
  try {
    const lib = await import('./figure-sidecar.mjs');
    const a = await lib.readSidecar('adopted', { folder: sidecarFolder(counted, cache), ...(over.owner !== undefined ? { owner: over.owner } : {}), ...(over.projectId !== undefined ? { projectId: over.projectId } : {}) }, { folderOnly: false });
    return a.doc && a.exists ? a.doc : null;
  } catch { return null; }
}

/** What the folder says now of one adopted file: nothing read when its stamp is the adopted one, else its hash and the cells the record names. */
async function observeAdopted(ctx, row, entry) {
  if (row.stamp === entry.stamp) return { exists: true, stamp: row.stamp, unchanged: true };
  const extra = `${entry.hash}|${entry.cells.length}|${entry.at}`;
  const hit = fresh(ctx.cache, `~drift:${row.path}`, row.stamp, extra);
  if (hit) return hit.value;
  const before = ctx.meter.skipped.length;
  const bytes = await ctx.meter.take(row.path, row.size);
  if (!bytes) return { exists: true, stamp: row.stamp, unread: ctx.meter.skipped.slice(before).at(-1)?.reason || 'unreadable' };
  const value = { exists: true, stamp: row.stamp, hash: await documentHash(bytes) };
  if (value.hash !== entry.hash && entry.cells.length) {
    try {
      if (row.ext === 'xlsx' || row.ext === 'xlsm') Object.assign(value, observeWorkbook(await readXlsx(bytes), entry));
      else if (row.ext === 'csv' || row.ext === 'tsv') Object.assign(value, observeWorkbook({ sheets: [{ name: entry.cells[0].s, rows: parseDelimited(new TextDecoder().decode(bytes), row.ext === 'tsv' ? '\t' : ',').rows }] }, entry));
    } catch { /* cells that cannot be read are said so: the row carries no `cells` */ }
  }
  keep(ctx.cache, `~drift:${row.path}`, row.stamp, value, extra);
  return value;
}

/**
 * Where the files the project was adopted from, and the app, differ now (lib/drift.mjs `observe`), or null when
 * nothing is recorded and nothing imported cites a file. Reads nothing for a file whose stamp is unchanged.
 */
async function driftFacts(ctx, counted, cache, byPath, over, state) {
  const adopted = await readAdopted(counted, cache, over);
  const files = adopted ? Object.values(adopted.files) : [];
  const app = appValues(state, adopted || { files: {} });
  const observed = {};
  for (const e of files) {
    const row = byPath.get(e.path);
    observed[e.path] = row ? await observeAdopted(ctx, row, e) : { exists: false };
  }
  const d = observeDrift(adopted || { files: {} }, observed, app, { exists: p => byPath.has(p) });
  if (!files.length && !d.unadopted.length) return null;
  return { tracked: files.length, files: d.files.filter(f => f.state !== 'same' && f.state !== 'touched'), cells: d.cells, unadopted: d.unadopted };
}

// ---- scripts and what they write -------------------------------------------------------------
const SCRIPT_EXT = new Set(['py', 'js', 'mjs', 'cjs', 'r', 'jsx']);
const globRe = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*')}$`);

/** Reads the project's scripts (text stays in memory, keyed by stamp); returns a path to text map for the lineage reader. */
async function readScripts(ctx, rows, extraPaths) {
  const want = rows.filter(r => !r.scratch && SCRIPT_EXT.has(r.ext) && (r.role === 'script' || extraPaths.has(r.path)));
  const texts = new Map();
  for (const r of want) {
    const hit = fresh(ctx.cache, `~text:${r.path}`, r.stamp);
    if (hit) { texts.set(r.path, hit.value); continue; }
    if (r.size > PARAMS.SCRIPT_MAX_BYTES) { ctx.meter.skipped.push({ path: r.path, reason: 'size' }); continue; }
    const bytes = await ctx.meter.take(r.path, r.size);
    if (!bytes) continue;
    const text = new TextDecoder().decode(bytes);
    keep(ctx.cache, `~text:${r.path}`, r.stamp, text);
    texts.set(r.path, text);
  }
  return { texts, rows: want };
}

/** The files a producer's outputs name, among the project's files. */
function matchOutputs(scan, byPath, figureRows) {
  const found = new Set();
  for (const o of arr(scan.outputs)) {
    if (!o.figure && !FIGURE_EXT.has(extOf(o.path || ''))) continue;
    if (o.how === 'name-table' || o.ext === null) { for (const r of figureRows) if (stemOf(r.path) === o.path) found.add(r.path); continue; }
    if (o.glob) { const re = globRe(baseOf(o.path)); for (const r of figureRows) if (re.test(baseOf(r.path))) found.add(r.path); continue; }
    if (o.expected && byPath.has(o.expected)) { found.add(o.expected); continue; }
    for (const r of figureRows) if (baseOf(r.path) === baseOf(o.path)) found.add(r.path);
  }
  return [...found].sort(byText);
}

const inputFact = (i, byPath) => {
  const row = i.path ? byPath.get(i.path) : null;
  return { path: i.path ?? null, state: i.state ?? null, kind: i.kind || 'bytes', sheet: i.sheet ?? null, via: i.via, resolved: i.resolved === true, exists: !!row, stamp: row?.stamp ?? null, mtimeMs: row?.mtimeMs ?? null };
};

/**
 * Producers of figures: the registry's declared ones (as stored, with the files their outputs name) and, for every
 * root script not already declared, the one its text implies (never run; plan §4.15c.3).
 */
function producersOf(registry, scripts, rows, byPath) {
  const figures = rows.filter(r => FIGURE_EXT.has(r.ext));
  const out = [];
  const ctx = { files: new Set(rows.map(r => r.path)), read: p => scripts.texts.get(p) ?? null, alias: registry?.alias || {} };
  const declared = new Set();
  for (const p of arr(registry?.producers)) {
    const outputs = new Set();
    for (const o of arr(p.outputs)) { if (/[*?]/.test(o)) { const re = globRe(o); for (const r of figures) if (re.test(r.path)) outputs.add(r.path); } else if (byPath.has(o)) outputs.add(o); }
    if (p.script) declared.add(p.script);
    out.push({
      id: p.id, label: p.label, kind: p.kind, via: 'declared', script: p.script ?? null,
      scripts: [...new Set([p.script, ...arr(p.imports)].filter(Boolean))].map(path => ({ path, stamp: byPath.get(path)?.stamp ?? null, mtimeMs: byPath.get(path)?.mtimeMs ?? null })),
      inputs: arr(p.inputs).map(i => inputFact(i, byPath)), outputs: [...outputs].sort(byText), profile: p.profile || 'none',
    });
  }
  // roots: a script nothing else imports
  const imported = new Set();
  const scanned = new Map();
  for (const r of scripts.rows) {
    const text = scripts.texts.get(r.path);
    if (text == null) continue;
    const s = scanScript(text, r.path, ctx);
    scanned.set(r.path, s);
    for (const i of arr(s.imports)) if (i.resolved && i.path) imported.add(i.path);
  }
  for (const r of scripts.rows) {
    if (!scanned.has(r.path) || imported.has(r.path) || declared.has(r.path)) continue;
    const scan = scanProducer(r.path, ctx);
    const outputs = matchOutputs(scan, byPath, figures);
    if (!outputs.length && !arr(scan.outputs).some(o => o.figure)) continue;
    out.push({
      id: `inferred:${r.path}`, label: baseOf(r.path), kind: 'script', via: 'inferred-write', script: r.path,
      scripts: arr(scan.scripts).map(path => ({ path, stamp: byPath.get(path)?.stamp ?? null, mtimeMs: byPath.get(path)?.mtimeMs ?? null })),
      inputs: arr(scan.inputs).map(i => inputFact({ ...i, via: i.via || 'inferred-input' }, byPath)),
      outputs, outputNames: arr(scan.outputs).filter(o => o.figure).map(o => ({ path: o.path, how: o.how, line: o.line ?? null, from: o.from ?? r.path })).slice(0, 200),
      imports: arr(scan.imports).map(i => ({ module: i.module, path: i.path ?? null, resolved: !!i.resolved, line: i.line ?? null, depth: i.depth ?? 1 })),
      run: scan.run ?? null, profile: 'none',
    });
  }
  return out.sort((a, b) => byText(a.id, b.id));
}

// ---- fingerprints (plan §4.15c.4) -----------------------------------------------------------------
const trimRow = row => { const r = arr(row).map(c => String(c ?? '')); while (r.length && r[r.length - 1] === '') r.pop(); return r; };
const trimRows = rows => { const r = arr(rows).map(trimRow); while (r.length && !r.at(-1).length) r.pop(); return r; };

/**
 * The fingerprint of a file's content for the kind of input it is: `cells` is the SHA-256 of the canonical cell values
 * of the named sheets (all when none is named; an Excel re-save with no cell change gives the same value), `text` the
 * SHA-256 of a Word file's paragraph text or of a text file with its line ends normalised, `bytes` documentHash.
 */
export async function fingerprintBytes(bytes, ext, kind, sheets = []) {
  if (kind === 'cells') {
    if (ext === 'xlsx' || ext === 'xlsm') {
      const wb = await readXlsx(bytes);
      const names = sheets.length ? sheets : wb.sheets.map(s => s.name);
      const picked = names.slice().sort(byText).map(n => ({ name: n, rows: trimRows(wb.sheets.find(s => s.name === n)?.rows) }));
      return sha(JSON.stringify(picked));
    }
    if (ext === 'csv' || ext === 'tsv') return sha(JSON.stringify(trimRows(parseDelimited(new TextDecoder().decode(bytes), ext === 'tsv' ? '\t' : ',').rows)));
  }
  if (kind === 'text') {
    if (ext === 'docx') return sha(blocksText((await parseDocx(bytes)).blocks, { tables: true }));
    return sha(new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n'));
  }
  return documentHash(bytes);
}

/** The fingerprint of one input path (all its declared sheets together), cached by stamp: `{ hash, note }`. */
async function fingerprintInput(ctx, row, kind, sheets) {
  const key = `fp:${row.path}|${kind}|${sheets.join(',')}`;
  const hit = fresh(ctx.cache, key, row.stamp);
  if (hit) return hit.value;
  const before = ctx.meter.skipped.length;
  const bytes = await ctx.meter.take(row.path, row.size);
  if (!bytes) return { hash: null, note: ctx.meter.skipped.slice(before).at(-1)?.reason || 'unreadable' };
  let value;
  try { value = { hash: await fingerprintBytes(bytes, row.ext, kind, sheets), note: null }; } catch { value = { hash: null, note: 'unreadable' }; }
  keep(ctx.cache, key, row.stamp, value);
  return value;
}

/** Fills `hash` and `note` on the data inputs of the declared producers; one fingerprint per path. */
async function fingerprintProducers(ctx, producers, byPath) {
  for (const p of producers) {
    if (p.via !== 'declared') continue;
    const groups = new Map();
    for (const i of p.inputs) {
      if (!i.path || !i.resolved || i.kind === 'state' || !i.exists) continue;
      const g = groups.get(i.path) || { kind: i.kind, sheets: [] };
      if (i.sheet) g.sheets.push(i.sheet);
      groups.set(i.path, g);
    }
    for (const [path, g] of [...groups].sort((a, b) => byText(a[0], b[0]))) {
      const r = await fingerprintInput(ctx, byPath.get(path), g.kind, [...new Set(g.sheets)].sort(byText));
      for (const i of p.inputs) if (i.path === path) { i.hash = r.hash; i.note = r.note; }
    }
  }
}

// ---- the observation log (plan §4.15c.3): a derived cache entry, never a sidecar --------------------
/**
 * One entry per output file of a producer: the output's `size:mtime` stamp when a pass first saw it, the stamps (and,
 * for declared producers, the content hashes) of the inputs and scripts then, and `observed`, true when this pass
 * saw the output change (it was rebuilt) while every resolved input was older than it. An unchanged output keeps its
 * entry, so a later input change shows against it; a changed output starts a new one, so a rewrite with identical
 * bytes updates the log and shows no difference in the hashes. A fresh or restored machine has none.
 */
function observe(ctx, producers, byPath, clock, now) {
  const log = {};
  const seen = new Set();
  const margin = PARAMS.ADOPT_MARGIN_S * 1000;
  for (const p of producers) {
    const data = p.inputs.filter(i => i.path && i.resolved && i.exists);
    const inputs = Object.fromEntries(data.map(i => [i.path, i.stamp]).sort((a, b) => byText(a[0], b[0])));
    const scripts = Object.fromEntries(p.scripts.filter(s => s.stamp).map(s => [s.path, s.stamp]).sort((a, b) => byText(a[0], b[0])));
    const hashes = Object.fromEntries(p.inputs.filter(i => i.path && i.hash).map(i => [i.path, i.hash]).sort((a, b) => byText(a[0], b[0])));
    for (const out of p.outputs) {
      if (seen.has(out)) continue;
      seen.add(out);
      const row = byPath.get(out), key = `obs:${out}`, prev = ctx.cache.get(key);
      const same = prev && prev.v === FACTS_VERSION && prev.stamp === row.stamp;
      if (same) { log[out] = { stamp: row.stamp, ...prev.value }; continue; }
      const older = clock.timeKind && row.mtimeMs != null && data.length > 0 && data.every(i => i.mtimeMs != null && i.mtimeMs <= row.mtimeMs - margin);
      const entry = { at: now, observed: !!(prev && older), inputs, scripts, hashes };
      keep(ctx.cache, key, row.stamp, entry);
      log[out] = { stamp: row.stamp, ...entry };
    }
  }
  return log;
}

/** Drops log entries of outputs that are gone (only after a complete scan). */
function forgetObservations(cache, log) {
  for (const k of [...cache.keys()]) if (k.startsWith('obs:') && !(k.slice(4) in log)) cache.delete(k);
}

/** Drops what the cache holds for a file that is no longer there (only after a complete scan). */
function prune(cache, byPath) {
  const pathOf = key => {
    for (const prefix of ['~doc:', '~guide:', '~text:', '~drift:', 'png:', 'twin:']) if (key.startsWith(prefix)) return key.slice(prefix.length);
    return key.startsWith('fp:') ? key.slice(3, key.indexOf('|')) : null;
  };
  for (const k of [...cache.keys()]) { const p = pathOf(k); if (p != null && !byPath.has(p)) cache.delete(k); }
}

// ---- PNG headers and twins, on request ----------------------------------------------------------
async function pngFacts(ctx, byPath, paths) {
  const png = {}, pending = [];
  for (const path of [...new Set(paths)].sort(byText)) {
    const row = byPath.get(path);
    if (!row || row.ext !== 'png') continue;
    const hit = fresh(ctx.cache, `png:${path}`, row.stamp);
    if (hit) { png[path] = hit.value; continue; }
    const bytes = await ctx.meter.take(path, row.size, 'demand');
    if (!bytes) { pending.push(path); continue; }
    const m = readPngMeta(bytes);
    const value = m.error && m.width == null ? { error: m.error } : { width: m.width, height: m.height, dpi: m.dpi, software: m.text?.Software ?? null, ...(m.error ? { error: m.error } : {}) };
    keep(ctx.cache, `png:${path}`, row.stamp, value);
    png[path] = value;
  }
  return { png, pending };
}

async function hashTwins(ctx, byPath, groups) {
  const out = [];
  for (const g of groups) {
    const by = new Map();
    for (const path of g.paths) {
      const row = byPath.get(path);
      let hit = fresh(ctx.cache, `twin:${path}`, row.stamp);
      if (!hit) {
        const bytes = await ctx.meter.take(path, row.size, 'demand');
        if (!bytes) continue;
        hit = keep(ctx.cache, `twin:${path}`, row.stamp, await documentHash(bytes));
      }
      by.set(hit.value, [...(by.get(hit.value) || []), path]);
    }
    for (const [hash, paths] of by) if (paths.length > 1) out.push({ ...g, paths: paths.sort(byText), hash, verified: true });
  }
  return out.sort((a, b) => byText(a.paths[0], b.paths[0]));
}

// ---- state --------------------------------------------------------------------------------------
async function loadStatus() {
  const get = async (file, name) => { try { return (await import(file))[name] ?? null; } catch { return null; } };
  return {
    pooled: await get('./analysis-inputs.mjs', 'pooledInputStatus'), survival: await get('./survival-run.mjs', 'survivalInputStatus'),
    advanced: await get('./advanced-primary.mjs', 'advancedInputStatus'), dta: await get('./dta.mjs', 'dtaStatus'), nma: await get('./nma.mjs', 'nmaStatus'),
    // whether the paper uses an analysis (lib/paper-use-graph.mjs): a pooled result nothing in the paper uses needs no figure of its own
    unused: await get('./paper-use-graph.mjs', 'notUsed'),
  };
}
const safely = (fn, ...args) => { try { return fn ? (fn(...args) ?? null) : null; } catch { return null; } };
const figureKeys = a => [...new Set([...['svg', 'funnel'].filter(k => typeof a?.[k] === 'string' && a[k]), ...Object.keys(a?.figures || {}).filter(k => isFigureHash(a.figures[k]))])].sort(byText);

/** The analyses that can own a figure, with the status the app reports for each (`status` is injectable; null when unknown). */
function analysesOf(s, status) {
  const out = [];
  const add = (id, source, a, st, extra = {}) => out.push({
    id, source, title: clip(a?.title || a?.result?.title || a?.label || id, CLIP.title), measure: a?.measure ?? null, k: Number.isFinite(a?.k) ? a.k : null,
    status: st, svg: hasFigure(a, 'svg'), funnel: hasFigure(a, 'funnel'), figures: figureKeys(a), at: str(a?.at), ...extra,
  });
  if (isObj(s.analysis)) add('primary', 'pooled', s.analysis, safely(status.pooled, s, s.analysis, s.analysis.outcomeId || 'primary'));
  for (const [slot, a] of Object.entries(isObj(s.analyses) ? s.analyses : {}).sort((x, y) => byText(x[0], y[0]))) if (isObj(a)) add(slot, 'pooled', a, safely(status.pooled, s, a, a.outcomeId || slot.split('#')[0]), { outcomeId: a.outcomeId ?? slot.split('#')[0], ...(safely(status.unused, s, a.outcomeId ?? slot.split('#')[0]) === true ? { unused: true } : {}) });
  if (isObj(s.survival)) add('survival', 'survival', s.survival, safely(status.survival, s));
  arr(s.advancedAnalyses).forEach((a, i) => { if (isObj(a)) add(`advanced:${a.id ?? i}`, 'advanced', a.result || a, safely(status.advanced, a, s)); });
  if (isObj(s.dta)) add('dta', 'dta', s.dta, safely(status.dta, s));
  if (isObj(s.nma?.result)) add('nma', 'nma', s.nma.result, safely(status.nma, s));
  return out;
}

function manuscriptOf(s) {
  const m = s.manuscript;
  if (!isObj(m) || !arr(m.blocks).length) return null;
  const blocks = m.blocks, assets = arr(m.assets);
  let missing = [];
  try { missing = assetOrderCheck(blocks, assets).findings.filter(f => f.kind === 'missing').map(f => f.label || f.message).filter(Boolean); } catch { /* a manuscript the check cannot read has no findings */ }
  const text = blocksText(blocks);
  return {
    name: str(m.name), blocks: blocks.length, figureBlocks: blocks.filter(b => b.type === 'figure').length,
    assets: assets.map(a => ({ id: str(a.id), kind: str(a.kind), name: clip(a.name || a.label || '', CLIP.title) })),
    missing: [...new Set(missing)].sort(byText), ...reduceText(text),
  };
}

const taskFact = (t, source) => ({ id: str(t.id), source: str(t.source || t.file || t.from || source), quote: clip(t.text || t.body || '', CLIP.task) });

/** The state the rules read, reduced: outputs, analyses and their input status, the app manuscript, review points, tasks and notes. */
export function stateFacts(s, status = {}) {
  s = isObj(s) ? s : {};
  const applied = isObj(s.folderMap?.applied) ? s.folderMap.applied : {};
  const requestsOfPoint = p => requestSentences(str(p.text), '').map(r => requestFact(r, str(p.response)));
  return {
    outputs: arr(s.outputs).map(o => { const v = arr(o.versions).at(-1); return { id: str(o.id), versions: arr(o.versions).length, n: v?.n ?? 0, at: str(v?.at), kind: str(v?.spec?.kind), title: clip(v?.spec?.title, CLIP.title) }; }),
    analyses: analysesOf(s, status),
    prisma: { filled: PRISMA_FIELDS.filter(f => s.prisma?.[f.id] != null && s.prisma[f.id] !== '').length, total: PRISMA_FIELDS.length },
    manuscript: manuscriptOf(s),
    reviewRounds: arr(s.reviewRounds).map(r => ({ id: str(r.id), at: str(r.at), points: arr(r.points).map(p => ({ id: str(p.id), status: str(p.status), requests: requestsOfPoint(p) })).filter(p => p.requests.length) })).filter(r => r.points.length),
    tasks: [
      ...arr(s.todos).filter(t => t && !t.done && t.status !== 'done' && NOUN_RE.test(str(t.text))).map(t => ({ ...taskFact(t, ''), from: 'todo' })),
      ...arr(s.notes).filter(n => n && !n.archived && !n.done && NOUN_RE.test(str(n.text))).map(n => ({ ...taskFact(n, ''), from: 'note' })),
    ],
    applied: Object.fromEntries(Object.entries(applied).filter(([, v]) => isoMs(v?.at) != null).map(([p, v]) => [p, isoMs(v.at)]).sort((a, b) => byText(a[0], b[0]))),
    valuePaths: [...new Set(Object.values(isObj(s.values) ? s.values : {}).flatMap(v => arr(v?.evidence).map(e => e?.path).filter(p => typeof p === 'string' && p)))].sort(byText),
    coverage: coverageState(s),
  };
}

// ---- collect --------------------------------------------------------------------------------------
/**
 * The facts of a project. `folder` is the open folder (lib/fsys.mjs shape) or null for a project that is not a folder
 * (state facts only); `state` the project state; `cache` a Map-like (see openFigureCache); `options`:
 *   now           ms, required: the only clock (no Date.now in here);
 *   budgetBytes   automatic reads of this pass (default PARAMS.BYTE_BUDGET); pngBudgetBytes bounds the on-demand reads;
 *   png           paths whose PNG header to read (default none); hashTwins: hash files that share name and size;
 *   sidecars      { registry, style } (readSidecar answers or documents) instead of reading them; owner, projectId for that read;
 *   status        { pooled, survival, advanced, dta, nma } input-status functions (default: the app's own, loaded on first use).
 * Never throws for a missing or unreadable file and never writes to the folder.
 */
export async function collectFacts(folder, state, cache = new Map(), options = {}) {
  if (!Number.isFinite(options.now)) throw new TypeError('collectFacts needs options.now, in milliseconds');
  const now = options.now;
  const budget = Number.isFinite(options.budgetBytes) ? options.budgetBytes : PARAMS.BYTE_BUDGET;
  const status = options.status || await loadStatus();
  const st = stateFacts(state, status);
  const base = { version: FACTS_VERSION, now, hasFolder: !!folder, state: st, notices: [] };
  const sidecarOver = { ...(isObj(options.sidecars) ? { sidecars: options.sidecars } : {}), owner: options.owner, projectId: options.projectId };
  if (!folder) {
    return canonical({ ...base, ...(await emptyFolderFacts(cache, sidecarOver)) });
  }
  const { counted, meter } = metered(folder, { budgetBytes: budget, demandBytes: Number.isFinite(options.pngBudgetBytes) ? options.pngBudgetBytes : budget });
  const ctx = { cache, meter };
  const scanned = await scan(counted);
  const clock = clockOf(scanned.files, now);
  const rows = fileRows(scanned.files, now);
  const byPath = new Map(rows.map(r => [r.path, r]));
  const sidecars = await readSidecars(counted, cache, sidecarOver);
  const drift = await driftFacts(ctx, counted, cache, byPath, sidecarOver, state);
  const registry = sidecars.registry?.doc || null;
  const guide = await readGuide(ctx, rows);
  const plan = documentPlan(rows, registry, state);
  const documents = [];
  for (const { row, role } of plan) { const d = await readDoc(ctx, row, role); if (d) documents.push(d); }
  const scripts = await readScripts(ctx, rows, new Set(arr(registry?.producers).flatMap(p => [p.script, ...arr(p.imports)]).filter(Boolean)));
  const producers = producersOf(registry, scripts, rows, byPath);
  await fingerprintProducers(ctx, producers, byPath);
  const observations = observe(ctx, producers, byPath, clock, now);
  if (!scanned.truncated) { forgetObservations(cache, observations); prune(cache, byPath); }
  const pngs = await pngFacts(ctx, byPath, arr(options.png));
  const candidates = twinCandidates(rows);
  const twins = options.hashTwins ? await hashTwins(ctx, byPath, candidates) : candidates;
  const notices = [];
  if (scanned.truncated) notices.push({ id: 'scan', text: NOTICES.scan });
  if (clock.ignored) notices.push({ id: 'clock-ignored', text: NOTICES.ignored(clock.ignored) });
  if (clock.copied) notices.push({ id: 'clock-copied', text: NOTICES.copied });
  const skipped = meter.skipped.filter((x, i, l) => l.findIndex(y => y.path === x.path) === i).sort((a, b) => byText(a.path, b.path));
  if (skipped.some(x => x.reason === 'budget')) notices.push({ id: 'budget', text: NOTICES.budget });
  return canonical({
    ...base, notices,
    scan: { files: scanned.files.length, dirs: scanned.dirs, truncated: scanned.truncated },
    clock, files: rows, twins, sidecars, guide, documents,
    ...(drift ? { drift } : {}),
    requests: mergeRequests(documents),
    producers, observations, png: pngs.png, pngPending: pngs.pending,
    budget: { limit: budget, used: meter.auto, onDemand: meter.demand, reads: meter.reads, skipped },
  });
}

async function emptyFolderFacts(cache, over) {
  const sidecars = await readSidecars(null, cache, over);
  return { scan: { files: 0, dirs: 0, truncated: false }, clock: { ignored: 0, copied: false, timeKind: true, window: { files: 0, share: 0 } }, files: [], twins: [], sidecars, guide: null, documents: [], requests: [], producers: [], observations: {}, png: {}, pngPending: [], budget: { limit: 0, used: 0, onDemand: 0, reads: 0, skipped: [] } };
}
