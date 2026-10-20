// The qualitative coding workspace for a study's own data (views/coding.mjs):
// interview and focus-group transcripts, documents and survey free text coded
// with a hierarchical codebook. A review's thematic synthesis keeps `s.qes`
// (lib/qes.mjs); a primary study's corpus lives in `s.qual`:
//
//   documents:   [{ id, name, kind: 'transcript'|'document'|'survey', text, source, caseId, speakers: { name: caseId }, version, at }]
//   codes:       [{ id, label, short, parent, description, guid?, at }]
//   codings:     [{ id, docId, start, end, codeIds, coder, at, exemplar, weight }]
//   cases:       [{ id, label, attributes: { attrId: value } }]
//   attributes:  [{ id, label, type: 'text'|'number'|'category' }]
//   memos:       [{ id, kind: 'code'|'document'|'case'|'coding', target, text, by, at }]
//   descriptive, analytical: themes in the shape of lib/qes.mjs, whose theme
//                functions are reused here unchanged (themes group codes)
//   framework:   { cells: { 'row|col': text } }
//   codebookVersion: a counter raised by every change to the codebook
//   coder:       who is coding on this machine, stamped on new codings
//
// A coding is a character range [start, end) in its document's text. Every
// edit to a document's text goes through editText/replaceRanges, which move
// codings with the text (shiftRange), so offsets stay right after an edit or
// pseudonymisation. Mutators change the state in place, for store.update().
import { addTheme, setMembers, merge as qesMerge, remove as qesRemove, setStatement, rename as qesRename } from './qes.mjs';
import { parseTurns, turnAt } from './qual-text.mjs';

export const uid = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();
const LISTS = ['documents', 'codes', 'codings', 'cases', 'attributes', 'memos', 'descriptive', 'analytical'];

/** The workspace, with every list present. Creates it on a state being updated. */
export function qualOf(s) {
  s.qual ||= {};
  for (const k of LISTS) if (!Array.isArray(s.qual[k])) s.qual[k] = [];
  s.qual.framework ||= { cells: {} };
  s.qual.framework.cells ||= {};
  s.qual.codebookVersion ||= 0;
  return s.qual;
}
const EMPTY = () => ({ documents: [], codes: [], codings: [], cases: [], attributes: [], memos: [], descriptive: [], analytical: [], framework: { cells: {} }, codebookVersion: 0, coder: '' });
/** Read-only view for rendering: never writes to the state. */
export const readQual = s => ({ ...EMPTY(), ...(s?.qual || {}) });

/** A saved workspace brought to the current shape; anything malformed is dropped rather than trusted. */
export function normalizeQual(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const out = { ...EMPTY(), ...q };
  for (const k of LISTS) out[k] = Array.isArray(q[k]) ? q[k].filter(x => x && typeof x === 'object' && x.id) : [];
  out.documents = out.documents.filter(d => typeof d.text === 'string').map(d => ({ kind: 'document', speakers: {}, caseId: null, version: 1, ...d }));
  out.codes = out.codes.filter(c => typeof c.label === 'string').map(c => ({ parent: null, description: '', ...c }));
  const docs = new Map(out.documents.map(d => [d.id, d])), codes = new Set(out.codes.map(c => c.id));
  for (const c of out.codes) if (c.parent && (!codes.has(c.parent) || c.parent === c.id)) c.parent = null;
  out.codings = out.codings.filter(x => docs.has(x.docId) && Number.isInteger(x.start) && Number.isInteger(x.end) && x.start < x.end && x.end <= docs.get(x.docId).text.length)
    .map(x => ({ coder: '', exemplar: false, weight: null, ...x, codeIds: (Array.isArray(x.codeIds) ? x.codeIds : []).filter(id => codes.has(id)) }))
    .filter(x => x.codeIds.length);
  out.cases = out.cases.map(c => ({ attributes: {}, ...c }));
  out.framework = q.framework && typeof q.framework === 'object' ? { cells: { ...(q.framework.cells || {}) } } : { cells: {} };
  out.codebookVersion = Number.isInteger(q.codebookVersion) ? q.codebookVersion : 0;
  return out;
}
const bump = q => { q.codebookVersion = (q.codebookVersion || 0) + 1; };

// ---- documents --------------------------------------------------------------
/** A new document. `text` is kept with Unix line ends; returns its id. */
export function addDocument(s, { name, text, kind = 'document', source = null, caseId = null }) {
  const q = qualOf(s), body = String(text ?? '').replace(/\r\n?/g, '\n');
  const d = { id: uid('d'), name: clean(name) || 'Untitled', kind, text: body, source, caseId, speakers: {}, version: 1, at: now() };
  if (kind === 'document' && parseTurns(body).length >= 2) d.kind = 'transcript';
  q.documents.push(d);
  return d.id;
}
export const docById = (s, id) => readQual(s).documents.find(d => d.id === id) || null;

/** Removes documents with their codings and the memos on them and on their codings. */
export function removeDocuments(s, ids) {
  const q = qualOf(s), gone = new Set(ids);
  const lost = new Set(q.codings.filter(x => gone.has(x.docId)).map(x => x.id));
  q.documents = q.documents.filter(d => !gone.has(d.id));
  q.codings = q.codings.filter(x => !gone.has(x.docId));
  q.memos = q.memos.filter(m => !(m.kind === 'document' && gone.has(m.target)) && !(m.kind === 'coding' && lost.has(m.target)));
  pruneFramework(q);
}
export function renameDocument(s, id, name) { const d = qualOf(s).documents.find(x => x.id === id); if (d && clean(name)) d.name = clean(name); }

// ---- the edit model ---------------------------------------------------------
/**
 * Where a range lands after the text in [at, at + removed) is replaced by
 * `inserted` characters. Text inserted exactly at a range's start or end stays
 * outside it; a replacement inside or at the edge of a range stays inside it.
 * Returns [start, end], or null when the range's text was deleted entirely.
 */
export function shiftRange(start, end, at, removed, inserted) {
  const delta = inserted - removed, stop = at + removed;
  const mapStart = p => (p <= at ? p : p >= stop ? p + delta : at);
  const mapEnd = p => (p <= at ? p : p >= stop ? p + delta : at + inserted);
  let a = mapStart(start), b = mapEnd(end);
  if (removed === 0 && start === at) a = start + delta;   // an insertion at the start is outside
  if (removed === 0 && end === at) b = end;
  return b > a ? [a, b] : null;
}

/** The one edited region between two texts: { at, removed, inserted }, or null when equal. */
export function diffText(before, after) {
  const a = String(before ?? ''), b = String(after ?? '');
  if (a === b) return null;
  let p = 0; const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let e = 0;
  while (e < max - p && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { at: p, removed: a.length - p - e, inserted: b.length - p - e };
}

function shiftCodings(q, docId, at, removed, inserted) {
  const drop = new Set();
  for (const x of q.codings) {
    if (x.docId !== docId) continue;
    const r = shiftRange(x.start, x.end, at, removed, inserted);
    if (r) [x.start, x.end] = r; else drop.add(x.id);
  }
  if (drop.size) { q.codings = q.codings.filter(x => !drop.has(x.id)); q.memos = q.memos.filter(m => !(m.kind === 'coding' && drop.has(m.target))); }
  return drop.size;
}

/** Replaces a document's text, moving its codings with the edit. Returns { dropped } codings whose text was deleted. */
export function editText(s, docId, text) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId); if (!d) return { dropped: 0 };
  const next = String(text ?? '').replace(/\r\n?/g, '\n'), e = diffText(d.text, next);
  if (!e) return { dropped: 0 };
  const dropped = shiftCodings(q, docId, e.at, e.removed, e.inserted);
  d.text = next; d.version = (d.version || 1) + 1; d.editedAt = now();
  return { dropped };
}

/** Several replacements [{ start, end, text }] (not overlapping) applied at once, codings moved through each. */
export function replaceRanges(s, docId, reps) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId); if (!d) return { dropped: 0 };
  let text = d.text, dropped = 0;
  for (const r of [...reps].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, r.start) + r.text + text.slice(r.end);
    dropped += shiftCodings(q, docId, r.start, r.end - r.start, r.text.length);
  }
  d.text = text; d.version = (d.version || 1) + 1; d.editedAt = now();
  return { dropped };
}

// ---- codes ----------------------------------------------------------------
/** A short label for a code: its initials, or its first letters, unique among `taken` (lower case). */
export function shortFor(label, taken = new Set()) {
  const words = clean(label).split(' ').filter(w => /[\p{L}\d]/u.test(w));
  let base = words.length > 1 ? words.slice(0, 3).map(w => w.match(/[\p{L}\d]/u)[0]).join('') : (words[0] || 'C').replace(/[^\p{L}\d]/gu, '').slice(0, 3);
  base = base.toUpperCase() || 'C';
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
}
const takenShorts = (q, except) => new Set(q.codes.filter(c => c.id !== except).map(c => String(c.short || '').toLowerCase()));

/** A code by label, reusing one already named the same (ignoring case). Returns its id. */
export function ensureCode(s, label, { parent = null, description = '' } = {}) {
  const q = qualOf(s), name = clean(label).slice(0, 120);
  if (!name) return null;
  const found = q.codes.find(c => c.label.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const c = { id: uid('k'), label: name, short: shortFor(name, takenShorts(q)), parent: q.codes.some(x => x.id === parent) ? parent : null, description: String(description || ''), at: now() };
  q.codes.push(c); bump(q);
  return c.id;
}

/** An in-vivo code: the participant's own words, collapsed and cut to 60 characters. */
export const inVivoLabel = text => { const t = clean(text).replace(/^["'“‘]+|["'”’]+$/g, ''); return t.length > 60 ? `${t.slice(0, 59).replace(/\s+\S*$/, '')}…` : t; };

/** Renames a code. A code renamed to another code's name merges into it. */
export function renameCode(s, id, label) {
  const q = qualOf(s), name = clean(label).slice(0, 120), c = q.codes.find(x => x.id === id);
  if (!name || !c) return;
  const twin = q.codes.find(x => x.id !== id && x.label.toLowerCase() === name.toLowerCase());
  if (twin) { mergeCodes(s, [id], twin.id); return; }
  c.label = name; bump(q);
}
export function setShort(s, id, short) {
  const q = qualOf(s), c = q.codes.find(x => x.id === id), v = clean(short).slice(0, 6);
  if (!c || !v || takenShorts(q, id).has(v.toLowerCase())) return false;
  c.short = v; bump(q); return true;
}
export function setDescription(s, id, text) { const q = qualOf(s), c = q.codes.find(x => x.id === id); if (c) { c.description = String(text ?? ''); bump(q); } }

export const childrenOf = (s, id) => readQual(s).codes.filter(c => (c.parent || null) === (id || null));
/** Ids of every code beneath `id`, depth first. */
export function descendants(s, id) {
  const out = [], walk = p => { for (const c of childrenOf(s, p)) { out.push(c.id); walk(c.id); } };
  walk(id); return out;
}
/** 'Parent › Child' */
export function pathOf(s, id) {
  const q = readQual(s), byId = new Map(q.codes.map(c => [c.id, c])), parts = [];
  for (let c = byId.get(id), n = 0; c && n < 64; c = byId.get(c.parent), n++) parts.unshift(c.label);
  return parts.join(' › ');
}
/** The codebook depth first: [{ code, depth }], siblings in their stored order. */
export function codeTree(s) {
  const q = readQual(s), ids = new Set(q.codes.map(c => c.id)), out = [];
  const walk = (p, depth) => { for (const c of q.codes.filter(x => (ids.has(x.parent) ? x.parent : null) === p)) { out.push({ code: c, depth }); if (depth < 32) walk(c.id, depth + 1); } };
  walk(null, 0); return out;
}

/** Moves a code under another (or to the top with null). Refuses itself and its own descendants. */
export function setParent(s, id, parentId) {
  const q = qualOf(s), c = q.codes.find(x => x.id === id);
  if (!c) return false;
  const p = parentId || null;
  if (p === id || (p && !q.codes.some(x => x.id === p)) || (p && descendants(s, id).includes(p))) return false;
  c.parent = p;
  // it goes last among its new siblings
  q.codes = [...q.codes.filter(x => x.id !== id), c];
  bump(q); return true;
}
/** Indent: under the sibling just above it. Outdent: beside its parent, just after it. */
export function indent(s, id) {
  const q = readQual(s), c = q.codes.find(x => x.id === id); if (!c) return false;
  const sibs = q.codes.filter(x => (x.parent || null) === (c.parent || null)), i = sibs.findIndex(x => x.id === id);
  return i > 0 ? setParent(s, id, sibs[i - 1].id) : false;
}
export function outdent(s, id) {
  const q = qualOf(s), c = q.codes.find(x => x.id === id); if (!c?.parent) return false;
  const parent = q.codes.find(x => x.id === c.parent);
  c.parent = parent?.parent || null;
  const rest = q.codes.filter(x => x.id !== id), at = rest.findIndex(x => x.id === parent?.id);
  rest.splice(at + 1, 0, c); q.codes = rest; bump(q);
  return true;
}

/** Folds codes into one: codings, children, theme membership, memos and framework cells move to it. */
export function mergeCodes(s, fromIds, intoId) {
  const q = qualOf(s), from = new Set(fromIds.filter(x => x !== intoId));
  const into = q.codes.find(c => c.id === intoId);
  if (!from.size || !into) return;
  // children of the merged codes move under the target; the target itself,
  // and any code above it, move up past the codes that are going away
  const byId = new Map(q.codes.map(c => [c.id, c]));
  const up = p => { for (let n = 0; p && from.has(p) && n < 64; n++) p = byId.get(p)?.parent || null; return p; };
  into.parent = up(into.parent);
  const above = new Set();
  for (let p = into.parent, n = 0; p && n < 64; p = byId.get(p)?.parent, n++) above.add(p);
  for (const c of q.codes) if (c.id !== intoId && from.has(c.parent)) c.parent = above.has(c.id) ? up(c.parent) : intoId;
  for (const x of q.codings) if (x.codeIds.some(id => from.has(id))) x.codeIds = [...new Set(x.codeIds.map(id => (from.has(id) ? intoId : id)))];
  const memo = [memoOf(s, 'code', intoId), ...[...from].map(id => memoOf(s, 'code', id))].filter(Boolean).join('\n\n');
  q.memos = q.memos.filter(m => !(m.kind === 'code' && from.has(m.target)));
  if (memo) setMemo(s, 'code', intoId, memo);
  into.description = [into.description, ...q.codes.filter(c => from.has(c.id)).map(c => c.description)].filter(Boolean).join('\n\n');
  const cells = q.framework.cells;
  for (const k of Object.keys(cells)) {
    const [row, col] = k.split('|');
    if (!from.has(col)) continue;
    const to = `${row}|${intoId}`;
    cells[to] = [cells[to], cells[k]].filter(Boolean).join('\n\n');
    delete cells[k];
  }
  q.codes = q.codes.filter(c => !from.has(c.id));
  viaQes(s, x => { x.qes.codes.push(...[...from].map(id => ({ id }))); qesMerge(x, 'code', [...from], intoId); });
  bump(q);
}

/** A new code beside `id` taking the chosen codings from it. Returns the new code's id. */
export function splitCode(s, id, codingIds, label) {
  const q = qualOf(s), c = q.codes.find(x => x.id === id), name = clean(label);
  if (!c || !name || q.codes.some(x => x.label.toLowerCase() === name.toLowerCase())) return null;
  const nid = ensureCode(s, name, { parent: c.parent });
  const move = new Set(codingIds);
  for (const x of q.codings) if (move.has(x.id) && x.codeIds.includes(id)) x.codeIds = [...new Set(x.codeIds.map(k => (k === id ? nid : k)))];
  return nid;
}

/** Deletes codes. Their children move up to the nearest surviving ancestor; codings left without a code go. */
export function deleteCodes(s, ids) {
  const q = qualOf(s), gone = new Set(ids), byId = new Map(q.codes.map(c => [c.id, c]));
  const up = p => { while (p && gone.has(p)) p = byId.get(p)?.parent || null; return p; };
  for (const c of q.codes) if (!gone.has(c.id) && gone.has(c.parent)) c.parent = up(c.parent);
  q.codes = q.codes.filter(c => !gone.has(c.id));
  for (const x of q.codings) x.codeIds = x.codeIds.filter(id => !gone.has(id));
  const empty = new Set(q.codings.filter(x => !x.codeIds.length).map(x => x.id));
  q.codings = q.codings.filter(x => !empty.has(x.id));
  q.memos = q.memos.filter(m => !(m.kind === 'code' && gone.has(m.target)) && !(m.kind === 'coding' && empty.has(m.target)));
  viaQes(s, x => { x.qes.codes.push(...[...gone].map(id => ({ id }))); qesRemove(x, 'code', [...gone]); });
  pruneFramework(q);
  bump(q);
}

// ---- codings ----------------------------------------------------------------
/**
 * Codes a range. A range the same coder already coded exactly gains the codes
 * instead of a second coding. Returns the coding's id, or null when invalid.
 */
export function addCoding(s, { docId, start, end, codeIds, coder = null, exemplar = false, weight = null }) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId);
  const codes = [...new Set(codeIds || [])].filter(id => q.codes.some(c => c.id === id));
  if (!d || !codes.length || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  // trim surrounding space: a selection that ran past a word is the word
  while (start < end && /\s/.test(d.text[start])) start++;
  while (end > start && /\s/.test(d.text[end - 1])) end--;
  if (start < 0 || end > d.text.length || start >= end) return null;
  const who = coder ?? (q.coder || '');
  const same = q.codings.find(x => x.docId === docId && x.start === start && x.end === end && (x.coder || '') === who);
  if (same) { same.codeIds = [...new Set([...same.codeIds, ...codes])]; same.at = now(); return same.id; }
  const x = { id: uid('g'), docId, start, end, codeIds: codes, coder: who, at: now(), exemplar: !!exemplar, weight: validWeight(weight) };
  q.codings.push(x);
  return x.id;
}
const validWeight = w => (w === null || w === '' || w === undefined ? null : Number.isFinite(Number(w)) ? Number(w) : null);
/** Takes codes off a coding; a coding left with none is deleted. */
export function uncode(s, codingId, codeIds) {
  const q = qualOf(s), x = q.codings.find(c => c.id === codingId); if (!x) return;
  x.codeIds = x.codeIds.filter(id => !codeIds.includes(id));
  if (!x.codeIds.length) deleteCodings(s, [codingId]);
}
export function deleteCodings(s, ids) {
  const q = qualOf(s), gone = new Set(ids);
  q.codings = q.codings.filter(x => !gone.has(x.id));
  q.memos = q.memos.filter(m => !(m.kind === 'coding' && gone.has(m.target)));
}
export function setExemplar(s, id, on) { const x = qualOf(s).codings.find(c => c.id === id); if (x) x.exemplar = !!on; }
export function setWeight(s, id, w) { const x = qualOf(s).codings.find(c => c.id === id); if (!x) return false; const v = validWeight(w); if (w !== null && w !== '' && v === null) return false; x.weight = v; return true; }
export const textOf = (s, x) => (docById(s, x.docId)?.text || '').slice(x.start, x.end);

/** The most recently applied codes, newest first, at most `n`. */
export function recentCodes(s, n = 9) {
  const q = readQual(s), ids = new Set(q.codes.map(c => c.id)), out = [];
  for (const x of [...q.codings].sort((a, b) => String(b.at).localeCompare(String(a.at))))
    for (const id of x.codeIds) if (ids.has(id) && !out.includes(id)) { out.push(id); if (out.length >= n) return out; }
  return out;
}

// ---- memos ------------------------------------------------------------------
export const MEMO_KINDS = ['code', 'document', 'case', 'coding'];
export const memoOf = (s, kind, target) => readQual(s).memos.find(m => m.kind === kind && m.target === target)?.text || '';
/** Sets the memo on a code, document, case or coding; empty text removes it. */
export function setMemo(s, kind, target, text, by = '') {
  if (!MEMO_KINDS.includes(kind)) return;
  const q = qualOf(s), body = String(text ?? '').trim(), m = q.memos.find(x => x.kind === kind && x.target === target);
  if (!body) { q.memos = q.memos.filter(x => x !== m); return; }
  if (m) { m.text = body; m.at = now(); if (by) m.by = by; } else q.memos.push({ id: uid('m'), kind, target, text: body, by, at: now() });
}

// ---- cases of a coding --------------------------------------------------------
/** The case a coding belongs to: its speaker's case in a transcript, else its document's case, else null. */
export function caseOfCoding(s, x, turnsCache = new Map()) {
  const d = docById(s, x.docId); if (!d) return null;
  const map = d.speakers || {};
  if (Object.keys(map).length) {
    if (!turnsCache.has(d.id)) turnsCache.set(d.id, parseTurns(d.text));
    const t = turnAt(turnsCache.get(d.id), x.start);
    const hit = t && Object.entries(map).find(([k]) => k.toLowerCase() === t.speaker.toLowerCase());
    if (hit?.[1]) return hit[1];
  }
  return d.caseId || null;
}
/** Cases whose data a document holds: its own and its speakers'. */
export const casesOfDocument = d => [...new Set([d.caseId, ...Object.values(d.speakers || {})].filter(Boolean))];

// ---- themes: the synthesis theme model (lib/qes.mjs) over this codebook ------
// qes.mjs keeps themes in s.qes; here they live in s.qual, so its functions run
// on a stand-in whose lists are this workspace's and are written back after.
function viaQes(s, fn) {
  const q = qualOf(s);
  const shim = { qes: { codes: q.codes.map(c => ({ id: c.id, label: c.label })), quotes: [], descriptive: q.descriptive, analytical: q.analytical } };
  const r = fn(shim);
  q.descriptive = shim.qes.descriptive; q.analytical = shim.qes.analytical;
  return r;
}
export const addQualTheme = (s, level, label, members = []) => viaQes(s, x => addTheme(x, level, label, members));
export const setQualMembers = (s, level, id, members, on = true) => viaQes(s, x => setMembers(x, level, id, members, on));
export const mergeQualThemes = (s, level, ids, into) => viaQes(s, x => qesMerge(x, level, ids, into));
export const removeQualThemes = (s, level, ids) => viaQes(s, x => qesRemove(x, level, ids));
export const renameQualTheme = (s, level, id, label) => viaQes(s, x => qesRename(x, level, id, label));
export const setQualStatement = (s, id, text) => viaQes(s, x => setStatement(x, id, text));
/** Code ids a theme gathers, with every code beneath them in the tree. */
export function codesOfTheme(s, level, id) {
  const q = readQual(s);
  const direct = level === 'code' ? [id] : level === 'descriptive' ? q.descriptive.find(t => t.id === id)?.codes || []
    : (q.analytical.find(t => t.id === id)?.themes || []).flatMap(d => q.descriptive.find(t => t.id === d)?.codes || []);
  return [...new Set(direct.flatMap(c => [c, ...descendants(s, c)]))];
}

function pruneFramework(q) {
  const rows = new Set([...q.cases.map(c => c.id), ...q.documents.map(d => d.id)]);
  const cols = new Set([...q.codes.map(c => c.id), ...q.descriptive.map(t => t.id), ...q.analytical.map(t => t.id)]);
  for (const k of Object.keys(q.framework.cells)) { const [r, c] = k.split('|'); if (!rows.has(r) || !cols.has(c)) delete q.framework.cells[k]; }
}
export { pruneFramework };
