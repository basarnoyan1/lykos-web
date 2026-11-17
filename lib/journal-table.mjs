// How a journal sets its tables, for Manuscript › View › Journal (views/journal-preview.mjs). A journal style may declare `table`
// (lib/addons.mjs journalStyles; the journals addon declares it for The Lancet journals, read from their published pages):
//   title      'above' | 'below'   the title over the table, or under its legend at the foot of the table's box
//   widths     'content'           column widths follow the content: a short value is never broken, the row labels and the text columns take what is left
//   measures   [{ id, lines }]     the widths a table may take, narrowest first; the style's stylesheet gives each its width (.nj-table-box[data-measure]).
//                                  One with `lines` is taken only when the heads and the row labels then set in that many lines at most
//   turn       true                a table too wide for the widest measure stands on a turned page
//   numbers    'decimal'           the values of a column of numbers align on the decimal point, under a head set flush left
//   raiseHeads true                a head with no spanning head over it stands in the top row of the heads
//   continues  { next, previous }  what a table that runs over a page says at the foot of a part ("{table}" is its label) and at the top of the next
// The view sets nothing of a journal's own: it places the parts in the order declared, sizes the columns, and marks what a stylesheet draws
// from: a body row's `data-level` (how far its label is indented), `data-band` (0, 1: a label with the rows under it is one band, the bands
// alternate) and `data-section` (a bold label alone in its row); a head's `data-spanner` (it spans columns that have heads of their own
// under it) and `data-sub` (it stands under a spanning head). A style that declares no `table` has its tables set as before.
// Pure: no document, so the rules are tested without a browser.

const ID = /^[a-z][a-z0-9-]*$/;
/** The style's table declaration with its defaults; null when the style declares none. */
export function tableRules(style) {
  const t = style?.table;
  if (!t || typeof t !== 'object') return null;
  const measures = (Array.isArray(t.measures) ? t.measures : []).map(m => (typeof m === 'string' ? { id: m, lines: 0 } : { id: String(m?.id || ''), lines: Math.max(0, Number(m?.lines) || 0) })).filter(m => ID.test(m.id));
  return {
    title: t.title === 'below' ? 'below' : 'above',
    widths: t.widths === 'content' ? 'content' : 'even',
    measures: measures.length ? measures : [{ id: 'full', lines: 0 }],
    turn: t.turn !== false,
    numbers: t.numbers === 'decimal' ? 'decimal' : 'left',
    raiseHeads: t.raiseHeads === true,
    continues: { next: String(t.continues?.next ?? 'Continued'), previous: String(t.continues?.previous ?? '') },
  };
}

/**
 * The marks of a table's body rows. `rows`: [{ indent, bold, alone }] — the indent of the row's label (any unit; 0 flush), whether the
 * label is bold throughout, and whether the label is the row's only text. Answers [{ level, band, section }].
 * A label with the rows indented under it is one band, and the bands alternate from 0. A bold label alone in its row is a section: it is
 * on band 0, and the rows under it alternate one by one from band 1.
 */
export function bodyMarks(rows) {
  const steps = [...new Set(rows.map(r => Math.max(0, Number(r.indent) || 0)))].sort((a, b) => a - b);
  let band = 0, next = 0, top = 0, fresh = true;
  return rows.map(r => {
    const level = steps.indexOf(Math.max(0, Number(r.indent) || 0));
    if (r.bold && r.alone) { next = 1; fresh = true; return { level, band: 0, section: true }; }
    if (fresh || level <= top) { band = next; next = 1 - band; top = level; fresh = false; }
    return { level, band, section: false };
  });
}

/**
 * Where each head stands and what it is. `rows`: the head rows, each [{ span, down, text }] in document order (span: columns, down: rows).
 * Answers the same shape with { col, spanner, sub, raise }: `spanner` a head with text over two or more columns that has a head row under
 * it; `sub` a head under a spanner; `raise` (rows under the first) a head with text whose cells above are all empty single columns, so it
 * can stand in the top row.
 */
export function headMarks(rows) {
  const taken = [], out = rows.map(() => []);
  rows.forEach((cells, r) => {
    let col = 0;
    cells.forEach((c, i) => {
      while (taken[r]?.[col]) col++;
      const span = Math.max(1, Number(c.span) || 1), down = Math.max(1, Math.min(rows.length - r, Number(c.down) || 1));
      for (let y = r; y < r + down; y++) for (let x = col; x < col + span; x++) (taken[y] ||= [])[x] = { r, i };
      out[r][i] = { col, span, down, text: String(c.text || '').trim(), spanner: false, sub: false, raise: false };
      col += span;
    });
  });
  out.forEach((cells, r) => cells.forEach(c => {
    c.spanner = c.span > 1 && !!c.text && r + c.down < rows.length;
    if (r === 0) return;
    const above = [];
    for (let y = 0; y < r; y++) for (let x = c.col; x < c.col + c.span; x++) { const at = taken[y]?.[x]; if (at && !above.includes(out[at.r][at.i])) above.push(out[at.r][at.i]); }
    c.sub = above.some(a => a.span > 1 && !!a.text);
    c.raise = !!c.text && c.span === 1 && above.length === r && above.every(a => !a.text && a.span === 1 && a.down === 1);
  }));
  return out;
}

/** A cell's text is a value the journal does not break: one short line (a number with its interval, a word or two). */
export const valueLike = text => { const t = String(text || '').trim(); return !!t && t.length <= 24 && !/\n/.test(t); };

const LEAD = /^\s*(?:[<>≤≥=~]\s?)?[−–+-]?\d+/;
/** How many characters of a cell's text stand before its decimal point (a sign and the whole number); 0 for ".." (no datum), −1 for text. */
export const leadLength = text => { const s = String(text || ''); if (/^\s*\.\.\s*$/.test(s)) return 0; const m = LEAD.exec(s); return m ? m[0].length : -1; };
/** Whether a column's cells (their texts) are numbers to align: more than half of those with a datum (".." is none) open with a number. */
export function numberColumn(texts) {
  const filled = texts.map(t => String(t || '').trim()).filter(t => t && t !== '..'), nums = filled.filter(t => LEAD.test(t));
  return nums.length >= 2 && nums.length * 2 > filled.length;
}
/** The label of a table's title ("Table 1:" of "Table 1: Characteristics"), or ''. */
export const titleLabel = text => (/^\s*(?:Supplementary\s+)?Table\s+[A-Za-z]?\d+[A-Za-z]?\s*[:.]?/i.exec(String(text || '')) || [''])[0];
