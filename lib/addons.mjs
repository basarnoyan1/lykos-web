// Addons (github.com/basarnoyan1/lykos-addons, pinned in vendor.lock.json and shipped under addons/): their chart types join Tables and
// figures' own. An addon imports nothing from the app; a chart is drawn with the kit made here from the house figure style, so it looks
// like every other figure. Loaded when Tables and figures first needs a chart type (loadAddons); a build without addons has none.
// An addon module exports either or both of:
//   charts          [{ id, label, fields, options, help, draw(rows, opts) }]: chart types of Tables and figures
//   measureVisuals  [{ id, label, types, draw(measure, studies, opts) }]: a visual for a measure of the person's measure library
//                   (lib/measure-visuals.mjs; types are 'tally', 'change', 'number'; an entry chooses one by id in Settings > Measures;
//                   draw gets `opts.kit` as a chart does and returns SVG)
import { lib_html$esc as esc } from "../boot.mjs";
import { registerMeasureVisual, dropAddonVisuals } from './measure-visuals.mjs';

const charts = new Map();   // chart type -> { id, label, fields, options, help, draw, addon }
let loading = null, catalogLoad = null;
const BASE = () => new URL('../addons/', import.meta.url);
/** The addons a person turned off on this Mac (Settings > Extensions); every addon runs unless it is listed here. */
const OFF_KEY = 'lykos.addons.off';
export function addonsOff() {
  try { return new Set(JSON.parse(globalThis.localStorage?.getItem(OFF_KEY) || '[]')); } catch { return new Set(); }
}
/** The addons this build carries: [{ id, name, version, about, gives, credits }], none when it carries none. */
export function addonCatalog() {
  return catalogLoad ||= (async () => {
    try { const r = await fetch(new URL('catalog.json', BASE())); return r.ok ? ((await r.json())?.addons || []) : []; } catch { return []; }
  })();
}
/** Turns an addon on or off: its chart types join Tables and figures, or leave it, at once; the choice is kept on this Mac. */
export async function setAddonOn(id, on) {
  const off = addonsOff();
  if (on) off.delete(id); else off.add(id);
  try { globalThis.localStorage?.setItem(OFF_KEY, JSON.stringify([...off])); } catch { /* a private window keeps it for the session only */ }
  if (!on) { for (const [k, c] of charts) if (c.addon === id) charts.delete(k); dropAddonVisuals(id); return; }
  const a = (await addonCatalog()).find(x => x.id === id);
  if (a && ![...charts.values()].some(c => c.addon === id)) registerAddon(id, await import(new URL(a.entry, BASE()).href));
}

/** An addon module's charts and measure visuals into their registries (the loader's, and the tests'). */
export function registerAddon(id, mod) {
  for (const c of mod?.charts || []) if (c?.id && typeof c.draw === 'function') charts.set(c.id, { ...c, options: c.options || [], addon: id });
  for (const v of mod?.measureVisuals || []) if (v?.id && typeof v.draw === 'function')
    registerMeasureVisual(v.id, { label: v.label, types: v.types || [], addon: id, draw: (measure, studies, opts = {}) => v.draw(measure, studies, { ...opts, kit: opts.kit || kitFor(opts.style) }) });
}
/** The catalog's addons, once: their chart types registered. Answers the chart types; none when the build carries no addons. */
export function loadAddons() {
  return loading ||= (async () => {
    const base = BASE(), off = addonsOff();
    for (const a of await addonCatalog()) {
      if (off.has(a.id)) continue;   // turned off in Settings > Extensions
      try { registerAddon(a.id, await import(new URL(a.entry, base).href)); } catch (err) { console.warn('[addon]', a.id, err?.message || err); }
    }
    return addonCharts();
  })();
}
export const addonChart = type => charts.get(type) || null;

// A few rows to draw each chart type with on its extension's page (Settings > Extensions): a chart's own `example` rows when it gives them,
// else these, by chart type; a type with neither shows no preview.
const EXAMPLE = {
  'spine-levels': [{ x: 'L3-L4' }, { x: 'L4-L5' }, { x: 'L4-L5' }, { x: 'L5-S1' }],
  'sagittal-alignment': [{ x: 'Mean', pi: 55, llPre: 35, llPost: 50, ptPre: 28, ptPost: 20, svaPre: 80, svaPost: 35 }],
  'cranial-location': [{ x: 'frontal' }, { x: 'third ventricle' }, { x: 'parietal' }],
  'outcome-scale': [{ x: 'Before', y: 48, scale: 'odi' }, { x: '6 months', y: 30, scale: 'odi' }, { x: '12 months', y: 24, scale: 'odi' }],
};
/** An addon's chart types, each with the SVG of its preview ('' when it has no example rows or cannot draw): [{ id, label, help, svg }]. */
export async function addonPreviews(id, { width = 320, style = null } = {}) {
  const a = (await addonCatalog()).find(x => x.id === id);
  if (!a) return [];
  const mod = await import(new URL(a.entry, BASE()).href);
  return (mod.charts || []).filter(c => c?.id && typeof c.draw === 'function').map(c => {
    const rows = c.example || EXAMPLE[c.id], keys = rows ? Object.keys(rows[0] || {}) : [];
    let svg = '';
    if (rows) try {
      const field = k => (rows.some(r => k in r) ? rows.map(r => r[k]) : null), chart = Object.fromEntries(keys.map(k => [k, k]));
      const out = c.draw({ field, n: rows.length, title: '', width, kit: kitFor(style), chart: { type: c.id, ...chart } });
      svg = typeof out === 'string' ? out : out?.svg || '';
    } catch { svg = ''; }
    return { id: c.id, label: c.label || c.id, help: c.help || '', svg };
  });
}
export const addonCharts = () => [...charts.values()];

const toNumber = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.').replace(/[^\d.eE+-]/g, '')); return Number.isFinite(n) ? n : null; };
/** What a chart is drawn with: escaping, numbers, and the house style's font, sizes, colours and ramp (neutral defaults without one). */
export function kitFor(style) {
  const c = style?.color || {};
  return { esc, num: toNumber, font: style?.font || 'Geist, Helvetica, Arial, sans-serif', size: { label: style?.size?.label || 12, small: style?.size?.small || 11 },
    weight: { head: style?.weight?.head || 600 },
    color: { ink: c.ink || '#202735', ink2: c.ink2 || '#536076', hair: c.hair || '#d9dfe8', axis: c.axis || '#a6b0c0', fill: c.fill || '#eef0f4', mark: c.mark || '#536076', band: c.band || '#eef0f4', page: c.page || '#ffffff' },
    cat: style?.cat?.length ? [...style.cat] : ['#202735', '#536076', '#93a0b4'] };
}
