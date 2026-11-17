// The browser's Back inside a tab of Lykos (never the desktop app, which has no Back). Each step a person takes that Back should undo (another
// view, a record opened over its list on a phone, a panel over the whole screen) adds one history entry and how to undo it; Back undoes the
// last step and stays in the app. The app's own Back or close takes its step off with drop(), so the browser's Back never needs a second press.
// A reload starts with no steps: entries left from before it are passed over in one move, and Back from the first page leaves the app as before.
const steps = [];   // [{ tag, back }], one per history entry this page added
let undoing = false, ignore = 0;

addEventListener('popstate', e => {
  if (ignore) { ignore--; return; }
  const to = Number.isInteger(e.state?.lykos) ? e.state.lykos : 0;
  // an entry with no step behind it (left from before a reload, or reached by Forward): pass over it to the last one that has one
  if (to > steps.length) { ignore++; history.go(steps.length - to); return; }
  undoing = true;
  try { while (steps.length > to) steps.pop().back(); } finally { undoing = false; }
});
history.replaceState({ ...(history.state || {}), lykos: 0 }, '');

/** A step Back should undo: `back` puts the page as it was; `tag` names it for drop(). Nothing is added while Back is undoing one. */
export function step(tag, back) {
  if (undoing) return;
  steps.push({ tag, back });
  history.pushState({ lykos: steps.length }, '');
}

/** A step was undone by the app itself (its own Back or close): its entry goes, so the browser's Back never lands on it. The latest step of
 * that kind is taken out wherever it stands (a panel closed under a record opened after it); the entries count steps, so one comes off the end. */
export function drop(tag) {
  const at = undoing ? -1 : steps.findLastIndex(s => s.tag === tag);
  if (at < 0) return;
  steps.splice(at, 1); ignore++; history.back();
}

/** The kind of the last step, or '' (the title bar's Back to … takes the browser's Back when that step is its view). */
export const lastStep = () => steps.at(-1)?.tag || '';

/** Whether Back is undoing a step now (a view opened by it adds none). */
export const isUndoing = () => undoing;
