// The query builder (query.html's Build, loaded the first time it is opened), built as Scratch's scripts are (8 Nov 2026: the owner,
// "there could be a gallery of blocks and we could build the query"). The left column is a gallery: Any of, All of and But not, and a
// term for each field. A block is dragged from it into a mouth of the search on the right (or clicked, to go where the caret was), moved with the
// same code as the Text mode's blocks (query/edit.mjs), and dropped back on the gallery to remove it. A term's slot is typed in: Enter
// adds the next term after it, Backspace in an empty slot removes it, a pasted list becomes a term a line; the field it searches is the
// menu at the start of its row. Under the search, the query written for every database (lib/query-build.mjs), in the blocks' colours,
// with what that database searches differently. The search is kept in this browser (localStorage) for the next visit.
import { uiBar } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { blocksHtml, queryMarks, childPath } from '../lib/query-blocks.mjs';
import { editLines, nodeAt, parsePath } from '../lib/query-edit.mjs';
import { BUILD_TARGETS, BUILD_FIELDS, buildTerm, buildGroup, startTree, conceptsTree, upgradeTree, treeQuery } from '../lib/query-build.mjs';
import { mountEditing, reveal } from './edit.mjs';

const KEEP = 'lykos.query.build';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nameOf = (list, key) => (list.find(x => x[0] === key) || list[0])[1];
const DIALECT = { 'ovid-medline': 'ovid', 'ovid-embase': 'ovid' };   // the syntax a target is written in, for its colours
const clone = x => JSON.parse(JSON.stringify(x));
// the mouth a path's node sits in, and its index there: "1:0.2" -> { mouth: "1:0", index: 2 }
function parentOf(path) {
  const { n, steps } = parsePath(path);
  return { mouth: `${n}:${steps.slice(0, -1).map(s => s.i).join('.')}`, index: steps.at(-1)?.i ?? 0 };
}
// an input is as wide as its words: its box holds a hidden copy of them (data-v) that the input lies over
const size = el => { el.parentElement.dataset.v = el.value || el.placeholder || ''; };
// a row's input names the row's terms (data-row); its words go after the last
const rowOf = input => input.dataset.row.split(',');

function savedTree() {
  try {
    const s = JSON.parse(localStorage.getItem(KEEP) || 'null');
    if (s?.tree?.kind === 'all' && Array.isArray(s.tree.items)) return upgradeTree(s.tree);   // an All of's second mouth is a But not now
    if (Array.isArray(s?.concepts) && s.concepts.length) return conceptsTree(s.concepts);   // what the builder before the gallery kept
  } catch { /* nothing kept */ }
  return startTree();
}

/**
 * Draws the gallery into `root`, the search and the query for every database into `cards`; toText(query) opens a query as text; icons(key) a
 * database's; changed() after every change of the search. Returns tree() and setTree(tree), which opens a search (undo takes it back).
 */
export function mountBuilder(root, { cards, toText, icons = () => '', changed: afterChange = () => {} }) {
  const B = { tree: savedTree(), closed: new Set(), undo: [] };
  const model = () => ({ numbered: false, name: 'Search', checks: [], lines: [{ n: 1, block: B.tree }] });
  let timer = 0, paint = 0, here = '1:';   // here: the mouth a click in the gallery adds to (where the caret was last)
  const write = () => { timer = 0; try { localStorage.setItem(KEEP, JSON.stringify({ tree: B.tree })); } catch { /* nothing kept */ } };
  const save = () => { clearTimeout(timer); timer = setTimeout(write, 250); };
  addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); write(); } });   // a reload within the 250 ms keeps the change
  const queries = new Map();

  // ---- the gallery ----
  const cBlock = (kind, name) => `<div class="qb qb-c qb-${kind}" data-new="${kind}" role="button" tabindex="0" aria-label="${esc(`Add ${name}`)}"><div class="qb-top"><span class="qb-op">${esc(name)}</span></div><div class="qb-mouth"></div><div class="qb-bottom"></div></div>`;
  const termBlock = ([key, label, name]) => `<p class="qb-terms qb-k-${key === 'Mesh' ? 'heading' : 'free'}" data-new="term" data-field="${esc(key)}" role="button" tabindex="0" aria-label="${esc(`Add ${name}`)}"><span class="qb-in">${esc(label)}</span><span class="qb-slot${key === 'Mesh' ? ' qb-heading' : ''} qv-ph">${key === 'Mesh' ? 'heading' : 'word'}</span></p>`;
  root.innerHTML = '<div class="qv-gallery" aria-label="Blocks">'
    + `<h3 class="qv-gal-h">Groups</h3>${cBlock('any', 'Any of')}${cBlock('all', 'All of')}${cBlock('not', 'But not')}<h3 class="qv-gal-h">Terms</h3>${BUILD_FIELDS.map(termBlock).join('')}</div>`;
  const gallery = root.firstElementChild;
  // what a gallery block brings: Any of and But not a blank word to type in (a concept, what is taken away), All of comes empty
  const fresh = el => (el.dataset.new === 'term' ? [buildTerm(el.dataset.field)] : el.dataset.new === 'all' ? [buildGroup('all')] : [{ ...buildGroup(el.dataset.new), items: [buildTerm()] }]);

  // ---- the search ----
  cards.innerHTML = '<div class="qv-work" id="qv-work"></div><div class="qv-written"><p class="qv-lead" id="qv-cards-empty">Type words into the search to see it written for every database.</p>'
    + BUILD_TARGETS.map(([key, name]) => `<section class="qv-card" data-db="${esc(key)}" aria-labelledby="qv-card-${esc(key)}" hidden>${uiBar({ kind: 'head', label: name, stack: false,
      lead: { title: name, level: 'h3', id: `qv-card-${key}` },
      actions: [{ id: `qv-copy-${key}`, label: 'Copy', icon: 'copy' }, { id: `qv-text-${key}`, label: 'Open as text', role: 'quiet' }] })}<pre class="qv-q"></pre><ul class="qv-notes"></ul></section>`).join('')
    + '</div><p class="visually-hidden" id="qv-said" aria-live="polite"></p>';
  for (const [key] of BUILD_TARGETS) cards.querySelector(`#qv-card-${key}`)?.insertAdjacentHTML('afterbegin', icons(key));
  const work = cards.querySelector('#qv-work');

  function paintCards() {
    paint = 0;
    let any = false;
    for (const [key] of BUILD_TARGETS) {
      const r = treeQuery(B.tree, key), card = cards.querySelector(`[data-db="${key}"]`);
      queries.set(key, r.query);
      card.hidden = !r.query; any ||= !!r.query;
      card.querySelector('pre').innerHTML = queryMarks(r.query, DIALECT[key] || key);
      card.querySelector('ul').innerHTML = r.notes.map(n => `<li>${esc(n)}</li>`).join('');
      card.querySelectorAll('button').forEach(b => { b.disabled = !r.query; });
    }
    cards.querySelector('#qv-cards-empty').hidden = any;
  }
  const changed = () => { clearTimeout(paint); paint = setTimeout(paintCards, 120); save(); afterChange(); };

  // the search drawn again, the caret put back where `focus` says: a term's row's input (a group's first row's), else the block
  function render(focus = '') {
    work.innerHTML = blocksHtml(model(), { closed: B.closed, edit: true });
    changed();
    if (!focus) return;
    const at = CSS.escape(focus);
    const input = [...work.querySelectorAll('.qb-add input')].find(i => rowOf(i).includes(focus)) || work.querySelector(`[data-path="${at}"] .qb-add input`);
    const el = input || work.querySelector(`[data-path="${at}"], [data-paths^="${at}"]`);
    el?.focus({ preventScroll: true }); reveal(el);
  }
  // a change of the tree's shape: kept for undo, then drawn
  function edit(spec, focus = null) {
    const r = editLines(model().lines, spec, { prune: false });
    if (!r) return false;
    B.undo.push(clone(B.tree)); if (B.undo.length > 50) B.undo.shift();
    B.tree = r.lines[0].block;
    render(focus ?? (spec.nodes ? r.placed : ''));
    return r.placed || true;
  }
  mountEditing(work, { edit, dropZone: gallery, sources: gallery, fresh });

  // a click (or Enter) on a gallery block adds it where the caret was; a But not to the All of that is, or holds, that place
  const add = el => {
    const nodes = fresh(el);
    let at = nodeAt(model(), here) ? here : '1:';
    if (nodes[0].kind === 'not') while (at !== '1:' && nodeAt(model(), at)?.kind !== 'all') at = parentOf(at).mouth;
    edit({ nodes, to: { mouth: at, index: 1e9 } });
  };
  gallery.addEventListener('click', e => { const el = e.target.closest('[data-new]'); if (el) add(el); });
  gallery.addEventListener('keydown', e => { const el = e.target.closest('[data-new]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); add(el); } });
  work.addEventListener('focusin', e => { const m = e.target.closest('[data-mouth]'); if (m) here = m.dataset.mouth; });
  work.addEventListener('toggle', e => { const k = e.target.dataset?.key; if (k) { if (e.target.open) B.closed.delete(k); else B.closed.add(k); } }, true);

  // ---- a row's words, a token field (8 Nov 2026, the owner: "also we could fix this approach as well") ----
  // A word is a slot as wide as its words and the row ends in one input: Enter, a comma, a semicolon or Tab there (or leaving it) makes
  // what was typed a word, a phrase with its spaces, and a pasted list a word a line (or a comma, or an OR). Backspace in the empty
  // input selects the last word (in a row with none, the row) and a second removes it; Left and Right step between words; a double
  // click, Enter or F2 on a word edits it in place, and a word emptied goes. A row's last word removed leaves its input, its field kept.
  const isAdd = t => !!t?.matches?.('.qb-add input');
  const wordsOf = row => [...row.querySelectorAll(':scope > .qb-slot[data-path]')];
  // the words in what was typed or pasted: split at line ends, semicolons, commas and ORs outside quotes, the quotes gone (a phrase is
  // quoted where it is written)
  const wordList = s => {
    const out = [''];
    let q = false;
    for (const ch of String(s).replace(/\s+OR\s+/g, '\n')) { if (ch === '"') q = !q; if (!q && /[\r\n;,]/.test(ch)) out.push(''); else out[out.length - 1] += ch; }
    return out.map(w => w.replace(/"/g, '').trim()).filter(Boolean);
  };
  // words put at the end of an input's row, its blanks gone; the caret stays in the row's input unless `focus` says
  function addWords(input, words, focus = null) {
    if (!words.length) return false;
    const m = model(), paths = rowOf(input), field = nodeAt(m, paths[0])?.field ?? 'tiab';
    const blanks = paths.filter(p => !nodeAt(m, p)?.text), last = parentOf(paths.at(-1));
    return edit({ removed: blanks, nodes: words.map(w => buildTerm(field, w)), to: { mouth: last.mouth, index: last.index + 1 - blanks.length } }, focus);
  }
  // a word taken out, the caret in its row's input; the row's only term leaves a blank of its field, so the row and its input stay
  function removeWord(path) {
    const m = model(), term = nodeAt(m, path), p = parentOf(path), list = nodeAt(m, p.mouth)?.items || [];
    const same = x => x?.kind === 'term' && x.label === term.label;
    let a = p.index, b = p.index;
    while (same(list[a - 1])) a--;
    while (same(list[b + 1])) b++;
    if (a === b) return edit({ removed: [path], nodes: [buildTerm(term.field, '')], to: { mouth: p.mouth, index: p.index } });
    // a term of the row that keeps a path: the one before, else the one that moves into this place
    return edit({ removed: [path] }, a < p.index ? childPath(p.mouth, p.index - 1) : path);
  }
  const focusWord = path => work.querySelector(`.qb-slot[data-path="${CSS.escape(path)}"]`)?.focus({ preventScroll: true });
  // a word edited in place: an input of the slot's own size holding its words; Enter, Tab or leaving it keeps them, Escape gives them back
  function openWord(slot) {
    const path = slot.dataset.path, term = nodeAt(model(), path);
    if (term?.kind !== 'term' || slot.querySelector('input')) return;
    slot.classList.add('qb-grow'); slot.dataset.v = term.text;
    slot.innerHTML = '<input type="text" size="1" spellcheck="false" autocomplete="off">';
    const input = slot.firstElementChild;
    input.value = term.text; input.setAttribute('aria-label', `Word ${term.text}`);
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      const w = input.value.replace(/"/g, '').trim();
      if (!keep || w === term.text) { render(); focusWord(path); return; }
      if (!w) { removeWord(path); return; }
      B.undo.push(clone(B.tree)); term.text = w;
      render(); focusWord(path);
    };
    input.addEventListener('input', () => { slot.dataset.v = input.value || ' '; });
    input.addEventListener('keydown', e => {
      e.stopPropagation();   // its keys are its own: not the row's, nor the drag code's
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus({ preventScroll: true }); input.select();
  }
  work.addEventListener('input', e => { if (isAdd(e.target)) size(e.target); });
  work.addEventListener('keydown', e => {
    const t = e.target;
    if (isAdd(t)) {
      const v = t.value, row = t.closest('.qb-terms'), open = (v.match(/"/g) || []).length % 2 === 1;
      // a key handled here goes no further: the drag code reads the focus it moved to (Backspace there would remove the word now selected)
      if (e.key === 'Enter' || (!open && (e.key === ',' || e.key === ';')) || (e.key === 'Tab' && !e.shiftKey && v.trim())) {
        e.preventDefault(); e.stopPropagation();
        t.value = '';   // emptied first: the drawing removes the input, and its focusout must not add the words again
        addWords(t, wordList(v));
      } else if (e.key === 'Backspace' && !v) {
        e.preventDefault(); e.stopPropagation();
        (wordsOf(row).at(-1) || row).focus({ preventScroll: true });
      } else if (e.key === 'ArrowLeft' && !e.altKey && !t.selectionStart && !t.selectionEnd && wordsOf(row).length) {
        e.preventDefault(); e.stopPropagation();
        wordsOf(row).at(-1).focus({ preventScroll: true });
      }
      return;
    }
    if (!t.matches?.('.qb-slot[data-path]') || e.altKey || e.metaKey || e.ctrlKey) return;
    const row = t.closest('.qb-terms'), words = wordsOf(row), i = words.indexOf(t);
    const own = { Backspace: () => removeWord(t.dataset.path), Delete: () => removeWord(t.dataset.path), ArrowLeft: () => words[i - 1]?.focus({ preventScroll: true }),
      ArrowRight: () => (words[i + 1] || row.querySelector('.qb-add input'))?.focus({ preventScroll: true }), Enter: () => openWord(t), F2: () => openWord(t) }[e.key];
    if (own) { e.preventDefault(); e.stopPropagation(); own(); }
  });
  work.addEventListener('dblclick', e => { const s = e.target.closest('.qb-slot[data-path]'); if (s && !e.target.closest('input')) { e.preventDefault(); openWord(s); } });
  // leaving a row's input keeps what was typed there, and the caret goes on where it was going (the same input or word, counted in the page)
  work.addEventListener('focusout', e => {
    const t = e.target;
    if (!isAdd(t) || !t.isConnected || !wordList(t.value).length) return;
    const next = e.relatedTarget, kind = isAdd(next) ? '.qb-add input' : next?.matches?.('.qb-slot[data-path]') ? '.qb-slot[data-path]' : '';
    const i = kind ? [...work.querySelectorAll(kind)].indexOf(next) : -1, words = wordList(t.value);
    t.value = '';
    addWords(t, words, '');
    if (i >= 0) work.querySelectorAll(kind)[i]?.focus({ preventScroll: true });
  });
  // a list pasted into a row's input is a word a line; one word is pasted as typed
  work.addEventListener('paste', e => {
    const t = e.target; if (!isAdd(t)) return;
    const parts = wordList(e.clipboardData?.getData('text/plain') || '');
    if (parts.length < 2) return;
    e.preventDefault();
    const typed = wordList(t.value);
    t.value = '';
    addWords(t, [...typed, ...parts]);
  });
  // a click on a row's own ground types in its input
  work.addEventListener('click', e => { if (e.target.matches?.('.qb-terms')) e.target.querySelector('.qb-add input')?.focus({ preventScroll: true }); });

  // ---- the field of a row, undo, the cards' buttons ----
  work.addEventListener('click', e => {
    const b = e.target.closest('[data-field-of]'); if (!b) return;
    const paths = b.dataset.fieldOf.split(','), first = nodeAt(model(), paths[0]);
    showMenu(b, BUILD_FIELDS.map(([key, , name]) => ({ label: name, checked: first?.field === key, run: () => {
      B.undo.push(clone(B.tree));
      for (const p of paths) { const t = nodeAt(model(), p); if (t) Object.assign(t, buildTerm(key, t.text)); }
      render(paths[0]);
    } })));
  });
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || !work.isConnected || !work.offsetParent) return;
    if (document.activeElement?.matches('input, textarea') || !B.undo.length) return;
    e.preventDefault();
    B.tree = B.undo.pop(); render();
  });
  cards.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const m = /^qv-(copy|text)-(.+)$/.exec(b.id); if (!m) return;
    const q = queries.get(m[2]) || '';
    if (m[1] === 'text') toText(q);
    else navigator.clipboard?.writeText(q).then(() => { cards.querySelector('#qv-said').textContent = `${nameOf(BUILD_TARGETS, m[2])} query copied.`; }, () => {});
  });
  render();
  return { tree: () => B.tree,
    setTree(tree) { B.undo.push(clone(B.tree)); if (B.undo.length > 50) B.undo.shift(); B.tree = upgradeTree(clone(tree)); B.closed.clear(); render(); } };
}
