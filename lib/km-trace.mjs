// Reading a Kaplan–Meier curve off a picture (plan §4.8a).
//
// Two steps, both plain arithmetic on pixels:
//   calibration  two known points on each axis turn pixel positions into time
//                and survival (linear or log axis);
//   tracing      the curve is the pixels of one colour; for each column of the
//                picture the level of the curve is found, a drop is a run
//                that starts at the current level and reaches down, and a
//                censor tick is a run that reaches above it.
// A person can always move, add or remove points afterwards: tracing proposes,
// the person decides.

/**
 * A mapping between pixels and data from two points per axis.
 * x: [{px, val}, {px, val}], y: [{py, val}, {py, val}]. Log axes interpolate
 * the logarithm. `percent` reads a 0–100 survival axis as 0–1.
 */
export function calibration({ x, y, xLog = false, yLog = false, percent = false }) {
  const ok = a => Array.isArray(a) && a.length === 2 && a.every(p => Object.values(p).every(Number.isFinite));
  if (!ok(x) || !ok(y)) throw new Error('Two points on each axis are needed');
  if (x[0].px === x[1].px || y[0].py === y[1].py) throw new Error('The two points on an axis must differ');
  if (x[0].val === x[1].val || y[0].val === y[1].val) throw new Error('The two values on an axis must differ');
  if ((xLog && x.some(p => p.val <= 0)) || (yLog && y.some(p => p.val <= 0))) throw new Error('A log axis needs positive values');
  const f = (v, log) => (log ? Math.log10(v) : v);
  const g = (v, log) => (log ? 10 ** v : v);
  const ax = (f(x[1].val, xLog) - f(x[0].val, xLog)) / (x[1].px - x[0].px);
  const ay = (f(y[1].val, yLog) - f(y[0].val, yLog)) / (y[1].py - y[0].py);
  const scale = percent ? 0.01 : 1;
  return {
    toData: (px, py) => ({
      t: g(f(x[0].val, xLog) + (px - x[0].px) * ax, xLog),
      s: g(f(y[0].val, yLog) + (py - y[0].py) * ay, yLog) * scale,
    }),
    toPixel: (t, s) => ({
      px: x[0].px + (f(t, xLog) - f(x[0].val, xLog)) / ax,
      py: y[0].py + (f(s / scale, yLog) - f(y[0].val, yLog)) / ay,
    }),
    // pixels per unit of survival: how much one pixel of error costs
    sPerPixel: Math.abs(ay) * scale,
  };
}

export const hexToRgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

/**
 * The pixel a click on a curve most plausibly meant: the darkest-saturated
 * colour among the pixels around it, so a click a pixel or two off the line
 * still picks the line and not the white beside it.
 */
export function pickColour(img, px, py, r = 3) {
  let best = null, bestScore = -1;
  for (let y = Math.round(py) - r; y <= Math.round(py) + r; y++)
    for (let x = Math.round(px) - r; x <= Math.round(px) + r; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const score = 765 - (c[0] + c[1] + c[2]) + 2 * (Math.max(...c) - Math.min(...c));
      if (score > bestScore) { bestScore = score; best = c; }
    }
  return best;
}

/** The paper colour of the plot area: the commonest colour in the box, so a tinted background is not mistaken for ink. */
export function backgroundOf(img, box) {
  const bins = new Map();
  const x0 = Math.max(0, Math.floor(box.x0)), x1 = Math.min(img.width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0)), y1 = Math.min(img.height - 1, Math.ceil(box.y1));
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const i = (y * img.width + x) * 4, key = (img.data[i] >> 4) * 256 + (img.data[i + 1] >> 4) * 16 + (img.data[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += img.data[i]; b.g += img.data[i + 1]; b.b += img.data[i + 2]; bins.set(key, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round) : [255, 255, 255];
}

/**
 * How much of a pixel is ink of a given colour, 0 to 1, and how well it fits.
 * A line thinner than a pixel is drawn as a blend of its colour and the paper;
 * matching the colour alone loses it, so a pixel counts by how far along the
 * way from paper to ink it lies (the projection), provided it lies on that way.
 */
function coverage(data, i, bg, ink, span2, tolRes) {
  const dr = bg[0] - data[i], dg = bg[1] - data[i + 1], db = bg[2] - data[i + 2];
  const a = (dr * (bg[0] - ink[0]) + dg * (bg[1] - ink[1]) + db * (bg[2] - ink[2])) / span2;
  if (a < 0.3 || a > 1.35) return 0;
  const er = dr - a * (bg[0] - ink[0]), eg = dg - a * (bg[1] - ink[1]), eb = db - a * (bg[2] - ink[2]);
  // a coloured ink is never neutral grey, however pale: the edge of a black frame is not the edge of a red line
  const chroma = Math.max(ink[0], ink[1], ink[2]) - Math.min(ink[0], ink[1], ink[2]);
  if (chroma >= 40 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 0.5 * a * chroma) return 0;
  // the further from ink, the less off the paper-to-ink line a pixel may lie: pale grey is not pale red
  const lim = Math.min(tolRes, 0.35 * a * Math.sqrt(span2) + 10);
  return er * er + eg * eg + eb * eb <= lim * lim ? Math.min(1, a) : 0;
}

/**
 * Trace one curve.
 * img: { width, height, data } as ImageData. colour: [r, g, b]. tol: how far
 * off the paper-to-ink line a pixel may lie. box: { x0, y0, x1, y1 } the plot
 * area in pixels (the axes and the numbers below them are left out by it).
 * others: the colours of the other curves in the figure, so that a curve is
 * not read from the edge of its neighbour (black beside grey).
 * Returns { points: [{px, py}] in pixel positions (a drop is two points at one
 * column, a gap in the colour is carried), thickness, columns }.
 */
export function traceCurve(img, { colour, tol = 60, box, others = [], background }) {
  const { width, height, data } = img;
  const x0 = Math.max(0, Math.floor(box.x0)), x1 = Math.min(width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0)), y1 = Math.min(height - 1, Math.ceil(box.y1));
  const bg = background || backgroundOf(img, box);
  const span2 = (bg[0] - colour[0]) ** 2 + (bg[1] - colour[1]) ** 2 + (bg[2] - colour[2]) ** 2;
  if (span2 < 40 * 40) return { points: [], thickness: 0, columns: 0 };   // ink indistinguishable from paper
  const tolRes = Math.min(tol, Math.sqrt(span2) * 0.4);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const ink = new Float32Array(bw * bh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    ink[(y - y0) * bw + (x - x0)] = coverage(data, (y * width + x) * 4, bg, colour, span2, tolRes);
  // The frame of the plot and its gridlines run the whole width or height: no curve does. A colour shared
  // with them (a black curve inside a black frame) must not lead the trace along them.
  for (let y = 0; y < bh; y++) {
    let run = 0, start = 0;
    for (let x = 0; x <= bw; x++) {
      if (x < bw && ink[y * bw + x] > 0) { if (!run) start = x; run++; }
      else { if (run >= 0.9 * bw) for (let k = start; k < x; k++) ink[y * bw + k] = 0; run = 0; }
    }
  }
  for (let x = 0; x < bw; x++) {
    let run = 0, start = 0;
    for (let y = 0; y <= bh; y++) {
      if (y < bh && ink[y * bw + x] > 0) { if (!run) start = y; run++; }
      else { if (run >= 0.9 * bh) for (let k = start; k < y; k++) ink[k * bw + x] = 0; run = 0; }
    }
  }
  // a pixel that is another curve's own colour, or the edge of one, is not ours
  for (const o of others) {
    const oSpan2 = (bg[0] - o[0]) ** 2 + (bg[1] - o[1]) ** 2 + (bg[2] - o[2]) ** 2;
    if (oSpan2 < 40 * 40) continue;
    const core = new Uint8Array(bw * bh);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if ((data[i] - o[0]) ** 2 + (data[i + 1] - o[1]) ** 2 + (data[i + 2] - o[2]) ** 2 < 30 * 30 &&
          (data[i] - colour[0]) ** 2 + (data[i + 1] - colour[1]) ** 2 + (data[i + 2] - colour[2]) ** 2 > 30 * 30) core[(y - y0) * bw + (x - x0)] = 1;
    }
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = y * bw + x; if (!ink[k]) continue;
      { const i = ((y + y0) * width + x + x0) * 4; if ((data[i] - colour[0]) ** 2 + (data[i + 1] - colour[1]) ** 2 + (data[i + 2] - colour[2]) ** 2 < 30 * 30) continue; }   // this curve's own ink stays
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < bh && xx >= 0 && xx < bw && core[yy * bw + xx]) { hit = true; break; }
      }
      if (hit) ink[k] = 0;
    }
  }
  // runs of ink in each column, with the ink-weighted centre and total
  const cols = [];
  for (let x = 0; x < bw; x++) {
    const runs = []; let a = -1, sum = 0, mom = 0;
    for (let y = 0; y <= bh; y++) {
      const v = y < bh ? ink[y * bw + x] : 0;
      if (v > 0 && a < 0) { a = y; sum = 0; mom = 0; }
      if (v > 0) { sum += v; mom += v * y; }
      if (v === 0 && a >= 0) { runs.push({ a: a + y0, b: y - 1 + y0, sum, centre: mom / sum + y0 }); a = -1; }
    }
    cols.push(runs);
  }
  // The line's thickness: most columns of a curve are flat, so the height of a
  // lone run near the low end of the heights is the line's; its ink (which
  // counts a thin line drawn across two rows once) is the thickness.
  const alone = cols.filter(r => r.length === 1);
  if (!alone.length) return { points: [], thickness: 0, columns: 0 };
  const heights = alone.map(r => r[0].b - r[0].a + 1).sort((p, q) => p - q);
  const hRef = heights[Math.floor(heights.length * 0.3)];
  const flat = alone.filter(r => r[0].b - r[0].a + 1 <= hRef + 1).map(r => r[0].sum).sort((p, q) => p - q);
  const thick = Math.max(0.8, flat[Math.floor(flat.length / 2)]);
  const tolY = Math.max(1.5, thick * 0.75);
  const span = r => r.b - r.a + 1;
  const dist = (r, level) => (level >= r.a - 0.5 && level <= r.b + 0.5 ? 0 : Math.min(Math.abs(r.a - level), Math.abs(r.b - level)));

  const points = [];
  let level = null;      // the pixel row of the curve's centre
  let matched = 0, lastAt = 0, gap = 0;
  for (let k = 0; k < cols.length; k++) {
    const x = x0 + k, runs = cols[k];
    if (!runs.length) continue;
    // The curve never rises: the run holding, or nearest below, the current
    // level. The first column starts at the top. After a gap in the ink the
    // level may be stale, so how far away a run may be grows with the gap.
    gap = k - lastAt;
    const slack = tolY + thick / 2;
    const pool = level == null ? runs : runs.filter(r => r.b >= level - slack - 0.5);
    if (!pool.length) continue;
    const run = level == null ? pool.reduce((p, q) => (p.a <= q.a ? p : q))
      : pool.reduce((p, q) => (dist(p, level) <= dist(q, level) ? p : q));
    const { a, b } = run, h = span(run);
    if (level == null) {
      if (h > thick * 3 + 3) continue;           // not yet the line: a legend or a label
      level = run.centre; points.push({ px: x, py: level }); matched++; lastAt = k; continue;
    }
    if (dist(run, level) > thick * 8 + 20 + 4 * gap) continue;   // a different object entirely
    lastAt = k;
    matched++;
    if (a >= level - slack - 0.5 && b <= level + slack + 0.5 && h <= thick + 2 * tolY + 1) {
      level = run.centre; points.push({ px: x, py: level });          // flat
    } else if (a >= level - slack - 0.5) {
      const next = b + 0.5 - thick / 2;                                 // reaches down from the level: a drop
      points.push({ px: x, py: level }, { px: x, py: next }); level = next;
    } else {
      points.push({ px: x, py: level });                                // a tick or a mark above: the level stands
    }
  }
  return { points, thickness: thick, columns: matched };
}

/** Traced pixels as data points through a calibration. */
export const toData = (points, cal) => points.map(p => cal.toData(p.px, p.py));

/**
 * Where a censoring tick sits on a curve is not needed by the reconstruction
 * (the numbers at risk fix how many); nothing here reads them.
 */
