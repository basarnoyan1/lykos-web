// The web view's unused memory, given back when the page is quiet (desktop app only). WebKit collects when it decides to: the measurement
// build sat at 600 to 885 MB on the ASD review after the five-view tour, where a memory warning leaves about 130 MB live (28 Oct 2026).
// After work that allocates (a paint, a folder pass) the page asks the shell (src-tauri/src/mac.rs release_memory): the JavaScript garbage
// once it has been quiet QUIET ms (at most every EVERY ms), and what a memory warning would release once it has been quiet FULL_QUIET ms (at
// most every FULL_EVERY ms: that release also drops compiled code, so the next page is drawn a little slower). A window going to the
// background asks for both at once. Input pushes both back. The page itself holds and drops nothing here.
import { lib_timings$timing as timing } from "../boot.mjs";
const QUIET = 2500, EVERY = 15_000, FULL_QUIET = 8000, FULL_EVERY = 60_000;
let gcT = null, fullT = null, lastGc = 0, lastFull = 0, wired = false, pending = false;

const shell = () => (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__?.invoke : null);
const ask = full => shell()?.('release_memory', { full }).catch(() => {});
function gc() { gcT = null; lastGc = Date.now(); const t = performance.now(); ask(false); timing('release', t); }
function full() { fullT = null; pending = false; lastFull = lastGc = Date.now(); clearTimeout(gcT); gcT = null; const t = performance.now(); ask(true); timing('release (full)', t); }
function schedule() {
  clearTimeout(gcT); clearTimeout(fullT);
  gcT = setTimeout(gc, Math.max(QUIET, EVERY - (Date.now() - lastGc)));
  fullT = setTimeout(full, Math.max(FULL_QUIET, FULL_EVERY - (Date.now() - lastFull)));
}
/** After work that made garbage: released once the page has been quiet. */
export function releaseSoon() {
  if (!shell()) return;
  if (!wired && typeof document !== 'undefined') {
    wired = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending) { clearTimeout(gcT); clearTimeout(fullT); full(); } });
    // input means the person is working: the release waits for the next quiet spell
    for (const t of ['pointerdown', 'keydown', 'wheel']) addEventListener(t, () => { if (pending) schedule(); }, { passive: true, capture: true });
  }
  pending = true;
  schedule();
}
