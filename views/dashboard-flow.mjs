// The dated rows across projects and the restore flow: what the start screen and Settings import. They sit apart from the page (views/dashboard.mjs, which
// brings the whole hub with it) so that the shell, which loads pages on first use, does not load the hub to draw either.
import { datedListHtml } from '../lib/hub-tasks.mjs';
import * as projects from '../lib/projects.mjs';
import { dashboardRows } from '../lib/project-summary.mjs';
import { restoreBackupFile, pickBackupFile } from '../lib/project-backup.mjs';
import { inDesktop } from '../lib/native.mjs';
import { dateValue } from '../lib/date-picker.mjs';

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return dateValue(d); };

/** The upcoming rows within `days` (Infinity: every row, undated open work included). */
export function upcoming(entries, days = 90) {
  const today = dateValue(new Date()), rows = dashboardRows(entries, { today });
  return days === Infinity ? rows : rows.filter(r => r.date && (r.overdue || r.date <= addDays(today, days)));
}

/** The upcoming rows as one list: what, then its project and kind, with the date as a column of its own. Shared with the start screen and the portfolio's blocks (lib/hub-tasks.mjs datedListHtml). A row carries `data-db-project` and `data-db-view` for the page that opens it. */
export const upcomingList = (rows, { id = 'db-rows', label = 'Upcoming' } = {}) => datedListHtml(rows, { id, label });

/** Import project…: an exported project (.lykos.zip) or a project copy, added as a new project and opened. */
export async function restoreFlow(status, after = () => {}) {
  const file = await pickBackupFile(); if (!file) return;
  status('Importing…');
  const card = (await import('../lib/transfers.mjs')).transfer(file.name);
  try {
    const r = await restoreBackupFile(file);
    const said = `Imported ${r.name}${r.kept ? `; ${r.kept} ${r.kept === 1 ? 'PDF' : 'PDFs'} not replaced` : ''}`;
    status(said); card.finish(said);
    after(r);
    await projects.open(r.id);
  } catch (err) { status(err.message); card.fail(err.message); }
}

/**
 * Import project…: in a browser, a folder (a project's, or one that holds projects or their exports), since a browser's picker takes a
 * folder or a file, never either, and a project is a folder; the desktop app opens folders in place and imports an export file.
 */
export const importProjectFlow = (status, after = () => {}) => (inDesktop() ? restoreFlow : importFolderFlow)(status, after);

/** Add projects from folder…: the projects in a folder (views/folder-import-dialog.mjs), the ticked ones copied in; the desktop app adds them where they are. */
export async function importFolderFlow(status, after = () => {}) {
  const dlg = await import('./folder-import-dialog.mjs');
  if (inDesktop()) { const report = await projects.addProjectCollection(null, { chooser: (found, folder) => dlg.chooseProjects(found, folder, { title: 'Add projects', confirm: 'Add' }) }); if (report) { status(projects.collectionMessage(report)); after(report); } return; }
  const done = await dlg.importProjectsFlow(status); if (done.length) after(done[0]);
}
