// A folder of projects or an exported project dropped on a page in a browser tab (the start page, All projects). The drop's entries are
// taken in the event itself (a browser drops them once it returns); the import (views/folder-import-dialog.mjs) loads after.
const holdsFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

/** Takes drops on `target` while `when()` holds (a shared view element: only on its page): `status(text)` reports, `after(project)` once one is in. */
export function dropImport(target, status, after = () => {}, when = () => true) {
  target.addEventListener('dragover', e => { if (holdsFiles(e) && when()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  target.addEventListener('drop', e => {
    if (!holdsFiles(e) || !when()) return;
    e.preventDefault();
    const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean), files = [...e.dataTransfer.files];
    import('../views/folder-import-dialog.mjs').then(m => m.importDropped(entries, files, status, after), err => status(err.message));
  });
}
