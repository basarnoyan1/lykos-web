import { REGISTRY } from './registry.mjs';
import { showMenu } from '../lib/menu.mjs';
import { bindSaveFeedback } from '../lib/save-feedback.mjs';
import { editHistory } from '../lib/edit-history.mjs';
import { noteTags, selectNotes, formatNote, checkpointNote, restoreNoteVersion } from '../lib/note-editor.mjs';
import { markdownDocument } from '../lib/markdown-doc.mjs';
import { saveFile } from '../lib/save.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { ask, askText, confirmAsk } from '../lib/dialog.mjs';
import { findBarSpec } from '../lib/ui-recipes.mjs';
import { askRecord } from '../lib/record-picker.mjs';
import { dateValue, parseDate, wireDateField } from '../lib/date-picker.mjs';
import { openStudy, studySection } from '../lib/study.mjs';
import { settings } from '../lib/model-settings.mjs';
import { allTemplates, needsPaper, noteFromTemplate, normaliseNotes, titleOf, BUILT_IN_TEMPLATES } from '../lib/note-templates.mjs';
import { entryFor, byWeek, normaliseJournal } from '../lib/journal.mjs';
import { READING_STATUSES, READING_PRIORITIES, readingRows, readingOf, setReading } from '../lib/reading.mjs';
import { completeFileNote } from '../lib/file-notes.mjs';
import { uiBar, uiGroup, uiList, uiRow, uiRowEnd, uiRegion, regionShow } from '../lib/ui-actions.mjs';
import { unchecked, checkedStamp } from '../lib/progress.mjs';
import { uiLink, formField } from '../lib/ui-components.mjs';
import { day, when, plural } from '../lib/dates.mjs';

// Notes: the shell's collection-and-detail page (docs/UI_Guidelines.md, Page templates). Five sections, picked from the title bar's title:
//
//   Notes         Markdown notes of the project (state.projectNotes), from a blank page or a template (lib/note-templates.mjs)
//   Journal       one entry a day unless several are allowed, listed by week (lib/journal.mjs)
//   Reading list  papers set aside from the Library, read here (lib/reading.mjs)
//   Templates     the researcher's own note templates (state.noteTemplates), each a document in the same column; New note offers them
//   Source notes  notes tied to a source: a place in a study (state.notes: quotations, paraphrases, interpretations, some written by a
//                 model and not yet checked) and a selection in a file (state.fileNotes), grouped To check, Studies, Files
//
// The shell owns the list pane (list, select, selected), its Back and grip, the inspector (inspect) and the title bar (actions,
// titleMenu, heading). This view owns the document only: nothing above the text, one strip below it (the note's save state, its
// formatting, Preview, More), the find bar swapped into that strip's place. The page is a column that does not scroll: head,
// document, foot, with the text box the one scroller, so the foot is always on screen (plan §12.1; docs/design-review-2026-10-05).
export const meta = { title: 'Notes', icon: 'note', layout: 'flush' };
export const SECTIONS = [['notes', 'Notes'], ['journal', 'Journal'], ['reading', 'Reading list'], ['templates', 'Templates'], ['sources', 'Source notes']];
const labelOf = key => SECTIONS.find(([k]) => k === key)?.[1] || 'Notes';
const PLACEHOLDER = { notes: 'Search notes and tags', journal: 'Search the journal', reading: 'Filter reading list', templates: 'Search templates', sources: 'Search notes and files' };

let section = 'notes';
const pick = { notes: null, journal: null, reading: null, templates: null, sources: null };
const queries = { notes: '', journal: '', reading: '', templates: '', sources: '' };
let noteMode = 'edit', noteFilter = 'active', noteSort = 'updated', noteFocus = false, findOpen = false;
let sourcePaperId = null;
let readShowRead = false, readPriority = 'any', sourceShow = 'all';
let shell = null, titleRerender = null, filterHost = null, filterRefresh = null;
let disposeSave = () => {}, disposeKeys = () => {}, focusNext = '', detailsTimer = 0;
let historyGeneration = -1;
const histories = new Map();
const editorPlaces = new Map();
export function unmount() { disposeSave(); disposeSave = () => {}; disposeKeys(); disposeKeys = () => {}; clearTimeout(detailsTimer); }

const done = (s, n) => n.todoId ? s.todos?.find(t => t.id === n.todoId)?.done ?? n.done : n.done;   // the same rule as noteDone in registry.mjs (view-registry.test.mjs)
export const count = (...a) => REGISTRY.notes.count(...a);
const labelOfPaper = p => p.label || p.title || p.id;
const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const redo = msg => (shell?.rerender || titleRerender)?.(msg);

/** A project switch starts every section afresh: nothing carries a note id, a query or an undo stack from the project before. */
function sync() {
  if (historyGeneration === projectGeneration()) return;
  historyGeneration = projectGeneration();
  histories.clear(); editorPlaces.clear(); sourcePaperId = null;
  for (const k of Object.keys(pick)) { pick[k] = null; queries[k] = ''; }
  noteMode = 'edit'; noteFilter = 'active'; findOpen = false;
}

/** The title bar's name for the page: the section shown. */
export const heading = () => labelOf(section);
export const tab = () => section;
/** Opens Notes at one of its sections: 'notes', 'journal', 'reading', 'sources'. 'files' and 'reading-notes' (the older names) are Source notes; 'reading-notes' lands on the first note still to check. */
export function showTab(t) {
  const key = t === 'files' || t === 'reading-notes' ? 'sources' : t;
  if (!SECTIONS.some(([k]) => k === key)) return;
  sync(); sourcePaperId = null; section = key; findOpen = false;
  if (t === 'reading-notes') {
    sourceShow = 'all'; queries.sources = '';
    const first = (get().notes || []).filter(unchecked).sort(newest)[0];
    if (first) pick.sources = first.id;
  }
}
/** Opens a note by id in Notes › Notes. */
export function showNote(id) { sync(); section = 'notes'; pick.notes = id; noteMode = 'edit'; noteFilter = 'active'; queries.notes = ''; findOpen = false; }
export const openList = () => { noteFocus = false; };

// ---- the list pane ------------------------------------------------------------------------------------------------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Wednesday 7 October" for a YYYY-MM-DD day, the same on every machine. */
export function longDay(date) { const d = parseDate(date); return d ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : String(date || ''); }
const group = (id, title) => ({ id: `g-${id}`, group: true, title });
const newest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
const matches = (text, query) => !query.trim() || query.toLowerCase().trim().split(/\s+/).every(w => String(text).toLowerCase().includes(w));

/** What a note says, as one line for its list row: no headings (the title is the first), list marks or emphasis. */
export const noteExcerpt = text => String(text || '').split('\n').filter(l => !/^\s*#{1,6}\s/.test(l)).join(' ')
  .replace(/\[[ xX]\]/g, '').replace(/(^|\s)[-*+]\s/g, '$1').replace(/[*_#|>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

/** Notes: Pinned and Notes groups when anything is pinned; the Show filter names its one group. */
export function noteItems(s, { query = '', filter = 'active', sort = 'updated' } = {}) {
  const shown = selectNotes(normaliseNotes(s.projectNotes), { query, filter, sort });
  const row = n => ({ id: n.id, title: n.title, sub: noteExcerpt(n.text) || 'Empty note', meta: day(n.updated || n.at), mark: noteTags(n.tags).map(t => `#${t}`).join(' ') });
  if (filter !== 'active') return shown.length ? [group(filter, { pinned: 'Pinned', archive: 'Archived', trash: 'Trash' }[filter]), ...shown.map(row)] : [];
  const pinned = shown.filter(n => n.pinned), rest = shown.filter(n => !n.pinned);
  return pinned.length && rest.length ? [group('pinned', 'Pinned'), ...pinned.map(row), group('notes', 'Notes'), ...rest.map(row)]
    : pinned.length ? [group('pinned', 'Pinned'), ...pinned.map(row)] : rest.map(row);
}

/** Journal: one group per ISO week, newest first. */
export function journalItems(s, { query = '' } = {}) {
  const today = dateValue(new Date()), out = [];
  for (const w of byWeek(s.journal)) {
    const rows = w.entries.filter(e => matches(`${longDay(e.date)} ${e.text}`, query));
    if (!rows.length) continue;
    out.push(group(w.key, w.label), ...rows.map(e => ({ id: e.id, title: longDay(e.date), sub: e.text.split('\n').find(l => l.trim())?.trim() || 'No text', meta: e.date === today ? 'Today' : '' })));
  }
  return out;
}

/** "Smith 2024 · A. Smith, B. Jones et al.": the label, the first two authors, and the year when the label does not already say it. */
const citationLine = p => { const a = (p.authors || []).map(x => typeof x === 'string' ? x : x?.name || '').filter(Boolean); return [p.label, `${a.slice(0, 2).join(', ')}${a.length > 2 ? ' et al.' : ''}`, p.year && !String(p.label || '').includes(String(p.year)) ? p.year : ''].filter(Boolean).join(' · '); };
const PRIORITY_WORD = { high: 'High', low: 'Low' };
/** Reading list: Reading and To read groups (Read too when it is shown), each with its count. */
export function readingItems(s, { showRead = false, priority = 'any', query = '' } = {}) {
  const rows = readingRows(s, { status: showRead ? 'all' : 'open', priority, text: query }), out = [];
  for (const [key, label] of [['reading', 'Reading'], ['to-read', 'To read'], ['read', 'Read']]) {
    const mine = rows.filter(r => r.entry.status === key);
    if (mine.length) out.push(group(key, `${label} · ${mine.length}`), ...mine.map(({ paper: p, entry: e }) => ({ id: p.id, title: p.title || p.label || 'Untitled reference', sub: e.reason || citationLine(p), meta: PRIORITY_WORD[e.priority] || '' })));
  }
  return out;
}

// Reading notes: the reader's annotations on papers (s.notes), some written by a model and not yet checked. Unchecked ones lead, then the newest.
const READING_NOTE_KIND = { quote: 'Quotation', paraphrase: 'Paraphrase', comment: 'Interpretation' };
export const sortedReadingNotes = s => (s.notes || []).slice().sort((a, b) => (unchecked(b) - unchecked(a)) || newest(a, b));
const anchorOf = n => n.anchor?.quote ? `“${n.anchor.quote.slice(0, 160)}”` : n.anchor?.kind === 'cells' ? `${n.anchor.sheet} · ${n.anchor.selection}` : '';
const paperOf = (s, n) => n.paper && (s.papers || []).find(p => p.id === n.paper);

/** Source notes, in the three groups: To check (a model wrote it, nobody has checked it), Studies, Files. `show` narrows them: all, check, open, done. */
export function sourceItems(s, { query = '', show = 'all' } = {}) {
  const study = sortedReadingNotes(s).filter(n => !sourcePaperId || n.paper === sourcePaperId), files = sourcePaperId ? [] : (s.fileNotes || []).filter(n => !n.archived).sort(newest);
  const toCheck = study.filter(unchecked), checked = study.filter(n => !unchecked(n));
  const open = files.filter(n => !done(s, n)), resolved = files.filter(n => done(s, n));
  const sets = { all: [toCheck, checked, [...open, ...resolved]], check: [toCheck, [], []], open: [toCheck, [], open], done: [[], checked, resolved] }[show] || [toCheck, checked, files];
  const studyRow = n => { const p = paperOf(s, n); return { id: n.id, title: n.text, sub: [p ? labelOfPaper(p) : 'Project', n.page ? `p. ${n.page}` : '', READING_NOTE_KIND[n.kind] || 'Note'].filter(Boolean).join(' · '), meta: day(n.at), mark: unchecked(n) ? 'Model, unchecked' : '' }; };
  const fileRow = n => ({ id: n.id, title: n.text, sub: [n.source?.label, n.anchor?.kind === 'cells' ? `${n.anchor.sheet} · ${n.anchor.selection}` : n.anchor?.quote ? `“${n.anchor.quote.slice(0, 60)}”` : ''].filter(Boolean).join(' · '), meta: day(n.at), mark: done(s, n) ? 'Resolved' : n.todoId ? 'Edit TODO' : '' });
  const fits = (text, n) => matches(`${n.text} ${text}`, query);
  const rows = [['check', 'To check', sets[0].filter(n => fits(paperOf(s, n)?.label || '', n)), studyRow], ['studies', 'Studies', sets[1].filter(n => fits(paperOf(s, n)?.label || '', n)), studyRow],
    ['files', 'Files', sets[2].filter(n => fits(`${n.source?.label || ''} ${n.anchor?.quote || ''}`, n)), fileRow]];
  return rows.flatMap(([key, label, mine, row]) => mine.length ? [group(key, `${label} · ${mine.length}`), ...mine.map(row)] : []);
}

/** Templates: the researcher's own, by name. The built-in ones are offered by New note and are not edited. */
export function templateItems(s, { query = '' } = {}) {
  return (s.noteTemplates || []).filter(t => matches(`${t.name} ${t.body}`, query))
    .map(t => ({ id: t.id, title: t.name, sub: String(t.body || '').replace(/[#*_>`|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Empty template', meta: '' }));
}

const itemsFor = (s, key = section) => key === 'notes' ? noteItems(s, { query: queries.notes, filter: noteFilter, sort: noteSort })
  : key === 'journal' ? journalItems(s, { query: queries.journal })
  : key === 'reading' ? readingItems(s, { showRead: readShowRead, priority: readPriority, query: queries.reading })
  : key === 'templates' ? templateItems(s, { query: queries.templates })
  : sourceItems(s, { query: queries.sources, show: sourceShow });

function drawFilter() {
  if (!filterHost?.isConnected) return;
  filterHost.innerHTML = uiBar({ kind: 'tools', label: 'Find', id: 'nt-find-notes', actions: section === 'sources' && sourcePaperId ? [{ id: 'nt-all-papers', label: 'All papers' }] : [], filters: [{ type: 'search', id: 'nt-q', label: 'Search', placeholder: PLACEHOLDER[section], value: queries[section] }] });
  filterHost.querySelector('#nt-all-papers')?.addEventListener('click', () => { sourcePaperId = null; drawFilter(); settle(); });
  const q = filterHost.querySelector('#nt-q');
  q.oninput = () => { queries[section] = q.value; settle(); };
}
/** The list changed what it shows (a search, a filter): the shell redraws the rows, and the document too when the open item left them. */
function settle() {
  const before = pick[section];
  shell?.refreshList?.();
  if (shell && pick[section] !== before) shell.rerender();
}

export const list = {
  get title() { return labelOf(section); },
  rowHeight: 72,
  get empty() { const q = queries[section].trim(); return { notes: q ? 'No matching notes' : noteFilter === 'trash' ? 'Trash is empty' : 'No notes', journal: q ? 'No matching entries' : 'No entries yet', reading: q ? 'Nothing matches' : 'No papers on the reading list', templates: q ? 'No matching templates' : 'No templates of your own', sources: q ? 'No matching notes' : 'No source notes' }[section]; },
  filters(el, refresh) { filterHost = el; filterRefresh = refresh; drawFilter(); },
  items(s) { sync(); return itemsFor(s); },
};
export function openPaperNotes(id) { sync(); section = 'sources'; sourcePaperId = id; sourceShow = 'all'; queries.sources = ''; pick.sources = sortedReadingNotes(get()).find(n => n.paper === id)?.id || null; findOpen = false; }
export function select(id) { sync(); if (!String(id).startsWith('g-')) { pick[section] = id; findOpen = false; } }
export function selected() { sync(); return pick[section]; }

/** The title bar's title is the section pick. */
export function titleMenu(anchor) {
  showMenu(anchor, SECTIONS.map(([key, label]) => ({ label, checked: key === section, run: () => setSection(key) })), { align: 'start', minWidth: 180 });
}
function setSection(key) {
  if (key === section) return;
  sourcePaperId = null; section = key; findOpen = false; drawFilter();
  shell?.showList?.();
  redo();
}

// ---- the title bar ------------------------------------------------------------------------------------------------
const toggle = (id, label, checked, run) => ({ id, label, kind: 'toggle', checked, run });
/** The title bar (lib/topbar.mjs): the section as a picker title, and the section's own commands. */
export function page(rerender) {
  titleRerender = rerender; sync();
  return { title: labelOf(section), titleMenu: a => titleMenu(a), ...sectionActs() };
}
/** The open note's own commands, from the title bar's More (the strip over the text holds the formatting and how the document is shown, not the note's commands). */
async function noteCommand(kind) {
  const id = pick.notes, generation = projectGeneration();
  const note = id && normaliseNotes(get().projectNotes).find(n => n.id === id); if (!note) return;
  const patch = values => { if (generation !== projectGeneration()) return; update(s => { const n = s.projectNotes?.find(x => x.id === id); if (n) Object.assign(n, values, { updated: new Date().toISOString() }); return s; }); };
  // the list picks the next note (wide) before the title bar is drawn, so its More names that note's commands
  const leave = () => { pick.notes = null; shell?.showList?.(); shell?.refreshList?.(); redo(); };
  if (kind === 'pin') { patch({ pinned: !note.pinned }); redo(); }
  else if (kind === 'rename') { const title = (await ask('Rename note', { value: note.title, confirm: 'Rename' }))?.trim(); if (title) { patch({ title, customTitle: true }); redo(); } }
  else if (kind === 'duplicate') {
    const at = new Date().toISOString(), copy = { ...note, id: crypto.randomUUID(), title: `${note.title} (copy)`, customTitle: true, pinned: false, archived: false, deletedAt: null, versions: [], at, updated: at, tags: [...noteTags(note.tags)] };
    update(s => { s.projectNotes.push(copy); return s; });
    pick.notes = copy.id; noteFilter = 'active'; queries.notes = ''; drawFilter(); shell?.openItem?.(); redo();
  }
  else if (kind === 'export') await saveFile(note.text, `${note.title.replace(/[^a-z0-9 -]/gi, '').slice(0, 80) || 'note'}.md`, 'text/markdown');
  else if (kind === 'template') {
    const name = (await ask('Save as template', { value: note.title, placeholder: 'Template name', confirm: 'Save' }))?.trim(); if (!name || generation !== projectGeneration()) return;
    update(x => { x.noteTemplates = [...(x.noteTemplates || []), { id: `tpl${Date.now().toString(36)}`, name, body: note.text }]; return x; });
    redo(`Template ${name} saved`);
  }
  else if (kind === 'versions') shell?.openDetails?.();
  else if (kind === 'archive') { patch({ archived: !note.archived }); leave(); }
  else if (kind === 'restore') { patch({ deletedAt: null, archived: false }); noteFilter = 'active'; drawFilter(); redo(); }
  else if (kind === 'delete') {
    if (!await confirmAsk(`Move ${note.title} to trash?`, { confirm: 'Move to trash' })) return;
    patch({ deletedAt: new Date().toISOString() }); leave();
  }
}
function noteMenuItems() {
  const note = pick.notes && normaliseNotes(get().projectNotes).find(n => n.id === pick.notes); if (!note) return [];
  const item = (kind, label, extra = {}) => ({ id: `nt-cmd-${kind}`, label, run: () => noteCommand(kind), ...extra });
  return [item('pin', note.pinned ? 'Unpin note' : 'Pin note'), item('rename', 'Rename note'), item('duplicate', 'Duplicate note'), item('export', 'Export note'), item('template', 'Save as template'), item('versions', 'Version history'), '-',
    item('archive', note.archived ? 'Restore note' : 'Archive note'), ...(note.deletedAt ? [item('restore', 'Restore from trash')] : []), item('delete', 'Move note to trash', { danger: true }), '-'];
}
function sectionActs() {
  if (section === 'notes') return {
    actions: [{ id: 'nt-new', label: 'New note', icon: 'plus', menu: true, run: anchor => newMenu(anchor) }],
    overflow: [...noteMenuItems(), toggle('nt-sort-updated', 'Recently edited', noteSort === 'updated', () => { noteSort = 'updated'; redo(); }), toggle('nt-sort-title', 'Title A–Z', noteSort === 'title', () => { noteSort = 'title'; redo(); }), '-',
      ...[['active', 'All notes'], ['pinned', 'Pinned'], ['archive', 'Archived'], ['trash', 'Trash']].map(([k, l]) => toggle(`nt-show-${k}`, l, noteFilter === k, () => { noteFilter = k; pick.notes = null; shell?.refreshList?.(); redo(); }))] };
  if (section === 'journal') return {
    actions: [{ id: 'jr-today', label: 'Today', icon: 'calendar', run: () => openDay(dateValue(new Date())) }],
    overflow: [{ id: 'jr-weekly', label: 'Weekly progress note', run: () => createNote({ template: BUILT_IN_TEMPLATES.find(x => x.id === 'weekly') }) }, '-',
      toggle('jr-many', 'Allow multiple entries per day', !!get().journalMany, () => { update(x => { x.journalMany = !x.journalMany; return x; }); redo(); })] };
  if (section === 'templates') return { actions: [{ id: 'tpl-new', label: 'New template', icon: 'plus', run: () => newTemplate() }] };
  if (section === 'reading') return {
    overflow: [toggle('rd-show-read', 'Show read', readShowRead, () => { readShowRead = !readShowRead; redo(); }), '-',
      ...[['any', 'Any priority'], ['high', 'High'], ['low', 'Low'], ['none', 'No priority']].map(([k, l]) => toggle(`rd-priority-${k}`, l, readPriority === k, () => { readPriority = k; redo(); }))] };
  return { overflow: [['all', 'All'], ['check', 'To check'], ['open', 'Open'], ['done', 'Checked and resolved']].map(([k, l]) => toggle(`sn-show-${k}`, l, sourceShow === k, () => { sourceShow = k; redo(); })) };
}

/** The New note menu: a blank note, the templates, the researcher's own, and the manager. */
function newMenu(anchor) {
  const templates = allTemplates(get()), own = templates.filter(t => !t.builtIn);
  const template = t => ({ label: t.name, run: () => startTemplate(t) });
  showMenu(anchor, [{ label: 'Blank note', meta: '⌥⌘N', run: () => createNote() }, '-', ...templates.filter(t => t.builtIn).map(template), ...(own.length ? ['-', ...own.map(template)] : []), '-',
    { label: 'Manage templates', run: () => showTemplates() }], { align: 'end', minWidth: 220 });
}
async function startTemplate(t) {
  let paper = null;
  if (needsPaper(t.body)) {
    const id = await askRecord('Paper', { records: [...(get().papers || [])].sort((a, b) => String(labelOfPaper(a)).localeCompare(String(labelOfPaper(b)))) });
    paper = (get().papers || []).find(p => p.id === id);
    if (!paper) return;
  }
  createNote({ template: t, paper });
}
function createNote({ template = null, paper = null } = {}) {
  const s = get(), at = new Date().toISOString();
  let note, unknown = [], missing = [];
  if (template) ({ note, unknown, missing } = noteFromTemplate(template, { state: s, paper, author: settings().reviewerName, now: new Date() }));
  else note = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: 'Untitled note', text: '', template: '', at, updated: at };
  update(x => { x.projectNotes = [...normaliseNotes(x.projectNotes), note]; return x; });
  section = 'notes'; pick.notes = note.id; noteMode = 'edit'; noteFilter = 'active'; queries.notes = ''; findOpen = false; focusNext = '#nt-text';
  drawFilter(); shell?.openItem?.();
  const left = [...unknown, ...missing];
  redo(left.length ? `Not filled: ${left.map(v => `{{${v}}}`).join(' ')}` : undefined);
  return note;
}
/** A literature note for one paper: the one already linked to it, else a new one from the built-in template (the Library's reading entry points). */
export function literatureNote(paper) {
  sync();
  const existing = normaliseNotes(get().projectNotes).find(n => n.paperId === paper.id && n.template === 'literature' && !n.deletedAt);
  if (existing) { showNote(existing.id); return existing; }
  const { note } = noteFromTemplate(BUILT_IN_TEMPLATES.find(x => x.id === 'literature'), { state: get(), paper, author: settings().reviewerName, now: new Date() });
  update(x => { x.projectNotes = [...normaliseNotes(x.projectNotes), note]; return x; });
  showNote(note.id);
  return note;
}
/** A day chosen on the dateline: its newest entry, or a new one when the day has none (Today adds another when several a day are allowed). */
function showDay(date) {
  const mine = normaliseJournal(get().journal).filter(e => e.date === date).sort((a, b) => String(b.updated || b.at).localeCompare(String(a.updated || a.at)));
  if (!mine.length) return openDay(date);
  section = 'journal'; pick.journal = mine[0].id; queries.journal = ''; focusNext = '#jr-text'; drawFilter(); shell?.openItem?.(); redo();
}
function openDay(date) {
  let id = null;
  update(x => { const { entry } = entryFor(x, date); id = entry.id; return x; });
  section = 'journal'; pick.journal = id; queries.journal = ''; focusNext = '#jr-text'; drawFilter(); shell?.openItem?.(); redo();
}

/** Opens the Templates section (the New note menu's Manage templates). */
function showTemplates() { section = 'templates'; findOpen = false; drawFilter(); shell?.showList?.(); redo(); }
/** A new template of the researcher's own: named, then written in the document beside the list. */
async function newTemplate() {
  const generation = projectGeneration();
  const name = (await ask('New template', { placeholder: 'Template name', confirm: 'Create' }))?.trim();
  if (!name || generation !== projectGeneration()) return;
  const id = `tpl${Date.now().toString(36)}`;
  update(x => { x.noteTemplates = [...(x.noteTemplates || []), { id, name, body: '# {{date}}\n\n' }]; return x; });
  section = 'templates'; pick.templates = id; queries.templates = ''; focusNext = '#tpl-text';
  drawFilter(); shell?.openItem?.(); redo();
}

// ---- the document -------------------------------------------------------------------------------------------------
const FORMATS = [['undo', 'Undo', 'undo', '⌘Z'], ['redo', 'Redo', 'redo', '⇧⌘Z'], ['heading', 'Heading', 'heading'], ['bold', 'Bold', 'bold', '⌘B'], ['italic', 'Italic', 'italic', '⌘I'], ['link', 'Link', 'link', '⌘K'],
  ['bullet', 'Bulleted list', 'list-bullet'], ['task', 'Checklist', 'checklist'], ['quote', 'Quote', 'quote'], ['table', 'Table', 'table']];
/** The formatting groups of the foot strip: three icon groups, the last folding first (blocks, then text, then history). Drawn in the preview too, disabled: pressing Preview moves nothing. */
export function formatGroups(disabled = false) {
  const member = ([key, label, ico, kbd]) => ({ id: `nt-${key}`, label, icon: ico, kbd, disabled, attrs: { 'data-note-format': key } });
  const take = keys => FORMATS.filter(f => keys.includes(f[0])).map(member);
  return [uiGroup({ id: 'nt-history', label: 'History', fold: 3, items: take(['undo', 'redo']) }), uiGroup({ id: 'nt-text-group', label: 'Text', fold: 5, items: take(['heading', 'bold', 'italic', 'link']) }),
    uiGroup({ id: 'nt-blocks', label: 'Blocks', fold: 7, items: take(['bullet', 'task', 'quote', 'table']) })];
}

/** The note's document: the strip (with the find bar in its place) over the text, or the preview, or both, as the Manuscript's strip is over its page. */
export function noteDocument(note, { mode = noteMode, focus = noteFocus } = {}) {
  const foot = uiBar({ kind: 'strip', label: 'Note', id: 'nt-foot', density: 'dense', status: { id: 'nt-save-status', text: plural(words(note.text), 'word'), ch: 20 },   // the words; the status bar owns Saved
    budget: { n: 5, reason: 'three formatting groups, the preview toggle and the reserved Retry save' },
    actions: [{ id: 'nt-save-retry', label: 'Retry save', icon: 'refresh', role: 'quiet', presence: 'reserve', fold: 9, hidden: true }, ...formatGroups(mode === 'preview'), { id: 'nt-preview', label: 'Preview', icon: 'preview', role: 'quiet', keep: true, kbd: '⇧⌘P', pressed: mode !== 'edit' }],
    // the strip's More holds how the document is shown; the note's own commands are the title bar's More (noteMenuItems)
    overflow: [{ id: 'nt-split', label: 'Split view', kind: 'toggle', checked: mode === 'split' }, { id: 'nt-focus', label: 'Focus', kind: 'toggle', checked: focus }, { id: 'nt-find-open', label: 'Find in note' }, '-', { id: 'nt-ask', label: 'Ask about this', attrs: { 'data-ask-about': 'note-selection' } }] });
  const find = uiBar(findBarSpec({ id: 'nt-find', label: 'Find in note', field: 'nt-find', count: 'nt-find-status', ch: 12, steps: { prevKbd: '⇧↵', nextKbd: '↵' } }));
  return `<section class="nt-page" data-section="notes"><div class="nt-above">${uiRegion({ id: 'nt-foot-region', label: 'Note status', bars: [foot, find], active: 0 })}</div><div class="nt-body"${mode === 'split' ? ' data-split' : ''}>`
    + (mode !== 'preview' ? `<div class="nt-doc"><textarea id="nt-text" class="nt-text" data-note-editor-id="${esc(note.id)}" aria-label="Note" spellcheck="true" placeholder="Start writing">${esc(note.text)}</textarea></div>` : '')
    + (mode !== 'edit' ? `<div class="nt-preview">${markdownDocument(note.text)}</div>` : '')
    + `</div></section>`;
}

/** The dateline of the journal: the day as a field (its calendar opens another day), the weekday and "Today" after it. */
const weekday = date => { const d = parseDate(date); return d ? WEEKDAYS[d.getDay()] : ''; };
const dayText = (date, today) => [weekday(date), date && date === today ? 'Today' : ''].filter(Boolean).join(' · ');
function journalHead(date, today, overflow = [], count = '') {
  return uiBar({ kind: 'head', label: 'Entry', id: 'jr-head', density: 'dense', filters: [{ type: 'date', id: 'jr-day', label: 'Day', value: date }],
    message: { ...(count ? { id: 'jr-save-status' } : {}), text: [dayText(date, today), count].filter(Boolean).join(' · ') }, overflow });
}

/** The journal entry: a dateline head (the day, its weekday and the words), then the text. */
export function journalDocument(entry, today = dateValue(new Date())) {
  const head = journalHead(entry.date, today, [{ id: 'jr-del', label: 'Delete entry', danger: true }], plural(words(entry.text), 'word'));
  return `<section class="nt-page" data-section="journal"><div class="nt-above">${head}</div><div class="nt-body"><div class="nt-doc"><textarea id="jr-text" class="nt-text" data-entry-text="${esc(entry.id)}" aria-label="Journal entry" spellcheck="true" placeholder="What happened today">${esc(entry.text)}</textarea></div></div></section>`;
}
/** No entry open: the dateline alone over the empty state, so a day can still be chosen. */
export const journalEmpty = (today = dateValue(new Date())) => `<section class="nt-page" data-section="journal"><div class="nt-above">${journalHead('', today)}</div><div class="nt-body">${emptyState({ icon: 'calendar', title: 'No entry selected' })}</div></section>`;

/** A template of the researcher's: its name over the text, Use as the head's act, Rename and Delete in its More. */
export function templateDocument(t) {
  const head = uiBar({ kind: 'head', label: 'Template', id: 'tpl-head', density: 'dense', lead: { title: t.name, level: 'h2' }, message: { id: 'tpl-save-status', text: plural(words(t.body), 'word') },
    actions: [{ id: 'tpl-use', label: 'New note', icon: 'note' }], overflow: [{ id: 'tpl-rename', label: 'Rename' }, { id: 'tpl-delete', label: 'Delete template', danger: true }] });
  return `<section class="nt-page" data-section="templates"><div class="nt-above">${head}</div><div class="nt-body"><div class="nt-doc"><textarea id="tpl-text" class="nt-text" data-template-text="${esc(t.id)}" aria-label="Template" spellcheck="true" placeholder="Write the template. Variables go in double braces, as {{date}}">${esc(t.body)}</textarea></div></div></section>`;
}

const opt = (pairs, value) => pairs.map(([k, l]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(l)}</option>`).join('');
/** A reading-list paper: its title and citation, its commands, and the three things set about it. */
export function readingCard(p, e) {
  const tools = uiBar({ kind: 'tools', label: 'Reading', id: 'rd-tools', actions: [{ id: 'rd-open', label: 'Open record', icon: 'open' }, { id: 'rd-note', label: 'Literature note', icon: 'note', role: 'primary' }],
    overflow: [{ id: 'rd-remove', label: 'Remove from reading list', danger: true }] });
  return `<section class="nt-page" data-card data-section="reading"><div class="nt-card"><h2 class="nt-title">${esc(p.title || p.label || 'Untitled reference')}</h2><p class="meta nt-meta">${esc(citationLine(p))}</p>${tools}
    <div class="an-settings">${formField('Status', `<select id="rd-card-status" aria-label="Reading status">${opt(READING_STATUSES, e.status)}</select>`)}${formField('Priority', `<select id="rd-card-priority" aria-label="Priority">${opt(READING_PRIORITIES, e.priority)}</select>`)}${formField('Why read it', `<input id="rd-card-why" maxlength="280" value="${esc(e.reason)}" aria-label="Why read it">`)}</div></div></section>`;
}

/** A source note: where it points (a file, a study page), what it says, and the one state it has (to check, open, resolved). */
export function sourceCard(s, n) {
  const file = !!n.source, p = file ? null : paperOf(s, n), isDone = file && done(s, n), kind = READING_NOTE_KIND[n.kind] || n.kind || 'Note';
  const meta = file ? [n.todoId ? 'Edit TODO' : 'Note', day(n.at), n.anchor?.kind === 'cells' ? `sheet ${n.anchor.sheet}, cells ${n.anchor.selection}` : ''].filter(Boolean).join(' · ')
    : [kind, n.page ? `page ${n.page}` : '', day(n.at), unchecked(n) ? 'written by the model, not checked' : ''].filter(Boolean).join(' · ');
  const quote = file ? (n.anchor?.quote ? `“${n.anchor.quote}”` : n.anchor?.kind === 'cells' ? n.anchor.selection : '') : n.kind === 'quote' ? n.text : '';
  const tools = file
    ? uiBar({ kind: 'tools', label: 'Source note', id: 'sn-tools', actions: [{ id: 'sn-state', label: isDone ? 'Reopen' : 'Resolve', icon: isDone ? 'undo' : 'check' }, { id: 'sn-go', label: 'Go to selection', icon: 'open', role: 'primary' }],
      overflow: [{ id: 'sn-edit', label: 'Edit note' }, { id: 'sn-remove', label: 'Remove note', danger: true }] })
    : uiBar({ kind: 'tools', label: 'Source note', id: 'sn-tools', actions: [...(unchecked(n) ? [{ id: 'sn-state', label: 'Mark checked', icon: 'check' }] : []), ...(p ? [{ id: 'sn-go', label: 'Open page', icon: 'open', role: 'primary' }] : [])],
      overflow: [{ id: 'sn-remove', label: 'Remove note', danger: true }] });
  return `<section class="nt-page" data-card data-section="sources"><div class="nt-card"><h2 class="nt-title">${esc(file ? n.source.label : p ? labelOfPaper(p) : 'Project')}</h2><p class="meta nt-meta">${esc(meta)}</p>${tools}
    ${quote ? `<p class="nt-quote">${esc(quote)}</p>` : ''}${file || n.kind !== 'quote' ? `<p class="nt-text-block">${esc(n.text)}</p>` : ''}</div></section>`;
}

// ---- render -------------------------------------------------------------------------------------------------------
export function render(el, ctx) {
  shell = ctx; el.classList.add('flush');   // the shell sets the layout class; a page that hosts the view without it (the component fixture) still gets the column
  const previousEditor = el.querySelector('#nt-text');
  if (previousEditor && historyGeneration === projectGeneration()) editorPlaces.set(previousEditor.dataset.noteEditorId, { start: previousEditor.selectionStart, end: previousEditor.selectionEnd, scroll: previousEditor.scrollTop });
  unmount(); sync();
  const s = get();
  let focusing = false;
  if (section === 'notes') {
    const note = normaliseNotes(s.projectNotes).find(n => n.id === pick.notes);
    if (note) { el.innerHTML = noteDocument(note); wireNote(el, note); focusing = noteFocus; }
    else el.innerHTML = `<section class="nt-page" data-card>${emptyState({ icon: 'note', title: queries.notes.trim() ? 'No matching notes' : normaliseNotes(s.projectNotes).length ? 'No note selected' : 'No notes' })}</section>`;
  } else if (section === 'journal') {
    const entry = normaliseJournal(s.journal).find(e => e.id === pick.journal);
    if (entry) { el.innerHTML = journalDocument(entry); wireJournal(el, entry); }
    else { el.innerHTML = journalEmpty(); wireDay(el); }
  } else if (section === 'templates') {
    const t = (s.noteTemplates || []).find(x => x.id === pick.templates);
    if (t) { el.innerHTML = templateDocument(t); wireTemplate(el, t); }
    else el.innerHTML = `<section class="nt-page" data-card>${emptyState({ icon: 'note', title: (s.noteTemplates || []).length ? 'No template selected' : 'No templates of your own' })}</section>`;
  } else if (section === 'reading') {
    const p = (s.papers || []).find(x => x.id === pick.reading), e = p && readingOf(s, p.id);
    if (p && e) { el.innerHTML = readingCard(p, e); wireReading(el, p); }
    else el.innerHTML = `<section class="nt-page" data-card>${emptyState({ icon: 'book', title: 'No paper selected' })}</section>`;
  } else {
    const n = sourceNoteById(s, pick.sources);
    if (n) { el.innerHTML = sourceCard(s, n); wireSource(el, n); }
    else el.innerHTML = `<section class="nt-page" data-card>${emptyState({ icon: 'note', title: 'No note selected' })}</section>`;
  }
  ctx.focus?.(focusing);
  bindDocumentKeys(el);
  if (focusNext) { const target = el.querySelector(focusNext); focusNext = ''; target?.focus(); }
}
const sourceNoteById = (s, id) => id && ((s.notes || []).find(n => n.id === id) || (s.fileNotes || []).find(n => n.id === id)) || null;

/** The keys of the page that are not the text box's: a new blank note, the list's search, Preview, Focus. They go when the page does. */
function bindDocumentKeys(el) {
  const onKey = e => {
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    // with Option held the key names another character: the physical key says which was pressed
    if (mod && e.altKey && e.code === 'KeyN' && section === 'notes') { e.preventDefault(); createNote(); }
    else if (mod && e.altKey && e.code === 'KeyF') { e.preventDefault(); noteFocus = false; shell?.showList?.(); redo(); setTimeout(() => document.querySelector('#nt-q')?.focus(), 60); }
    else if (mod && e.shiftKey && key === 'p' && section === 'notes' && el.querySelector('#nt-preview')) { e.preventDefault(); el.querySelector('#nt-preview').click(); }
    else if (mod && e.shiftKey && key === 'd' && section === 'notes' && el.querySelector('#nt-focus')) { e.preventDefault(); el.querySelector('#nt-focus').click(); }
  };
  document.addEventListener('keydown', onKey);
  disposeKeys = () => document.removeEventListener('keydown', onKey);
}

// ---- wiring: a note -----------------------------------------------------------------------------------------------
function wireNote(el, note) {
  const id = note.id, generation = projectGeneration();
  const ta = el.querySelector('#nt-text'), region = el.querySelector('#nt-foot-region');
  const wordsNow = () => plural(words(ta ? ta.value : note.text), 'word');
  const feedback = bindSaveFeedback(el.querySelector('#nt-save-status'), { prefix: wordsNow, quiet: true, button: el.querySelector('#nt-save-retry') });
  disposeSave = feedback.dispose;
  // find: a second bar in the strip's place, so the text does not move
  const openFind = () => { findOpen = true; regionShow(region, 1); el.querySelector('#nt-find')?.focus(); };
  const closeFind = () => { findOpen = false; regionShow(region, 0); (el.querySelector('#nt-text') || el.querySelector('#nt-preview'))?.focus(); };
  if (findOpen) regionShow(region, 1);
  el.querySelector('#nt-find-open')?.addEventListener('click', openFind);
  el.querySelector('#nt-find-close')?.addEventListener('click', closeFind);
  el.querySelector('.nt-page').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); openFind(); }
    else if (e.key === 'Escape' && findOpen) { e.preventDefault(); closeFind(); }
    else if (e.key === 'Escape' && noteFocus) { e.preventDefault(); noteFocus = false; redo(); }
  });
  // Next and Previous go round the note from the caret; the count reads "3 of 12".
  const findStep = dir => {
    const q = el.querySelector('#nt-find').value.toLowerCase(), status = el.querySelector('#nt-find-status'); if (!q || !ta) { status.textContent = ''; return; }
    const text = ta.value.toLowerCase(), all = []; for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + Math.max(1, q.length))) all.push(at);
    if (!all.length) { status.textContent = 'No matches'; return; }
    const from = dir > 0 ? all.find(a => a >= ta.selectionEnd) : [...all].reverse().find(a => a < ta.selectionStart);
    const at = from ?? (dir > 0 ? all[0] : all.at(-1));
    status.textContent = `${all.indexOf(at) + 1} of ${all.length}`;
    ta.focus(); ta.setSelectionRange(at, at + q.length);
  };
  el.querySelector('#nt-find-next')?.addEventListener('click', () => findStep(1));
  el.querySelector('#nt-find-prev')?.addEventListener('click', () => findStep(-1));
  el.querySelector('#nt-find')?.addEventListener('input', () => { el.querySelector('#nt-find-status').textContent = ''; });
  el.querySelector('#nt-find')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } });
  // the text
  if (ta) {
    const place = editorPlaces.get(id); if (place) { ta.setSelectionRange(place.start, place.end); ta.scrollTop = place.scroll; }
    const history = histories.get(id) || editHistory({ text: ta.value, start: 0, end: 0 }); histories.set(id, history);
    let checkpointed = false;
    const save = () => {
      if (generation !== projectGeneration()) return;
      const text = ta.value;
      update(x => { const n = (x.projectNotes || []).find(y => y.id === id); if (n) { if (!checkpointed && n.text !== text) { checkpointNote(n); checkpointed = true; } n.text = text; if (!n.customTitle) n.title = titleOf(text); n.updated = new Date().toISOString(); } return x; });
      feedback.refresh();
      clearTimeout(detailsTimer); detailsTimer = setTimeout(() => shell?.refreshDetails?.(), 700);   // the inspector's words and edited time follow the text once typing pauses
      const preview = el.querySelector('.nt-preview'); if (preview) preview.innerHTML = markdownDocument(text);
    };
    ta.addEventListener('input', () => { if (!ta.dataset.historyReplay) history.push({ text: ta.value, start: ta.selectionStart, end: ta.selectionEnd }); save(); });
    const applyFormat = command => {
      if (generation !== projectGeneration()) return;
      if (command !== 'undo' && command !== 'redo') history.push({ text: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
      const result = command === 'undo' ? history.undo() : command === 'redo' ? history.redo() : formatNote(ta.value, ta.selectionStart, ta.selectionEnd, command);
      if (!result) return;
      if (command === 'undo' || command === 'redo') ta.dataset.historyReplay = 'true';
      ta.value = result.text; ta.focus(); ta.setSelectionRange(result.start, result.end); ta.dispatchEvent(new Event('input', { bubbles: true }));
      delete ta.dataset.historyReplay;
    };
    el.querySelectorAll('[data-note-format]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => applyFormat(b.dataset.noteFormat); });
    ta.addEventListener('keydown', e => {
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const command = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : e.shiftKey ? null : key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : null;
      if (command) { e.preventDefault(); e.stopPropagation(); applyFormat(command); }
    });
  }
  // the strip
  const mode = next => { noteMode = next; redo(); };
  el.querySelector('#nt-preview')?.addEventListener('click', () => mode(noteMode === 'edit' ? 'preview' : 'edit'));
  el.querySelector('#nt-split')?.addEventListener('click', () => mode(noteMode === 'split' ? 'edit' : 'split'));
  el.querySelector('#nt-focus')?.addEventListener('click', () => { noteFocus = !noteFocus; redo(); });
}

// ---- wiring: the other sections -----------------------------------------------------------------------------------
/** The dateline's calendar: choosing a day opens (or makes) that day's entry. */
function wireDay(el) {
  const input = el.querySelector('#jr-day'); if (!input) return;
  wireDateField(el, 'jr-day', 'Day');
  input.addEventListener('change', () => { if (input.value) showDay(input.value); else redo(); });
}
function wireJournal(el, entry) {
  wireDay(el);
  const id = entry.id, generation = projectGeneration(), ta = el.querySelector('#jr-text');
  const feedback = bindSaveFeedback(el.querySelector('#jr-save-status'), { prefix: () => [dayText(entry.date, dateValue(new Date())), plural(words(ta.value), 'word')].filter(Boolean).join(' · '), quiet: true });
  disposeSave = feedback.dispose;
  // Persist immediately: a detached editor must never write to a new project.
  ta.addEventListener('input', () => {
    if (generation !== projectGeneration()) return;
    const text = ta.value; update(x => { const e = (x.journal || []).find(y => y.id === id); if (e && e.text !== text) { e.text = text; e.updated = new Date().toISOString(); } return x; });
    feedback.refresh();
  });
  el.querySelector('#jr-del')?.addEventListener('click', async () => {
    if (entry.text.trim() && !await confirmAsk('Delete this entry?', { detail: entry.text.slice(0, 120), confirm: 'Delete', danger: true })) return;
    if (generation !== projectGeneration()) return;
    update(x => { x.journal = (x.journal || []).filter(y => y.id !== id); return x; });
    pick.journal = null; shell?.showList?.(); redo();
  });
}

function wireTemplate(el, t) {
  const id = t.id, generation = projectGeneration(), ta = el.querySelector('#tpl-text');
  const find = () => (get().noteTemplates || []).find(x => x.id === id);
  const feedback = bindSaveFeedback(el.querySelector('#tpl-save-status'), { prefix: () => plural(words(ta.value), 'word'), quiet: true });
  disposeSave = feedback.dispose;
  ta.addEventListener('input', () => {
    if (generation !== projectGeneration()) return;
    const text = ta.value; update(x => { const n = (x.noteTemplates || []).find(y => y.id === id); if (n) n.body = text; return x; });
    feedback.refresh();
  });
  el.querySelector('#tpl-use')?.addEventListener('click', () => { const n = find(); if (n) startTemplate(n); });
  el.querySelector('#tpl-rename')?.addEventListener('click', async () => {
    const name = (await ask('Rename template', { value: t.name, confirm: 'Rename' }))?.trim(); if (!name || generation !== projectGeneration()) return;
    update(x => { const n = (x.noteTemplates || []).find(y => y.id === id); if (n) n.name = name; return x; });
    shell?.refreshList?.(); redo();
  });
  el.querySelector('#tpl-delete')?.addEventListener('click', async () => {
    if (!await confirmAsk(`Delete the template ${t.name}?`, { detail: 'Notes made from it stay.', confirm: 'Delete', danger: true })) return;
    if (generation !== projectGeneration()) return;
    update(x => { x.noteTemplates = (x.noteTemplates || []).filter(y => y.id !== id); return x; });
    pick.templates = null; shell?.showList?.(); redo();
  });
}

function wireReading(el, p) {
  const set = patch => update(x => { setReading(x, p.id, patch); return x; });
  el.querySelector('#rd-card-status').onchange = e => { set({ status: e.target.value }); redo(); };
  el.querySelector('#rd-card-priority').onchange = e => { set({ priority: e.target.value }); redo(); };
  el.querySelector('#rd-card-why').onchange = e => set({ reason: e.target.value.trim() });
  el.querySelector('#rd-open').onclick = () => openStudy(shell, p.id);
  el.querySelector('#rd-note').onclick = () => { literatureNote(p); shell?.openItem?.(); drawFilter(); redo(); };
  el.querySelector('#rd-remove').onclick = () => { set({ status: '' }); pick.reading = null; shell?.showList?.(); redo(); };
}

function wireSource(el, n) {
  const file = !!n.source;
  const changed = msg => { redo(msg); shell?.refreshCounts?.(); };
  el.querySelector('#sn-state')?.addEventListener('click', () => {
    if (file) update(st => { completeFileNote(st, n.id, !done(st, n)); return st; });
    else update(st => { const x = (st.notes || []).find(y => y.id === n.id); if (x) Object.assign(x, checkedStamp()); return st; });
    changed();
  });
  el.querySelector('#sn-go')?.addEventListener('click', async () => {
    try {
      if (file) await shell.openFileNote(n);
      else openStudy(shell, n.paper, n.page ? { page: +n.page } : null);
    } catch (err) { shell?.say?.(err.message); }
  });
  el.querySelector('#sn-edit')?.addEventListener('click', async () => {
    const text = await askText('Edit note', { value: n.text }); if (!text?.trim()) return;
    update(st => { st.fileNotes.find(x => x.id === n.id).text = text.trim(); const t = st.todos?.find(t => t.id === n.todoId); if (t) t.text = text.trim(); return st; });
    changed();
  });
  el.querySelector('#sn-remove')?.addEventListener('click', async () => {
    if (!await confirmAsk('Remove this note?', { detail: file ? 'Its task, if it has one, stays in Tasks.' : n.text.slice(0, 120), confirm: 'Remove', danger: true })) return;
    update(st => { if (file) st.fileNotes = (st.fileNotes || []).filter(x => x.id !== n.id); else st.notes = (st.notes || []).filter(x => x.id !== n.id); return st; });
    pick.sources = null; shell?.showList?.(); changed();
  });
}

/** What each variable of a template becomes (lib/note-templates.mjs VARIABLES): the inspector's Variables section. */
const TEMPLATE_VARIABLES = [['date', 'Today'], ['time', 'The time now'], ['week', 'The ISO week'], ['project', 'The project’s name'], ['author', 'Your name in Settings'], ['paper', 'The chosen paper'],
  ['paper.title', 'Its title'], ['paper.authors', 'Its authors'], ['paper.year', 'Its year'], ['paper.doi', 'Its DOI link'], ['deadlines', 'Open tasks due in 14 days']];
// ---- the inspector ------------------------------------------------------------------------------------------------
/** Notes: the note's facts, its tags, the paper it is linked to, its versions. Reading list: the paper's study. The rest have none. */
export function inspect(ctx) {
  sync();
  const s = get();
  if (section === 'reading') { const p = (s.papers || []).find(x => x.id === pick.reading); return p ? [studySection(p, ctx, !!p.pdf)] : []; }
  if (section === 'templates') return (s.noteTemplates || []).some(t => t.id === pick.templates) ? [{ title: 'Variables', html: `<dl class="props">${TEMPLATE_VARIABLES.map(([k, v]) => `<dt>{{${esc(k)}}}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` }] : [];
  if (section !== 'notes') return [];
  const note = normaliseNotes(s.projectNotes).find(n => n.id === pick.notes); if (!note) return [];
  const id = note.id, paper = note.paperId && (s.papers || []).find(p => p.id === note.paperId);
  const secs = [
    { title: 'Note', html: `<dl class="props"><dt>Edited</dt><dd>${esc(when(note.updated || note.at))}</dd><dt>Created</dt><dd>${esc(when(note.at))}</dd><dt>Words</dt><dd>${esc(words(note.text))}</dd></dl>` },
    { title: 'Tags', html: formField('Tags', `<input id="nt-tags" aria-label="Tags, separated by commas" placeholder="e.g. methods, meeting, follow-up" value="${esc(noteTags(note.tags).join(', '))}">`),
      wire: box => { box.querySelector('#nt-tags').addEventListener('change', e => { const tags = noteTags(e.target.value); update(x => { const n = x.projectNotes?.find(n => n.id === id); if (n) { n.tags = tags; n.updated = new Date().toISOString(); } return x; }); e.target.value = tags.join(', '); }); } },
    { title: 'Linked paper', html: paper ? uiLink({ label: labelOfPaper(paper), icon: 'open', attrs: { 'data-note-paper': paper.id } }) : '<span class="meta">No paper linked</span>',
      wire: box => { box.querySelector('[data-note-paper]')?.addEventListener('click', e => openStudy(ctx, e.currentTarget.dataset.notePaper)); } }];
  if (note.versions?.length) secs.push({ title: `Versions · ${note.versions.length}`, html: uiList({ label: 'Version history', rows: note.versions.map((v, i) => uiRow({
    main: { html: `<span>${esc(v.title)}</span>`, detail: [when(v.at), v.text.slice(0, 160)] },
    end: uiRowEnd({ primary: { id: `nt-restore-v${i}`, label: 'Restore', attrs: { 'data-restore-version': i } }, more: { label: `More for version ${i + 1}`, attrs: { 'data-version-more': i } } }) })) }),
    wire: box => {
      const restore = async i => {
        if (!await confirmAsk('Restore this version?', { detail: 'The current text stays in version history.', confirm: 'Restore' })) return;
        update(x => { const n = x.projectNotes?.find(n => n.id === id); if (n) restoreNoteVersion(n, i); return x; });
        histories.delete(id); ctx.rerender();
      };
      box.querySelectorAll('[data-restore-version]').forEach(b => b.onclick = () => restore(Number(b.dataset.restoreVersion)));
      box.querySelectorAll('[data-version-more]').forEach(b => b.addEventListener('click', () => showMenu(b, [{ label: 'Restore version', run: () => restore(Number(b.dataset.versionMore)) }], { align: 'end' })));
    } });
  return secs;
}
