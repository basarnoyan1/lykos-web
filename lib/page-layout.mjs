// What a PDF page holds, as geometry: the text runs with their boxes and the
// ruling lines (plan §4.5a). Table finding reads this and nothing else, so it
// needs no OCR and no model, and the same numbers come back every time.
//
// Coordinates are the page's own (PDF user space, origin at the bottom left,
// y upward), the space the reader's anchors already use.

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Text runs and rules of one pdf.js page.
 * items: [{ str, x1, y1, x2, y2, h }] (y1 the baseline), upright text only;
 * rotated runs are counted, not returned.
 * rules: [{ x1, y1, x2, y2, horizontal }] thin filled rectangles and
 * straight strokes, long enough to be a rule.
 */
export async function pageLayout(page, OPS) {
  const [vx1, vy1, vx2, vy2] = page.view;
  const content = await page.getTextContent();
  const items = []; let rotated = 0;
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 * Math.abs(a) + 0.01 || Math.abs(c) > 0.01 * Math.abs(d) + 0.01) { rotated++; continue; }
    const h = Math.abs(it.height || d) || Math.abs(d);
    items.push({ str: it.str, x1: e, y1: f, x2: e + it.width, y2: f + h, h });
  }
  const rules = await pageRules(page, OPS);
  return { width: vx2 - vx1, height: vy2 - vy1, origin: [vx1, vy1], items, rules, rotated };
}

const MIN_RULE = 18;       // points: a joined line shorter than this is not a rule
const MIN_SEGMENT = 5;     // a border drawn cell by cell is short pieces
const MAX_THICK = 2.6;     // points: a filled bar thicker than this is a shape, not a rule

/** Ruling lines from the operator list: filled thin rectangles and stroked straight lines, through the current transform. */
export async function pageRules(page, OPS) {
  const list = await page.getOperatorList();
  const rules = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let lineWidth = 1;
  const push = (x1, y1, x2, y2, stroke, width) => {
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w >= MIN_SEGMENT && h <= MAX_THICK && (!stroke || w > 6 * h)) rules.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: (y1 + y2) / 2, y2: (y1 + y2) / 2, horizontal: true, thick: Math.max(h, width || 0) });
    else if (h >= MIN_SEGMENT && w <= MAX_THICK && (!stroke || h > 6 * w)) rules.push({ x1: (x1 + x2) / 2, x2: (x1 + x2) / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2), horizontal: false, thick: Math.max(w, width || 0) });
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === OPS.save) stack.push([ctm, lineWidth]);
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, lineWidth] = s; }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, lineWidth]); if (args?.[0]) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, lineWidth] = s; }
    else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.constructPath) {
      const op = args[0], data = args[1]?.[0] ?? args[1];
      if (![OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(op)) continue;
      const stroked = op === OPS.stroke || op === OPS.closeStroke;
      const wpt = stroked ? lineWidth * Math.hypot(ctm[0], ctm[1]) : 0;
      for (const poly of subpaths(data)) {
        const pts = poly.map(([x, y]) => apply(ctm, x, y));
        if (pts.length < 2) continue;
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        push(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), stroked, wpt);
      }
    }
  }
  return joined(dedupe(rules)).filter(r => (r.horizontal ? r.x2 - r.x1 : r.y2 - r.y1) >= MIN_RULE);
}

/** The sub-paths of a pdf.js draw-ops array (moveTo 0, lineTo 1, curveTo 2, quadraticCurveTo 3, closePath 4), each as its points. */
function subpaths(data) {
  const out = []; let cur = null;
  if (!data || typeof data.length !== 'number') return out;
  for (let i = 0; i < data.length;) {
    const c = data[i++];
    if (c === 0) { cur = [[data[i], data[i + 1]]]; out.push(cur); i += 2; }
    else if (c === 1) { cur?.push([data[i], data[i + 1]]); i += 2; }
    else if (c === 2) { cur?.push([data[i + 4], data[i + 5]]); i += 6; }
    else if (c === 3) { cur?.push([data[i + 2], data[i + 3]]); i += 4; }
    else if (c === 4) { /* close */ }
    else break;
  }
  return out;
}

/** Two strokes of one border, drawn on top of each other, are one rule. */
function dedupe(rules) {
  const out = [];
  for (const r of rules) {
    const same = out.find(o => o.horizontal === r.horizontal &&
      (r.horizontal ? Math.abs(o.y1 - r.y1) < 1 && Math.abs(o.x1 - r.x1) < 2 && Math.abs(o.x2 - r.x2) < 2
        : Math.abs(o.x1 - r.x1) < 1 && Math.abs(o.y1 - r.y1) < 2 && Math.abs(o.y2 - r.y2) < 2));
    if (!same) out.push(r);
  }
  return out;
}

/** A border drawn cell by cell is one rule: collinear segments that touch are joined. */
function joined(rules) {
  const out = [];
  for (const horizontal of [true, false]) {
    const same = rules.filter(r => r.horizontal === horizontal)
      .sort((a, b) => (horizontal ? a.y1 - b.y1 || a.x1 - b.x1 : a.x1 - b.x1 || a.y1 - b.y1));
    for (const r of same) {
      const prev = out.reverse().find(o => o.horizontal === horizontal && (horizontal ? Math.abs(o.y1 - r.y1) < 0.8 && r.x1 <= o.x2 + 2 && r.x2 >= o.x1 - 2
        : Math.abs(o.x1 - r.x1) < 0.8 && r.y1 <= o.y2 + 2 && r.y2 >= o.y1 - 2));
      out.reverse();
      if (prev) { prev.x1 = Math.min(prev.x1, r.x1); prev.x2 = Math.max(prev.x2, r.x2); prev.y1 = horizontal ? prev.y1 : Math.min(prev.y1, r.y1); prev.y2 = horizontal ? prev.y2 : Math.max(prev.y2, r.y2); }
      else out.push({ ...r });
    }
  }
  return out;
}
