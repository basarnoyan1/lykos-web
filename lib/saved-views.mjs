// Named views of a list or a grid (plan §3 C6 "saved filters", research tools review row 1, 2026-10-23): what a page narrows to, how it
// sorts and which columns it shows, saved under a name in the project, so a repeated cut ("arms with follow-up under 12 months",
// "unresolved at full text") is one choice. Each page (library, screening, extraction) keeps its own list; a view's `state` is the page's
// own plain object, which only that page reads. Pure, apart from the writers at the end.
//
//   state.savedViews  { [page]: [{ id, name, state, at }] }
import { get, update } from '../store.mjs';

export const PAGES = Object.freeze(['library', 'screening', 'extraction']);
const MAX_VIEWS = 40, MAX_NAME = 60;

const plain = v => JSON.parse(JSON.stringify(v ?? {}));
/** A view list as stored, every entry valid: a name, a state object, an id. */
export function normaliseViews(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(v => v && typeof v === 'object' && String(v.name || '').trim() && v.state && typeof v.state === 'object' && !Array.isArray(v.state))
    .slice(0, MAX_VIEWS).map(v => ({ id: String(v.id || ''), name: String(v.name).trim().slice(0, MAX_NAME), state: plain(v.state), at: String(v.at || '') }));
}
/** A page's views, in the order they were saved. */
export const viewsOf = (st, page) => normaliseViews(st?.savedViews?.[page]);

/** Two states are the same view when their JSON is the same with keys in order and empty parts left out. */
const canon = v => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]).filter(([, x]) => !(x === '' || x == null || (Array.isArray(x) && !x.length) || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length))));
  return v;
};
export const sameState = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** The saved view the page shows now (its state is the current one), or null. */
export const matchingView = (st, page, state) => viewsOf(st, page).find(v => sameState(v.state, state)) || null;

/** Saves `state` under `name` (a view of that name is replaced). Returns the view. */
export function putView(st, page, name, state, { now = new Date().toISOString(), id = '' } = {}) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  if (!clean) throw new Error('A view needs a name');
  const list = viewsOf(st, page), at = list.findIndex(v => v.name.toLowerCase() === clean.toLowerCase());
  const view = { id: at >= 0 ? list[at].id : id || `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, state: plain(state), at: now };
  if (at >= 0) list[at] = view; else list.push(view);
  st.savedViews = { ...(st.savedViews || {}), [page]: list.slice(-MAX_VIEWS) };
  return view;
}
export function renameView(st, page, id, name) {
  const clean = String(name || '').trim().slice(0, MAX_NAME); if (!clean) return false;
  const list = viewsOf(st, page), v = list.find(x => x.id === id); if (!v) return false;
  if (list.some(x => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) return false;
  v.name = clean; st.savedViews = { ...(st.savedViews || {}), [page]: list };
  return true;
}
export function dropView(st, page, id) {
  const list = viewsOf(st, page).filter(v => v.id !== id);
  st.savedViews = { ...(st.savedViews || {}), [page]: list };
}

// ---- on the open project ----
const write = fn => update(s => { fn(s); return s; }, { indexNeutral: true });
export const saveView = (page, name, state) => { let v = null; write(s => { v = putView(s, page, name, state); }); return v; };
export const renameSaved = (page, id, name) => { let ok = false; write(s => { ok = renameView(s, page, id, name); }); return ok; };
export const deleteView = (page, id) => write(s => dropView(s, page, id));
export const savedViews = page => viewsOf(get(), page);

/**
 * The views picker's menu items: the page's views (the one shown checked), then Save view…, and, while a saved view is shown, Rename
 * and Delete. `current` is the page's state now; `apply(state)` shows a view; `ask(title, value)` resolves to a name or null.
 */
export function viewMenuItems(page, { current, apply, ask, done = () => {} }) {
  const list = savedViews(page), on = list.find(v => sameState(v.state, current)) || null;
  return [
    ...(list.length ? [{ heading: 'Views' }, ...list.map(v => ({ label: v.name, checked: v === on, checkType: 'radio', run: () => { apply(v.state); done(v.name); } })), '-'] : []),
    { label: on ? 'Save as new view…' : 'Save view…', run: async () => { const name = await ask('Save view', ''); if (name?.trim()) { saveView(page, name, current); done(name.trim()); } } },
    ...(on ? [{ label: 'Rename view…', run: async () => { const name = await ask('Rename view', on.name); if (name?.trim() && renameSaved(page, on.id, name)) done(name.trim()); } },
      { label: 'Delete view', danger: true, run: () => { deleteView(page, on.id); done(''); } }] : []),
  ];
}
/** The picker's value: the name of the view shown, else "All" (nothing narrows), else "Unsaved". */
export function viewLabel(page, current, narrowed) {
  const on = matchingView(get(), page, current);
  return on ? on.name : narrowed ? 'Unsaved' : 'All';
}
