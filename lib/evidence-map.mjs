// The evidence map of a scoping review (PRISMA-ScR items 17–18): the included
// sources of evidence cross-tabulated by two charted characteristics, so the
// reader sees where evidence is concentrated and where it is absent.
//
// A charted value may name several categories ("RCT; cohort"): the source is
// counted under each. An empty value is its own category, "Not reported",
// because a gap in reporting is itself something a scoping review maps.
import { studies } from './screen.mjs';
import { fields, valueFor } from './fields.mjs';
import { tableFields } from './charts.mjs';
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text, r1, esc, hairLine, measure, matrixFrame, drawHeads, rowLabel, footBlock, emptyFigure, sourceOf } from './figure-kit.mjs';

export const NOT_REPORTED = 'Not reported';

/**
 * Charted characteristics a map can be drawn by: text and category fields, not analysis inputs, and the text columns of the project's
 * extraction tables (an imported evidence table: Rod type, Fusion technique), named without their table.
 */
export const mappableFields = s => [...fields(s).filter(f => !f.analysis && (f.type === 'text' || f.type === 'category')),
  ...tableFields(s).filter(f => f.type === 'text' || f.type === 'category').filter(f => !/^(?:id|study|study id|reference|doi|pmid)(?: ·|$)/i.test(f.label))
    .map(f => ({ ...f, label: f.label.replace(/ · [^·]+$/, '') }))];

/**
 * The pair of charted fields the map is drawn by: the pair saved with the
 * project, else design by population, else the first two mappable fields.
 * Reporting, the checklist and the export bundle all read it, so the map
 * exported is the one shown.
 */
export function mapFields(s) {
  const f = mappableFields(s).map(x => x.id), saved = s.evidenceMap || {};
  // several fields down the side (a figure's "rod and screw construct"), each a field the table still has
  const rows = Array.isArray(saved.rows) && saved.rows.length > 1 && saved.rows.every(id => f.includes(id)) ? saved.rows : null;
  const row = rows || (f.includes(saved.row) ? saved.row : f.includes('design') ? 'design' : f[0]);
  const used = rows || [row];
  const col = f.includes(saved.col) && !used.includes(saved.col) ? saved.col : f.find(x => !used.includes(x) && x === 'population') || f.find(x => !used.includes(x));
  return { row, col };
}

/**
 * The fields a figure's caption and legend name, as a map's rows and columns: `{ rows: [ids], col }` or null when it names fewer than two.
 * A field is named by the first word of its label ("rod" names Rod class and Rod type; the one with more categories is taken), in the order
 * the text names them; the columns are the field the text sets the others "by" ("stratified by fusion status"), else the one with fewest
 * categories. Figure 1 of the Spine review, "each rod and screw construct, stratified by fusion status": Rod type and Screw type by Fusion
 * technique.
 */
export function fieldsNamedIn(s, text) {
  const t = String(text || '').toLowerCase(), words = new Set(t.match(/\p{L}{3,}/gu) || []);
  const all = mappableFields(s), head = f => String(f.label).toLowerCase().match(/\p{L}{3,}/u)?.[0] || '';
  // a field's categories, its arms' values among them
  const sources = studies(s), armsOf = p => Object.keys(s.values || {}).filter(k => k.startsWith(`${p.id}:`) && k.includes('@')).map(k => k.slice(k.lastIndexOf('@') + 1));
  const cats = f => new Set(sources.flatMap(p => ['', ...new Set(armsOf(p))].flatMap(arm => categories(s, p.id, f, arm))).map(x => x.toLowerCase())).size;
  const named = [...new Set(all.map(head))].filter(w => w && words.has(w)).sort((a, b) => t.indexOf(a) - t.indexOf(b));
  const picked = named.map(w => all.filter(f => head(f) === w).map(f => [f, cats(f)]).sort((a, b) => b[1] - a[1])[0]);
  if (picked.length < 2) return null;
  const by = [...t.matchAll(/\b(?:by|according to)\s+(\p{L}+)/gu)].map(m => m[1]);
  const col = picked.find(([f]) => by.includes(head(f))) || picked.slice().sort((a, b) => a[1] - b[1])[0];
  return { rows: picked.filter(x => x !== col).map(([f]) => f.id), col: col[0].id };
}

/** A source's categories for a field (an arm's own value when `arm` is given and it has one), trimmed and de-duplicated ignoring case. */
function categories(s, paperId, field, arm = '') {
  const own = arm ? s.values?.[`${paperId}:${field.id}@${arm}`] : null;
  const raw = own && own.availability !== 'not_found' ? String(own.reported_value ?? own.normalized_value ?? '').trim() || valueFor(s, paperId, field) : valueFor(s, paperId, field);
  const parts = raw ? String(raw).split(/\s*;\s*/).map(x => x.trim()).filter(Boolean) : [];
  const seen = new Map();
  for (const p of parts) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  return seen.size ? [...seen.values()] : [NOT_REPORTED];
}

/** Category labels in order of how many sources hold them; "Not reported" last. */
function ordered(perSource) {
  const counts = new Map(), label = new Map();
  for (const list of perSource) for (const c of list) {
    const k = c.toLowerCase();
    if (!label.has(k)) label.set(k, c);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].sort((a, b) => (a[0] === NOT_REPORTED.toLowerCase()) - (b[0] === NOT_REPORTED.toLowerCase())
    || b[1] - a[1] || label.get(a[0]).localeCompare(label.get(b[0]))).map(([k]) => label.get(k));
}

/**
 * The map for two fields (or several down the side, `rowFieldId` a list): { rowField, colField, rows, cols, cells[r][c] =
 * { count, paperIds }, total }, or null when a field is not mappable.
 */
/** The field that gives an arm's size: a table column named "Arm (n)", "Patients", "Participants" or "Sample size" (its "n=25" read). */
const sizeField = s => tableFields(s).find(f => /\((?:n|N)\)|^n$|\bpatients\b|\bparticipants\b|sample size/i.test(f.label)) || null;
function sizeOf(s, paperId, field, arm) {
  if (!field) return null;
  const v = (arm && s.values?.[`${paperId}:${field.id}@${arm}`]) || s.values?.[`${paperId}:${field.id}`];
  const text = String(v?.reported_value ?? v?.normalized_value ?? '');
  const n = /\bn\s*=\s*(\d[\d,]*)/i.exec(text)?.[1] || (/^\s*(\d[\d,]*)\s*$/.exec(text)?.[1]);
  return n ? Number(n.replace(/,/g, '')) : null;
}
/** How a study's patients split between its constructs, from its own words ("Dynesys in 19/25 and Orthrus in 6/25"): name → number. */
function splitsOf(s, paperId) {
  const out = [];
  for (const [k, v] of Object.entries(s.values || {})) {
    if (!k.startsWith(`${paperId}:`)) continue;
    for (const m of String(v?.reported_value ?? '').matchAll(/([A-Za-z][\w+\-. ]*?)\s+in\s+(\d+)\s*\/\s*(\d+)/g)) out.push([m[1].trim().toLowerCase(), Number(m[2])]);
  }
  return out;
}

/**
 * The map for two fields (or several down the side, `rowFieldId` a list): { rowField, colField, rows, cols, cells[r][c] = { count, paperIds,
 * patients }, totals: { rows, cols, all } (studies, each once), patients: { rows, cols, all } | null, total }, or null when a field is not
 * mappable. A study whose table gives the fields arm by arm is each of its arms; an arm with several constructs ("Dynesys; PEEK rod" with
 * "Rigid screw; Orthrus") is each construct, lists of one length paired in order and others combined. An arm's patients are its "n=" (an
 * "Arm (n)" column), split between its constructs by the study's own words ("Dynesys in 19/25 and Orthrus in 6/25"); a construct whose share
 * is not given adds no patients, as figure1_constructs_fusion.py counts them.
 */
export function evidenceMap(s, rowFieldId, colFieldId) {
  const all = mappableFields(s), ids = Array.isArray(rowFieldId) ? rowFieldId : [rowFieldId];
  const rowFields = ids.map(id => all.find(f => f.id === id)), colField = all.find(f => f.id === colFieldId);
  if (!rowFields.length || rowFields.some(f => !f) || !colField) return null;
  // several fields down the side: a source's row is each combination of their categories ("Dynesys · Rigid")
  const rowField = rowFields.length === 1 ? rowFields[0] : { id: ids.join('+'), label: rowFields.map(f => f.label).join(' · ') };
  const sources = studies(s), size = sizeField(s);
  const fids = new Set([...ids, colField.id, ...(size ? [size.id] : [])]), arms = new Map();
  for (const k of Object.keys(s.values || {})) {
    const m = /^(.*):([^:@]+)@([^@]+)$/.exec(k);
    if (m && fids.has(m[2])) { if (!arms.has(m[1])) arms.set(m[1], new Set()); arms.get(m[1]).add(m[3]); }
  }
  const unitsOf = p => [...(arms.get(p.id) || [''])];
  const combos = (p, arm) => {
    const lists = rowFields.map(f => categories(s, p.id, f, arm)), multi = lists.filter(l => l.length > 1);
    if (multi.length > 1 && multi.every(l => l.length === multi[0].length))   // parallel lists: the nth rod with the nth screw
      return multi[0].map((_, i) => lists.map(l => (l.length > 1 ? l[i] : l[0])).join(' · '));
    return lists.reduce((acc, l) => acc.flatMap(a => l.map(c => (a ? `${a} · ${c}` : c))), ['']);
  };
  // each unit: [row combinations with their patients, column categories]
  const units = sources.map(p => {
    const splits = splitsOf(s, p.id);
    const list = unitsOf(p);
    return list.map((arm, k) => {
      // a size given for the study, not its arms, is counted once: with its first arm
      const own = arm && size && s.values?.[`${p.id}:${size.id}@${arm}`];
      const rs = combos(p, arm), n = own || k === 0 ? sizeOf(s, p.id, size, arm) : null;
      const share = r => (rs.length === 1 ? n : splits.find(([name]) => r.toLowerCase().includes(name) || name.split(/\s+/).some(w => w.length > 3 && r.toLowerCase().includes(w)))?.[1] ?? null);
      return [rs.map(r => [r, share(r)]), categories(s, p.id, colField, arm)];
    });
  });
  const rows = ordered(units.map(u => u.flatMap(([rs]) => rs.map(([r]) => r)))), cols = ordered(units.map(u => u.flatMap(([, c]) => c)));
  const ri = new Map(rows.map((r, i) => [r.toLowerCase(), i])), ci = new Map(cols.map((c, i) => [c.toLowerCase(), i]));
  const cells = rows.map(() => cols.map(() => ({ count: 0, paperIds: [], patients: 0 })));
  const inRow = rows.map(() => new Set()), inCol = cols.map(() => new Set()), seen = new Set();
  const pt = { rows: rows.map(() => 0), cols: cols.map(() => 0), all: 0 };
  let counted = false;
  sources.forEach((p, i) => {
    for (const [rs, cs] of units[i]) for (const [r, n] of rs) for (const c of cs) {
      const a = ri.get(r.toLowerCase()), b = ci.get(c.toLowerCase()), cell = cells[a][b];
      if (!cell.paperIds.includes(p.id)) { cell.count++; cell.paperIds.push(p.id); }
      inRow[a].add(p.id); inCol[b].add(p.id); seen.add(p.id);
      // a unit in several columns (fusion in some patients, the number not given) adds its patients to the first only
      if (n != null && c === cs[0]) { cell.patients += n; pt.rows[a] += n; pt.cols[b] += n; pt.all += n; counted = true; }
    }
  });
  return { rowField, colField, rows, cols, cells, total: sources.length,
    totals: { rows: inRow.map(x => x.size), cols: inCol.map(x => x.size), all: seen.size }, patients: counted ? pt : null };
}

/** The map as CSV rows: a header of column categories, then a row per row category with its counts. */
export function evidenceMapRows(map) {
  return [[`${map.rowField.label} × ${map.colField.label}`, ...map.cols],
    ...map.rows.map((r, i) => [r, ...map.cells[i].map(c => c.count)])];
}

/**
 * The map as a self-contained SVG bubble grid in the house style: each cell a circle whose area is proportional to
 * its count, with the count written in it; empty cells stay empty, which is what shows a gap. Row labels wrap to two
 * lines or become a key; column heads never rotate. `style` is figureTokens (the export set unless given).
 */
// The shading of a printed heat map (the Spine review's Figure 1, figure1_constructs_fusion.py, after GraphPad Prism): six blues from white,
// evenly spaced; a cell's place on them is 0.10 + 0.90 × its count over the largest (linear), or log10 of its count over log10 of the largest
// (log); zero is no cell. Its count is white on a dark cell (relative luminance under 0.45), else black.
const SHADE = ['#ffffff', '#c9daf2', '#7fa7dc', '#3a6fc4', '#1f4e9c', '#0d2b63'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));
export function shadeOf(value, max, log = false) {
  const pos = 0.10 + 0.90 * Math.min(1, log ? Math.log10(value) / Math.log10(Math.max(max, 2)) : value / max), at = pos * (SHADE.length - 1), i = Math.min(SHADE.length - 2, Math.floor(at)), f = at - i;
  const rgb = SHADE[i].map((c, k) => c + (SHADE[i + 1][k] - c) * f);
  const hex = `#${rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  return { fill: hex, ink: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 0.45 ? '#ffffff' : '#000000' };
}

export function evidenceMapSvg(map, { style = null, width = null, source = [], shade = '', patients = '' } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  const title = map ? `Evidence map: ${map.rowField.label} by ${map.colField.label}` : 'Evidence map';
  if (!map || !map.rows.length || !map.cols.length || !map.total)
    return emptyFigure(t, { title, message: 'No source of evidence to map yet.', width, source });
  if (shade) return shadedMapSvg(map, t, { title, width, source, shade, patients: map.patients ? patients : '' });
  const f = matrixFrame(t, { rows: map.rows, cols: map.cols, width, cell: t.row * 2.4 }), { P, ls } = f;
  const rowH = Math.max(t.row * 1.7, ...map.rows.map((_, k) => f.rowH(k)));
  const max = Math.max(1, ...map.cells.flat().map(c => c.count));
  const parts = [], body = [];
  let y = drawHeads(t, parts, f, map.cols);
  map.rows.forEach((r, i) => {
    const cy = y + rowH / 2;
    body.push(rowLabel(t, f, i, cy, r));
    map.cells[i].forEach((c, j) => {
      if (!c.count) return;
      const cx = f.cx[j] + f.cw[j] / 2, rMax = Math.min(f.cw[j], rowH) / 2 - ls * 0.2;
      const rad = Math.max(measure(t, String(c.count)) / 2 + ls * 0.3, rMax * Math.sqrt(c.count / max));
      body.push(`<circle class="c-seq1" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rad)}" fill="${t.seq[1]}"><title>${esc(`${r} · ${map.cols[j]}: ${c.count} ${c.count === 1 ? 'source' : 'sources'}`)}</title></circle>`,
        text(t, cx, cy + ls * 0.35, String(c.count), { anchor: 'middle', attrs: 'pointer-events="none"' }));
    });
    y += rowH;
    body.push(hairLine(t, P, y, f.end, y));
  });
  parts.push(...body);
  const h = footBlock(t, parts, y, f.w, { source: [`${map.total} sources of evidence · ${map.rowField.label} by ${map.colField.label}`, 'Circle area is proportional to the number of sources', ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: `${map.total} sources of evidence, ${map.rows.length} rows by ${map.cols.length} columns` });
}

/** The drawings app/lint-figures.mjs checks: a map with a long row label, a long column head, a gap and a reporting gap. */
export const __fixture = style => {
  const rows = ['Randomized controlled trial', 'Prospective cohort study', 'Non-randomized controlled intervention study with historical controls and a long label', NOT_REPORTED];
  const cols = ['Adults', 'Children and adolescents', 'Older adults living in residential care', NOT_REPORTED];
  const grid = [[5, 2, 0, 1], [3, 0, 4, 0], [1, 1, 0, 0], [0, 0, 1, 2]];
  const map = { rowField: { id: 'design', label: 'Design' }, colField: { id: 'population', label: 'Population' }, rows, cols,
    cells: grid.map(r => r.map(n => ({ count: n, paperIds: Array.from({ length: n }, (_, i) => `p${i}`) }))), total: 19 };
  const none = { ...map, rows: [], cols: [], cells: [], total: 0 };
  return [{ name: 'evidenceMapSvg', svg: evidenceMapSvg(map, { style }) }, { name: 'evidenceMapSvg-empty', svg: evidenceMapSvg(none, { style }) }];
};

/**
 * The map as a shaded heat map, as the Spine review's Figure 1 prints it: a block of articles and, when the table gives arm sizes and
 * `patients` names a scale, a block of patients beside it, each with its total column, and a total row under both; each block shaded on its
 * own scale (shadeOf), its cells one width, its totals bold and unshaded.
 */
function shadedMapSvg(map, t, { title, width, source, shade, patients }) {
  const both = !!patients, block = [...map.cols, 'Total'], gap = '\u2002';
  const cols = both ? [...block, gap, ...block] : block, rows = [...map.rows, 'Total'];
  const f = matrixFrame(t, { rows, cols, width: width || (both ? t.width.double * 1.25 : null), cell: t.row * 2.4 }), { P, ls } = f;
  const rowH = Math.max(t.row * 1.5, ...map.rows.map((_, k) => f.rowH(k))), w = Math.min(...map.cols.map((_, j) => f.cw[j])) - 2;
  const at = (b, j) => (b ? block.length + 1 : 0) + j;   // a block's column j in the frame
  const parts = [], body = [];
  // the blocks' titles over their columns, then the column heads
  const titleH = both ? f.step * 1.6 : 0;
  if (both) {
    for (const [b, name] of [[0, 'Articles'], [1, 'Patients']]) {
      const x0 = f.cx[at(b, 0)], x1 = f.cx[at(b, block.length - 1)] + f.cw[at(b, block.length - 1)];
      parts.push(text(t, (x0 + x1) / 2, f.top + ls, name, { anchor: 'middle', role: 'head' }));
    }
    f.top += titleH;
  }
  let y = drawHeads(t, parts, f, cols);
  const blocks = [{ value: c => c.count, total: map.totals, scale: shade, unit: 'source' }, ...(both ? [{ value: c => c.patients, total: map.patients, scale: patients, unit: 'patient' }] : [])];
  const maxOf = b => Math.max(1, ...map.cells.flat().map(b.value));
  const num = n => Number(n).toLocaleString('en-US');
  map.rows.forEach((r, i) => {
    const cy = y + rowH / 2;
    body.push(rowLabel(t, f, i, cy, r));
    blocks.forEach((b, k) => {
      const max = maxOf(b);
      map.cells[i].forEach((c, j) => {
        const v = b.value(c); if (!v) return;
        const col = at(k, j), { fill, ink } = shadeOf(v, max, b.scale === 'log'), x0 = f.cx[col] + (f.cw[col] - w) / 2;
        body.push(`<rect x="${r1(x0)}" y="${r1(y + 1)}" width="${r1(w)}" height="${r1(rowH - 2)}" fill="${fill}"><title>${esc(`${r} · ${map.cols[j]}: ${num(v)} ${b.unit}${v === 1 ? '' : 's'}`)}</title></rect>`,
          text(t, f.cx[col] + f.cw[col] / 2, cy + ls * 0.35, num(v), { anchor: 'middle', cls: 'c-shade', color: ink, attrs: 'pointer-events="none"' }));
      });
      const tc = at(k, block.length - 1);
      body.push(text(t, f.cx[tc] + f.cw[tc] / 2, cy + ls * 0.35, num(b.total.rows[i]), { anchor: 'middle', role: 'head' }));
    });
    y += rowH;
  });
  // the total row: each column's studies (each once) and patients, and the whole
  y += ls * 0.4;
  body.push(hairLine(t, P, y, f.right, y));
  const cy = y + rowH / 2;
  body.push(rowLabel(t, f, rows.length - 1, cy, 'Total', { role: 'head' }));
  blocks.forEach((b, k) => {
    map.cols.forEach((_, j) => body.push(text(t, f.cx[at(k, j)] + f.cw[at(k, j)] / 2, cy + ls * 0.35, num(b.total.cols[j]), { anchor: 'middle', role: 'head' })));
    const tc = at(k, block.length - 1);
    body.push(text(t, f.cx[tc] + f.cw[tc] / 2, cy + ls * 0.35, num(b.total.all), { anchor: 'middle', role: 'head' }));
  });
  y += rowH;
  parts.push(...body);
  const scaleWords = (what, sc) => `${what} on a ${sc === 'log' ? 'log' : 'linear'} scale`;
  const h = footBlock(t, parts, y, f.w, { source: [
    `${map.total} sources of evidence · ${map.rowField.label} by ${map.colField.label}`,
    `Shading is proportional to the count: ${[scaleWords('articles', shade), ...(both ? [scaleWords('patients', patients)] : [])].join('; ')}; no shading = 0. A study with arms in several cells is counted in each and once in the totals`,
    ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: `${map.total} sources of evidence, ${map.rows.length} rows by ${map.cols.length} columns${both ? ', articles and patients' : ''}` });
}
