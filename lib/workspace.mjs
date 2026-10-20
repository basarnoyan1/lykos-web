// The project folder as the assistant sees it: paths relative to the project's
// root, hidden entries and Office lock files left out, text of any readable
// file, and a search across all of them. Reading needs no approval; nothing
// here writes (lib/changes.mjs does, and only on a person's accept).
//
// Without a project folder (the app-storage project) the added folders of
// lib/folders.mjs stand in, as they did before projects were folders.
import { currentId } from './projects.mjs';
import { filesFolder } from './open-folders.mjs';
import { listDir as listAdded, readPath as readAdded } from './folders.mjs';
import { fileText, SUPPORTED } from './filetext.mjs';

/** Plain-text kinds read as UTF-8: notes, data, markup and source code. */
export const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'geojson', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'r', 'rmd', 'qmd', 'jl', 'm', 'sas', 'do', 'sql',
  'sh', 'zsh', 'bash', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'lua', 'tex', 'bib', 'ris', 'nbib', 'log']);
const extOf = p => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const readable = p => SUPPORTED.includes(extOf(p)) || TEXT_EXT.has(extOf(p));
const hidden = name => name.startsWith('.') || name.startsWith('~$');
const clean = p => String(p || '').replace(/^\/+|\/+$/g, '');

export function refuse(p) {
  const segs = clean(p).split('/').filter(Boolean);
  if (segs.some(s => s === '..' || s === '.' || hidden(s))) throw new Error('path is outside the project or hidden');
  return segs.join('/');
}

/** One level of a folder: [{ name, path, dir, size }]. */
export async function list(path = '') {
  const rel = refuse(path), f = filesFolder(rel);
  if (f) return (await f.list(rel)).filter(e => !hidden(e.name)).map(e => ({ name: e.name, path: e.rel, dir: e.dir, size: e.size, mtime: e.mtime }));
  return (await listAdded(addedPath(path))).filter(e => !hidden(e.name)).map(e => ({ name: e.name, path: e.path, dir: e.kind === 'dir', size: e.size }));
}

// Native linked roots use absolute paths; validate segments without removing
// their leading slash. Native access still enforces the user's chosen roots.
export function addedPath(path) { const rel=refuse(path); return String(path).startsWith('/') ? `/${rel}` : rel; }
async function bytesOf(path) { const rel=refuse(path),f=filesFolder(rel); return f ? f.read(rel) : readAdded(addedPath(path)); }
async function stamp(rel) { const f = filesFolder(rel); if (!f) return ''; const s = await f.stat(rel); if(!s.exists)throw new Error('File not found'); return `${f.abs(rel)}:${s.size}:${s.mtime}`; }

// Extracted text is kept per file and version. The cache is bounded by total
// characters, oldest dropped first, so a search across a large folder does not
// hold every document it has ever read.
const CACHE_CHARS = 8_000_000;
const cache = new Map(); let held = 0;
function keep(key, ft) {
  cache.delete(key); cache.set(key, ft); held += ft.text.length;
  for (const [k, v] of cache) { if (held <= CACHE_CHARS) break; cache.delete(k); held -= v.text.length; }
}

function lineText(t) {
  const locators = []; let at = 0;
  t.split('\n').forEach((l, i) => { locators.push({ start: at, end: at + l.length, line: i + 1 }); at += l.length + 1; });
  return { text: t, locators };
}
/** Where an offset sits, as a reader would say it: p. 3, ¶12, Sheet1!B4, line 40. */
export function where(ft, at) {
  const l = ft.locators?.find(x => at >= x.start && at <= x.end);
  if (!l) return '';
  return l.page ? `p. ${l.page}` : l.paragraph ? `¶${l.paragraph}` : l.cell ? `${l.sheet}!${l.cell}` : l.line ? `line ${l.line}` : '';
}

/** Text of a readable file with its locators ({ text, locators }). */
export async function text(path) {
  const rel = refuse(path);
  if (!readable(rel)) throw new Error(`${extOf(rel) || 'this'} files cannot be read as text`);
  const key = `${currentId()}:${path}@${await stamp(rel)}`;
  const hit = cache.get(key); if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const bytes = await bytesOf(path);
  const ft = TEXT_EXT.has(extOf(rel)) && !SUPPORTED.includes(extOf(rel))
    ? lineText(new TextDecoder().decode(bytes))
    : await fileText(rel.split('/').pop(), bytes);
  keep(key, ft);
  return ft;
}

/** Every readable file below a folder, up to `max`, hidden folders skipped. `truncated` is set when the file or depth limit cut the walk short. */
export async function walk(path = '', { max = 3000, depth = 10 } = {}) {
  const out = [];out.errors=[];out.truncated=false;
  async function go(rel, d) {
    if (d > depth || out.length >= max) { out.truncated = true; return; }
    let rows = []; try { rows = await list(rel); } catch(error) { out.errors.push({path:rel,error:String(error.message||error)});return; }
    for (const e of rows) {
      if (out.length >= max) { out.truncated = true; return; }
      if (e.dir) await go(e.path, d + 1); else out.push(e);
    }
  }
  refuse(path);await go(path, 0);
  return out;
}

const glob = g => g ? new RegExp(`^${g.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i') : null;

/**
 * Lines that contain the query, across the readable files below `path`
 * (optionally only names matching `pattern`, e.g. "*.docx"). Files are read
 * at most `scan` of them, smallest first so one large scan does not starve the
 * rest; the answer says how many were read, so a partial search is not
 * reported as a whole one.
 */
export async function grep(query, { path = '', pattern = '', scan = 400, hits = 60, signal } = {}) {
  const q = String(query || '').trim().toLowerCase(); if (!q) throw new Error('empty query');
  const g = glob(pattern);
  const walked = await walk(path), errors = [...walked.errors];
  const files = walked.filter(e => readable(e.path) && (!g || g.test(e.name)))
    .sort((a, b) => (a.size || 0) - (b.size || 0));
  const out = []; let read = 0;
  for (const f of files.slice(0, scan)) {
    if (signal?.aborted || out.length >= hits) break;
    let ft; try { ft = await text(f.path); } catch(error) { errors.push({path:f.path,error:String(error.message||error)});continue; }
    read++;
    const lower = ft.text.toLowerCase();
    for (let at = lower.indexOf(q); at >= 0 && out.length < hits; at = lower.indexOf(q, at + q.length)) {
      const s = Math.max(0, ft.text.lastIndexOf('\n', at) + 1), e0 = ft.text.indexOf('\n', at);
      const e = e0 < 0 ? ft.text.length : e0;
      out.push({ path: f.path, at: where(ft, at), line: ft.text.slice(Math.max(s, at - 160), Math.min(e, at + q.length + 160)).trim() });
    }
  }
  return { hits: out, read, files: files.length, capped: files.length > scan, truncated: walked.truncated, errors:errors.slice(0,20), incomplete:errors.length>0 };
}
