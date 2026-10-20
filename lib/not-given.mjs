// The words a table writes for a value that is not given: "NR" (not reported; the grid writes it for a value marked not found, and typing it
// in a cell marks one) and "NA" (not applicable), with their spelt-out and slashed forms. This is the one place they are written: the summary
// engine and the Details panel name no such word (their tests scan for it) and ask here, after the project's own mapping has had its say.
const WORDS = new Set(['nr', 'na', 'n/a', 'not reported', 'not applicable']);

/** Whether a text (a whole value, or a part's status marker) says the value is not given. Case, surrounding space and dots do not matter. */
export const notGiven = text => WORDS.has(String(text ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '').replace(/\s+/g, ' '));
