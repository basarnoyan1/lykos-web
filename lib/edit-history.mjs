/** Selection-aware transactions, independent of browser-specific textarea undo. */
export function editHistory(initial, limit = 100) {
  let entries = [{ ...initial }], cursor = 0;
  return {
    push(value) {
      if (entries[cursor].text === value.text) { entries[cursor] = { ...value }; return; }
      entries = entries.slice(0, cursor + 1); entries.push({ ...value });
      if (entries.length > limit) entries.shift();
      cursor = entries.length - 1;
    },
    undo() { if (cursor) return { ...entries[--cursor] }; return null; },
    redo() { if (cursor < entries.length - 1) return { ...entries[++cursor] }; return null; },
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor < entries.length - 1; },
  };
}
