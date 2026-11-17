// How a suggested manuscript change reads in a proposal row: where it lands, what kind of change it is, the change in a few words and
// its preview. Every view with model actions draws these rows (lib/aid.mjs), so this module stays light: the output renderer behind an
// inserted table or figure is lib/manuscript-suggestions.mjs's, loaded with the action that needs it (test/aid-graph.test.mjs).
import { diffView, diffTokens } from './review-diff.mjs';
import { lib_html$esc as esc } from "../boot.mjs";

export function manuscriptDiff(before, after) {
  return `<div class="ms-suggestion-diff${String(before || '').length + String(after || '').length <= 240 ? ' ms-suggestion-short' : ''}">${before ? `<div class="ms-suggestion-before"><strong>Original</strong><p>${esc(before)}</p></div>` : ''}<div class="ms-suggestion-after"><strong>Suggested</strong><p>${esc(after)}</p></div></div>`;
}

const isHeading = b => !!b && (/^h[1-6]$/.test(b.type) || /^Heading/.test(b.styleId || ''));
const LOCATED_OPS = ['edit_paragraph', 'insert_paragraph', 'insert_table', 'insert_figure', 'insert_manuscript_output'];
const blocksOf = state => state.manuscript?.blocks || [];
const clipWords = (text, max) => { text = String(text ?? '').replace(/\s+/g, ' ').trim(); if (text.length <= max) return text; const cut = text.slice(0, max).replace(/\s+\S*$/, ''); return `${cut || text.slice(0, max)}…`; };

/**
 * The one formatter for where a block is: "Results › paragraph 2", "Methods › heading", "Results › after paragraph 3" (after: true),
 * "Start of manuscript". An id no block carries any more reads as the unavailable message, never as the id.
 */
export function blockLocation(state, id, { after = false } = {}) {
  if (id === 'start') return 'Start of manuscript';
  const blocks = blocksOf(state), index = blocks.findIndex(block => block.id === id);
  if (index < 0) return 'Location no longer available, review before accepting';
  let heading = 'Manuscript', start = 0;
  for (let i = index; i >= 0; i--) {
    if (isHeading(blocks[i])) { heading = blocks[i].text || 'Untitled section'; start = i; break; }
  }
  const block = blocks[index];
  const target = isHeading(block) ? 'heading' : ['table', 'figure'].includes(block.type) ? block.type : `paragraph ${blocks.slice(start, index + 1).filter(b => b.type === 'p' && !isHeading(b)).length || 1}`;
  return `${heading} › ${after ? 'after ' : ''}${target}`;
}

/** Human-readable destination for typed changes, including persisted proposals. */
export function manuscriptProposalLocation(item, state) {
  const change = item.payload?.change;
  if (!change || !LOCATED_OPS.includes(change.op)) return '';
  return blockLocation(state, change.block || change.after, { after: change.op.startsWith('insert_') });
}

/** Block ids inside a saved detail read as their place in the manuscript; every other word is left alone. */
export function visibleText(text, state) {
  const ids = new Set(blocksOf(state).map(b => b.id));
  return String(text ?? '').replace(/[A-Za-z0-9_-]+/g, word => (ids.has(word) ? blockLocation(state, word) : word));
}

/** The nearest paragraphs before and after a block in its section ('' at a heading, table, figure or either end), clipped for the preview. */
export function blockContext(state, id) {
  const blocks = blocksOf(state), at = blocks.findIndex(b => b.id === id);
  if (at < 0) return { prev: '', next: '' };
  const near = step => { const b = blocks[at + step]; return b && b.type === 'p' && !isHeading(b) ? clipWords(b.text, 400) : ''; };
  return { prev: near(-1), next: near(1) };
}

/** The change a typed manuscript item makes, read against the live block: { kind, before, after, block }. */
function changeOf(item, state) {
  const c = item.payload?.change;
  if (!c) return null;
  const block = blocksOf(state).find(b => b.id === (c.block || c.after)) || null;
  if (c.op === 'edit_paragraph') {
    const before = block?.text || '';
    const after = c.replace_text ?? (c.find != null ? before.replace(String(c.find), () => String(c.replace ?? '')) : null);
    if (after == null) return null;
    return { op: c.op, kind: isHeading(block) ? 'edit_heading' : 'edit_paragraph', before, after: String(after), block, gone: !block };
  }
  if (c.op === 'insert_paragraph') return { op: c.op, kind: /^h[1-3]$/.test(c.type) ? 'insert_heading' : 'insert_paragraph', before: '', after: String(c.text ?? ''), block, gone: c.after !== 'start' && !block };
  if (c.op === 'insert_manuscript_output' || c.op === 'insert_table' || c.op === 'insert_figure') {
    const chart = c.op === 'insert_figure' || c.spec?.kind === 'chart';
    return { op: c.op, kind: chart ? 'insert_figure' : 'insert_table', before: '', after: '', block, gone: c.after !== 'start' && !block };
  }
  return null;
}

const KIND_LABEL = { edit_paragraph: 'Edit paragraph', edit_heading: 'Edit heading', insert_paragraph: 'Insert paragraph', insert_heading: 'Insert heading', insert_table: 'Insert table', insert_figure: 'Insert figure' };
/** "Edit paragraph", "Insert heading", ...; '' for an item that is not a manuscript change (the caller shows its own label). */
export function manuscriptProposalKind(item, state) {
  const ch = changeOf(item, state);
  return ch ? KIND_LABEL[ch.kind] : '';
}

const words = text => (String(text ?? '').match(/\S+/g) || []).length;
const plural = n => `${n} ${n === 1 ? 'word' : 'words'}`;
/** The change in a few words for the row's second line: "reduced" to "lowered", 35 words changed, Adds 37 words, Table, 4 × 3. '' when there is nothing to say. */
export function manuscriptChangeSummary(item, state) {
  const ch = changeOf(item, state);
  if (!ch) return '';
  if (ch.kind === 'insert_table' || ch.kind === 'insert_figure') {
    const d = item.outputSize;
    return ch.kind === 'insert_figure' ? 'Figure' : d?.rows && d?.cols ? `Table, ${d.rows} × ${d.cols}` : 'Table';
  }
  if (ch.kind === 'insert_heading') return ch.after.trim().length <= 40 ? `"${ch.after.trim()}"` : `Adds ${plural(words(ch.after))}`;
  if (ch.kind === 'insert_paragraph') return `Adds ${plural(words(ch.after))}`;
  if (ch.gone) return '';
  const runs = diffTokens(ch.before, ch.after, { rule: false });
  const del = runs.filter(t => 'del' in t).map(t => t.del), ins = runs.filter(t => 'ins' in t).map(t => t.ins);
  if (!del.length && !ins.length) return '';
  if (del.length === 1 && ins.length === 1 && del[0].length <= 40 && ins[0].length <= 40) return `"${del[0]}" to "${ins[0]}"`;
  if (!del.length) return `Adds ${plural(words(ins.join(' ')))}`;
  if (!ins.length) return `Removes ${plural(words(del.join(' ')))}`;
  return `${plural(Math.max(words(del.join(' ')), words(ins.join(' '))))} changed`;
}

/**
 * What a person sees when a suggestion is opened. A typed change is compared against the live block (so the preview is the
 * change as it stands now); a saved item without a typed change keeps the markup it was saved with.
 */
export function manuscriptProposalPreview(item, state) {
  const ch = changeOf(item, state);
  if (ch) {
    if (ch.kind === 'insert_table' || ch.kind === 'insert_figure') return item.preview ? diffView({ kind: ch.kind, after: item.preview, prev: ch.block ? clipWords(ch.block.text, 400) : '' }) : '';
    if (ch.gone && item.preview) return legacyPreview(item.preview);   // the block it was written against is gone: the saved comparison is the honest one
    const anchor = ch.op === 'insert_paragraph' && ch.block ? clipWords(ch.block.text, 400) : '';
    const around = ch.op === 'edit_paragraph' && ch.block ? blockContext(state, ch.block.id) : { prev: anchor, next: '' };
    return diffView({ kind: ch.kind, before: ch.before, after: ch.after, prev: around.prev, next: around.next });
  }
  return item.preview ? legacyPreview(item.preview) : '';
}
// Saved previews predate compact comparisons; keep their text intact.
function legacyPreview(preview) {
  const short = preview.includes('class="ms-suggestion-diff"') && preview.replace(/<[^>]*>/g, '').length <= 265;
  return short ? preview.replace('class="ms-suggestion-diff"', 'class="ms-suggestion-diff ms-suggestion-short"') : preview;
}
