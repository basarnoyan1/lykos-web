// The risk-of-bias levels as every drawing shows them (plan §2, "Risk-of-bias figures", 2026-10-24): robvis's palette (McGuinness & Higgins
// 2021, its "cochrane" colours for RoB 2 and ROBINS-I), the same on screen and in print, so the app's chart and the printed robvis figure read
// alike. The hue is the convention a reader of Cochrane reviews knows; the glyph carries the level without it (greyscale, every dichromacy).
// Low (except for concerns about uncontrolled confounding), ROBINS-I V2's and ROBINS-E's second level, is a paler green with Low's glyph;
// No information is grey (a level that says nothing has no hue); Not applicable draws no mark.
export const ROB_LEVELS = Object.freeze(['low', 'lowx', 'concerns', 'high', 'critical', 'ninfo', 'na']);
export const ROB_PALETTE = Object.freeze({ low: '#02c100', lowx: '#a6e08f', concerns: '#e2df07', high: '#bf0000', critical: '#820000', ninfo: '#8c8c8c', na: '#cccccc' });
/** A level's fill in a figure style's tokens (lib/figure-style.mjs: Low, Moderate and Serious are its rob good, unclear and bad). */
export const robFill = (t, level) => t.rob[{ low: 'good', concerns: 'unclear', high: 'bad' }[level] || level];
/** The glyph of a level: + Low, − Moderate or Some concerns, × Serious or High, ! Critical, ? No information. */
export const ROB_GLYPH = Object.freeze({ low: '+', lowx: '+', concerns: '−', high: '×', critical: '!', ninfo: '?', na: '' });
/** The ink of a level's glyph: dark on the light fills, white on Serious's red and Critical's dark red. */
export const ROB_GLYPH_INK = Object.freeze({ dark: '#1a1a1a', light: '#ffffff' });
export const glyphInk = (level, inks = ROB_GLYPH_INK) => (level === 'critical' || level === 'high' ? inks.light : inks.dark);

const fold = s => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
/**
 * The level of a judgement word: Low and Yes are low; Low (except for concerns about uncontrolled confounding) is its own; Some concerns,
 * Moderate and Unclear concerns; High, Serious and No high; Critical and Very high (ROBINS-E's worst) critical; No information; Not applicable
 * and Not assessed draw no mark. A word none of these name takes its tone (good, unclear, bad), else No information.
 */
export function robLevel(word, tone = null) {
  const w = fold(word);
  if (!w) return 'na';
  if (/^low\b.*\bexcept\b/.test(w)) return 'lowx';
  if (/^low\b|^yes$|^star$|^two stars$|^met$/.test(w)) return 'low';
  if (/^some concerns|^moderate|^unclear|^probably|^can'?t tell|^partial/.test(w)) return 'concerns';
  if (/^critical|^very high/.test(w)) return 'critical';
  if (/^high\b|^serious|^no$|^no star|^not met/.test(w)) return 'high';
  if (/^no information|^not reported|^ni$/.test(w)) return 'ninfo';
  if (/^not applicable|^n\/a$|^na$|^not assessed/.test(w)) return 'na';
  return { good: 'low', unclear: 'concerns', bad: 'high', critical: 'critical' }[tone] || 'ninfo';
}

/**
 * A level's glyph as paths, centred on (cx, cy) in a mark of radius r: drawn, not set in a font, so it sits in the middle at every size and in
 * every font. `cls` classes the group (the screen's); `inks` { dark, light } are a figure style's (its tokens' rob.glyph and rob.glyphOn).
 */
export function glyphSvg(level, cx, cy, r, { cls = '', inks = ROB_GLYPH_INK } = {}) {
  const g = ROB_GLYPH[level];
  if (!g) return '';
  const ink = glyphInk(level, inks), w = Math.max(1, r * 0.24), a = r * 0.46, d = r * 0.36, n = x => String(Math.round(x * 100) / 100);
  const line = (x1, y1, x2, y2) => `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" stroke="${ink}" stroke-width="${n(w)}" stroke-linecap="round" fill="none"/>`;
  // a dot is a round-capped stroke of no length, so a mark stays one circle (its glyph is strokes only)
  const dot = (x, y) => `<path d="M${n(x)} ${n(y)}L${n(x)} ${n(y)}" stroke="${ink}" stroke-width="${n(w * 1.3)}" stroke-linecap="round" fill="none"/>`;
  let body = '';
  if (g === '+') body = line(cx - a, cy, cx + a, cy) + line(cx, cy - a, cx, cy + a);
  else if (g === '−') body = line(cx - a, cy, cx + a, cy);
  else if (g === '×') body = line(cx - d, cy - d, cx + d, cy + d) + line(cx - d, cy + d, cx + d, cy - d);
  else if (g === '!') body = line(cx, cy - a, cx, cy + r * 0.12) + dot(cx, cy + r * 0.44);
  else if (g === '?') body = `<path d="M${n(cx - r * 0.3)} ${n(cy - r * 0.2)}C${n(cx - r * 0.3)} ${n(cy - r * 0.62)} ${n(cx + r * 0.34)} ${n(cy - r * 0.62)} ${n(cx + r * 0.34)} ${n(cy - r * 0.22)}C${n(cx + r * 0.34)} ${n(cy + r * 0.04)} ${n(cx)} ${n(cy + r * 0.02)} ${n(cx)} ${n(cy + r * 0.2)}" stroke="${ink}" stroke-width="${n(w)}" stroke-linecap="round" fill="none"/>` + dot(cx, cy + r * 0.48);
  return `<g${cls ? ` class="${cls}"` : ''} aria-hidden="true">${body}</g>`;
}
