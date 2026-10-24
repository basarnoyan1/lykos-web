// Comments in the Details pane (plan §2, "Working as a team"; lib/comments.mjs): the comments on the record or figure shown, and a box to
// add one, where "@" names a teammate. With nothing selected, the pane lists the open comments that mention the person at this window.
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiList, uiRow, uiRowEnd, uiComposer } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ago } from '../lib/dates.mjs';
import { addComment, commentsOn, mentionsOf, removeComment, setCommentDone } from '../lib/comments.mjs';
import { byMe, currentPerson, personOf } from '../lib/team.mjs';

const nameOf = (s, who) => personOf(s, who)?.name || who || 'Someone';

/** The section for `target` ({ kind: 'record' | 'item', id }): { title, html, wire }. `id` prefixes its element ids, so two panes can show comments at once. */
export function commentsSection(target, ctx, { id = 'cm' } = {}) {
  const s = get(), list = commentsOn(s, target), mine = byMe(s);
  // As the references draw a comment (Plane, Jira, Linear): who and when on one line, the text under it; Resolve and Delete in its More.
  const rows = list.map(c => uiRow({ attrs: { 'data-cm': c.id, 'data-cm-done': c.done ? '' : false },
    main: { html: `<span class="cm-who">${esc(nameOf(s, c.by))}<span class="meta">${esc(ago(c.at))}${c.done ? ', resolved' : ''}</span></span><span class="cm-text">${esc(c.text)}</span>` },
    end: uiRowEnd({ more: { label: 'More for this comment', attrs: { 'data-cm-more': c.id } } }) }));
  const html = (rows.length ? uiList({ id: `${id}-list`, label: 'Comments', rows }) : '')
    + uiComposer({ id: `${id}-compose`, input: { id: `${id}-input`, label: 'Comment', placeholder: 'Comment; @ names a teammate', rows: 2, maxlength: 4000 },
      send: { id: `${id}-send`, label: 'Comment' }, stop: { id: `${id}-stop`, label: 'Stop' } });
  return { title: 'Comments', meta: list.length ? String(list.length) : '', html, wire: host => {
    const form = host.querySelector(`#${id}-compose`), input = host.querySelector(`#${id}-input`);
    form?.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      update(st => { addComment(st, { target, text, by: byMe(st) }); });
      input.value = '';
      ctx.rerender?.();
    });
    input?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
    host.querySelectorAll('[data-cm-more]').forEach(b => b.addEventListener('click', () => {
      const c = (get().comments || []).find(x => x.id === b.dataset.cmMore);
      if (!c) return;
      showMenu(b, [
        { label: c.done ? 'Reopen' : 'Resolve', run: () => { update(st => { setCommentDone(st, c.id, !c.done); }); ctx.rerender?.(); } },
        ...(c.by === mine ? ['-', { label: 'Delete', danger: true, run: () => { update(st => { removeComment(st, c.id, mine); }); ctx.rerender?.(); } }] : []),
      ]);
    }));
  } };
}

/** The open comments that mention the person at this window, for the pane with nothing selected; `open(target)` shows where one is. */
export function mentionsSection(open) {
  const s = get(), list = mentionsOf(s, currentPerson(s));
  if (!list.length) return null;
  const where = t => t.kind === 'record' ? (s.papers || []).find(p => p.id === t.id)?.label || 'A record' : t.kind === 'manuscript' ? 'Manuscript' : 'A table or figure';
  const rows = list.slice(0, 20).map(c => uiRow({
    main: { html: `<button type="button" class="tk-text" data-cm-open="${esc(c.id)}">${esc(c.text)}</button>`, detail: [esc(nameOf(s, c.by)), esc(where(c.target)), esc(ago(c.at))], wrap: true } }));
  return { title: 'Mentions', html: uiList({ id: 'cm-mentions', label: 'Comments that mention you', rows }), wire: host => {
    host.querySelectorAll('[data-cm-open]').forEach(b => b.addEventListener('click', () => { const c = list.find(x => x.id === b.dataset.cmOpen); if (c) open(c.target); }));
  } };
}
