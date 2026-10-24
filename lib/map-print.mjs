// The options an evidence map needs to reproduce its print (owner, 2026-10-24: "figure 1 also does not match"). A printed map is read by its
// own layout (lib/printed-data.mjs linesOf): the line of column heads, the Total line under the rows, and the labels left of the row labels.
// From those, a small search finds the options the item's map is drawn with (lib/evidence-map.mjs itemMap):
//
//   col2     a second block of columns: the field whose name the print sets over it ("Staging" beside "Fusion"), its heads the ones after
//            the first field's;
//   levels   which of a field's values make each printed column: a value equal to a head is that head; any other value is merged into one
//            head, chosen so every column's printed total of articles comes out, ties settled by how much of the head's wording the value
//            shares ("Two-stage for DXA T-score < −1.5; single stage for all other patients" into "Two-stage in some patients");
//   group    the field whose values the print names left of the rows ("Rigid rod", "Semi-rigid rod", …), in the print's order.
//
// The search space is small and bounded (MAX_TRIES assignments a field); nothing is kept unless the map drawn with the options agrees with the
// print row by row (printed-data compareMap). `{ ok, options, why }`. Pure: the caller reads the print and writes the item.
import { mappableFields, mapFields, evidenceMap, isUnknownLevel, NOT_REPORTED } from './evidence-map.mjs';
import { studies } from './screen.mjs';
import { valueFor } from './fields.mjs';
import { compareMap } from './printed-data.mjs';

export const MAX_TRIES = 50000;
const low = t => String(t ?? '').trim().toLowerCase();
const isNum = t => /^[\d,.]+%?$/.test(String(t).trim());
const STOP = new Set(['the', 'and', 'for', 'all', 'other', 'with', 'not', 'from', 'into', 'per', 'each', 'some']);
const words = t => (low(t).match(/[\p{L}\d][\p{L}\d-]*/gu) || []).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));

/** The print's layout: `{ heads: [{ t, x }], totals: Map(head index -> n), left: [labels], rowX }` of its first panel, or null. */
export function printLayout(lines) {
  const L = (lines || []).map(l => ({ ...l, xs: l.xs || l.cells.map((_, i) => i * 100) }));
  const total = L.findIndex(l => /^total$/i.test(String(l.cells[0] || '').trim()) && l.cells.slice(1).some(isNum));
  if (total < 0) return null;
  // the heads: the line above the rows with the most words and no number
  const above = L.slice(0, total).map((l, i) => ({ l, i, words: l.cells.filter(c => !isNum(c)).length, nums: l.cells.filter(isNum).length }));
  const headAt = above.filter(x => x.nums === 0).sort((a, b) => b.words - a.words || a.i - b.i)[0];
  if (!headAt || headAt.words < 3) return null;
  // a head printed on two lines ("Interbody and" over "posterolateral") is two runs a few points apart: one head
  const runs = headAt.l.cells.map((t, k) => ({ t: String(t).trim(), x: headAt.l.xs[k] })), heads = [];
  for (const r of runs) { const last = heads.at(-1); if (last && Math.abs(r.x - last.x0) < 12 && !/^total$/i.test(r.t) && !/^total$/i.test(last.t)) { last.t = `${last.t} ${r.t}`; } else heads.push({ t: r.t, x: r.x, x0: r.x }); }
  const end = heads.findIndex(h => /^total$/i.test(h.t));
  const first = end > 0 ? heads.slice(0, end + 1) : heads, edge = end > 0 ? first[end].x + 12 : Infinity;
  const body = L.slice(headAt.i + 1, total);
  const numX = Math.min(...body.flatMap(l => l.cells.map((c, k) => (isNum(c) && l.xs[k] < edge ? l.xs[k] : Infinity))));
  if (!Number.isFinite(numX)) return null;
  const rowHeads = first.filter(h => h.x < numX - 8), cols = first.filter(h => h.x >= numX - 8 && !/^total$/i.test(h.t));
  const rowX = rowHeads.length ? Math.min(...rowHeads.map(h => h.x)) : numX;
  // the Total line's numbers of the first panel, each under the head nearest it
  const totals = new Map(), tl = L[total];
  tl.cells.forEach((c, k) => {
    const x = tl.xs[k];
    if (!isNum(c) || x >= edge) return;
    const near = cols.map((h, i) => [i, Math.abs(h.x - x)]).sort((a, b) => a[1] - b[1])[0];
    if (near && near[1] < 14) totals.set(near[0], Number(String(c).replace(/,/g, '')));
  });
  // the labels left of the row labels, a label printed on two lines joined
  const left = [];
  for (const l of body) l.cells.forEach((c, k) => {
    const x = l.xs[k];
    if (x >= rowX - 3 || isNum(c)) return;
    const last = left.at(-1);
    if (last && Math.abs(last.x - x) < 3 && l.y - last.y <= 9) { last.t = `${last.t} ${c}`; last.y = l.y; } else left.push({ t: String(c).trim(), x, y: l.y });
  });
  return { heads: cols.map(h => h.t), totals, left: left.map(x => x.t), rowX, text: L.map(l => l.cells.join(' ')).join('\n') };
}

// each study's arm cells, [field, arm] by study: read once per state of the values
const armMemo = new WeakMap();
function armIndex(s) {
  const key = s.values || {};
  if (armMemo.has(key)) return armMemo.get(key);
  const idx = new Map();
  for (const k of Object.keys(key)) { const m = /^(.*):([^:@]+)@([^@]+)$/.exec(k); if (m) (idx.get(m[1]) || idx.set(m[1], []).get(m[1])).push([m[2], m[3]]); }
  armMemo.set(key, idx);
  return idx;
}
/** Each included source's units (its arms, else the study) and a field's whole value in each: [[value, …], …], one list per source. */
export function unitValues(s, fieldIds, fid) {
  const fields = mappableFields(s), f = fields.find(x => x.id === fid);
  const ids = new Set(fieldIds);
  const idx = armIndex(s);
  return studies(s).map(p => {
    const arms = new Set((idx.get(p.id) || []).filter(([f]) => ids.has(f)).map(([, a]) => a));
    const of = arm => {
      const own = arm ? s.values?.[`${p.id}:${fid}@${arm}`] : null;
      const raw = own && own.availability !== 'not_found' ? String(own.reported_value ?? own.normalized_value ?? '').trim() : '';
      return raw || String((f ? valueFor(s, p.id, f) : '') || '').trim() || NOT_REPORTED;
    };
    return (arms.size ? [...arms] : ['']).map(of);
  });
}

/**
 * How much of a head's wording a value shares: its start (2), each word in common (1), every word of the head (1); its lead (the part before
 * the first ";", "Two-stage for DXA T-score < −1.5" of "…; single stage for all other patients") counts twice, since that is what it is.
 */
function likeness(v, h) {
  const one = (x, y) => {
    const a = low(x), b = low(y), wv = new Set(words(x)), wh = words(y);
    return (a.startsWith(b) && !/[\p{L}\d]/u.test(a.charAt(b.length)) ? 2 : 0) + wh.filter(w => wv.has(w)).length + (wh.length && wh.every(w => wv.has(w)) ? 1 : 0);
  };
  const lead = String(v).split(/\s*;\s*/)[0];
  return one(v, h) + (lead !== String(v) ? 2 * one(lead, h) : 0);
}

/**
 * A field's merges into `heads` that give the printed totals: `{ levels: { value: head }, score }` or null. A value equal to a head (or each of
 * whose ";" parts is one) stays as it is; the others are tried against the heads they share wording with (all heads for a value not
 * reported), every combination, up to MAX_TRIES. Of the combinations that give every head its printed total, the one most alike wins; two
 * equally alike and different is no answer.
 */
export function fitLevels(units, heads, totals) {
  const H = heads.map(low), at = new Map(H.map((h, i) => [h, i]));
  const values = [...new Set(units.flat())];
  const fixed = new Map(), open = [];
  for (const v of values) {
    if (at.has(low(v))) { fixed.set(v, [at.get(low(v))]); continue; }
    const parts = String(v).split(/\s*;\s*/).map(low);
    if (parts.length > 1 && parts.every(x => at.has(x))) { fixed.set(v, parts.map(x => at.get(x))); continue; }
    // a value that names nothing (\"Not reported\") leans to the larger column, the reading a script that merged it most likely made
    const scored = heads.map((h, i) => [i, likeness(v, h) + 1e-4 * (totals.get(i) ?? 0)]);
    let cands = scored.filter(x => x[1] >= 1).map(x => x[0]);
    if (!cands.length || isUnknownLevel(v) || low(v) === low(NOT_REPORTED)) cands = heads.map((_, i) => i);
    open.push({ v, cands, score: new Map(scored) });
  }
  const tries = open.reduce((n, o) => n * o.cands.length, 1);
  if (tries > MAX_TRIES) return null;
  const want = heads.map((_, i) => totals.get(i) ?? 0), pick = new Array(open.length).fill(0), idx = new Map(open.map((o, i) => [o.v, i]));
  let best = null, tie = false;
  for (let n = 0; n < tries; n++) {
    let r = n;
    for (let i = 0; i < open.length; i++) { pick[i] = open[i].cands[r % open[i].cands.length]; r = Math.floor(r / open[i].cands.length); }
    const count = new Array(heads.length).fill(0);
    for (const unit of units) {
      const cols = new Set();
      for (const v of unit) { if (fixed.has(v)) fixed.get(v).forEach(c => cols.add(c)); else cols.add(pick[idx.get(v)]); }
      for (const c of cols) count[c]++;
    }
    if (count.some((c, i) => c !== want[i])) continue;
    const score = open.reduce((t, o, i) => t + o.score.get(pick[i]), 0);
    if (!best || score > best.score) { best = { score, pick: [...pick] }; tie = false; } else if (score === best.score) tie = true;
  }
  if (!best || tie) return null;
  return { levels: Object.fromEntries(open.map((o, i) => [o.v, heads[best.pick[i]]])), score: best.score };
}

/**
 * The options that reproduce a printed evidence map: `{ ok: true, options }` (rows, col, col2, levels, group, as an item's `map` keeps them),
 * or `{ ok: false, why }`. `lines` are the print's lines (linesOf, with each run's x); `it` the package item (its own rows and column, else the
 * project's map fields).
 */
export function mapOptionsFromPrint(s, it, lines) {
  const lay = printLayout(lines);
  if (!lay) return { ok: false, why: 'The print has no column heads over a Total line' };
  const { row, col } = mapFields(s), rows = it?.map?.rows || s.evidenceMap?.rows || (Array.isArray(row) ? row : [row]), c1 = it?.map?.col || col;
  if (!rows?.length || !c1) return { ok: false, why: 'The map has no fields' };
  const all = mappableFields(s), text = low(lay.text), H = lay.heads, T = i => lay.totals.get(i) ?? 0;
  // the column fields: the first, then perhaps a second whose name the print sets over its block
  const named = all.filter(f => ![...rows, c1].includes(f.id) && words(f.label).some(w => w.length >= 4 && new RegExp(`(^|\\W)${w}(\\W|$)`).test(text)));
  const tried = [];
  for (let j = H.length; j >= 1; j--) {
    const a = fitLevels(unitValues(s, [...rows, c1], c1), H.slice(0, j), new Map(H.slice(0, j).map((_, i) => [i, T(i)])));
    if (!a) continue;
    if (j === H.length) { tried.push({ col2: null, levels: { [c1]: a.levels } }); break; }
    for (const g of named) {
      const b = fitLevels(unitValues(s, [...rows, c1, g.id], g.id), H.slice(j), new Map(H.slice(j).map((_, i) => [i, T(i + j)])));
      if (b) tried.push({ col2: g.id, levels: { [c1]: a.levels, [g.id]: b.levels } });
    }
    if (tried.length) break;
  }
  if (!tried.length) return { ok: false, why: 'No merge of the fields\' values gives the printed column totals' };
  // the row groups: the field whose values the print names left of the rows, in the print's order
  const left = lay.left.map(low);
  const groups = all.filter(f => ![...rows, c1, ...tried.map(t => t.col2)].includes(f.id)).map(f => {
    const parts = [...new Set(unitValues(s, [...rows, f.id], f.id).flat().flatMap(v => String(v).split(/\s*;\s*/)).filter(v => v && !isUnknownLevel(v) && low(v) !== low(NOT_REPORTED)))];
    const hit = parts.filter(v => left.includes(low(v)));
    return { f, parts, hit };
  }).filter(g => g.hit.length >= 2 && g.hit.length >= 0.6 * g.parts.length).sort((a, b) => b.hit.length - a.hit.length || a.parts.length - b.parts.length);
  const group = groups[0] ? { field: groups[0].f.id, how: 'map', map: Object.fromEntries(lay.left.map(t => groups[0].hit.find(v => low(v) === low(t))).filter(Boolean).map(v => [v, v])) } : null;
  for (const t of tried) {
    const options = { rows, col: c1, ...(t.col2 ? { col2: t.col2 } : {}), levels: Object.fromEntries(Object.entries(t.levels).filter(([, m]) => Object.keys(m).length)), ...(group ? { group } : {}) };
    const map = evidenceMap(s, rows, c1, { col2: options.col2 || null, levels: options.levels, group: options.group || null });
    if (!map) continue;
    const cmp = compareMap(lines, map);
    if (!cmp.mismatches.length && cmp.matched) return { ok: true, options, matched: cmp.matched };
  }
  return { ok: false, why: 'The options that give the column totals do not reproduce every printed row' };
}
