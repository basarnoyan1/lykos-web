// The package (plan, package amendment): a paper's tables and figures arranged in parts, each part one document (Main tables, Main figures,
// Supplement), with the captions, notes and page settings Lykos owns. Pure: the view and the build call these and store what comes back.
// A number is never stored: it is an item's place among the items of its kind in its part (or variant), so a move can leave no stale label.
// A reference is the manuscript's token `{{xref:<itemId>}}` and reads as the item's label wherever it is now.
import { parseVersionFull } from './folder-map.mjs';
import { XREF, partById } from './package-state.mjs';
// an item's label is its place among its part's items of its kind (lib/package-state.mjs, light, so the manuscript's numbering reads it)
export { labels } from './package-state.mjs';
// what changed since a build, and where a part stands, live in lib/package-state.mjs (no imports, so the Overview reads them)
export { danglingRefs, snapshotOf, changesBetween, changesText, partState } from './package-state.mjs';

export const DEFAULT_PAGE = Object.freeze({ size: 'A4', orient: 'portrait', font: 'Arial', pt: 10, spacing: 1 });
const KIND_WORD = { table: 'Table', figure: 'Figure' };
let seq = 0;
const newId = p => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);

export const emptyPackage = () => ({ parts: [], items: {}, builds: {} });
export const stemKey = file => `${dirOf(file)}/${parseVersionFull(baseOf(file)).stem}`.toLowerCase();
export const seqName = (kind, prefix = '') => `${KIND_WORD[kind]}${prefix ? `_${prefix}` : ''}`;
export const partOf = (pkg, itemId) => pkg.parts.find(p => p.items.includes(itemId)) || null;

export function addPart(pkg, { name, prefix = '', file, page = DEFAULT_PAGE, formats = ['docx'] }) {
  const clash = pkg.parts.find(p => stemKey(p.file) === stemKey(file));
  if (clash) throw new Error(`${baseOf(file)} is already the file of ${clash.name}`);
  const part = { id: newId('pt'), name, prefix, file, page: { ...DEFAULT_PAGE, ...page }, formats: [...formats], items: [], variants: [] };
  pkg.parts.push(part);
  return part;
}
export function setPart(pkg, partId, patch) {
  const part = partById(pkg, partId);
  if (patch.file && pkg.parts.some(p => p.id !== partId && stemKey(p.file) === stemKey(patch.file))) throw new Error(`${baseOf(patch.file)} is another part's file`);
  Object.assign(part, patch);
  return pkg;
}
export function removePart(pkg, partId) {
  const part = partById(pkg, partId);
  for (const id of part.items) delete pkg.items[id];
  pkg.parts = pkg.parts.filter(p => p.id !== partId);
  return pkg;
}
export function addItem(pkg, partId, fields, at = Infinity) {
  const part = partById(pkg, partId);
  const item = { id: newId('it'), kind: fields.kind, source: fields.source, title: fields.title || '', legend: fields.legend || '', notes: [...(fields.notes || [])],
    ...(fields.orient ? { orient: fields.orient } : {}), ...(fields.samePage ? { samePage: true } : {}) };
  pkg.items[item.id] = item;
  part.items.splice(Math.min(at, part.items.length), 0, item.id);
  return item;
}
export function moveItem(pkg, itemId, partId, index) {
  const from = partOf(pkg, itemId), to = partById(pkg, partId);
  if (from) { from.items = from.items.filter(x => x !== itemId); for (const v of from.variants || []) if (from !== to) v.items = v.items.filter(x => x !== itemId); }
  to.items.splice(Math.max(0, Math.min(index, to.items.length)), 0, itemId);
  return pkg;
}
export function removeItem(pkg, itemId) {
  const part = partOf(pkg, itemId);
  if (part) { part.items = part.items.filter(x => x !== itemId); for (const v of part.variants || []) v.items = v.items.filter(x => x !== itemId); }
  delete pkg.items[itemId];
  return pkg;
}
export function setItem(pkg, itemId, patch) {
  if (!pkg.items[itemId]) throw new Error(`no item ${itemId}`);
  Object.assign(pkg.items[itemId], patch);
  for (const k of ['orient', 'samePage', 'keep']) if (patch[k] === undefined && k in patch) delete pkg.items[itemId][k];
  return pkg;
}

/** A caption's or note's text with each reference as the item's label now; `missing` for an item no longer in the package. */
export const plainText = (text, labelOf, missing = '[removed item]') => String(text || '').replace(XREF, (_, id) => labelOf(id) || missing);
