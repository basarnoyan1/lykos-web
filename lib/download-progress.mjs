// Who is told when a paper download starts, advances or ends. Kept on its own so that the shell can listen from the start while the downloader
// (lib/paper-download.mjs, with the preview cache and the PDF reader's loader) loads with the first page or study that uses it.
export const listeners = new Set();
export const onDownloadProgress = fn => { listeners.add(fn); return () => listeners.delete(fn); };
