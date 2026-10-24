// All projects (the hub): a portfolio of the projects, with the tasks of every project as sections of the same page (views/hub.mjs). This module is the
// view registered as "dashboard": it hands the view itself to views/hub.mjs and re-exports the pieces the start screen and Settings import
// (restoreFlow, upcoming, upcomingList: views/dashboard-flow.mjs, which they read directly so the hub is not loaded for them).
import { REGISTRY } from './registry.mjs';

export const meta = { title: 'All projects', icon: 'projects' };
export const count = (...a) => REGISTRY.dashboard.count(...a);
export { render, page, select, selected, inspect, unmount, navigationState, restoreNavigation, focusTask } from './hub.mjs';
export { upcoming, upcomingList, restoreFlow, importFolderFlow, importProjectFlow } from './dashboard-flow.mjs';
