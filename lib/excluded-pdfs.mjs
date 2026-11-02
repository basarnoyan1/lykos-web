// Where the PDFs of the records excluded at full text belong: papers/Excluded/<reason>/<name> under the top folder they are in (the folder
// map's Excluded/, Research_Project_Standard). One plan for lykos-papers file-excluded and Screening › More › File excluded PDFs
// (28 Oct 2026: the eligibility round's PDFs were moved one by one). Pure: the state in, the moves out; the caller moves the files.
import { lib_screen$finalDecision as finalDecision } from "../boot.mjs";

/** A reason as a folder name: no slash, colon or control character, at most 60 characters. */
export const reasonFolder = reason => String(reason || 'No reason').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '') || 'No reason';

/** [{ paper, from, to }] for each record excluded at full text whose PDF is not in an Excluded or Superseded folder yet. */
export function excludedPdfMoves(s) {
  const out = [];
  for (const p of s?.papers || []) {
    const d = finalDecision(s, p.id);
    if (d?.decision !== 'exclude' || !s.fulltext?.[p.id] || !p.pdfRel) continue;
    const parts = String(p.pdfRel).split('/');
    if (parts.some(x => /^(excluded|superseded)$/i.test(x))) continue;
    out.push({ paper: p.id, from: p.pdfRel, to: [...parts.slice(0, Math.min(1, parts.length - 1)), 'Excluded', reasonFolder(d.reason), parts.at(-1)].join('/') });
  }
  return out;
}
