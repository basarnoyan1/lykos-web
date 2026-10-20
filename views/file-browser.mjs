// A folder as a page: one tools row (the field, which filters names or searches the text of the files as its Search in picker says, and a Kind
// picker) over a list or a grid of what is in it. The row is closed until Find in folder (the title bar) or ⌘F opens it, and stays open while it
// narrows the list; Escape in its empty field closes it. List or Grid is the page's view switch, in the title bar (views/files.mjs page()).
//
// The list is a file table: one line per file, its name (the extension kept, "n earlier" for the versions of a file, what the file is to the project as a
// quiet suffix) and the modified time, the size and the kind in columns whose headers sort, folders first. The columns leave by measurement as the pane
// narrows (kind first, then size, then modified: listColumns). A file that is the latest of several versions is drawn once; its disclosure opens the
// earlier ones in place (lib/file-versions.mjs). The grid is tiles of one size (128px and up, the columns share the row), so one file is one tile; a PDF's first page or
// an image is the picture, drawn as tiles come into view, one at a time, and kept in a small cache.
//
// The selection is a file manager's: click selects, Shift extends, ⌘ adds; Enter or a double press opens, ⌥ opens to the side, Space previews in the
// inspector, the arrows, Home, End and Page keys move, typing jumps to a name, ⌘A selects all, Delete moves to the Trash, F2 renames in place, and rows
// dragged onto a folder (or onto the tree) move there.
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiNotice, watchWidth } from '../lib/ui-actions.mjs';
import { listColumns } from '../lib/bar-modes.mjs';
import { baseName, parentOf } from '../lib/fsys.mjs';
import { showMenu } from '../lib/menu.mjs';
import { day, plural, num } from '../lib/dates.mjs';
import { groupVersions } from '../lib/file-versions.mjs';
import { folderPreferences, sortFolderEntries, filterFolderEntries, sortByColumn, folderSorts, rememberSort, fitName } from '../lib/folder-view.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { junk, hiddenShown, PATHS } from './explorer.mjs';
import { fileText, locatorAt, SUPPORTED, extOf } from '../lib/filetext.mjs';
import { typeIcon, FILE_KINDS, size } from './file-doc.mjs';
import { byteLru } from '../lib/cache-budget.mjs';
import { pollFolder } from '../lib/folder-poll.mjs';

let mounts = 0;
const FOLDER_PREFS = 'lykos.folder-view';
const FOLDER_SORTS = 'lykos.folder-sort';           // each folder's own order (Name, Modified, Size, Kind; the direction)
const UNDO_BYTES = 50 * 1048576;                     // files moved to the Trash are kept in memory for Undo up to this much
let cut = [];                                        // paths cut with ⌘X: ⌘V moves them into the folder shown
let copied = [];                                     // paths copied with ⌘C, pasted with ⌘V into the folder shown
const ENTRY_MAX = 2000;
const SEARCH = { files: 300, pdfs: 25, depth: 6, bytes: 8 * 1048576 };
const ARCHIVE = /^(archive|old versions?|previous versions?|superseded)$/i;
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const KIND_OPTIONS = [['all', 'All kinds'], ['word', 'Word'], ['pdf', 'PDF'], ['sheet', 'Spreadsheets'], ['text', 'Text'], ['image', 'Images'], ['folder', 'Folders']];
const SCOPE_OPTIONS = [['names', 'In names'], ['text', 'In file text']];   // what the one field looks in: the names of this folder, or the text of the files below it
const COLUMNS = [['modified', 'Modified', 'modified', 12], ['size', 'Size', 'size', 8], ['kind', 'Kind', 'type', 16]];   // id, header, the sort it is, ch

export function readPreferences() { try { return folderPreferences(JSON.parse(localStorage.getItem(FOLDER_PREFS))); } catch { return folderPreferences(); } }
export function writePreferences(p) { try { localStorage.setItem(FOLDER_PREFS, JSON.stringify(p)); } catch {} }
const readSorts = () => { try { return folderSorts(JSON.parse(localStorage.getItem(FOLDER_SORTS))); } catch { return {}; } };
/** The icon of an entry in the folder page: a Word file is a document, not the pencil of editing (the rest as file-doc.mjs typeIcon). */
export const fileIcon = (rel, dir = false, opts) => { const i = typeIcon(rel, dir); return i === 'manuscript' ? icon('file-word', opts) : icon(i, opts); };
// a tile's name is laid out by measurement: the width of a string in the tile's font, from one canvas
let ruler = null;
const measurer = el => { ruler ||= document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(el); ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const memo = new Map(); return t => { let w = memo.get(t); if (w == null) memo.set(t, w = ruler.measureText(t).width); return w; }; };

// A cached thumbnail is an object URL (an image) or a data URL (a PDF's first page) owned by the cache: it is revoked when it leaves the
// cache, not when the page is left (a revisit reuses it). The cache is bounded by bytes (an image's object URL holds the whole file).
const THUMB_BYTES = 32 * 1048576;
const THUMBS = byteLru(THUMB_BYTES, { onEvict: (k, url) => { if (String(url).startsWith('blob:')) URL.revokeObjectURL(url); } });
const thumbKey = (r, mtime) => `${r}@${mtime || 0}`;

/** The picture of a PDF's first page or of an image file, from the cache or drawn now; null for any other file. */
async function thumbUrl(folder, r, mtime) {
  const key = thumbKey(r, mtime);
  let url = THUMBS.get(key), bytes = 0;
  if (!url) {
    if (/\.pdf$/i.test(r)) {
      const { loadPdf, renderThumbnail } = await import('../lib/anchor.mjs');
      const { doc } = await loadPdf(await folder.read(r));
      try {
        const canvas = await renderThumbnail(doc, 1, 214);
        url = canvas?.toDataURL('image/jpeg', 0.7); bytes = (url?.length || 0) * 2;
      } finally { doc.destroy?.(); }
    } else if (IMG.test(r)) {
      const data = await folder.read(r);
      url = URL.createObjectURL(new Blob([data], /\.svg$/i.test(r) ? { type: 'image/svg+xml' } : {})); bytes = data.byteLength || data.length || 0;
    }
    if (url && !THUMBS.set(key, url, bytes)) return null;
  }
  return url || null;
}

const PREVIEWS = new Map(); const PREVIEW_MAX = 40;
/**
 * What a file looks like in the inspector: `{ type: 'image', url }` (a PDF's first page, an image), `{ type: 'lines', lines }` (the first lines of a
 * document or text), `{ type: 'sheets', sheets: [{ name, rows, cols }] }` (a workbook), or null. Read once per version of the file; files over 8 MB are not read.
 */
export async function previewOf(folder, rel, { size = 0, mtime = 0 } = {}) {
  const key = `${rel}@${mtime}:${size}`;
  // an image preview whose picture left the thumbnail cache is drawn again
  if (PREVIEWS.has(key) && (PREVIEWS.get(key)?.type !== 'image' || THUMBS.has(thumbKey(rel, mtime)))) return PREVIEWS.get(key);
  let out = null;
  try {
    const x = extOf(rel);
    if (size > SEARCH.bytes) out = null;
    else if (x === 'pdf' || IMG.test(rel)) { const url = await thumbUrl(folder, rel, mtime); out = url ? { type: 'image', url } : null; }
    else if (x === 'xlsx') {
      const { readXlsx } = await import('../lib/xlsx-read.mjs');
      out = { type: 'sheets', sheets: (await readXlsx(await folder.read(rel))).sheets.slice(0, 6).map(s => ({ name: s.name, rows: s.rows.length, cols: s.rows.reduce((n, r) => Math.max(n, r.length), 0) })) };
    } else if (SUPPORTED.includes(x) || x === 'tsv') {
      const ft = x === 'tsv' ? { text: new TextDecoder().decode(await folder.read(rel)) } : await fileText(baseName(rel), await folder.read(rel));
      const lines = ft.text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4).map(l => l.length > 140 ? `${l.slice(0, 139)}…` : l);
      out = lines.length ? { type: 'lines', lines } : null;
    }
  } catch { out = null; }
  PREVIEWS.set(key, out);
  if (PREVIEWS.size > PREVIEW_MAX) PREVIEWS.delete(PREVIEWS.keys().next().value);
  return out;
}

const kindLabel = e => e.dir ? 'Folder' : FILE_KINDS[e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase()] || (e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.') + 1).toUpperCase() : 'File');
const splitName = name => { const dot = name.lastIndexOf('.'); return dot > 0 && dot < name.length - 1 && name.length - dot <= 8 ? [name.slice(0, dot), name.slice(dot)] : [name, '']; };

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {string} o.rel                this folder
 * @param {object} o.folder             the folder adapter
 * @param {(rel: string, how: { dir?: boolean, side?: boolean, preview?: boolean, find?: string }) => void} o.open
 * @param {(rel: string, dir: boolean) => object[]} o.menu    the commands for an entry that depend on what it is (the explorer's)
 * @param {object} o.ops                what can be done to rows: rename(rel, name), trash(rels), moveInto(rels, folder), moveTo(rels), duplicate(rel), reveal(rel), copyPath(rel), can(rel)
 * @param {(rel: string, e: object) => { text: string, strong?: boolean }|string} [o.relation]   the phrase of what a file is to the project (lib/file-relations.mjs); strong is set in weight 500
 * @param {(rel: string, dir: boolean) => void} [o.onSelect]   told when the lead row changes (the inspector follows it); '' when nothing is selected
 * @param {() => void} [o.onPreview]    Space: show the preview (open the inspector)
 * @param {(text: string) => void} o.onStatus   the title bar's status: the folder's count ("14 items", "3 of 14", "2 matches") or "2 selected"
 * @param {(open: boolean) => void} [o.onFilter]   told when the filter row opens or closes (the title bar's Find in folder shows it pressed)
 */
export function mountBrowser(host, o) {
  const uid = `fb${++mounts}`;
  let prefs = { ...readPreferences(), ...(readSorts()[o.rel] || {}) }, query = '', live = true, items = { entries: [], archived: [] }, hiddenCount = 0, drawn = false, sig = '';
  const open = new Set();           // versions groups opened in place (by the latest file's path)
  let textMode = false, found = null;   // Search file text: null, or { query, rows, busy }
  let sel = new Set(), lead = '', anchor = '';   // the selection: every selected path, the one that has the focus, and where a Shift range starts
  let columns = [], renaming = null, revealNext = false, epoch = 0, typed = '', typedAt = 0;
  host.classList.add('fv-browser');
  host.innerHTML = `<div class="fv-top" data-fv-top></div><div class="fv-results" data-fv-results tabindex="-1"><div class="fv-loading" role="status"><span class="fv-loading-spinner" aria-hidden="true"></span><span>Reading folder…</span></div></div>`;
  const tools = host.querySelector('[data-fv-top]'), results = host.querySelector('[data-fv-results]');
  const kindName = () => (KIND_OPTIONS.find(k => k[0] === prefs.kind) || KIND_OPTIONS[0])[1];
  const scopeName = () => SCOPE_OPTIONS[textMode ? 1 : 0][1];
  const hint = () => (textMode ? 'Search file text' : 'Filter by name');

  // The field takes the row; the two pickers keep one width whatever they show, so choosing moves nothing.
  const toolsBar = () => uiBar({ kind: 'tools', id: `${uid}-bar`, label: 'Folder tools',
    filters: [{ type: 'search', id: `${uid}-q`, label: hint(), placeholder: hint(), value: query, width: 'flex' }],
    actions: [{ picker: true, id: `${uid}-scope`, label: 'Search in', value: scopeName(), options: SCOPE_OPTIONS, role: 'quiet', steady: true },
      { picker: true, id: `${uid}-kind`, label: 'Kind', value: kindName(), options: KIND_OPTIONS, role: 'quiet', steady: true }] });

  // The row is closed until it is asked for (the title bar's Find in folder, ⌘F), and stays open while it narrows the list: a name, a kind or the
  // file text. Closed, it is not drawn at all, so it pushes only the list down when it opens; the strip and the title bar above it do not move.
  const filtering = () => !!query.trim() || prefs.kind !== 'all' || textMode;
  let filterOpen = filtering();
  const field = () => tools.querySelector(`[id="${uid}-q"]`);
  const drawTools = () => { tools.hidden = !filterOpen; tools.innerHTML = filterOpen ? toolsBar() : ''; o.onFilter?.(filterOpen); };
  const openFilter = ({ focus = true } = {}) => {
    if (!filterOpen) { filterOpen = true; drawTools(); }
    if (focus) { const q = field(); q?.focus(); q?.select(); }
  };
  /** Closes the row; what it narrowed is let go, so a closed row never hides a filter. */
  const closeFilter = ({ refocus = true } = {}) => {
    if (!filterOpen) return;
    const was = filtering();
    query = ''; found = null; textMode = false; if (prefs.kind !== 'all') { prefs.kind = 'all'; save(); }
    filterOpen = false; drawTools();
    if (was) draw();
    if (refocus) (results.querySelector('[data-entry][tabindex="0"]') || results).focus({ preventScroll: true });
  };
  const save = () => writePreferences(prefs);
  drawTools();
  // Tiles are one size, and the columns of the list leave in an order: how many fit is measured, not queried.
  const chPx = () => { const probe = document.createElement('span'); probe.className = 'fv-ch'; results.append(probe); const w = probe.getBoundingClientRect().width || 6.6; probe.remove(); return w; };
  let ch = 0;
  const fit = () => {
    const w = results.clientWidth; if (!w) return;
    results.style.setProperty('--fv-cols', String(Math.max(1, Math.floor(((w - 24) + 12) / (128 + 12)))));   // as many columns as hold a 128px tile; they share the row
    ch ||= chPx();
    const next = listColumns({ width: w, order: COLUMNS.map(c => c[0]), widths: Object.fromEntries(COLUMNS.map(c => [c[0], Math.ceil(c[3] * ch) + 2])), main: 220 });
    if (next.join() !== columns.join()) { columns = next; if (drawn && prefs.view === 'list') draw(); }
    if (drawn && prefs.view === 'grid') fitNames();
  };
  const unwatch = watchWidth(results, fit);

  const showPicked = (id, label, value) => {
    const el = tools.querySelector(`[id="${id}"]`);
    if (el) { el.querySelector('.ui-picker-value').textContent = value; el.setAttribute('aria-label', `${label}: ${value}`); }
  };
  const setKind = value => { prefs.kind = value; save(); showPicked(`${uid}-kind`, 'Kind', kindName()); draw(); };
  /** Names filters this folder as typed; Text searches the files below it when Enter is pressed (or now, when the field already holds words). */
  const setScope = value => {
    textMode = value === 'text';
    showPicked(`${uid}-scope`, 'Search in', scopeName());
    const field = tools.querySelector(`[id="${uid}-q"]`);
    field.placeholder = hint(); field.setAttribute('aria-label', hint());
    if (!textMode) { found = null; draw(); } else if (query.trim()) search(); else field.focus();
  };
  // the two pickers declare their options: the engine opens them (from the row or from More) and says what was chosen
  tools.addEventListener('ui-pick', e => {
    const d = e.detail || {};
    if (d.id === `${uid}-kind`) setKind(d.value);
    else if (d.id === `${uid}-scope`) setScope(d.value);
  });
  tools.addEventListener('input', e => { if (e.target.id === `${uid}-q`) { query = e.target.value; if (!query.trim()) found = null; if (!textMode || !query.trim()) draw(); } });
  tools.addEventListener('keydown', e => {
    if (e.target.id !== `${uid}-q`) return;
    if (e.key === 'Enter' && textMode && query.trim()) { e.preventDefault(); search(); }
    // Escape empties the field, then closes the row when nothing else narrows the list (a kind or the file text keeps it open)
    else if (e.key === 'Escape') {
      if (query) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; query = ''; found = null; draw(); }
      else if (!filtering()) { e.preventDefault(); e.stopPropagation(); closeFilter(); }
    }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (results.querySelector('[data-entry][tabindex="0"]') || results.querySelector('[data-entry]'))?.focus(); }
  });

  const read = async () => {
    const rows = await o.folder.list(o.rel);
    const all = rows.slice(0, ENTRY_MAX * 2);
    const shown = all.filter(e => hiddenShown() || !junk(e.name)).slice(0, ENTRY_MAX);
    return { all, shown, sig: shown.map(e => `${e.name}|${e.dir ? 1 : 0}|${e.size}|${e.mtime}`).join('\n') + `|${hiddenShown()}` };
  };
  async function load() {
    const mine = ++epoch;
    let got;
    try { got = await read(); } catch (err) { if (live) results.innerHTML = emptyState({ icon: 'warn', title: 'Could not read this folder', detail: String(err?.message || err) }); return; }
    if (!live || mine !== epoch) return;
    hiddenCount = got.all.length - got.all.filter(e => !junk(e.name)).length;
    // earlier versions kept in an Archive folder beside the files
    const archived = [];
    if (prefs.group) {
      for (const dir of got.shown.filter(e => e.dir && ARCHIVE.test(e.name)).slice(0, 4)) {
        try { for (const e of await o.folder.list(dir.rel)) if (!e.dir && !junk(e.name)) archived.push(e); } catch {}
        if (!live || mine !== epoch) return;
      }
    }
    items = { entries: got.shown, archived }; sig = got.sig;
    const have = new Set(got.shown.map(e => e.rel)), had = sel.size; sel = new Set([...sel].filter(r => have.has(r) || archived.some(a => a.rel === r)));
    if (lead && !have.has(lead) && !archived.some(a => a.rel === lead)) lead = [...sel][0] || '';
    drawn = true;
    fit(); draw();
    if (had || sel.size) tell();
  }
  // a file saved from Word or dropped in by the Finder appears: the folder is looked at again while the page is up
  const stopPoll = pollFolder(async () => {
    if (!live || renaming || found || !drawn) return;
    try { const got = await read(); if (got.sig !== sig && live) load(); } catch {}
  });

  const groupsNow = () => {
    const { entries, archived } = items;
    const filtered = filterFolderEntries(entries, { kind: prefs.kind, query });
    const groups = prefs.group ? groupVersions(filtered, archived) : filtered.map(latest => ({ latest, earlier: [] }));
    const order = sortFolderEntries(groups.map(g => g.latest), prefs);
    const byRel = new Map(groups.map(g => [g.latest.rel, g]));
    return order.map(e => byRel.get(e.rel));
  };

  const phrase = (e, depth) => {
    if (depth || !o.relation || e.dir) return '';
    const r = o.relation(e.rel, e), t = typeof r === 'string' ? { text: r } : r;
    return t?.text ? `<span class="fv-rel"${t.strong ? ' data-strong' : ''}>${esc(t.text)}</span>` : '';
  };
  const nameCell = (e, g, depth, first) => {
    const [stem, ext] = splitName(e.name), n = g?.earlier.length || 0;
    const disclosure = n ? `<button type="button" class="fv-disc" data-versions="${esc(e.rel)}" aria-expanded="${open.has(e.rel)}" aria-label="Earlier versions of ${esc(e.name)}" tabindex="-1">${icon(open.has(e.rel) ? 'chevron-down' : 'chevron-right', { size: 12 })}</button>` : '<span class="fv-disc" aria-hidden="true"></span>';
    const suffix = depth ? `<span class="fv-earlier">${e.archived ? 'Archive' : 'Earlier version'}</span>` : n ? `<span class="fv-earlier">${n} earlier</span>` : '';
    return `<span class="fv-name">${disclosure}<button type="button" class="fv-entry" tabindex="${first ? 0 : -1}" title="${esc(e.name)}" data-entry>${fileIcon(e.rel, e.dir)}<span class="fv-entry-name"><span class="fv-stem">${esc(stem)}</span><span class="fv-ext">${esc(ext)}</span></span></button>${suffix}${phrase(e, depth)}</span>`;
  };
  const cellOf = (id, e) => id === 'modified' ? (e.mtime ? esc(day(e.mtime)) : '') : id === 'size' ? (e.dir ? '' : esc(size(e.size || 0))) : esc(kindLabel(e));
  const rowHtml = (e, g, depth = 0, first = false) => uiRow({
    table: true, cls: `fv-row${sel.has(e.rel) ? ' fv-sel' : ''}${e.dir ? ' fv-folder' : ''}`, depth, attrs: { 'data-rel': e.rel, draggable: 'true', ...(e.dir ? { 'data-dir': '1' } : {}) },
    main: { html: nameCell(e, g, depth, first) },
    cells: columns.map(c => ({ col: c, kind: 'text', ch: COLUMNS.find(x => x[0] === c)[3], html: cellOf(c, e) })),
    end: uiRowEnd({ more: { label: `More for ${e.name}`, attrs: { 'data-more': e.rel } } }),
  });
  const headHtml = () => {
    const btn = (id, label, sort) => {
      const arrow = icon(prefs.sort === sort && prefs.descending ? 'arrow-down' : 'arrow-up', { size: 12 });   // before the name of a right-aligned column, after the first one: the names stay where the values end
      return `<button type="button" class="fv-sort" data-sort="${sort}" aria-label="Sort by ${label.toLowerCase()}${prefs.sort === sort ? `, ${prefs.descending ? 'descending' : 'ascending'}` : ''}"${prefs.sort === sort ? ` data-sorted data-dir="${prefs.descending ? 'desc' : 'asc'}"` : ''}>${id === 'name' ? '' : arrow}<span>${label}</span>${id === 'name' ? arrow : ''}</button>`;
    };
    return uiRow({ table: true, cls: 'fv-colhead', attrs: { 'data-head': '1', role: 'presentation' }, main: { html: `<span class="fv-name"><span class="fv-disc" aria-hidden="true"></span>${btn('name', 'Name', 'name')}</span>` },
      cells: columns.map(c => { const col = COLUMNS.find(x => x[0] === c); return { col: c, kind: 'control', html: btn(c, col[1], col[2]) }; }), end: uiRowEnd({ reserve: true }) });
  };

  const tileHtml = (e, g, first) => `<div class="fv-tile${sel.has(e.rel) ? ' fv-sel' : ''}" role="option" aria-selected="${sel.has(e.rel)}" draggable="true" data-entry data-rel="${esc(e.rel)}"${e.dir ? ' data-dir="1"' : ''} tabindex="${first ? 0 : -1}" title="${esc(e.name)}">
    <span class="fv-tile-pic">${fileIcon(e.rel, e.dir, { size: 24 })}</span>
    <span class="fv-tile-name" data-name="${esc(e.name)}">${esc(e.name)}</span>
    <span class="fv-tile-meta">${esc([e.dir ? 'Folder' : size(e.size || 0), e.mtime ? day(e.mtime) : '', g?.earlier.length ? `${g.earlier.length} earlier` : ''].filter(Boolean).join(' · '))}</span></div>`;

  let io = null, queue = [], busy = false;
  const pump = async () => {
    if (busy) return; busy = true;
    while (queue.length && live) await drawThumb(queue.shift()).catch(() => {});
    busy = false;
  };
  async function drawThumb(t) {
    const r = t.dataset.rel, entry = items.entries.find(e => e.rel === r);
    const url = await thumbUrl(o.folder, r, entry?.mtime);
    if (url && live && t.isConnected) t.querySelector('.fv-tile-pic').innerHTML = `<img src="${url}" alt="">`;
  }

  /** Looks for the query in the readable files below this folder, a bounded number, one at a time; the matches replace the list until the box is cleared. */
  async function search() {
    const mine = ++epoch, q = query.trim(), needle = q.toLowerCase();
    found = { query: q, rows: [], busy: true };
    draw();
    const todo = [o.rel]; let files = 0, pdfs = 0, depth = 0;
    const level = new Map([[o.rel, 0]]);
    while (todo.length && live && mine === epoch && files < SEARCH.files) {
      const dir = todo.shift(); depth = level.get(dir) || 0;
      let rows = []; try { rows = await o.folder.list(dir); } catch { continue; }
      for (const e of rows) {
        if (!live || mine !== epoch) return;
        if (!hiddenShown() && junk(e.name)) continue;
        if (e.dir) { if (depth < SEARCH.depth) { todo.push(e.rel); level.set(e.rel, depth + 1); } continue; }
        const x = extOf(e.name);
        if (!SUPPORTED.includes(x) || (e.size || 0) > SEARCH.bytes || files >= SEARCH.files || (x === 'pdf' && pdfs >= SEARCH.pdfs)) continue;
        files++; if (x === 'pdf') pdfs++;
        try {
          const ft = await fileText(e.name, await o.folder.read(e.rel));
          const at = ft.text.toLowerCase().indexOf(needle);
          if (at >= 0) {
            const loc = locatorAt(ft, at) || {};
            const label = loc.sheet ? `${loc.sheet}!${loc.cell || ''}` : loc.paragraph ? `¶${loc.paragraph}` : loc.page ? `p. ${loc.page}` : loc.line ? `line ${loc.line}` : '';
            const from = Math.max(0, at - 24), snippet = `${from ? '…' : ''}${ft.text.slice(from, at + needle.length + 48).replace(/\s+/g, ' ')}`;
            found.rows.push({ e, label, snippet });
            if (found.rows.length <= 40 || found.rows.length % 10 === 0) draw();
          }
        } catch {}
      }
    }
    if (live && mine === epoch) { found.busy = false; draw(); }
  }

  function drawFound() {
    o.onStatus(`${plural(found.rows.length, 'match', 'matches')}${found.busy ? '…' : ''}`);
    if (!found.rows.length) { results.innerHTML = found.busy ? `<div class="fv-loading" role="status"><span class="fv-loading-spinner" aria-hidden="true"></span><span>Searching file text…</span></div>` : emptyState({ icon: 'search', title: 'No file text matches' }); return; }
    const rows = found.rows.map(({ e, label, snippet }, i) => uiRow({ cls: 'fv-row fv-found', attrs: { 'data-rel': e.rel, 'data-find': found.query },
      main: { html: `<span class="fv-name"><span class="fv-disc" aria-hidden="true"></span><button type="button" class="fv-entry" tabindex="${i ? -1 : 0}" title="${esc(e.name)}" data-entry>${fileIcon(e.rel)}<span class="fv-entry-name"><span class="fv-stem">${esc(splitName(e.name)[0])}</span><span class="fv-ext">${esc(splitName(e.name)[1])}</span></span></button></span>`, detail: [esc(parentOf(e.rel).slice(o.rel.length).replace(/^\//, '') || 'This folder'), esc(label), esc(snippet)] },
      end: uiRowEnd({ more: { label: `More for ${e.name}`, attrs: { 'data-more': e.rel } } }) }));
    results.innerHTML = uiList({ id: `${uid}-found`, label: 'Matches', rows, cls: 'fv-list fv-found-list' });
  }

  function draw() {
    if (!live || !drawn || renaming) return;
    io?.disconnect(); queue = [];
    if (found && textMode) { drawFound(); return; }
    const groups = groupsNow();
    const total = items.entries.length;
    const matched = groups.reduce((n, g) => n + 1 + g.earlier.filter(e => !e.archived).length, 0);
    countText = matched === total ? plural(total, 'item') : `${num(matched)} of ${num(total)}`; say();   // what is hidden is counted in More ("Show 3 hidden files")
    results.dataset.view = prefs.view;
    // an empty folder says so; Add files and New folder are the title bar's, so the page does not offer them a second time
    if (!groups.length) {
      results.innerHTML = total ? `<p class="fv-quiet">No files match ${uiLink({ id: `${uid}-clear`, label: 'Clear filter' })}</p>` : '<p class="fv-quiet">Empty folder</p>';
      results.querySelector(`[id="${uid}-clear"]`)?.addEventListener('click', clearFilter);
      sel = new Set(); say(); return;
    }
    const keepTop = results.scrollTop;
    const focusRel = lead && groups.some(x => x.latest.rel === lead) ? lead : groups[0].latest.rel;
    if (prefs.view === 'grid') {
      results.innerHTML = `<div class="fv-tiles" role="listbox" aria-multiselectable="true" aria-label="${esc(baseName(o.rel) || o.folder.name || 'Files')}">${groups.map(g => tileHtml(g.latest, g, g.latest.rel === focusRel)).join('')}</div>`;
      io = new IntersectionObserver(es => { for (const x of es) if (x.isIntersecting) { io.unobserve(x.target); if (!x.target.dataset.dir && (/\.pdf$/i.test(x.target.dataset.rel) || IMG.test(x.target.dataset.rel))) queue.push(x.target); } pump(); }, { root: results, rootMargin: '200px 0px' });
      results.querySelectorAll('.fv-tile').forEach(t => io.observe(t));
    } else {
      const rows = [];
      for (const g of groups) {
        rows.push(rowHtml(g.latest, g, 0, g.latest.rel === focusRel));
        if (open.has(g.latest.rel)) for (const earlier of g.earlier) rows.push(rowHtml(earlier, null, 1));
      }
      results.innerHTML = uiList({ id: `${uid}-list`, label: 'Files', cols: columns, cls: 'fv-list', attrs: { 'data-fv-list': '' }, head: headHtml(), rows });
    }
    // the selection is what is still shown: a filter or a sort keeps the rows that remain
    const shown = new Set(relsInOrder()), before = sel.size;
    sel = new Set([...sel].filter(r => shown.has(r))); if (sel.size !== before) tell();
    if (prefs.view === 'grid') fitNames();
    results.scrollTop = keepTop;
    if (revealNext) { revealNext = false; results.querySelector('.fv-sel')?.scrollIntoView({ block: 'nearest' }); }
  }

  /** Each tile's name in two lines at most, broken after a space, '_', '-' or '.', the extension whole; a longer one loses its middle. */
  function fitNames() {
    const first = results.querySelector('.fv-tile-name'); if (!first) return;
    const width = first.clientWidth, measure = measurer(first);
    if (!width) return;
    for (const el of results.querySelectorAll('.fv-tile-name')) {
      const f = fitName(el.dataset.name, { width: width - 1, measure });
      el.innerHTML = f.segments.map(esc).join('<wbr>');
    }
  }
  function clearFilter() {
    query = ''; found = null; prefs.kind = 'all'; save();
    const q = tools.querySelector(`[id="${uid}-q"]`); if (q) q.value = '';
    showPicked(`${uid}-kind`, 'Kind', kindName()); draw();
  }
  const entryOf = el => el?.closest?.('[data-rel]');
  const canOf = rel => o.ops.can(rel, !!elOf(rel)?.dataset.dir);
  const isDir = el => !!el?.dataset.dir;
  const rowEls = () => [...results.querySelectorAll('[data-rel]')].filter(el => !el.dataset.head);
  const relsInOrder = () => rowEls().map(el => el.dataset.rel);
  const elOf = rel => rowEls().find(el => el.dataset.rel === rel);
  const paint = ({ focus = false } = {}) => {
    for (const el of rowEls()) {
      const on = sel.has(el.dataset.rel), isLead = el.dataset.rel === lead;
      el.classList.toggle('fv-sel', on);
      if (el.matches('.fv-tile')) el.setAttribute('aria-selected', String(on));
      const btn = el.matches('[data-entry]') ? el : el.querySelector('[data-entry]');
      if (btn) { btn.tabIndex = isLead ? 0 : -1; if (isLead && focus) btn.focus({ preventScroll: true }); }
      if (isLead && focus) el.scrollIntoView({ block: 'nearest' });
    }
  };
  /** The inspector follows the lead row, and the title bar's status counts the selection; with nothing selected the inspector clears and the status counts the folder. */
  const tell = () => {
    const on = sel.size ? lead : '';
    o.onSelect?.(on, !!(on && elOf(on)?.dataset.dir));
    say();
  };
  // the title bar's status: the folder's count, or what is selected ("1 selected"; the inspector names it)
  let countText = '';
  const say = () => o.onStatus(sel.size && !found ? `${num(sel.size)} selected` : countText);
  /** Selects one path, or extends (Shift), or toggles (⌘), as a file manager does. */
  const pick = (rel, { shift = false, toggle = false, focus = false } = {}) => {
    const order = relsInOrder();
    if (shift && anchor && order.includes(anchor)) {
      const a = order.indexOf(anchor), b = order.indexOf(rel);
      sel = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)); lead = rel;
    } else if (toggle) { if (sel.has(rel)) sel.delete(rel); else sel.add(rel); lead = rel; anchor = rel; }
    else { sel = new Set([rel]); lead = rel; anchor = rel; }
    paint({ focus }); tell();
  };
  const cols = () => { const tiles = [...results.querySelectorAll('.fv-tile')]; if (tiles.length < 2) return 1; const y = tiles[0].offsetTop; let n = 0; for (const t of tiles) { if (t.offsetTop !== y) break; n++; } return n || 1; };
  const activate = (el, { side = false } = {}) => { const rel = el.dataset.rel; if (rel) o.open(rel, { dir: isDir(el), side, find: el.dataset.find || '' }); };
  const chosen = () => (sel.size ? [...sel] : lead ? [lead] : []);

  // ---- commands on the selection ----------------------------------------------------------------------------------------------------
  function beginRename(rel) {
    const el = elOf(rel); if (!el || !canOf(rel).rename) return;
    const nameEl = el.querySelector('.fv-entry-name') || el.querySelector('.fv-tile-name'); if (!nameEl) return;
    const original = baseName(rel), input = document.createElement('input');
    input.type = 'text'; input.className = 'fv-rename'; input.value = original; input.setAttribute('aria-label', `New name for ${original}`); input.spellcheck = false;
    renaming = rel; nameEl.hidden = true; nameEl.after(input); input.focus();
    const dot = original.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : original.length);
    let done = false;
    const finish = async commit => {
      if (done) return; done = true; renaming = null; input.remove(); nameEl.hidden = false;
      if (commit && input.value.trim() && input.value !== original) {
        const next = input.value.trim();
        if (await o.ops.rename(rel, next)) { const to = parentOf(rel) ? `${parentOf(rel)}/${next}` : next; sel = new Set([to]); lead = to; anchor = to; revealNext = true; }
        await load(); tell();
      }
      else elOf(rel)?.querySelector('[data-entry]')?.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('dblclick', e => e.stopPropagation());
  }
  /**
   * To the Trash after the explorer's question (it names what goes); never a deletion. The files' bytes are kept in memory first (up to UNDO_BYTES, files
   * only), so the notice that follows can put them back where they were; a folder, or more than that, can be put back from the Trash itself.
   */
  async function trash(rels) {
    let keep = [], total = 0;
    for (const rel of rels) {
      const e = items.entries.find(x => x.rel === rel) || items.archived.find(x => x.rel === rel);
      if (!e || e.dir || (total += e.size || 0) > UNDO_BYTES) { keep = null; break; }
      try { keep.push({ rel, bytes: await o.folder.read(rel) }); } catch { keep = null; break; }
    }
    if (!await o.ops.trash(rels)) return;
    const gone = [];
    for (const rel of rels) { try { if (!(await o.folder.stat(rel))?.exists) gone.push(rel); } catch { gone.push(rel); } }
    sel = new Set(); await load(); tell();
    if (gone.length) notice(gone, keep && keep.filter(k => gone.includes(k.rel)));
  }
  let noticeEl = null;
  function notice(gone, keep) {
    noticeEl?.remove();
    const text = `${gone.length === 1 ? baseName(gone[0]) : `${gone.length} items`} moved to the Trash`;
    noticeEl = document.createElement('div'); noticeEl.className = 'fv-notice';
    noticeEl.innerHTML = uiNotice({ id: `${uid}-trashed`, label: 'Moved to the Trash', text, float: true, dismissible: true, actions: keep?.length === gone.length ? [{ id: `${uid}-undo`, label: 'Undo', icon: 'undo' }] : [] });
    host.append(noticeEl);
    noticeEl.querySelector(`[id="${uid}-trashed-dismiss"]`)?.addEventListener('click', () => { noticeEl?.remove(); noticeEl = null; });
    noticeEl.querySelector(`[id="${uid}-undo"]`)?.addEventListener('click', async () => {
      noticeEl?.remove(); noticeEl = null;
      const back = [];
      for (const k of keep) { try { if (!(await o.folder.stat(k.rel))?.exists) { await o.folder.writeBytes(k.rel, k.bytes); back.push(k.rel); } } catch (err) { o.say?.(err.message); } }
      await load(); sel = new Set(back); lead = back[0] || lead; anchor = lead; paint(); tell();
      if (back.length) o.say?.(`${back.length === 1 ? baseName(back[0]) : `${back.length} items`} put back`);
    });
  }
  async function paste(into = o.rel) {
    if ((!copied.length && !cut.length) || !canOf(into).write) return;
    let made;
    if (cut.length) { const moving = cut; cut = []; await o.ops.moveInto(moving, into); made = into === o.rel ? moving.map(r => `${into ? `${into}/` : ''}${baseName(r)}`) : []; }
    else made = await o.ops.copyInto(copied, into);
    await load();
    if (made.length) { sel = new Set(made); lead = made[0]; anchor = lead; revealNext = true; draw(); tell(); }
  }
  async function moveTo(rels) { const to = await o.ops.moveTo(rels); if (to !== null && to !== undefined) { await o.ops.moveInto(rels, to); sel = new Set(); await load(); } }
  async function duplicate(rel) { const to = await o.ops.duplicate(rel); await load(); if (to) { sel = new Set([to]); lead = to; anchor = to; revealNext = true; draw(); tell(); } }

  /** The menu of a row or of the selection: what is done with this kind of file (the explorer's), then the file manager's own commands. */
  function menuFor(rels) {
    const first = rels[0], dir = !!elOf(first)?.dataset.dir, can = canOf(first);
    const many = rels.length > 1;
    const own = new Set(['Open', 'Open to the side', 'Reveal in Finder', 'Copy path', 'Rename', 'Move to Trash', 'Open in default app']);
    const typeItems = many ? [] : o.menu(first, dir).filter(x => x === '-' || (x && !own.has(x.label)));
    const trim = list => list.filter((x, i, a) => !(x === '-' && (a[i - 1] === '-' || i === 0 || i === a.length - 1)));
    const files = rels.filter(r => !elOf(r)?.dataset.dir), pasteInto = dir && !many && (copied.length || cut.length) && canOf(first).write;
    return trim([
      !many && { label: 'Open', icon: dir ? 'folder' : 'file', run: () => o.open(first, { dir }) },
      !many && !dir && { label: 'Open to the side', icon: 'split', run: () => o.open(first, { side: true }) },
      ...(many ? [{ label: `Open ${rels.length} items`, icon: 'file', run: () => rels.forEach(r => { const el = elOf(r); o.open(r, { dir: !!el?.dataset.dir }); }) }] : []),
      !many && o.onPreview && { label: 'Preview', icon: 'preview', meta: 'Space', run: () => { pick(first); o.onPreview(); } },
      ...typeItems,
      '-',
      can.rename && { label: many ? `Cut ${rels.length} items` : 'Cut', icon: 'cut', meta: '⌘X', run: () => { cut = [...rels]; copied = []; } },
      files.length > 0 && { label: many ? `Copy ${files.length} items` : 'Copy', icon: 'copy', meta: '⌘C', run: () => { copied = files; cut = []; } },
      pasteInto && { label: 'Paste into folder', icon: 'paste', meta: '⌘V', run: () => paste(first) },
      !many && !dir && can.write && { label: 'Duplicate', icon: 'duplicate', meta: '⌘D', run: () => duplicate(first) },
      '-',
      can.write && o.ops.compress && { label: many ? `Compress ${rels.length} items` : 'Compress', icon: 'archive', run: async () => { const to = await o.ops.compress(rels); await load(); if (to) { sel = new Set([to]); lead = to; anchor = to; revealNext = true; draw(); tell(); } } },
      !many && can.rename && { label: 'Rename', icon: 'rename', meta: 'F2', run: () => beginRename(first) },
      can.rename && { label: many ? `Move ${rels.length} items to…` : 'Move to…', icon: 'move', run: () => moveTo(rels) },
      '-',
      !many && { label: 'Copy path', icon: 'copy', run: () => o.ops.copyPath(first) },
      o.ops.copyName && { label: many ? `Copy ${rels.length} names` : 'Copy name', icon: 'copy', run: () => o.ops.copyName(rels) },
      !many && can.reveal && { label: 'Reveal in Finder', icon: 'folder', run: () => o.ops.reveal(first) },
      '-',
      can.trash && { label: many ? `Move ${rels.length} items to Trash` : 'Move to Trash', icon: 'trash', meta: '⌘⌫', danger: true, run: () => trash(rels) },
    ].filter(Boolean));
  }
  const setSort = column => { prefs = { ...prefs, sort: column, descending: false }; save(); try { localStorage.setItem(FOLDER_SORTS, JSON.stringify(rememberSort(readSorts(), o.rel, prefs))); } catch {} draw(); };

  // ---- events -----------------------------------------------------------------------------------------------------------------------
  results.addEventListener('click', e => {
    const sort = e.target.closest('[data-sort]');
    if (sort) { prefs = sortByColumn(prefs, sort.dataset.sort); save(); try { localStorage.setItem(FOLDER_SORTS, JSON.stringify(rememberSort(readSorts(), o.rel, prefs))); } catch {} draw(); results.querySelector(`[data-sort="${sort.dataset.sort}"]`)?.focus({ preventScroll: true }); return; }
    const more = e.target.closest('[data-more]');
    if (more) { e.preventDefault(); const r = more.dataset.more; if (!sel.has(r)) pick(r); showMenu(more, menuFor(chosen())); return; }
    const toggle = e.target.closest('[data-versions]');
    if (toggle) { const r = toggle.dataset.versions; if (open.has(r)) open.delete(r); else open.add(r); draw(); return; }
    const el = entryOf(e.target); if (!el || el.dataset.head) return;
    if (e.altKey && !e.shiftKey) { pick(el.dataset.rel, { focus: true }); activate(el, { side: true }); return; }
    pick(el.dataset.rel, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey, focus: true });
  });
  results.addEventListener('dblclick', e => { const el = entryOf(e.target); if (el && !el.dataset.head && !e.target.closest('[data-more],[data-versions],.fv-rename')) activate(el); });
  results.addEventListener('contextmenu', e => {
    const el = entryOf(e.target);
    if (el?.dataset.head) return;
    e.preventDefault();
    // on the empty part of the page: what can be done to the folder itself
    if (!el) {
      // the page's own menu: the folder's commands (the title bar's acts), what is copied or cut, the selection, the order and what is hidden
      const folder = o.menu(o.rel, true).filter(x => x && x !== '-');
      const own = folder.filter(x => ['New folder', 'Add files'].includes(x.label)), hidden = folder.find(x => /hidden file/.test(x.label));
      const write = canOf(o.rel).write, held = copied.length + cut.length;
      showMenu({ x: e.clientX, y: e.clientY }, [...own, ...(own.length ? ['-'] : []),
        { label: held > 1 ? `Paste ${held} items` : 'Paste', icon: 'paste', meta: '⌘V', disabled: !held || !write, run: () => paste() },
        { label: 'Select all', icon: 'check-square', meta: '⌘A', run: () => { sel = new Set(relsInOrder()); paint(); tell(); } }, '-',
        { label: 'Sort by', icon: 'sort', submenu: [['name', 'Name'], ['modified', 'Date modified'], ['size', 'Size'], ['type', 'Kind']].map(([k, l]) => ({ label: l, checked: prefs.sort === k, run: () => setSort(k) })) },
        ...(hidden ? [hidden] : [])]); return; }
    if (!sel.has(el.dataset.rel)) pick(el.dataset.rel);
    showMenu({ x: e.clientX, y: e.clientY }, menuFor(chosen()));
  });
  // A press on the empty part of the page (between tiles, below the last row) clears the selection; a drag from there draws a band, and what it
  // touches is selected (with Shift or ⌘, added to what was).
  let band = null;
  const local = e => { const r = results.getBoundingClientRect(); return [e.clientX - r.left + results.scrollLeft, e.clientY - r.top + results.scrollTop]; };
  results.addEventListener('pointerdown', e => {
    if (e.button !== 0 || entryOf(e.target) || e.target.closest('button,input,a,.fv-rename')) return;
    const [x, y] = local(e);
    band = { x, y, add: e.shiftKey || e.metaKey || e.ctrlKey, base: new Set(sel), moved: false, el: null, id: e.pointerId };
    results.focus({ preventScroll: true });
  });
  results.addEventListener('pointermove', e => {
    if (!band) return;
    if (!(e.buttons & 1)) { band = null; return; }   // the press ended where the page did not hear it (a scrollbar's own drag)
    const [x, y] = local(e);
    if (!band.moved && Math.hypot(x - band.x, y - band.y) < 4) return;
    if (!band.moved) try { results.setPointerCapture(band.id); } catch {}
    band.moved = true;
    if (!band.el) { band.el = document.createElement('div'); band.el.className = 'fv-band'; results.append(band.el); }
    const L = Math.min(x, band.x), T = Math.min(y, band.y), W = Math.abs(x - band.x), H = Math.abs(y - band.y);
    for (const [k, v] of [['x', L], ['y', T], ['w', W], ['h', H]]) band.el.style.setProperty(`--fv-band-${k}`, `${v}px`);
    const box = results.getBoundingClientRect(), hit = new Set(band.add ? band.base : []);
    for (const el of rowEls()) {
      const q = el.getBoundingClientRect(), ex = q.left - box.left + results.scrollLeft, ey = q.top - box.top + results.scrollTop;
      if (ex < L + W && ex + q.width > L && ey < T + H && ey + q.height > T) hit.add(el.dataset.rel);
    }
    sel = hit; lead = [...hit].at(-1) || lead; paint(); say();
  });
  const endBand = () => {
    if (!band) return;
    const b = band; band = null; b.el?.remove();
    if (!b.moved && !b.add) sel = new Set();
    paint(); tell();
  };
  results.addEventListener('pointerup', endBand);
  results.addEventListener('pointercancel', endBand);
  results.addEventListener('keydown', e => {
    if (e.target.closest('.fv-rename')) return;
    const el = entryOf(document.activeElement) || (document.activeElement === results ? elOf(lead) || rowEls()[0] : null);
    if (!el || !results.contains(el) || el.dataset.head) return;
    const order = relsInOrder(), i = Math.max(0, order.indexOf(lead)), grid = prefs.view === 'grid', mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') { const files = chosen().filter(r => !elOf(r)?.dataset.dir); if (files.length) { e.preventDefault(); copied = files; o.say?.(`${files.length === 1 ? baseName(files[0]) : `${files.length} items`} copied`); } return; }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'x') { const rels = chosen().filter(r => canOf(r).rename); if (rels.length) { e.preventDefault(); cut = rels; copied = []; o.say?.(`${rels.length === 1 ? baseName(rels[0]) : `${rels.length} items`} cut; paste to move`); } return; }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); return; }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') { const one = chosen()[0]; if (one && !elOf(one)?.dataset.dir && canOf(one).write) { e.preventDefault(); duplicate(one); } return; }
    const go = (to, extend) => { const rel = order[Math.max(0, Math.min(order.length - 1, to))]; if (rel) pick(rel, { shift: extend, focus: true }); };
    const page = Math.max(1, Math.floor(results.clientHeight / ((elOf(order[0])?.getBoundingClientRect().height) || 36)) - 1);
    if (e.key === 'Enter' || (mod && e.key === 'ArrowDown')) { e.preventDefault(); const picked = chosen().filter(r => elOf(r)); if (picked.length > 1) picked.forEach(r => o.open(r, { dir: !!elOf(r).dataset.dir })); else activate(elOf(lead) || el, { side: e.altKey }); return; }
    if (e.key === ' ' && !mod) { e.preventDefault(); o.onPreview?.(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(order); paint(); tell(); return; }
    if (e.key === 'Delete' || (mod && e.key === 'Backspace')) { const rels = chosen().filter(r => canOf(r).trash); if (rels.length) { e.preventDefault(); trash(rels); } return; }
    if (e.key === 'F2' && lead) { e.preventDefault(); beginRename(lead); return; }
    if (e.key === 'Escape' && sel.size) { e.preventDefault(); sel = new Set(); paint(); tell(); return; }   // the lead keeps the keyboard's place
    const step = { ArrowDown: grid ? cols() : 1, ArrowUp: grid ? -cols() : -1, ArrowRight: grid ? 1 : 0, ArrowLeft: grid ? -1 : 0 }[e.key];
    if (step) { if (mod) return; e.preventDefault(); go(i + step, e.shiftKey); return; }
    if (e.key === 'Home') { e.preventDefault(); go(0, e.shiftKey); return; }
    if (e.key === 'End') { e.preventDefault(); go(order.length - 1, e.shiftKey); return; }
    if (e.key === 'PageDown') { e.preventDefault(); go(i + page, e.shiftKey); return; }
    if (e.key === 'PageUp') { e.preventDefault(); go(i - page, e.shiftKey); return; }
    // typing jumps to the first name that starts with what was typed
    if (e.key.length === 1 && !mod && !e.altKey && e.key !== ' ') {
      const now = Date.now(); typed = now - typedAt > 700 ? e.key : typed + e.key; typedAt = now;
      const names = order.map(r => baseName(r).toLowerCase()), at = names.findIndex(n => n.startsWith(typed.toLowerCase()));
      if (at >= 0) { e.preventDefault(); go(at, false); }
    }
  });
  // drag: the rows dragged (the selection if the row is in it) onto a folder row or tile, or onto the tree
  let dragging = [];
  results.addEventListener('dragstart', e => {
    const el = entryOf(e.target); if (!el || el.dataset.head || !el.dataset.rel) return;
    if (!sel.has(el.dataset.rel)) pick(el.dataset.rel);
    dragging = chosen().filter(r => canOf(r).rename);
    if (!dragging.length) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(PATHS, JSON.stringify(dragging)); e.dataTransfer.setData('text/plain', dragging.join('\n'));
  });
  const clearDrop = () => results.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  results.addEventListener('dragend', () => { dragging = []; clearDrop(); });
  results.addEventListener('dragover', e => {
    const el = entryOf(e.target); clearDrop();
    if (!dragging.length || !el || !el.dataset.dir || dragging.includes(el.dataset.rel) || dragging.some(r => el.dataset.rel.startsWith(`${r}/`))) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop');
  });
  results.addEventListener('drop', async e => {
    const el = entryOf(e.target); clearDrop();
    if (!dragging.length || !el?.dataset.dir || dragging.includes(el.dataset.rel)) return;
    e.preventDefault(); const rels = dragging; dragging = [];
    await o.ops.moveInto(rels, el.dataset.rel); sel = new Set(); await load();
  });

  load();
  return {
    release() { live = false; stopPoll(); unwatch(); io?.disconnect(); queue = []; noticeEl = null; host.replaceChildren(); },
    refresh: load,
    redraw: () => load(),
    setGroup(on) { prefs = { ...readPreferences(), group: !!on }; save(); load(); },
    setFoldersFirst(on) { prefs = { ...readPreferences(), foldersFirst: !!on }; save(); draw(); },
    /** List or Grid: the title bar's view switch. */
    setView(view) { if (prefs.view === view) return; prefs = { ...prefs, view: view === 'grid' ? 'grid' : 'list' }; save(); draw(); },
    prefs: () => prefs,
    /** The filter row: `open` (drawn), `active` (it narrows the list). The title bar's Find in folder is pressed while it is open. */
    filter: () => ({ open: filterOpen, active: filtering() }),
    /** Opens the row and puts the keyboard in its field (⌘F). */
    openFilter,
    /** Find in folder: opens the row; pressed again, closes it and lets go of what it narrowed. */
    toggleFilter() { if (filterOpen) closeFilter(); else openFilter(); },
    /** How many entries the folder hides (names that start with a dot, system files) while hidden files are not shown. */
    hidden: () => (hiddenShown() ? 0 : hiddenCount),
    /** Selects a row (by path) even before the folder is listed; `reveal` scrolls it into view once drawn. */
    select(rel, { reveal = false } = {}) { revealNext = reveal; sel = new Set([rel]); lead = rel; anchor = rel; if (drawn) { draw(); paint(); } },
    /** Draws the rows again without listing the folder (a phrase changed). */
    repaint: () => draw(),
    /** One entry as listed, with the versions group it leads, for the inspector. */
    entryOf(rel) {
      const all = [...items.entries, ...items.archived], e = all.find(x => x.rel === rel);
      if (!e) return null;
      const g = prefs.group ? groupVersions(items.entries, items.archived).find(x => x.latest.rel === rel || x.earlier.some(y => y.rel === rel)) : null;
      return { entry: e, group: g ? { latest: g.latest, earlier: g.earlier } : null };
    },
    focus: () => ({ kind: 'file', label: baseName(o.rel) || o.folder.name || 'Files', detail: o.rel || '' }),
    selected: () => lead,
    selection: () => [...sel],
    beginRename,
  };
}
