// Project folder: what the folder holds and what each file is to the review,
// what Lykos writes into it, and the standard layout (plan §4.15a).
//
// Detection is lib/folder-map.mjs; reading and writing is lib/project-folder.mjs.
// Applying a row goes through the import each kind of file already has — the
// library's record import, the evidence-table import, the patient-data import,
// the manuscript import — so a file mapped here lands exactly as if it had been
// imported by hand. Nothing is applied without a press, and a reorganisation
// is shown in full before anything moves.
import { day, when as stamp, when, num, plural } from '../lib/dates.mjs';
import { REGISTRY } from './registry.mjs';
import { get, update, persist } from '../store.mjs';
import { activeFolder, isNone, saveLocalToFolder } from '../lib/projects.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { confirmAsk, formDialog, planDialog } from '../lib/dialog.mjs';
import { researchType, projectName } from '../lib/workflow.mjs';
import { matchStudyPdf, screeningRows, screeningColumns, headerRow, matchRecord, criteriaRows, GUIDE } from '../lib/folder-map.mjs';
import { indexFolder, tableRows, planOrganise, applyOrganise, organiseLogs, undoOrganise, projectLayout, createLayout } from '../lib/project-folder.mjs';
import { OUTPUT_KINDS, writeProjectOutputs, availableKinds } from '../lib/folder-outputs.mjs';
import { writeEvidenceTables } from './evidence-exports.mjs';
import { showMenu } from '../lib/menu.mjs';
import { show as showFile } from './files.mjs';
import { importRecords, addFolderPdfs, markFolderPdf } from './library.mjs';
import { importTable } from './runs.mjs';
import { importManuscript } from './manuscript.mjs';
import { mergeRules, structureCriteria } from '../lib/criteria.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { configured } from '../lib/ai.mjs';
import * as ipd from '../lib/ipd.mjs';
import { isDual, finalDecision } from '../lib/screen.mjs';
import { baseName, canOpenFolders } from '../lib/fsys.mjs';
import { writeDelimited } from '../lib/spreadsheet.mjs';
import { ipdListFromRows, applyIpdList } from '../lib/ipd-import.mjs';
import { adoptFromFolder } from '../lib/adopt.mjs';
import { importReferences, libraryIndex } from '../lib/search-library.mjs';
import { parseRecords } from '../lib/bib.mjs';
import { importTableGroups, importPrismaCounts } from '../lib/folder-apply.mjs';
import { followMove } from '../lib/folder-follow.mjs';   // a record follows its PDF when the folder is reorganised or renumbered
import { papersMenuItems } from './folder-renumber.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
// ---- workflow history: set up the review's workflows with its earlier work as runs ----
import { buildHistorySet, applyHistorySet, hasHistoryWorkflows } from '../lib/workflow-history.mjs';
// ---- end workflow history ----

export const meta = { title: 'Project folder', icon: 'folder' };
/** The title bar (lib/topbar.mjs) names the page. */
export const page = () => ({ title: 'Project folder', actions: [] });
export const count = (...a) => REGISTRY.folder.count(...a);

let scan = null;          // the last index of the folder
let scanning = false;
let organise = null;      // a plan on screen, not yet applied
let logs = [];            // earlier organisations, for Undo
let notes = {};           // path or output id → what the last action said
let busy = new Set();


// What was applied: recorded by this screen or by folder setup, or implied by
// the project itself (a search log entry names its export and query file; a
// record links its PDF), so a file already in the project is never offered again.
const referenced = path => {
  const s = get();
  const run = (s.searches || []).find(r => r.file === path || r.queryFile === path);
  if (run) return { result: run.file === path ? `In the search log · ${run.source || 'Search'}` : 'Query of a logged search' };
  const paper = (s.papers || []).find(p => p.pdfRel === path);
  return paper ? { result: `Linked to ${paper.label || 'a record'}` } : null;
};
const applied = path => get().folderMap?.applied?.[path] || referenced(path);
// What was applied, with the file's size and time then, so a later change to the file shows.
const markApplied = (path, result, f = {}) => update(s => {
  s.folderMap = { ...(s.folderMap || {}), applied: { ...(s.folderMap?.applied || {}), [path]: { at: new Date().toISOString(), result: String(result || '').slice(0, 200), size: f.size ?? null, mtime: f.mtime ?? null } } };
  return s;
});
const cap = t => { const x = String(t || ''); return x.charAt(0).toUpperCase() + x.slice(1); };

/** After setup gives a folder project its research type, its folders follow. */
export async function layoutAfterSetup() {
  const folder = activeFolder();
  if (!folder) return;
  const s = get();
  const layout = await projectLayout(folder, researchType(s).id);
  const top = (await folder.list('')).filter(e => !e.name.startsWith('.'));
  // A folder with the person's own files keeps its shape; Organise folder offers the change.
  if (layout.laidOut || top.some(e => e.name !== GUIDE)) return;
  await createLayout(folder, researchType(s).id, { name: projectName(s), type: researchType(s).label, question: s.protocol?.title || '' });
}

async function rescan(ctx) {
  const folder = activeFolder(); if (!folder) return;
  scanning = true; ctx.rerender();
  try { scan = await indexFolder(folder, researchType(get()).id); logs = await organiseLogs(folder).catch(() => []); }
  catch (err) { scan = { error: String(err?.message || err) }; }
  finally { scanning = false; ctx.rerender(); }
}

// ---- rendering ----------------------------------------------------------------
// What the folder has comes first, grouped by what it feeds; what Lykos writes
// comes second. One action per group; a row's own actions sit in its … menu.
const GROUP_OF = f => {
  if (f.role === 'archived' || f.older || f.role === 'copy') return 'archive';
  if (['app-state', 'guide', 'lock-file', 'lykos-output'].includes(f.role)) return null;   // Lykos's own outputs are listed under Written by Lykos
  if (f.target === 'library' || f.target === 'search-log' || f.target === 'references' || f.role === 'reference-list') return 'records';
  if (f.target === 'screening' || f.target === 'prisma' || ['candidate-cases', 'prisma-flow', 'prisma-report'].includes(f.role)) return 'screening';
  if (f.target === 'pdf') return 'pdfs';
  if (f.target === 'extraction' || f.target === 'collections' || f.role === 'reference-table') return 'evidence';
  if (f.target === 'patients') return 'patients';
  if (f.target === 'manuscript' || ['reviewer-comments', 'table-doc', 'figures-doc', 'cover-letter', 'manuscript-output', 'supplement', 'checklist'].includes(f.role)) return 'manuscript';
  if (f.target === 'criteria' || f.target === 'protocol' || f.role === 'consent') return 'protocol';
  if (f.role === 'figure' || f.role === 'image') return 'figures';
  return 'other';
};
const GROUPS = [
  { id: 'records', title: 'Records', verb: 'Import' },
  { id: 'screening', title: 'Screening', verb: 'Import' },
  { id: 'pdfs', title: 'Included PDFs', verb: 'Attach' },
  { id: 'evidence', title: 'Evidence table', verb: 'Import' },
  { id: 'patients', title: 'Patient data', verb: 'Import' },
  { id: 'manuscript', title: 'Manuscript', verb: 'Import' },
  { id: 'protocol', title: 'Protocol', verb: 'Import' },
  { id: 'figures', title: 'Figures', verb: '' },
  { id: 'other', title: 'Other', verb: '' },
];
const FOLDED = new Set(['pdfs', 'figures', 'other', 'archive']);   // long lists open in place
const open = new Set();                                            // groups the person toggled from their default
/** Every group has a disclosure; a long list of a folded kind starts closed, the rest open. */
const expandedOf = (id, files) => (!(FOLDED.has(id) && files.length > 3 || id === 'archive')) !== open.has(id);

const actionable = f => !!f.target && !f.older && f.role !== 'copy';
const verbOf = f => f.target === 'pdf' ? 'Attach' : f.target === 'search-log' ? 'Add' : 'Import';
const ignored = path => !!get().folderMap?.ignored?.[path];
// Why a file was left out, when folder setup or the person said ("Superseded export").
const ignoredWhy = path => { const v = get().folderMap?.ignored?.[path]; return typeof v === 'string' ? v : ''; };
function statusOf(f) {
  if (busy.has(f.path)) return 'Working';
  if (ignored(f.path)) return 'Ignored';
  const a = applied(f.path);
  if (a) return a.size != null && (a.size !== f.size || a.mtime !== f.mtime) ? 'Changed since import' : f.target === 'pdf' ? 'Linked' : 'Imported';
  if (notes[f.path]) return notes[f.path];
  return actionable(f) ? 'New' : '';
}
const pending = f => actionable(f) && !ignored(f.path) && !busy.has(f.path) && (!applied(f.path) || statusOf(f) === 'Changed since import');

/** What a file maps to, as a short phrase. */
function mapping(f) {
  if (f.virtual) return `Sheet ${f.sheet} → criteria${f.rows != null ? `, ${f.rows} rows` : ''}`;
  if (f.target === 'library') return f.records != null ? `${plural(f.records, 'record')}` : 'Records';
  if (f.target === 'search-log') return f.role === 'search-log' ? 'Search log' : 'Search strategy';
  if (f.target === 'pdf') return f.role === 'study-pdf' ? `Study ${String(f.study.no).padStart(2, '0')} · ${f.study.author} ${f.study.year}${f.study.suffix || ''}`
    : f.role === 'excluded-pdf' ? 'Excluded study' : f.study ? `${f.study.author} ${f.study.year}` : 'Paper';
  const rows = f.rows != null ? `, ${plural(f.rows, 'row')}` : '';
  if (f.target === 'screening') return f.sheet ? `Sheet ${f.sheet} → screening${rows}` : 'Screening sheet';
  if (f.target === 'extraction') return f.sheet ? `Sheet ${f.sheet} → extraction${f.columns ? `, ${f.columns} columns` : ''}${rows}` : 'Evidence table';
  if (f.target === 'patients') return f.sheet ? `Sheet ${f.sheet} → patients${rows}${f.role === 'ipd-list' ? ' and decisions' : ''}` : 'Patient data';
  if (f.target === 'references') return f.records != null ? `${num(f.records)} works cited, not a search` : 'Works cited, not a search';
  if (f.target === 'criteria') return f.kind === 'table' ? `Sheet ${f.sheet} → criteria${rows}` : 'Criteria, as prose';
  if (f.target === 'collections') return 'Table groups → collections';
  if (f.target === 'prisma') return 'PRISMA counts';
  return f.label;
}

function fileRow(f) {
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
  const key = f.virtual || f.path;
  return uiRow({ attrs: { 'data-path': key },
    main: { html: `<span class="pf-file">${esc(f.name)}</span>`, detail: [esc(dir), esc(ignoredWhy(f.path) || mapping(f)), esc(statusOf(f))], wrap: true },
    end: uiRowEnd({ more: { label: `More for ${f.name}`, attrs: { 'data-more': key } } }) });
}
const fileList = (label, files) => uiList({ label, cls: 'pf-rows', rows: files.map(fileRow) });

function groupHead(g, files, { summary: given = null } = {}) {
  const todo = files.filter(pending);
  const done = files.filter(f => applied(f.path) && statusOf(f) !== 'Changed since import').length;
  const summary = given ?? (g.id === 'pdfs'
    ? [`${files.filter(f => f.role === 'study-pdf').length} numbered`, files.some(f => f.role !== 'study-pdf') ? `${files.filter(f => f.role !== 'study-pdf').length} other` : '', `${files.filter(f => applied(f.path)).length} linked`].filter(Boolean).join(' · ')
    : [done ? `${done} imported` : '', todo.length ? `${todo.length} new` : ''].filter(Boolean).join(' · '));
  const expanded = expandedOf(g.id, files);
  const included = files.filter(f => f.role === 'study-pdf').length;
  return uiBar({ kind: 'head', label: g.title, id: `pf-group-${g.id}`, cls: 'pf-group-head',
    lead: { nav: [{ id: `pf-disc-${g.id}`, label: `${expanded ? 'Collapse' : 'Expand'} ${g.title}`, icon: expanded ? 'chevron-down' : 'chevron-right', attrs: { 'data-disclose': g.id, 'aria-expanded': String(expanded) } }], title: g.title, level: 'h3' },
    status: { text: String(files.length), ch: 4 }, message: { text: summary },
    actions: g.verb && todo.length ? [{ id: `pf-apply-${g.id}`, label: `${g.verb} ${todo.length} new`, attrs: { 'data-apply-group': g.id } }] : [],
    overflow: g.id === 'pdfs' ? [{ id: 'pf-renumber', label: 'Renumber by inclusion order…', icon: 'list-number', disabled: !included }] : [] });
}

function filesSection(ix) {
  const byGroup = Object.fromEntries([...GROUPS.map(g => [g.id, []]), ['archive', []]]);
  for (const f of ix.files) { const k = GROUP_OF(f); if (k) byGroup[k].push(f); }
  // A screening workbook that also carries its criteria offers them under Protocol.
  for (const f of ix.files.filter(x => x.target === 'screening' && (x.sheets || []).some(sh => sh.role === 'criteria'))) {
    const sh = f.sheets.find(x => x.role === 'criteria');
    byGroup.protocol.push({ ...f, virtual: `${f.path}#criteria`, sheet: sh.sheet, target: 'criteria', kind: 'table', rows: null });
  }
  byGroup.pdfs.sort((a, b) => (a.study?.no ?? 1e9) - (b.study?.no ?? 1e9) || a.path.localeCompare(b.path));
  const sections = GROUPS.filter(g => byGroup[g.id].length).map(g => {
    const files = byGroup[g.id], expanded = expandedOf(g.id, files);
    return `<div class="pf-group" data-group="${g.id}">${groupHead(g, files)}
      ${expanded ? fileList(`${g.title} files`, files) : ''}</div>`;
  });
  const arch = byGroup.archive;
  if (arch.length) {
    const expanded = expandedOf('archive', arch);
    const copies = arch.filter(f => f.role === 'copy').length;
    sections.push(`<div class="pf-group" data-group="archive">${groupHead({ id: 'archive', title: 'Archive and earlier versions', verb: '' }, arch, { summary: [copies ? `${copies} quick-access copies` : '', 'Not imported'].filter(Boolean).join(' · ') })}
      ${expanded ? fileList('Archive and earlier versions', arch) : ''}</div>`);
  }
  return `<section class="pf-section" aria-labelledby="pf-files">
    ${sectionHead('pf-files', 'In this folder', { status: { text: plural(ix.files.length, 'file'), ch: 12 } })}
    ${sections.join('') || emptyState({ title: 'No files yet', size: 'inline' })}
  </section>`;
}

// Where each output kind goes (lib/folder-map.mjs outputFor decides per file).
const OUT_DIR = { library: ['search', 'manuscript'], screening: ['screening'], evidence: ['data'], 'evidence-tables': ['data'], characteristics: ['manuscript'], prisma: ['screening'],
  analysis: ['analysis'], reporting: ['protocol', 'search', 'manuscript'], manuscript: ['manuscript', 'supplement'] };
const outputDir = (id, layout) => [...new Set((OUT_DIR[id] || ['data']).map(k => layout.dirFor(k)))].join(', ');
let chosen = null;   // output kinds ticked; follows what has data until the person ticks one

function outputsSection(ix) {
  const avail = availableKinds();
  if (!chosen || !chosen.touched) { chosen = new Set(OUTPUT_KINDS.filter(k => avail[k.id]).map(k => k.id)); chosen.touched = false; }
  const log = Object.values(ix?.outputs || {});
  const last = id => log.filter(o => o.kind === id).map(o => o.checkedAt && o.checkedAt > o.at ? o.checkedAt : o.at).sort().at(-1);
  const n = chosen.size;
  return `<section class="pf-section" aria-labelledby="pf-outputs">
    ${sectionHead('pf-outputs', 'Written by Lykos', { status: { id: 'pf-write-count', text: busy.has('outputs') ? 'Writing' : `${n} selected`, ch: 12 },
      actions: [{ id: 'pf-write', label: 'Write selected', role: 'primary', disabled: !(n && !busy.has('outputs')) }] })}
    ${uiList({ label: 'Files Lykos writes', cls: 'pf-rows', rows: OUTPUT_KINDS.map(k => {
      const at = last(k.id);
      return uiRow({ check: { checked: chosen.has(k.id), label: k.label, attrs: { 'data-out': k.id } },
        main: { html: `<span class="pf-file">${esc(k.label)}</span>`, detail: [esc(ix?.layout ? outputDir(k.id, ix.layout) : ''), esc(at ? `Written ${stamp(at)}` : avail[k.id] ? 'Not written yet' : 'Nothing to write yet')], wrap: true },
        end: uiRowEnd({ reserve: true }) });
    }) })}
    ${notes.outputs ? `<p class="meta pf-note">${esc(notes.outputs)}</p>` : ''}
  </section>`;
}

/** A section's title (an h3 the section is labelled by), an optional count and the acts that belong to it: one head bar. */
const sectionHead = (id, title, extra = {}) => uiBar({ kind: 'head', label: title, id: `${id}-bar`, cls: 'pf-section-head', lead: { title, level: 'h3', id }, ...extra });

const whereOf = folder => {
  if (!folder.root) return folder.name;
  const parts = folder.root.replace(/\/+$/, '').split('/');
  return parts.length > 1 ? `${parts.at(-2)} › ${parts.at(-1)}` : folder.name;
};

export function render(el, ctx) {
  const folder = activeFolder();
  if (!folder) {
    el.innerHTML = emptyState({ icon: 'folder', title: isNone() ? 'No project open' : 'This project is kept in app storage',
      detail: isNone() ? '' : 'A project folder keeps its papers, tables and manuscript beside the project, one folder for each stage.',
      actions: isNone() || !canOpenFolders() ? [] : [{ id: 'pf-move', label: 'Move to folder', icon: 'upload', primary: true }] });
    el.querySelector('#pf-move')?.addEventListener('click', async () => {
      try { await saveLocalToFolder(get()); } catch (err) { notes.outputs = err.message; }
    });
    return;
  }
  if (!scan && !scanning) rescan(ctx);
  el.innerHTML = `<div class="pf-page">
    ${uiBar({ kind: 'head', label: 'Project folder', id: 'pf-head', cls: 'pf-head', lead: { title: folder.name, level: 'h2' }, message: { id: 'pf-where', text: whereOf(folder) },
      actions: [{ id: 'pf-rescan', label: 'Rescan', icon: 'refresh', disabled: scanning },
        { id: 'pf-organise', label: 'Organise folder', icon: 'folder', disabled: scanning },
        ...(historyOffered() ? [{ id: 'pf-workflows', label: 'Set up workflows from history', icon: 'workflow', disabled: scanning || !scan?.entries || busy.has('workflows') }] : [])],
      overflow: folder.can?.reveal ? [{ id: 'pf-reveal', label: 'Show in Finder', icon: 'folder' }] : [] })}
    ${notes.workflows ? `<p class="meta pf-note">${esc(notes.workflows)}</p>` : ''}
    ${organise ? organiseSection(organise) : ''}
    ${scan?.error ? `<p class="note">${esc(scan.error)}</p>` : ''}
    ${scan && !scan.error ? filesSection(scan) : scanning ? emptyState({ title: 'Scanning', size: 'inline' }) : ''}
    ${outputsSection(scan)}
    ${logs.length ? logSection(logs) : ''}
  </div>`;
  wire(el, ctx, folder);
}

function organiseSection(p) {
  const moves = p.moves || [];
  const nothing = !moves.length && !p.creates.length && !p.guide && !p.guideAppend;
  const row = (from, to, why) => uiRow({ main: { html: `<span class="pf-file">${esc(from)}</span>`, detail: [esc(to), esc(why)], wrap: true }, end: uiRowEnd({ reserve: true }) });
  return `<section class="pf-section pf-organise" aria-labelledby="pf-organise-title">
    ${sectionHead('pf-organise-title', 'Organise folder', { actions: [{ id: 'pf-organise-cancel', label: 'Cancel' }, ...(nothing ? [] : [{ id: 'pf-organise-apply', label: 'Apply', role: 'primary', disabled: busy.has('organise') }])] })}
    ${nothing ? emptyState({ title: 'Already in the standard layout', size: 'inline' }) : uiList({ label: 'Planned changes', cls: 'pf-rows', rows: [
      ...moves.map(m => row(m.from, m.to, m.blocked ? 'Needs the desktop app' : cap(m.why))),
      ...p.creates.map(d => row('New folder', d, '')),
      ...(p.guide ? [row('New file', GUIDE, 'Folder guide')] : []),
      ...(p.guideAppend ? [uiRow({ check: { checked: false, label: `Add the Lykos section to ${GUIDE}`, attrs: { 'data-guide-append': true } }, main: { html: `<span class="pf-file">${GUIDE}</span>`, detail: ['Add the Lykos section', 'Its own text is kept'], wrap: true }, end: uiRowEnd({ reserve: true }) })] : []),
      ...p.skipped.map(m => row(m.from, m.to, `Skipped: ${m.why}`)),
      ...p.lock.map(f => row(f, 'Left in place', 'Temporary file of an open document'))] })}
  </section>`;
}

function logSection(list) {
  return `<section class="pf-section" aria-labelledby="pf-log-title">
    ${sectionHead('pf-log-title', 'Organisations')}
    ${uiList({ label: 'Earlier organisations', cls: 'pf-rows', rows: list.slice(0, 5).map(l => uiRow({
      main: { html: `<span class="pf-file">${esc(when(l.at))}</span>`, detail: [`${(l.moves || []).length} moved${(l.failed || []).length ? ` · ${l.failed.length} not moved` : ''}`, l.undoneAt ? `Undone ${day(l.undoneAt)}` : ''], wrap: true },
      end: l.undoneAt || !(l.moves || []).length ? uiRowEnd({ reserve: true }) : uiRowEnd({ more: { label: `More for the organisation of ${when(l.at)}`, attrs: { 'data-log-more': l.path } } }) })) })}
  </section>`;
}

// ---- actions ----------------------------------------------------------------------
function wire(el, ctx, folder) {
  el.querySelector('#pf-rescan')?.addEventListener('click', () => rescan(ctx));
  el.querySelector('#pf-workflows')?.addEventListener('click', () => setUpWorkflows(ctx, folder));
  el.querySelector('#pf-reveal')?.addEventListener('click', () => folder.reveal('').catch(err => { notes.outputs = err.message; ctx.rerender(); }));
  el.querySelector('#pf-organise')?.addEventListener('click', async () => {
    try { organise = await planOrganise(folder, researchType(get()).id); } catch (err) { notes.outputs = err.message; }
    ctx.rerender();
  });
  el.querySelector('#pf-organise-cancel')?.addEventListener('click', () => { organise = null; ctx.rerender(); });
  el.querySelector('#pf-organise-apply')?.addEventListener('click', async () => {
    const plan = organise; if (!plan) return;
    const n = plan.moves.filter(m => !m.blocked).length;
    if (!await confirmAsk('Organise this folder?', { detail: `${n} ${n === 1 ? 'move' : 'moves'}, ${plan.creates.length} new ${plan.creates.length === 1 ? 'folder' : 'folders'}. Undo is kept in .lykos/organise.`, confirm: 'Organise' })) return;
    busy.add('organise'); ctx.rerender();
    const s = get();
    const append = el.querySelector('[data-guide-append]')?.checked;
    try {
      const r = await applyOrganise(folder, plan, { onMoved: followMove,
        guide: plan.guide || append ? { name: projectName(s), type: researchType(s).label, question: s.protocol?.title || '', typeId: researchType(s).id } : null });
      await persist();
      notes.outputs = `${r.moved} moved${r.failed.length ? ` · ${r.failed.length} not moved: ${r.failed.map(f => f.from || f.create).slice(0, 3).join(', ')}` : ''}`;
      organise = null;
    } catch (err) { notes.outputs = err.message; }
    busy.delete('organise'); scan = null; ctx.refreshCounts?.(); rescan(ctx);
  });
  const undoLog = async path => {
    if (!await confirmAsk('Undo this organisation?', { detail: 'Files and folders go back where they were.', confirm: 'Undo' })) return;
    try { const r = await undoOrganise(folder, path, { onMoved: followMove }); await persist(); notes.outputs = `${r.restored} put back${r.failed.length ? ` · ${r.failed.length} could not be` : ''}`; }
    catch (err) { notes.outputs = err.message; }
    scan = null; rescan(ctx);
  };
  el.querySelectorAll('[data-log-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Undo this organisation', icon: 'undo', run: () => undoLog(b.dataset.logMore) }], { align: 'end' }));
  el.querySelectorAll('[data-disclose]').forEach(b => b.onclick = () => { const k = b.dataset.disclose; if (open.has(k)) open.delete(k); else open.add(k); ctx.rerender(); });
  el.querySelectorAll('[data-apply-group]').forEach(b => b.onclick = async () => {
    const files = groupFiles(b.dataset.applyGroup).filter(pending);
    if (files.length > 1 && !await confirmAsk(`${b.textContent}?`, { detail: files.map(f => f.name).slice(0, 6).join(', ') + (files.length > 6 ? ` and ${files.length - 6} more` : ''), confirm: b.textContent })) return;
    for (const f of files) await applyPath(f.virtual || f.path, ctx, folder, { quiet: files.length > 1 });
  });
  el.querySelector('#pf-renumber')?.addEventListener('click', () => papersMenuItems({ folder, included: groupFiles('pdfs').filter(f => f.role === 'study-pdf').length, done: msg => { notes.outputs = msg; scan = null; rescan(ctx); } })[0].run());
  el.querySelectorAll('[data-more]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const key = b.dataset.more, f = groupFiles(null).find(x => (x.virtual || x.path) === key); if (!f) return;
    showMenu(b, [
      actionable(f) && !ignored(f.path) && { label: applied(f.path) ? `${verbOf(f)} again` : verbOf(f), icon: 'import', run: () => applyPath(key, ctx, folder) },
      { label: 'Open', icon: 'file', run: () => { showFile(f.path); ctx.go('files'); } },
      folder.can?.reveal && { label: 'Show in Finder', icon: 'folder', run: () => folder.reveal(f.path).catch(() => {}) },
      actionable(f) && { label: ignored(f.path) ? 'Stop ignoring' : 'Ignore', icon: 'close', run: () => { update(s => { const ig = { ...(s.folderMap?.ignored || {}) }; if (ig[f.path]) delete ig[f.path]; else ig[f.path] = true; s.folderMap = { ...(s.folderMap || {}), ignored: ig }; return s; }); ctx.rerender(); } },
    ].filter(Boolean), { align: 'end', minWidth: 180 });
  });
  el.querySelectorAll('[data-out]').forEach(c => c.onchange = () => { if (c.checked) chosen.add(c.dataset.out); else chosen.delete(c.dataset.out); chosen.touched = true; ctx.rerender(); });
  el.querySelector('#pf-write')?.addEventListener('click', () => writeOut([...chosen], ctx, folder));
}

/** The files of a group as the view lists them (null: every file, criteria sheets included). */
function groupFiles(id) {
  if (!scan?.files) return [];
  const list = scan.files.filter(f => id == null || GROUP_OF(f) === id);
  if (id == null || id === 'protocol') for (const f of scan.files.filter(x => x.target === 'screening' && (x.sheets || []).some(sh => sh.role === 'criteria'))) {
    const sh = f.sheets.find(x => x.role === 'criteria');
    list.push({ ...f, virtual: `${f.path}#criteria`, sheet: sh.sheet, target: 'criteria', kind: 'table', rows: null });
  }
  return list;
}

async function writeOut(only, ctx, folder) {
  busy.add('outputs'); ctx.rerender();
  try {
    // The publication tables go by the folder's version rule, after a preview (views/evidence-exports.mjs).
    const tables = only.includes('evidence-tables') ? await writeEvidenceTables(folder) : '';
    const rest = only.filter(k => k !== 'evidence-tables');
    const r = rest.length ? await writeProjectOutputs(folder, rest) : { written: [], unchanged: [], archived: [], failed: [] };
    notes.outputs = [tables, r.written.length || r.unchanged.length || r.failed.length
      ? `${r.written.length} written${r.unchanged.length ? ` · ${r.unchanged.length} unchanged` : ''}${r.archived.length ? ` · ${r.archived.length} archived` : ''}${r.failed.length ? ` · failed: ${r.failed.map(f => `${f.stem} (${f.error})`).join('; ')}` : ''}`
      : rest.length ? 'Nothing to write yet' : ''].filter(Boolean).join(' · ');
  } catch (err) { notes.outputs = err.message; }
  busy.delete('outputs'); scan = null; rescan(ctx);
}

async function applyPath(path, ctx, folder, { quiet = false } = {}) {
  const virtual = path.endsWith('#criteria');
  const real = virtual ? path.slice(0, -'#criteria'.length) : path;
  const f = scan?.files.find(x => x.path === real);
  if (!f) return;
  delete notes[path];
  busy.add(path); ctx.rerender();
  const say = msg => { notes[path] = String(msg || '').slice(0, 160); };
  try {
    const target = virtual ? 'criteria' : f.target;
    const asFile = async () => new File([await folder.read(real)], baseName(real));
    let result = '';
    if (target === 'library') { await importRecords(await asFile(), m => { result = m; }, { rel: real }); }
    else if (target === 'pdf') result = await attachPdf(f, folder, { quietPick: quiet });
    else if (target === 'screening') result = await importScreening(f, folder, quiet);
    else if (target === 'criteria') result = virtual || f.kind === 'table' ? await importCriteriaSheet(f, folder, virtual ? (f.sheets || []).find(x => x.role === 'criteria')?.sheet : f.sheet)
      : await importCriteriaText(f, folder);
    else if (target === 'extraction') { let note = ''; await importTable(ctx, (id, r) => { note = r?.note || ''; }, await asFile(), { path: real }); result = `Imported as a table template with proposals${note ? `. ${note}` : ''}`; }
    else if (target === 'patients') result = await importPatients(f, folder, quiet);
    else if (target === 'references') result = await importReferenceList(f, folder);
    else if (target === 'manuscript') { await importManuscript(await asFile(), m => { result = m; }); }
    else if (target === 'search-log') result = await addSearchLog(f, folder);
    else if (target === 'collections') result = await importTableGroups(folder, real);
    else if (target === 'prisma') result = await importPrismaCounts(folder, real);
    say(result || 'Done');
    if (result && !/^Nothing|^Cancelled|^Needs|^No |^Could not/.test(result)) markApplied(path, result, f);
  } catch (err) { say(err.message); }
  busy.delete(path);
  ctx.refreshCounts?.(); ctx.rerender();
}

/** Several records fit a PDF's author and year (two Kaner 2010 studies): the person picks. */
function pickRecord(f, candidates) {
  const rows = candidates.map((p, i) => `<label class="pf-pick-option"><input type="radio" name="pf-pick" value="${i}"${i ? '' : ' checked'}>
      <span><span class="pf-pick-title">${esc(p.title || p.label)}</span><span class="meta">${esc([p.label, p.journal, p.doi].filter(Boolean).join(' · '))}</span></span></label>`).join('');
  return formDialog({ id: 'attach-record', title: 'Attach to which record?', detail: f.name, tier: 'L', confirm: 'Attach', body: `<div class="ask-scroll pf-pick">${rows}</div>`,
    submit: form => candidates[Number(new FormData(form).get('pf-pick'))] || null });
}

/** A study PDF to its record: by the ID rule's author and year, else by what the PDF says. */
async function attachPdf(f, folder, { quietPick = false } = {}) {
  const s = get();
  const hit = f.study ? matchStudyPdf(f.study, s.papers || []) : { paper: null, candidates: [] };
  let paper = hit.paper;
  if (!paper && hit.candidates?.length > 1 && !quietPick) paper = await pickRecord(f, hit.candidates);
  if (!paper) {
    if (hit.candidates?.length > 1) return `Needs a choice: ${hit.candidates.length} records are ${f.study.author} ${f.study.year}`;
    paper = await addFolderPdfs([f.path], () => {});
    if (!paper) return 'Could not read the PDF';
  } else {
    const st = await folder.stat(f.path);
    markFolderPdf(paper.id, f.path, st.size, null);
  }
  const included = f.role === 'study-pdf';
  update(st => {
    const p = st.papers.find(x => x.id === paper.id);
    if (p && f.study?.no) p.folderNo = f.study.no;
    // The papers folder holds the included studies (the ID rule): a record
    // with no full-text decision is recorded as included at full text,
    // attributed to the folder, unless it was excluded at title and abstract
    // (that disagreement is left to a person). No decision is ever changed.
    if (p && included && !isDual(st) && !st.fulltext?.[p.id] && st.screening?.[p.id]?.decision !== 'exclude') {
      st.fulltext = st.fulltext || {};
      st.fulltext[p.id] = { decision: 'include', reason: '', at: new Date().toISOString(), by: 'folder', via: 'folder' };
      (st.screeningLog ||= []).push({ action: 'decide', stage: 'ft', id: p.id, decision: 'include', reason: '', by: 'folder', via: 'folder', at: new Date().toISOString() });
    }
    return st;
  });
  return `${hit.paper ? 'Attached to' : 'Added as'} ${paper.label || paper.title}${included ? `, study ${f.study.no}` : ''}${hit.duplicates ? ` (${hit.duplicates} copies in Library)` : ''}`;
}

/** A screening sheet's decisions into the review: matched by DOI or title, new rows added as records, decided records left as they are. */
async function importScreening(f, folder, quiet) {
  const { rows, sheet } = await tableRows(folder, f.path, f.sheet);
  const cols = screeningColumns(headerRow(rows).cells);
  const list = screeningRows(rows, cols);
  if (!list.length) return 'No rows with a title or DOI';
  const s = get();
  if (isDual(s)) return 'Needs single screening: turn off dual screening to import decisions';
  const plan = list.map(r => ({ r, paper: matchRecord(r, s.papers || []) }));
  const fresh = plan.filter(x => !x.paper).length;
  const decided = plan.filter(x => x.paper && finalDecision(s, x.paper.id)).length;
  const counts = { include: 0, exclude: 0, uncertain: 0 };
  for (const x of plan) if (x.r.decision && !(x.paper && finalDecision(s, x.paper.id))) counts[x.r.decision]++;
  const header = headerRow(rows).cells;
  if (!quiet && !await confirmAsk(`Import ${baseName(f.path)}?`, { detail: `Sheet ${sheet}, decision column "${header[cols.decision] || 'none'}": ${list.length} rows, ${fresh} new records, ${counts.include} include, ${counts.exclude} exclude, ${counts.uncertain} uncertain. ${decided} records already decided are left as they are.`, confirm: 'Import' })) return 'Cancelled';
  const at = new Date().toISOString();
  let added = 0, n = 0;
  update(st => {
    st.screening = st.screening || {};
    st.screeningLog = st.screeningLog || [];
    for (const { r, paper } of plan) {
      let p = paper;
      if (!p) {
        const id = `sheet-${Math.random().toString(36).slice(2, 10)}`;
        p = { id, key: r.doi ? `doi:${r.doi}` : id, title: r.title, authors: r.authors ? r.authors.split(/;\s*|,\s+(?=[A-Z][a-z]+\s+[A-Z])/).map(a => a.trim()).filter(Boolean) : [],
          year: r.year, doi: r.doi, pmid: r.pmid, source: 'sheet', pdf: null, label: '' };
        const fam = String(p.authors[0] || '').split(/[\s,]+/)[0];
        p.label = `${fam || p.title.split(/\s+/)[0]} ${p.year}`.trim();
        if (st.papers.some(x => x.key === p.key)) continue;
        st.papers.push(p); added++;
      }
      if (!r.decision || st.screening[p.id] || st.fulltext?.[p.id]) continue;
      const reason = r.decision === 'exclude' ? (r.reason || 'Excluded in the screening sheet') : '';
      st.screening[p.id] = { decision: r.decision, reason, at, by: 'sheet', via: 'folder' };
      st.screeningLog.push({ action: 'decide', stage: 'ta', id: p.id, decision: r.decision, reason, by: 'sheet', via: 'folder', at });
      n++;
    }
    return st;
  });
  await persist();
  return `${n} decisions, ${added} new records`;
}

async function importCriteriaSheet(f, folder, sheet) {
  const { rows } = await tableRows(folder, f.path, sheet);
  const list = criteriaRows(rows);
  if (!list.length) return 'No criteria in that sheet';
  const before = get().protocol?.criteria?.length || 0;
  if (!await confirmAsk(`Add ${list.length} criteria?`, { detail: `From sheet ${sheet} of ${baseName(f.path)}. Criteria already in the protocol with the same text are kept once.`, confirm: 'Add' })) return 'Cancelled';
  update(s => { const p = s.protocol || { title: '', pico: {}, criteria: [] }; s.protocol = { ...p, criteria: mergeRules(p.criteria || [], list) }; return s; });
  return `${(get().protocol.criteria.length - before)} criteria added`;
}

/** Criteria written as prose: the writing model proposes rules, and nothing changes until they are accepted. */
async function importCriteriaText(f, folder) {
  const cfg = modelFor('write');
  if (!configured(cfg)) return 'Needs a writing model (Settings › Models)';
  const { fileText } = await import('../lib/filetext.mjs');
  const text = (await fileText(f.name, await folder.read(f.path))).text;
  const { rules } = await structureCriteria(text, cfg);
  if (!rules.length) return 'No criteria found';
  const ok = await planDialog({ id: 'proposed-criteria', title: `${plural(rules.length, 'criterion', 'criteria')} proposed`, confirm: 'Accept', cancel: 'Discard',
    body: `<table class="ask-table"><thead><tr><th>Kind</th><th>Criterion</th><th>Stage</th></tr></thead><tbody>${rules.map(r => `<tr><td>${esc(r.kind)}</td><td>${esc(r.text)}</td><td>${esc(r.stage)}</td></tr>`).join('')}</tbody></table>` });
  if (!ok) return 'Cancelled';
  update(s => { const p = s.protocol || { title: '', pico: {}, criteria: [] }; s.protocol = { ...p, criteria: mergeRules(p.criteria || [], rules) }; return s; });
  return `${rules.length} criteria proposed and accepted`;
}

async function importPatients(f, folder, quiet = false) {
  const { rows, sheet } = await tableRows(folder, f.path, f.sheet);
  if (f.role === 'ipd-list') return importIpdList(f, rows, sheet, quiet, folder);
  const { index } = headerRow(rows);
  if (index < 0) return 'No header row';
  const { added, columns } = ipd.fromCsv(writeDelimited(rows.slice(index), {}));
  return `${added} patients${columns ? `, ${columns} new columns` : ''}`;
}

/** A master list: patients with the review's decision on every row. One confirmation says what it will add and what it leaves. */
async function importIpdList(f, rows, sheet, quiet, folder = null) {
  const plan = ipdListFromRows(rows, { file: f.path, sheet });
  if (!plan.ok) return `Could not read it: ${plan.reason}`;
  const s = get();
  const idx = libraryIndex(s.papers || []);
  const decided = plan.records.filter(r => { const p = idx.find(r); return p && (s.fulltext?.[p.id] || s.screening?.[p.id]?.decision === 'exclude'); }).length;
  const c = plan.counts;
  if (!quiet && !await confirmAsk(`Import ${baseName(f.path)}?`, { detail: `Sheet ${sheet}: ${c.patients} patients from ${c.included} reports${c.institutional ? ' and the institutional case' : ''}, and a decision on ${c.reports} reports (${c.included} include, ${c.excluded} exclude, recorded at full text). ${decided ? `${decided} reports already decided are left as they are. ` : ''}${s.participants?.length && !s.participants.some(p => p.src?.file === f.path) ? `The ${s.participants.length} patients already entered are kept. ` : ''}${plan.notes.length ? `Not read: ${plan.notes.join('; ')}.` : ''}`, confirm: 'Import' })) return 'Cancelled';
  let r;
  update(st => { r = applyIpdList(st, plan); return st; });
  await persist();
  // What the list held, cell by cell, for the check against the file later (plan §4.15d); a record that cannot be written does not undo the import.
  await adoptFromFolder(folder, [r.adoption]).catch(() => {});
  return `${r.patients} patients, ${r.records.created} new records, ${r.decisions.included + r.decisions.excluded} decisions${r.decisions.kept ? ` (${r.decisions.kept} already decided, kept)` : ''}`;
}

/** The works a manuscript cites, saved from a reference manager: added to the library as references, never as a search. */
async function importReferenceList(f, folder) {
  const { records } = parseRecords(new TextDecoder().decode(await folder.read(f.path)), f.name);
  if (!records.length) return 'No records read';
  const r = importReferences(get(), records, f.name);
  update(st => { importReferences(st, records, f.name, { at: new Date().toISOString() }); return st; });
  return `${r.added} added, ${r.matched} already in the library${r.filled ? `, ${r.filled} fields filled` : ''}; not counted as a search`;
}

/** A saved search strategy (a text file) as a search-log entry, dated by the file. */
async function addSearchLog(f, folder) {
  const text = new TextDecoder().decode(await folder.read(f.path)).trim();
  if (!text) return 'Nothing in the file';
  const source = /pubmed|medline/i.test(f.name) ? 'PubMed' : /scopus/i.test(f.name) ? 'Scopus' : /web.?of.?science|wos/i.test(f.name) ? 'Web of Science'
    : /embase/i.test(f.name) ? 'Embase' : /cochrane|central/i.test(f.name) ? 'Cochrane' : f.name.replace(/\.[^.]+$/, '');
  const st = await folder.stat(f.path);
  update(s => {
    s.searches = [...(s.searches || []), { source, kind: 'database', query: text.slice(0, 4000), at: new Date(st.mtime || Date.now()).toISOString(), status: 'complete', imported: true, file: f.path }];
    return s;
  });
  return `Added to the search log as ${source}`;
}

export function navigationState() { return {}; }
export function assistContext() { return { view: 'folder', files: scan?.files?.length || 0 }; }

// ---- workflow history ----------------------------------------------------------------
// Offered while the project has recorded work (searches, screening runs) and no workflows set up from it.
function historyOffered() {
  const s = get();
  return !hasHistoryWorkflows(s) && ((s.searches || []).length > 0 || (s.jevRuns || []).length > 0 || (s.screeningLog || []).length > 0);
}
async function setUpWorkflows(ctx, folder) {
  busy.add('workflows'); ctx.rerender();
  try {
    const current = f => !/(^|\/)Old versions\//i.test(f.path);
    const entries = (scan?.entries || []).filter(e => !e.dir && current(e));
    // the notes a search leaves (query files, export and import logs) and the folder guide are read; other files give their times
    const texts = entries.filter(e => /\.txt$/i.test(e.path) && e.size < 64 * 1024).slice(0, 60).concat(entries.filter(e => e.path === GUIDE));
    const read = new Map();
    for (const e of texts) read.set(e.path, new TextDecoder().decode(await folder.read(e.path)));
    const files = entries.map(e => ({ path: e.path, mtime: e.mtime, ...(read.has(e.path) ? { text: read.get(e.path) } : {}) }));
    const book = get().folderInit?.files?.['evidence sources'] || entries.find(e => /with[_ ]sources\.xlsx$/i.test(e.path))?.path;
    let revisionRows = [];
    if (book && entries.some(e => e.path === book)) {
      const t = await tableRows(folder, book);
      revisionRows = t.workbook?.sheets.find(x => x.rows.some(r => /^Round\s+\d+/i.test(String(r[0] || ''))))?.rows || [];
    }
    const set = buildHistorySet(get(), { files, revisionRows });
    if (!set.workflows.length) { notes.workflows = 'Nothing in this project to set up workflows from'; return; }
    if (!await confirmAsk(`Set up ${set.workflows.length} workflows?`, { detail: `${set.workflows.map(f => f.name).join(', ')}. ${set.runs.length} earlier runs are added as imported history.`, confirm: 'Set up' })) return;
    let added;
    update(s => { added = applyHistorySet(s, set); return s; });
    await persist();
    notes.workflows = `${added.workflows} workflows set up · ${added.runs} imported runs`;
  } catch (err) { notes.workflows = err.message; }
  finally { busy.delete('workflows'); ctx.rerender(); }
}
// ---- end workflow history ----
