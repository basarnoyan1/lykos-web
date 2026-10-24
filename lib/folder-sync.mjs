// The project keeps up with its folder by itself: when the folder changes (lib/vcs-watch.mjs looks every few seconds), detectors ask whether the
// project is behind what the folder holds, and what is safe to bring in is brought in, with a snapshot so it can be undone; what is not safe waits
// as a need with its reason. No model: each detector is a rule over the files and the state, and names no project, file or study.
//
//   evidence   a later version of a table's source workbook (v19 beside the v12 the project holds): lib/evidence-update.mjs; safe when every study
//              of the table matches an included record
//   gone       values a table's files gave studies its current source workbook has no row for (a project updated before an update removed them):
//              safe when every row of the workbook matches an included record; never for a table that was not read from a workbook
//   appraisal  a risk-of-bias workbook (lib/rob-import.mjs) that is new or changed since it was last read; safe when every study matches
//   rob-print  a package item drawn from Appraisal's risk-of-bias summary with no studies of its own, whose printed PNG counts fewer studies
//              than the instrument appraised: the outcome whose syntheses' studies give the print's shares becomes the item's scope
//              (lib/rob-print.mjs; Figure S2, 7 of 12 ROBINS-I studies, those of "Any failure"); safe when exactly one set of studies does
//   name       an imported table's name without its file's version ("Evidence table v21" -> "Evidence table"; lib/template-import.mjs
//              plainTableName), once per table: the version is the file's, and the title does not change with each version
//   follow     an adopted file changed in place (an evidence table, a master list): read again, cell by cell against what was adopted
//              (lib/data-follow.mjs): a cell the app never edited takes the file's value, a cell edited here is kept and listed as a conflict
//              ("Use the file's", "Keep mine"); always safe. Files whose size and time are as adopted, or as last looked at, are not read
//   map-print  a package figure whose print is an evidence map, drawn with no options of its own: the options that reproduce the print
//              (merged levels from its column heads, the field its row groups name; lib/map-print.mjs) are found and kept on the item
//   relink     a package figure a script relinked to a new print, its app link kept only as history ({ path, was: { app, … } }): the link is
//              kept when the new print's panels show the result it named (Figures 3 and 4, 2026-10-24); safe whenever they do
//
// What was done is kept in `s.autoSync` ({ done: { key: stamp }, log: [{ id, at, key, title, detail }], needs: [{ key, title, detail }], conflicts:
// [{ key, name, file, mine, … }], off }) and each change's snapshot (the parts of the state it replaced, the conflicts and the adoption entries
// before it) in `.lykos/auto/<id>.json`, which Undo puts back. The evidence detector follows the same cell rules as `follow`: a newer version
// becomes the table's source, its name kept.
import { readXlsx } from './xlsx-read.mjs';
import { projectFiles } from './folder-results.mjs';
import { newerVersion, twinOf, evidenceUpdate, goneStudies, rowStudies, dropGoneStudies } from './evidence-update.mjs';
import { evidencePlan, ipdPlan, applyPlan, followEntry, planText, settle } from './data-follow.mjs';
import { stampOf as sizeTime, withFile, fileEntry } from './drift.mjs';
import { plainTableName } from './template-import.mjs';
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
    id: 'name',
    async find(s) {
      return (s.templates || []).filter(t => t?.source?.file && t.name && plainTableName(t.name) !== t.name && s.autoSync?.done?.[`name:${t.id}`] !== t.name)
        .map(t => ({ key: `name:${t.id}`, stamp: t.name, title: `${t.name} is now ${plainTableName(t.name)}`, safe: true, parts: ['templates'],
          detail: `Its version is its file's, ${baseOf(t.source.file)}`, apply: st => { const x = (st.templates || []).find(y => y.id === t.id); if (x) x.name = plainTableName(x.name); } }));
    },
  },
  {
    id: 'evidence',
    async find(s, files, folder, ctx) {
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
        const adopted = await ctx.adopted(), entry = adopted?.files?.[t.source?.file] || null;
        // the cells follow the newer file as they follow a file changed in place: edited cells are kept as conflicts, never overwritten
        const plan = evidencePlan(s, { tid: t.id, entry, upd, path: next.path });
        const said = planText(plan);
        out.push({ key, stamp, path: next.path, record: { entry: followEntry(upd.adoption, entry, plan), keep: plan.conflicts.length ? entry : null }, plan,
          adopted: [t.source?.file, next.path].filter(Boolean),
          title: `${t.name} follows ${baseOf(next.path)}`, detail: `${baseOf(next.path)}: ${plural(n, 'study', 'studies')}${said ? `; ${said}` : '; no value changed'}${upd.collections.length ? `; ${upd.collections.map(c => c.name).join(', ')} rebuilt` : ''}${gone ? `; values of ${plural(gone, 'study', 'studies')} no longer in it removed` : ''}`,
          safe: !missing.length, why: missing.length ? `${plural(missing.length, 'row')} of ${baseOf(next.path)} ${missing.length === 1 ? 'matches' : 'match'} no included study (${missing.slice(0, 5).join(', ')})` : '',
          parts: ['templates', 'values', 'collections'], apply: (st, at) => {
            applyPlan(st, plan, { at });
            dropGoneStudies(st, t.id, rowStudies(upd));
            sourceFollows(st, t.id, upd);
            // the table groups' collections are the groups file's, as a whole
            if (upd.collections?.length) st.collections = [...(st.collections || []).filter(c => !String(c.id).startsWith('c-table-') && !upd.collections.some(x => x.name === c.name && !c.parent)), ...upd.collections];
          } });
      }
      return out;
    },
  },
  {
    id: 'follow',
    async find(s, files, folder, ctx) {
      const out = [], paths = files.map(f => f.path), done = s.autoSync?.done || {};
      // the record is read only when a file it may track moved since it was last looked at
      const moved = f => f && done[`follow:${f.path}`] !== stampOf(f);
      const lists = listsOf.get(folder), tracked = new Set([...(s.templates || []).map(t => t.source?.file), ...(lists || [])]);
      if (lists && !files.some(f => tracked.has(f.path) && moved(f))) return out;
      const adopted = await ctx.adopted();
      listsOf.set(folder, Object.values(adopted?.files || {}).filter(e => e.role === 'ipd' && e.cells?.length).map(e => e.path));
      const looked = (key, file, entry) => s.autoSync?.done?.[key] === stampOf(file) || (entry?.stamp && entry.stamp === sizeTime(file.size, file.mtime));
      // the evidence tables: each table's own source file, unless a newer version is there (the evidence detector reads that one)
      for (const t of s.templates || []) {
        const src = t.source?.file, file = src && /\.xlsx$/i.test(src) && files.find(f => f.path === src);
        if (!file || newerVersion(t, paths)) continue;
        const entry = adopted?.files?.[src] || null, key = `follow:${src}`, stamp = stampOf(file);
        if (looked(key, file, entry)) { if (done[key] !== stamp) out.push({ key, stamp, quiet: true }); continue; }   // as adopted: noted, not read
        const bytes = await folder.read(src), hash = await sha256(bytes);
        if (entry?.hash && entry.hash === hash) { out.push({ key, stamp, quiet: true, record: { entry: withFile(entry, { size: file.size, mtime: file.mtime }) } }); continue; }
        const sp = twinOf(src, paths), sources = sp ? await readXlsx(await folder.read(sp)).catch(() => null) : null;
        const upd = evidenceUpdate(s, { path: src, workbook: await readXlsx(bytes), sources, sourcesPath: sp, file: { ...file, hash } });
        const plan = evidencePlan(s, { tid: t.id, entry, upd, path: src });
        const record = { entry: followEntry(upd.adoption, entry, plan), keep: plan.conflicts.length ? entry : null };
        if (!plan.take.length && !plan.conflicts.length) { out.push({ key, stamp, quiet: true, record, quietApply: st => { applyPlan(st, plan); } }); continue; }
        out.push({ key, stamp, path: src, record, plan, adopted: [src], safe: true, parts: ['values', 'templates'],
          title: `${t.name} follows ${baseOf(src)}`, detail: planText(plan), apply: (st, at) => { applyPlan(st, plan, { at }); sourceFollows(st, t.id, upd); } });
      }
      // the master lists: each adopted list with patient cells
      for (const entry of Object.values(adopted?.files || {}).filter(e => e.role === 'ipd' && e.cells?.length)) {
        const file = files.find(f => f.path === entry.path), key = `follow:${entry.path}`;
        if (!file) continue;
        if (looked(key, file, entry)) { if (done[key] !== stampOf(file)) out.push({ key, stamp: stampOf(file), quiet: true }); continue; }
        const stamp = stampOf(file), bytes = await folder.read(entry.path), hash = await sha256(bytes);
        if (entry.hash && entry.hash === hash) { out.push({ key, stamp, quiet: true, record: { entry: withFile(entry, { size: file.size, mtime: file.mtime }) } }); continue; }
        const { ipdListFromRows, ipdPatchFromText } = await import('./ipd-import.mjs');
        const book = /\.xlsx$/i.test(entry.path) ? await readXlsx(bytes) : null;
        const sheet = book?.sheets.find(x => x.name === entry.sheet) || book?.sheets[0];
        const list = sheet ? ipdListFromRows(sheet.rows, { file: entry.path, sheet: sheet.name }) : { ok: false };
        if (!list.ok) { out.push({ key, stamp, title: `${baseOf(entry.path)} changed`, safe: false, why: `It could not be read as a master list (${list.reason || 'unknown layout'}), so its patients were not compared` }); continue; }
        const plan = ipdPlan(s, { entry, rows: list.patients, patch: ipdPatchFromText, path: entry.path });
        const cells = entry.cells.map(c => { const t = plan.take.find(x => x.key === c.k); return t ? { ...c, f: t.f, h: t.to } : c; });
        const record = { entry: fileEntry({ ...entry, cells, file: plan.conflicts.length ? entry : { hash, size: file.size, mtime: file.mtime } }) };
        if (!plan.take.length && !plan.conflicts.length) { out.push({ key, stamp, quiet: true, record }); continue; }
        out.push({ key, stamp, path: entry.path, record, plan, adopted: [entry.path], safe: true, parts: ['participants'],
          title: `Patients follow ${baseOf(entry.path)}`, detail: planText(plan), apply: (st, at) => applyPlan(st, plan, { at, patch: ipdPatchFromText }) });
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
        if (!gone.keys.length) { out.push({ key, stamp, quiet: true }); continue; }   // read once for this stamp, not at every look
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
        if (s.autoSync?.done?.[key] === stamp) continue;   // as last looked at: not read again (a look every 30 s stays cheap)
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
        // a judgement edited here since the workbook was last read is kept and listed as a conflict, as a value of a table is (lib/data-follow.mjs)
        const rob = robFollow(s, copy, trial, f.path);
        out.push({ key, stamp, path: f.path, also: { [`content:${key}`]: `content:${same}` },
          title: `Risk of bias from ${baseOf(f.path)}`, detail: `${plural(trial.written.length, 'study', 'studies')}, ${plural(trial.written.reduce((n, w) => n + w.notes, 0), 'new quotation')}${rob.conflicts.length ? `; ${plural(rob.conflicts.length, 'judgement')} edited here kept until you choose` : ''}`,
          safe: !trial.unmatched.length && trial.written.length > 0, why: trial.unmatched.length ? `${plural(trial.unmatched.length, 'study', 'studies')} ${trial.unmatched.length === 1 ? 'matches' : 'match'} no included record (${trial.unmatched.slice(0, 4).join(', ')})` : '',
          parts: ['assessments', 'robReview', 'appraisalByStudy', 'customInstruments', 'notes'], apply: (st, at) => { applyRob(st, read, { by: baseOf(f.path) }); rob.apply(st, at); } });
      }
      return out;
    },
  },
  {
    id: 'rob-print',
    async find(s, files, folder) {
      const out = [], items = Object.values(s.package?.items || {}).filter(it => /^rob-summary:/.test(it.source?.app || '') && !it.robScope);
      if (!items.length) return out;
      const [rp, app, scope, synth, pd, pkg] = await Promise.all([import('./rob-print.mjs'), import('./app-items.mjs'), import('./rob-scope.mjs'),
        import('./synth-project.mjs'), import('./printed-data.mjs'), import('./package-state.mjs')]);
      let outcomes = null;
      const L = pkg.labels(s.package);
      for (const it of items) {
        const path = pd.printedPath(it.source), file = /\.png$/i.test(path) && files.find(f => f.path === path);
        if (!file) continue;
        const key = `rob-print:${it.id}`, stamp = stampOf(file);
        if (s.autoSync?.done?.[key] === stamp) continue;
        const set = app.robSets(s, { all: true }).find(x => x.tool.id === it.source.app.split(':')[1]);
        const img = await rp.decodePng(await folder.read(path));
        if (!img || !set) { out.push({ key, stamp, quiet: true }); continue; }
        if (!outcomes) { const model = synth.synthesisModel(s); outcomes = (s.outcomes || []).filter(o => o?.id && o.name).map(o => ({ id: o.id, name: o.name, studies: scope.outcomeStudies(model, o.id) })); }
        const got = rp.printScope(rp.summaryBars(img), set, outcomes), name = L.get(it.id) || 'A risk-of-bias figure', n = got.printed?.n;
        if (got.status === 'unread' || got.status === 'all') { out.push({ key, stamp, quiet: true }); continue; }
        if (got.status !== 'outcome') {
          out.push({ key, stamp, title: `${name}: which studies its print draws`, safe: false,
            why: got.status === 'many' ? `${baseOf(path)} counts ${n} studies; the studies of ${got.labels.join(', ')} all give its shares` : `${baseOf(path)} counts ${n} studies; no outcome's studies give its shares` });
          continue;
        }
        out.push({ key, stamp, path, title: `${name} draws the studies of its print`, safe: true, parts: ['package'],
          detail: `${plural(n, 'study', 'studies')} contributing to ${got.label}, found from the shares in ${baseOf(path)}`,
          apply: st => { const x = st.package?.items?.[it.id]; if (x) x.robScope = got.scope; } });
      }
      return out;
    },
  },
  {
    id: 'map-print',
    // a figure whose print is an evidence map (an item named as one, read from its own picture), drawn with no options of its own
    async find(s, files, folder) {
      const out = [], items = Object.values(s.package?.items || {}).filter(it => it?.kind === 'figure' && !it.source?.app && !it.map && /\bmap\b/i.test(it.title || ''));
      if (!items.length || !s.evidenceMap) return out;
      const [pd, mp, pkg] = await Promise.all([import('./printed-data.mjs'), import('./map-print.mjs'), import('./package-state.mjs')]);
      const L = pkg.labels(s.package);
      for (const it of items) {
        const path = pd.printedPath(it.source), file = path && files.find(f => f.path === path);
        if (!file) continue;
        const key = `map-print:${it.id}`, stamp = stampOf(file);
        if (s.autoSync?.done?.[key] === stamp) continue;
        const printed = await pd.readPrinted(folder, path).catch(() => null);
        if (!printed) { out.push({ key, stamp, quiet: true }); continue; }
        const r = mp.mapOptionsFromPrint(s, it, pd.linesOf(printed.items)), name = L.get(it.id) || 'An evidence map';
        if (!r.ok) { out.push({ key, stamp, title: `${name}: the options of its print`, safe: false, why: `${baseOf(printed.file)}: ${r.why}` }); continue; }
        const o = r.options, merged = Object.values(o.levels || {}).reduce((n, m) => n + Object.keys(m).length, 0);
        const fieldName = id => (s.templates || []).flatMap(t => t.columns || []).find(c => c.id === id)?.label || id.split('.').pop();
        out.push({ key, stamp, path, safe: true, parts: ['package'], title: `${name} is drawn as it prints`,
          detail: [o.col2 ? `${fieldName(o.col2)} beside ${fieldName(o.col)}` : '', merged ? `${plural(merged, 'value')} merged into the printed columns` : '', o.group ? `rows grouped by ${fieldName(o.group.field)}` : '', `${plural(r.matched, 'row')} agree with ${baseOf(printed.file)}`].filter(Boolean).join('; '),
          apply: st => { const x = st.package?.items?.[it.id]; if (x && !x.map) x.map = structuredClone(o); } });
      }
      return out;
    },
  },
  {
    id: 'relink',
    // a package figure drawn by the app that a script relinked to a new print: its source became { path: <the print>, was: <its earlier source> }
    // (an app link, { app, was }, kept under `was` as history). When the new print's panels show the result the link named
    // (lib/printed-data.mjs printedMatch), the link is kept and the print is its printed version again: { app, was: <the print> }
    async find(s, files, folder) {
      const out = [], items = Object.values(s.package?.items || {}).filter(it => it?.kind === 'figure' && typeof it.source?.path === 'string' && !it.source.app && linkIn(it.source.was));
      if (!items.length) return out;
      const [pd, pkg] = await Promise.all([import('./printed-data.mjs'), import('./package-state.mjs')]);
      const L = pkg.labels(s.package);
      for (const it of items) {
        const path = it.source.path, file = files.find(f => f.path === path), app = linkIn(it.source.was);
        if (!file) continue;
        const key = `relink:${it.id}`, stamp = `${stampOf(file)}|${app}`;
        if (s.autoSync?.done?.[key] === stamp) continue;
        const m = await (matchPrint || pd.printedMatch)(s, it, folder);
        if (!m?.against?.some(k => pd.sameResult(k, app))) { out.push({ key, stamp, quiet: true }); continue; }
        out.push({ key, stamp, path, title: `${L.get(it.id) || 'A figure'} keeps its link to ${m.viewLabel}`, safe: true, parts: ['package'],
          detail: `${baseOf(path)} shows ${m.words}${m.differs ? `; ${plural(m.differs, 'value')} ${m.differs === 1 ? 'differs' : 'differ'} from the app's data` : ''}`,
          apply: st => { const x = st.package?.items?.[it.id]; if (x && x.source?.path === path && !x.source.app) x.source = { app, was: path }; } });
      }
      return out;
    },
  },
];
// how a print is matched to the app's results (lib/printed-data.mjs printedMatch: pdf.js in the app); a test gives its own
let matchPrint = null;
export const __setPrintMatchForTest = f => { matchPrint = f; };
/** The app link a relinked source keeps as history (`was`, an earlier source, itself perhaps relinked once before), or ''. */
const linkIn = (was, depth = 0) => (!was || typeof was !== 'object' || depth > 4 ? '' : typeof was.app === 'string' && was.app ? was.app : linkIn(was.was, depth + 1));

/**
 * The judgements a risk-of-bias workbook read again would change, against what the workbook said when it was last read (`s.autoSync.robBase[path]`,
 * by study, tool and domain): one the app changed since is kept and listed as a conflict; the rest follow the workbook. With no earlier reading
 * there is nothing to tell an edit by, and the workbook's judgements are taken (as before). `{ conflicts, apply(st, at) }`.
 */
function robFollow(s, copy, trial, path) {
  const base = s.autoSync?.robBase?.[path] || null, now = {}, conflicts = [], j = v => JSON.stringify(v ?? null);
  const label = id => (s.papers || []).find(p => p.id === id)?.label || id;
  for (const w of trial.written) for (const [domain, v] of Object.entries(copy.assessments?.[w.paperId]?.[w.tool] || {})) {
    const k = `${w.paperId}|${w.tool}|${domain}`, cur = s.assessments?.[w.paperId]?.[w.tool]?.[domain];
    now[k] = v;
    if (!base || !(k in base) || j(cur) === j(base[k]) || j(cur) === j(v)) continue;
    conflicts.push({ key: `rob:${k}`, name: `${label(w.paperId)}: ${domain}`, file: String(v ?? ''), mine: String(cur ?? ''), adopted: String(base[k] ?? ''), value: v, path, rob: { paper: w.paperId, tool: w.tool, domain } });
  }
  return { conflicts, apply: (st, at) => {
    for (const c of conflicts) { const a = st.assessments?.[c.rob.paper]?.[c.rob.tool]; if (a) a[c.rob.domain] = s.assessments[c.rob.paper][c.rob.tool][c.rob.domain]; now[c.key.slice(4)] = base[c.key.slice(4)]; }
    st.autoSync = st.autoSync || {};
    st.autoSync.robBase = { ...(st.autoSync.robBase || {}), [path]: { ...(st.autoSync.robBase?.[path] || {}), ...now } };
    const mine = new Set(conflicts.map(c => c.key));
    st.autoSync.conflicts = [...(st.autoSync.conflicts || []).filter(c => !mine.has(c.key) && !(c.rob && c.path === path && now[c.key.slice(4)] !== undefined)), ...conflicts.map(c => ({ ...c, at }))];
  } };
}

// the master lists the adoption record tracks, by folder, so a look that finds none of them moved does not read the record
const listsOf = new WeakMap();
/** SHA-256 of a file's bytes, as lib/files.mjs documentHash gives it (the adoption record's `hash`). */
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');

/**
 * A table's source follows the file it was read from now (a newer version, or the same file with new columns): its file, sheet and time, and
 * the columns the file has that the table lacks. Its id, name, rules and its other columns stay: the title never changes with a version.
 */
function sourceFollows(st, tid, upd) {
  const t = (st.templates || []).find(x => x.id === tid);
  if (!t || !upd?.template) return;
  const has = new Set((t.columns || []).flatMap(c => [c.id, c.label]));
  const added = (upd.template.columns || []).filter(c => !has.has(c.id) && !has.has(c.label));
  // a newer file's columns in its own order, then the table's columns it lacks (a derived field); the same file only adds what is new
  const cols = upd.template.source?.file !== t.source?.file
    ? [...upd.template.columns, ...(t.columns || []).filter(c => !upd.template.columns.some(n => n.id === c.id || n.label === c.label))]
    : [...(t.columns || []), ...added];
  Object.assign(t, { columns: cols, source: { ...(t.source || {}), ...(upd.template.source || {}) }, ...(upd.template.arms ? { arms: { ...(t.arms || {}), ...upd.template.arms } } : {}) });
}

/**
 * Where the adoption record (`.lykos/adopted.json`, lib/drift.mjs) is read and written: the folder's sidecar, through lib/figure-sidecar.mjs.
 * `write([{ entry, keep }])` records each entry with its file's bytes now, or with `keep`'s (an entry with conflicts stays "changed" until they
 * are settled); `restore({ path: entry | null })` puts entries back as they were (Undo).
 */
export function folderRecords(folder) {
  let doc = null;
  const sidecar = () => import('./figure-sidecar.mjs'), facts = async path => (await import('./adopt.mjs')).fileFacts(folder, path);
  return {
    async read() {
      if (doc) return doc;
      try { doc = (await (await sidecar()).readSidecar('adopted', { folder })).doc; } catch { doc = { files: {} }; }
      return doc;
    },
    async write(list) {
      const entries = [];
      for (const { entry, keep } of list || []) {
        if (!entry?.path) continue;
        entries.push(keep ? fileEntry({ ...entry, file: { hash: keep.hash, size: keep.size, mtime: keep.mtime } }) : withFile(entry, await facts(entry.path)));
      }
      doc = null;
      return entries.length ? (await sidecar()).recordAdoption(entries, { folder }) : null;
    },
    async restore(before) {
      doc = null;
      return (await sidecar()).restoreAdoption(before, { folder });
    },
  };
}

/** What the detectors find for a folder now (nothing is written): `[found]`. `records` reads the adoption record (folderRecords). */
export async function detect(s, folder, { records = folderRecords(folder) } = {}) {
  const files = await projectFiles(folder), out = [];
  let adopted = null;
  const ctx = { adopted: async () => (adopted ??= await records.read().catch(() => ({ files: {} }))) };
  for (const d of DETECTORS) { try { out.push(...await d.find(s, files, folder, ctx)); } catch (err) { if (globalThis.process?.env?.LYKOS_SYNC_DEBUG) console.warn(d.id, err); } }
  return out;
}

/**
 * One pass: what is safe is applied (a snapshot of the parts it replaces written first), what is not is kept as a need. `update(fn)` writes the
 * state (store.mjs), `get()` reads it. Answers `{ applied: [entry], needs: [need] }`. Each change is one entry of Changes, with Undo; a file
 * followed with conflicts lists them in `s.autoSync.conflicts` (settleConflict).
 */
export async function syncFolder(folder, { get, update, records = folderRecords(folder), now = () => new Date().toISOString() }) {
  const s = get();
  if (s.autoSync?.off) return { applied: [], needs: [] };
  const found = await detect(s, folder, { records }), applied = [], needs = [];
  const done = f => st => { st.autoSync = { ...(st.autoSync || {}), done: { ...(st.autoSync?.done || {}), [f.key]: f.stamp, ...(f.also || {}) } }; };
  for (const f of found) {
    if (f.quiet) {
      update(st => { f.quietApply?.(st); done(f)(st); return st; });
      if (f.record) await records.write([f.record]).catch(() => null);
      continue;
    }
    if (!f.safe) { needs.push({ key: f.key, title: f.title, detail: f.why }); continue; }
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, cur = get(), at = now();
    const before = {};
    if (f.adopted?.length) { const doc = await records.read().catch(() => ({ files: {} })); for (const p of [...f.adopted, f.record?.entry?.path].filter(Boolean)) before[p] = doc.files?.[p] || null; }
    await writeSnapshot(folder, id, { ...Object.fromEntries(f.parts.map(p => [p, cur[p] ?? null])), __conflicts: cur.autoSync?.conflicts || [], __robBase: cur.autoSync?.robBase || null, ...(f.adopted?.length ? { __adopted: before } : {}) });
    const entry = { id, at, key: f.key, path: f.path || '', title: f.title, detail: f.detail };
    update(st => { f.apply(st, at); done(f)(st); st.autoSync.log = [entry, ...(st.autoSync?.log || [])].slice(0, 50); return st; });
    if (f.record) await records.write([f.record]).catch(() => null);
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
export async function undoChange(folder, id, { update, records = folderRecords(folder) }) {
  const { __conflicts, __adopted, __robBase, ...parts } = JSON.parse(dec.decode(await folder.read(`${SNAP_DIR}/${id}.json`)));
  update(st => {
    for (const [k, v] of Object.entries(parts)) { if (v == null) delete st[k]; else st[k] = v; }
    st.autoSync = { ...(st.autoSync || {}), log: (st.autoSync?.log || []).filter(e => e.id !== id), ...(__conflicts ? { conflicts: __conflicts } : {}), ...(__robBase !== undefined ? { robBase: __robBase || {} } : {}) };
    return st;
  });
  if (__adopted) await records.restore(__adopted).catch(() => null);
  return parts;
}

/**
 * Settles one conflict a follow left (`s.autoSync.conflicts`): "Use the file's" (`file`) puts the file's value in, as a change of its own in
 * Changes with Undo; "Keep mine" (`mine`) keeps the app's, which is then ahead of the file (a write back, lib/drift.mjs D5). The adoption
 * record's cell reads the file's text and the value now held; when the file has no conflict left, its bytes now become the adopted ones.
 */
export async function settleConflict(folder, key, choice, { get, update, records = folderRecords(folder), now = () => new Date().toISOString() }) {
  const c = (get().autoSync?.conflicts || []).find(x => x.key === key);
  if (!c) return null;
  const at = now(), id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const patch = c.patient ? (await import('./ipd-import.mjs')).ipdPatchFromText : null;
  const doc = await records.read().catch(() => ({ files: {} })), e = doc.files?.[c.path] || null, k = c.patient ? key : `v:${key}`;
  if (choice === 'file') {
    const cur = get(), part = c.rob ? 'assessments' : c.patient ? 'participants' : 'values';
    await writeSnapshot(folder, id, { [part]: cur[part] ?? null, __conflicts: cur.autoSync?.conflicts || [], __robBase: cur.autoSync?.robBase || null, ...(e && !c.rob ? { __adopted: { [c.path]: e } } : {}) });
  }
  let done = null;
  update(st => {
    done = settle(st, key, choice, { patch, at });
    if (done && choice === 'file') st.autoSync.log = [{ id, at, key: `settle:${key}`, path: c.path, title: `${c.name}: the file's value`, detail: `${c.file || 'empty'} (was ${c.mine || 'empty'})` }, ...(st.autoSync.log || [])].slice(0, 50);
    return st;
  });
  if (!done || !e || c.rob) return done;
  const left = (get().autoSync?.conflicts || []).some(x => x.path === c.path);
  const cells = e.cells.map(x => (x.k === k ? { ...x, f: String(c.f ?? ''), h: String(done.held ?? '') } : x));
  await records.write([{ entry: fileEntry({ ...e, cells, file: e }), keep: left ? e : null }]).catch(() => null);
  return done;
}
