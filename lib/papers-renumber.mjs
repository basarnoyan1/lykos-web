// Renumbering the papers folder by inclusion order (PAPER-COVERAGE F5). The included studies are numbered 1, 2, 3 … in the order
// they were included; each one's PDF becomes `NN - Author YYYY.pdf` (the table ID rule of lib/folder-map.mjs). This module only plans:
// the renames go through lib/project-folder.mjs applyOrganise, so the organise log holds them and Undo puts every file back.
import { parseStudyPdf, parseAuthorYearPdf } from './folder-map.mjs';
import { familyName, authorList } from './bib.mjs';
import { studies as includedOf, screeningStarted, finalDecision } from './screen.mjs';
import { join, parentOf, baseName } from './fsys.mjs';

/** The included studies, earliest inclusion first; records included together (an import) keep their library order. Before any screening decision nothing is included. */
export function inclusionOrder(state) {
  return (screeningStarted(state) ? includedOf(state) : []).map((p, i) => ({ p, i, at: finalDecision(state, p.id)?.at || '' }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.i - b.i).map(x => x.p);
}

const clean = s => String(s).replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Moves in an order each can be made in: a rename whose target is another pending file's name waits for it; a cycle (two files
 * swapping names) parks one aside under a hidden name first. Every step is a plain move, so the log undoes them in reverse.
 */
export function orderMoves(moves) {
  const pending = moves.map(m => ({ from: m.from, to: m.to })), out = [];
  let parked = 0;
  while (pending.length) {
    const sources = new Set(pending.map(m => m.from));
    const i = pending.findIndex(m => !sources.has(m.to));
    if (i >= 0) { out.push(pending.splice(i, 1)[0]); continue; }
    const m = pending.shift(), aside = join(parentOf(m.from), `.lykos-renumber-${++parked}.tmp`);
    out.push({ from: m.from, to: aside });
    pending.push({ from: aside, to: m.to });
  }
  return out;
}

/**
 * What renumbering would do. `existing`: the paths now in the folder (so a target already taken by a file the plan does not move is
 * refused, and a record whose file is gone is left out); null skips that check. Returns `rows` (every included study with its file:
 * from, to, no), `changes` (those that change), `moves` (the renames in the order to make them), `unchanged`, `blocked` and
 * `missing` (included studies with no file).
 */
export function renumberPlan(state, { existing = null } = {}) {
  const order = inclusionOrder(state);
  const width = Math.max(2, String(order.length).length);
  const rows = [], missing = [];
  order.forEach((p, i) => {
    const no = i + 1, from = p.pdfRel || '';
    if (!from || (existing && !existing.has(from))) { missing.push({ id: p.id, label: p.label || p.title || p.id, no }); return; }
    const parsed = parseStudyPdf(baseName(from)) || parseAuthorYearPdf(baseName(from));
    const author = clean(parsed?.author || familyName(authorList(p.authors)[0] || '') || String(p.label || '').replace(/\s*\d{4}.*$/, '') || 'Unknown');
    const year = String(parsed?.year || p.year || '').slice(0, 4);
    const to = join(parentOf(from), `${String(no).padStart(width, '0')} - ${[author, year].filter(Boolean).join(' ')}${parsed?.suffix || ''}.pdf`);
    rows.push({ id: p.id, label: p.label || p.title || p.id, from, to, no, oldNo: parsed && 'no' in parsed ? parsed.no : null });
  });
  const leaving = new Set(rows.filter(r => r.from !== r.to).map(r => r.from));
  for (const r of rows) r.blocked = r.from !== r.to && !!existing && existing.has(r.to) && !leaving.has(r.to) ? 'A file with that name is in the folder' : '';
  const changes = rows.filter(r => r.from !== r.to && !r.blocked);
  return { rows, changes, moves: orderMoves(changes), unchanged: rows.filter(r => r.from === r.to).length, blocked: rows.filter(r => r.blocked), missing, width };
}
