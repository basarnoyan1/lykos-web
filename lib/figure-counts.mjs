// A printed comparison's own counts (plan, Tables and figures: "Printed figures use their own names and results", 2026-10-18): the arm-level
// table a figure was made from, as RevMan writes it ("Study ID, Outcome, Arm, Intervention, Events, Total"; the Spine review's
// RevMan_arm_level.csv), read for the two sides the figure's caption sets against each other. Tables and figures runs these counts in R and
// draws that forest plot as the figure (views/outputs.mjs drawPrinted); the comparison in Analysis keeps reading the evidence table. Pure.

const low = x => String(x ?? '').trim().toLowerCase();

/**
 * `rows` a CSV as rows of cells, the header first; `sides` { treated, control } (lib/paper-items.mjs captionSides); `text` the caption and
 * legend. Returns `{ outcome, rows: [{ label, values: [events, total, events, total] }] }` (treated first), or null when the table is not such a
 * table, holds neither side, or gives fewer than two studies both arms. A table of several outcomes gives the one the text names ("Any
 * failure"), else the one most of its rows give.
 */
export function countsFor(rows, sides, text = '') {
  const [head = [], ...body] = rows || [];
  const col = re => head.findIndex(h => re.test(low(h)));
  const iS = col(/^study( id)?$/), iO = col(/^outcome$/), iA = col(/^arm$/), iE = col(/^events?$/), iN = col(/^(total|n)$/);
  if ([iS, iA, iE, iN].some(i => i < 0) || !sides) return null;
  const side = a => (low(a) === low(sides.treated) || low(a).startsWith(low(sides.treated)) ? 0
    : low(a) === low(sides.control) || low(a).startsWith(low(sides.control)) ? 1 : -1);
  let use = body.filter(r => side(r[iA]) >= 0), outcome = '';
  if (iO >= 0 && use.length) {
    const outs = [...new Set(use.map(r => String(r[iO]).trim()))], many = o => use.filter(r => String(r[iO]).trim() === o).length;
    outcome = outs.find(o => o && low(text).includes(low(o))) || outs.sort((a, b) => many(b) - many(a))[0];
    use = use.filter(r => String(r[iO]).trim() === outcome);
  }
  const by = new Map();
  for (const r of use) {
    const k = String(r[iS]).trim(), e = Number(r[iE]), n = Number(r[iN]);
    if (!k || !Number.isFinite(e) || !Number.isFinite(n)) continue;
    if (!by.has(k)) by.set(k, [null, null]);
    by.get(k)[side(r[iA])] = [e, n];
  }
  const out = [...by].filter(([, v]) => v[0] && v[1]).map(([label, [t, c]]) => ({ label, values: [t[0], t[1], c[0], c[1]] }));
  return out.length >= 2 ? { outcome, rows: out } : null;
}
