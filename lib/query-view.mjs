// A database query drawn as its structure: ANY-OF boxes (terms joined by OR),
// set side by side with AND between them, nested as the query nests, with
// the field a group searches as its caption and proximity read in words.
// Reads PubMed (term[tiab]), Web of Science (TS=(…), NEAR/n) and Scopus
// (TITLE-ABS-KEY(…), W/n, PRE/n). The exact text stays one click away.
import { esc, plainText } from './html.mjs';

const FIELD_NAMES = { 'TITLE-ABS-KEY': 'Title, abstract, keywords', 'TITLE-ABS': 'Title, abstract', TITLE: 'Title', ABS: 'Abstract', KEY: 'Keywords',
  AUTHKEY: 'Author keywords', TS: 'Topic', TI: 'Title', AB: 'Abstract', AK: 'Author keywords', SU: 'Subject', PY: 'Year', PUBYEAR: 'Year',
  AU: 'Author', AUTH: 'Author', SO: 'Journal', SRCTITLE: 'Journal', DO: 'DOI', DOI: 'DOI', PMID: 'PubMed ID',
  AD: 'Affiliation', AFFIL: 'Affiliation', LA: 'Language', LANGUAGE: 'Language', DT: 'Document type', DOCTYPE: 'Document type',
  ad: 'Affiliation', tiab: 'Title, abstract', ti: 'Title', ab: 'Abstract', mh: 'MeSH', mesh: 'MeSH', tw: 'Text words', all: 'All fields' };
const fieldName = f => FIELD_NAMES[f] || FIELD_NAMES[String(f).toLowerCase()] || f;
const NATIVE_FIELDS = new Set(Object.keys(FIELD_NAMES).filter(f => f === f.toUpperCase()));
const nativeField = f => String(f).toUpperCase() === 'TOPIC' ? 'TS' : NATIVE_FIELDS.has(String(f).toUpperCase()) ? String(f).toUpperCase() : null;
const NATIVE_SYNTAX = new RegExp(`\\b(?:${[...NATIVE_FIELDS, 'Topic'].join('|')})\\s*[=(]`, 'i');

/** Recognises explicit query syntax; free text and file names remain ambiguous. */
export function hasQuerySyntax(src) {
  const text = String(src || '');
  return /\b(?:AND|OR|NOT)\b|\[[A-Za-z]|\b(?:W|PRE|NEAR)\/\d+\b/i.test(text) || NATIVE_SYNTAX.test(text);
}

/** Tokens: ( ) quoted and bare terms, operators, field openers "NAME(" / "NAME=(" and tags [tiab]. */
function tokenize(src) {
  const out = []; let i = 0; const s = String(src || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (c === '"' || c === '“') { const j = s.indexOf(c === '“' ? '”' : '"', i + 1); if (j < 0 || !s.slice(i + 1, j).trim()) return null; out.push({ t: 'term', v: s.slice(i + 1, j), quoted: true }); i = j + 1; continue; }
    if (c === '[') {
      const j = s.indexOf(']', i); if (j < 0) return null;
      const v = s.slice(i + 1, j).trim(); if (!v || /[\[\]]/.test(v)) return null;
      const proximity = v.match(/^(tiab|title\/abstract|ti|title|ad|affiliation):~(\d+)$/i);
      if (v.includes('~') && !proximity) return null;
      if (proximity) {
        const field = { title: 'ti', 'title/abstract': 'tiab', affiliation: 'ad' }[proximity[1].toLowerCase()] || proximity[1].toLowerCase();
        const distance = Number(proximity[2]); if (!Number.isSafeInteger(distance)) return null;
        out.push({ t: 'tag', v: field, proximity: distance });
      } else out.push({ t: 'tag', v });
      i = j + 1; continue;
    }
    const opener = s.slice(i).match(/^([A-Za-z-]+)\s*(?:=\s*)?\(/);
    if (opener && nativeField(opener[1])) { out.push({ t: 'field', v: nativeField(opener[1]) }); i += opener[0].length - 1; continue; }
    if (opener && !/^(AND|OR|NOT)$/i.test(opener[1])) return null;
    const match = s.slice(i).match(/^[^\s()"“”[\]]+/); if (!match) return null;
    const w = match[0]; i += w.length;
    const eqTerm = w.match(/^([A-Za-z-]+)=(.+)$/); if (eqTerm && nativeField(eqTerm[1])) { out.push({ t: 'term', v: eqTerm[2], field: nativeField(eqTerm[1]) }); continue; }
    const prox = w.match(/^(W|NEAR|PRE)\/(\d+)$/i); if (prox) { out.push({ t: 'op', v: 'NEAR', n: Number(prox[2]), kind: prox[1].toUpperCase() }); continue; }
    if (/^(AND|OR|NOT)$/i.test(w)) { out.push({ t: 'op', v: w.toUpperCase() }); continue; }
    // Unknown platform syntax is displayed literally, never rewritten as operands.
    if (/[{}=<>]/.test(w) || /^(?:SAME|adj\d*|NEAR|W|PRE)(?:\/.*)?$/i.test(w) || /\.(?:ti|ab|mp|tw|kf|kw|au|jn|pt|ui)(?:,[a-z]+)*\.$/i.test(w)) return null;
    out.push({ t: 'term', v: w });
  }
  return out;
}

// Proximity binds tightest. PubMed's mixed Boolean operators are read in
// order; ambiguous native database expressions stay literal.
function combine(items, ops, field, native) {
  if (!items.length) return null;
  const xs = [items[0]], os = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], next = items[i + 1]; if (!next) break;
    if (o.v === 'NEAR') { const prev = xs.pop(); xs.push({ op: 'NEAR', n: o.n, kind: o.kind, children: [prev, next] }); }
    else { xs.push(next); os.push(o.v); }
  }
  const mixed = os.includes('OR') && os.some(o => o !== 'OR');
  // PubMed evaluates mixed Boolean operators left to right. Native databases
  // disagree on precedence; preserve their exact text when it is ambiguous.
  if (mixed) {
    if (native) return null;
    let node = xs[0];
    os.forEach((op, i) => { node = op === 'OR' ? { op, children: [node, xs[i + 1]] } : { op: 'AND', children: [node, xs[i + 1]], nots: [op] }; });
    return { ...node, mixed: true, ...(field ? { field } : {}) };
  }
  const runs = [[xs[0]]], runOps = [[]];
  os.forEach((o, i) => { if (o === 'OR') { runs.push([xs[i + 1]]); runOps.push([]); } else { runs.at(-1).push(xs[i + 1]); runOps.at(-1).push(o); } });
  const parts = runs.map((r, i) => r.length === 1 ? r[0] : { op: 'AND', children: r, nots: runOps[i] });
  let node = parts.length === 1 ? parts[0] : { op: 'OR', children: parts };
  if (field) node = { ...node, field };
  // Alternatives with the same scope read as one list.
  if (node.op === 'OR') node.children = node.children.flatMap(c => c.op === 'OR' && !c.field && !c.mixed ? c.children : [c]);
  return node;
}

/** Parses a query into nodes: { term, field } or { op: 'AND'|'OR'|'NEAR', n?, field?, children, mixed? }. */
export function queryTree(src, { source = '' } = {}) {
  if (/\bexp\s|^\s*#?\d+[.)]\s|\n\s*#?\d+\s|:\s*(?:ti|ab|kw)\b/i.test(String(src || ''))) return null;
  const toks = tokenize(src); if (!toks?.length) return null;
  const database = String(source).trim().toLowerCase();
  const native = (database && database !== 'pubmed') || toks.some(t => t.t === 'field' || t.field || t.v === 'NEAR'); let k = 0, invalid = false;
  const group = (field, depth = 0) => {
    if (depth > 64) { invalid = true; return null; }
    const items = [], ops = [];
    while (k < toks.length && toks[k].t !== ')') {
      let tok = toks[k];
      if (tok.t === 'op') {
        if (!items.length || items.length === ops.length) { invalid = true; return null; }
        if (tok.v === 'AND' && toks[k + 1]?.v === 'NOT') { k++; tok = { t: 'op', v: 'NOT' }; }
        ops.push(tok); k++; continue;
      }
      let node;
      if (tok.t === '(' || tok.t === 'field') { k += tok.t === 'field' ? 2 : 1; node = group(tok.t === 'field' ? tok.v : null, depth + 1); if (toks[k]?.t !== ')') { invalid = true; return null; } k++; }
      else if (tok.t === 'tag') { invalid = true; return null; }
      else {
        node = { term: tok.v, field: tok.field || null }; k++;
        // A bare multi-word operand stays intact, including a tag on its last word.
        while (!tok.quoted && !node.field && toks[k]?.t === 'term' && !toks[k].quoted && !toks[k].field) { node.term += ` ${toks[k].v}`; k++; }
      }
      if (toks[k]?.t === 'tag' && node) {
        const tag = toks[k];
        if (tag.proximity != null) {
          // PubMed requires quoted words; wildcards disable proximity there.
          // Keep unsupported forms literal rather than imply a different search.
          if (native || !tok.quoted || node.term?.trim().split(/\s+/).length < 2 || node.term?.includes('*')) { invalid = true; return null; }
          node.proximity = tag.proximity;
        }
        node.field = tag.v; k++;
      }
      if (!node) { invalid = true; return null; }
      if (items.length > ops.length) ops.push({ t: 'op', v: 'AND' });   // adjacent operands read as AND
      items.push(node);
    }
    if (!items.length || ops.length !== items.length - 1) { invalid = true; return null; }
    const node = combine(items, ops, field, native); if (!node) invalid = true; return node;
  };
  const tree = group(null);
  return invalid || k !== toks.length ? null : tree;
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
function listHtml(n, max, brackets, global = '') {
  // A term searched in another field than its list's is marked after it: Spinal Curvatures (MeSH).
  const shared = n.field || termField(n), kids = isTerm(n) ? [n] : n.children, byField = new Map();
  for (const child of kids) {
    const field = child.field || n.field || '';
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
    const scope = field && field !== global && field !== shared ? fieldName(field) : '';
    const once = proximity != null && folded.length > 1;
    const marked = folded.map(x => {
      const tag = [scope, proximity == null || once ? '' : words(proximity)].filter(Boolean).join(' · ');
      return `<span class="qd-t">${esc(x.label)}${tag ? ` <span class="qd-f">(${esc(tag)})</span>` : ''}</span>`;
    });
    if (!once) return marked;
    const run = marked.length - max > 1 ? `${marked.slice(0, max).join('<span class="qd-o"> · </span>')} <span class="qd-n">+${marked.length - max}</span>` : marked.join('<span class="qd-o"> · </span>');
    return [`<span class="qd-b">(</span>${run}<span class="qd-b">)</span> <span class="qd-f">(each ${esc(words(proximity))})</span>`];
  });
  if (items.length === 1) return items[0];
  const cut = items.length - max > 1 ? max : items.length;
  const body = items.slice(0, cut).join('<span class="qd-o"> · </span>') + (items.length > cut ? ` <span class="qd-n">+${items.length - cut}</span>` : '');
  return brackets ? `<span class="qd-b">(</span>${body}<span class="qd-b">)</span>` : body;
}
const withField = (n, html, global) => { const f = n.field || termField(n); return f && f !== global ? `<span class="qd-f">${esc(fieldName(f))}</span> ${html}` : html; };

function inl(n, max, depth, global) {
  if (isList(n)) return withField(n, listHtml(n, max, depth > 0, global), global);
  if (n.op === 'NEAR') {
    const [a, b] = n.children;
    return withField(n, `${inl(a, max, 1, global)}<span class="qd-o"> within ${n.n}${n.kind === 'PRE' ? ' before' : ''} </span>${inl(b, max, 1, global)}`, global);
  }
  const join = n.op === 'OR' ? '<span class="qd-o"> or </span>' : (i => `<span class="qd-a"> ${n.nots?.[i - 1] === 'NOT' ? 'not' : 'and'} </span>`);
  // Plain alternatives inside an OR read as one list: a · b · c.
  const kids = n.op === 'OR' ? [...(n.children.filter(isTerm).length ? [{ op: 'OR', children: n.children.filter(isTerm) }] : []), ...n.children.filter(c => !isTerm(c))] : n.children;
  if (kids.length === 1) return inl(kids[0], max, depth, global);
  const body = kids.map((c, i) => `${i ? (typeof join === 'function' ? join(i) : join) : ''}${inl(c, max, 1, global)}`).join('');
  return withField(n, depth > 0 ? `<span class="qd-b">(</span>${body}<span class="qd-b">)</span>` : body, global);
}

function drawn(tree, max, global) {
  const scope = global ? `<span class="qd-f">${esc(fieldName(global))}</span>` : '';
  // a shortened line's title holds every term of it
  const tip = (n, prefix = '') => { if (max === Infinity) return ''; const all = inl(n, Infinity, 0, global); return all === inl(n, max, 0, global) ? '' : ` title="${esc(prefix + plainText(all))}"`; };
  // Branches get their own lines only when one of them is itself a group; simple branches share a line.
  const split = (tree.op === 'OR' || tree.op === 'AND') && !tree.nots?.includes('NOT') && tree.children.length > 1 && tree.children.some(c => !isInline(c));
  if (!split) return `<div class="qd-line"${tip(tree, global ? fieldName(global) + ' ' : '')}>${scope ? `${scope} ` : ''}${inl(tree, max, 0, global)}</div>`;
  return `<div class="qd-h">${tree.op === 'OR' ? 'Any of' : 'All of'}${scope ? ` · ${scope}` : ''}</div>${
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
  const fields = new Set(fieldsOf(tree)), global = fields.size === 1 ? [...fields][0] : '';
  let terms = 0;
  const count = n => { if (isTerm(n)) terms++; else n.children.forEach(count); };
  count(tree);
  const line = n => `<div class="bq-term"><span>${inl(n, Infinity, 0, global)}</span></div>`;
  const head = (text, n, size) => {
    const f = n.field && n.field !== global ? ` <span class="bq-field">${esc(fieldName(n.field))}</span>` : '';
    return `<div class="bq-op">${text}${f}${size ? ` <span class="meta">${size}</span>` : ''}</div>`;
  };
  const node = n => {
    if (isInline(n)) return line(n);
    if (n.op === 'NEAR') return `<div class="bq-group">${head(`${n.kind === 'PRE' ? 'PRE' : 'NEAR'}/${n.n} · within ${n.n} words${n.kind === 'PRE' ? ', in order' : ''}`, n)}${n.children.map(node).join('')}</div>`;
    if (n.op === 'OR') {
      const plain = n.children.filter(isTerm), groups = n.children.filter(c => !isTerm(c));
      const kids = [...(plain.length ? [line({ op: 'OR', children: plain })] : []), ...groups.map(node)];
      return `<div class="bq-group">${head('OR · any of', n, plain.length + groups.length)}${kids.join('')}</div>`;
    }
    const keep = n.children.filter((c, i) => !i || n.nots?.[i - 1] !== 'NOT'), drop = n.children.filter((c, i) => i && n.nots?.[i - 1] === 'NOT');
    const not = drop.length ? `<div class="bq-group">${head('NOT · none of', { field: null }, drop.length)}${drop.map(node).join('')}</div>` : '';
    const and = keep.length === 1 ? node(keep[0]) : `<div class="bq-group${n.mixed ? ' mixed' : ''}">${head(`AND · all of${n.mixed ? ' <span class="bq-warn">mixed, read left to right</span>' : ''}`, n, keep.length)}${keep.map(node).join('')}</div>`;
    return drop.length ? `<div class="bq-group">${head('AND NOT', n, 0)}${and}${not}</div>` : and;
  };
  return `<div class="bq-sum">${terms} ${terms === 1 ? 'term' : 'terms'}${global ? ` · ${esc(fieldName(global))}` : ''}</div>${node(tree)}`;
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
