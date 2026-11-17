// A legacy Excel workbook (.xls, BIFF8 in an OLE compound file) read as text cells, in the shape lib/xlsx-read.mjs gives for .xlsx:
// { sheets: [{ name, rows: [[string]] }] }. For the texts Lykos keeps of a study's supplement (tools/fulltext.mjs) and lib/filetext.mjs, so
// a value a supplement table holds can be proven from it (work queue row 50, 17 Nov 2026: Coenen 2019's eTable 4 and Lee 2025's
// Supplementary Table 1 were attached but unread). Only what a table's text needs: the shared strings, text, number, RK, multiple-RK,
// boolean and formula cells (a formula's cached result); no styles, no dates as dates (a date cell reads as its serial number, as Excel
// stores it). Pure: bytes in, cells out; every read is bounds-checked and a chain of sectors that loops or runs off the file stops it.

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff, MAX_SHEETS = 256, MAX_CELLS = 2_000_000, MAX_BYTES = 64 << 20, MAX_RECORDS = 4_000_000;

class Bytes {
  constructor(b) { this.b = b; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  check(at, n) { if (!Number.isInteger(at) || at < 0 || at + n > this.b.length) throw new Error('xls: a read runs past the end of the file'); }
  u8(at) { this.check(at, 1); return this.b[at]; }
  u16(at) { this.check(at, 2); return this.v.getUint16(at, true); }
  u32(at) { this.check(at, 4); return this.v.getUint32(at, true); }
  f64(at) { this.check(at, 8); return this.v.getFloat64(at, true); }
}

/** The compound file's streams by name: { read(name) → Uint8Array | null }. */
function compoundFile(bytes) {
  const B = new Bytes(bytes);
  if (bytes.length < 512 || SIG.some((x, i) => bytes[i] !== x)) throw new Error('xls: not an OLE compound file (an .xls of Excel 97 to 2003)');
  const sectorShift = B.u16(0x1e), miniShift = B.u16(0x20);
  if (sectorShift !== 9 && sectorShift !== 12) throw new Error('xls: an unknown sector size');
  const SS = 1 << sectorShift, MS = 1 << miniShift, cutoff = B.u32(0x38);
  if (cutoff !== 4096 || miniShift !== 6) throw new Error('xls: an unknown mini stream layout');
  const offset = s => (s + 1) * SS;   // the header fills the first sector (512 bytes, or 4096 in a version 4 file)
  const nSectors = Math.floor(bytes.length / SS);
  // the sectors of the FAT: the header's first 109, then the chain of DIFAT sectors
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = B.u32(0x4c + 4 * i); if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s); }
  const fatCount = B.u32(0x2c), seenDifat = new Set();
  if (fatCount > nSectors) throw new Error('xls: more FAT sectors than the file holds');
  let difat = B.u32(0x44);
  while (difat !== ENDOFCHAIN && difat !== FREESECT && fatSectors.length < fatCount) {
    if (seenDifat.has(difat) || difat >= nSectors) throw new Error('xls: a broken chain of DIFAT sectors');
    seenDifat.add(difat);
    const at = offset(difat);
    for (let i = 0; i < SS / 4 - 1; i++) { const s = B.u32(at + 4 * i); if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s); }
    difat = B.u32(at + SS - 4);
  }
  const fat = [], fatSeen = new Set();
  if (fatSectors.length > Math.min(fatCount || Infinity, nSectors)) fatSectors.length = Math.min(fatCount || fatSectors.length, nSectors);
  for (const s of fatSectors) {
    if (s >= nSectors || fatSeen.has(s)) throw new Error('xls: a FAT sector out of range or named twice'); fatSeen.add(s); const at = offset(s); for (let i = 0; i < SS / 4; i++) fat.push(B.u32(at + 4 * i)); }
  const chain = start => { const out = [], seen = new Set(); for (let s = start; s !== ENDOFCHAIN; s = fat[s]) { if (s === undefined || s === FREESECT || seen.has(s) || s >= fat.length) throw new Error('xls: a broken chain of sectors'); seen.add(s); out.push(s); } return out; };
  const readChain = (start, size) => { const ss = chain(start); if (size > MAX_BYTES || size > ss.length * SS) throw new Error('xls: a stream larger than its sectors or than a workbook holds'); const out = new Uint8Array(size); let n = 0; for (const s of ss) { if (n >= size) break; const at = offset(s), take = Math.min(SS, size - n); B.check(at, take); out.set(bytes.subarray(at, at + take), n); n += take; } if (n < size) throw new Error('xls: a stream is shorter than its directory says'); return out; };
  // the directory: 128-byte entries along its chain
  const dirBytes = (() => { const ss = chain(B.u32(0x30)), out = new Uint8Array(ss.length * SS); ss.forEach((s, i) => { const at = offset(s); B.check(at, SS); out.set(bytes.subarray(at, at + SS), i * SS); }); return out; })();
  const D = new Bytes(dirBytes), entries = [];
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const len = D.u16(at + 64), type = D.u8(at + 66);
    if (!type || len < 2 || len > 64) continue;
    let name = ''; for (let i = 0; i < len - 2; i += 2) name += String.fromCharCode(D.u16(at + i));
    entries.push({ name, type, start: D.u32(at + 116), size: D.u32(at + 120) });
  }
  const root = entries.find(e => e.type === 5);
  let mini = null, miniFat = null;
  const miniStream = () => {
    if (!mini) {
      mini = root && root.size ? readChain(root.start, root.size) : new Uint8Array(0);
      miniFat = []; const first = B.u32(0x3c);
      if (first !== ENDOFCHAIN && first !== FREESECT) for (const s of chain(first)) { const at = offset(s); for (let i = 0; i < SS / 4; i++) miniFat.push(B.u32(at + 4 * i)); }
    }
    return { mini, miniFat };
  };
  return {
    read(name) {
      const e = entries.find(x => x.type === 2 && x.name === name);
      if (!e) return null;
      if (e.size >= cutoff) return readChain(e.start, e.size);
      const { mini: m, miniFat: mf } = miniStream();
      if (e.size > m.length) throw new Error('xls: a small stream larger than the mini stream');
      const out = new Uint8Array(e.size), seen = new Set(); let n = 0;
      for (let s = e.start; s !== ENDOFCHAIN && n < e.size; s = mf[s]) {
        if (s === undefined || seen.has(s)) throw new Error('xls: a broken chain of mini sectors'); seen.add(s);
        const at = s * MS, take = Math.min(MS, e.size - n); if (at + take > m.length) throw new Error('xls: a mini sector past the mini stream');
        out.set(m.subarray(at, at + take), n); n += take;
      }
      if (n < e.size) throw new Error('xls: a small stream is shorter than its directory says');
      return out;
    },
  };
}

/** An RK number: a 30-bit integer or the high 30 bits of a double, divided by 100 when its lowest bit says so. */
function rk(v) {
  let x;
  if (v & 2) x = (v | 0) >> 2;
  else { const buf = new DataView(new ArrayBuffer(8)); buf.setUint32(0, 0, true); buf.setUint32(4, v & 0xfffffffc, true); x = buf.getFloat64(0, true); }
  return v & 1 ? x / 100 : x;
}
// an error cell as Excel shows it
const ERR = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' }, errText = c => ERR[c] || '#ERROR';
// a number as text (the stored value, as lib/xlsx-read.mjs gives it; a display format such as 0.0000 is not applied): the shortest form that reads back as the same double, as Excel shows a typed value
const num = x => (Number.isFinite(x) ? String(Number(x.toPrecision(15))) : '');

/** The workbook's sheets as text cells: { sheets: [{ name, rows: [[string]] }] }. Throws on a file that is not BIFF8. */
export function readXls(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_BYTES) throw new Error('xls: a file larger than a supplement table');
  const cf = compoundFile(bytes), wb = cf.read('Workbook') || cf.read('Book');
  if (!wb) throw new Error('xls: no workbook stream in the file');
  const W = new Bytes(wb);
  // the records, with each record's CONTINUE records kept beside it (a shared string may run across them)
  const recs = [];
  for (let at = 0; at + 4 <= wb.length;) {
    const type = W.u16(at), len = W.u16(at + 2); W.check(at + 4, len);
    const data = wb.subarray(at + 4, at + 4 + len);
    if (type === 0x003c && recs.length) recs.at(-1).cont.push(data); else recs.push({ type, data, at, cont: [] });
    if (recs.length > MAX_RECORDS) throw new Error('xls: more records than a workbook of tables holds');
    at += 4 + len;
  }
  if (recs.some(r => r.type === 0x002f)) throw new Error('xls: the workbook is encrypted (FILEPASS); open it in Excel and save it unprotected');
  const bof = recs[0];
  if (!bof || bof.type !== 0x0809 || bof.data.length < 2 || new Bytes(bof.data).u16(0) !== 0x0600) throw new Error('xls: not a BIFF8 workbook (Excel 97 to 2003)');
  // shared strings (SST and its CONTINUE records): at a record boundary inside a string's characters a new option byte says their width
  const sst = [];
  const sstRec = recs.find(r => r.type === 0x00fc);
  if (sstRec) {
    const parts = [sstRec.data, ...sstRec.cont]; let p = 0, at = 8;
    const P = () => new Bytes(parts[p]);
    const need = n => { while (at + n > parts[p].length) { if (at < parts[p].length || p + 1 >= parts.length) throw new Error('xls: a shared string runs past its records'); p++; at = 0; } };
    const total = new Bytes(sstRec.data).u32(4);
    for (let i = 0; i < total && p < parts.length; i++) {
      if (at >= parts[p].length) { if (p + 1 >= parts.length) break; p++; at = 0; }
      need(3); const cch = P().u16(at); let flags = P().u8(at + 2); at += 3;
      let runs = 0, ext = 0;
      if (flags & 8) { need(2); runs = P().u16(at); at += 2; }
      if (flags & 4) { need(4); ext = P().u32(at); at += 4; }
      let s = '', left = cch;
      while (left > 0) {
        if (at >= parts[p].length) { if (p + 1 >= parts.length) throw new Error('xls: a shared string runs past its records'); p++; at = 0; flags = (flags & ~1) | (P().u8(0) & 1); at = 1; }
        const wide = flags & 1, room = Math.floor((parts[p].length - at) / (wide ? 2 : 1)), take = Math.min(left, room);
        if (take <= 0) throw new Error('xls: a shared string runs past its records');
        const B2 = P(); for (let k = 0; k < take; k++) s += String.fromCharCode(wide ? B2.u16(at + 2 * k) : B2.u8(at + k));
        at += take * (wide ? 2 : 1); left -= take;
      }
      // formatting runs and the extended block may themselves cross a record boundary
      let skip = runs * 4 + ext;
      while (skip > 0) { if (at >= parts[p].length) { if (p + 1 >= parts.length) break; p++; at = 0; } const t = Math.min(skip, parts[p].length - at); at += t; skip -= t; }
      sst.push(s);
    }
  }
  const xlString = (B2, at, wideLen) => { const cch = wideLen ? B2.u16(at) : B2.u8(at), o = at + (wideLen ? 2 : 1), flags = B2.u8(o); let s = ''; for (let k = 0; k < cch; k++) s += String.fromCharCode(flags & 1 ? B2.u16(o + 1 + 2 * k) : B2.u8(o + 1 + k)); return s; };
  // the sheets: each BOUNDSHEET names a substream by its offset in the workbook stream
  const atIndex = new Map(recs.map((r, i) => [r.at, i]));
  const bounds = recs.filter(r => r.type === 0x0085).slice(0, MAX_SHEETS).map(r => { const B2 = new Bytes(r.data); return { pos: B2.u32(0), kind: B2.u8(5), name: xlString(B2, 6, false) }; });
  const sheets = [], starts = new Set();
  let cells = 0, walked = 0;
  for (const sh of bounds) {
    if (sh.kind !== 0) continue;   // a chart or macro sheet holds no table
    const start = atIndex.get(sh.pos) ?? -1;
    if (start < 0) throw new Error(`xls: sheet ${sh.name} starts at no record`);
    if (starts.has(start)) throw new Error('xls: two sheets name one substream'); starts.add(start);
    const rows = [];
    const put = (r, c, v) => {
      if (c >= 256) throw new Error('xls: a cell past column IV, the last a BIFF8 sheet has');
      while (rows.length <= r) { rows.push([]); if (++cells > MAX_CELLS) throw new Error('xls: more cells than a supplement table holds'); }
      const row = rows[r]; while (row.length < c) { row.push(''); if (++cells > MAX_CELLS) throw new Error('xls: more cells than a supplement table holds'); }
      if (row.length === c) cells++; row[c] = v; if (cells > MAX_CELLS) throw new Error('xls: more cells than a supplement table holds'); };
    let pendingString = null;
    for (let i = start + 1; i < recs.length; i++) {
      if (++walked > MAX_RECORDS) throw new Error('xls: more records walked than the workbook holds');
      const { type, data } = recs[i], B2 = new Bytes(data);
      if (type === 0x000a) break;
      // a chart or other object embedded in the sheet is a substream of its own (BOF … EOF): its cells are not the sheet's
      if (type === 0x0809) { let depth = 1; while (depth > 0 && ++i < recs.length) { if (recs[i].type === 0x0809) depth++; else if (recs[i].type === 0x000a) depth--; } continue; }
      if (type === 0x00fd) put(B2.u16(0), B2.u16(2), sst[B2.u32(6)] ?? '');
      else if (type === 0x0203) put(B2.u16(0), B2.u16(2), num(B2.f64(6)));
      else if (type === 0x027e) put(B2.u16(0), B2.u16(2), num(rk(B2.u32(6))));
      else if (type === 0x00bd) { const r = B2.u16(0), first = B2.u16(2), last = B2.u16(data.length - 2); for (let c = first; c <= last; c++) put(r, c, num(rk(B2.u32(4 + (c - first) * 6 + 2)))); }
      else if (type === 0x0204) put(B2.u16(0), B2.u16(2), xlString(B2, 6, true));
      else if (type === 0x0205) put(B2.u16(0), B2.u16(2), B2.u8(7) ? errText(B2.u8(6)) : (B2.u8(6) ? 'TRUE' : 'FALSE'));
      else if (type === 0x0006) {
        const r = B2.u16(0), c = B2.u16(2);
        if (B2.u16(12) === 0xffff) { const k = B2.u8(6); if (k === 0) pendingString = { r, c }; else if (k === 1) put(r, c, B2.u8(8) ? 'TRUE' : 'FALSE'); else if (k === 2) put(r, c, errText(B2.u8(8))); }
        else put(r, c, num(B2.f64(6)));
      } else if (type === 0x0207 && pendingString) { put(pendingString.r, pendingString.c, xlString(B2, 0, true)); pendingString = null; }
    }
    for (const row of rows) for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = '';
    sheets.push({ name: sh.name, rows });
  }
  return { sheets };
}
