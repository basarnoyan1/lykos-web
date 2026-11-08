// The app's own files, wherever the app is served from: at the origin's root by the dev server and the desktop shell
// (tauri://localhost/), under a folder on a static host (https://basarnoyan1.github.io/lykos-web/). A root-absolute path
// such as '/webr/' asks the host's root and misses the second; app/lint-src.mjs refuses one in src.
// Resolved against this module's own URL, since lib/ sits one folder below the app root, so no page has to set a <base>.
const ROOT = new URL('../', import.meta.url);
export const appUrl = path => new URL(path, ROOT).href;
