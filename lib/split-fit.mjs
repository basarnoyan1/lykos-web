// A two-column page part (a figure and its words) that stacks when its pane cannot hold both: measured on the part itself through the width
// engine (watchWidth), never a breakpoint. The part carries data-stack="true" while stacked; its stylesheet decides what that means.
import { watchWidth } from './ui-actions.mjs';

/** Keeps `el` side by side while it is at least `min` pixels wide, stacked below that. */
export function fitSplit(el, min = 760) {
  const sideBySide = width => width >= min;   // as lib/overview-panel.mjs pageSplit
  const fit = () => { const v = String(!sideBySide(el.clientWidth)); if (el.dataset.stack !== v) el.dataset.stack = v; };
  fit();
  watchWidth(el, fit);
}

/** Sets `el.dataset[key]` to the first step whose width `el` holds (`steps` widest first, [[min, value], …]), else `last`. */
export function fitSteps(el, key, steps, last) {
  const step = width => (steps.find(([min]) => width >= min) || [0, last])[1];   // as fitSplit's sideBySide
  const fit = () => { const v = step(el.clientWidth); if (el.dataset[key] !== v) el.dataset[key] = v; };
  fit();
  watchWidth(el, fit);
}
