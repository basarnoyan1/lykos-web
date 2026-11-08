// Takes in tasks that another project sent here (lib/task-handoff.mjs). The shell calls absorbIntoOpenProject once the project has loaded
// and whenever the window is focused again: a project that was closed when the tasks were sent finds them in its own inbox the next time
// it is open, and one that was open in another window finds them on focus. Nothing is added without the person saying yes, and a file that
// was asked about is not asked about again until the app is started again.
//
// Only the open project is ever written, through the store like any other change; its folder is touched only to read and file away the
// hand-off files in `.lykos/inbox/`.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_projects$$ns as projects } from "../boot.mjs";
import { absorbHandoffs, mergeIncoming } from './task-handoff.mjs';
import { lib_tasks$normaliseTasks as normaliseTasks } from "../boot.mjs";
import { setHeld } from './protocol-fields.mjs';

const asked = new Set();            // hand-offs asked about in this run
const heldAsked = new Set();        // held protocol changes asked about in this run (lib/held-changes.mjs)
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
  // an agent's protocol change held for the owner: once a run, whether to review it now in Protocol › Changes (lib/held-changes.mjs heldPrompt),
  // and a notification for each new one; the owner edits, accepts or declines it there (views/protocol-changes.mjs)
  async held(folder, seen) {
    // the modules only when something is held: this runs on every focus
    const st = await folder.stat('.lykos/inbox/held').catch(() => null);
    if (!st?.exists || !st.dir) { setHeld([]); return null; }
    const [held, dialog, notes, changes] = await Promise.all([import('./held-changes.mjs'), import('./dialog.mjs'), import('./notifications.mjs'), import('./change-file.mjs')]);
    const list = await held.listHeld(folder);
    setHeld(list);   // the Overview's needs row counts them (lib/protocol-fields.mjs protocolNeeds)
    if (list.some(h => !(get().notifications || []).some(n => n.id === `held-${h.name}`)))
      update(s => { for (const h of list) notes.notify(s, { id: `held-${h.name}`, title: 'Protocol change waiting for you', detail: `${changes.changeFileWhat(h.cf)}, from ${h.cf.by || 'an agent'}`, tone: 'warning', view: 'protocol:changes' }); return s; }, { label: 'Protocol change waiting' });
    return held.heldPrompt(folder, {
      seen,
      ask: ({ count, by, whats }) => dialog.choiceAsk(count === 1 ? `Protocol change from ${by}` : `${count} protocol changes are waiting`, { detail: `${[...whats.slice(0, 3), ...(whats.length > 3 ? [`and ${whats.length - 3} more`] : [])].join('; ')}. Read, edit, accept or decline them in Protocol, Changes.`,
        choices: [{ id: 'review', label: 'Review', role: 'primary' }], cancel: 'Not now' }),
    });
  },
});

/**
 * Looks in the open project's inbox and offers what is there. Resolves the absorbHandoffs summary, or null when there was nothing to do
 * (no project folder, a dialog open, a pass already running). `onChange(added)` is told after tasks were added, `onReview()` when the
 * person chose to review the held protocol changes now, `onHeld()` after the held changes were read again. Never rejects.
 */
export async function absorbIntoOpenProject({ deps = defaultDeps(), onChange = () => {}, onReview = () => {}, onHeld = () => {} } = {}) {
  armed = true;
  if (running) return null;
  const folder = deps.folder();
  if (!folder || deps.busy?.()) return null;
  running = true;
  try {
    const r = await absorbHandoffs(folder, { existing: deps.existing, ask: deps.ask, apply: deps.apply, seen: asked });
    if (r.added) onChange(r.added);
    if (deps.held && !deps.busy?.()) { r.held = await deps.held(folder, heldAsked).catch(() => null); onHeld(); if (r.held === 'review') onReview(); }
    return r;
  } catch { return null; }
  finally { running = false; }
}

/** For tests: forget which hand-offs were asked about. */
export const forgetAsked = () => { asked.clear(); heldAsked.clear(); armed = false; };
