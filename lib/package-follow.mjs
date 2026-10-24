// An imported item follows the document it was read from (plan §2, 2026-10-24). A table or figure read from a Word document
// (lib/package-import.mjs) keeps its caption, legend, notes and a held copy of its cells; when the document changes (its hash, not its time),
// each item is read again from it and set against what it holds:
//
//   the file says what the item says              nothing to do
//   the item still says what the file said        the item takes the file's text (it was never edited here)
//   the item says something else                  edited here: the owner chooses, "Use the file's" or "Keep mine"
//   the file's table holds other cells            the held copy is replaced, so the table, its counts and the Screen view follow the file
//
// "What the file said" is the item's `imported` record ({ from, sha, text: a signature per text }) written at import and after each follow.
// An item imported before the record existed has none: its earlier texts are read from the project's history (lib/vcs.mjs) of that file,
// when the history holds them; with no history an item that differs from its file counts as edited, so nothing is overwritten unasked.
//
// The document of an item is its record's file, else its held table's file, else its part's file. A file the app built (its hash is a
// build's) is not a source; a recorded file that is gone is followed to the newest later version of its name in its folder (v19 → v20).
// An item is matched to the file's caption of its kind with the closest words (a held table's cells settle it). Pure apart from the folder.
import { parseDocx } from './docx.mjs';
import { readDocxPart, hex, linker, holdTable, importedRecord, textSig, normText, TEXT_FIELDS } from './package-import.mjs';
import { parseVersionFull } from './folder-map.mjs';
import { plainText } from './package.mjs';
import { labels } from './package-state.mjs';

const enc = new TextEncoder();
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const WORD = { title: 'title', legend: 'legend', notes: 'notes' };
const MAX_HISTORY = 12;   // earlier versions of one file read for an item with no record

// ---- reading a document --------------------------------------------------------------------------------------------------------------------
const reads = new Map();   // sha -> its captions (a document is parsed once per content)
async function entriesOf(bytes, sha, path) {
  if (reads.has(sha)) return reads.get(sha);
  const read = readDocxPart(await parseDocx(bytes), { path });
  const out = await Promise.all(read.items.map(async it => ({ kind: it.kind, title: it.title, legend: it.legend, notes: it.notes, grid: it.kind === 'table' ? it.grid || null : null,
    gridName: it.kind === 'table' ? `tables/${await hex(enc.encode(JSON.stringify(it.grid || {})))}.json` : '' })));
  if (reads.size > 24) reads.delete(reads.keys().next().value);
  reads.set(sha, out);
  return out;
}

/** The hashes of every file the app built, by path: such a file is the app's own output, not a source. */
const builtHashes = pkg => new Set(Object.values(pkg.builds || {}).flat().flatMap(b => (b?.files || []).map(f => f.hash)).filter(Boolean));

/** The file to read for a recorded path: the path itself, else the newest version of its name in its folder no older than it. */
const stamps = new Map();   // path -> { stamp, sha }: a file whose size and time are unchanged is not read again to learn its hash
async function resolve(folder, path, built) {
  const take = async (p, st) => {
    const stamp = st?.mtime ? `${st.size}:${st.mtime}` : '', known = stamp && stamps.get(p)?.stamp === stamp ? stamps.get(p).sha : '';
    let bytes = null;
    const sha = known || await hex(bytes = await folder.read(p));
    if (stamp) stamps.set(p, { stamp, sha });
    return built.has(sha) ? null : { path: p, sha, bytes: async () => bytes || (bytes = await folder.read(p)) };
  };
  try { const st = await folder.stat(path); if (st.exists) return await take(path, st); } catch { /* unreadable: try its versions */ }
  const want = parseVersionFull(baseOf(path)), dir = dirOf(path);
  let rows = [];
  try { rows = await folder.list(dir); } catch { return null; }
  const later = rows.filter(e => !e.dir && /\.docx$/i.test(e.name) && !/^~\$/.test(e.name)).map(e => ({ rel: e.rel || (dir ? `${dir}/${e.name}` : e.name), v: parseVersionFull(e.name) }))
    .filter(e => e.v.stem.toLowerCase() === want.stem.toLowerCase() && e.v.version >= want.version).sort((a, b) => b.v.version - a.v.version);
  for (const e of later) { const got = await take(e.rel, rows.find(r => (r.rel || (dir ? `${dir}/${r.name}` : r.name)) === e.rel)).catch(() => null); if (got) return got; }
  return null;
}

// ---- matching an item to a caption ---------------------------------------------------------------------------------------------------------
const words = s => new Set(normText(String(s || '').replace(/\{\{[^}]*\}\}/g, ' ')).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
function dice(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return (2 * n) / (x.size + y.size);
}
/** Pairs of package item and caption, best first; a pair under 0.6 is no pair. */
export function matchItems(items, entries) {
  const pairs = [];
  items.forEach((it, i) => entries.forEach((e, j) => {
    if (e.kind !== it.kind) return;
    const s = it.source?.held && it.source.held === e.gridName ? 1 : Math.max(dice(it.title, e.title), e.legend && it.legend ? 0.95 * dice(it.legend, e.legend) : 0);
    if (s >= 0.6) pairs.push({ i, j, s, d: Math.abs(i / Math.max(1, items.length) - j / Math.max(1, entries.length)) });
  }));
  pairs.sort((a, b) => b.s - a.s || a.d - b.d);
  const usedI = new Set(), usedJ = new Set(), out = new Map();
  for (const p of pairs) if (!usedI.has(p.i) && !usedJ.has(p.j)) { usedI.add(p.i); usedJ.add(p.j); out.set(items[p.i].id, entries[p.j]); }
  return out;
}

// ---- what changed --------------------------------------------------------------------------------------------------------------------------
/** What a text says now that it did not, in a few words: "now says 28 included studies"; "no longer says …" for a cut. Words are set
 * against each other by their longest common run (case aside), and the first run the file added is shown with two words after it. */
export function changeWords(mine, now) {
  const a = normText(mine).split(' ').filter(Boolean).slice(0, 400), b = normText(now).split(' ').filter(Boolean).slice(0, 400);
  const k = w => w.toLowerCase().replace(/[.,;:]$/, '');
  // L[i][j]: the longest common run of a[i..] and b[j..]
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = k(a[i]) === k(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const inB = new Array(b.length).fill(false), inA = new Array(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (k(a[i]) === k(b[j])) { inA[i] = inB[j] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const run = (xs, kept) => { const s0 = kept.indexOf(false); if (s0 < 0) return null; let e = s0; while (e < xs.length && !kept[e]) e++; return [s0, e]; };
  const clip = (xs, from, to) => { const shown = xs.slice(from, Math.min(to, from + 8)); return `${shown.join(' ').replace(/[.,;:]$/, '')}${to > from + 8 ? '…' : ''}`; };
  const added = run(b, inB);
  if (added) return `now says ${clip(b, added[0], Math.min(b.length, added[1] + 2))}`;
  const cut = run(a, inA);
  if (cut) return `no longer says ${clip(a, cut[0], cut[1])}`;
  return 'changed';
}

/**
 * For every imported item whose document changed: what to take from it. Returns Map(item id -> { path, sha, auto, ask, said, record, grid }):
 * `auto` the texts to take at once (never edited here), `ask` the texts edited here that the file changed, `said` a phrase per asked text,
 * `grid` the held table's new name (its file already written), `record` the item's `imported` record once all of it is settled.
 * `history(path)` gives earlier versions of a file as [Uint8Array] (newest first), for an item with no record; `hash` is injectable for tests.
 */
export async function followFiles(folder, pkg, { history = null } = {}) {
  const out = new Map();
  if (!folder || !pkg?.parts?.length) return out;
  const built = builtHashes(pkg), link = linker(pkg), L = labels(pkg), plain = t => plainText(t, id => L.get(id));
  const asText = v => (Array.isArray(v) ? v.map(plain).join(' ') : plain(v));
  const same = (x, y) => normText(x) === normText(y) || normText(Array.isArray(x) ? x.map(plain) : plain(x)) === normText(Array.isArray(y) ? y.map(plain) : plain(y));
  // the document of each item, in part order
  const byDoc = new Map();
  for (const part of pkg.parts) for (const id of part.items) {
    const it = pkg.items[id];
    if (!it || !['table', 'figure'].includes(it.kind) || it.source?.generated) continue;
    const from = it.imported?.from || it.source?.from || (/\.docx$/i.test(part.file || '') ? part.file : '');
    if (!from || !/\.docx$/i.test(from)) continue;
    if (!byDoc.has(from)) byDoc.set(from, []);
    byDoc.get(from).push(it);
  }
  for (const [from, items] of byDoc) {
    const doc = await resolve(folder, from, built).catch(() => null);
    if (!doc) continue;
    const open = items.filter(it => it.imported?.sha !== doc.sha && it.imported?.kept !== doc.sha);
    if (!open.length) continue;
    let entries;
    try { entries = await entriesOf(await doc.bytes(), doc.sha, doc.path); } catch { continue; }
    const matched = matchItems(open, entries);
    // earlier versions of the file, for an item with no record: read once per document, only when one needs them
    let earlier = null;
    const earlierOf = async it => {
      if (!history) return [];
      if (!earlier) {
        earlier = [];
        const seen = new Set([doc.sha]);
        for (const bytes of (await history(from).catch(() => [])).slice(0, MAX_HISTORY)) {
          const sha = await hex(bytes); if (seen.has(sha)) continue; seen.add(sha);
          try { earlier.push(await entriesOf(bytes, sha, from)); } catch { /* not a readable document */ }
        }
      }
      return earlier.map(es => matchItems([it], es).get(it.id)).filter(Boolean);
    };
    for (const it of open) {
      const e = matched.get(it.id);
      if (!e) continue;
      const now = { title: link(e.title), legend: link(e.legend), notes: (e.notes || []).map(link) };
      const auto = {}, ask = {}, said = {};
      const before = it.imported ? null : await earlierOf(it);
      for (const f of TEXT_FIELDS) {
        const mine = it[f] ?? (f === 'notes' ? [] : '');
        // a table's caption in a document is its title alone: a legend given here has nothing in the file to follow
        if (same(mine, now[f]) || (f === 'legend' && it.kind === 'table')) continue;
        const untouched = it.imported ? it.imported.text?.[f] != null && textSig(mine) === it.imported.text[f]
          : before.some(b => same(mine, f === 'notes' ? (b.notes || []).map(link) : link(b[f])));
        if (untouched) auto[f] = now[f];
        else { ask[f] = now[f]; said[f] = changeWords(asText(mine), asText(e[f])); }
      }
      // the held copy of a table read from a file: the file's cells now (nothing here edits held cells)
      let grid = '';
      if (it.kind === 'table' && it.source?.held && e.grid && e.gridName !== it.source.held) grid = await holdTable(folder, e.grid);
      const record = importedRecord(doc.path, doc.sha, now);
      if (!Object.keys(ask).length) {
        out.set(it.id, { path: doc.path, sha: doc.sha, auto, ask, said, grid, record, quiet: !Object.keys(auto).length && !grid });
      } else {
        // asked texts keep the signature they had (or none), so they stay asked until the owner chooses
        const partial = { from: doc.path, sha: it.imported?.sha || null, text: { ...(it.imported?.text || {}) } };
        for (const f of TEXT_FIELDS) if (!(f in ask)) partial.text[f] = record.text[f]; else if (!it.imported) partial.text[f] = null;
        out.set(it.id, { path: doc.path, sha: doc.sha, auto, ask, said, grid, record, partial });
      }
    }
  }
  return out;
}

/** The patch an item takes for one follow: the file's texts it takes, its held table, its record. `use`: also the asked texts ("Use the file's"). */
export function patchOf(it, ch, { use = false, keep = false } = {}) {
  const patch = { ...ch.auto, ...(use ? ch.ask : {}) };
  if (ch.grid) patch.source = { ...it.source, from: ch.path, held: ch.grid };
  else if (it.source?.from && it.source.from !== ch.path && it.source.held) patch.source = { ...it.source, from: ch.path };
  const settled = use || keep || !Object.keys(ch.ask).length;
  patch.imported = settled ? { ...ch.record, ...(keep ? { kept: ch.sha } : {}) } : ch.partial;
  return patch;
}

/** The notice's sentence for an item edited here whose file changed: "The file changed: title now says 28 included studies". */
export function followText(ch) {
  const fs = Object.keys(ch.ask);
  if (!fs.length) return '';
  const [first, ...rest] = fs;
  return `The file changed: ${WORD[first]} ${ch.said[first]}${rest.length ? `; the ${rest.map(f => WORD[f]).join(' and ')} too` : ''}`;
}

// ---- a printed figure follows its file -------------------------------------------------------------------------------------------------------
// A figure in the folder is drawn on screen from what it prints (lib/printed-data.mjs printedFacts: its panels, its forest, its table). Its
// files' stamps (size and time of the picture and of the SVG or PDF it is read from) say when that reading is stale: a view whose stamps
// changed reads the figure again, so the Screen view follows the file with nothing to set (2026-10-24: "it should always be auto").
const STAMP_MS = 3000;   // the stamps are read again at most this often
let stampMemo = { key: '', at: 0, value: '' };
/** The package's printed figures' stamps as one string ('' without a folder, or where the folder gives no times). */
export async function printedStamps(folder, pkg) {
  if (!folder?.stat || !pkg?.items) return '';
  const { printedPath, printedCandidates } = await import('./printed-data.mjs');
  const files = [...new Set(Object.values(pkg.items).filter(it => it.kind === 'figure').map(it => printedPath(it.source)).filter(Boolean).flatMap(p => [p, ...printedCandidates(p)]))].sort();
  const key = files.join('|');
  if (stampMemo.key === key && Date.now() - stampMemo.at < STAMP_MS) return stampMemo.value;
  const parts = await Promise.all(files.map(async p => { try { const st = await folder.stat(p); return st?.exists === false ? '' : st?.mtime ? `${p}:${st.size}:${st.mtime}` : ''; } catch { return ''; } }));
  stampMemo = { key, at: Date.now(), value: parts.filter(Boolean).join('|') };
  return stampMemo.value;
}

/**
 * The package's printed figures whose panels are the app's results (lib/printed-data.mjs printedMatch), by printed path: Map(path -> match,
 * with `pkg` the item). A file's match is kept by its stamps (the picture's and the SVG or PDF it is read from) and the project's `version`,
 * so Tables and figures reads each print once while neither changes.
 */
const matchMemo = new Map();   // item id -> { key, value }
export async function printedMatches(folder, s, { version = '' } = {}) {
  const out = new Map();
  if (!folder?.stat || !s?.package?.items) return out;
  const pd = await import('./printed-data.mjs');
  for (const it of Object.values(s.package.items)) {
    const path = it?.kind === 'figure' ? pd.printedPath(it.source) : '';
    if (!path || !/\.(png|jpe?g|tiff?|svg|pdf)$/i.test(path)) continue;
    const stats = await Promise.all([path, ...pd.printedCandidates(path)].map(async p => { try { const st = await folder.stat(p); return st?.exists === false ? '' : `${p}:${st?.size}:${st?.mtime}`; } catch { return ''; } }));
    if (!stats[0]) continue;
    const key = `${stats.join('|')}#${version}#${JSON.stringify(it.source)}`;
    let had = matchMemo.get(it.id);
    if (had?.key !== key) { had = { key, value: await pd.printedMatch(s, it, folder).catch(() => null) }; matchMemo.set(it.id, had); }
    if (had.value) out.set(path, { ...had.value, pkg: it.id });
  }
  return out;
}

/** Earlier stored versions of a file from the project's history (lib/vcs.mjs), newest first. */
export async function vcsHistory(folder, path) {
  const { vcs } = await import('./vcs.mjs');
  const v = vcs(folder), out = [];
  for (const c of await v.fileLog(path)) {
    if (c.deleted || out.length >= MAX_HISTORY) continue;
    const bytes = await v.read(c.id, path).catch(() => null);
    if (bytes) out.push(bytes);
  }
  return out;
}
