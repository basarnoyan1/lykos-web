// Takes in tasks that another project sent here (lib/task-handoff.mjs). The shell calls absorbIntoOpenProject once the project has loaded
// and whenever the window is focused again: a project that was closed when the tasks were sent finds them in its own inbox the next time
// it is open, and one that was open in another window finds them on focus. Nothing is added without the person saying yes, and a file that
// was asked about is not asked about again until the app is started again.
//
// Only the open project is ever written, through the store like any other change; its folder is touched only to read and file away the
// hand-off files in `.lykos/inbox/`.
import { get, update } from '../store.mjs';
import * as projects from './projects.mjs';
import { absorbHandoffs, mergeIncoming } from './task-handoff.mjs';
import { normaliseTasks } from './tasks.mjs';

const asked = new Set();            // hand-offs asked about in this run
let running = false, armed = false;

/** Whether the shell takes hand-offs in (it has called absorbIntoOpenProject). Tasks are sent to another project only while it does: a file nobody reads is a task nobody sees. */
export const absorberArmed = () => armed;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the module does in the running app; a test hands `absorbIntoOpenProject` its own. */
export const defaultDeps = () => ({
  folder: () => (projects.isNone() ? null : projects.activeFolder()),
  existing: () => normaliseTasks(get().todos),
  busy: () => typeof document !== 'undefined' && !!document.querySelector('dialog[open]'),
  async ask({ from, count }) {
    const { confirmAsk } = await import('./dialog.mjs');
    return confirmAsk(`Add ${plural(count, 'task')} from ${from}?`, { detail: 'They were moved here from another project.', confirm: 'Add' });
  },
  async apply(incoming) {
    let added = 0;
    update(s => { const m = mergeIncoming(s.todos, incoming); s.todos = [...(Array.isArray(s.todos) ? s.todos : []), ...m.added]; added = m.added.length; return s; });
    return added;
  },
});

/**
 * Looks in the open project's inbox and offers what is there. Resolves the absorbHandoffs summary, or null when there was nothing to do
 * (no project folder, a dialog open, a pass already running). `onChange(added)` is told after tasks were added. Never rejects.
 */
export async function absorbIntoOpenProject({ deps = defaultDeps(), onChange = () => {} } = {}) {
  armed = true;
  if (running) return null;
  const folder = deps.folder();
  if (!folder || deps.busy?.()) return null;
  running = true;
  try {
    const r = await absorbHandoffs(folder, { existing: deps.existing, ask: deps.ask, apply: deps.apply, seen: asked });
    if (r.added) onChange(r.added);
    return r;
  } catch { return null; }
  finally { running = false; }
}

/** For tests: forget which hand-offs were asked about. */
export const forgetAsked = () => { asked.clear(); armed = false; };
