// What a figure in a PDF is made of, read from the PDF's own drawing instructions (pdf.js operator list), not from a picture of it: embedded
// raster images (a photograph, a scanned chart: only digitizing can read values off it, and they stay approximate, ≈), and vector drawings
// (bars, markers and lines with the axis labels set as text: their values follow exactly from the geometry). For a vector chart the
// y axis is calibrated from its tick labels (a straight-line fit through at least three ticks, checked by its residual), and every bar top
// and marker is converted to a value in the axis's units. Nothing here decides what a value means; a figure read is still a reading.

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function subpaths(data) {
  const out = []; let cur = null;
  if (!data || typeof data.length !== 'number') return out;
  for (let i = 0; i < data.length;) {
    const c = data[i++];
    if (c === 0) { cur = [[data[i], data[i + 1]]]; out.push(cur); i += 2; }
    else if (c === 1) { cur?.push([data[i], data[i + 1]]); i += 2; }
    else if (c === 2) { cur?.push([data[i + 4], data[i + 5]]); i += 6; }
    else if (c === 3) { cur?.push([data[i + 2], data[i + 3]]); i += 4; }
    else if (c === 4) { if (cur) cur.closed = true; }
    else break;
  }
  return out;
}

/**
 * The marks of a page: { images: [{ x1, y1, x2, y2 }], rects: [{ x1, y1, x2, y2, filled }], markers: [{ x, y, w, h }], lines: [{ pts }] }
 * in page units (origin bottom left). `OPS` pdf.js's operator ids.
 */
export async function pageMarks(page, OPS) {
  const list = await page.getOperatorList();
  const out = { images: [], rects: [], markers: [], lines: [] };
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set([OPS.stroke, OPS.closeStroke]);
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(ctm, x, y)), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      out.images.push({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
    } else if (fn === OPS.constructPath) {
      const op = args[0], data = args[1]?.[0] ?? args[1];
      if (!fills.has(op) && !strokes.has(op)) continue;
      for (const poly of subpaths(data)) {
        const pts = poly.map(([x, y]) => apply(ctm, x, y));
        if (pts.length < 2) continue;
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys), w = x2 - x1, h = y2 - y1;
        const axisAligned = pts.every(([x, y]) => [x1, x2].some(v => Math.abs(v - x) < 0.6) && [y1, y2].some(v => Math.abs(v - y) < 0.6));
        if (w < 7 && h < 7 && (poly.closed || fills.has(op)) && w > 0.5 && h > 0.5) out.markers.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, w, h });
        else if (axisAligned && pts.length >= 4 && w > 1 && h > 1) out.rects.push({ x1, y1, x2, y2, filled: fills.has(op) });
        else out.lines.push({ pts });
      }
    }
  }
  return out;
}

const NUM = /^[−-]?\d+(?:[.,]\d+)?%?$/;
const num = s => Number(String(s).replace('−', '-').replace(',', '.').replace('%', ''));

/** A straight-line fit (least squares) of values on positions: { a, b, r2, max } with value = a·pos + b. */
export function fitAxis(ticks) {
  const n = ticks.length; if (n < 3) return null;
  const mx = ticks.reduce((s, t) => s + t.pos, 0) / n, my = ticks.reduce((s, t) => s + t.v, 0) / n;
  const sxx = ticks.reduce((s, t) => s + (t.pos - mx) ** 2, 0), sxy = ticks.reduce((s, t) => s + (t.pos - mx) * (t.v - my), 0);
  if (!sxx) return null;
  const a = sxy / sxx, b = my - a * mx;
  const res = ticks.map(t => Math.abs(a * t.pos + b - t.v)), syy = ticks.reduce((s, t) => s + (t.v - my) ** 2, 0);
  return { a, b, r2: syy ? 1 - res.reduce((s, r) => s + r * r, 0) / syy : 1, max: Math.max(...res) };
}

/**
 * One figure: its region (above its caption), what it is made of, and for a vector chart the values of its bars and markers.
 * `items` the page's text runs ({ str, x1, y1, x2, y2 }), `marks` from pageMarks, `caption` the caption's text run.
 */
export function readFigure(items, marks, caption, { height = 420 } = {}) {
  const top = Math.min(caption.y2 + height, 10000), x1 = caption.x1 - 40, x2 = caption.x1 + 560;
  const inR = (a, b, c, d) => a >= x1 - 1 && c <= x2 + 1 && b >= caption.y2 - 1 && d <= top;
  // the region ends at running prose above it (a long line of words)
  const prose = items.filter(i => i.y1 > caption.y2 + 4 && i.y1 < top && i.str.trim().split(/\s+/).length >= 9 && i.x1 >= x1 && i.x1 <= x2).sort((a, b) => a.y1 - b.y1)[0];
  const ceiling = prose ? prose.y1 - 2 : top;
  const R = { x1, x2, y1: caption.y2, y2: ceiling };
  const images = marks.images.filter(m => m.x2 > R.x1 && m.x1 < R.x2 && m.y2 > R.y1 && m.y1 < R.y2 && (m.x2 - m.x1) * (m.y2 - m.y1) > 400);
  const rects = marks.rects.filter(m => inR(m.x1, m.y1, m.x2, m.y2) && m.y2 <= ceiling);
  const markers = marks.markers.filter(m => m.x >= R.x1 && m.x <= R.x2 && m.y >= R.y1 && m.y <= R.y2);
  const texts = items.filter(i => i.y1 >= R.y1 && i.y2 <= R.y2 + 2 && i.x1 >= R.x1 - 2 && i.x2 <= R.x2 + 2);
  const kind = images.length && !rects.length && !markers.length ? 'raster' : images.length ? 'mixed' : rects.length || markers.length ? 'vector' : 'none';
  const out = { caption: caption.str.trim(), region: R, kind, images: images.length, rects: rects.length, markers: markers.length, labels: texts.length };
  if (kind === 'raster' || kind === 'none') return out;
  // y axis: numbers stacked in a column (same right edge), left of the marks
  const nums = texts.filter(t => NUM.test(t.str.trim()));
  const byEdge = new Map();
  for (const t of nums) { const k = Math.round(t.x2 / 3); byEdge.set(k, [...(byEdge.get(k) || []), t]); }
  const marksX = [...rects.map(r => r.x1), ...markers.map(m => m.x)];
  const left = marksX.length ? Math.min(...marksX) : R.x2;
  const col = [...byEdge.values()].filter(g => g.length >= 3 && g[0].x2 <= left + 4).sort((a, b) => b.length - a.length)[0];
  if (!col) { out.axis = null; return out; }
  const ticks = col.map(t => ({ v: num(t.str.trim()), pos: (t.y1 + t.y2) / 2, text: t.str.trim() })).sort((a, b) => a.pos - b.pos);
  const fit = fitAxis(ticks);
  if (!fit || fit.r2 < 0.9999 || fit.max > Math.abs(fit.a) * 2) { out.axis = { ticks: ticks.map(t => t.text), linear: false }; return out; }
  out.axis = { ticks: ticks.map(t => t.text), linear: true, perPoint: Math.round(fit.a * 1e6) / 1e6 };
  const val = y => Math.round((fit.a * y + fit.b) * 1000) / 1000;
  // x labels under the plot, nearest a bar's centre
  const below = texts.filter(t => !NUM.test(t.str.trim()) || !col.includes(t)).filter(t => t.y2 <= Math.min(...ticks.map(k => k.pos)) + 6);
  const labelAt = x => { const b = below.map(t => [Math.abs((t.x1 + t.x2) / 2 - x), t]).sort((a, b) => a[0] - b[0])[0]; return b && b[0] < 40 ? b[1].str.trim() : ''; };
  const zero = (0 - fit.b) / fit.a;
  out.bars = rects.filter(r => r.filled && r.x2 - r.x1 < 0.4 * (R.x2 - R.x1) && Math.abs(r.y1 - zero) < 2.5).map(r => ({ label: labelAt((r.x1 + r.x2) / 2), x: Math.round((r.x1 + r.x2) / 2), value: val(r.y2) })).sort((a, b) => a.x - b.x);
  out.points = markers.map(m => ({ label: labelAt(m.x), x: Math.round(m.x), value: val(m.y) })).sort((a, b) => a.x - b.x);
  return out;
}
