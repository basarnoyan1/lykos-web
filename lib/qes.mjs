// Thematic synthesis for a qualitative evidence synthesis (Thomas & Harden
// 2008): line-by-line codes on quoted findings, descriptive themes that group
// codes, and analytical themes built from descriptive themes.
//
// State lives in `s.qes`:
//   codes:       [{ id, label }]
//   quotes:      [{ id, code, paper, text, page, rects, document_version, at }]
//   descriptive: [{ id, label, codes: [codeId] }]
//   analytical:  [{ id, label, statement, themes: [descriptiveId], cerqual }]
// A quote carries the reader's anchor (page, rectangles, document hash), the
// same shape a quotation note has, so a code opens at the passage it came from.
//
// Every mutator here takes the state and changes it in place, for use inside
// store.update(). None leaves a reference to something that no longer exists:
// deleting or merging a code rewrites the themes that held it, and so on up.
import { studies } from './screen.mjs';
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text, lines, r1, esc, axisLine, matrixFrame, drawHeads, rowLabel, footBlock, emptyFigure, sourceOf } from './figure-kit.mjs';

const uid = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const LEVEL = { descriptive: 'descriptive', analytical: 'analytical' };
const memberKey = level => (level === 'analytical' ? 'themes' : 'codes');

/** The synthesis, with every list present. Creates it on a state being updated. */
export function qesOf(s) {
  s.qes ||= {};
  for (const k of ['codes', 'quotes', 'descriptive', 'analytical']) s.qes[k] ||= [];
  return s.qes;
}
/** Read-only view for rendering: never writes to the state. */
export const readQes = s => ({ codes: [], quotes: [], descriptive: [], analytical: [], ...(s?.qes || {}) });

// ---- codes ----------------------------------------------------------------
/** A code by label, reusing one already named the same (ignoring case). Returns its id. */
export function ensureCode(s, label) {
  const q = qesOf(s), name = clean(label);
  if (!name) return null;
  const found = q.codes.find(c => c.label.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const c = { id: uid('c'), label: name };
  q.codes.push(c);
  return c.id;
}

/**
 * A quoted finding coded with a label. `locator` is the reader's anchor
 * ({ page, rects, document_version }) or null for a quote typed in by hand.
 */
export function addQuote(s, { code, paper, text, locator = null }) {
  const body = String(text ?? '').trim();
  if (!body || !paper) return null;
  const codeId = qesOf(s).codes.some(c => c.id === code) ? code : ensureCode(s, code);
  if (!codeId) return null;
  const quote = { id: uid('q'), code: codeId, paper, text: body,
    page: locator?.page ?? null, rects: locator?.rects ?? null, document_version: locator?.document_version ?? null,
    at: new Date().toISOString() };
  s.qes.quotes.push(quote);
  return quote.id;
}

export function deleteQuote(s, id) {
  const q = qesOf(s);
  q.quotes = q.quotes.filter(x => x.id !== id);
}

// ---- themes and codes alike -------------------------------------------------
const listOf = (s, kind) => qesOf(s)[kind === 'code' ? 'codes' : kind];

/** Renames a code or a theme. A code renamed to another code's name merges into it. */
export function rename(s, kind, id, label) {
  const name = clean(label), item = listOf(s, kind).find(x => x.id === id);
  if (!name || !item) return;
  if (kind === 'code') {
    const twin = qesOf(s).codes.find(c => c.id !== id && c.label.toLowerCase() === name.toLowerCase());
    if (twin) { merge(s, 'code', [id], twin.id); return; }
  }
  item.label = name;
}

/** Folds `fromIds` into `intoId`: their members move to it and the parents that held them hold it instead. */
export function merge(s, kind, fromIds, intoId) {
  const q = qesOf(s), from = new Set(fromIds.filter(x => x !== intoId));
  if (!from.size || !listOf(s, kind).some(x => x.id === intoId)) return;
  if (kind === 'code') {
    for (const x of q.quotes) if (from.has(x.code)) x.code = intoId;
    q.codes = q.codes.filter(c => !from.has(c.id));
    replaceMembers(q.descriptive, 'codes', from, intoId);
    return;
  }
  const list = q[kind], into = list.find(t => t.id === intoId), key = memberKey(kind);
  for (const t of list) if (from.has(t.id)) into[key] = union(into[key], t[key]);
  if (kind === 'analytical') into.statement = [into.statement, ...list.filter(t => from.has(t.id)).map(t => t.statement)].filter(Boolean).join('\n\n');
  q[kind] = list.filter(t => !from.has(t.id));
  if (kind === 'descriptive') replaceMembers(q.analytical, 'themes', from, intoId);
}

/** Deletes codes or themes. A code takes its quotes with it; themes lose it as a member. */
export function remove(s, kind, ids) {
  const q = qesOf(s), gone = new Set(ids);
  if (kind === 'code') {
    q.codes = q.codes.filter(c => !gone.has(c.id));
    q.quotes = q.quotes.filter(x => !gone.has(x.code));
    for (const t of q.descriptive) t.codes = t.codes.filter(c => !gone.has(c));
    return;
  }
  q[kind] = q[kind].filter(t => !gone.has(t.id));
  if (kind === 'descriptive') for (const t of q.analytical) t.themes = t.themes.filter(d => !gone.has(d));
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];
function replaceMembers(parents, key, from, intoId) {
  for (const p of parents) {
    if (!p[key].some(m => from.has(m))) continue;
    p[key] = union(p[key].map(m => (from.has(m) ? intoId : m)));
  }
}

/** A new theme at a level holding `members` (code ids, or descriptive-theme ids). Returns its id. */
export function addTheme(s, level, label, members = []) {
  const name = clean(label); if (!name || !LEVEL[level]) return null;
  const q = qesOf(s), valid = new Set((level === 'analytical' ? q.descriptive : q.codes).map(x => x.id));
  const t = { id: uid(level === 'analytical' ? 'a' : 'd'), label: name, [memberKey(level)]: union(members.filter(m => valid.has(m))) };
  if (level === 'analytical') t.statement = '';
  q[level].push(t);
  return t.id;
}

/** Adds members to a theme, or takes them out. */
export function setMembers(s, level, themeId, members, on = true) {
  const q = qesOf(s), t = q[level]?.find(x => x.id === themeId); if (!t) return;
  const key = memberKey(level), valid = new Set((level === 'analytical' ? q.descriptive : q.codes).map(x => x.id));
  t[key] = on ? union(t[key], members.filter(m => valid.has(m))) : t[key].filter(m => !members.includes(m));
}

export function setStatement(s, id, text) {
  const t = qesOf(s).analytical.find(x => x.id === id); if (t) t.statement = String(text ?? '');
}

// ---- reading it back ------------------------------------------------------
/** Code ids beneath a theme at either level. */
export function codesUnder(s, level, id) {
  const q = readQes(s);
  if (level === 'code') return [id];
  if (level === 'descriptive') return q.descriptive.find(t => t.id === id)?.codes || [];
  const d = q.analytical.find(t => t.id === id)?.themes || [];
  return [...new Set(d.flatMap(x => q.descriptive.find(t => t.id === x)?.codes || []))];
}
/** Quotes supporting a code or theme. */
export const quotesUnder = (s, level, id) => { const set = new Set(codesUnder(s, level, id)); return readQes(s).quotes.filter(x => set.has(x.code)); };
/** Paper ids of the sources contributing to a code or theme, in first-quoted order. */
export const sourcesOf = (s, level, id) => [...new Set(quotesUnder(s, level, id).map(x => x.paper))];

/** Codes not yet in any descriptive theme; descriptive themes not yet in an analytical one. */
export function ungrouped(s) {
  const q = readQes(s);
  const inD = new Set(q.descriptive.flatMap(t => t.codes)), inA = new Set(q.analytical.flatMap(t => t.themes));
  return { codes: q.codes.filter(c => !inD.has(c.id)).map(c => c.id), descriptive: q.descriptive.filter(t => !inA.has(t.id)).map(t => t.id) };
}

/** The sources a matrix lists: the included studies, then any other quoted source. */
function sourcePapers(s) {
  const inc = studies(s), have = new Set(inc.map(p => p.id));
  const extra = [...new Set(readQes(s).quotes.map(x => x.paper))].filter(id => !have.has(id))
    .map(id => (s.papers || []).find(p => p.id === id)).filter(Boolean);
  return [...inc, ...extra];
}

/**
 * Sources × themes: which studies support which theme, and with how many
 * quotes. { level, rows: papers, cols: themes, cells[r][c] = quote count,
 * support[c] = sources contributing to the theme }.
 */
export function themeMatrix(s, level = 'analytical') {
  const q = readQes(s), rows = sourcePapers(s), cols = q[level] || [];
  const quotes = cols.map(t => quotesUnder(s, level, t.id));
  const cells = rows.map(p => quotes.map(list => list.filter(x => x.paper === p.id).length));
  const support = cols.map((_, j) => cells.filter(r => r[j] > 0).length);
  return { level, rows, cols, cells, support };
}

export const labelOf = (s, id) => (s.papers || []).find(p => p.id === id)?.label || id;

/** The matrix as CSV rows: one row per source, a quote count per theme, sources per theme last. */
export function matrixRows(m) {
  return [['Source', ...m.cols.map(t => t.label)],
    ...m.rows.map((p, i) => [p.label || p.id, ...m.cells[i]]),
    ['Sources contributing', ...m.support]];
}

/**
 * The matrix as a self-contained SVG in the house style: a grey square where a source supports a theme, with its
 * quote count, and the sources contributing to each theme under a rule. Source labels wrap to two lines or become a
 * key; theme heads never rotate. `style` is figureTokens (the export set unless given).
 */
export function matrixSvg(m, { style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' }), lv = m?.level || 'thematic', title = `Sources by ${lv} themes`;
  if (!m?.rows?.length || !m?.cols?.length)
    return emptyFigure(t, { title, message: m?.cols?.length ? 'No source is included yet.' : `No ${lv} theme has been built yet.`, width, source });
  const rows = m.rows.map(p => p.label || p.id), cols = m.cols.map(c => c.label);
  const f = matrixFrame(t, { rows, cols, width, cell: t.row * 2 }), { P, ls } = f, inset = t.unit === 'pt' ? 0.5 : 1;
  const parts = [], body = [];
  let y = drawHeads(t, parts, f, cols);
  m.rows.forEach((p, i) => {
    const h = f.rowH(i), cy = y + h / 2;
    body.push(rowLabel(t, f, i, cy, rows[i]));
    m.cells[i].forEach((n, j) => {
      if (!n) return;
      body.push(`<rect class="c-seq1" x="${r1(f.cx[j] + inset)}" y="${r1(y + inset)}" width="${r1(f.cw[j] - 2 * inset)}" height="${r1(h - 2 * inset)}" fill="${t.seq[1]}"><title>${esc(`${rows[i]}, ${cols[j]}: ${n} ${n === 1 ? 'quote' : 'quotes'}`)}</title></rect>`,
        text(t, f.cx[j] + f.cw[j] / 2, cy + ls * 0.35, String(n), { anchor: 'middle', attrs: 'pointer-events="none"' }));
    });
    y += h;
  });
  parts.push(...body, axisLine(t, P, y, f.right, y));
  const cy = y + Math.max(t.row, f.step * 1.2) / 2;
  parts.push(lines(t, f.x0 - ls * 0.6, cy, ['Sources'], { anchor: 'end', role: 'head', cls: 'c-ink c-head' }));
  (m.support || []).forEach((n, j) => parts.push(text(t, f.cx[j] + f.cw[j] / 2, cy + ls * 0.35, String(n), { anchor: 'middle' })));
  const line = `${m.rows.length} sources, ${m.cols.length} ${m.level} themes; quotes per cell`;
  const h = footBlock(t, parts, y + Math.max(t.row, f.step * 1.2), f.w, { source: [line, ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: line });
}

/** The drawings app/lint-figures.mjs checks: three sources by three themes, one with a long label, and a matrix without themes. */
export const __fixture = style => {
  const rows = [{ id: 'p1', label: 'Ames 2019' }, { id: 'p2', label: 'Cole, Hartmann and Ito 2021: older adults after a fall' }, { id: 'p3', label: 'Delgado 2020' }];
  const cols = [{ id: 'd1', label: 'Restricted life' }, { id: 'd2', label: 'Fear of falling again' }, { id: 'd3', label: 'Relationship with family and carers' }];
  const m = { level: 'descriptive', rows, cols, cells: [[2, 0, 1], [1, 3, 0], [0, 0, 0]], support: [2, 1, 1] };
  return [{ name: 'matrixSvg', svg: matrixSvg(m, { style }) }, { name: 'matrixSvg-empty', svg: matrixSvg({ level: 'analytical', rows, cols: [], cells: [], support: [] }, { style }) }];
};

// ---- exports ----------------------------------------------------------------
const locatorText = x => (x.page ? `p. ${x.page}` : 'typed');

/** One row per coded quote: source, locator, quote, code, the themes it sits under. */
export function codesCsvRows(s) {
  const q = readQes(s), code = new Map(q.codes.map(c => [c.id, c]));
  const dOf = id => q.descriptive.filter(t => t.codes.includes(id));
  const aOf = ds => q.analytical.filter(t => t.themes.some(d => ds.some(x => x.id === d)));
  return [['source', 'locator', 'quote', 'code', 'descriptive_themes', 'analytical_themes', 'document_version'],
    ...q.quotes.map(x => { const ds = dOf(x.code);
      return [labelOf(s, x.paper), locatorText(x), x.text, code.get(x.code)?.label || '',
        ds.map(t => t.label).join('; '), aOf(ds).map(t => t.label).join('; '), x.document_version || ''];
    })];
}

/** One row per theme: level, label, members, sources contributing, and an analytical theme's statement. */
export function themesCsvRows(s) {
  const q = readQes(s), code = new Map(q.codes.map(c => [c.id, c.label])), desc = new Map(q.descriptive.map(t => [t.id, t.label]));
  return [['level', 'theme', 'members', 'sources', 'source_count', 'statement'],
    ...q.descriptive.map(t => { const src = sourcesOf(s, 'descriptive', t.id);
      return ['descriptive', t.label, t.codes.map(c => code.get(c)).join('; '), src.map(id => labelOf(s, id)).join('; '), src.length, '']; }),
    ...q.analytical.map(t => { const src = sourcesOf(s, 'analytical', t.id);
      return ['analytical', t.label, t.themes.map(d => desc.get(d)).join('; '), src.map(id => labelOf(s, id)).join('; '), src.length, t.statement || '']; })];
}
