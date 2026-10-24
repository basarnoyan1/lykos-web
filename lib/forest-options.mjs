// The options of one forest plot, the same for the screen chart (lib/analysis-charts.mjs forestTable), the print drawings
// (lib/forest-page.mjs, lib/revman-forest.mjs) and the output kept with them (s.synthesis.forests, a saved analysis's `forest`), so a kept
// figure draws again as it was made (plan §2, "Forest options"). A forest may be drawn without pooling, as the review's Figure 3 is ("not
// pooled"): no diamond, no weights, no heterogeneity line. Its studies may stand under subgroups of any field, each with its heading and,
// when pooled, an optional subtotal. Events over the total of each arm and the follow-up are columns RevMan has; the favours labels name
// the arms and can be edited; the axis can be set to RevMan's decades. Pure.

/** The options as stored: `pool`, `by` (a subgroup key, '' for none), `subtotals`, the `events` and `fu` columns, `favours` [left, right]
 * or null for the arms' own, `axis` a preset key ('' fits the data); `sides` [intervention, comparator] the arms' column headings (null: the
 * comparison's own), `names` { generated subgroup heading: printed heading }, `rob` the risk-of-bias column. */
export const FOREST_DEFAULTS = Object.freeze({ pool: true, by: '', subtotals: true, events: true, fu: true, favours: null, axis: '', sides: null, names: null, rob: true });

/** The ratio axes RevMan offers (its scale 2, 5, 10, 100, 1000), each with its ticks; '' fits the data. */
export const RATIO_AXES = [['', 'Fit to the data'], ['2', '0.5 to 2'], ['5', '0.2 to 5'], ['10', '0.1 to 10'], ['100', '0.01 to 100'], ['1000', '0.001 to 1000']];
const RATIO_TICKS = { 2: [0.5, 0.7, 1, 1.5, 2], 5: [0.2, 0.5, 1, 2, 5], 10: [0.1, 0.2, 0.5, 1, 2, 5, 10], 100: [0.01, 0.1, 1, 10, 100], 1000: [0.001, 0.01, 0.1, 1, 10, 100, 1000] };

/** A stored or partial set of options with every key filled in. */
export function forestOptions(raw = null, defaults = FOREST_DEFAULTS) {
  const o = { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) };
  const fav = Array.isArray(o.favours) && o.favours.length === 2 && o.favours.some(x => String(x ?? '').trim()) ? o.favours.map(x => String(x ?? '').trim()) : null;
  const sides = Array.isArray(o.sides) && o.sides.length === 2 && o.sides.every(x => String(x ?? '').trim()) ? o.sides.map(x => String(x).trim()) : null;
  const names = o.names && typeof o.names === 'object' && !Array.isArray(o.names) && Object.keys(o.names).length ? Object.fromEntries(Object.entries(o.names).map(([k, v]) => [k, String(v ?? '')])) : null;
  return { pool: o.pool !== false, by: String(o.by || ''), subtotals: o.subtotals !== false, events: o.events !== false, fu: o.fu !== false, favours: fav, axis: RATIO_TICKS[o.axis] ? String(o.axis) : '',
    sides, names, rob: o.rob !== false };
}

/** Only what differs from the defaults, for storing. */
export function storedOptions(o, defaults = FOREST_DEFAULTS) {
  const n = forestOptions(o, defaults), out = {};
  for (const k of Object.keys(defaults)) if (JSON.stringify(n[k]) !== JSON.stringify(forestOptions(null, defaults)[k])) out[k] = n[k];
  return out;
}

/** The ratio axis of a preset: { lo, hi, ticks } on the ratio scale, or null to fit the data. */
export function ratioAxis(key) {
  const t = RATIO_TICKS[key];
  return t ? { lo: 1 / Number(key), hi: Number(key), ticks: t } : null;
}

const lower = s => (/^[A-Z][A-Z0-9]/.test(s) ? s : s.replace(/^./, c => c.toLowerCase()));
/** "Favors two-stage", "Favors single-stage" from the arms' names (American spelling, as the interface writes); a set pair from the options wins. */
export function favoursOf(treated, control, opts = null) {
  if (opts?.favours) return opts.favours;
  return [`Favors ${lower(String(treated || 'intervention').trim())}`, `Favors ${lower(String(control || 'comparator').trim())}`];
}

/** The two sides of a comparison named in its title ("Two-stage versus single-stage surgery" → ["Two-stage", "single-stage"]), or null. */
export function sidesOfTitle(title) {
  const m = /^(.+?)\s+(?:versus|vs\.?|v)\s+(.+)$/i.exec(String(title || '').replace(/\s*\([^)]*\)/g, '').split(/[,;:]/)[0].trim());
  if (!m) return null;
  // a word both sides share at their end ("… surgery") is the comparison's, not a side's
  const a = m[1].trim().split(/\s+/), b = m[2].trim().split(/\s+/);
  while (a.length > 1 && b.length > 1 && a.at(-1).toLowerCase() === b.at(-1).toLowerCase()) { a.pop(); b.pop(); }
  if (b.length > 1 && a.length === 1) b.splice(1);   // "Two-stage versus single-stage surgery": the second side is as long as the first
  return [a.join(' '), b.join(' ')];
}
