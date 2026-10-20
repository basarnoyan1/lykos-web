// The card a pointed-at chart mark shows. One card lives on the page, above
// every view, so a chart's own box never clips it; it is placed beside the mark
// (right, then left, then below, then above) inside the window, and never over
// the mark it describes.
export function floatingCard() {
  let card = document.querySelector('body > .chart-card-float');
  if (!card) {
    card = document.createElement('div');
    card.className = 'chart-card chart-card-float';
    card.hidden = true;
    document.body.append(card);
    // A scroll or a resize moves what it pointed at.
    addEventListener('scroll', () => { card.hidden = true; }, true);
    addEventListener('resize', () => { card.hidden = true; });
  }
  return card;
}

/**
 * Places `card` (already filled and shown) next to `rect`, the mark's client
 * rectangle. `align` says which edge of the mark the card lines up with when it
 * sits beside it: 'top', or 'bottom' so it never covers the top of a bar.
 */
export function placeCard(card, rect, { align = 'top', gap = 8, pad = 8 } = {}) {
  const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
  const clampX = x => Math.max(pad, Math.min(vw - cw - pad, x));
  const clampY = y => Math.max(pad, Math.min(vh - ch - pad, y));
  const side = clampY(align === 'bottom' ? rect.bottom - ch : rect.top);
  const tries = [
    [rect.right + gap, side],
    [rect.left - cw - gap, side],
    [clampX(rect.left), rect.bottom + gap],
    [clampX(rect.left), rect.top - ch - gap],
  ];
  const fits = ([x, y]) => x >= pad && y >= pad && x + cw <= vw - pad && y + ch <= vh - pad;
  const [x, y] = tries.find(fits) || [clampX(rect.right + gap), side];
  card.style.setProperty('left', `${Math.round(x)}px`);
  card.style.setProperty('top', `${Math.round(y)}px`);
}
