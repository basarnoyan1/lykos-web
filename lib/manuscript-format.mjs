// A run's source text: what it contributes to the block's text and offsets. A
// citation counts as its tokens; a tracked deletion counts as nothing, since
// its words are no longer the document's (it is shown, not counted).
export const sourceOf = run => run.del ? '' : run.cite ? run.cite.map(k => `[@${k}]`).join('') : run.t || '';
export const textOfRuns = rs => rs.map(sourceOf).join('');

/** Apply character properties to a source-text range without changing paragraph properties. */
// Character properties a tracked format change records, so it can be rejected.
export const CHAR_PROPS = ['font', 'sz', 'b', 'i', 'u', 'strike', 'caps', 'smallCaps', 'color', 'highlight', 'sup', 'sub'];
const charOf = run => Object.fromEntries(CHAR_PROPS.filter(k => run[k] != null).map(k => [k, run[k]]));
/**
 * Apply character properties to a source-text range. With `track` ({ author,
 * date }), each run whose formatting changes records what it was, once, as
 * Word's rPrChange does, so the change can be accepted or rejected.
 */
export function formatTextRange(block, from, to, patch, track = null) {
  if (to <= from) return block;
  const source = block.runs?.length ? block.runs : [{ t: block.text || '' }];
  let at = 0;
  const out = [];
  for (const run of source) {
    const text = sourceOf(run);
    if (run.del) { out.push({ ...run }); continue; }
    const start = at; at += text.length;
    if (at <= from || start >= to || run.cite) { out.push({ ...run }); continue; }
    const lo = Math.max(0, from - start), hi = Math.min(text.length, to - start);
    if (lo) out.push({ ...run, t: text.slice(0, lo) });
    if (hi > lo) {
      const next = { ...run, ...patch, t: text.slice(lo, hi) };
      const changed = Object.keys(patch).some(k => (run[k] ?? null) !== (patch[k] ?? null));
      if (track && changed && !run.fmtChange && !run.ins) next.fmtChange = { ...track, old: charOf(run) };
      out.push(next);
    }
    if (hi < text.length) out.push({ ...run, t: text.slice(hi) });
  }
  return { ...block, runs: out };
}

export function formatAt(block, offset) {
  let at = 0;
  const live = (block.runs || []).filter(r => !r.del);
  for (const run of live) {
    at += sourceOf(run).length;
    if (offset < at) return run;
  }
  return live.at(-1) || {};
}

/** The runs of a block between two source offsets, cutting a text run where needed; a citation is whole, on the side where it starts. */
function sliceRuns(block, from, to) {
  const out = []; let at = 0;
  for (const run of block.runs?.length ? block.runs : [{ t: block.text || '' }]) {
    const text = sourceOf(run), start = at; at += text.length;
    // A run with no source length (a tracked deletion) belongs to the slice
    // its position starts, so a cut at that point keeps it exactly once.
    if (!text.length) { if (!run.cite && start >= from && (start < to || to === Infinity)) out.push({ ...run }); continue; }
    if (at <= from || start >= to) continue;
    if (run.cite) { if (start >= from && start < to) out.push({ ...run }); continue; }
    out.push({ ...run, t: text.slice(Math.max(0, from - start), Math.min(text.length, to - start)) });
  }
  return out.filter(r => r.cite || r.t);
}
export { sliceRuns };
const character = run => { const { t, cite, del, fmtChange, ...rest } = run || {}; return cite ? {} : rest; };

/**
 * Replace the text between two block positions with plain text, as a paste,
 * cut or typed character does. The text takes the formatting at the start
 * point; each line after the first becomes a new paragraph with the first
 * block's style, as Enter would make. Returns the new blocks and the caret.
 */
export function replaceTextRange(blocks, start, end, text, makeId, extra = null) {
  const first = blocks.findIndex(b => b.id === start.id), last = blocks.findIndex(b => b.id === end.id);
  if (first < 0 || last < first) return null;
  const a = blocks[first], z = blocks[last];
  const fmt = { ...character(start.at > 0 ? formatAt(a, start.at - 1) : formatAt(a, 0)), ...(extra || {}) };
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const head = sliceRuns(a, 0, start.at), tail = sliceRuns(z, end.at, Infinity);
  const runsText = rs => rs.map(sourceOf).join('');
  const made = lines.map((line, k) => {
    const rs = [...(k === 0 ? head : []), ...(line ? [{ ...fmt, t: line }] : []), ...(k === lines.length - 1 ? tail : [])];
    const base = k === 0 ? a : { ...a, id: makeId(), type: a.type === 'p' || a.type === 'quote' ? a.type : 'p',
      props: { ...(a.props || {}), pageBreakBefore: false } };
    return { ...base, runs: rs.length ? rs : [{ t: '' }], text: runsText(rs) };
  });
  // A section break ends the paragraph that carried it: after a split it
  // belongs to the last part, and a page break before to the first.
  if (made.length > 1 && a.props?.section) made.forEach((m, k) => {
    if (k === made.length - 1) return;
    const { section, ...rest } = m.props; made[k] = { ...m, props: rest };
  });
  markSplits(made, extra);
  const lastMade = made.at(-1);
  const at = lastMade.text.length - runsText(tail).length;
  return { blocks: [...blocks.slice(0, first), ...made, ...blocks.slice(last + 1)], caret: { id: lastMade.id, at } };
}

/**
 * While changes are tracked, the paragraph marks a split makes are the
 * author's insertions: every part but the last ends with a new mark (the last
 * keeps the paragraph's own), as Word records an Enter.
 */
function markSplits(made, extra) {
  if (!extra?.ins || made.length < 2) return;
  made.forEach((m, k) => { if (k < made.length - 1 && m.type !== 'table') made[k] = { ...m, props: { ...(m.props || {}), markIns: { ...extra.ins } } }; });
}

const EMPHASIS = ['b', 'i', 'u', 'strike', 'sup', 'sub', 'smallCaps', 'caps'];
/**
 * Replace the text between two block positions with pasted paragraphs
 * (`{ type, runs, props, list }`, as paste-html.mjs reads them): the first
 * joins the paragraph at the start point, the last takes the text after the
 * end point, those between become paragraphs of their own. Pasted runs keep
 * their emphasis (bold, italic, underline, strikethrough, super- and
 * subscript) and take the font and size at the caret, as Word's "merge
 * formatting" does. `listFor(kind)` returns the list id a pasted list item
 * joins. Returns the new blocks and the caret.
 */
export function replaceWithParagraphs(blocks, start, end, paras, makeId, listFor = () => null, extra = null) {
  if (!paras.length) return replaceTextRange(blocks, start, end, '', makeId);
  // A pasted table stands between paragraphs: the text before the caret stays
  // in its paragraph and the text after it starts a new one.
  if (paras[0].type === 'table') paras = [{ type: 'p', runs: [] }, ...paras];
  if (paras.at(-1).type === 'table') paras = [...paras, { type: 'p', runs: [] }];
  const first = blocks.findIndex(b => b.id === start.id), last = blocks.findIndex(b => b.id === end.id);
  if (first < 0 || last < first) return null;
  const a = blocks[first], z = blocks[last];
  const caret = character(start.at > 0 ? formatAt(a, start.at - 1) : formatAt(a, 0));
  const base = Object.fromEntries(Object.entries(caret).filter(([k]) => !EMPHASIS.includes(k) && k !== 'ins'));
  const runsOf = p => (p.runs || []).filter(r => r.t).map(r => ({ ...base, ...r, ...(extra || {}) }));
  const head = sliceRuns(a, 0, start.at), tail = sliceRuns(z, end.at, Infinity);
  const made = paras.map((p, k) => {
    if (p.type === 'table') {
      const grid = structuredClone(p.grid);
      const text = grid.rows.map(r => r.cells.filter(c => !c.merged).map(c => c.text || '').join('\t')).join('\n').trim();
      return { id: makeId(), type: 'table', styleId: 'Table', grid, text };
    }
    const rs = [...(k === 0 ? head : []), ...runsOf(p), ...(k === paras.length - 1 ? tail : [])];
    let block;
    if (k === 0) block = { ...a };
    else {
      const type = p.type || 'p';
      const styleId = type === 'p' ? (a.type === 'p' ? a.styleId : 'Normal') : { h1: 'Title', h2: 'Heading1', h3: 'Heading2', quote: 'Quote' }[type];
      const props = { ...(p.props || {}) };
      block = { id: makeId(), type, ...(styleId ? { styleId } : {}), props };
    }
    if (k > 0 && p.list) block.props = { ...block.props, list: { id: listFor(p.list.kind), level: p.list.level || 0 } };
    return { ...block, runs: rs.length ? rs : [{ t: '' }], text: rs.map(sourceOf).join('') };
  });
  markSplits(made, extra);
  const lastMade = made.at(-1);
  const at = lastMade.text.length - tail.map(sourceOf).join('').length;
  return { blocks: [...blocks.slice(0, first), ...made, ...blocks.slice(last + 1)], caret: { id: lastMade.id, at } };
}

/**
 * Which character formats are on at the caret, from every place they can come
 * from: the run (b, i, u, strike, sup, sub), the paragraph's style, and the
 * elements the caret sits in — <b>/<i>/<u>/<s>/<sup>/<sub> and inline
 * font-weight, font-style and text-decoration, innermost first. A tracked
 * insertion (<ins class="tc-ins">) is a revision mark, not underline.
 * `computed` is the browser's resolved weight and style at the caret.
 */
export function formatState(chain = [], run = {}, base = {}, computed = null) {
  const pick = k => run[k] ?? base[k] ?? false;
  const out = { b: pick('b'), i: pick('i'), u: pick('u'), strike: pick('strike'), sup: !!run.sup, sub: !!run.sub };
  if (computed) {
    const w = String(computed.fontWeight || '');
    if (w) out.b = w === 'bold' || Number(w) >= 600;
    if (computed.fontStyle) out.i = computed.fontStyle === 'italic' || computed.fontStyle === 'oblique';
  }
  // Decoration does not inherit as a property, so the nearest element that says either way decides.
  for (const key of ['u', 'strike']) {
    const word = key === 'u' ? 'underline' : 'line-through';
    for (const el of chain) {
      const tag = String(el.tag || '').toUpperCase();
      if (tag === 'INS' && /\btc-ins\b/.test(el.className || '')) continue;
      const deco = String(el.textDecoration || '');
      if ((key === 'u' && tag === 'U') || (key === 'strike' && (tag === 'S' || tag === 'STRIKE')) || deco.includes(word)) { out[key] = true; break; }
      if (/\bnone\b/.test(deco)) { out[key] = false; break; }
    }
  }
  for (const el of chain) { const tag = String(el.tag || '').toUpperCase(); if (tag === 'SUP') out.sup = true; if (tag === 'SUB') out.sub = true; }
  return out;
}
