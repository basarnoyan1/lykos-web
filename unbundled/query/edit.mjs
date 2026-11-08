// Editing the blocks by hand (query.html, Text mode), as Scratch's are edited: a block (a row of terms, one term, a proximity, a line, a
// group with everything in it) is dragged with the pointer out of its place and dropped into any mouth, before or after what is there
// (a bar shows where it will go); dropped on the query's text it is removed; dropped anywhere else it goes back. A focused block moves
// with Alt and the arrow keys (up and down among its neighbours, left out of its group, right into the group before it) and goes with
// Backspace. Every edit is one change of the text (lib/query-edit.mjs writes the lines it touched), made the way typing would, so the
// field's own undo takes it back; the page then draws the blocks from the text again. Pointer events only: HTML5 drag-and-drop draws
// its own ghost, badly in WebKit, and cannot be told where to go. The builder (query/builder.mjs) edits its tree with the same code: its
// gallery (`sources`) holds blocks that drag out as new ones (`fresh(el)`), and a block dropped back on the gallery goes. A But not takes
// away from an All of, so only an All of's mouth shows a place for one, by pointer or by keyboard.

const DRAGGABLE = '[data-path], [data-paths]';
// whether a mouth may take a But not: only an All of's
const takesNot = mouth => !!mouth?.parentElement?.matches('.qb-all');
const THRESHOLD = 4;
const ZONE = 40;   // a drag this near a pane's top or bottom scrolls it

// ---- scrolling: only the pane a block is in, never the page round it, and under the pane's own pinned head ----------------------------
/** The element that scrolls `el`: its nearest ancestor that scrolls, else the page. */
export function scrollerOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;   // the page is body's scroll (query.html)
  }
  return document.scrollingElement;
}
// the part of a scroller blocks can be seen in: below its pinned head (a sticky first child), or the page's below its brand row
function viewOf(s) {
  if (s === document.body || s === document.scrollingElement) return { top: parseFloat(getComputedStyle(document.body).getPropertyValue('--qv-head-h')) || 0, bottom: innerHeight, left: 0, right: innerWidth };
  const r = s.getBoundingClientRect(), h = s.firstElementChild;
  return { top: r.top + (h && getComputedStyle(h).position === 'sticky' ? h.offsetHeight : 0), bottom: r.bottom, left: r.left, right: r.right };
}
/** Scrolls `el`'s pane (only it) the least that brings `el` into view; a block taller than the view shows its top. */
export function reveal(el) {
  if (!el) return;
  const s = scrollerOf(el), v = viewOf(s), b = el.getBoundingClientRect();
  if (b.top < v.top) s.scrollTop -= v.top - b.top + 8;
  else if (b.bottom > v.bottom) s.scrollTop += Math.min(b.bottom - v.bottom + 8, b.top - v.top - 8);
}

/**
 * Wires editing on `blocks` (the element the blocks are drawn in). `edit(spec)` makes an edit (lib/query-edit.mjs's spec) and answers
 * the path the first block put in now has (true when it has none to give), or false when it could not; a block dropped on `dropZone` is removed; a block of `sources` ([data-new]) drags in as `fresh(el)`'s nodes.
 */
export function mountEditing(blocks, { edit, dropZone, sources = null, fresh = null }) {
  let drag = null;   // { el, paths, nodes, not, x0, y0, x, y, ghost, bar, started, target, scroller }
  let tick = 0;

  const pathsOf = el => (el.dataset.paths ? el.dataset.paths.split(',') : [el.dataset.path]);
  const blockOf = t => t.closest?.(DRAGGABLE);
  // the field a row of terms (or a word's row) searches, as its label names it; '' for a block
  const labelOf = el => { const row = el?.closest?.('.qb-terms'); return row ? row.firstElementChild?.textContent.trim() || '' : ''; };
  const kidsOf = mouth => [...mouth.children].filter(k => k.matches(DRAGGABLE) && k !== drag.el);

  // the place a drop would take: the mouth under the pointer and the first of its children the pointer is above
  function targetAt(x, y) {
    const under = document.elementFromPoint(x, y);
    let mouth = under?.closest?.('[data-mouth]'), before;
    if (!mouth || drag.el.contains(mouth)) return dropZone.contains(under) ? { remove: true } : null;
    // over a group's top bar (its lower half) or its bottom bar (its upper half): into the group's own mouth, first or last
    const bar = under.closest('.qb-c > .qb-top, .qb-c > .qb-bottom'), c = bar?.parentElement;
    const own = bar && !drag.el.contains(bar) && c.open !== false && c.querySelector(':scope > .qb-mouth[data-mouth]');
    if (own && (!drag.not || takesNot(own))) {
      const r = bar.getBoundingClientRect(), low = y > r.top + r.height / 2, top = bar.matches('.qb-top');
      if (top ? low : !low) { mouth = own; before = top ? kidsOf(own)[0] || null : null; }
    }
    if (drag.not && !takesNot(mouth)) return null;
    // a word held over its own row goes back where it was: the bar cannot show a place between the words of a row
    if (drag.el.matches('.qb-slot') && drag.el.closest('.qb-terms')?.contains(under)) return null;
    if (before === undefined) { before = null; for (const k of kidsOf(mouth)) { const r = k.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = k; break; } } }
    // its own place (in its own mouth, before what follows it) keeps it where it is, whatever rows of its field the mouth has
    if (drag.el.parentElement === mouth) {
      const kids = [...mouth.children].filter(k => k.matches(DRAGGABLE)), after = kids[kids.indexOf(drag.el) + 1] || null;
      if (before === after) return { mouth, before, path: mouth.dataset.mouth };
    }
    // words go into the row of their field where the mouth has one (at its end), unless they are dropped beside such a row already
    if (drag.label) {
      const kids = kidsOf(mouth), prev = before ? kids[kids.indexOf(before) - 1] : kids.at(-1);
      const same = k => !!k?.matches('.qb-terms') && labelOf(k) === drag.label;
      const row = !same(prev) && !same(before) && kids.find(same);
      if (row) before = kids[kids.indexOf(row) + 1] || null;
    }
    return { mouth, before, path: mouth.dataset.mouth };
  }
  // the group a drop goes into is highlighted, its whole edge (query.html, data-hl)
  const lightUp = c => { if (drag.lit === c) return; drag.lit?.removeAttribute('data-hl'); c?.setAttribute('data-hl', ''); drag.lit = c; };
  // the bar is drawn over the joint the block will go into, not put among the blocks: nothing moves under the pointer while it is shown
  function showTarget(t) {
    dropZone.toggleAttribute('data-drop', !!t?.remove);
    lightUp(t?.mouth?.parentElement?.closest('.qb-c') || null);
    if (!t || t.remove) { drag.bar?.remove(); drag.bar = null; return; }
    if (!drag.bar) { drag.bar = document.createElement('div'); drag.bar.className = 'qb-place'; (blocks.closest('#qv-body') || document.body).append(drag.bar); }
    const m = t.mouth.getBoundingClientRect(), kids = [...t.mouth.children].filter(k => k.matches(DRAGGABLE) && k !== drag.el);
    // above the block it goes before; under the last one's body (above its tab); in an empty mouth, its middle
    const y = t.before ? t.before.getBoundingClientRect().top : kids.length ? kids.at(-1).getBoundingClientRect().bottom - 7 : m.top + m.height / 2;
    drag.bar.style.translate = `${Math.round(m.left + 11)}px ${Math.round(y - 1)}px`;
    drag.bar.dataset.mouth = t.path;
    drag.bar.dataset.next = t.before ? t.before.dataset.path || t.before.dataset.paths : '';
  }
  // a drag held near the pane's top or bottom scrolls it, faster the nearer the edge, and the drop place follows what moves under it
  function autoscroll() {
    tick = 0;
    if (!drag?.started) return;
    const s = drag.scroller, v = viewOf(s), { x, y } = drag;
    if (x < v.left || x > v.right) return;
    const dy = y < v.top + ZONE ? -Math.ceil((v.top + ZONE - y) / 4) : y > v.bottom - ZONE ? Math.ceil((y - v.bottom + ZONE) / 4) : 0;
    if (!dy) return;
    const was = s.scrollTop; s.scrollTop += dy;
    if (s.scrollTop !== was) { drag.target = targetAt(x, y); showTarget(drag.target); }
    tick = requestAnimationFrame(autoscroll);
  }
  function endDrag(commit) {
    const d = drag; drag = null;
    cancelAnimationFrame(tick); tick = 0;
    if (!d) return;
    d.el.releasePointerCapture?.(d.pointerId);
    d.ghost?.remove(); d.bar?.remove(); d.lit?.removeAttribute('data-hl');
    d.el.removeAttribute('data-dragging'); dropZone.removeAttribute('data-drop'); document.body.removeAttribute('data-qv-drag');
    if (!d.started) return;
    d.el.setAttribute('data-dragged', ''); setTimeout(() => d.el.removeAttribute('data-dragged'), 0);   // the click that follows is not a click
    if (!commit || !d.target) return;
    if (d.target.remove) { if (!d.nodes) edit({ removed: d.paths }); return; }
    // the index of what the drop falls before, counted in the model before the move; past the end appends
    const index = d.target.before ? Number(/(\d+)$/.exec(pathsOf(d.target.before)[0])?.[1] ?? 0) : 1e9;
    const to = { mouth: d.target.path, index };
    edit(d.nodes ? { nodes: d.nodes, to } : { removed: d.paths, to });
  }

  const start = (e, d) => { drag = { x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, started: false, target: null, ghost: null, bar: null, lit: null, label: labelOf(d.el),
    not: d.el.matches('.qb-not') || !!d.nodes?.some(n => n.kind === 'not'), ...d }; };
  // a press in a word's input types in it; moved 4px, it drags that word (only it) out of its row
  blocks.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.qb-add')) return;   // a row's input (the builder's) is for typing
    const el = blockOf(e.target); if (!el || !blocks.contains(el)) return;
    start(e, { el, paths: pathsOf(el), input: e.target.closest('input') });
  });
  sources?.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-new]');
    if (e.button !== 0 || !el) return;
    start(e, { el, paths: [], nodes: fresh(el) });
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < THRESHOLD) return;
      drag.started = true;
      if (drag.input) { drag.input.blur(); getSelection()?.removeAllRanges(); }
      drag.el.setPointerCapture(e.pointerId);
      drag.scroller = scrollerOf(blocks.firstElementChild || blocks);
      const r = drag.el.getBoundingClientRect();
      drag.dx = e.clientX - r.left; drag.dy = e.clientY - r.top;
      const ghost = drag.el.cloneNode(true); ghost.className += ' qb-ghost'; ghost.removeAttribute('id');
      (blocks.closest('#qv-body') || document.body).append(ghost); drag.ghost = ghost;   // where the blocks' shapes and sizes are defined
      if (!drag.nodes) drag.el.setAttribute('data-dragging', '');
      document.body.setAttribute('data-qv-drag', '');
    }
    drag.ghost.style.translate = `${e.clientX - drag.dx}px ${e.clientY - drag.dy}px`;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.target = targetAt(e.clientX, e.clientY);
    showTarget(drag.target);
    if (!tick) tick = requestAnimationFrame(autoscroll);
  });
  document.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pointerId) { if (drag.started) e.preventDefault(); endDrag(true); } });
  document.addEventListener('pointercancel', () => endDrag(false));
  // a drag that began is not a click: the summary must not fold, the slot must not select, the gallery must not add
  document.addEventListener('click', e => { if (e.target.closest?.('[data-dragged]')) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) { endDrag(false); return; }
    // keys in the text and in a word's input are theirs, but Alt+Up and Alt+Down in a word's input move that word
    const ae = document.activeElement;
    if (ae?.matches('textarea') || (ae?.matches('input') && !(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')))) return;
    const el = ae?.matches('input') ? ae.closest('.qb-slot[data-path]') : ae?.closest?.(DRAGGABLE) || (ae?.matches('summary') ? ae.parentElement : null);
    if (!el || !blocks.contains(el) || !el.matches(DRAGGABLE)) return;
    const paths = pathsOf(el), first = paths[0], m = /^(.*?)(\.?)(\d+)$/.exec(first);
    // the moved block keeps the keyboard: its row, its group's summary, its word's input
    const word = el.matches('.qb-slot');
    const focusOn = placed => requestAnimationFrame(() => {
      if (typeof placed !== 'string') return;
      const b = blocks.querySelector(`[data-path="${CSS.escape(placed)}"]`);
      const row = [...blocks.querySelectorAll('[data-paths]')].find(r => r.dataset.paths.split(',').includes(placed));
      // a row of one word that lands beside a row of its field is drawn in that row: the keyboard stays on its word, so the move back
      // takes only it
      const joined = row && paths.length === 1 && el.matches('[data-paths]') && row.dataset.paths.split(',').length > 1;
      const t = word ? b?.querySelector('input') || b : b?.matches('details') ? b.querySelector(':scope > summary') : joined ? b : row || b;
      t?.focus?.({ preventScroll: true }); reveal(t);
    });
    const move = to => focusOn(edit({ removed: paths, to }));
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); edit({ removed: paths }); return; }
    if (!e.altKey || !m) return;
    const parentPath = m[1] || first.slice(0, first.indexOf(':') + 1), not = el.matches('.qb-not');
    const mouth = el.parentElement.closest('[data-mouth]');
    const unit = word ? el.closest('.qb-terms') : el;   // what a word passes at its row's ends, and a row or block passes, is a whole neighbour
    const of = (k, last) => Number(/(\d+)$/.exec(last ? pathsOf(k).at(-1) : pathsOf(k)[0])[1]);
    const idx = p => Number(/(\d+)$/.exec(p)[1]);
    // out of the group this is in: before it (up) or after it (left, down)
    const out = after => {
      const outer = mouth.parentElement.closest('[data-mouth]'), group = mouth.closest('[data-path]');
      if (outer && group && (!not || takesNot(outer))) move({ mouth: outer.dataset.mouth, index: idx(group.dataset.path) + (after ? 1 : 0) });
    };
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (word) {   // within its row, a word passes one word
        const row = pathsOf(unit), i = row.indexOf(first), next = row[i + (up ? -1 : 1)];
        if (next) { move({ mouth: parentPath, index: up ? idx(next) : idx(next) + 1 }); return; }
      }
      const kids = [...mouth.children].filter(k => k.matches(DRAGGABLE));
      const other = kids[kids.indexOf(unit) + (up ? -1 : 1)];
      // before the one above (its first term); after the one below (past its last term, counted before this leaves the list); at an end, out
      if (other) move({ mouth: parentPath, index: up ? of(other, false) : of(other, true) + 1 });
      else out(!up);
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); out(true); }
    else if (e.key === 'ArrowRight') {
      // into the group before this, at its end; with none before, into the group after it, first (a But not: the All of before or after)
      e.preventDefault();
      const group = (k, step) => { while (k && !k.matches(not ? 'details.qb-all[data-path]' : 'details[data-path]')) k = k[step]; return k; };
      const prev = group(unit.previousElementSibling, 'previousElementSibling'), next = !prev && group(unit.nextElementSibling, 'nextElementSibling');
      const into = prev || next;
      if (!into) return;
      into.open = true;
      move({ mouth: into.dataset.path, index: prev ? 1e9 : 0 });
    }
  });
  return { edit };
}
