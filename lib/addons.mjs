// Addons (github.com/basarnoyan1/lykos-addons, pinned in vendor.lock.json and shipped under addons/): their chart types join Tables and
// figures' own. An addon imports nothing from the app; a chart is drawn with the kit made here from the house figure style, so it looks
// like every other figure. Loaded when Tables and figures first needs a chart type (loadAddons); a build without addons has none.
// An addon module exports either or both of:
//   charts          [{ id, label, fields, options, help, draw(rows, opts) }]: chart types of Tables and figures
//   measureVisuals  [{ id, label, types, draw(measure, studies, opts) }]: a visual for a measure of the person's measure library
//                   (lib/measure-visuals.mjs; types are 'tally', 'change', 'number'; an entry chooses one by id in Settings > Measures;
//                   draw gets `opts.kit` as a chart does and returns SVG)
//   journalStyles   [{ id, label, journals, family, profile, references, page, columns, gap, stylesheet, fonts, first(kit), footer(kit, page),
//                   source, panels, citeAfterPunctuation, decimalMark, correspondenceLabel, table }]: a journal's pages for Manuscript › View › Journal (views/journal-preview.mjs). `journals` names what it lays
//                   out (journal names, NLM abbreviations, preset ids, profile names); `page` is the trim in CSS px ({ width, height, margin:
//                   [top, right, bottom, left] }); `stylesheet` a CSS file beside the module; `first` answers the first page's HTML with
//                   slots for the parts (kit: journalKitFor). Styles load only when the Manuscript page asks (loadJournalStyles).
//                   Optional, how the journal prints the text (lib/journal-text.mjs; display only, the manuscript is not changed): `references`
//                   'ama' | 'vancouver' | 'lancet'; `panels` headings set in a box (div.nj-panel) with what belongs to them; `citeAfterPunctuation`
//                   true puts citation numbers after the mark that follows them; `decimalMark` the character shown for a decimal point
//                   between digits ('\u00b7'); `correspondenceLabel` the label that replaces "Correspondence:".
//                   `panelLabel` ('Panel') the word a numbered or titled panel's heading begins with ("Panel: …", "Panel 2: …": set in a box too);
//                   `panelWhole` true never cuts a panel that fits a column or a page (views/journal-preview.mjs).
//                   `table` how the journal sets a table (lib/journal-table.mjs: the title over it or under its legend, widths by content, its
//                   measures, a turned page, decimal alignment, its words where it runs over a page); a style without it has its tables as before.
import { lib_html$esc as esc } from "../boot.mjs";
import { registerMeasureVisual, dropAddonVisuals } from './measure-visuals.mjs';
import { journalKey, findPreset } from './journal-presets.mjs';
import { profileById } from './journal-profiles.mjs';
import { formatReference } from './cite.mjs';

const charts = new Map();   // chart type -> { id, label, fields, options, help, draw, addon }
const journalStyles = new Map();   // style id -> { ...style, addon, base }
let loading = null, catalogLoad = null, stylesLoading = null, stylesLoaded = false;
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
  if (!on) {
    for (const [k, c] of charts) if (c.addon === id) charts.delete(k);
    for (const [k, s] of journalStyles) if (s.addon === id) journalStyles.delete(k);
    dropAddonVisuals(id); return;
  }
  const a = (await addonCatalog()).find(x => x.id === id);
  if (a && ![...charts.values(), ...journalStyles.values()].some(c => c.addon === id)) { const href = new URL(a.entry, BASE()).href; registerAddon(id, await import(href), href); }
}

/** An addon module's charts, measure visuals and journal styles into their registries (the loader's, and the tests'). `href` is the
 *  module's address, which a journal style's stylesheet and fonts are found beside. */
export function registerAddon(id, mod, href = null) {
  for (const c of mod?.charts || []) if (c?.id && typeof c.draw === 'function') charts.set(c.id, { ...c, options: c.options || [], addon: id });
  for (const v of mod?.measureVisuals || []) if (v?.id && typeof v.draw === 'function')
    registerMeasureVisual(v.id, { label: v.label, types: v.types || [], addon: id, draw: (measure, studies, opts = {}) => v.draw(measure, studies, { ...opts, kit: opts.kit || kitFor(opts.style) }) });
  for (const s of mod?.journalStyles || []) if (s?.id && Array.isArray(s.journals) && s.journals.length && s.page?.width > 0 && s.page?.height > 0 && typeof s.first === 'function')
    journalStyles.set(s.id, { ...s, addon: id, base: href });
}
const gives = (a, ...kinds) => !Array.isArray(a.gives) || a.gives.some(g => kinds.includes(g));
/** The catalog's addons that give one of `kinds`, once each: imported and registered (an addon that cannot load is skipped with a warning). */
async function importAddons(kinds) {
  const base = BASE(), off = addonsOff();
  for (const a of await addonCatalog()) {
    if (off.has(a.id) || !gives(a, ...kinds)) continue;   // turned off in Settings > Extensions, or gives nothing asked for
    try { const href = new URL(a.entry, base).href; registerAddon(a.id, await import(href), href); } catch (err) { console.warn('[addon]', a.id, err?.message || err); }
  }
}
/** The catalog's addons, once: their chart types registered. Answers the chart types; none when the build carries no addons. */
export function loadAddons() {
  return loading ||= importAddons(['charts', 'measureVisuals']).then(addonCharts);
}
/** The journal styles the addons give, once (Manuscript › View › Journal): answers them; none when the build carries no addons. */
export function loadJournalStyles() {
  return stylesLoading ||= importAddons(['journalStyles']).then(() => { stylesLoaded = true; return [...journalStyles.values()]; });
}
/** Whether loadJournalStyles has answered, so a page knows that "no style" is final and not "not loaded yet". */
export const journalStylesLoaded = () => stylesLoaded;
/**
 * The style that lays out a journal's pages: by the target journal (its name, or the preset it names, with the preset's id and aliases),
 * else by the journal profile a registered manuscript was checked against. Whole names only, compared as journalKey compares them
 * ("Neurology®" is Neurology; "Neurology Clinical Practice" is not). Null when no loaded style names it.
 */
export function journalStyleFor({ journal = '', profile = '' } = {}) {
  const preset = journal ? findPreset(journal) : null;
  for (const names of [[journal, ...(preset ? [preset.id, preset.label, ...(preset.aliases || [])] : [])], [profile]]) {
    const keys = new Set(names.map(journalKey).filter(Boolean));
    if (!keys.size) continue;
    for (const s of journalStyles.values()) if (s.journals.some(n => keys.has(journalKey(n)))) return s;
  }
  return null;
}
/** The journal styles registered now (Settings > Extensions lists them with their addon). */
export const addonJournalStyles = () => [...journalStyles.values()];
export const addonChart = type => charts.get(type) || null;

// The rows each chart type is drawn with on its extension's page (Settings > Extensions): a chart's own `example` rows when it gives them,
// else these, by chart type, a small cohort each so a preview shows what the chart does with real spread (one "Mean" row drew n = 1 and
// Schwab counts of 0→1: owner, 15 Nov 2026); a type with neither shows no preview. A key the chart takes as an option (its `options`, as
// outcome-scale's `scale`) is passed as the first row's value, not as a column name.
const cohort = (keys, rows) => rows.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
const EXAMPLE = {
  'spine-levels': cohort(['x', 'series'], [['L4-L5', 'Fusion'], ['L4-L5', 'Fusion'], ['L4-L5', 'Fusion'], ['L4-S1', 'Fusion'], ['L4-S1', 'Fusion'],
    ['L5-S1', 'Fusion'], ['L5-S1', 'Fusion'], ['L3-L5', 'Fusion'], ['L3-S1', 'Fusion'], ['L3-L4', 'Fusion'], ['L2-L4', 'Fusion'], ['L4-L5', 'Fusion'],
    ['L4-L5', 'Dynamic'], ['L4-L5', 'Dynamic'], ['L4-L5', 'Dynamic'], ['L3-L4', 'Dynamic'], ['L3-L5', 'Dynamic'], ['L5-S1', 'Dynamic'], ['L4-L5', 'Dynamic'],
    ['L2-L3', 'Dynamic']]),
  'sagittal-alignment': cohort(['x', 'pi', 'llPre', 'llPost', 'ptPre', 'ptPost', 'svaPre', 'svaPost'], [
    ['P1', 52, 38, 50, 22, 17, 45, 18], ['P2', 61, 35, 55, 31, 22, 92, 34], ['P3', 48, 40, 46, 18, 15, 30, 12], ['P4', 66, 32, 58, 35, 24, 128, 41],
    ['P5', 57, 44, 53, 24, 19, 52, 22], ['P6', 70, 38, 60, 38, 27, 146, 58], ['P7', 55, 30, 49, 27, 18, 74, 26], ['P8', 63, 45, 57, 29, 21, 66, 30],
    ['P9', 50, 33, 47, 21, 16, 58, 20], ['P10', 68, 41, 56, 33, 26, 110, 49], ['P11', 59, 36, 54, 26, 20, 81, 28], ['P12', 46, 37, 44, 17, 14, 38, 15]]),
  'cranial-location': ['frontal', 'frontal convexity', 'left frontal', 'parietal', 'right parietal', 'temporal', 'third ventricle', 'cerebellum']
    .map(x => ({ x })),
  'outcome-scale': [['Fusion', [52, 46, 58, 41, 49, 55, 44, 50], [31, 28, 36, 24, 30, 34, 27, 29], [24, 22, 30, 18, 25, 27, 21, 23]],
    ['Dynamic', [47, 54, 42, 50, 45, 51, 48], [37, 41, 33, 38, 35, 39, 36], [33, 38, 30, 35, 32, 36, 34]]]
    .flatMap(([series, ...times]) => times.flatMap((ys, t) => ys.map(y => ({ x: ['Before', '6 months', '12 months'][t], y, series, scale: 'odi' })))),
};
/** One chart type's preview: { id, label, help, svg, note } drawn `width` pixels wide (svg '' when it has no example rows or cannot draw). */
export function addonPreview(c, { width = 320, style = null } = {}) {
  const rows = c.example || EXAMPLE[c.id], keys = rows ? Object.keys(rows[0] || {}) : [], opts = new Set(c.options || []);
  let svg = '', note = '';
  if (rows) try {
    const field = k => (rows.some(r => k in r) ? rows.map(r => r[k]) : null), chart = Object.fromEntries(keys.map(k => [k, opts.has(k) ? rows[0][k] : k]));
    const out = c.draw({ field, n: rows.length, title: '', width, kit: kitFor(style), chart: { type: c.id, ...chart } });
    svg = typeof out === 'string' ? out : out?.svg || ''; note = typeof out === 'string' ? '' : out?.note || '';
  } catch { svg = ''; }
  return { id: c.id, label: c.label || c.id, help: c.help || '', svg, note };
}
/** An addon's chart types, each with the SVG of its preview: [{ id, label, help, svg }]. */
export async function addonPreviews(id, { width = 320, style = null } = {}) {
  const a = (await addonCatalog()).find(x => x.id === id);
  if (!a) return [];
  const mod = await import(new URL(a.entry, BASE()).href);
  return (mod.charts || []).filter(c => c?.id && typeof c.draw === 'function').map(c => addonPreview(c, { width, style }));
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

/**
 * What a journal style lays its pages out with, as kitFor is what a chart is drawn with: escaping; the manuscript's parts (`parts`:
 * title, authors, affiliations, correspondence, abstract, glossary, body, as views/journal-preview.mjs journalParts splits the
 * document model); the target journal's name; the journal profiles (`profileById`, lib/journal-profiles.mjs) with the style's own
 * profile resolved (`profile`); and the reference formatters (`ama`, `vancouver`, `lancet`: lib/cite.mjs formatReference, one record of the
 * project's library in, plain text out).
 */
export function journalKitFor({ style = null, parts = null, journal = '', version = '' } = {}) {
  return { esc, parts, journal: journal || style?.label || '', version, profileById, profile: style?.profile ? profileById(style.profile) : null,
    ama: p => formatReference(p, 'ama'), vancouver: p => formatReference(p, 'vancouver'), lancet: p => formatReference(p, 'lancet') };
}
