// A scale's whole range with its arms on it (owner, 13 Nov 2026: "i don't know the ranges of those scales etc maybe a visualization"): the axis
// runs from the scale's lowest to its highest score, the better end named; each arm is a row from its baseline mean (a dot, its SD as a thin
// band) to its end mean (a bar). A baseline within one SD of a bound of the scale (the range rule of the Sham review's S44) is said in the
// hover. Marks carry the view's attributes (a press shows the arm in Details, lib/chart-interact.mjs). Pure: an SVG string; tested in
// app/test/scale-guide.test.mjs.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = x => String(Math.round(x * 10) / 10);
const num = x => (x == null || !Number.isFinite(Number(x)) ? '' : String(Math.round(Number(x) * 100) / 100).replace('-', '−'));
const attrs = a => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
const ROW = 20, TOP = 26, BOT = 42, PAD = 8;

/**
 * `scale`: { label, min, max, higher: 'worse' | 'better' | null }; `rows`: [{ label, baseline, sd, end, attrs }] (baseline required).
 * Without a stated range the axis spans the values, and says so. Returns '' when no row has a baseline.
 */
export function scaleRangeSvg(scale, rows, { width = 560, labelW = 132 } = {}) {
  const list = (rows || []).filter(r => Number.isFinite(r.baseline));
  if (!list.length) return '';
  const known = Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.max > scale.min;
  const vals = list.flatMap(r => [r.baseline, ...(Number.isFinite(r.end) ? [r.end] : [])]);
  const lo = known ? scale.min : Math.min(...vals), hi = known ? scale.max : Math.max(...vals), span = hi - lo || 1;
  const x0 = PAD + labelW, x1 = width - PAD, X = v => x0 + (x1 - x0) * (Math.min(hi, Math.max(lo, v)) - lo) / span;
  const h = TOP + list.length * ROW + BOT, parts = [];
  // the axis: the bounds, with the better end named, and a quarter grid
  for (let q = 0; q <= 4; q++) {
    const gx = f1(x0 + (x1 - x0) * q / 4);
    parts.push(`<line x1="${gx}" y1="${TOP - 4}" x2="${gx}" y2="${h - BOT + 2}" class="c-grid" stroke="#e3e3e3"/>`);
    if (q > 0 && q < 4) parts.push(`<text x="${gx}" y="${h - BOT + 14}" text-anchor="middle" class="c-mute" fill="#555">${esc(num(lo + span * q / 4))}</text>`);
  }
  const better = scale.higher === 'worse' ? 'lo' : scale.higher === 'better' ? 'hi' : '';
  const end = (v, side) => `${num(v)}${better === side ? ' (better)' : ''}`;
  parts.push(`<text x="${f1(x0)}" y="${TOP - 10}" class="c-mute" fill="#555">${esc(end(lo, 'lo'))}</text>`,
    `<text x="${f1(x1)}" y="${TOP - 10}" text-anchor="end" class="c-mute" fill="#555">${esc(end(hi, 'hi'))}</text>`,
    `<line x1="${f1(x0)}" y1="${h - BOT + 2}" x2="${f1(x1)}" y2="${h - BOT + 2}" class="c-axis" stroke="#555"/>`,
    `<text x="${f1((x0 + x1) / 2)}" y="${h - 8}" text-anchor="middle" class="c-mute" fill="#555">${esc(known ? `${scale.label}, ${num(lo)} to ${num(hi)}` : `${scale.label}: range not stated, axis spans the values`)}</text>`);
  list.forEach((r, i) => {
    const y = TOP + i * ROW + ROW / 2, b = X(r.baseline), hasEnd = Number.isFinite(r.end), e = hasEnd ? X(r.end) : b;
    const sd = Number.isFinite(r.sd) && r.sd > 0 ? r.sd : null;
    const near = known && sd != null && (r.baseline - sd < lo || r.baseline + sd > hi);
    const at = known ? `, ${Math.round((r.baseline - lo) / span * 100)}% of the range` : '';
    const tip = `${r.label}: baseline ${num(r.baseline)}${sd != null ? ` (SD ${num(sd)})` : ''}${at}${hasEnd ? `, end ${num(r.end)}` : ''}${near ? '; baseline within one SD of a bound of the scale' : ''}`;
    parts.push(`<g data-chart-mark="r${i}"${attrs(r.attrs)}><title>${esc(tip)}</title>`,
      `<rect x="0" y="${y - ROW / 2}" width="${width}" height="${ROW}" fill="transparent" class="c-lane"/>`,
      `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" class="c-ink" fill="#000">${esc(r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label)}</text>`,
      sd != null ? `<line x1="${f1(X(r.baseline - sd))}" y1="${y}" x2="${f1(X(r.baseline + sd))}" y2="${y}" class="c-axis" stroke="#8f8f8f" stroke-width="1"/>` : '',
      hasEnd ? `<line x1="${f1(b)}" y1="${y}" x2="${f1(e)}" y2="${y}" class="c-line" stroke="#000" stroke-width="2"/><rect x="${f1(e - 1.5)}" y="${y - 5}" width="3" height="10" class="c-dot" fill="#000"/>` : '',
      (near ? `<circle cx="${f1(b)}" cy="${y}" r="4" class="c-line" fill="none" stroke="#000" stroke-width="1.5"/>` : `<circle cx="${f1(b)}" cy="${y}" r="3.5" class="c-dot" fill="#000"/>`), '</g>');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(`${scale.label}: baseline and end of each arm on the scale's range`)}" font-size="12">${parts.join('')}</svg>`;
}
