// Folder › the papers folder's More: renumber the study PDFs by inclusion order. A preview lists every rename (now → then) before any
// file moves; the renames go through the organise log (lib/project-folder.mjs), so the folder's Organisations list can Undo them.
import { get, persist } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { planDialog } from '../lib/dialog.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { baseName } from '../lib/fsys.mjs';
import { scanFolder, applyOrganise } from '../lib/project-folder.mjs';
import { renumberPlan } from '../lib/papers-renumber.mjs';
import { followMove } from '../lib/folder-follow.mjs';

/** The plan for the folder as it is now: the paths on disk are what a file must be found at. */
export async function planRenumber(folder) {
  const existing = new Set((await scanFolder(folder)).filter(e => !e.dir).map(e => e.path));
  return renumberPlan(get(), { existing });
}

/** Applies a plan through the organise log, and says what happened. */
export async function applyRenumber(folder, plan) {
  const r = await applyOrganise(folder, { creates: [], moves: plan.moves }, { onMoved: followMove });
  await persist();
  return r;
}

function previewDialog(plan) {
  const rows = plan.rows.filter(r => r.from !== r.to).map(r => `<tr><td>${esc(r.label)}</td><td class="nw">${esc(baseName(r.from))}</td><td class="nw">${r.blocked ? `<span class="meta">${esc(r.blocked)}</span>` : esc(baseName(r.to))}</td></tr>`).join('');
  const detail = [plural(plan.changes.length, 'file') + ' to rename', plan.unchanged ? `${plan.unchanged} already numbered` : '', plan.missing.length ? `${plural(plan.missing.length, 'study', 'studies')} without a file` : ''].filter(Boolean).join(', ');
  return planDialog({ id: 'renumber-plan', title: 'Renumber by inclusion order', detail, confirm: 'Rename',
    body: tableRegion({ label: 'Renames', sticky: true, html: `<table><thead><tr><th>Study</th><th>Now</th><th>Renamed to</th></tr></thead><tbody>${rows}</tbody></table>` }),
    onMount: d => { if (!plan.changes.length) d.querySelector('[type=submit]').disabled = true; } });
}

/** The whole flow: plan, preview, rename, report. `done(sentence)` repaints the Folder view with the sentence. */
export async function renumberPapers(folder, done) {
  let plan;
  try { plan = await planRenumber(folder); } catch (err) { done(`Not planned: ${String(err.message || err).slice(0, 120)}`); return; }
  if (!plan.rows.length) { done(plan.missing.length ? 'Nothing to renumber: no included study has a PDF in the folder' : 'Nothing to renumber: no study is included yet'); return; }
  if (!plan.changes.length && !plan.blocked.length) { done('Already numbered in inclusion order'); return; }
  if (!await previewDialog(plan)) return;
  try {
    const r = await applyRenumber(folder, plan);
    done(`${r.moved} renamed${r.failed.length ? `; ${r.failed.length} not renamed: ${r.failed.map(f => baseName(f.from || '')).slice(0, 3).join(', ')}` : ''}. Undo is in Organisations`);
  } catch (err) { done(String(err.message || err).slice(0, 140)); }
}

/** The More menu of the papers folder: its entries. */
export function papersMenuItems({ folder, done, included = 0 }) {
  return [{ label: 'Renumber by inclusion order…', icon: 'list-number', disabled: !included, run: () => renumberPapers(folder, done) }];
}
