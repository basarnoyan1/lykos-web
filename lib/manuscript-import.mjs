// A project's manuscript read into the section `manuscriptText` (lib/manuscript-data.mjs), losslessly: the Word files as the reader parses
// them (lib/docx.mjs parseDocx), and each number the structured number check placed in them (lib/number-check.mjs) cut into a run of its own
// and bound to what computed it. The Word files are the build of the project's own scripts (the Sham review's content-main.mjs and
// content-supplement.mjs write them through 06/08-build), so importing the files imports the scripts' text with the numbers they looked up.
//
// A number is bound, in order: to the field of the run output the trace names (lib/number-trace.mjs traceNumber, the Need 4 trace: its
// estimate, interval and the numbers beside it choose the output; the field is the one whose value, written as the text writes numbers,
// is the text); to the cell of the Lykos output a table was made from; to the record values the check names; else it stays typed, with
// the source the build's check named. The report says how many of each, and why the others were not bound. Pure.
import { checkedUnits, counted } from './number-check.mjs';
import { traceNumber } from './number-trace.mjs';
import { numsOf } from './number-check.mjs';
import { numberList, cellNumbers, runSlots, numberFormat, formatNumber, typedNumber, bindingValue, datasetKey } from './manuscript-data.mjs';

// fields of a run output in the order a tie is settled: the estimate and its intervals, then counts, then the rest
const FIELD_ORDER = ['estimate', 'lo', 'hi', 'pi_lo', 'pi_hi', 'trials', 'outcomes', 'participants', 'df', 'p'];
const rank = k => { const i = FIELD_ORDER.indexOf(k); return i < 0 ? FIELD_ORDER.length : i; };
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * The field of run output `o` a typed number reports: `{ field, at?, exact }` or null. Numbers first, then the numbers of its texts. When
 * fields print alike (an estimate equal to its interval's bound), the first not in `used` (`field` or `field@at`, the ones the numbers
 * before it in the block took): "0·34 (0·34 to 0·52)" binds the estimate, then the lower bound.
 */
export function fieldFor(o, typed, before = '', used = new Set()) {
  const fmt = numberFormat(typed, before);
  if (!fmt || !o?.values) return null;
  const entries = Object.entries(o.values).sort((a, b) => rank(a[0]) - rank(b[0]));
  const half = 0.5 * 10 ** -fmt.dp + 1e-9, t = typed.trim(), free = f => !used.has(f.at != null ? `${f.field}@${f.at}` : f.field);
  const exact = [], near = [];
  for (const [k, v] of entries) {
    if (typeof v !== 'number') continue;
    if (formatNumber(v, fmt) === t) exact.push({ field: k, exact: true });
    else if (Math.abs(typedNumber(t) - v) <= half) near.push({ field: k, exact: false });
  }
  const x = String(typedNumber(t)), inText = [];
  for (const [k, v] of entries) {
    if (typeof v !== 'string') continue;
    numberList(v).forEach((y, at) => { if (Number(y) === Number(x)) inText.push({ field: k, at, exact: true }); });
  }
  for (const list of [exact, near, inText]) if (list.length) return list.find(free) || list[0];
  return null;
}

/** Citation runs keep the number Word printed (parseDocx's `shown`, not enumerable there) as a plain property, so a copy keeps it. */
export function plainShown(x) {
  if (!x || typeof x !== 'object' || ArrayBuffer.isView(x)) return x;
  if (Array.isArray(x)) { for (const y of x) plainShown(y); return x; }
  const d = Object.getOwnPropertyDescriptor(x, 'shown');
  if (d && !d.enumerable) Object.defineProperty(x, 'shown', { value: d.value, enumerable: true, writable: true, configurable: true });
  for (const k of Object.keys(x)) plainShown(x[k]);
  return x;
}

/** Where each counted run of block `b` starts in the check's text of it: [{ slot, start, end }] (lib/number-check.mjs checkedUnits). */
export function runStarts(b) {
  const out = [], sep = b.type === 'table' ? 3 : 0;
  let at = 0, first = true;
  for (const slot of runSlots(b)) {
    if (!counted(slot.run)) continue;
    if (!first) at += sep;
    first = false;
    const len = String(slot.run.t ?? '').length;
    out.push({ slot, start: at, end: at + len });
    at += len;
  }
  return out;
}

/** Cut the runs of block `b` so each placed number `{ at, len, n }` is a run of its own carrying `n`. Returns the places that span runs. */
export function cutRuns(b, places) {
  const spans = [], starts = runStarts(b), byList = new Map();
  for (const p of places) {
    const host = starts.find(s => p.at >= s.start && p.at + p.len <= s.end);
    if (!host) { spans.push(p); continue; }
    const key = host.slot.list;
    if (!byList.has(key)) byList.set(key, []);
    byList.get(key).push({ p, host });
  }
  for (const [list, hits] of byList) {
    // from the end of the list, so the indices before stay valid
    hits.sort((a, b) => b.host.slot.k - a.host.slot.k || b.p.at - a.p.at);
    const byRun = new Map();
    for (const h of hits) { if (!byRun.has(h.host.slot.k)) byRun.set(h.host.slot.k, []); byRun.get(h.host.slot.k).push(h); }
    for (const [k, hs] of byRun) {
      const run = list[k], text = String(run.t ?? ''), base = hs[0].host.start, pieces = [];
      let from = 0;
      for (const { p } of hs.sort((a, b) => a.p.at - b.p.at)) {
        const s = p.at - base, e = s + p.len;
        if (s < from) { spans.push(p); continue; }   // overlaps the one before
        if (s > from) pieces.push({ ...run, t: text.slice(from, s) });
        pieces.push({ ...run, t: text.slice(s, e), n: p.n });
        from = e;
      }
      if (from < text.length) pieces.push({ ...run, t: text.slice(from) });
      for (const x of pieces) if (x.n === undefined) delete x.n;
      list.splice(k, 1, ...pieces);
    }
  }
  return spans;
}

/**
 * The section from the parsed files and the check. `docs` [{ id, role, name, path, sha256, parsed }] (parsed: parseDocx's result; its
 * media's bytes are not kept, a figure names its image by hash); `check` the structured number check built on these files; `run` the run
 * the check names, its outputs carrying `values`; `values` the record's values; `cells(output)` a Lykos output's rows of cell texts.
 * `{ docs, report }`, the documents as lib/manuscript-data.mjs readManuscriptText gives them (putManuscriptDocs stores them).
 */
export function importManuscript({ docs, check, run = null, values = {}, cells = () => null, datasets = [], at = new Date().toISOString() }) {
  const report = { at, run: run?.id || '', docs: [] }, out = [];
  const outputs = new Map((run?.outputs || []).map(o => [o.id, o]));
  for (const d of docs) {
    const f = (check?.files || []).findIndex(x => x.name === d.name);
    const fileOk = f >= 0 && (!check.files[f].sha256 || check.files[f].sha256 === d.sha256);
    const { media = [], ...parsed } = d.parsed;
    const doc = { id: d.id, role: d.role, name: d.name, path: d.path, from: { kind: 'docx', sha256: d.sha256, importedAt: at }, ...structuredClone(plainShown(parsed)),
      media: media.map(m => ({ id: m.id, name: m.name, mime: m.mime, ...(m.sha256 ? { sha256: m.sha256 } : {}), size: m.bytes?.length || m.size || 0 })) };
    // every block has an id of its own (parseDocx gives one): the stored section keys blocks by it and the check names them by it
    const ids = new Set();
    doc.blocks.forEach((b, i) => { if (typeof b.id !== 'string' || !/^[\w-]{1,40}$/.test(b.id) || ids.has(b.id)) b.id = `b${i + 1}`; while (ids.has(b.id)) b.id = `${b.id}-${i + 1}`; ids.add(b.id); });
    const r = { id: d.id, name: d.name, numbers: 0, run: 0, output: 0, value: 0, dataset: 0, named: 0, notBound: {}, spans: 0, checkFile: fileOk };
    report.docs.push(r);
    out.push(doc);
    if (!fileOk) continue;
    const units = new Map(checkedUnits(doc.blocks).map(u => [u.i, u]));
    const byBlock = new Map(), used = new Map();
    for (const row of check.rows) {
      if (row.file !== f || !row.place) continue;
      const u = units.get(row.place.block);
      if (!u) continue;
      r.numbers++;
      const typed = u.t.slice(row.place.at, row.place.at + row.place.len), before = u.t.slice(Math.max(0, row.place.at - 3), row.place.at);
      if (!used.has(row.place.block)) used.set(row.place.block, new Map());
      const n = bindingOf(row, typed, before, { check, run, outputs, values, cells, datasets, u, used: used.get(row.place.block) });
      if (n.why) r.notBound[n.why] = (r.notBound[n.why] || 0) + 1;
      r[['run', 'output', 'value', 'dataset'].includes(n.src) ? n.src : 'named']++;
      delete n.why;
      if (!byBlock.has(row.place.block)) byBlock.set(row.place.block, []);
      byBlock.get(row.place.block).push({ at: row.place.at, len: row.place.len, n });
    }
    for (const [i, places] of byBlock) r.spans += cutRuns(doc.blocks[i], places).length;
  }
  return { docs: out, report };
}

function bindingOf(row, typed, before, { check, run, outputs, values, cells, datasets = [], u, used }) {
  const src = row.source || {}, named = why => ({ src: 'named', text: cut(String(src.text || src.kind || ''), 200), why });
  if (!numberFormat(typed, before)) return named('not one number as typed');
  // a run output: the trace's choice, the field that prints it
  if (run && (src.run === run.id || src.kind === 'results')) {
    const tr = traceNumber(row, { check, run });
    const o = tr.output && outputs.get(tr.output.id);
    if (o) {
      const fld = tr.verdict === 'differs' ? fieldFor(o, tr.value, '', used.get(o.id)) : fieldFor(o, typed, before, used.get(o.id));
      if (fld) {
        if (!used.has(o.id)) used.set(o.id, new Set());
        used.get(o.id).add(fld.at != null ? `${fld.field}@${fld.at}` : fld.field);
        return { src: 'run', run: run.id, output: o.id, field: fld.field, ...(fld.at != null ? { at: fld.at } : {}), ...(numberFormat(typed, before).lt ? { lt: true } : {}) };
      }
      return named('the traced output prints no field like it');
    }
  }
  // a table made from a Lykos output (the build's map) or a number the check names an output for
  const oid = src.kind === 'output' ? src.id : row.output?.id;
  if (oid) {
    const rows = cells(oid);
    if (rows?.length) {
      const near = new Set(row.place.cell && u.grid ? numsOf(u.grid[row.place.cell.row].join(' ')) : numsOf(u.t));
      let best = null;
      rows.forEach((cs, ri) => {
        const score = [...numsOf(cs.join(' '))].filter(x => near.has(x)).length;
        cs.forEach((c, ci) => { const at = cellNumbers(c).findIndex(x => Number(x) === typedNumber(typed)); if (at >= 0 && (!best || score > best.score)) best = { row: ri, col: ci, at, score }; });
      });
      // the row by its key (its first cell: the study, the subgroup), so a row added above it leaves the binding as it was
      if (best) { const key = String(rows[best.row][0] ?? ''), nth = rows.slice(0, best.row).filter(r => String(r[0] ?? '') === key).length; return { src: 'output', output: oid, key, ...(nth ? { nth } : {}), col: best.col, at: best.at }; }
      return named('the output does not print it');
    }
    if (src.kind === 'output') return named('the output could not be drawn');
  }
  if (src.kind === 'record' && src.valueIds?.length) {
    const n = { src: 'value', ids: src.valueIds }, v = bindingValue(n, { values });
    if (v.value != null && v.value === typedNumber(typed)) return n;
    return named(v.missing ? 'the record values named disagree' : 'the record value is another number');
  }
  // a project dataset's cell: the row the check read it from (else the row holding most of the numbers beside it), the cell that prints it
  if (src.kind === 'dataset') {
    const d = datasets.find(x => x?.id === src.id), rows = Array.isArray(d?.rows) ? d.rows : [];
    if (!d) return named('the dataset is not in the project');
    const want = typedNumber(typed), near = new Set(row.place.cell && u.grid ? numsOf(u.grid[row.place.cell.row].join(' ')) : numsOf(u.t));
    const cellOf = r => { for (const [col, c] of Object.entries(r || {})) { const at = cellNumbers(String(c ?? '')).findIndex(x => Number(x) === want); if (at >= 0) return { col, at }; } return null; };
    let ri = Number.isInteger(src.row) && cellOf(rows[src.row]) ? src.row : -1;
    if (ri < 0) { let best = -1; rows.forEach((r, i) => { if (!cellOf(r)) return; const k = [...numsOf(Object.values(r).join(' '))].filter(x => near.has(x)).length; if (k > best) { best = k; ri = i; } }); }
    if (ri < 0) return named('the dataset holds it in its note, in no cell');
    const kc = datasetKey(d), key = String(rows[ri]?.[kc] ?? ''), nth = rows.slice(0, ri).filter(r => String(r?.[kc] ?? '') === key).length, { col, at } = cellOf(rows[ri]);
    return { src: 'dataset', dataset: d.id, key, ...(nth ? { nth } : {}), col, at };
  }
  if (src.kind === 'results') return named(src.derived ? 'derived by the build from the results' : 'in the results, printed by no run output');
  if (src.kind === 'record') return named('a count of the record (the build\'s summary)');
  return named(src.kind === 'none' ? 'the build names no source' : src.kind === 'file' ? 'a file of the folder' : src.kind === 'section' ? 'a section of the store' : 'another source (protocol, page, citation, software)');
}
