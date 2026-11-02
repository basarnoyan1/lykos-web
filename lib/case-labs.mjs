// Laboratory results over time, from the case's investigations (plan §1.1, amended 2026-10-20): the same test on several days as a grid to
// compare days and as one small chart per test with its reference interval shaded. Nothing is stored for it: every number is read from the
// investigation rows, in the unit lib/lab-reference.mjs keeps (a value in the SI unit is converted back first), so editing a row redraws both.
//
// Pure: no store, no DOM. A row takes part when it has a test, a value with a number and a time (`when`); a result in words ("no growth") or
// with no time is left out and counted in `left`.
import { recordOf, quantityOf } from './case-record.mjs';
import { whenKey } from './case-report.mjs';
import { LABS, findLab, evaluate, rangeFor, shortRange, intervalText } from './lab-reference.mjs';
import { figureTokens } from './figure-style.mjs';
import { r1, svgRoot, text as draw, measure, axisLine, hairLine, LINE } from './figure-draw.mjs';

/** The categories in the table's order, then any test the table does not know. */
export const GROUPS = [...new Set(LABS.map(l => l.group)), 'Other'];
const fmt = v => String(Number(Number(v).toPrecision(3)));
/** A result as a label: four significant digits, a comma in the thousands (14,250 stays 14,250). */
export const fmtVal = v => { const n = Number(Number(v).toPrecision(4)); return Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : String(n); };
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });

/**
 * One series per test: { key, name, unit, lab, interval, points: [{ id, when, value, text, flag }] } in time order, and the distinct times in time order
 * (`days`; as first entered when dates and days are mixed, which cannot share a scale), `scaled` (whether the times share a scale) and `left`.
 */
export function labSeries(c = {}) {
  const sex = c.sex || '', rows = recordOf(c).investigations, byKey = new Map();
  let left = 0;
  for (const r of rows) {
    if (!r.test || !r.value) continue;
    const ev = evaluate(r.test, r.value, sex), q = quantityOf(r.value);
    const n = ev ? ev.value : q ? q.value : null;
    if (n == null || !r.when) { left++; continue; }
    const lab = findLab(r.test), key = lab ? lab.id : r.test.trim().toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { key, name: lab ? lab.short : r.test.trim(), unit: lab ? lab.unit : q?.unit || '', lab, interval: lab ? rangeFor(lab, sex) : null, points: [] });
    const s = byKey.get(key), p = { id: r.id, when: r.when, value: n, text: r.value, flag: r.flag || ev?.flag || '' };
    const at = s.points.findIndex(x => x.when === r.when);
    if (at >= 0) s.points[at] = p; else s.points.push(p);
  }
  const all = [...byKey.values()];
  const firstSeen = [...new Set(all.flatMap(s => s.points.map(p => p.when)))];
  const keyed = firstSeen.map(w => [w, whenKey(w)]);
  const scaled = keyed.length > 0 && keyed.every(([, k]) => k) && new Set(keyed.map(([, k]) => k.kind)).size === 1;
  const days = scaled ? keyed.slice().sort((a, b) => a[1].v - b[1].v).map(([w]) => w) : firstSeen;
  const rank = new Map(days.map((w, i) => [w, i]));
  for (const s of all) s.points.sort((a, b) => rank.get(a.when) - rank.get(b.when));
  return { series: all, days, scaled, left };
}

/**
 * The grid: a row per test, a column per time. `from` and `to` name two of the times (the first and the last when absent); a row that has a
 * result at both gets `change` = { delta, pct }. Each cell: { text, value, flag } or null.
 */
export function labMatrix(c = {}, { from = '', to = '' } = {}) {
  const { series, days, scaled, left } = labSeries(c);
  const a = days.includes(from) ? from : days[0], b = days.includes(to) ? to : days.at(-1), sex = c.sex || '';
  const rows = series.map(s => {
    const cells = Object.fromEntries(days.map(d => { const p = s.points.find(x => x.when === d); return [d, p ? { text: p.text, value: p.value, flag: p.flag } : null]; }));
    const x = cells[a], y = cells[b];
    const change = x && y && a !== b ? { delta: y.value - x.value, pct: x.value ? (y.value - x.value) / Math.abs(x.value) * 100 : null } : null;
    return { key: s.key, name: s.name, group: s.lab ? s.lab.group : 'Other', unit: s.unit, shown: Object.fromEntries(days.map(d => [d, cells[d] ? fmtVal(cells[d].value) : ''])), reference: s.lab ? shortRange(s.lab, sex) : '', title: s.lab ? intervalText(s.lab, sex) : '', cells, change, n: s.points.length };
  });
  rows.sort((p, q) => GROUPS.indexOf(p.group) - GROUPS.indexOf(q.group));   // by category, each kept in the order it was entered
  return { days, scaled, left, from: a, to: b, rows };
}
export const changeText = ch => (ch ? `${ch.delta > 0 ? '+' : ch.delta < 0 ? '−' : ''}${fmt(Math.abs(ch.delta))}${ch.pct == null ? '' : ` (${ch.pct > 0 ? '+' : ch.pct < 0 ? '−' : ''}${fmt(Math.abs(ch.pct))}%)`}` : '');

export const labCsvRows = (c, opts) => {
  const m = labMatrix(c, opts);
  return [['test', 'unit', 'reference', ...m.days, 'change'], ...m.rows.map(r => [r.name, r.unit, r.reference, ...m.days.map(d => r.cells[d]?.text ?? ''), changeText(r.change)])];
};

/**
 * One test as a self-contained SVG in the house style: its reference interval as a pale band, the values joined by a line, a dot a value, a
 * hollow one outside the interval (classes c-lab-high, c-lab-low and c-lab-abn let the app color them; an export keeps the profile's greys),
 * the time at the foot. Times share a scale where they can (a gap of three days is three times a gap of one); otherwise they are evenly spaced.
 */
export function labTrendSvg(s, { width = 300, scaled = true, style = null } = {}) {
  const t = tokensOf(style), ls = t.size.label, sm = t.size.small, line = ls * LINE;
  const W = Math.max(220, Math.round(width)), H = Math.round(ls * 12.5);
  const L = Math.round(ls * 3.6), R = Math.round(ls * 1.2), top = Math.round(ls * 2.4), bot = Math.round(ls * 2.2);
  const pw = W - L - R, ph = H - top - bot, pts = s.points;
  const [lo, hi] = s.interval || [null, null];
  const vals = [...pts.map(p => p.value), ...(lo != null ? [lo] : []), ...(hi != null ? [hi] : [])];
  let min = Math.min(...vals), max = Math.max(...vals);
  if (lo == null && hi != null) min = Math.min(min, 0);
  const span = max - min || Math.abs(max) || 1, pad = span * 0.12;
  min -= pad; max += pad;
  const y = v => top + (1 - (v - min) / (max - min)) * ph;
  const ks = pts.map(p => whenKey(p.when)), propor = scaled && pts.length > 1 && ks.every(Boolean) && new Set(ks.map(k => k.kind)).size === 1 && ks[0].v !== ks.at(-1).v;
  const x = i => L + (pts.length < 2 ? pw / 2 : propor ? ((ks[i].v - ks[0].v) / (ks.at(-1).v - ks[0].v)) * pw : (i / (pts.length - 1)) * pw);
  const out = [];
  if (lo != null || hi != null) {
    const yt = y(hi ?? max), yb = y(lo ?? min);
    out.push(`<rect class="c-band" x="${r1(L)}" y="${r1(yt)}" width="${r1(pw)}" height="${r1(Math.max(yb - yt, 0))}" fill="${t.color.band}"/>`);
  }
  out.push(axisLine(t, L, top + ph, L + pw, top + ph), axisLine(t, L, top, L, top + ph));
  for (const v of [min + pad, (min + max) / 2, max - pad]) out.push(hairLine(t, L - 3, y(v), L, y(v)), draw(t, L - 5, y(v) + sm * 0.35, fmtVal(v), { anchor: 'end', role: 'small', cls: 'c-mute' }));
  out.push(draw(t, L, ls * 1.1, `${s.name}${s.unit ? ` (${s.unit})` : ''}`, { role: 'head', cls: 'c-ink c-head' }));
  if (pts.length > 1) out.push(`<polyline class="c-line" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci}" points="${pts.map((p, i) => `${r1(x(i))},${r1(y(p.value))}`).join(' ')}"/>`);
  let lastEnd = -Infinity;
  pts.forEach((p, i) => {
    const flagged = p.flag === 'H' || p.flag === 'L' || p.flag === 'A', cls = p.flag === 'H' ? 'c-lab-high' : p.flag === 'L' ? 'c-lab-low' : p.flag === 'A' ? 'c-lab-abn' : 'c-dot c-mark';
    out.push(`<circle class="${cls}" cx="${r1(x(i))}" cy="${r1(y(p.value))}" r="${t.dot}" fill="${flagged ? t.color.page : t.color.ink}" stroke="${t.color.ink}" stroke-width="${flagged ? t.line.ci : 0}"/>`);
    const label = fmtVal(p.value), w = measure(t, label, 'small'), first = i === 0 && pts.length > 1, last = i === pts.length - 1 && pts.length > 1;
    const ax = first ? x(i) - t.dot : last ? x(i) + t.dot : x(i), lo2 = first ? ax : ax - w / 2;   // the end labels lean inward, off the axis and the edge
    if (lo2 > lastEnd + 4 || last) { out.push(draw(t, ax, y(p.value) - t.dot - 3, label, { anchor: first ? 'start' : last ? 'end' : 'middle', role: 'small', cls: flagged ? `c-ink ${cls}-text` : 'c-ink' })); lastEnd = (first ? ax + w : ax + w / 2); }
  });
  // the first and the last time are always named; a time between is named when it clears them and the others chosen
  const span2 = i => { const w = measure(t, pts[i].when, 'small'); return [x(i) - w / 2, x(i) + w / 2]; };
  const named = pts.length ? [0, ...(pts.length > 1 ? [pts.length - 1] : [])] : [];
  for (let i = 1; i < pts.length - 1; i++) { const [a, b] = span2(i); if (named.every(j => { const [c, d] = span2(j); return b + 6 <= c || a >= d + 6; })) named.push(i); }
  for (const i of named) out.push(draw(t, i === 0 ? Math.max(x(i), L + measure(t, pts[i].when, 'small') / 2) : i === pts.length - 1 ? Math.min(x(i), W - measure(t, pts[i].when, 'small') / 2) : x(i), top + ph + line, pts[i].when, { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  return svgRoot(t, W, H, out.join(''), { title: `${s.name} over time`, desc: `${pts.length} ${pts.length === 1 ? 'result' : 'results'}${s.interval ? ', reference interval shaded' : ''}` });
}

/** Every chart on one sheet, two to a row, for a download: the same drawings, nested in one house-style SVG. */
export function labSheetSvg(c, { width = 640, style = null } = {}) {
  const t = tokensOf(style), { series, scaled } = labSeries(c), charts = series.filter(s => s.points.length > 1);
  const cols = width >= 520 ? 2 : 1, cw = Math.floor(width / cols), gap = Math.round(t.size.label);
  const drawn = charts.map(s => labTrendSvg(s, { width: cw - gap, scaled, style: t }));
  const ch = drawn.length ? Number(/height="([\d.]+)/.exec(drawn[0])[1]) : 0;
  const body = drawn.map((svg, i) => svg.replace('<svg ', `<svg x="${(i % cols) * cw}" y="${Math.floor(i / cols) * (ch + gap)}" `)).join('');
  const rows = Math.ceil(drawn.length / cols);
  return svgRoot(t, width, rows ? rows * (ch + gap) : ch, body, { title: 'Laboratory results over time', desc: `${drawn.length} ${drawn.length === 1 ? 'chart' : 'charts'}` });
}
