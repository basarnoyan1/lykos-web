// The JSON parts of the Files text editor (views/file-doc.mjs editor()): for a .json, .geojson, .jsonl or .ndjson file the tools bar shows
// whether the text is valid (the status: valid, or the line and column of the first error; the message: the error, or the path of the caret),
// a Text | Tree switch, Format (⌘⇧F) and the Format options menu beside Save; Repair, Minify, copying and export are in More.
//
// Every act edits the editor's text as one undoable step (⌘Z, or Undo format in More) and never writes to disk: Save does that, with the
// file's own line endings and byte order mark (lib/line-endings.mjs). The tree is read-only and drawn TREE_PAGE rows at a time.
// The logic is lib/file-json.mjs; this module only draws and wires it.
import * as J from '../lib/file-json.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { saveFile } from '../lib/save.mjs';
import { baseName } from '../lib/fsys.mjs';

const extOf = rel => String(rel).slice(String(rel).lastIndexOf('.') + 1).toLowerCase();
/** Whether a file opens with the JSON tools. */
export const isJsonFile = rel => J.JSON_EXT.has(extOf(rel));

// The options are the person's, for every JSON file in this app (a browser preference like the folder page's hidden files).
const KEY = 'lykos.files.json';
let prefs = null;
export const jsonOptions = () => prefs ||= (() => { try { return J.cleanOptions(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return J.cleanOptions({}); } })();
function setOptions(change) {
  prefs = J.cleanOptions({ ...jsonOptions(), ...change });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
}

const num = n => Number(n).toLocaleString('en');
/** A count that fits a 12-character slot with its noun: 9,999, then 352k, then 1.2M. */
const short = n => (n < 10000 ? num(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`);
const where = e => { const s = `Line ${num(e.line)}, col ${num(e.column)}`; return s.length <= 16 ? s : `${e.line}:${e.column}`; };

/**
 * The JSON mode of one editor. `ta` is its textarea, `b` the document body; `say` reports in the title bar. Returns the bar's declaration
 * (spec, actions, overflow, each with run) and wire(bar), called once the bar is placed.
 */
export function jsonMode(ops, { ta, b }) {
  const u = ops.uid, lines = J.LINES_EXT.has(extOf(ops.rel)), id = s => `${u}-j-${s}`;
  let result = null, checked = null;          // the last check and the text it was made of
  let view = 'text', bar = null, undoText = null;
  // the tree's state belongs to one text: a node's id is its offset
  let open = null, found = null, query = '', shown = J.TREE_PAGE, selected = -1, treeOf = null;

  const spec = {
    status: { id: id('status'), text: '', ch: 16 },
    message: { id: id('msg'), text: '' },
    budget: { n: 4, reason: 'a JSON file: Text or Tree, Format, its options and Save' },
    view: { id: id('view'), label: 'Show', attr: 'data-json-view', value: 'text', items: [['text', 'Text'], ['tree', 'Tree']] },
  };
  const actions = [
    { id: id('format'), label: 'Format', icon: 'indent', role: 'primary', kbd: '⌘⇧F', run: () => formatAll() },
    { id: id('options'), label: 'Options', icon: 'settings', role: 'quiet', menu: true, attrs: { 'aria-label': 'Format options' }, run: btn => optionsMenu(btn) },
  ];
  const overflow = [
    { id: id('repair'), label: 'Repair', disabled: true, run: () => doRepair() },
    { id: id('goto'), label: 'Go to error', disabled: true, run: () => goToError() },
    lines ? { id: id('expand'), label: 'Pretty-print this line', run: () => expandLine() } : { id: id('minify'), label: 'Minify', run: () => formatAll({ minify: true }) },
    { id: id('sort'), label: 'Sort keys in selection', run: () => sortSelected() },
    { id: id('undo'), label: 'Undo format', disabled: true, run: () => undoAct() },
    '-',
    { id: id('copy-path'), label: 'Copy path', disabled: true, run: () => copy(pathHere()?.path, 'Path copied') },
    { id: id('copy-min'), label: 'Copy as minified', run: () => copyMinified() },
    { id: id('csv'), label: 'Export as CSV…', disabled: true, run: () => exportCsv() },
    '-',
    { id: id('wrap'), label: 'Wrap lines', checked: jsonOptions().wrap, run: () => setWrap(!jsonOptions().wrap) },
    '-',
  ];

  // ---- checking ---------------------------------------------------------------------------------------------------------------
  const current = () => (checked === ta.value ? result : null);
  function recheck(force = false) {
    const text = ta.value;
    if (checked === text) return result;
    if (!force && text.length > J.LIVE_MAX) { result = null; checked = null; paintStatus(); return null; }
    result = J.check(text, { lines }); checked = text;
    open = null; found = null; selected = -1; shown = J.TREE_PAGE; treeOf = null;
    paintStatus();
    return result;
  }
  const q = s => bar?.querySelector(`[id="${id(s)}"]`);
  const setEntry = (s, on, label) => { const el = q(s); if (!el) return; el.disabled = !on; if (label && el.textContent !== label) el.textContent = label; };
  function pathHere() {
    const r = current();
    return r && (r.ok || (lines && r.records?.length)) ? J.pathAt(ta.value, r, ta.selectionStart) : null;
  }
  function paintStatus() {
    if (!bar) return;
    const r = current(), status = q('status'), msg = q('msg');
    let s = '', m = '';
    if (!r) s = 'Not checked';
    else if (r.empty) s = 'Empty';
    else if (r.ok) { s = lines ? (r.records.length === 1 ? '1 line' : `${num(r.records.length)} lines`) : 'Valid JSON'; m = (view === 'tree' ? rowsById.get(selected)?.path : pathHere()?.path) || ''; }
    else {
      const e = r.error, more = lines && r.errors.length > 1 ? `, ${num(r.errors.length)} lines with errors` : '';
      s = where(e); m = `${e.message}${more}`;
    }
    if (status && status.textContent !== s) status.textContent = s;
    if (msg && msg.textContent !== m) { msg.textContent = m; msg.title = m; }
    msg?.toggleAttribute('data-json-error', !!r && !r.ok && !r.empty);
    const valid = !!r && (r.ok || (lines && r.spans));
    setEntry('repair', !!r?.repair, r?.repair ? `Repair ${r.repair.total === 1 ? '1 issue' : `${num(r.repair.total)} issues`}` : 'Repair');
    setEntry('goto', !!r && !r.ok && !r.empty);
    setEntry('minify', valid); setEntry('copy-min', valid);
    setEntry('copy-path', !!pathHere());
    setEntry('csv', !!r?.ok && csvShaped(r));
  }
  // an array of objects whose first values are not containers: checked again in full when exported
  const csvShaped = r => { const items = r.lines ? r.records.map(x => x.node) : r.root?.k === 'a' ? r.root.v : []; return items.length > 0 && items.slice(0, 50).every(n => n.k === 'o' && n.v.every(v => v.k !== 'o' && v.k !== 'a')); };

  // ---- editing as one undoable step -----------------------------------------------------------------------------------------------
  // The browser's own editing (insertText) keeps ⌘Z's history whole, but its cost grows with the square of the text (measured in Chromium:
  // 25 KB 57 ms, 100 KB 1 s, 500 KB 27 s), so a larger edit sets the text and keeps its own one-step undo: ⌘Z and Undo format give the text
  // back as it was, ⌘⇧Z puts the edit back. Such an edit clears the browser's history of the typing before it.
  const EXEC_MAX = 32 * 1024;
  let own = null;                              // { before, after, selection } of the last large edit
  /** Replaces [from, to) with `insert` as one undoable step and selects [selFrom, selTo). */
  function edit(from, to, insert, selFrom = from, selTo = from + insert.length, show = true) {
    ta.focus();
    let done = false;
    if (insert.length <= EXEC_MAX && to - from <= EXEC_MAX) {
      ta.setSelectionRange(from, to);
      try { done = document.execCommand('insertText', false, insert); } catch {}
      own = null;
    }
    if (!done) {
      const before = ta.value, at = ta.selectionStart;
      ta.value = before.slice(0, from) + insert + before.slice(to);
      own = { before, after: ta.value, at };
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    undoText = ta.value;
    setEntry('undo', true);
    if (show) reveal(selFrom, selTo);
  }
  const putBack = (text, at) => { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); reveal(Math.min(at, text.length)); };
  function undoAct() {
    if (undoText == null || ta.value !== undoText) return;
    if (view !== 'text') setView('text');
    if (own && own.after === ta.value) { const o = own; own = { ...o, undone: true }; putBack(o.before, o.at); }
    else { ta.focus(); try { document.execCommand('undo'); } catch {} }
    undoText = null; setEntry('undo', false);
  }
  /** ⌘Z right after a large edit takes it back; ⌘⇧Z right after that puts it back. */
  function ownUndoKey(e) {
    if (!own || !(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
    if (!e.shiftKey && !own.undone && ta.value === own.after) { e.preventDefault(); undoAct(); }
    else if (e.shiftKey && own.undone && ta.value === own.before) { e.preventDefault(); const o = own; putBack(o.after, 0); own = { ...o, undone: false }; undoText = ta.value; setEntry('undo', true); }
  }
  /** Selects a range and brings it into view. */
  function reveal(from, to = from) {
    if (view !== 'text') setView('text');
    ta.focus();
    ta.setSelectionRange(from, from); ta.blur(); ta.focus();     // a focused textarea scrolls its caret into view
    ta.setSelectionRange(from, to);
    paintStatus();
  }

  // ---- the acts ---------------------------------------------------------------------------------------------------------------
  function formatAll({ minify = false } = {}) {
    const before = ta.value, r = recheck(true);
    const out = J.format(before, jsonOptions(), { lines, minify });
    if (out.error) { goToError(); ops.say(out.repair ? `${out.error.message}. Repair can fix it (More).` : J.errorText(out.error)); return; }
    if (out.text === before) { ops.say(minify ? 'Already minified' : 'Already formatted'); return; }
    const caret = r && (r.ok || r.spans) ? J.pathAt(before, r, ta.selectionStart)?.path : null;
    edit(0, before.length, out.text, 0, 0, false);
    // the caret goes back to the value it was in
    const now = recheck(true), back = caret && now ? J.findPath(ta.value, now, caret) : null;
    reveal(back ? back.from : 0);
    ops.say(`${minify ? 'Minifying' : 'Formatting'} changed ${out.changed === 1 ? '1 line' : `${num(out.changed)} lines`}`);
  }
  function doRepair() {
    const before = ta.value, out = J.repair(before, { lines });
    if (!out) { goToError(); ops.say('Repair cannot fix this error'); return; }
    if (!out.fixes) { ops.say('Nothing to repair'); return; }
    edit(0, before.length, out.text, 0, 0, false);
    recheck(true); reveal(0);
    ops.say(`Repaired ${J.fixWords(out.fixes)}`);
  }
  function goToError() {
    const r = recheck(true);
    if (!r || r.ok || r.empty) return;
    reveal(r.error.offset, Math.min(ta.value.length, r.error.offset + 1));
  }
  function sortSelected() {
    let from = ta.selectionStart, to = ta.selectionEnd;
    if (from === to) { const r = recheck(true); const p = r?.ok || r?.spans ? J.pathAt(ta.value, r, from) : null; if (!p) { ops.say('Select an object or an array'); return; } from = p.node.s; to = p.node.e; }
    const out = J.sortSelection(ta.value, from, to, jsonOptions());
    if (out.error) { ops.say(out.error); return; }
    edit(out.replace[0], out.replace[1], out.insert, out.from, out.to);
    recheck(true); paintStatus();
    ops.say('Keys sorted');
  }
  function expandLine() {
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const out = J.expandRecord(ta.value, line, jsonOptions());
    if (!out) { ops.say('Put the caret in a valid line'); return; }
    edit(out.replace[0], out.replace[1], out.insert, out.from, out.from);
    recheck(true); paintStatus();
  }
  async function copy(text, said) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); ops.say(said); } catch { ops.say('The clipboard is not available'); }
  }
  function copyMinified() {
    const out = J.format(ta.value, { ...jsonOptions(), finalNewline: false }, { lines, minify: true });
    if (out.error) { ops.say(J.errorText(out.error)); return; }
    copy(out.text, 'Copied as minified JSON');
  }
  async function exportCsv() {
    const r = recheck(true), csv = r?.ok ? J.toCsv(ta.value, r) : null;
    if (!csv) { ops.say('Only an array of flat objects becomes a table'); return; }
    await saveFile(csv, `${baseName(ops.rel).replace(/\.[^.]+$/, '')}.csv`, 'text/csv');
  }
  function setWrap(on) {
    setOptions({ wrap: on });
    ta.toggleAttribute('data-wrap', on);
    q('wrap')?.setAttribute('aria-pressed', String(on));
  }
  function optionsMenu(btn) {
    const o = jsonOptions(), set = change => setOptions(change);
    const pick = (key, list) => list.map(([v, label]) => ({ label, checked: o[key] === v, run: () => set({ [key]: v }) }));
    const named = (key, list) => list.find(([v]) => v === o[key])?.[1];
    const INDENT = [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab']];
    const SORT = [['off', 'Off'], ['asc', 'A to Z'], ['desc', 'Z to A']];
    const INLINE = [[0, 'Off'], [80, 'Up to 80 characters'], [120, 'Up to 120 characters']];
    showMenu(btn, [
      { label: 'Indent', meta: named('indent', INDENT), submenu: pick('indent', INDENT) },
      { label: 'Sort keys', meta: named('sort', SORT), submenu: pick('sort', SORT) },
      { label: 'Short arrays on one line', meta: o.inline ? `${o.inline}` : 'Off', submenu: pick('inline', INLINE) },
      '-',
      { label: 'Final newline', checked: o.finalNewline, checkType: 'checkbox', run: () => set({ finalNewline: !o.finalNewline }) },
      { label: 'Escape non-ASCII', checked: o.ascii, checkType: 'checkbox', run: () => set({ ascii: !o.ascii }) },
      { label: 'Keep numbers as written', checked: o.exact, checkType: 'checkbox', run: () => set({ exact: !o.exact }) },
    ], { align: 'end' });
  }

  // ---- the view switch --------------------------------------------------------------------------------------------------------
  let tree = null;
  function setView(v) {
    view = v;
    bar?.querySelectorAll(`[id="${id('view')}"] > [data-json-view]`).forEach(x => { const on = x.dataset.jsonView === v; x.setAttribute('aria-pressed', String(on)); x.classList.toggle('on', on); });
    ta.hidden = v === 'tree';
    if (tree) tree.hidden = v !== 'tree';
    if (v === 'tree') { mountTree(); drawTree(); tree.querySelector('.fj-scroll').focus({ preventScroll: true }); }
    paintStatus();
  }

  // ---- the tree ---------------------------------------------------------------------------------------------------------------
  function mountTree() {
    if (tree) return;
    tree = document.createElement('div');
    tree.className = 'fj-tree';
    tree.innerHTML = `<div class="fj-top">${uiBar({ kind: 'strip', density: 'dense', label: 'Tree tools', id: id('tree-tools'),
      status: { id: id('tree-status'), text: '', ch: 12 },
      filters: [{ type: 'search', id: id('tree-find'), label: 'Find in keys and values', placeholder: 'Find' }],
      actions: [{ id: id('tree-expand'), label: 'Expand', role: 'quiet', menu: true, fold: 9 }] })}</div>`
      + `<div class="fj-scroll" tabindex="-1" role="region" aria-label="JSON tree"></div>`;
    b.append(tree);
    const find = tree.querySelector(`[id="${id('tree-find')}"]`), scroll = tree.querySelector('.fj-scroll');
    find.addEventListener('input', () => { query = find.value; found = null; shown = J.TREE_PAGE; drawTree(); });
    find.addEventListener('keydown', e => { if (e.key === 'Escape' && find.value) { e.preventDefault(); e.stopPropagation(); find.value = ''; query = ''; found = null; drawTree(); } });
    const expandBtn = tree.querySelector(`[id="${id('tree-expand')}"]`);
    expandBtn.onclick = () => {
      const r = current(); if (!r?.ok && !(lines && r?.records?.length)) return;
      const to = depth => () => { open = J.openToDepth(r, depth); shown = J.TREE_PAGE; drawTree(); };
      showMenu(expandBtn, [{ label: 'Expand all', run: to(Infinity) }, { label: 'Collapse all', run: to(0) }, { heading: 'Expand to level' },
        ...[1, 2, 3].map(n => ({ label: `Level ${n}`, run: to(n) }))]);
    };
    scroll.addEventListener('click', e => {
      const more = e.target.closest('[data-node-more]');
      if (more) { e.preventDefault(); select(+more.dataset.nodeMore); showMenu(more, rowMenu(+more.dataset.nodeMore)); return; }
      const t = e.target.closest('[data-toggle]');
      if (t) { toggle(+t.dataset.toggle); return; }
      if (e.target.closest('[data-show-more]')) { showMore(); return; }
      const row = e.target.closest('[data-node]');
      if (row) select(+row.dataset.node, true);
    });
    scroll.addEventListener('dblclick', e => { const row = e.target.closest('[data-node]'); if (row && !e.target.closest('[data-toggle],[data-node-more]')) showInText(+row.dataset.node); });
    scroll.addEventListener('contextmenu', e => { const row = e.target.closest('[data-node]'); if (!row) return; e.preventDefault(); select(+row.dataset.node); showMenu({ x: e.clientX, y: e.clientY }, rowMenu(+row.dataset.node)); });
    scroll.addEventListener('keydown', onTreeKey);
  }
  const rowsById = new Map();
  let first = null;
  function drawTree() {
    if (!tree) return;
    const scroll = tree.querySelector('.fj-scroll'), r = recheck(true), text = ta.value;
    const status = tree.querySelector(`[id="${id('tree-status')}"]`);
    rowsById.clear();
    if (!r || (!r.ok && !(lines && r.records?.length && !r.errors.some(e => e.fix !== 'lines')))) {
      if (status) status.textContent = '';
      scroll.innerHTML = r?.empty ? emptyState({ icon: 'file', title: 'Empty file' })
        : emptyState({ icon: 'warn', title: 'Not valid JSON', detail: r ? J.errorText(r.error) : '', actions: [{ id: id('tree-goto'), label: 'Go to error', primary: true }] });
      scroll.querySelector(`[id="${id('tree-goto')}"]`)?.addEventListener('click', goToError);
      return;
    }
    if (treeOf !== text) { treeOf = text; open = null; }
    open ||= lines ? new Set() : J.openToDepth(r, 1);
    if (query && !found) found = J.searchTree(text, r, query);
    const { rows, total } = J.treeRows(text, r, { open, found: query ? found : null, limit: shown });
    const st = query ? (found.count === 1 ? '1 match' : `${short(found.count)} matches`) : `${short(r.nodes)} values`;   // the file's size is in the title bar
    if (status && status.textContent !== st) status.textContent = st;
    const keep = scroll.scrollTop;
    if (!rows.length) { scroll.innerHTML = emptyState({ icon: 'search', title: 'No key or value matches', size: 'inline' }); return; }
    if (!rows.some(x => x.id === selected)) selected = -1;
    first = rows[0];
    scroll.innerHTML = uiList({ id: id('tree-list'), label: 'JSON tree', cls: 'fj-list', attrs: { 'data-fv-list': '', ...(rows.some(x => x.hit) ? { 'data-fj-hits': '' } : {}) }, rows: [...rows.map(rowHtml), ...(total > rows.length ? [moreHtml(rows.length, total)] : [])] });
    scroll.scrollTop = keep;
  }
  function rowHtml(x) {
    rowsById.set(x.id, x);
    const disc = x.container && x.size ? `<button type="button" class="fv-disc" data-toggle="${x.id}" aria-expanded="${x.open}" aria-label="${x.open ? 'Collapse' : 'Expand'} ${esc(x.label ?? 'root')}" tabindex="-1">${icon(x.open ? 'chevron-down' : 'chevron-right', { size: 12 })}</button>` : '<span class="fv-disc" aria-hidden="true"></span>';
    const label = x.label == null ? 'Root' : x.label;   // keys and values are the file's own text (code), so they keep their case
    return uiRow({ cls: `fj-row${x.id === selected ? ' fv-sel' : ''}${x.hit ? ' fj-hit' : ''}`, depth: x.depth, attrs: { 'data-node': x.id, 'data-fj-d': Math.min(x.depth, 16) },
      main: { html: `<span class="fv-name">${disc}<button type="button" class="fv-entry fj-entry" tabindex="${x.id === selected || (selected < 0 && x === first) ? 0 : -1}" title="${esc(x.path)}">${x.index || x.label == null || x.depth === 0 ? `<span class="fj-key fj-index">${esc(label)}</span>` : `<code class="fj-key">${esc(label)}</code>`}<code class="fj-val" data-kind="${x.kind}">${esc(x.preview)}</code></button></span>` },
      end: uiRowEnd({ more: { label: `More for ${x.path}`, attrs: { 'data-node-more': x.id } } }) });
  }
  const moreHtml = (n, total) => uiRow({ cls: 'fj-row fj-more', main: { html: `<span class="fv-name"><span class="fv-disc" aria-hidden="true"></span><button type="button" class="fv-entry" data-show-more>Show ${num(Math.min(J.TREE_PAGE, total - n))} more</button><span class="fv-earlier">${num(n)} of ${num(total)} rows</span></span>` }, end: uiRowEnd({ reserve: true }) });
  function showMore() { shown += J.TREE_PAGE; drawTree(); }
  function toggle(nodeId) {
    if (!open) return;
    if (open.has(nodeId)) open.delete(nodeId); else open.add(nodeId);
    selected = nodeId; drawTree(); focusRow(nodeId);
  }
  function select(nodeId, focus = false) {
    selected = nodeId;
    tree.querySelectorAll('.fj-row[data-node]').forEach(el => { const on = +el.dataset.node === nodeId; el.classList.toggle('fv-sel', on); const btn = el.querySelector('.fj-entry'); if (btn) btn.tabIndex = on ? 0 : -1; });
    if (focus) focusRow(nodeId);
    paintStatus();
  }
  const rowEl = nodeId => tree.querySelector(`.fj-row[data-node="${nodeId}"]`);
  function focusRow(nodeId) { const el = rowEl(nodeId); el?.querySelector('.fj-entry')?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'nearest' }); }
  function rowMenu(nodeId) {
    const x = rowsById.get(nodeId); if (!x) return [];
    return [
      { label: 'Show in text', run: () => showInText(nodeId) },
      { label: 'Copy path', run: () => copy(x.path, 'Path copied') },
      { label: 'Copy value', run: () => { const p = J.nodeAt(ta.value, current(), nodeId); if (p) copy(J.valueText(ta.value, p.node), 'Value copied'); } },
    ];
  }
  function showInText(nodeId) { const x = rowsById.get(nodeId); if (x) reveal(x.from, x.to); }
  function onTreeKey(e) {
    if (e.target.closest('input')) return;
    const ids = [...tree.querySelectorAll('.fj-row[data-node]')].map(el => +el.dataset.node), i = ids.indexOf(selected), x = rowsById.get(selected);
    const go = j => { const to = ids[Math.max(0, Math.min(ids.length - 1, j))]; if (to != null) select(to, true); };
    if (i < 0 && ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(e.key)) { e.preventDefault(); go(0); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(ids.length - 1); }
    else if (e.key === 'ArrowRight' && x?.container && x.size) { e.preventDefault(); if (!x.open) toggle(selected); else go(i + 1); }
    else if (e.key === 'ArrowLeft' && x) {
      e.preventDefault();
      if (x.open) toggle(selected);
      else { for (let j = i - 1; j >= 0; j--) if (rowsById.get(ids[j])?.depth < x.depth) { go(j); break; } }
    } else if (e.key === 'Enter' && x) { e.preventDefault(); showInText(selected); }
    else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && x) { e.preventDefault(); const m = rowEl(selected)?.querySelector('[data-node-more]'); if (m) showMenu(m, rowMenu(selected)); }
  }

  // ---- wiring -----------------------------------------------------------------------------------------------------------------
  function wire(placed) {
    bar = placed;
    bar.querySelectorAll(`[id="${id('view')}"] > [data-json-view]`).forEach(x => { x.onclick = () => { if (x.dataset.jsonView !== view) setView(x.dataset.jsonView); }; });
    q('msg')?.addEventListener('click', () => { if (current() && !current().ok) goToError(); });
    ta.toggleAttribute('data-wrap', jsonOptions().wrap);
    ta.addEventListener('input', () => {
      if (undoText != null && ta.value !== undoText) { undoText = null; setEntry('undo', false); }
      if (own && ta.value !== own.after && ta.value !== own.before) own = null;
      recheck();
    });
    ta.addEventListener('keydown', ownUndoKey);
    ta.addEventListener('change', () => recheck(true));                 // a large text is checked when the editor is left
    for (const ev of ['keyup', 'pointerup', 'select']) ta.addEventListener(ev, () => paintStatus());
    b.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); formatAll(); }
    });
    recheck(true);
  }
  return { spec, actions, overflow, wire };
}
