// Navigation belongs to a project and, while open, to an individual tab.
// Only location metadata is stored here, never unsaved file or editor contents.
const keyFor = project => `lykos.navigation:${project}`;
const SHOWN = 'lykos.navigation.project';   // the project this tab last showed: another one opens on Overview
const aliases = { participants: 'patients', mcp: 'settings' };
function area(name) { try { return globalThis[name]; } catch { return null; } }
function read(storage, key) { try { return storage?.getItem(key); } catch { return null; } }
function write(storage, key, value) { try { storage?.setItem(key, value); } catch {} }
const stores = () => ({ session: area('sessionStorage'), local: area('localStorage') });
function location(value) {
  const out = {};
  for (const key of ['view', 'file', 'section', 'workflow'])
    if (typeof value?.[key] === 'string' && value[key].length <= 4096) out[key] = value[key];
  return out;
}
export function restoreNavigation(project, available, storage = stores()) {
  const key = keyFor(project);
  let saved;
  // A refresh keeps the place; another project, or a fresh start, opens on Overview (only the session is read).
  const shown = read(storage.session, SHOWN);
  write(storage.session, SHOWN, String(project));
  if (shown != null && shown !== String(project)) return { view: 'overview' };
  try { const value = JSON.parse(read(storage.session, key)); if (value && typeof value.view === 'string') saved = location(value); } catch {}
  saved ||= { view: 'overview' };
  if (saved.view === 'mcp') saved.section = 'mcp';
  saved.view = aliases[saved.view] || saved.view;
  return available.includes(saved.view) ? saved : { view: 'overview' };
}
/** True when this tab has not shown the project yet (a fresh start or another project): read before restoreNavigation, which records it. */
export function arrivesFresh(project, storage = stores()) { return read(storage.session, SHOWN) !== String(project); }
export function rememberNavigation(project, value, storage = stores()) {
  const saved = location(value);
  if (!saved.view) return;
  const text = JSON.stringify(saved), key = keyFor(project);
  write(storage.session, key, text);
  write(storage.session, SHOWN, String(project));
  write(storage.local, key, text);
}
