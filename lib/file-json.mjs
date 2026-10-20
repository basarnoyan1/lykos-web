// JSON in the Files editor: check, format, repair and read a .json, .geojson, .jsonl or .ndjson file as text. No DOM.
//
// The formatter works on the file's own tokens, not on a JSON.parse/JSON.stringify round trip, because such a round trip changes the data:
//   - a number is rewritten as JavaScript reads it: 1.0 becomes 1, 1e5 becomes 100000, -0 becomes 0, and an integer past 2^53
//     (12345678901234567890, a record id) silently becomes another number (12345678901234567000); 1e400 becomes null;
//   - a key that appears twice keeps only its last value;
//   - a string's escapes are rewritten (é becomes é, \/ becomes /).
// Here a number, a string and a key keep the exact text they had (unless an option asks otherwise), duplicate keys stay, and only the
// whitespace between tokens changes. Everything is iterative (an explicit stack), so 10,000 levels of nesting do not overflow the call stack.
//
// Repair is an explicit act and edits only what it names: comments, trailing commas, single-quoted strings, unquoted keys, and NaN or
// Infinity (written as null, as JSON.stringify does). The rest of the text keeps its layout.

export const JSON_EXT = new Set(['json', 'geojson', 'jsonl', 'ndjson']);
export const LINES_EXT = new Set(['jsonl', 'ndjson']);
/** Edited text up to this size is checked on every change; a larger one when it opens, after each act and when the editor loses focus. */
export const LIVE_MAX = 1024 * 1024;
/** The tree draws this many rows, then a row that shows the next as many (measured in Chromium: laying out 5,000 rows took 0.7 s, 1,000 about a fifth). */
export const TREE_PAGE = 1000;

export const DEFAULTS = Object.freeze({ indent: '2', sort: 'off', inline: 0, finalNewline: true, ascii: false, exact: true, wrap: true });
const CHOICES = { indent: ['2', '4', 'tab'], sort: ['off', 'asc', 'desc'], inline: [0, 80, 120] };
/** Stored options made safe: anything unknown takes its default. */
export function cleanOptions(o) {
  const src = o && typeof o === 'object' ? o : {}, out = { ...DEFAULTS };
  for (const [k, list] of Object.entries(CHOICES)) if (list.includes(src[k])) out[k] = src[k];
  for (const k of ['finalNewline', 'ascii', 'exact', 'wrap']) if (typeof src[k] === 'boolean') out[k] = src[k];
  return out;
}

export const FIX_LABELS = { comments: ['comment', 'comments'], trailingCommas: ['trailing comma', 'trailing commas'], singleQuotes: ['single-quoted string', 'single-quoted strings'],
  unquotedKeys: ['unquoted key', 'unquoted keys'], nonFinite: ['NaN or Infinity set to null', 'NaN or Infinity values set to null'] };

class JsonError extends Error {
  constructor(message, offset, fix = '') { super(message); this.offset = offset; this.fix = fix; }
}

// ---- the scanner ---------------------------------------------------------------------------------------------------------------

const isWs = c => c === 32 || c === 10 || c === 13 || c === 9;
const isDigit = c => c >= 48 && c <= 57;
const isHex = c => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isIdStart = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
const isIdPart = c => isIdStart(c) || isDigit(c);
const ESCAPES = new Set([34, 92, 47, 98, 102, 110, 114, 116]);

/** A parse state: strict or lenient, and in lenient mode what was repaired (the edits, in source order). */
const stateOf = (text, lenient) => ({ text, lenient, n: 0, edits: [], fixes: {}, lastEnd: 0 });
function fix(st, kind, s, e, t = '') {
  st.fixes[kind] = (st.fixes[kind] || 0) + 1;
  st.edits.push({ s, e, t });
  st.lastEnd = e;
}

/** Skips whitespace (and, lenient, comments; strict, a comment is an error that Repair can fix). */
function skip(st, i, end) {
  const { text } = st;
  for (;;) {
    while (i < end && isWs(text.charCodeAt(i))) i++;
    if (i + 1 < end && text.charCodeAt(i) === 47) {
      const n = text.charCodeAt(i + 1);
      if (n === 47 || n === 42) {
        if (!st.lenient) throw new JsonError('Comments are not allowed in JSON', i, 'comments');
        let j;
        if (n === 47) { j = text.indexOf('\n', i); if (j < 0 || j > end) j = end; }
        else { j = text.indexOf('*/', i + 2); if (j < 0 || j + 2 > end) throw new JsonError('Unterminated comment', i); j += 2; }
        removeComment(st, i, j, end);
        i = j; continue;
      }
    }
    return i;
  }
}
/** A comment alone on its lines goes with its line; one after code goes with the spaces before it. */
function removeComment(st, s, e, end) {
  const { text } = st;
  let from = s;
  while (from > st.lastEnd && (text.charCodeAt(from - 1) === 32 || text.charCodeAt(from - 1) === 9)) from--;
  const lineStart = from === 0 || text.charCodeAt(from - 1) === 10;
  let to = e;
  if (lineStart) { let k = e; while (k < end && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9)) k++; if (k >= end || text.charCodeAt(k) === 10) to = k < end ? k + 1 : k; }
  fix(st, 'comments', from, to);
}

/** The end of a string that starts at i (its quote is `quote`). */
function stringEnd(st, i, end, quote) {
  const { text } = st, s = i;
  i++;
  for (;;) {
    if (i >= end) throw new JsonError('Unterminated string', s);
    const c = text.charCodeAt(i);
    if (c === quote) return i + 1;
    if (c === 92) {
      const n = text.charCodeAt(i + 1);
      if (n === 117) {
        for (let k = 2; k < 6; k++) if (!isHex(text.charCodeAt(i + k))) throw new JsonError('Invalid \\u escape in a string', i);
        i += 6; continue;
      }
      if (ESCAPES.has(n) || (quote === 39 && n === 39)) { i += 2; continue; }
      throw new JsonError(i + 1 >= end ? 'Unterminated string' : `Invalid escape \\${text[i + 1]} in a string`, i + 1 >= end ? s : i);
    }
    if (c < 32) throw new JsonError(c === 10 ? 'Unterminated string' : 'Unescaped control character in a string', c === 10 ? s : i);
    i++;
  }
}
/** A single-quoted string as a JSON string: \' becomes ', a bare " is escaped, every other escape stays. */
export function requote(raw) {
  let out = '"';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i];
    if (c === '\\') { const n = raw[i + 1]; out += n === "'" ? "'" : `\\${n}`; i++; }
    else out += c === '"' ? '\\"' : c;
  }
  return `${out}"`;
}

function numberEnd(st, i, end) {
  const { text } = st, s = i;
  let c = text.charCodeAt(i);
  if (c === 45) c = text.charCodeAt(++i);
  if (c === 48) { i++; if (i < end && isDigit(text.charCodeAt(i))) throw new JsonError('A number cannot start with 0', s); }
  else if (c >= 49 && c <= 57) { while (i < end && isDigit(text.charCodeAt(i))) i++; }
  else throw new JsonError('Invalid number', s);
  if (i < end && text.charCodeAt(i) === 46) {
    i++;
    if (!(i < end && isDigit(text.charCodeAt(i)))) throw new JsonError('Invalid number: a digit must follow the point', s);
    while (i < end && isDigit(text.charCodeAt(i))) i++;
  }
  c = text.charCodeAt(i);
  if (i < end && (c === 101 || c === 69)) {
    i++; c = text.charCodeAt(i);
    if (c === 43 || c === 45) i++;
    if (!(i < end && isDigit(text.charCodeAt(i)))) throw new JsonError('Invalid number: a digit must follow the exponent', s);
    while (i < end && isDigit(text.charCodeAt(i))) i++;
  }
  if (i < end && isIdPart(text.charCodeAt(i))) throw new JsonError('Invalid number', s);
  return i;
}

const word = (text, i, end) => { let j = i; while (j < end && isIdPart(text.charCodeAt(j))) j++; return text.slice(i, j); };

/** A scalar at i: { node, i } after it. */
function scalar(st, i, end) {
  const { text } = st, c = text.charCodeAt(i);
  if (c === 34) { const e = stringEnd(st, i, end, 34); st.n++; return { k: 's', s: i, e }; }
  if (c === 39) {
    if (!st.lenient) throw new JsonError('Strings take double quotes', i, 'singleQuotes');
    const e = stringEnd(st, i, end, 39), r = requote(text.slice(i, e));
    fix(st, 'singleQuotes', i, e, r); st.n++;
    return { k: 's', s: i, e, r };
  }
  const sign = c === 45 || c === 43 ? 1 : 0;
  const w = isIdStart(text.charCodeAt(i + sign)) ? word(text, i + sign, end) : '';
  if (w === 'NaN' || w === 'Infinity') {
    const e = i + sign + w.length;
    if (!st.lenient) throw new JsonError(`${text.slice(i, e)} is not valid JSON`, i, 'nonFinite');
    fix(st, 'nonFinite', i, e, 'null'); st.n++;
    return { k: 'l', s: i, e, r: 'null' };
  }
  if (c === 45 || isDigit(c)) { const e = numberEnd(st, i, end); st.n++; return { k: 'n', s: i, e }; }
  if (w === 'true' || w === 'false' || w === 'null') { st.n++; return { k: 'l', s: i, e: i + w.length }; }
  if (i >= end) throw new JsonError('Unexpected end: expected a value', i);
  throw new JsonError('Expected a value', i);
}

/** One key at i: { node, i } after it. */
function key(st, i, end) {
  const { text } = st, c = text.charCodeAt(i);
  if (c === 34) return { k: 's', s: i, e: stringEnd(st, i, end, 34) };
  if (c === 39) {
    if (!st.lenient) throw new JsonError('Keys take double quotes', i, 'singleQuotes');
    const e = stringEnd(st, i, end, 39), r = requote(text.slice(i, e));
    fix(st, 'singleQuotes', i, e, r);
    return { k: 's', s: i, e, r };
  }
  if (isIdStart(c)) {
    const w = word(text, i, end);
    if (!st.lenient) throw new JsonError('Keys take double quotes', i, 'unquotedKeys');
    const r = JSON.stringify(w);
    fix(st, 'unquotedKeys', i, i + w.length, r);
    return { k: 's', s: i, e: i + w.length, r };
  }
  throw new JsonError(i >= end ? 'Unexpected end: expected a key' : 'Expected a key in double quotes', i);
}

const VALUE = 0, AFTER = 1, KEY_FIRST = 2, KEY_NEXT = 3, ELEMENT_NEXT = 4;
/**
 * One JSON value starting at or after i, up to end: { node, i } with i just after the value. A container node is { k: 'o'|'a', s, e, v, keys? };
 * a scalar { k: 's'|'n'|'l', s, e, r? } (r: the text a repair gives it). Iterative: the stack is an array.
 */
function value(st, i, end) {
  const { text } = st, stack = [];
  let mode = VALUE, node = null, comma = -1;
  for (;;) {
    if (mode === VALUE) {
      i = skip(st, i, end);
      if (i >= end) throw new JsonError(stack.length ? 'Unexpected end: expected a value' : 'No JSON value', i);
      const c = text.charCodeAt(i);
      if (c === 123) { node = { k: 'o', s: i, e: 0, keys: [], v: [] }; st.n++; stack.push(node); i++; mode = KEY_FIRST; continue; }
      if (c === 91) {
        const a = { k: 'a', s: i, e: 0, v: [] }; st.n++; i = skip(st, i + 1, end);
        if (text.charCodeAt(i) === 93 && i < end) { a.e = ++i; node = a; mode = AFTER; continue; }
        stack.push(a); mode = VALUE; continue;
      }
      const r = scalar(st, i, end); node = r; i = r.e; mode = AFTER; continue;
    }
    if (mode === AFTER) {
      const top = stack[stack.length - 1];
      if (!top) return { node, i };
      top.v.push(node);
      i = skip(st, i, end);
      const c = text.charCodeAt(i), close = top.k === 'a' ? 93 : 125;
      if (i < end && c === 44) { comma = i; i++; mode = top.k === 'a' ? ELEMENT_NEXT : KEY_NEXT; continue; }
      if (i < end && c === close) { top.e = ++i; stack.pop(); node = top; continue; }
      const want = top.k === 'a' ? ', or ]' : ', or }';
      throw new JsonError(i >= end ? `Unexpected end: expected ${want}` : `Expected ${want}`, i);
    }
    if (mode === ELEMENT_NEXT || mode === KEY_NEXT || mode === KEY_FIRST) {
      const top = stack[stack.length - 1];
      i = skip(st, i, end);
      const c = text.charCodeAt(i), close = top.k === 'a' ? 93 : 125;
      if (i < end && c === close && mode !== KEY_FIRST) {
        if (!st.lenient) throw new JsonError('Trailing comma', comma, 'trailingCommas');
        fix(st, 'trailingCommas', comma, comma + 1);
        top.e = ++i; stack.pop(); node = top; mode = AFTER; continue;
      }
      if (mode === ELEMENT_NEXT) { mode = VALUE; continue; }
      if (i < end && c === 125) { top.e = ++i; stack.pop(); node = top; mode = AFTER; continue; }   // {}
      const k = key(st, i, end);
      top.keys.push(k);
      i = skip(st, k.e, end);
      if (!(i < end && text.charCodeAt(i) === 58)) throw new JsonError(i >= end ? 'Unexpected end: expected :' : 'Expected : after the key', i);
      i++; mode = VALUE; continue;
    }
  }
}

// ---- positions -----------------------------------------------------------------------------------------------------------------

/** Line and column (1-based; a column counts UTF-16 code units, as the editor's caret does) of an offset. */
export function lineCol(text, offset) {
  let line = 1, from = 0;
  for (let j = text.indexOf('\n'); j >= 0 && j < offset; j = text.indexOf('\n', j + 1)) { line++; from = j + 1; }
  return { line, column: offset - from + 1 };
}
/** An error with its line and column; `base` ({ line, from }: a line start before the error) saves counting from the top. */
const errorOf = (text, err, base = null) => {
  if (!(err instanceof JsonError)) throw err;
  const at = Math.max(0, Math.min(text.length, err.offset));
  let line, column;
  if (base && at >= base.from) { const d = countNl(text, base.from, at); line = base.line + d; column = at - (d ? text.lastIndexOf('\n', at - 1) + 1 : base.from) + 1; }
  else ({ line, column } = lineCol(text, at));
  return { message: err.message, offset: at, line, column, fix: err.fix };
};
/** "Expected , or } at line 3, column 14" */
export const errorText = e => e ? `${e.message} at line ${e.line}, column ${e.column}` : '';

// ---- checking ------------------------------------------------------------------------------------------------------------------

/** One JSON document: { ok, root, nodes, error }. */
function parseDocument(text, lenient) {
  const st = stateOf(text, lenient);
  const { node, i } = value(st, 0, text.length);
  const after = skip(st, i, text.length);
  if (after < text.length) throw new JsonError('Unexpected text after the JSON value', after);
  return { root: node, nodes: st.n, st };
}

/**
 * JSON Lines: one value per line. Each line is parsed on its own (a broken line does not hide the next); a value that runs past its line
 * (a record pretty-printed for reading) is read across lines and reported, since Format puts each record back on one line.
 */
function parseLines(text, lenient) {
  const st = stateOf(text, lenient), records = [], errors = [];
  let i = 0, line = 1;
  const end = text.length;
  while (i < end) {
    let nl = text.indexOf('\n', i); if (nl < 0) nl = end;
    let j = i; while (j < nl && isWs(text.charCodeAt(j))) j++;
    if (j >= nl) { i = nl + 1; line++; continue; }   // a blank line
    const mark = { n: st.n, edits: st.edits.length, fixes: { ...st.fixes }, lastEnd: st.lastEnd };
    try {
      j = skip(st, j, nl);                               // a line that is only a comment (lenient) is a blank line
      if (j >= nl) { i = nl + 1; line++; continue; }
      // first the line alone; a value still open at the line's end is read on to the end of the file
      let r;
      try { r = value(st, j, nl); }
      catch (e) {
        if (!(e instanceof JsonError) || !/^Unexpected end/.test(e.message) || nl >= end) throw e;
        Object.assign(st, { n: mark.n, fixes: { ...mark.fixes }, lastEnd: mark.lastEnd }); st.edits.length = mark.edits;
        try { r = value(st, j, end); } catch (e2) { if (e2 instanceof JsonError) throw e; throw e2; }   // still broken: the line's own error says where
      }
      let le = text.indexOf('\n', r.i); if (le < 0) le = end;
      const k = skip(st, r.i, le);
      if (k < le) throw new JsonError('Unexpected text after the record', k);
      const lastLine = line + countNl(text, j, r.i);
      records.push({ node: r.node, line, lastLine });
      if (lastLine > line) errors.push({ message: `A record spans lines ${line} to ${lastLine}`, offset: j, line, column: j - i + 1, fix: 'lines' });
      line = lastLine + 1; i = le + 1;
    } catch (e) {
      Object.assign(st, { n: mark.n, fixes: mark.fixes, lastEnd: mark.lastEnd }); st.edits.length = mark.edits;
      errors.push(errorOf(text, e, { line, from: i }));
      i = nl + 1; line++;
    }
  }
  return { records, errors, nodes: st.n, st };
}
const countNl = (text, from, to) => { let n = 0; for (let j = text.indexOf('\n', from); j >= 0 && j < to; j = text.indexOf('\n', j + 1)) n++; return n; };

/**
 * Checks a text. `lines` reads it as JSON Lines. Returns { ok, lines, root?, records?, nodes, error, errors (lines), repair }: `repair` is
 * what Repair would fix ({ comments: 1, ... } and `total`) when the text is only wrong in ways Repair fixes, else null.
 */
export function check(text, { lines = false } = {}) {
  const t = String(text ?? '');
  if (lines) {
    const r = parseLines(t, false);
    const syntax = r.errors.filter(e => e.fix !== 'lines');
    let repair = null;
    if (syntax.length) {
      const l = parseLines(t, true);
      if (!l.errors.some(e => e.fix !== 'lines')) repair = tally(l.st.fixes);
    }
    return { ok: !r.errors.length, lines: true, records: r.records, nodes: r.nodes, errors: r.errors, error: r.errors[0] || null, repair, spans: r.errors.some(e => e.fix === 'lines') && !syntax.length };
  }
  if (!t.trim()) return { ok: false, lines: false, root: null, nodes: 0, errors: [], error: { message: 'No JSON value', offset: 0, line: 1, column: 1, fix: '' }, repair: null, empty: true };
  try {
    const r = parseDocument(t, false);
    return { ok: true, lines: false, root: r.root, nodes: r.nodes, error: null, errors: [], repair: null };
  } catch (e) {
    const error = errorOf(t, e);
    let repair = null;
    try { repair = tally(parseDocument(t, true).st.fixes); } catch (e2) { if (!(e2 instanceof JsonError)) throw e2; }
    return { ok: false, lines: false, root: null, nodes: 0, error, errors: [error], repair };
  }
}
const tally = fixes => { const total = Object.values(fixes).reduce((a, b) => a + b, 0); return total ? { ...fixes, total } : null; };

/** What a repair did, in words: "2 comments, 1 trailing comma". */
export function fixWords(fixes) {
  return Object.keys(FIX_LABELS).filter(k => fixes?.[k]).map(k => `${fixes[k].toLocaleString('en')} ${FIX_LABELS[k][fixes[k] === 1 ? 0 : 1]}`).join(', ');
}

/** Repair: { text, fixes } with every comment, trailing comma, single quote, unquoted key and NaN or Infinity fixed, or null when something else is wrong. */
export function repair(text, { lines = false } = {}) {
  const t = String(text ?? '');
  let st;
  if (lines) { const r = parseLines(t, true); if (r.errors.some(e => e.fix !== 'lines')) return null; st = r.st; }
  else { try { st = parseDocument(t, true).st; } catch (e) { if (e instanceof JsonError) return null; throw e; } }
  const fixes = tally(st.fixes);
  if (!fixes) return { text: t, fixes: null };
  return { text: applyEdits(t, st.edits), fixes };
}
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.s - b.s), out = [];
  let at = 0;
  for (const e of sorted) { if (e.s < at) continue; out.push(text.slice(at, e.s), e.t); at = e.e; }
  out.push(text.slice(at));
  return out.join('');
}

// ---- printing ------------------------------------------------------------------------------------------------------------------

const UNIT = { '2': '  ', '4': '    ', tab: '\t' };
const TAB_COLUMNS = 4;
const raw = (text, n) => n.r ?? text.slice(n.s, n.e);
const toAscii = s => s.replace(/[^\x00-\x7f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
const plainNumber = s => { const x = Number(s); return Number.isFinite(x) ? JSON.stringify(x) : s; };
const keyText = (text, k) => { const s = raw(text, k); return s.indexOf('\\') < 0 ? s.slice(1, -1) : JSON.parse(s); };

function orderOf(text, node, dir) {
  const keys = node.keys.map(k => keyText(text, k)), idx = keys.map((_, i) => i);
  const sign = dir === 'desc' ? -1 : 1;
  return idx.sort((a, b) => (keys[a] < keys[b] ? -sign : keys[a] > keys[b] ? sign : 0) || a - b);
}

/**
 * The text of a value. o: { indent: '2'|'4'|'tab', sort: 'off'|'asc'|'desc', inline: 0|80|120, ascii, exact, minify, base (columns the
 * first line already stands at), lead (the indentation every following line starts with) }.
 */
export function print(text, node, o = {}) {
  const minify = !!o.minify, unit = minify ? '' : UNIT[o.indent] ?? UNIT['2'];
  const unitCols = unit === '\t' ? TAB_COLUMNS : unit.length, lead = o.lead || '', base = o.base || 0;
  const sort = o.sort === 'asc' || o.sort === 'desc' ? o.sort : '', inline = minify ? 0 : Number(o.inline) || 0;
  const nl = minify ? '' : '\n', colon = minify ? ':' : ': ';
  const pads = [];
  const pad = d => (minify ? '' : pads[d] ??= lead + unit.repeat(d));
  const sc = n => { let s = raw(text, n); if (n.k === 'n' && o.exact === false) s = plainNumber(s); else if (n.k === 's' && o.ascii) s = toAscii(s); return s; };
  const out = [], stack = [];
  const emit = (n, depth, col) => {
    if (n.k !== 'o' && n.k !== 'a') { out.push(sc(n)); return; }
    if (!n.v.length) { out.push(n.k === 'o' ? '{}' : '[]'); return; }
    if (inline && n.k === 'a' && n.v.every(x => x.k !== 'o' && x.k !== 'a')) {
      const parts = n.v.map(sc), len = parts.reduce((a, p) => a + p.length, 0) + 2 * parts.length;
      if (col + len + 1 <= inline) { out.push(`[${parts.join(', ')}]`); return; }
    }
    out.push(n.k === 'o' ? '{' : '[');
    stack.push({ n, depth, i: 0, order: n.k === 'o' && sort ? orderOf(text, n, sort) : null });
  };
  emit(node, 0, base);
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.i >= f.n.v.length) { stack.pop(); out.push(nl + pad(f.depth), f.n.k === 'o' ? '}' : ']'); continue; }
    const at = f.order ? f.order[f.i] : f.i;
    out.push(f.i ? `,${nl}` : nl, pad(f.depth + 1));
    f.i++;
    let col = base + (f.depth + 1) * unitCols;
    if (f.n.k === 'o') { const k = sc(f.n.keys[at]); out.push(k, colon); col += k.length + colon.length; }
    emit(f.n.v[at], f.depth + 1, col);
  }
  return out.join('');
}

/**
 * Format (or minify) a whole text: { text, changed } or { error } when the text is not valid. JSON Lines are printed one record per line,
 * whatever the options say about indenting; blank lines are dropped.
 */
export function format(text, options = {}, { lines = false, minify = false } = {}) {
  const t = String(text ?? ''), o = { ...cleanOptions(options), minify: minify || lines };
  const c = check(t, { lines });
  if (lines ? c.errors.some(e => e.fix !== 'lines') : !c.ok) return { error: (lines ? c.errors.find(e => e.fix !== 'lines') : c.error) || c.error, repair: c.repair };
  let next = lines ? c.records.map(r => print(t, r.node, o)).join('\n') : print(t, c.root, o);
  if (o.finalNewline && next) next += '\n';
  return { text: next, changed: changedLines(t, next) };
}

/** One record of a JSON Lines text (the one on `line`) pretty-printed in place: { text, from, to, replace, insert } (`replace`: the range `insert` takes) or null. */
export function expandRecord(text, line, options = {}) {
  const t = String(text ?? ''), c = check(t, { lines: true });
  const rec = c.records.find(r => r.line <= line && line <= r.lastLine);
  if (!rec) return null;
  const printed = print(t, rec.node, { ...cleanOptions(options), minify: false });
  return { text: t.slice(0, rec.node.s) + printed + t.slice(rec.node.e), from: rec.node.s, to: rec.node.s + printed.length, replace: [rec.node.s, rec.node.e], insert: printed };
}

/**
 * The value selected (from, to) re-printed with its keys sorted (direction `sort`, A to Z when the options sort nothing): its first line stays
 * where it is, the lines after it take the indentation of the line it starts on. { text, from, to, replace, insert } or { error }.
 */
export function sortSelection(text, from, to, options = {}) {
  const t = String(text ?? ''), sel = t.slice(from, to);
  const lead = sel.length - sel.trimStart().length, trail = sel.length - sel.trimEnd().length;
  const inner = sel.trim();
  if (!inner || (inner[0] !== '{' && inner[0] !== '[')) return { error: 'Select an object or an array' };
  const c = check(inner);
  if (!c.ok) return { error: errorText(c.error) };
  const o = cleanOptions(options), start = from + lead;
  const lineStart = t.lastIndexOf('\n', start - 1) + 1, indent = /^[ \t]*/.exec(t.slice(lineStart, start))[0];
  const printed = print(inner, c.root, { ...o, sort: o.sort === 'off' ? 'asc' : o.sort, lead: indent, base: start - lineStart });
  return { text: t.slice(0, start) + printed + t.slice(to - trail), from: start, to: start + printed.length, replace: [start, to - trail], insert: printed };
}

/** Lines of `next` that `prev` does not have, or the other way round (whichever is more): what a person reads as "lines changed". */
export function changedLines(prev, next) {
  if (prev === next) return 0;
  const seen = new Map();
  for (const l of String(prev).split('\n')) seen.set(l, (seen.get(l) || 0) + 1);
  let added = 0;
  for (const l of String(next).split('\n')) { const n = seen.get(l); if (n) seen.set(l, n - 1); else added++; }
  let removed = 0; for (const n of seen.values()) removed += n;
  return Math.max(added, removed);
}

// ---- paths ---------------------------------------------------------------------------------------------------------------------

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const keySegment = k => (IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
/** The roots of a check: the document, or each record of JSON Lines as $[i]. */
const rootsOf = c => (c?.lines ? (c.records || []).map(r => r.node) : c?.root ? [c.root] : []);

/** The child of a container that holds offset: its index, or -1. A member is its key to the end of its value. */
function childAt(node, offset) {
  const v = node.v;
  let lo = 0, hi = v.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = node.k === 'o' ? node.keys[mid].s : v[mid].s;
    if (s <= offset) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && offset <= v[found].e ? found : -1;
}
/**
 * The path of the value at offset ($.parts[0]) and the value: { path, node, from } (from: where its member starts, its key) or null when the
 * text is not valid or the offset is outside every value.
 */
export function pathAt(text, c, offset) {
  const roots = rootsOf(c);
  if (!roots.length) return null;
  let node, path, from;
  if (c.lines) {
    const i = roots.findIndex(r => r.s <= offset && offset <= r.e);
    if (i < 0) return null;
    node = roots[i]; path = `$[${i}]`; from = node.s;
  } else { node = roots[0]; path = '$'; from = node.s; if (offset < node.s || offset > node.e) return { path, node, from }; }
  for (;;) {
    if (node.k !== 'o' && node.k !== 'a') break;
    const i = childAt(node, offset);
    if (i < 0) break;
    if (node.k === 'o') { from = node.keys[i].s; path += keySegment(keyText(text, node.keys[i])); }
    else { from = node.v[i].s; path += `[${i}]`; }
    node = node.v[i];
  }
  return { path, node, from };
}

/** The segments of a path as pathAt writes it ($.a["b c"][0]): keys as strings, indexes as numbers; null when it is not such a path. */
export function pathSegments(path) {
  const p = String(path || '');
  if (p[0] !== '$') return null;
  const out = [];
  let i = 1;
  while (i < p.length) {
    if (p[i] === '.') { const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(p.slice(i + 1)); if (!m) return null; out.push(m[0]); i += 1 + m[0].length; }
    else if (p[i] === '[' && p[i + 1] === '"') {
      let j = i + 2; while (j < p.length && p[j] !== '"') j += p[j] === '\\' ? 2 : 1;
      if (p[j + 1] !== ']') return null;
      try { out.push(JSON.parse(p.slice(i + 1, j + 1))); } catch { return null; }
      i = j + 2;
    } else if (p[i] === '[') { const m = /^\[(\d+)\]/.exec(p.slice(i)); if (!m) return null; out.push(Number(m[1])); i += m[0].length; }
    else return null;
  }
  return out;
}
/** The value at a path, where it is now: { node, from } or null. A key that appears twice is its first. */
export function findPath(text, c, path) {
  const segs = pathSegments(path), roots = rootsOf(c);
  if (!segs || !roots.length) return null;
  let node, from, k = 0;
  if (c.lines) { if (typeof segs[0] !== 'number' || !roots[segs[0]]) return null; node = roots[segs[0]]; k = 1; }
  else node = roots[0];
  from = node.s;
  for (; k < segs.length; k++) {
    const seg = segs[k];
    if (typeof seg === 'number') { if (node.k !== 'a' || !node.v[seg]) return null; node = node.v[seg]; from = node.s; }
    else { if (node.k !== 'o') return null; const i = node.keys.findIndex(x => keyText(text, x) === seg); if (i < 0) return null; from = node.keys[i].s; node = node.v[i]; }
  }
  return { node, from };
}

/** The text a "Copy value" gives: a string's own words, any other value as JSON. */
export const valueText = (text, n) => (n.k === 's' ? JSON.parse(raw(text, n)) : n.k === 'o' || n.k === 'a' ? text.slice(n.s, n.e) : raw(text, n));

// ---- the tree ------------------------------------------------------------------------------------------------------------------

const PREVIEW = 120;
const kindWord = n => (n.k === 'o' ? 'object' : n.k === 'a' ? 'array' : n.k === 's' ? 'string' : n.k === 'n' ? 'number' : 'literal');
/** What a row shows of a value: a scalar's text (clipped), a container's size. */
export function preview(text, n) {
  if (n.k === 'o') return n.v.length === 1 ? '1 key' : `${n.v.length.toLocaleString('en')} keys`;
  if (n.k === 'a') return n.v.length === 1 ? '1 item' : `${n.v.length.toLocaleString('en')} items`;
  const s = raw(text, Object.assign({}, n, n.e - n.s > PREVIEW * 2 && !n.r ? { e: n.s + PREVIEW * 2 } : {}));
  return s.length > PREVIEW ? `${s.slice(0, PREVIEW)}…` : s;
}

/** Every container whose depth is under `depth` (0: none; Infinity: all), as the set of ids (a node's id is its start offset) a tree opens. */
export function openToDepth(c, depth) {
  const out = new Set(), stack = rootsOf(c).map(n => [n, 0]);
  while (stack.length) {
    const [n, d] = stack.pop();
    if ((n.k !== 'o' && n.k !== 'a') || d >= depth) continue;
    out.add(n.s);
    for (const x of n.v) if (x.k === 'o' || x.k === 'a') stack.push([x, d + 1]);
  }
  return out;
}

/** Search keys and values (case does not matter): { count, keep } where keep holds every match and every container on the way to one. */
export function searchTree(text, c, query) {
  const q = String(query || '').trim().toLowerCase();
  const keep = new Set(), hits = new Set();
  if (!q) return { count: 0, keep, hits };
  const roots = rootsOf(c), stack = [];
  // depth-first with the path of containers kept, so a match marks its ancestors
  for (const r of roots) stack.push({ n: r, key: null, parents: null });
  let count = 0;
  while (stack.length) {
    const { n, key: k, parents } = stack.pop();
    const own = (k != null && keyText(text, k).toLowerCase().includes(q)) || (n.k !== 'o' && n.k !== 'a' && raw(text, n).toLowerCase().includes(q));
    if (own) {
      count++; hits.add(n.s);
      keep.add(n.s);
      for (let p = parents; p && !keep.has(p.id); p = p.up) keep.add(p.id);
    }
    if (n.k === 'o' || n.k === 'a') {
      const me = { id: n.s, up: parents };
      for (let i = n.v.length - 1; i >= 0; i--) stack.push({ n: n.v[i], key: n.k === 'o' ? n.keys[i] : null, parents: me });
    }
  }
  return { count, keep, hits };
}

/**
 * The rows of the tree as drawn: depth-first, a container's children only when it is open (or, while searching, only the kept ones, and a
 * container on the way to a match open). { rows, total } where rows are rows [start, start + limit) and total is how many rows there are.
 * A row: { id, depth, label, index, kind, preview, size, open, path, from, to, hit }.
 */
export function treeRows(text, c, { open = new Set(), found = null, start = 0, limit = TREE_PAGE } = {}) {
  const roots = rootsOf(c), rows = [], stack = [];
  // an entry keeps its key node and its parent entry, so a label and a path are only worked out for the rows drawn
  const labelOf = x => (x.rec != null ? `Line ${c.records[x.rec].line}` : x.k ? keyText(text, x.k) : x.up ? String(x.i) : null);
  const pathOf = x => { const segs = []; for (let p = x; p; p = p.up) segs.push(p.rec != null ? `$[${p.rec}]` : p.k ? keySegment(keyText(text, p.k)) : p.up ? `[${p.i}]` : '$'); return segs.reverse().join(''); };
  let total = 0;
  for (let i = roots.length - 1; i >= 0; i--) stack.push({ n: roots[i], depth: 0, k: null, i, up: null, rec: c.lines ? i : null });
  while (stack.length) {
    const x = stack.pop(), n = x.n, container = n.k === 'o' || n.k === 'a';
    if (found && !found.keep.has(n.s)) continue;
    const isOpen = container && n.v.length > 0 && (open.has(n.s) || (!!found && !found.hits.has(n.s)));
    if (total >= start && total < start + limit) {
      rows.push({ id: n.s, depth: x.depth, label: labelOf(x), index: !x.k && x.rec == null && !!x.up, kind: kindWord(n), preview: preview(text, n), size: container ? n.v.length : 0,
        open: isOpen, container, path: pathOf(x), from: x.k ? x.k.s : n.s, to: n.e, hit: !!found?.hits.has(n.s) });
    }
    total++;
    if (isOpen) for (let i = n.v.length - 1; i >= 0; i--) stack.push({ n: n.v[i], depth: x.depth + 1, k: n.k === 'o' ? n.keys[i] : null, i, up: x, rec: null });
  }
  return { rows, total };
}

/** The node with this id (its start offset): { node, path, from } by descending from the roots. */
export function nodeAt(text, c, id) {
  const p = pathAt(text, c, id);
  return p && p.node.s === id ? p : null;
}

// ---- CSV -----------------------------------------------------------------------------------------------------------------------

/**
 * A table of an array of flat objects (or JSON Lines of them): one row per object, one column per key in the order first seen. Null when
 * the data has another shape (an object holding an object or an array, or something not an object).
 */
export function toCsv(text, c) {
  const items = c?.lines ? rootsOf(c) : c?.root?.k === 'a' ? c.root.v : null;
  if (!items?.length) return null;
  const cols = [], at = new Map();
  for (const it of items) {
    if (it.k !== 'o') return null;
    for (let i = 0; i < it.v.length; i++) {
      if (it.v[i].k === 'o' || it.v[i].k === 'a') return null;
      const k = keyText(text, it.keys[i]);
      if (!at.has(k)) { at.set(k, cols.length); cols.push(k); }
    }
  }
  if (!cols.length) return null;
  const cell = s => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [cols.map(cell).join(',')];
  for (const it of items) {
    const row = new Array(cols.length).fill('');
    for (let i = 0; i < it.v.length; i++) {
      const v = it.v[i], t = raw(text, v);
      row[at.get(keyText(text, it.keys[i]))] = v.k === 's' ? JSON.parse(t) : t === 'null' ? '' : t;
    }
    lines.push(row.map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
