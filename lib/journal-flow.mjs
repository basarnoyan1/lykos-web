// The PRISMA 2020 flow diagram as a journal draws a study-selection figure, from the journal style's own declaration (lib/journal-figure.mjs
// flowLook; the journals addon declares it for The Lancet journals from their printed figures): plain outlined boxes, each line with its
// count first and its text flush left ("4028 records screened"), what a box lists set under it with the counts in a column and the text
// after them, a turned line under its own text; no phase bands and no title strips (the first line of a box says what the template's strip
// said); one line down each arm with a filled arrowhead at every box, and what leaves the flow in a box beside that line, between the two
// boxes it stands between. The same counts and the same rules for a line that does not apply as lib/prisma-flow.mjs, whose drawing and layout
// are untouched: this module is loaded only where a journal's look is asked for. The layout is written as SVG (journalFlow) and, by
// lib/flow-pptx.mjs, as PowerPoint shapes (journalFlowPptx).
import { svgRoot, text, measure, wrapText, r1, esc } from './figure-draw.mjs';

const has = v => v != null && v !== '';
const whole = v => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : null);
/** "Reason1, 4; Reason2, 7" -> [['Reason1', 4], ['Reason2', 7]]; a count that is not a whole number is null. */
const pairs = raw => String(raw ?? '').split(';').filter(p => p.trim()).map(p => { const i = p.lastIndexOf(','); return i < 0 ? [p.trim(), null] : [p.slice(0, i).trim(), whole(p.slice(i + 1))]; });
/** A label after its count: a plain capitalised first word is set in lower case ("Records" -> "records"; "PubMed", "RCT" and "E6" stay). */
const lower = s => (/^[A-Z][a-z]+(?=$|[\s,;:])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** The template's own nouns in the singular after a count of one ("1 report sought for retrieval"). */
const one = s => s.replace(/\b(records|reports|studies)\b/, m => ({ records: 'record', reports: 'report', studies: 'study' }[m]));
const item = (count, label, children = []) => ({ count: has(count) ? whole(count) ?? 'NA' : 'NA', label, children });
/** A line of the template itself: its noun follows its count. */
const own = (count, label, children = []) => item(count, Number(count) === 1 ? one(label) : label, children);
const sum = list => (list.length && list.every(x => typeof x.count === 'number') ? list.reduce((t, x) => t + x.count, 0) : null);
/** The lines of the template a review keeps: an optional line only with a count, or when the box has no count at all (prisma-flow.mjs countLines). */
const kept = rows => { const any = rows.some(r => has(r[1])); return rows.filter(([, v, optional]) => !optional || has(v) || !any); };
const named = raw => pairs(raw).map(([l, c]) => item(c, l));
const listed = raw => pairs(raw).map(([l, c]) => item(c, lower(l)));

/** What each box says, as items { count, label, children }: the template's lines in the journal's form. */
function contents(d, { previous, other }) {
  const fresh = previous ? 'new ' : '', b = {};
  const sources = kept([['databases', d.database_results, false, d.database_specific_results], ['registers', d.register_results, !has(d.register_specific_results), d.register_specific_results]])
    .map(([l, v, , names]) => own(v, l, named(names)));
  b.identified = sources.length === 1 ? [own(sources[0].count === 'NA' ? null : sources[0].count, `records identified from ${sources[0].label}`, sources[0].children)]
    : [own(sum(sources), 'records identified from databases and registers', sources)];
  const gone = kept([['duplicate records', d.duplicates, false], ['marked as ineligible by automation tools', d.excluded_automatic, true], ['removed for other reasons', d.excluded_other, true]]).map(([l, v]) => own(v, l));
  b.removed = gone.length === 1 ? [own(d.duplicates, 'duplicate records removed before screening')] : [own(sum(gone), 'records removed before screening', gone)];
  b.screened = [own(d.records_screened, 'records screened')];
  b.excluded = [own(d.records_excluded, 'records excluded')];
  const arm = (sought, notret, awaiting, assessed, excluded) => {
    const why = listed(excluded);
    return { sought: [own(sought, 'reports sought for retrieval')], notret: [own(notret, 'reports not retrieved'), ...(has(awaiting) ? [own(awaiting, 'reports awaiting classification')] : [])],
      assessed: [own(assessed, 'reports assessed for eligibility')], excl: [own(why.length ? sum(why) : Number(assessed) > 0 ? 0 : null, 'reports excluded', why)] };
  };
  const m = arm(d.dbr_sought_reports, d.dbr_notretrieved_reports, d.dbr_awaiting_reports, d.dbr_assessed, d.dbr_excluded);
  Object.assign(b, { sought: m.sought, notret: m.notret, assessed: m.assessed, excl2: m.excl });
  b.included = [own(d.new_studies, `${fresh}studies included in review`), ...(has(d.new_reports) ? [own(d.new_reports, `reports of ${fresh}included studies`)] : [])];
  if (other) {
    // the template's three sources only with a count, unless the arm names no source at all; any other source is a line of its own
    const more = listed(d.other_sources_results), from = [...kept([['websites', d.website_results, true], ['organisations', d.organisation_results, true], ['citation searching', d.citations_results, true], ...more.map(x => ['', x.count, true])])
      .filter(([l]) => l).map(([l, v]) => own(v, l)), ...more];
    b.oIdentified = [own(sum(from), 'records identified from other methods', from)];
    const o = arm(d.other_sought_reports, d.other_notretrieved_reports, d.other_awaiting_reports, d.other_assessed, d.other_excluded);
    Object.assign(b, { oSought: o.sought, oNotret: o.notret, oAssessed: o.assessed, oExcl: o.excl });
  }
  if (previous) {
    b.prev = [own(d.previous_studies, 'studies included in previous version of review'), ...(has(d.previous_reports) ? [own(d.previous_reports, 'reports of studies included in previous version of review')] : [])];
    b.total = [own(d.total_studies, 'total studies included in review'), ...(has(d.total_reports) ? [own(d.total_reports, 'reports of total included studies')] : [])];
  }
  return b;
}

const ARIA = { prev: 'Previous studies', identified: 'Records identified', removed: 'Records removed before screening', screened: 'Records screened', excluded: 'Records excluded',
  sought: 'Reports sought for retrieval', notret: 'Reports not retrieved', assessed: 'Reports assessed for eligibility', excl2: 'Reports excluded', oIdentified: 'Records identified via other methods',
  oSought: 'Reports sought for retrieval, other methods', oNotret: 'Reports not retrieved, other methods', oAssessed: 'Reports assessed for eligibility, other methods', oExcl: 'Reports excluded, other methods',
  included: 'Studies included in review', total: 'Total studies included in review' };

/**
 * The diagram's layout in the journal's form, as prismaFlowScene answers it (no bands, no titles) and with `look`: a box's lines are
 * { t (the text), n (its count, or null on a turned line), at and nx (where the column of counts begins and ends), x (where the text begins),
 * all from the box's left edge, and pad (how many characters shorter the count is than the longest of its list) }.
 * `opts`: { style, look } of flowLook (both needed), previous, other, title, and `page` { w } in inches, which the boxes are narrowed to fit.
 */
export function journalFlowScene(data = {}, opts = {}) {
  const { style: ts, look, previous = false, other = true, title = 'PRISMA 2020 flow diagram' } = opts;
  if (!ts || !look?.box) throw new TypeError('journalFlowScene needs the style and look of flowLook (lib/journal-figure.mjs)');
  const { gap, lead } = look, th = look.thousands, space = measure(ts, ' ') * 0.9;
  const fmt = c => (typeof c !== 'number' ? String(c) : th && c >= th.from ? String(c).replace(/\B(?=(\d{3})+$)/g, th.mark) : String(c));
  // the boxes of the journal's own widths, narrowed together when the arms are wider than the page box
  const arms = (other ? 2 : 1), armW = k => Math.max(look.box.main * k, look.box.main * k / 2 + gap.branch + look.box.side * k);
  const fixed = 2 * gap.edge + (arms - 1) * gap.column + (previous ? gap.column : 0), natural = k => fixed + arms * armW(k) + (previous ? look.box.main * k : 0);
  const pageW = opts.page?.w ? opts.page.w * (ts.unit === 'pt' ? 72 : 96) : Infinity;
  let k = 1; for (let i = 0; i < 40 && natural(k) > pageW + 1e-6 && k > 0.4; i++) k -= 0.02;
  const W = { main: look.box.main * k, side: look.box.side * k }, padX = look.box.padX, padY = look.box.padY;
  // a box: its items set as lines, the counts of a list in a column that begins where the text of the line over it begins
  const box = (id, width, items) => {
    const lines = [], inner = width - 2 * padX;
    const set = (list, x0) => {
      const cw = Math.max(...list.map(it => measure(ts, fmt(it.count)))), x = x0 + cw + space, longest = Math.max(...list.map(it => fmt(it.count).length));
      for (const it of list) {
        const n = fmt(it.count);
        wrapText(ts, it.label, Math.max(20, inner - x)).forEach((t, i) => lines.push({ t, n: i ? null : n, pad: longest - n.length, at: padX + x0, nx: padX + x0 + cw, x: padX + x, bold: false }));
        if (it.children.length) set(it.children, x);
      }
    };
    set(items, 0);
    return { id, aria: ARIA[id], width, lines, height: lines.length * lead + 2 * padY };
  };
  const c = contents(data, { previous, other }), b = {};
  const SIDE = new Set(['removed', 'excluded', 'notret', 'excl2', 'oNotret', 'oExcl']);
  for (const [id, items] of Object.entries(c)) b[id] = box(id, SIDE.has(id) ? W.side : W.main, items);

  // columns: each arm is its main column and, from a branch's length right of its line, its side boxes
  let x = gap.edge; const col = {};
  if (previous) { col.prev = x; x += W.main + gap.column; }
  col.main = x; x += armW(k) + gap.column;
  if (other) { col.other = x; x += armW(k) + gap.column; }
  const w = x - gap.column + gap.edge, sideX = cx => cx + W.main / 2 + gap.branch;

  // rows: the boxes of a row are as high as its highest; the gap under a row holds the side boxes that stand there
  const rows = [['identified', 'oIdentified', 'prev'], ['screened'], ['sought', 'oSought'], ['assessed', 'oAssessed'], ['included'], ...(previous ? [['total']] : [])].map(r => r.map(id => b[id]).filter(Boolean));
  const sides = [['removed'], ['excluded'], ['notret', 'oNotret'], ['excl2', 'oExcl'], []].map(r => r.map(id => b[id]).filter(Boolean));
  let y = gap.edge; const top = [], height = [];
  rows.forEach((r, i) => {
    top[i] = y; height[i] = Math.max(...r.map(bx => bx.height)); for (const bx of r) Object.assign(bx, { y, height: height[i] });
    y += height[i] + Math.max(gap.row, ...(sides[i] || []).map(s => s.height + 2 * gap.side));
  });
  const h = top.at(-1) + height.at(-1) + gap.edge;
  for (const id of ['identified', 'screened', 'sought', 'assessed', 'included', 'total']) if (b[id]) b[id].x = col.main;
  for (const id of ['oIdentified', 'oSought', 'oAssessed']) if (b[id]) b[id].x = col.other;
  if (b.prev) b.prev.x = col.prev;
  // a side box stands midway between the row it leaves and the next row
  sides.forEach((r, i) => { for (const s of r) { s.x = sideX(/^o/.test(s.id) ? col.other : col.main); s.y = top[i] + height[i] + (top[i + 1] - top[i] - height[i] - s.height) / 2; } });

  // arrows: down each arm from box to box, a branch from that line to each side box, and an arm that joins another at the side of the box it enters
  const arrows = [], mid = bx => bx.x + bx.width / 2;
  const down = (from, to) => arrows.push({ x1: mid(from), y1: from.y + from.height, x2: mid(to), y2: to.y, from: from.id, to: to.id, sides: ['bottom', 'top'] });
  const branch = (from, s) => arrows.push({ x1: mid(from), y1: s.y + s.height / 2, x2: s.x, y2: s.y + s.height / 2, from: null, to: s.id, sides: [null, 'left'] });
  const elbow = (from, to, tx) => { const sx = mid(from), sy = from.y + from.height, ty = to.y + to.height / 2; arrows.push({ d: `M ${r1(sx)} ${r1(sy)} V ${r1(ty)} H ${r1(tx)}`, points: [[sx, sy], [sx, ty], [tx, ty]], from: from.id, to: to.id, sides: ['bottom', tx < sx ? 'right' : 'left'] }); };
  down(b.identified, b.screened); down(b.screened, b.sought); down(b.sought, b.assessed); down(b.assessed, b.included);
  branch(b.identified, b.removed); branch(b.screened, b.excluded); branch(b.sought, b.notret); branch(b.assessed, b.excl2);
  if (other) { down(b.oIdentified, b.oSought); down(b.oSought, b.oAssessed); branch(b.oSought, b.oNotret); branch(b.oAssessed, b.oExcl); elbow(b.oAssessed, b.included, b.included.x + b.included.width); }
  if (previous) { down(b.included, b.total); elbow(b.prev, b.total, b.total.x); }

  const order = ['prev', 'identified', 'removed', 'screened', 'excluded', 'sought', 'notret', 'assessed', 'excl2', 'oIdentified', 'oSought', 'oNotret', 'oAssessed', 'oExcl', 'included', 'total'];
  return { ts, w, h, padY, lh: lead, title, name: 'PRISMA 2020 flow diagram', interactive: false, bands: [], titles: [], arrows, boxes: order.map(id => b[id]).filter(Boolean), look,
    desc: `PRISMA 2020${other ? '' : ', databases and registers only'}, drawn as the journal's style declares` };
}

/** The filled head of an arrow that ends at (x, y) coming along (dx, dy), and the point its line stops at (just inside the head's base). */
function head(look, x, y, dx, dy) {
  const [hw, hl] = look.arrow.head, bx = x - dx * hl, by = y - dy * hl, px = -dy * hw / 2, py = dx * hw / 2;
  return { poly: `${r1(x)},${r1(y)} ${r1(bx + px)},${r1(by + py)} ${r1(bx - px)},${r1(by - py)}`, end: [x - dx * (hl - 0.5), y - dy * (hl - 0.5)] };
}

/** The scene as SVG: the arrows, then the boxes over them; a count ends at its place and its text begins at its own, so both stand whatever face draws them. */
function journalFlowSvg(sc) {
  const { ts, look } = sc, out = [];
  for (const a of sc.arrows) {
    const pts = a.points || [[a.x1, a.y1], [a.x2, a.y2]], [px, py] = pts.at(-2), [x, y] = pts.at(-1), len = Math.hypot(x - px, y - py) || 1;
    const hd = head(look, x, y, (x - px) / len, (y - py) / len), line = [...pts.slice(0, -1), hd.end];
    out.push(`<path class="c-arrow" d="M ${line.map(p => `${r1(p[0])} ${r1(p[1])}`).join(' L ')}" fill="none" stroke="${ts.color.ink}" stroke-width="${ts.line.arrow}"/><polygon class="c-arrowhead" points="${hd.poly}" fill="${ts.color.ink}"/>`);
  }
  for (const bx of sc.boxes) {
    const base = bx.y + sc.padY + sc.lh / 2 + ts.size.label * 0.35;
    out.push(`<g role="group" aria-label="${esc(bx.aria)}"><rect class="c-box" x="${r1(bx.x)}" y="${r1(bx.y)}" width="${r1(bx.width)}" height="${r1(bx.height)}" fill="${ts.color.page}" stroke="${ts.color.ink}" stroke-width="${ts.line.box}"/>`
      + bx.lines.map((l, i) => (l.n == null ? '' : text(ts, bx.x + l.nx, base + i * sc.lh, l.n, { anchor: 'end' })) + text(ts, bx.x + l.x, base + i * sc.lh, l.t)).join('') + '</g>');
  }
  return svgRoot(ts, sc.w, sc.h, out.join(''), { title: sc.title, desc: sc.desc });
}

/** The PRISMA 2020 flow diagram as the journal style draws a study-selection figure: SVG. Takes prismaFlow's data and journalFlowScene's options. */
export const journalFlow = (data = {}, opts = {}) => journalFlowSvg(journalFlowScene(data, opts));

/** The same diagram as an editable PowerPoint file (lib/flow-pptx.mjs): its bytes. `spell` rewrites each drawn text. */
export async function journalFlowPptx(data = {}, opts = {}) {
  const { flowPptx } = await import('./flow-pptx.mjs');
  return flowPptx(journalFlowScene(data, opts), { spell: opts.spell });
}
