// Which script makes which figure, and from what: a static read of Python and
// JavaScript figure scripts as text (plan §4.15c.3 step 2). Nothing here runs a
// script, imports project code, or reads a file: the caller hands over the text
// and, to resolve names, a description of the project's files.
//
//   scanScript(text, path, ctx) -> { lang, outputs, inputs, imports, run, skipped }
//   scanProducer(path, ctx)     -> the same, over the script and its local imports
//
// `ctx` (all optional): `files`, the project-relative paths (posix, no leading
// slash) as an array or Set; `read(path)`, which returns the text of a project
// file or null; `alias`, a map such as { '~/b': 'Evidence table' } for a build
// copy that lives elsewhere; `root`, the absolute project folder, to turn an
// absolute literal into a project path. Without `files` nothing resolves and
// every input is kept with `resolved: false`.
//
// What it finds, and how it says so (`how`, the weakest evidence last):
//   write-call   a literal in the arguments of a write call (savefig, save,
//                writeFileSync, open(..., 'w'), to_csv ...), also inside os.path.join
//   name-table   keys of a subscript table such as A["F1_forest"] = ...
//   path-join    the literals of a path join that no call classifies
//   literal      a file-name literal anywhere else (figure names are outputs,
//                data names are inputs)
// A path literal is resolved against the script's directory, then the project
// root; an input that resolves to nothing is kept with `resolved: false`.
// Cross-directory imports (sys.path.insert, chdir) are not followed by
// inference; only an alias, or the script's own directory, makes one resolve.

import { PARAMS, FIGURE_EXTENSIONS, DATA_EXTENSIONS, INPUT_KINDS } from './figure-lexicon.mjs';

const FIGURE_EXT = new Set(FIGURE_EXTENSIONS);
const DATA_EXT = new Set(DATA_EXTENSIONS);

const WRITE_CALLS = new Set(['savefig', 'save', 'saveas', 'write_image', 'write_html', 'imsave', 'imwrite', 'savetxt', 'savez', 'savez_compressed',
  'writefile', 'writefilesync', 'appendfile', 'appendfilesync', 'createwritestream', 'tofile', 'screenshot',
  'to_csv', 'to_excel', 'to_json', 'to_pickle', 'to_parquet', 'write_text', 'write_bytes']);
const READ_CALLS = new Set(['load_workbook', 'read_excel', 'read_csv', 'read_json', 'read_table', 'read_parquet', 'read_pickle', 'read_text', 'read_bytes',
  'readfile', 'readfilesync', 'createreadstream', 'imread', 'loadtxt', 'genfromtxt', 'load']);
// A call that only builds or normalises a path: the literal inside belongs to the call around it.
const TRANSPARENT = new Set(['join', 'resolve', 'abspath', 'normpath', 'normalize', 'expanduser', 'expandvars', 'str', 'string', 'path', 'purepath', 'realpath', 'fspath', 'joinpath', 'relpath']);
const JOIN_CALLS = new Set(['join', 'resolve', 'joinpath']);
const NOT_CALLS = new Set(['if', 'elif', 'while', 'for', 'return', 'in', 'and', 'or', 'not', 'is', 'print', 'assert', 'switch', 'catch', 'function', 'await', 'yield', 'lambda', 'with', 'else', 'del', 'from', 'import', 'export']);
const PY_LEAD = /^[rRbBuUfF]{1,2}$/;

// ---- paths --------------------------------------------------------------------------

const slash = p => String(p).replace(/\\/g, '/');
const baseName = p => p.slice(p.lastIndexOf('/') + 1);
const dirName = p => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
const extOf = p => { const m = baseName(p).match(/\.([A-Za-z0-9]{1,6})$/); return m ? m[1].toLowerCase() : ''; };

// "a/./b/../c" -> "a/c"; null when the path climbs above the project root.
function norm(p) {
  const out = [];
  for (const seg of slash(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}
const joinPath = (dir, rel) => norm(dir ? `${dir}/${rel}` : rel);

function applyAlias(p, alias) {
  const keys = Object.keys(alias || {}).sort((a, b) => b.length - a.length);
  for (const k of keys) if (p === k || p.startsWith(`${k}/`)) return { path: slash(alias[k]) + p.slice(k.length), aliased: true };
  return { path: p, aliased: false };
}

function projectOf(ctx) {
  const set = ctx.files instanceof Set ? ctx.files : new Set(ctx.files ? [...ctx.files].map(slash) : []);
  const dirs = new Set();
  for (const f of set) { let d = dirName(f); while (d && !dirs.has(d)) { dirs.add(d); d = dirName(d); } }
  return {
    has: p => p != null && set.has(p),
    hasDir: p => p === '' || dirs.has(p),
    known: set.size > 0,
    alias: ctx.alias || {},
    root: ctx.root ? slash(ctx.root).replace(/\/+$/, '') : '',
    read: typeof ctx.read === 'function' ? ctx.read : () => null,
  };
}

// A literal path as a project path: { path, resolved }. `resolved` is true only when the file exists.
function resolveLiteral(lit, scriptDir, proj) {
  let p = slash(lit).replace(/^file:\/\//, '');
  const al = applyAlias(p, proj.alias);
  if (al.aliased) { const n = norm(al.path); return { path: n ?? p, resolved: n != null && proj.has(n), aliased: true }; }
  if (/^(~|\/|[A-Za-z]:\/)/.test(p)) {
    if (proj.root && p.startsWith(`${proj.root}/`)) { const n = norm(p.slice(proj.root.length + 1)); return { path: n ?? p, resolved: n != null && proj.has(n), aliased: false }; }
    return { path: p, resolved: false, aliased: false };
  }
  const here = joinPath(scriptDir, p);
  if (here != null && proj.has(here)) return { path: here, resolved: true, aliased: false };
  const top = norm(p);
  if (top != null && proj.has(top)) return { path: top, resolved: true, aliased: false };
  return { path: norm(p) ?? p, resolved: false, aliased: false };
}

// ---- lexer --------------------------------------------------------------------------

// Tokens: { t: 's'|'i'|'n'|'p', v, line, first, triple?, tpl? }. Comments are dropped;
// a string ends at its closing quote, or at the end of its line when it never closes.
function lex(text, lang) {
  const out = [];
  const n = text.length;
  let i = 0, line = 1, lineStart = true;
  const push = tok => { tok.line = tok.line ?? line; tok.first = lineStart; lineStart = false; out.push(tok); };
  const readString = (q, tpl, f) => {
    const startLine = line;
    let j = i + 1, v = '';
    for (; j < n; j++) {
      const c = text[j];
      if (c === '\\') { v += text[j + 1] ?? ''; j++; continue; }
      if (c === q) break;
      if (c === '\n' && !tpl) { j--; break; }
      if (c === '\n') line++;
      v += c;
    }
    i = j + 1;
    return { v, startLine, f };
  };
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (lang === 'py' && c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    if (lang === 'js' && c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (lang === 'js' && c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2); const stop = e < 0 ? n : e + 2;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop; continue;
    }
    if (c === '"' || c === "'" || (lang === 'js' && c === '`')) {
      if (lang === 'py' && text.startsWith(c.repeat(3), i)) {
        const e = text.indexOf(c.repeat(3), i + 3); const stop = e < 0 ? n : e + 3;
        const startLine = line;
        for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
        i = stop; push({ t: 's', v: '', line: startLine, triple: true }); continue;
      }
      const { v, startLine, f } = readString(c, c === '`', false);
      push({ t: 's', v, line: startLine, tpl: c === '`' ? /\$\{/.test(v) : false, f }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1; while (j < n && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (lang === 'py' && PY_LEAD.test(word) && (text[j] === '"' || text[j] === "'")) {
        const q = text[j];
        if (text.startsWith(q.repeat(3), j)) {
          const e = text.indexOf(q.repeat(3), j + 3); const stop = e < 0 ? n : e + 3;
          const startLine = line;
          for (let k = j; k < stop; k++) if (text[k] === '\n') line++;
          i = stop; push({ t: 's', v: '', line: startLine, triple: true }); continue;
        }
        i = j;
        const { v, startLine } = readString(q, false, /f/i.test(word));
        push({ t: 's', v, line: startLine, tpl: /f/i.test(word) && /\{/.test(v), raw: /r/i.test(word) }); continue;
      }
      push({ t: 'i', v: word }); i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(text[j])) j++; push({ t: 'n', v: text.slice(i, j) }); i = j; continue; }
    if (c === '=' && text[i + 1] === '=') { push({ t: 'p', v: '==' }); i += 2; continue; }
    push({ t: 'p', v: c }); i++;
  }
  return out;
}

// ---- structure ----------------------------------------------------------------------

// Calls with their string arguments, and for every string the calls around it (innermost first).
function structure(tokens) {
  const calls = [], frames = [], lits = [];
  tokens.forEach((tok, k) => {
    if (tok.t === 'p' && tok.v === '(') {
      let name = '', j = k - 1, declaration = false;
      if (tokens[j]?.t === 'i' && !NOT_CALLS.has(tokens[j].v)) {
        const parts = [];
        while (tokens[j]?.t === 'i') { parts.unshift(tokens[j].v); if (tokens[j - 1]?.t === 'p' && tokens[j - 1].v === '.' && tokens[j - 2]?.t === 'i') j -= 2; else break; }
        if (/^(def|class|function)$/.test(tokens[j - 1]?.v || '')) declaration = true; else name = parts.join('.');
      }
      const parent = [...frames].reverse().find(f => f.call)?.call || null;
      const call = name ? { name, last: name.slice(name.lastIndexOf('.') + 1).toLowerCase(), line: tok.line, open: k, close: k, strs: [], parent } : null;
      if (call) calls.push(call);
      frames.push({ call, declaration });
    } else if (tok.t === 'p' && tok.v === ')') {
      const f = frames.pop(); if (f?.call) f.call.close = k;
    } else if (tok.t === 's' && !tok.triple) {
      if (frames.some(f => f.declaration)) return;
      const top = frames[frames.length - 1];
      const own = top?.call || null;
      if (own) own.strs.push({ v: tok.v, k });
      const chain = []; for (let c = [...frames].reverse().find(f => f.call)?.call; c; c = c.parent) chain.push(c);
      lits.push({ tok, k, chain });
    }
  });
  return { calls, lits };
}

// "S{i}.png" or "S%02d.png" is a set: placeholders become `*`.
function literalText(tok, lang) {
  let v = tok.v, glob = false;
  const swap = re => { const w = v.replace(re, '*'); if (w !== v) { glob = true; v = w; } };
  if (lang === 'py') { if (tok.tpl || /\{[^{}]*\}/.test(v)) swap(/\{[^{}]*\}/g); swap(/%[-+0-9.]*[sdif]/g); }
  else { if (tok.tpl) swap(/\$\{[^}]*\}/g); swap(/%[-+0-9.]*[sdif]/g); }
  return { v, glob };
}

const fileLike = v => /^[^\s<>|?"]+\.[A-Za-z0-9]{1,6}$/.test(v) && !/^https?:/i.test(v);

// How the calls around a literal use it: 'write', 'read' or 'unknown'.
function contextOf(lit, lang) {
  for (const c of lit.chain) {
    if (TRANSPARENT.has(c.last)) continue;
    if (WRITE_CALLS.has(c.last)) return 'write';
    if (READ_CALLS.has(c.last)) return 'read';
    if (c.last === 'open') {
      const mode = c.strs.map(s => s.v).find(v => /^[rwax][bt+]*$/.test(v) && v !== lit.tok.v);
      return mode && /^[wax]/.test(mode) ? 'write' : 'read';
    }
    return 'unknown';
  }
  return 'unknown';
}

function inputKind(ext) {
  if (INPUT_KINDS.cells.includes(ext)) return 'cells';
  if (INPUT_KINDS.text.includes(ext)) return 'text';
  return 'bytes';
}

// ---- imports ------------------------------------------------------------------------

function pyImports(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t !== 'i' || !tok.first) continue;
    if (tok.v === 'import') {
      let j = k + 1;
      while (tokens[j]) {
        const parts = [];
        while (tokens[j]?.t === 'i' && tokens[j].v !== 'as') { parts.push(tokens[j].v); j++; if (tokens[j]?.v === '.') j++; else break; }
        if (parts.length) out.push({ module: parts.join('.'), level: 0, names: [], line: tok.line });
        if (tokens[j]?.v === 'as') j += 2;
        if (tokens[j]?.v === ',') { j++; continue; }
        break;
      }
    } else if (tok.v === 'from') {
      let j = k + 1, level = 0;
      while (tokens[j]?.t === 'p' && tokens[j].v === '.') { level++; j++; }
      const parts = [];
      while (tokens[j]?.t === 'i' && tokens[j].v !== 'import') { parts.push(tokens[j].v); j++; if (tokens[j]?.v === '.') j++; else break; }
      if (tokens[j]?.v !== 'import') continue;
      j++;
      const names = [];
      let paren = false;
      for (; tokens[j]; j++) {
        const t = tokens[j];
        if (t.v === '(') { paren = true; continue; }
        if (t.v === ')') break;
        if (!paren && t.line !== tok.line) break;
        if (t.t === 'i' && t.v !== 'as' && tokens[j - 1]?.v !== 'as') names.push(t.v);
      }
      out.push({ module: parts.join('.'), level, names: names.slice(0, 50), line: tok.line });
    }
  }
  return out;
}

function jsImports(tokens, calls) {
  const out = [];
  for (const c of calls) if (c.last === 'require' && c.strs.length) out.push({ spec: c.strs[0].v, line: c.line });
  tokens.forEach((tok, k) => {
    if (tok.t === 'i' && tok.v === 'import' && tokens[k + 1]?.t === 's') out.push({ spec: tokens[k + 1].v, line: tok.line });
    else if (tok.t === 'i' && tok.v === 'import' && tokens[k + 1]?.v === '(' && tokens[k + 2]?.t === 's') out.push({ spec: tokens[k + 2].v, line: tok.line });
    else if (tok.t === 'i' && tok.v === 'from' && tokens[k + 1]?.t === 's') {
      for (let j = k - 1, seen = 0; j >= 0 && seen < 80; j--, seen++) {
        if (tokens[j].v === ';') break;
        if (tokens[j].t === 'i' && (tokens[j].v === 'import' || tokens[j].v === 'export')) { out.push({ spec: tokens[k + 1].v, line: tok.line }); break; }
      }
    }
  });
  return out;
}

// ---- the scan -----------------------------------------------------------------------

const languageOf = path => {
  const e = extOf(path);
  if (e === 'py') return 'py';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(e)) return 'js';
  return null;
};
const emptyRun = lang => ({ lang, argv: 0, mainGuard: false, pathInserts: [], chdir: [] });
const empty = (lang, skipped) => ({ lang, outputs: [], inputs: [], imports: [], run: emptyRun(lang), skipped });

function addUnique(list, entry, keyOf) {
  const key = keyOf(entry);
  const had = list.find(e => keyOf(e) === key);
  if (!had) { list.push(entry); return; }
  const rank = { 'write-call': 0, 'read-call': 0, 'name-table': 1, 'path-join': 2, literal: 3 };
  if ((rank[entry.how] ?? 9) < (rank[had.how] ?? 9)) Object.assign(had, entry);
}

/**
 * Outputs, inputs, imports and run facts of one script, read as text.
 * Outputs: `{ path, name, expected, ext, figure, glob, how, via: 'inferred-write', line }`
 * (`path` as written, `expected` the project path it names when the script runs in its own
 * folder, a name-table key has `ext: null` and `table`). Inputs: `{ path, file, resolved,
 * kind, sheet?, how, via: 'inferred-input', line }`. Imports: `{ module, path, resolved,
 * line, depth: 1, via: 'inferred-import' }`. Run: `{ lang, argv, mainGuard, pathInserts, chdir }`.
 */
export function scanScript(text, path, ctx = {}) {
  const lang = languageOf(path || '');
  if (!lang) return empty(null, 'language');
  const src = String(text ?? '');
  if (src.length * 3 > PARAMS.SCRIPT_MAX_BYTES && new TextEncoder().encode(src).length > PARAMS.SCRIPT_MAX_BYTES) return empty(lang, 'size');
  const proj = projectOf(ctx);
  const scriptPath = norm(path) ?? slash(path), scriptDir = dirName(scriptPath);
  const tokens = lex(src, lang);
  const { calls, lits } = structure(tokens);
  const outputs = [], inputs = [], imports = [], run = emptyRun(lang);

  // run facts
  tokens.forEach((t, k) => {
    if (t.t === 'i' && t.v === 'argv' && tokens[k + 1]?.v === '[' && tokens[k + 2]?.t === 'n') run.argv = Math.max(run.argv, Number(tokens[k + 2].v) || 0);
    if (t.t === 'i' && t.v === '__name__' && tokens[k + 1]?.v === '==' && tokens[k + 2]?.t === 's' && tokens[k + 2].v === '__main__') run.mainGuard = true;
  });
  const insertDirs = [];
  for (const c of calls) {
    const isInsert = lang === 'py' && /(^|\.)path\.(insert|append)$/.test(c.name), isChdir = c.last === 'chdir';
    if (!isInsert && !isChdir) continue;
    const inside = tokens.slice(c.open + 1, c.close);
    const self = inside.some(t => t.t === 'i' && (t.v === '__file__' || t.v === '__dirname'));
    const strs = inside.filter(t => t.t === 's' && !t.triple).map(t => t.v);
    const entries = strs.length ? strs.map(v => {
      const al = applyAlias(v, proj.alias), dir = al.aliased ? norm(al.path) : null;
      return { path: v, aliased: al.aliased, dir, resolved: al.aliased && dir != null && (!proj.known || proj.hasDir(dir)), line: c.line };
    }) : self ? [{ path: scriptDir, self: true, dir: scriptDir, resolved: true, line: c.line }] : [];
    for (const e of entries) {
      (isInsert ? run.pathInserts : run.chdir).push({ path: e.path, self: Boolean(e.self), resolved: e.resolved, line: e.line });
      if (isInsert && e.resolved) insertDirs.push(e.dir);
    }
    if (isInsert && self && !strs.length) insertDirs.push(scriptDir);
  }

  // imports
  const searchDirs = [...new Set([scriptDir, ...insertDirs])];
  const seenImport = new Set();
  const addImport = (module, found, line) => {
    const key = `${module}|${found ?? ''}`;
    if (seenImport.has(key)) return; seenImport.add(key);
    imports.push({ module, path: found, resolved: found != null, line, depth: 1, via: 'inferred-import', from: scriptPath });
  };
  if (lang === 'py') {
    for (const im of pyImports(tokens)) {
      const rel = im.module.replace(/\./g, '/');
      let up = scriptDir; for (let i = 1; i < im.level; i++) up = dirName(up);
      const dirs = im.level > 0 ? [up] : searchDirs;
      const find = relMod => {
        for (const d of dirs) for (const cand of [joinPath(d ?? '', `${relMod}.py`), joinPath(d ?? '', `${relMod}/__init__.py`)]) if (cand != null && proj.has(cand)) return cand;
        return null;
      };
      if (rel) addImport(im.module, find(rel), im.line);
      for (const name of im.names) {
        const sub = find(rel ? `${rel}/${name}` : name);
        if (sub) addImport(rel ? `${im.module}.${name}` : name, sub, im.line);
      }
    }
  } else {
    for (const im of jsImports(tokens, calls)) {
      const local = /^[./]/.test(im.spec);
      if (!local) { addImport(im.spec, null, im.line); continue; }
      const base = joinPath(scriptDir, im.spec) ?? '';
      const cands = [base, ...['.js', '.mjs', '.cjs'].map(e => base + e), `${base}/index.js`];
      const hit = cands.find(c => proj.has(c) && !DATA_EXT.has(extOf(c)));
      if (!hit && DATA_EXT.has(extOf(base))) {
        const r = resolveLiteral(im.spec, scriptDir, proj);
        addUnique(inputs, { path: r.path, file: r.resolved ? r.path : null, resolved: r.resolved, kind: inputKind(extOf(base)), how: 'read-call', via: 'inferred-input', line: im.line }, e => e.path);
        continue;
      }
      addImport(im.spec, hit ?? null, im.line);
    }
  }

  // name tables: A["F1_forest_plot"] = ...
  const tables = new Map();
  tokens.forEach((t, k) => {
    if (t.t === 'i' && tokens[k + 1]?.v === '[' && tokens[k + 2]?.t === 's' && !tokens[k + 2].triple && tokens[k + 3]?.v === ']' && tokens[k + 4]?.t === 'p' && tokens[k + 4].v === '=') {
      const key = tokens[k + 2].v;
      if (!/^[A-Za-z]{1,4}\d{1,3}[A-Za-z]?_[\w.-]+$/.test(key) || FIGURE_EXT.has(extOf(key))) return;
      if (!tables.has(t.v)) tables.set(t.v, new Map());
      if (!tables.get(t.v).has(key)) tables.get(t.v).set(key, tokens[k + 2].line);
    }
  });
  for (const [table, keys] of tables) {
    if (keys.size < PARAMS.NAME_TABLE_MIN) continue;
    for (const [key, line] of keys) outputs.push({ path: key, name: key, expected: null, ext: null, figure: true, glob: false, how: 'name-table', table, via: 'inferred-write', line });
  }

  // file-name literals
  const joined = new Set();
  const sheetAfter = call => {
    const t = tokens[call.close + 1];
    if (t?.v === '[' && tokens[call.close + 2]?.t === 's') return tokens[call.close + 2].v;
    const k = tokens.findIndex((x, i) => i > call.open && i < call.close && x.t === 'i' && x.v === 'sheet_name');
    return k > 0 && tokens[k + 1]?.v === '=' && tokens[k + 2]?.t === 's' ? tokens[k + 2].v : undefined;
  };
  for (const lit of lits) {
    if (lit.chain[0] && ['require', 'import'].includes(lit.chain[0].last)) continue;
    let value, glob = false, chain = lit.chain, ctxName, how, line = lit.tok.line, ownCall = null;
    const own = lit.chain[0];
    if (own && JOIN_CALLS.has(own.last)) {
      if (joined.has(own)) continue;
      joined.add(own);
      const parts = own.strs.map(s => tokens[s.k]).map(t => literalText(t, lang));
      value = parts.map(p => p.v).filter(Boolean).join('/'); glob = parts.some(p => p.glob);
      chain = lit.chain.slice(1); how = 'path-join'; line = own.line;
    } else {
      const lt = literalText(lit.tok, lang); value = lt.v; glob = lt.glob; how = 'literal';
    }
    if (!fileLike(value)) continue;
    const ext = extOf(value);
    if (!FIGURE_EXT.has(ext) && !DATA_EXT.has(ext)) continue;
    const use = contextOf({ tok: lit.tok, chain }, lang);
    ownCall = chain.find(c => !TRANSPARENT.has(c.last)) || null;
    const asOutput = use === 'write' || (use === 'unknown' && FIGURE_EXT.has(ext));
    if (asOutput) {
      const p = norm(value) ?? slash(value);
      addUnique(outputs, {
        path: p, name: baseName(p), expected: slash(value).startsWith('/') ? null : joinPath(scriptDir, value), ext, figure: FIGURE_EXT.has(ext), glob,
        how: use === 'write' ? 'write-call' : how, via: 'inferred-write', line,
      }, e => `${e.how === 'name-table' ? 'n' : 'p'}|${e.path}`);
    } else {
      const r = resolveLiteral(value, scriptDir, proj);
      const entry = { path: r.path, file: r.resolved ? r.path : null, resolved: r.resolved, kind: inputKind(ext), how: use === 'read' ? 'read-call' : how, via: 'inferred-input', line };
      if (use === 'read' && ownCall && ['load_workbook', 'read_excel'].includes(ownCall.last)) { const sheet = sheetAfter(ownCall); if (sheet) entry.sheet = sheet; }
      addUnique(inputs, entry, e => e.path);
    }
  }
  return { lang, outputs, inputs, imports, run, skipped: null };
}

/**
 * A script and the local scripts it imports, to PARAMS.IMPORT_DEPTH levels (each is read
 * with `ctx.read`, never run). Outputs and inputs of the imported scripts join the
 * script's own, each tagged `from` with the file it was found in; `imports` lists every
 * import with its `depth`; `scripts` lists the files read.
 */
export function scanProducer(path, ctx = {}) {
  const proj = projectOf(ctx);
  const root = norm(path) ?? slash(path);
  const text = proj.read(root);
  if (text == null) return { script: root, ...empty(languageOf(root), 'unread'), scripts: [] };
  const main = scanScript(text, root, ctx);
  const outputs = main.outputs.map(o => ({ ...o, from: root })), inputs = main.inputs.map(i => ({ ...i, from: root }));
  const imports = [...main.imports], scripts = [root], seen = new Set([root]);
  let layer = main.imports.filter(i => i.resolved && /\.(py|m?js|cjs|jsx)$/.test(i.path));
  for (let depth = 1; depth <= PARAMS.IMPORT_DEPTH && layer.length; depth++) {
    const next = [];
    for (const imp of layer) {
      if (seen.has(imp.path)) continue;
      seen.add(imp.path);
      const sub = proj.read(imp.path);
      if (sub == null) continue;
      scripts.push(imp.path);
      const r = scanScript(sub, imp.path, ctx);
      for (const o of r.outputs) addUnique(outputs, { ...o, from: imp.path }, e => `${e.how === 'name-table' ? 'n' : 'p'}|${e.path}`);
      for (const i of r.inputs) addUnique(inputs, { ...i, from: imp.path }, e => e.path);
      if (depth < PARAMS.IMPORT_DEPTH) for (const i of r.imports) { const e = { ...i, depth: depth + 1 }; imports.push(e); if (e.resolved) next.push(e); }
    }
    layer = next;
  }
  return { script: root, lang: main.lang, outputs, inputs, imports, run: main.run, scripts, skipped: main.skipped };
}
