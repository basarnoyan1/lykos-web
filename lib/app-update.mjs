// Updates of the desktop app (src-tauri/src/updater.rs; published by tools/publish-desktop.mjs). A while after launch and every six
// hours, the published build is compared with this one (app-info.json's build, the count of commits it was made from); a newer one is
// downloaded and checked in the background and takes this one's place when Lykos quits. Settings > About shows where it stands and
// offers Restart to update. Outside the desktop app, and in a development build, nothing happens.
import { inDesktop } from './native.mjs';
import { get, update } from '../store.mjs';
import { notify } from './notifications.mjs';

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
let state = { phase: 'idle', version: '', error: '' };   // idle | checking | current | downloading | ready | manual | failed | unavailable
const listeners = new Set();
export const onUpdateState = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const updateState = () => state;
const set = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };

const NOTES = 'lykos-update-notes', LAST = 'lykos-last-build';
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept: nothing said after the update */ } };
const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

let build = null;
const currentBuild = async () => {
  if (build == null) { try { build = Number((await (await fetch('./app-info.json')).json()).build) || 0; } catch { build = 0; } }
  return build;
};

/** What Settings > About says about updates. */
export function updateText(s = state) {
  return ({ checking: 'Checking…', current: 'Up to date', downloading: `Downloading ${s.version}…`, ready: `${s.version} installs when Lykos quits`,
    manual: `${s.version} available`, updated: `Updated to ${s.version}`, failed: `Not updated: ${s.error}`, unavailable: 'Development build'})[s.phase] || '';
}

/** Checks for a newer build and, when there is one, downloads it. Answers the state. */
export async function checkForUpdate() {
  if (!inDesktop() || ['checking', 'downloading'].includes(state.phase)) return state;
  const current = await currentBuild();
  if (!current) { set({ phase: 'unavailable' }); return state; }
  set({ phase: 'checking', error: '' });
  try {
    const r = await invoke('update_check', { currentBuild: current });
    if (r.staged) set({ phase: 'ready', version: r.staged.version });
    else if (!r.available) set({ phase: 'current', version: r.version });
    else if (!r.installable) set({ phase: 'manual', version: r.version });
    else {
      set({ phase: 'downloading', version: r.version });
      const s = await invoke('update_download', { currentBuild: current });
      keep(NOTES, JSON.stringify({ from: current, build: s.build, version: s.version, notes: [].concat(r.notes || []).slice(0, 20) }));
      set({ phase: 'ready', version: s.version });
      if (get().project) update(st => { notify(st, { id: `app-update-${s.build}`, title: `Lykos ${s.version} ready`, view: 'settings' }); return st; });
    }
  } catch (e) { set({ phase: 'failed', error: String(e?.message || e) }); }
  return state;
}

/** Quits (saving as Quit does) and opens the new build. */
export const restartToUpdate = () => invoke('update_restart');

/**
 * After an update: the first launch of a newer build says so once, with what changed (the notes the manifest carried when it was
 * downloaded). The data needs nothing here: a project is brought up to date as it loads, a copy kept first (lib/backup-rule.mjs).
 * Answers { version, notes } for the build that is new to this computer, else null.
 */
export async function justUpdated() {
  const current = await currentBuild(), last = Number(read(LAST)) || 0;
  if (!current) return null;
  keep(LAST, String(current));
  if (!last || current <= last) return null;
  let kept = null; try { kept = JSON.parse(read(NOTES) || 'null'); } catch { /* none */ }
  try { localStorage.removeItem(NOTES); } catch { /* ignore */ }
  // a build installed some other way (from the source, by hand) is not announced
  return kept && kept.build === current ? { version: kept.version, notes: kept.notes || [] } : null;
}

let started = false;
export function startUpdates() {
  if (started || !inDesktop()) return;
  started = true;
  justUpdated().then(u => {
    if (!u) return;
    set({ phase: 'updated', version: u.version, notes: u.notes });
    if (get().project) update(st => { notify(st, { id: `app-updated-${u.version}-${Date.now()}`, title: `Updated to Lykos ${u.version}`, detail: u.notes.slice(0, 3).join('; '), view: 'settings' }); return st; });
  }).catch(() => {});
  setTimeout(checkForUpdate, 30_000);
  setInterval(checkForUpdate, 6 * 3600_000);
}
