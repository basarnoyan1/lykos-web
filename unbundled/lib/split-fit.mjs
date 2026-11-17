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

/**
 * A live figure that takes the width of its box (owner, 13 Nov 2026: pages "leave large empty spaces"): `draw(width)` returns the drawing for
 * that many pixels and is drawn into `box` now and again each time the box's width changes. A figure drawn at a fixed width filled the left
 * half of a wide pane; one stretched by CSS scaled its type with it. `then(box)` wires each new drawing's marks. Returns the release function.
 */
export function fitFigure(box, draw, { first = 640, then = null } = {}) {
  if (!box) return () => {};
  let at = null;   // the width it is drawn at
  const fit = () => {
    const w = Math.round(box.clientWidth) || 0;
    // a box with no width yet (a hidden pane) gets a first drawing at `first`, so its marks and labels are there; it is redrawn once it has one
    if (!w) { if (at == null) { at = 0; box.innerHTML = draw(first); then?.(box); } return; }
    if (at === w) return;
    at = w;
    box.innerHTML = draw(w);
    then?.(box);
  };
  fit();
  return watchWidth(box, fit);
}

/** Sets `el.dataset[key]` to the first step whose width `el` holds (`steps` widest first, [[min, value], …]), else `last`. */
export function fitSteps(el, key, steps, last) {
  const step = width => (steps.find(([min]) => width >= min) || [0, last])[1];   // as fitSplit's sideBySide
  const fit = () => { const v = step(el.clientWidth); if (el.dataset[key] !== v) el.dataset[key] = v; };
  fit();
  watchWidth(el, fit);
}
