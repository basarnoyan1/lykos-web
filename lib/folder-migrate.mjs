// Moving a project folder from an earlier layout to the current one (plan §4.15a, layout of 31 Oct 2026). Pure: the folder's entries and
// the project in, a list of moves and folders to make out; tools/lykos-layout.mjs makes them through tools/lykos-move.mjs (one change file,
// so every reference follows) and logs each in Old versions/Move log <date>.md. Nothing is deleted, and a folder that is already there is
// merged into only by adding what it lacks: nothing inside it moves (other people and agents may be writing there).
//
// The moves, in the order they are made (each names paths as they are after the ones before it):
//   1. organisePlan (lib/folder-map.mjs): stage folders renamed to their names ("papers" -> "Papers", "04 Papers" -> "Papers",
//      "Evidence table" -> "Data", "4 Risk of bias" -> "Risk of bias", "Archive" -> "Old versions"), the author-facing output folders into
//      Manuscript ("1 Tables" -> "Manuscript/Tables"), loose top-level files to the folder for what they are.
//   2. a rename whose destination is there becomes a merge: each entry of the old folder goes into the new one unless its name is taken.
//   3. verification rounds: "<data>/Verification <date>" -> "Data/Verification/<date>".
//   4. the archive by folder: "Old versions/Search v1 2026-10-26" -> "Old versions/Search/v1 2026-10-26".
//   5. papers by what the project says of them (PDFs named "NN - Author Year" are study IDs and stay): a record excluded at full text ->
//      Papers/Excluded/<reason>/, a linked report (reportOf) -> Papers/Companions/, an undecided full text -> Papers/Uncertain/; a PDF no
//      record names that is a copy of a numbered one (same bytes, or the same author and year) -> Old versions/Papers/Duplicates/.
import { organisePlan, folderLayout, layoutDirs, stageOfFolder, movedPath, parseStudyPdf, parseAuthorYearPdf, FOLDERS, ARCHIVE, STATE_DIR } from './folder-map.mjs';
import { reasonFolder } from './excluded-pdfs.mjs';

const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const dirOf = p => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STAGE_NAMES = Object.values(FOLDERS).map(f => f.name).sort((a, b) => b.length - a.length);

/**
 * The plan. `entries` are `{ path, dir?, size? }` for every file and folder under the root (hidden entries and .lykos left out);
 * `state` is the project (optional: without it the papers stay where they are); `hashes` maps a PDF's path to its SHA-256 (optional).
 * Answers `{ layout, moves: [{from, to, why, dir}], creates, skipped: [{from, to, why}], kept: [{path, why}] }`.
 */
export function migrationPlan(entries = [], { typeId = 'other', state = null, hashes = {} } = {}) {
  entries = entries.filter(e => e?.path && !e.path.startsWith('.') && !e.path.startsWith(`${STATE_DIR}/`));
  const base = organisePlan(entries, { typeId });
  const isDir = new Set(entries.filter(e => e.dir).map(e => e.path));
  const all = new Set(entries.map(e => e.path));
  const moves = [], skipped = [], kept = [];
  const cur = p => movedPath(p, moves);
  // the folder as it will be once the moves so far are made, by lower-case path (a disk that ignores case has one of each)
  const now = new Set([...all].map(p => p.toLowerCase()));
  const there = p => now.has(p.toLowerCase());
  const simulate = (from, to) => {
    const f = from.toLowerCase();
    for (const p of [...now]) if (p === f || p.startsWith(`${f}/`)) { now.delete(p); now.add(to.toLowerCase() + p.slice(f.length)); }
    const parts = to.split('/'); for (let i = 1; i < parts.length; i++) now.add(parts.slice(0, i).join('/').toLowerCase());
  };
  const add = (from, to, why, dir) => {
    if (from === to) return;
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && there(to)) { skipped.push({ from, to, why: `${to} is there already`, dir: !!dir }); return; }
    moves.push({ from, to, why, dir: !!dir, ...(caseOnly ? { caseOnly: true } : {}) });
    simulate(from, to);
  };
  // 1 and 2
  for (const m of base.moves) add(m.from, m.to, m.why, m.dir);   // organisePlan's moves already name paths as they are after the ones before
  for (const s of base.skipped) {
    if (!(s.dir && isDir.has(s.from))) { skipped.push(s); continue; }
    for (const e of entries.filter(x => dirOf(x.path) === s.from)) add(cur(e.path), `${s.to}/${baseOf(e.path)}`, `${s.from} merged into ${s.to}`, e.dir);
  }
  const top = key => {
    const d = [...isDir].find(p => !p.includes('/') && stageOfFolder(p) === key);
    return d ? cur(d) : '';
  };
  // 3
  const data = top('data');
  for (const e of entries.filter(x => x.dir && x.path.split('/').length === 2 && stageOfFolder(x.path.split('/')[0]) === 'data')) {
    const m = /^Verification (.+)$/.exec(baseOf(e.path));
    if (m && data) add(cur(e.path), `${data}/Verification/${m[1]}`, 'a verification round, by its date', true);
  }
  // 4
  const archive = top('archive') || ARCHIVE;
  for (const e of entries.filter(x => x.dir && x.path.split('/').length === 2 && stageOfFolder(x.path.split('/')[0]) === 'archive')) {
    const name = baseOf(e.path);
    const stage = STAGE_NAMES.find(n => name.toLowerCase().startsWith(`${n.toLowerCase()} `));
    if (!stage) continue;
    const rest = name.slice(stage.length + 1).trim();
    // "superseded 2026-10-26" -> "Superseded 2026-10-26"; a version ("v1 2026-10-26") keeps its case
    const named = /^v\d/i.test(rest) ? rest : rest.charAt(0).toUpperCase() + rest.slice(1);
    add(cur(e.path), `${archive}/${stage}/${named}`, `earlier ${stage.toLowerCase()} files, kept by folder`, true);
  }
  // 5
  const papers = top('papers');
  if (papers && state) {
    const papersOrig = [...isDir].find(p => !p.includes('/') && stageOfFolder(p) === 'papers');
    const byPdf = new Map((state.papers || []).filter(p => p.pdfRel).map(p => [p.pdfRel, p]));
    const numbered = entries.filter(e => !e.dir && dirOf(e.path) === papersOrig && parseStudyPdf(e.path));
    const numberedHash = new Map(numbered.filter(e => hashes[e.path]).map(e => [hashes[e.path], e.path]));
    const filed = new Set(['', 'Companions', 'Uncertain']);
    for (const e of entries.filter(x => !x.dir && /\.pdf$/i.test(x.path) && x.path.startsWith(`${papersOrig}/`))) {
      const sub = dirOf(e.path).slice(papersOrig.length + 1);
      if (!filed.has(sub) || parseStudyPdf(e.path)) continue;
      const rec = byPdf.get(e.path), name = baseOf(e.path);
      let to = '', why = '';
      if (rec) {
        const ft = state.fulltext?.[rec.id];
        if (ft?.decision === 'exclude') { to = `${papers}/Excluded/${reasonFolder(ft.reason)}/${name}`; why = `excluded at full text (${ft.reason || 'no reason'})`; }
        else if (rec.reportOf) { to = `${papers}/Companions/${name}`; why = 'a linked report of an included trial'; }
        else if (ft?.decision === 'uncertain') { to = `${papers}/Uncertain/${name}`; why = 'full text not decided'; }
        else if (ft?.decision === 'include' && sub) { to = `${papers}/${name}`; why = 'included at full text'; }
        else { if (!sub) kept.push({ path: e.path, why: ft ? 'included, not numbered yet' : 'no full-text decision' }); continue; }
      } else {
        const ay = parseAuthorYearPdf(name);
        const same = hashes[e.path] && numberedHash.get(hashes[e.path]);
        const twin = same || (ay && numbered.find(n => { const s = parseStudyPdf(n.path); return s.year === ay.year && fold(s.author) === fold(ay.author); })?.path);
        if (!twin) { kept.push({ path: e.path, why: 'no record names it' }); continue; }
        to = `${archive}/${FOLDERS.papers.name}/Duplicates/${name}`;
        why = same ? `the same file as ${baseOf(twin)}` : `a second download of ${baseOf(twin)}; no record names it`;
      }
      if (to && to !== cur(e.path)) add(cur(e.path), to, why, false);
    }
  }
  // folders of the layout that will be missing; an existing folder only gains what it lacks
  const creates = layoutDirs(folderLayout(typeId)).filter(d => !there(d));
  return { layout: base.layout, moves, creates, skipped, kept };
}

/** The move log, as Markdown: what moved where and why, what was made, what was left and why. */
export function moveLog({ moves = [], creates = [], skipped = [], kept = [], refs = 0, sidecars = {}, at = new Date().toISOString(), day = at.slice(0, 10), folder = '', dryRun = false } = {}) {
  const out = [`# Move log ${day}`, '', `${dryRun ? 'Planned' : 'Moved'} by tools/lykos-layout.mjs migrate${folder ? ` in ${folder}` : ''} at ${at.slice(0, 16).replace('T', ' ')} UTC. Nothing was deleted; every path the project names inside what moved follows it (${refs} path${refs === 1 ? '' : 's'}).`, ''];
  out.push('## Moves', '', '| From | To | Why |', '| --- | --- | --- |', ...moves.map(m => `| ${m.from}${m.dir ? '/' : ''} | ${m.to}${m.dir ? '/' : ''} | ${m.why || ''} |`), '');
  if (creates.length) out.push('## Folders made', '', ...creates.map(c => `- ${c}/`), '');
  if (Object.keys(sidecars).length) out.push('## Lykos records updated', '', ...Object.entries(sidecars).map(([f, n]) => `- .lykos/${f}: ${n}`), '');
  if (skipped.length) out.push('## Not moved', '', ...skipped.map(s => `- ${s.from} -> ${s.to}: ${s.why}`), '');
  if (kept.length) out.push('## Left where they are', '', ...kept.map(k => `- ${k.path}: ${k.why}`), '');
  return out.join('\n');
}
