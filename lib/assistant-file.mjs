// A per-turn capability for exactly the file the user opened. No model-supplied
// path can redirect this reader to a sibling file or an arbitrary disk path.
import { fileText, SUPPORTED, extOf } from './filetext.mjs';
import { TEXT_EXT } from './workspace.mjs';

export function createAssistantFile(folder, path, { name = path.split('/').pop(), extract = fileText } = {}) {
  if (!folder || !path || (!SUPPORTED.includes(extOf(name)) && !TEXT_EXT.has(extOf(name)))) return null;
  let pending;
  const read = () => pending ||= (async () => {
    const stat = await folder.stat(path);
    if (!stat?.exists || stat.dir) throw new Error('The open file is no longer available.');
    if (stat.size > 64 * 1024 * 1024) throw new Error('The open file exceeds the 64 MB text-reading limit.');
    const bytes = await folder.read(path);
    if (bytes.length > 64 * 1024 * 1024) throw new Error('The open file exceeds the 64 MB text-reading limit.');
    const ft = SUPPORTED.includes(extOf(name)) ? await extract(name, bytes)
      : { text: new TextDecoder().decode(bytes), locators: [] };
    if (!ft.text.replace(/\[\[page \d+\]\]/g, '').trim()) throw new Error('No extractable text found. This file may need OCR; its contents cannot be inferred from its name.');
    return ft;
  })();
  return { name, path, async read({ offset = 0, limit = 12000, page = null, query = '' } = {}) {
    const ft = await read();
    let start = Math.min(ft.text.length, Math.max(0, Math.floor(Number(offset) || 0)));
    if (page != null) {
      const locator = ft.locators.find(l => l.page === Number(page));
      if (!locator) throw new Error('That page is not present in the open file.');
      start = locator.start;
    }
    if (query) {
      const found = ft.text.toLowerCase().indexOf(String(query).toLowerCase(), start);
      if (found < 0) return { name, total: ft.text.length, text: '', matches: 0, next_offset: null, locators: [] };
      start = Math.max(0, found - 400);
    }
    const count = Math.min(20000, Math.max(1, Math.floor(Number(limit) || 12000)));
    const end = Math.min(ft.text.length, start + count);
    return { name, offset: start, total: ft.text.length, text: ft.text.slice(start, end),
      next_offset: end < ft.text.length ? end : null,
      locators: ft.locators.filter(l => l.end > start && l.start < end).slice(0, 100),
      page_count: ft.locators.reduce((n, l) => Math.max(n, l.page || 0), 0) || undefined,
      content_basis: 'Saved file content; unsaved editor changes are not included' };
  } };
}
