// The supplement's own reference list (journals that number the supplement apart from the main text, as IJSS's AMA style does):
// the included studies, numbered as the ID column of the evidence table, written in AMA style from the library's records
// (lib/cite.mjs formatReference). Pure over the project state. A field a record lacks is left out, never guessed.
import { formatReference } from './cite.mjs';
import { cslItem } from './mendeley-cite.mjs';

const str = v => (v == null ? '' : String(v)).trim();
let n = 0;
const bid = () => `sr${(n++).toString(36)}`;

/** The included studies' records, in the order of the evidence table's ID column (the library's folder number). */
export function studyRecords(s) {
  return (s.papers || []).filter(p => str(p.folderNo) !== '').sort((a, b) => Number(a.folderNo) - Number(b.folderNo));
}
/** One reference as runs, the journal in italics: `{ no, text, runs }`. */
export function studyReference(p, no) {
  const q = { ...p, journal: str(p.journalAbbr) || str(p.journal) };
  const text = formatReference(q, 'ama'), at = q.journal ? text.indexOf(`${q.journal}.`) : -1;
  const runs = at < 0 ? [{ t: text }] : [{ t: text.slice(0, at) }, { t: q.journal, i: true }, { t: text.slice(at + q.journal.length) }];
  return { no, text, runs };
}
/**
 * The list as document blocks: the heading, then the list as Mendeley Cite's bibliography (one paragraph per study, "1. Author AB, ..."),
 * so the add-in takes it over with the table's citations (lib/mendeley-cite.mjs).
 */
export function studyReferenceBlocks(s, { heading = 'Supplementary references', style = 'ama' } = {}) {
  n = 0;
  const lines = studyRecords(s).map(p => { const r = studyReference(p, Number(p.folderNo)), lead = `${r.no}. `; return { text: lead + r.text, runs: [{ t: lead }, ...r.runs] }; });
  return [{ id: bid(), type: 'h1', text: heading, runs: [{ t: heading, b: true }] },
    { id: bid(), type: 'bib', mendeley: { style }, lines, text: lines.map(l => l.text).join('\n') }];
}

/** A study label with its reference number at the end, as a superscript: "Akgun et al., 2024, Türkiye" -> parts "Akgun et al., 2024, Türkiye", "1", "". */
export function splitAtYear(text, no) { return [String(text ?? ''), String(no), '']; }

/** A study's citation run in a table: its number as a Mendeley Cite citation (superscript), carrying the record as CSL. */
export const studyCiteRun = (p, no, style = 'ama', extra = {}) => ({ cite: [p.key || p.id], citeText: String(no), mendeley: { style, items: [cslItem(p)] }, ...extra });
