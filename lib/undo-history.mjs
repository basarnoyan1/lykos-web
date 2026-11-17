// The project's Undo and Redo: a list of steps, each the changes one action made (lib/change-recorder.mjs), so a step costs what it changed,
// never a copy of the project. A run of edits to the same places (typing in a field) is one step. Pure: store.mjs owns the one instance and
// tells it when the project was replaced (another window's save, a reload, a restore), which empties it.
import { undoChanges, redoChanges } from './change-recorder.mjs';

export const MAX_STEPS = 200;          // steps kept to undo
export const MAX_BYTES = 16 * 1024 * 1024;   // estimated size of the values kept across steps; past it the oldest steps go. 16 MB is a requirement, not yet measured
export const MERGE_MS = 1200;          // a step made this soon after the last one, to exactly the same places, joins it
export const GROUP_MS = 30_000;        // a removal's step (begin to end) left open this long is ended by the next change

// A rough size of a value in bytes, from a bounded walk (never JSON.stringify of a section): strings by length, containers by a sample of
// their children times their count, at most NODES nodes visited; what is left unvisited counts a flat 16.
const NODES = 600, SAMPLE = 12;
export const estimateBytes = v => {
  let seen = 0;
  const w = x => {
    if (typeof x === 'string') return 2 + x.length;
    if (!x || typeof x !== 'object') return 8;
    if (++seen > NODES) return 16;
    const ks = Array.isArray(x) ? null : Object.keys(x), n = ks ? ks.length : x.length;
    if (!n) return 8;
    const k = Math.min(n, SAMPLE); let sum = 0;
    for (let i = 0; i < k; i++) { const j = Math.floor(i * n / k); sum += w(ks ? x[ks[j]] : x[j]) + (ks ? 2 + ks[j].length : 0); }
    return 8 + sum * n / k;
  };
  return w(v);
};
const bytesOf = changes => { let b = 0; for (const c of changes) b += 48 + estimateBytes(c.old) + estimateBytes(c.now); return b; };
const placesOf = changes => { const m = new Map(); for (const c of changes) { if (!m.has(c.t)) m.set(c.t, new Set()); m.get(c.t).add(c.k); } return m; };
// the top-level keys a step's changes are under (store.mjs saves those), or null when a change does not say
const keysOf = changes => { const ks = new Set(); for (const c of changes) { if (typeof c.top !== 'string') return null; ks.add(c.top); } return [...ks]; };
const samePlaces = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [t, ks] of a) { const o = b.get(t); if (!o || o.size !== ks.size) return false; for (const k of ks) if (!o.has(k)) return false; }
  return true;
};

export function undoHistory({ now = () => Date.now() } = {}) {
  let done = [], undone = [], total = 0, bytes = 0, group = null;   // group: { step, at }, from begin() to end()
  const trim = () => { while (done.length > 1 && (done.length > MAX_STEPS || bytes > MAX_BYTES)) { const o = done.shift(); total -= o.changes.length; bytes -= o.bytes; } };   // the newest step stays, however large
  return {
    /** A finished action's changes. `label`: what it was, for the menu ("Edit value"). */
    push(changes, label = '') {
      if (!changes?.length) return;
      undone = [];
      const at = now(), last = done.at(-1), places = placesOf(changes);
      if (group && at - group.at > GROUP_MS) group = null;   // left open by a removal that failed before it ended
      const b = bytesOf(changes);
      if (group?.step && last === group.step) { last.changes.push(...changes); last.at = at; total += changes.length; last.bytes += b; bytes += b; }
      else if (!group && last && !last.closed && at - last.at <= MERGE_MS && samePlaces(last.places, places)) {
        last.changes.push(...changes); last.at = at; total += changes.length; last.bytes += b; bytes += b;
      } else { const step = { changes, label, at, places, closed: false, bytes: b }; done.push(step); total += changes.length; bytes += b; if (group) group.step ||= step; }
      trim();
    },
    /** From here to end(), every change joins one step, whatever it touches and whoever made it: a removal's own step (lib/undo-removal.mjs). */
    begin() { const last = done.at(-1); if (last) last.closed = true; group = { step: null, at: now() }; },
    /** Ends the step begin() opened and answers it, named `label` for Edit › Undo; null when nothing changed. */
    end(label = '') { const step = group?.step || null; group = null; if (step) { step.closed = true; if (label) step.label = label; } return step; },
    /** The last step, to compare: a removal's toast takes back its own step only while it is the last. */
    get last() { return done.at(-1) || null; },
    get grouping() { return !!group && now() - group.at <= GROUP_MS; },
    /** The next action starts a step of its own (an undo, a page change, a save of a field). */
    close() { const last = done.at(-1); if (last) last.closed = true; },
    undo() {
      const s = done.pop(); if (!s) return null;
      total -= s.changes.length; bytes -= s.bytes; s.closed = true;
      const n = undoChanges(s.changes); undone.push(s);
      return { label: s.label, writes: n, keys: keysOf(s.changes) };
    },
    redo() {
      const s = undone.pop(); if (!s) return null;
      const n = redoChanges(s.changes); done.push(s); total += s.changes.length; bytes += s.bytes;
      return { label: s.label, writes: n, keys: keysOf(s.changes) };
    },
    clear() { done = []; undone = []; total = 0; bytes = 0; },
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
    get undoLabel() { return done.at(-1)?.label || ''; },
    get redoLabel() { return undone.at(-1)?.label || ''; },
    get size() { return { steps: done.length, redo: undone.length, changes: total, bytes }; },
  };
}
