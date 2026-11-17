// Checks on the text of a table, a figure's table or a drafted document in the Outputs view (RESEARCH-GAPS R4 and R5).
// Pure: the statistics-consistency check (lib/stat-consistency.mjs) reads every piece of prose the output shows, and the
// reference-style check (lib/reference-style-check.mjs) reads the reference list of a drafted document against the project's
// reference style. Nothing here changes the output; a finding says where it is and what it found.
import { statFindings } from './stat-consistency.mjs';
import { checkCitations } from './reference-list.mjs';
import { checkReferenceStyle } from './reference-style-check.mjs';

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The prose of an output as `{ where, text }` pieces: each text cell of a table (named by its row and column), each note, and for
 * a drafted document each section's text, table cells and item details. `model` is renderOutput's answer or a table-shaped
 * record (`columns`, `groups[].cells`, `notes`); `artifact` is a draft document (lib/research-artifacts.mjs).
 */
export function outputPieces({ model = null, artifact = null } = {}) {
  const out = [];
  const add = (where, text) => { const t = clean(text); if (t) out.push({ where, text: t }); };
  if (model) {
    let row = 0;
    for (const g of model.groups || []) for (const cells of g.cells || []) {
      row++;
      (cells || []).forEach((c, j) => add(`Row ${row}, ${clean(model.columns?.[j]?.label) || `column ${j + 1}`}`, c));
    }
    (model.notes || []).forEach(n => add('Note', n));
  }
  if (artifact) {
    for (const s of artifact.sections || []) {
      const at = clean(s.heading) || 'Section';
      add(at, s.text);
      (s.rows || []).forEach((r, i) => (r || []).forEach((c, j) => add(`${at}, row ${i + 1}, ${clean(s.columns?.[j]) || `column ${j + 1}`}`, c)));
      (s.items || []).forEach(it => add(`${at}, ${clean(it.label)}`, it.detail));
    }
    add('Subtitle', artifact.subtitle);
  }
  return out;
}

/** The statistics findings in the pieces: `[{ where, message, text }]`, none when the numbers agree or cannot be read. */
export function statisticsFindings(pieces) {
  const out = [];
  for (const p of pieces || []) for (const f of statFindings(p.text)) out.push({ kind: 'statistics', where: p.where, message: f.message, text: f.text });
  return out;
}

/**
 * The reference-style findings of a drafted document's sources: `[{ where, message }]`. The sources are read as a typed list under a
 * "References" heading and matched to the library; silent when they are consistent in `style`, when there are no sources, or
 * when none matches a record.
 */
export function referenceFindings(sources, { library = [], style = '' } = {}) {
  const lines = (sources || []).map(clean).filter(Boolean);
  if (!lines.length) return [];
  const blocks = [{ id: 'h-ref', type: 'h2', text: 'References' }, ...lines.map((text, i) => ({ id: `r${i}`, type: 'p', text }))];
  const out = checkReferenceStyle(checkCitations(blocks, { library }), { style });
  return out.issues.map(i => ({ kind: 'ref-style', where: 'Sources', message: i.message }));
}

/** Every finding for an output, statistics first. */
export function outputFindings({ model = null, artifact = null, library = [], style = '' } = {}) {
  return [...statisticsFindings(outputPieces({ model, artifact })), ...referenceFindings(artifact?.sources, { library, style })];
}
