// The generic visuals of a measure, registered through the same registry an addon uses (lib/measure-visuals.mjs): a change as a line per
// study from before to after (charts.mjs slopeChart), a count of a total as a rate per study (rateChart), a number as a dot per study on
// one axis with the median marked (drawn here, in the figures' house look). A library entry's scale, when it has one, is the dot plot's axis.
import { registerMeasureVisual, genericVisual } from './measure-visuals.mjs';
import { slopeChart, rateChart } from './charts.mjs';
import { textWidth } from './textwidth.mjs';

const FONT = 'Helvetica, Arial, sans-serif', FS = 12, INK = '#000', AXIS = '#555', BAR = '#8f8f8f';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = x => (Math.round(x * 10) / 10).toString();
const fmtN = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
const attrsOf = a => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
const clip = (t, maxW) => { let s = String(t); if (textWidth(s, FS) <= maxW) return s; while (s.length > 1 && textWidth(`${s}…`, FS) > maxW) s = s.slice(0, -1); return `${s}…`; };

/** A number per study as a dot on one axis: `rows` [{ label, value, attrs }], lowest first; the median a heavier tick. */
export function dotChart(rows, { width = 480, unit = '', title = 'Values', scale = null } = {}) {
  const shown = rows.filter(r => Number.isFinite(r.value)).sort((a, b) => a.value - b.value), ROW = 20, TOP = 6, BOT = 24, w = Math.max(280, width);
  const u = v => `${fmtN(v)}${/^[°%]/.test(unit) ? unit : unit ? ` ${unit}` : ''}`;
  const vals = shown.map(r => r.value), lo = scale ? Math.min(scale.min, ...vals) : Math.min(...vals), hi = scale ? Math.max(scale.max, ...vals) : Math.max(...vals), span = hi - lo || 1;
  const labelW = Math.min(Math.round(w * 0.36), Math.max(60, ...shown.map(r => textWidth(r.label, FS) + 12))), x0 = labelW, plotW = w - labelW - 56;
  const X = v => x0 + plotW * (v - lo) / span, h = TOP + shown.length * ROW + BOT, base = h - BOT + 4;
  const parts = [`<line x1="${x0}" y1="${base}" x2="${x0 + plotW}" y2="${base}" stroke="${AXIS}" class="c-axis"/>`,
    `<text class="c-mute" x="${x0}" y="${base + 16}" text-anchor="middle" fill="${AXIS}">${esc(u(lo))}</text>`, `<text class="c-mute" x="${f1(x0 + plotW)}" y="${base + 16}" text-anchor="middle" fill="${AXIS}">${esc(u(hi))}</text>`];
  shown.forEach((r, i) => { const y = TOP + i * ROW + ROW / 2;
    parts.push(`<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" class="c-ink" fill="${INK}">${esc(clip(r.label, labelW - 12))}</text>`,
      `<circle data-chart-mark="d${i}"${attrsOf(r.attrs)} cx="${f1(X(r.value))}" cy="${y}" r="4" class="c-bar" fill="${BAR}"><title>${esc(`${r.label}: ${u(r.value)}`)}</title></circle>`); });
  if (shown.length > 1) { const m = shown.length >> 1, med = shown.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
    parts.push(`<g class="c-dot-median"><title>${esc(`Median: ${u(med)}`)}</title><line x1="${f1(X(med))}" y1="${TOP}" x2="${f1(X(med))}" y2="${base}" stroke="${INK}" stroke-width="2"/></g>`); }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" role="img" aria-label="${esc(title)}" font-family="${FONT}" font-size="${FS}"><title>${esc(title)}</title><rect class="c-bg" width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
}

registerMeasureVisual(genericVisual('change'), { label: 'Before and after', types: ['change'],
  draw: (m, studies, o = {}) => slopeChart(studies.map(s => ({ label: s.label, from: s.value.from, to: s.value.to, attrs: s.attrs })), { width: o.width, unit: o.unit ?? m.summary?.unit ?? '', title: o.title || `${m.name}: before and after` }) });
registerMeasureVisual(genericVisual('tally'), { label: 'Events per study', types: ['tally'],
  draw: (m, studies, o = {}) => rateChart(studies.map(s => ({ label: s.label, n: s.value.n, N: s.value.N, attrs: s.attrs })), { width: o.width, title: o.title || `${m.name}: events per study` }) });
registerMeasureVisual(genericVisual('number'), { label: 'Values per study', types: ['number'],
  draw: (m, studies, o = {}) => dotChart(studies.map(s => ({ label: s.label, value: s.value.value, attrs: s.attrs })), { width: o.width, unit: o.unit ?? m.summary?.unit ?? '', scale: o.scale || null, title: o.title || `${m.name}: values per study` }) });
