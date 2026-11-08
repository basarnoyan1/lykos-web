// A search query drawn as blocks (7 Nov 2026; the query visualizer, query.html). The owner: "create another tool in Lykos web like the
// manuscript citation check one, called query visualizer, inspired by Scratch code blocks and based on our used queries in research
// projects, especially the Sham one: we need to be able to visualize the entered queries".
//
// A query, or a strategy of numbered lines, is read with lib/query-syntax.mjs as its database reads it (every search of the Sham review
// reads: PubMed, Scopus, Web of Science, Cochrane CENTRAL, Europe PMC, ClinicalTrials.gov) and drawn as Scratch draws a script:
// - each group is a C-shaped block with its operands stacked in its mouth: All of (AND), Any of (OR) and But not, one for each thing a NOT
//   takes away, in the mouth of the All of it takes from, after what that keeps; a But not's mouth is any of what it holds (NOT (x OR y)
//   is one But not holding x and y). A group of the same operator inside another is the same conjunction and is drawn as its operands:
//   (a OR b) OR c is any of a, b, c; (a NOT b) AND c is all of a, c, but not b. A NOT's own group stays whole: NOT (a AND b) is a But
//   not holding All of a, b.
// - a term is a value in a slot; the alternatives of one Any of are grouped by the field they search (Title, abstract; MeSH), a subject
//   heading squared where free text is round; a proximity is a block of its own (thalam* within 3 words of stimulat*).
// - a numbered line is a script under a hat (Line 12 and its concept); another line's #12 is a reference to that script, or, in the
//   combined view, that script itself in place, so the search reads as one script.
// - every block keeps the span of the text it was read from (`at`, `end`: offsets in the text as entered), so the page selects it there.
// A line that cannot be read for certain is not drawn as a guess: its hat stands over its faults, in lib/query-check.mjs's words.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { plural } from './dates.mjs';
import { parseStrategy, parseQuery, syntaxCandidates, tokenize, DIALECT_NAMES } from './query-syntax.mjs';
import { checkQuery } from './query-check.mjs';
import { fieldName } from './query-view.mjs';
import { nearWords } from './query-outline.mjs';

/** The databases whose syntax the page reads, as the picker lists them. */
export const BLOCK_DIALECTS = Object.freeze(['pubmed', 'scopus', 'wos', 'cochrane', 'epmc', 'ctgov', 'ictrp', 'ovid', 'embase']);

/**
 * A query or a strategy as blocks: { dialect, detected, name, numbered, json, lines, final, used, checks }.
 * `dialect` is the syntax read (the one asked for, else the one the text shows, else PubMed's); `lines` are [{ n, label, text, at, end,
 * limit?, block, problems }], `block` null when the line cannot be read, at/end placing the line in `src` (null for a strategy file's
 * JSON, whose text is escaped); `used` the lines the final line uses; `checks` lib/query-check.mjs's [{ id, level, text }].
 * Blocks: { kind: 'all', items } | { kind: 'any', items } | { kind: 'not', items } (in an All of's items: what it takes away, any of
 * them) | { kind: 'near', words, items, field } | { kind: 'term', text, field,
 * label, quoted, controlled } | { kind: 'line', n }, each with at/end where known and mixed/ambiguous where the database's order of
 * operators, not a bracket, made the group.
 */
export function queryBlocks(src, { dialect = '' } = {}) {
  const text = String(src ?? '');
  const source = dialect ? DIALECT_NAMES[dialect] || dialect : '';
  const st = parseStrategy(text, { source });
  const candidates = syntaxCandidates(st.lines.map(l => l.text).join('\n'));
  const d = dialect || st.dialect || candidates[0]?.dialect || 'pubmed';
  const json = text.trim().startsWith('{');
  let cursor = 0;
  const lines = st.lines.map(l => {
    if (!json && st.numbered) cursor = afterNumber(text, l.n, cursor);
    const loc = json ? null : locate(text, l.text, cursor);
    if (loc) cursor = loc.end;
    const r = parseQuery(l.text, { dialect: d, positions: true });
    return { n: l.n, label: l.block || '', text: l.text, at: loc?.start ?? null, end: loc?.end ?? null, ...(l.limit ? { limit: l.limit } : {}),
      block: r.tree ? build(r.tree, { d, map: loc?.map || null, src: l.text }, '') : null, problems: r.problems };
  });
  const byN = new Map(st.lines.map(l => [l.n, l])), used = new Set();
  const walk = n => { if (used.has(n) || !byN.has(n)) return; used.add(n); for (const r of byN.get(n).refs || []) walk(r); };
  if (lines.length) walk(lines.at(-1).n);
  return { dialect: d, detected: !dialect && !!(st.dialect || candidates.length), candidates, name: DIALECT_NAMES[d] || d, numbered: st.numbered, json, lines, final: lines.at(-1)?.n ?? null,
    used, checks: text.trim() ? checkQuery(text, { source: DIALECT_NAMES[d] || '' }) : [] };
}

// A numbered line's own text starts after its number (#3, 3., S3): the search for it starts there, so a line whose text is a number of
// its own ("#2 2") is not found in the number before it.
function afterNumber(src, n, from) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:#|S)?${n}(?:[.)][ \\t]*|\\t[ \\t]*|[ \\t]+|(?=\\r?\\n|$))`, 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  return m ? m.index + m[0].length : from;
}

// Where a line's text is in the text as entered, with a map from offsets in the line to offsets there. A query written over several lines
// is one line to the reader (parseStrategy joins its parts with a space), so a run of white space in the line stands for any run there.
function locate(src, line, from) {
  const at = src.indexOf(line, from);
  if (at >= 0) return { start: at, end: at + line.length, map: x => at + x };
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) return null;
  const to = new Int32Array(line.length + 1);
  let i = 0, j = m.index;
  while (i < line.length && /\s/.test(line[i])) to[i++] = j;
  while (i < line.length) {
    if (!/\s/.test(line[i])) { to[i++] = j++; continue; }
    const k = j;
    while (j < src.length && /\s/.test(src[j])) j++;
    while (i < line.length && /\s/.test(line[i])) to[i++] = k;
  }
  to[line.length] = j;
  return { start: m.index, end: m.index + m[0].length, map: x => to[Math.max(0, Math.min(line.length, x))] };
}

// ---- the tree as blocks ---------------------------------------------------------------------------------------------------------------

// a group the order of operators made inside one bracket has no span of its own: its operands' cover it
function rawSpan(n) {
  if (n.at != null) return [n.at, n.end];
  const s = (n.children || []).map(rawSpan).filter(Boolean);
  return s.length ? [Math.min(...s.map(x => x[0])), Math.max(...s.map(x => x[1]))] : null;
}
const spanOf = (n, ctx) => { const r = ctx.map && rawSpan(n); return r ? { at: ctx.map(r[0]), end: ctx.map(r[1]) } : {}; };
// a But not's span starts at its NOT (Scopus's AND NOT), so the text it selects is the whole of what it takes away
const notSpan = (n, ctx) => {
  const r = ctx.map && rawSpan(n);
  if (!r) return {};
  const m = /\b(?:and\s+)?not\s*$/i.exec(ctx.src.slice(0, r[0]));
  return { at: ctx.map(m ? m.index : r[0]), end: ctx.map(r[1]) };
};
const flags = n => ({ ...(n.mixed ? { mixed: true } : {}), ...(n.ambiguous ? { ambiguous: true } : {}) });
// a group drawn as its operands inside its parent: the same operator, read from brackets (not from the order of operators), not Ovid's or/1-3
const merges = (k, kind) => k.kind === kind && !k.mixed && !k.ambiguous && !k.combo;
const rangeList = t => String(t).split(',').flatMap(p => { const [a, b] = p.split('-').map(x => Number(x.trim())); return Number.isFinite(b) ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a]; }).filter(Number.isFinite);

/** The words a term's field is said in: Title, abstract; MeSH; Title, abstract, within 3 words; All fields for a term with no field. */
export function fieldWords(t, field, d) {
  let label;
  if (!field) label = 'All fields';
  else if (t.controlled && d === 'ovid') label = t.explode === false ? 'Subject heading' : 'Subject heading, exploded';
  else label = fieldName(field);
  return t.proximity != null ? `${label}, ${t.proximity === 0 ? 'adjacent' : `within ${t.proximity} words`}` : label;
}

function build(node, ctx, inherited) {
  const sp = spanOf(node, ctx);
  if (node.term != null) {
    if (node.ref != null) return { kind: 'line', n: node.ref, ...sp };
    // Ovid's or/1-3 and and/2,4: the lines it names, joined
    if (node.combo) return { kind: node.combo === 'AND' ? 'all' : 'any', items: rangeList(node.list).map(n => ({ kind: 'line', n, ...sp })), combo: true, ...sp };
    const field = node.field || inherited || '';
    return { kind: 'term', text: node.term, field, label: fieldWords(node, field, ctx.d), quoted: !!node.quoted, controlled: !!node.controlled,
      ...(node.proximity != null ? { proximity: node.proximity } : {}), ...(node.explode === false ? { explode: false } : {}), ...sp };
  }
  const field = node.field || inherited || '';
  const kids = node.children.map(c => build(c, ctx, field));
  if (node.op === 'OR') return { kind: 'any', items: kids.flatMap(k => (merges(k, 'any') ? k.items : [k])), ...flags(node), ...sp };
  if (node.op === 'AND') {
    // nots[i - 1] is the operator before operand i: what a NOT takes away is the same whatever order it comes in ((A NOT B) AND C is A AND
    // C NOT B), so each is a But not after what the All of keeps; NOT (x OR y) is one But not holding x and y, as it is written back
    const kept = [], away = [];
    kids.forEach((k, i) => {
      if (i > 0 && node.nots?.[i - 1] === 'NOT') away.push({ kind: 'not', items: merges(k, 'any') ? k.items : [k], ...notSpan(node.children[i], ctx) });
      else if (merges(k, 'all')) for (const x of k.items) (x.kind === 'not' ? away : kept).push(x);
      else kept.push(k);
    });
    return { kind: 'all', items: [...kept, ...away], ...flags(node), ...sp };
  }
  // a proximity: a chain of one operator (deep NEXT brain NEXT stimulat*) is one block
  const op = node.kind || 'NEAR', n = node.n ?? null;
  const items = kids.flatMap((k, i) => (i === 0 && k.kind === 'near' && k.op === op && k.n === n ? k.items : [k]));
  return { kind: 'near', op, n, words: nearWords(node), field, fieldLabel: field ? fieldName(field) : '', items, ...sp };
}

/** The terms a block searches; `lines` (a Map of n to line) counts a referenced line's terms where it is drawn in place. */
export function termCount(b, lines = null, seen = new Set()) {
  if (!b) return 0;
  if (b.kind === 'term') return b.text ? 1 : 0;   // a builder's blank term is not one yet
  if (b.kind === 'line') {
    const l = lines?.get(b.n);
    if (!l?.block || seen.has(b.n)) return 0;
    return termCount(l.block, lines, new Set([...seen, b.n]));
  }
  return b.items.reduce((a, c) => a + termCount(c, lines, seen), 0);
}

// ---- drawing --------------------------------------------------------------------------------------------------------------------------

const spanAttrs = b => (b.at != null && b.end != null ? ` data-at="${b.at}" data-end="${b.end}"` : '');
const fold = () => `<span class="qb-fold" aria-hidden="true">${icon('chevron-down', { size: 12 })}${icon('chevron-right', { size: 12 })}</span>`;
const count = n => (n ? `<span class="qb-count">${esc(plural(n, 'term'))}</span>` : '');
function orderNote(b, ctx) {
  if (!b.mixed) return '';
  const how = b.ambiguous ? `${ctx.model.name} does not document which comes first; drawn left to right` : `drawn as ${ctx.model.name} reads them`;
  return `<span class="qb-warn" role="img" aria-label="AND and OR at one level without brackets" title="${esc(`AND and OR at one level without brackets: ${how}. Add brackets.`)}">${icon('warn', { size: 12 })}</span>`;
}
// an All of holding only But not has nothing for them to take away from, and is not written (lib/query-text.mjs)
const nothingKept = b => (b.items.length && b.items.every(x => x.kind === 'not')
  ? `<span class="qb-warn" role="img" aria-label="Nothing to take away from" title="Nothing to take away from: this All of holds only But not, so it is not written.">${icon('warn', { size: 12 })}</span>` : '');
// every drawn block names its node in the model (data-path, lib/query-edit.mjs: "9:0.1.2" is line 9, its item 0, that one's item 1, its
// item 2), so the page can move, remove and add blocks; a mouth names the group it belongs to (data-mouth)
const pathAttr = p => (p ? ` data-path="${esc(p)}"` : '');
const slot = (t, path = '') => `<span class="qb-slot${t.controlled ? ' qb-heading' : ''}"${spanAttrs(t)}${pathAttr(path)}${path ? ' tabindex="-1"' : ''}>${esc(t.quoted ? `"${t.text}"` : t.text)}</span>`;
// the builder's row ends in one input that adds words to it (query/builder.mjs), as wide as what is typed (a hidden copy, data-v, gives
// the width); `row` the row's paths. A blank term is drawn as that input alone, never as a slot among words.
const addSlot = (t, row) => { const ph = t.controlled ? 'heading' : 'word';
  return `<span class="qb-slot qb-grow qb-add${t.controlled ? ' qb-heading' : ''}" data-v="${ph}"><input type="text" size="1" spellcheck="false" autocomplete="off" data-row="${row}" placeholder="${ph}" aria-label="${esc(`Add a ${ph} to ${t.label}`)}"></span>`; };
/** The path of child `i` of the node at `path`. */
export const childPath = (path, i) => `${path}${path.endsWith(':') ? '' : '.'}${i}`;
// terms side by side under the field they search, a row for each run of terms of one field, in their order (a block is drawn where it is,
// so a drop lands where it was shown); the row is coloured by the kind of field (`edit`, the builder: the field a menu, the row's words
// slots as wide as their words and then one input for the next)
function termRows(terms, paths = [], edit = false) {
  const runs = [];
  terms.forEach((t, i) => { if (runs.at(-1)?.[0] !== t.label) runs.push([t.label, []]); runs.at(-1)[1].push([t, paths[i] || '']); });
  return runs.map(([label, ts]) => {
    const all = esc(ts.map(x => x[1]).join(','));
    const lead = edit ? `<button type="button" class="qb-drop" data-field-of="${all}" aria-haspopup="menu" aria-label="${esc(`Searched in ${label}`)}">${esc(label)}${icon('chevron-down', { size: 12 })}</button>` : `<span class="qb-in">${esc(label)}</span>`;
    const words = ts.filter(([t]) => !edit || t.text).map(([t, p]) => slot(t, p)).join('');
    return `<p class="qb-terms qb-k-${fieldKind(ts[0][0].field, ts.some(([t]) => t.controlled))}"${ts[0][1] ? ` data-paths="${all}" tabindex="0"` : ''}>${lead}${words}${edit && ts[0][1] ? addSlot(ts[0][0], all) : ''}</p>`;
  }).join('');
}

// ---- kinds of field, and the text in the blocks' colours ----------------------------------------------------------------------------------

const FREE_FIELD = /^(all fields|title|abstract|keywords|topic|text words|author keywords|keyword heading words|multi-purpose fields|interventions|conditions)\b/i;
const HEADING_FIELD = /^(mesh|index terms|subject heading|subheading|subject$)/i;
/** What a field searches: 'free' (words: title, abstract, keywords, all fields), 'heading' (a subject heading: MeSH, index terms) or 'other'. */
export function fieldKind(field, controlled = false) {
  if (controlled) return 'heading';
  const name = field ? fieldName(String(field).split(':~')[0]) : 'All fields';
  return HEADING_FIELD.test(name) ? 'heading' : FREE_FIELD.test(name) ? 'free' : 'other';
}
const OP_KIND = { AND: 'all', OR: 'any', NOT: 'not', NEAR: 'near', SAME: 'near' };
/**
 * The text of a query or a strategy as HTML, escaped, each operator, line number and field in the colour its block is drawn in (qm-all,
 * qm-any, qm-not, qm-near, qm-line, qm-free, qm-heading, qm-other, qm-paren): query.html lays it under the transparent text of its field,
 * so it must keep every character of `src` where it is.
 */
export function queryMarks(src, dialect = '') {
  const s = String(src ?? '');
  const { tokens } = tokenize(s, dialect);
  let out = '', pos = 0;
  tokens.forEach((t, i) => {
    if (t.at < pos) return;
    const text = s.slice(t.at, i + 1 < tokens.length ? tokens[i + 1].at : s.length).replace(/\s+$/, '');
    const k = t.t === 'op' ? OP_KIND[t.v] : t.t === 'combo' ? (t.v === 'AND' ? 'all' : 'any') : t.t === 'ref' ? 'line'
      : ['tag', 'field', 'fieldp', 'suffix'].includes(t.t) ? fieldKind(t.v) : t.t === 'term' && t.controlled ? 'heading' : (t.t === '(' || t.t === ')') ? 'paren' : '';
    out += esc(s.slice(pos, t.at)) + (k ? `<span class="qm-${k}">${esc(text)}</span>` : esc(text));
    pos = t.at + text.length;
  });
  return out + esc(s.slice(pos));
}
// the operands of one mouth in their order: each run of terms in rows by field, each block where it stands; `path` the group's
const mouth = (items, ctx, key, cls = '', path = '') => {
  const at = i => (path ? childPath(path, i) : '');
  let out = '', run = [], j = 0;
  const flush = () => { if (run.length) out += termRows(run.map(x => x[0]), run.map(x => at(x[1])), ctx.edit); run = []; };
  items.forEach((b, i) => { if (b.kind === 'term') run.push([b, i]); else { flush(); out += block(b, ctx, `${key}.${j++}`, '', at(i)); } });
  flush();
  return `<div class="qb-mouth${cls}"${path ? ` data-mouth="${esc(path)}"` : ''}>${out}</div>`;
};
function cBlock(kind, key, top, body, b, ctx, path = '') {
  return `<details class="qb qb-c qb-${kind}" data-key="${esc(key)}"${spanAttrs(b)}${pathAttr(path)}${ctx.closed.has(key) ? '' : ' open'}><summary class="qb-top">${fold()}${top}</summary>${body}<div class="qb-bottom"></div></details>`;
}

// `tag`: the name of the line this block is drawn in place of, in its top bar (one block a line, not a line's block inside another)
function block(b, ctx, key, tag = '', path = '') {
  if (b.kind === 'term') return termRows([b], [path], ctx.edit);
  if (b.kind === 'line') return lineBlock(b, ctx, key, path);
  if (b.kind === 'near') {
    if (b.items.every(x => x.kind === 'term')) {
      return `<p class="qb qb-near qb-flat"${spanAttrs(b)}${pathAttr(path)}${path ? ' tabindex="0"' : ''}>${b.fieldLabel ? `<span class="qb-in">${esc(b.fieldLabel)}</span>` : ''}${b.items.map((x, i) => slot(x, path ? childPath(path, i) : '')).join(`<span class="qb-word">${esc(b.words)}</span>`)}</p>`;
    }
    const arms = b.items.map((x, i) => (i ? `<div class="qb-mid"><span class="qb-op">${esc(b.words)}</span></div>` : '') + mouth([x], ctx, `${key}.${i}`)).join('');
    return cBlock('near', key, `<span class="qb-op">Near</span>${b.fieldLabel ? `<span class="qb-count">${esc(b.fieldLabel)}</span>` : ''}${count(termCount(b, ctx.lines))}`, arms, b, ctx, path);
  }
  const n = termCount(b, ctx.expand ? ctx.lines : null);
  if (b.kind === 'any') return cBlock('any', key, `${tag}<span class="qb-op">Any of</span>${count(n)}${orderNote(b, ctx)}`, mouth(b.items, ctx, key, '', path), b, ctx, path);
  if (b.kind === 'not') return cBlock('not', key, `<span class="qb-op">But not</span>${count(n)}`, mouth(b.items, ctx, key, '', path), b, ctx, path);
  return cBlock('all', key, `${tag}<span class="qb-op">All of</span>${count(n)}${orderNote(b, ctx)}${nothingKept(b)}`, mouth(b.items, ctx, key, '', path), b, ctx, path);
}

// a line is named as the strategy numbers it, #5, then what the reader called it, else what it searches (its first two terms); a line of only #n references has no name
function firstTerms(b, out = []) {
  if (!b || out.length >= 2) return out;
  if (b.kind === 'term') out.push(b.quoted ? b.text : b.text);
  else if (b.kind !== 'line') for (const c of b.items || []) firstTerms(c, out);
  return out;
}
const clip = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const lineWords = l => l.label || clip(firstTerms(l.block).join(', '));
const lineName = l => `<span class="qb-num">#${esc(l.n)}</span>${lineWords(l) ? `<span class="qb-label">${esc(lineWords(l))}</span>` : ''}`;
// another line: in place (the combined view; once per path, so a line that names itself is drawn as a reference), else a link to its script
// in place, the block carries the reference's path (moving it moves the #n) while what is inside it belongs to the line it draws
function lineBlock(b, ctx, key, path = '') {
  const l = ctx.lines.get(b.n);
  if (!l) return `<p class="qb qb-line qb-flat"${spanAttrs(b)}${pathAttr(path)}${path ? ' tabindex="0"' : ''}><span class="qb-label"><span class="qb-num">#${esc(b.n)}</span> is not a line of this strategy</span></p>`;
  if (!ctx.expand || ctx.seen.has(b.n)) return `<a class="qb qb-line qb-flat" href="#qb-line-${esc(b.n)}"${spanAttrs(b)}${pathAttr(path)}>${lineName(l)}</a>`;
  ctx.seen.add(b.n);
  let out;
  const own = `${b.n}:`;
  // a line whose block is a group is that group, named in its top bar; a term, a proximity or a fault is held in a block of the line's own
  if (l.block && (l.block.kind === 'any' || l.block.kind === 'all')) {
    out = block({ ...l.block, at: b.at, end: b.end }, ctx, `${key}#${b.n}`, `<span class="qb-tag">${lineName(l)}</span>`, own);
    if (path) out = out.replace(` data-path="${esc(own)}"`, ` data-path="${esc(path)}"`);   // the block itself is the reference; its mouth and contents are the line's
  }
  else {
    const body = `<div class="qb-mouth">${!l.block ? faults(l, ctx) : l.block.kind === 'term' ? termRows([l.block], [own]) : block(l.block, ctx, `${key}#${b.n}`, '', own)}</div>`;
    out = cBlock('line', `${key}#${b.n}`, `${lineName(l)}${count(termCount(b, ctx.lines))}`, body, { at: l.at, end: l.end }, ctx, path);
  }
  ctx.seen.delete(b.n);
  return out;
}

// a line that cannot be read: what the check says of it, never a guessed drawing
function faults(l, ctx) {
  const prefix = ctx.model.numbered ? `Line ${l.n}: ` : '';
  const said = ctx.model.checks.filter(c => c.level === 'error' && (!prefix || c.text.startsWith(prefix))).map(c => c.text.slice(prefix.length));
  return `<div class="qb-fault">${icon('warn', { size: 14 })}<div><p>Not drawn: this ${ctx.model.numbered ? 'line' : 'query'} cannot be read for certain.</p>${said.map(s => `<p class="qb-fault-why">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</p>`).join('')}</div></div>`;
}

// a script: its hat, then its blocks (a line's own script, in the lines view, is drawn in the line's hue: it defines the line its #n names)
function script(l, ctx, { hat, id = '' }) {
  const body = !l.block ? faults(l, ctx) : l.block.kind === 'term' ? `<div class="qb-lone">${termRows([l.block], [`${l.n}:`])}</div>` : block(l.block, ctx, `L${l.n}`, '', `${l.n}:`);
  return `<section class="qb-script${id ? ' qb-def' : ''}"${id ? ` id="${id}"` : ''} data-line="${esc(l.n)}"><p class="qb-hat"${spanAttrs(l)}>${hat}</p>${body}</section>`;
}

/**
 * The blocks as HTML. A strategy of numbered lines is drawn `combined` (its final line, every line it uses drawn in place) or as `lines`
 * (one script per line, a #n a link to that line's script); a single query is one script either way. `closed`: the keys of folded groups.
 */
export function blocksHtml(model, { view = 'combined', closed = null, mark = '', edit = false } = {}) {
  if (!model?.lines.length) return '';
  const lines = new Map(model.lines.map(l => [l.n, l]));
  const ctx = { model, lines, closed: closed || new Set(), expand: model.numbered && view === 'combined', seen: new Set(), edit };
  const note = l => (l.limit ? `<span class="qb-hat-note">in ${esc(l.limit)}</span>` : '');
  // `mark`: markup the page puts before the database's name in the hat (its icon); the page's own, never the text's
  if (!model.numbered) return script(model.lines[0], ctx, { hat: `${mark}<span class="qb-op">${esc(model.name)}</span>${count(termCount(model.lines[0].block))}${note(model.lines[0])}` });
  if (ctx.expand) {
    const last = lines.get(model.final);
    ctx.seen.add(last.n);
    return script(last, ctx, { hat: `${mark}<span class="qb-op">${esc(model.name)}</span>${count(termCount(last.block, lines, new Set([last.n])))}${note(last)}` });
  }
  return model.lines.map(l => script(l, ctx, { id: `qb-line-${l.n}`,
    hat: `${lineName(l)}${count(termCount(l.block))}${note(l)}${model.used.has(l.n) ? '' : '<span class="qb-hat-note">Not in the search</span>'}` })).join('');
}
