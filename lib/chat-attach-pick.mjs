// The composer's Attach menu (Plane's "Add files or photos", Gumloop's attached file; owner via the Mobbin review, 2026-10-23): a file of the
// project's folders, a study, a table or a figure, or the page in view, each chosen in a searchable list and attached as the gestures attach
// ("Ask about this", lib/chat-attach.mjs): it waits in the composer's box until the next message carries it. Loaded on the first pick.
//
//   ATTACH_ITEMS         the submenu's entries; attachBy(id, lend) attaches one kind; `lend` = { state(), say(text),
//                        attach(built, key) → { ok, reason } (or its promise), page() → { title, text } }
import { pickerDialog, pickerRows } from './dialog.mjs';
import { askRecord } from './record-picker.mjs';
import { buildContext } from './chat-attach-kinds.mjs';
import { currentSpec, builtinOutputs } from './output-spec.mjs';
import { listDir, readPath } from './folders.mjs';
import { fileText } from './filetext.mjs';

const FILES_MAX = 800, DEPTH_MAX = 4;

/** A searchable list of `items` ({ value, title, detail }); resolves to the chosen value or null. */
export function pickOne({ id, title, search, items, empty = 'Nothing to attach' }) {
  return pickerDialog({ id, title, search, onMount: (d, close) => {
    const list = d.querySelector('.ask-picker-list'), input = d.querySelector('input[type=search]');
    const draw = () => {
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const shown = items.filter(it => words.every(w => `${it.title} ${it.detail || ''}`.toLowerCase().includes(w))).slice(0, 200);
      list.innerHTML = pickerRows(shown, { id: `${id}-rows`, label: title, empty: `<p class="meta">${words.length ? 'No matches' : empty}</p>` });
    };
    input.addEventListener('input', draw);
    list.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); });
    draw();
  } });
}

/** The files of the folders the person added, a few levels deep (the folders the assistant may read; lib/folders.mjs). */
async function folderFiles() {
  const out = [], walk = async (path, depth) => {
    if (out.length >= FILES_MAX || depth > DEPTH_MAX) return;
    let entries = []; try { entries = await listDir(path); } catch { return; }
    for (const e of entries) {
      if (out.length >= FILES_MAX) return;
      if (e.kind === 'dir') await walk(e.path, depth + 1); else out.push(e);
    }
  };
  await walk('', 0);
  return out;
}

const attachWith = async (lend, kind, ref, key, deps = {}) => {
  const built = buildContext(kind, ref, lend.state(), deps);
  if (!built) { lend.say('That item has nothing to attach.'); return false; }
  const r = await lend.attach(built, key);
  if (!r?.ok) { lend.say(r?.reason || 'Could not attach it.'); return false; }
  return true;
};

export async function attachFile(lend) {
  const files = await folderFiles();
  if (!files.length) { lend.say('Add a folder in Files first.'); return false; }
  const path = await pickOne({ id: 'attach-file', title: 'Attach a file', search: 'Search files', items: files.map(f => ({ value: f.path, title: f.name, detail: f.path })) });
  if (!path) return false;
  try {
    const ft = await fileText(path.split('/').pop(), await readPath(path));
    return attachWith(lend, 'file', { path, text: ft?.text || '' }, path);
  } catch (err) { lend.say(`Could not read the file: ${String(err?.message || err).slice(0, 120)}`); return false; }
}

export async function attachStudy(lend) {
  const records = (lend.state().papers || []);
  if (!records.length) { lend.say('The library has no studies yet.'); return false; }
  const id = await askRecord('Attach a study', { records });
  return id ? attachWith(lend, 'reference', { paperId: id }, id) : false;
}

/** A table or a figure of Tables and figures (saved or built in), drawn as it is now. */
export async function attachOutput(lend, kind) {
  const s = lend.state(), entries = [...(s.outputs || []), ...builtinOutputs(s)].filter(o => currentSpec(o)?.kind === kind);
  const noun = kind === 'chart' ? 'figure' : 'table';
  if (!entries.length) { lend.say(`There is no ${noun} yet.`); return false; }
  const id = await pickOne({ id: `attach-${noun}`, title: `Attach a ${noun}`, search: `Search ${noun}s`, items: entries.map(o => ({ value: o.id, title: currentSpec(o).title || o.id, detail: o.builtin ? 'Built in' : '' })) });
  if (!id) return false;
  const { renderOutput } = await import('./output-render.mjs');
  return attachWith(lend, 'output', { outputId: id }, id, { render: renderOutput });
}

export function attachPage(lend) {
  const { title, text } = lend.page() || {};
  return attachWith(lend, 'page', { title, text }, `page:${title}`);
}

/** The composer's Attach submenu: files first, as the references have it. */
export const ATTACH_ITEMS = Object.freeze([
  { id: 'file', label: 'File…', icon: 'paperclip' }, { id: 'study', label: 'Study…', icon: 'library' },
  { id: 'table', label: 'Table…', icon: 'table' }, { id: 'figure', label: 'Figure…', icon: 'image' }, { id: 'page', label: 'Current page', icon: 'file' },
]);
/** Attaches one kind of ATTACH_ITEMS. */
export function attachBy(id, lend) {
  if (id === 'file') return attachFile(lend);
  if (id === 'study') return attachStudy(lend);
  if (id === 'table') return attachOutput(lend, 'table');
  if (id === 'figure') return attachOutput(lend, 'chart');
  if (id === 'page') return attachPage(lend);
  return false;
}
