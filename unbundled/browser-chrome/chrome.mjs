// The Lykos browser's bar (browser-chrome.html; src-tauri/src/browser.rs). It shows the page's address and steps the page through the
// browser_* commands, the only ones its capability grants (capabilities/browser-chrome.json). What it learns of the page is the state the
// shell sends it (`browser-nav`: address, title, loading, history, zoom); everything it shows is set as text or a field's value.
import { barHtml, barView } from '../lib/browser-bar.mjs';
import { regionShow } from '../lib/ui-actions.mjs';
import '../lib/bar-boot.mjs';

const $ = id => document.getElementById(id);
const T = window.__TAURI_INTERNALS__;
const call = (cmd, args = {}) => (T?.invoke ? T.invoke(cmd, args) : Promise.reject(new Error('not in the desktop app')));
const listen = (event, fn) => { if (T?.transformCallback) T.invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: T.transformCallback(e => fn(e?.payload)) }).catch(() => {}); };

$('bc').innerHTML = barHtml();
const region = $('bc-rows'), address = $('bc-address'), findQ = $('bc-find-q'), findCount = $('bc-find-count');
let view = barView(), finding = false;

function paint(state) {
  view = barView(state);
  if (document.activeElement !== address) address.value = view.address;
  $('bc-back').disabled = !view.back;
  $('bc-forward').disabled = !view.forward;
  $('bc-reload').hidden = view.loading;
  $('bc-stop').hidden = !view.loading;
  $('bc-copy').disabled = !view.copy;
  $('bc-system').disabled = !view.copy;
  $('bc-institution').disabled = !view.institution;
  $('bc-zoom').textContent = view.zoom;
  region.toggleAttribute('aria-busy', view.loading);
}

const nav = action => call('browser_nav', { action }).catch(() => {});
// the shell builds the redirector link from the saved domain and the page's own address; the bar sends neither
const throughInstitution = () => call('browser_institution').then(url => { address.value = url; })
  .catch(err => { address.setCustomValidity(String(err)); address.reportValidity(); });

function openFind() {
  finding = true;
  regionShow(region, 1);
  findQ.focus(); findQ.select();
}
function closeFind() {
  finding = false;
  findCount.textContent = '';
  regionShow(region, 0);
}
async function find(backwards = false) {
  const text = findQ.value;
  if (!text.trim()) { findCount.textContent = ''; return; }
  const found = await call('browser_find', { text, backwards }).catch(() => false);
  if (findQ.value === text) findCount.textContent = found ? '' : 'No matches';
}

async function copyLink() {
  if (!view.address) return;
  try { await navigator.clipboard.writeText(view.address); return; } catch { /* a custom scheme may not count as a secure context */ }
  const t = document.createElement('textarea');
  t.value = view.address; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.append(t); t.select();
  try { document.execCommand('copy'); } finally { t.remove(); }
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('button[id]');
  if (!b || b.disabled) return;
  ({ 'bc-back': () => nav('back'), 'bc-forward': () => nav('forward'), 'bc-reload': () => nav('reload'), 'bc-stop': () => nav('stop'),
    'bc-system': () => nav('system'), 'bc-copy': copyLink, 'bc-institution': throughInstitution, 'bc-find': openFind, 'bc-f-next': () => find(false), 'bc-f-prev': () => find(true), 'bc-f-close': closeFind })[b.id]?.();
});

// a click into the field selects the whole address (the click's own mouseup would otherwise drop the selection), as a browser's does
address.addEventListener('mousedown', e => { if (document.activeElement !== address) { e.preventDefault(); address.focus(); } });
address.addEventListener('focus', () => address.select());
address.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const typed = address.value;
    call('browser_go', { address: typed }).then(url => { address.value = url; address.blur(); }).catch(err => { address.setCustomValidity(String(err)); address.reportValidity(); });
  } else if (e.key === 'Escape') { e.preventDefault(); address.value = view.address; address.blur(); }
});
address.addEventListener('input', () => address.setCustomValidity(''));
address.addEventListener('blur', () => { if (!address.matches(':focus')) address.value = view.address; });

let findTimer = 0;
findQ.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => find(false), 150); });
findQ.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); find(e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
document.addEventListener('keydown', e => {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape' && view.loading && !finding && document.activeElement !== address) nav('stop');
});

listen('browser-nav', state => paint(state || {}));
// the Window menu's Find (⌘F) and Open Location (⌘L): the shell has focused this webview
listen('browser-key', key => { if (key === 'find') openFind(); else if (key === 'address') { if (finding) closeFind(); address.focus(); address.select(); } });
paint({});
call('browser_page').then(paint).catch(() => {});
