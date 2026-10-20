// A long table drawn a window at a time (Extraction redesign §1.2, measured before it was built: 1,000 studies x 15 fields took 336 ms to
// first paint and 300 ms per arrow key in Chromium, 200 studies 105 ms and 75 ms). Only the row groups in view, and a margin of rows either
// side, are in the DOM; two spacer rows keep the scroll height, so the scroll bar, the held header and the held first column behave as with
// every row drawn. The keyboard order and the selection are the caller's model, never the DOM: `reveal(i)` draws group i before it is used.
// A group is one study: its arm rows stay together. No dependency, no observer: the region's own scroll event, at most once a frame.

/** Tables with more groups than this are windowed; fewer are drawn whole. */
export const WINDOW_FROM = 200;
const MARGIN = 40;   // rows drawn beyond each edge of the view

/** The offsets of groups of `heights` (px), and the total. */
export function offsetsOf(heights) {
  const at = new Array(heights.length + 1); at[0] = 0;
  for (let i = 0; i < heights.length; i++) at[i + 1] = at[i] + heights[i];
  return at;
}
/** The first group whose bottom is below `y` (binary search over the offsets). */
const groupAt = (at, y) => { let lo = 0, hi = at.length - 2; while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid + 1] <= y) lo = mid + 1; else hi = mid; } return Math.max(0, lo); };

/** The groups to draw for a scroll position: [start, end) and the spacer heights above and below them. Pure, for the tests. */
export function windowOf(at, top, view, margin) {
  const n = at.length - 1;
  if (!n) return { start: 0, end: 0, before: 0, after: 0 };
  const start = groupAt(at, Math.max(0, top - margin)), end = Math.min(n, groupAt(at, top + view + margin) + 1);
  return { start, end, before: at[start], after: at[n] - at[end] };
}

/**
 * Draws `tbody` of the table in `region` a window at a time. `heights()` gives each group's estimated height (rows of different line counts
 * differ; a group is the rows from one that `isStart` accepts to the next); `draw(start, end)` returns the rows' HTML; `after({ hadFocus })`
 * runs once new rows are in (the caller puts back what it had in them: an open editor, the focus). `cols` is the table's column count, for
 * the spacer cells. The estimates are corrected by measurement: after each draw the drawn groups' real heights replace theirs, the spacers
 * follow, and the scroll position is moved by what changed above the first row in view, so a row that came out taller than estimated shifts
 * nothing the person looks at. Returns { reveal(i), paint(), relayout(), destroy(), range }.
 */
export function windowRows(region, tbody, { heights, draw, after = () => {}, cols, isStart = tr => tr.hasAttribute('data-row'), headHeight = () => region.querySelector('thead')?.offsetHeight || 28 }) {
  let est = Array.from(heights()), at = offsetsOf(est), cur = null, queued = false, depth = 0;
  const spacer = cls => `<tr class="ui-window-spacer ${cls}" aria-hidden="true"><td colspan="${cols}"></td></tr>`;
  const setSpacers = w => {
    tbody.querySelector('.ui-window-spacer.before > td').style.height = `${w.before}px`;
    tbody.querySelector('.ui-window-spacer.after > td').style.height = `${w.after}px`;
  };
  /** The drawn groups' real heights replace the estimates; the offsets, the spacers and the scroll follow. Returns whether anything changed. */
  const correct = () => {
    const sums = new Map();
    let g = cur.start - 1;
    for (const tr of tbody.children) {
      if (tr.classList.contains('ui-window-spacer')) continue;
      if (isStart(tr)) g++;
      sums.set(g, (sums.get(g) || 0) + tr.getBoundingClientRect().height);
    }
    let changed = false;
    for (const [i, h] of sums) if (i >= 0 && i < est.length && Math.abs(h - est[i]) > 0.5) { est[i] = h; changed = true; }
    if (!changed) return false;
    const was = at, top = region.scrollTop, anchor = groupAt(was, top);
    at = offsetsOf(est);
    cur = { start: cur.start, end: cur.end, before: at[cur.start], after: at[at.length - 1] - at[cur.end] };
    setSpacers(cur);
    const shift = at[anchor] - was[anchor];
    if (Math.abs(shift) > 0.5) region.scrollTop = top + shift;
    return true;
  };
  const paint = (force = false) => {
    const w = windowOf(at, region.scrollTop, region.clientHeight || 800, MARGIN * 28);
    if (!force && cur && w.start === cur.start && w.end === cur.end) return;
    cur = w;
    const hadFocus = tbody.contains(document.activeElement);   // a focused cell is drawn again: the caller gives it the focus back
    const keep = region.scrollTop;
    tbody.innerHTML = spacer('before') + draw(w.start, w.end) + spacer('after');
    setSpacers(w);
    if (region.scrollTop !== keep) region.scrollTop = keep;   // WebKit clamps the offset to 0 if layout runs while the new rows stand without their spacers
    after({ hadFocus });
    if (correct() && depth < 3) { depth++; try { const moved = windowOf(at, region.scrollTop, region.clientHeight || 800, MARGIN * 28); if (moved.start !== cur.start || moved.end !== cur.end) paint(); } finally { depth--; } }
  };
  paint(true);
  const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (region.isConnected) paint(); }); };
  region.addEventListener('scroll', onScroll, { passive: true });
  return {
    paint,
    get range() { return cur; },
    /** The estimates again (the layout changed: widths, an opened row), the window drawn anew. */
    relayout() { est = Array.from(heights()); at = offsetsOf(est); paint(true); },
    destroy() { region.removeEventListener('scroll', onScroll); },
    /** Draws group `i` if it is not drawn, scrolling the region to it (just into view). */
    reveal(i) {
      if (cur && i >= cur.start && i < cur.end) return;
      // the rows sit under the held header: a row above the view goes to its top edge, one below to its bottom edge
      const top = at[i], bottom = at[i + 1] + headHeight();
      region.scrollTop = top < region.scrollTop ? top : Math.max(0, bottom - region.clientHeight);
      paint();
    },
  };
}
