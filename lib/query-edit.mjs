// Edits of a query's blocks (8 Nov 2026, the query visualizer: the owner, "can we move blocks around, add them, move them inside each
// other etc like scratch"). A path names a node of the model (lib/query-blocks.mjs): "9:0.1.2" is line 9's block, its item 0, that
// one's item 1 (a But not, say), its item 2; "9:" is line 9's block itself. An edit moves, removes or adds nodes in the model's lines,
// prunes what the edit left empty (a group of one is that one; a group of none goes), and writes every line it touched back into the
// text with lib/query-text.mjs, later lines first so the earlier spans still hold. The page then reads the text again. A But not takes
// away from an All of, so an edit that would put one anywhere else is not made.
import { rewriteLine } from './query-text.mjs';

/** "9:0.1" -> { n: 9, steps: [{ i: 0 }, { i: 1 }] } */
export function parsePath(path) {
  const [n, rest] = String(path).split(':');
  return { n: Number(n), steps: rest ? rest.split('.').map(s => ({ i: Number(s) })) : [] };
}
const lineOf = (model, n) => model.lines.find(l => l.n === n);

/** The node at `path`, or null. */
export function nodeAt(model, path) {
  const { n, steps } = parsePath(path);
  let node = lineOf(model, n)?.block;
  for (const s of steps) { node = node?.items?.[s.i]; }
  return node || null;
}

// the parent arm of `path`: { line, parent, list, index } (a line's own block has no parent)
function place(model, path) {
  const { n, steps } = parsePath(path), line = lineOf(model, n);
  if (!line?.block || !steps.length) return { line, parent: null, list: null, index: -1 };
  let node = line.block;
  for (const s of steps.slice(0, -1)) node = node.items[s.i];
  return { line, parent: node, list: node.items, index: steps.at(-1).i };
}

const clone = x => JSON.parse(JSON.stringify(x));
// the path of a node (by identity) in the model as it is now; '' when it is not in it (it was taken out with what was moved)
function pathOf(model, node) {
  const walk = (x, p) => {
    if (x === node) return p;
    if (!x || x.kind === 'term' || x.kind === 'line') return '';
    const sep = p.endsWith(':') ? '' : '.';
    for (let i = 0; i < (x.items || []).length; i++) { const r = walk(x.items[i], `${p}${sep}${i}`); if (r) return r; }
    return '';
  };
  for (const l of model.lines) { const r = walk(l.block, `${l.n}:`); if (r) return r; }
  return '';
}
const reachable = (model, node) => !!pathOf(model, node);
const strip = x => { const { at, end, mixed, ambiguous, ...rest } = x; return rest; };

// a group the edit left with one member is that member; with none, nothing; a proximity needs two; a But not stays one whatever it holds,
// and goes when it holds nothing; an All of that keeps nothing goes with what it took away (a But not alone takes from nothing)
function prune(node) {
  if (!node || node.kind === 'term' || node.kind === 'line') return node || null;
  const items = node.items.map(prune).filter(Boolean);
  if (node.kind === 'near') return items.length > 1 ? { ...node, items } : items[0] || null;
  if (node.kind === 'not') return items.length ? { ...node, items } : null;
  if (!items.some(x => x.kind !== 'not')) return null;
  return items.length === 1 ? items[0] : { ...node, items };
}

/** The most common field among a line's terms, for a term added to it ('' when it has none). */
export function usualField(model, n) {
  const count = new Map(), walk = x => { if (!x) return; if (x.kind === 'term') count.set(x.field || '', (count.get(x.field || '') || 0) + 1); else (x.items || []).forEach(walk); };
  walk(lineOf(model, n)?.block);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/** A fresh block of `kind` for the palette: a term, a But not of one term, or a group of two terms (a group of one would read as that one). */
export function freshBlock(kind, field = '') {
  const term = text => ({ kind: 'term', text, field, quoted: false, controlled: false });
  if (kind === 'term') return term('term');
  if (kind === 'not') return { kind: 'not', items: [term('term')] };
  if (kind === 'near') return { kind: 'near', op: 'NEAR', n: 3, items: [term('term'), term('term')] };
  return { kind, items: [term('term'), term('term')] };
}

/**
 * The lines after an edit, the text untouched: `removed` are the paths to take out (one block's terms, or one block), what is put in (the
 * removed nodes, else `nodes`) goes at `to`: { mouth: path of the group, index } (index past the end appends), or null to remove only; a But
 * not goes only into an All of.
 * `prune` false keeps a group the edit emptied (the builder's empty mouths, as Scratch's). Answers { lines, touched, placed } (placed: the
 * path of the first node put in) or null when the edit cannot be made or would leave a line with nothing.
 */
export function editLines(lines, { removed = [], to = null, nodes = null }, { prune: tidy = true } = {}) {
  const m = { lines: lines.map(l => ({ ...l, block: l.block ? clone(l.block) : null })) };
  const touched = new Set();
  // the mouth is found before anything is taken out: taking out a block before it in its parent's list changes its path, not the mouth
  const target = to ? nodeAt(m, to.mouth) : null;
  // take out, from the last index first so the earlier ones hold; what is taken keeps its order
  const taken = [];
  const spots = removed.map(p => ({ p, ...place(m, p) })).filter(x => x.line);
  spots.sort((a, b) => b.index - a.index);
  for (const x of spots) {
    if (!x.list) return null;                                     // a line's own block cannot be taken out of itself
    taken.unshift(strip(x.list.splice(x.index, 1)[0]));
    touched.add(x.line.n);
  }
  const put = nodes ? nodes.map(clone) : taken;
  let placed = null;
  if (to && put.length) {
    if (!target || target.kind === 'term' || target.kind === 'line' || !reachable(m, target)) return null;
    if (target.kind !== 'all' && put.some(x => x.kind === 'not')) return null;
    const list = target.items;
    // the index was counted before the move: what left this list above it moved it up
    let index = to.index;
    if (!nodes) for (const x of spots) if (x.list === list && x.index < to.index) index--;
    index = Math.max(0, Math.min(index, list.length));   // clamped last: past the end (1e9) is the end of what is left
    list.splice(index, 0, ...put);
    touched.add(parsePath(to.mouth).n);
    const mouthNow = pathOf(m, target);
    placed = `${mouthNow}${mouthNow.endsWith(':') ? '' : '.'}${index}`;
  }
  for (const n of touched) {
    const line = lineOf(m, n);
    if (tidy) line.block = prune(line.block);
    if (!line.block) return null;
  }
  return { lines: m.lines, touched: [...touched], placed };
}

/** The text after an edit (editLines'): every line it touched written back, the rest as it was; null when it cannot be made. */
export function applyEdit(src, model, spec) {
  const r = editLines(model.lines, spec);
  if (!r) return null;
  // later lines first, so each earlier line's span is still where it was
  let text = src;
  for (const n of [...r.touched].sort((a, b) => (lineOf(model, b).at ?? 0) - (lineOf(model, a).at ?? 0))) text = rewriteLine(text, lineOf(model, n), lineOf(r, n).block, model.dialect);
  return { text, lines: r.touched, placed: r.placed };
}
