// The project history's fast path in the desktop app: one native call walks the whole folder, and files are hashed natively in batches
// (src-tauri main.rs walk_dir, hash_files), so a scan neither asks folder by folder nor moves file bytes into the page. A folder reached any
// other way (the browser's own file system, a test's folder in memory) has no fast path and lib/vcs.mjs reads it the ordinary way.
const invoke = () => (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__?.invoke : null);

/** `{ walk(skip), hashFiles(rels), status(), commit(args) }` for a desktop folder, or null. `walk` answers [{ path, size, mtime }]; `hashFiles` a hash or null each. */
export function nativeOf(folder) {
  const call = invoke();
  if (!call || folder?.kind !== 'path' || !folder.root) return null;
  const abs = rel => `${folder.root}/${rel}`;
  return {
    walk: async skip => (await call('walk_dir', { dir: folder.root, skip })).map(([path, size, mtime]) => ({ path, size, mtime })),
    hashFiles: rels => call('hash_files', { paths: rels.map(abs) }),
    // the whole status and the whole commit in the shell (src-tauri/src/history.rs): no file's bytes pass through the page
    status: () => call('history_status', { dir: folder.root }),
    commit: ({ message, by, paths, links, tag }) => call('history_commit', { dir: folder.root, message, by, paths: paths || null, links: links || [], tag: tag || '' }),
  };
}
