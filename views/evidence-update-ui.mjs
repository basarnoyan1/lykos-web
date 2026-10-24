// Extraction, More, Update from a newer version: the table's source workbook has a later version in the folder (v19 beside the v12 the project
// holds); what the update does (lib/evidence-update.mjs) is counted and said before anything is written, then the file is recorded as adopted.
import { get, update } from '../store.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { plural } from '../lib/dates.mjs';
import { readXlsx } from '../lib/xlsx-read.mjs';
import { projectFiles } from '../lib/folder-results.mjs';
import { newerVersion, evidenceUpdate, applyEvidenceUpdate } from '../lib/evidence-update.mjs';
import { adoptFromFolder } from '../lib/adopt.mjs';

const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);

/** Finds the newer version, says what updating would do, and does it when the person agrees. `ctx.rerender(message)` reports. */
export async function updateFromNewer(templateId, ctx) {
  const folder = activeFolder(), template = (get().templates || []).find(t => t.id === templateId);
  if (!folder) { ctx.rerender('Updating a table needs the project folder'); return; }
  if (!template?.source?.file) { ctx.rerender('This table was not read from a file'); return; }
  const files = await projectFiles(folder), paths = files.map(f => f.path);
  const next = newerVersion(template, paths);
  if (!next) { ctx.rerender(`No newer version of ${baseOf(template.source.file)} in the folder`); return; }
  const groupsPath = files.filter(f => /(^|\/)table[ _-]?groups\.json$/i.test(f.path)).sort((a, b) => b.mtime - a.mtime)[0]?.path || '';
  let upd;
  try {
    const book = await readXlsx(await folder.read(next.path)), sources = next.sources ? await readXlsx(await folder.read(next.sources)) : null;
    const groups = groupsPath ? JSON.parse(new TextDecoder().decode(await folder.read(groupsPath))) : null;
    upd = evidenceUpdate(get(), { path: next.path, workbook: book, sources, sourcesPath: next.sources, groups, groupsPath, file: await folder.stat(next.path) });
  } catch (err) { ctx.rerender(`${baseOf(next.path)} could not be read: ${String(err.message || err).slice(0, 120)}`); return; }
  const trial = applyEvidenceUpdate(structuredClone(get()), upd, { replaces: templateId });   // counted on a copy, so the question says what will happen
  const studies = [...upd.matched.values()].filter(Boolean).length, unmatched = upd.report.unmatched;
  const ok = await confirmAsk(`Update ${template.name} to v${next.version}?`, { detail: [
    `${plural(studies, 'study', 'studies')} matched by DOI or name${unmatched.length ? `, ${unmatched.length} not (table rows ${unmatched.slice(0, 6).join(', ')})` : ''}.`,
    `${plural(trial.added, 'value')} from ${baseOf(next.path)}${upd.report.quotes ? ` with ${plural(upd.report.quotes, 'quotation')}` : ''} replace the ${plural(trial.removed, 'value')} v${next.current} supplied.`,
    trial.goneStudies ? `Values of ${plural(trial.goneStudies, 'study', 'studies')} it no longer has are removed.` : '',
    trial.keptColumns.length ? `Columns added here are kept: ${trial.keptColumns.join(', ')}.` : '',
    upd.collections.length ? `${upd.collections.map(c => c.name).join(', ')} are rebuilt from ${baseOf(groupsPath)}.` : '',
  ].filter(Boolean).join(' '), confirm: 'Update' });
  if (!ok) return;
  let done;
  update(st => { done = applyEvidenceUpdate(st, upd, { replaces: templateId }); return st; });
  if (upd.adoption) await adoptFromFolder(folder, [upd.adoption]).catch(() => null);   // the cells it gave are tracked against the file from now on
  ctx.rerender(`Updated to v${next.version}: ${plural(done.added, 'value')}${done.goneStudies ? `; values of ${plural(done.goneStudies, 'study', 'studies')} removed` : ''}${unmatched.length ? `; ${plural(unmatched.length, 'row')} not matched` : ''}`);
}
