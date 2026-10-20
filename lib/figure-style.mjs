// Figure style: the profile model of the figure feature (plan §4.15c.2).
// Pure: no DOM, no font, no file, no clock. A style document is the JSON a
// project keeps in .lykos/figure-style.json; this module checks it, hashes a
// profile, reads tokens from it and reports how faithfully its fonts can be
// drawn. Renderers receive tokens and a `style` option and never read files.
//
//   validateStyle(doc)              -> { ok, doc, errors, warnings, readOnly, notice }
//   canonicalHash(profile)          -> sha256 hex of the profile's canonical JSON
//   stampProfile(profile, previous) -> the profile with hash and version set
//   diffProfiles(a, b)              -> [{ path, before, after }]
//   tokensFor(doc, role, options)   -> { font, size, color, line, mark, row, pad, unit, widthIn, dpi, metrics, id, version, hash, ... }
//   figureTokens(doc, { medium })   -> the token set a house renderer draws with, or null for the neutral profile
//   resolveFonts(profile, available)-> { fidelity, faces, metrics, ... }
//   textWidth(s, size, metrics)     -> width, the Helvetica table when no metrics
import { sha256 } from './allocation.mjs';
import { textWidth } from './textwidth.mjs';
import { PRESETS, DEFAULT_ACTIVE, NEUTRAL } from './figure-presets.mjs';

export { textWidth };
export const SCHEMA = 1;
/** Lykos never draws text smaller than this, in the profile's unit (plan §4.15c.2, size.min). */
export const MIN_SIZE = 4.5;
const HASH_EXCLUDED = ['id', 'label', 'version', 'hash'];
const HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---- canonical form and hash -------------------------------------------------------
/** JSON with object keys sorted at every depth and undefined dropped, so key order never changes a hash. */
export function canonicalJson(value) {
  const walk = v => Array.isArray(v) ? v.map(x => walk(x === undefined ? null : x))
    : isObj(v) ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, walk(v[k])]))
    : v;
  return JSON.stringify(walk(value));
}
const hashCache = new WeakMap();
/** sha256 of a profile's canonical JSON without id, label, version and hash. */
export function canonicalHash(profile) {
  if (!isObj(profile)) throw new TypeError('canonicalHash needs a profile object');
  if (Object.isFrozen(profile) && hashCache.has(profile)) return hashCache.get(profile);
  const body = Object.fromEntries(Object.entries(profile).filter(([k]) => !HASH_EXCLUDED.includes(k)));
  const h = sha256(canonicalJson(body));
  if (Object.isFrozen(profile)) hashCache.set(profile, h);
  return h;
}
/**
 * Sets `hash` from the content and `version`: one more than `previous` when
 * the content differs from it, the same when it does not, the profile's own
 * (at least 1) when there is no previous. The previous hash is recomputed from
 * its content, never trusted.
 */
export function stampProfile(profile, previous = null) {
  const hash = canonicalHash(profile);
  let version = Number.isInteger(profile.version) && profile.version >= 1 ? profile.version : 1;
  if (isObj(previous)) {
    const pv = Number.isInteger(previous.version) && previous.version >= 1 ? previous.version : 1;
    version = canonicalHash(previous) === hash ? pv : pv + 1;
  }
  return { ...profile, version, hash };
}

// ---- differences -------------------------------------------------------------------
/** Leaf-by-leaf differences between two profiles, by dotted path, ignoring id, label, version and hash. Arrays compare whole. */
export function diffProfiles(a, b) {
  const out = [];
  const strip = p => Object.fromEntries(Object.entries(p || {}).filter(([k]) => !HASH_EXCLUDED.includes(k)));
  const same = (x, y) => canonicalJson(x) === canonicalJson(y);
  const walk = (x, y, path) => {
    if (isObj(x) && isObj(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) walk(x[k], y[k], path ? `${path}.${k}` : k);
    } else if (!same(x, y)) out.push({ path, before: x === undefined ? null : x, after: y === undefined ? null : y });
  };
  walk(strip(a), strip(b), '');
  return out;
}

// ---- validation --------------------------------------------------------------------
const stringList = v => Array.isArray(v) && v.every(x => typeof x === 'string');
/**
 * Checks a style document. Unknown fields are kept (a newer Lykos wrote them);
 * wrong types are errors, each saying what to change. A newer `schema` is not
 * an error: the document is returned read-only with a notice. Sizes below the
 * floor are a warning, because a token read raises them to it.
 * Returns `{ ok, doc, errors, warnings, readOnly, notice }`; `doc` is a copy.
 */
export function validateStyle(input) {
  const errors = [], warnings = [];
  const err = m => errors.push(m);
  if (!isObj(input)) return { ok: false, doc: null, errors: ['The figure style must be a JSON object with schema, active, profiles and assign.'], warnings, readOnly: false, notice: '' };
  if (!isNum(input.schema) || !Number.isInteger(input.schema) || input.schema < 1) err('schema must be a whole number from 1 (this version writes 1).');
  const newer = Number.isInteger(input.schema) && input.schema > SCHEMA;
  if (newer) return { ok: true, doc: structuredClone(input), errors, warnings, readOnly: true, notice: `This style was saved by a newer Lykos (schema ${input.schema}); it opens read-only.` };
  const profiles = input.profiles == null ? [] : input.profiles;
  const ids = new Set();
  if (!Array.isArray(profiles)) err('profiles must be a list of profile objects.');
  else profiles.forEach((p, i) => checkProfile(p, `profiles[${i}]`, ids, err, warnings));
  const known = id => ids.has(id) || Object.hasOwn(PRESETS, id);
  if (input.active != null && (typeof input.active !== 'string' || !known(input.active))) err(`active must name a profile of this document or a preset (${Object.keys(PRESETS).join(', ')}), not ${JSON.stringify(input.active)}.`);
  if (input.assign != null) {
    if (!isObj(input.assign)) err('assign must map a chart role to a profile id, e.g. { "forest": "asd-house" }.');
    else for (const [role, id] of Object.entries(input.assign)) if (typeof id !== 'string' || !known(id)) err(`assign.${role} must name a profile of this document or a preset, not ${JSON.stringify(id)}.`);
  }
  if (input.fonts != null) {
    if (!Array.isArray(input.fonts)) err('fonts must be a list of { family, weight, style, path, sha256 }, references to files on this machine.');
    else input.fonts.forEach((f, i) => {
      if (!isObj(f) || typeof f.family !== 'string' || !f.family || !isNum(f.weight) || typeof f.path !== 'string') err(`fonts[${i}] needs family (text), weight (number) and path (text); style and sha256 are text.`);
      else for (const k of ['style', 'sha256']) if (f[k] != null && typeof f[k] !== 'string') err(`fonts[${i}].${k} must be text.`);
    });
  }
  if (input.history != null) {
    if (!Array.isArray(input.history)) err('history must be a list of { at, profile, version, hash }.');
    else {
      input.history.forEach((h, i) => { if (!isObj(h) || typeof h.at !== 'string' || typeof h.profile !== 'string' || !Number.isInteger(h.version) || typeof h.hash !== 'string') err(`history[${i}] needs at, profile, hash (text) and version (whole number).`); });
      if (input.history.length > 20) warnings.push(`history holds ${input.history.length} entries; only the last 20 are kept.`);
    }
  }
  return { ok: !errors.length, doc: errors.length ? null : structuredClone(input), errors, warnings, readOnly: false, notice: '' };
}

function checkProfile(p, at, ids, err, warnings) {
  if (!isObj(p)) return err(`${at} must be a profile object.`);
  if (typeof p.id !== 'string' || !ID.test(p.id)) err(`${at}.id must be text of letters, digits, ".", "_", ":" and "-" (at most 64).`);
  else if (ids.has(p.id)) err(`${at}.id "${p.id}" is used twice; every profile needs its own id.`);
  else ids.add(p.id);
  for (const k of ['label', 'basedOn']) if (p[k] != null && typeof p[k] !== 'string') err(`${at}.${k} must be text.`);
  if (p.version != null && (!Number.isInteger(p.version) || p.version < 1)) err(`${at}.version must be a whole number from 1.`);
  if (p.hash != null && !(typeof p.hash === 'string' && /^[0-9a-f]{64}$/.test(p.hash))) err(`${at}.hash must be a 64-character lowercase sha256.`);
  if (p.render != null && typeof p.render !== 'boolean') err(`${at}.render must be true or false (false = declared only).`);
  if (p.appliesTo != null && !(isObj(p.appliesTo) && (p.appliesTo.pathGlobs == null || stringList(p.appliesTo.pathGlobs)))) err(`${at}.appliesTo must be { pathGlobs: [text] }.`);
  if (p.source != null) {
    if (!Array.isArray(p.source)) err(`${at}.source must be a list of { path, size, mtime, sha256 }.`);
    else p.source.forEach((s, i) => { if (!isObj(s) || typeof s.path !== 'string' || !isNum(s.size) || typeof s.mtime !== 'string' || typeof s.sha256 !== 'string') err(`${at}.source[${i}] needs path, mtime, sha256 (text) and size (number).`); });
  }
  const section = (name, check) => { if (p[name] == null) return; if (!isObj(p[name])) return err(`${at}.${name} must be an object.`); check(p[name], `${at}.${name}`); };
  const eachNumber = (o, path, { nullable = false, min = null } = {}) => {
    for (const [k, v] of Object.entries(o)) {
      if (v === null && nullable) continue;
      if (!isNum(v)) err(`${path}.${k} must be a number${nullable ? ' or null' : ''}, not ${JSON.stringify(v)}.`);
      else if (min != null && v < min) err(`${path}.${k} must be at least ${min}.`);
    }
  };
  const hexMap = (o, path) => { for (const [k, v] of Object.entries(o)) if (typeof v !== 'string' || !HEX.test(v)) err(`${path}.${k} must be a hex colour like #1a2b3c, not ${JSON.stringify(v)}.`); };
  section('colors', hexMap);
  section('ramps', (o, path) => { for (const [k, v] of Object.entries(o)) if (!Array.isArray(v) || !v.every(x => typeof x === 'string' && HEX.test(x))) err(`${path}.${k} must be a list of hex colours.`); });
  section('presence', hexMap);
  section('encodings', () => {});
  section('size', (o, path) => {
    if (o.unit != null && !['pt', 'px'].includes(o.unit)) err(`${path}.unit must be "pt" or "px".`);
    const { unit, ...numbers } = o;
    eachNumber(numbers, path, { min: 0 });
    const floor = Math.max(isNum(o.min) ? o.min : 0, MIN_SIZE);
    for (const [k, v] of Object.entries(numbers)) if (k !== 'min' && isNum(v) && v < floor) warnings.push(`${path}.${k} is ${v}, below ${floor}; a token read raises it to ${floor}.`);
  });
  section('line', (o, path) => eachNumber(o, path, { min: 0 }));
  section('mark', (o, path) => eachNumber(o, path, { nullable: true, min: 0 }));
  section('geometry', (o, path) => {
    for (const k of ['width', 'dpi', 'pad', 'row']) if (o[k] != null && (!isNum(o[k]) || o[k] < 0)) err(`${path}.${k} must be a number of at least 0 or null.`);
    if (o.widthIn != null) { if (isObj(o.widthIn)) eachNumber(o.widthIn, `${path}.widthIn`, { min: 0 }); else if (!isNum(o.widthIn) || o.widthIn <= 0) err(`${path}.widthIn must be a number of inches or { portrait, landscape }.`); }
    if (o.rowIn != null) { if (isObj(o.rowIn)) eachNumber(o.rowIn, `${path}.rowIn`, { min: 0 }); else err(`${path}.rowIn must map a chart role to inches.`); }
  });
  section('fonts', (o, path) => {
    if (o.stack != null && typeof o.stack !== 'string') err(`${path}.stack must be a CSS font-family text.`);
    if (o.family != null && typeof o.family !== 'string') err(`${path}.family must be text or null.`);
    for (const k of ['weights', 'roles']) if (o[k] != null) { if (!isObj(o[k])) err(`${path}.${k} must be an object of numbers.`); else eachNumber(o[k], `${path}.${k}`, { min: 1 }); }
  });
  section('wording', () => {});
  section('caption', () => {});
  section('rules', () => {});
  section('export', () => {});
  section('screen', (o, path) => {
    if (o.unit != null && !['pt', 'px'].includes(o.unit)) err(`${path}.unit must be "pt" or "px".`);
    for (const k of ['row', 'pad']) if (o[k] != null && (!isNum(o[k]) || o[k] < 0)) err(`${path}.${k} must be a number of at least 0.`);
    for (const k of ['size', 'line', 'mark', 'width', 'metrics']) if (o[k] != null) { if (!isObj(o[k])) err(`${path}.${k} must be an object of numbers.`); else eachNumber(Object.fromEntries(Object.entries(o[k]).filter(([, v]) => v !== null)), `${path}.${k}`, { min: 0 }); }
  });
  section('metrics', (o, path) => {
    if (o.widths != null) { if (isObj(o.widths)) eachNumber(o.widths, `${path}.widths`, { min: 0 }); else err(`${path}.widths must be null or a table of character to width in em.`); }
    if (o.scale != null && (!isNum(o.scale) || o.scale <= 0)) err(`${path}.scale must be a number above 0.`);
  });
}

// ---- tokens ------------------------------------------------------------------------
// role -> [size key, colour key, font role]. Text roles name the size and the
// colour a label of that kind takes; drawing roles name a line weight and a
// colour; chart roles (the keys of the assign map and the row heights of 3.3)
// read size `base`, colour `ink` and the CI line.
const TEXT = {
  base: ['base', 'ink', 'label'], header: ['header', 'ink', 'heading'], groupHead: ['groupHead', 'ink', 'heading'],
  armHeatHead: ['armHeatHead', 'ink', 'heading'], rowLabel: ['rowLabel', 'ink', 'label'], study: ['study', 'ink', 'label'],
  value: ['value', 'ink', 'number'], secondary: ['secondary', 'ink2', 'number'], tick: ['tick', 'ink2', 'number'],
  sideLabel: ['sideLabel', 'ink2', 'label'], note: ['note', 'ink2', 'label'], panelLetter: ['panelLetter', 'ink', 'heading'],
  panelTitle: ['panelTitle', 'ink', 'heading'], caption: ['caption', 'captionText', 'label'],
};
const DRAWING = { axis: ['axis', 'ink2'], grid: ['hair', 'hair'], hairline: ['hair', 'hair'], rule: ['header', 'ink'], ci: ['ci', 'ink2'], ciProportion: ['ciProportion', 'ink'], zero: ['zero', 'rule'], bar: ['ci', 'bar'] };
export const CHART_ROLES = ['forest', 'forest-table', 'heat', 'bar', 'column', 'dot', 'stacked', 'timeline', 'prisma', 'proportions', 'device'];
export const ROLES = [...Object.keys(TEXT), ...Object.keys(DRAWING).filter(r => r !== 'bar'), ...CHART_ROLES];
// A colour a profile does not name falls back along this chain, ending at ink.
const COLOR_FALLBACK = { ink2: 'ink', rule: 'ink2', hair: 'rule', bar: 'ink2', captionText: 'ink', accent: 'ink', light: 'hair', page: null };
const colorOf = (colors, key) => {
  for (let k = key; k; k = COLOR_FALLBACK[k]) if (typeof colors?.[k] === 'string') return colors[k];
  return '#000000';
};
const round = (x, d = 6) => Number(x.toFixed(d));
const perInch = unit => (unit === 'px' ? 96 : 72);

/**
 * The profile a role reads: options.profile, then the assign map (by options.chart or the role), then active, then the
 * house style (DEFAULT_ACTIVE). No document at all reads the neutral constants (NEUTRAL), the `style == null` drawing; so
 * does an id that names nothing.
 */
export function profileFor(doc, role, { profile = null, chart = null } = {}) {
  const find = id => doc?.profiles?.find(p => p?.id === id) || PRESETS[id] || null;
  if (!isObj(doc)) return profile ? PRESETS[profile] || PRESETS[NEUTRAL] : PRESETS[NEUTRAL];
  const id = profile ?? doc.assign?.[chart ?? role] ?? doc.active ?? DEFAULT_ACTIVE;
  return find(id) || PRESETS[NEUTRAL];
}

/** Side of a forest square at weight `w` (percent): base + scale * sqrt(w / 100), in the profile's unit. */
export const squareSide = (mark, w) => (isNum(mark?.squareBase) && isNum(mark?.squareScale) ? round(mark.squareBase + mark.squareScale * Math.sqrt(Math.max(0, w) / 100)) : null);

/**
 * Everything a renderer needs for one kind of mark or text, from a style
 * document. `doc == null` returns the neutral constants of output-charts.mjs
 * (unit px). Geometry never depends on installed fonts: `metrics` is the
 * profile's table, whatever resolveFonts reports for this machine.
 *
 *   font     CSS font-family stack            size     text size in `unit`, at least MIN_SIZE
 *   weight   requested weight (600 may draw 500, see resolveFonts)
 *   color    colour of the role               line     line weight in `unit` for the role
 *   mark     { dot, squareBase, squareScale, diamondRow }
 *   row      row height in `unit`             pad      padding in `unit`
 *   width    figure width in `unit` (null when the profile has none)
 *   widthIn  figure width in inches for options.orientation ('portrait' default), or null
 *   dpi      raster resolution or null        metrics  { widths, scale } for textWidth
 *   id, version, hash   of the profile that answered
 * `medium: 'screen'` reads the profile's `screen` block (px, the app font's scale) over its export values.
 */
export function tokensFor(doc, role = 'base', { placement = null, orientation = null, profile = null, chart = null, medium = 'export' } = {}) {
  if (!ROLES.includes(role)) throw new RangeError(`Unknown figure role "${role}". Roles: ${ROLES.join(', ')}.`);
  if (medium !== 'export' && medium !== 'screen') throw new RangeError(`Unknown medium "${medium}": export or screen.`);
  const base = profileFor(doc, role, { profile, chart }), p = onScreen(base, medium);
  const unit = p.size?.unit === 'px' ? 'px' : 'pt';
  const [sizeKey, colorKey, fontRole] = TEXT[role] || [null, null, null];
  const [lineKey, drawColor] = DRAWING[role] || [null, null];
  const sizeRaw = p.size?.[sizeKey || 'base'] ?? p.size?.base ?? MIN_SIZE;
  const floor = Math.max(isNum(p.size?.min) ? p.size.min : 0, MIN_SIZE);
  const wIn = p.geometry?.widthIn;
  const widthIn = isNum(wIn) ? wIn : isObj(wIn) ? (wIn[orientation || 'portrait'] ?? wIn[placement] ?? null) : null;
  const rowIn = p.geometry?.rowIn;
  const rowInches = isObj(rowIn) ? (rowIn[role] ?? rowIn.forest ?? null) : null;
  const wRole = (fontRole && p.fonts?.roles?.[fontRole]) ?? p.fonts?.roles?.label ?? 400;
  return {
    font: p.fonts?.stack || 'Helvetica, Arial, sans-serif',
    weight: wRole,
    size: Math.max(sizeRaw, floor),
    color: colorOf(p.colors, colorKey || drawColor || 'ink'),
    line: p.line?.[lineKey || 'ci'] ?? p.line?.ci ?? 1,
    mark: { ...(p.mark || {}) },
    row: rowInches != null ? round(rowInches * perInch(unit)) : (p.geometry?.row ?? null),
    pad: p.geometry?.pad ?? 0,
    unit,
    width: p.geometry?.width ?? (widthIn != null ? round(widthIn * perInch(unit)) : null),
    widthIn,
    dpi: p.geometry?.dpi ?? null,
    metrics: { widths: p.metrics?.widths ? { ...p.metrics.widths } : null, scale: p.metrics?.scale ?? 1 },
    id: base.id, version: base.version ?? 1, hash: canonicalHash(base),
  };
}

/**
 * The profile as the app draws it on screen: its `screen` block (px geometry, the app font's
 * measured scale) over the export values. A profile without one is drawn on screen as exported.
 */
function onScreen(p, medium) {
  const sc = medium === 'screen' && isObj(p.screen) ? p.screen : null;
  if (!sc) return p;
  const label = sc.size?.label ?? 12, small = sc.size?.small ?? label;
  const size = Object.fromEntries(Object.entries(p.size || {}).filter(([k]) => k !== 'unit').map(([k, v]) => [k, k === 'min' ? Math.min(v, small) : v < (p.size.base ?? v) ? small : label]));
  return { ...p, size: { ...size, unit: sc.unit || 'px' }, line: { ...p.line, ...sc.line }, mark: { ...p.mark, ...sc.mark },
    geometry: { ...p.geometry, width: sc.width?.double ?? null, widthIn: null, dpi: null, rowIn: null, row: sc.row ?? p.geometry?.row, pad: sc.pad ?? p.geometry?.pad },
    metrics: { ...p.metrics, ...sc.metrics } };
}

/**
 * The token set a house renderer draws with (lib/figure-house-render.mjs and the
 * figures that adopted it), for one medium, or null when the profile is the
 * neutral one: the renderer then draws today's figure (`style == null`).
 * A document of null reads DEFAULT_ACTIVE, the house style.
 *
 *   unit, medium, font, size { label, small }, weight { head, label }
 *   color { ink, ink2, axis, hair, mark, fill, band, page }, rob { good, unclear, bad, none, ring, on }
 *   cat [6], seq [5], line { axis, hair, ci, null, box, arrow }, row, pad, bar, dot, square [base, scale], diamond
 *   width { single, double } (unit), widthIn { single, double }, dpi, metrics, id, version, hash
 */
export function figureTokens(doc = null, { medium = 'screen', profile = null, chart = null } = {}) {
  const base = isObj(doc) ? profileFor(doc, 'base', { profile, chart }) : PRESETS[profile || DEFAULT_ACTIVE] || PRESETS[DEFAULT_ACTIVE];
  if (base.id === NEUTRAL) return null;
  const k = `${base.id}|${canonicalHash(base)}|${medium}`;
  if (Object.isFrozen(base) && tokenCache.has(k)) return tokenCache.get(k);
  const p = onScreen(base, medium), c = p.colors || {}, floor = Math.max(isNum(p.size?.min) ? p.size.min : 0, MIN_SIZE);
  const col = key => colorOf(c, key);
  const label = Math.max(p.size?.rowLabel ?? p.size?.base ?? 12, floor), small = Math.max(p.size?.tick ?? label, floor);
  const per = perInch(p.size?.unit === 'px' ? 'px' : 'pt'), wIn = isObj(base.geometry?.widthIn) ? base.geometry.widthIn : {};
  const screenW = medium === 'screen' && isObj(base.screen?.width) ? base.screen.width : null;
  const robRamp = medium === 'screen' && Array.isArray(p.ramps?.robScreen) ? p.ramps.robScreen : p.ramps?.rob || [c.good, c.unclear, c.bad];
  const line = p.line || {}, mark = p.mark || {};
  const t = freezeDeep(safeTokens({
    unit: p.size?.unit === 'px' ? 'px' : 'pt', medium, font: p.fonts?.stack || 'Helvetica, Arial, sans-serif',
    size: { label, small }, weight: { head: p.fonts?.roles?.heading ?? 600, label: p.fonts?.roles?.label ?? 400 },
    color: { ink: col('ink'), ink2: col('ink2'), axis: c.axis || col('rule'), hair: col('hair'), mark: c.mark || col('bar'), fill: c.fill || col('light'), band: c.band || c.fill || col('light'), page: c.page || '#ffffff' },
    rob: { good: robRamp[0] || col('ink'), unclear: robRamp[1] || col('ink2'), bad: robRamp[2] || col('ink'), none: c.page || '#ffffff', ring: c.axis || col('rule'), on: c.onMark || c.page || '#ffffff' },
    cat: [...(p.ramps?.categorical || [col('ink'), col('ink2'), col('hair')])], seq: [...(p.ramps?.sequential || [c.page || '#ffffff', col('ink')])],
    line: { axis: line.axis ?? 1, hair: line.hair ?? 1, ci: line.ci ?? 1, null: line.zero ?? 1, box: line.box ?? line.axis ?? 1, arrow: line.arrow ?? line.axis ?? 1 },
    row: p.geometry?.row ?? 22, pad: p.geometry?.pad ?? 0, bar: mark.bar ?? 0.6, dot: mark.dot ?? 3.5,
    square: [mark.squareBase ?? 4, mark.squareScale ?? 8], diamond: mark.diamondRow ?? 0.55,
    width: screenW ? { single: screenW.single, double: screenW.double } : { single: round((wIn.single ?? wIn.portrait ?? 6.89) * per), double: round((wIn.double ?? wIn.portrait ?? 6.89) * per) },
    widthIn: { single: wIn.single ?? wIn.portrait ?? null, double: wIn.double ?? wIn.portrait ?? null },
    dpi: medium === 'screen' ? null : base.export?.png?.dpi ?? base.geometry?.dpi ?? null,
    metrics: { widths: p.metrics?.widths || null, scale: p.metrics?.scale ?? 1 },
    id: base.id, version: base.version ?? 1, hash: canonicalHash(base),
  }, medium));
  SAFE.add(t);
  if (Object.isFrozen(base)) tokenCache.set(k, t);
  return t;
}
const SAFE = new WeakSet();
/** Whether `t` is a token set figureTokens made (checked and frozen): the only kind a house figure is drawn with. */
export const isFigureTokens = t => SAFE.has(t);
const tokenCache = new Map();
/**
 * Every token a renderer writes into an SVG attribute, made safe whatever the profile held: a profile comes
 * from the project's .lykos/figure-style.json, which a person, another tool or an import may have written.
 * A colour is kept only as a hex colour, a number only when finite and within reach (0 to 10 000), the unit
 * only as px or pt, the id only in the id alphabet; anything else takes the house value. The font stack is
 * text and is escaped where it is written (figure-draw.mjs svgRoot).
 */
function safeTokens(t, medium) {
  const house = medium === 'screen' ? HOUSE_SCREEN() : HOUSE_EXPORT();
  if (!house) return t;   // computing the house defaults themselves
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
  const num = (v, d) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && n >= 0 && n <= 10000 ? n : d; };
  const each = (o, d, f) => Object.fromEntries(Object.keys(d).map(k => [k, f(o?.[k], d[k])]));
  const ramp = (xs, d) => { const ok = (Array.isArray(xs) ? xs : []).filter(x => typeof x === 'string' && HEX.test(x)); return ok.length ? ok : [...d]; };
  return {
    ...t, unit: t.unit === 'px' ? 'px' : 'pt', font: String(t.font || house.font),
    size: each(t.size, house.size, num), weight: each(t.weight, house.weight, (v, d) => [400, 500, 600, 700].includes(Number(v)) ? Number(v) : d),
    color: each(t.color, house.color, hex), rob: each(t.rob, house.rob, hex), cat: ramp(t.cat, house.cat), seq: ramp(t.seq, house.seq),
    line: each(t.line, house.line, num), row: num(t.row, house.row), pad: num(t.pad, house.pad), bar: Math.min(1, num(t.bar, house.bar)),
    dot: num(t.dot, house.dot), square: [num(t.square?.[0], house.square[0]), num(t.square?.[1], house.square[1])], diamond: Math.min(1, num(t.diamond, house.diamond)),
    width: each(t.width, house.width, num), widthIn: each(t.widthIn, house.widthIn, (v, d) => (v == null ? d : num(v, d))),
    dpi: t.dpi == null ? null : Math.min(2400, num(t.dpi, house.dpi)),
    metrics: { widths: isObj(t.metrics?.widths) ? Object.fromEntries(Object.entries(t.metrics.widths).filter(([c, v]) => c.length === 1 && Number.isFinite(v) && v >= 0 && v < 4)) : null, scale: Math.min(4, num(t.metrics?.scale, 1)) || 1 },
    id: typeof t.id === 'string' && ID.test(t.id) ? t.id : house.id, version: Number.isInteger(t.version) && t.version >= 1 ? t.version : 1,
  };
}
let houseExport = null, houseScreen = null, building = false;
const houseTokens = medium => { if (building) return null; building = true; try { return figureTokens(null, { medium, profile: DEFAULT_ACTIVE }); } finally { building = false; } };
const HOUSE_EXPORT = () => houseExport ||= houseTokens('export');
const HOUSE_SCREEN = () => houseScreen ||= houseTokens('screen');
const freezeDeep = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') freezeDeep(v); }); return Object.freeze(o); };

// ---- font fidelity -----------------------------------------------------------------
/** Metrics slack for a weight the family lacks, and the Helvetica multiple for an absent family (plan §4.15c.2). Assumption and largest measured ratio. */
export const MISSING_WEIGHT_SLACK = 1.06;
export const ABSENT_FAMILY_SCALE = 1.14;
const WEIGHT_NAME = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const RANK = { exact: 0, approximate: 1, fallback: 2 };
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;

/**
 * How faithfully a profile's fonts can be drawn given the faces available on
 * this machine: `available` is a list of `{ family, weight, style?, widths? }`
 * (a system probe and the user's `fonts[]` files, merged by the caller); null
 * or an empty list means the family is absent, which is also what an unknown
 * probe is treated as. Pure: nothing is probed or read here.
 *
 *   exact        every face the profile asks for is available
 *   approximate  the family is there but a weight is not: the nearest weight draws
 *   fallback     the family is absent: the tail of the font stack draws
 *
 * The result's `metrics` is what a clip check should measure against; layout
 * itself uses the profile's table (tokensFor), so coordinates do not depend on
 * which of these three it is.
 */
export function resolveFonts(profile, available = null) {
  const fonts = profile?.fonts || {};
  const family = fonts.family || null;
  const base = { widths: profile?.metrics?.widths || null, scale: profile?.metrics?.scale ?? 1 };
  if (!family) return { family: null, fidelity: 'exact', faces: {}, record: {}, notice: '', metrics: { ...base, source: 'profile' } };
  const list = (Array.isArray(available) ? available : available?.faces || [])
    .filter(f => isObj(f) && String(f.family || '').toLowerCase() === family.toLowerCase() && (!f.style || f.style === 'normal') && isNum(Number(f.weight)));
  const have = [...new Set(list.map(f => Number(f.weight)))].sort((a, b) => a - b);
  const tail = String(fonts.stack || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s && s.toLowerCase() !== family.toLowerCase() && !GENERIC.test(s))[0] || 'a system font';
  const faces = {}, record = {};
  for (const [role, asked] of Object.entries(fonts.roles || {})) {
    const wanted = fonts.weights?.[asked] ?? asked;
    let fidelity = 'fallback', got = null;
    if (have.includes(wanted)) { fidelity = 'exact'; got = wanted; }
    else if (have.length) { fidelity = 'approximate'; got = have.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), have[0]); }
    faces[role] = { family, asked, wanted, got, fidelity };
    record[role] = fidelity === 'exact' ? `${family} ${wanted}` : fidelity === 'approximate' ? `${family} ${wanted} -> ${got}` : `${family} ${wanted} -> ${tail}`;
  }
  const levels = Object.values(faces).map(f => f.fidelity);
  const fidelity = levels.length ? levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'exact') : (have.length ? 'exact' : 'fallback');
  const regular = list.find(f => Number(f.weight) === 400 && f.widths) || null;
  const labelFace = list.find(f => Number(f.weight) === faces.label?.got && f.widths) || null;
  let metrics;
  if (fidelity === 'exact') metrics = labelFace ? { widths: labelFace.widths, scale: 1, source: 'font file' } : { ...base, source: 'profile' };
  else if (fidelity === 'approximate') {
    const m = regular ? { widths: regular.widths, scale: 1 } : base;
    metrics = { widths: m.widths, scale: round(m.scale * MISSING_WEIGHT_SLACK), source: regular ? 'regular file with slack' : 'profile with slack' };
  } else metrics = { widths: base.widths, scale: base.widths ? base.scale : ABSENT_FAMILY_SCALE, source: base.widths ? 'profile table' : 'Helvetica table, largest measured ratio' };
  const names = have.map(w => WEIGHT_NAME[w] || String(w)).join(', ');
  const notice = fidelity === 'exact' ? '' : fidelity === 'fallback' ? `${family} not found` : `${family} ${names} only`;
  return { family, fidelity, faces, record, notice, metrics };
}

/** The `style` stamp a render carries in outputs.json and in the SVG `<desc>`: `{ id, version, hash, fonts, fidelity }`. */
export const styleStamp = (profile, resolved) => ({
  id: profile.id, version: profile.version ?? 1, hash: canonicalHash(profile),
  fonts: { ...(resolved?.record || {}) }, fidelity: resolved?.fidelity || 'exact',
});
