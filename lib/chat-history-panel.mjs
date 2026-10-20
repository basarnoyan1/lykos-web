import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { chatHistoryPage } from './chat-history-query.mjs';
import { showMenu, closeMenu } from './menu.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from './ui-actions.mjs';

const PAGE = 6;
/** The head of the panel: Back, the title, New chat, and the archive toggle in More. */
const headBar = archived => uiBar({ kind: 'head', label: 'Chats', id: 'chat-history-bar', lead: { title: archived ? 'Archived chats' : 'Chats', level: 'h3', back: { id: 'chat-history-back', label: 'Back' } },
  actions: [{ id: 'chat-history-new', label: 'New chat', icon: 'plus' }], overflow: [{ id: 'chat-history-archived', label: 'Archived chats', checked: archived }] });
const searchBar = () => uiBar({ kind: 'tools', label: 'Search chats', id: 'chat-history-tools', filters: [{ type: 'search', id: 'chat-history-q', label: 'Search chats', placeholder: 'Search chats', width: 'flex' }] });
const pagerBar = (offset, total) => uiBar({ kind: 'strip', label: 'Chat pages', id: 'chat-history-pager', density: 'dense', status: { id: 'chat-history-range', text: `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`, ch: 14 },
  actions: [{ id: 'chat-history-prev', label: 'Previous chats', icon: 'chevron-left', disabled: offset === 0, attrs: { 'data-page': 'prev' } }, { id: 'chat-history-next', label: 'Next chats', icon: 'chevron-right', disabled: offset + PAGE >= total, attrs: { 'data-page': 'next' } }] });

let activeHistory = null;
export function closeChatHistory() { activeHistory?.close(); }

/** A searchable history, with actions belonging to each conversation. It is drawn into `dock`, the inspector's own slot: the chat gives way to it. */
export function openChatHistory(anchor, { sessions, activeId, teamName, describe, running, select, create, rename, archive, remove, dock }) {
  if (activeHistory?.anchor === anchor) { closeChatHistory(); anchor.focus(); return; }
  closeChatHistory(); closeMenu();
  const panel = document.createElement('section');
  panel.id = 'chat-history-panel'; panel.className = 'chat-history-panel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chats');
  panel.innerHTML = `${headBar(false)}${searchBar()}<div class="chat-history-rows"></div><div class="chat-history-end"></div>`;
  dock.append(panel);
  const inspector = dock.closest('.assist');
  // the chat's own controls give way to the history while it is docked (the bar's display belongs to the contract, so it is hidden, not restyled)
  const chatTools = () => inspector?.querySelector('.assist-chat-tools');
  inspector?.classList.add('chat-history-view'); { const t = chatTools(); if (t) t.hidden = true; }
  anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', panel.id);
  let offset = 0, archived = false, closed = false;
  const input = panel.querySelector('#chat-history-q'), rows = panel.querySelector('.chat-history-rows'), head = panel.querySelector('#chat-history-bar'), foot = panel.querySelector('.chat-history-end');
  const close = () => {
    if (closed) return;
    closed = true; closeMenu(); panel.remove(); anchor.setAttribute('aria-expanded', 'false');
    anchor.removeAttribute('aria-controls');
    if (activeHistory?.panel === panel) activeHistory = null;
    dock.hidden = true; inspector?.classList.remove('chat-history-view'); { const t = chatTools(); if (t) t.hidden = false; }
  };
  let prior = '';
  const draw = (force = false) => {
    if (closed) return;
    const key = sessions().map(t => `${t.id}:${t.name}:${t.nameManual}:${t.teamId}:${teamName(t)}:${describe(t)}:${t.modelOverride}:${t.model}:${t.archivedAt}:${t.messages?.length}:${t.messages?.at(-1)?.at}:${running(t.id)}`).join('|') + `/${activeId()}/${input.value}/${archived}/${offset}`;
    if (!force && key === prior) return;
    prior = key;
    const page = chatHistoryPage(sessions(), { query: input.value, archived, offset, teamName });
    offset = page.offset; let group = '';
    const groups = [];
    for (const r of page.rows) { if (groups.at(-1)?.name !== r.group) groups.push({ name: r.group, rows: [] }); groups.at(-1).rows.push(r); }
    const row = ({ thread, title }) => {
      const detail = [running(thread.id) ? 'Running' : '', describe(thread)].filter(Boolean).join(' · ');
      return uiRow({ attrs: thread.id === activeId() ? { 'aria-current': 'true' } : {},
        main: { html: `<button type="button" class="tk-text" data-open-chat="${esc(thread.id)}" title="${esc([title, detail].filter(Boolean).join(' · '))}">${esc(title)}</button>`, detail: [running(thread.id) ? 'Running' : ''] },
        end: uiRowEnd({ more: { label: `Actions for ${title}`, attrs: { 'data-chat-actions': thread.id } } }) });
    };
    rows.innerHTML = groups.map((g, i) => uiList({ id: `chat-history-list-${i}`, label: `${g.name} chats`, attrs: { 'data-chat-list': '' },
      head: uiBar({ kind: 'head', label: g.name, id: `chat-history-g${i}`, lead: { title: g.name, level: 'h3' } }), rows: g.rows.map(row) })).join('')
      || `<p class="meta">${input.value ? 'No matching chats' : archived ? 'No archived chats' : 'No chats yet'}</p>`;
    foot.innerHTML = page.total > PAGE ? pagerBar(offset, page.total) : '';
    const title = head.querySelector('h3'); if (title) title.textContent = archived ? 'Archived chats' : 'Chats';
    head.querySelector('#chat-history-archived')?.setAttribute('aria-pressed', String(archived));
  };
  panel.onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.id === 'chat-history-back') { close(); anchor.focus(); }
    else if (b.id === 'chat-history-new') { close(); create(); }
    else if (b.dataset.openChat) { close(); select(b.dataset.openChat); }
    else if (b.id === 'chat-history-archived') { archived = !archived; offset = 0; closeMenu(); draw(true); input.focus(); }
    else if (b.dataset.page) { offset += b.dataset.page === 'next' ? PAGE : -PAGE; closeMenu(); draw(true); panel.querySelector(`[data-page="${b.dataset.page}"]:not(:disabled)`)?.focus(); }
    else if (b.dataset.chatActions) {
      const id = b.dataset.chatActions;
      showMenu(b, [
        { label: 'Rename', icon: 'manuscript', run: async () => { if (!dock) close(); await rename(id); if (!closed) draw(true); } },
        { label: archived ? 'Unarchive' : 'Archive', icon: 'folder', run: () => { if (!dock) close(); archive(id, !archived); if (!closed) draw(true); } },
        '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (!dock) close(); await remove(id); if (!closed) draw(true); } },
      ], { align: 'end', matchWidth: false });
    }
  };
  input.oninput = () => { offset = 0; closeMenu(); draw(); };
  panel.onkeydown = e => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
    else if (e.key === 'ArrowDown' && e.target === input) { e.preventDefault(); rows.querySelector('[data-open-chat]')?.focus(); }
    else if (['ArrowDown', 'ArrowUp'].includes(e.key) && e.target.matches('[data-open-chat]')) {
      e.preventDefault(); const buttons = [...rows.querySelectorAll('[data-open-chat]')], i = buttons.indexOf(e.target);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };
  activeHistory = { anchor, panel, close }; draw();
  dock.hidden = false;
  input.focus();
  return { refresh: draw, close };
}
