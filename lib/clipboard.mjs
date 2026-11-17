// Copy text to the clipboard. The system clipboard first; when the page may not use it, the old copy command on a text box held out of sight.
// Resolves true when the text was copied and false when both refused: the caller says so where its other messages go (a status line, the
// title bar's message), never in a dialog that shows the text with a Close.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const box = document.createElement('textarea');
  box.value = String(text); box.setAttribute('readonly', ''); box.setAttribute('aria-hidden', 'true'); box.className = 'copy-sink';
  document.body.append(box);
  try { box.select(); return document.execCommand('copy') === true; } catch { return false; } finally { box.remove(); }
}
