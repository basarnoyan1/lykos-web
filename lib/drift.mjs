// Lykos as the system of record: what a project's own files said when they were
// adopted, and where they say something else now (plan §4.15d).
//
// A project is built from files: an evidence table, a master list of patients,
// a screening workbook, a manuscript. Once adopted, the app holds the values and
// the file stays in the folder, where a person may keep editing it. This module
// records what each file held at adoption and tells the two apart later:
//
//   adoption   `fileEntry`, `evidenceAdoption`, `ipdAdoption`: for one file, its
//              SHA-256, size and time, and for each cell the app took from it the
//              cell's text then (`f`) and the value the app held then (`h`);
//   document   `.lykos/adopted.json`, `{ schema, projectId, files: { [path]: entry } }`
//              (`emptyAdopted`, `openAdopted`, `addAdoption`, `mergeAdopted`);
//   drift      `observe` reduces what is true now (the files as read, the app's
//              values) to a small fact object; `findingsOf` turns that into findings;
//              `compare` is the two in one call;
//   write back `writeBackPlan` lists the cells where the app is ahead of a file
//              that has not moved, for a person to confirm. It writes nothing.
//
// A cell has two sides, and each is compared with its own past, never with the
// other side's format (a follow-up of "90 RF" is read as 90 months, so the two
// can never be equal; only a change in either can be told):
//
//   file changed  app unchanged   D2  the file now says something else (gap)
//   file changed  app changed     D2  both moved and disagree (block); equal now: nothing
//   file same     app changed     D5  the app is ahead of the file (info)
//
// and per file: D1 the bytes differ from what was adopted, D3 the file is gone
// while the app still holds what came from it, D4 imported values cite a file
// that has no adoption record.
//
// Pure: no clock, no disk, no locale. Callers pass `at` and the observations.
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : '';
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export const DRIFT_SCHEMA = 1;

/** Rule ids and the kind each is ranked under (the kinds of lib/figure-needs.mjs: a changed file is stale, a file the app rests on is its source). */
export const DRIFT_RULES = Object.freeze({ D1: 'stale', D2: 'stale', D3: 'source', D4: 'source', D5: 'stale' });
export const DRIFT_NAMES = Object.freeze({
  D1: 'file-changed-since-adoption', D2: 'cell-diverges', D3: 'file-removed', D4: 'value-rests-on-unadopted-file', D5: 'app-newer-than-file',
});
/** The actions a row offers, by id from figure-needs ACTIONS: adopt takes the file's version, mark-current keeps the app's, propose puts a write back up for confirmation. */
export const DRIFT_ACTIONS = Object.freeze({
  D1: ['adopt', 'mark-current', 'open-folder'], D2: ['adopt', 'mark-current'], D3: ['open-folder'], D4: ['adopt'], D5: ['propose', 'mark-current'],
});
/** The view a finding about each kind of file leads to. */
export const VIEW_OF_ROLE = Object.freeze({ evidence: 'extraction', ipd: 'patients', screening: 'screening', manuscript: 'manuscript' });
export const ROLES = Object.freeze(['evidence', 'ipd', 'screening', 'manuscript', 'other']);
/**
 * The one policy: which adopted files a write back may put the app's values into (owner decision, 2026-10-08). The master list and the evidence
 * workbook, cell by cell. The screening workbook and the manuscript are tracked and compared, never written; widening this list is the only
 * change a wider policy needs (writeBackPlan reads it, and so does every screen that offers the action).
 */
export const WRITE_BACK_ROLES = Object.freeze(['evidence', 'ipd']);
export const canWriteBack = role => WRITE_BACK_ROLES.includes(role);
/** Findings about single cells shown per file before the rest are one row. */
export const MAX_CELL_FINDINGS = 20;
const CLIP = 40;

// ---- text and cells ------------------------------------------------------------------
/** A cell or value as it is compared: text, line ends unified, the ends trimmed. */
export const norm = v => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').trim();
const clipText = (s, n = CLIP) => { const t = norm(s).replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const shortName = (p, n = 36) => { const b = baseOf(p); return b.length > n ? `${b.slice(0, n - 1)}…` : b; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const msOf = v => {
  if (v == null || v === '') return null;
  if (Number.isFinite(Number(v)) && typeof v !== 'string') return Math.floor(Number(v));
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
/** The stamp the folder scan gives a file: `size:mtimeMs` (the same text as lib/figure-facts.mjs). */
export const stampOf = (size, mtime) => (Number.isFinite(Number(size)) && size != null && msOf(mtime) != null ? `${Number(size)}:${msOf(mtime)}` : null);

const colLetter = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const posOf = ref => {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/.exec(String(ref));
  if (!m) return null;
  let c = 0; for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]) - 1, col: c - 1 };
};
/** The text of a cell reference ("B7") in a sheet's rows (row 1 is `rows[0]`). */
export function cellAt(rows, ref) {
  const p = posOf(ref);
  return p ? norm(arr(rows)[p.row]?.[p.col]) : '';
}
export const refOf = (row, col) => `${colLetter(col)}${row + 1}`;
const cellKey = (sheet, ref) => `${String(ref).toUpperCase()}@${sheet}`;

// ---- the adoption entries ------------------------------------------------------------------
/**
 * One adopted file. `file` is what is known of the bytes then: `{ hash, size, mtime }` (any may be missing: a file
 * read through a reader that gives no hash is still tracked by its stamp). `cells` are the cells the app took from it.
 */
export function fileEntry({ path, role = 'other', at = '', sheet = '', cells = [], file = {} }) {
  const f = isObj(file) ? file : {};
  return {
    path: String(path), role: ROLES.includes(role) ? role : 'other', at: String(at || ''),
    hash: str(f.hash) || null, size: Number.isFinite(Number(f.size)) && f.size != null ? Number(f.size) : null, mtime: msOf(f.mtime),
    stamp: stampOf(f.size, f.mtime),
    ...(sheet ? { sheet: String(sheet) } : {}),
    cells: arr(cells).filter(c => isObj(c) && c.k && c.c && c.s != null).map(c => ({ k: String(c.k), s: String(c.s), c: String(c.c).toUpperCase(), f: norm(c.f), h: norm(c.h), ...(c.n ? { n: String(c.n) } : {}) })),
  };
}
/** The same entry with what the caller has since learned of the file's bytes (`{ hash, size, mtime }`; a missing part keeps what was known). */
export const withFile = (entry, file) => fileEntry({ ...entry, file: { hash: entry.hash, size: entry.size, mtime: entry.mtime, ...(isObj(file) ? Object.fromEntries(Object.entries(file).filter(([, v]) => v != null)) : {}) } });

/**
 * The cells of an evidence table import: each value whose first evidence is a cell of `path` (a main-table cell; a quote
 * from the with-sources twin is not). `workbook` is the table as read (`{ sheets: [{ name, rows }] }`), `values` the
 * imported values by key, `labelOf(key, value)` a short name for a finding.
 */
export function evidenceAdoption({ path, workbook, values, labelOf = null, file = {}, at = '', role = 'evidence' }) {
  const sheets = arr(workbook?.sheets);
  const cells = [];
  for (const [key, v] of Object.entries(isObj(values) ? values : {})) {
    const ev = arr(v?.evidence)[0];
    if (!ev || ev.kind !== 'file' || ev.path !== path || !ev.locator?.cell) continue;
    const table = sheets.find(s => s.name === ev.locator.sheet) || (!ev.locator.sheet ? sheets[0] : null);
    if (!table) continue;
    const name = labelOf ? labelOf(key, v) : '';
    cells.push({ k: `v:${key}`, s: table.name, c: ev.locator.cell, f: cellAt(table.rows, ev.locator.cell), h: norm(v.reported_value), ...(name ? { n: name } : {}) });
  }
  return fileEntry({ path, role, at, cells, file });
}

/** The patient fields tracked against their cells, and how a finding names them. */
export const IPD_FIELDS = Object.freeze({ case_no: 'Case no.', year: 'Year', eor: 'Extent of resection', adjuvant: 'Adjuvant treatment', time: 'Follow-up', outcome: 'Event status' });
/**
 * The cells of a master list import. `patients` are the plan's patients (each with `raw: { field: { c, t } }`, the cell
 * and its text), `participants` the rows the app made from them, in the same order.
 */
export function ipdAdoption({ path, sheet, patients, participants, file = {}, at = '' }) {
  const cells = [];
  arr(patients).forEach((p, i) => {
    const part = arr(participants)[i];
    if (!part || !isObj(p?.raw)) return;
    for (const [field, raw] of Object.entries(p.raw)) {
      if (!(field in IPD_FIELDS) || !raw?.c) continue;
      cells.push({ k: `p:${part.id}:${field}`, s: sheet, c: raw.c, f: norm(raw.t), h: norm(part[field]), n: `${part.label || 'Patient'} · ${IPD_FIELDS[field]}` });
    }
  });
  return fileEntry({ path, role: 'ipd', at, sheet, cells, file });
}

// ---- the document ----------------------------------------------------------------------------------
export const emptyAdopted = (projectId = '') => ({ schema: DRIFT_SCHEMA, projectId: String(projectId || ''), files: {} });
export const adoptedText = doc => `${JSON.stringify(doc, null, 2)}\n`;

/**
 * A stored document as `{ adopted, readOnly, notice, dropped }`. A newer schema or another project's document opens
 * read-only; an entry that is not an entry is dropped and counted, and never reaches a comparison.
 */
export function openAdopted(raw, { projectId = '' } = {}) {
  if (!isObj(raw)) return { adopted: emptyAdopted(projectId), readOnly: true, notice: 'The adoption record could not be read; it was left as it is', dropped: 0 };
  if (!Number.isFinite(raw.schema) || raw.schema > DRIFT_SCHEMA) return { adopted: emptyAdopted(projectId), readOnly: true, notice: 'The adoption record was written by a newer version of Lykos; it was left as it is', dropped: 0 };
  if (projectId && raw.projectId && raw.projectId !== projectId) return { adopted: emptyAdopted(projectId), readOnly: true, notice: 'The adoption record belongs to another project; it was left as it is', dropped: 0 };
  const files = {};
  let dropped = 0;
  for (const [path, e] of Object.entries(isObj(raw.files) ? raw.files : {})) {
    if (!isObj(e) || !path || e.path !== path) { dropped++; continue; }
    files[path] = fileEntry({ ...e, file: e });
  }
  return { adopted: { schema: DRIFT_SCHEMA, projectId: String(raw.projectId || projectId || ''), files }, readOnly: false, notice: '', dropped };
}

/**
 * The document with `entry` adopted: the file's earlier entry is replaced, and a cell that now comes from this file no
 * longer counts as coming from another (a value rests on one file at a time); an entry left with no cell of a kind
 * that had cells is superseded and removed.
 */
export function addAdoption(doc, entry) {
  const base = isObj(doc) && isObj(doc.files) ? doc : emptyAdopted();
  const files = {};
  const claimed = new Set(entry.cells.map(c => c.k));
  for (const [path, e] of Object.entries(base.files)) {
    if (path === entry.path) continue;
    if (!e.cells.some(c => claimed.has(c.k))) { files[path] = e; continue; }
    const rest = e.cells.filter(c => !claimed.has(c.k));
    if (rest.length) files[path] = { ...e, cells: rest };
  }
  files[entry.path] = entry;
  return { ...base, schema: DRIFT_SCHEMA, files: Object.fromEntries(Object.entries(files).sort((a, b) => byText(a[0], b[0]))) };
}

/** Two windows' documents as one: every file of either, and the later adoption of a file both hold. No conflict is possible; the later adoption is the newer decision. */
export function mergeAdopted(mine, theirs) {
  let out = emptyAdopted(theirs?.projectId || mine?.projectId || '');
  const all = [...Object.values(theirs?.files || {}), ...Object.values(mine?.files || {})];
  const latest = new Map();
  for (const e of all) { const had = latest.get(e.path); if (!had || str(e.at) >= str(had.at)) latest.set(e.path, e); }
  for (const e of [...latest.values()].sort((a, b) => byText(str(a.at), str(b.at)) || byText(a.path, b.path))) out = addAdoption(out, e);
  return { adopted: out, conflicts: [] };
}

// ---- the app's side --------------------------------------------------------------------------------------
/** The value the app holds now for a cell key (`v:<value key>` or `p:<participant id>:<field>`); undefined when it holds none. */
function heldNow(state, k, index) {
  if (k.startsWith('v:')) { const v = state?.values?.[k.slice(2)]; return v == null ? undefined : norm(v.reported_value); }
  if (k.startsWith('p:')) {
    const rest = k.slice(2), at = rest.lastIndexOf(':');
    const p = index.get(rest.slice(0, at));
    return p == null ? undefined : norm(p[rest.slice(at + 1)]);
  }
  return undefined;
}

/**
 * The app side of a comparison: `{ values: { [cell key]: value now }, cited: { [path]: { n, role } } }`. `values` holds
 * the keys the document tracks and the app still holds; `cited` the files imported values or patients name and the
 * document has no entry for.
 */
export function appValues(state, adopted) {
  const s = isObj(state) ? state : {};
  const index = new Map(arr(s.participants).filter(p => p?.id).map(p => [p.id, p]));
  const values = {};
  for (const e of Object.values(adopted?.files || {})) for (const c of e.cells) { const v = heldNow(s, c.k, index); if (v !== undefined) values[c.k] = v; }
  const cited = {};
  const bump = (path, role) => { if (!path || adopted?.files?.[path]) return; const c = (cited[path] ||= { n: 0, role }); c.n++; };
  for (const v of Object.values(isObj(s.values) ? s.values : {})) {
    const ev = arr(v?.evidence)[0];
    if (v?.origin === 'imported' && ev?.kind === 'file' && typeof ev.path === 'string') bump(ev.path, 'evidence');
  }
  for (const p of arr(s.participants)) if (typeof p?.src?.file === 'string') bump(p.src.file, 'ipd');
  return { values, cited };
}

// ---- observations -----------------------------------------------------------------------------------------
/**
 * What the cells a file's entry names say in a workbook as read: `{ cells: { [ref@sheet]: text }, sheets: [names] }`.
 * A sheet the workbook no longer has gives no key for its cells, and is absent from `sheets`.
 */
export function observeWorkbook(workbook, entry) {
  const sheets = arr(workbook?.sheets);
  const cells = {};
  for (const c of arr(entry?.cells)) {
    const table = sheets.find(s => s.name === c.s);
    if (table) cells[cellKey(c.s, c.c)] = cellAt(table.rows, c.c);
  }
  return { cells, sheets: sheets.map(s => s.name) };
}

/**
 * Reduces the adopted files against what is true now to the facts the rules read.
 * `observed[path]` is `{ exists, stamp?, unchanged?, hash?, cells?, sheets?, unread? }`: `unchanged` says the file's stamp is
 * the adopted one (nothing was read), `hash` the SHA-256 when its bytes were read, `cells` as `observeWorkbook` gives them,
 * `unread` when a file that changed could not be read now. `app` is `appValues`. `exists(path)` tells whether a cited,
 * unadopted file is in the folder.
 * Answers `{ files: [{ path, role, at, state, rests, cells, differ }], cells: [...], unadopted: [{ path, n, role, exists }] }`:
 * a cell is listed only where its file or its app value moved.
 */
export function observe(adopted, observed, app, { exists = () => true } = {}) {
  const files = [], cells = [], unadopted = [];
  const seen = isObj(observed) ? observed : {};
  for (const e of Object.values(adopted?.files || {}).sort((a, b) => byText(a.path, b.path))) {
    const o = seen[e.path];
    const held = e.cells.filter(c => app.values[c.k] !== undefined);
    const rests = e.cells.length ? held.length : null;
    const row = { path: e.path, role: e.role, at: e.at, rests, cells: e.cells.length, differ: 0, state: 'same' };
    if (!o) { row.state = 'unknown'; files.push(row); continue; }
    if (o.exists === false) { row.state = 'missing'; files.push(row); continue; }
    if (o.unread) { row.state = 'unread'; files.push(row); continue; }
    let changed;
    if (o.unchanged) changed = false;
    else if (e.hash && o.hash) changed = o.hash !== e.hash;
    else if (e.stamp && o.stamp) changed = o.stamp !== e.stamp;
    else changed = null;
    row.state = changed === null ? 'unknown' : changed ? 'changed' : (o.stamp && e.stamp && o.stamp !== e.stamp ? 'touched' : 'same');
    // A file whose stamp moved but whose bytes did not is "touched": nothing differs. A changed file whose cells could not be
    // read says nothing about any cell, either way (the row says so), and a file of unknown state says nothing at all.
    const readCells = row.state === 'changed' && isObj(o.cells);
    if (row.state === 'unknown' || (row.state === 'changed' && !readCells && held.length)) { if (row.state === 'changed') row.cellsUnread = true; files.push(row); continue; }
    for (const c of held) {
      const a1 = app.values[c.k];
      const appChanged = a1 !== c.h;
      let f1 = null, fileChanged = false, sheetGone = false;
      if (readCells) {
        sheetGone = !arr(o.sheets).includes(c.s);
        f1 = sheetGone ? null : norm(o.cells[cellKey(c.s, c.c)]);
        fileChanged = sheetGone || f1 !== c.f;
      }
      if (!fileChanged && !appChanged) continue;
      if (fileChanged && appChanged && f1 === a1) continue;
      if (fileChanged) row.differ++;
      cells.push({ file: e.path, role: e.role, k: c.k, s: c.s, c: c.c, n: c.n || '', f0: clipText(c.f), h0: clipText(c.h), f1: f1 == null ? null : clipText(f1), a1: clipText(a1), fileChanged, appChanged, sheetGone, verbatim: c.f === c.h });
    }
    files.push(row);
  }
  for (const [path, c] of Object.entries(app.cited || {}).sort((a, b) => byText(a[0], b[0]))) unadopted.push({ path, n: c.n, role: c.role, exists: !!exists(path) });
  return { files, cells, unadopted };
}

// ---- findings -------------------------------------------------------------------------------------------------
const cellUnit = role => (role === 'ipd' ? ['patient cell', 'patient cells'] : ['value', 'values']);
const itemUnit = role => (role === 'ipd' ? ['patient', 'patients'] : ['value', 'values']);
const cellName = c => c.n || `${c.s} ${c.c}`;
const quoted = s => `"${s}"`;
const TEXT_MAX = 80;
/** A finding's text: one line, sentence case, at most TEXT_MAX characters (figure-needs applies the same limit). */
const fit = t => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length > TEXT_MAX ? `${x.slice(0, TEXT_MAX - 1)}…` : x; };
const q18 = s => quoted(clipText(s, 18));

/**
 * The findings of a `observe` result: `{ key, rule, kind, severity, subject, text, evidence, action, view, members? }`,
 * ranked later by lib/figure-needs.mjs. `successor(path)` names a newer version of a missing file, when one is present.
 */
export function findingsOf(facts, { successor = () => null } = {}) {
  const out = [];
  const add = f => out.push({ key: `${f.rule}:${f.subject}`, kind: DRIFT_RULES[f.rule], generatable: 'no', ...f, text: fit(f.text) });
  const cells = arr(facts?.cells);
  // a file that is as adopted has no row of its own, but the app may be ahead of it in some cells
  const listed = new Set(arr(facts?.files).map(f => f.path));
  const files = [...arr(facts?.files), ...[...new Map(cells.filter(c => !listed.has(c.file)).map(c => [c.file, { path: c.file, role: c.role, at: '', state: 'same', rests: null, cells: 0, differ: 0 }])).values()]];
  const viewOf = role => VIEW_OF_ROLE[role] || 'outputs';
  for (const f of files) {
    const here = cells.filter(c => c.file === f.path);
    const [one, many] = cellUnit(f.role);
    const sub = slug(f.path);
    const adopted = f.at ? `adopted ${str(f.at).slice(0, 10)}` : 'adopted earlier';
    if (f.state === 'missing') {
      if (f.rests === 0) continue;                                  // nothing of the app still comes from it: it was superseded
      const succ = successor(f.path);
      add({ rule: 'D3', subject: sub, severity: 'gap', view: viewOf(f.role),
        text: `${shortName(f.path)} is gone${f.rests ? `; ${plural(f.rests, one, many)} rest on it` : '; the app holds what it took from it'}${succ ? `; ${shortName(succ)} is present` : ''}`,
        evidence: [{ kind: 'file', path: f.path, quote: `${adopted}; no longer in the folder` }, ...(succ ? [{ kind: 'version', path: succ, quote: `${baseOf(succ)} is present` }] : [])],
        members: succ ? [succ] : undefined, action: succ ? ['adopt', 'open-folder'] : DRIFT_ACTIONS.D3 });
      continue;
    }
    if (f.state === 'changed') {
      const n = f.differ;
      const withCells = f.cells > 0;
      add({ rule: 'D1', subject: sub, severity: !withCells || n || f.cellsUnread ? 'gap' : 'info', view: viewOf(f.role),
        text: `${shortName(f.path)} changed after it was adopted${f.cellsUnread ? '; its cells could not be read' : withCells ? (n ? `; ${plural(n, 'cell')} differ` : '; no adopted cell differs') : ''}`,
        evidence: [{ kind: 'file', path: f.path, quote: `${adopted}; its content is not the adopted content` }], action: DRIFT_ACTIONS.D1 });
    }
    // single cells, the first MAX_CELL_FINDINGS of each kind, then one row for the rest
    for (const rule of ['D2', 'D5']) {
      const list = here.filter(c => (rule === 'D2' ? c.fileChanged : !c.fileChanged && c.appChanged));
      list.slice(0, MAX_CELL_FINDINGS).forEach(c => {
        const subject = `${sub}.${slug(c.s)}.${c.c.toLowerCase()}`;
        if (rule === 'D2') {
          const gone = c.sheetGone ? `sheet ${c.s} is gone` : `file now ${q18(c.f1 || 'empty')}`;
          add({ rule, subject, severity: c.appChanged ? 'block' : 'gap', view: viewOf(c.role),
            text: `${cellName(c)}: ${gone}, app ${q18(c.a1 || 'empty')}${c.appChanged ? ' (both changed)' : ''}`,
            evidence: [{ kind: 'file', path: c.file, quote: `${c.s} ${c.c}: ${c.sheetGone ? 'sheet gone' : quoted(c.f1 || 'empty')}; adopted ${quoted(c.f0)}` }, { kind: 'state', quote: `app holds ${quoted(c.a1)}; adopted ${quoted(c.h0)}` }],
            action: DRIFT_ACTIONS.D2 });
        } else {
          add({ rule, subject, severity: 'info', view: viewOf(c.role),
            text: `${cellName(c)}: ${c.verbatim ? 'write back available' : 'app edited'}; file still ${q18(c.f0)}`,
            evidence: [{ kind: 'state', quote: `app holds ${quoted(c.a1)}; adopted ${quoted(c.h0)}` }, { kind: 'file', path: c.file, quote: `${c.s} ${c.c}: ${quoted(c.f0)}` }],
            action: c.verbatim ? DRIFT_ACTIONS.D5 : ['mark-current'] });
        }
      });
      const rest = list.length - MAX_CELL_FINDINGS;
      if (rest > 0) add({ rule, subject: `${sub}.more`, severity: rule === 'D2' ? (list.some(c => c.appChanged) ? 'block' : 'gap') : 'info', view: viewOf(f.role),
        text: `${plural(rest, 'more cell')} ${rule === 'D2' ? `differ from ${shortName(f.path)}` : `edited in the app; ${shortName(f.path)} not updated`}`,
        evidence: [{ kind: 'file', path: f.path, quote: `${plural(list.length, 'cell')} in all` }], action: rule === 'D2' ? DRIFT_ACTIONS.D2 : ['mark-current'] });
    }
  }
  for (const u of arr(facts?.unadopted)) {
    const [one, many] = itemUnit(u.role);
    add({ rule: 'D4', subject: slug(u.path), severity: u.exists ? 'info' : 'gap', view: viewOf(u.role),
      text: u.exists ? `${plural(u.n, one, many)} came from ${shortName(u.path)}, which has no adoption record` : `${plural(u.n, one, many)} came from ${shortName(u.path)}, which is not in the folder`,
      evidence: [{ kind: 'import', path: u.path, quote: u.exists ? 'imported, never recorded as adopted' : 'imported; the file is not in the folder' }],
      action: u.exists ? DRIFT_ACTIONS.D4 : ['open-folder'] });
  }
  return out;
}

/**
 * The findings for a project in one call: `adopted` the document, `observed` the files as they are now (see `observe`),
 * `state` the project. `opts.exists(path)` and `opts.successor(path)` as above.
 */
export function compare(adopted, observed, state, opts = {}) {
  const app = appValues(state, adopted);
  return findingsOf(observe(adopted, observed, app, opts), opts);
}

// ---- write back ------------------------------------------------------------------------------------------------
/**
 * The cells where the app is ahead of a file that has not moved, as the edits a write back would make:
 * `{ files: [{ path, expectHash, changes: [{ k, sheet, cell, from, to, name }] }], changes, skipped: [{ k, reason }] }`.
 * A cell is offered only when the app changed it and the file's cell is what was adopted, and when the app's value was
 * a verbatim copy of the cell then (a follow-up read from "90 RF" is never written back as "90"). A file that changed in
 * that cell, a file that cannot be read now and a file that is gone are listed in `skipped` with the reason, never
 * written. `keys` limits the plan to those cell keys. Nothing here writes: the caller shows the plan and a person
 * confirms it (lib/adopt.mjs `applyWriteBack`).
 */
export function writeBackPlan(adopted, observed, state, { keys = null } = {}) {
  const app = appValues(state, adopted);
  const want = keys ? new Set(keys) : null;
  const files = [], skipped = [];
  for (const e of Object.values(adopted?.files || {}).sort((a, b) => byText(a.path, b.path))) {
    const o = isObj(observed) ? observed[e.path] : null;
    const changes = [];
    for (const c of e.cells) {
      const a1 = app.values[c.k];
      if (a1 === undefined || a1 === c.h) continue;                 // not held, or not edited
      if (want && !want.has(c.k)) continue;
      const skip = reason => skipped.push({ k: c.k, path: e.path, sheet: c.s, cell: c.c, reason });
      if (!canWriteBack(e.role)) { skip('Only the master list and the evidence table are written back'); continue; }
      if (!/\.xlsx$/i.test(e.path)) { skip('Only .xlsx workbooks are written back'); continue; }
      if (!o || o.exists === false) { skip('The file is not in the folder'); continue; }
      if (o.unread) { skip('The file could not be read'); continue; }
      if (c.f !== c.h) { skip('The app\'s value was not a copy of the cell, so it is not written back'); continue; }
      const moved = !o.unchanged && !(e.hash && o.hash && e.hash === o.hash);
      let now = c.f;
      if (moved) {
        if (!isObj(o.cells) || !arr(o.sheets).includes(c.s)) { skip('The cell could not be read in the file as it is now'); continue; }
        now = norm(o.cells[cellKey(c.s, c.c)]);
        if (now !== c.f) { skip(`The file changed this cell too (now ${quoted(clipText(now))})`); continue; }
      }
      changes.push({ k: c.k, sheet: c.s, cell: c.c, from: now, to: a1, name: c.n || `${c.s} ${c.c}` });
    }
    if (changes.length) files.push({ path: e.path, moved: !o.unchanged && !(e.hash && o.hash && e.hash === o.hash), expectHash: o.hash || (o.unchanged ? e.hash : null) || null, expectStamp: o.stamp || e.stamp || null, changes });
  }
  return { files, changes: files.flatMap(f => f.changes.map(c => ({ path: f.path, ...c }))), skipped };
}

/**
 * The document after a write back: the cells written now read as the file and the app agreeing. `done` is the plan's
 * `changes` as written. When the file had not moved otherwise (`refresh`), its new `{ hash, size, mtime }` become the
 * adopted ones; when it had, they stay what was adopted, so the changes made elsewhere in it still show.
 */
export function afterWriteBack(adopted, path, done, { file = null, refresh = false } = {}) {
  const e = adopted?.files?.[path];
  if (!e) return adopted;
  const by = new Map(arr(done).map(d => [d.k, d]));
  const cells = e.cells.map(c => { const d = by.get(c.k); return d ? { ...c, f: norm(d.to), h: norm(d.to) } : c; });
  return addAdoption(adopted, fileEntry({ ...e, cells, file: refresh && isObj(file) ? { ...e, ...file } : e }));
}
