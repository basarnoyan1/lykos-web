// Settings › Projects: the project list, managed. Rename, open, show in the
// Finder, move an app-storage project into a folder, take a project off the
// list (its files and stored data stay), and — for projects kept in the app's
// storage only — delete, after a backup. Folder projects are never deleted
// here: the folder is the person's.
import { ago } from '../lib/dates.mjs';
import * as projects from '../lib/projects.mjs';
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { inDesktop, allowFoldersNative } from '../lib/native.mjs';
import { folderAtPath, canOpenFolders } from '../lib/fsys.mjs';

const nameOf = p => p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project');

const CAN_RENAME = (p, open) => open || p.kind === 'app' || (p.kind === 'path' && inDesktop());
const seen = at => at ? ago(at) : '';
/** One project: its name, the folder as one quiet line (the full path is the tooltip), when it was opened, Open and More. */
const projectRow = (p, cur) => {
  const open = p.id === cur, where = projects.locationOf(p);
  return uiRow({ attrs: { 'data-pm': p.id },
    main: { html: `<span class="tk-text pm-name" title="${esc(nameOf(p))}">${esc(nameOf(p))}</span>`, detail: [`<span title="${esc(where)}">${esc(where)}</span>`] },
    cells: [{ col: 'when', kind: 'text', ch: 12, html: open ? 'Open now' : esc(seen(p.openedAt)) }],
    end: uiRowEnd({ primary: open ? null : { id: `pm-open-${p.id}`, label: 'Open', attrs: { 'data-pm-open': p.id } }, more: { label: `More for ${nameOf(p)}`, attrs: { 'data-pm-more': p.id } } }) });
};
const head = (id, title, n, actions = []) => uiBar({ kind: 'head', label: `${title}, ${n}`, id: `${id}-head`, lead: { title, level: 'h3' }, status: { id: `${id}-n`, text: String(n), ch: 4 }, actions });

/** The section's markup; the stored-projects part is filled in by wireProjects. */
export function projectsBody() {
  const cur = projects.currentId();
  const list = projects.switchList();
  return `<div class="pm">
    ${uiList({ id: 'pm-list', label: 'Projects', cls: 'pm-list', cols: ['when'], attrs: { 'data-pm-list': true }, head: head('pm', inDesktop() ? 'On this Mac' : 'In this browser', list.length, canOpenFolders() ? [{ id: 'pm-add', label: 'Add', icon: 'plus' }] : []),
      rows: list.map(p => projectRow(p, cur)), empty: '<p class="meta">No projects</p>' })}
    <div id="pm-stored"></div>
    <p class="note" id="pm-status" role="status"></p>
  </div>`;
}

export function wireProjects(el, ctx) {
  const status = msg => { const n = el.querySelector('#pm-status'); if (n) n.textContent = msg || ''; };
  const byId = id => projects.switchList().find(p => p.id === id);
  const rename = async p => {
    const name = await ask('Rename project', { value: nameOf(p), confirm: 'Rename' });
    if (name == null || name.trim() === nameOf(p)) return;
    try {
      await projects.renameProject(p.id, name, { renameOpen: n => update(s => { s.project = { ...(s.project || {}), name: n }; return s; }) });
      ctx.rerender();
    } catch (err) { status(err.message); }
  };
  el.querySelector('#pm-add')?.addEventListener('click', () => projects.openFolder().catch(err => status(err.message)));
  el.querySelectorAll('[data-pm-open]').forEach(b => b.onclick = () => projects.open(b.dataset.pmOpen).catch(err => status(err.message)));
  const reveal = async p => {
    if (!p?.path) return;
    try { await allowFoldersNative([p.path]).catch(() => {}); await folderAtPath(p.path).reveal(''); } catch (err) { status(err.message); }
  };
  const moveToFolder = async () => { try { await projects.saveLocalToFolder(get()); } catch (err) { status(err.message); } };
  const removeFromList = async p => {
    const app = p.kind === 'app' || p.kind === 'local';
    if (!await confirmAsk(`Remove ${nameOf(p)} from the list?`, { detail: app ? 'It stays in app storage, under Local projects.' : `The folder and its files stay at ${p.path || p.name}.`, confirm: 'Remove' })) return;
    try { await projects.removeFromList(p.id); ctx.rerender(); } catch (err) { status(err.message); }
  };
  el.querySelectorAll('[data-pm-more]').forEach(b => b.onclick = () => {
    const p = byId(b.dataset.pmMore); if (!p) return;
    const open = p.id === projects.currentId(), app = p.kind === 'app' || p.kind === 'local';
    showMenu(b, [
      CAN_RENAME(p, open) && { label: 'Rename', icon: 'rename', run: () => rename(p) },
      p.kind === 'path' && inDesktop() && { label: 'Show in Finder', icon: 'folder', run: () => reveal(p) },
      open && app && canOpenFolders() && { label: 'Move to folder', icon: 'upload', run: moveToFolder },
      { label: 'Remove from list', icon: 'trash', danger: true, run: () => removeFromList(p) },
    ].filter(Boolean), { align: 'end' });
  });
  const host = el.querySelector('#pm-stored');
  (async () => {
    const stored = (await projects.storedProjects()).filter(p => !p.listed);
    const rows = [...(projects.localMoved() ? [{ id: projects.LOCAL, name: 'Local project', records: null, savedAt: 0, local: true }] : []), ...stored];
    if (!host.isConnected) return;
    host.innerHTML = !rows.length ? '' : uiList({ id: 'pm-stored-list', label: 'Local projects', cls: 'pm-list', cols: ['when'], attrs: { 'data-pm-list': true }, head: head('pm-stored', 'Local projects', rows.length), rows: rows.map(p => uiRow({
      main: { html: `<span class="tk-text pm-name" title="${esc(p.name)}">${esc(p.name)}</span>`, detail: [p.records == null ? 'App storage' : `${p.records} records`] },
      cells: [{ col: 'when', kind: 'text', ch: 12, html: esc(seen(p.savedAt)) }],
      end: uiRowEnd({ primary: { id: `pm-relist-${p.id}`, label: 'Add to list', attrs: { 'data-pm-relist': p.id } }, more: { label: `More for ${p.name}`, attrs: p.local ? { 'data-pm-stored-more': p.id, disabled: '' } : { 'data-pm-stored-more': p.id } } }) })) });
    host.querySelectorAll('[data-pm-relist]').forEach(b => b.onclick = async () => {
      try { await projects.relist(b.dataset.pmRelist); ctx.rerender(); } catch (err) { status(err.message); }
    });
    const deleteStored = async p => {
      if (!await confirmAsk(`Delete ${p.name}?`, { detail: `Its ${p.records} records, decisions, extracted values and notes are removed from app storage. A backup is saved first${inDesktop() ? ' beside the app data' : ' as a download'}.`, confirm: 'Delete', danger: true })) return;
      try { await projects.deleteStoredProject(p.id); status(`Deleted ${p.name}`); ctx.rerender(); } catch (err) { status(err.message); }
    };
    host.querySelectorAll('[data-pm-stored-more]').forEach(b => b.onclick = () => {
      const p = rows.find(x => x.id === b.dataset.pmStoredMore); if (!p) return;
      if (!p.local) showMenu(b, [{ label: 'Delete', icon: 'trash', danger: true, run: () => deleteStored(p) }], { align: 'end' });
    });
  })().catch(err => { if (host.isConnected) host.textContent = err.message; });
}
