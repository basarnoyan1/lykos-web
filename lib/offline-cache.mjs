// Registers the hosted build's file cache (sw.js beside index.html) in a browser tab on https. The desktop app has its files on disk
// and the dev server must always serve what was just saved, so neither registers it. A browser that refuses (private mode, blocked
// storage) simply loads from the network, as before.
//
// A newer build's worker that has finished installing is taken while the page has only just loaded (TAKE_MS after navigation, and not
// while a field has the keyboard): the worker is told to take over and the page reloads once, into the new build whole. Later in a
// visit it waits, and the next load takes it. A tab that did not ask reloads when it is next out of sight.
import { inHostedTab } from './native.mjs';
import { appUrl } from './app-url.mjs';

const TAKE_MS = 8000;

export function registerOfflineCache() {
  if (!inHostedTab() || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let taking = false;
  const ranOld = !!sw.controller;   // a first visit's worker takes the tab too (sw.js activate): that is not a change of build
  // Another tab took the new build: this one's code is the old build's while later imports come from the new cache, so it reloads the
  // next time it is out of sight (now, if it is); the one that asked reloads at once.
  sw.addEventListener('controllerchange', () => {
    if (taking) { location.reload(); return; }
    if (!ranOld) return;
    if (document.hidden) location.reload();
    else document.addEventListener('visibilitychange', () => { if (document.hidden) location.reload(); });
  }, { once: true });
  const take = reg => {
    const w = reg.waiting;
    if (!w || !sw.controller || taking || performance.now() > TAKE_MS || document.activeElement?.matches?.('input, textarea, select, [contenteditable]')) return;
    taking = true;
    w.postMessage('take');
  };
  sw.register(appUrl('sw.js'), { scope: appUrl('./') }).then(reg => {
    take(reg);
    if (sw.controller) reg.update().catch(() => {});   // ask for a newer sw.js now, not only when the browser next checks
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') take(reg); });
    });
  }).catch(() => {});
}

/**
 * The status line's Export due (app.mjs st-export, by its id): in a hosted tab, a project kept only in the browser that has not been exported
 * (Export project…, a .lykos.zip) for a week, or since it was first opened here, says so; pressing it exports. A browser can clear
 * the site's storage, and the daily safety copies (lib/browser-backups.mjs) live in that same storage.
 */
export async function remindExport(slot, run) {
  if (!inHostedTab()) return;
  // the status line is drawn once the project has loaded, after this module arrives
  let el = null;
  for (let i = 0; i < 100 && !(el = document.getElementById(slot)); i++) await new Promise(r => setTimeout(r, 100));
  if (!el) return;
  const [projects, copies] = await Promise.all([import('./projects.mjs'), import('./browser-backups.mjs')]);
  if (projects.isNone()) return;
  const id = projects.currentId(), seenKey = `lykos.firstSeen.${id}`;
  let seen = ''; try { seen = localStorage.getItem(seenKey) || ''; if (!seen) localStorage.setItem(seenKey, seen = new Date().toISOString()); } catch {}
  const show = () => {
    const exported = copies.lastExport(id), due = copies.exportDue({ exported, createdAt: seen });
    el.hidden = !due;
    el.title = due ? (exported ? 'No copy outside this browser for over a week: export the project' : 'This project has no copy outside this browser: export it') : '';
  };
  el.onclick = async () => { await run(); show(); };
  show();
}
