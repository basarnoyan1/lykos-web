// A new build from this checkout, waiting for Lykos to close (31 Oct 2026). The scheduled installer (tools/update-macos-app.mjs
// --scheduled, run by the launch agent at login, after each commit and every 30 minutes) builds the checkout's newest commit while
// Lykos stays open, writes <app data>/source-update.json ({ state: 'waiting', commit, version, at }) and waits for Lykos to close;
// then it installs the build and opens it again. Here the open app reads that file (the shell's source_update_state), and when a build
// of another commit waits it offers Restart. Restart never cuts into work: while the project is saving, a job runs (a search, a
// download, a model sweep) or an agent is editing the folder, it waits and says for what, and goes on by itself once they end; the
// restart itself is the usual quit, which writes pending edits first (or keeps the window when they cannot be written).
const POLL_MS = 60_000, RETRY_MS = 5_000;

/** Two commits are the same when one is a prefix of the other (short and long hashes). */
export const sameCommit = (a, b) => { const x = String(a || '').trim().toLowerCase(), y = String(b || '').trim().toLowerCase(); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };

/** The build to offer: the state file's, when a build waits and it is of another commit than the one running; else null. */
export function offerFor(state, running = {}) {
  if (!state || state.state !== 'waiting' || !state.commit) return null;
  if (running.commit && sameCommit(state.commit, running.commit)) return null;
  return { commit: String(state.commit), version: String(state.version || ''), at: String(state.at || '') };
}

/** What keeps the restart waiting, in the notice's words: [] when it may go now. */
export function restartBlockers({ save = 'saved', jobs = [], agent = null } = {}) {
  const out = [];
  if (save === 'saving') out.push('the project is saving');
  if (save === 'failed') out.push('the last save failed');
  if (jobs.length) out.push(jobs.length === 1 ? `${jobs[0].label || 'a job'} is running` : `${jobs.length} jobs are running`);
  if (agent) out.push(`${agent.by || 'an agent'} is editing the project`);
  return out;
}

/** The notice's text for a waiting build. */
export const offerText = (o, blockers = []) => `Lykos ${o.version ? `${o.version} ` : ''}(${o.commit.slice(0, 7)}) is built from the newest commit. ${blockers.length
  ? `Restart waits until ${blockers.join(' and ')}.` : 'Restart to use it; your work is saved first.'}`;

let started = false;
/**
 * Starts looking for a waiting build (desktop app only): every minute and when the window comes back to the front. `notice` shows
 * or hides the shell notice ({ show(spec), hide(id) }); `state()` gives { save, jobs, agent } now.
 */
export function startSourceUpdates({ invoke, running, notice, state, win = globalThis.window }) {
  if (started || typeof invoke !== 'function') return;
  started = true;
  let offer = null, wanted = false, timer = null;
  const draw = () => {
    if (!offer) { notice.hide('source-update'); return; }
    const blockers = restartBlockers(state());
    notice.show({ id: 'source-update', label: 'New build', text: offerText(offer, wanted ? blockers : []), again: true,
      actions: wanted ? [] : [{ id: 'source-update-restart', label: 'Restart', run: () => { wanted = true; go(); } }] });
  };
  // the restart goes when nothing holds it, and looks again shortly while something does
  const go = () => {
    clearTimeout(timer);
    if (!offer) return;
    const blockers = restartBlockers(state());
    draw();
    if (blockers.length) { timer = setTimeout(go, RETRY_MS); return; }
    invoke('source_update_restart').catch(() => { wanted = false; draw(); });
  };
  const look = async () => {
    let st = null;
    try { st = await invoke('source_update_state'); } catch { return; }   // an older shell has no such command
    const next = offerFor(st, await running());
    if (JSON.stringify(next) === JSON.stringify(offer)) return;
    offer = next; if (!offer) wanted = false;
    draw();
  };
  look();
  setInterval(look, POLL_MS);
  win?.addEventListener?.('focus', look);
}
