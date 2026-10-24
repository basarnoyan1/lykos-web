// Approximate Helvetica advance widths, normalised to font-size 1.
// We wrap text ourselves because the SVG must be self-contained and measurable
// without a DOM or a font library. Boxes grow to fit their line count, so a
// small estimation error changes nothing that is visible.
const W = { ' ':0.278, '!':0.278, '"':0.355, '(':0.333, ')':0.333, ',':0.278,
  '-':0.333, '.':0.278, '/':0.278, ':':0.278, ';':0.278, '=':0.584, '?':0.556,
  'i':0.222, 'j':0.222, 'l':0.222, 't':0.278, 'f':0.278, 'r':0.333, 'I':0.278,
  'm':0.833, 'w':0.722, 'M':0.833, 'W':0.944, 'J':0.5 };
const DIGIT = 0.556, UPPER = 0.667, LOWER = 0.556;

export const charWidth = c =>
  W[c] ?? (c >= '0' && c <= '9' ? DIGIT
        : c >= 'A' && c <= 'Z' ? UPPER
        : LOWER);

/**
 * Width of `s` at `size`. The optional `metrics` is a style profile's metrics
 * table (lib/figure-style.mjs): `{ widths?: { <char>: em }, scale?: number }`.
 * A character found in `widths` uses it, any other uses the Helvetica table
 * above, and the sum is multiplied by `scale`. Without `metrics` the result is
 * the Helvetica width exactly as it always was.
 */
export const textWidth = (s, size, metrics) => {
  if (!metrics) return [...s].reduce((t, c) => t + charWidth(c), 0) * size;
  const own = metrics.widths || null;
  return [...s].reduce((t, c) => t + (own && Number.isFinite(own[c]) ? own[c] : charWidth(c)), 0) * (metrics.scale ?? 1) * size;
};

/** Greedy wrap to a pixel width. Never splits a word; over-long words overflow. */
export function wrap(text, maxWidth, size) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size) > maxWidth) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}
