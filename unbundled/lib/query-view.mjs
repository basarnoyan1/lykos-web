// A database query drawn as its structure: ANY-OF boxes (terms joined by OR),
// set side by side with AND between them, nested as the query nests, with
// the field a group searches as its caption and proximity read in words.
// Reads PubMed (term[tiab]), Web of Science (TS=(…), NEAR/n) and Scopus
// (TITLE-ABS-KEY(…), W/n, PRE/n). The exact text stays one click away.
import { esc, plainText } from './html.mjs';
import { parseQuery, parseStrategy } from './query-syntax.mjs';

const FIELD_NAMES = { 'TITLE-ABS-KEY': 'Title, abstract, keywords', 'TITLE-ABS': 'Title, abstract', TITLE: 'Title', ABS: 'Abstract', KEY: 'Keywords',
  AUTHKEY: 'Author keywords', TS: 'Topic', TI: 'Title', AB: 'Abstract', AK: 'Author keywords', SU: 'Subject', PY: 'Year', PUBYEAR: 'Year',
  AU: 'Author', AUTH: 'Author', SO: 'Journal', SRCTITLE: 'Journal', DO: 'DOI', DOI: 'DOI', PMID: 'PubMed ID',
  AD: 'Affiliation', AFFIL: 'Affiliation', LA: 'Language', LANGUAGE: 'Language', DT: 'Document type', DOCTYPE: 'Document type',
  ad: 'Affiliation', tiab: 'Title, abstract', ti: 'Title', ab: 'Abstract', mh: 'MeSH', mesh: 'MeSH', tw: 'Text words', all: 'All fields',
  // 31 Oct 2026: Scopus index terms, Europe PMC's fields, Cochrane's and Ovid's suffixes (lib/query-syntax.mjs)
  INDEXTERMS: 'Index terms', SUBJAREA: 'Subject area', ABSTRACT: 'Abstract', KW: 'Keywords', PUB_TYPE: 'Publication type', SRC: 'Source', TITLE_ABS: 'Title, abstract',
  'ti,ab,kw': 'Title, abstract, keywords', 'ti,ab': 'Title, abstract', kw: 'Keywords', 'mesh terms': 'MeSH', majr: 'MeSH major topic', pt: 'Publication type', la: 'Language',
  'title/abstract': 'Title, abstract', 'mh:noexp': 'MeSH, not exploded', 'mesh:noexp': 'MeSH, not exploded', kf: 'Keyword heading words', mp: 'Multi-purpose fields',
  StudyType: 'Study type', InterventionSearch: 'Interventions', ConditionSearch: 'Conditions',
  // 6 Nov 2026: the rest of the Sham strategy's PubMed tags (lib/query-outline.mjs)
  'majr:noexp': 'MeSH major topic, not exploded', sh: 'Subheading', sb: 'Subset', dp: 'Publication date', uid: 'PubMed ID', pmid: 'PubMed ID' };
/** A field's name in words: tiab is "Title, abstract", TS is "Topic"; a field it does not know is said as written. */
export const fieldName = f => FIELD_NAMES[f] || FIELD_NAMES[String(f).toLowerCase()] || f;
const NATIVE_FIELDS = new Set(Object.keys(FIELD_NAMES).filter(f => f === f.toUpperCase()));
const nativeField = f => String(f).toUpperCase() === 'TOPIC' ? 'TS' : NATIVE_FIELDS.has(String(f).toUpperCase()) ? String(f).toUpperCase() : null;
const NATIVE_SYNTAX = new RegExp(`\\b(?:${[...NATIVE_FIELDS, 'Topic'].join('|')})\\s*[=(]`, 'i');

/** Recognises explicit query syntax; free text and file names remain ambiguous. */
export function hasQuerySyntax(src) {
  const text = String(src || '');
  return /\b(?:AND|OR|NOT)\b|\[[A-Za-z]|\b(?:W|PRE|NEAR)\/\d+\b|\bNEXT\b|\badj\d+\b|\):\s*(?:ti|ab|kw)\b|^\s*#\d+\s|\bAREA\[|\b[A-Z][A-Z_]{2,}:[("]/i.test(text) || NATIVE_SYNTAX.test(text);
}

/**
 * Parses a query into nodes: { term, field } or { op: 'AND'|'OR'|'NEAR', n?, kind?, field?, children, nots?, mixed? }, as the database
 * it was run in reads it (lib/query-syntax.mjs: its fields, proximity and order of operators; a numbered strategy as its final line
 * with each line it names in brackets). Null when the text is not a query that can be read with certainty: unbalanced, a field the
 * database does not know, a malformed proximity, or AND and OR mixed in a database whose help gives no order.
 */
export function queryTree(src, { source = '' } = {}) {
  const text = String(src || '');
  if (!text.trim()) return null;
  const strategy = parseStrategy(text, { source });
  const { tree, problems } = parseQuery(strategy.query, { dialect: strategy.dialect || 'pubmed' });
  if (!tree || strategy.problems.some(p => p.kind !== 'unused-line')) return null;
  if (problems.some(p => ['unknown-field', 'proximity-form', 'group-tag'].includes(p.kind))) return null;
  if (tree.ambiguous || hasAmbiguous(tree)) return null;
  return strip(tree);
}
const hasAmbiguous = n => n.term == null && (n.ambiguous || n.children.some(hasAmbiguous));
// the shape the drawing reads: the reader's own markers left out
function strip(n) {
  if (n.term != null) {
    const out = { term: n.term, field: n.field || null };
    if (n.proximity != null) out.proximity = n.proximity;
    return out;
  }
  const out = { op: n.op, ...(n.n != null ? { n: n.n } : {}), ...(n.kind ? { kind: n.kind } : {}), children: n.children.map(strip) };
  if (n.nots?.includes('NOT')) out.nots = n.nots;
  if (n.mixed) out.mixed = true;
  if (n.field) out.field = n.field;
  return out;
}

// Drawn as an outline a reviewer can scan: the field named once when the
// whole query searches one field, each list of alternatives on one line
// ("a · b · c"), nesting shown by indentation under "All of" / "Any of", and
// spelling variants folded for reading: rod, rods → rod(s); stabilization,
// stabilisation → stabili(z/s)ation; semirigid, semi-rigid → semi(-)rigid.
// Proximity reads "a within 2 (b, c)" and preserves ordered PRE operators.

/** Folds one list's variants into display labels (the query itself is untouched). */
export function foldVariants(terms) {
  const out = [], used = new Set();
  const pair = (a, b) => {
    if (b === a + 's' || b === a + 'es') return `${a}(${b.slice(a.length)})`;
    if (a.length === b.length) {
      const diff = [...a].map((c, i) => c !== b[i] ? i : -1).filter(i => i >= 0);
      if (diff.length === 1 && /[sz]/.test(a[diff[0]]) && /[sz]/.test(b[diff[0]])) { const i = diff[0]; return `${a.slice(0, i)}(${a[i]}/${b[i]})${a.slice(i + 1)}`; }
    }
    if (a.replace(/-/g, '') === b && a.includes('-')) return a.replace(/-/g, '(-)');
    if (b.replace(/-/g, '') === a && b.includes('-')) return b.replace(/-/g, '(-)');
    return null;
  };
  terms.forEach((t, i) => {
    if (used.has(i)) return;
    for (let j = i + 1; j < terms.length; j++) {
      if (used.has(j)) continue;
      const f = pair(terms[i], terms[j]) || pair(terms[j], terms[i]);
      if (f) { used.add(j); out.push({ label: f, n: 2 }); return; }
    }
    out.push({ label: t, n: 1 });
  });
  return out;
}

const fieldsOf = (n, inherited = '') => n.term != null ? [n.field || inherited] : n.children.flatMap(c => fieldsOf(c, n.field || inherited));
const isTerm = n => n.term != null;
// A list of plain terms, possibly under a shared field.
const isList = n => isTerm(n) || (n.op === 'OR' && n.children.every(isTerm));
// Fits on a line: a term, a list, or a proximity between those.
const isInline = n => isList(n) || (n.op === 'NEAR' && n.children.every(isList));
// The field a list's own terms share ("glioma[tiab] OR astrocytoma[tiab]").
const termField = n => { if (isTerm(n)) return n.field || null; if (!isList(n)) return null; const f = new Set(n.children.map(c => c.field || '')); return f.size === 1 ? [...f][0] || null : null; };

// Compact: every list shows its first `max` terms and "+n"; groups nest inline
// in light brackets joined by "and" / "or". Each top-level branch is one line.
// a term with no field: all fields
const bare = (n, inh, global) => !!global && !inh && !n.field && (isTerm(n) || (isList(n) && n.children.every(c => !c.field)));
function listHtml(n, max, brackets, global = '', inh = '') {
  // A term searched in another field than its list's is marked after it: Spinal Curvatures (MeSH).
  const shared = n.field || termField(n) || (bare(n, inh, global) ? 'all' : ''), kids = isTerm(n) ? [n] : n.children, byField = new Map();
  for (const child of kids) {
    const field = child.field || n.field || inh || (global ? 'all' : '');
    const key = JSON.stringify([field, child.proximity ?? null]);
    if (!byField.has(key)) byField.set(key, []);
    byField.get(key).push(child.term);
  }
  // Variants only share a label if they search the same field. A text-keyed
  // map loses the field when a folded label differs from either original.
  // A proximity shared by several terms of a list is said once, for the bracketed run of them, not after each term.
  const words = proximity => proximity === 0 ? 'adjacent, any order' : `within ${proximity} words, any order`;
  const items = [...byField].flatMap(([key, terms]) => {
    const [field, proximity] = JSON.parse(key), folded = foldVariants(terms);
    const scope = field && field !== global && field !== shared && field !== inh ? fieldName(field) : '';   // a field its group already named is not said again
    const once = proximity != null && folded.length > 1;
    const marked = folded.map(x => {
      const tag = [scope, proximity == null || once ? '' : words(proximity)].filter(Boolean).join(', ');
      return `<span class="qd-t">${esc(x.label)}${tag ? ` <span class="qd-f">(${esc(tag)})</span>` : ''}</span>`;
    });
    if (!once) return marked;
    const run = marked.length - max > 1 ? `${marked.slice(0, max).join(', ')} <span class="qd-n">+${marked.length - max}</span>` : marked.join(', ');
    return [`<span class="qd-b">(</span>${run}<span class="qd-b">)</span> <span class="qd-f">(each ${esc(words(proximity))})</span>`];
  });
  if (items.length === 1) return items[0];
  const cut = items.length - max > 1 ? max : items.length;
  const body = items.slice(0, cut).join(', ') + (items.length > cut ? ` <span class="qd-n">+${items.length - cut}</span>` : '');
  return brackets ? `<span class="qd-b">(</span>${body}<span class="qd-b">)</span>` : body;
}
const withField = (n, html, global, inh = '') => { const f = n.field || termField(n) || (bare(n, inh, global) ? 'all' : ''); return f && f !== global ? `<span class="qd-f">${esc(fieldName(f))}</span> ${html}` : html; };

// A proximity in words: Scopus W/n and PRE/n, Web of Science NEAR/x and SAME, Cochrane NEAR/n and NEXT, Ovid adjn (lib/query-syntax.mjs).
function nearWords(n, long = false) {
  const words = long ? ' words' : '';
  if (n.kind === 'NEXT') return 'followed by';
  if (n.kind === 'SAME') return 'in the same field as';
  if (n.n == null) return n.kind === 'NEAR' ? 'near' : 'next to';
  if (Number(n.n) === 0) return n.kind === 'PRE' ? 'directly before' : 'next to';
  return n.kind === 'PRE' ? `within ${n.n}${words} before` : `within ${n.n}${words}${long ? ' of' : ''}`;
}
function inl(n, max, depth, global, inh = '') {
  const down = n.field || inh;
  if (isList(n)) return withField(n, listHtml(n, max, depth > 0, global, inh), global, inh);
  if (n.op === 'NEAR') {
    const [a, b] = n.children;
    return withField(n, `${inl(a, max, 1, global, down)}<span class="qd-o"> ${nearWords(n)} </span>${inl(b, max, 1, global, down)}`, global, inh);
  }
  const join = n.op === 'OR' ? '<span class="qd-o"> or </span>' : (i => `<span class="qd-a"> ${n.nots?.[i - 1] === 'NOT' ? 'not' : 'and'} </span>`);
  // Plain alternatives inside an OR read as one list: a · b · c.
  const kids = n.op === 'OR' ? [...(n.children.filter(isTerm).length ? [{ op: 'OR', children: n.children.filter(isTerm) }] : []), ...n.children.filter(c => !isTerm(c))] : n.children;
  if (kids.length === 1) return inl(kids[0], max, depth, global, down);
  const body = kids.map((c, i) => `${i ? (typeof join === 'function' ? join(i) : join) : ''}${inl(c, max, 1, global, down)}`).join('');
  return withField(n, depth > 0 ? `<span class="qd-b">(</span>${body}<span class="qd-b">)</span>` : body, global, inh);
}

function drawn(tree, max, global) {
  const scope = global ? `<span class="qd-f">${esc(fieldName(global))}</span>` : '';
  // a shortened line's title holds every term of it
  const tip = (n, prefix = '') => { if (max === Infinity) return ''; const all = inl(n, Infinity, 0, global); return all === inl(n, max, 0, global) ? '' : ` title="${esc(prefix + plainText(all))}"`; };
  // Branches get their own lines only when one of them is itself a group; simple branches share a line.
  const split = (tree.op === 'OR' || tree.op === 'AND') && !tree.nots?.includes('NOT') && tree.children.length > 1 && tree.children.some(c => !isInline(c));
  if (!split) return `<div class="qd-line"${tip(tree, global ? fieldName(global) + ' ' : '')}>${scope ? `${scope} ` : ''}${inl(tree, max, 0, global)}</div>`;
  return `<div class="qd-h">${tree.op === 'OR' ? 'Any of' : 'All of'}${scope ? ` (${scope})` : ''}</div>${
    tree.children.map(c => `<div class="qd-line qd-branch"${tip(c)}>${inl(c, max, 0, global)}</div>`).join('')}`;
}

/** The query drawn compactly, with the full form (every term) one click away. */
export function queryDiagram(src, { max = 3, controls = true, source = '' } = {}) {
  const tree = queryTree(src, { source });
  if (!tree) return String(src || '').trim() ? `<div class="qd"><div class="qd-line qd-literal" title="${esc(src)}">${esc(src)}</div></div>` : '';
  // Only a field shared by every operand can describe the entire query.
  const fields = new Set(fieldsOf(tree));
  const global = fields.size === 1 ? [...fields][0] : '';
  const short = drawn(tree, max, global), full = drawn(tree, Infinity, global);
  const warn = tree.mixed ? '<div class="qd-warn">AND and OR mixed without brackets</div>' : '';
  if (short === full) return `<div class="qd">${short}${warn}</div>`;
  // Without controls the caller places its own toggle ([data-qd-toggle]) beside its other links.
  if (!controls) return `<div class="qd"><div class="qd-short">${short}</div><div class="qd-full" hidden>${full}</div>${warn}</div>`;
  return `<div class="qd"><div class="qd-short">${short}<button type="button" class="qd-more" data-qd-more>All terms</button></div><div class="qd-full" hidden>${full}<button type="button" class="qd-more" data-qd-less>Fewer terms</button></div>${warn}</div>`;
}

/**
 * The query as a nested outline, for reading its logic: each AND, OR, NOT and proximity group is a heading with its
 * operands indented under it, and a list of plain alternatives sits on one line ("a · b · c"). Every term is shown.
 * Text the reader cannot parse (an ambiguous native expression) is shown as it is.
 */
export function queryOutline(src, { source = '' } = {}) {
  const tree = queryTree(src, { source });
  if (!tree) return String(src || '').trim() ? `<div class="bq-term bq-literal">${esc(src)}</div>` : '';
  // The field most terms are searched in is said once, at the top; only a term searched elsewhere is marked (Spinal Curvatures (MeSH)).
  // Said for every term instead, 90 of 91 terms of a PubMed strategy carried "Title, abstract" (owner, 2026-10-24: "not a correct render").
  const all = fieldsOf(tree), tally = new Map();
  for (const f of all) tally.set(f, (tally.get(f) || 0) + 1);
  const [top, topN] = [...tally].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const global = top && topN >= all.length * 0.75 ? top : '', marked = global && topN < all.length;
  let terms = 0;
  const count = n => { if (isTerm(n)) terms++; else n.children.forEach(count); };
  count(tree);
  const line = (n, inh = '') => `<div class="bq-term"><span>${inl(n, Infinity, 0, global, inh)}</span></div>`;
  // Read as it is written, A OR B: a group's parts one under another with the word that joins them between, never the word first
  // (owner, 2026-10-24: "OR A B is confusing then A OR B"). A group is a bracket, drawn as the rule at its left; the whole query has none.
  const join = (word, cls = '') => `<div class="bq-join${cls}">${word}</div>`;
  const scope = n => n.field && n.field !== global ? `<div class="bq-scope"><span class="bq-field">${esc(fieldName(n.field))}</span></div>` : '';
  const group = (html, n, depth, cls = '') => depth ? `<div class="bq-group${cls}">${scope(n)}${html}</div>` : `${scope(n)}${html}`;
  const node = (n, depth = 0, inh = '') => {
    const down = n.field || inh;
    if (isInline(n)) return line(n, inh);
    if (n.op === 'NEAR') return group(n.children.map(c => node(c, depth + 1, down)).join(join(nearWords(n, true))), n, depth);
    if (n.op === 'OR') {
      const plain = n.children.filter(isTerm), groups = n.children.filter(c => !isTerm(c));
      const kids = [...(plain.length ? [line({ op: 'OR', children: plain }, down)] : []), ...groups.map(c => node(c, depth + 1, down))];
      return group(kids.join(join('or')), n, depth);
    }
    const parts = n.children.map((c, i) => `${i ? join(n.nots?.[i - 1] === 'NOT' ? 'and not' : 'and', n.nots?.[i - 1] === 'NOT' ? ' bq-not' : '') : ''}${node(c, depth + 1, down)}`).join('');
    const warn = n.mixed ? '<div class="bq-warn">AND and OR mixed without brackets: read left to right</div>' : '';
    return group(warn + parts, n, depth, n.mixed ? ' mixed' : '');
  };
  return `<div class="bq-sum">${terms} ${terms === 1 ? 'term' : 'terms'}${global ? `, ${esc(fieldName(global))}${marked ? ' unless marked' : ''}` : ''}</div>${node(tree)}`;
}

/** "All terms" shows every term of a drawn query; "Fewer terms" folds it back. */
export function wireQueryDiagrams(root) {
  root.querySelectorAll('.qd').forEach(q => {
    const short = q.querySelector(':scope > .qd-short'), full = q.querySelector(':scope > .qd-full');
    if (!short || !full) return;
    const more = q.querySelector('[data-qd-more]'), less = q.querySelector('[data-qd-less]');
    if (more) more.onclick = () => { short.hidden = true; full.hidden = false; };
    if (less) less.onclick = () => { full.hidden = true; short.hidden = false; };
  });
  // A caller's own toggle: the drawn query in the same cell.
  root.querySelectorAll('[data-qd-toggle]').forEach(b => b.onclick = () => {
    const q = b.closest('td, li, .qd-host')?.querySelector('.qd'); if (!q) return;
    const short = q.querySelector(':scope > .qd-short'), full = q.querySelector(':scope > .qd-full');
    if (!short || !full) return;
    const all = full.hidden; short.hidden = all; full.hidden = !all;
    b.textContent = all ? 'Fewer terms' : 'All terms';
  });
}
