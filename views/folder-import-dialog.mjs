// Import projects from folder…: the folder is chosen with the browser's folder upload, the projects in it are found
// (lib/folder-import.mjs) and listed with what each holds, all ticked; the ticked ones are copied into this app's storage.
import { planDialog } from '../lib/dialog.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { esc } from '../lib/html.mjs';
import { RESEARCH_TYPES } from '../lib/research-types.mjs';
import { findProjects, importFound, filesFromHandle, filesFromDrop, sawLykos } from '../lib/folder-import.mjs';
import { plural } from '../lib/dates.mjs';


/**
 * The chosen folder's files with their paths from it, or null when cancelled: read through the browser's folder access where there is one
 * (Chrome, Edge: hidden folders such as .lykos included), else the folder upload every browser has (which may leave hidden folders out).
 */
export async function pickFolderFiles() {
  if (typeof window.showDirectoryPicker === 'function') {
    let dir; try { dir = await window.showDirectoryPicker({ mode: 'read', id: 'lykos-import' }); } catch { return null; }
    const files = await filesFromHandle(dir);
    return files.length ? files : null;   // files.skipped: those it could not read
  }
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.hidden = true; document.body.append(i);
    i.onchange = () => { const files = [...i.files]; i.remove(); resolve(files.length ? files : null); };
    i.oncancel = () => { i.remove(); resolve(null); };
    i.click();
  });
}

const typeLabel = id => RESEARCH_TYPES.find(t => t.id === id)?.label || '';
/** What a found project holds, for its row: its type, records and PDFs; an export says so; a damaged file says why. */
export function foundDetail(f) {
  if (f.error) return [`Not readable: ${f.error}`];
  if (f.kind === 'export') return ['Exported project (.lykos.zip)', f.root || ''];
  return [typeLabel(f.type), plural(f.records, 'record'), `${plural(f.pdfs, 'PDF')}${f.missing ? ` (${f.missing} not in the folder)` : ''}`, f.root].filter(Boolean);
}

/**
 * The projects found in `folder`, listed with what each holds and all ticked: the keys of the ones left ticked, or null when the
 * person cancels. Shared by Import projects (copies) and Add projects from folder (links, lib/projects.mjs addProjectCollection).
 */
export async function chooseProjects(found, folder, { title = 'Import projects', confirm = 'Import' } = {}) {
  const usable = found.filter(f => !f.error), on = new Set(usable.map(f => f.key));
  const row = f => uiRow({ cls: 'fi-row', attrs: { 'data-key': f.key },
    check: { checked: on.has(f.key), label: `${confirm} ${f.name}`, attrs: { 'data-key': f.key, ...(f.error ? { disabled: true } : {}) } },
    main: { html: `<span class="fi-name" title="${esc(f.name)}">${esc(f.name)}</span>`, wrap: true, detail: foundDetail(f).map(esc) } });
  const detailText = () => `${on.size} of ${plural(usable.length, 'project')} in ${folder}`;
  let ok = null, detail = null, toggle = null;
  const refresh = () => { if (detail) detail.textContent = detailText(); if (ok) ok.disabled = on.size === 0; if (toggle) toggle.textContent = on.size === usable.length ? 'Untick all' : 'Tick all'; };
  const go = await planDialog({ id: 'folder-import', title, detail: detailText(), confirm,
    start: { id: 'toggle', label: 'Untick all' },
    body: `<div data-fi-body>${uiList({ id: 'fi-list', label: 'Projects found', rows: found.map(row) })}</div>`,
    onAct: (act, d) => { if (on.size === usable.length) on.clear(); else for (const f of usable) on.add(f.key);
      d.querySelectorAll('[data-fi-body] input[type=checkbox][data-key]').forEach(c => { c.checked = on.has(c.dataset.key); }); refresh(); return true; },
    onMount: d => {
      ok = d.querySelector('[type=submit]'); detail = d.querySelector('.ask-detail'); toggle = d.querySelector('[data-start]');
      d.querySelector('[data-fi-body]').addEventListener('change', e => { const c = e.target.closest('input[type=checkbox][data-key]'); if (!c) return; if (c.checked) on.add(c.dataset.key); else on.delete(c.dataset.key); refresh(); });
      refresh();
    } });
  return go === true ? usable.filter(f => on.has(f.key)).map(f => f.key) : null;
}

/**
 * A folder or an exported project dropped on the page (lib/drop-import.mjs takes the drop): a folder's projects are found and offered as
 * Add projects from folder… does; an export (.lykos.zip) is imported and opened as Import project… does. `after(project)` once one is in.
 */
export async function importDropped(entries, files, status, after = () => {}) {
  const folder = await filesFromDrop(entries);
  if (folder) { const done = await importProjectsFlow(status, folder.length ? folder : null); if (done.length) after(done[0]); return; }
  const zip = files.find(f => /\.lykos\.zip$|\.json(\.gz)?$/i.test(f.name));
  if (!zip) { status('Drop a folder or a .lykos.zip'); return; }
  status('Importing…');
  try { const r = await (await import('../lib/project-backup.mjs')).restoreBackupFile(zip); status(`Imported ${r.name}`); after(r); await (await import('../lib/projects.mjs')).open(r.id); } catch (err) { status(err.message); }
}

/** The whole flow: choose, find, tick, import. `status(text)` reports in the page; resolves to the imported projects. */
export async function importProjectsFlow(status, given = null) {
  let files = given; if (!files) try { files = await pickFolderFiles(); } catch (err) { status(String(err?.message || err)); return []; }
  if (!files) return [];
  const folder = String(files[0].webkitRelativePath || files[0].relativePath || '').split('/')[0] || 'the folder';
  status(`Looking for projects in ${folder}…`);
  const found = await findProjects(files);
  // an upload with no .lykos folder at all: the browser may have left hidden folders out (Safari, Firefox), which is where a project keeps its data
  if (!found.length) { status(sawLykos(files) ? `No projects found in ${folder}` : `No projects found in ${folder}. This browser skips hidden folders: open each project once in the desktop app, which keeps a copy this browser can read, then import again`); return []; }
  status('');
  const keys = await chooseProjects(found, folder);
  if (!keys) return [];
  const chosen = found.filter(f => keys.includes(f.key)), done = [], failed = [];
  // the card (lib/transfers.mjs): a step per project and two per PDF it brings (read, then copied)
  const total = chosen.reduce((n, f) => n + 1 + 2 * (f.pdfs || 0), 0), card = (await import('../lib/transfers.mjs')).transfer(folder, { total });
  let steps = 0;
  for (const [n, f] of chosen.entries()) {
    status(`Importing ${n + 1} of ${chosen.length}: ${f.name}`);
    card.step(steps, total, f.name);
    try { done.push(await importFound(f, files, { onFile: name => card.step(++steps, total, name) })); } catch (err) { failed.push(`${f.name}: ${String(err?.message || err).slice(0, 120)}`); }
    card.step(++steps, total, f.name);
  }
  const said = [done.length ? `Imported ${plural(done.length, 'project')}` : '', failed.length ? `not imported: ${failed.join('; ')}` : '', files.skipped ? `${plural(files.skipped, 'file')} not readable` : ''].filter(Boolean).join('; ');
  status(said);
  if (done.length) card.finish(said); else card.fail(said);
  return done;
}
