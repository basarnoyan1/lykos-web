// The query visualizer (query.html): a search query, or a strategy of numbered lines, drawn as blocks in the manner of Scratch's
// (lib/query-blocks.mjs) beside its text, with the databases its syntax could be written for; and a builder (query/builder.mjs, loaded
// the first time Build is opened) that writes a query from concepts in each database's syntax. Everything happens in this browser:
// nothing is sent anywhere, and the text, the choices and the builder's concepts are kept here (localStorage) for the next visit.
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { fitSplit } from '../lib/split-fit.mjs';
import { lib_dates$plural as plural } from "../boot.mjs";
import { DIALECT_NAMES } from '../lib/query-syntax.mjs';
import { BUILD_TARGETS } from '../lib/query-build.mjs';
import { queryBlocks, blocksHtml, queryMarks, termCount, BLOCK_DIALECTS } from '../lib/query-blocks.mjs';
import { EXAMPLES } from '../lib/query-examples.mjs';
import { freshBlock, usualField, applyEdit, nodeAt } from '../lib/query-edit.mjs';
import { mountEditing, reveal } from './edit.mjs';
import { mountSlotEdit } from './slot-edit.mjs';
import { readSaved, findSaved, saveQuery, useSaved, renameSaved, removeSaved, defaultName, savedHtml, wordsOf } from './saved.mjs';
import "../boot.mjs";
import "../boot.mjs";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KEEP = 'lykos.query';
const stored = (() => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch { return {}; } })();
const S = { mode: stored.mode === 'build' ? 'build' : 'text', dialect: BLOCK_DIALECTS.includes(stored.dialect) ? stored.dialect : '',
  view: stored.view === 'lines' ? 'lines' : 'combined', closed: new Set(), model: null, built: { query: '', dialect: '' },
  list: false, note: '' };   // list: the Saved list is shown in place of the editor; note: what it says of a save that was not kept
const ta = $('qv-text'), marks = $('qv-marks'), body = $('qv-body'), blocks = $('qv-blocks');
ta.value = typeof stored.text === 'string' ? stored.text : '';
let keepTimer = 0;
const write = () => { keepTimer = 0; try { localStorage.setItem(KEEP, JSON.stringify({ text: ta.value, mode: S.mode, dialect: S.dialect, view: S.view })); } catch { /* a private window keeps nothing */ } };
const keep = () => { clearTimeout(keepTimer); keepTimer = setTimeout(write, 250); };
// a reload or a closed tab within those 250 ms keeps the last change too
addEventListener('pagehide', () => { if (keepTimer) { clearTimeout(keepTimer); write(); } });


// a database's favicon, the Search view's (assets/sources); Ovid, Embase and ICTRP have none
const ICONS = { pubmed: 'pubmed.ico', scopus: 'scopus.png', wos: 'wos.ico', cochrane: 'cochrane.png', epmc: 'europepmc.png', ctgov: 'ctg.svg' };
const iconSrc = d => (ICONS[d] ? `./assets/sources/${ICONS[d]}` : '');
const srcIcon = d => (ICONS[d] ? `<img class="qv-src" src="${iconSrc(d)}" alt="">` : '');
// the first screen's query: what the page does, in one line and its blocks
const DEMO = '("deep brain stimulation"[tiab] OR DBS[tiab]) AND (sham[tiab] OR placebo*[tiab])';

// ---- drawing ---------------------------------------------------------------------------------------------------------------------------

// a bar is drawn again only when what it shows changed: typing does not rebuild (and re-fit) it on every key
const painted = new Map();
const paint = (id, html) => { if (painted.get(id) !== html) { painted.set(id, html); $(id).innerHTML = html; } };

function editTop() {
  const m = S.model, text = S.mode === 'text' && !S.list;
  const value = S.dialect ? DIALECT_NAMES[S.dialect] : m?.detected && m.candidates.length < 2 ? m.name : 'Detect';
  // the candidates the syntax allows first, then the rest
  const order = [...(m?.candidates || []).map(c => c.dialect).filter(d => BLOCK_DIALECTS.includes(d)), ...BLOCK_DIALECTS];
  return uiBar({ kind: 'head', label: 'Query', stack: false, lead: { title: 'Query', level: 'h2', id: 'qv-query-title' },
    view: { id: 'qv-mode', label: 'Show', attr: 'data-qv-mode', kind: 'segmented', value: S.list ? 'saved' : S.mode, items: [['text', 'Text'], ['build', 'Build'], ['saved', 'Saved']] },
    // the examples are listed under the saved queries (Saved): a third choice and Save leave no room for their menu in a 30rem pane
    actions: [...(text ? [{ picker: true, id: 'qv-db', label: 'Database', role: 'quiet', value, options: [['', 'Detect'], ...[...new Set(order)].map(d => [d, DIALECT_NAMES[d]])] }] : []),
      { id: 'qv-save', label: 'Save', kbd: '⌘S', disabled: !current() }],
    overflow: text ? [{ id: 'qv-clear', label: 'Clear', disabled: !ta.value }] : [] });
}
// the databases the text's syntax could be for, with the marks that say so
function detectText() {
  const m = S.model;
  if (!m || S.mode !== 'text') return '';
  if (S.dialect) return `Read as ${m.name}`;
  const c = m.candidates;
  if (!c.length) return m.json ? `Read as ${m.name}` : 'No mark of one database: read as PubMed reads it';
  const names = c.map(x => DIALECT_NAMES[x.dialect] || x.dialect), marks = [...new Set(c.flatMap(x => x.marks))].slice(0, 3).join(', ');
  return c.length === 1 ? `${names[0]} syntax: ${marks}` : `Could be ${names.slice(0, -1).join(', ')} or ${names.at(-1)} (${marks}); read as ${m.name}`;
}
function viewTop() {
  const m = S.model;
  if (S.mode === 'build') return uiBar({ kind: 'head', label: 'Search', stack: false, lead: { title: 'Search', level: 'h2', id: 'qv-blocks-title' }, message: { id: 'qv-summary', text: `Written for ${BUILD_TARGETS.length} databases` } });
  const terms = m ? m.lines.reduce((a, l) => a + termCount(l.block), 0) : 0;
  return uiBar({ kind: 'head', label: 'Blocks', stack: false, lead: { title: 'Blocks', level: 'h2', id: 'qv-blocks-title' },
    message: { id: 'qv-summary', text: m ? `${plural(terms, 'term')}${m.numbered ? ` in ${plural(m.lines.length, 'line')}` : ''}` : '' },
    actions: m ? [{ id: 'qv-add', label: 'Add', menu: true, role: 'quiet', icon: 'plus' }] : [],
    ...(m?.numbered ? { view: { id: 'qv-view', label: 'Show', attr: 'data-qv-view', kind: 'segmented', value: S.view, items: [['combined', 'Whole search'], ['lines', 'By line']] } } : {}) });
}
function checksHtml(m) {
  if (!m.checks.length) return '';
  const sorted = [...m.checks].sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
  return `<details class="qv-checks"${m.checks.some(c => c.level === 'error') ? ' open' : ''}><summary>Checks<span>${m.checks.length}</span></summary><ul>`
    + sorted.map(c => `<li class="qv-check" data-level="${esc(c.level)}">${icon('warn', { size: 14 })}<span>${esc(c.text)}</span></li>`).join('') + '</ul></details>';
}

function draw() {
  const text = ta.value;
  S.model = S.mode === 'text' && text.trim() ? queryBlocks(text, { dialect: S.dialect }) : null;
  body.toggleAttribute('data-empty', !S.model);
  body.dataset.editor = S.mode;
  body.toggleAttribute('data-list', S.list);
  if (S.list) paint('qv-saved', savedHtml(readSaved(), S.note) + examplesHtml());
  paint('qv-edit-top', editTop());
  const said = detectText();
  $('qv-detect').innerHTML = said ? `${srcIcon(S.model.dialect)}<span>${esc(said)}</span>` : '';
  // the text in its blocks' colours, under the field's transparent letters (the trailing line keeps a last empty line's height)
  if (S.mode === 'text') { marks.innerHTML = `${queryMarks(text, S.model?.dialect || S.dialect)}\n`; marks.scrollTop = ta.scrollTop; }
  paint('qv-view-top', viewTop());
  blocks.innerHTML = S.model ? blocksHtml(S.model, { view: S.view, closed: S.closed, mark: srcIcon(S.model.dialect) }) : '';
  $('qv-checks').innerHTML = S.model ? checksHtml(S.model) : '';
  here = null;
  if (S.mode === 'text' && document.activeElement === ta) markCaret();
}
let pending = 0;
const redraw = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); };

// ---- the text and the blocks, each pointing at the other --------------------------------------------------------------------------------

/** Replaces the text the way typing would, so the field's own undo takes it back. */
function setText(value) {
  ta.focus({ preventScroll: true });
  ta.select();
  const ok = value ? document.execCommand?.('insertText', false, value) : document.execCommand?.('delete');
  if (!ok) { ta.value = value; ta.dispatchEvent(new Event('input')); }
  ta.setSelectionRange(0, 0);
  ta.scrollTop = 0;
}
// an edit of the blocks: the text changes where the edit was, the caret goes there (so its block is marked), nothing scrolls away
function editText(value) {
  const old = ta.value, top = ta.scrollTop, view = document.querySelector('.qv-view').scrollTop;
  let i = 0; while (i < old.length && i < value.length && old[i] === value[i]) i++;
  setText(value);
  ta.setSelectionRange(i, i); ta.scrollTop = top;
  requestAnimationFrame(() => { document.querySelector('.qv-view').scrollTop = view; });
}
// a term edited in its slot: the span replaced the way typing would (undo takes it back), neither the field nor the blocks pane moving
function replaceSpan(at, end, s) {
  const top = ta.scrollTop, view = pane.scrollTop;
  ta.focus({ preventScroll: true }); ta.setSelectionRange(at, end);
  if (!document.execCommand?.('insertText', false, s)) { ta.setRangeText(s, at, end, 'end'); ta.dispatchEvent(new Event('input')); }
  ta.scrollTop = top;
  requestAnimationFrame(() => { pane.scrollTop = view; });
}
function selectText(at, end) {
  if (S.mode !== 'text') return;
  // focus after a blur reveals the selection in the field (it scrolls to it), without moving the page
  ta.blur(); ta.setSelectionRange(at, end);
  ta.focus({ preventScroll: true }); ta.setSelectionRange(at, end);
}
// the block under the caret: the smallest span that holds it
let here = null;
function markCaret() {
  const pos = ta.selectionStart;
  let best = null, size = Infinity;
  for (const el of blocks.querySelectorAll('[data-at]')) {
    const at = +el.dataset.at, end = +el.dataset.end;
    if (at <= pos && pos <= end && end - at < size) { best = el; size = end - at; }
  }
  if (best === here) return;
  here?.removeAttribute('data-here');
  here = best;
  if (!best) return;
  best.setAttribute('data-here', '');
  if (body.dataset.stack !== 'true') reveal(best);   // the blocks pane only, and only when the block is out of view
}

ta.addEventListener('input', () => { keep(); redraw(); });
ta.addEventListener('scroll', () => { marks.scrollTop = ta.scrollTop; }, { passive: true });
document.addEventListener('selectionchange', () => { if (document.activeElement === ta && S.mode === 'text') markCaret(); });
blocks.addEventListener('toggle', e => { const k = e.target.dataset?.key; if (k) { if (e.target.open) S.closed.delete(k); else S.closed.add(k); } }, true);

// ---- the builder ------------------------------------------------------------------------------------------------------------------------

let builder = null;
async function openBuilder() {
  if (!builder) {
    const { mountBuilder } = await import('./builder.mjs');
    builder = mountBuilder($('qv-build'), { cards: $('qv-cards'), icons: srcIcon, toText: query => { showMode('text').then(() => setText(query)); },
      changed: () => paint('qv-edit-top', editTop()) });   // Save is pressable once the search has a word
  }
}
// Text, Build, Whole search and By line each keep the blocks pane where it was left: switching shows each as it was
// (stacked, the page is the one scroll, and it is what is kept)
const scrolls = new Map(), pane = document.querySelector('.qv-view');
const scrollKey = () => (S.mode === 'build' ? 'build' : S.view);
const scroller = () => (body.dataset.stack === 'true' ? document.body : pane);
function switched(change) {
  scrolls.set(scrollKey(), scroller().scrollTop);
  return Promise.resolve(change()).then(() => { draw(); scroller().scrollTop = scrolls.get(scrollKey()) ?? 0; });
}
function setMode(mode) {
  if (mode === S.mode) return Promise.resolve();
  return switched(async () => { S.mode = mode; S.closed.clear(); keep(); if (mode === 'build') await openBuilder(); });
}
// Text, Build or Saved in the query's pane: Saved shows the list in place of the editor, whose blocks stay beside it
function showMode(v) {
  if (v === 'saved') { if (!S.list) { S.list = true; draw(); } return Promise.resolve(); }
  const was = S.list;
  S.list = false; S.note = '';
  if (v !== S.mode) return setMode(v);
  if (was) draw();
  return Promise.resolve();
}

// ---- saved queries (query/saved.mjs) ----------------------------------------------------------------------------------------------------

const NOT_KEPT = 'Not saved: this browser keeps nothing for this page.';
// the examples, under the saved queries: a database's own, pressed it opens as text
const exampleRow = x => uiRow({ attrs: { 'data-example': x.id },
  main: { html: `<button type="button" class="tk-text" data-qs-example="${esc(x.id)}">${srcIcon(x.id)}${esc(x.name)}</button>`, detail: [esc(x.detail)] } });
let examples = '';
const examplesHtml = () => (examples ||= uiBar({ kind: 'head', label: 'Examples', stack: false, lead: { title: 'Examples', level: 'h3', id: 'qv-examples-title' } })
  + uiList({ id: 'qv-examples-list', label: 'Examples', rows: EXAMPLES.map(exampleRow) }));
// what Save keeps: the text with its Database choice, or the builder's search; null while it has no words
function current() {
  if (S.mode === 'build') {
    const tree = builder?.tree();
    return tree && wordsOf([tree]).length ? { kind: 'build', tree: JSON.parse(JSON.stringify(tree)) } : null;
  }
  return ta.value.trim() ? { kind: 'text', text: ta.value, dialect: S.dialect, db: S.model?.dialect || S.dialect } : null;
}
const said = text => { $('qv-saved-said').textContent = text; };
async function saveCurrent() {
  const q = current();
  if (!q) return;
  const { ask } = await import('../lib/dialog.mjs');
  const offer = findSaved(q)?.name || defaultName(q, q.kind === 'build' ? [q.tree] : (S.model?.lines || []).map(l => l.block));
  const name = (await ask('Save query', { value: offer, confirm: 'Save' }))?.trim();
  if (!name) return;
  const kept = saveQuery(q, name);
  S.note = kept ? '' : NOT_KEPT;
  if (!kept) S.list = true;   // the Saved list says so
  draw();
  said(kept ? `Saved as ${name}` : NOT_KEPT);
}
// a saved query in its editor, the way typing would put it there: the field's undo, or the builder's, takes it back
async function openSaved(id) {
  const x = readSaved().find(y => y.id === id);
  if (!x) return;
  const mode = x.kind === 'build' ? 'build' : 'text';
  if (mode === 'text') { S.dialect = BLOCK_DIALECTS.includes(x.dialect) ? x.dialect : ''; S.closed.clear(); }
  await showMode(mode);
  if (mode === 'build') builder.setTree(x.tree);
  else setText(x.text);
  useSaved(x.id);
  keep(); redraw();
}
async function renameItem(x) {
  const { ask } = await import('../lib/dialog.mjs');
  const name = (await ask('Rename query', { value: x.name, confirm: 'Rename' }))?.trim();
  if (!name || name === x.name) return;
  S.note = renameSaved(x.id, name) ? '' : NOT_KEPT;
  draw();
}
async function deleteItem(x) {
  const { confirmAsk } = await import('../lib/dialog.mjs');
  if (!(await confirmAsk('Delete this saved query?', { detail: x.name, confirm: 'Delete', danger: true }))) return;
  S.note = removeSaved(x.id) ? '' : NOT_KEPT;
  draw();
}
function savedMenu(b, id) {
  const x = readSaved().find(y => y.id === id);
  if (x) showMenu(b, [{ label: 'Rename', icon: 'rename', run: () => renameItem(x) }, '-', { label: 'Delete', icon: 'trash', danger: true, run: () => deleteItem(x) }]);
}

// ---- commands -----------------------------------------------------------------------------------------------------------------------------

function useExample(x) { S.dialect = ''; S.closed.clear(); setText(x.text); }
document.addEventListener('click', e => {
  const slot = !e.target.closest?.('#qv-blocks input') && e.target.closest?.('#qv-blocks :is(.qb-slot, .qb-hat, p.qb-flat)[data-at]');
  if (slot) { selectText(+slot.dataset.at, +slot.dataset.end); return; }
  const b = e.target.closest?.('button'); if (!b || b.disabled) return;
  if (b.dataset.qsExample) { const x = EXAMPLES.find(y => y.id === b.dataset.qsExample); if (x) showMode('text').then(() => useExample(x)); }
  else if (b.id === 'qv-clear') { S.closed.clear(); setText(''); }
  else if (b.id === 'qv-add' && S.model) {
    // into the mouth of the block under the caret, else at the end of the search's last line
    const mouth = here?.closest('[data-mouth]')?.dataset.mouth || `${S.model.numbered ? S.model.final : S.model.lines[0].n}:`;
    const n = Number(mouth.split(':')[0]);
    // a But not only where it can take away: in an All of
    const kinds = [['any', 'Any of'], ['all', 'All of'], ...(nodeAt(S.model, mouth)?.kind === 'all' ? [['not', 'But not']] : []), ['near', 'Near'], ['term', 'Term']];
    showMenu(b, kinds.map(([kind, label]) => ({ label, run: () => editing.edit({ nodes: [freshBlock(kind, usualField(S.model, n))], to: { mouth, index: 1e9 } }) })));
  }
  else if (b.id === 'qv-save') saveCurrent();
  else if (b.dataset.qsOpen) openSaved(b.dataset.qsOpen);
  else if (b.dataset.qsMore) savedMenu(b, b.dataset.qsMore);
  else if (b.dataset.qvMode) showMode(b.dataset.qvMode);
  else if (b.dataset.qvView && S.view !== b.dataset.qvView) switched(() => { S.view = b.dataset.qvView; S.closed.clear(); keep(); });
});
// ⌘S (Ctrl S) saves, as Save does, instead of the browser's saving the page
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (!document.querySelector('dialog[open]')) saveCurrent();
});
document.addEventListener('ui-pick', e => {
  if (e.detail?.id !== 'qv-db') return;
  S.dialect = BLOCK_DIALECTS.includes(e.detail.value) ? e.detail.value : '';
  keep(); draw();
});

$('qv-demo').innerHTML = `<pre class="qv-demo-q">${queryMarks(DEMO, 'pubmed')}</pre><div class="qv-blocks">${blocksHtml(queryBlocks(DEMO), { mark: srcIcon('pubmed') })}</div>`;
const editing = mountEditing(blocks, { dropZone: document.querySelector('.qv-edit'),
  edit: spec => { const r = applyEdit(ta.value, S.model, spec); if (r) editText(r.text); return r ? r.placed || true : false; } });
mountSlotEdit(blocks, { model: () => S.model, text: () => ta.value, replace: replaceSpan, remove: path => editing.edit({ removed: [path] }),
  drawn: () => { cancelAnimationFrame(pending); draw(); } });
fitSplit(body, 900);   // below 900px of its own width the text and the blocks stack, the text first
if (S.mode === 'build') openBuilder().then(draw);
else {
  draw();
  // the builder's modules once the page is idle, so Build opens at once (they are not in the page's preload list)
  (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => { import('./builder.mjs').catch(() => {}); });
}
