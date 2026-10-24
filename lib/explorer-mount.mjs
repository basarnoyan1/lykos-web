// How the file tree gets its callbacks now that the shell loads it on first use (footprint Task 6). views/explorer.mjs is shared with the Files page
// (views/files.mjs, file-browser.mjs, file-doc.mjs read its listing and its callbacks), so every path that loads it must also mount it, as the
// shell used to at start. The shell registers one mount function here; the explorer calls `explorerLoaded` as its last line, and a registration
// that comes after the module is here is run at once with that module. A page that imports the explorer without the shell (a test, the fixture
// seed) mounts it itself, as before.
let mounter = null, loaded = null;
export function onExplorerLoaded(fn) { mounter = fn; if (loaded) fn(loaded); }
export function explorerLoaded(ns) { loaded = ns; mounter?.(ns); }
