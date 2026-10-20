// A package part's dialogs (views/package-view.mjs): page setup, formats, name and file, its versions (each rebuilt from its record), and the
// figures as single files for a journal upload. Loaded when one is opened.
import { get } from '../store.mjs';
import { formDialog } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { saveFile } from '../lib/save.mjs';
import { esc } from '../lib/html.mjs';
import { setPart, labels } from '../lib/package.mjs';
import { day } from '../lib/dates.mjs';

const partOf = id => (get().package?.parts || []).find(p => p.id === id);
const select = (name, label, options, value) => `<label class="field"><span>${label}</span><select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

export async function page(anchor, { part: id, change }) {
  const part = partOf(id); if (!part) return;
  const p = part.page;
  const v = await formDialog({ id: 'pkg-page', title: `Page setup · ${part.name}`, tier: 'S', confirm: 'Save',
    body: select('size', 'Paper', [['A4', 'A4'], ['Letter', 'Letter']], p.size) + select('orient', 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']], p.orient)
      + select('font', 'Font', [['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'], ['Calibri', 'Calibri']], p.font)
      + select('pt', 'Size', [[9, '9 pt'], [10, '10 pt'], [11, '11 pt'], [12, '12 pt']], p.pt) + select('spacing', 'Line spacing', [[1, 'Single'], [1.5, '1.5'], [2, 'Double']], p.spacing) });
  if (!v) return;
  change(pkg => setPart(pkg, id, { page: { ...p, size: v.size, orient: v.orient, font: v.font, pt: Number(v.pt), spacing: Number(v.spacing) } }));
}

export async function formats(anchor, { part: id, change }) {
  const part = partOf(id); if (!part) return;
  const shell = !!globalThis.__TAURI_INTERNALS__;
  const box = (name, label, on, disabled = false, why = '') => `<label class="cr-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}> ${label}${why ? ` <span class="meta">${why}</span>` : ''}</label>`;
  const v = await formDialog({ id: 'pkg-formats', title: `Formats · ${part.name}`, tier: 'S', confirm: 'Save',
    body: box('docx', 'Word (.docx)', true, true) + box('pdf', 'PDF', part.formats.includes('pdf'), !shell, shell ? '' : 'In the desktop app') + box('xlsx', 'Workbook of its tables (.xlsx)', part.formats.includes('xlsx')) });
  if (!v) return;
  change(pkg => setPart(pkg, id, { formats: ['docx', ...(v.pdf ? ['pdf'] : []), ...(v.xlsx ? ['xlsx'] : [])] }));
}

export async function rename(anchor, { part: id, change, state }) {
  const part = partOf(id); if (!part) return;
  const v = await formDialog({ id: 'pkg-rename', title: 'Rename part', tier: 'S', confirm: 'Save',
    body: `<label class="field"><span>Name</span><input name="name" value="${esc(part.name)}"></label><label class="field"><span>File</span><input name="file" value="${esc(part.file)}"></label>
      ${select('prefix', 'Numbering', [['', 'Table 1, Figure 1'], ['S', 'Table S1, Figure S1']], part.prefix)}` });
  if (!v) return;
  try { change(pkg => setPart(pkg, id, { name: String(v.name || part.name).trim(), file: String(v.file || part.file).trim(), prefix: v.prefix || '' })); }
  catch (err) { state.say(err.message); }
}

/** A part's versions, newest first; each one is rebuilt from its record and saved where the person chooses. */
export async function versions(anchor, { part: id, state }) {
  const pkg = get().package, part = partOf(id), records = [...(pkg?.builds?.[id] || [])].reverse();
  if (!records.length) { state.say('Not built yet'); return; }
  showMenu(anchor, records.map(r => ({ label: `v${r.version} · ${day(r.at)}${r.note ? ` · ${r.note}` : ''}`, run: async () => {
    const { rebuildVersion } = await import('../lib/package-write.mjs');
    const { repoOf } = await import('../lib/vcs-watch.mjs');
    try {
      const app = Object.values(pkg.items || {}).some(it => it.source?.app) ? (await import('../lib/app-items.mjs')).appLoader(get()) : null;
      const made = await rebuildVersion(state.folder, pkg, part.id, r, { repo: state.folder ? repoOf(state.folder) : null, state: get(), app });
      for (const f of made) await saveFile(f.bytes, f.name);
      if (made.notice) state.say(made.notice);
    }
    catch (err) { state.say(err.message); }
  } })), { align: 'end', minWidth: 280 });
}

/** The part's figures as single files, Figure_S1.png and so on, in every format their source has (a journal upload; no version in the name). */
export async function files(anchor, { state }) {
  const pkg = get().package; if (!pkg?.parts?.length) return;
  showMenu(anchor, pkg.parts.map(p => ({ label: p.name, run: async () => {
    const L = labels(pkg);
    let n = 0;
    for (const id of p.items) {
      const it = pkg.items[id];
      // a figure the app draws is saved as it builds into the document: its print copy at 600 dpi
      if (it.kind === 'figure' && it.source?.app) {
        const got = await (await import('../lib/app-items.mjs')).renderApp(get(), it.source.app).catch(err => ({ error: err.message }));
        if (got.image) { await saveFile(got.image.bytes, `${L.get(id).replace(' ', '_')}.png`); n++; }
        continue;
      }
      if (it.kind !== 'figure' || !it.source?.path) continue;
      const stem = it.source.path.replace(/\.[^.]+$/, ''), name = L.get(id).replace(' ', '_');
      for (const ext of ['png', 'jpg', 'tif', 'tiff', 'pdf', 'svg']) {
        const path = `${stem}.${ext}`;
        const bytes = await state.folder.read(path).catch(() => null);
        if (bytes) { await saveFile(bytes, `${name}.${ext}`); n++; }
      }
    }
    state.say(n ? `Saved ${n} figure files of ${p.name}` : `${p.name} has no figure files`);
  } })), { align: 'end' });
}
