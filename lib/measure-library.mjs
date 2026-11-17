// The person's measure library (owner, 2026-10-23: "we will use many of the things again and again in other papers like Cobb angle etc"):
// the named measures they extract (a count of a total, a change from one value to another, a number), kept once for every project on this
// machine, not in a project file. An entry says what a reader of a table needs and the data cannot say: the measure's own name and the
// names papers give it, its unit, which way is better, the values that are plausible, the scale it is drawn on, the heading it is read
// under, and the visual that draws it. Nothing here knows a measure: the library starts empty and learns from the person's projects
// (Data summary, Add to library); a seed file under assets/measures is imported only when the person asks.
//
// Pure functions over the document, plus `loadLibrary` and `saveLibrary` over localStorage (`lykos.measures`, as Ideas keep `lykos.ideas`),
// and `library()`, the document as last saved, for a view that draws often. The document is versioned: { format, measures, ...kept },
// an entry { id, name, synonyms[], type, unit, better, range, scale, group, visual, note, ...kept }; keys a later version adds are kept
// as they are, so an older build that edits the library loses nothing.

export const LIBRARY_KEY = 'lykos.measures';
export const LIBRARY_FORMAT = 1;
export const TYPES = Object.freeze(['tally', 'change', 'number']);
export const BETTER = Object.freeze(['lower', 'higher']);
/** The words for a type and a direction, as the interface says them. */
export const TYPE_WORDS = Object.freeze({ tally: 'Count of a total', change: 'Before and after', number: 'Number' });
export const BETTER_WORDS = Object.freeze({ lower: 'Lower is better', higher: 'Higher is better', '': 'Neither' });

const LIMIT = { name: 120, synonym: 120, synonyms: 40, unit: 24, group: 80, visual: 80, note: 400, measures: 2000 };
const str = (v, max) => (v == null ? '' : String(v)).replace(/\0/g, '').trim().slice(0, max);
const finite = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// ---- names and units --------------------------------------------------------------------------------------------------------------------

/**
 * A name as it is compared: case, accents and dashes do not count ("PI–LL", "PI-LL", "pi ll" are one), nor do brackets; `bare` also drops
 * what a bracket holds ("PI–LL (absolute value)" is PI–LL), which is the second chance a name has to match.
 */
export function foldName(s, { bare = false } = {}) {
  let t = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (bare) t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return t.replace(/[()[\]]/g, ' ').replace(/[\s‐-―−_/.,:-]+/g, ' ').trim();
}

// A unit as the library writes it: the spellings a paper uses for one unit are one. Unknown units are kept as written.
const UNIT_ALIASES = { '°': ['°', 'deg', 'degree', 'degrees'], mm: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'], cm: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  m: ['m', 'meter', 'meters', 'metre', 'metres'], months: ['mo', 'mos', 'month', 'months'], years: ['y', 'yr', 'yrs', 'year', 'years'], weeks: ['wk', 'wks', 'week', 'weeks'],
  days: ['d', 'day', 'days'], points: ['point', 'points', 'pts', 'pt'], '%': ['%', 'percent', 'per cent'] };
const ALIAS = new Map(Object.entries(UNIT_ALIASES).flatMap(([u, list]) => list.map(a => [a, u])));
/** The unit's canonical spelling ("degrees" -> "°", "yrs" -> "years"); empty for none, as written when unknown. */
export const canonicalUnit = u => { const t = str(u, LIMIT.unit); return ALIAS.get(t.toLowerCase()) || t; };
// units of one dimension, by how many of the first each is
const FACTOR = { mm: ['length', 1], cm: ['length', 10], m: ['length', 1000], days: ['time', 1], weeks: ['time', 7], months: ['time', 30.4375], years: ['time', 365.25] };
/** A value in another unit of the same dimension (5 cm in mm is 50); the value itself when the units are one; null when they do not convert. */
export function convertValue(v, from, to) {
  const a = canonicalUnit(from), b = canonicalUnit(to);
  if (!Number.isFinite(v)) return null;
  if (a === b) return v;
  const fa = FACTOR[a], fb = FACTOR[b];
  return fa && fb && fa[0] === fb[0] ? v * fa[1] / fb[1] : null;
}

// ---- the document -----------------------------------------------------------------------------------------------------------------------

const KNOWN = ['id', 'name', 'synonyms', 'type', 'unit', 'better', 'range', 'scale', 'group', 'visual', 'note'];
let serial = 0;
/** A new entry's id: the name's letters and a few that make it unique on this machine. */
export const newMeasureId = name => `m-${foldName(name).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'measure'}-${(Date.now() + serial++).toString(36).slice(-5)}`;

function rangeOf(r) {
  const [lo, hi] = Array.isArray(r) ? r.map(finite) : r && typeof r === 'object' ? [finite(r.min), finite(r.max)] : [null, null];
  if (lo == null && hi == null) return null;
  return lo != null && hi != null && lo > hi ? [hi, lo] : [lo, hi];
}
/** An entry as kept, every value clamped; null when it has no name. Keys this version does not know are kept. */
export function normaliseMeasure(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const name = str(x.name, LIMIT.name);
  if (!name) return null;
  const kept = Object.fromEntries(Object.entries(x).filter(([k]) => !KNOWN.includes(k)));
  const seen = new Set([foldName(name)]);
  const synonyms = (Array.isArray(x.synonyms) ? x.synonyms : typeof x.synonyms === 'string' ? x.synonyms.split(/[;\n]/) : []).map(s => str(s, LIMIT.synonym))
    .filter(s => s && !seen.has(foldName(s)) && seen.add(foldName(s))).slice(0, LIMIT.synonyms);
  const sc = rangeOf(x.scale);
  return { ...kept, id: str(x.id, 64) || newMeasureId(name), name, synonyms, type: TYPES.includes(x.type) ? x.type : 'number', unit: canonicalUnit(x.unit),
    better: BETTER.includes(x.better) ? x.better : null, range: rangeOf(x.range), scale: sc && sc[0] != null && sc[1] != null ? { min: sc[0], max: sc[1] } : null,
    group: str(x.group, LIMIT.group), visual: str(x.visual, LIMIT.visual) || 'auto', note: str(x.note, LIMIT.note) };
}
/** The library as kept: { format, measures } with every entry normalised and ids unique. An older shape (a bare list) is read as format 1. */
export function normaliseLibrary(doc) {
  const d = Array.isArray(doc) ? { measures: doc } : doc && typeof doc === 'object' ? doc : {};
  const kept = Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'format' && k !== 'measures'));
  const ids = new Set(), measures = [];
  for (const x of (Array.isArray(d.measures) ? d.measures : []).slice(0, LIMIT.measures)) {
    const m = normaliseMeasure(x);
    if (!m) continue;
    if (ids.has(m.id)) m.id = newMeasureId(m.name);
    ids.add(m.id); measures.push(m);
  }
  return { ...kept, format: Math.max(LIBRARY_FORMAT, Number(d.format) || 0), measures };
}
export const emptyLibrary = () => ({ format: LIBRARY_FORMAT, measures: [] });

// ---- recognition ------------------------------------------------------------------------------------------------------------------------

const namesOf = e => [e.name, ...(e.synonyms || [])];
const unitFits = (e, unit) => !unit || !e.unit || convertValue(1, unit, e.unit) != null;
/**
 * The entry a measure is, by its name or a synonym (case, accents, dashes and brackets aside), or null. When names match several entries
 * the one whose unit the value's converts to is chosen ("Age" in years over "Age" in months is the same; a unit that does not convert is
 * a weaker match, never a refusal: the name is what a paper calls it).
 */
export function matchMeasure(library, key, unit = '') {
  const list = library?.measures || [];
  if (!list.length || !String(key ?? '').trim()) return null;
  for (const bare of [false, true]) {
    const k = foldName(key, { bare });
    if (!k) continue;
    const hits = list.filter(e => namesOf(e).some(n => foldName(n, { bare }) === k));
    if (hits.length) return hits.find(e => unitFits(e, unit)) || hits[0];
  }
  return null;
}

/** What an analysis needs to know of a measure, or null when the library does not know it: { id, name, type, unit, better, range, scale, group, visual }. */
export function measureInfo(library, key, unit = '') {
  const e = matchMeasure(library, key, unit);
  return e ? Object.freeze({ id: e.id, name: e.name, type: e.type, unit: e.unit, better: e.better, range: e.range ? [...e.range] : null,
    scale: e.scale ? { ...e.scale } : null, group: e.group, visual: e.visual }) : null;
}

/** The numbers of a value the range bounds: a number's value, a change's two values, a count's share in percent. */
export function rangeValues(value) {
  if (!value) return [];
  if (value.type === 'number') return [value.value];
  if (value.type === 'change') return [value.from, value.to];
  if (value.type === 'tally') return value.N > 0 ? [100 * value.n / value.N] : [];
  return [];
}
/** Whether a value ({ type, ... } as lib/extraction-measures.mjs reads it, in the entry's unit) lies outside the entry's plausible range. */
export function outsideRange(entry, value) {
  const r = entry?.range;
  if (!r) return false;
  return rangeValues(value).some(v => Number.isFinite(v) && ((r[0] != null && v < r[0]) || (r[1] != null && v > r[1])));
}
/** The range in words, as a row says it ("0 to 100", "from 0", "up to 120"), with the unit. */
export function rangeText(entry) {
  const r = entry?.range;
  if (!r) return '';
  const u = entry.unit ? (/^[°%]/.test(entry.unit) ? entry.unit : ` ${entry.unit}`) : '';
  return r[0] != null && r[1] != null ? `${r[0]} to ${r[1]}${u}` : r[0] != null ? `from ${r[0]}${u}` : `up to ${r[1]}${u}`;
}

// ---- changes ----------------------------------------------------------------------------------------------------------------------------

/** A draft for a measure the library does not know, from a summarised measure ({ name, type, summary.unit }): its name, type and unit. */
export const draftOf = m => ({ name: m.name, type: TYPES.includes(m.type) ? m.type : 'number', unit: canonicalUnit(m.summary?.unit || m.unit || '') });

/** Adds entries; a draft whose name the library already knows is skipped. Returns { library, added: [ids] }. */
export function addMeasures(library, drafts) {
  const lib = normaliseLibrary(library), added = [];
  for (const d of drafts || []) {
    const m = normaliseMeasure({ ...d, id: d?.id && !lib.measures.some(x => x.id === d.id) ? d.id : undefined });
    if (!m || lib.measures.some(x => namesOf(x).some(n => foldName(n, { bare: true }) === foldName(m.name, { bare: true })))) continue;
    lib.measures.push(m); added.push(m.id);
  }
  return { library: lib, added };
}
/** One entry changed: the patch's values over the entry's, normalised. */
export function updateMeasure(library, id, patch) {
  const lib = normaliseLibrary(library);
  lib.measures = lib.measures.map(m => (m.id === id ? normaliseMeasure({ ...m, ...patch, id }) || m : m));
  return lib;
}
export const removeMeasure = (library, id) => { const lib = normaliseLibrary(library); lib.measures = lib.measures.filter(m => m.id !== id); return lib; };
/**
 * Two entries that are one measure: `keep` takes the other's name and synonyms as synonyms, and any value it lacks (unit, direction,
 * range, scale, group, a visual, a note); the other goes.
 */
export function mergeMeasures(library, keepId, otherId) {
  const lib = normaliseLibrary(library), keep = lib.measures.find(m => m.id === keepId), other = lib.measures.find(m => m.id === otherId);
  if (!keep || !other || keep === other) return lib;
  const merged = normaliseMeasure({ ...other, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v != null && v !== '' && v !== 'auto')),
    synonyms: [...keep.synonyms, other.name, ...other.synonyms], note: [keep.note, other.note].filter(Boolean).join(' ').slice(0, LIMIT.note) });
  lib.measures = lib.measures.filter(m => m.id !== otherId).map(m => (m.id === keepId ? merged : m));
  return lib;
}
/** Entries from a file or the seed, those whose name the library does not know yet. Returns { library, added }. */
export const importMeasures = (library, doc) => addMeasures(library, normaliseLibrary(doc).measures.map(({ id, ...m }) => m));

/** The headings in use, in the order the library first uses them. */
export const groupNames = library => [...new Set((library?.measures || []).map(m => m.group).filter(Boolean))];

/**
 * A field's measures under the library's headings, across fields: [{ group, rows: [{ field, measure, entry }] }], the headings in the
 * library's order, then the measures the library does not know (`unknown`, one per name, the field that holds it most first).
 */
export function byGroup(library, fields) {
  const order = groupNames(library), groups = new Map(), unknown = new Map();
  for (const f of fields || []) for (const m of f.measures?.measures || []) {
    if (m.entry) { const g = m.entry.group || ''; (groups.get(g) || groups.set(g, []).get(g)).push({ field: f, measure: m, entry: m.entry }); }
    else { const k = foldName(m.name, { bare: true }); if (!unknown.has(k)) unknown.set(k, { field: f, measure: m, key: k }); }
  }
  const named = [...order, ...[...groups.keys()].filter(g => !order.includes(g))].filter(g => groups.has(g));
  return { groups: named.map(group => ({ group, rows: groups.get(group) })), unknown: [...unknown.values()] };
}

// ---- storage ----------------------------------------------------------------------------------------------------------------------------

export function loadLibrary(store = globalThis.localStorage) {
  try { return normaliseLibrary(JSON.parse(store?.getItem(LIBRARY_KEY) || 'null')); } catch { return emptyLibrary(); }
}
let cached = null, stamp = 0;
const listeners = new Set();
export function saveLibrary(library, store = globalThis.localStorage) {
  const lib = normaliseLibrary(library);
  try { store?.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch { return false; }
  if (store === globalThis.localStorage) { cached = lib; stamp++; for (const fn of listeners) fn(lib); }
  return true;
}
/** The library as last saved on this machine (read once, then kept until a save here or in another window). */
export function library() {
  if (!cached) {
    cached = loadLibrary();
    globalThis.addEventListener?.('storage', e => { if (e.key === LIBRARY_KEY) { cached = null; stamp++; for (const fn of listeners) fn(library()); } });
  }
  return cached;
}
/** A number that changes whenever the library does: part of a cache key. */
export const libraryStamp = () => stamp;
/** Calls `fn(library)` after every change; returns the unsubscribe. */
export const onLibrary = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** The seed of common measures (assets/measures/common.json), for Import common measures. Nothing is added until the person asks. */
export async function seedMeasures() {
  const r = await fetch(new URL('../assets/measures/common.json', import.meta.url));
  if (!r.ok) throw Error(`The list of common measures did not load (${r.status})`);
  return normaliseLibrary(await r.json());
}
