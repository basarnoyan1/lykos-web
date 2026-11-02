// Where a part of the package stands (plan, package amendment): what changed since its last build and whether it can be built. Pure, and
// light, so the Overview's Package row reads it without loading the package model's file naming (lib/folder-map.mjs); the view and the build
// reach the same functions through lib/package.mjs. A table or figure the app draws (`source.app`) changes with its data: partState compares
// the signature its build kept with the data now (lib/app-items.mjs appSig, given, or loaded on first use for a reader that cannot wait).
import { lib_lazy$lazyModule as lazyModule } from "../boot.mjs";
import { store$notify as notify } from "../boot.mjs";

/** A reference in a caption or a note: the manuscript's token `{{xref:<itemId>}}`. */
export const XREF = /\{\{xref:([A-Za-z0-9._-]+)\}\}/g;
const KIND_WORD = { table: 'Table', figure: 'Figure' };
/** Labels of every item ("Table S1"), or of one variant's items numbered within it. */
export function labels(pkg, { variant = null } = {}) {
  const out = new Map();
  // a document item (a generated log) is not numbered: its label is its title
  const number = (part, ids) => { const n = { table: Math.max(1, Number(part.numberFrom?.table) || 1) - 1, figure: Math.max(1, Number(part.numberFrom?.figure) || 1) - 1 }; for (const id of ids) { const it = pkg.items[id]; if (!it) continue; if (!(it.kind in n)) { out.set(id, it.title || 'Document'); continue; } n[it.kind]++; out.set(id, `${KIND_WORD[it.kind]} ${part.prefix || ''}${n[it.kind]}`); } };
  if (variant) { const part = partById(pkg, variant.partId), v = (part.variants || []).find(x => x.id === variant.variantId); if (v) number(part, part.items.filter(id => v.items.includes(id))); return out; }
  for (const part of pkg.parts) number(part, part.items);
  return out;
}
export const partById = (pkg, id) => { const p = pkg.parts.find(x => x.id === id); if (!p) throw new Error(`no part ${id}`); return p; };

const refsIn = it => [it.title, it.legend, ...(it.notes || [])].flatMap(t => [...String(t || '').matchAll(XREF)].map(m => m[1]));
export function danglingRefs(pkg, partId) {
  const part = partById(pkg, partId);
  return [...new Set(part.items.flatMap(id => refsIn(pkg.items[id] || {})).filter(id => !pkg.items[id]))];
}

/**
 * An item as a variant prints it: the variant's `overrides[itemId]` laid over the item (its `source` merged key by key), so a short version
 * can drop a column (`{ source: { fields, widths } }`) or its notes without a second copy of the item.
 */
export function variantItem(item, variant) {
  const o = item && variant?.overrides?.[item.id];
  if (!o) return item;
  return { ...item, ...o, ...(o.source ? { source: { ...(item.source || {}), ...o.source } } : {}) };
}
export function snapshotOf(pkg, partId, variantId = null) {
  const part = partById(pkg, partId), v = variantId ? (part.variants || []).find(x => x.id === variantId) : null;
  const ids = v ? part.items.filter(id => v.items.includes(id)) : part.items;
  return { part: { name: part.name, prefix: part.prefix, page: { ...part.page }, formats: [...part.formats], ...(part.numberFrom ? { numberFrom: { ...part.numberFrom } } : {}), ...(v ? { variant: { ...v } } : {}) },
    items: ids.map(id => variantItem(structuredClone(pkg.items[id]), v)).filter(Boolean) };
}
export function changesBetween(a, b) {
  const before = new Map(a.items.map((it, i) => [it.id, { it, i }])), after = new Map(b.items.map((it, i) => [it.id, { it, i }]));
  const c = { captions: 0, notes: 0, tables: 0, moved: 0, added: 0, removed: 0, page: JSON.stringify(a.part.page) !== JSON.stringify(b.part.page) ? 1 : 0 };
  for (const [id, x] of after) {
    const y = before.get(id);
    if (!y) { c.added++; continue; }
    if (x.it.title !== y.it.title || x.it.legend !== y.it.legend) c.captions++;
    if (JSON.stringify([x.it.notes, x.it.marks ?? null]) !== JSON.stringify([y.it.notes, y.it.marks ?? null])) c.notes++;   // a footnote's text or the cells that carry its mark
    // what a table is drawn from: its source, or the rows and columns kept of it (lib/package-select.mjs)
    if (x.it.kind === 'table' && JSON.stringify([x.it.source, x.it.keep ?? null]) !== JSON.stringify([y.it.source, y.it.keep ?? null])) c.tables++;
    if (x.i !== y.i) c.moved++;
  }
  for (const id of before.keys()) if (!after.has(id)) c.removed++;
  return c;
}
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
export function changesText(c) {
  return [c.data && `${n(c.data, 'item')} with new data`, c.captions && n(c.captions, 'caption'), c.notes && n(c.notes, 'note'), c.tables && `${n(c.tables, 'table')} redrawn`, c.moved && `${n(c.moved, 'item')} moved`,
    c.added && `${n(c.added, 'item')} added`, c.removed && `${n(c.removed, 'item')} removed`, c.page && 'page setup'].filter(Boolean).join(', ');
}

const signer = lazyModule(() => import('./app-items.mjs'), 'the drawings of the app');
/** `sigOf(key)` over the project `s` once lib/app-items.mjs is here; until then null, and the views repaint when it arrives. */
export function appSigner(s) {
  if (signer.ready()) return key => signer.module().appSig(s, key);
  signer.ensure().then(() => notify(), err => console.warn('[package]', err.message));
  return null;
}
const appKeys = it => (it?.source?.app ? [it.source.app] : Array.isArray(it?.source?.apps) ? it.source.apps : []);   // `app`, or `apps` (several drawings in one figure)
/** The signatures a build keeps for an item, by key: `app:<key>` for each drawing of the app, `evidence:<id>` for a table of the evidence table. */
export const sigKeys = it => [...appKeys(it).map(k => [`app:${k}`, k]), ...(it?.source?.evidence ? [[`evidence:${it.id}`, `evidence:${it.id}`]] : [])];
/**
 * Whether an item was drawn from the data as it is now: true where every signature its last build kept is the data's now, false where one
 * differs, null where the build kept none (a build that signed nothing, or an item the app does not draw). `sigOf(key)` signs the data now.
 */
export function itemCurrent(it, last, sigOf) {
  const kept = last?.sources || {}, keys = sigKeys(it).filter(([k]) => kept[k]);
  if (!keys.length || !sigOf) return null;
  return keys.every(([k, key]) => kept[k] === sigOf(key));
}
/** How many items of a part drawn by the app read data that changed since its last build (`sigOf(key)` signs the data now). */
export function dataChanges(pkg, part, last, sigOf) {
  if (!last || !sigOf) return 0;
  const kept = last.sources || {};
  return part.items.filter(id => sigKeys(pkg.items[id]).some(([k, key]) => kept[k] && kept[k] !== sigOf(key))).length;
}

/**
 * Where a part stands: a short state for its head (at most 24 characters: Built v3, Changed since v3, Never built, Cannot build) and what
 * lies behind it, for the line under the head. Read by Tables and figures, Show: Package and by the Overview's Package row. `state` is the
 * project, whose data a drawing of the app reads; `sigOf` signs it (else lib/app-items.mjs is loaded for it).
 */
export function partState(pkg, part, { state = null, sigOf = null } = {}) {
  const builds = pkg.builds?.[part.id] || [], last = builds.at(-1);
  const dangling = danglingRefs(pkg, part.id);
  if (dangling.length) return { state: 'Cannot build', detail: `${dangling.length === 1 ? '1 reference' : `${dangling.length} references`} to a removed item` };
  if (!last) return { state: 'Never built', detail: '' };
  const drawn = state && part.items.some(id => sigKeys(pkg.items[id]).length);
  const data = drawn ? dataChanges(pkg, part, last, sigOf || appSigner(state)) : 0;
  const what = changesText({ ...changesBetween(last.snapshot, snapshotOf(pkg, part.id)), data });
  return what ? { state: `Changed since v${last.version}`, detail: what } : { state: `Built v${last.version}`, detail: '' };
}
