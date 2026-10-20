// Tables and figures, Show: Package (plan, package amendment of 2026-10-16): the paper's tables and figures arranged in parts, one document
// each. A part is a block: its head says the file it builds and where it stands (Built v3; Changed since v3: 2 captions; Never built; Cannot
// build: the reason) with Build and its More; its items are rows with their label (Table S1), title and source. Selecting an item opens its
// caption, notes and page settings under its part's list. Loaded on first use of the switch (views/outputs.mjs). A table's editor previews its grid:
// a header or a row's first cell drops that column or row, and New table from selection makes a table of what is kept (lib/package-select.mjs).
import { get, getVersion, update } from '../store.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { emptyState, esc } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk, askText, ask } from '../lib/dialog.mjs';
import { emptyPackage, labels, moveItem, removeItem, removePart, setItem, addItem, addPart, partOf, plainText, partState } from '../lib/package.mjs';

let state = { folder: null, say: () => {}, el: null, open: '', repo: null };
// a table item's grid as drawn from its source, before its selection: id -> { key, grid } or { key, error }; reloaded when the source or the
// project's values change, the previous grid shown meanwhile
const grids = new Map(), loading = new Set();
const PREVIEW_ROWS = 200;
const pkgOf = s => s.package || emptyPackage();
const baseOf = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);

// the app's drawings (lib/app-items.mjs): what an app item reads is signed to say whether its data changed since the build; loaded with the page
let appLib = null;
const appReady = () => appLib || import('../lib/app-items.mjs').then(m => { appLib = m; redraw(); return m; });
const sigOf = () => (appLib ? key => appLib.appSig(get(), key) : null);
const appLoad = async () => (await appReady()).appLoader(get());
// a held copy (a table or picture read from a document, kept in .lykos/package under its content's hash) says the document it came from
const sourceWords = src => (src?.app ? (appLib ? (v => (v ? `Drawn by ${v}` : 'Not drawn now'))(appLib.appItems(get()).find(x => x.key === src.app)?.view) : 'Drawn by the app')
  : src?.held ? (src.from ? `From ${baseOf(src.from)}` : 'Kept in the project') : baseOf(src?.path || ''));

function partHtml(pkg, part, L) {
  const st = partState(pkg, part, { state: get(), sigOf: sigOf() });
  const head = uiBar({ kind: 'head', id: `pkg-head-${part.id}`, cls: 'pkg-part-head', label: part.name, lead: { title: part.name, level: 'h2' },
    status: { id: `pkg-state-${part.id}`, text: st.state, ch: 18 },
    actions: [{ id: `pkg-build-${part.id}`, label: 'Build', role: 'primary', attrs: { 'data-pkg-build': part.id } }],
    overflow: [{ id: `pkg-page-${part.id}`, label: 'Page setup…', attrs: { 'data-pkg-act': 'page', 'data-part': part.id } },
      { id: `pkg-formats-${part.id}`, label: 'Formats…', attrs: { 'data-pkg-act': 'formats', 'data-part': part.id } },
      { id: `pkg-versions-${part.id}`, label: 'Versions…', attrs: { 'data-pkg-act': 'versions', 'data-part': part.id } },
      { id: `pkg-rename-${part.id}`, label: 'Rename part…', attrs: { 'data-pkg-act': 'rename', 'data-part': part.id } },
      { id: `pkg-roblog-${part.id}`, label: 'Add risk-of-bias decision log', attrs: { 'data-pkg-act': 'add-rob-log', 'data-part': part.id } },
      { id: `pkg-supp-${part.id}`, label: 'Add supplementary tables', attrs: { 'data-pkg-act': 'add-supplement', 'data-part': part.id } },
      '-', { id: `pkg-remove-${part.id}`, label: 'Remove part', danger: true, attrs: { 'data-pkg-act': 'remove-part', 'data-part': part.id } }] });
  const rows = part.items.map(id => {
    const it = pkg.items[id];
    return uiRow({ cls: `pkg-item${state.open === id ? ' is-open' : ''}`, attrs: { 'data-item': id, 'data-target': `package:${id}` },
      main: { html: `<button type="button" class="out-title" data-pkg-open="${esc(id)}"><span class="pkg-label">${esc(L.get(id))}</span> <span class="pkg-title">${esc(plainText(it.title, x => L.get(x)) || 'Untitled')}</span></button>`,
        detail: [sourceWords(it.source), it.orient === 'landscape' ? 'Landscape' : ''].filter(Boolean).map(esc) },
      end: uiRowEnd({ more: { label: `More for ${L.get(id)}`, attrs: { 'data-pkg-more': id } } }) });
  });
  // the open item's editor follows its part's list: beside the item it edits at every width, with no second column to place
  const editor = part.items.includes(state.open) ? editorHtml(pkg, state.open, L) : '';
  return `<section class="pkg-part" data-part="${esc(part.id)}">${head}<p class="meta pkg-part-meta">${esc([baseOf(part.file), st.detail].filter(Boolean).join(' · '))}</p>${uiList({ id: `pkg-list-${part.id}`, label: part.name, rows, empty: '<p class="meta">No items yet</p>' })}${editor}</section>`;
}

const gridKey = it => `${JSON.stringify(it.source)}${it.source?.evidence || it.source?.app ? `@${getVersion()}` : ''}`;
async function loadGrid(id) {
  const it = pkgOf(get()).items[id];
  if (!it || loading.has(id)) return;
  loading.add(id);
  const key = gridKey(it);
  try {
    const { loadSources } = await import('../lib/package-sources.mjs');
    const got = (await loadSources(state.folder, [{ ...it, keep: undefined }], { state: get(), app: it.source?.app ? await appLoad() : null })).get(id) || { error: 'No source' };
    grids.set(id, { key, ...got });
  } catch (err) { grids.set(id, { key, error: String(err?.message || err) }); }
  finally { loading.delete(id); }
  // only the grid is drawn again, so a caption being typed keeps its caret
  const host = state.open === id && state.el?.querySelector('#pkg-grid-host');
  if (host) host.innerHTML = gridHtml(pkgOf(get()).items[id], grids.get(id));
}
/** A table item's preview: the count kept, New table from selection, then the grid with every header and row toggle. */
function gridHtml(it, got) {
  if (!got) return '<p class="meta">Reading the table…</p>';
  if (got.error) return `<p class="meta">${esc(got.error)}</p>`;
  const g = got.grid, keep = it.keep || {}, head = g.rows[0]?.cells || [], body = g.rows.slice(1);
  const colKey = c => String(head[c]?.text ?? ''), rowKey = r => r.key || String(r.cells?.[0]?.text ?? '');
  const colIn = c => !keep.cols || keep.cols.includes(colKey(c)), rowIn = r => !keep.rows || keep.rows.includes(rowKey(r));
  const nCols = head.filter((_, c) => colIn(c)).length, nRows = body.filter(rowIn).length;
  const count = `${nRows} ${nRows === 1 ? 'row' : 'rows'} · ${nCols} ${nCols === 1 ? 'column' : 'columns'}`;   // what is kept; the rest shows struck through
  const bar = uiBar({ kind: 'head', id: 'pkg-grid-head', label: 'Rows and columns', lead: { title: 'Rows and columns', level: 'h3' }, status: { id: 'pkg-grid-count', text: count, ch: 24 },
    actions: [{ id: 'pkg-from-sel', label: 'New table from selection', menu: true, attrs: { 'data-pkg-act': 'from-selection' } }],
    overflow: [{ id: 'pkg-show-all', label: 'Show all', disabled: !it.keep, attrs: { 'data-pkg-act': 'show-all' } }] });
  const toggle = (attr, key, text, kept) => `<button type="button" class="pkg-keep${kept ? '' : ' is-dropped'}" ${attr}="${esc(key)}" aria-pressed="${kept}" title="${kept ? 'Leave out' : 'Bring back'}">${esc(text)}</button>`;
  const th = head.map((c, i) => `<th scope="col">${toggle('data-pkg-keep-col', colKey(i), c.text ?? '', colIn(i))}</th>`).join('');
  const tr = body.slice(0, PREVIEW_ROWS).map(r => {
    const kept = rowIn(r);
    const cells = r.cells.map((c, i) => i === 0 ? `<th scope="row">${toggle('data-pkg-keep-row', rowKey(r), c.merged ? '↳' : c.text ?? '', kept)}</th>`
      : `<td class="${colIn(i) ? '' : 'is-dropped'}">${c.merged ? '' : esc(c.text ?? '')}</td>`).join('');
    return `<tr class="${kept ? '' : 'is-dropped'}">${cells}</tr>`;
  }).join('');
  const more = body.length > PREVIEW_ROWS ? `<p class="meta">First ${PREVIEW_ROWS} of ${body.length} rows</p>` : '';
  return `${bar}<div class="pkg-grid-scroll"><table class="pkg-grid"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${more}`;
}
function previewHtml(it) {
  const got = grids.get(it.id);
  if (!got || got.key !== gridKey(it)) queueMicrotask(() => loadGrid(it.id));
  return `<div class="pkg-preview" id="pkg-grid-host">${gridHtml(it, got)}</div>`;
}

function editorHtml(pkg, id, L) {
  const it = pkg.items[id];
  if (!it) return '';
  const field = (name, label, value, rows = 2) => `<label class="pkg-field"><span>${label}</span><textarea data-pkg-field="${name}" rows="${rows}">${esc(value || '')}</textarea></label>`;
  const refs = [...new Set([it.title, it.legend, ...(it.notes || [])].flatMap(t => [...String(t || '').matchAll(/\{\{xref:([A-Za-z0-9._-]+)\}\}/g)].map(m => m[1])))];
  return `<aside class="pkg-editor" aria-label="${esc(L.get(id))}">${field('title', 'Title', it.title, 1)}${field('legend', 'Legend', it.legend, 4)}${it.kind === 'table' ? field('notes', 'Notes, one per line', (it.notes || []).join('\n'), 4) + previewHtml(it) : ''}
    ${refs.length ? `<p class="meta pkg-refs">References: ${refs.map(r => esc(L.get(r) || '[removed item]')).join(', ')}</p>` : ''}
    ${uiBar({ kind: 'foot', id: 'pkg-editor-foot', label: 'Item', actions: [{ id: 'pkg-ref', label: 'Insert reference', attrs: { 'data-pkg-act': 'ref' } }],
      overflow: [{ id: 'pkg-orient', label: 'Orientation…', attrs: { 'data-pkg-act': 'orient' } }, { id: 'pkg-same', label: it.samePage ? 'Start on a new page' : 'Same page as the previous item', attrs: { 'data-pkg-act': 'same' } },
        '-', { id: 'pkg-remove', label: 'Remove from the package', danger: true, attrs: { 'data-pkg-act': 'remove-item' } }] })}</aside>`;
}

/** Draws the page again from the project (after any change the page did not make itself). */
export function redraw() {
  if (!state.el) return;
  const pkg = pkgOf(get()), L = labels(pkg);
  if (!pkg.parts.length) {
    state.el.innerHTML = emptyState({ icon: 'outputs', title: 'No package yet', actions: [{ id: 'pkg-empty-import', label: 'Read from the folder\'s documents…', primary: true }, { id: 'pkg-empty-add', label: 'Add part' }] });
    state.el.querySelector('#pkg-empty-import')?.setAttribute('data-pkg-act', 'import');
    state.el.querySelector('#pkg-empty-add')?.setAttribute('data-pkg-act', 'add-part');
    return;
  }
  state.el.innerHTML = `<div class="pkg-page">${pkg.parts.map(p => partHtml(pkg, p, L)).join('')}</div>`;
}
const change = fn => { update(s => { s.package = pkgOf(s); fn(s.package); return s; }); redraw(); };

export function open(id) { state.open = id; redraw(); }
/** Moves the open item up or down within its part (⌥↑, ⌥↓). */
export function move(id, delta) { change(pkg => { const part = partOf(pkg, id); moveItem(pkg, id, part.id, part.items.indexOf(id) + delta); }); }
export function moveTo(id, partId) { change(pkg => moveItem(pkg, id, partId, Infinity)); }
/** A field of the open item typed into: stored without a redraw, so the field keeps its caret. */
export function input(field, value) {
  if (!state.open) return;
  const v = field === 'notes' ? String(value).split('\n').map(x => x.trim()).filter(Boolean) : value;
  update(s => { s.package = pkgOf(s); setItem(s.package, state.open, { [field]: v }); return s; });
}

/** Builds a part into the folder (lib/package-write.mjs); `note` is kept with the version. */
export async function build(partId, { note = null } = {}) {
  if (note == null) { note = await askText('Note for this version', { placeholder: 'What changed (optional)', confirm: 'Build' }); if (note == null) return null; }
  const { buildPart } = await import('../lib/package-write.mjs');
  const pkg = structuredClone(pkgOf(get()));
  let res;
  try { res = await buildPart(state.folder, pkg, partId, { repo: state.repo, note, state: get(), app: await appLoad() }); }
  catch (err) { state.say(`Not built: ${err.message}`); return null; }
  // an unchanged build may still read its drawings' data again (lib/package-write.mjs), so the record is kept either way
  if (res.status === 'built' || res.status === 'unchanged') update(s => { s.package = pkg; return s; });
  state.say(res.status === 'blocked' ? `Cannot build: ${res.problems.map(p => p.text).join('; ')}` : res.status === 'unchanged' ? `No change since v${res.version}`
    : `Built v${res.version}: ${res.files.map(f => baseOf(f.path)).join(', ')}${res.openInWord.length ? `. Open in Word: ${res.openInWord.join(', ')}` : ''}`);
  redraw();
  return res;
}

/** Drops a column or row of the open table from its selection, or brings it back. */
export async function keepToggle(id, which) {
  const got = grids.get(id);
  if (!got?.grid) return;
  const { toggleKeep } = await import('../lib/package-select.mjs');
  change(pkg => setItem(pkg, id, { keep: toggleKeep(pkg.items[id].keep, got.grid, which) }));
}
/** A new table of what the open table keeps: in a part (`{ partId }`) or a new document (`{ newPart: { name, file } }`); it opens. */
export async function newFromSelection(id, where) {
  const { fromSelection } = await import('../lib/package-select.mjs');
  let made = null;
  try { change(pkg => { made = fromSelection(pkg, id, where, get()); }); }
  catch (err) { state.say(err.message); return null; }
  const pkg = pkgOf(get());
  state.open = made.id; redraw();
  state.say(`New table in ${partOf(pkg, made.id)?.name}`);
  return made;
}
async function askNewPart(id) {
  const pkg = pkgOf(get()), from = partOf(pkg, id);
  const name = await ask('Name of the new document', { value: `${from?.name || 'Tables'}, short`, confirm: 'Add' });
  if (!name) return;
  const dir = from?.file.includes('/') ? from.file.slice(0, from.file.lastIndexOf('/')) : 'Package';
  await newFromSelection(id, { newPart: { name, prefix: from?.prefix || '', file: `${dir}/${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} v1.docx` } });
}

function insertRef(id) {
  const ta = state.el.querySelector('[data-pkg-field="legend"]'); if (!ta) return;
  const at = ta.selectionStart ?? ta.value.length;
  ta.value = `${ta.value.slice(0, at)}{{xref:${id}}}${ta.value.slice(ta.selectionEnd ?? at)}`;
  input('legend', ta.value); redraw();
}

/** Commands from the page and the title bar (views/outputs.mjs forwards its pkg-* acts here). */
export async function act(name, { anchor = null, part = null } = {}) {
  const pkg = pkgOf(get());
  if (name === 'add-part') {
    const n = await ask('Name of the part', { value: `Part ${pkg.parts.length + 1}`, confirm: 'Add' });
    if (!n) return;
    try { change(k => addPart(k, { name: n, prefix: /supplement/i.test(n) ? 'S' : '', file: `Package/${n} v1.docx` })); } catch (err) { state.say(err.message); }
    return;
  }
  if (name === 'import') {
    const { importDocx } = await import('../lib/package-import.mjs');
    const { projectFiles } = await import('../lib/folder-results.mjs');
    const docs = (await projectFiles(state.folder)).filter(f => /\.docx$/i.test(f.path) && !/(^|\/)~\$/.test(f.path)).sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    if (!docs.length) { state.say('The project folder has no Word documents'); return; }
    showMenu(anchor, docs.map(d => ({ label: baseOf(d.path), meta: d.path.slice(0, Math.max(0, d.path.length - baseOf(d.path).length - 1)), run: async () => {
      const next = structuredClone(pkgOf(get()));
      const r = await importDocx(state.folder, next, d.path).catch(err => ({ error: err.message }));
      if (r.error) { state.say(r.error); return; }
      update(st => { st.package = next; return st; }); state.say(`Read ${r.count} items from ${baseOf(d.path)}`); redraw();
    } })), { align: 'end', minWidth: 320 });
    return;
  }
  if (name === 'add-supplement') {
    // the supplementary tables are written from the project at each build (lib/supplement-doc.mjs); one per part
    if (pkg.parts.find(p => p.id === part)?.items.some(id => pkg.items[id]?.source?.generated === 'supplement')) { state.say('This part already has the supplementary tables'); return; }
    change(k => addItem(k, part, { kind: 'document', source: { generated: 'supplement' }, title: 'Supplementary material' }));
    state.say('Added: written from the project at each build');
    return;
  }
  if (name === 'add-rob-log') {
    // the log is written from the appraisal state at each build (lib/rob-log.mjs); one per part
    const have = pkg.parts.find(p => p.id === part)?.items.some(id => pkg.items[id]?.source?.generated === 'rob-log');
    if (have) { state.say('This part already has the decision log'); return; }
    change(k => addItem(k, part, { kind: 'document', source: { generated: 'rob-log' }, title: 'Risk-of-bias decision log' }));
    state.say('Added: written from the appraisal at each build');
    return;
  }
  if (name === 'build-changed') {
    await appReady();
    for (const p of pkg.parts) { const { state: st } = partState(pkgOf(get()), p, { state: get(), sigOf: sigOf() }); if (st.startsWith('Changed') || st === 'Never built') await build(p.id); }
    return;
  }
  if (name === 'remove-part') {
    if (await confirmAsk('Remove this part?', { detail: 'Its items leave the package. Files already built stay in the folder.', confirm: 'Remove', danger: true })) change(k => removePart(k, part));
    return;
  }
  if (name === 'remove-item') { const id = state.open; state.open = ''; change(k => removeItem(k, id)); return; }
  if (name === 'ref') { const L = labels(pkg); showMenu(anchor, [...L].filter(([id]) => id !== state.open).map(([id, l]) => ({ label: `${l} · ${plainText(pkg.items[id].title, x => L.get(x))}`, run: () => insertRef(id) })), { align: 'start' }); return; }
  if (name === 'from-selection') {
    const id = state.open;
    showMenu(anchor, [...pkg.parts.map(p => ({ label: `In ${p.name}`, run: () => newFromSelection(id, { partId: p.id }) })), '-', { label: 'In a new document…', run: () => askNewPart(id) }], { align: 'end' });
    return;
  }
  if (name === 'show-all') { change(k => setItem(k, state.open, { keep: undefined })); return; }
  if (name === 'same') { change(k => setItem(k, state.open, { samePage: k.items[state.open].samePage ? undefined : true })); return; }
  if (name === 'orient') { showMenu(anchor, [['', 'Part default'], ['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, l]) => ({ label: l, run: () => change(k => setItem(k, state.open, { orient: v || undefined })) })), { align: 'start' }); return; }
  if (['page', 'formats', 'rename', 'versions', 'files'].includes(name)) { (await import('./package-dialogs.mjs'))[name](anchor, { part, state, change, redraw }); }
}

function onClick(e) {
  const t = e.target.closest('[data-pkg-open],[data-pkg-build],[data-pkg-act],[data-pkg-more],[data-pkg-keep-col],[data-pkg-keep-row]');
  if (!t) return;
  if (t.dataset.pkgKeepCol != null) { keepToggle(state.open, { col: t.dataset.pkgKeepCol }); return; }
  if (t.dataset.pkgKeepRow != null) { keepToggle(state.open, { row: t.dataset.pkgKeepRow }); return; }
  if (t.dataset.pkgOpen) { open(t.dataset.pkgOpen); return; }
  if (t.dataset.pkgBuild) { build(t.dataset.pkgBuild); return; }
  if (t.dataset.pkgMore) {
    const id = t.dataset.pkgMore, pkg = pkgOf(get());
    showMenu(t, [...pkg.parts.filter(p => p !== partOf(pkg, id)).map(p => ({ label: `Move to ${p.name}`, run: () => moveTo(id, p.id) })),
      '-', { label: 'Remove from the package', danger: true, run: () => change(k => removeItem(k, id)) }], { align: 'end' });
    return;
  }
  act(t.dataset.pkgAct, { anchor: t, part: t.dataset.part });
}
function onKey(e) {
  if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || !state.open || e.target.closest?.('textarea')) return;
  e.preventDefault();
  const id = state.open;
  move(id, e.key === 'ArrowUp' ? -1 : 1);
  state.el.querySelector(`[data-pkg-open="${CSS.escape(id)}"]`)?.focus();
}
function onInput(e) { const f = e.target.closest?.('[data-pkg-field]'); if (f) input(f.dataset.pkgField, f.value); }

export function mountPackage(el, { say = () => {}, folder = null, repo = null } = {}) {
  state = { ...state, el, say, folder, repo };
  redraw();
  if (!appLib && Object.values(pkgOf(get()).items).some(it => it.source?.app)) appReady();
  el.addEventListener('click', onClick); el.addEventListener('keydown', onKey); el.addEventListener('input', onInput);
  return () => { el.removeEventListener?.('click', onClick); el.removeEventListener?.('keydown', onKey); el.removeEventListener?.('input', onInput); if (state.el === el) state.el = null; };
}

/**
 * Extraction → More → Make a table from this view…: the parts to put the table in, a new document last. `view` is { templateId, studies,
 * fields, title }; `done(item, part)` runs once the table is in the package.
 */
export function addTableFromView(anchor, view, done = () => {}) {
  const put = async where => {
    const { tableFromView } = await import('../lib/package-select.mjs');
    let made = null;
    try { change(pkg => { made = tableFromView(pkg, view, where); }); } catch (err) { state.say(err.message); return; }
    state.open = made.id;
    done(made, partOf(pkgOf(get()), made.id));
  };
  const askPart = async () => {
    const name = await ask('Name of the new document', { value: view.title || 'Tables', confirm: 'Add' });
    if (name) await put({ newPart: { name, file: `Package/${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} v1.docx` } });
  };
  showMenu(anchor, [...pkgOf(get()).parts.map(p => ({ label: `In ${p.name}`, run: () => put({ partId: p.id }) })), ...(pkgOf(get()).parts.length ? ['-'] : []),
    { label: 'In a new document…', run: askPart }], { align: 'end' });
}

/**
 * Add to package…: the parts to add an item to, a new part last. A folder file (`path`), or a table or figure the app draws (`source`, from
 * lib/app-items.mjs sourceOfKey, with its `title`); `done(item, part)` runs once it is in.
 */
export function addToPackage(anchor, { path = '', kind, source = null, title = '' }, done = () => {}) {
  const pkg = pkgOf(get()), name = title || baseOf(path).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const put = partId => {
    let made = null;
    change(k => { made = addItem(k, partId, { kind, source: source || { path }, title: name }); });
    const part = partOf(pkgOf(get()), made.id), label = labels(pkgOf(get())).get(made.id);
    if (state.el?.isConnected) state.say(`Added to ${part.name} as ${label}`);
    done(made, part, label);
  };
  const newPart = async () => {
    const n = await ask('Name of the part', { value: kind === 'table' ? 'Tables' : 'Figures', confirm: 'Add' });
    if (!n) return;
    let id = '';
    try { change(k => { id = addPart(k, { name: n, prefix: /supplement/i.test(n) ? 'S' : '', file: `Package/${n.replace(/[\\/:*?"<>|]+/g, ' ').trim()} v1.docx` }).id; }); } catch (err) { state.say(err.message); return; }
    put(id);
  };
  showMenu(anchor, [...pkg.parts.map(p => ({ label: p.name, run: () => put(p.id) })), ...(pkg.parts.length ? ['-'] : []), { label: 'New part…', run: newPart }], { align: 'end' });
}
