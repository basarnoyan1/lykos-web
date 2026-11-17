// A list that opens one part at a time (the Overview's readiness and stage rows, Literature's search log): which open parts may close when
// another opens, so the pressed control stays where it was pressed (owner, 7 Nov 2026: nothing moves when pressed; docs/Scroll_Sweep_2026-11.md).
// Its own module: only the views that have such lists load it (the shell's first paint does not: app/test/startup-graph.test.mjs).
import { lib_scroll_hold$scrollerAbove as scrollerAbove } from "../boot.mjs";

/**
 * Of the open `parts` of a list that opens one part at a time, those that may close as `pressed` opens another: those below it, and those above
 * while the page can scroll back by their height. Closing a taller one would pull the pressed control up (Literature's log, 66 px, 7 Nov 2026).
 * Within CLOSE_ALLOWANCE_PX counts as room: the scroll position is whole pixels and a part's height is not (an Overview stage of 79.5 px over a
 * page scrolled 79 px stayed open, 8 Nov 2026), and the pressed control then moves less than a pixel.
 */
export const CLOSE_ALLOWANCE_PX = 1;
export function closable(parts, pressed) {
  const sc = pressed?.isConnected ? scrollerAbove(pressed) : null, at = pressed?.getBoundingClientRect().top ?? 0;
  let room = sc?.scrollTop || 0;
  return [...parts].filter(p => {
    const r = p.getBoundingClientRect();
    if (p.contains(pressed) || r.bottom > at + 1) return true;   // its own, or below it
    if (r.height - room >= CLOSE_ALLOWANCE_PX) return false;
    room -= r.height; return true;
  });
}
