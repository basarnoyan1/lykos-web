// The tables of a parsed Word document as plain rows, each with its caption and
// the works cited in its cells (plan §4.15a, folder setup). A supplement holds
// the review's search strategies, its appraisal and its patient table as Word
// tables; this reads them without a Word engine. Pure: takes what
// `parseDocx` returned.
const CITE = /\s*\[@([^\]\s]+)[^\]]*\]/g;

/** A cell's text without the citation tokens the parser leaves in it, and the keys they carried. */
export function cellText(text) {
  const cites = [];
  const plain = String(text ?? '').replace(CITE, (m, k) => { cites.push(k); return ''; }).replace(/\s+/g, ' ').trim();
  return { text: plain, cites };
}

/**
 * Every table as `{ index, id, caption, heading, header, rows, cites }`.
 * `caption` is the nearest paragraph above that is not empty ("Supplementary
 * Table S1. Search strategies…"); `heading` is the one above that when the
 * caption is a sub-heading ("S3a. JBI Critical Appraisal Checklist…"), so a
 * table can be named by either. `rows` are the cells' text below the header
 * row (the first row); `cites` lists, per row, the keys cited in its cells.
 */
export function docxTables(parsed) {
  const blocks = parsed?.blocks || [];
  const out = [];
  blocks.forEach((b, i) => {
    if (b.type !== 'table' || !b.grid?.rows?.length) return;
    const above = [];
    for (let j = i - 1; j >= 0 && above.length < 2; j--) { const t = String(blocks[j].text || '').replace(CITE, '').trim(); if (t && blocks[j].type !== 'table') above.push(t); else if (blocks[j].type === 'table') break; }
    const grid = b.grid.rows.map(r => r.cells.map(c => cellText(c.text)));
    const header = grid[0].map(c => c.text);
    out.push({ index: out.length, id: b.id, caption: above[0] || '', heading: above[1] || '', header,
      rows: grid.slice(1).map(r => r.map(c => c.text)), cites: grid.slice(1).map(r => [...new Set(r.flatMap(c => c.cites))]) });
  });
  return out;
}
