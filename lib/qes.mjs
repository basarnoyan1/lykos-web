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
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text, lines, r1, esc, axisLine, matrixFrame, drawHeads, rowLabel, footBlock, emptyFigure, sourceOf } from './figure-kit.mjs';
export { lib_qes_state$qesOf as qesOf, lib_qes_state$readQes as readQes, lib_qes_state$ensureCode as ensureCode, lib_qes_state$addQuote as addQuote, lib_qes_state$deleteQuote as deleteQuote, lib_qes_state$rename as rename, lib_qes_state$merge as merge, lib_qes_state$remove as remove, lib_qes_state$addTheme as addTheme, lib_qes_state$setMembers as setMembers, lib_qes_state$setStatement as setStatement, lib_qes_state$codesUnder as codesUnder, lib_qes_state$quotesUnder as quotesUnder, lib_qes_state$sourcesOf as sourcesOf, lib_qes_state$ungrouped as ungrouped, lib_qes_state$themeMatrix as themeMatrix, lib_qes_state$labelOf as labelOf, lib_qes_state$matrixRows as matrixRows, lib_qes_state$codesCsvRows as codesCsvRows, lib_qes_state$themesCsvRows as themesCsvRows } from "../boot.mjs";

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

