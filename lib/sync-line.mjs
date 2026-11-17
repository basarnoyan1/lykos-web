// The words for a project folder under a sync client (work queue row 41): one line, before every history write of the command-line tools
// (tools/sync-root.mjs) and in `lykos completeness`. A file Lykos let go that the sync puts back is removed again (tools/let-go.mjs), so
// the line says that, and what stays a risk: a sync racing a run, and the sync's own copies. Pure: the state comes from tools/sync-root.mjs.

/**
 * `s`: { client, root, running?, paused? } or null. Without `running` the line names the root and the risk only (completeness: the same
 * before and after a write). `write`: said before a run that removes history files.
 */
export function syncLine(s, { write = true } = {}) {
  if (!s) return '';
  const what = `This folder is synced by ${s.client} (${s.root})`;
  const risk = write ? 'a history store file this run removes that the sync puts back is removed again by the next history write, but a sync during the run can race it, other files it removes can come back, and the sync\'s own copies keep their space'
    : 'a history store file a cleanup removes that the sync puts back is removed again by the next history write or completeness check; other files can come back';
  const until = write ? 'until this finishes' : 'while the history is written';
  return s.running == null ? `${what}: ${risk}.`
    : s.running ? `${what}, which is running now: ${risk}. Pause it ${until}.`
      : s.paused ? `${what}; it is paused now. Keep it paused ${until}: once it syncs again, ${risk}.`
        : `${what}; it is not running now. Once it runs again, ${risk}.`;
}
