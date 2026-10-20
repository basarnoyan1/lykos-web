import { uiReviewList, uiStatusLine, uiBar, barEl, uiNotice, uiList, uiRow, uiRowEnd, uiComposer, uiGroup, watchWidth } from './lib/ui-actions.mjs';
import { cutRows, clippedBox, windowQuery } from './lib/bar-fit.mjs';
import { arrivalText } from './lib/arrive.mjs';
import { assistToolsSpec, assistSuggestions, assistModelNotice, fitWords, SESSION_CH, EXPANDED_SESSION_CH } from './lib/assist-tools.mjs';
import { researchRecords, conversationArtifacts } from './lib/research-ledger.mjs';
import { enhancePageUi, disclosure } from './lib/ui-components.mjs';
import { wireTooltips } from './lib/tooltips.mjs';
import { creationRequests } from './lib/ai-menu.mjs';
import { pageMenu, PROJECT_ASK, pageHelp } from './lib/assist-menu.mjs';
import { wireAsk, askFocused } from './lib/chat-attach-menu.mjs';   // "Ask about this": the list, its rows, the gestures and the builders load on the first one
import { createChatSpendReader } from './lib/status-cost.mjs';
import { findChatMessages, conversationMarkdown } from './lib/chat-conversation.mjs';
import { quickModelItems } from './lib/model-controls.mjs';
import { effortLabel } from './lib/model-effort.mjs';
import { createSidebarReveal } from './lib/sidebar-reveal.mjs';
import { teamMenu } from './lib/team-editor.mjs';
import { chatGptUsageState, recordedChatGptUsage } from './lib/chatgpt-usage.mjs';
// Shell: sidebar navigation, one view at a time, one state store.
import { applyAvailabilityAudit } from './lib/library-records.mjs';
import { subscribe, get, getVersion, load, notify, useBackend, saveError, saveState, backupState, onSaveState, credentialsError, onProjectReplaced, projects as projectIdentity, update as updateStore, persist } from './store.mjs';
import { restoreNavigation, rememberNavigation } from './lib/navigation.mjs';
import * as palette from './lib/palette.mjs';
import { createList } from './lib/listpane.mjs';
import * as aid from './lib/aid-core.mjs';   // lib/aid.mjs (the registry, the proposals and their drawing) loads with the first use: aid.aidNow() once aid.aidReady()
import { running as runningJobs, onProgress, reconcile as reconcileJobs, run as runJob, jobs as allJobs } from './lib/jobs.mjs';
import { funnel, unverified as unverifiedCount } from './lib/progress.mjs';
import * as projects from './lib/projects.mjs';
import { preference as themePreference, set as setTheme, THEMES } from './lib/theme.mjs';
import { showMenu, onMenuOpen, closeMenu } from './lib/menu.mjs';
import { createTopbar, pageOf } from './lib/topbar.mjs';
import { confirmAsk, ask, choiceAsk } from './lib/dialog.mjs';
import { showShellNotice, hideShellNotice, replacedNoticeText, saveFailedText } from './lib/shell-notice.mjs';
import { installErrorSurface } from './lib/error-surface.mjs';
import { onDownloadProgress } from './lib/download-progress.mjs';   // lib/paper-download.mjs loads with the first page or study that downloads
import { icon } from './lib/icons.mjs';
import { pending as pendingIdentification, onProgress as onIdentify } from './lib/identify-pending.mjs';   // lib/identify.mjs loads when a record needs identifying
import { canOpenFolders } from './lib/fsys.mjs';
import { inDesktop, installLinkRouting, takeInboxNative, libraryRecoveryNative, libraryAuditNative } from './lib/native.mjs';
import { decide as screenDecide } from './lib/screen.mjs';
import { setAnchoredValue } from './lib/fields.mjs';
import { familyName } from './lib/bib.mjs';
import { onStatus as onRegistryStatus, applyRates } from './lib/limiter.mjs';
import * as assistant from './lib/assistant.mjs';
import { elapsedLabel, visibleActivity } from './lib/assistant-status.mjs';
import { configured as modelConfigured, isJev, assertRoute, declare } from './lib/ai.mjs';
import { reconcileRunsIfAny } from './lib/agent-load.mjs';   // lib/agent.mjs loads when a table run was left running
import { esc, autoGrow, emptyState } from './lib/html.mjs';
import { addTodo } from './lib/actions.mjs';
import { ago as agoText } from './lib/dates.mjs';
import { blankBlock } from './lib/manuscript.mjs';
import { onMenu, reportMenu, quitReply, nativeContextMenu, windowMode, windowDocument, syncChrome, dockBadge, notifyDone } from './lib/app-menu.mjs';
// lib/project-memory.mjs (the palette's project search, 8 modules) loads with the first search
import { replyHtml } from './lib/chat-cites.mjs';
import { svgToPng as rasterPng } from './lib/figure-draw.mjs';
const svgToPng = svg => rasterPng(svg);   // as lib/project-folder.mjs offered it: no options
import { saveFile } from './lib/save.mjs';
import { addAnswerRecord } from './lib/chat-content.mjs';
import { libraryIndex } from './lib/search-library.mjs';
import './lib/select.mjs';   // every <select> opens the app's menu
import './lib/responsive-switches.mjs';
import { visibleViews, projectName, projectMode, researchType } from './lib/workflow.mjs';

/**
 * Records written by earlier builds: a label taken from the first token of the
 * author string ("Sang-Bong 2007"), and a registry match that named no author
 * (a dictionary entry). Labels are re-derived; the matches go back to the
 * identification queue. Nothing here touches a record a person edited.
 */
function repairRecords() {
  let n = 0;
  updateStore(s => {
    for (const p of s.papers || []) {
      const named = (p.authors || []).some(a => String(a || '').trim());
      if (!named && p.pdf && (p.doi || p.identified === 'registry' || /^Study \d{4}$/.test(p.label || ''))) {
        p.identified = null; p.unidentified = true; p.doi = ''; p.source = 'file'; p.journal = ''; p.year = '';
        const t = p.title && !/^(?:[\w.-]*\d[\w.-]*|[\w-]+(?:_[\w-]+)+|.*\.pdf)$/i.test(p.title) ? p.title : '';
        p.label = t ? t.split(/\s+/).slice(0, 3).join(' ') : (p.pdfName || p.label || '').replace(/\.pdf$/i, '').slice(0, 40); n++;
      }
      const first = (p.authors || []).find(a => String(a || '').trim());
      if (first && /^\S+ \d{4}$/.test(p.label || '')) {
        const want = `${familyName(first)} ${p.year}`.trim();
        if (want !== p.label) { p.label = want; n++; }
      }
    }
    return n ? s : null;
  });
}

// Tooltips are the app's (lib/tooltips.mjs): compact controls keep their names and shortcut help, fully labelled rows lose
// redundant ones, clipped text keeps its full wording, and the tooltip is placed beside its control, never over it or a neighbour.
wireTooltips({ clippedText: clippedBox });
// In the packaged app a web link cannot open inside the window: it goes to the Lykos browser (or, when the person chose that, the
// system browser) through openLink; a modifier-click goes to the system browser. In a browser tab links keep their default.
installLinkRouting();
import { REGISTRY } from './views/registry.mjs';   // the name, icon and badge of every page, so the rail draws before a page is loaded
import { batchPresent } from './lib/batch-present.mjs';   // views/batch-control.mjs and batch-proposals.mjs load when a batch has left something (batchOf)
import * as settings   from './lib/model-settings.mjs';   // the model profiles; the Settings page itself loads when opened (viewOf)
import { onExplorerLoaded } from './lib/explorer-mount.mjs';   // views/explorer.mjs (the file tree, a sidebar pane) loads with the Files tab, the palette's files, or the Files page

import { runDueFlowsIfAny, reconcileFlowRunsIfAny } from './lib/flow-load.mjs';   // lib/flow-runner.mjs loads when a run is open or a schedule is on
import { applyFigureResults, onFigureNeeds } from './lib/figure-watch.mjs';   // figure checks on the Overview (plan §4.15c)
import { lazyModule } from './lib/lazy.mjs';
import { checksNeeded, ensureChecks } from './lib/progress-gate.mjs';   // the manuscript findings and the reporting checklist load with a project that has them
import { notify as addNotice } from './lib/notifications.mjs';
import { openChatGptUsage } from './lib/chatgpt.mjs';
import { loadAppSettings, onAppSettings } from './lib/app-settings.mjs';
import { paletteHit } from './lib/palette-hits.mjs';
/** Panes the review matrix lists beside the views: a document opens beside whatever you are doing, so it is not navigated to (tools/ui-review-matrix.mjs). */
export const PANES = { reader: () => import('./views/reader.mjs') };
// The reader (PDF.js, regions, notes) loads when the first document opens, not with the shell. Until then it holds nothing to ask.
let readerMod = null, readerSeq = 0;
const reader = {
  mount: (el, c) => readerMod.mount(el, c),
  unmount: () => readerMod?.unmount?.(),
  reflow: () => readerMod?.reflow?.(),
  focus: () => readerMod?.focus?.() ?? null,
  context: () => readerMod?.context?.() ?? null,
  inspect: () => readerMod?.inspect?.() ?? [],
};
/** Every page, loaded on first use (plan: footprint Task 6). The keys keep the rail's order; `tools/ui-review-matrix.mjs` and `app/lint-src.mjs` read this declaration. */
const LOAD = {
  advancedAnalysis: () => import('./views/advanced-analysis.mjs'),
  trialOperations: () => import('./views/trial-operations.mjs'),
  imaging: () => import('./views/imaging.mjs'),
  workflows: () => import('./views/workflows.mjs'),
  tasks: () => import('./views/tasks.mjs'),
  dashboard: () => import('./views/dashboard.mjs'),
  notes: () => import('./views/notes.mjs'),
  changes: () => import('./views/changes.mjs'),
  notifications: () => import('./views/notifications.mjs'),
  overview: () => import('./views/overview.mjs'),
  case: () => import('./views/case.mjs'),
  protocol: () => import('./views/protocol.mjs'),
  search: () => import('./views/search.mjs'),
  library: () => import('./views/library.mjs'),
  screening: () => import('./views/screening.mjs'),
  extraction: () => import('./views/extraction.mjs'),
  patients: () => import('./views/patients.mjs'),
  datasets: () => import('./views/datasets.mjs'),
  coding: () => import('./views/coding.mjs'),
  appraisal: () => import('./views/appraisal.mjs'),
  analysis: () => import('./views/analysis.mjs'),
  dta: () => import('./views/dta.mjs'),
  umbrella: () => import('./views/umbrella.mjs'),
  synthesis: () => import('./views/synthesis.mjs'),
  nma: () => import('./views/nma.mjs'),
  certainty: () => import('./views/certainty.mjs'),
  confidence: () => import('./views/confidence.mjs'),
  manuscript: () => import('./views/manuscript.mjs'),
  outputs: () => import('./views/outputs.mjs'),
  reporting: () => import('./views/reporting.mjs'),
  submissions: () => import('./views/submissions.mjs'),
  settings: () => import('./views/settings.mjs'),
  files: () => import('./views/files.mjs'),
  folder: () => import('./views/folder.mjs'),
};
/** The pages whose module is here: Settings is part of the shell (the model and profile lookups), the rest, the Overview included, arrive through `viewOf`. A page being on screen is always in it. */
const decisionModel = lazyModule(() => import('./lib/jev.mjs'), 'the decision model');   // a protocol file re-derives verdicts or asks for a fresh pass
const projectBackup = lazyModule(() => import('./lib/project-backup.mjs'), 'the project backup');   // loads when a backup is asked for
const projectMemory = lazyModule(() => import('./lib/project-memory.mjs'), 'the project search');   // the palette's project search
const identifier = lazyModule(() => import('./lib/identify.mjs'), 'the paper identifier');   // runs when a record needs identifying
// Loaded on first use; a failed load is said where the action reports (footprint Task 6).
const handoffs = lazyModule(() => import('./lib/handoff-absorb.mjs'), 'the task hand-offs');   // tasks another project sent to this one's inbox
const referenceEditor = lazyModule(() => import('./lib/reference-editor.mjs'), 'the reference editor');
const screeningImport = lazyModule(() => import('./lib/screening-batch.mjs'), 'the screening import');
const taskSuggest = lazyModule(() => import('./lib/task-suggest.mjs'), 'the task suggestions');
const chatHistory = lazyModule(() => import('./lib/chat-history-panel.mjs'), 'the chat history');
const chatBudget = lazyModule(() => import('./lib/chat-budget.mjs'), 'the chat budget');
const runPreview = lazyModule(() => import('./lib/run-preview.mjs'), 'the run preview');
const scheduled = lazyModule(() => import('./lib/schedule.mjs'), 'the scheduled searches');
const searchRun = lazyModule(() => import('./lib/search-run.mjs'), 'the search runs');
const proposals = lazyModule(() => import('./lib/proposals.mjs'), 'the value proposals');
/** Closes the chat history if it was ever opened: until it loads there is nothing to close. */
const closeChatHistory = () => chatHistory.module()?.closeChatHistory();
const explorer = lazyModule(() => import('./views/explorer.mjs'), 'the file tree');   // mounted by the callback registered in wireProjects when it arrives (lib/explorer-mount.mjs)
const studyPanel = lazyModule(() => import('./lib/study.mjs'), 'the study panel');   // opens with the first study named in a table
/** Opens a study's record beside the page (lib/study.mjs loads with the first one); a failed load is said in the subtitle. */
const openStudy = (...args) => studyPanel.ensure().then(m => m.openStudy(...args), err => { subtitle.textContent = err.message; });
/** What a chat answer carries besides text (lib/chat-answers.mjs) loads with the first answer that holds blocks, or the first button that needs it. */
const chatAnswers = lazyModule(() => import('./lib/chat-answers.mjs'), 'the answer tables and downloads');
let answersWake = false;
function wakeAnswers() {
  if (answersWake || chatAnswers.ready()) return;
  answersWake = true;
  chatAnswers.ensure().then(() => { answersWake = false; if (assistOpen()) drawAssist(); }, err => { answersWake = false; subtitle.textContent = err.message; });
}
/** Resolves once the answers' code is here when these turns carry a deliverable (their text is read from it). */
const answersFor = turns => turns.some(t => (t.blocks || []).some(b => b.artifact)) ? chatAnswers.ensure() : null;
const VIEWS = {};
const pendingViews = new Map();
const viewOf = k => VIEWS[k] ? Promise.resolve(VIEWS[k]) : (pendingViews.get(k) || pendingViews.set(k, LOAD[k]().then(async m => { await m.prepare?.(get()); pendingViews.delete(k); return (VIEWS[k] = m); }, err => { pendingViews.delete(k); throw err; })).get(k));
// The rail is the shape of a review: grouped by stage, in the order the work happens; a group never collapses.
const GROUPS = [
  { name: '',          keys: ['overview', 'case'] },   // a case report's one patient sits under Overview
  { name: 'Evidence',  keys: ['search', 'library', 'screening'] },
  { name: 'Data',      keys: ['extraction', 'patients', 'datasets', 'trialOperations', 'coding', 'appraisal'] },
  { name: 'Synthesis', keys: ['analysis', 'advancedAnalysis', 'dta', 'umbrella', 'synthesis', 'nma', 'certainty', 'confidence'] },
  { name: 'Report',    keys: ['manuscript', 'outputs', 'reporting', 'submissions'] },
  { name: 'Workspace', keys: ['tasks', 'notes', 'notifications', 'changes', 'imaging'] },
];
const FOOTER = ['dashboard', 'settings'];   // All projects sits beside Settings: the tasks of every project are one click away
const order = () => visibleViews(get());
// The views as the rail lists them, which is what ⌘1…⌘9 and the View menu count.
const railKeys = () => { const keys = order(); return GROUPS.flatMap(g => g.keys).filter(k => keys.includes(k)); };

const nav = document.getElementById('nav');
// Compact the page list before scrolling it. Assistant and Settings remain
// outside the scroll area, pinned to the bottom at every rail height.
// The list ends on a whole row, and rows snap to its top edge when scrolling.
const navCue = () => nav.classList.toggle('more-below', nav.scrollHeight - nav.scrollTop > nav.clientHeight + 2);
const sideEl = document.querySelector('body > aside');
// The Workspace/Files switch is pinned: a short window compacts the list and then scrolls it, and never folds the switch away.
// The engine's rows fit (bar-fit.mjs cutRows) cuts it at a whole row whenever the sidebar or the list changes size.
const cutNav = () => { cutRows(nav, 'button[data-k], .group'); navCue(); };
// (the sidebar's width also tells the window chrome where the sidebar ends: syncChrome)
watchWidth(sideEl, () => { cutNav(); syncChrome(); }, { rows: true, now: true });
nav.addEventListener('scroll', navCue, {passive:true});
watchWidth(nav, navCue, { rows: true, now: true });
document.getElementById('side-toggle').innerHTML = icon('navigation');
const view = document.getElementById('view');
// The title bar is one head bar the shell owns and the head of every page (lib/topbar.mjs): each view declares its page (title, status, view
// switch, Back, actions), the engine folds what does not fit into More, and the bar never adds a row. The title is always drawn (TOPBAR R2).
const topbar = createTopbar({
  slot: document.getElementById('topbar-slot'),
  onBack: () => backToList(), onInspector: () => toggleInspector(), onAid: anchor => aidMenu(anchor),
  onAidDown: () => { heldSelection = String(getSelection?.() || '').trim(); },
});
const subtitle = topbar.message;

// Restore the last valid page after its project has finished loading.
let currentKey = 'overview';
let navigationProject = null; // Keep pagehide bound to the project this page loaded.
let keyHandler = null;
// Set once the menu bar is wired (below); the sidebar and views call it as they change.
let menuSync = () => {};
let startOpen = false;   // the start screen stands in for the workspace

// The sidebar collapses to a rail on request, not only when the window is
// narrow. The choice is per machine, so it lives beside the theme.
// a tab's Back steps back in the app (lib/nav-history.mjs)
let navHistory = null, drawerShown = false; if (!inDesktop()) import('./lib/nav-history.mjs').then(m => { navHistory = m; });
const SIDE_KEY = 'lykos.side';
const toggleSide = () => document.getElementById('side-toggle').onclick();
const narrow = windowQuery('(max-width: 980px)');
const compactSide = windowQuery('(max-width: 600px), (max-height: 440px)');
let sideChoice = 'full';
try { sideChoice = localStorage.getItem(SIDE_KEY) || 'full'; } catch {}
// Narrow, there is no room for the full sidebar beside the work, so it opens
// as a drawer over it instead: the rail keeps its place (nothing beneath moves),
// the work is dimmed, and choosing a view, Escape or the dimmed work closes it.
let drawer = false, sidePeek = false;
const sidebar = document.querySelector('body > aside');
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const sidebarReveal=createSidebarReveal({
  eligible:()=>document.documentElement.dataset.side==='rail'&&!compactSide.matches&&!document.querySelector('.menu'),
  held:()=>sidebar.matches(':hover')||!!sidebar.querySelector(':focus-visible')||!!document.querySelector('.menu'),
  reducedMotion:()=>motionPreference.matches,
  onChange:phase=>{
    sidePeek=phase!=='closed';
    document.documentElement.toggleAttribute('data-side-peek',sidePeek);
    if(sidePeek)document.documentElement.dataset.sideReveal=phase;else delete document.documentElement.dataset.sideReveal;
    document.getElementById('side-toggle')?.setAttribute('aria-expanded',String(sidePeek||document.documentElement.dataset.side==='drawer'||!document.documentElement.dataset.side));
  }
});
const clearPeekTimers=()=>sidebarReveal.close();
sidebar.addEventListener('pointerenter',e=>sidebarReveal.enter(e.pointerType));
sidebar.addEventListener('pointerleave',()=>sidebarReveal.leave());
sidebar.addEventListener('focusin',e=>{if(e.target.matches(':focus-visible'))sidebarReveal.focus();});
sidebar.addEventListener('focusout',()=>sidebarReveal.leave());
addEventListener('blur',()=>sidebarReveal.close());
document.addEventListener('visibilitychange',()=>{if(document.hidden)sidebarReveal.close();});
const applySide = () => {
  if (!narrow.matches && !compactSide.matches) drawer = false;
  const mode = drawer ? 'drawer' : narrow.matches || compactSide.matches || sideChoice === 'rail' ? 'rail' : 'full';
  if ((mode === 'drawer') !== drawerShown) { drawerShown = !drawerShown; if (drawerShown) navHistory?.step('drawer', closeDrawer); else navHistory?.drop('drawer'); }
  if (mode === 'full') delete document.documentElement.dataset.side;
  else document.documentElement.dataset.side = mode;
  document.documentElement.toggleAttribute('data-side-peek', sidePeek && mode === 'rail');
  document.documentElement.toggleAttribute('data-side-compact', compactSide.matches);
  navTitles();
  const toggle = document.getElementById('side-toggle');
  const topbar = document.querySelector('main > .topbar');
  const brand = sidebar.querySelector('.brand');
  const menuOnly = compactSide.matches && !drawer;
  // The desktop rail's toggle sits beside the traffic lights, outside the
  // sidebar. Keep it outside the hover reveal's clipping and hit-test region.
  const detachedRail = document.documentElement.dataset.shell === 'desktop' && mode === 'rail' && !menuOnly;
  const toggleParent = menuOnly ? topbar : detachedRail ? document.body : brand;
  const keepFocus = document.activeElement === toggle || (menuOnly && sidebar.contains(document.activeElement));
  if (toggle.parentElement !== toggleParent) {
    if (menuOnly || detachedRail) toggleParent.prepend(toggle); else toggleParent.append(toggle);
  }
  if (keepFocus) toggle.focus({ preventScroll: true });
  sidebar.inert = menuOnly;
  if (menuOnly) sidebar.setAttribute('aria-hidden', 'true'); else sidebar.removeAttribute('aria-hidden');
  toggle?.setAttribute('aria-label', menuOnly ? 'Open navigation' : mode === 'full' || mode === 'drawer' ? 'Collapse sidebar' : 'Expand sidebar');
  toggle?.setAttribute('title', `${menuOnly ? 'Open navigation' : mode === 'full' || mode === 'drawer' ? 'Collapse sidebar' : 'Expand sidebar'} (⌘\\)`);
  toggle?.setAttribute('aria-expanded', String(mode !== 'rail'));
  menuSync();
};
narrow.addEventListener('change', () => { clearPeekTimers(); sidePeek = false; applySide(); });
compactSide.addEventListener('change', () => { clearPeekTimers(); sidePeek = false; drawer = false; applySide(); });
applySide();
const closeDrawer = () => { clearPeekTimers(); if (drawer || sidePeek) { drawer = false; sidePeek = false; applySide(); } };
onMenuOpen(at => { if (!(at instanceof Element) || !sidebar.contains(at)) closeDrawer(); });
document.getElementById('side-toggle').onclick = () => {
  clearPeekTimers(); sidePeek = false;
  if (narrow.matches || compactSide.matches) { drawer = !drawer; applySide(); return; }
  sideChoice = document.documentElement.dataset.side === 'rail' ? 'full' : 'rail';
  try { localStorage.setItem(SIDE_KEY, sideChoice); } catch {}
  applySide();
};
document.querySelector('main').addEventListener('pointerdown', e => {
  // Do not dismiss or reparent the control between its press and click.
  if (!e.target.closest('#side-toggle')) closeDrawer();
}, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && (drawer || sidePeek)) { e.stopPropagation(); closeDrawer(); } }, true);

const navTitle = k => k === 'overview' && !projectMode(get()) ? 'Setup' : REGISTRY[k].meta.title;
/** What the sidebar row of a page says, while that row is on screen: the title bar does not say it again. */
const navItem = k => `<button data-k="${k}" aria-label="${navTitle(k)}">
  ${icon(REGISTRY[k].meta.icon, { size: 16 })}
  <span>${navTitle(k)}</span><span class="count" data-c="${k}"></span></button>`;
let navShape = '';
// A nav row names itself on hover only when its label is hidden (the icon rail);
// beside a visible label the tooltip only repeats it and covers the next row.
function navTitles() {
  // Nav rows carry their name as text and aria-label; never as a hover overlay.
  document.querySelectorAll('body > aside [data-k][title]').forEach(b => b.removeAttribute('title'));
}
function drawNav() {
  // Before a project exists, only setup and Settings apply: the assistant,
  // inspector, file panel and workspace search have nothing to work on.
  document.documentElement.toggleAttribute('data-setup', !projectMode(get()));
  const keys = order();
  const shape = `${keys.join('|')}|${projectMode(get())}`;
  if (shape === navShape) return;
  navShape = shape;
  nav.innerHTML = GROUPS.map(g => {
    const shown = g.keys.filter(k => keys.includes(k));
    return shown.length ? `${g.name ? `<div class="group" aria-hidden="true">${g.name}</div>` : ''}${shown.map(navItem).join('')}` : '';
  }).join('');
  nav.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => go(b.dataset.k, { fromNavigation: true }));
  cutNav(); navTitles(); menuSync();
}
document.getElementById('foot').innerHTML = `<button id="assist-toggle" title="Assistant (⌘J)" aria-label="Assistant">
  ${icon('assistant', { size: 16 })}<span>Assistant</span></button>` + FOOTER.map(k => `<button data-k="${k}" aria-label="${REGISTRY[k].meta.title}">
  ${icon(REGISTRY[k].meta.icon, { size: 16 })}
  <span>${REGISTRY[k].meta.title}</span><span class="count" data-c="${k}"></span></button>`).join('');
// Scoped to the two navigation lists. Views use data-k for their own field
// names, and a bare [data-k] query would reach into view content and treat an
// input as a nav button.
const navButtons = () => [
  ...nav.querySelectorAll('button[data-k]'),
  ...document.getElementById('foot').querySelectorAll('button[data-k]'),
];
document.getElementById('foot').querySelectorAll('button[data-k]').forEach(b => b.onclick = () => go(b.dataset.k, { fromNavigation: true }));

// ---- document pane -------------------------------------------------------
const docpane = document.getElementById('docpane');
const divider = document.getElementById('divider');
const split = document.getElementById('split');
let openPaper = null;

// ---- right panes: how they open and close ---------------------------------
// The work changes width once, on the press, and the pane only slides and fades (transform and opacity): animating the width re-laid
// every view a dozen times. Closing, the pane leaves the flow at once ([data-leaving]); the top of the work stays in place.
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const PANE_IN = [{ transform: 'translateX(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
function slidePane(el, open, done = () => {}) {
  el.__motion?.cancel(); el.__motion = null; delete el.dataset.leaving;
  if (reducedMotion()) { done(); return; }
  if (open) { el.__motion = el.animate(PANE_IN, { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' }); return; }
  el.dataset.leaving = '';
  const m = el.__motion = el.animate([...PANE_IN].reverse(), { duration: 160, easing: 'ease-in' });
  m.onfinish = () => { if (el.__motion !== m) return; el.__motion = null; delete el.dataset.leaving; done(); };
  m.oncancel = () => { if (el.__motion !== m) return; el.__motion = null; delete el.dataset.leaving; };
}
/**
 * What the reader is looking at at the top of the work: the box under a point
 * just inside its top edge (a sticky header stays put by itself and is passed
 * over), with its offset from that edge.
 */
function noteAnchor(root = view) {
  if (root.scrollTop <= 0) return { root, atTop: true };
  const r = root.getBoundingClientRect();
  for (const fx of [0.3, 0.5, 0.15, 0.7]) {
    const el = document.elementFromPoint(r.left + r.width * fx, r.top + 24);
    if (!el || el === root || !root.contains(el)) continue;
    let pinned = false;
    for (let e = el; e && e !== root; e = e.parentElement) if (/sticky|fixed/.test(getComputedStyle(e).position)) { pinned = true; break; }
    if (!pinned) return { root, el, off: el.getBoundingClientRect().top - r.top };
  }
  return null;
}
function restoreAnchor(a) {
  if (!a) return;
  if (a.atTop) { a.root.scrollTop = 0; return; }
  if (!a.el.isConnected) return;
  const d = a.el.getBoundingClientRect().top - a.root.getBoundingClientRect().top - a.off;
  if (Math.abs(d) >= 1) a.root.scrollTop += d;
}
/**
 * Runs a change to the work's width with its reading place kept: at once, and
 * on each of the next frames while fitted toolbars, charts and container
 * queries settle, until the reader scrolls or presses something.
 */
// Opening and closing again, unscrolled between, returns to the same place:
// the place noted before the first change is kept for the second.
let placeHold = null, lastPlace = null;
function keepPlace(change) {
  placeHold?.stop();
  const again = lastPlace && lastPlace.a.root === view && view.scrollTop === lastPlace.top && (lastPlace.a.atTop || lastPlace.a.el?.isConnected);
  const a = again ? lastPlace.a : noteAnchor();
  change();
  restoreAnchor(a);
  lastPlace = a && { a, top: view.scrollTop };
  if (!a) return;
  let frames = 12, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); placeHold = null; ['wheel', 'pointerdown', 'keydown', 'touchstart'].forEach(t => removeEventListener(t, stop, true)); };
  ['wheel', 'pointerdown', 'keydown', 'touchstart'].forEach(t => addEventListener(t, stop, { capture: true, passive: true }));
  const step = () => { restoreAnchor(a); lastPlace = { a, top: view.scrollTop }; if (--frames > 0) raf = requestAnimationFrame(step); else stop(); };
  raf = requestAnimationFrame(step);
  placeHold = { stop };
}

// Test and audit hooks (dev server only): a request waits for the first view, then runs in order, so a restored page cannot replace it.
let openShell, held = new Promise(r => openShell = r);   // one request at a time, each after the last one's page is shown
const INDEX_W = 232;   // an index list's column (.plist[data-index], workspace.css): its longest part name and icon, no more
let arrival = null;   // the page a "Needs attention" row landed on and what it said there: { view, a, narrowed, fixed } (drawArrival)
const whenShellReady = run => held = held.then(run, run);
if (location.protocol === 'http:') window.__lykosPanes = {
  go: (key, opts) => whenShellReady(() => go(key, { link: false, ...opts })),   // as the sidebar's unless link: true
  openDocument: (id = get().papers?.find(p => p.pdf)?.id || get().papers?.[0]?.id) => whenShellReady(() => id && openDocument(id)),
  closeDocument: () => whenShellReady(() => closeDocument()),
  assist: open => whenShellReady(() => toggleAssist(open)),
  topbar,
  command: id => whenShellReady(() => menuCommand(id)),   // a menu item, as the native menu would send it (tests)
  quit: () => whenShellReady(() => quitApp()),
};

function openDocument(paperId, locator = null) {
  if (!readerMod) {   // nothing on screen changes until the reader is here: the pane then opens exactly as before
    const seq = ++readerSeq;
    PANES.reader().then(m => { readerMod = m; if (seq === readerSeq) openDocument(paperId, locator); },
      err => { console.warn('[reader]', err); subtitle.textContent = `Could not open the document: ${err.message}`; });
    return;
  }
  const was = openPaper;
  // Opening a document leaves expanded chat so the reader can take focus.
  if (assistExpanded) expandChat(false);
  openPaper = paperId;
  keepPlace(() => {
    docpane.hidden = false;
    if (!was) slidePane(docpane, true);
    divider.hidden = false;
    // Single-pane with a document open, the item shows beside it, not the list.
    if (!plist.hidden) pane = 'detail';
    arrange();
  });
  // An overlay inspector obscures and dims the PDF; dismiss it without
  // changing the user's preference for a docked inspector on wider layouts.
  if (assistOpen() && (split.classList.contains('insp-over') || split.classList.contains('insp-sheet'))) toggleAssist(false, null, true);
  reader.mount(docpane, { ...ctx, locator, paperId, head: true });
  if (assistOpen()) { followFocusScope(); drawAssist(); }
}
function closeDocument() {
  readerSeq++;   // a document still loading its reader is no longer wanted
  if (!openPaper && docpane.hidden) return;
  openPaper = null;
  reader.unmount?.();
  const empty = () => { if (!openPaper) { docpane.hidden = true; docpane.innerHTML = ''; } };
  keepPlace(() => {
    divider.hidden = true;
    slidePane(docpane, false, empty);
    if (!docpane.dataset.leaving) empty();
    arrange();
  });
  if (assistOpen()) { followFocusScope(); drawAssist(); }
}

// Project memory (lib/project-memory.mjs) is searched from the palette without
// a model call; a hit opens the work it came from.
async function openProjectHit(hit) {
  if (!hit) return;
  if (hit.kind === 'accepted_cell' && (await viewOf('extraction')).focusCell(hit.paper_id, hit.column_id)) {
    go('extraction');
    if (hit.locator) openDocument(hit.locator.doc_id, hit.locator);
  } else if (hit.kind === 'paper') { go('library'); if (get().papers.find(p => p.id === hit.paper_id)?.pdf) openDocument(hit.paper_id); }
  else if (hit.kind === 'note') { go('library'); if (hit.paper_id) openDocument(hit.paper_id, { page: hit.page }); }
  else if (hit.kind === 'screening_decision') go('screening');
  else if (hit.kind === 'analysis') go('analysis');
  else if (hit.kind === 'manuscript_draft') go('manuscript');
  else go('protocol');
}

// Divider drag, with the width remembered.
const savedWidth = localStorage.getItem('lykos.docWidth');
if (savedWidth) docpane.style.setProperty('--doc-w', savedWidth);
divider.addEventListener('pointerdown', e => {
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const move = ev => {
    const rect = split.getBoundingClientRect();
    const w = Math.min(rect.width * 0.72, Math.max(320, rect.right - ev.clientX));
    docpane.style.setProperty('--doc-w', `${Math.round(w)}px`);
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing');
    localStorage.setItem('lykos.docWidth', docpane.style.getPropertyValue('--doc-w'));
    reader.reflow?.();
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
});
divider.addEventListener('keydown', e => {
  const step = e.shiftKey ? 48 : 16;
  const cur = docpane.getBoundingClientRect().width;
  if (e.key === 'ArrowLeft') docpane.style.setProperty('--doc-w', `${Math.round(cur + step)}px`);
  else if (e.key === 'ArrowRight') docpane.style.setProperty('--doc-w', `${Math.round(Math.max(320, cur - step))}px`);
  else return;
  e.preventDefault();
  localStorage.setItem('lykos.docWidth', docpane.style.getPropertyValue('--doc-w'));
  reader.reflow?.();
});

// ---- assistant drawer ----------------------------------------------------
const assistEl = document.getElementById('assist');
const assistLog = document.getElementById('assist-log');
// the chat composer (ui-actions.css): its controls placed by the builder
document.getElementById('assist-composer-host').outerHTML = uiComposer({ id: 'assist-composer', form: false, input: { id: 'assist-in', label: 'Message', placeholder: 'Ask about this project' },
  send: { id: 'assist-send', label: 'Send', kbd: 'Enter' }, stop: { id: 'assist-stop', label: 'Stop' } });
// Find in chat: the shared find bar (count, field, Previous | Next, Close), shown in place when the chat's More asks for it.
{
  const find = barEl(uiBar({ kind: 'tools', density: 'dense', stack: false, label: 'Find in chat', id: 'assist-find', cls: 'assist-find', status: { id: 'assist-find-count', text: '', ch: 16 },
    filters: [{ type: 'search', id: 'assist-find-in', label: 'Find in chat', placeholder: 'Find in chat' }],
    actions: [uiGroup({ id: 'assist-find-steps', label: 'Matches', items: [{ id: 'assist-find-prev', label: 'Previous match', icon: 'arrow-up' }, { id: 'assist-find-next', label: 'Next match', icon: 'arrow-down' }] }),
      { id: 'assist-find-close', label: 'Close chat search', icon: 'close', role: 'quiet', keep: true }] }));
  find.hidden = true;
  document.getElementById('assist-find-host').replaceWith(find);
}
const assistIn = document.getElementById('assist-in');
let assistExpanded = false, dockedHistory = null, chatFindIndex = 0;
let sideMode = 'review';
autoGrow(assistIn, { max: 200 });
// The chat's tools row (lib/assist-tools.mjs), mounted again when the chat expands; clicks answered by id.
let assistTools = null;
function mountAssistTools() {
  const next = barEl(uiBar(assistToolsSpec({ expanded: assistExpanded })));
  next.hidden = assistTools ? assistTools.hidden : true;   // drawAssist shows it on the Chat tab
  if (assistTools) assistTools.replaceWith(next); else assistEl.querySelector('.assist-head').append(next);   // last in the head: row 2, after expand and close (a bar's gap rule spaces what follows a bar)
  assistTools = next;
}
mountAssistTools();
/** A control the engine has folded into More has no box to anchor a menu or panel to: the row does. */
const toolsAnchor = el => el.getClientRects().length ? el : assistTools;
/** One picker's value, in place: the tooltip carries the whole text when the row clips it, the accessible name always does. */
function setToolValue(id, value, detail = '', shown = value) {
  const el = assistTools.querySelector(`#${id}`), span = el?.querySelector('.ui-picker-value');
  if (!span) return;
  if (span.textContent !== shown) span.textContent = shown;
  span.title = detail || value;
  el.setAttribute('aria-label', `${el.title}: ${value}`);
}
function assistOpen() { return !assistEl.hidden && assistEl.dataset.leaving == null; }
// What the assistant is told with every message: the same picture every model
// action gets (lib/aid.mjs describe), plus anything the view adds of its own.
function viewContext() {
  let own = '';
  try { own = VIEWS[currentKey]?.assistContext?.() || ''; } catch {}
  return [aid.describe(currentContext()), own, attachStore.module()?.attachedText()].filter(Boolean).join('\n\n');
}

/**
 * What the person is looking at, now: the view, what in it has focus (the
 * view's own focus(), when it has one), the document open beside it and the
 * page shown, and any text selected. Captured when an action is chosen, so the
 * action works on what was in front of the person at that moment.
 */
let heldSelection = '';
let explorerAtLoad = null;   // the tree is on its way because the Files tab was open at start: the first view waits for it
function currentContext() {
  const v = VIEWS[currentKey];
  let focus = null, doc = null;
  try { focus = v?.focus?.() || null; } catch {}
  const selectedFile = sideMode === 'files' ? explorer.module()?.selectedFile() || '' : '';
  if (selectedFile && currentKey !== 'files') focus = { kind: 'file', label: selectedFile.split('/').pop(), detail: selectedFile };
  if (openPaper) try { doc = reader.focus?.() || null; } catch {}
  const live = String(getSelection?.() || '').trim();
  return { view: currentKey, viewTitle: v?.meta.title || '', focus, document: doc, selection: (live || heldSelection).slice(0, 6000) };
}
const shortModel = m => String(m || '').replace(/^~/, '').split('/').pop().replace(/-latest$/, '');
let engineWait = false;   // the chat engine is being fetched for the cost line
/**
 * The line under the chat box: what the assistant will be told, as a state —
 * the view, the thing in focus, the document and page, the selection — and
 * the cost. The selection can be left out with its ×.
 */
function assistNote() {
  fitAssistIn();
  const cfg = assistant.sessionProfile(settings.profiles(), settings.modelFor('chat')); const n = document.getElementById('assist-note');
  if (!modelConfigured(cfg)) { n.textContent = ''; return; }
  const c = currentContext();
  // The cost needs the tool schemas, which load with the chat engine: the line draws without it and again when it is here.
  const tokens = assistant.estimate(assistIn.value, viewContext(), activeFocus());
  if (tokens == null && !engineWait) { engineWait = true; assistant.ensureEngine().then(() => { engineWait = false; assistNote(); }, err => { engineWait = false; console.warn('[assistant]', err.message); }); }
  const parts = [c.viewTitle, c.focus?.label, c.document && `${c.document.label || 'document'} · p. ${c.document.page}`].filter(Boolean);
  n.innerHTML = `${esc(parts.join(' · '))}${c.selection ? ` · <span class="assist-sel">${c.selection.length} characters selected · <button type="button" class="link" id="assist-sel-x" title="Leave the selection out">Leave out</button></span>` : ''} ${tokens == null ? '' : ` · ~${tokens} tokens`}`;
  n.querySelector('#assist-sel-x')?.addEventListener('click', () => { heldSelection = ''; getSelection?.()?.removeAllRanges?.(); assistNote(); });
}
function activeFocus() {
  if (currentKey === 'files') return { view: 'files', file: { name: VIEWS.files.headerTitle(), path: VIEWS.files.shown() } };
  const cell = currentKey === 'extraction' ? VIEWS.extraction.selection?.() : null;
  const paperId = cell?.paperId || (currentKey === 'library' ? VIEWS.library.selection?.() : null)
    || (currentKey === 'screening' ? VIEWS.screening.selection?.() : null);
  const searchRecord = currentKey === 'search' ? VIEWS.search.selection?.() : null;
  const documentFocus = reader.context?.();
  const activePaper = paperId || (searchRecord ? null : openPaper || documentFocus?.paper_id);
  return { view: currentKey, ...(activePaper ? { paper_id: activePaper } : {}),
    ...(searchRecord ? { record: searchRecord } : {}),
    ...(cell ? { column_id: cell.columnId } : {}),
    ...(documentFocus && documentFocus.paper_id === activePaper ? {
      page: documentFocus.page, selected_text: documentFocus.selected_text,
    } : {}) };
}
let lastAssistError = '';
// The chat's scope follows what is open: a cell, a paper, or the project.
function followFocusScope() {
  const focus = activeFocus();
  assistant.setScope(focus.column_id ? { kind: 'cell', paper_id: focus.paper_id, column_id: focus.column_id }
    : focus.paper_id ? { kind: 'paper', paper_id: focus.paper_id } : { kind: 'project' });
}
// The link under a checked citation opens the exact page and quote.
const kTok = n => n == null ? '' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const usageText = u => u ? [u.prompt != null ? `${kTok(u.prompt)} in` : '', u.completion != null ? `${kTok(u.completion)} out` : '', u.cost != null ? `$${u.cost.toFixed(4)}` : 'cost unknown'].filter(Boolean).join(' · ') : '';

let assistTab = 'details';
let chatPeek = null;
let repaintStatus = () => {};   // set once the status bar is wired
// The views' actions load on first use (lib/aid.mjs ensureAid). A saved proposal needs its describers to be counted and drawn, so the count
// waits (`aidOpen` is null, the old text stays) until they are here; the menu, the palette, Proposals and the assistant's tools await ensureAid.
let aidWaking = false, aidSaid = false;
// Batch extraction's status and Proposals entry (views/batch-*.mjs), loaded when a batch has left something; null until then.
let batchMod = null, batchLoading = null;
function batchLoad() {
  return batchLoading ||= Promise.all([import('./views/batch-control.mjs'), import('./views/batch-proposals.mjs')])
    .then(([c, p]) => (batchMod = { ...c, ...p }), err => { batchLoading = null; throw err; });
}
function batchOf() {
  if (!batchMod && !batchLoading && batchPresent(get())) batchLoad().then(() => { repaintStatus(); if (assistOpen() && assistTab === 'proposals') drawAssist(); }, batchFailed);
  return batchMod;
}
let batchSaid = false;
function batchFailed(err) {
  console.warn('[batch]', err);
  if (!batchSaid) { batchSaid = true; subtitle.textContent = `Could not load batch extraction: ${err.message}`; }
}
function aidFailed(err) {
  console.warn('[aid]', err);
  if (!aidSaid) { aidSaid = true; subtitle.textContent = `Could not load the assistant's actions: ${err.message}`; }
}
function wakeAid() {
  if (aidWaking || !aid.aidNeeded()) return;
  aidWaking = true;
  aid.ensureAid().then(() => { if (assistOpen()) drawAssist(); else document.getElementById('aid-count').textContent = aid.openCount() || ''; repaintStatus(); }, aidFailed).finally(() => { aidWaking = false; });
}
const aidOpen = () => { if (aid.aidNeeded()) { wakeAid(); return null; } return aid.openCount(); };
/** Runs `fn` once the actions are here: at once when they are, else after the import; a failed import is said in the subtitle. */
function withAid(fn) { if (aid.aidReady()) return fn(); return aid.ensureAid().then(fn, aidFailed); }
const assistantProgress = lazyModule(() => import('./lib/assistant-progress-ui.mjs'), 'assistant progress');
let progressWaking = false;
function wakeAssistantProgress() {
  if (progressWaking) return;
  progressWaking = true;
  assistantProgress.ensure().then(() => { if (assistTab === 'chat') drawAssist(); }, err => { subtitle.textContent = err.message; }).finally(() => { progressWaking = false; });
}
const activityRows = (steps, key) => assistantProgress.ready() ? assistantProgress.module().activityRows(steps, key, get().papers) : (wakeAssistantProgress(), '');
let chatFollow = true, lastChatSurface = '';
const followChatEnd = () => { if (chatFollow && assistTab === 'chat') assistLog.scrollTop = assistLog.scrollHeight; };
assistLog.addEventListener('scroll', () => { if (assistTab === 'chat') chatFollow = assistLog.scrollHeight - assistLog.scrollTop - assistLog.clientHeight < 64; }, { passive: true });
const chatContentUpdates = new MutationObserver(() => { if (chatFollow && assistTab === 'chat') requestAnimationFrame(followChatEnd); });
chatContentUpdates.observe(assistLog, { childList: true, subtree: true, characterData: true });
assistLog.addEventListener('load', () => requestAnimationFrame(followChatEnd), true);
function paintAssistantActivity() {
  const host = assistLog.querySelector('.assist-live'), run = assistant.activity();
  if (!host || !run) return;
  const follow = chatFollow;
  const opened = new Set([...host.querySelectorAll('details[open]')].map(d => d.dataset.activityKey));
  if (!assistantProgress.ready()) { wakeAssistantProgress(); return; }
  const planHtml = run.blocks?.some(b => b.type === 'plan') ? (chatAnswers.ready() ? chatAnswers.module().renderAnswerBlocks(run.blocks.filter(b => b.type === 'plan'), 0, get(), { live: true }) : (wakeAnswers(), '')) : '';
  host.innerHTML = assistantProgress.module().renderAssistantActivity(run, get().papers, planHtml);
  enhancePageUi(host);
  host.querySelectorAll('details').forEach(d => { d.open = opened.has(d.dataset.activityKey); });
  if (follow) assistLog.scrollTop = assistLog.scrollHeight;
}
let activityClock = null;
assistant.onActivity(() => {
  paintAssistantActivity();
  if (assistant.busy() && !activityClock) activityClock = setInterval(() => {
    const run = assistant.activity(), clock = assistLog.querySelector('[data-live-elapsed]');
    if (run && clock) clock.textContent = elapsedLabel(Date.now() - run.startedAt);
  }, 1000);
  if (!assistant.busy()) { clearInterval(activityClock); activityClock = null; }
});
const REPLY_ENDED = ['stopped', 'error', 'interrupted', 'incomplete', 'budget'];
/** What can be done with a reply, one quiet row. A finished reply offers Copy, Into manuscript, To do and (the last one) Retry. One that ended with saved work offers Resume,
 *  and starting again from the question is in More beside Branch: the two are never side by side. One that ended with nothing saved offers Retry. */
function replyActions(i, t, last) {
  const ended = REPLY_ENDED.includes(t.status), resume = last && ended && (t.blocks?.length || t.agents?.some(a => a.text));
  const acts = [
    ...(ended ? [] : [{ id: `assist-copy-${i}`, label: 'Copy', icon: 'copy', attrs: { 'data-copy': i } },
      { id: `assist-ms-${i}`, label: 'Into manuscript', icon: 'manuscript', attrs: { 'data-ms': i } },
      { id: `assist-todo-${i}`, label: 'To do', icon: 'tasks', attrs: { 'data-todo': i } }]),
    ...(resume ? [{ id: `assist-resume-${i}`, label: 'Resume', icon: 'run', attrs: { 'data-resume': true } }]
      : last ? [{ id: `assist-retry-${i}`, label: 'Retry', icon: 'refresh', attrs: { 'data-retry': true } }] : []),
  ].map(a => ({ role: 'quiet', ...a }));
  const overflow = [...(resume ? [{ id: `assist-restart-${i}`, label: 'Start again', icon: 'refresh', attrs: { 'data-retry': true } }] : []),
    { id: `assist-branch-${i}`, label: 'Branch from here', icon: 'branch', attrs: { 'data-branch': i } }];
  return `<div class="assist-acts${ended ? ' visible' : ''}">${uiBar({ kind: 'tools', label: 'Reply actions', id: `assist-acts-${i}`, density: 'dense', actions: acts, overflow, budget: { n: 5, reason: 'a reply offers copy, manuscript, to do and retry or resume; the width engine folds what does not fit' } })}</div>`;
}
/** A reply action reports what it did as a fill and a tooltip: its label never changes, so nothing around it moves. */
const actDone = (b, text) => { b.setAttribute('aria-pressed', 'true'); b.title = text; };
function drawAssist() {
  assistEl.dataset.tab = assistTab;
  const scrollTop = assistLog.scrollTop;
  const surface = `${assistTab}:${assistant.currentSession()?.id || ''}`;
  if (surface !== lastChatSurface) { chatFollow = true; lastChatSurface = surface; }
  const follow = chatFollow;
  const opened = new Set([...assistLog.querySelectorAll('details[open][data-activity-key]')].map(d => d.dataset.activityKey));
  document.querySelectorAll('#assist-tabs [data-tab]').forEach(b => {
    const on = b.dataset.tab === assistTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const n = aidOpen();
  if (n != null) document.getElementById('aid-count').textContent = n ? String(n) : '';
  document.querySelector('.assist-foot').hidden = assistTab !== 'chat';
  assistTools.hidden = assistTab !== 'chat' || assistEl.classList.contains('chat-history-view');
  document.getElementById('assist-expand').hidden = assistTab !== 'chat';
  if (assistTab !== 'chat') { closeChatHistory(); dockedHistory = null; }
  if (assistTab === 'proposals') { drawProposals(); return; }
  if (assistTab === 'details') { drawDetails(); return; }
  proposalsDrawn = '';
  const cfg = assistant.sessionProfile(settings.profiles(), settings.modelFor('chat')); const ok = modelConfigured(cfg);
  setToolValue('assist-model', ok ? (assistant.sessionTeam()?.name || shortModel(cfg.model)) : 'Set up a model', ok ? `${cfg.model}${cfg.provider==='chatgpt'?' · ChatGPT plan':''} · Effort: ${effortLabel(cfg.effort)}` : '');
  document.getElementById('assist-send').disabled = !ok || assistant.busy();
  document.getElementById('assist-send').hidden = assistant.busy();
  document.getElementById('assist-stop').hidden = !assistant.busy();
  assistNote();
  const session = assistant.currentSession();
  const sessionCh = assistExpanded ? EXPANDED_SESSION_CH : SESSION_CH;   // expanded, the name is the page's title: the picker's widest share
  setToolValue('assist-session', assistant.sessionName(session), '', fitWords(assistant.sessionName(session), sessionCh));
  const turns = assistant.turns();
  document.getElementById('assist-export').disabled = !turns.length;
  dockedHistory?.refresh();

  if (!turns.length) {
    // Nothing said yet: what this view is usually asked, ready to send.
    // the page's questions from the registry (lib/assist-menu.mjs), the project-wide one last
    const sug = [...new Set([...pageHelp(currentKey).asks, PROJECT_ASK])], page = REGISTRY[currentKey]?.meta.title;
    assistLog.innerHTML = `<div class="assist-empty">${ok ? `<h3>${esc(page ? `Ask about ${page}` : 'Ask about this project')}</h3>` : assistModelNotice()}${assistSuggestions({ items: sug, disabled: !ok })}</div>`;
    if (lastAssistError) assistLog.insertAdjacentHTML('beforeend', `<div class="assist-msg assistant" role="alert">${esc(lastAssistError)}</div>`);   // a refusal before any turn
    assistLog.querySelector('[data-chat-model]')?.addEventListener('click',openModelSettings);
    assistLog.querySelectorAll('[data-sugg]').forEach(b => b.onclick = () => { assistIn.value = b.dataset.sugg; assistIn.dispatchEvent(new Event('input')); assistSend(); });
    updateChatFind();
    return;
  }
  const lastReply = turns.map(t => t.role).lastIndexOf('assistant');
  const reply = (t, i) => t.agents?.some(a=>a.phase==='conversation') ? '' : replyHtml(t.text, t.cites, i);
  const answerBlocks = (blocks, i) => !blocks?.length ? '' : chatAnswers.ready() ? chatAnswers.module().renderAnswerBlocks(blocks, i, get()) : (wakeAnswers(), '');
  const toolCount = t => visibleActivity(t.steps).length;
  const trail = t => [t.status === 'interrupted' ? 'Interrupted' : t.status === 'stopped' ? 'Stopped' : t.status === 'error' ? 'Failed' : t.status === 'incomplete' ? 'Incomplete' : t.status === 'budget' ? 'Budget reached' : toolCount(t) ? `${toolCount(t)} ${toolCount(t) === 1 ? 'tool call' : 'tool calls'}` : 'Answered', t.durationMs != null ? elapsedLabel(t.durationMs) : '', usageText(t.usage)].filter(Boolean).join(' · ');
  assistLog.innerHTML = turns.map((t, i) => `<div class="assist-msg ${t.role}" data-turn="${i}" tabindex="-1">${
    t.role === 'assistant' ? reply(t, i) + answerBlocks(t.blocks, i) + teamReports(t,i) : `<div class="assist-user-text">${esc(t.text)}</div>${t.attached?.length ? `<div class="meta assist-user-attached">${esc(`Attached: ${t.attached.map(a => `${a.word}: ${a.label}`).join('; ')}`)}</div>` : ''}`}${
    t.reference ? `<div class="assist-reference"><strong>${esc(t.reference.title || 'Title needed')}</strong>
      <span class="meta">${esc([t.reference.authors?.join(', '), t.reference.journal, t.reference.year, t.reference.doi].filter(Boolean).join(' · '))}</span>
      <button data-reference="${i}"${t.referenceSavedId ? ' disabled' : ''}>${t.referenceSavedId ? 'In the Library' : 'Add to Library'}</button></div>` : ''}${
    t.role === 'assistant' && trail(t) ? (toolCount(t)
      ? `<details class="assist-steps" data-activity-key="turn-${i}"><summary>${esc(trail(t))}</summary>${activityRows(t.steps, `turn-${i}`)}</details>`
      : `<div class="assist-steps">${esc(trail(t))}</div>`) : ''}${
    t.role === 'assistant' ? replyActions(i, t, i === lastReply && i === turns.length - 1 && !assistant.busy()) : `<div class="assist-message-menu">${uiRowEnd({ more: { label: 'Message actions', attrs: { 'data-message-more': i } } })}</div>`}</div>`).join('');
  if (lastAssistError) assistLog.insertAdjacentHTML('beforeend', `<div class="assist-msg assistant">${esc(lastAssistError)}</div>`);
  if (assistant.busy()) {
    const p = document.createElement('div'); p.className = 'assist-live'; assistLog.append(p);
    paintAssistantActivity();
  }
  turns.forEach((t, i) => (t.cites || []).forEach((c, j) => {
    const b = assistLog.querySelector(`[data-cite="${i}:${j}"]`);
    if (b) b.onclick = () => openDocument(c.doc_id, { page: c.page, rects: c.rects, quote: c.quote, kind: 'text' });
  }));
  const addChatPaper = p => { updateStore(st => { addAnswerRecord(st,p); return st; }); refreshCounts(); drawAssist(); };
  chatAnswers.module()?.wireAnswerBlocks(assistLog, turns, chatBlockActions(turns));
  enhancePageUi(assistLog);
  assistLog.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await answersFor([turns[+b.dataset.copy]]); await navigator.clipboard.writeText(replyText(turns[+b.dataset.copy])); actDone(b, 'Copied'); } catch { b.title = 'Select the text to copy it'; } });
  assistLog.querySelectorAll('[data-ms]').forEach(b => b.onclick = async () => {
    try { await answersFor([turns[+b.dataset.ms]]); } catch (err) { subtitle.textContent = err.message; return; }
    const text = replyText(turns[+b.dataset.ms]);
    updateStore(st => { st.manuscript = st.manuscript || { blocks: [], snapshot: {} }; st.manuscript.blocks.push(blankBlock('p', text)); return st; });
    actDone(b, 'Added'); refreshCounts();
  });
  assistLog.querySelectorAll('[data-reference]').forEach(b => b.onclick = () => {
    const i = +b.dataset.reference, t = turns[i];
    if (!t?.reference) return;
    referenceEditor.ensure().then(m => m.addReference(t.reference, id => {
      updateStore(st => { const th = (st.threads || []).find(x => x.messages?.includes(t)) || null; const m = th?.messages.find(x => x === t); if (m) m.referenceSavedId = id; return st; });
      refreshCounts(); drawAssist();
    }, ctx), err => ctx.say(err.message));
  });
  assistLog.querySelectorAll('[data-todo]').forEach(b => b.onclick = () => { addTodo(turns[+b.dataset.todo].text.split('\n')[0].slice(0, 160)); actDone(b, 'Added'); refreshCounts(); });
  assistLog.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => { const q = assistant.lastQuestion(); assistant.dropLastExchange(); assistIn.value = q; assistSend(); }));
  assistLog.querySelectorAll('[data-resume]').forEach(b => b.addEventListener('click', () => { assistIn.value = `Continue my previous request: ${assistant.lastQuestion()}. Inspect the saved plan, drafts and tool results first. Reuse completed work, resume unfinished steps, verify the result, and state any observed blockers.`; assistSend(); }));
  assistLog.querySelectorAll('[data-branch]').forEach(b => b.addEventListener('click', () => branchFrom(+b.dataset.branch)));
  assistLog.querySelectorAll('details[data-activity-key]').forEach(d => { d.open = opened.has(d.dataset.activityKey); });
  assistLog.scrollTop = follow ? assistLog.scrollHeight : scrollTop;
  if (follow) requestAnimationFrame(followChatEnd);
  assistLog.querySelectorAll('[data-message-more]').forEach(b => b.onclick = () => {
    const index = Number(b.dataset.messageMore);
    showMenu(b, [{ label: 'Copy', icon: 'copy', run: async () => { try { await navigator.clipboard.writeText(replyText(turns[index])); } catch {} } },
      { label: 'Branch from here', icon: 'branch', run: () => branchFrom(index) }], { align: 'end', matchWidth: false });
  });
  updateChatFind();
}
/** A new conversation that begins at this message; ignored when the project or the conversation has changed meanwhile. */
function branchFrom(index) {
  const id = assistant.currentSession()?.id;
  if (id && assistant.sessions().some(t => t.id === id)) { changeChat(() => assistant.branchSession(id, index)); assistIn.focus(); }
}
function replyText(turn) {
  return [turn.text, ...(turn.blocks||[]).map(b=>b.artifact?chatAnswers.module().artifactText(b.artifact):b.type==='table'?[b.columns,...b.rows].map(r=>r.join('\t')).join('\n'):b.items?.map(i=>i.text||`${i.label}: ${i.value}`).join('\n'))].filter(Boolean).join('\n\n');
}
function showChatBlock(turn, block, threadId = assistant.currentSession()?.id) { chatPeek = { turn, block, threadId }; studyPeek = null; toggleAssist(true,'details'); arrange(); assistLog.scrollTop=0; }
async function showResearchRecord(id) { try { await chatAnswers.ensure(); } catch (err) { subtitle.textContent = err.message; return; } const r=researchRecords(get()).find(r=>r.id===id); if(!r)return; chatPeek={turn:0,block:0,threadId:r.threadId,savedBlock:r.block}; studyPeek=null; toggleAssist(true,'details'); arrange(); assistLog.scrollTop=0; }
function chatBlockActions(turns) {
  const add = p => { updateStore(st=>{addAnswerRecord(st,p);return st;});refreshCounts();drawAssist(); };
  return {
    add, task: addTodo, details: showChatBlock,
    continue: plan => { if (assistant.busy()) return; chatPeek = null; toggleAssist(true, 'chat'); assistIn.value = `Continue the saved research plan: ${plan.objective}. Read the saved work, reuse completed checks, and finish the remaining steps.`; return assistSend(); },
    // a suggested task from the chat: the same write, check and provenance as the add_task op (the press is the acceptance)
    suggest: async item => (await taskSuggest.ensure()).addSuggested({ text: item.text, link: item.view ? { view: item.view, ...(item.paperId ? { paperId: item.paperId } : {}) } : null }, { model: settings.modelFor('chat')?.model || '', source: 'chat' }),
    preview: p => { const known=libraryIndex(get().papers).find(p); if(known){chatPeek=null;return openStudy(ctx,known.id);}chatPeek={record:p};toggleAssist(true,'details');arrange();assistLog.scrollTop=0; },
    study: id=>{if(get().papers.some(p=>String(p.id)===id))openStudy(ctx,get().papers.find(p=>String(p.id)===id).id);},
    go: (view,paperId)=>{if(paperId&&get().papers.some(p=>p.id===paperId)&&['library','screening','extraction','appraisal','notes'].includes(view))return ctx.openStudyResults(view,paperId);return go(view);},
    refresh: ()=>{refreshCounts();drawAssist();},
    download: (b,button)=>{
      const answers = chatAnswers.module();   // the press came from a block this module drew
      if(b.type==='survival') return answers.downloadSurvivalBlock(b,button);
      if(b.type==='output')return showMenu(button,(b.spec.kind==='chart'?['svg','png','csv','xlsx']:['docx','xlsx','csv']).map(ext=>({label:{docx:'Word',xlsx:'Excel',csv:'CSV',svg:'SVG',png:'PNG'}[ext],icon:`download-${ext}`,run:async()=>{try{const {files}=await answers.outputFiles(get(),b.spec,[ext],{svgToPng});if(!files.length)throw new Error('Export unavailable');await saveFile(files[0].data,`${b.spec.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80)}.${ext}`);}catch(e){button.textContent='Try again';button.title=e.message;}}})));
      const a=b.artifact||answers.validateArtifact({kind:b.type==='table'?'table':'infographic',title:b.title,subtitle:b.note,sections:[{type:b.type,columns:b.columns,rows:b.rows,items:b.items}]});answers.downloadArtifact(a,button);
    },
    manuscript: (a,button)=>{updateStore(st=>{st.manuscript ||= {blocks:[],snapshot:{}};st.manuscript.blocks.push(...chatAnswers.module().artifactBlocks(a).map(b=>({...b,id:blankBlock('p','').id})));return st;});button.textContent='Inserted';button.disabled=true;refreshCounts();},
    continue: plan=>{chatPeek=null;toggleAssist(true,'chat');assistIn.value=`Continue the research plan: ${plan.objective}. Read the earlier plan and deliverables, resume unfinished steps, and update the plan with actual results.`;assistSend();},
  };
}
/** The panel button is on while the panel is open; the sparkle while it shows the chat. */
function syncPanelButtons() {
  const open = assistOpen();
  topbar.setPressed(open);
  document.getElementById('assist-toggle')?.classList.toggle('on', open && assistTab === 'chat');
  document.getElementById('assist-toggle')?.setAttribute('aria-expanded', String(open && assistTab === 'chat'));
  document.getElementById('st-props')?.setAttribute('aria-expanded', String(open && assistTab === 'proposals'));
  document.getElementById('flow-help')?.setAttribute('aria-expanded', String(open && assistTab === 'chat'));
}
function toggleAssist(open = !assistOpen(), tab = null, quiet = false) {
  if (assistExpanded && (!open || (tab && tab !== 'chat'))) expandChat(false);
  if (tab) assistTab = tab;
  const wasOpen = assistOpen();
  if (open && !wasOpen && split.classList.contains('insp-sheet')) navHistory?.step('sheet', () => toggleAssist(false, null, true)); else if (!open && wasOpen) navHistory?.drop('sheet');
  if (!open && !quiet) {
    inspWanted = false;
    try { localStorage.setItem('lykos.insp', 'closed'); } catch {}
  }
  // One width change for the work, on the press; the pane slides over it
  // (see slidePane). Laid over the work, nothing beneath changes at all.
  if (open) {
    keepPlace(() => { assistEl.hidden = false; if (!wasOpen) slidePane(assistEl, true); arrange(); });
    followFocusScope(); drawAssist();
    if (assistTab === 'chat') assistIn.focus({ preventScroll: true });
  } else if (!assistEl.hidden && !assistEl.dataset.leaving) {
    keepPlace(() => {
      slidePane(assistEl, false, () => { assistEl.hidden = true; arrange(); });
      if (!assistEl.dataset.leaving) assistEl.hidden = true;
      arrange();
    });
  }
  syncPanelButtons();
}

// ---- model actions ---------------------------------------------------------
// The panel is redrawn only when its entries change, not when a running
// action reports progress: a redraw replaces every button, and one between a
// press and its release loses the click. Progress is written in place.
let proposalsDrawn = '';
// Items grouped by the record they concern, in first-seen order; the record is
// named once as the group's heading, not on every row.
function groups(items) {
  const out = new Map();
  for (const it of items) { const g = it.where?.label || ''; if (!out.has(g)) out.set(g, []); out.get(g).push(it); }
  // Items about no record in particular come first, under no heading.
  return [...out].sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0));
}
function drawProposals() {
  if (!aid.aidReady()) {   // nothing is drawn until the actions are here, then the tab draws once
    assistLog.innerHTML = ''; proposalsDrawn = '';
    aid.ensureAid().then(() => { if (assistOpen() && assistTab === 'proposals') drawAssist(); }, aidFailed);
    return;
  }
  const list = aid.aidNow().allEntries();
  const batchEntry = batchOf()?.batchEntryHtml(get()) || '';
  // What each row says is read from its payload against the project now (aid.describeItem), so the key holds it: a task done
  // elsewhere turns its row stale without a new proposal.
  const said = i => { const d = aid.aidNow().describeItem(i, get()); return `${d.label}|${d.stale}`; };
  const key = currentKey + '\n' + (batchOf() ? batchMod.batchEntryKey(get()) : '0.0.0|') + '\n' + list.map(e => `${e.id}:${e.status}:${e.error}:${e.note}:${JSON.stringify(aid.aidNow().acceptResult(e.id))}:${e.items.map(i => `${i.id}${i.state}${i.result || ''}${i.pending ? 'p' : ''}${aid.aidNow().isTicked(e.id, i.id) ? '' : 'u'}${said(i)}`).join(',')}`).join(';');
  if (key === proposalsDrawn && assistLog.querySelector('.aid-entry, .assist-empty')) {
    for (const e of list) if (e.status === 'running') {
      const n = assistLog.querySelector(`.aid-entry[data-e="${e.id}"] .aid-state`);
      if (n) n.lastChild.textContent = e.progress || 'Working';
    }
    return;
  }
  proposalsDrawn = key;
  const keep = assistLog.scrollTop;
  const expandedItems = new Set([...assistLog.querySelectorAll('.aid-item')].filter(row => !row.querySelector('.aid-more')?.hidden).map(row => row.dataset.i));
  if (!list.length) {
    // the page's runs (lib/assist-menu.mjs, as the assistant menu lists them): each files its result here
    const page = pageMenu(currentKey, aid.aidNow().actionsFor(currentKey, currentContext()));
    const acts = [...page.runs.map(a => [a.id, a.label]), ...page.opens.map(o => [`open:${o.click}`, o.label])];
    assistLog.innerHTML = batchEntry + (acts.length
      ? `<div class="assist-empty"><h3>${esc(REGISTRY[currentKey]?.meta.title || 'Proposals')}</h3>${assistSuggestions({ items: acts, attr: 'data-act', label: 'Model actions' })}</div>`
      : batchEntry ? '' : emptyState({ title: 'No proposals', size: 'inline' }));
    assistLog.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const id = b.dataset.act; if (id.startsWith('open:')) document.getElementById(id.slice(5))?.click(); else runAid(id); });
    wireBatchEntries();
    return;
  }
  assistLog.innerHTML = batchEntry + list.map(e => {
    const items = e.items.filter(i => i.state !== 'discarded');
    const open = aid.aidNow().openItems([e]).length;
    const meta = [REGISTRY[e.view]?.meta.title, shortModel(e.meta), agoText(e.at)].filter(Boolean).join(' · ');
    // A homogeneous proposal is a checklist: the verb once in the head, a check per row (lib/aid.mjs isChecklist).
    if (aid.aidNow().isChecklist(e, get())) return `<div class="aid-entry" data-e="${e.id}" data-checklist>${aid.aidNow().checklistHtml(e, get(), { meta })}${e.note ? `<div class="aid-note">${esc(e.note)}</div>` : ''}</div>`;
    return `<div class="aid-entry" data-e="${e.id}">
      <div class="aid-entry-top">${aid.aidNow().reviewEntryHead({ id: e.id, title: aid.aidNow().entryTitle(e), running: e.status === 'running', canAcceptAll: e.status === 'done' && open > 1, busy: items.some(i => i.pending), pending: open })}${aid.aidNow().entryStatusLine({ id: e.id, meta })}</div>
      ${e.status === 'running' ? `<div class="aid-state"><span class="engine busy"></span>${esc(e.progress || 'Working')}</div>` : ''}
      ${e.status === 'failed' || e.status === 'stopped' ? `<div class="aid-state failed">${esc(e.status === 'stopped' ? 'Stopped' : e.error)}${e.needsModel ? ' <button class="link" data-models>Models</button>' : ''}</div>` : ''}
      ${e.note ? `<div class="aid-note">${esc(e.note)}</div>` : ''}
      ${e.status === 'done' && !items.length ? `<div class="aid-note">Nothing found</div>` : ''}
      ${groups(items).map(([g, rows]) => `${g ? `<div class="aid-group">${esc(g)}</div>` : ''}${uiReviewList({ items: rows.map(it => aid.aidNow().reviewRowHtml(it, get(), { open: expandedItems.has(it.id), group: g })) })}`).join('')}
    </div>`;
  }).join('');
  assistLog.scrollTop = keep;
  wireBatchEntries();
  assistLog.querySelectorAll('.aid-entry').forEach(el => {
    const e = list.find(x => x.id === el.dataset.e); if (!e) return;
    el.querySelector('[data-stop]')?.addEventListener('click', () => aid.aidNow().stop(e.id));
    el.querySelector('[data-all]')?.addEventListener('click', async () => { if (el.hasAttribute('data-checklist')) await aid.aidNow().acceptTicked(e.id); else await aid.aidNow().acceptAll(e.id); afterAccept(); });
    el.querySelector('[data-undo]')?.addEventListener('click', () => { if (aid.aidNow().undoAccept(e.id)) afterAccept(); });
    // Removing suggested tasks with rows cleared: those are not suggested again (Settings › Tasks can forget them).
    el.querySelector('[data-rm]')?.addEventListener('click', async () => {
      const dismiss = el.hasAttribute('data-checklist') && aid.aidNow().isTaskSuggestion(e) ? aid.aidNow().untickedLabels(e.id) : null;
      if (dismiss) { try { (await taskSuggest.ensure()).dismissSuggestions(dismiss); } catch (err) { subtitle.textContent = err.message; } }
      aid.aidNow().remove(e.id);
    });
    // A tick changes only the primary's count, in place: the row and its focus stay.
    el.querySelectorAll('[data-tick]').forEach(box => box.addEventListener('change', () => {
      aid.aidNow().tick(e.id, box.dataset.tick, box.checked);
      const all = el.querySelector('[data-all]'), n = el.querySelectorAll('[data-tick]:checked').length, label = all?.querySelector('.ui-act-label');
      if (label) label.textContent = label.textContent.replace(/\d+$/, String(n));
      if (all) { all.disabled = !n; all.setAttribute('aria-label', label?.textContent || ''); all.title = label?.textContent || ''; }
    }));
    el.querySelector('[data-models]')?.addEventListener('click', () => openModelSettings());
    el.querySelectorAll('.aid-item').forEach(row => {
      const it = e.items.find(i => i.id === row.dataset.i); if (!it) return;
      row.querySelector('[data-more]')?.setAttribute('aria-expanded', String(!row.querySelector('.aid-more')?.hidden));
      row.querySelector('[data-accept]')?.addEventListener('click', async () => { await aid.aidNow().accept(e.id, it.id); afterAccept(); });
      row.querySelector('[data-discard]')?.addEventListener('click', () => aid.aidNow().discard(e.id, it.id));
      row.querySelector('[data-where]')?.addEventListener('click', () => openStudy(ctx, it.where.paperId, it.where.locator || null));
      row.querySelector('[data-more]')?.addEventListener('click', e => {
        const more = row.querySelector('.aid-more'); if (!more || !more.children.length && String(it.label || '').length < 180) return;
        more.hidden = !more.hidden; e.currentTarget.setAttribute('aria-expanded', String(!more.hidden));
      });
    });
  });
}
// An accepted item changed the project; the view shows it, keeping its place.
function afterAccept() { refreshCounts(); paint(currentKey); }
// The entry for a batch extraction: open its page, or accept its clean proposals after a counted confirmation.
function wireBatchEntries() {
  batchMod?.wireBatchEntry(assistLog, {
    openPatients: () => import('./views/patient-review.mjs').then(m => { m.setReviewTab('review'); return go('patients'); }, err => { console.warn('[page]', err); subtitle.textContent = `Could not open Patient data: ${err.message}`; }),
    openTable: async id => { (await viewOf('extraction')).setTemplate(id || 'default'); go('extraction'); },
    done: afterAccept,
  });
}

/** Runs a model action of the current view on what is in front of the person now. */
function runAid(id, context = currentContext()) {
  heldSelection = '';
  toggleAssist(true, 'proposals');
  withAid(() => aid.aidNow().run(context.view, id, context));
}
aid.setModelLookup(task => settings.modelFor(task));
aid.onChange(() => { if (currentKey === 'manuscript') VIEWS.manuscript.syncSuggestions(); if (assistOpen()) drawAssist(); else { const n = aidOpen(); if (n != null) document.getElementById('aid-count').textContent = n || ''; } });
document.getElementById('assist-tabs').onclick = e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  if (assistExpanded && b.dataset.tab !== 'chat') expandChat(false);
  assistTab = b.dataset.tab; syncPanelButtons(); drawAssist(); if (assistTab === 'chat') assistIn.focus();
};
// Arrow keys, Home and End move between the tabs of a tab list and choose the one they reach (the inspector's, the sidebar's).
const tabArrows = sel => e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll(sel)].filter(t => t.getClientRects().length);
  const at = tabs.indexOf(document.activeElement); if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
};
document.getElementById('assist-tabs').onkeydown = tabArrows('[data-tab]');
// The ✦ button: this view's actions, on what is selected or in focus. The
// selection is taken on pointerdown, before the click can move focus off it (the title bar wires that).
function aidMenu(anchor) {
  const context = currentContext();
  if (!aid.aidReady()) { withAid(() => aidMenuAt(anchor, context)); return; }
  aidMenuAt(anchor, context);
}
function aidMenuAt(anchor, context) {
  // One registry says what the assistant does on each page (lib/assist-menu.mjs): runs land in Proposals, questions are sent to the chat.
  const page = pageMenu(currentKey, aid.aidNow().actionsFor(currentKey, context));
  const draft = text => { toggleAssist(true, 'chat'); assistIn.value=text; assistIn.dispatchEvent(new Event('input')); assistIn.focus(); };
  const chatReady = modelConfigured(assistant.sessionProfile(settings.profiles(), settings.modelFor('chat')));
  const ask = text => { toggleAssist(true, 'chat'); assistIn.value = text; assistIn.dispatchEvent(new Event('input')); assistSend(); };
  const runs = [...page.runs.map(a => ({ label: a.label, icon: a.icon, meta: aid.hasModel(a.task) ? '' : 'No model', run: () => runAid(a.id, context) })),
    ...page.opens.map(o => ({ label: o.label, icon: 'checklist', run: () => document.getElementById(o.click)?.click() }))];
  const asks = page.asks.map(text => ({ label: text, icon: 'draft-question', disabled: !chatReady, meta: chatReady ? '' : 'No model', run: () => ask(text) }));
  showMenu(anchor, [
    ...runs, runs.length && '-',
    ...asks, asks.length && '-',
    { label: 'Ask about this', icon: 'assistant', meta: '⌘J', run: () => askFocused(anchor) },
    {label:'Create',icon:'plus',submenu:creationRequests(context).map(({label,icon,text})=>({label,icon,run:()=>draft(text)}))},
    {label:'Search the web…',icon:'search',run:()=>draft('Search public web sources for: ')},
  ].filter(Boolean));
}
const showAidBtn = () => {
  // named for the page it serves; the tooltip says what it holds
  const page = REGISTRY[currentKey]?.meta.title || 'this page';
  topbar.setAid(currentKey !== 'start', `Assistant: ${page}`, 'What the assistant can do on this page · ⌘J asks');
};
// What is in focus changes without a repaint — a row clicked, a cell focused,
// text selected — and an action's subject with it; the button follows.
let aidCheck = 0;
const recheckAid = () => { cancelAnimationFrame(aidCheck); aidCheck = requestAnimationFrame(showAidBtn); };
for (const ev of ['pointerup', 'focusin', 'keyup']) document.getElementById('split').addEventListener(ev, recheckAid);
document.addEventListener('selectionchange', recheckAid);
async function assistSend() {
  const text = assistIn.value.trim(); if (!text || assistant.busy()) return;
  let cfg = assistant.sessionProfile(settings.profiles(), settings.modelFor('chat'));
  if (!modelConfigured(cfg)) {
    document.getElementById('assist-note').textContent = 'Set up a model to send.';
    assistIn.focus();
    return;
  }
  // Attached items go with this message only; a cloud connection under "local models only" is refused first, so they wait for a local model.
  const sending = attachStore.module()?.attachments() || [];
  if (sending.length) { try { assertRoute(cfg); } catch (err) { lastAssistError = err.message; drawAssist(); return; } }
  // attachments carry their data class; a connection not yet cleared for one asks first (lib/run-preview.mjs)
  for (const a of sending) declare(a.text, a.dataClass);
  try { if (!(cfg = await (await runPreview.ensure()).askBeforeSend(cfg, sending))) return; } catch (err) { lastAssistError = err.message; drawAssist(); return; }
  followFocusScope();
  const told = viewContext(), actionContext = currentContext(), focus = activeFocus();
  // The selection and the attached items went with this message; the next one starts without them.
  heldSelection = '';
  attachStore.module()?.clearAttachments();
  assistIn.value = ''; if(assistant.currentSession())assistant.configureSession({draft:''}); assistIn.dispatchEvent(new Event('input'));
  lastAssistError = '';
  chatFollow = true;
  const p = assistant.ask(text, { cfg, model: cfg.model, viewContext: told, actionContext, focus, attached: sending.length ? attachStore.module().attachedNotes(sending) : [], fileSource: currentKey === 'files' ? VIEWS.files.assistantSource() : null });
  drawAssist();
  try { await p; }
  catch (err) { if (err?.name !== 'AbortError' && assistant.turns().at(-1)?.status !== 'error') lastAssistError = `Could not reach the model: ${err.message.slice(0, 160)}`; }
  drawAssist();
}
document.getElementById('assist-send').onclick = assistSend;
document.getElementById('assist-stop').onclick = () => { assistant.stop(); drawAssist(); };
document.getElementById('assist-close').onclick = () => toggleAssist(false);
document.getElementById('assist-expand').onclick = () => expandChat();
// The chat row's controls by id (the entries of More are real, hidden buttons the row's menu clicks, so they land here too).
const toolsActions = {
  'assist-session': el => showChatHistory(toolsAnchor(el)),
  'assist-model': el => chatModelMenu(toolsAnchor(el)),
  'assist-new': () => { if (!assistExpanded) closeChatHistory(); changeChat(() => assistant.newSession()); assistIn.focus(); },
  // The assistant's saved work is a section of Tables and figures (From the assistant).
  'assist-saved': async () => { (await viewOf('outputs')).openList(); await go('outputs'); view.querySelector('#out-assistant')?.scrollIntoView({ block: 'start' }); },
  'assist-find-open': () => toggleChatFind(true),
  'assist-export': () => exportChat(),
  'assist-jump': () => { chatFollow = true; assistLog.scrollTop = assistLog.scrollHeight; },
};
assistEl.querySelector('.assist-head').addEventListener('click', e => {
  const button = e.target.closest?.('#assist-chat-tools button[id]');
  if (button && !button.disabled) toolsActions[button.id]?.(button);
});
document.getElementById('assist-find-close').onclick = () => toggleChatFind(false);
document.getElementById('assist-find-in').oninput = () => { chatFindIndex = 0; updateChatFind(true); };
document.getElementById('assist-find-prev').onclick = () => { chatFindIndex--; updateChatFind(true); };
document.getElementById('assist-find-next').onclick = () => { chatFindIndex++; updateChatFind(true); };
async function exportChat() {
  const t = assistant.currentSession(); if (!t) return;
  try { await answersFor(t.messages || []); } catch (err) { lastAssistError = `Could not export chat: ${String(err.message || err).slice(0, 120)}`; drawAssist(); return; }
  const text = conversationMarkdown(t, { teamName: assistant.sessionTeam()?.name || '', renderMessage: replyText });
  const filename = `${assistant.sessionName(t).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70) || 'conversation'}.md`;
  try { await saveFile(text, filename, 'text/markdown;charset=utf-8'); }
  catch (err) { lastAssistError = `Could not export chat: ${String(err.message || err).slice(0, 120)}`; drawAssist(); }
}
function toggleChatFind(on = document.getElementById('assist-find').hidden) {
  document.getElementById('assist-find').hidden = !on;
  if (on) document.getElementById('assist-find-in').focus();
  else { document.getElementById('assist-find-in').value = ''; updateChatFind(); assistIn.focus(); }
}
function updateChatFind(scroll = false) {
  const input = document.getElementById('assist-find-in'), hits = findChatMessages(assistant.currentSession()?.messages || [], input.value);
  chatFindIndex = hits.length ? (chatFindIndex + hits.length) % hits.length : 0;
  document.getElementById('assist-find-count').textContent = input.value.trim() ? hits.length ? `${chatFindIndex + 1} of ${hits.length}` : 'No matches' : '';
  document.getElementById('assist-find-prev').disabled = document.getElementById('assist-find-next').disabled = hits.length < 2;
  assistLog.querySelectorAll('[data-turn]').forEach(el => {
    const i = Number(el.dataset.turn); el.classList.toggle('chat-match', hits.includes(i));
    el.classList.toggle('chat-match-current', hits[chatFindIndex] === i);
  });
  if (scroll) assistLog.querySelector('.chat-match-current')?.scrollIntoView({ block: 'center' });
}
document.getElementById('assist-find-in').onkeydown = e => {
  if (e.isComposing) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleChatFind(false); }
  else if (e.key === 'Enter') { e.preventDefault(); chatFindIndex += e.shiftKey ? -1 : 1; updateChatFind(true); }
};
// While the chat fills the window the title bar names the chat: none of the hidden page's commands; collapsing gives the page's head back.
const CHAT_HEAD = { title: 'Assistant', tip: '', status: null, view: null, pageBack: null, crumbs: null, nav: [], titleMenu: null, titleNoun: '', moreIcon: false, acts: [], overflow: [], checks: [] };
let pageHead = null, linkBack = null;   // linkBack: { key, title, at: the first page title shown after the link }
const backToLink = () => { const to = linkBack.key; if (navHistory?.lastStep() === 'view') history.back(); else go(to, { fromHistory: true }); };
function linkPageBack(offered) {
  if (!linkBack || offered.nav?.length) return null;   // Files' path keeps its own chevrons
  linkBack.at ??= offered.title;
  return offered.title === linkBack.at ? { label: `Back to ${linkBack.title}`, run: backToLink } : null;
}
/** The title bar's state for a page declaration (pageOf): every key, so a set() leaves nothing of the page before. Files declares its path and history. */
const headOf = offered => ({
  title: offered.title, tip: '', crumbs: offered.crumbs || null, nav: offered.nav || [], titleMenu: offered.titleMenu || null, titleNoun: offered.titleNoun || '', moreIcon: false,
  status: offered.status || null, view: offered.view || null, pageBack: linkPageBack(offered) || offered.back || null,
  acts: offered.actions, overflow: offered.overflow, find: offered.find || null,
});
function expandChat(on = !assistExpanded) {
  closeChatHistory(); dockedHistory = null; assistExpanded = on;
  if (on) topbar.setBack(false);
  topbar.set(on ? CHAT_HEAD : pageHead || CHAT_HEAD);
  mountAssistTools();
  split.classList.toggle('chat-expanded', on);
  // Expanded chat replaces the normal titlebar. Tauri's deep region includes
  // the empty tools row while leaving its buttons and their icons clickable.
  const head = assistEl.querySelector('.assist-head');
  if (on) head.setAttribute('data-tauri-drag-region', 'deep');
  else head.removeAttribute('data-tauri-drag-region');
  const b = document.getElementById('assist-expand');
  b.title = on ? 'Collapse' : 'Expand'; b.ariaLabel = on ? 'Collapse chat' : 'Expand chat';
  b.innerHTML = (on ? icon('collapse') : icon('fit')); b.setAttribute('aria-expanded', String(on));
  if (on) { toggleAssist(true, 'chat'); arrange(); drawAssist(); }
  else { document.getElementById('assist-history-dock').hidden = true; arrange(); drawAssist(); }
  fitAssistIn();
}
// Enter sends; Shift+Enter is a new line.
assistIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); assistSend(); } });
assistIn.addEventListener('input', assistNote);
// The box grows with what is typed, up to about a third of the window, then scrolls.
function fitAssistIn() {
  if (!assistIn.clientWidth) return;
  assistIn.style.setProperty('height', '0px');
  const max = Math.round(innerHeight * 0.35), h = Math.min(assistIn.scrollHeight + 2, max);
  assistIn.style.setProperty('height', `${h}px`);
  assistIn.style.setProperty('overflow-y', assistIn.scrollHeight + 2 > max ? 'auto' : 'hidden');
}
assistIn.addEventListener('input', fitAssistIn);
// Measured again whenever its width changes: when the panel opens, the box
// is measured before it has its width, and one line would wrap into many.
watchWidth(assistIn, fitAssistIn, { now: true });
document.getElementById('assist-toggle').onclick = () => toggleAssist(!(assistOpen() && assistTab === 'chat'), 'chat');
// Laid over the work, the panel closes when the dimmed work is pressed — the
// dimming is the split's own layer, so the press lands on the split itself.
document.getElementById('split').addEventListener('pointerdown', e => {
  if (e.target === e.currentTarget && assistOpen() && getComputedStyle(assistEl).position === 'absolute') toggleAssist(false);
});
// Pressing into the panel moves focus into the chat box, which drops the page's
// selection; take it first, so "this" in a question still means what was selected.
const holdPageSelection = () => {
  const sel = getSelection?.();
  const text = String(sel || '').trim();
  if (text && !assistEl.contains(sel.anchorNode)) heldSelection = text;
};
assistEl.addEventListener('pointerdown', holdPageSelection, true);
document.getElementById('assist-toggle').addEventListener('pointerdown', holdPageSelection);
document.addEventListener('selectionchange', () => { if (assistOpen() && assistTab === 'chat') assistNote(); });
// ---- Ask about this: attached by a gesture, a row above the composer, sent with the next message only (assistSend); loads on first use ----
const attachStore = lazyModule(() => import('./lib/chat-attach.mjs'), 'the attached items');
wireAsk({ state: get, say: msg => ctx.say(msg), held: () => heldSelection, reader: () => reader.context?.(), view: () => ({ view: currentKey, views: VIEWS }),
  open: () => { heldSelection = ''; toggleAssist(true, 'chat'); assistIn.focus(); }, store: attachStore });
document.addEventListener('lykos-attached', assistNote);
onProjectReplaced(() => attachStore.module()?.clearAttachments());

// The reader's close control is answered here, in the capture phase, so no
// handler or overlay inside the pane can stand between the press and the close.
document.addEventListener('pointerdown', e => {
  if (e.button === 0 && e.target.closest?.('#docpane #close')) { e.preventDefault(); e.stopPropagation(); closeDocument(); }
}, true);

/** Settings > Teams, with the team open for editing when there is one. */
function openTeamSettings(id) { toggleAssist(false); go(id ? `settings:teams:${id}` : 'settings:teams'); }
/** No model yet (Fill): the guided setup over the page, which stays; true once one is added. A ChatGPT sign-in goes to Settings. */
async function connectModel() {
  if (settings.profiles().length) { openModelSettings(); return false; }
  const out = await (await import('./views/settings-connect.mjs')).connectWizard();
  if (!out) return false;
  settings.setProfiles([...settings.profiles(), out.profile]);
  if (out.signIn) { await openModelSettings(); return false; }
  repaintStatus?.(); ctx.say('Connection added');
  return true;
}
async function openModelSettings() {
  toggleAssist(false); await go('settings:models');
  const setup = view.querySelector('#ai-connect');   // no connection yet: the guided setup opens (views/settings-connect.mjs)
  if (setup) setup.click(); else view.querySelector('#ai-profile-pick, #ai-provider')?.focus();
}
function changeChat(fn) {
  if(assistant.currentSession())assistant.configureSession({draft:assistIn.value});
  fn(); assistIn.value=assistant.currentSession()?.draft||'';lastAssistError='';drawAssist();assistNote();repaintStatus?.();
}
function teamReports(turn,i) {
  if(!turn.agents?.length)return '';
  if(turn.agents.every(a=>a.phase==='conversation'))return `<section class="assist-group-replies" aria-label="Team replies">${turn.agents.map(a=>`<article class="assist-group-reply"><div class="meta"><strong>${esc(a.role)}</strong> <span>${esc(shortModel(a.model||''))}${a.status==='error'?' · Failed':''}</span></div>${replyHtml(a.text,a.cites||[],i)}</article>`).join('')}</section>`;
  const agents = turn.agents.map((a, j) => disclosure({ title: `${a.role} · ${a.phase || 'investigation'}`, meta: `${a.status} · ${shortModel(a.model || '')}`, attrs: { 'data-activity-key': `team-${i}-${j}` },
    body: `<div class="assist-team-report">${esc(a.text || 'No findings saved.')}</div>` })).join('');
  return `<section class="assist-team">${disclosure({ title: `Team findings · ${turn.agents.length}`, attrs: { 'data-activity-key': `team-${i}` }, body: agents })}</section>`;
}
async function showChatHistory(anchor) {
  let panel; try { panel = await chatHistory.ensure(); } catch (err) { ctx.say(err.message); return; }
  const identity = get().project;
  const valid = id => get().project === identity && assistant.sessions().some(t => t.id === id);
  dockedHistory = panel.openChatHistory(anchor, {
    dock: document.getElementById('assist-history-dock'),
    sessions: assistant.sessions, activeId: () => assistant.currentSession()?.id,
    teamName: t => (get().modelTeams || []).find(team => team.id === t.teamId)?.name || '',
    describe: t => t.teamId ? (get().modelTeams || []).find(team => team.id === t.teamId)?.name || 'Team unavailable' : shortModel(t.modelOverride || t.model || ''),
    running: id => assistant.runningSessions().some(t => t.id === id),
    select: id => { if (valid(id)) { changeChat(() => assistant.selectSession(id)); assistIn.focus(); } },
    create: () => { if (get().project === identity) { changeChat(() => assistant.newSession()); assistIn.focus(); } },
    rename: async id => {
      if (!valid(id)) return;
      const name = await ask('Rename chat', { value: assistant.sessionName(assistant.sessions().find(t => t.id === id)) });
      if (valid(id) && name?.trim()) { assistant.renameSession(id, name); drawAssist(); }
    },
    archive: (id, archived) => { if (valid(id)) changeChat(() => assistant.archiveSession(id, archived)); },
    remove: async id => {
      if (!valid(id)) return;
      const name = assistant.sessionName(assistant.sessions().find(t => t.id === id));
      if (await confirmAsk(`Delete “${name}”?`, { detail: 'Deletes this chat’s messages and saved chat draft.', confirm: 'Delete', danger: true })) {
        if (valid(id)) changeChat(() => assistant.removeSession(id));
      }
    },
  });
}
const cfgForTeam=team=>{const cfg=settings.profiles().find(p=>p.id===team.leadProfileId)||{};return {...cfg,model:team.leadModel||cfg.model};};
function chatModelMenu(anchor) {
  const identity = get().project, chatId = assistant.currentSession()?.id;
  const refresh = () => { drawAssist(); repaintStatus?.(); };
  const valid = () => get().project === identity && assistant.currentSession()?.id === chatId;
  const team = assistant.sessionTeam(), profiles = settings.profiles();
  const teamRoute = (member = null) => {
    const id = member?.profileId || team.leadProfileId;
    const p = profiles.find(p => p.id === id) || {id,provider:'',model:''};
    const cfg = {...p,model:(member ? member.model : team.leadModel)||p.model,effort:(member ? member.effort : team.leadEffort)||''};
    return quickModelItems(cfg, {profiles,change:route=>{
      if (!valid()) return;
      updateStore(s=>{const saved=s.modelTeams?.find(t=>t.id===team.id);if(!saved)return s;
        if(member){const m=saved.members.find(m=>m.id===member.id);if(m)Object.assign(m,{profileId:route.profileId,model:route.model,effort:route.effort});}
        else Object.assign(saved,{leadProfileId:route.profileId,leadModel:route.model,leadEffort:route.effort});return s;});refresh();
    }});
  };
  // The chat's own budget: a popover anchored where the menu was (DIALOGS §4.2); its defaults are rows of Settings > AI > Models.
  const budget = assistant.sessionBudget();
  const budgetItem = {label:'Chat budget',meta:`${budget.calls} calls`,run:async()=>{ let panel; try { panel = await chatBudget.ensure(); } catch (err) { ctx.say(err.message); return; } panel.openChatBudget(anchor,{budget,say:ctx.say,save:next=>{
    if (!valid()) throw new Error('The open chat changed. Open its budget again.');
    assistant.configureSession({budget:next}); refresh(); return 'Budget saved';
  }}); }};
  if (team) {
    showMenu(anchor,[{label:'Coordinator',meta:shortModel(cfgForTeam(team).model),submenu:teamRoute()},
      {label:'Members',submenu:team.members.map(m=>({label:m.role,meta:shortModel(m.model||profiles.find(p=>p.id===m.profileId)?.model||'Unavailable'),submenu:teamRoute(m)}))},
      {label:'Edit team',run:()=>openTeamSettings(team.id)},
      {label:'Change team',run:()=>teamMenu(anchor,{manage:()=>openTeamSettings(),choose:t=>{if(valid()){assistant.configureSession({teamId:t.id,profileId:null,modelOverride:null,effort:''});refresh();}}})},
      {label:'Use a single model',run:()=>{assistant.configureSession({teamId:null,profileId:team.leadProfileId,modelOverride:team.leadModel||null,effort:team.leadEffort||''});refresh();}},
      '-', budgetItem,
      {label:'Manage connections',run:openModelSettings}]); return;
  }
  const cfg = assistant.sessionProfile(profiles,settings.modelFor('chat'));
  showMenu(anchor,[...quickModelItems(cfg,{profiles,change:route=>{if(valid()){assistant.configureSession({profileId:route.profileId,teamId:null,modelOverride:route.model,effort:route.effort});refresh();}}}),
    ...(cfg.provider==='chatgpt'?[{label:'Manage ChatGPT usage',run:()=>openChatGptUsage()}]:[]),
    {label:'Use chat task default',checked:!assistant.currentSession()?.profileId&&!assistant.currentSession()?.modelOverride&&!assistant.currentSession()?.effort,run:()=>{assistant.configureSession({profileId:null,teamId:null,modelOverride:null,effort:''});refresh();}},
    {label:'Use model team',run:()=>teamMenu(anchor,{manage:()=>openTeamSettings(),choose:t=>{if(valid()){assistant.configureSession({teamId:t.id,profileId:null,modelOverride:null,effort:''});refresh();}}})},
    '-', budgetItem,
    {label:'Manage connections',run:openModelSettings}]);
}
function bottomModelMenu(anchor) {
  const identity=get().project, profiles=settings.profiles();
  const taskItems=([task,label])=>({label,meta:shortModel(settings.modelFor(task).model||'None'),submenu:[
    ...quickModelItems(settings.modelFor(task),{profiles,change:route=>{if(get().project===identity){settings.setTaskRoute(task,route);drawAssist();repaintStatus?.();}}}),
    {label:'Use task default',checked:!get().settings?.models?.routes?.[task],run:()=>{if(get().project===identity){settings.setTaskRoute(task,null);drawAssist();repaintStatus?.();}}},
  ]});
  showMenu(anchor,[{label:'Change this chat',run:()=>chatModelMenu(anchor)},
    {label:'Models for this project',submenu:settings.TASKS.map(taskItems)},
    {label:'Manage connections',run:openModelSettings}]);
}

const ctx = {
  go,
  runModelAction: (id, context) => runAid(id, { ...currentContext(), ...context }),
  say: msg => { subtitle.textContent = msg || ''; },
  // A list that redraws only its rows (a filter) keeps the page's count in the title bar: the status slot is reserved, so nothing moves.
  status: s => { topbar.set({ status: s || null }); },
  // The Files view reports what it shows (where, size, modified) and, when its tabs change, redraws the title and its More without a repaint.
  detail: text => { if (currentKey === 'files') subtitle.textContent = text || ''; },
  // A view whose head changes without a repaint (a workflow's Run becoming Stop as its run starts) has its page() read again and the title bar drawn.
  chrome: () => {
    const v = VIEWS[currentKey]; if (typeof v?.page !== 'function') return;
    pageHead = headOf(pageOf(v, ctx.rerender, { single: !!v.list?.inBar && pagedSingle }));
    if (!assistExpanded) topbar.set(pageHead);
  },
  fileChrome: () => {
    if (currentKey !== 'files') return;
    pageHead = headOf(pageOf(VIEWS.files, ctx.rerender));
    if (!assistExpanded) topbar.set(pageHead);
  },
  openFileNote: async note => { if (note.source?.kind === 'paper') { if (get().papers.some(p => p.id === note.source.paperId)) openDocument(note.source.paperId); return; } if (note.source?.kind === 'workflow') { (await viewOf('workflows')).restoreNavigation({workflow:note.source.workflowId}); go('workflows'); return; } await (await viewOf('files')).openNote(note); go('files'); },
  openModelSettings,
  connectModel,
  openTeams: id => openTeamSettings(id),
  openProposals: () => toggleAssist(true,'proposals'),
  openReporting: async section => { (await viewOf('reporting')).select(section); go('reporting'); },
  showResearchRecord,
  helpWorkflow: () => { if (assistOpen() && assistTab === 'chat') { toggleAssist(false); return; } toggleAssist(true, 'chat'); assistIn.value = 'Help me edit this workflow. Propose changes for me to review.'; assistIn.focus(); assistNote(); },
  rerender: msg => { paint(currentKey); if (msg) subtitle.textContent = String(msg); },
  // A view that redraws only its rows (a filter) gives them the table fitting a paint would.
  fitRows: root => numericColumns(root),
  refreshCounts,
  refreshList: () => refreshList(),
  // Focus mode: the document alone. The view says when (Notes' Focus); leaving the view ends it.
  // A single-pane window shows the list or the item: a view that opens an item (a new note) or empties the selection says which.
  openItem: () => { pane = 'detail'; }, showList: () => { pane = 'list'; },
  focus: on => { if (!!on === listFocus) return; listFocus = !!on; plist.hidden = listFocus || !VIEWS[currentKey]?.list; plistGrip.hidden = plist.hidden || plist.hasAttribute('data-index'); arrange(); if (!listFocus) refreshList(); },
  onKey: fn => { keyHandler = fn; },
  openDocument,
  closeDocument,
  openPaper: () => openPaper,
  // A study named in a table or figure: its record in Details.
  // Details, shown and redrawn now, whatever the panel was showing.
  showChatBlock: (turn, block, threadId) => showChatBlock(turn, block, threadId),
  openDetails: () => { toggleAssist(true, 'details'); arrange(); },
  // The open document's notes and suggested values are Details sections (views/reader.mjs inspect): redraw them when they change.
  refreshDetails: () => { if (assistOpen() && assistTab === 'details') drawDetails(); },
  openAssistantSession: id => { changeChat(() => assistant.selectSession(id)); toggleAssist(true, 'chat'); },
  // A row of a study's "In this review": the view, at this study (`item`: the screening stage or the analysis the row names).
  openStudyResults: async (key, id, item) => {
    const v = await viewOf(key);
    if (['library', 'extraction', 'appraisal', 'screening'].includes(key)) v.focusPaper(id, item);
    else if (key === 'notes') v.openPaperNotes(id);
    else v.select?.(item ?? id);
    await go(key);
    pane = 'detail';
    openStudy(ctx, id);
  },
  showStudy: (id, hasDoc) => { studyPeek = { id, hasDoc }; toggleAssist(true, 'details'); arrange(); assistLog.scrollTop = 0; },
  // The record just selected shows in Details, unless the panel was closed on purpose.
  showDetails: () => { if (assistOpen() ? true : inspWanted && !split.classList.contains('insp-over')) { toggleAssist(true, 'details'); arrange(); } },
};

function refreshCounts() {
  const state = get();
  wakeAid();
  for (const k of [...order(), ...FOOTER]) {
    const n = REGISTRY[k].count?.(state) ?? 0;
    (k === 'settings' ? document.getElementById('foot') : nav)
      .querySelector(`[data-c="${k}"]`)?.replaceChildren(document.createTextNode(n || ''));
  }
}

/** `settings:<part>` opens Settings at a section (the page's own show* function, called once the page is here). */
const SETTINGS_AT = { teams: 'showTeams', models: 'showModels', mcp: 'showMcp', projects: 'showProjects', project: 'showProject', about: 'showAbout', keyboard: 'showKeyboard' };
let goSeq = 0;
/** The page a key opens, and what it asks of that page once its module is here: 'protocol:ethics' opens that part, 'files:D2:<path>' the file and the
 * flow that settles a drift row, 'library:quality' a check panel, 'submissions:read' the letter. An unknown key is the Overview. */
function planOf(k) {
  const pre = [];
  if (!Object.hasOwn(LOAD, k) && k !== 'mcp' && !/^(protocol|library:|files:|submissions:|settings:)/.test(String(k))) k = 'overview';
  if (k === 'mcp') k = 'settings:mcp';
  if (k.startsWith?.('settings:')) { const [, part, id] = k.split(':'); pre.push(() => VIEWS.settings[SETTINGS_AT[part]](id)); k = 'settings'; }
  if (k.startsWith?.('protocol:')) { const part = k.split(':')[1]; pre.push(() => VIEWS.protocol.select(part)); k = 'protocol'; }
  if (k.startsWith?.('files:')) { const drift = k.slice(6); pre.push(() => VIEWS.files.openDrift(drift)); k = 'files'; }
  if (k.startsWith?.('library:')) { const check = k.split(':')[1]; pre.push(() => VIEWS.library.openCheck(check)); k = 'library'; }
  if (k.startsWith?.('submissions:')) { const part = k.split(':')[1]; pre.push(() => VIEWS.submissions.showPart(part)); k = 'submissions'; }
  // An accuracy review's Analysis is its own view; links to 'analysis' land there.
  if (k === 'analysis' && order().includes('dta')) k = 'dta';
  if (k === 'analysis' && order().includes('umbrella')) k = 'umbrella';
  if (k === 'analysis' && order().includes('nma')) k = 'nma';
  // A qualitative synthesis has Synthesis and Confidence in their places.
  if (k === 'analysis' && order().includes('synthesis')) k = 'synthesis';
  if (k === 'certainty' && order().includes('confidence')) k = 'confidence';
  return { k, pre };
}
/** Opens a page. A page that is loaded opens at once, as it always did; one that is not loads first (a second `go` meanwhile wins) and the returned promise ends when it is shown. */
function go(key, opts = {}) {
  const plan = planOf(key), seq = ++goSeq;
  if (VIEWS[plan.k]) return goNow(plan, opts);
  return viewOf(plan.k).then(() => { if (seq === goSeq) goNow(plan, opts); }, err => { console.warn('[page]', plan.k, err); subtitle.textContent = `Could not open ${REGISTRY[plan.k]?.meta.title || 'the page'}: ${err.message}`; });
}
function goNow({ k, pre }, { fromNavigation = false, arrive = null, fromHistory = false, link = true }) {
  if (assistExpanded) expandChat(false);
  closeChatHistory(); dockedHistory = null;
  for (const run of pre) run();
  // Leaving the Files view with unsaved edits asks first (Save, Don't save, Cancel); the answer arrives later, and the move is made then.
  if (currentKey === 'files' && k !== 'files' && VIEWS.files.hasUnsaved()) { VIEWS.files.confirmLeave().then(ok => { if (ok) go(k, { fromNavigation, arrive, fromHistory, link }); }); return; }
  if (arrive || (arrival && arrival.view !== k)) setArrival(k, arrive);
  // a tab's Back returns here (lib/nav-history.mjs)
  const prev = currentKey; if (prev && k !== prev && !fromHistory) navHistory?.step('view', () => go(prev, { fromNavigation: true, fromHistory: true }));
  // a page reached by a link (not the sidebar, not a Back) offers Back to the page it came from, while its first page shows
  if (fromNavigation || fromHistory || !link) linkBack = null; else if (prev && k !== prev) linkBack = { key: prev, title: REGISTRY[prev]?.meta.title || 'the last page', at: null };
  closeDrawer();
  if (k !== currentKey) { studyPeek = null; chatPeek = null; }
  // A repaint keeps its place; moving to another view starts at its top.
  const moved = k !== currentKey;
  if (moved) { inspOnDemand = false; listFocus = false; }
  currentKey = k;
  if (fromNavigation) {
    VIEWS[k]?.openList?.();
    if (VIEWS[k]?.list) { listKey = null; enterList = true; pane = 'list'; }
  }
  // Figure findings change what a page shows at navigation, never under a reader's hands (plan §4.15c.7).
  if (k === 'overview' || k === 'outputs') applyFigureResults();
  paint(k);
  if (moved) { view.scrollTop = 0; if (!matchMedia('(prefers-reduced-motion: reduce)').matches) view.animate([{opacity:.65,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:140,easing:'ease-out'}); }
}

const rememberPage = () => {
  if (navigationProject !== null) rememberNavigation(navigationProject, { view: currentKey, ...VIEWS[currentKey]?.navigationState?.() });
};
window.addEventListener('pagehide', rememberPage);
// A figure pass that changed the findings redraws the Overview, unless a field in it has the keyboard. After the watch has applied its
// result (it does so just after telling us), so a redraw never shows the rows it is about to replace.
onFigureNeeds(() => setTimeout(() => { const a = document.activeElement; if (currentKey === 'overview' && !(a && view.contains(a) && a.matches('input,textarea,select'))) paint('overview'); }, 0));

// Every scrolled box in a view (the page, a settings category list, a table,
// a tree) keeps its place across a repaint. A box is known by its path of
// ids and classes up to the view, state classes left out, so the redrawn box
// is found again even though it is a new element.
const STATE_CLASS = /^(on|open|selected|sel|active|current|fresh|tight|more-below|editing)$/;
const scrollSelector = e => e.tagName.toLowerCase() + [...e.classList].filter(c => !STATE_CLASS.test(c)).map(c => `.${CSS.escape(c)}`).join('');
const scrollKey = (el, root) => { const path = []; for (let e = el; e && e !== root; e = e.parentElement) { path.push(e.id ? `#${e.id}` : scrollSelector(e)); if (e.id) break; } return path.join('<'); };
function snapshotScroll(root) {
  const boxes = [];
  for (const e of root.querySelectorAll('*')) if (e.scrollTop > 0 || e.scrollLeft > 0) boxes.push({ sel: e.id ? `#${CSS.escape(e.id)}` : scrollSelector(e), key: scrollKey(e, root), top: e.scrollTop, left: e.scrollLeft });
  // A disclosure the reader opened stays open across the repaint (a pager or a
  // checkbox inside it must not fold it): each is known by its id or its class
  // and summary; those closed after being open by default stay closed too.
  const details = new Map();
  for (const d of root.querySelectorAll('details')) details.set(detailsKey(d), d.open);
  return { top: root.scrollTop, left: root.scrollLeft, boxes, details };
}
const detailsKey = d => d.id ? `#${d.id}` : `${d.className}|${d.querySelector(':scope > summary')?.textContent.trim().replace(/\s*\d[\d,.]*\s*$/, '') || ''}`;
function restoreScroll(root, snap) {
  if (!snap) return;
  for (const d of root.querySelectorAll('details')) { const was = snap.details?.get(detailsKey(d)); if (was != null && was !== d.open) d.open = was; }
  root.scrollTop = snap.top; root.scrollLeft = snap.left;
  for (const b of snap.boxes) {
    let found = null;
    try { found = [...root.querySelectorAll(b.sel)].find(e => scrollKey(e, root) === b.key); } catch {}
    if (found) { found.scrollTop = b.top; found.scrollLeft = b.left; }
  }
}
let painted = '';   // the view on screen, so a repaint of the same view keeps its scroll
const UNMOUNTS = new Set(['notes', 'imaging', 'workflows', 'manuscript', 'outputs', 'screening', 'appraisal', 'tasks', 'extraction']);   // the pages that give back what they drew outside #view
// ---- arrival (lib/arrive.mjs) -------------------------------------------------
// A "Needs attention" row lands on its page with what is wrong there: the destination narrows its own list to the offending items when
// it can (its arrive() hook, reusing its filter state), and one quiet notice under the page's head says so, with what to do and at most
// one direct action. Leaving the page, Show all or Dismiss ends both; nothing is stored.
function setArrival(k, a) {
  if (arrival) { const was = arrival; arrival = null; VIEWS[was.view]?.arrive?.(null); }
  // `item`: the part of a list page it landed on (Protocol's Eligibility criteria); a notice that narrows nothing is about that part only
  if (a && VIEWS[k]) { const narrowed = VIEWS[k].arrive?.(a) === true; arrival = { view: k, a, narrowed, fixed: false, item: narrowed ? undefined : VIEWS[k].selected?.() }; }
}
function drawArrival(surface, k) {
  const v = VIEWS[k];
  // the view's own filter changed under the notice (a segment, a reset): the notice no longer says what the page shows
  if (arrival.narrowed && v.arrived && !v.arrived()) { arrival = null; return; }
  // another part of the page was picked (Protocol: Eligibility criteria, then Ethics): the notice was about the part it landed on
  if (arrival.item !== undefined && v.selected?.() !== arrival.item) { arrival = null; return; }
  const { a, narrowed } = arrival, fix = a.fix && v.arriveFirst && !arrival.fixed;
  const host = document.createElement('div');
  host.innerHTML = uiNotice({ id: 'arrive', label: 'Needs attention here', text: arrivalText(a, narrowed),
    actions: [fix && { id: 'arrive-fix', label: a.fix, icon: 'chevron-right' }, narrowed && { id: 'arrive-all', label: 'Show all', role: 'quiet' }].filter(Boolean), dismissible: !narrowed });
  const note = host.firstElementChild;
  // A single pane showing the list it narrowed: over that list, under its filters (the page beside it is not on screen). Otherwise
  // under the page's main head: the one the view names (the Library's list, not its Collections column), else its first, with
  // its text where the head's title starts.
  const filters = narrowed && v.list && split.classList.contains('show-list') ? document.getElementById('plist-filter') : null;
  const head = filters ? null : (v.arriveUnder && surface.querySelector(v.arriveUnder)) || [...surface.querySelectorAll('.ui-bar')].find(b => b.dataset.uiBar === 'head' && !b.classList.contains('ui-notice') && !b.closest('dialog,.ui-row,.menu'));   // read, never written: the engine owns the attribute
  if (filters) filters.append(note);
  else if (head) { head.after(note); note.style.paddingInline = getComputedStyle(head).paddingInline; } else surface.prepend(note);
  const end = () => { setArrival(k, null); paint(k); };
  note.querySelector('#arrive-all')?.addEventListener('click', end);
  note.querySelector('#arrive-dismiss')?.addEventListener('click', end);
  note.querySelector('#arrive-fix')?.addEventListener('click', () => { arrival.fixed = true; v.arriveFirst(a); paint(k); });
}

// With a manuscript or a primary study, a page waits for its checks (lib/progress-gate.mjs) so nothing appears in two steps; a failure is said, retried after 10 s.
let checksWaiting = false, checksFailedAt = 0, checksFailure = '';
const checksFailed = err => { checksFailedAt = Date.now(); checksFailure = err.message; console.warn('[checks]', err.message); };
const sayChecksFailure = () => { if (checksFailedAt && Date.now() - checksFailedAt < 10e3) subtitle.textContent = `${checksFailure}. The page leaves them out.`; };
function holdForChecks() {
  if (!checksNeeded() || Date.now() - checksFailedAt < 10e3) return false;
  if (!checksWaiting) {
    checksWaiting = true;
    ensureChecks().then(() => refreshCounts(), checksFailed)
      .finally(() => { checksWaiting = false; if (VIEWS[currentKey]) { paint(currentKey); sayChecksFailure(); } });
  }
  return true;
}
function paint(k) {
  if (holdForChecks()) return;
  if (k === 'mcp') { VIEWS.settings?.showMcp(); currentKey = k = 'settings'; }
  repaintStatus();
  const v = VIEWS[k];
  if (!v) { if (LOAD[k]) viewOf(k).then(() => paint(k)); return; }
  // A repaint after an action keeps the view's and each panel's scroll.
  const same = painted === k && view.children.length > 0;
  const keep = same ? snapshotScroll(view) : null;
  // A menu belongs to the page it was opened on: moving to another view closes it (a title-bar menu would otherwise float over the next page).
  if (!same) closeMenu();
  if (painted === 'files') VIEWS.files.unmount(k === 'files');
  else if (painted === 'dashboard') { if (k !== 'dashboard') VIEWS.dashboard.unmount(); }
  else if (UNMOUNTS.has(painted)) VIEWS[painted].unmount(k === painted);   // true: the same view repaints, so a sub-page it holds stays open
  // (All projects opens on the portfolio the next time it is pressed.)
  painted = k;
  // a document closes on moving to a view with no use for it, never on a repaint of the same view
  if (openPaper && !v.usesDocument && !same) closeDocument();
  navButtons().forEach(b => {
    if (b.dataset.k === k) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  subtitle.textContent = '';
  keyHandler = null;
  // A view declares its own shape. 'sheet' pages are a form read top to bottom
  // and render into one ruled surface; everything else fills the frame.
  view.className = 'view' + (v.meta.layout ? ` ${v.meta.layout}` : '');
  view.innerHTML = '';
  // The message an action reports is set after the repaint, which clears it. A view's page() declares its head (title, status, view switch,
  // Back, actions, overflow) and the shell's title bar draws it (a view without a page() is a BarSpecError in dev).
  // A view whose list is its page's switch in one pane (list.inBar: Reporting's sections) is told which it is: the list pane, or the title bar.
  pagedSingle = split.classList.contains('single');
  const offered = pageOf(v, msg => { paint(k); subtitle.textContent = msg || ''; refreshCounts(); }, { single: !!v.list?.inBar && pagedSingle });
  // the page's head, kept so a full-screen chat can stand in the bar and give it back as it was
  pageHead = {
    ...headOf(offered), title: k === 'overview' && !projectMode(get()) ? 'New project' : offered.title,
  };
  // another page starts without the last one's list Back; arrange() gives this one its own
  topbar.set({ ...(assistExpanded ? CHAT_HEAD : pageHead), ...(same ? {} : { listBack: false, item: '' }) });
  let surface = view;
  if (v.meta.layout === 'sheet') {
    surface = document.createElement('div');
    surface.className = 'sheet-col';
    view.append(surface);
  }
  mountList(v, k);
  v.render(surface, ctx);
  enhancePageUi(surface);
  rememberPage();
  menuSync();
  showAidBtn();
  arrange();
  // A list view opens with its inspector when there is room to dock it.
  // A view with nothing to show does not open it, and closes it if the last view left it open; the panel button still opens it there.
  const hasDetails = detailsAvailable(v);
  if (v.list && hasDetails && inspWanted && !assistOpen() && !split.classList.contains('insp-over')) { toggleAssist(true, 'details'); arrange(); }
  else if (!hasDetails && assistOpen() && assistTab === 'details' && !inspOnDemand && !studyPeek) { toggleAssist(false, null, true); arrange(); }
  // The arrival notice, once the panes are arranged: where it goes depends on whether a single pane shows the list.
  document.getElementById('arrive')?.remove();   // one in the list pane outlives the page's own markup
  if (arrival?.view === k) drawArrival(surface, k);
  numericColumns(surface);
  // a view that moved to a page of its own says where it opens (Tables and figures: an item at its top, the list back at its place)
  const at = v.scrollPlace?.(keep?.top ?? 0);
  if (at != null) { if (keep) keep.top = at; else view.scrollTop = at; }
  restoreScroll(view, keep);
  // The chat follows the current selection.
  if (assistOpen()) followFocusScope();
  refreshCounts();
  if (assistOpen()) drawAssist();
  if (!performance.getEntriesByName('lykos:first-view').length) performance.mark('lykos:first-view');
}

// ---- list · detail · inspector ----------------------------------------------
// A view that has items exports `list` ({ title?, items(state), filters?(el,
// refresh), empty? }), `select(id)` and `selected()`; its render() draws the
// selected item, and inspect() gives the inspector's Details for it. A view
// without a list fills the work area as before.
const plist = document.getElementById('plist');
const plistBody = document.getElementById('plist-body');
const plistGrip = document.getElementById('plist-grip');
let listKey = null;            // the view whose list is mounted
let enterList = false;
let listFocus = false;         // a view in focus mode (the document alone): the list pane and its grip are hidden
let pane = 'list';             // single-pane mode: which pane shows
let pagedSingle = false;       // whether the last paint saw one pane (a list.inBar view declares its switch by it)
const listCtl = createList({
  body: plistBody, space: document.getElementById('plist-space'),
  onSelect: id => selectItem(id),
  onOpen: () => { if (split.classList.contains('single')) { pane = 'detail'; arrange(); } },
  // Space: the record's PDF beside the list, and Space again puts it away.
  onPreview: id => {
    const p = (get().papers || []).find(x => x.id === id);
    if (!p?.pdf) { subtitle.textContent = 'No PDF for this record'; return; }
    if (openPaper === id) closeDocument(); else openDocument(id);
  },
});

function selectItem(id) {
  const v = VIEWS[currentKey]; if (!v?.list) return;
  if (v.selected?.() === id && !split.classList.contains('single')) return;
  studyPeek = null;
  v.select(id);
  listCtl.setSelected(id);
  pane = 'detail';
  paint(currentKey);
  view.scrollTop = 0;
}

let plistActs = new Map();
document.getElementById('plist-head').addEventListener('click', e => { const b = e.target.closest('button[id]'); if (b) plistActs.get(b.id)?.(b); });
function mountList(v, k) {
  // a list that is empty and says so (hideEmpty) leaves the page whole: its empty state stands alone, not beside an empty pane
  if (!v.list || (v.list.hideEmpty && !v.list.items(get()).length)) { plist.hidden = true; plistGrip.hidden = true; listKey = null; return; }
  // `index`: a list that is a page's table of contents (Protocol's parts), not a collection: a fixed narrow column, nothing to resize
  plist.hidden = listFocus; plistGrip.hidden = listFocus || !!v.list.index; plist.toggleAttribute('data-index', !!v.list.index);
  if (listKey !== k) {
    listKey = k; pane = v.list.inBar ? 'detail' : enterList ? 'list' : v.selected?.() ? 'detail' : 'list'; enterList = false;
    // The rail always names what it lists and counts it; its own actions (add,
    // filter, history) sit at its right, whatever the view. Nothing hides the title.
    const f = document.getElementById('plist-filter'); f.innerHTML = '';
    v.list.filters?.(f, () => { refreshList(); paint(currentKey); });
    // the head is one head bar: title, count, and the view's own acts (list.acts: [{ id, label, icon, iconOnly, role, menu, run(button) }])
    const acts = v.list.acts?.(() => { refreshList(); paint(currentKey); }) || [];
    plistActs = new Map(acts.map(a => [a.id, a.run]));
    // a list whose title is a choice (Screening: To decide, Decided, All) declares titleMenu(button, refresh): the title is a picker
    if (typeof v.list.titleMenu === 'function') plistActs.set('plist-title', b => v.list.titleMenu(b, () => { refreshList(); paint(currentKey); }));
    plist.toggleAttribute('data-no-acts', !acts.length);
    document.getElementById('plist-head').innerHTML = uiBar({ kind: 'head', label: 'List', id: 'plist-bar', lead: { title: v.list.title || v.meta.title, level: 'h2', id: 'plist-title', ...(typeof v.list.titleMenu === 'function' ? { menu: true } : {}) },
      status: { id: 'plist-count', text: '', ch: 4 }, actions: acts.map(({ run, ...a }) => a) });
    plistBody.scrollTop = 0;
  }
  refreshList();
}

// What the list last drew, and from which view and store version: a store
// update that arrives after a paint already refreshed the list is skipped, and
// items identical to those shown are not drawn again.
let listSig = '', listShown = null, listSel = null, listAt = 0;
const ITEM_KEYS = ['id', 'kind', 'title', 'sub', 'year', 'meta', 'mark', 'markTone'];
const sameItems = (a, b) => a && b && a.length === b.length && a.every((x, i) => ITEM_KEYS.every(k => x[k] === b[i][k]));
function refreshList() {
  const v = VIEWS[currentKey]; if (!v?.list || plist.hidden) return;
  listSig = `${currentKey}|${getVersion()}`; listAt = performance.now();
  const items = v.list.items(get()), rows = items.filter(x => !x.group);
  // The rail names what it lists on every refresh: a view whose title follows a section (a getter) is read again here.
  { const t = document.getElementById('plist-title'); (t?.querySelector(':scope > span') || t).textContent = v.list.title || v.meta.title; }   // a title that is a picker keeps its chevron
  plist.toggleAttribute('data-title-duplicate', !v.list.title || v.list.title === (v.heading?.() || v.meta.title));
  // an unnamed, uncounted list is the page's one collection: no pane head (TOPBAR R9)
  plist.toggleAttribute('data-no-head', !v.list.title && v.list.count === false);
  document.getElementById('plist-count').textContent = v.list.count === false ? '' : typeof v.list.count === 'function' ? v.list.count(rows) || '' : rows.length || '';   // a list may count only its own rows (not its tools)
  let sel = v.selected?.();
  // Wide, something is always open (a group label is not an item); single-pane, the list comes first.
  if ((!sel || !rows.some(x => x.id === sel)) && rows.length && !split.classList.contains('single') && pane !== 'list-only') {
    sel = rows[0].id; v.select(sel);
  }
  if (sel !== listSel || !sameItems(items, listShown)) listCtl.setItems(items, sel, v.list.rowHeight);
  listShown = items; listSel = sel;
  plistBody.querySelector(':scope > .empty-state')?.remove();
  if (!items.length) plistBody.insertAdjacentHTML('afterbegin', emptyState({ title: v.list.empty || 'Nothing here', size: 'inline' }));
}
// A store update refreshes the list at most every LIST_GAP ms: typing in an
// item's detail would otherwise rebuild every item (the screening queue over
// all records) on every frame. The last update is always drawn.
const LIST_GAP = 150;
let listQueued = false;
const listFromStore = () => {
  listQueued = false;
  if (!listKey || listSig === `${currentKey}|${getVersion()}`) return;
  const wait = LIST_GAP - (performance.now() - listAt);
  if (wait > 0) { listQueued = true; setTimeout(() => requestAnimationFrame(listFromStore), wait); return; }
  refreshList();
};
subscribe(() => { if (listKey && !listQueued) { listQueued = true; requestAnimationFrame(listFromStore); } });

function backToList() { pane = 'list'; arrange(); listCtl.focus(); }

// Which panes show, by the room the work area actually has: one pane (list or
// item) when two would not fit; the inspector docked while the item keeps
// 520px beside it, laid over the work when not, a sheet when even that is tight.
const INSP_W = 400;
const ITEM_MIN = 520;   // the item beside a docked inspector
const ITEM_READ = 360;  // the item beside the list at all
/** The document pane's width as set (--doc-w, or 42%), within its CSS limits. */
function docWidth(W) {
  const set = docpane.style.getPropertyValue('--doc-w').trim();
  const w = set.endsWith('%') ? W * parseFloat(set) / 100 : parseFloat(set) || W * 0.42;
  return Math.max(300, Math.min(w, W * 0.68));
}
let inspOnDemand = false;   // the panel was opened by hand on a view with no details of its own
/** Whether a view has Details to show now (a peeked study counts). */
function detailsAvailable(v) {
  if (studyPeek || chatPeek) return true;
  if (reader.inspect?.().length) return true;
  if (typeof v?.inspect !== 'function') return false;
  try { return (v.inspect(ctx) || []).length > 0; } catch { return false; }
}
let inspWanted = true;
try { inspWanted = localStorage.getItem('lykos.insp') !== 'closed'; } catch {}
let detailShown = false;
function arrange() {
  const W = split.getBoundingClientRect().width; if (!W) return;
  if (assistExpanded) {
    split.classList.remove('single', 'show-list', 'show-detail', 'insp-over', 'insp-sheet');
    topbar.setPressed(true); return;
  }
  const hasList = !plist.hidden;
  // Widths as set, not as shown: a pane single-pane mode hides still counts,
  // so the choice below cannot flip back and forth as it hides and shows them.
  const docW = docpane.hidden || docpane.dataset.leaving != null ? 0 : docWidth(W);
  const listW = !hasList ? 0 : plist.hasAttribute('data-index') ? INDEX_W : Math.min(Math.max(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--list-w')) || 320, 240), W * 0.46);
  // One pane when the item would be left narrower than it can be read.
  const single = hasList && (W < 880 || W - listW - docW < ITEM_READ);
  split.classList.toggle('single', single);
  split.classList.toggle('show-list', single && pane === 'list');
  split.classList.toggle('show-detail', single && pane !== 'list');
  if ((single && pane !== 'list') !== detailShown) { detailShown = !detailShown; if (detailShown) navHistory?.step('detail', backToList); else navHistory?.drop('detail'); }
  // one pane, the detail: a Back, the title names the item under its list (not where showsItem() is false); list.inBar has no Back (its switch navigates)
  const inBar = !!VIEWS[currentKey]?.list?.inBar;
  topbar.setBack(single && pane !== 'list' && !inBar, single && pane !== 'list' && !inBar && VIEWS[currentKey]?.showsItem?.() !== false ? (listShown || []).find(x => !x.group && x.id === listSel)?.title : '');
  if (inBar && single !== pagedSingle) { pagedSingle = single; queueMicrotask(() => paint(currentKey)); }
  split.classList.toggle('insp-over', W - (single ? 0 : listW) - docW - INSP_W < ITEM_MIN);
  split.classList.toggle('insp-sheet', W < 480);
  topbar.setPressed(assistOpen());
}
watchWidth(split, arrange, { now: true });
// The panel button opens and closes the panel on the tab last used; the
// sparkle goes to the chat. Pressing the panel button while the chat showed
// used to switch to Details rather than close, so the button read as off with
// the panel open.
function toggleInspector() {
  const open = !assistOpen();
  inspOnDemand = open && !detailsAvailable(VIEWS[currentKey]);
  inspWanted = open; try { localStorage.setItem('lykos.insp', open ? 'open' : 'closed'); } catch {}
  toggleAssist(open); arrange();
}

// The list's width, dragged like the sidebar's and remembered.
const LIST_W_KEY = 'lykos.listWidth';
const setListW = w => { const px = Math.round(Math.min(Math.max(w, 240), innerWidth * 0.46)); document.documentElement.style.setProperty('--list-w', `${px}px`); };
try { const w = +localStorage.getItem(LIST_W_KEY); if (w) setListW(w); } catch {}
plistGrip.addEventListener('pointerdown', e => {
  e.preventDefault(); plistGrip.setPointerCapture(e.pointerId); document.body.classList.add('resizing-list');
  const left = plist.getBoundingClientRect().left;
  const move = ev => { setListW(ev.clientX - left); arrange(); };
  const up = () => { plistGrip.removeEventListener('pointermove', move); plistGrip.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing-list'); try { localStorage.setItem(LIST_W_KEY, Math.round(plist.getBoundingClientRect().width)); } catch {} };
  plistGrip.addEventListener('pointermove', move); plistGrip.addEventListener('pointerup', up);
});
plistGrip.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); setListW(plist.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16)); arrange();
  try { localStorage.setItem(LIST_W_KEY, Math.round(plist.getBoundingClientRect().width)); } catch {}
});

let studyPeek = null;   // a study opened from a table or figure, shown above the view's own Details
// Closed by Escape or its More's Close study: Details goes back to what the view says about its own selection.
const closeStudyPeek = () => { studyPeek = null; drawDetails(); };
/** The inspector's Details: what the view says about the selected item. */
function drawDetails() {
  const v = VIEWS[currentKey];
  let secs = [];
  try { secs = v?.inspect?.(ctx) || []; } catch (err) { console.warn('[inspect]', err); }
  try { secs = [...(reader.inspect?.() || []), ...secs]; } catch (err) { console.warn('[inspect]', err); }
  if(chatPeek){
    const turns=chatPeek.savedBlock ? [{blocks:[chatPeek.savedBlock]}] : chatPeek.threadId ? (get().threads||[]).find(t=>t.id===chatPeek.threadId)?.messages||[] : assistant.turns(),b=turns[chatPeek.turn]?.blocks?.[chatPeek.block];
    const back=uiBar({kind:'head',density:'dense',label:'Preview navigation',id:'chat-detail-nav',lead:{back:{id:'chat-detail-back',label:'Chat'}},actions:[{id:'chat-detail-page',label:'Page details',role:'quiet'}]});
    if(chatPeek.record){const p=chatPeek.record;secs=[{title:'Study preview',html:back+`<div class="research-artifact"><h4>${esc(p.title)}</h4><p class="meta">${esc([p.authors?.join(', '),p.journal,p.year].filter(Boolean).join(' · '))}</p><p>${esc(p.abstract||'No abstract was returned by this source.')}</p><button data-chat-add-record>Add to Library</button></div>`,wire:host=>host.querySelector('[data-chat-add-record]').onclick=()=>chatBlockActions(turns).add(p)}];}
    else if(b && !chatAnswers.ready()) wakeAnswers();   // its drawing code is on the way: the pane draws again when it is here
    else if(b){
      const answers = chatAnswers.module();
      let preview='';
      if(b.type==='artifact'&&b.artifact.kind==='infographic'){
        const pages=answers.artifactPages(b.artifact);
        preview=disclosure({ title: 'Figure preview', meta: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`, body: `<div class="chat-figure-pages" tabindex="0" role="region" aria-label="Figure pages">${pages.map((p,i)=>`<figure aria-label="Page ${i+1} of ${pages.length}">${p}</figure>`).join('')}</div>` });
      }
      secs=[{html:back+preview+answers.renderAnswerBlocks([b],chatPeek.turn,get(),{detailed:true,offset:chatPeek.block}),wire:host=>answers.wireAnswerBlocks(host,turns,chatBlockActions(turns))}];
    }
    else chatPeek=null;
  }
  let bare = false;   // nothing selected: the pane says so instead of filling the space with figures nobody asked for
  if(!chatPeek){
    const artifacts=conversationArtifacts(get()).slice(-3).reverse();
    bare=!secs.length;
    if(artifacts.length)secs.push({title:'Research deliverables',html:uiList({id:'research-deliverables',label:'Research deliverables',rows:artifacts.map(a=>uiRow({main:{html:`<button type="button" class="tk-text" data-research-artifact="${esc(a.id)}" data-thread-id="${esc(a.threadId||'')}">${esc(a.artifact.title)}</button>`,detail:[a.artifact.kind],wrap:true}}))}),wire:host=>host.querySelectorAll('[data-research-artifact]').forEach(b=>b.onclick=()=>showResearchRecord(b.dataset.researchArtifact))});
  }
  const focusedPaperId = !chatPeek && v?.focus?.()?.paperId;
  const detailPaperId = studyPeek?.id || focusedPaperId;
  const peeked = detailPaperId && (get().papers || []).find(x => x.id === detailPaperId);
  // Selected papers and explicit study links share the same header above page-specific details.
  if (peeked && !studyPanel.ready()) studyPanel.ensure().then(() => drawDetails(), err => { subtitle.textContent = err.message; });
  if (peeked && studyPanel.ready()) {
    secs = secs.filter(sec => sec.paperId !== peeked.id);
    // the study draws its own head; one opened from a table (a peek) has Close study in its More, as Escape
    const peek = studyPeek?.id === peeked.id;
    secs.unshift(studyPanel.module().studySection(peeked, ctx, peek ? studyPeek.hasDoc : undefined, { closable: peek }));
  } else if (!peeked) studyPeek = null;
  const empty = bare && !peeked ? emptyState({ title: v?.inspect || v?.list ? 'Select a record' : 'No details', size: 'inline' }) : '';
  if (!secs.length) { assistLog.innerHTML = empty; return; }
  // A redraw after an action in the pane or the view keeps what the reader opened and where they had scrolled.
  const keep = assistLog.querySelector('.insp-sec') ? snapshotScroll(assistLog) : null;
  assistLog.innerHTML = empty + secs.map((x, i) => `<section class="insp-sec" data-sec="${i}">
    ${x.title ? `<div class="insp-head"><h3>${esc(x.title)}</h3>${x.meta ? `<span class="meta">${esc(x.meta)}</span>` : ''}</div>` : ''}
    <div class="insp-body">${x.html || ''}</div></section>`).join('');
  assistLog.querySelector('[data-peek-close]')?.addEventListener('click', closeStudyPeek);
  assistLog.querySelector('#chat-detail-back')?.addEventListener('click',()=>{const id=chatPeek?.threadId;if(id)changeChat(()=>assistant.selectSession(id));chatPeek=null;toggleAssist(true,'chat');});
  assistLog.querySelector('#chat-detail-page')?.addEventListener('click',()=>{chatPeek=null;drawDetails();assistLog.scrollTop=0;});
  secs.forEach((x, i) => { try { x.wire?.(assistLog.querySelector(`[data-sec="${i}"] .insp-body`), ctx); } catch (err) { console.warn('[inspect]', err); } });
  enhancePageUi(assistLog);
  restoreScroll(assistLog, keep);
}

// ---- sidebar width ---------------------------------------------------------
// The search control and tabs need 224px; cap the other end so the work area
// remains useful. A previously saved narrower width is clamped on load.
const grip = document.getElementById('side-grip');
const SIDE_W_KEY = 'lykos.sideWidth';
const setSideW = w => {
  const px = Math.round(Math.min(Math.max(w, 224), Math.min(360, innerWidth * 0.4)));
  document.documentElement.style.setProperty('--side-w-user', `${px}px`);
  return px;
};
try { const w = +localStorage.getItem(SIDE_W_KEY); if (w) setSideW(w); } catch {}
const keepSideW = () => { try { localStorage.setItem(SIDE_W_KEY, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w-user'))); } catch {} };
grip.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); grip.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing-side');
  const move = ev => setSideW(ev.clientX);
  const up = () => {
    grip.removeEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.removeEventListener(type, up);
    document.body.classList.remove('resizing-side'); keepSideW(); reader.reflow?.();
  };
  grip.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(type, up);
});
grip.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--side-w-user'); try { localStorage.removeItem(SIDE_W_KEY); } catch {} });
grip.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setSideW(document.querySelector('aside').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 48 : 16));
  keepSideW();
});

/** A folder action whose failure is said in the toolbar rather than lost. */
async function folderAction(fn) {
  try { await fn(); }
  catch (err) { closeDrawer(); subtitle.textContent = `Folder not opened: ${String(err?.message || err).replace(/^Failed to execute '\w+' on '\w+': /, '').slice(0, 120)}`; }
}

// ---- projects and the sidebar's two modes -------------------------------
// The sidebar shows either the review's steps or the project folder. The
// choice is per machine; the rail has room for neither label nor tree, so it
// always shows the steps.
const treeEl = document.getElementById('tree');
const tabs = document.getElementById('side-tabs');
const MODE_KEY = 'lykos.sidemode';
try { sideMode = localStorage.getItem(MODE_KEY) === 'files' ? 'files' : 'review'; } catch {}
function setSideMode(m, { chosen = false } = {}) {
  sideMode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch {}
  // Asking for the files from the rail widens it, when the window has room.
  // Only when asked: at startup a narrow window stays a rail.
  if (chosen && m === 'files' && document.documentElement.dataset.side === 'rail') toggleSide();
  tabs.querySelectorAll('[data-side-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sideMode === m)));
  nav.hidden = m === 'files';
  if (m === 'files') {
    treeEl.focus({ preventScroll: true });
    explorerAtLoad = explorer.ensure().then(tree => { if (sideMode === 'files') tree.setVisible(true); }, err => { subtitle.textContent = err.message; });
  } else explorer.module()?.setVisible(false);
  menuSync();
}
tabs.querySelector('[data-side-mode="files"]').insertAdjacentHTML('afterbegin', icon('folder'));
tabs.onclick = e => { const b = e.target.closest('[data-side-mode]'); if (b) setSideMode(b.dataset.sideMode, { chosen: true }); };
tabs.onkeydown = tabArrows('[data-side-mode]');

const projName = document.getElementById('proj-name');
const titleOf = () => projectName(get());
function projectLabel() {
  const c = projects.current();
  if (!projectMode(get())) return titleOf() || c.name || 'New project';   // during setup, the name given in New project
  return titleOf() || (c.kind !== 'local' && c.name) || projects.activeFolder()?.name || 'Untitled review';
}
function projectMenu() {
  const cur = projects.currentId();
  const list = projects.switchList();
  if (!list.some(p => p.id === cur)) list.unshift(projects.current());
  const label = p => p.id === cur ? projectLabel() : (p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project'));
  // ---- project folders: the list, then New/Open/Close, the folder, and Manage projects
  showMenu(document.getElementById('proj'), [
    ...list.slice(0, 12).map(p => ({ label: label(p), checked: p.id === cur,
      meta: ['local', 'app'].includes(p.kind) ? 'App storage' : p.kind === 'path' ? p.path.split('/').slice(-2, -1)[0] || '' : 'Folder',
      run: () => p.id !== cur && projects.open(p.id) })),
    '-', ...projectItems(),
  ].filter(Boolean), { className: 'project-menu', minWidth: 300 });
}
// The project commands of the project menu and the palette: no folder entries where folders cannot be opened (a hosted tab).
function projectItems() {
  const folders = canOpenFolders(), f = projects.activeFolder();
  return [
    { label: 'All projects', icon: 'projects', run: () => go('dashboard') },
    { label: 'New project', icon: 'plus', run: () => folderAction(() => projects.newProject()) },
    { label: 'Import project…', icon: 'import', run: () => menuCommand('restore') },
    folders && { label: 'Open project', icon: 'folder', meta: '⌘O', run: () => folderAction(() => projects.openFolder()) },
    folders && inDesktop() && { label: 'Add projects from folder…', icon: 'folder-plus', run: () => folderAction(async () => { const report = await projects.addProjectCollection(null, { chooser: async (found, folder) => (await import('./views/folder-import-dialog.mjs')).chooseProjects(found, folder, { title: 'Add projects', confirm: 'Add' }) }); if (report) { ctx.rerender(projects.collectionMessage(report)); } }) },
    { label: 'Close project', icon: 'close', run: () => folderAction(() => projects.closeProject()) },
    '-',
    !projects.isNone() && { label: 'Export project…', icon: 'export', run: () => menuCommand('backup') },
    f && { label: 'Project folder', icon: 'folder', run: () => go('folder') },
    folders && ['local', 'app'].includes(projects.current().kind) && { label: 'Move to folder', icon: 'upload', run: () => folderAction(() => projects.saveLocalToFolder(get())) },
    f?.can.reveal && { label: 'Show in Finder', icon: 'folder', run: () => f.reveal('') },
    { label: 'Manage projects', icon: 'settings', run: () => { go('settings:projects'); } },
  ].filter(Boolean);
}
function wireProjects() {
  document.getElementById('proj').onclick = e => { e.stopPropagation(); projectMenu(); };
  // The label reads the recent-projects list from localStorage; a store update
  // (every keystroke) only reaches it once a frame, and only when what the
  // label is made of has changed.
  let shownSig = null, syncQueued = false;
  const sync = () => {
    syncQueued = false;
    const title = titleOf();
    const sig = `${title}\u0000${projectMode(get()) || ''}\u0000${projects.activeFolder()?.name || ''}`;
    if (sig === shownSig) return;
    shownSig = sig;
    const label = projectLabel();
    projName.textContent = label;
    document.title = `${label} · Lykos`;
    syncWindowDoc();
    projects.describe(projects.currentId(), { name: title, type: projectMode(get()) ? researchType(get()).label : '',
      blank: !projectMode(get()) && !(get().papers || []).length && !get().project });
  };
  subscribe(() => { if (!syncQueued) { syncQueued = true; requestAnimationFrame(sync); } }); sync();
  wireStatus();
  wirePalette();
  onExplorerLoaded(tree => tree.mount(treeEl, {
    openDocument,
    canCloseFolder: rel => VIEWS.files?.canCloseFolder(rel),   // no Files page loaded: nothing of it is open
    showFile: async (rel, how) => { (await viewOf('files')).show(rel, how); if (currentKey !== 'files') go('files'); },
    openFile: async () => (await viewOf('files')).pickFile(() => { if (currentKey !== 'files') go('files'); }),
    say: msg => { subtitle.textContent = msg || ''; },
    // The repaint clears the topbar message; the action's own report outlives it.
    changed: () => { const said = subtitle.textContent; refreshCounts(); paint(currentKey); subtitle.textContent = said; },
    moved: (from, to) => { viewOf('files').then(f => f.moved(from, to)); },

  }));
  setSideMode(sideMode);
}

// ---- status bar ------------------------------------------------------------
function wireStatus() {
  const readChatSpend = createChatSpendReader();
  const $ = id => document.getElementById(id);
  // One status line: what is true of the project drops whole, rightmost and least important first, when the window narrows; the
  // controls at its end (proposals, unverified values, the model, usage, commands) are real buttons and never drop.
  $('status').innerHTML = uiStatusLine({ id: 'status-line', label: 'Project status', parts: [
    { id: 'st-save', text: 'Saved', drop: 0, attrs: { 'data-status': 'save' } },
    { id: 'st-backup', text: 'Safety copy failed', button: true, hidden: true, drop: 1 },
    { id: 'st-export', text: 'Export due', button: true, hidden: true, drop: 1 },
    { id: 'st-where', text: 'App storage', drop: 7 },
    { id: 'st-stage', text: '', hidden: true, drop: 6 },
    { id: 'engine', text: '', hidden: true, drop: 4 },
    { id: 'st-job', text: '', hidden: true, drop: 2, attrs: { 'data-status': 'job' } },
    { id: 'st-batch', text: '', hidden: true, drop: 2, button: true, attrs: { 'data-status': 'batch', 'aria-haspopup': 'menu' } },
  ], actions: [
    { id: 'st-props', label: 'Proposals', icon: 'proposals' },
    { id: 'st-verify', label: 'Unverified', icon: 'check-square' },
    { id: 'st-model', label: 'No model', icon: 'models', menu: true },
    { id: 'st-plan-usage', label: 'Usage', icon: 'gauge' },
    { id: 'st-palette', label: 'Commands', icon: 'search', kbd: '\u2318K', iconOnly: true },
  ] });
  for (const id of ['st-props', 'st-verify', 'st-plan-usage']) $(id).hidden = true;
  // A button's words change with the count; its accessible name follows.
  const say = (el, text) => { el.querySelector('.ui-act-label').textContent = text; el.setAttribute('aria-label', text); };
  const saveEl = $('st-save'), where = $('st-where'), job = $('st-job'), batchBtn = $('st-batch'), verify = $('st-verify'), model = $('st-model');
  const stage = $('st-stage'), props = $('st-props');
  // A failed save says why and offers Retry (once per reason); a saved one takes the notice away. Model keys that the shell's credentials
  // file refused are their own notice: the project itself was written.
  const reportSave = st => {
    if (st === 'failed') showShellNotice({ id: 'save-failed', label: 'Not saved', text: saveFailedText(saveError()), actions: [{ id: 'save-retry', label: 'Retry', run: retrySave }] });
    else hideShellNotice('save-failed');
    if (credentialsError()) showShellNotice({ id: 'keys-failed', label: 'Model keys not saved', text: `Model keys not saved: ${credentialsError()}`, actions: [{ id: 'keys-retry', label: 'Retry', run: retrySave }] });
    else hideShellNotice('keys-failed');
  };
  const showSave = st => {
    saveEl.dataset.state = st;
    saveEl.textContent = st === 'failed' ? 'Not saved' : st === 'saving' ? 'Saving' : 'Saved';
    saveEl.title = st === 'failed' ? saveError() : '';
    reportSave(st);
    const safety = backupState(), health = $('st-backup');
    health.hidden = safety.status !== 'failed'; health.title = safety.error || '';
  };
  $('st-backup').onclick = () => { go('settings:project'); };
  onSaveState(showSave); showSave(saveState());
  const f = projects.activeFolder();
  where.textContent = f ? f.name : 'App storage';
  where.title = f?.kind === 'path' ? f.root : '';
  let queued = false;
  const paintStatus = () => {
    queued = false;
    const s = get();
    const r = runningJobs();
    // a batch extraction that stopped, or that the app closed on, says what is left and offers to take it up again
    const again = r.length ? null : batchOf()?.resumableBatch(s) ?? null;
    job.hidden = !r.length && !again;
    job.setAttribute('aria-busy', String(r.length > 0));
    const live = r.some(j => j.kind === 'extract');
    batchBtn.hidden = !live && !again;
    batchBtn.textContent = live ? 'Stop' : again ? 'Resume' : '';
    batchBtn.dataset.mode = live ? 'stop' : 'resume';
    if (!r.length && again) job.textContent = `Extraction stopped \u00b7 ${again.left ? `${again.left} ${again.left === 1 ? 'study' : 'studies'} left` : `${again.carried} to check`}`;
    if (r.length) {
      // One progress idiom: the ring, the job's name and its count ("12 of 65").
      const j = r[0], count = j.progress ? String(j.progress) : j.total ? `${j.done || 0} of ${j.total}` : '';
      job.innerHTML = `<span class="ui-progress-ring" aria-hidden="true"></span>${esc(j.label)}${count ? `${/^\d+ (?:of|\/) \d+$/.test(count) ? ' ' : ' · '}${esc(count)}` : ''}${r.length > 1 ? ` · ${r.length - 1} more` : ''}`;
    }
    // Where the open view's stage stands, in the funnel's own numbers.
    const at = funnel(s).filter(f => f.key === currentKey && f.n != null);
    stage.textContent = at.map(f => f.pool != null ? `${f.name} ${f.n.toLocaleString()} of ${f.pool.toLocaleString()}` : `${f.name} ${f.n.toLocaleString()}`).join(' · ');
    stage.hidden = !stage.textContent;
    const held = aidOpen(), batched = batchMod ? batchMod.batchProposalCount(s) : batchPresent(s) ? null : 0;
    if (held != null && batched != null) {
      const open = held + batched;
      props.hidden = !open;
      say(props, `${open} ${open === 1 ? 'proposal' : 'proposals'}`);
    }
    const un = unverifiedCount(s);
    verify.hidden = !un.total;
    say(verify, `${un.total} unverified`);
    verify.dataset.go = un.values ? 'extraction' : un.patients ? 'patients' : un.footnotes ? 'certainty' : 'overview';
    const cfg = assistant.sessionProfile(settings.profiles(), settings.modelFor('chat'));
    // Today's spend on model calls, where the provider reports it.
    const today = new Date().toISOString().slice(0, 10);
    const spent = readChatSpend(s, getVersion(), today);
    say(model, modelConfigured(cfg) ? `${shortModel(cfg.model)}${cfg.effort ? ` · ${effortLabel(cfg.effort)}` : ''}${cfg.provider === 'chatgpt' ? ' · ChatGPT plan' : ''}${cfg.provider !== 'chatgpt' && spent ? ` · $${spent < 0.01 ? spent.toFixed(4) : spent.toFixed(2)} today` : ''}` : 'No model');
    model.title = modelConfigured(cfg) ? `${cfg.model} · Effort: ${effortLabel(cfg.effort)} · Change chat or task models` : 'Choose chat or task models';
    const planUsage = $('st-plan-usage');
    planUsage.hidden = cfg.provider !== 'chatgpt';
    say(planUsage, chatGptUsageState(cfg.id).kind === 'limited' ? 'Usage limit reached' : 'Usage');
  };
  subscribe(() => { if (!queued) { queued = true; requestAnimationFrame(paintStatus); } });
  aid.onChange(() => { if (!queued) { queued = true; requestAnimationFrame(paintStatus); } });
  props.onclick = () => toggleAssist(!(assistOpen() && assistTab === 'proposals'), 'proposals');
  batchBtn.onclick = () => {
    batchLoad().then(m => {
      if (batchBtn.dataset.mode === 'stop') { m.stopBatch(); return; }
      const r = m.resumableBatch(); if (!r) return;
      showMenu(batchBtn, [{ label: 'Resume extraction', run: () => m.resumeBatch(ctx) }, { label: 'Dismiss', run: () => { m.dismissBatch(); repaintStatus(); } }], { align: 'start' });
    }, batchFailed);
  };
  repaintStatus = () => { if (!queued) { queued = true; requestAnimationFrame(paintStatus); } };
  onProgress(() => {
    if (!queued) { queued = true; requestAnimationFrame(paintStatus); }
  });
  paintStatus();
  verify.onclick = () => go(verify.dataset.go || 'extraction');
  model.onclick = e => bottomModelMenu(e.currentTarget);
  $('st-plan-usage').onclick = e => {
    const cfg = assistant.sessionProfile(settings.profiles(), settings.modelFor('chat'));
    const usage = recordedChatGptUsage(get(), cfg.id), state = chatGptUsageState(cfg.id);
    showMenu(e.currentTarget, [
      { label: state.kind === 'limited' ? 'ChatGPT usage limit reached' : 'Remaining plan balance: unavailable from API', disabled: true },
      { label: `Recorded here today: ${usage.calls} calls · ${usage.tokens.toLocaleString()} tokens${usage.incomplete ? ' (partial)' : ''}`, disabled: true },
      '-', { label: 'Manage ChatGPT usage', run: () => openChatGptUsage() },
    ]);
  };
  $('st-palette').onclick = () => palette.open();
}

// ---- command palette -------------------------------------------------------
// Everything reachable from one field. Each source is asked when the palette
// opens, so what it offers is the project as it is at that moment.
function wirePalette() {
  document.getElementById('global-search').onclick = () => palette.open();
  palette.addSource(() => [...railKeys(), 'settings'].map((k, i) => ({
    label: REGISTRY[k].meta.title, group: 'Go to', icon: REGISTRY[k].meta.icon, meta: k === 'settings' ? '⌘,' : i < 9 ? `⌘${i + 1}` : '', rank: 1, run: () => go(k) })));
  palette.addSource(() => [
    ...projectItems().filter(x => x !== '-'),
    { label: sideMode === 'files' ? 'Show review steps' : 'Show files', icon: sideMode === 'files' ? 'navigation' : 'folder', meta: '⌘⇧E', run: toggleFiles },
    { label: 'Assistant', icon: 'assistant', meta: '⌘J', run: () => toggleAssist(true) },
    { label: 'Collapse or expand sidebar', icon: 'navigation', meta: '⌘\\', run: toggleSide },
    { label: 'Keyboard shortcuts', icon: 'keyboard', meta: '?', run: toggleShortcuts },
    { label: 'About and licences', icon: 'book', run: () => { go('settings:about'); } },
  ].filter(Boolean).map(x => ({ group: 'Command', rank: 2, ...x })));
  palette.addSource(() => {
    const cur = projects.currentId();
    return projects.switchList().filter(p => p.id !== cur).map(p => ({
      label: p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project'),
      group: 'Project', icon: 'folder', rank: 2, meta: ['local', 'app'].includes(p.kind) ? 'App storage' : '', run: () => projects.open(p.id) }));
  });
  palette.addSource(() => (get().papers || []).map(p => ({
    label: p.label || p.title || p.id, meta: p.title || '', group: 'Record', icon: p.pdf ? 'file-pdf' : 'library', rank: 3,
    keys: [p.label, p.title, p.doi, p.pmid, p.year, p.journal, (p.authors || []).join(' ')].filter(Boolean).join(' '),
    run: () => openStudy(ctx, p.id) })));
  palette.addSource(async () => {
    let tree; try { tree = await explorer.ensure(); } catch (err) { subtitle.textContent = err.message; return []; }
    return (await tree.allFiles()).map(rel => ({
      label: rel.split('/').pop(), meta: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', keys: rel,
      group: 'File', icon: 'file', rank: 4, run: () => tree.openEntry(rel) }));
  });
  palette.addSource(async q => {
    if (!q) return [];
    let memory; try { memory = await projectMemory.ensure(); } catch (err) { subtitle.textContent = err.message; return []; }
    return memory.searchProject(get(), q, { limit: 20 }).map(hit => ({
      ...paletteHit(hit, get()), group: 'Project', icon: 'search', rank: 4, keys: q,
      run: () => openProjectHit(hit) }));
  }, { live: true });
  // The assistant's commands are derived (lib/palette-ai.mjs); the palette's field has the focus, so "this" is read from where it opened.
  palette.addSource(async () => {
    const context = currentContext();
    try { await aid.ensureAid(); } catch (err) { aidFailed(err); return []; }
    const actions = aid.aidNow().actionsFor(currentKey, context), from = palette.openedFrom();
    if (from.selection) heldSelection = from.selection;
    const chatReady = modelConfigured(assistant.sessionProfile(settings.profiles(), settings.modelFor('chat')));
    const send = text => { toggleAssist(true, 'chat'); assistIn.value = text; assistIn.dispatchEvent(new Event('input')); assistSend(); };
    const [paletteAi, ui] = await Promise.all([import('./lib/palette-ai.mjs'), import('./lib/chat-attach-ui.mjs')]);
    return paletteAi.aiCommands({ view: currentKey, actions, menu: pageMenu(currentKey, actions), chatReady, hasModel: task => aid.hasModel(task),
      canAsk: !!ui.focusedTarget(from.el), attached: (attachStore.module()?.attachments() || []).length }, {
      run: id => runAid(id, context), ask: send, open: click => document.getElementById(click)?.click(),
      attach: () => askFocused(from.el), leaveOut: () => attachStore.module()?.clearAttachments(), connect: () => openModelSettings(),
      switchModel: () => { toggleAssist(true, 'chat'); requestAnimationFrame(() => chatModelMenu(toolsAnchor(assistTools.querySelector('#assist-model') || assistTools))); },
    });
  });
  // Anything typed can be asked, last in the list.
  palette.addSource(() => [{ group: 'Assistant', icon: 'assistant', fallback: q => `Ask: ${q}`,
    run: q => { toggleAssist(true); assistIn.value = q; assistIn.dispatchEvent(new Event('input')); assistIn.focus(); } }]);
}

// ---- layout every view shares ----------------------------------------------
// A table column that holds only numbers is set right-aligned in tabular
// figures, header included, as a data table is read. (A panel header is a head
// bar built by uiBar: lib/bar-fit.mjs fits it, so the shell fits nothing.)
function numericColumns(root) {
  const NUM = /^[−-]?[\d.,]+\s*%?$/;
  for (const table of root.querySelectorAll('table')) {
    const rows = [...table.tBodies].flatMap(b => [...b.rows]);
    if (!rows.length) continue;
    const cols = Math.max(...rows.map(r => r.cells.length));
    for (let c = 0; c < cols; c++) {
      const cells = rows.map(r => r.cells[c]).filter(Boolean);
      const filled = cells.filter(td => td.textContent.trim() && td.textContent.trim() !== '—');
      if (filled.length < 2 || !filled.every(td => !td.querySelector('input,select,button,textarea') && NUM.test(td.textContent.trim()))) continue;
      cells.forEach(td => td.classList.add('num'));
      table.tHead?.rows[0]?.cells[c]?.classList.add('num');
    }
  }
}

// ---- keyboard ------------------------------------------------------------
// A shortcut must not fire while someone is typing, and must not collide with
// what the browser or the platform already owns. View switching uses the
// platform modifier with a digit; everything else is a bare key, and bare keys
// are only delivered when focus is not in a field.
const TYPING = el => el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);


/** The shortcut list is a page of Settings (Keyboard), not a panel over the work. */
function toggleShortcuts() { go('settings:keyboard'); }

// The actions a key and a menu item share.
function togglePalette() {
  if (palette.isOpen()) { palette.close(); return; }
  heldSelection = String(getSelection?.() || '').trim();   // the palette's field would take it
  palette.open();
}
function toggleChat() { holdPageSelection(); toggleAssist(!(assistOpen() && assistTab === 'chat'), 'chat'); }
function toggleFiles() { setSideMode(sideMode === 'files' ? 'review' : 'files', { chosen: true }); }

document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'f' && assistExpanded && !document.querySelector('dialog[open]')) {
    e.preventDefault(); toggleChatFind(true); return;
  }

  if (mod && !e.shiftKey && /^[0-9]$/.test(e.key)) {
    const n = Number(e.key);
    const target = n === 0 ? 'settings' : railKeys()[n - 1];
    if (target) { e.preventDefault(); go(target); }
    return;
  }
  if (mod && e.key === '\\') { e.preventDefault(); toggleSide(); return; }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleChat(); return; }
  // ⌥⌘I, as Pages: ⌘I is Italic in the document editor.
  if (mod && e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleInspector(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleFiles(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'o' && canOpenFolders()) { e.preventDefault(); folderAction(() => projects.openFolder()); return; }

  if (TYPING(e.target)) return;
  // The file tree takes its own keys; a letter typed there is not a verdict.
  if (e.target.closest?.('#tree, .menu')) return;

  if (e.key === 'Escape') {
    const sc = document.getElementById('shortcuts');
    if (sc) { sc.remove(); return; }
    if (openPaper) { closeDocument(); return; }
    if (studyPeek) { closeStudyPeek(); return; }
  }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); toggleShortcuts(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (assistExpanded || assistEl.contains(e.target)) return;
  keyHandler?.(e);
});


// ---- the menu bar (desktop) ------------------------------------------------
// Each item runs what the rail, toolbar or keyboard already runs
// (src-tauri/src/app_menu.rs builds the menu from menuState). Wired before the
// project loads, so the start screen has New, Open and Open Recent.
const recentName = p => p.name || (p.kind === 'local' ? 'Untitled review' : p.path?.split('/').pop() || 'Project');
// The start screen (shown instead of the workspace when no project is open) loads only when it is wanted.
const showStart = async () => {
  startOpen = true; menuSync(); syncWindowDoc();
  try { return await (await import('./views/start.mjs')).show({ close: quitApp }); }
  catch (err) { console.warn('[start]', err); subtitle.textContent = `Could not show the start screen: ${err.message}`; }
};
function menuState() {
  const none = startOpen || projects.isNone(), cur = projects.currentId();
  return {
    project: !none,
    workspace: !none && !!projectMode(get()),
    views: none ? [] : railKeys().map(k => [k, navTitle(k)]),
    current: currentKey,
    recent: projects.switchList().filter(p => p.id !== cur).slice(0, 10).map(p => [p.id, recentName(p)]),
    sidebar: document.documentElement.dataset.side !== 'rail',
    files: sideMode === 'files',
    reveal: !none && !!projects.activeFolder()?.can?.reveal,
    themes: [['system', 'Match System'], ...THEMES.map(t => [t.id, t.label])],
    theme: themePreference(),
    menus: none ? [] : viewMenus(),
  };
}
// A view's own menus (Format, Insert… for the manuscript): `menus(ctx)` gives
// `{ title, items }` with items `{ label, run, enabled?, checked?, accel?, items? }`
// or '-'; each command is kept here by the id the shell sends back.
const menuRuns = new Map();
function viewMenus() {
  menuRuns.clear();
  let n = 0;
  const conv = items => items.filter(Boolean).map(it => {
    if (it === '-') return { sep: true, id: '', label: '', enabled: false, items: [] };
    const id = `cmd:${n++}`;
    if (it.run) menuRuns.set(id, it.run);
    return { id, label: it.label, enabled: it.enabled !== false, checked: typeof it.checked === 'boolean' ? it.checked : null, accel: it.accel || null, sep: false, items: it.items ? conv(it.items) : [] };
  });
  try { return (VIEWS[currentKey]?.menus?.(ctx) || []).map(m => ({ title: m.title, items: conv(m.items) })); }
  catch (err) { console.warn('[menu]', err); return []; }
}
let menuT = null;
menuSync = () => { if (!inDesktop()) return; clearTimeout(menuT); menuT = setTimeout(() => reportMenu(menuState()), 0); };
// A document-level toggle (track changes, line numbers) shows in its menu.
subscribe(() => menuSync());
// The open project was replaced by the one on disk: say where this window's unsaved edits went (store.mjs, the recovery copies in Settings).
onProjectReplaced(({ copies }) => showShellNotice({ id: 'project-replaced', label: 'Project replaced', text: replacedNoticeText(copies), again: true,
  actions: [{ id: 'replaced-show', label: 'Show copies', run: () => { go('settings:project'); } }] }));
// An error nobody caught or a promise nobody awaited: logged, and shown once as a short notice (lib/error-surface.mjs).
installErrorSurface({ show: text => showShellNotice({ id: 'app-error', label: 'Error', text, again: true }) });

/** Saves, then lets the shell quit; a file with unsaved edits may keep the window open. */
async function quitApp() {
  quitReply(null);
  if (currentKey === 'files' && !await VIEWS.files.confirmLeave()) { quitReply(false); return false; }
  if (!await settleSave()) { quitReply(false); return false; }
  rememberPage();
  quitReply(true);
  return true;
}
const retrySave = () => { persist().then(ok => { subtitle.textContent = ok ? 'Saved' : saveFailedText(saveError()); }, err => { subtitle.textContent = saveFailedText(err?.message); }); };
/**
 * Writes the project before the window goes. persist() does not throw on a refused write, so a quit that ignored its answer discarded
 * the last edits (review finding 1): now the person chooses, Retry, Stay or Quit without saving. True when the window may close.
 */
async function settleSave() {
  for (;;) {
    let reason = '';
    try { if (!await persist()) reason = saveError() || 'the project could not be written'; } catch (err) { reason = err?.message || String(err); }
    if (!reason) return true;
    const pick = await choiceAsk('Not saved', { detail: `${reason}. The latest changes exist only in this window.`, cancel: 'Stay',
      choices: [{ id: 'retry', label: 'Retry', role: 'primary' }, { id: 'quit', label: 'Quit without saving', role: 'destructive' }] });
    if (pick === 'quit') return true;
    if (pick !== 'retry') return false;
  }
}
/** Find: the view's own find where it has one (its `find()`, or a find inside it), else its search field, else workspace search. */
function findInView() {
  if (VIEWS[currentKey]?.find?.()) return;   // a page whose search row opens on demand (Dependencies, Extraction, Tables and figures)
  const page = view.querySelector('#page, #nt-text, .fv-host:not([hidden]) .fv-pdf-body, .fv-host:not([hidden]) .reader');   // the manuscript's find, the open note's, a PDF's
  if (page) { page.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })); return; }
  const field = [...document.querySelectorAll('#view input[type="search"], #plist input[type="search"]')].find(i => i.getClientRects().length);
  if (field) { field.focus(); field.select(); return; }
  togglePalette();
}
const libraryReport = msg => { paint('library'); subtitle.textContent = msg || ''; refreshCounts(); };
async function menuCommand(id) {
  if (id === 'quit') { quitApp(); return; }
  if (id === 'close') { if (currentKey === 'files' && VIEWS.files.command('close')) return; if (openPaper) closeDocument(); else quitApp(); return; }
  if (id === 'new') {
    if (startOpen) document.getElementById('start-new')?.click();
    else folderAction(() => projects.newProject());
    return;
  }
  if (id === 'open') {
    if (startOpen) document.getElementById('start-open-folder')?.click();
    else folderAction(() => projects.openFolder());
    return;
  }
  if (id.startsWith('recent:')) { folderAction(() => projects.open(id.slice(7))); return; }
  if (id === 'settings' && startOpen) { document.getElementById('start-settings')?.click(); return; }
  if (id === 'licences') { go('settings:about'); return; }
  if (startOpen) return;
  if (id.startsWith('view:')) { go(id.slice(5)); return; }
  if (id.startsWith('theme:')) { setTheme(id.slice(6)); menuSync(); return; }
  if (id.startsWith('cmd:')) { menuRuns.get(id)?.(); return; }
  if (id.startsWith('export:')) { await go('library'); if (currentKey === 'library') VIEWS.library.exportRecords(id.slice(7), libraryReport); return; }
  const report = k => msg => { paint(k); subtitle.textContent = msg || ''; refreshCounts(); };
  if (id.startsWith('export-ms:')) { await go('manuscript'); if (currentKey === 'manuscript') { if (id.endsWith('docx')) VIEWS.manuscript.exportDocx(report('manuscript')); else VIEWS.manuscript.exportMarkdown(); } return; }
  const run = {
    settings: () => go('settings'),
    'close-project': () => folderAction(() => projects.closeProject()),
    // Whole-project backup (lib/project-backup.mjs); a restore adds a new project and asks before opening it.
    backup: async () => { subtitle.textContent = 'Backing up…'; try { const { backupOpenProject, backupReport } = await projectBackup.ensure(); subtitle.textContent = backupReport(await backupOpenProject()); } catch (err) { subtitle.textContent = `Not backed up: ${err.message}`; } },
    restore: async () => (await viewOf('dashboard')).importProjectFlow(msg => { subtitle.textContent = msg; }),
    import: async () => {
      await go('library');
      if (currentKey === 'library') VIEWS.library.pick({ accept: VIEWS.library.IMPORT_ACCEPT }, fs => VIEWS.library.importRecords(fs[0], libraryReport));
    },
    find: () => assistExpanded ? toggleChatFind(true) : findInView(),
    save: async () => {
      let ok = false;
      try { ok = await persist(); } catch (err) { subtitle.textContent = saveFailedText(err.message); return; }
      subtitle.textContent = ok ? 'Saved' : saveFailedText(saveError());
      if (!ok) showShellNotice({ id: 'save-failed', label: 'Not saved', text: saveFailedText(saveError()), again: true, actions: [{ id: 'save-retry', label: 'Retry', run: retrySave }] });
    },
    reveal: () => projects.activeFolder()?.reveal('').catch(err => { subtitle.textContent = err.message; }),
    'import-dataset': async () => { await go('datasets'); if (currentKey === 'datasets') VIEWS.datasets.importDataset(report('datasets')); },
    'import-manuscript': async () => { await go('manuscript'); if (currentKey === 'manuscript') (await viewOf('library')).pick({ accept: '.docx,.md,.markdown,.txt' }, fs => VIEWS.manuscript.importManuscript(fs[0], report('manuscript'))); },
    'export-bundle': () => { go('reporting'); document.getElementById('bundle')?.click(); },
    sidebar: toggleSide,
    files: toggleFiles,
    inspector: () => toggleInspector(),
    assistant: toggleChat,
    palette: togglePalette,
    shortcuts: toggleShortcuts,
  }[id];
  run?.();
}
onMenu(menuCommand);
nativeContextMenu();
menuSync();

// ---- the window as a document (desktop) -------------------------------------
// Title (Mission Control, the Window menu), the edited dot while changes wait
// to be written, and light or dark to match the theme, so the sidebar's
// vibrancy and the system's sheets and menus agree with the page.
function syncWindowDoc() {
  if (!inDesktop()) return;
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const light = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  windowDocument({ title: startOpen ? 'Lykos' : projectLabel(), edited: !startOpen && saveState() !== 'saved', dark: light < 0.5 });
}
new MutationObserver(() => { syncWindowDoc(); syncChrome(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
onSaveState(syncWindowDoc);
// The Dock badge is the unread notification count; a long job that finishes
// while Lykos is in the background says so in a system notification.
const watchedJobs = new Map();
let dockT = null;
subscribe(() => {
  if (!inDesktop() || startOpen) return;
  clearTimeout(dockT);
  dockT = setTimeout(() => {
    dockBadge(REGISTRY.notifications.count());
    for (const j of allJobs()) {
      if (j.status === 'running') { if (!watchedJobs.has(j.id)) watchedJobs.set(j.id, Date.parse(j.startedAt) || Date.now()); continue; }
      if (!watchedJobs.has(j.id)) continue;
      const began = watchedJobs.get(j.id); watchedJobs.delete(j.id);
      if (Date.now() - began < 15000 || !['done', 'failed'].includes(j.status)) continue;
      notifyDone(j.label || 'Job', j.status === 'failed' ? 'Stopped with an error' : j.result?.status === 'incomplete' ? 'Saved results need follow-up' : 'Finished');
    }
  }, 250);
});
syncWindowDoc();

// A manuscript keystroke updates the store, but the navigation counts do not
// need to scan every screening and extraction record for each keystroke.
let countsT = null;
subscribe(() => {
  const before = navShape;
  drawNav();
  if (before !== navShape && currentKey !== 'settings' && !order().includes(currentKey)) go('overview');
  clearTimeout(countsT); countsT = setTimeout(refreshCounts, 120);
});

// The project is read from storage before the first view is drawn, so a view
// never renders against an empty project and then jump when it arrives.
performance.mark('lykos:modules');
import('./lib/offline-cache.mjs').then(m => { m.registerOfflineCache(); m.remindExport('st-export', () => menuCommand('backup')); }, () => {});
// Which project, and where it is kept, is settled before anything is read. A
// folder whose project file cannot be read is not opened as an empty project:
// the first edit would be saved over it.
// A project other than the unused local one: the normal window, before it loads.
if (!projects.isNone() && projects.currentId() !== projects.LOCAL) windowMode('normal');
// App-wide settings (name, model connections and keys, PubMed contact) are read first: the start
// screen shows them with no project open, and a project that opens next adds what it holds to them.
await loadAppSettings();
onAppSettings(notify);
// the desktop app keeps itself current (lib/app-update.mjs); on the site, a Mac visitor is offered it (lib/get-app.mjs): each loaded only there
setTimeout(() => import(window.__TAURI_INTERNALS__ ? './lib/app-update.mjs' : './lib/get-app.mjs').then(m => (m.startUpdates || m.offerDesktopApp)()).catch(() => {}), 1500);
try {
  useBackend(await projects.prepare());
  // No project open: the start screen, and nothing else starts — no
  // background jobs, no inbox, nothing loaded that a save could write.
  if (projects.isNone()) await showStart();
  await load();
  // A first launch: the local project was never used, so there is nothing to open.
  if (projects.currentId() === projects.LOCAL && !projectMode(get()) && !(get().papers || []).length && !get().project) {
    projects.describe(projects.LOCAL, { blank: true });
    await showStart();
  }
} catch (err) {
  // The project could not be opened: said, then the start screen, which lists
  // it with every other. Nothing is written to it.
  windowMode('normal');
  await confirmAsk(`Could not open ${projects.current().name || 'the project'}`,
    { detail: String(err?.message || err).slice(0, 200), confirm: 'Show projects' });
  await projects.closeProject().catch(() => location.reload());
  await new Promise(() => {});   // the reload replaces this page
}
// A project is open: the window takes its normal shape (the start screen took the welcome one).
windowMode('normal');
if (inDesktop()) {
  // Both reads go to the native side at once; they are applied in order, the
  // recovered papers first, so the audit can cover them.
  const [recoveryRead, auditRead] = await Promise.allSettled([libraryRecoveryNative(), libraryAuditNative()]);
  try {
    if (recoveryRead.status === 'rejected') throw recoveryRead.reason;
    const text = recoveryRead.value;
    const recovery = text ? JSON.parse(text) : null;
    if (recovery?.project === projectIdentity().current && recovery.batchId && !(get().appliedRecoveryBatches || []).includes(recovery.batchId)) {
      updateStore(s => {
        for (const p of recovery.papers || []) if (p.id && p.title && !s.papers.some(x => x.id === p.id)) s.papers.push(p);
        s.appliedRecoveryBatches = [...(s.appliedRecoveryBatches || []), recovery.batchId]; return s;
      });
    }
  } catch (error) { console.warn('Paper recovery:', error); }
  try {
    if (auditRead.status === 'rejected') throw auditRead.reason;
    const text = auditRead.value;
    const audit = text ? JSON.parse(text) : null;
    if (audit?.project === projectIdentity().current) updateStore(s => applyAvailabilityAudit(s, audit));
  } catch (error) { console.warn('Availability audit:', error); }
}
performance.mark('lykos:loaded');
setTimeout(() => import('./lib/warm-views.mjs').then(m => m.warmViews({ keys: [...railKeys(), ...FOOTER], lists: [nav, document.getElementById('foot')],
  load: k => LOAD[k] && viewOf(k).catch(() => {}) })), 600);
wireProjects();
repairRecords();
applyRates(settings.settings());

settings.ensureJevProfile();
// Tasks other projects sent here (lib/task-handoff.mjs), taken on load and on focus.
const takeHandoffs = () => handoffs.ensure().then(m => m.absorbIntoOpenProject({ onChange: () => { refreshCounts(); if (currentKey === 'tasks') paint(currentKey); } }), err => console.warn('[handoffs]', err.message));
takeHandoffs(); window.addEventListener('focus', takeHandoffs);
// A protocol placed in the app's inbox is applied to the review it names, and
// every stored proposal's verdict is derived again from its answers.
if (inDesktop()) takeInboxNative().then(async text => {
  if (!text) return;
  let box; try { box = JSON.parse(text); } catch { return; }
  const { current } = projectIdentity();
  if ((box?.jevCrossCheck || box?.screeningBatch) && box.projectId === current) await screeningImport.ensure();   // a failed load is the catch below
  if (box?.jevCrossCheck && box.projectId === current) {
    const { applyJevCrossCheck } = screeningImport.module();
    try { updateStore(s => applyJevCrossCheck(s, box.jevCrossCheck)); refreshCounts(); paint(currentKey); }
    catch (error) { console.warn('Jev import:', error); }
    return;
  }
  if (box?.screeningBatch && box.projectId === current) {
    const { applyScreeningBatch } = screeningImport.module();
    try { updateStore(s => applyScreeningBatch(s, box.screeningBatch)); } catch (error) { console.warn('Screening import:', error); }
    return;
  }
  if (!(box?.protocol?.criteria || Array.isArray(box?.decisions) || Array.isArray(box?.values)) || (box.projectId && box.projectId !== current)) return;
  const proposeValue = Array.isArray(box.values) ? (await proposals.ensure()).propose : null;
  const { reapply: reapplyRules } = box.protocol?.criteria ? await decisionModel.ensure() : {};
  let changed = 0, n = 0;
  if (box.protocol?.criteria) updateStore(s => {
    const p = s.protocol || { title: '', pico: {}, criteria: [] };
    s.protocol = { ...p, title: box.protocol.title || p.title, pico: { ...(p.pico || {}), ...(box.protocol.pico || {}) }, criteria: box.protocol.criteria };
    const rules = box.protocol.criteria.filter(c => c.stage !== 'Full text');
    if (box.reset) { s.proposals = { ...(s.proposals || {}), ta: {} }; }
    for (const [id, pr] of Object.entries(s.proposals?.ta || {})) {
      if (!(pr.tier === 'jev' || pr.jev)) continue;
      const src = pr.jev || pr; const next = reapplyRules(src, rules); n++;
      const fresh = { ...src, verdict: next.verdict, p: next.p, eligible: next.eligible ?? src.eligible ?? null, criteria: next.criteria, tier: 'jev', at: new Date().toISOString() };
      delete fresh.jev; if (fresh.verdict !== pr.verdict) changed++;
      s.proposals.ta[id] = fresh;
    }
    s.jobs = [{ id: `j${Date.now().toString(36)}`, kind: 'protocol', label: `Protocol from file · ${box.protocol.criteria.length} criteria · ${changed} of ${n} verdicts changed`, status: 'done', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), progress: '', done: n, total: n, stop: false, result: box.note || null, error: null }, ...(s.jobs || [])].slice(0, 200);
    return s;
  });
  // Decisions made outside the app come in by title or DOI, attributed to the
  // reviewer the file names; each goes through the same log as a keypress.
  if (Array.isArray(box.decisions)) {
    const st = get(); const byDoi = new Map(st.papers.filter(p => p.doi).map(p => [p.doi.toLowerCase(), p])); const byTitle = new Map(st.papers.map(p => [p.title.trim().toLowerCase(), p]));
    let applied = 0;
    for (const dc of box.decisions) {
      const p = (dc.doi && byDoi.get(String(dc.doi).toLowerCase())) || byTitle.get(String(dc.title || '').trim().toLowerCase());
      if (!p || !['include', 'exclude', 'uncertain'].includes(dc.decision)) continue;
      try { screenDecide(dc.stage === 'ft' ? 'ft' : 'ta', p.id, dc.decision, { reason: dc.reason || (dc.decision === 'exclude' ? 'Excluded at screening' : ''), by: dc.by || 'file', via: 'file' }); applied++; } catch {}
    }
    updateStore(s => { s.jobs = [{ id: `j${Date.now().toString(36)}d`, kind: 'protocol', label: `Decisions from file · ${applied} of ${box.decisions.length}`, status: 'done', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), progress: '', done: applied, total: box.decisions.length, stop: false, result: null, error: null }, ...(s.jobs || [])].slice(0, 200); return s; });
  }
  // Extracted values come in the evidence contract's shape (plan 5.1): a
  // value, the quote it came from, who extracted it, and how it was verified.
  if (Array.isArray(box.values)) {
    const st = get(); const byDoi = new Map(st.papers.filter(p => p.doi).map(p => [p.doi.toLowerCase(), p])); const byTitle = new Map(st.papers.map(p => [p.title.trim().toLowerCase(), p]));
    // A verified value is written as one (the single value writer, lib/fields.mjs);
    // an unverified one waits as a proposal for review, as an imported table's do.
    let n = 0;
    for (const v of box.values) {
      const p = (v.doi && byDoi.get(String(v.doi).toLowerCase())) || byTitle.get(String(v.title || '').trim().toLowerCase());
      if (!p || !v.field || v.value == null || v.value === '') continue;
      const value = String(v.value), note = v.quote ? `From the ${v.source || 'full text'}: “${v.quote}”` : '';
      if (v.verified) setAnchoredValue(p.id, v.field, { reported_value: value, normalized_value: value, origin: 'manual', extractor: v.by || 'file', evidence: [], rationale: note });
      else proposeValue(p.id, { column_id: v.field, value, normalized_value: value, availability: 'present', evidence: [], rationale: note, origin: 'imported', mode: 'verify', verify: null, model: null, run_id: null });
      n++;
    }
    updateStore(s => {
      s.jobs = [{ id: `j${Date.now().toString(36)}v`, kind: 'protocol', label: `Values from file · ${n}`, status: 'done', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), progress: '', done: n, total: box.values.length, stop: false, result: null, error: null }, ...(s.jobs || [])].slice(0, 200);
      return s;
    });
  }
  refreshCounts(); paint(currentKey);
  // The file may ask for a fresh pass of the decision model over every
  // outstanding record, as the screening view's Propose would.
  const cfg = settings.modelFor('decide');
  if (box.propose && isJev(cfg) && modelConfigured(cfg)) {
    const st = get(); const rules = box.protocol.criteria.filter(c => c.stage !== 'Full text');
    const list = st.papers.filter(p => !st.screening?.[p.id] && !st.proposals?.ta?.[p.id]);
    runJob('screen', 'Decision model · Title and abstract', async h => {
      let done = 0; h.count(0, list.length);
      const { screenMany } = await decisionModel.ensure();
      await screenMany(list, rules, cfg, { stage: 'ta', stop: () => h.stopped(), onEach: (r, a) => {
        h.count(++done, list.length);
        if (a && a.verdict) updateStore(s => { s.proposals = s.proposals || {}; s.proposals.ta = s.proposals.ta || {};
          s.proposals.ta[r.id] = { verdict: a.verdict, p: a.p ?? null, eligible: a.eligible ?? null, criteria: a.criteria || [], model: cfg.model, at: new Date().toISOString(), tier: 'jev', passes: a.passes, rulesSnapshot: a.rulesSnapshot, crossChecked: a.crossChecked, disagreement: a.disagreement, reviewRequired: a.reviewRequired, screeningStage: a.screeningStage, triageVersion: a.triageVersion, screeningVersion: a.screeningVersion, exclusionCategory: a.exclusionCategory, screeningOutcome: a.screeningOutcome, triageNote: a.triageNote, exclusionCandidates: a.exclusionCandidates }; return s; });
      } });
      return `${done} of ${list.length}`;
    }, { stage: 'ta' }).catch(() => {}).finally(() => { refreshCounts(); paint(currentKey); });
  }
}).catch(err => { if (/^Could not load/.test(err?.message)) subtitle.textContent = err.message; });   // an unreadable file is ignored, as before; a module that could not load is said
subscribe(() => applyRates(settings.settings()));
// A saved project may still name a Codex or Claude Code profile (removed); the first available profile serves instead, and the project says so once.
let retiredT = null;
subscribe(() => {
  clearTimeout(retiredT);
  retiredT = setTimeout(() => {
    if (projects.isNone() || !settings.retiredProfiles().length || (get().notifications || []).some(n => n.id === 'retired-cli-profiles')) return;
    updateStore(st => { addNotice(st, { id: 'retired-cli-profiles', title: 'Codex and Claude Code profiles removed', detail: 'This project named one. The first remaining model profile is used instead; choose another under Settings, Models.', tone: 'info', view: 'settings' }); return st; });
  }, 400);
});
// A registry that asked us to wait is shown as waiting, not as broken.
let registryT = null;
onRegistryStatus((name, msg) => {
  if (msg) { identifyLine.hidden = false; identifyLine.textContent = msg; clearTimeout(registryT); }
  else if (identifyLine.textContent.startsWith(`${name}:`)) { clearTimeout(registryT); registryT = setTimeout(() => { identifyLine.hidden = true; }, 400); }
});
// Downloads starting and finishing together repaint the library once a frame.
let downloadPaint = false;
onDownloadProgress(() => {
  if (downloadPaint) return;
  downloadPaint = true;
  requestAnimationFrame(() => { downloadPaint = false; if (currentKey === 'library') paint(currentKey); });
});
reconcileJobs();
reconcileRunsIfAny().catch(err => console.warn('[runs]', err.message));
drawNav();
navigationProject = projects.currentId();
const restoredPage = restoreNavigation(navigationProject, [...order(), 'settings', 'files']);
// The page the last session ended on loads before the first paint; every other page waits until it is asked for.
// A project with saved proposals loads their handlers and describers with the first view; one without leaves them for the first use.
const checksAtLoad = checksNeeded() ? ensureChecks().then(() => null, err => err) : null;
const aidAtLoad = aid.aidNeeded() ? aid.ensureAid().then(() => null, err => err) : null;
await viewOf(restoredPage.view).catch(err => { console.warn('[page]', restoredPage.view, err); restoredPage.view = 'overview'; });
if (aidAtLoad) { const failed = await aidAtLoad; if (failed) aidFailed(failed); }
if (explorerAtLoad) await explorerAtLoad;
if (checksAtLoad) { const failed = await checksAtLoad; if (failed) checksFailed(failed); }
currentKey = restoredPage.view;
VIEWS[currentKey]?.restoreNavigation?.(restoredPage);
paint(currentKey);
sayChecksFailure();
// The first view is on screen; a driver's earlier requests waited for it (__lykosPanes).
openShell();
// Each save keeps the open project's summary for All projects and the start screen (lib/dashboard.mjs loads once the first view is on screen).
import('./lib/dashboard.mjs').then(m => m.keepSummaries(), err => console.warn('[summaries]', `Could not load the project summaries: ${err.message}`));
import('./lib/vcs-watch.mjs').then(m => m.start(), () => {});   // history records itself

// Housekeeping that need not hold up the first view. An interrupted workflow
// run is marked failed (the workflows view follows the store); PDFs a preview
// build saved are retired, and a view showing them is drawn again if any were.
reconcileFlowRunsIfAny().catch(err => console.warn('[workflows]', err));
if (inDesktop()) (async () => {
  const withPdf = () => get().papers.reduce((n, p) => n + (p.pdf ? 1 : 0), 0);
  const before = withPdf();
  await (await import('./lib/preview-migration.mjs')).retireSavedRetrievals();
  if (withPdf() !== before) { refreshCounts(); paint(currentKey); }
})().catch(err => console.warn('[preview migration]', err));

// Scheduled searches: whatever fell due while the app was closed runs now,
// and the check repeats every hour it stays open. Results are jobs, so what
// ran unattended is visible afterwards.
const checkDue = async () => {
  try {
    const [schedule, search] = await Promise.all([scheduled.ensure(), searchRun.ensure()]);
    const ran = [...await schedule.runDue({ settings: settings.settings() }), ...await search.resumePaused({ settings: settings.settings() })];
    if (ran.length) { refreshCounts(); if (VIEWS[currentKey]) paint(currentKey); }
  } catch (err) { console.warn('[schedule]', err); }
};
setTimeout(checkDue, 4000);

// Papers behind attached files are identified as soon as the project opens,
// and whenever a save leaves new ones pending. Progress shows in the sidebar.
const identifyLine = document.getElementById('engine');
onIdentify(msg => {
  if (msg) { identifyLine.hidden = false; identifyLine.textContent = msg; }
  else { identifyLine.hidden = true; refreshCounts(); if (VIEWS[currentKey]) paint(currentKey); }
});
const identifyPending = async () => {
  if (!pendingIdentification().length) return;
  try { await (await identifier.ensure()).runIdentification(); } catch (err) { console.warn('[identify]', err); }
};
setTimeout(identifyPending, 1500);
let identifyT = null;
subscribe(() => { clearTimeout(identifyT); identifyT = setTimeout(identifyPending, 3000); });
setInterval(checkDue, 3600e3);
setInterval(() => runDueFlowsIfAny().catch(err => console.warn('[workflows]', err.message)), 15000);
