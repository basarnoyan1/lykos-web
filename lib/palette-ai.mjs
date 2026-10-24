// The assistant's commands in the palette (⌘K): derived, never listed. The runs are the model actions the current page registered (lib/aid.mjs
// actionsFor), the questions are the page's own (lib/assist-menu.mjs pageMenu), and the rest is the state of the shell: an item to ask about,
// attached items to leave out, a model to connect or to switch. No page, field or topic is named here; a page that registers a new action
// has it in the palette with no change to this file (app/test/palette-ai.test.mjs holds that).
//
// Each command is { id, label, group, icon, meta?, rank, run } so the palette can show it and a test can name it. `on` supplies the doings.

/**
 * @param {object} s
 * @param {string} s.view          the page in view (a key of the page registry)
 * @param {Array}  s.actions       the model actions the page offers now: aid.actionsFor(view, context)
 * @param {object} s.menu          pageMenu(view, actions): { runs, opens, asks }
 * @param {boolean} s.chatReady    a chat model is set up
 * @param {(task:string)=>boolean} s.hasModel  a model is set for an action's task
 * @param {boolean} s.canAsk       there is a selection or a focused item to ask about (attaching needs no model; sending does)
 * @param {number} s.attached      how many items are attached already
 * @param {object} on              { run(id), ask(text), open(click), attach(), leaveOut(), connect(), switchModel() }
 */
export function aiCommands({ view, actions = [], menu = { runs: [], opens: [], asks: [] }, chatReady = false, hasModel = () => true, canAsk = false, attached = 0 } = {}, on = {}) {
  const out = [];
  const add = (id, label, icon, rank, extra = {}) => out.push({ id, label, group: extra.group || 'Assistant', icon, rank, ...extra });
  if (canAsk) add('attach', 'Ask about this', 'assistant', 1, { run: () => on.attach?.() });
  if (attached) add('leave-out', `Leave out attached ${attached === 1 ? 'item' : 'items'}`, 'close', 2, { run: () => on.leaveOut?.() });
  // the page's model actions, each as the registry gave it (the same ids the assistant menu runs)
  for (const a of actions) add(`run:${a.id}`, a.label, a.icon || 'sparkle', 2, { group: 'Model', meta: hasModel(a.task) ? '' : 'No model', run: () => on.run?.(a.id) });
  for (const o of menu.opens || []) add(`open:${o.click}`, o.label, 'checklist', 2, { group: 'Model', run: () => on.open?.(o.click) });
  menu.asks.forEach((text, i) => add(`ask:${i}`, text, 'draft-question', 2, { meta: chatReady ? '' : 'No model', run: () => on.ask?.(text), keys: `ask assistant ${text}` }));
  if (chatReady) add('switch-model', 'Switch chat model…', 'models', 2, { run: () => on.switchModel?.() });
  else add('connect', 'Connect a model…', 'connector', 2, { run: () => on.connect?.() });
  return out;
}
