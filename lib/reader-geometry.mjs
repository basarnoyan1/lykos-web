// The reader's page geometry as plain functions: the scale a page takes in the room it has, the steps of the zoom buttons, where a page lands when
// it is opened. No DOM, so a test can state each rule and a wrong number fails it (views/reader.mjs draws from these).

/** Zoom buttons move between these scales; a scale between two of them (a fitted page) steps to the next one in the direction pressed. */
export const STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
/** A fitted page is never drawn larger than this, however wide the pane. */
export const FIT_MAX = 2;
/** Gap kept above a page that is scrolled to, in px. */
export const LAND_AIR = 12;

/**
 * The scale of a page of `natural` size (scale 1) in a box `avail` wide and `availH` high (both the room inside the pane's padding).
 * 'width' fills the width, 'page' fills the width or the height, whichever is smaller, 'actual' is 1. There is no minimum width: a pane of 296px
 * gets a page of 296px, because a floor wider than the pane puts the page's edge under the pane's (audit B-44). A box with no width yet
 * (a pane that is not laid out) gives 1; the width watcher draws the page again when it has one.
 */
export function fitScale({ mode = 'width', avail = 0, availH = 0, natural } = {}) {
  if (!natural || !(natural.width > 0)) return 1;
  if (mode === 'actual' || !(avail > 0)) return 1;
  const byWidth = avail / natural.width;
  const scale = mode === 'page' && availH > 0 && natural.height > 0 ? Math.min(byWidth, availH / natural.height) : byWidth;
  return Math.min(FIT_MAX, scale);
}

/** The scale after pressing zoom in (`dir` 1) or zoom out (-1) from `scale`; it stops at the ends of STEPS. */
export function stepScale(scale, dir) {
  return dir > 0
    ? STEPS.find(s => s > scale + 1e-6) ?? STEPS.at(-1)
    : [...STEPS].reverse().find(s => s < scale - 1e-6) ?? STEPS[0];
}

/**
 * Where to scroll so page `n` is in view: page 1 lands at the very top of the column (its own air above it is the column's padding, so the first
 * line of the document is never under the strip), later pages leave LAND_AIR above them. `top` is the stage's offset inside the scrolling box.
 */
export function landTop(top, n, air = LAND_AIR) {
  return n <= 1 ? 0 : Math.max(0, top - air);
}

/**
 * A box on a page (a highlight, a mark, a region) as the four custom properties its stylesheet rule reads. A style attribute is dropped by the
 * packaged app's content security policy; a property set from script is not, and the rule (`.hl`, `.ann`, ...) owns what they mean.
 */
export function placeBox(el, box) {
  el.style.setProperty('--bx', `${box.left}px`);
  el.style.setProperty('--by', `${box.top}px`);
  el.style.setProperty('--bw', `${box.width}px`);
  el.style.setProperty('--bh', `${box.height}px`);
}
/** The size of a page's stage (before and after it is drawn) as the two custom properties `.stage` reads. */
export function sizeStage(el, width, height) {
  el.style.setProperty('--sw', `${Math.round(width)}px`);
  el.style.setProperty('--sh', `${Math.round(height)}px`);
}
