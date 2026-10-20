// The comment column beside a document's pages, as Word's markup view has it:
// each card level with the text it is on, pushed down by the card above when
// that one needs the room. The manuscript editor uses it with Reply, Resolve
// and Delete; the Files view's Word preview uses it read-only. The column is
// placed inside the pages' own scroller, so it scrolls with them: one scroller.
//
// A card is anchored by position: to the element the document's own comment
// range became (`.tc-cm[data-cm~=id]`), or to a comment made at a point
// (`.tok.comment[data-comment=id]`) — never by matching the comment's text.
import { esc } from './html.mjs';
import { day } from './dates.mjs';

/** The width reserved beside the pages for the column, in CSS pixels. */
export const COMMENT_W = 256;

const fmtDate = d => day(d);

/**
 * The column element for `list` (lib/manuscript-doc.mjs commentOrder: roots
 * with their replies). With `actions`, each card carries Reply, Resolve and
 * Delete buttons; without, it is read-only.
 */
export function commentColumn(list, { active = null, actions = false } = {}) {
  const col = document.createElement('div');
  col.className = 'ms-comments';
  col.setAttribute('role', 'complementary');
  col.setAttribute('aria-label', 'Comments');
  const one = c => `<div class="ms-cm-by"><span class="ms-cm-author">${esc(c.author || 'Author')}</span><span class="meta">${esc(fmtDate(c.date))}</span></div><div class="ms-cm-text">${esc(c.text || '')}</div>`;
  col.innerHTML = list.map(c => `<section class="ms-cm${c.done ? ' done' : ''}${c.id === active ? ' on' : ''}" data-cm-card="${esc(c.id)}" tabindex="0">
      ${one(c)}${(c.replies || []).map(r => `<div class="ms-cm-reply">${one(r)}</div>`).join('')}
      ${actions ? `<div class="ms-cm-act"><button class="quiet" data-cm-reply>Reply</button><button class="quiet" data-cm-done>${c.done ? 'Reopen' : 'Resolve'}</button><button class="quiet" data-cm-del>Delete</button></div>` : ''}
    </section>`).join('');
  return col;
}

/** The element a comment is anchored to in `root`, by its place in the document. */
export const commentAnchor = (root, id) => root.querySelector(`.tc-cm[data-cm~="${CSS.escape(id)}"],.tok.comment[data-comment="${CSS.escape(id)}"]`);

/** Each card level with the start of its text, below the card above it. `scroller` holds both the pages and the column. */
export function positionColumn(scroller, root) {
  const col = scroller?.querySelector(':scope > .ms-comments');
  if (!col) return;
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  let next = 0;
  for (const card of col.querySelectorAll('[data-cm-card]')) {
    const anchor = commentAnchor(root, card.dataset.cmCard);
    const top = Math.max(next, anchor ? anchor.getBoundingClientRect().top - base : next);
    card.style.setProperty('top', `${top}px`);
    next = top + card.offsetHeight + 8;
  }
  col.style.setProperty('height', `${next}px`);
}

/** Mark one comment's text and card as the current one (fill only). */
export function markComment(scroller, root, id) {
  root.querySelectorAll('.tc-cm.on,.tok.comment.on').forEach(x => x.classList.remove('on'));
  scroller?.querySelectorAll('[data-cm-card]').forEach(c => c.classList.toggle('on', c.dataset.cmCard === id));
  if (!id) return;
  root.querySelectorAll(`.tc-cm[data-cm~="${CSS.escape(id)}"],.tok.comment[data-comment="${CSS.escape(id)}"]`).forEach(x => x.classList.add('on'));
}
