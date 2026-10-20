// Cell rules: a review team's wording rules for the cells of an extraction
// table, checked by the app (plan G5, amendment of 2026-09-28).
//
// Rules live on the template (`template.rules`; the built-in table keeps them
// in `state.extractionRules`):
//   { qualifiers: ['(whole cohort)'],          annotations the table notes define
//     general: [rule],                         every text column, unless `except`
//     columns: { [columnId]: [rule] } }
// A rule is { id, kind, message, ...parameters, scope?, off?, nr?, source? }.
// `message` is what a reviewer reads ("Use one of the six design labels").
// A `note` rule is never checked; it keeps a rule that cannot be tested
// mechanically next to the ones that can.
//
// Checks are pure and key-agnostic: a value stored under `${paper}:${column}`
// or under an arm key `${paper}:${column}@arm2` is checked against the rules of
// its base column. A cell that holds several arms as "Arm 1: …\nArm 2: …" is
// checked line by line, without the arm prefix.
import { CELLS_FIX, fence } from './prompts.mjs';

import { crossCheck } from './numeric-gate.mjs';

export const KINDS = [
  ['allowed', 'Allowed values'],
  ['pattern', 'Pattern'],
  ['forbidden', 'Forbidden phrases'],
  ['max-words', 'Word limit'],
  ['number', 'Number format'],
  ['capital', 'Capital first letter'],
  ['parentheses', 'Parentheses'],
  ['terms', 'Standard terms'],
  ['standard-phrase', 'One phrase per meaning'],
  ['spelling', 'One spelling per name'],
  ['unique', 'Unique per study'],
  ['range', 'Range'],
  ['consistent', 'Counts agree within a study'],
  ['note', 'Note'],
];
export const kindLabel = k => KINDS.find(x => x[0] === k)?.[1] || k;
export const SCOPES = [['cell', 'Whole cell'], ['line', 'Each line'], ['item', 'Each item']];

// Where a kind looks unless the rule says otherwise.
const DEFAULT_SCOPE = { allowed: 'line', pattern: 'line', forbidden: 'cell', 'max-words': 'line', number: 'line',
  capital: 'line', parentheses: 'cell', terms: 'item', 'standard-phrase': 'item', spelling: 'cell', unique: 'cell', note: 'cell', range: 'cell', consistent: 'cell' };
// Kinds that compare a cell with the other rows of its column.
const CROSS_ROW = new Set(['standard-phrase', 'spelling', 'unique']);

export const EMPTY_RULES = () => ({ qualifiers: [], general: [], columns: {} });

/**
 * The rules of a template, normalised; `null` when it has none. The built-in
 * table adds the checks its own fields state (fieldRules): they are marked
 * `field` and edited with the field, not in the rule editor.
 */
export function rulesOf(template, state = null) {
  const r = template?.id === 'default' ? state?.extractionRules : template?.rules;
  const own = template?.id === 'default' ? fieldRules(state?.customFields) : null;
  if (!r && !own) return null;
  const columns = { ...(r?.columns || {}) };
  for (const [id, list] of Object.entries(own || {})) columns[id] = [...list, ...(columns[id] || [])];
  return { qualifiers: [...(r?.qualifiers || [])], general: [...(r?.general || [])], columns };
}

/** Rules as a person keeps them: without the ones a field's definition states. */
export const withoutFieldRules = rules => ({ ...rules, columns: Object.fromEntries(Object.entries(rules.columns || {})
  .map(([id, list]) => [id, (list || []).filter(r => !r.field)]).filter(([, list]) => list.length)) });

const fmt = n => String(n);
/**
 * The checks a review's own fields state (plan G1): a number's range (and a
 * whole number for an integer field), a category's levels, a text field's
 * allowed values and pattern. "NR" passes: not reported is a value, not a
 * breach. Keyed by field id; `null` when no field states any.
 */
export function fieldRules(customFields) {
  const out = {};
  for (const f of customFields || []) {
    const list = [], unit = f.unit ? ` ${f.unit}` : '', id = kind => `f:${f.id}:${kind}`;
    const numeric = f.type === 'number' || f.type === 'integer';
    if (numeric && (Number.isFinite(f.min) || Number.isFinite(f.max) || f.type === 'integer')) {
      const lo = Number.isFinite(f.min) ? f.min : null, hi = Number.isFinite(f.max) ? f.max : null;
      const message = lo != null && hi != null ? `Between ${fmt(lo)} and ${fmt(hi)}${unit}` : lo != null ? `At least ${fmt(lo)}${unit}` : hi != null ? `At most ${fmt(hi)}${unit}` : 'A whole number';
      list.push({ id: id('range'), kind: 'range', message, min: lo, max: hi, integer: f.type === 'integer', nr: true, field: true });
    }
    if (f.type === 'category' && f.options?.length) list.push({ id: id('allowed'), kind: 'allowed', message: `One of the levels of ${f.label}`, values: [...f.options], nr: true, scope: 'cell', field: true });
    if (f.type === 'text' && f.allowed?.length) list.push({ id: id('allowed'), kind: 'allowed', message: `One of the allowed values of ${f.label}`, values: [...f.allowed], nr: true, scope: 'cell', field: true });
    if (f.type === 'text' && f.pattern && validPattern(f.pattern)) list.push({ id: id('pattern'), kind: 'pattern', message: `Matches the ${f.label} pattern`, pattern: f.pattern, nr: true, scope: 'cell', field: true });
    if (list.length) out[f.id] = list;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The required cells with no value: [{ key, paperId, columnId }] for each
 * study and each required field (a value marked not reported counts as
 * given). `values` is state.values.
 */
export function requiredMissing(values, papers, columns) {
  const out = [];
  for (const c of columns || []) if (c.required) for (const p of papers || []) {
    const key = `${p.id}:${c.id}`, v = values?.[key];
    if (!v || (v.availability !== 'not_found' && String(v.reported_value ?? '').trim() === '')) out.push({ key, paperId: p.id, columnId: c.id });
  }
  return out;
}
export const REQUIRED_RULE = { id: 'f:required', kind: 'required', message: 'Required', field: true };
/** Rules that can be checked (not notes, not switched off). */
export const active = list => (list || []).filter(r => r && r.kind !== 'note' && !r.off);
export const countRules = rules => !rules ? 0 : active(rules.general).length + Object.values(rules.columns || {}).reduce((n, l) => n + active(l).length, 0);
export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- keys -----------------------------------------------------------------------

/** A value key's parts: `paper:column` or `paper:column@armN`. */
export function parseCellKey(key) {
  const k = String(key), at = k.indexOf(':');
  if (at < 0) return null;
  const rest = k.slice(at + 1), arm = rest.indexOf('@');
  return { paperId: k.slice(0, at), columnId: arm < 0 ? rest : rest.slice(0, arm), arm: arm < 0 ? '' : rest.slice(arm + 1) };
}

// ---- text helpers ---------------------------------------------------------------

const ARM = /^(?:Arm \d+|NA):\s*/;
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = s => String(s).trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const bounded = s => `(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`;
const isNR = s => /^(NR|NA|not measured|not reported)$/i.test(String(s).trim());

/** The value with the table's own annotations removed ("64 (whole cohort)" → "64"). */
export function stripQualifiers(text, qualifiers = []) {
  let t = String(text ?? '');
  for (const q of qualifiers) if (q) t = t.split(q).join('');
  return t.replace(/[ \t]+(\n|$)/g, '$1').replace(/ {2,}/g, ' ').trim();
}

/** The parts a rule looks at: the whole cell, each line, or each "; " item. */
export function segments(text, scope = 'cell') {
  const t = String(text ?? '').trim();
  if (!t) return [];
  if (scope === 'cell') return [t];
  const lines = t.split(/\n+/).map(l => l.replace(ARM, '').trim()).filter(Boolean);
  if (scope === 'line') return lines;
  return lines.flatMap(l => l.split(/;\s+/)).map(x => x.trim()).filter(Boolean);
}

/** The label of an item: its leading words before a number, a mark or "NR" ("Screw loosening 3/68" → "Screw loosening"). */
export function itemLabel(item) {
  const out = [];
  for (const w of String(item).trim().split(/\s+/)) {
    if (!/^[\p{L}][\p{L}–\-]*$/u.test(w) || /^(NR|NA|in|at|up|to|of|least|not)$/.test(w)) break;
    out.push(w);
  }
  return out.join(' ');
}

let reCache = new Map();
function regex(source, flags = 'u') {
  const k = `${flags}/${source}`;
  if (!reCache.has(k)) {
    if (reCache.size > 500) reCache = new Map();
    let re = null;
    try { re = new RegExp(source, flags.includes('u') ? flags : `${flags}u`); } catch { re = null; }
    reCache.set(k, re);
  }
  return reCache.get(k);
}
/** Whether a pattern compiles; the editor refuses one that does not. */
export const validPattern = (source, flags = '') => !!regex(source, flags);

/**
 * A forbidden-phrases rule's phrases compiled once (each phrase bounded by non-letters, escaped unless it is a pattern), kept with the rule's
 * phrase list: the table check runs every phrase over every cell, and building each pattern's source there was most of its time (8 ms of a
 * 40 ms switch into Extraction on a 48-study table, 2026-10-19).
 */
const compiled = new WeakMap();
function forbiddenOf(r) {
  const list = r.phrases || [], flags = r.caseSensitive ? 'u' : 'iu';
  const hit = compiled.get(list);
  if (hit && hit.flags === flags) return hit.out;
  const out = [];
  for (const p of list) {
    const text = typeof p === 'string' ? p : p.text;
    if (!text) continue;
    const re = regex(p.regex ? bounded(text) : bounded(escapeRe(text)), flags);
    if (re) out.push({ re, hint: p.replacement ? `Use “${p.replacement}”` : '' });
  }
  compiled.set(list, { flags, out });
  return out;
}

// ---- single-value checks -----------------------------------------------------------

const decimalsOf = n => (String(n).split('.')[1] || '').length;

// Each returns a list of findings ({ found?, hint? }) for one segment.
const CHECKS = {
  allowed(seg, r) {
    if (r.nr && isNR(seg)) return [];
    const ci = !!r.caseInsensitive;
    const hit = (r.values || []).some(v => ci ? fold(v) === fold(seg) : String(v).trim() === seg);
    return hit ? [] : [{ found: seg }];
  },
  pattern(seg, r) {
    if (r.nr && isNR(seg)) return [];
    const re = regex(r.pattern, r.flags || '');
    return !re || re.test(seg) ? [] : [{ found: seg }];
  },
  forbidden(seg, r) {
    const out = [];
    for (const { re, hint } of forbiddenOf(r)) { const m = re.exec(seg); if (m) out.push({ found: m[0], hint }); }
    return out;
  },
  'max-words'(seg, r) {
    const n = words(seg).length;
    return n > (r.max || Infinity) ? [{ found: `${n} words`, hint: `At most ${r.max}` }] : [];
  },
  number(seg, r) {
    const out = [];
    if (r.percent === 'whole') {
      for (const m of seg.matchAll(/(\d+\.\d+)\s*%/g)) out.push({ found: `${m[1]}%`, hint: `Use ${Math.round(Number(m[1]))}%` });
    }
    if (r.after && r.decimals != null) {
      const label = regex(`^${escapeRe(r.after)}(?![\\p{L}])`, 'u');
      for (const item of seg.split(/;\s+/)) {
        if (!label.test(item.trim())) continue;
        for (const m of item.matchAll(/(?<![\d./])\d+(?:\.\d+)?(?![\d/])/g))
          if (decimalsOf(m[0]) !== r.decimals) out.push({ found: `${r.after} ${m[0]}`, hint: `${r.decimals} decimal${r.decimals === 1 ? '' : 's'}` });
      }
    }
    if (r.counts) {
      for (const m of seg.matchAll(/(?<![\d.])(\d+)\/(\d+)(?![\d.])(?:\s*\(([≥≤]?)(\d+(?:\.\d+)?)%\))?/g)) {
        const n = Number(m[1]), N = Number(m[2]);
        if (N > 0 && n > N) { out.push({ found: m[0], hint: 'n is larger than N' }); continue; }
        if (m[4] != null && N > 0) {
          const d = decimalsOf(m[4]), want = Math.round(n / N * 100 * 10 ** d) / 10 ** d;
          if (Math.abs(Number(m[4]) - want) > 1e-9) out.push({ found: m[0], hint: `${n}/${N} is ${want.toFixed(d)}%` });
        } else if (m[4] == null && r.percent === 'nonzero' && n > 0) out.push({ found: m[0], hint: 'Add the percentage' });
      }
    }
    return out;
  },
  capital(seg, r) {
    const first = /[\p{L}\p{N}]/u.exec(seg);
    if (!first || !/\p{Ll}/u.test(first[0]) || first.index > 1) return [];
    const word = seg.slice(first.index).split(/[\s;,]/)[0];
    if ((r.except || []).some(x => x === word)) return [];
    return [{ found: word }];
  },
  parentheses(seg, r) {
    const allow = (r.allow || []).map(a => regex(`^(?:${a})$`, 'u')).filter(Boolean);
    const out = [];
    for (const m of seg.matchAll(/\([^()]*\)/g)) if (!allow.some(re => re.test(m[0]))) out.push({ found: m[0] });
    return out;
  },
  range(seg, r) {
    if (r.nr && isNR(seg)) return [];
    const t = seg.replace(/\u2212/g, '-').replace(/[\s\u202f]/g, '');
    const plain = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : /^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t;
    const n = /^-?(\d+\.?\d*|\.\d+)$/.test(plain) ? Number(plain) : NaN;
    if (!Number.isFinite(n)) return [{ found: seg, hint: 'Not a number' }];
    if (r.integer && !Number.isInteger(n)) return [{ found: seg, hint: r.min != null || r.max != null ? 'A whole number' : '' }];
    if (r.min != null && n < r.min) return [{ found: seg, hint: `Below ${r.min}` }];
    if (r.max != null && n > r.max) return [{ found: seg, hint: `Above ${r.max}` }];
    return [];
  },
  terms(seg, r) {
    if (isNR(seg)) return [];
    const label = itemLabel(seg);
    if (!label) return [];
    const known = (r.terms || []).map(fold);
    return known.includes(fold(label)) ? [] : [{ found: label }];
  },
};

function ruleFindings(text, rule, qualifiers) {
  const check = CHECKS[rule.kind];
  if (!check) return [];
  const t = rule.kind === 'parentheses' ? String(text ?? '') : stripQualifiers(text, qualifiers);
  const allow = rule.kind === 'parentheses' ? [...(rule.allow || []), ...qualifiers.filter(q => /^\(.*\)$/.test(q)).map(escapeRe)] : null;
  const r = allow ? { ...rule, allow } : rule;
  return segments(t, rule.scope || DEFAULT_SCOPE[rule.kind]).flatMap(seg => check(seg, r));
}

const applies = (rule, column) => !(rule.except || []).includes(column.id) && (!column.type || column.type === 'text');

/** The rules that bear on one column: its own, then the general ones. */
export function rulesFor(rules, column) {
  if (!rules || !column) return [];
  return [...(rules.columns?.[column.id] || []), ...(rules.general || []).filter(r => applies(r, column))];
}

/** One value against the rules of its column (single-value kinds only). */
export function checkValue(text, rules, column) {
  if (text == null || String(text).trim() === '' || !rules) return [];
  const out = [];
  for (const rule of active(rulesFor(rules, column))) {
    if (CROSS_ROW.has(rule.kind)) continue;
    for (const f of ruleFindings(text, rule, rules.qualifiers || [])) out.push({ rule, message: rule.message || kindLabel(rule.kind), ...f });
  }
  return dedupe(out);
}
const dedupe = list => {
  const seen = new Set();
  return list.filter(x => { const k = `${x.rule.id}|${x.found || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

// ---- the whole table ------------------------------------------------------------

const valueText = v => v == null ? '' : typeof v === 'object' ? (v.availability === 'not_found' ? 'NR' : v.reported_value ?? v.value ?? '') : v;

/**
 * Every value of a template checked against its rules.
 * `values` maps cell keys to value records (state.values). Returns
 *   cells:  Map key → [{ rule, message, found, hint }]
 *   rules:  Map rule id → { rule, column, cells }
 *   papers: Set of paper ids with a broken rule
 */
export function checkTable(values, template, rules) {
  const cells = new Map(), byRule = new Map(), papers = new Set();
  if (!template || !rules || !countRules(rules)) return { cells, rules: byRule, papers, count: 0 };
  const columns = new Map((template.columns || []).map(c => [c.id, c]));
  const add = (key, paperId, column, finding) => {
    if (!cells.has(key)) cells.set(key, []);
    const list = cells.get(key);
    if (list.some(x => x.rule.id === finding.rule.id && x.found === finding.found)) return;
    list.push(finding); papers.add(paperId);
    const e = byRule.get(finding.rule.id) || { rule: finding.rule, column: rules.general?.includes(finding.rule) ? null : column, cells: new Set() };
    e.cells.add(key); byRule.set(finding.rule.id, e);
  };
  const perColumn = new Map();   // column id → [{ key, paperId, text }]
  for (const [key, v] of Object.entries(values || {})) {
    const k = parseCellKey(key); const column = k && columns.get(k.columnId);
    if (!column) continue;
    const text = String(valueText(v) ?? '');
    if (!text.trim()) continue;
    if (!perColumn.has(column.id)) perColumn.set(column.id, []);
    perColumn.get(column.id).push({ key, paperId: k.paperId, text });
    for (const f of checkValue(text, rules, column)) add(key, k.paperId, column, f);
  }
  for (const [id, rows] of perColumn) {
    const column = columns.get(id);
    for (const rule of active(rulesFor(rules, column)).filter(r => CROSS_ROW.has(r.kind)))
      for (const [key, finding] of crossRow(rows, rule, rules.qualifiers || [])) add(key, rows.find(r => r.key === key).paperId, column, { rule, message: rule.message || kindLabel(rule.kind), ...finding });
  }
  // A 'consistent' rule compares the cells of one study with each other
  // (numeric-gate.mjs crossCheck): counts against denominators, percentages
  // against counts, denominators against the arms' sizes.
  const study = active(rules.general).filter(r => r.kind === 'consistent');
  if (study.length) {
    const byPaper = new Map();
    for (const [key, v] of Object.entries(values || {})) {
      const k = parseCellKey(key); if (!k || !columns.has(k.columnId)) continue;
      if (!byPaper.has(k.paperId)) byPaper.set(k.paperId, {});
      byPaper.get(k.paperId)[k.arm ? `${k.columnId}@${k.arm}` : k.columnId] = valueText(v);
    }
    for (const [paperId, vals] of byPaper) for (const f of crossCheck({ values: vals, columns: template.columns }))
      for (const rule of study) add(`${paperId}:${f.cell}`, paperId, columns.get(parseCellKey(`${paperId}:${f.cell}`).columnId), { rule, message: rule.message || kindLabel(rule.kind), found: f.message, hint: f.severity === 'block' ? 'Impossible as written' : '' });
  }
  for (const e of byRule.values()) e.count = e.cells.size;
  return { cells, rules: byRule, papers, count: cells.size };
}

function crossRow(rows, rule, qualifiers) {
  const out = [];
  const scope = rule.scope || DEFAULT_SCOPE[rule.kind];
  if (rule.kind === 'unique') {
    // several arm keys of one study hold the same label legitimately
    const by = new Map();
    for (const r of rows) { const t = stripQualifiers(r.text, qualifiers); if (!by.has(t)) by.set(t, new Map()); by.get(t).set(r.paperId, r.key); }
    for (const [t, owners] of by) if (owners.size > 1) for (const key of owners.values()) out.push([key, { found: t, hint: `${owners.size} studies` }]);
  } else if (rule.kind === 'spelling') {
    // words that differ only by accents: the less used spelling is flagged
    const forms = new Map();   // folded → Map(lower form → Set(keys))
    for (const r of rows) for (const w of stripQualifiers(r.text, qualifiers).normalize('NFC').match(/[\p{L}\p{M}]{3,}/gu) || []) {
      const f = fold(w), lower = w.toLowerCase();
      if (!forms.has(f)) forms.set(f, new Map());
      const m = forms.get(f); if (!m.has(lower)) m.set(lower, { word: w, keys: new Set() });
      m.get(lower).keys.add(r.key);
    }
    for (const m of forms.values()) {
      if (m.size < 2) continue;
      const ranked = [...m.values()].sort((a, b) => b.keys.size - a.keys.size);
      const top = ranked[0].keys.size, tie = ranked.filter(x => x.keys.size === top).length > 1;
      for (const x of ranked) if (tie || x.keys.size < top) {
        const other = ranked.find(y => y !== x).word;
        for (const key of x.keys) out.push([key, { found: x.word, hint: `Also spelled “${other}”` }]);
      }
    }
  } else if (rule.kind === 'standard-phrase') {
    // an item label used by one study only, in a column where labels repeat
    const uses = new Map();   // folded label → { label, papers:Set, keys:Set }
    for (const r of rows) for (const seg of segments(stripQualifiers(r.text, qualifiers), scope)) {
      const label = itemLabel(seg); if (!label) continue;
      const f = fold(label);
      if (!uses.has(f)) uses.set(f, { label, papers: new Set(), keys: new Set() });
      uses.get(f).papers.add(r.paperId); uses.get(f).keys.add(r.key);
    }
    const min = rule.minRows || 2;
    const papers = new Set(rows.map(r => r.paperId)).size;
    if (papers >= (rule.minStudies || 10))
      for (const u of uses.values()) if (u.papers.size < min && !(rule.allow || []).map(fold).includes(fold(u.label)))
        for (const key of u.keys) out.push([key, { found: u.label, hint: 'Used by one study only' }]);
  }
  return out;
}

/** "12 cells break 4 rules", or '' when nothing is broken. */
export function summaryText(result) {
  if (!result?.count) return '';
  const n = result.count, r = result.rules.size;
  return `${n} ${n === 1 ? 'cell breaks' : 'cells break'} ${r} ${r === 1 ? 'rule' : 'rules'}`;
}

// ---- suggest fixes ------------------------------------------------------------------

/** The request for rewording offending cells; the model returns [{ key, value }]. */
export function fixMessages(items, { conventions = [] } = {}) {
  const list = items.map(x => ({ key: x.key, column: x.column, value: x.value,
    broken: x.findings.map(f => [f.message, f.found ? `found “${f.found}”` : '', f.hint || ''].filter(Boolean).join('; ')),
    column_rules: x.rules.map(r => r.message).slice(0, 12) }));
  const notes = conventions.length ? `\nTable notes:\n${conventions.slice(0, 12).map(c => `- ${String(c).slice(0, 300)}`).join('\n')}` : '';
  return [
    { role: 'system', content: CELLS_FIX.text(notes) },
    { role: 'user', content: fence('cells', JSON.stringify(list)) },
  ];
}

/** The fixes of a reply: known keys, changed values only. */
export function parseFixes(reply, items) {
  let got = reply;
  if (typeof reply === 'string') {
    const body = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1] || reply;
    const a = body.indexOf('{'), b = body.lastIndexOf('}');
    try { got = JSON.parse(a >= 0 && b > a ? body.slice(a, b + 1) : body); } catch { got = null; }
  }
  const arr = Array.isArray(got) ? got : Array.isArray(got?.fixes) ? got.fixes : [];
  const byKey = new Map(items.map(x => [x.key, x]));
  return arr.filter(f => f && byKey.has(f.key) && typeof f.value === 'string' && f.value.trim() && f.value.trim() !== String(byKey.get(f.key).value).trim())
    .map(f => ({ key: f.key, value: f.value.trim().slice(0, 2000), why: String(f.why || '').slice(0, 160) }));
}

// ---- seeding from a folder guide (AGENTS.md) ---------------------------------------------

const bare = s => fold(String(s).replace(/\([^)]*\)/g, ' ')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const plain = s => String(s).replace(/`/g, '').replace(/\*\*/g, '').trim();

/** The section of a guide whose heading names cell rules, as lines. */
function section(md, heading) {
  const lines = String(md || '').split('\n');
  const start = lines.findIndex(l => /^#{1,4}\s/.test(l) && heading.test(l));
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start])[0].length;
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/** The column a rules-table row names, by label. */
export function matchColumn(name, columns) {
  const n = bare(name);
  if (!n) return null;
  const byBare = columns.map(c => ({ c, b: bare(c.label) }));
  return byBare.find(x => x.b === n)?.c
    || byBare.find(x => x.b.startsWith(`${n} `))?.c
    || byBare.find(x => x.b.split(' ').includes(n) && n.length > 3)?.c
    || null;
}

// A count placeholder: "x/N" is n/N, with its percentage when given, or NR.
const COUNT = '(?:\\d+/\\d+(?: \\([≥≤]?\\d+(?:\\.\\d+)?%\\))?|NR|not measured)';
// A form is a format when every number in it is a placeholder; "rods placed at 6 mo" is an example.
const isFormat = re => !/\d/.test(re.replace(/\\d(?:\{\d+(?:,\d*)?\})?/g, ''));
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numberWord = n => NUMBER_WORDS[n] || String(n);
// Placeholders in a quoted format, as the regex they stand for.
function formatRegex(q) {
  let s = escapeRe(q.replace(/\s+/g, ' ').trim());
  s = s.replace(/n=…/g, 'n=\\d+')
    .replace(/\b(\p{Lu}\p{Ll}{2,})\/(\p{Lu}\p{Ll}{2,})\b/gu, '(?:$1|$2)')
    .replace(/\bArm 1\b/g, 'Arm \\d+')
    .replace(/\b[xy]\/[Ny]\b/g, COUNT)
    .replace(/\bAuthor\b/g, '\\p{Lu}[\\p{L}\\p{M}\'’. -]*')
    .replace(/\byear\b/g, '\\d{4}[a-z]?')
    .replace(/\bcountry\b/g, '\\p{L}[\\p{L} ]*')
    .replace(/<[^>]+>/g, '.+?')
    .replace(/\b[XY]\b/g, '.+?')
    .replace(/…/g, '.+?');
  return s;
}
const quoted = s => [...String(s).matchAll(/"([^"]+)"/g)].map(m => m[1]);
/** Top-level parts of a rule text, split on `sep` outside quotes. */
function splitOutside(s, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    if (!q && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
const listed = s => s.split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);

/**
 * Rules for one column from the text of its row. Only what the text states
 * explicitly becomes a check; the rest of the text is kept as a note.
 */
export function rulesFromText(text, column, { note = '' } = {}) {
  const t = plain(text);
  const out = [];
  const add = (kind, message, extra = {}) => out.push({ id: `${column.id}~${kind}${out.filter(r => r.kind === kind).length || ''}`, kind, message, source: 'AGENTS.md', ...extra });

  // "Label only: A / B / C" or a text that is a " / " list of forms
  const labelOnly = /^Label only:\s*(.+)$/i.exec(t);
  const slashList = splitOutside(labelOnly ? labelOnly[1] : t, ' / ');
  if (labelOnly || (slashList.length >= 3 && slashList.every(x => x.length <= 60 && !/[.]$/.test(x)))) {
    const forms = slashList.map(x => x.replace(/^"|"$/g, ''));
    if (forms.some(f => /…|\b[xy]\/N\b|<[^>]+>/.test(f)))
      add('pattern', `Use one of the ${numberWord(forms.length)} standard forms`, { pattern: `^(?:${forms.map(formatRegex).join('|')})$`, nr: true });
    else add('allowed', `Use one of the ${numberWord(forms.length)} ${bare(column.label).split(' ').pop() === 'design' ? 'design labels' : 'standard labels'}`, { values: forms, nr: true });
    return out;
  }

  const parts = splitOutside(t, ';').length > 1 && /\b[A-Z]{2,3} = /.test(t) ? splitOutside(t, ';') : null;
  // "NA = …; NR = …; "A/B form"; otherwise … "X for …; Y for all other patients""
  if (parts) {
    const forms = [];
    for (const p of parts) {
      const def = /^([A-Z]{2,3}) = /.exec(p);
      if (def) { forms.push(escapeRe(def[1])); continue; }
      for (const q of quoted(p)) forms.push(formatRegex(q));
    }
    if (forms.length >= 2) add('pattern', `Use ${parts.map(p => /^([A-Z]{2,3}) = /.exec(p)?.[1]).filter(Boolean).join(', ')} or one of the standard forms`, { pattern: `^(?:${forms.join('|')})$` });
  } else if (/^"[^"]+"/.test(t)) {
    // a cell format: "Author et al., year, country"; "Arm 1 (n=…)" …, or "NA (n=…)"
    const lead = t.split(/\.\s|\.$/)[0];
    const forms = quoted(lead).map(formatRegex);
    if (!forms.every(isFormat)) { /* examples, not formats: kept in the note */ }
    else if (/on line 2|second line/i.test(lead)) {
      const f = `(?:${forms.join('|')})`;
      add('pattern', `Write as ${quoted(lead).map(q => `“${q}”`).join(' or ')}`, { pattern: `^${f}(?:\\n(?!${f})[^\\n]+)?(?:\\n${f}(?:\\n(?!${f})[^\\n]+)?)*$`, scope: 'cell' });
    } else if (forms.length) add('pattern', `Write as ${quoted(lead).map(q => `“${q}”`).join(' or ')}`, { pattern: `^(?:${forms.join('|')})$` });
  }

  // Never "X" — with the canonical phrase when the sentence before is one
  const sentences = t.split(/(?<=\.)\s+/);
  sentences.forEach((s, i) => {
    for (const m of s.matchAll(/\b[Nn]ever\s+"([^"]+)"/g)) {
      const prev = sentences[i - 1] || '';
      const canonical = /^"([^"]+)"\.?$/.exec(prev.trim())?.[1] || '';
      add('forbidden', `Never “${m[1]}”`, { phrases: [{ text: m[1], ...(canonical ? { replacement: canonical } : {}) }] });
    }
  });
  // "No Cobb/SVA values, ages …": named measures and ages
  const no = /\bNo ([^.]+?)(?:\.|$)/.exec(t);
  if (no) {
    const names = no[1].replace(/\b(values?|lists?)\b/g, '').split(/[\/,]|\bor\b/).map(x => x.trim()).filter(Boolean);
    const measures = names.filter(n => /^[A-Z][A-Za-z–-]{1,10}$/.test(n) && n === n.toUpperCase() || /^[A-Z][a-z]+$/.test(n) && n.length <= 6);
    if (measures.length) add('forbidden', `No ${measures.join(' or ')} values`, { phrases: measures.map(text => ({ text })) });
    if (names.some(n => /^ages?$/i.test(n))) add('forbidden', 'No ages', { phrases: [{ text: '\\d+(?:\\.\\d+)?\\s*(?:[–-]\\s*\\d+\\s*)?(?:years?|y)(?:\\s+old)?', regex: true }] });
  }
  // "Mean as a bare number" (a minimum or a figure estimate keeps its mark)
  if (/\bbare number\b/i.test(t)) add('pattern', 'A bare number', { pattern: '^[≥≈]?\\d+(?:\\.\\d+)?$', nr: true });
  // word limits: "≤ 20 words", "at most 20 words"
  const max = /(?:≤|<=|at most|no more than)\s*(\d+)\s*words/i.exec(t);
  if (max) add('max-words', `At most ${max[1]} words`, { max: Number(max[1]) });
  // "% female as a whole number"
  if (/%[^.;]*whole number|whole[- ]number[^.;]*%/i.test(t)) add('number', 'Percentages as whole numbers', { percent: 'whole' });
  // "VAS to one decimal"
  for (const m of t.matchAll(/\b([A-Z][A-Za-z]{1,8}) to (one|two|\d) decimals?/g))
    add('number', `${m[1]} to ${m[2]} decimal${m[2] === 'one' || m[2] === '1' ? '' : 's'}`, { after: m[1], decimals: m[2] === 'one' ? 1 : m[2] === 'two' ? 2 : Number(m[2]), scope: 'line' });
  // counts "n/N (%)"
  if (/\bn\/N \(%\)/.test(t)) {
    add('number', 'Counts as n/N (%), with the percentage of n/N', { counts: true });
    add('standard-phrase', 'Use the phrase the other studies use', { minRows: 2, minStudies: 10 });
  }
  // "pre → final"
  if (/\bpre → final\b/.test(t)) add('pattern', 'Give values as pre → final', { pattern: '→|\\bNR$', scope: 'item', nr: true });
  // "only Cobb, SVA, PI–LL" → the item terms
  const only = /\bonly:?\s+([A-Z][^.;]+?)(?:\.|;|$)/.exec(t);
  if (only && listed(only[1]).length >= 2) add('terms', `Only ${listed(only[1]).join(', ')}`, { terms: listed(only[1]) });
  // "A, B, C, D only. `+` …; `NR` …; `NA` …" → each item "<factor> <mark>"
  const factors = /^([^.]+?) only\./.exec(t);
  const marks = [...String(text).matchAll(/`([^`]+)`/g)].map(m => m[1]);
  if (factors && marks.length >= 2) {
    const names = listed(factors[1]);
    add('pattern', `${names.join(', ')}, each ${marks.join(', ').replace(/, ([^,]*)$/, ' or $1')}`,
      { pattern: `^(?:(?:${names.map(escapeRe).join('|')}) (?:${marks.map(escapeRe).join('|')})(?:, |; |$))+$`, flags: 'i' });
  }
  // two cells may not share a label ("need a/b labels")
  if (/a\/b labels|must be unique|unique label/i.test(t)) add('unique', 'Same label as another study; add a or b');
  // what is left is kept, word for word, as a note
  const n = cap(plain(note) || t);
  add('note', n.length > 400 ? `${n.slice(0, 397)}…` : n);
  return out;
}

/**
 * Cell rules from a folder guide: the "Cell rules" section's general bullets
 * and its Column | Rule table, the Writing bullet's capital-letter rule, and
 * the annotations the template's own notes define. Returns null when the guide
 * has no such table.
 */
export function rulesFromGuide(md, template) {
  const lines = section(md, /cell rules/i);
  if (!lines || !template?.columns?.length) return null;
  const rows = lines.filter(l => /^\|/.test(l) && !/^\|\s*-/.test(l)).map(l => l.split('|').slice(1, -1).map(x => x.trim()));
  if (rows.length < 2 || !/column/i.test(rows[0][0])) return null;
  const columns = template.columns.filter(c => !c.type || c.type === 'text');
  const rules = EMPTY_RULES();
  const report = { matched: [], unmatched: [] };
  const put = (column, list) => { rules.columns[column.id] = [...(rules.columns[column.id] || []), ...list]; };
  for (const [name, text] of rows.slice(1)) {
    const column = matchColumn(name, columns);
    if (column) { put(column, rulesFromText(text, column)); report.matched.push(`${name} → ${column.label}`); continue; }
    // "Outcomes": sentences led by a column's first word ("Clinical: …", "ASD / PJK: …")
    let used = false;
    for (const s of plain(text).split(/(?<=\.)\s+(?=[A-Z])/)) {
      const lead = /^([A-Z][^:.]{1,30}?)(?::| as )/.exec(s)?.[1];
      const target = lead && columns.find(c => bare(c.label).startsWith(bare(lead)));
      if (target) { put(target, rulesFromText(s.replace(/^[^:]+:\s*/, ''), target, { note: s })); used = true; report.matched.push(`${name} (${lead}) → ${target.label}`); }
    }
    if (!used) report.unmatched.push(name);
  }

  // General bullets
  const general = lines.slice(0, lines.findIndex(l => /^\|/.test(l)) + 1 || lines.length)
    .filter(l => /^\s*[-*]\s+/.test(l)).map(l => plain(l.replace(/^\s*[-*]\s+/, '')));
  const g = (kind, message, extra = {}) => rules.general.push({ id: `general~${kind}${rules.general.filter(r => r.kind === kind).length || ''}`, kind, message, source: 'AGENTS.md', ...extra });
  for (const b of general) {
    if (/one standard phrase/i.test(b)) g('spelling', 'Spell a name the same way in every row');
    if (/between-arm comparison/i.test(b)) {
      const ex = /\("([^"]+)"\)/.exec(b)?.[1] || 'better than Arm 1';
      const tail = ex.replace(/^\S+\s+/, '').replace(/\d+$/, '');   // "than Arm "
      g('forbidden', 'No between-arm comparisons', { phrases: [{ text: `${escapeRe(tail.trim())}\\s*\\d+`, regex: true }, { text: 'compared with Arm\\s*\\d+', regex: true }, { text: 'versus Arm\\s*\\d+', regex: true }, { text: 'vs\\.? Arm\\s*\\d+', regex: true }] });
    }
    if (/informal or editorial/i.test(b))
      g('forbidden', 'No informal or editorial phrases', { phrases: INFORMAL.map(text => ({ text })), source: 'Lykos starter list' });
    if (/unnecessary parentheses/i.test(b)) g('parentheses', 'No parentheses beyond the table’s own', { allow: ['\\(n=\\d+\\)', '\\([≥≤]?\\d+(?:\\.\\d+)?%\\)'] });
    if (/^short, formal/i.test(b)) g('note', b);
  }
  // Writing: "start every label, value and heading with a capital letter"
  if (/start every (label|value)[^.\n]*capital letter/i.test(md)) g('capital', 'Start with a capital letter');

  // Annotations the table's notes define: "(whole cohort) = …", "(postoperative = …)"
  const notes = (template.conventions || []).join('\n');
  rules.qualifiers = [...new Set([...notes.matchAll(/(\([\p{L} ]{3,30}\)) = /gu)].map(m => m[1])
    .concat([...notes.matchAll(/\(([\p{L}]{3,30}) = /gu)].map(m => `(${m[1]})`)))];
  return { rules, report };
}

// The informal and editorial phrases a starter rule lists; the team edits it.
export const INFORMAL = ['interestingly', 'notably', 'surprisingly', 'remarkably', 'unfortunately', 'fortunately', 'obviously', 'clearly', 'of course', 'a lot', 'lots of', 'huge', 'really', 'pretty much', 'etc.', 'basically', 'amazing', 'impressive'];

/** A template with seeded rules, keeping any rule a person already has. */
export function withSeededRules(template, seeded) {
  if (!seeded) return template;
  if (template.rules && countRules(template.rules) + (template.rules.general || []).length) return template;
  return { ...template, rules: seeded.rules };
}

/** Human summary of rule parameters, for the editor's list. */
export function ruleDetail(r) {
  switch (r.kind) {
    case 'allowed': return (r.values || []).join(' · ');
    case 'pattern': return r.pattern || '';
    case 'forbidden': return (r.phrases || []).map(p => p.replacement ? `${p.text} → ${p.replacement}` : p.text).join(' · ');
    case 'max-words': return `${r.max} words`;
    case 'range': return [r.min != null ? `≥ ${r.min}` : '', r.max != null ? `≤ ${r.max}` : '', r.integer ? 'whole number' : ''].filter(Boolean).join(' · ');
    case 'number': return [r.percent === 'whole' ? 'Whole percentages' : '', r.after ? `${r.after}: ${r.decimals} decimal${r.decimals === 1 ? '' : 's'}` : '', r.counts ? 'n/N (%) agree' : ''].filter(Boolean).join(' · ');
    case 'parentheses': return (r.allow || []).join(' · ');
    case 'terms': return (r.terms || []).join(' · ');
    case 'note': return '';
    default: return '';
  }
}
