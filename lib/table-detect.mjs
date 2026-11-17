// Finding tables on a PDF page, and reading one into rows and columns
// (plan §4.5a). From text positions and ruling lines only (lib/page-layout.mjs):
// no OCR, no model, the same answer every time.
//
// A table here is a block of lines that split into cells at wide gaps, whose
// cells line up in columns down the block, set apart from running text by its
// short cells, and usually held between horizontal rules. What it will not find
// is a table set as an image, a table with one column, or one whose columns
// are not aligned; it can be fooled by a two-column list of short lines. A
// person drawing a box around the table skips detection and goes straight to
// reading (readTable), and every table read is reviewed before it is used.

const words = s => s.trim().split(/\s+/).filter(Boolean).length;
const isNumberish = s => /\d/.test(s) && s.replace(/[\d\s.,:;%()±+\-−–≥≤<>=~/*†‡§¶\[\]]/g, '').length <= 3;

/** Text runs grouped into lines (top to bottom), each split into cells at wide gaps. */
export function textLines(items, { gapEm = 0.75 } = {}) {
  const sorted = [...items].sort((a, b) => b.y1 - a.y1 || a.x1 - b.x1);
  const lines = [];
  for (const it of sorted) {
    const cy = (it.y1 + it.y2) / 2;
    const line = lines.find(l => Math.abs(cy - l.cy) <= 0.5 * Math.max(it.h, l.h));
    if (line) {
      line.items.push(it);
      line.h = Math.max(line.h, it.h);
      line.cy = line.items.reduce((s, x) => s + (x.y1 + x.y2) / 2, 0) / line.items.length;
    } else lines.push({ items: [it], h: it.h, cy });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x1 - b.x1);
    l.y = Math.min(...l.items.map(i => i.y1));            // the baseline
    l.top = Math.max(...l.items.map(i => i.y2));
    const cells = [];
    for (const it of l.items) {
      const c = cells[cells.length - 1];
      if (c && it.x1 - c.x2 < gapEm * l.h) { c.text += (it.x1 - c.x2 > 0.12 * l.h && !/\s$/.test(c.text) ? ' ' : '') + it.str.trim(); c.x2 = Math.max(c.x2, it.x2); c.y2 = Math.max(c.y2, it.y2); c.y1 = Math.min(c.y1, it.y1); }
      else cells.push({ text: it.str.trim(), x1: it.x1, x2: it.x2, y1: it.y1, y2: it.y2 });
    }
    l.cells = cells; l.x1 = cells[0].x1; l.x2 = cells[cells.length - 1].x2;
  }
  return lines.sort((a, b) => b.y - a.y);
}

/** A line of running text split by a column gutter: every cell is a stretch of prose. */
const proseLike = l => l.cells.length >= 2 && l.cells.every(c => words(c.text) >= 5);

/** Columns of a block: the x-extents that cells occupy, merged where they overlap. Only rows with most of the cells decide. */
export function columnsOf(lines, { tol = 0.5 } = {}) {
  const body = lines.filter(l => l.cells.length >= 2);
  const most = Math.max(...body.map(l => l.cells.length), 0);
  const deciding = body.filter(l => l.cells.length >= Math.max(2, Math.ceil(0.6 * most)));
  const cells = deciding.flatMap(l => l.cells).sort((a, b) => a.x1 - b.x1);
  const cols = [];
  for (const c of cells) {
    const last = cols[cols.length - 1];
    if (last && c.x1 <= last.x2 + tol) { last.x2 = Math.max(last.x2, c.x2); last.n++; } else cols.push({ x1: c.x1, x2: c.x2, n: 1 });
  }
  return cols;
}

function block(lines, rules) {
  const cells = lines.flatMap(l => l.cells);
  const rect = { x1: Math.min(...cells.map(c => c.x1)), x2: Math.max(...cells.map(c => c.x2)), y1: Math.min(...lines.map(l => l.y)) - 0.25 * lines[0].h, y2: Math.max(...lines.map(l => l.top)) };
  const h = median(lines.map(l => l.h));
  const width = rect.x2 - rect.x1;
  // rules that belong: across most of the width, inside the block or just outside it
  const mine = rules.filter(r => r.horizontal && Math.min(r.x2, rect.x2) - Math.max(r.x1, rect.x1) >= 0.6 * width
    && r.x1 >= rect.x1 - 4 * width && r.x2 <= rect.x2 + 1 * width
    && r.y1 >= rect.y1 - 2.2 * h && r.y1 <= rect.y2 + 2.2 * h);
  for (const r of mine) { rect.x1 = Math.min(rect.x1, r.x1); rect.x2 = Math.max(rect.x2, r.x2); rect.y1 = Math.min(rect.y1, r.y1 - 1); rect.y2 = Math.max(rect.y2, r.y1 + 1); }
  return { lines, rect, ruled: mine.length >= 2, rules: mine.length, h };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** How well the cells of a block line up in columns: the share whose left, right or centre edge sits on an edge shared with another row. */
function alignment(lines, tol) {
  const cells = lines.filter(l => l.cells.length >= 2).flatMap(l => l.cells.map(c => ({ ...c, row: l })));
  const groups = key => {
    const s = [...cells].sort((a, b) => key(a) - key(b)); const out = []; let g = [];
    for (const c of s) { if (g.length && key(c) - key(g[g.length - 1]) > tol) { out.push(g); g = []; } g.push(c); }
    if (g.length) out.push(g); return out;
  };
  const shared = new Set();
  for (const key of [c => c.x1, c => c.x2, c => (c.x1 + c.x2) / 2])
    for (const g of groups(key)) if (new Set(g.map(c => c.row)).size >= 2) g.forEach(c => shared.add(c));
  return cells.length ? shared.size / cells.length : 0;
}

/**
 * Regions held by vertical rules: a grid table draws its columns, and a
 * frame drawn around it says where it ends, however its text is set out
 * inside. Vertical rules that overlap in height belong together; their
 * extent is the frame if horizontal rules run across it.
 */
export function ruleFrames(rules, page = {}) {
  const v = rules.filter(r => !r.horizontal && r.y2 - r.y1 >= 12).sort((a, b) => a.y1 - b.y1);
  const groups = [];
  for (const r of v) {
    const g = groups.find(g => r.y1 <= g.y2 + 32 && r.y2 >= g.y1 - 32 && r.x1 >= g.x1 - 4 && r.x1 <= g.x2 + 4 + 400);
    if (g) { g.rules.push(r); g.y1 = Math.min(g.y1, r.y1); g.y2 = Math.max(g.y2, r.y2); g.x1 = Math.min(g.x1, r.x1); g.x2 = Math.max(g.x2, r.x1); }
    else groups.push({ rules: [r], x1: r.x1, x2: r.x1, y1: r.y1, y2: r.y2 });
  }
  // groups whose extents touch are one frame (a table drawn in parts)
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < groups.length && !again; i++) for (let j = i + 1; j < groups.length && !again; j++) {
      const a = groups[i], b = groups[j];
      const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1), smaller = Math.min(a.y2 - a.y1, b.y2 - b.y1);
      const beside = a.x1 <= b.x2 + 120 && b.x1 <= a.x2 + 120 && overlapY >= 0.5 * smaller;
      if ((a.x1 <= b.x2 + 6 && b.x1 <= a.x2 + 6 && a.y1 <= b.y2 + 40 && b.y1 <= a.y2 + 40) || beside) {
        a.rules.push(...b.rules); a.x1 = Math.min(a.x1, b.x1); a.x2 = Math.max(a.x2, b.x2); a.y1 = Math.min(a.y1, b.y1); a.y2 = Math.max(a.y2, b.y2);
        groups.splice(j, 1); again = true;
      }
    }
  }
  const out = [];
  for (const g of groups) {
    const w = g.x2 - g.x1, h = g.y2 - g.y1;
    if (w < 100 || h < 18) continue;
    const across = rules.filter(r => r.horizontal && r.y1 >= g.y1 - 3 && r.y1 <= g.y2 + 3 && Math.min(r.x2, g.x2) - Math.max(r.x1, g.x1) >= 0.8 * w);
    if (across.length < 2) continue;
    if (page.width && w > 0.95 * page.width && page.height && h > 0.9 * page.height) continue;   // a border around the whole page
    out.push({ x1: g.x1, x2: g.x2, y1: g.y1, y2: g.y2 });
  }
  return out.filter(f => !out.some(o => o !== f && f.x1 >= o.x1 - 3 && f.x2 <= o.x2 + 3 && f.y1 >= o.y1 - 3 && f.y2 <= o.y2 + 3));
}

/**
 * The x of the gutter between two text columns, when the page has one: a
 * narrow band that almost no line of text crosses, with text on both sides.
 * Tables beside running text are found on each side separately, so the
 * text next to a table is never taken for one of its columns.
 */
export function gutterOf(layout) {
  const lines = textLines(layout.items);
  const W = layout.width || 0, ox = (layout.origin || [0, 0])[0];
  if (!W || lines.length < 16) return null;
  let best = null;
  for (let x = ox + 0.4 * W; x <= ox + 0.6 * W; x += 1) {
    let cross = 0, left = 0, right = 0;
    for (const l of lines) {
      if (l.cells.some(c => c.x1 < x + 3 && c.x2 > x - 3)) cross++;
      if (l.x1 < x - 20) left++;
      if (l.x2 > x + 20) right++;
    }
    if (left >= 8 && right >= 8 && (!best || cross < best.cross)) best = { x, cross };
  }
  return best && best.cross <= 0.12 * lines.length ? best.x : null;
}

/**
 * Tables on a page. layout: { items, rules, width, height, origin } from
 * pageLayout. Returns [{ rect, rows, columns, ruled, score, caption }] top to
 * bottom, rect in page units.
 */
export function detectTables(layout, opts = {}) {
  const g = gutterOf(layout);
  if (g == null) return detectIn(layout, opts);
  const side = left => detectIn({ ...layout, items: layout.items.filter(i => ((i.x1 + i.x2) / 2 < g) === left),
    rules: (layout.rules || []).filter(r => (left ? r.x2 <= g + 6 : r.x1 >= g - 6)) }, opts);
  // a table across both columns has its own columns on each side of the gutter
  const all = textLines(layout.items);
  // and is not made of running text from the next column: the cells across the gutter are short
  const shortAcross = t => {
    const cells = all.filter(l => l.y >= t.rect.y1 && l.top <= t.rect.y2).flatMap(l => l.cells).filter(c => c.x1 > g);
    return cells.length >= 4 && cells.filter(c => words(c.text) <= 5).length >= 0.8 * cells.length;
  };
  const wide = detectIn(layout, opts).filter(t => t.rect.x1 < g - 25 && t.rect.x2 > g + 25 && (t.frame || t.columns >= 4) && shortAcross(t));
  const inWide = t => wide.some(w => t.rect.x1 >= w.rect.x1 - 5 && t.rect.x2 <= w.rect.x2 + 5 && t.rect.y1 >= w.rect.y1 - 5 && t.rect.y2 <= w.rect.y2 + 5);
  return [...wide, ...side(true).filter(t => !inWide(t)), ...side(false).filter(t => !inWide(t))].sort((a, b) => b.rect.y2 - a.rect.y2 || a.rect.x1 - b.rect.x1);
}

/** Detection on one set of lines. layout: { items, rules } from pageLayout. Returns
 * [{ rect, rows, columns, ruled, score, caption }] top to bottom, rect in
 * page units.
 */
function detectIn(layout, { minRows = 3 } = {}) {
  const lines = textLines(layout.items);
  const rules = layout.rules || [];
  const blocks = []; let cur = null, pending = [];
  const close = () => { if (cur && cur.length) blocks.push(cur); cur = null; pending = []; };
  let prev = null;
  for (const l of lines) {
    const tab = l.cells.length >= 2 && !proseLike(l);
    const gap = prev ? prev.y - l.y : 0;
    const near = prev && gap <= 2.7 * Math.max(prev.h, l.h);
    if (tab) {
      if (cur && near) { cur.push(...pending, l); pending = []; }
      else { close(); cur = [l]; }
      prev = l;
    } else if (cur && near && pending.length < 2 && words(l.cells[0].text) <= 12) { pending.push(l); prev = l; }
    else { close(); prev = l; }
  }
  close();

  // blocks split by a rule or a small gap, with the same columns, are one table
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last) {
      const la = last[last.length - 1], f = b[0];
      const gap = la.y - f.y;
      const between = rules.some(r => r.horizontal && r.y1 < la.y && r.y1 > f.top && r.x2 - r.x1 > 0.5 * (Math.max(la.x2, f.x2) - Math.min(la.x1, f.x1)));
      const overlap = Math.min(la.x2, f.x2, Math.max(...last.flatMap(l => l.cells.map(c => c.x2)))) - Math.max(la.x1, f.x1);
      const cols = columnsOf([...last, ...b]).length;
      if (gap <= (between ? 4.5 : 3.2) * la.h && overlap > 0 && cols <= Math.max(columnsOf(last).length, columnsOf(b).length) + 1) { merged[merged.length - 1] = [...last, ...b]; continue; }
    }
    merged.push(b);
  }

  const out = [];
  // a frame of rules is a table whatever its inside looks like; text blocks inside it are its rows
  const frames = ruleFrames(rules, layout);
  const inFrame = c => frames.find(f => c.x >= f.x1 - 2 && c.x <= f.x2 + 2 && c.y >= f.y1 - 2 && c.y <= f.y2 + 2);
  const framed = new Set();
  for (const f of frames) {
    const inside = lines.filter(l => l.x1 >= f.x1 - 3 && l.x2 <= f.x2 + 3 && l.y >= f.y1 - 3 && l.top <= f.y2 + 3);
    if (inside.filter(l => l.cells.length >= 2).length < 2) continue;
    framed.add(f);
    const top = inside[0];
    const above = lines.filter(l => l.y > f.y2 && l.y - f.y2 < 5 * top.h && /^(table|tab\.)\s*[A-Z]?\d+/i.test(l.cells.map(c => c.text).join(' '))).sort((a, b) => a.y - b.y)[0];
    out.push({ rect: { ...f }, rows: inside.length, columns: columnsOf(inside).length, ruled: true, score: 1, frame: true,
      caption: above ? above.cells.map(c => c.text).join(' ').slice(0, 160) : '' });
  }
  for (const ls of merged) {
    const mid = { x: (Math.min(...ls.map(l => l.x1)) + Math.max(...ls.map(l => l.x2))) / 2, y: (ls[0].top + ls[ls.length - 1].y) / 2 };
    if (inFrame(mid) && framed.has(inFrame(mid))) continue;
    const tabLines = ls.filter(l => l.cells.length >= 2);
    const bl = block(ls, rules);
    const cols = columnsOf(ls, { tol: 0.5 });
    const solid = cols.filter(c => c.n >= Math.max(2, 0.4 * tabLines.length));
    const align = alignment(ls, Math.max(2.5, 0.35 * bl.h));
    const cells = tabLines.flatMap(l => l.cells);
    const short = cells.filter(c => words(c.text) <= 6).length / cells.length;
    const numeric = cells.filter(c => isNumberish(c.text)).length / cells.length;
    const meanChars = cells.reduce((s, c) => s + c.text.length, 0) / cells.length;
    // a running head or foot (journal, year, page) is two cells above or below the text, often with a rule
    const H = layout.height || 0, o = (layout.origin || [0, 0])[1];
    const margin = H && (bl.rect.y1 > o + 0.92 * H || bl.rect.y2 < o + 0.07 * H);
    const need = bl.ruled && solid.length >= 3 ? Math.min(2, minRows) : minRows;
    let score = 0;
    score += Math.min(1, tabLines.length / 6) * 0.25 + align * 0.3 + short * 0.15 + Math.min(1, numeric * 2) * 0.15 + (bl.ruled ? 0.15 : 0);
    const twoColumnProse = solid.length <= 2 && numeric < 0.15 && meanChars > 26 && !bl.ruled;
    const longShare = cells.filter(c => words(c.text) >= 5).length / cells.length;
    // justified text has both edges flush; a table of words rarely does
    const maxX2 = Math.max(...tabLines.map(l => l.x2)), flush = tabLines.filter(l => maxX2 - l.x2 < 1.5).length / tabLines.length;
    const proseBlock = !bl.ruled && numeric < 0.15 && (longShare > 0.4 || flush > 0.7);
    const ok = !(margin && solid.length <= 3) && tabLines.length >= need && solid.length >= 2 && align >= 0.7 && short >= 0.6 && !twoColumnProse && !proseBlock && score >= 0.55;
    if (!ok) continue;
    const top = ls[0];
    const above = lines.filter(l => l.y > top.y && l.y - top.y < 5 * top.h && /^(table|tab\.)\s*[A-Z]?\d+/i.test(l.cells.map(c => c.text).join(' '))).sort((a, b) => a.y - b.y)[0];
    out.push({ rect: bl.rect, rows: ls.length, columns: solid.length, ruled: bl.ruled, score: Math.round(score * 100) / 100,
      caption: above ? above.cells.map(c => c.text).join(' ').slice(0, 160) : '' });
  }
  // one region found twice (by its frame and by its text) is one table
  const area = r => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
  const inter = (a, b) => area({ x1: Math.max(a.x1, b.x1), x2: Math.min(a.x2, b.x2), y1: Math.max(a.y1, b.y1), y2: Math.min(a.y2, b.y2) });
  const kept = [];
  for (const t of [...out].sort((a, b) => Number(!!b.frame) - Number(!!a.frame) || area(b.rect) - area(a.rect)))
    if (!kept.some(k => inter(k.rect, t.rect) >= 0.5 * Math.min(area(k.rect), area(t.rect)))) kept.push(t);
  return kept.sort((a, b) => b.rect.y2 - a.rect.y2 || a.rect.x1 - b.rect.x1);
}

/**
 * The cells of the text inside a rectangle, as rows and columns.
 * region: { x1, y1, x2, y2 } in page units (any corner order). Returns
 * { rows: [[{ text, rect, span }]], columns } where every row has one entry
 * per column ('' where empty), and a cell that crosses columns has span > 1
 * and sits in its first. Wrapped cells are not merged: a person does that in
 * review, where a row can be joined to the one above.
 */
export function readTable(layout, region) {
  const x1 = Math.min(region.x1, region.x2), x2 = Math.max(region.x1, region.x2);
  const y1 = Math.min(region.y1, region.y2), y2 = Math.max(region.y1, region.y2);
  const inside = layout.items.filter(i => (i.x1 + i.x2) / 2 >= x1 && (i.x1 + i.x2) / 2 <= x2 && (i.y1 + i.y2) / 2 >= y1 && (i.y1 + i.y2) / 2 <= y2);
  const lines = textLines(inside);
  if (!lines.length) return { rows: [], columns: [] };
  const columns = columnsOf(lines);
  if (columns.length < 2) columns.splice(0, columns.length, { x1: Math.min(...lines.map(l => l.x1)), x2: Math.max(...lines.map(l => l.x2)), n: lines.length });
  const centre = c => (c.x1 + c.x2) / 2;
  const rows = lines.map(l => {
    const row = columns.map(() => ({ text: '', rect: null, span: 1 }));
    for (const c of l.cells) {
      const hit = columns.map((col, i) => (c.x2 > col.x1 + 0.5 && c.x1 < col.x2 - 0.5 ? i : -1)).filter(i => i >= 0);
      let at = hit.length ? hit[0] : columns.reduce((best, col, i) => (Math.abs(centre(col) - centre(c)) < Math.abs(centre(columns[best]) - centre(c)) ? i : best), 0);
      const cell = row[at];
      cell.text = cell.text ? `${cell.text} ${c.text}` : c.text;
      cell.rect = cell.rect ? { x1: Math.min(cell.rect.x1, c.x1), x2: Math.max(cell.rect.x2, c.x2), y1: Math.min(cell.rect.y1, c.y1), y2: Math.max(cell.rect.y2, c.y2) } : { x1: c.x1, x2: c.x2, y1: c.y1, y2: c.y2 };
      if (hit.length > 1) cell.span = Math.max(cell.span, hit.length);
    }
    return row;
  });
  return { rows, columns };
}

/** Rows as plain text, for a CSV or a paste. */
export const tableText = rows => rows.map(r => r.map(c => c.text));
