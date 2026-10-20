// Navigation belongs to a project and, while open, to an individual tab.
// Only location metadata is stored here, never unsaved file or editor contents.
const keyFor = project => `lykos.navigation:${project}`;
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
  // A reload within a session (switching project, a refresh) keeps the place;
  // a fresh start of the app opens on Overview, so only the session is read.
  try { const value = JSON.parse(read(storage.session, key)); if (value && typeof value.view === 'string') saved = location(value); } catch {}
  saved ||= { view: 'overview' };
  if (saved.view === 'mcp') saved.section = 'mcp';
  saved.view = aliases[saved.view] || saved.view;
  return available.includes(saved.view) ? saved : { view: 'overview' };
}
export function rememberNavigation(project, value, storage = stores()) {
  const saved = location(value);
  if (!saved.view) return;
  const text = JSON.stringify(saved), key = keyFor(project);
  write(storage.session, key, text);
  write(storage.local, key, text);
}
