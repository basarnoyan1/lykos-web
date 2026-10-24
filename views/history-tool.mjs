// History: the project folder's commits, the History section of the Changes page (views/changes.mjs, lib/vcs.mjs).
//
// The folder records itself (lib/vcs-watch.mjs): a change that has settled is committed with a message saying what changed, so the page is
// mostly a record to read, laid out like a code host's history. The list page: what the project brought in from the folder by itself and what
// changed since the last commit, compact at the head; then the commits grouped by day, a run of automatic commits folded into one row that opens
// in place, a search over messages, files, people and version names, and a filter for named versions. A commit opens as a page of its own
// (Back in the title bar): its message, who and when, its parent, and the files it changed, each opening to what changed inside it (lines,
// cells, paragraphs, an image before and after), read only when it is opened. The same page compares any two versions, and a file has its own
// history. A file or a whole commit can be restored, which commits the state first and deletes nothing.
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiList, uiRow, uiRowEnd, uiBar } from '../lib/ui-actions.mjs';
import { uiLink, formField } from '../lib/ui-components.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { toolHost } from '../lib/tool-host.mjs';
import { describe } from '../lib/vcs.mjs';
import { repoOf, onHistory, start as startWatch, autoOn, setAuto, BY } from '../lib/vcs-watch.mjs';
import { ask, confirmAsk, formDialog } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ago, plural, when, clock } from '../lib/dates.mjs';
import { compareFiles, statOf, kindOf } from '../lib/vcs-diff.mjs';
import { groupLog, authorOf, messageParts, shortId, tagsOf, deltaOf, sumDeltas, rangeOf, isAuto, dayKey, dayLabel } from '../lib/vcs-log.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { projectDiff } from '../lib/project-diff.mjs';
import { get, update } from '../store.mjs';
import { pagedList, setListPage } from '../lib/paged-list.mjs';

const GROUPS = [['modified', 'Changed'], ['added', 'Added'], ['copied', 'Copies'], ['moved', 'Moved'], ['deleted', 'Deleted']];
const KIND_WORD = { modified: 'Changed', added: 'Added', copied: 'Copy', moved: 'Moved', deleted: 'Deleted' };
const FOLD_AT = 10;           // a kind with more files than this is listed by folder
const PREVIEW_FLAT = 15;     // the preview lists this many files as one list (each with its kind of change); more go by kind and folder
const FLAT_MAX = 60;          // a commit with more files than this lists them by kind and folder, not one flat list
const LINES_SHOWN = 400;      // lines of a comparison drawn before "Show more lines"
const LOG_PAGE = 200;         // commits read at a time; a search reads them all
const HASH_ONLY = 'Recorded by hash only (papers, old versions and built documents are not stored), so there is nothing to compare.';
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const folderOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const num = n => Number(n).toLocaleString('en');
const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const col = (name, html, ch) => ({ col: name, kind: 'text', ch, html });

/** Lines added (green) and removed (red), signs kept, or the cells changed; nothing for a file that cannot be counted. */
const deltaHtml = d => !d ? '' : d.c != null ? `<span title="Cells changed">${num(d.c)} ${d.c === 1 ? 'cell' : 'cells'}</span>`
  : [d.a ? `<span class="hist-add" title="Lines added">+${num(d.a)}</span>` : '', d.r ? `<span class="hist-del" title="Lines removed">−${num(d.r)}</span>` : ''].filter(Boolean).join(' ');
// A row's facts, in one column that ends on its rule's edge: who and when, how many files, the kind of change, the lines changed. A row draws
// only the facts it has, each in a slot of one width (ui-actions.css), so its last fact stands on the edge whatever it is, and the same fact of
// two rows lines up (owner, 2026-10-23: three lists of one page ended their right column at three places).
const factsCell = ({ when: at = '', files = 0, change = '', d = null } = {}) => {
  const facts = [['when', at], ['files', files ? esc(plural(files, 'file')) : ''], ['change', change ? esc(change) : ''], ['delta', deltaHtml(d) ? `<span class="hist-delta">${deltaHtml(d)}</span>` : '']].filter(([, html]) => html);
  return col('facts', facts.map(([f, html]) => `<span data-hist-fact="${f}">${html}</span>`).join(''));
};
const FACTS = ['facts'];


/** The chevron that opens a row, drawn as the open or the closed shape (a state is a shape, never a movement). */
const chevron = open => `<span class="hist-chev" aria-hidden="true">${icon(open ? 'chevron-down' : 'chevron-right', { size: 16 })}</span>`;
const opener = (attrs, open, label, tip) => `<button type="button" class="hist-open" ${attrs} aria-expanded="${open}" title="${esc(tip)}">${chevron(open)}${label}</button>`;
const tagText = names => names.map(t => `<bdi class="hist-tag">${esc(t)}</bdi>`).join('');   // a version's name is the person's text: its own case

const groupHead = (id, title, count) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h3' }, status: { id: `${id}-count`, text: String(count), ch: 6 } });

// ---- one comparison, drawn as a framed block under its row ----------------------------------------------------------------------------
const wordsHtml = (parts, text) => (parts ? parts.map(p => (p.x ? `<span class="hist-word">${esc(p.t)}</span>` : esc(p.t))).join('') : esc(text));
const OPS = { ' ': 'keep', '+': 'add', '-': 'del' };
const lineHtml = (op, a, b, html) => `<div class="hist-line" data-op="${op}"><span class="hist-ln">${a ?? ''}</span><span class="hist-ln">${b ?? ''}</span><span class="hist-op">${op === 'add' ? '+' : op === 'del' ? '−' : ''}</span><span class="hist-text">${html}</span></div>`;

/** The lines of a text or a document as rows, a paragraph that changed as its two versions; a folded run opens in place. */
function linesHtml(key, lines, st, budget) {
  const out = [];
  lines.forEach((l, i) => {
    if (budget.left <= 0) return;
    if (l.op === '…') {
      if (st.unfolded.has(`${key}#${i}`)) { out.push(linesHtml(`${key}#${i}`, l.hidden, st, budget)); return; }
      out.push(`<div class="hist-fold"><button type="button" class="link" data-act="unfold" data-key="${esc(key)}" data-at="${i}">Show ${esc(l.text)}</button></div>`);
      return;
    }
    if (l.op === '~') { out.push(lineHtml('del', l.a, '', wordsHtml(l.partsBefore, l.before)), lineHtml('add', '', l.b, wordsHtml(l.partsAfter, l.after))); budget.left -= 2; return; }
    out.push(lineHtml(OPS[l.op], l.a, l.b, wordsHtml(l.parts, l.text) || ' ')); budget.left--;
  });
  return out.join('');
}
const digitsOf = lines => Math.min(6, Math.max(2, String(lines.reduce((m, l) => Math.max(m, l.a || 0, l.b || 0, ...(l.hidden || []).map(h => Math.max(h.a || 0, h.b || 0))), 0)).length));

function compareHtml(key, c, st) {
  const frame = (body, kind = '', extra = '') => `<div class="hist-diff" data-compare="${esc(key)}"${kind ? ` data-kind="${kind}"` : ''}${extra}>${body}</div>`;
  if (!c) return frame('<div class="hist-note">Reading…</div>');
  if (c.kind === 'hash-only') return frame(`<div class="hist-note">${esc(HASH_ONLY)}</div>`);
  if (c.kind === 'same') return frame(`<div class="hist-note">${esc(c.message)}</div>`);
  if (c.kind === 'text' || c.kind === 'document') {
    if (!c.lines.length) return frame('<div class="hist-note">No line changed</div>');
    const budget = { left: st.expanded.has(key) ? Infinity : LINES_SHOWN }, body = linesHtml(key, c.lines, st, budget);
    const total = c.lines.reduce((n, l) => n + (l.op === '~' ? 2 : l.op === '…' ? 0 : 1), 0), rest = !st.expanded.has(key) && total > LINES_SHOWN ? total - LINES_SHOWN : 0;
    const cap = c.kind === 'document' ? `<div class="hist-cap">${esc([c.changed ? plural(c.changed, 'paragraph') + ' changed' : '', c.added - c.changed > 0 ? `${num(c.added - c.changed)} added` : '', c.removed - c.changed > 0 ? `${num(c.removed - c.changed)} removed` : ''].filter(Boolean).join(', ') || 'Paragraphs')}</div>` : '';
    return frame(`${cap}${body}${rest > 0 ? `<div class="hist-fold"><button type="button" class="link" data-act="more" data-key="${esc(key)}">Show ${num(rest)} more ${rest === 1 ? 'line' : 'lines'}</button></div>` : ''}`, c.kind, ` data-digits="${digitsOf(c.lines)}"`);
  }
  if (c.kind === 'sheet') {
    const parts = c.sheets.map(s => {
      const said = [s.cellsChanged ? plural(s.cellsChanged, 'cell') + ' changed' : '', s.added ? plural(s.added, 'row') + ' added' : '', s.removed ? plural(s.removed, 'row') + ' removed' : ''].filter(Boolean).join(', ');
      const rows = s.items.map(x => (x.type === 'cell'
        ? `<tr><td>${esc(x.cell)}${x.head ? `<span class="hist-dir" title="${esc(x.head)}">${esc(x.head)}</span>` : ''}</td><td class="hist-before">${esc(x.before)}</td><td class="hist-after">${esc(x.after)}</td></tr>`
        : `<tr data-op="${x.op === '+' ? 'add' : 'del'}"><td>${x.op === '+' ? 'Row added' : 'Row removed'}<span class="hist-dir">${esc(String(x.row))}</span></td><td colspan="2">${esc(x.values.filter(v => v !== '').join(', '))}</td></tr>`)).join('');
      return `<div class="hist-cap"><strong>${esc(s.name)}</strong> ${esc([s.status === 'changed' ? '' : `sheet ${s.status}`, said].filter(Boolean).join(', '))}</div>`
        + (rows ? `<table class="hist-sheet"><thead><tr><th>Cell</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>` : '');
    }).join('');
    return frame((parts || '<div class="hist-note">No cell changed</div>') + (c.truncated ? `<div class="hist-note">${esc(`${num(c.changed)} cells changed in all; the first ones are listed`)}</div>` : ''), 'sheet');
  }
  if (c.kind === 'image') {
    const fig = (label, url, size) => `<figure class="hist-figure"><figcaption>${esc(`${label} (${kb(size)})`)}</figcaption>${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : '<div class="hist-note">Not there</div>'}</figure>`;
    return frame(`<div class="hist-images">${fig('Before', c.urls?.before, c.before)}${fig('After', c.urls?.after, c.after)}</div>`, 'image');
  }
  if (c.kind === 'binary') return frame(`<div class="hist-note">${esc(!c.before ? `Added, ${kb(c.after)}` : !c.after ? `Deleted, ${kb(c.before)}` : `Changed, ${kb(c.before)} → ${kb(c.after)}`)}</div>`);
  if (c.kind === 'too-long') return frame(`<div class="hist-note">${esc(`Too long to compare line by line: ${kb(c.before || 0)} → ${kb(c.after || 0)}`)}</div>`);
  return frame(`<div class="hist-note">Could not be compared: ${esc(c.message || 'unreadable')}</div>`);
}

/** The changes of a status or a commit as groups: [{ kind, title, items: [{ path, note, from }] }], copies apart from what is new. */
export function groupsOf(c) {
  const copied = c.copied || {}, moveNote = m => (folderOf(m.from) === folderOf(m.to) ? `Renamed from ${baseOf(m.from)}` : `From ${folderOf(m.from) || 'the top folder'}`);
  const items = {
    modified: c.modified.map(p => ({ path: p, note: folderOf(p) })),
    added: c.added.filter(p => !copied[p]).map(p => ({ path: p, note: folderOf(p) })),
    copied: c.added.filter(p => copied[p]).map(p => ({ path: p, note: `Copy of ${copied[p]}`, of: copied[p] })),
    moved: c.moved.map(m => ({ path: m.to, note: moveNote(m), from: m.from })),
    deleted: c.deleted.map(p => ({ path: p, note: folderOf(p) })),
  };
  return GROUPS.map(([kind, title]) => ({ kind, title, items: items[kind] })).filter(g => g.items.length);
}
const countOf = c => (c ? c.added.length + c.modified.length + c.deleted.length + c.moved.length : 0);
/** Two levels of a path name its place well enough to group by. */
const placeOf = p => folderOf(p).split('/').slice(0, 2).join('/') || 'Top folder';

const states = new WeakMap();   // folder -> the page's state, so what was opened stays open when the page is drawn again
function stateOf(folder) {
  if (!states.has(folder)) states.set(folder, { repo: repoOf(folder), folder, status: null, key: '', log: [], limit: LOG_PAGE, all: false, tags: {}, notes: {}, auto: true,
    open: new Set(), shown: new Map(), expanded: new Set(), unfolded: new Set(), deltas: new Map(), shows: new Map(), counts: new Map(), busy: '', note: '',
    route: { page: 'list' }, trail: [], q: '', only: '' });   // shown: a file's comparison key -> its comparison, or null while it is read
  return states.get(folder);
}

/**
 * History drawn into `el` (the Changes view, views/changes.mjs). Its commands are the page's: `onHead({ actions, overflow, back?, title?, status? })`
 * hands them to the title bar whenever they change (Commit is the list's primary; a commit, a comparison or a file's history is a page with Back).
 * `route` opens a page at once ({ page: 'file', path } from the Files inspector); `reset` goes back to the list. Returns the way to stop it.
 */
const finders = new WeakMap();   // a mounted page's host -> its Find (views/changes.mjs find(): ⌘F)
/** ⌘F on the Changes page: the mounted History list in `el` opens its search row; false when it is not there. */
export function findIn(el) { const host = el?.querySelector('.tool-host'); const open = host && finders.get(host); return open ? !!open() : false; }
export function mountHistory(el, { say = () => {}, folder = activeFolder(), onHead = () => {}, go = null, route = null, reset = false } = {}) {
  const h = toolHost(el, { say }), st = stateOf(folder);
  if (reset || route) { st.route = { page: 'list' }; st.trail = []; }
  if (route?.page === 'commit') { st.sel = route.id; route = null; }
  if (route) { st.trail = [{ page: 'list' }]; st.route = route; }
  mount(h.ops, h, st, onHead, go);
  return h.stop;
}

function mount(ops, host, st, onHead, go) {
  const { say, isLive } = ops, b = host.body;
  b.classList.add('fv-tool-body');
  b.dataset.stacked = '';   // the tool body scrolls (research-views.css): a long history is not cut off
  b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'History'); b.tabIndex = 0;
  b.setAttribute('aria-busy', 'true');
  b.innerHTML = '<div class="note">Reading the folder…</div>';
  const urls = new Set();   // object URLs of images being compared, let go when the page goes
  const offUrls = () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); };

  const fresh = () => !st.status?.head;
  const keyOf = s => JSON.stringify([s.head, s.added, s.modified, s.deleted, s.moved]);
  const commitOf = id => st.log.find(x => x.id === id);
  const page = () => st.route.page;

  // ---- moving between the pages ------------------------------------------------------------------------------------------------------
  function goTo(route) { st.trail.push(st.route); st.route = route; b.scrollTop = 0; tools(); bar(); draw(); loadPage(); }
  function back() { st.route = st.trail.pop() || { page: 'list' }; tools(); bar(); draw(); loadPage(); }
  // a commit is a version of the timeline: opening it selects it, and the preview beside the list shows it (no page of its own)
  function select(key) {
    st.sel = key; if (page() !== 'list') { st.trail = []; st.route = { page: 'list' }; tools(); bar(); }
    draw(); loadPage();
    // stacked (a narrow pane), the preview is under the timeline: a press brings it into view, as opening a row's detail does
    const pv = b.querySelector('.hist-split[data-stack=true] .hist-preview'); if (pv) pv.scrollIntoView({ block: 'start' });
  }
  const openCommit = id => select(id);
  const openFile = path => goTo({ page: 'file', path });
  const openRange = (from, to) => goTo({ page: 'compare', from, to });

  // The list's search and Show: one tools row under the title bar, on the list page only, closed until the title bar's Find or ⌘F opens it and
  // open while it narrows the list (UI_Guidelines, a page's search row opens on demand). Escape in the empty field, with Show on all commits, closes it.
  const finding = () => !!(st.findOpen || st.q || st.only);
  function tools() {
    ops.host.querySelector(':scope > .fv-top')?.remove();
    if (page() !== 'list' || fresh() || !st.status || !finding()) return;
    host.placeTools(null, { label: 'Find commits', filters: [
      { type: 'search', id: 'hist-q', label: 'Search history', placeholder: 'Search messages, files and people', value: st.q },
      { type: 'select', id: 'hist-only', label: 'Show', value: st.only, options: [['', 'All commits'], ['people', 'Without automatic'], ['tags', 'Named versions']] }] });
  }
  function openFind() { st.findOpen = true; tools(); bar(); ops.host.querySelector('#hist-q')?.focus(); }
  function closeFind() { const had = !!(st.q || st.only); st.findOpen = false; st.q = ''; st.only = ''; tools(); bar(); if (had) draw(); b.focus(); }
  finders.set(ops.host, () => { if (page() !== 'list' || fresh()) return false; if (finding()) ops.host.querySelector('#hist-q')?.focus(); else openFind(); return true; });
  ops.host.addEventListener('keydown', e => { if (e.target.id === 'hist-q' && e.key === 'Escape' && !e.target.value && !st.only) { e.preventDefault(); e.stopPropagation(); closeFind(); } });
  let typing = 0;
  ops.host.addEventListener('input', e => {
    if (e.target.id !== 'hist-q') return;
    st.q = e.target.value;
    clearTimeout(typing); typing = setTimeout(async () => { if (st.q.trim() && !st.all) await readLog(5000); draw(); }, 150);
  });
  ops.host.addEventListener('change', async e => {
    if (e.target.id !== 'hist-only') return;
    st.only = e.target.value;
    if (st.only && !st.all) await readLog(5000);
    draw();
  });

  // The page's commands, in the title bar (no tools row of commands: the page updates itself, lib/vcs-watch.mjs looks every few seconds). A folder
  // with no history has one thing to do, and its empty state offers it, so it has none.
  let said = '';
  function bar() {
    if (!isLive()) return;
    const busy = !!st.busy, r = st.route, backTo = st.trail.at(-1)?.page === 'list' ? 'Back to History' : 'Back';
    let head;
    if (fresh() && st.status) head = { actions: [], overflow: [] };
    else if (r.page === 'commit') {
      const c = commitOf(r.id) || st.shows.get(r.id), names = tagsOf(st.tags, r.id);
      head = { title: 'Commit', status: { text: shortId(r.id), ch: 8 }, back: { label: backTo, run: back }, actions: [], overflow: [
        { id: 'hist-c-now', label: 'Compare with the folder now', run: () => openRange(r.id, 'working') },
        { id: 'hist-c-pick', label: 'Compare with another version…', run: () => pickRange(r.id) },
        { id: 'hist-c-name', label: 'Name this version…', disabled: busy, run: () => nameVersion(r.id) },
        { id: 'hist-c-restore', label: 'Restore every file', disabled: busy, run: () => restore(r.id, null, `The folder as it was at "${messageParts(c?.message).title || 'this commit'}"`) },
        ...(names.length ? ['-', ...names.map(n => ({ id: `hist-c-untag-${n}`, label: `Remove the name ${n}`, danger: true, run: () => untag(n) }))] : [])] };
    } else if (r.page === 'compare') {
      head = { title: 'Compare', back: { label: backTo, run: back }, actions: [], overflow: [{ id: 'hist-r-pick', label: 'Compare other versions…', run: () => pickRange(r.from, r.to) }] };
    } else if (r.page === 'file') {
      head = { title: baseOf(r.path), back: { label: backTo, run: back }, actions: [], overflow: [{ id: 'hist-f-open', label: 'Open the file', run: () => openInFiles(r.path) }] };
    } else {
      head = {
        find: { pressed: finding(), run: () => (finding() ? closeFind() : openFind()) },
        actions: [{ id: 'hist-commit', label: 'Commit', icon: 'save', role: 'primary', disabled: busy || !countOf(st.status), run: () => commit() }],   // the count is in the summary, so the label never changes
        overflow: [{ id: 'hist-look', label: 'Look for changes now', disabled: busy, run: () => { if (!st.busy) load(); } },
          { id: 'hist-compare', label: 'Compare versions…', disabled: st.log.length < 2, run: () => pickRange() },
          { id: 'hist-name', label: 'Name this version…', disabled: busy || !st.log.length, run: () => nameVersion(st.status?.head) }, '-',
          { id: 'hist-auto', label: 'Record changes automatically', kind: 'toggle', checked: st.auto, run: async () => { await setAuto(st.folder, !st.auto); st.auto = !st.auto; bar(); draw(); } },
          { id: 'hist-sync', label: 'Bring folder changes into the project', kind: 'toggle', checked: !get().autoSync?.off, run: () => { update(s => { s.autoSync = { ...(s.autoSync || {}), off: !s.autoSync?.off }; return s; }); bar(); draw(); } }] };
    }
    const key = JSON.stringify(head, (k, v) => (typeof v === 'function' ? undefined : v));
    // Find says whether its row is open in place too (an attribute), so nothing is drawn again under the keyboard
    document.querySelectorAll('[id="page-find"]').forEach(x => x.setAttribute('aria-pressed', String(finding())));
    if (key === said) return;   // the title bar is drawn again only when a command changes
    said = key; onHead(head);
  }

  async function readLog(limit = st.limit) {
    st.limit = limit;
    st.log = await st.repo.log({ limit });
    st.all = st.log.length < limit;
  }
  async function load(note = '') {
    st.busy = 'Reading the folder…'; st.note = note;
    if (isLive()) { bar(); draw(); }
    try {
      st.status = await st.repo.status(); st.key = keyOf(st.status);
      await readLog(Math.max(st.limit, st.q.trim() || st.only ? 5000 : LOG_PAGE));
      st.tags = await st.repo.tags();
      st.notes = await st.repo.tagNotes?.() || {};
      st.auto = await autoOn(st.folder);
    } catch (err) { st.note = String(err.message || err); }
    st.busy = '';
    if (!isLive()) return;
    b.removeAttribute('aria-busy'); tools(); bar(); draw(); loadPage();
    countChanges();
  }

  // The recorder's looks keep the page current: a new status redraws only when it differs, a commit it made reloads the log.
  const off = onHistory(async e => {
    if (!isLive()) { off(); offUrls(); return; }
    if (e.folder !== st.folder || st.busy) return;
    if (e.committed) { await load(); return; }
    if (e.synced) { draw(); return; }   // the project brought something in from the folder (lib/folder-sync.mjs)
    if (e.status && keyOf(e.status) !== st.key) { st.status = e.status; st.key = keyOf(e.status); bar(); if (page() === 'list') draw(); countChanges(); }
  });
  startWatch();

  /** The version of a file at a commit ('working': the folder now) as bytes, or null, with whether it existed, its size and whether it was kept at all. */
  async function versionAt(ref, path) {
    if (ref === 'working') { const now = await st.folder.stat(path); return { bytes: now.exists ? await st.folder.read(path) : null, exists: now.exists, hashOnly: false, size: now.size || 0 }; }
    if (!ref) return { bytes: null, exists: false, hashOnly: false, size: 0 };
    const id = await st.repo.resolve(ref), entry = id && (await st.repo.manifest(id))[path];
    return { bytes: entry && !entry.hashOnly ? await st.repo.read(id, path) : null, exists: !!entry, hashOnly: !!entry?.hashOnly, size: entry?.s || 0 };
  }

  /** Counts the lines or cells of changed files (not the added, moved or deleted: their count says nothing) and draws them as they arrive. */
  async function countFiles(paths, from, to, store, still) {
    for (const path of paths.slice(0, 40)) {
      const k = `${from}>${to}:${path}`;
      if (!isLive() || !still()) return;
      if (store.has(k)) continue;
      try {
        const was = await versionAt(from, path), now = await versionAt(to, path);
        if (was.hashOnly || now.hashOnly || Math.max(was.size, now.size) > 2 * 1024 * 1024 || kindOf(path) === 'binary' || kindOf(path) === 'image') { store.set(k, null); continue; }
        store.set(k, await statOf(path, was.bytes, now.bytes));
        if (still()) draw();
      } catch { store.set(k, null); }
    }
  }
  function countChanges() {
    const s = st.status;
    if (!s?.head) return;
    for (const k of [...st.deltas.keys()]) if (!k.startsWith(`${s.head}>working:`)) st.deltas.delete(k);
    for (const p of s.modified) { const k = `${s.head}>working:${p}`, h = s.files[p]?.h; if (st.deltas.get(`${k}#h`) !== h) { st.deltas.delete(k); st.deltas.set(`${k}#h`, h); } }
    countFiles(s.modified, s.head, 'working', st.deltas, () => page() === 'list');
  }

  async function commit() {
    const first = fresh();
    const message = await ask(first ? 'Start the history' : 'Describe the change', { placeholder: first ? 'The folder as it is now' : describe(st.status, { max: 120 }), confirm: first ? 'Start' : 'Commit' });
    if (message == null) return;
    st.busy = 'Saving…'; bar(); draw();
    try {
      const made = await st.repo.commit({ message: message.trim() || (first ? 'The folder as found' : describe(st.status)), by: 'You' });
      await load(made ? `Committed ${plural(Object.keys(made.changes).length, 'file')}` : 'Nothing to commit');
    } catch (err) { st.busy = ''; await load(String(err.message || err)); }
  }

  async function restore(id, paths, label) {
    const what = paths ? (paths.length === 1 ? baseOf(paths[0]) : plural(paths.length, 'file')) : 'every file';
    if (!await confirmAsk(`Restore ${what}?`, { detail: `${label}. The current state is saved first.`, confirm: 'Restore' })) return;
    st.busy = 'Restoring…'; bar(); draw();
    try {
      const r = await st.repo.restore(id, { paths, by: 'You' });
      const skipped = r.skipped.length ? `; ${plural(r.skipped.length, 'file')} not stored, left as they are` : '';
      await load(`Restored ${plural(r.restored.length, 'file')}${skipped}`);
      say(`Restored ${plural(r.restored.length, 'file')}`);
    } catch (err) { st.busy = ''; await load(String(err.message || err)); }
  }

  /** Names a version (a tag) with an optional note: "v20", "Submitted to IJSS". */
  async function nameVersion(id) {
    if (!id) return;
    const c = commitOf(id) || st.shows.get(id), was = tagsOf(st.tags, id)[0] || '';
    const v = await formDialog({ id: 'history-name', title: 'Name this version', detail: messageParts(c?.message).title || shortId(id), tier: 'S', confirm: 'Name',
      body: formField('Name', `<input type="text" name="name" id="hist-name-name" value="${esc(was)}" placeholder="v20" autocomplete="off" spellcheck="false">`)
        + formField('Note', `<input type="text" name="note" id="hist-name-note" value="${esc(st.notes[was]?.note || '')}" placeholder="Submitted to the journal" autocomplete="off">`),
      submit: form => { const name = form.elements.name.value.trim(); if (!name) { form.elements.name.focus(); return undefined; } return { name, note: form.elements.note.value }; } });
    if (!v) return;
    try { await st.repo.tag(v.name, id, { note: v.note }); await load(`Named ${v.name}`); } catch (err) { say(String(err.message || err)); }
  }
  async function untag(name) {
    if (!await confirmAsk(`Remove the name ${name}?`, { detail: 'The commit stays; only its name goes.', confirm: 'Remove', danger: true })) return;
    await st.repo.untag(name); await load(`Removed the name ${name}`);
  }

  /** Picks two versions to compare: named versions first, then the commits; the later one may be the folder now. */
  async function pickRange(from = '', to = '') {
    if (!st.all) await readLog(5000);
    const named = Object.entries(st.tags).filter(([, id]) => st.log.some(c => c.id === id)).sort((x, y) => st.log.findIndex(c => c.id === x[1]) - st.log.findIndex(c => c.id === y[1]));
    const label = c => `${shortId(c.id)}, ${when(c.at)}: ${messageParts(c.message).title.slice(0, 60) || 'No message'}`;
    const opts = (chosen, withNow) => [
      ...(withNow ? [`<option value="working"${chosen === 'working' ? ' selected' : ''}>The folder now</option>`] : []),
      named.length ? `<optgroup label="Named versions">${named.map(([n, id]) => `<option value="${esc(id)}"${chosen === id ? ' selected' : ''}>${esc(`${n}, ${when(commitOf(id)?.at)}`)}</option>`).join('')}</optgroup>` : '',
      `<optgroup label="Commits">${st.log.slice(0, 500).map(c => `<option value="${esc(c.id)}"${chosen === c.id ? ' selected' : ''}>${esc(label(c))}</option>`).join('')}</optgroup>`].join('');
    const later = to || (from ? st.log[0]?.id : named[0]?.[1] || st.log[0]?.id), earlier = from && from !== later ? from : (named.find(([, id]) => id !== later)?.[1] || st.log[1]?.id || '');
    const v = await formDialog({ id: 'history-compare', title: 'Compare versions', tier: 'M', confirm: 'Compare',
      body: formField('From', `<select name="from" id="hist-cmp-from">${opts(earlier, false)}</select>`) + formField('To', `<select name="to" id="hist-cmp-to">${opts(later, true)}</select>`),
      submit: form => { const f = form.elements.from.value, t = form.elements.to.value; if (f === t) { form.elements.to.focus(); return undefined; } return { from: f, to: t }; } });
    if (!v) return;
    const r = rangeOf(st.log, v.from, v.to);
    if (!r) { say('Those two versions cannot be compared'); return; }
    if (page() === 'compare') { st.route = { page: 'compare', from: r.from, to: r.to }; bar(); draw(); loadPage(); } else openRange(r.from, r.to);
  }

  async function openInFiles(path) {
    try { (await import('./files.mjs')).show(path); go?.('files'); } catch (err) { say(String(err.message || err)); }
  }

  // ---- what a page needs read before it is drawn --------------------------------------------------------------------------------------
  async function loadPage() {
    const r = st.route;
    const sel = selected();
    if (r.page === 'list' && sel !== 'working' && !sel.startsWith('sync:') && !sel.startsWith('run:') && !st.shows.has(sel)) {
      const [show, doc] = await Promise.all([st.repo.show(sel), st.repo.readCommit(sel)]);
      if (show) st.shows.set(sel, { ...show, deltas: Object.fromEntries(Object.entries(doc?.changes || {}).filter(([, e]) => e?.d).map(([p, e]) => [p, e.d])) });
      if (isLive() && selected() === sel) draw();
    }
    if (r.page === 'list' && sel !== 'working' && !sel.startsWith('sync:') && !sel.startsWith('run:')) {
      const show = st.shows.get(sel);
      if (show) countFiles([...show.modified, ...show.added.filter(p => !show.copied?.[p])], show.parent || '', sel, st.counts, () => selected() === sel);
    }
    if (r.page === 'list' && sel.startsWith('sync:') && !st.shows.has(sel)) readBrought(sel);
    if (r.page === 'list' && sel.startsWith('run:') && runs.has(sel)) {
      const { from, to } = runRange(runs.get(sel)), k = `${from}>${to}`;
      if (!st.shows.has(k)) { st.shows.set(k, await st.repo.diff(from, to)); if (isLive() && selected() === sel) draw(); }
      const d = st.shows.get(k);
      if (d) countFiles([...d.modified, ...d.added.filter(p => !d.copied?.[p])], from, to, st.counts, () => selected() === sel);
    }
    if (r.page === 'commit' && !st.shows.has(r.id)) {
      const [show, doc] = await Promise.all([st.repo.show(r.id), st.repo.readCommit(r.id)]);
      if (show) st.shows.set(r.id, { ...show, deltas: Object.fromEntries(Object.entries(doc?.changes || {}).filter(([, e]) => e?.d).map(([p, e]) => [p, e.d])) });
      if (isLive()) { bar(); draw(); }
    }
    if (r.page === 'compare') {
      const k = `${r.from}>${r.to}`;
      if (!st.shows.has(k)) { st.shows.set(k, await st.repo.diff(r.from, r.to)); if (isLive()) draw(); }
      const d = st.shows.get(k);
      countFiles([...(d?.modified || []), ...(d?.added || []).filter(p => !d.copied?.[p])], r.from, r.to, st.counts, () => page() === 'compare' && st.route === r);
    }
    if (r.page === 'file' && !st.shows.has(`file:${r.path}`)) {
      st.shows.set(`file:${r.path}`, await st.repo.fileLog(r.path));
      if (isLive()) { bar(); draw(); }
    }
  }

  /** What a change brought in from the folder did to the project's data: the parts it kept before the change (lib/folder-sync.mjs keeps them
   *  for Undo) against the record now, as project data rows (lib/project-diff.mjs). Later edits to the same parts count too, as Undo's do. */
  async function readBrought(sel) {
    st.shows.set(sel, null);
    try {
      const { SNAP_DIR } = await import('../lib/folder-sync.mjs');   // read when a change is selected: the sync module is large
      const before = JSON.parse(new TextDecoder().decode(await st.folder.read(`${SNAP_DIR}/${sel.slice(5)}.json`))), now = get();
      st.shows.set(sel, { rows: projectDiff(before, Object.fromEntries(Object.keys(before).map(k => [k, now[k]]))) });
    } catch { st.shows.set(sel, { rows: [] }); }
    if (isLive() && selected() === sel) draw();
  }

  // ---- a file's comparison, read when its row is opened --------------------------------------------------------------------------------
  async function toggleCompare(t) {
    const { key, path, from, to } = t.dataset, was = t.dataset.was || path;
    if (st.shown.has(key)) { const c = st.shown.get(key); for (const u of Object.values(c?.urls || {})) { URL.revokeObjectURL(u); urls.delete(u); } st.shown.delete(key); draw(); return; }
    st.shown.set(key, null); draw();
    let c;
    try {
      const [before, after] = await Promise.all([versionAt(from, was), versionAt(to, path)]);
      if ((before.hashOnly && before.exists) || (after.hashOnly && after.exists)) c = { kind: 'hash-only' };
      else {
        c = await compareFiles(path, before.bytes, after.bytes);
        if (c.kind === 'binary' || c.kind === 'image') { c.before = before.bytes ? before.size : 0; c.after = after.bytes ? after.size : 0; }
        if (c.kind === 'image') {
          const url = bytes => { if (!bytes) return ''; const u = URL.createObjectURL(new Blob([bytes], { type: c.mime })); urls.add(u); return u; };
          c.urls = { before: url(before.bytes), after: url(after.bytes) };
        }
      }
    } catch (err) { c = { kind: 'unreadable', message: String(err.message || err) }; }
    if (st.shown.has(key)) st.shown.set(key, c);
    draw();
  }
  const afterRow = key => (st.shown.has(key) ? [compareHtml(key, st.shown.get(key), st)] : []);

  // ---- rows -----------------------------------------------------------------------------------------------------------------------------
  /** A file of a set of changes between `from` and `to`; a move or a copy has the same content and says so, the rest open to their comparison. */
  function fileRow(it, kind, from, to, { depth = 0, d = null, flat = false, facts = true } = {}) {
    const key = `${from}>${to}:${it.path}`, open = st.shown.has(key), note = flat ? (it.from ? `From ${it.from}` : it.of ? `Copy of ${it.of}` : folderOf(it.path)) : it.note;
    const same = kind === 'moved' || kind === 'copied';
    const name = `<bdi class="hist-name">${esc(baseOf(it.path))}</bdi>${note ? `<span class="hist-dir">${esc(note)}</span>` : ''}`;
    const main = same ? `<span class="hist-open-static"><span class="dep-ico" aria-hidden="true"></span>${name}</span>`
      : opener(`data-act="compare" data-key="${esc(key)}" data-path="${esc(it.path)}" data-from="${esc(from)}" data-to="${esc(to)}"`, open, name, it.path);
    const commitId = to === 'working' ? '' : to;
    return [uiRow({ table: true, depth, attrs: { 'data-file': '', 'data-path': it.path, 'data-kind': kind, ...(commitId ? { 'data-commit': commitId } : {}) }, main: { html: main },
      cells: facts ? [factsCell({ change: flat ? KIND_WORD[kind] : '', d })] : [],
      end: uiRowEnd({ more: { label: `More for ${baseOf(it.path)}`, attrs: { 'data-act': 'file-more', 'data-path': it.path, 'data-kind': kind, 'data-from': from, 'data-to': to } } }) }), ...afterRow(key)];
  }

  /** The files of a set of changes: one flat list (a status column) when there are few, else by kind and, where a kind has many, by folder. */
  function changeRows(c, from, to, deltaOf = () => null, { flat = countOf(c) <= FLAT_MAX, facts = true } = {}) {
    const groups = groupsOf(c);
    if (flat) {
      const all = groups.flatMap(g => g.items.map(it => ({ it, kind: g.kind }))).sort((x, y) => x.it.path.localeCompare(y.it.path, 'en'));
      return all.flatMap(({ it, kind }) => fileRow(it, kind, from, to, { flat: true, facts, d: kind === 'modified' || kind === 'added' ? deltaOf(it.path) : null }));
    }
    return groups.flatMap(g => {
      const head = uiRow({ table: true, attrs: { 'data-change': g.kind }, main: { html: `<span class="hist-kind">${esc(g.title)}</span><span class="hist-dir">${esc(num(g.items.length))}</span>` }, cells: facts ? [factsCell()] : [], end: uiRowEnd({ reserve: true }) });
      if (g.items.length <= FOLD_AT) return [head, ...g.items.flatMap(it => fileRow(it, g.kind, from, to, { depth: 1, facts, d: g.kind === 'modified' ? deltaOf(it.path) : null }))];
      const places = new Map();
      for (const it of g.items) { const p = placeOf(it.path); if (!places.has(p)) places.set(p, []); places.get(p).push(it); }
      return [head, ...[...places].sort((x, y) => y[1].length - x[1].length).flatMap(([place, list]) => {
        const key = `${from}>${to}:${g.kind}:${place}`, open = st.open.has(key);
        const row = uiRow({ table: true, depth: 1, attrs: { 'data-place': place },
          main: { html: opener(`data-act="toggle" data-id="${esc(key)}"`, open, `<span class="dep-ico" aria-hidden="true">${icon('folder', { size: 16 })}</span><bdi class="hist-name">${esc(place)}</bdi><span class="hist-dir">${esc(plural(list.length, 'file'))}</span>`, place) },
          cells: facts ? [factsCell()] : [], end: uiRowEnd({ reserve: true }) });
        return open ? [row, ...list.slice(0, 300).flatMap(it => fileRow(it, g.kind, from, to, { depth: 2, facts, d: g.kind === 'modified' ? deltaOf(it.path) : null }))] : [row];
      })];
    });
  }

  // ---- the timeline: one list of versions, newest first, by day (Linear, Framer and Plane's version histories): the folder as it is now
  // leads it, then each day's commits, runs of automatic commits folded into one entry, and what the project brought in from the folder
  // (lib/folder-sync.mjs) as entries of their own kind. An entry is its summary, then when and who; its counts end on the list's edge. Pressing
  // an entry selects it (a fill) and the preview beside the list shows what it changed.
  const selected = () => st.sel || 'working';
  const isSel = key => selected() === key;
  const entry = ({ key, title, line, facts, depth = 0, kind, ico, end, tip, twist = null, attrs = {} }) => uiRow({ table: true, depth, attrs: { 'data-entry': key, 'data-hist-kind': kind, 'aria-selected': String(isSel(key)), ...attrs },
    // twist (a run): its chevron, inside the entry's one button, opens the run in place; a press anywhere else selects it; ArrowRight and ArrowLeft open and close it
    main: { html: `<button type="button" class="hist-open hist-pick" data-act="select" data-key="${esc(key)}" title="${esc(tip || title)}"${twist ? ` aria-expanded="${twist.open}" data-twist="${esc(twist.id)}"` : ''}>${twist ? `<span class="hist-twist" data-twist-hit>${chevron(twist.open)}</span>` : ''}${ico ? `<span class="dep-ico" aria-hidden="true">${icon(ico, { size: 16 })}</span>` : ''}<bdi class="hist-name hist-message">${title}</bdi></button>`,
      detail: line.filter(Boolean) },
    cells: [factsCell(facts)], end: end || uiRowEnd({ reserve: true }) });
  const whoWhen = (by, at) => [`<span title="${esc(when(at))}">${esc(clock(at))}</span>`, esc(authorOf(by))];

  function currentEntry() {
    const n = countOf(st.status), head = st.status.head, tagAtHead = tagsOf(st.tags, head)[0];
    const d = sumDeltas(st.status.modified.map(p => ({ delta: st.deltas.get(`${head}>working:${p}`) || {} })));
    return entry({ key: 'working', kind: 'current', title: 'Current version',
      line: [esc(n ? `${plural(n, 'change')} since ${tagAtHead || 'the last commit'}` : 'Up to date'), st.auto ? '' : esc('Automatic recording is off')], facts: { d } });
  }
  function commitEntry(c, depth = 0) {
    const { title } = messageParts(c.message), msg = title || 'No message', names = tagsOf(st.tags, c.id);
    return entry({ key: c.id, kind: isAuto(c) ? 'auto' : 'commit', depth, title: `${esc(msg)}${tagText(names)}`, tip: c.message || msg,
      line: [...whoWhen(c.by, c.at), ...names.filter(n => st.notes[n]?.note).map(n => esc(st.notes[n].note))], facts: { files: c.files.length, d: deltaOf(c) },
      end: uiRowEnd({ more: { label: `More for ${msg}`, attrs: { 'data-act': 'more-commit', 'data-id': c.id } } }) });
  }
  /** A run of automatic commits: one entry like a commit's (Framer's expanding entries). The entry selects the run (its preview: the totals,
   *  its commits and the files they changed); its chevron opens it in place to its commits, each an entry of its own. */
  const runs = new Map();   // the runs the timeline drew, by id: the preview reads a selected run from here
  const spanOf = commits => { const first = clock(commits.at(-1).at), last = clock(commits[0].at); return first === last ? first : `${first}–${last}`; };
  function runEntries(run) {
    runs.set(run.id, run);
    const open = st.open.has(run.id), files = new Set(run.commits.flatMap(c => c.files));
    const head = entry({ key: run.id, kind: 'run', twist: { id: run.id, open }, title: esc(plural(run.commits.length, 'automatic commit')), tip: run.label,
      line: [esc(spanOf(run.commits)), esc(authorOf(BY)), esc(plural(files.size, 'file'))], facts: { d: sumDeltas(run.commits) } });
    return open ? [head, ...run.commits.map(c => commitEntry(c, 1))] : [head];
  }
  function syncEntry(e) {
    return entry({ key: `sync:${e.id}`, kind: 'sync', title: esc(e.title), ico: 'import', tip: [e.title, e.detail].filter(Boolean).join('\n'),
      line: [`<span title="${esc(when(e.at))}">${esc(clock(e.at))}</span>`, esc('From the folder')],
      end: uiRowEnd({ inline: { id: `hist-undo-${e.id}`, label: 'Undo', icon: 'undo', attrs: { 'data-act': 'undo-auto', 'data-id': e.id } }, more: { label: `More for ${e.title}`, attrs: { 'data-act': 'auto-more', 'data-id': e.id } } }) });
  }
  // what the project found in the folder but left for the person: above the timeline, since each waits for a decision
  // a value a file changed that was edited here too (lib/data-follow.mjs): the file's and the app's side by side, the file's on one click
  function conflictRow(c, i) {
    return uiRow({ table: true, attrs: { 'data-conflict': c.key },
      main: { html: `<span class="hist-open-static"><span class="dep-ico" aria-hidden="true">${icon('warn', { size: 16 })}</span><bdi class="hist-name">${esc(c.name)}</bdi></span>`,
        detail: [esc(`In the file: ${c.file || 'empty'}`), esc(`Here: ${c.mine || 'empty'}`)], wrap: true },
      cells: [factsCell()], end: uiRowEnd({ primary: { id: `hist-cf-use-${i}`, label: "Use the file's", attrs: { 'data-act': 'conflict-file', 'data-key': c.key } },
        more: { label: `More for ${c.name}`, attrs: { 'data-act': 'conflict-more', 'data-key': c.key } } }) });
  }
  function needRows() {
    const needs = get().autoSync?.needs || [], conflicts = get().autoSync?.conflicts || [], n = needs.length + conflicts.length;
    return n ? [groupHead('hist-needs', 'Waiting for you', n), ...conflicts.map(conflictRow), ...needs.map(n => uiRow({ table: true, attrs: { 'data-need': n.key },
      main: { html: `<span class="hist-open-static"><span class="dep-ico" aria-hidden="true">${icon('warn', { size: 16 })}</span><bdi class="hist-name">${esc(n.title)}</bdi></span>`, detail: [esc(n.detail)], wrap: true },
      cells: [factsCell()], end: uiRowEnd({ reserve: true }) }))] : [];
  }
  async function settleConflict(key, choice) {
    const c = (get().autoSync?.conflicts || []).find(x => x.key === key);
    if (!c) return;
    try {
      const done = await (await import('../lib/folder-sync.mjs')).settleConflict(st.folder, key, choice, { get, update });
      say(done ? (choice === 'file' ? `${c.name}: the file's value` : `${c.name}: yours kept`) : `${c.name} is locked; change it by amendment`);
    } catch (err) { say(String(err.message || err)); }
    draw();
  }
  async function undoAuto(id) {
    const entry = (get().autoSync?.log || []).find(x => x.id === id);
    if (!entry || !await confirmAsk(`Undo "${entry.title}"?`, { detail: 'Later edits to the same parts are undone too.', confirm: 'Undo' })) return;
    try { await (await import('../lib/folder-sync.mjs')).undoChange(st.folder, id, { update }); say(`Undone: ${entry.title}`); } catch (err) { say(String(err.message || err)); }
    draw();
  }

  /** The days of the timeline: the log's days (groupLog) with what was brought in from the folder put in by its time. */
  function timelineDays(searching) {
    const days = groupLog(st.log, { query: st.q, tags: st.tags, only: st.only });
    const timeOf = it => Date.parse(it.kind === 'run' ? it.commits[0].at : it.kind === 'sync' ? it.entry.at : it.commit.at) || 0;
    if (!searching) for (const e of get().autoSync?.log || []) {
      const k = dayKey(e.at); if (!k) continue;
      let d = days.find(x => x.key === k);
      if (!d) { d = { key: k, label: dayLabel(e.at), items: [], count: 0 }; days.push(d); }
      d.items.push({ kind: 'sync', entry: e }); d.count++;
    }
    days.sort((x, y) => (x.key < y.key ? 1 : -1));
    for (const d of days) d.items.sort((x, y) => timeOf(y) - timeOf(x));
    return days;
  }

  // ---- the preview: what the selected version changed, beside the timeline ---------------------------------------------------------------
  const highlight = () => !st.plain;
  /** The preview's head: when and who (or "Current version"), Highlight changes and the version's primary; then its summary in full, wrapping. */
  function previewHead(lead, status, actions, overflow = [], title = '') {
    return uiBar({ kind: 'head', id: 'hist-prev-head', label: 'Version', lead: { title: lead, level: 'h2' }, ...(status ? { status: { id: 'hist-prev-status', text: String(status).slice(0, 24), ch: 24 } } : {}),
      actions: [{ id: 'hist-hl', label: 'Highlight changes', role: 'quiet', icon: 'highlight', pressed: highlight(), attrs: { 'data-act': 'highlight' } }, ...actions], overflow })
      + (title ? `<h3 class="hist-title">${title}</h3>` : '');
  }
  const stamp = at => `${dayLabel(at)}, ${clock(at)}`;
  /** Project data rows (lib/project-diff.mjs): a part of the record a row, what it gained, lost and changed on the list's edge. */
  function dataList(rows) {
    if (!rows?.length) return '';
    return uiList({ id: 'hist-prev-data', label: 'Project data changed', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '' },
      head: uiBar({ kind: 'head', label: 'Project data', id: 'hist-data', lead: { title: 'Project data', level: 'h3' }, status: { id: 'hist-data-count', text: num(rows.length), ch: 6 } }),
      rows: rows.map(x => uiRow({ table: true, attrs: { 'data-part': x.key }, main: { html: `<span class="hist-open-static"><bdi class="hist-name">${esc(x.label)}</bdi></span>` },
        cells: [factsCell({ change: x.changed ? `${num(x.changed)} changed` : '', d: x.added || x.removed ? { a: x.added, r: x.removed } : null })], end: uiRowEnd({ reserve: true }) })) });
  }
  /** The files a version changed, as the preview lists them: one list with each file's kind of change while they are few, by kind and folder
   *  when many. A list whose files say nothing on their right (moves and deletions, lines not counted) has no facts column at all. */
  function filesList(c, from, to, dOf) {
    const n = countOf(c), flat = n <= PREVIEW_FLAT, facts = flat || c.modified.some(p => dOf(p));
    return uiList({ id: 'hist-files-list', label: 'What changed', cols: facts ? FACTS : [], reveal: true, attrs: { 'data-hist-list': '' },
      head: uiBar({ kind: 'head', label: 'Files changed', id: 'hist-files', lead: { title: 'Files changed', level: 'h3' }, status: { id: 'hist-files-count', text: num(n), ch: 6 } }),
      rows: changeRows(c, from, to, dOf, { flat, facts }), empty: '<div class="hist-note">No file changed</div>' });
  }
  function previewHtml() {
    const sel = selected();
    if (sel === 'working') {
      const n = countOf(st.status), head = st.status.head;
      return previewHead('Current version', n ? plural(n, 'change') : 'Up to date', [])   // Commit is the title bar's primary: one Commit on the page
        + summary() + (n ? filesList(st.status, head, 'working', p => st.deltas.get(`${head}>working:${p}`)) : '');
    }
    if (sel.startsWith('sync:')) {
      const e = (get().autoSync?.log || []).find(x => `sync:${x.id}` === sel);
      if (!e) return '<div class="hist-note">This change is no longer listed</div>';
      return previewHead(stamp(e.at), 'From the folder', [{ id: 'hist-prev-undo', label: 'Undo', icon: 'undo', role: 'secondary', attrs: { 'data-act': 'undo-auto', 'data-id': e.id } }],
        e.path ? [{ id: 'hist-prev-open', label: 'Open the file', attrs: { 'data-act': 'open-file', 'data-path': e.path } }] : [], esc(e.title))
        + (e.detail ? `<p class="hist-body">${esc(e.detail)}</p>` : '') + dataList(st.shows.get(sel)?.rows);
    }
    if (sel.startsWith('run:')) return runPreview(runs.get(sel));
    const c = commitOf(sel) || st.shows.get(sel), show = st.shows.get(sel), names = c ? tagsOf(st.tags, c.id) : [];
    const msg = messageParts(c?.message).title || 'No message';
    const headHtml = previewHead(c ? stamp(c.at) : 'Version', c ? authorOf(c.by) : '', [{ id: 'hist-prev-restore', label: 'Restore this version', icon: 'undo', role: 'secondary', disabled: !!st.busy, attrs: { 'data-act': 'restore-sel' } }], [
      { id: 'hist-c-now', label: 'Compare with the folder now', attrs: { 'data-act': 'compare-now' } },
      { id: 'hist-c-pick', label: 'Compare with another version…', attrs: { 'data-act': 'compare-pick' } },
      { id: 'hist-c-name', label: 'Name this version…', attrs: { 'data-act': 'name-sel' } }], `${esc(msg)}${tagText(names)}`);
    if (!show) return headHtml + '<div class="hist-note">Reading…</div>';
    const from = show.parent || '';
    const dOf = p => show.deltas[p] || st.counts.get(`${from}>${sel}:${p}`) || null;
    return headHtml + commitMeta(show) + totals(show, Object.fromEntries([...show.modified, ...show.added].map(p => [p, dOf(p)]))) + filesList(show, from, sel, dOf);
  }

  /** A run's preview: when and who, its totals, its commits (each selects its own preview), then the files the run changed in all. */
  const runRange = run => ({ from: run.commits.at(-1).parent || '', to: run.commits[0].id });
  function runPreview(run) {
    if (!run) return '<div class="hist-note">This run is no longer listed</div>';
    const { from, to } = runRange(run), d = st.shows.get(`${from}>${to}`), files = new Set(run.commits.flatMap(c => c.files)), sum = sumDeltas(run.commits);
    const head = previewHead(`${dayLabel(run.commits[0].at)}, ${spanOf(run.commits)}`, authorOf(BY), [], [
      { id: 'hist-c-now', label: 'Compare with the folder now', attrs: { 'data-act': 'compare-now' } }], esc(plural(run.commits.length, 'automatic commit')));
    const totalsLine = `<div class="hist-note hist-totals">${[esc(plural(files.size, 'file')), deltaHtml(sum)].filter(Boolean).join('; ')}</div>`;
    const commits = uiList({ id: 'hist-run-commits', label: 'The commits of the run', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '', 'data-hist-timeline': '' },
      head: uiBar({ kind: 'head', label: 'Commits', id: 'hist-run-head', lead: { title: 'Commits', level: 'h3' }, status: { id: 'hist-run-count', text: num(run.commits.length), ch: 6 } }),
      rows: run.commits.map(c => commitEntry(c)) });
    const dOf = p => st.counts.get(`${from}>${to}:${p}`) || null;
    return head + totalsLine + commits + (d ? filesList(d, from, to, dOf) : '<div class="hist-note">Reading…</div>');
  }

  function summary() {
    const n = countOf(st.status), last = st.log[0];
    const lastSaid = last ? `Last recorded ${ago(Date.parse(last.at))}${isAuto(last) ? ' automatically' : ` by ${authorOf(last.by)}`}` : '';
    const line = [n ? '' : 'Up to date', lastSaid, st.auto ? (n ? 'these are recorded once the folder settles' : '') : 'automatic recording is off'].filter(Boolean).join('; ');
    return `<div class="hist-note" role="status" data-hist-summary>${esc(line)}</div>`;
  }

  // ---- the pages --------------------------------------------------------------------------------------------------------------------------
  let histPager = '';
  function listPage() {
    const searching = !!(st.q.trim() || st.only), days = timelineDays(searching);
    // fifty versions a page, each page under its days' heads (lib/paging.mjs pagedList); the page is kept across redraws
    const flat = days.flatMap(d => d.items.map(it => ({ d, it }))), paged = pagedList('hist-list', flat, { label: 'versions' });
    histPager = paged.pager;
    const logRows = paged.items.flatMap(({ d, it }, i) => [...(i === 0 || paged.items[i - 1].d !== d ? [groupHead(`hist-day-${d.key}`, d.label, d.count)] : []),
      ...(it.kind === 'run' ? runEntries(it) : it.kind === 'sync' ? [syncEntry(it.entry)] : [commitEntry(it.commit)])]);
    const none = searching ? `<div class="hist-note" role="status">${esc(st.only === 'tags' && !st.q.trim() ? 'No version has a name yet: More, Name this version' : `No commit matches "${st.q.trim()}"`)}</div>` : '';
    const older = !st.all && !searching ? [`<div class="hist-note"><button type="button" class="link" data-act="older">Show older commits</button></div>`] : [];
    const timeline = uiList({ id: 'hist-list', label: 'Versions', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '', 'data-hist-timeline': '', 'data-hub-group': 'history' },
      rows: [...(searching ? [] : [...needRows(), currentEntry()]), ...(logRows.length ? logRows : [none]), ...older] });
    return `<div class="hist-split" data-hist-split><section class="hist-timeline" aria-label="Versions">${timeline}${histPager}</section>`
      + `<section class="hist-preview" data-hist-preview aria-label="What this version changed"${highlight() ? '' : ' data-plain'}>${previewHtml()}</section></div>`;
  }

  /** A commit's own line under its head: its body, its id, its parent and its names. */
  function commitMeta(c) {
    const { body } = messageParts(c.message), names = tagsOf(st.tags, c.id);
    const meta = [`<span class="hist-id">${esc(c.id)}</span>`,
      c.parent ? uiLink({ label: `Parent ${shortId(c.parent)}`, icon: 'changes', title: 'Select the parent commit', attrs: { 'data-act': 'select', 'data-key': c.parent } }) : 'The first commit',
      ...names.map(n => `<bdi class="hist-tag">${esc(n)}</bdi>${st.notes[n]?.note ? ` ${esc(st.notes[n].note)}` : ''}`)];
    return `${body ? `<p class="hist-body">${esc(body)}</p>` : ''}<p class="hist-meta">${meta.join(', ')}</p>`;
  }

  /** The head of a commit's page: its message in full, then who, when, its parent and its names. */
  function commitHead(c) {
    const { title, body } = messageParts(c.message), names = tagsOf(st.tags, c.id);
    const meta = [esc(authorOf(c.by)), esc(when(c.at)), `<span class="hist-id">${esc(c.id)}</span>`,
      c.parent ? `Parent ${uiLink({ label: shortId(c.parent), icon: 'changes', title: 'Open the parent commit', attrs: { 'data-act': 'open-commit', 'data-id': c.parent } })}` : 'The first commit',
      ...names.map(n => `<bdi class="hist-tag">${esc(n)}</bdi>${st.notes[n]?.note ? ` ${esc(st.notes[n].note)}` : ''}`)];
    return `<section class="hist-intro" aria-label="Commit"><h2 class="hist-title">${esc(title || 'No message')}</h2>${body ? `<p class="hist-body">${esc(body)}</p>` : ''}<p class="hist-meta">${meta.join(', ')}</p></section>`;
  }
  const filesHead = n => uiBar({ kind: 'head', label: 'Files changed', id: 'hist-files', lead: { title: 'Files changed', level: 'h3' }, status: { id: 'hist-files-count', text: num(n), ch: 6 } });
  function totals(changes, deltas) {
    const d = Object.values(deltas || {}).reduce((t, x) => ({ a: t.a + (x?.a || 0), r: t.r + (x?.r || 0), c: t.c + (x?.c || 0) }), { a: 0, r: 0, c: 0 });
    const parts = groupsOf(changes).map(g => `${num(g.items.length)} ${g.title.toLowerCase()}`);
    return `<div class="hist-note hist-totals">${[esc(parts.join(', ')), d.a || d.r ? deltaHtml({ a: d.a, r: d.r }) : '', d.c ? esc(plural(d.c, 'cell') + ' changed') : ''].filter(Boolean).join('; ')}</div>`;
  }

  function commitPage() {
    const id = st.route.id, show = st.shows.get(id);
    if (!show) return '<div class="hist-note">Reading…</div>';
    const n = countOf(show), from = show.parent || '';
    return `${commitHead(show)}${uiList({ id: 'hist-files-list', label: 'Files changed', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '' },
      head: filesHead(n), rows: [totals(show, show.deltas), ...changeRows(show, from, id, p => show.deltas[p])], empty: '<div class="hist-note">No file changed</div>' })}`;
  }

  function comparePage() {
    const { from, to } = st.route, d = st.shows.get(`${from}>${to}`), r = rangeOf(st.log, from, to);
    const name = id => (id === 'working' ? 'the folder now' : tagsOf(st.tags, id)[0] || shortId(id)), at = id => (id === 'working' ? '' : commitOf(id) ? ` (${when(commitOf(id).at)})` : '');
    const open = st.open.has('range-commits'), commits = r?.commits || [];
    const head = `<section class="hist-intro" aria-label="Comparison"><h2 class="hist-title">${esc(`From ${name(from)}${at(from)} to ${name(to)}${at(to)}`)}</h2></section>`;
    const between = commits.length ? uiList({ id: 'hist-range-commits', label: 'The commits between them', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '' },
      rows: [uiRow({ table: true, attrs: { 'data-run': 'range' }, main: { html: opener('data-act="toggle" data-id="range-commits"', open, `<bdi class="hist-name hist-message">${esc(plural(commits.length, 'commit'))}</bdi>`, 'The commits between them') },
        cells: [factsCell({ d: sumDeltas(commits) })], end: uiRowEnd({ reserve: true }) }), ...(open ? commits.map(c => commitEntry(c, 1)) : [])] }) : '';
    if (!d) return `${head}${between}<div class="hist-note">Reading…</div>`;
    const n = countOf(d), deltas = Object.fromEntries([...d.modified, ...d.added].map(p => [p, st.counts.get(`${from}>${to}:${p}`)]).filter(([, x]) => x));
    return `${head}${between}${uiList({ id: 'hist-files-list', label: 'Files changed', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '' }, head: filesHead(n),
      rows: [totals(d, deltas), ...changeRows(d, from, to, p => deltas[p] || null)], empty: '<div class="hist-note">No file differs</div>' })}`;
  }

  function filePage() {
    const path = st.route.path, list = st.shows.get(`file:${path}`);
    if (!list) return '<div class="hist-note">Reading…</div>';
    const head = `<div class="hist-note">${esc([path, plural(list.length, 'version')].join(', '))}</div>`;   // the list's first line: where the file is and how many versions it has
    const days = groupLog(list.map(v => ({ ...v, files: [path] })), { foldMin: Infinity });
    const rows = days.flatMap(d => [groupHead(`hist-fday-${d.key}`, d.label, d.count), ...d.items.flatMap(({ commit: v }) => {
      const key = `${v.parent || ''}>${v.id}:${path}`, open = st.shown.has(key), msg = messageParts(v.message).title || 'No message';
      const what = v.deleted ? 'Deleted' : !v.parent || !list.some(x => x.at < v.at) ? 'Added' : 'Changed';
      return [uiRow({ table: true, attrs: { 'data-commit': v.id, 'data-path': path, 'data-version': '' },
        main: { html: opener(`data-act="compare" data-key="${esc(key)}" data-path="${esc(path)}" data-from="${esc(v.parent || '')}" data-to="${esc(v.id)}"`, open, `<bdi class="hist-name hist-message">${esc(msg)}</bdi>${tagText(tagsOf(st.tags, v.id))}`, v.message || msg),
          detail: [esc(what), esc(authorOf(v.by)), `<span title="${esc(when(v.at))}">${esc(clock(v.at))}</span>`, `<span class="hist-id">${esc(shortId(v.id))}</span>`], wrap: true },
        cells: [factsCell({ d: v.d ? (v.d.c != null ? { c: v.d.c } : v.d) : null })],
        end: uiRowEnd({ more: { label: `More for ${msg}`, attrs: { 'data-act': 'version-more', 'data-id': v.id, 'data-path': path, 'data-deleted': v.deleted ? '1' : '' } } }) }), ...afterRow(key)];
    })]);
    return uiList({ id: 'hist-file-list', label: `History of ${baseOf(path)}`, cols: FACTS, reveal: true, attrs: { 'data-hist-list': '', 'data-hub-group': 'history' }, rows: rows.length ? [head, ...rows] : [], empty: '<div class="hist-note">No commit has this file</div>' });
  }

  function draw() {
    if (!isLive()) return;
    if (!st.status) { if (st.busy) b.querySelector('.note')?.replaceChildren(document.createTextNode(st.busy)); return; }
    const parts = [], top = b.scrollTop, p = page();
    if (st.note && p === 'list') parts.push(`<div class="note" role="status">${esc(st.note)}</div>`);
    if (fresh()) {
      parts.push(emptyState({ icon: 'clock', title: 'No history yet', help: true,
        detail: `${plural(Object.keys(st.status.files).length, 'file')} in this folder. History keeps every version from here on, records changes as they happen, and can compare or restore any of them.`,
        actions: [{ id: 'hist-start', label: 'Start history', icon: 'save', primary: true }] }));
      // what the folder brought in and what waits for a choice are the project's, history or not (lib/folder-sync.mjs)
      const synced = [...needRows(), ...(get().autoSync?.log || []).map(syncEntry)];
      if (synced.length) parts.push(uiList({ id: 'hist-sync-list', label: 'From the folder', cols: FACTS, reveal: true, attrs: { 'data-hist-list': '' }, rows: synced }));
    } else parts.push(p === 'commit' ? commitPage() : p === 'compare' ? comparePage() : p === 'file' ? filePage() : listPage());
    b.innerHTML = `<div class="hist-page" data-hist-page="${p}">${parts.join('')}</div>`;
    const split = b.querySelector('.hist-split'); if (split) fitSplit(split, 640);   // the timeline beside its preview while both fit, the preview under the list when not
    b.scrollTop = top;   // a redraw from the recorder never moves the page
    b.querySelector('#hist-start')?.addEventListener('click', () => { if (!st.busy) commit(); });
  }

  b.addEventListener('keydown', e => {   // a run's entry opens with ArrowRight and closes with ArrowLeft, as a tree's row does
    const t = e.target.closest?.('[data-twist]');
    if (!t || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const id = t.dataset.twist, open = st.open.has(id);
    if ((e.key === 'ArrowRight') === open) return;
    e.preventDefault(); open ? st.open.delete(id) : st.open.add(id); draw();
    b.querySelector(`[data-twist="${CSS.escape(id)}"]`)?.focus();
  });
  b.addEventListener('click', e => {
    const step = e.target.closest('#hist-list-pager [data-page]');
    if (step && !step.disabled) { setListPage('hist-list', Number(step.dataset.page)); draw(); return; }
    const t = e.target.closest('[data-act]');
    if (!t || st.busy) return;
    const id = t.dataset.id, act = t.dataset.act;
    if (act === 'toggle') { st.open.has(id) ? st.open.delete(id) : st.open.add(id); draw(); return; }
    if (act === 'open-commit') { openCommit(id); return; }
    if (act === 'select' && t.dataset.twist && e.target.closest('[data-twist-hit]')) { const id = t.dataset.twist; st.open.has(id) ? st.open.delete(id) : st.open.add(id); draw(); return; }   // the chevron opens the run in place
    if (act === 'select') { select(t.dataset.key); return; }
    if (act === 'highlight') { st.plain = !st.plain; draw(); return; }
    if (act === 'commit-now') { commit(); return; }
    if (act === 'restore-sel') { const c = commitOf(selected()) || st.shows.get(selected()); restore(selected(), null, `The folder as it was at "${messageParts(c?.message).title || 'this commit'}"`); return; }
    if (act === 'compare-now') { const s = selected(); openRange(s.startsWith('run:') ? runs.get(s)?.commits[0].id : s, 'working'); return; }
    if (act === 'compare-pick') { pickRange(selected()); return; }
    if (act === 'name-sel') { nameVersion(selected()); return; }
    if (act === 'open-file') { openInFiles(t.dataset.path); return; }
    if (act === 'compare') { toggleCompare(t); return; }
    if (act === 'more') { st.expanded.add(t.dataset.key); draw(); return; }
    if (act === 'unfold') { st.unfolded.add(`${t.dataset.key}#${t.dataset.at}`); draw(); return; }
    if (act === 'older') { readLog(st.limit + LOG_PAGE).then(draw); return; }
    if (act === 'undo-auto') { undoAuto(id); return; }
    if (act === 'conflict-file') { settleConflict(t.dataset.key, 'file'); return; }
    if (act === 'conflict-more') { const key = t.dataset.key; showMenu(t, [{ label: "Use the file's", run: () => settleConflict(key, 'file') }, { label: 'Keep mine', run: () => settleConflict(key, 'mine') }], { align: 'end' }); return; }
    if (act === 'auto-more') {
      const e2 = (get().autoSync?.log || []).find(x => x.id === id);
      if (e2) showMenu(t, [{ label: 'Undo', icon: 'undo', run: () => undoAuto(id) }, ...(e2.path ? [{ label: 'Open the file', icon: 'open', run: () => openInFiles(e2.path) }] : [])], { align: 'end' });
      return;
    }
    if (act === 'more-commit') {
      const c = commitOf(id);
      showMenu(t, [{ label: 'Open', run: () => openCommit(id) },
        { label: 'Compare with the folder now', run: () => openRange(id, 'working') },
        { label: 'Name this version…', run: () => nameVersion(id) },
        { label: 'Restore every file', run: () => restore(id, null, `The folder as it was at "${messageParts(c?.message).title || 'this commit'}"`) }], { align: 'end' });
      return;
    }
    if (act === 'file-more') {
      const { path, kind, to, from } = t.dataset, gone = kind === 'deleted', at = gone ? from : to;
      showMenu(t, [...(gone ? [] : [{ label: 'Open', run: () => openInFiles(path) }]), { label: 'History of this file', run: () => openFile(path) },
        ...(at && at !== 'working' ? [{ label: gone ? 'Restore the deleted file' : 'Restore this version', run: () => restore(at, [path], `${baseOf(path)} as it was at ${shortId(at)}`) }] : [])], { align: 'end' });
      return;
    }
    if (act === 'version-more') {
      const { path } = t.dataset, gone = !!t.dataset.deleted, v = (st.shows.get(`file:${path}`) || []).find(x => x.id === id), at = gone ? v?.parent : id;
      showMenu(t, [{ label: 'Open the commit', run: () => openCommit(id) }, ...(at ? [{ label: gone ? 'Restore the deleted file' : 'Restore this version', run: () => restore(at, [path], `${baseOf(path)} as it was at ${shortId(at)}`) }] : [])], { align: 'end' });
    }
  });

  load();
}
