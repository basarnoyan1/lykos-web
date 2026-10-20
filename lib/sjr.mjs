// SCImago Journal Rank, from the file a person downloads from scimagojr.com (Journal Rankings, Download data: a CSV per year) and imports in
// Settings > Sources. SCImago's terms allow use with citation but not redistribution, so the table is never shipped: it is kept on this
// computer (IndexedDB, outside any project) and cited wherever it is shown ("SCImago Journal & Country Rank, 2024").
// Kept per journal: the title, its ISSNs, the SJR and the best quartile; a journal is found by ISSN first, then by its title.
import { journalKey } from './journal-presets.mjs';

export const SJR_SOURCE = 'SCImago Journal & Country Rank';

/** One CSV line into fields: SCImago's separator is ";", a field may be quoted and a quote inside one doubled. */
function fields(line, sep) {
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * The downloaded file as { year, rows: [[title, issns, sjr, quartile]] }; `name` gives the year ("scimagojr 2024.csv"). A file without the
 * Title, Issn, SJR and SJR Best Quartile columns is not SCImago's export, and says so.
 */
export function parseSjrCsv(text, name = '') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('The file is empty');
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = fields(lines[0], sep).map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  const [t, i, s, q] = ['title', 'issn', 'sjr', 'sjr best quartile'].map(col);
  if ([t, i, s, q].some(x => x < 0)) throw new Error('Not a SCImago journal rankings file: it needs the Title, Issn, SJR and SJR Best Quartile columns');
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = fields(line, sep), title = (f[t] || '').trim();
    if (!title) continue;
    const raw = String(f[s] || '').trim(), sjr = raw ? Number(raw.replace(/\./g, '').replace(',', '.')) : NaN;   // "1,234" is 1.234: SCImago writes a decimal comma; blank is none
    const quartile = /^Q[1-4]$/.test((f[q] || '').trim()) ? f[q].trim() : '';
    rows.push([title, (f[i] || '').replace(/[^0-9xX,]/g, '').toUpperCase(), Number.isFinite(sjr) ? sjr : null, quartile]);
  }
  if (!rows.length) throw new Error('No journals in the file');
  return { year: (/(19|20)\d{2}/.exec(name) || [''])[0], rows };
}

const issnKey = x => String(x || '').replace(/[^0-9xX]/g, '').toUpperCase();
/** Lookup maps for a table: by ISSN (8 characters, no hyphen) and by title key. */
export function indexSjr(table) {
  const byIssn = new Map(), byTitle = new Map();
  for (const r of table?.rows || []) {
    for (const n of r[1].split(',')) if (n.length === 8 && n !== '00000000' && !byIssn.has(n)) byIssn.set(n, r);
    const k = journalKey(r[0]); if (k && !byTitle.has(k)) byTitle.set(k, r);
  }
  return { year: table?.year || '', byIssn, byTitle };
}
/** The journal's SJR and best quartile, by an ISSN it has, else by its title: { sjr, quartile, year, title } or null. */
export function lookupSjr(index, { journal = '', issns = [] } = {}) {
  if (!index) return null;
  const r = issns.map(issnKey).map(n => index.byIssn.get(n)).find(Boolean) || index.byTitle.get(journalKey(journal));
  return r ? { title: r[0], sjr: r[2], quartile: r[3], year: index.year } : null;
}

// ---- kept on this computer ---------------------------------------------------------------------------------------------------------
const DB = 'lykos-sjr', STORE = 'table', KEY = 'current';
const db = () => new Promise((ok, no) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
const op = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error); }); };
let cached = null;   // the index of the table kept, once read
/** The kept table's index, or null when none was imported. */
export const loadSjr = () => cached ||= op('readonly', s => s.get(KEY)).then(t => (t ? { ...indexSjr(t), count: t.rows.length, importedAt: t.importedAt } : null), () => null);
/** Keeps a parsed table (it replaces the one before). */
export async function saveSjr(table) { await op('readwrite', s => s.put({ ...table, importedAt: new Date().toISOString() }, KEY)); cached = null; }
export async function removeSjr() { await op('readwrite', s => s.delete(KEY)); cached = null; }

/** The file a person chooses (SCImago's CSV export), or null. */
export function pickSjrFile() {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.csv,text/csv'; i.hidden = true; document.body.append(i);
    i.addEventListener('cancel', () => { i.remove(); resolve(null); }, { once: true });
    i.onchange = () => { const f = i.files?.[0] || null; i.remove(); resolve(f); };
    i.click();
  });
}
