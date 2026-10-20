import { readXlsx, WORKBOOK_LIMITS } from './xlsx-read.mjs';
import { parseDelimited } from './bib.mjs';
import { decodeImport } from './import-safety.mjs';
import { fromRows } from './datasets.mjs';
import { fromDictionary } from './redcap.mjs';
import { looksLikeDictionary } from './data-management.mjs';
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const check = signal => { if (signal?.aborted) throw new DOMException('Import stopped', 'AbortError'); };
export async function parseDatasetBytes(bytes, name, { signal, onProgress = () => {} } = {}) {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('The import file exceeds 64 MiB');
  check(signal); onProgress('Reading file');
  const workbook = /\.xlsx$/i.test(name);
  const text = workbook ? '' : decodeImport(bytes).text;
  if (!workbook && looksLikeDictionary(text)) {
    const rows = parseDelimited(text, WORKBOOK_LIMITS).rows;
    if (rows.length > WORKBOOK_LIMITS.maxColumns + 1) throw new Error('The dictionary exceeds the supported column limit');
    return [fromDictionary(text, { name: name.replace(/\.\w+$/, '').replace(/_?DataDictionary.*$/i, '') || 'REDCap project', file: name })];
  }
  const sheets = workbook ? (await readXlsx(bytes, { signal, onProgress })).sheets : [{ name: name.replace(/\.\w+$/, ''), rows: parseDelimited(text, WORKBOOK_LIMITS).rows }];
  const filled = sheets.filter(sh => sh.rows.some(r => r.some(c => String(c ?? '').trim())));
  if (!filled.length) throw new Error('The file has no table');
  const result = []; let cells = 0;
  for (const sheet of filled) {
    check(signal); cells += sheet.rows.reduce((sum, row) => sum + row.length, 0);
    if (cells > WORKBOOK_LIMITS.maxCells) throw new Error('The workbook exceeds the supported cell limit');
    result.push(fromRows(sheet.rows, { name: filled.length > 1 ? `${name.replace(/\.\w+$/, '')} · ${sheet.name}` : name, file: name, sheet: sheet.name }));
    onProgress(`Prepared ${result.length} of ${filled.length} sheets`);
  }
  return result;
}
export async function parseDatasetFile(file, { signal, onProgress = () => {} } = {}) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The import file exceeds 64 MiB');
  check(signal); const buffer = await file.arrayBuffer(); check(signal);
  if (typeof Worker === 'undefined') return parseDatasetBytes(new Uint8Array(buffer), file.name, { signal, onProgress });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dataset-import-worker.mjs', import.meta.url), { type: 'module' });
    const done = (fn, value) => { worker.terminate(); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => done(reject, new DOMException('Import stopped', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => { if (data.progress) onProgress(data.progress); else if (data.error) done(reject, new Error(data.error)); else done(resolve, data.datasets); };
    worker.onerror = event => done(reject, new Error(event.message || 'The import worker failed'));
    worker.postMessage({ buffer, name: file.name }, [buffer]);
  });
}
