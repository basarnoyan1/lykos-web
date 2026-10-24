// The start screen, shown in place of the workspace when no project is open —
// a first launch, or after closing or removing the open project. In the
// desktop app it is a compact welcome window (src-tauri/src/window_mode.rs):
// the mark, version and two actions on the left, the recent projects on the
// right, paged, no window buttons, and a close button that quits. Any empty
// part of it drags the window. In a browser the same panel is the whole
// page, as a web app opens. A folder dragged anywhere onto the window opens it where the
// browser can hand one over. New project is the one creation dialog of the app (name and where to keep
// it, views/../lib/new-project.mjs); the project opens on its Overview, where setup asks for the research
// type and the publication. Every way out opens a project, which reloads.
import * as projects from '../lib/projects.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiSettingsRow } from '../lib/ui-actions.mjs';
import { ago } from '../lib/dates.mjs';
import { canOpenFolders, folderAtPath } from '../lib/fsys.mjs';
import { inDesktop, allowFoldersNative } from '../lib/native.mjs';
import { windowMode, syncChrome } from '../lib/app-menu.mjs';
// Settings, Upcoming, Import project and Back up load when they are asked for: on a first visit they were 85 of the start screen's
// module requests, fetched after the page's own and before it could draw (measured on the hosted build, 2026-10-19).
let settingsView = null, flow = null;
const loadFlow = () => import('./dashboard-flow.mjs').then(m => (flow = m));

// The app's mark (src-tauri/icons/icon.svg, the sidebar's .mark): one stroke of an L.
const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 24C14 18 23 7 19 4C15 1 11 10 12 17C13 23 8 29 5 26C2 22 14 22 20 25C24 27 27 24 28 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const nameOf = p => p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project');
// Where a project is, shortly: the folder it sits in, or App storage.
const whereOf = p => p.kind === 'path' ? (p.path.replace(/\/+$/, '').split('/').slice(-2, -1)[0] || p.path) : p.kind === 'handle' ? 'Folder' : 'App storage';
// A dropped folder arrives as a handle only in browsers that give one (Chromium).
const dropsFolders = () => typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype;

// Recent projects per page: as many as the welcome window's list holds.
const PAGE = 5;
let version = '';
// the desktop app's version, or the site's from its app-info.json, with the build's commit (lib/about.mjs)
import('../lib/about.mjs').then(async m => { version = m.versionLabel(await m.appIdentity()); document.querySelector('.start-version')?.replaceChildren(version ? `Version ${version}` : ''); }).catch(() => {});

/**
 * Draws the start screen over the whole window. `close` closes the welcome
 * window (the shell quits). Never resolves: every way out reloads the page.
 */
export function show({ close: closeWindow = null } = {}) {
  const root = document.createElement('div');
  root.className = 'start';
  root.setAttribute('role', 'main');
  document.body.append(root);
  document.title = 'Lykos';
  // in a browser, a folder of projects or an export dropped on the page is imported (lib/drop-import.mjs)
  if (!inDesktop()) import('../lib/drop-import.mjs').then(m => m.dropImport(root, msg => { state.openError = msg; if (state.mode === 'home') draw(); }));
  const state = {
    mode: 'home', openError: '', collectionStatus: '', settingsAt: '', page: 0, sel: null, filter: '',
    pane: 'recent', upcoming: null, upPage: 0,   // the right side: recent projects, or what is due across them
  };
  const closable = inDesktop() && closeWindow;
  const draw = () => {
    root.classList.toggle('start-welcome', state.mode === 'home' && inDesktop());   // the compact welcome window is the desktop's; a browser page scrolls
    root.innerHTML = state.mode === 'settings' ? appSettings()
      : `${home(state, closable)}<div class="start-dropping" hidden>Open as project</div>`;
    wire();
    if (state.mode === 'settings') mountSettings();
    syncChrome();
  };
  // Settings with no project open: the same Settings view the workspace
  // shows (views/settings.mjs), limited to what belongs to this Mac rather
  // than to a project: appearance, your name and initials, model providers
  // and keys, the PubMed contact and key, linked folders, the R engine and the
  // project list, with where new projects go and what this build is.
  const APP_SECTIONS = new Set(['appearance', 'you', 'drive', 'model', 'sources', 'folders', 'engine', 'projects']);
  const settingsCtx = { rerender: () => mountSettings(), refreshCounts: () => {} };
  const mountSettings = () => {
    const host = root.querySelector('#start-settings-host'); if (!host) return;
    if (!settingsView) { import('./settings.mjs').then(m => { settingsView = m; mountSettings(); }); return; }
    if (state.settingsAt) { settingsView.openSection(state.settingsAt); state.settingsAt = ''; }
    if (!APP_SECTIONS.has(settingsView.navigationState().section)) settingsView.openSection('appearance');
    settingsView.render(host, settingsCtx, { appOnly: true });
    host.querySelectorAll('.setl-item[data-sec], .setl-body > section[data-sec]').forEach(n => { if (!APP_SECTIONS.has(n.dataset.sec)) n.remove(); });
    host.querySelectorAll('#set-section option').forEach(o => { if (!APP_SECTIONS.has(o.value)) o.remove(); });
    host.querySelectorAll('#set-section optgroup').forEach(g => { if (!g.children.length) g.remove(); });
    host.querySelectorAll('.setl-group').forEach(g => { const next = g.nextElementSibling; if (!next || !next.matches('.setl-item')) g.remove(); });
    host.querySelector('.setl-search')?.remove();
    const projectsSec = host.querySelector('.setl-body > section[data-sec="projects"]');
    projectsSec?.insertAdjacentHTML('beforeend', uiSettingsRow({ id: 'start-default-row', label: 'New projects', description: projects.lastParent() || 'No folder chosen', descId: 'start-default-where', line: true, attrs: { 'data-find': 'new projects location' },
      controls: { id: 'start-default-bar', label: 'New projects', actions: [{ id: 'start-default-change', label: 'Change' }] } }));
    host.querySelector('#start-default-change')?.addEventListener('click', async () => {
      try { const chosen = await projects.chooseFolder(); if (chosen?.path) { projects.rememberParent(chosen.path); } } catch {}
      const d = host.querySelector('#start-default-where'); if (d) { d.textContent = projects.lastParent() || 'No folder chosen'; d.title = d.textContent; }
    });
    // About: what this build is, as its own category beside the others.
    const last = [...host.querySelectorAll('.setl-item[data-sec]')].pop();
    last?.insertAdjacentHTML('afterend', `<button class="setl-item" data-sec="about">${icon('book', { size: 16 })}<span>About</span></button>`);
    host.querySelector('.setl-body')?.insertAdjacentHTML('beforeend', `<section data-sec="about" aria-labelledby="settings-about" hidden><h2 id="settings-about">About</h2>${uiSettingsRow({ id: 'start-about-row', label: 'Lykos', description: version ? `Version ${version}` : 'Version not reported in a browser', readout: true, attrs: { 'data-find': 'about version' } })}</section>`);
    host.querySelectorAll('.setl-item[data-sec]').forEach(b => b.addEventListener('click', e => {
      if (b.dataset.sec !== 'about') return;
      e.stopImmediatePropagation();
      host.querySelectorAll('.setl-item[data-sec]').forEach(x => { const on = x === b; x.classList.toggle('on', on); if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
      host.querySelectorAll('.setl-body > section[data-sec]').forEach(sec => { sec.hidden = sec.dataset.sec !== 'about'; });
    }));
  };
  // Settings has the project's room; leaving it returns to the welcome window.
  const setMode = mode => { state.mode = mode; windowMode(mode === 'home' ? 'welcome' : 'normal'); draw(); };
  const openProject = id => projects.open(id).catch(err => { state.openError = err.message; draw(); });
  const recent = () => projects.switchList();
  const select = (id, focus = true) => {
    const list = recent(), at = list.findIndex(p => p.id === id);
    if (at < 0) return;
    state.sel = id;
    const page = Math.floor(at / PAGE);
    if (page !== state.page) { state.page = page; draw(); }
    root.querySelectorAll('.start-row').forEach(r => {
      const on = r.dataset.id === id;
      if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
      r.tabIndex = on ? 0 : -1;
      if (on && focus) r.focus({ preventScroll: true });
    });
  };

  const wire = () => {
    root.querySelector('#start-close')?.addEventListener('click', () => closeWindow());
    root.querySelector('#start-settings')?.addEventListener('click', () => setMode('settings'));
    root.querySelector('#start-settings-back')?.addEventListener('click', () => setMode('home'));
    // The one creation flow: name and location in a dialog, then the project opens on its setup (the dialog reports a failure itself).
    root.querySelectorAll('#start-new, #start-new-empty').forEach(b => b.addEventListener('click', () => { projects.newProject().catch(err => { state.openError = err.message; draw(); }); }));
    root.querySelectorAll('#start-open-folder, #start-open-folder-empty').forEach(b => b.addEventListener('click', async () => {
      state.openError = '';
      try { await projects.openFolder(); } catch (err) { state.openError = err.message; draw(); }
    }));
    root.querySelector('#start-add-projects')?.addEventListener('click', async () => {
      state.openError = ''; state.collectionStatus = '';
      try {
        const report = await projects.addProjectCollection(null, { chooser: async (found, folder) => (await import('./folder-import-dialog.mjs')).chooseProjects(found, folder, { title: 'Add projects', confirm: 'Add' }) });
        state.collectionStatus = projects.collectionMessage(report);
        state.pane = 'recent'; state.page = 0;
      } catch (err) { state.openError = err.message; }
      draw();
    });
    // A list, as in the Finder: a click selects, a double-click or Enter opens.
    root.querySelectorAll('.start-row').forEach(r => {
      r.onclick = e => { if (!e.target.closest('[data-more]')) select(r.dataset.id); };
      r.ondblclick = e => { if (!e.target.closest('[data-more]')) openProject(r.dataset.id); };
      r.onkeydown = e => {
        if (e.target !== r) return;
        const list = recent(), at = list.findIndex(p => p.id === r.dataset.id);
        if (e.key === 'Enter') { e.preventDefault(); openProject(r.dataset.id); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (next) select(next.id);
        }
      };
    });
    root.querySelector('#start-filter')?.addEventListener('input', e => { state.filter = e.target.value; state.page = 0; const at = e.target.selectionStart; draw(); const f = root.querySelector('#start-filter'); f?.focus(); f?.setSelectionRange(at, at); });
    root.querySelector('#start-prev')?.addEventListener('click', () => { if (state.pane === 'upcoming') state.upPage--; else state.page--; draw(); });
    root.querySelector('#start-next')?.addEventListener('click', () => { if (state.pane === 'upcoming') state.upPage++; else state.page++; draw(); });
    root.querySelectorAll('[data-start-pane]').forEach(b => b.onclick = () => {
      state.pane = b.dataset.startPane; state.openError = '';
      if (state.pane === 'upcoming' && !state.upcoming) Promise.all([import('../lib/dashboard.mjs'), loadFlow()]).then(([d]) => d.projectSummaries()).then(list => { state.upcoming = flow.upcoming(list, Infinity); if (state.mode === 'home') draw(); }).catch(err => { state.openError = err.message; draw(); });
      draw();
    });
    root.querySelectorAll('[data-db-project]').forEach(b => {
      b.onclick = () => openProject(b.dataset.dbProject);
      b.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); openProject(b.dataset.dbProject); } };
    });
    root.querySelectorAll('#start-restore, #start-restore-empty').forEach(b => b.addEventListener('click', () => loadFlow().then(f => f.importProjectFlow(msg => { state.openError = msg; if (state.mode === 'home') draw(); }))));
    // a folder shared in Google Drive (lib/drive-open.mjs): the link, a Google sign-in, then the project
    root.querySelectorAll('#start-drive, #start-drive-empty').forEach(b => b.addEventListener('click', () => import('../lib/drive-open.mjs').then(m => m.openFromDrive())
      .catch(err => { if (err.name === 'NoClientId') { state.settingsAt = 'drive'; setMode('settings'); } else if (err.name !== 'AbortError') { state.openError = err.message; draw(); } })));
    // a way in is pressed anywhere on its row, its chevron included
    root.querySelectorAll('[data-way]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('button')) root.querySelector(`#${r.dataset.way}`)?.click(); }));
    root.querySelectorAll('[data-more]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const p = projects.switchList().find(x => x.id === b.dataset.more); if (!p) return;
      showMenu(b, [
        p.kind === 'path' && inDesktop() && { label: 'Show in Finder', icon: 'folder', run: async () => {
          try { await allowFoldersNative([p.path]).catch(() => {}); await folderAtPath(p.path).reveal(''); } catch (err) { state.openError = err.message; draw(); }
        } },
        p.kind !== 'handle' && { label: 'Back up project…', icon: 'download', run: async () => {
          state.openError = 'Backing up…'; draw();
          try { const b = await import('../lib/project-backup.mjs'); state.openError = b.backupReport(await b.backupListedProject(p.id)); } catch (err) { state.openError = `Not backed up: ${err.message}`; }
          draw();
        } },
        { label: 'Remove from list', icon: 'close', run: async () => { try { await projects.removeFromList(p.id); } catch (err) { state.openError = err.message; } draw(); } },
      ].filter(Boolean), { align: 'end', minWidth: 180 });
    });
  };

  // A folder dragged anywhere onto the window: a full-window mark while it is over, then open.
  if (dropsFolders()) {
    let depth = 0;
    const mark = on => { const m = root.querySelector('.start-dropping'); if (m) m.hidden = !on; };
    const files = e => [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file');
    root.addEventListener('dragenter', e => { if (!files(e)) return; e.preventDefault(); depth++; mark(true); });
    root.addEventListener('dragover', e => { if (files(e)) e.preventDefault(); });
    root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) mark(false); });
    root.addEventListener('drop', async e => {
      e.preventDefault(); depth = 0; mark(false);
      const item = [...(e.dataTransfer?.items || [])].find(i => i.kind === 'file');
      const handle = await item?.getAsFileSystemHandle?.().catch(() => null);
      if (!handle || handle.kind !== 'directory') { state.openError = 'Drop a folder to open it as a project'; draw(); return; }
      try {
        if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
        await projects.openHandle(handle);
      } catch (err) { state.openError = err.message; draw(); }
    });
  }
  // Escape leaves Settings, and closes the welcome window (as ⌘W does), unless
  // a menu or dialog took it first.
  document.addEventListener('keydown', e => {
    // Arrows and Enter work before a row is focused: the first arrow takes the selected row, Enter opens it.
    if (state.mode === 'home' && state.pane === 'recent' && e.target === root && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const shown = root.querySelectorAll('.start-row'), at = [...shown].findIndex(r => r.getAttribute('aria-current') === 'true');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const r = shown[Math.max(0, at)]; if (r) select(r.dataset.id); return; }
      if (e.key === 'Enter' && at >= 0) { e.preventDefault(); openProject(shown[at].dataset.id); return; }
    }
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.menu, dialog[open], .dialog')) return;
    if (state.mode === 'settings') { if (!e.target.closest?.('input, textarea, select')) setMode('home'); return; }
    if (closable) { e.preventDefault(); closeWindow(); }
  });
  windowMode('welcome');
  draw();
  root.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
  return new Promise(() => {});
}

/** A pager as a strip: the page of the pages, then previous and next. */
const pagerBar = (page, pages) => uiBar({ kind: 'strip', label: 'Pages', id: 'start-pager', status: { id: 'start-page', text: `${page + 1} of ${pages}`, ch: 12 },
  actions: [{ id: 'start-prev', label: 'Previous page', icon: 'chevron-left', disabled: !page }, { id: 'start-next', label: 'Next page', icon: 'chevron-right', disabled: page >= pages - 1 }] });

// A browser with no projects yet lists its ways in, each with its own button (Vercel's first project): a project begins here, comes from an
// export, from a folder someone shared in Google Drive, or from a folder on this computer.
function waysIn() {
  const way = (id, title, detail) => uiRow({ attrs: { 'data-way': id }, main: { html: `<button type="button" class="tk-text start-row-name" id="${id}">${esc(title)}</button>`, detail: [esc(detail)] },
    cells: [{ col: 'go', kind: 'visual', html: icon('chevron-right', { size: 14 }) }] });
  return uiList({ id: 'start-ways', label: 'Ways to start', hook: 'start-list', cols: ['go'], rows: [
    way('start-new-empty', 'New project', 'A review, a study or a case report, kept in this browser'),
    way('start-restore-empty', 'Import a project', 'An export from Lykos on another computer'),
    way('start-drive-empty', 'Open a shared Drive folder', 'A project folder someone shared with you in Google Drive'),
    ...(canOpenFolders() ? [way('start-open-folder-empty', 'Open a folder', 'A project folder on this computer')] : [])] });
}
function home(state, closable) {
  const all = projects.switchList();
  // Many projects: a filter by name, type or place, above the pager.
  const q = state.filter.trim().toLowerCase();
  const list = q ? all.filter(p => [nameOf(p), p.type, whereOf(p)].join(' ').toLowerCase().includes(q)) : all;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const shown = list.slice(state.page * PAGE, (state.page + 1) * PAGE);
  const sel = shown.some(p => p.id === state.sel) ? state.sel : shown[0]?.id;
  const title = state.pane === 'upcoming' ? 'Due next' : inDesktop() ? 'Recent projects' : 'Projects';
  // A row is a project: its name and, beneath it, its type and place; when it was opened; its own More. A click selects, a double-click or Enter opens.
  const row = p => uiRow({ cls: 'start-row', attrs: { 'data-id': p.id, tabindex: p.id === sel ? 0 : -1, 'aria-current': p.id === sel ? 'true' : false },
    main: { html: `<span class="start-row-name">${esc(nameOf(p))}</span>`, detail: [p.type, whereOf(p)].filter(Boolean).map(esc) },
    cells: [{ col: 'when', kind: 'text', ch: 12, html: p.openedAt ? esc(ago(p.openedAt)) : '' }],   // never opened: no date (not 1 Jan 1970)
    end: uiRowEnd({ more: { label: `More for ${nameOf(p)}`, attrs: { 'data-more': p.id } } }) });
  const body = state.pane === 'upcoming' ? upcomingPane(state) : `${all.length > PAGE ? uiBar({ kind: 'tools', label: 'Filter projects', id: 'start-tools',
      filters: [{ type: 'search', id: 'start-filter', label: 'Filter projects', placeholder: 'Filter projects', value: state.filter }] }) : ''}
      <div class="start-body">${list.length ? uiList({ label: 'Recent projects', id: 'start-list', hook: 'start-list', cols: ['when'], rows: shown.map(row) })
        : q ? emptyState({ title: 'No projects match', size: 'inline' })
        : inDesktop() ? emptyState({ icon: 'folder', title: 'No projects yet', first: true, frame: false, actions: [{ id: 'start-new-empty', label: 'New project', icon: 'plus' }] })
        : waysIn()}</div>
      ${pages > 1 ? pagerBar(state.page, pages) : ''}`;
  const recentSection = `<section class="start-recent" aria-labelledby="start-recent-title">
      ${uiBar({ kind: 'head', label: title, id: 'start-recent-head', stack: false, switchAt: 'end', lead: { title, level: 'h2', id: 'start-recent-title' },
        // in a browser the projects' head is the page's: New project at its end (Copilot, Snowflake, Jasper), the other ways in in its More
        ...(inDesktop() ? {} : { actions: [{ id: 'start-settings', label: 'Settings', icon: 'settings', role: 'quiet' }, { id: 'start-new', label: 'New project', icon: 'plus', role: 'primary' }],
          overflow: [{ id: 'start-restore', label: 'Import project…' }, { id: 'start-drive', label: 'Open Drive folder…' },
            ...(canOpenFolders() ? [{ id: 'start-open-folder', label: 'Open folder…' }, { id: 'start-add-projects', label: 'Find projects…' }] : [])] }),
        ...(all.length ? { view: { id: 'start-pane', label: 'Show', attr: 'data-start-pane', kind: 'segmented', value: state.pane, items: [['recent', 'Projects'], ['upcoming', 'Upcoming']] } } : {}) })}
      ${state.openError ? `<p class="note start-error" role="alert">${esc(state.openError)}</p>` : ''}
      ${state.collectionStatus ? `<p class="note" role="status">${esc(state.collectionStatus)}</p>` : ''}
      ${body}
    </section>`;
  // A browser page is a web app's page, not the desktop's welcome window: one column at every width, the name, the ways in as one bar (it folds
  // into More where a phone cannot hold them), then the projects. Nothing here is a breakpoint: the column narrows and the bar fits itself.
  if (!inDesktop()) return `<div class="start-inner start-page">
    <h1 class="brand-wordmark" aria-label="Lykos">${MARK}<span aria-hidden="true">Lykos</span></h1>
    ${recentSection}
  </div>`;
  return `<div class="start-home" data-tauri-drag-region="deep">
    ${closable ? `<button type="button" class="icon start-close" id="start-close" aria-label="Close">${icon('close', { size: 14 })}</button>` : ''}
    <div class="start-side">
      <div class="start-brand">
        <h1 class="brand-wordmark" aria-label="Lykos">${MARK}<span aria-hidden="true">Lykos</span></h1>
        <p class="start-version">${version ? `Version ${esc(version)}` : ''}</p>
      </div>
      <div class="start-entry">
        ${uiBar({ kind: 'tools', label: 'New project', id: 'start-entry', equal: true, actions: [{ id: 'start-new', label: 'New project', icon: 'plus', role: 'primary' }] })}
        ${canOpenFolders() ? uiBar({ kind: 'tools', label: 'Open a project', id: 'start-entry-open', equal: true, actions: [{ id: 'start-open-folder', label: 'Open folder…', icon: 'folder' }] }) : ''}
        <div class="start-entry-more">${uiBar({ kind: 'tools', label: 'Other ways in', id: 'start-entry-more', equal: true, actions: [
          ...(canOpenFolders() ? [{ id: 'start-add-projects', label: 'Find projects…', icon: 'folder-plus', role: 'quiet', plain: true }] : []),
          { id: 'start-restore', label: 'Import project…', icon: 'import', role: 'quiet', plain: true },
          { id: 'start-settings', label: 'Settings', icon: 'settings', role: 'quiet', plain: true }] })}</div>
      </div>
    </div>
    ${recentSection}
  </div>`;
}

// Upcoming: what is due across every project, soonest first (views/dashboard.mjs), paged as the recent list is.
function upcomingPane(state) {
  if (!state.upcoming) return `<div class="start-body">${emptyState({ title: 'Reading projects', size: 'inline' })}</div>`;
  const rows = state.upcoming, pages = Math.max(1, Math.ceil(rows.length / PAGE));
  state.upPage = Math.max(0, Math.min(state.upPage, pages - 1));
  const shown = rows.slice(state.upPage * PAGE, (state.upPage + 1) * PAGE);
  return `<div class="start-body">${rows.length ? flow.upcomingList(shown, { id: 'start-upcoming', label: 'Due next' }) : emptyState({ title: 'Nothing due in any project', size: 'inline' })}</div>
    ${pages > 1 ? pagerBar(state.upPage, pages) : ''}`;
}

function appSettings() {
  return `<div class="start-chrome" data-tauri-drag-region></div>
  <div class="start-inner start-settings">
    ${uiBar({ kind: 'head', label: 'Settings', id: 'start-settings-head', lead: { back: { id: 'start-settings-back', label: 'Back' }, title: 'Settings', level: 'h1' } })}
    <div id="start-settings-host" class="start-settings-host"></div>
  </div>`;
}
