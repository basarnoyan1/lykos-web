// The project keeps up with its folder by itself: when the folder changes (lib/vcs-watch.mjs looks every few seconds), detectors ask whether the
// project is behind what the folder holds, and what is safe to bring in is brought in, with a snapshot so it can be undone; what is not safe waits
// as a need with its reason. No model: each detector is a rule over the files and the state, and names no project, file or study.
//
//   evidence   a later version of a table's source workbook (v19 beside the v12 the project holds): lib/evidence-update.mjs; safe when every study
//              of the table matches an included record
//   gone       values a table's files gave studies its current source workbook has no row for (a project updated before an update removed them):
//              safe when every row of the workbook matches an included record; never for a table that was not read from a workbook
//   appraisal  a risk-of-bias workbook (lib/rob-import.mjs) that is new or changed since it was last read; safe when every study matches
//
// What was done is kept in `s.autoSync` ({ done: { key: stamp }, log: [{ id, at, key, title, detail }], needs: [{ key, title, detail }], off }) and
// each change's snapshot (the parts of the state it replaced) in `.lykos/auto/<id>.json`, which Undo puts back.
import { readXlsx } from './xlsx-read.mjs';
import { projectFiles } from './folder-results.mjs';
import { newerVersion, twinOf, evidenceUpdate, applyEvidenceUpdate, goneStudies, rowStudies, dropGoneStudies } from './evidence-update.mjs';
import { readRobWorkbook, applyRob } from './rob-import.mjs';
import { plural } from './dates.mjs';

export const SNAP_DIR = '.lykos/auto';
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const stampOf = f => `${f.path}|${f.size}|${f.mtime}`;
const LOOKS_LIKE_ROB = /bias|\brob\b|rob[ _-]?2|robins|apprais|quality|jbi/i;
const dec = new TextDecoder();
const ROB_PARTS = ['assessments', 'robReview', 'appraisalByStudy', 'customInstruments', 'notes'];
// what a part holds, without when or by whom it was written: a workbook saved again with the same judgements changes nothing
const plain = v => JSON.stringify(v ?? null, (k, x) => (['at', 'by', 'updatedAt', 'importedAt', 'source', 'via'].includes(k) ? undefined : x));
/** A content's fingerprint (FNV-1a over the bytes): two copies of one workbook are one workbook. */
const fingerprint = bytes => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return `${bytes.length}:${h.toString(36)}`; };

/** The detectors: each answers the folder's changes the project lacks, as `{ key, stamp, title, detail, safe, why, apply(st) }`. */
export const DETECTORS = [
  {
    id: 'evidence',
    async find(s, files, folder) {
      const out = [], paths = files.map(f => f.path);
      for (const t of s.templates || []) {
        const next = newerVersion(t, paths);
        if (!next) continue;
        const file = files.find(f => f.path === next.path), key = `evidence:${t.id}`, stamp = stampOf(file);
        if (s.autoSync?.done?.[key] === stamp) continue;
        const groupsFile = files.filter(f => /(^|\/)table[ _-]?groups\.json$/i.test(f.path)).sort((a, b) => b.mtime - a.mtime)[0];
        const book = await readXlsx(await folder.read(next.path)), sources = next.sources ? await readXlsx(await folder.read(next.sources)) : null;
        const groups = groupsFile ? JSON.parse(dec.decode(await folder.read(groupsFile.path))) : null;
        const upd = evidenceUpdate(s, { path: next.path, workbook: book, sources, sourcesPath: next.sources, groups, groupsPath: groupsFile?.path || '', file });
        const n = [...upd.matched.values()].filter(Boolean).length, missing = upd.report.unmatched;
        const gone = goneStudies(s.values, [t.id, upd.template.id], rowStudies(upd)).papers.size;
        out.push({ key, stamp, path: next.path, adoption: upd.adoption,
          title: `${t.name} → v${next.version}`, detail: `${baseOf(next.path)}: ${plural(n, 'study', 'studies')}, ${plural(Object.keys(upd.values).length, 'value')}${upd.collections.length ? `; ${upd.collections.map(c => c.name).join(', ')} rebuilt` : ''}${gone ? `; values of ${plural(gone, 'study', 'studies')} no longer in it removed` : ''}`,
          safe: !missing.length, why: missing.length ? `${plural(missing.length, 'row')} of ${baseOf(next.path)} ${missing.length === 1 ? 'matches' : 'match'} no included study (${missing.slice(0, 5).join(', ')})` : '',
          parts: ['templates', 'values', 'collections'], apply: st => applyEvidenceUpdate(st, upd, { replaces: t.id }) });
      }
      return out;
    },
  },
  {
    id: 'gone',
    async find(s, files, folder) {
      const out = [], paths = files.map(f => f.path);
      for (const t of s.templates || []) {
        const src = t.source?.file, file = src && files.find(f => f.path === src);
        if (!file || newerVersion(t, paths)) continue;   // no workbook, or a newer one the evidence detector brings in (and removes these with it)
        const key = `gone:${t.id}`, stamp = stampOf(file);
        if (s.autoSync?.done?.[key] === stamp) continue;
        if (!goneStudies(s.values, [t.id], new Set()).keys.length) continue;   // no value a file gave, so nothing to read the workbook for
        const sourcesPath = twinOf(src, paths);
        const book = await readXlsx(await folder.read(src)), sources = sourcesPath ? await readXlsx(await folder.read(sourcesPath)) : null;
        const upd = evidenceUpdate(s, { path: src, workbook: book, sources, sourcesPath });
        const missing = upd.report.unmatched, rows = rowStudies(upd) || new Set([...upd.matched.values()].filter(Boolean));
        const gone = goneStudies(s.values, [t.id], rows);
        if (!gone.keys.length) continue;
        const n = plural(gone.papers.size, 'study', 'studies');
        out.push({ key, stamp, path: src,
          title: missing.length ? `Values of ${n} not in ${t.name}` : `Values of ${n} no longer in ${t.name} removed`,
          detail: `${plural(gone.keys.length, 'value')} removed; ${baseOf(src)} has no row for these studies`,
          safe: !missing.length, why: missing.length ? `${plural(missing.length, 'row')} of ${baseOf(src)} ${missing.length === 1 ? 'matches' : 'match'} no included study (${missing.slice(0, 5).join(', ')}), so which studies it no longer has is not known` : '',
          parts: ['values', 'templates'], apply: st => dropGoneStudies(st, t.id, rows) });
      }
      return out;
    },
  },
  {
    id: 'appraisal',
    async find(s, files, folder) {
      const out = [], seen = new Set();
      // newest first, so of two copies of one workbook the one last saved is the one read
      for (const f of files.filter(x => /\.xlsx$/i.test(x.path) && LOOKS_LIKE_ROB.test(baseOf(x.path))).sort((a, b) => b.mtime - a.mtime)) {
        const key = `appraisal:${f.path}`, stamp = stampOf(f);
        let read, bytes;
        try { bytes = await folder.read(f.path); } catch { continue; }
        const same = fingerprint(bytes);
        if (seen.has(same)) continue;   // a copy of a workbook already considered (a quick-access copy in another folder)
        seen.add(same);
        if (s.autoSync?.done?.[key] === stamp || Object.values(s.autoSync?.done || {}).includes(`content:${same}`)) continue;
        try { read = readRobWorkbook(await readXlsx(bytes), s); } catch { continue; }
        if (!read.studies.length) continue;
        const copy = structuredClone(s), trial = applyRob(copy, read);
        // nothing would change (the same judgements saved again, or a copy of a workbook already read): noted, not brought in
        if (!trial.unmatched.length && ROB_PARTS.every(p => plain(copy[p]) === plain(s[p]))) { out.push({ key, stamp, quiet: true, also: { [`content:${key}`]: `content:${same}` } }); continue; }
        out.push({ key, stamp, path: f.path, also: { [`content:${key}`]: `content:${same}` },
          title: `Risk of bias from ${baseOf(f.path)}`, detail: `${plural(trial.written.length, 'study', 'studies')}, ${plural(trial.written.reduce((n, w) => n + w.notes, 0), 'new quotation')}`,
          safe: !trial.unmatched.length && trial.written.length > 0, why: trial.unmatched.length ? `${plural(trial.unmatched.length, 'study', 'studies')} ${trial.unmatched.length === 1 ? 'matches' : 'match'} no included record (${trial.unmatched.slice(0, 4).join(', ')})` : '',
          parts: ['assessments', 'robReview', 'appraisalByStudy', 'customInstruments', 'notes'], apply: st => applyRob(st, read, { by: baseOf(f.path) }) });
      }
      return out;
    },
  },
];

/** What the detectors find for a folder now (nothing is written): `[found]`. */
export async function detect(s, folder) {
  const files = await projectFiles(folder), out = [];
  for (const d of DETECTORS) { try { out.push(...await d.find(s, files, folder)); } catch { /* one detector's failure does not stop the next */ } }
  return out;
}

/**
 * One pass: what is safe is applied (a snapshot of the parts it replaces written first), what is not is kept as a need. `update(fn)` writes the
 * state (store.mjs), `get()` reads it. Answers `{ applied: [entry], needs: [need] }`.
 */
export async function syncFolder(folder, { get, update, adopt = null, now = () => new Date().toISOString() }) {
  const s = get();
  if (s.autoSync?.off) return { applied: [], needs: [] };
  const found = await detect(s, folder), applied = [], needs = [];
  for (const f of found) {
    if (f.quiet) { update(st => { st.autoSync = { ...(st.autoSync || {}), done: { ...(st.autoSync?.done || {}), [f.key]: f.stamp, ...(f.also || {}) } }; return st; }); continue; }
    if (!f.safe) { needs.push({ key: f.key, title: f.title, detail: f.why }); continue; }
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, cur = get();
    await writeSnapshot(folder, id, Object.fromEntries(f.parts.map(p => [p, cur[p] ?? null])));
    const entry = { id, at: now(), key: f.key, path: f.path || '', title: f.title, detail: f.detail };
    update(st => { f.apply(st); st.autoSync = { ...(st.autoSync || {}), done: { ...(st.autoSync?.done || {}), [f.key]: f.stamp, ...(f.also || {}) }, log: [entry, ...(st.autoSync?.log || [])].slice(0, 50) }; return st; });
    if (f.adoption && adopt) await adopt(folder, [f.adoption]).catch(() => null);
    applied.push(entry);
  }
  update(st => { st.autoSync = { ...(st.autoSync || {}), needs }; return st; });
  return { applied, needs };
}

async function writeSnapshot(folder, id, parts) {
  for (const d of ['.lykos', SNAP_DIR]) if (!(await folder.stat(d).catch(() => ({ exists: false }))).exists) await folder.mkdir(d);
  await folder.writeText(`${SNAP_DIR}/${id}.json`, JSON.stringify(parts));
}

/** Puts back what an automatic change replaced; the change leaves the log, and its file is read again only when it changes once more. */
export async function undoChange(folder, id, { update }) {
  const parts = JSON.parse(dec.decode(await folder.read(`${SNAP_DIR}/${id}.json`)));
  update(st => {
    for (const [k, v] of Object.entries(parts)) { if (v == null) delete st[k]; else st[k] = v; }
    st.autoSync = { ...(st.autoSync || {}), log: (st.autoSync?.log || []).filter(e => e.id !== id) };
    return st;
  });
  return parts;
}
