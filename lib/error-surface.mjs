// A global error surface (review finding 11): an error nobody caught, or a promise nobody awaited, leaves a button that "does nothing".
// It is logged and shown once as a short notice through the shared notice builder. Not spammy: the same message is shown once a
// minute, at most three different ones a minute, the rest are only logged; an abort is not an error.
const WINDOW_MS = 60_000, MAX_SHOWN = 3;

const IGNORED = /^(?:ResizeObserver loop|Script error\.?$)/i;

/** The first line of what was thrown, or '' when it is not worth a notice (an abort, a cross-origin "Script error"). */
export function errorMessage(reason) {
  if (reason?.name === 'AbortError' || reason?.code === 20) return '';
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : reason?.message ?? '';
  const line = String(raw || '').split('\n')[0].trim();
  if (!line || IGNORED.test(line)) return '';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * Listens on `target` (the window). `show(text)` draws the notice; `log` is console.error. Answers a function that stops listening.
 * `now` is for tests.
 */
export function installErrorSurface({ target = globalThis.window, show, log = (...a) => console.error(...a), now = Date.now } = {}) {
  if (!target?.addEventListener) return () => {};
  const recent = new Map();   // message → when it was last shown
  const note = (reason, where) => {
    log(`[${where}]`, reason);
    const msg = errorMessage(reason);
    if (!msg) return;
    const t = now();
    for (const [m, at] of recent) if (t - at > WINDOW_MS) recent.delete(m);
    if (recent.has(msg) || recent.size >= MAX_SHOWN) return;
    recent.set(msg, t);
    try { show(`Something went wrong: ${msg}`); } catch {}
  };
  const onError = e => note(e?.error ?? e?.message, 'error');
  const onRejection = e => note(e?.reason, 'unhandledrejection');
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => { target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection); };
}
