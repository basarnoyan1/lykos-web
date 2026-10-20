// Manuscript suggestions share the normal proposal ledger and acceptance boundary.
import { get, update, projectGeneration, recoveryOwner } from '../store.mjs';
import { blankBlock } from './manuscript.mjs';
import { newTable, tableText } from './manuscript-doc.mjs';
import { validateSpec } from './output-spec.mjs';
import { renderOutput, previewHtml, chartSvg } from './output-render.mjs';
import { esc } from './html.mjs';
import { diffView, diffTokens } from './review-diff.mjs';
import { reviewSummary as uiReviewSummary } from './ui-actions.mjs';

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
  if (index < 0) return 'Location no longer available · review before accepting';
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

/** The strip above a list of suggested edits, in the assistant and in the manuscript (one builder, two scopes). */
export const reviewSummary = ({ count = 0, scope = 'manuscript' } = {}) => uiReviewSummary({ count, id: scope === 'assistant' ? 'assist-review-summary' : 'ms-suggestions-summary' });

/** Rows of a table shown in its suggestion; the rest is one line saying how many more (the whole table is what is inserted). */
const PREVIEW_ROWS = 8;
export async function manuscriptOutputProposal(c) {
  const s = get(), blocks = s.manuscript?.blocks || [];
  if (!s.manuscript || c.after !== 'start' && !blocks.some(b => b.id === c.after)) return { error: 'Choose an existing manuscript block or "start".' };
  const check = validateSpec(c.spec, s);
  if (!check.ok) return { error: check.errors.join('; ') };
  const spec = check.spec, model = renderOutput(s, spec);
  if (!model.columns.length || !model.result.total) return { error: 'The output has no data to insert.' };
  const generation = projectGeneration(), owner = recoveryOwner();
  const anchor = JSON.stringify(blocks.find(b => b.id === c.after) || null);
  const frozen = JSON.stringify(model);
  const current = () => generation === projectGeneration() && owner === recoveryOwner()
    && anchor === JSON.stringify(get().manuscript?.blocks?.find(b => b.id === c.after) || null)
    && frozen === JSON.stringify(renderOutput(get(), spec));
  const kind = spec.kind === 'chart' ? 'Figure' : 'Table';
  const caption = String(c.caption || spec.caption || spec.title), place = blockLocation(s, c.after, { after: true });
  return { it: { label: `Insert ${kind.toLowerCase()}: ${spec.title}`, detail: `After ${place} · ${model.result.total} rows`, manuscriptEdit: true, outputSize: { rows: (model.groups[0]?.cells.length || 0) + 1, cols: model.columns.length },
    preview: previewHtml(model, { rows: PREVIEW_ROWS, groups: model.groups.length }) + `<p>${esc(caption)}</p>`, acceptLabel: 'Accept',
    async accept() {
      if (!current()) return { refused: 'The manuscript or source data changed. Request an updated suggestion.' };
      const inserted = [];
      const cap = label => { const b = blankBlock('p', `${kind} {{seq:${kind}}}. ${label}`); b.styleId = 'Caption'; b.runs = [{ t: b.text }]; return b; };
      if (spec.kind === 'chart') {
        const { svgToPng } = await import('./project-folder.mjs');
        const { putFile } = await import('./files.mjs');
        const svg = chartSvg(model), bytes = await svgToPng(svg);
        if (!bytes) return { refused: 'The figure could not be rendered.' };
        if (!current()) return { refused: 'The manuscript or source data changed.' };
        const img = blankBlock().id, fileHash = await putFile(`img-${img}`, new Blob([bytes], { type: 'image/png' }), { owner });
        if (!current()) return { refused: 'The manuscript or source data changed.' };
        const dimensions = svg.match(/viewBox="[\d.\s-]*?\s([\d.]+)\s+([\d.]+)"/);
        const ratio = dimensions ? +dimensions[2] / +dimensions[1] : 2 / 3;
        inserted.push({ id: blankBlock().id, type: 'figure', img, fileHash, mime: 'image/png', name: `${spec.title}.png`, w: 468, h: 468 * ratio, props: { jc: 'center' }, text: '' }, cap(caption));
      } else {
        for (const group of model.groups) {
          const cells = [model.columns.map(col => col.label), ...group.cells];
          const table = newTable(cells.length, model.columns.length);
          table.grid.rows.forEach((row, r) => row.cells.forEach((cell, col) => { cell.text = String(cells[r][col] ?? ''); cell.runs = [{ t: cell.text }]; }));
          table.text = tableText(table.grid);
          inserted.push(cap([caption, group.label].filter(Boolean).join(' — ')), table);
        }
      }
      update(st => { const at = c.after === 'start' ? 0 : st.manuscript.blocks.findIndex(b => b.id === c.after) + 1; st.manuscript.blocks.splice(at, 0, ...inserted); return st; });
      return `${kind} inserted`;
    } } };
}
