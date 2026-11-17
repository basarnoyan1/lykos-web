// File provenance (docs/Assurance_Plan_2026-11.md, "Provenance and missing files", step 5): for each record, the files it holds,
// when each was obtained, where from and when the file last changed, kept on the record in the store:
//   files: [{ role, path, hash, size, obtainedAt, from: { kind, provider, url, doi }, by, fileModified }]
// A field that is not known is absent, never guessed. The change history of a file is not kept here: it is the project history's
// commit entries for its path (lib/vcs.mjs fileLog). `role` stays general: the expected-files step (plan step 6) reads it.
export const FILE_ROLES = ['article', 'supplement', 'protocol', 'registry', 'erratum'];
export const FROM_KINDS = ['retrieval', 'open-access', 'institution', 'manual', 'folder'];
const MAX_TEXT = 2048;

export const text = v => typeof v === 'string' && v.trim() && v.length <= MAX_TEXT ? v.trim() : '';
export const time = v => { const t = text(v); return t && Number.isFinite(Date.parse(t)) ? t : ''; };
export const relPath = v => { const t = text(v); return t && !t.startsWith('/') && !t.includes('\\') && !t.split('/').includes('..') ? t : ''; };
export const hashOf = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : '';
const sizeOf = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
/** A URL as provenance keeps it: http(s) only, without user name, password, query or fragment (a signed link's token, a proxy's session). */
export function plainUrl(u) {
  try { const x = new URL(String(u || '')); return ['http:', 'https:'].includes(x.protocol) ? `${x.origin}${x.pathname}` : ''; } catch { return ''; }
}
/** A word of lower-case letters and hyphens: a known role or kind, or one a later version adds (kept, not dropped). */
const word = v => typeof v === 'string' && /^[a-z][a-z-]{0,39}$/.test(v) ? v : '';

/** A provenance entry as it is stored: known fields only, in a fixed order, so the same facts always write the same JSON. */
export function fileEntry(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = { role: word(x.role) || 'article' };
  const path = relPath(x.path), hash = hashOf(x.hash), size = sizeOf(x.size), obtainedAt = time(x.obtainedAt), by = text(x.by), fileModified = time(x.fileModified);
  if (path) out.path = path;
  if (hash) out.hash = hash;
  if (size != null) out.size = size;
  if (obtainedAt) out.obtainedAt = obtainedAt;
  const from = fromOf(x.from);
  if (from) out.from = from;
  if (by) out.by = by;
  if (fileModified) out.fileModified = fileModified;
  return out;
}

function fromOf(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const out = {}, kind = word(f.kind), provider = text(f.provider), url = text(f.url), doi = text(f.doi);
  if (kind) out.kind = kind;
  if (provider) out.provider = provider;
  if (url) out.url = url;
  if (doi) out.doi = doi;
  return Object.keys(out).length ? out : null;
}

/** A record's stored list, cleaned: entries that are not entries go. Returns undefined for a record with none. */
export function normalizeFiles(list) {
  if (!Array.isArray(list)) return undefined;
  return list.map(fileEntry).filter(Boolean);
}

// The same file: the same bytes, or the same place (a file changed in place keeps how it was obtained).
export const same = (a, b) => Boolean((a.hash && b.hash && a.hash === b.hash) || (a.path && b.path && a.path === b.path));
const IDENTITY = ['obtainedAt', 'from', 'by'];             // how the file was obtained: the first account stands, its blanks filled
const LOCATION = ['path', 'hash', 'size', 'fileModified'];  // where it is now: the latest account stands

/**
 * Records a file entering a record: `paper.files` gains its entry, or the entry of the same file is brought up to date. A record holds
 * one article: an article that is neither the same bytes nor the same place replaces the one held. Mutates `paper`; returns whether
 * anything changed, so a caller writes nothing for a file seen again.
 */
export function recordFile(paper, input) {
  const e = fileEntry(input);
  if (!paper || typeof paper !== 'object' || !e || (!e.hash && !e.path)) return false;
  const files = normalizeFiles(paper.files) || [];
  const at = e.role === 'article' ? files.findIndex(f => f.role === 'article') : files.findIndex(f => f.role === e.role && same(f, e));
  const before = JSON.stringify(paper.files ?? null);
  if (at < 0) files.push(e);
  else if (!same(files[at], e)) files[at] = e;
  else files[at] = merged(files[at], e);
  if (JSON.stringify(files) === before) return false;
  paper.files = files;
  return true;
}
function merged(was, e) {
  const next = { ...was };
  for (const k of LOCATION) if (e[k] != null) next[k] = e[k];
  for (const k of IDENTITY) {
    if (k === 'from' && next.from && e.from) next.from = { ...e.from, ...next.from };
    else if (next[k] == null && e[k] != null) next[k] = e[k];
  }
  return fileEntry(next);
}

/**
 * Where the record's article is now, from its own fields: the hash, the size and, for a file in the project folder, its path (or a
 * retrieved PDF held as a preview: the hash the retrieval verified). The retrieval's provider, URL, DOI and time are added only when its
 * hash is the article's (lib/change-file.mjs attach_pdf records the hash too): a retrieval left on the record after another file was
 * attached says nothing of that file. Null for a record with no document it can name.
 */
export function knownArticle(p) {
  if (!p || typeof p !== 'object') return null;
  const r = p.pdfRetrieval && typeof p.pdfRetrieval === 'object' && !Array.isArray(p.pdfRetrieval) ? p.pdfRetrieval : null;
  const path = p.pdfMode === 'folder' ? relPath(p.pdfRel) : '';
  // the record's own document; else a retrieved PDF the reader shows from the cache, which the retrieval verified by its hash
  const hash = hashOf(p.pdfHash) || (!path && r?.status === 'preview' ? hashOf(r.hash) : '');
  if (!hash && !path) return null;
  const e = { role: 'article', path, hash, size: sizeOf(p.pdfSize) };
  if (r && hash && r.hash === hash) {
    const provider = text(r.provider);
    e.obtainedAt = r.at;
    e.from = { kind: provider ? kindOf(provider) : '', provider, url: r.url, doi: r.doi };
  }
  return fileEntry(e);
}
/** The kind a retrieval's provider names: lib/paper-download.mjs names the open-access copy "Open access (…)". */
export const kindOf = provider => /^open access\b/i.test(String(provider || '')) ? 'open-access' : 'retrieval';

/**
 * The record's article entry kept in step with its document fields, which every path that attaches, moves, renames or replaces a PDF
 * sets: the entry gains the place and bytes they name, keeps how the file was obtained while it is the same file, is replaced (how it
 * was obtained then unknown) when it is another, and goes when the record holds no document. A record held before step 5 is backfilled
 * so. Other roles are left alone. Mutates `p`; returns whether anything changed. Idempotent.
 */
export function syncArticle(p) {
  if (!p || typeof p !== 'object') return false;
  const want = knownArticle(p), list = normalizeFiles(p.files);
  const at = list ? list.findIndex(f => f.role === 'article') : -1;
  const before = JSON.stringify(p.files ?? null);
  let files = list || [];
  if (!want) { if (at < 0) return false; files = files.filter((_, i) => i !== at); }
  else if (at < 0) files = [want, ...files];
  else if (same(files[at], want)) {
    // the place and bytes are the fields' exactly: a copy the app holds has no path; a size not recorded there stays as it was
    const next = merged(files[at], want);
    if (!want.path) delete next.path;
    files[at] = next;
  }
  else files[at] = want;
  if (JSON.stringify(files) === before) return false;
  if (files.length) p.files = files; else delete p.files;
  return true;
}
/** Every record of a project (main and scenario records) kept in step; the count changed. Runs at each normalisation (lib/project-trim.mjs). */
export function syncProjectFiles(st) {
  let n = 0;
  for (const list of [st?.papers, st?.scenarioPapers]) if (Array.isArray(list)) for (const p of list) if (syncArticle(p)) n++;
  return n;
}

/**
 * An attach: the record's document fields are already set (any path above), and the article's entry records how it was obtained.
 * `facts` is { obtainedAt, from, by, fileModified }; what it leaves out stays unknown.
 */
export function recordArticle(p, facts = {}) {
  const base = knownArticle(p);
  if (!base) return false;
  const { obtainedAt, from, by, fileModified } = facts || {};
  return recordFile(p, { ...base, ...(obtainedAt ? { obtainedAt } : {}), ...(from ? { from: { ...(base.from || {}), ...from } } : {}), ...(by ? { by } : {}), ...(fileModified ? { fileModified } : {}) });
}
