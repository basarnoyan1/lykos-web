// The reading place of a scroller whose content is scaled (views/file-doc.mjs, the Word view's zoom): the point at the top stays at the top, the
// view's centre stays at the same place across the page, and a page wider than the view starts from its centre.
const GUTTER = 24;   // the scroller's padding: the eye starts one gutter below its top edge

/** { centre, note, keep }: `note()` before the scale changes, `keep(note, from, to)` after; `centre()` puts the view back to the middle. */
export function placeKeeper(viewport, stage) {
  let sideAt = .5, set = -1;   // sideAt: where across the stage the view's centre is (.5: the middle)
  viewport.addEventListener('scroll', () => {
    const own = Math.abs(viewport.scrollLeft - set) < 2;
    if (own || !stage.offsetWidth) return;
    sideAt = (viewport.scrollLeft + viewport.clientWidth / 2 - stage.offsetLeft) / stage.offsetWidth;
  }, { passive: true });
  return {
    centre() { sideAt = .5; },
    note: () => viewport.scrollTop,
    keep(top, from, to) {
      if (from) viewport.scrollTop = (top + GUTTER - stage.offsetTop) * (to / from) + stage.offsetTop - GUTTER;
      viewport.scrollLeft = stage.offsetLeft + sideAt * stage.offsetWidth - viewport.clientWidth / 2;   // the browser stops it at the ends: no room, no move
      set = viewport.scrollLeft;
    },
  };
}
