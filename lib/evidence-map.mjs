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
  ...tableFields(s).filter(f => f.type === 'text' || f.type === 'category').map(f => ({ ...f, label: fieldParts(s, f)[0] }))
    .filter(f => !/^(?:id|study|study id|reference|doi|pmid)(?: ·|$)/i.test(f.label))];

/**
 * The synthesis facets (s.synthesis.facets) as charted fields, `facet:<id>`: each arm's coded level (s.synthesis.arms), so a map can be
 * crossed by the coded staging rather than the table's free text (the Spine review's Figure 1: Single stage, Two-stage, Two-stage in some
 * patients), its columns in the facet's own order.
 */
export const facetFields = s => (Array.isArray(s?.synthesis?.facets) ? s.synthesis.facets : []).filter(f => f?.id && Array.isArray(f.levels))
  .map(f => ({ id: `facet:${f.id}`, label: f.label || f.id, type: 'category', facet: f }));
const chartable = s => [...mappableFields(s), ...facetFields(s)];

/**
 * A charted field's own name and, for a column of an extraction table, the table's name. A table column is read from the templates, so
 * the joined label's form does not matter; any other label is split at its first " · " (a label saved that way) or kept whole.
 */
export function fieldParts(s, f) {
  for (const t of s?.templates || []) for (const c of t.columns || []) if (c.id === f.id) return [c.name || c.label || c.id, t.name || ''];
  const label = String(f.label ?? ''), i = label.indexOf(' · ');   // lint-allow-dot: labels saved before 2026-10-20
  if (i >= 0) return [label.slice(0, i), label.slice(i + 3)];
  const m = / \(([^()]*)\)$/.exec(label);   // "Column (Table)", the form tableFields gives now
  return m ? [label.slice(0, m.index), m[1]] : [label, ''];
}

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

/**
 * A source's categories for a field (an arm's own value when `arm` is given and it has one), trimmed and de-duplicated ignoring case.
 * `level` merges a level into another (the person's merges, s.evidenceMap.levels): the whole value first ("Two-stage; rods placed at 6 mo" →
 * "Two-stage"), else each of its parts.
 */
function categories(s, paperId, field, arm = '', level = x => x) {
  if (field.facet) {
    const id = s.synthesis?.arms?.[`${paperId}@${arm || ''}`]?.facets?.[field.facet.id], lv = field.facet.levels.find(l => l.id === id);
    return [level(lv?.label || NOT_REPORTED)];
  }
  const own = arm ? s.values?.[`${paperId}:${field.id}@${arm}`] : null;
  const raw = own && own.availability !== 'not_found' ? String(own.reported_value ?? own.normalized_value ?? '').trim() || valueFor(s, paperId, field) : valueFor(s, paperId, field);
  const whole = raw ? level(String(raw).trim()) : null;
  const parts = whole != null && whole !== String(raw).trim() ? [whole] : raw ? String(raw).split(/\s*;\s*/).map(x => level(x.trim())).filter(Boolean) : [];
  const seen = new Map();
  for (const p of parts) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  return seen.size ? [...seen.values()] : [level(NOT_REPORTED) || NOT_REPORTED];
}

/** A field's merges as a function: a level (any case) to the level it was merged into, else itself. */
const levelOf = (levels, id) => {
  const m = levels?.[id];
  if (!m || typeof m !== 'object') return x => x;
  const low = new Map(Object.entries(m).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return x => low.get(String(x).toLowerCase()) ?? x;
};

/** A level that says one part of a construct was not reported ("Rod material NR", "Technique NR", "NR", "Not reported"). */
const UNKNOWN = /^(?:[\p{L}-]+\s+){0,2}NR$|^not reported$/iu;
export const isUnknownLevel = x => UNKNOWN.test(String(x ?? '').trim());

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
export function evidenceMap(s, rowFieldId, colFieldId, { col2 = null, levels = {}, group = null, mergeUnknown = true, orders = {}, nested = false, look = null } = {}) {
  const all = chartable(s), ids = Array.isArray(rowFieldId) ? rowFieldId : [rowFieldId];
  const rowFields = ids.map(id => all.find(f => f.id === id)), colField = all.find(f => f.id === colFieldId);
  if (!rowFields.length || rowFields.some(f => !f) || !colField) return null;
  // a second crossing field beside the first (the printed Figure 1's Staging beside Fusion): a block of columns of its own
  const second = col2 && col2 !== colField.id && !ids.includes(col2) ? all.find(f => f.id === col2) : null;
  const colFields = [colField, ...(second ? [second] : [])], groupField = group?.field ? all.find(f => f.id === group.field) || null : null;
  // several fields down the side: a source's row is each combination of their categories ("Dynesys · Rigid")
  const rowField = rowFields.length === 1 ? rowFields[0] : { id: ids.join('+'), label: rowFields.map(f => f.label).join(', ') };
  const sources = studies(s), size = sizeField(s);
  const fids = new Set([...ids, ...colFields.map(f => f.id), ...(groupField ? [groupField.id] : []), ...(size ? [size.id] : [])]), arms = new Map();
  for (const k of Object.keys(s.values || {})) {
    const m = /^(.*):([^:@]+)@([^@]+)$/.exec(k);
    if (m && fids.has(m[2])) { if (!arms.has(m[1])) arms.set(m[1], new Set()); arms.get(m[1]).add(m[3]); }
  }
  const cat = (p, f, arm) => categories(s, p.id, f, arm, levelOf(levels, f.id)), label = parts => parts.join(', ');
  const unitsOf = p => [...(arms.get(p.id) || [''])];
  // a unit's constructs, each the list of its parts (one per row field)
  const combos = (p, arm) => {
    const lists = rowFields.map(f => cat(p, f, arm)), multi = lists.filter(l => l.length > 1);
    if (multi.length > 1 && multi.every(l => l.length === multi[0].length))   // parallel lists: the nth rod with the nth screw
      return multi[0].map((_, i) => lists.map(l => (l.length > 1 ? l[i] : l[0])));
    return lists.reduce((acc, l) => acc.flatMap(a => l.map(c => [...a, c])), [[]]);
  };
  // each unit: its constructs (parts, patients, the group field's value beside it) and its categories in each column field
  const units = sources.map(p => {
    const splits = splitsOf(s, p.id);
    const list = unitsOf(p);
    return list.map((arm, k) => {
      // a size given for the study, not its arms, is counted once: with its first arm
      const own = arm && size && s.values?.[`${p.id}:${size.id}@${arm}`];
      const rs = combos(p, arm), n = own || k === 0 ? sizeOf(s, p.id, size, arm) : null;
      const share = r => (rs.length === 1 ? n : splits.find(([name]) => r.toLowerCase().includes(name) || name.split(/\s+/).some(w => w.length > 3 && r.toLowerCase().includes(w)))?.[1] ?? null);
      // the group field's value for a construct: its own part when it is a row field, else its list paired with the first row field's
      const gl = groupField ? cat(p, groupField, arm) : null, first = gl ? cat(p, rowFields[0], arm).map(x => x.toLowerCase()) : [];
      const groupOf = parts => (!gl ? null : ids.includes(groupField.id) ? parts[ids.indexOf(groupField.id)]
        : gl.length > 1 && gl.length === first.length ? gl[first.indexOf(parts[0].toLowerCase())] ?? gl[0]
          : gl.length > 1 && gl.length === list.length ? gl[k] : gl[0]);   // a study-level list, one value an arm ("Dynamic; Rigid")
      return { rows: rs.map(parts => ({ parts, n: share(label(parts)), group: groupOf(parts) })), cats: colFields.map(f => cat(p, f, arm)) };
    });
  });
  // a construct with a part not reported ("Rod material NR, Orthrus") is merged into the one construct that agrees with it on every other
  // part ("PEEK rod, Orthrus"); then the person's merges of whole rows (levels under the row field's id)
  const rename = new Map();
  if (mergeUnknown && rowFields.length > 1) {
    const tuples = new Map();
    for (const u of units.flat()) for (const r of u.rows) tuples.set(label(r.parts).toLowerCase(), r.parts);
    for (const [k, parts] of tuples) {
      const at = parts.findIndex(isUnknownLevel);
      if (at < 0 || parts.every(isUnknownLevel)) continue;
      const kin = [...tuples.values()].filter(q => q !== parts && !isUnknownLevel(q[at]) && q.every((x, j) => j === at || x.toLowerCase() === parts[j].toLowerCase()));
      if (kin.length === 1) rename.set(k, label(kin[0]));
    }
  }
  const rowLevel = levelOf(levels, rowField.id), rowOf = parts => rowLevel(rename.get(label(parts).toLowerCase()) || label(parts));
  let rows = ordered(units.map(u => u.flatMap(x => x.rows.map(r => rowOf(r.parts)))));
  // each row's parts as printed (a merged row takes the parts of the row it was merged into)
  const partsOf = new Map();
  for (const u of units.flat()) for (const r of u.rows) { const l = rowOf(r.parts), k = l.toLowerCase(); if (!partsOf.has(k)) partsOf.set(k, l === label(r.parts) ? r.parts : l.split(', ')); }
  // `nested`: rows sorted part by part, as a table of nested labels is read: by a field's printed order where `orders` gives one, else the
  // larger set of sources first, then by name (the Spine review's Figure 1: rod class in its order, rods by their articles, screws in their order)
  if (nested && rowFields.length > 1) {
    const arts = new Map(), pre = (parts, d) => parts.slice(0, d + 1).join('\u0001').toLowerCase();
    sources.forEach((p, i) => { for (const u of units[i]) for (const r of u.rows) { const parts = partsOf.get(rowOf(r.parts).toLowerCase()); parts.forEach((_, d) => { const k = pre(parts, d); if (!arts.has(k)) arts.set(k, new Set()); arts.get(k).add(p.id); }); } });
    const rankIn = (d, v) => { const o = orders?.[rowFields[d]?.id]; if (!o) return null; const k = o.findIndex(x => x.toLowerCase() === String(v).toLowerCase()); return k < 0 ? o.length : k; };
    const key = r => partsOf.get(r.toLowerCase()) || [r];
    rows = rows.slice().sort((a, b) => {
      const A = key(a), B = key(b);
      for (let d = 0; d < Math.max(A.length, B.length); d++) {
        if (String(A[d] ?? '').toLowerCase() === String(B[d] ?? '').toLowerCase()) continue;
        const ra = rankIn(d, A[d]), rb = rankIn(d, B[d]);
        if (ra != null && ra !== rb) return ra - rb;
        const na = arts.get(pre(A, d))?.size || 0, nb = arts.get(pre(B, d))?.size || 0;
        return nb - na || String(A[d] ?? '').localeCompare(String(B[d] ?? ''));
      }
      return 0;
    });
  }
  // rows grouped: by the group field's value (or its first word, or the person's names for its values), each group's rows together
  let groups = null;
  if (groupField) {
    const votes = new Map(), how = group.how || 'value', named = levelOf({ g: group.map }, 'g');
    const word = v => (how === 'first-word' ? String(v).match(/^[^\s,;(]+/)?.[0] || String(v) : how === 'map' ? named(v) : String(v));
    for (const u of units.flat()) for (const r of u.rows) {
      const k = rowOf(r.parts).toLowerCase(), g = r.group == null ? NOT_REPORTED : word(r.group), m = votes.get(k) || new Map();
      m.set(g, (m.get(g) || 0) + 1); votes.set(k, m);
    }
    const groupOfRow = r => [...(votes.get(r.toLowerCase()) || new Map([[NOT_REPORTED, 1]]))].sort((a, b) => b[1] - a[1] || isUnknownLevel(a[0]) - isUnknownLevel(b[0]))[0][0];
    const byGroup = new Map();
    for (const r of rows) { const g = groupOfRow(r); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(r); }
    const sizeOfGroup = g => new Set(sources.filter((p, i) => units[i].some(u => u.rows.some(r => byGroup.get(g).includes(rowOf(r.parts))))).map(p => p.id)).size;
    const mapOrder = how === 'map' && group.map ? [...new Set(Object.values(group.map).map(String))] : [];
    const rank = g => (mapOrder.includes(g) ? mapOrder.indexOf(g) : mapOrder.length);
    const order = [...byGroup.keys()].sort((a, b) => (isUnknownLevel(a) || a === NOT_REPORTED) - (isUnknownLevel(b) || b === NOT_REPORTED) || rank(a) - rank(b) || sizeOfGroup(b) - sizeOfGroup(a) || a.localeCompare(b));
    // within a group, the rows that share their first part together (a rod's screws under it), largest first
    const firstOf = r => r.split(', ')[0].toLowerCase();
    rows = []; groups = [];
    for (const g of order) {
      const list = byGroup.get(g), seen = list.map(firstOf);
      const sorted = nested ? list : list.slice().sort((a, b) => seen.indexOf(firstOf(a)) - seen.indexOf(firstOf(b)));
      groups.push({ label: g, from: rows.length, to: rows.length + sorted.length });
      rows.push(...sorted);
    }
  }
  const ri = new Map(rows.map((r, i) => [r.toLowerCase(), i]));
  const blocks = colFields.map((f, b) => {
    // `orders` (a field's levels as they are printed) or a facet's own order; else by how many sources hold them
    const want = orders?.[f.id] || (f.facet ? f.facet.levels.map(l => levelOf(levels, f.id)(l.label)) : null), rk = c => { const k = want ? want.findIndex(x => x.toLowerCase() === c.toLowerCase()) : -1; return k < 0 ? Infinity : k; };
    const cols = ordered(units.map(u => u.flatMap(x => x.cats[b]))).map((c, k) => [c, k]).sort((x, y) => rk(x[0]) - rk(y[0]) || x[1] - y[1]).map(x => x[0]);
    return { field: f, cols, ci: new Map(cols.map((c, i) => [c.toLowerCase(), i])), cells: rows.map(() => cols.map(() => ({ count: 0, paperIds: [], patients: 0 }))),
      inCol: cols.map(() => new Set()), pt: cols.map(() => 0) };
  });
  const inRow = rows.map(() => new Set()), seen = new Set(), pt = { rows: rows.map(() => 0), all: 0 };
  let counted = false;
  sources.forEach((p, i) => {
    for (const u of units[i]) for (const r of u.rows) {
      const a = ri.get(rowOf(r.parts).toLowerCase());
      inRow[a].add(p.id); seen.add(p.id);
      if (r.n != null) { pt.rows[a] += r.n; pt.all += r.n; counted = true; }
      blocks.forEach((B, b) => {
        const cs = u.cats[b];
        for (const c of cs) {
          const k = B.ci.get(c.toLowerCase()), cell = B.cells[a][k];
          if (!cell.paperIds.includes(p.id)) { cell.count++; cell.paperIds.push(p.id); }
          B.inCol[k].add(p.id);
          // a unit in several columns (fusion in some patients, the number not given) adds its patients to the first only
          if (r.n != null && c === cs[0]) { cell.patients += r.n; B.pt[k] += r.n; }
        }
      });
    }
  });
  const out = blocks.map(B => ({ field: B.field, cols: B.cols, cells: B.cells, totals: { cols: B.inCol.map(x => x.size) }, patients: counted ? { cols: B.pt } : null }));
  return { rowField, colField, rows, rowParts: rows.map(r => partsOf.get(r.toLowerCase()) || [r]), rowFields, ...(look ? { look } : {}), cols: out[0].cols, cells: out[0].cells, total: sources.length, blocks: out, groups,
    totals: { rows: inRow.map(x => x.size), cols: out[0].totals.cols, all: seen.size }, patients: counted ? { rows: pt.rows, cols: out[0].patients.cols, all: pt.all } : null };
}

/** A map's printed order and look, as saved: `orders` (a field's levels in their printed order), `nested` (rows sorted part by part), and the
 * look (`layout` 'prism': the Spine review's Figure 1, its labels nested; `outside` the columns a block's heading leaves out; `blockHeads` a
 * block's printed name; `rowHeads` the heads over the row labels). */
const layoutOptions = e => ({ orders: e.orders && typeof e.orders === 'object' ? e.orders : {}, nested: e.nested === true,
  look: e.layout ? { layout: String(e.layout), outside: Array.isArray(e.outside) ? e.outside.map(String) : [], blockHeads: e.blockHeads && typeof e.blockHeads === 'object' ? e.blockHeads : {}, rowHeads: Array.isArray(e.rowHeads) ? e.rowHeads.map(x => String(x ?? '')) : null } : null });

/** The options a project's map is drawn with (s.evidenceMap): a second column field, merged levels, row groups, the not-reported merge. */
export function mapOptions(s) {
  const e = s?.evidenceMap || {}, has = new Set(chartable(s).map(f => f.id)), { row, col } = mapFields(s), used = [...(Array.isArray(row) ? row : [row]), col];
  return { col2: has.has(e.col2) && !used.includes(e.col2) ? e.col2 : null, levels: e.levels && typeof e.levels === 'object' ? e.levels : {},
    group: e.group && has.has(e.group.field) ? e.group : null, mergeUnknown: e.mergeUnknown !== false, ...layoutOptions(e) };
}
/** The project's map as every page draws it: its fields and its options. Null before its fields are chosen. */
export function projectMap(s) {
  const { row, col } = mapFields(s);
  return row && col ? evidenceMap(s, row, col, mapOptions(s)) : null;
}

/**
 * A package item's map: the options kept with the item (`it.map`: rows, col, col2, levels, group, mergeUnknown), so a printed figure is drawn
 * as it was made whatever the map in Tables and figures shows now; without them, the project's map.
 */
export function itemMap(s, it) {
  const o = it?.map;
  if (!o || typeof o !== 'object') return projectMap(s);
  const { row, col } = mapFields(s), has = new Set(chartable(s).map(f => f.id));
  const rows = o.rows || o.row || row, c = has.has(o.col) ? o.col : col;
  return rows && c ? evidenceMap(s, rows, c, { col2: has.has(o.col2) ? o.col2 : null, levels: o.levels && typeof o.levels === 'object' ? o.levels : {}, group: o.group && has.has(o.group.field) ? o.group : null, mergeUnknown: o.mergeUnknown !== false, ...layoutOptions(o) }) : null;
}

/** The map as CSV rows: a header of column categories, then a row per row category with its counts. */
export function evidenceMapRows(map) {
  const blocks = map.blocks?.length > 1 ? map.blocks : null;
  if (!blocks) return [[`${map.rowField.label} × ${map.colField.label}`, ...map.cols], ...map.rows.map((r, i) => [r, ...map.cells[i].map(c => c.count)])];
  // a second crossing field: its columns after the first's, each named with its field
  return [[`${map.rowField.label} × ${blocks.map(b => b.field.label).join(', ')}`, ...blocks.flatMap(b => b.cols.map(c => `${b.field.label}: ${c}`))],
    ...map.rows.map((r, i) => [r, ...blocks.flatMap(b => b.cells[i].map(c => c.count))])];
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

/**
 * The studies behind a mark, as attributes for a screen drawing that lists them on a press (lib/figure-drill.mjs): `data-studies` the paper ids,
 * `data-drill-label` what the mark is. Nothing in a drawing for print or export (`on` false), so those stay as they were.
 */
const drillOf = (on, ids, label) => { const list = [...new Set(ids || [])]; return on && list.length ? ` data-studies="${esc(list.join(' '))}" data-drill-label="${esc(label)}"` : ''; };
const idsOfRow = (blocks, i) => blocks.flatMap(b => (b.cells[i] || []).flatMap(c => c.paperIds || []));
const idsOfCol = (b, j) => b.cells.flatMap(r => r[j]?.paperIds || []);
/** A drawn element wrapped in a group that carries its studies (a row's label, a total). */
const withDrill = (attrs, html) => (attrs ? `<g${attrs}>${html}</g>` : html);
export function evidenceMapSvg(map, { style = null, width = null, source = [], shade = '', patients = '', drill = false } = {}) {
  const t = style || figureTokens(null, { medium: 'export' });
  const title = map ? `Evidence map: ${map.rowField.label} by ${(map.blocks || [{ field: map.colField }]).map(b => b.field.label).join(' and ')}` : 'Evidence map';
  if (!map || !map.rows.length || !map.cols.length || !map.total)
    return emptyFigure(t, { title, message: 'No source of evidence to map yet.', width, source });
  // the Prism layout is a print drawing (its sizes are the paper's points); the screen keeps the shaded map
  if (shade && map.look?.layout === 'prism' && map.rowParts?.length && t.unit === 'pt') return prismMapSvg(map, t, { title, shade, patients: map.patients ? patients : '' });
  if (shade) return shadedMapSvg(map, t, { title, width, source, shade, patients: map.patients ? patients : '', drill });
  const f = matrixFrame(t, { rows: map.rows, cols: map.cols, width, cell: t.row * 2.4 }), { P, ls } = f;
  const rowH = Math.max(t.row * 1.7, ...map.rows.map((_, k) => f.rowH(k)));
  const max = Math.max(1, ...map.cells.flat().map(c => c.count));
  const parts = [], body = [];
  let y = drawHeads(t, parts, f, map.cols);
  map.rows.forEach((r, i) => {
    const cy = y + rowH / 2;
    body.push(withDrill(drillOf(drill, idsOfRow([map], i), r), rowLabel(t, f, i, cy, r)));
    map.cells[i].forEach((c, j) => {
      if (!c.count) return;
      const cx = f.cx[j] + f.cw[j] / 2, rMax = Math.min(f.cw[j], rowH) / 2 - ls * 0.2;
      const rad = Math.max(measure(t, String(c.count)) / 2 + ls * 0.3, rMax * Math.sqrt(c.count / max));
      body.push(`<circle class="c-seq1" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rad)}" fill="${t.seq[1]}"${drillOf(drill, c.paperIds, `${r}, ${map.cols[j]}`)}><title>${esc(`${r}, ${map.cols[j]}: ${c.count} ${c.count === 1 ? 'source' : 'sources'}`)}</title></circle>`,
        text(t, cx, cy + ls * 0.35, String(c.count), { anchor: 'middle', attrs: 'pointer-events="none"' }));
    });
    y += rowH;
    body.push(hairLine(t, P, y, f.end, y));
  });
  parts.push(...body);
  const h = footBlock(t, parts, y, f.w, { source: [`${map.total} sources of evidence; ${map.rowField.label} by ${map.colField.label}`, 'Circle area is proportional to the number of sources', ...sourceOf(source)], keys: f.keys });
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
 * The map as a GraphPad Prism file (.pzfx): two-way tables of articles and patients (row titles, one column per printed column and the total),
 * and their log10 for a log-coloured heat map (zero blank, totals left out), as the Spine review's Figure 1 was handed to Prism. A row is titled by
 * its parts after the first (the rod), the last part only where it is not the most common (a standard screw is not named).
 */
export function evidenceMapPzfx(map, { title = 'Evidence map', notes = '' } = {}) {
  const x = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = map.blocks?.length ? map.blocks : [{ field: map.colField, cols: map.cols, cells: map.cells, totals: { cols: map.totals.cols }, patients: map.patients ? { cols: map.patients.cols } : null }];
  const P = map.rowParts || map.rows.map(r => [r]), lastCount = new Map();
  for (const p of P) lastCount.set(p.at(-1), (lastCount.get(p.at(-1)) || 0) + 1);
  const common = [...lastCount].sort((a, b) => b[1] - a[1])[0]?.[0];
  const titleOf = p => { const rest = p.length > 2 ? p.slice(1) : p; return rest.length > 1 && rest.at(-1) === common ? rest.slice(0, -1).join(', ') : rest.length > 1 ? `${rest.slice(0, -1).join(', ')} + ${rest.at(-1)}` : rest[0]; };
  const titles = P.map(titleOf), cols = blocks.flatMap((b, bk) => b.cols.map((c, j) => ({ b: bk, j, label: c })));
  const units = [['Articles', c => c.count, map.totals, b => b.totals.cols], ...(map.patients ? [['Patients', c => c.patients, map.patients, b => b.patients?.cols || []]] : [])];
  const table = (id, name, value, totals, colTotals, log) => {
    const cell = v => (!log ? String(v ?? 0) : v ? Math.log10(v).toFixed(3) : '');
    const out = [`<Table ID="${id}" XFormat="none" TableType="TwoWay" EVFormat="AsteriscAfterNumber">`, `<Title>${x(name)}</Title>`, '<RowTitlesColumn Width="320"><Subcolumn>',
      ...[...titles, ...(log ? [] : ['Total'])].map(t => `<d>${x(t)}</d>`), '</Subcolumn></RowTitlesColumn>'];
    for (const c of cols) out.push(`<YColumn Width="90" Decimals="${log ? 3 : 0}" Subcolumns="1"><Title>${x(c.label)}</Title><Subcolumn>`,
      ...P.map((_, i) => `<d>${cell(value(blocks[c.b].cells[i][c.j]))}</d>`), ...(log ? [] : [`<d>${colTotals(blocks[c.b])[c.j] ?? 0}</d>`]), '</Subcolumn></YColumn>');
    if (!log) out.push('<YColumn Width="90" Decimals="0" Subcolumns="1"><Title>Total</Title><Subcolumn>', ...P.map((_, i) => `<d>${totals.rows[i] ?? 0}</d>`), `<d>${totals.all ?? 0}</d>`, '</Subcolumn></YColumn>');
    out.push('</Table>');
    return out.join('\n');
  };
  const tables = [...units.map(([n, v, tot, ct]) => [n, v, tot, ct, false]), ...units.map(([n, v, tot, ct]) => [`${n} (log10) - for heat map`, v, tot, ct, true])];
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<GraphPadPrismFile PrismXMLVersion="5.00">',
    '<Created><OriginalVersion CreatedByProgram="GraphPad Prism" CreatedByVersion="6.0.0.0" Login="" DateTime=""/></Created>',
    '<InfoSequence><Ref ID="Info0" Selected="1"/></InfoSequence>',
    `<Info ID="Info0"><Title>${x(title)}</Title><Notes>${x(notes || 'A study counts once in each cell where it has an arm and once in each total, so cells can add up to more than the total. Written by Lykos.')}</Notes></Info>`,
    `<TableSequence>${tables.map((_, k) => `<Ref ID="Table${k}"${k ? '' : ' Selected="1"'}/>`).join('')}</TableSequence>`,
    ...tables.map(([n, v, tot, ct, log], k) => table(`Table${k}`, n, v, tot, ct, log)), '</GraphPadPrismFile>'].join('\n');
}

/** The ticks of a legend's scale: about five even steps on a linear scale (from 0), 1, 3, 10, 30 … on a log one (from 1). */
export function scaleTicks(max, log = false) {
  if (log) { const out = []; for (let p = 1; p <= Math.max(max, 1); p *= 10) { out.push(p); if (3 * p <= max) out.push(3 * p); } return out; }
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(x => max / x <= 5) || Math.ceil(max / 5), out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * The map as GraphPad Prism draws a grouped heat map, the Spine review's Figure 1 (figure1_constructs_fusion.py, 19-24 Oct 2026, now drawn
 * here): the row labels nested, one column per row field (a group's name turned up its rows with a bracket, then each field's value merged
 * over the rows that share it, the last field's value on every row), white gaps between shaded cells, a thin frame round each column block,
 * plain bold totals outside the frames, a block of articles and one of patients, a ramp under each with its ticks. Sizes are the script's, in
 * points (its inches × 72). `map.look`: `outside` the columns a block's heading rule leaves out ("No fusion"), `blockHeads` a block's printed
 * name, `rowHeads` the heads over the row label columns.
 */
function prismMapSvg(map, t, { title, shade, patients }) {
  const look = map.look || {}, FONT = 6.5, SMALL = 5.8, BIG = 7.5, CW = 21.6, CH = 12.24, GROUP_GAP = 3.6, TOTAL_GAP = 5.04, BLOCK_GAP = 21.6;
  const TITLE_H = 14.4, HEAD_H = 12.24, STAGE_GAP = 7.2, LEGEND_H = 39.6, TOP = 3.6, INK = '#000000', LW = 0.6;
  const both = !!patients, blocks = map.blocks?.length ? map.blocks : [{ field: map.colField, cols: map.cols, cells: map.cells, totals: { cols: map.totals.cols }, patients: map.patients ? { cols: map.patients.cols } : null }];
  const wOf = (s, z, bold = false) => measure(t, String(s), 'label') * (z / t.size.label) * (bold ? 1.06 : 1);
  const T = (x, y, s, { z = FONT, bold = false, anchor = 'start', rot = false, fill = INK } = {}) =>
    `<text x="${r1(x)}" y="${r1(y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} font-size="${z}"${bold ? ' font-weight="700"' : ''} fill="${fill}"${rot ? ` transform="rotate(-90 ${r1(x)} ${r1(y)})"` : ''}>${esc(s)}</text>`;
  const L = (x1, y1, x2, y2) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${INK}" stroke-width="${LW}"/>`;
  const wrap = (s, max, z, bold) => { const out = []; let cur = ''; for (const w of String(s).split(/\s+/)) { const nx = cur ? `${cur} ${w}` : w; if (cur && wOf(nx, z, bold) > max) { out.push(cur); cur = w; } else cur = nx; } if (cur) out.push(cur); return out; };
  const num = n => Number(n).toLocaleString('en-US');
  // the columns: each block's, a gap between blocks, then the total column
  const cols = blocks.flatMap((b, bk) => b.cols.map((c, j) => ({ b: bk, j, label: c })));
  const colX = k => CW * k + STAGE_GAP * cols[k].b;
  const inner = CW * cols.length + STAGE_GAP * (blocks.length - 1), unitW = inner + TOTAL_GAP + CW;
  // the row labels: the group's column, then one per row field; a gap between rows whose first field (or group) differs
  const P = map.rowParts, depth = Math.max(...P.map(x => x.length)), grouped = !!map.groups?.length;
  const groupOf = i => map.groups?.find(g => i >= g.from && i < g.to)?.label ?? '';
  const heads = look.rowHeads || map.rowFields?.map((f, d) => (d ? f.label : '')) || [];
  const levelW = d => {
    const vals = [...new Set(P.map(x => x[d] ?? ''))], last = d === depth - 1, bold = d < depth - 2;
    const cap = bold ? FONT * 6 : Infinity, longest = Math.max(wOf(heads[d] || '', SMALL, true), ...vals.map(v => (bold ? Math.max(...wrap(v, cap, FONT, true).map(l => wOf(l, FONT, true))) : wOf(v, FONT))));
    return Math.min(longest, cap) + (last ? 8 : 10);
  };
  const groupW = grouped ? FONT * 2.2 : 0, widths = Array.from({ length: depth }, (_, d) => levelW(d)), labelW = groupW + widths.reduce((a, b) => a + b, 0) + 3.6;
  const xs = [groupW]; for (const w of widths) xs.push(xs.at(-1) + w);
  const rowY = []; let y0 = 0;
  P.forEach((parts, i) => { if (i && (groupOf(i) !== groupOf(i - 1) || parts[0] !== P[i - 1][0])) y0 += GROUP_GAP; rowY.push(y0); y0 += CH; });
  const totalY = y0 + TOTAL_GAP, bodyH = totalY + CH;
  // the column names, turned up and wrapped to the head's height
  const SUB_H = Math.max(36, ...cols.map(c => Math.min(44.64, wOf(c.label, SMALL) + 6))) , bodyTop = TOP + (both ? TITLE_H : 0) + (blocks.length > 1 || look.blockHeads ? HEAD_H : 0) + SUB_H;
  const units = [{ name: 'Articles', value: c => c.count, rows: map.totals.rows, all: map.totals.all, cols: b => b.totals.cols, log: shade === 'log' },
    ...(both ? [{ name: 'Patients', value: c => c.patients, rows: map.patients.rows, all: map.patients.all, cols: b => b.patients?.cols || [], log: patients === 'log' }] : [])];
  const W = labelW + units.length * unitW + (units.length - 1) * BLOCK_GAP + 10.8, H = bodyTop + bodyH + LEGEND_H + 3.6;
  const out = [];
  units.forEach((u, ui) => {
    const left = labelW + ui * (unitW + BLOCK_GAP), max = Math.max(1, ...blocks.flatMap(b => b.cells.flat().map(u.value)));
    if (both) out.push(T(left + unitW / 2, TOP + TITLE_H / 2 + BIG * 0.35, u.name, { z: BIG, bold: true, anchor: 'middle' }));
    // each block's name over its columns with a rule under it (the columns named `outside` stand apart, as "No fusion" does from Fusion)
    const yRule = TOP + (both ? TITLE_H : 0) + HEAD_H * 0.75;
    blocks.forEach((b, bk) => {
      const ks = cols.map((c, k) => [c, k]).filter(([c]) => c.b === bk && !(look.outside || []).some(o => o.toLowerCase() === c.label.toLowerCase())).map(([, k]) => k);
      if (!ks.length) return;
      const x0 = left + colX(ks[0]), x1 = left + colX(ks.at(-1)) + CW;
      out.push(L(x0 + 2.16, yRule, x1 - 2.16, yRule), T((x0 + x1) / 2, yRule - 2.6, look.blockHeads?.[b.field.id] || b.field.label, { bold: true, anchor: 'middle' }));
    });
    cols.forEach((c, k) => {
      const lines = wrap(c.label, SUB_H - 4, SMALL), cx = left + colX(k) + CW / 2;
      lines.forEach((l, n) => out.push(T(cx + (n - (lines.length - 1) / 2) * SMALL * 1.05 + SMALL * 0.35, bodyTop - 2.88, l, { z: SMALL, rot: true })));
    });
    const totalX = left + inner + TOTAL_GAP + CW / 2;
    out.push(T(totalX + SMALL * 0.35, bodyTop - 2.88, 'Total', { z: SMALL, bold: true, rot: true }));
    // the shaded cells, white edges between them; the frames round each block; the totals outside, bold and plain
    P.forEach((_, i) => cols.forEach((c, k) => {
      const v = u.value(blocks[c.b].cells[i][c.j]) || 0, x = left + colX(k), y = bodyTop + rowY[i];
      const { fill, ink } = v ? shadeOf(v, max, u.log) : { fill: '#ffffff', ink: INK };
      out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(CW)}" height="${r1(CH)}" fill="${fill}" stroke="#ffffff" stroke-width="1.2"/>`);
      if (v) out.push(T(x + CW / 2, y + CH / 2 + SMALL * 0.35, num(v), { z: SMALL, anchor: 'middle', fill: ink }));
    }));
    blocks.forEach((b, bk) => {
      const ks = cols.map((c, k) => [c, k]).filter(([c]) => c.b === bk).map(([, k]) => k), x0 = left + colX(ks[0]);
      out.push(`<rect x="${r1(x0)}" y="${r1(bodyTop)}" width="${r1(CW * ks.length)}" height="${r1(totalY - TOTAL_GAP)}" fill="none" stroke="${INK}" stroke-width="${LW}"/>`);
    });
    P.forEach((_, i) => out.push(T(totalX, bodyTop + rowY[i] + CH / 2 + SMALL * 0.35, num(u.rows[i]), { z: SMALL, bold: true, anchor: 'middle' })));
    const yT = bodyTop + totalY + CH / 2 + SMALL * 0.35;
    cols.forEach((c, k) => out.push(T(left + colX(k) + CW / 2, yT, num(u.cols(blocks[c.b])[c.j] ?? 0), { z: SMALL, bold: true, anchor: 'middle' })));
    out.push(T(totalX, yT, num(u.all), { z: SMALL, bold: true, anchor: 'middle' }));
    // the ramp: the scale from its lightest step to its darkest, its ticks (a linear scale's top labelled when the steps miss it), what it counts
    const bx = left + 7.2, bw = inner - 14.4, by = bodyTop + bodyH + 8.64, bh = 5.76, steps = 64, top2 = Math.max(u.log ? 2 : 1, max);
    for (let k = 0; k < steps; k++) { const f = k / steps, v = u.log ? 10 ** (f * Math.log10(top2)) : f * top2; out.push(`<rect x="${r1(bx + bw * f)}" y="${r1(by)}" width="${r1(bw / steps + 0.3)}" height="${r1(bh)}" fill="${shadeOf(Math.max(v, u.log ? 1 : 0), top2, u.log).fill}"/>`); }
    out.push(`<rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bw)}" height="${r1(bh)}" fill="none" stroke="${INK}" stroke-width="${LW}"/>`);
    let ticks = scaleTicks(max, u.log).filter(v => v <= max);
    if (u.log) { if (max / ticks.at(-1) >= 1.6) ticks.push(max); } else if (max - ticks.at(-1) > (ticks[1] - ticks[0] || 1) / 2) ticks.push(max);
    for (const v of ticks) { const x = bx + bw * (u.log ? Math.log10(Math.max(v, 1)) / Math.log10(top2) : v / top2); out.push(L(x, by + bh, x, by + bh + 2.52), T(x, by + bh + 4.32 + SMALL * 0.8, num(v), { z: SMALL, anchor: 'middle' })); }
    out.push(T(bx + bw / 2, by + bh + 18 + SMALL * 0.8, `Number of ${u.name.toLowerCase()} (${u.log ? 'log' : 'linear'} scale; white = 0)`, { z: SMALL, anchor: 'middle' }));
  });
  // the nested row labels: the group turned up its rows, each field's value over the rows that share it (bold, with a bracket, but the last two)
  heads.forEach((h, d) => { if (h) out.push(T(xs[d] + 2.88, bodyTop - 2.88, h, { z: SMALL, bold: true })); });
  const spans = (keyOf) => { const out2 = []; let a = 0; while (a < P.length) { let b = a; while (b < P.length && keyOf(b) === keyOf(a)) b++; out2.push([a, b]); a = b; } return out2; };
  const yOf = ([a, b]) => [bodyTop + rowY[a], bodyTop + rowY[b - 1] + CH];
  if (grouped) for (const sp of spans(i => groupOf(i))) { const [ya, yb] = yOf(sp); out.push(T(groupW * 0.45 + FONT * 0.35, (ya + yb) / 2, groupOf(sp[0]), { bold: true, anchor: 'middle', rot: true }), L(groupW - 1.44, ya + 1.44, groupW - 1.44, yb - 1.44)); }
  for (let d = 0; d < depth; d++) {
    const last = d === depth - 1, bold = d < depth - 2;
    for (const sp of spans(i => `${groupOf(i)}\u0001${P[i].slice(0, d + 1).join('\u0001')}`)) {
      const [ya, yb] = yOf(sp), v = P[sp[0]][d] ?? '';
      if (last) { for (let i = sp[0]; i < sp[1]; i++) out.push(T(xs[d] + 2.88, bodyTop + rowY[i] + CH / 2 + FONT * 0.35, P[i][d] ?? '')); continue; }
      const lines = bold ? wrap(v, widths[d] - 6, FONT, true) : [v], lh = FONT * 1.0, mid = (ya + yb) / 2;
      lines.forEach((l, n) => out.push(T(xs[d] + (bold ? 2.16 : 2.88), mid + (n - (lines.length - 1) / 2) * lh + FONT * 0.35, l, { bold })));
      if (bold) out.push(L(xs[d + 1] - 1.44, ya + 1.44, xs[d + 1] - 1.44, yb - 1.44));
    }
  }
  out.push(T(xs[0] + 2.16, bodyTop + totalY + CH / 2 + FONT * 0.35, 'Total', { bold: true }));
  return svgRoot(t, W, H, out.join(''), { title, desc: `${map.total} sources of evidence, ${map.rows.length} rows by ${cols.length} columns${both ? ', articles and patients' : ''}` });
}

/**
 * The map as a shaded heat map, as the Spine review's Figure 1 prints it: a block of articles and, when the table gives arm sizes and
 * `patients` names a scale, a block of patients beside it; in each, a block of columns per crossing field (Fusion, then Staging) under the
 * field's name, then the total column, and a total row under all; rows under their group's name when the map groups them. Each of articles and
 * patients is shaded on its own sequential scale (shadeOf), with its legend under it: the scale's ramp, its ticks and what it counts.
 */
function shadedMapSvg(map, t, { title, width, source, shade, patients, drill = false }) {
  const both = !!patients, gap = '\u2002';
  const blocks = map.blocks?.length ? map.blocks : [{ field: map.colField, cols: map.cols, cells: map.cells, totals: { cols: map.totals.cols }, patients: map.patients ? { cols: map.patients.cols } : null }];
  const many = blocks.length > 1, starts = blocks.map((_, b) => blocks.slice(0, b).reduce((n, x) => n + x.cols.length, 0));
  const unitCols = [...blocks.flatMap(b => b.cols), 'Total'], cols = both ? [...unitCols, gap, ...unitCols] : unitCols;
  // the rows drawn: a group's name over its rows, then the total row
  const display = map.groups?.length ? map.groups.flatMap(g => [{ head: g.label }, ...map.rows.slice(g.from, g.to).map((r, k) => ({ i: g.from + k, label: r }))])
    : map.rows.map((r, i) => ({ i, label: r }));
  const labels = [...display.map(d => d.head ?? d.label), 'Total'];
  const f = matrixFrame(t, { rows: labels, cols, width: width || (both || many ? t.width.double * 1.25 : null), cell: t.row * 2.4 }), { P, ls } = f;
  const rowH = Math.max(t.row * 1.5, ...display.map((_, k) => f.rowH(k))), w = Math.min(...unitCols.slice(0, -1).map((_, j) => f.cw[j])) - 2;
  const at = (u, j) => (u ? unitCols.length + 1 : 0) + j;   // a unit's column j (articles 0, patients 1) in the frame
  const span = (u, from, to) => [f.cx[at(u, from)], f.cx[at(u, to)] + f.cw[at(u, to)]];
  const parts = [], body = [];
  // the titles over the columns: Articles and Patients, then each crossing field's name over its block with a rule under it
  const tier = f.step * 1.6;
  if (both) {
    for (const [u, name] of [[0, 'Articles'], [1, 'Patients']]) { const [x0, x1] = span(u, 0, unitCols.length - 1); parts.push(text(t, (x0 + x1) / 2, f.top + ls, name, { anchor: 'middle', role: 'head' })); }
    f.top += tier;
  }
  if (many) {
    for (const u of both ? [0, 1] : [0]) blocks.forEach((b, k) => {
      const [x0, x1] = span(u, starts[k], starts[k] + b.cols.length - 1);
      parts.push(text(t, (x0 + x1) / 2, f.top + ls, b.field.label, { anchor: 'middle', role: 'head' }), hairLine(t, x0 + 2, f.top + ls * 1.5, x1 - 2, f.top + ls * 1.5));
    });
    f.top += tier;
  }
  let y = drawHeads(t, parts, f, cols);
  const units = [{ value: c => c.count, rows: map.totals.rows, all: map.totals.all, cols: b => b.totals.cols, scale: shade, unit: 'source', noun: 'articles' },
    ...(both ? [{ value: c => c.patients, rows: map.patients.rows, all: map.patients.all, cols: b => b.patients?.cols || [], scale: patients, unit: 'patient', noun: 'patients' }] : [])];
  const maxOf = u => Math.max(1, ...blocks.flatMap(b => b.cells.flat().map(u.value)));
  const num = n => Number(n).toLocaleString('en-US');
  display.forEach((d, k) => {
    const cy = y + rowH / 2;
    if (d.head != null) { body.push(text(t, P, cy + ls * 0.35, d.head, { role: 'head' })); y += rowH; return; }
    body.push(withDrill(drillOf(drill, idsOfRow(blocks, d.i), d.label), rowLabel(t, f, k, cy, d.label)));
    units.forEach((u, ui) => {
      const max = maxOf(u);
      blocks.forEach((b, bk) => b.cells[d.i].forEach((c, j) => {
        const v = u.value(c); if (!v) return;
        const col = at(ui, starts[bk] + j), { fill, ink } = shadeOf(v, max, u.scale === 'log'), x0 = f.cx[col] + (f.cw[col] - w) / 2;
        body.push(`<rect x="${r1(x0)}" y="${r1(y + 1)}" width="${r1(w)}" height="${r1(rowH - 2)}" fill="${fill}"${drillOf(drill, c.paperIds, `${d.label}, ${b.cols[j]}`)}><title>${esc(`${d.label}, ${b.cols[j]}: ${num(v)} ${u.unit}${v === 1 ? '' : 's'}`)}</title></rect>`,
          text(t, f.cx[col] + f.cw[col] / 2, cy + ls * 0.35, num(v), { anchor: 'middle', cls: 'c-shade', color: ink, attrs: 'pointer-events="none"' }));
      }));
      const tc = at(ui, unitCols.length - 1);
      body.push(withDrill(drillOf(drill, idsOfRow(blocks, d.i), `${d.label}, all`), text(t, f.cx[tc] + f.cw[tc] / 2, cy + ls * 0.35, num(u.rows[d.i]), { anchor: 'middle', role: 'head' })));
    });
    y += rowH;
  });
  // the total row: each column's studies (each once) and patients, and the whole
  y += ls * 0.4;
  body.push(hairLine(t, P, y, f.right, y));
  const cy = y + rowH / 2;
  body.push(rowLabel(t, f, labels.length - 1, cy, 'Total', { role: 'head' }));
  units.forEach((u, ui) => {
    blocks.forEach((b, bk) => b.cols.forEach((_, j) => { const c = at(ui, starts[bk] + j); body.push(withDrill(drillOf(drill, idsOfCol(b, j), `${b.cols[j]}, all rows`), text(t, f.cx[c] + f.cw[c] / 2, cy + ls * 0.35, num(u.cols(b)[j] ?? 0), { anchor: 'middle', role: 'head' }))); }));
    const tc = at(ui, unitCols.length - 1);
    body.push(withDrill(drillOf(drill, map.rows.flatMap((_, i) => idsOfRow(blocks, i)), 'All studies'), text(t, f.cx[tc] + f.cw[tc] / 2, cy + ls * 0.35, num(u.all), { anchor: 'middle', role: 'head' })));
  });
  y += rowH;
  // each scale's legend under its columns: the ramp from its lightest step to its darkest, its ticks, and what it counts
  const sm = t.size.small, barH = sm * 0.9, top = y + ls;
  units.forEach((u, ui) => {
    const max = maxOf(u), log = u.scale === 'log', [x0, x1] = span(ui, 0, unitCols.length - 2), lo = log ? 1 : 0, top2 = Math.max(log ? 2 : 1, max);
    const X = v => x0 + (x1 - x0) * (log ? Math.log10(Math.max(v, 1)) / Math.log10(top2) : (v - lo) / top2), steps = 32;
    for (let k = 0; k < steps; k++) {
      const a = k / steps, v = log ? 10 ** (a * Math.log10(top2)) : a * top2, xa = x0 + (x1 - x0) * a;
      body.push(`<rect x="${r1(xa)}" y="${r1(top)}" width="${r1((x1 - x0) / steps + 0.4)}" height="${r1(barH)}" fill="${shadeOf(Math.max(v, log ? 1 : 0), top2, log).fill}"/>`);
    }
    body.push(`<rect x="${r1(x0)}" y="${r1(top)}" width="${r1(x1 - x0)}" height="${r1(barH)}" fill="none" stroke="${t.color.ink}" stroke-width="0.5"/>`);
    for (const v of scaleTicks(max, log)) {
      const x = X(v);
      body.push(hairLine(t, x, top + barH, x, top + barH + sm * 0.4), text(t, x, top + barH + sm * 1.5, num(v), { anchor: 'middle', role: 'small', color: t.color.ink }));
    }
    body.push(text(t, (x0 + x1) / 2, top + barH + sm * 3, `Number of ${u.noun} (${log ? 'log' : 'linear'} scale; white = 0)`, { anchor: 'middle', role: 'small', color: t.color.ink }));
  });
  y = top + barH + sm * 3.4;
  parts.push(...body);
  const scaleWords = (what, sc) => `${what} on a ${sc === 'log' ? 'log' : 'linear'} scale`;
  const by = blocks.map(b => b.field.label).join(' and by ');
  const h = footBlock(t, parts, y, f.w, { source: [
    `${map.total} sources of evidence; ${map.rowField.label} by ${by}`,
    `Shading is proportional to the count: ${[scaleWords('articles', shade), ...(both ? [scaleWords('patients', patients)] : [])].join('; ')}; no shading = 0. A study with arms in several cells is counted in each and once in the totals`,
    ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: `${map.total} sources of evidence, ${map.rows.length} rows by ${blocks.reduce((n, b) => n + b.cols.length, 0)} columns${both ? ', articles and patients' : ''}` });
}
