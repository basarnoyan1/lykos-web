// A search strategy drawn as its structure (6 Nov 2026; plan §B, B10). The owner: "we need to improve the search query visualization
// and parsing". A strategy is read with lib/query-syntax.mjs as its database reads it and drawn as a list:
// - one row per numbered line (#12 A intracranial procedure), its count where one was run;
// - under it, one row per concept: the operands of the line's top-level AND, a NOT among them said "not" (an AND inside an AND is
//   the same conjunction and is drawn as its concepts; a NOT's group stays whole, since NOT (a AND b) is not NOT a AND b);
// - in a concept, its alternatives grouped by the field they search (Title, abstract: a, b, c), each #n named by the line it stands
//   for with that line's count, each MeSH heading with its state at NLM (lib/mesh-check.mjs): a descriptor is heavier, an entry term,
//   a heading not found and one not checked are said in words.
// A line the reader cannot read for certain (unbalanced, a dangling operator, a tag the database does not have, AND and OR mixed where
// the database gives no order) is shown as written with its fault in words, never as a guessed tree.
// Counts of each line are PubMed's (esearch, retmax 0), one line at a time with every #n written out, kept in the project by the
// line's query text (`s.lineCounts`), so a line counted once shows its count in the Search inspector and in a search set's stratum.
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$num as num, lib_dates$day as day } from "../boot.mjs";
import { lib_bib_names$hash64 as hash64 } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow } from "../boot.mjs";
import { parseStrategy, parseQuery, lineQuery, refLine, orderWords, DIALECT_NAMES } from './query-syntax.mjs';
import { meshOf } from './mesh-check.mjs';
import { fieldName } from './query-view.mjs';

const MESH_FIELD = /^(mh|mesh|mesh terms|majr|mesh major topic)(\s*:\s*noexp)?$/i;
const MESH_DIALECTS = new Set(['pubmed', 'cochrane', '']);   // as lib/mesh-check.mjs: Emtree and Ovid's headings are not looked up
const ROWS_MAX = 100;                                         // lib/ui-actions.mjs LIST_ROWS_MAX
const nameOf = d => DIALECT_NAMES[d] || 'the database';

// ---- why a line cannot be read ------------------------------------------------------------------------------------------------

const FAULT = {
  paren: () => 'a bracket is not matched',
  quote: () => 'a quote is not closed',
  bracket: () => 'a square bracket is not matched',
  char: p => `it holds a character the reader does not know (${p.text})`,
  empty: () => 'it has empty brackets or quotes',
  depth: () => 'its brackets are nested too deep',
  operator: p => `${p.text || 'an operator'} has nothing on one side`,
  tag: p => `the field ${p.text} has no term before it`,
  curly: () => 'it has curly quotes, which databases do not read as quotes',
  'unknown-tag': p => `${p.text} is not a PubMed field tag`,
  'unknown-field': (p, d) => `${p.text} is not a ${nameOf(d)} field`,
  'proximity-form': p => `${p.text}: proximity needs a quoted phrase of two or more words`,
  'group-tag': p => `${p.text} follows brackets: PubMed tags one term, not a group`,
};
/** The faults that keep a line from being read for certain, in words: [] when it can be. */
function faultsOf(r, d) {
  const out = [];
  for (const p of r.problems) {
    if (FAULT[p.kind]) out.push(FAULT[p.kind](p, d));
    else if (p.kind === 'mixed' && !p.ordered) out.push(`AND and OR at one level without brackets: ${nameOf(d)} does not say which comes first`);
  }
  if (!r.tree && !out.length) out.push('it cannot be read');
  return [...new Set(out)];
}

// ---- the model ------------------------------------------------------------------------------------------------------------------

/** A concept's alternatives: an OR's operands (an OR inside it is the same list), else the node itself; `inh` the field a group gives. */
function alternatives(node, inh) {
  if (node.op !== 'OR') return [{ node, inh }];
  const f = node.field || inh;
  return node.children.flatMap(c => (c.op === 'OR' && !c.field ? alternatives(c, f) : [{ node: c, inh: f }]));
}
/** The line's concepts: [{ join: '' | 'AND' | 'NOT', node, inh }]. */
function conceptsOf(tree) {
  if (tree.op !== 'AND') return [{ join: '', node: tree, inh: '' }];
  const out = [];
  const walk = (n, join, inh) => {
    if (n.op === 'AND' && join !== 'NOT') {
      const f = n.field || inh;
      n.children.forEach((c, i) => walk(c, i ? (n.nots?.[i - 1] === 'NOT' ? 'NOT' : 'AND') : join, f));
      return;
    }
    out.push({ join, node: n, inh });
  };
  walk(tree, '', '');
  return out;
}

const isMesh = (t, d) => MESH_DIALECTS.has(d) && MESH_FIELD.test(String(t.field || ''));
function termOf(node, inh, ctx) {
  const t = { kind: 'term', term: String(node.term), field: node.field || inh || '', quoted: !!node.quoted, proximity: node.proximity ?? null };
  if (node.controlled) { t.controlled = true; if (node.explode === false) t.noexp = true; }
  if (isMesh(t, ctx.d)) {
    const heading = t.term.split('/')[0].trim();
    if (heading && !heading.includes('*')) { const m = meshOf(ctx.mesh, heading); t.mesh = { status: m.status || 'unchecked', name: m.name || '', ui: m.ui || '', at: m.at || '' }; }
  }
  ctx.terms++;
  return t;
}
/** The words a term's field is said in: Title, abstract; MeSH, not exploded; Title, abstract, within 3 words. */
function fieldLabel(t, d) {
  let label;
  if (!t.field) label = 'All fields';
  else if (t.controlled && t.field === 'mh' && d === 'ovid') label = t.noexp ? 'Subject heading' : 'Subject heading, exploded';
  else if (t.controlled && t.field === 'mh' && t.noexp) label = 'MeSH, not exploded';
  else label = fieldName(t.field);
  return t.proximity != null ? `${label}, ${t.proximity === 0 ? 'adjacent' : `within ${t.proximity} words`}` : label;
}
const rangeOf = list => String(list).split(',').flatMap(p => { const [a, b] = p.split('-').map(x => Number(x.trim())); return Number.isFinite(b) ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a]; }).filter(Number.isFinite);
function refOf(n, ctx) {
  const l = ctx.byN.get(n);
  return { kind: 'ref', n, label: l ? (l.block || clip(l.text, 60)) : '', missing: !l, later: !!l && ctx.at != null && n >= ctx.at };
}
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** A group inside a concept, its leaves made terms and refs: { op, n?, kind?, nots?, children }. */
function annotate(node, inh, ctx) {
  if (node.ref != null) return refOf(node.ref, ctx);
  if (node.term != null) return termOf(node, inh, ctx);
  const f = node.field || inh;
  return { op: node.op, ...(node.n != null ? { n: node.n } : {}), ...(node.kind ? { kind: node.kind } : {}), ...(node.nots ? { nots: node.nots } : {}), children: node.children.map(c => annotate(c, f, ctx)) };
}
const leavesOf = g => (g.kind === 'term' || g.kind === 'ref' ? [g] : g.children.flatMap(leavesOf));
/** The part a concept's alternatives make: terms of one field and distance together, each #n, each group. */
function partsOf(alts, ctx) {
  const parts = [], byKey = new Map();
  for (const { node, inh } of alts) {
    if (node.ref != null) { parts.push(refOf(node.ref, ctx)); continue; }
    if (node.combo) { parts.push({ kind: 'combo', op: node.combo, refs: rangeOf(node.list).map(n => refOf(n, ctx)) }); continue; }
    if (node.term != null) {
      const t = termOf(node, inh, ctx), label = fieldLabel(t, ctx.d), key = label;
      if (!byKey.has(key)) { const part = { kind: 'terms', label, terms: [] }; byKey.set(key, part); parts.push(part); }
      byKey.get(key).terms.push(t);
      continue;
    }
    const tree = annotate(node, inh, ctx), labels = new Map();
    for (const leaf of leavesOf(tree)) if (leaf.kind === 'term') { const l = fieldLabel(leaf, ctx.d); labels.set(l, (labels.get(l) || 0) + 1); }
    const [label = ''] = [...labels].sort((a, b) => b[1] - a[1])[0] || [];
    parts.push({ kind: 'group', label, tree });
  }
  // a MeSH part says a state every heading in it shares once; a heading whose state differs says its own
  for (const p of parts) {
    if (p.kind !== 'terms' || !p.terms.every(t => t.mesh)) continue;
    const states = new Set(p.terms.map(t => t.mesh.status));
    if (states.size === 1 && ['unchecked', 'missing'].includes([...states][0])) p.state = [...states][0];
  }
  return parts;
}

/**
 * A strategy (text, a numbered strategy or a strategy file's JSON) as its structure: { dialect, numbered, terms, lines: [{ n, block,
 * text, query, last, readable, faults, notes, concepts: [{ join, parts, count }], count }] }. `mesh`: the project's MeSH check
 * (lib/mesh-check.mjs meshCache); `count(line)`: the count of a line ({ n, query, text }) where one was run, { total, at } or null.
 */
export function strategyOutline(src, { source = '', mesh = null, count = null } = {}) {
  const st = parseStrategy(src, { source }), d = st.dialect || 'pubmed';
  const ctx = { d, mesh: mesh || {}, byN: new Map(st.lines.map(l => [l.n, l])), terms: 0, at: null };
  const lines = st.lines.map((l, i) => {
    ctx.at = st.numbered ? l.n : null;
    const before = ctx.terms;
    const r = parseQuery(st.numbered ? refLine(l.text) : l.text, { dialect: d }), faults = l.text.trim() ? faultsOf(r, d) : ['the line is empty'];
    const notes = [];
    for (const p of st.problems) {
      if (p.kind === 'undefined-line' && p.line === l.n) notes.push(`#${p.n} is not a line of this strategy`);
      if (p.kind === 'forward-line' && p.line === l.n) notes.push(`#${p.n} comes after this line`);
      if (p.kind === 'unused-line' && p.n === l.n) notes.push('Not used by the final line');
    }
    if (l.limit) notes.push(`Limited to ${l.limit}`);
    if (!faults.length && r.problems.some(p => p.kind === 'mixed' && p.ordered)) notes.push(`AND and OR without brackets: ${orderWords(d)}`);
    const concepts = faults.length ? [] : conceptsOf(r.tree).map(c => ({ join: c.join, parts: partsOf(alternatives(c.node, c.inh), ctx), count: null }));
    const query = st.numbered ? lineQuery(st, l.n) : st.lines.length > 1 ? l.text : st.query;
    return { n: l.n, block: l.block || '', text: l.text, query, last: i === st.lines.length - 1, readable: !faults.length, faults, notes, concepts, terms: ctx.terms - before,
      count: (count && query && count({ n: l.n, query, text: l.text })) || null };
  });
  // a concept that is one #n carries that line's count
  const byLine = new Map(lines.map(l => [l.n, l]));
  for (const l of lines) for (const c of l.concepts) if (c.parts.length === 1 && c.parts[0].kind === 'ref') c.count = byLine.get(c.parts[0].n)?.count || null;
  return { dialect: d, numbered: st.numbered, terms: ctx.terms, lines };
}

// ---- drawn ------------------------------------------------------------------------------------------------------------------------

const JOIN = { AND: 'and', NOT: 'not' };
const meshWords = m => ({ entry: m.name ? `entry term of ${m.name}` : 'entry term', missing: 'not found', unchecked: 'not checked' }[m.status] || '');
function meshTip(m) {
  const when = m.at ? `, NLM ${day(m.at)}` : '';
  if (m.status === 'descriptor') return `MeSH descriptor${m.ui ? ` ${m.ui}` : ''}${when}`;
  if (m.status === 'entry') return `An entry term of ${m.name || 'a descriptor'}${m.ui ? ` (${m.ui})` : ''}${when}: PubMed searches that heading`;
  if (m.status === 'missing') return `Not a MeSH heading${when}: PubMed finds nothing for it`;
  return 'Not checked against NLM';
}
function termHtml(t, said = '') {
  const words = t.mesh && t.mesh.status !== said ? meshWords(t.mesh) : '';
  const text = t.quoted ? `"${t.term}"` : t.term;
  return `<span class="qo-term"${t.mesh ? ` data-mesh="${esc(t.mesh.status)}" title="${esc(meshTip(t.mesh))}"` : ''}>${esc(text)}</span>${words ? ` <span class="qo-note">(${esc(words)})</span>` : ''}`;
}
// a line named by its number and block (#12 A intracranial procedure), or by its block alone where the numbers are the outline's own
const refHtml = (r, o = {}) => (o.numbers === false && r.label ? `<span class="qo-ref">${esc(r.label)}</span>`
  : `<span class="qo-ref${r.missing ? ' qo-missing' : ''}">#${r.n}</span>${r.label ? ` ${esc(r.label)}` : r.missing ? ' <span class="qo-note">(no such line)</span>' : ''}`);
const SEP = ', ';   // the alternatives of one field, as a list is written
/** A proximity operator in words (W/3: within 3 words of; PRE/2: within 2 words before; NEXT: followed by); lib/query-blocks.mjs says them too. */
export function nearWords(g) {
  if (g.kind === 'NEXT') return 'followed by';
  if (g.kind === 'SAME') return 'in the same field as';
  if (g.n == null) return 'near';
  if (Number(g.n) === 0) return g.kind === 'PRE' ? 'directly before' : 'next to';
  return g.kind === 'PRE' ? `within ${g.n} words before` : `within ${g.n} words of`;
}
/** A group inline: its operands joined by their words, a term searched in another field than the group's marked after it. */
function groupHtml(g, label, o, top = true) {
  if (g.kind === 'term') { const l = fieldLabel(g, o.d); return `${termHtml(g)}${l !== label ? ` <span class="qo-note">(${esc(l)})</span>` : ''}`; }
  if (g.kind === 'ref') return refHtml(g, o);
  const word = i => (g.op === 'OR' ? 'or' : g.op === 'NEAR' ? nearWords(g) : g.nots?.[i - 1] === 'NOT' ? 'not' : 'and');
  const body = g.children.map((c, i) => `${i ? ` <span class="qo-join">${esc(word(i))}</span> ` : ''}${groupHtml(c, label, o, false)}`).join('');
  return top ? body : `(${body})`;
}
function partHtml(p, o) {
  if (p.kind === 'ref') return refHtml(p, o);
  if (p.kind === 'combo') return `<span class="qo-join">${p.op === 'OR' ? 'any of' : 'all of'}</span> ${p.refs.map(r => refHtml(r, o)).join(SEP)}`;
  const field = l => (l ? `<span class="qo-field">${esc(l)}:</span> ` : '');
  if (p.kind === 'group') return `${field(p.label)}(${groupHtml(p.tree, p.label, o)})`;
  return `${field(p.state ? `${p.label}, ${meshWords({ status: p.state })}` : p.label)}${p.terms.map(t => termHtml(t, p.state || '')).join(SEP)}`;
}
const countCell = c => ({ col: 'count', kind: 'text', ch: 12,
  html: !c ? '' : c.error ? `<span class="qo-count" title="${esc(c.error)}">Failed</span>` : `<span class="qo-count" title="${esc(`${c.of || 'PubMed'}${c.at ? `, ${day(c.at)}` : ''}`)}">${esc(num(c.total))}</span>` });

/**
 * The outline drawn as a list (lib/ui-actions.mjs uiList, uiRow): a numbered strategy's lines with their concepts under them, a single
 * query's concepts alone. `only`: the line numbers to draw, in that order; `numbers: false` names a line by its block alone; `summary: false`
 * leaves out the line that counts the lines and terms.
 */
export function outlineHtml(model, { id, label = 'Query structure', only = null, numbers = true, summary = true } = {}) {
  const multi = model.lines.length > 1, rows = [];
  const lines = only ? only.map(n => model.lines.find(l => l.n === n)).filter(Boolean) : model.lines;
  const total = lines.reduce((a, l) => a + 1 + (l.readable ? l.concepts.length : 1), 0);
  const deep = total <= ROWS_MAX;   // past the list's rows a line's concepts are said in its detail
  for (const l of lines) {
    if (rows.length >= ROWS_MAX) break;
    const depth = multi ? 1 : 0;
    if (multi) {
      const head = `${numbers && model.numbered ? `<span class="qo-ref">#${l.n}</span> ` : ''}${esc(l.block || (l.last ? 'Search' : model.numbered ? '' : `Part ${l.n}`))}`;
      const detail = [...(l.readable ? [] : [esc(`Cannot be read: ${l.faults.join('; ')}`)]), ...l.notes.map(esc), ...(deep || !l.readable ? [] : [esc(plural(l.concepts.length, 'concept'))])];
      rows.push(uiRow({ cls: 'qo-line', attrs: { 'data-qo-line': l.n }, main: { html: `<span class="qo-name">${head}</span>`, detail, wrap: true }, cells: [countCell(l.count)] }));
    }
    if (!deep) continue;
    if (!l.readable) {
      rows.push(uiRow({ cls: 'qo-raw', depth, main: { html: `<span class="qo-text">${esc(l.text)}</span>`, detail: multi ? [] : [esc(`Cannot be read: ${l.faults.join('; ')}`)], wrap: true }, cells: [countCell(null)] }));
      continue;
    }
    for (const c of l.concepts) {
      const parts = c.parts.map((p, i) => `<span class="qo-part">${i ? '<span class="qo-join">or</span> ' : c.join ? `<span class="qo-join">${JOIN[c.join]}</span> ` : ''}${partHtml(p, { d: model.dialect, numbers })}</span>`).join('');
      rows.push(uiRow({ cls: 'qo-concept', depth, attrs: { 'data-qo-concept': c.join || 'first' }, main: { html: `<span class="qo-parts">${parts}</span>` }, cells: [countCell(c.count)] }));
    }
  }
  const shown = lines.filter(l => rows.some(r => r.includes(`data-qo-line="${l.n}"`))).length;
  const sum = [DIALECT_NAMES[model.dialect] || '', multi ? plural(lines.length, 'line') : plural(lines[0]?.concepts.length || 0, 'concept'), plural(lines.reduce((a, l) => a + l.terms, 0), 'term'),
    multi && shown < lines.length ? `lines ${lines[0].n} to ${lines[shown - 1]?.n} drawn` : ''].filter(Boolean).join(', ');
  return `${summary ? `<p class="meta qo-sum">${esc(sum)}</p>` : ''}${uiList({ id, label, cls: 'qo-list', rows, empty: emptyState({ title: 'No query to outline', size: 'inline' }) })}`;
}

// ---- counts of each line -----------------------------------------------------------------------------------------------------

const COUNTS_MAX = 500;   // counts kept per project, the newest
/** The key a line's count is kept under: its database and its query as run, spaces folded. */
export const countKey = (db, query) => `${db || 'pubmed'}:${hash64(String(query ?? '').replace(/\s+/g, ' ').trim())}`;
export const lineCounts = s => (s?.lineCounts && typeof s.lineCounts === 'object' ? s.lineCounts : {});
/** The count kept for a query as run, { total, at } or null. */
export const countOf = (s, db, query) => lineCounts(s)[countKey(db, query)] || null;
/** Keeps counts in the project (`s.lineCounts`): a failed count never replaces one that ran; past COUNTS_MAX the oldest go. */
export function storeLineCounts(s, db, results) {
  const kept = { ...lineCounts(s) };
  for (const r of results || []) if (!r.error && Number.isFinite(r.total)) kept[countKey(db, r.query)] = { total: r.total, at: r.at };
  const keys = Object.keys(kept);
  if (keys.length > COUNTS_MAX) for (const k of keys.sort((a, b) => String(kept[a].at).localeCompare(String(kept[b].at))).slice(0, keys.length - COUNTS_MAX)) delete kept[k];
  s.lineCounts = kept;
  return s;
}
/** The lines a count runs: [{ n, query }], each line with its #n written out; a single query is one line. */
export function lineQueries(src, { source = '' } = {}) {
  const st = parseStrategy(src, { source });
  return st.numbered ? st.lines.map(l => ({ n: l.n, query: lineQuery(st, l.n) })) : [{ n: st.lines[0]?.n ?? 1, query: st.query }];
}
/**
 * Counts each line in PubMed: esearch with retmax 0 (lib/sources.mjs eutilsJson, posted when long), one line after another through its
 * limiter. `eutils(tool, params)` answers E-utilities JSON. Answers [{ n, query, total, at, error }].
 */
export async function countLines(src, { source = '', eutils, onLine = null, signal = null } = {}) {
  const todo = lineQueries(src, { source }), out = [];
  for (const l of todo) {
    if (signal?.aborted) break;
    const at = new Date().toISOString();
    if (!l.query.trim()) { out.push({ ...l, at, total: null, error: 'The line is empty' }); continue; }
    try {
      const r = (await eutils('esearch', { db: 'pubmed', term: l.query, retmax: '0' }))?.esearchresult || {};
      out.push(r.ERROR ? { ...l, at, total: null, error: String(r.ERROR) } : { ...l, at, total: Number(r.count), error: Number.isFinite(Number(r.count)) ? '' : 'PubMed gave no count' });
    } catch (err) { out.push({ ...l, at, total: null, error: `PubMed: ${err.message}` }); }
    onLine?.(out.length, todo.length);
  }
  return out;
}
