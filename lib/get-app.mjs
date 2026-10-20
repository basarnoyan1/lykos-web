// The desktop app offered on the site: a card at the window's bottom corner for a visitor on a Mac (not an iPad, which also says
// "Macintosh"), with Download (Lykos.dmg from the release tools/publish-desktop.mjs keeps) and Close. After Download it says the one
// step a first open needs: the app is not notarized, so macOS asks for Open Anyway once. A page cannot see which apps are installed,
// so Close and Download are remembered in this browser and the card does not come back. Never in the desktop app.
import { uiBar } from './ui-actions.mjs';
import { inDesktop } from './native.mjs';

export const DMG_URL = 'https://github.com/basarnoyan1/lykos-web/releases/download/desktop/Lykos.dmg';
const KEY = 'lykos-get-app';

/** Whether this browser runs on a Mac: the platform says so and the device is not a touch tablet. */
export function onMac(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const p = String(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
  return /mac/i.test(p) && !/iphone|ipad|ipod/i.test(String(nav.userAgent || '')) && !(Number(nav.maxTouchPoints) > 1);
}

const stored = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const remember = v => { try { localStorage.setItem(KEY, v); } catch { /* private browsing: shown again next time */ } };

let card = null, version = '';
const STEPS = ['Open Lykos.dmg', 'Drag Lykos to Applications', 'First open: System Settings › Privacy &amp; Security › Open Anyway'];
function draw(after) {
  const close = { id: 'get-app-close', label: 'Close', role: 'quiet' };
  card.innerHTML = `<div class="get-app-top"><img class="get-app-icon" src="./assets/app/icon-192.png" width="48" height="48" alt="">
    <div class="get-app-main"><h2 class="get-app-title">Lykos for Mac (Apple silicon)</h2>${version ? `<p class="get-app-meta">Version ${version}</p>` : ''}</div></div>`
    + (after ? `<ol class="get-app-steps">${STEPS.map(t => `<li>${t}</li>`).join('')}</ol>` : '')
    + uiBar({ kind: 'foot', label: 'Lykos for Mac', id: 'get-app-foot', actions: after ? [close] : [close, { id: 'get-app-download', label: 'Download', icon: 'download', role: 'primary' }] });
}

/** Shows the card when it applies (the site, on a Mac, not closed before in this browser). */
export function offerDesktopApp() {
  // not to a browser under automation (the app's own tests run headless Chrome on a Mac)
  if (card || inDesktop() || !onMac() || stored() || navigator.webdriver) return;
  const el = document.createElement('section');
  el.className = 'xfer-card get-app'; el.setAttribute('aria-label', 'Lykos for Mac');
  card = el;
  card.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    if (id === 'get-app-download') { remember('downloaded'); location.href = DMG_URL; draw(true); }
    else if (id === 'get-app-close') { if (!stored()) remember('closed'); card.remove(); card = null; }
  });
  try { draw(false); } catch (err) { card = null; throw err; }
  document.body.append(el);
  fetch('./app-info.json').then(r => r.json()).then(i => { version = String(i.version || ''); if (card === el && !el.querySelector('.get-app-steps')) draw(false); }).catch(() => {});
}
