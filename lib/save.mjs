// Saving a file the user asked for.
//
// In a browser an anchor with `download` does it. In the packaged app the
// webview has no download path: the bytes go to the shell, which asks where
// to put them and writes them. One function, so every export — a figure, a
// CSV, a Word file, the bundle — behaves the same in both.
import { inDesktop, saveFileNative } from './native.mjs';

export async function saveFile(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (inDesktop()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());   // sent as the request body, not as an array of numbers
    return saveFileNative(filename, bytes);   // the chosen path, or null when cancelled
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return filename;
}
