// All projects, the portfolio section (plans PORTFOLIO.md; plan §2 "Workspace", amendment "All projects: the portfolio"): every project
// at a glance, its menus, its keyboard and the project in the inspector. views/hub.mjs owns the page and its task sections and hands this
// module what it needs as `api`; the rows, blocks and their markup are lib/hub-tasks.mjs.
//
// The portfolio never reads a file to paint: rows come from the list entries, what the hub reader has already read, and the summaries
// this machine kept (lib/dashboard.mjs cachedSummary). Flags (pinned; active, paused, archived) are the list's own (projects.setFlags) and
// never touch a project file.
import { loadIdeas, saveIdeas as keepIdeas, addIdea, removeIdea, markStarted, exportIdeas } from '../lib/ideas.mjs';
/** Ideas are kept on this machine and written to Ideas.md beside the projects (lib/ideas.mjs exportIdeas), every time they change. */
const saveIdeas = list => { const ok = keepIdeas(list); exportIdeas(list); return ok; };
import { portfolioModel, portfolioParts, SHOW, SHOW_LABEL, projectKey, hubRow } from '../lib/hub-tasks.mjs';
import { uiList, uiRow, uiRowEnd, inspectorActions } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk, askText } from '../lib/dialog.mjs';
import { esc } from '../lib/html.mjs';
import { ago, day, plural, num } from '../lib/dates.mjs';
import { STATUS_LABELS } from '../lib/submissions.mjs';

const STATUS_WORDS = [['active', 'Active'], ['paused', 'Paused'], ['archived', 'Archived']];
const daysSince = (iso, today) => (iso && today ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 864e5) : null);

/**
 * `api`: { core(), host(), ctx(), today(), status(text), select(key), draw(), syncCount(), openProject(id, taskId?), openAt(id, view), setDone(id, done) }.
 * Answers the portfolio's own state and its parts for the page.
 */
export function createPortfolio(api) {
  const state = { show: 'current', selected: '', focus: '', expanded: new Set(), text: '' };
  const cached = id => { try { return api.core().d.cached?.(id) || null; } catch { return null; } };
  const rowsNow = (view = api.core().view()) => portfolioModel(api.core().listed(), view, api.today(), { cached });
  const openNote = () => api.core().d.openNote?.() || '';

  function parts() {
    const view = api.core().view();
    return portfolioParts(rowsNow(view), { today: api.today(), text: state.text, show: state.show, results: view, expanded: state.expanded,
      selectedId: state.selected, focusId: state.focus, openNote: openNote(), ideas: loadIdeas() });
  }
  const rowOf = id => rowsNow().find(p => p.id === id) || null;
  const entryOf = id => api.core().listed().find(e => e.id === id) || null;
  const host = () => api.host();

  // ---- the body only: the search keeps its focus and the bars are not measured again ----
  function drawBody() {
    const box = host()?.querySelector('#hub-portfolio');
    if (!box) { api.draw(); return; }
    const p = parts();
    if (!p.tools) { api.draw(); return; }                                   // the last project left the list: the empty page
    box.innerHTML = p.body;
    api.syncCount?.();                                                       // the count is the title bar's
    wireBody(); roving();
  }

  // ---- selection, the tab stop, the keyboard ----
  const stops = () => [...(host()?.querySelectorAll('#hub-portfolio [data-hub-project-row], #hub-portfolio [data-db-project], #hub-portfolio [data-hub-more]') || [])];
  const keyOf = el => el.dataset.hubProjectRow ? `p:${el.dataset.hubProjectRow}` : el.dataset.hubMore ? `m:${el.dataset.hubMore}` : `d:${el.dataset.dbProject}:${[...el.parentElement.children].indexOf(el)}:${el.closest('[data-hub-block]')?.id || ''}`;
  let stopKey = '';
  function roving() {
    const all = stops(); if (!all.length) return;
    if (!all.some(el => keyOf(el) === stopKey)) stopKey = keyOf(all.find(el => el.dataset.hubProjectRow === state.focus) || all.find(el => el.dataset.hubProjectRow) || all[0]);
    for (const el of all) {
      const on = keyOf(el) === stopKey;
      el.tabIndex = on ? 0 : -1;
      el.querySelectorAll('button').forEach(b => { b.tabIndex = on ? 0 : -1; });
    }
  }
  function focusStop(el) {
    if (!el) return;
    stopKey = keyOf(el); if (el.dataset.hubProjectRow) state.focus = el.dataset.hubProjectRow;
    roving(); el.focus({ preventScroll: false }); el.scrollIntoView?.({ block: 'nearest' });
  }
  function selectProject(id, { details = 'show' } = {}) {
    state.selected = id; state.focus = id;
    host()?.querySelectorAll('#hub-portfolio [data-hub-project-row]').forEach(r => r.setAttribute('aria-selected', String(r.dataset.hubProjectRow === id)));
    const row = host()?.querySelector(`#hub-portfolio [data-hub-project-row="${CSS.escape(id)}"]`); if (row) { stopKey = keyOf(row); roving(); }
    if (details === 'open') api.ctx()?.openDetails?.(); else if (details === 'show') api.ctx()?.showDetails?.();
  }
  function onKey(e) {
    const el = e.target.closest?.('#hub-portfolio [data-hub-project-row], #hub-portfolio [data-db-project], #hub-portfolio [data-hub-more]');
    if (!el) return false;
    if (e.target.matches('input, textarea, select')) return false;
    const all = stops(), at = all.indexOf(el);
    const go = i => { e.preventDefault(); focusStop(all[Math.max(0, Math.min(all.length - 1, i))]); return true; };
    if (e.key === 'ArrowDown') return go(at + 1);
    if (e.key === 'ArrowUp') return go(at - 1);
    if (e.key === 'Home') return go(0);
    if (e.key === 'End') return go(all.length - 1);
    if (e.key === 'Escape' && state.selected) { e.preventDefault(); state.selected = ''; selectProject(''); return true; }
    if (e.target !== el && e.target.matches('button')) return false;     // Open, More and Show all answer Enter themselves
    if (e.key === 'Enter') {
      e.preventDefault();
      if (el.dataset.hubProjectRow) api.openProject(el.dataset.hubProjectRow);
      else if (el.dataset.dbProject) openDated(el);
      else el.querySelector('[data-hub-all]')?.click();
      return true;
    }
    if (e.key === ' ' && el.dataset.hubProjectRow) { e.preventDefault(); return true; }   // Space does nothing on a project
    return false;
  }

  // ---- what the rows open ----
  function openDated(el) {
    const pid = el.dataset.dbProject, view = el.dataset.dbView || 'overview';
    if (view === '@overdue') { api.select(projectKey(pid)); api.draw(); return; }
    api.openAt(pid, view);
  }

  // ---- menus ----
  async function setFlags(id, flags) {
    try { await api.core().d.setFlags(id, flags); } catch (err) { api.status(String(err?.message || err)); return; }
    api.draw();
  }
  async function rename(id) {
    const p = rowOf(id); if (!p) return;
    const name = await askText('Rename project', { value: p.name, confirm: 'Rename' });
    if (!name?.trim() || name.trim() === p.name) return;
    try { await api.core().d.rename(id, name.trim()); api.core().forget?.(id); api.status(`Renamed ${name.trim()}`); } catch (err) { api.status(String(err?.message || err)); }
    api.core().load().catch(() => {}); api.draw();
  }
  async function remove(id) {
    const p = rowOf(id); if (!p) return;
    if (!await confirmAsk(`Remove ${p.name} from the list?`, { detail: 'Its folder and files stay where they are.', confirm: 'Remove', danger: true })) return;
    try { await api.core().d.removeFromList(id); } catch (err) { api.status(String(err?.message || err)); return; }
    if (state.selected === id) { state.selected = ''; api.ctx()?.showDetails?.(); }
    api.status(`${p.name} removed from the list`); api.draw();
  }
  async function deleteStored(id) {
    const p = rowOf(id); if (!p) return;
    if (!await confirmAsk(`Delete ${p.name} from app storage?`, { detail: 'A backup is saved first.', confirm: 'Delete', danger: true })) return;
    try { await api.core().d.deleteStored(id); } catch (err) { api.status(String(err?.message || err)); return; }
    if (state.selected === id) state.selected = '';
    api.status(`${p.name} deleted; its backup was kept`); api.draw();
  }
  async function duplicate(id) {
    const p = rowOf(id); if (!p) return;
    try { await api.core().d.duplicate(id, `${p.name} copy`); api.status(`Made ${p.name} copy`); } catch (err) { api.status(String(err?.message || err)); }
    api.core().load().catch(() => {}); api.draw();
  }
  async function backup(id, button) {
    if (button) button.disabled = true;
    api.status('Backing up…');
    try { api.status(await api.core().d.backup(id)); } catch (err) { api.status(`Not backed up: ${err.message}`); }
    if (button) button.disabled = false;
  }
  function menuItems(id, button) {
    const p = rowOf(id), e = entryOf(id), d = api.core().d; if (!p || !e) return [];
    const isOpen = p.current;
    return [
      { label: 'Open', icon: 'open', run: () => api.openProject(id) },
      { label: 'Tasks', icon: 'tasks', run: () => { api.select(projectKey(id)); api.draw(); } },
      '-',
      { label: p.pinned ? 'Unpin' : 'Pin', icon: 'pin', run: () => setFlags(id, { pinned: !p.pinned }) },
      { label: 'Status', icon: 'layers', submenu: STATUS_WORDS.map(([k, l]) => ({ label: l, checked: (p.status || 'active') === k, checkType: 'radio', run: () => setFlags(id, { status: k }) })) },
      { label: 'Rename…', icon: 'note', disabled: !d.rename || (e.kind === 'handle' && !isOpen), ...(e.kind === 'handle' && !isOpen ? { meta: 'Open it to rename' } : {}), run: () => rename(id) },
      { label: 'Duplicate', icon: 'duplicate', disabled: !(e.kind === 'app' || e.kind === 'local') || !d.duplicate, ...(e.kind === 'path' || e.kind === 'handle' ? { meta: 'Copy the folder in the Finder' } : {}), run: () => duplicate(id) },
      ...(e.kind === 'path' && d.reveal && d.canReveal?.() ? [{ label: 'Show in Finder', icon: 'folder', run: () => d.reveal(e).catch(err => api.status(String(err?.message || err))) }] : []),
      { label: 'Back up…', icon: 'backup', disabled: !d.backup || (e.kind === 'handle' && !isOpen), run: () => backup(id, button) },
      '-',
      { label: 'Remove from list', icon: 'close', danger: true, run: () => remove(id) },
      ...(e.kind === 'app' && d.deleteStored ? [{ label: 'Delete from app storage…', icon: 'trash', danger: true, disabled: isOpen, ...(isOpen ? { meta: 'Close it first' } : {}), run: () => deleteStored(id) }] : []),
    ];
  }
  const projectMenu = (button, id) => showMenu(button, menuItems(id, button), { align: 'end', minWidth: 200 });
  function showPicker(button, e) {
    const items = SHOW.map(([k, l]) => ({ label: l, checked: state.show === k, checkType: 'radio', run: () => {
      state.show = k;
      const v = host()?.querySelector('#hub-show .ui-picker-value'); if (v) v.textContent = SHOW_LABEL[k];
      host()?.querySelector('#hub-show')?.setAttribute('aria-label', `Show: ${SHOW_LABEL[k]}`);
      drawBody();
    } }));
    if (e?.isTrusted) showMenu(button, items, { minWidth: 160 }); else showMenu(host().querySelector('#hub-head'), items, { align: 'end', minWidth: 160, matchWidth: false });
  }

  // ---- wiring ----
  function wire() {
    const h = host(); if (!h) return;
    const q = h.querySelector('#hub-q');
    if (q) q.oninput = () => { state.text = q.value; drawBody(); };
    const pick = h.querySelector('#hub-show'); if (pick) pick.onclick = e => showPicker(pick, e);
    wireBody(); roving();
  }
  // an idea becomes a project through the new-project dialog with its title filled in; it is marked started only once a project was made
  async function startIdea(id) {
    const idea = loadIdeas().find(x => x.id === id); if (!idea) return;
    try { await api.core().d.newProject?.({ name: idea.title, onCreate: () => saveIdeas(markStarted(loadIdeas(), id, Date.now())) }); }
    catch (err) { api.status(String(err?.message || err)); return; }
    drawBody();
  }
  function wireBody() {
    const box = host()?.querySelector('#hub-portfolio'); if (!box) return;
    const idea = box.querySelector('#hub-idea-text');
    if (idea) idea.onkeydown = e => { if (e.key !== 'Enter' || !idea.value.trim()) return; e.preventDefault(); saveIdeas(addIdea(loadIdeas(), idea.value, { at: Date.now() })); drawBody(); host()?.querySelector('#hub-idea-text')?.focus(); };
    box.onclick = e => {
      const all = e.target.closest('[data-hub-all]'); if (all) { state.expanded.add(all.dataset.hubAll); drawBody(); host()?.querySelector(`#${CSS.escape(all.dataset.hubAll)} [data-db-project]`)?.focus({ preventScroll: true }); return; }
      if (e.target.closest('#hub-clear')) { state.text = ''; const q = host()?.querySelector('#hub-q'); if (q) q.value = ''; drawBody(); q?.focus(); return; }
      const more = e.target.closest('[data-proj-more]'); if (more) { projectMenu(more, more.dataset.projMore); return; }
      const start = e.target.closest('[data-idea-start]'); if (start) { startIdea(start.dataset.ideaStart); return; }
      const im = e.target.closest('[data-idea-more]'); if (im) { showMenu(im, [{ label: 'Remove idea', danger: true, run: () => { saveIdeas(removeIdea(loadIdeas(), im.dataset.ideaMore)); drawBody(); } }]); return; }
      const open = e.target.closest('[id^="hub-open-"]'); if (open) { api.openProject(open.closest('[data-hub-project-row]').dataset.hubProjectRow); return; }
      const dated = e.target.closest('[data-db-project]'); if (dated) { openDated(dated); return; }
      const row = e.target.closest('[data-hub-project-row]'); if (row) selectProject(row.dataset.hubProjectRow);
    };
    // a name is clipped with an ellipsis, not scrolled: a press or a focus that scrolls its clipped box sideways (measured: 18px, the pin out of sight) is put back
    if (!box.hasAttribute('data-hub-wired')) {
      box.setAttribute('data-hub-wired', '');
      box.addEventListener('scroll', e => { if (e.target instanceof Element && e.target.matches('[data-hub-open]') && e.target.scrollLeft) e.target.scrollLeft = 0; }, true);
    }
    box.ondblclick = e => { const row = e.target.closest('[data-hub-project-row]'); if (row && !e.target.closest('[data-proj-more], [id^="hub-open-"]')) api.openProject(row.dataset.hubProjectRow); };
    box.onfocusin = e => { const el = e.target.closest?.('[data-hub-project-row], [data-db-project], [data-hub-more]'); if (el) { stopKey = keyOf(el); if (el.dataset.hubProjectRow) state.focus = el.dataset.hubProjectRow; roving(); } };
  }

  // ---- the inspector ----
  function inspect(ctx) {
    const p = state.selected && rowOf(state.selected); if (!p) return [];
    const e = entryOf(p.id) || {}, d = api.core().d, sum = p.summary, today = api.today();
    const props = [['Type', p.type || '—'], ['Location', d.locationOf?.(e) || ''], ['Opened', p.current ? 'Open now' : p.openedAt ? ago(p.openedAt) : ''], ['Saved', sum?.savedAt ? ago(sum.savedAt) : ''],
      ['Records', sum ? num(sum.records) : ''], ...(sum?.datasets ? [['Datasets', num(sum.datasets)]] : []), ['Status', Object.fromEntries(STATUS_WORDS)[p.status] || 'Active'],
      ...(p.current ? (d.openHealth?.() || []) : []), ...(p.stale && p.at ? [['Summary', `As of ${ago(p.at)}`]] : [])].filter(([, v]) => v !== '');
    const project = `<div class="hub-insp" data-insp-project="${esc(p.id)}"><dl class="props">${props.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${inspectorActions({ id: 'hub-insp-acts', label: 'Project actions', start: [{ id: 'hub-insp-remove', label: 'Remove from list', role: 'destructive' }], actions: [{ id: 'hub-insp-open', label: 'Open', icon: 'open', role: 'primary' }] })}</div>`;
    const stages = sum?.stages || [];
    const progress = stages.length ? uiList({ id: 'hub-insp-progress', label: 'Progress', cls: 'ov-table', cols: ['track', 'count', 'of'], text: 'short', grow: 1, rows: stages.map(st => {
      const share = st.of ? Math.min(1, (st.n || 0) / st.of) : st.state === 'done' ? 1 : 0, cur = st.key === sum.current;
      return uiRow({ cls: `ov-stage${cur ? ' current' : ''}`, attrs: { 'data-hub-stage': st.key, 'aria-current': cur ? 'step' : false },
        main: { html: `<button type="button" class="ov-go" aria-label="${esc(`${st.name}: ${st.n ?? ''}${st.of ? ` of ${st.of}` : ''}`)}"><span class="ov-go-name">${esc(st.name)}</span></button>` },
        cells: [{ col: 'track', kind: 'visual', html: `<span class="ov-track">${st.of || st.state === 'done' ? `<span class="ov-meter" aria-hidden="true"><i data-share="${share.toFixed(3)}"></i></span>` : '<span class="ov-meter" data-none aria-hidden="true"></span>'}</span>` },
          { col: 'count', kind: 'visual', html: st.n != null ? `<span class="ov-n">${esc(num(st.n))}</span>` : '' },
          { col: 'of', kind: 'visual', html: st.of ? `<span class="ov-of"><span>of</span> <span class="ov-den">${esc(num(st.of))}</span></span>` : st.unit ? `<span class="ov-of"><span>${esc(st.unit)}</span></span>` : '' }],
        end: uiRowEnd({ reserve: true }) });
    }) }) : '<p class="meta" data-hub-no-progress>Open the project to see its progress</p>';
    const read = api.core().view().get(p.id), tasks = read && !read.error ? read.tasks.filter(t => !t.done) : [];
    const shownTasks = [...tasks.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due)), ...tasks.filter(t => !t.due)].slice(0, 5);
    const taskHtml = `${shownTasks.length ? uiList({ id: 'hub-insp-tasks', label: 'Tasks', cols: [], attrs: { 'data-tk-list': true },
      rows: shownTasks.map(t => hubRow({ task: t, pid: p.id, pname: p.name, current: p.current, writable: p.current }, { today })) }) : `<p class="meta">${read ? 'No open tasks' : 'Reading…'}</p>`}
      ${inspectorActions({ id: 'hub-insp-tasks-acts', label: 'Task actions', actions: [{ id: 'hub-insp-all-tasks', label: 'All tasks', role: 'quiet' }] })}`;
    const sub = p.submission;
    const subHtml = sub ? `<dl class="props">${[['Journal', sub.journal], ['Status', STATUS_LABELS?.[sub.status] || sub.status],
      ['Since', sub.since ? `${day(sub.since)} · ${daysSince(sub.since, today)} d` : ''], ['Due', sub.due ? day(sub.due) : ''], ['DOI', sub.doi]].filter(([, v]) => v)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Due' && sub.due < today ? ' class="tk-late"' : ''}>${esc(v)}</dd>`).join('')}</dl>
      ${inspectorActions({ id: 'hub-insp-sub-acts', label: 'Submission actions', actions: [{ id: 'hub-insp-sub', label: 'Open submission', role: 'quiet' }] })}` : '';
    const recent = sum?.recent?.length ? uiList({ id: 'hub-insp-recent', label: 'Recent', cols: ['when'], rows: sum.recent.map(r => uiRow({ cls: 'ov-event', attrs: { 'data-hub-recent': r.view || 'overview' },
      main: { html: `<button type="button" class="ov-go" title="${esc(r.text)}"><span class="ov-go-name">${esc(r.text)}</span></button>` }, cells: [{ col: 'when', kind: 'text', ch: 12, html: esc(ago(r.at)) }] })) }) : '';
    const wire = fn => el => fn(el);
    return [
      { title: 'Project', html: project, wire: wire(el => {
        el.querySelector('#hub-insp-open')?.addEventListener('click', () => api.openProject(p.id));
        el.querySelector('#hub-insp-remove')?.addEventListener('click', () => remove(p.id));
      }) },
      { title: 'Progress', html: progress, wire: wire(el => {
        el.querySelectorAll('[data-share]').forEach(i => i.style.setProperty('--share', i.dataset.share));
        el.querySelectorAll('[data-hub-stage]').forEach(r => { r.onclick = () => api.openAt(p.id, r.dataset.hubStage); });
      }) },
      { title: `Tasks · ${plural(tasks.length, 'open', 'open')}`, html: taskHtml, wire: wire(el => {
        el.querySelector('#hub-insp-all-tasks')?.addEventListener('click', () => { api.select(projectKey(p.id)); api.draw(); });
        el.querySelectorAll('[data-hub-row] [data-open]').forEach(b => { b.onclick = () => api.openProject(p.id, b.closest('[data-hub-row]').dataset.hubRow); });
        el.querySelectorAll('[data-hub-row] [data-more]').forEach(b => { b.hidden = true; });
        el.querySelectorAll('input[data-done]').forEach(box => { box.onchange = () => { if (p.current) api.setDone(box.dataset.done, box.checked); }; });
      }) },
      ...(sub ? [{ title: 'Submission', html: subHtml, wire: wire(el => { el.querySelector('#hub-insp-sub')?.addEventListener('click', () => api.openAt(p.id, 'submissions')); }) }] : []),
      ...(recent ? [{ title: 'Recent', html: recent, wire: wire(el => { el.querySelectorAll('[data-hub-recent]').forEach(r => { r.onclick = () => api.openAt(p.id, r.dataset.hubRecent); }); }) }] : []),
    ];
  }

  return { parts, wire, drawBody, onKey, inspect, reset: () => { state.selected = ''; state.text = ''; state.expanded.clear(); } };
}
