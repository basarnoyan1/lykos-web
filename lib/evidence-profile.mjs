// The Certainty view's glue for the GRADE evidence profile (lib/grade-profile.mjs):
// the profile over the project's GRADE rows (s.grade), what a linked pooled
// result says per domain as suggestions, the manuscript blocks it inserts, and
// the per-1,000 consequences of a diagnostic accuracy review's summary point
// at prevalences the reviewer enters. Pure.
import { evidenceProfile, analysisFacts, dtaSummary, profileCells } from './grade-profile.mjs';
import { linkedOutcome, parseRisk } from './grade-link.mjs';
import { analysisOf } from './outcomes.mjs';
import { summary as dtaPoint } from './dta.mjs';

/** The evidence profile of every GRADE row, in the rows' order. */
export const profileOf = s => evidenceProfile((s.grade || []).filter(o => o && typeof o === 'object'));

/**
 * Suggestions for inconsistency, imprecision and publication bias from the
 * pooled result a row is linked to; null when it has none. Never a rating.
 */
export function suggestionsFor(s, row) {
  const link = linkedOutcome(s, row);
  const a = link ? analysisOf(s, link.id) : null;
  if (!a) return null;
  const participants = Number(String(row.participants || '').replace(/[^\d.]/g, ''));
  return analysisFacts(a, Number.isFinite(participants) && participants > 0 ? { participants } : {});
}

/**
 * The profile as manuscript blocks: a table caption numbered like any other,
 * the table (outcome first, a header row, top and bottom rules) and the
 * numbered footnotes as paragraphs. `newId` names each block.
 */
export function manuscriptBlocks(profile, newId, { title = 'GRADE evidence profile' } = {}) {
  const text = `Table {{seq:Table}}. ${title}`;
  const rows = [['Outcome', ...profile.columns], ...profile.rows.map(r => [r.outcome, ...profileCells(r)])];
  const n = rows[0].length, w = Math.round((468 / n) * 20) / 20;
  const cell = t => ({ runs: [{ t: String(t ?? '') }], text: String(t ?? '') });
  return [
    { id: newId(), type: 'p', styleId: 'Caption', runs: [{ t: text }], text },
    { id: newId(), type: 'table', text: '', grid: { cols: Array(n).fill(w), borders: 'apa', rows: rows.map((r, i) => ({ header: i === 0, cells: r.map(cell) })) } },
    ...profile.footnotes.map((t, i) => { const x = `${i + 1}. ${t}`; return { id: newId(), type: 'p', runs: [{ t: x }], text: x }; }),
  ];
}

/** Prevalences as typed ("5%, 20%", "0.3; 50 per 1000"), as proportions; unreadable entries are left out. */
export const readPrevalences = text => String(text || '').split(/[,;]/).map(t => parseRisk(t.trim())).filter(p => p != null && p > 0 && p < 1);

/**
 * True and false positives and negatives per 1,000 tested at each prevalence,
 * from the saved bivariate summary point (s.dta); [] until the model has run.
 */
export function accuracyPerThousand(s, prevalences) {
  const sm = dtaPoint(s.dta?.biv);
  if (!sm) return [];
  const p = x => ({ estimate: x.est, lo: x.lo, hi: x.hi });
  return dtaSummary({ sensitivity: p(sm.sens), specificity: p(sm.spec), prevalences });
}

/**
 * The profile for the table-document writer (docx-write.mjs writeTablesDocx):
 * a landscape A4 page, the title, the table with its header repeated on each
 * page, and the numbered footnotes under it. Column widths follow the length
 * of what each column holds.
 */
export function tablesDocxBlocks(profile, { title = 'GRADE evidence profile', usable = 16838 - 2 * 567 } = {}) {
  const header = ['Outcome', ...profile.columns];
  const body = profile.rows.map(r => [r.outcome, ...profileCells(r)]);
  const need = header.map((h, i) => Math.min(40, Math.max(6, ...String(h).split(/\s+/).map(w => w.length), ...body.map(r => Math.ceil(String(r[i] ?? '').length / 2)))));
  const total = need.reduce((a, b) => a + b, 0), widths = need.map(n => Math.floor(usable * n / total));
  return [
    { type: 'para', text: title, bold: true, size: 10, after: 6 },
    { type: 'table', widths, header, headerFill: 'F2F2F2', rows: body.map(r => ({ cells: r.map(text => ({ text: String(text ?? ''), span: 1 })) })) },
    ...profile.footnotes.map((t, i) => ({ type: 'para', text: `${i + 1}. ${t}`, size: 7, before: i ? 2 : 8 })),
  ];
}
