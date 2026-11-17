// Data management for a primary study's datasets (amendment of 2026-09-29):
// column constraints, cross-field edit checks, and the change log with locks
// and source-data verification. No UI; pure over the dataset shape of
// lib/datasets.mjs and a state object the caller passes in.
//
// Column constraints live on the column:
//   column.rules = { required, min, max, allowed: [values], pattern,
//                    missingCodes: ['-99', 'NA'], unit }
// A cell holding one of its column's missing codes is missing, not wrong: it
// is never a type, range, allowed or pattern error, and it satisfies
// `required` (the value is known to be missing), reported as `missing-code`
// with severity 'info'.
//
// Edit checks are written in a small expression language, parsed here and
// evaluated by walking the tree: no eval, no new Function, no property access.
//   discharge_date >= admission_date
//   if sex == 'M' then pregnant is empty
//   bmi between 12 and 70
//   discharge_date - admission_date <= 90        (a date minus a date is days)
//   days(admission_date, discharge_date) <= 90   (the same)
//   sex in ('M', 'F') and not (age < 18)
//   if randomised == 'Yes' then coalesce(consented, 'No') == 'Yes'
// Comparisons with an empty operand are unknown, and an unknown check passes:
// "discharge_date >= admission_date" does not fire on a row with no discharge.
// `and`, `or` and `not` follow three-valued (Kleene) logic; `if A then B` is
// the implication `not A or B`.
//
// Rows are identified by index unless the dataset names a key column
// (`dataset.rowKey`, e.g. 'participant_id'); locks and verification are kept
// by that identifier.
import { cellValue } from './datasets.mjs';

// ---- values -------------------------------------------------------------------

/** Missing codes a column declares, as trimmed strings. */
export const missingCodesOf = column => (column?.rules?.missingCodes || []).map(c => String(c).trim()).filter(Boolean);
/** Codes that are often used for missing values; a cell holding one that the column does not declare gets a hint. */
export const COMMON_MISSING = ['-99', '-999', '-9', '-88', '999', '9999', 'NA', 'N/A', 'NK', 'ND', '.', 'missing', 'unknown'];

const isBlank = v => v == null || String(v).trim() === '';
/** Whether a cell holds one of its column's missing codes (case-insensitive). */
export function isMissingCode(value, column) {
  if (isBlank(value)) return false;
  const v = String(value).trim().toLowerCase();
  return missingCodesOf(column).some(c => c.toLowerCase() === v);
}
/** Empty, or a declared missing code. */
export const isMissing = (value, column) => isBlank(value) || isMissingCode(value, column);

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/;
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[T ](\d{1,2}):(\d{2}))?$/;
/**
 * A date cell as UTC milliseconds, or null. ISO dates (with an optional time)
 * and day-first dates (31/12/2024, 31.12.2024); a two-digit year is 20xx.
 * An impossible date (31/02/2024) is null.
 */
export function parseDate(value) {
  const t = String(value ?? '').trim();
  let y, mo, d, h = 0, mi = 0, s = 0, m;
  if ((m = ISO.exec(t))) [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number);
  else if ((m = DMY.exec(t))) { [d, mo, y, h, mi] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0].map(Number); if (y < 100) y += 2000; }
  else return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s), back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  return ms;
}
const DAY = 86_400_000;
/** A UTC millisecond time as YYYY-MM-DD, with " HH:MM" when it has a time of day. */
export function formatDate(ms, { time = null } = {}) {
  const x = new Date(ms), p = n => String(n).padStart(2, '0');
  const date = `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
  const withTime = time ?? (ms % DAY !== 0);
  return withTime ? `${date} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}` : date;
}

// ---- column constraints -------------------------------------------------------

const label = c => c.label || c.id;
const num = (v, type) => cellValue(v, type === 'integer' ? 'integer' : 'number');
const bound = (b, type) => type === 'date' ? parseDate(b) : (b === '' || b == null ? null : Number(b));
const safePattern = src => { try { return new RegExp(`^(?:${src})$`, 'u'); } catch { return null; } };

/** The row identifier used for locks and verification: the key column's value, else the index. */
export const rowIdOf = (dataset, index) => dataset?.rowKey ? String(dataset.rows[index]?.[dataset.rowKey] ?? index) : index;

/**
 * Every constraint breach in a dataset:
 * [{ row, rowId, column, kind, value, message, severity }], kind one of
 * required, range, allowed, pattern, type, missing-code. `row` is the index.
 */
export function checkDataset(dataset) {
  const issues = [];
  const push = (row, c, kind, value, message, severity = 'error') =>
    issues.push({ row, rowId: rowIdOf(dataset, row), column: c.id, kind, value, message, severity });
  for (const c of dataset?.columns || []) {
    const r = c.rules || {}, type = c.type || 'text';
    const lo = bound(r.min, type), hi = bound(r.max, type), unit = r.unit ? ` ${r.unit}` : '';
    const allowed = (r.allowed || []).map(a => String(a).trim().toLowerCase());
    const re = r.pattern ? safePattern(r.pattern) : null;
    (dataset.rows || []).forEach((row, i) => {
      const raw = row[c.id], v = isBlank(raw) ? '' : String(raw).trim();
      if (v === '') { if (r.required) push(i, c, 'required', raw ?? '', `${label(c)} is required`); return; }
      if (isMissingCode(v, c)) { if (r.required) push(i, c, 'missing-code', v, `${label(c)} is coded missing (${v})`, 'info'); return; }
      const hint = COMMON_MISSING.some(x => x.toLowerCase() === v.toLowerCase()) ? `; if ${v} means missing, declare it as a missing code` : '';
      let x = null;
      if (type === 'number' || type === 'integer') {
        x = num(v, type);
        if (x == null || (type === 'integer' && !Number.isInteger(x))) { push(i, c, 'type', v, `${label(c)}: ${v} is not ${type === 'integer' ? 'a whole number' : 'a number'}${hint}`); return; }
      } else if (type === 'date') {
        x = parseDate(v);
        if (x == null) { push(i, c, 'type', v, `${label(c)}: ${v} is not a date${hint}`); return; }
      }
      if (x != null && ((lo != null && x < lo) || (hi != null && x > hi))) {
        const range = lo != null && hi != null ? `between ${r.min} and ${r.max}` : lo != null ? `at least ${r.min}` : `at most ${r.max}`;
        push(i, c, 'range', v, `${label(c)}: ${v}${unit} is outside the range (${range}${unit})${hint}`);
      }
      if (allowed.length && !allowed.includes(v.toLowerCase())) push(i, c, 'allowed', v, `${label(c)}: ${v} is not one of ${r.allowed.join(', ')}${hint}`);
      if (re && !re.test(v)) push(i, c, 'pattern', v, `${label(c)}: ${v} does not match the pattern`);
    });
  }
  return issues;
}

// ---- the edit-check language ----------------------------------------------------

const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'then', 'else', 'is', 'empty', 'between', 'in', 'true', 'false']);
const FUNCTIONS = {
  days: 2,      // days(from, to): to − from in days
  abs: 1,
  year: 1,
  month: 1,
  length: 1,
  date: 1,      // date('2024-01-31'): a date literal
  min: -1,
  max: -1,
  coalesce: -1, // coalesce(x, 'No'): the first operand that is not empty
};
export const RULE_FUNCTIONS = Object.keys(FUNCTIONS);

class RuleError extends Error { constructor(message, pos) { super(message); this.pos = pos; } }

function tokenize(text) {
  const out = [], s = String(text);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1] || ''))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i));
      out.push({ t: 'num', v: Number(m[0]), pos: start }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let v = ''; i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\' && i + 1 < s.length) i++; v += s[i++]; }
      if (i >= s.length) throw new RuleError('Unfinished text in quotes', start);
      i++; out.push({ t: 'str', v, pos: start }); continue;
    }
    if (c === '`' || c === '[') {
      const close = c === '`' ? '`' : ']', j = s.indexOf(close, i + 1);
      if (j < 0) throw new RuleError(`Unfinished column name; close it with ${close}`, start);
      out.push({ t: 'id', v: s.slice(i + 1, j).trim(), pos: start }); i = j + 1; continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      const m = /^[\wÀ-ɏ.]+/.exec(s.slice(i));
      const w = m[0], lw = w.toLowerCase();
      out.push(KEYWORDS.has(lw) ? { t: 'kw', v: lw, pos: start } : { t: 'id', v: w, pos: start });
      i += w.length; continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '<>', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two, pos: start }); i += 2; continue; }
    if ('=<>+-*/(),!'.includes(c)) { out.push({ t: 'op', v: c, pos: start }); i++; continue; }
    throw new RuleError(`Unexpected character '${c}'`, start);
  }
  out.push({ t: 'end', pos: s.length });
  return out;
}

/**
 * A rule's text as a tree. Returns { ast, error: null, pos: null }, or
 * { ast: null, error, pos } with the character position of the problem.
 */
export function parseRule(text) {
  try {
    const toks = tokenize(text);
    let k = 0;
    const peek = () => toks[k];
    const isKw = w => peek().t === 'kw' && peek().v === w;
    const isOp = (...ops) => peek().t === 'op' && ops.includes(peek().v);
    const expect = (pred, what) => { if (!pred()) throw new RuleError(`Expected ${what}${peek().t === 'end' ? ' at the end' : ''}`, peek().pos); return toks[k++]; };
    const node = (type, pos, props) => ({ type, pos, ...props });

    function expr() {
      if (isKw('if')) {
        const pos = toks[k++].pos, cond = expr();
        expect(() => isKw('then'), "'then'");
        const then = expr();
        let otherwise = null;
        if (isKw('else')) { k++; otherwise = expr(); }
        return node('if', pos, { cond, then, else: otherwise });
      }
      return or();
    }
    function or() {
      let left = and();
      while (isKw('or') || isOp('||')) { const pos = toks[k++].pos; left = node('or', pos, { left, right: and() }); }
      return left;
    }
    function and() {
      let left = not();
      while (isKw('and') || isOp('&&')) { const pos = toks[k++].pos; left = node('and', pos, { left, right: not() }); }
      return left;
    }
    function not() {
      if (isKw('not') || isOp('!')) { const pos = toks[k++].pos; return node('not', pos, { arg: not() }); }
      return comparison();
    }
    function comparison() {
      const left = additive();
      if (isOp('==', '=', '!=', '<>', '<', '<=', '>', '>=')) {
        const t = toks[k++], op = t.v === '=' ? '==' : t.v === '<>' ? '!=' : t.v;
        return node('cmp', t.pos, { op, left, right: additive() });
      }
      if (isKw('is')) {
        const pos = toks[k++].pos; let negate = false;
        if (isKw('not')) { k++; negate = true; }
        expect(() => isKw('empty'), "'empty' after 'is'");
        const n = node('empty', pos, { arg: left });
        return negate ? node('not', pos, { arg: n }) : n;
      }
      if (isKw('between')) {
        const pos = toks[k++].pos, lo = additive();
        expect(() => isKw('and'), "'and' in 'between … and …'");
        return node('between', pos, { arg: left, lo, hi: additive() });
      }
      let negate = false;
      if (isKw('not') && toks[k + 1]?.t === 'kw' && toks[k + 1].v === 'in') { k++; negate = true; }
      if (isKw('in')) {
        const pos = toks[k++].pos;
        expect(() => isOp('('), "'(' after 'in'");
        const items = [additive()];
        while (isOp(',')) { k++; items.push(additive()); }
        expect(() => isOp(')'), "')'");
        const n = node('in', pos, { arg: left, items });
        return negate ? node('not', pos, { arg: n }) : n;
      }
      return left;
    }
    function additive() {
      let left = multiplicative();
      while (isOp('+', '-')) { const t = toks[k++]; left = node('arith', t.pos, { op: t.v, left, right: multiplicative() }); }
      return left;
    }
    function multiplicative() {
      let left = unary();
      while (isOp('*', '/')) { const t = toks[k++]; left = node('arith', t.pos, { op: t.v, left, right: unary() }); }
      return left;
    }
    function unary() {
      if (isOp('-')) { const pos = toks[k++].pos; return node('neg', pos, { arg: unary() }); }
      if (isOp('+')) { k++; return unary(); }
      return primary();
    }
    function primary() {
      const t = peek();
      if (t.t === 'num') { k++; return node('lit', t.pos, { value: t.v }); }
      if (t.t === 'str') { k++; return node('lit', t.pos, { value: t.v }); }
      if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) { k++; return node('lit', t.pos, { value: t.v === 'true' }); }
      if (t.t === 'kw' && t.v === 'empty') { k++; return node('lit', t.pos, { value: null }); }
      if (isOp('(')) {
        k++; const e = expr();
        expect(() => isOp(')'), "')'");
        return e;
      }
      if (t.t === 'id') {
        k++;
        if (isOp('(')) {
          const name = t.v.toLowerCase();
          if (!(name in FUNCTIONS)) throw new RuleError(`Unknown function '${t.v}'; use one of ${RULE_FUNCTIONS.join(', ')}`, t.pos);
          k++; const args = [];
          if (!isOp(')')) { args.push(expr()); while (isOp(',')) { k++; args.push(expr()); } }
          expect(() => isOp(')'), "')' to close the function");
          const want = FUNCTIONS[name];
          if (want >= 0 && args.length !== want) throw new RuleError(`${name}() takes ${want} argument${want === 1 ? '' : 's'}`, t.pos);
          if (want < 0 && !args.length) throw new RuleError(`${name}() takes at least one argument`, t.pos);
          return node('call', t.pos, { name, args });
        }
        return node('ref', t.pos, { name: t.v });
      }
      if (t.t === 'end') throw new RuleError('The rule ends too early', t.pos);
      throw new RuleError(`Unexpected '${t.v}'`, t.pos);
    }

    const ast = expr();
    if (peek().t !== 'end') throw new RuleError(`Unexpected '${peek().v}' after a complete rule`, peek().pos);
    return { ast, error: null, pos: null };
  } catch (e) {
    if (e instanceof RuleError) return { ast: null, error: e.message, pos: e.pos };
    throw e;
  }
}

/** The column names a rule refers to. */
export function ruleColumns(ast) {
  const out = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'ref') out.add(n.name);
    for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
  })(ast);
  return [...out];
}

// Runtime values: number, string, boolean, null (empty or unknown), or a date.
const D = ms => ({ date: ms });
const isDate = v => v != null && typeof v === 'object' && 'date' in v;
const looksDate = v => typeof v === 'string' && /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(v.trim()) && parseDate(v) != null;
const looksNumber = v => typeof v === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(v);

function findColumn(columns, name) {
  const n = String(name).toLowerCase();
  return (columns || []).find(c => c.id === name) || (columns || []).find(c => c.id.toLowerCase() === n || String(c.label || '').toLowerCase() === n) || null;
}

function cell(row, name, columns) {
  const c = findColumn(columns, name);
  const key = c ? c.id : name;
  const raw = row && Object.hasOwn(row, key) ? row[key] : null;
  if (isBlank(raw) || (c && isMissingCode(raw, c))) return null;
  const v = String(raw).trim();
  const type = c?.type;
  if (type === 'number' || type === 'integer') return cellValue(v, 'number');
  if (type === 'date') { const ms = parseDate(v); return ms == null ? null : D(ms); }
  if (!type || type === 'text' || type === 'category') {
    if (!type && looksNumber(v)) return Number(v);
    if (!type && looksDate(v)) return D(parseDate(v));
  }
  return v;
}

// Bring two operands to a common kind for comparison or arithmetic.
function coerce(a, b) {
  if (isDate(a) && typeof b === 'string' && parseDate(b) != null) return [a, D(parseDate(b))];
  if (isDate(b) && typeof a === 'string' && parseDate(a) != null) return [D(parseDate(a)), b];
  if (typeof a === 'number' && looksNumber(b)) return [a, Number(b)];
  if (typeof b === 'number' && looksNumber(a)) return [Number(a), b];
  return [a, b];
}
const key = v => isDate(v) ? v.date : typeof v === 'string' ? v.trim().toLowerCase() : v;
function compare(op, a, b) {
  if (a == null || b == null) return null;
  [a, b] = coerce(a, b);
  const x = key(a), y = key(b);
  if (op === '==') return x === y;
  if (op === '!=') return x !== y;
  if (typeof x !== typeof y) return null;
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}
const truth = v => v == null ? null : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : isDate(v) ? true : String(v).trim() !== '';
const toNum = v => typeof v === 'number' ? v : looksNumber(v) ? Number(v) : null;

/**
 * A parsed rule evaluated on one row: true, false, or null when it cannot be
 * decided (an operand is empty). `columns` types the cells (dates, numbers)
 * and supplies missing codes; without them, a cell that reads as a number or
 * an ISO date is taken as one.
 */
export function evaluate(ast, row, columns = null) {
  const ev = n => {
    switch (n.type) {
      case 'lit': return n.value;
      case 'ref': return cell(row, n.name, columns);
      case 'neg': { const v = toNum(ev(n.arg)); return v == null ? null : -v; }
      case 'arith': {
        let a = ev(n.left), b = ev(n.right);
        if (a == null || b == null) return null;
        [a, b] = coerce(a, b);
        if (isDate(a) && isDate(b)) return n.op === '-' ? (a.date - b.date) / DAY : null;
        if (isDate(a) && (n.op === '+' || n.op === '-')) { const d = toNum(b); return d == null ? null : D(a.date + (n.op === '+' ? d : -d) * DAY); }
        if (isDate(b) && n.op === '+') { const d = toNum(a); return d == null ? null : D(b.date + d * DAY); }
        const x = toNum(a), y = toNum(b);
        if (x == null || y == null) return null;
        if (n.op === '/') return y === 0 ? null : x / y;
        return n.op === '+' ? x + y : n.op === '-' ? x - y : x * y;
      }
      case 'cmp': return compare(n.op, ev(n.left), ev(n.right));
      case 'empty': { const v = ev(n.arg); return v == null || (typeof v === 'string' && v.trim() === ''); }
      case 'between': {
        const v = ev(n.arg), lo = compare('>=', v, ev(n.lo)), hi = compare('<=', v, ev(n.hi));
        return lo == null || hi == null ? null : lo && hi;
      }
      case 'in': {
        const v = ev(n.arg);
        if (v == null) return null;
        return n.items.some(it => compare('==', v, ev(it)) === true);
      }
      case 'not': { const v = truth(ev(n.arg)); return v == null ? null : !v; }
      case 'and': {
        const a = truth(ev(n.left)); if (a === false) return false;
        const b = truth(ev(n.right)); if (b === false) return false;
        return a == null || b == null ? null : true;
      }
      case 'or': {
        const a = truth(ev(n.left)); if (a === true) return true;
        const b = truth(ev(n.right)); if (b === true) return true;
        return a == null || b == null ? null : false;
      }
      case 'if': {
        const c = truth(ev(n.cond));
        if (c === true) return truth(ev(n.then));
        if (c === false) return n.else ? truth(ev(n.else)) : true;
        // unknown condition: passes unless both branches fail
        const t = truth(ev(n.then)), e = n.else ? truth(ev(n.else)) : true;
        return t === true && e === true ? true : t === false && e === false ? false : null;
      }
      case 'call': {
        const args = n.args.map(ev);
        switch (n.name) {
          case 'days': {
            const [a, b] = args.map(v => isDate(v) ? v : typeof v === 'string' && parseDate(v) != null ? D(parseDate(v)) : null);
            return a && b ? (b.date - a.date) / DAY : null;
          }
          case 'abs': { const v = toNum(args[0]); return v == null ? null : Math.abs(v); }
          case 'year': case 'month': {
            const v = isDate(args[0]) ? args[0].date : typeof args[0] === 'string' ? parseDate(args[0]) : null;
            if (v == null) return null;
            return n.name === 'year' ? new Date(v).getUTCFullYear() : new Date(v).getUTCMonth() + 1;
          }
          case 'length': return args[0] == null ? 0 : String(isDate(args[0]) ? formatDate(args[0].date) : args[0]).length;
          case 'date': { const v = typeof args[0] === 'string' ? parseDate(args[0]) : null; return v == null ? null : D(v); }
          case 'coalesce': return args.find(v => v != null && !(typeof v === 'string' && v.trim() === '')) ?? null;
          case 'min': case 'max': {
            const xs = args.map(v => isDate(v) ? v.date : toNum(v));
            if (xs.some(x => x == null)) return null;
            const r = Math[n.name](...xs);
            return args.some(isDate) ? D(r) : r;
          }
        }
        return null;
      }
    }
    return null;
  };
  return truth(ev(ast));
}

/**
 * Cross-field checks on every row. `rules` are texts or
 * { id, text, message }; a rule that does not parse, or names a column the
 * dataset lacks, is one issue with row null and kind 'rule-error'. A row where
 * a rule is false gives kind 'rule'; undecided rows pass.
 */
export function checkRules(dataset, rules) {
  const issues = [], columns = dataset?.columns || [];
  (rules || []).forEach((r, n) => {
    const rule = typeof r === 'string' ? { text: r } : r || {};
    if (rule.off) return;
    const id = rule.id || `rule${n + 1}`, text = String(rule.text || '');
    const parsed = parseRule(text);
    if (parsed.error) { issues.push({ row: null, rowId: null, column: null, rule: id, kind: 'rule-error', value: text, message: `${parsed.error} (at ${parsed.pos + 1})`, pos: parsed.pos, severity: 'error' }); return; }
    const unknown = ruleColumns(parsed.ast).filter(c => !findColumn(columns, c));
    if (unknown.length) { issues.push({ row: null, rowId: null, column: null, rule: id, kind: 'rule-error', value: text, message: `No column named ${unknown.join(', ')}`, severity: 'error' }); return; }
    const cols = ruleColumns(parsed.ast).map(c => findColumn(columns, c).id);
    (dataset.rows || []).forEach((row, i) => {
      if (evaluate(parsed.ast, row, columns) === false)
        issues.push({ row: i, rowId: rowIdOf(dataset, i), column: cols[0] || null, columns: cols, rule: id, kind: 'rule', value: text, message: rule.message || `Fails: ${text}`, severity: rule.severity || 'error' });
    });
  });
  return issues;
}

/** Constraint and cross-field issues together; the rules are `dataset.rules` unless given. */
export const checkAll = (dataset, rules = dataset?.rules) => [...checkDataset(dataset), ...checkRules(dataset, rules || [])];

// ---- change log, locks and verification ------------------------------------------

const now = at => at || new Date().toISOString();
const logOf = state => (state.dataChangeLog ||= []);
const sameRow = (a, b) => String(a) === String(b);
function append(state, entry) {
  const log = logOf(state);
  const e = { id: `chg${log.length + 1}`, ...entry };
  log.push(e);
  return e;
}

/** Whether a row is locked: { by, at } or null. */
const own = (o, k) => o && Object.hasOwn(o, String(k)) ? o[String(k)] : null;
export const isLocked = (state, datasetId, rowId) => own(own(state?.dataLocks, datasetId), rowId);
/** Whether a row's source data have been verified: { by, at } or null. A later change clears it. */
export const isVerified = (state, datasetId, rowId) => own(own(state?.dataVerification, datasetId), rowId);

/**
 * Records one value change in state.dataChangeLog (mutating `state`). A change
 * to a locked row is refused; with `requireReason` (or
 * state.dataSettings.requireReason) a change without a reason is refused. A
 * change clears the row's source-data verification.
 * Returns { ok: true, entry } or { ok: false, error }.
 */
export function recordChange(state, { datasetId, row, column, from = '', to = '', reason = '', by = '', at } = {}, { requireReason = state?.dataSettings?.requireReason ?? false } = {}) {
  if (!datasetId || row == null || !column) return { ok: false, error: 'A change names its dataset, row and column' };
  if (isLocked(state, datasetId, row)) return { ok: false, error: `Row ${row} is locked` };
  const why = String(reason || '').trim();
  if (requireReason && !why) return { ok: false, error: 'A reason for the change is required' };
  if (String(from ?? '') === String(to ?? '')) return { ok: false, error: 'The value is unchanged' };
  const entry = append(state, { action: 'change', datasetId, row, column, from: String(from ?? ''), to: String(to ?? ''), reason: why, by, at: now(at) });
  const v = state.dataVerification?.[datasetId];
  if (own(v, row)) { delete v[String(row)]; entry.clearedVerification = true; }
  return { ok: true, entry };
}

/**
 * Sets a cell of a dataset held in state.datasets and records the change.
 * `rowIndex` is the position; the log keeps the row's identifier (rowIdOf).
 */
export function editCell(state, datasetId, rowIndex, column, to, meta = {}, options) {
  const d = (state.datasets || []).find(x => x.id === datasetId);
  if (!d || !d.rows[rowIndex] || !d.columns.some(c => c.id === column)) return { ok: false, error: 'No such cell' };
  const from = d.rows[rowIndex][column] ?? '';
  const r = recordChange(state, { ...meta, datasetId, row: rowIdOf(d, rowIndex), column, from, to }, options);
  if (r.ok) d.rows[rowIndex][column] = String(to ?? '').trim();
  return r;
}

/** Locks rows against change; logged. Returns the ids newly locked. */
export function lockRows(state, datasetId, rowIds, { by = '', at } = {}) {
  const locks = ((state.dataLocks ||= {})[datasetId] ||= {});
  const done = [];
  for (const id of rowIds || []) {
    if (own(locks, id)) continue;
    locks[String(id)] = { by, at: now(at) };
    append(state, { action: 'lock', datasetId, row: id, by, at: now(at) });
    done.push(id);
  }
  return done;
}

/** Unlocks rows; a reason is required and logged. */
export function unlockRows(state, datasetId, rowIds, { by = '', at, reason = '' } = {}) {
  if (!String(reason).trim()) return { ok: false, error: 'A reason for unlocking is required' };
  const locks = state.dataLocks?.[datasetId] || {}, done = [];
  for (const id of rowIds || []) {
    if (!own(locks, id)) continue;
    delete locks[String(id)];
    append(state, { action: 'unlock', datasetId, row: id, reason: String(reason).trim(), by, at: now(at) });
    done.push(id);
  }
  return { ok: true, unlocked: done };
}

/** Marks a row's source data as verified by `by`; logged. */
export function verifyRow(state, datasetId, rowId, by = '', at) {
  const when = now(at);
  ((state.dataVerification ||= {})[datasetId] ||= {})[String(rowId)] = { by, at: when };
  return append(state, { action: 'verify', datasetId, row: rowId, by, at: when });
}

/** The log for a dataset, or for one row of it, oldest first. */
export const changesFor = (state, datasetId, row = null) =>
  (state?.dataChangeLog || []).filter(e => e.datasetId === datasetId && (row == null || sameRow(e.row, row)));

/** Counts for a dataset's data-management state. */
export function managementSummary(state, dataset) {
  const ids = (dataset.rows || []).map((_, i) => String(rowIdOf(dataset, i)));
  return {
    rows: ids.length,
    locked: ids.filter(id => isLocked(state, dataset.id, id)).length,
    verified: ids.filter(id => isVerified(state, dataset.id, id)).length,
    changes: changesFor(state, dataset.id).filter(e => e.action === 'change').length,
  };
}
