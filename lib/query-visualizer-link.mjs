// Open in query visualizer: a query from a search run or the inspector's Query structure goes to the visualizer page (query.html), which
// restores its text, mode, dialect and view from localStorage `lykos.query` (query/query.mjs KEEP). A browser tab of the app shares that
// storage, so the record is written there; the desktop window opens the page at the hosted copy in the default browser (another origin, so
// no shared storage): the query goes in the address's fragment, which the page reads once and never sends to a server.
import { appUrl, HOSTED } from './app-url.mjs';
import { lib_native$inDesktop as inDesktop, lib_native$openUrlNative as openUrlNative } from "../boot.mjs";

export const KEEP = 'lykos.query';

/** The visualizer's record for a query: the text, the text editor, the database's dialect ('' lets the page detect it), the view kept. */
export const visualizerRecord = (text, dialect = '', view = 'combined') => ({ text: String(text ?? ''), mode: 'text', dialect: dialect || '', view: view === 'lines' ? 'lines' : 'combined' });

export function openInVisualizer(text, dialect = '', { storage = globalThis.localStorage, desktop = inDesktop(), open = u => globalThis.open(u, '_blank') } = {}) {
  if (desktop) {
    const h = new URLSearchParams({ text: String(text ?? ''), ...(dialect ? { dialect } : {}) });
    return openUrlNative(`${HOSTED}query.html#${h}`);
  }
  let view = 'combined';
  try { view = JSON.parse(storage.getItem(KEEP) || '{}')?.view; } catch { /* nothing kept */ }
  try { storage.setItem(KEEP, JSON.stringify(visualizerRecord(text, dialect, view))); } catch { /* a private window keeps nothing */ }
  return open(appUrl('query.html'));
}
