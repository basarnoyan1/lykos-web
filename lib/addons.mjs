// Addons (github.com/basarnoyan1/lykos-addons, pinned in vendor.lock.json and shipped under addons/): their chart types join Tables and
// figures' own. An addon imports nothing from the app; a chart is drawn with the kit made here from the house figure style, so it looks
// like every other figure. Loaded when Tables and figures first needs a chart type (loadAddons); a build without addons has none.
import { esc } from './html.mjs';

const charts = new Map();   // chart type -> { id, label, fields, options, help, draw, addon }
let loading = null;

/** An addon module's charts into the registry (the loader's, and the tests'). */
export function registerAddon(id, mod) {
  for (const c of mod?.charts || []) if (c?.id && typeof c.draw === 'function') charts.set(c.id, { ...c, options: c.options || [], addon: id });
}
/** The catalog's addons, once: their chart types registered. Answers the chart types; none when the build carries no addons. */
export function loadAddons() {
  return loading ||= (async () => {
    const base = new URL('../addons/', import.meta.url);
    let catalog = null;
    try { const r = await fetch(new URL('catalog.json', base)); if (r.ok) catalog = await r.json(); } catch { /* no addons in this build */ }
    for (const a of catalog?.addons || []) {
      try { registerAddon(a.id, await import(new URL(a.entry, base).href)); } catch (err) { console.warn('[addon]', a.id, err?.message || err); }
    }
    return addonCharts();
  })();
}
export const addonChart = type => charts.get(type) || null;
export const addonCharts = () => [...charts.values()];

const toNumber = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.').replace(/[^\d.eE+-]/g, '')); return Number.isFinite(n) ? n : null; };
/** What a chart is drawn with: escaping, numbers, and the house style's font, sizes, colours and ramp (neutral defaults without one). */
export function kitFor(style) {
  const c = style?.color || {};
  return { esc, num: toNumber, font: style?.font || 'IBM Plex Sans, Helvetica, Arial, sans-serif', size: { label: style?.size?.label || 12, small: style?.size?.small || 11 },
    weight: { head: style?.weight?.head || 600 },
    color: { ink: c.ink || '#202735', ink2: c.ink2 || '#536076', hair: c.hair || '#d9dfe8', axis: c.axis || '#a6b0c0', fill: c.fill || '#eef0f4', mark: c.mark || '#536076', band: c.band || '#eef0f4', page: c.page || '#ffffff' },
    cat: style?.cat?.length ? [...style.cat] : ['#202735', '#536076', '#93a0b4'] };
}
