// Manuscript suggestions share the normal proposal ledger and acceptance boundary.
import { store$get as get, store$update as update, store$projectGeneration as projectGeneration, store$recoveryOwner as recoveryOwner } from "../boot.mjs";
import { lib_manuscript$blankBlock as blankBlock } from "../boot.mjs";
import { newTable, tableText } from './manuscript-doc.mjs';
import { validateSpec } from './output-spec.mjs';
import { renderOutput, previewHtml, chartSvg } from './output-render.mjs';
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$reviewSummary as uiReviewSummary } from "../boot.mjs";
import { blockLocation } from './manuscript-proposal-view.mjs';
// A proposal row's helpers live in the light module lib/aid.mjs and lib/research-copilot.mjs draw with; they are named here too for the manuscript's own callers.
export { manuscriptDiff, blockLocation, manuscriptProposalLocation, visibleText, blockContext, manuscriptProposalKind, manuscriptChangeSummary, manuscriptProposalPreview } from './manuscript-proposal-view.mjs';

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
  return { it: { label: `Insert ${kind.toLowerCase()}: ${spec.title}`, detail: `After ${place}, ${model.result.total} rows`, manuscriptEdit: true, outputSize: { rows: (model.groups[0]?.cells.length || 0) + 1, cols: model.columns.length },
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
