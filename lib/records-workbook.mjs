// A workbook of records read for the Library's import and tools/lykos-import.mjs (2026-10-25); loaded on use, so the workbook reader stays out of
// the shell's first load.
import { looksLikeRecords, recordsFromRows } from './bib.mjs';
import { readXlsx } from './xlsx-read.mjs';

/** The records a workbook holds: the first sheet whose first row reads as a header of records (Title, Authors, DOI …); the Library's import and tools/lykos-import.mjs. */
export async function recordsFromWorkbook(bytes) {
  const wb = await readXlsx(bytes);
  const sheet = wb.sheets.find(sh => looksLikeRecords(sh.rows.find(r => r.some(c => String(c ?? '').trim())) || [])) || null;
  if (!sheet) return { records: [], format: 'Workbook', errors: wb.sheets.reduce((n, sh) => n + sh.rows.length, 0) };
  const at = sheet.rows.findIndex(r => r.some(c => String(c ?? '').trim()));
  return recordsFromRows(sheet.rows.slice(at), `Workbook: ${sheet.name}`);
}
