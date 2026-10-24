// What the assistant may do on screen, set by app.mjs: open a page, show where it wrote. Tools work without it (tests, MCP).
let shell = null;
const listeners = new Set();
export const setAssistantShell = s => { shell = s; };
export const assistantShell = () => shell;
/** Writes made in a page ({ view, block, write, label }): the answer lists them, the shell shows them. */
export function announceWrites(writes) {
  if (!writes?.length) return;
  for (const fn of listeners) fn(writes);
  shell?.wrote?.(writes);
}
export const onWrites = fn => { listeners.add(fn); return () => listeners.delete(fn); };
