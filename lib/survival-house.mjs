// The house drawings of lib/survival-fig.mjs (FIGURE-STYLE §2, F7): the Kaplan-Meier figure and the swimmer plot as
// they are drawn when given a `style` (figureTokens). L-shaped axes with ticks and no gridlines or frame; groups told
// apart by dash, weight and the ink / axis grey, and named at the end of their curve (a name that needs more than two
// lines becomes a key listed under the figure); the number at risk under the axis in the axis's own columns; the title
// is not drawn (it is the figure's <title>). Every colour and size is a token of the style.
import { textWidth } from './textwidth.mjs';
import { svgRoot, text, lines, labelColumn, rowHeight, wrapText, axisLine, sourceBlock, r1, GAP, LINE, keyLines } from './figure-draw.mjs';
import { xyPlot, noteFigure, legendRows, seriesStyle, strokeOf, seg, tip, widthOf, sourceOf } from './plot-draw.mjs';

const sizeOfSvg = svg => { const v = (svg.match(/viewBox="([^"]+)"/)?.[1] || '').split(/\s+/).map(Number); return { width: v[2] || 0, height: v[3] || 0 }; };
/** Where every string landed, read back from the drawing, so a test can tell whether two of them touch. */
export function boxesOf(svg, t) {
  const out = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const own = m[1], at = n => own.match(new RegExp(`\\s${n}="([^"]*)"`))?.[1], size = Number(at('font-size')) || t.size.label, anchor = at('text-anchor') || 'start';
    const spans = [...m[2].matchAll(/<tspan\b[^>]*\sx="([^"]*)"[^>]*\sy="([^"]*)"[^>]*>([^<]*)<\/tspan>/g)].map(s => ({ x: Number(s[1]), y: Number(s[2]), s: s[3] }));
    const parts = spans.length ? spans : [{ x: Number(at('x')), y: Number(at('y')), s: m[2].replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]+>/g, '') }];
    for (const p of parts) {
      const s = p.s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), w = textWidth(s, size, t.metrics);
      const x0 = anchor === 'end' ? p.x - w : anchor === 'middle' ? p.x - w / 2 : p.x;
      out.push({ text: s, x0, x1: x0 + w, y0: p.y - size * 0.8, y1: p.y + size * 0.25 });
    }
  }
  return out;
}

const done = (svg, t, extra = {}) => ({ svg, boxes: boxesOf(svg, t), ...sizeOfSvg(svg), ...extra });
const riskAtOf = (group, time) => { const hit = group.atRisk?.find(a => a.time === time); if (hit) return hit.n; const s = group.steps.find(x => x.time >= time); return s ? s.nRisk : 0; };

/** The Kaplan-Meier figure: `{ svg, boxes, width, height }`. `ticksOf(max, n)` is the module's niceTicks; `pText` the log-rank text. */
export function houseKm(km, opts, { ticksOf, pText }) {
  const t = opts.style, W = widthOf(t, opts.width, 'double');
  const groups = (opts.groups ? km.by.filter(g => opts.groups.includes(g.group)) : km.by).filter(g => g.steps?.length);
  if (!groups.length) return done(noteFigure(t, { title: 'Kaplan–Meier figure, no data', message: 'No follow-up data', width: W, kind: 'double' }), t);
  const P = t.pad, u = t.size.label, pct = !!opts.percent, showRisk = opts.atRisk !== false;
  const xLabel = opts.xLabel ?? 'Months', yLabel = opts.yLabel ?? (pct ? 'Survival probability (%)' : 'Survival probability');
  const col = labelColumn(t, groups.map(g => g.group), W * 0.24), sw = u * 2.2, gap = u * 0.5;
  const maxT = Math.max(...groups.map(g => g.steps.at(-1).time));
  if (!Number.isFinite(maxT) || !(opts.xMax == null || opts.xMax > 0)) return done(noteFigure(t, { title: 'Kaplan–Meier figure, no data', message: 'No follow-up data', width: W, kind: 'double' }), t);
  // pairwise marks: a bracket per pair beside the names at the curves' ends, nested in columns by the order the names stand in
  const rank = new Map([...groups.map((g, i) => ({ g: g.group, i, s: g.steps.at(-1).surv }))].sort((a, b) => b.s - a.s || a.i - b.i).map((x, k) => [x.g, k]));
  const pairs = (opts.pairs || []).filter(x => rank.has(x.a) && rank.has(x.b) && x.a !== x.b && x.mark)
    .map(x => ({ ...x, lo: Math.min(rank.get(x.a), rank.get(x.b)), hi: Math.max(rank.get(x.a), rank.get(x.b)) })).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo);
  const cols = [];
  for (const x of pairs) { let k = 0; while ((cols[k] || []).some(y => !(x.hi < y.lo || x.lo > y.hi))) k++; (cols[k] ||= []).push(x); x.k = k; }
  const sm = t.size.small, arm = u * 0.3, markW = Math.max(0, ...pairs.map(x => textWidth(x.mark, sm, t.metrics))), colStep = arm + u * 0.2 + markW + u * 0.25;
  const bracketW = cols.length ? gap + cols.length * colStep : 0;
  const plotW = W - 2 * P - (sw + gap + col.w) * 2 - bracketW;
  const given = (opts.ticks || []).map(Number).filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const xs = ticksOf(opts.xMax ?? maxT, Math.max(2, Math.floor(plotW / (t.size.small * 7))));
  const xMax = opts.xMax ?? (given.length ? Math.max(given.at(-1), 1) : xs.max);
  const xTicks = given.length ? given.filter(v => v <= xMax) : (opts.xMax ? xs.ticks.filter(v => v <= xMax) : xs.ticks);
  const riskTimes = (opts.atRiskTimes || []).map(Number).filter(v => Number.isFinite(v) && v >= 0 && v <= xMax);
  const riskCols = riskTimes.length ? [...new Set(riskTimes)].sort((a, b) => a - b) : xTicks;
  const plot = xyPlot(t, { width: W, plotH: W * 0.42, xdom: [0, xMax], ydom: [0, 1], xticks: xTicks, yticks: [0, 0.2, 0.4, 0.6, 0.8, 1], yfmt: v => (pct ? String(Math.round(v * 100)) : v.toFixed(1)), xLabel, yLabel,
    leftMin: sw + gap + col.w + u * 1.6, rightPad: sw + gap * 2 + col.w + bracketW, title: `Kaplan–Meier curves for ${groups.map(g => g.group).join(', ')}`, desc: `${groups.length} group${groups.length === 1 ? '' : 's'}`, source: opts.source, keys: col.keys, seed: groups.map(g => g.group).join() });
  const { X, Y } = plot;
  const origin = { time: 0, surv: 1, lo: 1, hi: 1 };
  const vertices = (steps, pick) => {
    const pts = [[0, pick(origin)]]; let prev = pick(origin);
    for (const s of steps) { if (s.time > xMax) break; const v = pick(s); if (v !== prev) { pts.push([s.time, prev]); pts.push([s.time, v]); prev = v; } }
    pts.push([Math.min(steps.at(-1).time, xMax), prev]);
    return pts;
  };
  const path = pts => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${r1(X(a))} ${r1(Y(b))}`).join('');
  const body = [];
  groups.forEach((g, i) => {
    const st = seriesStyle(t, i);
    if (opts.ci) for (const pick of [s => s.hi ?? s.surv, s => s.lo ?? s.surv]) body.push(`<path d="${path(vertices(g.steps, pick))}" fill="none" class="${st.cls}" stroke="${st.stroke}" stroke-width="${t.line.hair}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
  });
  groups.forEach((g, i) => {
    const st = seriesStyle(t, i), ev = g.steps.reduce((a, s) => a + s.nEvent, 0);
    body.push(`<path d="${path(vertices(g.steps, s => s.surv))}" fill="none" ${strokeOf(st)} stroke-linejoin="miter">${tip(`${g.group}: ${g.n} patients, ${ev} events`)}</path>`);
    if (opts.censorMarks !== false) {
      const ticks = g.steps.filter(s => s.nCensor > 0 && s.time <= xMax).map(s => `M${r1(X(s.time))} ${r1(Y(s.surv) - u * 0.35)}V${r1(Y(s.surv) + u * 0.35)}`).join('');
      if (ticks) body.push(`<path d="${ticks}" fill="none" class="${st.cls}" stroke="${st.stroke}" stroke-width="${t.line.ci}"/>`);
    }
  });
  // names at the end of the curves, spread so none touch
  const step = u * LINE, lab = groups.map((g, i) => ({ g, i, ls: col.lines[i], want: Y(g.steps.at(-1).surv), h: col.lines[i].length * step }));
  const order = [...lab].sort((a, b) => a.want - b.want || a.i - b.i);
  let cursor = plot.top;
  for (const l of order) { l.y = Math.max(l.want - l.h / 2, cursor); cursor = l.y + l.h; }
  let ceil = plot.y1;
  for (const l of [...order].reverse()) { if (l.y + l.h > ceil) l.y = ceil - l.h; ceil = l.y; }
  const ends = order.map(l => {
    const st = seriesStyle(t, l.i), cy = l.y + l.h / 2;
    return seg(plot.x1 + gap, cy, plot.x1 + gap + sw, cy, strokeOf(st)) + lines(t, plot.x1 + gap * 2 + sw, cy, l.ls, { inner: l.ls.join(' ') === l.g.group ? '' : tip(l.g.group) });
  }).join('');
  const cyOf = new Map(order.map(l => [l.g.group, l.y + l.h / 2]));
  const namesEnd = plot.x1 + gap * 2 + sw + col.w;
  const marks = pairs.map(x => {
    const ya = cyOf.get(x.a), yb = cyOf.get(x.b), bx = namesEnd + gap + x.k * colStep + arm;
    return `<path d="M${r1(bx - arm)} ${r1(ya)}H${r1(bx)}V${r1(yb)}H${r1(bx - arm)}" fill="none" class="c-line" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>`
      + text(t, bx + u * 0.2, (ya + yb) / 2 + sm * 0.35, x.mark, { role: 'small', inner: tip(`${x.a} vs ${x.b}: ${x.label || x.mark}`) });
  }).join('');
  const pt = pText(opts);
  const over = ends + marks + (pt ? text(t, plot.x1, P + t.size.small, pt, { anchor: 'end' }) : '');
  const after = y => {
    if (!showRisk) return { svg: '', h: 0 };
    const out = [text(t, P, y + u, 'Number at risk', { role: 'head', cls: 'c-ink c-head' })];
    let yy = y + u * 1.5;
    groups.forEach((g, i) => {
      const ls = col.lines[i], h = rowHeight(t, ls.length), cy = yy + h / 2, st = seriesStyle(t, i);
      out.push(seg(P, cy, P + sw, cy, strokeOf(st)), lines(t, P + sw + gap, cy, ls));
      for (const v of riskCols) if (v <= xMax) out.push(text(t, X(v), cy + u * 0.35, String(riskAtOf(g, v)), { anchor: 'middle' }));
      yy += h;
    });
    return { svg: out.join(''), h: yy - y };
  };
  const svg = plot.finish({ clipped: body.join(''), over, after });
  return done(svg, t, { width: W });
}

// ---- swimmer ----------------------------------------------------------------------------------
const TONES = [2, 3, 4, 1, 0, 5];
/** A marker shape per kind of event: hollow, ink outline, the same size as an end marker. */
function shape(t, k, x, y, r, inner = '') {
  const o = `class="c-box" fill="${t.color.page}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"`, R = r1;
  switch (k % 5) {
    case 0: return `<circle ${o} cx="${R(x)}" cy="${R(y)}" r="${R(r)}">${inner}</circle>`;
    case 1: return `<path ${o} d="M${R(x)} ${R(y - r * 1.25)}L${R(x + r * 1.25)} ${R(y)}L${R(x)} ${R(y + r * 1.25)}L${R(x - r * 1.25)} ${R(y)}Z">${inner}</path>`;
    case 2: return `<rect ${o} x="${R(x - r)}" y="${R(y - r)}" width="${R(2 * r)}" height="${R(2 * r)}">${inner}</rect>`;
    case 3: return `<path ${o} d="M${R(x)} ${R(y - r * 1.25)}L${R(x + r * 1.25)} ${R(y + r)}L${R(x - r * 1.25)} ${R(y + r)}Z">${inner}</path>`;
    default: return `<path class="c-line" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.ci * 1.4}" d="M${R(x - r)} ${R(y - r)}L${R(x + r)} ${R(y + r)}M${R(x + r)} ${R(y - r)}L${R(x - r)} ${R(y + r)}">${inner}</path>`;
  }
}
const eventMark = (t, x, y) => `<circle class="c-dot" cx="${r1(x)}" cy="${r1(y)}" r="${r1(t.dot * 1.15)}" fill="${t.color.ink}"/>`;
const censorMark = (t, x, y) => { const r = t.dot * 1.15; return `<path class="c-dot" d="M${r1(x - r * 0.3)} ${r1(y - r)}L${r1(x + r * 1.7)} ${r1(y)}L${r1(x - r * 0.3)} ${r1(y + r)}Z" fill="${t.color.ink}"/>`; };

/** The swimmer plot: `{ svg, boxes, width, height }`. */
export function houseSwimmer(patients, opts, { ticksOf }) {
  const t = opts.style, W = widthOf(t, opts.width, 'double'), P = t.pad, u = t.size.label, sm = t.size.small, tk = sm * 0.3;
  const list = patients.filter(p => Number.isFinite(p.time));
  if (!list.length) return done(noteFigure(t, { title: 'Swimmer plot, no data', message: 'No follow-up data', width: W, kind: 'double' }), t);
  const showLabels = opts.showLabels !== false, gap = u * GAP;
  const order = opts.groups ? [...opts.groups, ...list.map(p => p.group ?? 'All').filter(g => !opts.groups.includes(g))] : list.map(p => p.group ?? 'All');
  const names = [...new Set(order)].filter(g => list.some(p => (p.group ?? 'All') === g));
  const kinds = [...new Set(list.flatMap(p => (p.markers || []).map(m => m.kind)))];
  const col = showLabels ? labelColumn(t, list.map(p => String(p.label ?? '')), W * 0.22) : { w: 0, lines: [], keys: [] };
  const left = P + col.w, right = W - P - u * 1.2, pw = right - left;
  const maxT = Math.max(...list.map(p => Math.max(p.time, ...(p.markers || []).map(m => m.t))));
  if (!Number.isFinite(maxT)) return done(noteFigure(t, { title: 'Swimmer plot, no data', message: 'No follow-up data', width: W, kind: 'double' }), t);
  const xs = ticksOf(maxT, Math.max(2, Math.floor(pw / (sm * 6)))), X = v => left + pw * v / xs.max;
  const rowMin = showLabels ? u * 1.5 : u * 0.8, parts = [], axes = [], body = [];
  let y = P, k = 0;
  const index = new Map(list.map((p, i) => [p, i]));
  names.forEach((g, gi) => {
    const rows = list.filter(p => (p.group ?? 'All') === g).map((p, i) => ({ p, i })).sort((a, b) => b.p.time - a.p.time || String(a.p.label).localeCompare(String(b.p.label)) || a.i - b.i).map(x => x.p);
    const events = rows.reduce((a, p) => a + (p.event ? 1 : 0), 0);
    y += gi ? u * 0.7 : 0;
    const hl = wrapText(t, `${g} (n = ${rows.length}, ${events} event${events === 1 ? '' : 's'})`, W - 2 * P), hh = hl.length * u * LINE;
    parts.push(lines(t, P, y + hh / 2, hl, { role: 'head', cls: 'c-ink c-head' }));
    y += hh + u * 0.3;
    const top = y, tone = TONES[gi % TONES.length];
    for (const p of rows) {
      const ln = showLabels ? col.lines[index.get(p)] : [], h = Math.max(rowMin, ln.length * u * LINE), cy = y + h / 2, bh = showLabels ? u * 0.65 : u * 0.45;
      body.push(`<rect class="c-cat${tone}" x="${r1(left)}" y="${r1(cy - bh / 2)}" width="${r1(Math.max(0, X(p.time) - left))}" height="${r1(bh)}" fill="${t.cat[tone]}" stroke="${t.color.axis}" stroke-width="${t.line.hair}">${tip(`${p.label ?? ''}: ${p.time}${p.event ? ', event' : ', no event'}`)}</rect>`);
      for (const m of p.markers || []) body.push(shape(t, kinds.indexOf(m.kind), X(m.t), cy, t.dot * 0.95));
      body.push(p.event ? eventMark(t, X(p.time), cy) : censorMark(t, X(p.time), cy));
      if (showLabels) body.push(lines(t, left - gap, cy, ln, { anchor: 'end', inner: ln.join(' ') === String(p.label ?? '') ? '' : tip(String(p.label ?? '')) }));
      y += h; k++;
    }
    axes.push([top, y]);
  });
  const bottom = y + u * 0.3;
  parts.push(...body);
  for (const [a, b] of axes) parts.push(axisLine(t, left, a, left, b));
  parts.push(axisLine(t, left, bottom, right, bottom));
  for (const v of xs.ticks) parts.push(axisLine(t, X(v), bottom, X(v), bottom + tk), text(t, X(v), bottom + sm * 1.45, String(v), { anchor: 'middle', role: 'small', cls: 'c-ink', color: t.color.ink }));
  let yy = bottom + sm * 1.45 + sm * 0.7;
  const xl = opts.xLabel ?? 'Months';
  if (xl) { parts.push(text(t, left, bottom + sm * 3, xl, { role: 'small', cls: 'c-mute' })); yy = bottom + sm * 3 + sm * 0.7; }
  const items = [{ label: 'Event', sample: (x, yv, len) => eventMark(t, x + len / 2, yv) }, { label: 'No event at last follow-up', sample: (x, yv, len) => censorMark(t, x + len / 2, yv) },
    ...kinds.map((kd, i) => ({ label: String(kd), sample: (x, yv, len) => shape(t, i, x + len / 2, yv, t.dot * 0.95) }))];
  const leg = legendRows(t, P, yy + sm * 0.5, W - 2 * P, items);
  parts.push(leg.svg); yy += sm * 0.5 + leg.h;
  const src = [...sourceOf(opts.source), ...keyLines(col.keys)];
  if (src.length) { const b = sourceBlock(t, P, yy + sm * 0.5, W - 2 * P, src); parts.push(b.svg); yy += sm * 0.5 + b.h; }
  const svg = svgRoot(t, W, yy + Math.max(P, sm * 0.6), parts.join(''), { title: `Swimmer plot of ${list.length} patients`, desc: `${names.length} group${names.length === 1 ? '' : 's'}` });
  return done(svg, t, { width: W });
}
