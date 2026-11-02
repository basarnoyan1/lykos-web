// Visuals for a measure of the library (lib/measure-library.mjs): the extension point for a figure made for one measure, a Cobb angle
// drawn on a spine, an ODI on its bands (owner, 2026-10-23: "they can even get their own visualizers in the future"). A visual is
// registered by id with the types of measure it draws and `draw(measure, studies, opts) -> svg`:
//   measure  the summarised measure ({ key, name, type, summary, entry }), entry being the library's entry when it knows the measure
//   studies  [{ label, value, attrs }], one per study that gives it: value as lib/extraction-measures.mjs reads it, in the entry's unit,
//            attrs the caller's data attributes for the study's mark (a press opens that study)
//   opts     { width, title, unit, scale, better, range, kit? }; an addon's draw also gets `kit` (lib/addons.mjs kitFor)
// An addon gives visuals as `export const measureVisuals = [{ id, label, types, draw }]` (lib/addons.mjs registerAddon); an entry names
// one in `visual`. No import here: the generic visuals register themselves from lib/measure-visuals-generic.mjs, so this registry
// costs nothing to a module that only registers.

const visuals = new Map();   // id -> { id, label, types, draw, addon }
/** Registers (or replaces) a visual. `types` lists the measure types it draws ('tally', 'change', 'number'). */
export function registerMeasureVisual(id, { label = '', types = [], draw, addon = '' } = {}) {
  if (!id || typeof draw !== 'function') return false;
  visuals.set(String(id), { id: String(id), label: String(label || id), types: [...types].filter(t => ['tally', 'change', 'number'].includes(t)), draw, addon: String(addon || '') });
  return true;
}
/** Removes an addon's visuals (the addon was turned off). */
export function dropAddonVisuals(addon) { for (const [k, v] of visuals) if (v.addon === addon) visuals.delete(k); }
export const measureVisual = id => visuals.get(String(id)) || null;
/** The visuals that draw a type, the generic one first: what a library entry may choose. */
export const measureVisuals = (type = '') => [...visuals.values()].filter(v => !type || v.types.includes(type)).sort((a, b) => (b.id.startsWith('auto:') - a.id.startsWith('auto:')) || a.label.localeCompare(b.label));
/** The generic visual's id for a type: auto:change, auto:tally, auto:number. */
export const genericVisual = type => `auto:${type}`;

/**
 * The visual that draws a measure: the entry's own when it is registered and draws this type, else the generic one for the type (a
 * slope chart for a change, a rate chart for a count, a dot plot for a number), else null.
 */
export function visualFor(entry, type = entry?.type) {
  const own = entry?.visual && entry.visual !== 'auto' ? visuals.get(entry.visual) : null;
  if (own && own.types.includes(type)) return own;
  return visuals.get(genericVisual(type)) || null;
}
/** Whether the entry names a visual that is not registered yet (an addon not loaded): the caller may load the addons and draw again. */
export const visualMissing = entry => !!entry?.visual && entry.visual !== 'auto' && !visuals.has(entry.visual);
