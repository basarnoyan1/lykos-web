// Changes: what happened to the project folder and what depends on what, as a page of its own in the rail (Workspace), not a tab among files.
// Two sections, the title bar's switch: History (lib/vcs.mjs: the folder records itself, a person names steps; what the project brought in from
// the folder by itself, lib/folder-sync.mjs, heads it) and Dependencies (lib/deps-graph.mjs: what a change to a decision, a column, a file reaches). Each section is the page its own module
// draws (views/history-tool.mjs, views/dependencies-tool.mjs); this module only chooses which and where. A section's commands are the title bar's
// (History's Commit and its More), handed up as they change and drawn again with ctx.chrome(): there is no second row of commands under it. History's
// own pages (a commit, a comparison, a file's history) are sub-pages: the title bar holds their title and Back in place of the switch.
// A project kept in app storage has no folder: History says so, and Dependencies draws the graph from the record alone (plan: "Dependencies without a folder", 2026-10-17).
import { emptyState } from '../lib/html.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { mountHistory, findIn as findInHistory } from './history-tool.mjs';
import { mountDependencies, findIn } from './dependencies-tool.mjs';

export const meta = { title: 'Changes', icon: 'changes', layout: 'flush' };
const SECTIONS = [['history', 'History'], ['dependencies', 'Dependencies']];
let section = 'history', subject = '', stop = null, shown = null, route = null, left = true;   // route: a History page to open on the next draw; left: the page was left, so History starts at its list
const NONE = { actions: [], overflow: [] };
const heads = { history: NONE, dependencies: NONE };   // each section's commands as it last declared them

/** Shows another folder than the project's (the fixture and its tests: a folder in the browser's own file system); null goes back. */
export function showFolder(folder) { shown = folder; }
export function select(id) { if (SECTIONS.some(([k]) => k === id)) section = id; }
export const selected = () => section;
/** Opens Dependencies on one thing (`file:Evidence.xlsx`, `count:new_studies`): the Files inspector's "Where it is used". */
export function focus(node) { section = 'dependencies'; subject = node || ''; }
/** Opens History on one of its pages on the next draw: { page: 'commit', id } | { page: 'compare', from, to } | { page: 'file', path }. */
export function openHistory(to) { section = 'history'; route = to || null; }
/** Opens History on one file's versions: the Files inspector's "Show history". */
export const fileHistory = path => openHistory(path ? { page: 'file', path } : null);

/**
 * The title bar: Changes, its two sections as the bar's switch (no Sections pane: the page has the window's width), and the shown section's commands.
 * A page inside a section (a commit, a comparison, a file's history) is a sub-page: its title, Back, and no switch (one navigator, never two).
 */
export function pageSpec({ value, head = NONE }, { onShow = () => {} } = {}) {
  if (head.back) return { title: head.title || 'Changes', back: head.back, ...(head.status ? { status: head.status } : {}), actions: head.actions, overflow: head.overflow };
  // both sections show Find in one place, disabled where the section has nothing to search, so the switch beside it never moves
  return { title: 'Changes', view: { id: 'chg-section', label: 'Show', attr: 'data-chg-section', value, items: SECTIONS, run: onShow }, find: head.find || { pressed: false, disabled: true, run: () => {} }, actions: head.actions, overflow: head.overflow };
}
export function page(rerender) {
  return pageSpec({ value: section, head: folderShown() || section === 'dependencies' ? heads[section] : NONE }, { onShow: key => { select(key); rerender(); } });
}
const folderShown = () => shown || activeFolder();

let drawnIn = null;
/** ⌘F (app.mjs findInView): the shown section opens its search row (Dependencies, History's list). */
export const find = () => (section === 'dependencies' ? findIn(drawnIn) : findInHistory(drawnIn));
export function render(el, ctx) {
  stop?.(); stop = null; drawnIn = el;
  const folder = folderShown();
  if (!folder && section === 'history') {
    el.innerHTML = `<div class="chg-empty">${emptyState({ icon: 'clock', title: 'No project folder', help: true, detail: 'History is kept for a project in a folder.' })}</div>`;
    return;
  }
  const say = msg => ctx?.say?.(msg);
  const which = section;
  let mine = null;
  const onHead = head => { heads[which] = head; if (stop === mine && section === which) ctx?.chrome?.(); };   // a stopped section says nothing
  stop = mine = which === 'dependencies' ? mountDependencies(el, { say, folder, node: subject, onHead })
    : mountHistory(el, { say, folder, onHead, go: v => ctx?.go?.(v), route, reset: left });
  subject = ''; route = null; left = false;
}
export function unmount() { stop?.(); stop = null; left = true; }
